-- M1-03：子品牌、商品（基础信息、服务区域、车型组、调度人、服务规则、商品详情）。
-- 字段来自 docs/requirements/01-tenant-and-quote-engine.md「2. 商品 · ① 基础信息」「3. 商品 · ② 服务规则」
-- 「6. 商品 · ⑤ 商品详情」和「数据模型」的 brand / product / product_area / product_vehicle / product_dispatcher；
-- 落地时定下的事见 ADR 0016。只建结构，不写任何数据。
--
-- 五张都是租户表：带 tenant_id、主键和索引以它开头、开行级安全、策略只放行当前租户（ADR 0009、ADR 0010）。
-- 平台角色对 products 和 product_vehicle_groups 只读：停用城市、地点、车型组、附加服务之前要数「有多少已上架的商品在用」。

-- 子品牌：供应商下的品牌，决定商品所有金额的币种。
create table brands (
  tenant_id uuid not null references tenants (id),
  id uuid not null default gen_random_uuid(),
  name text not null,
  -- ISO 4217；创建后不能改（下面的商品金额都按它的最小货币单位存）
  currency text not null,
  status text not null,
  version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  constraint brands_name_not_blank check (length(btrim(name)) > 0 and char_length(name) <= 50),
  constraint brands_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint brands_status_check check (status in ('active', 'disabled')),
  constraint brands_version_positive check (version >= 1)
);

-- 同一个供应商下子品牌不重名（不分大小写）
create unique index brands_name_key on brands (tenant_id, lower(name));

alter table brands enable row level security;
create policy brands_same_tenant on brands to nozomi_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());
grant select, insert, update on brands to nozomi_app;

-- 商品编号里的流水号：全平台共用一个，保证编号全平台唯一。
create sequence product_code_seq;
grant usage on sequence product_code_seq to nozomi_app;

create table products (
  tenant_id uuid not null references tenants (id),
  id uuid not null default gen_random_uuid(),
  -- 给人看的商品编号：PRD + 创建时间（UTC，年月日时分秒）+ 流水号，全平台唯一
  code text not null,
  brand_id uuid not null,
  city_id uuid not null references cities (id),
  -- airport_transfer 接送机 / point_to_point 点对点 / charter 包车
  category text not null,
  -- 接送点（机场或车站）：接送机商品必须有，其他品类没有
  poi_id uuid references places (id),
  -- draft 草稿 / published 已上架 / unpublished 已下架
  status text not null,
  -- 服务规则（商品级）和商品详情：结构见 @nozomi/domain 的 ServiceRules / ProductContent；草稿可以只填一部分
  service_rules jsonb not null,
  content jsonb not null,
  version integer not null default 1,
  -- 最近一次上架的时间
  published_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, brand_id) references brands (tenant_id, id),
  constraint products_code_format check (code ~ '^PRD[0-9]{14}[0-9]{4,}$'),
  constraint products_category_check check (category in ('airport_transfer', 'point_to_point', 'charter')),
  constraint products_poi_only_for_airport_transfer check ((category = 'airport_transfer') = (poi_id is not null)),
  constraint products_status_check check (status in ('draft', 'published', 'unpublished')),
  constraint products_service_rules_is_object check (jsonb_typeof(service_rules) = 'object'),
  constraint products_content_is_object check (jsonb_typeof(content) = 'object'),
  constraint products_version_positive check (version >= 1)
);

-- 商品编号全平台唯一（不以 tenant_id 开头的例外：唯一性本来就是跨供应商的；查询都另带 tenant_id）
create unique index products_code_key on products (code);
create index products_updated_idx on products (tenant_id, updated_at desc, id desc);
create index products_city_idx on products (tenant_id, city_id);
create index products_brand_idx on products (tenant_id, brand_id);

alter table products enable row level security;
create policy products_same_tenant on products to nozomi_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());
grant select, insert, update, delete on products to nozomi_app;

-- 商品选的服务区域，带优先级（priority 小的在前）。
-- 区域被删除时这里跟着删（草稿、已下架的商品会少掉这个区域）；被已上架商品用着的区域删不掉，由应用拦住。
create table product_areas (
  tenant_id uuid not null,
  product_id uuid not null,
  area_id uuid not null,
  priority integer not null,
  primary key (tenant_id, product_id, area_id),
  foreign key (tenant_id, product_id) references products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, area_id) references areas (tenant_id, id) on delete cascade,
  constraint product_areas_priority_range check (priority >= 0)
);

create index product_areas_area_idx on product_areas (tenant_id, area_id);

alter table product_areas enable row level security;
create policy product_areas_same_tenant on product_areas to nozomi_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());
grant select, insert, update, delete on product_areas to nozomi_app;

-- 商品选的车型组（平台主数据），每个选一个「人数 / 行李数」组合。
create table product_vehicle_groups (
  tenant_id uuid not null,
  product_id uuid not null,
  vehicle_group_id uuid not null references vehicle_groups (id),
  passengers integer not null,
  luggage integer not null,
  position integer not null,
  primary key (tenant_id, product_id, vehicle_group_id),
  foreign key (tenant_id, product_id) references products (tenant_id, id) on delete cascade,
  constraint product_vehicle_groups_passengers_range check (passengers between 1 and 60),
  constraint product_vehicle_groups_luggage_range check (luggage between 0 and 99),
  constraint product_vehicle_groups_position_range check (position >= 0)
);

alter table product_vehicle_groups enable row level security;
create policy product_vehicle_groups_same_tenant on product_vehicle_groups to nozomi_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());
grant select, insert, update, delete on product_vehicle_groups to nozomi_app;

-- 调度人：姓名 + 电话，可以多个，以后随订单推送。
create table product_dispatchers (
  tenant_id uuid not null,
  product_id uuid not null,
  position integer not null,
  name text not null,
  phone text not null,
  primary key (tenant_id, product_id, position),
  foreign key (tenant_id, product_id) references products (tenant_id, id) on delete cascade,
  constraint product_dispatchers_name_not_blank check (length(btrim(name)) > 0 and char_length(name) <= 50),
  constraint product_dispatchers_phone_format check (phone ~ '^\+?[0-9][0-9 -]{5,19}$'),
  constraint product_dispatchers_position_range check (position >= 0)
);

alter table product_dispatchers enable row level security;
create policy product_dispatchers_same_tenant on product_dispatchers to nozomi_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());
grant select, insert, update, delete on product_dispatchers to nozomi_app;

-- 平台角色：只读商品和它选的车型组。用途只有一个——平台停用城市、地点、车型组、附加服务之前，
-- 数一数有多少已上架的商品在用（ADR 0012 留下的检查）。不能写，也读不到区域、调度人、子品牌。
grant select on products, product_vehicle_groups to nozomi_platform;
create policy products_platform_read on products for select to nozomi_platform using (true);
create policy product_vehicle_groups_platform_read on product_vehicle_groups for select to nozomi_platform using (true);
