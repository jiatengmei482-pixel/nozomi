/**
 * 数据库访问的两种上下文（ADR 0003、ADR 0009）。新代码的所有业务查询都必须走这两个入口之一。
 *
 * - `withTenantTx`：处理租户请求。事务开头切换到应用角色 nozomi_app 并设置 `app.tenant_id`，
 *   行级安全策略只放行这个租户的行。即使数据访问层的某个查询漏写了 tenant_id 条件，也读不到、改不了别的租户。
 * - `withSystemTx`：平台员工的操作，以及登录前按邮箱 / 邀请令牌定位用户这类还不知道租户的查询。
 *   用连接本身的账号（表的所有者）执行，不受行级安全限制，所以这里面的查询必须自己带好条件。
 *
 * 两者都是一个事务：回调抛错就整体回滚。角色和 `app.tenant_id` 都只在事务内有效，连接还回连接池时不会残留。
 */
import type { QueryResult, QueryResultRow } from "pg";
import type { Pool } from "./pool.ts";

/** 处理租户请求时切换到的数据库角色；由迁移 0002 创建。 */
export const APP_DB_ROLE = "nozomi_app";

/** 事务内的查询入口。 */
export interface Db {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
}

/**
 * 在一条连接上跑一个事务。
 *
 * - 连接从连接池取出期间，驱动不再替它监听 `error`：事务进行中数据库断开这条连接（重启、故障切换、
 *   被管理员终止）时会发出 `error` 事件，没有监听就是未捕获的异常，整个进程退出。
 *   所以这里自己挂一个监听：只把连接记为「已坏」，真正的报错由正在执行的那条语句抛给调用方。
 * - `begin` 之后的每一步（包括切换角色）都在同一个 try 里：任何一步失败都先回滚再归还连接，
 *   不会把停在「事务已失败」状态的连接还回连接池。
 * - 已坏的连接归还时销毁，连接池下次自己新建。
 */
async function inTransaction<T>(pool: Pool, prepare: ((db: Db) => Promise<void>) | null, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  const onConnectionError = (): void => {
    broken = true;
  };
  client.on("error", onConnectionError);
  try {
    await client.query("begin");
    try {
      if (prepare) await prepare(client);
      const result = await fn(client);
      await client.query("commit");
      return result;
    } catch (err) {
      if (!broken) {
        try {
          await client.query("rollback");
        } catch {
          // 回滚都失败说明连接已坏：销毁连接，数据库会在会话结束时自动回滚
          broken = true;
        }
      }
      throw err;
    }
  } catch (err) {
    // `begin` 本身失败（连接刚取出就断了）：这条连接不能再用
    if (isConnectionFailure(err)) broken = true;
    throw err;
  } finally {
    client.off("error", onConnectionError);
    client.release(broken);
  }
}

/** 是否是「连接没了」这一类报错（数据库终止了会话、网络断开），而不是某条语句的业务报错。 */
function isConnectionFailure(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code !== "string") return err instanceof Error && /connection|terminat|not queryable/i.test(err.message);
  // 08xxx：连接异常；57P0x：管理员终止 / 数据库关闭；E 开头的是操作系统的网络错误码
  return code.startsWith("08") || code.startsWith("57P") || /^E[A-Z]+$/.test(code);
}

/** 不受行级安全限制的事务：平台操作和登录前的定位查询。 */
export function withSystemTx<T>(pool: Pool, fn: (db: Db) => Promise<T>): Promise<T> {
  return inTransaction(pool, null, fn);
}

/** 限定在一个租户内的事务：行级安全生效。 */
export function withTenantTx<T>(pool: Pool, tenantId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  return inTransaction(
    pool,
    async (db) => {
      await db.query(`set local role ${APP_DB_ROLE}`);
      await db.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    },
    fn,
  );
}

const UNIQUE_VIOLATION = "23505";

/** 是否是违反唯一约束的报错；可以指定约束名。 */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  if (typeof err !== "object" || err === null) return false;
  const record = err as { code?: unknown; constraint?: unknown };
  if (record.code !== UNIQUE_VIOLATION) return false;
  return constraint === undefined || record.constraint === constraint;
}
