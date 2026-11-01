/**
 * QA（M4-08，ADR 0049）：开发的 notifications.spec.ts 只在空表格时量过窄屏。这里塞满最长的内容（长邮箱、长错误文本、长订单号、全部模板）再量 320 宽。
 * 真实前端和真实登录，列表接口的内容用 page.route 换成虚构的长数据；不连邮件服务。
 */
import { expect, test } from "@playwright/test";
import { adminCredentials, createActiveTenant, expectNoHorizontalOverflow, loginAs } from "./support.ts";

const LONG_ERROR = "邮件服务器在时限内没有完成：请检查主机名和端口，以及加密方式和端口是否相配（通常 465 配 TLS、587 配 STARTTLS）";
const ID = (n: number): string => `${String(n).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;

function row(n: number, changes: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ID(n),
    event: "tenant.observation_started",
    audience: "staff",
    locale: "zh-CN",
    channel: "email",
    recipient: `lo***@${"very-long-subdomain-of-a-supplier.".repeat(3)}example.com`,
    order: { id: ID(n + 100), order_no: "NZ20261007ABCDEFGH" },
    status: "failed",
    attempts: 6,
    last_error: { code: "TIMEOUT", message: LONG_ERROR },
    retryable: true,
    next_attempt_at: null,
    expires_at: "2026-12-20T01:00:00.000Z",
    sent_at: null,
    created_at: "2026-11-01T00:12:00.000Z",
    updated_at: "2026-11-01T05:30:00.000Z",
    ...changes,
  };
}

test("运营后台 320 宽：长邮箱、长错误文本、筛选都塞满也不横向滚动，重试按钮够得着；连点只发一次", async ({ page }) => {
  const { email, password } = adminCredentials();
  await page.route(/\/platform\/v1\/notifications(\?.*)?$/, (route) => route.fulfill({ json: { items: [row(1), row(2, { status: "pending", retryable: false, attempts: 0, next_attempt_at: "2026-11-02T00:00:00.000Z" }), row(3, { order: null })], next_cursor: null, total: 500, summary: { mail_configured: false, waiting: 3 } } }));
  let retries = 0;
  await page.route(/\/platform\/v1\/notifications\/[^/]+\/retry$/, async (route) => {
    retries += 1;
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.fulfill({ json: { notification: row(1, { status: "sent", sent_at: "2026-11-01T06:00:00.000Z", last_error: null, retryable: false }) } });
  });
  await loginAs(page, "platform", email, password);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/platform/notifications");
  await expect(page.getByText(LONG_ERROR).first()).toBeVisible();
  await expectNoHorizontalOverflow(page, "运营后台通知记录 320（长内容）");
  const button = page.getByRole("button", { name: "重试" }).first();
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeVisible();
  await button.dblclick();
  await expect(page.getByText(/已发送：邮件服务器已接收/)).toBeVisible();
  expect(retries).toBe(1);
  await expectNoHorizontalOverflow(page, "重试之后");
});

test("通知模板 320 宽：全部模板的长正文也不横向滚动", async ({ page }) => {
  const { email, password } = adminCredentials();
  await loginAs(page, "platform", email, password);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/platform/notification-templates");
  await expect(page.getByRole("region", { name: "通知模板" }).getByText("预订已确认：{{order_no}}")).toBeVisible();
  await expectNoHorizontalOverflow(page, "通知模板 320");
});

test("供应商后台 320 宽：免打扰表单和塞满的发送记录都不横向滚动；时间输入框不被挤出屏幕", async ({ page, request }) => {
  const tenant = await createActiveTenant(request);
  await page.route(/\/tenant\/v1\/notifications(\?.*)?$/, (route) => route.fulfill({ json: { items: [row(1, { audience: "tenant", retryable: false }), row(2, { audience: "tenant", status: "pending", retryable: false, next_attempt_at: "2026-11-02T00:00:00.000Z" })], next_cursor: null, total: 2 } }));
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/settings/notifications");
  await expect(page.getByText(LONG_ERROR).first()).toBeVisible();
  await expectNoHorizontalOverflow(page, "供应商通知页 320（长内容）");
  for (const label of ["开始", "结束"]) {
    const box = await page.getByLabel(label).boundingBox();
    expect(box, label).not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0), label).toBeLessThanOrEqual(320);
  }
});

test("免打扰跨午夜：真实后端保存 22:00–07:00 被接受，刷新还在；重复点保存只存一次（版本号不跳两次）", async ({ page, request }) => {
  const tenant = await createActiveTenant(request);
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  const puts: number[] = [];
  page.on("response", (response) => {
    if (response.request().method() === "PUT" && response.url().includes("/tenant/v1/notification-settings")) puts.push(response.status());
  });
  await page.goto("/settings/notifications");
  await page.getByLabel("开始").fill("22:00");
  await page.getByLabel("结束").fill("07:00");
  await page.getByRole("button", { name: "保存" }).dblclick();
  await expect(page.getByText("已保存").first()).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("开始")).toHaveValue("22:00");
  await expect(page.getByLabel("结束")).toHaveValue("07:00");
  expect(puts.filter((status) => status === 200).length).toBe(1);
});
