-- M4-05：平台账号安全——两步验证（TOTP）和恢复码、IP 白名单、自建角色与数据范围（ADR 0030）。
-- 编号从 0040 起，避免和同时在开发的分支（0025–0028 等）撞号；合并时按实际顺序调整。
-- 只加结构，不写任何账号、角色、名单：已有的员工下次登录时由系统引导绑定两步验证。

-- ---- 角色：内置角色是只读模板，另外可以自建 ----
-- 内置角色（0001 写入的 10 个，来源是需求文档「运营后台菜单与角色」）的权限仍以代码（packages/domain/src/access.ts）为准，
-- 库里不存它们的勾选。自建角色存勾选（「菜单:操作」）、数据范围、IP 白名单；版本号给双人复核核对「发起之后有没有被改过」。
alter table platform_roles
  add column builtin boolean not null default true,
  add column description text,
  -- 自建角色勾选的「菜单:操作」，如 channels:edit；内置角色为 null
  add column grants text[],
  -- 数据范围：null = 不限制；数组 = 只看这几个（ADR 0030）。城市、渠道都不会被删除（只停用），所以不用外键
  add column scope_city_ids uuid[],
  add column scope_channel_ids uuid[],
  -- 角色的 IP 白名单（规范写法的 CIDR，由 domain 的 normalizeAllowlist 产生）；空 = 不限制
  add column ip_allowlist text[] not null default '{}',
  add column version integer not null default 1,
  add column created_by uuid references platform_users (id),
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now();

-- 自建角色没有排序号（按建立时间排在内置角色之后）
alter table platform_roles alter column sort_order drop not null;

-- 新加的列有默认值，0001 的 10 行由此成为内置角色；之后插入的行必须明确写 builtin = false（见下面的约束和触发器）
alter table platform_roles alter column builtin drop default;

alter table platform_roles
  add constraint platform_roles_kind_shape check (
    (builtin and sort_order is not null and grants is null and scope_city_ids is null and scope_channel_ids is null and ip_allowlist = '{}')
    or (not builtin and sort_order is null and grants is not null and key ~ '^custom_[0-9a-f]{16}$')
  ),
  add constraint platform_roles_name_length check (char_length(btrim(name)) between 1 and 50),
  add constraint platform_roles_description_length check (description is null or char_length(description) <= 500),
  add constraint platform_roles_grants_size check (grants is null or cardinality(grants) <= 100),
  add constraint platform_roles_scope_size check (
    (scope_city_ids is null or cardinality(scope_city_ids) <= 500) and (scope_channel_ids is null or cardinality(scope_channel_ids) <= 500)
  ),
  add constraint platform_roles_ip_allowlist_size check (cardinality(ip_allowlist) <= 50),
  add constraint platform_roles_version_positive check (version > 0);

-- 角色名不分大小写不能重复（含内置角色的名字）
create unique index platform_roles_name_key on platform_roles (lower(btrim(name)));

-- 内置角色不可修改、不可删除；也不能再插入新的内置角色（数据库兜底，接口层另有 409）
create function platform_roles_builtin_readonly() returns trigger
  language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.builtin then
      raise exception '内置角色只能由迁移写入' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if old.builtin then
    raise exception '内置角色是只读模板，不能修改或删除' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.builtin then
    raise exception '自建角色不能改成内置角色' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger platform_roles_builtin_readonly
  before insert or update or delete on platform_roles
  for each row execute function platform_roles_builtin_readonly();

-- ---- 平台员工：两步验证、IP 白名单 ----
alter table platform_users
  -- TOTP 密钥（Base32），用 DATA_ENCRYPTION_KEY 派生的密钥 AES-256-GCM 加密后存，附加数据是员工编号（apps/api/src/integrations/secret-box.ts）
  add column totp_secret text,
  add column totp_enabled_at timestamptz,
  -- 上次接受的时间窗编号（防重放：同一时间窗的码只能用一次）
  add column totp_last_step bigint,
  -- 正在绑定、还没确认的新密钥（同样加密）和它的有效期
  add column totp_pending_secret text,
  add column totp_pending_expires_at timestamptz,
  -- 员工自己的 IP 白名单（规范写法的 CIDR）；空 = 按角色的；都空 = 不限制
  add column ip_allowlist text[] not null default '{}',
  add constraint platform_users_totp_complete check ((totp_secret is null) = (totp_enabled_at is null)),
  add constraint platform_users_totp_pending_complete check ((totp_pending_secret is null) = (totp_pending_expires_at is null)),
  add constraint platform_users_totp_needs_password check (totp_secret is null or password_hash is not null),
  add constraint platform_users_ip_allowlist_size check (cardinality(ip_allowlist) <= 50);

-- ---- 会话：密码正确之后、两步验证完成之前是「待验证」 ----
-- 上线时已有的会话这一列为空，同样要先完成两步验证（绑定或输入动态码）才能继续用。
alter table platform_sessions
  add column mfa_verified_at timestamptz,
  -- totp / recovery_code / enrollment（刚绑定时输入的那一次）
  add column mfa_method text,
  add constraint platform_sessions_mfa_complete check ((mfa_verified_at is null) = (mfa_method is null)),
  add constraint platform_sessions_mfa_method check (mfa_method is null or mfa_method in ('totp', 'recovery_code', 'enrollment'));

-- ---- 一次性恢复码：只存 SHA-256，用一个少一个 ----
create table platform_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references platform_users (id) on delete cascade,
  -- 归一化之后（小写、去掉连字符）的恢复码的 SHA-256（十六进制）；原文只在生成的那一次应答里出现
  code_hash text not null,
  created_at timestamptz not null,
  used_at timestamptz,
  constraint platform_recovery_codes_hash_shape check (code_hash ~ '^[0-9a-f]{64}$')
);

create unique index platform_recovery_codes_hash_key on platform_recovery_codes (user_id, code_hash);

-- ---- 授权（ADR 0010） ----
-- 角色：读（每个请求按角色查权限）、自建、修改（复核通过时）、删除（没人用的自建角色）
grant select, insert, update, delete on platform_roles to nozomi_platform;
-- 会话：完成两步验证时改状态和过期时间
grant update on platform_sessions to nozomi_platform;
-- 恢复码：生成（整组替换，所以能删）、用掉时记时间
grant select, insert, update, delete on platform_recovery_codes to nozomi_platform;
