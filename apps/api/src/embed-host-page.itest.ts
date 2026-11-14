/**
 * M9E-16：预订流程嵌在合作网站页面里·第一期的接口部分（ADR 0095 第三节第 1 小节、第五节第 1 小节、第九节第 1 小节、Q6、Q13），经真实接口、真实 PostgreSQL。
 *
 * 覆盖：嵌入码的「允许整页嵌入」开关（默认关、修改不填保持原值、写审计、权限）；`GET /embed/v1/frame-check`（不看 Origin、不带 CORS 头、
 * 只放行打开了开关的启用嵌入码 + 规范的白名单 origin、改了下一次就生效、伪造写法一律 403、按地址单独限速）；建草稿带 `delivery`，
 * 询价、下单后订单来源记「宿主页内」，不带按跳主站算。测试数据全在本文件里建出来，随测试 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { BookingDraft } from "@nozomi/domain";
import type { TenantFixture } from "./testing/api.ts";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

let api: TestApi;
let m: Market;
let site: SiteApi;
const PARTNER = "https://partner.example";
const OTHER = "https://other.example";

let ipSeq = 0;
const nextIp = (): string => {
  ipSeq += 1;
  return `10.97.${Math.floor(ipSeq / 200)}.${ipSeq % 200}`;
};

const PICKUP = { lng: 139.7, lat: 35.6 };
const DROPOFF = { lng: 139.75, lat: 35.68 };
const draft = (): BookingDraft => ({
  v: 1,
  tab: "transfer",
  service_local: "2026-10-20T10:00",
  pickup: { name: "上车酒店", ...PICKUP },
  dropoff: { name: "下车酒店", ...DROPOFF },
  waypoints: [],
  package_hours: null,
  passengers: 2,
  luggage: 1,
  lang: "ja",
});

const corsHeaders = (headers: Record<string, unknown>): string[] => Object.keys(headers).filter((name) => /^access-control-/i.test(name));

async function p2pProduct(who: TenantFixture): Promise<void> {
  const token = await tenantLogin(api, who.adminEmail);
  const call = (method: "POST" | "PUT", path: string, body?: unknown, version?: number, status = 200): Promise<any> =>
    ok(
      api.call(method, `/tenant/v1${path}`, {
        token,
        ...(body === undefined ? {} : { body }),
        headers: { ...(version === undefined ? {} : { "if-match": `"${version}"` }), ...(method === "POST" && /^\/(products|brands|areas)$|\/price-rules$/.test(path) ? { "idempotency-key": randomUUID() } : {}) },
      }),
      status,
    );
  const brand = (await call("POST", "/brands", { name: `host-${who.tenantId.slice(0, 4)}`, currency: "JPY" }, undefined, 201)).id;
  api.clock.advance(1_000);
  const area = (await call("POST", "/areas", { city_id: m.ids.tokyo, name: { zh: "东京-宿主页" }, biz_type: "general", polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [[[139.0, 35.0], [140.0, 35.0], [140.0, 36.0], [139.0, 36.0], [139.0, 35.0]]] } }] }, undefined, 201)).id;
  const created = await call("POST", "/products", { brand_id: brand, city_id: m.ids.tokyo, category: "point_to_point", areas: [{ area_id: area }], vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0312345678" }] }, undefined, 201);
  const rules = await call("PUT", `/products/${created.id}/service-rules`, { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { general: { mode: "limited", minutes: 30 } } }, 1);
  const version = (await call("PUT", `/products/${created.id}/content`, { zh: { title: "东京市内用车" } }, rules.version)).version as number;
  await call("POST", `/products/${created.id}/price-rules`, { area_id: area, vehicle_group_id: m.ids.biz7, valid_from: "2026-01-01", pricing_model: "fixed", base_price: 15_000 }, version, 201);
  await call("POST", `/products/${created.id}/publish`);
}

const BASE = { name: "合作网站", default_lang: "ja", default_services: ["transfer"] };

async function newKey(changes: Record<string, unknown> = {}): Promise<any> {
  const res = await api.call("POST", "/platform/v1/embed-keys", { token: m.staff.operations.token, body: { ...BASE, allowed_origins: [PARTNER], ...changes } });
  assert.equal(res.status, 201, res.text);
  assertMatchesOpenApi("POST", "/platform/v1/embed-keys", res);
  return res.body;
}

const patchKey = (key: { id: string; version: number }, body: Record<string, unknown>, token = m.staff.operations.token) =>
  api.call("PATCH", `/platform/v1/embed-keys/${key.id}`, { token, headers: { "if-match": `"${key.version}"` }, body: { ...BASE, allowed_origins: [PARTNER], status: "active", ...body } });

/** frame-check 的查询串原样拼（测试要能发出重复参数、没编码的怪写法） */
const frameCheck = (query: string, options: { ip?: string; origin?: string } = {}) => api.call("GET", `/embed/v1/frame-check${query === "" ? "" : `?${query}`}`, { ip: options.ip ?? nextIp(), headers: options.origin === undefined ? {} : { origin: options.origin } });
const q = (key: string, host: string): string => `key=${encodeURIComponent(key)}&host=${encodeURIComponent(host)}`;

function assertRefused(res: Awaited<ReturnType<typeof frameCheck>>, label: string, status = 403): void {
  assert.equal(res.status, status, `${label}：${res.text}`);
  assert.equal(res.headers["x-nozomi-frame-ancestor"], undefined, label);
  assert.equal(res.headers["content-security-policy"], "default-src 'none'; frame-ancestors 'none'", label);
  assert.equal(res.headers["x-frame-options"], "DENY", label);
  assert.equal(res.headers["cache-control"], "no-store", label);
  assert.match(String(res.headers["content-type"]), /^text\/html; charset=utf-8/, label);
  assert.match(res.text, /这个网站不能显示 NOZOMI 预订页/, label);
  assert.deepEqual(corsHeaders(res.headers), [], label);
}

before(async () => {
  api = await createTestApi({ payments: new FakePaymentProvider() });
  m = await buildMarket(api);
  await p2pProduct(m.a);
  const channelId = (await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" })).id;
  site = await siteApi(api, (await salesCredentials(api, m, channelId)).clientId, new FakePaymentProvider());
});

after(async () => {
  await site?.close();
  await api.close();
});

test("允许整页嵌入（Q13）：新建不填按关、可填开；修改不填保持原值、填了才改；只读看得到改不了；取值不对 400；写进审计", async () => {
  const plain = await newKey();
  assert.equal(plain.allow_host_page, false, "默认关");
  const opened = await newKey({ allow_host_page: true });
  assert.equal(opened.allow_host_page, true);
  for (const value of ["true", 1, null]) {
    const res = await api.call("POST", "/platform/v1/embed-keys", { token: m.staff.operations.token, body: { ...BASE, allowed_origins: [PARTNER], allow_host_page: value } });
    assert.equal(res.status, 400, String(value));
  }

  const kept = await patchKey(opened, { name: "改名" });
  assert.equal(kept.status, 200, kept.text);
  assertMatchesOpenApi("PATCH", "/platform/v1/embed-keys/{id}", kept);
  assert.equal(kept.body.allow_host_page, true, "不填保持原值：只改名称的旧客户端不会关掉整页嵌入");
  const closed = await patchKey(kept.body, { allow_host_page: false });
  assert.equal(closed.status, 200, closed.text);
  assert.equal(closed.body.allow_host_page, false);
  assert.equal((await patchKey(closed.body, { allow_host_page: true }, m.staff.readonly.token)).status, 403, "只读角色改不了");
  assert.equal((await patchKey({ id: opened.id, version: closed.body.version + 3 }, { allow_host_page: true })).status, 409, "版本不对 409（If-Match）");
  const detail = await api.call("GET", `/platform/v1/embed-keys/${opened.id}`, { token: m.staff.readonly.token });
  assertMatchesOpenApi("GET", "/platform/v1/embed-keys/{id}", detail);
  assert.equal(detail.body.allow_host_page, false);

  const audits = await api.db.owner.query<{ action: string; before: { allow_host_page?: boolean } | null; after: { allow_host_page?: boolean } }>(
    "select action, before, after from audit_logs where resource = 'embed_key' and resource_id = $1 order by id",
    [opened.id],
  );
  assert.deepEqual(
    audits.rows.map((row) => [row.action, row.before?.allow_host_page ?? null, row.after.allow_host_page]),
    [
      ["create", null, true],
      ["update", true, true],
      ["update", true, false],
    ],
  );
  const config = await api.call("GET", `/embed/v1/config?key=${plain.key}`, { ip: nextIp(), headers: { origin: PARTNER } });
  assert.deepEqual(Object.keys(config.body).sort(), ["lang", "layout", "services", "site_origin"], "公开的配置接口不返回开关");
});

test("frame-check：开了开关的启用嵌入码 + 白名单里的规范 origin → 204 + X-Nozomi-Frame-Ancestor；不看 Origin、不带 CORS 头、不缓存", async () => {
  const key = await newKey({ allowed_origins: [PARTNER, "http://localhost:5173"], allow_host_page: true });
  for (const origin of [undefined, PARTNER, "https://evil.example", "null"]) {
    const res = await frameCheck(q(key.key, PARTNER), origin === undefined ? {} : { origin });
    assert.equal(res.status, 204, `Origin ${String(origin)}：${res.text}`);
    assert.equal(res.headers["x-nozomi-frame-ancestor"], PARTNER);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.deepEqual(corsHeaders(res.headers), [], "ADR 0090 的例外：不回任何 CORS 头");
    assert.equal(res.text, "");
  }
  assert.equal((await frameCheck(q(key.key, "http://localhost:5173"))).headers["x-nozomi-frame-ancestor"], "http://localhost:5173", "测试环境另收本机 http");
});

test("frame-check：没打开开关、停用、不存在、缺参数、不在白名单、不是规范 origin、注入指令、重复参数，一律 403（极简 HTML + frame-ancestors 'none'）", async () => {
  const off = await newKey();
  const on = await newKey({ allowed_origins: [PARTNER, OTHER], allow_host_page: true });
  const refused = (await frameCheck(q(off.key, PARTNER)));
  assertRefused(refused, "没打开整页嵌入");
  assertRefused(await frameCheck(q(`nze_${"Z".repeat(32)}`, PARTNER)), "嵌入码不存在");
  assertRefused(await frameCheck(""), "什么都没带");
  assertRefused(await frameCheck(`key=${on.key}`), "没带 host");
  assertRefused(await frameCheck(`host=${encodeURIComponent(PARTNER)}`), "没带 key");
  assertRefused(await frameCheck(`key=${on.key}&host=${encodeURIComponent(PARTNER)}&key=${off.key}`), "key 重复");
  assertRefused(await frameCheck(`key=${on.key}&host=${encodeURIComponent(PARTNER)}&host=${encodeURIComponent(OTHER)}`), "host 重复");
  for (const host of [
    "https://evil.example",
    `${PARTNER}.evil.example`,
    "https://Partner.Example",
    `${PARTNER}/`,
    `${PARTNER}/booking/`,
    `${PARTNER}:443`,
    "http://partner.example",
    `${PARTNER}; script-src *`,
    `${PARTNER} https://evil.example`,
    `'self'`,
    "*",
    "https://*.partner.example",
    "null",
    "",
    "x".repeat(400),
  ]) {
    assertRefused(await frameCheck(q(on.key, host)), `host=${host.slice(0, 40)}`);
  }
  assert.equal((await frameCheck(q(on.key, OTHER))).status, 204, "前提：同一个嵌入码的白名单网站照常放行");
});

test("frame-check：改白名单、停用、关开关后下一次就生效（每次查库）", async () => {
  let key = await newKey({ allowed_origins: [PARTNER, OTHER], allow_host_page: true });
  assert.equal((await frameCheck(q(key.key, OTHER))).status, 204);
  key = await ok(patchKey(key, { allowed_origins: [PARTNER], allow_host_page: true }));
  assertRefused(await frameCheck(q(key.key, OTHER)), "移出白名单");
  assert.equal((await frameCheck(q(key.key, PARTNER))).status, 204);
  key = await ok(patchKey(key, { allow_host_page: false }));
  assertRefused(await frameCheck(q(key.key, PARTNER)), "关掉整页嵌入");
  key = await ok(patchKey(key, { allow_host_page: true }));
  assert.equal((await frameCheck(q(key.key, PARTNER))).status, 204, "重新打开");
  key = await ok(patchKey(key, { status: "disabled" }));
  assertRefused(await frameCheck(q(key.key, PARTNER)), "停用嵌入码");
});

test("frame-check 限速：同一地址每分钟第 61 次 429（同样不能嵌，带 Retry-After）；别的地址照常；不占官网 site_read 的额度", async () => {
  const key = await newKey({ allow_host_page: true });
  const ip = "10.98.0.1";
  for (let i = 0; i < 60; i += 1) assert.equal((await frameCheck(q(key.key, PARTNER), { ip })).status, 204, `第 ${i + 1} 次`);
  const limited = await frameCheck(q(key.key, PARTNER), { ip });
  assertRefused(limited, "第 61 次", 429);
  assert.ok(Number(limited.headers["retry-after"]) > 0, "带 Retry-After");
  assert.equal((await frameCheck(q(key.key, PARTNER), { ip: "10.98.0.2" })).status, 204, "别的地址照常");
  assert.equal((await site.call("GET", "/site/v1/config", { ip })).status, 200, "同一地址的官网接口不受影响");
  api.clock.advance(61_000);
  assert.equal((await frameCheck(q(key.key, PARTNER), { ip })).status, 204, "过了一分钟恢复");
});

test("建草稿带 delivery：host_page 记在草稿上，询价、下单后订单来源是「宿主页内」；不带按跳主站（库里为空、接口给 redirect）；写错 400", async () => {
  const key = await newKey({ allow_host_page: true });
  const createDraft = (body: Record<string, unknown>) => api.call("POST", `/embed/v1/booking-drafts?key=${key.key}`, { ip: nextIp(), headers: { origin: PARTNER }, body: { draft: draft(), ...body } });
  const hostPage = await createDraft({ delivery: "host_page" });
  assert.equal(hostPage.status, 201, hostPage.text);
  assertMatchesOpenApi("POST", "/embed/v1/booking-drafts", hostPage);
  const redirect = await createDraft({});
  assert.equal(redirect.status, 201, redirect.text);
  const explicit = await createDraft({ delivery: "redirect" });
  assert.equal(explicit.status, 201, explicit.text);
  for (const delivery of ["iframe", "", null, true]) {
    const res = await createDraft({ delivery });
    assert.equal(res.status, 400, String(delivery));
    assert.equal(res.headers["access-control-allow-origin"], PARTNER);
  }
  const stored = await api.db.owner.query<{ id: string; delivery: string | null }>("select id, delivery from booking_drafts where id = any($1) order by id", [[hostPage.body.id, redirect.body.id, explicit.body.id]]);
  assert.deepEqual(Object.fromEntries(stored.rows.map((row) => [row.id, row.delivery])), { [hostPage.body.id]: "host_page", [redirect.body.id]: null, [explicit.body.id]: "redirect" });

  const order = async (draftId: string): Promise<any> => {
    const quoted = await site.call("POST", "/site/v1/quotes", { ip: nextIp(), body: { category: "point_to_point", city_id: m.ids.tokyo, pickup: PICKUP, dropoff: DROPOFF, service_local: "2026-10-20T10:00", passengers: 2, luggage: 1, draft_id: draftId } });
    assert.equal(quoted.status, 200, quoted.text);
    const quoteId = quoted.body.quotes[0].quote_id as string;
    const quoteSource = await api.db.owner.query<{ delivery: string | null }>("select delivery from quote_embed_sources where quote_id = $1", [quoteId]);
    api.clock.advance(1_000);
    const placed = await site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": randomUUID() }, ip: nextIp(), body: { quote_id: quoteId, passenger: { name: "宿主页客人", phone: "+81 90-3333-4444", email: "host-page-guest@example.com" }, save_payment_method: true, pickup_address: "上车酒店", dropoff_address: "下车酒店" } });
    assert.equal(placed.status, 201, placed.text);
    const detail = await api.call("GET", `/platform/v1/orders/${placed.body.order.id}`, { token: m.root });
    assert.equal(detail.status, 200, detail.text);
    assertMatchesOpenApi("GET", "/platform/v1/orders/{id}", detail);
    const orderSource = await api.db.owner.query<{ delivery: string | null }>("select delivery from order_embed_sources where order_id = $1", [placed.body.order.id]);
    return { quoteDelivery: quoteSource.rows[0]?.delivery, orderDelivery: orderSource.rows[0]?.delivery, entry: detail.body.entry_source };
  };
  const inHost = await order(hostPage.body.id);
  assert.equal(inHost.quoteDelivery, "host_page");
  assert.equal(inHost.orderDelivery, "host_page");
  assert.deepEqual(inHost.entry, { kind: "embed", embed_key_id: key.id, embed_key_name: "合作网站", embed_origin: PARTNER, delivery: "host_page" });
  const viaSite = await order(redirect.body.id);
  assert.equal(viaSite.orderDelivery, null, "库里不回填，空着");
  assert.equal(viaSite.entry.delivery, "redirect", "旧行为（空）按跳主站算");
});
