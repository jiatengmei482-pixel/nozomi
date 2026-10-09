-- M0-12：临时密码与首次登录强制修改密码（ADR 0013）。
--
-- 给平台员工和租户用户各加一个「必须先修改密码」标记。
-- 命令行用临时密码创建 / 重设超级管理员时置为 true；本人改了密码，或凭邀请 / 重置链接设了密码，回到 false。
-- 标记为 true 的账号登录后只能查看自己、修改密码、退出（在接口的鉴权层强制）。
--
-- 只加列，不写任何数据：已有账号都是 false。
-- 权限不用调整（ADR 0010）：三个权限角色的授权都是表级的，没有列级授权；
-- nozomi_platform 对 platform_users、tenant_users，nozomi_app 对 tenant_users 已有 select / update，
-- 读写这个新列用的就是它们；nozomi_preauth 仍然读不到这两张表。

alter table platform_users
  add column must_change_password boolean not null default false,
  -- 没设过密码的账号谈不上「先修改密码」：待激活的账号走邀请
  add constraint platform_users_must_change_needs_password check (not must_change_password or password_hash is not null);

alter table tenant_users
  add column must_change_password boolean not null default false,
  add constraint tenant_users_must_change_needs_password check (not must_change_password or password_hash is not null);
