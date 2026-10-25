-- M3-03：取消、改单、事后加收（ADR 0029）。需求：《平台运营端与渠道对接》「履约保障与服务标准 · 平台统一取消政策」「改单补充」「服务后加收费用」、
-- 「客服与工单 · 客人修改订单规则」「订单中心 · 人工介入」（代取消、代改单）、「敏感操作双人复核」（人工退款超过阈值）、「财务结算 · 收款与付款」（取消和赔付的退款也走 Stripe）；
-- 《用车报价服务平台》「3. 商品 · ② 服务规则」（取消规则平台统一、租户只读；附加费支付）、「8. 订单与履约」（附加费用、修改单处理）；第五轮决策 ④⑤。
-- 编号说明：0029 留给 M1-15 之后的任务、0030 留给 M4-01，本任务从 0031 起。只建结构和授权，不写任何业务数据（取消政策的默认值是需求表里的规则，写在 @nozomi/domain 里，不进库）。

-- ---- 平台统一取消政策：全平台一份，按版本保存；运营改动走双人复核，批准后存一个新版本 ----

create table cancellation_policies (
  -- 1 起递增；还没有任何一行时用 @nozomi/domain 的默认政策（需求表，版本 0）
  version integer primary key,
  -- 每个「品类 × 车型级别」的阶梯：[{ category, level, tiers: [{ minHoursBefore, feeBp }] }]
  rules jsonb not null,
  approval_id uuid not null references approvals (id),
  requested_by uuid not null references platform_users (id),
  approved_by uuid not null references platform_users (id),
  created_at timestamptz not null,
  constraint cancellation_policies_version_positive check (version >= 1),
  constraint cancellation_policies_rules check (jsonb_typeof(rules) = 'array'),
  constraint cancellation_policies_two_people check (approved_by <> requested_by)
);

-- 平台：批准时追加新版本，不改不删。供应商后台的取消规则只读展示平台政策（和主数据一样，租户只读）
grant select, insert on cancellation_policies to nozomi_platform;
grant select on cancellation_policies to nozomi_app;

-- ---- 订单：下单时适用的取消阶梯、取消的扣款比例和供应商应得 ----

alter table orders
  -- 下单时这一单适用的阶梯（取消政策之后改了也不影响已经下了的单）：{ version, category, level, tiers }
  add column cancel_policy jsonb,
  -- 取消时落在哪一档的扣款比例（基点；免费的原因为 0）和供应商应得（结算币种 = 结算价 × 扣款比例）。客人那边的退款金额在平台表 order_refunds（规则 4）
  add column cancel_fee_bp integer,
  add column cancel_tenant_share_minor bigint,
  -- 运营代取消时写的原因说明
  add column cancel_note text,
  add constraint orders_cancel_policy_object check (cancel_policy is null or jsonb_typeof(cancel_policy) = 'object'),
  add constraint orders_cancel_fee check (
    (cancel_fee_bp is null) = (cancel_tenant_share_minor is null)
    and (cancel_fee_bp is null or (cancel_fee_bp between 0 and 10000 and cancel_tenant_share_minor >= 0 and status = 'cancelled'))
  ),
  add constraint orders_cancel_reason_check check (cancel_reason is null or cancel_reason in (
    'PAYMENT_TIMEOUT', 'PAYMENT_CANCELED', 'GUEST_REQUEST', 'CHANGE_NOT_CONFIRMED', 'FLIGHT_CANCELLED', 'FORCE_MAJEURE', 'SUPPLIER_FAULT', 'PLATFORM_FAULT'
  )),
  add constraint orders_cancel_note_length check (cancel_note is null or char_length(cancel_note) <= 500);

-- 供应商只能改派车和履约的列（0026）：新加的四列同样只有平台能改
drop trigger orders_tenant_columns on orders;
create trigger orders_tenant_columns
  before update of tenant_id, id, order_no, category, city_id, place_id, direction, product_id, product_version, vehicle_group_id, package_hours,
                   service_at, service_local, timezone, service_date, urgent, passengers, luggage, pickup, dropoff, addons, driver_language, flight_no,
                   passenger, messaging, notes, settlement_minor, settlement_currency, settlement, free_wait_minutes, inventory_held, payment_due_at,
                   confirmed_at, cancelled_at, cancel_reason, created_at, dispatch_due_at, dispatch_overdue_at, departure_overdue_at, guest_landed_at,
                   cancel_policy, cancel_fee_bp, cancel_tenant_share_minor, cancel_note
  on orders
  for each statement execute function reject_tenant_column_update();

-- ---- 订单的销售端一侧：改期后对外价按原加价比例重算，平台要改 sell_minor（只这一列） ----

grant update on order_sales to nozomi_platform;
create trigger order_sales_platform_columns
  before update of order_id, supplier_tenant_id, channel_id, api_client_id, quote_id, idempotency_key, request_hash, channel_order_no, currency, markup_bp, fx, fx_buffer_bp, created_at
  on order_sales
  for each statement execute function reject_platform_column_update();

-- ---- 改单：每次一行（改前改后对比、结算价的变化、要不要供应商确认）。租户表：供应商看得到改了什么 ----

create table order_changes (
  tenant_id uuid not null references tenants (id),
  id uuid not null default gen_random_uuid(),
  seq bigint generated always as identity,
  order_id uuid not null,
  -- @nozomi/domain 的 ORDER_CHANGE_STATUSES
  status text not null,
  -- 改了日期或时间（要重算价格，可能要供应商确认）
  reschedule boolean not null,
  -- 改了的字段改之前和改之后的值（只有这几个字段）
  before jsonb not null,
  after jsonb not null,
  -- 结算价改前改后（结算币种）；只改信息的单两者相同
  settlement_before_minor bigint not null,
  settlement_after_minor bigint not null,
  -- 改期后新的结算价明细（报价引擎重算的），生效时写进订单
  settlement_after jsonb,
  -- 要供应商确认的改期：最晚什么时候确认（提出后 30 分钟）
  confirm_due_at timestamptz,
  -- 谁提的：channel（渠道调接口）/ platform_user（运营代客人）
  requested_by text not null,
  requested_by_id uuid,
  requested_at timestamptz not null,
  -- 改期后原来派的司机或车辆在新的时段有别的单：提示供应商改派（需求「改时间后派车结果自动重新校验（冲突时提示改派）」）
  dispatch_conflict boolean not null default false,
  decided_at timestamptz,
  -- 供应商确认 / 拒绝的人
  decided_by uuid,
  decision_note text,
  primary key (tenant_id, id),
  foreign key (tenant_id, order_id) references orders (tenant_id, id),
  foreign key (tenant_id, decided_by) references tenant_users (tenant_id, id),
  constraint order_changes_status_check check (status in ('awaiting_payment', 'pending_confirmation', 'applied', 'rejected', 'expired', 'failed', 'cancelled')),
  constraint order_changes_json check (jsonb_typeof(before) = 'object' and jsonb_typeof(after) = 'object' and (settlement_after is null or jsonb_typeof(settlement_after) = 'object')),
  constraint order_changes_amounts check (settlement_before_minor > 0 and settlement_after_minor > 0),
  constraint order_changes_requested_by_check check (requested_by in ('channel', 'platform_user') and ((requested_by = 'platform_user') = (requested_by_id is not null))),
  constraint order_changes_confirm check ((status = 'pending_confirmation') <= (confirm_due_at is not null)),
  constraint order_changes_reschedule_settlement check (reschedule = (settlement_after is not null)),
  constraint order_changes_decided check ((status in ('applied', 'rejected', 'expired', 'failed', 'cancelled')) = (decided_at is not null)),
  constraint order_changes_note_length check (decision_note is null or char_length(decision_note) <= 500)
);

-- 一张单同时只能有一个没有结论的改单（并发改单时后到的在这里失败）
create unique index order_changes_open_key on order_changes (tenant_id, order_id) where status in ('awaiting_payment', 'pending_confirmation');
create index order_changes_order_idx on order_changes (tenant_id, order_id, seq);
-- 30 分钟没确认的改期：定时任务跨租户扫（不以 tenant_id 开头的例外：定时任务不分租户）
create index order_changes_confirm_due_idx on order_changes (confirm_due_at) where status = 'pending_confirmation';

alter table order_changes enable row level security;
create policy order_changes_same_tenant on order_changes for select to nozomi_app using (tenant_id = app_tenant_id());
-- 平台：渠道和运营改单、供应商确认改期（生效要改用车时间和结算价，只有平台能改这些列）、定时任务记超时
create policy order_changes_platform on order_changes to nozomi_platform using (true) with check (true);
grant select on order_changes to nozomi_app;
grant select, insert, update on order_changes to nozomi_platform;

-- 改期的对外价改前改后（客人支付币种）：平台表，租户碰不到（规则 4）
create table order_change_sales (
  change_id uuid primary key,
  order_id uuid not null,
  supplier_tenant_id uuid not null,
  currency text not null,
  sell_before_minor bigint not null,
  sell_after_minor bigint not null,
  foreign key (supplier_tenant_id, change_id) references order_changes (tenant_id, id),
  foreign key (supplier_tenant_id, order_id) references orders (tenant_id, id),
  constraint order_change_sales_amounts check (sell_before_minor > 0 and sell_after_minor > 0)
);

grant select, insert on order_change_sales to nozomi_platform;

-- ---- 事后加收：供应商在服务结束 24 小时内提交，48 小时异议期，平台审核（需要时）后用保存的支付方式扣款 ----

create table order_extra_charges (
  tenant_id uuid not null references tenants (id),
  id uuid not null default gen_random_uuid(),
  seq bigint generated always as identity,
  order_id uuid not null,
  -- @nozomi/domain 的 EXTRA_CHARGE_TYPES
  type text not null,
  -- 供应商报的金额（结算币种）：客人付的是它 × 汇率 × (1 + 缓冲) × (1 + 加价比例)，扣款时算、记在 order_payments
  amount_minor bigint not null,
  currency text not null,
  description text,
  -- 凭证照片（order_files 里这一单的 receipt）
  file_ids uuid[] not null default '{}',
  -- @nozomi/domain 的 EXTRA_CHARGE_STATUSES
  status text not null,
  -- 要转人工审核的原因：OVER_THRESHOLD 超过对外价 50% / NO_EVIDENCE 没有凭证 / DISPUTED 客人提了异议
  review_reasons text[] not null default '{}',
  submitted_at timestamptz not null,
  submitted_by uuid not null,
  -- 异议期截止（提交 + 48 小时）：到这一刻起不能再提异议，没异议的可以扣款
  dispute_until timestamptz not null,
  disputed_at timestamptz,
  dispute_reason text,
  -- 平台审核：谁、什么时候、通过的金额（部分通过时比提交的少）、说明
  decided_at timestamptz,
  decided_by uuid references platform_users (id),
  approved_minor bigint,
  decision_note text,
  -- 扣款：试了几次、下一次什么时候（收款服务出错时自动重试）、最近一次失败的原因、扣到的时间
  charge_attempts integer not null default 0,
  next_charge_at timestamptz,
  last_charge_error jsonb,
  charged_at timestamptz,
  withdrawn_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, order_id) references orders (tenant_id, id),
  foreign key (tenant_id, submitted_by) references tenant_users (tenant_id, id),
  constraint order_extra_charges_type_check check (type in ('charter_overtime', 'charter_over_km', 'waiting', 'extra_stop', 'extra_addon', 'toll', 'parking')),
  constraint order_extra_charges_status_check check (status in ('in_window', 'review', 'disputed', 'approved', 'charging', 'charged', 'charge_failed', 'rejected', 'withdrawn')),
  constraint order_extra_charges_amount check (amount_minor > 0 and (approved_minor is null or approved_minor between 1 and amount_minor)),
  constraint order_extra_charges_reasons check (review_reasons <@ array['OVER_THRESHOLD', 'NO_EVIDENCE', 'DISPUTED']::text[]),
  constraint order_extra_charges_files check (cardinality(file_ids) <= 5),
  constraint order_extra_charges_window check (dispute_until > submitted_at),
  constraint order_extra_charges_disputed check ((disputed_at is null) = (dispute_reason is null) and (disputed_at is null or disputed_at < dispute_until)),
  constraint order_extra_charges_decided check ((decided_at is null) = (decided_by is null) and (status <> 'rejected' or decided_at is not null)),
  constraint order_extra_charges_charged check ((status = 'charged') = (charged_at is not null)),
  constraint order_extra_charges_withdrawn check ((status = 'withdrawn') = (withdrawn_at is not null)),
  constraint order_extra_charges_attempts check (charge_attempts >= 0),
  constraint order_extra_charges_text check ((description is null or char_length(description) <= 200) and (dispute_reason is null or char_length(dispute_reason) <= 500) and (decision_note is null or char_length(decision_note) <= 500)),
  constraint order_extra_charges_version_positive check (version >= 1)
);

create index order_extra_charges_order_idx on order_extra_charges (tenant_id, order_id, seq);
-- 异议期到了的、等扣款的：定时任务跨租户扫（不以 tenant_id 开头的例外）
create index order_extra_charges_window_idx on order_extra_charges (dispute_until) where status = 'in_window';
create index order_extra_charges_charge_due_idx on order_extra_charges (next_charge_at) where status = 'approved';
-- 运营后台跨租户看待审核的（同上）
create index order_extra_charges_review_idx on order_extra_charges (submitted_at) where status in ('review', 'disputed', 'charge_failed');

alter table order_extra_charges enable row level security;
create policy order_extra_charges_same_tenant on order_extra_charges to nozomi_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());
create policy order_extra_charges_platform on order_extra_charges to nozomi_platform using (true) with check (true);
-- 供应商：提交、撤回（下面的触发器只许撤回）；平台：客人异议、审核、扣款
grant select, insert, update on order_extra_charges to nozomi_app;
grant select, update on order_extra_charges to nozomi_platform;

-- 供应商提交时只能是「异议期内」、没有审核和扣款的结果；之后只能把异议期内的撤回（改状态、撤回时间、版本），别的列和别的状态只有平台能改
create function guard_tenant_extra_charge() returns trigger
  language plpgsql
  as $$
begin
  if current_user <> 'nozomi_app' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'in_window' or new.decided_at is not null or new.approved_minor is not null or new.disputed_at is not null
       or new.charged_at is not null or new.charge_attempts <> 0 or new.next_charge_at is not null or new.withdrawn_at is not null then
      raise exception '供应商提交的加收只能是异议期内、没有审核和扣款结果的' using errcode = 'insufficient_privilege';
    end if;
  elsif new.status is distinct from old.status and not (old.status = 'in_window' and new.status = 'withdrawn') then
    raise exception '供应商不能把加收从 % 改成 %', old.status, new.status using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create trigger order_extra_charges_tenant_guard
  before insert or update on order_extra_charges
  for each row execute function guard_tenant_extra_charge();

create trigger order_extra_charges_tenant_columns
  before update of tenant_id, id, order_id, type, amount_minor, currency, description, file_ids, review_reasons, submitted_at, submitted_by, dispute_until,
                   disputed_at, dispute_reason, decided_at, decided_by, approved_minor, decision_note, charge_attempts, next_charge_at, last_charge_error, charged_at, created_at
  on order_extra_charges
  for each statement execute function reject_tenant_column_update();

-- ---- 收款：一单可以有几笔（下单付款、改期补收的差价、事后加收），后两种用保存的支付方式离线扣款 ----

drop index order_payments_order_kind_key;
create unique index order_payments_order_key on order_payments (order_id) where kind = 'order';
create index order_payments_order_idx on order_payments (order_id, created_at);

alter table order_payments drop constraint order_payments_kind_check;
alter table order_payments drop constraint order_payments_status_check;
alter table order_payments drop constraint order_payments_intent;
alter table order_payments
  add column change_id uuid,
  add column extra_charge_id uuid,
  add constraint order_payments_kind_check check (kind in ('order', 'change', 'extra_charge')),
  add constraint order_payments_purpose check ((kind = 'change') = (change_id is not null) and (kind = 'extra_charge') = (extra_charge_id is not null)),
  -- failed：离线扣款被拒（卡被拒、需要客人验证）；下单的付款没有这个状态（卡被拒后客人可以换卡重付，仍是 requires_payment）
  add constraint order_payments_status_check check (status in ('creating', 'requires_payment', 'processing', 'succeeded', 'canceled', 'failed') and (status <> 'failed' or kind <> 'order')),
  add constraint order_payments_intent check ((status <> 'creating' or intent_id is null) and (status in ('creating', 'canceled', 'failed') or intent_id is not null)),
  add foreign key (supplier_tenant_id, change_id) references order_changes (tenant_id, id),
  add foreign key (supplier_tenant_id, extra_charge_id) references order_extra_charges (tenant_id, id);

-- ---- 退款：每一笔发给收款服务的退款一行（取消、改期少了的差价、改期没确认退回补收的差价） ----

create table order_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  supplier_tenant_id uuid not null,
  -- 从哪一笔收款里退（收款服务的退款只能对着一笔付款）
  payment_id uuid not null references order_payments (id),
  -- cancellation 取消 / change 改单的差价
  purpose text not null,
  change_id uuid,
  amount_minor bigint not null,
  currency text not null,
  -- @nozomi/domain 的 REFUND_STATUSES
  status text not null,
  -- 收款服务里的退款编号（Stripe Refund）
  provider_refund_id text unique,
  attempts integer not null default 0,
  -- 下一次什么时候发；正在发时是租约到期的时间（进程中途退出时别的实例接着发，同一个幂等键不会退两次）
  next_attempt_at timestamptz,
  -- 最近一次失败的原因：{ code, message }
  last_error jsonb,
  succeeded_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  foreign key (supplier_tenant_id, order_id) references orders (tenant_id, id),
  foreign key (supplier_tenant_id, change_id) references order_changes (tenant_id, id),
  constraint order_refunds_purpose_check check (purpose in ('cancellation', 'change') and ((purpose = 'change') = (change_id is not null))),
  constraint order_refunds_status_check check (status in ('pending', 'processing', 'succeeded', 'failed')),
  constraint order_refunds_amount check (amount_minor > 0 and attempts >= 0),
  constraint order_refunds_schedule check ((status in ('pending', 'processing')) = (next_attempt_at is not null)),
  constraint order_refunds_succeeded check ((status = 'succeeded') = (succeeded_at is not null)),
  constraint order_refunds_failed check ((status = 'failed') = (failed_at is not null))
);

create index order_refunds_order_idx on order_refunds (order_id, created_at);
create index order_refunds_due_idx on order_refunds (next_attempt_at) where status in ('pending', 'processing');
create index order_refunds_failed_idx on order_refunds (failed_at desc) where status = 'failed';

grant select, insert, update on order_refunds to nozomi_platform;

-- ---- 凭证照片：供应商后台也能传（停车费、高速费的票据），司机 H5 照旧 ----

alter table order_files drop constraint order_files_kind_check;
alter table order_files
  alter column link_id drop not null,
  add column uploaded_by uuid,
  add constraint order_files_kind_check check (kind in ('arrival_screen', 'signboard', 'contact_screenshot', 'receipt')),
  -- 谁传的：司机链接，或供应商后台的用户（二选一）
  add constraint order_files_uploader check ((link_id is null) <> (uploaded_by is null)),
  add foreign key (tenant_id, uploaded_by) references tenant_users (tenant_id, id);
