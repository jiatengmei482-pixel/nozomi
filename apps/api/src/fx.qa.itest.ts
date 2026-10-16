/**
 * 汇率中心（M2-03）测试角色补充：真实接口、真实 PostgreSQL；数据源是本机的假服务器（不访问外网）。
 * 每个测试自己建一套独立的 schema、自己的假数据源，互不依赖执行顺序，结束时连同 schema 一起删掉。
 * 覆盖：精确性（超长小数、指数写法原样入库，挂起的一批确认后原样生效）、快照与库里一致、中断后晚到的结果作废、
 * 并发（确认与放弃同时、两次确认同时、定时与手动同时、两个实例同时检查过期）、恰好 3%、多币种中一个跳变、确认后再来一批、
 * 48 小时从数据源时间算、定时节奏（失败 15 分钟、最晚 12 小时、中断 5 分钟）、权限（每个平台角色、租户令牌、每个租户角色）、
 * 畸形入参不出 500、数据源地址里的查询串不进库 / 日志 / 应答。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PLATFORM_ROLES, TENANT_ROLES, fxQuoteFromTable } from "@nozomi/domain";
import { loadConfig } from "@nozomi/config";
import { buildApp } from "./app.ts";
import { loadMigrationFiles } from "./db/migrate.ts";
import { type ApiResponse, type HttpMethod, type TestApi, TEST_PASSWORD, addTenantUser, createTestApi } from "./testing/api.ts";
import { testEnv } from "./testing/fixtures.ts";
import { type FakeFxReply, type FakeFxSource, fxSourceBody, startFakeFxSource } from "./testing/fx-source.ts";

const RATES = { JPY: "150", CNY: "7.2", KRW: "1400", HKD: "7.8", TWD: "32", THB: "36" };
const HOUR = 3_600_000;
const MINUTE = 60_000;
/** 数据源的时间精确到秒 */
const seconds = (ms: number): Date => new Date(Math.floor(ms / 1000) * 1000);

interface Env {
  api: TestApi;
  source: FakeFxSource;
  root: string;
  /** 现在往前 n 毫秒（取整到秒），用作数据源这一批的时间 */
  ago(ms: number): Date;
  serve(asOf: Date, rates?: Record<string, string>, extra?: Partial<FakeFxReply> & { nextUpdate?: Date | null }): void;
  fetchNow(token?: string): Promise<ApiResponse>;
  overview(query?: string, token?: string): Promise<any>;
  sql(text: string, values?: unknown[]): Promise<any[]>;
  staff(role: string): Promise<string>;
}

async function withEnv(run: (env: Env) => Promise<void>, options: { autoFetch?: boolean; urlSuffix?: string } = {}): Promise<void> {
  const source = await startFakeFxSource();
  const api = await createTestApi({ env: { FX_SOURCE_URL: `${source.url}${options.urlSuffix ?? ""}`, FX_AUTO_FETCH: options.autoFetch === false ? "false" : "true" } });
  try {
    const root = await api.superAdminToken();
    let staffCount = 0;
    const env: Env = {
      api,
      source,
      root,
      ago: (ms) => seconds(api.clock.now().getTime() - ms),
      serve: (asOf, rates = RATES, extra = {}) => {
        const { nextUpdate, ...reply } = extra;
        source.respond({ body: fxSourceBody({ asOf, rates, ...(nextUpdate === undefined ? {} : { nextUpdate }) }), ...reply });
      },
      fetchNow: (token = root) => api.call("POST", "/platform/v1/fx-rates/fetch", { token }),
      overview: async (query = "", token = root) => {
        const res = await api.call("GET", `/platform/v1/fx-rates${query ? `?${query}` : ""}`, { token });
        assert.equal(res.status, 200, res.text);
        return res.body;
      },
      sql: async (text, values = []) => (await api.db.owner.query(text, values)).rows,
      staff: async (role) => {
        staffCount += 1;
        const email = `${role.replace(/_/g, "-")}-${staffCount}@fx-qa.test`;
        const invited = await api.call("POST", "/platform/v1/staff", { token: root, body: { email, name: `${role}${staffCount}`, role } });
        assert.equal(invited.status, 201, invited.text);
        const accepted = await api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.body.invite.token, password: TEST_PASSWORD } });
        assert.equal(accepted.status, 200, accepted.text);
        const login = await api.call("POST", "/platform/v1/auth/login", { body: { email, password: TEST_PASSWORD } });
        assert.equal(login.status, 200, login.text);
        return login.body.access_token as string;
      },
    };
    await run(env);
  } finally {
    await api.close();
    await source.close();
  }
}

async function ok(res: Promise<ApiResponse> | ApiResponse, status = 200): Promise<any> {
  const done = await res;
  assert.equal(done.status, status, done.text);
  return done.body;
}

/** 平台建城市、机场、车型组；租户建两个子品牌（日元、人民币）各一个上架商品。返回试算函数。 */
async function quoteSetup(env: Env): Promise<{ preview: () => Promise<any>; cnyProduct: string; jpyProduct: string }> {
  const { api, root } = env;
  const tenant = await api.tenantWithAdmin(root, "汇率测试车队", `admin-${randomUUID().slice(0, 8)}@fx-qa.test`);
  const platform = (path: string, body: unknown): Promise<any> => ok(api.call("POST", `/platform/v1${path}`, { token: root, body }), 201);
  const city = (await platform("/master/cities", { country_code: "JP", timezone: "Asia/Tokyo", code: "CTY-JP-TYO", name: { zh: "东京" }, center: { lng: 139.6917, lat: 35.6895 } })).id;
  const airport = (await platform("/master/places", { location: { lng: 140.3887, lat: 35.7686 }, type: "airport", code: "NRT", city_id: city, name: { zh: "成田机场" }, flight_scope: "international" })).id;
  const group = (await platform("/master/vehicle-groups", { grade: "business", seats: 7, power: "fuel", combos: [{ passengers: 6, luggage: 4 }], code: "VG-BIZ-7", name: { zh: "商务 7 座" } })).id;
  const call = (method: HttpMethod, path: string, options: { body?: unknown; version?: number } = {}): Promise<ApiResponse> =>
    api.call(method, `/tenant/v1${path}`, {
      token: tenant.adminToken,
      ...(options.body === undefined ? {} : { body: options.body }),
      headers: { ...(options.version === undefined ? {} : { "if-match": `"${options.version}"` }), ...(method === "POST" && /^\/(products|brands|areas)$|\/price-rules$/.test(path) ? { "idempotency-key": randomUUID() } : {}) },
    });
  const area = (await ok(call("POST", "/areas", { body: { city_id: city, name: { zh: "东京全域" }, biz_type: "general", polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [[[139.0, 35.0], [140.0, 35.0], [140.0, 36.0], [139.0, 36.0], [139.0, 35.0]]] } }] } }), 201)).id;
  const product = async (currency: string, basePrice: number): Promise<string> => {
    const brand = (await ok(call("POST", "/brands", { body: { name: `品牌 ${currency}`, currency } }), 201)).id;
    api.clock.advance(1_000);
    const created = await ok(call("POST", "/products", { body: { brand_id: brand, city_id: city, category: "airport_transfer", poi_id: airport, areas: [{ area_id: area }], vehicle_groups: [{ vehicle_group_id: group, passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0312345678" }] } }), 201);
    const saved = await ok(call("PUT", `/products/${created.id}/service-rules`, { version: 1, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { pickup: { mode: "limited", minutes: 90 }, dropoff: { mode: "limited", minutes: 15 } } } }));
    await ok(call("PUT", `/products/${created.id}/content`, { version: saved.version, body: { zh: { title: "成田机场接送", pickup_guide: "到达大厅 3 号门" } } }));
    const version = (await ok(call("GET", `/products/${created.id}`))).version;
    await ok(call("POST", `/products/${created.id}/price-rules`, { version, body: { area_id: area, vehicle_group_id: group, direction: "both", pricing_model: "fixed", valid_from: "2026-01-01", base_price: basePrice } }), 201);
    await ok(call("POST", `/products/${created.id}/publish`));
    return created.id;
  };
  const jpyProduct = await product("JPY", 25_000);
  const cnyProduct = await product("CNY", 90_000);
  const preview = (): Promise<any> =>
    ok(api.call("POST", "/platform/v1/quotes/preview", { token: root, body: { city_id: city, category: "airport_transfer", place_id: airport, currency: "JPY", direction: "pickup", dropoff: { lng: 139.5, lat: 35.5 }, service_time: "2026-10-20T10:00", passengers: 2, luggage: 1 } }));
  return { preview, cnyProduct, jpyProduct };
}

/** 现在库里生效的那批（按 as_of 最新），用库里的原值独立算交叉汇率 */
async function dbTable(env: Env): Promise<{ asOf: string; rates: Record<string, string> }> {
  const rows = await env.sql("select quote, rate::text as rate, as_of from fx_rates where as_of = (select max(as_of) from fx_rates)");
  return { asOf: (rows[0].as_of as Date).toISOString(), rates: Object.fromEntries(rows.map((row) => [row.quote, row.rate])) };
}

test("超长小数、指数写法按原文入库；挂起的一批确认后原样生效；看板、租户接口、报价快照里的汇率和取数时间与库里一致", async () => {
  await withEnv(async (env) => {
    const { preview, cnyProduct } = await quoteSetup(env);
    const first = env.ago(HOUR);
    env.serve(first, { JPY: "1.49123456789012345678e2", CNY: "7.000000000000000001", KRW: "14e2", HKD: "7.80000", TWD: "3.2E1", THB: "36.123456789012345678" });
    assert.equal((await ok(env.fetchNow())).fetch.status, "accepted");
    const stored = await dbTable(env);
    assert.deepEqual(stored.rates, { JPY: "149.123456789012345678", CNY: "7.000000000000000001", KRW: "1400", HKD: "7.8", TWD: "32", THB: "36.123456789012345678" });
    assert.equal(stored.asOf, first.toISOString());
    const table = { base: "USD" as const, asOf: stored.asOf, rates: stored.rates };
    const board = await env.overview("base=CNY");
    for (const item of board.cross) assert.equal(item.rate, fxQuoteFromTable(table, item.from, item.to)?.rate ?? null, `${item.from}→${item.to}`);
    assert.equal(board.cross.find((item: any) => item.from === "CNY" && item.to === "JPY").rate, "21.303350969859");
    // 报价快照：所用汇率、取数时间与库里一致
    const candidate = (await preview()).groups[0].candidates.find((entry: any) => entry.product_id === cnyProduct);
    assert.deepEqual(candidate.fx, { from: "CNY", to: "JPY", rate: fxQuoteFromTable(table, "CNY", "JPY")?.rate, as_of: stored.asOf });
    // 挂起的一批（日元 +5%，超长小数）确认后，库里是原样的十进制
    const second = env.ago(HOUR / 2);
    env.serve(second, { JPY: "156.579629628462962962", CNY: "7.000000000000000001", KRW: "14e2", HKD: "7.8", TWD: "32", THB: "36.123456789012345678" });
    const held = (await ok(env.fetchNow())).fetch;
    assert.equal(held.status, "held");
    assert.equal((await ok(env.api.call("POST", `/platform/v1/fx-rates/fetches/${held.id}/confirm`, { token: env.root }))).fetch.status, "confirmed");
    const after = await dbTable(env);
    assert.deepEqual([after.asOf, after.rates["JPY"], after.rates["THB"]], [second.toISOString(), "156.579629628462962962", "36.123456789012345678"]);
    const fx = (await preview()).groups[0].candidates.find((entry: any) => entry.product_id === cnyProduct).fx;
    assert.deepEqual(fx, { from: "CNY", to: "JPY", rate: fxQuoteFromTable({ base: "USD", asOf: after.asOf, rates: after.rates }, "CNY", "JPY")?.rate, as_of: second.toISOString() });
  });
});

test("变动正好 3% 直接生效；多个币种里只有一个超过 3% 也整批挂起（其余币种的小变动同样不生效）；确认后下一批和确认的那批比", async () => {
  await withEnv(async (env) => {
    env.serve(env.ago(3 * HOUR));
    assert.equal((await ok(env.fetchNow())).fetch.status, "accepted");
    // 日元 +3%、韩元 −3%：正好 3%，不挂起
    env.serve(env.ago(2.5 * HOUR), { ...RATES, JPY: "154.5", KRW: "1358" });
    assert.deepEqual([(await ok(env.fetchNow())).fetch.status], ["accepted"]);
    // 人民币 +1%、泰铢 +3.1%：整批挂起，人民币也不生效
    env.serve(env.ago(2 * HOUR), { ...RATES, JPY: "154.5", KRW: "1358", CNY: "7.272", THB: "37.116" });
    const held = (await ok(env.fetchNow())).fetch;
    assert.deepEqual([held.status, held.jumps.map((jump: any) => jump.currency)], ["held", ["THB"]]);
    assert.equal((await dbTable(env)).rates["CNY"], "7.2");
    // 确认：整批生效
    await ok(env.api.call("POST", `/platform/v1/fx-rates/fetches/${held.id}/confirm`, { token: env.root }));
    assert.deepEqual([(await dbTable(env)).rates["CNY"], (await dbTable(env)).rates["THB"]], ["7.272", "37.116"]);
    // 下一批泰铢 37.5（相对确认的 37.116 只涨 1%）：直接生效，不再和确认前的 36 比
    env.serve(env.ago(HOUR), { ...RATES, JPY: "154.5", KRW: "1358", CNY: "7.272", THB: "37.5" });
    assert.equal((await ok(env.fetchNow())).fetch.status, "accepted");
  });
});

test("同时确认和放弃同一批：只有一个成功，另一个 409；结果与库里一致。同时确认两次：只写一批汇率，不出 500", async () => {
  await withEnv(async (env) => {
    env.serve(env.ago(3 * HOUR));
    await ok(env.fetchNow());
    for (const round of [0, 1, 2, 3]) {
      env.serve(env.ago((2 - round * 0.1) * HOUR), { ...RATES, JPY: String(160 + round * 10) });
      const held = (await ok(env.fetchNow())).fetch;
      assert.equal(held.status, "held", `第 ${round} 轮`);
      const decisions = round % 2 === 0 ? (["confirm", "dismiss"] as const) : (["confirm", "confirm"] as const);
      const results = await Promise.all(decisions.map((decision) => env.api.call("POST", `/platform/v1/fx-rates/fetches/${held.id}/${decision}`, { token: env.root })));
      assert.deepEqual(results.map((res) => res.status).sort(), [200, 409], results.map((res) => res.text).join(" | "));
      const winner = results.find((res) => res.status === 200) as ApiResponse;
      const loser = results.find((res) => res.status === 409) as ApiResponse;
      assert.equal(loser.body.error.code, "FX_FETCH_NOT_HELD");
      const row = (await env.sql("select status from fx_fetches where id = $1", [held.id]))[0];
      assert.equal(row.status, winner.body.fetch.status);
      const written = await env.sql("select count(*)::int as n from fx_rates where fetch_id = $1", [held.id]);
      assert.equal(written[0].n, row.status === "confirmed" ? 6 : 0, "确认才写、只写一次");
      if (row.status === "confirmed") {
        const audit = await env.sql("select count(*)::int as n from audit_logs where resource = 'fx_fetch' and resource_id = $1 and action in ('confirm', 'dismiss')", [held.id]);
        assert.equal(audit[0].n, 1, "审计只有一条决定");
      }
    }
  });
});

test("定时拉取和立即拉取同时发生：数据源只被请求一次；立即拉取要么拿到结果要么 409", async () => {
  await withEnv(async (env) => {
    env.serve(env.ago(HOUR), RATES, { delayMs: 300 });
    const before = env.source.requests();
    const [manual] = await Promise.all([env.fetchNow(), env.api.app.fxCenter.tick()]);
    assert.ok([200, 409].includes(manual.status), manual.text);
    assert.equal(env.source.requests() - before, 1);
    assert.equal((await env.sql("select count(*)::int as n from fx_fetches where status = 'accepted'"))[0].n, 1);
    assert.equal((await env.sql("select count(*)::int as n from fx_fetches where status = 'running'"))[0].n, 0);
  });
});

test("拉取中途被判定为中断（超过 5 分钟），另一个进程接着拉：晚到的旧结果作废，不写入、不覆盖", async () => {
  await withEnv(async (env) => {
    // 慢的那次拿到的一批更新（as_of 更晚）：如果没有作废它，它就会成为现在用的那批
    const slowBatch = env.ago(HOUR);
    const freshBatch = env.ago(2 * HOUR);
    let calls = 0;
    env.source.respond(() => {
      calls += 1;
      return calls === 1 ? { body: fxSourceBody({ asOf: slowBatch, rates: { ...RATES, JPY: "151" } }), delayMs: 1_500 } : { body: fxSourceBody({ asOf: freshBatch, rates: RATES }) };
    });
    const slow = env.fetchNow();
    // 等慢的那次真正发出请求（已登记「正在拉」）
    while (env.source.requests() === 0) await new Promise((resolve) => setTimeout(resolve, 20));
    env.api.clock.advance(5 * MINUTE + 1_000);
    const second = buildApp({ config: loadConfig({ ...testEnv(env.api.db.url), FX_SOURCE_URL: env.source.url, FX_AUTO_FETCH: "true" }), pool: env.api.db.pool, migrationFiles: await loadMigrationFiles(), now: env.api.clock.now, logger: false });
    try {
      await second.fxCenter.tick();
    } finally {
      await second.close();
    }
    const late = await slow;
    assert.equal(late.status, 200, late.text);
    assert.deepEqual([late.body.fetch.status, late.body.fetch.error_code], ["failed", "FX_FETCH_ABANDONED"]);
    const stored = await dbTable(env);
    assert.deepEqual([stored.asOf, stored.rates["JPY"]], [freshBatch.toISOString(), "150"], "只有接着拉的那批生效");
    assert.equal((await env.sql("select count(*)::int as n from fx_rates where as_of = $1", [slowBatch]))[0].n, 0);
  });
});

test("正在拉的一行：4 分 59 秒时定时任务不动它，5 分钟过后作废并重新拉", async () => {
  await withEnv(async (env) => {
    await env.sql("insert into fx_fetches (started_at, trigger, source, status) values ($1, 'schedule', 'stuck', 'running')", [env.api.clock.now()]);
    env.serve(env.ago(HOUR));
    env.api.clock.advance(4 * MINUTE + 59_000);
    await env.api.app.fxCenter.tick();
    assert.equal(env.source.requests(), 0);
    env.api.clock.advance(1_001);
    await env.api.app.fxCenter.tick();
    assert.equal(env.source.requests(), 1);
    assert.deepEqual((await env.sql("select status, error_code from fx_fetches where source = 'stuck'"))[0], { status: "failed", error_code: "FX_FETCH_ABANDONED" });
  });
});

test("定时节奏：失败后 15 分钟内不再问、到 15 分钟再问；拿到了且数据源说 3 天后才更新，最晚 12 小时再问；关掉定时拉取只检查过期", async () => {
  await withEnv(async (env) => {
    const center = env.api.app.fxCenter;
    env.source.respond({ status: 503, body: "" });
    await center.tick();
    const afterFirst = env.source.requests();
    assert.ok(afterFirst >= 1);
    assert.equal((await env.sql("select status from fx_fetches order by id desc limit 1"))[0].status, "failed");
    env.api.clock.advance(15 * MINUTE - 1);
    await center.tick();
    assert.equal(env.source.requests(), afterFirst, "14 分 59.999 秒：不问");
    env.serve(env.ago(HOUR), RATES, { nextUpdate: new Date(env.api.clock.now().getTime() + 72 * HOUR) });
    env.api.clock.advance(1);
    await center.tick();
    assert.equal(env.source.requests(), afterFirst + 1, "正好 15 分钟：问");
    assert.equal((await env.sql("select status from fx_fetches order by id desc limit 1"))[0].status, "accepted");
    env.api.clock.advance(12 * HOUR - 1);
    await center.tick();
    assert.equal(env.source.requests(), afterFirst + 1, "不到 12 小时：不问");
    env.api.clock.advance(1);
    await center.tick();
    assert.equal(env.source.requests(), afterFirst + 2, "12 小时：问");
  });
  await withEnv(
    async (env) => {
      env.serve(env.ago(HOUR));
      await env.api.app.fxCenter.tick();
      assert.equal(env.source.requests(), 0, "FX_AUTO_FETCH=false：定时任务不拉");
      assert.equal((await env.overview()).source_status.next_fetch_at, null);
      assert.equal((await ok(env.fetchNow())).fetch.status, "accepted", "手动照样能拉");
    },
    { autoFetch: false },
  );
});

test("48 小时从数据源的时间算，不从拉到的时间算：拉到时已 47 小时的一批，1 小时后就过期；拉到时已过 48 小时的一批直接是 stale 并只告警一次", async () => {
  await withEnv(async (env) => {
    const { preview, cnyProduct } = await quoteSetup(env);
    const old = env.ago(47 * HOUR);
    env.serve(old);
    await ok(env.fetchNow());
    assert.equal((await env.overview()).state, "fresh");
    assert.ok((await preview()).groups[0].candidates.some((entry: any) => entry.product_id === cnyProduct));
    env.api.clock.advance(old.getTime() + 48 * HOUR - env.api.clock.now().getTime() + 1);
    const board = await env.overview();
    assert.deepEqual([board.state, board.as_of], ["stale", old.toISOString()]);
    const quote = await preview();
    assert.deepEqual(quote.refused.map((entry: any) => [entry.product_id, entry.reason]), [[cnyProduct, "FX_RATE_UNAVAILABLE"]]);
    assert.equal(quote.groups[0].candidates.length, 1, "同币种的照常");
  });
  await withEnv(async (env) => {
    const ancient = env.ago(49 * HOUR);
    env.serve(ancient);
    const fetched = (await ok(env.fetchNow())).fetch;
    assert.equal(fetched.status, "accepted");
    assert.equal((await env.overview()).state, "stale");
    // 两个服务进程同时检查过期：审计只记一次
    const second = buildApp({ config: loadConfig({ ...testEnv(env.api.db.url), FX_SOURCE_URL: env.source.url, FX_AUTO_FETCH: "false" }), pool: env.api.db.pool, migrationFiles: await loadMigrationFiles(), now: env.api.clock.now, logger: false });
    try {
      await Promise.all([env.api.app.fxCenter.checkStale(), second.fxCenter.checkStale(), env.api.app.fxCenter.checkStale()]);
    } finally {
      await second.close();
    }
    const alerts = await env.sql("select resource_id from audit_logs where resource = 'fx_rate' and action = 'stale'");
    assert.deepEqual(alerts.map((row) => row.resource_id), [ancient.toISOString()]);
  });
});

test("权限：除主数据运营和超级管理员外，每个平台角色都能看、不能拉 / 确认 / 放弃；租户令牌和不带令牌一律 401；每个租户角色都能读租户接口且两个租户看到的一样", async () => {
  await withEnv(async (env) => {
    env.serve(env.ago(2 * HOUR));
    await ok(env.fetchNow());
    env.serve(env.ago(HOUR), { ...RATES, JPY: "200" });
    const held = (await ok(env.fetchNow())).fetch;
    assert.equal(held.status, "held");
    for (const { key } of PLATFORM_ROLES) {
      if (key === "super_admin") continue;
      const token = await env.staff(key);
      for (const path of ["/platform/v1/fx-rates", "/platform/v1/fx-rates/history", "/platform/v1/fx-rates/fetches"]) {
        assert.equal((await env.api.call("GET", path, { token })).status, 200, `${key} GET ${path}`);
      }
      const expected = key === "master_data" ? null : 403;
      if (expected === null) continue;
      for (const path of ["/platform/v1/fx-rates/fetch", `/platform/v1/fx-rates/fetches/${held.id}/confirm`, `/platform/v1/fx-rates/fetches/${held.id}/dismiss`]) {
        const res = await env.api.call("POST", path, { token });
        assert.deepEqual([res.status, res.body?.error?.details?.required], [403, "fx.manage"], `${key} POST ${path}`);
      }
    }
    assert.equal((await env.sql("select status from fx_fetches where id = $1", [held.id]))[0].status, "held", "被拒的请求什么都没改");
    const tenantA = await env.api.tenantWithAdmin(env.root, "甲", "admin@fx-qa-a.test");
    const tenantB = await env.api.tenantWithAdmin(env.root, "乙", "admin@fx-qa-b.test");
    for (const [method, path] of [
      ["GET", "/platform/v1/fx-rates"],
      ["GET", "/platform/v1/fx-rates/history"],
      ["GET", "/platform/v1/fx-rates/fetches"],
      ["POST", "/platform/v1/fx-rates/fetch"],
      ["POST", `/platform/v1/fx-rates/fetches/${held.id}/confirm`],
      ["POST", `/platform/v1/fx-rates/fetches/${held.id}/dismiss`],
    ] as const) {
      assert.equal((await env.api.call(method, path, { token: tenantA.adminToken })).status, 401, `租户令牌 ${method} ${path}`);
      assert.equal((await env.api.call(method, path)).status, 401, `不带令牌 ${method} ${path}`);
    }
    assert.equal((await env.api.call("GET", "/tenant/v1/fx-rates", { token: env.root })).status, 401, "平台令牌访问租户接口");
    assert.equal((await env.api.call("GET", "/tenant/v1/fx-rates")).status, 401);
    const seen: string[] = [];
    for (const { key } of TENANT_ROLES) {
      const token = key === "admin" ? tenantA.adminToken : (await addTenantUser(env.api, tenantA.adminToken, `${key}@fx-qa-a.test`, key)).token;
      const res = await env.api.call("GET", "/tenant/v1/fx-rates?base=JPY", { token });
      assert.equal(res.status, 200, `${key}：${res.text}`);
      seen.push(res.text);
    }
    seen.push((await env.api.call("GET", "/tenant/v1/fx-rates?base=JPY", { token: tenantB.adminToken })).text);
    assert.equal(new Set(seen).size, 1, "每个角色、两个租户看到的完全一样");
    const body = JSON.parse(seen[0] as string);
    assert.deepEqual(Object.keys(body).sort(), ["as_of", "base", "rates", "state"]);
    assert.doesNotMatch(seen[0] as string, /buffer|markup|sell|margin|held/i, "没有缓冲、加价、对外价");
    assert.equal(body.rates.find((item: any) => item.currency === "KRW").rate, "9.333333333333", "用的是生效的那批，不是挂起的那批");
  });
});

test("畸形入参一律 4xx、不出 500：基准写法、天数、条数、编号（超长、0、前导 0、注入、超出 bigint）、坏的请求体", async () => {
  await withEnv(async (env) => {
    const queries = [
      "/platform/v1/fx-rates?base=jpy",
      "/platform/v1/fx-rates?base=",
      "/platform/v1/fx-rates?base=USD&base=JPY",
      "/platform/v1/fx-rates/history?days=abc",
      "/platform/v1/fx-rates/history?days=1.5",
      "/platform/v1/fx-rates/history?days=-1",
      "/platform/v1/fx-rates/history?days=366",
      "/platform/v1/fx-rates/history?days=99999999999999999999",
      "/platform/v1/fx-rates/fetches?limit=0",
      "/platform/v1/fx-rates/fetches?limit=abc",
      "/platform/v1/fx-rates/fetches?limit=101",
      "/tenant/v1/fx-rates?base=EUR",
    ];
    const tenant = await env.api.tenantWithAdmin(env.root, "甲", "admin@fx-qa-bad.test");
    for (const url of queries) {
      const res = await env.api.call("GET", url, { token: url.startsWith("/tenant") ? tenant.adminToken : env.root });
      assert.equal(res.status, 400, `${url} → ${res.status} ${res.text}`);
    }
    for (const id of ["0", "01", "-1", "1.5", "1e3", "9999999999999999999", "99999999999999999999999", "999999999999999999", "1%3Bdrop%20table%20fx_fetches", "%E6%B1%87", "x".repeat(300)]) {
      for (const decision of ["confirm", "dismiss"]) {
        const res = await env.api.call("POST", `/platform/v1/fx-rates/fetches/${id}/${decision}`, { token: env.root });
        // 超长的路径由框架直接回 414，也是 4xx
        assert.ok(res.status === 404 || (id.length > 200 && res.status === 414), `${id.slice(0, 30)}/${decision} → ${res.status} ${res.text}`);
      }
    }
    // 存在、但不是挂起状态的编号：409
    env.source.respond({ status: 503, body: "" });
    const failed = (await ok(env.fetchNow())).fetch;
    assert.equal((await env.api.call("POST", `/platform/v1/fx-rates/fetches/${failed.id}/confirm`, { token: env.root })).status, 409);
    // 坏的请求体
    for (const payload of ["{", "null", "[]", "x".repeat(10_000)]) {
      const res = await env.api.app.inject({ method: "POST", url: "/platform/v1/fx-rates/fetch", headers: { authorization: `Bearer ${env.root}`, "content-type": "application/json" }, payload });
      assert.ok(res.statusCode < 500, `请求体 ${payload.slice(0, 10)} → ${res.statusCode} ${res.body}`);
    }
  });
});

test("数据源地址带查询串（付费档的密钥位置）：库、拉取记录、看板、日志里都只有主机名", async () => {
  await withEnv(
    async (env) => {
      env.serve(env.ago(HOUR));
      await ok(env.fetchNow());
      env.source.respond({ status: 503, body: "" });
      await ok(env.fetchNow());
      env.source.respond({ body: "<html>维护中</html>" });
      await ok(env.fetchNow());
      const marker = /qa-placeholder|apikey|\/v6\/latest/;
      const rows = await env.sql("select source from fx_fetches union all select source from fx_rates");
      for (const row of rows) assert.equal(row.source, new URL(env.source.url).host);
      assert.doesNotMatch(JSON.stringify(await env.overview()), marker);
      assert.doesNotMatch((await env.api.call("GET", "/platform/v1/fx-rates/fetches", { token: env.root })).text, marker);
      assert.doesNotMatch((await env.api.call("GET", "/platform/v1/integrations", { token: env.root })).text, marker);
      assert.doesNotMatch(JSON.stringify(await env.sql("select after from audit_logs")), marker);
      assert.doesNotMatch(env.api.logs(), marker);
    },
    { urlSuffix: "?apikey=qa-placeholder-not-a-key" },
  );
});
