/**
 * QA（M3-02）：司机 H5 的令牌、照片上传 / 下载、状态并发，补 driver-trip.itest.ts 没覆盖到的边界。真实接口 + 真实 PostgreSQL（独立 schema，测试结束删除）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, buildMarket, ok } from "./testing/market.ts";
import { assign, newDriver, newVehicle, seedOrder } from "./testing/dispatch.ts";

let api: TestApi;
let m: Market;

before(async () => {
  api = await createTestApi();
  m = await buildMarket(api);
});
after(() => api.close());

const MINUTE = 60_000;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);

async function tenantToken(side: "a" | "b" = "a"): Promise<string> {
  return (await ok(api.call("POST", "/tenant/v1/auth/login", { body: { email: m[side].adminEmail, password: TEST_PASSWORD } }))).access_token;
}

interface Dispatched {
  order: Awaited<ReturnType<typeof seedOrder>>;
  token: string;
  tenant: string;
  driverId: string;
  vehicleId: string;
}

async function dispatched(minutesAhead: number, extra: Partial<Parameters<typeof seedOrder>[3]> = {}): Promise<Dispatched> {
  const tenant = await tenantToken();
  const who = { ...m.a, adminToken: tenant };
  const order = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + minutesAhead * MINUTE), ...extra });
  const driverId = (await newDriver(api, who)).id as string;
  const vehicleId = (await newVehicle(api, who, m.ids.biz7)).id as string;
  const res = await ok(assign(api, who, order.id, driverId, vehicleId));
  return { order, token: res.driver_link.token, tenant, driverId, vehicleId };
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

// ---- 令牌 ----

test("令牌只存哈希：库里（司机链接、订单流水、审计日志）和服务日志里都找不到令牌原文和随机部分", async () => {
  const { order, token } = await dispatched(240);
  await ok(driver("GET", "", token));
  await ok(driver("POST", "/events", token, { type: "departed" }));
  const random = token.split(".")[1] as string;
  const link = await api.db.owner.query<{ token_hash: string; row: string }>("select token_hash, row_to_json(l)::text as row from driver_links l where order_id = $1", [order.id]);
  assert.equal(link.rowCount, 1);
  assert.equal(link.rows[0]?.token_hash, createHash("sha256").update(token, "utf8").digest("hex"));
  for (const sql of ["select row_to_json(l)::text as t from driver_links l", "select row_to_json(e)::text as t from order_events e", "select row_to_json(a)::text as t from audit_logs a", "select row_to_json(o)::text as t from orders o"]) {
    const rows = await api.db.owner.query<{ t: string }>(sql);
    for (const row of rows.rows) assert.ok(!row.t.includes(random), `${sql} 里出现了令牌原文`);
  }
  assert.ok(!api.logs().includes(random), "服务日志里出现了令牌原文");
});

test("有效期边界：过期时间的前 1 毫秒还能用，到点就 401（用车后 24 小时）", async () => {
  const { token, order } = await dispatched(30);
  const expiresAt = new Date((await ok(driver("GET", "", token))).link.expires_at as string);
  const service = await api.db.owner.query<{ service_at: Date }>("select service_at from orders where id = $1", [order.id]);
  assert.equal(expiresAt.getTime(), (service.rows[0]?.service_at as Date).getTime() + 24 * 60 * MINUTE);
  api.clock.advance(expiresAt.getTime() - api.clock.now().getTime() - 1);
  assert.equal((await driver("GET", "", token)).status, 200);
  api.clock.advance(1);
  const expired = await driver("GET", "", token);
  assert.deepEqual([expired.status, expired.body.error.code], [401, "DRIVER_LINK_INVALID"]);
});

test("改派：只换车不换司机，旧链接也立即作废，新链接能用", async () => {
  const d = await dispatched(300);
  const who = { ...m.a, adminToken: d.tenant };
  const otherVehicle = (await newVehicle(api, who, m.ids.biz7)).id as string;
  const res = await ok(assign(api, who, d.order.id, d.driverId, otherVehicle));
  assert.ok(typeof res.driver_link?.token === "string");
  assert.equal((await driver("GET", "", d.token)).status, 401, "旧链接");
  assert.equal((await driver("GET", "", res.driver_link.token)).status, 200, "新链接");
});

test("缺陷复现 · 吊销和司机的请求同时到：吊销所在的事务先锁住订单、吊销、提交，排在后面的司机请求仍然用已吊销的链接操作成功", async () => {
  const { order, token } = await dispatched(360);
  const client = await api.db.owner.connect();
  try {
    // 模拟「吊销 / 重新生成 / 改派」的事务：先锁订单（services/dispatch.ts 的 lockOrder），再吊销链接
    await client.query("begin");
    await client.query("select id from orders where id = $1 for update", [order.id]);
    const pending = driver("POST", "/events", token, { type: "departed" });
    await new Promise((resolve) => setTimeout(resolve, 400));
    await client.query("update driver_links set revoked_at = now(), revoke_reason = 'manual' where order_id = $1 and revoked_at is null", [order.id]);
    await client.query("commit");
    const res = await pending;
    const status = await api.db.owner.query<{ status: string }>("select status from orders where id = $1", [order.id]);
    assert.deepEqual([res.status, status.rows[0]?.status], [401, "assigned"], "链接已吊销，司机的操作不应生效");
  } finally {
    client.release();
  }
});

test("暴力枚举：格式对、租户对、随机部分乱猜的令牌，连续 30 次都是同样的 401，不泄露任何信息", async () => {
  const { token } = await dispatched(400);
  const prefix = token.split(".")[0] as string;
  const texts = new Set<string>();
  for (let i = 0; i < 30; i += 1) {
    const guess = `${prefix}.${createHash("sha256").update(randomUUID()).digest("base64url").slice(0, 43)}`;
    const res = await driver("GET", "", guess);
    assert.equal(res.status, 401);
    texts.add(res.text);
  }
  assert.equal(texts.size, 1);
  assert.equal((await driver("GET", "", token)).status, 200, "乱猜之后，真正的链接照常能用");
});

// ---- 司机看到的内容 ----

test("司机页面的所有应答里都没有价格、客人邮箱、渠道、对外价：看单、回传、联系、上传都查一遍", async () => {
  const { token } = await dispatched(15);
  const texts: string[] = [];
  texts.push((await driver("GET", "", token)).text);
  texts.push((await driver("POST", "/events", token, { type: "departed" })).text);
  texts.push((await driver("POST", "/events", token, { type: "arrived", location: { lng: 140.3887, lat: 35.7686 } })).text);
  texts.push((await upload(token, "signboard", JPEG)).text);
  api.clock.advance(20 * MINUTE);
  texts.push((await driver("POST", "/contacts", token, { method: "phone" })).text);
  for (const text of texts) {
    assert.doesNotMatch(text, /guest@example\.com|settlement|sell|markup|channel|price|amount|20000|currency|对外价|加价|结算|email/i, text.slice(0, 300));
  }
});

// ---- 照片 ----

test("照片大小：恰好 5 MB 可以，多 1 字节 413", async () => {
  const { token } = await dispatched(500);
  const exactly = Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024 - JPEG.length)]);
  assert.equal(exactly.length, 5 * 1024 * 1024);
  assert.equal((await upload(token, "signboard", exactly)).status, 201);
  const over = await upload(token, "signboard", Buffer.concat([exactly, Buffer.alloc(1)]));
  assert.equal(over.status, 413, over.text);
});

test("照片类型：SVG / HTML / multipart / 没有 Content-Type 都拒绝；HEIC 内容声明成 JPEG 拒绝；一张也没存进去", async () => {
  const { token, order } = await dispatched(520);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(document.domain)"/>');
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(100)]);
  for (const [data, type] of [
    [svg, "image/svg+xml"],
    [svg, "image/jpeg"],
    [Buffer.from("<html><script>alert(1)</script></html>"), "text/html"],
    [Buffer.from("--x\r\nContent-Disposition: form-data; name=f\r\n\r\nabc\r\n--x--"), "multipart/form-data; boundary=x"],
    [JPEG, "application/octet-stream"],
    [heic, "image/jpeg"],
  ] as const) {
    const res = await upload(token, "signboard", data, type);
    assert.ok(res.status === 415 || res.status === 400, `${type}: ${res.status} ${res.text}`);
  }
  const stored = await api.db.owner.query<{ n: number }>("select count(*)::int as n from order_files where order_id = $1", [order.id]);
  assert.equal(stored.rows[0]?.n, 0);
});

test("伪装文件：开头是 JPEG、后面是 HTML 的文件能存，但取回时类型固定为 image/jpeg、nosniff、CSP sandbox，不会被当成页面执行", async () => {
  const { token, order, tenant } = await dispatched(540);
  const polyglot = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("<html><script>alert(document.cookie)</script></html>")]);
  const saved = await upload(token, "signboard", polyglot);
  assert.equal(saved.status, 201, saved.text);
  for (const [url, auth] of [
    [`/driver/v1/trip/files/${saved.body.file.id}`, token],
    [`/tenant/v1/orders/${order.id}/files/${saved.body.file.id}`, tenant],
  ] as const) {
    const res = await api.app.inject({ method: "GET", url, headers: { authorization: `Bearer ${auth}` } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "image/jpeg");
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.match(String(res.headers["content-security-policy"]), /default-src 'none'.*sandbox/);
    assert.doesNotMatch(String(res.headers["content-disposition"] ?? ""), /filename/i, "不带客户端给的文件名");
  }
});

test("同时上传 6 张：都成功、都存下了、编号各不相同", async () => {
  const { token, order } = await dispatched(560);
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => upload(token, i % 2 === 0 ? "signboard" : "arrival_screen", Buffer.concat([JPEG, Buffer.from([i])]))));
  assert.deepEqual(results.map((res) => res.status), [201, 201, 201, 201, 201, 201]);
  assert.equal(new Set(results.map((res) => res.body.file.id)).size, 6);
  const stored = await api.db.owner.query<{ n: number }>("select count(*)::int as n from order_files where order_id = $1", [order.id]);
  assert.equal(stored.rows[0]?.n, 6);
});

test("下载的访问控制：同一租户另一张单的令牌、吊销后的令牌、没有令牌、别的租户的管理员、不存在的编号，都拿不到", async () => {
  const one = await dispatched(600);
  const two = await dispatched(620);
  const file = (await upload(one.token, "signboard", JPEG)).body.file.id as string;
  const get = (url: string, token?: string) => api.app.inject({ method: "GET", url, headers: token === undefined ? {} : { authorization: `Bearer ${token}` } });
  assert.equal((await get(`/driver/v1/trip/files/${file}`, one.token)).statusCode, 200);
  assert.equal((await get(`/driver/v1/trip/files/${file}`, two.token)).statusCode, 404, "另一张单的司机");
  assert.equal((await get(`/driver/v1/trip/files/${file}`)).statusCode, 401, "没有令牌");
  assert.equal((await get(`/tenant/v1/orders/${one.order.id}/files/${file}`)).statusCode, 401);
  assert.equal((await get(`/tenant/v1/orders/${two.order.id}/files/${file}`, one.tenant)).statusCode, 404, "挂在别的订单下取");
  assert.equal((await get(`/tenant/v1/orders/${one.order.id}/files/${file}`, await tenantToken("b"))).statusCode, 404, "别的租户");
  assert.equal((await get(`/driver/v1/trip/files/${randomUUID()}`, one.token)).statusCode, 404);
  const revoked = await api.call("DELETE", `/tenant/v1/orders/${one.order.id}/driver-link`, { token: one.tenant });
  assert.ok(revoked.status === 200 || revoked.status === 204, revoked.text);
  assert.equal((await get(`/driver/v1/trip/files/${file}`, one.token)).statusCode, 401, "吊销之后");
});

// ---- 状态并发 ----

test("并发：司机和调度系统同时点「完成」，只有一个成功，状态流水里只有一条完成", async () => {
  const d = await dispatched(700);
  await ok(driver("POST", "/events", d.token, { type: "departed" }));
  await ok(driver("POST", "/events", d.token, { type: "arrived" }));
  await ok(driver("POST", "/events", d.token, { type: "picked_up" }));
  const results = await Promise.all([
    driver("POST", "/events", d.token, { type: "completed" }),
    api.call("POST", `/tenant/v1/orders/${d.order.id}/events`, { token: d.tenant, body: { type: "completed" } }),
    driver("POST", "/events", d.token, { type: "completed" }),
  ]);
  assert.deepEqual(results.map((res) => res.status).sort(), [200, 409, 409]);
  const events = await api.db.owner.query<{ n: number }>("select count(*)::int as n from order_events where order_id = $1 and to_status = 'completed'", [d.order.id]);
  assert.equal(events.rows[0]?.n, 1);
});

test("并发：5 项证据齐了之后，同时点「接到客人」和「客人未出现」，只有一个成功，订单状态和流水一致", async () => {
  const d = await dispatched(20, { freeWaitMinutes: 60 });
  await ok(driver("POST", "/events", d.token, { type: "departed" }));
  await ok(driver("POST", "/events", d.token, { type: "arrived", location: { lng: 140.389, lat: 35.769 } }));
  assert.equal((await upload(d.token, "signboard", JPEG)).status, 201);
  api.clock.advance(25 * MINUTE);
  for (let i = 0; i < 3; i += 1) {
    await ok(driver("POST", "/contacts", d.token, { method: "phone" }));
    api.clock.advance(5 * MINUTE);
  }
  api.clock.advance(60 * MINUTE);
  await ok(driver("POST", "/request-leave", d.token, {}));
  api.clock.advance(10 * MINUTE);
  const [pickedUp, noShow] = await Promise.all([driver("POST", "/events", d.token, { type: "picked_up" }), driver("POST", "/no-show", d.token, {})]);
  assert.deepEqual([pickedUp.status, noShow.status].sort(), [200, 409], `${pickedUp.text} / ${noShow.text}`);
  const row = await api.db.owner.query<{ status: string }>("select status from orders where id = $1", [d.order.id]);
  const claims = await api.db.owner.query<{ n: number }>("select count(*)::int as n from order_no_show_claims where order_id = $1", [d.order.id]);
  const expected = pickedUp.status === 200 ? ["in_service", 0] : ["no_show_claimed", 1];
  assert.deepEqual([row.rows[0]?.status, claims.rows[0]?.n], expected);
});
