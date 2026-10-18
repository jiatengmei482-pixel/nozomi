/**
 * M2-06：汇率人工锁定（双人复核，ADR 0025），经真实接口、真实 PostgreSQL；数据源是本机的假服务器。
 * - 发起：校验（基准币种、写法、到期时间、偏离超过 3% 要原因、超过 20% 拦截），202 待审核，不生效；没有 fx.manage 的不能发起；
 * - 审核：发起人不能自审，没有 fx.review 的不能审，另一位主数据运营批准后生效；同时批准只成功一个；
 * - 锁定期间：报价用锁定值、快照（预览候选、`quotes.snapshot`）里带 `lock`；数据源新批次照常入库但不用于这个币种；数据源停更 48 小时不暂停锁定的币种；
 * - 到期：那一刻起不再用；定时任务记为到期、写审计；解锁、换锁定值同样双人复核；锁定状态变了的复核批准时 APPROVAL_STALE；
 * - 租户的汇率接口不受锁定影响、没有锁定字段，租户角色对锁定表没有任何权限；全部操作留审计；每个应答都和 openapi.yaml 对账。
 * 测试数据只在这里构造，结束时连同 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type FxTable, fxQuoteWithLocks, sellPrice } from "@nozomi/domain";
import { type ApiResponse, type HttpMethod, TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { type FakeFxSource, fxSourceBody, startFakeFxSource } from "./testing/fx-source.ts";
import { type Market, DROPOFF, SERVICE_TIME, allKeys, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";

let api: TestApi;
let source: FakeFxSource;
let m: Market;
let md2: { id: string; token: string; email: string };

const HOUR = 3_600_000;
const RATES = { JPY: "150", CNY: "7.2", KRW: "1400", HKD: "7.8", TWD: "32", THB: "36" };
/** 数据源第一批的时间：测试时钟起点（2026-10-07T01:00Z）之前 1 小时 */
const T0 = new Date("2026-10-07T00:00:00.000Z");

/** 调一次接口，并和 openapi.yaml 对账。`template` 是定义里的路径写法。 */
async function call(method: HttpMethod, template: string, options: { token: string; id?: string; query?: string; body?: unknown }): Promise<ApiResponse> {
  const url = template.replace("{id}", options.id ?? "") + (options.query ? `?${options.query}` : "");
  const res = await api.call(method, url, { token: options.token, ...(options.body === undefined ? {} : { body: options.body }) });
  assertMatchesOpenApi(method, template, res);
  return res;
}
const later = (ms: number): string => new Date(api.clock.now().getTime() + ms).toISOString();
const requestLock = (token: string, body: Record<string, unknown>): Promise<ApiResponse> => call("POST", "/platform/v1/fx-rates/locks", { token, body: { currency: "JPY", rate: "151.2", expires_at: later(24 * HOUR), ...body } });
const requestUnlock = (token: string, lockId: string, reason: string | null = null): Promise<ApiResponse> => call("POST", "/platform/v1/fx-rates/locks/{id}/release", { token, id: lockId, body: { reason } });
const decide = (token: string, id: string, decision: "approve" | "reject" | "withdraw", note: string | null = null): Promise<ApiResponse> => call("POST", `/platform/v1/approvals/{id}/${decision}`, { token, id, body: { note } });
const overview = async (token = m.root, query = ""): Promise<any> => ok(call("GET", "/platform/v1/fx-rates", { token, query }));
const previewIn = async (currency: string): Promise<any> =>
  ok(api.call("POST", "/platform/v1/quotes/preview", { token: m.root, body: { city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, currency, direction: "pickup", dropoff: DROPOFF, service_time: "2026-10-20T10:00", passengers: 2, luggage: 1 } }));
const biz7Candidate = (body: any): any => body.groups.find((group: any) => group.vehicle_group_id === m.ids.biz7)?.candidates.find((candidate: any) => candidate.tenant_id === m.a.tenantId);
const owner = async (sql: string, values: unknown[] = []): Promise<any[]> => (await api.db.owner.query(sql, values)).rows;
const serve = (asOf: Date, rates: Record<string, string> = RATES): void => source.respond({ body: fxSourceBody({ asOf, rates }) });

async function login(email: string): Promise<string> {
  return (await ok(api.call("POST", "/platform/v1/auth/login", { body: { email, password: TEST_PASSWORD } }))).access_token;
}
/** 时钟拨过登录令牌的有效期以后，平台员工重新登录 */
async function advance(ms: number): Promise<void> {
  api.clock.advance(ms);
  m.root = await login("root@platform.test");
  for (const key of Object.keys(m.staff) as (keyof Market["staff"])[]) m.staff[key] = { ...m.staff[key], token: await login(m.staff[key].email) };
  md2 = { ...md2, token: await login(md2.email) };
  m.a = { ...m.a, adminToken: (await ok(api.call("POST", "/tenant/v1/auth/login", { body: { email: m.a.adminEmail, password: TEST_PASSWORD } }))).access_token };
}

/** 主数据运营 1 发起、主数据运营 2 批准，返回生效的锁定。 */
async function lockApproved(body: Record<string, unknown>): Promise<any> {
  const requested = await ok(requestLock(m.staff.masterData.token, body), 202);
  await ok(decide(md2.token, requested.approval.id, "approve"));
  const board = await overview();
  return board.locks.find((lock: any) => lock.lock_approval_id === requested.approval.id);
}

before(async () => {
  source = await startFakeFxSource();
  api = await createTestApi({ env: { FX_SOURCE_URL: source.url, FX_AUTO_FETCH: "true" } });
  m = await buildMarket(api);
  const invited = await ok(api.call("POST", "/platform/v1/staff", { token: m.root, body: { email: "md2@platform.test", name: "主数据二", role: "master_data" } }), 201);
  await ok(api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
  md2 = { id: invited.user.id, token: await login("md2@platform.test"), email: "md2@platform.test" };
  serve(T0);
  assert.equal((await ok(api.call("POST", "/platform/v1/fx-rates/fetch", { token: m.root }))).fetch.status, "accepted");
});
after(async () => {
  await api.close();
  await source.close();
});

test("发起锁定：只认十进制字符串、不能锁 USD、到期时间 30 分钟到 72 小时、偏离超过 3% 要写原因、超过 20% 拦截；没有 fx.manage 的不能发起；没有预置任何锁定", async () => {
  assert.deepEqual(await owner("select count(*)::int as n from fx_locks"), [{ n: 0 }]);
  const issues = async (body: Record<string, unknown>): Promise<string[]> => {
    const res = await requestLock(m.staff.masterData.token, body);
    assert.equal(res.status, 400, res.text);
    return res.body.error.details.issues.map((issue: any) => issue.reason ?? issue.path);
  };
  assert.deepEqual(await issues({ currency: "USD", rate: "1" }), ["BASE_CURRENCY"]);
  assert.deepEqual(await issues({ rate: "1.5e2" }), ["INVALID_RATE"]);
  assert.deepEqual(await issues({ rate: "-151" }), ["INVALID_RATE"]);
  assert.deepEqual(await issues({ rate: "0" }), ["INVALID_RATE"]);
  assert.deepEqual(await issues({ rate: "1,512" }), ["INVALID_RATE"]);
  // JSON 数字：解析时已经是浮点数了，不收
  assert.equal((await requestLock(m.staff.masterData.token, { rate: 151.2 })).status, 400);
  assert.deepEqual(await issues({ expires_at: later(29 * 60_000) }), ["EXPIRES_TOO_SOON"]);
  assert.deepEqual(await issues({ expires_at: later(72 * HOUR + 1_000) }), ["EXPIRES_TOO_LATE"]);
  const deviation = await requestLock(m.staff.masterData.token, { rate: "160" });
  assert.deepEqual(deviation.body.error.details.issues, [{ path: "/reason", reason: "REASON_REQUIRED", message: deviation.body.error.details.issues[0].message, detail: { change_bp: 667, central_rate: "150", reason_above_bp: 300 } }]);
  assert.deepEqual(await issues({ rate: "1500", reason: "数量级写错" }), ["DEVIATION_TOO_LARGE"]);
  // 不认识的字段（如想从请求里带审核人）一律 400
  assert.equal((await requestLock(m.staff.masterData.token, { approved_by: md2.id })).status, 400);
  for (const token of [m.staff.readonly.token, m.staff.cm1.token, m.staff.operations.token]) {
    const denied = await requestLock(token, {});
    assert.deepEqual([denied.status, denied.body.error.details.required], [403, "fx.manage"]);
  }
  assert.deepEqual(await owner("select count(*)::int as n from approvals"), [{ n: 0 }], "被拦下的都没有进队列");
});

test("一人提交、另一人批准后生效：发起人不能自审，没有 fx.review 的不能审；锁定期间报价用锁定值，预览候选和正式报价的快照里都写明是锁定汇率；全部留审计", async () => {
  const expiresAt = later(72 * HOUR);
  const requested = await requestLock(m.staff.masterData.token, { rate: "151.20", expires_at: expiresAt, reason: "行情剧烈波动，按银行牌价锁定" });
  assert.equal(requested.status, 202, requested.text);
  const approval = requested.body.approval;
  assert.deepEqual(
    [approval.kind, approval.resource, approval.resource_id, approval.status, approval.payload.rate, approval.payload.central_rate, approval.payload.deviation_bp, approval.payload.replaces_lock_id, approval.request_note, approval.can],
    ["fx_lock.create", "fx_lock", "JPY", "pending", "151.2", "150", 80, null, "行情剧烈波动，按银行牌价锁定", { approve: false, reject: false, withdraw: true }],
  );
  // 待审核时不生效：看板上是待审核的一条，报价照常用中央汇率
  const pending = await overview();
  assert.deepEqual([pending.locks, pending.pending_locks.map((item: any) => item.id), pending.rates.find((item: any) => item.currency === "JPY")], [[], [approval.id], { currency: "JPY", rate: "150", central_rate: "150", locked: false }]);
  assert.equal(biz7Candidate(await previewIn("USD")).fx.lock, null);
  // 发起人不能批准、驳回自己发起的
  for (const decision of ["approve", "reject"] as const) {
    const self = await decide(m.staff.masterData.token, approval.id, decision);
    assert.deepEqual([self.status, self.body.error.code], [409, "APPROVAL_SELF_REVIEW"], decision);
  }
  // 渠道经理、只读、运营能在队列里看到，但没有 fx.review，不能审
  const queue = await ok(call("GET", "/platform/v1/approvals", { token: m.staff.readonly.token }));
  assert.deepEqual(queue.items.map((item: any) => [item.kind, item.can]), [["fx_lock.create", { approve: false, reject: false, withdraw: false }]]);
  for (const token of [m.staff.cm1.token, m.staff.readonly.token, m.staff.operations.token]) {
    const denied = await decide(token, approval.id, "approve");
    assert.deepEqual([denied.status, denied.body.error.details.required], [403, "fx.review"]);
  }
  // 另一位主数据运营看得到批准按钮，批准后立即生效（本进程的汇率缓存随之作废）
  assert.deepEqual((await ok(call("GET", "/platform/v1/approvals/{id}", { token: md2.token, id: approval.id }))).approval.can, { approve: true, reject: true, withdraw: false });
  const approved = await ok(decide(md2.token, approval.id, "approve", "核对过银行牌价"));
  assert.deepEqual([approved.approval.status, approved.approval.decided_by.email], ["approved", "md2@platform.test"]);
  const board = await overview();
  const lock = board.locks[0];
  assert.deepEqual(
    [board.locks.length, lock.currency, lock.rate, lock.expires_at, lock.central_rate, lock.deviation_bp, lock.requested_by.email, lock.approved_by.email, lock.status, lock.reason, lock.lock_approval_id],
    [1, "JPY", "151.2", expiresAt, "150", 80, "md@platform.test", "md2@platform.test", "active", "行情剧烈波动，按银行牌价锁定", approval.id],
  );
  assert.deepEqual(board.rates.find((item: any) => item.currency === "JPY"), { currency: "JPY", rate: "151.2", central_rate: "150", locked: true });
  assert.deepEqual(board.cross.find((item: any) => item.from === "CNY" && item.to === "JPY"), { from: "CNY", to: "JPY", rate: "21", locked: true });
  assert.deepEqual(board.cross.find((item: any) => item.from === "CNY" && item.to === "KRW"), { from: "CNY", to: "KRW", rate: "194.444444444444", locked: false }, "不涉及锁定币种的照旧");
  assert.deepEqual(board.pending_locks, []);
  // 报价：日元商品换成美元，用的是锁定值，快照里写明是锁定的
  const candidate = biz7Candidate(await previewIn("USD"));
  assert.deepEqual(candidate.fx, { from: "JPY", to: "USD", rate: "0.006613756614", as_of: T0.toISOString(), lock: { legs: [{ currency: "JPY", rate: "151.2", lock_id: lock.id, expires_at: expiresAt }], uses_source: false } });
  const table: FxTable = { base: "USD", asOf: T0.toISOString(), rates: RATES };
  const expected = sellPrice({ settlementMinor: 20_000, settlementCurrency: "JPY", currency: "USD", markupBp: candidate.markup_bp, fx: fxQuoteWithLocks(table, [{ id: lock.id, currency: "JPY", rate: "151.2", expiresAt }], "JPY", "USD", api.clock.now()) });
  assert.ok("sellMinor" in expected);
  assert.equal(candidate.sell, expected.sellMinor);
  // 正式询价（销售端）：quotes 表里存的快照同样带着锁定
  const channel = await newChannel(api, m.staff.cm1.token, { name: "锁定汇率测试渠道" });
  const credentials = await salesCredentials(api, m, channel.id);
  api.clock.advance(1_000);
  const quoted = await ok(api.call("POST", "/sales/v1/quotes", { token: credentials.token, body: { city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, direction: "pickup", dropoff: DROPOFF, service_time: SERVICE_TIME, passengers: 2, luggage: 1, currency: "USD" } }));
  assert.ok(quoted.quotes.length > 0);
  const [row] = await owner("select snapshot from quotes where id = $1", [quoted.quotes[0].quote_id]);
  const winnerFx = row.snapshot.winner.sell.fx;
  assert.deepEqual([winnerFx.rate, winnerFx.lock.legs[0].currency, winnerFx.lock.legs[0].rate, winnerFx.lock.legs[0].lockId], ["0.006613756614", "JPY", "151.2", lock.id]);
  assert.ok(!allKeys(quoted).has("lock"), "销售端的应答不暴露锁定的细节（中央汇率和取数时间照旧）");
  // 审计：复核的发起、批准，锁定生效（操作者是批准人，带复核编号和发起人）
  const audit = await owner("select resource, action, actor_email, after from audit_logs where resource in ('approval', 'fx_lock') order by id");
  assert.deepEqual(audit.map((entry) => [entry.resource, entry.action, entry.actor_email]), [["approval", "request", "md@platform.test"], ["fx_lock", "lock", "md2@platform.test"], ["approval", "approve", "md2@platform.test"]]);
  assert.deepEqual([audit[1].after.rate, audit[1].after.approval_id, audit[1].after.requested_by, audit[1].after.central_rate], ["151.2", approval.id, "md@platform.test", "150"]);
});

test("租户的汇率接口不受锁定影响、没有锁定字段；租户角色对锁定表没有任何权限；首页卡片能看到锁定", async () => {
  const tenant = await ok(call("GET", "/tenant/v1/fx-rates", { token: m.a.adminToken }));
  assert.deepEqual(tenant.rates.find((item: any) => item.currency === "JPY"), { currency: "JPY", rate: "150" });
  const keys = allKeys(tenant);
  for (const key of ["lock", "locks", "locked", "central_rate", "buffer", "fx_buffer_bp", "markup_bp"]) assert.ok(!keys.has(key), key);
  assert.deepEqual(await owner("select has_table_privilege('nozomi_app', 'fx_locks', 'select') as s, has_table_privilege('nozomi_app', 'fx_locks', 'insert') as i, has_table_privilege('nozomi_app', 'fx_locks', 'update') as u"), [{ s: false, i: false, u: false }]);
  const summary = await ok(api.call("GET", "/platform/v1/dashboard/summary", { token: m.staff.readonly.token }));
  assert.deepEqual(summary.fx.locks.map((lock: any) => [lock.currency, lock.rate]), [["JPY", "151.2"]]);
});

test("同时批准只成功一个：同一条复核两人同时批准，一个成功、一个 APPROVAL_NOT_PENDING；同一个币种的两条锁定同时批准，一个生效、另一个 APPROVAL_STALE", async () => {
  const first = (await ok(requestLock(m.staff.masterData.token, { currency: "KRW", rate: "1410" }), 202)).approval;
  const second = (await ok(requestLock(m.staff.masterData.token, { currency: "KRW", rate: "1420" }), 202)).approval;
  const results = await Promise.all([decide(md2.token, first.id, "approve"), decide(m.root, second.id, "approve")]);
  assert.deepEqual(results.map((res) => res.status).sort(), [200, 409]);
  const loser = results.find((res) => res.status === 409) as ApiResponse;
  assert.equal(loser.body.error.code, "APPROVAL_STALE");
  const active = await owner("select rate::text as rate from fx_locks where currency = 'KRW' and status = 'active'");
  assert.equal(active.length, 1);
  const loserId = results[0]?.status === 409 ? first.id : second.id;
  assert.equal((await ok(call("GET", "/platform/v1/approvals/{id}", { token: md2.token, id: loserId }))).approval.status, "pending", "没生效的那条仍是待审核，可以驳回");
  await ok(decide(md2.token, loserId, "reject", "已有锁定"));
  // 同一条复核两个人同时批准
  const third = (await ok(requestLock(m.staff.masterData.token, { currency: "HKD", rate: "7.81" }), 202)).approval;
  const race = await Promise.all([decide(md2.token, third.id, "approve"), decide(m.root, third.id, "approve")]);
  assert.deepEqual(race.map((res) => res.status).sort(), [200, 409]);
  assert.equal((race.find((res) => res.status === 409) as ApiResponse).body.error.code, "APPROVAL_NOT_PENDING");
  assert.deepEqual(await owner("select count(*)::int as n from fx_locks where currency = 'HKD'"), [{ n: 1 }]);
});

test("解锁同样双人复核；换锁定值批准后新的取代旧的；锁定状态在发起之后变了的复核批准时 APPROVAL_STALE；已结束的锁定不能再解锁", async () => {
  const cny = await lockApproved({ currency: "CNY", rate: "7.25" });
  assert.equal(biz7Candidate(await previewIn("CNY")).fx.lock.legs.map((leg: any) => leg.currency).join(","), "JPY,CNY", "两边都锁定");
  // 换锁定值：批准后旧的变成「被取代」
  const change = (await ok(requestLock(m.staff.masterData.token, { currency: "CNY", rate: "7.3" }), 202)).approval;
  assert.deepEqual([change.payload.replaces_lock_id, change.before.rate], [cny.id, "7.25"]);
  // 和现在一样的不发起
  assert.equal((await requestLock(m.staff.masterData.token, { currency: "CNY", rate: "7.25", expires_at: cny.expires_at })).body.error.details.issues[0].reason, "UNCHANGED");
  // 同时有人发起解锁旧的那条，先被批准
  const release = (await ok(requestUnlock(md2.token, cny.id, "行情恢复"), 202)).approval;
  assert.deepEqual([release.kind, release.resource_id, release.payload.lock_id], ["fx_lock.release", "CNY", cny.id]);
  const self = await decide(md2.token, release.id, "approve");
  assert.deepEqual([self.status, self.body.error.code], [409, "APPROVAL_SELF_REVIEW"]);
  await ok(decide(m.staff.masterData.token, release.id, "approve"));
  const [released] = await owner("select status, ended_by::text as ended_by, end_approval_id::text as end_approval_id from fx_locks where id = $1", [cny.id]);
  assert.deepEqual(released, { status: "released", ended_by: m.staff.masterData.id, end_approval_id: release.id });
  assert.equal(biz7Candidate(await previewIn("CNY")).fx.lock.legs.map((leg: any) => leg.currency).join(","), "JPY", "人民币恢复用中央汇率");
  // 换锁定值的那条：发起时要取代的那条已经解除了，不能照旧生效
  const stale = await decide(md2.token, change.id, "approve");
  assert.deepEqual([stale.status, stale.body.error.code, stale.body.error.details.current_lock_id], [409, "APPROVAL_STALE", null]);
  await ok(decide(md2.token, change.id, "reject"));
  // 已结束的锁定不能再解锁；不存在的 404
  const ended = await requestUnlock(m.staff.masterData.token, cny.id);
  assert.deepEqual([ended.status, ended.body.error.code, ended.body.error.details.status], [409, "FX_LOCK_NOT_ACTIVE", "released"]);
  assert.equal((await requestUnlock(m.staff.masterData.token, randomUUID())).status, 404);
  // 换锁定值正常批准：旧的被取代，新的生效
  const thb = await lockApproved({ currency: "THB", rate: "36.1" });
  const thb2 = await lockApproved({ currency: "THB", rate: "36.2" });
  assert.deepEqual(await owner("select rate::text as rate, status from fx_locks where currency = 'THB' order by locked_at"), [{ rate: "36.1", status: "replaced" }, { rate: "36.2", status: "active" }]);
  assert.notEqual(thb.id, thb2.id);
  // 锁定记录接口：含已结束的
  const history = await ok(call("GET", "/platform/v1/fx-rates/locks", { token: m.staff.readonly.token, query: "limit=50" }));
  assert.deepEqual(history.items.filter((item: any) => item.currency === "CNY").map((item: any) => [item.status, item.ended_by?.email]), [["released", "md@platform.test"]]);
  // 审计：解锁、取代各有一条（操作者是批准人）
  const audit = await owner("select resource_id, action, actor_email, after->>'status' as status from audit_logs where resource = 'fx_lock' and action = 'unlock' order by id");
  assert.deepEqual(audit.map((entry) => [entry.resource_id, entry.actor_email, entry.status]), [[cny.id, "md@platform.test", "released"], [thb.id, "md2@platform.test", "replaced"]]);
});

test("锁定期间数据源新拉到的汇率照常入库但不用于这个币种；数据源停更超过 48 小时，锁定的币种照常报价、另一边还用数据源的照样暂停；到期那一刻起恢复用数据源；定时任务记为到期并写审计", async () => {
  const jpy = (await overview()).locks.find((lock: any) => lock.currency === "JPY");
  // 新的一批（日元 149，没超过 3%）：入库、生效，看板的中央汇率跟着变，日元仍用锁定值
  const t1 = new Date(api.clock.now().getTime() - 60_000);
  serve(t1, { ...RATES, JPY: "149", CNY: "7.1" });
  assert.equal((await ok(api.call("POST", "/platform/v1/fx-rates/fetch", { token: m.root }))).fetch.status, "accepted");
  assert.deepEqual(await owner("select rate::text as rate from fx_rates where quote = 'JPY' and as_of = $1", [t1]), [{ rate: "149" }]);
  const board = await overview();
  assert.deepEqual([board.as_of, board.rates.find((item: any) => item.currency === "JPY")], [t1.toISOString(), { currency: "JPY", rate: "151.2", central_rate: "149", locked: true }]);
  assert.equal(biz7Candidate(await previewIn("USD")).fx.rate, "0.006613756614");
  // 「变动超过 3%」照旧和数据源上一批比，不和锁定值比：日元 149 → 154（+3.4%）挂起
  serve(new Date(t1.getTime() + 1_000), { ...RATES, JPY: "154", CNY: "7.1" });
  assert.equal((await ok(api.call("POST", "/platform/v1/fx-rates/fetch", { token: m.root }))).fetch.status, "held");
  // 数据源从此停更：拨到 t1 + 48 小时之后（锁定还没到期）
  const staleAt = t1.getTime() + 48 * HOUR + 1;
  await advance(staleAt - api.clock.now().getTime() + 60_000);
  assert.ok(new Date(jpy.expires_at).getTime() > api.clock.now().getTime(), "锁定还在有效期内");
  assert.equal((await overview()).state, "stale");
  // 日元 → 美元：只用锁定值，照常报价
  assert.deepEqual(biz7Candidate(await previewIn("USD")).fx.lock.uses_source, false);
  // 日元 → 人民币：人民币还用数据源的汇率，过期了，跨币种暂停
  const cny = await previewIn("CNY");
  assert.ok(cny.refused.some((entry: any) => entry.product_id === m.ids.pa && entry.reason === "FX_RATE_UNAVAILABLE"), JSON.stringify(cny.refused));
  // 拨到到期前 1 毫秒：仍用锁定值；正好到期那一刻起不再用（数据源也过期了，日元的跨币种报价暂停）
  await advance(new Date(jpy.expires_at).getTime() - api.clock.now().getTime() - 1);
  assert.equal(biz7Candidate(await previewIn("USD")).fx.lock.legs[0].lock_id, jpy.id);
  api.clock.advance(1);
  const expired = await previewIn("USD");
  assert.equal(biz7Candidate(expired), undefined);
  assert.ok(expired.refused.some((entry: any) => entry.product_id === m.ids.pa && entry.reason === "FX_RATE_UNAVAILABLE"));
  assert.equal((await overview()).locks.some((lock: any) => lock.currency === "JPY"), false, "看板上也不再算它生效");
  // 定时任务：记为到期、写审计（操作者「系统」，入口 job）、服务日志 fx.lock_expired；再跑一次不重复记
  await api.app.fxCenter.tick();
  await api.app.fxCenter.tick();
  assert.deepEqual(await owner("select status, ended_at is not null as ended from fx_locks where id = $1", [jpy.id]), [{ status: "expired", ended: true }]);
  const audit = await owner("select actor_type, source, after from audit_logs where resource = 'fx_lock' and action = 'expire' and resource_id = $1", [jpy.id]);
  assert.deepEqual(audit.map((entry) => [entry.actor_type, entry.source, entry.after.currency, entry.after.status]), [["system", "job", "JPY", "expired"]]);
  assert.match(api.logs(), /"event":"fx.lock_expired"/);
  // 首页卡片上也没有了
  const summary = await ok(api.call("GET", "/platform/v1/dashboard/summary", { token: m.root }));
  assert.equal(summary.fx.locks.some((lock: any) => lock.currency === "JPY"), false);
});

test("到期之后还没批准的锁定不能生效；数据库兜底：同一币种只有一条生效中的锁定，批准人不能是发起人，最长 72 小时", async () => {
  // 先给数据源一批新的，看板恢复
  serve(new Date(api.clock.now().getTime() - 60_000), { ...RATES, JPY: "149" });
  await ok(api.call("POST", "/platform/v1/fx-rates/fetch", { token: m.root }));
  const soon = (await ok(requestLock(m.staff.masterData.token, { currency: "TWD", rate: "32.1", expires_at: later(31 * 60_000) }), 202)).approval;
  await advance(32 * 60_000);
  const late = await decide(md2.token, soon.id, "approve");
  assert.deepEqual([late.status, late.body.error.details.issues.map((issue: any) => issue.reason)], [400, ["EXPIRES_TOO_SOON"]]);
  assert.equal((await ok(call("GET", "/platform/v1/approvals/{id}", { token: md2.token, id: soon.id }))).approval.status, "pending");
  const krw = await lockApproved({ currency: "KRW", rate: "1400" });
  const [any] = await owner("select * from fx_locks where id = $1", [krw.id]);
  const insert = (overrides: Record<string, unknown>) => {
    const row = { ...any, ...overrides };
    return api.db.owner.query(
      "insert into fx_locks (currency, rate, expires_at, locked_at, central_rate, central_as_of, deviation_bp, lock_approval_id, requested_by, approved_by, status) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
      [row.currency, row.rate, row.expires_at, row.locked_at, row.central_rate, row.central_as_of, row.deviation_bp, row.lock_approval_id, row.requested_by, row.approved_by, row.status],
    );
  };
  await assert.rejects(insert({}), { code: "23505" });
  await assert.rejects(insert({ status: "released" }), { code: "23514" }, "结束的要有结束时间");
  await assert.rejects(insert({ currency: "USD" }), { code: "23514" });
  await assert.rejects(insert({ currency: "TWD", approved_by: any.requested_by }), { code: "23514" });
  await assert.rejects(insert({ currency: "TWD", expires_at: new Date(new Date(any.locked_at).getTime() + 72 * HOUR + 1_000) }), { code: "23514" });
  await assert.rejects(insert({ currency: "TWD", rate: "0" }), { code: "23514" });
});
