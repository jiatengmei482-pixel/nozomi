/**
 * M2-04：`/sales/v1` 的令牌、询价、查报价（ADR 0023），经真实接口、真实 PostgreSQL。
 * - 渠道只来自令牌：渠道 A 的令牌查不到渠道 B 的报价；请求里带 channel_id 被拒；
 * - 只比渠道授权的租户、城市、品类；
 * - 应答里没有中标租户、结算价、加价比例；quote 表和询价日志与应答一致；有效期 30 分钟；
 * - 限流：报价每个渠道每秒 50 次，其他每秒 10 次，超限 429 + Retry-After；渠道之间互不影响；
 * - 租户端：所有 /tenant/v1 的应答里没有渠道、对外价、加价比例；租户角色在数据库里碰不到渠道的任何一张表。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { withTenantTx } from "./db/context.ts";
import { type ApiResponse, type HttpMethod, type TestApi, createTestApi } from "./testing/api.ts";
import { deniedByDatabase } from "./testing/db.ts";
import { type Market, DROPOFF, SERVICE_TIME, allKeys, approvedBy, buildMarket, newChannel, ok, ruleRequest, salesCredentials } from "./testing/market.ts";
import { assertMatchesOperation } from "./testing/openapi.ts";

let api: TestApi;
let m: Market;

before(async () => {
  api = await createTestApi();
  m = await buildMarket(api);
});
after(() => api.close());

const ask = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, direction: "pickup", dropoff: DROPOFF, service_time: SERVICE_TIME, passengers: 2, luggage: 1, currency: "JPY", ...extra });

/** 调销售端接口并按定义核对（401、403、429 也要写在定义里）。每次先把时钟拨过一秒：限流按秒计，测试之间互不占额度。 */
async function sales(method: HttpMethod, url: string, template: string, token: string | undefined, body?: unknown, options: { sameSecond?: boolean } = {}): Promise<ApiResponse> {
  if (!options.sameSecond) api.clock.advance(1_000);
  const res = await api.call(method, url, { ...(token === undefined ? {} : { token }), ...(body === undefined ? {} : { body }) });
  assertMatchesOperation(method, template, res.status, res.body);
  return res;
}
const quote = (token: string, body: Record<string, unknown> = ask(), options: { sameSecond?: boolean } = {}) => sales("POST", "/sales/v1/quotes", "/sales/v1/quotes", token, body, options);

test("令牌：client_credentials 换 2 小时的令牌（JSON、表单都行）；密钥不对、客户端不存在一样的 401；按来源地址限流", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "令牌渠道" });
  const issued = await ok(api.call("POST", `/platform/v1/channels/${channel.id}/api-clients`, { token: m.staff.cm1.token, body: { name: "官网" } }), 201);
  const body = { grant_type: "client_credentials", client_id: issued.api_client.client_id, client_secret: issued.client_secret };
  const token = await sales("POST", "/sales/v1/oauth/token", "/sales/v1/oauth/token", undefined, body);
  assert.deepEqual([token.status, token.body.token_type, token.body.expires_in, token.body.channel_id], [200, "Bearer", 7_200, channel.id]);
  api.clock.advance(1_000);
  const form = await api.app.inject({ method: "POST", url: "/sales/v1/oauth/token", headers: { "content-type": "application/x-www-form-urlencoded" }, payload: new URLSearchParams(body).toString() });
  assert.equal(form.statusCode, 200, form.body);
  const wrong = await sales("POST", "/sales/v1/oauth/token", "/sales/v1/oauth/token", undefined, { ...body, client_secret: `${issued.client_secret}x` });
  const nobody = await sales("POST", "/sales/v1/oauth/token", "/sales/v1/oauth/token", undefined, { ...body, client_id: "nzc_000000000000000000000000" });
  assert.deepEqual([wrong.status, wrong.body], [401, nobody.body]);
  assert.equal(wrong.body.error.code, "INVALID_CLIENT");
  // 平台令牌、租户令牌在销售端都无效；销售端令牌在平台、租户接口上也无效
  assert.equal((await quote(m.root)).status, 401);
  assert.equal((await quote(m.a.adminToken)).status, 401);
  assert.equal((await api.call("GET", "/platform/v1/channels", { token: token.body.access_token })).status, 401);
  assert.equal((await api.call("GET", "/tenant/v1/products", { token: token.body.access_token })).status, 401);
  // 同一秒里同一个来源地址：第 11 次 429（失败的也算数）
  api.clock.advance(1_000);
  for (let i = 0; i < 10; i += 1) await api.call("POST", "/sales/v1/oauth/token", { ip: "203.0.113.9", body: { ...body, client_secret: "nzs_wrong" } });
  const limited = await api.call("POST", "/sales/v1/oauth/token", { ip: "203.0.113.9", body });
  assertMatchesOperation("POST", "/sales/v1/oauth/token", limited.status, limited.body);
  assert.deepEqual([limited.status, limited.body.error.code, limited.headers["retry-after"]], [429, "RATE_LIMITED", "1"]);
  assert.equal((await api.call("POST", "/sales/v1/oauth/token", { ip: "203.0.113.10", body })).status, 200, "别的地址不受影响");
});

test("询价：每个车型组一个 quote_id，30 分钟有效；应答里没有中标租户、结算价、加价比例；quote 表、询价日志和应答一致", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "官网" });
  await approvedBy(api, m, ruleRequest(api, m, channel.id, { tenant_id: m.b.tenantId, markup_bp: 1_100 }));
  const creds = await salesCredentials(api, m, channel.id);
  const res = await quote(creds.token);
  assert.equal(res.status, 200, res.text);
  const byGroup = new Map(res.body.quotes.map((q: any) => [q.vehicle_group_id, q]));
  const biz: any = byGroup.get(m.ids.biz7);
  const eco: any = byGroup.get(m.ids.eco4);
  // 商务 7 座：甲 20,000 × 1.10 = 22,000，乙 19,800 × 1.11 = 21,978 → 乙；经济 4 座只有甲：13,200
  assert.deepEqual([biz.price.total, eco.price.total, biz.price.fx, biz.free_wait_minutes, biz.service_date, biz.urgent], [{ amount: "21978", currency: "JPY" }, { amount: "13200", currency: "JPY" }, null, 90, "2026-10-20", false]);
  assert.match(biz.quote_id, /^QT20261007[0-9A-Z]{10}$/);
  assert.equal(new Date(biz.expires_at).getTime() - new Date(biz.created_at).getTime(), 30 * 60_000);
  // 不含中标租户、结算价、加价比例（逐层扫字段名，也扫原文里的租户编号、名字、结算价）
  const keys = [...allKeys(res.body)];
  assert.deepEqual(keys.filter((key) => /tenant|settle|markup|margin|product|candidate|rank|score|winner|band|buffer|channel/i.test(key)), []);
  for (const secret of [m.a.tenantId, m.b.tenantId, "甲车队", "乙车队", m.ids.pa, m.ids.pb, "19800", "20000"]) assert.ok(!res.text.includes(secret), `应答里出现了 ${secret}`);
  // quote 表：每个车型组一行，抄出来的列和快照、应答一致
  const rows = (await api.db.owner.query("select * from quotes where channel_id = $1 order by sell_minor", [channel.id])).rows;
  assert.equal(rows.length, 2);
  const row = rows.find((r) => r.id === biz.quote_id);
  assert.deepEqual([row.winner_tenant_id, row.product_id, Number(row.sell_minor), Number(row.settlement_minor), row.settlement_currency, row.markup_bp, row.markup_level, row.currency], [m.b.tenantId, m.ids.pb, 21_978, 19_800, "JPY", 1_100, 2, "JPY"]);
  const rules = (await ok(api.call("GET", `/platform/v1/channels/${channel.id}/markup-rules`, { token: m.root }))).items;
  assert.equal(row.markup_rule_id, rules[0].id);
  const snapshot = row.snapshot;
  assert.deepEqual([snapshot.quoteId, snapshot.winner.sell.sellMinor, snapshot.winner.offer.settlement.totalMinor, snapshot.winner.productVersion, snapshot.channel.id, snapshot.markup.ruleId, snapshot.expiresAt, row.expires_at.toISOString()], [biz.quote_id, 21_978, 19_800, row.product_version, channel.id, rules[0].id, biz.expires_at, biz.expires_at]);
  assert.deepEqual(snapshot.candidates.map((c: any) => [c.tenantId, c.sellMinor, c.markupBp, c.position]), [[m.b.tenantId, 21_978, 1_100, 1], [m.a.tenantId, 22_000, 1_000, 2]]);
  // 询价日志：一行，带全部候选和 quote_id
  const logs = (await api.db.owner.query("select * from quote_logs where channel_id = $1", [channel.id])).rows;
  assert.equal(logs.length, 1);
  assert.deepEqual([logs[0].candidate_count, logs[0].quote_count, logs[0].api_client_id, logs[0].bids.map((b: any) => b.quote_id).sort()], [2, 2, creds.id, [biz.quote_id, eco.quote_id].sort()]);
  const platformLogs = await ok(api.call("GET", `/platform/v1/channels/${channel.id}/quote-logs`, { token: m.staff.readonly.token }));
  assertMatchesOperation("GET", "/platform/v1/channels/{id}/quote-logs", 200, platformLogs);
  assert.deepEqual([platformLogs.items.length, platformLogs.items[0].quote_count, platformLogs.items[0].client_id], [1, 2, creds.clientId]);
  // 查报价：有效期内能查到；到点那一刻 410
  const found = await sales("GET", `/sales/v1/quotes/${biz.quote_id}`, "/sales/v1/quotes/{id}", creds.token);
  assert.deepEqual(found.body.quote, biz);
  const expiresIn = new Date(biz.expires_at).getTime() - api.clock.now().getTime();
  api.clock.advance(expiresIn);
  const expired = await sales("GET", `/sales/v1/quotes/${biz.quote_id}`, "/sales/v1/quotes/{id}", creds.token, undefined, { sameSecond: true });
  assert.deepEqual([expired.status, expired.body.error.code, expired.body.error.details.expires_at], [410, "QUOTE_EXPIRED", biz.expires_at]);
});

test("渠道之间互相隔离：渠道 A 的令牌查不到渠道 B 的报价（和不存在一样 404）；请求里带 channel_id、tenant_id 一律拒绝", async () => {
  const channelA = await newChannel(api, m.staff.cm1.token, { name: "渠道 A" });
  const channelB = await newChannel(api, m.staff.cm1.token, { name: "渠道 B" });
  const a = await salesCredentials(api, m, channelA.id, "198.51.100.41");
  const b = await salesCredentials(api, m, channelB.id, "198.51.100.42");
  const fromB = (await quote(b.token)).body.quotes[0].quote_id as string;
  const crossed = await sales("GET", `/sales/v1/quotes/${fromB}`, "/sales/v1/quotes/{id}", a.token);
  const missing = await sales("GET", "/sales/v1/quotes/QT20261007ZZZZZZZZZZ", "/sales/v1/quotes/{id}", a.token);
  assert.deepEqual([crossed.status, crossed.body], [404, missing.body]);
  assert.equal((await sales("GET", "/sales/v1/quotes/not-a-quote", "/sales/v1/quotes/{id}", a.token)).status, 404);
  assert.equal((await sales("GET", `/sales/v1/quotes/${fromB}`, "/sales/v1/quotes/{id}", b.token)).status, 200);
  for (const extra of [{ channel_id: channelB.id }, { tenant_id: m.a.tenantId }, { markup_bp: 0 }]) {
    const res = await quote(a.token, ask(extra));
    assert.deepEqual([res.status, res.body.error.code], [400, "VALIDATION_FAILED"], JSON.stringify(extra));
  }
  // A 的询价日志里没有 B 的那次
  const logsA = (await api.db.owner.query("select count(*)::int as n from quote_logs where channel_id = $1", [channelA.id])).rows[0].n;
  assert.equal(logsA, 0);
});

test("只比渠道授权的范围：白名单只有甲时乙不参加（询价日志里记 NOT_IN_CHANNEL_SCOPE）；黑名单；城市、品类不在授权范围里 422", async () => {
  const onlyA = await newChannel(api, m.staff.cm1.token, { name: "白名单", scope: { tenant_scope: "allow", tenant_ids: [m.a.tenantId] } });
  const credsA = await salesCredentials(api, m, onlyA.id, "198.51.100.51");
  const res = await quote(credsA.token, ask({ vehicle_group_ids: [m.ids.biz7] }));
  assert.deepEqual(res.body.quotes.map((q: any) => q.price.total.amount), ["22000"]);
  const row = (await api.db.owner.query("select winner_tenant_id from quotes where id = $1", [res.body.quotes[0].quote_id])).rows[0];
  assert.equal(row.winner_tenant_id, m.a.tenantId);
  const log = (await api.db.owner.query("select rejects, candidate_count from quote_logs where channel_id = $1", [onlyA.id])).rows[0];
  assert.deepEqual([log.candidate_count, log.rejects], [1, [{ tenant_id: m.b.tenantId, product_id: m.ids.pb, vehicle_group_id: null, reason: "NOT_IN_CHANNEL_SCOPE" }]]);
  const denyBoth = await newChannel(api, m.staff.cm1.token, { name: "黑名单", scope: { tenant_scope: "deny", tenant_ids: [m.a.tenantId, m.b.tenantId] } });
  const credsDeny = await salesCredentials(api, m, denyBoth.id, "198.51.100.52");
  const none = await quote(credsDeny.token, ask({ vehicle_group_ids: [m.ids.biz7] }));
  assert.deepEqual(none.body, { quotes: [], unavailable: [{ vehicle_group_id: m.ids.biz7, reasons: ["NO_PRODUCT"] }] });
  const osaka = await newChannel(api, m.staff.cm1.token, { name: "只卖大阪", scope: { city_ids: [m.ids.osaka] } });
  const credsOsaka = await salesCredentials(api, m, osaka.id, "198.51.100.53");
  const city = await quote(credsOsaka.token);
  assert.deepEqual([city.status, city.body.error.code, city.body.error.details.reason], [422, "CHANNEL_SCOPE_DENIED", "CITY_NOT_AUTHORIZED"]);
  const charter = await newChannel(api, m.staff.cm1.token, { name: "只卖包车", scope: { categories: ["charter"] } });
  const credsCharter = await salesCredentials(api, m, charter.id, "198.51.100.54");
  assert.equal((await quote(credsCharter.token)).body.error.details.reason, "CATEGORY_NOT_AUTHORIZED");
});

test("报不出价：只给面向客人的原因（不在服务范围、提前量不够……），不给供应商内部的原因；起终点可以用主数据的地点编号", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "原因渠道" });
  const creds = await salesCredentials(api, m, channel.id, "198.51.100.61");
  const far = await quote(creds.token, ask({ dropoff: { lng: 141.5, lat: 35.5 }, vehicle_group_ids: [m.ids.biz7, m.ids.eco4] }));
  assert.deepEqual(far.body, { quotes: [], unavailable: [{ vehicle_group_id: m.ids.biz7, reasons: ["OUT_OF_SERVICE_AREA"] }, { vehicle_group_id: m.ids.eco4, reasons: ["OUT_OF_SERVICE_AREA"] }] });
  // 测试时钟是 10-07 10:00（东京），10-08 09:00 不够 24 小时
  const soon = await quote(creds.token, ask({ service_time: "2026-10-08T09:00:00+09:00" }));
  assert.deepEqual(soon.body, { quotes: [], unavailable: [{ vehicle_group_id: null, reasons: ["LEAD_TIME_TOO_SHORT"] }] });
  // 带别的时区写法的同一个时刻，换算成东京当地时间
  const utc = await quote(creds.token, ask({ service_time: "2026-10-20T01:00:00Z" }));
  assert.equal(utc.body.quotes[0].service_date, "2026-10-20");
  // 地点编号：用机场的坐标当下车点（在区域外）→ 不在服务范围；不存在的地点 400
  const byPlace = await quote(creds.token, ask({ dropoff: { place_id: m.ids.narita } }));
  assert.equal(byPlace.status, 400);
  const unknown = await quote(creds.token, ask({ dropoff: { place_id: "99999999-9999-4999-8999-999999999999" } }));
  assert.deepEqual([unknown.status, unknown.body.error.details.issues[0].reason], [400, "UNKNOWN_PLACE"]);
});

test("限流：报价每个渠道每秒 50 次，第 51 次 429 + Retry-After；查报价每秒 10 次；过了这一秒恢复；别的渠道不受影响", async () => {
  const busy = await newChannel(api, m.staff.cm1.token, { name: "繁忙渠道" });
  const calm = await newChannel(api, m.staff.cm1.token, { name: "清闲渠道" });
  const credsBusy = await salesCredentials(api, m, busy.id, "198.51.100.71");
  const credsCalm = await salesCredentials(api, m, calm.id, "198.51.100.72");
  const small = ask({ vehicle_group_ids: [m.ids.eco4] });
  api.clock.advance(1_000);
  const statuses: number[] = [];
  for (let i = 0; i < 50; i += 1) statuses.push((await quote(credsBusy.token, small, { sameSecond: true })).status);
  assert.deepEqual([...new Set(statuses)], [200]);
  const limited = await quote(credsBusy.token, small, { sameSecond: true });
  assert.deepEqual([limited.status, limited.body.error.code, limited.headers["retry-after"], limited.body.error.details.retry_after_seconds], [429, "RATE_LIMITED", "1", 1]);
  assert.equal((await quote(credsCalm.token, small, { sameSecond: true })).status, 200, "别的渠道不受影响");
  // 被拦下的那次不生成报价
  assert.equal((await api.db.owner.query("select count(*)::int as n from quote_logs where channel_id = $1", [busy.id])).rows[0].n, 50);
  api.clock.advance(1_000);
  assert.equal((await quote(credsBusy.token, small, { sameSecond: true })).status, 200, "下一秒恢复");
  // 查报价：每秒 10 次
  const id = (await quote(credsCalm.token, small)).body.quotes[0].quote_id;
  api.clock.advance(1_000);
  for (let i = 0; i < 10; i += 1) assert.equal((await sales("GET", `/sales/v1/quotes/${id}`, "/sales/v1/quotes/{id}", credsCalm.token, undefined, { sameSecond: true })).status, 200);
  const tooMany = await sales("GET", `/sales/v1/quotes/${id}`, "/sales/v1/quotes/{id}", credsCalm.token, undefined, { sameSecond: true });
  assert.equal(tooMany.status, 429);
});

test("渠道暂停（复核批准后）：已经发出的令牌、换令牌都是 403 CHANNEL_PAUSED；重新启用后恢复", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "暂停渠道" });
  const creds = await salesCredentials(api, m, channel.id, "198.51.100.81");
  assert.equal((await quote(creds.token)).status, 200);
  await approvedBy(api, m, api.call("POST", `/platform/v1/channels/${channel.id}/pause`, { token: m.staff.cm1.token, body: {} }));
  const paused = await quote(creds.token);
  assert.deepEqual([paused.status, paused.body.error.code], [403, "CHANNEL_PAUSED"]);
  api.clock.advance(1_000);
  const token = await api.call("POST", "/sales/v1/oauth/token", { ip: "198.51.100.81", body: { grant_type: "client_credentials", client_id: creds.clientId, client_secret: creds.secret } });
  assert.deepEqual([token.status, token.body.error.code], [403, "CHANNEL_PAUSED"]);
  await ok(api.call("POST", `/platform/v1/channels/${channel.id}/activate`, { token: m.staff.cm1.token }));
  assert.equal((await quote(creds.token)).status, 200);
});

test("租户端（规则 4）：逐个 /tenant/v1 接口的应答里没有渠道、对外价、加价比例、报价编号；租户角色在数据库里碰不到渠道的任何一张表", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "秘密渠道 XYZ" });
  await approvedBy(api, m, ruleRequest(api, m, channel.id, { tenant_id: m.a.tenantId, markup_bp: 1_777 }));
  const creds = await salesCredentials(api, m, channel.id, "198.51.100.91");
  const quoteId = (await quote(creds.token)).body.quotes[0].quote_id as string;
  const leaks = [channel.id, "秘密渠道 XYZ", quoteId, creds.clientId, "1777"];
  // 「sellable_days」（可售天数）是库存的概念，不是对外价：按整词匹配
  const forbiddenKeys = /markup|^sell$|sell_price|sell_exact|selling|channel|quote_id|margin|band_bp|buffer|winner|rank_price/i;
  const product = m.ids.pa;
  const fill = (path: string): string => path.replace(":id", product).replace(":ruleId", "99999999-9999-4999-8999-999999999999");
  const scanned: string[] = [];
  for (const route of api.app.registeredRoutes) {
    if (route.method !== "GET" || !route.path.startsWith("/tenant/v1/")) continue;
    const query = route.path.includes("inventory") || route.path.includes("price-calendar") ? "?from=2026-10-20&to=2026-10-21" : "";
    const res = await api.call("GET", `${fill(route.path)}${query}`, { token: m.a.adminToken });
    scanned.push(`${route.path} ${res.status}`);
    for (const leak of leaks) assert.ok(!res.text.includes(leak), `${route.path} 的应答里出现了 ${leak}`);
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(res.text);
    } catch {
      parsed = null;
    }
    assert.deepEqual([...allKeys(parsed)].filter((key) => forbiddenKeys.test(key)), [], route.path);
  }
  assert.ok(scanned.length >= 20, `只扫到了 ${scanned.length} 个接口`);
  const preview = await api.call("POST", `/tenant/v1/products/${product}/quote-preview`, { token: m.a.adminToken, body: { dropoff: DROPOFF, direction: "pickup", service_time: "2026-10-20T10:00", passengers: 2 } });
  assert.equal(preview.status, 200, preview.text);
  assert.deepEqual([...allKeys(preview.body)].filter((key) => forbiddenKeys.test(key)), []);
  for (const leak of leaks) assert.ok(!preview.text.includes(leak));
  for (const table of ["channels", "channel_tenants", "channel_cities", "markup_rules", "approvals", "channel_api_clients", "quote_logs", "quotes", "sales_rate_limits"]) {
    await assert.rejects(withTenantTx(api.db.pool, m.a.tenantId, (db) => db.query(`select * from ${table} limit 1`)), deniedByDatabase, table);
  }
});
