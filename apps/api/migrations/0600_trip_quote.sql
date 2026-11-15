-- AI 行程报价 P1（M9T-02，ADR 0100 第二节）。只建结构，不含任何数据。编号按监工要求从 0600 起。
--
-- 行程单跨供应商，是平台表（不带 tenant_id，供应商读不到，同 quotes）：trips → trip_plans → trip_segments / trip_fees。
-- 规则配置属于供应商的商品，是租户表（带 tenant_id、行级安全）：trip_rule_configs。
-- P1 只收结构化输入（坐标、时间、人数），不收自由文字、不含姓名电话，所以不需要加密列（P3 以新迁移加）。
-- 供应商快照列叫 supplier_tenant_id（不叫 tenant_id：平台表不带 tenant_id，ADR 0003），不设外键：段是报价时的快照，商品后来删了，快照照留。

create table trips (
  -- 32 字节随机数的 base64url（43 字符），同 booking_drafts：客人凭它访问，不可猜、不可枚举
  id text primary key,
  channel_id uuid not null references channels (id),
  source text not null,
  status text not null,
  itinerary jsonb not null,
  -- 渠道结算币种（建单时定，ADR 0100 第三节第 5 小节：入参和官网询价一致）
  currency text not null,
  -- 只由服务端在带有效验收会话时设为 true（同 orders / manual_quote_requests 的 is_acceptance）
  is_acceptance boolean not null default false,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  -- 行程单可读、可再报价到何时（建单 + 30 天）；之后由清理任务删除（M9T-05）。报价到期在 trip_plans.expires_at
  readable_until timestamptz not null,
  constraint trips_id_check check (id ~ '^[A-Za-z0-9_-]{43}$'),
  constraint trips_source_check check (source in ('form')),
  constraint trips_status_check check (status in ('draft', 'quoted')),
  constraint trips_currency_check check (currency ~ '^[A-Z]{3}$'),
  -- 行程单 14 天 × 12 个点，远小于 64 KB；只作兜底
  constraint trips_itinerary_size check (octet_length(itinerary::text) <= 131072),
  constraint trips_readable_check check (readable_until > created_at)
);

create index trips_readable_until_idx on trips (readable_until);

-- 验收标记建好之后不能改（同 0360 manual_quote_requests、0310 orders）：验收行程单洗不成真实客人的单，反过来也不行
create function trips_acceptance_immutable() returns trigger
  language plpgsql
  as $$
begin
  if new.is_acceptance is distinct from old.is_acceptance then
    raise exception '行程单的「验收」标记建好之后不能改' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create trigger trips_acceptance_immutable
  before update of is_acceptance on trips
  for each row execute function trips_acceptance_immutable();

create table trip_plans (
  id uuid primary key default gen_random_uuid(),
  trip_id text not null references trips (id) on delete cascade,
  seq integer not null,
  kind text not null,
  recommended boolean not null,
  -- 一车到底用的租户 × 车型组（D1）；每天各自最优为空
  supplier_tenant_id uuid,
  vehicle_group_id uuid,
  status text not null,
  -- 报不出时为空
  sell_minor bigint,
  -- 全部段同一结算币种时才有
  settlement_minor bigint,
  currency text not null,
  unquoted jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  quoted_at timestamptz not null,
  -- 方案里最早到期的段报价；报不出的方案为空
  expires_at timestamptz,
  constraint trip_plans_seq_unique unique (trip_id, seq),
  -- trip_fees 用 (trip_id, plan_id) 复合外键指过来：费用行的方案一定挂在同一个行程单下
  constraint trip_plans_trip_id_unique unique (trip_id, id),
  constraint trip_plans_seq_check check (seq >= 0),
  constraint trip_plans_kind_check check (kind is not null and kind in ('one_car', 'daily_best')),
  constraint trip_plans_status_check check (status is not null and status in ('quoted', 'unquoted')),
  constraint trip_plans_currency_check check (currency ~ '^[A-Z]{3}$'),
  -- 每天各自最优两列都空；一车到底两列同时有或同时空（不允许只填一列），报出价的一车到底必须两列都有
  -- （报不出、且没有任何租户车型组能贯穿全部用车日时，一车到底方案没有组合，只记报不出的原因）
  constraint trip_plans_one_car_key check (
    (kind = 'daily_best' and supplier_tenant_id is null and vehicle_group_id is null)
    or (kind = 'one_car' and (supplier_tenant_id is null) = (vehicle_group_id is null) and (status = 'unquoted' or supplier_tenant_id is not null))
  ),
  constraint trip_plans_quoted_amount check ((status = 'quoted') = (sell_minor is not null and expires_at is not null)),
  constraint trip_plans_amounts check ((sell_minor is null or sell_minor >= 0) and (settlement_minor is null or settlement_minor >= 0)),
  constraint trip_plans_unquoted_array check (jsonb_typeof(unquoted) = 'array' and jsonb_typeof(warnings) = 'array')
);

create table trip_segments (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references trip_plans (id) on delete cascade,
  seq integer not null,
  day_index integer not null,
  service_date date not null,
  segment_type text not null,
  start_local timestamp,
  end_local timestamp,
  points jsonb not null,
  -- 报价用的品类（接送机报不出回落点对点时，segment_type 仍是接机 / 送机，category 记 point_to_point）；空闲日为空
  category text,
  city_id uuid,
  product_id uuid,
  supplier_tenant_id uuid,
  vehicle_group_id uuid,
  package_hours integer,
  settlement_minor bigint,
  settlement_currency text,
  sell_minor bigint,
  markup_bp integer,
  fx jsonb,
  breakdown jsonb,
  route jsonb,
  -- 一车到底里这一天用了别的供应商（按段选车，D2）
  other_vehicle boolean not null default false,
  constraint trip_segments_seq_unique unique (plan_id, seq),
  constraint trip_segments_seq_check check (seq >= 0),
  constraint trip_segments_day_check check (day_index between 0 and 13),
  constraint trip_segments_type_check check (segment_type is not null and segment_type in ('airport_pickup', 'airport_dropoff', 'p2p', 'charter', 'idle_day')),
  constraint trip_segments_category_check check (category is null or category in ('airport_transfer', 'point_to_point', 'charter')),
  constraint trip_segments_idle_shape check ((segment_type = 'idle_day') = (category is null)),
  constraint trip_segments_currency_check check (settlement_currency is null or settlement_currency ~ '^[A-Z]{3}$'),
  constraint trip_segments_amounts check ((settlement_minor is null or settlement_minor >= 0) and (sell_minor is null or sell_minor >= 0)),
  constraint trip_segments_markup_check check (markup_bp is null or markup_bp between 0 and 100000),
  -- 包车套餐时长上限同价格规则（PRICE_LIMITS.maxPackageHours = 72）
  constraint trip_segments_package_hours check (package_hours is null or package_hours between 1 and 72),
  constraint trip_segments_time_order check (start_local is null or end_local is null or end_local >= start_local)
);

create table trip_fees (
  id uuid primary key default gen_random_uuid(),
  trip_id text not null references trips (id) on delete cascade,
  plan_id uuid not null,
  seq integer not null,
  fee_type text not null,
  supplier_tenant_id uuid,
  product_id uuid,
  -- 用的是哪一版规则配置（trip_rule_configs.version）；没有配置（全部默认值）为 0
  rule_version integer not null,
  -- 结算价，可为负（lodging_offset、bundle_discount 是抵扣）
  settlement_minor bigint not null,
  settlement_currency text not null,
  sell_minor bigint not null,
  night_index integer,
  day_index integer,
  area_id uuid,
  label jsonb not null,
  calc jsonb not null,
  constraint trip_fees_plan_fk foreign key (trip_id, plan_id) references trip_plans (trip_id, id) on delete cascade,
  constraint trip_fees_seq_unique unique (plan_id, seq),
  constraint trip_fees_seq_check check (seq >= 0),
  constraint trip_fees_type_check check (fee_type is not null and fee_type in ('lodging', 'lodging_offset', 'idle', 'second_driver', 'bundle_discount', 'return')),
  constraint trip_fees_currency_check check (settlement_currency ~ '^[A-Z]{3}$'),
  constraint trip_fees_rule_version check (rule_version >= 0),
  -- 只有抵扣类可以为负，其余不得为负
  constraint trip_fees_sign check ((fee_type in ('lodging_offset', 'bundle_discount')) or (settlement_minor >= 0 and sell_minor >= 0)),
  constraint trip_fees_offset_sign check ((fee_type not in ('lodging_offset', 'bundle_discount')) or (settlement_minor <= 0 and sell_minor <= 0)),
  constraint trip_fees_index_range check ((night_index is null or night_index between 0 and 13) and (day_index is null or day_index between 0 and 13))
);

-- (trip_id, plan_id) 外键的反查（删方案时）由这个索引覆盖；(plan_id, seq) 唯一约束已覆盖按方案查
create index trip_fees_trip_plan_idx on trip_fees (trip_id, plan_id);

-- 平台表：编排接口在平台事务里写，一次报价删掉旧方案再写新方案；清理任务（M9T-05）删过期行程
grant select, insert, update, delete on trips to nozomi_platform;
grant select, insert, delete on trip_plans to nozomi_platform;
grant select, insert, delete on trip_segments to nozomi_platform;
grant select, insert, delete on trip_fees to nozomi_platform;

-- 跨段规则配置（租户表，ADR 0100 第四、五节）：没有这一行 = 全部用默认值；version 每次保存加一
create table trip_rule_configs (
  tenant_id uuid not null,
  product_id uuid not null,
  version integer not null,
  config jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, product_id),
  foreign key (tenant_id, product_id) references products (tenant_id, id) on delete cascade,
  constraint trip_rule_configs_version_check check (version >= 1),
  constraint trip_rule_configs_object check (jsonb_typeof(config) = 'object'),
  constraint trip_rule_configs_size check (octet_length(config::text) <= 32768)
);

alter table trip_rule_configs enable row level security;
create policy trip_rule_configs_same_tenant on trip_rule_configs to nozomi_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());
grant select, insert, update on trip_rule_configs to nozomi_app;

-- 编排时读各商品的规则；运营后台只读查看
grant select on trip_rule_configs to nozomi_platform;
create policy trip_rule_configs_platform_read on trip_rule_configs for select to nozomi_platform using (true);
