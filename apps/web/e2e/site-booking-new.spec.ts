/**
 * 端到端：新预订页 `/book/new`（M8-03，ADR 0069 A3、修正版 v2）。真实浏览器 → 前端 → 真实 API（`/site/v1`）→ 真实 PostgreSQL，不 mock 接口；
 * 谷歌是 global-setup 起的本机假服务器（假 Autocomplete 对任何关键字都给「東京駅」，假 Place Details 给它的坐标），**从不调用真实的谷歌**。
 * 用地址搜索专用的那组 API 和前端（配置里有假密钥，见 playwright.config.ts 的 E2E_API_PLACES_PORT）。
 *
 * 平台经接口新建一个本用例专用的机场（坐标随机落在城市中心附近，不和别的用例的机场重叠，按两个坐标报价才认得出是它），
 * 供应商上架这个机场的接送机商品（一口价 20,000 日元，接机免费等待 60 分钟）。客人：
 * - 手机宽：出发地输入机场名 → 平台的机场在候选最前 → 选中；目的地输入「東京駅」→ 谷歌候选 → 选中（取坐标）→ 日期时间 →
 *   自动报价、认出接机（时间标签、免费等待 60 分钟的提示、航班号）→「查看车型和价格」→ 第 2 步车型卡、选中后展开座位示意图、一口价包含、底部固定条；
 * - 电脑宽：单页两栏、右侧栏有所选车型的一口价；
 * - 带参数的链接（from 机场编码、to 坐标加名称、日期、时间、人数、行李）打开就报价。
 * 每一步 320 / 360 / 400 宽不横向滚动，亮暗两色 axe；浏览器只连本站。
 */
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { E2E_WEB_PLACES_PORT } from "../playwright.config.ts";
import { CENTER, type Ref, type Supplier, type World, createProductByApi, createSupplier, createWorld, expectAccessible, post } from "./catalog.ts";
import { platformAdminHeaders, randomLetters } from "./support.ts";

const SITE = `http://127.0.0.1:${E2E_WEB_PLACES_PORT}`;
const RULES = {
  booking: { sale_from: null, sale_to: null, service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 0, note: null },
  urgent: { enabled: false, daily_quota: null, tiers: [] },
  night: { enabled: false, window: null, amount: null, charge_unit: null },
  free_wait: { pickup: { mode: "limited", minutes: 60 }, dropoff: { mode: "limited", minutes: 15 }, general: null },
  addons: [],
  driver_languages: [],
};
const EMPTY_PRICE = { package_hours: null, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null };
/** 东京站：假 Place Details 给的坐标（在供应商的区域里，离本用例的机场十几公里） */
const TOKYO_STATION = { lat: 35.6812, lng: 139.7671 };

/** 本用例自己的机场：城市中心西南 4–6 公里的随机一点（别的用例的机场在中心东南约 14 公里，不会在 3 公里内撞上）。 */
async function createAirport(request: APIRequestContext, world: World): Promise<Ref & { location: { lat: number; lng: number } }> {
  const headers = await platformAdminHeaders(request);
  const tag = randomLetters(5);
  const location = { lat: Number((CENTER.lat - 0.04 - Math.random() * 0.02).toFixed(6)), lng: Number((CENTER.lng - 0.04 - Math.random() * 0.02).toFixed(6)) };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = `Y${randomLetters(2)}`;
    const response = await request.post("/platform/v1/master/places", { headers, data: { type: "airport", code, city_id: world.city.id, name: { zh: `新预订机场${tag}` }, location, flight_scope: "mixed" } });
    if (response.status() === 201) return { id: ((await response.json()) as { id: string }).id, code, name: `新预订机场${tag}`, location };
    expect(response.status(), `新建机场：${await response.text()}`).toBe(409);
  }
  throw new Error("没有建出机场");
}

async function publishTransfer(request: APIRequestContext, supplier: Supplier, world: World): Promise<void> {
  const product = await createProductByApi(request, supplier, world, "airport_transfer");
  const rules = await request.put(`/tenant/v1/products/${product.id}/service-rules`, { headers: { ...supplier.headers, "if-match": `"${product.version}"` }, data: RULES });
  expect(rules.status(), await rules.text()).toBe(200);
  const content = await request.put(`/tenant/v1/products/${product.id}/content`, { headers: { ...supplier.headers, "if-match": `"${((await rules.json()) as { version: number }).version}"` }, data: { zh: { title: "新预订页接送机" } } });
  expect(content.status(), await content.text()).toBe(200);
  const { today } = (await (await request.get(`/tenant/v1/products/${product.id}/price-rules`, { headers: supplier.headers })).json()) as { today: string };
  const version = ((await (await request.get(`/tenant/v1/products/${product.id}`, { headers: supplier.headers })).json()) as { version: number }).version;
  await post(
    request,
    { ...supplier.headers, "if-match": `"${version}"`, "idempotency-key": crypto.randomUUID() },
    `/tenant/v1/products/${product.id}/price-rules/batch`,
    { create: [{ ...EMPTY_PRICE, ref: "a", area_id: supplier.area.id, vehicle_group_id: world.group.id, direction: "both", pricing_model: "fixed", base_price: 20000, valid_from: today, valid_to: null, status: "enabled" }], update: [], delete: [] },
    "价格规则",
  );
  const published = await request.post(`/tenant/v1/products/${product.id}/publish`, { headers: supplier.headers });
  expect(published.status(), await published.text()).toBe(200);
}

function tomorrowInTokyo(): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(Date.now() + 24 * 3_600_000)).map((part) => [part.type, part.value]));
  return `${parts["year"]}-${parts["month"]}-${parts["day"]}`;
}

/** 320 / 360 / 400 不横向滚动（都是手机分步，不跨过 1024），亮暗两色 axe。 */
async function expectNarrowAndAccessible(page: Page, what: string): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 400, height: 800 };
  for (const size of [{ width: 320, height: 640 }, { width: 360, height: 740 }, { width: 400, height: 800 }]) {
    await page.setViewportSize(size);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${what}：${size.width}px 宽横向溢出`).toBe(0);
  }
  await page.setViewportSize(viewport);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${what}（${scheme === "light" ? "亮色" : "暗色"}）`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

test("新预订页：输入即提示选机场和酒店 → 自动报价、认出接机 → 选车型展开座位示意图；电脑单页；带参数的链接打开就报价；窄屏、亮暗 axe；浏览器只连本站", async ({ page, request }) => {
  test.setTimeout(150_000);
  const world = await createWorld(request);
  const airport = await createAirport(request, world);
  const supplier = await createSupplier(request, world);
  await publishTransfer(request, supplier, { ...world, airport });
  const origins = new Set<string>();
  page.on("request", (sent) => origins.add(new URL(sent.url()).origin));
  await page.setViewportSize({ width: 400, height: 800 });

  await page.goto(`${SITE}/book/new`);
  await expect(page.getByRole("heading", { level: 1, name: "预订接送车" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "选择车型" })).toHaveCount(0);

  // 出发地：平台的机场排在谷歌候选前面
  const from = page.getByRole("combobox", { name: "出发地" });
  await from.fill(airport.name);
  const fromList = page.getByRole("listbox", { name: "出发地的候选" });
  await expect(fromList.getByRole("option").first()).toContainText(airport.name);
  await expect(fromList.getByRole("option").first()).toContainText("机场");
  await expect(fromList.getByRole("option", { name: /東京駅/ })).toBeVisible();
  await expectNarrowAndAccessible(page, "新预订页（候选展开）");
  await from.press("Enter");
  await expect(from).toHaveValue(airport.name);

  // 目的地：谷歌候选，键盘选中（选中后后端取坐标）
  const to = page.getByRole("combobox", { name: "目的地" });
  await to.fill("東京駅");
  await expect(page.getByRole("listbox", { name: "目的地的候选" }).getByRole("option", { name: /東京駅/ })).toBeVisible();
  await to.press("ArrowDown");
  await to.press("Enter");
  await expect(to).toHaveValue(/^東京駅/);

  await page.getByLabel("日期（当地）").fill(tomorrowInTokyo());
  await page.getByLabel("用车时间（当地）").fill("10:00");
  // 填齐就自动报价：认出接机，时间标签、提示（免费等待取报价的 60 分钟）、航班号
  await expect(page.getByText("已识别为接机：司机按航班落地时间等候，落地后免费等待 60 分钟")).toBeVisible();
  await expect(page.getByLabel("航班落地时间（当地）")).toHaveValue("10:00");
  await page.getByLabel("航班号（选填）").fill("NH211");
  const travellers = page.getByRole("button", { name: "乘客 / 行李 2 人 · 2 件" });
  await travellers.click();
  await page.getByRole("button", { name: "增加乘客" }).click();
  await expect(page.getByRole("button", { name: "乘客 / 行李 3 人 · 2 件" })).toHaveAttribute("aria-expanded", "true");
  await expectNarrowAndAccessible(page, "新预订页第 1 步（认出接机、乘客行李展开）");

  await page.getByRole("button", { name: "查看车型和价格" }).click();
  await expect(page.getByRole("heading", { name: "选择车型" })).toBeFocused();
  await expect(page.locator(".book-new__strip-text")).toContainText(`接机 ${airport.name} → 東京駅`);
  const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: world.group.name }) });
  await expect(card).toContainText("22,000 JPY");
  await expect(card).toContainText("5 件（行李按 28 寸行李箱计）");
  await card.getByRole("button", { name: `选择 ${world.group.name}` }).click();
  const seats = card.getByRole("img", { name: `${world.group.name}的车内示意图：乘客座位 6 个，行李 5 件（行李按 28 寸行李箱计）` });
  await expect(seats).toBeVisible();
  await expect(card.locator("figcaption")).toContainText("乘客座位 6 个 · 行李 5 件（行李按 28 寸行李箱计） · 人数少时空座位也可以放行李");
  await expect(card.locator("figcaption")).toContainText("示意图");
  const includes = page.getByRole("region", { name: "一口价包含" });
  await expect(includes.getByRole("listitem")).toHaveText(["一口价已含所有费用（高速费、停车费等），无需另付", "专车专用，不拼车", "航班落地后免费等待 60 分钟"]);
  await expect(page.locator("main")).not.toContainText("跟踪航班");
  const bar = page.locator(".book-bar");
  await expect(bar).toContainText(`${world.group.name} · 一口价 22,000 JPY`);
  await bar.getByRole("button", { name: "下一步" }).click();
  await expect(bar).toContainText("填写乘客信息并付款的一步还没有开放");
  await expectNarrowAndAccessible(page, "新预订页第 2 步（座位示意图展开、底部固定条）");

  // 电脑宽：单页两栏，右侧栏有所选车型的一口价
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole("heading", { name: "你的行程" })).toBeVisible();
  const aside = page.getByRole("complementary", { name: "行程摘要" });
  await expect(aside).toContainText(`${world.group.name} · 一口价`);
  await expect(aside).toContainText("22,000");
  await expect(aside).toContainText("NH211");
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `新预订页电脑单页（${scheme === "light" ? "亮色" : "暗色"}）`);
  }
  await page.emulateMedia({ colorScheme: "light" });

  // 带参数的链接：出发地是机场编码，目的地是坐标加名称，打开就报价
  await page.setViewportSize({ width: 400, height: 800 });
  await page.goto(`${SITE}/book/new?from=${airport.code}&to=${TOKYO_STATION.lat},${TOKYO_STATION.lng}&to_name=${encodeURIComponent("東京駅八重洲口")}&date=${tomorrowInTokyo()}&time=11:30&pax=3&bags=1`);
  await expect(page.getByRole("heading", { name: "选择车型" })).toBeVisible();
  await expect(page.locator(".book-new__strip-text")).toContainText(`接机 ${airport.name} → 東京駅八重洲口`);
  await expect(page.locator(".book-new__strip-text")).toContainText("3 人 · 1 件");
  await expect(page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: world.group.name }) })).toContainText("22,000 JPY");

  // 浏览器只连本站（不连谷歌）
  expect([...origins].filter((origin) => origin !== SITE)).toEqual([]);
});
