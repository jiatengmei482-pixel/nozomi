/**
 * QA（M4-06，ADR 0050）：登录页邮箱验证码在真实浏览器里的表现，开发的 email-login.spec.ts 没有覆盖的部分：
 * 320 宽下规则允许的最长邮箱、真实的粘贴。接口用页面拦截返回，不写库、不发信；邮箱是虚构的。
 */
import { type Page, expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./support.ts";

const LONG_EMAIL = `${"x".repeat(241)}@example.test`;

async function stub(page: Page, verifyBodies: unknown[] = []): Promise<void> {
  await page.route("**/tenant/v1/auth/login-methods", (route) => route.fulfill({ json: { email_code: true, password: true } }));
  await page.route("**/tenant/v1/auth/email-code/request", (route) => route.fulfill({ status: 202, json: { expires_in_seconds: 600, resend_after_seconds: 60 } }));
  await page.route("**/tenant/v1/auth/email-code/verify", (route) => {
    verifyBodies.push(route.request().postDataJSON());
    return route.fulfill({ status: 401, json: { error: { code: "EMAIL_CODE_INVALID", message: "验证码不正确或已失效" } } });
  });
}

async function toCodeStep(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: "改用邮箱验证码" }).click();
  await page.getByLabel("邮箱").fill(email);
  await page.getByRole("button", { name: "发送验证码" }).click();
  await expect(page.getByLabel("验证码")).toBeFocused();
}

test("320 宽：密码表单、填邮箱、输验证码（最长的邮箱、倒计时按钮、错误提示）都不横向溢出，按钮都在屏幕里", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await stub(page);
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "改用邮箱验证码" })).toBeVisible();
  await expectNoHorizontalOverflow(page, "320 宽的密码表单");
  await page.getByRole("button", { name: "改用邮箱验证码" }).click();
  await page.getByLabel("邮箱").fill(LONG_EMAIL);
  await expectNoHorizontalOverflow(page, "320 宽的填邮箱这一步");
  await page.getByRole("button", { name: "发送验证码" }).click();
  await expect(page.getByLabel("验证码")).toBeFocused();
  await expect(page.getByText(LONG_EMAIL)).toBeVisible();
  await expectNoHorizontalOverflow(page, "320 宽、最长邮箱的输验证码这一步");
  for (const name of [/^重新发送（\d+ 秒）$/, "换一个邮箱", "改用密码", "登录"]) {
    const box = await page.getByRole("button", { name }).boundingBox();
    expect(box, String(name)).not.toBeNull();
    expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= 320, `${String(name)} 在屏幕里`).toBe(true);
  }
  await page.getByLabel("验证码").fill("000000");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("alert")).toContainText("验证码不正确或已失效");
  await expectNoHorizontalOverflow(page, "320 宽的错误提示");
});

test("真实粘贴：恰好 6 位的码粘进去就能提交，自动填充的属性在真实元素上", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const bodies: unknown[] = [];
  await stub(page, bodies);
  await toCodeStep(page, "qa-paste@example.test");
  const input = page.getByLabel("验证码");
  await expect(input).toHaveAttribute("autocomplete", "one-time-code");
  await expect(input).toHaveAttribute("inputmode", "numeric");
  await page.evaluate(() => navigator.clipboard.writeText("042917"));
  await page.keyboard.press("ControlOrMeta+v");
  await expect(input).toHaveValue("042917");
  await page.keyboard.press("Enter");
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0]).toEqual({ email: "qa-paste@example.test", code: "042917" });
});

test("缺陷：真实粘贴带前导空格的码（从邮件正文复制时常见）被 maxlength 截掉最后一位，用户看到「验证码是 6 位数字」", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const bodies: unknown[] = [];
  await stub(page, bodies);
  await toCodeStep(page, "qa-paste-space@example.test");
  await page.evaluate(() => navigator.clipboard.writeText(" 042917"));
  await page.keyboard.press("ControlOrMeta+v");
  await page.keyboard.press("Enter");
  await expect.poll(() => bodies.length, { timeout: 3_000 }).toBe(1);
  expect(bodies[0]).toEqual({ email: "qa-paste-space@example.test", code: "042917" });
});
