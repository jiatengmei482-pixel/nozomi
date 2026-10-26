-- 官网找回订单的失败记录（M3-05，ADR 0032「找回按订单号限速」）：每个订单号滚动 24 小时内失败满 100 次后，联系方式对上的也挡。
-- 滚动窗口要知道每一次失败的时间，所以一次失败一行（固定窗口的计数器 sales_rate_limits 做不到滚动）。
-- 平台表；bucket 是订单号的 SHA-256（不存原文）。超过 24 小时的行没用了，写入时顺手删掉，所以给平台角色 delete。不含任何数据。
create table site_lookup_failures (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  failed_at timestamptz not null,
  constraint site_lookup_failures_bucket_format check (bucket ~ '^[0-9a-f]{64}$')
);

create index site_lookup_failures_bucket_idx on site_lookup_failures (bucket, failed_at);
create index site_lookup_failures_failed_at_idx on site_lookup_failures (failed_at);

grant select, insert, delete on site_lookup_failures to nozomi_platform;
