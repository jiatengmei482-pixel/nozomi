-- M4-01：供应商入驻、资质审核、合同、状态机、履约评分（ADR 0028）。
-- 需求：《平台运营端与渠道对接》「租户管理」（状态表、资质审核、合同与结算条款、履约评分、租户详情页）、「履约保障与服务标准」（救援、司机未到计入评分）、
-- 「数据模型」tenant_contract、tenant_score_daily；《用车报价服务平台》「12. 资质认证」、数据模型 company_document。
-- 编号说明：0025–0028 是 M3-02（派车、司机 H5、租户 Webhook），0029、0030 未使用，0031、0032 是 M3-03（已先在测试环境执行），本任务用 0033。
-- 只建结构和授权，不含任何业务数据。已有的两种状态原样保留：active（正式）照旧参与比价；suspended（暂停）补上「暂停前是正式」和「人工暂停」这一个原因。

-- ---- 供应商主体：完整的状态、暂停和观察的原因、评分的最新结果 ----

alter table tenants drop constraint tenants_status_check;

alter table tenants
  -- 暂停之前的状态（恢复时回到它）：只有暂停中的有
  add column suspended_from text,
  -- 暂停的原因（可以同时几个，全部消除才恢复）：manual / document_expired / score_below_red_line / driver_no_show
  add column suspension_reasons text[] not null default '{}',
  add column suspended_at timestamptz,
  -- 观察期的原因（空 = 不在观察期）：score_below_threshold / driver_no_show。每天重算
  add column observation_reasons text[] not null default '{}',
  add column observation_since timestamptz,
  add column signed_at timestamptz,
  add column trial_started_at timestamptz,
  add column activated_at timestamptz,
  add column terminated_at timestamptz,
  -- 最近一次每日评分的结果：比价用的分（百分之一分）、按数据算出的分、近 90 天完成订单数、近 30 天司机未到次数、算的是哪一天
  add column score_centi integer,
  add column score_raw_centi integer,
  add column score_completed_orders integer not null default 0,
  add column score_no_shows integer not null default 0,
  add column score_on date,
  -- 每日检查（资质到期、评分、自动转换）做到了哪一天：定时任务按它找还没做今天的供应商
  add column evaluated_on date,
  add column version integer not null default 1;

update tenants set suspended_from = 'active', suspension_reasons = '{manual}', suspended_at = updated_at where status = 'suspended';

alter table tenants
  add constraint tenants_status_check check (status in ('applying', 'reviewing', 'signed', 'trial', 'active', 'suspended', 'terminated')),
  add constraint tenants_suspension check (
    (status = 'suspended') = (suspended_from is not null)
    and (status = 'suspended') = (suspended_at is not null)
    and (status = 'suspended') = (cardinality(suspension_reasons) > 0)
    and (suspended_from is null or suspended_from in ('trial', 'active'))
    and suspension_reasons <@ array['manual', 'document_expired', 'score_below_red_line', 'driver_no_show']::text[]
  ),
  add constraint tenants_observation check (
    observation_reasons <@ array['score_below_threshold', 'driver_no_show']::text[]
    and (cardinality(observation_reasons) > 0) = (observation_since is not null)
  ),
  add constraint tenants_score check (
    (score_centi is null or score_centi between 0 and 500) and (score_raw_centi is null or score_raw_centi between 0 and 500)
    and score_completed_orders >= 0 and score_no_shows >= 0
  ),
  add constraint tenants_terminated check ((status = 'terminated') = (terminated_at is not null)),
  add constraint tenants_version_positive check (version >= 1);

-- 定时任务：按「还没做今天的检查」跨供应商扫（不以租户编号开头的例外：本来就是全体供应商）
create index tenants_evaluated_idx on tenants (evaluated_on, id);

-- ---- 企业信息（提交审核前要填齐）----

create table tenant_profiles (
  tenant_id uuid primary key references tenants (id),
  country_code text,
  legal_name text,
  registration_no text,
  address text,
  contact_name text,
  contact_phone text,
  contact_email text,
  version integer not null default 1,
  updated_at timestamptz not null,
  constraint tenant_profiles_country_format check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  constraint tenant_profiles_lengths check (
    coalesce(char_length(legal_name), 0) <= 200 and coalesce(char_length(registration_no), 0) <= 100 and coalesce(char_length(address), 0) <= 300
    and coalesce(char_length(contact_name), 0) <= 100 and coalesce(char_length(contact_phone), 0) <= 40 and coalesce(char_length(contact_email), 0) <= 254
  ),
  constraint tenant_profiles_version_positive check (version >= 1)
);

alter table tenant_profiles enable row level security;
create policy tenant_profiles_same_tenant on tenant_profiles to nozomi_app using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
create policy tenant_profiles_platform_read on tenant_profiles for select to nozomi_platform using (true);
grant select, insert, update on tenant_profiles to nozomi_app;
grant select on tenant_profiles to nozomi_platform;

-- ---- 资质和合同的文件（存在库里，随数据库备份；ADR 0028「文件存在哪里」）----

create table tenant_files (
  tenant_id uuid not null references tenants (id),
  id uuid not null default gen_random_uuid(),
  -- document：供应商上传的资质；contract：运营上传的合同扫描件
  purpose text not null,
  -- 按文件开头的字节认出来的格式，不信请求里声明的
  content_type text not null,
  byte_size integer not null,
  sha256 text not null,
  data bytea not null,
  file_name text not null,
  uploaded_at timestamptz not null,
  -- 谁传的：tenant_user / platform_user，以及账号编号
  uploaded_by_type text not null,
  uploaded_by uuid not null,
  primary key (tenant_id, id),
  constraint tenant_files_purpose_check check (purpose in ('document', 'contract')),
  constraint tenant_files_content_type_check check (content_type in ('application/pdf', 'image/jpeg', 'image/png')),
  constraint tenant_files_size check (byte_size between 1 and 10485760 and byte_size = octet_length(data)),
  constraint tenant_files_sha256_format check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint tenant_files_name_length check (char_length(file_name) between 1 and 200),
  constraint tenant_files_uploader_check check (uploaded_by_type in ('tenant_user', 'platform_user'))
);

create index tenant_files_uploaded_idx on tenant_files (tenant_id, uploaded_at);

alter table tenant_files enable row level security;
create policy tenant_files_same_tenant on tenant_files to nozomi_app using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
create policy tenant_files_platform on tenant_files to nozomi_platform using (true) with check (true);
grant select, insert on tenant_files to nozomi_app;
grant select, insert on tenant_files to nozomi_platform;

-- ---- 资质（每次提交一行；同一类型新的在后，审核通过的最新一份是现在生效的）----

create table tenant_documents (
  tenant_id uuid not null references tenants (id),
  id uuid not null default gen_random_uuid(),
  -- 提交的先后（同一时刻提交的也分得出先后）：同一类型里序号大的是新的
  seq bigint generated always as identity,
  doc_type text not null,
  file_id uuid not null,
  -- 到期日（到期当天起不算有效）；没有到期日的证件为空
  expires_on date,
  note text,
  -- pending 审核中 / approved 通过 / rejected 驳回 / supplement_requested 要求补充 / superseded 被同类型新通过的一份取代
  status text not null,
  submitted_at timestamptz not null,
  submitted_by uuid not null,
  reviewed_at timestamptz,
  reviewed_by uuid references platform_users (id),
  review_reason text,
  -- 已经发过的到期提醒（30、7 天）和到期通知
  reminders_sent integer[] not null default '{}',
  expired_notified boolean not null default false,
  primary key (tenant_id, id),
  foreign key (tenant_id, file_id) references tenant_files (tenant_id, id),
  foreign key (tenant_id, submitted_by) references tenant_users (tenant_id, id),
  constraint tenant_documents_file_once unique (tenant_id, file_id),
  constraint tenant_documents_type_check check (doc_type in ('commercial_registration', 'business_license', 'passenger_transport_license', 'passenger_liability_insurance', 'vehicle_insurance', 'settlement_account', 'other')),
  constraint tenant_documents_status_check check (status in ('pending', 'approved', 'rejected', 'supplement_requested', 'superseded')),
  constraint tenant_documents_reviewed check ((status = 'pending') = (reviewed_at is null) and (reviewed_at is null) = (reviewed_by is null)),
  constraint tenant_documents_reason check ((status in ('rejected', 'supplement_requested')) <= (review_reason is not null) and coalesce(char_length(review_reason), 0) <= 500 and coalesce(char_length(note), 0) <= 500)
);

create index tenant_documents_type_idx on tenant_documents (tenant_id, doc_type, seq);
-- 审核队列：跨供应商找待审核的（不以租户编号开头的例外：队列本来就不分供应商）
create index tenant_documents_pending_idx on tenant_documents (seq) where status = 'pending';

alter table tenant_documents enable row level security;
create policy tenant_documents_same_tenant on tenant_documents to nozomi_app using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
create policy tenant_documents_platform on tenant_documents to nozomi_platform using (true) with check (true);
-- 供应商只能提交和查看，不能改（审核结论只有平台能写）
grant select, insert on tenant_documents to nozomi_app;
grant select, update on tenant_documents to nozomi_platform;

-- ---- 合同版本（双人复核批准后写入；不改不删，新条款就是新版本）----

create table tenant_contracts (
  tenant_id uuid not null references tenants (id),
  id uuid not null default gen_random_uuid(),
  version integer not null,
  valid_from date not null,
  settle_currency text not null,
  -- 已确认的固定条款：月结、次月 20 日付款、平台不收服务费、不收保证金
  settle_cycle text not null,
  payment_day integer not null,
  file_id uuid,
  note text,
  approval_id uuid not null references approvals (id),
  requested_by uuid not null references platform_users (id),
  approved_by uuid not null references platform_users (id),
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, file_id) references tenant_files (tenant_id, id),
  constraint tenant_contracts_version_key unique (tenant_id, version),
  constraint tenant_contracts_valid_from_key unique (tenant_id, valid_from),
  constraint tenant_contracts_version_positive check (version >= 1),
  constraint tenant_contracts_currency_format check (settle_currency ~ '^[A-Z]{3}$'),
  constraint tenant_contracts_terms check (settle_cycle = 'monthly' and payment_day between 1 and 28),
  constraint tenant_contracts_two_people check (approved_by <> requested_by),
  constraint tenant_contracts_note_length check (coalesce(char_length(note), 0) <= 500)
);

alter table tenant_contracts enable row level security;
create policy tenant_contracts_same_tenant on tenant_contracts for select to nozomi_app using (tenant_id = app_tenant_id());
create policy tenant_contracts_platform on tenant_contracts to nozomi_platform using (true) with check (true);
grant select on tenant_contracts to nozomi_app;
grant select, insert on tenant_contracts to nozomi_platform;

-- ---- 状态变更记录（每次状态、暂停原因、观察期变化一行；只追加）----

create table tenant_status_events (
  tenant_id uuid not null references tenants (id),
  id uuid not null default gen_random_uuid(),
  seq bigint generated always as identity,
  -- 哪个动作：submit / return / sign / start_trial / promote / suspend / resume / terminate / observation
  trigger text not null,
  from_status text not null,
  to_status text not null,
  suspension_before text[] not null,
  suspension_after text[] not null,
  observation_before text[] not null,
  observation_after text[] not null,
  -- 谁：tenant_user / platform_user / system
  actor_type text not null,
  actor_id uuid,
  -- 说明（人工暂停、清退的原因，测试单的说明，驳回的原因……）
  note text,
  approval_id uuid references approvals (id),
  occurred_at timestamptz not null,
  primary key (tenant_id, id),
  constraint tenant_status_events_trigger_check check (trigger in ('submit', 'return', 'sign', 'start_trial', 'promote', 'suspend', 'resume', 'terminate', 'observation')),
  constraint tenant_status_events_actor_check check (actor_type in ('tenant_user', 'platform_user', 'system') and (actor_type = 'system') = (actor_id is null)),
  constraint tenant_status_events_note_length check (coalesce(char_length(note), 0) <= 500)
);

create index tenant_status_events_tenant_idx on tenant_status_events (tenant_id, occurred_at, seq);

alter table tenant_status_events enable row level security;
create policy tenant_status_events_same_tenant on tenant_status_events for select to nozomi_app using (tenant_id = app_tenant_id());
create policy tenant_status_events_platform on tenant_status_events to nozomi_platform using (true) with check (true);
grant select on tenant_status_events to nozomi_app;
grant select, insert on tenant_status_events to nozomi_platform;

-- ---- 评分的输入：履约事件（每单每类一条；由派车、履约、救援、工单写入）和客人评价 ----

create table tenant_performance_events (
  tenant_id uuid not null references tenants (id),
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  -- dispatch：派车（on_time = 截止时间前派车）；arrival：到达上车点（on_time = 用车时间前到达）；
  -- complaint：成立的投诉（major = 重大投诉）；failure：履约失败（failure_type = rescue 救援改派 / driver_no_show 司机未到 / major_delay 重大迟到）
  kind text not null,
  on_time boolean,
  major boolean not null default false,
  failure_type text,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, order_id) references orders (tenant_id, id),
  constraint tenant_performance_events_once unique (tenant_id, order_id, kind),
  constraint tenant_performance_events_kind_check check (kind in ('dispatch', 'arrival', 'complaint', 'failure')),
  constraint tenant_performance_events_shape check (
    (kind in ('dispatch', 'arrival')) = (on_time is not null)
    and (kind = 'failure') = (failure_type is not null)
    and (failure_type is null or failure_type in ('rescue', 'driver_no_show', 'major_delay'))
    and (major = false or kind = 'complaint')
  )
);

create index tenant_performance_events_time_idx on tenant_performance_events (tenant_id, occurred_at);

alter table tenant_performance_events enable row level security;
create policy tenant_performance_events_same_tenant on tenant_performance_events for select to nozomi_app using (tenant_id = app_tenant_id());
create policy tenant_performance_events_platform on tenant_performance_events to nozomi_platform using (true) with check (true);
grant select on tenant_performance_events to nozomi_app;
grant select, insert on tenant_performance_events to nozomi_platform;

-- 客人评价（1–5 分，一单一条）。评价的入口在客人订单页（M3-05）；本任务只建表并接进评分
create table order_reviews (
  tenant_id uuid not null references tenants (id),
  order_id uuid not null,
  rating smallint not null,
  comment text,
  submitted_at timestamptz not null,
  primary key (tenant_id, order_id),
  foreign key (tenant_id, order_id) references orders (tenant_id, id),
  constraint order_reviews_rating check (rating between 1 and 5),
  constraint order_reviews_comment_length check (coalesce(char_length(comment), 0) <= 2000)
);

create index order_reviews_time_idx on order_reviews (tenant_id, submitted_at);

alter table order_reviews enable row level security;
create policy order_reviews_same_tenant on order_reviews for select to nozomi_app using (tenant_id = app_tenant_id());
create policy order_reviews_platform on order_reviews to nozomi_platform using (true) with check (true);
grant select on order_reviews to nozomi_app;
grant select, insert on order_reviews to nozomi_platform;

-- ---- 每日评分（每个供应商每天一行，保留全部历史：评分趋势）----

create table tenant_score_daily (
  tenant_id uuid not null references tenants (id),
  score_date date not null,
  window_from date not null,
  completed_orders integer not null,
  dispatch_on_time integer not null,
  dispatch_total integer not null,
  arrival_on_time integer not null,
  arrival_total integer not null,
  rating_sum integer not null,
  rating_count integer not null,
  upheld_complaints integer not null,
  failures integer not null,
  no_shows integer not null,
  raw_score_centi integer,
  score_centi integer not null,
  is_default boolean not null,
  computed_at timestamptz not null,
  primary key (tenant_id, score_date),
  constraint tenant_score_daily_counts check (
    completed_orders >= 0 and dispatch_on_time between 0 and dispatch_total and arrival_on_time between 0 and arrival_total
    and rating_sum >= 0 and rating_count >= 0 and upheld_complaints >= 0 and failures >= 0 and no_shows >= 0
  ),
  constraint tenant_score_daily_scores check ((raw_score_centi is null or raw_score_centi between 0 and 500) and score_centi between 0 and 500),
  constraint tenant_score_daily_window check (window_from <= score_date)
);

alter table tenant_score_daily enable row level security;
create policy tenant_score_daily_same_tenant on tenant_score_daily for select to nozomi_app using (tenant_id = app_tenant_id());
create policy tenant_score_daily_platform on tenant_score_daily to nozomi_platform using (true) with check (true);
grant select on tenant_score_daily to nozomi_app;
grant select, insert, update on tenant_score_daily to nozomi_platform;

-- ---- 给供应商的提醒（资质快到期、已过期、进入观察期、被暂停……；同一件事只提醒一次）----

create table tenant_notices (
  tenant_id uuid not null references tenants (id),
  id uuid not null default gen_random_uuid(),
  kind text not null,
  -- 同一件事只提醒一次：如 document_expiring:<证件编号>:30
  dedupe_key text not null,
  data jsonb not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  constraint tenant_notices_dedupe_key unique (tenant_id, dedupe_key),
  constraint tenant_notices_kind_check check (kind in ('document_expiring', 'document_expired', 'document_reviewed', 'status_changed', 'observation_started', 'observation_ended')),
  constraint tenant_notices_data check (jsonb_typeof(data) = 'object')
);

create index tenant_notices_created_idx on tenant_notices (tenant_id, created_at desc, id desc);

alter table tenant_notices enable row level security;
create policy tenant_notices_same_tenant on tenant_notices for select to nozomi_app using (tenant_id = app_tenant_id());
create policy tenant_notices_platform on tenant_notices to nozomi_platform using (true) with check (true);
grant select on tenant_notices to nozomi_app;
grant select, insert on tenant_notices to nozomi_platform;
