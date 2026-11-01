/**
 * QA（M4-14，ADR 0048）：「邮件发送」卡片在 320 宽下的极限内容。开发的 email-settings.spec.ts 用的是短主机名，这里用规则允许的最长值。
 * 登录走真实后端；第三方密钥的接口用页面拦截返回虚构的值，不写库、不发信。
 */
import { type Locator, type Page, expect, test } from "@playwright/test";
import { adminCredentials, expectNoHorizontalOverflow, loginAs } from "./support.ts";

const LONG_LABEL = "a".repeat(63);
const LONG_HOST = `${LONG_LABEL}.${LONG_LABEL}.${LONG_LABEL}.${"b".repeat(57)}.test`;
const LONG_NAME = "N".repeat(100);
const LONG_ADDRESS = `${"x".repeat(241)}@example.test`;
const LONG_RECIPIENT = `${"r".repeat(241)}@example.test`;
const ID = "11111111-1111-4111-8111-111111111111";

const emailItem = {
  key: "email",
  label: "邮件发送",
  fields: [
    { name: "host", label: "SMTP 主机" },
    { name: "port", label: "端口（25、465、587、2525）" },
    { name: "encryption", label: "加密方式" },
    { name: "username", label: "用户名" },
    { name: "password", label: "密码" },
    { name: "from_name", label: "发件人名称" },
    { name: "from_address", label: "发件人地址" },
  ],
  state: "configured",
  source: "admin",
  source_label: "后台设置",
  mode: null,
  masked: "••••WXYZ",
  settings: { host: LONG_HOST, port: 587, encryption: "starttls", username: LONG_ADDRESS, from_name: LONG_NAME, from_address: LONG_ADDRESS },
  env_configured: true,
  admin: { configured: true, hints: { password: "••••WXYZ" }, updated_at: "2026-11-01T01:02:00.000Z", updated_by: { id: ID, name: LONG_NAME }, problem: null },
};

async function stubSecrets(page: Page): Promise<void> {
  await page.route("**/platform/v1/integration-secrets", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { precedence_note: "运营后台填写的优先；后台没填（或清空后）才用服务器配置文件里的值。", can_manage: true, encryption_configured: true, items: [emailItem] } })
      : route.fallback(),
  );
  await page.route("**/platform/v1/integration-secrets/email/test", (route) =>
    route.fulfill({ json: { key: "email", ok: true, code: null, message: `邮件服务器已接收，测试邮件发到了 ${LONG_RECIPIENT}，请去邮箱确认（也看看垃圾邮件）`, source: "admin", source_label: "后台设置", tested_at: "2026-11-01T03:04:05.000Z" } }),
  );
  await page.route("**/platform/v1/integration-secrets/email", (route) =>
    route.fulfill({
      status: 400,
      json: { error: { code: "VALIDATION_FAILED", message: "请求参数校验未通过", details: { location: "body", issues: [{ path: "/host", reason: "HOST_FORBIDDEN", message: "不能填内网地址：请填写邮件服务商给的公网主机名" }] } } },
    }),
  );
}

/** 这块内容里没有比它自己更宽的东西，也没有超出视口。 */
async function expectFits(box: Locator, what: string): Promise<void> {
  const measured = await box.evaluate((element) => {
    const limit = document.documentElement.clientWidth;
    const own = element.getBoundingClientRect();
    const beyond = [...element.querySelectorAll("*")].filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.right > limit + 1;
    });
    return { limit, right: own.right, scroll: element.scrollWidth - element.clientWidth, beyond: beyond.slice(0, 3).map((node) => `${node.tagName}.${String(node.getAttribute("class"))}`) };
  });
  expect(measured.right, `${what} 超出视口`).toBeLessThanOrEqual(measured.limit + 1);
  expect(measured.scroll, `${what} 内部能横向滚动`).toBeLessThanOrEqual(1);
  expect(measured.beyond, `${what} 里有东西超出视口`).toEqual([]);
}

test("320 宽：最长的主机、发件人、收件人不撑破卡片；对话框和字段错误也不溢出，保存按钮够得着", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await stubSecrets(page);
  const { email, password } = adminCredentials();
  await loginAs(page, "platform", email, password);
  await page.goto("/platform/settings/integrations");
  const card = page.getByRole("region", { name: "邮件发送", exact: true });
  await expect(card).toContainText(LONG_HOST);
  await expectFits(card, "卡片");
  await expectNoHorizontalOverflow(page, "320 宽的卡片");

  await card.getByRole("button", { name: "测试一下" }).click();
  await expect(card.getByRole("status")).toContainText(LONG_RECIPIENT);
  await expectFits(card, "带测试结果的卡片");
  await expectNoHorizontalOverflow(page, "320 宽的测试结果");

  await card.getByRole("button", { name: "更换" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("SMTP 主机")).toHaveValue(LONG_HOST);
  await expect(dialog.getByLabel("密码", { exact: true })).toHaveValue("");
  await expectFits(dialog, "对话框");
  await dialog.getByLabel("密码", { exact: true }).fill("qa-fake-pass-0123456789");
  const save = dialog.getByRole("button", { name: "保存" });
  await save.scrollIntoViewIfNeeded();
  await expect(save).toBeInViewport();
  await save.click();
  await expect(dialog.getByRole("alert").first()).toContainText("有几项需要修改");
  await expect(dialog.getByLabel("SMTP 主机")).toBeFocused();
  await expectFits(dialog, "带字段错误的对话框");
  await expectNoHorizontalOverflow(page, "320 宽的对话框");
});
