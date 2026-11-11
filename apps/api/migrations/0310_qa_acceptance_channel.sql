-- 测试环境的验收通道（M8-26，ADR 0078）。只改结构，不含任何数据。编号：main 上最大是 0300（M8-16）。
--
-- 1. 商品多一个状态「验收可售」（qa_listed）：只有 QA 测试供应商（tenants.is_test_tenant，ADR 0077）的商品能处在这个状态。
--    普通的官网询价、销售端、平台试算只认「已上架」，永远看不到它；只有带有效验收会话的官网询价只看它。
-- 2. 验收单：orders.is_acceptance（只由服务端在下单时设，之后谁都改不了）；报价和询价日志同样标出来，验收的报价只能下成验收单。
--    验收单不进结算、账单、付款（出账的查询排除它）；只停用 / 取消，不删除。
-- 3. 验收会话：qa_acceptance_sessions，只存会话编号的 SHA-256，平台表。
-- 4. 验收单被压下没发的邮件：notification_suppressions 存这封的主题和正文（只给平台角色），运营后台可查。

alter table products drop constraint products_status_check;
alter table products add constraint products_status_check check (status in ('draft', 'published', 'unpublished', 'qa_listed'));

-- 数据库兜底：任何代码出错把别的供应商的商品写成「验收可售」都拒绝（服务层另有 409）。按行检查：供应商自己（租户角色只读得到自己这一行）和平台都能查到
create function products_qa_listed_test_tenant_only() returns trigger
  language plpgsql
  as $$
begin
  if new.status = 'qa_listed' and not exists (select 1 from tenants t where t.id = new.tenant_id and t.is_test_tenant) then
    raise exception '只有 QA 测试供应商的商品能设为「验收可售」' using errcode = 'check_violation', constraint = 'products_qa_listed_test_tenant_only';
  end if;
  return new;
end
$$;

create trigger products_qa_listed_test_tenant_only
  before insert or update of status, tenant_id on products
  for each row execute function products_qa_listed_test_tenant_only();

-- 反过来：还有「验收可售」商品的测试供应商不能被摘掉测试标记
create function tenants_keep_test_flag_with_qa_products() returns trigger
  language plpgsql
  as $$
begin
  if old.is_test_tenant and not new.is_test_tenant and exists (select 1 from products p where p.tenant_id = old.id and p.status = 'qa_listed') then
    raise exception '这家供应商还有「验收可售」的商品，不能去掉测试标记' using errcode = 'check_violation', constraint = 'products_qa_listed_test_tenant_only';
  end if;
  return new;
end
$$;

create trigger tenants_keep_test_flag_with_qa_products
  before update of is_test_tenant on tenants
  for each row execute function tenants_keep_test_flag_with_qa_products();

-- 验收单的标记：默认 false（以前的单、普通客人的单都不是）；建好之后谁都不能改（平台、供应商都不行）
alter table orders add column is_acceptance boolean not null default false;

create function orders_acceptance_immutable() returns trigger
  language plpgsql
  as $$
begin
  if new.is_acceptance is distinct from old.is_acceptance then
    raise exception '订单的「验收单」标记建好之后不能改' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create trigger orders_acceptance_immutable
  before update of is_acceptance on orders
  for each row execute function orders_acceptance_immutable();

-- 验收会话询出来的报价和那一次询价日志：验收的报价只能下成验收单，普通的报价不能下成验收单
alter table quotes add column is_acceptance boolean not null default false;
alter table quote_logs add column is_acceptance boolean not null default false;

-- 验收会话：浏览器里的 Cookie 是随机编号，库里只存它的 SHA-256（十六进制）；结束（DELETE）记 ended_at，过期的不再认。
-- key_fingerprint 是解锁时那个口令的指纹（加了用途前缀的 SHA-256，不是口令本身）：换了口令，旧会话立即作废
create table qa_acceptance_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null,
  key_fingerprint text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  ended_at timestamptz,
  constraint qa_acceptance_sessions_token_hash_key unique (token_hash),
  constraint qa_acceptance_sessions_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint qa_acceptance_sessions_fingerprint_format check (key_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint qa_acceptance_sessions_expiry check (expires_at > created_at),
  constraint qa_acceptance_sessions_end check (ended_at is null or ended_at >= created_at)
);

grant select, insert, update on qa_acceptance_sessions to nozomi_platform;

-- 验收单被压下没发的邮件（只给验收专用邮箱真的发）：这封的主题和正文留在这里，运营后台「发送记录」能查。
-- 平台表、只给平台角色：供应商读得到发给自己的发送记录（notifications），但读不到这里（正文里可能有客人的订单链接）
create table notification_suppressions (
  notification_id uuid primary key references notifications (id),
  subject text not null,
  body text not null,
  created_at timestamptz not null
);

grant select, insert on notification_suppressions to nozomi_platform;
