/**
 * 应用账号的自检（ADR 0010）：服务进程连上数据库的那个账号必须是「最小权限」的——
 * 不是超级用户、不拥有任何表、不能绕过行级安全、自己不带任何表权限，只能切换到三个权限角色。
 *
 * 用在三处：进程启动时（不合格就拒绝启动）、每条新连接第一次被事务使用之前（context.ts）、/health 的数据库探测。
 * 所以即使启动时数据库连不上、之后才连上，不合格的账号也执行不了任何业务 SQL。
 * 所有环境（local / ci / staging / production）规则相同：本地和 CI 跑的就是线上的权限。
 */
import { type QueryInput, timedQuery } from "./pool.ts";
import { DB_ROLES } from "./roles.ts";

export interface DbIdentity {
  login: string;
  superuser: boolean;
  createRole: boolean;
  createDb: boolean;
  bypassRls: boolean;
  replication: boolean;
  /** 直接或间接属于的全部角色 */
  memberOf: string[];
  /** 不用 `set role` 就自动带上其权限的角色（应当一个都没有） */
  inherits: string[];
  /** 能用 `set role` 切换过去的角色 */
  canSetRoleTo: string[];
  /** 自己拥有、或能以所属角色的身份拥有的表 / 视图 / 序列的数量 */
  ownedRelations: number;
  ownsDatabase: boolean;
  /** 三个权限角色里，自身带着危险属性（超级用户、绕过行级安全、可登录等）的 */
  unsafeRoles: string[];
}

const IDENTITY_SQL = `
  select session_user::text as login,
         r.rolsuper as superuser, r.rolcreaterole as create_role, r.rolcreatedb as create_db,
         r.rolbypassrls as bypass_rls, r.rolreplication as replication,
         array(select g.rolname::text from pg_roles g
                where g.oid <> r.oid and pg_has_role(r.oid, g.oid, 'MEMBER') order by 1) as member_of,
         array(select g.rolname::text from pg_roles g
                where g.oid <> r.oid and pg_has_role(r.oid, g.oid, 'USAGE') order by 1) as inherits,
         array(select g.rolname::text from pg_roles g
                where g.oid <> r.oid and pg_has_role(r.oid, g.oid, 'SET') order by 1) as can_set_role_to,
         (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
             and n.nspname <> 'information_schema' and n.nspname not like 'pg\\_%'
             and pg_has_role(r.oid, c.relowner, 'MEMBER')) as owned_relations,
         (select pg_has_role(r.oid, d.datdba, 'MEMBER') from pg_database d
           where d.datname = current_database()) as owns_database,
         array(select g.rolname::text from pg_roles g
                where g.rolname = any($1::text[])
                  and (g.rolsuper or g.rolbypassrls or g.rolcreaterole or g.rolcreatedb or g.rolreplication or g.rolcanlogin)
                order by 1) as unsafe_roles
    from pg_roles r
   where r.rolname = session_user`;

interface IdentityRow {
  login: string;
  superuser: boolean;
  create_role: boolean;
  create_db: boolean;
  bypass_rls: boolean;
  replication: boolean;
  member_of: string[];
  inherits: string[];
  can_set_role_to: string[];
  owned_relations: number;
  owns_database: boolean;
  unsafe_roles: string[];
}

export interface IdentityQueryable {
  query(input: QueryInput): Promise<{ rows: unknown[] }>;
}

/** 读出当前连接的登录账号有哪些权限。只查系统目录，任何账号都能执行。 */
export async function inspectDbIdentity(db: IdentityQueryable, queryTimeoutMs?: number): Promise<DbIdentity> {
  const result = await db.query(timedQuery(IDENTITY_SQL, queryTimeoutMs, [[...DB_ROLES]]));
  const row = result.rows[0] as IdentityRow | undefined;
  if (!row) throw new Error("读不到当前数据库账号的信息");
  return {
    login: row.login,
    superuser: row.superuser,
    createRole: row.create_role,
    createDb: row.create_db,
    bypassRls: row.bypass_rls,
    replication: row.replication,
    memberOf: row.member_of,
    inherits: row.inherits,
    canSetRoleTo: row.can_set_role_to,
    ownedRelations: row.owned_relations,
    ownsDatabase: row.owns_database,
    unsafeRoles: row.unsafe_roles,
  };
}

/** 这个账号哪里不符合「最小权限」；全部符合时返回空数组。纯函数。 */
export function identityProblems(identity: DbIdentity): string[] {
  const problems: string[] = [];
  if (identity.superuser) problems.push("是超级用户（行级安全和审计日志的保护对它都不生效）");
  if (identity.bypassRls) problems.push("带有 BYPASSRLS（可以绕过行级安全）");
  if (identity.createRole) problems.push("带有 CREATEROLE（可以给自己加权限）");
  if (identity.createDb) problems.push("带有 CREATEDB");
  if (identity.replication) problems.push("带有 REPLICATION");
  // 超级用户对下面几项的判断全部为真，再逐条列出只会淹没真正的原因
  if (identity.superuser) return problems;
  if (identity.ownsDatabase) problems.push("是当前数据库的所有者");
  if (identity.ownedRelations > 0) {
    problems.push(`拥有或可以接管 ${identity.ownedRelations} 张表 / 序列（所有者可以关掉触发器和行级安全）`);
  }
  const expected: readonly string[] = DB_ROLES;
  const extra = identity.memberOf.filter((role) => !expected.includes(role));
  if (extra.length > 0) problems.push(`属于不该属于的角色：${extra.join("、")}`);
  const missing = expected.filter((role) => !identity.canSetRoleTo.includes(role));
  if (missing.length > 0) problems.push(`不能切换到角色：${missing.join("、")}`);
  if (identity.inherits.length > 0) {
    problems.push(`不切换角色就自动带上了这些角色的权限（应为 NOINHERIT）：${identity.inherits.join("、")}`);
  }
  if (identity.unsafeRoles.length > 0) {
    problems.push(`权限角色本身带着危险属性（超级用户、绕过行级安全、可登录等）：${identity.unsafeRoles.join("、")}`);
  }
  return problems;
}

export const DB_ROLE_UNSAFE = "DB_ROLE_UNSAFE";

/** 应用账号不是最小权限。`message` 里只有账号名和原因，没有连接串。 */
export class DbIdentityError extends Error {
  readonly code = DB_ROLE_UNSAFE;
  readonly login: string;
  readonly problems: readonly string[];
  constructor(login: string, problems: readonly string[]) {
    super(
      `数据库账号 ${login} 不能用来运行服务：\n- ${problems.join("\n- ")}\n` +
        "DATABASE_URL 必须是权限最小的应用账号（用 pnpm db:provision 创建），不能是迁移账号。见 docs/adr/0010-database-roles.md。",
    );
    this.name = "DbIdentityError";
    this.login = login;
    this.problems = problems;
  }
}

/** 当前连接的账号不是最小权限时抛 DbIdentityError。 */
export async function assertLeastPrivilege(db: IdentityQueryable, queryTimeoutMs?: number): Promise<DbIdentity> {
  const identity = await inspectDbIdentity(db, queryTimeoutMs);
  const problems = identityProblems(identity);
  if (problems.length > 0) throw new DbIdentityError(identity.login, problems);
  return identity;
}
