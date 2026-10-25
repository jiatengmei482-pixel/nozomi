/**
 * 运营后台的账号安全（M4-05，ADR 0030）端到端：
 * - 新员工第一次登录必须绑定两步验证（扫码页面、输一次动态码、恢复码只显示一次），之后每次登录输入动态码，也可以用恢复码；
 * - 超级管理员新建自建角色（勾选菜单 × 操作），把员工改成这个角色：他的菜单立即按勾选变化；
 * - IP 白名单：员工的名单不含本机地址时，密码正确也登录不了，页面说明原因。
 * 全部数据经真实接口创建在本次运行的临时 schema 里。
 */
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { nextCode, platformApiLogin, rememberSecret } from "./mfa.ts";
import { fillLogin, loginAs, newPassword, platformAdminHeaders, uniqueEmail } from "./support.ts";

const menu = (page: Page) => page.getByRole("navigation", { name: "主菜单" }).first();

async function invitedStaff(request: APIRequestContext, role = "readonly"): Promise<{ id: string; email: string; password: string }> {
  const headers = await platformAdminHeaders(request);
  const email = uniqueEmail(`m405-${role}`);
  const created = await request.post("/platform/v1/staff", { headers, data: { email, name: `安全测试 ${role}`, role } });
  expect(created.status(), await created.text()).toBe(201);
  const body = (await created.json()) as { user: { id: string }; invite: { token: string } };
  const password = newPassword();
  expect((await request.post("/platform/v1/auth/accept-invite", { data: { token: body.invite.token, password } })).ok()).toBe(true);
  return { id: body.user.id, email, password };
}

test("新员工第一次登录必须绑定两步验证：扫码页、输一次动态码、恢复码只显示一次；之后每次要动态码，也能用恢复码登录", async ({ page, request }) => {
  test.setTimeout(120_000);
  const staff = await invitedStaff(request);
  await page.goto("/platform/login");
  await fillLogin(page, staff.email, staff.password, { secondFactor: "manual" });
  await expect(page.getByRole("heading", { level: 1, name: "绑定两步验证" })).toBeVisible();
  await expect(page.getByRole("img", { name: "绑定两步验证的二维码" })).toBeVisible();
  await expect(menu(page)).toHaveCount(0);
  // 换个地址也还是这一页
  await page.goto("/platform/tenants");
  await expect(page.getByRole("heading", { level: 1, name: "绑定两步验证" })).toBeVisible();
  const secret = ((await page.locator(".mfa-secret__value").textContent()) ?? "").replace(/\s/g, "");
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  rememberSecret(staff.email, secret);
  await page.getByLabel("动态码").fill("000000");
  await page.getByRole("button", { name: "完成绑定" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "动态码或恢复码不对" })).toBeVisible();
  await page.getByLabel("动态码").fill((await nextCode(secret)).code);
  await page.getByRole("button", { name: "完成绑定" }).click();
  const codes = page.getByRole("list", { name: "恢复码" }).getByRole("listitem");
  await expect(codes).toHaveCount(10);
  const recovery = ((await codes.first().textContent()) ?? "").trim();
  await expect(page.getByRole("button", { name: "继续" })).toBeDisabled();
  await page.getByLabel("我已经把恢复码存好了").check();
  await page.getByRole("button", { name: "继续" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "供应商" })).toBeVisible();

  // 退出后再登录：输入动态码
  await page.getByRole("button", { name: /账号菜单/ }).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await fillLogin(page, staff.email, staff.password, { secondFactor: "manual" });
  await expect(page.getByRole("heading", { level: 1, name: "两步验证" })).toBeVisible();
  await page.getByRole("button", { name: "手机不在身边？用恢复码" }).click();
  await page.getByLabel("恢复码").fill(recovery);
  await page.getByRole("button", { name: "验证" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();

  // 个人页能看到剩下 9 个恢复码
  await page.getByRole("button", { name: /账号菜单/ }).click();
  await page.getByRole("menuitem", { name: "账号安全" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "账号安全" })).toBeVisible();
  await expect(page.getByText("9 个")).toBeVisible();
});

test("自建角色：超级管理员勾选「渠道 · 查看」新建角色，把员工改成它；员工的菜单立即只剩首页和渠道", async ({ page, browser, request }) => {
  test.setTimeout(120_000);
  const staff = await invitedStaff(request, "readonly");
  const admin = { email: process.env["E2E_ADMIN_EMAIL"] ?? "", password: process.env["E2E_ADMIN_PASSWORD"] ?? "" };
  await loginAs(page, "platform", admin.email, admin.password);
  await page.goto("/platform/settings/roles");
  await expect(page.getByRole("heading", { level: 1, name: "角色" })).toBeVisible();
  await expect(page.getByRole("region", { name: "角色列表" })).toContainText("超级管理员");
  await page.getByRole("link", { name: "新建角色" }).click();
  const roleName = `渠道观察 ${crypto.randomUUID().slice(0, 6)}`;
  await page.getByLabel("名字").fill(roleName);
  await page.getByLabel("渠道 · 查看").check();
  await page.getByRole("button", { name: "新建" }).click();
  await expect(page.getByRole("heading", { level: 1, name: roleName })).toBeVisible();

  // 员工这边先登录着（只读角色能看供应商）
  const staffContext = await browser.newContext();
  const staffPage = await staffContext.newPage();
  await loginAs(staffPage, "platform", staff.email, staff.password);
  await expect(menu(staffPage).getByRole("link", { name: "供应商" })).toBeVisible();

  await page.goto(`/platform/settings/staff/${staff.id}`);
  await page.getByRole("button", { name: "修改" }).click();
  await page.getByLabel("角色").selectOption({ label: `${roleName}（自建）` });
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText(roleName).first()).toBeVisible();

  await staffPage.reload();
  await expect(menu(staffPage).getByRole("link", { name: "渠道" })).toBeVisible();
  await expect(menu(staffPage).getByRole("link", { name: "供应商" })).toHaveCount(0);
  await staffContext.close();
});

test("IP 白名单：员工的名单不含本机地址时，密码正确也登录不了，页面说明原因", async ({ page, request }) => {
  const staff = await invitedStaff(request);
  const headers = await platformAdminHeaders(request);
  const patched = await request.patch(`/platform/v1/staff/${staff.id}`, { headers, data: { ip_allowlist: ["203.0.113.0/24"] } });
  expect(patched.ok(), await patched.text()).toBe(true);
  await page.goto("/platform/login");
  await fillLogin(page, staff.email, staff.password);
  await expect(page.getByRole("alert").filter({ hasText: "你现在所在的网络不在这个账号允许的范围内" })).toBeVisible();
  // 清空名单后照常
  expect((await request.patch(`/platform/v1/staff/${staff.id}`, { headers, data: { ip_allowlist: [] } })).ok()).toBe(true);
  expect(await platformApiLogin(request, staff.email, staff.password)).toMatch(/\./);
});
