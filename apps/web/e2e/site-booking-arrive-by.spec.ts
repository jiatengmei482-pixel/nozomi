/**
 * 端到端：包车经停的指定到达时间（M9P-20 P3，ADR 0096 第三节第 6、7 小节；测试站验收第七节第 4 小节第 5、6 步）。
 * 真实浏览器 → 前端 → 真实 API（报价带 arrive_by、下单）→ 真实 PostgreSQL。
 *
 * **建议接口替身**（同 site-booking-order-suggestion.spec.ts）：端到端的假谷歌对所有路线回同一段（18 分钟、6.8 公里），真实的优化拿不到顺序；
 * 所以 `POST /site/v1/charter/order-suggestion` 由用例接住：按带 `arrive_by` 的经停切段，每段里的可动经停倒过来（和服务器同一个切段规则），
 * 建议报价是用例按这个顺序向**真实 API** 询的价。后端的切段、缓存、请求键由集成测试 site-arrive-by.itest.ts 覆盖。
 *
 * 流程（电脑 1280，10:00 出发）：加 4 个经停 → 给第 3 个（横滨）填「11:00」→ 这一行锁定（没有拖动把手、有锁、按钮说明「已锁定」），
 * 按当前顺序预计 12:54 到、行内提示晚到 → 第 2 步建议块：横滨留在原位、前面两个倒过来，「建议顺序」一栏同样提示晚到 → 采用 →
 * 下单：订单页的经停写「须在 11:00 前到达」。
 */
import { type Route, expect, test } from "@playwright/test";
import { E2E_WEB_PLACES_PORT } from "../playwright.config.ts";
import { draftRequestKey } from "../src/lib/order-suggestion.ts";
import { tomorrowInTokyo } from "./book-new-support.ts";
import { type Point, charterWorld, linkPoint } from "./charter-support.ts";
import { platformAdminHeaders, randomLetters } from "./support.ts";

const SITE = `http://127.0.0.1:${E2E_WEB_PLACES_PORT}`;

test("指定到达时间：横滨 11:00 前到——这一行锁定、预计晚到提示；建议顺序只在它前后各自重排、同样提示晚到；采用后下单，订单页写「须在 11:00 前到达」", async ({ page, request }) => {
  test.setTimeout(240_000);
  const trip = await charterWorld(request);
  const admin = await platformAdminHeaders(request);
  const tag = randomLetters(4);
  const station = async (name: string, at: Point): Promise<string> => {
    const made = await request.post("/platform/v1/master/places", { headers: admin, data: { type: "station", code: `STN-JP-${randomLetters(6)}`, city_id: trip.cityId, category: "rail", name: { zh: name }, location: at } });
    expect(made.status(), await made.text()).toBe(201);
    return name;
  };
  const near = (dLat: number, dLng: number): Point => ({ lat: Number((trip.center.lat + dLat).toFixed(6)), lng: Number((trip.center.lng + dLng).toFixed(6)) });
  const names = [await station(`到达甲${tag}`, near(0.02, -0.01)), await station(`到达乙${tag}`, near(-0.015, -0.02)), await station(`横滨${tag}`, near(0.01, 0.015)), await station(`到达丙${tag}`, near(-0.01, 0.02))];
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `192.0.2.${1 + Math.floor(Math.random() * 250)}` });

  const asked: Record<string, any>[] = [];
  await page.route(`${SITE}/site/v1/charter/order-suggestion`, async (route: Route) => {
    const body = route.request().postDataJSON() as Record<string, any>;
    asked.push(body);
    const refs = body.refs as string[];
    const stops = body.quote.waypoints as { arrive_by?: unknown }[];
    // 和服务器同一个切段规则：带 arrive_by 的是固定点，每段里的可动经停倒过来
    const order: number[] = [];
    let pending: number[] = [];
    stops.forEach((stop, index) => {
      if (stop.arrive_by === undefined) pending.push(index);
      else {
        order.push(...pending.reverse(), index);
        pending = [];
      }
    });
    order.push(...pending.reverse());
    const real = await request.post(`${SITE}/site/v1/quotes`, { data: { ...body.quote, waypoints: order.map((index) => stops[index]) }, headers: { "x-forwarded-for": "192.0.2.252" } });
    expect(real.status(), await real.text()).toBe(200);
    const quoteResult = (await real.json()) as { quotes: { quote_id: string }[]; itinerary_route: { legs: { minutes: number; meters: number }[]; drive_minutes: number; stay_minutes: number; total_minutes: number; total_meters: number } };
    const current = quoteResult.itinerary_route;
    const shorter = { ...current, drive_minutes: current.drive_minutes - 20, total_minutes: current.total_minutes - 20, total_meters: current.total_meters - 20_000 };
    await route.fulfill({
      json: {
        suggestion: { order: order.map((index) => refs[index]), saved_meters: 20_000, saved_minutes: 20, current_itinerary_route: current, itinerary_route: shorter, request_key: draftRequestKey(body.quote), thresholds: { min_saved_meters: 5_000, min_saved_minutes: 10 }, current_too_long: false, quote_result: { ...quoteResult, itinerary_route: shorter } },
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

  // 横滨 11:00 前到：锁定（把手换成锁，按钮说明「已锁定」），上移 / 下移照常可用
  const quoted = page.waitForRequest((sent) => new URL(sent.url()).pathname === "/site/v1/quotes" && sent.method() === "POST" && JSON.stringify(sent.postDataJSON()).includes('"arrive_by"'));
  await page.getByLabel("经停点 3 指定到达时间（选填）").fill("11:00");
  const sent = (await quoted).postDataJSON() as { waypoints: { arrive_by?: unknown }[] };
  expect(sent.waypoints.map((stop) => stop.arrive_by ?? null)).toEqual([null, null, { day_offset: 0, time: "11:00" }, null]);
  const row = page.locator("[data-waypoint]").nth(2);
  await expect(row.locator("[data-drag-handle]")).toHaveCount(0);
  await expect(row.locator("[data-locked]")).toHaveCount(1);
  const up = row.getByRole("button", { name: `把 ${names[2]} 上移` });
  await expect(up).toBeEnabled();
  await expect(up).toHaveAccessibleDescription(`${names[2]}，须在 11:00 前到达，已锁定，不参与建议顺序，只能用上移 / 下移调整`);
  // 每段 18 分钟、各停 60 分钟：10:00 + 18 + 60 + 18 + 60 + 18 = 12:54
  await expect(row.getByText(/预计 12:54 到，晚于指定的 11:00，来不及。请把上车时间提前到 \d\d:\d\d 或更早/)).toBeVisible();

  await page.getByRole("button", { name: "下一步：选择车型" }).click();
  const block = page.getByRole("region", { name: /^建议顺序，可省/ });
  await expect(block).toBeVisible();
  await expect.poll(() => asked.length).toBeGreaterThan(0);
  const last = asked.at(-1) as Record<string, any>;
  expect((last.quote.waypoints as { arrive_by?: unknown }[]).map((stop) => stop.arrive_by ?? null)).toEqual([null, null, { day_offset: 0, time: "11:00" }, null]);
  // 横滨留在第 3 个，前面两个倒过来，后面只有一个不动
  await expect(block.getByText(`1 上车酒店 → 2 ${names[1]} → 3 ${names[0]} → 4 ${names[2]} → 5 ${names[3]} → 6 市内下车点`)).toBeVisible();
  await expect(block.getByText(`${names[2]}：预计 12:54 到，晚于指定的 11:00`)).toBeVisible();
  const schedule = page.getByRole("list", { name: "行程" });
  await expect(schedule).toContainText("须在 11:00 前到达");
  await expect(schedule).toContainText("预计 12:54 到，晚于指定的 11:00");

  await block.getByRole("button", { name: "采用建议顺序" }).click();
  await expect(schedule.locator(".trip-stops__name")).toHaveText(["上车酒店", names[1] as string, names[0] as string, names[2] as string, names[3] as string, "市内下车点"]);

  // 下单：订单页的经停写「须在 11:00 前到达」（报价快照 → 订单）
  await card.getByRole("button", { name: `选择 ${trip.groupName}` }).click();
  await page.getByRole("button", { name: "下一步：填写乘客信息" }).click();
  await page.getByLabel("乘车人姓名").fill("陈小红");
  await page.getByLabel("邮箱").fill(`arrive-${crypto.randomUUID().slice(0, 8)}@e2e.example.com`);
  await page.getByLabel("手机号（含国家区号）").fill("+81 90-2222-3333");
  await page.getByRole("button", { name: "下一步：核对订单" }).click();
  await page.getByRole("checkbox", { name: /同意保存/ }).check();
  const placed = page.waitForResponse((response) => new URL(response.url()).pathname === "/site/v1/orders" && response.request().method() === "POST");
  await page.getByRole("button", { name: "去付款 →" }).click();
  const order = await placed;
  expect(order.status(), await order.text()).toBe(201);
  const created = (await order.json()) as { order: { waypoints: { name: string; arrive_by?: unknown }[] } };
  expect(created.order.waypoints.map((stop) => [stop.name, stop.arrive_by ?? null])).toEqual([
    [names[1], null],
    [names[0], null],
    [names[2], { day_offset: 0, time: "11:00" }],
    [names[3], null],
  ]);
  await expect(page.getByRole("heading", { level: 1, name: /^订单 NZ/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "行程" }).getByRole("list", { name: "包车行程" })).toContainText("须在 11:00 前到达");
});
