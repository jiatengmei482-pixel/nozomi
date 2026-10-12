-- M0-06：平台员工账号、会话、登录限速。
-- 平台表不带 tenant_id。这里不创建任何账号：第一个超级管理员由 `pnpm admin:create` 创建。

-- 平台角色清单。这是系统定义的常量，不是业务数据；
-- 来源：docs/requirements/02-platform-operations.md「运营后台菜单与角色」的「平台角色」。
-- 与 packages/domain/src/access.ts 的 PLATFORM_ROLES 保持一致（有集成测试核对）。
create table platform_roles (
  key text primary key,
  name text not null,
  sort_order integer not null unique
);

insert into platform_roles (key, name, sort_order) values
  ('super_admin', '超级管理员', 1),
  ('operations', '运营', 2),
  ('tenant_onboarding', '招商', 3),
  ('channel_manager', '渠道经理', 4),
  ('customer_service', '客服', 5),
  ('finance', '财务', 6),
  ('risk', '风控', 7),
  ('master_data', '主数据运营', 8),
  ('tech', '技术', 9),
  ('readonly', '只读', 10);

create table platform_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null,
  role text not null references platform_roles (key),
  -- invited：已邀请、还没设密码；active：在用；disabled：已停用
  status text not null,
  -- 格式见 apps/api/src/auth/password.ts；只存哈希
  password_hash text,
  -- 一次性邀请令牌的 SHA-256；原文只在创建时返回一次
  invite_token_hash text,
  invite_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_users_status_check check (status in ('invited', 'active', 'disabled')),
  constraint platform_users_email_lowercase check (email = lower(email)),
  constraint platform_users_name_not_blank check (length(btrim(name)) > 0),
  constraint platform_users_active_has_password check (status <> 'active' or password_hash is not null),
  constraint platform_users_invite_complete check ((invite_token_hash is null) = (invite_expires_at is null))
);

create unique index platform_users_email_key on platform_users (email);
create unique index platform_users_invite_token_key on platform_users (invite_token_hash)
  where invite_token_hash is not null;
create index platform_users_created_idx on platform_users (created_at, id);

-- 登录会话。退出登录、停用账号时删除对应的行，令牌随即失效。
create table platform_sessions (
  id uuid primary key,
  user_id uuid not null references platform_users (id) on delete cascade,
  created_at timestamptz not null,
  expires_at timestamptz not null
);

create index platform_sessions_user_idx on platform_sessions (user_id);

-- 登录限速计数（平台和租户登录共用）。key 是「登录入口 + 邮箱 + 来源地址」等组合的 SHA-256，
-- 表里没有邮箱和地址的原文。规则见 packages/domain/src/login-throttle.ts。
create table login_throttles (
  key text primary key,
  attempt_count integer not null,
  window_started_at timestamptz not null,
  constraint login_throttles_count_positive check (attempt_count > 0)
);

create index login_throttles_window_idx on login_throttles (window_started_at);
