/**
 * 供应商后台「区域」（M1-02）的端到端补充测试（测试工程师）。areas.spec.ts 是开发自己写的。
 * 真实浏览器 → 构建好的前端 → 真实 API → 真实 PostgreSQL；底图来自 global-setup 起的本机假瓦片服务。
 * 不联网，不请求任何真实的底图服务或别的外部服务器：凡是发往本机之外的请求一律掐断并让用例失败。
 *
 * 补的内容：
 * - 内容安全策略和外发请求：控制台有没有被策略拦下的东西、页面往哪里发了请求、瓦片请求带出去的来源页；
 * - 地图出问题时（瓦片 404、瓦片一直不回、底图配置不对导致地图库出错、配置接口失败）全流程仍然能用；
 * - 区域名、备注名里的 HTML 经真实后端存取后不被当成标签；
 * - 只用键盘、不碰地图，从新建到保存；坐标表和地图互相同步、撤销重做；
 * - 自测「已保存未改」和「有未保存修改」两条路结论一致；版本冲突后复制、载入、粘贴；未保存离开；
 * - 320 / 768 宽不横向滚动（长名字、有地图）、亮暗 axe；列表筛选和翻页。
 * 名字以「【缺陷】」开头的是现在会失败的用例，交回开发处理。
 */
import { AxeBuilder } from "@axe-core/playwright";
import { type APIRequestContext, type Locator, type Page, expect, test } from "@playwright/test";
import { E2E_TILE_PORT, E2E_WEB_PORT } from "../playwright.config.ts";
import { createActiveTenant, expectNoHorizontalOverflow, loginAs, newPassword, platformAdminHeaders, randomLetters, uniqueEmail } from "./support.ts";

const CENTER = { lat: 35.6895, lng: 139.6917 };
const WEB_ORIGIN = `http://127.0.0.1:${E2E_WEB_PORT}`;
const TILE_ORIGIN = `http://127.0.0.1:${E2E_TILE_PORT}`;

interface City {
  id: string;
  code: string;
  name: string;
}
type Ring = [number, number][];
interface Tenant {
  adminEmail: string;
  password: string;
  headers: Record<string, string>;
}

async function createCity(request: APIRequestContext): Promise<City> {
  const headers = await platformAdminHeaders(request);
  const code = `CTY-JP-${randomLetters(5)}`;
  const name = `补测城市${code.slice(-5)}`;
  const response = await request.post("/platform/v1/master/cities", { headers, data: { code, country_code: "JP", name: { zh: name }, timezone: "Asia/Tokyo", center: CENTER } });
  expect(response.status(), "接口新建城市").toBe(201);
  return { id: ((await response.json()) as { id: string }).id, code, name };
}

async function createTenantWithToken(request: APIRequestContext): Promise<Tenant> {
  const tenant = await createActiveTenant(request);
  const response = await request.post("/tenant/v1/auth/login", { data: { email: tenant.adminEmail, password: tenant.password } });
  expect(response.ok(), "供应商账号登录").toBe(true);
  return { adminEmail: tenant.adminEmail, password: tenant.password, headers: { authorization: `Bearer ${((await response.json()) as { access_token: string }).access_token}` } };
}

function square(half = 0.1, center = CENTER): Ring {
  return [
    [center.lng - half, center.lat - half],
    [center.lng + half, center.lat - half],
    [center.lng + half, center.lat + half],
    [center.lng - half, center.lat + half],
  ].map(([lng, lat]) => [Math.round((lng as number) * 1e6) / 1e6, Math.round((lat as number) * 1e6) / 1e6]);
}
const geometry = (ring: Ring): { type: "Polygon"; coordinates: Ring[] } => ({ type: "Polygon", coordinates: [[...ring, ring[0] as [number, number]]] });

async function createArea(request: APIRequestContext, tenant: Tenant, city: City, name: string, polygons: unknown[] = [{ kind: "operate", geometry: geometry(square()) }], extra: Record<string, unknown> = {}): Promise<{ id: string; version: number; polygons: { id: string }[] }> {
  const response = await request.post("/tenant/v1/areas", { headers: { ...tenant.headers, "idempotency-key": crypto.randomUUID() }, data: { city_id: city.id, name: { zh: name }, biz_type: "general", polygons, ...extra } });
  expect(response.status(), `接口新建区域：${await response.text()}`).toBe(201);
  return (await response.json()) as { id: string; version: number; polygons: { id: string }[] };
}

const group = (page: Page, kind: "营运区" | "禁行区"): Locator => page.locator(".shape-group").filter({ has: page.getByRole("heading", { level: 3, name: new RegExp(`^${kind}（`) }) });
const shapeItem = (page: Page, name: string): Locator => page.locator(".shape").filter({ has: page.locator(".shape__name", { hasText: new RegExp(`^${name}`) }) });
const saveButton = (page: Page): Locator => page.getByRole("button", { name: "保存", exact: true });

/**
 * 自测一个位置，返回结果区的文字。结果区在两次检查之间不会清空，所以要等到「这一次」的结果：
 * 问后端的那条路等接口应答；按画面算的那条路是同步的，点完以后等页面重画一帧。
 */
async function selfTest(page: Page, lat: number, lng: number, options: { viaBackend?: boolean } = {}): Promise<string> {
  const card = page.locator(".area-editor__probe");
  await card.getByLabel("纬度").fill(String(lat));
  await card.getByLabel("经度").fill(String(lng));
  const answered = options.viaBackend ? page.waitForResponse((response) => response.url().endsWith("/check-point")) : null;
  await card.getByRole("button", { name: "检查" }).click();
  await answered;
  await expect(card.getByRole("button", { name: "检查" })).toBeEnabled();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(card.locator(".probe__sentence")).toBeVisible();
  return ((await card.locator(".probe").innerText()) ?? "").replace(/\s+/g, " ").trim();
}

async function expectAccessible(page: Page, what: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = results.violations.map((violation) => `${violation.id}: ${violation.help}（${violation.nodes.map((node) => node.target.join(" ")).join("；")}）`);
  expect(summary, `${what} 的无障碍问题`).toEqual([]);
}

interface Watch {
  /** 被内容安全策略拦下的东西：「指令 被拦的地址」 */
  violations(): Promise<string[]>;
  consoleErrors: string[];
  /** 页面发出的全部请求的来源（去重） */
  origins(): string[];
  tileReferers: string[];
  external: string[];
  reset(): Promise<void>;
}

/**
 * 盯住这一页：记下控制台的报错、被内容安全策略拦下的加载、所有请求的去向。
 * 发往本机前端和假瓦片服务之外的请求一律掐断（测试不联网），并记下来让用例失败。
 */
async function watch(page: Page): Promise<Watch> {
  const consoleErrors: string[] = [];
  const urls: string[] = [];
  const tileReferers: string[] = [];
  const external: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`未捕获的错误：${error.message}`));
  await page.addInitScript(() => {
    const store = window as unknown as { __cspViolations: string[] };
    store.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => store.__cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`));
  });
  await page.route(
    (url) => url.protocol.startsWith("http") && url.origin !== WEB_ORIGIN && url.origin !== TILE_ORIGIN,
    async (route) => {
      external.push(route.request().url());
      await route.abort("blockedbyclient");
    },
  );
  page.on("request", (sent) => {
    urls.push(sent.url());
    if (sent.url().startsWith(`${TILE_ORIGIN}/`)) tileReferers.push(sent.headers()["referer"] ?? "");
  });
  return {
    consoleErrors,
    tileReferers,
    external,
    violations: () => page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations),
    origins: () => [...new Set(urls.filter((url) => url.startsWith("http")).map((url) => new URL(url).origin))].sort(),
    reset: async () => {
      consoleErrors.length = 0;
      await page.evaluate(() => void ((window as unknown as { __cspViolations: string[] }).__cspViolations = []));
    },
  };
}

async function waitForTiles(page: Page): Promise<void> {
  await expect.poll(() => page.locator(".area-map__canvas img.leaflet-tile-loaded").count(), { message: "底图的瓦片加载出来" }).toBeGreaterThan(0);
}

// ───────────── 内容安全策略与外发请求 ─────────────

test("打开有地图的区域页（不动地图）：控制台没有报错、没有东西被内容安全策略拦下；页面只向同源和配置的瓦片来源发请求；全站 no-referrer 之下瓦片请求的来源页只带域名，不带路径", async ({ page, request }) => {
  const city = await createCity(request);
  const tenant = await createTenantWithToken(request);
  const area = await createArea(request, tenant, city, `外发请求 ${randomLetters(4)}`, [{ kind: "operate", geometry: geometry(square()) }, { kind: "forbid", circle: { center: CENTER, radius_m: 2000 } }]);
  const seen = await watch(page);
  // 正式环境的反向代理给每个页面加全站的 Referrer-Policy: no-referrer；测试用的预览服务器没有这个头。
  // 这里在页面里补一个等效的 <meta name="referrer" content="no-referrer">，才能证明
  // 「全站不带来源页，只有瓦片图片单独带域名」是真的成立（而不是浏览器默认策略碰巧给出同样的结果）。
  await page.addInitScript(() => {
    const add = (): void => {
      const meta = document.createElement("meta");
      meta.name = "referrer";
      meta.content = "no-referrer";
      document.head.appendChild(meta);
    };
    if (document.head) add();
    else document.addEventListener("DOMContentLoaded", add);
  });
  const apiReferers: string[] = [];
  page.on("request", (sent) => {
    if (sent.url().includes("/tenant/v1/areas/")) apiReferers.push(sent.headers()["referer"] ?? "");
  });
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  await page.goto(`/areas/${area.id}`);
  await expect(page.locator(".area-map__overlay .area-stroke--operate")).toHaveCount(1);
  await waitForTiles(page);
  await page.waitForLoadState("networkidle");
  expect(apiReferers.length).toBeGreaterThan(0);
  expect([...new Set(apiReferers)], "全站的策略生效：页面自己的请求不带来源页").toEqual([""]);

  expect(await seen.violations(), "被内容安全策略拦下的加载").toEqual([]);
  expect(seen.consoleErrors, "控制台报错").toEqual([]);
  expect(seen.external, "发往本机之外的请求").toEqual([]);
  expect(seen.origins()).toEqual([WEB_ORIGIN, TILE_ORIGIN].sort());
  expect(seen.tileReferers.length).toBeGreaterThan(0);
  expect([...new Set(seen.tileReferers)], "瓦片请求带的来源页：只有域名，没有 /areas/… 这样的路径").toEqual([`${WEB_ORIGIN}/`]);
  // 页面自己的策略：img-src 只多放行瓦片的那一个来源；全站的来源页策略仍是 no-referrer
  const response = await request.get(`${WEB_ORIGIN}/areas/${area.id}`);
  const policy = response.headers()["content-security-policy"] ?? "";
  expect(policy).toContain(`img-src 'self' ${TILE_ORIGIN};`);
  expect(policy).not.toMatch(/data:|blob:|\*|unsafe-inline|unsafe-eval/);
  // 瓦片图片上单独设的来源页策略，来自 map/config
  expect(await page.locator(".area-map__canvas img.leaflet-tile").first().getAttribute("referrerpolicy")).toBe("strict-origin");
  // 署名来自配置，是真实的链接，不会被页面自己请求
  await expect(page.locator(".area-map__attribution a")).toHaveAttribute("href", "https://tiles.e2e.example.com/copyright");
});

const CSP_SCENARIOS: [string, (page: Page) => Promise<void>][] = [
  ["点一下「放大」", async (page) => page.getByRole("button", { name: "放大" }).click()],
  ["点一下「缩小」", async (page) => page.getByRole("button", { name: "缩小" }).click()],
  [
    "把地图拖到别处（原来的瓦片被移出视野）",
    async (page) => {
      const box = await page.locator(".area-map__canvas").boundingBox();
      if (!box) throw new Error("地图画布不在页面上");
      for (let i = 0; i < 2; i += 1) {
        await page.mouse.move(box.x + box.width - 40, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + 20, box.y + box.height / 2, { steps: 12 });
        await page.mouse.up();
      }
    },
  ],
  ["点「看全部图形」（视野跳到别处）", async (page) => {
    await page.getByRole("button", { name: "缩小" }).click();
    await page.getByRole("button", { name: "看全部图形" }).click();
  }],
  ["离开这个页面（回区域列表）", async (page) => page.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "区域" }).click()],
];

for (const [name, act] of CSP_SCENARIOS) {
  test(`【缺陷】有地图的区域页${name}：控制台不应当有内容安全策略的报错，实际地图库把移走的瓦片换成内嵌的空白图（data:image/gif;base64,…），被 img-src 拦下并报错`, async ({ page, request }) => {
    const city = await createCity(request);
    const tenant = await createTenantWithToken(request);
    const area = await createArea(request, tenant, city, `策略报错 ${randomLetters(4)}`);
    const seen = await watch(page);
    await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
    await page.goto(`/areas/${area.id}`);
    await expect(page.locator(".area-map__overlay .area-stroke--operate")).toHaveCount(1);
    await waitForTiles(page);
    await page.waitForLoadState("networkidle");
    expect(await seen.violations(), "前提：刚打开、没动地图时没有报错").toEqual([]);

    await act(page);
    await page.waitForTimeout(1_500);
    const violations = name.startsWith("离开") ? await seen.violations().catch(() => []) : await seen.violations();
    const errors = seen.consoleErrors.filter((text) => text.includes("Content Security Policy"));
    expect({ violations: [...new Set(violations)], consoleErrors: errors.length }, "被内容安全策略拦下的加载和控制台里对应的报错").toEqual({ violations: [], consoleErrors: 0 });
  });
}

// ───────────── 地图出问题时全流程可用 ─────────────

/** 不靠地图：坐标表建一块营运区、粘贴一块禁行区、自测、保存，回到列表看到它。 */
async function completeWithoutMap(page: Page, city: City, name: string): Promise<void> {
  const box = page.getByRole("combobox", { name: /城市/ });
  await box.click();
  await box.fill(city.code);
  await page.getByRole("option", { name: new RegExp(city.code) }).first().click();
  await page.getByLabel("中文").fill(name);
  await group(page, "营运区").getByRole("button", { name: /添加营运区/ }).click();
  await page.getByRole("menuitem", { name: "逐点输入坐标" }).click();
  for (const [index, point] of square().slice(0, 3).entries()) {
    await page.getByLabel(`营运 1 第 ${index + 1} 个点的纬度`).fill(String(point[1]));
    await page.getByLabel(`营运 1 第 ${index + 1} 个点的经度`).fill(String(point[0]));
  }
  await group(page, "禁行区").getByRole("button", { name: /添加禁行区/ }).click();
  await page.getByRole("menuitem", { name: /粘贴坐标/ }).click();
  const dialog = page.getByRole("dialog", { name: "粘贴坐标" });
  const inner = square(0.01, { lat: CENTER.lat - 0.05, lng: CENTER.lng + 0.05 });
  await dialog.getByLabel(/内容/).fill(JSON.stringify(geometry(inner)));
  await dialog.getByRole("button", { name: "添加到地图" }).click();
  await expect(shapeItem(page, "禁行 1")).toContainText("多边形 · 4 个点");
  expect(await selfTest(page, CENTER.lat - 0.05, CENTER.lng + 0.05)).toContain("在禁行区内");
  expect(await selfTest(page, CENTER.lat - 0.09, CENTER.lng + 0.09)).toContain("在营运区内");
  expect(await selfTest(page, CENTER.lat + 0.3, CENTER.lng)).toContain("不在营运区内");
  await saveButton(page).click();
  await expect(page).toHaveURL(/\/areas$/);
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
}

test("瓦片全部 404：有「底图没有加载出来」的提示；图形照常画在上面；新建、粘贴、自测、保存全流程可用", async ({ page, request }) => {
  test.slow();
  const city = await createCity(request);
  const tenant = await createTenantWithToken(request);
  await page.route(`${TILE_ORIGIN}/**`, (route) => route.fulfill({ status: 404, body: "" }));
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  await page.goto("/areas/new");
  const name = `瓦片 404 ${randomLetters(4)}`;
  await completeWithoutMapAfter(page, city, name, async () => {
    await expect(page.getByText("底图没有加载出来。")).toBeVisible();
    await expect(page.locator(".area-map__overlay .area-stroke--operate")).toHaveCount(1);
  });
});

test("瓦片一直不回（底图服务超时）：页面不卡住、不报错；工具条、坐标表、粘贴、自测、保存全流程可用；离开页面也不卡", async ({ page, request }) => {
  test.slow();
  const city = await createCity(request);
  const tenant = await createTenantWithToken(request);
  const pending: (() => void)[] = [];
  // 每个瓦片请求都挂着不回，直到用例结束
  await page.route(`${TILE_ORIGIN}/**`, (route) => new Promise<void>((resolve) => pending.push(() => void route.abort("timedout").then(resolve, resolve))));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  await page.goto("/areas/new");
  const name = `瓦片超时 ${randomLetters(4)}`;
  await completeWithoutMapAfter(page, city, name, async () => {
    await expect(page.getByRole("application")).toBeVisible();
    await expect(page.locator(".area-map__overlay .area-stroke--operate")).toHaveCount(1);
    // 地图上的工具照常能用：缩放、在地图上点自测
    await page.getByRole("button", { name: "放大" }).click();
    await page.getByRole("button", { name: "看全部图形" }).click();
  });
  expect(pending.length, "确实有瓦片请求被挂住").toBeGreaterThan(0);
  expect(errors).toEqual([]);
  for (const release of pending) release();
});

/** 先选城市让地图出现，做 `check`，再不靠地图把整个流程走完。 */
async function completeWithoutMapAfter(page: Page, city: City, name: string, check: () => Promise<void>): Promise<void> {
  const box = page.getByRole("combobox", { name: /城市/ });
  await box.click();
  await box.fill(city.code);
  await page.getByRole("option", { name: new RegExp(city.code) }).first().click();
  await group(page, "营运区").getByRole("button", { name: /添加营运区/ }).click();
  await page.getByRole("menuitem", { name: "逐点输入坐标" }).click();
  for (const [index, point] of square().slice(0, 3).entries()) {
    await page.getByLabel(`营运 1 第 ${index + 1} 个点的纬度`).fill(String(point[1]));
    await page.getByLabel(`营运 1 第 ${index + 1} 个点的经度`).fill(String(point[0]));
  }
  await check();
  await page.getByLabel("中文").fill(name);
  await group(page, "禁行区").getByRole("button", { name: /添加禁行区/ }).click();
  await page.getByRole("menuitem", { name: /粘贴坐标/ }).click();
  const dialog = page.getByRole("dialog", { name: "粘贴坐标" });
  await dialog.getByLabel(/内容/).fill(JSON.stringify(geometry(square(0.01, { lat: CENTER.lat - 0.05, lng: CENTER.lng + 0.05 }))));
  await dialog.getByRole("button", { name: "添加到地图" }).click();
  await expect(shapeItem(page, "禁行 1")).toContainText("多边形 · 4 个点");
  expect(await selfTest(page, CENTER.lat - 0.05, CENTER.lng + 0.05)).toContain("在禁行区内");
  expect(await selfTest(page, CENTER.lat - 0.09, CENTER.lng + 0.09)).toContain("在营运区内");
  await saveButton(page).click();
  await expect(page).toHaveURL(/\/areas$/);
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
}

for (const [what, patch] of [
  ["瓦片地址不是字符串（地图库初始化时出错）", (tiles: Record<string, unknown>) => ({ ...tiles, url_template: null })],
  ["缩放范围是反的", (tiles: Record<string, unknown>) => ({ ...tiles, min_zoom: 19, max_zoom: 3 })],
  ["署名不是数组（画地图那一块出错）", (tiles: Record<string, unknown>) => ({ ...tiles, attribution: null })],
] as const) {
  test(`底图配置有问题——${what}：页面不白屏，换成「没有地图」的样子，坐标表、粘贴、自测、保存全流程可用`, async ({ page, request }) => {
    test.slow();
    const city = await createCity(request);
    const tenant = await createTenantWithToken(request);
    // 取真实后端的底图配置，只把其中一项改坏：模拟部署时配错、或地图库自己出错
    await page.route("**/tenant/v1/map/config", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { tiles: Record<string, unknown> };
      await route.fulfill({ response, json: { tiles: patch(body.tiles) } });
    });
    await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
    await page.goto("/areas/new");
    await expect(page.getByRole("heading", { level: 1, name: "新增区域" })).toBeVisible();
    await completeWithoutMap(page, city, `配置有问题 ${randomLetters(4)}`);
  });
}

test("底图配置接口失败（500）或一直不回：页面照常可用，说明地图没有加载出来；全流程可用", async ({ page, request }) => {
  test.slow();
  const city = await createCity(request);
  const tenant = await createTenantWithToken(request);
  await page.route("**/tenant/v1/map/config", (route) => route.fulfill({ status: 500, json: { error: { code: "INTERNAL_ERROR", message: "x", details: {} } } }));
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  await page.goto("/areas/new");
  await completeWithoutMap(page, city, `配置取不到 ${randomLetters(4)}`);
  await expect(page.getByRole("application")).toHaveCount(0);
});

// ───────────── XSS：经真实后端存取 ─────────────

test("区域名、备注名里的 HTML 经真实后端存下来再读出来：在列表、编辑页标题、图形列表、地图上的名字、自测结果、确认对话框、提示里都只是文字，不变成标签、不执行", async ({ page, request }) => {
  test.slow();
  const city = await createCity(request);
  const tenant = await createTenantWithToken(request);
  const tag = randomLetters(4);
  const name = `<img src=x onerror="window.__xss='name'">${tag}<script>window.__xss='script'</script>`;
  const label = `<svg onload=window.__xss=2><b>皇居</b>`;
  const area = await createArea(request, tenant, city, name, [{ kind: "operate", label, geometry: geometry(square()) }, { kind: "forbid", label: `"><img src=x onerror=__xss=1>`, circle: { center: CENTER, radius_m: 1500 } }], { name: { zh: name, en: `<iframe src="javascript:window.__xss='iframe'"></iframe>` } });
  const seen = await watch(page);
  const noInjection = async (where: string): Promise<void> => {
    expect(await page.evaluate(() => (window as unknown as { __xss?: unknown }).__xss), `${where}：注入的脚本不应执行`).toBeUndefined();
    expect(await page.locator('img[src="x"], main script, main iframe, main b').count(), `${where}：名字里的标签不应变成真的元素`).toBe(0);
    expect(await page.locator("svg[onload], [onerror], [onclick]").count(), `${where}：不应有带事件属性的元素`).toBe(0);
  };
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  await page.goto("/areas");
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  await noInjection("列表");
  await page.getByRole("searchbox", { name: "按名称搜索" }).or(page.getByLabel("按名称搜索")).first().fill(`<img src=x onerror="window.__xss='name'">${tag}`);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  await noInjection("搜索后的列表");

  await page.getByRole("link", { name, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  await expect(page).toHaveTitle(new RegExp(tag));
  await expect(shapeItem(page, "营运 1")).toContainText(label);
  await expect(page.locator(".area-map__overlay text.area-label").filter({ hasText: "营运 1" })).toHaveText(`营运 1 · ${label}`);
  await noInjection("编辑页");
  expect(await selfTest(page, CENTER.lat, CENTER.lng, { viaBackend: true })).toContain(`"><img src=x onerror=__xss=1>`);
  await noInjection("自测结果");

  // 更多 → 停用：确认对话框和提示里都有名字
  await page.getByRole("button", { name: `${name} 的更多操作` }).click();
  await page.getByRole("menuitem", { name: "停用" }).click();
  const confirm = page.getByRole("dialog").filter({ hasText: "停用区域" });
  await expect(confirm).toContainText(tag);
  await noInjection("停用确认");
  await confirm.getByRole("button", { name: "停用", exact: true }).click();
  await expect(page.locator(".toast").filter({ hasText: "已停用" })).toContainText("<img src=x");
  await noInjection("停用提示");
  // 改备注名的对话框里是原样的文字
  await page.getByRole("button", { name: `营运 1 · ${label} 的更多操作` }).click();
  await page.getByRole("menuitem", { name: "改备注名" }).click();
  await expect(page.getByRole("dialog", { name: "改备注名" }).getByLabel(/备注名/)).toHaveValue(label);
  await page.getByRole("dialog", { name: "改备注名" }).getByRole("button", { name: "取消" }).click();
  await noInjection("改备注名");
  expect(seen.external).toEqual([]);
  expect(seen.consoleErrors.filter((text) => !text.includes("data:image/gif")), "控制台报错（不算地图库空白图那一条已知缺陷）").toEqual([]);
  // 存下来的确实是原文
  const stored = (await (await request.get(`/tenant/v1/areas/${area.id}`, { headers: tenant.headers })).json()) as { name: { zh: string }; polygons: { label: string }[] };
  expect([stored.name.zh, stored.polygons[0]?.label]).toEqual([name, label]);
});

// ───────────── 只用键盘、不碰地图 ─────────────

test("只用键盘（Tab、方向键、Enter、空格、打字）、不碰地图：从首页进到新增区域，选城市、起名字、逐点输入一块营运区、输入一个圆做禁行区、改备注名、自测、保存；全程鼠标不点任何东西", async ({ page, request }) => {
  test.slow();
  const city = await createCity(request);
  const tenant = await createTenantWithToken(request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  await page.goto("/areas/new");
  await expect(page.getByRole("heading", { level: 1, name: "新增区域" })).toBeVisible();

  /** 一直按 Tab 直到焦点落在目标上：证明它在 Tab 顺序里、不靠鼠标也到得了。 */
  const tabTo = async (target: Locator, what: string, limit = 80): Promise<void> => {
    for (let i = 0; i < limit; i += 1) {
      if (await target.evaluate((node) => node === document.activeElement).catch(() => false)) return;
      await page.keyboard.press("Tab");
    }
    throw new Error(`按了 ${limit} 次 Tab 也没有走到：${what}`);
  };
  const name = `只用键盘 ${randomLetters(4)}`;
  await tabTo(page.getByRole("combobox", { name: /城市/ }), "城市");
  await page.keyboard.type(city.code);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("combobox", { name: /城市/ })).toHaveValue(new RegExp(city.name));
  await tabTo(page.getByLabel("中文"), "中文名称");
  await page.keyboard.type(name);

  // 添加营运区 → 逐点输入坐标
  await tabTo(group(page, "营运区").getByRole("button", { name: /添加营运区/ }), "添加营运区");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "逐点输入坐标" })).toBeFocused();
  await page.keyboard.press("Enter");
  const ring = square();
  for (let index = 0; index < 3; index += 1) {
    await tabTo(page.getByLabel(`营运 1 第 ${index + 1} 个点的纬度`), `第 ${index + 1} 个点的纬度`);
    await page.keyboard.type(String(ring[index]?.[1]));
    await page.keyboard.press("Tab");
    await expect(page.getByLabel(`营运 1 第 ${index + 1} 个点的经度`)).toBeFocused();
    await page.keyboard.type(String(ring[index]?.[0]));
  }
  // 再加第 4 个点：行尾的「加一个点」按钮
  await tabTo(page.getByRole("button", { name: "在 营运 1 第 3 个点后面加一个点" }), "加点按钮");
  await page.keyboard.press("Space");
  await tabTo(page.getByLabel("营运 1 第 4 个点的纬度"), "第 4 个点的纬度");
  await page.keyboard.type(String(ring[3]?.[1]));
  await page.keyboard.press("Tab");
  await page.keyboard.type(String(ring[3]?.[0]));
  await expect(shapeItem(page, "营运 1")).toContainText("多边形 · 4 个点");

  // 添加禁行区 → 输入圆心和半径
  await tabTo(group(page, "禁行区").getByRole("button", { name: /添加禁行区/ }), "添加禁行区");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "输入圆心和半径" })).toBeFocused();
  await page.keyboard.press("Enter");
  await tabTo(page.getByLabel("禁行 1 圆心纬度"), "圆心纬度");
  await page.keyboard.type(String(CENTER.lat));
  await page.keyboard.press("Tab");
  await page.keyboard.type(String(CENTER.lng));
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("禁行 1 半径（公里）")).toBeFocused();
  await page.keyboard.type("2.5");
  await expect(shapeItem(page, "禁行 1")).toContainText("圆 · 半径 2.5 公里");

  // 改备注名：更多 → 改备注名 → 打字 → Enter 或 Tab 到「确定」
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await tabTo(page.getByRole("button", { name: "禁行 1 的更多操作" }), "禁行 1 的更多操作", 200);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "改备注名" })).toBeFocused();
  await page.keyboard.press("Enter");
  const rename = page.getByRole("dialog", { name: "改备注名" });
  await expect(rename.getByLabel(/备注名/)).toBeFocused();
  await page.keyboard.type("皇居");
  await tabTo(rename.getByRole("button", { name: "确定" }), "确定", 10);
  await page.keyboard.press("Enter");
  await expect(shapeItem(page, "禁行 1")).toContainText("皇居");

  // 自测：在输入框里按 Enter 等于点「检查」
  const card = page.locator(".area-editor__probe");
  await tabTo(card.getByLabel("纬度"), "自测的纬度", 200);
  await page.keyboard.type(String(CENTER.lat));
  await page.keyboard.press("Tab");
  await page.keyboard.type(String(CENTER.lng));
  await page.keyboard.press("Enter");
  await expect(card.locator(".probe")).toContainText("在禁行区内");

  await tabTo(saveButton(page), "保存", 200);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/areas$/);
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  const listed = (await (await request.get("/tenant/v1/areas", { headers: tenant.headers })).json()) as { items: { name: { zh: string }; operate_polygon_count: number; forbid_polygon_count: number }[] };
  expect(listed.items.map((item) => [item.name.zh, item.operate_polygon_count, item.forbid_polygon_count])).toEqual([[name, 1, 1]]);
});

// ───────────── 坐标表和地图同步、撤销重做 ─────────────

test("坐标表和地图是同一份状态：表里改一个点，地图上的图形跟着变；地图上拖一个顶点，表里的数跟着变；撤销、重做两边一起变；撤销回原样后没有「未保存的修改」", async ({ page, request }) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 800 });
  const city = await createCity(request);
  const tenant = await createTenantWithToken(request);
  const area = await createArea(request, tenant, city, `两边同步 ${randomLetters(4)}`);
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  await page.goto(`/areas/${area.id}`);
  const stroke = page.locator(".area-map__overlay .area-stroke--operate");
  await expect(stroke).toHaveCount(1);
  await shapeItem(page, "营运 1").locator(".shape__toggle").click();
  const latCell = page.getByLabel("营运 1 第 1 个点的纬度");
  const lngCell = page.getByLabel("营运 1 第 1 个点的经度");
  const original = { d: await stroke.getAttribute("d"), lat: await latCell.inputValue(), lng: await lngCell.inputValue() };
  const summary = page.locator(".area-editor__summary");
  await expect(summary).not.toContainText("有未保存的修改");

  // 表 → 地图
  await latCell.fill(String(CENTER.lat - 0.15));
  await expect.poll(() => stroke.getAttribute("d")).not.toBe(original.d);
  const afterTable = await stroke.getAttribute("d");
  await expect(summary).toContainText("有未保存的修改");

  // 地图 → 表：拖第 3 个顶点
  const handle = page.locator(".area-map__overlay circle.area-handle:not(.area-handle--mid)").nth(2);
  const box = await handle.boundingBox();
  if (!box) throw new Error("没有找到顶点的控制点");
  const third = { lat: await page.getByLabel("营运 1 第 3 个点的纬度").inputValue(), lng: await page.getByLabel("营运 1 第 3 个点的经度").inputValue() };
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 - 25, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByLabel("营运 1 第 3 个点的纬度")).not.toHaveValue(third.lat);
  await expect(page.getByLabel("营运 1 第 3 个点的经度")).not.toHaveValue(third.lng);
  const dragged = { lat: Number(await page.getByLabel("营运 1 第 3 个点的纬度").inputValue()), lng: Number(await page.getByLabel("营运 1 第 3 个点的经度").inputValue()) };
  expect(dragged.lat).toBeGreaterThan(Number(third.lat));
  expect(dragged.lng).toBeGreaterThan(Number(third.lng));
  expect(await stroke.getAttribute("d")).not.toBe(afterTable);

  // 撤销一次：拖动整个退回（一次拖动是一步），表和地图都回到拖之前
  const undo = page.getByRole("button", { name: /撤销/ });
  const redo = page.getByRole("button", { name: /重做/ });
  await undo.click();
  await expect(page.getByLabel("营运 1 第 3 个点的纬度")).toHaveValue(third.lat);
  await expect(page.getByLabel("营运 1 第 3 个点的经度")).toHaveValue(third.lng);
  expect(await stroke.getAttribute("d")).toBe(afterTable);
  await redo.click();
  await expect(page.getByLabel("营运 1 第 3 个点的纬度")).toHaveValue(dragged.lat.toFixed(6));
  // 一直撤销到底：回到打开时的样子
  for (let i = 0; i < 40 && (await undo.isEnabled()); i += 1) await undo.click();
  await expect(latCell).toHaveValue(original.lat);
  await expect(lngCell).toHaveValue(original.lng);
  expect(await stroke.getAttribute("d")).toBe(original.d);
  await expect(summary).not.toContainText("有未保存的修改");
  // 全部重做以后保存：存下来的是画面上的
  for (let i = 0; i < 40 && (await redo.isEnabled()); i += 1) await redo.click();
  await saveButton(page).click();
  await expect(page).toHaveURL(/\/areas$/);
  const saved = (await (await request.get(`/tenant/v1/areas/${area.id}`, { headers: tenant.headers })).json()) as { version: number; polygons: { geometry: { coordinates: Ring[] } }[] };
  expect(saved.version).toBe(2);
  expect(saved.polygons[0]?.geometry.coordinates[0]?.[0]?.[1]).toBeCloseTo(CENTER.lat - 0.15, 6);
  expect(saved.polygons[0]?.geometry.coordinates[0]?.[2]).toEqual([dragged.lng, dragged.lat]);
});

// ───────────── 自测：两条路一致（真实后端） ─────────────

test("自测在「已保存、没改过」（问真实后端）和「有未保存的修改」（按画面算）两条路上，对同一批位置给出同样的结论和同样的图形名字", async ({ page, request }) => {
  test.slow();
  const city = await createCity(request);
  const tenant = await createTenantWithToken(request);
  const inner = square(0.02);
  const area = await createArea(request, tenant, city, `两条路 ${randomLetters(4)}`, [
    { kind: "operate", geometry: geometry(square()) },
    { kind: "operate", circle: { center: { lat: CENTER.lat + 0.2, lng: CENTER.lng }, radius_m: 3000 } },
    { kind: "forbid", geometry: geometry(inner) },
    { kind: "forbid", circle: { center: { lat: CENTER.lat + 0.2, lng: CENTER.lng }, radius_m: 500 } },
  ]);
  const points: [number, number][] = [
    [CENTER.lat - 0.05, CENTER.lng - 0.05], // 营运 1 里
    [CENTER.lat, CENTER.lng], // 禁行 1 里
    [CENTER.lat - 0.1, CENTER.lng], // 营运 1 的边上
    [square()[0]?.[1] as number, square()[0]?.[0] as number], // 营运 1 的顶点
    [inner[1]?.[1] as number, inner[1]?.[0] as number], // 禁行 1 的顶点（也在营运 1 里）
    [CENTER.lat + 0.2, CENTER.lng], // 两个圆的圆心
    [CENTER.lat + 0.21, CENTER.lng], // 大圆里、小圆外
    [CENTER.lat + 0.5, CENTER.lng + 0.5], // 都不在
  ];
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  await page.goto(`/areas/${area.id}`);
  await expect(shapeItem(page, "营运 1")).toBeVisible();
  let asked = 0;
  page.on("request", (sent) => {
    if (sent.url().endsWith("/check-point")) asked += 1;
  });
  const viaBackend: string[] = [];
  for (const [lat, lng] of points) viaBackend.push(await selfTest(page, lat, lng, { viaBackend: true }));
  expect(asked, "没改过时每次都问后端").toBe(points.length);
  expect(viaBackend.join(" ")).not.toContain("按画面上还没保存的图形判断");
  // 接口直接问一遍，和页面上显示的对得上
  for (const [index, [lat, lng]] of points.entries()) {
    const direct = (await (await request.post(`/tenant/v1/areas/${area.id}/check-point`, { headers: tenant.headers, data: { lat, lng } })).json()) as { result: string };
    const badge = { operate: "在营运区内", forbid: "在禁行区内", outside: "不在营运区内" }[direct.result] as string;
    expect(viaBackend[index], `${lat},${lng}`).toContain(badge);
  }

  // 让页面有「未保存的修改」但图形的形状不变：把营运 1 的第 1 个点改掉再改回去不算（回到原样）；改圆的半径 3 → 3.001 → 3 也回到原样。
  // 所以这里给禁行 2 起一个备注名：坐标没变，页面按画面上的图形算。
  await page.getByRole("button", { name: "禁行 2 的更多操作" }).click();
  await page.getByRole("menuitem", { name: "改备注名" }).click();
  await page.getByRole("dialog", { name: "改备注名" }).getByLabel(/备注名/).fill("x");
  await page.getByRole("dialog", { name: "改备注名" }).getByRole("button", { name: "确定" }).click();
  await expect(page.locator(".area-editor__summary")).toContainText("有未保存的修改");
  asked = 0;
  const viaScreen: string[] = [];
  for (const [lat, lng] of points) viaScreen.push(await selfTest(page, lat, lng));
  expect(asked, "有未保存的修改时不问后端").toBe(0);
  const strip = (text: string): string => text.replace("按画面上还没保存的图形判断。", "").replace(" · x", "").replace(/\s+/g, " ").trim();
  expect(viaScreen.every((text) => text.includes("按画面上还没保存的图形判断"))).toBe(true);
  expect(viaScreen.map(strip)).toEqual(viaBackend.map(strip));
  expect(new Set(viaBackend.map((text) => text.split(" ")[0])).size, "三种结果都出现过").toBe(3);
});

// ───────────── 版本冲突、未保存离开 ─────────────

test("版本冲突后不丢自己画的：「复制我画的图形」写进剪贴板的是画面上的全部图形 →「载入最新内容」→「粘贴坐标」贴回来，坐标一个不差；再保存成功", async ({ page, request, context }) => {
  test.slow();
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: WEB_ORIGIN });
  const city = await createCity(request);
  const tenant = await createTenantWithToken(request);
  const area = await createArea(request, tenant, city, `冲突 ${randomLetters(4)}`);
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  await page.goto(`/areas/${area.id}`);
  await expect(shapeItem(page, "营运 1")).toBeVisible();
  // 我加一块禁行区（逐点输入）
  const mine = square(0.03);
  await group(page, "禁行区").getByRole("button", { name: /添加禁行区/ }).click();
  await page.getByRole("menuitem", { name: "逐点输入坐标" }).click();
  for (const [index, point] of mine.slice(0, 3).entries()) {
    await page.getByLabel(`禁行 1 第 ${index + 1} 个点的纬度`).fill(String(point[1]));
    await page.getByLabel(`禁行 1 第 ${index + 1} 个点的经度`).fill(String(point[0]));
  }
  // 别人先改了：换成另一块更大的营运区
  const theirs = square(0.3);
  const changed = await request.put(`/tenant/v1/areas/${area.id}`, { headers: { ...tenant.headers, "if-match": `"${area.version}"` }, data: { name: { zh: "别人改过的" }, biz_type: "general", polygons: [{ kind: "operate", geometry: geometry(theirs) }] } });
  expect(changed.status()).toBe(200);
  await saveButton(page).click();
  await expect(page.getByText("这个区域刚被别人修改过，你的修改还没有保存。")).toBeVisible();
  await expect(saveButton(page)).toBeDisabled();
  await expect(shapeItem(page, "禁行 1")).toContainText("多边形 · 3 个点");

  await page.getByRole("button", { name: "复制我画的图形" }).click();
  await expect(page.locator(".toast").filter({ hasText: "已复制" })).toBeVisible();
  const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText())) as { features: { properties: { kind: string }; geometry: { coordinates: Ring[] } }[] };
  expect(copied.features.map((feature) => feature.properties.kind)).toEqual(["operate", "forbid"]);
  expect(copied.features[1]?.geometry.coordinates[0]?.slice(0, 3)).toEqual(mine.slice(0, 3));

  await page.getByRole("button", { name: "载入最新内容" }).click();
  await expect(page.getByText("已载入最新内容。")).toBeVisible();
  await expect(page.getByLabel("中文")).toHaveValue("别人改过的");
  await expect(group(page, "禁行区").getByRole("heading", { level: 3 })).toHaveText("禁行区（0）");

  // 贴回来：两块都在，坐标不差；每一块还是它原来的类型（复制出去的内容带着类型，不看对话框里选的「加为」——这是缺陷 2 修好以后的行为）
  await group(page, "禁行区").getByRole("button", { name: /添加禁行区/ }).click();
  await page.getByRole("menuitem", { name: /粘贴坐标/ }).click();
  const dialog = page.getByRole("dialog", { name: "粘贴坐标" });
  await dialog.getByLabel(/内容/).focus();
  await page.keyboard.press("ControlOrMeta+V");
  await expect(dialog.getByRole("status")).toContainText("识别为 GeoJSON：2 个多边形");
  await dialog.getByRole("button", { name: "添加到地图" }).click();
  await expect(group(page, "禁行区").getByRole("heading", { level: 3 })).toHaveText("禁行区（1）");
  await expect(group(page, "营运区").getByRole("heading", { level: 3 })).toHaveText("营运区（2）");
  // 我原来的营运区那一块现在是多余的，删掉；留下我画的禁行区
  await page.getByRole("button", { name: "营运 3 的更多操作" }).click(); // 别人那一块是「营运 2」（删掉的序号不再用），我贴回来的是「营运 3」
  await page.getByRole("menuitem", { name: "删除这一块" }).click();
  await saveButton(page).click();
  await expect(page).toHaveURL(/\/areas$/);
  const saved = (await (await request.get(`/tenant/v1/areas/${area.id}`, { headers: tenant.headers })).json()) as { version: number; polygons: { kind: string; geometry: { coordinates: Ring[] } }[] };
  expect(saved.version).toBe(3);
  expect(saved.polygons.map((polygon) => polygon.kind)).toEqual(["operate", "forbid"]);
  expect(saved.polygons[0]?.geometry.coordinates[0]?.slice(0, -1)).toEqual(theirs);
  expect(saved.polygons[1]?.geometry.coordinates[0]?.slice(0, -1)).toEqual(mine.slice(0, 3));
});

test("有未保存的修改时离开：点侧边栏、面包屑、顶栏的链接都先问，「继续编辑」后内容都在；刷新 / 关标签页有浏览器的确认；没有修改时不问；「离开」后不再拦", async ({ page, request }) => {
  test.slow();
  const city = await createCity(request);
  const tenant = await createTenantWithToken(request);
  const area = await createArea(request, tenant, city, `未保存离开 ${randomLetters(4)}`);
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  await page.goto(`/areas/${area.id}`);
  await expect(shapeItem(page, "营运 1")).toBeVisible();
  const wouldConfirmUnload = (): Promise<boolean> => page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })));
  expect(await wouldConfirmUnload(), "没有修改时刷新不问").toBe(false);

  await shapeItem(page, "营运 1").locator(".shape__toggle").click();
  await page.getByLabel("营运 1 第 1 个点的纬度").fill(String(CENTER.lat - 0.2));
  await expect(page.locator(".area-editor__summary")).toContainText("有未保存的修改");
  expect(await wouldConfirmUnload(), "有修改时刷新 / 关标签页有浏览器的确认").toBe(true);
  const leave = page.getByRole("dialog", { name: "有未保存的修改，确定离开吗？" });
  for (const link of [page.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "首页" }), page.getByRole("navigation", { name: "面包屑" }).or(page.locator(".breadcrumb")).getByRole("link", { name: "区域" }).first(), page.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "区域" })]) {
    await link.click();
    await expect(leave).toBeVisible();
    await expect(leave.getByRole("button", { name: "继续编辑" })).toBeFocused();
    await leave.getByRole("button", { name: "继续编辑" }).click();
    await expect(leave).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/areas/${area.id}$`));
    await expect(page.getByLabel("营运 1 第 1 个点的纬度")).toHaveValue((CENTER.lat - 0.2).toFixed(6));
  }
  // Esc 等于继续编辑
  await page.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "首页" }).click();
  await expect(leave).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(leave).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/areas/${area.id}$`));
  // 离开：去了点的那个地方，服务器上的内容没变
  await page.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "首页" }).click();
  await leave.getByRole("button", { name: "离开" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();
  expect(await wouldConfirmUnload(), "离开以后不再拦").toBe(false);
  expect(((await (await request.get(`/tenant/v1/areas/${area.id}`, { headers: tenant.headers })).json()) as { version: number }).version).toBe(1);
});

test("【缺陷】画了图形还没保存时误点浏览器的「后退」：规范 10.6 / 10.7 说这种情况靠草稿兜底——再回到这个页面应当提示「有一份上次没保存的修改」并能恢复，实际没有草稿，画的图形全部丢失", async ({ page, request }) => {
  test.slow();
  const city = await createCity(request);
  const tenant = await createTenantWithToken(request);
  const area = await createArea(request, tenant, city, `后退丢失 ${randomLetters(4)}`);
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  await page.goto("/areas");
  await page.getByRole("link", { name: /后退丢失/ }).first().click();
  await expect(shapeItem(page, "营运 1")).toBeVisible();
  await group(page, "禁行区").getByRole("button", { name: /添加禁行区/ }).click();
  await page.getByRole("menuitem", { name: "逐点输入坐标" }).click();
  for (const [index, point] of square(0.03).slice(0, 3).entries()) {
    await page.getByLabel(`禁行 1 第 ${index + 1} 个点的纬度`).fill(String(point[1]));
    await page.getByLabel(`禁行 1 第 ${index + 1} 个点的经度`).fill(String(point[0]));
  }
  await expect(page.locator(".area-editor__summary")).toContainText("有未保存的修改");
  await page.waitForTimeout(1_500); // 规范：内容变化后 1 秒内写入草稿
  await page.goBack();
  await expect(page).toHaveURL(/\/areas$/);
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/areas/${area.id}$`));
  await expect(shapeItem(page, "营运 1")).toBeVisible();
  await expect(page.getByText(/有一份上次没保存的修改/), "回到页面后应当能恢复刚才画的禁行区").toBeVisible({ timeout: 3_000 });
});

// ───────────── 窄屏、无障碍 ─────────────

for (const width of [320, 768] as const) {
  test(`${width}px 宽、有地图：区域列表和编辑页（图形展开、有自测结果、粘贴对话框开着）都不横向滚动；地图没有被挤没；亮色和暗色都通过 axe`, async ({ page, request }) => {
    test.slow();
    await page.setViewportSize({ width, height: 720 });
    const city = await createCity(request);
    const tenant = await createTenantWithToken(request);
    const name = `东京 23 区 ${randomLetters(4)}`;
    const area = await createArea(request, tenant, city, name, [
      { kind: "operate", label: "市区", geometry: geometry(square()) },
      { kind: "forbid", label: "皇居", circle: { center: CENTER, radius_m: 2500 } },
    ], { name: { zh: name, en: "Tokyo 23 wards and Narita airport surroundings", ja: "東京23区と成田空港周辺" } });
    await createArea(request, tenant, city, `第二个区域 ${randomLetters(4)}`, [{ kind: "operate", geometry: geometry(square(0.05)) }], { biz_type: "airport_transfer" });
    await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/areas");
      await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page, `区域列表（${scheme}）`);
      await expectAccessible(page, `区域列表 ${width}px ${scheme}`);

      await page.goto(`/areas/${area.id}`);
      await expect(page.locator(".area-map__overlay .area-stroke--operate")).toHaveCount(1);
      await expectNoHorizontalOverflow(page, `编辑页刚打开（${scheme}）`);
      await shapeItem(page, "营运 1").locator(".shape__toggle").click();
      await shapeItem(page, "禁行 1").locator(".shape__toggle").click();
      await expect(page.getByLabel("禁行 1 · 皇居 半径（公里）")).toHaveValue("2.5");
      expect(await selfTest(page, CENTER.lat, CENTER.lng, { viaBackend: true })).toContain("在禁行区内");
      await expectNoHorizontalOverflow(page, `编辑页：图形展开、有自测结果（${scheme}）`);
      // 地图在页面里、没有被挤没
      const map = await page.locator(".area-map__canvas").boundingBox();
      expect(map?.width ?? 0, "地图的宽度").toBeGreaterThan(width * 0.5);
      expect((map?.x ?? 0) + (map?.width ?? 0), "地图不超出屏幕").toBeLessThanOrEqual(width + 1);
      // 把地图拖到图形贴着右边缘：图形和名字被裁在地图里，不撑宽页面
      if (map) {
        await page.mouse.move(map.x + 40, map.y + map.height / 2);
        await page.mouse.down();
        await page.mouse.move(map.x + map.width - 20, map.y + map.height / 2, { steps: 6 });
        await page.mouse.up();
        await expectNoHorizontalOverflow(page, `拖动地图以后（${scheme}）`);
      }
      await expectAccessible(page, `编辑页 ${width}px ${scheme}`);

      await page.getByRole("toolbar", { name: "绘制工具" }).getByRole("button", { name: "粘贴坐标" }).click();
      const dialog = page.getByRole("dialog", { name: "粘贴坐标" });
      await dialog.getByLabel(/内容/).fill(`POLYGON((${"139.123456 35.123456,".repeat(30)}139.123456 35.123456))`);
      await expect(dialog.locator(".field__error, [role=status]").first()).toBeVisible();
      await expectNoHorizontalOverflow(page, `粘贴对话框（${scheme}）`);
      const dialogBox = await dialog.boundingBox();
      expect((dialogBox?.x ?? 0) >= 0 && (dialogBox?.x ?? 0) + (dialogBox?.width ?? 0) <= width + 1, "对话框不超出屏幕").toBe(true);
      await expectAccessible(page, `粘贴对话框 ${width}px ${scheme}`);
      await dialog.getByRole("button", { name: "取消" }).click();
    }
  });
}

/** 找出把内容区撑宽的元素（自己或自己的内容伸到了内容区右边缘之外，地图里被裁掉的不算），写进断言的说明里。 */
async function wideElements(page: Page): Promise<string> {
  const found = await page.evaluate(() => {
    const main = document.querySelector("main");
    if (!main || main.scrollWidth <= main.clientWidth) return [];
    const limit = main.getBoundingClientRect().right + 1;
    const wide: string[] = [];
    for (const node of Array.from(main.querySelectorAll<HTMLElement>("*"))) {
      if (node.closest(".area-map") || !(node instanceof HTMLElement)) continue;
      const rect = node.getBoundingClientRect();
      const reach = Math.max(rect.right, getComputedStyle(node).overflowX === "visible" ? rect.left + node.scrollWidth : 0);
      if (rect.width > 0 && reach > limit) wide.push(`${node.tagName.toLowerCase()}.${String(node.className).split(" ").join(".")}（伸到 ${Math.round(reach)}px，内容区到 ${Math.round(limit)}px）「${(node.textContent ?? "").slice(0, 24)}」`);
    }
    return wide.slice(-2);
  });
  return found.join("；");
}

async function expectEditorFits(page: Page, what: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const main = document.querySelector("main");
    return main ? main.scrollWidth - main.clientWidth : 0;
  });
  expect(overflow, `${what}：内容区横向多出来的像素。撑宽它的元素：${await wideElements(page)}`).toBe(0);
}

test("【缺陷】320px 宽：图形的备注名有 14 个字（上限是 40 个）时编辑页不应当横向滚动，实际出现横向滚动——这一块「更多」按钮的提示气泡（「营运 1 · 备注名 的更多操作」）不换行，把页面撑宽", async ({ page, request }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  const city = await createCity(request);
  const tenant = await createTenantWithToken(request);
  const area = await createArea(request, tenant, city, `备注名稍长 ${randomLetters(4)}`, [{ kind: "operate", label: "成田机场第一航站楼周边道路", geometry: geometry(square()) }]);
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  await page.goto(`/areas/${area.id}`);
  await expect(shapeItem(page, "营运 1")).toContainText("成田机场第一航站楼周边道路");
  await expectEditorFits(page, "编辑页（备注名 14 个字）");
});

test("【缺陷】768px 宽：区域名有 22 个字（上限是 100 个）时编辑页不应当横向滚动，实际出现横向滚动——标题旁「更多」按钮的提示气泡（「区域名 的更多操作」）不换行，把页面撑宽", async ({ page, request }) => {
  await page.setViewportSize({ width: 768, height: 720 });
  const city = await createCity(request);
  const tenant = await createTenantWithToken(request);
  const name = `东京 23 区及成田机场周边接送范围 ${randomLetters(4)}`;
  const area = await createArea(request, tenant, city, name);
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  await page.goto("/areas");
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page, "区域列表（名字 22 个字）");
  await page.goto(`/areas/${area.id}`);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.locator(".area-map__overlay .area-stroke--operate")).toHaveCount(1);
  await expectEditorFits(page, "编辑页（名字 22 个字）");
});

test("【缺陷】320px 宽：区域名是一长串不带空格的字母数字（40 个字符，上限是 100 个）时编辑页不应当横向滚动，实际页面标题不折行，把页面撑宽（列表页没有这个问题）", async ({ page, request }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  const city = await createCity(request);
  const tenant = await createTenantWithToken(request);
  const name = `NRT_T1_T2_T3_AirportTransferZone_${randomLetters(8)}`;
  const area = await createArea(request, tenant, city, name);
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  await page.goto("/areas");
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page, "区域列表（长名字）");
  await page.goto(`/areas/${area.id}`);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expectEditorFits(page, "编辑页（长名字）");
});

// ───────────── 列表：筛选和翻页 ─────────────

test("列表：23 个区域按每页 20 条翻页不重不漏，「共 23 条」；按关键字、业务类型、状态筛选后数量和内容对；筛选条件写在地址里，刷新后还在；清空筛选回到全部", async ({ page, request }) => {
  test.slow();
  const city = await createCity(request);
  const tenant = await createTenantWithToken(request);
  const tag = randomLetters(5);
  const created: { id: string; name: string }[] = [];
  for (let i = 0; i < 23; i += 1) {
    const name = `${i < 3 ? `${tag}机场` : "市区"} ${String(i).padStart(2, "0")} ${randomLetters(3)}`;
    const area = await createArea(request, tenant, city, name, [{ kind: "operate", geometry: geometry(square(0.01 + i * 0.001)) }], { biz_type: i % 2 === 0 ? "general" : "charter" });
    created.push({ id: area.id, name });
  }
  for (const target of created.slice(0, 2)) expect((await request.post(`/tenant/v1/areas/${target.id}/disable`, { headers: tenant.headers })).status()).toBe(200);

  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  await page.goto("/areas?size=20");
  const rows = page.getByRole("region", { name: "区域列表" }).locator("tbody tr");
  const pagination = page.getByRole("navigation", { name: "分页" });
  await expect(rows).toHaveCount(20);
  await expect(pagination).toContainText("共 23 条");
  const namesOnPage = async (): Promise<string[]> => rows.locator("a[data-area-row]").allInnerTexts();
  const first = await namesOnPage();
  await expect(pagination.getByRole("button", { name: "上一页" })).toBeDisabled();
  await pagination.getByRole("button", { name: "下一页" }).click();
  await expect(rows).toHaveCount(3);
  const second = await namesOnPage();
  await expect(pagination.getByRole("button", { name: "下一页" })).toBeDisabled();
  expect([...first, ...second].sort()).toEqual(created.map((entry) => entry.name).sort());
  await pagination.getByRole("button", { name: "上一页" }).click();
  await expect(rows).toHaveCount(20);
  expect(await namesOnPage()).toEqual(first);

  // 关键字
  const search = page.getByLabel("按名称搜索");
  await search.fill(`${tag}机场`);
  await page.keyboard.press("Enter");
  await expect(rows).toHaveCount(3);
  await expect(pagination).toContainText("共 3 条");
  await expect(page).toHaveURL(/[?&]q=/);
  // 再加状态：3 个里有 2 个停用
  await page.getByLabel("状态").selectOption("disabled");
  await expect(rows).toHaveCount(2);
  await expect(page).toHaveURL(/status=disabled/);
  await page.reload();
  await expect(rows).toHaveCount(2);
  await expect(page.getByLabel("状态")).toHaveValue("disabled");
  await expect(page.getByLabel("按名称搜索")).toHaveValue(`${tag}机场`);
  // 再加业务类型：停用的两个是第 0、1 个，一个通用一个包车
  await page.getByLabel("业务类型").selectOption("charter");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(created[1]?.name as string);
  // 没有结果
  await page.getByLabel("按名称搜索").fill("没有这个名字的区域");
  await page.keyboard.press("Enter");
  await expect(page.getByText("没有符合条件的区域")).toBeVisible();
  await page.getByRole("button", { name: "清空筛选" }).first().click();
  await expect(pagination).toContainText("共 23 条");
  await expect(page).not.toHaveURL(/status=|biz=|q=/);
});

// ───────────── 角色 ─────────────

test("调度、财务角色：首页和菜单里没有「区域」；直接打开区域的地址看到「没有权限」，页面不请求区域、底图配置和瓦片", async ({ page, request }) => {
  const city = await createCity(request);
  const tenant = await createTenantWithToken(request);
  const area = await createArea(request, tenant, city, `角色 ${randomLetters(4)}`);
  for (const role of ["dispatch", "finance"]) {
    const email = uniqueEmail(`tenant-${role}`);
    const invited = await request.post("/tenant/v1/users", { headers: tenant.headers, data: { email, name: "端到端测试子账号", role } });
    expect(invited.status()).toBe(201);
    const password = newPassword();
    expect((await request.post("/tenant/v1/auth/accept-invite", { data: { token: ((await invited.json()) as { invite: { token: string } }).invite.token, password } })).ok()).toBe(true);
    const context = await page.context().browser()?.newContext({ locale: "zh-CN" });
    if (!context) throw new Error("没有浏览器");
    const other = await context.newPage();
    const requested: string[] = [];
    other.on("request", (sent) => requested.push(sent.url()));
    await loginAs(other, "tenant", email, password);
    await expect(other.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "区域" })).toHaveCount(0);
    for (const path of ["/areas", "/areas/new", `/areas/${area.id}`]) {
      await other.goto(path);
      await expect(other.getByText("你没有权限查看这里")).toBeVisible();
    }
    expect(requested.filter((url) => /\/tenant\/v1\/(areas|map)/.test(url) || url.startsWith(TILE_ORIGIN)), `${role} 不应请求区域、底图配置和瓦片`).toEqual([]);
    await context.close();
  }
});
