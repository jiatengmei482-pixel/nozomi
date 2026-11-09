/**
 * 端到端：新预订页右侧栏「行程摘要」的路线小地图改用谷歌静态地图（M8-10）。真实浏览器 → 前端 → 真实 API（报价、城市、配置）→ 真实 PostgreSQL。
 * 只有两处用路由拦截：
 * - `POST /site/v1/quotes/by-points` 的 `route`：假谷歌路线不给折线，换成一条机场到东京站的折线（价格等其余内容原样），后备底图才有线可画；
 * - `GET /site/v1/route-map`：按接口定义的应答模拟各种结果——200 图片、503 NOT_ENABLED、503 UNAVAILABLE、429、图片坏了、连不上。
 *   200 的图由浏览器现画一张同尺寸的灰色 PNG（左下角写 Google、右下角写版权），用来核对图没被裁、没被盖。
 * 另有一条不拦截 `route-map`：真实 API 代调本机的假 Maps Static API（global-setup，回一张 1 × 1 的 PNG），图经后端出来、显示在框里，浏览器只连本站。
 * 核对：按框的实际大小、像素比、亮暗要图；出图后不叠底图署名、不画 Leaflet；没开通退回现有底图画线；其他失败只留「约 X 分钟 · Y 公里」，不报错、不留空框。
 * 电脑 1280 和手机 390（2 倍屏）亮暗截图留在本用例的输出目录（m810-*.png）。
 */
import { type Browser, type Page, type Route, expect, test } from "@playwright/test";
import { E2E_WEB_PLACES_PORT } from "../playwright.config.ts";
import { TOKYO_STATION, airportLink, createAirport, encodePolyline, expectRouteLineVisible, publishTransfer, tomorrowInTokyo } from "./book-new-support.ts";
import { createSupplier, createWorld } from "./catalog.ts";

const SITE = `http://127.0.0.1:${E2E_WEB_PLACES_PORT}`;
const ROUTE_TEXT = "约 25 分钟 · 14.2 公里";
const ROUTE_MAP = `${SITE}/site/v1/route-map?**`;

interface Trip {
  link: string;
  groupName: string;
}

/** 本用例自己的机场和接送机商品；报价应答里的路线换成带折线的那条。 */
async function prepareTrip(page: Page, request: Parameters<typeof createWorld>[0]): Promise<Trip> {
  const world = await createWorld(request);
  const airport = await createAirport(request, world);
  const supplier = await createSupplier(request, world);
  await publishTransfer(request, supplier, { ...world, airport });
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${1 + Math.floor(Math.random() * 250)}` });
  await page.route(`${SITE}/site/v1/quotes/by-points`, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...body, route: { minutes: 25, meters: 14_200, polyline: encodePolyline([airport.location, { lat: (airport.location.lat + TOKYO_STATION.lat) / 2 + 0.01, lng: (airport.location.lng + TOKYO_STATION.lng) / 2 }, TOKYO_STATION]) } } });
  });
  const name = encodeURIComponent("東京駅八重洲口");
  return { link: `${SITE}/book/new?${airportLink(airport)}&to=${TOKYO_STATION.lat},${TOKYO_STATION.lng}&to_name=${name}&date=${tomorrowInTokyo()}&time=11:30&pax=2&bags=2`, groupName: world.group.name };
}

/** 在一个空白页里画一张 PNG：灰色底、一条线、左下角「Google」、右下角版权（亮暗两套灰），尺寸 = 宽高 × 倍率。 */
async function paintStaticMap(browser: Browser, width: number, height: number, scale: number, theme: string): Promise<Buffer> {
  const painter = await browser.newPage();
  try {
    const base64 = await painter.evaluate(
      async ({ width, height, scale, dark }) => {
        const canvas = new OffscreenCanvas(width * scale, height * scale);
        const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
        context.scale(scale, scale);
        context.fillStyle = dark ? "#2b2b2b" : "#ebebeb";
        context.fillRect(0, 0, width, height);
        context.strokeStyle = dark ? "#3d3d3d" : "#ffffff";
        context.lineWidth = 6;
        for (let x = 20; x < width; x += 70) {
          context.beginPath();
          context.moveTo(x, 0);
          context.lineTo(x + 40, height);
          context.stroke();
        }
        context.strokeStyle = "#e5484d";
        context.lineWidth = 4;
        context.beginPath();
        context.moveTo(width * 0.2, height * 0.7);
        context.lineTo(width * 0.5, height * 0.35);
        context.lineTo(width * 0.8, height * 0.3);
        context.stroke();
        context.fillStyle = dark ? "#e8e8e8" : "#5f6368";
        context.font = "bold 14px sans-serif";
        context.fillText("Google", 6, height - 6);
        context.font = "10px sans-serif";
        context.textAlign = "right";
        context.fillText("Map data ©2026", width - 4, height - 4);
        const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return btoa(binary);
      },
      { width, height, scale, dark: theme === "dark" },
    );
    return Buffer.from(base64, "base64");
  } finally {
    await painter.close();
  }
}

/** 静态图接口照约定回一张图；记下每次请求的参数。 */
async function serveImages(page: Page, browser: Browser): Promise<URLSearchParams[]> {
  const seen: URLSearchParams[] = [];
  await page.unroute(ROUTE_MAP);
  await page.route(ROUTE_MAP, async (route: Route) => {
    const query = new URL(route.request().url()).searchParams;
    seen.push(query);
    const body = await paintStaticMap(browser, Number(query.get("width")), Number(query.get("height")), Number(query.get("scale")), query.get("theme") ?? "light");
    await route.fulfill({ status: 200, contentType: "image/png", body });
  });
  return seen;
}

async function serveFailure(page: Page, respond: (route: Route) => Promise<void>): Promise<void> {
  await page.unroute(ROUTE_MAP);
  await page.route(ROUTE_MAP, respond);
}

const unavailable = (reason: "NOT_ENABLED" | "UNAVAILABLE") => (route: Route) => route.fulfill({ status: 503, json: { error: { code: "ROUTE_MAP_UNAVAILABLE", message: "路线图暂不可用", details: { reason } } } });

/** 图出来了：尺寸、倍率、主题对得上框和页面；整张图在框里（没裁），左下角（谷歌标志）最上层就是图本身（没被盖）；不叠底图署名、没有 Leaflet。 */
async function expectStaticMap(page: Page, seen: URLSearchParams[], expected: { theme: "light" | "dark"; scale: 1 | 2 }): Promise<void> {
  const summary = page.locator(".book-summary");
  const image = summary.getByRole("img", { name: new RegExp(`^路线图：.+ → 東京駅八重洲口，${ROUTE_TEXT}$`) });
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("src", new RegExp(`theme=${expected.theme}`));
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  const facts = await image.evaluate((element: HTMLImageElement) => {
    const frame = element.parentElement as HTMLElement;
    const box = element.getBoundingClientRect();
    const corner = document.elementFromPoint(box.left + 12, box.bottom - 8);
    const query = new URL(element.src).searchParams;
    return {
      frame: { width: frame.clientWidth, height: frame.clientHeight },
      box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
      inner: (() => {
        const outer = frame.getBoundingClientRect();
        const style = getComputedStyle(frame);
        return { left: outer.left + parseFloat(style.borderLeftWidth), top: outer.top + parseFloat(style.borderTopWidth), right: outer.right - parseFloat(style.borderRightWidth), bottom: outer.bottom - parseFloat(style.borderBottomWidth) };
      })(),
      natural: { width: element.naturalWidth, height: element.naturalHeight },
      requested: { width: Number(query.get("width")), height: Number(query.get("height")), scale: Number(query.get("scale")), theme: query.get("theme") },
      cornerIsImage: corner === element,
      fit: getComputedStyle(element).objectFit,
    };
  });
  expect(facts.requested, "按框的实际大小、像素比、主题要图").toEqual({ width: Math.min(640, Math.max(200, facts.frame.width)), height: Math.min(640, Math.max(150, facts.frame.height)), scale: expected.scale, theme: expected.theme });
  expect(facts.natural).toEqual({ width: facts.requested.width * expected.scale, height: facts.requested.height * expected.scale });
  expect(facts.fit, "整张缩进框里，不裁").toBe("contain");
  for (const side of ["left", "top", "right", "bottom"] as const) expect(Math.abs(facts.box[side] - facts.inner[side]), `图贴着框的${side}`).toBeLessThanOrEqual(1);
  expect(facts.cornerIsImage, "左下角谷歌标志的位置没有被别的东西盖住").toBe(true);
  expect(seen.some((query) => query.get("theme") === expected.theme)).toBe(true);
  await expect(summary.locator(".leaflet-container")).toHaveCount(0);
  await expect(summary.locator(".route-map__attribution")).toHaveCount(0);
  await expect(summary.locator(".route-map__canvas--loading")).toHaveCount(0);
  await expect(summary.getByText(ROUTE_TEXT)).toBeVisible();
}

/** 只留文字：没有地图、没有空框、没有报错。 */
async function expectTextOnly(page: Page, what: string): Promise<void> {
  const summary = page.locator(".book-summary");
  await expect(summary.getByText(ROUTE_TEXT), what).toBeVisible();
  await expect(summary.locator(".route-map"), `${what}：不显示地图、不留空框`).toHaveCount(0);
  await expect(summary.getByRole("img", { name: /路线图/ })).toHaveCount(0);
  await expect(page.locator(".alert")).toHaveCount(0);
}

async function selectVehicle(page: Page, groupName: string): Promise<void> {
  const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: groupName }) });
  await card.getByRole("button", { name: `选择 ${groupName}` }).click();
}

test("路线小地图（电脑 1280）：出图（亮暗各一张，切主题换图）；没开通退回现有底图；暂时不可用、图片坏了、连不上只留文字", async ({ page, request, browser }) => {
  test.setTimeout(150_000);
  const trip = await prepareTrip(page, request);
  await page.setViewportSize({ width: 1280, height: 900 });

  // 200 图片：亮色要亮色的图；切到暗色换一张暗色的图
  const seen = await serveImages(page, browser);
  await page.goto(trip.link);
  await selectVehicle(page, trip.groupName);
  await expectStaticMap(page, seen, { theme: "light", scale: 1 });
  await page.screenshot({ path: test.info().outputPath("m810-desktop-light.png"), fullPage: true });
  await page.emulateMedia({ colorScheme: "dark" });
  await expectStaticMap(page, seen, { theme: "dark", scale: 1 });
  await page.screenshot({ path: test.info().outputPath("m810-desktop-dark.png"), fullPage: true });
  await page.emulateMedia({ colorScheme: "light" });

  // 503 NOT_ENABLED：退回现有底图（Leaflet）画路线，底图署名在图下
  await serveFailure(page, unavailable("NOT_ENABLED"));
  await page.goto(trip.link);
  await selectVehicle(page, trip.groupName);
  await expectRouteLineVisible(page, TOKYO_STATION);
  await expect(page.locator(".book-summary .route-map__attribution")).toBeVisible();
  await expect(page.locator(".book-summary .route-map__image")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("m810-desktop-light-not-enabled.png"), fullPage: true });

  // 503 UNAVAILABLE、图片坏了（200 但不是能解码的图）、不是图片、连不上：只留文字
  const failures: [string, (route: Route) => Promise<void>][] = [
    ["503 UNAVAILABLE", unavailable("UNAVAILABLE")],
    ["429 太频繁", (route) => route.fulfill({ status: 429, headers: { "retry-after": "30" }, json: { error: { code: "RATE_LIMITED", message: "太频繁", details: { retry_after_seconds: 30 } } } })],
    ["图片坏了", (route) => route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("not a png") })],
    ["不是图片", (route) => route.fulfill({ status: 200, json: { ok: true } })],
    ["连不上", (route) => route.abort("connectionrefused")],
  ];
  for (const [what, respond] of failures) {
    await serveFailure(page, respond);
    await page.goto(trip.link);
    await selectVehicle(page, trip.groupName);
    await expectTextOnly(page, what);
    if (what === "503 UNAVAILABLE") await page.screenshot({ path: test.info().outputPath("m810-desktop-light-unavailable.png"), fullPage: true });
  }
});

test("路线小地图经真实后端出图：API 代调（假的）Maps Static API，图是同源的 PNG，显示在框里，浏览器不连谷歌", async ({ page, request }) => {
  test.setTimeout(120_000);
  const trip = await prepareTrip(page, request);
  const origins = new Set<string>();
  page.on("request", (sent) => origins.add(new URL(sent.url()).origin));
  await page.setViewportSize({ width: 1280, height: 900 });
  const answered = page.waitForResponse((response) => new URL(response.url()).pathname === "/site/v1/route-map");
  await page.goto(trip.link);
  const response = await answered;
  expect(response.status(), await response.text().catch(() => "")).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^image\//);
  const image = page.locator(".book-summary").getByRole("img", { name: new RegExp(`^路线图：.+ → 東京駅八重洲口，${ROUTE_TEXT}$`) });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  await expect(page.locator(".book-summary .leaflet-container")).toHaveCount(0);
  await expect(page.locator(".book-summary .route-map__canvas--loading")).toHaveCount(0);
  expect([...origins].filter((origin) => origin !== SITE)).toEqual([]);
});

test.describe("手机 390（2 倍屏）", () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

  test("路线小地图（手机第 3 步）：要 2 倍的图，亮暗各一张；不横向滚动；暂时不可用时只留文字", async ({ page, request, browser }) => {
    test.setTimeout(150_000);
    const trip = await prepareTrip(page, request);
    const seen = await serveImages(page, browser);
    await page.goto(trip.link);
    await selectVehicle(page, trip.groupName);
    await page.locator(".book-bar").getByRole("button", { name: "下一步" }).click();
    await expect(page.getByRole("heading", { name: "行程摘要" })).toBeFocused();
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expectStaticMap(page, seen, { theme: scheme, scale: 2 });
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}px 宽不横向滚动`).toBe(0);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await expectStaticMap(page, seen, { theme: scheme, scale: 2 });
      await page.locator(".book-summary").scrollIntoViewIfNeeded();
      await page.screenshot({ path: test.info().outputPath(`m810-mobile-${scheme}.png`), fullPage: true });
    }
    await page.emulateMedia({ colorScheme: "light" });

    await serveFailure(page, unavailable("UNAVAILABLE"));
    await page.goto(trip.link);
    await selectVehicle(page, trip.groupName);
    await page.locator(".book-bar").getByRole("button", { name: "下一步" }).click();
    await expectTextOnly(page, "手机：503 UNAVAILABLE");
  });
});
