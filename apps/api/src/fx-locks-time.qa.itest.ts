/**
 * M2-06 测试角色补充：汇率人工锁定和时间有关的边界（ADR 0025），经真实接口、真实 PostgreSQL；数据源是本机的假服务器，时钟是测试时钟。
 * - 到期那一刻：差 1 毫秒批准还能生效、报价还用；到点那一刻批准不能生效、报价不再用；跨午夜、跨月同样；
 * - 已经过了到期时间、定时任务还没记的锁定：解锁的复核批准时 APPROVAL_STALE（整个回滚，锁定行不被改）；新的锁定批准时顺手记为到期（操作者「系统」，入口后台）；
 *   之后的定时任务不重复记；两个进程同时处理到期只记一次；
 * - 两边都锁定时数据源停更超过 48 小时照常报价，一边到期后暂停；挂起的一批确认后，锁定的币种仍用锁定值。
 * 每个测试开始时先给一批新的数据源汇率、按当前时钟算时间，不依赖别的测试的执行顺序。测试数据只在这里构造，结束时连同 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { type ApiResponse, TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { type FakeFxSource, fxSourceBody, startFakeFxSource } from "./testing/fx-source.ts";
import { type Market, DROPOFF, buildMarket, ok } from "./testing/market.ts";

let api: TestApi;
let source: FakeFxSource;
let m: Market;
let md2: { id: string; token: string; email: string };

const HOUR = 3_600_000;
const RATES = { JPY: "150", CNY: "7.2", KRW: "1400", HKD: "7.8", TWD: "32", THB: "36" };
let lastAsOf = 0;

const nowMs = (): number => api.clock.now().getTime();
const requestLock = (token: string, body: Record<string, unknown>): Promise<ApiResponse> => api.call("POST", "/platform/v1/fx-rates/locks", { token, body: { expires_at: new Date(nowMs() + 24 * HOUR).toISOString(), ...body } });
const requestUnlock = (token: string, lockId: string): Promise<ApiResponse> => api.call("POST", `/platform/v1/fx-rates/locks/${lockId}/release`, { token, body: {} });
const decide = (token: string, id: string, decision: "approve" | "reject" | "withdraw"): Promise<ApiResponse> => api.call("POST", `/platform/v1/approvals/${id}/${decision}`, { token, body: {} });
const owner = async (sql: string, values: unknown[] = []): Promise<any[]> => (await api.db.owner.query(sql, values)).rows;
const previewIn = async (currency: string): Promise<any> =>
  ok(api.call("POST", "/platform/v1/quotes/preview", { token: m.root, body: { city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, currency, direction: "pickup", dropoff: DROPOFF, service_time: "2026-11-20T10:00", passengers: 2, luggage: 1 } }));
const biz7A = (body: any): any => body.groups.find((group: any) => group.vehicle_group_id === m.ids.biz7)?.candidates.find((candidate: any) => candidate.tenant_id === m.a.tenantId);
const refusedFx = (body: any): boolean => body.refused.some((entry: any) => entry.product_id === m.ids.pa && entry.reason === "FX_RATE_UNAVAILABLE");

async function login(email: string): Promise<string> {
  return (await ok(api.platformLogin({ body: { email, password: TEST_PASSWORD } }))).access_token;
}
/** 把时钟拨到某一刻（只往后），平台员工重新登录（令牌会过期）。 */
async function moveTo(at: number): Promise<void> {
  assert.ok(at >= nowMs(), "测试时钟只往后拨");
  api.clock.advance(at - nowMs());
  m.root = await login("root@platform.test");
  m.staff.masterData = { ...m.staff.masterData, token: await login(m.staff.masterData.email) };
  md2 = { ...md2, token: await login(md2.email) };
}
/** 数据源给一批新的（时间是现在前 1 分钟，比上一批晚），手动拉取；挂起时由超级管理员确认。 */
async function freshBatch(rates: Record<string, string> = RATES): Promise<string> {
  lastAsOf = Math.max(lastAsOf + 1_000, nowMs() - 60_000);
  source.respond({ body: fxSourceBody({ asOf: new Date(lastAsOf), rates }) });
  const fetched = (await ok(api.call("POST", "/platform/v1/fx-rates/fetch", { token: m.root }))).fetch;
  if (fetched.status === "held") {
    await ok(api.call("POST", `/platform/v1/fx-rates/fetches/${fetched.id}/confirm`, { token: m.root, body: {} }));
    return "confirmed";
  }
  return fetched.status;
}
async function lockApproved(body: Record<string, unknown>): Promise<{ id: string; expires_at: string }> {
  const requested = await ok(requestLock(m.staff.masterData.token, body), 202);
  await ok(decide(md2.token, requested.approval.id, "approve"));
  const [row] = await owner("select id::text as id, expires_at from fx_locks where lock_approval_id = $1", [requested.approval.id]);
  return { id: row.id, expires_at: new Date(row.expires_at).toISOString() };
}
/** 把还生效的锁定都解掉（每个测试结束时收尾）。 */
async function releaseAll(): Promise<void> {
  for (const row of await owner("select id::text as id from fx_locks where status = 'active' and expires_at > $1", [api.clock.now()])) {
    await ok(decide(md2.token, (await ok(requestUnlock(m.staff.masterData.token, row.id), 202)).approval.id, "approve"));
  }
  await api.app.fxCenter.expireLocks();
}

before(async () => {
  source = await startFakeFxSource();
  api = await createTestApi({ env: { FX_SOURCE_URL: source.url, FX_AUTO_FETCH: "false" } });
  m = await buildMarket(api);
  const invited = await ok(api.call("POST", "/platform/v1/staff", { token: m.root, body: { email: "qa-md2@platform.test", name: "主数据二", role: "master_data" } }), 201);
  await ok(api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
  md2 = { id: invited.user.id, token: await login("qa-md2@platform.test"), email: "qa-md2@platform.test" };
  assert.equal(await freshBatch(), "accepted");
});
after(async () => {
  await api.close();
  await source.close();
});

test("跨月的到期边界：月末 23:59:59.998 批准还能生效、报价还用；23:59:59.999（到期那一刻）起不再用，11 月 1 日 00:00 也不用；到点那一刻才批准的不能生效", async () => {
  await moveTo(Date.parse("2026-10-31T20:00:00.000Z"));
  assert.equal(await freshBatch(), "accepted");
  const expiresAt = "2026-10-31T23:59:59.999Z";
  const first = (await ok(requestLock(m.staff.masterData.token, { currency: "JPY", rate: "151.2", expires_at: expiresAt }), 202)).approval;
  const second = (await ok(requestLock(m.staff.masterData.token, { currency: "THB", rate: "36.1", expires_at: expiresAt }), 202)).approval;
  await moveTo(Date.parse("2026-10-31T23:59:59.998Z"));
  await ok(decide(md2.token, first.id, "approve"));
  const [lock] = await owner("select id::text as id, locked_at, expires_at from fx_locks where lock_approval_id = $1", [first.id]);
  assert.equal(new Date(lock.locked_at).toISOString(), "2026-10-31T23:59:59.998Z");
  const live = biz7A(await previewIn("USD"));
  assert.deepEqual([live.fx.rate, live.fx.lock.legs[0].lock_id], ["0.006613756614", lock.id]);
  // 到期那一刻：不再用（数据源还新，恢复用中央汇率 1/150）
  api.clock.advance(1);
  const atExpiry = biz7A(await previewIn("USD"));
  assert.deepEqual([atExpiry.fx.rate, atExpiry.fx.lock], ["0.006666666667", null]);
  // 正好在到期那一刻批准的：不能生效，仍是待审核
  const late = await decide(md2.token, second.id, "approve");
  assert.deepEqual([late.status, late.body.error.details.issues.map((issue: any) => issue.reason)], [400, ["EXPIRES_TOO_SOON"]], late.text);
  assert.equal((await owner("select status from approvals where id = $1", [second.id]))[0].status, "pending");
  assert.equal((await owner("select count(*)::int as n from fx_locks where lock_approval_id = $1", [second.id]))[0].n, 0);
  await moveTo(Date.parse("2026-11-01T00:00:00.000Z"));
  assert.equal(biz7A(await previewIn("USD")).fx.lock, null);
  await ok(decide(md2.token, second.id, "reject"));
  await releaseAll();
});

test("过了到期时间、定时任务还没记的锁定：解锁的批准 APPROVAL_STALE 且整个回滚（锁定行不动）；再发起解锁 FX_LOCK_NOT_ACTIVE；新的锁定批准时顺手记为到期（操作者系统、入口后台），之后定时任务不重复记", async () => {
  assert.equal(await freshBatch(), "accepted");
  const old = await lockApproved({ currency: "KRW", rate: "1401", expires_at: new Date(nowMs() + HOUR).toISOString() });
  const release = (await ok(requestUnlock(m.staff.masterData.token, old.id), 202)).approval;
  await moveTo(Date.parse(old.expires_at) + 5 * 60_000);
  const stale = await decide(md2.token, release.id, "approve");
  assert.deepEqual([stale.status, stale.body.error.code], [409, "APPROVAL_STALE"], stale.text);
  assert.deepEqual(await owner("select status, ended_at from fx_locks where id = $1", [old.id]), [{ status: "active", ended_at: null }], "批准失败整个回滚：锁定行没被改");
  assert.equal((await owner("select count(*)::int as n from audit_logs where resource = 'fx_lock' and action = 'expire' and resource_id = $1", [old.id]))[0].n, 0);
  await ok(decide(md2.token, release.id, "reject"));
  const again = await requestUnlock(m.staff.masterData.token, old.id);
  assert.deepEqual([again.status, again.body.error.code, again.body.error.details.status], [409, "FX_LOCK_NOT_ACTIVE", "expired"]);
  // 新的一条：发起时没有生效中的锁定（replaces_lock_id 为空）；批准时先把过期的那条记为到期
  const next = (await ok(requestLock(m.staff.masterData.token, { currency: "KRW", rate: "1402" }), 202)).approval;
  assert.equal(next.payload.replaces_lock_id, null);
  await ok(decide(md2.token, next.id, "approve"));
  const [ended] = await owner("select status, ended_at, end_approval_id, ended_by from fx_locks where id = $1", [old.id]);
  assert.deepEqual([ended.status, new Date(ended.ended_at).getTime(), ended.end_approval_id, ended.ended_by], ["expired", nowMs(), null, null]);
  const audit = await owner("select actor_type, actor_email, source from audit_logs where resource = 'fx_lock' and action = 'expire' and resource_id = $1", [old.id]);
  assert.deepEqual(audit, [{ actor_type: "system", actor_email: null, source: "console" }]);
  // 定时任务：两个进程同时处理到期，也不再重复记
  await Promise.all([api.app.fxCenter.expireLocks(), api.app.fxCenter.expireLocks()]);
  assert.equal((await owner("select count(*)::int as n from audit_logs where resource = 'fx_lock' and action = 'expire' and resource_id = $1", [old.id]))[0].n, 1);
  await releaseAll();
});

test("两个进程同时处理到期：同一条锁定只记一次到期审计、一次服务日志", async () => {
  assert.equal(await freshBatch(), "accepted");
  const lock = await lockApproved({ currency: "HKD", rate: "7.81", expires_at: new Date(nowMs() + HOUR).toISOString() });
  await moveTo(Date.parse(lock.expires_at));
  const results = await Promise.all([api.app.fxCenter.expireLocks(), api.app.fxCenter.expireLocks(), api.app.fxCenter.tick()]);
  assert.equal(results[0].length + results[1].length <= 1, true);
  assert.deepEqual(await owner("select status from fx_locks where id = $1", [lock.id]), [{ status: "expired" }]);
  const audit = await owner("select actor_type, source from audit_logs where resource = 'fx_lock' and action = 'expire' and resource_id = $1", [lock.id]);
  assert.deepEqual(audit, [{ actor_type: "system", source: "job" }]);
  assert.equal(api.logs().split("\n").filter((line) => line.includes('"event":"fx.lock_expired"') && line.includes(lock.id)).length, 1);
});

test("两边都锁定（JPY、CNY）时数据源停更超过 48 小时：JPY→CNY 照常报价；CNY 的锁定一到期，JPY→CNY 就暂停（CNY 又用回过期的数据源）", async () => {
  assert.equal(await freshBatch(), "accepted");
  const start = nowMs();
  const jpy = await lockApproved({ currency: "JPY", rate: "151.2", expires_at: new Date(start + 72 * HOUR).toISOString() });
  const cny = await lockApproved({ currency: "CNY", rate: "7.56", reason: "测试：两边都锁定", expires_at: new Date(start + 60 * HOUR).toISOString() });
  await moveTo(lastAsOf + 48 * HOUR + 60_000);
  assert.equal((await ok(api.call("GET", "/platform/v1/fx-rates", { token: m.root }))).state, "stale");
  const both = biz7A(await previewIn("CNY"));
  assert.ok(both, "两边都锁定，不看数据源是否过期");
  assert.deepEqual([both.fx.rate, both.fx.lock.uses_source, both.fx.lock.legs.map((leg: any) => leg.lock_id)], ["0.05", false, [jpy.id, cny.id]]);
  // 不涉及锁定的币种（JPY→KRW 的 KRW 用数据源）：暂停
  assert.ok(refusedFx(await previewIn("KRW")));
  await moveTo(Date.parse(cny.expires_at) - 1);
  assert.ok(biz7A(await previewIn("CNY")), "CNY 到期前 1 毫秒还能报");
  api.clock.advance(1);
  const after = await previewIn("CNY");
  assert.equal(biz7A(after), undefined);
  assert.ok(refusedFx(after));
  // 数据源恢复以后照常
  assert.equal(await freshBatch(), "accepted");
  assert.equal(biz7A(await previewIn("CNY")).fx.lock.uses_source, true);
  await releaseAll();
});

test("锁定期间挂起的一批（锁定币种变动超过 3%）被确认后：中央汇率换成新的，锁定的币种仍用锁定值，锁定记录不变", async () => {
  assert.equal(await freshBatch(), "accepted");
  const twd = await lockApproved({ currency: "TWD", rate: "32.1" });
  assert.equal(await freshBatch({ ...RATES, TWD: "34" }), "confirmed", "+6.25% 挂起后确认");
  const board = await ok(api.call("GET", "/platform/v1/fx-rates", { token: m.root }));
  assert.deepEqual(board.rates.find((item: any) => item.currency === "TWD"), { currency: "TWD", rate: "32.1", central_rate: "34", locked: true });
  assert.deepEqual(await owner("select status, rate::text as rate, central_rate::text as central from fx_locks where id = $1", [twd.id]), [{ status: "active", rate: "32.1", central: "32" }]);
  const candidate = biz7A(await previewIn("TWD"));
  assert.deepEqual([candidate.fx.rate, candidate.fx.lock.legs[0].lock_id], ["0.214", twd.id]);
  await releaseAll();
  assert.equal(await freshBatch(RATES), "confirmed");
});
