/**
 * 汇率中心（M2-03）：经真实接口、真实 PostgreSQL；数据源是本机的假服务器（测试不访问外网）。
 * - 拉取：生效、没变、数据源不可用（沿用旧值）、内容不对（不入库、记原因）、变动过大（挂起 → 确认 / 放弃）、同时点两次、中途中断；
 * - 定时任务：按数据源的频率拉，几个实例同时跑也只拉一次；
 * - 过期：超过 48 小时没更新，跨币种报价报 FX_RATE_UNAVAILABLE（同币种照常），首页、集成状态体现，审计日志只记一次；
 * - 报价快照里带着汇率中心给的汇率和取数时间；
 * - 租户只读当前汇率，没有缓冲、加价这类字段；每个接口的应答都和 openapi.yaml 对账。
 * 测试数据只在这里构造，结束时连同 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fxQuoteFromTable, sellPrice } from "@nozomi/domain";
import { buildApp } from "./app.ts";
import { loadMigrationFiles } from "./db/migrate.ts";
import { type ApiResponse, type HttpMethod, type TenantFixture, type TestApi, addTenantUser, createTestApi } from "./testing/api.ts";
import { type FakeFxSource, fxSourceBody, startFakeFxSource } from "./testing/fx-source.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { loadConfig } from "@nozomi/config";
import { testEnv } from "./testing/fixtures.ts";

let api: TestApi;
let source: FakeFxSource;
let root: string;
let tenantA: TenantFixture;
let tenantB: TenantFixture;
let readonlyToken: string;
let masterToken: string;
const ids: Record<string, string> = {};

/** 测试时钟的起点是 2026-10-07T01:00Z；数据源的第一批汇率是 00:00Z 的 */
const T0 = new Date("2026-10-07T00:00:00.000Z");
const RATES = { JPY: "150.000", CNY: "7.2", KRW: "1400", HKD: "7.8", TWD: "32", THB: "36" };
const hours = (n: number): number => n * 3_600_000;
const at = (base: Date, ms: number): Date => new Date(base.getTime() + ms);

/** 调一次接口，并和 openapi.yaml 对账。`template` 是定义里的路径写法。 */
async function call(method: HttpMethod, template: string, options: { token?: string; id?: string; query?: string; body?: unknown } = {}): Promise<ApiResponse> {
  const url = template.replace("{id}", options.id ?? "") + (options.query ? `?${options.query}` : "");
  const res = await api.call(method, url, { token: options.token ?? root, ...(options.body === undefined ? {} : { body: options.body }) });
  assertMatchesOpenApi(method, template, res);
  return res;
}
async function ok(res: Promise<ApiResponse>, status = 200): Promise<any> {
  const done = await res;
  assert.equal(done.status, status, done.text);
  return done.body;
}
const overview = (query = ""): Promise<any> => ok(call("GET", "/platform/v1/fx-rates", { query }));
const fetchNow = (token: string = root): Promise<ApiResponse> => call("POST", "/platform/v1/fx-rates/fetch", { token });
const serve = (asOf: Date, rates: Record<string, string> = RATES): void => source.respond({ body: fxSourceBody({ asOf, rates }) });
const owner = (sql: string, values: unknown[] = []): Promise<any> => api.db.owner.query(sql, values);
const login = async (portal: "platform" | "tenant", email: string): Promise<string> => {
  const options = { body: { email, password: "Quiet-Harbor-2026" } };
  return (await ok(portal === "platform" ? api.platformLogin(options) : api.call("POST", `/${portal}/v1/auth/login`, options))).access_token;
};
/** 时钟拨过 8 小时，令牌都过期了：重新登录 */
async function advance(ms: number): Promise<void> {
  api.clock.advance(ms);
  root = await login("platform", "root@platform.test");
  readonlyToken = await login("platform", "readonly@fx.test");
  masterToken = await login("platform", "master@fx.test");
  tenantA = { ...tenantA, adminToken: await login("tenant", tenantA.adminEmail) };
  tenantB = { ...tenantB, adminToken: await login("tenant", tenantB.adminEmail) };
}

// ---- 报价要用的最少配置：一个供应商两个子品牌（日元、人民币），各一个已上架的接送机商品 ----
const tenantCall = (method: HttpMethod, path: string, options: { body?: unknown; version?: number } = {}): Promise<ApiResponse> =>
  api.call(method, `/tenant/v1${path}`, {
    token: tenantA.adminToken,
    ...(options.body === undefined ? {} : { body: options.body }),
    headers: { ...(options.version === undefined ? {} : { "if-match": `"${options.version}"` }), ...(method === "POST" && /^\/(products|brands|areas)$|\/price-rules$/.test(path) ? { "idempotency-key": randomUUID() } : {}) },
  });
const version = async (productId: string): Promise<number> => (await ok(tenantCall("GET", `/products/${productId}`))).version;
async function product(brandId: string, areaId: string, basePrice: number): Promise<string> {
  api.clock.advance(1_000);
  const created = await ok(
    tenantCall("POST", "/products", { body: { brand_id: brandId, city_id: ids["tokyo"], category: "airport_transfer", poi_id: ids["narita"], areas: [{ area_id: areaId }], vehicle_groups: [{ vehicle_group_id: ids["biz7"], passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0312345678" }] } }),
    201,
  );
  const saved = await ok(tenantCall("PUT", `/products/${created.id}/service-rules`, { version: 1, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { pickup: { mode: "limited", minutes: 90 }, dropoff: { mode: "limited", minutes: 15 } } } }));
  await ok(tenantCall("PUT", `/products/${created.id}/content`, { version: saved.version, body: { zh: { title: "成田机场接送", pickup_guide: "到达大厅 3 号门" } } }));
  await ok(tenantCall("POST", `/products/${created.id}/price-rules`, { version: await version(created.id), body: { area_id: areaId, vehicle_group_id: ids["biz7"], direction: "both", pricing_model: "fixed", valid_from: "2026-01-01", base_price: basePrice } }), 201);
  await ok(tenantCall("POST", `/products/${created.id}/publish`));
  return created.id;
}
const preview = (): Promise<any> =>
  ok(api.call("POST", "/platform/v1/quotes/preview", { token: root, body: { city_id: ids["tokyo"], category: "airport_transfer", place_id: ids["narita"], currency: "JPY", direction: "pickup", dropoff: { lng: 139.5, lat: 35.5 }, service_time: "2026-10-20T10:00", passengers: 2, luggage: 1 } }));

before(async () => {
  source = await startFakeFxSource();
  api = await createTestApi({ env: { FX_SOURCE_URL: source.url, FX_AUTO_FETCH: "true" } });
  root = await api.superAdminToken();
  tenantA = await api.tenantWithAdmin(root, "甲车队", "admin@fx-a.test");
  tenantB = await api.tenantWithAdmin(root, "乙车队", "admin@fx-b.test");
  for (const [role, key] of [["readonly", "readonly"], ["master_data", "master"]] as const) {
    const invited = await api.call("POST", "/platform/v1/staff", { token: root, body: { email: `${key}@fx.test`, name: key, role } });
    assert.equal(invited.status, 201, invited.text);
    await ok(api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.body.invite.token, password: "Quiet-Harbor-2026" } }));
    const login = await ok(api.platformLogin({ body: { email: `${key}@fx.test`, password: "Quiet-Harbor-2026" } }));
    if (key === "readonly") readonlyToken = login.access_token;
    else masterToken = login.access_token;
  }
  const platform = (path: string, body: unknown): Promise<any> => ok(api.call("POST", `/platform/v1${path}`, { token: root, body }), 201);
  ids["tokyo"] = (await platform("/master/cities", { country_code: "JP", timezone: "Asia/Tokyo", code: "CTY-JP-TYO", name: { zh: "东京" }, center: { lng: 139.6917, lat: 35.6895 } })).id;
  ids["narita"] = (await platform("/master/places", { location: { lng: 140.3887, lat: 35.7686 }, type: "airport", code: "NRT", city_id: ids["tokyo"], name: { zh: "成田机场" }, flight_scope: "international" })).id;
  ids["biz7"] = (await platform("/master/vehicle-groups", { grade: "business", seats: 7, power: "fuel", combos: [{ passengers: 6, luggage: 4 }], code: "VG-BIZ-7", name: { zh: "商务 7 座" } })).id;
  const brandJpy = (await ok(tenantCall("POST", "/brands", { body: { name: "甲 JP", currency: "JPY" } }), 201)).id;
  const brandCny = (await ok(tenantCall("POST", "/brands", { body: { name: "甲 CNY", currency: "CNY" } }), 201)).id;
  const area = (await ok(tenantCall("POST", "/areas", { body: { city_id: ids["tokyo"], name: { zh: "东京全域" }, biz_type: "general", polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [[[139.0, 35.0], [140.0, 35.0], [140.0, 36.0], [139.0, 36.0], [139.0, 35.0]]] } }] } }), 201)).id;
  ids["jpy"] = await product(brandJpy, area, 25_000);
  ids["cny"] = await product(brandCny, area, 90_000);
});
after(async () => {
  await api.close();
  await source.close();
});

test("还没有汇率：看板是 none，跨币种的商品报 FX_RATE_UNAVAILABLE，同币种照常；租户看到的也是 none", async () => {
  const empty = await overview();
  assert.deepEqual([empty.state, empty.as_of, empty.rates.every((item: any) => item.rate === null), empty.source_status.last_attempt, empty.held], ["none", null, true, null, null]);
  assert.equal(empty.source_status.host, new URL(source.url).host);
  const quote = await preview();
  assert.deepEqual(quote.refused.map((entry: any) => [entry.product_id, entry.reason]), [[ids["cny"], "FX_RATE_UNAVAILABLE"]]);
  assert.deepEqual(quote.groups[0].candidates.map((entry: any) => [entry.product_id, entry.fx]), [[ids["jpy"], null]]);
  const tenant = await ok(call("GET", "/tenant/v1/fx-rates", { token: tenantA.adminToken }));
  assert.deepEqual([tenant.state, tenant.as_of], ["none", null]);
});

test("立即拉取：汇率按数据源的数字原文入库（150.000 → 150，不经过浮点数），交叉汇率 12 位小数；报价快照里带着这个汇率和取数时间", async () => {
  serve(T0);
  const res = await ok(fetchNow());
  assert.deepEqual([res.fetch.status, res.fetch.trigger, res.fetch.triggered_by.name, res.fetch.source_as_of, res.fetch.error_code], ["accepted", "manual", "平台超管", T0.toISOString(), null]);
  // 库里是 numeric，按原值存
  const stored = await owner("select quote, rate::text as rate from fx_rates order by quote");
  assert.deepEqual(stored.rows.map((row: any) => [row.quote, row.rate]), [["CNY", "7.2"], ["HKD", "7.8"], ["JPY", "150"], ["KRW", "1400"], ["THB", "36"], ["TWD", "32"]]);
  const board = await overview("base=JPY");
  assert.deepEqual([board.state, board.as_of, board.base, board.source, board.stale_at], ["fresh", T0.toISOString(), "JPY", new URL(source.url).host, "2026-10-09T00:00:00.001Z"]);
  assert.deepEqual(board.rates.find((item: any) => item.currency === "CNY"), { currency: "CNY", rate: "0.048", central_rate: "0.048", locked: false });
  assert.deepEqual(board.cross.find((item: any) => item.from === "CNY" && item.to === "JPY"), { from: "CNY", to: "JPY", rate: "20.833333333333", locked: false });
  assert.equal(board.cross.length, 7 * 6);
  // 报价：人民币的商品换成日元，快照里记着汇率中心给的汇率和取数时间
  const quote = await preview();
  const candidate = quote.groups[0].candidates[0];
  assert.deepEqual([candidate.product_id, candidate.fx, candidate.fx_buffer_bp], [ids["cny"], { from: "CNY", to: "JPY", rate: "20.833333333333", as_of: T0.toISOString(), lock: null }, 150]);
  const expected = sellPrice({ settlementMinor: 90_000, settlementCurrency: "CNY", currency: "JPY", markupBp: 1_000, fx: fxQuoteFromTable({ base: "USD", asOf: T0.toISOString(), rates: { JPY: "150", CNY: "7.2" } }, "CNY", "JPY") });
  assert.ok("sellMinor" in expected);
  assert.equal(candidate.sell, expected.sellMinor);
  // 审计：谁在什么时候手动拉了一次
  const audit = await owner("select actor_type, source, resource, action, after from audit_logs where resource = 'fx_fetch' order by id");
  assert.deepEqual(audit.rows.map((row: any) => [row.actor_type, row.source, row.action, row.after.status]), [["platform_user", "console", "fetch", "accepted"]]);
});

test("数据源还没更新：unchanged，什么都不写；数据源不可用、内容不对：不入库、记原因，继续用最近一次有效汇率", async () => {
  serve(T0);
  assert.deepEqual([(await ok(fetchNow())).fetch.status], ["unchanged"]);
  const before = (await owner("select count(*)::int as n from fx_rates")).rows[0].n;
  const cases: [() => void, string, string][] = [
    [() => source.respond({ status: 503, body: "" }), "failed", "FX_SOURCE_UNAVAILABLE"],
    [() => source.respond({ status: 404, body: "" }), "failed", "FX_SOURCE_BAD_RESPONSE"],
    [() => source.respond({ body: "<html>维护中</html>" }), "rejected", "FX_SOURCE_NOT_JSON"],
    [() => source.respond({ body: '{"result":"error","error-type":"quota-reached"}' }), "rejected", "FX_SOURCE_ERROR_RESULT"],
    [() => source.respond({ body: fxSourceBody({ asOf: at(T0, hours(1)), rates: RATES }).replace('"USD":1,', "") }), "rejected", "FX_SOURCE_WRONG_BASE"],
    [() => serve(at(T0, hours(1)), { ...RATES, CNY: "0" }), "rejected", "FX_SOURCE_BAD_RATE"],
    [() => serve(at(T0, hours(1)), { ...RATES, KRW: "-1400" }), "rejected", "FX_SOURCE_BAD_RATE"],
    [() => serve(at(T0, hours(1)), { JPY: "150", CNY: "7.2" }), "rejected", "FX_SOURCE_MISSING_CURRENCY"],
    [() => serve(at(T0, -hours(1))), "rejected", "FX_SOURCE_OLDER"],
    [() => serve(at(api.clock.now(), hours(1))), "rejected", "FX_SOURCE_BAD_TIME"],
  ];
  for (const [arrange, status, code] of cases) {
    arrange();
    const res = await ok(fetchNow());
    assert.deepEqual([res.fetch.status, res.fetch.error_code], [status, code], code);
    assert.equal(typeof res.fetch.error_detail, "string");
  }
  assert.equal((await owner("select count(*)::int as n from fx_rates")).rows[0].n, before, "一行都没有多写");
  const board = await overview();
  assert.deepEqual([board.state, board.as_of, board.source_status.last_attempt.error_code], ["fresh", T0.toISOString(), "FX_SOURCE_BAD_TIME"]);
  assert.equal((await preview()).groups[0].candidates[0].fx.rate, "20.833333333333", "跨币种报价照常用旧值");
  const log = await ok(call("GET", "/platform/v1/fx-rates/fetches", { query: "limit=3" }));
  assert.deepEqual(log.items.map((item: any) => item.error_code), ["FX_SOURCE_BAD_TIME", "FX_SOURCE_OLDER", "FX_SOURCE_MISSING_CURRENCY"]);
  // 日志和应答里只有主机名，没有数据源的完整地址
  assert.doesNotMatch(api.logs(), /\/v6\/latest/);
  assert.doesNotMatch(JSON.stringify(log), /\/v6\/latest/);
});

test("变动超过 3%：整批挂起、告警，不生效；首页提醒；有权限的人确认后立即生效。放弃的那批不生效；有了更新的一批，旧的挂起批次作废", async () => {
  // 日元 150 → 156（+4%）：挂起
  const t1 = at(T0, hours(0.5));
  serve(t1, { ...RATES, JPY: "156" });
  const held = (await ok(fetchNow())).fetch;
  assert.deepEqual([held.status, held.error_code, held.jumps], ["held", "FX_RATE_JUMP", [{ currency: "JPY", previous: "150", next: "156", change_bp: 400 }]]);
  assert.deepEqual(held.held_rates.find((item: any) => item.currency === "JPY"), { currency: "JPY", rate: "156" });
  const board = await overview();
  assert.deepEqual([board.as_of, board.held?.id], [T0.toISOString(), held.id], "现在用的还是旧的那批");
  assert.equal((await preview()).groups[0].candidates[0].fx.as_of, T0.toISOString());
  const summary = await ok(api.call("GET", "/platform/v1/dashboard/summary", { token: readonlyToken }));
  assert.deepEqual(summary.fx, { state: "fresh", as_of: T0.toISOString(), stale_at: "2026-10-09T00:00:00.001Z", held: true, last_attempt_status: "held", locks: [] });
  // 数据源还是这一批：不重复挂起
  assert.equal((await ok(fetchNow())).fetch.status, "unchanged");
  // 只读角色不能确认
  assert.equal((await call("POST", "/platform/v1/fx-rates/fetches/{id}/confirm", { id: held.id, token: readonlyToken })).status, 403);
  // 主数据运营确认：立即生效
  const confirmed = (await ok(call("POST", "/platform/v1/fx-rates/fetches/{id}/confirm", { id: held.id, token: masterToken }))).fetch;
  assert.deepEqual([confirmed.status, confirmed.decided_by.name], ["confirmed", "master"]);
  assert.deepEqual([(await overview()).as_of, (await overview()).held], [t1.toISOString(), null]);
  assert.equal((await preview()).groups[0].candidates[0].fx.rate, "21.666666666667", "156 / 7.2");
  const again = await call("POST", "/platform/v1/fx-rates/fetches/{id}/confirm", { id: held.id, token: masterToken });
  assert.deepEqual([again.status, again.body.error.code], [409, "FX_FETCH_NOT_HELD"]);
  assert.equal((await call("POST", "/platform/v1/fx-rates/fetches/{id}/confirm", { id: "999999", token: masterToken })).status, 404);
  assert.equal((await call("POST", "/platform/v1/fx-rates/fetches/{id}/dismiss", { id: "abc", token: masterToken })).status, 404);

  // 又一批跳变（韩元 −5%），被放弃：不生效
  const t2 = at(T0, hours(0.6));
  serve(t2, { ...RATES, JPY: "156", KRW: "1330" });
  const second = (await ok(fetchNow())).fetch;
  assert.equal(second.status, "held");
  const dismissed = (await ok(call("POST", "/platform/v1/fx-rates/fetches/{id}/dismiss", { id: second.id, token: masterToken }))).fetch;
  assert.equal(dismissed.status, "dismissed");
  assert.equal((await overview()).as_of, t1.toISOString());

  // 再一批跳变挂起，然后数据源给了更新的、正常的一批：正常的生效，挂起的那批作废、不能再确认
  serve(at(T0, hours(0.7)), { ...RATES, JPY: "156", KRW: "1330" });
  const third = (await ok(fetchNow())).fetch;
  assert.equal(third.status, "held");
  const t4 = at(T0, hours(0.8));
  serve(t4, { ...RATES, JPY: "156.5" });
  assert.equal((await ok(fetchNow())).fetch.status, "accepted");
  const stale = await call("POST", "/platform/v1/fx-rates/fetches/{id}/confirm", { id: third.id, token: masterToken });
  assert.deepEqual([stale.status, stale.body.error.code], [409, "FX_FETCH_NOT_HELD"]);
  assert.equal((await owner("select status, decided_by, error_detail from fx_fetches where id = $1", [third.id])).rows[0].status, "dismissed");
  assert.equal((await overview()).as_of, t4.toISOString());
  // 审计：挂起、确认、放弃都有记录
  const audit = await owner("select action, actor_email from audit_logs where resource = 'fx_fetch' and action <> 'fetch' order by id");
  assert.deepEqual(audit.rows.map((row: any) => row.action), ["hold", "confirm", "hold", "dismiss", "hold"]);
});

test("同时点两次「立即拉取」：一个拉，另一个 409 FX_FETCH_IN_PROGRESS；中途中断（进程退出）的拉取 5 分钟后作废，可以重新拉", async () => {
  serve(at(T0, hours(0.8)), { ...RATES, JPY: "156.5" });
  source.respond({ body: fxSourceBody({ asOf: at(T0, hours(0.8)), rates: { ...RATES, JPY: "156.5" } }), delayMs: 300 });
  const [first, second] = await Promise.all([fetchNow(), fetchNow(masterToken)]);
  assert.deepEqual([first.status, second.status].sort(), [200, 409]);
  const busy = first.status === 409 ? first : second;
  assert.equal(busy.body.error.code, "FX_FETCH_IN_PROGRESS");
  // 一行「正在拉」停在 6 分钟前（像是进程在拉的时候退出了）
  api.clock.advance(7 * 60_000);
  await owner("insert into fx_fetches (started_at, trigger, source, status) values ($1, 'schedule', 'x', 'running')", [new Date(api.clock.now().getTime() - 6 * 60_000)]);
  serve(at(T0, hours(0.8)), { ...RATES, JPY: "156.5" });
  assert.equal((await fetchNow()).status, 200);
  assert.equal((await owner("select error_code from fx_fetches where source = 'x'")).rows[0].error_code, "FX_FETCH_ABANDONED");
});

test("定时任务：按数据源的更新时间拉；没到时间不拉；两个服务进程同时跑也只拉一次", async () => {
  const center = api.app.fxCenter;
  // 上一次拉取刚刚结束：没到时间
  const count = source.requests();
  await center.tick();
  assert.equal(source.requests(), count, "没到时间不去问数据源");
  // 过 12 小时（数据源说的下次更新时间是 as_of + 24h，但最晚 12 小时拉一次）
  await advance(hours(12) + 1_000);
  const t5 = at(T0, hours(12));
  serve(t5, { ...RATES, JPY: "157" });
  // 第二个服务进程：同一个库、同一个数据源
  const second = buildApp({ config: loadConfig({ ...testEnv(api.db.url), FX_SOURCE_URL: source.url, FX_AUTO_FETCH: "true" }), pool: api.db.pool, migrationFiles: await loadMigrationFiles(), now: api.clock.now, logger: false });
  source.respond({ body: fxSourceBody({ asOf: t5, rates: { ...RATES, JPY: "157" } }), delayMs: 200 });
  await Promise.all([center.tick(), second.fxCenter.tick()]);
  await second.close();
  assert.equal(source.requests(), count + 1, "只拉了一次");
  const latest = await ok(call("GET", "/platform/v1/fx-rates/fetches", { query: "limit=1" }));
  assert.deepEqual([latest.items[0].trigger, latest.items[0].triggered_by, latest.items[0].status], ["schedule", null, "accepted"]);
  assert.equal((await overview()).as_of, t5.toISOString());
  const board = await overview();
  assert.ok(new Date(board.source_status.next_fetch_at).getTime() > api.clock.now().getTime());
  assert.equal(board.source_status.auto_fetch, true);
});

test("超过 48 小时没更新：跨币种报价报 FX_RATE_UNAVAILABLE、同币种照常；看板、首页、集成状态都是 stale；审计和日志只记一次；数据源恢复后自动恢复", async () => {
  const asOf = (await overview()).as_of as string;
  source.respond({ status: 503, body: "" });
  // 正好 48 小时：还能用
  await advance(new Date(asOf).getTime() + hours(48) - api.clock.now().getTime());
  assert.equal((await overview()).state, "fresh");
  assert.equal((await preview()).groups[0].candidates[0].product_id, ids["cny"]);
  await advance(1);
  const board = await overview();
  assert.deepEqual([board.state, board.as_of], ["stale", asOf]);
  const quote = await preview();
  assert.deepEqual(quote.refused.map((entry: any) => [entry.product_id, entry.reason]), [[ids["cny"], "FX_RATE_UNAVAILABLE"]]);
  assert.deepEqual(quote.groups[0].candidates.map((entry: any) => entry.product_id), [ids["jpy"]], "同币种的照常");
  // 定时任务：拉不到（数据源不可用），检查过期 → 审计和日志各记一条；再跑一次不重复记
  await advance(hours(1));
  await api.app.fxCenter.tick();
  await api.app.fxCenter.tick();
  const alerts = await owner("select actor_type, source, resource_id, after from audit_logs where resource = 'fx_rate' and action = 'stale'");
  assert.deepEqual(alerts.rows.map((row: any) => [row.actor_type, row.source, row.resource_id]), [["system", "job", asOf]]);
  assert.match(api.logs(), /fx\.stale/);
  const summary = await ok(api.call("GET", "/platform/v1/dashboard/summary", { token: root }));
  assert.deepEqual([summary.fx.state, summary.fx.as_of, summary.fx.last_attempt_status], ["stale", asOf, "failed"]);
  const integrations = await ok(call("GET", "/platform/v1/integrations"));
  assert.deepEqual([integrations.fx_center.state, integrations.fx_center.as_of, integrations.fx_center.last_error_code], ["stale", asOf, "FX_SOURCE_UNAVAILABLE"]);
  assert.equal((await ok(call("GET", "/tenant/v1/fx-rates", { token: tenantB.adminToken }))).state, "stale");
  // 数据源恢复：下一次定时拉取拿到新的一批，跨币种报价恢复
  // 数据源的时间精确到秒
  const fresh = new Date(Math.floor(api.clock.now().getTime() / 1000) * 1000 - hours(1));
  serve(fresh, { ...RATES, JPY: "157" });
  await advance(hours(1));
  await api.app.fxCenter.tick();
  assert.deepEqual([(await overview()).state, (await overview()).as_of], ["fresh", fresh.toISOString()]);
  assert.equal((await preview()).groups[0].candidates[0].fx.as_of, fresh.toISOString());
});

test("近 30 天的曲线：每批汇率一个点，按选的基准换算", async () => {
  const history = await ok(call("GET", "/platform/v1/fx-rates/history", { query: "base=CNY&days=30" }));
  assert.equal(history.base, "CNY");
  const jpy = history.series.find((series: any) => series.currency === "JPY");
  assert.ok(jpy.points.length >= 4);
  assert.deepEqual(jpy.points[0], { as_of: T0.toISOString(), rate: "20.833333333333" });
  assert.equal(history.series.find((series: any) => series.currency === "USD").points[0].rate, "0.138888888889");
  assert.equal(history.series.some((series: any) => series.currency === "CNY"), false, "基准币种自己不画");
  const short = await ok(call("GET", "/platform/v1/fx-rates/history", { query: "days=1" }));
  assert.ok(short.series.find((series: any) => series.currency === "JPY").points.length < jpy.points.length);
  assert.equal((await call("GET", "/platform/v1/fx-rates/history", { query: "days=0" })).status, 400);
  assert.equal((await call("GET", "/platform/v1/fx-rates", { query: "base=EUR" })).status, 400);
});

test("租户只读当前汇率：两个租户看到的一样，只有汇率本身（没有缓冲、加价、对外价）；租户碰不到平台的汇率接口，也没有写接口", async () => {
  const a = await ok(call("GET", "/tenant/v1/fx-rates", { token: tenantA.adminToken, query: "base=JPY" }));
  const b = await ok(call("GET", "/tenant/v1/fx-rates", { token: tenantB.adminToken, query: "base=JPY" }));
  assert.deepEqual(a, b);
  assert.deepEqual(Object.keys(a).sort(), ["as_of", "base", "rates", "state"]);
  assert.doesNotMatch(JSON.stringify(a), /buffer|markup|sell|margin/i);
  // 租户的只读角色也能看
  const viewer = await addTenantUser(api, tenantA.adminToken, "viewer@fx-a.test", "readonly");
  assert.equal((await call("GET", "/tenant/v1/fx-rates", { token: viewer.token })).status, 200);
  // 平台的汇率接口：租户令牌一律 401
  for (const [method, path] of [["GET", "/platform/v1/fx-rates"], ["POST", "/platform/v1/fx-rates/fetch"], ["GET", "/platform/v1/fx-rates/fetches"]] as const) {
    assert.equal((await api.call(method, path, { token: tenantA.adminToken })).status, 401, path);
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) assert.equal((await api.call(method, "/tenant/v1/fx-rates", { token: tenantA.adminToken })).status, 404, method);
  // 数据库层面：租户角色对汇率只能读，对拉取记录什么都不能做
  const client = await api.db.pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role nozomi_app");
    await assert.rejects(client.query("insert into fx_rates (base, quote, rate, as_of, fetched_at, source, fetch_id) values ('USD', 'JPY', 1, now(), now(), 'x', 1)"), /permission denied/);
    await client.query("rollback");
    await client.query("begin");
    await client.query("set local role nozomi_app");
    await assert.rejects(client.query("select * from fx_fetches"), /permission denied/);
    await client.query("rollback");
  } finally {
    client.release();
  }
});

test("拉取记录、只读角色：每个平台角色都能看看板，只有主数据运营和超级管理员能拉", async () => {
  assert.equal((await call("GET", "/platform/v1/fx-rates", { token: readonlyToken })).status, 200);
  const denied = await call("POST", "/platform/v1/fx-rates/fetch", { token: readonlyToken });
  assert.deepEqual([denied.status, denied.body.error.details.required], [403, "fx.manage"]);
  serve(at(api.clock.now(), -hours(0.5)), { ...RATES, JPY: "157" });
  assert.equal((await fetchNow(masterToken)).status, 200);
  const list = await ok(call("GET", "/platform/v1/fx-rates/fetches", { token: readonlyToken, query: "limit=100" }));
  assert.ok(list.items.length > 10);
  assert.ok(list.items.every((item: any, index: number) => index === 0 || item.started_at <= list.items[index - 1].started_at), "新的在前");
  assert.equal((await call("GET", "/platform/v1/fx-rates/fetches", { query: "limit=101" })).status, 400);
});
