/**
 * /health 的集成测试：连真实 PostgreSQL，每个测试一个独立 schema。
 */
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "./app.ts";
import { runMigrations } from "./db/migrate.ts";
import { buildMigrationFiles } from "./db/migration-plan.ts";
import { type TestDatabase, allowReadingMigrationRecords, createTestDatabase } from "./testing/db.ts";
import { FAKE_SECRETS, leakedSecrets, testConfig } from "./testing/fixtures.ts";

let db: TestDatabase;
beforeEach(async () => {
  db = await createTestDatabase();
});
afterEach(() => db.drop());

/** 用迁移账号执行这里的假迁移，再让应用账号读得到迁移记录（真实的库里由迁移 0005 授权）。 */
async function migrate(migrationFiles: Parameters<typeof runMigrations>[1]): Promise<void> {
  await runMigrations(db.owner, migrationFiles);
  await allowReadingMigrationRecords(db);
}

const files = buildMigrationFiles([
  { fileName: "0001_a.sql", sql: "create table a (id int primary key);" },
  { fileName: "0002_b.sql", sql: "create table b (id int primary key);" },
]);

async function getHealth(migrationFiles = files): Promise<{ statusCode: number; text: string; body: any }> {
  const app = buildApp({ config: testConfig(db.url), pool: db.pool, migrationFiles, logger: false });
  const res = await app.inject({ method: "GET", url: "/health" });
  await app.close();
  return { statusCode: res.statusCode, text: res.body, body: res.json() };
}

test("数据库可用且迁移已执行完：200 ok", async () => {
  await migrate(files);
  const { statusCode, body } = await getHealth();
  assert.equal(statusCode, 200);
  assert.equal(body.status, "ok");
  assert.equal(body.env, "ci");
  assert.equal(body.database.state, "up");
  assert.equal(body.database.errorCode, null);
  assert.ok(Number.isInteger(body.database.latencyMs) && body.database.latencyMs >= 0);
  assert.deepEqual(body.migrations, { state: "up_to_date", applied: 2, pending: 0, errorCode: null });
});

test("没有任何迁移文件的空库：200 ok（M0-05 的现状）", async () => {
  const { statusCode, body } = await getHealth([]);
  assert.equal(statusCode, 200);
  assert.deepEqual(body.migrations, { state: "up_to_date", applied: 0, pending: 0, errorCode: null });
});

test("集成状态只有「已配置 / 未配置」：每项只含 key、label、state，没有 detail，也没有任何密钥片段", async () => {
  await migrate(files);
  const { text, body } = await getHealth();
  assert.deepEqual(leakedSecrets(text), []);
  const password = new URL(db.url).password;
  assert.ok(password.length > 0);
  assert.ok(!text.includes(password), "响应里出现了数据库密码");
  assert.deepEqual(
    body.integrations.map((i: any) => i.key),
    ["database", "auth", "stripe", "googleMaps", "fx"],
  );
  for (const item of body.integrations) {
    assert.deepEqual(Object.keys(item), ["key", "label", "state"]);
    assert.equal(item.state, "configured");
  }
  // 以前放在 detail 里的内容：打码的连接串、密钥长度、密钥首尾、汇率源主机名，现在都不应该出现
  assert.ok(!text.includes("detail"));
  assert.ok(!text.includes("postgres://") && !text.includes("•"));
  assert.ok(!text.includes(`${FAKE_SECRETS.authJwtSecret.length} 个字符`));
  assert.ok(!text.includes("sk_test") && !text.includes("AIza") && !text.includes("er-api"));
});

test("第三方集成未配置不影响健康状态", async () => {
  const config = { ...testConfig(db.url), stripe: null, googleMapsApiKey: null };
  const app = buildApp({ config, pool: db.pool, migrationFiles: [], logger: false });
  const res = await app.inject({ method: "GET", url: "/health" });
  await app.close();
  assert.equal(res.statusCode, 200);
  const states = Object.fromEntries(res.json().integrations.map((i: any) => [i.key, i.state]));
  assert.equal(states.stripe, "missing");
  assert.equal(states.googleMaps, "missing");
});

test("有迁移还没执行：503 degraded，说明差几个", async () => {
  await migrate(files.slice(0, 1));
  const { statusCode, body } = await getHealth();
  assert.equal(statusCode, 503);
  assert.equal(body.status, "degraded");
  assert.equal(body.database.state, "up");
  assert.deepEqual(body.migrations, { state: "pending", applied: 1, pending: 1, errorCode: null });
});

test("已执行的迁移文件被改动：503，迁移状态为 error 并给出错误码", async () => {
  await migrate(files);
  const tampered = buildMigrationFiles([
    { fileName: "0001_a.sql", sql: "create table a (id bigint primary key);" },
    { fileName: "0002_b.sql", sql: "create table b (id int primary key);" },
  ]);
  const { statusCode, body } = await getHealth(tampered);
  assert.equal(statusCode, 503);
  assert.deepEqual(body.migrations, {
    state: "error",
    applied: null,
    pending: null,
    errorCode: "MIGRATION_CHECKSUM_MISMATCH",
  });
});
