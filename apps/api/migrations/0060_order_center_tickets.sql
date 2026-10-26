-- M4-02：订单中心、异常队列、工单与赔付表（ADR 0034）。需求：《平台运营端与渠道对接》「订单中心与异常处理」（异常队列）、
-- 「客服与工单」（工单类型、流转、时效）、「履约保障与服务标准 · 客人赔付表」（统一赔付表，租户按结算价同比例承担）、「第五轮新增接口」（compensation-table）；
-- 第五轮决策 ⑥。编号说明：0047、0048、0050、0051、0055 段留给别的分支，本任务从 0060 起。
-- 只建结构和授权，不含任何数据（默认赔付表写在 @nozomi/domain，和取消政策同一种做法）。

-- ---- 赔付表：全平台一份，按版本追加（平台表）。还没有任何一行时用 domain 的默认表（需求原表，版本 0） ----

create table compensation_tables (
  version integer primary key,
  -- { customer_bp: { 每种情形: 基点 }, minimum_jpy, reimbursement_cap_bp, review_at_or_above_sell_bp }
  rules jsonb not null,
  approval_id uuid not null references approvals (id),
  requested_by uuid not null references platform_users (id),
  approved_by uuid not null references platform_users (id),
  created_at timestamptz not null,
  constraint compensation_tables_version_positive check (version >= 1),
  constraint compensation_tables_rules check (jsonb_typeof(rules) = 'object'),
  constraint compensation_tables_two_people check (approved_by <> requested_by)
);

grant select, insert on compensation_tables to nozomi_platform;

-- ---- 工单（租户表：和哪个供应商有关就带它的 tenant_id，供应商看得到、能回复；内部备注、客人那边的赔付金额在平台表） ----

create table tickets (
  tenant_id uuid not null references tenants (id),
  id uuid not null default gen_random_uuid(),
  -- 给人看的工单号：TK + 创建日期（UTC）+ 6 位随机字符，全平台唯一
  ticket_no text not null,
  -- @nozomi/domain 的 TICKET_TYPES
  type text not null,
  -- 谁提出的：guest 客人 / channel 渠道 / tenant 供应商 / platform 客服 / system 系统
  source text not null,
  -- 谁在系统里建的（客服代客人登记时来源是客人、建的人是客服）：platform_user / tenant_user / channel / guest / system
  created_by_type text not null,
  created_by uuid,
  -- 工单绑定订单（这个供应商的那一行；救援改派后原供应商的那一行仍可以被投诉）
  order_id uuid not null,
  -- 租户申诉：对哪一张工单的判定
  parent_ticket_id uuid,
  priority text not null,
  subject text not null,
  description text not null,
  -- 客人的语言（分派客服组用，可空）
  language text,
  -- @nozomi/domain 的 TICKET_STATUSES
  status text not null,
  assignee_id uuid references platform_users (id),
  assigned_at timestamptz,
  -- 时效：首次响应、结案的期限，首次响应的时间
  first_response_due_at timestamptz not null,
  first_responded_at timestamptz,
  resolution_due_at timestamptz not null,
  -- 征求租户意见：什么时候问的、期限（24 小时）、什么时候回复的
  tenant_reply_requested_at timestamptz,
  tenant_reply_due_at timestamptz,
  tenant_replied_at timestamptz,
  -- 判定：结论、责任方（投诉 / 履约失败成立时）、说明（供应商看得到）、谁判的；超过阈值时的双人复核
  outcome text,
  liable_party text,
  decision_note text,
  decided_at timestamptz,
  decided_by uuid references platform_users (id),
  approval_id uuid references approvals (id),
  closed_at timestamptz,
  closed_by uuid references platform_users (id),
  close_note text,
  version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, order_id) references orders (tenant_id, id),
  foreign key (tenant_id, parent_ticket_id) references tickets (tenant_id, id),
  constraint tickets_ticket_no_format check (ticket_no ~ '^TK[0-9]{8}[0-9A-HJ-NP-Z]{6}$'),
  constraint tickets_type_check check (type in ('complaint', 'no_show_review', 'fulfilment_failure', 'order_change', 'lost_and_found', 'tenant_appeal', 'other')),
  constraint tickets_source_check check (source in ('guest', 'channel', 'tenant', 'platform', 'system')),
  constraint tickets_created_by check (
    created_by_type in ('platform_user', 'tenant_user', 'channel', 'guest', 'system')
    and ((created_by_type in ('platform_user', 'tenant_user')) = (created_by is not null))
  ),
  constraint tickets_appeal check ((type = 'tenant_appeal') = (parent_ticket_id is not null) and parent_ticket_id is distinct from id),
  constraint tickets_priority_check check (priority in ('urgent', 'high', 'normal', 'low')),
  constraint tickets_text check (char_length(subject) between 1 and 200 and char_length(description) between 1 and 4000 and (language is null or char_length(language) between 2 and 10)),
  constraint tickets_status_check check (status in ('open', 'awaiting_tenant', 'in_progress', 'pending_review', 'decided', 'closed')),
  constraint tickets_assigned check ((assignee_id is null) = (assigned_at is null)),
  constraint tickets_tenant_reply check (
    (tenant_reply_requested_at is null) = (tenant_reply_due_at is null)
    and (status <> 'awaiting_tenant' or tenant_reply_due_at is not null)
  ),
  constraint tickets_outcome check (
    (outcome is null or outcome in ('upheld', 'rejected', 'approved', 'resolved'))
    and (liable_party is null or (liable_party in ('tenant', 'platform') and outcome = 'upheld'))
    and (decision_note is null or char_length(decision_note) <= 1000)
  ),
  -- 判定了才有结论、时间、判定人；已判定的一定有结论；复核中的有复核编号
  constraint tickets_decided check (
    (outcome is null) = (decided_at is null)
    and (outcome is null) = (decided_by is null)
    and (status <> 'decided' or outcome is not null)
    and (status <> 'pending_review' or approval_id is not null)
  ),
  constraint tickets_closed check ((status = 'closed') = (closed_at is not null) and (closed_at is null or closed_by is not null) and (close_note is null or char_length(close_note) <= 1000)),
  constraint tickets_version_positive check (version >= 1)
);

-- 退款、赔付记录、内部备注按工单编号指向工单（跨租户唯一；不以 tenant_id 开头的例外，结构测试登记）
create unique index tickets_id_key on tickets (id);
-- 工单号全平台唯一（不以 tenant_id 开头的例外）
create unique index tickets_ticket_no_key on tickets (ticket_no);
-- 一张判定只能申诉一次
create unique index tickets_appeal_once_key on tickets (tenant_id, parent_ticket_id) where parent_ticket_id is not null;
-- 一个 no-show 申请只有一张审核工单
create unique index tickets_no_show_review_key on tickets (tenant_id, order_id) where type = 'no_show_review';
-- 供应商后台的工单列表、订单详情里的工单
create index tickets_tenant_idx on tickets (tenant_id, created_at desc, id desc);
create index tickets_order_idx on tickets (tenant_id, order_id, created_at);
-- 运营后台的工单队列：跨租户按状态、创建时间（不以 tenant_id 开头的例外）
create index tickets_queue_idx on tickets (status, created_at desc, id desc);

alter table tickets enable row level security;
-- 供应商只读和自己有关的工单；回复、申诉在平台事务里做（要改工单的状态，租户编号只来自令牌）
create policy tickets_same_tenant on tickets for select to nozomi_app using (tenant_id = app_tenant_id());
create policy tickets_platform on tickets to nozomi_platform using (true) with check (true);
grant select on tickets to nozomi_app;
grant select, insert, update on tickets to nozomi_platform;

-- 工单里和供应商来回的对话（租户表：供应商看得到全部；内部备注不在这里，在平台表 ticket_notes）。只追加
create table ticket_messages (
  tenant_id uuid not null references tenants (id),
  id uuid not null default gen_random_uuid(),
  seq bigint generated always as identity,
  ticket_id uuid not null,
  -- platform_user 客服 / tenant_user 供应商 / channel 渠道 / guest 客人 / system 系统
  author_type text not null,
  author_id uuid,
  body text not null,
  -- 作为证据引用的订单照片（order_files 的编号，同一张单的）
  file_ids uuid[] not null default '{}',
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, ticket_id) references tickets (tenant_id, id),
  constraint ticket_messages_author check (author_type in ('platform_user', 'tenant_user', 'channel', 'guest', 'system') and ((author_type in ('platform_user', 'tenant_user')) = (author_id is not null))),
  constraint ticket_messages_body check (char_length(body) between 1 and 4000 and cardinality(file_ids) <= 10)
);

create index ticket_messages_ticket_idx on ticket_messages (tenant_id, ticket_id, seq);

alter table ticket_messages enable row level security;
create policy ticket_messages_same_tenant on ticket_messages for select to nozomi_app using (tenant_id = app_tenant_id());
create policy ticket_messages_platform on ticket_messages to nozomi_platform using (true) with check (true);
grant select on ticket_messages to nozomi_app;
grant select, insert on ticket_messages to nozomi_platform;

-- 内部备注（平台表：供应商、渠道都看不到）。只追加
create table ticket_notes (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  ticket_id uuid not null references tickets (id),
  author_id uuid not null references platform_users (id),
  body text not null,
  created_at timestamptz not null,
  constraint ticket_notes_body check (char_length(body) between 1 and 4000)
);

create index ticket_notes_ticket_idx on ticket_notes (ticket_id, seq);

grant select, insert on ticket_notes to nozomi_platform;

-- 一张工单判定的赔付（平台表：客人那边的金额——对外价、赔给客人的、退款和另付——租户碰不到，规则 4）。
-- 供应商承担的部分记在 tenant_deductions（结算币种，供应商看得到）
create table ticket_compensations (
  ticket_id uuid primary key references tickets (id),
  order_id uuid not null,
  -- 被投诉的供应商（工单的 tenant_id）
  supplier_tenant_id uuid not null,
  -- @nozomi/domain 的 COMPENSATION_SCENARIOS；责任方
  scenario text not null,
  liable_party text not null,
  -- 用的赔付表版本、比例
  table_version integer not null,
  customer_bp integer not null,
  -- 客人支付的币种、判定时的对外价
  currency text not null,
  sell_minor bigint not null,
  ratio_minor bigint not null,
  downgrade_difference_minor bigint not null,
  -- 每笔最低额（客人支付币种）和换算用的汇率（JPY → 客人支付币种，判定时汇率中心的；JPY 为 null）
  minimum_minor bigint not null,
  minimum_fx jsonb,
  topped_up boolean not null,
  compensation_minor bigint not null,
  reimbursement_claimed_minor bigint not null,
  reimbursement_cap_minor bigint not null,
  reimbursement_minor bigint not null,
  -- 怎么付：从这一单的收款里退（order_refunds 里 purpose = compensation 的几笔）；退不回去的由财务另付后登记
  refund_minor bigint not null,
  manual_payout_minor bigint not null,
  -- 司机未到：判定时按「供应商原因」取消了订单（全额退款走取消）
  order_cancelled boolean not null,
  -- 另付：none 不用另付 / pending 待财务支付 / paid 已付（登记了凭证号）
  payout_status text not null,
  payout_reference text,
  paid_at timestamptz,
  paid_by uuid references platform_users (id),
  -- 供应商承担的合计（它的结算币种），明细在 tenant_deductions
  tenant_currency text not null,
  tenant_total_minor bigint not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  foreign key (supplier_tenant_id, order_id) references orders (tenant_id, id),
  constraint ticket_compensations_scenario_check check (scenario in ('late_15_29', 'late_30_plus', 'driver_no_show', 'vehicle_downgrade', 'no_signboard', 'not_delivered', 'service_complaint')),
  constraint ticket_compensations_liable_check check (liable_party in ('tenant', 'platform')),
  constraint ticket_compensations_amounts check (
    table_version >= 0 and customer_bp between 0 and 10000 and sell_minor > 0
    and ratio_minor >= 0 and downgrade_difference_minor >= 0 and minimum_minor >= 0 and compensation_minor >= 0
    and reimbursement_claimed_minor >= 0 and reimbursement_cap_minor >= 0 and reimbursement_minor between 0 and reimbursement_cap_minor
    and refund_minor >= 0 and manual_payout_minor >= 0 and tenant_total_minor >= 0
    and (liable_party = 'tenant' or tenant_total_minor = 0)
  ),
  constraint ticket_compensations_payout check (
    payout_status in ('none', 'pending', 'paid')
    and ((payout_status = 'none') = (manual_payout_minor = 0))
    and ((payout_status = 'paid') = (paid_at is not null))
    and (paid_at is null) = (paid_by is null)
    and (paid_at is null) = (payout_reference is null)
    and (payout_reference is null or char_length(payout_reference) between 1 and 200)
  )
);

create index ticket_compensations_payout_idx on ticket_compensations (payout_status, created_at) where payout_status = 'pending';

grant select, insert, update on ticket_compensations to nozomi_platform;

-- ---- 退款：赔付也从这一单的收款里退（ADR 0029 的退款机制） ----

alter table order_refunds add column ticket_id uuid references tickets (id);
alter table order_refunds drop constraint order_refunds_purpose_check;
alter table order_refunds add constraint order_refunds_purpose_check check (
  purpose in ('cancellation', 'change', 'compensation')
  and ((purpose = 'change') = (change_id is not null))
  and ((purpose = 'compensation') = (ticket_id is not null))
);

-- ---- 供应商应扣款项：赔付（结算价 × 同一比例、车型降级的差价）和替代交通报销（ADR 0031 的表，多两种来源是工单） ----

alter table tenant_deductions alter column rescue_id drop not null;
alter table tenant_deductions add column ticket_id uuid;
alter table tenant_deductions add constraint tenant_deductions_ticket_fk foreign key (tenant_id, ticket_id) references tickets (tenant_id, id);
alter table tenant_deductions drop constraint tenant_deductions_kind_check;
alter table tenant_deductions add constraint tenant_deductions_kind_check check (kind in ('penalty', 'rescue_difference', 'compensation', 'reimbursement'));
-- 违约金和救援差价来自救援，赔付和报销来自工单，二者有且只有一个
alter table tenant_deductions add constraint tenant_deductions_source check (
  (rescue_id is null) <> (ticket_id is null)
  and ((kind in ('penalty', 'rescue_difference')) = (rescue_id is not null))
);
-- 一张工单、一种款项只记一条
create unique index tenant_deductions_ticket_kind_key on tenant_deductions (tenant_id, ticket_id, kind) where ticket_id is not null;

-- ---- no-show 申请：平台审核的结论（ADR 0027 留给 M4-02） ----

alter table order_no_show_claims drop constraint order_no_show_claims_status_check;
alter table order_no_show_claims add constraint order_no_show_claims_status_check check (status in ('pending_review', 'approved', 'rejected'));
alter table order_no_show_claims
  add column decided_at timestamptz,
  add column decided_by uuid references platform_users (id),
  add constraint order_no_show_claims_decided check ((status = 'pending_review') = (decided_at is null) and (decided_at is null) = (decided_by is null));
-- 平台写审核结论：只许改结论的三列（触发器按语句检查）
create policy order_no_show_claims_platform_review on order_no_show_claims for update to nozomi_platform using (true) with check (true);
grant update on order_no_show_claims to nozomi_platform;
create trigger order_no_show_claims_platform_columns
  before update of tenant_id, order_id, submitted_at, checklist, free_wait_start, free_wait_end, link_id on order_no_show_claims
  for each statement execute function reject_platform_column_update();

-- ---- 履约事件：no-show 被驳回计入履约失败；申诉成立时撤销这张工单记下的事件（ADR 0028 的表） ----

alter table tenant_performance_events drop constraint tenant_performance_events_shape;
alter table tenant_performance_events add constraint tenant_performance_events_shape check (
  (kind in ('dispatch', 'arrival')) = (on_time is not null)
  and (kind = 'failure') = (failure_type is not null)
  and (failure_type is null or failure_type in ('rescue', 'driver_no_show', 'major_delay', 'no_show_rejected'))
  and (major = false or kind = 'complaint')
);
grant delete on tenant_performance_events to nozomi_platform;

-- ---- 异常队列（平台表：跨供应商；系统按触发条件生成，运营认领、关闭） ----

create table order_exceptions (
  id uuid primary key default gen_random_uuid(),
  -- @nozomi/domain 的 EXCEPTION_TYPES
  type text not null,
  -- 是哪一条记录引起的（订单、退款、加收、推送、收款、救援的编号，带前缀）：同一类、同一个来源只生成一次，关了不会再生成
  source_key text not null,
  order_id uuid not null,
  -- 这一单（那一行）的供应商
  supplier_tenant_id uuid not null,
  -- 发现时的情况：原因（支付异常的几种）、截止时间、金额、错误码等，按类型不同
  detail jsonb not null,
  status text not null,
  opened_at timestamptz not null,
  due_at timestamptz not null,
  assignee_id uuid references platform_users (id),
  claimed_at timestamptz,
  -- resolved 人工处理完（说明必填）/ cleared 条件已解除，系统关闭
  close_kind text,
  closed_at timestamptz,
  closed_by uuid references platform_users (id),
  resolution text,
  version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  foreign key (supplier_tenant_id, order_id) references orders (tenant_id, id),
  constraint order_exceptions_source_key unique (type, source_key),
  constraint order_exceptions_type_check check (type in ('dispatch_overdue', 'departure_overdue', 'arrival_overdue', 'push_failed', 'no_show_review', 'extra_charge_review', 'fulfilment_unfinished', 'payment_issue', 'rescue')),
  constraint order_exceptions_detail check (jsonb_typeof(detail) = 'object'),
  constraint order_exceptions_status_check check (status in ('open', 'claimed', 'closed')),
  constraint order_exceptions_due check (due_at >= opened_at),
  constraint order_exceptions_claimed check ((assignee_id is null) = (claimed_at is null) and (status <> 'claimed' or assignee_id is not null)),
  constraint order_exceptions_closed check (
    (status = 'closed') = (closed_at is not null)
    and (closed_at is null) = (close_kind is null)
    and (close_kind is null or close_kind in ('resolved', 'cleared'))
    and ((close_kind = 'resolved') = (closed_by is not null))
    and (close_kind <> 'resolved' or (resolution is not null and char_length(resolution) between 1 and 1000))
  ),
  constraint order_exceptions_version_positive check (version >= 1)
);

-- 队列：没关的按时限；订单详情里的异常
create index order_exceptions_queue_idx on order_exceptions (status, due_at, id);
create index order_exceptions_order_idx on order_exceptions (order_id, opened_at);

grant select, insert, update on order_exceptions to nozomi_platform;
