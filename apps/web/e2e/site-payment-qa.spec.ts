/**
 * M3-08 测试角色补充：官网付款的端到端安全检查（真实浏览器 + 构建好的前端 + 真实 API 和 PostgreSQL + 本机假 Stripe，从不连真实的 Stripe）。
 * - 整页跳去银行的完整流程：令牌由页面真实写入（不是测试手写），不进 Stripe 的任何请求；回来后地址换回 #令牌、Stripe 的参数不留在地址栏和历史；
 * - 两个标签页两张单交错不串；伪造别人的 payment_intent 回跳不能把别人的订单变成已付；
 * - 连点只确认一次；确认的应答丢了不会让客人再付；网络失败后再点是同一笔付款；
 * - 订单在表单开着时被取消；320 / 360 / 768 宽、亮暗 axe；只用键盘完成付款。
 */
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { E2E_WEB_STRIPE_PORT } from "../playwright.config.ts";
import { CENTER, type Supplier, type World, createProductByApi, createSupplier, createWorld, expectAccessible } from "./catalog.ts";
import { TEST_CARDS, routeStripe } from "./fake-stripe.ts";

const SITE = `http://127.0.0.1:${E2E_WEB_STRIPE_PORT}`;
const LOST = "付款结果已交给银行处理。这个页面没能自动打开您的订单，请用订单号和下单时的邮箱或手机号查找订单查看付款结果；请不要重复付款。";
const CONFIRMED = "付款成功，订单已确认。派车后这里会显示司机和车辆。";
const RULES = {
  booking: { sale_from: null, sale_to: null, service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 0, note: null },
  urgent: { enabled: false, daily_quota: null, tiers: [] },
  night: { enabled: false, window: null, amount: null, charge_unit: null },
  free_wait: { pickup: { mode: "limited", minutes: 60 }, dropoff: { mode: "limited", minutes: 60 }, general: null },
  addons: [],
  driver_languages: [],
};

function fakeStripeUrl(): string {
  const url = process.env["E2E_FAKE_STRIPE_URL"];
  if (!url) throw new Error("global-setup 没有启动假 Stripe");
  return url;
}

/** 这条用例自己的来源地址（TEST-NET-2，文档专用，不会是真实客人）：官网按来源地址限流，各用各的额度。 */
function sourceAddress(): string {
  return `198.51.100.${1 + Math.floor(Math.random() * 250)}`;
}

async function version(request: APIRequestContext, supplier: Supplier, id: string): Promise<number> {
  return ((await (await request.get(`/tenant/v1/products/${id}`, { headers: supplier.headers })).json()) as { version: number }).version;
}

/** 经供应商接口配好、上架的接送机商品：一口价 20,000 日元（官网卖 22,000），从今天起生效，全天可订。 */
async function publishedProduct(request: APIRequestContext, supplier: Supplier, world: World): Promise<void> {
  const product = await createProductByApi(request, supplier, world, "airport_transfer");
  const rules = await request.put(`/tenant/v1/products/${product.id}/service-rules`, { headers: { ...supplier.headers, "if-match": `"${product.version}"` }, data: RULES });
  expect(rules.status(), await rules.text()).toBe(200);
  const content = await request.put(`/tenant/v1/products/${product.id}/content`, { headers: { ...supplier.headers, "if-match": `"${((await rules.json()) as { version: number }).version}"` }, data: { zh: { title: "官网接送机", pickup_guide: "到达大厅 2 号出口" } } });
  expect(content.status(), await content.text()).toBe(200);
  const { today } = (await (await request.get(`/tenant/v1/products/${product.id}/price-rules`, { headers: supplier.headers })).json()) as { today: string };
  const price = await request.post(`/tenant/v1/products/${product.id}/price-rules/batch`, {
    headers: { ...supplier.headers, "if-match": `"${await version(request, supplier, product.id)}"`, "idempotency-key": crypto.randomUUID() },
    data: { create: [{ ref: "a", area_id: supplier.area.id, vehicle_group_id: world.group.id, direction: "both", package_hours: null, pricing_model: "fixed", base_price: 20000, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null, valid_from: today, valid_to: null, status: "enabled" }], update: [], delete: [] },
  });
  expect(price.status(), await price.text()).toBe(200);
  const published = await request.post(`/tenant/v1/products/${product.id}/publish`, { headers: supplier.headers });
  expect(published.status(), await published.text()).toBe(200);
}

/** 东京的「现在 + N 小时」（取整到 5 分钟）。 */
function tokyoIn(hours: number): { date: string; time: string } {
  const at = new Date(Math.ceil((Date.now() + hours * 3_600_000) / 300_000) * 300_000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at).map((part) => [part.type, part.value]));
  return { date: `${parts["year"]}-${parts["month"]}-${parts["day"]}`, time: `${parts["hour"]}:${parts["minute"]}` };
}

/** 一个有可卖接送机商品的城市。 */
async function sellableWorld(request: APIRequestContext): Promise<World> {
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  await publishedProduct(request, supplier, world);
  return world;
}

/** 经配了 Stripe 的官网接口下一张接机单（和页面同一个接口），返回查看令牌和下单应答里的付款凭据。 */
async function placeOrder(request: APIRequestContext, world: World, source: string): Promise<{ token: string; orderNo: string; clientSecret: string }> {
  const headers = { "x-forwarded-for": source };
  const when = tokyoIn(26);
  const quoted = await request.post(`${SITE}/site/v1/quotes`, { headers, data: { city_id: world.city.id, airport_id: world.airport.id, direction: "pickup", address: { lat: CENTER.lat + 0.01, lng: CENTER.lng + 0.01 }, service_local: `${when.date}T${when.time}`, passengers: 1, luggage: 0 } });
  expect(quoted.status(), await quoted.text()).toBe(200);
  const quote = ((await quoted.json()) as { quotes: { quote_id: string; vehicle_group: { id: string } }[] }).quotes.find((item) => item.vehicle_group.id === world.group.id);
  expect(quote, "报出了这个车型组的价").toBeTruthy();
  const created = await request.post(`${SITE}/site/v1/orders`, {
    headers: { ...headers, "idempotency-key": crypto.randomUUID() },
    data: { quote_id: quote?.quote_id, passenger: { name: "付款测试", phone: "+81 90-1234-5678", email: `pay-${crypto.randomUUID().slice(0, 8)}@e2e.example.com` }, flight_no: "NH211", dropoff_address: "新宿站南口", save_payment_method: true },
  });
  expect(created.status(), await created.text()).toBe(201);
  const body = (await created.json()) as { link: { token: string }; order: { order_no: string }; payment: { client_secret: string; publishable_key: string } | null };
  expect(body.payment?.publishable_key, "配了 Stripe：下单应答里有付款凭据").toMatch(/^pk_test_/);
  return { token: body.link.token, orderNo: body.order.order_no, clientSecret: body.payment?.client_secret ?? "" };
}


const cardField = (page: Page) => page.getByLabel("卡号（假 Stripe）");
const paymentSection = (page: Page) => page.getByRole("region", { name: "付款", exact: true });
const intentOf = (clientSecret: string): string => clientSecret.split("_secret_")[0] ?? "";
const returnUrl = (clientSecret: string, status = "succeeded"): string => `${SITE}/book/order?payment_intent=${intentOf(clientSecret)}&payment_intent_client_secret=${clientSecret}&redirect_status=${status}`;
const stored = (page: Page): Promise<string | null> => page.evaluate(() => sessionStorage.getItem("nozomi.payment-return"));

async function orderStatus(request: APIRequestContext, token: string, source: string): Promise<string> {
  const response = await request.get(`${SITE}/site/v1/order`, { headers: { authorization: `Bearer ${token}`, "x-forwarded-for": source } });
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { order: { status: string } }).order.status;
}

async function openOrder(page: Page, source: string, token: string): Promise<Awaited<ReturnType<typeof routeStripe>>> {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": source });
  const routed = await routeStripe(page, fakeStripeUrl());
  await page.goto(`${SITE}/book/order#${token}`);
  await expect(cardField(page)).toBeVisible();
  return routed;
}

/** 走到「被带去银行」的那一刻：3D 卡的验证框开着，确认付款还没有结果，令牌由页面自己记下。 */
async function toBank(page: Page): Promise<void> {
  await cardField(page).fill(TEST_CARDS.threeDs);
  await page.getByRole("button", { name: "付款 22,000 JPY" }).click();
  await page.getByRole("button", { name: "确认支付" }).click();
  await expect(page.locator('iframe[title="银行验证（假）"]')).toBeVisible();
}

const confirms = (seen: string[]): string[] => seen.filter((entry) => entry.endsWith("/confirm"));

test("整页跳去银行再回来：令牌由页面记下、不进 Stripe 的任何请求；回来后换回 #令牌并删掉记录，Stripe 的参数不留在地址栏、历史和页面里", async ({ page, request }) => {
  test.setTimeout(90_000);
  const world = await sellableWorld(request);
  const source = sourceAddress();
  const placed = await placeOrder(request, world, source);
  const sent: { url: string; body: string; headers: Record<string, string> }[] = [];
  page.on("request", (item) => sent.push({ url: item.url(), body: item.postData() ?? "", headers: item.headers() }));
  await openOrder(page, source, placed.token);
  expect(await stored(page), "打开页面时不记").toBeNull();
  await toBank(page);
  const saved = JSON.parse((await stored(page)) ?? "{}") as { intentId?: string; token?: string };
  expect(saved.intentId).toBe(intentOf(placed.clientSecret));
  expect(saved.token).toBe(placed.token);
  expect(await page.evaluate(() => localStorage.getItem("nozomi.payment-return")), "不进 localStorage").toBeNull();
  expect(await page.evaluate(() => (window as unknown as { __fakeStripe: { returnUrl: string } }).__fakeStripe.returnUrl)).toBe(`${SITE}/book/order`);

  await page.goto(returnUrl(placed.clientSecret));
  await expect(page.getByRole("heading", { level: 1, name: `订单 ${placed.orderNo}` })).toBeVisible();
  expect(page.url()).toBe(`${SITE}/book/order#${placed.token}`);
  expect(await stored(page), "取回后删掉").toBeNull();
  expect(await page.evaluate(() => document.documentElement.outerHTML.includes("payment_intent_client_secret"))).toBe(false);

  // 历史：后退回到付款前的订单页，再前进回到 #令牌，都碰不到带 client_secret 的地址
  await page.goBack();
  expect(page.url()).not.toContain("payment_intent");
  await page.goForward();
  expect(page.url()).toBe(`${SITE}/book/order#${placed.token}`);

  for (const item of sent) {
    const url = new URL(item.url);
    expect(item.url, "令牌进了网址").not.toContain(placed.token);
    if (url.origin !== SITE) {
      expect(item.body, `令牌进了 ${url.origin} 的请求体`).not.toContain(placed.token);
      expect(JSON.stringify(item.headers), `令牌进了 ${url.origin} 的请求头`).not.toContain(placed.token);
    }
  }
});

test("两个标签页两张单交错：各回各的订单；A 的回跳开到 B 的标签页取不回令牌，去「查订单」，B 的记录也被清掉", async ({ page, context, request }) => {
  test.setTimeout(120_000);
  const world = await sellableWorld(request);
  const source = sourceAddress();
  const a = await placeOrder(request, world, source);
  const b = await placeOrder(request, world, source);
  const tabB = await context.newPage();
  await openOrder(page, source, a.token);
  await openOrder(tabB, source, b.token);
  await toBank(page);
  await toBank(tabB);
  expect(JSON.parse((await stored(page)) ?? "{}").token, "标签页 A 只有 A 的令牌").toBe(a.token);
  expect(JSON.parse((await stored(tabB)) ?? "{}").token, "标签页 B 只有 B 的令牌").toBe(b.token);

  await page.goto(returnUrl(a.clientSecret));
  await expect(page.getByRole("heading", { level: 1, name: `订单 ${a.orderNo}` })).toBeVisible();
  expect(new URL(page.url()).hash).toBe(`#${a.token}`);

  await tabB.goto(returnUrl(a.clientSecret));
  await expect(tabB.getByText(LOST)).toBeVisible();
  expect(tabB.url()).toBe(`${SITE}/book/order`);
  expect(await stored(tabB)).toBeNull();
  await tabB.close();
});

test("伪造回跳：拿别人的 payment_intent 和 redirect_status=succeeded 打开，不能把别人的订单标成已付，页面没有任何写操作，也打不开别人的订单", async ({ page, request }) => {
  test.setTimeout(90_000);
  const world = await sellableWorld(request);
  const source = sourceAddress();
  const victim = await placeOrder(request, world, source);
  const attacker = await placeOrder(request, world, source);
  await page.setExtraHTTPHeaders({ "x-forwarded-for": source });
  await routeStripe(page, fakeStripeUrl());
  await page.goto(`${SITE}/book`);
  // 攻击者自己的标签页里记着自己的令牌，地址上写别人的编号；反过来把存储里的编号改成别人的、令牌写自己的也一样打不开别人的订单
  await page.evaluate(({ id, token }) => sessionStorage.setItem("nozomi.payment-return", JSON.stringify({ intentId: id, token, at: Date.now() })), { id: intentOf(attacker.clientSecret), token: attacker.token });
  const writes: string[] = [];
  page.on("request", (item) => {
    if (item.method() !== "GET" && new URL(item.url()).origin === SITE) writes.push(item.url());
  });
  await page.goto(returnUrl(victim.clientSecret));
  await expect(page.getByText(LOST)).toBeVisible();
  await expect(page.getByText(victim.orderNo)).toHaveCount(0);
  expect(writes).toEqual([]);
  expect(await orderStatus(request, victim.token, source), "别人的订单还是待付款").toBe("pending_payment");
});

test("重复付款：确认按钮双击只发一次确认请求；订单只确认一次，之后刷新不再有表单", async ({ page, request }) => {
  test.setTimeout(90_000);
  const world = await sellableWorld(request);
  const source = sourceAddress();
  const placed = await placeOrder(request, world, source);
  const routed = await openOrder(page, source, placed.token);
  await cardField(page).fill(TEST_CARDS.success);
  await page.getByRole("button", { name: "付款 22,000 JPY" }).click();
  await page.getByRole("button", { name: "确认支付" }).dblclick();
  await expect(page.getByText(CONFIRMED)).toBeVisible({ timeout: 20_000 });
  expect(confirms(routed.seen)).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: `订单 ${placed.orderNo}` })).toBeVisible();
  await expect(cardField(page)).toHaveCount(0);
  await expect(paymentSection(page)).toHaveCount(0);
  await expect(page.getByText(CONFIRMED), "刷新后不再说这句").toHaveCount(0);
});

test("重复付款：确认请求到了 Stripe 但应答丢了（已经扣款）：再查一次按已付算，不让客人再点；通知到了订单确认", async ({ page, request }) => {
  test.setTimeout(90_000);
  const world = await sellableWorld(request);
  const source = sourceAddress();
  const placed = await placeOrder(request, world, source);
  await openOrder(page, source, placed.token);
  let lost = 0;
  await page.route(/api\.stripe\.com\/v1\/payment_intents\/[^/]+\/confirm/, async (route) => {
    lost += 1;
    const url = new URL(route.request().url());
    await route.fetch({ url: `${fakeStripeUrl()}${url.pathname}` });
    await route.abort("connectionreset");
  });
  await cardField(page).fill(TEST_CARDS.success);
  await page.getByRole("button", { name: "付款 22,000 JPY" }).click();
  await page.getByRole("button", { name: "确认支付" }).click();
  await expect(paymentSection(page).getByRole("status")).toContainText("付款成功，等待确认。");
  await expect(cardField(page)).toHaveCount(0);
  await expect(page.getByText(CONFIRMED)).toBeVisible({ timeout: 20_000 });
  expect(lost).toBe(1);
});

test("重复付款：确认请求没发出去（网络断了）后再点，还是同一笔付款；令牌记录已删；成功后确认", async ({ page, request }) => {
  test.setTimeout(90_000);
  const world = await sellableWorld(request);
  const source = sourceAddress();
  const placed = await placeOrder(request, world, source);
  const routed = await openOrder(page, source, placed.token);
  const intents: string[] = [];
  let failures = 1;
  await page.route(/api\.stripe\.com\/v1\/payment_intents\/[^/]+\/confirm/, async (route) => {
    intents.push(new URL(route.request().url()).pathname);
    if (failures > 0) {
      failures -= 1;
      return route.abort("internetdisconnected");
    }
    return route.fallback();
  });
  await cardField(page).fill(TEST_CARDS.success);
  await page.getByRole("button", { name: "付款 22,000 JPY" }).click();
  await page.getByRole("button", { name: "确认支付" }).click();
  await expect(paymentSection(page).getByRole("alert")).toContainText("没有连上 Stripe，这次付款可能没有提交。");
  expect(await stored(page)).toBeNull();
  await expect(cardField(page)).toBeVisible();
  await page.getByRole("button", { name: "付款 22,000 JPY" }).click();
  await page.getByRole("button", { name: "确认支付" }).click();
  await expect(page.getByText(CONFIRMED)).toBeVisible({ timeout: 20_000 });
  expect(intents).toHaveLength(2);
  expect(new Set(intents).size, "两次都是同一笔付款").toBe(1);
  expect(intents[0]).toContain(intentOf(placed.clientSecret));
  expect(routed.unexpected).toEqual([]);
});

test("订单在付款表单开着时被取消：付款被后端取消，再点确认不能扣款；不再显示表单，页面说明不能付了", async ({ page, request }) => {
  test.setTimeout(90_000);
  const world = await sellableWorld(request);
  const source = sourceAddress();
  const placed = await placeOrder(request, world, source);
  await openOrder(page, source, placed.token);
  const cancelled = await request.post(`${SITE}/site/v1/order/cancel`, { headers: { authorization: `Bearer ${placed.token}`, "x-forwarded-for": source }, data: { reason: "GUEST_REQUEST" } });
  expect(cancelled.status(), await cancelled.text()).toBe(200);
  await cardField(page).fill(TEST_CARDS.success);
  await page.getByRole("button", { name: "付款 22,000 JPY" }).click();
  await page.getByRole("button", { name: "确认支付" }).click();
  // 先等确认有了结果（否则下面「没有付款成功」的断言可能在结果出来之前就通过）
  await expect(paymentSection(page).getByRole("alert")).not.toBeEmpty();
  await expect(page.getByText(/付款成功/), "取消后不能扣款").toHaveCount(0);
  expect(await orderStatus(request, placed.token, source)).toBe("cancelled");
  await expect(cardField(page), "不再显示表单").toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByRole("button", { name: "付款 22,000 JPY" })).toHaveCount(0);
});

test("320 / 360 / 768 宽不横向滚动，亮暗 axe：付款表单、确认框、失败提示；从银行回来却取不回令牌的「查订单」", async ({ page, request }) => {
  test.setTimeout(120_000);
  const world = await sellableWorld(request);
  const source = sourceAddress();
  const placed = await placeOrder(request, world, source);
  await openOrder(page, source, placed.token);
  const check = async (what: string): Promise<void> => {
    for (const width of [320, 360, 768]) {
      await page.setViewportSize({ width, height: 800 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${what}：${width}px 宽横向溢出`).toBe(0);
    }
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await expectAccessible(page, `${what}（${colorScheme}）`);
    }
    await page.emulateMedia({ colorScheme: "light" });
  };
  await check("付款表单");
  await cardField(page).fill(TEST_CARDS.declined);
  await page.getByRole("button", { name: "付款 22,000 JPY" }).click();
  await expect(page.getByRole("group", { name: "确认付款" })).toBeVisible();
  await check("确认框");
  await page.getByRole("button", { name: "确认支付" }).click();
  await expect(paymentSection(page).getByRole("alert")).toContainText("付款没有成功");
  await check("失败提示");
  await page.goto(returnUrl(placed.clientSecret));
  await expect(page.getByText(LOST)).toBeVisible();
  await check("取不回令牌");
});

test("只用键盘完成付款：Tab 到卡号填写 → Tab 到「付款」回车 → 确认框里 Tab 顺序是「确认支付」→「返回」，回车付款 → 已确认", async ({ page, request }) => {
  test.setTimeout(90_000);
  const world = await sellableWorld(request);
  const source = sourceAddress();
  const placed = await placeOrder(request, world, source);
  await openOrder(page, source, placed.token);
  const focused = (): Promise<string> => page.evaluate(() => (document.activeElement?.tagName === "BUTTON" ? document.activeElement.textContent?.trim() ?? "" : document.activeElement?.tagName ?? ""));
  const tabTo = async (expected: string, limit: number): Promise<void> => {
    for (let count = 0; count < limit; count += 1) {
      await page.keyboard.press("Tab");
      if ((await focused()) === expected) return;
    }
    throw new Error(`按 ${limit} 次 Tab 没到「${expected}」，现在在「${await focused()}」`);
  };
  await cardField(page).focus();
  await page.keyboard.type(TEST_CARDS.success.replace(/\s/g, ""));
  await tabTo("付款 22,000 JPY", 4);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("group", { name: "确认付款" })).toBeVisible();
  // 「付款」按钮被确认框换掉：焦点不能掉回页面开头，下一个 Tab 就要到「确认支付」
  await tabTo("确认支付", 1);
  await page.keyboard.press("Tab");
  expect(await focused()).toBe("返回");
  await page.keyboard.press("Shift+Tab");
  expect(await focused()).toBe("确认支付");
  await page.keyboard.press("Enter");
  await expect(page.getByText(CONFIRMED)).toBeVisible({ timeout: 20_000 });
});
