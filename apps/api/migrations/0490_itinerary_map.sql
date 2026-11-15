-- 包车行程地图（M9P-20 P1，ADR 0096 第二节第 2 小节；0470 / 0480 已被别的任务占用）：多点静态路线图的缓存键、一次带中间点的折线缓存。
-- 全是平台表，租户角色没有任何权限。不含任何数据。

-- 静态地图的图片缓存（0250）多认一种键：`s样式版本:主题:宽x高@倍率|i1:纬度,经度>纬度,经度>…`（有序 2–12 个点，每个取整到 3 位小数，
-- domain 的 itineraryPointsKey）。原来的两点路线键 `…|v1:起点>终点` 照旧。
alter table static_map_images drop constraint static_map_images_key_format;
alter table static_map_images add constraint static_map_images_key_format check (
  cache_key ~ '^s[0-9]{1,3}:(light|dark):[0-9]{3}x[0-9]{3}@[12]\|v1:-?[0-9]{1,3}\.[0-9]{3},-?[0-9]{1,3}\.[0-9]{3}>-?[0-9]{1,3}\.[0-9]{3},-?[0-9]{1,3}\.[0-9]{3}$'
  or cache_key ~ '^s[0-9]{1,3}:(light|dark):[0-9]{3}x[0-9]{3}@[12]\|i1:-?[0-9]{1,3}\.[0-9]{3},-?[0-9]{1,3}\.[0-9]{3}(>-?[0-9]{1,3}\.[0-9]{3},-?[0-9]{1,3}\.[0-9]{3}){1,11}$'
);

-- 一次带中间点的折线（谷歌 Routes computeRoutes，经停作 intermediates）：一个有序点列一行，键同上的 `i1:…`。
-- 只存折线（经纬度，谷歌 encoded polyline；逐段的，取不到逐段时是整条的一条），保留 7 天（和路线缓存一样）；
-- 缓存条款（《服务专用条款》19.3 经纬度可缓存不超过 30 天）连同现有的里程时长、静态图、本表一并由 M10-01 核实（ADR 0096 第八节第 3 条）。
-- 过期的行查的时候当作没有，再次调用后覆盖，写入时顺手删掉过期的。不存密钥、不存请求原文。
create table itinerary_route_polylines (
  cache_key text primary key,
  polylines text[] not null,
  fetched_at timestamptz not null,
  expires_at timestamptz not null,
  constraint itinerary_route_polylines_key_format check (cache_key ~ '^i1:-?[0-9]{1,3}\.[0-9]{3},-?[0-9]{1,3}\.[0-9]{3}(>-?[0-9]{1,3}\.[0-9]{3},-?[0-9]{1,3}\.[0-9]{3}){1,11}$'),
  constraint itinerary_route_polylines_count check (cardinality(polylines) between 1 and 11),
  constraint itinerary_route_polylines_expiry check (expires_at > fetched_at)
);

create index itinerary_route_polylines_expires_idx on itinerary_route_polylines (expires_at);

grant select, insert, update, delete on itinerary_route_polylines to nozomi_platform;
