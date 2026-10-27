-- 官网的地址搜索和坐标反查（M3-12，ADR 0044；0111–0119 留给别的任务）：每天（东京时间的日期）调用谷歌的次数（搜索和反查合计，每次真正发出的请求，含重试）、
-- 失败次数、到了每日上限被挡下的次数，以及最近一次成功、最近一次失败（时间和原因代码）。到了每日上限官网就退回「从常用地点选」、地图点选和手填。
-- 和路线预估的计数（route_api_usage）分开：客人搜地址用多了不能挡住报价要用的路线。谷歌返回的名称、地址不存库（条款只允许缓存地点 ID 和坐标，见 ADR 0044）。
-- 平台表，租户角色没有任何权限。不含任何数据。
create table place_api_usage (
  day date primary key,
  calls integer not null default 0,
  failures integer not null default 0,
  refused integer not null default 0,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_failure_code text,
  constraint place_api_usage_counts check (calls >= 0 and failures >= 0 and refused >= 0),
  constraint place_api_usage_failure check ((last_failure_at is null) = (last_failure_code is null)),
  constraint place_api_usage_failure_code check (last_failure_code is null or last_failure_code ~ '^[A-Z_]{1,40}$')
);

grant select, insert, update on place_api_usage to nozomi_platform;
