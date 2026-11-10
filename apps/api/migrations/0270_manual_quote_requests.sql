-- 人工报价申请和官网设置（M8-21，ADR 0076）。三张平台表，租户角色没有任何权限；不含任何数据。
-- 编号：main 上最大是 0260；M8-20（ADR 0075）的未覆盖需求另用自己的编号，以后在它那边加一列可空的 manual_quote_request_id 指向这里。
--
-- manual_quote_requests：官网一家都报不出价时客人留的申请。一次提交一行。
-- 明文只有不指向个人的部分（用车类型、城市、用车时间、人数、行李、包车时长、有没有邮箱 / WhatsApp），列表和筛选用；
-- 联系方式（邮箱、WhatsApp）和两端地点（名称、坐标）一起加密在 contact_enc（按乘客信息的方案，ADR 0057），
-- 盲索引 email_bidx、whatsapp_bidx 用来按联系方式查找、限速和去重。
-- 保留期到了（结束 180 天、或提交 365 天）由清除任务把密文、盲索引清空并记 purged_at，行留下只做数量统计。
create table manual_quote_requests (
  id uuid primary key default gen_random_uuid(),
  -- MQ + 提交日 + 8 位，见 @nozomi/domain 的 MANUAL_QUOTE_NO_FORMAT
  request_no text not null unique,
  -- @nozomi/domain 的 MANUAL_QUOTE_STATUSES
  status text not null default 'new',
  category text not null,
  -- 页面当时选的城市（按坐标报价可能认不出城市）：限定了城市范围的员工按它筛
  city_id uuid references cities (id),
  -- 官网的渠道：限定了渠道范围的员工按它筛
  channel_id uuid not null references channels (id),
  -- 当地时间 YYYY-MM-DDTHH:mm
  service_local text not null,
  passengers integer not null,
  luggage integer not null,
  package_hours integer,
  has_email boolean not null,
  has_whatsapp boolean not null,
  contact_enc text,
  email_bidx text,
  whatsapp_bidx text,
  -- 去重：同一个联系方式、同一个行程 24 小时内只记一次（行程要点的 HMAC，不含明文）
  dedup_key text,
  consent_at timestamptz not null,
  assignee_id uuid references platform_users (id),
  version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  -- 进入「已转订单」「关闭」的时间；改回别的状态时清空
  finished_at timestamptz,
  purged_at timestamptz,
  constraint manual_quote_requests_status_check check (status in ('new', 'following', 'quoted', 'converted', 'closed')),
  constraint manual_quote_requests_category_check check (category in ('airport_transfer', 'point_to_point', 'charter')),
  constraint manual_quote_requests_service_local_check check (service_local ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$'),
  constraint manual_quote_requests_passengers_check check (passengers between 1 and 60),
  constraint manual_quote_requests_luggage_check check (luggage between 0 and 60),
  constraint manual_quote_requests_package_check check ((category = 'charter') = (package_hours is not null) and (package_hours is null or package_hours between 1 and 72)),
  constraint manual_quote_requests_contact_check check (has_email or has_whatsapp),
  constraint manual_quote_requests_finished_check check ((status in ('converted', 'closed')) = (finished_at is not null)),
  -- 没清除的一定有密文；清除了的密文、盲索引、去重键都不留
  constraint manual_quote_requests_purged_check check (
    (purged_at is null and contact_enc is not null)
    or (purged_at is not null and contact_enc is null and email_bidx is null and whatsapp_bidx is null and dedup_key is null)
  ),
  constraint manual_quote_requests_bidx_check check ((email_bidx is null or has_email) and (whatsapp_bidx is null or has_whatsapp))
);

create index manual_quote_requests_list_idx on manual_quote_requests (created_at desc, id desc);
create index manual_quote_requests_status_idx on manual_quote_requests (status, created_at desc, id desc);
create index manual_quote_requests_assignee_idx on manual_quote_requests (assignee_id, created_at desc) where assignee_id is not null;
create index manual_quote_requests_email_idx on manual_quote_requests (email_bidx) where email_bidx is not null;
create index manual_quote_requests_whatsapp_idx on manual_quote_requests (whatsapp_bidx) where whatsapp_bidx is not null;
create index manual_quote_requests_dedup_idx on manual_quote_requests (dedup_key, created_at desc) where dedup_key is not null;
-- 清除任务：没清除的按结束时间、提交时间找
create index manual_quote_requests_purge_finished_idx on manual_quote_requests (finished_at) where purged_at is null and finished_at is not null;
create index manual_quote_requests_purge_created_idx on manual_quote_requests (created_at) where purged_at is null;

-- 跟进记录：提交、改状态、指派、备注，一件事一行（只追加；清除时把备注的密文清空）。
-- 备注可能写进客人的姓名、电话，按同一个方案加密在 note_enc。
create table manual_quote_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references manual_quote_requests (id),
  kind text not null,
  from_status text,
  to_status text,
  -- 指派：指给谁（null = 取消指派）
  assignee_id uuid references platform_users (id),
  note_enc text,
  -- 做这件事的员工；提交那一条是客人，为 null
  actor_id uuid references platform_users (id),
  created_at timestamptz not null,
  constraint manual_quote_request_events_kind_check check (kind in ('created', 'status', 'assign', 'note')),
  constraint manual_quote_request_events_status_check check ((kind = 'status') = (from_status is not null and to_status is not null)),
  constraint manual_quote_request_events_note_check check (kind = 'note' or note_enc is null),
  constraint manual_quote_request_events_actor_check check ((kind = 'created') = (actor_id is null))
);

create index manual_quote_request_events_request_idx on manual_quote_request_events (request_id, created_at, id);

-- 官网设置：全站一份（只有一行，第一次保存时写入；不预置）。现在只有客服 WhatsApp 号码（纯数字，wa.me 的写法）。
create table site_settings (
  id boolean primary key default true,
  support_whatsapp text,
  version integer not null,
  updated_at timestamptz not null,
  updated_by uuid not null references platform_users (id),
  constraint site_settings_singleton check (id),
  constraint site_settings_whatsapp_check check (support_whatsapp is null or support_whatsapp ~ '^[1-9][0-9]{7,14}$')
);

grant select, insert, update on manual_quote_requests to nozomi_platform;
grant select, insert, update on manual_quote_request_events to nozomi_platform;
grant select, insert, update on site_settings to nozomi_platform;
