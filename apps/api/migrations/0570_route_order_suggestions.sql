-- 包车经停顺序建议（M9P-20 P2，ADR 0096 第三节；0500 / 0510 / 0520 已被别的任务占用或预留）：建议顺序的缓存、优化调用的每日计数。
-- 全是平台表，租户角色没有任何权限。不含任何数据。

-- 一段的建议顺序：键是 domain 的 orderSuggestionCacheKey（`opt:v1:起点|终点|段内可动经停取整后排序拼接`，同一组点不同顺序同一个键）。
-- 成功的存「按建议顺序排好的取整坐标列表」（ordered_points），保留 24 小时；没有可行路线、坐标无效的存原因代码，保留 1 天。
-- 缓存条款（建议顺序由 optimizedIntermediateWaypointIndex 推出，灰色地带）交 M10-01 一并核实（ADR 0096 第八节第 3 条）。只存顺序，不存报价、不存密钥。
create table route_order_suggestions (
  cache_key text primary key,
  ordered_points jsonb,
  failure_code text,
  fetched_at timestamptz not null,
  expires_at timestamptz not null,
  constraint route_order_suggestions_key_format check (cache_key ~ '^opt:v1:-?[0-9]{1,3}\.[0-9]{3},-?[0-9]{1,3}\.[0-9]{3}\|-?[0-9]{1,3}\.[0-9]{3},-?[0-9]{1,3}\.[0-9]{3}\|(-?[0-9]{1,3}\.[0-9]{3},-?[0-9]{1,3}\.[0-9]{3})(;-?[0-9]{1,3}\.[0-9]{3},-?[0-9]{1,3}\.[0-9]{3}){1,24}$'),
  constraint route_order_suggestions_outcome check ((ordered_points is null) <> (failure_code is null)),
  constraint route_order_suggestions_points check (ordered_points is null or (jsonb_typeof(ordered_points) = 'array' and jsonb_array_length(ordered_points) between 2 and 25)),
  constraint route_order_suggestions_failure_code check (failure_code is null or failure_code in ('NO_ROUTE', 'INVALID_POINTS')),
  constraint route_order_suggestions_expiry check (expires_at > fetched_at)
);

create index route_order_suggestions_expires_idx on route_order_suggestions (expires_at);

grant select, insert, update, delete on route_order_suggestions to nozomi_platform;

-- 每天（东京时间）发给谷歌的优化调用次数（每段一次、重试也各算一次）、失败、被每日上限挡下的次数，最近一次成功 / 失败。
-- 和路线预估的 route_api_usage 分开：优化用多了不挡报价要用的路线。运营后台「系统状态」看它。
create table route_optimize_api_usage (
  day date primary key,
  calls integer not null default 0,
  failures integer not null default 0,
  refused integer not null default 0,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_failure_code text,
  constraint route_optimize_api_usage_counts check (calls >= 0 and failures >= 0 and refused >= 0),
  constraint route_optimize_api_usage_failure check ((last_failure_at is null) = (last_failure_code is null)),
  constraint route_optimize_api_usage_failure_code check (last_failure_code is null or last_failure_code ~ '^[A-Z_]{1,40}$')
);

grant select, insert, update on route_optimize_api_usage to nozomi_platform;
