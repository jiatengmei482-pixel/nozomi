-- M2-04：渠道的 API 客户端与密钥、正式询价的报价快照（quote_id）、询价日志、/sales/v1 的限流计数（ADR 0023）。
-- 需求：《用车报价服务平台》「API 通用约定」（鉴权、限流）、「API · 销售端接口」、报价引擎第 12 步；《平台运营端与渠道对接》「数据模型」quote_log。
-- 全是平台表；租户角色没有任何权限。不含任何数据。

-- 渠道调用 /sales/v1 的凭据。密钥只在创建 / 轮换时显示一次，这里只存 SHA-256；后台只显示后 4 位
create table channel_api_clients (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels (id),
  -- 公开的客户端编号（client_id）
  client_id text not null unique,
  name text not null,
  secret_hash text not null,
  secret_last4 text not null,
  -- 每轮换一次加一；访问令牌里带着它，轮换之后旧代次的令牌在宽限期后失效
  secret_generation integer not null default 1,
  -- 轮换前的那个密钥：宽限期内（previous_valid_until 之前）仍然能换令牌，让渠道有时间换上新密钥
  previous_secret_hash text,
  previous_valid_until timestamptz,
  status text not null default 'active',
  created_by uuid references platform_users (id),
  created_at timestamptz not null,
  rotated_at timestamptz,
  revoked_by uuid references platform_users (id),
  revoked_at timestamptz,
  last_used_at timestamptz,
  constraint channel_api_clients_status_check check (status in ('active', 'revoked')),
  constraint channel_api_clients_revoked check ((status = 'revoked') = (revoked_at is not null)),
  constraint channel_api_clients_previous check ((previous_secret_hash is null) = (previous_valid_until is null)),
  constraint channel_api_clients_name_length check (char_length(name) between 1 and 100)
);

create index channel_api_clients_channel_idx on channel_api_clients (channel_id, created_at desc);

-- 询价日志：每次 /sales/v1/quotes 一行。bids 是每个车型组的全部候选和排序依据，rejects 是每个没报出价的商品和原因（平台内部，不给渠道看）
create table quote_logs (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels (id),
  api_client_id uuid not null references channel_api_clients (id),
  created_at timestamptz not null,
  request jsonb not null,
  currency text not null,
  city_id uuid not null references cities (id),
  category text not null,
  candidate_count integer not null,
  quote_count integer not null,
  bids jsonb not null,
  rejects jsonb not null,
  duration_ms integer not null,
  -- 有没有下单（订单任务 M3-01 写）
  ordered boolean not null default false,
  constraint quote_logs_json check (jsonb_typeof(bids) = 'array' and jsonb_typeof(rejects) = 'array')
);

create index quote_logs_channel_idx on quote_logs (channel_id, created_at desc, id desc);
create index quote_logs_created_idx on quote_logs (created_at desc, id desc);

-- 报价快照：每个车型组（包车再按套餐）一个 quote_id，有效期 30 分钟；下单以它为准
create table quotes (
  id text primary key,
  channel_id uuid not null references channels (id),
  quote_log_id uuid not null references quote_logs (id),
  vehicle_group_id uuid not null references vehicle_groups (id),
  package_hours integer,
  winner_tenant_id uuid not null references tenants (id),
  product_id uuid not null,
  product_version integer not null,
  currency text not null,
  sell_minor bigint not null,
  settlement_minor bigint not null,
  settlement_currency text not null,
  markup_bp integer not null,
  markup_rule_id uuid references markup_rules (id),
  markup_level smallint not null,
  -- 完整的快照（domain 的 QuoteSnapshot + 渠道和加价规则的出处）；上面几列是从它抄出来、方便查询的
  snapshot jsonb not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  constraint quotes_id_format check (id ~ '^QT[0-9]{8}[0-9A-Z]{10}$'),
  constraint quotes_amounts check (sell_minor > 0 and settlement_minor > 0),
  constraint quotes_expiry check (expires_at > created_at)
);

create index quotes_channel_idx on quotes (channel_id, created_at desc);
create index quotes_log_idx on quotes (quote_log_id);

-- /sales/v1 的限流计数（固定时间窗，和登录限速同一种做法：先占用一次，再判断）
create table sales_rate_limits (
  bucket text primary key,
  window_started_at timestamptz not null,
  attempt_count integer not null
);

grant select, insert, update on channel_api_clients to nozomi_platform;
grant select, insert on quote_logs to nozomi_platform;
grant select, insert on quotes to nozomi_platform;
grant select, insert, update on sales_rate_limits to nozomi_platform;
