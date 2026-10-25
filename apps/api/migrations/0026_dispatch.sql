-- M3-02：派车、司机 H5、落地时间取证、no-show 证据（ADR 0027）。需求：《用车报价服务平台》「8. 订单与履约」（订单指派、改派、履约回传、客人未出现、落地时间）、
-- 「履约规则（已确认）」（派车截止时间、超时未派车、客人未出现、履约时间点）、「14. 补充功能」（实际落地时间登记、司机 H5）、
-- 「数据模型」新增租户表 assignment、order_evidence；《平台运营端与渠道对接》「免费等待与 no-show」「航班信息」；第五轮决策 ③。
-- 只建结构和授权，不写任何业务数据（已有订单的派车截止时间按规则补算，空库里一行都没有）。

-- ---- 订单：新的状态和履约字段 ----

alter table orders drop constraint orders_status_check;
alter table orders add constraint orders_status_check check (status in (
  'pending_payment', 'confirmed', 'assigned', 'departed', 'arrived', 'in_service', 'completed', 'no_show_claimed', 'no_show', 'cancelled', 'rescue_pending'
));

alter table orders
  -- 派车截止时间（付款确认时按规则算好：用车前 24 小时；付款时已不足 24 小时的，付款后 2 小时、不晚于用车时间）
  add column dispatch_due_at timestamptz,
  -- 系统发现「过了截止时间还没派车」的时间（提醒：供应商后台标红、运营看得到、服务日志告警）
  add column dispatch_overdue_at timestamptz,
  -- 系统发现「用车前 1 小时仍未出发」的时间（提醒）
  add column departure_overdue_at timestamptz,
  -- 当前派的司机和车辆（历次派车 / 改派在 order_assignments）
  add column driver_id uuid,
  add column vehicle_id uuid,
  add column assigned_at timestamptz,
  -- 履约时间点（系统收到的时间，不认手机时钟）
  add column departed_at timestamptz,
  add column arrived_at timestamptz,
  -- 「已到达」时的定位距上车点多少米（no-show 第 1 项：≤ 300 米）；没有定位为空
  add column arrival_distance_m integer,
  add column picked_up_at timestamptz,
  add column completed_at timestamptz,
  -- 完成时上报的实际时长（分钟）和里程（公里）：包车必填，其他选填
  add column actual_minutes integer,
  add column actual_km integer,
  -- 司机点「申请离开」的时间（no-show 第 4 项）
  add column leave_requested_at timestamptz,
  -- 落地时间（只有接机单）：客人点「我已落地」的时间、司机填写的时间（必须附到达屏照片），以及按规则取定的结果和来源。各自提交后不能改
  add column guest_landed_at timestamptz,
  add column driver_landed_at timestamptz,
  add column driver_landed_file_id uuid,
  add column landed_at timestamptz,
  add column landed_source text,
  add constraint orders_landed_source_check check (landed_source is null or landed_source in ('guest', 'driver', 'scheduled')),
  add constraint orders_landed_complete check ((landed_at is null) = (landed_source is null)),
  add constraint orders_driver_landed_photo check ((driver_landed_at is null) = (driver_landed_file_id is null)),
  add constraint orders_assignment_complete check ((driver_id is null) = (vehicle_id is null) and (driver_id is null) = (assigned_at is null)),
  add constraint orders_actual_range check ((actual_minutes is null or actual_minutes between 0 and 10080) and (actual_km is null or actual_km between 0 and 5000)),
  add constraint orders_arrival_distance check (arrival_distance_m is null or arrival_distance_m >= 0);

update orders set dispatch_due_at = case
    when confirmed_at <= service_at - interval '24 hours' then service_at - interval '24 hours'
    else least(confirmed_at + interval '2 hours', service_at)
  end
  where confirmed_at is not null;

alter table orders add constraint orders_dispatch_due check ((confirmed_at is null) = (dispatch_due_at is null));

-- 超时未派车、用车前 1 小时仍未出发的提醒：定时任务跨租户扫（不以 tenant_id 开头的例外：定时任务不分租户）
create index orders_dispatch_due_idx on orders (dispatch_due_at) where status = 'confirmed' and dispatch_overdue_at is null;
create index orders_departure_due_idx on orders (service_at) where status = 'assigned' and departure_overdue_at is null;
-- 派车时查「同一时段这位司机 / 这辆车有没有别的单」
create index orders_driver_idx on orders (tenant_id, driver_id, service_at) where driver_id is not null;
create index orders_vehicle_idx on orders (tenant_id, vehicle_id, service_at) where vehicle_id is not null;

-- 供应商派车、改派、回传履约状态：租户角色可以改订单，但只能改履约那几列（下面的触发器按语句检查）
create policy orders_tenant_fulfilment on orders for update to nozomi_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());
grant update on orders to nozomi_app;

create function reject_tenant_column_update() returns trigger
  language plpgsql
  as $$
begin
  if current_user = 'nozomi_app' then
    raise exception '供应商不能改 % 的这一列', tg_table_name using errcode = 'insufficient_privilege';
  end if;
  return null;
end
$$;

-- 订单本身的内容（行程、乘客、结算价、付款、确认 / 取消、截止时间、客人确认的落地时间）只有平台能改；供应商只能改派车和履约的列
create trigger orders_tenant_columns
  before update of tenant_id, id, order_no, category, city_id, place_id, direction, product_id, product_version, vehicle_group_id, package_hours,
                   service_at, service_local, timezone, service_date, urgent, passengers, luggage, pickup, dropoff, addons, driver_language, flight_no,
                   passenger, messaging, notes, settlement_minor, settlement_currency, settlement, free_wait_minutes, inventory_held, payment_due_at,
                   confirmed_at, cancelled_at, cancel_reason, created_at, dispatch_due_at, dispatch_overdue_at, departure_overdue_at, guest_landed_at
  on orders
  for each statement execute function reject_tenant_column_update();

-- ---- 状态流水：供应商和司机也会让状态变化 ----

alter table order_events drop constraint order_events_actor_check;
alter table order_events add constraint order_events_actor_check check (actor in ('channel', 'payment', 'system', 'platform_user', 'tenant_user', 'driver', 'guest'));
-- 补充信息（派车 / 改派的司机和车辆编号、谁操作的）：不放乘客信息和金额
alter table order_events add column detail jsonb;
alter table order_events add constraint order_events_detail check (detail is null or jsonb_typeof(detail) = 'object');

create policy order_events_tenant_append on order_events for insert to nozomi_app with check (tenant_id = app_tenant_id());
grant insert on order_events to nozomi_app;

-- ---- 派车记录：每次派车、改派一行（数据模型 assignment），只追加 ----

create table order_assignments (
  tenant_id uuid not null references tenants (id),
  id uuid not null default gen_random_uuid(),
  seq bigint generated always as identity,
  order_id uuid not null,
  driver_id uuid not null,
  vehicle_id uuid not null,
  -- 改派（不是第一次派车）
  is_change boolean not null,
  -- 用户确认过「同一时段已有订单」的提示后仍然派的
  conflict_confirmed boolean not null default false,
  assigned_at timestamptz not null,
  -- 谁派的：tenant_user（供应商后台或调度系统用账号调接口）
  actor_type text not null,
  actor_id uuid,
  primary key (tenant_id, id),
  foreign key (tenant_id, order_id) references orders (tenant_id, id),
  foreign key (tenant_id, driver_id) references drivers (tenant_id, id),
  foreign key (tenant_id, vehicle_id) references vehicles (tenant_id, id),
  constraint order_assignments_actor_check check (actor_type in ('tenant_user', 'platform_user'))
);

create index order_assignments_order_idx on order_assignments (tenant_id, order_id, seq);

alter table order_assignments enable row level security;
create policy order_assignments_same_tenant on order_assignments to nozomi_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());
grant select, insert on order_assignments to nozomi_app;
create policy order_assignments_platform_read on order_assignments for select to nozomi_platform using (true);
grant select on order_assignments to nozomi_platform;

alter table orders add foreign key (tenant_id, driver_id) references drivers (tenant_id, id);
alter table orders add foreign key (tenant_id, vehicle_id) references vehicles (tenant_id, id);

-- ---- 司机链接：司机不需要账号，派车后发一个有期限的链接（令牌只存 SHA-256），可吊销 ----

create table driver_links (
  tenant_id uuid not null references tenants (id),
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  assignment_id uuid not null,
  driver_id uuid not null,
  -- 令牌随机部分的 SHA-256（十六进制）；原文只在派车 / 重新生成的那一次应答里出现
  token_hash text not null,
  created_at timestamptz not null,
  -- 用车结束后 24 小时
  expires_at timestamptz not null,
  revoked_at timestamptz,
  -- reassigned 改派了 / reissued 重新生成了 / manual 手动吊销
  revoke_reason text,
  last_used_at timestamptz,
  primary key (tenant_id, id),
  foreign key (tenant_id, order_id) references orders (tenant_id, id),
  foreign key (tenant_id, assignment_id) references order_assignments (tenant_id, id),
  foreign key (tenant_id, driver_id) references drivers (tenant_id, id),
  constraint driver_links_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint driver_links_expiry check (expires_at > created_at),
  constraint driver_links_revoked check ((revoked_at is null) = (revoke_reason is null) and (revoke_reason is null or revoke_reason in ('reassigned', 'reissued', 'manual')))
);

create unique index driver_links_token_key on driver_links (tenant_id, token_hash);
create index driver_links_order_idx on driver_links (tenant_id, order_id, created_at);

alter table driver_links enable row level security;
create policy driver_links_same_tenant on driver_links to nozomi_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());
grant select, insert, update on driver_links to nozomi_app;

-- ---- 照片：到达屏、举牌、联系记录的截图（数据模型 order_evidence 的文件部分）。存在库里（ADR 0027：随数据库备份、多实例共用） ----

create table order_files (
  tenant_id uuid not null references tenants (id),
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  -- arrival_screen 到达屏（落地时间的证据）/ signboard 举牌照片（no-show 第 3 项）/ contact_screenshot 联系客人的截图（no-show 第 2 项）
  kind text not null,
  content_type text not null,
  byte_size integer not null,
  sha256 text not null,
  data bytea not null,
  -- 系统收到的时间：就是照片上的「系统时间」（不认手机时钟）
  uploaded_at timestamptz not null,
  -- 哪个司机链接上传的
  link_id uuid not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, order_id) references orders (tenant_id, id),
  foreign key (tenant_id, link_id) references driver_links (tenant_id, id),
  constraint order_files_kind_check check (kind in ('arrival_screen', 'signboard', 'contact_screenshot')),
  constraint order_files_content_type_check check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  constraint order_files_size check (byte_size between 1 and 5242880 and byte_size = octet_length(data)),
  constraint order_files_sha256_format check (sha256 ~ '^[0-9a-f]{64}$')
);

create index order_files_order_idx on order_files (tenant_id, order_id, uploaded_at);

alter table order_files enable row level security;
create policy order_files_same_tenant on order_files to nozomi_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());
grant select, insert on order_files to nozomi_app;
create policy order_files_platform_read on order_files for select to nozomi_platform using (true);
grant select on order_files to nozomi_platform;

alter table orders add foreign key (tenant_id, driver_landed_file_id) references order_files (tenant_id, id);

-- ---- 联系客人的记录（no-show 第 2 项：免费等待内至少 3 次） ----

create table order_contacts (
  tenant_id uuid not null references tenants (id),
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  -- phone 电话 / messaging 即时通讯
  method text not null,
  -- 截图（选填）
  file_id uuid,
  note text,
  -- 系统收到的时间
  occurred_at timestamptz not null,
  link_id uuid not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, order_id) references orders (tenant_id, id),
  foreign key (tenant_id, file_id) references order_files (tenant_id, id),
  foreign key (tenant_id, link_id) references driver_links (tenant_id, id),
  constraint order_contacts_method_check check (method in ('phone', 'messaging')),
  constraint order_contacts_note_length check (note is null or char_length(note) <= 200)
);

create index order_contacts_order_idx on order_contacts (tenant_id, order_id, occurred_at);

alter table order_contacts enable row level security;
create policy order_contacts_same_tenant on order_contacts to nozomi_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());
grant select, insert on order_contacts to nozomi_app;
create policy order_contacts_platform_read on order_contacts for select to nozomi_platform using (true);
grant select on order_contacts to nozomi_platform;

-- ---- 司机的定位（出发、到达、接到、完成时，以及服务中定时上报；用于 no-show 第 1 项和假履约核查） ----

create table order_locations (
  tenant_id uuid not null references tenants (id),
  id uuid not null default gen_random_uuid(),
  seq bigint generated always as identity,
  order_id uuid not null,
  -- departed / arrived / picked_up / completed / leave_requested / no_show / ping（定时上报）
  kind text not null,
  lng numeric(9, 6) not null,
  lat numeric(8, 6) not null,
  -- 手机报的精度（米）
  accuracy_m integer,
  recorded_at timestamptz not null,
  link_id uuid,
  primary key (tenant_id, id),
  foreign key (tenant_id, order_id) references orders (tenant_id, id),
  foreign key (tenant_id, link_id) references driver_links (tenant_id, id),
  constraint order_locations_kind_check check (kind in ('departed', 'arrived', 'picked_up', 'completed', 'leave_requested', 'no_show', 'ping')),
  constraint order_locations_range check (lng between -180 and 180 and lat between -90 and 90 and (accuracy_m is null or accuracy_m between 0 and 100000))
);

create index order_locations_order_idx on order_locations (tenant_id, order_id, seq);

alter table order_locations enable row level security;
create policy order_locations_same_tenant on order_locations to nozomi_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());
grant select, insert on order_locations to nozomi_app;
create policy order_locations_platform_read on order_locations for select to nozomi_platform using (true);
grant select on order_locations to nozomi_platform;

-- ---- no-show 申请：提交时 5 项证据的核对结果；审核（通过 / 驳回）在 M4-02 ----

create table order_no_show_claims (
  tenant_id uuid not null references tenants (id),
  order_id uuid not null,
  submitted_at timestamptz not null,
  -- 提交时逐项核对的结果：[{ item, ok }]
  checklist jsonb not null,
  -- 免费等待从什么时候开始、到什么时候结束（提交时算的）
  free_wait_start timestamptz not null,
  free_wait_end timestamptz not null,
  -- pending_review 待审核（M4-02 加通过 / 驳回）
  status text not null,
  link_id uuid not null,
  primary key (tenant_id, order_id),
  foreign key (tenant_id, order_id) references orders (tenant_id, id),
  foreign key (tenant_id, link_id) references driver_links (tenant_id, id),
  constraint order_no_show_claims_checklist check (jsonb_typeof(checklist) = 'array'),
  constraint order_no_show_claims_status_check check (status in ('pending_review')),
  constraint order_no_show_claims_window check (free_wait_end > free_wait_start)
);

alter table order_no_show_claims enable row level security;
create policy order_no_show_claims_same_tenant on order_no_show_claims to nozomi_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());
grant select, insert on order_no_show_claims to nozomi_app;
create policy order_no_show_claims_platform_read on order_no_show_claims for select to nozomi_platform using (true);
grant select on order_no_show_claims to nozomi_platform;
