/**
 * 端到端（测试角色补充）：官网地址搜索与地图选点（M3-12，ADR 0044）。真实浏览器 → 构建好的前端 → 真实 API → 真实 PostgreSQL；
 * 谷歌是 global-setup 起的本机假服务器，**从不调用真实的谷歌**。用地址搜索专用的那组 API 和前端（配置文件里有一把本次运行随机生成的 `AIzaE2E…` 假密钥）。
 *
 * - 密钥不进浏览器：构建产物、页面、浏览器收到的每个应答、cookie / localStorage / sessionStorage 里都没有 `AIza` 开头的东西，也没有谷歌的接口地址；
 *   浏览器只连本站和底图；内容安全策略的 connect-src 只有 'self'、img-src 只多了底图来源、没有任何谷歌来源，整个流程没有违反策略的事件。
 * - 键盘：搜索框里回车只搜索、不发询价；地图聚焦后 `+` / `-` 真的缩放（瓦片的层级变了）、方向键平移，Tab 到「选地图中间这个位置」回车选中准星处。
 * - 配置里没有地址搜索也没有底图时：没有搜索框和地图按钮，常用地点和手填照常，浏览器不请求 /site/v1/places。
 *   （只改浏览器收到的 /site/v1/config 这一项来模拟，其余接口都是真的。）
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { E2E_TILE_PORT, E2E_WEB_PLACES_PORT } from "../playwright.config.ts";
import { CENTER, type Supplier, type World, createProductByApi, createSupplier, createWorld } from "./catalog.ts";

const SITE = `http://127.0.0.1:${E2E_WEB_PLACES_PORT}`;
const TILE_ORIGIN = `http://127.0.0.1:${E2E_TILE_PORT}`;
const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const RULES = {
  booking: { sale_from: null, sale_to: null, service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 0, note: null },
  urgent: { enabled: false, daily_quota: null, tiers: [] },
  night: { enabled: false, window: null, amount: null, charge_unit: null },
  free_wait: { pickup: null, dropoff: null, general: { mode: "limited", minutes: 30 } },
  addons: [],
  driver_languages: [],
};
const EMPTY_PRICE = { direction: null, package_hours: null, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null, base_price: null };

/** 供应商经接口上架一个点对点商品（一口价），让这个城市出现在官网上。 */
async function publishPointToPoint(request: APIRequestContext, supplier: Supplier, world: World): Promise<void> {
  const product = await createProductByApi(request, supplier, world, "point_to_point");
  const rules = await request.put(`/tenant/v1/products/${product.id}/service-rules`, { headers: { ...supplier.headers, "if-match": `"${product.version}"` }, data: RULES });
  expect(rules.status(), await rules.text()).toBe(200);
  const content = await request.put(`/tenant/v1/products/${product.id}/content`, { headers: { ...supplier.headers, "if-match": `"${((await rules.json()) as { version: number }).version}"` }, data: { zh: { title: "官网市内用车 QA" } } });
  expect(content.status(), await content.text()).toBe(200);
  const { today } = (await (await request.get(`/tenant/v1/products/${product.id}/price-rules`, { headers: supplier.headers })).json()) as { today: string };
  const version = ((await (await request.get(`/tenant/v1/products/${product.id}`, { headers: supplier.headers })).json()) as { version: number }).version;
  const created = await request.post(`/tenant/v1/products/${product.id}/price-rules/batch`, {
    headers: { ...supplier.headers, "if-match": `"${version}"`, "idempotency-key": crypto.randomUUID() },
    data: { create: [{ ...EMPTY_PRICE, ref: "a", area_id: supplier.area.id, vehicle_group_id: world.group.id, valid_from: today, valid_to: null, status: "enabled", pricing_model: "fixed", base_price: 15000 }], update: [], delete: [] },
  });
  expect(created.status(), await created.text()).toBe(200);
  const published = await request.post(`/tenant/v1/products/${product.id}/publish`, { headers: supplier.headers });
  expect(published.status(), await published.text()).toBe(200);
}

async function bookableWorld(request: APIRequestContext): Promise<World> {
  const world = await createWorld(request);
  await publishPointToPoint(request, await createSupplier(request, world), world);
  return world;
}

async function filesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(path)));
    else out.push(path);
  }
  return out;
}

/** 浏览器里谷歌的痕迹：密钥前缀和谷歌地图的接口 / 脚本地址 */
const GOOGLE_TRACES = [/AIza[0-9A-Za-z_-]{4,}/, /googleapis\.com/i, /gstatic\.com/i, /maps\.google\./i];

const coordinate = (page: Page, word: "上车" | "下车", which: "纬度" | "经度") => page.getByRole("group", { name: new RegExp(`${word}地点的坐标`) }).getByLabel(new RegExp(`^${which}`));

test("构建产物里没有谷歌的密钥和接口地址", async () => {
  const files = (await filesUnder(DIST)).filter((path) => /\.(js|css|html|json|map|txt)$/.test(path));
  expect(files.length, "先运行 pnpm web:build").toBeGreaterThan(0);
  for (const path of files) {
    const text = await readFile(path, "utf8");
    for (const trace of GOOGLE_TRACES) expect(trace.test(text), `${path} 里有 ${trace}`).toBe(false);
  }
});

test("密钥不进浏览器：搜索、选中、地图选点全程，应答、页面、存储里没有密钥；只连本站和底图；内容安全策略不放行谷歌，也没有违反策略的事件", async ({ page, request }) => {
  test.setTimeout(120_000);
  const world = await bookableWorld(request);
  const origins = new Set<string>();
  const bodies: { url: string; text: string }[] = [];
  page.on("request", (sent) => origins.add(new URL(sent.url()).origin));
  page.on("response", async (response) => {
    if (new URL(response.url()).origin !== SITE) return;
    try {
      bodies.push({ url: response.url(), text: await response.text() });
    } catch {
      // 跳转之类没有应答体的
    }
  });
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __cspViolations: string[] }).__cspViolations = seen;
    document.addEventListener("securitypolicyviolation", (event) => seen.push(`${event.violatedDirective} ${event.blockedURI}`));
  });

  const landing = await page.goto(`${SITE}/book`);
  const csp = (await landing?.allHeaders())?.["content-security-policy"] ?? "";
  const directives = new Map(csp.split(";").map((part) => part.trim().split(/\s+/)).filter((parts) => parts[0] !== "").map((parts) => [parts[0] as string, parts.slice(1)]));
  expect(directives.get("connect-src"), csp).toEqual(["'self'"]);
  expect(directives.get("img-src"), csp).toEqual(["'self'", TILE_ORIGIN]);
  expect(directives.get("default-src"), csp).toEqual(["'self'"]);
  expect(/google|gstatic/i.test(csp), csp).toBe(false);

  await page.getByLabel(/^城市/).selectOption({ label: world.city.name });
  const search = page.getByRole("searchbox", { name: "搜索上车地点（选填）" });
  await search.fill("東京駅");
  await search.press("Enter");
  await page.getByRole("list", { name: "搜索到的上车地点" }).getByRole("button", { name: /東京駅/ }).click();
  await expect(coordinate(page, "上车", "纬度")).toHaveValue("35.6812");
  await page.getByRole("button", { name: "在地图上选下车地点" }).click();
  await page.getByRole("button", { name: "选地图中间这个位置" }).click();
  await expect(page.getByText("已填入这个位置的地址和坐标，可以在地址后面补充酒店名、楼层。")).toBeVisible();
  await expect(coordinate(page, "下车", "纬度")).toHaveValue(String(CENTER.lat));

  expect(bodies.some((body) => body.url.includes("/site/v1/places/search")), "浏览器发了搜索").toBe(true);
  expect(bodies.some((body) => body.url.includes("/site/v1/places/reverse")), "浏览器发了反查").toBe(true);
  for (const body of bodies) for (const trace of GOOGLE_TRACES) expect(trace.test(body.text), `${body.url} 的应答里有 ${trace}`).toBe(false);
  const html = await page.content();
  for (const trace of GOOGLE_TRACES) expect(trace.test(html), `页面里有 ${trace}`).toBe(false);
  const stored = await page.evaluate(() => JSON.stringify({ cookie: document.cookie, local: { ...localStorage }, session: { ...sessionStorage } }));
  const cookies = JSON.stringify(await page.context().cookies());
  for (const trace of GOOGLE_TRACES) expect(trace.test(stored) || trace.test(cookies), `浏览器存储里有 ${trace}`).toBe(false);
  expect([...origins].filter((origin) => origin !== SITE && origin !== TILE_ORIGIN)).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations)).toEqual([]);
});

test("键盘：搜索框回车只搜索不询价；地图聚焦后 + / - 真的缩放、方向键平移，Tab 到「选地图中间这个位置」回车选中准星处", async ({ page, request }) => {
  test.setTimeout(120_000);
  const world = await bookableWorld(request);
  const quotes: string[] = [];
  const zooms: number[] = [];
  page.on("request", (sent) => {
    const url = new URL(sent.url());
    if (sent.method() === "POST" && url.pathname === "/site/v1/quotes") quotes.push(url.pathname);
    if (url.origin === TILE_ORIGIN) zooms.push(Number(url.pathname.split("/")[1]));
  });
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(`${SITE}/book`);
  await page.getByLabel(/^城市/).selectOption({ label: world.city.name });

  const search = page.getByRole("searchbox", { name: "搜索上车地点（选填）" });
  await search.focus();
  await page.keyboard.type("東京駅");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("list", { name: "搜索到的上车地点" })).toBeVisible();
  expect(quotes, "回车发了询价").toEqual([]);
  await expect(page.getByText("有几项没有填好，请看标红的地方。")).toHaveCount(0);

  const toggle = page.getByRole("button", { name: "在地图上选下车地点" });
  await toggle.focus();
  await page.keyboard.press("Enter");
  const map = page.getByRole("application", { name: /地图：点一下选下车位置/ });
  await expect(map).toBeVisible();
  await expect.poll(() => zooms.length).toBeGreaterThan(0);
  const startZoom = Math.max(...zooms);
  await map.focus();
  await expect(map).toBeFocused();
  zooms.length = 0;
  await page.keyboard.press("+");
  await expect.poll(() => Math.max(0, ...zooms), { message: "按 + 没有放大" }).toBe(startZoom + 1);
  zooms.length = 0;
  await page.keyboard.press("-");
  await page.keyboard.press("-");
  await expect.poll(() => (zooms.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...zooms)), { message: "按 - 没有缩小" }).toBe(startZoom - 1);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowUp");

  // 只用 Tab 走到「选地图中间这个位置」，回车选中
  const pickCenter = page.getByRole("button", { name: "选地图中间这个位置" });
  for (let i = 0; i < 6 && !(await pickCenter.evaluate((element) => element === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(pickCenter).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("已填入这个位置的地址和坐标，可以在地址后面补充酒店名、楼层。")).toBeVisible();
  const lat = Number(await coordinate(page, "下车", "纬度").inputValue());
  const lng = Number(await coordinate(page, "下车", "经度").inputValue());
  expect(lat, "方向键往上移动了地图").toBeGreaterThan(CENTER.lat);
  expect(lng, "方向键往左移动了地图").toBeLessThan(CENTER.lng);
  expect(quotes, "选点过程发了询价").toEqual([]);
});

test("配置里没有地址搜索、没有底图：没有搜索框和地图按钮，常用地点和手填照常，浏览器不请求 /site/v1/places", async ({ page, request }) => {
  test.setTimeout(120_000);
  const world = await bookableWorld(request);
  const placesCalls: string[] = [];
  page.on("request", (sent) => {
    if (new URL(sent.url()).pathname.startsWith("/site/v1/places/")) placesCalls.push(sent.url());
  });
  await page.route("**/site/v1/config", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["address_search"], "这组 API 本来是有地址搜索的").toBe(true);
    await route.fulfill({ response, json: { ...body, address_search: false, map_tiles: null } });
  });
  await page.goto(`${SITE}/book`);
  await page.getByLabel(/^城市/).selectOption({ label: world.city.name });
  await expect(page.getByLabel("上车地址或酒店名")).toBeVisible();
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /在地图上选/ })).toHaveCount(0);
  await expect(page.getByRole("application")).toHaveCount(0);
  await page.getByLabel("上车地址或酒店名").fill("東京駅 丸の内北口");
  await coordinate(page, "上车", "纬度").fill("35.6812");
  await coordinate(page, "上车", "经度").fill("139.7671");
  await expect(coordinate(page, "上车", "经度")).toHaveValue("139.7671");
  expect(placesCalls).toEqual([]);
});
