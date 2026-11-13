/**
 * M8-39：验收会话里提交的人工报价留资（ADR 0078 补充「验收留资」，ADR 0076）。经真实接口、真实 PostgreSQL。
 *
 * 覆盖：不带验收会话照旧（不是验收留资、列表里有）；带有效会话记成验收留资（运营后台列表默认不列、筛选参数才列，应答有 is_acceptance，
 * 各状态的数量跟着筛选）；和真实客人的留资分开去重；会话过期、已结束、写坏了、通道没开都是 401 且什么都不记；不发提醒、不记未覆盖需求；
 * 触发器保证标记建好后不能改（跟进照常）；production 不看 Cookie；租户碰不到（接口和数据库两层）。
 * 测试数据全在本文件里经接口建出来，随测试 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "@nozomi/config";
import { buildApp } from "./app.ts";
import { withTenantTx } from "./db/context.ts";
import { loadMigrationFiles } from "./db/migrate.ts";
import { deniedByDatabase } from "./testing/db.ts";
import { type ApiResponse, type TestApi, createTestApi } from "./testing/api.ts";
import { UNREACHABLE_INTEGRATIONS, testEnv } from "./testing/fixtures.ts";
import { type Market, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

const TOKEN = "qa-acceptance-token-for-mq-itests-only-Hx41pWz8Lc";
const SESSION_PATH = "/site/v1/qa-acceptance/session";
const SUBMIT_PATH = "/site/v1/manual-quote-requests";

let api: TestApi;
let m: Market;
let clientId: string;
/** 配了验收口令的官网（测试环境的样子） */
let gated: SiteApi;
/** 没配口令的官网 */
let plain: SiteApi;
const apps: SiteApi[] = [];

let ipSeq = 0;
const nextIp = (): string => `10.83.${Math.floor(++ipSeq / 200)}.${ipSeq % 200}`;
let mailSeq = 0;
const nextEmail = (): string => `qa-lead-${++mailSeq}@example.com`;

const trip = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  category: "point_to_point",
  city_id: m.ids.tokyo,
  pickup: { name: "验收上车点", lat: 35.6938, lng: 139.7034 },
  dropoff: { name: "验收下车点", lat: 35.7647, lng: 140.3863 },
  service_local: "2026-12-01T09:30",
  passengers: 2,
  luggage: 1,
  ...overrides,
});

function submit(site: SiteApi, body: Record<string, unknown>, cookie?: string): Promise<ApiResponse> {
  // 隔 1 秒：列表按提交时间排序，要分得出先后
  api.clock.advance(1_000);
  return site.call("POST", SUBMIT_PATH, { ip: nextIp(), body: { consent: true, trip: trip(), ...body }, ...(cookie === undefined ? {} : { headers: { cookie } }) });
}

async function unlock(site: SiteApi = gated): Promise<string> {
  const res = await site.call("POST", SESSION_PATH, { ip: nextIp(), body: { token: TOKEN } });
  assert.equal(res.status, 201, res.text);
  return String(res.headers["set-cookie"]).split(";")[0] as string;
}

const list = (query = ""): Promise<ApiResponse> => api.call("GET", `/platform/v1/manual-quote-requests?limit=100${query}`, { token: m.root });
const rowOf = async (email: string): Promise<{ id: string; is_acceptance: boolean } | undefined> => {
  const listed = await ok(list(`&acceptance=include&contact=${encodeURIComponent(email)}`));
  return listed.items[0];
};
const countRows = async (): Promise<number> => (await api.db.owner.query<{ n: number }>("select count(*)::int as n from manual_quote_requests")).rows[0]?.n ?? 0;

/** 「万一」的 production 配置：配置层本来就不许 production 配口令（packages/config 的单元测试），这里证明代码里的第二道关。 */
async function productionSite(): Promise<SiteApi> {
  const loaded = loadConfig({ ...testEnv(api.db.url), ...UNREACHABLE_INTEGRATIONS, SITE_CLIENT_ID: clientId, QA_ACCEPTANCE_TOKEN: TOKEN });
  const app = buildApp({ config: { ...loaded, appEnv: "production" as const }, pool: api.db.pool, migrationFiles: await loadMigrationFiles(), now: api.clock.now, payments: new FakePaymentProvider(), logger: false });
  const site: SiteApi = {
    app,
    call: async (method, url, options = {}) => {
      const res = await app.inject({ method, url, headers: { ...options.headers }, ...(options.body === undefined ? {} : { payload: options.body as object }), remoteAddress: options.ip ?? nextIp() });
      return { status: res.statusCode, headers: res.headers, text: res.body, body: res.body === "" ? null : res.json() };
    },
    close: () => app.close(),
  };
  apps.push(site);
  return site;
}

before(async () => {
  api = await createTestApi();
  m = await buildMarket(api);
  const channel = await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" });
  clientId = (await salesCredentials(api, m, channel.id)).clientId;
  gated = await siteApi(api, clientId, new FakePaymentProvider(), { QA_ACCEPTANCE_TOKEN: TOKEN });
  plain = await siteApi(api, clientId, new FakePaymentProvider());
  apps.push(gated, plain);
});
after(async () => {
  for (const site of apps) await site.close();
  await api?.close();
});

test("不带验收会话：和以前一样，不是验收留资，运营后台列表默认就列出来（应答有 is_acceptance: false）", async () => {
  const email = nextEmail();
  const res = await submit(gated, { email });
  assert.equal(res.status, 202, res.text);
  assert.deepEqual(res.body, { status: "accepted" });
  const listed = await list();
  assert.equal(listed.status, 200, listed.text);
  assertMatchesOpenApi("GET", "/platform/v1/manual-quote-requests", listed);
  const mine = await rowOf(email);
  assert.equal(mine?.is_acceptance, false);
  assert.ok(listed.body.items.some((item: any) => item.id === mine?.id), "默认列表里有真实客人的留资");
  assert.equal((await api.db.owner.query("select is_acceptance from manual_quote_requests where id = $1", [mine?.id])).rows[0].is_acceptance, false);
});

test("带有效验收会话：记成验收留资；列表默认不列，acceptance=only / include 才列；各状态的数量跟着筛选；按联系方式查也默认不列；详情有标记", async () => {
  const cookie = await unlock();
  const real = nextEmail();
  const qa = nextEmail();
  assert.equal((await submit(gated, { email: real })).status, 202);
  const res = await submit(gated, { email: qa }, cookie);
  assert.equal(res.status, 202, res.text);
  assert.deepEqual(res.body, { status: "accepted" });
  assertMatchesOpenApi("POST", SUBMIT_PATH, res);

  const lead = await rowOf(qa);
  assert.equal(lead?.is_acceptance, true);
  const realRow = await rowOf(real);
  assert.equal(realRow?.is_acceptance, false);
  assert.equal((await api.db.owner.query("select is_acceptance from manual_quote_requests where id = $1", [lead?.id])).rows[0].is_acceptance, true);

  const byDefault = await ok(list());
  assert.ok(byDefault.items.every((item: any) => item.is_acceptance === false), "默认只列真实客人的");
  assert.ok(!byDefault.items.some((item: any) => item.id === lead?.id));
  assert.ok(byDefault.items.some((item: any) => item.id === realRow?.id));
  assert.deepEqual(await ok(list("&acceptance=exclude")), byDefault, "acceptance=exclude 和不给一样");

  const only = await list("&acceptance=only");
  assertMatchesOpenApi("GET", "/platform/v1/manual-quote-requests", only);
  assert.ok(only.body.items.length >= 1);
  assert.ok(only.body.items.every((item: any) => item.is_acceptance === true));
  assert.ok(only.body.items.some((item: any) => item.id === lead?.id));
  const both = await ok(list("&acceptance=include"));
  assert.ok(both.items.some((item: any) => item.id === lead?.id) && both.items.some((item: any) => item.id === realRow?.id));

  // 各状态的数量：默认只数真实客人的（「新」不被验收留资撑大）；跟着 acceptance 筛选
  const total = (counts: Record<string, number>): number => Object.values(counts).reduce((sum, n) => sum + n, 0);
  const all = (await api.db.owner.query<{ acc: boolean; n: number }>("select is_acceptance as acc, count(*)::int as n from manual_quote_requests group by is_acceptance")).rows;
  const dbCount = (acc: boolean): number => all.find((row) => row.acc === acc)?.n ?? 0;
  assert.equal(total(byDefault.counts), dbCount(false));
  assert.equal(total(only.body.counts), dbCount(true));
  assert.equal(total(both.counts), dbCount(false) + dbCount(true));

  // 按联系方式查：同样默认不列验收留资
  assert.deepEqual((await ok(list(`&contact=${encodeURIComponent(qa)}`))).items, []);
  assert.equal((await ok(list(`&contact=${encodeURIComponent(qa)}&acceptance=only`))).items.length, 1);

  const bad = await list("&acceptance=yes");
  assert.equal(bad.status, 400, bad.text);
  assert.equal(bad.body.error.code, "VALIDATION_FAILED");

  const detail = await api.call("GET", `/platform/v1/manual-quote-requests/${lead?.id}`, { token: m.root });
  assert.equal(detail.status, 200, detail.text);
  assertMatchesOpenApi("GET", "/platform/v1/manual-quote-requests/{id}", detail);
  assert.equal(detail.body.request.is_acceptance, true);
  assert.equal(detail.body.contact.email, qa);
});

test("验收留资和真实客人的留资各自去重：同一个联系方式、同一个行程先后各提交一次，两条都记；验收自己的重复只记一次", async () => {
  const cookie = await unlock();
  const email = nextEmail();
  const before = await countRows();
  assert.equal((await submit(gated, { email }, cookie)).status, 202);
  assert.equal((await submit(gated, { email })).status, 202);
  assert.equal(await countRows(), before + 2);
  // 验收留资自己的重复照样只记一次（真实客人的去重键和以前完全相同，manual-quotes.itest.ts 已覆盖；每个联系方式每天只能提交 3 次）
  assert.equal((await submit(gated, { email }, cookie)).status, 202);
  assert.equal(await countRows(), before + 2);
  const rows = (await api.db.owner.query<{ is_acceptance: boolean }>("select is_acceptance from manual_quote_requests order by created_at desc, id desc limit 2")).rows;
  assert.deepEqual(rows.map((row) => row.is_acceptance).sort(), [false, true]);
});

test("会话无效：过期、已结束、写坏了、通道没开都是 401 QA_SESSION_INVALID，什么都不记（和询价一样，不按普通客人记；陷阱字段也一样）", async () => {
  const before = await countRows();
  const expect401 = async (site: SiteApi, cookie: string, body: Record<string, unknown> = { email: nextEmail() }): Promise<void> => {
    const res = await submit(site, body, cookie);
    assert.equal(res.status, 401, `${cookie} → ${res.text}`);
    assert.equal(res.body.error.code, "QA_SESSION_INVALID");
    assertMatchesOpenApi("POST", SUBMIT_PATH, res);
  };
  await expect401(gated, "nozomi_qa=not-a-real-session");
  await expect401(gated, `nozomi_qa=${"A".repeat(43)}`);
  const live = await unlock();
  await expect401(plain, live);
  await expect401(gated, live.replace(/.$/, (last) => (last === "A" ? "B" : "A")));
  await expect401(gated, "nozomi_qa=garbage", { email: nextEmail(), website: "http://spam.example" });

  const ended = await unlock();
  assert.equal((await gated.call("DELETE", SESSION_PATH, { ip: nextIp(), headers: { cookie: ended } })).status, 204);
  await expect401(gated, ended);

  const expiring = await unlock();
  api.clock.advance(4 * 3_600_000 + 1);
  await expect401(gated, expiring);
  assert.equal(await countRows(), before);
  // 不带 Cookie 照常
  assert.equal((await submit(gated, { email: nextEmail() })).status, 202);
  assert.equal(await countRows(), before + 1);
});

test("验收留资不发提醒、不记未覆盖需求、不写审计（和真实客人的提交一样什么通知都没有）", async () => {
  const counts = async (): Promise<Record<string, number>> => {
    const result: Record<string, number> = {};
    for (const [name, sql] of [
      ["notification_events", "select count(*)::int as n from notification_events"],
      ["notifications", "select count(*)::int as n from notifications"],
      ["uncovered_demands", "select count(*)::int as n from uncovered_demands"],
      ["uncovered_demand_drops", "select count(*)::int as n from uncovered_demand_drops"],
      ["audit", "select count(*)::int as n from audit_logs where resource = 'manual_quote_request'"],
    ] as const) {
      result[name] = (await api.db.owner.query<{ n: number }>(sql)).rows[0]?.n ?? 0;
    }
    return result;
  };
  const cookie = await unlock();
  const before = await counts();
  const rows = await countRows();
  assert.equal((await submit(gated, { email: nextEmail() }, cookie)).status, 202);
  assert.equal((await submit(gated, { whatsapp: "+81 90-0000-3901", trip: trip({ category: "charter", dropoff: null, package_hours: 8 }) }, cookie)).status, 202);
  await gated.app.backgroundIdle();
  assert.equal(await countRows(), rows + 2);
  assert.deepEqual(await counts(), before);
});

test("标记建好之后谁都不能改（触发器）；跟进照常（改状态、写备注不受影响）", async () => {
  const cookie = await unlock();
  const email = nextEmail();
  assert.equal((await submit(gated, { email }, cookie)).status, 202);
  const lead = await rowOf(email);
  assert.equal(lead?.is_acceptance, true);
  await assert.rejects(api.db.owner.query("update manual_quote_requests set is_acceptance = false where id = $1", [lead?.id]), (err: unknown) => deniedByDatabase(err));
  const realEmail = nextEmail();
  assert.equal((await submit(gated, { email: realEmail })).status, 202);
  const real = await rowOf(realEmail);
  await assert.rejects(api.db.owner.query("update manual_quote_requests set is_acceptance = true where id = $1", [real?.id]), (err: unknown) => deniedByDatabase(err));
  // 原样写回同一个值不算改
  await api.db.owner.query("update manual_quote_requests set is_acceptance = is_acceptance where id = $1", [lead?.id]);

  const detail = await ok(api.call("GET", `/platform/v1/manual-quote-requests/${lead?.id}`, { token: m.root }));
  const closed = await api.call("PATCH", `/platform/v1/manual-quote-requests/${lead?.id}`, { token: m.root, body: { status: "closed" }, headers: { "if-match": `"${detail.request.version}"` } });
  assert.equal(closed.status, 200, closed.text);
  assert.equal(closed.body.request.is_acceptance, true);
  assert.equal(closed.body.request.status, "closed");
  assert.equal((await api.call("POST", `/platform/v1/manual-quote-requests/${lead?.id}/notes`, { token: m.root, body: { note: "验收留资，关闭" } })).status, 201);
  assert.equal((await api.db.owner.query("select is_acceptance from manual_quote_requests where id = $1", [lead?.id])).rows[0].is_acceptance, true);
});

test("production 不看 Cookie（第二道关）：带着测试环境的有效会话提交，照样按真实客人记", async () => {
  const prod = await productionSite();
  const cookie = await unlock();
  const email = nextEmail();
  const res = await submit(prod, { email }, cookie);
  assert.equal(res.status, 202, res.text);
  assert.equal((await rowOf(email))?.is_acceptance, false);
  // 写坏的 Cookie 在 production 也不看
  assert.equal((await submit(prod, { email: nextEmail() }, "nozomi_qa=garbage")).status, 202);
});

test("租户碰不到：租户令牌调运营后台列表（含筛选参数）401；租户的数据库角色读不到、改不了验收标记；/tenant/v1 没有这类接口", async () => {
  for (const query of ["", "&acceptance=only", "&acceptance=include"]) {
    assert.equal((await api.call("GET", `/platform/v1/manual-quote-requests?limit=10${query}`, { token: m.a.adminToken })).status, 401, query);
  }
  await assert.rejects(withTenantTx(api.db.pool, m.a.tenantId, (db) => db.query("select is_acceptance from manual_quote_requests")), (err: unknown) => deniedByDatabase(err));
  await assert.rejects(withTenantTx(api.db.pool, m.b.tenantId, (db) => db.query("update manual_quote_requests set is_acceptance = false")), (err: unknown) => deniedByDatabase(err));
  assert.ok(!api.app.registeredRoutes.some((route) => route.path.startsWith("/tenant/v1") && /manual/.test(route.path)));
});
