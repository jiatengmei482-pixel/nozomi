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
 * - iframe 里走完 /book/new 的四步（询价带 draft_id、单栏、没有 Leaflet），键盘提交，下单后进 iframe 里的订单页（令牌不进地址、不发给宿主）；
 *   iframe 自己刷新、宿主页刷新都接着显示这张待付款的单；平台订单详情来源是「宿主页内」；390 宽、axe；
 * - A 网站建的草稿在 B 网站打开：询价不带 draft_id（来源按主站记）。
 * 付款放进 iframe、completed 事件的跨站端到端是第三期 M9E-19（这一期 completed 由组件测试 embed-flow.test.tsx 覆盖）。
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { AxeBuilder } from "@axe-core/playwright";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { E2E_WEB_PLACES_PORT } from "../playwright.config.ts";
import { createAirport, publishTransfer } from "./book-new-support.ts";
import { createSupplier, createWorld } from "./catalog.ts";
import { OWN_SITE_SOURCE, platformAdminHeaders, randomLetters } from "./support.ts";

test.use(OWN_SITE_SOURCE);

/** 主站：127.0.0.1（有假谷歌密钥的那一组） */
const SITE = `http://127.0.0.1:${E2E_WEB_PLACES_PORT}`;
const HOST_DRAFT_KEY = "nozomi.host-draft";

interface Host {
  server: Server;
  origin: string;
  key: string;
}

/** 宿主网站：localhost 上的小服务器。/ 放查价表单（init + bookingUrl），/booking/ 放 mountBooking，/nest/ 把 /booking/ 再嵌一层 */
function hostHtml(host: Host, path: string, nestedSrc: string): string | null {
  const head = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>合作网站</title><style>body { margin: 0; font-family: sans-serif; } main { padding: 8px; }</style></head><body><main><h1>合作网站</h1>`;
  const record = `<script>window.__messages = []; window.__events = []; window.addEventListener("message", function (event) { window.__messages.push({ origin: event.origin, data: JSON.stringify(event.data) }); });</script>`;
  if (path === "/") {
    return `${head}<div id="nozomi-booking"></div></main><script src="${SITE}/embed/widget-v1.js"></script>
<script>NozomiBooking.init({ key: ${JSON.stringify(host.key)}, root: "#nozomi-booking", lang: "zh", services: ["transfer"], bookingUrl: location.origin + "/booking/" });</script></body></html>`;
  }
  if (path === "/booking/") {
    return `${head}<div id="flow"></div></main>${record}<script src="${SITE}/embed/widget-v1.js"></script>
<script>NozomiBooking.mountBooking({ key: ${JSON.stringify(host.key)}, root: "#flow", lang: "zh", onEvent: function (event) { window.__events.push(event); } });</script></body></html>`;
  }
  if (path === "/nest/") return `${head}<iframe title="再嵌一层" src="${nestedSrc}" width="800" height="900"></iframe></main></body></html>`;
  if (path === "/main-site/") return `${head}<iframe title="主站预订页" src="${SITE}/book/new"></iframe><iframe title="主站登录页" src="${SITE}/login"></iframe></main></body></html>`;
  return null;
}

async function startHost(nestedSrc: () => string = () => "about:blank"): Promise<Host> {
  const host: Host = { server: createServer(), origin: "", key: "" };
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

async function newHost(request: APIRequestContext, options: { allowHostPage?: boolean; whitelisted?: boolean } = {}, nestedSrc?: () => string): Promise<Host> {
  const host = await startHost(nestedSrc);
  hosts.push(host);
  const allowed = options.whitelisted === false ? ["http://localhost:1"] : [host.origin];
  const created = await request.post("/platform/v1/embed-keys", {
    headers: await platformAdminHeaders(request),
    data: { name: `宿主页内 ${randomLetters(4)}`, allowed_origins: allowed, default_lang: "zh", default_services: ["transfer"], allow_host_page: options.allowHostPage ?? true },
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
    await expect(link).toHaveAttribute("href", `${SITE}/book/new?draft=${draft}`);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(scope.locator('iframe[title="NOZOMI 用车预订"]')).toHaveCount(0);
  });
}

test("主站别的页面仍不能被任何网站嵌入：/book/new、/login 带 frame-ancestors 'none' 和 X-Frame-Options: DENY，iframe 里出不来", async ({ page, request }) => {
  for (const path of ["/book/new", "/login", "/embed/book/x"]) {
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

test("M9E-17 跨站整条流程：iframe 里走完四步（询价带 draft_id、单栏、没有地图选点）→ 下单 → iframe 里的订单页（令牌不进地址、不发给宿主）→ iframe 刷新、宿主页刷新都接着显示这张单；来源记「宿主页内」；390 宽、axe、键盘提交", async ({ page, request }) => {
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
  // 第 2 步：单栏（没有右侧栏）、没有地图选点和 Leaflet
  const card = frame.getByRole("listitem").filter({ has: frame.getByRole("heading", { name: world.group.name }) });
  await card.getByRole("button", { name: `选择 ${world.group.name}` }).click();
  await expect(frame.getByRole("complementary", { name: "行程摘要" })).toHaveCount(0);
  await expect(frame.locator(".leaflet-container")).toHaveCount(0);
  keepsFrameParams(page);
  await frame.getByRole("button", { name: "下一步", exact: true }).click();
  await expect(frame.getByRole("heading", { level: 2, name: "乘客信息" })).toBeFocused();
  keepsFrameParams(page);
  const email = `embed-host-${crypto.randomUUID().slice(0, 8)}@e2e.example.com`;
  await frame.getByLabel("航班号").fill("NH211");
  await frame.getByLabel("乘车人姓名").fill("王小明");
  await frame.getByLabel("邮箱").fill(email);
  const phone = frame.getByLabel("手机号（含国家区号）");
  await phone.fill("+81 90-1234-5678");
  // 键盘：在输入框里按回车提交这一步
  await phone.press("Enter");
  await expect(frame.getByRole("heading", { name: "核对订单" })).toBeFocused();
  keepsFrameParams(page);

  // 390 宽不横向滚动；整页（含跨站 iframe）axe 无问题
  await page.setViewportSize({ width: 390, height: 844 });
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
