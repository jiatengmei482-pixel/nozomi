/**
 * 进程级测试：配置有误或环境有问题时 API 进程和迁移命令的表现，以及进程输出里不出现任何密钥原文。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { type TestDatabase, createTestDatabase } from "./testing/db.ts";
import { FAKE_SECRETS, UNREACHABLE_DATABASE_URL, leakedSecrets, migrateEnv, testEnv } from "./testing/fixtures.ts";
import { exitWithin, freePort, httpGet, startNode, waitForHealth } from "./testing/process.ts";

const SERVER_ENTRY = fileURLToPath(new URL("./server.ts", import.meta.url));
const MIGRATE_ENTRY = fileURLToPath(new URL("./db/migrate-cli.ts", import.meta.url));

let db: TestDatabase;
before(async () => {
  db = await createTestDatabase();
});
after(() => db.drop());

/** 结束还活着的进程并等它退出。 */
async function stop(running: ReturnType<typeof startNode>): Promise<void> {
  if (running.child.exitCode === null && running.child.signalCode === null) {
    running.child.kill("SIGKILL");
    await running.exited;
  }
}

test("配置的值不合规（不只是缺失）：两个入口都以退出码 1 结束，指出是哪一项，输出里没有任何配置值的原文", async () => {
  // 迁移命令只读两个数据库连接串（ADR 0010：执行迁移的容器里不放登录签名密钥等），所以它有自己的一组用例
  const mysqlUrl = `mysql://app:${FAKE_SECRETS.databasePassword}@db.internal:3306/nozomi`;
  const cases: { name: string; entry?: string; env: Record<string, string>; mentions: RegExp; forbidden: string[] }[] = [
    {
      name: "迁移命令：DATABASE_MIGRATION_URL 不是 postgres 连接串",
      entry: MIGRATE_ENTRY,
      env: migrateEnv(mysqlUrl),
      mentions: /DATABASE_MIGRATION_URL/,
      forbidden: [FAKE_SECRETS.databasePassword, "db.internal"],
    },
    {
      name: "迁移命令：只给了应用账号的 DATABASE_URL，没有 DATABASE_MIGRATION_URL",
      entry: MIGRATE_ENTRY,
      env: testEnv(db.url),
      mentions: /DATABASE_MIGRATION_URL/,
      forbidden: [new URL(db.url).password + "@"],
    },
    {
      name: "迁移命令：两个连接串是同一个账号",
      entry: MIGRATE_ENTRY,
      env: { ...migrateEnv(db.ownerUrl), DATABASE_URL: db.ownerUrl },
      mentions: /不能是同一个数据库账号/,
      forbidden: [new URL(db.ownerUrl).password + "@"],
    },
    {
      name: "服务进程：两个连接串是同一个账号",
      entry: SERVER_ENTRY,
      env: { ...testEnv(db.url), DATABASE_MIGRATION_URL: db.url },
      mentions: /不能是同一个数据库账号/,
      forbidden: [new URL(db.url).password + "@"],
    },
    {
      name: "DATABASE_URL 不是 postgres 连接串",
      env: { ...testEnv(db.url), DATABASE_URL: `mysql://app:${FAKE_SECRETS.databasePassword}@db.internal:3306/nozomi` },
      mentions: /DATABASE_URL/,
      forbidden: [FAKE_SECRETS.databasePassword, "db.internal"],
    },
    {
      name: "AUTH_JWT_SECRET 太短",
      env: { ...testEnv(db.url), AUTH_JWT_SECRET: "too-short-jwt-secret-9f3" },
      mentions: /AUTH_JWT_SECRET/,
      forbidden: ["too-short-jwt-secret-9f3"],
    },
    {
      name: "Stripe 密钥前缀不对",
      env: { ...testEnv(db.url), STRIPE_SECRET_KEY: "rk_test_WRONGprefixFAKE0000" },
      mentions: /STRIPE_SECRET_KEY/,
      forbidden: ["rk_test_WRONGprefixFAKE0000"],
    },
    {
      name: "非 production 环境用了 Stripe 正式密钥",
      env: {
        ...testEnv(db.url),
        STRIPE_SECRET_KEY: "sk_live_FAKEfakeFAKEfake1111",
        STRIPE_PUBLISHABLE_KEY: "pk_live_FAKEfakeFAKEfake1111",
      },
      mentions: /live/,
      forbidden: ["sk_live_FAKEfakeFAKEfake1111", "pk_live_FAKEfakeFAKEfake1111"],
    },
    {
      name: "Stripe 只配了一部分",
      env: { ...testEnv(db.url), STRIPE_WEBHOOK_SECRET: "" },
      mentions: /Stripe/,
      forbidden: [],
    },
    {
      name: "PORT 不是端口号",
      env: { ...testEnv(db.url), PORT: "99999" },
      mentions: /PORT/,
      forbidden: [],
    },
  ];
  for (const { name, entry, env, mentions, forbidden } of cases) {
    {
      const running = startNode(entry ?? SERVER_ENTRY, env);
      try {
        assert.equal(await exitWithin(running, 15_000), 1, `${name}：${running.output()}`);
        assert.match(running.output(), /配置有误/, name);
        assert.match(running.output(), mentions, name);
        assert.deepEqual(leakedSecrets(running.output()), [], name);
        for (const value of forbidden) {
          assert.ok(!running.output().includes(value), `${name}：输出里出现了配置值原文 ${value.slice(0, 6)}…`);
        }
      } finally {
        await stop(running);
      }
    }
  }
});

test("端口已被占用：API 进程很快以非 0 退出码结束（不会挂住），输出里没有密钥原文", async () => {
  const occupier = createServer();
  occupier.listen(0, "0.0.0.0");
  await once(occupier, "listening");
  const address = occupier.address();
  assert.ok(typeof address === "object" && address !== null);
  const running = startNode(SERVER_ENTRY, { ...testEnv(db.url), PORT: String(address.port) });
  try {
    const exit = await exitWithin(running, 15_000);
    assert.equal(exit, 1, `退出结果 ${exit}：${running.output()}`);
    assert.match(running.output(), /启动失败/);
    assert.match(running.output(), /EADDRINUSE/);
    assert.deepEqual(leakedSecrets(running.output()), []);
  } finally {
    await stop(running);
    occupier.close();
    await once(occupier, "close");
  }
});

test("数据库连不上时 API 仍能启动并如实报告 503；带凭证请求头访问后，进程日志里没有数据库密码、密钥和请求凭证", async () => {
  const port = await freePort();
  const running = startNode(SERVER_ENTRY, { ...testEnv(UNREACHABLE_DATABASE_URL), PORT: String(port) });
  const bearer = "Bearer fake-user-token-7d1c2b9a";
  const apiKey = "fake-ota-api-key-55aa66bb";
  try {
    const first = await waitForHealth(port, running);
    assert.equal(first.status, 503);
    const res = await httpGet(port, "/health", {
      headers: { authorization: bearer, "x-api-key": apiKey, cookie: "session=fake-session-cookie-123" },
    });
    assert.equal(res.status, 503);
    assert.equal(JSON.parse(res.body).database.errorCode, "DB_UNREACHABLE");
    assert.deepEqual(leakedSecrets(res.body), []);
    await httpGet(port, "/no-such-route", { headers: { authorization: bearer } });

    running.child.kill("SIGTERM");
    assert.equal(await exitWithin(running, 8_000), 0, running.output());
    const output = running.output();
    assert.match(output, /incoming request/, "日志里应当有请求记录，否则这个测试什么都没验证");
    assert.deepEqual(leakedSecrets(output), []);
    for (const credential of ["fake-user-token-7d1c2b9a", apiKey, "fake-session-cookie-123"]) {
      assert.ok(!output.includes(credential), `日志里出现了请求凭证 ${credential}`);
    }
  } finally {
    await stop(running);
  }
});

/**
 * 这些连接串能通过配置校验（以 postgres:// 开头），但其实不是合法的 URL。
 * 这是填错配置时最容易出现的情况，也正是负责人最可能把日志截图发给别人求助的时候。
 */
const MALFORMED_DATABASE_URLS: { name: string; url: string }[] = [
  { name: "端口超出范围", url: `postgres://app:${FAKE_SECRETS.databasePassword}@127.0.0.1:99999/nozomi` },
  { name: "主机名里有空格", url: `postgres://app:${FAKE_SECRETS.databasePassword}@db host/nozomi` },
];

test("DATABASE_URL 写错但能通过配置校验：API 进程的输出里不能出现数据库密码，/health 不能是 500", async () => {
  for (const { name, url } of MALFORMED_DATABASE_URLS) {
    const port = await freePort();
    const running = startNode(SERVER_ENTRY, { ...testEnv(url), PORT: String(port) });
    try {
      // 两种结局都可以接受：启动时就报配置有误并退出；或者启动成功、/health 如实报告数据库不可用。
      let health: Awaited<ReturnType<typeof httpGet>> | null = null;
      try {
        health = await waitForHealth(port, running, 10_000);
      } catch {
        assert.notEqual(running.child.exitCode, 0, `${name}：配置有误却以 0 退出`);
      }
      if (health !== null) {
        running.child.kill("SIGTERM");
        await exitWithin(running, 8_000);
      }
      const output = running.output();
      assert.deepEqual(
        leakedSecrets(output),
        [],
        `${name}：进程输出里出现了密钥原文，所在的日志行：${output
          .split("\n")
          .filter((line) => line.includes(FAKE_SECRETS.databasePassword))
          .map((line) => line.replaceAll(FAKE_SECRETS.databasePassword, "<数据库密码原文>").slice(-260))
          .join(" | ")}`,
      );
      if (health !== null) {
        assert.deepEqual(leakedSecrets(health.body), [], name);
        assert.notEqual(health.status, 500, `${name}：/health 返回了 500：${health.body}`);
      }
    } finally {
      await stop(running);
    }
  }
});

test("DATABASE_MIGRATION_URL 写错但能通过配置校验：迁移命令以退出码 1 结束，输出里没有数据库密码", async () => {
  for (const { name, url } of MALFORMED_DATABASE_URLS) {
    const running = startNode(MIGRATE_ENTRY, migrateEnv(url));
    try {
      assert.equal(await exitWithin(running, 15_000), 1, `${name}：${running.output()}`);
      assert.deepEqual(leakedSecrets(running.output()), [], name);
    } finally {
      await stop(running);
    }
  }
});
