/**
 * 数据库访问的三种上下文（ADR 0003、ADR 0009、ADR 0010）。所有业务查询都必须走这三个入口之一。
 *
 * 服务进程连接数据库用的是应用账号：它自己对任何表都没有权限，不切换角色什么都读不到。
 * 每个事务开头用 `set local role` 切换到一个权限角色：
 *
 * - `withTenantTx`：处理租户请求。切换到 nozomi_app 并设置 `app.tenant_id`，行级安全策略只放行这个租户的行。
 *   即使数据访问层的某个查询漏写了 tenant_id 条件，也读不到、改不了别的租户。
 * - `withPlatformTx`：平台员工的操作（`/platform/v1`）和服务器上的管理员命令行。切换到 nozomi_platform：
 *   可以跨租户，所以这里面的查询必须自己带好条件；但它不是表的所有者，改不了结构，对审计日志只能追加和读。
 * - `withPreAuthTx`：还不知道请求方是谁时能做的最少的事——登录限速、按邮箱 / 邀请令牌定位租户用户
 *   （只拿得到租户编号和用户编号）、记匿名的登录失败、/health 读迁移记录。切换到 nozomi_preauth。
 *
 * 三者都是一个事务：回调抛错就整体回滚。角色和 `app.tenant_id` 都只在事务内有效，连接还回连接池时不会残留。
 * 每条连接第一次被使用之前先自检账号是不是最小权限（identity.ts）：不合格的连接直接销毁，一条业务 SQL 都不执行。
 */
import type { QueryResult, QueryResultRow } from "pg";
import { DbIdentityError, assertLeastPrivilege } from "./identity.ts";
import type { Pool, PoolClient, QueryInput } from "./pool.ts";
import { isDriverTimeout, timedQuery } from "./pool.ts";
import { type DbRole, PLATFORM_DB_ROLE, PREAUTH_DB_ROLE, TENANT_DB_ROLE } from "./roles.ts";

/** 处理租户请求时切换到的数据库角色；由迁移 0002 创建。 */
export const APP_DB_ROLE = TENANT_DB_ROLE;

/** 事务内的查询入口。 */
export interface Db {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
  query<R extends QueryResultRow = QueryResultRow>(input: QueryInput): Promise<QueryResult<R>>;
}

export interface TxOptions {
  /** 事务自身的每条语句（自检、begin、切换角色、commit）的客户端时限（毫秒）；不传则用连接池的默认值 */
  queryTimeoutMs?: number;
}

/** 已经通过自检的连接。连接的登录账号在它的生命周期里不会变，所以每条连接只查一次。 */
const verifiedConnections = new WeakSet<PoolClient>();

/**
 * 在一条连接上跑一个事务。
 *
 * - 连接从连接池取出期间，驱动不再替它监听 `error`：事务进行中数据库断开这条连接（重启、故障切换、
 *   被管理员终止）时会发出 `error` 事件，没有监听就是未捕获的异常，整个进程退出。
 *   所以这里自己挂一个监听：只把连接记为「已坏」，真正的报错由正在执行的那条语句抛给调用方。
 * - `begin` 之后的每一步（包括切换角色）都在同一个 try 里：任何一步失败都先回滚再归还连接，
 *   不会把停在「事务已失败」状态的连接还回连接池。
 * - 已坏的连接归还时销毁，连接池下次自己新建。
 * - 账号自检不通过的连接同样销毁：它不能留在连接池里被别的代码拿去用。
 */
async function inTransaction<T>(
  pool: Pool,
  role: DbRole,
  prepare: ((db: Db) => Promise<void>) | null,
  fn: (db: Db) => Promise<T>,
  options: TxOptions,
): Promise<T> {
  const own = (text: string): QueryInput => timedQuery(text, options.queryTimeoutMs);
  const client = await pool.connect();
  let broken = false;
  const onConnectionError = (): void => {
    broken = true;
  };
  client.on("error", onConnectionError);
  try {
    if (!verifiedConnections.has(client)) {
      await assertLeastPrivilege(client, options.queryTimeoutMs);
      verifiedConnections.add(client);
    }
    await client.query(own("begin"));
    try {
      await client.query(own(`set local role ${role}`));
      if (prepare) await prepare(client);
      const result = await fn(client);
      await client.query(own("commit"));
      return result;
    } catch (err) {
      // 客户端等应答超时：这条连接上还挂着没应答的语句，状态不明，不再等它回滚，直接销毁
      if (isDriverTimeout(err)) broken = true;
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
    // `begin` 本身失败（连接刚取出就断了），或账号自检不通过：这条连接不能再用
    if (isConnectionFailure(err) || isDriverTimeout(err) || err instanceof DbIdentityError) broken = true;
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

/** 平台事务：可以跨租户，查询必须自己带好条件。 */
export function withPlatformTx<T>(pool: Pool, fn: (db: Db) => Promise<T>, options: TxOptions = {}): Promise<T> {
  return inTransaction(pool, PLATFORM_DB_ROLE, null, fn, options);
}

/** 登录前事务：只有登录限速、定位租户用户、匿名的登录失败记录和迁移记录可用。 */
export function withPreAuthTx<T>(pool: Pool, fn: (db: Db) => Promise<T>, options: TxOptions = {}): Promise<T> {
  return inTransaction(pool, PREAUTH_DB_ROLE, null, fn, options);
}

/** 限定在一个租户内的事务：行级安全生效。 */
export function withTenantTx<T>(pool: Pool, tenantId: string, fn: (db: Db) => Promise<T>, options: TxOptions = {}): Promise<T> {
  return inTransaction(
    pool,
    TENANT_DB_ROLE,
    async (db) => {
      await db.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    },
    fn,
    options,
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
