/**
 * M9T-08：人工报价申请带上整张行程单（ADR 0101 第十二节第 2 条）。经真实接口、真实 PostgreSQL。
 *
 * 覆盖：带合格的行程单 → 链接行和申请同一个事务写入、各点名称只在密文里、列表 has_trip、详情有每天的点（名称、平台地点、坐标）、过夜点和最近一次报价的方案、没有行程单编号、报不出的原因；
 * 行程单不存在、格式不对、过了可读期、验收标记对不上（两个方向）→ 400 `/trip_id` NOT_FOUND，什么都不记；没带行程单却给了方案 / 名称、名称比行程单多 → 400；
 * 行程单被清理（删行）→ 详情 `{ purged: true }`；不带行程单的提交和以前一样（应答、去重、详情 `trip: null`）；带行程单的另行去重；
 * 审计里没有行程单编号；租户的数据库角色碰不到新表。
 * 测试数据全在本文件里经接口建出来（方案行直接写库：编排报价由 trips.itest.ts 覆盖），随测试 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { withTenantTx } from "./db/context.ts";
import { deniedByDatabase } from "./testing/db.ts";
import { type ApiResponse, type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

const TOKEN = "qa-acceptance-token-for-mq-trip-itests-Zr72kQv3Nd";
const SUBMIT_PATH = "/site/v1/manual-quote-requests";

let api: TestApi;
let m: Market;
/** 配了验收口令的官网（测试环境的样子）；不带 Cookie 时就是普通客人 */
let site: SiteApi;

let ipSeq = 0;
const nextIp = (): string => `10.84.${Math.floor(++ipSeq / 200)}.${ipSeq % 200}`;
let mailSeq = 0;
const nextEmail = (): string => `trip-guest-${++mailSeq}@example.test`;

/** 第一天的一段（`trip` 照旧必填） */
const firstLeg = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  category: "airport_transfer",
  city_id: m.ids.tokyo,
  pickup: { name: "成田机场", lat: 35.7686, lng: 140.3887 },
  dropoff: { name: "新宿某酒店", lat: 35.6938, lng: 139.7034 },
  service_local: "2026-12-01T14:30",
  passengers: 2,
  luggage: 1,
  ...overrides,
});

/** 两天的行程单：第一天成田接机（平台地点）到新宿、住新宿，第二天新宿出发、浅草停 60 分钟、回新宿 */
const itinerary = () => ({
  schemaVersion: 1,
  party: { adults: 2, children: 1, luggage: 1 },
  days: [
    { date: "2026-12-01", items: [{ kind: "arrive_flight", place: { placeId: m.ids.narita }, time: "14:30" }, { kind: "stop", place: { lat: 35.6938, lng: 139.7034, kind: "hotel" }, stayMinutes: 0 }], nightAt: { lat: 35.6938, lng: 139.7034 } },
    {
      date: "2026-12-02",
      items: [
        { kind: "start", place: { lat: 35.6938, lng: 139.7034 }, time: "09:00" },
        { kind: "stop", place: { lat: 35.7148, lng: 139.7967 }, stayMinutes: 60 },
        { kind: "end", place: { lat: 35.6938, lng: 139.7034 } },
      ],
    },
  ],
});
const LABELS = [
  ["成田机场 T1", "新宿某酒店"],
  ["新宿某酒店", "浅草寺", null],
];

async function newTrip(cookie?: string): Promise<string> {
  api.clock.advance(1_000);
  const res = await site.call("POST", "/site/v1/trips", { ip: nextIp(), body: itinerary(), ...(cookie === undefined ? {} : { headers: { cookie } }) });
  assert.equal(res.status, 201, res.text);
  return res.body.trip_id as string;
}

function submit(body: Record<string, unknown>, cookie?: string): Promise<ApiResponse> {
  // 隔 1 秒：列表按提交时间排序，要分得出先后
  api.clock.advance(1_000);
  return site.call("POST", SUBMIT_PATH, { ip: nextIp(), body: { consent: true, trip: firstLeg(), ...body }, ...(cookie === undefined ? {} : { headers: { cookie } }) });
}

async function unlock(): Promise<string> {
  const res = await site.call("POST", "/site/v1/qa-acceptance/session", { ip: nextIp(), body: { token: TOKEN } });
  assert.equal(res.status, 201, res.text);
  return String(res.headers["set-cookie"]).split(";")[0] as string;
}

const issuesOf = (res: ApiResponse): [string, string][] => res.body.error.details.issues.map((issue: { path: string; reason: string }) => [issue.path, issue.reason]);
const countRows = async (table = "manual_quote_requests"): Promise<number> => (await api.db.owner.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0]?.n ?? 0;
const list = (query = ""): Promise<ApiResponse> => api.call("GET", `/platform/v1/manual-quote-requests?limit=100&acceptance=include${query}`, { token: m.root });
async function rowOf(email: string): Promise<{ id: string; has_trip: boolean; is_acceptance: boolean; request_no: string }> {
  const listed = await ok(list(`&contact=${encodeURIComponent(email)}`));
  assert.equal(listed.items.length, 1, `按 ${email} 查到 ${listed.items.length} 条`);
  return listed.items[0];
}
async function detail(id: string): Promise<ApiResponse> {
  const res = await api.call("GET", `/platform/v1/manual-quote-requests/${id}`, { token: m.root });
  assert.equal(res.status, 200, res.text);
  assertMatchesOpenApi("GET", "/platform/v1/manual-quote-requests/{id}", res);
  return res;
}

before(async () => {
  api = await createTestApi();
  m = await buildMarket(api);
  const channel = await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" });
  site = await siteApi(api, (await salesCredentials(api, m, channel.id)).clientId, new FakePaymentProvider(), { QA_ACCEPTANCE_TOKEN: TOKEN });
});
after(async () => {
  await site?.close();
  await api?.close();
});

test("带合格的行程单：202；链接行和申请同时写入，名称只在密文里；列表 has_trip；详情有整张行程单和最近一次报价、报不出的原因", async () => {
  const tripId = await newTrip();
  // 最近一次报价：一车到底报出、每天各自最优第 2 天报不出（编排由 trips.itest.ts 覆盖，这里直接写方案行）
  const now = api.clock.now();
  await api.db.owner.query(
    `insert into trip_plans (trip_id, seq, kind, recommended, supplier_tenant_id, vehicle_group_id, status, sell_minor, settlement_minor, currency, unquoted, warnings, quoted_at, expires_at)
     values ($1, 0, 'one_car', true, $2, $3, 'quoted', 120000, 100000, 'JPY', '[]', '[]', $4, $5),
            ($1, 1, 'daily_best', false, null, null, 'unquoted', null, null, 'JPY', '[{"day_index":1,"reason":"NO_OFFER"}]', '[]', $4, null)`,
    [tripId, m.a.tenantId, m.ids.biz7, now, new Date(now.getTime() + 30 * 60_000)],
  );
  const email = nextEmail();
  const res = await submit({ email, trip_id: tripId, plan_kind: "daily_best", trip_labels: LABELS });
  assert.equal(res.status, 202, res.text);
  assert.deepEqual(res.body, { status: "accepted" });
  assertMatchesOpenApi("POST", SUBMIT_PATH, res);

  const row = await rowOf(email);
  assert.equal(row.has_trip, true);
  assertMatchesOpenApi("GET", "/platform/v1/manual-quote-requests", await list());
  const links = (await api.db.owner.query("select trip_id, plan_kind from manual_quote_trip_links where request_id = $1", [row.id])).rows;
  assert.deepEqual(links, [{ trip_id: tripId, plan_kind: "daily_best" }]);
  const stored = JSON.stringify((await api.db.owner.query("select * from manual_quote_requests where id = $1", [row.id])).rows);
  for (const secret of ["成田机场 T1", "浅草寺", tripId]) assert.ok(!stored.includes(secret), `申请行里出现了原文 ${secret}`);

  const body = (await detail(row.id)).body;
  assert.equal(body.request.has_trip, true);
  const view = body.trip;
  assert.equal(view.purged, false);
  assert.ok(!("trip_id" in view), "详情不给行程单编号（客人的访问凭证）");
  assert.ok(!JSON.stringify(body).includes(tripId), "详情里没有行程单编号");
  assert.equal(view.plan_kind, "daily_best");
  assert.equal(view.currency, "JPY");
  assert.deepEqual(view.party, { adults: 2, children: 1, luggage: 1 });
  assert.deepEqual(
    view.days.map((day: { date: string; items: unknown[] }) => day.date),
    ["2026-12-01", "2026-12-02"],
  );
  assert.deepEqual(view.days[0].items[0], { kind: "arrive_flight", time: "14:30", stay_minutes: null, lat: 35.7686, lng: 140.3887, place_id: m.ids.narita, place_name: { zh: "成田机场" }, label: "成田机场 T1" });
  assert.deepEqual(view.days[1].items[1], { kind: "stop", time: null, stay_minutes: 60, lat: 35.7148, lng: 139.7967, place_id: null, place_name: null, label: "浅草寺" });
  assert.equal(view.days[1].items[2].label, null, "名称给了 null 的点");
  assert.deepEqual(view.days[0].night_at, { lat: 35.6938, lng: 139.7034 }, "第一天的过夜点");
  assert.equal(view.days[1].night_at, null, "没写过夜点为 null");
  assert.deepEqual(view.plans, [
    { kind: "one_car", status: "quoted", recommended: true, total: { amount: "120000", currency: "JPY" }, expires_at: new Date(now.getTime() + 30 * 60_000).toISOString() },
    { kind: "daily_best", status: "unquoted", recommended: false, total: null, expires_at: null },
  ]);
  assert.deepEqual(view.unquoted, [{ plan_kind: "daily_best", day_index: 1, reason: "NO_OFFER" }]);
  assert.equal(view.quoted_at, now.toISOString());
  assert.ok(!JSON.stringify(view).includes(m.a.tenantId), "没有供应商编号");

  // 审计只有申请编号：行程单编号不进审计
  const audits = (await api.db.owner.query("select before, after from audit_logs where resource = 'manual_quote_request' and resource_id = $1", [row.id])).rows;
  assert.deepEqual(audits, [{ before: null, after: { request_no: row.request_no } }]);
  const leaked = (await api.db.owner.query<{ n: number }>("select count(*)::int as n from audit_logs where coalesce(before::text, '') like $1 or coalesce(after::text, '') like $1", [`%${tripId}%`])).rows[0]?.n;
  assert.equal(leaked, 0, "审计里出现了行程单编号");
});

test("行程单不存在、格式不对、过了可读期：400 /trip_id NOT_FOUND（同一个回答），什么都不记", async () => {
  const before = await countRows();
  const links = await countRows("manual_quote_trip_links");
  const expired = await newTrip();
  await api.db.owner.query("update trips set created_at = created_at - interval '31 days', readable_until = $2 where id = $1", [expired, new Date(api.clock.now().getTime() - 86_400_000)]);
  for (const tripId of ["A".repeat(43), "not-a-trip", expired]) {
    const res = await submit({ email: nextEmail(), trip_id: tripId });
    assert.equal(res.status, 400, res.text);
    assert.deepEqual(issuesOf(res), [["/trip_id", "NOT_FOUND"]], tripId);
    assert.ok(!res.text.includes(tripId), "错误里不回显行程单编号");
  }
  assert.equal(await countRows(), before);
  assert.equal(await countRows("manual_quote_trip_links"), links);
});

test("验收标记对不上（验收会话建的行程单、普通客人带；或反过来）：400 /trip_id NOT_FOUND；两边一致才收，记成验收留资", async () => {
  const cookie = await unlock();
  const before = await countRows();
  const qaTrip = await newTrip(cookie);
  const realTrip = await newTrip();
  const plain = await submit({ email: nextEmail(), trip_id: qaTrip });
  assert.equal(plain.status, 400, plain.text);
  assert.deepEqual(issuesOf(plain), [["/trip_id", "NOT_FOUND"]]);
  const qa = await submit({ email: nextEmail(), trip_id: realTrip }, cookie);
  assert.equal(qa.status, 400, qa.text);
  assert.deepEqual(issuesOf(qa), [["/trip_id", "NOT_FOUND"]]);
  assert.equal(await countRows(), before);

  const email = nextEmail();
  assert.equal((await submit({ email, trip_id: qaTrip }, cookie)).status, 202);
  const row = await rowOf(email);
  assert.equal(row.is_acceptance, true);
  assert.equal(row.has_trip, true);
});

test("没带行程单却给了方案、名称：400 NOT_APPLICABLE；名称比行程单多：400 MISMATCH；都不记", async () => {
  const before = await countRows();
  const orphan = await submit({ email: nextEmail(), plan_kind: "one_car", trip_labels: [["新宿"]] });
  assert.equal(orphan.status, 400, orphan.text);
  assert.deepEqual(issuesOf(orphan), [["/plan_kind", "NOT_APPLICABLE"], ["/trip_labels", "NOT_APPLICABLE"]]);
  const tripId = await newTrip();
  const tooManyDays = await submit({ email: nextEmail(), trip_id: tripId, trip_labels: [["a"], ["b"], ["c"]] });
  assert.deepEqual([tooManyDays.status, issuesOf(tooManyDays)], [400, [["/trip_labels", "MISMATCH"]]]);
  const tooManyItems = await submit({ email: nextEmail(), trip_id: tripId, trip_labels: [["a", "b", "c"]] });
  assert.deepEqual([tooManyItems.status, issuesOf(tooManyItems)], [400, [["/trip_labels/0", "MISMATCH"]]]);
  const badKind = await submit({ email: nextEmail(), trip_id: tripId, plan_kind: "local_cars" });
  assert.equal(badKind.status, 400, badKind.text);
  const longLabel = await submit({ email: nextEmail(), trip_id: tripId, trip_labels: [["长".repeat(201)]] });
  assert.equal(longLabel.status, 400, longLabel.text);
  assert.equal(await countRows(), before);
});

test("行程单被清理（M9T-05 删行）：链接留下，详情 trip 是 { purged: true }；列表仍是 has_trip", async () => {
  const tripId = await newTrip();
  const email = nextEmail();
  assert.equal((await submit({ email, trip_id: tripId })).status, 202);
  const row = await rowOf(email);
  const fresh = (await detail(row.id)).body;
  assert.equal(fresh.trip.purged, false);
  assert.equal(fresh.trip.plan_kind, null);
  assert.deepEqual(fresh.trip.plans, []);
  assert.equal(fresh.trip.quoted_at, null);
  assert.equal(fresh.trip.days[0].items[1].label, null, "没给名称");
  await api.db.owner.query("delete from trips where id = $1", [tripId]);
  const purged = (await detail(row.id)).body;
  assert.deepEqual(purged.trip, { purged: true });
  assert.equal(purged.request.has_trip, true);
  assert.equal((await rowOf(email)).has_trip, true);
});

test("不带行程单：应答、去重和以前一样，详情 trip 为 null、has_trip 为 false；带行程单的另行去重（同一个行程单 24 小时内只记一次）", async () => {
  const email = nextEmail();
  const before = await countRows();
  // 同一个邮箱要交 6 次：每次之前清掉按联系方式的额度（每天 3 次），这里测的是去重，不是限速
  const submitAgain = async (body: Record<string, unknown>): Promise<ApiResponse> => {
    await api.db.owner.query("delete from sales_rate_limits where bucket like 'site_manual_quote_contact:%'");
    return submit(body);
  };
  const first = await submitAgain({ email });
  assert.equal(first.status, 202, first.text);
  assert.deepEqual(first.body, { status: "accepted" });
  assert.equal((await submitAgain({ email })).status, 202, "重复提交应答一样");
  assert.equal(await countRows(), before + 1, "不带行程单的照旧去重");
  const row = await rowOf(email);
  assert.equal(row.has_trip, false);
  const body = (await detail(row.id)).body;
  assert.equal(body.trip, null);
  assert.equal(body.request.has_trip, false);

  // 同一个联系方式、同一段第一天：带了行程单另算一条；同一个行程单再交一次不记；换一个行程单另算
  const tripId = await newTrip();
  assert.equal((await submitAgain({ email, trip_id: tripId })).status, 202);
  assert.equal(await countRows(), before + 2);
  assert.equal((await submitAgain({ email, trip_id: tripId })).status, 202);
  assert.equal(await countRows(), before + 2, "同一个行程单只记一次");
  assert.equal((await submitAgain({ email, trip_id: await newTrip() })).status, 202);
  assert.equal(await countRows(), before + 3, "另一个行程单另算");
  assert.equal((await submitAgain({ email })).status, 202);
  assert.equal(await countRows(), before + 3, "不带行程单的仍和第一条重复");
});

test("租户碰不到新表：租户的数据库角色读不到、写不了 manual_quote_trip_links", async () => {
  await assert.rejects(withTenantTx(api.db.pool, m.a.tenantId, (db) => db.query("select * from manual_quote_trip_links")), (err: unknown) => deniedByDatabase(err));
  await assert.rejects(withTenantTx(api.db.pool, m.b.tenantId, (db) => db.query("update manual_quote_trip_links set plan_kind = null")), (err: unknown) => deniedByDatabase(err));
});
