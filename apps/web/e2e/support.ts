/**
 * 端到端测试的公用步骤。测试数据全部经真实 API 创建在本次运行的临时 schema 里，运行结束随 schema 一起删除。
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { type APIRequestContext, type Page, expect } from "@playwright/test";

export const VIEWPORTS = {
  phone360: { width: 360, height: 740 },
  phone400: { width: 400, height: 800 },
  desktop: { width: 1280, height: 800 },
} as const;

export function adminCredentials(): { email: string; password: string } {
  const email = process.env["E2E_ADMIN_EMAIL"];
  const password = process.env["E2E_ADMIN_PASSWORD"];
  if (!email || !password) throw new Error("global-setup 没有准备好平台管理员账号");
  return { email, password };
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

/** 以平台管理员身份直接调 API（准备数据用），返回带令牌的请求头。 */
export async function platformAdminHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  const { email, password } = adminCredentials();
  const response = await request.post("/platform/v1/auth/login", { data: { email, password } });
  const body = await okJson<{ access_token: string }>(response, "平台管理员登录");
  return { authorization: `Bearer ${body.access_token}` };
}

export interface InvitedTenant {
  tenantId: string;
  tenantName: string;
  adminEmail: string;
  adminName: string;
  inviteToken: string;
}

export async function createTenant(request: APIRequestContext): Promise<InvitedTenant> {
  const headers = await platformAdminHeaders(request);
  const tenantName = `端到端测试供应商 ${randomBytes(3).toString("hex")}`;
  const adminEmail = uniqueEmail("tenant-admin");
  const adminName = "端到端测试租户管理员";
  const response = await request.post("/platform/v1/tenants", { headers, data: { name: tenantName, admin: { email: adminEmail, name: adminName } } });
  const body = await okJson<{ tenant: { id: string }; invite: { token: string } }>(response, "创建租户");
  return { tenantId: body.tenant.id, tenantName, adminEmail, adminName, inviteToken: body.invite.token };
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

export async function suspendTenant(request: APIRequestContext, tenantId: string): Promise<void> {
  const headers = await platformAdminHeaders(request);
  const response = await request.post(`/platform/v1/tenants/${tenantId}/suspend`, { headers, data: { reason: "端到端测试" } });
  await okJson(response, "暂停租户");
}

export async function fillLogin(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录" }).click();
}

export async function loginAs(page: Page, portal: "tenant" | "platform", email: string, password: string): Promise<void> {
  await page.goto(portal === "tenant" ? "/login" : "/platform/login");
  await fillLogin(page, email, password);
  await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();
}

/** 「标签：值」里某一项的值。 */
export function detail(page: Page, label: string) {
  return page.locator(".details__item").filter({ has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) }).locator("dd");
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
