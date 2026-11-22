/**
 * 端到端（测试角色补充，M3-10，ADR 0035）：真实浏览器 → 前端 → 真实 API（`/site/v1`）→ 真实 PostgreSQL。
 * - 320 / 360 / 768 宽都不横向滚动，亮色、暗色都过 axe：预订页（点对点链接带名称很长的上下车点，M8-05 起 /book 是四步新流程）的车型和价格、乘客信息，订单页和展开的「修改订单」；
 * - 包车单的订单页：改单只有上车地址、没有航班号；点对点单两端地址都在；
 * - 缺陷：待付款的单页面给了「修改订单」，后端却只允许确认后改（提交必定失败）；
 * - 缺陷：同一标签页换一张单的链接（只换 # 后面），展开着的修改表单还是上一张单的内容。
 * 订单经 /site/v1 接口下（和页面同一个接口；端到端没有 Stripe，订单待付款）。要改单的用例用支付替身把单记成已付款、已确认（待付款的单不能改，和后端一致），数据都在本次运行的临时 schema 里。
 */
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { pointToPointCity } from "./book-new-support.ts";
import { CENTER, type Supplier, type World, createProductByApi, createSupplier, createWorld, expectAccessible } from "./catalog.ts";
import { createPool } from "../../api/src/db/pool.ts";
import { randomLetters, OWN_SITE_SOURCE } from "./support.ts";

// 官网按来源地址限速：每条用例带自己的文档专用地址，不和并行的官网用例在 127.0.0.1 上抢同一份额度（M8-17）
test.use(OWN_SITE_SOURCE);

const RULES = {
  booking: { sale_from: null, sale_to: null, service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 0, note: null },
  urgent: { enabled: false, daily_quota: null, tiers: [] },
  night: { enabled: false, window: null, amount: null, charge_unit: null },
  free_wait: { pickup: null, dropoff: null, general: { mode: "limited", minutes: 30 } },
  addons: [],
  driver_languages: [],
};
const EMPTY_PRICE = { direction: null, package_hours: null, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null, base_price: null };
const POINT = { lat: CENTER.lat + 0.005, lng: CENTER.lng + 0.005 };
const OTHER = { lat: CENTER.lat + 0.01, lng: CENTER.lng + 0.01 };
/** 很长、不带空格的名称和地址：最容易把窄屏撑出横向滚动 */
const LONG_NAME = `超长名称的综合交通枢纽站${"東".repeat(40)}`;
const LONG_ADDRESS = `東京都千代田区丸の内一丁目${"9".repeat(60)}番地${"ビル".repeat(30)}`;

async function version(request: APIRequestContext, supplier: Supplier, id: string): Promise<number> {
  return ((await (await request.get(`/tenant/v1/products/${id}`, { headers: supplier.headers })).json()) as { version: number }).version;
}

async function publishedProduct(request: APIRequestContext, supplier: Supplier, world: World, category: "point_to_point" | "charter", price: Record<string, unknown>): Promise<void> {
  const product = await createProductByApi(request, supplier, world, category);
  const rules = await request.put(`/tenant/v1/products/${product.id}/service-rules`, { headers: { ...supplier.headers, "if-match": `"${product.version}"` }, data: category === "charter" ? { ...RULES, free_wait: { pickup: null, dropoff: null, general: { mode: "limited", minutes: 0 } } } : RULES });
  expect(rules.status(), await rules.text()).toBe(200);
  const content = await request.put(`/tenant/v1/products/${product.id}/content`, { headers: { ...supplier.headers, "if-match": `"${((await rules.json()) as { version: number }).version}"` }, data: { zh: { title: category === "charter" ? "QA 包车" : "QA 市内用车" } } });
  expect(content.status(), await content.text()).toBe(200);
  const { today } = (await (await request.get(`/tenant/v1/products/${product.id}/price-rules`, { headers: supplier.headers })).json()) as { today: string };
  const created = await request.post(`/tenant/v1/products/${product.id}/price-rules/batch`, {
    headers: { ...supplier.headers, "if-match": `"${await version(request, supplier, product.id)}"`, "idempotency-key": crypto.randomUUID() },
    data: { create: [{ ...EMPTY_PRICE, ref: "a", area_id: supplier.area.id, vehicle_group_id: world.group.id, valid_from: today, valid_to: null, status: "enabled", ...price }], update: [], delete: [] },
  });
  expect(created.status(), await created.text()).toBe(200);
  const published = await request.post(`/tenant/v1/products/${product.id}/publish`, { headers: supplier.headers });
  expect(published.status(), await published.text()).toBe(200);
}

function tokyoDayAfter(days: number): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(Date.now() + days * 24 * 3_600_000)).map((part) => [part.type, part.value]));
  return `${parts["year"]}-${parts["month"]}-${parts["day"]}`;
}

async function expectNoOverflow(page: Page, what: string): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  for (const size of [{ width: 320, height: 640 }, { width: 360, height: 740 }, { width: 768, height: 1024 }]) {
    await page.setViewportSize(size);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${what}：${size.width}px 宽横向溢出`).toBe(0);
  }
  await page.setViewportSize(viewport);
}

async function expectAccessibleBothThemes(page: Page, what: string): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${what}（${scheme === "light" ? "亮色" : "暗色"}）`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

/** 支付替身：把这一单记成「Stripe 通知付款成功、自动确认」之后的样子（同 site-booking.spec.ts；只在本次运行的临时 schema 里写）。 */
async function markPaid(orderNo: string): Promise<void> {
  const url = process.env["E2E_DATABASE_OWNER_URL"];
  if (!url) throw new Error("global-setup 没有准备好数据库连接");
  const client = createPool(url, { max: 1 });
  try {
    const order = await client.query<{ tenant_id: string; id: string }>(
      "update orders set status = 'confirmed', confirmed_at = now(), dispatch_due_at = least(service_at, now() + interval '2 hours'), version = version + 1, updated_at = now() where order_no = $1 and status = 'pending_payment' returning tenant_id, id",
      [orderNo],
    );
    const row = order.rows[0];
    if (row === undefined) throw new Error(`没有找到待支付的订单 ${orderNo}`);
    await client.query("insert into order_events (tenant_id, order_id, from_status, to_status, actor, reason, occurred_at) values ($1, $2, 'pending_payment', 'confirmed', 'payment', 'PAYMENT_SUCCEEDED', now())", [row.tenant_id, row.id]);
    await client.query("update order_payments set status = 'succeeded', intent_id = 'pi_e2e_' || replace($1::text, '-', ''), succeeded_at = now(), updated_at = now() where order_id = $1 and kind = 'order'", [row.id]);
  } finally {
    await client.end();
  }
}

/** 经 /site/v1 询价、下单，返回查看令牌。`paid`：下单后用支付替身记成已付款（要改单的用例用）。 */
async function placeByApi(request: APIRequestContext, quoteBody: Record<string, unknown>, addresses: Record<string, string>, options: { paid?: boolean } = {}): Promise<string> {
  const quoted = await request.post("/site/v1/quotes", { data: quoteBody });
  expect(quoted.status(), await quoted.text()).toBe(200);
  const quote = ((await quoted.json()) as { quotes: { quote_id: string }[] }).quotes[0];
  expect(quote, "报出了价").toBeTruthy();
  const created = await request.post("/site/v1/orders", { headers: { "idempotency-key": crypto.randomUUID() }, data: { quote_id: quote?.quote_id, passenger: { name: "陈小红", phone: "+81 90-2222-3333", email: `qa-${randomLetters(6).toLowerCase()}@e2e.example.com` }, save_payment_method: true, ...addresses } });
  expect(created.status(), await created.text()).toBe(201);
  const body = (await created.json()) as { link: { token: string }; order: { order_no: string } };
  if (options.paid === true) await markPaid(body.order.order_no);
  return body.link.token;
}

test("官网点对点、包车（测试角色补充）：长名称的上下车点在 320 / 360 / 768 宽不横向滚动，亮暗两色过 axe；订单页改单按服务只给有的地址栏", async ({ page, request }) => {
  test.setTimeout(180_000);
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  await publishedProduct(request, supplier, world, "point_to_point", { pricing_model: "fixed", base_price: 15000 });
  await publishedProduct(request, supplier, world, "charter", { pricing_model: "charter_package", package_hours: 8, package_km: 150, package_price: 70000, overtime_per_hour: 5000, over_km_per_km: 400 });
  const station = `${LONG_NAME}${randomLetters(3)}`;
  const poi = `长地址酒店${randomLetters(4)}（${LONG_ADDRESS}）`;
  await page.setViewportSize({ width: 768, height: 1024 });

  // 预订页（M8-05 起 /book 是四步新流程）：点对点的带参数链接，上车点是名称很长的车站，下车点是地址很长的酒店（链接里的名称最多留 120 个字）
  // 预订页按两个坐标报价、按出发地找城市：用本用例自己的点对点城市（catalog.ts 的城市中心都一样，见 pointToPointCity）
  const own = await pointToPointCity(request, { pricing_model: "fixed", base_price: 15000 });
  await page.goto(`/book?from=${own.center.lat},${own.center.lng}&from_name=${encodeURIComponent(station)}&to=${own.center.lat + 0.01},${own.center.lng + 0.01}&to_name=${encodeURIComponent(poi)}&date=${tokyoDayAfter(3)}&time=10:00`);
  await expect(page.getByRole("heading", { name: "选择车型" })).toBeVisible();
  const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: own.world.group.name }) });
  await expect(card).toContainText("16,500 JPY");
  await expectNoOverflow(page, "预订页（点对点，长地址，车型和价格）");
  await expectAccessibleBothThemes(page, "预订页（点对点，长地址，车型和价格）");
  await card.getByRole("button", { name: `选择 ${own.world.group.name}` }).click();
  await page.getByRole("button", { name: "下一步：填写乘客信息" }).first().click();
  await expect(page.getByRole("heading", { level: 2, name: "乘客信息" })).toBeVisible();
  await expectNoOverflow(page, "预订页（点对点，长地址，乘客信息）");
  await expectAccessibleBothThemes(page, "预订页（点对点，长地址，乘客信息）");

  // 包车单的订单页：展开「修改订单」有上车地址和下车地址（M8-19，规范 site-booking-v2.md 10.6），没有航班号
  // 包车下车地点必填（M8-15）：下车点也在商品的区域里，不加价
  const charterToken = await placeByApi(request, { category: "charter", city_id: world.city.id, pickup: POINT, dropoff: OTHER, package_hours: 8, service_local: `${tokyoDayAfter(4)}T21:00`, passengers: 2, luggage: 1 }, { pickup_address: LONG_ADDRESS, dropoff_address: "包车下车点" }, { paid: true });
  await page.goto(`/book/order#${charterToken}`);
  await expect(page.getByRole("region", { name: "行程" })).toContainText("8 小时");
  await page.getByRole("button", { name: "修改订单" }).click();
  await expect(page.getByLabel("上车地址或酒店名")).toHaveValue(LONG_ADDRESS);
  await expect(page.getByLabel("下车地址或酒店名")).toHaveValue("包车下车点");
  await expect(page.getByLabel(/^航班号/)).toHaveCount(0);
  await expectNoOverflow(page, "订单页（包车，展开修改）");
  await expectAccessibleBothThemes(page, "订单页（包车，展开修改）");

  // 点对点单的订单页：两端地址都在
  const p2pToken = await placeByApi(request, { category: "point_to_point", city_id: world.city.id, pickup: POINT, dropoff: OTHER, service_local: `${tokyoDayAfter(4)}T10:00`, passengers: 2, luggage: 1 }, { pickup_address: "东京站", dropoff_address: LONG_ADDRESS }, { paid: true });
  // 先离开订单页再打开下一张（同一页面里只换 # 后面的令牌见下面的缺陷用例）
  await page.goto("/book");
  await page.goto(`/book/order#${p2pToken}`);
  await expect(page.getByRole("region", { name: "行程" })).toContainText(`东京站 → ${LONG_ADDRESS}`);
  await expectNoOverflow(page, "订单页（点对点，长地址）");
  await page.getByRole("button", { name: "修改订单" }).click();
  await expect(page.getByLabel("上车地址或酒店名")).toHaveValue("东京站");
  await expect(page.getByLabel("下车地址或酒店名")).toHaveValue(LONG_ADDRESS);
  await expectNoOverflow(page, "订单页（点对点，展开修改）");
  await expectAccessibleBothThemes(page, "订单页（点对点，展开修改）");
});

test("缺陷：待付款的点对点 / 包车单（Stripe 没配置时官网的单都是待付款）页面给了「修改订单」，可后端只允许确认后再改——客人改了地址提交必定失败", async ({ page, request }) => {
  test.setTimeout(120_000);
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  await publishedProduct(request, supplier, world, "point_to_point", { pricing_model: "fixed", base_price: 15000 });
  const token = await placeByApi(request, { category: "point_to_point", city_id: world.city.id, pickup: POINT, dropoff: OTHER, service_local: `${tokyoDayAfter(4)}T10:00`, passengers: 2, luggage: 1 }, { pickup_address: "东京站", dropoff_address: "新宿站" });
  await page.goto(`/book/order#${token}`);
  await expect(page.getByText("待付款", { exact: true })).toBeVisible();
  const change = page.getByRole("button", { name: "修改订单" });
  if ((await change.count()) === 0) return;
  // 页面给了入口，就必须改得成
  await change.click();
  await page.getByLabel("下车地址或酒店名").fill("涩谷站八公口");
  const patched = page.waitForResponse((response) => response.url().endsWith("/site/v1/order") && response.request().method() === "PATCH");
  await page.getByRole("button", { name: "提交修改" }).click();
  const response = await patched;
  expect(response.status(), await response.text()).toBe(200);
  await expect(page.getByText("已修改。")).toBeVisible();
});

test("缺陷：同一个标签页里先打开包车单的链接、展开「修改订单」，再打开另一张点对点单的链接——页面换成了点对点单，修改表单却还开着、填的是包车单的内容", async ({ page, request }) => {
  test.setTimeout(120_000);
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  await publishedProduct(request, supplier, world, "point_to_point", { pricing_model: "fixed", base_price: 15000 });
  await publishedProduct(request, supplier, world, "charter", { pricing_model: "charter_package", package_hours: 8, package_km: 150, package_price: 70000, overtime_per_hour: 5000, over_km_per_km: 400 });
  const charterToken = await placeByApi(request, { category: "charter", city_id: world.city.id, pickup: POINT, dropoff: OTHER, package_hours: 8, service_local: `${tokyoDayAfter(4)}T21:00`, passengers: 2, luggage: 1 }, { pickup_address: "包车上车点甲", dropoff_address: "包车下车点甲" }, { paid: true });
  const p2pToken = await placeByApi(request, { category: "point_to_point", city_id: world.city.id, pickup: POINT, dropoff: OTHER, service_local: `${tokyoDayAfter(4)}T10:00`, passengers: 2, luggage: 1 }, { pickup_address: "点对点上车点乙", dropoff_address: "点对点下车点乙" }, { paid: true });

  await page.goto(`/book/order#${charterToken}`);
  await page.getByRole("button", { name: "修改订单" }).click();
  await expect(page.getByLabel("上车地址或酒店名")).toHaveValue("包车上车点甲");
  // 客人从邮件里点开另一张单的链接（同一个标签页，只有 # 后面不同）
  await page.goto(`/book/order#${p2pToken}`);
  await expect(page.getByRole("region", { name: "行程" })).toContainText("点对点上车点乙 → 点对点下车点乙");
  const pickup = page.getByLabel("上车地址或酒店名");
  if ((await pickup.count()) > 0) {
    // 表单还开着的话，至少得是这一张单的内容，否则一提交就会把上一张单的时间、地址改到这一张上
    await expect(pickup).toHaveValue("点对点上车点乙");
    await expect(page.getByLabel("下车地址或酒店名")).toHaveValue("点对点下车点乙");
    await expect(page.getByLabel("上车时间（当地）")).toHaveValue("10:00");
  }
});
