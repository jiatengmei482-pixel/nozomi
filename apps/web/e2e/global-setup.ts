/**
 * 端到端测试的环境准备（每次运行一次）：
 * 1. 在数据库里新建一个随机名字的 schema 并用迁移账号执行全部迁移（做法同后端集成测试）；API 进程只用应用账号；
 * 2. 用 `admin:create` 的命令行创建平台超级管理员，密码走标准输入；
 * 3. 起一个本机的假瓦片服务（地图底图；测试从不请求任何真实的底图服务）和一个假汇率源（汇率中心定时拉取、立即拉取都指向它，
 *    给的是「一小时前」的一批，日期跟着今天走），再起 API 进程和前端
 *    （vite preview，把 API 前缀代理给刚起的 API）。API 的底图配置指向假瓦片服务；
 *    另起一个不配置底图的 API 进程（同一个数据库、同一把签名密钥），给「没有底图」的用例取它真实的 map/config；
 * 4. 把管理员账号通过环境变量交给测试进程；另把本次运行的数据库连接串也交过去，
 *    需要「用临时密码创建的管理员」的用例自己再跑一次同一个命令行（见 support.ts）。
 * 返回的函数在全部测试结束后执行：停掉两个进程，删除整个 schema，不留任何数据。
 *
 * 这里的密码和签名密钥都是本次运行临时生成的随机值，不是任何环境的真实密钥。
 */
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { type Server, createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createMigratedTestDatabase } from "../../api/src/testing/db.ts";
import { type FakeFxSource, fxSourceBody, startFakeFxSource } from "../../api/src/testing/fx-source.ts";
import { E2E_API_NO_MAP_PORT, E2E_API_PORT, E2E_FX_PORT, E2E_TILE_PORT, E2E_WEB_PORT } from "../playwright.config.ts";
import { nextCode } from "./mfa.ts";
import { E2E_FX_RATES } from "./support.ts";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const WEB_ROOT = fileURLToPath(new URL("../", import.meta.url));
const START_TIMEOUT_MS = 30_000;
/** 准备几个超级管理员：每个用例按编号固定用其中一个（见 support.ts 的 adminCredentials）。不多准备：平台员工列表一页 50 人，有的用例要在第一页找到自己刚建的人 */
const E2E_ADMIN_SLOTS = 6;

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

/** 1×1 的透明 PNG：假瓦片服务对任何瓦片地址都回它。 */
const TILE_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

/**
 * 假瓦片服务：`/{z}/{x}/{y}.png` 回一张 1×1 的图；`/stats` 回「收到过几次瓦片请求、各带了什么 Referer」，
 * 用例靠它确认页面真的去取了底图，以及带出去的来源信息符合配置。
 */
function startTileServer(port: number): Promise<Server> {
  const referers: string[] = [];
  const server = createServer((request, response) => {
    if (request.url === "/stats") {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ tiles: referers.length, referers: [...new Set(referers)] }));
      return;
    }
    if (/^\/\d+\/\d+\/\d+\.png$/.test(request.url ?? "")) {
      referers.push(request.headers.referer ?? "");
      response.writeHead(200, { "content-type": "image/png", "cache-control": "no-store", "cross-origin-resource-policy": "cross-origin" });
      response.end(TILE_PNG);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
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

/** 经接口给管理员绑定两步验证，返回密钥（Base32）。 */
async function enrollAdmin(apiOrigin: string, email: string, password: string): Promise<string> {
  const post = async (path: string, body: unknown, token?: string): Promise<Record<string, unknown>> => {
    const response = await fetch(`${apiOrigin}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`${path} 失败：HTTP ${response.status} ${await response.text()}`);
    return (await response.json()) as Record<string, unknown>;
  };
  const login = await post("/platform/v1/auth/login", { email, password });
  const token = login["access_token"] as string;
  const started = await post("/platform/v1/auth/mfa/enrollment", {}, token);
  const secret = started["secret"] as string;
  const { code } = await nextCode(secret);
  await post("/platform/v1/auth/mfa/enrollment/confirm", { code }, token);
  return secret;
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  if (!existsSync(`${WEB_ROOT}dist/index.html`)) {
    throw new Error("没有找到前端构建产物 apps/web/dist。请用 pnpm test:e2e 运行（它会先构建）。");
  }
  await assertPortFree(E2E_API_PORT, " API", "E2E_API_PORT");
  await assertPortFree(E2E_WEB_PORT, "前端", "E2E_WEB_PORT");
  await assertPortFree(E2E_TILE_PORT, "假瓦片服务", "E2E_WEB_PORT");
  await assertPortFree(E2E_API_NO_MAP_PORT, "没有配置底图的 API", "E2E_API_PORT");
  await assertPortFree(E2E_FX_PORT, "假汇率源", "E2E_API_PORT");

  const database = await createMigratedTestDatabase();
  const started: Running[] = [];
  let tileServer: Server | null = null;
  let fxSource: FakeFxSource | null = null;
  const teardown = async (): Promise<void> => {
    for (const running of started.reverse()) await stop(running);
    await fxSource?.close();
    if (tileServer) {
      tileServer.closeAllConnections();
      await new Promise<void>((resolve) => tileServer?.close(() => resolve()));
    }
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
      // 数据加密密钥（ADR 0027、0030：供应商的 Webhook 签名密钥、平台员工的两步验证密钥加密存储）：本次运行临时生成
      DATA_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
      TRUST_PROXY_HOPS: "0",
    };
    // 服务进程只拿应用账号（ADR 0010），迁移账号不交给它。
    delete apiEnv["DATABASE_MIGRATION_URL"];
    // 底图配置只由下面明确给出，不受运行测试的人自己环境的影响。
    for (const name of Object.keys(apiEnv)) if (name.startsWith("MAP_TILE_")) delete apiEnv[name];
    // 汇率：两个 API 进程都定时拉（同一个库，只会有一个真的去拉），数据源是本机的假服务器
    fxSource = await startFakeFxSource(E2E_FX_PORT);
    fxSource.respond(() => ({ body: fxSourceBody({ asOf: new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 - 3_600_000), rates: E2E_FX_RATES }) }));
    apiEnv["FX_SOURCE_URL"] = fxSource.url;
    apiEnv["FX_AUTO_FETCH"] = "true";

    // 准备一批超级管理员，用例分散着用（ADR 0030：同一个人同一个 30 秒里的动态码只能用一次，都抢同一个人会互相顶掉、还会被限速）
    const admins = Array.from({ length: E2E_ADMIN_SLOTS }, () => ({ email: `e2e-admin-${randomBytes(4).toString("hex")}@e2e.example.com`, password: `E2e-${randomBytes(18).toString("base64url")}-9z`, secret: "" }));
    for (const admin of admins) await runAdminCreate(apiEnv, admin.email, "端到端测试管理员", admin.password);
    const adminEmail = (admins[0] as { email: string }).email;
    const adminPassword = (admins[0] as { password: string }).password;

    const tileOrigin = `http://127.0.0.1:${E2E_TILE_PORT}`;
    tileServer = await startTileServer(E2E_TILE_PORT);
    const api = start("API", ["apps/api/src/server.ts"], REPO_ROOT, {
      ...apiEnv,
      MAP_TILE_URL_TEMPLATE: `${tileOrigin}/{z}/{x}/{y}.png`,
      MAP_TILE_ATTRIBUTION: "© 端到端测试底图|https://tiles.e2e.example.com/copyright",
    });
    started.push(api);
    await waitUntilUp(api, `${apiOrigin}/health`);

    const noMapOrigin = `http://127.0.0.1:${E2E_API_NO_MAP_PORT}`;
    const noMapApi = start("API（没有配置底图）", ["apps/api/src/server.ts"], REPO_ROOT, { ...apiEnv, PORT: String(E2E_API_NO_MAP_PORT), PUBLIC_BASE_URL: noMapOrigin });
    started.push(noMapApi);
    await waitUntilUp(noMapApi, `${noMapOrigin}/health`);

    const web = start(
      "前端",
      ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", String(E2E_WEB_PORT), "--strictPort"],
      WEB_ROOT,
      { ...process.env, NOZOMI_API_ORIGIN: apiOrigin, NOZOMI_MAP_TILE_CSP_SOURCES: tileOrigin },
    );
    started.push(web);
    await waitUntilUp(web, `http://127.0.0.1:${E2E_WEB_PORT}/login`);

    // 管理员第一次登录就绑定两步验证（ADR 0030），把密钥交给测试进程，它们登录时自己算动态码
    for (const admin of admins) admin.secret = await enrollAdmin(apiOrigin, admin.email, admin.password);
    process.env["E2E_ADMIN_EMAIL"] = adminEmail;
    process.env["E2E_ADMIN_PASSWORD"] = adminPassword;
    process.env["E2E_ADMINS"] = JSON.stringify(admins);
    process.env["E2E_DATABASE_URL"] = database.url;
    // 派车的用例要一张「已经付过款」的订单：端到端测试里没有 Stripe，由用例用迁移账号直接写进本次运行的 schema（只在测试里构造）
    process.env["E2E_DATABASE_OWNER_URL"] = database.ownerUrl;
  } catch (err) {
    await teardown();
    throw err;
  }
  return teardown;
}
