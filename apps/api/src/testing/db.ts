/**
 * 集成测试用的数据库隔离：每次调用新建一个随机名字的 schema，测试结束后整个删掉。
 * 这样集成测试可以直接连本地开发库或 CI 的库，不会读到、也不会留下任何数据。
 *
 * 连哪个库：环境变量 DATABASE_URL；没设置时用 docker-compose.yml 里的本地库。
 * 连不上时直接报错（不跳过），避免「没跑集成测试却显示全绿」。
 */
import { randomBytes } from "node:crypto";
import { loadMigrationFiles, runMigrations } from "../db/migrate.ts";
import { type Pool, createPool, driverErrorCode } from "../db/pool.ts";

/** docker-compose.yml 里本地开发库的连接串（公开的本地默认值，不是密钥）。 */
const LOCAL_COMPOSE_DATABASE_URL = "postgres://nozomi:nozomi@localhost:5432/nozomi";

export interface TestDatabase {
  /** 带 search_path 的连接串：用它建的连接只看得到这个测试的 schema */
  url: string;
  schema: string;
  pool: Pool;
  /** 删除 schema 并关闭连接；在 after() 里调用 */
  drop(): Promise<void>;
}

function baseDatabaseUrl(): string {
  const fromEnv = process.env["DATABASE_URL"];
  return fromEnv && fromEnv.trim() !== "" ? fromEnv : LOCAL_COMPOSE_DATABASE_URL;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const baseUrl = baseDatabaseUrl();
  const schema = `itest_${randomBytes(8).toString("hex")}`;
  const admin = createPool(baseUrl, { max: 1, connectionTimeoutMs: 3_000 });
  try {
    await admin.query(`create schema ${schema}`);
  } catch (err) {
    await admin.end();
    throw new Error(
      `集成测试需要 PostgreSQL，但连不上或无法建 schema（${driverErrorCode(err) ?? "UNKNOWN"}）。` +
        "本地请先运行 docker compose up -d；CI 里检查 postgres 服务和 DATABASE_URL。",
    );
  }
  const url = new URL(baseUrl);
  url.searchParams.set("options", `-c search_path=${schema}`);
  const pool = createPool(url.toString(), { max: 5 });
  return {
    url: url.toString(),
    schema,
    pool,
    async drop() {
      await pool.end();
      await admin.query(`drop schema if exists ${schema} cascade`);
      await admin.end();
    },
  };
}

/**
 * 新建一个测试 schema 并执行仓库里的全部迁移：给「真的启动 API 进程」的测试用，
 * 那些测试要求 /health 返回 200（迁移已执行完）。
 */
export async function createMigratedTestDatabase(): Promise<TestDatabase> {
  const db = await createTestDatabase();
  try {
    await runMigrations(db.pool, await loadMigrationFiles());
  } catch (err) {
    await db.drop();
    throw err;
  }
  return db;
}
