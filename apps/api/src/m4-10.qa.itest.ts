/**
 * M4-10 测试角色：验收发现的小问题（M3、M4）里涉及接口的几条，经真实接口、真实 PostgreSQL；收款服务用替身。
 * - 包车的免费等待固定为 0（ADR 0043）：保存时别的值（15、不限时、负数、字符串、小数、给包车填接机 / 送机项）都被拒；
 *   库里留着旧值（15 分钟、不限时）时，官网询价、下单、供应商报价试算、运营报价试算、改期重新报价、取消试算都按 0，上架检查不拦、下架再上架照常；
 *   非包车品类（点对点）不受影响：照常可以设 30 分钟、不限时，少于 15 分钟仍是 BELOW_PLATFORM_MINIMUM。
 * - 未付款的单建工单：运营、渠道（/sales/v1）、官网（/site/v1）三个入口，对待付款、没付款就取消、已确认三种订单的结果一致；
 *   运营发起救援对没付款就取消的单也不说「订单不存在」。
 * - 审计日志「操作」筛选：逗号分隔多个动作（重复、前后空格、空项、超过 10 个），运营和供应商两边；供应商按动作筛也只看得到自己的。
 * 数据全部在测试里经接口建出来（个别「M4-10 之前存下的旧值」用数据库直接写入模拟），测试结束随临时数据库删除（规则 1）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TenantFixture, TestApi } from "./testing/api.ts";
import { createTestApi } from "./testing/api.ts";
import { type Market, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { platformLogin, tenantLogin } from "./testing/money.ts";
import { QUOTE_CATALOG_TTL_MS } from "./services/quote-catalog.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let flow: SalesFlow;
let site: SiteApi;
/** 乙的包车商品、甲的点对点商品 */
let charterId: string;
let p2pId: string;

const PICKUP = { lng: 139.7, lat: 35.6 };
const DROPOFF = { lng: 139.75, lat: 35.68 };
const SERVICE_LOCAL = "2026-11-20T10:00";
const PASSENGER = { name: "陈小红", phone: "+81 90-2222-3333", email: "qa.guest@example.com" };
const BOOKING = { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 };

let ipSeq = 0;
const nextIp = (): string => {
  ipSeq += 1;
  return `10.88.${Math.floor(ipSeq / 200)}.${(ipSeq % 200) + 10}`;
};
const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const ops = (): Promise<string> => platformLogin(api, m.staff.operations.email);

function tenantCall(token: string) {
  return (method: "POST" | "PUT" | "GET", path: string, body?: unknown, version?: number) =>
    api.call(method, `/tenant/v1${path}`, {
      token,
      ...(body === undefined ? {} : { body }),
      headers: { ...(version === undefined ? {} : { "if-match": `"${version}"` }), ...(method === "POST" && /^\/(products|brands|areas)$|\/price-rules$/.test(path) ? { "idempotency-key": randomUUID() } : {}) },
    });
}

/** 东京的点对点或包车商品（区域盖住整个东京，商务 7 座），上架。 */
async function categoryProduct(who: TenantFixture, category: "point_to_point" | "charter"): Promise<string> {
  const call = tenantCall(await tenantLogin(api, who.adminEmail));
  const brand = (await ok(call("POST", "/brands", { name: `${category}-qa-${who.tenantId.slice(0, 4)}`, currency: "JPY" }), 201)).id;
  api.clock.advance(1_000);
  const area = (await ok(call("POST", "/areas", { city_id: m.ids.tokyo, name: { zh: `东京-${category}-qa` }, biz_type: "general", polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [[[139.0, 35.0], [140.0, 35.0], [140.0, 36.0], [139.0, 36.0], [139.0, 35.0]]] } }] }), 201)).id;
  const created = await ok(call("POST", "/products", { brand_id: brand, city_id: m.ids.tokyo, category, areas: [{ area_id: area }], vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0312345678" }] }), 201);
  const general = category === "charter" ? { mode: "limited", minutes: 0 } : { mode: "limited", minutes: 30 };
  const rules = await ok(call("PUT", `/products/${created.id}/service-rules`, { booking: BOOKING, free_wait: { general } }, 1));
  const content = await ok(call("PUT", `/products/${created.id}/content`, { zh: { title: category === "charter" ? "东京包车" : "东京市内用车" } }, rules.version));
  const price = category === "charter" ? { package_hours: 8, pricing_model: "charter_package", package_km: 150, package_price: 70_000, overtime_per_hour: 5_000, over_km_per_km: 400 } : { pricing_model: "fixed", base_price: 15_000 };
  await ok(call("POST", `/products/${created.id}/price-rules`, { area_id: area, vehicle_group_id: m.ids.biz7, valid_from: "2026-01-01", ...price }, content.version), 201);
  await ok(call("POST", `/products/${created.id}/publish`));
  return created.id;
}

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  flow = await salesFlow(api, m, pay);
  charterId = await categoryProduct(m.b, "charter");
  p2pId = await categoryProduct(m.a, "point_to_point");
  const siteChannel = (await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" })).id;
  site = await siteApi(api, (await salesCredentials(api, m, siteChannel)).clientId, pay);
});
after(async () => {
  await site?.close();
  await api.close();
});

// ---- 包车的免费等待固定为 0 ----

async function productVersion(who: TenantFixture, id: string): Promise<number> {
  return (await ok(tenantCall(await tenantLogin(api, who.adminEmail))("GET", `/products/${id}`))).version;
}

async function saveRules(who: TenantFixture, id: string, freeWait: Record<string, unknown>): Promise<any> {
  const call = tenantCall(await tenantLogin(api, who.adminEmail));
  return call("PUT", `/products/${id}/service-rules`, { booking: BOOKING, free_wait: freeWait }, await productVersion(who, id));
}

/** 模拟 M4-10 之前存下的旧值：直接改库（迁移不改数据，ADR 0043），再让报价目录缓存过期。 */
async function storeLegacyFreeWait(id: string, value: unknown): Promise<void> {
  const updated = await api.db.owner.query<{ general: unknown }>(`update products set service_rules = jsonb_set(service_rules, '{freeWait,general}', $2::jsonb) where id = $1 returning service_rules -> 'freeWait' -> 'general' as general`, [id, JSON.stringify(value)]);
  assert.deepEqual(updated.rows[0]?.general, value, "库里确实是旧值");
  api.clock.advance(QUOTE_CATALOG_TTL_MS + 1_000);
}

async function siteQuote(body: Record<string, unknown>): Promise<any> {
  api.clock.advance(1_000);
  const res = await site.call("POST", "/site/v1/quotes", { body, ip: nextIp() });
  assert.equal(res.status, 200, res.text);
  return res.body;
}

const charterBody = () => ({ category: "charter", city_id: m.ids.tokyo, pickup: PICKUP, package_hours: 8, service_local: SERVICE_LOCAL, passengers: 3, luggage: 2 });
const p2pBody = () => ({ category: "point_to_point", city_id: m.ids.tokyo, pickup: PICKUP, dropoff: DROPOFF, service_local: SERVICE_LOCAL, passengers: 2, luggage: 1 });

/** 官网下一张单；`paid` 时按 Stripe 通知付款成功（自动确认）。返回订单编号和查看链接的令牌。 */
async function siteOrder(quoteId: string, extra: Record<string, unknown>, paid: boolean): Promise<{ id: string; link: string; order: any }> {
  api.clock.advance(1_000);
  const placed = await site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": randomUUID() }, body: { quote_id: quoteId, passenger: PASSENGER, save_payment_method: true, ...extra }, ip: nextIp() });
  assert.equal(placed.status, 201, placed.text);
  if (paid) {
    const intent = pay.intentOf(placed.body.order.id);
    assert.ok(intent);
    pay.pay(intent.id);
    const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
    assert.equal((await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()))).status, 200);
  }
  return { id: placed.body.order.id, link: placed.body.link.token, order: placed.body.order };
}

test("包车免等：保存 0 以外的值一律 400（15 分钟、不限时、负数、小数、1 分钟都是 FIXED_BY_PLATFORM；字符串是类型错误；给包车填接机 / 送机项是 NOT_APPLICABLE）；被拒后库里不变；存 0 照常", async () => {
  const before = (await api.db.owner.query<{ rules: unknown }>("select service_rules as rules from products where id = $1", [charterId])).rows[0]?.rules;
  const cases: [string, Record<string, unknown>, string | null][] = [
    ["15 分钟", { general: { mode: "limited", minutes: 15 } }, "FIXED_BY_PLATFORM"],
    ["1 分钟", { general: { mode: "limited", minutes: 1 } }, "FIXED_BY_PLATFORM"],
    ["不限时", { general: { mode: "unlimited" } }, "FIXED_BY_PLATFORM"],
    ["负数", { general: { mode: "limited", minutes: -5 } }, null],
    ["小数", { general: { mode: "limited", minutes: 0.5 } }, null],
    ["字符串的 0", { general: { mode: "limited", minutes: "0" } }, null],
    ["字符串的 15", { general: { mode: "limited", minutes: "15" } }, null],
    ["接机项", { general: { mode: "limited", minutes: 0 }, pickup: { mode: "limited", minutes: 90 } }, "NOT_APPLICABLE"],
  ];
  for (const [name, freeWait, reason] of cases) {
    const res = await saveRules(m.b, charterId, freeWait);
    assert.equal(res.status, 400, `${name}：${res.text}`);
    assert.equal(res.body.error.code, "VALIDATION_FAILED", name);
    if (reason !== null) assert.ok(res.body.error.details.issues.some((issue: any) => issue.reason === reason), `${name}：${res.text}`);
    if (reason === "FIXED_BY_PLATFORM") {
      const issue = res.body.error.details.issues.find((entry: any) => entry.reason === "FIXED_BY_PLATFORM");
      assert.match(issue.message, /0 分钟/, name);
    }
  }
  const after = (await api.db.owner.query<{ rules: unknown }>("select service_rules as rules from products where id = $1", [charterId])).rows[0]?.rules;
  assert.deepEqual(after, before, "被拒的保存不改库里的服务规则");
  const saved = await saveRules(m.b, charterId, { general: { mode: "limited", minutes: 0 } });
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(saved.body.rules.free_wait.general, { mode: "limited", minutes: 0 });
  assert.equal(saved.body.free_wait_minimums.general, 0);
});

test("包车免等：库里留着旧的 15 分钟——供应商报价试算、运营报价试算、官网询价、下单都是 0；供应商打开服务规则仍看到存下的 15（数据不改）；上架检查不拦，下架再上架照常；存一次 0 后库里变成 0", async () => {
  await storeLegacyFreeWait(charterId, { mode: "limited", minutes: 15 });
  const token = await tenantLogin(api, m.b.adminEmail);
  const call = tenantCall(token);

  const tenantPreview = await ok(call("POST", `/products/${charterId}/quote-preview`, { pickup: PICKUP, package_hours: 8, service_time: SERVICE_LOCAL, passengers: 3, luggage: 2 }));
  assert.equal(tenantPreview.refusal, null, JSON.stringify(tenantPreview));
  assert.ok(tenantPreview.offers.length > 0);
  for (const offer of tenantPreview.offers) assert.deepEqual([offer.settlement.free_wait.mode, offer.settlement.free_wait.minutes], ["limited", 0], "供应商报价试算按 0");

  const platformPreview = await ok(api.call("POST", "/platform/v1/quotes/preview", { token: m.root, body: { city_id: m.ids.tokyo, category: "charter", pickup: PICKUP, package_hours: 8, service_time: SERVICE_LOCAL, passengers: 3, luggage: 2, currency: "JPY" } }));
  const offers = platformPreview.groups.flatMap((group: any) => group.candidates.map((candidate: any) => candidate.offer));
  assert.ok(offers.length > 0, JSON.stringify(platformPreview));
  for (const offer of offers) assert.equal(offer.settlement.free_wait.minutes, 0, "运营报价试算按 0");

  const quoted = await siteQuote(charterBody());
  assert.equal(quoted.quotes[0].free_wait_minutes, 0, "官网询价按 0");
  const placed = await siteOrder(quoted.quotes[0].quote_id, { pickup_address: "东京站大饭店" }, false);
  assert.equal(placed.order.free_wait_minutes, 0, "下单的快照是 0");
  const stored = (await api.db.owner.query<{ minutes: number | null; settlement: any }>("select free_wait_minutes as minutes, settlement from orders where id = $1", [placed.id])).rows[0];
  assert.equal(stored?.minutes, 0);
  assert.deepEqual(stored?.settlement.freeWait.value, { mode: "limited", minutes: 0 }, "结算明细里也是 0");

  const rules = await ok(call("GET", `/products/${charterId}/service-rules`));
  assert.deepEqual(rules.rules.free_wait.general, { mode: "limited", minutes: 15 }, "存下的旧值不改（供应商后台据此提示）");

  const check = await ok(call("GET", `/products/${charterId}/publish-check`));
  assert.equal(JSON.stringify(check).includes("FIXED_BY_PLATFORM"), false, `上架检查不因旧值拦：${JSON.stringify(check)}`);
  await ok(call("POST", `/products/${charterId}/unpublish`));
  const republished = await call("POST", `/products/${charterId}/publish`);
  assert.equal(republished.status, 200, `存着旧值的包车下架后能再上架：${republished.text}`);

  const saved = await saveRules(m.b, charterId, { general: { mode: "limited", minutes: 0 } });
  assert.equal(saved.status, 200, saved.text);
  const now = (await api.db.owner.query<{ general: unknown }>("select service_rules -> 'freeWait' -> 'general' as general from products where id = $1", [charterId])).rows[0]?.general;
  assert.deepEqual(now, { mode: "limited", minutes: 0 });
});

test("包车免等：库里留着旧的「不限时」——询价、下单按 0（不是 null 的不限时）；付款后改期重新报价，结算明细里的免等仍是 0；取消试算照常", async () => {
  await storeLegacyFreeWait(charterId, { mode: "unlimited" });
  const quoted = await siteQuote(charterBody());
  assert.equal(quoted.quotes[0].free_wait_minutes, 0, "不限时的旧值也按 0，不显示「不限时」");
  const placed = await siteOrder(quoted.quotes[0].quote_id, { pickup_address: "东京站大饭店" }, true);
  const view = await site.call("GET", "/site/v1/order", { token: placed.link, ip: nextIp() });
  assert.equal(view.status, 200, view.text);
  assert.equal(view.body.order.status, "confirmed");
  assert.equal(view.body.order.free_wait_minutes, 0);

  api.clock.advance(QUOTE_CATALOG_TTL_MS + 1_000);
  const changed = await site.call("PATCH", "/site/v1/order", { token: placed.link, ip: nextIp(), headers: { "if-match": `"${view.body.order.version}"` }, body: { service_time: "2026-11-20T03:00:00Z" } });
  assert.equal(changed.status, 200, changed.text);
  const after = (await api.db.owner.query<{ minutes: number | null; settlement: any; service_local: string }>("select free_wait_minutes as minutes, settlement, service_local from orders where id = $1", [placed.id])).rows[0];
  assert.equal(after?.service_local, "2026-11-20T12:00", "改期生效");
  assert.equal(after?.minutes, 0);
  assert.deepEqual(after?.settlement.freeWait.value, { mode: "limited", minutes: 0 }, "改期重新报价时也按 0");

  const fee = await site.call("GET", "/site/v1/order/cancel-fee", { token: placed.link, ip: nextIp() });
  assert.equal(fee.status, 200, fee.text);
  await saveRules(m.b, charterId, { general: { mode: "limited", minutes: 0 } });
});

test("非包车不受影响：点对点照常可以设 30 分钟、不限时，询价按设的值；少于平台最少的 15 分钟仍是 BELOW_PLATFORM_MINIMUM（不是 FIXED_BY_PLATFORM）", async () => {
  api.clock.advance(QUOTE_CATALOG_TTL_MS + 1_000);
  assert.equal((await siteQuote(p2pBody())).quotes[0].free_wait_minutes, 30);
  const unlimited = await saveRules(m.a, p2pId, { general: { mode: "unlimited" } });
  assert.equal(unlimited.status, 200, unlimited.text);
  api.clock.advance(QUOTE_CATALOG_TTL_MS + 1_000);
  assert.equal((await siteQuote(p2pBody())).quotes[0].free_wait_minutes, null, "点对点不限时照旧");
  const short = await saveRules(m.a, p2pId, { general: { mode: "limited", minutes: 10 } });
  assert.equal(short.status, 400, short.text);
  assert.deepEqual(short.body.error.details.issues.map((issue: any) => issue.reason), ["BELOW_PLATFORM_MINIMUM"]);
  const back = await saveRules(m.a, p2pId, { general: { mode: "limited", minutes: 30 } });
  assert.equal(back.status, 200, back.text);
});

// ---- 未付款的单建工单：三个入口一致 ----

const TICKET = { type: "other", subject: "客人来电", description: "问付款方式" };

/** 同一张单经三个入口建工单的结果：[状态码, 错误码, details.reason]。 */
type Outcome = [number, string | null, string | null];
const outcome = (res: { status: number; body: any }): Outcome => [res.status, res.body?.error?.code ?? null, res.body?.error?.details?.reason ?? null];

async function viaPlatform(orderId: string): Promise<Outcome> {
  return outcome(await api.call("POST", "/platform/v1/tickets", { token: await ops(), body: { ...TICKET, order_id: orderId } }));
}
async function viaChannel(orderId: string): Promise<Outcome> {
  return outcome(await api.call("POST", `/sales/v1/orders/${orderId}/tickets`, { token: await flow.token(), body: TICKET }));
}
async function viaSite(link: string): Promise<Outcome> {
  return outcome(await site.call("POST", "/site/v1/order/tickets", { token: link, ip: nextIp(), body: TICKET }));
}

const NOT_CONFIRMED: Outcome = [409, "ORDER_STATE_INVALID", "NOT_CONFIRMED"];

test("未付款的单建工单：运营入口——待付款、没付款就取消都是 409 NOT_CONFIRMED（各有说法），已确认的 201", async () => {
  const unpaid = await flow.unpaidOrder({ serviceTime: iso(api.clock.now().getTime() + 6 * DAY) });
  assert.deepEqual(await viaPlatform(unpaid.id), NOT_CONFIRMED);
  await ok(api.call("POST", `/sales/v1/orders/${unpaid.id}/cancel`, { token: await flow.token(), body: {} }));
  assert.deepEqual(await viaPlatform(unpaid.id), NOT_CONFIRMED);
  const paid = await flow.paidOrder({ serviceTime: iso(api.clock.now().getTime() + 6 * DAY) });
  assert.deepEqual((await viaPlatform(paid.id))[0], 201);
});

test("未付款的单建工单：渠道入口（/sales/v1）和运营一致——自己渠道的待付款、没付款就取消的单说明还没付款（409 NOT_CONFIRMED），不说「订单不存在」；已确认的 201；别的渠道的单仍是 404", async () => {
  const unpaid = await flow.unpaidOrder({ serviceTime: iso(api.clock.now().getTime() + 6 * DAY) });
  // 渠道自己看得到这张单，却被告知「订单不存在」，说法不准确（与运营入口不一致）
  assert.equal((await api.call("GET", `/sales/v1/orders/${unpaid.id}`, { token: await flow.token() })).status, 200, "渠道看得到自己的待付款单");
  assert.deepEqual(await viaChannel(unpaid.id), NOT_CONFIRMED, "渠道：待付款");
  await ok(api.call("POST", `/sales/v1/orders/${unpaid.id}/cancel`, { token: await flow.token(), body: {} }));
  assert.deepEqual(await viaChannel(unpaid.id), NOT_CONFIRMED, "渠道：没付款就取消");
  const paid = await flow.paidOrder({ serviceTime: iso(api.clock.now().getTime() + 6 * DAY) });
  assert.equal((await viaChannel(paid.id))[0], 201);
  const other = await salesFlow(api, m, pay);
  const foreign = await other.unpaidOrder({ serviceTime: iso(api.clock.now().getTime() + 6 * DAY) });
  assert.equal((await viaChannel(foreign.id))[0], 404, "别的渠道的单仍是 404（不泄露存在）");
});

test("未付款的单建工单：官网入口（/site/v1）和运营一致——客人自己的待付款、没付款就取消的单说明还没付款（409 NOT_CONFIRMED），不说「订单不存在」；已确认的 201", async () => {
  api.clock.advance(QUOTE_CATALOG_TTL_MS + 1_000);
  const quoted = await siteQuote(p2pBody());
  const unpaid = await siteOrder(quoted.quotes[0].quote_id, { pickup_address: "东京站", dropoff_address: "新宿" }, false);
  assert.deepEqual(await viaSite(unpaid.link), NOT_CONFIRMED, "官网：待付款");
  await ok(site.call("POST", "/site/v1/order/cancel", { token: unpaid.link, ip: nextIp(), body: {} }));
  assert.deepEqual(await viaSite(unpaid.link), NOT_CONFIRMED, "官网：没付款就取消");
  const again = await siteQuote(p2pBody());
  const paid = await siteOrder(again.quotes[0].quote_id, { pickup_address: "东京站", dropoff_address: "新宿" }, true);
  assert.equal((await viaSite(paid.link))[0], 201);
});

test("运营发起救援：没付款就取消的单也不说「订单不存在」（409 ORDER_STATE_INVALID，说明状态），也不建救援", async () => {
  const unpaid = await flow.unpaidOrder({ serviceTime: iso(api.clock.now().getTime() + 6 * DAY) });
  await ok(api.call("POST", `/sales/v1/orders/${unpaid.id}/cancel`, { token: await flow.token(), body: {} }));
  const refused = await api.call("POST", `/platform/v1/orders/${unpaid.id}/rescue`, { token: await ops(), body: { trigger: "driver_no_show", note: "测试" } });
  assert.equal(refused.status, 409, refused.text);
  assert.equal(refused.body.error.code, "ORDER_STATE_INVALID");
  assert.equal(refused.body.error.details.status, "cancelled");
  assert.equal((await api.db.owner.query("select 1 from order_rescues where order_id = $1", [unpaid.id])).rowCount, 0);
});

// ---- 审计日志「操作」筛选 ----

async function platformLogs(query: string): Promise<{ status: number; ids: string[]; actions: string[]; tenants: (string | null)[] }> {
  const res = await api.call("GET", `/platform/v1/audit-logs?limit=200&${query}`, { token: m.root });
  return { status: res.status, ids: res.status === 200 ? res.body.items.map((log: any) => log.id) : [], actions: res.status === 200 ? res.body.items.map((log: any) => log.action) : [], tenants: res.status === 200 ? res.body.items.map((log: any) => log.tenant_id) : [] };
}
async function tenantLogs(who: TenantFixture, query: string): Promise<{ status: number; ids: string[]; actions: string[]; tenants: (string | null)[] }> {
  const res = await api.call("GET", `/tenant/v1/audit-logs?limit=200&${query}`, { token: await tenantLogin(api, who.adminEmail) });
  return { status: res.status, ids: res.status === 200 ? res.body.items.map((log: any) => log.id) : [], actions: res.status === 200 ? res.body.items.map((log: any) => log.action) : [], tenants: res.status === 200 ? res.body.items.map((log: any) => log.tenant_id) : [] };
}

test("审计「操作」筛选（运营、供应商两边）：逗号分隔的几个动作 = 各查一次的并集；重复、前后空格不影响；空项、只有逗号、超过 10 个、单个超过 50 字 400；供应商按动作筛只看得到自己的", async () => {
  // 两家各下架、上架一次自己的商品，留下 publish / unpublish 的记录
  for (const [who, id] of [[m.b, charterId], [m.a, p2pId]] as const) {
    const call = tenantCall(await tenantLogin(api, who.adminEmail));
    await ok(call("POST", `/products/${id}/unpublish`));
    await ok(call("POST", `/products/${id}/publish`));
  }
  for (const [side, list] of [["运营", platformLogs], ["供应商乙", (query: string) => tenantLogs(m.b, query)]] as const) {
    const publish = await list("action=publish");
    const unpublish = await list("action=unpublish");
    assert.ok(publish.ids.length > 0 && unpublish.ids.length > 0, side);
    const union = [...publish.ids, ...unpublish.ids].sort();
    for (const query of ["action=publish,unpublish", "action=unpublish,publish", "action=publish,unpublish,publish", `action=${encodeURIComponent(" publish , unpublish ")}`, "action=publish,unpublish,no_such_action"]) {
      const both = await list(query);
      assert.equal(both.status, 200, `${side} ${query}`);
      assert.deepEqual([...both.ids].sort(), union, `${side} ${query}`);
    }
    assert.deepEqual(new Set((await list("action=publish,unpublish")).actions), new Set(["publish", "unpublish"]), side);
    const ten = await list(`action=${["publish", "unpublish", "a", "b", "c", "d", "e", "f", "g", "h"].join(",")}`);
    assert.equal(ten.status, 200, `${side}：正好 10 个可以`);
    for (const query of ["action=", "action=,", "action=publish,", "action=,publish", "action=publish,,unpublish", `action=${encodeURIComponent("publish, ,unpublish")}`, `action=${Array.from({ length: 11 }, () => "publish").join(",")}`, `action=publish,${"a".repeat(51)}`, "action=publish&action=unpublish"]) {
      assert.equal((await list(query)).status, 400, `${side} ${query}`);
    }
  }
  const mine = await tenantLogs(m.b, "action=publish,unpublish");
  const everyone = await platformLogs("action=publish,unpublish");
  assert.ok(everyone.tenants.includes(m.a.tenantId) && everyone.tenants.includes(m.b.tenantId), "运营看得到两家的");
  const ofB = everyone.ids.filter((_, index) => everyone.tenants[index] === m.b.tenantId).sort();
  assert.deepEqual([...mine.ids].sort(), ofB, "供应商乙按动作筛只看得到自己的（甲的一条都没有）");
});
