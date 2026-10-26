/**
 * M3-02：司机 H5（ADR 0027），经真实接口、真实 PostgreSQL。
 * - 司机凭链接看这一单：有乘客、航班、上下车点、调度电话，**没有任何价格**；
 * - 链接：格式不对、不存在、被吊销（改派 / 重新生成 / 手动）、过期（用车结束后 24 小时）、把令牌里的租户换掉，一律 401，且应答完全一样；
 *   一个链接只对应一张单（拿着这一单的令牌碰不到别的单）；
 * - 履约回传、定时定位；照片上传（格式按字节判断、大小限制、类型不一致）；
 * - 落地时间：只有接机、必须附到达屏、不能改、时间要合理；按规则取定的结果写入订单；
 * - no-show：联系记录、申请离开（免等结束后、只一次）、5 项证据不齐不能提交、齐了提交后订单变成「客人未出现（待审核）」。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, buildMarket, ok } from "./testing/market.ts";
import { NARITA, assign, newDriver, newVehicle, seedOrder } from "./testing/dispatch.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";

let api: TestApi;
let m: Market;

before(async () => {
  api = await createTestApi();
  m = await buildMarket(api);
});
after(() => api.close());

const MINUTE = 60_000;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 1)]);

/** 一张已派车的接机单：用车（计划落地）在现在之后 `minutesAhead` 分钟。返回订单和司机令牌。 */
async function dispatched(minutesAhead: number, extra: Parameters<typeof seedOrder>[3] extends infer T ? Partial<T> : never = {}): Promise<{ order: Awaited<ReturnType<typeof seedOrder>>; token: string; tenantToken: string }> {
  const tenantToken = (await ok(api.call("POST", "/tenant/v1/auth/login", { body: { email: m.a.adminEmail, password: "Quiet-Harbor-2026" } }))).access_token;
  const who = { ...m.a, adminToken: tenantToken };
  const order = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + minutesAhead * MINUTE), ...extra });
  const res = await ok(assign(api, who, order.id, (await newDriver(api, who)).id, (await newVehicle(api, who, m.ids.biz7)).id));
  return { order, token: res.driver_link.token, tenantToken };
}

const driver = (method: "GET" | "POST", path: string, token: string | undefined, body?: unknown) => api.call(method, `/driver/v1/trip${path}`, { ...(token === undefined ? {} : { token }), ...(body === undefined ? {} : { body }) });

async function upload(token: string, kind: string, data: Buffer, contentType = "image/jpeg"): Promise<{ status: number; body: any; text: string }> {
  const res = await api.app.inject({ method: "POST", url: `/driver/v1/trip/files?kind=${kind}`, headers: { authorization: `Bearer ${token}`, "content-type": contentType }, payload: data });
  let body: unknown = null;
  try {
    body = res.json();
  } catch {
    body = null;
  }
  return { status: res.statusCode, body, text: res.body };
}

test("司机看这一单：乘客、电话、航班、上下车点（机场坐标供导航）、调度电话、免费等待、5 项证据的核对；没有任何价格", async () => {
  const { token } = await dispatched(180);
  const res = await driver("GET", "", token);
  assert.equal(res.status, 200, res.text);
  assertMatchesOpenApi("GET", "/driver/v1/trip", res);
  assert.deepEqual([res.body.order.passenger, res.body.order.flight_no, res.body.order.status], [{ name: "王小明", phone: "+819012345678" }, "NH211", "assigned"]);
  assert.deepEqual(res.body.order.pickup_point, NARITA);
  assert.equal(res.body.order.place.code, "NRT");
  assert.deepEqual(res.body.dispatchers, [{ name: "调度", phone: "0312345678" }]);
  assert.equal(res.body.no_show.checklist.length, 5);
  assert.equal(res.body.order.passenger.email, undefined, "司机不需要客人的邮箱");
  assert.doesNotMatch(res.text, /settlement|sell|markup|price|amount|"20000"|对外价|加价|结算/i);
  assert.equal(res.headers["cache-control"], "no-store");
});

test("链接无效：没带、格式不对、不存在、把租户换成别人的、吊销、过期，一律 401 且应答一模一样", async () => {
  const { order, token, tenantToken } = await dispatched(120);
  const [prefix, random] = token.split(".") as [string, string];
  const otherTenant = `nzd_${m.b.tenantId.replaceAll("-", "")}.${random}`;
  const unknown = `${prefix}.${"A".repeat(43)}`;
  const responses = [await driver("GET", "", undefined), await driver("GET", "", "garbage"), await driver("GET", "", unknown), await driver("GET", "", otherTenant)];
  for (const res of responses) {
    assertMatchesOpenApi("GET", "/driver/v1/trip", res);
    assert.equal(res.status, 401);
  }
  assert.equal(new Set(responses.map((res) => res.text)).size, 1);
  assert.equal(responses[0]?.body.error.code, "DRIVER_LINK_INVALID");
  await api.call("DELETE", `/tenant/v1/orders/${order.id}/driver-link`, { token: tenantToken });
  const revoked = await driver("GET", "", token);
  assert.deepEqual([revoked.status, revoked.text], [401, responses[0]?.text]);
  const second = await dispatched(60);
  assert.equal((await driver("GET", "", second.token)).status, 200);
  api.clock.advance(60 * MINUTE + 24 * 60 * MINUTE);
  const expired = await driver("GET", "", second.token);
  assert.deepEqual([expired.status, expired.text], [401, responses[0]?.text], "用车后 24 小时失效");
});

test("一个链接只对应一张单：两张单两个令牌，各自只看得到、只改得到自己那一单", async () => {
  const one = await dispatched(240);
  const two = await dispatched(300);
  assert.equal((await driver("GET", "", one.token)).body.order.order_no, one.order.orderNo);
  assert.equal((await driver("GET", "", two.token)).body.order.order_no, two.order.orderNo);
  await ok(driver("POST", "/events", one.token, { type: "departed" }));
  const statuses = await api.db.owner.query<{ id: string; status: string }>("select id, status from orders where id = any($1::uuid[])", [[one.order.id, two.order.id]]);
  assert.deepEqual(Object.fromEntries(statuses.rows.map((row) => [row.id, row.status])), { [one.order.id]: "departed", [two.order.id]: "assigned" });
});

test("履约回传：出发（带定位）→ 定时定位 → 到达（算出距机场的距离）→ 接到客人 → 完成；跳步 409；结束后不能再传照片、不能再报定位", async () => {
  const { order, token } = await dispatched(90);
  assert.equal((await driver("POST", "/locations", token, { location: { lng: 140, lat: 35.7 } })).status, 409, "还没出发");
  const departed = await driver("POST", "/events", token, { type: "departed", location: { lng: 139.7671, lat: 35.6812, accuracy_m: 15 } });
  assertMatchesOpenApi("POST", "/driver/v1/trip/events", departed);
  assert.equal(departed.body.order.status, "departed");
  assert.equal((await driver("POST", "/locations", token, { location: { lng: 140.1, lat: 35.72, accuracy_m: 30 } })).status, 204);
  assert.equal((await driver("POST", "/events", token, { type: "picked_up" })).status, 409);
  const arrived = await ok(driver("POST", "/events", token, { type: "arrived", location: { lng: 140.3887, lat: 35.7713 } }));
  assert.ok(arrived.fulfilment.arrival_distance_m >= 290 && arrived.fulfilment.arrival_distance_m <= 310, String(arrived.fulfilment.arrival_distance_m));
  await ok(driver("POST", "/events", token, { type: "picked_up" }));
  await ok(driver("POST", "/events", token, { type: "completed" }));
  assert.equal((await upload(token, "signboard", JPEG)).status, 409);
  const kinds = await api.db.owner.query<{ kind: string; actor: string }>("select l.kind from order_locations l where l.order_id = $1 order by l.seq", [order.id]);
  assert.deepEqual(kinds.rows.map((row) => row.kind), ["departed", "ping", "arrived"]);
  const events = await api.db.owner.query<{ actor: string }>("select actor from order_events where order_id = $1 and actor = 'driver'", [order.id]);
  assert.equal(events.rowCount, 4);
});

test("照片：JPEG / PNG 按字节判断格式；伪装成图片的内容、声明的类型对不上、空文件、超过 5 MB 都拒绝；上传的能看回原样", async () => {
  const { token, order, tenantToken } = await dispatched(100);
  const jpeg = await upload(token, "arrival_screen", JPEG);
  assert.equal(jpeg.status, 201, jpeg.text);
  assertMatchesOpenApi("POST", "/driver/v1/trip/files", jpeg as never);
  assert.deepEqual([jpeg.body.file.kind, jpeg.body.file.content_type, jpeg.body.file.byte_size], ["arrival_screen", "image/jpeg", JPEG.length]);
  assert.equal((await upload(token, "signboard", PNG, "image/png")).status, 201);
  const svg = await upload(token, "signboard", Buffer.from("<svg onload=alert(1)>"), "image/png");
  assert.deepEqual([svg.status, svg.body.error.code], [415, "UNSUPPORTED_MEDIA_TYPE"]);
  assert.equal((await upload(token, "signboard", PNG, "image/jpeg")).status, 415, "声明的类型和内容不一致");
  assert.equal((await upload(token, "signboard", Buffer.alloc(0))).status, 400);
  assert.equal((await upload(token, "receipt", JPEG)).status, 400, "不认识的种类");
  const big = await upload(token, "signboard", Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)]));
  assert.equal(big.status, 413);
  assert.equal((await upload("nzd_garbage", "signboard", JPEG)).status, 401);
  const back = await api.app.inject({ method: "GET", url: `/driver/v1/trip/files/${jpeg.body.file.id}`, headers: { authorization: `Bearer ${token}` } });
  assert.deepEqual([back.statusCode, back.headers["content-type"], back.headers["x-content-type-options"], Buffer.compare(back.rawPayload, JPEG)], [200, "image/jpeg", "nosniff", 0]);
  const tenantView = await api.app.inject({ method: "GET", url: `/tenant/v1/orders/${order.id}/files/${jpeg.body.file.id}`, headers: { authorization: `Bearer ${tenantToken}` } });
  assert.deepEqual([tenantView.statusCode, Buffer.compare(tenantView.rawPayload, JPEG)], [200, 0], "供应商后台看得到");
  assert.ok(String(tenantView.headers["content-security-policy"]).includes("sandbox"));
  const stored = await api.db.owner.query<{ n: number }>("select count(*)::int as n from order_files where order_id = $1", [order.id]);
  assert.equal(stored.rows[0]?.n, 2);
});

test("落地时间：要先拍到达屏；时间不能晚于现在、不能比计划早 3 小时以上；提交后不能改；结果按规则写入订单（只有司机的 → 取司机的）", async () => {
  const { token, order, tenantToken } = await dispatched(30);
  const noPhoto = await driver("POST", "/landing", token, { landed_at: new Date(api.clock.now().getTime()).toISOString(), file_id: "99999999-9999-4999-8999-999999999999" });
  assert.deepEqual([noPhoto.status, noPhoto.body.error.details.issues[0].reason], [400, "ARRIVAL_SCREEN_REQUIRED"]);
  const signboard = await upload(token, "signboard", JPEG);
  assert.equal((await driver("POST", "/landing", token, { landed_at: api.clock.now().toISOString(), file_id: signboard.body.file.id })).status, 400, "举牌照片不能当到达屏");
  const screen = await upload(token, "arrival_screen", JPEG);
  api.clock.advance(70 * MINUTE);
  const future = await driver("POST", "/landing", token, { landed_at: new Date(api.clock.now().getTime() + 10 * MINUTE).toISOString(), file_id: screen.body.file.id });
  assert.equal(future.body.error.details.issues[0].reason, "IN_FUTURE");
  const early = await driver("POST", "/landing", token, { landed_at: new Date(api.clock.now().getTime() - 5 * 60 * MINUTE).toISOString(), file_id: screen.body.file.id });
  assert.equal(early.body.error.details.issues[0].reason, "TOO_EARLY");
  const landedAt = new Date(api.clock.now().getTime() - 20 * MINUTE);
  const res = await driver("POST", "/landing", token, { landed_at: landedAt.toISOString(), file_id: screen.body.file.id });
  assertMatchesOpenApi("POST", "/driver/v1/trip/landing", res);
  assert.deepEqual([res.body.landing.source, res.body.landing.landed_at, res.body.landing.delay_minutes], ["driver", landedAt.toISOString(), 20]);
  assert.equal(res.body.free_wait.start, landedAt.toISOString(), "接机的免费等待从实际落地时间起算");
  const again = await driver("POST", "/landing", token, { landed_at: api.clock.now().toISOString(), file_id: screen.body.file.id });
  assert.deepEqual([again.status, again.body.error.code], [409, "LANDING_ALREADY_REPORTED"]);
  const row = await api.db.owner.query<{ landed_at: Date; landed_source: string }>("select landed_at, landed_source from orders where id = $1", [order.id]);
  assert.deepEqual([row.rows[0]?.landed_at.toISOString(), row.rows[0]?.landed_source], [landedAt.toISOString(), "driver"]);
  const tenant = await ok(api.call("GET", `/tenant/v1/orders/${order.id}`, { token: tenantToken }));
  assert.equal(tenant.order.landing.source, "driver");
});

test("落地时间只用于接机：送机单 409 LANDING_NOT_APPLICABLE", async () => {
  const { token } = await dispatched(120, { direction: "dropoff" });
  const screen = await upload(token, "arrival_screen", JPEG);
  const res = await driver("POST", "/landing", token, { landed_at: api.clock.now().toISOString(), file_id: screen.body.file.id });
  assert.deepEqual([res.status, res.body.error.code], [409, "LANDING_NOT_APPLICABLE"]);
  assert.equal((await driver("GET", "", token)).body.landing, null);
});

test("no-show：免等结束前不能申请离开；证据不齐不能提交（逐项列出）；5 项齐了提交，订单变成客人未出现（待审核），之后不能再操作", async () => {
  const { token, order, tenantToken } = await dispatched(20, { freeWaitMinutes: 60 });
  await ok(driver("POST", "/events", token, { type: "departed" }));
  await ok(driver("POST", "/events", token, { type: "arrived", location: { lng: 140.3890, lat: 35.7690, accuracy_m: 10 } }));
  const tooSoon = await driver("POST", "/request-leave", token, {});
  assert.deepEqual([tooSoon.status, tooSoon.body.error.code], [409, "FREE_WAIT_NOT_ENDED"]);
  const photo = await upload(token, "signboard", JPEG);
  assert.equal(photo.status, 201);
  api.clock.advance(25 * MINUTE);
  const shot = await upload(token, "contact_screenshot", PNG, "image/png");
  await ok(driver("POST", "/contacts", token, { method: "phone" }));
  api.clock.advance(10 * MINUTE);
  const contact = await driver("POST", "/contacts", token, { method: "messaging", note: "LINE 已读不回", file_id: shot.body.file.id });
  assertMatchesOpenApi("POST", "/driver/v1/trip/contacts", contact);
  const incomplete = await driver("POST", "/no-show", token, {});
  assertMatchesOpenApi("POST", "/driver/v1/trip/no-show", incomplete);
  assert.deepEqual([incomplete.status, incomplete.body.error.code, incomplete.body.error.details.missing], [422, "NO_SHOW_EVIDENCE_INCOMPLETE", ["contact_attempts", "leave_consented"]]);
  api.clock.advance(10 * MINUTE);
  await ok(driver("POST", "/contacts", token, { method: "phone" }));
  api.clock.advance(40 * MINUTE);
  const leave = await driver("POST", "/request-leave", token, { location: { lng: 140.3890, lat: 35.7690 } });
  assertMatchesOpenApi("POST", "/driver/v1/trip/request-leave", leave);
  assert.equal(leave.status, 200, leave.text);
  assert.equal((await driver("POST", "/request-leave", token, {})).body.error.code, "LEAVE_ALREADY_REQUESTED");
  assert.deepEqual((await driver("POST", "/no-show", token, {})).body.error.details.missing, ["leave_consented"], "客服还有 10 分钟");
  api.clock.advance(10 * MINUTE);
  const submitted = await driver("POST", "/no-show", token, { location: { lng: 140.389, lat: 35.769 } });
  assert.equal(submitted.status, 200, submitted.text);
  assert.equal(submitted.body.order.status, "no_show_claimed");
  assert.ok(submitted.body.no_show.submitted_at);
  assert.equal((await driver("POST", "/contacts", token, { method: "phone" })).status, 409);
  assert.equal((await driver("POST", "/events", token, { type: "picked_up" })).status, 409, "提交 no-show 后不能再接到客人");
  const detail = await ok(api.call("GET", `/tenant/v1/orders/${order.id}`, { token: tenantToken }));
  assert.equal(detail.order.status, "no_show_claimed");
  assert.equal(detail.records.no_show_claim.status, "pending_review");
  assert.ok(detail.records.no_show_claim.checklist.every((entry: any) => entry.ok));
  assert.equal(detail.records.contacts.length, 3);
});

test("no-show：到达时离上车点超过 300 米，或者在免等开始之后才到达，第 1 项不满足", async () => {
  const { token } = await dispatched(10, { freeWaitMinutes: 15 });
  await ok(driver("POST", "/events", token, { type: "departed" }));
  api.clock.advance(15 * MINUTE);
  const arrived = await ok(driver("POST", "/events", token, { type: "arrived", location: { lng: 140.40, lat: 35.78 } }));
  assert.equal(arrived.no_show.checklist.find((entry: any) => entry.item === "arrived_on_time_nearby").ok, false);
});
