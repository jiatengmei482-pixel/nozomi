-- M9E-02：嵌入组件的嵌入码与域名白名单、来源记录（ADR 0090 第三节）。三张平台表，租户角色没有任何权限；只建结构，不含任何数据（不预置嵌入码）。
--
-- embed_keys：一个合作网站（或一组网站）一行。key 是公开标识（写在合作网站页面里），不是密钥；allowed_origins 存规范化后的 origin。
-- quote_embed_sources：官网询价带了有效的预订草稿时，这次询价返回的每个报价记下草稿的来源（不进报价快照、不影响价格）。
-- order_embed_sources：下单时按报价的来源再核一次「嵌入码仍启用、来源仍在当前白名单」，通过才记一行；没有这一行的订单就是主站来的。
-- 来源放在单独的平台表里而不是 orders / quotes 的列：租户角色能读 orders、quotes，放在这里从库权限上保证供应商看不到来源。
-- 来源只做统计，不作为分佣、结算或任何金额的依据（非浏览器程序可以伪造 Origin）。
create table embed_keys (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  allowed_origins text[] not null,
  default_lang text not null,
  default_services text[] not null,
  status text not null default 'active',
  note text,
  version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  created_by uuid not null references platform_users (id),
  updated_by uuid not null references platform_users (id),
  constraint embed_keys_key_format check (key ~ '^nze_[A-Za-z0-9_-]{32}$'),
  constraint embed_keys_name_length check (char_length(btrim(name)) between 1 and 60),
  constraint embed_keys_origins_count check (cardinality(allowed_origins) between 1 and 20),
  constraint embed_keys_lang check (default_lang in ('zh', 'ja', 'en')),
  constraint embed_keys_services check (cardinality(default_services) between 1 and 2 and default_services <@ array['transfer', 'charter']::text[]),
  constraint embed_keys_status check (status in ('active', 'disabled')),
  constraint embed_keys_note_length check (note is null or char_length(note) <= 500)
);

create table quote_embed_sources (
  quote_id text primary key references quotes (id),
  embed_key_id uuid not null references embed_keys (id),
  embed_origin text not null,
  return_url text,
  created_at timestamptz not null,
  constraint quote_embed_sources_return_url_length check (return_url is null or char_length(return_url) <= 2000)
);

create table order_embed_sources (
  order_id uuid primary key references order_sales (order_id),
  embed_key_id uuid not null references embed_keys (id),
  embed_origin text not null,
  return_url text,
  created_at timestamptz not null,
  constraint order_embed_sources_return_url_length check (return_url is null or char_length(return_url) <= 2000)
);

create index order_embed_sources_key_idx on order_embed_sources (embed_key_id, created_at desc);

alter table booking_drafts add constraint booking_drafts_embed_key_fk foreign key (embed_key_id) references embed_keys (id);

grant select, insert, update on embed_keys to nozomi_platform;
grant select, insert on quote_embed_sources to nozomi_platform;
grant select, insert on order_embed_sources to nozomi_platform;
