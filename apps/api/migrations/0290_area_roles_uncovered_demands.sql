-- 运营区域与报价区域分开，以及「未覆盖需求」（M8-20，ADR 0075）。只改结构，不写任何业务数据。
-- 编号：0270 是 M8-11 的，0280 由 M8-21 占用，这里用 0290。
--
-- 一、区域的用途 areas.role：operating（运营区域：只决定能不能接单，不带价格）/ pricing（报价区域：商品勾选后挂价格或加价）/
-- both（运营 + 报价）。现有的行由列默认值填成 both（报价逐分不变，证明见 ADR 0075 第三部分）；加完列马上去掉默认值，
-- 之后新建区域必须由应用写明用途。商品区域、价格规则、加价区域、线路价一行都不改。

alter table areas add column role text not null default 'both';
alter table areas add constraint areas_role_check check (role in ('operating', 'pricing', 'both'));
alter table areas alter column role drop default;

-- 报价时按供应商取「启用中的运营范围」（运营区域和运营 + 报价，不限城市）
create index areas_operating_idx on areas (tenant_id) where status = 'active' and role in ('operating', 'both');

-- 二、未覆盖需求：一次询价（官网、渠道）一个价都报不出时记一条（去重后同一条需求累加次数）。平台表，不带 tenant_id，
-- 只授权给平台角色；租户角色 nozomi_app 没有任何权限（ADR 0075 第四部分第 4 节）。
-- 不存任何客人个人信息：没有姓名、邮箱、电话、自由文本、IP、浏览器信息、会话编号、订单编号。坐标只存 4 位小数（约 10 米）。
-- 和 M8-21 的人工报价留资（含个人信息）没有外键：那张表在另一个分支，合并后由它那边加可空的关联列。
create table uncovered_demands (
  id uuid primary key default gen_random_uuid(),
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  repeat_count integer not null default 1,
  -- 去重的那一天（东京时间，第一次出现时）：同一天同一个指纹只有一行
  seen_on date not null,
  channel_kind text not null,
  channel_id uuid not null references channels (id),
  category text not null,
  -- 接送机的接 / 送；别的品类为空
  direction text,
  -- 包车的套餐时长；别的品类为空
  package_hours integer,
  -- 按哪个城市报的价（官网点对点出发地不在任何能订的城市里时为空）；接送机的机场
  city_id uuid references cities (id),
  airport_id uuid references places (id),
  pickup_lat numeric(7, 4),
  pickup_lng numeric(8, 4),
  dropoff_lat numeric(7, 4),
  dropoff_lng numeric(8, 4),
  -- 官网地址联想选中的那一项的名称、接送机机场那一端的机场名；渠道接口没有名称
  pickup_name text,
  dropoff_name text,
  -- 用车的当地时间 YYYY-MM-DDTHH:mm、日期
  service_local text not null,
  service_date date not null,
  passengers integer not null,
  luggage integer not null,
  vehicle_group_id uuid references vehicle_groups (id),
  -- 每一端落在哪些供应商的哪些运营区域里：[{ "tenant_id": ..., "area_id": ... }]
  pickup_operating jsonb not null default '[]',
  dropoff_operating jsonb not null default '[]',
  -- 上面两列里出现的供应商（去重），按供应商筛选用
  tenant_ids uuid[] not null default '{}',
  reason text not null,
  -- 全部拒绝原因 → 次数
  refusal_counts jsonb not null default '{}',
  fingerprint text not null,
  constraint uncovered_demands_seen check (last_seen_at >= first_seen_at and repeat_count >= 1),
  constraint uncovered_demands_channel_kind check (channel_kind in ('site', 'sales')),
  constraint uncovered_demands_category check (category in ('airport_transfer', 'point_to_point', 'charter')),
  constraint uncovered_demands_direction check ((direction is null) = (category <> 'airport_transfer') and (direction is null or direction in ('pickup', 'dropoff'))),
  constraint uncovered_demands_package check ((package_hours is null) = (category <> 'charter') and (package_hours is null or package_hours between 1 and 72)),
  constraint uncovered_demands_points check ((pickup_lat is null) = (pickup_lng is null) and (dropoff_lat is null) = (dropoff_lng is null)),
  constraint uncovered_demands_names check (char_length(pickup_name) between 1 and 200 and char_length(dropoff_name) between 1 and 200),
  constraint uncovered_demands_service check (service_local ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$' and passengers between 1 and 60 and luggage between 0 and 60),
  constraint uncovered_demands_operating check (jsonb_typeof(pickup_operating) = 'array' and jsonb_typeof(dropoff_operating) = 'array' and jsonb_typeof(refusal_counts) = 'object'),
  constraint uncovered_demands_reason check (reason in ('OUTSIDE_OPERATING', 'NO_PRICING_AREA', 'OTHER')),
  constraint uncovered_demands_fingerprint check (fingerprint ~ '^[0-9a-f]{64}$')
);

create unique index uncovered_demands_fingerprint_idx on uncovered_demands (fingerprint, seen_on);
-- 列表按最近出现从新到旧；保留期清理按最近出现
create index uncovered_demands_last_seen_idx on uncovered_demands (last_seen_at desc, id desc);
create index uncovered_demands_city_idx on uncovered_demands (city_id, last_seen_at desc);
create index uncovered_demands_tenants_idx on uncovered_demands using gin (tenant_ids);

grant select, insert, update, delete on uncovered_demands to nozomi_platform;

-- 新增行的限流（防刷）：固定时间窗计数（同 sales_rate_limits 的做法）。键里只有哈希（官网按客人地址的哈希、渠道按 API 客户端），
-- 不落 IP 原文；清理任务删掉 1 天以前的窗口。
create table uncovered_demand_limits (
  bucket text primary key,
  window_started_at timestamptz not null,
  attempt_count integer not null,
  constraint uncovered_demand_limits_count check (attempt_count >= 0)
);

create index uncovered_demand_limits_window_idx on uncovered_demand_limits (window_started_at);

grant select, insert, update, delete on uncovered_demand_limits to nozomi_platform;

-- 每天（东京时间）因为限流没有记下来的新需求条数（运营列表上显示）；和未覆盖需求一起保留 365 天
create table uncovered_demand_drops (
  day date primary key,
  dropped integer not null default 0,
  constraint uncovered_demand_drops_count check (dropped >= 0)
);

grant select, insert, update, delete on uncovered_demand_drops to nozomi_platform;
