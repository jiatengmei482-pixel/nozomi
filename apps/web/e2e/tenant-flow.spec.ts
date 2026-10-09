/** 供应商后台的完整流程：接受邀请 → 登录 → 首页 → 修改密码 → 退出；以及暂停、过期、重置密码。 */
import { expect, test } from "@playwright/test";
import { createActiveTenant, createTenant, detail, expectSignedInAs, fillLogin, issueTenantAdminReset, loginAs, newPassword, suspendTenant } from "./support.ts";

test("接受邀请 → 登录 → 首页 → 修改密码 → 退出 → 用新密码登录", async ({ page, request }) => {
  // 这一条要做 6 次密码哈希，两核的机器忙的时候正好卡在默认的 30 秒上（实测 30.0 秒）。
  test.setTimeout(90_000);
  const tenant = await createTenant(request);
  const firstPassword = newPassword();
  const secondPassword = newPassword();

  await page.goto(`/accept-invite#token=${tenant.inviteToken}`);
  await expect(page).toHaveTitle("设置密码 · NOZOMI");
  await page.getByLabel("新密码").fill(firstPassword);
  await page.getByLabel("再输入一次").fill(firstPassword);
  await page.getByRole("button", { name: "设置密码并继续" }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("status").filter({ hasText: "密码已设置，请登录。" })).toBeVisible();
  await expect(page.getByLabel("邮箱")).toHaveValue(tenant.adminEmail);
  await expect(page.getByLabel("密码", { exact: true })).toBeFocused();

  await page.getByLabel("密码", { exact: true }).fill(firstPassword);
  await page.getByRole("button", { name: "登录" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(page).toHaveTitle("首页 · NOZOMI 供应商后台");
  await expect(detail(page, "姓名")).toHaveText(tenant.adminName);
  await expectSignedInAs(page, { email: tenant.adminEmail });
  await expect(detail(page, "角色")).toHaveText("管理员");
  await expect(detail(page, "供应商名称")).toHaveText(tenant.tenantName);
  await expect(detail(page, "供应商状态")).toHaveText("正常");
  await expect(page.getByRole("navigation", { name: "主菜单" }).getByRole("link")).toHaveText(["首页", "区域"]);

  const stored = await page.evaluate(() => ({
    session: Object.keys(sessionStorage),
    local: Object.keys(localStorage),
    cookies: document.cookie,
  }));
  expect(stored.session).toEqual(["nozomi.session.tenant"]);
  expect(stored.local, "令牌不进 localStorage").toEqual([]);
  expect(stored.cookies).toBe("");

  await page.reload();
  await expect(detail(page, "供应商名称"), "刷新后仍是登录状态").toHaveText(tenant.tenantName);

  await page.getByRole("button", { name: /账号菜单/ }).click();
  await page.getByRole("menuitem", { name: "修改密码" }).click();
  await expect(page).toHaveURL(/\/account\/password$/);
  await expect(page.getByRole("heading", { level: 1, name: "修改密码" })).toBeVisible();

  await page.getByLabel("当前密码").fill("Wrong-current-password-1");
  await page.getByLabel("新密码", { exact: true }).fill(secondPassword);
  await page.getByLabel("再输入一次新密码").fill(secondPassword);
  await page.getByRole("button", { name: "保存新密码" }).click();
  await expect(page.getByText("当前密码不正确，请重新输入")).toBeVisible();
  await expect(page.getByLabel("新密码", { exact: true }), "被拒后保留已填内容").toHaveValue(secondPassword);

  await page.getByLabel("当前密码").fill(firstPassword);
  await page.getByRole("button", { name: "保存新密码" }).click();
  await expect(page.getByRole("status").filter({ hasText: "密码已修改。" })).toBeVisible();
  await expect(page.getByLabel("当前密码")).toHaveValue("");

  await page.getByRole("button", { name: /账号菜单/ }).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("status").filter({ hasText: "已退出登录。" })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);

  await page.goto("/");
  await expect(page, "退出后打开后台页面会回到登录页").toHaveURL(/\/login$/);

  await fillLogin(page, tenant.adminEmail, firstPassword);
  await expect(page.getByRole("alert").filter({ hasText: "邮箱或密码不正确。" }), "旧密码已经不能用").toBeVisible();
  await fillLogin(page, tenant.adminEmail, secondPassword);
  await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();
});

test("邀请链接只能用一次：再打开同一个链接提交，显示「邀请链接已失效」", async ({ page, request }) => {
  const tenant = await createActiveTenant(request);
  const password = newPassword();
  await page.goto(`/accept-invite#token=${tenant.inviteToken}`);
  await page.getByLabel("新密码").fill(password);
  await page.getByLabel("再输入一次").fill(password);
  await page.getByRole("button", { name: "设置密码并继续" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "邀请链接已失效" })).toBeVisible();
  await expect(page.getByLabel("新密码")).toHaveCount(0);
  await page.getByRole("link", { name: "去登录" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("设置密码时后端把关：密码包含邮箱名会被拒绝，并把原因显示在输入框下", async ({ page, request }) => {
  const tenant = await createTenant(request);
  const emailName = tenant.adminEmail.split("@")[0] ?? "";
  const password = `${emailName}-Aa1!`;
  await page.goto(`/accept-invite#token=${tenant.inviteToken}`);
  await page.getByLabel("新密码").fill(password);
  await page.getByLabel("再输入一次").fill(password);
  await page.getByRole("button", { name: "设置密码并继续" }).click();
  await expect(page.getByText("密码不能包含邮箱名", { exact: true })).toBeVisible();
  await expect(page.getByLabel("新密码")).toHaveAttribute("aria-invalid", "true");
});

test("供应商被暂停后仍能登录，首页的状态徽标显示「已暂停」", async ({ page, request }) => {
  const tenant = await createActiveTenant(request);
  await suspendTenant(request, tenant.tenantId);
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  const badge = detail(page, "供应商状态").locator(".badge");
  await expect(badge).toHaveText("已暂停");
  await expect(badge).toHaveClass(/badge--warning/);
});

test("会话在别处被作废后：刷新页面回到登录页并提示「登录已过期」，重新登录后回到原来的页面", async ({ page, request }) => {
  const tenant = await createActiveTenant(request);
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  await page.getByRole("button", { name: /账号菜单/ }).click();
  await page.getByRole("menuitem", { name: "修改密码" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "修改密码" })).toBeVisible();

  const token = await page.evaluate(() => (JSON.parse(sessionStorage.getItem("nozomi.session.tenant") ?? "{}") as { accessToken?: string }).accessToken);
  const revoked = await request.post("/tenant/v1/auth/logout", { headers: { authorization: `Bearer ${token}` } });
  expect(revoked.status()).toBe(204);

  await page.reload();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("status").filter({ hasText: "登录已过期，请重新登录。" })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);

  await fillLogin(page, tenant.adminEmail, tenant.password);
  await expect(page).toHaveURL(/\/account\/password$/);
  await expect(page.getByRole("heading", { level: 1, name: "修改密码" })).toBeVisible();
});

test("凭重置令牌设置新密码：旧密码作废，用新密码登录；令牌用过即失效", async ({ page, request }) => {
  const tenant = await createActiveTenant(request);
  const resetToken = await issueTenantAdminReset(request, tenant.tenantId, tenant.adminEmail);
  const password = newPassword();

  await page.goto(`/reset-password#token=${resetToken}`);
  await expect(page.getByRole("heading", { level: 1, name: "重设密码" })).toBeVisible();
  await page.getByLabel("新密码").fill(password);
  await page.getByLabel("再输入一次").fill(password);
  await page.getByRole("button", { name: "设置新密码并继续" }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("status").filter({ hasText: "密码已重设，请用新密码登录。" })).toBeVisible();
  await expect(page.getByLabel("邮箱")).toHaveValue(tenant.adminEmail);
  await page.getByLabel("密码", { exact: true }).fill(tenant.password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "邮箱或密码不正确。" })).toBeVisible();
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();

  await page.evaluate(() => sessionStorage.clear());
  await page.goto(`/reset-password#token=${resetToken}`);
  await page.getByLabel("新密码").fill(newPassword());
  const again = await page.getByLabel("新密码").inputValue();
  await page.getByLabel("再输入一次").fill(again);
  await page.getByRole("button", { name: "设置新密码并继续" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "重置链接已失效" })).toBeVisible();
});
