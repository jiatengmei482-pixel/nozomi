-- 司机链接跟着订单走（M4-29，ADR 0060）：有效期跟随当前用车时间，取消即失效。不含预置数据。

-- 改期生效时要重算有效期：平台角色多能改 expires_at（只有 extendDriverLinks 这一处写）
drop trigger driver_links_platform_columns on driver_links;
create trigger driver_links_platform_columns
  before update of tenant_id, id, order_id, assignment_id, driver_id, token_hash, created_at, last_used_at, purpose on driver_links
  for each statement execute function reject_platform_column_update();

-- cancelled：订单取消，这一单的链接全部作废
alter table driver_links drop constraint driver_links_revoked;
alter table driver_links add constraint driver_links_revoked check (
  (revoked_at is null) = (revoke_reason is null) and (revoke_reason is null or revoke_reason in ('reassigned', 'reissued', 'manual', 'rescue', 'email_changed', 'cancelled'))
);

-- 这之前就取消了的单：链接一起作废，吊销时间记订单取消的时间
update driver_links l set revoked_at = o.cancelled_at, revoke_reason = 'cancelled'
  from orders o
 where o.tenant_id = l.tenant_id and o.id = l.order_id and o.status = 'cancelled' and o.cancelled_at is not null and l.revoked_at is null;
