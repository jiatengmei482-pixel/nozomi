-- 包车机场开始 / 机场结束套餐（M9P-21，ADR 0098 第三、四节）。只做加法，不改、不删已有的行，不含任何数据。
-- 编号：main 上最大是 0460；0470（#249）、0480（#255）、0490（#256）已被开着的 PR 占用，0500～0510 留给并行的 M9P-07 / M9P-13，这里用 0520。
--
-- 1. 价格方式加 charter_airport_package（机场套餐价）：area_id 是机场区域、direction 是场景（pickup 机场开始 / dropoff 机场结束）、package_hours 必填。
--    params = { packagePriceMinor, packageKm?, overKmPerKmMinor?, overtimePerHourMinor? }，没填的三项 = 同普通套餐（结构见 @nozomi/domain 的 Pricing）。
--    两个约束是整列表 drop 再 add：以本迁移写成时 main 上最新的列表（0450）为基础；合并前若别的迁移又加了价格方式，要在这里一并带上
--    （迁移测试 charter-airport-migration.integration.test.ts 逐种价格方式插一行，漏了会红）。
-- 2. charter_airport_bindings：商品级机场绑定（场景 × 机场 × 机场区域 × 可选中文简称）。
--    机场区域只用来判断上 / 下车点在不在机场，可以是本租户任何业务类型、任何用途的区域，不进 product_areas。
--    绑定着的区域不能删（on delete restrict，应用翻成 409 AREA_IN_USE）；停用不拦，报价时停用的区域不生效。删商品时跟着删。
--    行级安全只放行当前租户；平台角色只读（比价、运营后台查看）。

alter table price_rules drop constraint price_rules_model_check;
alter table price_rules add constraint price_rules_model_check check (pricing_model in ('fixed', 'mileage_time', 'charter_package', 'charter_area_surcharge', 'charter_itinerary_surcharge', 'charter_airport_package'));

alter table price_rules drop constraint price_rules_package_matches_model;
alter table price_rules add constraint price_rules_package_matches_model check (
  case pricing_model
    when 'charter_package' then package_hours is not null
    when 'charter_airport_package' then package_hours is not null
    when 'charter_area_surcharge' then true
    when 'charter_itinerary_surcharge' then true
    else package_hours is null
  end
);

alter table price_rules add constraint price_rules_airport_package_shape check (
  pricing_model <> 'charter_airport_package' or (area_id is not null and direction is not null and direction in ('pickup', 'dropoff'))
);

create table charter_airport_bindings (
  tenant_id uuid not null references tenants (id),
  product_id uuid not null,
  scenario text not null,
  place_id uuid not null references places (id),
  area_id uuid not null,
  short_name_zh text,
  -- 同一商品同一场景里的先后（报价时一个点落在几个机场区域里取前面的）
  position integer not null,
  created_at timestamptz not null,
  primary key (tenant_id, product_id, scenario, place_id),
  constraint charter_airport_bindings_area_unique unique (tenant_id, product_id, scenario, area_id),
  foreign key (tenant_id, product_id) references products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, area_id) references areas (tenant_id, id) on delete restrict,
  constraint charter_airport_bindings_scenario_check check (scenario in ('airport_start', 'airport_end')),
  constraint charter_airport_bindings_short_name check (short_name_zh is null or char_length(short_name_zh) between 1 and 20),
  constraint charter_airport_bindings_position_range check (position >= 0)
);

create index charter_airport_bindings_area_idx on charter_airport_bindings (tenant_id, area_id);

alter table charter_airport_bindings enable row level security;
create policy charter_airport_bindings_same_tenant on charter_airport_bindings to nozomi_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());
grant select, insert, update, delete on charter_airport_bindings to nozomi_app;

grant select on charter_airport_bindings to nozomi_platform;
create policy charter_airport_bindings_platform_read on charter_airport_bindings for select to nozomi_platform using (true);
