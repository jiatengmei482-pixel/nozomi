/**
 * 强制修改密码（ADR 0013）的端到端边界：测试角色补的用例。真实浏览器 + 真实后端 + 真实数据库。
 *
 * - 供应商后台一侧：本期没有给租户用户生成临时密码的途径，标记由测试直接改库构造（改的是本次运行的临时 schema）。
 * - 已登录的会话、标记在别处被置上 / 清掉；两个标签页；密码不进网址、存储和历史记录；改完之后的后退与刷新。
 */
import { AxeBuilder } from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
import { createPool } from "../../api/src/db/pool.ts";
import { adminCredentials, createActiveTenant, createTemporaryPasswordAdmin, detail, expectNoHorizontalOverflow, fillLogin, loginAs, newPassword } from "./support.ts";

const WARNING = "你正在使用临时密码，请先设置新密码。设置完成前不能使用其他功能。";
/** docker-compose.yml 里本地开发库的迁移账号（公开的本地默认值，不是密钥）；CI 里由 DATABASE_MIGRATION_URL 给出。 */
const LOCAL_MIGRATION_DATABASE_URL = "postgres://nozomi:nozomi@localhost:5432/nozomi";

/** 用迁移账号在本次运行的临时 schema 里直接改标记（应用账号不切换角色时没有表权限）。 */
async function setFlag(table: "platform_users" | "tenant_users", email: string, value: boolean): Promise<void> {
  const appUrl = process.env["E2E_DATABASE_URL"];
  if (!appUrl) throw new Error("global-setup 没有交出本次运行的数据库连接串");
  const options = new URL(appUrl).searchParams.get("options");
  if (!options?.includes("search_path=itest_")) throw new Error("本次运行的连接串没有指向临时 schema，拒绝改库");
  const migration = process.env["DATABASE_MIGRATION_URL"];
  const ownerUrl = new URL(migration && migration.trim() !== "" ? migration : LOCAL_MIGRATION_DATABASE_URL);
  ownerUrl.searchParams.set("options", options);
  const pool = createPool(ownerUrl.toString(), { max: 1 });
  try {
    const updated = await pool.query(`update ${table} set must_change_password = $2 where email = $1`, [email, value]);
    expect(updated.rowCount, `应当恰好改到 ${email} 这一行`).toBe(1);
  } finally {
    await pool.end();
  }
}

async function expectAccessible(page: Page, what: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = results.violations.map((violation) => `${violation.id}: ${violation.help}（${violation.nodes.map((node) => node.target.join(" ")).join("；")}）`);
  expect(summary, `${what} 的无障碍问题`).toEqual([]);
}

async function expectForced(page: Page, portal: "tenant" | "platform", what: string): Promise<void> {
  await expect(page, what).toHaveURL(portal === "tenant" ? /\/account\/password$/ : /\/platform\/account\/password$/);
  if (portal === "tenant") expect(new URL(page.url()).pathname, what).toBe("/account/password");
  await expect(page.getByRole("alert").filter({ hasText: WARNING }), what).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "修改密码" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "主菜单" }), `${what}：不显示导航`).toHaveCount(0);
  await expect(page.getByRole("button", { name: "打开菜单" })).toHaveCount(0);
}

async function savePassword(page: Page, current: string, next: string, currentLabel = "临时密码"): Promise<void> {
  await page.getByLabel(currentLabel).fill(current);
  await page.getByLabel("新密码", { exact: true }).fill(next);
  await page.getByLabel("再输入一次新密码").fill(next);
  await page.getByRole("button", { name: "保存新密码" }).click();
}

test("供应商后台：被标记的租户用户登录后只能改密码——各种地址都带回、后端确实拦着、320 宽不横向滚动、通过 axe；改完进首页，旧密码作废", async ({ page, request }) => {
  // 步骤多（十几次整页加载 + 四次 axe 检查），给三倍时限
  test.slow();
  const tenant = await createActiveTenant(request);
  await setFlag("tenant_users", tenant.adminEmail, true);
  const password = newPassword();

  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await fillLogin(page, tenant.adminEmail, tenant.password);
  await expectForced(page, "tenant", "登录后");
  await expect(page.locator(".topbar__brand")).toContainText("供应商后台");
  await expect(page.getByLabel("临时密码")).toBeVisible();

  for (const path of ["/", "/no-such-page", "/login", "/account/password/", "/Account/Password", "/account"]) {
    await page.goto(path);
    await expectForced(page, "tenant", `直接打开 ${path}`);
  }
  await page.reload();
  await expectForced(page, "tenant", "刷新后");
  await page.goBack();
  await expectForced(page, "tenant", "后退");
  await page.goForward();
  await expectForced(page, "tenant", "前进");

  // 另一个后台的地址：没有运营后台的登录状态，就是运营后台的登录页；回来仍然受限
  await page.goto("/platform");
  await expect(page).toHaveURL(/\/platform\/login$/);
  await expect(page.getByText(WARNING)).toHaveCount(0);
  await page.goto("/platform/account/password");
  await expect(page).toHaveURL(/\/platform\/login$/);
  await page.goto("/");
  await expectForced(page, "tenant", "从运营后台的地址回来");

  const blocked = await page.evaluate(async () => {
    const stored = JSON.parse(sessionStorage.getItem("nozomi.session.tenant") ?? "{}") as { accessToken?: string };
    const headers = { authorization: `Bearer ${stored.accessToken}` };
    const results: Record<string, number | string> = {};
    for (const [method, url] of [
      ["GET", "/tenant/v1/users"],
      ["GET", "/tenant/v1/audit-logs"],
      ["POST", "/tenant/v1/users"],
      ["GET", "/platform/v1/tenants"],
    ] as const) {
      const response = await fetch(url, { method, headers });
      results[`${method} ${url}`] = `${response.status} ${((await response.json()) as { error: { code: string } }).error.code}`;
    }
    return results;
  });
  expect(blocked).toEqual({
    "GET /tenant/v1/users": "403 PASSWORD_CHANGE_REQUIRED",
    "GET /tenant/v1/audit-logs": "403 PASSWORD_CHANGE_REQUIRED",
    "POST /tenant/v1/users": "403 PASSWORD_CHANGE_REQUIRED",
    "GET /platform/v1/tenants": "401 UNAUTHENTICATED",
  });

  await page.setViewportSize({ width: 320, height: 640 });
  await expectNoHorizontalOverflow(page, "供应商后台强制修改密码页 320px");
  await page.getByRole("button", { name: "保存新密码" }).click();
  await expect(page.getByText("请输入临时密码")).toBeVisible();
  await expectNoHorizontalOverflow(page, "供应商后台强制修改密码页字段出错 320px");
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `供应商后台强制修改密码页（${scheme}，320px）`);
  }
  await page.emulateMedia({ colorScheme: "light" });

  await savePassword(page, tenant.password, password);
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "新密码已生效，临时密码已作废。" })).toBeVisible();
  await expect(detail(page, "供应商名称")).toHaveText(tenant.tenantName);
  await expectNoHorizontalOverflow(page, "改完之后的首页 320px");
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByRole("navigation", { name: "主菜单" }).getByRole("link")).toHaveText(["首页"]);

  await page.getByRole("button", { name: /账号菜单/ }).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await fillLogin(page, tenant.adminEmail, tenant.password);
  await expect(page.getByRole("alert").filter({ hasText: "邮箱或密码不正确。" })).toBeVisible();
  await fillLogin(page, tenant.adminEmail, password);
  await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();
});

test("租户隔离：甲的用户被标记，乙的用户在同一个浏览器里登录完全不受影响；甲的用户仍然受限", async ({ browser, request }) => {
  const a = await createActiveTenant(request);
  const b = await createActiveTenant(request);
  await setFlag("tenant_users", a.adminEmail, true);

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    await pageA.goto("/login");
    await fillLogin(pageA, a.adminEmail, a.password);
    await expectForced(pageA, "tenant", "甲的用户");

    await loginAs(pageB, "tenant", b.adminEmail, b.password);
    await expect(detail(pageB, "供应商名称")).toHaveText(b.tenantName);
    await expect(pageB.getByRole("navigation", { name: "主菜单" })).toBeVisible();
    await expect(pageB.getByText(WARNING)).toHaveCount(0);
    await pageB.goto("/account/password");
    await expect(pageB.getByLabel("当前密码")).toBeVisible();

    await pageA.reload();
    await expectForced(pageA, "tenant", "乙登录之后甲仍然受限");
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test("已经登录着的会话：标记在别处被置上——刷新后被带到修改密码页；标记被清掉——刷新后恢复正常（以每次 auth/me 为准，不记在浏览器里）", async ({ page, request }) => {
  const tenant = await createActiveTenant(request);
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  await expect(page.getByRole("navigation", { name: "主菜单" })).toBeVisible();

  await setFlag("tenant_users", tenant.adminEmail, true);
  await page.reload();
  await expectForced(page, "tenant", "标记置上后刷新");
  expect(await page.evaluate(() => Object.keys(JSON.parse(sessionStorage.getItem("nozomi.session.tenant") ?? "{}")).sort())).toEqual(["accessToken", "expiresAt"]);

  await setFlag("tenant_users", tenant.adminEmail, false);
  await page.reload();
  await expect(page.getByLabel("当前密码"), "标记清掉后同一个地址就是普通的修改密码页").toBeVisible();
  await expect(page.getByText(WARNING)).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "主菜单" })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();
});

test("两个标签页都用临时密码登录：一个改完密码，另一个的会话随即失效——提交或刷新都回登录页并提示登录已过期；用新密码登录后不再受限", async ({ page, context }) => {
  const admin = await createTemporaryPasswordAdmin();
  const password = newPassword();
  await page.goto("/platform/login");
  await fillLogin(page, admin.email, admin.temporaryPassword);
  await expectForced(page, "platform", "第一个标签页");

  const second = await context.newPage();
  await second.goto("/platform/login");
  await fillLogin(second, admin.email, admin.temporaryPassword);
  await expectForced(second, "platform", "第二个标签页");
  await savePassword(second, admin.temporaryPassword, password);
  await expect(second.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();

  // 第一个标签页还停在改密页：拿已经作废的临时密码再提交一次
  await savePassword(page, admin.temporaryPassword, newPassword());
  await expect(page).toHaveURL(/\/platform\/login$/);
  await expect(page.getByRole("status").filter({ hasText: "登录已过期，请重新登录。" })).toBeVisible();
  await fillLogin(page, admin.email, admin.temporaryPassword);
  await expect(page.getByRole("alert").filter({ hasText: "邮箱或密码不正确。" })).toBeVisible();
  await fillLogin(page, admin.email, password);
  await expect(page.getByText(WARNING)).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "主菜单" }).first()).toBeVisible();

  // 第二个标签页（改密的那个）一直可用
  await second.reload();
  await expect(second.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();
  await second.close();
});

test("临时密码和新密码不进网址、浏览器存储、Cookie、历史记录状态；全程只有登录和改密两个请求的请求体里有它；没有发往别的站点的请求", async ({ page, context, baseURL }) => {
  const admin = await createTemporaryPasswordAdmin();
  const password = newPassword();
  const requests: { method: string; url: string; body: string; headers: string }[] = [];
  page.on("request", (req) => requests.push({ method: req.method(), url: req.url(), body: req.postData() ?? "", headers: JSON.stringify(req.headers()) }));
  const visited: string[] = [];
  page.on("framenavigated", (frame) => visited.push(frame.url()));

  const everythingStored = (): Promise<string> =>
    page.evaluate(() => {
      const dump = (storage: Storage): string =>
        Array.from({ length: storage.length }, (_, index) => `${storage.key(index)}=${storage.getItem(storage.key(index) as string)}`).join("\n");
      return [dump(sessionStorage), dump(localStorage), document.cookie, JSON.stringify(history.state), document.title, location.href].join("\n");
    });

  await page.goto("/platform/login");
  await fillLogin(page, admin.email, admin.temporaryPassword);
  await expectForced(page, "platform", "登录后");
  await expect(page.getByLabel("临时密码"), "临时密码不会被带进改密页自动填好").toHaveValue("");
  expect(await everythingStored()).not.toContain(admin.temporaryPassword);
  await page.reload();
  await expectForced(page, "platform", "刷新后");
  await expect(page.getByLabel("临时密码")).toHaveValue("");

  await savePassword(page, admin.temporaryPassword, password);
  await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();

  const stored = await everythingStored();
  for (const secret of [admin.temporaryPassword, password]) {
    expect(stored).not.toContain(secret);
    expect(await page.content()).not.toContain(secret);
    for (const url of [...visited, ...requests.map((req) => req.url)]) {
      expect(decodeURIComponent(url), "密码进了网址").not.toContain(secret);
    }
    for (const req of requests) expect(req.headers, `密码进了 ${req.method} ${req.url} 的请求头`).not.toContain(secret);
  }
  expect(await context.cookies()).toEqual([]);
  const carrying = requests.filter((req) => req.body.includes(admin.temporaryPassword)).map((req) => `${req.method} ${new URL(req.url).pathname}`);
  expect(carrying).toEqual(["POST /platform/v1/auth/login", "POST /platform/v1/auth/change-password"]);
  const origin = new URL(baseURL as string).origin;
  expect(requests.filter((req) => !req.url.startsWith(`${origin}/`) && !req.url.startsWith("data:")).map((req) => req.url), "没有发往别的站点的请求").toEqual([]);
});

test("改完密码之后的历史记录：后退、前进都回不到「临时密码」那个受限的页面；修改密码页恢复平常的样子", async ({ page }) => {
  const admin = await createTemporaryPasswordAdmin();
  const password = newPassword();
  await page.goto("/platform/login");
  await fillLogin(page, admin.email, admin.temporaryPassword);
  await expectForced(page, "platform", "登录后");
  await page.goto("/platform/no-such-page");
  await expectForced(page, "platform", "中途去了别的地址");
  await savePassword(page, admin.temporaryPassword, password);
  await expect(page).toHaveURL(/\/platform$/);
  await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();

  for (let step = 0; step < 4; step += 1) {
    await page.goBack().catch(() => null);
    if (!page.url().startsWith("http")) break;
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(WARNING), `后退第 ${step + 1} 步`).toHaveCount(0);
    await expect(page.getByLabel("临时密码"), `后退第 ${step + 1} 步`).toHaveCount(0);
  }
  await page.goto("/platform/account/password");
  await expect(page.getByLabel("当前密码")).toBeVisible();
  await expect(page.getByText(WARNING)).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "主菜单" }).first()).toBeVisible();
});

test("【缺陷】改完临时密码进首页后刷新：「新密码已生效，临时密码已作废。」是一次性的提示，刷新后不应再出现", async ({ page }) => {
  const admin = await createTemporaryPasswordAdmin();
  await page.goto("/platform/login");
  await fillLogin(page, admin.email, admin.temporaryPassword);
  await expectForced(page, "platform", "登录后");
  await savePassword(page, admin.temporaryPassword, newPassword());
  const notice = page.getByText("新密码已生效，临时密码已作废。");
  await expect(notice).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();
  await expect(detail(page, "邮箱")).toHaveText(admin.email);
  await expect(notice, "刷新之后还在显示上一次操作的成功提示").toHaveCount(0);
});

test("没有被标记的平台管理员不受任何影响：登录直接进首页，修改密码页是平常的样子", async ({ page }) => {
  const { email, password } = adminCredentials();
  await loginAs(page, "platform", email, password);
  await expect(page).toHaveURL(/\/platform$/);
  await expect(page.getByText(WARNING)).toHaveCount(0);
  await page.goto("/platform/account/password");
  await expect(page.getByLabel("当前密码")).toBeVisible();
  await expect(page.getByLabel("临时密码")).toHaveCount(0);
});
