-- M5-02：供应商收款账户、银行转账文件、流水号回填（ADR 0051）。需求：《平台运营端与渠道对接》「财务结算」（生成付款批次 → 双人复核 → 银行转账：导出批量付款文件，付款后回填银行流水号；
-- 结算账户变更需审核）、数据模型 payout（statement_id、amount、currency、bank_ref、status、approved_by）；《用车报价服务平台》「12. 资质认证」（账户号加密存储）。
-- 只建结构和授权，不含任何数据。编号说明：0140、0150 被 M4-08、M4-06 占用。

-- ---- 供应商收款账户（租户表）：内容不可变，改账户就是提交一条新记录；账号只存密文和末 4 位 ----

create table payout_accounts (
  tenant_id uuid not null references tenants (id),
  id uuid not null,
  currency text not null,
  beneficiary_name text not null,
  beneficiary_address text not null,
  bank_name text not null,
  bank_address text not null,
  swift_bic text not null,
  -- iban / account
  account_kind text not null,
  -- SecretBox 的密文（用途 payout-account，附加数据 <租户编号>:<账户编号>）；任何接口都不返回
  account_sealed text not null,
  account_last4 text not null,
  -- @nozomi/domain 的 PAYOUT_ACCOUNT_STATUSES
  status text not null,
  submitted_by uuid not null,
  submitted_at timestamptz not null,
  -- 批准启用：哪一条复核、什么时候；替换了旧账户的标记（风控提醒用）
  approval_id uuid references approvals (id),
  activated_at timestamptz,
  replaced_previous boolean not null default false,
  superseded_at timestamptz,
  rejected_at timestamptz,
  rejected_by uuid references platform_users (id),
  reject_reason text,
  withdrawn_at timestamptz,
  version integer not null default 1,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, submitted_by) references tenant_users (tenant_id, id),
  constraint payout_accounts_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint payout_accounts_kind_check check (account_kind in ('iban', 'account')),
  constraint payout_accounts_last4 check (account_last4 ~ '^[A-Z0-9]{4}$'),
  constraint payout_accounts_sealed check (account_sealed like 'v1.%'),
  constraint payout_accounts_status_check check (status in ('pending', 'active', 'superseded', 'rejected', 'withdrawn')),
  constraint payout_accounts_activated check ((status in ('active', 'superseded')) = (activated_at is not null) and (activated_at is null) = (approval_id is null)),
  constraint payout_accounts_superseded check ((status = 'superseded') = (superseded_at is not null)),
  constraint payout_accounts_rejected check ((status = 'rejected') = (rejected_at is not null) and (rejected_at is null) = (rejected_by is null) and (rejected_at is null) = (reject_reason is null)),
  constraint payout_accounts_withdrawn check ((status = 'withdrawn') = (withdrawn_at is not null)),
  constraint payout_accounts_reason_length check (reject_reason is null or char_length(reject_reason) between 1 and 500),
  constraint payout_accounts_version_positive check (version >= 1)
);

-- 同一家同一币种最多一个生效、一个待审核
create unique index payout_accounts_active_key on payout_accounts (tenant_id, currency) where status = 'active';
create unique index payout_accounts_pending_key on payout_accounts (tenant_id, currency) where status = 'pending';
create index payout_accounts_tenant_idx on payout_accounts (tenant_id, submitted_at desc, id);
-- 运营后台跨供应商的审核队列（不以 tenant_id 开头的例外）
create index payout_accounts_platform_idx on payout_accounts (status, submitted_at desc, id);

alter table payout_accounts enable row level security;
create policy payout_accounts_same_tenant on payout_accounts for select to nozomi_app using (tenant_id = app_tenant_id());
create policy payout_accounts_platform on payout_accounts to nozomi_platform using (true) with check (true);
grant select on payout_accounts to nozomi_app;
grant select, insert, update on payout_accounts to nozomi_platform;

-- 内容不可变：平台只能改状态和审核字段，别的列出现在 update 语句里就拒绝（和没有权限一样，42501）
create trigger payout_accounts_platform_columns
  before update of tenant_id, id, currency, beneficiary_name, beneficiary_address, bank_name, bank_address, swift_bic, account_kind, account_sealed, account_last4, submitted_by, submitted_at
  on payout_accounts
  for each statement execute function reject_platform_column_update();

-- ---- 转账文件（平台表：租户没有任何权限）：一个文件一个批次、一种币种；内容不存，下载时从条目快照现生成 ----

create table bank_files (
  id uuid primary key default gen_random_uuid(),
  file_no text not null,
  payout_batch_id uuid not null references payout_batches (id),
  currency text not null,
  -- @nozomi/domain 的 BANK_FILE_TEMPLATES
  template text not null,
  -- OUR / SHA / BEN
  charge_bearer text not null,
  -- @nozomi/domain 的 BANK_FILE_STATUSES
  status text not null,
  item_count integer not null,
  total_minor bigint not null,
  -- 发起生成时明确排除的账单（账单号、原因代码），没有账号
  excluded jsonb not null,
  approval_id uuid not null references approvals (id),
  requested_by uuid not null references platform_users (id),
  approved_by uuid not null references platform_users (id),
  created_at timestamptz not null,
  first_downloaded_at timestamptz,
  download_count integer not null default 0,
  -- 第一次下载某种格式时记下的 SHA-256，之后再下载核对
  csv_sha256 text,
  xlsx_sha256 text,
  paid_at timestamptz,
  voided_at timestamptz,
  voided_by uuid references platform_users (id),
  -- 作废原因；已回填过部分条目的文件作废时只作废未付款的条目、文件记为已付款，原因也写在这里
  void_reason text,
  version integer not null default 1,
  updated_at timestamptz not null,
  constraint bank_files_no_key unique (file_no),
  constraint bank_files_no_format check (file_no ~ '^BF[0-9]{8}[0-9A-HJ-NP-Z]{8}$'),
  constraint bank_files_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint bank_files_bearer_check check (charge_bearer in ('OUR', 'SHA', 'BEN')),
  constraint bank_files_status_check check (status in ('generated', 'downloaded', 'paid', 'void')),
  constraint bank_files_item_count check (item_count >= 1),
  constraint bank_files_total_positive check (total_minor > 0),
  constraint bank_files_excluded check (jsonb_typeof(excluded) = 'array'),
  constraint bank_files_two_person check (requested_by <> approved_by),
  constraint bank_files_downloaded check ((first_downloaded_at is null) = (download_count = 0) and (status <> 'downloaded' or first_downloaded_at is not null)),
  constraint bank_files_sha check ((csv_sha256 is null or csv_sha256 ~ '^[0-9a-f]{64}$') and (xlsx_sha256 is null or xlsx_sha256 ~ '^[0-9a-f]{64}$')),
  constraint bank_files_paid check ((status = 'paid') = (paid_at is not null)),
  constraint bank_files_void check ((status = 'void') = (voided_at is not null) and (voided_at is null) = (voided_by is null) and (status <> 'void' or void_reason is not null)),
  constraint bank_files_reason_length check (void_reason is null or char_length(void_reason) between 1 and 500),
  constraint bank_files_version_positive check (version >= 1)
);

create index bank_files_batch_idx on bank_files (payout_batch_id, created_at desc, id);
create index bank_files_created_idx on bank_files (created_at desc, id);

grant select, insert, update on bank_files to nozomi_platform;

create trigger bank_files_platform_columns
  before update of id, file_no, payout_batch_id, currency, template, charge_bearer, item_count, total_minor, excluded, approval_id, requested_by, approved_by, created_at
  on bank_files
  for each statement execute function reject_platform_column_update();

-- ---- 文件条目（带 tenant_id；租户角色没有授权，只给平台）：每笔一行，账户内容是批准时的快照，账号是复制过来的密文 ----

create table bank_file_items (
  tenant_id uuid not null references tenants (id),
  id uuid not null default gen_random_uuid(),
  file_id uuid not null references bank_files (id),
  seq integer not null,
  statement_id uuid not null,
  statement_no text not null,
  account_id uuid not null,
  amount_minor bigint not null,
  currency text not null,
  beneficiary_name text not null,
  beneficiary_address text not null,
  bank_name text not null,
  bank_address text not null,
  swift_bic text not null,
  account_sealed text not null,
  account_last4 text not null,
  reference text not null,
  -- 回填
  bank_reference text,
  paid_at timestamptz,
  paid_by uuid references platform_users (id),
  -- 文件作废时未付款的条目一起作废，账单释放
  voided_at timestamptz,
  primary key (tenant_id, id),
  foreign key (tenant_id, statement_id) references statements (tenant_id, id),
  foreign key (tenant_id, account_id) references payout_accounts (tenant_id, id),
  constraint bank_file_items_seq_key unique (file_id, seq),
  constraint bank_file_items_seq_positive check (seq >= 1),
  constraint bank_file_items_amount_positive check (amount_minor > 0),
  constraint bank_file_items_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint bank_file_items_paid check ((paid_at is null) = (bank_reference is null) and (paid_at is null) = (paid_by is null) and (paid_at is null or voided_at is null)),
  constraint bank_file_items_reference_length check (bank_reference is null or char_length(bank_reference) between 1 and 64)
);

-- 一张账单同时只能在一个未作废的文件里：不会付两次（数据库保证）
create unique index bank_file_items_active_key on bank_file_items (tenant_id, statement_id) where voided_at is null;

alter table bank_file_items enable row level security;
create policy bank_file_items_same_tenant on bank_file_items for select to nozomi_app using (tenant_id = app_tenant_id());
create policy bank_file_items_platform on bank_file_items to nozomi_platform using (true) with check (true);
grant select, insert, update on bank_file_items to nozomi_platform;

create trigger bank_file_items_platform_columns
  before update of tenant_id, id, file_id, seq, statement_id, statement_no, account_id, amount_minor, currency, beneficiary_name, beneficiary_address, bank_name, bank_address, swift_bic, account_sealed, account_last4, reference
  on bank_file_items
  for each statement execute function reject_platform_column_update();

-- ---- 账单：银行流水号 ----

alter table statements add column bank_reference text;
alter table statements add constraint statements_bank_reference check ((status = 'paid') = (bank_reference is not null) and (bank_reference is null or char_length(bank_reference) between 1 and 64));
