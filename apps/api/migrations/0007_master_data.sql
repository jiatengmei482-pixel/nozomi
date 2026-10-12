-- M1-01：平台主数据——城市、地点（机场 / 车站 / 地标，以及挂在它们下面的航站楼 / 出口）、车型组、附加服务。
-- 字段来自 docs/requirements/01-tenant-and-quote-engine.md「统一主数据（平台级）」和「数据模型」；设计决定见 ADR 0012。
--
-- 这里只建结构，不写任何城市、机场、车型、附加服务：
-- 机场用 `pnpm masterdata:import-airports` 从公开数据源 OurAirports 导入，其余由平台在后台录入。
--
-- 主数据是平台表（不带 tenant_id、不开行级安全）：平台角色可以读、新增、修改；租户角色只能读。
-- 谁都没有 delete 权限——主数据只停用、不删除，历史订单和规则的引用不会失效。
-- 每张表的 version 每改一次加一，接口用它防止两个人同时修改时互相覆盖。

create table cities (
  id uuid primary key default gen_random_uuid(),
  -- CTY-国家码-序号，如 CTY-JP-TYO；创建后不能改
  code text not null,
  -- ISO 3166-1 alpha-2
  country_code text not null,
  -- 多语言名称：{"ja": "東京", "zh": "东京", "en": "Tokyo"}
  name jsonb not null,
  -- IANA 时区名，如 Asia/Tokyo；所有时间规则按城市时区计算
  timezone text not null,
  -- 中心坐标，WGS84，小数点后 6 位
  center_lng numeric(9, 6) not null,
  center_lat numeric(8, 6) not null,
  -- 边界：GeoJSON 的 Polygon / MultiPolygon；可以暂时不填
  boundary jsonb,
  status text not null,
  version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint cities_code_format check (code ~ '^CTY-[A-Z]{2}-[A-Z0-9]{2,8}$'),
  constraint cities_code_matches_country check (substr(code, 5, 2) = country_code),
  constraint cities_country_format check (country_code ~ '^[A-Z]{2}$'),
  constraint cities_name_is_object check (jsonb_typeof(name) = 'object' and name <> '{}'::jsonb),
  constraint cities_timezone_format check (timezone ~ '^[A-Z][A-Za-z]+(/[A-Z][A-Za-z0-9_+-]*){1,2}$'),
  constraint cities_lng_range check (center_lng between -180 and 180),
  constraint cities_lat_range check (center_lat between -90 and 90),
  constraint cities_boundary_is_object check (boundary is null or jsonb_typeof(boundary) = 'object'),
  constraint cities_status_check check (status in ('active', 'disabled')),
  constraint cities_version_positive check (version >= 1)
);

create unique index cities_code_key on cities (code);
create index cities_created_idx on cities (created_at, id);

create table places (
  id uuid primary key default gen_random_uuid(),
  -- airport 机场 / station 车站 / poi 地标 / terminal 航站楼（挂在机场下）/ exit 出口（挂在车站下）
  type text not null,
  -- 机场是 IATA 三字码；车站 STN-国家码-序号；地标 POI-序号；航站楼和出口是上级编码加后缀。全平台唯一，创建后不能改
  code text not null,
  country_code text not null,
  -- 所属城市。只有刚导入、还没有人工归属城市的机场可以为空，这样的机场不能启用
  city_id uuid references cities (id),
  parent_id uuid references places (id),
  name jsonb not null,
  lng numeric(9, 6) not null,
  lat numeric(8, 6) not null,
  -- 车站类型（shinkansen / rail / metro）或地标类型（hotel / attraction / port / mall）
  category text,
  -- 机场 / 航站楼的国际、国内属性
  flight_scope text,
  -- 地标的地址
  address text,
  -- 从公开数据源导入的机场：数据源标识、它在数据源里的编号、最近一次与数据源核对的时间
  source text,
  source_ref text,
  source_synced_at timestamptz,
  -- 平台在后台改过导入机场的英文名或坐标：再次导入时不覆盖
  source_overridden boolean not null default false,
  status text not null,
  version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint places_type_check check (type in ('airport', 'station', 'poi', 'terminal', 'exit')),
  constraint places_code_format check (
    case type
      when 'airport' then code ~ '^[A-Z]{3}$'
      when 'station' then code ~ '^STN-[A-Z]{2}-[A-Z0-9]{1,10}$' and substr(code, 5, 2) = country_code
      when 'poi' then code ~ '^POI-[A-Z0-9]{1,12}$'
      else code ~ '^[A-Z0-9-]{3,24}-[A-Z0-9]{1,6}$'
    end
  ),
  constraint places_country_format check (country_code ~ '^[A-Z]{2}$'),
  constraint places_parent_only_for_children check ((type in ('terminal', 'exit')) = (parent_id is not null)),
  constraint places_parent_not_self check (parent_id is null or parent_id <> id),
  constraint places_active_has_city check (status <> 'active' or city_id is not null),
  constraint places_name_is_object check (jsonb_typeof(name) = 'object' and name <> '{}'::jsonb),
  constraint places_lng_range check (lng between -180 and 180),
  constraint places_lat_range check (lat between -90 and 90),
  constraint places_category_check check (
    case type
      when 'station' then category in ('shinkansen', 'rail', 'metro')
      when 'poi' then category in ('hotel', 'attraction', 'port', 'mall')
      else category is null
    end
  ),
  constraint places_flight_scope_check check (
    flight_scope is null
    or (type in ('airport', 'terminal') and flight_scope in ('international', 'domestic', 'mixed'))
  ),
  constraint places_address_only_for_poi check (address is null or (type = 'poi' and length(btrim(address)) > 0)),
  constraint places_source_check check (source is null or (source = 'ourairports' and type = 'airport')),
  constraint places_source_complete check (
    (source is null) = (source_ref is null) and (source is null) = (source_synced_at is null)
  ),
  constraint places_override_needs_source check (not source_overridden or source is not null),
  constraint places_status_check check (status in ('active', 'disabled')),
  constraint places_version_positive check (version >= 1)
);

create unique index places_code_key on places (code);
-- 同一个数据源里的同一条记录只对应一个地点：重复导入靠它去重
create unique index places_source_key on places (source, source_ref) where source is not null;
create index places_created_idx on places (created_at, id);
create index places_city_idx on places (city_id);
create index places_parent_idx on places (parent_id);

create table vehicle_groups (
  id uuid primary key default gen_random_uuid(),
  -- VG-等级-座位数，如 VG-BIZ-7；创建后不能改
  code text not null,
  -- economy 经济 / comfort 舒适 / business 商务 / luxury 豪华
  grade text not null,
  seats integer not null,
  name jsonb not null,
  -- 代表车型，如 ["丰田埃尔法"]
  sample_models jsonb not null,
  -- fuel 燃油 / ev 电动
  power text not null,
  -- 可选的「人数 / 行李数」组合：[{"passengers": 4, "luggage": 4}]
  combos jsonb not null,
  status text not null,
  version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint vehicle_groups_code_format check (code ~ '^VG-[A-Z0-9]{2,8}-[1-9][0-9]?$'),
  constraint vehicle_groups_code_matches_seats check (substring(code from '[0-9]+$')::integer = seats),
  constraint vehicle_groups_grade_check check (grade in ('economy', 'comfort', 'business', 'luxury')),
  constraint vehicle_groups_seats_range check (seats between 1 and 60),
  constraint vehicle_groups_name_is_object check (jsonb_typeof(name) = 'object' and name <> '{}'::jsonb),
  constraint vehicle_groups_sample_models_is_array check (jsonb_typeof(sample_models) = 'array'),
  constraint vehicle_groups_power_check check (power in ('fuel', 'ev')),
  constraint vehicle_groups_combos_not_empty check (jsonb_typeof(combos) = 'array' and jsonb_array_length(combos) > 0),
  constraint vehicle_groups_status_check check (status in ('active', 'disabled')),
  constraint vehicle_groups_version_positive check (version >= 1)
);

create unique index vehicle_groups_code_key on vehicle_groups (code);
create index vehicle_groups_created_idx on vehicle_groups (created_at, id);

create table addons (
  id uuid primary key default gen_random_uuid(),
  -- ADD-代码，如 ADD-CHILD_SEAT；创建后不能改
  code text not null,
  -- 适用品类：airport_transfer 接送机 / point_to_point 点对点 / charter 包车
  categories text[] not null,
  -- 计费方式：per_order 按次 / per_item 按个 / per_person 按人 / per_duration 按时长
  charge_unit text not null,
  name jsonb not null,
  -- 多语言说明；可以是空对象
  description jsonb not null,
  status text not null,
  version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint addons_code_format check (code ~ '^ADD-[A-Z][A-Z0-9_]{1,39}$'),
  constraint addons_categories_check check (
    cardinality(categories) > 0
    and categories <@ array['airport_transfer', 'point_to_point', 'charter']::text[]
  ),
  constraint addons_charge_unit_check check (charge_unit in ('per_order', 'per_item', 'per_person', 'per_duration')),
  constraint addons_name_is_object check (jsonb_typeof(name) = 'object' and name <> '{}'::jsonb),
  constraint addons_description_is_object check (jsonb_typeof(description) = 'object'),
  constraint addons_status_check check (status in ('active', 'disabled')),
  constraint addons_version_positive check (version >= 1)
);

create unique index addons_code_key on addons (code);
create index addons_created_idx on addons (created_at, id);

-- 平台角色：读、新增、修改（停用也是修改）。不给 delete。
grant select, insert, update on cities, places, vehicle_groups, addons to nozomi_platform;
-- 租户角色：只读。主数据全平台共用同一份，不属于任何租户，所以不需要行级安全；租户改不了靠的是没有写权限。
grant select on cities, places, vehicle_groups, addons to nozomi_app;
