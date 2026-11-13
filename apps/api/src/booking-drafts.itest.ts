/**
 * M9E-01：预订草稿（ADR 0090 第二节），经真实接口、真实 PostgreSQL。
 *
 * 覆盖：读到只给预订条件和到期时刻（不给来源）；有效期内反复打开；过期、不存在、格式不对同一个 404；不带 CORS 头；
 * 每个地址每分钟 60 次；库里的内容不合格按不存在；清理任务只删过期的；数据库角色不能改草稿、租户角色碰不到。
 * 草稿用服务层函数直接写入（建草稿的接口随 M9E-02）；测试数据随测试 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { BookingDraft } from "@nozomi/domain";
import { withPlatformTx, withTenantTx } from "./db/context.ts";
import { insertBookingDraft, newBookingDraftId } from "./services/booking-drafts.ts";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";

let api: TestApi;
let ipSeq = 0;
const nextIp = (): string => `10.91.${Math.floor(++ipSeq / 200)}.${ipSeq % 200}`;

const charter: BookingDraft = {
  v: 1,
  tab: "charter",
  service_local: "2026-12-01T09:00",
  pickup: { name: "銀座", lat: 35.6717, lng: 139.765 },
  dropoff: { name: "新宿駅", lat: 35.6896, lng: 139.7006 },
  waypoints: [{ name: "浅草寺", lat: 35.7148, lng: 139.7967, stay_minutes: 60 }],
  package_hours: null,
  passengers: 2,
  luggage: 1,
  lang: "ja",
};

const store = (draft: BookingDraft = charter, source: Parameters<typeof insertBookingDraft>[2] = null) => withPlatformTx(api.db.pool, (db) => insertBookingDraft(db, draft, source, api.clock.now()));
const read = (id: string, headers: Record<string, string> = {}) => api.call("GET", `/site/v1/booking-drafts/${encodeURIComponent(id)}`, { ip: nextIp(), headers });

before(async () => {
  api = await createTestApi();
});

after(async () => {
  await api?.close();
});

test("读到草稿：只给预订条件和到期时刻，不给来源；有效期内可以反复打开", async () => {
  await api.superAdminToken();
  const adminId = (await api.db.owner.query<{ id: string }>("select id from platform_users limit 1")).rows[0]?.id;
  const key = await api.db.owner.query<{ id: string }>(
    "insert into embed_keys (key, name, allowed_origins, default_lang, default_services, created_at, updated_at, created_by, updated_by) values ($1, '测试', array['https://partner.example'], 'ja', array['transfer'], now(), now(), $2, $2) returning id",
    [`nze_${"A".repeat(32)}`, adminId],
  );
  const stored = await store(charter, { embedKeyId: key.rows[0]?.id as string, embedOrigin: "https://partner.example", returnUrl: "https://partner.example/thanks" });
  assert.match(stored.id, /^[A-Za-z0-9_-]{43}$/);
  const first = await read(stored.id);
  assert.equal(first.status, 200, first.text);
  assert.deepEqual(first.body, { draft: charter, expires_at: new Date(api.clock.now().getTime() + 120 * 60_000).toISOString() });
  assert.doesNotMatch(first.text, /partner\.example|embed|return_url|nze_/);
  assertMatchesOpenApi("get", "/site/v1/booking-drafts/{id}", first);
  api.clock.advance(119 * 60_000);
  const again = await read(stored.id);
  assert.equal(again.status, 200, "1 小时 59 分时刷新照常");
  assert.deepEqual((again.body as { draft: unknown }).draft, charter);
});

test("过期、不存在、格式不对：同一个 404 BOOKING_DRAFT_NOT_FOUND", async () => {
  const stored = await store();
  api.clock.advance(120 * 60_000);
  const expired = await read(stored.id);
  const missing = await read(newBookingDraftId());
  const malformed = await read("not-a-draft");
  const tooLong = await read(`${newBookingDraftId()}A`);
  for (const res of [expired, missing, malformed, tooLong]) {
    assert.equal(res.status, 404, res.text);
    assert.deepEqual((res.body as { error: { code: string } }).error.code, "BOOKING_DRAFT_NOT_FOUND");
  }
  assert.deepEqual(expired.body, missing.body, "过期和不存在的应答完全一样");
  assertMatchesOpenApi("get", "/site/v1/booking-drafts/{id}", expired);
});

test("带别的网站的 Origin 也不带任何 CORS 头", async () => {
  const stored = await store();
  const res = await read(stored.id, { origin: "https://partner.example" });
  assert.equal(res.status, 200);
  for (const name of Object.keys(res.headers)) assert.doesNotMatch(name, /^access-control-/i, name);
  const preflight = await api.call("OPTIONS" as "GET", `/site/v1/booking-drafts/${stored.id}`, { ip: nextIp(), headers: { origin: "https://partner.example", "access-control-request-method": "GET" } });
  for (const name of Object.keys(preflight.headers)) assert.doesNotMatch(name, /^access-control-/i, name);
});

test("每个地址每分钟 60 次，第 61 次 429", async () => {
  const stored = await store();
  const ip = "10.92.0.1";
  for (let i = 0; i < 60; i += 1) assert.equal((await api.call("GET", `/site/v1/booking-drafts/${stored.id}`, { ip })).status, 200);
  const limited = await api.call("GET", `/site/v1/booking-drafts/${stored.id}`, { ip });
  assert.equal(limited.status, 429);
  assert.equal((limited.body as { error: { code: string } }).error.code, "RATE_LIMITED");
  const other = await api.call("GET", `/site/v1/booking-drafts/${newBookingDraftId()}`, { ip });
  assert.equal(other.status, 429, "不存在的编号同样占额度：不能借 404 绕过限速去枚举");
  api.clock.advance(60_000);
});

test("库里的内容不合格（比如被人改出多余的键）按不存在处理", async () => {
  const id = newBookingDraftId();
  const now = api.clock.now();
  await api.db.owner.query("insert into booking_drafts (id, content, created_at, expires_at) values ($1, $2, $3, $4)", [id, JSON.stringify({ ...charter, passenger: { name: "x" } }), now, new Date(now.getTime() + 3_600_000)]);
  const res = await read(id);
  assert.equal(res.status, 404);
});

test("库的约束：编号写法、16 KB、到期晚于创建", async () => {
  const now = api.clock.now();
  const later = new Date(now.getTime() + 60_000);
  const insert = (id: string, content: unknown, expires = later) => api.db.owner.query("insert into booking_drafts (id, content, created_at, expires_at) values ($1, $2, $3, $4)", [id, JSON.stringify(content), now, expires]);
  await assert.rejects(insert("short", charter), /booking_drafts_id_check/);
  await assert.rejects(insert(newBookingDraftId(), { pad: "x".repeat(16_384) }), /booking_drafts_content_size/);
  await assert.rejects(insert(newBookingDraftId(), charter, now), /booking_drafts_expiry_check/);
});

test("清理任务只删过期的", async () => {
  await api.db.owner.query("delete from booking_drafts");
  const old = await store();
  api.clock.advance(60 * 60_000);
  const fresh = await store();
  api.clock.advance(61 * 60_000);
  const first = await api.app.bookingDraftRetention.tick();
  assert.deepEqual(first, { deleted: 1, batches: 1, busy: false });
  const left = await api.db.owner.query<{ id: string }>("select id from booking_drafts");
  assert.deepEqual(left.rows.map((row) => row.id), [fresh.id]);
  assert.notEqual(old.id, fresh.id);
  assert.equal((await read(fresh.id)).status, 200);
  assert.deepEqual(await api.app.bookingDraftRetention.tick(), { deleted: 0, batches: 1, busy: false });
});

test("数据库角色：平台角色不能改草稿（写入后不改），租户角色碰不到", async () => {
  const stored = await store();
  await assert.rejects(
    withPlatformTx(api.db.pool, (db) => db.query("update booking_drafts set expires_at = expires_at + interval '1 day' where id = $1", [stored.id])),
    (err: unknown) => (err as { code?: string }).code === "42501",
  );
  await assert.rejects(
    withTenantTx(api.db.pool, "00000000-0000-4000-8000-000000000002", (db) => db.query("select id from booking_drafts")),
    (err: unknown) => (err as { code?: string }).code === "42501",
  );
});
