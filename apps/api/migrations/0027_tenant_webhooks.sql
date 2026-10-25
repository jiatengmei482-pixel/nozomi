-- M3-02：推送给供应商（租户 Webhook，ADR 0027）。需求：《用车报价服务平台》「8. 订单与履约」（有自己调度系统的租户用 Webhook 收单）、
-- 「11. 账号、权限与 API 设置」（Webhook：填地址、选订阅事件、查看投递记录和失败原因、手动重发、发送测试事件）、「数据模型」webhook_subscription / webhook_delivery。
-- 三张都是租户表（订阅和投递记录属于供应商，供应商后台要看）：带 tenant_id、行级安全。平台的推送任务跨租户投递、运营后台查看和手动重推，另有平台角色的策略。
-- 只建结构，不写任何数据。

-- 订阅：一个供应商一个接收地址
create table tenant_webhooks (
  tenant_id uuid not null references tenants (id),
  url text not null,
  -- 订阅的事件（@nozomi/domain 的 TENANT_WEBHOOK_EVENTS），至少一个
  events text[] not null,
  -- 签名密钥：要用原文算签名，所以不能只存哈希；用 DATA_ENCRYPTION_KEY 派生的密钥 AES-256-GCM 加密后存（ADR 0027）。原文只在生成的那一次应答里出现
  secret_ciphertext text not null,
  -- 密钥末 4 位（后台显示用，认得出是哪一把）
  secret_hint text not null,
  secret_created_at timestamptz not null,
  -- active 推送 / paused 暂停（暂停期间新事件不排队）
  status text not null,
  version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id),
  constraint tenant_webhooks_url_https check (url ~ '^https://' and char_length(url) <= 2048),
  constraint tenant_webhooks_events_not_empty check (cardinality(events) between 1 and 20),
  constraint tenant_webhooks_secret_format check (secret_ciphertext ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' and char_length(secret_hint) = 4),
  constraint tenant_webhooks_status_check check (status in ('active', 'paused')),
  constraint tenant_webhooks_version_positive check (version >= 1)
);

alter table tenant_webhooks enable row level security;
create policy tenant_webhooks_same_tenant on tenant_webhooks to nozomi_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());
grant select, insert, update, delete on tenant_webhooks to nozomi_app;
-- 推送任务要读地址和加密的密钥（在平台事务里，跨租户）
create policy tenant_webhooks_platform_read on tenant_webhooks for select to nozomi_platform using (true);
grant select on tenant_webhooks to nozomi_platform;

-- 投递：一个事件推给一个供应商一行。请求体在发送时按订单的当前内容现生成，这里不存（里面有乘客的姓名、电话），只存事件本身的少量信息
create table webhook_deliveries (
  tenant_id uuid not null references tenants (id),
  id uuid not null default gen_random_uuid(),
  -- 排队的先后：同一张订单的事件按它依次投递
  seq bigint generated always as identity,
  -- 事件编号（evt_ + 随机字符）：接收方用它去重；重试、手动重推都是同一个编号
  event_id text not null,
  event_type text not null,
  order_id uuid,
  -- 事件自己的少量信息：改派的 change、状态从什么到什么。没有乘客信息和金额
  event_data jsonb not null default '{}'::jsonb,
  -- pending 等待投递（含等待重试）/ succeeded 对方回了 2xx / failed 重试用完（进入异常，等人工重推）
  status text not null,
  attempts integer not null default 0,
  -- 下一次什么时候投；正在投递时是租约到期的时间（进程中途退出时，过了这个时间别的实例接着投）
  next_attempt_at timestamptz,
  last_attempt_at timestamptz,
  last_status_code integer,
  -- 最近一次失败的原因（WEBHOOK_TIMEOUT、WEBHOOK_HTTP_STATUS、WEBHOOK_TARGET_FORBIDDEN 等）
  last_error_code text,
  last_duration_ms integer,
  succeeded_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, order_id) references orders (tenant_id, id),
  constraint webhook_deliveries_event_id_format check (event_id ~ '^evt_[0-9a-z]{24}$'),
  constraint webhook_deliveries_event_data check (jsonb_typeof(event_data) = 'object'),
  constraint webhook_deliveries_status_check check (status in ('pending', 'succeeded', 'failed')),
  constraint webhook_deliveries_attempts check (attempts >= 0),
  constraint webhook_deliveries_schedule check ((status = 'pending') = (next_attempt_at is not null)),
  constraint webhook_deliveries_succeeded check ((status = 'succeeded') = (succeeded_at is not null)),
  constraint webhook_deliveries_failed check ((status = 'failed') = (failed_at is not null))
);

create unique index webhook_deliveries_event_key on webhook_deliveries (tenant_id, event_id);
create index webhook_deliveries_list_idx on webhook_deliveries (tenant_id, created_at desc, id desc);
create index webhook_deliveries_order_idx on webhook_deliveries (tenant_id, order_id, seq);
-- 推送任务跨租户取到期的投递（不以 tenant_id 开头的例外：定时任务不分租户）
create index webhook_deliveries_due_idx on webhook_deliveries (next_attempt_at) where status = 'pending';
-- 运营后台跨租户看最终失败的投递（同上）
create index webhook_deliveries_failed_idx on webhook_deliveries (failed_at desc, id desc) where status = 'failed';

alter table webhook_deliveries enable row level security;
create policy webhook_deliveries_same_tenant on webhook_deliveries to nozomi_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());
-- 供应商：派车、履约回传时排队（insert）；手动重推（update）；不删
grant select, insert, update on webhook_deliveries to nozomi_app;
-- 平台：付款确认时排队、推送任务投递和记结果、运营后台查看和手动重推
create policy webhook_deliveries_platform on webhook_deliveries to nozomi_platform using (true) with check (true);
grant select, insert, update on webhook_deliveries to nozomi_platform;

-- 每一次尝试：时间、耗时、状态码、失败原因、请求体的大小和指纹。不存请求体和应答的原文
create table webhook_attempts (
  tenant_id uuid not null references tenants (id),
  id uuid not null default gen_random_uuid(),
  delivery_id uuid not null,
  attempt_no integer not null,
  -- schedule 自动（含重试）/ manual 手动重推 / test 发送测试事件
  trigger text not null,
  started_at timestamptz not null,
  duration_ms integer not null,
  status_code integer,
  error_code text,
  -- 目标主机（不含路径和查询串）
  target_host text not null,
  request_bytes integer not null,
  request_sha256 text not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, delivery_id) references webhook_deliveries (tenant_id, id),
  constraint webhook_attempts_trigger_check check (trigger in ('schedule', 'manual', 'test')),
  constraint webhook_attempts_no_positive check (attempt_no >= 1),
  constraint webhook_attempts_outcome check ((status_code is not null) or (error_code is not null)),
  constraint webhook_attempts_sha256_format check (request_sha256 ~ '^[0-9a-f]{64}$')
);

create index webhook_attempts_delivery_idx on webhook_attempts (tenant_id, delivery_id, attempt_no);

alter table webhook_attempts enable row level security;
create policy webhook_attempts_same_tenant on webhook_attempts to nozomi_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());
-- 供应商「发送测试事件」时直接发并记一条
grant select, insert on webhook_attempts to nozomi_app;
create policy webhook_attempts_platform on webhook_attempts to nozomi_platform using (true) with check (true);
grant select, insert on webhook_attempts to nozomi_platform;
