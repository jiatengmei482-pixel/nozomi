-- 运营核实后把官网订单链接发给客人（M4-30，ADR 0061）。
-- 平台表（和 site_order_links 一样：链接是平台发给客人的，不属于中标供应商；供应商碰不到）。
-- 一次「重发」一行：发到下单邮箱的直接排进通知中心；发到核实后的新邮箱的要另一位同事审核，批准时才排进去。
-- 新邮箱只在等审核期间留在这里（按乘客信息加密，ADR 0057），有结论后马上清掉；之后只剩打码的地址。不含任何数据。
create table view_link_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references order_sales (order_id),
  -- 发起时这张单的供应商：新邮箱按它的密钥加密（救援后订单可能换了供应商，解密用的还是这一家）
  seal_tenant_id uuid not null references tenants (id),
  -- original：发到订单上的邮箱；new_email：发到核实后的新邮箱（要复核）
  target text not null,
  -- 新邮箱：加密时这一列是占位，原文在 recipient_enc；没配密钥时是原文。有结论后清空
  recipient text,
  recipient_enc text,
  recipient_masked text not null,
  -- @nozomi/domain 的 VIEW_LINK_VERIFICATIONS
  verification text not null,
  approval_id uuid references approvals (id),
  -- queued：已排进通知中心；pending_review：等审核；dismissed：驳回或撤回
  status text not null,
  -- 排进通知中心的那条事件
  notification_event_id uuid references notification_events (id),
  requested_by uuid not null references platform_users (id),
  created_at timestamptz not null,
  decided_at timestamptz,
  constraint view_link_requests_target_check check (target in ('original', 'new_email')),
  constraint view_link_requests_status_check check (status in ('queued', 'pending_review', 'dismissed')),
  constraint view_link_requests_verification_check check (verification in ('callback_phone', 'email_from_order_address', 'order_details', 'payment_details', 'other')),
  -- 发到原邮箱的不经复核、不留地址；发到新邮箱的一定有复核
  constraint view_link_requests_review check ((target = 'new_email') = (approval_id is not null)),
  constraint view_link_requests_recipient check (target = 'new_email' or (recipient is null and recipient_enc is null)),
  -- 只有等审核的那一段时间留着新邮箱
  constraint view_link_requests_recipient_cleared check (status = 'pending_review' or (recipient is null and recipient_enc is null)),
  constraint view_link_requests_queued check ((status = 'queued') = (notification_event_id is not null))
);

create index view_link_requests_order_idx on view_link_requests (order_id, created_at desc);
-- 一张单同一时间只有一条等审核的
create unique index view_link_requests_pending_key on view_link_requests (order_id) where status = 'pending_review';

grant select, insert, update on view_link_requests to nozomi_platform;
