/**
 * 法律页面（M9E-24，ADR 0107）：运营后台填三页里业主留空的几项；公开接口给这几项和平台当前的取消政策；/health 报告填齐了没有。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { PLATFORM_ROLES, type PlatformRole, platformRoleCan } from "@nozomi/domain";
import { withTenantTx } from "./db/context.ts";
import { deniedByDatabase } from "./testing/db.ts";
import type { TestApi } from "./testing/api.ts";
import { createTestApi } from "./testing/api.ts";
import { type Market, type Staff, addStaff, buildMarket } from "./testing/market.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";

let api: TestApi;
let m: Market;
const staff = new Map<PlatformRole, Staff>();
let ipSeq = 0;
const nextIp = (): string => `10.83.${Math.floor(++ipSeq / 200)}.${ipSeq % 200}`;

const token = (role: PlatformRole): string => (role === "super_admin" ? m.root : (staff.get(role) as Staff).token);
const platform = (role: PlatformRole, method: "GET" | "PUT", body?: unknown, headers?: Record<string, string>) =>
  api.call(method, "/platform/v1/legal-page-settings", { token: token(role), ...(body === undefined ? {} : { body }), ...(headers === undefined ? {} : { headers }) });
const publicPages = () => api.call("GET", "/site/v1/legal-pages", { ip: nextIp() });

const FILLED = {
  seller: "  RELAX CAR SERVICE CO. LIMITED（営業名：Relax Airport Taxi）  ",
  japan_contact: "請求があった場合は遅滞なく開示します",
  email: "support@example.com",
  mail_provider: "Example Mail",
  mail_provider_country: "米国",
  map_provider: "Example Maps",
  map_provider_country: "米国",
  server_provider: "Example Cloud",
  server_provider_country: "日本",
  published_on: "2026-12-01",
};
const EMPTY = Object.fromEntries(Object.keys(FILLED).map((key) => [key, null]));

before(async () => {
  api = await createTestApi();
  m = await buildMarket(api);
  for (const { key } of PLATFORM_ROLES) {
    if (key === "super_admin") continue;
    staff.set(key, key === "operations" ? m.staff.operations : key === "readonly" ? m.staff.readonly : key === "master_data" ? m.staff.masterData : key === "channel_manager" ? m.staff.cm1 : await addStaff(api, m.root, `${key.replace("_", "-")}@legal.test`, key));
  }
});
after(() => api.close());

test("没设置过：后台和公开接口每一项都是 null、complete 为 false；公开接口带平台当前的取消政策（默认政策，版本 0）；/health 报告 incomplete 但仍 200", async () => {
  const empty = await platform("customer_service", "GET");
  assert.equal(empty.status, 200, empty.text);
  assertMatchesOpenApi("GET", "/platform/v1/legal-page-settings", empty);
  assert.deepEqual(empty.body, {
    seller: null,
    japan_contact: null,
    email: null,
    mail_provider: { name: null, country: null },
    map_provider: { name: null, country: null },
    server_provider: { name: null, country: null },
    published_on: null,
    complete: false,
    version: 0,
    updated_at: null,
    updated_by: null,
  });
  const pages = await publicPages();
  assert.equal(pages.status, 200, pages.text);
  assertMatchesOpenApi("GET", "/site/v1/legal-pages", pages);
  assert.equal(pages.body.complete, false);
  assert.equal(pages.body.seller, null);
  assert.equal(pages.body.cancellation_policy.version, 0);
  assert.equal(pages.body.cancellation_policy.rules.length, 15);
  assert.deepEqual(
    pages.body.cancellation_policy.rules.find((rule: { category: string; level: string }) => rule.category === "airport_transfer" && rule.level === "economy").tiers,
    [
      { min_hours_before: 24, fee_bp: 0 },
      { min_hours_before: 6, fee_bp: 5000 },
      { min_hours_before: 0, fee_bp: 10000 },
    ],
  );
  assert.equal(pages.headers["cache-control"], "no-store");
  const health = await api.call("GET", "/health");
  assert.equal(health.status, 200, health.text);
  assert.equal(health.body.legal_pages, "incomplete");
});

test("权限同官网设置：运营、客服能看，只有超级管理员能改；租户令牌 401；租户的数据库角色读写不了这张表", async () => {
  for (const { key: role } of PLATFORM_ROLES) {
    assert.equal((await platform(role, "GET")).status, platformRoleCan(role, "site_settings.read") ? 200 : 403, role);
    if (role !== "super_admin") assert.equal((await platform(role, "PUT", FILLED)).status, 403, role);
  }
  assert.equal((await api.call("GET", "/platform/v1/legal-page-settings", { token: m.a.adminToken })).status, 401);
  await assert.rejects(withTenantTx(api.db.pool, m.a.tenantId, (db) => db.query("select * from legal_page_settings")), (err: unknown) => deniedByDatabase(err));
  await assert.rejects(withTenantTx(api.db.pool, m.a.tenantId, (db) => db.query("update legal_page_settings set id = id")), (err: unknown) => deniedByDatabase(err));
});

test("格式核对：少给一项、多给字段、邮箱不像、日期不存在、超长、控制字符都 400，库里不变", async () => {
  const missing = Object.fromEntries(Object.entries(FILLED).filter(([key]) => key !== "email"));
  const bad: Record<string, unknown>[] = [
    missing,
    { ...FILLED, extra: "x" },
    { ...FILLED, email: "not-an-email" },
    { ...FILLED, published_on: "2026-02-31" },
    { ...FILLED, published_on: "12/01/2026" },
    { ...FILLED, published_on: "2026-13-01" },
    { ...FILLED, published_on: "0000-01-01" },
    { ...FILLED, seller: "字".repeat(201) },
    { ...FILLED, mail_provider_country: "国".repeat(41) },
    { ...FILLED, japan_contact: "東京\u0000都" },
  ];
  for (const body of bad) {
    const res = await platform("super_admin", "PUT", body);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
    assert.equal(res.body.error.code, "VALIDATION_FAILED");
  }
  assert.equal((await platform("super_admin", "GET")).body.version, 0);
});

test("保存：首尾空白去掉、空白当 null；公开接口照给；填齐后 complete、/health 为 complete；设置过之后要带 If-Match，版本对不上 409；没变化不加版本；审计前后值", async () => {
  const saved = await platform("super_admin", "PUT", { ...FILLED, japan_contact: "   " });
  assert.equal(saved.status, 200, saved.text);
  assertMatchesOpenApi("PUT", "/platform/v1/legal-page-settings", saved);
  assert.equal(saved.body.seller, "RELAX CAR SERVICE CO. LIMITED（営業名：Relax Airport Taxi）");
  assert.equal(saved.body.japan_contact, null);
  assert.equal(saved.body.complete, false);
  assert.equal(saved.body.version, 1);
  assert.equal(saved.body.updated_by.id !== undefined, true);
  assert.equal((await api.call("GET", "/health")).body.legal_pages, "incomplete");

  assert.equal((await platform("super_admin", "PUT", FILLED)).status, 409, "设置过之后要带 If-Match");
  assert.equal((await platform("super_admin", "PUT", FILLED, { "if-match": "7" })).status, 409);
  const full = await platform("super_admin", "PUT", FILLED, { "if-match": "1" });
  assert.equal(full.status, 200, full.text);
  assert.equal(full.body.complete, true);
  assert.equal(full.body.version, 2);
  const again = await platform("super_admin", "PUT", FILLED, { "if-match": "2" });
  assert.equal(again.body.version, 2, "没变化不加版本");

  const pages = await publicPages();
  assertMatchesOpenApi("GET", "/site/v1/legal-pages", pages);
  assert.equal(pages.body.complete, true);
  assert.deepEqual(pages.body.mail_provider, { name: "Example Mail", country: "米国" });
  assert.equal(pages.body.published_on, "2026-12-01");
  assert.equal(pages.body.email, "support@example.com");
  assert.equal((await api.call("GET", "/health")).body.legal_pages, "complete");

  const audits = (await api.db.owner.query("select action, before, after from audit_logs where resource = 'legal_page_settings' order by id")).rows;
  assert.deepEqual(audits.map((row) => row.action), ["update", "update"]);
  assert.equal(audits[0].before.seller, null);
  assert.equal(audits[1].before.japan_contact, null);
  assert.equal(audits[1].after.japan_contact, "請求があった場合は遅滞なく開示します");

  // 清空一项：又变回没填齐
  const cleared = await platform("super_admin", "PUT", { ...FILLED, published_on: "" }, { "if-match": "2" });
  assert.equal(cleared.body.published_on, null);
  assert.equal((await publicPages()).body.complete, false);
  assert.equal((await platform("super_admin", "PUT", EMPTY, { "if-match": "3" })).body.complete, false);
});
