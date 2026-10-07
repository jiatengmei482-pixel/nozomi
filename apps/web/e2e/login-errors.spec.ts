/** 登录页的出错提示（真实后端的应答）。 */
import { expect, test } from "@playwright/test";
import { adminCredentials, createActiveTenant, fillLogin, uniqueEmail } from "./support.ts";

test("字段校验：空着提交、邮箱格式不对，都不发请求", async ({ page }) => {
  let requests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/auth/login") && request.method() === "POST") requests += 1;
  });
  await page.goto("/login");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByText("请输入邮箱")).toBeVisible();
  await expect(page.getByText("请输入密码")).toBeVisible();
  await expect(page.getByLabel("邮箱")).toBeFocused();
  await expect(page.getByLabel("邮箱")).toHaveAttribute("aria-invalid", "true");

  await page.getByLabel("邮箱").fill("not-an-email");
  await expect(page.getByText("邮箱格式不正确")).toBeVisible();
  await page.getByLabel("邮箱").fill("someone@example.com");
  await expect(page.getByText("邮箱格式不正确")).toHaveCount(0);
  expect(requests).toBe(0);
});

test("密码错误与邮箱不存在：同一句提示，保留邮箱、清空密码、焦点回到密码框", async ({ page, request }) => {
  const tenant = await createActiveTenant(request);
  await page.goto("/login");

  await fillLogin(page, tenant.adminEmail, "Definitely-wrong-password-1");
  const alert = page.getByRole("alert").filter({ hasText: "邮箱或密码不正确。" });
  await expect(alert).toBeVisible();
  const wrongPassword = await page.locator(".alert-slot").innerHTML();
  await expect(page.getByLabel("邮箱")).toHaveValue(tenant.adminEmail);
  await expect(page.getByLabel("密码", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("密码", { exact: true })).toBeFocused();
  await expect(page.getByLabel("邮箱")).not.toHaveAttribute("aria-invalid", "true");

  await page.getByLabel("邮箱").fill(uniqueEmail("nobody"));
  await page.getByLabel("密码", { exact: true }).fill("Definitely-wrong-password-1");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(alert).toBeVisible();
  expect(await page.locator(".alert-slot").innerHTML(), "邮箱不存在时的提示与密码错误时逐字相同").toBe(wrongPassword);
});

test("尝试次数过多：显示后端 Retry-After 给出的等待时间", async ({ page }) => {
  const email = uniqueEmail("throttled");
  await page.goto("/platform/login");
  const throttled = page.getByRole("alert").filter({ hasText: /尝试次数过多，请 \d+ 分钟后再试。/ });
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const responded = page.waitForResponse((response) => response.url().endsWith("/platform/v1/auth/login"));
    await fillLogin(page, email, "Definitely-wrong-password-1");
    const response = await responded;
    if (response.status() === 429) {
      const seconds = Number(response.headers()["retry-after"]);
      expect(seconds).toBeGreaterThan(0);
      await expect(throttled).toHaveText(`尝试次数过多，请 ${Math.ceil(seconds / 60)} 分钟后再试。`);
      await expect(page.getByLabel("邮箱")).toHaveValue(email);
      await expect(page.getByLabel("密码", { exact: true })).toHaveValue("");
      return;
    }
    expect(response.status()).toBe(401);
    await expect(page.getByRole("alert").filter({ hasText: "邮箱或密码不正确。" })).toBeVisible();
  }
  throw new Error("连续 6 次失败后仍没有被限流");
});

test("网络不通：提示检查网络，保留已填内容；恢复后可以直接再登录", async ({ page, context }) => {
  const admin = adminCredentials();
  await page.goto("/platform/login");
  await page.getByLabel("邮箱").fill(admin.email);
  await page.getByLabel("密码", { exact: true }).fill(admin.password);
  await context.setOffline(true);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "网络连接失败，请检查网络后重试。" })).toBeVisible();
  await expect(page.getByLabel("密码", { exact: true })).toHaveValue(admin.password);
  await expect(page.getByRole("button", { name: "登录" })).toBeFocused();
  await context.setOffline(false);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();
});

test("链接里没有令牌：邀请页和重置页都直接显示链接已失效", async ({ page }) => {
  await page.goto("/accept-invite");
  await expect(page.getByRole("heading", { level: 1, name: "邀请链接已失效" })).toBeVisible();
  await page.goto("/platform/reset-password");
  await expect(page.getByRole("heading", { level: 1, name: "重置链接已失效" })).toBeVisible();
  await expect(page.getByRole("link", { name: "去登录" })).toHaveAttribute("href", "/platform/login");
});
