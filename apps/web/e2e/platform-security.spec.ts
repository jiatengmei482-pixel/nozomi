/**
 * 运营后台的账号安全（M4-05，ADR 0030）端到端：
 * - 新员工第一次登录必须绑定两步验证（扫码页面、输一次动态码、恢复码只显示一次），之后每次登录输入动态码，也可以用恢复码；
 * - 超级管理员新建自建角色（勾选菜单 × 操作），把员工改成这个角色：他的菜单立即按勾选变化；
 * - IP 白名单：员工的名单不含本机地址时，密码正确也登录不了，页面说明原因；
 * - 数据范围（M4-10）：限定了范围的人菜单和首页没有财务结算，直接打开地址说明原因；限定了渠道范围的人没有「新建渠道」。
 * 全部数据经真实接口创建在本次运行的临时 schema 里。
 */
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { nextCode, platformApiLogin, rememberSecret } from "./mfa.ts";
import { adminCredentials, fillLogin, loginAs, newPassword, platformAdminHeaders, uniqueEmail } from "./support.ts";

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
  await page.getByRole("button", { name: "验证", exact: true }).click();
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
  const admin = adminCredentials();
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

test("数据范围 × 财务结算：自建角色勾了「财务结算 · 查看」又限定了城市，菜单和首页都没有账单、付款批次；直接打开地址说明原因（M4-10）", async ({ page, request }) => {
  test.setTimeout(120_000);
  const staff = await invitedStaff(request, "readonly");
  const headers = await platformAdminHeaders(request);
  const created = await request.post("/platform/v1/roles", { headers, data: { name: `限城市财务 ${crypto.randomUUID().slice(0, 6)}`, grants: ["orders:view", "finance:view"], data_scope: { city_ids: [], channel_ids: null } } });
  expect(created.status(), await created.text()).toBe(201);
  const role = (await created.json()) as { key: string };
  const patched = await request.patch(`/platform/v1/staff/${staff.id}`, { headers, data: { role: role.key } });
  expect(patched.ok(), await patched.text()).toBe(true);

  await loginAs(page, "platform", staff.email, staff.password);
  await expect(menu(page).getByRole("link", { name: "订单" })).toBeVisible();
  await expect(menu(page).getByRole("button", { name: "财务结算" })).toHaveCount(0);
  await expect(menu(page).getByRole("link", { name: "账单" })).toHaveCount(0);
  await expect(menu(page).getByRole("link", { name: "付款批次" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 2, name: "财务结算" })).toHaveCount(0);
  // 菜单里的每一项点进去都看得了
  for (const [name, title] of [["订单", "订单"], ["异常队列", "异常队列"], ["救援", "救援"], ["推送记录", "推送给供应商的 Webhook"]] as const) {
    await menu(page).getByRole("link", { name }).click();
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByText("你没有权限查看这里")).toHaveCount(0);
  }
  for (const path of ["/platform/finance/statements", "/platform/finance/payout-batches"]) {
    await page.goto(path);
    await expect(page.getByText("你没有权限查看这里")).toBeVisible();
    await expect(page.getByText(/财务结算只给不限数据范围的账号用/)).toBeVisible();
  }
});

test("数据范围 × 新建渠道：限定了渠道范围的渠道专员看不到「新建渠道」，页面说明原因；直接打开新建页也一样（M4-10）", async ({ page, request }) => {
  test.setTimeout(120_000);
  const staff = await invitedStaff(request, "readonly");
  const headers = await platformAdminHeaders(request);
  const created = await request.post("/platform/v1/roles", { headers, data: { name: `限渠道专员 ${crypto.randomUUID().slice(0, 6)}`, grants: ["channels:view", "channels:edit"], data_scope: { city_ids: null, channel_ids: [] } } });
  expect(created.status(), await created.text()).toBe(201);
  const role = (await created.json()) as { key: string };
  expect((await request.patch(`/platform/v1/staff/${staff.id}`, { headers, data: { role: role.key } })).ok()).toBe(true);

  await loginAs(page, "platform", staff.email, staff.password);
  await menu(page).getByRole("link", { name: "渠道" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "渠道" })).toBeVisible();
  await expect(page.getByText(/你的角色限定了渠道范围，不能新建渠道/)).toBeVisible();
  await expect(page.getByRole("link", { name: "新建渠道" })).toHaveCount(0);
  await page.goto("/platform/channels/new");
  await expect(page.getByRole("heading", { level: 2, name: "不能新建渠道" })).toBeVisible();
  await expect(page.getByRole("button", { name: "新建" })).toHaveCount(0);
});
