/**
 * 集成测试用的数据库隔离：每次调用新建一个随机名字的 schema，测试结束后整个删掉。
 * 这样集成测试可以直接连本地开发库或 CI 的库，不会读到、也不会留下任何数据。
 *
 * 和真实环境一样用两个账号（ADR 0010）：
 * - 迁移账号（DATABASE_MIGRATION_URL）：建 schema、执行迁移，也用来直接往表里摆测试数据、核对结果（`owner`）。
 * - 应用账号（DATABASE_URL）：被测的应用代码只用它（`pool` / `url`）。它自己没有任何表权限，
 *   所以测试里凡是经应用代码访问数据库的地方，跑的都是线上的最小权限。
 * 两个环境变量没设置时用 docker-compose.yml 里的本地库和 .env.example 里的本地账号。
 * 应用账号要先用 `pnpm db:provision` 建好；角色是整个数据库实例共用的，各测试的授权都只落在自己的 schema 上。
 *
 * 连不上时直接报错（不跳过），避免「没跑集成测试却显示全绿」。
 */
import { randomBytes } from "node:crypto";
import { loadMigrationFiles, runMigrations } from "../db/migrate.ts";
import { type Pool, createPool, driverErrorCode } from "../db/pool.ts";
import { PREAUTH_DB_ROLE } from "../db/roles.ts";

/** docker-compose.yml 里本地开发库的两个连接串（公开的本地默认值，不是密钥）。 */
const LOCAL_MIGRATION_DATABASE_URL = "postgres://nozomi:nozomi@localhost:5432/nozomi";
const LOCAL_APP_DATABASE_URL = "postgres://nozomi_api:nozomi_api@localhost:5432/nozomi";

export interface TestDatabase {
  /** 应用账号、带 search_path 的连接串：用它建的连接只看得到这个测试的 schema */
  url: string;
  /** 应用账号的连接池：传给被测的应用代码 */
  pool: Pool;
  /** 迁移账号（表的所有者）、带 search_path 的连接串：只给迁移命令用 */
  ownerUrl: string;
  /** 迁移账号的连接池：执行迁移、直接摆测试数据、核对结果 */
  owner: Pool;
  schema: string;
  /** 删除 schema 并关闭连接；在 after() 里调用 */
  drop(): Promise<void>;
}

function fromEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
}

function withSearchPath(baseUrl: string, schema: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const ownerBaseUrl = fromEnv("DATABASE_MIGRATION_URL", LOCAL_MIGRATION_DATABASE_URL);
  const appBaseUrl = fromEnv("DATABASE_URL", LOCAL_APP_DATABASE_URL);
  const schema = `itest_${randomBytes(8).toString("hex")}`;
  const admin = createPool(ownerBaseUrl, { max: 1, connectionTimeoutMs: 3_000 });
  try {
    await admin.query(`create schema ${schema}`);
  } catch (err) {
    await admin.end();
    throw new Error(
      `集成测试需要 PostgreSQL，但连不上或无法建 schema（${driverErrorCode(err) ?? "UNKNOWN"}）。` +
        "本地请先运行 docker compose up -d；CI 里检查 postgres 服务和 DATABASE_MIGRATION_URL。",
    );
  }
  const url = withSearchPath(appBaseUrl, schema);
  const ownerUrl = withSearchPath(ownerBaseUrl, schema);
  const pool = createPool(url, { max: 5 });
  const owner = createPool(ownerUrl, { max: 5 });
  const drop = async (): Promise<void> => {
    await pool.end();
    await owner.end();
    await admin.query(`drop schema if exists ${schema} cascade`);
    await admin.end();
  };
  try {
    await pool.query("select 1");
  } catch (err) {
    await drop();
    throw new Error(
      `集成测试要用应用账号连接数据库，但连不上（${driverErrorCode(err) ?? "UNKNOWN"}）。` +
        "请先运行 pnpm db:provision 创建应用账号，并检查 DATABASE_URL。",
    );
  }
  return { url, pool, ownerUrl, owner, schema, drop };
}

/**
 * 新建一个测试 schema 并执行仓库里的全部迁移：给「真的启动 API 进程」的测试用，
 * 那些测试要求 /health 返回 200（迁移已执行完）。
 */
export async function createMigratedTestDatabase(): Promise<TestDatabase> {
  const db = await createTestDatabase();
  try {
    await runMigrations(db.owner, await loadMigrationFiles());
  } catch (err) {
    await db.drop();
    throw err;
  }
  return db;
}

/**
 * 只给「用几个假迁移文件测 /health」的测试用：让登录前的角色读得到这个 schema 的迁移记录。
 * 真实的库里这一步由迁移 0005 完成（那些测试不执行真实的迁移）。
 */
export async function allowReadingMigrationRecords(db: TestDatabase): Promise<void> {
  await db.owner.query(`grant usage on schema ${db.schema} to ${PREAUTH_DB_ROLE}`);
  await db.owner.query(`grant select on schema_migrations to ${PREAUTH_DB_ROLE}`);
}

/**
 * 数据库是否拒绝了这次访问。应用账号不切换角色时两种报错都算拒绝：
 * 42501 = 没有权限；42P01 = 连 schema 的使用权都没有，所以表对它来说「不存在」
 * （测试的 schema 是这样；正式库的 public schema 所有账号都看得见表名，报的是 42501）。
 */
export function deniedByDatabase(err: unknown): boolean {
  const code = typeof err === "object" && err !== null && "code" in err ? err.code : null;
  return code === "42501" || code === "42P01";
}
