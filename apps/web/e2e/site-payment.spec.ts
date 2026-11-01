/**
 * 端到端：官网付款（M3-08，ADR 0046）。真实浏览器 → 构建好的前端（和正式环境同一条内容安全策略）→ 配了 Stripe 测试密钥的真实 API → 真实 PostgreSQL；
 * Stripe 是本机的假 Stripe（e2e/fake-stripe.ts）：后端经 STRIPE_API_URL 调它，浏览器里的 Stripe.js 也从 js.stripe.com 这个地址加载（网络层换成假脚本），
 * 付款有结果后它给后端发签了名的通知，订单由后端照常自动确认。测试从不访问真实的 Stripe，也没有任何真实密钥。
 *
 * - 下单 → 订单页的 Stripe 表单 → 卡号不完整 → 测试卡 4242 付款 → 「付款成功，等待确认」→ 通知到了自动变成已确认；
 *   全程内容安全策略一样都没拦下，只请求本站和 Stripe 的三个域名，令牌不进 Stripe 的任何请求、不进 return_url；400 / 320 宽不横向滚动，亮暗两色过 axe；
 * - 3D 验证卡：弹出 hooks.stripe.com 的验证框，验证失败显示原因、能再付；验证通过 → 已确认；
 * - 失败卡（被拒、余额不足）显示 Stripe 给的原因，表单留着；Stripe.js 加载不出来时能重新加载；换 4242 付款成功；
 * - 从银行页面回来（/book/order?payment_intent=…）：按付款编号从本标签页取回令牌，地址换回 #令牌、去掉 Stripe 的参数，「后退」也回不到带 client_secret 的地址。
 * 每条用例用一个文档专用的来源地址（这组 API 信任一层代理），官网的限流额度不和别的用例抢。
 */
import { type APIRequestContext, type Page, type Request, expect, test } from "@playwright/test";
import { E2E_WEB_STRIPE_PORT } from "../playwright.config.ts";
import { CENTER, type Supplier, type World, createProductByApi, createSupplier, createWorld, expectAccessible } from "./catalog.ts";
import { FAKE_STRIPE_MESSAGES, TEST_CARDS, routeStripe } from "./fake-stripe.ts";

const SITE = `http://127.0.0.1:${E2E_WEB_STRIPE_PORT}`;
const STRIPE_ORIGINS = ["https://js.stripe.com", "https://api.stripe.com", "https://hooks.stripe.com"];
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

/** 记下页面被内容安全策略拦下的每一样东西（监听由 Playwright 注入，不受页面策略约束）。 */
async function watchCsp(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const blocked: string[] = [];
    (window as unknown as { __cspBlocked: string[] }).__cspBlocked = blocked;
    document.addEventListener("securitypolicyviolation", (event) => blocked.push(`${event.violatedDirective} ${event.blockedURI}`));
  });
  return () => page.evaluate(() => (window as unknown as { __cspBlocked?: string[] }).__cspBlocked ?? []);
}

async function preparePage(page: Page, source: string): Promise<{ routed: Awaited<ReturnType<typeof routeStripe>>; cspBlocked: () => Promise<string[]>; requests: Request[] }> {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": source });
  const cspBlocked = await watchCsp(page);
  const routed = await routeStripe(page, fakeStripeUrl());
  const requests: Request[] = [];
  page.on("request", (request) => requests.push(request));
  return { routed, cspBlocked, requests };
}

const cardField = (page: Page) => page.getByLabel("卡号（假 Stripe）");
const paymentSection = (page: Page) => page.getByRole("region", { name: "付款", exact: true });

async function pay(page: Page, card: string): Promise<void> {
  await cardField(page).fill(card);
  await page.getByRole("button", { name: "付款 22,000 JPY" }).click();
  await expect(page.getByRole("group", { name: "确认付款" })).toBeVisible();
  await page.getByRole("button", { name: "确认支付" }).click();
}

async function expectNoOverflow(page: Page, what: string): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  for (const size of [{ width: 320, height: 640 }, { width: 400, height: 800 }]) {
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

test("官网下单后用 Stripe 付款（测试卡 4242）：付款成功等待确认 → Stripe 的通知到了自动显示已确认；策略一样都没拦下，只去本站和 Stripe，令牌不进 Stripe 的请求", async ({ page, request }) => {
  test.setTimeout(120_000);
  const world = await sellableWorld(request);
  const source = sourceAddress();
  const { routed, cspBlocked, requests } = await preparePage(page, source);
  const when = tokyoIn(26);
  await page.setViewportSize({ width: 400, height: 800 });

  // 询价 → 选车 → 下单（和没配 Stripe 时同一套页面）
  const response = await page.goto(`${SITE}/book`);
  expect(response?.headers()["content-security-policy"], "官网页面的策略放行 Stripe").toContain("frame-src https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com");
  await page.getByLabel(/^城市/).selectOption({ label: world.city.name });
  await expect(page.getByLabel(/^机场/)).toHaveValue(world.airport.id);
  await page.getByLabel("下车地址或酒店名").fill("新宿站南口");
  await page.getByLabel(/^纬度/).fill(String(CENTER.lat + 0.01));
  await page.getByLabel(/^经度/).fill(String(CENTER.lng + 0.01));
  await page.getByLabel("航班到达日期（当地）").fill(when.date);
  await page.getByLabel("航班计划到达时间（当地）").fill(when.time);
  await page.getByRole("button", { name: "查询价格" }).click();
  const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: world.group.name }) });
  await card.getByRole("button", { name: `预订${world.group.name}` }).click();
  await page.getByLabel("乘车人姓名").fill("王小明");
  await page.getByLabel("手机号（带国家码）").fill("+81 90-1234-5678");
  await page.getByLabel("邮箱").fill(`pay-${crypto.randomUUID().slice(0, 8)}@e2e.example.com`);
  await page.getByLabel("航班号").fill("NH 211");
  await page.getByRole("checkbox", { name: /同意保存/ }).check();
  await page.getByRole("button", { name: /提交订单/ }).click();

  // 订单页：待付款，付款区块排第一，Stripe 的表单挂上了
  await expect(page.getByRole("heading", { level: 1, name: /^订单 NZ/ })).toBeVisible();
  const token = new URL(page.url()).hash.slice(1);
  expect(token).toMatch(/^nzo_/);
  await expect(cardField(page)).toBeVisible();
  await expect(paymentSection(page)).toContainText("付款信息由 Stripe 处理，本站不保存卡号。");
  await expect(page.getByText(/付款暂未开放/)).toHaveCount(0);
  const stripeSeen = await page.evaluate(() => (window as unknown as { __fakeStripe: { publishableKey: string; locale: string } }).__fakeStripe);
  expect(stripeSeen.publishableKey, "用后端给的 publishable key").toMatch(/^pk_test_e2e/);
  expect(stripeSeen.locale).toBe("zh");
  await expectNoOverflow(page, "订单页（付款表单）");
  await expectAccessibleBothThemes(page, "订单页（付款表单）");

  // 卡号没填完：Stripe 的校验原话，不出确认框
  await cardField(page).fill("4242 4242");
  await page.getByRole("button", { name: "付款 22,000 JPY" }).click();
  await expect(paymentSection(page).getByRole("alert")).toContainText(FAKE_STRIPE_MESSAGES.incomplete);
  await expect(page.getByRole("group", { name: "确认付款" })).toHaveCount(0);

  // 测试卡 4242：页面内确认 → 付款成功，等待确认 → 通知到了 → 已确认
  await pay(page, TEST_CARDS.success);
  await expect(paymentSection(page).getByRole("status")).toContainText("付款成功，等待确认。");
  await expect(cardField(page)).toHaveCount(0);
  await expectAccessibleBothThemes(page, "订单页（付款成功，等待确认）");
  await expect(page.getByText("付款成功，订单已确认。派车后这里会显示司机和车辆。")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("已确认", { exact: true })).toBeVisible();
  await expect(paymentSection(page)).toHaveCount(0);
  await expectNoOverflow(page, "订单页（已确认）");

  // 令牌的去向：return_url 是订单页本身（不带令牌）；令牌只在本站 /site/v1 的请求头里，不进任何网址、不进 Stripe 的请求；付完没有留在存储里
  const returnUrl = await page.evaluate(() => (window as unknown as { __fakeStripe: { returnUrl: string } }).__fakeStripe.returnUrl);
  expect(returnUrl).toBe(`${SITE}/book/order`);
  expect(await page.evaluate(() => sessionStorage.length), "确认付款有了结果就删掉临时记下的令牌").toBe(0);
  expect(await cspBlocked(), "内容安全策略拦下了东西").toEqual([]);
  expect(routed.unexpected, "请求了 Stripe 的其他域名").toEqual([]);
  expect(routed.seen).toEqual(expect.arrayContaining(["GET https://js.stripe.com/v3/", "GET https://js.stripe.com/v3/elements-inner.html", "POST https://api.stripe.com/v1/payment_intents/" + returnUrlIntent(routed.seen) + "/confirm"]));
  for (const sent of requests) {
    const url = new URL(sent.url());
    expect([SITE, ...STRIPE_ORIGINS], `请求了站外地址 ${url.origin}`).toContain(url.origin);
    expect(sent.url(), "令牌进了网址").not.toContain(token);
    if (url.origin !== SITE) {
      expect(sent.postData() ?? "", "令牌进了 Stripe 的请求").not.toContain(token);
      expect(sent.headers()["authorization"], "本站的令牌发给了 Stripe").toBeUndefined();
    }
    const authorization = sent.headers()["authorization"];
    if (authorization !== undefined) expect(url.pathname, "令牌只发给官网的订单接口").toMatch(/^\/site\/v1\/order/);
  }
});

/** 从记下的请求里取出付款编号（确认付款那一次的地址）。 */
function returnUrlIntent(seen: string[]): string {
  return /payment_intents\/(pi_[A-Za-z0-9]+)\/confirm/.exec(seen.find((entry) => entry.endsWith("/confirm")) ?? "")?.[1] ?? "（没有确认付款）";
}

test("3D 验证卡：弹出银行的验证框（hooks.stripe.com），验证失败显示原因、表单留着；再付一次验证通过 → 等待确认 → 已确认", async ({ page, request }) => {
  test.setTimeout(90_000);
  const world = await sellableWorld(request);
  const source = sourceAddress();
  const placed = await placeOrder(request, world, source);
  const { routed, cspBlocked } = await preparePage(page, source);
  await page.goto(`${SITE}/book/order#${placed.token}`);
  await expect(cardField(page)).toBeVisible();

  await pay(page, TEST_CARDS.threeDs);
  const bank = page.frameLocator('iframe[title="银行验证（假）"]');
  await expect(bank.getByRole("heading", { name: "银行验证（假 Stripe）" })).toBeVisible();
  // 验证框开着的时候：页面上的按钮在忙
  await expect(page.getByRole("button", { name: /正在付款/ })).toBeVisible();
  await bank.getByRole("button", { name: "验证失败" }).click();
  await expect(paymentSection(page).getByRole("alert")).toContainText(`付款没有成功：${FAKE_STRIPE_MESSAGES.authenticationFailed}请换一张卡，或检查后再付。`);
  await expect(page.locator('iframe[title="银行验证（假）"]')).toHaveCount(0);
  await expect(cardField(page)).toBeVisible();
  await expectAccessibleBothThemes(page, "订单页（验证没通过）");

  await pay(page, TEST_CARDS.threeDs);
  await bank.getByRole("button", { name: "完成验证" }).click();
  await expect(paymentSection(page).getByRole("status")).toContainText("付款成功，等待确认。");
  await expect(page.getByText("付款成功，订单已确认。派车后这里会显示司机和车辆。")).toBeVisible({ timeout: 20_000 });
  expect(routed.seen.some((entry) => entry.startsWith("GET https://hooks.stripe.com/3d_secure/")), "验证框来自 hooks.stripe.com").toBe(true);
  expect(await cspBlocked()).toEqual([]);
  expect(routed.unexpected).toEqual([]);
});

test("失败卡：Stripe.js 加载不出来时能重新加载；被拒、余额不足显示 Stripe 给的原因，表单留着；换 4242 付款成功", async ({ page, request }) => {
  test.setTimeout(90_000);
  const world = await sellableWorld(request);
  const source = sourceAddress();
  const placed = await placeOrder(request, world, source);
  await page.setExtraHTTPHeaders({ "x-forwarded-for": source });
  const cspBlocked = await watchCsp(page);

  // Stripe.js 加载不出来（网络不通）
  await routeStripe(page, fakeStripeUrl(), { stripeJs: "fail" });
  await page.goto(`${SITE}/book/order#${placed.token}`);
  await expect(paymentSection(page).getByRole("alert")).toContainText("付款组件没有加载出来，请检查网络后点「重新加载」。");
  await expectAccessibleBothThemes(page, "订单页（付款组件没加载出来）");
  await page.unrouteAll({ behavior: "wait" });
  const routed = await routeStripe(page, fakeStripeUrl());
  await page.getByRole("button", { name: "重新加载" }).click();
  await expect(cardField(page)).toBeVisible();
  await expect(paymentSection(page).getByRole("alert")).toBeEmpty();

  await pay(page, TEST_CARDS.declined);
  await expect(paymentSection(page).getByRole("alert")).toContainText(`付款没有成功：${FAKE_STRIPE_MESSAGES.declined}请换一张卡，或检查后再付。`);
  await expect(cardField(page)).toBeVisible();
  await pay(page, TEST_CARDS.insufficientFunds);
  await expect(paymentSection(page).getByRole("alert")).toContainText(`付款没有成功：${FAKE_STRIPE_MESSAGES.insufficientFunds}`);
  await expectNoOverflow(page, "订单页（卡被拒）");
  await expectAccessibleBothThemes(page, "订单页（卡被拒）");

  // 刷新：Stripe 说上次没付成，原因还在
  await page.reload();
  await expect(paymentSection(page).getByRole("alert")).toContainText(`上次付款没有成功：${FAKE_STRIPE_MESSAGES.insufficientFunds}`);

  await pay(page, TEST_CARDS.success);
  await expect(page.getByText("付款成功，订单已确认。派车后这里会显示司机和车辆。")).toBeVisible({ timeout: 20_000 });
  expect(await cspBlocked()).toEqual([]);
  expect(routed.unexpected).toEqual([]);
});

test("从银行页面回来（/book/order?payment_intent=…）：按付款编号从本标签页取回令牌并删掉，地址换回 #令牌、去掉 Stripe 的参数，「后退」也回不到带 client_secret 的地址；取不回时去「查订单」", async ({ page, request }) => {
  test.setTimeout(90_000);
  const world = await sellableWorld(request);
  const source = sourceAddress();
  const placed = await placeOrder(request, world, source);
  const { requests } = await preparePage(page, source);
  const intentId = placed.clientSecret.split("_secret_")[0] ?? "";
  const returnTo = `${SITE}/book/order?payment_intent=${intentId}&payment_intent_client_secret=${placed.clientSecret}&redirect_status=succeeded`;

  // 订单页确认付款前会把令牌记在本标签页（payment-return.ts 的同一个键和格式）；Stripe 把整页带去银行后回到 return_url
  await page.goto(`${SITE}/book`);
  await page.evaluate(({ id, token }) => sessionStorage.setItem("nozomi.payment-return", JSON.stringify({ intentId: id, token, at: Date.now() })), { id: intentId, token: placed.token });
  await page.goto(returnTo);
  await expect(page.getByRole("heading", { level: 1, name: `订单 ${placed.orderNo}` })).toBeVisible();
  expect(page.url()).toBe(`${SITE}/book/order#${placed.token}`);
  await expect(cardField(page)).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.length), "取回后删掉").toBe(0);
  await page.goBack();
  expect(page.url(), "后退回不到带 client_secret 的地址").not.toContain("payment_intent_client_secret");
  for (const sent of requests) {
    if (new URL(sent.url()).pathname.startsWith("/site/v1/")) expect(sent.url(), "Stripe 加在地址上的参数没有发给本站的接口").not.toContain(placed.clientSecret);
  }

  // 换了个标签页（存储里没有）：去「查订单」，说付款结果交给银行了、别重复付款
  const other = await page.context().newPage();
  await other.setExtraHTTPHeaders({ "x-forwarded-for": source });
  await routeStripe(other, fakeStripeUrl());
  await other.goto(returnTo);
  await expect(other.getByRole("heading", { level: 1, name: "查订单" })).toBeVisible();
  await expect(other.getByText("付款结果已交给银行处理。这个页面没能自动打开您的订单，请用订单号和下单时的邮箱或手机号查找订单查看付款结果；请不要重复付款。")).toBeVisible();
  expect(other.url()).toBe(`${SITE}/book/order`);
  await expectAccessibleBothThemes(other, "查订单（从银行页面回来却取不回订单）");
  await other.close();
});
