/**
 * 新预订页 `/book/new` 端到端用例共用的准备和检查（M8-03、M8-04；M8-10 的路线小地图用例也用）：
 * 本用例专用的机场、上架接送机商品、链接参数、路线折线、窄屏和亮暗 axe、Leaflet 路线图真的画出了线。
 */
import { type APIRequestContext, type Page, expect } from "@playwright/test";
import { CENTER, type Ref, type Supplier, type World, createProductByApi, expectAccessible } from "./catalog.ts";
import { platformAdminHeaders, randomLetters } from "./support.ts";

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
export const TOKYO_STATION = { lat: 35.6812, lng: 139.7671 };

/** 本用例自己的机场：城市中心西南 4–6 公里的随机一点（别的用例的机场在中心东南约 14 公里，不会在 3 公里内撞上）。 */
export async function createAirport(request: APIRequestContext, world: World): Promise<Ref & { location: { lat: number; lng: number } }> {
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

/** 上架接送机商品；`seat` 给了时商品提供这项附加服务（每件 1,000 日元）。 */
export async function publishTransfer(request: APIRequestContext, supplier: Supplier, world: World, seat: Ref | null = null): Promise<void> {
  const product = await createProductByApi(request, supplier, world, "airport_transfer");
  const rules = await request.put(`/tenant/v1/products/${product.id}/service-rules`, { headers: { ...supplier.headers, "if-match": `"${product.version}"` }, data: { ...RULES, addons: seat === null ? [] : [{ addon_id: seat.id, enabled: true, unit_price: 1000, first_free: false }] } });
  expect(rules.status(), await rules.text()).toBe(200);
  const content = await request.put(`/tenant/v1/products/${product.id}/content`, { headers: { ...supplier.headers, "if-match": `"${((await rules.json()) as { version: number }).version}"` }, data: { zh: { title: "新预订页接送机", pickup_guide: "到达大厅 1 号出口" } } });
  expect(content.status(), await content.text()).toBe(200);
  const { today } = (await (await request.get(`/tenant/v1/products/${product.id}/price-rules`, { headers: supplier.headers })).json()) as { today: string };
  const version = ((await (await request.get(`/tenant/v1/products/${product.id}`, { headers: supplier.headers })).json()) as { version: number }).version;
  const price = await request.post(`/tenant/v1/products/${product.id}/price-rules/batch`, {
    headers: { ...supplier.headers, "if-match": `"${version}"`, "idempotency-key": crypto.randomUUID() },
    data: { create: [{ ...EMPTY_PRICE, ref: "a", area_id: supplier.area.id, vehicle_group_id: world.group.id, direction: "both", pricing_model: "fixed", base_price: 20000, valid_from: today, valid_to: null, status: "enabled" }], update: [], delete: [] },
  });
  expect(price.status(), await price.text()).toBe(200);
  const published = await request.post(`/tenant/v1/products/${product.id}/publish`, { headers: supplier.headers });
  expect(published.status(), await published.text()).toBe(200);
}

/**
 * 链接里的出发地写成机场的坐标加名称（离机场 0 米，按两个坐标报价认得出是接机）。
 * 另一种写法 `from=机场编码` 走 `GET /site/v1/places/by-code`（M8-04 验收问题 1），在单页用例里覆盖。
 */
export function airportLink(airport: { name: string; location: { lat: number; lng: number } }): string {
  return `from=${airport.location.lat},${airport.location.lng}&from_name=${encodeURIComponent(airport.name)}`;
}

/** 谷歌 encoded polyline 的写法（只用来构造路线图的检查数据）。 */
export function encodePolyline(points: readonly { lat: number; lng: number }[]): string {
  let last = { lat: 0, lng: 0 };
  let out = "";
  const encode = (value: number): void => {
    let rest = value < 0 ? ~(value << 1) : value << 1;
    while (rest >= 0x20) {
      out += String.fromCharCode((0x20 | (rest & 0x1f)) + 63);
      rest >>= 5;
    }
    out += String.fromCharCode(rest + 63);
  };
  for (const point of points) {
    const lat = Math.round(point.lat * 1e5);
    const lng = Math.round(point.lng * 1e5);
    encode(lat - last.lat);
    encode(lng - last.lng);
    last = { lat, lng };
  }
  return out;
}

export function tomorrowInTokyo(): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(Date.now() + 24 * 3_600_000)).map((part) => [part.type, part.value]));
  return `${parts["year"]}-${parts["month"]}-${parts["day"]}`;
}

/** 320 / 360 / 400 不横向滚动（都是手机分步，不跨过 1024），亮暗两色 axe。 */
export async function expectNarrowAndAccessible(page: Page, what: string): Promise<void> {
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

/**
 * 路线图上真的画出了线（M8-04 验收问题 2：矢量层的 <svg> 被全站的 max-width 压成 0 宽，线看不见）：
 * 路线的路径有可见的大小、落在地图框里，起终点也在框里。
 */
export async function expectRouteLineVisible(page: Page, start: { lat: number; lng: number }): Promise<void> {
  const canvas = page.locator(".route-map__canvas").first();
  await expect(canvas).toBeVisible();
  await expect(page.getByText("约 25 分钟 · 14.2 公里").first()).toBeVisible();
  const frame = await canvas.boundingBox();
  const line = await canvas.locator("path.route-map__line").boundingBox();
  const svg = await canvas.locator(".leaflet-pane > svg").first().boundingBox();
  if (frame === null || line === null || svg === null) throw new Error(`路线图没有画出来（起点 ${start.lat},${start.lng}）`);
  expect(svg.width, "矢量层的 svg 有宽度").toBeGreaterThan(frame.width / 2);
  expect(line.width + line.height, "路线有可见的长度").toBeGreaterThan(40);
  expect(line.x).toBeGreaterThanOrEqual(frame.x - 1);
  expect(line.y).toBeGreaterThanOrEqual(frame.y - 1);
  expect(line.x + line.width).toBeLessThanOrEqual(frame.x + frame.width + 1);
  expect(line.y + line.height).toBeLessThanOrEqual(frame.y + frame.height + 1);
  for (const marker of [".route-map__start", ".route-map__end"]) {
    const box = await canvas.locator(`path${marker}`).boundingBox();
    expect(box, `${marker} 画出来了`).not.toBeNull();
    if (box !== null) expect(box.width, `${marker} 有大小`).toBeGreaterThan(4);
  }
  // 线真的在最上面（M8-04 复查问题 1：瓦片层盖住了路线）：取路线中点和终点标记中心，那一点最上层的元素就是它们自己
  const onTop = await canvas.evaluate((root) => {
    const hit = (element: Element | null, target: SVGGraphicsElement): boolean => element === target || (element !== null && target.contains(element));
    const line = root.querySelector("path.route-map__line") as SVGPathElement;
    const endMarker = root.querySelector("path.route-map__end") as SVGGraphicsElement;
    // 路线不接收点击（pointer-events: none），量的时候临时打开，elementFromPoint 才会把它算进去；量完还原
    for (const element of [line, endMarker]) element.style.pointerEvents = "visiblePainted";
    const middle = line.getPointAtLength(line.getTotalLength() / 2);
    const matrix = line.getScreenCTM();
    const point = matrix === null ? null : new DOMPoint(middle.x, middle.y).matrixTransform(matrix);
    const end = endMarker.getBoundingClientRect();
    const result = {
      line: point !== null && hit(document.elementFromPoint(point.x, point.y), line),
      end: hit(document.elementFromPoint(end.x + end.width / 2, end.y + end.height / 2), endMarker),
    };
    for (const element of [line, endMarker]) element.style.pointerEvents = "";
    return result;
  });
  expect(onTop, "路线和终点没有被瓦片盖住").toEqual({ line: true, end: true });
  // 测试环境的瓦片不一定画在路线底下，上面那条不一定能发现；再直接核对层级：瓦片层必须在矢量层下面
  const layers = await canvas.evaluate((root) => {
    const z = (selector: string): string => getComputedStyle(root.querySelector(selector) as Element).zIndex;
    return { tiles: z(".leaflet-tile-pane"), overlay: z(".leaflet-overlay-pane"), isolation: getComputedStyle(root).isolation };
  });
  expect(Number.isFinite(Number(layers.tiles)) && Number.isFinite(Number(layers.overlay)) && Number(layers.tiles) < Number(layers.overlay), `瓦片层（${layers.tiles}）在矢量层（${layers.overlay}）下面`).toBe(true);
  expect(layers.isolation, "地图框自成层叠范围").toBe("isolate");
}
