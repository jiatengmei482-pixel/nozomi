-- 司机链接邮件的修补（M4-27，ADR 0058）。不含预置数据。

-- send_failed：这次发信失败（包括正文发完才被拒、超时），这次生成的邮件链接作废，重试时另生成
alter table driver_links drop constraint driver_links_revoked;
alter table driver_links add constraint driver_links_revoked check (
  (revoked_at is null) = (revoke_reason is null) and (revoke_reason is null or revoke_reason in ('reassigned', 'reissued', 'manual', 'rescue', 'email_changed', 'cancelled', 'send_failed'))
);

-- 发起之后没有产生发送记录就结束了：展开时司机已经没有邮箱，或事件展开出错到上限。
-- 租户读不了发件箱，不写下来的话调度员只能看到「等待中」等 15 分钟。没有邮箱和令牌，只有错误码。
alter table driver_link_emails add column closed_code text;
alter table driver_link_emails add column closed_at timestamptz;
alter table driver_link_emails add constraint driver_link_emails_closed check ((closed_code is null) = (closed_at is null));

-- 只有后台任务（平台角色）写，只许改这两列；租户仍然只能追加
create policy driver_link_emails_platform_read on driver_link_emails for select to nozomi_platform using (true);
create policy driver_link_emails_platform_close on driver_link_emails for update to nozomi_platform using (true) with check (true);
grant select, update on driver_link_emails to nozomi_platform;
create trigger driver_link_emails_platform_columns
  before update of tenant_id, id, seq, order_id, assignment_id, driver_id, link_id, trigger, requested_by, requested_at on driver_link_emails
  for each statement execute function reject_platform_column_update();
