/** 运营后台：登录 → 首页 → 退出；平台员工的邀请与重置；两个后台的登录状态互不影响。 */
import { expect, test } from "@playwright/test";
import { adminCredentials, createActiveTenant, detail, fillLogin, loginAs, newPassword, platformAdminHeaders, uniqueEmail, expectSignedInAs } from "./support.ts";

test("平台登录 → 首页 → 退出", async ({ page }) => {
  const admin = adminCredentials();
  await page.goto("/platform");
  await expect(page, "没登录时去运营后台的登录页").toHaveURL(/\/platform\/login$/);
  await expect(page).toHaveTitle("登录 · NOZOMI 运营后台");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("运营后台");

  await fillLogin(page, admin.email, admin.password);
  await expect(page).toHaveURL(/\/platform$/);
  await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();
  await expect(page).toHaveTitle("首页 · NOZOMI 运营后台");
  await expectSignedInAs(page, { name: "端到端测试管理员", email: admin.email, role: "超级管理员" });
  await expect(page.getByText("供应商名称")).toHaveCount(0);
  await expect(page.locator(".sidebar--pinned")).toContainText("运营后台");
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual(["nozomi.session.platform"]);

  await page.goto("/platform/login");
  await expect(page, "已登录的人打开登录页直接进首页").toHaveURL(/\/platform$/);

  await page.getByRole("button", { name: /账号菜单/ }).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/platform\/login$/);
  await expect(page.getByRole("status").filter({ hasText: "已退出登录。" })).toBeVisible();
});

test("平台员工：接受邀请设置密码 → 登录；管理员发重置令牌 → 重设密码 → 用新密码登录", async ({ page, request }) => {
  const headers = await platformAdminHeaders(request);
  const email = uniqueEmail("staff");
  const created = await request.post("/platform/v1/staff", { headers, data: { email, name: "端到端测试运营", role: "operations" } });
  expect(created.status()).toBe(201);
  const { user, invite } = (await created.json()) as { user: { id: string }; invite: { token: string } };

  const firstPassword = newPassword();
  await page.goto(`/platform/accept-invite#token=${invite.token}`);
  await page.getByLabel("新密码").fill(firstPassword);
  await page.getByLabel("再输入一次").fill(firstPassword);
  await page.getByRole("button", { name: "设置密码并继续" }).click();
  await expect(page).toHaveURL(/\/platform\/login$/);
  await expect(page.getByLabel("邮箱")).toHaveValue(email);
  await page.getByLabel("密码", { exact: true }).fill(firstPassword);
  await page.getByRole("button", { name: "登录" }).click();
  await expectSignedInAs(page, { role: "运营" });

  const issued = await request.post(`/platform/v1/staff/${user.id}/password-reset`, { headers });
  expect(issued.status()).toBe(201);
  const { reset } = (await issued.json()) as { reset: { token: string } };

  const secondPassword = newPassword();
  await page.goto(`/platform/reset-password#token=${reset.token}`);
  await page.getByLabel("新密码").fill(secondPassword);
  await page.getByLabel("再输入一次").fill(secondPassword);
  await page.getByRole("button", { name: "设置新密码并继续" }).click();
  await expect(page).toHaveURL(/\/platform\/login$/);
  await expect(page.getByRole("status").filter({ hasText: "密码已重设，请用新密码登录。" })).toBeVisible();
  await page.getByLabel("密码", { exact: true }).fill(secondPassword);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();
  await expectSignedInAs(page, { name: "端到端测试运营" });
});

test("两个后台的登录状态分开存：同一个标签页里先后登录两边互不覆盖，退出一边不影响另一边", async ({ page, request }) => {
  const admin = adminCredentials();
  const tenant = await createActiveTenant(request);
  await loginAs(page, "platform", admin.email, admin.password);
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  expect((await page.evaluate(() => Object.keys(sessionStorage))).sort()).toEqual(["nozomi.session.platform", "nozomi.session.tenant"]);

  await page.goto("/platform");
  await expectSignedInAs(page, { role: "超级管理员" });

  await page.getByRole("button", { name: /账号菜单/ }).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/platform\/login$/);

  await page.goto("/");
  await expect(detail(page, "供应商名称")).toHaveText(tenant.tenantName);
});

test("租户账号不能登录运营后台，平台账号不能登录供应商后台：提示与密码错误完全相同", async ({ page, request }) => {
  const admin = adminCredentials();
  const tenant = await createActiveTenant(request);
  await page.goto("/platform/login");
  await fillLogin(page, tenant.adminEmail, tenant.password);
  await expect(page.getByRole("alert").filter({ hasText: "邮箱或密码不正确。" })).toBeVisible();
  await page.goto("/login");
  await fillLogin(page, admin.email, admin.password);
  await expect(page.getByRole("alert").filter({ hasText: "邮箱或密码不正确。" })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});
