-- M1-04：价格规则、调价规则、子品牌的取整单位、节假日日历。
-- 字段来自 docs/requirements/01-tenant-and-quote-engine.md「4. 商品 · ③ 价格规则与调价规则」「报价引擎」和
-- 「数据模型」的 price_rule / adjust_rule / holiday / brand.rounding_unit；落地时定下的事见 ADR 0018。只建结构，不写任何数据。

-- 子品牌的取整单位（最小货币单位的整数）：这个子品牌下所有商品的结算价最后按它四舍五入。1 = 只取整到最小货币单位。
alter table brands
  add column rounding_unit integer not null default 1,
  add constraint brands_rounding_unit_check check (rounding_unit in (1, 10, 100, 1000, 10000));

-- 价格规则 = 区域 × 车型组 ×（接送机：方向；包车：套餐时长）× 生效日期 的一条报价，带启停状态。
-- 金额都是子品牌币种的最小货币单位整数，在 params 里（结构见 @nozomi/domain 的 Pricing）。
-- 「同一个组合的生效日期不能重叠」由应用在锁住商品那一行之后检查（见 ADR 0018：这里没有用排他约束）。
create table price_rules (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  product_id uuid not null,
  area_id uuid not null,
  vehicle_group_id uuid not null references vehicle_groups (id),
  -- 接送机：pickup 接 / dropoff 送 / both 接送通用；其他品类为空
  direction text,
  -- 包车：套餐时长（小时）；其他品类为空
  package_hours integer,
  -- fixed 固定一口价 / mileage_time 里程 + 时长 / charter_package 包车套餐
  pricing_model text not null,
  params jsonb not null,
  -- 生效日期：城市当地的用车日期，两端都含；valid_to 为空 = 一直有效
  valid_from date not null,
  valid_to date,
  status text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, product_id) references products (tenant_id, id) on delete cascade,
  -- 区域被删除（只有没被已上架商品用着的才删得掉）时，它的价格跟着删
  foreign key (tenant_id, area_id) references areas (tenant_id, id) on delete cascade,
  constraint price_rules_direction_check check (direction is null or direction in ('pickup', 'dropoff', 'both')),
  constraint price_rules_package_hours_range check (package_hours is null or package_hours between 1 and 72),
  constraint price_rules_model_check check (pricing_model in ('fixed', 'mileage_time', 'charter_package')),
  constraint price_rules_package_matches_model check ((pricing_model = 'charter_package') = (package_hours is not null)),
  constraint price_rules_valid_range check (valid_to is null or valid_to >= valid_from),
  constraint price_rules_status_check check (status in ('enabled', 'disabled'))
);

-- 取一个商品的全部价格；按组合找重叠
create index price_rules_product_idx on price_rules (tenant_id, product_id, area_id, vehicle_group_id);
create index price_rules_area_idx on price_rules (tenant_id, area_id);

alter table price_rules enable row level security;
create policy price_rules_same_tenant on price_rules to nozomi_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());
grant select, insert, update, delete on price_rules to nozomi_app;

-- 调价规则（可选）：在基础价上按顺序链式执行的加价 / 减价。position 小的先执行（顺序即优先级）。
-- cycle、time_slot、steps 的结构见 @nozomi/domain 的 AdjustRule；适用范围的四个数组为空 = 全部。
create table adjust_rules (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  product_id uuid not null,
  name text not null,
  -- 出行日期范围（城市当地的用车日期，两端都含）；为空 = 不限
  travel_from date,
  travel_to date,
  cycle jsonb not null,
  time_slot jsonb,
  area_ids uuid[] not null default '{}',
  vehicle_group_ids uuid[] not null default '{}',
  directions text[] not null default '{}',
  package_hours integer[] not null default '{}',
  steps jsonb not null,
  position integer not null,
  status text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, product_id) references products (tenant_id, id) on delete cascade,
  constraint adjust_rules_name_not_blank check (length(btrim(name)) > 0 and char_length(name) <= 50),
  constraint adjust_rules_travel_range check (travel_from is null or travel_to is null or travel_to >= travel_from),
  constraint adjust_rules_directions_check check (directions <@ array['pickup', 'dropoff']),
  constraint adjust_rules_position_range check (position >= 0),
  constraint adjust_rules_status_check check (status in ('enabled', 'disabled'))
);

create index adjust_rules_product_idx on adjust_rules (tenant_id, product_id, position);

alter table adjust_rules enable row level security;
create policy adjust_rules_same_tenant on adjust_rules to nozomi_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());
grant select, insert, update, delete on adjust_rules to nozomi_app;

-- 节假日日历（平台主数据）：调价规则的周期选「节假日」时按它判断。
-- 不预置任何数据（没有找到带明确许可、覆盖日本和韩国的公开数据源）：由平台在后台逐条维护，见 ADR 0018。
create table holidays (
  country_code text not null,
  holiday_date date not null,
  -- 各语言的名称（至少一种）
  name jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (country_code, holiday_date),
  constraint holidays_country_format check (country_code ~ '^[A-Z]{2}$'),
  constraint holidays_name_is_object check (jsonb_typeof(name) = 'object' and name <> '{}'::jsonb)
);

-- 平台维护（没有 delete 以外的特殊处理：写错了就删掉重填），租户只读
grant select, insert, update, delete on holidays to nozomi_platform;
grant select on holidays to nozomi_app;
