-- 路线预估（M2-02，ADR 0042；0091–0099 留给别的任务）：谷歌地图 Routes API 的结果缓存、每日调用计数，询价日志记下路线的情况。
-- 全是平台表 / 平台表加列，租户角色没有任何权限。不含任何数据。

-- 路线缓存：一组（取整后的）起终点一行。cache_key 是 `v1:起点纬度,起点经度>终点纬度,终点经度`（domain 的 routeCacheKey，坐标取整到 3 位小数）。
-- 成功的有里程（米）和时长（秒），保留 7 天；只跟这组点有关的失败（没有路线、坐标无效）只有原因，保留 1 天。
-- 过期的行查的时候当作没有；再次调用后覆盖，写入时顺手删掉过期一天以上的。
create table route_estimates (
  cache_key text primary key,
  failure_code text,
  distance_meters integer,
  duration_seconds integer,
  fetched_at timestamptz not null,
  expires_at timestamptz not null,
  constraint route_estimates_key_format check (cache_key ~ '^v1:-?[0-9]{1,3}\.[0-9]{3},-?[0-9]{1,3}\.[0-9]{3}>-?[0-9]{1,3}\.[0-9]{3},-?[0-9]{1,3}\.[0-9]{3}$'),
  constraint route_estimates_failure_code check (failure_code is null or failure_code in ('NO_ROUTE', 'INVALID_POINTS')),
  constraint route_estimates_values check (
    (failure_code is null and distance_meters between 0 and 5000000 and duration_seconds between 0 and 604800)
    or (failure_code is not null and distance_meters is null and duration_seconds is null)
  ),
  constraint route_estimates_expiry check (expires_at > fetched_at)
);

create index route_estimates_expires_idx on route_estimates (expires_at);

grant select, insert, update, delete on route_estimates to nozomi_platform;

-- 每天（东京时间的日期）调用谷歌的次数（每次真正发出的请求，含重试）、失败次数、到了每日上限被挡下的次数，
-- 以及最近一次成功、最近一次失败（时间和原因代码）。运营后台「系统状态」看它；到了每日上限按降级处理（ADR 0042）。
create table route_api_usage (
  day date primary key,
  calls integer not null default 0,
  failures integer not null default 0,
  refused integer not null default 0,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_failure_code text,
  constraint route_api_usage_counts check (calls >= 0 and failures >= 0 and refused >= 0),
  constraint route_api_usage_failure check ((last_failure_at is null) = (last_failure_code is null)),
  constraint route_api_usage_failure_code check (last_failure_code is null or last_failure_code ~ '^[A-Z_]{1,40}$')
);

grant select, insert, update on route_api_usage to nozomi_platform;

-- 询价日志记下这次的路线：用没用到、从哪里来（缓存 / 谷歌）、里程时长，或取不到的原因代码（降级原因）。M2-02 之前的行为 null
alter table quote_logs add column route jsonb;
alter table quote_logs add constraint quote_logs_route_object check (route is null or jsonb_typeof(route) = 'object');
