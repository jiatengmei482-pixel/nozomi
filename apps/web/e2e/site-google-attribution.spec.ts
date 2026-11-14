/**
 * 端到端：地址候选很多（10 个，服务端最多 5 个平台地点 + 5 个谷歌地点）时，谷歌署名「Google Maps」始终在可视区里（M9E-06 审查第 1 条；
 * 谷歌地图平台要求「Verify that the attribution is always visible and legible」）。核对：
 * - 新预订页电脑下拉（1280 宽）、窄窗口（360 宽，面板从底部升起）、手机全屏选择页（360 宽触屏）：面板滚到顶、滚到底，署名都在面板可视区和屏幕里；
 *   署名在 listbox 外面、同一个面板里，listbox 里只有候选；亮暗两色 axe 0，不横向滚动；
 * - 嵌入组件：同样 10 个候选，面板滚到顶、滚到底署名都看得见。
 * 候选用页面拦截固定成 10 个（真实后端和假谷歌最多给几个不由这里决定）；其余接口（嵌入组件的配置、嵌入码白名单）走真实后端。
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { type Locator, type Page, expect, test } from "@playwright/test";
import { E2E_WEB_PLACES_PORT } from "../playwright.config.ts";
import { createAirport, publishTransfer } from "./book-new-support.ts";
import { createSupplier, createWorld, expectAccessible } from "./catalog.ts";
import { OWN_SITE_SOURCE, platformAdminHeaders } from "./support.ts";

test.use(OWN_SITE_SOURCE);

const SITE = `http://127.0.0.1:${E2E_WEB_PLACES_PORT}`;

/** 5 个平台地点（带坐标）+ 5 个谷歌地点（带两行地址），和服务端的上限一样多 */
const TEN = [
  ...Array.from({ length: 5 }, (_, index) => ({ source: "platform", id: `p-${index}`, name: `平台车站 ${index + 1}`, address: "", location: { lat: 35.68 + index / 100, lng: 139.76 }, kind: "other" })),
  ...Array.from({ length: 5 }, (_, index) => ({ source: "google", id: `ChIJ-many-${index}`, name: `谷歌酒店 ${index + 1}`, address: `东京都新宿区西新宿 2-${index + 1}-1 很长的一段地址用来占第二行`, location: null, kind: "other" })),
];

async function tenSuggestions(page: Page, path: string): Promise<void> {
  await page.route(`${SITE}${path}?**`, (route) => route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, json: { available: true, items: TEN } }));
}

/** 署名在屏幕里、在面板的可视区里（不被面板裁掉） */
async function expectAttributionVisible(panel: Locator, attribution: Locator, what: string): Promise<void> {
  await expect(attribution, what).toBeVisible();
  await expect(attribution, what).toBeInViewport({ ratio: 1 });
  const box = await attribution.boundingBox();
  const frame = await panel.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, scrolls: node.scrollHeight > node.clientHeight + 1 };
  });
  expect(box, what).not.toBeNull();
  expect(box!.y, `${what}：署名上边在面板里`).toBeGreaterThanOrEqual(frame.top - 0.5);
  expect(box!.y + box!.height, `${what}：署名下边在面板里`).toBeLessThanOrEqual(frame.bottom + 0.5);
}

/** 面板滚到顶、滚到底都看得见署名；面板确实要滚（候选比面板高） */
async function expectPinned(scroller: Locator, panel: Locator, attribution: Locator, what: string): Promise<void> {
  const scrolls = await scroller.evaluate((node) => node.scrollHeight > node.clientHeight + 1);
  expect(scrolls, `${what}：10 个候选放不下、要滚动（用例要覆盖这种情况）`).toBe(true);
  await scroller.evaluate((node) => node.scrollTo({ top: 0 }));
  await expectAttributionVisible(panel, attribution, `${what}（滚到顶）`);
  await scroller.evaluate((node) => node.scrollTo({ top: node.scrollHeight }));
  await expectAttributionVisible(panel, attribution, `${what}（滚到底）`);
}

async function expectListboxOnlyOptions(list: Locator, what: string): Promise<void> {
  const others = await list.evaluate((node) => [...node.children].filter((child) => child.querySelector('[role="option"]') === null && child.getAttribute("role") !== "option").length);
  expect(others, `${what}：listbox 里只有候选`).toBe(0);
  await expect(list.getByRole("option")).toHaveCount(10);
}

async function expectBothThemes(page: Page, what: string): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${what}（${scheme === "light" ? "亮色" : "暗色"}）`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

test.beforeAll(async ({ request }) => {
  const world = await createWorld(request);
  const airport = await createAirport(request, world);
  const supplier = await createSupplier(request, world);
  await publishTransfer(request, supplier, { ...world, airport });
});

for (const size of [{ width: 1280, height: 800 }, { width: 360, height: 740 }]) {
  test(`新预订页 ${size.width} 宽下拉：10 个候选时署名固定在面板底部、始终看得见；listbox 里只有候选；亮暗 axe`, async ({ page }) => {
    await page.setViewportSize(size);
    await tenSuggestions(page, "/site/v1/places/autocomplete");
    await page.goto(`${SITE}/book/new`);
    await page.getByRole("combobox", { name: "出发地" }).fill("酒店");
    const list = page.getByRole("listbox", { name: "出发地的候选" });
    await expect(list.getByRole("option")).toHaveCount(10);
    const panel = list.locator("xpath=..");
    const attribution = panel.locator(".google-attribution");
    await expect(attribution).toHaveText("Google Maps");
    await expectListboxOnlyOptions(list, `${size.width} 宽`);
    await expectPinned(list, panel, attribution, `${size.width} 宽下拉`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${size.width} 宽不横向滚动`).toBe(0);
    await expectBothThemes(page, `${size.width} 宽 10 个候选`);
  });
}

test("新预订页手机全屏选择页 360 宽：10 个候选时署名始终看得见；亮暗 axe", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true, locale: "zh-CN" });
  const page = await context.newPage();
  await tenSuggestions(page, "/site/v1/places/autocomplete");
  await page.goto(`${SITE}/book/new`);
  await page.getByRole("button", { name: /^出发地/ }).tap();
  const sheet = page.getByRole("dialog", { name: "出发地" });
  await sheet.getByRole("combobox", { name: "出发地" }).fill("酒店");
  const list = sheet.getByRole("listbox", { name: "出发地的候选" });
  await expect(list.getByRole("option")).toHaveCount(10);
  const attribution = list.locator("xpath=..").locator(".google-attribution");
  await expectListboxOnlyOptions(list, "全屏选择页");
  await expectPinned(sheet.locator(".sheet__body"), sheet.locator(".sheet__body"), attribution, "全屏选择页");
  await expectBothThemes(page, "全屏选择页 10 个候选");
  await context.close();
});

test("嵌入组件：10 个候选时署名固定在面板底部、始终看得见；listbox 里只有候选", async ({ page, request }) => {
  // 合作网站：本机起一个页面（和 site-embed-widget.spec.ts 一样），白名单里只有它
  let key = "";
  const server = createServer((_, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>合作网站</title></head>
<body><main><h1>合作网站</h1><div id="nozomi-booking"></div></main>
<script src="${SITE}/embed/widget-v1.js"></script>
<script>NozomiBooking.init({ key: ${JSON.stringify(key)}, root: "#nozomi-booking", lang: "zh", services: ["transfer"] });</script></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const created = await request.post("/platform/v1/embed-keys", { headers: await platformAdminHeaders(request), data: { name: "M9E-06 署名", allowed_origins: [origin], default_lang: "zh", default_services: ["transfer"] } });
    expect(created.status(), await created.text()).toBe(201);
    key = ((await created.json()) as { key: string }).key;
    await page.setViewportSize({ width: 360, height: 740 });
    await tenSuggestions(page, "/embed/v1/places/autocomplete");
    await page.goto(origin);
    await page.getByRole("combobox", { name: "出发地" }).fill("酒店");
    const list = page.getByRole("listbox", { name: "出发地的候选" });
    await expect(list.getByRole("option")).toHaveCount(10);
    // Shadow DOM 里 XPath 走不进去，用 CSS（Playwright 的 CSS 会穿过开放的 Shadow DOM）
    const panel = page.locator('[data-field="pickup"] .nzb-panel');
    const attribution = panel.locator(".nzb-google");
    await expect(attribution).toHaveText("Google Maps");
    await expectListboxOnlyOptions(list, "嵌入组件");
    await expectPinned(list, panel, attribution, "嵌入组件");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
