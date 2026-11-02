-- 司机链接自动发邮件（M4-27，ADR 0058）。不含任何数据；旧数据默认：自动发送、司机没有邮箱、旧链接都是调度员的那种。

-- 司机邮箱（选填）：属于个人信息，只有管理员、调度能看全。检查约束是最后一道：写入前接口已校验，这里防控制字符进邮件头。
alter table drivers add column email text;
alter table drivers add constraint drivers_email_format check (
  email is null or (char_length(email) between 3 and 254 and email !~ '[[:cntrl:][:space:]]' and email ~ '^[^@]+@[^@]+$')
);

-- 供应商的发送方式：auto 系统自动发送 / manual 调度员手动发送。没有这一行也算 auto。
alter table tenant_notification_settings add column driver_link_delivery text not null default 'auto';
alter table tenant_notification_settings add constraint tenant_notification_settings_driver_link_delivery check (driver_link_delivery in ('auto', 'manual'));

-- 司机链接分两种：dispatcher 调度员手里那条（原文只在派车、重新生成的应答里）/ email 发邮件时才生成（原文只在要发出去的邮件内容里）。
-- 一单最多一条有效的 dispatcher，邮件的可以有多条；吊销是按订单一起的（不分种类）。
alter table driver_links add column purpose text not null default 'dispatcher';
alter table driver_links add constraint driver_links_purpose_check check (purpose in ('dispatcher', 'email'));
-- 平台角色只许改吊销的两列：新列也拦住
drop trigger driver_links_platform_columns on driver_links;
create trigger driver_links_platform_columns
  before update of tenant_id, id, order_id, assignment_id, driver_id, token_hash, created_at, expires_at, last_used_at, purpose on driver_links
  for each statement execute function reject_platform_column_update();
-- email_changed：司机改了邮箱，发到旧地址的那些链接作废（只作废邮件的那种）
alter table driver_links drop constraint driver_links_revoked;
alter table driver_links add constraint driver_links_revoked check (
  (revoked_at is null) = (revoke_reason is null) and (revoke_reason is null or revoke_reason in ('reassigned', 'reissued', 'manual', 'rescue', 'email_changed'))
);

-- 每次「要发一封」一行，和发件箱事件同一个事务写，主键就是事件编号。租户读不了发件箱，要靠它知道「等待中」、算限速。
-- link_id 是发起时调度员手里那条链接：它被吊销了，还在排队的信就不发。没有邮箱、没有令牌。只能追加。
create table driver_link_emails (
  tenant_id uuid not null references tenants (id),
  id uuid not null,
  seq bigint generated always as identity,
  order_id uuid not null,
  assignment_id uuid not null,
  driver_id uuid not null,
  link_id uuid not null,
  -- auto 派车、改派时系统发 / resend 调度员点重发
  trigger text not null,
  requested_by uuid,
  requested_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, id) references notification_events (tenant_id, id),
  foreign key (tenant_id, order_id) references orders (tenant_id, id),
  foreign key (tenant_id, assignment_id) references order_assignments (tenant_id, id),
  foreign key (tenant_id, driver_id) references drivers (tenant_id, id),
  foreign key (tenant_id, link_id) references driver_links (tenant_id, id),
  constraint driver_link_emails_trigger_check check (trigger in ('auto', 'resend')),
  constraint driver_link_emails_requested_by check ((trigger = 'resend') = (requested_by is not null))
);

create index driver_link_emails_order_idx on driver_link_emails (tenant_id, order_id, seq desc);
create index driver_link_emails_requested_idx on driver_link_emails (tenant_id, requested_at);

alter table driver_link_emails enable row level security;
create policy driver_link_emails_same_tenant on driver_link_emails to nozomi_app using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id());
grant select, insert on driver_link_emails to nozomi_app;

-- 发送记录多一种接收方：司机。地址不是乘客信息，不加密（ADR 0057）。
alter table notifications drop constraint notifications_audience_check;
alter table notifications add constraint notifications_audience_check check (audience in ('guest', 'tenant', 'staff', 'driver'));
-- 供应商要看到这一单发给司机的状态；发给客人的、发给员工的仍然读不到
drop policy notifications_tenant_audience_only on notifications;
create policy notifications_tenant_audience_only on notifications as restrictive for select to nozomi_app using (audience in ('tenant', 'driver'));
