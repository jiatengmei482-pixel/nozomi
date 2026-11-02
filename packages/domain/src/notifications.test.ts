import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NOTIFICATION_EVENTS,
  NOTIFICATION_EVENT_NAMES,
  NOTIFICATION_RULES,
  NOTIFICATION_TEMPLATES,
  TENANT_FORBIDDEN_PATTERN,
  TENANT_VARIABLES,
  audienceVariables,
  findNotificationTemplate,
  hasControlChars,
  maskEmail,
  notificationQuietUntil,
  uniqueRecipients,
  notificationAudiences,
  notificationExpiresAt,
  notificationFailureAction,
  notificationRetryable,
  notificationStale,
  notificationUrgent,
  quietHoursIssue,
  quietHoursResumeAt,
  renderNotification,
  templateNeedsViewLink,
  templatePlaceholders,
} from "./notifications.ts";

test("模板：每个事件至少一个接收方、都有中文名；主键（事件 × 接收方 × 语言 × 通道）不重复；占位符都在接收方的白名单里", () => {
  for (const event of NOTIFICATION_EVENTS) {
    assert.ok(notificationAudiences(event).length > 0, `${event} 没有模板`);
    assert.ok(NOTIFICATION_EVENT_NAMES[event]);
  }
  const keys = NOTIFICATION_TEMPLATES.map((template) => `${template.event}|${template.audience}|${template.locale}|${template.channel}`);
  assert.equal(new Set(keys).size, keys.length);
  for (const template of NOTIFICATION_TEMPLATES) {
    for (const name of templatePlaceholders(template)) assert.ok(audienceVariables(template.audience).includes(name), `${template.event}/${template.audience} 用了白名单外的 ${name}`);
  }
});

test("规则 4：供应商模板的白名单、模板文字都没有对外价、加价比例、客人付的钱", () => {
  for (const name of TENANT_VARIABLES) assert.doesNotMatch(name, TENANT_FORBIDDEN_PATTERN);
  const tenantTemplates = NOTIFICATION_TEMPLATES.filter((template) => template.audience === "tenant");
  assert.ok(tenantTemplates.length >= 10);
  for (const template of tenantTemplates) {
    assert.doesNotMatch(template.subject, TENANT_FORBIDDEN_PATTERN);
    assert.doesNotMatch(template.body, TENANT_FORBIDDEN_PATTERN);
  }
  assert.equal(renderNotification({ event: "order.changed", audience: "tenant", locale: "zh-CN", channel: "email", subject: "x", body: "{{paid_amount}}" }, { paid_amount: "JPY 1" }), null, "白名单外的变量即使给了值也不渲染");
});

test("客人的确认邮件带查看链接；发给供应商的不带", () => {
  const guest = findNotificationTemplate("order.confirmed", "guest", "zh-CN", "email");
  const tenant = findNotificationTemplate("order.confirmed", "tenant", "zh-CN", "email");
  assert.ok(guest !== null && templateNeedsViewLink(guest));
  assert.ok(tenant !== null && !templateNeedsViewLink(tenant));
  assert.equal(findNotificationTemplate("order.assigned", "tenant", "zh-CN", "email"), null);
});

test("渲染：缺变量不发；变量值不被二次替换；主题和正文里变量的换行都被规整成空格", () => {
  const template = { event: "exception.opened", audience: "staff", locale: "zh-CN", channel: "email", subject: "主题 {{order_no}}", body: "正文 {{detail}} {{order_no}}" } as const;
  assert.equal(renderNotification(template, { order_no: "A" }), null);
  assert.equal(renderNotification(template, { order_no: "", detail: "x" }), null);
  const out = renderNotification(template, { order_no: "A\r\nBcc: x@y.z", detail: "{{order_no}}" });
  assert.equal(out?.subject, "主题 A Bcc: x@y.z");
  assert.equal(out?.text, "正文 {{order_no}} A Bcc: x@y.z");
});

test("打码", () => {
  assert.equal(maskEmail("abcdef@example.com"), "ab***@example.com");
  assert.equal(maskEmail("ab@example.com"), "a***@example.com");
  assert.equal(maskEmail("a@example.com"), "a***@example.com");
  assert.equal(maskEmail("nonsense"), "***");
  assert.equal(maskEmail("@example.com"), "***");
});

test("发送失败的处理：永久失败立刻失败；配置问题不算次数；其余退避到次数用完", () => {
  assert.deepEqual(notificationFailureAction("RECIPIENT_REJECTED", 1), { kind: "fail" });
  assert.deepEqual(notificationFailureAction("MESSAGE_INVALID", 1), { kind: "fail" });
  for (const code of ["AUTH_FAILED", "TLS_FAILED", "TARGET_FORBIDDEN"]) assert.deepEqual(notificationFailureAction(code, 99), { kind: "hold", delaySeconds: NOTIFICATION_RULES.configRetrySeconds });
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => notificationFailureAction("TIMEOUT", n)), [60, 300, 1800, 7200, 21600].map((delaySeconds) => ({ kind: "retry", delaySeconds })));
  assert.deepEqual(notificationFailureAction("UNREACHABLE", 6), { kind: "fail" });
});

test("邮件服务器的拒绝：暂时的按完整退避；永久但说不清是谁的问题的少试两次（给运营留改配置的时间）；能确定是收件人的不重试", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => notificationFailureAction("TEMPORARILY_REJECTED", n)), [...[60, 300, 1800, 7200, 21600].map((delaySeconds) => ({ kind: "retry", delaySeconds })), { kind: "fail" }]);
  for (const code of ["SENDER_REJECTED", "MESSAGE_REJECTED"]) {
    assert.deepEqual([...NOTIFICATION_RULES.rejectedRetryDelaysSeconds], [300, 1800]);
    assert.deepEqual([1, 2, 3].map((n) => notificationFailureAction(code, n)), [{ kind: "retry", delaySeconds: 300 }, { kind: "retry", delaySeconds: 1800 }, { kind: "fail" }], code);
    assert.deepEqual(notificationFailureAction(code, 4), { kind: "fail" }, code);
  }
  assert.deepEqual(notificationFailureAction("RECIPIENT_REJECTED", 1), { kind: "fail" });
});

test("能不能手动重试", () => {
  assert.equal(notificationRetryable("failed", "OUTCOME_UNKNOWN"), true);
  assert.equal(notificationRetryable("expired", "EXPIRED"), true);
  assert.equal(notificationRetryable("expired", "ORDER_STATE_CHANGED"), false);
  assert.equal(notificationRetryable("sent", null), false);
  assert.equal(notificationRetryable("pending", null), false);
  assert.equal(notificationRetryable("sending", null), false);
});

test("有效期：和用车时间绑定的到用车时间，到达 1 小时，加收到异议期结束，告警 24 小时，其余 7 天", () => {
  const occurredAt = new Date("2026-11-01T00:00:00Z");
  const serviceAt = new Date("2026-11-05T00:00:00Z");
  const disputeUntil = new Date("2026-11-03T00:00:00Z");
  const of = (event: Parameters<typeof notificationExpiresAt>[0]) => notificationExpiresAt(event, { occurredAt, serviceAt, disputeUntil }).toISOString();
  assert.equal(of("order.confirmed"), serviceAt.toISOString());
  assert.equal(of("order.dispatch_overdue"), serviceAt.toISOString());
  assert.equal(of("order.driver_arrived"), "2026-11-01T01:00:00.000Z");
  assert.equal(of("extra_charge.submitted"), disputeUntil.toISOString());
  assert.equal(of("fx.alert"), "2026-11-02T00:00:00.000Z");
  assert.equal(of("order.cancelled"), "2026-11-08T00:00:00.000Z");
  assert.equal(notificationExpiresAt("order.confirmed", { occurredAt, serviceAt: null, disputeUntil: null }).toISOString(), "2026-11-08T00:00:00.000Z");
});

test("发送前的判断：订单取消后确认不发，取消本身照发；改派后旧司机的不发；改期后旧提醒不发；已派车后派车提醒不发", () => {
  const facts = (status: string, more: Partial<{ serviceAtMs: number; driverId: string | null; vehicleId: string | null }> = {}) => ({ status, serviceAtMs: 1000, driverId: "d1", vehicleId: "v1", ...more });
  assert.equal(notificationStale("order.confirmed", {}, facts("confirmed")), false);
  assert.equal(notificationStale("order.confirmed", {}, facts("cancelled")), true);
  assert.equal(notificationStale("order.cancelled", {}, facts("cancelled")), false);
  assert.equal(notificationStale("order.assigned", { driver_id: "d1", vehicle_id: "v1" }, facts("assigned")), false);
  assert.equal(notificationStale("order.assigned", { driver_id: "old", vehicle_id: "v1" }, facts("assigned")), true);
  assert.equal(notificationStale("order.service_reminder", { service_at_ms: 1000 }, facts("confirmed")), false);
  assert.equal(notificationStale("order.service_reminder", { service_at_ms: 999 }, facts("confirmed")), true);
  assert.equal(notificationStale("order.dispatch_overdue", {}, facts("assigned")), true);
  assert.equal(notificationStale("order.departure_overdue", {}, facts("departed")), true);
  assert.equal(notificationStale("order.driver_arrived", {}, facts("arrived")), false);
  assert.equal(notificationStale("order.driver_arrived", {}, facts("in_service")), true);
  assert.equal(notificationStale("order.confirmed", {}, null), true);
});

test("免打扰：格式、普通时段、跨午夜", () => {
  assert.equal(quietHoursIssue({ start: "22:00", end: "07:00" }), null);
  assert.equal(quietHoursIssue({ start: "25:00", end: "07:00" }), "INVALID_TIME");
  assert.equal(quietHoursIssue({ start: "07:00", end: "07:00" }), "SAME_TIME");
  const tokyo = "Asia/Tokyo";
  const hours = { start: "22:00", end: "07:00" };
  assert.equal(quietHoursResumeAt(hours, new Date("2026-11-01T12:59:00Z"), tokyo), null, "21:59 东京");
  assert.equal(quietHoursResumeAt(hours, new Date("2026-11-01T13:00:00Z"), tokyo)?.toISOString(), "2026-11-01T22:00:00.000Z", "22:00 开始，到第二天 07:00");
  assert.equal(quietHoursResumeAt(hours, new Date("2026-11-01T21:30:00Z"), tokyo)?.toISOString(), "2026-11-01T22:00:00.000Z", "06:30");
  assert.equal(quietHoursResumeAt(hours, new Date("2026-11-01T22:00:00Z"), tokyo), null, "07:00 结束，不含");
  assert.equal(quietHoursResumeAt({ start: "12:00", end: "13:00" }, new Date("2026-11-01T03:30:00Z"), tokyo)?.toISOString(), "2026-11-01T04:00:00.000Z");
});

test("紧急：用车当天按城市当地日期；没有订单的不紧急", () => {
  const now = new Date("2026-11-01T16:00:00Z");
  assert.equal(notificationUrgent("2026-11-02", now, "Asia/Tokyo"), true, "东京已经是 11-02");
  assert.equal(notificationUrgent("2026-11-02", now, "Europe/London"), false);
  assert.equal(notificationUrgent("2026-10-30", now, "Asia/Tokyo"), true);
  assert.equal(notificationUrgent(null, now, null), false);
});

test("免打扰要不要推迟：时段外、用车当天、时段结束已过期限、要紧事件 24 小时内都马上发；其余推迟到结束", () => {
  const now = new Date("2026-11-01T14:00:00Z"); // 东京 23:00
  const resume = "2026-11-01T22:00:00.000Z"; // 东京第二天 07:00
  const base = { event: "tenant.status_changed", quietHours: { start: "22:00", end: "07:00" }, now, timeZone: "Asia/Tokyo", serviceAt: null, serviceDate: null, serviceTimeZone: null, expiresAt: new Date("2026-11-08T14:00:00Z"), confirmDueAt: null } as const;
  const service = (hours: number) => ({ serviceAt: new Date(now.getTime() + hours * 3_600_000), serviceDate: "2026-11-05", serviceTimeZone: "Asia/Tokyo" });
  assert.equal(notificationQuietUntil(base)?.toISOString(), resume, "没有期限的等到时段结束");
  assert.equal(notificationQuietUntil({ ...base, now: new Date("2026-11-01T02:00:00Z") }), null, "时段外");
  assert.equal(notificationQuietUntil({ ...base, serviceAt: new Date(now.getTime() + 3_600_000), serviceDate: "2026-11-01", serviceTimeZone: "Asia/Tokyo" }), null, "用车当天");
  assert.equal(notificationQuietUntil({ ...base, expiresAt: new Date(resume) }), null, "时段结束正好到有效期");
  assert.equal(notificationQuietUntil({ ...base, confirmDueAt: new Date(now.getTime() + 1_800_000) }), null, "时段结束前到确认期限");
  assert.equal(notificationQuietUntil({ ...base, ...service(7) }), null, "时段结束前就用车，任何事件都不等");
  assert.equal(notificationQuietUntil({ ...base, event: "order.confirmed", ...service(20) }), null, "新订单 24 小时内用车");
  for (const event of ["order.cancelled", "order.changed", "order.change_pending", "order.rescue_started"] as const) assert.equal(notificationQuietUntil({ ...base, event, ...service(240) }), null, `${event}：十天后用车也马上发（ADR 0060）`);
  assert.equal(notificationQuietUntil({ ...base, event: "order.confirmed", ...service(120) })?.toISOString(), resume, "五天后的新订单可以等");
});

test("救援改派中：客人的确认和提醒照发（不能丢），供应商的新订单不发；过了确认期限的改期待确认不发", () => {
  const facts = { status: "rescue_pending", serviceAtMs: 1, driverId: null, vehicleId: null };
  assert.equal(notificationStale("order.confirmed", {}, facts, { audience: "guest" }), false);
  assert.equal(notificationStale("order.service_reminder", { service_at_ms: 1 }, facts, { audience: "guest" }), false);
  assert.equal(notificationStale("order.confirmed", {}, facts, { audience: "tenant" }), true);
  assert.equal(notificationStale("order.assigned", { driver_id: null, vehicle_id: null }, facts, { audience: "guest" }), true, "旧司机已作废");
  const live = { ...facts, status: "confirmed" };
  const now = new Date("2026-11-01T00:00:00Z");
  assert.equal(notificationStale("order.change_pending", { confirm_due_at: "2026-11-01T00:00:00Z" }, live, { now }), true, "正好到期限");
  assert.equal(notificationStale("order.change_pending", { confirm_due_at: "2026-11-01T00:00:01Z" }, live, { now }), false);
});

test("收件人去重不分大小写；单行字段的控制字符判断", () => {
  assert.deepEqual(uniqueRecipients(["A@x.test", "a@x.test", "b@x.test"]), ["A@x.test", "b@x.test"]);
  for (const bad of ["a\nb", "a\rb", "a b", "a b", "a\u0085b", "a\tb"]) assert.equal(hasControlChars(bad), true, JSON.stringify(bad));
  assert.equal(hasControlChars("东京站 八重洲口"), false);
});
