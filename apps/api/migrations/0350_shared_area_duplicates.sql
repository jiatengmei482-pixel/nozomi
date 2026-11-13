-- M8-31b：区域共享库里「隐藏重复的一份、以后的引用指向另一份」（ADR 0083 补充，业主 2026-11-13 选 B）。只建一张平台表，不含任何数据。
--
-- 不动供应商的区域：areas 的行、图形、用途一概不改，被隐藏的区域在它自己的供应商那里照常可用、报价照常；
-- 已经从它引用的副本来源不变（仍能看到它的新版本、仍能切换）。隐藏只影响共享库的列表、详情、查相似，
-- 以及以后的引用（引用被隐藏的那份时，改为引用保留的那份）。
--
-- 一次标记一行：被隐藏的区域、保留的区域、谁在什么时候为什么标的；撤销时记谁在什么时候为什么撤销，行留下做历史。
-- 两个区域都在供应商名下（租户表），所以不加外键（和 0340 的 shared_source_area_id 同样考虑）；存在与否、是否在库里由服务层在标记时检查。
create table shared_area_duplicates (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null,
  keep_area_id uuid not null,
  reason text not null,
  marked_by uuid not null references platform_users (id),
  marked_at timestamptz not null,
  revoked_by uuid references platform_users (id),
  revoked_at timestamptz,
  revoke_reason text,
  constraint shared_area_duplicates_distinct check (area_id <> keep_area_id),
  constraint shared_area_duplicates_reason_check check (char_length(reason) between 1 and 500),
  constraint shared_area_duplicates_revoke_check check (
    (revoked_at is null and revoked_by is null and revoke_reason is null)
    or (revoked_at is not null and revoked_by is not null and (revoke_reason is null or char_length(revoke_reason) between 1 and 500))
  )
);

-- 一个区域同一时间最多被隐藏一次
create unique index shared_area_duplicates_active_idx on shared_area_duplicates (area_id) where revoked_at is null;
-- 「有没有别的区域指向它」：保留的那份不能再被标成重复（不形成链）
create index shared_area_duplicates_keep_idx on shared_area_duplicates (keep_area_id) where revoked_at is null;
create index shared_area_duplicates_history_idx on shared_area_duplicates (area_id, marked_at desc);

-- 平台表：只给平台角色读、新增、改（撤销）；不删。租户角色没有任何权限——共享库的读取在平台事务里做（0016、0340）。
grant select, insert, update on shared_area_duplicates to nozomi_platform;
