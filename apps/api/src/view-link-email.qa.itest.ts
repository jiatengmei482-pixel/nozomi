/**
 * M4-30 测试角色：官网查订单把链接发到下单邮箱（ADR 0061）。真实 PostgreSQL + 本机假 SMTP，从不连真实的邮件服务。
 * 对照负责人的四条要求逐条核对：
 * - 不泄露订单是否存在：对上、邮箱不对、订单号不存在、已取消、大小写和空白不同、别的渠道的单、已脱敏——状态码、正文、完整的应答头（含值）、
 *   官网应用自己的日志（含应答之后的后台任务）、耗时中位数；限速触发前后各比一次；
 * - 限速：地址、订单号、邮箱三个维度；换地址轰炸一个邮箱一天最多 10 封；并发突破不了上限；
 * - 令牌：邮件里的链接能开、只能看这一单、能取消和改单；旧链接仍有效；有效期；发件箱过期；邮件正文、库、日志里没有令牌和邮箱原文；
 * - 运营重发：数据范围、自建角色、客服不能批、并发、批准时订单已脱敏、新邮箱整库扫描、改了下单邮箱以后的去向；
 * - 隔离：租户的通知列表和订单里没有这些，`/tenant/v1` 不含对外价和加价比例。
 * 全部是虚构数据，测试结束删掉整个 schema。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { ANONYMIZED_PASSENGER } from "@nozomi/domain";
import { type ApiResponse, type TestApi, createTestApi } from "./testing/api.ts";
import { type FakeSmtp, decodedMailText, startFakeSmtp } from "./testing/fake-integrations.ts";
import { type Market, addStaff, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { platformLogin, tenantLogin } from "./testing/money.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";
import { type SiteApi, resetLinkLimits, siteApi } from "./testing/site.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ADDRESS = { lng: 139.7, lat: 35.6 };
const PASSENGER_NAME = "虚构乘客甲";
const PASSENGER_PHONE = "+81 90-3333-4444";
const DROPOFF_TEXT = "虚构市虚构町三丁目";

let api: TestApi;
let m: Market;
let smtp: FakeSmtp;
let pay: FakePaymentProvider;
let site: SiteApi;
let siteLogs = "";
let siteClientId: string;
let smtpEnv: Record<string, string>;
let other: SalesFlow;
let cs: { id: string; token: string; email: string };
let ops2: { id: string; token: string; email: string };
let ipSeq = 0;

/** 每个请求一个来源地址：地址的额度不互相影响。 */
const nextIp = (): string => {
  ipSeq += 1;
  return `10.${30 + Math.floor(ipSeq / 250)}.0.${(ipSeq % 250) + 1}`;
};
const fictional = (label: string): string => `qa.${label}.${randomUUID().slice(0, 8)}@example.test`;

before(async () => {
  smtp = await startFakeSmtp();
  smtpEnv = { SMTP_HOST: smtp.host, SMTP_PORT: String(smtp.port), SMTP_ENCRYPTION: "none", SMTP_USERNAME: "mailer", SMTP_PASSWORD: "fake-smtp-password-Qa7", SMTP_FROM_NAME: "NOZOMI", SMTP_FROM_ADDRESS: "noreply@example.test" };
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay, env: smtpEnv, integrationSecretsTtlMs: 0 });
  m = await buildMarket(api);
  const siteChannelId = (await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" })).id;
  siteClientId = (await salesCredentials(api, m, siteChannelId)).clientId;
  // 官网应用打开日志（开发的用例看的是另一个应用的日志，官网请求和发信的日志不在那里）
  site = await siteApi(api, siteClientId, pay, { ...smtpEnv, PUBLIC_BASE_URL: "https://book.example.test" }, { integrationSecretsTtlMs: 0, logDestination: { write: (line) => void (siteLogs += line) } });
  other = await salesFlow(api, m, pay);
  cs = await addStaff(api, await login("root@platform.test"), "qa.cs@platform.test", "customer_service");
  ops2 = await addStaff(api, await login("root@platform.test"), "qa.ops2@platform.test", "operations");
});

after(async () => {
  await site?.close();
  await api?.close();
  await smtp?.close();
});

beforeEach(async () => {
  await drain();
  await resetLinkLimits(api);
});

/** 时钟拨过之后旧的登录令牌会过期：每次现登录。 */
const login = (email: string): Promise<string> => platformLogin(api, email);

/** 现在（测试时钟）之后 `days` 天的东京 10:00：前面的用例拨过时钟，写死的日期会变成过去。 */
function futureTokyo(days: number): { local: string; iso: string } {
  const date = new Date(api.clock.now().getTime() + 9 * HOUR + days * DAY).toISOString().slice(0, 10);
  return { local: `${date}T10:00`, iso: `${date}T10:00:00+09:00` };
}
const foreignOrder = (): Promise<any> => other.unpaidOrder({ serviceTime: futureTokyo(10).iso });

async function placeOrder(email: string, serviceLocal = futureTokyo(10).local, options: { paid?: boolean } = {}): Promise<{ order: any; link: { token: string }; ip: string }> {
  api.clock.advance(1_000);
  const ip = nextIp();
  const quoted = await ok(site.call("POST", "/site/v1/quotes", { ip, body: { city_id: m.ids.tokyo, airport_id: m.ids.narita, direction: "pickup", address: ADDRESS, service_local: serviceLocal, passengers: 2, luggage: 1 } }));
  const quote = quoted.quotes.find((q: any) => q.vehicle_group.id === m.ids.biz7);
  assert.ok(quote, JSON.stringify(quoted));
  api.clock.advance(1_000);
  const created = await ok(
    site.call("POST", "/site/v1/orders", {
      ip,
      headers: { "idempotency-key": randomUUID() },
      body: { quote_id: quote.quote_id, passenger: { name: PASSENGER_NAME, phone: PASSENGER_PHONE, email }, flight_no: "JL061", dropoff_address: DROPOFF_TEXT, save_payment_method: true },
    }),
    201,
  );
  if (options.paid === true) {
    const intent = pay.intentOf(created.order.id);
    assert.ok(intent);
    pay.pay(intent.id);
    const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
    assert.equal((await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()))).status, 200);
  }
  return { order: created.order, link: created.link, ip };
}

const lookup = (orderNo: string, email: string, ip = nextIp()): Promise<ApiResponse> => site.call("POST", "/site/v1/orders/lookup", { ip, body: { order_no: orderNo, email } });
async function deliver(): Promise<void> {
  await site.app.backgroundIdle();
  await site.app.notificationJobs.tick();
}
/** 把发件箱里排着的都发完再清空收件记录：上一个用例排下的信不算到这个用例头上。 */
async function drain(): Promise<void> {
  await site.app.backgroundIdle();
  for (let i = 0; i < 20; i += 1) {
    await site.app.notificationJobs.tick();
    const left = await api.db.owner.query("select count(*)::int as n from notifications where status = 'pending' and next_attempt_at <= $1", [api.clock.now()]);
    if (left.rows[0].n === 0) break;
  }
  smtp.reset();
}
const mailsTo = (email: string): string[] => smtp.messages.filter((message) => message.to.some((to: string) => to.toLowerCase() === email.toLowerCase())).map((message) => decodedMailText(message.data));
const tokenIn = (text: string): string | null => /\/book\/order#(nzo_[A-Za-z0-9_-]{43})/.exec(text)?.[1] ?? null;
/** 和隐私任务（repos/passenger-retention.ts）同样的写法把一张单脱敏：占位、清密文和盲索引。 */
const anonymize = (orderId: string) =>
  api.db.owner.query("update orders set passenger = $2::jsonb, passenger_anonymized_at = now(), passenger_enc = null, passenger_email_bidx = null, passenger_phone_bidx = null, passenger_name_bidx = null where id = $1", [orderId, JSON.stringify(ANONYMIZED_PASSENGER)]);
const resend = (orderId: string, token: string, body: Record<string, unknown>): Promise<ApiResponse> => api.call("POST", `/platform/v1/orders/${orderId}/view-link/resend`, { token, body });
const NEW_EMAIL_BODY = (email: string) => ({ target: "new_email", email, verification: "order_details", reason: "核对了行程、人数和航班号" });
const guestOrder = (token: string): Promise<ApiResponse> => site.call("GET", "/site/v1/order", { token, ip: nextIp() });

/** 应答头：去掉每次都不同、和请求无关的（日期、请求编号）；其余（含限速头、Retry-After、内容长度）连值一起比。 */
function comparableHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const name of Object.keys(headers).sort()) if (!["date", "x-request-id"].includes(name)) kept[name] = headers[name];
  return kept;
}

/** 一次请求（含它的后台任务）在官网应用日志里留下的内容：去掉时间、请求编号、耗时、来源地址这些每次都不同的。 */
function normalizedLogLines(chunk: string): string[] {
  const drop = new Set(["time", "reqId", "responseTime", "remoteAddress", "remotePort", "pid", "hostname", "request_id", "requestId"]);
  const clean = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(clean);
    if (typeof value !== "object" || value === null) return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !drop.has(key)).map(([key, item]) => [key, clean(item)]));
  };
  return chunk
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      try {
        return JSON.stringify(clean(JSON.parse(line)));
      } catch {
        return line;
      }
    });
}

/** 发一次查订单，返回应答和它（连同应答之后的后台任务）写的日志。 */
async function lookupWithLogs(orderNo: string, email: string, ip = nextIp()): Promise<{ res: ApiResponse; logs: string[] }> {
  await site.app.backgroundIdle();
  const start = siteLogs.length;
  const res = await lookup(orderNo, email, ip);
  await site.app.backgroundIdle();
  return { res, logs: normalizedLogLines(siteLogs.slice(start)).map((line) => line.replaceAll(orderNo, "<order_no>").replaceAll(orderNo.trim().toUpperCase(), "<order_no>")) };
}

/** 整个测试 schema 里每张表逐行转成文字搜一遍。 */
async function tablesContaining(needle: string): Promise<string[]> {
  const tables = (await api.db.owner.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = current_schema() and table_type = 'BASE TABLE'")).rows.map((row) => row.table_name);
  const hits: string[] = [];
  for (const table of tables) {
    const found = await api.db.owner.query(`select 1 from "${table}" t where position(lower($1) in lower(t::text)) > 0 limit 1`, [needle]);
    if (found.rowCount !== null && found.rowCount > 0) hits.push(table);
  }
  return hits;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

// ---------------------------------------------------------------------------------------------------------------
// 不泄露订单是否存在
// ---------------------------------------------------------------------------------------------------------------

test("七种情况（对上、大小写和空白不同、邮箱不对、订单号不存在、已取消、别的渠道的单、已脱敏）：状态码、正文、完整应答头（连值）、官网日志都一样；只有对上的和已取消的收到信", async () => {
  const email = fictional("matrix");
  const live = await placeOrder(email);
  const cancelledEmail = fictional("cancelled");
  const cancelled = await placeOrder(cancelledEmail);
  await ok(site.call("POST", "/site/v1/order/cancel", { token: cancelled.link.token, ip: nextIp(), body: {} }));
  const anonymizedEmail = fictional("anon");
  const anonymized = await placeOrder(anonymizedEmail);
  await anonymize(anonymized.order.id);
  const foreign = await foreignOrder();
  await drain();

  const cases: { name: string; orderNo: string; email: string }[] = [
    { name: "对上", orderNo: live.order.order_no, email },
    { name: "对上（小写订单号、前后空白、邮箱大写和全角 @）", orderNo: ` ${live.order.order_no.toLowerCase()}\t`, email: `　${email.toUpperCase().replace("@", "＠")}\n` },
    { name: "邮箱不对", orderNo: live.order.order_no, email: fictional("wrong") },
    { name: "订单号不存在", orderNo: "NZ20261007QANOPE01", email },
    { name: "已取消（邮箱对）", orderNo: cancelled.order.order_no, email: cancelledEmail },
    { name: "别的渠道的单（下单邮箱对）", orderNo: foreign.order_no, email: "guest@example.com" },
    { name: "已脱敏（原来的邮箱）", orderNo: anonymized.order.order_no, email: anonymizedEmail },
  ];
  const results: { name: string; res: ApiResponse; logs: string[] }[] = [];
  for (const item of cases) results.push({ name: item.name, ...(await lookupWithLogs(item.orderNo, item.email)) });
  const base = results[0] as (typeof results)[number];
  assert.equal(base.res.status, 202, base.res.text);
  assert.ok(base.logs.length > 0, "官网应用的请求日志确实写了（比较不是空对空）");
  for (const { name, res, logs } of results) {
    assert.equal(res.status, 202, `${name}：${res.text}`);
    assert.equal(res.text, base.res.text, `${name}：正文逐字一样`);
    assert.deepEqual(comparableHeaders(res.headers), comparableHeaders(base.res.headers), `${name}：应答头连值一样`);
    assert.deepEqual(logs, base.logs, `${name}：官网日志（含后台任务）和「对上」一样`);
  }
  await deliver();
  assert.equal(mailsTo(email).length, 2, "两次对上各一封");
  assert.equal(mailsTo(cancelledEmail).length, 1, "取消了的单客人也要能看退款：照发");
  assert.equal(mailsTo(anonymizedEmail).length, 0, "已脱敏不发");
  assert.equal(mailsTo("guest@example.com").length, 0, "别的渠道的单不发");
  assert.equal(smtp.messages.length, 3, "对不上的一封都不发");
});

test("耗时：对上、邮箱不对、订单号不存在、已取消、别的渠道的单交替各取 25 次，中位数相差不超过 50% 或 5 毫秒", async (t) => {
  const email = fictional("timing");
  const live = await placeOrder(email);
  const cancelledEmail = fictional("timing.cancel");
  const cancelled = await placeOrder(cancelledEmail);
  await ok(site.call("POST", "/site/v1/order/cancel", { token: cancelled.link.token, ip: nextIp(), body: {} }));
  const foreign = await foreignOrder();
  const cases = [
    { name: "对上", orderNo: live.order.order_no, email },
    { name: "邮箱不对", orderNo: live.order.order_no, email: fictional("timing.wrong") },
    { name: "订单号不存在", orderNo: "NZ20261007QATIME01", email },
    { name: "已取消", orderNo: cancelled.order.order_no, email: cancelledEmail },
    { name: "别的渠道的单", orderNo: foreign.order_no, email: "guest@example.com" },
  ];
  const samples = new Map<string, number[]>(cases.map((item) => [item.name, []]));
  // 预热（第一次请求有编译、连接的开销）
  for (const item of cases) await lookup(item.orderNo, item.email);
  for (let round = 0; round < 25; round += 1) {
    await resetLinkLimits(api);
    for (const item of round % 2 === 0 ? cases : [...cases].reverse()) {
      await site.app.backgroundIdle();
      const ip = nextIp();
      const started = performance.now();
      const res = await lookup(item.orderNo, item.email, ip);
      const elapsed = performance.now() - started;
      assert.equal(res.status, 202, `${item.name}：${res.text}`);
      samples.get(item.name)?.push(elapsed);
    }
  }
  await site.app.backgroundIdle();
  const medians = cases.map((item) => ({ name: item.name, median: median(samples.get(item.name) ?? []) }));
  t.diagnostic(medians.map((item) => `${item.name} ${item.median.toFixed(2)}ms`).join("；"));
  const fastest = Math.min(...medians.map((item) => item.median));
  const slowest = Math.max(...medians.map((item) => item.median));
  assert.ok(slowest - fastest <= 5 || slowest / fastest <= 1.5, `中位数差得太多：${JSON.stringify(medians)}`);
  await drain();
});

test("限速触发之后：存在的单、不存在的单、已取消的单、别的渠道的单被订单号额度挡下时，正文、完整应答头（含 Retry-After）、日志都一样，也不发信", async () => {
  const email = fictional("blocked");
  const live = await placeOrder(email);
  const cancelledEmail = fictional("blocked.cancel");
  const cancelled = await placeOrder(cancelledEmail);
  await ok(site.call("POST", "/site/v1/order/cancel", { token: cancelled.link.token, ip: nextIp(), body: {} }));
  const foreign = await foreignOrder();
  await drain();
  const targets = [
    { name: "存在（邮箱对）", orderNo: live.order.order_no, email },
    { name: "不存在", orderNo: "NZ20261007QABLOCK1", email: fictional("blocked.none") },
    { name: "已取消（邮箱对）", orderNo: cancelled.order.order_no, email: cancelledEmail },
    { name: "别的渠道的单", orderNo: foreign.order_no, email: "guest@example.com" },
  ];
  // 同一时刻把四个订单号都用满（每个都用不同的邮箱填满，邮箱维度不先挡）
  for (const target of targets) for (let i = 0; i < 3; i += 1) assert.equal((await lookup(target.orderNo, fictional(`fill${i}`))).status, 202);
  await drain();
  const blocked: { name: string; res: ApiResponse; logs: string[] }[] = [];
  for (const target of targets) blocked.push({ name: target.name, ...(await lookupWithLogs(target.orderNo, target.email)) });
  const base = blocked[0] as (typeof blocked)[number];
  assert.deepEqual([base.res.status, base.res.body?.error?.code], [429, "RATE_LIMITED"], base.res.text);
  assert.ok(Number(base.res.headers["retry-after"]) > 0, "有 Retry-After");
  for (const { name, res, logs } of blocked) {
    assert.equal(res.text, base.res.text, `${name}：429 正文一样`);
    assert.deepEqual(comparableHeaders(res.headers), comparableHeaders(base.res.headers), `${name}：429 应答头连值一样`);
    assert.deepEqual(logs, base.logs, `${name}：日志一样`);
  }
  await deliver();
  assert.equal(smtp.messages.length, 0, "被挡下的不发信");
});

test("格式不对的 400：存在的单和不存在的单正文、头一样；邮箱中间有空白、控制字符、超过 320 字、只填手机号都拒；400 不占订单号和邮箱的额度", async () => {
  const email = fictional("format");
  const live = await placeOrder(email);
  const bad = ["+81 90-3333-4444", "qa @example.test", "qa\u0000x@example.test", "qa x@example.test", `${"a".repeat(310)}@example.test`, "qa@example", ""];
  for (const value of bad) {
    const real = await lookup(live.order.order_no, value);
    const missing = await lookup("NZ20261007QAFORMAT", value);
    assert.deepEqual([real.status, real.body?.error?.code], [400, "VALIDATION_FAILED"], `${JSON.stringify(value)}：${real.text}`);
    assert.equal(missing.text, real.text, `${JSON.stringify(value)}：存在和不存在的单 400 正文一样`);
    assert.deepEqual(comparableHeaders(missing.headers), comparableHeaders(real.headers));
  }
  // 上面 14 次 400 没占这个订单号、这个邮箱的额度
  for (let i = 0; i < 3; i += 1) assert.equal((await lookup(live.order.order_no, email)).status, 202, `第 ${i + 1} 次`);
  await deliver();
  assert.equal(mailsTo(email).length, 3);
});

// ---------------------------------------------------------------------------------------------------------------
// 限速
// ---------------------------------------------------------------------------------------------------------------

test("并发：12 个不同地址同时查同一张单，只有 3 个 202、只发 3 封；12 个不同地址同时拿一个邮箱配 12 个订单号，也只有 3 个 202", async () => {
  const email = fictional("race");
  const live = await placeOrder(email);
  const sameOrder = await Promise.all(Array.from({ length: 12 }, () => lookup(live.order.order_no, email)));
  assert.deepEqual(
    sameOrder.map((res) => res.status).sort(),
    [202, 202, 202, 429, 429, 429, 429, 429, 429, 429, 429, 429],
  );
  await deliver();
  assert.equal(mailsTo(email).length, 3, "并发突破不了订单号的额度");

  const target = fictional("race.mailbox");
  const sameEmail = await Promise.all(Array.from({ length: 12 }, (_, i) => lookup(`NZ20261007QARACE${String(i).padStart(2, "0")}`, target)));
  assert.equal(sameEmail.filter((res) => res.status === 202).length, 3, "并发突破不了邮箱的额度");
});

test("轰炸一个邮箱：客人有 6 张单，攻击者知道订单号和邮箱，每小时换地址把每张单各查一次、连续 23 小时——这个邮箱一天最多收 10 封，每张单最多 6 封", async () => {
  const email = fictional("bomb");
  const orders = [];
  for (let i = 0; i < 6; i += 1) orders.push(await placeOrder(email));
  await drain();
  const start = api.clock.now().getTime();
  for (let hour = 0; hour < 23; hour += 1) {
    for (const [i, placed] of orders.entries()) await lookup(placed.order.order_no, i % 2 === 0 ? email : email.toUpperCase());
    await deliver();
    api.clock.advance(HOUR + 1_000);
  }
  assert.ok(api.clock.now().getTime() - start < DAY);
  const mails = mailsTo(email);
  assert.equal(mails.length, 10, `一天收到了 ${mails.length} 封（上限 10，额度内的照样发）`);
  for (const placed of orders) assert.ok(mails.filter((text) => text.includes(placed.order.order_no)).length <= 6);
});

test("被邮箱额度挡下的请求照样占了订单号的额度（顺序是地址 → 订单号 → 邮箱）：拿客人的邮箱连查，客人这张单这一小时也查不了（记录现状，见报告）", async () => {
  const email = fictional("burn");
  const placed = await placeOrder(email);
  await drain();
  // 攻击者先用这个邮箱配 3 个随便的订单号，把邮箱这一小时的额度用完
  for (let i = 0; i < 3; i += 1) assert.equal((await lookup(`NZ20261007QABURN0${i}`, email)).status, 202);
  const blocked = await lookup(placed.order.order_no, email);
  assert.equal(blocked.status, 429, "邮箱额度满了");
  await deliver();
  assert.equal(mailsTo(email).length, 0);
});

test("被地址额度挡下的 429 和被订单号额度挡下的 429 正文一样（客人从页面上分不出是哪一层）", async () => {
  const ip = nextIp();
  for (let i = 0; i < 10; i += 1) await lookup(`NZ20261007QAIPIP${String(i).padStart(2, "0")}`, fictional("ip"), ip);
  const byIp = await lookup("NZ20261007QAIPIP99", fictional("ip"), ip);
  for (let i = 0; i < 3; i += 1) await lookup("NZ20261007QAIPORD1", fictional("ord"));
  const byOrder = await lookup("NZ20261007QAIPORD1", fictional("ord"));
  assert.deepEqual([byIp.status, byOrder.status], [429, 429]);
  assert.equal(byIp.body.error.code, byOrder.body.error.code);
  assert.equal(byIp.body.error.message, byOrder.body.error.message);
});

test("邮件没配置时 503 不占订单号和邮箱的额度：配好之后客人马上能查 3 次", async () => {
  const email = fictional("nosmtp");
  const live = await placeOrder(email);
  const noSmtp = { SMTP_HOST: "", SMTP_PORT: "", SMTP_ENCRYPTION: "", SMTP_USERNAME: "", SMTP_PASSWORD: "", SMTP_FROM_NAME: "", SMTP_FROM_ADDRESS: "" };
  const unconfigured = await siteApi(api, siteClientId, pay, noSmtp, { integrationSecretsTtlMs: 0 });
  try {
    for (let i = 0; i < 4; i += 1) {
      const res = await unconfigured.call("POST", "/site/v1/orders/lookup", { ip: nextIp(), body: { order_no: live.order.order_no, email } });
      assert.deepEqual([res.status, res.body?.error?.code], [503, "ORDER_LINK_EMAIL_UNAVAILABLE"], res.text);
    }
  } finally {
    await unconfigured.close();
  }
  for (let i = 0; i < 3; i += 1) assert.equal((await lookup(live.order.order_no, email)).status, 202, `配好之后第 ${i + 1} 次`);
});

// ---------------------------------------------------------------------------------------------------------------
// 令牌
// ---------------------------------------------------------------------------------------------------------------

test("邮件里的链接：只能看这一单；能试算取消费、改备注、取消（和下单时的链接一样的权限）；邮件正文没有姓名、电话、地址、航班、金额、供应商", async () => {
  const email = fictional("token");
  const mine = await placeOrder(email);
  const neighbour = await placeOrder(fictional("token.other"));
  await drain();
  assert.equal((await lookup(mine.order.order_no, email)).status, 202);
  await deliver();
  const mail = mailsTo(email)[0] as string;
  const token = tokenIn(mail) as string;
  assert.ok(token, mail);
  for (const secret of [PASSENGER_NAME, PASSENGER_PHONE, "9033334444", DROPOFF_TEXT, "JL061", "甲车队", "乙车队", "成田", "商务", "JPY", "¥", "円", neighbour.order.order_no]) assert.equal(mail.includes(secret), false, `邮件里不该有 ${secret}`);
  assert.equal(mail.includes(mine.order.order_no), true);
  assert.match(mail, /以前收到的链接仍然可以使用/);

  const view = await ok(guestOrder(token));
  assert.equal(view.order.id, mine.order.id, "只对应这一张单");
  assert.notEqual(view.order.id, neighbour.order.id);
  assert.equal((await site.call("GET", "/site/v1/order/cancel-fee", { token, ip: nextIp() })).status, 200, "能试算取消费");
  const patched = await site.call("PATCH", "/site/v1/order", { token, ip: nextIp(), headers: { "if-match": `"${view.order.version}"` }, body: { notes: "QA：邮件链接改备注" } });
  assert.notEqual(patched.status, 401, `邮件链接能改单（M4-29 入口）：${patched.text}`);
  assert.notEqual(patched.status, 403, patched.text);
  assert.equal((await site.call("POST", "/site/v1/order/cancel", { token, ip: nextIp(), body: {} })).status, 200, "能取消");
  assert.equal((await guestOrder(mine.link.token)).status, 200, "下单时的链接仍有效");
  assert.equal((await guestOrder(neighbour.link.token)).body.order.id, neighbour.order.id);
});

test("令牌有效期：用车时间之后 30 天；用车时间早已过去时至少签发后 1 天，过了就 401；查订单换不到旧单的令牌之外的东西", async () => {
  const email = fictional("expiry");
  const service = futureTokyo(3);
  const placed = await placeOrder(email, service.local);
  await drain();
  // 用车时间之后 30 天：下单时的链接正好过期（边界前后各一次）
  api.clock.advance(Date.parse(service.iso) + 30 * DAY - 60_000 - api.clock.now().getTime());
  assert.equal((await guestOrder(placed.link.token)).status, 200, "用车时间之后 30 天内有效");
  api.clock.advance(120_000);
  assert.equal((await guestOrder(placed.link.token)).status, 401, "下单时的链接过期");
  assert.equal((await lookup(placed.order.order_no, email)).status, 202);
  await deliver();
  const token = tokenIn(mailsTo(email)[0] ?? "") as string;
  assert.ok(token, "用车时间过了一个月也照发（客人要看退款、加收）");
  assert.equal((await guestOrder(token)).status, 200);
  api.clock.advance(DAY - 60_000);
  assert.equal((await guestOrder(token)).status, 200, "签发后 1 天内有效");
  api.clock.advance(120_000);
  const expired = await guestOrder(token);
  assert.deepEqual([expired.status, expired.body.error.code], [401, "ORDER_LINK_INVALID"], "签发后 1 天过期");
  const row = await api.db.owner.query("select issued_via, expires_at from site_order_links where order_id = $1 order by created_at desc limit 1", [placed.order.id]);
  assert.equal(row.rows[0].issued_via, "email");
});

test("发件箱 24 小时：邮件服务一直发不出去，过了 24 小时这封不再发（晚一天才到的链接不如再申请一次）", async () => {
  const email = fictional("outbox");
  const placed = await placeOrder(email);
  await drain();
  assert.equal((await lookup(placed.order.order_no, email)).status, 202);
  await site.app.backgroundIdle();
  api.clock.advance(DAY + 60_000);
  await site.app.notificationJobs.tick();
  assert.equal(mailsTo(email).length, 0);
  const rows = await api.db.owner.query("select n.status from notifications n where n.order_id = $1 and n.event = 'order.view_link'", [placed.order.id]);
  assert.deepEqual(rows.rows.map((row) => row.status), ["expired"]);
});

test("令牌和邮箱不进官网日志、令牌不进库：查订单、发信、运营重发到原邮箱和新邮箱、审核的全过程；新邮箱有结论后从重发表清掉", async () => {
  const email = fictional("nolog");
  const placed = await placeOrder(email);
  await drain();
  const logStart = siteLogs.length;
  const apiLogStart = api.logs().length;
  assert.equal((await lookup(placed.order.order_no, email)).status, 202);
  await deliver();
  await ok(resend(placed.order.id, await login(cs.email), { target: "original", verification: "callback_phone", reason: "回拨下单电话确认是本人" }), 202);
  const fresh = fictional("nolog.new");
  const requested = await ok(resend(placed.order.id, await login(cs.email), NEW_EMAIL_BODY(fresh)), 202);
  const sealed = await api.db.owner.query("select recipient_enc from view_link_requests where approval_id = $1", [requested.approval.id]);
  assert.ok(sealed.rows[0].recipient_enc, "新邮箱有密文");
  for (const table of await tablesContaining(fresh)) assert.equal(table, "view_link_requests", `等审核期间新邮箱只能在重发表里，却出现在 ${table}`);
  await ok(api.call("POST", `/platform/v1/approvals/${requested.approval.id}/approve`, { token: await login(m.staff.operations.email), body: { note: "核实过" } }));
  await deliver();
  const tokens = smtp.messages.map((message) => tokenIn(decodedMailText(message.data))).filter((token): token is string => token !== null);
  assert.equal(tokens.length, 3, "查订单、重发原邮箱、重发新邮箱各一封");
  assert.equal(mailsTo(fresh).length, 1);
  const logs = siteLogs.slice(logStart) + api.logs().slice(apiLogStart);
  assert.ok(siteLogs.length > logStart, "官网应用确实开了日志");
  for (const secret of [email, fresh, ...tokens]) assert.equal(logs.toLowerCase().includes(secret.toLowerCase()), false, `日志里有 ${secret.slice(0, 12)}…`);
  for (const token of tokens) assert.deepEqual(await tablesContaining(token.slice(4)), [], "库里没有令牌原文");
  const row = await api.db.owner.query("select recipient, recipient_enc from view_link_requests where approval_id = $1", [requested.approval.id]);
  assert.deepEqual([row.rows[0].recipient, row.rows[0].recipient_enc], [null, null], "有结论后清掉");
  for (const table of await tablesContaining(fresh)) assert.notEqual(table, "view_link_requests");
});

test("乘客信息只存密文时（PASSENGER_PLAINTEXT_WRITE=false）：等审核期间整个库里搜不到新邮箱原文；批准、发信之后也搜不到", async () => {
  const strict = await siteApi(api, siteClientId, pay, { ...smtpEnv, PUBLIC_BASE_URL: "https://book.example.test", PASSENGER_PLAINTEXT_WRITE: "false" }, { integrationSecretsTtlMs: 0 });
  try {
    const placed = await placeOrder(fictional("strict"));
    const fresh = fictional("strict.new");
    const token = await login(cs.email);
    const requested = await strict.call("POST", `/platform/v1/orders/${placed.order.id}/view-link/resend`, { token, body: NEW_EMAIL_BODY(fresh) });
    assert.equal(requested.status, 202, requested.text);
    assert.deepEqual(await tablesContaining(fresh), [], "等审核期间库里没有新邮箱原文");
    const approved = await strict.call("POST", `/platform/v1/approvals/${requested.body.approval.id}/approve`, { token: await login(m.staff.operations.email), body: {} });
    assert.equal(approved.status, 200, approved.text);
    await strict.app.backgroundIdle();
    await strict.app.notificationJobs.tick();
    assert.equal(mailsTo(fresh).length, 1, "发到了新邮箱");
    assert.deepEqual(await tablesContaining(fresh), [], "批准、发信之后库里也没有新邮箱原文");
  } finally {
    await strict.close();
  }
});

// ---------------------------------------------------------------------------------------------------------------
// 运营核实后重发
// ---------------------------------------------------------------------------------------------------------------


async function customRole(grants: string[], scope: Record<string, unknown>): Promise<string> {
  const root = await login("root@platform.test");
  const created = await ok(api.call("POST", "/platform/v1/roles", { token: root, body: { name: `QA 链接 ${randomUUID().slice(0, 6)}`, grants, data_scope: scope } }), 201);
  const key = created.role?.key ?? created.key;
  const staff = await addStaff(api, root, `qa.role.${randomUUID().slice(0, 8)}@platform.test`, key);
  return platformLogin(api, staff.email);
}

test("审核权限：运营发起的，客服（不是发起人）也不能批；财务、风控、只读不能批；只给了「订单链接重发 · 编辑」的自建角色能发起、不能批", async () => {
  const placed = await placeOrder(fictional("review"));
  const fresh = fictional("review.new");
  const requested = await ok(resend(placed.order.id, await login(ops2.email), NEW_EMAIL_BODY(fresh)), 202);
  const approvalId = requested.approval.id;
  const finance = await addStaff(api, await login("root@platform.test"), `qa.fin.${randomUUID().slice(0, 6)}@platform.test`, "finance");
  const risk = await addStaff(api, await login("root@platform.test"), `qa.risk.${randomUUID().slice(0, 6)}@platform.test`, "risk");
  for (const [name, token] of [["客服", await login(cs.email)], ["财务", finance.token], ["风控", risk.token], ["只读", await login(m.staff.readonly.email)]] as const) {
    const res = await api.call("POST", `/platform/v1/approvals/${approvalId}/approve`, { token, body: {} });
    assert.ok([403, 404].includes(res.status), `${name}：${res.status} ${res.text}`);
  }
  const editOnly = await customRole(["orders:view", "order_view_link:view", "order_view_link:edit", "approvals:view"], { city_ids: null, channel_ids: null });
  assert.ok([403, 404].includes((await api.call("POST", `/platform/v1/approvals/${approvalId}/approve`, { token: editOnly, body: {} })).status), "只有编辑不能审核");
  await ok(api.call("POST", `/platform/v1/approvals/${approvalId}/withdraw`, { token: await login(ops2.email), body: {} }));
  const other = await placeOrder(fictional("review2"));
  const byCustom = await resend(other.order.id, editOnly, NEW_EMAIL_BODY(fictional("review2.new")));
  assert.equal(byCustom.status, 202, `自建角色能发起：${byCustom.text}`);
  const ordersEditOnly = await customRole(["orders:view", "orders:edit"], { city_ids: null, channel_ids: null });
  assert.equal((await resend(other.order.id, ordersEditOnly, { target: "original", verification: "callback_phone", reason: "x" })).status, 403, "只有「订单 · 编辑」没有这一格的不能重发");
  await deliver();
  assert.equal(mailsTo(fresh).length, 0);
});

test("数据范围：限定在大阪的运营角色，东京的单——看状态、重发、看复核、批准一律 404；限定在东京的可以", async () => {
  const placed = await placeOrder(fictional("scope"));
  const fresh = fictional("scope.new");
  const all = ["orders:view", "order_view_link:view", "order_view_link:edit", "order_view_link:review", "approvals:view"];
  const osaka = await customRole(all, { city_ids: [m.ids.osaka], channel_ids: null });
  const tokyo = await customRole(all, { city_ids: [m.ids.tokyo], channel_ids: null });
  assert.equal((await api.call("GET", `/platform/v1/orders/${placed.order.id}/view-link`, { token: osaka })).status, 404);
  assert.equal((await resend(placed.order.id, osaka, { target: "original", verification: "callback_phone", reason: "范围外" })).status, 404);
  const requested = await ok(resend(placed.order.id, await login(cs.email), NEW_EMAIL_BODY(fresh)), 202);
  assert.equal((await api.call("GET", `/platform/v1/approvals/${requested.approval.id}`, { token: osaka })).status, 404, "范围外看不到这条复核");
  const listed = await ok(api.call("GET", "/platform/v1/approvals?status=pending", { token: osaka }));
  assert.equal(JSON.stringify(listed).includes(requested.approval.id), false, "待审核列表里也没有");
  assert.equal((await api.call("POST", `/platform/v1/approvals/${requested.approval.id}/approve`, { token: osaka, body: {} })).status, 404, "范围外批不了");
  await deliver();
  assert.equal(mailsTo(fresh).length, 0);
  assert.equal((await api.call("GET", `/platform/v1/orders/${placed.order.id}/view-link`, { token: tokyo })).status, 200);
  await ok(api.call("POST", `/platform/v1/approvals/${requested.approval.id}/approve`, { token: tokyo, body: {} }));
  await deliver();
  assert.equal(mailsTo(fresh).length, 1, "范围内的同事批准后才发");
});

test("并发：两位客服同时对同一张单发起「发到新邮箱」，只有一条进审核；两位运营同时批准，只发一封", async () => {
  const placed = await placeOrder(fictional("race.review"));
  const a = fictional("race.a");
  const b = fictional("race.b");
  const [first, second] = await Promise.all([resend(placed.order.id, await login(cs.email), NEW_EMAIL_BODY(a)), resend(placed.order.id, await login(ops2.email), NEW_EMAIL_BODY(b))]);
  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, [202, 409], `${first.text} / ${second.text}`);
  const winner = first.status === 202 ? first : second;
  const loser = first.status === 202 ? second : first;
  assert.equal(loser.body.error.code, "VIEW_LINK_REVIEW_PENDING");
  const reviewer2 = await addStaff(api, await login("root@platform.test"), `qa.ops3.${randomUUID().slice(0, 6)}@platform.test`, "operations");
  const approvalId = winner.body.approval.id;
  // 两位都不是发起人（发起人是客服或 ops2）
  const approvers = [await login(m.staff.operations.email), reviewer2.token];
  const results = await Promise.all(approvers.map((token) => api.call("POST", `/platform/v1/approvals/${approvalId}/approve`, { token, body: {} })));
  assert.equal(results.filter((res) => res.status === 200).length, 1, results.map((res) => `${res.status} ${res.text}`).join(" / "));
  await deliver();
  assert.equal(mailsTo(a).length + mailsTo(b).length, 1, "只发一封");
  const events = await api.db.owner.query("select count(*)::int as n from notification_events where order_id = $1 and event = 'order.view_link'", [placed.order.id]);
  assert.equal(events.rows[0].n, 1);
});

test("批准前订单被脱敏：批准 409、整个回滚、不发；驳回后新邮箱清掉", async () => {
  const placed = await placeOrder(fictional("stale"));
  const fresh = fictional("stale.new");
  const requested = await ok(resend(placed.order.id, await login(cs.email), NEW_EMAIL_BODY(fresh)), 202);
  await anonymize(placed.order.id);
  const approve = await api.call("POST", `/platform/v1/approvals/${requested.approval.id}/approve`, { token: await login(m.staff.operations.email), body: {} });
  assert.equal(approve.status, 409, approve.text);
  const stillPending = await api.db.owner.query("select status, recipient_enc is not null as sealed from view_link_requests where approval_id = $1", [requested.approval.id]);
  assert.deepEqual([stillPending.rows[0].status, stillPending.rows[0].sealed], ["pending_review", true], "批准失败整个回滚");
  await ok(api.call("POST", `/platform/v1/approvals/${requested.approval.id}/reject`, { token: await login(m.staff.operations.email), body: { note: "已脱敏" } }));
  const cleared = await api.db.owner.query("select status, recipient, recipient_enc from view_link_requests where approval_id = $1", [requested.approval.id]);
  assert.deepEqual([cleared.rows[0].status, cleared.rows[0].recipient, cleared.rows[0].recipient_enc], ["dismissed", null, null]);
  await deliver();
  assert.equal(mailsTo(fresh).length, 0);
});

test("运营改了下单邮箱以后：用旧邮箱查订单不再发；用新邮箱查发到新邮箱；运营重发到原邮箱发到现在的邮箱", async () => {
  const oldEmail = fictional("change.old");
  const placed = await placeOrder(oldEmail, futureTokyo(10).local, { paid: true });
  await drain();
  const detail = await ok(api.call("GET", `/platform/v1/orders/${placed.order.id}`, { token: await login(m.staff.operations.email) }));
  const version = detail.order?.version ?? detail.version;
  const newEmail = fictional("change.new");
  const patched = await api.call("PATCH", `/platform/v1/orders/${placed.order.id}`, { token: await login(m.staff.operations.email), headers: { "if-match": `"${version}"` }, body: { passenger: { name: PASSENGER_NAME, phone: PASSENGER_PHONE, email: newEmail } } });
  assert.equal(patched.status, 200, patched.text);
  await drain();
  assert.equal((await lookup(placed.order.order_no, oldEmail)).status, 202);
  assert.equal((await lookup(placed.order.order_no, newEmail)).status, 202);
  await deliver();
  assert.equal(mailsTo(oldEmail).length, 0, "旧邮箱对不上了");
  assert.equal(mailsTo(newEmail).length, 1);
  await ok(resend(placed.order.id, await login(cs.email), { target: "original", verification: "callback_phone", reason: "回拨确认" }), 202);
  await deliver();
  assert.equal(mailsTo(oldEmail).length, 0);
  assert.equal(mailsTo(newEmail).length, 2);
});

// ---------------------------------------------------------------------------------------------------------------
// 隔离
// ---------------------------------------------------------------------------------------------------------------

/** 键名里有对外价、加价比例的（规则 4）。 */
function sellKeys(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((item, i) => sellKeys(item, `${path}[${i}]`));
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, item]) => [...(/sell|markup|guest_price|retail/i.test(key) ? [`${path}.${key}`] : []), ...sellKeys(item, `${path}.${key}`)]);
}

test("租户：通知列表里没有 order.view_link；订单详情和列表里没有重发记录、没有对外价和加价比例；拿不到运营的重发接口", async () => {
  const email = fictional("tenant");
  const placed = await placeOrder(email);
  await lookup(placed.order.order_no, email);
  await ok(resend(placed.order.id, await login(cs.email), { target: "original", verification: "callback_phone", reason: "回拨确认" }), 202);
  await deliver();
  for (const tenant of [m.a, m.b]) {
    const token = await tenantLogin(api, tenant.adminEmail);
    const notifications = await ok(api.call("GET", "/tenant/v1/notifications?limit=100", { token }));
    assert.equal(notifications.items.some((item: any) => item.event === "order.view_link"), false, "供应商看不到客人的订单链接邮件");
    const detail = await api.call("GET", `/tenant/v1/orders/${placed.order.id}`, { token });
    if (detail.status === 200) {
      assert.deepEqual(sellKeys(detail.body), [], "规则 4");
      assert.equal(/view_link|nzo_/.test(detail.text), false, "订单详情里没有链接和重发记录");
      assert.equal(detail.text.includes(email), false);
    } else assert.equal(detail.status, 404);
    for (const [method, path] of [["GET", `/platform/v1/orders/${placed.order.id}/view-link`], ["POST", `/platform/v1/orders/${placed.order.id}/view-link/resend`], ["GET", `/tenant/v1/orders/${placed.order.id}/view-link`]] as const) {
      const res = await api.call(method, path, { token, ...(method === "POST" ? { body: { target: "original", verification: "callback_phone", reason: "x" } } : {}) });
      assert.ok([401, 403, 404].includes(res.status), `${method} ${path}：${res.status}`);
    }
  }
  const list = await ok(api.call("GET", "/tenant/v1/orders?limit=50", { token: await tenantLogin(api, m.b.adminEmail) }));
  assert.deepEqual(sellKeys(list), []);
});

test("渠道 API 不受影响：渠道看自己的单照常，查订单对渠道的单不发信；渠道令牌调不了官网查订单之外的平台接口", async () => {
  const foreign = await other.paidOrder({ serviceTime: futureTokyo(10).iso });
  const token = await other.token();
  const res = await api.call("GET", `/sales/v1/orders/${foreign.id}`, { token });
  assert.equal(res.status, 200, res.text);
  assert.equal(/view_link/.test(res.text), false);
  assert.equal((await lookup(foreign.order_no, "guest@example.com")).status, 202);
  await deliver();
  assert.equal(mailsTo("guest@example.com").length, 0);
  assert.ok([401, 403].includes((await resend(foreign.id, token, { target: "original", verification: "callback_phone", reason: "x" })).status));
});
