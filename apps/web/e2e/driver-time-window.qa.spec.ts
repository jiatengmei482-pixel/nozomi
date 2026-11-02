/**
 * M4-32 测试角色：司机页的时间窗口提示（ADR 0064）。真实浏览器 → 前端 → 真实 API → 真实 PostgreSQL，不 mock 接口。
 * - 手机宽度（320、390）、亮暗主题：提示看得到、不横向溢出、无障碍检查通过；按钮不禁用；
 * - 点得太早：服务器的说明出现在读屏会播报的区域（role="alert"），状态不变、没有任何流水；
 * - 页面开着放到时间以后（这里用挪用车时间代替等待），不刷新直接点就成功；
 * - 用车时间带秒：页面写的最早时间进到下一分钟；
 * - 完成以后没有「下一步」，也没有提示。
 * 「已经付过款」的订单由用例用迁移账号写进本次运行的 schema（虚构数据，运行结束随 schema 删除）；先造远期订单、派好车再挪时间。
 */
import { randomInt, randomUUID } from "node:crypto";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { createPool } from "../../api/src/db/pool.ts";
import { createProductByApi, createSupplier, createWorld, expectAccessible, post } from "./catalog.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

async function owner<T>(run: (client: ReturnType<typeof createPool>) => Promise<T>): Promise<T> {
  const url = process.env["E2E_DATABASE_OWNER_URL"];
  if (!url) throw new Error("global-setup 没有准备好数据库连接");
  const client = createPool(url, { max: 1 });
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** 东京当地时间 `YYYY-MM-DD HH:mm`，带秒的进到下一分钟。 */
const tokyo = (ms: number): string => new Date(Math.ceil(ms / MINUTE) * MINUTE + 9 * HOUR).toISOString().slice(0, 16).replace("T", " ");
const inHours = (hours: number): number => Math.ceil((Date.now() + hours * HOUR) / MINUTE) * MINUTE;

async function moveService(orderId: string, at: number): Promise<void> {
  const local = new Date(at + 9 * HOUR).toISOString().slice(0, 16);
  await owner(async (db) => {
    const moved = await db.query("update orders set service_at = $2, service_local = $3, service_date = $4 where id = $1", [orderId, new Date(at), local, local.slice(0, 10)]);
    expect(moved.rowCount).toBe(1);
  });
}

const statusOf = (orderId: string): Promise<string | undefined> => owner(async (db) => (await db.query<{ status: string }>("select status from orders where id = $1", [orderId])).rows[0]?.status);
const driverEvents = (orderId: string): Promise<number> => owner(async (db) => (await db.query("select 1 from order_events where order_id = $1 and actor = 'driver'", [orderId])).rowCount ?? 0);

/** 远期（`serviceAt`）的已付款接机单，经真实接口派车，返回司机链接。 */
async function dispatchedOrder(request: APIRequestContext, serviceAt: number): Promise<{ orderId: string; path: string }> {
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  const product = await createProductByApi(request, supplier, world, "airport_transfer");
  const local = new Date(serviceAt + 9 * HOUR).toISOString().slice(0, 16);
  const alphabet = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const orderNo = `NZ${new Date().toISOString().slice(0, 10).replaceAll("-", "")}${Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join("")}`;
  const orderId = await owner(async (db) => {
    const inserted = await db.query<{ id: string }>(
      `insert into orders (tenant_id, order_no, status, category, city_id, place_id, direction, product_id, product_version, vehicle_group_id, service_at, service_local, timezone, service_date,
                           urgent, passengers, luggage, dropoff, addons, flight_no, passenger, settlement_minor, settlement_currency, settlement, free_wait_minutes, inventory_held,
                           payment_due_at, confirmed_at, dispatch_due_at, created_at, updated_at)
       values ($1, $2, 'confirmed', 'airport_transfer', $3, $4, 'pickup', $5, 1, $6, $7, $8, 'Asia/Tokyo', $9, false, 2, 1, $10::jsonb, '[]'::jsonb, 'NH211', $11::jsonb, 20000, 'JPY', $12::jsonb, 90, false,
               now() + interval '30 minutes', now(), $7::timestamptz - interval '24 hours', now(), now()) returning id`,
      [
        supplier.tenant.tenantId, orderNo, world.city.id, world.airport.id, product.id, world.group.id, new Date(serviceAt), local, local.slice(0, 10),
        JSON.stringify({ lng: 139.76, lat: 35.68, address: "东京站八重洲口" }),
        JSON.stringify({ name: "王小明", phone: "+819012345678", email: "guest@e2e.example.com" }),
        JSON.stringify({ currency: "JPY", roundingUnit: 1, totalMinor: 20000, baseMinor: 20000, adjustMinor: 0, urgentMinor: 0, nightMinor: 0, addonsMinor: 0, driverLanguageMinor: 0 }),
      ],
    );
    return inserted.rows[0]?.id as string;
  });
  const headers = supplier.headers;
  const create = async <T>(path: string, data: unknown): Promise<T> => post<T>(request, { ...headers, "idempotency-key": randomUUID() }, path, data, path);
  const driver = await create<{ id: string }>("/tenant/v1/drivers", { name: "佐藤一郎", phone: `+8190${randomInt(10_000_000, 99_999_999)}`, languages: ["ja", "zh"], license_expires_on: "2035-01-01", driving_years: 12, gold: false });
  const vehicle = await create<{ id: string }>("/tenant/v1/vehicles", { plate: `品川 300 あ ${randomInt(1000, 9999)}`, vehicle_group_id: world.group.id, model: "丰田埃尔法", color: "黑", seats: 7, mileage_km: 30000, plate_type: "business", insurance_expires_on: "2035-01-01", inspection_expires_on: "2035-01-01" });
  const version = (await (await request.get(`/tenant/v1/orders/${orderId}`, { headers })).json()).order.version as number;
  const assigned = await request.post(`/tenant/v1/orders/${orderId}/assign`, { headers: { ...headers, "if-match": `"${version}"` }, data: { driver_id: driver.id, vehicle_id: vehicle.id } });
  expect(assigned.ok(), await assigned.text()).toBe(true);
  return { orderId, path: ((await assigned.json()) as { driver_link: { path: string } }).driver_link.path };
}

async function noHorizontalOverflow(page: Page, what: string): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${what} 不能横向滚动`).toBeLessThanOrEqual(0);
}

for (const [scheme, width] of [["dark", 320], ["light", 390]] as const) {
  test(`手机 ${width} 宽、${scheme === "dark" ? "暗" : "亮"}色：提示看得到、按钮能点、无障碍通过；点早了说明进读屏播报区，状态和流水都不变`, async ({ request, browser }) => {
    test.setTimeout(120_000);
    const serviceAt = inHours(3 * 24);
    const { orderId, path } = await dispatchedOrder(request, serviceAt);
    const phone = await browser.newContext({ viewport: { width, height: 740 }, locale: "zh-CN", colorScheme: scheme });
    const page = await phone.newPage();
    await page.goto(path);
    const hint = page.getByText(`还没到时间：最早 ${tokyo(serviceAt - 24 * HOUR)}（Asia/Tokyo 当地时间）才能点「我出发了」。行程有变请联系调度。`);
    await expect(hint).toBeVisible();
    const button = page.getByRole("button", { name: "我出发了" });
    await expect(button, "按钮不禁用").toBeEnabled();
    await noHorizontalOverflow(page, "还没到时间的司机页");
    await expectAccessible(page, `司机页（还没到时间，${scheme}，${width}）`);

    await button.click();
    const message = `现在还不能点「我出发了」：最早在用车前 24 小时，也就是 ${tokyo(serviceAt - 24 * HOUR)}（Asia/Tokyo 当地时间）以后才能点`;
    await expect(page.getByText(message, { exact: false })).toBeVisible();
    await expect(button).toBeEnabled();
    await noHorizontalOverflow(page, "显示说明之后的司机页");
    await expectAccessible(page, `司机页（点早了，${scheme}，${width}）`);
    expect(await statusOf(orderId)).toBe("assigned");
    expect(await driverEvents(orderId)).toBe(0);
    // 说明出现在页面顶部；按钮在下面。手机上点完按钮要看得到说明（滚过去或把焦点移过去），不然像是「点了没反应」
    await expect.soft(page.getByText(message, { exact: false }), "点完按钮后说明要在屏幕里看得到").toBeInViewport();
    // 点了之后才出现的说明要让读屏读出来（WCAG 4.1.3）：放在 role="alert" 的区域里
    await expect.soft(page.getByRole("alert").filter({ hasText: "现在还不能点" }), "太早的说明要在 role=alert 的播报区域里").toHaveCount(1);
    await phone.close();
  });
}

test("页面开着放到时间以后：不刷新直接点就成功；接到客人的提示按新的一步重新算", async ({ request, browser }) => {
  test.setTimeout(120_000);
  const serviceAt = inHours(3 * 24);
  const { orderId, path } = await dispatchedOrder(request, serviceAt);
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "zh-CN" });
  const page = await phone.newPage();
  await page.goto(path);
  await expect(page.getByText(/还没到时间：最早/)).toBeVisible();
  // 时间到了（用车时间挪到 5 小时后），页面不刷新
  const soon = inHours(5);
  await moveService(orderId, soon);
  await page.getByRole("button", { name: "我出发了" }).click();
  await expect(page.getByRole("button", { name: "已到达上车点" })).toBeVisible();
  await expect(page.getByText(/还没到时间/), "到达已经可以点，不提示").toHaveCount(0);
  await page.getByRole("button", { name: "已到达上车点" }).click();
  await expect(page.getByText(`还没到时间：最早 ${tokyo(soon - 3 * HOUR)}（Asia/Tokyo 当地时间）才能点「接到客人了」。行程有变请联系调度。`)).toBeVisible();
  expect(await statusOf(orderId)).toBe("arrived");
  await phone.close();
});

test("用车时间带秒：页面写的最早时间进到下一分钟；完成以后没有下一步和提示", async ({ request, browser }) => {
  test.setTimeout(120_000);
  const serviceAt = inHours(3 * 24) + 30_000;
  const { orderId, path } = await dispatchedOrder(request, serviceAt);
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "zh-CN" });
  const page = await phone.newPage();
  await page.goto(path);
  await expect(page.getByText(`还没到时间：最早 ${tokyo(serviceAt - 24 * HOUR)}（Asia/Tokyo 当地时间）才能点「我出发了」。行程有变请联系调度。`)).toBeVisible();
  expect(tokyo(serviceAt - 24 * HOUR)).toBe(new Date(serviceAt - 24 * HOUR + 30_000 + 9 * HOUR).toISOString().slice(0, 16).replace("T", " "));

  await moveService(orderId, Date.now() - 10 * MINUTE);
  await page.reload();
  for (const label of ["我出发了", "已到达上车点", "接到客人了", "服务完成"]) {
    await expect(page.getByText(/还没到时间/)).toHaveCount(0);
    await page.getByRole("button", { name: label }).click();
    await expect(page.getByRole("button", { name: label })).toHaveCount(0);
  }
  await expect(page.getByRole("heading", { name: "下一步" })).toHaveCount(0);
  await expect(page.getByText(/还没到时间/)).toHaveCount(0);
  expect(await statusOf(orderId)).toBe("completed");
  await phone.close();
});
