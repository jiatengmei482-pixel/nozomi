/**
 * 进程级测试：有在途请求时收到 SIGTERM 的优雅关闭。
 * 用 TCP 转发器让数据库暂时挂起，从而得到一个「正在处理中」的 /health 请求。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { Agent } from "node:http";
import { fileURLToPath } from "node:url";
import { type TestDatabase, createMigratedTestDatabase } from "./testing/db.ts";
import { leakedSecrets, testEnv } from "./testing/fixtures.ts";
import {
  type HttpResult,
  type Running,
  exitWithin,
  freePort,
  httpGet,
  sleep,
  startNode,
  waitForHealth,
  waitUntil,
} from "./testing/process.ts";
import { type TcpProxy, databaseTarget, startTcpProxy } from "./testing/tcp-proxy.ts";

const SERVER_ENTRY = fileURLToPath(new URL("./server.ts", import.meta.url));

let db: TestDatabase;
let proxy: TcpProxy;
before(async () => {
  db = await createMigratedTestDatabase();
  proxy = await startTcpProxy(databaseTarget(db.url));
});
after(async () => {
  await proxy.close();
  await db.drop();
});

interface InFlightOutcome {
  /** 在途请求最终拿到的响应（拿不到则是错误说明） */
  response: HttpResult | string;
  /** 关闭期间新发起的请求的结果 */
  lateRequest: string;
  /** 从发出 SIGTERM 到进程退出的结果 */
  exit: number | null | "timeout";
  msFromSignalToExit: number;
  output: string;
}

/**
 * 启动 API → 让数据库挂起 → 发一个 /health（卡在数据库查询上）→ 发 SIGTERM →
 * 关闭期间再发一个新请求 → 数据库恢复 → 看在途请求和进程各自的结局。
 */
async function sigtermWithRequestInFlight(agent: Agent): Promise<InFlightOutcome> {
  const port = await freePort();
  const running: Running = startNode(SERVER_ENTRY, { ...testEnv(proxy.rewrite(db.url)), PORT: String(port) });
  try {
    assert.equal((await waitForHealth(port, running)).status, 200);
    const requestsBefore = running.output().split('"msg":"incoming request"').length - 1;

    proxy.stall();
    const inFlight = httpGet(port, "/health", { agent }).catch((err: unknown) => `在途请求失败：${String(err)}`);
    const arrived = await waitUntil(
      () => running.output().split('"msg":"incoming request"').length - 1 > requestsBefore,
      5_000,
    );
    assert.ok(arrived, "在途请求没有到达服务");

    running.child.kill("SIGTERM");
    const signalledAt = performance.now();
    assert.ok(await waitUntil(() => running.output().includes("开始优雅关闭"), 5_000), "进程没有开始优雅关闭");
    assert.equal(running.child.exitCode, null, "在途请求还没结束，进程就退出了");
    const lateRequest = await httpGet(port, "/health").then(
      (res) => `得到了响应 ${res.status}`,
      (err: unknown) => `连接被拒绝 ${(err as { code?: string }).code ?? ""}`,
    );

    await sleep(300);
    proxy.resume();
    const response = await inFlight;
    // server.ts 的强制退出时限是 10 秒；正常的优雅关闭应远早于此
    const exit = await exitWithin(running, 6_000);
    return { response, lateRequest, exit, msFromSignalToExit: performance.now() - signalledAt, output: running.output() };
  } finally {
    proxy.resume();
    if (running.child.exitCode === null && running.child.signalCode === null) {
      running.child.kill("SIGKILL");
      await running.exited;
    }
  }
}

function assertInFlightCompleted(outcome: InFlightOutcome): void {
  assert.ok(typeof outcome.response !== "string", String(outcome.response));
  assert.equal(outcome.response.status, 200);
  const body = JSON.parse(outcome.response.body) as { status: string };
  assert.equal(body.status, "ok");
  assert.match(outcome.lateRequest, /^连接被拒绝/, "关闭期间不应再接收新请求");
}

test("在途请求（客户端不保持连接）时收到 SIGTERM：等它完整返回后才退出，退出码 0；关闭期间拒绝新连接", async () => {
  const outcome = await sigtermWithRequestInFlight(new Agent({ keepAlive: false }));
  assertInFlightCompleted(outcome);
  assert.equal(outcome.exit, 0, `退出结果 ${outcome.exit}，输出：\n${outcome.output}`);
  assert.match(outcome.output, /已关闭/);
  assert.ok(!outcome.output.includes("强制退出"));
  assert.deepEqual(leakedSecrets(outcome.output), []);
});

test("在途请求（HTTP/1.1 默认的保持连接）时收到 SIGTERM：请求返回后应立即正常退出（退出码 0），而不是等到超时被强制退出", async () => {
  const agent = new Agent({ keepAlive: true });
  try {
    const outcome = await sigtermWithRequestInFlight(agent);
    assertInFlightCompleted(outcome);
    assert.equal(
      outcome.exit,
      0,
      `在途请求早已返回，但进程在 SIGTERM 后 ${Math.round(outcome.msFromSignalToExit)}ms 的结果是 ${outcome.exit}` +
        `（timeout = 6 秒内没有退出）。相关日志：${outcome.output
          .split("\n")
          .filter((line) => /关闭|退出/.test(line))
          .join(" | ")}`,
    );
    assert.match(outcome.output, /已关闭/);
    assert.ok(!outcome.output.includes("强制退出"));
  } finally {
    agent.destroy();
  }
});
