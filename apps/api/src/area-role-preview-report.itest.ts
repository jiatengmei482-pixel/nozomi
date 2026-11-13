/**
 * 只读核对的接口版（M8-34，ADR 0086）：`GET /platform/v1/reports/area-role-preview`，真实 PostgreSQL。
 * - 未登录 401、供应商的令牌 401；没有 `quote.preview` 403；限定了数据范围 403 `DATA_SCOPE_DENIED`；只勾了「报价试算」的自建角色能用；
 * - 结果和命令行用的 `buildRolePreview` 完全一样（同一时刻、同一天数），没有坐标、没有客人信息；
 * - 只读：除了审计和限速表，数据库里一个字节都没变；每次调用写一条审计；
 * - 天数校验（1–90、默认 30）；截止时间 `until`（默认现在、不能晚于现在，回放 [until − days, until)，同一个 until 两次摘要一样）；限速（每人 10 分钟 3 次，超过 429 + Retry-After，各人各算）；
 * - 时限：真实请求在时限到了时得到 503 `REPORT_TIMEOUT`（时限可注入）；只读事务里的 `statement_timeout` 跟着剩下的时间收，慢查询也会被数据库取消。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { withPlatformTx } from "./db/context.ts";
import { RolePreviewTimeout, buildRolePreview } from "./services/area-role-preview.ts";
import { ROLE_PREVIEW_REPORT_BUDGET_MS, reportTimeout, withDeadline } from "./services/area-role-preview-report.ts";
import { errorBody } from "./errors.ts";
import { TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, allValues, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { assertMatchesOpenApi, assertMatchesOperation } from "./testing/openapi.ts";

const PATH = "/platform/v1/reports/area-role-preview";
const TEMPLATE = PATH;

let api: TestApi;
let m: Market;
let reader: string;
let scoped: string;
let finance: string;

async function staffWithRole(email: string, role: string): Promise<string> {
  const invited = await ok(api.call("POST", "/platform/v1/staff", { token: m.root, body: { email, name: email.split("@")[0], role } }), 201);
  await ok(api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
  return (await ok(api.platformLogin({ body: { email, password: TEST_PASSWORD } }))).access_token;
}

/** 整个测试 schema 里每张表的「行数 + 全部内容的摘要」 */
async function snapshot(): Promise<Record<string, string>> {
  const tables = (await api.db.owner.query("select table_name from information_schema.tables where table_schema = $1 and table_type = 'BASE TABLE' order by 1", [api.db.schema])).rows.map((row) => row.table_name as string);
  const result: Record<string, string> = {};
  for (const table of tables) {
    const row = (await api.db.owner.query(`select count(*)::int as n, coalesce(md5(string_agg(x::text, '|' order by x::text)), '') as h from "${table}" x`)).rows[0];
    result[table] = `${row.n}:${row.h}`;
  }
  return result;
}

const get = (token: string | undefined, query = "") => api.call("GET", `${PATH}${query}`, token === undefined ? {} : { token });

before(async () => {
  api = await createTestApi();
  m = await buildMarket(api);
  const channel = await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" });
  const creds = await salesCredentials(api, m, channel.id);
  for (const dropoff of [{ lng: 139.7, lat: 35.6 }, { lng: 145, lat: 35.5 }]) {
    await ok(api.call("POST", "/sales/v1/quotes", { token: creds.token, body: { city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, direction: "pickup", dropoff, service_time: "2026-10-20T10:00:00+09:00", passengers: 2, luggage: 1, currency: "JPY" } }));
  }
  await api.app.backgroundIdle();
  // 回放窗口不含截止时间（默认现在）：测试的时钟是停着的，往前走 1 毫秒，刚才的询价才在窗口里（真实环境里时间总在走）
  api.clock.advance(1);
  const readonlyRole = await ok(api.call("POST", "/platform/v1/roles", { token: m.root, body: { name: "只读核对", grants: ["quote_preview:view"], data_scope: { city_ids: null, channel_ids: null } } }), 201);
  reader = await staffWithRole("readonly-check@platform.test", readonlyRole.key);
  const scopedRole = await ok(api.call("POST", "/platform/v1/roles", { token: m.root, body: { name: "官网试算", grants: ["quote_preview:view"], data_scope: { city_ids: null, channel_ids: [channel.id] } } }), 201);
  scoped = await staffWithRole("scoped-check@platform.test", scopedRole.key);
  finance = await staffWithRole("finance-check@platform.test", "finance");
});
after(() => api.close());

test("鉴权：未登录、供应商的令牌 401；没有报价试算 403；限定了数据范围 403 DATA_SCOPE_DENIED；被拦的不占限速、不写审计", async () => {
  const before = await snapshot();
  for (const token of [undefined, "not-a-token", m.a.adminToken]) {
    const res = await get(token);
    assert.equal(res.status, 401, res.text);
    assertMatchesOpenApi("GET", TEMPLATE, res);
  }
  for (const token of [finance, m.staff.readonly.token, m.staff.masterData.token]) {
    const res = await get(token);
    assert.equal(res.status, 403, res.text);
    assert.equal(res.body.error.code, "FORBIDDEN");
    assertMatchesOpenApi("GET", TEMPLATE, res);
  }
  const denied = await get(scoped);
  assert.equal(denied.status, 403, denied.text);
  assert.equal(denied.body.error.code, "DATA_SCOPE_DENIED");
  assert.deepEqual(await snapshot(), before);
});

test("结果和命令行的 buildRolePreview 完全一样；没有坐标、没有客人信息；只读：除了一条审计和限速计数，数据库里一个字节都没变", async () => {
  const before = await snapshot();
  const res = await get(reader, "?days=7");
  assert.equal(res.status, 200, res.text);
  assertMatchesOpenApi("GET", TEMPLATE, res);
  const expected = await withPlatformTx(api.db.pool, (db) => buildRolePreview(db, { days: 7, now: api.clock.now() }), { snapshot: true });
  assert.deepEqual(res.body, JSON.parse(JSON.stringify(expected)));
  assert.equal(res.body.replay.days, 7);
  assert.equal(res.body.replay.logs, 2);
  assert.equal(res.body.replay.externalDiffCount, 0);
  assert.equal(res.body.replay.priority.changedCount, 0);
  const values = [...allValues(res.body)].join("\n");
  for (const coordinate of ["139.7", "35.6", "145", "35.5"]) assert.ok(!values.includes(coordinate), `应答里不能有坐标 ${coordinate}`);
  const after = await snapshot();
  const changed = Object.keys(after).filter((table) => after[table] !== before[table]).sort();
  assert.deepEqual(changed, ["audit_logs", "sales_rate_limits"]);
  const audit = await api.db.owner.query("select actor_email, source, resource, resource_id, action, before, after from audit_logs where resource = 'area' and action = 'view' order by occurred_at desc, id desc limit 1");
  assert.deepEqual(audit.rows[0], { actor_email: "readonly-check@platform.test", source: "console", resource: "area", resource_id: null, action: "view", before: null, after: { report: "area_role_preview", days: 7, until: api.clock.now().toISOString() } });
  assert.equal(res.body.replay.until, api.clock.now().toISOString());
  assert.equal(res.body.replay.resultLines, res.body.replay.resultLineDigests.length);
});

test("天数：1–90 的整数，默认 30；其他写法 400，不占限速、不写审计", async () => {
  const token = await staffWithRole(`days-${randomUUID().slice(0, 8)}@platform.test`, "customer_service");
  const before = await snapshot();
  for (const query of ["?days=0", "?days=91", "?days=x", "?days=1.5", "?days=-1", "?days=", "?days=7&days=8", "?other=1", "?days=007"]) {
    const res = await get(token, query);
    assert.equal(res.status, 400, `${query} ${res.text}`);
    assert.equal(res.body.error.code, "VALIDATION_FAILED");
    assertMatchesOpenApi("GET", TEMPLATE, res);
  }
  assert.deepEqual(await snapshot(), before);
  assert.equal((await ok(get(token))).replay.days, 30);
  assert.equal((await ok(get(token, "?days=90"))).replay.days, 90);
  assert.equal((await ok(get(token, "?days=1"))).replay.days, 1);
});

test("截止时间 until：回放 [until − days, until)；同一个 until 两次摘要一样；不是带时区的时间、晚于现在 400（不占限速、不写审计）", async () => {
  const token = await staffWithRole(`until-${randomUUID().slice(0, 8)}@platform.test`, "operations");
  const now = api.clock.now();
  const before = await snapshot();
  for (const query of ["?until=x", "?until=2026-11-13", "?until=2026-11-13T00:00:00", `?until=${encodeURIComponent(new Date(now.getTime() + 1000).toISOString())}`, "?until=a&until=b"]) {
    const res = await get(token, query);
    assert.equal(res.status, 400, `${query} ${res.text}`);
    assert.equal(res.body.error.code, "VALIDATION_FAILED");
    assertMatchesOpenApi("GET", TEMPLATE, res);
  }
  assert.deepEqual(await snapshot(), before);
  const created = (await api.db.owner.query("select min(created_at) as first, max(created_at) as last from quote_logs")).rows[0];
  const at = (date: Date) => `?days=7&until=${encodeURIComponent(date.toISOString())}`;
  // 截止时间不含这一刻：until 等于最早一条询价的时间，那一条不算
  const empty = await ok(get(token, at(created.first)));
  assert.equal(empty.replay.logs, 0);
  assert.equal(empty.replay.until, new Date(created.first).toISOString());
  assert.equal(empty.replay.since, new Date(new Date(created.first).getTime() - 7 * 86_400_000).toISOString());
  const until = new Date(new Date(created.last).getTime() + 1);
  const first = await ok(get(token, at(until)));
  assert.equal(first.replay.logs, 2);
  const second = await withPlatformTx(api.db.pool, (db) => buildRolePreview(db, { days: 7, now: api.clock.now(), until }), { snapshot: true });
  assert.deepEqual([second.replay.resultDigest, second.replay.stateDigest, second.replay.resultLines], [first.replay.resultDigest, first.replay.stateDigest, first.replay.resultLines]);
});

test("限速：每人 10 分钟 3 次，第 4 次 429 + Retry-After（不写审计）；别人不受影响；10 分钟后恢复", async () => {
  const token = await staffWithRole(`limit-${randomUUID().slice(0, 8)}@platform.test`, "operations");
  for (let i = 0; i < 3; i += 1) await ok(get(token, "?days=1"));
  const audits = async () => Number((await api.db.owner.query("select count(*)::int as n from audit_logs where resource = 'area' and action = 'view'")).rows[0].n);
  const auditsBefore = await audits();
  const limited = await get(token, "?days=1");
  assert.equal(limited.status, 429, limited.text);
  assert.equal(limited.body.error.code, "RATE_LIMITED");
  assert.ok(Number(limited.headers["retry-after"]) > 0);
  assertMatchesOpenApi("GET", TEMPLATE, limited);
  assert.equal(await audits(), auditsBefore);
  await ok(get(m.root, "?days=1"));
  api.clock.advance(600_000);
  await ok(get(token, "?days=1"));
});

test("回放超时：停在下一条询价之前，抛出超时；503 REPORT_TIMEOUT 的写法符合定义", async () => {
  await assert.rejects(withPlatformTx(api.db.pool, (db) => buildRolePreview(db, { days: 30, now: api.clock.now(), expired: () => true }), { snapshot: true }), RolePreviewTimeout);
  assert.equal(ROLE_PREVIEW_REPORT_BUDGET_MS, 45_000);
  const error = reportTimeout(30, ROLE_PREVIEW_REPORT_BUDGET_MS);
  assert.equal(error.statusCode, 503);
  const body = errorBody(error.code, error.message, error.details);
  assertMatchesOperation("GET", TEMPLATE, 503, body);
  assert.deepEqual(body.error.details, { days: 30, budget_seconds: 45 });
});

test("时限到了的真实请求：503 REPORT_TIMEOUT（时限注入为 0）；没有结果、只留审计和限速计数", async () => {
  const short = await createTestApi({ rolePreviewBudgetMs: 0 });
  try {
    const root = await short.superAdminToken();
    const res = await short.call("GET", `${PATH}?days=7`, { token: root });
    assert.equal(res.status, 503, res.text);
    assert.equal(res.body.error.code, "REPORT_TIMEOUT");
    assert.deepEqual(res.body.error.details, { days: 7, budget_seconds: 0 });
    assertMatchesOpenApi("GET", TEMPLATE, res);
    const audits = await short.db.owner.query("select after from audit_logs where resource = 'area' and action = 'view'");
    assert.deepEqual(audits.rows, [{ after: { report: "area_role_preview", days: 7, until: short.clock.now().toISOString() } }]);
    const slots = await short.db.owner.query("select attempt_count from sales_rate_limits where bucket like 'staff_role_preview:%'");
    assert.deepEqual(slots.rows, [{ attempt_count: 1 }]);
  } finally {
    await short.close();
  }
});

test("statement_timeout 跟着时限收：事务开头是「默认 10 秒」和「剩下的时间」中较小的一个；慢查询被数据库取消也算超时，不会越过时限", async () => {
  const timeoutOf = (deadlineMs: number) =>
    withPlatformTx(api.db.pool, async (db) => {
      const guarded = await withDeadline(db, performance.now() + deadlineMs);
      return (await guarded.query<{ statement_timeout: string }>("show statement_timeout")).rows[0]?.statement_timeout;
    }, { snapshot: true });
  assert.equal(await timeoutOf(45_000), "10s");
  const near = await timeoutOf(3_000);
  // PostgreSQL 显示 statement_timeout 时把整秒写成「2s」、其余写成「2999ms」（M8-29：main run 43321503555 拿到 2s，原来只认 ms 写法）；换算成毫秒再比
  const unit = /^(\d+)(ms|s)$/.exec(near ?? "");
  assert.ok(unit !== null, `statement_timeout 的写法：${near}`);
  const nearMs = Number(unit[1]) * (unit[2] === "s" ? 1_000 : 1);
  assert.ok(nearMs > 0 && nearMs <= 3_000, `收到不超过剩下的 3 秒：${near}`);
  const started = performance.now();
  await assert.rejects(
    withPlatformTx(api.db.pool, async (db) => {
      const guarded = await withDeadline(db, performance.now() + 300);
      await guarded.query("select pg_sleep(5)");
    }, { snapshot: true }),
    RolePreviewTimeout,
  );
  assert.ok(performance.now() - started < 2_000, "慢查询在时限附近就被取消");
  // 时限已经过了：不再发查询，直接超时
  await assert.rejects(withPlatformTx(api.db.pool, async (db) => (await withDeadline(db, performance.now() - 1)).query("select 1"), { snapshot: true }), RolePreviewTimeout);
});
