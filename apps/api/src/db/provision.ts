/**
 * 创建 / 修正服务进程用的应用账号（ADR 0010）。由 `pnpm db:provision` 调用，用迁移账号执行，可以反复运行。
 *
 * 应用账号：能登录、有密码，但自己没有任何表权限（NOINHERIT），只是三个权限角色的成员，
 * 每个事务开头用 `set local role` 切换过去。它带密码，所以不能在迁移 SQL 里创建。
 *
 * 密码不以原文发给数据库：在这里算出 SCRAM-SHA-256 的校验值再写进 `create role` / `alter role`，
 * 数据库的语句日志和 pg_stat_activity 里都只会出现校验值。
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import type { Pool } from "./pool.ts";
import { DB_ROLES } from "./roles.ts";

export type ProvisionErrorCode =
  | "PROVISION_INVALID_ROLE_NAME"
  | "PROVISION_INVALID_PASSWORD"
  | "PROVISION_ROLE_IS_PRIVILEGED"
  | "PROVISION_INSUFFICIENT_PRIVILEGE";

export class ProvisionError extends Error {
  readonly code: ProvisionErrorCode;
  constructor(code: ProvisionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProvisionError";
    this.code = code;
  }
}

const SCRAM_ITERATIONS = 4096;

/** PostgreSQL 的 SCRAM-SHA-256 密码校验值（RFC 5802 / RFC 7677；格式与 `\password` 生成的一致）。 */
export function scramSha256Verifier(password: string, salt: Buffer = randomBytes(16)): string {
  const salted = pbkdf2Sync(password, salt, SCRAM_ITERATIONS, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${SCRAM_ITERATIONS}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

export interface AppAccount {
  role: string;
  password: string;
}

/** 从应用账号的连接串里取账号名和密码，并检查它们适合用来建账号。报错里不带连接串和密码。 */
export function appAccountFromUrl(databaseUrl: string): AppAccount {
  const url = new URL(databaseUrl);
  const role = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role) || role.startsWith("pg_") || (DB_ROLES as readonly string[]).includes(role)) {
    throw new ProvisionError(
      "PROVISION_INVALID_ROLE_NAME",
      "DATABASE_URL 里的账号名不能用作应用账号：只能是小写字母、数字、下划线，不能以 pg_ 开头，也不能和三个权限角色同名。",
    );
  }
  // 只接受可见的 ASCII 字符：这个范围内数据库对密码不做任何归一化，这里算出的校验值一定对得上
  if (password.length < 8 || !/^[\x21-\x7e]+$/.test(password)) {
    throw new ProvisionError(
      "PROVISION_INVALID_PASSWORD",
      "DATABASE_URL 里的密码不能用作应用账号的密码：至少 8 个字符，只能是不含空格的英文字母、数字和符号。",
    );
  }
  return { role, password };
}

export interface ProvisionResult {
  role: string;
  created: boolean;
}

/** advisory lock 的两段式键（"NZ" + "PR" 的 ASCII 码）：同一时间只有一个进程在建账号，并行运行时排队而不是互相踩。 */
export const PROVISION_LOCK_KEY = [0x4e5a, 0x5052] as const;

const INSUFFICIENT_PRIVILEGE = "42501";
const DUPLICATE_OBJECT = "42710";
const UNIQUE_VIOLATION = "23505";

function sqlState(err: unknown): string | null {
  return typeof err === "object" && err !== null && "code" in err && typeof err.code === "string" ? err.code : null;
}

/**
 * 创建应用账号（已存在则把密码和属性改成应有的样子），并让它恰好是三个权限角色的成员。
 * 三个权限角色还不存在时一并创建（迁移也会创建，谁先执行都可以）；已存在的权限角色不做任何改动。
 * 不会去降级一个已有的超级用户或拥有表的账号：那多半是填错了连接串，直接报错。
 */
export async function provisionAppAccount(pool: Pool, account: AppAccount): Promise<ProvisionResult> {
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query("select pg_advisory_lock($1, $2)", [...PROVISION_LOCK_KEY]);
    locked = true;
    const me = await client.query<{ login: string; version: number }>(
      "select session_user::text as login, current_setting('server_version_num')::int as version",
    );
    const { login, version } = me.rows[0] as { login: string; version: number };
    if (login === account.role) {
      throw new ProvisionError(
        "PROVISION_ROLE_IS_PRIVILEGED",
        "DATABASE_URL 和 DATABASE_MIGRATION_URL 是同一个数据库账号。应用账号必须是另一个专用的账号。",
      );
    }

    for (const role of DB_ROLES) {
      try {
        const exists = await client.query("select 1 from pg_roles where rolname = $1", [role]);
        if (exists.rowCount === 0) await client.query(`create role ${role} nologin`);
      } catch (err) {
        // 并行的迁移或另一个 provision 刚好同时创建了它
        if (sqlState(err) !== DUPLICATE_OBJECT && sqlState(err) !== UNIQUE_VIOLATION) throw err;
      }
    }

    const existing = await client.query<{ privileged: boolean; owned: number }>(
      `select (r.rolsuper or r.rolbypassrls or r.rolcreaterole or r.rolcreatedb or r.rolreplication) as privileged,
              (select count(*)::int from pg_class c where c.relowner = r.oid)
                + (select count(*)::int from pg_database d where d.datdba = r.oid) as owned
         from pg_roles r where r.rolname = $1`,
      [account.role],
    );
    const found = existing.rows[0];
    if (found && (found.privileged || found.owned > 0)) {
      throw new ProvisionError(
        "PROVISION_ROLE_IS_PRIVILEGED",
        `数据库里已经有账号 ${account.role}，而且它是超级用户 / 带特殊权限 / 拥有表或数据库。` +
          "这个命令不会去降级这样的账号：请在 DATABASE_URL 里换一个专用的应用账号名。",
      );
    }

    const attributes = "login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls";
    const verifier = scramSha256Verifier(account.password);
    const defineRole = async (verb: "create" | "alter"): Promise<void> => {
      const statement = await client.query<{ sql: string }>(
        `select format('${verb} role %I with ${attributes} password %L', $1::text, $2::text) as sql`,
        [account.role, verifier],
      );
      await client.query((statement.rows[0] as { sql: string }).sql);
    };
    if (found) {
      await defineRole("alter");
    } else {
      try {
        await defineRole("create");
      } catch (err) {
        // 另一个 provision 刚好同时创建了它：改成应有的样子即可
        if (sqlState(err) !== DUPLICATE_OBJECT && sqlState(err) !== UNIQUE_VIOLATION) throw err;
        await defineRole("alter");
      }
    }

    // PostgreSQL 16 起「是否自动继承权限」记在每一条成员关系上，要写明；更早的版本由账号的 NOINHERIT 属性决定
    const membershipOptions = version >= 160000 ? " with inherit false, set true" : "";
    for (const role of DB_ROLES) {
      await client.query(`grant ${role} to ${account.role}${membershipOptions}`);
    }
    const extra = await client.query<{ role: string }>(
      `select g.rolname::text as role
         from pg_auth_members m join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member
        where u.rolname = $1 and g.rolname <> all($2::text[])`,
      [account.role, [...DB_ROLES]],
    );
    for (const { role } of extra.rows) {
      const revoke = await client.query<{ sql: string }>("select format('revoke %I from %I', $1::text, $2::text) as sql", [
        role,
        account.role,
      ]);
      await client.query((revoke.rows[0] as { sql: string }).sql);
    }
    return { role: account.role, created: !found };
  } catch (err) {
    if (sqlState(err) === INSUFFICIENT_PRIVILEGE) {
      throw new ProvisionError(
        "PROVISION_INSUFFICIENT_PRIVILEGE",
        "DATABASE_MIGRATION_URL 的账号没有创建 / 修改角色的权限（需要超级用户或 CREATEROLE）。",
        { cause: err },
      );
    }
    throw err;
  } finally {
    let broken = false;
    if (locked) {
      try {
        await client.query("select pg_advisory_unlock($1, $2)", [...PROVISION_LOCK_KEY]);
      } catch {
        // 解锁失败说明连接已坏：销毁连接，会话结束时数据库会自动释放锁
        broken = true;
      }
    }
    client.release(broken);
  }
}
