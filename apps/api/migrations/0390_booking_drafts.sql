-- M9E-01：预订草稿（ADR 0090 第二节）。平台表，不属于任何供应商，租户角色没有任何权限；只建结构，不含任何数据。
--
-- 嵌入组件把预订条件交给主站暂存，再跳 /book/new?draft=<id>。内容只有预订条件（@nozomi/domain 的 BookingDraft），
-- 不含价格和个人信息；2 小时有效，过期由清理任务删除（BookingDraftRetentionJobs）。
-- 来源三列（embed_key_id、embed_origin、return_url）由建草稿接口在服务端记下（M9E-02）；本迁移只建列，全为空。
-- 写入后不改：平台角色只给 select / insert / delete，不给 update。
create table booking_drafts (
  -- 32 字节随机数的 base64url（43 字符）：不可猜、不可枚举、不含时间
  id text primary key,
  content jsonb not null,
  embed_key_id uuid,
  embed_origin text,
  return_url text,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  constraint booking_drafts_id_check check (id ~ '^[A-Za-z0-9_-]{43}$'),
  -- 接口按 JSON.stringify 量 16 KB（domain 的 BOOKING_DRAFT_RULES.maxBytes）；jsonb 转文本会在键值之间加空格，这里留一倍余量，
  -- 只作兜底（坐标限定 7 位小数，不会再有 1e-300 展开成几百位的情况）
  constraint booking_drafts_content_size check (octet_length(content::text) <= 32768),
  constraint booking_drafts_return_url_length check (return_url is null or char_length(return_url) <= 2000),
  constraint booking_drafts_expiry_check check (expires_at > created_at)
);

-- 清理任务按到期时刻找过期的；M9E-02 按嵌入码数有效草稿
create index booking_drafts_expires_at_idx on booking_drafts (expires_at);
create index booking_drafts_embed_key_idx on booking_drafts (embed_key_id, expires_at) where embed_key_id is not null;

grant select, insert, delete on booking_drafts to nozomi_platform;
