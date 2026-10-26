/**
 * M3-05 测试角色补充：官网公开接口 `/site/v1`（ADR 0032）的安全边界与客人流程。经真实接口、真实 PostgreSQL，收款服务用替身。
 * - 查看令牌：只存哈希、不进日志；A 单的令牌碰不到 B 单；有效期边界（用车后 30 天、找回的最少 1 天）；改期后仍是「用车后 30 天」；
 * - 找回：不存在 / 对不上 / 别的渠道的单，应答完全相同（状态码、正文、响应头、粗测耗时）；两层限速的边界、失败也计数、订单号写法不同也算同一个；
 *   联系方式的规范化（大小写、首尾空白、全角空格、电话的空格括号连字符点；全角数字和全角字母）；
 * - 不认未知字段（询价、下单、找回、改单、取消、试算、异议）；所有应答（含错误）不含供应商编号、结算价、加价比例、渠道内部信息；
 * - 限速按来源地址：TRUST_PROXY_HOPS=0 时 X-Forwarded-For 不算数，=1 时伪造最左边的地址也绕不过；
 * - 客户端吊销 / 换新客户端：新单被拒，已有订单照常能看、取消试算、改单、取消、我已落地；
 * - 下单幂等（并发重复提交只成一单；同一个键换内容被拒）；Stripe 没配置时到付款期限的前一刻不取消、到点取消并释放库存；
 * - 取消先试算：试算的扣款、退款与真正取消的结果一致（扣一半那一档）；「我已落地」只对接机单；异议期 48 小时的边界。
 * 测试数据全在本文件里经接口建出来，随测试 schema 一起删除；每个测试用自己的来源地址和自己的订单，不依赖执行顺序。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@nozomi/config";
import { buildApp } from "./app.ts";
import { loadMigrationFiles } from "./db/migrate.ts";
import type { PaymentProvider } from "./integrations/payments.ts";
import { type ApiResponse, type HttpMethod, type TestApi, createTestApi } from "./testing/api.ts";
import { testEnv } from "./testing/fixtures.ts";
import { type Market, allKeys, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { completeOrder, platformLogin, tenantLogin } from "./testing/money.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ADDRESS = { lng: 139.7, lat: 35.6 };
const PASSENGER = { name: "李四", phone: "+81 90-8765-4321", email: "Qa.Guest@Example.com" };

interface Site {
  app: FastifyInstance;
  logs(): string;
  call(method: HttpMethod, url: string, options?: { token?: string; body?: unknown; ip?: string; headers?: Record<string, string> }): Promise<ApiResponse>;
  close(): Promise<void>;
}

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let siteChannelId: string;
let siteClient: { clientId: string; id: string };
let site: Site;
let other: SalesFlow;
let ipSeq = 0;

/** 每次一个新的来源地址：各测试的限速额度互不影响。 */
const nextIp = (): string => {
  ipSeq += 1;
  return `10.${Math.floor(ipSeq / 250) + 50}.${ipSeq % 250}.7`;
};

/** 在测试库上另起一个官网应用：可以带日志、TRUST_PROXY_HOPS、不同的 SITE_CLIENT_ID 和收款服务。 */
async function makeSite(options: { clientId: string | null; payments: PaymentProvider | null; env?: Record<string, string> }): Promise<Site> {
  let logs = "";
  const app = buildApp({
    config: loadConfig({ ...testEnv(api.db.url), ...(options.clientId === null ? {} : { SITE_CLIENT_ID: options.clientId }), ...options.env }),
    pool: api.db.pool,
    migrationFiles: await loadMigrationFiles(),
    now: api.clock.now,
    payments: options.payments,
    logDestination: { write: (line: string) => void (logs += line) },
  });
  return {
    app,
    logs: () => logs,
    async call(method, url, call = {}) {
      const res = await app.inject({
        method,
        url,
        headers: { ...call.headers, ...(call.token === undefined ? {} : { authorization: `Bearer ${call.token}` }) },
        ...(call.body === undefined ? {} : { payload: call.body as object }),
        remoteAddress: call.ip ?? "203.0.113.200",
      });
      let body: unknown = null;
      try {
        body = res.body === "" ? null : res.json();
      } catch {
        body = null;
      }
      return { status: res.statusCode, headers: res.headers, text: res.body, body };
    },
    close: () => app.close(),
  };
}

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  siteChannelId = (await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网 QA" })).id;
  siteClient = await salesCredentials(api, m, siteChannelId);
  site = await makeSite({ clientId: siteClient.clientId, payments: pay });
  other = await salesFlow(api, m, pay);
});
after(async () => {
  await site?.close();
  await api.close();
});

/** 东京（UTC+9，无夏令时）当地的 `YYYY-MM-DDTHH:mm`。 */
const tokyoLocal = (at: Date): string => new Date(at.getTime() + 9 * HOUR).toISOString().slice(0, 16);

/** 从现在起 `days` 天后、取整到分钟的用车时刻（离用车足够远，过得了 24 小时的提前预订）。 */
const serviceIn = (days: number): Date => new Date(Math.floor((api.clock.now().getTime() + days * DAY) / 60_000) * 60_000);

const quoteBody = (serviceAt: Date, extra: Record<string, unknown> = {}) => ({ city_id: m.ids.tokyo, airport_id: m.ids.narita, direction: "pickup", address: ADDRESS, service_local: tokyoLocal(serviceAt), passengers: 2, luggage: 1, ...extra });

async function quoteOn(on: Site, ip: string, serviceAt: Date, direction: "pickup" | "dropoff" = "pickup"): Promise<any> {
  api.clock.advance(1_000);
  const res = await on.call("POST", "/site/v1/quotes", { ip, body: quoteBody(serviceAt, { direction }) });
  assert.equal(res.status, 200, res.text);
  const quote = res.body.quotes.find((q: any) => q.vehicle_group.id === m.ids.biz7);
  assert.ok(quote, res.text);
  return quote;
}

function orderBody(quoteId: string, direction: "pickup" | "dropoff", passenger = PASSENGER): Record<string, unknown> {
  return direction === "pickup"
    ? { quote_id: quoteId, passenger, flight_no: "NH211", dropoff_address: "新宿站南口", save_payment_method: true }
    : { quote_id: quoteId, passenger, pickup_address: "新宿站南口", save_payment_method: true };
}

/** 官网下一张单（商务 7 座，乙 19,800 中标，对外价 21,780）。 */
async function place(options: { on?: Site; ip?: string; days?: number; direction?: "pickup" | "dropoff"; passenger?: typeof PASSENGER } = {}): Promise<{ body: any; serviceAt: Date; ip: string; res: ApiResponse }> {
  const on = options.on ?? site;
  const ip = options.ip ?? nextIp();
  const serviceAt = serviceIn(options.days ?? 10);
  const direction = options.direction ?? "pickup";
  const quote = await quoteOn(on, ip, serviceAt, direction);
  api.clock.advance(1_000);
  const res = await on.call("POST", "/site/v1/orders", { ip, headers: { "idempotency-key": randomUUID() }, body: orderBody(quote.quote_id, direction, options.passenger) });
  assert.equal(res.status, 201, res.text);
  return { body: res.body, serviceAt, ip, res };
}

async function payFor(orderId: string): Promise<void> {
  const intent = pay.intentOf(orderId);
  assert.ok(intent, "下单时建了付款");
  pay.pay(intent.id);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
  const res = await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()));
  assert.equal(res.status, 200, JSON.stringify(res.body));
}

/** 把测试时钟拨到某个时刻（只能往后拨）。 */
function moveTo(at: Date): void {
  const delta = at.getTime() - api.clock.now().getTime();
  assert.ok(delta >= 0, `时钟只能往后拨：现在 ${api.clock.now().toISOString()}，要去 ${at.toISOString()}`);
  api.clock.advance(delta);
}

const lookup = (body: unknown, ip: string, on: Site = site) => on.call("POST", "/site/v1/orders/lookup", { ip, body });

/** 两个应答除了 date、request-id 之类每次都不同的响应头以外完全一样。 */
function stableHeaders(res: ApiResponse): Record<string, unknown> {
  const { date: _date, "x-request-id": _rid, ...rest } = res.headers as Record<string, unknown>;
  return rest;
}

// ---- 查看令牌 ----

test("查看令牌：库里只存哈希，令牌和联系方式不进日志；A 单的令牌只看、只取消 A 单，B 单不受影响", async () => {
  const logged = await makeSite({ clientId: siteClient.clientId, payments: pay });
  try {
    const a = await place({ on: logged });
    const b = await place({ on: logged });
    const ta = a.body.link.token as string;
    const tb = b.body.link.token as string;
    assert.match(ta, /^nzo_[A-Za-z0-9_-]{43}$/);
    const rows = await api.db.owner.query<{ order_id: string; token_hash: string }>("select order_id, token_hash from site_order_links where order_id = any($1::uuid[])", [[a.body.order.id, b.body.order.id]]);
    assert.deepEqual(new Set(rows.rows.map((row) => row.token_hash)), new Set([ta, tb].map((t) => createHash("sha256").update(t).digest("hex"))));
    assert.ok(!JSON.stringify(rows.rows).includes(ta) && !JSON.stringify(rows.rows).includes(tb), "原文不进库");

    const seenA = await logged.call("GET", "/site/v1/order", { token: ta, ip: a.ip });
    assert.equal(seenA.body.order.id, a.body.order.id);
    assert.ok(!seenA.text.includes(b.body.order.id) && !seenA.text.includes(b.body.order.order_no), "A 的应答里没有 B");
    const cancelA = await logged.call("POST", "/site/v1/order/cancel", { token: ta, ip: a.ip, body: {} });
    assert.equal(cancelA.body.order.id, a.body.order.id);
    assert.equal(cancelA.body.order.status, "cancelled");
    const seenB = await logged.call("GET", "/site/v1/order", { token: tb, ip: b.ip });
    assert.deepEqual([seenB.body.order.id, seenB.body.order.status], [b.body.order.id, "pending_payment"], "用 A 的令牌取消不会碰到 B");
    await lookup({ order_no: b.body.order.order_no, contact: PASSENGER.email }, b.ip, logged);

    const logs = logged.logs();
    assert.ok(logs.length > 0, "日志确实在记");
    for (const secret of [ta, tb, ta.slice(4), PASSENGER.email, PASSENGER.email.toLowerCase(), "8765-4321"]) assert.ok(!logs.includes(secret), `日志里出现了 ${secret.slice(0, 12)}…`);
  } finally {
    await logged.close();
  }
});

test("查看链接的有效期：用车后 30 天的前 1 毫秒还能用、到点 401；过期后找回发的新链接至少能用 1 天，到点同样 401", async () => {
  const placed = await place({ days: 5 });
  const token = placed.body.link.token as string;
  const expiresAt = new Date(placed.body.link.expires_at as string);
  assert.equal(expiresAt.getTime(), placed.serviceAt.getTime() + 30 * DAY, "用车后 30 天");
  moveTo(new Date(expiresAt.getTime() - 1));
  assert.equal((await site.call("GET", "/site/v1/order", { token, ip: placed.ip })).status, 200, "到期前 1 毫秒");
  api.clock.advance(1);
  const expired = await site.call("GET", "/site/v1/order", { token, ip: placed.ip });
  assert.deepEqual([expired.status, expired.body.error.code], [401, "ORDER_LINK_INVALID"], "到点即失效");
  for (const url of ["/site/v1/order/cancel-fee", "/site/v1/order/payment"]) assert.equal((await site.call("GET", url, { token, ip: placed.ip })).status, 401, url);
  assert.equal((await site.call("POST", "/site/v1/order/landed", { token, ip: placed.ip })).status, 401);

  const found = await lookup({ order_no: placed.body.order.order_no, contact: PASSENGER.phone }, placed.ip);
  assert.equal(found.status, 200, found.text);
  const renewed = new Date(found.body.link.expires_at as string);
  assert.equal(renewed.getTime(), api.clock.now().getTime() + DAY, "用车早已过去：从现在起 1 天");
  moveTo(new Date(renewed.getTime() - 1));
  assert.equal((await site.call("GET", "/site/v1/order", { token: found.body.link.token, ip: placed.ip })).status, 200);
  api.clock.advance(1);
  assert.equal((await site.call("GET", "/site/v1/order", { token: found.body.link.token, ip: placed.ip })).status, 401);
});

test("改期把用车时间往后推了以后，下单时发的链接跟着新的用车时间走：旧用车时间 + 30 天之后、新用车时间之前仍能用，新用车时间 + 30 天到点失效", async () => {
  const placed = await place({ days: 5 });
  const token = placed.body.link.token as string;
  await payFor(placed.body.order.id);
  const seen = await site.call("GET", "/site/v1/order", { token, ip: placed.ip });
  const later = new Date(placed.serviceAt.getTime() + 40 * DAY);
  const changed = await site.call("PATCH", "/site/v1/order", { token, ip: placed.ip, headers: { "if-match": `"${seen.body.order.version}"` }, body: { service_time: later.toISOString() } });
  assert.equal(changed.status, 200, changed.text);
  assert.equal(changed.body.change.status, "applied", changed.text);
  assert.equal(changed.body.order.service_time, later.toISOString());
  // 旧用车时间 + 30 天之后、新用车时间之前：行程还没开始，客人的链接应当还能用（ADR 0032：有效期 = 用车时间后 30 天）
  moveTo(new Date(placed.serviceAt.getTime() + 31 * DAY));
  const res = await site.call("GET", "/site/v1/order", { token, ip: placed.ip });
  assert.equal(res.status, 200, `用车时间改到 ${later.toISOString()}，现在 ${api.clock.now().toISOString()} 行程还没开始，链接却已失效：${res.text}`);
  moveTo(new Date(later.getTime() + 30 * DAY - 1_000));
  assert.equal((await site.call("GET", "/site/v1/order", { token, ip: placed.ip })).status, 200, "新用车时间 + 30 天之前 1 秒还能用");
  moveTo(new Date(later.getTime() + 30 * DAY));
  const expired = await site.call("GET", "/site/v1/order", { token, ip: placed.ip });
  assert.deepEqual([expired.status, expired.body.error.code], [401, "ORDER_LINK_INVALID"], "新用车时间 + 30 天到点失效");
});

// ---- 找回 ----

test("找回：订单号不存在、联系方式对不上、别的渠道的单，状态码、正文、响应头完全一样，粗测耗时也分不出来", async () => {
  const placed = await place();
  const foreign = await other.unpaidOrder({ serviceTime: serviceIn(10).toISOString() });
  const cases = {
    missing: { order_no: "NZ20261007QQQQQQQQ", contact: PASSENGER.email },
    mismatch: { order_no: placed.body.order.order_no, contact: "nobody@example.com" },
    mismatchPhone: { order_no: placed.body.order.order_no, contact: "+81 90-0000-0000" },
    foreign: { order_no: foreign.order_no, contact: "guest@example.com" },
  };
  const first: Record<string, ApiResponse> = {};
  for (const [name, body] of Object.entries(cases)) first[name] = await lookup(body, nextIp());
  const reference = first["missing"]!;
  assert.equal(reference.status, 404);
  assert.equal(reference.body.error.code, "ORDER_NOT_FOUND");
  for (const [name, res] of Object.entries(first)) {
    assert.equal(res.status, reference.status, name);
    assert.equal(res.text, reference.text, `${name} 的正文和不存在的不一样`);
    assert.deepEqual(stableHeaders(res), stableHeaders(reference), `${name} 的响应头和不存在的不一样`);
  }

  // 粗测时间差：交替各量 8 次取中位数（不同地址，避免限速；订单号的额度每小时 10 次，这里各 8 次）
  const timings: Record<"missing" | "mismatch", number[]> = { missing: [], mismatch: [] };
  for (let i = 0; i < 8; i += 1) {
    for (const name of ["missing", "mismatch"] as const) {
      const body = name === "missing" ? { order_no: `NZ20261007TIME${String.fromCharCode(65 + i)}QQQ`, contact: PASSENGER.email } : { order_no: placed.body.order.order_no, contact: `nobody${i}@example.com` };
      const started = process.hrtime.bigint();
      const res = await lookup(body, nextIp());
      timings[name].push(Number(process.hrtime.bigint() - started) / 1e6);
      assert.equal(res.status, 404, res.text);
    }
  }
  const median = (values: number[]): number => [...values].sort((x, y) => x - y)[Math.floor(values.length / 2)]!;
  const diff = Math.abs(median(timings.missing) - median(timings.mismatch));
  assert.ok(diff < 30, `中位数差 ${diff.toFixed(1)} 毫秒（不存在 ${median(timings.missing).toFixed(1)}，对不上 ${median(timings.mismatch).toFixed(1)}）`);
});

test("找回的规范化：订单号大小写和首尾空白、邮箱大小写和首尾空白（含全角空格、制表符）、电话的空格括号连字符点都认；号码不全、本地写法、邮箱的一部分都不认", async () => {
  const placed = await place();
  const no = placed.body.order.order_no as string;
  const accepted = [
    { order_no: ` ${no.toLowerCase()} `, contact: "qa.guest@example.com" },
    { order_no: no, contact: "\t QA.GUEST@EXAMPLE.COM \n" },
    { order_no: no, contact: "　Qa.Guest@Example.com　" },
    { order_no: no, contact: "+819087654321" },
    { order_no: no, contact: "+81 (90) 8765 4321" },
    { order_no: no, contact: "+81.90.8765.4321" },
    { order_no: no, contact: " +81-90-8765-4321 " },
  ];
  for (const body of accepted) {
    const res = await lookup(body, nextIp());
    assert.equal(res.status, 200, `${JSON.stringify(body)}：${res.text}`);
  }
  // 订单号每小时只能试 10 次：过一小时再试认不了的写法
  api.clock.advance(HOUR);
  const refused = [
    { order_no: no, contact: "09087654321" },
    { order_no: no, contact: "+8190876543" },
    { order_no: no, contact: "8765-4321" },
    { order_no: no, contact: "qa.guest" },
    { order_no: no, contact: "qa.guest@example.co" },
    { order_no: no, contact: "qa. guest@example.com" },
  ];
  for (const body of refused) {
    const res = await lookup(body, nextIp());
    assert.deepEqual([res.status, res.body.error.code], [404, "ORDER_NOT_FOUND"], JSON.stringify(body));
  }
  const fullWidthNo = await lookup({ order_no: no.replace(/[A-Z0-9]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)), contact: PASSENGER.email }, nextIp());
  assert.equal(fullWidthNo.status, 400, "全角的订单号：和页面一样按格式不对处理（页面也只认半角）");
  const vias = await api.db.owner.query<{ n: string }>("select count(*) as n from site_order_links where order_id = $1 and issued_via = 'lookup'", [placed.body.order.id]);
  assert.equal(Number(vias.rows[0]?.n), accepted.length, "只有对上的才发了新链接");
});

test("找回时手机号、邮箱用全角输入（日文 / 中文输入法常见）也认：先转成半角再比", async () => {
  const placed = await place();
  const toFullWidth = (text: string): string => text.replace(/[!-~]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
  for (const contact of [toFullWidth("+81 90-8765-4321"), toFullWidth("qa.guest@example.com")]) {
    const res = await lookup({ order_no: placed.body.order.order_no, contact }, nextIp());
    assert.equal(res.status, 200, `${contact}：${res.text}`);
  }
});

test("找回限速：每个地址 15 分钟 10 次（格式不对、对不上、对上都算），第 11 次 429 + Retry-After，窗口结束前 1 秒仍挡、到点放行", async () => {
  const placed = await place();
  const ip = nextIp();
  const start = api.clock.now().getTime();
  const attempts = [
    { order_no: "bad", contact: "x" },
    { order_no: placed.body.order.order_no, contact: PASSENGER.email },
    ...Array.from({ length: 8 }, (_, i) => ({ order_no: `NZ20261007QQQQQQ${String.fromCharCode(65 + i)}Q`, contact: "nobody@example.com" })),
  ];
  const statuses: number[] = [];
  for (const body of attempts) statuses.push((await lookup(body, ip)).status);
  assert.deepEqual(statuses, [400, 200, ...Array(8).fill(404)]);
  const limited = await lookup({ order_no: placed.body.order.order_no, contact: PASSENGER.email }, ip);
  assert.deepEqual([limited.status, limited.body.error.code], [429, "RATE_LIMITED"], "对得上的第 11 次也挡");
  assert.equal(Number(limited.headers["retry-after"]), 900);
  assert.equal(limited.body.error.details.retry_after_seconds, 900);
  moveTo(new Date(start + 15 * 60_000 - 1_000));
  const almost = await lookup({ order_no: placed.body.order.order_no, contact: PASSENGER.email }, ip);
  assert.deepEqual([almost.status, Number(almost.headers["retry-after"])], [429, 1]);
  moveTo(new Date(start + 15 * 60_000));
  assert.equal((await lookup({ order_no: placed.body.order.order_no, contact: PASSENGER.email }, ip)).status, 200, "窗口过了放行");
});

test("找回限速：每个订单号每小时 10 次失败——换地址、换大小写和空白都算同一个订单号；不存在的订单号表现一样（不能借限速确认订单存在）；59:59 仍挡、1 小时到点放行", async () => {
  const placed = await place();
  const no = placed.body.order.order_no as string;
  const start = api.clock.now().getTime();
  const variants = [no, no.toLowerCase(), ` ${no} `, `${no.slice(0, 9)}${no.slice(9).toLowerCase()}`];
  for (let i = 0; i < 10; i += 1) assert.equal((await lookup({ order_no: variants[i % variants.length], contact: `wrong${i}@example.com` }, nextIp())).status, 404);
  const blocked = await lookup({ order_no: no, contact: "wrong-again@example.com" }, nextIp());
  assert.deepEqual([blocked.status, blocked.body.error.code], [429, "RATE_LIMITED"], "换了地址再猜也挡（这个订单号这一小时已经错了 10 次）");

  const ghost = "NZ20261007GHOSTQQQ";
  const ghostStatuses: number[] = [];
  for (let i = 0; i < 11; i += 1) ghostStatuses.push((await lookup({ order_no: ghost, contact: `wrong${i}@example.com` }, nextIp())).status);
  assert.deepEqual(ghostStatuses, [...Array(10).fill(404), 429], "不存在的订单号同样第 11 次 429");

  moveTo(new Date(start + HOUR - 1_000));
  assert.equal((await lookup({ order_no: no, contact: "wrong-late@example.com" }, nextIp())).status, 429);
  moveTo(new Date(start + HOUR));
  assert.equal((await lookup({ order_no: no, contact: "wrong-next@example.com" }, nextIp())).status, 404, "一小时到点放行");
});

test("找回限速只记失败：订单号的额度被别人用错的联系方式刷满后，真客人用正确的邮箱、手机号仍能找回，也不占这一层额度；刷满后的失败应答和不存在的订单号完全一样", async () => {
  const placed = await place();
  const no = placed.body.order.order_no as string;
  const ghost = "NZ20261007FLOODQQQ";
  for (const orderNo of [no, ghost]) {
    for (let i = 0; i < 10; i += 1) assert.equal((await lookup({ order_no: orderNo, contact: `flood${i}@example.com` }, nextIp())).status, 404);
  }
  const realFailure = await lookup({ order_no: no, contact: "flood-x@example.com" }, nextIp());
  const ghostFailure = await lookup({ order_no: ghost, contact: "flood-x@example.com" }, nextIp());
  assert.deepEqual([realFailure.status, realFailure.body.error.code], [429, "RATE_LIMITED"]);
  assert.equal(realFailure.text, ghostFailure.text, "刷满后：存在的和不存在的订单号失败正文一样");
  assert.deepEqual(stableHeaders(realFailure), stableHeaders(ghostFailure), "刷满后：响应头一样");

  for (const contact of [PASSENGER.email, "+81 90-8765-4321", PASSENGER.email]) {
    const res = await lookup({ order_no: no, contact }, nextIp());
    assert.equal(res.status, 200, `真客人 ${contact}：${res.text}`);
    assert.match(res.body.link.token, /^nzo_/);
    assert.equal((await site.call("GET", "/site/v1/order", { token: res.body.link.token, ip: nextIp() })).status, 200);
  }
  const stillBlocked = await lookup({ order_no: no, contact: "flood-y@example.com" }, nextIp());
  assert.equal(stillBlocked.text, ghostFailure.text, "成功不清零失败计数：猜错的仍然 429，和不存在的一样");

  // 地址那一层成功也照旧计数
  const ip = nextIp();
  const statuses: number[] = [];
  for (let i = 0; i < 11; i += 1) statuses.push((await lookup({ order_no: no, contact: PASSENGER.email }, ip)).status);
  assert.deepEqual(statuses, [...Array(10).fill(200), 429], "同一个地址成功 10 次后第 11 次也挡");
});

test("找回硬上限：订单号滚动 24 小时失败满 100 次后，正确的联系方式也 429（和不存在的订单号、猜错的应答一模一样），记一条服务日志；最早的失败满 24 小时后恢复", async () => {
  const logged = await makeSite({ clientId: siteClient.clientId, payments: pay });
  try {
    const placed = await place({ on: logged });
    const no = placed.body.order.order_no as string;
    const ghost = "NZ20261007CEILQQQQ";
    const start = api.clock.now().getTime();
    for (const orderNo of [no, ghost]) {
      const statuses: number[] = [];
      for (let i = 0; i < 99; i += 1) statuses.push((await lookup({ order_no: orderNo, contact: `guess${i}@example.com` }, nextIp(), logged)).status);
      assert.deepEqual(statuses, [...Array(10).fill(404), ...Array(89).fill(429)], "每小时 10 次失败后 429，之后的失败照样记下");
    }
    assert.equal((await lookup({ order_no: no, contact: PASSENGER.email }, nextIp(), logged)).status, 200, "失败 99 次：对上的还能找回");
    assert.ok(!logged.logs().includes("site_lookup_ceiling_reached"));

    api.clock.advance(HOUR);
    const hundredth = await lookup({ order_no: no, contact: "guess-100@example.com" }, nextIp(), logged);
    assert.equal(hundredth.status, 404, "第 100 次失败本身照常 404（新的一小时）");
    assert.equal((await lookup({ order_no: ghost, contact: "guess-100@example.com" }, nextIp(), logged)).status, 404);
    const warnings = logged.logs().split("\n").filter((line) => line.includes("site_lookup_ceiling_reached"));
    assert.equal(warnings.length, 2, "满 100 次时各记一条");
    assert.ok(warnings.some((line) => line.includes(placed.body.order.id)), "存在的订单带订单编号，运营能找到");
    assert.ok(!logged.logs().includes(no) && !logged.logs().includes(PASSENGER.email), "订单号原文和联系方式不进日志");

    const correct = await lookup({ order_no: no, contact: PASSENGER.email }, nextIp(), logged);
    const correctPhone = await lookup({ order_no: no, contact: "+81 90-8765-4321" }, nextIp(), logged);
    const wrong = await lookup({ order_no: no, contact: "guess-101@example.com" }, nextIp(), logged);
    const missing = await lookup({ order_no: ghost, contact: PASSENGER.email }, nextIp(), logged);
    assert.deepEqual([correct.status, correct.body.error.code], [429, "RATE_LIMITED"], "满 100 次后对上的也挡");
    assert.equal(Number(correct.headers["retry-after"]), 23 * 3600, "等到最早的失败满 24 小时");
    for (const [name, res] of Object.entries({ correctPhone, wrong, missing })) {
      assert.equal(res.text, correct.text, `${name} 的正文和对上的不一样`);
      assert.deepEqual(stableHeaders(res), stableHeaders(correct), `${name} 的响应头和对上的不一样`);
    }

    api.clock.advance(23 * HOUR - 1_000);
    assert.equal((await lookup({ order_no: no, contact: PASSENGER.email }, nextIp(), logged)).status, 429, "差 1 秒满 24 小时仍挡");
    moveTo(new Date(start + 24 * HOUR));
    const back = await lookup({ order_no: no, contact: PASSENGER.email }, nextIp(), logged);
    assert.equal(back.status, 200, `最早的失败满 24 小时后恢复：${back.text}`);
    assert.equal((await site.call("GET", "/site/v1/order", { token: back.body.link.token, ip: nextIp() })).status, 200);
  } finally {
    await logged.close();
  }
});

// ---- 来源地址 ----

test("限速按来源地址：TRUST_PROXY_HOPS=0 时伪造的 X-Forwarded-For 不算数；=1 时只认反向代理追加的最后一个地址，伪造最左边的绕不过", async () => {
  const direct = await makeSite({ clientId: siteClient.clientId, payments: pay, env: { TRUST_PROXY_HOPS: "0" } });
  const proxied = await makeSite({ clientId: siteClient.clientId, payments: pay, env: { TRUST_PROXY_HOPS: "1" } });
  try {
    const body = { order_no: "NZ20261007PROXYQQQ", contact: "nobody@example.com" };
    const realIp = nextIp();
    const directStatuses: number[] = [];
    for (let i = 0; i < 11; i += 1) directStatuses.push((await direct.call("POST", "/site/v1/orders/lookup", { ip: realIp, body: { ...body, order_no: `NZ20261007PRXA${String.fromCharCode(65 + i)}QQQ` }, headers: { "x-forwarded-for": `192.0.2.${i + 1}` } })).status);
    assert.deepEqual(directStatuses, [...Array(10).fill(404), 429], "不信任代理时，换 X-Forwarded-For 也是同一个地址");

    const proxyIp = nextIp();
    const client = nextIp();
    const proxiedStatuses: number[] = [];
    for (let i = 0; i < 11; i += 1) proxiedStatuses.push((await proxied.call("POST", "/site/v1/orders/lookup", { ip: proxyIp, body: { ...body, order_no: `NZ20261007PRXB${String.fromCharCode(65 + i)}QQQ` }, headers: { "x-forwarded-for": `192.0.2.${i + 1}, ${client}` } })).status);
    assert.deepEqual(proxiedStatuses, [...Array(10).fill(404), 429], "伪造的最左边地址每次都不同，仍按代理看到的客户端计");
    const another = await proxied.call("POST", "/site/v1/orders/lookup", { ip: proxyIp, body: { ...body, order_no: "NZ20261007PRXCAQQQ" }, headers: { "x-forwarded-for": nextIp() } });
    assert.equal(another.status, 404, "同一个代理后面的另一位客人有自己的额度（证明确实按 X-Forwarded-For 区分）");
  } finally {
    await direct.close();
    await proxied.close();
  }
});

// ---- 未知字段 ----

test("不认未知字段：渠道编号、租户编号、币种、加价比例、结算价、免收取消费等一律 400，什么都没改", async () => {
  const placed = await place();
  const token = placed.body.link.token as string;
  const ip = placed.ip;
  const sneaky = { channel_id: siteChannelId, tenant_id: m.b.tenantId, currency: "USD", markup_bp: 0, settlement: 1, winning_tenant_id: m.a.tenantId };
  const quote = await quoteOn(site, ip, serviceIn(12));
  for (const [key, value] of Object.entries(sneaky)) {
    const q = await site.call("POST", "/site/v1/quotes", { ip, body: { ...quoteBody(serviceIn(12)), [key]: value } });
    assert.equal(q.status, 400, `询价 ${key}`);
    const o = await site.call("POST", "/site/v1/orders", { ip: nextIp(), headers: { "idempotency-key": randomUUID() }, body: { ...orderBody(quote.quote_id, "pickup"), [key]: value } });
    assert.equal(o.status, 400, `下单 ${key}`);
    const p = await site.call("POST", "/site/v1/orders", { ip: nextIp(), headers: { "idempotency-key": randomUUID() }, body: { ...orderBody(quote.quote_id, "pickup"), passenger: { ...PASSENGER, [key]: value } } });
    assert.equal(p.status, 400, `下单 passenger.${key}`);
    const l = await lookup({ order_no: placed.body.order.order_no, contact: PASSENGER.email, [key]: value }, nextIp());
    assert.equal(l.status, 400, `找回 ${key}`);
    const c = await site.call("PATCH", "/site/v1/order", { token, ip, headers: { "if-match": `"${placed.body.order.version}"` }, body: { notes: "x", [key]: value } });
    assert.equal(c.status, 400, `改单 ${key}`);
    const x = await site.call("POST", "/site/v1/order/cancel", { token, ip, body: { [key]: value } });
    assert.equal(x.status, 400, `取消 ${key}`);
  }
  assert.equal((await site.call("POST", "/site/v1/quotes", { ip, body: { ...quoteBody(serviceIn(12)), address: { ...ADDRESS, place_id: m.ids.narita } } })).status, 400, "地址里多一个字段");
  assert.equal((await site.call("GET", "/site/v1/order/cancel-fee?waive_fee=true", { token, ip })).status, 400, "免收取消费是平台才有的选项");
  assert.equal((await site.call("POST", "/site/v1/order/cancel", { token, ip, body: { reason: "SUPPLIER_NO_SHOW" } })).status, 400, "只认客人能用的取消原因");
  assert.equal((await site.call("POST", "/site/v1/order/cancel", { token, ip, body: { waive_fee: true } })).status, 400);

  const after = await site.call("GET", "/site/v1/order", { token, ip });
  assert.deepEqual([after.body.order.status, after.body.order.notes, after.body.order.version, after.body.order.price.total], ["pending_payment", null, placed.body.order.version, { amount: "21780", currency: "JPY" }]);
  const orders = await api.db.owner.query<{ n: string }>("select count(*) as n from order_sales where quote_id = $1", [quote.quote_id]);
  assert.equal(Number(orders.rows[0]?.n), 0, "带了未知字段的下单一张也没建");
});

// ---- 不泄露 ----

test("所有应答（含各种错误）都不含供应商编号、结算价、加价比例、渠道和 API 客户端的内部信息；付款前连中标供应商的名字也没有", async () => {
  const ip = nextIp();
  const texts: { label: string; text: string; paid: boolean }[] = [];
  const keep = (label: string, res: ApiResponse, paid = false): ApiResponse => {
    texts.push({ label, text: res.text, paid });
    return res;
  };
  keep("config", await site.call("GET", "/site/v1/config", { ip }));
  keep("cities", await site.call("GET", "/site/v1/cities", { ip }));
  keep("airports", await site.call("GET", `/site/v1/cities/${m.ids.tokyo}/airports`, { ip }));
  keep("airports-bad", await site.call("GET", "/site/v1/cities/not-a-uuid/airports", { ip }));
  keep("quote", await site.call("POST", "/site/v1/quotes", { ip, body: quoteBody(serviceIn(10)) }));
  keep("quote-unavailable", await site.call("POST", "/site/v1/quotes", { ip, body: quoteBody(serviceIn(10), { passengers: 60 }) }));
  keep("quote-too-soon", await site.call("POST", "/site/v1/quotes", { ip, body: quoteBody(new Date(api.clock.now().getTime() + 2 * HOUR)) }));
  const quote = await quoteOn(site, ip, serviceIn(10));
  const key = randomUUID();
  const body = orderBody(quote.quote_id, "pickup");
  const created = keep("order", await site.call("POST", "/site/v1/orders", { ip, headers: { "idempotency-key": key }, body }));
  assert.equal(created.status, 201, created.text);
  keep("order-replay", await site.call("POST", "/site/v1/orders", { ip, headers: { "idempotency-key": key }, body }));
  keep("order-key-reused", await site.call("POST", "/site/v1/orders", { ip, headers: { "idempotency-key": key }, body: { ...body, notes: "换了内容" } }));
  keep("order-quote-used", await site.call("POST", "/site/v1/orders", { ip, headers: { "idempotency-key": randomUUID() }, body }));
  keep("order-quote-unknown", await site.call("POST", "/site/v1/orders", { ip: nextIp(), headers: { "idempotency-key": randomUUID() }, body: { ...body, quote_id: "QT20261007ZZZZZZZZZZ" } }));
  const token = created.body.link.token as string;
  const orderId = created.body.order.id as string;
  keep("view", await site.call("GET", "/site/v1/order", { token, ip }));
  keep("payment", await site.call("GET", "/site/v1/order/payment", { token, ip }));
  keep("fee", await site.call("GET", "/site/v1/order/cancel-fee", { token, ip }));
  keep("landed-unpaid", await site.call("POST", "/site/v1/order/landed", { token, ip }));
  keep("patch-stale", await site.call("PATCH", "/site/v1/order", { token, ip, headers: { "if-match": '"999"' }, body: { notes: "x" } }));
  keep("dispute-unknown", await site.call("POST", `/site/v1/order/extra-charges/${randomUUID()}/dispute`, { token, ip, body: { reason: "x" } }));
  keep("bad-token", await site.call("GET", "/site/v1/order", { token: `nzo_${"Z".repeat(43)}`, ip }));
  keep("lookup-404", await lookup({ order_no: created.body.order.order_no, contact: "x@y.z" }, ip));
  await payFor(orderId);
  keep("view-paid", await site.call("GET", "/site/v1/order", { token, ip }), true);
  keep("fee-paid", await site.call("GET", "/site/v1/order/cancel-fee", { token, ip }), true);
  keep("patch-paid", await site.call("PATCH", "/site/v1/order", { token, ip, headers: { "if-match": `"${(await site.call("GET", "/site/v1/order", { token, ip })).body.order.version}"` }, body: { notes: "带婴儿座椅" } }), true);
  keep("cancel-paid", await site.call("POST", "/site/v1/order/cancel", { token, ip, body: {} }), true);
  const flood = nextIp();
  for (let i = 0; i < 30; i += 1) await site.call("POST", "/site/v1/quotes", { ip: flood, body: { bad: true } });
  const limited = keep("rate-limited", await site.call("POST", "/site/v1/quotes", { ip: flood, body: quoteBody(serviceIn(10)) }));
  assert.equal(limited.status, 429);

  const sale = (await api.db.owner.query<{ api_client_id: string }>("select api_client_id from order_sales where order_id = $1", [orderId])).rows[0]!;
  const forbidden = [m.a.tenantId, m.b.tenantId, m.ids.pa, m.ids.pb, siteChannelId, siteClient.clientId, siteClient.id, sale.api_client_id, "甲车队", "19800", "20000", "19,800", "markup", "settlement", "tenant_id", "api_client", "channel_id", "client_id\""];
  for (const { label, text, paid } of texts) {
    for (const word of forbidden) {
      // 金额按「单独的数」比对：编号（UUID、订单号）里碰巧有同样几位数字不算
      const found = /^[0-9,]+$/.test(word) ? new RegExp(`(?<![0-9A-Za-z-])${word}(?![0-9A-Za-z-])`).test(text) : text.includes(word);
      assert.ok(!found, `${label} 里有 ${word}：${text.slice(0, 400)}`);
    }
    if (!paid) assert.ok(!text.includes("乙车队"), `${label}：付款前出现了中标供应商`);
  }
  assert.ok(texts.find((entry) => entry.label === "view-paid")?.text.includes("乙车队"), "检查本身有效：付款后确实显示中标供应商的名字（ADR 0032 允许）");
  const keys = new Set<string>();
  for (const { text } of texts) {
    try {
      allKeys(JSON.parse(text), keys);
    } catch {
      continue;
    }
  }
  for (const key of ["tenant_id", "winner_tenant_id", "settlement", "settlement_price", "markup_bp", "markup_percent", "channel_id", "api_client_id", "cost"]) assert.ok(!keys.has(key), key);
});

// ---- 停止接单 ----

test("官网的客户端吊销：config 关、询价下单 503；已有订单照常能看、试算、改单、点我已落地、取消、找回；换一个新客户端后旧链接照样能用", async () => {
  // 前面的测试可能把时钟拨过了好几天：渠道经理重新登录
  const cm1 = { ...m.staff.cm1, token: await platformLogin(api, m.staff.cm1.email) };
  const fresh = { ...m, staff: { ...m.staff, cm1 } };
  const channelId = (await newChannel(api, cm1.token, { name: `官网-吊销-${randomUUID().slice(0, 4)}` })).id;
  const creds = await salesCredentials(api, fresh, channelId);
  const own = await makeSite({ clientId: creds.clientId, payments: pay });
  let renewed: Site | null = null;
  try {
    const pickup = await place({ on: own, days: 4 });
    const second = await place({ on: own, days: 4 });
    await payFor(pickup.body.order.id);
    await payFor(second.body.order.id);
    await ok(api.call("POST", `/platform/v1/channels/${channelId}/api-clients/${creds.id}/revoke`, { token: cm1.token }));

    const ip = nextIp();
    assert.deepEqual((await own.call("GET", "/site/v1/config", { ip })).body, { open: false, currency: null, payments: null, support_phone: null });
    for (const [method, url, body] of [["GET", "/site/v1/cities", undefined], ["GET", `/site/v1/cities/${m.ids.tokyo}/airports`, undefined], ["POST", "/site/v1/quotes", quoteBody(serviceIn(10))]] as const) {
      const res = await own.call(method, url, { ip, ...(body === undefined ? {} : { body }) });
      assert.deepEqual([res.status, res.body.error.code], [503, "SITE_NOT_OPEN"], url);
    }
    const blockedOrder = await own.call("POST", "/site/v1/orders", { ip, headers: { "idempotency-key": randomUUID() }, body: orderBody("QT20261007ZZZZZZZZZZ", "pickup") });
    assert.deepEqual([blockedOrder.status, blockedOrder.body.error.code], [503, "SITE_NOT_OPEN"]);

    const token = pickup.body.link.token as string;
    const view = await own.call("GET", "/site/v1/order", { token, ip });
    assert.equal(view.status, 200, view.text);
    assert.equal((await own.call("GET", "/site/v1/order/cancel-fee", { token, ip })).status, 200);
    const patched = await own.call("PATCH", "/site/v1/order", { token, ip, headers: { "if-match": `"${view.body.order.version}"` }, body: { flight_no: "JL5" } });
    assert.deepEqual([patched.status, patched.body.order?.flight_no], [200, "JL5"], patched.text);
    moveTo(new Date(pickup.serviceAt.getTime() - HOUR));
    const landed = await own.call("POST", "/site/v1/order/landed", { token, ip });
    assert.equal(landed.status, 200, landed.text);
    assert.equal(landed.body.order.landing.guest_reported_at, api.clock.now().toISOString());
    const cancelled = await own.call("POST", "/site/v1/order/cancel", { token: second.body.link.token, ip, body: {} });
    assert.deepEqual([cancelled.status, cancelled.body.order?.status], [200, "cancelled"], cancelled.text);
    assert.equal((await lookup({ order_no: pickup.body.order.order_no, contact: PASSENGER.email }, ip, own)).status, 200, "停止接单也能找回");

    const replacement = await salesCredentials(api, { ...fresh, staff: { ...fresh.staff, cm1: { ...cm1, token: await platformLogin(api, cm1.email) } } }, channelId);
    renewed = await makeSite({ clientId: replacement.clientId, payments: pay });
    assert.equal((await renewed.call("GET", "/site/v1/config", { ip })).body.open, true);
    assert.equal((await renewed.call("GET", "/site/v1/order", { token, ip })).status, 200, "运营换了官网的客户端（同一个渠道），客人手里的旧链接照样能用");
  } finally {
    await own.close();
    await renewed?.close();
  }
});

// ---- 下单流程 ----

test("下单幂等：同一个键并发提交 4 次只成一单、4 个链接都指向它；同一个键换内容被拒且不建新单", async () => {
  const ip = nextIp();
  const quote = await quoteOn(site, ip, serviceIn(10));
  const key = randomUUID();
  const body = orderBody(quote.quote_id, "pickup");
  const results = await Promise.all(Array.from({ length: 4 }, () => site.call("POST", "/site/v1/orders", { ip, headers: { "idempotency-key": key }, body })));
  for (const res of results) assert.equal(res.status, 201, res.text);
  const ids = new Set(results.map((res) => res.body.order.id));
  assert.equal(ids.size, 1, "只成一单");
  assert.equal(results.filter((res) => res.headers["idempotent-replayed"] === "true").length, 3);
  const tokens = new Set(results.map((res) => res.body.link.token));
  assert.equal(tokens.size, 4, "每次一个新链接");
  for (const token of tokens) assert.equal((await site.call("GET", "/site/v1/order", { token, ip })).body.order.id, [...ids][0]);
  const reused = await site.call("POST", "/site/v1/orders", { ip, headers: { "idempotency-key": key }, body: { ...body, notes: "换了内容" } });
  assert.ok(reused.status === 409 || reused.status === 422, reused.text);
  assert.equal(reused.body.link, undefined, "被拒时不发链接");
  const count = await api.db.owner.query<{ n: string }>("select count(*) as n from order_sales where channel_id = $1 and idempotency_key = $2", [siteChannelId, key]);
  assert.equal(Number(count.rows[0]?.n), 1);
  const links = await api.db.owner.query<{ n: string }>("select count(*) as n from site_order_links where order_id = $1", [[...ids][0]]);
  assert.equal(Number(links.rows[0]?.n), 4);
});

test("Stripe 没配置：付款期限前 1 秒的超时检查不取消，过了期限取消并释放预占，不伪造付款成功", async () => {
  const noStripe = await makeSite({ clientId: siteClient.clientId, payments: null });
  try {
    const placed = await place({ on: noStripe });
    const due = new Date(placed.body.order.payment_due_at as string);
    assert.deepEqual([placed.body.payment, placed.body.order.status], [null, "pending_payment"]);
    assert.equal(due.getTime() - new Date(placed.body.order.created_at as string).getTime(), 30 * 60_000, "保留 30 分钟");
    moveTo(new Date(due.getTime() - 1_000));
    await api.app.orderJobs.tick();
    assert.equal((await noStripe.call("GET", "/site/v1/order", { token: placed.body.link.token, ip: placed.ip })).body.order.status, "pending_payment", "到期前不取消");
    moveTo(new Date(due.getTime() + 1_000));
    await api.app.orderJobs.tick();
    const after = await noStripe.call("GET", "/site/v1/order", { token: placed.body.link.token, ip: placed.ip });
    assert.deepEqual([after.body.order.status, after.body.order.cancel_reason], ["cancelled", "PAYMENT_TIMEOUT"]);
    assert.ok(!["succeeded", "paid"].includes(after.body.order.payment_status), "没有伪造付款成功");
    const held = await api.db.owner.query<{ inventory_held: boolean }>("select inventory_held from orders where id = $1", [placed.body.order.id]);
    assert.equal(held.rows[0]?.inventory_held, false, "预占已释放");
  } finally {
    await noStripe.close();
  }
});

test("取消：先试算（扣一半那一档），确认后实际扣款、退款与试算完全一致；取消后再试算说不能取消", async () => {
  const placed = await place({ days: 6 });
  const token = placed.body.link.token as string;
  await payFor(placed.body.order.id);
  const view = await site.call("GET", "/site/v1/order", { token, ip: placed.ip });
  const half = (view.body.order.cancel_policy.tiers as { min_hours_before: number; fee_bp: number }[]).find((tier) => tier.fee_bp > 0 && tier.fee_bp < 10_000);
  assert.ok(half, JSON.stringify(view.body.order.cancel_policy));
  moveTo(new Date(placed.serviceAt.getTime() - (half.min_hours_before + 1) * HOUR));
  const fee = await site.call("GET", "/site/v1/order/cancel-fee", { token, ip: placed.ip });
  assert.equal(fee.status, 200, fee.text);
  assert.equal(fee.body.fee_bp, half.fee_bp);
  assert.equal(Number(fee.body.fee.amount) + Number(fee.body.refund.amount), 21_780, "扣的 + 退的 = 付的");
  const cancelled = await site.call("POST", "/site/v1/order/cancel", { token, ip: placed.ip, body: {} });
  assert.equal(cancelled.status, 200, cancelled.text);
  assert.deepEqual(
    [cancelled.body.order.cancellation.fee_bp, cancelled.body.order.cancellation.fee, cancelled.body.order.cancellation.refund],
    [fee.body.fee_bp, fee.body.fee, fee.body.refund],
    "实际与试算一致",
  );
  const again = await site.call("GET", "/site/v1/order/cancel-fee", { token, ip: placed.ip });
  assert.equal(again.body.cancellable, false, again.text);
});

test("「我已落地」只对接机单：送机单的订单页没有落地信息，点了 409 LANDING_NOT_APPLICABLE；接机单取消后也不能点", async () => {
  const dropoff = await place({ direction: "dropoff", days: 3 });
  await payFor(dropoff.body.order.id);
  const seen = await site.call("GET", "/site/v1/order", { token: dropoff.body.link.token, ip: dropoff.ip });
  assert.equal(seen.body.order.landing, null);
  moveTo(new Date(dropoff.serviceAt.getTime() - HOUR));
  const res = await site.call("POST", "/site/v1/order/landed", { token: dropoff.body.link.token, ip: dropoff.ip });
  assert.deepEqual([res.status, res.body.error.code], [409, "LANDING_NOT_APPLICABLE"]);

  const pickup = await place({ days: 3 });
  await payFor(pickup.body.order.id);
  await site.call("POST", "/site/v1/order/cancel", { token: pickup.body.link.token, ip: pickup.ip, body: {} });
  moveTo(new Date(pickup.serviceAt.getTime() - HOUR));
  const closed = await site.call("POST", "/site/v1/order/landed", { token: pickup.body.link.token, ip: pickup.ip });
  assert.deepEqual([closed.status, closed.body.error.code], [409, "ORDER_STATE_INVALID"]);
  assert.equal((await site.call("GET", "/site/v1/order", { token: pickup.body.link.token, ip: pickup.ip })).body.order.landing.guest_reported_at, null);
});

test("「我已落地」的开放时刻：计划到达前 3 小时差 1 秒不能点，整 3 小时可以点；点过后时间不再变", async () => {
  const placed = await place({ days: 3 });
  const token = placed.body.link.token as string;
  await payFor(placed.body.order.id);
  moveTo(new Date(placed.serviceAt.getTime() - 3 * HOUR - 1_000));
  const early = await site.call("POST", "/site/v1/order/landed", { token, ip: placed.ip });
  assert.deepEqual([early.status, early.body.error.code], [409, "LANDING_TOO_EARLY"]);
  api.clock.advance(1_000);
  const landed = await site.call("POST", "/site/v1/order/landed", { token, ip: placed.ip });
  assert.equal(landed.status, 200, landed.text);
  const at = landed.body.order.landing.guest_reported_at;
  assert.equal(at, api.clock.now().toISOString());
  api.clock.advance(10 * 60_000);
  assert.equal((await site.call("POST", "/site/v1/order/landed", { token, ip: placed.ip })).body.error.code, "LANDING_ALREADY_REPORTED");
  assert.equal((await site.call("GET", "/site/v1/order", { token, ip: placed.ip })).body.order.landing.guest_reported_at, at, "再点不会改时间");
});

test("异议期：提交后 48 小时差 1 秒还能提，到点 409 DISPUTE_WINDOW_CLOSED；别的订单的令牌提不了这一项", async () => {
  const placed = await place({ days: 3 });
  const stranger = await place({ days: 3 });
  await payFor(placed.body.order.id);
  await completeOrder(api, m, "b", placed.body.order.id);
  const tenant = await tenantLogin(api, m.b.adminEmail);
  const first = await ok(api.call("POST", `/tenant/v1/orders/${placed.body.order.id}/extra-charges`, { token: tenant, body: { type: "waiting", amount: 1_000, description: "等了 30 分钟" } }), 201);
  const second = await ok(api.call("POST", `/tenant/v1/orders/${placed.body.order.id}/extra-charges`, { token: tenant, body: { type: "extra_stop", amount: 500, description: "中途多停一站" } }), 201);
  const until = new Date(first.extra_charge.dispute_until as string);
  assert.equal(until.getTime() - api.clock.now().getTime(), 48 * HOUR, "提交后 48 小时");

  const foreign = await site.call("POST", `/site/v1/order/extra-charges/${first.extra_charge.id}/dispute`, { token: stranger.body.link.token, ip: stranger.ip, body: { reason: "不是我的单" } });
  assert.equal(foreign.status, 404, "B 单的令牌碰不到 A 单的加收");

  moveTo(new Date(until.getTime() - 1_000));
  const inTime = await site.call("POST", `/site/v1/order/extra-charges/${first.extra_charge.id}/dispute`, { token: placed.body.link.token, ip: placed.ip, body: { reason: "没有等那么久" } });
  assert.deepEqual([inTime.status, inTime.body.extra_charge?.status], [200, "disputed"], inTime.text);
  api.clock.advance(1_000 + Math.max(0, new Date(second.extra_charge.dispute_until as string).getTime() - until.getTime()));
  const late = await site.call("POST", `/site/v1/order/extra-charges/${second.extra_charge.id}/dispute`, { token: placed.body.link.token, ip: placed.ip, body: { reason: "没有多停" } });
  assert.deepEqual([late.status, late.body.error.code], [409, "DISPUTE_WINDOW_CLOSED"]);
  const empty = await site.call("POST", `/site/v1/order/extra-charges/${first.extra_charge.id}/dispute`, { token: placed.body.link.token, ip: placed.ip, body: { reason: "   " } });
  assert.equal(empty.status, 400, "理由不能是空白");
});
