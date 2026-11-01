-- 通知中心（M4-08，ADR 0049；0131–0139 留给别的任务）。不含任何数据：模板是代码常量。

-- 发件箱：和业务在同一个事务里写一行「发生了什么」。派车、回传履约等在租户事务里，所以租户角色能追加自己的，但读不了；
-- 谁该收到由后台任务在平台事务里决定（展开成 notifications）。`tenant_id` 只有平台员工的告警才为空（和 audit_logs 一样），由检查约束保证；
-- 订单事件的订单必须属于同一家（复合外键）；去重键按租户分域，一家占不了另一家的键。
create table notification_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants (id),
  event text not null,
  order_id uuid,
  -- 同一件事只入箱一次（Stripe 重发、任务重跑）
  dedupe_key text not null,
  -- 只放编号和枚举：不放邮箱、金额、令牌
  data jsonb not null,
  occurred_at timestamptz not null,
  expanded_at timestamptz,
  -- 展开时出错的次数和最后的错误码：出错次数到上限就不再处理，运营后台看得到（一条坏事件不卡住队列）
  expand_attempts integer not null default 0,
  expand_error text,
  constraint notification_events_tenant_id_id unique (tenant_id, id),
  constraint notification_events_dedupe_key unique (tenant_id, dedupe_key),
  constraint notification_events_tenant_order_fkey foreign key (tenant_id, order_id) references orders (tenant_id, id),
  constraint notification_events_staff_scope check ((tenant_id is null) = (event in ('exception.opened', 'fx.alert', 'site.lookup_ceiling'))),
  constraint notification_events_event_format check (event ~ '^[a-z_]+\.[a-z_]+$'),
  constraint notification_events_data_object check (jsonb_typeof(data) = 'object')
);

create unique index notification_events_platform_dedupe_key on notification_events (dedupe_key) where tenant_id is null;
create index notification_events_order_idx on notification_events (order_id, event);
create index notification_events_pending_idx on notification_events (occurred_at, id) where expanded_at is null;
create index notification_events_tenant_idx on notification_events (tenant_id, occurred_at desc);

alter table notification_events enable row level security;
create policy notification_events_same_tenant on notification_events for insert to nozomi_app with check (tenant_id = app_tenant_id());
create policy notification_events_platform on notification_events to nozomi_platform using (true) with check (true);
grant insert on notification_events to nozomi_app;
grant select, insert, update on notification_events to nozomi_platform;

-- 发送记录：一个接收人一行。没有主题和正文：发的时候现取现渲染，令牌不落库（ADR 0049「不存正文」）。
-- 发给客人的也带事件那一家的 tenant_id，但下面的限制性策略让供应商只读得到 audience = 'tenant' 的。
-- 单列外键保证事件存在（平台员工的记录 tenant_id 为空，复合外键不检查它们）；复合外键保证带租户的记录和事件是同一家。
create table notifications (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references notification_events (id),
  tenant_id uuid references tenants (id),
  event text not null,
  audience text not null,
  locale text not null,
  channel text not null,
  recipient text not null,
  order_id uuid,
  order_no text,
  status text not null,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null,
  lease_token uuid,
  lease_until timestamptz,
  -- 后台任务取走了但还没开始连邮件服务器：进程这时退出的话肯定没发出去，放回去等下一轮，不算「可能已发出」
  prepared_only boolean not null default false,
  last_error_code text,
  last_error_message text,
  message_id text,
  sent_at timestamptz,
  expires_at timestamptz not null,
  version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint notifications_one_per_recipient unique (event_id, audience, recipient),
  constraint notifications_audience_check check (audience in ('guest', 'tenant', 'staff')),
  constraint notifications_status_check check (status in ('pending', 'sending', 'sent', 'failed', 'expired')),
  constraint notifications_channel_check check (channel in ('email')),
  constraint notifications_recipient_not_blank check (length(btrim(recipient)) > 0),
  constraint notifications_attempts_range check (attempts >= 0),
  constraint notifications_sending_has_lease check (status <> 'sending' or (lease_token is not null and lease_until is not null)),
  constraint notifications_sent_has_time check (status <> 'sent' or sent_at is not null),
  constraint notifications_same_tenant_as_event foreign key (tenant_id, event_id) references notification_events (tenant_id, id),
  -- tenant_id 为空只有平台员工的记录；平台员工的记录也一定为空
  constraint notifications_tenant_audience check ((audience = 'staff') = (tenant_id is null))
);

create index notifications_created_idx on notifications (created_at desc, id desc);
create index notifications_tenant_idx on notifications (tenant_id, created_at desc, id desc);
create index notifications_order_idx on notifications (order_id, created_at desc);
create index notifications_order_no_idx on notifications (order_no, created_at desc);
create index notifications_due_idx on notifications (next_attempt_at, id) where status = 'pending';
create index notifications_lease_idx on notifications (lease_until) where status = 'sending';

alter table notifications enable row level security;
create policy notifications_same_tenant on notifications for select to nozomi_app using (tenant_id = app_tenant_id());
-- 这家供应商的单上发给客人的记录也带它的编号：限制性策略再挡一道，它只读得到发给自己的
create policy notifications_tenant_audience_only on notifications as restrictive for select to nozomi_app using (audience = 'tenant');
create policy notifications_platform on notifications to nozomi_platform using (true) with check (true);
grant select on notifications to nozomi_app;
grant select, insert, update on notifications to nozomi_platform;

-- 供应商的免打扰时段（东京时间 HH:mm；两项都空 = 不设）。平台任务发送前要读。
create table tenant_notification_settings (
  tenant_id uuid primary key references tenants (id),
  quiet_start text,
  quiet_end text,
  version integer not null default 1,
  updated_at timestamptz not null,
  constraint tenant_notification_settings_both check ((quiet_start is null) = (quiet_end is null)),
  constraint tenant_notification_settings_format check (
    (quiet_start is null or quiet_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') and (quiet_end is null or quiet_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') and (quiet_start is null or quiet_start <> quiet_end)
  ),
  constraint tenant_notification_settings_version_positive check (version >= 1)
);

alter table tenant_notification_settings enable row level security;
create policy tenant_notification_settings_same_tenant on tenant_notification_settings to nozomi_app using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
create policy tenant_notification_settings_platform_read on tenant_notification_settings for select to nozomi_platform using (true);
grant select, insert, update on tenant_notification_settings to nozomi_app;
grant select on tenant_notification_settings to nozomi_platform;

-- 邮件里的查看链接（ADR 0032「以后通知中心发确认邮件时另生成一个」）
alter table site_order_links drop constraint site_order_links_issued_via_check;
alter table site_order_links add constraint site_order_links_issued_via_check check (issued_via in ('order', 'lookup', 'email'));
