/**
 * 通知中心（M4-08，ADR 0049）的页面，真实后端 + 真实 PostgreSQL + 构建好的前端。发信本身由 apps/api/src/notifications.itest.ts 用假 SMTP 覆盖。
 * 运营后台：菜单 → 通知记录 → 通知模板；供应商后台：设免打扰（刷新后还在）→ 清掉。亮暗 axe；320 / 768 宽不横向滚动。
 */
import { expect, test } from "@playwright/test";
import { expectAccessible } from "./catalog.ts";
import { adminCredentials, createActiveTenant, expectNoHorizontalOverflow, loginAs } from "./support.ts";

test("运营后台看通知记录和模板：说明「已发送」的含义；模板只读；窄屏不横向滚动", async ({ page }) => {
  const { email, password } = adminCredentials();
  await loginAs(page, "platform", email, password);
  await page.goto("/platform/notifications");
  await expect(page.getByRole("heading", { level: 1, name: "通知记录" })).toBeVisible();
  await expect(page.getByText(/邮件服务器已接收，不等于已进收件箱/)).toBeVisible();
  await expect(page.getByRole("region", { name: "通知记录" })).toBeVisible();
  await expectAccessible(page, "通知记录（亮）");
  await expectNoHorizontalOverflow(page, "通知记录");

  await page.getByRole("link", { name: "看通知模板" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "通知模板" })).toBeVisible();
  const templates = page.getByRole("region", { name: "通知模板" });
  await expect(templates.getByText("预订已确认：{{order_no}}")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存" })).toHaveCount(0);
  await expectAccessible(page, "通知模板");

  for (const [name, size] of [["320", { width: 320, height: 800 }], ["768", { width: 768, height: 1000 }]] as const) {
    await page.setViewportSize(size);
    await page.goto("/platform/notifications");
    await expect(page.getByRole("heading", { level: 1, name: "通知记录" })).toBeVisible();
    await expectNoHorizontalOverflow(page, `通知记录 ${name}`);
  }
});

test("供应商管理员设免打扰：校验、保存后刷新还在、能清掉；看得到发送记录", async ({ page, request }) => {
  const tenant = await createActiveTenant(request);
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  await page.goto("/settings/notifications");
  await expect(page.getByRole("heading", { level: 1, name: "通知" })).toBeVisible();
  await expect(page.getByText("还没有发给你们的通知")).toBeVisible();
  await expectAccessible(page, "供应商的通知页");

  await page.getByLabel("开始").fill("22:00");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText(/开始和结束要一起填/)).toBeVisible();
  await page.getByLabel("结束").fill("07:00");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("已保存").first()).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("开始")).toHaveValue("22:00");
  await expect(page.getByLabel("结束")).toHaveValue("07:00");

  await page.getByLabel("开始").fill("");
  await page.getByLabel("结束").fill("");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("已保存").first()).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("开始")).toHaveValue("");
  await expectNoHorizontalOverflow(page, "供应商的通知页");
});
