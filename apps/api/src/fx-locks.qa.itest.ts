/**
 * M2-06 测试角色补充（汇率人工锁定，ADR 0025），经真实接口、真实 PostgreSQL；数据源是本机的假服务器。
 * - 权限矩阵：每个平台角色、租户令牌、没有令牌，对看板 / 锁定记录 / 发起锁定 / 发起解锁 / 审核的结果；主数据运营的待审核队列看不到渠道的复核；
 * - 发起人不能自审：接口（超级管理员发起也不行）和数据库（approvals、fx_locks 两张表的约束）两层；
 * - 并发：同一条复核一人批准一人驳回、同一条锁定的解锁和改锁定值同时批准、不同币种同时批准、重复提交——都只有一个结果生效；
 * - 发起之后中央汇率变了不作废，批准时按那一刻的中央汇率重新核对偏离（超过 3% 要原因、超过 20% 拦截；挂起的一批确认后也一样）；
 * - 锁定值的精度：12 位小数原样进库、进看板、进报价，交叉汇率和独立的 BigInt 对照实现逐位一致；
 * - 数据源超时：锁定照常生效；租户接口不受锁定影响、不出现缓冲 / 加价 / 锁定。
 * 每个测试用自己的币种，不依赖别的测试的执行顺序；测试数据只在这里构造，结束时连同 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { type PlatformRole, sellPrice } from "@nozomi/domain";
import { type ApiResponse, TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { type FakeFxSource, fxSourceBody, startFakeFxSource } from "./testing/fx-source.ts";
import { type Market, DROPOFF, allKeys, buildMarket, newChannel, ok } from "./testing/market.ts";

let api: TestApi;
let source: FakeFxSource;
let m: Market;
const people: Partial<Record<PlatformRole | "master_data2", { id: string; token: string; email: string }>> = {};

const HOUR = 3_600_000;
const RATES = { JPY: "150", CNY: "7.2", KRW: "1400", HKD: "7.8", TWD: "32", THB: "36" };
let lastAsOf = 0;

const who = (key: PlatformRole | "master_data2"): { id: string; token: string; email: string } => {
  const person = people[key];
  assert.ok(person, key);
  return person;
};
const later = (ms: number): string => new Date(api.clock.now().getTime() + ms).toISOString();
const requestLock = (token: string, body: Record<string, unknown>): Promise<ApiResponse> => api.call("POST", "/platform/v1/fx-rates/locks", { token, body: { expires_at: later(24 * HOUR), ...body } });
const requestUnlock = (token: string, lockId: string): Promise<ApiResponse> => api.call("POST", `/platform/v1/fx-rates/locks/${lockId}/release`, { token, body: {} });
const decide = (token: string, id: string, decision: "approve" | "reject" | "withdraw"): Promise<ApiResponse> => api.call("POST", `/platform/v1/approvals/${id}/${decision}`, { token, body: {} });
const owner = async (sql: string, values: unknown[] = []): Promise<any[]> => (await api.db.owner.query(sql, values)).rows;
const overview = async (token = m.root): Promise<any> => ok(api.call("GET", "/platform/v1/fx-rates", { token }));
const previewIn = async (currency: string): Promise<any> =>
  ok(api.call("POST", "/platform/v1/quotes/preview", { token: m.root, body: { city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, currency, direction: "pickup", dropoff: DROPOFF, service_time: "2026-10-20T10:00", passengers: 2, luggage: 1 } }));
const biz7A = (body: any): any => body.groups.find((group: any) => group.vehicle_group_id === m.ids.biz7)?.candidates.find((candidate: any) => candidate.tenant_id === m.a.tenantId);

/** 数据源给一批新的（时间比上一批晚），手动拉取；变动超过 3% 挂起时由超级管理员确认。返回最终状态。 */
async function newBatch(rates: Record<string, string>): Promise<string> {
  lastAsOf = Math.max(lastAsOf + 1_000, api.clock.now().getTime() - 60_000);
  source.respond({ body: fxSourceBody({ asOf: new Date(lastAsOf), rates }) });
  const fetched = (await ok(api.call("POST", "/platform/v1/fx-rates/fetch", { token: m.root }))).fetch;
  if (fetched.status === "held") {
    await ok(api.call("POST", `/platform/v1/fx-rates/fetches/${fetched.id}/confirm`, { token: m.root, body: {} }));
    return "confirmed";
  }
  return fetched.status;
}

/** 主数据运营 1 发起、主数据运营 2 批准，返回生效的锁定（看板上的那一条）。 */
async function lockApproved(body: Record<string, unknown>): Promise<any> {
  const requested = await ok(requestLock(who("master_data").token, body), 202);
  await ok(decide(who("master_data2").token, requested.approval.id, "approve"));
  return (await overview()).locks.find((lock: any) => lock.lock_approval_id === requested.approval.id);
}

/** 对照实现：「1 USD = ?」的十进制字符串 → 1 from = ? to，12 位小数、0.5 远离零（只用 BigInt）。 */
function oracleCross(perUsd: Record<string, string>, from: string, to: string): string {
  const frac = (text: string): [bigint, bigint] => {
    const [w = "0", f = ""] = text.split(".");
    return [BigInt(w + f), 10n ** BigInt(f.length)];
  };
  const [fn, fd] = from === "USD" ? [1n, 1n] : frac(perUsd[from] as string);
  const [tn, td] = to === "USD" ? [1n, 1n] : frac(perUsd[to] as string);
  const n = tn * fd * 10n ** 12n;
  const d = td * fn;
  const q = n / d;
  const scaled = (n % d) * 2n >= d ? q + 1n : q;
  const s = scaled.toString().padStart(13, "0");
  const fraction = s.slice(-12).replace(/0+$/, "");
  return fraction === "" ? s.slice(0, -12) : `${s.slice(0, -12)}.${fraction}`;
}

async function addStaff(key: PlatformRole | "master_data2", role: PlatformRole): Promise<void> {
  const email = `qa-${key}@platform.test`;
  const invited = await ok(api.call("POST", "/platform/v1/staff", { token: m.root, body: { email, name: `测试${key}`, role } }), 201);
  await ok(api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
  const login = await ok(api.call("POST", "/platform/v1/auth/login", { body: { email, password: TEST_PASSWORD } }));
  people[key] = { id: invited.user.id, token: login.access_token, email };
}

before(async () => {
  source = await startFakeFxSource();
  api = await createTestApi({ env: { FX_SOURCE_URL: source.url, FX_AUTO_FETCH: "false" } });
  m = await buildMarket(api);
  const [root] = await owner("select id::text as id from platform_users where email = 'root@platform.test'");
  people.super_admin = { id: root.id, token: m.root, email: "root@platform.test" };
  people.master_data = { ...m.staff.masterData };
  people.channel_manager = { ...m.staff.cm1 };
  people.readonly = { ...m.staff.readonly };
  people.operations = { ...m.staff.operations };
  await addStaff("master_data2", "master_data");
  for (const role of ["tenant_onboarding", "customer_service", "finance", "risk", "tech"] as const) await addStaff(role, role);
  assert.equal(await newBatch(RATES), "accepted");
});
after(async () => {
  await api.close();
  await source.close();
});

const ALL_ROLES: PlatformRole[] = ["super_admin", "operations", "tenant_onboarding", "channel_manager", "customer_service", "finance", "risk", "master_data", "tech", "readonly"];
const CAN_MANAGE = new Set<PlatformRole>(["super_admin", "master_data"]);

test("权限矩阵：每个平台角色都能看锁定状态和记录；只有主数据运营、超级管理员能发起锁定 / 解锁和审核；租户令牌、没有令牌一律 401；被拒的请求不留任何复核", async () => {
  const twd = await lockApproved({ currency: "TWD", rate: "32.1" });
  assert.ok(twd, "TWD 锁定生效");
  const pending = (await ok(requestLock(who("master_data").token, { currency: "TWD", rate: "32.2" }), 202)).approval;
  const before = (await owner("select count(*)::int as n from approvals"))[0].n;
  for (const role of ALL_ROLES) {
    const token = who(role).token;
    const board = await api.call("GET", "/platform/v1/fx-rates", { token });
    assert.equal(board.status, 200, `${role} 看板`);
    assert.ok(board.body.locks.some((lock: any) => lock.id === twd.id), `${role} 看得到生效中的锁定`);
    assert.ok(board.body.pending_locks.some((item: any) => item.id === pending.id), `${role} 看得到待审核的申请`);
    assert.equal((await api.call("GET", "/platform/v1/fx-rates/locks", { token })).status, 200, `${role} 锁定记录`);
    // 待审核队列里都看得到（每个角色都有 approval.read 和 master_data.read）
    const queue = await ok(api.call("GET", "/platform/v1/approvals", { token }));
    assert.ok(queue.items.some((item: any) => item.id === pending.id), `${role} 队列`);
    const detail = await ok(api.call("GET", `/platform/v1/approvals/${pending.id}`, { token }));
    const reviewer = CAN_MANAGE.has(role);
    assert.deepEqual(detail.approval.can, { approve: reviewer && role !== "master_data", reject: reviewer && role !== "master_data", withdraw: role === "master_data" }, `${role} 的按钮`);
    if (!CAN_MANAGE.has(role)) {
      for (const res of [await requestLock(token, { currency: "TWD", rate: "32.3" }), await requestUnlock(token, twd.id)]) {
        assert.deepEqual([res.status, res.body.error.details.required], [403, "fx.manage"], `${role} 发起`);
      }
      for (const decision of ["approve", "reject"] as const) {
        const res = await decide(token, pending.id, decision);
        assert.deepEqual([res.status, res.body.error.details.required], [403, "fx.review"], `${role} ${decision}`);
      }
      const withdraw = await decide(token, pending.id, "withdraw");
      assert.deepEqual([withdraw.status, withdraw.body.error.code], [409, "APPROVAL_NOT_REQUESTER"], `${role} 撤回别人的`);
    }
  }
  // 租户令牌（租户 A、B 的管理员）、没有令牌、乱写的令牌：平台的锁定接口一律 401
  for (const token of [m.a.adminToken, m.b.adminToken, undefined, "not-a-token"]) {
    const calls: Promise<ApiResponse>[] = [
      api.call("GET", "/platform/v1/fx-rates", token === undefined ? {} : { token }),
      api.call("GET", "/platform/v1/fx-rates/locks", token === undefined ? {} : { token }),
      api.call("POST", "/platform/v1/fx-rates/locks", { ...(token === undefined ? {} : { token }), body: { currency: "TWD", rate: "32.3", expires_at: later(HOUR) } }),
      api.call("POST", `/platform/v1/fx-rates/locks/${twd.id}/release`, { ...(token === undefined ? {} : { token }), body: {} }),
      api.call("POST", `/platform/v1/approvals/${pending.id}/approve`, { ...(token === undefined ? {} : { token }), body: {} }),
    ];
    for (const res of await Promise.all(calls)) assert.equal(res.status, 401, `${String(token).slice(0, 12)} ${res.text}`);
  }
  assert.equal((await owner("select count(*)::int as n from approvals"))[0].n, before, "被拒的请求一条复核都没留下");
  assert.equal((await ok(api.call("GET", `/platform/v1/approvals/${pending.id}`, { token: m.root }))).approval.status, "pending");
  // 收尾：撤回待审核的那条
  await ok(decide(who("master_data").token, pending.id, "withdraw"));
});

test("主数据运营的待审核队列只有汇率锁定这两类：看不到、审不了渠道的复核（404，不是 403）", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "QA 队列隔离渠道" });
  const pricing = (await ok(api.call("POST", `/platform/v1/channels/${channel.id}/pricing-changes`, { token: m.staff.cm1.token, body: { default_markup_bp: 1_250 } }), 202)).approval;
  for (const key of ["master_data", "master_data2"] as const) {
    const token = who(key).token;
    const queue = await ok(api.call("GET", "/platform/v1/approvals?status=all&limit=100", { token }));
    assert.ok(queue.items.every((item: any) => item.kind.startsWith("fx_lock.")), JSON.stringify(queue.items.map((item: any) => item.kind)));
    assert.equal((await api.call("GET", `/platform/v1/approvals/${pricing.id}`, { token })).status, 404);
    for (const decision of ["approve", "reject", "withdraw"] as const) assert.equal((await decide(token, pricing.id, decision)).status, 404, decision);
  }
  // 渠道经理能看到汇率锁定的申请，但审不了（403 fx.review）——见权限矩阵；这里确认渠道的那条没被动过
  assert.equal((await ok(api.call("GET", `/platform/v1/approvals/${pricing.id}`, { token: m.root }))).approval.status, "pending");
  await ok(decide(m.staff.cm1.token, pricing.id, "withdraw"));
});

test("发起人不能自审：超级管理员自己发起的也批不了、驳不了；数据库两层约束——复核记录的审核人、锁定的批准人都不能是发起人", async () => {
  const mine = (await ok(requestLock(m.root, { currency: "HKD", rate: "7.81" }), 202)).approval;
  for (const decision of ["approve", "reject"] as const) {
    const res = await decide(m.root, mine.id, decision);
    assert.deepEqual([res.status, res.body.error.code], [409, "APPROVAL_SELF_REVIEW"], decision);
  }
  // 数据库层：绕过接口直接把复核记成「发起人自己批准」
  await assert.rejects(
    api.db.owner.query("update approvals set status = 'approved', decided_by = requested_by, decided_at = now() where id = $1", [mine.id]),
    (err: any) => err.code === "23514" && /approvals_two_people/.test(err.constraint ?? err.message),
  );
  // 主数据运营批准后生效；再绕过接口把锁定的批准人改成发起人
  await ok(decide(who("master_data").token, mine.id, "approve"));
  const [lock] = await owner("select id::text as id from fx_locks where lock_approval_id = $1", [mine.id]);
  await assert.rejects(api.db.owner.query("update fx_locks set approved_by = requested_by where id = $1", [lock.id]), (err: any) => err.code === "23514" && /fx_locks_two_people/.test(err.constraint ?? err.message));
  const [stored] = await owner("select requested_by::text as r, approved_by::text as a from fx_locks where id = $1", [lock.id]);
  assert.deepEqual(stored, { r: who("super_admin").id, a: who("master_data").id });
  // 收尾：解锁（另一个人批准）
  const release = (await ok(requestUnlock(who("master_data").token, lock.id), 202)).approval;
  await ok(decide(m.root, release.id, "approve"));
});

test("并发：同一条复核一人批准、一人同时驳回，只有一个结论；锁定是否生效和结论一致", async () => {
  for (let round = 0; round < 3; round += 1) {
    const pending = (await ok(requestLock(who("master_data").token, { currency: "THB", rate: `36.${round + 1}` }), 202)).approval;
    const [approve, reject] = await Promise.all([decide(who("master_data2").token, pending.id, "approve"), decide(m.root, pending.id, "reject")]);
    assert.deepEqual([approve.status, reject.status].sort(), [200, 409], `${approve.text} ${reject.text}`);
    const loser = approve.status === 409 ? approve : reject;
    assert.equal(loser.body.error.code, "APPROVAL_NOT_PENDING");
    const [row] = await owner("select status from approvals where id = $1", [pending.id]);
    const locks = await owner("select count(*)::int as n from fx_locks where lock_approval_id = $1", [pending.id]);
    assert.equal(row.status, approve.status === 200 ? "approved" : "rejected");
    assert.equal(locks[0].n, approve.status === 200 ? 1 : 0);
  }
  assert.ok((await owner("select count(*)::int as n from fx_locks where currency = 'THB' and status = 'active'"))[0].n <= 1);
});

test("并发：同一条锁定的「解锁」和「改锁定值」同时批准，只有一个生效、另一个 APPROVAL_STALE；不同币种同时批准都成功", async () => {
  const krw = await lockApproved({ currency: "KRW", rate: "1401" });
  const release = (await ok(requestUnlock(who("master_data").token, krw.id), 202)).approval;
  const change = (await ok(requestLock(who("master_data").token, { currency: "KRW", rate: "1402" }), 202)).approval;
  assert.equal(change.payload.replaces_lock_id, krw.id);
  const results = await Promise.all([decide(who("master_data2").token, release.id, "approve"), decide(m.root, change.id, "approve")]);
  assert.deepEqual(results.map((res) => res.status).sort(), [200, 409], results.map((res) => res.text).join(" | "));
  const loser = results.find((res) => res.status === 409) as ApiResponse;
  assert.equal(loser.body.error.code, "APPROVAL_STALE");
  const active = await owner("select rate::text as rate from fx_locks where currency = 'KRW' and status = 'active'");
  const [old] = await owner("select status from fx_locks where id = $1", [krw.id]);
  if (results[0]?.status === 200) assert.deepEqual([old.status, active], ["released", []]);
  else assert.deepEqual([old.status, active], ["replaced", [{ rate: "1402" }]]);
  // 先批准的改锁定值之后，再批准解锁旧的那条：仍是 APPROVAL_STALE（锁定状态变了）
  const loserId = results[0]?.status === 409 ? release.id : change.id;
  await ok(decide(who("master_data2").token, loserId, "reject"));
  // 收尾：KRW 不留锁定
  const left = await owner("select id::text as id from fx_locks where currency = 'KRW' and status = 'active'");
  for (const row of left) await ok(decide(m.root, (await ok(requestUnlock(who("master_data").token, row.id), 202)).approval.id, "approve"));
  // 不同币种的两条同时批准：咨询锁只是排队，两条都生效
  const a = (await ok(requestLock(who("master_data").token, { currency: "KRW", rate: "1403" }), 202)).approval;
  const b = (await ok(requestLock(who("master_data2").token, { currency: "HKD", rate: "7.82" }), 202)).approval;
  const both = await Promise.all([decide(who("master_data2").token, a.id, "approve"), decide(who("master_data").token, b.id, "approve")]);
  assert.deepEqual(both.map((res) => res.status), [200, 200], both.map((res) => res.text).join(" | "));
  for (const row of await owner("select id::text as id from fx_locks where currency in ('KRW', 'HKD') and status = 'active'")) {
    await ok(decide(m.root, (await ok(requestUnlock(who("master_data").token, row.id), 202)).approval.id, "approve"));
  }
});

test("重复提交（连点两下）：同样的锁定申请两条都进队列，但只能有一条生效——第二条批准时 APPROVAL_STALE", async () => {
  const body = { currency: "TWD", rate: "32.05", expires_at: later(10 * HOUR) };
  const [first, second] = await Promise.all([requestLock(who("master_data").token, body), requestLock(who("master_data").token, body)]);
  assert.deepEqual([first.status, second.status], [202, 202]);
  const live = (await owner("select id::text as id from fx_locks where currency = 'TWD' and status = 'active'"))[0]?.id ?? null;
  assert.equal(first.body.approval.payload.replaces_lock_id, live);
  await ok(decide(who("master_data2").token, first.body.approval.id, "approve"));
  const dup = await decide(who("master_data2").token, second.body.approval.id, "approve");
  assert.deepEqual([dup.status, dup.body.error.code], [409, "APPROVAL_STALE"]);
  assert.equal((await owner("select count(*)::int as n from fx_locks where currency = 'TWD' and status = 'active'"))[0].n, 1);
  await ok(decide(who("master_data2").token, second.body.approval.id, "reject"));
});

test("发起之后中央汇率变了不作废：批准时按那一刻的中央汇率重新核对——偏离变到 3% 以上要原因、20% 以上拦截（挂起的一批确认后也一样）；偏离变小的照常生效，记的是批准时的中央汇率", async () => {
  // 发起：7.2 → 7.4（+2.78%），不用写原因
  const noReason = (await ok(requestLock(who("master_data").token, { currency: "CNY", rate: "7.4" }), 202)).approval;
  assert.deepEqual([noReason.payload.central_rate, noReason.payload.deviation_bp], ["7.2", 278]);
  // 数据源新的一批：CNY 7.15（-0.69%，直接生效）→ 偏离 +3.50%
  assert.equal(await newBatch({ ...RATES, CNY: "7.15" }), "accepted");
  const needsReason = await decide(who("master_data2").token, noReason.id, "approve");
  assert.deepEqual([needsReason.status, needsReason.body.error.details.issues.map((issue: any) => [issue.reason, issue.detail.change_bp, issue.detail.central_rate])], [400, [["REASON_REQUIRED", 350, "7.15"]]], needsReason.text);
  assert.equal((await ok(api.call("GET", `/platform/v1/approvals/${noReason.id}`, { token: m.root }))).approval.status, "pending", "没生效，仍是待审核");
  await ok(decide(who("master_data2").token, noReason.id, "reject"));
  // 带原因发起 7.4（相对 7.15 是 +3.50%）；数据源大跌到 6.1（-14.7%，挂起后人工确认）→ 偏离 +21.3%，拦截
  const withReason = (await ok(requestLock(who("master_data").token, { currency: "CNY", rate: "7.4", reason: "按银行牌价" }), 202)).approval;
  assert.equal(await newBatch({ ...RATES, CNY: "6.1" }), "confirmed");
  const tooFar = await decide(who("master_data2").token, withReason.id, "approve");
  assert.deepEqual([tooFar.status, tooFar.body.error.details.issues.map((issue: any) => issue.reason)], [400, ["DEVIATION_TOO_LARGE"]], tooFar.text);
  // 数据源回到 7.3（+19.7%，挂起后确认）→ 偏离 +1.37%：照常生效；锁定记录里是批准时的中央汇率和偏离
  assert.equal(await newBatch({ ...RATES, CNY: "7.3" }), "confirmed");
  await ok(decide(who("master_data2").token, withReason.id, "approve"));
  const [lock] = await owner("select id::text as id, rate::text as rate, central_rate::text as central, deviation_bp from fx_locks where lock_approval_id = $1", [withReason.id]);
  assert.deepEqual([lock.rate, lock.central, lock.deviation_bp], ["7.4", "7.3", 137]);
  const [audit] = await owner("select after from audit_logs where resource = 'fx_lock' and action = 'lock' and resource_id = $1", [lock.id]);
  assert.deepEqual([audit.after.central_rate, audit.after.deviation_bp], ["7.3", 137]);
  // 锁定期间再来一批（CNY 7.25）：数据源照常入库，看板的中央汇率跟着变，CNY 仍用锁定值
  assert.equal(await newBatch({ ...RATES, CNY: "7.25" }), "accepted");
  const board = await overview();
  assert.deepEqual(board.rates.find((item: any) => item.currency === "CNY"), { currency: "CNY", rate: "7.4", central_rate: "7.25", locked: true });
  assert.equal((await owner("select rate::text as rate from fx_locks where id = $1", [lock.id]))[0].rate, "7.4", "锁定值没被数据源覆盖");
  // 收尾：解锁，数据源回到 7.2
  await ok(decide(m.root, (await ok(requestUnlock(who("master_data").token, lock.id), 202)).approval.id, "approve"));
  assert.equal(await newBatch(RATES), "accepted");
});

test("锁定值的精度：12 位小数原样进库、进看板、进报价；JPY→KRW（KRW 锁定，另一边用数据源）和对照实现逐位一致，对外价按它算；写法不对的一律 400", async () => {
  for (const rate of ["1400.1234567890123", "1400.12 ", "1,400.1", "1.4001e3", "+1400", "１４００"]) {
    const res = await requestLock(who("master_data").token, { currency: "KRW", rate });
    assert.deepEqual([res.status, res.body.error.details.issues?.[0]?.reason], [400, "INVALID_RATE"], JSON.stringify(rate));
  }
  for (const rate of [1400.1, null, true, ["1400"]]) assert.equal((await requestLock(who("master_data").token, { currency: "KRW", rate })).status, 400, JSON.stringify(rate));
  const lock = await lockApproved({ currency: "KRW", rate: "0001400.123456789012000" });
  assert.equal(lock.rate, "1400.123456789012");
  assert.equal((await owner("select rate::text as rate from fx_locks where id = $1", [lock.id]))[0].rate, "1400.123456789012");
  const board = await overview();
  assert.deepEqual(board.rates.find((item: any) => item.currency === "KRW"), { currency: "KRW", rate: "1400.123456789012", central_rate: "1400", locked: true });
  // 对照的输入：各币种的中央汇率，再换上看板上生效中的锁定值（别的测试可能留着别的币种的锁定）
  const effective: Record<string, string> = Object.fromEntries(board.rates.filter((item: any) => item.currency !== "USD").map((item: any) => [item.currency, item.central_rate]));
  for (const active of board.locks) effective[active.currency] = active.rate;
  assert.equal(effective["KRW"], "1400.123456789012");
  for (const item of board.cross.filter((entry: any) => entry.from === "KRW" || entry.to === "KRW")) {
    assert.equal(item.rate, oracleCross(effective, item.from, item.to), `${item.from}→${item.to}`);
    assert.equal(item.locked, true);
  }
  const candidate = biz7A(await previewIn("KRW"));
  assert.deepEqual(candidate.fx.lock, { legs: [{ currency: "KRW", rate: "1400.123456789012", lock_id: lock.id, expires_at: lock.expires_at }], uses_source: true });
  assert.equal(candidate.fx.rate, oracleCross(effective, "JPY", "KRW"));
  const expected = sellPrice({ settlementMinor: 20_000, settlementCurrency: "JPY", currency: "KRW", markupBp: candidate.markup_bp, fx: { from: "JPY", to: "KRW", rate: oracleCross(effective, "JPY", "KRW"), asOf: candidate.fx.as_of } });
  assert.ok("sellMinor" in expected);
  assert.equal(candidate.sell, expected.sellMinor);
  // 收尾
  await ok(decide(m.root, (await ok(requestUnlock(who("master_data").token, lock.id), 202)).approval.id, "approve"));
  assert.equal(biz7A(await previewIn("KRW")).fx.lock, null, "解锁批准后立即恢复用中央汇率（缓存已作废）");
});

test("到期时间的时区写法：+09:00 和 Z 是同一时刻；正好 30 分钟、正好 72 小时可以发起，差 1 毫秒不行", async () => {
  const now = api.clock.now().getTime();
  const tokyo = (ms: number): string => {
    const d = new Date(ms + 9 * HOUR);
    return `${d.toISOString().slice(0, 23)}+09:00`;
  };
  const issues = async (expires: string): Promise<string[]> => {
    const res = await requestLock(who("master_data").token, { currency: "THB", rate: "36.05", expires_at: expires });
    if (res.status === 202) {
      await ok(decide(who("master_data").token, res.body.approval.id, "withdraw"));
      assert.equal(new Date(res.body.approval.payload.expires_at).getTime(), new Date(expires).getTime(), "存的是同一时刻");
      return [];
    }
    return res.body.error.details.issues.map((issue: any) => issue.reason);
  };
  assert.deepEqual(await issues(tokyo(now + 30 * 60_000)), []);
  assert.deepEqual(await issues(tokyo(now + 30 * 60_000 - 1)), ["EXPIRES_TOO_SOON"]);
  assert.deepEqual(await issues(tokyo(now + 72 * HOUR)), []);
  // 「最长 72 小时」另外容许 5 分钟钟差（M2-06 测试发现：浏览器时钟比服务器快时选「72 小时」被拒）
  assert.deepEqual(await issues(tokyo(now + 72 * HOUR + 5 * 60_000 + 1)), ["EXPIRES_TOO_LATE"]);
  assert.deepEqual(await issues(new Date(now + 72 * HOUR + 5 * 60_000 + 1).toISOString()), ["EXPIRES_TOO_LATE"]);
  // 不带时区的时间不收（含义不明）
  assert.equal((await requestLock(who("master_data").token, { currency: "THB", rate: "36.05", expires_at: "2026-10-08T10:00:00" })).status, 400);
});

test("数据源超时：手动拉取失败（FX_SOURCE_TIMEOUT），锁定照常用于报价；租户的汇率接口不受锁定影响，也没有缓冲、加价、锁定字段", async () => {
  const hkd = await lockApproved({ currency: "HKD", rate: "7.83" });
  source.respond({ body: fxSourceBody({ asOf: new Date(api.clock.now().getTime()), rates: RATES }), delayMs: 9_500 });
  const fetched = (await ok(api.call("POST", "/platform/v1/fx-rates/fetch", { token: m.root }))).fetch;
  assert.deepEqual([fetched.status, fetched.error_code], ["failed", "FX_SOURCE_TIMEOUT"]);
  const candidate = biz7A(await previewIn("HKD"));
  assert.deepEqual([candidate.fx.lock.legs[0].lock_id, candidate.fx.rate], [hkd.id, oracleCross({ ...RATES, HKD: "7.83" }, "JPY", "HKD")]);
  for (const tenant of [m.a, m.b]) {
    for (const base of ["USD", "HKD"]) {
      const res = await ok(api.call("GET", `/tenant/v1/fx-rates?base=${base}`, { token: tenant.adminToken }));
      const keys = allKeys(res);
      for (const key of ["lock", "locks", "locked", "central_rate", "fx_buffer_bp", "buffer_bp", "markup_bp", "markup", "pending_locks", "reason"]) assert.ok(!keys.has(key), `${base} ${key}`);
      if (base === "USD") assert.equal(res.rates.find((item: any) => item.currency === "HKD").rate, "7.8", "租户看到的是中央汇率");
      else assert.equal(res.rates.find((item: any) => item.currency === "USD").rate, oracleCross(RATES, "HKD", "USD"));
    }
  }
  assert.deepEqual(await owner("select has_table_privilege('nozomi_app', 'approvals', 'select') as s"), [{ s: false }], "租户角色读不到复核记录（里面有锁定值和原因）");
  await ok(decide(m.root, (await ok(requestUnlock(who("master_data").token, hkd.id), 202)).approval.id, "approve"));
});
