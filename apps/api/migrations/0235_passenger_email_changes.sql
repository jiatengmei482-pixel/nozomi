-- 运营「代客人改单」改乘客邮箱要双人复核（M4-31，ADR 0065）。
-- 平台表（和 view_link_requests 一样：发起、审核都是平台员工；供应商碰不到）。一次代改邮箱一行，另一位同事在「待审核」里批准时才改订单。
-- 新邮箱和发起时订单上的邮箱只在等审核期间留在这里（按乘客信息加密，ADR 0057），有结论后马上清掉；之后只剩打码的地址。不含任何数据。
create table passenger_email_changes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references order_sales (order_id),
  -- 发起时这张单的供应商：两个地址按它的密钥加密（救援后订单可能换了供应商，解密用的还是这一家）
  seal_tenant_id uuid not null references tenants (id),
  -- 新邮箱：加密时这一列是占位，原文在 email_enc；没配密钥时是原文。有结论后清空
  email text,
  email_enc text,
  email_masked text not null,
  -- 发起时订单上的邮箱：批准时比对，审核期间被客人或渠道改过的不能再批（ADR 0065）。有结论后清空
  previous_email text,
  previous_email_enc text,
  -- 发起时订单上的邮箱（打码）；原来没有邮箱时 null
  previous_email_masked text,
  -- @nozomi/domain 的 VIEW_LINK_VERIFICATIONS（核实方式和「发到新邮箱」同一套）
  verification text not null,
  approval_id uuid not null references approvals (id),
  -- pending_review：等审核；applied：批准后已改订单；dismissed：驳回或撤回
  status text not null,
  -- 批准时生效的那次改单（order_changes，联系信息，直接生效）
  change_id uuid,
  requested_by uuid not null references platform_users (id),
  created_at timestamptz not null,
  decided_at timestamptz,
  constraint passenger_email_changes_status_check check (status in ('pending_review', 'applied', 'dismissed')),
  constraint passenger_email_changes_verification_check check (verification in ('callback_phone', 'email_from_order_address', 'order_details', 'payment_details', 'other')),
  -- 只有等审核的那一段时间留着地址；等审核时一定有新邮箱
  constraint passenger_email_changes_cleared check (
    (status = 'pending_review' and email is not null and previous_email is not null)
    or (status <> 'pending_review' and email is null and email_enc is null and previous_email is null and previous_email_enc is null)
  ),
  constraint passenger_email_changes_applied check ((status = 'applied') = (change_id is not null)),
  constraint passenger_email_changes_decided check ((status = 'pending_review') = (decided_at is null))
);

create index passenger_email_changes_order_idx on passenger_email_changes (order_id, created_at desc);
create unique index passenger_email_changes_approval_key on passenger_email_changes (approval_id);
-- 一张单同一时间只有一条等审核的
create unique index passenger_email_changes_pending_key on passenger_email_changes (order_id) where status = 'pending_review';

grant select, insert, update on passenger_email_changes to nozomi_platform;
