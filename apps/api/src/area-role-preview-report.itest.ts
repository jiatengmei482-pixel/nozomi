/**
 * 只读核对的接口版（M8-34，ADR 0086）：`GET /platform/v1/reports/area-role-preview`，真实 PostgreSQL。
 * - 未登录 401、供应商的令牌 401；没有 `quote.preview` 403；限定了数据范围 403 `DATA_SCOPE_DENIED`；只勾了「报价试算」的自建角色能用；
 * - 结果和命令行用的 `buildRolePreview` 完全一样（同一时刻、同一天数），没有坐标、没有客人信息；
 * - 只读：除了审计和限速表，数据库里一个字节都没变；每次调用写一条审计；
 * - 天数校验（1–90、默认 30）；限速（每人 10 分钟 3 次，超过 429 + Retry-After，各人各算）；回放超时 503 `REPORT_TIMEOUT`。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withPlatformTx } from "./db/context.ts";
import { RolePreviewTimeout, buildRolePreview } from "./services/area-role-preview.ts";
import { reportTimeout } from "./services/area-role-preview-report.ts";
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
  assert.deepEqual(audit.rows[0], { actor_email: "readonly-check@platform.test", source: "console", resource: "area", resource_id: null, action: "view", before: null, after: { report: "area_role_preview", days: 7 } });
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

test("回放超时：停在下一条询价之前，抛出超时；接口的 503 REPORT_TIMEOUT 符合定义", async () => {
  await assert.rejects(withPlatformTx(api.db.pool, (db) => buildRolePreview(db, { days: 30, now: api.clock.now(), expired: () => true }), { snapshot: true }), RolePreviewTimeout);
  const error = reportTimeout(30);
  assert.equal(error.statusCode, 503);
  const body = errorBody(error.code, error.message, error.details);
  assertMatchesOperation("GET", TEMPLATE, 503, body);
  assert.deepEqual(body.error.details, { days: 30, budget_seconds: 45 });
});
