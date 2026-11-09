-- 官网路线小地图（M8-10，ADR 0072；0240 是 M4-34 的，0236–0249 留给别的任务）：谷歌 Maps Static API 的图片缓存、每日调用计数。
-- 全是平台表，租户角色没有任何权限。不含任何数据。

-- 图片缓存：一条路线（取整后的起终点）× 主题 × 尺寸 × 倍率一行。cache_key 是 `s样式版本:主题:宽x高@倍率|路线缓存键`
-- （domain 的 staticMapCacheKey，路线缓存键同 route_estimates）。保留 1 天；过期的行查的时候当作没有，再次调用后覆盖，写入时顺手删掉过期的。
-- 只存谷歌给的图片（PNG / JPEG / GIF，最大 1 MB），不存密钥、不存请求网址。
create table static_map_images (
  cache_key text primary key,
  content_type text not null,
  image bytea not null,
  fetched_at timestamptz not null,
  expires_at timestamptz not null,
  constraint static_map_images_key_format check (cache_key ~ '^s[0-9]{1,3}:(light|dark):[0-9]{3}x[0-9]{3}@[12]\|v1:-?[0-9]{1,3}\.[0-9]{3},-?[0-9]{1,3}\.[0-9]{3}>-?[0-9]{1,3}\.[0-9]{3},-?[0-9]{1,3}\.[0-9]{3}$'),
  constraint static_map_images_content_type check (content_type in ('image/png', 'image/jpeg', 'image/gif')),
  constraint static_map_images_size check (octet_length(image) between 1 and 1048576),
  constraint static_map_images_expiry check (expires_at > fetched_at)
);

create index static_map_images_expires_idx on static_map_images (expires_at);

grant select, insert, update, delete on static_map_images to nozomi_platform;

-- 每天（东京时间的日期）调用谷歌静态地图的次数（每次真正发出的请求，含重试）、失败次数、到了每日上限被挡下的次数，
-- 以及最近一次成功、最近一次失败（时间和原因代码）。和路线预估、地址搜索的计数分开：小地图用多了不能挡住报价要用的路线。
-- 运营后台「系统状态」看它（判断要不要开通 / 放宽）；到了每日上限页面只显示时间和距离（ADR 0072）。
create table static_map_api_usage (
  day date primary key,
  calls integer not null default 0,
  failures integer not null default 0,
  refused integer not null default 0,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_failure_code text,
  constraint static_map_api_usage_counts check (calls >= 0 and failures >= 0 and refused >= 0),
  constraint static_map_api_usage_failure check ((last_failure_at is null) = (last_failure_code is null)),
  constraint static_map_api_usage_failure_code check (last_failure_code is null or last_failure_code ~ '^[A-Z_]{1,40}$')
);

grant select, insert, update on static_map_api_usage to nozomi_platform;
