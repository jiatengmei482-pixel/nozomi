/**
 * M4-31 测试角色：运营代改乘客邮箱要双人复核（ADR 0065）——绕过、批准时再核对、并发。真实 PostgreSQL + 本机假 SMTP，从不连真实的邮件服务。
 * - 绕过：PATCH 的各种写法（大小写、空白、全角、只改邮箱、和别的字段一起、`passenger` 只给一部分、多余的键、清空邮箱、版本不对、别的字段校验失败、
 *   履约字段被拒）都不能一个人改掉邮箱，失败时也不留下等审核的记录；其他能动乘客信息的平台接口逐个看过（只有 PATCH 会写乘客信息）。
 * - 批准时再核对：审核期间订单被取消、服务开始、被脱敏、渠道改过邮箱、客人改了又改回、救援转给别的供应商；
 * - 并发：两人同时批准、批准和驳回同时、批准和客人改邮箱同时、两人同时发起。
 * 全部是虚构数据，测试结束删掉整个 schema。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ANONYMIZED_PASSENGER } from "@nozomi/domain";
import { type ApiResponse, type TestApi, createTestApi } from "./testing/api.ts";
import { type FakeSmtp, decodedMailText, startFakeSmtp } from "./testing/fake-integrations.ts";
import { type Market, type Staff, addStaff, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { platformLogin, tenantLogin } from "./testing/money.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ADDRESS = { lng: 139.7, lat: 35.6 };
const NAME = "虚构乘客乙";
const PHONE = "+81 90-5555-6666";
const REVIEW = { verification: "callback_phone", reason: "客人来电说下单邮箱填错了，回拨下单电话确认是本人" };

let api: TestApi;
let m: Market;
let smtp: FakeSmtp;
let pay: FakePaymentProvider;
let site: SiteApi;
let other: SalesFlow;
let cs: Staff;
let ops2: Staff;
let ipSeq = 0;

const nextIp = (): string => {
  ipSeq += 1;
  return `10.${60 + Math.floor(ipSeq / 250)}.0.${(ipSeq % 250) + 1}`;
};
const fictional = (label: string): string => `qa31.${label}.${randomUUID().slice(0, 8)}@example.test`;

before(async () => {
  smtp = await startFakeSmtp();
  const smtpEnv = { SMTP_HOST: smtp.host, SMTP_PORT: String(smtp.port), SMTP_ENCRYPTION: "none", SMTP_USERNAME: "mailer", SMTP_PASSWORD: "fake-smtp-password-Qb8", SMTP_FROM_NAME: "NOZOMI", SMTP_FROM_ADDRESS: "noreply@example.test" };
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay, env: { ...smtpEnv, PUBLIC_BASE_URL: "https://book.example.test" }, integrationSecretsTtlMs: 0 });
  m = await buildMarket(api);
  const siteChannelId = (await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" })).id;
  const clientId = (await salesCredentials(api, m, siteChannelId)).clientId;
  site = await siteApi(api, clientId, pay, { ...smtpEnv, PUBLIC_BASE_URL: "https://book.example.test" }, { integrationSecretsTtlMs: 0 });
  other = await salesFlow(api, m, pay);
  const root = await platformLogin(api, "root@platform.test");
  cs = await addStaff(api, root, "qa31.cs@platform.test", "customer_service");
  ops2 = await addStaff(api, root, "qa31.ops2@platform.test", "operations");
});

after(async () => {
  await site?.close();
  await api?.close();
  await smtp?.close();
});

beforeEach(async () => {
  await drain();
});

const login = (email: string): Promise<string> => platformLogin(api, email);
const ops = (): Promise<string> => login(m.staff.operations.email);
const csToken = (): Promise<string> => login(cs.email);
const ops2Token = (): Promise<string> => login(ops2.email);

function futureTokyo(days: number): string {
  const date = new Date(api.clock.now().getTime() + 9 * HOUR + days * DAY).toISOString().slice(0, 10);
  return `${date}T10:00`;
}

/** 官网下单并付款（确认后的单才能改）。用车时间是现在（测试时钟）之后 10 天。 */
async function paidSiteOrder(email: string): Promise<{ order: any; token: string }> {
  api.clock.advance(1_000);
  const ip = nextIp();
  const quoted = await ok(site.call("POST", "/site/v1/quotes", { ip, body: { city_id: m.ids.tokyo, airport_id: m.ids.narita, direction: "pickup", address: ADDRESS, service_local: futureTokyo(10), passengers: 2, luggage: 1 } }));
  const quote = quoted.quotes.find((q: any) => q.vehicle_group.id === m.ids.biz7);
  assert.ok(quote, JSON.stringify(quoted));
  api.clock.advance(1_000);
  const created = await ok(
    site.call("POST", "/site/v1/orders", {
      ip,
      headers: { "idempotency-key": randomUUID() },
      body: { quote_id: quote.quote_id, passenger: { name: NAME, phone: PHONE, email }, flight_no: "NH211", dropoff_address: "虚构市虚构路二号", save_payment_method: true },
    }),
    201,
  );
  const intent = pay.intentOf(created.order.id);
  assert.ok(intent);
  pay.pay(intent.id);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
  const delivered = await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()));
  assert.equal(delivered.status, 200, JSON.stringify(delivered.body));
  await drain();
  return { order: created.order, token: created.link.token };
}

async function drain(): Promise<void> {
  await site.app.backgroundIdle();
  await api.app.backgroundIdle();
  for (let i = 0; i < 20; i += 1) {
    await api.app.notificationJobs.tick();
    const left = await api.db.owner.query("select count(*)::int as n from notifications where status = 'pending' and next_attempt_at <= $1", [api.clock.now()]);
    if (left.rows[0].n === 0) break;
  }
  smtp.reset();
}
async function deliver(): Promise<void> {
  await site.app.backgroundIdle();
  for (let i = 0; i < 5; i += 1) await api.app.notificationJobs.tick();
}
const mailsTo = (email: string): string[] => smtp.messages.filter((message) => message.to.some((to: string) => to.toLowerCase() === email.toLowerCase())).map((message) => decodedMailText(message.data));

async function detail(orderId: string): Promise<any> {
  return ok(api.call("GET", `/platform/v1/orders/${orderId}`, { token: await ops() }));
}
async function version(orderId: string): Promise<number> {
  return (await detail(orderId)).order.version;
}
async function platformPatch(orderId: string, token: string, body: unknown, ifMatch?: string): Promise<ApiResponse> {
  const v = ifMatch ?? `"${await version(orderId)}"`;
  api.clock.advance(1_000);
  return api.call("PATCH", `/platform/v1/orders/${orderId}`, { token, headers: { "if-match": v }, body });
}
async function emailOf(orderId: string): Promise<string> {
  return (await ok(api.call("POST", `/platform/v1/orders/${orderId}/passenger/reveal`, { token: await ops() }))).passenger.email;
}
const decide = (approvalId: string, decision: "approve" | "reject" | "withdraw", token: string, body: Record<string, unknown> = {}): Promise<ApiResponse> =>
  api.call("POST", `/platform/v1/approvals/${approvalId}/${decision}`, { token, body });

async function reviewRows(orderId: string): Promise<any[]> {
  return (await api.db.owner.query("select status, email, email_enc, previous_email, previous_email_enc, change_id, approval_id from passenger_email_changes where order_id = $1 order by created_at", [orderId])).rows;
}
async function emailApprovals(orderId: string): Promise<any[]> {
  return (await api.db.owner.query("select id, status from approvals where kind = 'order.passenger_email' and payload->>'order_id' = $1 order by requested_at", [orderId])).rows;
}
/** 这张单什么都没被一个人改掉：邮箱还是原来的，没有等审核的记录、没有复核，新地址没收到信。 */
async function untouched(orderId: string, email: string, fresh: string, where: string): Promise<void> {
  assert.equal(await emailOf(orderId), email, `${where}：邮箱被改掉了`);
  assert.deepEqual(await reviewRows(orderId), [], `${where}：不该留下等审核的记录`);
  assert.deepEqual(await emailApprovals(orderId), [], `${where}：不该发起复核`);
  await deliver();
  assert.equal(mailsTo(fresh).length, 0, `${where}：新地址收到了信`);
}

async function guestVersion(token: string): Promise<number> {
  return (await ok(site.call("GET", "/site/v1/order", { token, ip: nextIp() }))).order.version;
}
async function guestChangeEmail(token: string, email: string): Promise<ApiResponse> {
  const v = await guestVersion(token);
  api.clock.advance(1_000);
  return site.call("PATCH", "/site/v1/order", { token, ip: nextIp(), headers: { "if-match": `"${v}"` }, body: { passenger: { name: NAME, phone: PHONE, email } } });
}
/** 字母和数字换成全角（「@」「.」保留半角：全角的符号本来就通不过邮箱格式，见上面的用例） */
const fullwidth = (text: string): string => [...text].map((ch) => (/[A-Za-z0-9]/.test(ch) ? String.fromCharCode(ch.charCodeAt(0) + 0xfee0) : ch)).join("");

// ---------------------------------------------------------------------------------------------------------------
// 绕过
// ---------------------------------------------------------------------------------------------------------------

test("绕过：没写核实方式时，各种写法的新邮箱（原样、大写、首尾空白、全角、只给邮箱、和别的字段一起、三项都给）一律 400，邮箱不变、什么都不留下", async () => {
  const email = fictional("guest");
  const placed = await paidSiteOrder(email);
  const fresh = fictional("fresh");
  const token = await csToken();
  const variants: [string, unknown][] = [
    ["只给邮箱", { passenger: { email: fresh } }],
    ["大写", { passenger: { email: fresh.toUpperCase() } }],
    ["首尾空白", { passenger: { email: `  ${fresh}\t` } }],
    ["全角", { passenger: { email: fullwidth(fresh) } }],
    ["全角空格包着", { passenger: { email: `　${fresh}　` } }],
    ["三项都给", { passenger: { name: NAME, phone: PHONE, email: fresh } }],
    ["和备注一起", { passenger: { email: fresh }, notes: "顺便改备注" }],
    ["和姓名一起", { passenger: { name: "虚构新名", email: fresh } }],
    ["和人数一起", { passenger: { email: fresh }, passengers: 3 }],
    ["和即时通讯一起", { passenger: { phone: "+81 90-7777-8888", email: fresh }, messaging: { app: "line", handle: "qa31_line" } }],
  ];
  for (const [label, body] of variants) {
    const res = await platformPatch(placed.order.id, token, body);
    assert.equal(res.status, 400, `${label}：${res.status} ${res.text}`);
    assert.ok(res.body.error.details.issues.some((issue: any) => issue.path === "/email_review" || issue.path === "/passenger/email"), `${label}：${res.text}`);
  }
  const shown = await detail(placed.order.id);
  assert.equal(shown.order.notes, null, "校验失败时备注也没改");
  assert.equal(shown.order.passengers, 2);
  await untouched(placed.order.id, email, fresh, "没写核实方式");
});

test("绕过：请求体换个键名、多塞字段、类型不对、email_review 带多余的键或空原因、核实方式不在列表里——一律 400，邮箱不变", async () => {
  const email = fictional("guest");
  const placed = await paidSiteOrder(email);
  const fresh = fictional("fresh");
  const token = await csToken();
  const variants: [string, unknown][] = [
    ["顶层 email", { email: fresh }],
    ["顶层 passenger_email", { passenger_email: fresh }],
    ["passenger 里多一个键", { passenger: { email: fresh, email_verified: true }, email_review: REVIEW }],
    ["邮箱是数组", { passenger: { email: [fresh] }, email_review: REVIEW }],
    ["邮箱是对象", { passenger: { email: { value: fresh } }, email_review: REVIEW }],
    ["passenger 是空对象", { passenger: {}, email_review: REVIEW }],
    ["email_review 多一个 approved", { passenger: { email: fresh }, email_review: { ...REVIEW, approved: true } }],
    ["email_review 多一个 reviewer_id", { passenger: { email: fresh }, email_review: { ...REVIEW, reviewer_id: m.staff.operations.id } }],
    ["email_review 原因是空白", { passenger: { email: fresh }, email_review: { verification: "callback_phone", reason: "   " } }],
    ["email_review 没有原因", { passenger: { email: fresh }, email_review: { verification: "callback_phone" } }],
    ["核实方式不在列表里", { passenger: { email: fresh }, email_review: { verification: "none", reason: "x" } }],
    ["email_review 是 true", { passenger: { email: fresh }, email_review: true }],
    ["email_review 是 null", { passenger: { email: fresh }, email_review: null }],
    ["没改邮箱却写了 email_review", { notes: "只改备注", email_review: REVIEW }],
    ["顶层多一个 skip_review", { passenger: { email: fresh }, skip_review: true }],
    ["请求体是数组", [{ passenger: { email: fresh } }]],
  ];
  for (const [label, body] of variants) {
    const res = await platformPatch(placed.order.id, token, body);
    assert.equal(res.status, 400, `${label}：${res.status} ${res.text}`);
  }
  assert.equal((await detail(placed.order.id)).order.notes, null);
  await untouched(placed.order.id, email, fresh, "请求体变形");
});

test("绕过：清空邮箱、写成占位或明显不是邮箱的——不能一个人把邮箱改成空（客人从此收不到信）", async () => {
  const email = fictional("guest");
  const placed = await paidSiteOrder(email);
  const token = await csToken();
  for (const [label, value] of [["空字符串", ""], ["只有空白", "   "], ["不是邮箱", "not-an-email"], ["两个地址", `${email},qa31.other@example.test`], ["两个地址分号", `${email};qa31.other@example.test`], ["全角＠的原邮箱", email.replace("@", "\uff20")]] as const) {
    for (const body of [{ passenger: { email: value } }, { passenger: { email: value }, email_review: REVIEW }]) {
      const res = await platformPatch(placed.order.id, token, body);
      assert.equal(res.status, 400, `${label}：${res.status} ${res.text}`);
    }
  }
  assert.equal(await emailOf(placed.order.id), email);
  assert.deepEqual(await reviewRows(placed.order.id), []);
});

test("同一个收件箱的不同写法（大小写、首尾空白、全角）直接生效、不发起复核；收件箱按盲索引的口径仍是原来那个，查订单用原邮箱照样能收到信", async () => {
  const email = fictional("guest");
  const placed = await paidSiteOrder(email);
  const token = await csToken();
  for (const [label, value] of [["大写", email.toUpperCase()], ["首尾空白", ` ${email} `], ["全角", fullwidth(email)]] as const) {
    const res = await platformPatch(placed.order.id, token, { passenger: { email: value }, notes: `改写法：${label}` });
    assert.equal(res.status, 200, `${label}：${res.text}`);
    assert.equal(res.body.email_review, null, `${label}：同一个收件箱不用复核`);
    assert.equal((await emailOf(placed.order.id)).normalize("NFKC").trim().toLowerCase(), email.toLowerCase(), label);
  }
  assert.deepEqual(await emailApprovals(placed.order.id), []);
  // 盲索引口径不变：客人用原来的写法查订单，链接照样发到这张单上的地址
  api.clock.advance(1_000);
  const lookup = await site.call("POST", "/site/v1/orders/lookup", { ip: nextIp(), body: { order_no: placed.order.order_no, email } });
  assert.equal(lookup.status, 202, lookup.text);
  await deliver();
  assert.equal(smtp.messages.length >= 1, true, "查订单的信发出去了");
});

test("同一个收件箱的写法 + 写了 email_review：ADR 说「没改邮箱却写了 400 NOT_APPLICABLE」——同一收件箱算没改，也应 400，不能悄悄忽略", async () => {
  const email = fictional("guest");
  const placed = await paidSiteOrder(email);
  const res = await platformPatch(placed.order.id, await csToken(), { passenger: { email: email.toUpperCase() }, notes: "写法不同", email_review: REVIEW });
  assert.equal(res.status, 400, `同一个收件箱却写了核实方式：${res.status} ${res.text}`);
});

test("同一次提交失败（版本不对、别的字段校验失败、人数超过车型、订单已取消）：整个回滚，不留下等审核的记录、不发起复核", async () => {
  const email = fictional("guest");
  const placed = await paidSiteOrder(email);
  const fresh = fictional("fresh");
  const token = await csToken();
  const stale = await platformPatch(placed.order.id, token, { passenger: { email: fresh }, email_review: REVIEW }, `"${(await version(placed.order.id)) - 1}"`);
  assert.ok([409, 412].includes(stale.status), `版本不对：${stale.text}`);
  const badPhone = await platformPatch(placed.order.id, token, { passenger: { phone: "12", email: fresh }, email_review: REVIEW });
  assert.equal(badPhone.status, 400, badPhone.text);
  const badName = await platformPatch(placed.order.id, token, { passenger: { name: "名".repeat(101), email: fresh }, email_review: REVIEW });
  assert.equal(badName.status, 400, badName.text);
  const tooMany = await platformPatch(placed.order.id, token, { passengers: 40, passenger: { email: fresh }, email_review: REVIEW });
  assert.ok(tooMany.status >= 400 && tooMany.status < 500, `人数超过车型：${tooMany.text}`);
  await untouched(placed.order.id, email, fresh, "同一次提交失败");

  await ok(site.call("POST", "/site/v1/order/cancel", { token: placed.token, ip: nextIp(), body: {} }));
  const cancelled = await platformPatch(placed.order.id, token, { passenger: { email: fresh }, email_review: REVIEW });
  assert.equal(cancelled.status, 409, `已取消的单：${cancelled.text}`);
  await untouched(placed.order.id, email, fresh, "已取消的单");
});

test("等审核期间：同一个新邮箱的另一种写法、另一个新邮箱都不能再发起（409 PASSENGER_EMAIL_REVIEW_PENDING）；改回原邮箱的写法不算改；别的字段照改", async () => {
  const email = fictional("guest");
  const placed = await paidSiteOrder(email);
  const fresh = fictional("fresh");
  const first = await ok(platformPatch(placed.order.id, await csToken(), { passenger: { email: fresh }, email_review: REVIEW }), 202);
  for (const value of [fresh.toUpperCase(), fictional("another")]) {
    const res = await platformPatch(placed.order.id, await ops2Token(), { passenger: { email: value }, email_review: REVIEW });
    assert.deepEqual([res.status, res.body.error?.code], [409, "PASSENGER_EMAIL_REVIEW_PENDING"], res.text);
    assert.equal(res.body.error.details.approval_id, first.email_review.approval_id);
  }
  const same = await platformPatch(placed.order.id, await ops2Token(), { passenger: { name: "虚构改名", email: ` ${email.toUpperCase()} ` } });
  assert.equal(same.status, 200, same.text);
  assert.equal(same.body.email_review, null);
  assert.equal((await reviewRows(placed.order.id)).length, 1);
});

test("其他能动乘客信息的平台接口：取消、事件代传、发到新邮箱（M4-30）、救援人工指定都不收乘客邮箱（多给 passenger 一律 400）", async () => {
  const email = fictional("guest");
  const placed = await paidSiteOrder(email);
  const fresh = fictional("fresh");
  const token = await ops();
  const passenger = { name: NAME, phone: PHONE, email: fresh };
  const attempts: [string, string][] = [
    ["取消", `/platform/v1/orders/${placed.order.id}/cancel`],
    ["事件代传", `/platform/v1/orders/${placed.order.id}/events`],
    ["重发订单链接", `/platform/v1/orders/${placed.order.id}/view-link/resend`],
    ["救援", `/platform/v1/orders/${placed.order.id}/rescue`],
    ["人工指定", `/platform/v1/orders/${placed.order.id}/rescue/manual-assign`],
    ["查看乘客", `/platform/v1/orders/${placed.order.id}/passenger/reveal`],
  ];
  for (const [label, url] of attempts) {
    const res = await api.call("POST", url, { token, body: { passenger, email: fresh } });
    assert.ok([400, 403, 404, 409, 428].includes(res.status) || label === "查看乘客", `${label}：${res.status} ${res.text}`);
  }
  assert.equal(await emailOf(placed.order.id), email);
  await deliver();
  assert.equal(mailsTo(fresh).length, 0);
});

// ---------------------------------------------------------------------------------------------------------------
// 批准时再核对
// ---------------------------------------------------------------------------------------------------------------

async function requestReview(orderId: string, fresh: string, token?: string): Promise<string> {
  const res = await ok(platformPatch(orderId, token ?? (await csToken()), { passenger: { email: fresh }, email_review: REVIEW }), 202);
  return res.email_review.approval_id;
}

async function staleThenReject(approvalId: string, orderId: string, expectEmail: string, fresh: string, reason: string): Promise<void> {
  const res = await decide(approvalId, "approve", await ops());
  assert.deepEqual([res.status, res.body.error?.code], [409, "APPROVAL_STALE"], res.text);
  assert.equal(res.body.error.details.reason, reason, res.text);
  assert.equal(res.text.includes(fresh), false, "错误里没有新邮箱原文");
  const still = (await reviewRows(orderId))[0];
  assert.equal(still.status, "pending_review", "批准失败整个回滚，仍在等");
  await ok(decide(approvalId, "reject", await ops(), { note: "情况变了" }));
  const closed = (await reviewRows(orderId))[0];
  assert.deepEqual([closed.status, closed.email, closed.email_enc, closed.previous_email, closed.previous_email_enc], ["dismissed", null, null, null, null], "驳回后清空");
  if (expectEmail !== "") assert.equal(await emailOf(orderId), expectEmail);
  await deliver();
  assert.equal(mailsTo(fresh).length, 0, "新地址一封都没收到");
}

test("批准时再核对：审核期间订单被客人取消——批准 409（ORDER_STATE_INVALID），邮箱不变、新地址不收信；驳回清空", async () => {
  const email = fictional("guest");
  const placed = await paidSiteOrder(email);
  const fresh = fictional("fresh");
  const approvalId = await requestReview(placed.order.id, fresh);
  await ok(site.call("POST", "/site/v1/order/cancel", { token: placed.token, ip: nextIp(), body: {} }));
  await drain();
  await staleThenReject(approvalId, placed.order.id, email, fresh, "ORDER_STATE_INVALID");
});

test("批准时再核对：审核期间服务已开始（in_service）、已完成——批准 409，邮箱不变", async () => {
  for (const status of ["in_service", "completed"]) {
    const email = fictional(`guest.${status}`);
    const placed = await paidSiteOrder(email);
    const fresh = fictional(`fresh.${status}`);
    const approvalId = await requestReview(placed.order.id, fresh);
    await api.db.owner.query("update orders set status = $2 where id = $1 and rescued_at is null", [placed.order.id, status]);
    await staleThenReject(approvalId, placed.order.id, email, fresh, "ORDER_STATE_INVALID");
  }
});

test("批准时再核对：司机已出发、已到达（服务还没开始）——仍能改联系信息，批准生效", async () => {
  const email = fictional("guest.departed");
  const placed = await paidSiteOrder(email);
  const fresh = fictional("fresh.departed");
  const approvalId = await requestReview(placed.order.id, fresh);
  await api.db.owner.query("update orders set status = 'departed' where id = $1 and rescued_at is null", [placed.order.id]);
  await ok(decide(approvalId, "approve", await ops()));
  assert.equal(await emailOf(placed.order.id), fresh);
});

test("批准时再核对：审核期间被脱敏——批准 409（PASSENGER_ANONYMIZED），不把新邮箱写回已脱敏的单；驳回清空", async () => {
  const email = fictional("guest");
  const placed = await paidSiteOrder(email);
  const fresh = fictional("fresh");
  const approvalId = await requestReview(placed.order.id, fresh);
  await api.db.owner.query(
    "update orders set passenger = $2::jsonb, passenger_anonymized_at = now(), passenger_enc = null, passenger_email_bidx = null, passenger_phone_bidx = null, passenger_name_bidx = null where id = $1",
    [placed.order.id, JSON.stringify(ANONYMIZED_PASSENGER)],
  );
  await staleThenReject(approvalId, placed.order.id, "", fresh, "PASSENGER_ANONYMIZED");
  const row = (await api.db.owner.query("select passenger, passenger_enc from orders where id = $1", [placed.order.id])).rows[0];
  assert.deepEqual(row.passenger, ANONYMIZED_PASSENGER);
  assert.equal(row.passenger_enc, null);
});

test("批准时再核对：客人审核期间改了邮箱又改回原来的——批准照样生效（按地址比，不按次数）；记录在案的行为", async () => {
  const email = fictional("guest");
  const placed = await paidSiteOrder(email);
  const fresh = fictional("fresh");
  const approvalId = await requestReview(placed.order.id, fresh);
  assert.equal((await guestChangeEmail(placed.token, fictional("detour"))).status, 200);
  assert.equal((await guestChangeEmail(placed.token, email.toUpperCase())).status, 200);
  await ok(decide(approvalId, "approve", await ops()));
  assert.equal(await emailOf(placed.order.id), fresh);
});

test("批准时再核对：渠道的单，审核期间渠道替客人改过邮箱——批准 409（EMAIL_CHANGED_SINCE_REQUEST），保留渠道填的", async () => {
  const order = await other.paidOrder();
  const original = await emailOf(order.id);
  const fresh = fictional("fresh.channel");
  const approvalId = await requestReview(order.id, fresh);
  const salesToken = await other.token();
  const v = (await ok(api.call("GET", `/sales/v1/orders/${order.id}`, { token: salesToken }))).order.version;
  const byChannel = fictional("by.channel");
  api.clock.advance(1_000);
  await ok(api.call("PATCH", `/sales/v1/orders/${order.id}`, { token: salesToken, headers: { "if-match": `"${v}"` }, body: { passenger: { name: "王小明", phone: "+819012345678", email: byChannel } } }));
  assert.notEqual(original, byChannel);
  await staleThenReject(approvalId, order.id, byChannel, fresh, "EMAIL_CHANGED_SINCE_REQUEST");
});

test("批准时再核对：审核期间订单被救援转给别的供应商——批准后改到现在那一行上（新供应商），新地址收到通知；原供应商那一行不动", async () => {
  const email = fictional("guest.rescue");
  const placed = await paidSiteOrder(email);
  const fresh = fictional("fresh.rescue");
  const approvalId = await requestReview(placed.order.id, fresh);
  const tenantB = await tenantLogin(api, m.b.adminEmail);
  const declared = await api.call("POST", `/tenant/v1/orders/${placed.order.id}/declare-unable`, { token: tenantB, body: { reason: "车辆故障，排不出车" } });
  assert.equal(declared.status, 200, declared.text);
  // 救援中（rescue_pending）：不能改乘客信息
  const during = await decide(approvalId, "approve", await ops());
  assert.deepEqual([during.status, during.body.error?.code], [409, "APPROVAL_STALE"], during.text);
  const manual = await ok(api.call("POST", `/platform/v1/orders/${placed.order.id}/rescue/manual-assign`, { token: await ops(), body: { tenant_id: m.a.tenantId, product_id: m.ids.pa, settlement_amount: 25_000, note: "电话联系甲，同意接" } }), 202);
  await ok(decide(manual.approval.id, "approve", await login("root@platform.test")));
  const rescued = await detail(placed.order.id);
  assert.equal(rescued.order.tenant.id, m.a.tenantId);
  await drain();
  const approved = await decide(approvalId, "approve", await ops());
  assert.equal(approved.status, 200, `救援后批准：${approved.text}`);
  assert.equal(await emailOf(placed.order.id), fresh);
  const rows = (await api.db.owner.query("select tenant_id, status, passenger_email_bidx from orders where id = $1 order by created_at", [placed.order.id])).rows;
  assert.ok(rows.length >= 1);
  await deliver();
  assert.equal(mailsTo(fresh).length, 1, "救援后批准：新地址收到订单修改的通知");
  assert.equal(mailsTo(email).length, 0);
  // 新供应商看到的是新邮箱；原供应商读不到这张单的新邮箱
  const tenantA = await tenantLogin(api, m.a.adminEmail);
  const forA = await api.call("GET", `/tenant/v1/orders/${placed.order.id}`, { token: tenantA });
  assert.equal(forA.status, 200, forA.text);
  const forB = await api.call("GET", `/tenant/v1/orders/${placed.order.id}`, { token: tenantB });
  assert.equal(forB.text.includes(fresh), false, "原供应商看不到新邮箱");
});

// ---------------------------------------------------------------------------------------------------------------
// 并发
// ---------------------------------------------------------------------------------------------------------------

test("并发：两位运营同时批准——只有一个成功，订单只改一次、只记一条改单、新地址只收到一封", async () => {
  const email = fictional("guest");
  const placed = await paidSiteOrder(email);
  const fresh = fictional("fresh");
  const approvalId = await requestReview(placed.order.id, fresh);
  const [a, b] = await Promise.all([decide(approvalId, "approve", await ops()), decide(approvalId, "approve", await ops2Token())]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], `${a.text} / ${b.text}`);
  assert.equal(await emailOf(placed.order.id), fresh);
  const changes = await api.db.owner.query("select count(*)::int as n from order_changes where order_id = $1", [placed.order.id]);
  assert.equal(changes.rows[0].n, 1);
  assert.equal((await reviewRows(placed.order.id))[0].status, "applied");
  await deliver();
  assert.equal(mailsTo(fresh).length, 1);
});

test("并发：批准和驳回同时——结果一致（复核记录、等审核的记录、订单邮箱三者对得上），新地址只在批准赢的时候收信", async () => {
  for (let round = 0; round < 3; round += 1) {
    const email = fictional(`guest.${round}`);
    const placed = await paidSiteOrder(email);
    const fresh = fictional(`fresh.${round}`);
    const approvalId = await requestReview(placed.order.id, fresh);
    const [approve, reject] = await Promise.all([decide(approvalId, "approve", await ops()), decide(approvalId, "reject", await ops2Token(), { note: "并发驳回" })]);
    assert.equal([approve.status, reject.status].filter((s) => s === 200).length, 1, `${approve.text} / ${reject.text}`);
    const approval = (await api.db.owner.query("select status from approvals where id = $1", [approvalId])).rows[0].status;
    const row = (await reviewRows(placed.order.id))[0];
    const current = await emailOf(placed.order.id);
    if (approve.status === 200) assert.deepEqual([approval, row.status, current], ["approved", "applied", fresh]);
    else assert.deepEqual([approval, row.status, current], ["rejected", "dismissed", email]);
    assert.equal(row.email, null);
    await deliver();
    assert.equal(mailsTo(fresh).length, approve.status === 200 ? 1 : 0);
  }
});

test("并发：批准和客人自己改邮箱同时——不会出现客人刚填的地址被代改的覆盖；两者最多一个生效", async () => {
  for (let round = 0; round < 3; round += 1) {
    const email = fictional(`guest.race${round}`);
    const placed = await paidSiteOrder(email);
    const fresh = fictional(`fresh.race${round}`);
    const guest = fictional(`self.race${round}`);
    const approvalId = await requestReview(placed.order.id, fresh);
    const v = await guestVersion(placed.token);
    const [approve, self] = await Promise.all([
      decide(approvalId, "approve", await ops()),
      site.call("PATCH", "/site/v1/order", { token: placed.token, ip: nextIp(), headers: { "if-match": `"${v}"` }, body: { passenger: { name: NAME, phone: PHONE, email: guest } } }),
    ]);
    const current = await emailOf(placed.order.id);
    if (approve.status === 200 && self.status === 200) assert.fail(`两个都成功了：最后是 ${current === fresh ? "代改的" : "客人的"}`);
    if (self.status === 200) {
      assert.equal(current, guest, "客人改成功了，邮箱就是客人填的");
      assert.equal(approve.status, 409, approve.text);
    } else {
      assert.equal(approve.status, 200, `${approve.text} / ${self.text}`);
      assert.equal(current, fresh);
      assert.ok([409, 412].includes(self.status), self.text);
    }
  }
});

test("并发：两人同时对同一张单发起改邮箱——只有一条在等，另一个 409", async () => {
  const email = fictional("guest");
  const placed = await paidSiteOrder(email);
  const v = `"${await version(placed.order.id)}"`;
  const [a, b] = await Promise.all([
    api.call("PATCH", `/platform/v1/orders/${placed.order.id}`, { token: await csToken(), headers: { "if-match": v }, body: { passenger: { email: fictional("one") }, email_review: REVIEW } }),
    api.call("PATCH", `/platform/v1/orders/${placed.order.id}`, { token: await ops2Token(), headers: { "if-match": v }, body: { passenger: { email: fictional("two") }, email_review: REVIEW } }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [202, 409], `${a.text} / ${b.text}`);
  assert.equal((await reviewRows(placed.order.id)).length, 1);
  assert.equal((await emailApprovals(placed.order.id)).length, 1, "失败的那个不留下复核");
});
