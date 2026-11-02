import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DRIVER_LINK_EMAIL_LIMITS,
  DRIVER_VARIABLES,
  NOTIFICATION_TEMPLATES,
  TENANT_FORBIDDEN_PATTERN,
  type DriverLinkEmailFacts,
  type DriverLinkSendFacts,
  driverLinkEmailErrorText,
  driverLinkEmailView,
  driverLinkResendWait,
  driverLinkSendBlock,
  driverTripSummary,
  findNotificationTemplate,
  maskEmail,
  renderNotification,
  templatePlaceholders,
} from "./index.ts";

const now = new Date("2026-11-02T00:00:00Z");
const later = new Date("2026-11-05T00:00:00Z");
const sendFacts = (over: Partial<DriverLinkSendFacts> = {}): DriverLinkSendFacts => ({
  now,
  request: { id: "r1", driverId: "d1", assignmentId: "a1" },
  order: { status: "assigned", driverId: "d1" },
  anchor: { driverId: "d1", assignmentId: "a1", revokedAt: null, expiresAt: later },
  latestRequestId: "r1",
  mode: "auto",
  driver: { email: "fictional.driver@example.test", status: "active" },
  ...over,
});

test("发送前复查：都对得上才发", () => {
  assert.equal(driverLinkSendBlock(sendFacts()), null);
  for (const status of ["departed", "arrived", "in_service", "completed", "no_show_claimed"]) assert.equal(driverLinkSendBlock(sendFacts({ order: { status, driverId: "d1" } })), null, status);
});

test("发送前复查：取消、救援、已转出不发", () => {
  for (const status of ["cancelled", "rescue_pending", "rescued", "confirmed", "no_show"]) assert.equal(driverLinkSendBlock(sendFacts({ order: { status, driverId: "d1" } })), "ORDER_STATE_CHANGED", status);
});

test("发送前复查：换了司机不发（旧通知不能把链接发给旧司机）", () => {
  assert.equal(driverLinkSendBlock(sendFacts({ order: { status: "assigned", driverId: "d2" } })), "ORDER_STATE_CHANGED");
  assert.equal(driverLinkSendBlock(sendFacts({ order: { status: "assigned", driverId: null } })), "ORDER_STATE_CHANGED");
  assert.equal(driverLinkSendBlock(sendFacts({ anchor: { driverId: "d2", assignmentId: "a1", revokedAt: null, expiresAt: later } })), "ORDER_STATE_CHANGED");
  assert.equal(driverLinkSendBlock(sendFacts({ anchor: { driverId: "d1", assignmentId: "a2", revokedAt: null, expiresAt: later } })), "ORDER_STATE_CHANGED");
  assert.equal(driverLinkSendBlock(sendFacts({ anchor: null })), "ORDER_STATE_CHANGED");
});

test("发送前复查：锚点链接吊销或过期不发", () => {
  assert.equal(driverLinkSendBlock(sendFacts({ anchor: { driverId: "d1", assignmentId: "a1", revokedAt: now, expiresAt: later } })), "DRIVER_LINK_REVOKED");
  assert.equal(driverLinkSendBlock(sendFacts({ anchor: { driverId: "d1", assignmentId: "a1", revokedAt: null, expiresAt: now } })), "DRIVER_LINK_REVOKED", "恰好到期也算过期");
});

test("发送前复查：只发最新的、手动模式不发、没邮箱不发、停用不发", () => {
  assert.equal(driverLinkSendBlock(sendFacts({ latestRequestId: "r2" })), "DRIVER_LINK_SUPERSEDED");
  assert.equal(driverLinkSendBlock(sendFacts({ latestRequestId: null })), "DRIVER_LINK_SUPERSEDED");
  assert.equal(driverLinkSendBlock(sendFacts({ mode: "manual" })), "DRIVER_LINK_MANUAL");
  assert.equal(driverLinkSendBlock(sendFacts({ driver: { email: null, status: "active" } })), "DRIVER_EMAIL_MISSING");
  assert.equal(driverLinkSendBlock(sendFacts({ driver: { email: "  ", status: "active" } })), "DRIVER_EMAIL_MISSING");
  assert.equal(driverLinkSendBlock(sendFacts({ driver: { email: "a@example.test", status: "disabled" } })), "DRIVER_DISABLED");
  assert.equal(driverLinkSendBlock(sendFacts({ driver: null })), "DRIVER_DISABLED");
});

test("重发限速：同一张单 60 秒内一次，边界按毫秒", () => {
  const ago = (ms: number): Date => new Date(now.getTime() - ms);
  const base = { now, tenantCount: 0, tenantOldest: null };
  assert.equal(driverLinkResendWait({ ...base, orderRecent: [] }), null);
  assert.equal(driverLinkResendWait({ ...base, orderRecent: [ago(59_001)] }), 1);
  assert.equal(driverLinkResendWait({ ...base, orderRecent: [ago(1_000)] }), 59);
  assert.equal(driverLinkResendWait({ ...base, orderRecent: [ago(60_000)] }), null, "恰好 60 秒可以");
});

test("重发限速：一小时次数上限，等到最早那次过一小时", () => {
  const ago = (minutes: number): Date => new Date(now.getTime() - minutes * 60_000);
  const base = { now, tenantCount: 0, tenantOldest: null };
  const four = [ago(50), ago(40), ago(30), ago(20)];
  assert.equal(driverLinkResendWait({ ...base, orderRecent: four }), null);
  assert.equal(driverLinkResendWait({ ...base, orderRecent: [...four, ago(10)] }), 600, "最早的 50 分钟前，还要 10 分钟");
  assert.equal(DRIVER_LINK_EMAIL_LIMITS.orderPerHour, 5);
});

test("重发限速：一家一小时的总量", () => {
  const oldest = new Date(now.getTime() - 30 * 60_000);
  assert.equal(driverLinkResendWait({ now, orderRecent: [], tenantCount: DRIVER_LINK_EMAIL_LIMITS.tenantPerHour - 1, tenantOldest: oldest }), null);
  assert.equal(driverLinkResendWait({ now, orderRecent: [], tenantCount: DRIVER_LINK_EMAIL_LIMITS.tenantPerHour, tenantOldest: oldest }), 1800);
});

const viewFacts = (over: Partial<DriverLinkEmailFacts> = {}): DriverLinkEmailFacts => ({ now, linkActive: true, orderSendable: true, mode: "auto", driverEmail: "fictional.driver@example.test", latest: null, ...over });
const requested = new Date(now.getTime() - 1000);
const withRow = (status: string, over: Partial<{ recipient: string; errorCode: string | null; sentAt: Date | null }> = {}) => ({ latest: { requestedAt: requested, notification: { status, recipient: "fictional.driver@example.test", errorCode: null, sentAt: null, ...over } } });

test("发送状态：没有有效链接、手动、没邮箱优先于记录", () => {
  assert.equal(driverLinkEmailView(viewFacts({ linkActive: false, ...withRow("sent") })).state, "no_link");
  assert.equal(driverLinkEmailView(viewFacts({ mode: "manual", ...withRow("sent") })).state, "manual");
  assert.equal(driverLinkEmailView(viewFacts({ driverEmail: null, ...withRow("sent") })).state, "no_email");
  for (const facts of [{ linkActive: false }, { mode: "manual" as const }, { driverEmail: null }]) assert.equal(driverLinkEmailView(viewFacts(facts)).canResend, false);
});

test("发送状态：还没发过；订单不能发时不给重发", () => {
  const view = driverLinkEmailView(viewFacts());
  assert.equal(view.state, "not_sent");
  assert.equal(view.canResend, true);
  assert.equal(driverLinkEmailView(viewFacts({ orderSendable: false })).canResend, false);
});

test("发送状态：发送记录还没展开算等待中，太久算失败", () => {
  assert.equal(driverLinkEmailView(viewFacts({ latest: { requestedAt: requested, notification: null } })).state, "pending");
  const stalled = driverLinkEmailView(viewFacts({ latest: { requestedAt: new Date(now.getTime() - DRIVER_LINK_EMAIL_LIMITS.expandStalledMs - 1), notification: null } }));
  assert.equal(stalled.state, "failed");
  assert.equal(stalled.errorCode, "UNEXPECTED");
});

test("发送状态：等待、发送中都是等待中，带上原因", () => {
  assert.equal(driverLinkEmailView(viewFacts(withRow("sending"))).state, "pending");
  const notConfigured = driverLinkEmailView(viewFacts(withRow("pending", { errorCode: "NOT_CONFIGURED" })));
  assert.equal(notConfigured.state, "pending");
  assert.equal(notConfigured.errorCode, "NOT_CONFIGURED");
});

test("发送状态：等待中的地址按司机现在的邮箱", () => {
  assert.equal(driverLinkEmailView(viewFacts({ driverEmail: "new.fictional@example.test", ...withRow("pending") })).recipient, "new.fictional@example.test");
});

test("发送状态：已发送；发出后改了邮箱提示要重发", () => {
  const sentAt = new Date(now.getTime() - 500);
  const sent = driverLinkEmailView(viewFacts(withRow("sent", { sentAt })));
  assert.equal(sent.state, "sent");
  assert.equal(sent.sentAt, sentAt);
  assert.equal(sent.addressChanged, false);
  const changed = driverLinkEmailView(viewFacts({ driverEmail: "new.fictional@example.test", ...withRow("sent", { sentAt }) }));
  assert.equal(changed.state, "not_sent");
  assert.equal(changed.addressChanged, true);
  assert.equal(changed.canResend, true);
  assert.equal(driverLinkEmailView(viewFacts({ driverEmail: "FICTIONAL.driver@example.test", ...withRow("sent", { sentAt }) })).state, "sent", "只差大小写不算改了");
});

test("发送状态：失败和作废都算失败，带原因", () => {
  for (const status of ["failed", "expired"]) {
    const view = driverLinkEmailView(viewFacts(withRow(status, { errorCode: "RECIPIENT_REJECTED" })));
    assert.equal(view.state, "failed");
    assert.equal(view.errorCode, "RECIPIENT_REJECTED");
    assert.equal(view.canResend, true);
  }
});

test("发送状态：信发出去了但邮件链接都作废了（改过邮箱又改回）：不能显示已发送，要提示重发", () => {
  const latest = withRow("sent", { sentAt: requested }).latest;
  const view = driverLinkEmailView(viewFacts({ latest: { ...latest, emailLinkActive: false } }));
  assert.equal(view.state, "not_sent");
  assert.equal(view.addressChanged, true);
  assert.equal(view.canResend, true);
  assert.equal(driverLinkEmailView(viewFacts({ latest: { ...latest, emailLinkActive: true } })).state, "sent");
});

test("发送状态：没有发送记录就结束了：没地址算没发、展开出错算失败，都不用等 15 分钟", () => {
  const closed = (closedCode: string) => driverLinkEmailView(viewFacts({ latest: { requestedAt: requested, closedCode, notification: null } }));
  assert.equal(closed("DRIVER_EMAIL_MISSING").state, "not_sent");
  assert.equal(closed("DRIVER_EMAIL_MISSING").canResend, true);
  assert.equal(closed("PASSENGER_DECRYPT_FAILED").state, "failed");
  assert.equal(closed("PASSENGER_DECRYPT_FAILED").errorCode, "PASSENGER_DECRYPT_FAILED");
});

test("发送状态：司机停用了不给重发", () => {
  assert.equal(driverLinkEmailView(viewFacts({ driverActive: false })).canResend, false);
  assert.equal(driverLinkEmailView(viewFacts({ driverActive: false, ...withRow("failed") })).canResend, false);
  assert.equal(driverLinkEmailView(viewFacts({ driverActive: true })).canResend, true);
});

test("失败原因：只有我们写的中文；配置类问题不暴露给调度员", () => {
  assert.equal(driverLinkEmailErrorText(null), null);
  assert.match(driverLinkEmailErrorText("NOT_CONFIGURED") as string, /手动/);
  for (const code of ["AUTH_FAILED", "SENDER_REJECTED", "TLS_FAILED", "TIMEOUT", "随便什么"]) {
    const text = driverLinkEmailErrorText(code) as string;
    assert.match(text, /复制链接/);
    assert.doesNotMatch(text, /密码|发件人|SMTP/);
  }
});

test("行程概要：只有城市、方向、机场或车站", () => {
  assert.equal(driverTripSummary({ city: "虚构市", category: "airport_transfer", direction: "pickup", place: "虚构机场", packageHours: null }), "虚构市：接机 · 虚构机场");
  assert.equal(driverTripSummary({ city: "虚构市", category: "airport_transfer", direction: "dropoff", place: "虚构机场", packageHours: null }), "虚构市：送机 · 虚构机场");
  assert.equal(driverTripSummary({ city: "虚构市", category: "point_to_point", direction: null, place: null, packageHours: null }), "虚构市：点对点");
  assert.equal(driverTripSummary({ city: null, category: "charter", direction: null, place: null, packageHours: 8 }), "包车 8 小时");
});

test("司机模板：变量都在白名单、没有价格字眼、写明不要转发、不写「已收到」", () => {
  const template = findNotificationTemplate("order.driver_link", "driver", "zh-CN", "email");
  assert.ok(template !== null);
  for (const name of templatePlaceholders(template)) assert.ok((DRIVER_VARIABLES as readonly string[]).includes(name), name);
  assert.doesNotMatch(`${template.subject}\n${template.body}`, TENANT_FORBIDDEN_PATTERN);
  assert.match(template.body, /不要转发/);
  assert.match(template.body, /客人信息/);
  for (const name of DRIVER_VARIABLES) assert.doesNotMatch(name, TENANT_FORBIDDEN_PATTERN);
  assert.doesNotMatch(DRIVER_VARIABLES.join(","), /passenger|phone|email|address/);
  assert.equal(NOTIFICATION_TEMPLATES.filter((item) => item.audience === "driver").length, 1);
});

test("司机模板：渲染；主题里没有链接；变量里的换行被规整", () => {
  const template = findNotificationTemplate("order.driver_link", "driver", "zh-CN", "email");
  assert.ok(template !== null);
  const url = "https://console.example.test/driver#nzd_x.y";
  const rendered = renderNotification(template, { driver_name: "虚构\r\nBcc: other@example.test", order_no: "N1", service_time: "2026-11-05 09:00", trip_summary: "虚构市：点对点", vehicle_group: "虚构车型", driver_link_url: url, link_expires_at: "2026-11-06 10:00" });
  assert.ok(rendered !== null);
  assert.ok(rendered.text.includes(url));
  assert.ok(!rendered.subject.includes(url));
  assert.ok(!rendered.text.includes("\r\nBcc"));
  assert.equal(renderNotification(template, { driver_name: "虚构" }), null, "缺变量不发");
});

test("打码沿用通知中心的规则", () => {
  assert.equal(maskEmail("fictional.driver@example.test"), "fi***@example.test");
});
