-- M2-04：渠道、授权范围、加价规则、敏感操作双人复核（ADR 0023）。
-- 需求：《平台运营端与渠道对接》「渠道管理」「加价规则」「敏感操作双人复核」「汇率缓冲与加价下限」。
-- 全是平台表（不带 tenant_id、不开行级安全）：租户角色对它们没有任何权限（规则 4：租户看不到对外价和加价比例）。
-- 指向租户的列叫 supplier_tenant_id 而不叫 tenant_id：这些行是平台的配置，不属于那个租户，不能按租户表处理。
-- 不含任何数据：第一个渠道（自营官网）由运营在后台建。

create table channels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- own = 自营，api = API 分销商，ota = OTA（连接器），offline = 线下代理
  type text not null,
  -- testing = 测试（可以调接口联调），active = 启用，paused = 暂停（/sales/v1 一律拒绝）
  status text not null default 'testing',
  company text,
  contact_name text,
  contact_email text,
  contact_phone text,
  contract_ref text,
  notes text,
  -- 渠道与平台的对账币种
  settle_currency text not null,
  -- 可卖的租户：all = 全部，allow = 只卖 channel_tenants 里的，deny = channel_tenants 里的不卖
  tenant_scope text not null default 'all',
  -- 可卖的城市：all = 全部，listed = 只卖 channel_cities 里的
  city_scope text not null default 'all',
  categories text[] not null,
  -- 付款方式和额度：本期只存配置，下单（M3）时才用
  payment_mode text not null default 'prepaid',
  credit_limit_minor bigint,
  -- 定价参数（基点整数；金额是结算币种的最小货币单位）。改这几项要走双人复核
  default_markup_bp integer not null,
  markup_floor_bp integer not null,
  band_bp integer not null,
  min_margin_minor bigint not null default 0,
  -- 对外价取整：{ 客人支付币种: 取整单位（最小货币单位） }，向上取整
  sell_rounding jsonb not null default '{}'::jsonb,
  show_tenant_after_pay boolean not null default true,
  -- version：任何改动都加一（If-Match 用）；pricing_version：定价参数、加价规则、状态改了才加一（复核时核对发起后有没有被别人改过）
  version integer not null default 1,
  pricing_version integer not null default 1,
  created_by uuid references platform_users (id),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint channels_type_check check (type in ('own', 'api', 'ota', 'offline')),
  constraint channels_status_check check (status in ('testing', 'active', 'paused')),
  constraint channels_tenant_scope_check check (tenant_scope in ('all', 'allow', 'deny')),
  constraint channels_city_scope_check check (city_scope in ('all', 'listed')),
  constraint channels_categories_check check (cardinality(categories) between 1 and 3 and categories <@ array['airport_transfer', 'point_to_point', 'charter']::text[]),
  constraint channels_payment_mode_check check (payment_mode in ('prepaid', 'credit')),
  constraint channels_credit_limit_check check (credit_limit_minor is null or credit_limit_minor >= 0),
  constraint channels_currency_check check (settle_currency ~ '^[A-Z]{3}$'),
  -- 平台下限 10%：渠道的下限不得低于它，默认加价不得低于下限；价格带 0–5%
  constraint channels_floor_check check (markup_floor_bp >= 1000 and markup_floor_bp <= 100000),
  constraint channels_default_markup_check check (default_markup_bp >= markup_floor_bp and default_markup_bp <= 100000),
  constraint channels_band_check check (band_bp between 0 and 500),
  constraint channels_min_margin_check check (min_margin_minor >= 0),
  constraint channels_sell_rounding_check check (jsonb_typeof(sell_rounding) = 'object'),
  constraint channels_name_length check (char_length(name) between 1 and 100)
);

create unique index channels_name_key on channels (lower(name));
create index channels_updated_idx on channels (updated_at desc, id desc);

-- 授权范围里的租户名单（白名单或黑名单）和城市名单；每次保存整体替换
create table channel_tenants (
  channel_id uuid not null references channels (id),
  supplier_tenant_id uuid not null references tenants (id),
  primary key (channel_id, supplier_tenant_id)
);

create table channel_cities (
  channel_id uuid not null references channels (id),
  city_id uuid not null references cities (id),
  primary key (channel_id, city_id)
);

-- 加价规则（五级，见 packages/domain/src/channels.ts）。删除是软删除（deleted_at），报价快照里引用的规则编号始终查得到
create table markup_rules (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels (id),
  level smallint not null,
  supplier_tenant_id uuid references tenants (id),
  city_id uuid references cities (id),
  category text,
  vehicle_group_id uuid references vehicle_groups (id),
  markup_bp integer not null,
  -- 用车日期（城市当地）的范围，两端都含；null = 不限
  valid_from date,
  valid_to date,
  note text,
  version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  constraint markup_rules_level_dims check (
    (level = 1 and supplier_tenant_id is not null and city_id is not null and category is not null and vehicle_group_id is not null) or
    (level = 2 and supplier_tenant_id is not null and city_id is null and category is null and vehicle_group_id is null) or
    (level = 3 and supplier_tenant_id is null and city_id is not null and category is not null and vehicle_group_id is not null) or
    (level = 4 and supplier_tenant_id is null and city_id is not null and category is not null and vehicle_group_id is null) or
    (level = 5 and supplier_tenant_id is null and city_id is null and category is null and vehicle_group_id is null and (valid_from is not null or valid_to is not null))
  ),
  constraint markup_rules_category_check check (category is null or category in ('airport_transfer', 'point_to_point', 'charter')),
  -- 平台下限 10%；不低于渠道下限由业务层在保存（批准）时检查——渠道下限会变
  constraint markup_rules_markup_check check (markup_bp >= 1000 and markup_bp <= 100000),
  constraint markup_rules_dates_check check (valid_from is null or valid_to is null or valid_from <= valid_to),
  constraint markup_rules_note_length check (note is null or char_length(note) <= 200)
);

create index markup_rules_channel_idx on markup_rules (channel_id, level) where deleted_at is null;

-- 敏感操作双人复核（通用）：发起 → 另一个人批准（改动在同一个事务里生效）/ 驳回；发起人可以撤回
create table approvals (
  id uuid primary key default gen_random_uuid(),
  -- 哪一类操作，如 channel.pricing、markup_rule.create（apps/api/src/services/approvals.ts 的登记表）
  kind text not null,
  -- 改的是什么（审计日志的口径）：resource 如 channel，resource_id 是它的编号
  resource text not null,
  resource_id text not null,
  -- 给人看的一句话说明
  summary text not null,
  -- 要改成什么、改之前是什么（白名单字段）
  payload jsonb not null,
  before jsonb,
  -- 发起时对象的版本：批准时不一致说明发起后被别人改过，不能照旧生效
  base_version integer,
  status text not null default 'pending',
  requested_by uuid not null references platform_users (id),
  requested_at timestamptz not null,
  request_note text,
  decided_by uuid references platform_users (id),
  decided_at timestamptz,
  decision_note text,
  constraint approvals_status_check check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  -- 双人复核：批准、驳回的人不能是发起人（撤回的没有审核人）
  constraint approvals_two_people check (decided_by is null or decided_by <> requested_by),
  constraint approvals_decided check ((status = 'pending') = (decided_at is null) and (status in ('approved', 'rejected')) = (decided_by is not null)),
  constraint approvals_note_length check ((request_note is null or char_length(request_note) <= 500) and (decision_note is null or char_length(decision_note) <= 500))
);

create index approvals_status_idx on approvals (status, requested_at desc, id desc);
create index approvals_resource_idx on approvals (resource, resource_id, requested_at desc);

-- 平台：渠道和加价规则只增改不删（规则是软删除）；授权名单整体替换，所以能删；复核记录只增改（结论）
grant select, insert, update on channels to nozomi_platform;
grant select, insert, delete on channel_tenants to nozomi_platform;
grant select, insert, delete on channel_cities to nozomi_platform;
grant select, insert, update on markup_rules to nozomi_platform;
grant select, insert, update on approvals to nozomi_platform;
