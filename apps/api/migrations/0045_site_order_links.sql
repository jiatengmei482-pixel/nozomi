-- 官网的订单查看链接（M3-05，ADR 0032）：客人下单后、或用订单号 + 联系方式找回时拿到一个令牌，凭它看自己的这一张单。
-- 平台表（官网是一个渠道，链接是平台发给客人的，不属于中标供应商）；库里只存令牌的 SHA-256，原文只在应答里出现一次。
-- 只追加：到有效期自然失效。不含任何数据。
create table site_order_links (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references order_sales (order_id),
  token_hash text not null,
  -- order：下单时发的；lookup：用订单号和联系方式找回时发的
  issued_via text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  constraint site_order_links_token_hash_key unique (token_hash),
  constraint site_order_links_issued_via_check check (issued_via in ('order', 'lookup')),
  constraint site_order_links_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint site_order_links_expiry check (expires_at > created_at)
);

create index site_order_links_order_idx on site_order_links (order_id, created_at);

grant select, insert on site_order_links to nozomi_platform;
