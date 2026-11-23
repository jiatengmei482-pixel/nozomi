/**
 * 端到端：官网的地址搜索和地图选点（M3-12，ADR 0044）。真实浏览器 → 前端 → 真实 API（`/site/v1`）→ 真实 PostgreSQL，不 mock 接口；
 * 谷歌是 global-setup 起的本机假服务器（假 Places 对任何关键字都给「東京駅」，假 Geocoding 给一个固定地址），**从不调用真实的谷歌**。
 * 用的是地址搜索专用的那组 API 和前端（配置文件里有假密钥，见 playwright.config.ts 的 E2E_API_PLACES_PORT）。
 *
 * 供应商经接口在本用例自己的城市（book-new-support.ts 的 pointToPointCity）上架一个点对点商品（一口价 15,000 日元，营运区是城市中心 ±0.1 度）。客人：
 * - 预订页 /book（M8-05 起是四步新流程）：出发地从链接来（城市中心）；目的地输入即提示出候选；再用键盘打开地图、选「地图中间这个位置」
 *   → 反查的地址填进地址框 → 报价成功；
 * - 再把出发地在地图上点到营运区外 → 「这个地址暂时没有在线报价，请联系客服」。
 * 地图选点是谷歌地图（M10-01）：这里配上假的浏览器密钥、地图小页面换成假页面（`useFakeGoogleMapPicker`，协议和真的一样），不连真实的谷歌；页面上没有开源地图。
 * 浏览器只连本站（不连谷歌）；320 / 360 / 768 宽不横向滚动，亮暗两色 axe。
 */
import { type Page, expect, test } from "@playwright/test";
import { E2E_WEB_PLACES_PORT } from "../playwright.config.ts";
import { pointToPointCity } from "./book-new-support.ts";
import { expectAccessible } from "./catalog.ts";
import { OWN_SITE_SOURCE, fakeGoogleMapPick, useFakeGoogleMapPicker } from "./support.ts";

// 官网按来源地址限速：每条用例带自己的文档专用地址，不和并行的官网用例在 127.0.0.1 上抢同一份额度（M8-17）
test.use(OWN_SITE_SOURCE);

const SITE = `http://127.0.0.1:${E2E_WEB_PLACES_PORT}`;
function tomorrowInTokyo(): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(Date.now() + 24 * 3_600_000)).map((part) => [part.type, part.value]));
  return `${parts["year"]}-${parts["month"]}-${parts["day"]}`;
}

async function expectNarrowAndAccessible(page: Page, what: string): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  for (const size of [{ width: 320, height: 640 }, { width: 360, height: 740 }, { width: 768, height: 1024 }]) {
    await page.setViewportSize(size);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${what}：${size.width}px 宽横向溢出`).toBe(0);
  }
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${what}（${scheme === "light" ? "亮色" : "暗色"}）`);
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize(viewport);
}

test("官网地址（预订页 /book）：目的地输入即提示出候选 → 用键盘在谷歌地图上选点 → 报价成功；出发地在地图上点到服务区外 → 暂时没有在线报价；浏览器不连谷歌；窄屏、亮暗 axe", async ({ page, request }) => {
  test.setTimeout(150_000);
  // 预订页按两个坐标报价、按出发地找城市：用本用例自己的点对点城市（catalog.ts 的城市中心都一样，见 pointToPointCity）
  const { world, center } = await pointToPointCity(request, { pricing_model: "fixed", base_price: 15000 });
  await useFakeGoogleMapPicker(page);
  const origins = new Set<string>();
  page.on("request", (sent) => origins.add(new URL(sent.url()).origin));
  await page.setViewportSize({ width: 1280, height: 900 });

  // 出发地从链接来（城市中心），日期时间也在链接里；目的地留空
  await page.goto(`${SITE}/book?from=${center.lat},${center.lng}&from_name=${encodeURIComponent("望站南口")}&date=${tomorrowInTokyo()}&time=10:00`);
  await expect(page.getByRole("heading", { level: 1, name: "预订接送车" })).toBeVisible();
  await expect(page.getByLabel(/^城市/)).toHaveCount(0);
  const from = page.getByRole("combobox", { name: "出发地" });
  await expect(from).toHaveValue("望站南口");

  // 目的地：输入即提示（假谷歌给「東京駅」）；候选展开时窄屏、亮暗 axe
  const to = page.getByRole("combobox", { name: "目的地" });
  await to.fill("東京駅 丸の内");
  await expect(page.getByRole("listbox", { name: "目的地的候选" }).getByRole("option", { name: /東京駅/ })).toBeVisible();
  await expectNarrowAndAccessible(page, "预订页（候选展开）");
  await to.press("Escape");

  // 目的地：地图（默认收起）→ 不用鼠标：回车打开地图、选中间的位置 → 反查的地址填进地址框
  const toMap = page.getByRole("group", { name: "目的地的地图" });
  const toggle = toMap.getByRole("button", { name: "在地图上选点" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toMap.getByTitle(/地图：点一下选目的地位置/)).toBeVisible();
  const pickCenter = toMap.getByRole("button", { name: "选地图中间这个位置" });
  await expect(pickCenter).toBeEnabled();
  await pickCenter.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("combobox", { name: "目的地" })).toHaveValue("日本、〒100-0005 東京都千代田区丸の内１丁目９");
  await expect(page.locator(".leaflet-container"), "官网不用开源地图").toHaveCount(0);
  await expectNarrowAndAccessible(page, "预订页（地址已选）");

  await page.getByRole("button", { name: "下一步：选择车型" }).click();
  const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: world.group.name }) });
  await expect(card).toContainText("16,500 JPY");

  // 出发地在地图上点到营运区外（营运区是中心 ±0.1 度）：在地图上点往东 0.3 度（二三十公里外）的位置 → 暂时没有在线报价
  await page.getByRole("button", { name: "上一步" }).first().click();
  const fromMap = page.getByRole("group", { name: "出发地的地图" });
  await fromMap.getByRole("button", { name: "在地图上选点" }).click();
  await expect(fromMap.getByRole("button", { name: "选地图中间这个位置" })).toBeEnabled();
  await fakeGoogleMapPick(page, { lat: center.lat, lng: center.lng + 0.3 });
  await expect(from).not.toHaveValue("望站南口");
  await page.getByRole("button", { name: "下一步：选择车型" }).click();
  await expect(page.getByRole("heading", { name: "没有可预订的车" })).toBeVisible();
  await expect(page.locator("main")).toContainText("这个地址暂时没有在线报价，请联系客服");
  await expectNarrowAndAccessible(page, "预订页（服务区外）");

  // 浏览器只连本站：不连谷歌，也没有别的站外来源
  expect([...origins].filter((origin) => origin !== SITE)).toEqual([]);
});
