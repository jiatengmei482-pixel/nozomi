/**
 * M4-20 测试角色，端到端：真实浏览器里的恶意和极端图片、长备注、键盘（ADR 0054）。no-show-evidence.spec.ts 已测的正常流程不重复。
 * 种数据的方式同那个用例：司机经真实接口上传，真实时钟走不完的部分写进本次运行的 schema（运行结束随 schema 删除）。全部虚构。
 */
import { randomInt, randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { createPool } from "../../api/src/db/pool.ts";
import { createProductByApi, createSupplier, createWorld, expectAccessible, post, tenantHeaders } from "./catalog.ts";
import { adminCredentials, expectNoHorizontalOverflow, loginAs, platformAdminHeaders } from "./support.ts";

function crc32(data: Buffer): number {
  let crc = ~0;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return ~crc >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/** 真的 PNG：整张纯红（索引色，压缩后很小，解码后很大）。 */
function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 3;
  const row = Buffer.alloc(width + 1);
  const raw = Buffer.alloc(row.length * height, row);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("PLTE", Buffer.from([255, 0, 0])), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const CORRUPT_PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 0x41)]);
const FAKE_HEIC = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(64, 0x42)]);
const POLYGLOT_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("<html><script>window.__pwned=1</script><img src=x onerror=window.__pwned=1></html>")]);

const ALPHABET = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const random = (length: number, alphabet = ALPHABET): string => Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join("");
const MINUTE = 60_000;

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

async function seedClaim(request: APIRequestContext, photos: { type: string; data: Buffer }[], note: string): Promise<{ orderId: string; ticketId: string }> {
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  const product = await createProductByApi(request, supplier, world, "airport_transfer");
  const admin = await platformAdminHeaders(request);
  const channel = await post<{ channel: { id: string } }>(request, admin, "/platform/v1/channels", { type: "own", settle_currency: "JPY", name: `官网-${random(4)}` }, "新建渠道");
  const client = await post<{ api_client: { id: string } }>(request, admin, `/platform/v1/channels/${channel.channel.id}/api-clients`, { name: "官网" }, "发 API 客户端");
  const tenantId = supplier.tenant.tenantId;
  // 用车在 3 小时前；落地比计划晚 20 分钟（客人确认）
  const now = Date.now();
  const serviceAt = new Date(now - 180 * MINUTE);
  const landedAt = new Date(serviceAt.getTime() + 20 * MINUTE);
  const freeWaitEnd = new Date(landedAt.getTime() + 90 * MINUTE);

  const { id: orderId, orderNo } = await owner(async (db) => {
    const local = new Date(serviceAt.getTime() + 9 * 3_600_000).toISOString().slice(0, 16);
    const today = new Date(now).toISOString().slice(0, 10).replaceAll("-", "");
    const orderNo = `NZ${today}${random(8)}`;
    const quoteId = `QT${today}${random(10, "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ")}`;
    const log = await db.query<{ id: string }>("insert into quote_logs (channel_id, api_client_id, created_at, request, currency, city_id, category, candidate_count, quote_count, bids, rejects, duration_ms, ordered) values ($1, $2, now(), '{}'::jsonb, 'JPY', $3, 'airport_transfer', 1, 1, '[]'::jsonb, '[]'::jsonb, 5, true) returning id", [channel.channel.id, client.api_client.id, world.city.id]);
    const snapshot = { quoteId, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 30 * MINUTE).toISOString(), bandBp: 300, markup: { markupBp: 1000, level: 5, ruleId: null }, candidates: [], currency: "JPY" };
    await db.query(
      `insert into quotes (id, channel_id, quote_log_id, vehicle_group_id, winner_tenant_id, product_id, product_version, currency, sell_minor, settlement_minor, settlement_currency, markup_bp, markup_level, snapshot, created_at, expires_at)
       values ($1, $2, $3, $4, $5, $6, 1, 'JPY', 21780, 19800, 'JPY', 1000, 5, $7::jsonb, now(), now() + interval '30 minutes')`,
      [quoteId, channel.channel.id, log.rows[0]?.id, world.group.id, tenantId, product.id, JSON.stringify(snapshot)],
    );
    const settlement = { currency: "JPY", roundingUnit: 1, totalMinor: 19800, baseMinor: 19800, adjustMinor: 0, urgentMinor: 0, nightMinor: 0, addonsMinor: 0, driverLanguageMinor: 0, usage: null };
    const inserted = await db.query<{ id: string }>(
      `insert into orders (tenant_id, order_no, status, category, city_id, place_id, direction, product_id, product_version, vehicle_group_id, service_at, service_local, timezone, service_date,
                           urgent, passengers, luggage, dropoff, addons, flight_no, passenger, settlement_minor, settlement_currency, settlement, free_wait_minutes, inventory_held,
                           payment_due_at, confirmed_at, dispatch_due_at, cancel_policy, created_at, updated_at)
       values ($1, $2, 'confirmed', 'airport_transfer', $3, $4, 'pickup', $5, 1, $6, $7, $8, 'Asia/Tokyo', $9, false, 2, 1, $10::jsonb, '[]'::jsonb, 'NH211', $11::jsonb, 19800, 'JPY', $12::jsonb, 90, false,
               now() + interval '30 minutes', now(), now() + interval '1 hour', $13::jsonb, now(), now()) returning id`,
      [
        tenantId, orderNo, world.city.id, world.airport.id, product.id, world.group.id, serviceAt, local, local.slice(0, 10),
        JSON.stringify({ lng: 139.76, lat: 35.68, address: "东京站八重洲口" }),
        JSON.stringify({ name: "王小明", phone: "+819012345678", email: "guest@e2e.example.com" }),
        JSON.stringify(settlement),
        JSON.stringify({ version: 0, category: "airport_transfer", level: "business", tiers: [{ minHoursBefore: 48, feeBp: 0 }, { minHoursBefore: 24, feeBp: 5000 }, { minHoursBefore: 0, feeBp: 10000 }] }),
      ],
    );
    const id = inserted.rows[0]?.id as string;
    await db.query(
      `insert into order_sales (order_id, supplier_tenant_id, channel_id, api_client_id, quote_id, idempotency_key, request_hash, currency, sell_minor, markup_bp, fx, fx_buffer_bp, created_at)
       values ($1, $2, $3, $4, $5, $6, 'e2e', 'JPY', 21780, 1000, null, 0, now())`,
      [id, tenantId, channel.channel.id, client.api_client.id, quoteId, randomUUID()],
    );
    return { id, orderNo };
  });

  // 供应商经真实接口派车，司机经真实接口回传和上传
  const headers = await tenantHeaders(request, supplier.tenant.adminEmail, supplier.tenant.password);
  const create = async <T>(path: string, data: unknown): Promise<T> => post<T>(request, { ...headers, "idempotency-key": randomUUID() }, path, data, path);
  const driver = await create<{ id: string }>("/tenant/v1/drivers", { name: "佐藤一郎", phone: `+8190${randomInt(10_000_000, 99_999_999)}`, languages: ["ja", "zh"], license_expires_on: "2035-01-01", driving_years: 12, gold: false });
  const vehicle = await create<{ id: string }>("/tenant/v1/vehicles", { plate: `品川 300 あ ${randomInt(1000, 9999)}`, vehicle_group_id: world.group.id, model: "丰田埃尔法", color: "黑", seats: 7, mileage_km: 30000, plate_type: "business", insurance_expires_on: "2035-01-01", inspection_expires_on: "2035-01-01" });
  const version = (await (await request.get(`/tenant/v1/orders/${orderId}`, { headers })).json()).order.version as number;
  const assigned = await request.post(`/tenant/v1/orders/${orderId}/assign`, { headers: { ...headers, "if-match": `"${version}"` }, data: { driver_id: driver.id, vehicle_id: vehicle.id } });
  expect(assigned.ok(), await assigned.text()).toBe(true);
  const driverToken = ((await assigned.json()) as { driver_link: { token: string } }).driver_link.token;
  const auth = { authorization: `Bearer ${driverToken}` };
  for (const type of ["departed", "arrived"]) {
    const res = await request.post("/driver/v1/trip/events", { headers: auth, data: { type } });
    expect(res.ok(), await res.text()).toBe(true);
  }
  for (const photo of photos) {
    const res = await request.post("/driver/v1/trip/files?kind=signboard", { headers: { ...auth, "content-type": photo.type }, data: photo.data });
    expect(res.ok(), await res.text()).toBe(true);
  }
  const shot = await request.post("/driver/v1/trip/files?kind=contact_screenshot", { headers: { ...auth, "content-type": "image/png" }, data: png(2, 2) });
  expect(shot.ok(), await shot.text()).toBe(true);
  const shotId = ((await shot.json()) as { file: { id: string } }).file.id;
  const contact = await request.post("/driver/v1/trip/contacts", { headers: auth, data: { method: "messaging", note, file_id: shotId } });
  expect(contact.ok(), await contact.text()).toBe(true);
  for (let i = 0; i < 5; i += 1) {
    const ping = await request.post("/driver/v1/trip/locations", { headers: auth, data: { location: { lng: 140.389, lat: 35.769, accuracy_m: 12 } } });
    expect(ping.ok(), await ping.text()).toBe(true);
  }

  // 真实时钟走不完免费等待：到达、联系、申请离开的时间和 no-show 申请、审核工单在这里写库
  const ticketId = await owner(async (db) => {
    const arrivedAt = new Date(serviceAt.getTime() - 10 * MINUTE);
    await db.query("update orders set guest_landed_at = $2, landed_at = $2, landed_source = 'guest', arrived_at = $3, arrival_distance_m = 120, leave_requested_at = $4, status = 'no_show_claimed' where id = $1", [orderId, landedAt, arrivedAt, new Date(freeWaitEnd.getTime() + MINUTE)]);
    await db.query("update order_contacts set occurred_at = $2 where order_id = $1", [orderId, new Date(landedAt.getTime() + 10 * MINUTE)]);
    await db.query("update order_files set uploaded_at = $2 where order_id = $1", [orderId, new Date(landedAt.getTime() + 5 * MINUTE)]);
    const link = await db.query<{ id: string }>("select id from driver_links where order_id = $1 order by created_at desc limit 1", [orderId]);
    const checklist = [{ item: "arrived_on_time_nearby", ok: true }, { item: "contact_attempts", ok: true }, { item: "signboard_photo", ok: true }, { item: "leave_consented", ok: true }, { item: "submitted_in_time", ok: true }];
    await db.query("insert into order_no_show_claims (tenant_id, order_id, submitted_at, checklist, free_wait_start, free_wait_end, status, link_id) values ($1, $2, now(), $3::jsonb, $4, $5, 'pending_review', $6)", [tenantId, orderId, JSON.stringify(checklist), landedAt, freeWaitEnd, link.rows[0]?.id]);
    const ticketNo = `TK${new Date(now).toISOString().slice(0, 10).replaceAll("-", "")}${random(6)}`;
    const ticket = await db.query<{ id: string }>(
      `insert into tickets (tenant_id, order_id, ticket_no, type, status, priority, source, subject, description, created_by_type, first_response_due_at, resolution_due_at, created_at, updated_at)
       values ($1, $2, $3, 'no_show_review', 'open', 'normal', 'system', $4, '司机提交了客人未出现（no-show），5 项证据已在提交时核对，请审核。', 'system', now() + interval '2 hours', now() + interval '1 day', now(), now()) returning id`,
      [tenantId, orderId, ticketNo, `no-show 审核：订单 ${orderNo}`],
    );
    return ticket.rows[0]?.id as string;
  });
  return { orderId, ticketId };
}


function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("Content Security Policy")) violations.push(message.text());
  });
  return violations;
}

async function openTicket(page: Page, ticketId: string) {
  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);
  await page.goto(`/platform/tickets/${ticketId}`);
  const aside = page.getByRole("complementary", { name: "处理和判定" });
  const card = aside.locator("section").filter({ has: page.getByRole("heading", { name: /^no-show 证据（/ }) });
  await expect(card).toContainText("✓ 满足");
  return card;
}

test("恶意和损坏的图片：脚本不执行，内容安全策略不被放宽，写明显示不了并给下载；页面不卡死、不溢出，没有 blob 图片", async ({ page, request }) => {
  test.setTimeout(180_000);
  const seed = await seedClaim(request, [{ type: "image/png", data: CORRUPT_PNG }, { type: "image/heic", data: FAKE_HEIC }, { type: "image/jpeg", data: POLYGLOT_JPEG }, { type: "image/png", data: png(2, 2) }], "没人接");
  const violations = watchCsp(page);
  const card = await openTicket(page, seed.ticketId);
  await expect(card.getByText("浏览器显示不了这种格式，请下载后查看。")).toHaveCount(3, { timeout: 20_000 });
  await expect(card.getByRole("link", { name: "下载举牌照片原图" })).toHaveCount(4);
  await expect(card.getByRole("img", { name: /^举牌照片/ })).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  expect(await page.locator("img[src^='blob:'], iframe, object, embed").count()).toBe(0);
  for (const link of await card.getByRole("link", { name: "下载举牌照片原图" }).all()) await expect(link).toHaveAttribute("download", "");
  expect(violations).toEqual([]);
  const policy = (await request.get(`/platform/tickets/${seed.ticketId}`)).headers()["content-security-policy"];
  if (policy !== undefined) expect(policy).not.toContain("blob:");
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await expectNoHorizontalOverflow(page, `恶意图片（${width}px）`);
  }
  await expectAccessible(page, "工单详情（损坏的证据照片）");
});

for (const [label, width, height] of [["对照：普通比例", 2_000, 1], ["极宽", 70_000, 1], ["极高", 1, 70_000]] as const) {
  test(`宽高极端（${label} ${width}×${height}）：要么真的画出来，要么写明显示不了，不能是一块空白`, async ({ page, request }) => {
    test.setTimeout(120_000);
    const seed = await seedClaim(request, [{ type: "image/png", data: png(width, height) }], "没人接");
    const card = await openTicket(page, seed.ticketId);
    await expect(card.getByRole("link", { name: "下载举牌照片原图" })).toBeVisible({ timeout: 30_000 });
    const photo = card.getByRole("img", { name: /^举牌照片/ });
    if ((await photo.count()) > 0) {
      const painted = await photo.evaluate((canvas: HTMLCanvasElement) => {
        const probe = document.createElement("canvas");
        probe.width = 1;
        probe.height = 1;
        const context = probe.getContext("2d") as CanvasRenderingContext2D;
        context.drawImage(canvas, 0, 0, 1, 1);
        return { alpha: context.getImageData(0, 0, 1, 1).data[3], width: canvas.width, height: canvas.height };
      });
      expect(painted.alpha, `canvas ${painted.width}×${painted.height} 上什么都没画，页面也没有提示`).toBeGreaterThan(0);
    } else {
      await expect(card.getByText("浏览器显示不了这种格式，请下载后查看。")).toBeVisible();
    }
    for (const viewport of [320, 1280]) {
      await page.setViewportSize({ width: viewport, height: 800 });
      await expectNoHorizontalOverflow(page, `${label}图片（${viewport}px）`);
    }
  });
}

test("超大图（12000×12000，解码后约 576 MB）：页面不卡死，缩略图不撑破版面", async ({ page, request }) => {
  test.setTimeout(180_000);
  const data = png(12_000, 12_000);
  expect(data.length).toBeLessThan(5 * 1024 * 1024);
  const seed = await seedClaim(request, [{ type: "image/png", data }], "没人接");
  const card = await openTicket(page, seed.ticketId);
  await expect(card.getByRole("link", { name: "下载举牌照片原图" })).toBeVisible({ timeout: 60_000 });
  const started = Date.now();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  expect(Date.now() - started, "主线程还能响应").toBeLessThan(5_000);
  const box = await card.getByRole("img", { name: /^举牌照片/ }).boundingBox();
  expect(box?.height ?? 0).toBeLessThan(300);
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await expectNoHorizontalOverflow(page, `超大图（${width}px）`);
  }
});

test("长备注（没有空格）和定位记录：320、1280 不溢出；键盘能打开截图和定位记录；打码后页面上没有原文；替代文字说明是什么照片", async ({ page, request }) => {
  test.setTimeout(180_000);
  const note = `${"没人接".repeat(20)}${"A".repeat(120)} 打 +81 90-1234-5678`;
  const seed = await seedClaim(request, [{ type: "image/png", data: png(2, 2) }], note);
  const card = await openTicket(page, seed.ticketId);
  await expect(card).toContainText("打 ****5678");
  await expect(page.locator("body")).not.toContainText("90-1234-5678");
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await expectNoHorizontalOverflow(page, `长备注（${width}px）`);
  }
  const view = card.getByRole("button", { name: "查看联系截图" });
  await view.focus();
  await page.keyboard.press("Enter");
  const shot = card.getByRole("img", { name: /^联系截图，系统时间 \d{4}-\d{2}-\d{2} \d{2}:\d{2}/ });
  await expect(shot).toBeVisible();
  expect(await shot.evaluate((element) => element.tagName)).toBe("CANVAS");
  const summary = card.locator("summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(card.locator("details")).toHaveAttribute("open", "");
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await expectNoHorizontalOverflow(page, `定位记录展开（${width}px）`);
  }
  await expectAccessible(page, "工单详情（长备注）");
});
