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
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { AxeBuilder } from "@axe-core/playwright";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { E2E_WEB_PLACES_PORT } from "../playwright.config.ts";
import { createAirport } from "./book-new-support.ts";
import { createWorld } from "./catalog.ts";
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
  expect(await page.evaluate(() => (window as unknown as { __events: unknown[] }).__events), "ready、resize 不转给 onEvent").toEqual([]);

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
