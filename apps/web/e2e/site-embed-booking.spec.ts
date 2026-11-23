/**
 * 嵌在宿主页·第一期（M9E-16，ADR 0095 第三、五、六节、第十节「端到端（新）」）的跨站端到端：
 * 主站是 127.0.0.1（地址搜索那一组的 vite preview，带和 Caddy 同规则的 frame-check），宿主网站是 localhost（本文件起的小服务器）——两者不同站。
 * chromium 和 webkit（playwright.config.ts 的 webkit-embed）各跑一遍。经真实的 /embed/v1、/site/v1 → 真实 API → 真实 PostgreSQL；谷歌是本机的假服务器。
 *
 * - 宿主首页 init({ bookingUrl }) → 建草稿 → 整页跳宿主 /booking/?nzdraft= → nzdraft 从地址栏消失、进 sessionStorage → mountBooking 建 iframe →
 *   跨站 iframe 里的嵌入页读草稿、显示内容、发 ready / resize（高度跟着变）；收到的消息只来自主站 origin、没有草稿内容；刷新后仍从存储接着嵌；axe 无问题。
 * - 草稿过期：iframe 报 DRAFT_NOT_FOUND → 宿主删存储、显示「重新查询」、onEvent 收到 error → 点了回到查价表单。
 * - 嵌不进去（不在白名单、嵌入码没开「允许整页嵌入」、宿主页再被别的网站嵌一层）：15 秒后显示后备一句话和「到主站继续预订」。
 * - 主站别的页面仍不能被嵌（frame-ancestors 'none' + X-Frame-Options: DENY）。
 * 第二期（M9E-17，ADR 0095 第四、八、九节）：
 * - iframe 里走完 /book 的四步（询价带 draft_id、没有 Leaflet），键盘提交，下单后进 iframe 里的订单页（令牌不进地址、不发给宿主）；
 *   iframe 自己刷新、宿主页刷新都接着显示这张待付款的单；平台订单详情来源是「宿主页内」；390 宽、axe；
 * - A 网站建的草稿在 B 网站打开：询价不带 draft_id（来源按主站记）。
 * 第三期（M9E-19，ADR 0095 第七节）：下单后在 iframe 里直接挂付款表单（假 Stripe），要 3D 验证的卡在 iframe 里弹验证框，宿主先收到 modal{open:true}
 *   再收到 modal{open:false}；付完宿主的 onEvent 收到 completed；模拟银行整页回跳到 return_url（带 key、host、ch，过得了 frame-check）后照常显示、
 *   地址里的付款参数去掉、回跳后的消息仍带频道号，换 4242 付完收到 completed。
 * M9E-27（ADR 0095 第十二节末第二轮决策）：分栏按 iframe 自己的宽度——iframe 1440、1024 宽两栏，右边是主站同一个「行程摘要」右侧栏
 * （谷歌静态路线图经同源 /site/v1/route-map 出图、时长公里数、车型、出发地、目的地、航班落地时间、乘客 / 行李），1023、375 宽单栏、顶部摘要条；
 * 宿主窗口宽而预订区窄时照样单栏；宽窄切换后 resize 报的高度等于内容高度、不多发 step；亮暗两色 axe；截图存到 E2E_SCREENSHOT_DIR（m9e27-*.png）。
 * M9E-32（ADR 0100）：390 宽时 iframe 被撑到全高，每一步的主按钮和「上一步」在底部按钮条里，宿主页滚到顶部、中间时按宿主发的 viewport{top}
 * 停在宿主屏幕下沿看得见，滚到底回到原位置；截图 m9e32-embed-*.png。769–1023 的平板也用底部按钮条（业主 2026-11-17，ADR 0100 补充）：
 * M9E-27 那条在 iframe 1023 宽时核对有条、1024 宽时没有。
 * M9P-22（ADR 0098 第三节第 7 小节）：iframe 里包车快捷入口「机场送机结束」按航站楼选，询价匹配到机场、明细写场景名，第 3 步备注提示航班号。
 * M10-01：静态路线图出不来（/site/v1/route-map 503，UNAVAILABLE 和 NOT_ENABLED）时 iframe 里不显示地图、没有 Leaflet，只写「约 X 分钟 · Y 公里」。
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { AxeBuilder } from "@axe-core/playwright";
import { type APIRequestContext, type Locator, type Page, expect, test } from "@playwright/test";
import { E2E_WEB_PLACES_PORT, E2E_WEB_STRIPE_PORT } from "../playwright.config.ts";
import { TOKYO_STATION, createAirport, publishTransfer, tomorrowInTokyo } from "./book-new-support.ts";
import { charterAirportWorld } from "./charter-airport-support.ts";
import { charterWorld } from "./charter-support.ts";
import { createSupplier, createWorld } from "./catalog.ts";
import { TEST_CARDS, routeStripe } from "./fake-stripe.ts";
import { OWN_SITE_SOURCE, embedHostAsProduction, platformAdminHeaders, randomLetters, snapshot } from "./support.ts";

// 接口调用（request）按这条用例自己的来源地址限速
test.use(OWN_SITE_SOURCE);

/** 主站：127.0.0.1（有假谷歌密钥的那一组） */
const SITE = `http://127.0.0.1:${E2E_WEB_PLACES_PORT}`;
/** 配了假 Stripe 的那一组主站（付款进 iframe，M9E-19）；这一组没有谷歌密钥，地点用平台的机场、车站 */
const STRIPE_SITE = `http://127.0.0.1:${E2E_WEB_STRIPE_PORT}`;
const HOST_DRAFT_KEY = "nozomi.host-draft";
// 宿主页跨站请求主站（组件的 /embed/v1、iframe 里的嵌入页）和正式环境一样不带额外请求头，来源地址在路由里补（M9E-22 的 embedHostAsProduction）
test.beforeEach(async ({ context }) => {
  await embedHostAsProduction(context, SITE, STRIPE_SITE);
});

interface Host {
  server: Server;
  origin: string;
  key: string;
  /** 组件脚本和 iframe 来自哪个主站 */
  site: string;
}

/** 宿主网站：localhost 上的小服务器。/ 放查价表单（init + bookingUrl），/booking/ 放 mountBooking，/nest/ 把 /booking/ 再嵌一层 */
function hostHtml(host: Host, path: string, nestedSrc: string): string | null {
  const head = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>合作网站</title><style>body { margin: 0; font-family: sans-serif; } main { padding: 8px; }</style></head><body><main><h1>合作网站</h1>`;
  const record = `<script>window.__messages = []; window.__events = []; window.addEventListener("message", function (event) { window.__messages.push({ origin: event.origin, data: JSON.stringify(event.data) }); });</script>`;
  if (path === "/") {
    return `${head}<div id="nozomi-booking"></div></main><script src="${host.site}/embed/widget-v1.js"></script>
<script>NozomiBooking.init({ key: ${JSON.stringify(host.key)}, root: "#nozomi-booking", lang: "zh", services: ["transfer"], bookingUrl: location.origin + "/booking/" });</script></body></html>`;
  }
  if (path === "/booking/") {
    return `${head}<div id="flow"></div></main>${record}<script src="${host.site}/embed/widget-v1.js"></script>
<script>NozomiBooking.mountBooking({ key: ${JSON.stringify(host.key)}, root: "#flow", lang: "zh", onEvent: function (event) { window.__events.push(event); } });</script></body></html>`;
  }
  if (path === "/nest/") return `${head}<iframe title="再嵌一层" src="${nestedSrc}" width="800" height="900"></iframe></main></body></html>`;
  if (path === "/main-site/") return `${head}<iframe title="主站预订页" src="${SITE}/book"></iframe><iframe title="主站登录页" src="${SITE}/login"></iframe></main></body></html>`;
  return null;
}

async function startHost(nestedSrc: () => string = () => "about:blank", site = SITE): Promise<Host> {
  const host: Host = { server: createServer(), origin: "", key: "", site };
  host.server.on("request", (request, response) => {
    const html = hostHtml(host, new URL(request.url ?? "/", "http://x").pathname, nestedSrc());
    if (html === null) response.writeHead(404).end();
    else response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(html);
  });
  // 不指定地址：同时听 IPv4 / IPv6 的回环，浏览器把 localhost 解析成哪个都连得上
  await new Promise<void>((resolve) => host.server.listen(0, resolve));
  host.origin = `http://localhost:${(host.server.address() as AddressInfo).port}`;
  return host;
}

const hosts: Host[] = [];
test.afterAll(async () => {
  await Promise.all(hosts.splice(0).map((host) => new Promise((resolve) => host.server.close(resolve))));
});

async function newHost(request: APIRequestContext, options: { allowHostPage?: boolean; whitelisted?: boolean; services?: ("transfer" | "charter")[]; site?: string } = {}, nestedSrc?: () => string): Promise<Host> {
  const host = await startHost(nestedSrc, options.site);
  hosts.push(host);
  const allowed = options.whitelisted === false ? ["http://localhost:1"] : [host.origin];
  const created = await request.post("/platform/v1/embed-keys", {
    headers: await platformAdminHeaders(request),
    data: { name: `宿主页内 ${randomLetters(4)}`, allowed_origins: allowed, default_lang: "zh", default_services: options.services ?? ["transfer"], allow_host_page: options.allowHostPage ?? true },
  });
  expect(created.status(), await created.text()).toBe(201);
  host.key = ((await created.json()) as { key: string }).key;
  return host;
}

const dayAfterTomorrow = (): string => new Date(Date.now() + 2 * 86_400_000 + 9 * 3_600_000).toISOString().slice(0, 10);
const frameOf = (page: Page) => page.frameLocator('iframe[title="NOZOMI 用车预订"]');
const fakeDraft = (): string => `${randomLetters(8)}${"x".repeat(35)}`;

/** 在宿主首页的组件里选两个地点、填日期，点「查看价格」：等跳到宿主 /booking/ */
async function searchFromHostHome(page: Page, host: Host, airportName: string): Promise<void> {
  await page.goto(`${host.origin}/`);
  const from = page.getByRole("combobox", { name: "出发地" });
  await from.fill(airportName);
  await page.getByRole("listbox", { name: "出发地的候选" }).getByRole("option", { name: new RegExp(airportName) }).click();
  await expect(from).toHaveValue(airportName);
  const to = page.getByRole("combobox", { name: "目的地" });
  await to.fill("東京駅");
  const details = page.waitForResponse((res) => new URL(res.url()).pathname === "/embed/v1/places/details");
  await page.getByRole("listbox", { name: "目的地的候选" }).getByRole("option", { name: /東京駅/ }).first().click();
  expect((await details).status()).toBe(200);
  await expect(to).toHaveValue(/東京駅/);
  await page.getByLabel("日期").fill(dayAfterTomorrow());
  const drafted = page.waitForResponse((res) => res.url().includes("/embed/v1/booking-drafts") && res.request().method() === "POST");
  await page.getByRole("button", { name: "查看价格" }).click();
  const response = await drafted;
  expect(response.status()).toBe(201);
  expect(JSON.parse(response.request().postData() ?? "{}").delivery, "传了 bookingUrl 的建草稿带 delivery").toBe("host_page");
}

test("跨站：宿主首页查价 → 跳宿主 /booking/（nzdraft 进存储、离开地址栏）→ iframe 里的嵌入页显示草稿、发 ready / resize；消息只来自主站、不带草稿内容；刷新照样接着嵌", async ({ page, request }) => {
  test.setTimeout(150_000);
  const world = await createWorld(request);
  const airport = await createAirport(request, world);
  // 第二期起 iframe 里是完整的四步（M9E-17）：要有能报价的商品，四步才显示（否则是「暂时没有可预订的城市」）
  await publishTransfer(request, await createSupplier(request, world), { ...world, airport });
  const host = await newHost(request);
  await searchFromHostHome(page, host, airport.name);

  await expect.poll(() => page.url(), { message: "nzdraft 从宿主地址栏去掉" }).toBe(`${host.origin}/booking/`);
  const stored = JSON.parse((await page.evaluate((key) => sessionStorage.getItem(key), HOST_DRAFT_KEY)) ?? "{}") as { id?: string; at?: number };
  expect(Object.keys(stored).sort()).toEqual(["at", "id"]);
  expect(stored.id).toMatch(/^[A-Za-z0-9_-]{43}$/);

  const frame = frameOf(page);
  await expect(frame.getByText(airport.name)).toBeVisible();
  await expect(frame.getByText("東京駅")).toBeVisible();
  await expect(frame.getByText("本预订由 NOZOMI 提供并收款。")).toBeVisible();
  const iframe = page.locator('iframe[title="NOZOMI 用车预订"]');
  await expect(iframe).toHaveAttribute("src", new RegExp(`^${SITE.replace(/\./g, "\\.")}/embed/book\\?draft=${stored.id}&key=${host.key}&lang=zh&host=${encodeURIComponent(host.origin).replace(/\./g, "\\.")}#ch=[0-9a-f]{32}$`));
  await expect(iframe, "按 resize 调了高度").not.toHaveAttribute("height", "720");
  await expect(page.locator('[data-nozomi-booking="frame"] .nzb-notice'), "没有提示时提示行不占位置").toBeHidden();
  const height = Number(await iframe.getAttribute("height"));
  expect(height).toBeGreaterThan(100);
  const messages = (await page.evaluate(() => (window as unknown as { __messages: { origin: string; data: string }[] }).__messages)) ?? [];
  const types = messages.map((message) => (JSON.parse(message.data) as { type: string }).type);
  expect(types).toContain("ready");
  expect(types).toContain("resize");
  expect(new Set(messages.map((message) => message.origin))).toEqual(new Set([SITE]));
  const raw = messages.map((message) => message.data).join("\n");
  for (const secret of [airport.name, "東京駅", stored.id as string, host.key]) expect(raw, "消息里没有草稿内容、草稿号、嵌入码").not.toContain(secret);
  // ready、resize 不转给 onEvent；第二期起四步换步时有 step（M9E-17）
  const events = (await page.evaluate(() => (window as unknown as { __events: { type: string }[] }).__events)) ?? [];
  expect(new Set(events.map((event) => event.type)), "ready、resize 不转给 onEvent").toEqual(new Set(["step"]));

  // 嵌入页里 390 宽不横向滚动；整页（含跨站 iframe）axe 无问题
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => frame.locator("html").evaluate((html) => html.scrollWidth - html.clientWidth)).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);

  // 刷新：地址上没有 nzdraft，从存储里取，照样嵌
  await page.reload();
  await expect(frameOf(page).getByText(airport.name)).toBeVisible();
  expect(page.url()).toBe(`${host.origin}/booking/`);
});

test("跨站：草稿过期——iframe 报 DRAFT_NOT_FOUND，宿主删存储、显示「重新查询」、onEvent 收到 error；点了回到查价表单", async ({ page, request }) => {
  test.setTimeout(90_000);
  const host = await newHost(request);
  await page.goto(`${host.origin}/booking/?nzdraft=${fakeDraft()}`);
  await expect(page.getByText("这次查询已过期。")).toBeVisible();
  await expect(frameOf(page).getByText("这次查询已过期，请在上方重新查询。")).toBeVisible();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), HOST_DRAFT_KEY)).toBeNull();
  expect(await page.evaluate(() => (window as unknown as { __events: unknown[] }).__events)).toEqual([{ type: "error", code: "DRAFT_NOT_FOUND" }]);
  await page.getByRole("button", { name: "重新查询" }).click();
  await expect(page.locator('iframe[title="NOZOMI 用车预订"]')).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "出发地" })).toBeVisible();
});

for (const [label, options, nested] of [
  ["网站不在嵌入码白名单里", { whitelisted: false }, false],
  ["嵌入码没开「允许整页嵌入」", { allowHostPage: false }, false],
  ["宿主页又被别的网站嵌了一层（frame-ancestors 检查所有祖先）", {}, true],
] as const) {
  test(`跨站：嵌不进去——${label}：15 秒后拿掉 iframe，显示一句话和「到主站继续预订」（新标签页）`, async ({ page, request }) => {
    test.setTimeout(90_000);
    const draft = fakeDraft();
    let inner = "about:blank";
    const host = await newHost(request, options, nested ? () => inner : undefined);
    const outer = nested ? await startHost(() => inner) : null;
    if (outer !== null) {
      hosts.push(outer);
      inner = `${host.origin}/booking/?nzdraft=${draft}`;
    }
    await page.goto(outer === null ? `${host.origin}/booking/?nzdraft=${draft}` : `${outer.origin}/nest/`);
    const scope = outer === null ? page : page.frameLocator('iframe[title="再嵌一层"]');
    // 组件按墙上时间等 15 秒；并行跑、机器忙时浏览器的计时器会晚几秒触发（本机 chromium 实测晚到 21 秒），这里多给一些
    await expect(scope.getByText("预订页暂时打不开。请刷新，或到主站继续预订。")).toBeVisible({ timeout: 45_000 });
    const link = scope.getByRole("link", { name: "到主站继续预订" });
    await expect(link).toHaveAttribute("href", `${SITE}/book?draft=${draft}`);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(scope.locator('iframe[title="NOZOMI 用车预订"]')).toHaveCount(0);
  });
}

test("主站别的页面仍不能被任何网站嵌入：/book、/login 带 frame-ancestors 'none' 和 X-Frame-Options: DENY，iframe 里出不来", async ({ page, request }) => {
  for (const path of ["/book", "/login", "/embed/book/x"]) {
    const response = await request.get(`${SITE}${path}`);
    expect(response.headers()["content-security-policy"], path).toContain("frame-ancestors 'none'");
    expect(response.headers()["x-frame-options"], path).toBe("DENY");
  }
  const host = await newHost(request);
  // goto 默认等到 load：子框架（被拦下的也算）都加载完了才返回
  await page.goto(`${host.origin}/main-site/`);
  for (const title of ["主站预订页", "主站登录页"]) await expect(page.frameLocator(`iframe[title="${title}"]`).locator("#root")).toHaveCount(0);
});

/** 宿主页收到的消息（录下来的原样） */
async function hostMessages(page: Page): Promise<{ origin: string; data: Record<string, unknown> }[]> {
  const raw = (await page.evaluate(() => (window as unknown as { __messages: { origin: string; data: string }[] }).__messages)) ?? [];
  return raw.map((message) => ({ origin: message.origin, data: JSON.parse(message.data) as Record<string, unknown> }));
}

/** iframe 里嵌入页现在的地址 */
function embedUrl(page: Page): URL {
  const frame = page.frames().find((candidate) => new URL(candidate.url(), "http://x").pathname.startsWith("/embed/book"));
  expect(frame, "找到嵌入页的框架").toBeDefined();
  return new URL(frame?.url() ?? "about:blank");
}

function keepsFrameParams(page: Page): void {
  const url = embedUrl(page);
  for (const name of ["draft", "key", "host"]) expect(url.searchParams.get(name), `${url.pathname}${url.search} 带 ${name}`).not.toBeNull();
}

test("M9E-17 跨站整条流程：iframe 里走完四步（询价带 draft_id、宽时两栏、没有地图选点）→ 下单 → iframe 里的订单页（令牌不进地址、不发给宿主）→ iframe 刷新、宿主页刷新都接着显示这张单；来源记「宿主页内」；390 宽、axe、键盘提交", async ({ page, request }) => {
  test.setTimeout(240_000);
  const world = await createWorld(request);
  const airport = await createAirport(request, world);
  const supplier = await createSupplier(request, world);
  await publishTransfer(request, supplier, { ...world, airport });
  const host = await newHost(request);
  const quoted = page.waitForRequest((sent) => new URL(sent.url()).pathname === "/site/v1/quotes/by-points" && sent.method() === "POST");
  await searchFromHostHome(page, host, airport.name);
  await expect.poll(() => page.url()).toBe(`${host.origin}/booking/`);
  const draftId = (JSON.parse((await page.evaluate((key) => sessionStorage.getItem(key), HOST_DRAFT_KEY)) ?? "{}") as { id: string }).id;
  expect(((await quoted).postDataJSON() as { draft_id?: string }).draft_id, "iframe 里的询价带草稿编号").toBe(draftId);

  const frame = frameOf(page);
  // 第 2 步：iframe 比 1024 宽（宿主窗口 1280，M9E-27）——两栏、带右侧栏；没有地图选点和 Leaflet
  const card = frame.getByRole("listitem").filter({ has: frame.getByRole("heading", { name: world.group.name }) });
  await card.getByRole("button", { name: `选择 ${world.group.name}` }).click();
  await expect(frame.getByRole("complementary", { name: "行程摘要" })).toBeVisible();
  await expect(frame.locator(".leaflet-container")).toHaveCount(0);
  keepsFrameParams(page);
  await frame.getByRole("button", { name: "下一步：填写乘客信息" }).click();
  await expect(frame.getByRole("heading", { level: 2, name: "乘客信息" })).toBeFocused();
  keepsFrameParams(page);
  const email = `embed-host-${crypto.randomUUID().slice(0, 8)}@e2e.example.com`;
  await frame.getByLabel("航班号").fill("NH211");
  await frame.getByRole("radio", { name: /^国际航班/ }).check();
  await frame.getByLabel("乘车人姓名").fill("王小明");
  await frame.getByLabel("邮箱").fill(email);
  const phone = frame.getByLabel("手机号（含国家区号）");
  await phone.fill("+81 90-1234-5678");
  // 键盘：在输入框里按回车提交这一步
  await phone.press("Enter");
  await expect(frame.getByRole("heading", { name: "核对订单" })).toBeFocused();
  keepsFrameParams(page);

  // 390 宽单栏、不横向滚动；整页（含跨站 iframe）axe 无问题
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(frame.getByRole("complementary", { name: "行程摘要" })).toHaveCount(0);
  await expect.poll(() => frame.locator("html").evaluate((html) => html.scrollWidth - html.clientWidth)).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);

  // 键盘：空格勾同意、回车点「去付款」
  const consent = frame.getByRole("checkbox", { name: /同意保存这次付款用的银行卡/ });
  await consent.focus();
  await consent.press("Space");
  await expect(consent).toBeChecked();
  const placed = page.waitForResponse((res) => new URL(res.url()).pathname === "/site/v1/orders" && res.request().method() === "POST");
  const pay = frame.getByRole("button", { name: "去付款 →" });
  await pay.focus();
  await pay.press("Enter");
  const created = (await (await placed).json()) as { order: { id: string; order_no: string }; link: { token: string } };
  await expect(frame.getByRole("heading", { name: `订单号 ${created.order.order_no}` })).toBeVisible();
  expect(embedUrl(page).pathname).toBe("/embed/book/order");
  keepsFrameParams(page);
  expect(embedUrl(page).href, "令牌不进地址").not.toContain("nzo_");
  const payLink = frame.getByRole("link", { name: /在新窗口打开订单页付款/ });
  await expect(payLink).toHaveAttribute("href", `/book/order#${created.link.token}`);
  await expect(payLink).toHaveAttribute("target", "_blank");

  // 宿主收到的消息：只来自主站；步骤依次到付款；没有个人信息、令牌、地点
  const received = await hostMessages(page);
  expect(new Set(received.map((message) => message.origin))).toEqual(new Set([SITE]));
  const steps = received.filter((message) => message.data["type"] === "step").map((message) => message.data["step"]);
  expect(steps.slice(-4)).toEqual(["vehicle", "passenger", "review", "payment"]);
  const raw = JSON.stringify(received);
  for (const secret of ["王小明", email, "+81", "NH211", created.link.token, airport.name, draftId, host.key]) expect(raw, `消息里没有 ${secret}`).not.toContain(secret);
  const events = (await page.evaluate(() => (window as unknown as { __events: { type: string }[] }).__events)) ?? [];
  expect(events.map((event) => event.type).every((type) => type === "step"), "onEvent 只收到 step（付款进 iframe 在第三期）").toBe(true);

  // 平台订单详情：来源是嵌入组件、宿主页内
  const detail = await request.get(`/platform/v1/orders/${created.order.id}`, { headers: await platformAdminHeaders(request) });
  expect(detail.status(), await detail.text()).toBe(200);
  expect(((await detail.json()) as { entry_source: unknown }).entry_source).toMatchObject({ kind: "embed", embed_origin: host.origin, delivery: "host_page" });

  // iframe 自己刷新（整页重新加载 /embed/book/order?…，要过 frame-check）：令牌在 history.state，照样显示这张单
  const embedFrame = page.frames().find((candidate) => candidate.url().includes("/embed/book/order"));
  await embedFrame?.evaluate(() => location.reload());
  await expect(frameOf(page).getByRole("heading", { name: `订单号 ${created.order.order_no}` })).toBeVisible();

  // 宿主页刷新：iframe 重新从 /embed/book?draft=… 开始，本标签页存着这张待付款的单，直接进订单页
  await page.reload();
  await expect(frameOf(page).getByRole("heading", { name: `订单号 ${created.order.order_no}` })).toBeVisible();
  expect(page.url()).toBe(`${host.origin}/booking/`);
});

test("M9E-17 跨站：A 网站建的草稿在 B 网站打开——照常预填和报价，但 iframe 里的询价不带 draft_id（来源按主站记）", async ({ page, request }) => {
  test.setTimeout(150_000);
  const world = await createWorld(request);
  const airport = await createAirport(request, world);
  const hostA = await newHost(request);
  const hostB = await newHost(request);
  await searchFromHostHome(page, hostA, airport.name);
  await expect.poll(() => page.url()).toBe(`${hostA.origin}/booking/`);
  const draftId = (JSON.parse((await page.evaluate((key) => sessionStorage.getItem(key), HOST_DRAFT_KEY)) ?? "{}") as { id: string }).id;
  const quoted = page.waitForRequest((sent) => new URL(sent.url()).pathname === "/site/v1/quotes/by-points" && sent.method() === "POST");
  await page.goto(`${hostB.origin}/booking/?nzdraft=${draftId}`);
  const body = (await quoted).postDataJSON() as Record<string, unknown>;
  expect(body["pickup"]).toMatchObject({ name: airport.name });
  expect("draft_id" in body, "草稿上记的是 A 网站，这次是 B 网站").toBe(false);
});

test("M9P-20 跨站：iframe 里的包车第 2 步有行程地图（本站 /site/v1/itinerary-map，上车、经停、下车按顺序）和同编号列表，没有 Leaflet；整页 axe", async ({ page, request }) => {
  test.setTimeout(150_000);
  const trip = await charterWorld(request);
  const stop = { lat: Number((trip.center.lat + 0.02).toFixed(6)), lng: Number((trip.center.lng - 0.01).toFixed(6)) };
  const made = await request.post("/platform/v1/master/places", { headers: await platformAdminHeaders(request), data: { type: "station", code: `STN-JP-${randomLetters(6)}`, city_id: trip.cityId, category: "rail", name: { zh: `嵌入经停${randomLetters(4)}` }, location: stop } });
  expect(made.status(), await made.text()).toBe(201);
  const host = await newHost(request, { services: ["transfer", "charter"] });
  const draft = {
    v: 1,
    tab: "charter",
    service_local: `${tomorrowInTokyo()}T10:00`,
    pickup: { name: "上车酒店", ...trip.pickup },
    dropoff: { name: "市内下车点", ...trip.nearby },
    waypoints: [{ name: "经停车站", ...stop, stay_minutes: 60 }],
    package_hours: null,
    passengers: 2,
    luggage: 2,
    lang: "zh",
  };
  const created = await request.post(`/embed/v1/booking-drafts?key=${encodeURIComponent(host.key)}`, { headers: { origin: host.origin }, data: { draft, delivery: "host_page" } });
  expect(created.status(), await created.text()).toBe(201);
  const draftId = ((await created.json()) as { id: string }).id;
  const map = page.waitForResponse((res) => new URL(res.url()).pathname === "/site/v1/itinerary-map");
  await page.goto(`${host.origin}/booking/?nzdraft=${draftId}`);
  const frame = frameOf(page);
  const schedule = frame.getByRole("region", { name: "行程时间表" });
  await expect(schedule.getByRole("list", { name: "行程" }).getByRole("listitem")).toHaveCount(3);
  await expect(schedule.getByRole("list", { name: "行程" }).getByRole("listitem").first()).toHaveText(/^1 上车上车酒店\d\d:\d\d 出发$/);
  await expect(schedule.getByRole("list", { name: "行程" }).getByRole("listitem").nth(1)).toContainText("2 经停经停车站");
  await expect(schedule.getByRole("list", { name: "行程" }).getByRole("listitem").nth(2)).toContainText(/行驶约 .+ · .+ 公里3 下车市内下车点/);
  const response = await map;
  expect(new URL(response.url()).origin, "图片地址是主站本站").toBe(SITE);
  expect(response.status()).toBe(200);
  const fix = (point: { lat: number; lng: number }): string => `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
  expect(new URL(response.url()).searchParams.getAll("p")).toEqual([fix(trip.pickup), fix(stop), fix(trip.nearby)]);
  await expect(schedule.getByRole("img", { name: /^路线图：1 上车酒店 → 2 经停车站 → 3 市内下车点，约 .+ 公里$/ })).toBeVisible();
  await expect(frame.locator(".leaflet-container")).toHaveCount(0);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
});

test("M9P-22 跨站：iframe 里包车快捷入口「机场送机结束」按航站楼选下车点（列出绑定的机场、区域里的航站楼），询价匹配到机场结束、明细写「8 小时包车 + 简称送机」；第 3 步备注提示航班号；axe", async ({ page, request }) => {
  test.setTimeout(180_000);
  const trip = await charterAirportWorld(request);
  const host = await newHost(request, { services: ["transfer", "charter"] });
  const draft = {
    v: 1,
    tab: "charter",
    service_local: `${tomorrowInTokyo()}T10:00`,
    pickup: { name: "上车酒店", ...trip.pickup },
    dropoff: { name: "市内下车点", ...trip.nearby },
    waypoints: [],
    // 没有经停点时草稿要带包车时长才直接到第 2 步（draftReadyToQuote）
    package_hours: 8,
    passengers: 2,
    luggage: 2,
    lang: "zh",
  };
  const created = await request.post(`/embed/v1/booking-drafts?key=${encodeURIComponent(host.key)}`, { headers: { origin: host.origin }, data: { draft, delivery: "host_page" } });
  expect(created.status(), await created.text()).toBe(201);
  const draftId = ((await created.json()) as { id: string }).id;
  await page.goto(`${host.origin}/booking/?nzdraft=${draftId}`);
  const frame = frameOf(page);
  // 草稿带齐了直接到第 2 步：回第 1 步用快捷入口
  await expect(frame.getByRole("heading", { name: trip.groupName }).first()).toBeVisible();
  await frame.getByRole("button", { name: "上一步" }).click();
  await frame.getByRole("button", { name: "机场送机结束" }).click();
  await expect(frame.getByRole("button", { name: "机场送机结束" })).toHaveAttribute("aria-pressed", "true");
  const terminal = frame.getByRole("combobox", { name: "下车地点" });
  // 地点名称本身带航站楼、机场没登记航站楼：航站楼预填名称里那段（监工 2026-11-20），客人可改
  await terminal.fill(trip.namedTerminalAirport.name);
  await frame.getByRole("option", { name: new RegExp(trip.namedTerminalAirport.name) }).first().click();
  await expect(frame.getByLabel("下车地点（航站楼，选填）")).toHaveValue("第2ターミナル");
  await expect(frame.getByText("已按选中地点的名称填上航站楼，不对可以改")).toBeVisible();
  // 和别的地点一样用地址搜索输入机场名、选候选（业主 2026-11-19），系统按坐标认出机场和航站楼
  await terminal.fill(trip.airportName);
  // 选好航站楼、行程填齐后页面自己就去询价（停顿一下），所以在选之前就开始等这次询价（只等下车点是这个机场的那次，前面选预填机场时的询价不算）
  const quoted = page.waitForResponse((res) => new URL(res.url()).pathname === "/site/v1/quotes" && res.request().method() === "POST" && (JSON.parse(res.request().postData() ?? "{}") as { dropoff?: { lat: number } }).dropoff?.lat === trip.airport.lat);
  await frame.getByRole("option", { name: new RegExp(trip.airportName) }).first().click();
  await expect(frame.getByText(`已识别：${trip.terminalLabel}`)).toBeVisible();
  await frame.getByRole("button", { name: "下一步：选择车型" }).click();
  const response = await quoted;
  expect(response.status()).toBe(200);
  expect((JSON.parse(response.request().postData() ?? "{}") as { dropoff: { lat: number; lng: number } }).dropoff).toEqual(trip.airport);
  await expect(frame.getByText(`8 小时包车 + ${trip.shortName}送机`).first()).toBeVisible();
  await expect(frame.locator(".leaflet-container")).toHaveCount(0);

  await frame.getByRole("button", { name: `选择 ${trip.groupName}` }).click();
  await frame.getByRole("button", { name: "下一步：填写乘客信息" }).click();
  await expect(frame.getByRole("heading", { name: "乘客信息", level: 2 })).toBeVisible();
  await expect(frame.locator("#book-notes-hint")).toHaveText("如需司机知道航班号，请填在这里");
  await expect(frame.getByLabel(/航班号/)).toHaveCount(0);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
});

/** 把宿主页上放预订区的容器设成 `width` 宽（iframe 宽度跟容器），等 iframe 自己的视口变成这个宽度 */
async function frameWidth(page: Page, width: number): Promise<void> {
  await page.evaluate((value) => {
    const main = document.querySelector("main");
    if (main !== null) main.style.padding = "0";
    const flow = document.getElementById("flow");
    if (flow !== null) flow.style.width = `${value}px`;
  }, width);
  await expect.poll(() => frameOf(page).locator("html").evaluate(() => window.innerWidth), { message: `iframe 自己的视口 ${width} 宽` }).toBe(width);
}

/** 宿主页上 iframe 的高度（resize 设的）等于 iframe 里内容的实际高度 */
async function expectHeightFollowsContent(page: Page, what: string): Promise<void> {
  const iframe = page.locator('iframe[title="NOZOMI 用车预订"]');
  const content = () => frameOf(page).locator("main.embed-book").evaluate((main) => Math.ceil(main.getBoundingClientRect().bottom + window.scrollY));
  await expect.poll(async () => Number(await iframe.getAttribute("height")) - (await content()), { message: `${what}：iframe 高度等于内容高度` }).toBe(0);
}

test("M9E-27 跨站：分栏按 iframe 自己的宽度——1440、1024 两栏带主站同一个「行程摘要」右侧栏（静态路线图出图），1023、375 单栏（单栏时按钮在底部按钮条里，平板业主 2026-11-17）；宽窄切换后高度照报、不多发 step；没有主站顶栏页脚；亮暗 axe；截图", async ({ page, request }) => {
  test.setTimeout(240_000);
  const world = await createWorld(request);
  const airport = await createAirport(request, world);
  await publishTransfer(request, await createSupplier(request, world), { ...world, airport });
  const host = await newHost(request);
  await page.setViewportSize({ width: 1500, height: 900 });
  await searchFromHostHome(page, host, airport.name);
  await expect.poll(() => page.url()).toBe(`${host.origin}/booking/`);
  const frame = frameOf(page);
  const aside = frame.getByRole("complementary", { name: "行程摘要" });
  const bar = frame.locator(".book-summary-bar");

  // 1440：选车型、进第 3 步，右侧栏里有路线图、时长公里数、车型、行程要点
  await frameWidth(page, 1440);
  const card = frame.getByRole("listitem").filter({ has: frame.getByRole("heading", { name: world.group.name }) });
  await card.getByRole("button", { name: `选择 ${world.group.name}` }).click();
  await frame.getByRole("button", { name: "下一步：填写乘客信息" }).click();
  await expect(frame.getByRole("heading", { level: 2, name: "乘客信息" })).toBeFocused();
  await expect(aside).toBeVisible();
  await expect(bar).toHaveCount(0);
  const image = aside.getByRole("img", { name: /^路线图：.+ → .*東京駅.*，约 \d+ 分钟 · [\d.]+ 公里$/ });
  await expect(image, "静态路线图在 iframe 里出图（嵌入页 CSP 的 img-src 放行同源的 /site/v1/route-map）").toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  expect(new URL((await image.getAttribute("src")) ?? "", SITE).pathname).toBe("/site/v1/route-map");
  await expect(aside.locator(".book-summary__route")).toHaveText(/约 \d+ 分钟 · [\d.]+ 公里/);
  await expect(aside.getByText(world.group.name)).toBeVisible();
  for (const [term, value] of [["出发地", airport.name], ["目的地", /東京駅/], ["航班落地（当地时间）", /\d/], ["乘客 / 行李", /人/]] as const) {
    await expect(aside.locator(".site-facts__item").filter({ has: frame.getByText(term, { exact: true }) }).locator("dd")).toHaveText(value);
  }
  await expect(frame.locator(".site, .site__header, .site__nav, .site__footer, nav, footer"), "没有主站顶栏、导航、页脚").toHaveCount(0);
  await expect(frame.locator(".leaflet-container")).toHaveCount(0);
  const stepCount = async (): Promise<number> => (await hostMessages(page)).filter((message) => message.data["type"] === "step").length;
  const steps = await stepCount();

  for (const [width, viewport, wide] of [
    [1440, 1500, true],
    [1024, 1280, true],
    [1023, 1280, false],
    [375, 375, false],
  ] as const) {
    const what = `iframe ${width} 宽`;
    await page.setViewportSize({ width: viewport, height: 900 });
    await frameWidth(page, width);
    if (wide) {
      await expect(aside, `${what}：两栏`).toBeVisible();
      await expect(bar).toHaveCount(0);
    } else {
      await expect(aside, `${what}：单栏（宿主窗口 ${viewport} 宽也一样）`).toHaveCount(0);
      await expect(bar.getByRole("button", { name: /行程摘要/ })).toBeVisible();
    }
    // 每一步的按钮：两栏时在正文末尾；单栏（手机、769–1023 的平板，业主 2026-11-17 决定）在底部按钮条里
    await expect(frame.locator(".step-bar"), `${what}：${wide ? "没有" : "有"}底部按钮条`).toHaveCount(wide ? 0 : 1);
    await expect(frame.locator(wide ? ".book-new__actions" : ".step-bar").getByRole("button", { name: "下一步：核对订单" }), `${what}：「下一步：核对订单」的位置`).toBeVisible();
    await expect(frame.getByRole("heading", { level: 2, name: "乘客信息" }), `${what}：还在第 3 步`).toBeVisible();
    await expect.poll(() => frame.locator("html").evaluate((html) => html.scrollWidth - html.clientWidth), `${what}：不横向滚动`).toBeLessThanOrEqual(0);
    await expectHeightFollowsContent(page, what);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(axe.violations.map((violation) => `${violation.id}: ${violation.help}`), `${what}（${scheme}）`).toEqual([]);
    }
    await page.emulateMedia({ colorScheme: "light" });
    if (width !== 1023) await snapshot(page, `m9e27-embed-${width}`);
  }
  expect(await stepCount(), "宽窄切换不算换步，不多发 step").toBe(steps);
});

test("M10-01 跨站：静态路线图出不来（/site/v1/route-map 503：暂时不可用 UNAVAILABLE、平台没开通 NOT_ENABLED）时 iframe 里不显示地图、不退回开源地图，右侧栏只写「约 X 分钟 · Y 公里」", async ({ page, request }) => {
  test.setTimeout(240_000);
  const world = await createWorld(request);
  const airport = await createAirport(request, world);
  await publishTransfer(request, await createSupplier(request, world), { ...world, airport });
  let reason = "UNAVAILABLE";
  let asked = 0;
  // 路线图的图片和图片失败后再问一次原因都走这里（iframe 里的请求也经过 page.route）
  await page.route((url) => url.pathname === "/site/v1/route-map", async (route) => {
    asked += 1;
    await route.fulfill({ status: 503, json: { error: { code: "ROUTE_MAP_UNAVAILABLE", message: "路线图暂不可用", details: { reason } } } });
  });
  const host = await newHost(request);
  await page.setViewportSize({ width: 1500, height: 900 });
  await searchFromHostHome(page, host, airport.name);
  await expect.poll(() => page.url()).toBe(`${host.origin}/booking/`);
  const frame = frameOf(page);
  await frameWidth(page, 1440);
  const card = frame.getByRole("listitem").filter({ has: frame.getByRole("heading", { name: world.group.name }) });
  await card.getByRole("button", { name: `选择 ${world.group.name}` }).click();
  await frame.getByRole("button", { name: "下一步：填写乘客信息" }).click();
  const aside = frame.getByRole("complementary", { name: "行程摘要" });
  await expect(aside).toBeVisible();

  for (const next of ["UNAVAILABLE", "NOT_ENABLED"] as const) {
    if (next === "NOT_ENABLED") {
      // 换应答的原因后刷新宿主页：iframe 从存储里的草稿接着嵌，重新要一次路线图
      reason = next;
      const before = asked;
      await page.reload();
      await frameWidth(page, 1440);
      await expect(aside).toBeVisible();
      await expect.poll(() => asked, `${next}：又要了一次路线图`).toBeGreaterThan(before);
    } else await expect.poll(() => asked, `${next}：要过路线图`).toBeGreaterThan(0);
    await expect(aside.locator(".book-summary__route"), next).toHaveText(/^约 \d+ 分钟 · [\d.]+ 公里$/);
    await expect(frame.locator(".route-map"), `${next}：不显示地图`).toHaveCount(0);
    await expect(frame.locator(".leaflet-container"), `${next}：不退回开源地图`).toHaveCount(0);
    await expect(aside.getByRole("img", { name: /^路线图：/ })).toHaveCount(0);
  }
});

/** 宿主页滚到 scrollY：iframe 里这个按钮在宿主屏幕里（宿主发的 viewport 是异步的，轮询） */
async function expectFrameButtonOnScreen(page: Page, button: Locator, scrollY: number | "bottom", what: string): Promise<void> {
  await page.evaluate((y) => window.scrollTo(0, y === "bottom" ? document.documentElement.scrollHeight : y), scrollY);
  const height = page.viewportSize()?.height ?? 0;
  await expect
    .poll(
      async () => {
        const box = await button.boundingBox();
        return box !== null && box.y >= 0 && box.y + box.height <= height;
      },
      { message: `${what}：宿主滚到 ${scrollY} 时在屏幕里` },
    )
    .toBe(true);
}

test("M9E-32 跨站：手机 390 宽，iframe 被撑到全高，每一步的主按钮和「上一步」在底部按钮条里——宿主页滚到顶部、中间时都停在宿主屏幕下沿看得见，滚到底回到原位置；第 2 步没选车时灰着写原因；宿主发的 viewport 带 top；axe；截图", async ({ page, request }) => {
  test.setTimeout(240_000);
  const world = await createWorld(request);
  const airport = await createAirport(request, world);
  await publishTransfer(request, await createSupplier(request, world), { ...world, airport });
  const host = await newHost(request);
  await page.setViewportSize({ width: 390, height: 664 });
  await searchFromHostHome(page, host, airport.name);
  await expect.poll(() => page.url()).toBe(`${host.origin}/booking/`);
  const frame = frameOf(page);
  const bar = frame.locator(".step-bar");
  const card = frame.getByRole("listitem").filter({ has: frame.getByRole("heading", { name: world.group.name }) });
  await expect(card).toBeVisible();
  // iframe 高度由页面发消息来改，卡片出来时可能还没到（WebKit 偶发）：轮询等它撑高
  const iframeHeight = async (): Promise<number> => Number(await page.locator('iframe[title="NOZOMI 用车预订"]').getAttribute("height"));
  await expect.poll(iframeHeight, { message: "第 2 步 iframe 比宿主屏幕高（按钮条原位置在屏幕外）" }).toBeGreaterThan(664);

  // 第 2 步：没选车时「下一步」灰着、写原因
  const next = bar.getByRole("button", { name: "下一步：填写乘客信息" });
  await expect(next).toBeDisabled();
  await expect(bar.locator("#book-step-reason")).toHaveText("请先选择车型");
  await expectFrameButtonOnScreen(page, next, 0, "第 2 步「下一步」");
  await expect(frame.locator(".step-bar-slot--frame[data-tracked]"), "收到带 top 的 viewport，按宿主屏幕摆放").toHaveCount(1);
  await card.getByRole("button", { name: `选择 ${world.group.name}` }).click();
  await expect(next).toBeEnabled();
  await expectFrameButtonOnScreen(page, next, 0, "第 2 步「下一步」（选了车）");
  await expectFrameButtonOnScreen(page, next, 300, "第 2 步「下一步」（宿主滚到中间）");
  await expectFrameButtonOnScreen(page, next, "bottom", "第 2 步「下一步」（宿主滚到底）");
  await next.click();

  // 第 3 步
  await expect(frame.getByRole("heading", { level: 2, name: "乘客信息" })).toBeVisible();
  await frame.getByLabel("航班号").fill("NH211");
  await frame.getByRole("radio", { name: /^国际航班/ }).check();
  await frame.getByLabel("乘车人姓名").fill("王小明");
  await frame.getByLabel("邮箱").fill(`m9e32-embed-${crypto.randomUUID().slice(0, 8)}@e2e.example.com`);
  await frame.getByLabel("手机号（含国家区号）").fill("+81 90-1234-5678");
  await expectFrameButtonOnScreen(page, bar.getByRole("button", { name: "下一步：核对订单" }), 0, "第 3 步「下一步：核对订单」");
  await expectFrameButtonOnScreen(page, bar.getByRole("button", { name: "上一步" }), 0, "第 3 步「上一步」");
  await snapshot(page, "m9e32-embed-step3");
  await bar.getByRole("button", { name: "下一步：核对订单" }).click();

  // 第 4 步：「去付款」在条里，同意保存银行卡在条上方
  await expect(frame.getByRole("heading", { name: "核对订单" })).toBeVisible();
  await expectFrameButtonOnScreen(page, bar.getByRole("button", { name: "去付款 →" }), 0, "第 4 步「去付款」");
  await expectFrameButtonOnScreen(page, bar.getByRole("button", { name: "上一步" }), 0, "第 4 步「上一步」");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect
    .poll(async () => {
      const consent = await frame.getByRole("checkbox", { name: /同意保存这次付款用的银行卡/ }).boundingBox();
      const strip = await bar.boundingBox();
      return consent !== null && strip !== null && consent.y + consent.height <= strip.y + 0.5;
    }, { message: "滚到底：同意保存银行卡在条上方" })
    .toBe(true);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await snapshot(page, "m9e32-embed-step4");

  // 回到第 1 步
  await bar.getByRole("button", { name: "上一步" }).click();
  await bar.getByRole("button", { name: "上一步" }).click();
  await bar.getByRole("button", { name: "上一步" }).click();
  await expect(frame.getByRole("heading", { name: "你的行程" })).toBeVisible();
  await expectFrameButtonOnScreen(page, bar.getByRole("button", { name: "下一步：选择车型" }), 0, "第 1 步「下一步：选择车型」");
  await snapshot(page, "m9e32-embed-step1");
});

function fakeStripeUrl(): string {
  const url = process.env["E2E_FAKE_STRIPE_URL"];
  if (!url) throw new Error("global-setup 没有启动假 Stripe");
  return url;
}

/** 配了 Stripe 的那一组主站：宿主首页选机场 → 平台车站、后天，查看价格 → /booking/ 的 iframe 里走完四步下单，停在 iframe 里的订单页 */
async function placeInFrame(page: Page, request: APIRequestContext): Promise<{ host: Host; created: { order: { id: string; order_no: string }; link: { token: string } } }> {
  const world = await createWorld(request);
  const airport = await createAirport(request, world);
  const supplier = await createSupplier(request, world);
  await publishTransfer(request, supplier, { ...world, airport });
  const stationName = `付款进框车站${randomLetters(5)}`;
  const station = await request.post("/platform/v1/master/places", { headers: await platformAdminHeaders(request), data: { type: "station", code: `STN-JP-${randomLetters(6)}`, city_id: world.city.id, category: "rail", name: { zh: stationName }, location: TOKYO_STATION } });
  expect(station.status(), await station.text()).toBe(201);
  const host = await newHost(request, { site: STRIPE_SITE });
  await page.goto(`${host.origin}/`);
  for (const [box, name] of [["出发地", airport.name], ["目的地", stationName]] as const) {
    const input = page.getByRole("combobox", { name: box });
    await input.fill(name);
    await page.getByRole("listbox", { name: `${box}的候选` }).getByRole("option", { name: new RegExp(name) }).click();
    await expect(input).toHaveValue(name);
  }
  await page.getByLabel("日期").fill(dayAfterTomorrow());
  await page.getByRole("button", { name: "查看价格" }).click();
  await expect.poll(() => page.url()).toBe(`${host.origin}/booking/`);
  const frame = frameOf(page);
  const card = frame.getByRole("listitem").filter({ has: frame.getByRole("heading", { name: world.group.name }) });
  await card.getByRole("button", { name: `选择 ${world.group.name}` }).click();
  await frame.getByRole("button", { name: "下一步：填写乘客信息" }).click();
  await frame.getByLabel("航班号").fill("NH211");
  await frame.getByRole("radio", { name: /^国际航班/ }).check();
  await frame.getByLabel("乘车人姓名").fill("王小明");
  await frame.getByLabel("邮箱").fill(`embed-pay-${crypto.randomUUID().slice(0, 8)}@e2e.example.com`);
  await frame.getByLabel("手机号（含国家区号）").fill("+81 90-1234-5678");
  await frame.getByRole("button", { name: "下一步：核对订单" }).click();
  await frame.getByRole("checkbox", { name: /同意保存这次付款用的银行卡/ }).check();
  const placed = page.waitForResponse((res) => new URL(res.url()).pathname === "/site/v1/orders" && res.request().method() === "POST");
  await frame.getByRole("button", { name: "去付款 →" }).click();
  const created = (await (await placed).json()) as { order: { id: string; order_no: string }; link: { token: string } };
  await expect(frame.getByRole("heading", { name: `订单号 ${created.order.order_no}` })).toBeVisible();
  return { host, created };
}

const embedFrameHandle = (page: Page) => page.frames().find((candidate) => new URL(candidate.url(), "http://x").pathname.startsWith("/embed/book"));

test("M9E-19 跨站：下单后 iframe 里直接出付款表单；3D 验证框在 iframe 里弹出、宿主先后收到 modal{open:true}/{open:false}；付完宿主 onEvent 收到 completed；return_url 回到嵌入订单页、带 key / host / ch、不带令牌", async ({ page, request }) => {
  test.setTimeout(240_000);
  const routed = await routeStripe(page, fakeStripeUrl());
  const { created } = await placeInFrame(page, request);
  const frame = frameOf(page);
  const cardField = frame.getByLabel("卡号（假 Stripe）");
  await expect(cardField, "下单后不用再点按钮，付款表单就在这一页").toBeVisible();
  await cardField.fill(TEST_CARDS.threeDs);
  await frame.getByRole("button", { name: /^付款 / }).click();
  await frame.getByRole("button", { name: "确认支付" }).click();
  const bank = frame.frameLocator('iframe[title="银行验证（假）"]');
  await expect(bank.getByRole("heading", { name: "银行验证（假 Stripe）" })).toBeVisible();
  // 验证框开着：宿主已收到 modal{open:true}，iframe 高度改成宿主可视高度、滚到 iframe 顶部
  await expect.poll(async () => (await hostMessages(page)).filter((message) => message.data["type"] === "modal").map((message) => message.data["open"])).toEqual([true]);
  await expect(page.locator('iframe[title="NOZOMI 用车预订"]')).toBeInViewport();
  await bank.getByRole("button", { name: "完成验证" }).click();
  await expect(frame.getByText(/付款成功，等待确认/)).toBeVisible();
  await expect.poll(async () => (await hostMessages(page)).filter((message) => message.data["type"] === "modal").map((message) => message.data["open"])).toEqual([true, false]);
  await expect.poll(async () => ((await page.evaluate(() => (window as unknown as { __events: { type: string }[] }).__events)) ?? []).some((event) => event.type === "completed"), { timeout: 30_000 }).toBe(true);
  const completed = (await hostMessages(page)).find((message) => message.data["type"] === "completed");
  expect(completed?.data).toMatchObject({ orderNo: created.order.order_no, status: "submitted" });

  const returnUrl = new URL((await embedFrameHandle(page)?.evaluate(() => (window as unknown as { __fakeStripe: { returnUrl: string } }).__fakeStripe.returnUrl)) ?? "about:blank");
  expect(returnUrl.origin + returnUrl.pathname).toBe(`${STRIPE_SITE}/embed/book/order`);
  for (const name of ["draft", "key", "host", "ch"]) expect(returnUrl.searchParams.get(name), `return_url 带 ${name}`).not.toBeNull();
  expect(returnUrl.href, "令牌不进 return_url").not.toContain("nzo_");
  expect(routed.unexpected).toEqual([]);
  const raw = JSON.stringify(await hostMessages(page));
  expect(raw, "消息里没有令牌").not.toContain(created.link.token);
  expect(raw, "消息里没有 client_secret").not.toContain("_secret_");
});

test("M9E-19 跨站：银行整页回跳到嵌入订单页（return_url 过得了 frame-check）——照常显示这张单、地址里的付款参数去掉、回跳后的消息仍带频道号；换 4242 付完收到 completed", async ({ page, request }) => {
  test.setTimeout(240_000);
  await routeStripe(page, fakeStripeUrl());
  const { created } = await placeInFrame(page, request);
  const frame = frameOf(page);
  await frame.getByLabel("卡号（假 Stripe）").fill(TEST_CARDS.threeDs);
  await frame.getByRole("button", { name: /^付款 / }).click();
  await frame.getByRole("button", { name: "确认支付" }).click();
  await expect(frame.frameLocator('iframe[title="银行验证（假）"]').getByRole("heading", { name: "银行验证（假 Stripe）" })).toBeVisible();
  // 像 Stripe 把整个 iframe 带去银行再回来：iframe 整页打开 return_url + Stripe 加的参数
  const embed = embedFrameHandle(page);
  const back = await embed?.evaluate(() => {
    const saved = JSON.parse(sessionStorage.getItem("nozomi.payment-return") ?? "{}") as { intentId?: string };
    const url = new URL((window as unknown as { __fakeStripe: { returnUrl: string } }).__fakeStripe.returnUrl);
    url.searchParams.set("payment_intent", saved.intentId ?? "");
    url.searchParams.set("payment_intent_client_secret", `${saved.intentId ?? ""}_secret_x`);
    url.searchParams.set("redirect_status", "failed");
    return url.href;
  });
  const ch = new URL(back ?? "about:blank").searchParams.get("ch");
  expect(ch).not.toBeNull();
  const before = (await hostMessages(page)).length;
  await embed?.evaluate((url) => location.assign(url), back ?? "");
  await expect(frameOf(page).getByRole("heading", { name: `订单号 ${created.order.order_no}` })).toBeVisible();
  keepsFrameParams(page);
  // 回跳前开着验证窗口（modal）：回来后宿主恢复按内容高度（最近一次 resize），不再锁在可视高度
  await expect.poll(async () => {
    const resizes = (await hostMessages(page)).filter((message) => message.data["type"] === "resize");
    const last = resizes.at(-1)?.data["height"];
    return String(last) === (await page.locator('iframe[title="NOZOMI 用车预订"]').getAttribute("height"));
  }).toBe(true);
  expect(embedUrl(page).hash, "频道号移到 # 后").toBe(`#ch=${ch ?? ""}`);
  for (const name of ["payment_intent", "payment_intent_client_secret", "redirect_status", "ch"]) expect(embedUrl(page).searchParams.has(name), `地址里还有 ${name}`).toBe(false);
  await frameOf(page).getByLabel("卡号（假 Stripe）").fill(TEST_CARDS.success);
  await frameOf(page).getByRole("button", { name: /^付款 / }).click();
  await frameOf(page).getByRole("button", { name: "确认支付" }).click();
  await expect.poll(async () => (await hostMessages(page)).slice(before).some((message) => message.data["type"] === "completed"), { timeout: 30_000 }).toBe(true);
  const after = (await hostMessages(page)).slice(before);
  expect(after.length).toBeGreaterThan(0);
  expect(after.every((message) => message.data["ch"] === ch), "回跳后的 ready / step / completed 都带频道号").toBe(true);
});
