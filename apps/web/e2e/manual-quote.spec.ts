/**
 * 端到端：官网报不出价时「留下联系方式、人工报价」和「通过 WhatsApp 联系我们」，客服在运营后台跟进（M8-21，ADR 0076）。
 * 真实浏览器 → 构建好的前端 → 真实 API → 真实 PostgreSQL，不 mock 接口。
 *
 * - 客人（手机 390 宽）：打开新预订页的链接，两端都不在任何城市里 → 「这个地址暂时没有在线报价，请联系客服」下面是表单（只有邮箱、WhatsApp）；
 *   客服 WhatsApp 号码还没设置时没有 WhatsApp 按钮；两项都不填提交被拦；填了提交 → 「已收到」。
 * - 客服：菜单「人工报价」→ 列表里只写留了哪几项（没有邮箱原文）→ 按邮箱查到 → 详情有邮箱、发信链接、审计提示 → 改成「跟进中」并指派给自己、写备注；
 *   「系统设置 → 官网设置」只读。
 * - 超级管理员：「系统设置 → 官网设置」填「客服 WhatsApp 号码」→ 客人重新打开同一个链接，按钮出现、wa.me 链接带号码和行程要点。
 * - 报不出价时只有人工报价那一块（M8-21b）：电脑、手机都没有下单用的乘客信息（姓名、手机号、同意保存银行卡）、「去付款」和往第 3 步的「下一步」（M8-27）。
 * 320 / 390 宽不横向滚动，亮暗两色 axe。号码、邮箱都是虚构的；用例结束把客服号码清空（全站一行，不留给别的用例）。
 * 官网按来源地址限速：这组 API 信任一层代理，每个用例用 `OWN_SITE_SOURCE` 带一个文档专用的随机地址，不和别的用例抢额度。
 */
import { randomBytes } from "node:crypto";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { E2E_WEB_DRIVER_MAIL_PORT } from "../playwright.config.ts";
import { publishTransfer, tomorrowInTokyo } from "./book-new-support.ts";
import { createSupplier, createWorld, expectAccessible } from "./catalog.ts";
import { OWN_SITE_SOURCE, adminCredentials, expectNoHorizontalOverflow, loginAs, newPassword, platformAdminHeaders, snapshot, uniqueEmail } from "./support.ts";

test.use({ baseURL: `http://127.0.0.1:${E2E_WEB_DRIVER_MAIL_PORT}` });
test.use(OWN_SITE_SOURCE);

/** 虚构的客服号码：国家码 81 后面全是 0，不是任何真实号码 */
const SUPPORT_DIGITS = "810000000000";
/** 两端都在北海道（没有任何用例在那里建城市），报价一定是「不在服务范围」 */
const FROM = { lat: 43.0621, lng: 141.3544, name: "测试上车点甲" };
const TO = { lat: 43.0687, lng: 141.3508, name: "测试下车点乙" };

async function setSupportWhatsapp(request: APIRequestContext, value: string | null): Promise<void> {
  const headers = await platformAdminHeaders(request);
  const current = (await (await request.get("/platform/v1/site-settings", { headers })).json()) as { version: number };
  const response = await request.put("/platform/v1/site-settings", { headers: { ...headers, ...(current.version > 0 ? { "if-match": `"${current.version}"` } : {}) }, data: { support_whatsapp: value } });
  expect(response.status(), await response.text()).toBe(200);
}

async function inviteStaff(request: APIRequestContext, role: string, name: string): Promise<{ email: string; password: string }> {
  const headers = await platformAdminHeaders(request);
  const email = uniqueEmail(`m821-${role}`);
  const password = newPassword();
  const invited = await request.post("/platform/v1/staff", { headers, data: { email, name, role } });
  expect(invited.status(), await invited.text()).toBe(201);
  const token = ((await invited.json()) as { invite: { token: string } }).invite.token;
  const accepted = await request.post("/platform/v1/auth/accept-invite", { data: { token, password } });
  expect(accepted.status(), await accepted.text()).toBe(200);
  return { email, password };
}

/** 320 / 390 宽不横向滚动，亮暗两色 axe；留一张图（设置了 E2E_SCREENSHOT_DIR 时）。 */
async function checkNarrow(page: Page, what: string, shot: string): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 390, height: 844 };
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expectNoHorizontalOverflow(page, `${what}（${width}px）`);
  }
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${what}（${scheme === "light" ? "亮色" : "暗色"}）`);
    await snapshot(page, `${shot}-${scheme}`);
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize(viewport);
}

/** 报不出价时只有人工报价那一块：下单用的「怎么联系你」和「去付款」都不在页面上（M8-21b，规范 11.1）。 */
async function expectManualQuoteOnly(page: Page): Promise<void> {
  await expect(page.getByRole("region", { name: "请客服人工报价" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "怎么联系你" })).toHaveCount(0);
  await expect(page.getByLabel("乘车人姓名")).toHaveCount(0);
  await expect(page.getByLabel("手机号（含国家区号）")).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: /同意保存这次付款用的银行卡/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "去付款 →" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "下一步：填写乘客信息" })).toHaveCount(0);
  await expect(page.getByLabel("邮箱")).toHaveCount(1);
}

test("报不出价：客人留下邮箱和 WhatsApp → 客服在「人工报价」看到、改成跟进中并指派给自己、写备注 → 超级管理员在「官网设置」填客服 WhatsApp 号码后，官网出现「通过 WhatsApp 联系我们」", async ({ browser, page, request }) => {
  test.setTimeout(240_000);
  // 官网要有一个可订的城市，新预订页才打开（这个城市在东京，和北海道的两端无关）
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  await publishTransfer(request, supplier, world);
  await setSupportWhatsapp(request, null);
  const date = tomorrowInTokyo();
  const link = `/book/new?from=${FROM.lat},${FROM.lng}&from_name=${encodeURIComponent(FROM.name)}&to=${TO.lat},${TO.lng}&to_name=${encodeURIComponent(TO.name)}&date=${date}&time=10:00`;
  const guestEmail = `fictional.guest.${randomBytes(4).toString("hex")}@e2e.example.com`;

  try {
    // ── 客人 ──
    // 电脑：链接带齐了行程，打开就到第 2 步，只有报不出价 + 人工报价，不能往乘客信息走（M8-27 四步）
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(link);
    await expect(page.getByText("这个地址暂时没有在线报价，请联系客服")).toBeVisible();
    await expectManualQuoteOnly(page);
    await page.setViewportSize({ width: 390, height: 844 });
    // 链接带齐了行程：打开就报价，手机直接到第 2 步
    await page.goto(link);
    const form = page.getByRole("region", { name: "请客服人工报价" });
    await expect(form).toBeVisible();
    await expect(page.getByText("这个地址暂时没有在线报价，请联系客服")).toBeVisible();
    await expect(form.getByRole("textbox")).toHaveCount(2);
    await expect(form.getByRole("checkbox")).toHaveCount(0);
    await expect(form.getByText("提交即同意客服通过您留下的方式联系您")).toBeVisible();
    await expect(page.getByRole("link", { name: /通过 WhatsApp 联系我们/ })).toHaveCount(0);
    await expectManualQuoteOnly(page);
    await form.getByRole("button", { name: "提交" }).click();
    await expect(form.getByText("请至少填一项：邮箱或 WhatsApp")).toBeVisible();
    await expect(form.getByLabel("邮箱")).toBeFocused();
    await checkNarrow(page, "新预订页的人工报价表单（校验）", "m821-site-form");
    await form.getByLabel("邮箱").fill(guestEmail);
    await form.getByLabel("WhatsApp").fill("+86 130 0000 0000");
    const submitted = page.waitForResponse((response) => response.url().endsWith("/site/v1/manual-quote-requests") && response.request().method() === "POST");
    await form.getByRole("button", { name: "提交" }).click();
    expect((await submitted).status()).toBe(202);
    await expect(form.getByRole("status")).toHaveText("已收到。客服会通过您留下的邮箱或 WhatsApp 联系您报价，请留意消息。");
    await checkNarrow(page, "新预订页的人工报价（已提交）", "m821-site-done");

    // ── 客服 ──
    const cs = await inviteStaff(request, "customer_service", "端到端客服（M8-21）");
    const csContext = await browser.newContext({ baseURL: `http://127.0.0.1:${E2E_WEB_DRIVER_MAIL_PORT}`, locale: "zh-CN" });
    const csPage = await csContext.newPage();
    await csPage.setViewportSize({ width: 1280, height: 900 });
    await loginAs(csPage, "platform", cs.email, cs.password);
    await csPage.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "人工报价" }).click();
    await expect(csPage.getByRole("heading", { level: 1, name: "人工报价" })).toBeVisible();
    await expect(csPage.locator("main")).not.toContainText(guestEmail);
    // 查找框停手后才发请求，结果回来前旧列表半透明（.table--stale）。只等「一行」会被查找前的列表提前满足（库里碰巧只有这一条），
    // 接着的 axe 就落在半透明的表上报 color-contrast（M8-29）。所以等按邮箱查的应答回来、表格不再忙
    const searched = csPage.waitForResponse((response) => new URL(response.url()).searchParams.get("contact") === guestEmail);
    await csPage.getByRole("searchbox", { name: /按联系方式查找/ }).fill(guestEmail);
    expect((await searched).status()).toBe(200);
    await expect(csPage.locator(".table-wrap")).not.toHaveAttribute("aria-busy", "true");
    const row = csPage.getByRole("row").filter({ hasText: /^MQ/ });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("邮箱、WhatsApp");
    await expect(row).toContainText("点对点 · 城市未识别");
    await expect(row).toContainText("新");
    await expect(csPage.locator("table")).not.toContainText(guestEmail);
    await checkNarrow(csPage, "人工报价列表", "m821-platform-list");
    await row.getByRole("link", { name: /^MQ/ }).click();
    await expect(csPage.getByRole("heading", { level: 1, name: /^申请 MQ/ })).toBeVisible();
    await expect(csPage.getByRole("link", { name: guestEmail })).toHaveAttribute("href", `mailto:${guestEmail}`);
    await expect(csPage.getByRole("link", { name: /^\+8613000000000/ })).toHaveAttribute("href", /^https:\/\/wa\.me\/8613000000000\?text=/);
    await expect(csPage.getByText(/你打开这一页已记入审计日志/)).toBeVisible();
    await expect(csPage.getByText(FROM.name)).toBeVisible();
    const follow = csPage.getByRole("region", { name: "跟进" });
    await follow.getByLabel("状态").selectOption({ label: "跟进中" });
    await follow.getByRole("button", { name: "指派给我" }).click();
    await follow.getByRole("button", { name: "保存" }).click();
    await expect(csPage.getByText("状态：新 → 跟进中")).toBeVisible();
    await expect(csPage.getByText("指派给「端到端客服（M8-21）」")).toBeVisible();
    await csPage.getByLabel("写备注").fill("已发邮件报价，等客人回复");
    await csPage.getByRole("button", { name: "添加备注" }).click();
    await expect(csPage.getByText("已发邮件报价，等客人回复")).toBeVisible();
    await checkNarrow(csPage, "人工报价详情", "m821-platform-detail");
    await csPage.goto("/platform/manual-quotes?status=following");
    await expect(csPage.getByRole("row").filter({ hasText: /^MQ/ }).first()).toBeVisible();
    // 客服看得到官网设置、改不了
    await csPage.getByRole("navigation", { name: "主菜单" }).getByRole("button", { name: "系统设置" }).click();
    await csPage.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "官网设置" }).click();
    await expect(csPage.getByText(/只有超级管理员能改这个号码/)).toBeVisible();
    await expect(csPage.getByRole("textbox")).toHaveCount(0);
    await csContext.close();

    // ── 超级管理员 ──
    const admin = adminCredentials();
    const adminContext = await browser.newContext({ baseURL: `http://127.0.0.1:${E2E_WEB_DRIVER_MAIL_PORT}`, locale: "zh-CN" });
    const adminPage = await adminContext.newPage();
    await adminPage.setViewportSize({ width: 1280, height: 900 });
    await loginAs(adminPage, "platform", admin.email, admin.password);
    await adminPage.getByRole("navigation", { name: "主菜单" }).getByRole("button", { name: "系统设置" }).click();
    await adminPage.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "官网设置" }).click();
    await expect(adminPage).toHaveURL(/\/platform\/settings\/site$/);
    const field = adminPage.getByLabel("客服 WhatsApp 号码");
    await expect(adminPage.getByText(/填带国家码的号码/)).toBeVisible();
    await field.fill("090-0000");
    await adminPage.getByRole("region", { name: "客服 WhatsApp" }).getByRole("button", { name: "保存" }).click();
    await expect(adminPage.getByText(/号码的格式不对/)).toBeVisible();
    await field.fill("+81 00 0000 0000");
    await adminPage.getByRole("region", { name: "客服 WhatsApp" }).getByRole("button", { name: "保存" }).click();
    await expect(adminPage.getByText("已保存，官网的 WhatsApp 按钮用这个号码")).toBeVisible();
    await expect(adminPage.getByLabel("客服 WhatsApp 号码")).toHaveValue(`+${SUPPORT_DIGITS}`);
    await expect(adminPage.getByRole("link", { name: /在 WhatsApp 里打开看看/ })).toHaveAttribute("href", new RegExp(`^https://wa\\.me/${SUPPORT_DIGITS}\\?text=`));
    await checkNarrow(adminPage, "官网设置", "m821-platform-site-settings");
    await adminContext.close();

    // ── 客人重新打开同一个链接：WhatsApp 按钮出现 ──
    await page.goto(link);
    const button = page.getByRole("link", { name: /通过 WhatsApp 联系我们/ });
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute("target", "_blank");
    await expect(button).toHaveAttribute("rel", /\bnoopener\b/);
    const href = new URL((await button.getAttribute("href")) ?? "");
    expect(`${href.origin}${href.pathname}`).toBe(`https://wa.me/${SUPPORT_DIGITS}`);
    expect(href.searchParams.get("text")).toBe(`您好，我想咨询用车报价：点对点，${FROM.name} → ${TO.name}，${date} 10:00，2 人。`);
    await checkNarrow(page, "新预订页的人工报价（有 WhatsApp 按钮）", "m821-site-whatsapp");
    await expectManualQuoteOnly(page);
    // 只有人工报价那一块（M8-21b）：手机 390 和电脑单页，亮暗各一张
    for (const [width, height, name] of [[390, 844, "390"], [1280, 900, "desktop"]] as const) {
      await page.setViewportSize({ width, height });
      await expectManualQuoteOnly(page);
      for (const scheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await expectAccessible(page, `新预订页报不出价、只有人工报价（${name}，${scheme === "light" ? "亮色" : "暗色"}）`);
        await snapshot(page, `m821b-${name}-${scheme}`);
      }
    }
    await page.emulateMedia({ colorScheme: "light" });
  } finally {
    await setSupportWhatsapp(request, null);
  }
});
