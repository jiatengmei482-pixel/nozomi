/**
 * M8-20：「未覆盖需求」（ADR 0075 第四部分），经真实接口、真实 PostgreSQL。
 * - 一次询价（渠道 `POST /sales/v1/quotes`、官网 `POST /site/v1/quotes`、`/site/v1/quotes/by-points`）一个价都报不出时，应答之后记一条；
 *   有报价的不记；主原因 OUTSIDE_OPERATING / NO_PRICING_AREA / OTHER；两端落在哪些供应商的哪些运营区域里；
 * - 去重（同一天同一个指纹只累加次数）、限流（每个来源每小时 30 行、全站每天 5000 行，超了只记「被限掉」）、保留 365 天的清理任务；
 * - 记录失败不影响给客人的应答；
 * - 不含任何客人个人信息（没有 IP、手打的地址文字、姓名），坐标 4 位小数；
 * - 运营后台列表、计数、地图上的点（`demand.read`）；租户读不到。
 * 测试数据全在本文件里经接口建出来（直接摆进库里的只有「400 天前的旧需求」和「全站额度已满」两种时间上的边界），随测试 schema 一起删除（规则 1）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { UNCOVERED_DEMAND_RULES, instantToLocal } from "@nozomi/domain";
import type { ApiResponse, HttpMethod, TenantFixture, TestApi } from "./testing/api.ts";
import { createTestApi } from "./testing/api.ts";
import { type Market, addStaff, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

let api: TestApi;
let m: Market;
let site: SiteApi;
let sales: { token: string; id: string };
/** 甲的运营大区（只运营、不带价格） */
let opA = "";

const square = (west: number, south: number, east: number, north: number) => ({ type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });
const P = {
  /** 甲、乙的商品区域「东京全域」里 */
  west: { lng: 139.512_345, lat: 35.567_891 },
  /** 甲的运营大区里，没有报价区域 */
  far: { lng: 140.512_345_6, lat: 35.498_765_4 },
  /** 谁的运营区域都不在 */
  nowhere: { lng: 145.5, lat: 35.5 },
};
const CLIENT_IP = "203.0.113.77";
const CHANNEL_IP = "198.51.100.10";

async function tenantCall(who: TenantFixture, method: HttpMethod, path: string, options: { body?: unknown } = {}): Promise<ApiResponse> {
  const token = await tenantLogin(api, who.adminEmail);
  api.clock.advance(1_000);
  return api.call(method, `/tenant/v1${path}`, { token, ...(options.body === undefined ? {} : { body: options.body }), headers: method === "POST" && path === "/areas" ? { "idempotency-key": randomUUID() } : {} });
}
/** 时钟是停住的：每次询价前走 1 秒，记下的需求按出现的先后排得开 */
const salesQuote = (body: Record<string, unknown>, token = sales.token): Promise<ApiResponse> => {
  api.clock.advance(1_000);
  return api.call("POST", "/sales/v1/quotes", { token, ip: CHANNEL_IP, body: { city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, direction: "pickup", service_time: "2026-10-20T10:00:00+09:00", passengers: 2, luggage: 1, currency: "JPY", ...body } });
};
const siteCall = (url: string, body: Record<string, unknown>): Promise<ApiResponse> => {
  api.clock.advance(1_000);
  return site.call("POST", url, { ip: CLIENT_IP, body });
};
const settle = async (): Promise<void> => {
  await api.app.backgroundIdle();
  await site.app.backgroundIdle();
};
const rows = async (where = "true", params: unknown[] = []): Promise<any[]> => (await api.db.owner.query(`select *, service_date::text as service_date from uncovered_demands where ${where} order by first_seen_at, id`, params)).rows;
const today = (): string => instantToLocal(api.clock.now(), "Asia/Tokyo").date;
const platform = (path: string, token = m.root): Promise<ApiResponse> => api.call("GET", `/platform/v1${path}`, { token });

before(async () => {
  api = await createTestApi();
  m = await buildMarket(api);
  opA = (await ok(tenantCall(m.a, "POST", "/areas", { body: { city_id: m.ids.tokyo, name: { zh: "甲运营大区" }, biz_type: "general", role: "operating", polygons: [{ kind: "operate", geometry: square(139.0, 35.0, 141.0, 36.0) }] } }), 201)).id;
  const channel = await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" });
  const creds = await salesCredentials(api, m, channel.id, CHANNEL_IP);
  sales = { token: creds.token, id: creds.id };
  site = await siteApi(api, creds.clientId, null);
  // 报价的目录有 30 秒缓存：建完区域之后让时间走过去
  api.clock.advance(31_000);
});
after(async () => {
  await site?.close();
  await api.close();
});

test("渠道询价一个价都报不出：应答之后记一条（NO_PRICING_AREA：点在甲的运营区域里，所有商品都是区域原因）；坐标 4 位小数、机场那一端记机场名；没有任何个人信息", async () => {
  const res = await salesQuote({ dropoff: P.far });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.body.quotes, []);
  await settle();
  const [row, ...rest] = await rows();
  assert.equal(rest.length, 0);
  assert.deepEqual(
    [row.channel_kind, row.category, row.direction, row.package_hours, row.city_id, row.airport_id, row.reason, row.repeat_count, row.passengers, row.luggage, row.vehicle_group_id],
    ["sales", "airport_transfer", "pickup", null, m.ids.tokyo, m.ids.narita, "NO_PRICING_AREA", 1, 2, 1, null],
  );
  // 接机：上车是机场（成田的坐标、机场名），下车是客人的地址（4 位小数）
  assert.deepEqual([Number(row.pickup_lat), Number(row.pickup_lng), row.pickup_name], [35.7686, 140.3887, "成田机场"]);
  assert.deepEqual([Number(row.dropoff_lat), Number(row.dropoff_lng), row.dropoff_name], [35.4988, 140.5123, null], "渠道接口没有地点名称");
  assert.deepEqual([row.service_local, row.service_date, row.seen_on instanceof Date], ["2026-10-20T10:00", "2026-10-20", true]);
  assert.deepEqual(row.dropoff_operating, [{ tenant_id: m.a.tenantId, area_id: opA }]);
  assert.deepEqual(row.tenant_ids, [m.a.tenantId]);
  assert.deepEqual(row.refusal_counts, { NO_PRICING_AREA: 1, OUT_OF_SERVICE_AREA: 1 });
  assert.match(row.fingerprint, /^[0-9a-f]{64}$/);
  // 不含个人信息：没有 IP、渠道的客户端、浏览器信息、订单、姓名之类的列；整行里也找不到来源地址
  const columns = (await api.db.owner.query("select column_name from information_schema.columns where table_schema = $1 and table_name = 'uncovered_demands' order by column_name", [api.db.schema])).rows.map((entry: any) => entry.column_name);
  assert.deepEqual(columns, [
    "airport_id", "category", "channel_id", "channel_kind", "city_id", "direction", "dropoff_lat", "dropoff_lng", "dropoff_name", "dropoff_operating", "fingerprint", "first_seen_at", "id", "last_seen_at",
    "luggage", "package_hours", "passengers", "pickup_lat", "pickup_lng", "pickup_name", "pickup_operating", "reason", "refusal_counts", "repeat_count", "seen_on", "service_date", "service_local", "tenant_ids", "vehicle_group_id",
  ]);
  assert.ok(!JSON.stringify(row).includes(CHANNEL_IP) && !JSON.stringify(row).includes(sales.id));
});

test("去重：同一天同一个指纹再来只累加次数、更新最近出现时间；换一个点、换一天用车是另一条", async () => {
  const before = (await rows())[0];
  api.clock.advance(60_000);
  // 去重按 3 位小数（约 100 米）：挪了约 10 米仍是同一条
  await ok(salesQuote({ dropoff: { lng: P.far.lng + 0.000_1, lat: P.far.lat } }));
  await settle();
  const [again] = await rows();
  assert.deepEqual([(await rows()).length, again.repeat_count, again.last_seen_at > before.last_seen_at, again.first_seen_at.getTime()], [1, 2, true, before.first_seen_at.getTime()]);
  await ok(salesQuote({ dropoff: P.far, service_time: "2026-10-21T10:00:00+09:00" }));
  await settle();
  assert.equal((await rows()).length, 2);
});

test("主原因：谁的运营区域都不在 → OUTSIDE_OPERATING；点在服务范围里但提前量不够 → OTHER（拒绝原因计数里有具体原因）；有报价的不记", async () => {
  const count = (await rows()).length;
  await ok(salesQuote({ dropoff: P.nowhere }));
  await ok(salesQuote({ dropoff: P.west, service_time: "2026-10-07T12:00:00+09:00" }));
  const quoted = await ok(salesQuote({ dropoff: P.west }));
  assert.ok(quoted.quotes.length > 0);
  await settle();
  const added = (await rows()).slice(count);
  assert.deepEqual(added.map((row) => row.reason), ["OUTSIDE_OPERATING", "OTHER"]);
  // 下车点谁的运营区域都不在；上车的成田机场在甲的运营大区里（两端都记，按供应商筛时用）
  assert.deepEqual([added[0].dropoff_operating, added[0].pickup_operating, added[0].tenant_ids], [[], [{ tenant_id: m.a.tenantId, area_id: opA }], [m.a.tenantId]]);
  assert.deepEqual(added[1].refusal_counts, { LEAD_TIME_TOO_SHORT: 2 });
  assert.deepEqual(added[1].tenant_ids.sort(), [m.a.tenantId, m.b.tenantId].sort(), "两家的东京全域（运营 + 报价）都盖住这个点");
});

test("官网：按坐标报价带地址联想的名称（只记选中的那一项，手打的文字不记）；点对点出发地不在任何能订的城市里也记（OUTSIDE_OPERATING，城市为空）；不记客人地址", async () => {
  const count = (await rows()).length;
  const end = (point: { lng: number; lat: number }, name: string) => ({ name, lat: point.lat, lng: point.lng });
  const body = { service_local: "2026-10-22T09:00", passengers: 3 };
  const chosen = await siteCall("/site/v1/quotes/by-points", { ...body, pickup: end({ lng: 130.4, lat: 33.59 }, "我家楼下 3 号"), dropoff: end({ lng: 130.42, lat: 33.6 }, "天神"), pickup_name: "博多站", dropoff_name: "天神" });
  assertMatchesOpenApi("POST", "/site/v1/quotes/by-points", chosen);
  assert.deepEqual([chosen.status, chosen.body.city, chosen.body.unavailable], [200, null, [{ vehicle_group_id: null, reasons: ["OUT_OF_SERVICE_AREA"] }]]);
  const typed = await siteCall("/site/v1/quotes/by-points", { ...body, pickup: end({ lng: 130.5, lat: 33.7 }, "我家楼下 3 号"), dropoff: end({ lng: 130.6, lat: 33.7 }, "公司") });
  assert.equal(typed.status, 200);
  // 接送机：机场那一端用机场名（客人给的名称不用），地址那一端用联想选中的名称
  const transfer = await siteCall("/site/v1/quotes", { city_id: m.ids.tokyo, airport_id: m.ids.narita, direction: "pickup", address: P.far, service_local: "2026-10-23T10:00", passengers: 1, pickup_name: "随便写的", dropoff_name: "千叶县 某酒店" });
  assertMatchesOpenApi("POST", "/site/v1/quotes", transfer);
  assert.deepEqual([transfer.status, transfer.body.quotes], [200, []]);
  await settle();
  const added = (await rows()).slice(count);
  assert.deepEqual(added.map((row) => [row.channel_kind, row.category, row.city_id, row.reason, row.pickup_name, row.dropoff_name]), [
    ["site", "point_to_point", null, "OUTSIDE_OPERATING", "博多站", "天神"],
    ["site", "point_to_point", null, "OUTSIDE_OPERATING", null, null],
    ["site", "airport_transfer", m.ids.tokyo, "NO_PRICING_AREA", "成田机场", "千叶县 某酒店"],
  ]);
  assert.deepEqual([Number(added[0].pickup_lat), Number(added[0].pickup_lng), added[0].passengers, added[0].service_local], [33.59, 130.4, 3, "2026-10-22T09:00"]);
  const dump = JSON.stringify(await rows());
  assert.ok(!dump.includes(CLIENT_IP) && !dump.includes("我家楼下") && !dump.includes("公司"), "没有客人地址、手打的文字");
  // 限流计数表里只有哈希
  const buckets = (await api.db.owner.query("select bucket from uncovered_demand_limits")).rows.map((row: any) => row.bucket as string);
  assert.ok(buckets.every((bucket) => bucket === "global" || /^source:[0-9a-f]{64}$/.test(bucket)), buckets.join(","));
});

test("限流：同一个来源每小时最多 30 条新行，全站每天最多 5000 条，超了只记当天「被限掉」的条数，报价照常；累加次数不占额度", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "限流测试渠道" });
  const creds = await salesCredentials(api, m, channel.id, "198.51.100.20");
  const count = (await rows()).length;
  for (let i = 0; i <= UNCOVERED_DEMAND_RULES.sourceNewRowsPerHour; i += 1) {
    const res = await salesQuote({ dropoff: { lng: 150 + i * 0.01, lat: 10 } }, creds.token);
    assert.equal(res.status, 200, res.text);
    await settle();
  }
  // 同一条再来：只累加次数，不算新行，也不被限
  await ok(salesQuote({ dropoff: { lng: 150, lat: 10 } }, creds.token));
  await settle();
  const added = (await rows()).slice(count);
  assert.equal(added.length, UNCOVERED_DEMAND_RULES.sourceNewRowsPerHour);
  assert.equal(added[0].repeat_count, 2);
  const dropped = async (): Promise<number> => (await api.db.owner.query("select coalesce(sum(dropped), 0)::int as n from uncovered_demand_drops where day = $1", [today()])).rows[0].n;
  assert.equal(await dropped(), 1);
  // 一小时以后这个来源又能记了；全站额度用满了（直接把计数摆成 5000）就只记「被限掉」
  api.clock.advance(3_600_000);
  await api.db.owner.query("update uncovered_demand_limits set attempt_count = $1, window_started_at = $2 where bucket = 'global'", [UNCOVERED_DEMAND_RULES.globalNewRowsPerDay, api.clock.now()]);
  const res = await salesQuote({ dropoff: { lng: 151, lat: 11 } }, creds.token);
  assert.deepEqual([res.status, res.body.quotes], [200, []]);
  await settle();
  assert.equal((await rows()).length, count + UNCOVERED_DEMAND_RULES.sourceNewRowsPerHour);
  assert.equal(await dropped(), 2);
  await api.db.owner.query("update uncovered_demand_limits set attempt_count = 0 where bucket = 'global'");
});

test("记录失败不影响给客人的应答（只记一条不含请求内容的错误日志）", async () => {
  const count = (await rows()).length;
  await api.db.owner.query("alter table uncovered_demands rename to uncovered_demands_moved");
  try {
    const res = await salesQuote({ dropoff: { lng: 152, lat: 12 } });
    assert.deepEqual([res.status, res.body.quotes, res.body.unavailable], [200, [], [{ vehicle_group_id: null, reasons: ["OUT_OF_SERVICE_AREA"] }]]);
    await settle();
  } finally {
    await api.db.owner.query("alter table uncovered_demands_moved rename to uncovered_demands");
  }
  assert.equal((await rows()).length, count);
  const logged = api.logs().split("\n").filter((line) => line.includes("uncovered_demand.record"));
  assert.ok(logged.length >= 1, "记了错误日志");
  // 只认单独出现的 152（请求里的经度），不算时间戳、耗时、编号里碰巧带着的 152（M8-29：main run 43258748905 因此偶发失败）
  const requestLng = /(?<![\d.])152(?![\d.])/;
  assert.ok(logged.every((line) => !requestLng.test(line) && !line.includes(CHANNEL_IP)), `日志里没有请求内容：${logged.join("\n")}`);
});

test("运营后台列表：按城市、供应商、日期、品类、原因筛；合计和按原因 / 城市 / 供应商的计数、被限掉的条数；游标分页；不认识的参数 400", async () => {
  const all = await platform("/uncovered-demands?limit=200");
  assertMatchesOpenApi("GET", "/platform/v1/uncovered-demands", all);
  assert.equal(all.status, 200, all.text);
  const total = (await rows()).length;
  assert.deepEqual([all.body.items.length, all.body.summary.rows, all.body.next_cursor], [total, total, null]);
  assert.equal(all.body.summary.repeats, (await rows()).reduce((sum, row) => sum + row.repeat_count, 0));
  assert.equal(all.body.summary.dropped, 2);
  assert.deepEqual(all.body.summary.by_reason.map((entry: any) => entry.reason).sort(), ["NO_PRICING_AREA", "OTHER", "OUTSIDE_OPERATING"]);
  assert.ok(all.body.summary.by_tenant.some((entry: any) => entry.tenant_id === m.a.tenantId));
  assert.ok(all.body.tenants.some((entry: any) => entry.id === m.a.tenantId && entry.name === "甲车队"));
  assert.ok(all.body.cities.some((entry: any) => entry.id === m.ids.tokyo));
  // 筛选
  const ofA = await ok(platform(`/uncovered-demands?tenant_id=${m.a.tenantId}`));
  assert.ok(ofA.items.length > 0 && ofA.items.every((item: any) => item.tenant_ids.includes(m.a.tenantId)));
  const ofB = await ok(platform(`/uncovered-demands?tenant_id=${m.b.tenantId}&reason=OTHER`));
  assert.deepEqual(ofB.items.map((item: any) => item.reason), ["OTHER"]);
  const site = await ok(platform(`/uncovered-demands?city_id=${m.ids.tokyo}&category=airport_transfer&reason=NO_PRICING_AREA`));
  assert.ok(site.items.length >= 3 && site.items.every((item: any) => item.city_id === m.ids.tokyo && item.reason === "NO_PRICING_AREA"));
  const future = await ok(platform("/uncovered-demands?from=2030-01-01&to=2030-01-31"));
  assert.deepEqual([future.items, future.summary.rows, future.from, future.to], [[], 0, "2030-01-01", "2030-01-31"]);
  const defaults = await ok(platform("/uncovered-demands?limit=1"));
  assert.equal(defaults.to, today());
  assert.ok(defaults.next_cursor !== null);
  const next = await ok(platform(`/uncovered-demands?limit=1&cursor=${defaults.next_cursor}`));
  assert.notEqual(next.items[0].id, defaults.items[0].id);
  for (const query of ["?tenantid=x", "?from=2026-13-01", "?from=2026-10-10&to=2026-10-01", "?from=2025-01-01&to=2026-10-01", "?reason=WHATEVER", "?limit=0"]) {
    assert.equal((await platform(`/uncovered-demands${query}`)).status, 400, query);
  }
  // 地图上的点
  const points = await platform(`/uncovered-demands/points?tenant_id=${m.a.tenantId}`);
  assertMatchesOpenApi("GET", "/platform/v1/uncovered-demands/points", points);
  assert.equal(points.body.truncated, false);
  assert.deepEqual(points.body.items.map((item: any) => item.id).sort(), ofA.items.map((item: any) => item.id).sort());
  assert.ok(points.body.items.every((item: any) => item.dropoff === null || Object.keys(item.dropoff).sort().join() === "lat,lng"));
  // 每个点带用车时间和最近出现的时刻（地图的弹出框显示时间用），和列表里同一条一致
  const listed = new Map<string, any>(ofA.items.map((item: any) => [item.id, item]));
  for (const item of points.body.items) assert.deepEqual([item.service_local, item.last_seen_at], [listed.get(item.id).service_local, listed.get(item.id).last_seen_at]);
  assert.equal((await platform("/uncovered-demands/points?limit=5")).status, 400, "点不分页");
});

test("谁能看：超级管理员、运营、招商、渠道经理能看；客服、财务、只读不能；租户的令牌进不来", async () => {
  const onboarding = await addStaff(api, m.root, "bd@platform.test", "tenant_onboarding");
  const cs = await addStaff(api, m.root, "cs@platform.test", "customer_service");
  const finance = await addStaff(api, m.root, "fin@platform.test", "finance");
  for (const [token, status] of [[m.staff.operations.token, 200], [onboarding.token, 200], [m.staff.cm1.token, 200], [cs.token, 403], [finance.token, 403], [m.staff.readonly.token, 403]] as const) {
    assert.equal((await platform("/uncovered-demands", token)).status, status);
    assert.equal((await platform("/uncovered-demands/points", token)).status, status);
  }
  for (const path of ["/platform/v1/uncovered-demands", "/platform/v1/uncovered-demands/points"]) assert.equal((await api.call("GET", path, { token: m.a.adminToken })).status, 401);
});

test("保留期：每天的清理任务删掉最近出现早于 365 天的需求和「被限掉」计数、1 天以前的限流窗口；近的不动", async () => {
  const now = api.clock.now();
  const old = new Date(now.getTime() - 400 * 86_400_000);
  const recent = await rows();
  await api.db.owner.query(
    `insert into uncovered_demands (first_seen_at, last_seen_at, seen_on, channel_kind, channel_id, category, direction, package_hours, service_local, service_date, passengers, luggage, reason, fingerprint)
     select $1, $1, $2::date, channel_kind, channel_id, category, direction, package_hours, service_local, service_date, passengers, luggage, reason, repeat('0', 64) from uncovered_demands limit 1`,
    [old, instantToLocal(old, "Asia/Tokyo").date],
  );
  await api.db.owner.query("insert into uncovered_demand_drops (day, dropped) values ($1, 7)", [instantToLocal(old, "Asia/Tokyo").date]);
  await api.db.owner.query("insert into uncovered_demand_limits (bucket, window_started_at, attempt_count) values ('source:old', $1, 3)", [new Date(now.getTime() - 2 * 86_400_000)]);
  const deleted = await api.app.uncoveredDemandJobs.tick();
  assert.equal(deleted, 1);
  assert.deepEqual((await rows()).map((row) => row.id), recent.map((row) => row.id));
  assert.equal((await api.db.owner.query("select count(*)::int as n from uncovered_demand_drops where dropped = 7")).rows[0].n, 0);
  assert.equal((await api.db.owner.query("select count(*)::int as n from uncovered_demand_limits where bucket = 'source:old'")).rows[0].n, 0);
  assert.equal(await api.app.uncoveredDemandJobs.tick(), 0, "再跑一次什么都不删");
});
