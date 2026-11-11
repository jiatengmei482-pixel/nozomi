-- 计程价（M8-30，ADR 0080）。只建结构，不含任何数据。编号：main 上最大是 0320（M8-27）。
--
-- 接送机、点对点商品按车型组设的「起步价 + 每公里单价」（结算价，商品子品牌币种的最小货币单位整数），不挂区域：
-- 两端都不在商品的报价区域里时按它报价；只有一端在时它的每公里单价也是「区域外里程费」的单价。
-- 生效日期（城市当地的用车日期，两端都含；valid_to 为空 = 一直有效）、启停和价格规则同一套口径；
-- 「同一个车型组的生效日期不能重叠」由应用在锁住商品那一行之后检查（同 ADR 0018，不用排他约束）。
-- 「只有接送机、点对点能设」「车型组必须是商品选的」同样由应用检查。

create table distance_prices (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  product_id uuid not null,
  vehicle_group_id uuid not null references vehicle_groups (id),
  start_minor integer not null,
  per_km_minor integer not null,
  valid_from date not null,
  valid_to date,
  status text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, product_id) references products (tenant_id, id) on delete cascade,
  constraint distance_prices_amounts check (start_minor between 0 and 1000000000 and per_km_minor between 0 and 1000000000 and (start_minor > 0 or per_km_minor > 0)),
  constraint distance_prices_valid_range check (valid_to is null or valid_to >= valid_from),
  constraint distance_prices_status_check check (status in ('enabled', 'disabled'))
);

create index distance_prices_product_idx on distance_prices (tenant_id, product_id, vehicle_group_id);

alter table distance_prices enable row level security;
create policy distance_prices_same_tenant on distance_prices to nozomi_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());
grant select, insert, update, delete on distance_prices to nozomi_app;

-- 比价要把所有供应商的商品放在一起算：平台只读（同 0016 的价格规则）
grant select on distance_prices to nozomi_platform;
create policy distance_prices_platform_read on distance_prices for select to nozomi_platform using (true);
