/**
 * 嵌入组件（M9E-03，ADR 0090）端到端：两个本机宿主网站（一个在嵌入码白名单里、一个不在）各放一段代码，
 * 加载构建好的 /embed/widget-v1.js，经真实的 /embed/v1 → 真实 API → 真实 PostgreSQL。谷歌是本机的假服务器（global-setup）。
 *
 * - 白名单网站：宿主页把 div、input、button 全设成红底，组件外观不受影响；320 px 不横向滚动；axe 无问题；
 *   键盘选地点、提交 → 建草稿 → 整页跳到主站 /book/new?draft= → 自动询价，价格等于在主站手填同样条件。
 * - 不在白名单的网站：只显示「预订组件暂时无法使用」和主站链接，没有表单；配置接口被拒、浏览器读不到。
 * - 建草稿失败（M9E-07，ADR 0090 第七节）：网络错误、429 两种（拦截改写应答）、400（客人填了不存在的日期，真实 API 拒绝）各显示第四节的那一句、不跳转；
 *   400 标出日期并把焦点移过去，改正后去掉标记。
 * - 包车（M9E-07）：选「包车」标签、不填经停点 → 跳 /book/new?draft= 后停在第 1 步等客人选时长、不询价 → 选 8 小时后报价。
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { AxeBuilder } from "@axe-core/playwright";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { E2E_WEB_PLACES_PORT } from "../playwright.config.ts";
import { airportLink, createAirport, publishTransfer } from "./book-new-support.ts";
import { createSupplier, createWorld } from "./catalog.ts";
import { charterWorld } from "./charter-support.ts";
import { OWN_SITE_SOURCE, platformAdminHeaders, randomLetters } from "./support.ts";

test.use(OWN_SITE_SOURCE);

/** 有假谷歌密钥的那一组（地址输入即提示要用） */
const SITE = `http://127.0.0.1:${E2E_WEB_PLACES_PORT}`;

/** 宿主页：所有 div、input、button 红底白字、30px、粗体、字距、大写、斜体（都加 !important），看组件会不会被染上（会继承的几项最容易穿进 Shadow DOM） */
function hostPage(key: string): string {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>合作网站</title>
<style>div, input, button { background: rgb(255, 0, 0) !important; color: rgb(255, 255, 255) !important; font-size: 30px !important; font-weight: 700 !important; letter-spacing: 6px !important; text-transform: uppercase !important; font-style: italic !important; } body { margin: 0; }</style></head>
<body><main><h1>合作网站</h1><div id="nozomi-booking"></div></main>
<script src="${SITE}/embed/widget-v1.js"></script>
<script>NozomiBooking.init({ key: ${JSON.stringify(key)}, root: "#nozomi-booking", lang: "zh", services: ["transfer", "charter"], redirectUrl: location.origin + "/thanks" });</script>
</body></html>`;
}

async function startHost(key: () => string): Promise<{ server: Server; origin: string }> {
  const server = createServer((request, response) => {
    if (request.url !== "/" && request.url !== "/index.html") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(hostPage(key()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

let allowedHost: { server: Server; origin: string };
let otherHost: { server: Server; origin: string };
let embedKey = "";

test.beforeAll(async () => {
  allowedHost = await startHost(() => embedKey);
  otherHost = await startHost(() => embedKey);
});
test.afterAll(async () => {
  await new Promise((resolve) => allowedHost.server.close(resolve));
  await new Promise((resolve) => otherHost.server.close(resolve));
});

const dayAfterTomorrow = (): string => new Date(Date.now() + 2 * 86_400_000 + 9 * 3_600_000).toISOString().slice(0, 10);

async function quoteTotals(page: Page, open: () => Promise<unknown>): Promise<string[]> {
  const response = page.waitForResponse((res) => res.url().endsWith("/site/v1/quotes/by-points") && res.request().method() === "POST");
  await open();
  const body = (await (await response).json()) as { quotes: { vehicle_group: { id: string }; price: { total: { amount: string; currency: string } } }[] };
  return body.quotes.map((quote) => `${quote.vehicle_group.id}:${quote.price.total.amount} ${quote.price.total.currency}`).sort();
}

test("嵌入组件：白名单网站上样式不受宿主页影响、320 px、axe、键盘走完 → 建草稿 → 跳主站自动询价，价格等于手填；不在白名单的网站只显示暂时无法使用", async ({ page, request }) => {
  test.setTimeout(180_000);
  const world = await createWorld(request);
  const airport = await createAirport(request, world);
  const supplier = await createSupplier(request, world);
  await publishTransfer(request, supplier, { ...world, airport });
  const created = await request.post("/platform/v1/embed-keys", { headers: await platformAdminHeaders(request), data: { name: "端到端宿主", allowed_origins: [allowedHost.origin], default_lang: "ja", default_services: ["transfer", "charter"] } });
  expect(created.status(), await created.text()).toBe(201);
  embedKey = ((await created.json()) as { key: string }).key;

  // ---- 不在白名单的网站 ----
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(otherHost.origin);
  await expect(page.getByText("预订组件暂时无法使用。请稍后刷新，或直接到主站预订。")).toBeVisible();
  await expect(page.getByRole("link", { name: "到主站预订" })).toHaveAttribute("href", `${SITE}/book/new`);
  await expect(page.getByRole("button", { name: "查看价格" })).toHaveCount(0);

  // ---- 白名单网站 ----
  await page.goto(allowedHost.origin);
  const fromBox = page.getByRole("combobox", { name: "出发地" });
  await expect(fromBox).toBeVisible();
  await expect(page.getByRole("tab", { name: "区间" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "包车" })).toBeVisible();
  // 宿主页的红底和 30px 字号进不来
  const styles = await page.evaluate(() => {
    const shadow = document.querySelector("#nozomi-booking")?.shadowRoot;
    const pick = (selector: string) => {
      const node = shadow?.querySelector(selector);
      if (node === null || node === undefined) return null;
      const style = getComputedStyle(node);
      return { background: style.backgroundColor, color: style.color, fontSize: style.fontSize, fontWeight: style.fontWeight, letterSpacing: style.letterSpacing, textTransform: style.textTransform, fontStyle: style.fontStyle };
    };
    return { box: pick(".nzb"), input: pick("input"), button: pick(".nzb-primary"), hint: pick(".nzb-hint"), widgetOverflow: (shadow?.querySelector(".nzb") as HTMLElement | null)?.scrollWidth ?? 0, page: document.documentElement.scrollWidth };
  });
  for (const part of [styles.box, styles.input]) {
    expect(part?.background).toBe("rgb(255, 255, 255)");
    expect(part?.fontSize).not.toBe("30px");
  }
  expect(styles.button?.background).not.toBe("rgb(255, 0, 0)");
  for (const part of [styles.box, styles.hint, styles.input]) {
    expect(part?.fontWeight, "宿主页的粗体进不来").toBe("400");
    expect(part?.letterSpacing).toBe("normal");
    expect(part?.textTransform).toBe("none");
    expect(part?.fontStyle).toBe("normal");
  }
  expect(styles.page, "320 px 不横向滚动").toBeLessThanOrEqual(320);
  expect(styles.widgetOverflow).toBeLessThanOrEqual(320);
  const axe = await new AxeBuilder({ page }).include("#nozomi-booking").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);

  // 键盘：出发地选平台的机场，目的地选谷歌候选，日期改成后天，Tab 到「查看价格」回车
  await fromBox.focus();
  // 打完整名称（带随机后缀）：只打前几个字时，并行用例建的「新预订机场XXXXX」也会排在候选里，方向键可能选到别人的（M8-29 同类）
  await page.keyboard.type(airport.name);
  await expect(page.getByRole("listbox", { name: "出发地的候选" }).getByRole("option", { name: new RegExp(airport.name) })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox", { name: "出发地的候选" }).getByRole("option").first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(fromBox).toHaveValue(airport.name);
  const toBox = page.getByRole("combobox", { name: "目的地" });
  await toBox.focus();
  await page.keyboard.type("東京駅");
  const toList = page.getByRole("listbox", { name: "目的地的候选" });
  await expect(toList.getByRole("option", { name: /東京駅/ }).first()).toBeVisible();
  // 谷歌署名在候选列表外面、同一个弹出面板里（M9E-06）
  await expect(toList.locator("xpath=..").getByText("Google Maps", { exact: true })).toBeVisible();
  await expect(toList.getByText("Google Maps", { exact: true })).toHaveCount(0);
  await page.keyboard.press("ArrowDown");
  // 谷歌候选选中后组件再取坐标：等取到再提交，否则组件按「没选地点」先提示、不建草稿（M9E-07 本机重复跑时偶发）
  const details = page.waitForResponse((res) => new URL(res.url()).pathname === "/embed/v1/places/details");
  await page.keyboard.press("Enter");
  expect((await details).status()).toBe(200);
  await expect(toBox).toHaveValue(/東京駅/);
  await page.getByLabel("日期").fill(dayAfterTomorrow());

  const draftResponse = page.waitForResponse((res) => res.url().includes("/embed/v1/booking-drafts") && res.request().method() === "POST");
  const submit = page.getByRole("button", { name: "查看价格" });
  await submit.focus();
  const viaWidget = await quoteTotals(page, async () => {
    await page.keyboard.press("Enter");
    expect((await draftResponse).status()).toBe(201);
    await page.waitForURL(new RegExp(`^${SITE.replace(/\./g, "\\.")}/book/new\\?draft=[A-Za-z0-9_-]{43}`));
  });
  await expect(page.getByRole("heading", { name: "选择车型" })).toBeVisible();
  expect(viaWidget.length).toBeGreaterThan(0);

  // 主站手填同样条件（坐标、日期时间、人数行李取自草稿本身）：每个车型的价格一样
  const draftId = new URL(page.url()).searchParams.get("draft") as string;
  const saved = (await (await request.get(`${SITE}/site/v1/booking-drafts/${draftId}`)).json()) as { draft: { service_local: string; dropoff: { lat: number; lng: number; name: string }; passengers: number; luggage: number } };
  const [date, time] = saved.draft.service_local.split("T") as [string, string];
  const manual = await quoteTotals(page, () => page.goto(`${SITE}/book/new?${airportLink(airport)}&to=${saved.draft.dropoff.lat},${saved.draft.dropoff.lng}&to_name=${encodeURIComponent(saved.draft.dropoff.name)}&date=${date}&time=${time}&pax=${saved.draft.passengers}&bags=${saved.draft.luggage}`));
  expect(viaWidget).toEqual(manual);
});

/** 给本 worker 的白名单宿主网站建一个嵌入码，宿主页随即用它 */
async function useNewEmbedKey(request: APIRequestContext): Promise<void> {
  const created = await request.post("/platform/v1/embed-keys", { headers: await platformAdminHeaders(request), data: { name: `端到端宿主 ${randomLetters(4)}`, allowed_origins: [allowedHost.origin], default_lang: "zh", default_services: ["transfer", "charter"] } });
  expect(created.status(), await created.text()).toBe(201);
  embedKey = ((await created.json()) as { key: string }).key;
}

/** 在组件的地址框里打完整名称（带随机后缀，不会选到并行用例的数据），点那一项候选 */
async function choosePlace(page: Page, box: string, name: string): Promise<void> {
  const input = page.getByRole("combobox", { name: box });
  await input.fill(name);
  await page.getByRole("listbox", { name: `${box}的候选` }).getByRole("option", { name: new RegExp(name) }).click();
  await expect(input).toHaveValue(name);
}

test("嵌入组件建草稿失败：网络错误、429 两种、400 各显示一句，不跳转；400 标出日期、移焦点，改正后去掉标记（M9E-07）", async ({ page, request }) => {
  test.setTimeout(120_000);
  const world = await createWorld(request);
  const airport = await createAirport(request, world);
  await useNewEmbedKey(request);
  await page.goto(allowedHost.origin);
  await choosePlace(page, "出发地", airport.name);
  const toBox = page.getByRole("combobox", { name: "目的地" });
  await toBox.fill("東京駅");
  // 谷歌候选选中后组件再取坐标：等取到再提交，否则组件按「没选地点」先提示
  const details = page.waitForResponse((res) => new URL(res.url()).pathname === "/embed/v1/places/details");
  await page.getByRole("listbox", { name: "目的地的候选" }).getByRole("option", { name: /東京駅/ }).first().click();
  expect((await details).status()).toBe(200);
  await expect(toBox).toHaveValue(/東京駅/);
  await page.getByLabel("日期").fill(dayAfterTomorrow());
  const message = page.locator('[data-role="message"]');
  const submit = page.getByRole("button", { name: "查看价格" });
  const drafts: number[] = [];
  page.on("response", (res) => {
    if (res.url().includes("/embed/v1/booking-drafts") && res.request().method() === "POST") drafts.push(res.status());
  });

  // 网络错误：请求发不出去
  let reply: "network" | { status: number; code: string } = "network";
  const isDraftUrl = (url: URL): boolean => url.pathname === "/embed/v1/booking-drafts";
  await page.route(isDraftUrl, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    if (reply === "network") return route.abort("failed");
    // 429：真的发到主站（请求体换成空对象，主站不建草稿；会占这条用例自己的来源地址和嵌入码各一次限速额度，用例只发 3 次，不影响别的用例），把应答改写成 429；保留主站给的跨域响应头，浏览器才读得到
    const response = await route.fetch({ postData: "{}" });
    return route.fulfill({ response, status: reply.status, contentType: "application/json", body: JSON.stringify({ error: { code: reply.code, message: "e2e" } }) });
  });
  await submit.click();
  await expect(message).toHaveText("暂时连不上，请稍后再试或直接到主站预订。");
  await expect(submit).toHaveText("查看价格");

  reply = { status: 429, code: "RATE_LIMITED" };
  await submit.click();
  await expect(message).toHaveText("操作太频繁，请稍等一分钟再试。");
  reply = { status: 429, code: "EMBED_DRAFT_LIMIT" };
  await submit.click();
  await expect(message).toHaveText("暂时无法查询，请稍后再试或直接到主站预订。");
  await page.unroute(isDraftUrl);
  expect(drafts).toEqual([429, 429]);

  // 400：不支持日期选择器的浏览器里日期框就是文本框，客人填了不存在的日期（2 月 30 日）；组件只查写法，真实 API 拒绝
  const dateBox = page.getByLabel("日期");
  await dateBox.evaluate((node) => node.setAttribute("type", "text"));
  await dateBox.fill(`${new Date().getUTCFullYear() + 1}-02-30`);
  const rejected = page.waitForResponse((res) => res.url().includes("/embed/v1/booking-drafts") && res.request().method() === "POST");
  await submit.click();
  const body = (await (await rejected).json()) as { error: { code: string; details: { issues: { path: string }[] } } };
  expect((await rejected).status()).toBe(400);
  expect(body.error.code).toBe("VALIDATION_FAILED");
  expect(body.error.details.issues.map((issue) => issue.path)).toEqual(["/draft/service_local"]);
  await expect(message).toHaveText("有几项填得不对，请检查后再试。");
  await expect(dateBox).toHaveAttribute("aria-invalid", "true");
  await expect(dateBox).toBeFocused();
  await dateBox.fill(dayAfterTomorrow());
  await expect.poll(() => dateBox.getAttribute("aria-invalid"), { message: "改正后去掉标记" }).toBeNull();

  expect(new URL(page.url()).origin, "失败时都不跳转").toBe(allowedHost.origin);
});

test("嵌入组件包车：选「包车」、不填经停点 → 跳 /book/new?draft= 后停在第 1 步等客人选时长、不询价 → 选 8 小时后报价（M9E-07）", async ({ page, request }) => {
  test.setTimeout(180_000);
  // 城市有 4 小时、8 小时两档（只有一档时预订页会替客人选上）；上车站放在城市中心（商品区域里），下车选加价区域里的车站
  const trip = await charterWorld(request, { extraPackageHours: 4 });
  const pickupName = `包车上车站${randomLetters(5)}`;
  const placed = await request.post("/platform/v1/master/places", { headers: await platformAdminHeaders(request), data: { type: "station", code: `STN-JP-${randomLetters(6)}`, city_id: trip.cityId, category: "rail", name: { zh: pickupName }, location: trip.pickup } });
  expect(placed.status(), await placed.text()).toBe(201);
  await useNewEmbedKey(request);
  await page.setViewportSize({ width: 1280, height: 900 });
  const charterQuotes: Record<string, unknown>[] = [];
  page.on("request", (sent) => {
    if (sent.method() === "POST" && new URL(sent.url()).pathname === "/site/v1/quotes") charterQuotes.push(sent.postDataJSON() as Record<string, unknown>);
  });

  await page.goto(allowedHost.origin);
  await page.getByRole("tab", { name: "包车" }).click();
  await expect(page.getByRole("tab", { name: "包车" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("不填经停点时，到预订页选包车时长。")).toBeVisible();
  await choosePlace(page, "上车地点", pickupName);
  await choosePlace(page, "下车地点", trip.station.name);
  const date = dayAfterTomorrow();
  await page.getByLabel("日期").fill(date);
  const draftResponse = page.waitForResponse((res) => res.url().includes("/embed/v1/booking-drafts") && res.request().method() === "POST");
  await page.getByRole("button", { name: "查看价格" }).click();
  expect((await draftResponse).status()).toBe(201);
  const sent = (await draftResponse).request().postDataJSON() as { draft: Record<string, unknown> };
  expect(sent.draft).toMatchObject({ tab: "charter", waypoints: [], package_hours: null });
  await page.waitForURL(new RegExp(`^${SITE.replace(/\./g, "\\.")}/book/new\\?draft=[A-Za-z0-9_-]{43}`));

  // 第 1 步：地点、日期带过来了，时长空着、两档可选，不询价
  await expect(page.getByRole("combobox", { name: "上车地点" })).toHaveValue(pickupName);
  await expect(page.getByRole("combobox", { name: "下车地点" })).toHaveValue(trip.station.name);
  const hours = page.getByLabel(/^包车时长/);
  await expect(hours.locator("option[value='8']")).toHaveCount(1);
  await expect(hours.locator("option[value='4']")).toHaveCount(1);
  await expect(hours).toHaveValue("");
  await page.waitForTimeout(1_000);
  expect(charterQuotes, "没选时长不询价").toEqual([]);
  expect(new URL(page.url()).searchParams.get("step"), "停在第 1 步").toBeNull();

  // 选 8 小时 → 按 8 小时询价：套餐 70,000 + 下车加价 1,000，对外 78,100
  await hours.selectOption("8");
  await expect.poll(() => charterQuotes.length, { message: "选了时长就询价" }).toBeGreaterThan(0);
  await page.getByRole("button", { name: "下一步：选择车型" }).click();
  const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: trip.groupName }) });
  await expect(card).toContainText("78,100 JPY");
  expect(charterQuotes.at(-1)).toMatchObject({ category: "charter", pickup: trip.pickup, dropoff: trip.station.location, package_hours: 8, service_local: `${date}T10:00` });
});
