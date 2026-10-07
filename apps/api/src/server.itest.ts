/**
 * 进程级的集成测试：真的启动 API 进程和迁移命令（与 `pnpm dev`、`pnpm db:migrate` 走同一个入口文件），
 * 通过真实的 HTTP 请求访问，再发 SIGTERM 验证优雅关闭。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { type TestDatabase, createTestDatabase } from "./testing/db.ts";
import { UNREACHABLE_DATABASE_URL, leakedSecrets, testEnv } from "./testing/fixtures.ts";
import { databaseTarget, startTcpProxy } from "./testing/tcp-proxy.ts";

const SERVER_ENTRY = fileURLToPath(new URL("./server.ts", import.meta.url));
const MIGRATE_ENTRY = fileURLToPath(new URL("./db/migrate-cli.ts", import.meta.url));

let db: TestDatabase;
before(async () => {
  db = await createTestDatabase();
});
after(() => db.drop());

/** 向系统要一个空闲端口。 */
async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  probe.close();
  await once(probe, "close");
  assert.ok(typeof address === "object" && address !== null);
  return address.port;
}

interface Running {
  child: ChildProcess;
  /** 进程的全部输出（标准输出 + 标准错误） */
  output: () => string;
  exited: Promise<number | null>;
}

/** 只传入测试用的环境变量（外加 PATH），保证子进程不受本机 .env 影响。 */
function start(entry: string, env: Record<string, string>): Running {
  const child = spawn(process.execPath, [entry], {
    env: { PATH: process.env["PATH"] ?? "", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
  child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
  const exited = once(child, "exit").then(([code]) => code as number | null);
  return { child, output: () => output, exited };
}

async function waitForHealth(port: number, running: Running): Promise<Response> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (running.child.exitCode !== null) break;
    try {
      return await fetch(`http://127.0.0.1:${port}/health`);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`API 进程没有在限时内就绪。输出：\n${running.output()}`);
}

test("先执行迁移命令再启动 API 进程（部署时的顺序）：/health 经真实 HTTP 返回 200；SIGTERM 后优雅退出（退出码 0）；日志里没有密钥原文", async () => {
  const migrate = start(MIGRATE_ENTRY, testEnv(db.url));
  assert.equal(await migrate.exited, 0, migrate.output());
  assert.match(migrate.output(), /完成：本次执行 \d+ 个迁移，此前已执行 0 个/);
  const port = await freePort();
  const running = start(SERVER_ENTRY, { ...testEnv(db.url), PORT: String(port) });
  try {
    const res = await waitForHealth(port, running);
    assert.equal(res.status, 200);
    const text = await res.text();
    const body = JSON.parse(text);
    assert.equal(body.status, "ok");
    assert.equal(body.database.state, "up");
    assert.deepEqual(leakedSecrets(text), []);

    const notFound = await fetch(`http://127.0.0.1:${port}/nope`);
    assert.equal(notFound.status, 404);
    const notFoundBody = (await notFound.json()) as { error: { code: string } };
    assert.equal(notFoundBody.error.code, "NOT_FOUND");

    running.child.kill("SIGTERM");
    assert.equal(await running.exited, 0);
    assert.match(running.output(), /已关闭/);
    assert.deepEqual(leakedSecrets(running.output()), []);
    assert.ok(!running.output().includes(new URL(db.url).password + "@"));
  } finally {
    if (running.child.exitCode === null) running.child.kill("SIGKILL");
  }
});

test("配置缺失时启动失败：退出码 1，列出问题，不启动服务", async () => {
  const running = start(SERVER_ENTRY, { DATABASE_URL: db.url });
  assert.equal(await running.exited, 1);
  assert.match(running.output(), /AUTH_JWT_SECRET/);
});

test("迁移命令可以反复运行：两次都成功", async () => {
  for (const _round of [1, 2]) {
    const running = start(MIGRATE_ENTRY, testEnv(db.url));
    assert.equal(await running.exited, 0, running.output());
    assert.match(running.output(), /数据库结构已是最新|完成：本次执行/);
    assert.deepEqual(leakedSecrets(running.output()), []);
  }
});

test("迁移命令连不上数据库：退出码 1，提示里没有连接串和密码", async () => {
  const running = start(MIGRATE_ENTRY, testEnv(UNREACHABLE_DATABASE_URL));
  assert.equal(await running.exited, 1);
  assert.match(running.output(), /迁移失败/);
  assert.deepEqual(leakedSecrets(running.output()), []);
});

test("连接池里的连接全部失效（对端不再应答）时收到 SIGTERM：仍在几秒内以退出码 0 结束，不会拖到强制退出", async () => {
  const proxy = await startTcpProxy(databaseTarget(db.url));
  const port = await freePort();
  const running = start(SERVER_ENTRY, { ...testEnv(proxy.rewrite(db.url)), PORT: String(port) });
  try {
    await waitForHealth(port, running);
    await Promise.all(Array.from({ length: 30 }, () => fetch(`http://127.0.0.1:${port}/health`)));
    assert.ok(proxy.openConnections() > 1, "前提：连接池里已经有多条连接");
    proxy.blackholeExisting();
    proxy.stall();

    const signalledAt = performance.now();
    running.child.kill("SIGTERM");
    assert.equal(await running.exited, 0, running.output());
    assert.ok(performance.now() - signalledAt < 6_000, "退出花了太久");
    assert.ok(!running.output().includes("强制退出"));
  } finally {
    if (running.child.exitCode === null) running.child.kill("SIGKILL");
    await proxy.close();
  }
});
