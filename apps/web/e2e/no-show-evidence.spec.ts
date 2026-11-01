/**
 * 端到端：运营审核 no-show 看得到证据（M4-20，ADR 0054）。真实浏览器 → 前端 → 真实 API → 真实 PostgreSQL，不 mock 接口。
 * 供应商派车 → 司机经 H5 接口回传、上传照片、记联系 → 「等够免费等待」这段时间无法在真实时钟里走完，用例用迁移账号把到达、申请离开、no-show 申请和审核工单写进本次运行的 schema（只在测试里构造，运行结束随 schema 删除）。
 * 运营打开工单：判定按钮旁看得到 5 项和各项事实、落地时间、免费等待、举牌照片（真的显示出来），截图点了才取，取了记审计；320、1280 宽不溢出。只读员工能看不能判。没有权限、跨数据范围的用例在 no-show-evidence.itest.ts。
 */
import { randomInt, randomUUID } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { createPool } from "../../api/src/db/pool.ts";
import { createProductByApi, createSupplier, createWorld, expectAccessible, post, tenantHeaders } from "./catalog.ts";
import { adminCredentials, expectNoHorizontalOverflow, loginAs, newPassword, platformAdminHeaders, uniqueEmail } from "./support.ts";

const ALPHABET = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const random = (length: number, alphabet = ALPHABET): string => Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join("");
const MINUTE = 60_000;
/** 1×1 的 PNG：浏览器真的能显示。 */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64");

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

async function seedClaim(request: APIRequestContext): Promise<{ orderId: string; orderNo: string; ticketId: string; signboardId: string; screenshotId: string; tenantEmail: string; tenantPassword: string }> {
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
  const upload = async (kind: string): Promise<string> => {
    const res = await request.post(`/driver/v1/trip/files?kind=${kind}`, { headers: { ...auth, "content-type": "image/png" }, data: PNG });
    expect(res.ok(), await res.text()).toBe(true);
    return ((await res.json()) as { file: { id: string } }).file.id;
  };
  const signboardId = await upload("signboard");
  const screenshotId = await upload("contact_screenshot");
  const contact = await request.post("/driver/v1/trip/contacts", { headers: auth, data: { method: "messaging", note: "打了 +81 90-1234-5678，王小明已读不回", file_id: screenshotId } });
  expect(contact.ok(), await contact.text()).toBe(true);

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
  return { orderId, orderNo, ticketId, signboardId, screenshotId, tenantEmail: supplier.tenant.adminEmail, tenantPassword: supplier.tenant.password };
}

async function staff(request: APIRequestContext, name: string, grants: string[], scope: { city_ids: string[] | null; channel_ids: string[] | null }): Promise<{ email: string; password: string }> {
  const headers = await platformAdminHeaders(request);
  const role = await post<{ key: string }>(request, headers, "/platform/v1/roles", { name: `${name}-${random(4)}`, grants, data_scope: scope }, "新建角色");
  const email = uniqueEmail("evidence");
  const password = newPassword();
  const invited = await post<{ invite: { token: string } }>(request, headers, "/platform/v1/staff", { email, name, role: role.key }, "邀请员工");
  expect((await request.post("/platform/v1/auth/accept-invite", { data: { token: invited.invite.token, password } })).ok(), "员工设密码").toBe(true);
  return { email, password };
}

const auditCount = (orderId: string, fileId: string, email: string): Promise<number | null> => owner(async (db) => (await db.query("select 1 from audit_logs where resource = 'order' and resource_id = $1 and action = 'view_evidence_file' and actor_email = $2 and after->>'file_id' = $3", [orderId, email, fileId])).rowCount);

test("运营审核 no-show：判定按钮旁看得到 5 项、到达、联系、落地、免费等待和举牌照片；截图点了才取并记审计；乘客联系方式打码；不溢出", async ({ page, request, browser }) => {
  test.setTimeout(180_000);
  const seed = await seedClaim(request);
  const admin = adminCredentials();
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("Content Security Policy")) violations.push(message.text());
  });
  await loginAs(page, "platform", admin.email, admin.password);
  await page.goto(`/platform/tickets/${seed.ticketId}`);

  const aside = page.getByRole("complementary", { name: "处理和判定" });
  await expect(aside.getByRole("button", { name: "判定" })).toBeVisible();
  const card = aside.locator("section").filter({ has: page.getByRole("heading", { name: /^no-show 证据/ }) });
  await expect(card).toContainText("✓ 满足：免费等待开始前点了「已到达」");
  await expect(card).toContainText("✓ 满足：用车后 24 小时内提交");
  await expect(card).toContainText("距上车点 120 米");
  await expect(card).toContainText("来源：客人确认");
  await expect(card).toContainText("（提交时）");
  await expect(card).toContainText("打了 ****5678，王**已读不回");
  await expect(page.locator("body")).not.toContainText("王小明");
  await expect(page.locator("body")).not.toContainText("90-1234-5678");

  // 举牌照片真的画出来了（红色像素），内容安全策略没有拦（没有放宽 img-src），没有公开地址
  const photo = card.getByRole("img", { name: /^举牌照片/ });
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.evaluate((canvas: HTMLCanvasElement) => Array.from(canvas.getContext("2d")?.getImageData(0, 0, 1, 1).data ?? []))).toEqual([255, 0, 0, 255]);
  expect(violations).toEqual([]);
  const [download] = await Promise.all([page.waitForEvent("download"), card.getByRole("link", { name: "下载举牌照片原图" }).click()]);
  expect(download.url()).toMatch(/^blob:/);
  await expect.poll(() => auditCount(seed.orderId, seed.signboardId, admin.email)).toBeGreaterThan(0);

  // 截图点了才取
  expect(await auditCount(seed.orderId, seed.screenshotId, admin.email)).toBe(0);
  await card.getByRole("button", { name: "查看联系截图" }).click();
  await expect(card.getByRole("img", { name: /^联系截图/ })).toBeVisible();
  await expect.poll(() => auditCount(seed.orderId, seed.screenshotId, admin.email)).toBe(1);
  await expectAccessible(page, "工单详情（no-show 证据）");

  // 判定对话框里也看得到 5 项
  await aside.getByRole("button", { name: "判定" }).click();
  const dialog = page.getByRole("dialog", { name: "判定：no-show 审核" });
  await expect(dialog).toContainText("✓ 满足：在上车点举牌的照片");
  await dialog.getByRole("button", { name: "取消" }).click();

  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await expectNoHorizontalOverflow(page, `工单详情（no-show 证据，${width}px）`);
  }

  // 订单详情同样看得到
  await page.goto(`/platform/orders/${seed.orderId}`);
  await expect(page.getByRole("heading", { level: 1, name: `订单 ${seed.orderNo}` })).toBeVisible();
  const orderCard = page.locator("section").filter({ has: page.getByRole("heading", { name: /^no-show 证据/ }) });
  await expect(orderCard).toContainText("✓ 满足：免费等待内至少 3 次联系客人的记录");
  await expect(orderCard.getByRole("img", { name: /^举牌照片/ })).toBeVisible();
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await expectNoHorizontalOverflow(page, `订单详情（no-show 证据，${width}px）`);
  }

  // 只读员工：看得到证据，没有判定按钮
  const reader = await staff(request, "证据查看员", ["orders:view", "tickets:view"], { city_ids: null, channel_ids: null });
  const readerContext = await browser.newContext();
  const readerPage = await readerContext.newPage();
  await loginAs(readerPage, "platform", reader.email, reader.password);
  await readerPage.goto(`/platform/tickets/${seed.ticketId}`);
  await expect(readerPage.getByRole("complementary", { name: "处理和判定" })).toContainText("✓ 满足：免费等待开始前");
  await expect(readerPage.getByRole("button", { name: "判定" })).toHaveCount(0);
  await readerContext.close();

  // 供应商后台用同一个照片组件：照片同样显示得出来，看自己的照片不记平台审计
  const before = await auditCount(seed.orderId, seed.signboardId, seed.tenantEmail);
  const tenantContext = await browser.newContext();
  const tenantPage = await tenantContext.newPage();
  await loginAs(tenantPage, "tenant", seed.tenantEmail, seed.tenantPassword);
  await tenantPage.goto(`/orders/${seed.orderId}`);
  const tenantPhoto = tenantPage.getByRole("img", { name: /^举牌照片/ });
  await expect(tenantPhoto).toBeVisible();
  await expect.poll(() => tenantPhoto.evaluate((canvas: HTMLCanvasElement) => Array.from(canvas.getContext("2d")?.getImageData(0, 0, 1, 1).data ?? []))).toEqual([255, 0, 0, 255]);
  expect(await auditCount(seed.orderId, seed.signboardId, seed.tenantEmail)).toBe(before);
  await tenantContext.close();
});
