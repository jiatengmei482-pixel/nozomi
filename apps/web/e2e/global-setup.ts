/**
 * 端到端测试的环境准备（每次运行一次）：
 * 1. 在数据库里新建一个随机名字的 schema 并用迁移账号执行全部迁移（做法同后端集成测试）；API 进程只用应用账号；
 * 2. 用 `admin:create` 的命令行创建平台超级管理员，密码走标准输入；
 * 3. 起 API 进程和前端（vite preview，把 API 前缀代理给刚起的 API）；
 * 4. 把管理员账号通过环境变量交给测试进程；另把本次运行的数据库连接串也交过去，
 *    需要「用临时密码创建的管理员」的用例自己再跑一次同一个命令行（见 support.ts）。
 * 返回的函数在全部测试结束后执行：停掉两个进程，删除整个 schema，不留任何数据。
 *
 * 这里的密码和签名密钥都是本次运行临时生成的随机值，不是任何环境的真实密钥。
 */
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createMigratedTestDatabase } from "../../api/src/testing/db.ts";
import { E2E_API_PORT, E2E_WEB_PORT } from "../playwright.config.ts";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const WEB_ROOT = fileURLToPath(new URL("../", import.meta.url));
const START_TIMEOUT_MS = 30_000;

interface Running {
  name: string;
  child: ChildProcess;
  output: string[];
}

function start(name: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Running {
  const child = spawn(process.execPath, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  const output: string[] = [];
  const keep = (chunk: Buffer): void => {
    output.push(chunk.toString("utf8"));
    if (output.length > 200) output.shift();
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  return { name, child, output };
}

async function stop(running: Running): Promise<void> {
  if (running.child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => running.child.once("exit", () => resolve()));
  running.child.kill("SIGTERM");
  const forced = setTimeout(() => running.child.kill("SIGKILL"), 10_000);
  await exited;
  clearTimeout(forced);
}

async function waitUntilUp(running: Running, url: string): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (running.child.exitCode !== null) break;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // 还没起来，稍后再试
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${running.name} 没有在 ${START_TIMEOUT_MS / 1000} 秒内就绪（${url}）。最后的输出：\n${running.output.join("")}`);
}

async function assertPortFree(port: number, what: string, variable: string): Promise<void> {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1_000) });
  } catch {
    return;
  }
  throw new Error(`端口 ${port} 已被占用，无法启动${what}。请关掉占用它的进程，或用环境变量 ${variable} 换一个端口。`);
}

function runAdminCreate(env: NodeJS.ProcessEnv, email: string, name: string, password: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["apps/api/src/cli/admin-create.ts", "--email", email, "--name", name], {
      cwd: REPO_ROOT,
      env,
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`admin:create 失败（退出码 ${code}）：${stderr}`))));
    child.stdin.end(`${password}\n`);
  });
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  if (!existsSync(`${WEB_ROOT}dist/index.html`)) {
    throw new Error("没有找到前端构建产物 apps/web/dist。请用 pnpm test:e2e 运行（它会先构建）。");
  }
  await assertPortFree(E2E_API_PORT, " API", "E2E_API_PORT");
  await assertPortFree(E2E_WEB_PORT, "前端", "E2E_WEB_PORT");

  const database = await createMigratedTestDatabase();
  const started: Running[] = [];
  const teardown = async (): Promise<void> => {
    for (const running of started.reverse()) await stop(running);
    await database.drop();
  };

  try {
    const apiOrigin = `http://127.0.0.1:${E2E_API_PORT}`;
    const apiEnv: NodeJS.ProcessEnv = {
      ...process.env,
      APP_ENV: "ci",
      PORT: String(E2E_API_PORT),
      PUBLIC_BASE_URL: apiOrigin,
      DATABASE_URL: database.url,
      AUTH_JWT_SECRET: randomBytes(48).toString("base64url"),
      TRUST_PROXY_HOPS: "0",
    };
    // 服务进程只拿应用账号（ADR 0010），迁移账号不交给它。
    delete apiEnv["DATABASE_MIGRATION_URL"];

    const adminEmail = `e2e-admin-${randomBytes(4).toString("hex")}@e2e.example.com`;
    const adminPassword = `E2e-${randomBytes(18).toString("base64url")}-9z`;
    await runAdminCreate(apiEnv, adminEmail, "端到端测试管理员", adminPassword);

    const api = start("API", ["apps/api/src/server.ts"], REPO_ROOT, apiEnv);
    started.push(api);
    await waitUntilUp(api, `${apiOrigin}/health`);

    const web = start(
      "前端",
      ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", String(E2E_WEB_PORT), "--strictPort"],
      WEB_ROOT,
      { ...process.env, NOZOMI_API_ORIGIN: apiOrigin },
    );
    started.push(web);
    await waitUntilUp(web, `http://127.0.0.1:${E2E_WEB_PORT}/login`);

    process.env["E2E_ADMIN_EMAIL"] = adminEmail;
    process.env["E2E_ADMIN_PASSWORD"] = adminPassword;
    process.env["E2E_DATABASE_URL"] = database.url;
  } catch (err) {
    await teardown();
    throw err;
  }
  return teardown;
}
