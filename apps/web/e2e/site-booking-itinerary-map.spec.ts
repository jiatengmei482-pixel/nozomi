/**
 * 端到端：包车行程地图（M9P-20 P1，ADR 0096 第二节）。真实浏览器 → 前端 → 真实 API（`/site/v1/quotes`、`/site/v1/itinerary-map`）→ 真实 PostgreSQL；
 * 谷歌（Routes、Maps Static API）是本机的假服务器（global-setup），从不调用真实的谷歌。城市、区域、包车商品见 charter-support.ts。
 *
 * 流程（电脑 1280）：带上下车地点的包车链接 → 第 2 步「行程路线」：地图请求带 2 个点、列表「1 上车」「2 下车」→ 回第 1 步加 3 个经停点 →
 * 第 2 步「行程时间表」：列表编号 1–5、每段时长和公里（报价应答的 itinerary_route.legs），地图请求按顺序带 5 个点，图经真实 API 出来，alt 写全程；
 * 亮暗两色 axe 0；360 宽不横向滚动 → 图出不来（503）：只留列表，不加载 Leaflet、不请求两点路线小地图。
 * 截图（亮、暗、手机）：图片请求照常经真实 API（核对状态和类型），给浏览器的换成现画的示意图（灰底、品牌色路线、编号圆点），
 * 因为本机假谷歌只回 1 × 1 的图、看不清版式；图本身的参数由集成测试核对。
 */
import { type Page, type Request, expect, test } from "@playwright/test";
import { E2E_WEB_PLACES_PORT } from "../playwright.config.ts";
import { tomorrowInTokyo } from "./book-new-support.ts";
import { expectAccessible } from "./catalog.ts";
import { type Point, charterWorld, linkPoint } from "./charter-support.ts";
import { OWN_SITE_SOURCE, platformAdminHeaders, randomLetters } from "./support.ts";

test.use(OWN_SITE_SOURCE);

const SITE = `http://127.0.0.1:${E2E_WEB_PLACES_PORT}`;
const MAP = `${SITE}/site/v1/itinerary-map?**`;

const pointsOf = (request: Request): string[] => new URL(request.url()).searchParams.getAll("p");
const text = (point: Point): string => `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;

async function expectBothThemes(page: Page, what: string): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${what}（${scheme === "light" ? "亮色" : "暗色"}）`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

/** 截图用的示意图：按请求的宽高、倍率、主题现画（灰底、品牌色折线、编号圆点），在另一个空白页里画 */
async function paintedMap(page: Page, url: URL): Promise<Buffer> {
  const width = Number(url.searchParams.get("width"));
  const height = Number(url.searchParams.get("height"));
  const scale = Number(url.searchParams.get("scale"));
  const dark = url.searchParams.get("theme") === "dark";
  const count = url.searchParams.getAll("p").length;
  const base64 = await page.evaluate(
    async ({ width, height, scale, dark, count }) => {
      const canvas = new OffscreenCanvas(width * scale, height * scale);
      const g = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
      g.scale(scale, scale);
      g.fillStyle = dark ? "#1E232C" : "#F4F5F7";
      g.fillRect(0, 0, width, height);
      g.strokeStyle = dark ? "#2D3440" : "#FFFFFF";
      g.lineWidth = 6;
      for (let x = 10; x < width; x += 60) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x + 50, height);
        g.stroke();
      }
      const at = (i: number) => ({ x: 40 + ((width - 80) * i) / Math.max(1, count - 1), y: height / 2 + (i % 2 === 0 ? -30 : 30) });
      g.strokeStyle = dark ? "#A9BBFF" : "#1B2A5C";
      g.lineWidth = 4;
      g.beginPath();
      for (let i = 0; i < count; i++) (i === 0 ? g.moveTo : g.lineTo).call(g, at(i).x, at(i).y);
      g.stroke();
      for (let i = 0; i < count; i++) {
        const end = i === 0 || i === count - 1;
        g.fillStyle = dark ? "#A9BBFF" : "#2A45B0";
        g.beginPath();
        g.arc(at(i).x, at(i).y, end ? 12 : 9, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = dark ? "#141C3D" : "#FFFFFF";
        g.font = "bold 12px sans-serif";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(String(i + 1), at(i).x, at(i).y + 1);
      }
      g.fillStyle = dark ? "#929BAA" : "#5C6574";
      g.font = "bold 13px sans-serif";
      g.textAlign = "left";
      g.fillText("Google", 6, height - 6);
      const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    },
    { width, height, scale, dark, count },
  );
  return Buffer.from(base64, "base64");
}

/** 行程时间表一行（业主 2026-11-17 起每行带预计时刻）：名称之后、停留之前是时刻 */
const timedRow = (head: string, time: "depart" | "stop" | "arrive", tail = ""): RegExp => {
  const esc = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const clock = time === "depart" ? "\\d\\d:\\d\\d 出发" : time === "stop" ? "预计 \\d\\d:\\d\\d 到 · \\d\\d:\\d\\d 出发" : "预计 \\d\\d:\\d\\d 到";
  return new RegExp(`^${esc(head)}${clock}${esc(tail)}$`);
};

test("包车行程地图：编号 1 = 上车、经停依次、最后 = 下车，列表同编号、每段时长和公里；图经真实 API 出来；出不来只留列表、不用 Leaflet；亮暗 axe、360 宽", async ({ page, request }) => {
  test.setTimeout(180_000);
  const trip = await charterWorld(request);
  const admin = await platformAdminHeaders(request);
  const tag = randomLetters(4);
  const station = async (name: string, at: Point): Promise<{ name: string; location: Point }> => {
    const made = await request.post("/platform/v1/master/places", { headers: admin, data: { type: "station", code: `STN-JP-${randomLetters(6)}`, city_id: trip.cityId, category: "rail", name: { zh: name }, location: at } });
    expect(made.status(), await made.text()).toBe(201);
    return { name, location: at };
  };
  const first = await station(`地图甲${tag}`, { lat: Number((trip.center.lat + 0.02).toFixed(6)), lng: Number((trip.center.lng - 0.01).toFixed(6)) });
  const second = await station(`地图乙${tag}`, { lat: Number((trip.center.lat - 0.015).toFixed(6)), lng: Number((trip.center.lng - 0.02).toFixed(6)) });
  // 第三个经停也在商品区域里（加价区域的车站没有行程加价，报不出）
  const third = await station(`地图丙${tag}`, { lat: Number((trip.center.lat + 0.01).toFixed(6)), lng: Number((trip.center.lng + 0.015).toFixed(6)) });
  const leaflet: string[] = [];
  page.on("request", (sent) => {
    if (/leaflet/i.test(sent.url()) || new URL(sent.url()).pathname === "/site/v1/route-map") leaflet.push(sent.url());
  });
  const date = tomorrowInTokyo();
  await page.setViewportSize({ width: 1280, height: 900 });
  // 图片请求经真实 API（记下状态、类型、点），给浏览器的换成示意图
  const painter = await page.context().newPage();
  const realMaps: { status: number; type: string | undefined; points: string[] }[] = [];
  await page.route(MAP, async (route) => {
    const real = await route.fetch();
    const url = new URL(route.request().url());
    realMaps.push({ status: real.status(), type: real.headers()["content-type"], points: url.searchParams.getAll("p") });
    if (real.status() !== 200) return route.fulfill({ response: real });
    return route.fulfill({ status: 200, contentType: "image/png", headers: { "cache-control": "no-store" }, body: await paintedMap(painter, url) });
  });

  // 没有经停：2 个点，「1 上车」「2 下车」
  const twoPoints = page.waitForResponse((response) => response.url().startsWith(`${SITE}/site/v1/itinerary-map?`));
  await page.goto(`${SITE}/book/new?mode=charter&${linkPoint("from", trip.pickup, "上车酒店")}&${linkPoint("to", trip.nearby, "市内下车点")}&date=${date}&time=10:00`);
  const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: trip.groupName }) });
  await expect(card).toContainText("77,000 JPY");
  const plain = await twoPoints;
  expect(plain.status()).toBe(200);
  expect(realMaps[0], "真实 API 经本机假谷歌出图").toEqual({ status: 200, type: "image/png", points: [text(trip.pickup), text(trip.nearby)] });
  const section = page.getByRole("region", { name: "行程路线" });
  // 没有经停、按自选时长报价：这一段的时长和公里取地图折线那次调用的量（本机假谷歌：6.8 公里、18 分钟），只作展示
  await expect(section.getByRole("list", { name: "行程" }).getByRole("listitem")).toHaveText([/^1 上车上车酒店\d\d:\d\d 出发$/, /^行驶约 18 分钟 · 6.8 公里2 下车市内下车点预计 \d\d:\d\d 到$/]);
  await expect(section.getByRole("img", { name: "路线图：1 上车酒店 → 2 市内下车点" })).toBeVisible();

  // 加 3 个经停点
  await page.getByRole("button", { name: "上一步" }).click();
  const add = page.getByRole("button", { name: "添加经停点" });
  const addStop = async (index: number, name: string, stay: string): Promise<void> => {
    await add.click();
    const box = page.getByRole("combobox", { name: `经停点 ${index}`, exact: true });
    await expect(box).toBeFocused();
    await box.fill(name);
    await page.getByRole("listbox", { name: `经停点 ${index}的候选` }).getByRole("option", { name: new RegExp(name) }).click();
    await expect(box).toHaveValue(name);
    await page.getByLabel(`经停点 ${index} 停留时长`).selectOption(stay);
  };
  await addStop(1, first.name, "60");
  await addStop(2, second.name, "90");
  await addStop(3, third.name, "30");
  const fivePoints = page.waitForResponse((response) => response.url().startsWith(`${SITE}/site/v1/itinerary-map?`) && new URL(response.url()).searchParams.getAll("p").length === 5);
  const quoted = page.waitForResponse((response) => new URL(response.url()).pathname === "/site/v1/quotes" && response.request().method() === "POST" && response.request().postDataJSON()["itinerary_pricing"] === true);
  await page.getByRole("button", { name: "下一步：选择车型" }).click();
  const quote = (await (await quoted).json()) as { itinerary_route?: { legs: { minutes: number; meters: number }[]; total_minutes: number; total_meters: number } };
  const legs = quote.itinerary_route?.legs ?? [];
  expect(legs, "按行程计价的报价带每段的时长和米数").toHaveLength(4);
  const mapped = await fivePoints;
  expect(mapped.status()).toBe(200);
  expect(pointsOf(mapped.request()), "地图的点按行程顺序").toEqual([text(trip.pickup), text(first.location), text(second.location), text(third.location), text(trip.nearby)]);

  const km = (meters: number): string => {
    const tenths = Math.ceil(meters / 100);
    return `${tenths % 10 === 0 ? String(tenths / 10) : (tenths / 10).toFixed(1)} 公里`;
  };
  const drive = (i: number): string => {
    const leg = legs[i] as { minutes: number; meters: number };
    const hours = Math.floor(leg.minutes / 60);
    const rest = leg.minutes % 60;
    const time = hours === 0 ? `${rest} 分钟` : rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分`;
    return `行驶约 ${time} · ${km(leg.meters)}`;
  };
  const schedule = page.getByRole("region", { name: "行程时间表" });
  await expect(schedule.getByRole("list", { name: "行程" }).getByRole("listitem")).toHaveText([
    timedRow("1 上车上车酒店", "depart"),
    timedRow(`${drive(0)}2 经停${first.name}`, "stop", "停留 1 小时"),
    timedRow(`${drive(1)}3 经停${second.name}`, "stop", "停留 1 小时 30 分"),
    timedRow(`${drive(2)}4 经停${third.name}`, "stop", "停留 30 分钟"),
    timedRow(`${drive(3)}5 下车市内下车点`, "arrive"),
  ]);
  const image = schedule.getByRole("img", { name: new RegExp(`^路线图：1 上车酒店 → 2 ${first.name} → 3 ${second.name} → 4 ${third.name} → 5 市内下车点，约 .+ · .+ 公里$`) });
  await expect(image).toBeVisible();
  expect(await image.evaluate((img) => (img as HTMLImageElement).naturalWidth > 0), "图片加载出来了").toBe(true);
  await expect(schedule.getByText("路线更新中")).toHaveCount(0);
  await expectBothThemes(page, "新预订页包车第 2 步（行程地图）");
  // 手机 360 宽：不横向滚动，地图在列表上面、不超过 40vh
  await page.setViewportSize({ width: 360, height: 780 });
  await expect(schedule.locator(".itinerary-map__canvas")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), "360 宽横向溢出").toBe(0);
  const mapBox = await schedule.locator(".itinerary-map__canvas").boundingBox();
  const listBox = await schedule.getByRole("list", { name: "行程" }).boundingBox();
  expect(mapBox !== null && listBox !== null && mapBox.y + mapBox.height <= listBox.y, "地图在列表上面").toBe(true);
  expect((mapBox?.height ?? 999) <= 780 * 0.4 + 1, "地图不超过 40vh").toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });

  // 截图（亮、暗、手机）
  for (const [name, scheme, width] of [["1280-light", "light", 1280], ["1280-dark", "dark", 1280], ["390-light", "light", 390]] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await expect(schedule.locator(".itinerary-map .route-map__image")).toBeVisible();
    await expect(schedule.getByText("路线更新中")).toHaveCount(0);
    await schedule.scrollIntoViewIfNeeded();
    await schedule.screenshot({ path: test.info().outputPath(`m9p20-itinerary-${name}.png`) });
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(realMaps.every((map) => map.status === 200 && map.type === "image/png"), JSON.stringify(realMaps)).toBe(true);
  await page.unroute(MAP);

  // 图出不来（503）：只留列表，不加载 Leaflet、不请求两点路线小地图（从这里起记）
  leaflet.length = 0;
  await page.route(MAP, (route) => route.fulfill({ status: 503, json: { error: { code: "ROUTE_MAP_UNAVAILABLE", message: "x", details: { reason: "NOT_ENABLED" } } } }));
  await page.getByRole("button", { name: "上一步" }).click();
  await page.getByRole("button", { name: `把 ${second.name} 上移` }).click();
  const failedMap = page.waitForResponse((response) => response.url().startsWith(`${SITE}/site/v1/itinerary-map?`));
  await page.getByRole("button", { name: "下一步：选择车型" }).click();
  expect(pointsOf((await failedMap).request()).slice(1, 3), "换了顺序的点").toEqual([text(second.location), text(first.location)]);
  await expect(schedule.locator(".itinerary-map")).toHaveCount(0);
  await expect(schedule.getByRole("list", { name: "行程" }).getByRole("listitem").nth(1)).toContainText(`2 经停${second.name}`);
  await expect(page.locator(".leaflet-container")).toHaveCount(0);
  expect(leaflet, "包车不用 Leaflet、不请求两点路线小地图").toEqual([]);
  await expectBothThemes(page, "新预订页包车第 2 步（地图出不来，只有列表）");
});

test("10 个经停：列表编号 1–12，地图请求按顺序带 12 个点、经真实 API 出图（10–12 号的自定义图标由集成测试核对）", async ({ page, request }) => {
  test.setTimeout(240_000);
  const trip = await charterWorld(request, { packages: [{ hours: 12, price: 120_000, km: 300 }] });
  const admin = await platformAdminHeaders(request);
  const tag = randomLetters(4);
  const stops: { name: string; location: Point }[] = [];
  for (let i = 0; i < 10; i++) {
    const name = `十站${tag}${String.fromCharCode(65 + i)}`;
    const location = { lat: Number((trip.center.lat + 0.004 * (i + 1)).toFixed(6)), lng: Number((trip.center.lng + (i % 2 === 0 ? 0.01 : -0.01)).toFixed(6)) };
    const made = await request.post("/platform/v1/master/places", { headers: admin, data: { type: "station", code: `STN-JP-${randomLetters(6)}`, city_id: trip.cityId, category: "rail", name: { zh: name }, location } });
    expect(made.status(), await made.text()).toBe(201);
    stops.push({ name, location });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${SITE}/book/new?mode=charter&${linkPoint("from", trip.pickup, "上车酒店")}&${linkPoint("to", trip.nearby, "市内下车点")}&date=${tomorrowInTokyo()}&time=08:00`);
  // 有 8、12 小时两档：停在第 1 步等客人选时长；加了经停点就按行程自动选
  await expect(page.getByRole("button", { name: "添加经停点" })).toBeVisible();
  for (const [index, stop] of stops.entries()) {
    await page.getByRole("button", { name: "添加经停点" }).click();
    const box = page.getByRole("combobox", { name: `经停点 ${index + 1}`, exact: true });
    await box.fill(stop.name);
    await page.getByRole("listbox", { name: `经停点 ${index + 1}的候选` }).getByRole("option", { name: new RegExp(stop.name) }).click();
    await expect(box).toHaveValue(stop.name);
    await page.getByLabel(`经停点 ${index + 1} 停留时长`).selectOption("30");
  }
  const twelve = page.waitForResponse((response) => response.url().startsWith(`${SITE}/site/v1/itinerary-map?`) && new URL(response.url()).searchParams.getAll("p").length === 12);
  await page.getByRole("button", { name: "下一步：选择车型" }).click();
  const mapped = await twelve;
  expect(mapped.status()).toBe(200);
  expect(pointsOf(mapped.request())).toEqual([trip.pickup, ...stops.map((stop) => stop.location), trip.nearby].map(text));
  const schedule = page.getByRole("region", { name: "行程时间表" });
  const items = schedule.getByRole("list", { name: "行程" }).getByRole("listitem");
  await expect(items).toHaveCount(12);
  await expect(items.locator(".trip-stops__number")).toHaveText(Array.from({ length: 12 }, (_, i) => String(i + 1)));
  await expect(items.nth(10)).toContainText(`11 经停${stops[9]?.name}`);
  await expect(items.nth(11)).toContainText("12 下车市内下车点");
  await expect(schedule.getByRole("img", { name: /^路线图：1 上车酒店 → 2 .+ → 12 市内下车点，约 .+ 公里$/ })).toBeVisible();
});
