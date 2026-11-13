/**
 * M9E-02：嵌入组件的嵌入码与白名单、`/embed/v1` 的跨域规则、建草稿、来源统计（ADR 0090），经真实接口、真实 PostgreSQL。
 *
 * 覆盖：运营后台的权限矩阵、校验、`If-Match`、审计；`/embed/v1` 白名单（完全相等；null、缺失、只差一点、http、停用都 403 且无 CORS 头）、预检；
 * 建草稿（201 + 主站地址、多余键 400、16 KB 413、return_url 不合格被忽略、每地址 / 每嵌入码限速、5,000 个有效草稿上限、过期后恢复）；
 * 来源：草稿 → 询价 → 下单记「嵌入组件」和返回地址，下单前移出白名单记主站、不拒单；`/tenant/v1` 订单详情没有来源；
 * `/site/v1`、`/platform/v1`、`/tenant/v1` 带白名单 Origin 也不带 CORS 头。测试数据全在本文件里建出来，随测试 schema 一起删除。
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
import { type FakeReceiver, startFakeReceiver } from "./testing/dispatch.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

let api: TestApi;
let m: Market;
let site: SiteApi;
let pay: FakePaymentProvider;
let receiver: FakeReceiver;
const PARTNER = "https://partner.example";
const OTHER = "https://other.example";

let ipSeq = 0;
const nextIp = (): string => {
  ipSeq += 1;
  return `10.93.${Math.floor(ipSeq / 200)}.${ipSeq % 200}`;
};

const PICKUP = { lng: 139.7, lat: 35.6 };
const DROPOFF = { lng: 139.75, lat: 35.68 };
const draft = (changes: Partial<BookingDraft> = {}): BookingDraft => ({
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
  ...changes,
});

const corsHeaders = (headers: Record<string, unknown>): string[] => Object.keys(headers).filter((name) => /^access-control-/i.test(name));

async function p2pProduct(who: TenantFixture): Promise<void> {
  const token = await tenantLogin(api, who.adminEmail);
  const call = (method: "POST" | "PUT" | "GET", path: string, body?: unknown, version?: number, status = 200): Promise<any> =>
    ok(
      api.call(method, `/tenant/v1${path}`, {
        token,
        ...(body === undefined ? {} : { body }),
        headers: { ...(version === undefined ? {} : { "if-match": `"${version}"` }), ...(method === "POST" && /^\/(products|brands|areas)$|\/price-rules$/.test(path) ? { "idempotency-key": randomUUID() } : {}) },
      }),
      status,
    );
  const brand = (await call("POST", "/brands", { name: `embed-${who.tenantId.slice(0, 4)}`, currency: "JPY" }, undefined, 201)).id;
  api.clock.advance(1_000);
  const area = (await call("POST", "/areas", { city_id: m.ids.tokyo, name: { zh: "东京-嵌入" }, biz_type: "general", polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [[[139.0, 35.0], [140.0, 35.0], [140.0, 36.0], [139.0, 36.0], [139.0, 35.0]]] } }] }, undefined, 201)).id;
  const created = await call("POST", "/products", { brand_id: brand, city_id: m.ids.tokyo, category: "point_to_point", areas: [{ area_id: area }], vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0312345678" }] }, undefined, 201);
  const rules = await call("PUT", `/products/${created.id}/service-rules`, { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { general: { mode: "limited", minutes: 30 } } }, 1);
  const version = (await call("PUT", `/products/${created.id}/content`, { zh: { title: "东京市内用车" } }, rules.version)).version as number;
  await call("POST", `/products/${created.id}/price-rules`, { area_id: area, vehicle_group_id: m.ids.biz7, valid_from: "2026-01-01", pricing_model: "fixed", base_price: 15_000 }, version, 201);
  await call("POST", `/products/${created.id}/publish`);
}

async function newKey(origins: string[] = [PARTNER], token = m.staff.operations.token): Promise<any> {
  const res = await api.call("POST", "/platform/v1/embed-keys", { token, body: { name: "合作网站", allowed_origins: origins, default_lang: "ja", default_services: ["transfer", "charter"] } });
  assert.equal(res.status, 201, res.text);
  assertMatchesOpenApi("POST", "/platform/v1/embed-keys", res);
  return res.body;
}

const embed = (method: "GET" | "POST", path: string, key: string, origin: string | null, body?: unknown, ip = nextIp()) =>
  api.call(method, `${path}${path.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}`, { ip, headers: origin === null ? {} : { origin }, ...(body === undefined ? {} : { body }) });

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  await p2pProduct(m.a);
  receiver = await startFakeReceiver();
  await ok(api.call("PUT", "/tenant/v1/webhooks", { token: m.a.adminToken, body: { url: receiver.url, events: ["order.confirmed"] } }), 201);
  const channelId = (await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" })).id;
  site = await siteApi(api, (await salesCredentials(api, m, channelId)).clientId, pay);
});

after(async () => {
  await receiver?.close();
  await site?.close();
  await api.close();
});

test("运营后台：运营、渠道经理能建能改，只读只能看，客服看不到；嵌入码由服务端生成；白名单规范化；带代码；写审计", async () => {
  const created = await newKey(["https://Partner.Example/", "http://localhost:5173"]);
  assert.match(created.key, /^nze_[A-Za-z0-9_-]{32}$/);
  assert.deepEqual(created.allowed_origins, [PARTNER, "http://localhost:5173"], "测试环境另收本机 http");
  assert.match(created.snippet, new RegExp(`NozomiBooking\\.init\\(\\{ key: "${created.key}"`));
  assert.equal((await api.call("POST", "/platform/v1/embed-keys", { token: m.staff.cm1.token, body: { name: "渠道经理建的", allowed_origins: [OTHER], default_lang: "en", default_services: ["charter"] } })).status, 201);
  const list = await api.call("GET", "/platform/v1/embed-keys", { token: m.staff.readonly.token });
  assert.equal(list.status, 200);
  assertMatchesOpenApi("GET", "/platform/v1/embed-keys", list);
  assert.ok(list.body.items.some((item: any) => item.id === created.id));
  assert.equal((await api.call("POST", "/platform/v1/embed-keys", { token: m.staff.readonly.token, body: { name: "x", allowed_origins: [PARTNER], default_lang: "ja", default_services: ["transfer"] } })).status, 403);
  assert.equal((await api.call("GET", "/platform/v1/embed-keys", { token: m.staff.masterData.token })).status, 403);

  const bad = await api.call("POST", "/platform/v1/embed-keys", { token: m.root, body: { name: " ", allowed_origins: ["https://*.partner.example", "https://partner.example/path"], default_lang: "ja", default_services: [] } });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body.error.details.issues.map((issue: any) => issue.path), ["/name", "/allowed_origins/0", "/allowed_origins/1", "/default_services"]);

  const patch = (version: string | undefined, body: Record<string, unknown>) =>
    api.call("PATCH", `/platform/v1/embed-keys/${created.id}`, { token: m.staff.operations.token, headers: version === undefined ? {} : { "if-match": version }, body: { name: "合作网站", allowed_origins: [PARTNER], default_lang: "ja", default_services: ["transfer"], status: "active", ...body } });
  assert.equal((await patch(undefined, {})).status, 428);
  assert.equal((await patch(`"${created.version + 5}"`, {})).status, 409);
  const updated = await patch(`"${created.version}"`, { name: "合作网站 · 改名" });
  assert.equal(updated.status, 200, updated.text);
  assertMatchesOpenApi("PATCH", "/platform/v1/embed-keys/{id}", updated);
  assert.equal(updated.body.version, created.version + 1);
  assert.equal(updated.body.key, created.key, "嵌入码改不了");
  const audits = await api.db.owner.query<{ action: string }>("select action from audit_logs where resource = 'embed_key' and resource_id = $1 order by id", [created.id]);
  assert.deepEqual(audits.rows.map((row) => row.action), ["create", "update"]);
  const detail = await api.call("GET", `/platform/v1/embed-keys/${created.id}`, { token: m.staff.cm1.token });
  assertMatchesOpenApi("GET", "/platform/v1/embed-keys/{id}", detail);
  assert.equal((await api.call("GET", `/platform/v1/embed-keys/${randomUUID()}`, { token: m.root })).status, 404);
});

test("/embed/v1/config：Origin 完全等于白名单某项才 200 + CORS 头；null、缺失、只差一点、http、别的网站、嵌入码不存在都 403 且无 CORS 头", async () => {
  const key = await newKey();
  const okRes = await embed("GET", "/embed/v1/config", key.key, PARTNER);
  assert.equal(okRes.status, 200, okRes.text);
  assertMatchesOpenApi("GET", "/embed/v1/config", okRes);
  assert.deepEqual({ ...okRes.body, site_origin: typeof okRes.body.site_origin }, { lang: "ja", services: ["transfer", "charter"], site_origin: "string" });
  assert.equal(new URL(okRes.body.site_origin).origin, okRes.body.site_origin);
  assert.equal(okRes.headers["access-control-allow-origin"], PARTNER);
  assert.match(String(okRes.headers["vary"]), /Origin/);
  assert.equal(okRes.headers["cache-control"], "private, max-age=60");
  assert.equal(okRes.headers["access-control-allow-credentials"], undefined);
  for (const origin of [null, "null", `${PARTNER}.evil.example`, "http://partner.example", "https://partner.example:8443", OTHER]) {
    const res = await embed("GET", "/embed/v1/config", key.key, origin);
    assert.equal(res.status, 403, String(origin));
    assert.equal(res.body.error.code, "EMBED_ORIGIN_NOT_ALLOWED");
    assert.deepEqual(corsHeaders(res.headers), [], String(origin));
    assert.match(String(res.headers["vary"]), /Origin/, "拒绝的应答也带 Vary: Origin");
  }
  assert.equal((await embed("GET", "/embed/v1/config", `nze_${"Z".repeat(32)}`, PARTNER)).status, 403);
  assert.equal((await api.call("GET", "/embed/v1/config", { headers: { origin: PARTNER } })).status, 403, "没带 key");
});

test("预检 OPTIONS：白名单 204 + 允许的方法和头；不在白名单 403 无 CORS 头", async () => {
  const key = await newKey();
  const preflight = (origin: string) => api.call("OPTIONS" as "GET", `/embed/v1/booking-drafts?key=${key.key}`, { ip: nextIp(), headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type" } });
  const allowed = await preflight(PARTNER);
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers["access-control-allow-origin"], PARTNER);
  assert.equal(allowed.headers["access-control-allow-methods"], "POST");
  assert.equal(allowed.headers["access-control-allow-headers"], "content-type");
  assert.equal(allowed.headers["access-control-max-age"], "600");
  const denied = await preflight(OTHER);
  assert.equal(denied.status, 403);
  assert.deepEqual(corsHeaders(denied.headers), []);
});

test("停用嵌入码、把网站移出白名单后马上 403", async () => {
  const key = await newKey([PARTNER, OTHER]);
  assert.equal((await embed("GET", "/embed/v1/config", key.key, OTHER)).status, 200);
  const save = (body: Record<string, unknown>, version: number) =>
    ok(api.call("PATCH", `/platform/v1/embed-keys/${key.id}`, { token: m.root, headers: { "if-match": `"${version}"` }, body: { name: key.name, allowed_origins: [PARTNER, OTHER], default_lang: "ja", default_services: ["transfer"], status: "active", ...body } }));
  const narrowed = await save({ allowed_origins: [PARTNER] }, key.version);
  assert.equal((await embed("GET", "/embed/v1/config", key.key, OTHER)).status, 403);
  assert.equal((await embed("GET", "/embed/v1/config", key.key, PARTNER)).status, 200);
  await save({ allowed_origins: [PARTNER], status: "disabled" }, narrowed.version);
  const disabled = await embed("GET", "/embed/v1/config", key.key, PARTNER);
  assert.equal(disabled.status, 403);
  assert.deepEqual(corsHeaders(disabled.headers), []);
});

test("建草稿：201 + 主站地址，主站读得到；多余键 400、16 KB 413（都带 CORS 头的只有过了白名单的）；return_url 不合格被忽略", async () => {
  const key = await newKey([PARTNER, OTHER]);
  const created = await embed("POST", "/embed/v1/booking-drafts", key.key, PARTNER, { draft: draft(), return_url: `${PARTNER}/thanks` });
  assert.equal(created.status, 201, created.text);
  assertMatchesOpenApi("POST", "/embed/v1/booking-drafts", created);
  assert.match(created.body.id, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(new URL(created.body.url).pathname, "/book/new");
  assert.equal(new URL(created.body.url).searchParams.get("draft"), created.body.id);
  assert.equal(created.headers["access-control-allow-origin"], PARTNER);
  const read = await api.call("GET", `/site/v1/booking-drafts/${created.body.id}`, { ip: nextIp() });
  assert.deepEqual(read.body.draft, draft());
  const stored = await api.db.owner.query("select embed_key_id, embed_origin, return_url from booking_drafts where id = $1", [created.body.id]);
  assert.deepEqual(stored.rows[0], { embed_key_id: key.id, embed_origin: PARTNER, return_url: `${PARTNER}/thanks` });

  const extra = await embed("POST", "/embed/v1/booking-drafts", key.key, PARTNER, { draft: { ...draft(), passenger: { name: "陈小红" } } });
  assert.equal(extra.status, 400);
  assert.equal(extra.body.error.code, "VALIDATION_FAILED");
  assert.equal(extra.headers["access-control-allow-origin"], PARTNER, "过了白名单之后的错误也带 CORS 头，组件才读得到原因");
  const stay = await embed("POST", "/embed/v1/booking-drafts", key.key, PARTNER, { draft: draft({ tab: "charter", waypoints: [{ name: "x", lat: 35.6, lng: 139.7, stay_minutes: 45 }] }) });
  assert.equal(stay.status, 400);
  const huge = await embed("POST", "/embed/v1/booking-drafts", key.key, PARTNER, { draft: draft(), return_url: "x".repeat(16_400) });
  assert.equal(huge.status, 413);
  assert.equal(huge.headers["access-control-allow-origin"], PARTNER, "核对来源在解析请求体之前：413 也带 CORS 头");
  assert.match(String(huge.headers["vary"]), /Origin/);
  const hugeDenied = await embed("POST", "/embed/v1/booking-drafts", key.key, "https://evil.example", { draft: draft(), return_url: "x".repeat(16_400) });
  assert.equal(hugeDenied.status, 403, "来源不对时先 403，不解析请求体");
  assert.deepEqual(corsHeaders(hugeDenied.headers), []);

  for (const returnUrl of ["javascript:alert(1)", "https://user:pass@partner.example/", `${PARTNER}.evil.example/`, `${OTHER}/thanks`, "https://partner.example:8443/", `${PARTNER}/${"a".repeat(2_000)}`]) {
    const res = await embed("POST", "/embed/v1/booking-drafts", key.key, PARTNER, { draft: draft(), return_url: returnUrl });
    assert.equal(res.status, 201, returnUrl);
    const row = await api.db.owner.query<{ return_url: string | null }>("select return_url from booking_drafts where id = $1", [res.body.id]);
    assert.equal(row.rows[0]?.return_url, null, returnUrl);
  }
});

test("建草稿限速：同一地址 10 分钟第 31 次、同一嵌入码 1 分钟第 61 次都 429；有效草稿满 5,000 个 429 EMBED_DRAFT_LIMIT，过期后恢复", async () => {
  const key = await newKey();
  const ip = "10.94.0.1";
  for (let i = 0; i < 30; i += 1) assert.equal((await embed("POST", "/embed/v1/booking-drafts", key.key, PARTNER, { draft: draft() }, ip)).status, 201);
  const perIp = await embed("POST", "/embed/v1/booking-drafts", key.key, PARTNER, { draft: draft() }, ip);
  assert.equal(perIp.status, 429);
  assert.equal(perIp.body.error.code, "RATE_LIMITED");
  for (let i = 0; i < 30; i += 1) assert.equal((await embed("POST", "/embed/v1/booking-drafts", key.key, PARTNER, { draft: draft() })).status, 201);
  const perKey = await embed("POST", "/embed/v1/booking-drafts", key.key, PARTNER, { draft: draft() });
  assert.equal(perKey.status, 429, "同一嵌入码 1 分钟里第 61 次");
  assert.equal(perKey.headers["access-control-allow-origin"], PARTNER, "429 也带 CORS 头，组件读得到原因");
  api.clock.advance(61_000);

  const full = await newKey();
  const now = api.clock.now();
  await api.db.owner.query(
    `insert into booking_drafts (id, content, embed_key_id, embed_origin, created_at, expires_at)
     select rpad(md5(g::text), 43, 'x'), $1::jsonb, $2, $3, $4, $5 from generate_series(1, 5000) g`,
    [JSON.stringify(draft()), full.id, PARTNER, now, new Date(now.getTime() + 60_000)],
  );
  const limited = await embed("POST", "/embed/v1/booking-drafts", full.key, PARTNER, { draft: draft() });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, "EMBED_DRAFT_LIMIT");
  api.clock.advance(61_000);
  assert.equal((await embed("POST", "/embed/v1/booking-drafts", full.key, PARTNER, { draft: draft() })).status, 201, "旧草稿过期后又能建");
});

test("来源：草稿 → 询价 → 下单记「嵌入组件」和返回地址；下单前移出白名单记主站、不拒单；供应商看不到来源", async () => {
  const key = await newKey([PARTNER, OTHER]);
  const quoteAndOrder = async (draftId: string | null): Promise<any> => {
    const quoted = await site.call("POST", "/site/v1/quotes", { ip: nextIp(), body: { category: "point_to_point", city_id: m.ids.tokyo, pickup: PICKUP, dropoff: DROPOFF, service_local: "2026-10-20T10:00", passengers: 2, luggage: 1, ...(draftId === null ? {} : { draft_id: draftId }) } });
    assert.equal(quoted.status, 200, quoted.text);
    return quoted.body.quotes[0].quote_id;
  };
  const place = async (quoteId: string): Promise<any> => {
    api.clock.advance(1_000);
    const res = await site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": randomUUID() }, ip: nextIp(), body: { quote_id: quoteId, passenger: { name: "陈小红", phone: "+81 90-2222-3333", email: "widget-guest@example.com" }, save_payment_method: true, pickup_address: "上车酒店", dropoff_address: "下车酒店" } });
    assert.equal(res.status, 201, res.text);
    assertMatchesOpenApi("POST", "/site/v1/orders", res);
    return res.body;
  };
  const draftId = (await ok(embed("POST", "/embed/v1/booking-drafts", key.key, PARTNER, { draft: draft(), return_url: `${PARTNER}/thanks` }), 201)).id;

  const embedded = await place(await quoteAndOrder(draftId));
  assert.equal(embedded.return_url, `${PARTNER}/thanks`);
  const detail = await ok(api.call("GET", `/platform/v1/orders/${embedded.order.id}`, { token: m.root }));
  assert.deepEqual(detail.entry_source, { kind: "embed", embed_key_id: key.id, embed_key_name: "合作网站", embed_origin: PARTNER });

  const plain = await place(await quoteAndOrder(null));
  assert.equal(plain.return_url, null);
  assert.deepEqual((await ok(api.call("GET", `/platform/v1/orders/${plain.order.id}`, { token: m.root }))).entry_source, { kind: "book", embed_key_id: null, embed_key_name: null, embed_origin: null });
  const unknownDraft = await place(await quoteAndOrder("x".repeat(43)));
  assert.equal(unknownDraft.return_url, null, "草稿不存在照常报价下单、不记来源");
  const malformed = await place(await quoteAndOrder("not-a-draft"));
  assert.equal(malformed.return_url, null, "草稿编号格式不对也只是忽略，不报错");

  const quoteId = await quoteAndOrder(draftId);
  await ok(api.call("PATCH", `/platform/v1/embed-keys/${key.id}`, { token: m.root, headers: { "if-match": `"${key.version}"` }, body: { name: key.name, allowed_origins: [OTHER], default_lang: "ja", default_services: ["transfer"], status: "active" } }));
  const removed = await place(quoteId);
  assert.equal(removed.return_url, null);
  assert.equal((await ok(api.call("GET", `/platform/v1/orders/${removed.order.id}`, { token: m.root }))).entry_source.kind, "book", "下单前移出白名单：照常建单，按主站算");

  // 付款后中标的甲看得到这张单，但看不到来源
  const seen = await site.call("GET", "/site/v1/order", { token: embedded.link.token, ip: nextIp() });
  assertMatchesOpenApi("GET", "/site/v1/order", seen);
  assert.equal(seen.body.return_url, `${PARTNER}/thanks`, "订单页每次打开都有返回地址");
  const intent = pay.intentOf(embedded.order.id);
  assert.ok(intent);
  pay.pay(intent.id);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
  assert.equal((await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()))).status, 200);
  const tenantToken = await tenantLogin(api, m.a.adminEmail);
  const tenantView = await api.call("GET", `/tenant/v1/orders/${embedded.order.id}`, { token: tenantToken });
  assert.equal(tenantView.status, 200, tenantView.text);
  assert.doesNotMatch(tenantView.text, /partner\.example|entry_source|embed|return_url/);
  // 推给供应商的 Webhook（真的投递到本机的假接收方）：推送内容里同样没有来源
  await api.app.webhookJobs.tick();
  const pushed = receiver.received.filter((item) => item.body.includes(embedded.order.id));
  assert.ok(pushed.length > 0, "付款后有推给供应商的 order.confirmed");
  for (const item of pushed) assert.doesNotMatch(item.body, /partner\.example|entry_source|embed_|return_url/);
});

test("/site/v1、/platform/v1、/tenant/v1 带白名单里的 Origin 也不带任何 CORS 头", async () => {
  await newKey();
  const tenantToken = await tenantLogin(api, m.a.adminEmail);
  for (const res of [
    await site.call("GET", "/site/v1/config", { headers: { origin: PARTNER }, ip: nextIp() }),
    await site.call("GET", "/site/v1/cities", { headers: { origin: PARTNER }, ip: nextIp() }),
    await api.call("GET", "/platform/v1/embed-keys", { token: m.root, headers: { origin: PARTNER } }),
    await api.call("GET", "/tenant/v1/orders", { token: tenantToken, headers: { origin: PARTNER } }),
    await api.call("GET", "/sales/v1/quotes/QT20261007ABCDEFGHIJ", { headers: { origin: PARTNER } }),
    await api.call("GET", "/driver/v1/trip", { headers: { origin: PARTNER } }),
  ]) {
    assert.deepEqual(corsHeaders(res.headers), []);
  }
});

const SESSION = "embed-session-0123456789";
/** 地址提示要官网开着（配了 SITE_CLIENT_ID 的那个应用） */
const onSite = (path: string, key: string, origin: string | null, ip = nextIp()) => site.call("GET", `${path}&key=${encodeURIComponent(key)}`, { ip, headers: origin === null ? {} : { origin } });
const autocomplete = (key: string, origin: string | null, ip: string) => onSite(`/embed/v1/places/autocomplete?q=${encodeURIComponent("东京")}&session=${SESSION}`, key, origin, ip);

test("/embed/v1/places：白名单才处理并带 CORS 头，不在白名单 403；详情同样", async () => {
  const key = await newKey();
  const okRes = await autocomplete(key.key, PARTNER, nextIp());
  assert.equal(okRes.status, 200, okRes.text);
  assertMatchesOpenApi("GET", "/embed/v1/places/autocomplete", okRes);
  assert.equal(okRes.headers["access-control-allow-origin"], PARTNER);
  assert.equal(okRes.headers["access-control-expose-headers"], "Retry-After");
  const denied = await autocomplete(key.key, OTHER, nextIp());
  assert.equal(denied.status, 403);
  assert.deepEqual(corsHeaders(denied.headers), []);
  assert.equal(denied.headers["cache-control"], "no-store");
  const details = await onSite(`/embed/v1/places/details?id=%3Cbad%3E&session=${SESSION}`, key.key, PARTNER);
  assert.equal(details.status, 400, "写法不对的地点编号 400，照样带 CORS 头");
  assert.equal(details.headers["access-control-allow-origin"], PARTNER);
  assert.equal((await onSite(`/embed/v1/places/details?id=%3Cbad%3E&session=${SESSION}`, key.key, OTHER)).status, 403);
});

test("/embed/v1/places 限速先按地址、再按嵌入码：一个地址被限以后继续刷，也不占这个嵌入码的额度，别的地址照常；每个嵌入码每分钟 600 次", async () => {
  const key = await newKey();
  const flooder = "10.95.0.1";
  const statuses: number[] = [];
  for (let i = 0; i < 601; i += 1) statuses.push((await autocomplete(key.key, PARTNER, flooder)).status);
  assert.equal(statuses.filter((status) => status === 200).length, 60, "同一个地址每分钟 60 次");
  assert.equal(statuses.at(-1), 429);
  assert.equal((await autocomplete(key.key, PARTNER, "10.95.9.9")).status, 200, "别的地址照常能用");
  api.clock.advance(61_000);

  const other = await newKey();
  for (let i = 0; i < 600; i += 1) assert.equal((await autocomplete(other.key, PARTNER, `10.96.${Math.floor(i / 200)}.${i % 200}`)).status, 200, `第 ${i + 1} 次`);
  const limited = await autocomplete(other.key, PARTNER, "10.96.9.9");
  assert.equal(limited.status, 429, "同一个嵌入码每分钟第 601 次");
  assert.equal(limited.headers["access-control-allow-origin"], PARTNER);
  api.clock.advance(61_000);
});

test("有效草稿到 4,000 个时写告警日志 embed.draft_limit_near，之后每多 250 个才再写一条", async () => {
  const key = await newKey();
  const now = api.clock.now();
  await api.db.owner.query(
    `insert into booking_drafts (id, content, embed_key_id, embed_origin, created_at, expires_at)
     select rpad(md5('near' || g::text), 43, 'y'), $1::jsonb, $2, $3, $4, $5 from generate_series(1, 3998) g`,
    [JSON.stringify(draft()), key.id, PARTNER, now, new Date(now.getTime() + 600_000)],
  );
  const count = () => (api.logs().match(new RegExp(`"event":"embed\\.draft_limit_near"[^\\n]*"embed_key_id":"${key.id}"`, "g")) ?? []).length;
  assert.equal((await embed("POST", "/embed/v1/booking-drafts", key.key, PARTNER, { draft: draft() })).status, 201);
  assert.equal(count(), 0, "第 3,999 个不写");
  assert.equal((await embed("POST", "/embed/v1/booking-drafts", key.key, PARTNER, { draft: draft() })).status, 201);
  assert.equal(count(), 1, "第 4,000 个写一条");
  assert.equal((await embed("POST", "/embed/v1/booking-drafts", key.key, PARTNER, { draft: draft() })).status, 201);
  assert.equal(count(), 1, "第 4,001 个不再写");
  api.clock.advance(61_000);
});

