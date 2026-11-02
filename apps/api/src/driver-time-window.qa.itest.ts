/**
 * M4-32 测试角色：司机回传履约的时间窗口（ADR 0064），经真实接口、真实 PostgreSQL（本文件自己的 schema，结束即删）。
 * - 每一步的边界（正好、早 1 毫秒、晚 1 毫秒）都经接口；供应商先把单推进去、司机接着点太早的下一步；
 * - 太早时整个库什么都没写（逐表比对：订单、状态流水、定位、推送、通知、评分、审计、司机链接的使用时间）；
 * - 先判状态再判时间：重复点、过时页面、no-show 之后都是 409；已取消是链接失效；
 * - 并发：太早时同一步连点、两步同时点；窗口内同一步连点只成功一次；
 * - 时区（首尔、纽约）、跨午夜、带秒的用车时间；
 * - 接口：422 的 message、details 和 OpenAPI 一致，没有客人信息；`next_event` 每一步、完成后、no-show 后都对；
 * - 司机令牌只管自己这一单（别的租户、改派后的旧链接、请求里夹带时间都没用）；
 * - 其他入口不受误伤：供应商调度接口、平台代传（同一份窗口，正好 / 早 1 毫秒）、落地时间上报、no-show；
 * - ADR 0064 的只读查询：在只读事务里执行，找得到提前的、不误报边界和航班晚点的。
 * 订单由 testing/dispatch.ts 的 seedOrder 直接写入（都是虚构数据），先造好再按需要挪时钟。
 */
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, buildMarket, ok } from "./testing/market.ts";
import { platformLogin, tenantLogin } from "./testing/money.ts";
import { type FakeReceiver, type SeedOrderOptions, assign, newDriver, newVehicle, seedOrder, startFakeReceiver } from "./testing/dispatch.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const STEPS = ["departed", "arrived", "picked_up", "completed"] as const;
type Step = (typeof STEPS)[number];
const WINDOW: Record<Step, number> = { departed: 24, arrived: 24, picked_up: 3, completed: 3 };
const STATUS_AFTER: Record<Step, string> = { departed: "departed", arrived: "arrived", picked_up: "in_service", completed: "completed" };
const NEXT: Record<string, Step | null> = { assigned: "departed", departed: "arrived", arrived: "picked_up", in_service: "completed", completed: null };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);

let api: TestApi;
let m: Market;
let tenantToken: string;
let flow: SalesFlow;
let receiver: FakeReceiver;

before(async () => {
  const pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  flow = await salesFlow(api, m, pay);
  tenantToken = await tenantLogin(api, m.a.adminEmail);
  // 甲订阅状态变化的推送：太早时「没有推送」才测得出来（没订阅时本来就不写推送）
  receiver = await startFakeReceiver();
  const hook = await api.call("PUT", "/tenant/v1/webhooks", { token: tenantToken, body: { url: receiver.url, events: ["order.status_changed"] } });
  assert.equal(hook.status, 201, hook.text);
});
after(async () => {
  await api.close();
  await receiver.close();
});

const nowMs = (): number => api.clock.now().getTime();
const moveTo = (at: number): void => api.clock.advance(at - nowMs());
/** 现在之后 `hours` 小时、对齐整分钟的用车时间 */
const serviceIn = (hours: number): number => Math.ceil((nowMs() + hours * HOUR) / MINUTE) * MINUTE;
const earliestOf = (type: Step, serviceAt: number): number => serviceAt - WINDOW[type] * HOUR;
/** 东京当地时间 `YYYY-MM-DD HH:mm`（向上取整到分钟） */
const tokyoLocal = (ms: number): string => new Date(Math.ceil(ms / MINUTE) * MINUTE + 9 * HOUR).toISOString().slice(0, 16).replace("T", " ");

interface Dispatched {
  id: string;
  orderNo: string;
  token: string;
  serviceAt: number;
}

async function dispatched(serviceAt: number, options: Partial<SeedOrderOptions> = {}): Promise<Dispatched> {
  tenantToken = await tenantLogin(api, m.a.adminEmail);
  const who = { ...m.a, adminToken: tenantToken };
  const order = await seedOrder(api, m, "a", { ...options, serviceAt: new Date(serviceAt) });
  const res = await ok(assign(api, who, order.id, (await newDriver(api, who)).id, (await newVehicle(api, who, m.ids.biz7)).id));
  return { id: order.id, orderNo: order.orderNo, token: res.driver_link.token, serviceAt };
}

const event = (token: string, type: string, extra: Record<string, unknown> = {}) => api.call("POST", "/driver/v1/trip/events", { token, body: { type, ...extra } });
const trip = (token: string) => api.call("GET", "/driver/v1/trip", { token });
const tenantEvent = async (orderId: string, type: string) => {
  tenantToken = await tenantLogin(api, m.a.adminEmail);
  return api.call("POST", `/tenant/v1/orders/${orderId}/events`, { token: tenantToken, body: { type } });
};
const statusOf = async (orderId: string): Promise<string> => (await api.db.owner.query<{ status: string }>("select status from orders where id = $1", [orderId])).rows[0]?.status as string;

/** 整个测试 schema 每张表的行数和内容摘要：太早时要求一张表都没变。 */
async function snapshot(): Promise<Record<string, string>> {
  const tables = await api.db.owner.query<{ name: string }>("select table_name as name from information_schema.tables where table_schema = current_schema() and table_type = 'BASE TABLE' order by 1");
  const out: Record<string, string> = {};
  for (const { name } of tables.rows) {
    const row = await api.db.owner.query<{ n: number; h: string }>(`select count(*)::int as n, md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as h from "${name}" t`);
    out[name] = `${row.rows[0]?.n}:${row.rows[0]?.h}`;
  }
  return out;
}

function changedTables(before: Record<string, string>, after: Record<string, string>): string[] {
  return Object.keys({ ...before, ...after }).filter((name) => before[name] !== after[name]);
}

/** 422 的完整形状：和 OpenAPI 一致，details 只有这 5 项，没有客人信息。 */
function assertTooEarly(res: Awaited<ReturnType<typeof event>>, type: Step, serviceAt: number, timezone = "Asia/Tokyo", earliestLocal = tokyoLocal(earliestOf(type, serviceAt))): void {
  assertMatchesOpenApi("POST", "/driver/v1/trip/events", res);
  assert.equal(res.status, 422, res.text);
  assert.equal(res.body.error.code, "FULFILMENT_TOO_EARLY");
  assert.deepEqual(res.body.error.details, { type, earliest_at: new Date(earliestOf(type, serviceAt)).toISOString(), earliest_local: earliestLocal, timezone, hours_before_service: WINDOW[type] });
  assert.ok(res.body.error.message.includes(`${earliestLocal}（${timezone} 当地时间）`), res.body.error.message);
  assert.ok(res.body.error.message.includes(`用车前 ${WINDOW[type]} 小时`), res.body.error.message);
  for (const secret of ["王小明", "+819012345678", "guest@example.com", "NH211", "东京站"]) assert.ok(!res.text.includes(secret), `422 里不能有客人信息：${secret}`);
}

// ---- 边界（经接口） ----

for (const type of STEPS) {
  test(`边界「${type}」：早 1 毫秒 422 且整个库不变；正好那一刻 200；（前面的步骤由供应商提前推进）`, async () => {
    const serviceAt = serviceIn(72);
    const order = await dispatched(serviceAt);
    // 前面的步骤由供应商调度接口提前做完（供应商不受窗口影响），司机只点这一步
    for (const step of STEPS.slice(0, STEPS.indexOf(type))) await ok(tenantEvent(order.id, step));
    moveTo(earliestOf(type, serviceAt) - 1);
    const before = await snapshot();
    assertTooEarly(await event(order.token, type), type, serviceAt);
    assert.deepEqual(changedTables(before, await snapshot()), [], "太早时一张表都不能变");
    api.clock.advance(1);
    const done = await event(order.token, type, { location: { lng: 140.389, lat: 35.769 } });
    assert.equal(done.status, 200, done.text);
    assert.equal(done.body.order.status, STATUS_AFTER[type]);
    // 对照：同样的请求在窗口内会写这些表，上面的「一张表都没变」才有意义
    const written = changedTables(before, await snapshot());
    for (const table of ["orders", "order_events", "order_locations", "webhook_deliveries", "driver_links", ...(type === "arrived" ? ["tenant_performance_events", "notification_events"] : [])]) assert.ok(written.includes(table), `${type} 成功时应写 ${table}：${written.join(",")}`);
  });
}

test("边界：晚 1 毫秒也可以；航班晚 10 小时到达、用车后 22 小时才完成都可以", async () => {
  const serviceAt = serviceIn(30);
  const order = await dispatched(serviceAt);
  moveTo(earliestOf("departed", serviceAt) + 1);
  await ok(event(order.token, "departed"));
  moveTo(serviceAt + 10 * HOUR);
  await ok(event(order.token, "arrived"));
  await ok(event(order.token, "picked_up"));
  api.clock.advance(12 * HOUR);
  assert.equal((await ok(event(order.token, "completed"))).order.status, "completed");
});

test("太早时什么都不写：带定位点到达（会算距离、写定位、评分、通知）也一样；司机链接的最后使用时间也不变", async () => {
  const serviceAt = serviceIn(72);
  const order = await dispatched(serviceAt);
  await ok(tenantEvent(order.id, "departed"));
  const before = await snapshot();
  assertTooEarly(await event(order.token, "arrived", { location: { lng: 140.389, lat: 35.769, accuracy_m: 5 } }), "arrived", serviceAt);
  assertTooEarly(await event(order.token, "arrived", { location: { lng: 140.389, lat: 35.769 } }), "arrived", serviceAt);
  assert.deepEqual(changedTables(before, await snapshot()), []);
});

// ---- 先判状态再判时间 ----

test("先判状态：太早的时段里跳步、重复点都是 409 ORDER_STATE_INVALID，不是 422", async () => {
  const serviceAt = serviceIn(72);
  const order = await dispatched(serviceAt);
  for (const type of ["arrived", "picked_up", "completed"]) {
    const res = await event(order.token, type);
    assert.deepEqual([res.status, res.body.error.code], [409, "ORDER_STATE_INVALID"], type);
  }
  // 供应商已经推进到服务中：司机过时的页面再点出发、到达、接到客人是 409
  for (const step of ["departed", "arrived", "picked_up"] as const) await ok(tenantEvent(order.id, step));
  for (const type of ["departed", "arrived", "picked_up"]) {
    const res = await event(order.token, type);
    assert.deepEqual([res.status, res.body.error.code], [409, "ORDER_STATE_INVALID"], `过时页面 ${type}`);
  }
  // 下一步「完成」才是太早
  assertTooEarly(await event(order.token, "completed"), "completed", serviceAt);
});

test("已完成后再点任何一步都是 409；已取消的单链接失效（401，不给行程和客人信息）", async () => {
  const serviceAt = serviceIn(5);
  const order = await dispatched(serviceAt);
  moveTo(serviceAt);
  for (const type of STEPS) await ok(event(order.token, type));
  for (const type of STEPS) {
    const res = await event(order.token, type);
    assert.deepEqual([res.status, res.body.error.code], [409, "ORDER_STATE_INVALID"], type);
  }
  const far = await dispatched(serviceIn(72));
  await api.db.owner.query("update orders set status = 'cancelled', cancelled_at = $2, cancel_reason = 'GUEST_REQUEST' where id = $1", [far.id, api.clock.now()]);
  for (const res of [await event(far.token, "departed"), await trip(far.token)]) {
    assert.deepEqual([res.status, res.body.error.code], [401, "DRIVER_LINK_INVALID"]);
    assert.ok(!res.text.includes("王小明") && !res.text.includes("earliest"), res.text);
  }
});

// ---- 并发 ----

test("并发：太早时同一步连点 8 次全部 422，什么都没写", async () => {
  const serviceAt = serviceIn(72);
  const order = await dispatched(serviceAt);
  const before = await snapshot();
  const results = await Promise.all(Array.from({ length: 8 }, () => event(order.token, "departed")));
  assert.deepEqual(results.map((res) => res.status), Array(8).fill(422));
  assert.deepEqual(changedTables(before, await snapshot()), []);
});

test("并发：窗口内同一步连点 6 次只成功 1 次，只有 1 条流水、1 条推送；其余 409", async () => {
  const serviceAt = serviceIn(5);
  const order = await dispatched(serviceAt);
  const results = await Promise.all(Array.from({ length: 6 }, () => event(order.token, "departed")));
  assert.deepEqual(results.map((res) => res.status).sort(), [200, 409, 409, 409, 409, 409]);
  const events = await api.db.owner.query("select 1 from order_events where order_id = $1 and to_status = 'departed'", [order.id]);
  const pushes = await api.db.owner.query("select 1 from webhook_deliveries where order_id = $1 and event_type = 'order.status_changed' and event_data->>'to_status' = 'departed'", [order.id]);
  assert.deepEqual([events.rowCount, pushes.rowCount], [1, 1]);
});

test("并发：出发、到达可以但接到客人还太早时，四步同时点——最多到「已到达」，绝不会进服务中或完成", async () => {
  const serviceAt = serviceIn(10);
  const order = await dispatched(serviceAt);
  const results = await Promise.all(STEPS.map((type) => event(order.token, type)));
  const byType = Object.fromEntries(STEPS.map((type, i) => [type, results[i]!.status]));
  assert.equal(byType["departed"], 200);
  assert.ok([200, 409].includes(byType["arrived"]!), String(byType["arrived"]));
  assert.ok([409, 422].includes(byType["picked_up"]!), String(byType["picked_up"]));
  assert.equal(byType["completed"], 409);
  assert.ok(["departed", "arrived"].includes(await statusOf(order.id)));
  const rows = await api.db.owner.query<{ picked_up_at: Date | null; completed_at: Date | null }>("select picked_up_at, completed_at from orders where id = $1", [order.id]);
  assert.deepEqual(rows.rows[0], { picked_up_at: null, completed_at: null });
});

// ---- 时区、跨午夜、带秒 ----

test("首尔、纽约的单：details 和说明按这座城市的时区写最早时间", async () => {
  for (const [zone, expected] of [
    ["Asia/Seoul", (ms: number) => tokyoLocal(ms)],
    ["America/New_York", (ms: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(ms))],
  ] as const) {
    const serviceAt = serviceIn(72);
    const order = await dispatched(serviceAt);
    await api.db.owner.query("update orders set timezone = $2 where id = $1", [order.id, zone]);
    assertTooEarly(await event(order.token, "departed"), "departed", serviceAt, zone, expected(earliestOf("departed", serviceAt)));
    const page = await ok(trip(order.token));
    assert.equal(page.next_event.earliest_local, expected(earliestOf("departed", serviceAt)), zone);
  }
});

test("跨午夜：东京 01:00 的单，接到客人最早是前一天 22:00；21:59:59.999 还不行", async () => {
  const base = serviceIn(72);
  const tokyoMidnight = Math.ceil((base + 9 * HOUR) / (24 * HOUR)) * 24 * HOUR - 9 * HOUR;
  const serviceAt = tokyoMidnight + HOUR;
  const order = await dispatched(serviceAt);
  await ok(tenantEvent(order.id, "departed"));
  await ok(tenantEvent(order.id, "arrived"));
  moveTo(serviceAt - 3 * HOUR - 1);
  const res = await event(order.token, "picked_up");
  assertTooEarly(res, "picked_up", serviceAt);
  assert.equal(res.body.error.details.earliest_local.slice(11), "22:00");
  assert.notEqual(res.body.error.details.earliest_local.slice(0, 10), tokyoLocal(serviceAt).slice(0, 10), "最早时间在前一天");
  api.clock.advance(1);
  await ok(event(order.token, "picked_up"));
});

test("用车时间带秒：earliest_local 进到下一分钟、earliest_at 是精确时刻；精确时刻起就能点", async () => {
  const serviceAt = serviceIn(72) + 30_000;
  const order = await dispatched(serviceAt);
  const res = await event(order.token, "departed");
  assertTooEarly(res, "departed", serviceAt);
  assert.ok(res.body.error.details.earliest_local.endsWith(tokyoLocal(earliestOf("departed", serviceAt) + 30_000).slice(11)));
  const page = await ok(trip(order.token));
  assert.equal(page.next_event.earliest_at, new Date(earliestOf("departed", serviceAt)).toISOString());
  moveTo(earliestOf("departed", serviceAt));
  await ok(event(order.token, "departed"));
});

// ---- next_event ----

test("next_event：每一步都对、只有 type / earliest_at / earliest_local 三项；完成后为 null；事件应答和 GET 一致", async () => {
  const serviceAt = serviceIn(30);
  const order = await dispatched(serviceAt);
  moveTo(serviceAt);
  let status = "assigned";
  for (const type of [...STEPS, null]) {
    const page = await trip(order.token);
    assertMatchesOpenApi("GET", "/driver/v1/trip", page);
    assert.equal(page.body.order.status, status);
    const expected = NEXT[status];
    assert.equal(type, expected);
    if (expected === null) {
      assert.equal(page.body.next_event, null);
      break;
    }
    assert.deepEqual(page.body.next_event, { type: expected, earliest_at: new Date(earliestOf(expected, serviceAt)).toISOString(), earliest_local: tokyoLocal(earliestOf(expected, serviceAt)) });
    const res = await ok(event(order.token, expected));
    status = res.order.status;
    const after = await ok(trip(order.token));
    assert.deepEqual(res.next_event, after.next_event, `${expected} 之后应答和 GET 一致`);
  }
});

test("next_event：no-show 提交后为 null；到达可以比用车早 20 小时、不影响 no-show 的第 1 项", async () => {
  const serviceAt = serviceIn(30);
  const order = await dispatched(serviceAt, { freeWaitMinutes: 30 });
  moveTo(serviceAt - 20 * HOUR);
  await ok(event(order.token, "departed"));
  const arrived = await ok(event(order.token, "arrived", { location: { lng: 140.389, lat: 35.769, accuracy_m: 10 } }));
  assert.equal(arrived.next_event.type, "picked_up");
  assert.equal(arrived.no_show.checklist.find((entry: any) => entry.item === "arrived_on_time_nearby").ok, true, "提前很久到达也算按时到达");
  const tooSoon = await api.call("POST", "/driver/v1/trip/request-leave", { token: order.token, body: {} });
  assert.deepEqual([tooSoon.status, tooSoon.body.error.code], [409, "FREE_WAIT_NOT_ENDED"], "免费等待照旧从用车时间起算");
  const upload = (kind: string) => api.app.inject({ method: "POST", url: `/driver/v1/trip/files?kind=${kind}`, headers: { authorization: `Bearer ${order.token}`, "content-type": "image/jpeg" }, payload: JPEG });
  moveTo(serviceAt + 5 * MINUTE);
  assert.equal((await upload("signboard")).statusCode, 201);
  for (let i = 0; i < 3; i += 1) {
    await ok(api.call("POST", "/driver/v1/trip/contacts", { token: order.token, body: { method: "phone" } }));
    api.clock.advance(8 * MINUTE);
  }
  moveTo(serviceAt + 31 * MINUTE);
  await ok(api.call("POST", "/driver/v1/trip/request-leave", { token: order.token, body: { location: { lng: 140.389, lat: 35.769 } } }));
  api.clock.advance(15 * MINUTE);
  const submitted = await api.call("POST", "/driver/v1/trip/no-show", { token: order.token, body: { location: { lng: 140.389, lat: 35.769 } } });
  assert.equal(submitted.status, 200, submitted.text);
  assert.equal(submitted.body.order.status, "no_show_claimed");
  assert.equal(submitted.body.next_event, null);
  const res = await event(order.token, "picked_up");
  assert.deepEqual([res.status, res.body.error.code], [409, "ORDER_STATE_INVALID"]);
});

// ---- 令牌只管自己这一单 ----

test("司机令牌只管自己这一单：同一个司机两张单互不影响；别的租户编号的令牌、改派后的旧令牌都 401；请求里夹带时间没用", async () => {
  const soon = serviceIn(5);
  const later = serviceIn(72);
  tenantToken = await tenantLogin(api, m.a.adminEmail);
  const who = { ...m.a, adminToken: tenantToken };
  const driver = await newDriver(api, who);
  const vehicle = await newVehicle(api, who, m.ids.biz7);
  const near = await seedOrder(api, m, "a", { serviceAt: new Date(soon) });
  const far = await seedOrder(api, m, "a", { serviceAt: new Date(later) });
  const nearToken = (await ok(assign(api, who, near.id, driver.id, vehicle.id))).driver_link.token;
  const farToken = (await ok(assign(api, who, far.id, driver.id, vehicle.id, { confirmConflicts: true }))).driver_link.token;
  await ok(event(nearToken, "departed"));
  assert.equal(await statusOf(far.id), "assigned", "近的单出发不影响远的单");
  assertTooEarly(await event(farToken, "departed"), "departed", later);
  // 夹带「发生时间」「订单」也没用：时间用系统收到的时间
  const spoof = await event(farToken, "departed", { occurred_at: new Date(later).toISOString(), order_id: near.id });
  assert.notEqual(spoof.status, 200, spoof.text);
  assert.equal(await statusOf(far.id), "assigned");
  assert.equal(await statusOf(near.id), "departed");
  // 换成乙的租户编号
  const forged = `nzd_${m.b.tenantId.replaceAll("-", "")}.${farToken.split(".")[1]}`;
  assert.deepEqual([(await event(forged, "departed")).status, (await trip(forged)).status], [401, 401]);
  const fresh = `nzd_${m.b.tenantId.replaceAll("-", "")}.${randomBytes(32).toString("base64url")}`;
  assert.equal((await trip(fresh)).status, 401);
  // 改派后的旧令牌
  const other = await newDriver(api, who);
  const version = (await ok(api.call("GET", `/tenant/v1/orders/${far.id}`, { token: tenantToken }))).order.version;
  await ok(assign(api, who, far.id, other.id, vehicle.id, { version, confirmConflicts: true }));
  const stale = await event(farToken, "departed");
  assert.deepEqual([stale.status, stale.body.error.code], [401, "DRIVER_LINK_INVALID"]);
});

// ---- 其他入口不受误伤 ----

test("供应商调度接口：用车前三天四步都能回传，应答没有窗口的字段（ADR 0064「范围」不拦）", async () => {
  const order = await dispatched(serviceIn(72));
  for (const type of STEPS) {
    const res = await tenantEvent(order.id, type);
    assert.equal(res.status, 200, `${type} ${res.text}`);
    assert.ok(!res.text.includes("next_event") && !res.text.includes("FULFILMENT_TOO_EARLY"));
  }
  assert.equal(await statusOf(order.id), "completed");
});

test("平台代传：出发正好用车前 24 小时可以、早 1 毫秒 400 TOO_EARLY（和 ADR 0052 一样，不是司机的 422）", async () => {
  // 代传只认销售渠道的单：经销售接口下单付款（乙中标），再把用车时间挪到 30 小时后
  const orderId = (await flow.paidOrder({ serviceTime: new Date(serviceIn(72)).toISOString().replace(/\.\d{3}Z$/, "Z") })).id as string;
  const serviceAt = serviceIn(30);
  await api.db.owner.query("update orders set service_at = $2 where id = $1", [orderId, new Date(serviceAt)]);
  const bToken = await tenantLogin(api, m.b.adminEmail);
  const who = { ...m.b, adminToken: bToken };
  await ok(assign(api, who, orderId, (await newDriver(api, who)).id, (await newVehicle(api, who, m.ids.biz7)).id));
  moveTo(serviceAt - 23 * HOUR);
  const ops = await platformLogin(api, m.staff.operations.email);
  const version = async () => (await ok(api.call("GET", `/platform/v1/orders/${orderId}`, { token: ops }))).order.version;
  const proxy = async (occurredAt: number) => api.call("POST", `/platform/v1/orders/${orderId}/events`, { token: ops, headers: { "if-match": String(await version()) }, body: { type: "departed", occurred_at: new Date(occurredAt).toISOString(), reason: "虚构原因：供应商调度系统故障，电话确认" } });
  const early = await proxy(earliestOf("departed", serviceAt) - 1);
  assert.equal(early.status, 400, early.text);
  assert.equal(early.body.error.code, "VALIDATION_FAILED");
  assert.equal(early.body.error.details.issues[0].reason, "TOO_EARLY");
  const edge = await proxy(earliestOf("departed", serviceAt));
  assert.equal(edge.status, 200, edge.text);
  assert.equal(await statusOf(orderId), "departed");
});

test("落地时间上报不受窗口影响：已派车、还没出发时就能报（计划前 2 小时落地），之后接到客人按用车时间的窗口", async () => {
  const serviceAt = serviceIn(30);
  const order = await dispatched(serviceAt);
  moveTo(serviceAt - 2 * HOUR + 10 * MINUTE);
  const screen = await api.app.inject({ method: "POST", url: "/driver/v1/trip/files?kind=arrival_screen", headers: { authorization: `Bearer ${order.token}`, "content-type": "image/jpeg" }, payload: JPEG });
  assert.equal(screen.statusCode, 201, screen.body);
  const landed = await api.call("POST", "/driver/v1/trip/landing", { token: order.token, body: { landed_at: new Date(serviceAt - 2 * HOUR).toISOString(), file_id: JSON.parse(screen.body).file.id } });
  assert.equal(landed.status, 200, landed.text);
  assert.equal(landed.body.order.status, "assigned");
  assert.equal(landed.body.next_event.type, "departed");
  for (const type of STEPS) await ok(event(order.token, type));
});

// ---- ADR 0064 的只读查询 ----

test("ADR 0064 的查询：在只读事务里能执行；找得到供应商提前点的，不误报正好在边界的、航班晚点的、司机正常点的、没履约的", async () => {
  const adr = await readFile(new URL("../../../docs/adr/0064-driver-fulfilment-time-window.md", import.meta.url), "utf8");
  const sql = /```sql\n([\s\S]*?)```/.exec(adr)?.[1];
  assert.ok(sql !== undefined);

  // 供应商提前 3 天点完（真问题）；只有「到达」提前（出发正常）的也要找得到
  const early = await dispatched(serviceIn(72));
  for (const type of STEPS) await ok(tenantEvent(early.id, type));
  const onlyPickupEarly = await dispatched(serviceIn(10));
  for (const type of STEPS) await ok(tenantEvent(onlyPickupEarly.id, type));
  // 正好在边界（司机点的）
  const edgeAt = serviceIn(30);
  const edge = await dispatched(edgeAt);
  const late = await dispatched(serviceIn(29));
  const untouched = await dispatched(serviceIn(50));
  moveTo(earliestOf("departed", edgeAt));
  await ok(event(edge.token, "departed"));
  await ok(event(edge.token, "arrived"));
  moveTo(earliestOf("picked_up", edgeAt));
  await ok(event(edge.token, "picked_up"));
  await ok(event(edge.token, "completed"));
  // 航班晚点：用车后 9 小时才完成
  await ok(event(late.token, "departed"));
  moveTo(Date.parse((await ok(trip(late.token))).order.service_time) + 9 * HOUR);
  for (const type of ["arrived", "picked_up", "completed"]) await ok(event(late.token, type));

  const client = await api.db.owner.connect();
  let numbers: string[];
  try {
    await client.query("begin read only");
    numbers = (await client.query<{ order_no: string }>(sql)).rows.map((row) => row.order_no);
    await client.query("rollback");
  } finally {
    client.release();
  }
  assert.ok(numbers.includes(early.orderNo), "提前 3 天完成的找得到");
  assert.ok(numbers.includes(onlyPickupEarly.orderNo), "用车前 10 小时接到、完成的找得到");
  for (const [label, order] of [["正好在边界", edge], ["航班晚点", late], ["没履约", untouched]] as const) assert.ok(!numbers.includes(order.orderNo), `${label}的不该被找出来`);
});
