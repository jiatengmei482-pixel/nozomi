-- 人工报价申请带上整张行程单（M9T-08，ADR 0101 第十二节第 2 条）。只新增一张表，不改现有表（ADR 0101 硬约束：不给现有表加列），不含任何数据。
--
-- manual_quote_trip_links：客人从行程报价页转人工时带的行程单编号，一条申请最多一行（申请删了跟着删）。
-- trip_id 不设外键：行程单建单 30 天后由清理任务（M9T-05）删除，链接行留下，运营后台详情据此显示「行程单已清理」。
-- trip_id 是客人凭它访问行程单的凭证（bearer），只在运营后台详情里给员工看，不进日志、不进审计。
-- 每天各点的名称（客人页面上的文字）不在这里：和联系方式一起加密在 manual_quote_requests.contact_enc，随它一起清除。
create table manual_quote_trip_links (
  request_id uuid primary key references manual_quote_requests (id) on delete cascade,
  -- 同 trips.id 的写法（32 字节随机数的 base64url）
  trip_id text not null,
  -- 客人当时看的方案（trip_plans.kind）；没指定为空
  plan_kind text,
  created_at timestamptz not null default now(),
  constraint manual_quote_trip_links_trip_id_check check (trip_id ~ '^[A-Za-z0-9_-]{43}$'),
  constraint manual_quote_trip_links_plan_kind_check check (plan_kind is null or plan_kind in ('one_car', 'daily_best'))
);

-- 平台表（同 manual_quote_requests）：提交时写一行；不改、不删（申请行不删，级联只是兜底）
grant select, insert on manual_quote_trip_links to nozomi_platform;
