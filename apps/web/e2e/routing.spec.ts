/**
 * 路由：前端页面与 API 前缀互不冲突；直接打开深层地址、未登录打开受保护页、未知地址；
 * 刷新、新标签页、前进后退时登录状态的表现。
 */
import { expect, test } from "@playwright/test";
import { adminCredentials, createActiveTenant, detail, fillLogin, loginAs, expectSignedInAs } from "./support.ts";

test("API 前缀下不存在的地址由后端回 JSON 的 404，不会被当成前端页面；相似的前端地址仍是页面", async ({ request }) => {
  for (const path of ["/platform/v1/no-such-endpoint", "/platform/v1", "/platform/v1/", "/tenant/v1/no-such-endpoint", "/tenant/v1/auth", "/sales/v1/anything", "/webhooks/anything"]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(404);
    expect(response.headers()["content-type"], path).toContain("application/json");
    expect(((await response.json()) as { error: { code: string } }).error.code, path).toBe("NOT_FOUND");
  }
  const posted = await request.post("/platform/v1/no-such-endpoint", { data: {} });
  expect(posted.status()).toBe(404);
  expect(posted.headers()["content-type"]).toContain("application/json");

  const health = await request.get("/health");
  expect(health.status()).toBe(200);
  expect(health.headers()["content-type"]).toContain("application/json");

  const unauthenticated = await request.get("/platform/v1/auth/me");
  expect(unauthenticated.status()).toBe(401);
  expect(unauthenticated.headers()["content-type"]).toContain("application/json");

  for (const path of ["/platform", "/platform/", "/platform/login", "/platform/account/password", "/platform/v10", "/platform/v1x", "/healthz", "/tenant", "/login"]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()["content-type"], path).toContain("text/html");
    expect(await response.text(), path).toContain('<div id="root"></div>');
  }
});

test("【缺陷】API 前缀本身带查询参数（/health?probe=1、/platform/v1?x=1）也应转给后端，不能回前端页面", async ({ request }) => {
  const probe = await request.get("/health?probe=1");
  expect.soft(probe.headers()["content-type"], "/health?probe=1 回的是前端的 index.html").toContain("application/json");
  const prefixOnly = await request.get("/platform/v1?x=1");
  expect.soft(prefixOnly.headers()["content-type"], "/platform/v1?x=1 回的是前端的 index.html").toContain("application/json");
  expect.soft(prefixOnly.status()).toBe(404);
});

test("未登录直接打开深层地址：先去本后台的登录页，登录后回到原地址（含查询参数）", async ({ page, request }) => {
  const admin = adminCredentials();
  const tenant = await createActiveTenant(request);

  await page.goto("/platform/account/password");
  await expect(page).toHaveURL(/\/platform\/login$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("运营后台");
  await expect(page.getByRole("status"), "没登录过的人不提示「登录已过期」").toHaveText("");
  await fillLogin(page, admin.email, admin.password);
  await expect(page).toHaveURL(/\/platform\/account\/password$/);
  await expect(page.getByRole("heading", { level: 1, name: "修改密码" })).toBeVisible();
  await expect(page.locator(".sidebar--pinned")).toContainText("运营后台");

  await page.goto("/account/password?from=email&step=2");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("供应商后台");
  await fillLogin(page, tenant.adminEmail, tenant.password);
  await expect(page).toHaveURL(/\/account\/password\?from=email&step=2$/);
  await expect(page.getByRole("heading", { level: 1, name: "修改密码" })).toBeVisible();
});

test("未知地址：未登录时先登录；登录后在各自后台的框架里显示「找不到这个页面」，回首页回的是本后台", async ({ page, request }) => {
  const admin = adminCredentials();
  const tenant = await createActiveTenant(request);

  await page.goto("/no/such/deep/page?x=1");
  await expect(page).toHaveURL(/\/login$/);
  await fillLogin(page, tenant.adminEmail, tenant.password);
  await expect(page.getByRole("heading", { level: 1, name: "找不到这个页面" })).toBeVisible();
  await expect(page).toHaveURL(/\/no\/such\/deep\/page\?x=1$/);
  await expect(page).toHaveTitle("找不到这个页面 · NOZOMI 供应商后台");
  await page.getByRole("link", { name: "回到首页" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(detail(page, "供应商名称")).toHaveText(tenant.tenantName);

  for (const path of ["/platformx", "/healthz"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: "找不到这个页面" }), `${path} 属于供应商后台的未知地址`).toBeVisible();
    await expect(page.locator(".sidebar--pinned")).toContainText("供应商后台");
  }

  await page.goto("/platform/no-such-page");
  await expect(page, "运营后台没登录：去运营后台的登录页，不借用供应商后台的登录").toHaveURL(/\/platform\/login$/);
  await fillLogin(page, admin.email, admin.password);
  await expect(page.getByRole("heading", { level: 1, name: "找不到这个页面" })).toBeVisible();
  await expect(page).toHaveTitle("找不到这个页面 · NOZOMI 运营后台");
  await expect(page.locator(".sidebar--pinned")).toContainText("运营后台");
  await page.getByRole("link", { name: "回到首页" }).click();
  await expect(page).toHaveURL(/\/platform$/);
  await expectSignedInAs(page, { role: "超级管理员" });
});

test("地址末尾多一个斜杠（/login/、/platform/login/、/platform/）也能打开对应页面", async ({ page }) => {
  await page.goto("/login/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("供应商后台");
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
  await page.goto("/platform/login/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("运营后台");
  await page.goto("/platform/");
  await expect(page).toHaveURL(/\/platform\/login$/);
});

test("刷新保持登录；同一个浏览器新开的标签页要重新登录（令牌只在本标签页）；前进后退在已登录的页面之间正常", async ({ page, request, context }) => {
  const tenant = await createActiveTenant(request);
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  await page.getByRole("button", { name: /账号菜单/ }).click();
  await page.getByRole("menuitem", { name: "修改密码" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "修改密码" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "修改密码" })).toBeVisible();
  await expect(page.getByRole("button", { name: /账号菜单：\s*端到端测试租户管理员/ })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();
  await expect(detail(page, "供应商名称")).toHaveText(tenant.tenantName);
  await page.goForward();
  await expect(page.getByRole("heading", { level: 1, name: "修改密码" })).toBeVisible();

  const another = await context.newPage();
  await another.goto("/account/password");
  await expect(another).toHaveURL(/\/login$/);
  await expect(another.getByRole("button", { name: "登录" })).toBeVisible();
  expect(await another.evaluate(() => sessionStorage.length)).toBe(0);
  await another.close();

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "修改密码" }), "另一个标签页不影响这一个").toBeVisible();
});
