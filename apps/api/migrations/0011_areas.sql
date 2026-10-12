-- M1-02：区域（供应商自己画的营运区和禁行区）——第一批带 tenant_id 的业务表；另加「创建类接口的幂等键」。
-- 字段来自 docs/requirements/01-tenant-and-quote-engine.md「1. 区域管理」和「数据模型」的 area / area_polygon；
-- 落地时定下的事见 ADR 0015。只建结构，不写任何数据。
--
-- 三张都是租户表：带 tenant_id、主键和索引以它开头、开行级安全、策略只放行当前租户（ADR 0009、ADR 0010）。
-- 只授权给租户角色 nozomi_app。平台角色本期没有任何权限：运营后台还没有看区域的页面，等有了再按需要给只读。

create table areas (
  tenant_id uuid not null references tenants (id),
  id uuid not null default gen_random_uuid(),
  -- 所属城市（平台主数据）。创建后不能改
  city_id uuid not null references cities (id),
  -- 多语言名称：{"zh": "东京 23 区", "ja": "東京23区"}
  name jsonb not null,
  -- 判断同一个城市里是否重名用的键（每种语言的名称归一后的写法），由应用按 @nozomi/domain 的 areaNameKeys 算出
  name_keys text[] not null,
  -- general 通用 / airport_transfer 接送机 / point_to_point 点对点 / charter 包车
  biz_type text not null,
  status text not null,
  version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  constraint areas_name_is_object check (jsonb_typeof(name) = 'object' and name <> '{}'::jsonb),
  constraint areas_name_keys_not_empty check (cardinality(name_keys) > 0),
  constraint areas_biz_type_check check (biz_type in ('general', 'airport_transfer', 'point_to_point', 'charter')),
  constraint areas_status_check check (status in ('active', 'disabled')),
  constraint areas_version_positive check (version >= 1)
);

-- 列表：按最近修改从新到旧翻页；按城市筛选、查重名
create index areas_updated_idx on areas (tenant_id, updated_at desc, id desc);
create index areas_city_idx on areas (tenant_id, city_id);

alter table areas enable row level security;
create policy areas_same_tenant on areas to nozomi_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());
grant select, insert, update, delete on areas to nozomi_app;

create table area_polygons (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  area_id uuid not null,
  -- operate 营运区 / forbid 禁行区
  kind text not null,
  -- 这一类里的序号（「营运 1」里的 1）：由后端分配，删除别的图形后不重排
  seq integer not null,
  -- 备注名（选填）
  label text,
  -- 在区域里的先后（按加入的顺序）
  position integer not null,
  -- drawn 画的 / pasted 粘贴的 / circle 圆。只影响之后怎么编辑，不影响判断
  source text not null,
  -- 圆心和半径：只有 source = circle 时有，只用于再次编辑；判断「点在不在里面」只认下面的多边形
  circle_center_lng numeric(9, 6),
  circle_center_lat numeric(8, 6),
  circle_radius_m integer,
  -- 多边形：GeoJSON Polygon，只有一圈（不带洞）、首尾闭合、[经度, 纬度]、6 位小数、逆时针
  geometry jsonb not null,
  vertex_count integer not null,
  -- 外接矩形：报价时先用它粗筛，再做精确的点在多边形内判断（ADR 0002）
  min_lng numeric(9, 6) not null,
  min_lat numeric(8, 6) not null,
  max_lng numeric(9, 6) not null,
  max_lat numeric(8, 6) not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, area_id) references areas (tenant_id, id) on delete cascade,
  constraint area_polygons_kind_check check (kind in ('operate', 'forbid')),
  constraint area_polygons_seq_positive check (seq >= 1),
  constraint area_polygons_seq_unique unique (tenant_id, area_id, kind, seq),
  constraint area_polygons_position_unique unique (tenant_id, area_id, position),
  constraint area_polygons_label_not_blank check (label is null or (length(btrim(label)) > 0 and char_length(label) <= 40)),
  constraint area_polygons_source_check check (source in ('drawn', 'pasted', 'circle')),
  constraint area_polygons_circle_complete check (
    (source = 'circle') = (circle_radius_m is not null)
    and (circle_radius_m is null) = (circle_center_lng is null)
    and (circle_radius_m is null) = (circle_center_lat is null)
  ),
  constraint area_polygons_radius_range check (circle_radius_m is null or circle_radius_m between 100 and 100000),
  constraint area_polygons_geometry_is_polygon check (
    jsonb_typeof(geometry) = 'object' and geometry ->> 'type' = 'Polygon' and jsonb_array_length(geometry -> 'coordinates') = 1
  ),
  constraint area_polygons_vertex_count_range check (vertex_count between 3 and 1000),
  constraint area_polygons_bbox_range check (
    min_lng between -180 and 180 and max_lng between -180 and 180 and min_lng <= max_lng
    and min_lat between -90 and 90 and max_lat between -90 and 90 and min_lat <= max_lat
  )
);

create index area_polygons_area_idx on area_polygons (tenant_id, area_id, position);

alter table area_polygons enable row level security;
create policy area_polygons_same_tenant on area_polygons to nozomi_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());
grant select, insert, update, delete on area_polygons to nozomi_app;

-- 创建类接口的幂等键（需求文档「API 通用约定」：所有创建类 POST 带 Idempotency-Key，24 小时内同一个键返回同一结果）。
-- 键只在「同一个租户 + 同一个接口」里有意义：别的租户用了同一个键互不相干。
create table idempotency_keys (
  tenant_id uuid not null references tenants (id),
  -- 哪个接口，如 POST /tenant/v1/areas
  scope text not null,
  key text not null,
  -- 请求内容的 SHA-256：同一个键配了不同的内容要拒绝，而不是悄悄返回上一次的结果
  request_hash text not null,
  -- 第一次成功处理时的应答，之后原样返回
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null,
  primary key (tenant_id, scope, key),
  constraint idempotency_keys_key_format check (key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  constraint idempotency_keys_response_complete check ((response_status is null) = (response_body is null))
);

create index idempotency_keys_created_idx on idempotency_keys (tenant_id, created_at);

alter table idempotency_keys enable row level security;
create policy idempotency_keys_same_tenant on idempotency_keys to nozomi_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());
grant select, insert, update, delete on idempotency_keys to nozomi_app;
