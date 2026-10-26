-- M3-04：救援改派与违约金（ADR 0031）。需求：《平台运营端与渠道对接》「履约保障与服务标准」（4 种触发情形、违约金阶梯 0 / 30% / 100%、救援差价、不可抗力、救援流程）、
-- 「订单中心 · 异常队列 / 人工介入能力」；第五轮决策 ①。编号说明：0033、0034 留给正在开发的别的分支，本任务用 0035。
-- 只建结构和授权，不含任何数据。

-- ---- 订单：原供应商的这一行在改派后变成「已转给救援供应商」，救援供应商另起一行（同一个订单编号） ----

alter table orders drop constraint orders_status_check;
alter table orders add constraint orders_status_check check (status in (
  'pending_payment', 'confirmed', 'assigned', 'departed', 'arrived', 'in_service', 'completed', 'no_show_claimed', 'no_show', 'cancelled', 'rescue_pending', 'rescued'
));

alter table orders
  -- 原供应商的这一行转给救援供应商的时间（只有「已转给救援供应商」的行有）
  add column rescued_at timestamptz,
  -- 系统发现「到点 15 分钟仍未到达」的时间（司机未到的提醒，进运营后台的救援队列，由运营判定是否联系不上）
  add column arrival_overdue_at timestamptz,
  -- 客人在订单页报告「司机没到」的时间（同样进救援队列，由运营判定）
  add column driver_missing_reported_at timestamptz,
  add constraint orders_rescued_at check ((status = 'rescued') = (rescued_at is not null));

-- 一个订单编号在 orders 里可以有几行（原供应商、救援供应商各一行，主键是 tenant_id + id），但「现在的」只有一行：
-- 已转给救援供应商的行不算。订单号同理（原供应商看到的还是同一个订单号）。
-- 两个索引都不以 tenant_id 开头（唯一性本来就是跨供应商的；结构测试登记）
drop index orders_order_no_key;
create unique index orders_order_no_key on orders (order_no) where status <> 'rescued';
create unique index orders_current_key on orders (id) where status <> 'rescued';

-- 司机未到的提醒：跨租户扫到点 15 分钟还没到达的单（不以 tenant_id 开头的例外：定时任务不分租户）
create index orders_arrival_due_idx on orders (service_at) where status in ('confirmed', 'assigned', 'departed') and arrival_overdue_at is null;

-- 用车前 6 小时仍未派车的自动救援：跨租户扫快到用车时间、还没派车的单（不以 tenant_id 开头的例外）
create index orders_rescue_due_idx on orders (service_at) where status = 'confirmed';

-- 新加的三列只有平台能改（供应商只能改派车和履约的列，0026 / 0031）
drop trigger orders_tenant_columns on orders;
create trigger orders_tenant_columns
  before update of tenant_id, id, order_no, category, city_id, place_id, direction, product_id, product_version, vehicle_group_id, package_hours,
                   service_at, service_local, timezone, service_date, urgent, passengers, luggage, pickup, dropoff, addons, driver_language, flight_no,
                   passenger, messaging, notes, settlement_minor, settlement_currency, settlement, free_wait_minutes, inventory_held, payment_due_at,
                   confirmed_at, cancelled_at, cancel_reason, created_at, dispatch_due_at, dispatch_overdue_at, departure_overdue_at, guest_landed_at,
                   cancel_policy, cancel_fee_bp, cancel_tenant_share_minor, cancel_note, rescued_at, arrival_overdue_at, driver_missing_reported_at
  on orders
  for each statement execute function reject_tenant_column_update();

-- 进入救援时原来的司机链接立即作废（原供应商不能再操作这一单）
alter table driver_links drop constraint driver_links_revoked;
alter table driver_links add constraint driver_links_revoked check (
  (revoked_at is null) = (revoke_reason is null) and (revoke_reason is null or revoke_reason in ('reassigned', 'reissued', 'manual', 'rescue'))
);

-- 订单的销售端一侧：改派后「现在的供应商」换成救援供应商（平台原来只能改 sell_minor，0031）
drop trigger order_sales_platform_columns on order_sales;
create trigger order_sales_platform_columns
  before update of order_id, channel_id, api_client_id, quote_id, idempotency_key, request_hash, channel_order_no, currency, markup_bp, fx, fx_buffer_bp, created_at
  on order_sales
  for each statement execute function reject_platform_column_update();

-- ---- 救援：一次触发一行（平台表：涉及原供应商和几家候选，租户角色没有任何权限） ----

create table order_rescues (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  -- 原供应商（指向租户的列在平台表里不叫 tenant_id，ADR 0023）
  original_tenant_id uuid not null,
  -- tenant_declared 供应商声明 / dispatch_overdue 用车前 6 小时仍未派车 / driver_no_show 司机未到 / tenant_suspended 供应商被暂停
  trigger text not null,
  -- 谁触发的：tenant_user（供应商声明）/ system（定时任务）/ platform_user（运营）
  triggered_by_type text not null,
  triggered_by uuid,
  -- 供应商声明的原因、运营判定的说明
  reason text,
  triggered_at timestamptz not null,
  -- 触发前订单的状态、用车时间
  from_status text not null,
  service_at timestamptz not null,
  -- 违约金：基数是原结算价（原供应商的结算币种）、比例和阶梯按触发时刻定
  original_settlement_minor bigint not null,
  original_settlement_currency text not null,
  -- 原供应商的结算币种 → 客人支付币种（它那一单的报价快照里的汇率；同币种为 null）：换算救援差价用
  original_fx jsonb,
  penalty_bp integer not null,
  penalty_tier text not null,
  -- open 待处理 / offering 救援单待接 / exhausted 候选都不接 / rescued 已改派 / cancelled 订单取消了
  status text not null,
  -- 改派给了谁、结算价（救援供应商的结算币种）、经救援单还是人工指定
  rescue_tenant_id uuid,
  rescue_settlement_minor bigint,
  rescue_settlement_currency text,
  -- 救援供应商的结算币种 → 客人支付币种（救援报价快照里的；同币种为 null）
  rescue_fx jsonb,
  rescued_via text,
  rescued_at timestamptz,
  -- 不可抗力（运营认定，免违约金和救援差价）
  force_majeure_at timestamptz,
  force_majeure_by uuid references platform_users (id),
  force_majeure_note text,
  closed_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  foreign key (original_tenant_id, order_id) references orders (tenant_id, id),
  foreign key (rescue_tenant_id, order_id) references orders (tenant_id, id),
  constraint order_rescues_trigger_check check (trigger in ('tenant_declared', 'dispatch_overdue', 'driver_no_show', 'tenant_suspended')),
  constraint order_rescues_triggered_by_check check (triggered_by_type in ('tenant_user', 'system', 'platform_user') and ((triggered_by_type = 'system') = (triggered_by is null))),
  constraint order_rescues_status_check check (status in ('open', 'offering', 'exhausted', 'rescued', 'cancelled')),
  constraint order_rescues_from_status_check check (from_status in ('confirmed', 'assigned', 'departed')),
  constraint order_rescues_penalty check (penalty_bp in (0, 3000, 10000) and penalty_tier in ('none', 'partial', 'full')),
  -- 供应商声明必须写原因
  constraint order_rescues_reason check ((trigger <> 'tenant_declared' or (reason is not null and char_length(reason) between 1 and 500)) and (reason is null or char_length(reason) <= 500)),
  constraint order_rescues_settlement check (original_settlement_minor > 0 and (rescue_settlement_minor is null or rescue_settlement_minor > 0)),
  -- 改派了才有救援供应商、结算价、方式和时间；救援供应商不能是原供应商
  constraint order_rescues_rescued check (
    (status = 'rescued') = (rescue_tenant_id is not null)
    and (rescue_tenant_id is null) = (rescue_settlement_minor is null)
    and (rescue_tenant_id is null) = (rescue_settlement_currency is null)
    and (rescue_tenant_id is null) = (rescued_via is null)
    and (rescue_tenant_id is null) = (rescued_at is null)
    and (rescued_via is null or rescued_via in ('offer', 'manual'))
    and rescue_tenant_id is distinct from original_tenant_id
  ),
  constraint order_rescues_closed check ((status in ('rescued', 'cancelled')) = (closed_at is not null)),
  constraint order_rescues_force_majeure check ((force_majeure_at is null) = (force_majeure_by is null) and (force_majeure_at is null) = (force_majeure_note is null) and (force_majeure_note is null or char_length(force_majeure_note) between 1 and 500)),
  constraint order_rescues_version_positive check (version >= 1)
);

-- 同一张单同时只能有一个没有结论的救援：并发触发（供应商声明和定时任务同时到）只建一条
create unique index order_rescues_open_key on order_rescues (order_id) where status in ('open', 'offering', 'exhausted');
-- 运营后台的救援队列：按状态、触发时间
create index order_rescues_queue_idx on order_rescues (status, triggered_at);
create index order_rescues_order_idx on order_rescues (order_id, triggered_at);

grant select, insert, update on order_rescues to nozomi_platform;

-- ---- 救援单：发给一家候选供应商、要它主动接单（租户表：候选供应商看得到发给自己的） ----

create table order_rescue_offers (
  tenant_id uuid not null references tenants (id),
  id uuid not null default gen_random_uuid(),
  rescue_id uuid not null references order_rescues (id),
  order_id uuid not null,
  -- 用这家的哪个商品、哪个车型组接（报价引擎按原报价条件比出来的）
  product_id uuid not null,
  product_version integer not null,
  vehicle_group_id uuid not null references vehicle_groups (id),
  -- 接单前看得到的行程：品类、城市、接送点、方向、用车时间、人数行李、上下车点的坐标、附加服务、司机语言。
  -- 没有乘客的姓名、电话、邮箱和航班号——接了单在订单里看（和普通订单「付款后才看得到」同一个道理）
  trip jsonb not null,
  -- 这家的结算价（它的结算币种）和完整明细：接单后按它结算（需求「结算价为其当前报价」）
  settlement_minor bigint not null,
  settlement_currency text not null,
  settlement jsonb not null,
  -- pending 待接 / accepted 已接 / declined 已拒绝 / expired 超时没接 / withdrawn 收回
  status text not null,
  -- 谁发的：platform_user（运营选的）/ system（上一家不接自动顺延）
  offered_by_type text not null,
  offered_by uuid,
  offered_at timestamptz not null,
  expires_at timestamptz not null,
  decided_at timestamptz,
  decided_by uuid,
  decline_reason text,
  primary key (tenant_id, id),
  foreign key (tenant_id, product_id) references products (tenant_id, id),
  foreign key (tenant_id, decided_by) references tenant_users (tenant_id, id),
  constraint order_rescue_offers_status_check check (status in ('pending', 'accepted', 'declined', 'expired', 'withdrawn')),
  constraint order_rescue_offers_offered_by_check check (offered_by_type in ('platform_user', 'system') and ((offered_by_type = 'system') = (offered_by is null))),
  constraint order_rescue_offers_trip check (jsonb_typeof(trip) = 'object' and jsonb_typeof(settlement) = 'object'),
  constraint order_rescue_offers_settlement check (settlement_minor > 0),
  constraint order_rescue_offers_expiry check (expires_at > offered_at),
  constraint order_rescue_offers_decided check ((status = 'pending') = (decided_at is null) and (decided_by is null or status in ('accepted', 'declined'))),
  constraint order_rescue_offers_decline_reason check (decline_reason is null or (status = 'declined' and char_length(decline_reason) <= 500))
);

-- 一次救援里一家只发一次（拒绝了、超时了的不再发），同一时刻只有一张待接的
create unique index order_rescue_offers_rescue_tenant_key on order_rescue_offers (tenant_id, rescue_id);
create unique index order_rescue_offers_pending_key on order_rescue_offers (rescue_id) where status = 'pending';
-- 供应商后台的救援单列表
create index order_rescue_offers_tenant_idx on order_rescue_offers (tenant_id, offered_at desc, id desc);
-- 定时任务跨租户找超时没接的（不以 tenant_id 开头的例外）
create index order_rescue_offers_due_idx on order_rescue_offers (expires_at) where status = 'pending';

alter table order_rescue_offers enable row level security;
create policy order_rescue_offers_same_tenant on order_rescue_offers for select to nozomi_app using (tenant_id = app_tenant_id());
-- 平台：发救援单、供应商接 / 拒（在平台事务里，租户编号只来自令牌）、超时顺延、运营后台查看
create policy order_rescue_offers_platform on order_rescue_offers to nozomi_platform using (true) with check (true);
grant select on order_rescue_offers to nozomi_app;
grant select, insert, update on order_rescue_offers to nozomi_platform;

-- 救援单的平台一侧（平台表）：比价时这家的对外价、加价比例、汇率、名次和当时的全部候选——换算救援差价用汇率，
-- 对外价和加价比例不能让供应商看到（规则 4），所以不放在救援单那张租户表里
create table order_rescue_quotes (
  offer_id uuid primary key,
  supplier_tenant_id uuid not null,
  rescue_id uuid not null references order_rescues (id),
  currency text not null,
  sell_minor bigint not null,
  markup_bp integer not null,
  -- 这家的结算币种 → 客人支付币种（报价快照里的）；同币种为 null
  fx jsonb,
  position integer not null,
  -- 发这张救援单时比出来的全部候选（排除了原供应商和已经拒绝、超时的）
  candidates jsonb not null,
  quoted_at timestamptz not null,
  foreign key (supplier_tenant_id, offer_id) references order_rescue_offers (tenant_id, id),
  constraint order_rescue_quotes_amount check (sell_minor > 0 and position >= 1),
  constraint order_rescue_quotes_candidates check (jsonb_typeof(candidates) = 'array')
);

grant select, insert on order_rescue_quotes to nozomi_platform;

-- ---- 供应商应扣款项：违约金、救援差价（租户表：供应商看得到自己的）。现在只记账，M5 结算时从账单里扣 ----

create table tenant_deductions (
  tenant_id uuid not null references tenants (id),
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  rescue_id uuid not null references order_rescues (id),
  -- penalty 违约金 / rescue_difference 救援差价
  kind text not null,
  -- 原供应商结算币种的最小单位
  amount_minor bigint not null,
  currency text not null,
  -- 怎么算的：违约金 = 原结算价 × 比例（阶梯、触发情形、距用车多久）；救援差价 = 救援结算价（按快照汇率换到原结算币种）− 原结算价，为负记 0
  basis jsonb not null,
  -- pending 待结算时扣 / waived 不可抗力免除
  status text not null,
  waived_at timestamptz,
  waive_reason text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, order_id) references orders (tenant_id, id),
  constraint tenant_deductions_kind_check check (kind in ('penalty', 'rescue_difference')),
  constraint tenant_deductions_status_check check (status in ('pending', 'waived')),
  constraint tenant_deductions_amount check (amount_minor >= 0),
  constraint tenant_deductions_basis check (jsonb_typeof(basis) = 'object'),
  constraint tenant_deductions_waived check ((status = 'waived') = (waived_at is not null) and (waived_at is null) = (waive_reason is null))
);

-- 一次救援、一种款项只记一条
create unique index tenant_deductions_rescue_kind_key on tenant_deductions (tenant_id, rescue_id, kind);
create index tenant_deductions_tenant_idx on tenant_deductions (tenant_id, created_at desc, id desc);

alter table tenant_deductions enable row level security;
create policy tenant_deductions_same_tenant on tenant_deductions for select to nozomi_app using (tenant_id = app_tenant_id());
create policy tenant_deductions_platform on tenant_deductions to nozomi_platform using (true) with check (true);
grant select on tenant_deductions to nozomi_app;
grant select, insert, update on tenant_deductions to nozomi_platform;
