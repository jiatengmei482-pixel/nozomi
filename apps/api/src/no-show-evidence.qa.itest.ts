/**
 * M4-20 测试角色：证据访问、打码范围、准时到达基准的边界（ADR 0054、ADR 0052「评分」）。no-show-evidence.itest.ts 已测的不重复。
 * 真实接口、真实 PostgreSQL；收款服务用替身；数据都在测试里构造。
 */
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { assign, newDriver, newVehicle } from "./testing/dispatch.ts";
import { type Market, buildMarket, newChannel, ok } from "./testing/market.ts";
import { platformLogin, tenantLogin } from "./testing/money.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const NARITA_NEARBY = { lng: 140.389, lat: 35.769 };

let api: TestApi;
let m: Market;
let flow: SalesFlow;

before(async () => {
  const pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  flow = await salesFlow(api, m, pay);
});
after(() => api.close());

const ops = (): Promise<string> => platformLogin(api, m.staff.operations.email);
const soon = (hours: number): string => new Date(api.clock.now().getTime() + hours * HOUR).toISOString().replace(/\.\d{3}Z$/, "Z");
const at = (minutes: number): Date => new Date(api.clock.now().getTime() + minutes * MINUTE);

interface Dispatched {
  orderId: string;
  tenantToken: string;
  driverToken: string;
}

/** 接机单，已派车。默认乙车队（商务 7 座乙便宜）；经济 4 座只有甲有，甲中标。 */
async function dispatched(minutesFromNow: number, tenant: "a" | "b" = "b"): Promise<Dispatched> {
  const vehicleGroupId = tenant === "a" ? m.ids.eco4 : m.ids.biz7;
  const orderId = (await flow.paidOrder({ serviceTime: soon(72), vehicleGroupId })).id as string;
  await api.db.owner.query("update orders set service_at = $2 where id = $1", [orderId, at(minutesFromNow)]);
  const tenantToken = await tenantLogin(api, m[tenant].adminEmail);
  const who = { ...m[tenant], adminToken: tenantToken };
  const result = await ok(assign(api, who, orderId, (await newDriver(api, who)).id, (await newVehicle(api, who, vehicleGroupId)).id));
  return { orderId, tenantToken, driverToken: result.driver_link.token };
}

const driver = (token: string, path: string, body: unknown = {}) => api.call("POST", `/driver/v1/trip${path}`, { token, body });
const rawUpload = (token: string, kind: string, contentType: string, payload: Buffer) => api.app.inject({ method: "POST", url: `/driver/v1/trip/files?kind=${kind}`, headers: { authorization: `Bearer ${token}`, "content-type": contentType }, payload });

async function upload(token: string, kind: string): Promise<string> {
  const res = await rawUpload(token, kind, "image/jpeg", JPEG);
  assert.equal(res.statusCode, 201, res.body);
  return res.json().file.id as string;
}

const reportLanding = async (token: string, landedAt: Date) => driver(token, "/landing", { landed_at: landedAt.toISOString(), file_id: await upload(token, "arrival_screen") });
const arrivalEvents = async (orderId: string): Promise<boolean[]> => (await api.db.owner.query("select on_time from tenant_performance_events where order_id = $1 and kind = 'arrival'", [orderId])).rows.map((row) => row.on_time);
const audits = async (orderId: string): Promise<number> => (await api.db.owner.query("select 1 from audit_logs where resource = 'order' and resource_id = $1 and action = 'view_evidence_file'", [orderId])).rowCount ?? 0;
const getFile = (scope: "platform" | "tenant", orderId: string, fileId: string, token: string) => api.app.inject({ method: "GET", url: `/${scope}/v1/orders/${orderId}/files/${fileId}`, headers: { authorization: `Bearer ${token}` } });
const fileCount = async (orderId: string): Promise<number> => (await api.db.owner.query("select 1 from order_files where order_id = $1", [orderId])).rowCount ?? 0;

async function staffWithRole(name: string, grants: string[], scope: { city_ids: string[] | null; channel_ids: string[] | null }): Promise<string> {
  const root = await platformLogin(api, "root@platform.test");
  const role = await ok(api.call("POST", "/platform/v1/roles", { token: root, body: { name: `${name}-${randomUUID().slice(0, 4)}`, grants, data_scope: scope } }), 201);
  const email = `evidence-qa-${randomUUID().slice(0, 8)}@platform.test`;
  const invited = await ok(api.call("POST", "/platform/v1/staff", { token: root, body: { email, name, role: role.key } }), 201);
  await ok(api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
  return platformLogin(api, email);
}

/** 司机走真实接口攒齐 5 项并提交 no-show。备注由用例给。 */
async function claimed(note: string): Promise<Dispatched & { signboard: string }> {
  const trip = await dispatched(30);
  await ok(driver(trip.driverToken, "/events", { type: "departed" }));
  await ok(driver(trip.driverToken, "/events", { type: "arrived", location: NARITA_NEARBY }));
  const signboard = await upload(trip.driverToken, "signboard");
  api.clock.advance(31 * MINUTE);
  await ok(driver(trip.driverToken, "/contacts", { method: "phone", note }));
  await ok(driver(trip.driverToken, "/contacts", { method: "phone" }));
  await ok(driver(trip.driverToken, "/contacts", { method: "phone" }));
  api.clock.advance(91 * MINUTE);
  await ok(driver(trip.driverToken, "/request-leave", { location: NARITA_NEARBY }));
  api.clock.advance(11 * MINUTE);
  await ok(driver(trip.driverToken, "/no-show"));
  return { ...trip, signboard };
}

// ---- 证据访问 ----

test("猜照片编号：别的单的照片（同一供应商、别的供应商）换订单路径都取不到，也不留审计；格式不对不是 500", async () => {
  const mine = await claimed("没人接");
  const sibling = await dispatched(30);
  const siblingFile = await upload(sibling.driverToken, "signboard");
  const otherTenant = await dispatched(30, "a");
  const otherFile = await upload(otherTenant.driverToken, "signboard");
  const token = await ops();

  for (const fileId of [siblingFile, otherFile, randomUUID()]) assert.equal((await getFile("platform", mine.orderId, fileId, token)).statusCode, 404, fileId);
  assert.equal((await getFile("tenant", mine.orderId, siblingFile, mine.tenantToken)).statusCode, 404, "同一供应商、别的单");
  assert.equal((await getFile("tenant", otherTenant.orderId, otherFile, mine.tenantToken)).statusCode, 404, "别的供应商的单");
  for (const bad of ["not-a-uuid", "..%2f..%2fetc", "1"]) {
    const res = await getFile("platform", mine.orderId, bad, token);
    assert.ok(res.statusCode >= 400 && res.statusCode < 500, `${bad} 得到 ${res.statusCode}`);
  }
  assert.equal(await audits(mine.orderId), 0);
  assert.equal(await audits(sibling.orderId), 0);
  assert.equal(await audits(otherTenant.orderId), 0);
});

test("司机令牌、渠道令牌不能调运营和供应商的照片接口；司机只能取自己这一单的；改派后旧司机取不到", async () => {
  const mine = await claimed("没人接");
  const sibling = await dispatched(30);
  const siblingFile = await upload(sibling.driverToken, "signboard");
  const channelToken = await flow.token();
  for (const token of [sibling.driverToken, channelToken]) {
    assert.equal((await getFile("platform", mine.orderId, mine.signboard, token)).statusCode, 401);
    assert.equal((await getFile("tenant", mine.orderId, mine.signboard, token)).statusCode, 401);
  }
  const read = (token: string, id: string) => api.app.inject({ method: "GET", url: `/driver/v1/trip/files/${id}`, headers: { authorization: `Bearer ${token}` } });
  assert.equal((await read(sibling.driverToken, mine.signboard)).statusCode, 404, "别的单的照片");
  assert.equal((await read(sibling.driverToken, siblingFile)).statusCode, 200);

  const who = { ...m.b, adminToken: sibling.tenantToken };
  await ok(assign(api, who, sibling.orderId, (await newDriver(api, who)).id, (await newVehicle(api, who, m.ids.biz7)).id));
  assert.equal((await read(sibling.driverToken, siblingFile)).statusCode, 401, "改派后旧链接作废");
  assert.equal(await audits(mine.orderId), 0);
});

test("数据范围是城市且渠道：城市在范围里、渠道不在也取不到；只读员工能看（记审计）但不能判定", async () => {
  const mine = await claimed("没人接");
  const otherChannel = (await newChannel(api, await platformLogin(api, m.staff.cm1.email), { name: `别的渠道-${randomUUID().slice(0, 4)}` })).id;
  const mixed = await staffWithRole("城市对渠道错", ["orders:view"], { city_ids: [m.ids.tokyo], channel_ids: [otherChannel] });
  assert.equal((await getFile("platform", mine.orderId, mine.signboard, mixed)).statusCode, 404);
  assert.equal((await api.call("GET", `/platform/v1/orders/${mine.orderId}`, { token: mixed })).status, 404);
  assert.equal(await audits(mine.orderId), 0);

  const reader = await platformLogin(api, m.staff.readonly.email);
  assert.equal((await getFile("platform", mine.orderId, mine.signboard, reader)).statusCode, 200);
  assert.equal(await audits(mine.orderId), 1);
  await api.app.orderJobs.exceptions();
  const ticket = (await ok(api.call("GET", `/platform/v1/tickets?type=no_show_review&order_id=${mine.orderId}`, { token: await ops() }))).items[0];
  assert.equal((await api.call("POST", `/platform/v1/tickets/${ticket.id}/decide`, { token: reader, body: { outcome: "approved", note: "看过照片" } })).status, 403);
});

test("租户 A 读不到租户 B 的订单详情（联系备注和照片列表都在里面）", async () => {
  const mine = await claimed("打 090-1234-5678 没人接");
  const other = await tenantLogin(api, m.a.adminEmail);
  const res = await api.call("GET", `/tenant/v1/orders/${mine.orderId}`, { token: other });
  assert.equal(res.status, 404);
  assert.ok(!res.text.includes("090-1234-5678"));
});

test("审计写不下去就不给照片：同一个事务，没有照片内容返回；修好后恢复；供应商不受影响", async (t) => {
  const mine = await claimed("没人接");
  const suffix = randomUUID().replaceAll("-", "");
  const fn = `qa_audit_fail_${suffix}`;
  await api.db.owner.query(`create function ${fn}() returns trigger language plpgsql as $$ begin raise exception 'audit down'; end $$`);
  await api.db.owner.query(`create trigger ${fn} before insert on audit_logs for each row when (new.resource_id = '${mine.orderId}' and new.action = 'view_evidence_file') execute function ${fn}()`);
  const drop = async (): Promise<void> => {
    await api.db.owner.query(`drop trigger if exists ${fn} on audit_logs`);
    await api.db.owner.query(`drop function if exists ${fn}()`);
  };
  t.after(drop);

  const token = await ops();
  const failed = await getFile("platform", mine.orderId, mine.signboard, token);
  assert.equal(failed.statusCode, 500);
  assert.notEqual(failed.headers["content-type"], "image/jpeg");
  assert.ok(!failed.rawPayload.includes(JPEG.subarray(0, 32)), "响应里不能有照片内容");
  assert.equal((await getFile("tenant", mine.orderId, mine.signboard, mine.tenantToken)).statusCode, 200, "供应商看自己的照片不记审计");
  await drop();
  assert.equal((await getFile("platform", mine.orderId, mine.signboard, token)).statusCode, 200);
  assert.equal(await audits(mine.orderId), 1);
});

test("上传：SVG、HTML、0 字节、超过 5 MB、只声明不符的都拒收，不入库", async () => {
  const { orderId, driverToken } = await dispatched(30);
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>`);
  const html = Buffer.from("<!doctype html><script>alert(1)</script>");
  const cases: [string, string, Buffer, number][] = [
    ["SVG 按 SVG 传", "image/svg+xml", svg, 415],
    ["SVG 冒充 JPEG", "image/jpeg", svg, 415],
    ["HTML 冒充 PNG", "image/png", html, 415],
    ["HTML 按 HTML 传", "text/html", html, 415],
    ["PNG 声明成 JPEG", "image/jpeg", Buffer.concat([PNG_MAGIC, Buffer.alloc(32, 1)]), 415],
    ["0 字节", "image/jpeg", Buffer.alloc(0), 400],
    ["超过 5 MB", "image/jpeg", Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)]), 413],
  ];
  for (const [label, type, payload, status] of cases) {
    const res = await rawUpload(driverToken, "signboard", type, payload);
    assert.ok(res.statusCode === status || (status === 400 && res.statusCode === 422), `${label} 得到 ${res.statusCode}：${res.body.slice(0, 200)}`);
  }
  assert.equal(await fileCount(orderId), 0);
  await assert.rejects(
    api.db.owner.query("insert into order_files (tenant_id, order_id, kind, content_type, data, byte_size, sha256, uploaded_at, link_id) select tenant_id, id, 'signboard', 'image/svg+xml', '\\x3c', 1, 'x', now(), (select id from driver_links where order_id = $1 limit 1) from orders where id = $1", [orderId]),
    /content_type|violates/,
    "数据库也不收别的类型",
  );
});

test("JPEG 开头藏脚本的文件：只按图片给，不让浏览器当网页跑", async () => {
  const trip = await dispatched(30);
  const polyglot = Buffer.concat([JPEG.subarray(0, 4), Buffer.from("<html><script>alert(1)</script></html>")]);
  const res = await rawUpload(trip.driverToken, "signboard", "image/jpeg", polyglot);
  assert.equal(res.statusCode, 201, res.body);
  const fileId = res.json().file.id as string;
  for (const got of [await getFile("platform", trip.orderId, fileId, await ops()), await getFile("tenant", trip.orderId, fileId, trip.tenantToken)]) {
    assert.equal(got.headers["content-type"], "image/jpeg");
    assert.equal(got.headers["x-content-type-options"], "nosniff");
    assert.match(String(got.headers["content-security-policy"]), /default-src 'none'; sandbox/);
    assert.equal(got.headers["cache-control"], "no-store");
  }
});

// ---- 打码的范围 ----

test("手写备注：运营能看到的工单详情、异常、审计都没有原文；订单详情打码；供应商看到原文", async () => {
  const note = "山田 太郎不接，打 +81 90-1111-2222，发 yamada.taro@example.org";
  const mine = await claimed(note);
  const raws = ["90-1111-2222", "yamada.taro"];
  const token = await ops();
  await api.app.orderJobs.exceptions();
  const ticket = (await ok(api.call("GET", `/platform/v1/tickets?type=no_show_review&order_id=${mine.orderId}`, { token }))).items[0];
  const surfaces: [string, unknown][] = [
    ["订单详情", await ok(api.call("GET", `/platform/v1/orders/${mine.orderId}`, { token }))],
    ["工单详情", await ok(api.call("GET", `/platform/v1/tickets/${ticket.id}`, { token }))],
    ["异常", await ok(api.call("GET", `/platform/v1/exceptions?order_id=${mine.orderId}`, { token }))],
    ["审计", await ok(api.call("GET", `/platform/v1/audit-logs?resource=order&resource_id=${mine.orderId}`, { token: await platformLogin(api, "root@platform.test") }))],
  ];
  for (const [label, body] of surfaces) {
    const text = JSON.stringify(body);
    for (const raw of raws) assert.ok(!text.includes(raw), `${label} 里有 ${raw}`);
  }
  const tenant = await ok(api.call("GET", `/tenant/v1/orders/${mine.orderId}`, { token: mine.tenantToken }));
  assert.ok(tenant.records.contacts.some((contact: { note: string | null }) => contact.note === note), "供应商看到原文");
});

// ---- 判定 ----

test("no-show 审核同时判两次：只成功一次；判定后再判被拒，结论不变", async () => {
  const mine = await claimed("没人接");
  const token = await ops();
  await api.app.orderJobs.exceptions();
  const ticket = (await ok(api.call("GET", `/platform/v1/tickets?type=no_show_review&order_id=${mine.orderId}`, { token }))).items[0];
  const decide = (outcome: string) => api.call("POST", `/platform/v1/tickets/${ticket.id}/decide`, { token, body: { outcome, note: "看过证据" } });
  const results = await Promise.all([decide("approved"), decide("rejected")]);
  assert.deepEqual(results.map((res) => res.status).sort(), [200, 409], results.map((res) => res.text).join(" / "));
  const won = results.find((res) => res.status === 200)?.body.ticket.outcome;
  assert.equal((await decide(won === "approved" ? "rejected" : "approved")).status, 409);
  const after = await ok(api.call("GET", `/platform/v1/tickets/${ticket.id}`, { token }));
  assert.equal(after.ticket.outcome, won);
  const claim = (await ok(api.call("GET", `/platform/v1/orders/${mine.orderId}`, { token }))).records.no_show_claim;
  assert.equal(claim.status, won === "approved" ? "approved" : "rejected");
});

// ---- 准时到达 ----

/** 用行锁把请求排队：先占住订单行，按给定顺序发请求（每个都等到排上队），放开后按顺序执行。 */
async function queued<T>(orderId: string, steps: (() => Promise<T>)[]): Promise<T[]> {
  const blocker = await api.db.owner.connect();
  await blocker.query("begin");
  await blocker.query("select 1 from orders where id = $1 for update", [orderId]);
  const pending: Promise<T>[] = [];
  for (const step of steps) {
    pending.push(step());
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await blocker.query("commit");
  blocker.release();
  return Promise.all(pending);
}

test("到达和填落地并发：落地先拿到锁就算准时（到达读的是拿到锁之后的数据）", async () => {
  const { orderId, driverToken } = await dispatched(-60);
  await ok(driver(driverToken, "/events", { type: "departed" }));
  const fileId = await upload(driverToken, "arrival_screen");
  const [landing, arrival] = await queued(orderId, [() => driver(driverToken, "/landing", { landed_at: at(3).toISOString(), file_id: fileId }), () => driver(driverToken, "/events", { type: "arrived", location: NARITA_NEARBY })]);
  assert.equal(landing?.status, 200, landing?.text);
  assert.equal(arrival?.status, 200, arrival?.text);
  assert.deepEqual(await arrivalEvents(orderId), [true]);
});

test("到达和填落地并发：到达先拿到锁就算迟到，落地照常记下", async () => {
  const { orderId, driverToken } = await dispatched(-60);
  await ok(driver(driverToken, "/events", { type: "departed" }));
  const fileId = await upload(driverToken, "arrival_screen");
  const [arrival, landing] = await queued(orderId, [() => driver(driverToken, "/events", { type: "arrived", location: NARITA_NEARBY }), () => driver(driverToken, "/landing", { landed_at: at(3).toISOString(), file_id: fileId })]);
  assert.equal(arrival?.status, 200, arrival?.text);
  assert.equal(landing?.status, 200, landing?.text);
  assert.deepEqual(await arrivalEvents(orderId), [false]);
});

test("重复到达（先后、同时）只记一条", async () => {
  const serial = await dispatched(30);
  await ok(driver(serial.driverToken, "/events", { type: "departed" }));
  await ok(driver(serial.driverToken, "/events", { type: "arrived", location: NARITA_NEARBY }));
  await driver(serial.driverToken, "/events", { type: "arrived", location: NARITA_NEARBY });
  assert.deepEqual(await arrivalEvents(serial.orderId), [true]);

  const racing = await dispatched(30);
  await ok(driver(racing.driverToken, "/events", { type: "departed" }));
  await Promise.all([driver(racing.driverToken, "/events", { type: "arrived", location: NARITA_NEARBY }), driver(racing.driverToken, "/events", { type: "arrived", location: NARITA_NEARBY })]);
  assert.deepEqual(await arrivalEvents(racing.orderId), [true]);
});

test("到达之后不能改派，迟到的结果洗不掉；到达之前改派：新司机改不了已提交的落地时间，到达只记一条", async () => {
  const arrived = await dispatched(-60);
  assert.equal((await reportLanding(arrived.driverToken, at(-30))).status, 200);
  await ok(driver(arrived.driverToken, "/events", { type: "departed" }));
  await ok(driver(arrived.driverToken, "/events", { type: "arrived", location: NARITA_NEARBY }));
  assert.deepEqual(await arrivalEvents(arrived.orderId), [false]);
  const arrivedWho = { ...m.b, adminToken: arrived.tenantToken };
  const refused = await assign(api, arrivedWho, arrived.orderId, (await newDriver(api, arrivedWho)).id, (await newVehicle(api, arrivedWho, m.ids.biz7)).id);
  assert.deepEqual([refused.status, refused.body.error.code], [409, "ORDER_STATE_INVALID"]);
  assert.deepEqual(await arrivalEvents(arrived.orderId), [false]);

  const { orderId, driverToken, tenantToken } = await dispatched(-60);
  const landedAt = at(-30);
  assert.equal((await reportLanding(driverToken, landedAt)).status, 200);
  await ok(driver(driverToken, "/events", { type: "departed" }));
  const who = { ...m.b, adminToken: tenantToken };
  const again = await assign(api, who, orderId, (await newDriver(api, who)).id, (await newVehicle(api, who, m.ids.biz7)).id);
  assert.equal(again.status, 200, again.text);
  const next = again.body.driver_link.token as string;
  const changed = await reportLanding(next, at(3));
  assert.equal(changed.status, 409, `新司机改落地时间：${changed.text}`);
  await ok(driver(next, "/events", { type: "departed" }));
  await ok(driver(next, "/events", { type: "arrived", location: NARITA_NEARBY }));
  assert.deepEqual(await arrivalEvents(orderId), [false], "落地 30 分钟后才到，改派不能把它变成准时");
  const detail = await ok(api.call("GET", `/platform/v1/orders/${orderId}`, { token: await ops() }));
  assert.equal(detail.order.landing.landed_at, landedAt.toISOString());
});

test("刷分限制：落地时间晚于现在超过 5 分钟、没有到达屏照片、用别的单或别的种类的照片都被拒，到达仍算迟到", async () => {
  const { orderId, driverToken } = await dispatched(-60);
  const screen = await upload(driverToken, "arrival_screen");
  const signboard = await upload(driverToken, "signboard");
  const sibling = await dispatched(30);
  const foreign = await upload(sibling.driverToken, "arrival_screen");
  const attempts: [string, unknown][] = [
    ["晚于现在 5 分钟 1 秒", { landed_at: new Date(at(5).getTime() + 1000).toISOString(), file_id: screen }],
    ["没有照片", { landed_at: at(0).toISOString() }],
    ["举牌照片充数", { landed_at: at(0).toISOString(), file_id: signboard }],
    ["别的单的到达屏", { landed_at: at(0).toISOString(), file_id: foreign }],
    ["不存在的照片", { landed_at: at(0).toISOString(), file_id: randomUUID() }],
  ];
  for (const [label, body] of attempts) {
    const res = await driver(driverToken, "/landing", body);
    assert.ok(res.status === 400 || res.status === 422, `${label} 得到 ${res.status}：${res.text}`);
  }
  await ok(driver(driverToken, "/events", { type: "departed" }));
  await ok(driver(driverToken, "/events", { type: "arrived", location: NARITA_NEARBY }));
  assert.deepEqual(await arrivalEvents(orderId), [false]);
});

test("刷分限制：恰好晚 5 分钟可以；提交后不能改；基准取到的就是填的时间（到达恰好等于基准算准时）", async () => {
  const { orderId, driverToken } = await dispatched(-60);
  const landedAt = at(5);
  assert.equal((await reportLanding(driverToken, landedAt)).status, 200);
  const second = await reportLanding(driverToken, at(4));
  assert.equal(second.status, 409, second.text);
  await ok(driver(driverToken, "/events", { type: "departed" }));
  api.clock.advance(5 * MINUTE);
  await ok(driver(driverToken, "/events", { type: "arrived", location: NARITA_NEARBY }));
  assert.deepEqual(await arrivalEvents(orderId), [true], "到达恰好等于基准");
  const detail = await ok(api.call("GET", `/platform/v1/orders/${orderId}`, { token: await ops() }));
  assert.equal(detail.order.landing.landed_at, landedAt.toISOString(), "第二次没有改掉");
  assert.equal(detail.order.landing.source, "driver");
});

test("落地后晚 1 秒到达算迟到（用车已过）", async () => {
  const { orderId, driverToken } = await dispatched(-60);
  assert.equal((await reportLanding(driverToken, at(0))).status, 200);
  await ok(driver(driverToken, "/events", { type: "departed" }));
  api.clock.advance(1000);
  await ok(driver(driverToken, "/events", { type: "arrived", location: NARITA_NEARBY }));
  assert.deepEqual(await arrivalEvents(orderId), [false]);
});

test("客人和司机都有落地：取较晚者，比较晚者早到算准时；页面数据标出不一致", async () => {
  const { orderId, driverToken } = await dispatched(-60);
  assert.equal((await reportLanding(driverToken, at(4))).status, 200);
  await ok(api.call("POST", `/sales/v1/orders/${orderId}/landed`, { token: await flow.token(), body: {} }));
  await ok(driver(driverToken, "/events", { type: "departed" }));
  api.clock.advance(2 * MINUTE);
  await ok(driver(driverToken, "/events", { type: "arrived", location: NARITA_NEARBY }));
  assert.deepEqual(await arrivalEvents(orderId), [true], "晚于客人、早于司机");
  const detail = await ok(api.call("GET", `/platform/v1/orders/${orderId}`, { token: await ops() }));
  assert.equal(detail.order.landing.disagreement, true);
});

test("供应商后台回传到达同样放宽（不只司机 H5）", async () => {
  const { orderId, driverToken, tenantToken } = await dispatched(-60);
  assert.equal((await reportLanding(driverToken, at(2))).status, 200);
  await ok(api.call("POST", `/tenant/v1/orders/${orderId}/events`, { token: tenantToken, body: { type: "departed" } }));
  await ok(api.call("POST", `/tenant/v1/orders/${orderId}/events`, { token: tenantToken, body: { type: "arrived" } }));
  assert.deepEqual(await arrivalEvents(orderId), [true]);
});

test("没有航班号的接机品类不算接机：库里有落地时间也不放宽，司机也填不了", async () => {
  const { orderId, driverToken } = await dispatched(-30);
  await api.db.owner.query("update orders set flight_no = null, guest_landed_at = $2 where id = $1", [orderId, at(60)]);
  assert.equal((await reportLanding(driverToken, at(0))).status, 409);
  await ok(driver(driverToken, "/events", { type: "departed" }));
  await ok(driver(driverToken, "/events", { type: "arrived", location: NARITA_NEARBY }));
  assert.deepEqual(await arrivalEvents(orderId), [false]);
});

test("免费等待不受评分改动影响：仍从落地时间起算，到达的快慢不改变它", async () => {
  const { driverToken } = await dispatched(-60);
  assert.equal((await reportLanding(driverToken, at(0))).status, 200);
  await ok(driver(driverToken, "/events", { type: "departed" }));
  await ok(driver(driverToken, "/events", { type: "arrived", location: NARITA_NEARBY }));
  const freeWait = 90;
  api.clock.advance((freeWait - 1) * MINUTE);
  const early = await driver(driverToken, "/request-leave", { location: NARITA_NEARBY });
  assert.deepEqual([early.status, early.body.error.code], [409, "FREE_WAIT_NOT_ENDED"], "落地后 89 分钟还在免费等待里");
  api.clock.advance(2 * MINUTE);
  assert.equal((await driver(driverToken, "/request-leave", { location: NARITA_NEARBY })).status, 200);
});
