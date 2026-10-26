-- M5-01：供应商应付账单与付款批次（ADR 0040）。需求：《平台运营端与渠道对接》「财务结算」（租户应付账单：生成 → 租户确认（可提异议）→ 双人复核 → 付款；
-- 月结，次月 20 日付上月已结案订单；生成付款批次 → 双人复核 → 银行转账）、「敏感操作双人复核」（付款给租户）、数据模型 statement / payout；
-- 《用车报价服务平台》「13. 二期功能 · 对账结算」；第三轮决策（月结、次月 20 日付款）、第五轮决策（租户退出：最后一期延后一个周期付款）。
-- 只建结构和授权，不含任何数据。编号说明：0050–0069 留给别的分支。

-- ---- 付款批次（平台表：租户没有任何权限）。一个付款日一个批次；复核通过的账单进它 ----

create table payout_batches (
  id uuid primary key default gen_random_uuid(),
  -- 付款日（东京日期，默认每月 20 日）
  pay_date date not null,
  -- open 收账单中 / closed 已锁定，等银行转账（转账文件在 M5-02）/ paid 已付款（M5-02 回填流水号）
  status text not null,
  created_at timestamptz not null,
  closed_at timestamptz,
  closed_by uuid references platform_users (id),
  paid_at timestamptz,
  version integer not null default 1,
  constraint payout_batches_pay_date_key unique (pay_date),
  constraint payout_batches_status_check check (status in ('open', 'closed', 'paid')),
  constraint payout_batches_closed check ((status = 'open') = (closed_at is null) and (closed_at is not null or closed_by is null)),
  constraint payout_batches_paid check ((status = 'paid') = (paid_at is not null)),
  constraint payout_batches_version_positive check (version >= 1)
);

grant select, insert, update on payout_batches to nozomi_platform;

-- ---- 账单（租户表：供应商只读自己的；确认、提异议在平台事务里按令牌里的租户编号执行） ----

create table statements (
  tenant_id uuid not null references tenants (id),
  id uuid not null default gen_random_uuid(),
  -- 给人看的账单号：ST + 周期（YYYYMM）+ 8 位随机字符，全平台唯一
  statement_no text not null,
  -- 周期（YYYY-MM），按订单的服务日期（城市当地日期）切月
  period text not null,
  -- 一张账单一种币种（订单的结算币种），金额都是这种币种的最小单位
  currency text not null,
  -- @nozomi/domain 的 STATEMENT_STATUSES
  status text not null,
  -- 有效明细的合计（正数平台付给供应商，负数是扣款多于应付）和条数
  total_minor bigint not null,
  line_count integer not null,
  -- 应付日：次月 20 日（合同的付款日；已清退的再延后一个月）
  pay_due_on date not null,
  -- 确认期截止：到点还没确认、也没提异议，视为确认
  confirm_due_at timestamptz not null,
  issued_at timestamptz not null,
  -- 确认：供应商的用户、或系统（确认期满）
  confirmed_at timestamptz,
  confirmed_by_type text,
  confirmed_by uuid,
  -- 最近一次异议（平台答复后回到待确认，异议内容和答复都在 statement_events 里）
  disputed_at timestamptz,
  dispute_reason text,
  -- 双人复核（付款给租户）
  approval_id uuid references approvals (id),
  approved_at timestamptz,
  -- 进了哪个付款批次、付款日
  payout_batch_id uuid references payout_batches (id),
  payout_on date,
  paid_at timestamptz,
  -- 作废（明细释放，重新出账）
  voided_at timestamptz,
  voided_by uuid references platform_users (id),
  void_reason text,
  version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  constraint statements_no_format check (statement_no ~ '^ST[0-9]{6}[0-9A-HJ-NP-Z]{8}$'),
  constraint statements_period_format check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint statements_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint statements_status_check check (status in ('issued', 'disputed', 'confirmed', 'in_payout', 'paid', 'settled', 'carried', 'void')),
  constraint statements_line_count check (line_count >= 1),
  constraint statements_confirmed check (
    (confirmed_at is null) = (confirmed_by_type is null)
    and (confirmed_by_type is null or confirmed_by_type in ('tenant_user', 'system'))
    and ((confirmed_by_type = 'tenant_user') = (confirmed_by is not null))
    and (status not in ('confirmed', 'in_payout', 'paid', 'settled', 'carried') or confirmed_at is not null)
  ),
  constraint statements_disputed check ((disputed_at is null) = (dispute_reason is null) and (status <> 'disputed' or disputed_at is not null)),
  constraint statements_approved check (
    (status in ('in_payout', 'paid', 'settled', 'carried')) = (approval_id is not null)
    and (approval_id is null) = (approved_at is null)
  ),
  -- 复核通过后：合计为正进付款批次，为 0 无需付款，为负转入下一期
  constraint statements_outcome_total check (
    (status not in ('in_payout', 'paid') or total_minor > 0)
    and (status <> 'settled' or total_minor = 0)
    and (status <> 'carried' or total_minor < 0)
  ),
  constraint statements_payout check ((status in ('in_payout', 'paid')) = (payout_batch_id is not null) and (payout_batch_id is null) = (payout_on is null)),
  constraint statements_paid check ((status = 'paid') = (paid_at is not null)),
  constraint statements_void check ((status = 'void') = (voided_at is not null) and (voided_at is null) = (void_reason is null) and (voided_at is null) = (voided_by is null)),
  constraint statements_text check ((dispute_reason is null or char_length(dispute_reason) between 1 and 500) and (void_reason is null or char_length(void_reason) between 1 and 500)),
  constraint statements_version_positive check (version >= 1)
);

-- 同一个供应商、同一期、同一种币种只有一张有效的账单（作废的不算）：生成反复运行、几个实例同时跑都只出一张
create unique index statements_current_key on statements (tenant_id, period, currency) where status <> 'void';
-- 供应商自己的账单列表
create index statements_tenant_idx on statements (tenant_id, period desc, created_at desc, id);
-- 账单号全平台唯一（不以 tenant_id 开头的例外：唯一性本来就是跨供应商的）
create unique index statements_no_key on statements (statement_no);
-- 确认期满自动确认：定时任务跨供应商扫（不以 tenant_id 开头的例外）
create index statements_confirm_due_idx on statements (confirm_due_at) where status = 'issued';
-- 运营后台跨供应商的账单列表（按出账时间）、付款批次里的账单（不以 tenant_id 开头的例外）
create index statements_platform_idx on statements (created_at desc, id desc);
create index statements_batch_idx on statements (payout_batch_id) where payout_batch_id is not null;

alter table statements enable row level security;
create policy statements_same_tenant on statements for select to nozomi_app using (tenant_id = app_tenant_id());
create policy statements_platform on statements to nozomi_platform using (true) with check (true);
grant select on statements to nozomi_app;
grant select, insert, update on statements to nozomi_platform;

-- ---- 账单明细（租户表，供应商只读）：每一笔应付一行，只有供应商那一侧的金额（结算价、供应商应得、加收报的金额、应扣款项），没有对外价和加价比例 ----

create table statement_lines (
  tenant_id uuid not null references tenants (id),
  id uuid not null default gen_random_uuid(),
  statement_id uuid not null,
  -- @nozomi/domain 的 STATEMENT_LINE_KINDS
  kind text not null,
  -- 这一笔应付是什么（order:<订单编号> / extra_charge:<加收编号> / deduction:<应扣款项编号> / deduction_waiver:<应扣款项编号> / carry:<上期账单编号>）：
  -- 一个供应商里同一时刻只能挂在一张有效的账单上（下面的唯一索引）
  source_key text not null,
  order_id uuid,
  order_no text,
  -- 订单的服务日期（城市当地日期）；上期结转没有
  service_date date,
  -- 服务日期早于这一期（往期调整：上一期出账时还没结案，或者账单作废后重出）
  prior_period boolean not null,
  -- 应付给供应商的方向：正数付给供应商，负数从应付里扣
  amount_minor bigint not null,
  currency text not null,
  -- 怎么来的（订单状态、取消扣款比例、加收类型、应扣款项的种类和依据……），只有供应商那一侧的数
  detail jsonb not null,
  created_at timestamptz not null,
  -- 账单作废时一起作废：这一笔应付释放，下次出账重新计入
  voided_at timestamptz,
  primary key (tenant_id, id),
  foreign key (tenant_id, statement_id) references statements (tenant_id, id),
  foreign key (tenant_id, order_id) references orders (tenant_id, id),
  constraint statement_lines_kind_check check (kind in ('order', 'no_show', 'cancellation', 'extra_charge', 'deduction', 'deduction_waiver', 'carry_forward')),
  constraint statement_lines_sign check (
    (kind in ('order', 'no_show', 'cancellation', 'extra_charge', 'deduction_waiver') and amount_minor > 0)
    or (kind in ('deduction', 'carry_forward') and amount_minor < 0)
  ),
  constraint statement_lines_order check ((kind = 'carry_forward') = (order_id is null) and (order_id is null) = (order_no is null) and (order_id is null) = (service_date is null)),
  constraint statement_lines_source_key check (source_key ~ '^(order|extra_charge|deduction|deduction_waiver|carry):[0-9a-f-]{36}$'),
  constraint statement_lines_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint statement_lines_detail check (jsonb_typeof(detail) = 'object')
);

-- 一笔应付同一时刻只在一张有效的账单上：已出账的不会重复计入（并发出账也只有一个成功）
create unique index statement_lines_source_key on statement_lines (tenant_id, source_key) where voided_at is null;
create index statement_lines_statement_idx on statement_lines (tenant_id, statement_id);

alter table statement_lines enable row level security;
create policy statement_lines_same_tenant on statement_lines for select to nozomi_app using (tenant_id = app_tenant_id());
create policy statement_lines_platform on statement_lines to nozomi_platform using (true) with check (true);
grant select on statement_lines to nozomi_app;
grant select, insert, update on statement_lines to nozomi_platform;

-- 明细只追加：平台只能改「作废时间」（作废账单时），别的列出现在 update 语句里就拒绝（和没有权限一样，42501）
create trigger statement_lines_platform_columns
  before update of tenant_id, id, statement_id, kind, source_key, order_id, order_no, service_date, prior_period, amount_minor, currency, detail, created_at
  on statement_lines
  for each statement execute function reject_platform_column_update();

-- ---- 账单的经过（租户表，供应商只读）：出账、确认、异议、答复、作废、发起复核、复核通过、付款；只追加 ----

create table statement_events (
  tenant_id uuid not null references tenants (id),
  id uuid not null default gen_random_uuid(),
  seq bigint generated always as identity,
  statement_id uuid not null,
  action text not null,
  -- tenant_user / platform_user / system
  actor_type text not null,
  actor_id uuid,
  -- 异议原因、平台的答复、作废原因、复核说明
  note text,
  data jsonb not null,
  at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, statement_id) references statements (tenant_id, id),
  constraint statement_events_action_check check (action in ('issue', 'confirm', 'auto_confirm', 'dispute', 'reply', 'void', 'request_review', 'approve', 'pay')),
  constraint statement_events_actor check (actor_type in ('tenant_user', 'platform_user', 'system') and ((actor_type = 'system') = (actor_id is null))),
  constraint statement_events_note_length check (note is null or char_length(note) <= 500),
  constraint statement_events_data check (jsonb_typeof(data) = 'object')
);

create index statement_events_statement_idx on statement_events (tenant_id, statement_id, seq);

alter table statement_events enable row level security;
create policy statement_events_same_tenant on statement_events for select to nozomi_app using (tenant_id = app_tenant_id());
create policy statement_events_platform on statement_events to nozomi_platform using (true) with check (true);
grant select on statement_events to nozomi_app;
grant select, insert on statement_events to nozomi_platform;
