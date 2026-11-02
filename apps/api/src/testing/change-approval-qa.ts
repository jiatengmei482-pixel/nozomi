/**
 * M4-29 测试角色共用的搭建（ADR 0060）：真实 PostgreSQL + 本机假 SMTP，收款服务用替身。数据全部在测试里构造，都是虚构的，随测试 schema 一起删除。
 * 只被 `change-approval-*.qa.itest.ts` 使用。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { applyBasisPoints } from "@nozomi/domain";
import { type ApiResponse, type TenantFixture, type TestApi, createTestApi } from "./api.ts";
import { assign, newDriver, newVehicle } from "./dispatch.ts";
import { type FakeSmtp, type FakeSmtpMessage, decodedMailText, startFakeSmtp } from "./fake-integrations.ts";
import { type Market, buildMarket, ok } from "./market.ts";
import { platformLogin, tenantLogin } from "./money.ts";
import { FakePaymentProvider } from "./payments.ts";
import { type SalesFlow, salesFlow } from "./sales-flow.ts";

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const MINUTE = 60_000;
/** 乙的商务 7 座 19,800 → 对外价 21,780（默认加价 10%）；调价日 +20% → 23,760 → 26,136 */
export const SETTLE = 19_800;
export const SURGE_SETTLE = 23_760;
export const SELL = applyBasisPoints(SETTLE, 1_000);
export const SURGE_SELL = applyBasisPoints(SURGE_SETTLE, 1_000);
export const GUEST_NAME = "王小明";
export const GUEST_PHONE = "+819012345678";
export const GUEST_EMAIL = "guest@example.com";

export const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
export const tokyoDate = (ms: number): string => new Date(ms + 9 * HOUR).toISOString().slice(0, 10);
export const tokenInMail = (text: string): string | null => /\/driver#(nzd_[A-Za-z0-9_.-]+)/.exec(text)?.[1] ?? null;
export const fictionalEmail = (): string => `fictional.driver.${randomUUID().slice(0, 8)}@example.test`;

export interface World {
  api: TestApi;
  m: Market;
  pay: FakePaymentProvider;
  flow: SalesFlow;
  smtp: FakeSmtp;
  /** 中标的供应商（乙） */
  b: TenantFixture;
  /** 另一家（甲） */
  a: TenantFixture;
  ops(): Promise<string>;
  /** 东京 10:00，下一个还没用过的日子：每次调用往后 3 天，彼此不碰调价日和库存 */
  freshDay(): number;
  relogin(): Promise<void>;
  tick(): Promise<unknown>;
  texts(mails: readonly FakeSmtpMessage[]): string;
  mailsTo(email: string): FakeSmtpMessage[];
  dispatched(serviceMs?: number, driverExtra?: Record<string, unknown>): Promise<{ order: any; driver: any; vehicle: any; email: string; token: string }>;
  salesGet(orderId: string): Promise<any>;
  patch(orderId: string, body: Record<string, unknown>): Promise<ApiResponse>;
  tenantDecide(orderId: string, changeId: string, decision: "confirm" | "reject" | "adjusting", body?: Record<string, unknown>, token?: string): Promise<ApiResponse>;
  platformDecide(orderId: string, changeId: string, decision: "confirm" | "reject" | "adjusting", note?: string, token?: string): Promise<ApiResponse>;
  salesCancel(orderId: string, body?: Record<string, unknown>): Promise<ApiResponse>;
  todosOf(orderId: string, token?: string): Promise<any[]>;
  surge(day: string): Promise<void>;
  limited(days: readonly string[], total?: number): Promise<void>;
  unlimited(): Promise<void>;
  sold(day: string): Promise<number>;
  /** 收款服务那边：这张单收到手的钱 − 退回去的钱 */
  net(orderId: string): number;
  /** 这张单每种事件进了发件箱几次（`like`） */
  events(orderId: string, like?: string): Promise<Record<string, number>>;
  notificationRows(orderId: string, audience: string, event: string): Promise<any[]>;
  close(): Promise<void>;
}

export async function buildWorld(options: { env?: Record<string, string>; fx?: { quote: (from: any, to: any, at: Date) => Promise<any> } } = {}): Promise<World> {
  const smtp = await startFakeSmtp();
  const pay = new FakePaymentProvider();
  const api = await createTestApi({
    payments: pay,
    env: { SMTP_HOST: smtp.host, SMTP_PORT: String(smtp.port), SMTP_ENCRYPTION: "none", SMTP_USERNAME: "mailer", SMTP_PASSWORD: "fake-smtp-password-Qa9", SMTP_FROM_NAME: "NOZOMI", SMTP_FROM_ADDRESS: "noreply@example.test", ...options.env },
    integrationSecretsTtlMs: 0,
    ...(options.fx === undefined ? {} : { quote: { fx: options.fx } }),
  });
  const m = await buildMarket(api);
  const flow = await salesFlow(api, m, pay);
  const b: TenantFixture = { ...m.b, adminToken: await tenantLogin(api, m.b.adminEmail) };
  const a: TenantFixture = { ...m.a, adminToken: await tenantLogin(api, m.a.adminEmail) };
  let dayCursor = 5;

  const relogin = async (): Promise<void> => {
    b.adminToken = await tenantLogin(api, m.b.adminEmail);
    a.adminToken = await tenantLogin(api, m.a.adminEmail);
  };
  const tick = () => api.app.notificationJobs.tick();
  const mailsTo = (email: string): FakeSmtpMessage[] => smtp.messages.filter((mail) => mail.to.includes(email));
  const texts = (mails: readonly FakeSmtpMessage[]): string => mails.map((mail) => decodedMailText(mail.data)).join("\n");
  const freshDay = (): number => {
    dayCursor += 3;
    return Math.ceil(api.clock.now().getTime() / DAY) * DAY + HOUR + dayCursor * DAY;
  };
  const salesGet = async (orderId: string): Promise<any> => {
    api.clock.advance(1_000);
    return (await ok(api.call("GET", `/sales/v1/orders/${orderId}`, { token: await flow.token() }))).order;
  };
  const world: World = {
    api,
    m,
    pay,
    flow,
    smtp,
    b,
    a,
    ops: () => platformLogin(api, m.staff.operations.email),
    freshDay,
    relogin,
    tick,
    texts,
    mailsTo,
    salesGet,
    async dispatched(serviceMs = freshDay(), driverExtra) {
      const order = await flow.paidOrder({ serviceTime: iso(serviceMs) });
      const email = fictionalEmail();
      const driver = await newDriver(api, b, driverExtra ?? { email });
      const vehicle = await newVehicle(api, b, m.ids.biz7);
      const res = await ok(assign(api, b, order.id, driver.id, vehicle.id));
      await tick();
      smtp.reset();
      return { order, driver, vehicle, email, token: res.driver_link.token };
    },
    async patch(orderId, body) {
      const version = (await salesGet(orderId)).version;
      api.clock.advance(1_000);
      return api.call("PATCH", `/sales/v1/orders/${orderId}`, { token: await flow.token(), headers: { "if-match": `"${version}"` }, body });
    },
    tenantDecide: (orderId, changeId, decision, body = {}, token = b.adminToken) => api.call("POST", `/tenant/v1/orders/${orderId}/changes/${changeId}/${decision}`, { token, body }),
    platformDecide: async (orderId, changeId, decision, note = "电话联系过供应商", token) => api.call("POST", `/platform/v1/orders/${orderId}/changes/${changeId}/${decision}`, { token: token ?? (await platformLogin(api, m.staff.operations.email)), body: { note } }),
    salesCancel: async (orderId, body = {}) => api.call("POST", `/sales/v1/orders/${orderId}/cancel`, { token: await flow.token(), body }),
    async todosOf(orderId, token = b.adminToken) {
      return (await ok(api.call("GET", "/tenant/v1/order-todos", { token }))).items.filter((item: any) => item.order_id === orderId);
    },
    async surge(day) {
      const version = (await ok(api.call("GET", `/tenant/v1/products/${m.ids.pb}`, { token: b.adminToken }))).version;
      await ok(api.call("POST", `/tenant/v1/products/${m.ids.pb}/adjust-rules`, { token: b.adminToken, headers: { "if-match": `"${version}"`, "idempotency-key": randomUUID() }, body: { name: `QA ${day}`, travel_from: day, travel_to: day, cycle: { type: "daily" }, vehicle_group_ids: [m.ids.biz7], steps: [{ type: "percent", value: 2_000 }] } }), 201);
    },
    async limited(days, total = 5) {
      await api.db.owner.query("update products set inventory_mode = 'limited' where id = $1", [m.ids.pb]);
      for (const day of days) await api.db.owner.query("insert into inventory_days (tenant_id, product_id, day, total, created_at, updated_at) values ($1, $2, $3, $4, now(), now()) on conflict do nothing", [b.tenantId, m.ids.pb, day, total]);
    },
    async unlimited() {
      await api.db.owner.query("update products set inventory_mode = 'unlimited' where id = $1", [m.ids.pb]);
    },
    async sold(day) {
      return (await api.db.owner.query<{ sold: number }>("select sold from inventory_days where product_id = $1 and day = $2", [m.ids.pb, day])).rows[0]?.sold ?? 0;
    },
    net(orderId) {
      const base = pay.intentOf(orderId);
      const collected = [...(base === undefined ? [] : [base]), ...pay.chargesOf(orderId)].filter((intent) => intent.status === "succeeded").reduce((sum, intent) => sum + intent.amountMinor, 0);
      const refunded = pay.refundsOf(orderId).filter((refund) => refund.status === "succeeded").reduce((sum, refund) => sum + refund.amountMinor, 0);
      return collected - refunded;
    },
    async events(orderId, like = "%") {
      const rows = await api.db.owner.query<{ event: string; n: number }>("select event, count(*)::int as n from notification_events where order_id = $1 and event like $2 group by event", [orderId, like]);
      return Object.fromEntries(rows.rows.map((row) => [row.event, row.n]));
    },
    async notificationRows(orderId, audience, event) {
      return (await api.db.owner.query("select status, last_error_code, recipient from notifications where order_id = $1 and audience = $2 and event = $3", [orderId, audience, event])).rows;
    },
    async close() {
      await api.close();
      await smtp.close();
    },
  };
  return world;
}

/** 每个用例开头：清掉上一个用例排着的通知和没结论的申请，时钟往后拨，重新登录。 */
export async function resetBetweenTests(w: World): Promise<void> {
  const { api } = w;
  await api.db.owner.query("update notification_events set expanded_at = coalesce(expanded_at, now())");
  await api.db.owner.query("update notifications set status = 'expired', last_error_code = 'ORDER_STATE_CHANGED', lease_token = null, lease_until = null where status in ('pending', 'sending')");
  await api.db.owner.query("update tenant_notification_settings set driver_link_delivery = 'auto', quiet_start = null, quiet_end = null");
  await api.db.owner.query("update order_changes set status = 'cancelled', decided_at = now() where status in ('awaiting_payment', 'pending_confirmation', 'adjusting')");
  // 上一个用例没处理完的单不能被这个用例的定时任务（救援、退款）捞到
  await api.db.owner.query("update orders set status = 'cancelled', cancelled_at = now(), cancel_reason = 'GUEST_REQUEST' where status in ('confirmed', 'assigned', 'departed', 'arrived') and service_at < now() + interval '3650 days'");
  await w.unlimited();
  api.clock.advance(HOUR);
  await w.relogin();
  w.smtp.reset();
}

/** 递归收集 JSON 里所有的键。 */
export function allKeysDeep(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) for (const item of value) allKeysDeep(item, out);
  else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      out.add(key);
      allKeysDeep(item, out);
    }
  }
  return out;
}

/** 规则 4：`/tenant/v1` 的返回没有对外价、加价比例、差价（按键名，再按完整的金额数字；不搜短数字子串）。 */
export function assertNoSellInfo(body: unknown, sellValues: readonly number[], label: string): void {
  const leaked = [...allKeysDeep(body)].filter((key) => /sell|markup|price_difference|fx|buffer|channel|gross|margin/i.test(key));
  assert.deepEqual(leaked, [], `${label}：不能有对外价、加价的字段`);
  const scalars: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === "object") Object.values(value).forEach(walk);
    else if (typeof value === "number" || typeof value === "string") scalars.push(String(value));
  };
  walk(body);
  for (const sell of sellValues) assert.ok(!scalars.includes(String(sell)), `${label}：不能出现对外价 ${sell}`);
}

export { decodedMailText };
