/**
 * 法律文案（M9E-24，ADR 0107）的端到端测试：真实浏览器 → 前端 → 真实 API → 真实 PostgreSQL。
 * - 三个页面（特定商取引法に基づく表記、キャンセルポリシー、プライバシーポリシー）：不登录就能看；360 / 400 宽不横向滚动；亮暗两色 axe 无问题；
 *   キャンセルポリシー的表和 `GET /site/v1/legal` 返回的取消政策一致（行数、列数），页脚三个链接能互相跳。
 * - 超级管理员在「系统设置 → 官网设置 → 法律文案的待补项」填販売事業者和邮箱 → 页面上换成填的值；没填的显示「未設定」。
 * 待补项是全站一行：用例开头记下原来的值，结束时原样写回（不留给别的用例）。填的名称、邮箱都是虚构的。
 */
import { randomBytes } from "node:crypto";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { expectAccessible } from "./catalog.ts";
import { OWN_SITE_SOURCE, VIEWPORTS, adminCredentials, expectNoHorizontalOverflow, loginAs, platformAdminHeaders, snapshot } from "./support.ts";

test.use(OWN_SITE_SOURCE);
// 两条用例都读写同一行待补项：按顺序跑
test.describe.configure({ mode: "serial" });

type Fields = Record<string, string | null>;
interface LegalSettings {
  fields: Fields;
  version: number;
}

async function readSettings(request: APIRequestContext): Promise<LegalSettings> {
  const headers = await platformAdminHeaders(request);
  const response = await request.get("/platform/v1/legal-settings", { headers });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as LegalSettings;
}

async function writeSettings(request: APIRequestContext, fields: Fields): Promise<void> {
  const headers = await platformAdminHeaders(request);
  const { version } = await readSettings(request);
  const response = await request.put("/platform/v1/legal-settings", { headers: { ...headers, ...(version > 0 ? { "if-match": `"${version}"` } : {}) }, data: { fields } });
  expect(response.status(), await response.text()).toBe(200);
}

async function checkPage(page: Page, what: string, shot: string): Promise<void> {
  const viewport = page.viewportSize() ?? VIEWPORTS.desktop;
  for (const size of [VIEWPORTS.phone360, VIEWPORTS.phone400]) {
    await page.setViewportSize(size);
    await expectNoHorizontalOverflow(page, `${what}（${size.width}px）`);
  }
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${what}（${scheme === "light" ? "亮色" : "暗色"}）`);
    await snapshot(page, `${shot}-${scheme}`);
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize(viewport);
}

test("三份法律文案：不登录就能看，手机宽不横向滚动、亮暗两色无障碍；取消费表按后台的取消政策生成；页脚的链接互相能跳", async ({ page, request }) => {
  const legal = (await (await request.get("/site/v1/legal")).json()) as { cancellation_policy: { rules: { tiers: { fee_bp: number }[] }[] } };
  const fees = new Set(legal.cancellation_policy.rules.flatMap((rule) => rule.tiers.map((tier) => tier.fee_bp)));

  await page.goto("/legal/tokushoho");
  await expect(page.getByRole("heading", { level: 1, name: "特定商取引法に基づく表記" })).toBeVisible();
  await expect(page).toHaveTitle("特定商取引法に基づく表記｜NOZOMI");
  await expect(page.getByRole("region", { name: "特定商取引法に基づく表記", exact: true }).getByRole("rowheader", { name: "運営統括責任者" })).toBeVisible();
  await checkPage(page, "特定商取引法に基づく表記", "m9e24-tokushoho");

  await page.getByRole("navigation", { name: "法律文案" }).getByRole("link", { name: "キャンセルポリシー" }).click();
  await expect(page).toHaveURL(/\/legal\/cancellation$/);
  const table = page.getByRole("region", { name: "キャンセル料", exact: true }).getByRole("table");
  await expect(table.locator("thead th")).toHaveCount(2 + fees.size);
  await expect(table.locator("thead th").nth(2)).toHaveText(fees.has(0) ? "無料" : /%$/);
  await expect(page.getByText("ご予約画面に、そのご予約に適用されるキャンセル料を表示します。")).toBeVisible();
  await checkPage(page, "キャンセルポリシー", "m9e24-cancellation");

  await page.getByRole("navigation", { name: "法律文案" }).getByRole("link", { name: "プライバシーポリシー" }).click();
  await expect(page).toHaveURL(/\/legal\/privacy$/);
  await expect(page.getByRole("region", { name: "業務委託先・外部サービス", exact: true })).toBeVisible();
  await checkPage(page, "プライバシーポリシー", "m9e24-privacy");
});

test("超级管理员在官网设置填待补项 → 页面上换成填的值；没填的显示「未設定」", async ({ browser, page, request }) => {
  test.setTimeout(180_000);
  const original = await readSettings(request);
  const seller = `E2E テスト販売 ${randomBytes(3).toString("hex")}`;
  const email = `legal-${randomBytes(4).toString("hex")}@e2e.example.com`;
  try {
    await writeSettings(request, Object.fromEntries(Object.keys(original.fields).map((key) => [key, null])));
    await page.goto("/legal/tokushoho");
    const tokushoho = page.getByRole("region", { name: "特定商取引法に基づく表記", exact: true });
    await expect(tokushoho.getByText("未設定")).toHaveCount(3);

    const admin = adminCredentials();
    const context = await browser.newContext({ locale: "zh-CN" });
    const adminPage = await context.newPage();
    await adminPage.setViewportSize(VIEWPORTS.desktop);
    await loginAs(adminPage, "platform", admin.email, admin.password);
    await adminPage.getByRole("navigation", { name: "主菜单" }).getByRole("button", { name: "系统设置" }).click();
    await adminPage.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "官网设置" }).click();
    const card = adminPage.getByRole("region", { name: "法律文案的待补项" });
    await expect(card.getByText(/^还缺 10 项：/)).toBeVisible();
    await card.getByLabel("販売事業者（销售主体）").fill(seller);
    await card.getByLabel("メールアドレス（联系邮箱）").fill("not-an-email");
    await card.getByRole("button", { name: "保存" }).click();
    await expect(card.getByText(/邮箱的格式不对/)).toBeVisible();
    await card.getByLabel("メールアドレス（联系邮箱）").fill(email);
    await card.getByRole("button", { name: "保存" }).click();
    await expect(adminPage.getByText("已保存，还缺 8 项")).toBeVisible();
    await expect(card.getByText(/^还缺 8 项：日本国内の連絡先、/)).toBeVisible();
    await checkPage(adminPage, "官网设置（法律文案的待补项）", "m9e24-platform-legal");
    await context.close();

    await page.reload();
    await expect(tokushoho.getByRole("row", { name: new RegExp(`販売事業者 ${seller}`) })).toBeVisible();
    await expect(tokushoho.getByRole("link", { name: email })).toHaveAttribute("href", `mailto:${email}`);
    await expect(tokushoho.getByText("未設定")).toHaveCount(1);
    await page.goto("/legal/privacy");
    await expect(page.getByText(`${seller}（以下「当社」）は、お客様の個人情報を以下のとおり取り扱います。`)).toBeVisible();
    await expect(page.getByRole("region", { name: "7. 開示・訂正・削除のご請求・お問い合わせ" }).getByRole("link", { name: email })).toBeVisible();
  } finally {
    await writeSettings(request, original.fields);
  }
});
