/**
 * 数据库里的三个权限角色（ADR 0010）。它们都不能登录、没有密码、不拥有任何表，由迁移创建并按表授权。
 * 服务进程用的应用账号自己没有任何表权限，每个事务开头切换到其中之一（见 context.ts）。
 */

/** 租户事务：行级安全把读写限定在当前租户。迁移 0002 创建。 */
export const TENANT_DB_ROLE = "nozomi_app";
/** 平台事务：平台员工的操作，可以跨租户，但不是表的所有者，对审计日志只能追加和读。迁移 0005 创建。 */
export const PLATFORM_DB_ROLE = "nozomi_platform";
/** 登录前事务：还不知道是谁时能做的最少的事——登录限速、按邮箱 / 邀请令牌定位用户、记匿名的登录失败。迁移 0005 创建。 */
export const PREAUTH_DB_ROLE = "nozomi_preauth";

export const DB_ROLES = [TENANT_DB_ROLE, PLATFORM_DB_ROLE, PREAUTH_DB_ROLE] as const;
export type DbRole = (typeof DB_ROLES)[number];
