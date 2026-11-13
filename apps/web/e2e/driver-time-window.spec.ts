/**
 * 端到端：司机点得太早有提示（M4-32，ADR 0064）。真实浏览器 → 前端 → 真实 API → 真实 PostgreSQL，不 mock 接口。
 * 复现测试环境里真实发生的情况：用车前几天司机就点了出发、到达、接到客人、完成。现在：
 * - 远期的单打开司机链接，按钮下面写着最早几点可以点；点了显示服务器的说明，订单还是「已派车」；
 * - 把用车时间挪到 5 小时后：出发、到达可以点；接到客人还要等到用车前 3 小时，点了有说明。
 * 「已经付过款」的订单由用例用迁移账号写进本次运行的 schema（只在测试里构造，运行结束随 schema 删除）。先造远期订单、派好车再挪时间。
 *
 * 吸底按钮条（M6-08，driver.md 3b；业主 2026-11-13 决定）：手机宽 320 / 360 / 390、亮暗两色，打开链接不滚动就看得到「下一步」按钮和「还没到时间」提示；
 * 滚到底最后一行（链接有效期）不被按钮条挡住；不横向滚动；axe 零违规；按钮照常能点。
 */
import { mkdirSync } from "node:fs";
import { randomInt, randomUUID } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { createPool } from "../../api/src/db/pool.ts";
import { createProductByApi, createSupplier, createWorld, expectAccessible, post } from "./catalog.ts";

const HOUR = 3_600_000;

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

/** 东京当地时间 `YYYY-MM-DD HH:mm`（整分钟的时刻）。 */
const tokyo = (at: Date): string => new Date(at.getTime() + 9 * HOUR).toISOString().slice(0, 16).replace("T", " ");
/** 现在之后 `hours` 小时，对齐到整分钟（真实订单的用车时间都是整分钟）。 */
const inHours = (hours: number): Date => new Date(Math.ceil((Date.now() + hours * HOUR) / 60_000) * 60_000);

async function writeServiceTime(orderId: string, at: Date, status: "confirmed" | "assigned"): Promise<void> {
  const local = tokyo(at).replace(" ", "T");
  await owner(async (db) => {
    const moved = await db.query("update orders set service_at = $2, service_local = $3, service_date = $4 where id = $1 and status = $5", [orderId, at, local, local.slice(0, 10), status]);
    expect(moved.rowCount).toBe(1);
  });
}

/** 造一张「已经付过款」的接机单（用车时间 serviceAt），供应商经真实接口派车；返回订单编号和司机链接。 */
async function assignedTrip(request: APIRequestContext, serviceAt: Date): Promise<{ orderId: string; path: string }> {
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  const product = await createProductByApi(request, supplier, world, "airport_transfer");
  const local = tokyo(serviceAt).replace(" ", "T");
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
        supplier.tenant.tenantId, orderNo, world.city.id, world.airport.id, product.id, world.group.id, serviceAt, local, local.slice(0, 10),
        JSON.stringify({ lng: 139.76, lat: 35.68, address: "东京站八重洲口" }),
        JSON.stringify({ name: "王小明", phone: "+819012345678", email: "guest@e2e.example.com" }),
        JSON.stringify({ currency: "JPY", roundingUnit: 1, totalMinor: 20000, baseMinor: 20000, adjustMinor: 0, urgentMinor: 0, nightMinor: 0, addonsMinor: 0, driverLanguageMinor: 0 }),
      ],
    );
    return inserted.rows[0]?.id as string;
  });

  // 供应商经真实接口派车，拿到司机链接
  const headers = supplier.headers;
  const create = async <T>(path: string, data: unknown): Promise<T> => post<T>(request, { ...headers, "idempotency-key": randomUUID() }, path, data, path);
  const driver = await create<{ id: string }>("/tenant/v1/drivers", { name: "佐藤一郎", phone: `+8190${randomInt(10_000_000, 99_999_999)}`, languages: ["ja", "zh"], license_expires_on: "2035-01-01", driving_years: 12, gold: false });
  const vehicle = await create<{ id: string }>("/tenant/v1/vehicles", { plate: `品川 300 あ ${randomInt(1000, 9999)}`, vehicle_group_id: world.group.id, model: "丰田埃尔法", color: "黑", seats: 7, mileage_km: 30000, plate_type: "business", insurance_expires_on: "2035-01-01", inspection_expires_on: "2035-01-01" });
  const version = (await (await request.get(`/tenant/v1/orders/${orderId}`, { headers })).json()).order.version as number;
  const assigned = await request.post(`/tenant/v1/orders/${orderId}/assign`, { headers: { ...headers, "if-match": `"${version}"` }, data: { driver_id: driver.id, vehicle_id: vehicle.id } });
  expect(assigned.ok(), await assigned.text()).toBe(true);
  const path = ((await assigned.json()) as { driver_link: { path: string } }).driver_link.path;
  return { orderId, path };
}

test("司机点得太早：按钮下面写明最早几点；点了显示说明、状态不变；用车时间临近后出发、到达可以点，接到客人还要等到用车前 3 小时", async ({ request, browser }) => {
  test.setTimeout(120_000);
  const serviceAt = inHours(3 * 24);
  const { orderId, path } = await assignedTrip(request, serviceAt);

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "zh-CN" });
  const page = await phone.newPage();
  await page.goto(path);
  await expect(page.getByText("王小明 · 2 人 1 件行李")).toBeVisible();

  // 远期的单：出发最早在用车前 24 小时
  const departEarliest = tokyo(new Date(serviceAt.getTime() - 24 * HOUR));
  await expect(page.getByText(`还没到时间：最早 ${departEarliest}（Asia/Tokyo 当地时间）才能点「我出发了」。行程有变请联系调度。`)).toBeVisible();
  await expectAccessible(page, "司机页面（还没到时间）");
  await page.getByRole("button", { name: "我出发了" }).click();
  await expect(page.getByText(new RegExp(`现在还不能点「我出发了」：最早在用车前 24 小时，也就是 ${departEarliest}（Asia/Tokyo 当地时间）以后才能点`))).toBeVisible();
  await expect(page.getByRole("button", { name: "我出发了" })).toBeVisible();
  const status = await owner(async (db) => (await db.query<{ status: string }>("select status from orders where id = $1", [orderId])).rows[0]?.status);
  expect(status).toBe("assigned");

  // 用车时间挪到 5 小时后：出发、到达可以点；接到客人最早在用车前 3 小时
  const soon = inHours(5);
  await writeServiceTime(orderId, soon, "assigned");
  await page.reload();
  await expect(page.getByText(/还没到时间/)).toHaveCount(0);
  await page.getByRole("button", { name: "我出发了" }).click();
  await page.getByRole("button", { name: "已到达上车点" }).click();
  const pickEarliest = tokyo(new Date(soon.getTime() - 3 * HOUR));
  await expect(page.getByText(`还没到时间：最早 ${pickEarliest}（Asia/Tokyo 当地时间）才能点「接到客人了」。行程有变请联系调度。`)).toBeVisible();
  await page.getByRole("button", { name: "接到客人了" }).click();
  await expect(page.getByText(new RegExp(`现在还不能点「接到客人了」：最早在用车前 3 小时，也就是 ${pickEarliest}`))).toBeVisible();
  await expect(page.getByRole("button", { name: "接到客人了" })).toBeVisible();
  await phone.close();
});

const SHOTS = process.env["DRIVER_SHOTS_DIR"];

test("司机页吸底按钮条（M6-08）：手机宽首屏看得到「下一步」和提示；滚到底最后一行不被挡；不横向滚动；亮暗两色 axe 零违规；点击照常", async ({ request, browser }) => {
  test.setTimeout(120_000);
  const serviceAt = inHours(3 * 24);
  const { orderId, path } = await assignedTrip(request, serviceAt);
  const departEarliest = tokyo(new Date(serviceAt.getTime() - 24 * HOUR));
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });

  for (const width of [320, 360, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 640 }, locale: "zh-CN", hasTouch: true, isMobile: true });
    for (const scheme of ["light", "dark"] as const) {
      // 每种颜色开一个新标签页：同一个页面再 goto 同一个 # 链接不会重新加载，会停在上次滚到的位置
      const page = await context.newPage();
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(path);
      await expect(page.getByText("王小明 · 2 人 1 件行李")).toBeVisible();
      // 不滚动：按钮和「还没到时间」提示都在首屏里
      const button = page.getByRole("button", { name: "我出发了" });
      const hint = page.getByText(`还没到时间：最早 ${departEarliest}（Asia/Tokyo 当地时间）才能点「我出发了」。行程有变请联系调度。`);
      await expect(button).toBeInViewport({ ratio: 1 });
      await expect(hint).toBeInViewport({ ratio: 1 });
      expect(await page.evaluate(() => window.scrollY), `${width}px 打开时没有滚动`).toBe(0);
      await expect(button).toHaveAttribute("aria-describedby", (await hint.getAttribute("id")) ?? "");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}px 不横向滚动`).toBe(0);
      await expectAccessible(page, `司机页吸底按钮条（${width}px，${scheme === "light" ? "亮色" : "暗色"}）`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/driver-${width}-${scheme}-top.png` });

      // 滚到底：最后一行（链接有效期）完整地在按钮条上面
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const footnote = page.getByText(/^链接有效期到 /);
      await expect(footnote).toBeInViewport({ ratio: 1 });
      const footBox = await footnote.boundingBox();
      const barBox = await page.locator(".driver-next-bar").boundingBox();
      expect(footBox && barBox && footBox.y + footBox.height <= barBox.y, `${width}px 最后一行没被按钮条挡住`).toBe(true);
      await expect(button).toBeInViewport({ ratio: 1 });
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/driver-${width}-${scheme}-bottom.png` });
      await page.close();
    }
    await context.close();
  }

  // 点击照常：用车时间挪到 5 小时后，360px 首屏直接点「我出发了」，下一步换成「已到达上车点」，仍在首屏
  await writeServiceTime(orderId, inHours(5), "assigned");
  const phone = await browser.newContext({ viewport: { width: 360, height: 640 }, locale: "zh-CN", hasTouch: true, isMobile: true });
  const page = await phone.newPage();
  await page.goto(path);
  await expect(page.getByText(/还没到时间/)).toHaveCount(0);
  await page.getByRole("button", { name: "我出发了" }).tap();
  const arrived = page.getByRole("button", { name: "已到达上车点" });
  await expect(arrived).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const status = await owner(async (db) => (await db.query<{ status: string }>("select status from orders where id = $1", [orderId])).rows[0]?.status);
  expect(status).toBe("departed");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/driver-360-light-departed.png` });
  await phone.close();
});
