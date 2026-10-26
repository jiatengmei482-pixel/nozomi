/**
 * 端到端测试的公用步骤。测试数据全部经真实 API 创建在本次运行的临时 schema 里，运行结束随 schema 一起删除。
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { withPlatformTx } from "../../api/src/db/context.ts";
import { createPool } from "../../api/src/db/pool.ts";
import { platformApiLogin, uiSecondFactor } from "./mfa.ts";

/** 假汇率源给的汇率（global-setup 起的本机假服务器；端到端测试里现场给的数，不是业务数据）。 */
export const E2E_FX_RATES = { JPY: "150.5", CNY: "7.2", KRW: "1400", HKD: "7.8", TWD: "32", THB: "36" };

/** 官网登记的客服电话（global-setup 给主 API 的 SITE_SUPPORT_PHONE；公开值，只在这次运行的进程环境里）。 */
export const E2E_SUPPORT_PHONE = "+81 3-0000-0000";

export const VIEWPORTS = {
  phone360: { width: 360, height: 740 },
  phone400: { width: 400, height: 800 },
  desktop: { width: 1280, height: 800 },
} as const;

/**
 * 这个用例用的平台超级管理员。global-setup 准备了一批，**每个测试进程独占其中几个**：按 Playwright 的并行编号 `TEST_PARALLEL_INDEX`
 * （同一时刻在跑的进程编号各不相同；进程退出重启后接着用同一个编号），编号对 `E2E_WORKERS` 取余相同的归这个进程；
 * 在自己的几个里再按用例编号固定挑一个（同一个用例里每次拿到的都是同一个人）。
 * 为什么独占：同一个人同一个 30 秒里的动态码只能用一次（ADR 0030），两个进程共用一个人会用掉对方的码，被拒的码算一次失败，
 * 累计起来会触发登录限速的「邮箱」一层。独占之后只有本进程会用这个人，动态码的时间窗在 mfa.ts 里按顺序取、不够就等。
 */
export function adminCredentials(): { email: string; password: string } {
  const admins = JSON.parse(process.env["E2E_ADMINS"] ?? "[]") as { email: string; password: string }[];
  const workers = Math.max(1, Number(process.env["E2E_WORKERS"] ?? 1));
  const slot = Number(process.env["TEST_PARALLEL_INDEX"] ?? 0);
  const own = admins.filter((_, index) => index % workers === slot % workers);
  let pick = 0;
  try {
    pick = [...test.info().testId].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7);
  } catch {
    // 不在用例里（准备数据的辅助函数在用例之外调用时）：用这个进程的第一个
  }
  const admin = own[pick % Math.max(own.length, 1)];
  if (!admin) throw new Error(`global-setup 准备的平台管理员不够：并行编号 ${slot}，共 ${admins.length} 个`);
  return { email: admin.email, password: admin.password };
}

/** 一个符合强度规则、每次不同的密码。 */
export function newPassword(): string {
  return `Pw-${randomBytes(12).toString("base64url")}-7q`;
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomBytes(5).toString("hex")}@e2e.example.com`;
}

async function okJson<T>(response: Awaited<ReturnType<APIRequestContext["post"]>>, what: string): Promise<T> {
  expect(response.ok(), `${what} 失败：HTTP ${response.status()}`).toBe(true);
  return (await response.json()) as T;
}

/** 本进程里各个平台管理员的令牌（每人登录并完成两步验证一次，之后复用：令牌 8 小时有效，够一次运行用）。 */
const adminTokens = new Map<string, Promise<string>>();

/** 以平台管理员身份直接调 API（准备数据用），返回带令牌的请求头。 */
export async function platformAdminHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  const { email, password } = adminCredentials();
  let token = adminTokens.get(email);
  if (token === undefined) {
    token = platformApiLogin(request, email, password).catch((err: unknown) => {
      adminTokens.delete(email);
      throw err;
    });
    adminTokens.set(email, token);
  }
  return { authorization: `Bearer ${await token}` };
}

export interface InvitedTenant {
  tenantId: string;
  tenantName: string;
  adminEmail: string;
  adminName: string;
  inviteToken: string;
}

/**
 * 经 API 建一家供应商（同时邀请它的管理员）。新建的供应商从「申请中」开始（ADR 0028）；不测入驻流程的用例要的是一家能上架、
 * 能参与比价的供应商，所以默认直接在库里把它摆成「正常」（`activateTenant`）。测入驻的用例给 `onboarding: "applying"`。
 */
export async function createTenant(request: APIRequestContext, options: { onboarding?: "applying" | "active" } = {}): Promise<InvitedTenant> {
  const headers = await platformAdminHeaders(request);
  const tenantName = `端到端测试供应商 ${randomBytes(3).toString("hex")}`;
  const adminEmail = uniqueEmail("tenant-admin");
  const adminName = "端到端测试租户管理员";
  const response = await request.post("/platform/v1/tenants", { headers, data: { name: tenantName, admin: { email: adminEmail, name: adminName } } });
  const body = await okJson<{ tenant: { id: string }; invite: { token: string } }>(response, "创建租户");
  if ((options.onboarding ?? "active") === "active") await activateTenant(body.tenant.id);
  return { tenantId: body.tenant.id, tenantName, adminEmail, adminName, inviteToken: body.invite.token };
}

/**
 * 测试准备：把一家供应商直接在库里摆成「正常」（跳过资质审核、合同、试运营；入驻流程本身由 onboarding.spec.ts 经页面走一遍）。
 * 用本次运行的应用账号、平台角色（和服务进程一样的权限），只改这一家的状态。
 */
export async function activateTenant(tenantId: string): Promise<void> {
  const databaseUrl = process.env["E2E_DATABASE_URL"];
  if (!databaseUrl) throw new Error("global-setup 没有交出本次运行的数据库连接串");
  const pool = createPool(databaseUrl, { max: 1 });
  try {
    await withPlatformTx(pool, (db) => db.query("update tenants set status = 'active', signed_at = now(), trial_started_at = now(), activated_at = now() where id = $1", [tenantId]));
  } finally {
    await pool.end();
  }
}

/**
 * 双人复核里的审核人：一位「运营」平台员工，每个测试进程建一次（经真实接口邀请、设密码），返回带令牌的请求头。
 * 登录一次并完成两步验证（ADR 0030，第一次是绑定），之后复用令牌。
 */
let approver: Promise<{ email: string; token: string }> | null = null;
export async function approverHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  approver ??= (async () => {
    const headers = await platformAdminHeaders(request);
    const email = uniqueEmail("approver");
    const password = newPassword();
    const invited = await okJson<{ invite: { token: string } }>(await request.post("/platform/v1/staff", { headers, data: { email, name: "端到端测试审核人", role: "operations" } }), "邀请审核人");
    await okJson(await request.post("/platform/v1/auth/accept-invite", { data: { token: invited.invite.token, password } }), "审核人设密码");
    return { email, token: await platformApiLogin(request, email, password) };
  })().catch((err: unknown) => {
    approver = null;
    throw err;
  });
  return { authorization: `Bearer ${(await approver).token}` };
}

/** 审核人的邮箱（审计日志里批准的操作人是他）。 */
export async function approverEmail(request: APIRequestContext): Promise<string> {
  await approverHeaders(request);
  return (await (approver as Promise<{ email: string }>)).email;
}

/** 某个对象上待审核的复核（管理员看得到全部类别）。 */
export async function pendingApproval(request: APIRequestContext, resourceId: string, kind: string): Promise<string> {
  const headers = await platformAdminHeaders(request);
  const body = await okJson<{ items: { id: string; resource_id: string; kind: string }[] }>(await request.get(`/platform/v1/approvals?status=pending&resource_id=${encodeURIComponent(resourceId)}&limit=50`, { headers }), "查待审核");
  const found = body.items.find((item) => item.resource_id === resourceId && item.kind === kind);
  if (found === undefined) throw new Error(`没有 ${resourceId} 上 ${kind} 的待审核复核`);
  return found.id;
}

/** 批准一条复核（审核人是 `approverHeaders` 那位）。 */
export async function approveApproval(request: APIRequestContext, approvalId: string): Promise<void> {
  await okJson(await request.post(`/platform/v1/approvals/${approvalId}/approve`, { headers: await approverHeaders(request), data: {} }), "批准复核");
}

/** 创建租户并经 API 接受邀请，得到一个可以直接登录的租户管理员。 */
export async function createActiveTenant(request: APIRequestContext): Promise<InvitedTenant & { password: string }> {
  const tenant = await createTenant(request);
  const password = newPassword();
  const response = await request.post("/tenant/v1/auth/accept-invite", { data: { token: tenant.inviteToken, password } });
  await okJson(response, "接受邀请");
  return { ...tenant, password };
}

export async function issueTenantAdminReset(request: APIRequestContext, tenantId: string, email: string): Promise<string> {
  const headers = await platformAdminHeaders(request);
  const response = await request.post(`/platform/v1/tenants/${tenantId}/admin-password-resets`, { headers, data: { email } });
  return (await okJson<{ reset: { token: string } }>(response, "发重置令牌")).reset.token;
}

/** 人工暂停一家供应商：管理员发起（双人复核，ADR 0028），审核人批准。 */
export async function suspendTenant(request: APIRequestContext, tenantId: string, reason = "端到端测试"): Promise<void> {
  const headers = await platformAdminHeaders(request);
  const response = await request.post(`/platform/v1/tenants/${tenantId}/suspend`, { headers, data: { reason } });
  const body = await okJson<{ approval: { id: string } }>(response, "发起暂停");
  await approveApproval(request, body.approval.id);
}

/**
 * 点「登录」。运营后台密码正确时接着在页面上完成两步验证（ADR 0030：绑定或输入动态码，见 mfa.ts），
 * 除非 `secondFactor: "manual"`（测两步验证页面本身的用例自己操作）。密码不对、被拦下时什么也不多做。
 */
export async function clickLogin(page: Page, email: string, options: { secondFactor?: "auto" | "manual" } = {}): Promise<void> {
  const responded = page.waitForResponse((response) => response.url().endsWith("/platform/v1/auth/login") && response.request().method() === "POST", { timeout: 15_000 }).catch(() => null);
  await page.getByRole("button", { name: "登录" }).click();
  if (!page.url().includes("/platform/") || options.secondFactor === "manual") return;
  const response = await responded;
  if (response === null || response.status() !== 200) return;
  const status = ((await response.json().catch(() => null)) as { second_factor?: { status?: string } } | null)?.second_factor?.status;
  if (status === "enrollment_required" || status === "verify_required") await uiSecondFactor(page, email, status);
}

/** 填登录表单并提交（运营后台接着完成两步验证，见 `clickLogin`）。 */
export async function fillLogin(page: Page, email: string, password: string, options: { secondFactor?: "auto" | "manual" } = {}): Promise<void> {
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await clickLogin(page, email, options);
}

export async function loginAs(page: Page, portal: "tenant" | "platform", email: string, password: string): Promise<void> {
  await page.goto(portal === "tenant" ? "/login" : "/platform/login");
  await fillLogin(page, email, password);
  await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();
}

/**
 * 当前登录的某一项信息在页面上的位置。供应商后台的首页原来有一张「当前登录」卡片，现在按 tenant-home.md：
 * 供应商名称和状态在首页的标题行，姓名和角色在顶栏的账号按钮上；邮箱只在账号菜单里，用 expectSignedInAs 核对。
 */
const DETAIL_SELECTORS: Readonly<Record<string, string>> = { 姓名: ".account-button__name", 角色: ".account-button__role", 供应商名称: ".page__meta .tenant-name", 供应商状态: ".page__meta .tenant-status" };
export function detail(page: Page, label: string) {
  const selector = DETAIL_SELECTORS[label];
  if (selector === undefined) throw new Error(`「${label}」不在页面上直接显示，请用 expectSignedInAs`);
  return page.locator(selector);
}

/**
 * 当前登录的是谁：打开顶栏的账号菜单核对姓名、角色、邮箱，再关上。
 * 运营后台的首页是模块入口，不再有「当前登录」卡片，这些内容只在账号菜单里。
 */
export async function expectSignedInAs(page: Page, expected: { name?: string; role?: string; email?: string }): Promise<void> {
  await page.getByRole("button", { name: /账号菜单/ }).click();
  const header = page.locator(".menu-header");
  if (expected.name !== undefined) await expect(header.locator(".menu-header__name")).toHaveText(expected.name);
  if (expected.role !== undefined) await expect(header.locator(".menu-header__detail").first()).toHaveText(expected.role);
  if (expected.email !== undefined) await expect(header.locator(".menu-header__email")).toHaveText(expected.email);
  await page.keyboard.press("Escape");
}

/**
 * 页面本身不出现横向滚动（docs/design/03-layout.md 第 5 节的断言）。
 * 后台框架里纵向滚动的是 <main>，所以它也要查。
 */
export async function expectNoHorizontalOverflow(page: Page, what: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    const main = document.querySelector("main");
    return {
      page: root.scrollWidth - root.clientWidth,
      main: main ? main.scrollWidth - main.clientWidth : 0,
      viewport: root.clientWidth,
    };
  });
  expect(overflow.page, `${what}：页面在 ${overflow.viewport}px 宽度下横向溢出`).toBe(0);
  expect(overflow.main, `${what}：内容区在 ${overflow.viewport}px 宽度下横向溢出`).toBe(0);
}

/** 需要留图时（设置了 E2E_SCREENSHOT_DIR）把当前页面存成图片；平时什么都不做。 */
export async function snapshot(page: Page, name: string): Promise<void> {
  const dir = process.env["E2E_SCREENSHOT_DIR"];
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

/**
 * 用真实的命令行 `admin-create.ts --temporary-password` 创建一个平台超级管理员，
 * 从标准输出里「临时密码：」那一行读出临时密码（ADR 0013）。连的是本次运行的临时 schema。
 */
export function createTemporaryPasswordAdmin(): Promise<{ email: string; name: string; temporaryPassword: string }> {
  const databaseUrl = process.env["E2E_DATABASE_URL"];
  if (!databaseUrl) throw new Error("global-setup 没有交出本次运行的数据库连接串");
  const email = uniqueEmail("temp-admin");
  const name = "端到端测试临时密码管理员";
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    APP_ENV: "ci",
    DATABASE_URL: databaseUrl,
    AUTH_JWT_SECRET: randomBytes(48).toString("base64url"),
  };
  delete env["DATABASE_MIGRATION_URL"];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["apps/api/src/cli/admin-create.ts", "--email", email, "--name", name, "--temporary-password"], {
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      const temporaryPassword = /^临时密码：(\S+)$/m.exec(stdout)?.[1];
      if (code !== 0 || !temporaryPassword) reject(new Error(`admin:create --temporary-password 失败（退出码 ${code}）：${stderr}`));
      else resolve({ email, name, temporaryPassword });
    });
  });
}

function runCli(script: string, args: readonly string[]): Promise<string> {
  const databaseUrl = process.env["E2E_DATABASE_URL"];
  if (!databaseUrl) throw new Error("global-setup 没有交出本次运行的数据库连接串");
  const env: NodeJS.ProcessEnv = { ...process.env, APP_ENV: "ci", DATABASE_URL: databaseUrl, AUTH_JWT_SECRET: randomBytes(48).toString("base64url") };
  delete env["DATABASE_MIGRATION_URL"];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [`apps/api/src/cli/${script}`, ...args], { cwd: fileURLToPath(new URL("../../../", import.meta.url)), env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve(stdout) : reject(new Error(`${script} 失败（退出码 ${code}）：${stderr}`))));
  });
}

export interface SampleAirport {
  iata: string;
  name: string;
  lat: number;
  lng: number;
}

/** 三个大写字母的随机编码片段：机场三字码、城市编码的序号都用它，避免并行的用例互相撞。 */
export function randomLetters(length = 3): string {
  return Array.from(randomBytes(length), (byte) => String.fromCharCode(65 + (byte % 26))).join("");
}

/**
 * 用真实的导入命令 `masterdata-import-airports.ts --file` 导入一小份测试里构造的机场清单（OurAirports 的 CSV 格式）。
 * 不联网；导入进来的机场是停用的、没有所属城市，和正式导入完全一样。
 */
export async function importAirports(country: string, airports: readonly SampleAirport[]): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "nozomi-e2e-airports-"));
  try {
    const header = "id,ident,type,name,latitude_deg,longitude_deg,iso_country,scheduled_service,iata_code";
    const rows = airports.map((airport) => [String(100000 + randomBytes(3).readUIntBE(0, 3)), `X${airport.iata}`, "large_airport", `"${airport.name}"`, airport.lat, airport.lng, country, "yes", airport.iata].join(","));
    const file = join(dir, "airports.csv");
    await writeFile(file, `${[header, ...rows].join("\n")}\n`, "utf8");
    // 导入命令同一时间只允许跑一个（后到的立即退出）；并行的用例撞上时等一下再来，不算失败
    for (let attempt = 1; ; attempt += 1) {
      try {
        await runCli("masterdata-import-airports.ts", ["--country", country, "--file", file]);
        break;
      } catch (err) {
        const busy = err instanceof Error && /IMPORT_ALREADY_RUNNING|IMPORT_CODE_CONFLICT/.test(err.message);
        if (!busy || attempt >= 20) throw err;
        await new Promise((resolve) => setTimeout(resolve, 150 + Math.floor(Math.random() * 250)));
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export interface SampleAirportNames {
  iata: string;
  lat: number;
  lng: number;
  /** GeoNames alternateNames 的「语言标签 → 名称」，例如 { ja: "成田国際空港", zh: "成田国际机场" } */
  names: Record<string, string>;
}

/**
 * 用真实的导入命令 `masterdata-import-airport-names.ts --file --names-file` 给已经导入的机场填中文名、日文名（M1-15）。
 * 两个文件（GeoNames 的国家文件和 alternateNames 文件）都在这里按测试给的内容现场构造，不联网。
 */
export async function importAirportNames(country: string, airports: readonly SampleAirportNames[]): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "nozomi-e2e-airport-names-"));
  try {
    const places: string[] = [];
    const names: string[] = [];
    for (const airport of airports) {
      const geonameId = 90_000_000 + randomBytes(3).readUIntBE(0, 3);
      places.push([geonameId, `Sample ${airport.iata}`, `Sample ${airport.iata}`, "", airport.lat, airport.lng, "S", "AIRP", country, "", "01", "", "", "", 0, "", 0, "Asia/Tokyo", "2026-01-01"].join("\t"));
      for (const [tag, name] of [["iata", airport.iata], ...Object.entries(airport.names)]) names.push([90_000_000 + names.length, geonameId, tag, name, "", "", "", "", "", ""].join("\t"));
    }
    await writeFile(join(dir, `${country}.txt`), `${places.join("\n")}\n`, "utf8");
    const namesDir = join(dir, "alternatenames");
    await mkdir(namesDir);
    await writeFile(join(namesDir, `${country}.txt`), `${names.join("\n")}\n`, "utf8");
    // 导入命令同一时间只允许跑一个；并行的用例撞上时等一下再来
    for (let attempt = 1; ; attempt += 1) {
      try {
        await runCli("masterdata-import-airport-names.ts", ["--country", country, "--file", join(dir, `${country}.txt`), "--names-file", join(namesDir, `${country}.txt`)]);
        break;
      } catch (err) {
        if (!(err instanceof Error && /IMPORT_ALREADY_RUNNING/.test(err.message)) || attempt >= 20) throw err;
        await new Promise((resolve) => setTimeout(resolve, 150 + Math.floor(Math.random() * 250)));
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * 等页面上的过渡和动画结束（切换亮暗主题后按钮等的颜色有短暂过渡，过渡中测对比度会得到中间色，axe 偶发报对比度不够）。
 * 每个无障碍检查之前都要调用。一直转的动画（加载中的转圈）没有结束的时候，不等它。
 */
export async function settleAnimations(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => Number.isFinite(Number(animation.effect?.getComputedTiming().endTime ?? 0)))
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}
