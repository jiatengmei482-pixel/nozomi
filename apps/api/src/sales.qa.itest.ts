/**
 * M2-04 测试角色补充：`/sales/v1` 的安全边界（ADR 0023），经真实接口、真实 PostgreSQL。
 * - 令牌：2 小时边界、伪造（换渠道、换代次、换签名密钥、alg none、改内容）、轮换宽限期 24 小时的两端、吊销只影响那一个客户端、暂停时密钥不对仍是 401；
 * - 测试状态的渠道可以联调询价；
 * - 限流按渠道（同一渠道几个客户端共用额度）、询价和查报价各算各的、换令牌按来源地址；
 * - 授权范围收窄立即生效（不受 30 秒目录缓存影响）；暂停的供应商最迟 30 秒后不参加（ADR 0020），渠道只看到 NOT_AVAILABLE；
 * - 应答字段白名单（跨币种也只有对外价和中央汇率），别的渠道的过期报价也是 404；
 * - 用车日期按城市当地时间匹配促销规则（跨午夜两端）；观察期 ×1.05 和渠道的价格带 δ 的组合；跨币种的最低毛利 + 向上取整；
 * - 日志、库里没有密钥原文和访问令牌。
 * 测试数据在 testing/market.ts 和这里构造，结束时连同 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, hkdfSync, randomUUID } from "node:crypto";
import type { CurrencyCode, FxQuote, TenantStanding } from "@nozomi/domain";
import { signSalesToken } from "./auth/token.ts";
import { type ApiResponse, type HttpMethod, TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { FAKE_SECRETS } from "./testing/fixtures.ts";
import { type Market, DROPOFF, SERVICE_TIME, approvedBy, buildMarket, newChannel, ok, ruleRequest, salesCredentials } from "./testing/market.ts";
import { assertMatchesOperation } from "./testing/openapi.ts";

let api: TestApi;
let m: Market;
/** 观察期 / 评分的替身：默认每个租户都是默认身份；个别测试临时改 */
const standings = new Map<string, TenantStanding>();
/** 汇率替身：1 日元 = 0.0067 美元（只给这一个方向） */
const fxQuote = async (from: CurrencyCode, to: CurrencyCode, at: Date): Promise<FxQuote | null> => (from === "JPY" && to === "USD" ? { from, to, rate: "0.0067", asOf: at.toISOString() } : null);

before(async () => {
  api = await createTestApi({
    quote: {
      fx: { quote: fxQuote },
      standings: { load: async (_db, ids) => new Map(ids.map((id) => [id, standings.get(id) ?? { scoreCenti: null, completedOrders: 0, observation: false }])) },
    },
  });
  m = await buildMarket(api);
});
after(() => api.close());

const ask = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, direction: "pickup", dropoff: DROPOFF, service_time: SERVICE_TIME, passengers: 2, luggage: 1, currency: "JPY", ...extra });

async function sales(method: HttpMethod, url: string, template: string, token: string | undefined, body?: unknown, options: { sameSecond?: boolean } = {}): Promise<ApiResponse> {
  if (!options.sameSecond) api.clock.advance(1_000);
  const res = await api.call(method, url, { ...(token === undefined ? {} : { token }), ...(body === undefined ? {} : { body }) });
  assertMatchesOperation(method, template, res.status, res.body);
  return res;
}
const quote = (token: string, body: Record<string, unknown> = ask(), options: { sameSecond?: boolean } = {}) => sales("POST", "/sales/v1/quotes", "/sales/v1/quotes", token, body, options);
/** 令牌有效时查一个不存在的报价是 404，无效时 401：用来探测令牌状态（不占询价额度） */
const probe = (token: string, options: { sameSecond?: boolean } = {}) => sales("GET", "/sales/v1/quotes/QT20261007AAAAAAAAAA", "/sales/v1/quotes/{id}", token, undefined, options);
const exchange = (clientId: string, secret: string, ip: string, options: { sameSecond?: boolean } = {}) => sales("POST", "/sales/v1/oauth/token", "/sales/v1/oauth/token", undefined, { grant_type: "client_credentials", client_id: clientId, client_secret: secret }, options);

async function relogin(email: string): Promise<string> {
  return (await ok(api.call("POST", "/platform/v1/auth/login", { body: { email, password: TEST_PASSWORD } }))).access_token as string;
}

const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");

test("测试状态的渠道可以换令牌、询价、查报价（ADR 0023：测试 = 可以调接口联调；只有暂停才拒绝）", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "QA 联调渠道" });
  assert.equal(channel.status, "testing");
  const creds = await salesCredentials(api, m, channel.id, "198.51.100.101");
  const res = await quote(creds.token);
  assert.equal(res.status, 200, res.text);
  assert.ok(res.body.quotes.length > 0);
  assert.equal((await sales("GET", `/sales/v1/quotes/${res.body.quotes[0].quote_id}`, "/sales/v1/quotes/{id}", creds.token)).status, 200);
});

test("访问令牌 2 小时：到点前 1 秒还能用，到点那一刻起 401 UNAUTHENTICATED", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "QA 令牌有效期" });
  const creds = await salesCredentials(api, m, channel.id, "198.51.100.102");
  api.clock.advance(2 * 3_600_000 - 1_000);
  assert.equal((await probe(creds.token, { sameSecond: true })).status, 404, "还在 2 小时内");
  api.clock.advance(1_000);
  const expired = await probe(creds.token, { sameSecond: true });
  assert.deepEqual([expired.status, expired.body.error.code], [401, "UNAUTHENTICATED"]);
});

test("伪造令牌：换成别的渠道、换代次、不存在的客户端、改内容不改签名、alg none、平台受众的密钥签、别的密钥签——全部 401，且应答一样", async () => {
  const channelA = await newChannel(api, m.staff.cm1.token, { name: "QA 伪造 A" });
  const channelB = await newChannel(api, m.staff.cm1.token, { name: "QA 伪造 B" });
  const a = await salesCredentials(api, m, channelA.id, "198.51.100.103");
  const genuine = await probe(a.token);
  assert.equal(genuine.status, 404);
  const iat = Math.floor(api.clock.now().getTime() / 1000);
  const claims = { aud: "sales" as const, sub: a.id, cid: channelA.id, gen: 1, iat, exp: iat + 7_200 };
  // 用真的签名密钥签：内容不一致也要被数据库核对挡住
  const forged = {
    "换成渠道 B": signSalesToken(FAKE_SECRETS.authJwtSecret, { ...claims, cid: channelB.id }),
    "代次 +1": signSalesToken(FAKE_SECRETS.authJwtSecret, { ...claims, gen: 2 }),
    "代次 0": signSalesToken(FAKE_SECRETS.authJwtSecret, { ...claims, gen: 0 }),
    "不存在的客户端": signSalesToken(FAKE_SECRETS.authJwtSecret, { ...claims, sub: randomUUID() }),
    "别的签名密钥": signSalesToken("another-secret-0123456789abcdef-0123456789", claims),
  } as Record<string, string>;
  const [header, , signature] = a.token.split(".") as [string, string, string];
  forged["改内容不改签名"] = `${header}.${b64({ ...claims, cid: channelB.id })}.${signature}`;
  forged["alg none"] = `${b64({ alg: "none", typ: "JWT" })}.${b64(claims)}.`;
  const platformKey = Buffer.from(hkdfSync("sha256", FAKE_SECRETS.authJwtSecret, Buffer.alloc(0), "nozomi/access-token/platform/v1", 32));
  const platformInput = `${header}.${b64(claims)}`;
  forged["平台受众的密钥签"] = `${platformInput}.${createHmac("sha256", platformKey).update(platformInput).digest("base64url")}`;
  const bodies = new Set<string>();
  for (const [name, token] of Object.entries(forged)) {
    const res = await probe(token);
    assert.equal(res.status, 401, `${name}: ${res.text}`);
    bodies.add(JSON.stringify(res.body));
    const asked = await quote(token);
    assert.equal(asked.status, 401, name);
  }
  assert.equal(bodies.size, 1, "各种伪造的应答不能有区别");
  // 没有令牌、格式不对
  assert.equal((await sales("POST", "/sales/v1/quotes", "/sales/v1/quotes", undefined, ask())).status, 401);
  api.clock.advance(1_000);
  assert.equal((await api.call("POST", "/sales/v1/quotes", { headers: { authorization: `Basic ${a.token}` }, body: ask() })).status, 401);
});

test("吊销一个客户端不影响同渠道的另一个客户端；暂停的渠道密钥不对仍是 401（不对没有密钥的人透露渠道状态）；吊销的客户端在暂停渠道上也是 401", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "QA 吊销隔离" });
  const first = await salesCredentials(api, m, channel.id, "198.51.100.104");
  const second = await salesCredentials(api, m, channel.id, "198.51.100.104");
  await ok(api.call("POST", `/platform/v1/channels/${channel.id}/api-clients/${first.id}/revoke`, { token: m.staff.cm1.token }));
  assert.equal((await probe(first.token)).status, 401);
  assert.equal((await probe(second.token)).status, 404, "另一个客户端照常");
  await approvedBy(api, m, api.call("POST", `/platform/v1/channels/${channel.id}/pause`, { token: m.staff.cm1.token, body: {} }));
  const wrong = await exchange(second.clientId, `${second.secret}x`, "198.51.100.104");
  assert.deepEqual([wrong.status, wrong.body.error.code], [401, "INVALID_CLIENT"]);
  const revoked = await exchange(first.clientId, first.secret, "198.51.100.104");
  assert.deepEqual([revoked.status, revoked.body.error.code], [401, "INVALID_CLIENT"]);
  const right = await exchange(second.clientId, second.secret, "198.51.100.104");
  assert.deepEqual([right.status, right.body.error.code], [403, "CHANNEL_PAUSED"]);
});

test("限流按渠道：同一渠道的两个客户端共用每秒 50 次；询价和查报价各算各的；换令牌按来源地址（换不同的客户端也共用 10 次）", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "QA 限流共用" });
  const one = await salesCredentials(api, m, channel.id, "198.51.100.105");
  const two = await salesCredentials(api, m, channel.id, "198.51.100.106");
  const small = ask({ vehicle_group_ids: [m.ids.eco4] });
  api.clock.advance(1_000);
  const statuses: number[] = [];
  for (let i = 0; i < 25; i += 1) {
    statuses.push((await quote(one.token, small, { sameSecond: true })).status);
    statuses.push((await quote(two.token, small, { sameSecond: true })).status);
  }
  assert.deepEqual([...new Set(statuses)], [200]);
  const limitedOne = await quote(one.token, small, { sameSecond: true });
  const limitedTwo = await quote(two.token, small, { sameSecond: true });
  assert.deepEqual([limitedOne.status, limitedTwo.status], [429, 429], "第 51、52 次：不管用哪个客户端都被拦");
  // 同一秒里查报价的额度没有被询价占掉
  assert.equal((await probe(one.token, { sameSecond: true })).status, 404);
  // 换令牌：同一个来源地址换两个不同的客户端，合计第 11 次 429
  const other = await newChannel(api, m.staff.cm1.token, { name: "QA 限流换令牌" });
  const x = await ok(api.call("POST", `/platform/v1/channels/${other.id}/api-clients`, { token: m.staff.cm1.token, body: { name: "X" } }), 201);
  const y = await ok(api.call("POST", `/platform/v1/channels/${other.id}/api-clients`, { token: m.staff.cm1.token, body: { name: "Y" } }), 201);
  api.clock.advance(1_000);
  const exchanged: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    exchanged.push((await exchange(x.api_client.client_id, x.client_secret, "203.0.113.77", { sameSecond: true })).status);
    exchanged.push((await exchange(y.api_client.client_id, y.client_secret, "203.0.113.77", { sameSecond: true })).status);
  }
  assert.deepEqual([...new Set(exchanged)], [200]);
  const eleventh = await exchange(y.api_client.client_id, y.client_secret, "203.0.113.77", { sameSecond: true });
  assert.deepEqual([eleventh.status, eleventh.headers["retry-after"]], [429, "1"]);
});

test("收窄授权范围立即生效：同一个 30 秒缓存窗口里，去掉的租户下一次询价就不参加；城市、品类去掉后立即 422", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "QA 收窄授权", scope: { tenant_scope: "allow", tenant_ids: [m.a.tenantId, m.b.tenantId] } });
  const creds = await salesCredentials(api, m, channel.id, "198.51.100.107");
  const bizOnly = ask({ vehicle_group_ids: [m.ids.biz7] });
  const before = await quote(creds.token, bizOnly);
  assert.equal(before.body.quotes[0].price.total.amount, "21780", "乙 19,800 × 1.10 中标");
  const patch = (version: number, scope: Record<string, unknown>) => ok(api.call("PATCH", `/platform/v1/channels/${channel.id}`, { token: m.staff.cm1.token, headers: { "if-match": `"${version}"` }, body: { scope } }));
  let current = (await patch(channel.version, { tenant_scope: "allow", tenant_ids: [m.a.tenantId] })).channel;
  const afterNarrow = await quote(creds.token, bizOnly);
  assert.equal(afterNarrow.body.quotes[0].price.total.amount, "22000", "乙已经不在授权范围里，甲中标");
  const winner = (await api.db.owner.query("select winner_tenant_id from quotes where id = $1", [afterNarrow.body.quotes[0].quote_id])).rows[0].winner_tenant_id;
  assert.equal(winner, m.a.tenantId);
  current = (await patch(current.version, { tenant_scope: "allow", tenant_ids: [m.a.tenantId], city_ids: [m.ids.osaka] })).channel;
  const city = await quote(creds.token, bizOnly);
  assert.deepEqual([city.status, city.body.error?.code], [422, "CHANNEL_SCOPE_DENIED"]);
  await patch(current.version, { tenant_scope: "allow", tenant_ids: [m.a.tenantId], categories: ["charter"] });
  const category = await quote(creds.token, bizOnly);
  assert.deepEqual([category.status, category.body.error?.details?.reason], [422, "CATEGORY_NOT_AUTHORIZED"]);
});

test("暂停的供应商：最迟 30 秒（ADR 0020 的目录缓存）后不再参加；渠道只看到 NOT_AVAILABLE，看不到 TENANT_SUSPENDED", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "QA 暂停供应商", scope: { tenant_scope: "allow", tenant_ids: [m.b.tenantId] } });
  const creds = await salesCredentials(api, m, channel.id, "198.51.100.108");
  const bizOnly = ask({ vehicle_group_ids: [m.ids.biz7] });
  assert.equal((await quote(creds.token, bizOnly)).body.quotes.length, 1);
  await ok(api.call("POST", `/platform/v1/tenants/${m.b.tenantId}/suspend`, { token: m.root, body: { reason: "QA" } }));
  try {
    api.clock.advance(31_000);
    const res = await quote(creds.token, bizOnly);
    assert.deepEqual(res.body, { quotes: [], unavailable: [{ vehicle_group_id: m.ids.biz7, reasons: ["NOT_AVAILABLE"] }] });
    assert.ok(!res.text.includes("SUSPENDED"));
    const log = (await api.db.owner.query("select rejects from quote_logs where channel_id = $1 order by created_at desc limit 1", [channel.id])).rows[0];
    assert.ok(JSON.stringify(log.rejects).includes("TENANT_SUSPENDED"), "完整原因在询价日志里");
  } finally {
    await ok(api.call("POST", `/platform/v1/tenants/${m.b.tenantId}/resume`, { token: m.root }));
    api.clock.advance(31_000);
  }
});

test("跨币种询价：最低毛利（日元）按中央汇率换成美元补足，再按 1 美元向上取整；应答字段是白名单，只有对外价和中央汇率", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "QA 跨币种" });
  await approvedBy(api, m, api.call("POST", `/platform/v1/channels/${channel.id}/pricing-changes`, { token: m.staff.cm1.token, body: { min_margin: 3_000, sell_rounding: { USD: 100 } } }));
  const creds = await salesCredentials(api, m, channel.id, "198.51.100.109");
  const res = await quote(creds.token, ask({ currency: "USD", vehicle_group_ids: [m.ids.biz7] }));
  assert.equal(res.status, 200, res.text);
  // 乙：19,800 × 0.0067 × 1.015 = 134.6499；加价 10% = 13.46499 < 最低毛利 3,000 日元 = 20.10 美元 → 154.7499 → 向上取整到 155.00
  // 甲：20,000 × 0.0067 × 1.015 = 136.01 → +20.10 = 156.11 → 157.00；都在 3% 价格带里、评分一样 → 排序价低的乙
  const [q] = res.body.quotes;
  assert.deepEqual(q.price, { total: { amount: "155.00", currency: "USD" }, fx: { rate: "0.0067", as_of: q.price.fx.as_of } });
  assert.deepEqual(Object.keys(q).sort(), ["created_at", "expires_at", "free_wait_minutes", "package_hours", "price", "quote_id", "service_date", "urgent", "vehicle_group_id"]);
  assert.deepEqual(Object.keys(res.body).sort(), ["quotes", "unavailable"]);
  const row = (await api.db.owner.query("select sell_minor, settlement_minor, winner_tenant_id, snapshot from quotes where id = $1", [q.quote_id])).rows[0];
  assert.deepEqual([Number(row.sell_minor), Number(row.settlement_minor), row.winner_tenant_id, row.snapshot.winner.sell.channel.minMarginApplied, row.snapshot.winner.sell.channel.minMarginMinor], [15_500, 19_800, m.b.tenantId, true, 2_010]);
  for (const leak of ["19800", "134.6499", "154.7499", "1.015", m.b.tenantId]) assert.ok(!res.text.includes(leak), `应答里出现了 ${leak}`);
  const found = await sales("GET", `/sales/v1/quotes/${q.quote_id}`, "/sales/v1/quotes/{id}", creds.token);
  assert.deepEqual(Object.keys(found.body).sort(), ["quote"]);
  assert.deepEqual(found.body.quote, q);
  // 没有汇率的币种：报不出，只说 NOT_AVAILABLE
  const cny = await quote(creds.token, ask({ currency: "CNY", vehicle_group_ids: [m.ids.biz7] }));
  assert.deepEqual(cny.body, { quotes: [], unavailable: [{ vehicle_group_id: m.ids.biz7, reasons: ["NOT_AVAILABLE"] }] });
});

test("观察期 ×1.05 与渠道的价格带 δ：乙在观察期、评分高；δ 3% 时乙的排序价在区间外、甲中标；δ 改成 4% 后乙进区间、按评分中标（客人付乙自己的对外价）", async () => {
  standings.set(m.b.tenantId, { scoreCenti: 490, completedOrders: 50, observation: true });
  try {
    const channel = await newChannel(api, m.staff.cm1.token, { name: "QA 观察期" });
    const creds = await salesCredentials(api, m, channel.id, "198.51.100.110");
    const bizOnly = ask({ vehicle_group_ids: [m.ids.biz7] });
    // 甲 22,000（排序价 22,000），乙 21,780（排序价 21,780 × 1.05 = 22,869）；基准 22,000：× 1.03 = 22,660 < 22,869，× 1.04 = 22,880 ≥ 22,869
    const at3 = await quote(creds.token, bizOnly);
    assert.equal(at3.body.quotes[0].price.total.amount, "22000");
    await approvedBy(api, m, api.call("POST", `/platform/v1/channels/${channel.id}/pricing-changes`, { token: m.staff.cm1.token, body: { band_bp: 400 } }));
    const at4 = await quote(creds.token, bizOnly);
    assert.equal(at4.body.quotes[0].price.total.amount, "21780");
    const snapshot = (await api.db.owner.query("select snapshot from quotes where id = $1", [at4.body.quotes[0].quote_id])).rows[0].snapshot;
    assert.deepEqual([snapshot.bandBp, snapshot.channel.bandBp, snapshot.candidates.map((c: any) => [c.tenantId, c.rankPrice, c.inBand, c.position])], [400, 400, [[m.b.tenantId, "22869", true, 1], [m.a.tenantId, "22000", true, 2]]]);
    // δ = 0：只有排序价最低的在区间里
    await approvedBy(api, m, api.call("POST", `/platform/v1/channels/${channel.id}/pricing-changes`, { token: m.staff.cm1.token, body: { band_bp: 0 } }));
    assert.equal((await quote(creds.token, bizOnly)).body.quotes[0].price.total.amount, "22000");
  } finally {
    standings.delete(m.b.tenantId);
  }
});

test("促销规则按用车日期（城市当地）匹配，两端都含：UTC 时间跨午夜换成东京时间后落在哪一天就用哪一天的规则", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "QA 当地日期" });
  await approvedBy(api, m, ruleRequest(api, m, channel.id, { city_id: m.ids.tokyo, category: "airport_transfer", markup_bp: 1_500, valid_from: "2026-10-20", valid_to: "2026-10-20" }));
  const creds = await salesCredentials(api, m, channel.id, "198.51.100.111");
  const eco = async (serviceTime: string): Promise<[string, string]> => {
    const res = await quote(creds.token, ask({ service_time: serviceTime, vehicle_group_ids: [m.ids.eco4] }));
    assert.equal(res.status, 200, res.text);
    return [res.body.quotes[0].service_date, res.body.quotes[0].price.total.amount];
  };
  // 经济 4 座只有甲 12,000：促销日 15% → 13,800，其余日子渠道默认 10% → 13,200
  assert.deepEqual(await eco("2026-10-19T14:59:00Z"), ["2026-10-19", "13200"], "东京 10-19 23:59");
  assert.deepEqual(await eco("2026-10-19T15:00:00Z"), ["2026-10-20", "13800"], "东京 10-20 00:00（UTC 还是 10-19）");
  assert.deepEqual(await eco("2026-10-20T23:59:00+09:00"), ["2026-10-20", "13800"], "东京 10-20 23:59");
  assert.deepEqual(await eco("2026-10-20T15:00:00Z"), ["2026-10-21", "13200"], "东京 10-21 00:00（UTC 还是 10-20）");
  assert.deepEqual(await eco("2026-10-20T08:00:00-07:00"), ["2026-10-21", "13200"], "别的时区写法：东京 10-21 00:00");
});

test("别的渠道的报价过期之后也是 404（不能用 410 和 404 区分「存在但过期」和「不存在」）；本渠道到期前 1 毫秒还是 200", async () => {
  const channelA = await newChannel(api, m.staff.cm1.token, { name: "QA 过期隔离 A" });
  const channelB = await newChannel(api, m.staff.cm1.token, { name: "QA 过期隔离 B" });
  const a = await salesCredentials(api, m, channelA.id, "198.51.100.112");
  const b = await salesCredentials(api, m, channelB.id, "198.51.100.113");
  const fromB = (await quote(b.token)).body.quotes[0];
  api.clock.advance(new Date(fromB.expires_at).getTime() - api.clock.now().getTime() - 1);
  assert.equal((await sales("GET", `/sales/v1/quotes/${fromB.quote_id}`, "/sales/v1/quotes/{id}", b.token, undefined, { sameSecond: true })).status, 200, "到期前 1 毫秒");
  api.clock.advance(1);
  assert.equal((await sales("GET", `/sales/v1/quotes/${fromB.quote_id}`, "/sales/v1/quotes/{id}", b.token, undefined, { sameSecond: true })).status, 410);
  // a 的令牌是 2 小时的：30 分钟后还有效
  const crossed = await sales("GET", `/sales/v1/quotes/${fromB.quote_id}`, "/sales/v1/quotes/{id}", a.token);
  const missing = await sales("GET", "/sales/v1/quotes/QT20261007ZZZZZZZZZZ", "/sales/v1/quotes/{id}", a.token);
  assert.deepEqual([crossed.status, crossed.body], [404, missing.body]);
});

test("日志、库里没有密钥原文和访问令牌：换令牌失败（表单写错、密钥错）时也不记；限流表里没有来源地址原文", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "QA 日志密钥" });
  const issued = await ok(api.call("POST", `/platform/v1/channels/${channel.id}/api-clients`, { token: m.staff.cm1.token, body: { name: "日志" } }), 201);
  const secret = issued.client_secret as string;
  const clientId = issued.api_client.client_id as string;
  api.clock.advance(1_000);
  const badForm = await api.app.inject({ method: "POST", url: "/sales/v1/oauth/token", remoteAddress: "192.0.2.201", headers: { "content-type": "application/x-www-form-urlencoded" }, payload: new URLSearchParams({ grant_type: "password", client_id: clientId, client_secret: secret }).toString() });
  assert.equal(badForm.statusCode, 400);
  assert.ok(!badForm.body.includes(secret), "错误应答里不能回显密钥");
  const badJson = await exchange(clientId, `${secret}-`, "192.0.2.201");
  assert.equal(badJson.status, 401);
  assert.ok(!badJson.text.includes(secret));
  const good = await exchange(clientId, secret, "192.0.2.201");
  const token = good.body.access_token as string;
  assert.equal((await quote(token)).status, 200);
  const logs = api.logs();
  assert.ok(!logs.includes(secret), "日志里有密钥原文");
  assert.ok(!logs.includes(token), "日志里有访问令牌");
  const dump = JSON.stringify((await api.db.owner.query("select * from quote_logs where channel_id = $1", [channel.id])).rows) + JSON.stringify((await api.db.owner.query("select * from audit_logs")).rows) + JSON.stringify((await api.db.owner.query("select * from channel_api_clients")).rows);
  assert.ok(!dump.includes(secret) && !dump.includes(token));
  const buckets = (await api.db.owner.query("select bucket from sales_rate_limits")).rows.map((row) => row.bucket as string);
  assert.ok(buckets.length > 0);
  assert.ok(!buckets.some((bucket) => bucket.includes("192.0.2.201")), "限流表里有来源地址原文");
});

test("宽限期里再轮换一次（没选「立即作废」）：渠道还在用的最早那把密钥和它换的令牌照常可用，各代各自从被换下起算 24 小时", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "QA 连续轮换" });
  const creds = await salesCredentials(api, m, channel.id, "198.51.100.115");
  const rotateUrl = `/platform/v1/channels/${channel.id}/api-clients/${creds.id}/rotate`;
  api.clock.advance(1_000);
  await ok(api.call("POST", rotateUrl, { token: m.staff.cm1.token, body: {} }));
  // 运营没保存好第一次轮换出来的新密钥，又轮换一次（同样没选「立即作废」）；渠道这时还在用最早那把
  api.clock.advance(60_000);
  await ok(api.call("POST", rotateUrl, { token: m.staff.cm1.token, body: {} }));
  const token = await probe(creds.token);
  const exchanged = await exchange(creds.clientId, creds.secret, "198.51.100.115");
  assert.deepEqual([token.status, exchanged.status], [404, 200], "页面写着「旧密钥默认还能用 24 小时」：第一次轮换后才过 1 分钟，渠道还在用的密钥不该被作废");
});

test("轮换的 24 小时宽限期两端：到点前 1 毫秒旧密钥能换令牌、轮换前的旧令牌能用；到点那一刻起旧密钥 401、旧令牌 401，新密钥照常", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "QA 宽限期两端" });
  const creds = await salesCredentials(api, m, channel.id, "198.51.100.114");
  api.clock.advance(1_000);
  const rotated = await ok(api.call("POST", `/platform/v1/channels/${channel.id}/api-clients/${creds.id}/rotate`, { token: m.staff.cm1.token, body: {} }));
  const graceEnds = new Date(rotated.api_client.previous_valid_until).getTime();
  assert.equal(graceEnds - api.clock.now().getTime(), 24 * 3_600_000);
  // 旧令牌（2 小时）在宽限期末早已过期；换一个宽限期内用旧密钥换的令牌来测「轮换前那一代」的令牌
  api.clock.advance(graceEnds - api.clock.now().getTime() - 1_000);
  const lateOld = await exchange(creds.clientId, creds.secret, "198.51.100.114", { sameSecond: true });
  assert.equal(lateOld.status, 200, "到点前 1 秒旧密钥还能换");
  api.clock.advance(999);
  assert.equal((await probe(lateOld.body.access_token, { sameSecond: true })).status, 404, "到点前 1 毫秒旧代次的令牌还能用");
  api.clock.advance(1);
  assert.equal((await probe(lateOld.body.access_token, { sameSecond: true })).status, 401, "到点那一刻旧代次的令牌失效");
  const atEnd = await exchange(creds.clientId, creds.secret, "198.51.100.114", { sameSecond: true });
  assert.deepEqual([atEnd.status, atEnd.body.error.code], [401, "INVALID_CLIENT"]);
  const fresh = await exchange(creds.clientId, rotated.client_secret, "198.51.100.114", { sameSecond: true });
  assert.equal(fresh.status, 200);
  assert.equal((await probe(fresh.body.access_token, { sameSecond: true })).status, 404);
  // 平台会话早过期了：重新登录还能管理
  assert.ok((await relogin(m.staff.cm1.email)).length > 0);
});
