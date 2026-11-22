/**
 * 端到端：包车经停顺序建议（M9P-20 P2，ADR 0096 第三节、第四节）。真实浏览器 → 前端 → 真实 API（报价、下单）→ 真实 PostgreSQL。
 *
 * **建议接口替身**：端到端的假谷歌对所有路线回同一段距离（global-setup 里共用，不能按用例改），真实的优化调用拿不到顺序；
 * 所以 `POST /site/v1/charter/order-suggestion` 由用例接住：建议顺序固定是「倒过来」，建议报价是用例按这个顺序向**真实 API** 询的价
 * （报价编号、快照都是真的，下单就按它），建议路线写成比当前少 20 公里、20 分钟。后端的优化、缓存、限频、阈值由集成测试 site-order-suggestion.itest.ts 覆盖。
 *
 * 用地址搜索那一组（有假谷歌密钥，按行程计价能估路线）；那一组没配 Stripe，下单后停在待付款，核对订单本身。
 * 流程（电脑 1280）：加 3 个经停 → 第 2 步出现建议块（价格不变、两栏编号顺序）→ 亮暗 axe → 「采用建议顺序」：焦点到行程标题、
 * 顺序倒过来、不再多询一次价 → 下单：订单的报价编号是建议报价、订单页经停按建议顺序编号；390 宽建议块改成切换（只要一张图）。
 */
import { type Page, type Route, expect, test } from "@playwright/test";
import { E2E_WEB_PLACES_PORT } from "../playwright.config.ts";
import { draftRequestKey } from "../src/lib/order-suggestion.ts";
import { tomorrowInTokyo } from "./book-new-support.ts";
import { expectAccessible } from "./catalog.ts";
import { type Point, charterWorld, linkPoint } from "./charter-support.ts";
import { platformAdminHeaders, randomLetters } from "./support.ts";

const SITE = `http://127.0.0.1:${E2E_WEB_PLACES_PORT}`;

async function expectBothThemes(page: Page, what: string): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${what}（${scheme === "light" ? "亮色" : "暗色"}）`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

test("经停顺序建议：出现建议块 → 采用（焦点到行程标题、不再多询价）→ 按建议报价下单，订单经停按建议顺序；亮暗 axe；390 宽改成切换", async ({ page, request }) => {
  test.setTimeout(240_000);
  const trip = await charterWorld(request);
  const admin = await platformAdminHeaders(request);
  const tag = randomLetters(4);
  const station = async (name: string, at: Point): Promise<string> => {
    const made = await request.post("/platform/v1/master/places", { headers: admin, data: { type: "station", code: `STN-JP-${randomLetters(6)}`, city_id: trip.cityId, category: "rail", name: { zh: name }, location: at } });
    expect(made.status(), await made.text()).toBe(201);
    return name;
  };
  const names = [
    await station(`顺序甲${tag}`, { lat: Number((trip.center.lat + 0.02).toFixed(6)), lng: Number((trip.center.lng - 0.01).toFixed(6)) }),
    await station(`顺序乙${tag}`, { lat: Number((trip.center.lat - 0.015).toFixed(6)), lng: Number((trip.center.lng - 0.02).toFixed(6)) }),
    await station(`顺序丙${tag}`, { lat: Number((trip.center.lat + 0.01).toFixed(6)), lng: Number((trip.center.lng + 0.015).toFixed(6)) }),
  ];
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `192.0.2.${1 + Math.floor(Math.random() * 250)}` });

  const quotesPosted: Record<string, unknown>[] = [];
  page.on("request", (sent) => {
    if (new URL(sent.url()).pathname === "/site/v1/quotes" && sent.method() === "POST") quotesPosted.push(sent.postDataJSON() as Record<string, unknown>);
  });
  let suggestedQuoteId = "";
  const asked: Record<string, any>[] = [];
  await page.route(`${SITE}/site/v1/charter/order-suggestion`, async (route: Route) => {
    const body = route.request().postDataJSON() as Record<string, any>;
    asked.push(body);
    const refs = body.refs as string[];
    const order = [...refs].reverse();
    const waypoints = [...(body.quote.waypoints as unknown[])].reverse();
    const real = await request.post(`${SITE}/site/v1/quotes`, { data: { ...body.quote, waypoints }, headers: { "x-forwarded-for": "192.0.2.251" } });
    expect(real.status(), await real.text()).toBe(200);
    const quoteResult = (await real.json()) as { quotes: { quote_id: string }[]; itinerary_route: { legs: { minutes: number; meters: number }[]; drive_minutes: number; stay_minutes: number; total_minutes: number; total_meters: number } };
    suggestedQuoteId = quoteResult.quotes[0]?.quote_id ?? "";
    const current = quoteResult.itinerary_route;
    const shorter = { ...current, drive_minutes: current.drive_minutes - 20, total_minutes: current.total_minutes - 20, total_meters: current.total_meters - 20_000 };
    await route.fulfill({
      json: {
        suggestion: { order, saved_meters: 20_000, saved_minutes: 20, current_itinerary_route: current, itinerary_route: shorter, request_key: draftRequestKey(body.quote), thresholds: { min_saved_meters: 5_000, min_saved_minutes: 10 }, current_too_long: false, quote_result: { ...quoteResult, itinerary_route: shorter } },
        reason: null,
      },
    });
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${SITE}/book?mode=charter&${linkPoint("from", trip.pickup, "上车酒店")}&${linkPoint("to", trip.nearby, "市内下车点")}&date=${tomorrowInTokyo()}&time=10:00`);
  const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: trip.groupName }) });
  await expect(card).toContainText("JPY");
  await page.getByRole("button", { name: "上一步" }).click();
  for (const [index, name] of names.entries()) {
    await page.getByRole("button", { name: "添加经停点" }).click();
    const box = page.getByRole("combobox", { name: `经停点 ${index + 1}`, exact: true });
    await box.fill(name);
    await page.getByRole("listbox", { name: `经停点 ${index + 1}的候选` }).getByRole("option", { name: new RegExp(name) }).click();
    await expect(box).toHaveValue(name);
    await page.getByLabel(`经停点 ${index + 1} 停留时长`).selectOption("60");
  }
  await page.getByRole("button", { name: "下一步：选择车型" }).click();

  const block = page.getByRole("region", { name: /^建议顺序，可省/ });
  await expect(block).toBeVisible();
  await expect(block.getByRole("heading", { level: 4, name: /^建议顺序，可省/ })).toHaveText("建议顺序，可省 20 公里、20 分钟，价格不变");
  await expect(block.getByText(`1 上车酒店 → 2 ${names[0]} → 3 ${names[1]} → 4 ${names[2]} → 5 市内下车点`)).toBeVisible();
  await expect(block.getByText(`1 上车酒店 → 2 ${names[2]} → 3 ${names[1]} → 4 ${names[0]} → 5 市内下车点`)).toBeVisible();
  expect(asked).toHaveLength(1);
  expect(asked[0]?.quote_id, "带当前顺序的报价编号").toMatch(/^QT/);
  await expectBothThemes(page, "新预订页包车第 2 步（经停顺序建议）");

  // 手机 390：两栏改成切换，默认只有当前顺序的图
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(block.getByRole("button", { name: "建议顺序", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(block.locator(".itinerary-map")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), "390 宽横向溢出").toBe(0);
  await block.getByRole("button", { name: "建议顺序", exact: true }).click();
  await expect(block.getByText(`1 上车酒店 → 2 ${names[2]} → 3 ${names[1]} → 4 ${names[0]} → 5 市内下车点`)).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });

  // 采用：焦点到行程标题、顺序倒过来、没有多询一次价
  const before = quotesPosted.length;
  await block.getByRole("button", { name: "采用建议顺序" }).click();
  await expect(page.getByRole("heading", { name: "行程时间表" })).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "已按建议顺序排列" })).toBeAttached();
  await expect(page.getByRole("list", { name: "行程" }).locator(".trip-stops__name")).toHaveText(["上车酒店", names[2] as string, names[1] as string, names[0] as string, "市内下车点"]);
  await expect(block).toHaveCount(0);
  await expect(page.getByRole("button", { name: "恢复原来的顺序" })).toBeVisible();
  expect(quotesPosted.length, "采用直接用建议报价，不再多询一次价").toBe(before);

  // 按建议报价下单
  await card.getByRole("button", { name: `选择 ${trip.groupName}` }).click();
  await page.getByRole("button", { name: "下一步：填写乘客信息" }).click();
  await page.getByLabel("乘车人姓名").fill("陈小红");
  await page.getByLabel("邮箱").fill(`suggest-${crypto.randomUUID().slice(0, 8)}@e2e.example.com`);
  await page.getByLabel("手机号（含国家区号）").fill("+81 90-2222-3333");
  await page.getByRole("button", { name: "下一步：核对订单" }).click();
  await page.getByRole("checkbox", { name: /同意保存/ }).check();
  const placed = page.waitForResponse((response) => new URL(response.url()).pathname === "/site/v1/orders" && response.request().method() === "POST");
  await page.getByRole("button", { name: "去付款 →" }).click();
  const order = await placed;
  expect(order.status(), await order.text()).toBe(201);
  expect((order.request().postDataJSON() as { quote_id: string }).quote_id, "下单用的是建议报价").toBe(suggestedQuoteId);
  await expect(page.getByRole("heading", { level: 1, name: /^订单 NZ/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "行程" }).getByRole("list", { name: "包车行程" }).locator(".trip-stops__name")).toHaveText(["上车酒店", names[2] as string, names[1] as string, names[0] as string, "市内下车点"]);
});
