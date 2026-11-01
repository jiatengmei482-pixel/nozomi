/**
 * M5-02 新增币种 SGD 的回归（ADR 0051「币种」）：汇率中心、子品牌、渠道、汇率锁定、上线前没有 SGD 的旧批次、汇率源缺 SGD。
 * 数据源是本机的假服务器；每个测试一个独立的 schema，结束即删。
 */
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { type FakeFxSource, fxSourceBody, startFakeFxSource } from "./testing/fx-source.ts";
import { DROPOFF, type Market, addStaff, buildMarket, ok } from "./testing/market.ts";

const HOUR = 3_600_000;
const T0 = new Date("2026-10-07T00:00:00.000Z");
const RATES = { JPY: "150", CNY: "7.2", KRW: "1400", HKD: "7.8", TWD: "32", THB: "36", SGD: "1.35" };
const { SGD: _sgd, ...WITHOUT_SGD } = RATES;

let api: TestApi;
let source: FakeFxSource;
let m: Market;

beforeEach(async () => {
  source = await startFakeFxSource();
  api = await createTestApi({ env: { FX_SOURCE_URL: source.url, FX_AUTO_FETCH: "true" } });
  m = await buildMarket(api);
});
afterEach(async () => {
  await api.close();
  await source.close();
});

const fetchNow = async (asOf: Date, rates: Record<string, string>): Promise<any> => {
  source.respond({ body: fxSourceBody({ asOf, rates }) });
  return (await ok(api.call("POST", "/platform/v1/fx-rates/fetch", { token: m.root }))).fetch;
};
const board = async (): Promise<any> => ok(api.call("GET", "/platform/v1/fx-rates", { token: m.root }));
const rateOf = (overview: any, currency: string): string | null => overview.rates.find((item: any) => item.currency === currency)?.rate ?? null;
const previewIn = async (currency: string): Promise<any> => ok(api.call("POST", "/platform/v1/quotes/preview", { token: m.root, body: { city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, currency, direction: "pickup", dropoff: DROPOFF, service_time: "2026-11-20T10:00", passengers: 2, luggage: 1 } }));

/** 上线前的状态：现在用的那批汇率里没有 SGD（先拉一批，再删掉 SGD 那一行，模拟旧数据）。 */
async function legacyBatch(): Promise<void> {
  assert.equal((await fetchNow(T0, RATES)).status, "accepted");
  await api.db.owner.query("delete from fx_rates where quote = 'SGD'");
  api.app.fxCenter.invalidate();
}

test("上线前没有 SGD 的旧批次：看板和租户接口正常、SGD 显示没有汇率；别的币种照常报价；跨币种到 SGD 明确拒绝，不是 500", async () => {
  await legacyBatch();
  const overview = await board();
  assert.equal(overview.state, "fresh");
  assert.equal(rateOf(overview, "SGD"), null);
  assert.ok(rateOf(overview, "JPY") !== null);
  assert.equal(overview.cross.find((item: any) => item.from === "SGD" && item.to === "JPY").rate, null);
  assert.equal((await ok(api.call("GET", "/tenant/v1/fx-rates", { token: m.a.adminToken }))).state, "fresh");

  const cny = await previewIn("CNY");
  assert.ok(cny.groups.flatMap((group: any) => group.candidates).length > 0, "旧币种照常报价");
  assert.equal(cny.refused.length, 0);
  const sgd = await previewIn("SGD");
  assert.equal(sgd.groups.flatMap((group: any) => group.candidates).length, 0);
  assert.ok(sgd.refused.length > 0 && sgd.refused.every((entry: any) => entry.reason === "FX_RATE_UNAVAILABLE"), JSON.stringify(sgd.refused));



});

test("旧批次之后第一批带 SGD 的：直接生效，不算跳变，不用人工确认；之后 SGD 跳变 3% 以上照样挂起", async () => {
  await legacyBatch();
  const first = await fetchNow(new Date(T0.getTime() + 0.5 * HOUR), RATES);
  assert.equal(first.status, "accepted", JSON.stringify(first));
  assert.equal(rateOf(await board(), "SGD"), "1.35");
  assert.ok((await previewIn("SGD")).groups.flatMap((group: any) => group.candidates).length > 0, "SGD 能报价了");
  const held = await fetchNow(new Date(T0.getTime() + 0.75 * HOUR), { ...RATES, SGD: "1.5" });
  assert.equal(held.status, "held");
  assert.deepEqual(held.jumps.map((jump: any) => jump.currency), ["SGD"]);
  assert.equal(rateOf(await board(), "SGD"), "1.35", "挂起时还用旧值");
});

test("汇率锁定：旧批次没有 SGD 时不能锁（明确的校验错误，不是 500）；有了之后能锁，报价用锁定值", async () => {
  await legacyBatch();
  const expiresAt = new Date(api.clock.now().getTime() + 24 * HOUR).toISOString();
  const refused = await api.call("POST", "/platform/v1/fx-rates/locks", { token: m.root, body: { currency: "SGD", rate: "1.36", expires_at: expiresAt, reason: "财务要求" } });
  assert.ok(refused.status >= 400 && refused.status < 500, `应该是 4xx，实际 ${refused.status}：${refused.text.slice(0, 200)}`);

  assert.equal((await fetchNow(new Date(T0.getTime() + 0.5 * HOUR), RATES)).status, "accepted");
  const requested = await api.call("POST", "/platform/v1/fx-rates/locks", { token: m.root, body: { currency: "SGD", rate: "1.36", expires_at: expiresAt, reason: "财务要求" } });
  assert.equal(requested.status, 202, requested.text);
  const reviewer = await addStaff(api, m.root, "qa-fx-review@platform.test", "super_admin");
  await ok(api.call("POST", `/platform/v1/approvals/${requested.body.approval.id}/approve`, { token: reviewer.token, body: {} }));
  const overview = await board();
  const sgd = overview.rates.find((item: any) => item.currency === "SGD");
  assert.deepEqual([sgd.rate, sgd.locked], ["1.36", true]);
  assert.equal((await ok(api.call("GET", "/tenant/v1/fx-rates", { token: m.a.adminToken }))).rates.find((item: any) => item.currency === "SGD").rate, "1.35", "租户看中央汇率");
});

test("汇率源缺 SGD：整批拒收、记清楚缺什么；旧汇率继续用、报价不停；首页和集成状态看得到；过 48 小时过期时告警一次（通知 + 审计 + 日志）", async () => {
  assert.equal((await fetchNow(T0, RATES)).status, "accepted");
  const rejected = await fetchNow(new Date(T0.getTime() + 0.5 * HOUR), WITHOUT_SGD);
  assert.deepEqual([rejected.status, rejected.error_code], ["rejected", "FX_SOURCE_MISSING_CURRENCY"]);
  assert.match(rejected.error_detail, /SGD/);
  const overview = await board();
  assert.deepEqual([overview.state, overview.as_of, rateOf(overview, "JPY"), rateOf(overview, "SGD")], ["fresh", T0.toISOString(), "150", "1.35"]);
  assert.ok((await previewIn("CNY")).groups.flatMap((group: any) => group.candidates).length > 0, "数据源缺币种时报价不停");
  const summary = await ok(api.call("GET", "/platform/v1/dashboard/summary", { token: m.root }));
  assert.equal(summary.fx.last_attempt_status, "rejected");
  const integrations = await ok(api.call("GET", "/platform/v1/integrations", { token: m.root }));
  assert.equal(integrations.fx_center.last_error_code, "FX_SOURCE_MISSING_CURRENCY");
  assert.match(api.logs(), /FX_SOURCE_MISSING_CURRENCY/);

  // 一直缺：过期之后停跨币种报价，要有告警
  api.clock.advance(50 * HOUR);
  source.respond({ body: fxSourceBody({ asOf: new Date(api.clock.now().getTime() - HOUR), rates: WITHOUT_SGD }) });
  await api.app.fxCenter.tick();
  await api.app.fxCenter.tick();
  const token = (await ok(api.platformLogin({ body: { email: "root@platform.test", password: "Quiet-Harbor-2026" } }))).access_token;
  assert.equal((await ok(api.call("GET", "/platform/v1/fx-rates", { token }))).state, "stale");
  const events = await api.db.owner.query("select data from notification_events where event = 'fx.alert'");
  assert.equal(events.rows.filter((row: any) => row.data.kind === "stale").length, 1, "过期告警进通知中心，只一次");
  assert.equal((await api.db.owner.query("select count(*)::int as n from audit_logs where resource = 'fx_rate' and action = 'stale'")).rows[0].n, 1);
  assert.match(api.logs(), /fx\.stale/);
});

test("SGD 的子品牌、渠道结算币种都能建，EUR 仍不支持；SGD 子品牌的商品同币种报价不用汇率、金额按分计；旧的 JPY 商品不受影响", async () => {
  assert.equal((await fetchNow(T0, RATES)).status, "accepted");
  const brand = await api.call("POST", "/tenant/v1/brands", { token: m.a.adminToken, headers: { "idempotency-key": randomUUID() }, body: { name: "SGD 子品牌", currency: "SGD" } });
  assert.equal(brand.status, 201, brand.text);
  assert.equal(brand.body.currency, "SGD");
  const bad = await api.call("POST", "/tenant/v1/brands", { token: m.a.adminToken, headers: { "idempotency-key": randomUUID() }, body: { name: "欧元子品牌", currency: "EUR" } });
  assert.ok(bad.status >= 400 && bad.status < 500, "EUR 仍不支持");
  const channel = await api.call("POST", "/platform/v1/channels", { token: m.staff.cm1.token, body: { type: "own", settle_currency: "SGD", name: "新加坡渠道" } });
  assert.equal(channel.status, 201, channel.text);
  assert.equal(channel.body.channel.settle_currency, "SGD");

  // 乙的商品改成 SGD 子品牌（结算价 198.00 新元）；甲还是 JPY
  await api.db.owner.query("update brands set currency = 'SGD' where tenant_id = $1", [m.b.tenantId]);
  api.app.fxCenter.invalidate();
  const quote = await previewIn("SGD");
  const candidates = quote.groups.flatMap((group: any) => group.candidates);
  const own = candidates.find((candidate: any) => candidate.tenant_id === m.b.tenantId);
  const converted = candidates.find((candidate: any) => candidate.tenant_id === m.a.tenantId);
  assert.ok(own && converted, JSON.stringify(quote).slice(0, 400));
  assert.equal(own.fx, null, "同币种不用汇率");
  assert.ok(converted.fx !== null, "JPY 商品换算成 SGD 要带汇率");
  assert.equal(own.sell, 21_780, "19800 分（198.00 新元）加默认 10%，按最小单位是整数 21780（217.80 新元）");
  const jpy = await previewIn("JPY");
  assert.ok(jpy.groups.flatMap((group: any) => group.candidates).some((candidate: any) => candidate.tenant_id === m.a.tenantId && candidate.fx === null), "旧的 JPY 商品同币种报价照常");
});
