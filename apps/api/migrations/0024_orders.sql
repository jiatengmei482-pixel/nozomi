-- M3-01：订单与付款（ADR 0026）。需求：《用车报价服务平台》「API · 销售端接口」（下单、订单状态）、「5. 商品 · ④ 库存」（下单预占、支付确认扣减、超时释放）、
-- 「8. 订单与履约」、「数据模型」order / order_event；《平台运营端与渠道对接》「服务后加收费用」（保存支付方式）、「财务结算 · 收款与付款」（Stripe 回调触发支付确认 → 自动确认）。
-- 只建结构和授权，不含任何数据。

-- 订单：中标租户的业务数据（租户表，带 tenant_id、行级安全）。这里只有租户可以看的内容：结算价和明细、乘客、行程。
-- 渠道、对外价、加价比例、汇率不在这张表里（在平台表 order_sales），租户角色对那张表没有任何权限——规则 4 在数据库层的保证。
create table orders (
  tenant_id uuid not null references tenants (id),
  id uuid not null default gen_random_uuid(),
  -- 给人看的订单号：NZ + 下单日期（UTC）+ 8 位随机字符，全平台唯一
  order_no text not null,
  status text not null,
  category text not null,
  city_id uuid not null references cities (id),
  -- 接送机的机场 / 车站；其他品类没有
  place_id uuid references places (id),
  direction text,
  product_id uuid not null,
  product_version integer not null,
  vehicle_group_id uuid not null references vehicle_groups (id),
  package_hours integer,
  -- 用车时间：时刻、城市当地时间（YYYY-MM-DDTHH:mm）、时区、当地日期（库存和加急库存按它算）
  service_at timestamptz not null,
  service_local text not null,
  timezone text not null,
  service_date date not null,
  urgent boolean not null,
  passengers integer not null,
  luggage integer not null,
  -- 上车点、下车点：{ lng, lat, address }；接送机机场 / 车站那一端为空（用 place_id）
  pickup jsonb,
  dropoff jsonb,
  addons jsonb not null,
  driver_language text,
  flight_no text,
  -- 乘客：{ name, phone, email }；即时通讯：{ app, handle }
  passenger jsonb not null,
  messaging jsonb,
  notes text,
  -- 结算价（中标租户的结算币种）和完整明细（报价快照里的 SettlementBreakdown），以快照为准，不重新报价
  settlement_minor bigint not null,
  settlement_currency text not null,
  settlement jsonb not null,
  free_wait_minutes integer,
  -- 这一单有没有占用每日库存（下单时商品是限量的才占）：待支付时是预占（held），付款后转为已售（sold）
  inventory_held boolean not null,
  payment_due_at timestamptz not null,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, product_id) references products (tenant_id, id),
  constraint orders_order_no_format check (order_no ~ '^NZ[0-9]{8}[0-9A-HJ-NP-Z]{8}$'),
  constraint orders_status_check check (status in ('pending_payment', 'confirmed', 'assigned', 'in_service', 'completed', 'cancelled', 'rescue_pending')),
  constraint orders_category_check check (category in ('airport_transfer', 'point_to_point', 'charter')),
  constraint orders_place_only_for_airport_transfer check ((category = 'airport_transfer') = (place_id is not null)),
  constraint orders_direction_check check ((category = 'airport_transfer') = (direction is not null) and (direction is null or direction in ('pickup', 'dropoff'))),
  constraint orders_package_only_for_charter check ((category = 'charter') = (package_hours is not null)),
  constraint orders_counts check (passengers >= 1 and luggage >= 0),
  constraint orders_settlement_positive check (settlement_minor > 0),
  constraint orders_json check (jsonb_typeof(passenger) = 'object' and jsonb_typeof(addons) = 'array' and jsonb_typeof(settlement) = 'object'),
  constraint orders_payment_due check (payment_due_at > created_at),
  -- 确认过才有确认时间；取消了才有取消时间和原因
  constraint orders_confirmed_at check ((status <> 'pending_payment' or confirmed_at is null) and (status in ('pending_payment', 'cancelled') or confirmed_at is not null)),
  constraint orders_cancelled check ((status = 'cancelled') = (cancelled_at is not null) and (cancelled_at is null) = (cancel_reason is null)),
  constraint orders_version_positive check (version >= 1)
);

-- 订单号全平台唯一（不以 tenant_id 开头的例外：唯一性本来就是跨供应商的；租户的查询都另带 tenant_id）
create unique index orders_order_no_key on orders (order_no);
-- 租户的订单列表：按用车时间
create index orders_service_idx on orders (tenant_id, service_at, id);
-- 运营后台的订单列表：按下单时间
create index orders_created_idx on orders (tenant_id, created_at desc, id desc);
-- 加急库存：某个商品某一天走加急的单（没取消的）
create index orders_urgent_idx on orders (tenant_id, product_id, service_date) where urgent and status <> 'cancelled';
-- 超时未付款的自动取消：跨租户扫到期的待支付单（不以 tenant_id 开头的例外：定时任务不分租户）
create index orders_payment_due_idx on orders (payment_due_at) where status = 'pending_payment';

alter table orders enable row level security;
-- 租户只读自己的订单（付没付过款由接口层再过滤：没付款的单对租户不可见）
create policy orders_same_tenant on orders for select to nozomi_app using (tenant_id = app_tenant_id());
-- 平台：销售端下单、支付回调、超时取消、运营后台查看，都在平台事务里跨租户读写
create policy orders_platform on orders to nozomi_platform using (true) with check (true);
grant select on orders to nozomi_app;
grant select, insert, update on orders to nozomi_platform;

-- 订单的状态流水：每次状态变化一行（需求「所有订单状态变更可追溯」、数据模型 order_event）。只追加
create table order_events (
  tenant_id uuid not null references tenants (id),
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  -- 新建时为空
  from_status text,
  to_status text not null,
  -- 谁让它变的：channel（渠道调接口）/ payment（支付回调）/ system（定时任务）/ platform_user（运营，M4-02）
  actor text not null,
  reason text,
  occurred_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, order_id) references orders (tenant_id, id),
  constraint order_events_actor_check check (actor in ('channel', 'payment', 'system', 'platform_user'))
);

create index order_events_order_idx on order_events (tenant_id, order_id, occurred_at, id);

alter table order_events enable row level security;
create policy order_events_same_tenant on order_events for select to nozomi_app using (tenant_id = app_tenant_id());
create policy order_events_platform on order_events to nozomi_platform using (true) with check (true);
grant select on order_events to nozomi_app;
grant select, insert on order_events to nozomi_platform;

-- 订单的销售端一侧（平台表）：哪个渠道、哪个报价、渠道的订单号和幂等键、客人付的币种和金额（对外价）、加价比例、汇率快照。
-- 指向租户的列叫 supplier_tenant_id（ADR 0023：不叫 tenant_id，这是平台的交易记录，不属于那个租户）
create table order_sales (
  order_id uuid primary key,
  supplier_tenant_id uuid not null,
  channel_id uuid not null references channels (id),
  api_client_id uuid not null references channel_api_clients (id),
  -- 一个报价只能下一单
  quote_id text not null unique references quotes (id),
  -- Idempotency-Key：同一个渠道里唯一；同一个键、同样的内容返回同一张订单
  idempotency_key text not null,
  request_hash text not null,
  channel_order_no text,
  -- 客人支付的币种和金额（对外价，快照里的），加价比例，跨币种时的汇率和缓冲（快照里的）
  currency text not null,
  sell_minor bigint not null,
  markup_bp integer not null,
  fx jsonb,
  fx_buffer_bp integer not null,
  created_at timestamptz not null,
  foreign key (supplier_tenant_id, order_id) references orders (tenant_id, id),
  constraint order_sales_idempotency_key unique (channel_id, idempotency_key),
  constraint order_sales_amount check (sell_minor > 0)
);

create index order_sales_channel_idx on order_sales (channel_id, created_at desc);

grant select, insert on order_sales to nozomi_platform;

-- 收款：一单一笔（服务后加收在 M3-03 另加 kind）。只存支付服务里的编号和状态，不存卡号、client_secret 这类东西
create table order_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  supplier_tenant_id uuid not null,
  -- order：下单时的付款
  kind text not null default 'order',
  provider text not null,
  -- 支付服务里的付款编号（Stripe PaymentIntent）、客户编号（Customer）、保存下来的支付方式（PaymentMethod，服务后加收用）
  intent_id text unique,
  customer_id text,
  payment_method_id text,
  amount_minor bigint not null,
  currency text not null,
  status text not null,
  -- 最近一次付款失败的原因：{ code, decline_code, message }
  last_error jsonb,
  refunded_minor bigint not null default 0,
  disputed boolean not null default false,
  -- 钱到了单却已经取消了（取消付款和付款同时发生）：财务核实退款（异常队列在 M4-02）
  paid_after_cancel boolean not null default false,
  -- 客人同意保存支付方式用于服务后加收的时间（下单页勾选，第五轮决策 ⑤）
  save_consent_at timestamptz not null,
  succeeded_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  foreign key (supplier_tenant_id, order_id) references orders (tenant_id, id),
  constraint order_payments_kind_check check (kind in ('order')),
  constraint order_payments_provider_check check (provider in ('stripe')),
  constraint order_payments_status_check check (status in ('creating', 'requires_payment', 'processing', 'succeeded', 'canceled')),
  -- 还没在支付服务建好付款（creating）就没有付款编号；建付款之前订单就被取消了的，没有编号、状态是已取消
  constraint order_payments_intent check ((status <> 'creating' or intent_id is null) and (status in ('creating', 'canceled') or intent_id is not null)),
  constraint order_payments_amounts check (amount_minor > 0 and refunded_minor >= 0 and refunded_minor <= amount_minor),
  constraint order_payments_succeeded_at check ((status = 'succeeded') = (succeeded_at is not null))
);

create unique index order_payments_order_kind_key on order_payments (order_id, kind);

grant select, insert, update on order_payments to nozomi_platform;

-- 收到的支付通知（Webhook）：事件编号唯一，同一个事件只处理一次；处理结果留着排查用。不存通知原文（里面有客人的账单信息）
create table payment_events (
  id text primary key,
  provider text not null,
  type text not null,
  livemode boolean not null,
  -- 事件里的对象编号（PaymentIntent、Charge、Dispute……）
  object_id text,
  event_created_at timestamptz not null,
  received_at timestamptz not null,
  -- processing 正在处理（同一个事务里改成结果）；applied 改了订单或付款；ignored 不处理的类型；unmatched 对不上平台的付款；mismatch 金额币种对不上；livemode_mismatch 测试 / 正式模式不一致
  result text not null,
  order_id uuid,
  detail jsonb,
  constraint payment_events_provider_check check (provider in ('stripe')),
  constraint payment_events_result_check check (result in ('processing', 'applied', 'ignored', 'unmatched', 'mismatch', 'livemode_mismatch'))
);

create index payment_events_order_idx on payment_events (order_id, received_at);

grant select, insert, update on payment_events to nozomi_platform;

-- 库存：下单预占、付款扣减、超时释放由平台事务做（销售端下单走平台角色，ADR 0023），平台角色对每日库存加「改」
create policy inventory_days_platform_booking on inventory_days for update to nozomi_platform using (true) with check (true);
grant update on inventory_days to nozomi_platform;

-- 询价日志的「有没有下单」（0020 留给订单任务写的那一列）
grant update on quote_logs to nozomi_platform;
