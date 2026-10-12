-- M0-10：迁移账号与应用账号分开（ADR 0010）。
--
-- 此前服务进程用表的所有者连接数据库，只在租户事务里切换到 nozomi_app；平台操作直接以所有者身份执行。
-- 现在服务进程用一个自己没有任何表权限的应用账号连接，每个事务开头切换到下面三个角色之一：
--   nozomi_app       租户事务（迁移 0002 已创建，行级安全把读写限定在当前租户）
--   nozomi_platform  平台事务：平台员工的操作，可以跨租户
--   nozomi_preauth   登录前事务：登录限速、定位租户用户、匿名的登录失败记录、读迁移记录
-- 三个角色都不能登录、没有密码、不拥有任何表。应用账号本身（带密码、能登录）不在迁移里创建：
-- 迁移 SQL 里不能出现密码，它由 `pnpm db:provision` 创建并加入这三个角色。
--
-- 这里不改任何表结构，不写任何数据。

-- 角色是整个数据库实例共用的，并行的迁移可能同时创建，所以「已存在」不算错。
do $$
declare
  role_name text;
begin
  foreach role_name in array array['nozomi_platform', 'nozomi_preauth'] loop
    begin
      if not exists (select 1 from pg_roles where rolname = role_name) then
        execute format('create role %I nologin', role_name);
      end if;
    exception
      when duplicate_object or unique_violation then null;
      when insufficient_privilege then
        raise exception '当前数据库账号 % 没有创建角色的权限。请数据库管理员先执行：create role % nologin;',
          current_user, role_name;
    end;
  end loop;
end
$$;

do $$
begin
  execute format('grant usage on schema %I to nozomi_platform, nozomi_preauth', current_schema());
end
$$;

-- 原有的四条租户策略没有指定角色，对所有角色都生效。改成只对 nozomi_app 生效：
-- 每个角色能看到什么，只由写明给它的策略决定。
alter policy tenants_own_row on tenants to nozomi_app;
alter policy tenant_users_same_tenant on tenant_users to nozomi_app;
alter policy tenant_sessions_same_tenant on tenant_sessions to nozomi_app;
alter policy audit_logs_same_tenant on audit_logs to nozomi_app;

-- ---- nozomi_platform：平台员工的操作 ----
-- 平台账号与会话。
grant select, insert, update on platform_users to nozomi_platform;
grant select, insert, delete on platform_sessions to nozomi_platform;

-- 租户主体和租户用户：创建租户、暂停 / 恢复、邀请管理员、给管理员发重置令牌。
-- 这两张表开了行级安全，平台角色不是所有者，所以要有写明放行它的策略。
-- 平台角色碰不到租户会话（tenant_sessions）：没有授权，也没有策略。
grant select, insert, update on tenants to nozomi_platform;
create policy tenants_platform on tenants for all to nozomi_platform using (true) with check (true);

grant select, insert, update on tenant_users to nozomi_platform;
create policy tenant_users_platform on tenant_users for all to nozomi_platform using (true) with check (true);

-- 审计日志：只能追加和读。没有 update / delete / truncate 权限，策略也只放行这两种操作。
grant select, insert on audit_logs to nozomi_platform;
create policy audit_logs_platform_read on audit_logs for select to nozomi_platform using (true);
create policy audit_logs_platform_append on audit_logs for insert to nozomi_platform with check (true);

-- ---- nozomi_preauth：还不知道请求方是谁时能做的最少的事 ----
-- 登录限速计数（表里只有哈希后的 key）。
grant select, insert, update, delete on login_throttles to nozomi_preauth;

-- 匿名的登录失败记录：只能追加「不属于任何租户、操作者是匿名」的行，不能读。
grant insert on audit_logs to nozomi_preauth;
create policy audit_logs_preauth_anonymous on audit_logs for insert to nozomi_preauth
  with check (tenant_id is null and actor_type = 'anonymous');

-- /health 要读迁移记录来判断迁移是否执行完。
grant select on schema_migrations to nozomi_preauth;

-- 登录时只有邮箱、接受邀请时只有令牌，要在知道租户之前定位到用户（ADR 0009 的例外）。
-- 登录前的角色读不了 tenant_users；它只能调用下面两个函数，函数以所有者身份执行，只返回（租户编号，用户编号）。
create function locate_tenant_user_by_email(p_email text)
  returns table (tenant_id uuid, user_id uuid)
  language sql
  stable
  security definer
  as $$ select u.tenant_id, u.id from tenant_users u where u.email = p_email $$;

create function locate_tenant_user_by_invite_token(p_token_hash text)
  returns table (tenant_id uuid, user_id uuid)
  language sql
  stable
  security definer
  as $$ select u.tenant_id, u.id from tenant_users u where u.invite_token_hash = p_token_hash $$;

-- 以所有者身份执行的函数必须把查找路径固定在本库的 schema（临时表放最后），调用方改不了它查的是哪张表。
do $$
begin
  execute format('alter function locate_tenant_user_by_email(text) set search_path = %I, pg_temp', current_schema());
  execute format('alter function locate_tenant_user_by_invite_token(text) set search_path = %I, pg_temp', current_schema());
end
$$;

-- 函数默认所有人都能执行：收回，只给登录前的角色。
revoke all on function locate_tenant_user_by_email(text) from public;
revoke all on function locate_tenant_user_by_invite_token(text) from public;
grant execute on function locate_tenant_user_by_email(text) to nozomi_preauth;
grant execute on function locate_tenant_user_by_invite_token(text) to nozomi_preauth;
