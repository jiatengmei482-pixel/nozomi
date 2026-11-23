/**
 * M9E-24：法律文案的待补项（ADR 0107）。经真实接口、真实 PostgreSQL。
 *
 * 覆盖：运营后台读写（权限、校验、版本、审计）、官网公开读（待补项和实时的取消政策）、正式环境没填齐不开放预订（测试站照常）、
 * /health 的 legal、租户碰不到（接口和数据库两层）。
 * 测试数据全在本文件里经接口建出来，随测试 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CANCELLATION_POLICY, LEGAL_FIELD_KEYS, PLATFORM_ROLES, type PlatformRole, platformRoleCan } from "@nozomi/domain";
import { withTenantTx } from "./db/context.ts";
import { deniedByDatabase } from "./testing/db.ts";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, type Staff, addStaff, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FILLED_LEGAL_FIELDS } from "./testing/legal.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

let api: TestApi;
let m: Market;
let clientId: string;
let staging: SiteApi;
let production: SiteApi;
const staff = new Map<PlatformRole, Staff>();

let ipSeq = 0;
const nextIp = (): string => `10.83.${Math.floor(++ipSeq / 200)}.${ipSeq % 200}`;

const token = (role: PlatformRole): string => (role === "super_admin" ? m.root : (staff.get(role) as Staff).token);
const platform = (role: PlatformRole, method: "GET" | "PUT", body?: unknown, headers?: Record<string, string>) =>
  api.call(method, "/platform/v1/legal-settings", { token: token(role), ...(body === undefined ? {} : { body }), ...(headers === undefined ? {} : { headers }) });
const ifMatch = (version: number): Record<string, string> => ({ "if-match": `"${version}"` });

const FILLED = FILLED_LEGAL_FIELDS;
const EMPTY = Object.fromEntries(LEGAL_FIELD_KEYS.map((key) => [key, null]));

/** 测试站、正式环境不许改的接口地址（只给本机和 CI 的测试用）清空 */
const DEPLOYED = { GOOGLE_MAPS_ROUTES_URL: "", GOOGLE_PLACES_SEARCH_URL: "", GOOGLE_PLACES_AUTOCOMPLETE_URL: "", GOOGLE_PLACE_DETAILS_URL: "", GOOGLE_GEOCODE_URL: "", GOOGLE_STATIC_MAPS_URL: "", STRIPE_API_URL: "", FX_SOURCE_URL: "https://fx.example.com/v6/latest/USD" };

const PRODUCTION_ENV = {
  ...DEPLOYED,
  APP_ENV: "production",
  AUTH_JWT_SECRET: "p".repeat(64),
  STRIPE_SECRET_KEY: "",
  STRIPE_PUBLISHABLE_KEY: "",
  STRIPE_WEBHOOK_SECRET: "",
};

before(async () => {
  api = await createTestApi();
  m = await buildMarket(api);
  for (const { key } of PLATFORM_ROLES) {
    if (key === "super_admin") continue;
    staff.set(key, key === "operations" ? m.staff.operations : key === "readonly" ? m.staff.readonly : key === "master_data" ? m.staff.masterData : key === "channel_manager" ? m.staff.cm1 : await addStaff(api, m.root, `${key.replace("_", "-")}@legal.test`, key));
  }
  const channel = await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" });
  clientId = (await salesCredentials(api, m, channel.id)).clientId;
  staging = await siteApi(api, clientId, new FakePaymentProvider(), { ...DEPLOYED, APP_ENV: "staging" });
  production = await siteApi(api, clientId, new FakePaymentProvider(), PRODUCTION_ENV);
});
after(async () => {
  await staging.close();
  await production.close();
  await api.close();
});

test("还没填过：运营后台看到 10 项都缺、版本 0；官网公开读到全是 null、未填齐、默认取消政策；测试站照常开放，正式环境不开放", async () => {
  const empty = await platform("customer_service", "GET");
  assert.equal(empty.status, 200, empty.text);
  assertMatchesOpenApi("GET", "/platform/v1/legal-settings", empty);
  assert.deepEqual(empty.body, { fields: EMPTY, missing: [...LEGAL_FIELD_KEYS], complete: false, required_for_launch: false, version: 0, updated_at: null, updated_by: null });

  const pub = await staging.call("GET", "/site/v1/legal", { ip: nextIp() });
  assert.equal(pub.status, 200, pub.text);
  assertMatchesOpenApi("GET", "/site/v1/legal", pub);
  assert.deepEqual(pub.body.fields, EMPTY);
  assert.equal(pub.body.complete, false);
  assert.equal(pub.body.cancellation_policy.version, 0);
  assert.deepEqual(
    pub.body.cancellation_policy.rules,
    DEFAULT_CANCELLATION_POLICY.map((rule) => ({ category: rule.category, level: rule.level, tiers: rule.tiers.map((tier) => ({ min_hours_before: tier.minHoursBefore, fee_bp: tier.feeBp })) })),
  );

  assert.equal((await staging.call("GET", "/site/v1/config", { ip: nextIp() })).body.open, true, "测试站没填齐照常开放（页面显示「未設定」）");
  const closed = await production.call("GET", "/site/v1/config", { ip: nextIp() });
  assert.equal(closed.body.open, false, "正式环境没填齐不开放预订");
  assert.equal((await production.call("GET", "/site/v1/legal", { ip: nextIp() })).status, 200, "官网没开放时三份文案照样能读");
  const cities = await production.call("GET", "/site/v1/cities", { ip: nextIp() });
  assert.equal(cities.status, 503);
  assert.equal(cities.body.error.code, "SITE_NOT_OPEN");
});

test("/health：legal 报未填齐和这个环境要不要求填齐，不影响 status", async () => {
  const local = await api.call("GET", "/health");
  assert.equal(local.status, 200, local.text);
  assertMatchesOpenApi("GET", "/health", local);
  assert.deepEqual(local.body.legal, { state: "incomplete", requiredForLaunch: false });
  const prod = await production.call("GET", "/health");
  assert.equal(prod.body.status, "ok", "没填齐不算故障：不然部署会回退，而待补项要新版本跑起来才能在后台填");
  assert.deepEqual(prod.body.legal, { state: "incomplete", requiredForLaunch: true });
});

test("权限：看 site_settings.read，改只有超级管理员；租户令牌 401", async () => {
  for (const { key: role } of PLATFORM_ROLES) {
    assert.equal((await platform(role, "GET")).status, platformRoleCan(role, "site_settings.read") ? 200 : 403, role);
    if (role !== "super_admin") assert.equal((await platform(role, "PUT", { fields: FILLED })).status, 403, role);
  }
  assert.equal((await api.call("GET", "/platform/v1/legal-settings", { token: m.a.adminToken })).status, 401);
  assert.equal((await api.call("PUT", "/platform/v1/legal-settings", { token: m.a.adminToken, body: { fields: FILLED } })).status, 401);
  assert.equal((await platform("customer_service", "GET")).body.version, 0, "被拒的请求什么都没改");
});

test("校验：邮箱、日期、长度按字段报；少键、多键、非字符串 400；被拒的不写库", async () => {
  const cases: [Record<string, unknown>, string, string][] = [
    [{ ...FILLED, contact_email: "not-an-email" }, "/fields/contact_email", "EMAIL_INVALID"],
    [{ ...FILLED, published_on: "2026-02-30" }, "/fields/published_on", "DATE_INVALID"],
    [{ ...FILLED, seller_name: "あ".repeat(201) }, "/fields/seller_name", "TOO_LONG"],
  ];
  for (const [fields, path, reason] of cases) {
    const res = await platform("super_admin", "PUT", { fields });
    assert.equal(res.status, 400, res.text);
    assertMatchesOpenApi("PUT", "/platform/v1/legal-settings", res);
    assert.deepEqual(
      res.body.error.details.issues.map((issue: { path: string; reason: string }) => [issue.path, issue.reason]),
      [[path, reason]],
    );
  }
  const { seller_name: _dropped, ...missingKey } = FILLED;
  for (const body of [{ fields: missingKey }, { fields: { ...FILLED, extra: "x" } }, { fields: { ...FILLED, seller_name: 1 } }, {}]) {
    assert.equal((await platform("super_admin", "PUT", body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await api.db.owner.query("select count(*)::int as n from site_legal_settings")).rows[0].n, 0);
});

test("保存：第一次不带 If-Match；之后要带、对不上 409；空白算没填；一样的不升版本；审计前后值；官网和后台都读到新值", async () => {
  const first = await platform("super_admin", "PUT", { fields: { ...FILLED, japan_contact: "  ", published_on: null } });
  assert.equal(first.status, 200, first.text);
  assertMatchesOpenApi("PUT", "/platform/v1/legal-settings", first);
  assert.equal(first.body.version, 1);
  assert.deepEqual(first.body.missing, ["japan_contact", "published_on"]);
  assert.equal(first.body.complete, false);
  assert.equal(first.body.fields.japan_contact, null);
  assert.equal(first.body.updated_by.name.length > 0, true);

  assert.equal((await platform("super_admin", "PUT", { fields: FILLED })).status, 409, "保存过之后要带 If-Match");
  assert.equal((await platform("super_admin", "PUT", { fields: FILLED }, ifMatch(5))).status, 409);

  const contact = "東京都千代田区（テスト）\n03-0000-0000";
  const second = await ok(platform("super_admin", "PUT", { fields: { ...FILLED, japan_contact: `${contact}\r\n` } }, ifMatch(1)));
  assert.equal(second.version, 2);
  assert.equal(second.complete, true);
  assert.deepEqual(second.missing, []);
  assert.equal(second.fields.japan_contact, contact, "首尾空白去掉、换行统一");

  const same = await ok(platform("super_admin", "PUT", { fields: { ...FILLED, japan_contact: contact } }, ifMatch(2)));
  assert.equal(same.version, 2, "和现在一样的不升版本、不写审计");

  const pub = await staging.call("GET", "/site/v1/legal", { ip: nextIp() });
  assert.deepEqual(pub.body.fields, { ...FILLED, japan_contact: contact });
  assert.equal(pub.body.complete, true);

  const audits = (await api.db.owner.query("select action, before, after from audit_logs where resource = 'site_legal_settings' order by id")).rows;
  assert.deepEqual(audits.map((row) => row.action), ["update", "update"]);
  assert.deepEqual(audits[0].before, { fields: EMPTY });
  assert.equal(audits[0].after.fields.published_on, null);
  assert.equal(audits[1].after.fields.japan_contact, contact);
});

test("正式环境填齐后开放预订；又清空一项马上不开放", async () => {
  const current = await ok(platform("super_admin", "GET"));
  assert.equal(current.complete, true);
  assert.equal((await production.call("GET", "/site/v1/config", { ip: nextIp() })).body.open, true);
  assert.deepEqual((await production.call("GET", "/health")).body.legal, { state: "complete", requiredForLaunch: true });

  const cleared = await ok(platform("super_admin", "PUT", { fields: { ...FILLED, japan_contact: current.fields.japan_contact, contact_email: "" } }, ifMatch(current.version)));
  assert.deepEqual(cleared.missing, ["contact_email"]);
  assert.equal((await production.call("GET", "/site/v1/config", { ip: nextIp() })).body.open, false);
  assert.equal((await staging.call("GET", "/site/v1/config", { ip: nextIp() })).body.open, true);
  await ok(platform("super_admin", "PUT", { fields: { ...FILLED, japan_contact: current.fields.japan_contact } }, ifMatch(cleared.version)));
});

test("取消政策改了，官网读到的跟着变（不写死）", async () => {
  const ops2 = await addStaff(api, m.root, "ops2@legal.test", "operations");
  const rules = DEFAULT_CANCELLATION_POLICY.map((rule) => ({
    category: rule.category,
    level: rule.level,
    tiers:
      rule.category === "charter"
        ? [
            { min_hours_before: 72, fee_bp: 0 },
            { min_hours_before: 24, fee_bp: 3_000 },
            { min_hours_before: 0, fee_bp: 10_000 },
          ]
        : rule.tiers.map((tier) => ({ min_hours_before: tier.minHoursBefore, fee_bp: tier.feeBp })),
  }));
  const requested = await ok(api.call("POST", "/platform/v1/cancellation-policy/changes", { token: m.staff.operations.token, body: { rules } }), 202);
  await ok(api.call("POST", `/platform/v1/approvals/${requested.approval.id}/approve`, { token: ops2.token, body: {} }));
  const pub = await staging.call("GET", "/site/v1/legal", { ip: nextIp() });
  assert.equal(pub.body.cancellation_policy.version, 1);
  const charter = pub.body.cancellation_policy.rules.find((rule: { category: string; level: string }) => rule.category === "charter" && rule.level === "economy");
  assert.deepEqual(charter.tiers, rules.find((rule) => rule.category === "charter" && rule.level === "economy")?.tiers);
});

test("租户碰不到：租户的数据库角色读不到、写不了这张表；/tenant/v1 没有这类接口", async () => {
  await assert.rejects(withTenantTx(api.db.pool, m.a.tenantId, (db) => db.query("select * from site_legal_settings")), (err: unknown) => deniedByDatabase(err));
  await assert.rejects(withTenantTx(api.db.pool, m.b.tenantId, (db) => db.query("update site_legal_settings set version = version")), (err: unknown) => deniedByDatabase(err));
  assert.ok(!api.app.registeredRoutes.some((route) => route.path.startsWith("/tenant/v1") && /legal/.test(route.path)));
});
