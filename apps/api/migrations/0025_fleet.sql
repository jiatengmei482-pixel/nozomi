-- M3-02：司机和车辆（ADR 0027）。需求：《用车报价服务平台》「9. 司机管理」「10. 车辆管理」、「数据模型」新增租户表 driver / vehicle。
-- 两张都是租户表：带 tenant_id、主键和索引以它开头、开行级安全、策略只放行当前租户。只建结构，不写任何数据。
-- 不删除（订单引用着它们；需求「删除 = 停用」），所以租户角色没有 delete。平台角色只读：运营后台订单详情要显示派的是谁、哪辆车。

create table drivers (
  tenant_id uuid not null references tenants (id),
  id uuid not null default gen_random_uuid(),
  name text not null,
  -- 国际格式的电话（+ 国家码），去掉空格和连字符后存
  phone text not null,
  -- 会说的语言（主数据语言代码：ja、zh、en、ko），至少一种
  languages text[] not null,
  -- 驾照到期日：过期后不能被派单，到期前 30 天提醒
  license_expires_on date not null,
  -- 驾龄（年，选填）：金牌司机的审核依据之一
  driving_years integer,
  -- 金牌司机（按平台标准审核：驾龄 10 年以上、从业 5 年以上、连续 3 年无主动责任事故）
  gold boolean not null default false,
  -- active 在职 / disabled 停用
  status text not null,
  version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  constraint drivers_name_not_blank check (length(btrim(name)) > 0 and char_length(name) <= 100),
  constraint drivers_phone_format check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint drivers_languages_not_empty check (cardinality(languages) between 1 and 10),
  constraint drivers_driving_years_range check (driving_years is null or driving_years between 0 and 70),
  constraint drivers_status_check check (status in ('active', 'disabled')),
  constraint drivers_version_positive check (version >= 1)
);

-- 同一个供应商里一个电话只登记一位司机（同一个人不会被登记两次）
create unique index drivers_phone_key on drivers (tenant_id, phone);
create index drivers_name_idx on drivers (tenant_id, status, name, id);

alter table drivers enable row level security;
create policy drivers_same_tenant on drivers to nozomi_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());
grant select, insert, update on drivers to nozomi_app;
create policy drivers_platform_read on drivers for select to nozomi_platform using (true);
grant select on drivers to nozomi_platform;

create table vehicles (
  tenant_id uuid not null references tenants (id),
  id uuid not null default gen_random_uuid(),
  -- 车牌：去掉首尾空白、连续空白合并成一个后存
  plate text not null,
  -- 所属车型组（平台主数据）：派车时校验同级或升级
  vehicle_group_id uuid not null references vehicle_groups (id),
  -- 品牌车型（如「丰田埃尔法」）、颜色
  model text not null,
  color text not null default '',
  seats integer not null,
  -- 累计里程（公里）：小于 5 万公里算新车
  mileage_km integer not null,
  -- business 营业牌照（日本的绿牌）/ private 非营业牌照：非营业牌照不能设为可用、不能被派单
  plate_type text not null,
  insurance_expires_on date not null,
  inspection_expires_on date not null,
  -- available 可用 / maintenance 维修 / disabled 停用
  status text not null,
  version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  constraint vehicles_plate_not_blank check (length(btrim(plate)) > 0 and char_length(plate) <= 20),
  constraint vehicles_model_not_blank check (length(btrim(model)) > 0 and char_length(model) <= 100),
  constraint vehicles_color_length check (char_length(color) <= 30),
  constraint vehicles_seats_range check (seats between 2 and 60),
  constraint vehicles_mileage_range check (mileage_km between 0 and 3000000),
  constraint vehicles_plate_type_check check (plate_type in ('business', 'private')),
  constraint vehicles_status_check check (status in ('available', 'maintenance', 'disabled')),
  -- 需求「非营业牌照车辆不能启用」
  constraint vehicles_private_plate_not_available check (status <> 'available' or plate_type = 'business'),
  constraint vehicles_version_positive check (version >= 1)
);

create unique index vehicles_plate_key on vehicles (tenant_id, plate);
create index vehicles_plate_idx on vehicles (tenant_id, status, plate, id);

alter table vehicles enable row level security;
create policy vehicles_same_tenant on vehicles to nozomi_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());
grant select, insert, update on vehicles to nozomi_app;
create policy vehicles_platform_read on vehicles for select to nozomi_platform using (true);
grant select on vehicles to nozomi_platform;
