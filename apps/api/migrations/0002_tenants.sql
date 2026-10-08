-- M0-06：租户、租户用户、租户会话，以及行级安全（RLS，见 ADR 0003、ADR 0009）。
-- 这里不创建任何租户和用户：租户由平台员工通过 /platform/v1/tenants 创建。

-- 应用角色 nozomi_app：处理租户请求的事务用 `set local role nozomi_app` 切到它。
-- 它不是表的所有者、不是超级用户，所以行级安全策略对它一定生效；它不能登录，也没有密码。
-- 角色是整个数据库实例共用的，并行的迁移可能同时创建，所以「已存在」不算错。
-- 执行迁移的账号需要是超级用户或有 CREATEROLE 权限；都没有时，请数据库管理员先执行报错里给出的语句。
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'nozomi_app') then
    create role nozomi_app nologin;
  end if;
exception
  when duplicate_object or unique_violation then null;
  when insufficient_privilege then
    raise exception '当前数据库账号 % 没有创建角色的权限。请数据库管理员先执行：create role nozomi_app nologin; grant nozomi_app to %;',
      current_user, current_user;
end
$$;

-- 执行迁移的账号（也就是应用连接数据库的账号）必须能切换到 nozomi_app。超级用户本来就能，其他账号要授权。
do $$
begin
  if not pg_has_role(current_user, 'nozomi_app', 'SET') then
    execute format('grant nozomi_app to %I', current_user);
  end if;
exception
  when insufficient_privilege then
    raise exception '当前数据库账号 % 不能切换到角色 nozomi_app。请数据库管理员先执行：grant nozomi_app to %;',
      current_user, current_user;
end
$$;

do $$
begin
  execute format('grant usage on schema %I to nozomi_app', current_schema());
end
$$;

-- 当前事务所属的租户：由应用在事务开头用 set_config('app.tenant_id', …, true) 设置。
-- 没设置时返回 null，策略里的等值比较不成立，所以一行都看不到。
create function app_tenant_id() returns uuid
  language sql
  stable
  as $$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;

-- 租户角色清单。这是系统定义的常量，不是业务数据，所有租户共用，所以不带 tenant_id；
-- 来源：docs/requirements/01-tenant-and-quote-engine.md「11. 账号、权限与 API 设置」的角色表。
-- 与 packages/domain/src/access.ts 的 TENANT_ROLES 保持一致（有集成测试核对）。
create table tenant_roles (
  key text primary key,
  name text not null,
  sort_order integer not null unique
);

insert into tenant_roles (key, name, sort_order) values
  ('admin', '管理员', 1),
  ('pricing', '商品价格', 2),
  ('dispatch', '调度', 3),
  ('finance', '财务', 4),
  ('readonly', '只读', 5);

grant select on tenant_roles to nozomi_app;

-- 租户主体。本任务只有登录需要的最小字段；入驻流程的完整状态、资质、合同、评分属于 M4-01。
create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- active：正常；suspended：已被平台暂停。暂停不影响用户登录（暂停的租户继续履约已有订单），业务含义由 M4-01 实现
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenants_status_check check (status in ('active', 'suspended')),
  constraint tenants_name_not_blank check (length(btrim(name)) > 0)
);

create index tenants_created_idx on tenants (created_at, id);

-- 租户事务只能读到自己这一行，不能改。
alter table tenants enable row level security;
create policy tenants_own_row on tenants for select using (id = app_tenant_id());
grant select on tenants to nozomi_app;

create table tenant_users (
  tenant_id uuid not null references tenants (id),
  id uuid not null default gen_random_uuid(),
  email text not null,
  name text not null,
  role text not null references tenant_roles (key),
  -- invited：已邀请、还没设密码；active：在用；disabled：已停用
  status text not null,
  password_hash text,
  invite_token_hash text,
  invite_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  constraint tenant_users_status_check check (status in ('invited', 'active', 'disabled')),
  constraint tenant_users_email_lowercase check (email = lower(email)),
  constraint tenant_users_name_not_blank check (length(btrim(name)) > 0),
  constraint tenant_users_active_has_password check (status <> 'active' or password_hash is not null),
  constraint tenant_users_invite_complete check ((invite_token_hash is null) = (invite_expires_at is null))
);

-- 下面两个唯一索引不以 tenant_id 开头，是有意的例外（ADR 0009）：
-- 登录时只有邮箱、接受邀请时只有令牌，这两个入口在知道租户之前就要定位到用户，所以邮箱和令牌全平台唯一。
create unique index tenant_users_email_key on tenant_users (email);
create unique index tenant_users_invite_token_key on tenant_users (invite_token_hash)
  where invite_token_hash is not null;
create index tenant_users_created_idx on tenant_users (tenant_id, created_at, id);
create index tenant_users_role_idx on tenant_users (tenant_id, role, status);

alter table tenant_users enable row level security;
create policy tenant_users_same_tenant on tenant_users
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());
grant select, insert, update on tenant_users to nozomi_app;

-- 租户用户的登录会话。退出登录、停用账号、暂停租户时删除对应的行，令牌随即失效。
create table tenant_sessions (
  tenant_id uuid not null,
  id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, user_id) references tenant_users (tenant_id, id) on delete cascade
);

create index tenant_sessions_user_idx on tenant_sessions (tenant_id, user_id);

alter table tenant_sessions enable row level security;
create policy tenant_sessions_same_tenant on tenant_sessions
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());
grant select, insert, delete on tenant_sessions to nozomi_app;
