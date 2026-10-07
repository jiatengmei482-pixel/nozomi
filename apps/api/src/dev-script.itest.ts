/**
 * `pnpm dev` 的进程级测试：按 package.json 里 dev 脚本的原样命令启动（带 --watch），
 * 验证能启动 API，以及结束它时服务进程会跟着退出、不留下占着端口的孤儿进程。
 *
 * 子进程只拿到测试传入的环境变量，并自成一个进程组；测试结束时整组强制清理。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { type TestDatabase, createTestDatabase } from "./testing/db.ts";
import { leakedSecrets, testEnv } from "./testing/fixtures.ts";
import {
  type Running,
  exitWithin,
  freePort,
  httpGet,
  killGroup,
  startProcess,
  waitForHealth,
  waitUntil,
} from "./testing/process.ts";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

let db: TestDatabase;
let devCommand: string;
before(async () => {
  db = await createTestDatabase();
  const pkg = JSON.parse(await readFile(new URL("package.json", `file://${REPO_ROOT}`), "utf8")) as {
    scripts: Record<string, string>;
  };
  devCommand = pkg.scripts["dev"] ?? "";
});
after(() => db.drop());

/** 和 pnpm 一样，用 `sh -c` 在仓库根目录执行 dev 脚本；exec 让我们拿到的就是 node --watch 那个进程。 */
function startDev(port: number): Running {
  return startProcess("sh", ["-c", `exec ${devCommand}`], { ...testEnv(db.url), PORT: String(port) }, {
    cwd: REPO_ROOT,
    detached: true,
  });
}

async function isListening(port: number): Promise<boolean> {
  try {
    await httpGet(port, "/health");
    return true;
  } catch {
    return false;
  }
}

test("dev 脚本用 --watch 启动的是 API 入口文件", () => {
  assert.match(devCommand, /^node\b/);
  assert.match(devCommand, /--watch\b/);
  assert.match(devCommand, /apps\/api\/src\/server\.ts$/);
});

test("pnpm dev 的命令能启动 API：/health 经真实 HTTP 返回 200，数据库连通，输出里没有密钥原文", async () => {
  const port = await freePort();
  const running = startDev(port);
  try {
    const res = await waitForHealth(port, running, 20_000);
    assert.equal(res.status, 200, res.body);
    const body = JSON.parse(res.body) as { status: string; database: { state: string }; integrations: unknown[] };
    assert.equal(body.status, "ok");
    assert.equal(body.database.state, "up");
    assert.equal(body.integrations.length, 5);
    assert.deepEqual(leakedSecrets(res.body), []);
    assert.deepEqual(leakedSecrets(running.output()), []);
  } finally {
    killGroup(running);
    await running.exited;
  }
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  test(`结束 pnpm dev 的进程（${signal}）：不崩溃，API 服务进程跟着退出，端口被释放`, async () => {
    const port = await freePort();
    const running = startDev(port);
    try {
      assert.equal((await waitForHealth(port, running, 20_000)).status, 200);
      running.child.kill(signal);
      const exit = await exitWithin(running, 10_000);
      assert.notEqual(exit, "timeout", "收到信号 10 秒后 dev 进程还没退出");
      const crash = /Assertion failed|Aborted|core dumped|Native stack trace/.exec(running.output());
      assert.equal(
        crash,
        null,
        `dev 进程不是正常退出而是崩溃了（退出码 ${exit}，信号 ${running.child.signalCode}）：${running
          .output()
          .split("\n")
          .filter((line) => /Assertion|#  node|fs_event|watch_mode/.test(line))
          .join(" | ")}`,
      );
      const released = await waitUntil(async () => !(await isListening(port)), 5_000, 200);
      assert.ok(released, "dev 进程已经退出，但 API 服务进程还活着并占着端口（孤儿进程）");
    } finally {
      killGroup(running);
      await running.exited;
    }
  });
}
