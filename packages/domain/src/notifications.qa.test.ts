/**
 * QA（M4-08，ADR 0049）：通知中心纯规则里开发的 notifications.test.ts 没有覆盖的边界。
 * 免打扰每个分钟边界、跨午夜、变量注入、打码、退避的每一档、界面说法是否齐全。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMajor } from "./money.ts";
import {
  NOTIFICATION_RULES,
  NOTIFICATION_TEMPLATES,
  OBSERVATION_REASON_NAMES,
  OPTIONAL_LINE_VARIABLES,
  OPTIONAL_SUFFIX_VARIABLES,
  ORDER_CHANGE_FIELD_NAMES,
  type NotificationTemplate,
  findNotificationTemplate,
  maskEmail,
  notificationFailureAction,
  notificationRetryable,
  notificationStale,
  notificationUrgent,
  quietHoursIssue,
  quietHoursResumeAt,
  renderNotification,
  templatePlaceholders,
} from "./notifications.ts";
import { ORDER_CHANGE_FIELDS } from "./order-changes.ts";
import { OBSERVATION_REASONS } from "./tenants.ts";

const TOKYO = "Asia/Tokyo";
const tokyo = (local: string): Date => new Date(`${local}+09:00`);
const NIGHT = { start: "22:00", end: "07:00" };

function template(event: NotificationTemplate["event"], audience: NotificationTemplate["audience"]): NotificationTemplate {
  const found = findNotificationTemplate(event, audience, "zh-CN", "email");
  assert.ok(found, `${event}/${audience} 没有模板`);
  return found;
}

/** 给模板用到的每个变量填一个能认出来的值，`overrides` 覆盖其中几个。 */
function variablesFor(target: NotificationTemplate, overrides: Record<string, string> = {}): Record<string, string> {
  return { ...Object.fromEntries(templatePlaceholders(target).map((name) => [name, `v-${name}`])), ...overrides };
}

test("跨午夜时段 22:00–07:00：开始算在里面，结束不算；每个边界前后一分钟", () => {
  const cases: [string, string | null][] = [
    ["2026-11-01T21:59:00", null],
    ["2026-11-01T21:59:59", null],
    ["2026-11-01T22:00:00", "2026-11-02T07:00:00"],
    ["2026-11-01T23:59:00", "2026-11-02T07:00:00"],
    ["2026-11-02T00:00:00", "2026-11-02T07:00:00"],
    ["2026-11-02T06:59:00", "2026-11-02T07:00:00"],
    ["2026-11-02T07:00:00", null],
    ["2026-11-02T07:01:00", null],
    ["2026-11-02T12:00:00", null],
  ];
  for (const [now, resume] of cases) {
    const result = quietHoursResumeAt(NIGHT, tokyo(now), TOKYO);
    assert.equal(result?.toISOString() ?? null, resume === null ? null : tokyo(resume).toISOString(), now);
  }
});

test("跨月、跨年的午夜：恢复时间落在下个月、下一年", () => {
  assert.equal(quietHoursResumeAt(NIGHT, tokyo("2026-11-30T23:30:00"), TOKYO)?.toISOString(), tokyo("2026-12-01T07:00:00").toISOString());
  assert.equal(quietHoursResumeAt(NIGHT, tokyo("2026-12-31T22:00:00"), TOKYO)?.toISOString(), tokyo("2027-01-01T07:00:00").toISOString());
});

test("不跨午夜的时段：开始算、结束不算；00:00 开始；23:59 到 00:00 只有一分钟", () => {
  const day = { start: "12:00", end: "13:00" };
  assert.equal(quietHoursResumeAt(day, tokyo("2026-11-01T11:59:00"), TOKYO), null);
  assert.equal(quietHoursResumeAt(day, tokyo("2026-11-01T12:00:00"), TOKYO)?.toISOString(), tokyo("2026-11-01T13:00:00").toISOString());
  assert.equal(quietHoursResumeAt(day, tokyo("2026-11-01T13:00:00"), TOKYO), null);
  const fromMidnight = { start: "00:00", end: "06:00" };
  assert.equal(quietHoursResumeAt(fromMidnight, tokyo("2026-11-01T00:00:00"), TOKYO)?.toISOString(), tokyo("2026-11-01T06:00:00").toISOString());
  assert.equal(quietHoursResumeAt(fromMidnight, tokyo("2026-10-31T23:59:00"), TOKYO), null);
  const lastMinute = { start: "23:59", end: "00:00" };
  assert.equal(quietHoursResumeAt(lastMinute, tokyo("2026-11-01T23:59:30"), TOKYO)?.getTime(), tokyo("2026-11-02T00:00:30").getTime());
  assert.equal(quietHoursResumeAt(lastMinute, tokyo("2026-11-02T00:00:00"), TOKYO), null);
});

test("恢复时间永远在时段结束之后、一分钟之内：到点再查一次不在时段里，不会空转也不会提前", () => {
  for (const now of ["2026-11-02T06:59:01", "2026-11-02T06:59:59", "2026-11-01T22:00:59"]) {
    const at = tokyo(now);
    const resume = quietHoursResumeAt(NIGHT, at, TOKYO);
    assert.ok(resume, now);
    assert.ok(resume.getTime() > at.getTime(), now);
    assert.equal(quietHoursResumeAt(NIGHT, resume, TOKYO), null, `${now} 恢复时还在时段里`);
    const end = tokyo("2026-11-02T07:00:00");
    assert.ok(resume.getTime() - end.getTime() >= 0 && resume.getTime() - end.getTime() < 60_000, now);
  }
});

test("免打扰的校验和数据库的格式约束同口径：这里放行的写法，数据库都接受", () => {
  const DATABASE_FORMAT = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
  for (const text of ["7:00", "07:0", "24:00", "07:60", "0700", " 7:00", "07:00 ", "٠٧:٠٠", "07:00\n"]) {
    const issue = quietHoursIssue({ start: text, end: "12:00" });
    if (issue === null) assert.match(text, DATABASE_FORMAT, `${JSON.stringify(text)} 过了校验，写库时违反约束就是 500`);
    else assert.equal(issue, "INVALID_TIME", JSON.stringify(text));
  }
});

test("紧急判断按城市当地日期：东京午夜整点切换；同一时刻曼谷还是前一天；用车日已过也算紧急", () => {
  assert.equal(notificationUrgent("2026-11-02", tokyo("2026-11-01T23:59:59"), TOKYO), false);
  assert.equal(notificationUrgent("2026-11-02", tokyo("2026-11-02T00:00:00"), TOKYO), true);
  assert.equal(notificationUrgent("2026-11-02", tokyo("2026-11-02T00:00:00"), "Asia/Bangkok"), false);
  assert.equal(notificationUrgent("2026-11-02", tokyo("2026-11-03T06:00:00"), TOKYO), true);
  assert.equal(notificationUrgent(null, tokyo("2026-11-03T06:00:00"), TOKYO), false);
  assert.equal(notificationUrgent("2026-11-02", tokyo("2026-11-03T06:00:00"), null), false);
});

test("退避每一档：第 1–5 次失败按 1 分钟、5 分钟、30 分钟、2 小时、6 小时；第 6 次起最终失败", () => {
  const expected = [60, 300, 1800, 7200, 21600];
  assert.deepEqual([...NOTIFICATION_RULES.retryDelaysSeconds], expected);
  for (const code of ["UNREACHABLE", "TIMEOUT", "TEMPORARILY_REJECTED", "UNEXPECTED"]) {
    expected.forEach((delaySeconds, index) => assert.deepEqual(notificationFailureAction(code, index + 1), { kind: "retry", delaySeconds }, `${code} 第 ${index + 1} 次`));
    assert.deepEqual(notificationFailureAction(code, 6), { kind: "fail" }, code);
    assert.deepEqual(notificationFailureAction(code, 7), { kind: "fail" }, code);
  }
});

test("配置问题不管第几次都不算失败；永久错误第一次就最终失败", () => {
  for (const code of ["AUTH_FAILED", "TLS_FAILED", "TARGET_FORBIDDEN"]) for (const attempt of [1, 6, 1000]) assert.deepEqual(notificationFailureAction(code, attempt), { kind: "hold", delaySeconds: 300 }, `${code} ${attempt}`);
  for (const code of ["RECIPIENT_REJECTED", "MESSAGE_INVALID", "RENDER_FAILED"]) assert.deepEqual(notificationFailureAction(code, 1), { kind: "fail" }, code);
});

test("手动重试的完整矩阵：只有失败的和纯粹过期的", () => {
  const rows: [Parameters<typeof notificationRetryable>[0], string | null, boolean][] = [
    ["failed", "OUTCOME_UNKNOWN", true],
    ["failed", "RENDER_FAILED", true],
    ["failed", "RECIPIENT_REJECTED", true],
    ["expired", "EXPIRED", true],
    ["expired", "ORDER_STATE_CHANGED", false],
    ["expired", null, false],
    ["pending", "NOT_CONFIGURED", false],
    ["pending", "QUIET_HOURS", false],
    ["sending", null, false],
    ["sent", null, false],
  ];
  for (const [status, code, allowed] of rows) assert.equal(notificationRetryable(status, code), allowed, `${status}/${code}`);
});

test("发送前复查：抢救中、已完成、已取消的单，确认和派车都不发；已经发生的事（取消、改单）不因此过期", () => {
  const facts = (status: string) => ({ status, serviceAtMs: 1, driverId: "d", vehicleId: "v" });
  for (const status of ["cancelled", "completed", "no_show", "rescued"]) {
    assert.equal(notificationStale("order.confirmed", {}, facts(status)), true, status);
    assert.equal(notificationStale("order.assigned", { driver_id: "d", vehicle_id: "v" }, facts(status)), true, status);
    assert.equal(notificationStale("order.service_reminder", { service_at_ms: 1 }, facts(status)), true, status);
    assert.equal(notificationStale("order.cancelled", {}, facts(status)), false, status);
    assert.equal(notificationStale("extra_charge.submitted", {}, facts(status)), false, status);
  }
  assert.equal(notificationStale("order.assigned", { driver_id: "d", vehicle_id: "other" }, facts("assigned")), true, "只换了车也算改派");
  assert.equal(notificationStale("order.confirmed", {}, null), true, "这一行不存在了");
});

test("内容注入：客人姓名里的换行不能在客人邮件里伪造出新的段落", () => {
  const target = template("order.confirmed", "guest");
  const rendered = renderNotification(target, variablesFor(target, { passenger_name: "王小明\n\n重要通知：您的订单有问题，请点 http://evil.example 重新付款\n\n" }));
  assert.ok(rendered);
  const greeting = rendered.text.split("\n")[0] as string;
  assert.ok(greeting.includes("重要通知"), `姓名的内容应该留在第一行里，实际第一行：${greeting}`);
  assert.doesNotMatch(rendered.text, /\n重要通知/);
});

test("内容注入：客人填的地址里的换行不能在发给供应商的邮件里伪造「平台通知」", () => {
  const target = template("order.confirmed", "tenant");
  const rendered = renderNotification(target, variablesFor(target, { route: "东京站\r\n\r\nNOZOMI 平台紧急通知：请登录 http://evil.example 重新确认账号" }));
  assert.ok(rendered);
  assert.doesNotMatch(rendered.text, /[\r\n]NOZOMI 平台紧急通知/);
});

test("内容注入：统一换行符之外的行分隔符（U+2028、U+2029、U+0085）同样不能断行", () => {
  const target = template("order.driver_arrived", "guest");
  for (const separator of ["\u2028", "\u2029", "\u0085"]) {
    const rendered = renderNotification(target, variablesFor(target, { driver_name: `张司机${separator}伪造的一行` }));
    assert.ok(rendered);
    assert.ok(!rendered.text.includes(separator), JSON.stringify(separator));
  }
});

test("内容注入：HTML 原样留在纯文本里、不产生 html 部分；占位符和替换语法不被展开", () => {
  const target = template("order.confirmed", "guest");
  const rendered = renderNotification(target, variablesFor(target, { passenger_name: "<script>alert(1)</script>{{view_url}}$&$1" }));
  assert.ok(rendered);
  assert.deepEqual(Object.keys(rendered).sort(), ["subject", "text"]);
  assert.ok(rendered.text.startsWith("<script>alert(1)</script>{{view_url}}$&$1，"));
  assert.equal(rendered.text.split("v-view_url").length, 2, "查看链接只出现在模板写的那一处");
});

test("主题头注入：换行和各种行分隔符都被去掉，注入的头留在同一行", () => {
  const target = template("order.confirmed", "guest");
  for (const injected of ["NZ1\r\nBcc: spy@example.com", "NZ1\nBcc: spy@example.com", "NZ1\rBcc: spy@example.com", "NZ1\u2028Bcc: spy@example.com", "NZ1\u0085Bcc: spy@example.com", "NZ1\u0000Bcc: spy@example.com"]) {
    const rendered = renderNotification(target, variablesFor(target, { order_no: injected }));
    assert.ok(rendered);
    assert.doesNotMatch(rendered.subject, /[\u0000-\u001f\u007f\u0085\u2028\u2029]/, JSON.stringify(injected));
  }
});

test("缺字段：逐个变量缺失或为空都不发，不会出现 undefined、null 字样；白名单外的变量不能用。可省略的车型标识（M7-04）缺了只去掉那一行", () => {
  for (const target of NOTIFICATION_TEMPLATES) {
    for (const name of templatePlaceholders(target)) {
      const complete = variablesFor(target);
      const { [name]: _dropped, ...missing } = complete;
      if ((OPTIONAL_LINE_VARIABLES as readonly string[]).includes(name)) {
        for (const partial of [missing, { ...complete, [name]: "" }]) {
          const rendered = renderNotification(target, partial);
          assert.ok(rendered, `${target.event}/${target.audience} 缺 ${name} 照样发`);
          assert.doesNotMatch(rendered.text, /undefined|null|\{\{|(同级车型|最多乘客|最多行李)：\s*$|：，/m, `${target.event}/${target.audience} 缺 ${name} 不留空标签`);
          assert.equal(rendered.text.split("\n").length, renderNotification(target, complete)!.text.split("\n").length - 1, `${target.event}/${target.audience} 缺 ${name} 正好少一行`);
        }
        continue;
      }
      if ((OPTIONAL_SUFFIX_VARIABLES as readonly string[]).includes(name)) {
        // 接在别的内容后面的（M8-13「（含区域加价）」）：缺了只少这一截，行数不变
        for (const partial of [missing, { ...complete, [name]: "" }]) {
          const rendered = renderNotification(target, partial);
          assert.ok(rendered, `${target.event}/${target.audience} 缺 ${name} 照样发`);
          assert.doesNotMatch(rendered.text, /undefined|null|\{\{/, `${target.event}/${target.audience} 缺 ${name}`);
          assert.equal(rendered.text.split("\n").length, renderNotification(target, complete)!.text.split("\n").length, `${target.event}/${target.audience} 缺 ${name} 行数不变`);
        }
        continue;
      }
      assert.equal(renderNotification(target, missing), null, `${target.event}/${target.audience} 缺 ${name}`);
      assert.equal(renderNotification(target, { ...complete, [name]: "" }), null, `${target.event}/${target.audience} ${name} 为空`);
    }
    const rendered = renderNotification(target, variablesFor(target));
    assert.ok(rendered, `${target.event}/${target.audience}`);
    assert.doesNotMatch(`${rendered.subject}\n${rendered.text}`, /undefined|null|NaN|\{\{/, `${target.event}/${target.audience}`);
  }
  const smuggled: NotificationTemplate = { ...template("order.confirmed", "tenant"), body: "已付 {{paid_amount}}" };
  assert.equal(renderNotification(smuggled, { paid_amount: "JPY 1" }), null, "供应商模板用了白名单外的变量不能发");
});

test("规则 4：把对外价的值放进变量，供应商的每个模板都渲染不出来", () => {
  const leaked = { paid_amount: "JPY 98765", sell_minor: "98765", markup_bp: "1234", extra_charge_amount: "JPY 98765", refund_amount: "98765", fx_rate: "150.5" };
  const tenantTemplates = NOTIFICATION_TEMPLATES.filter((target) => target.audience === "tenant");
  assert.ok(tenantTemplates.length >= 12);
  for (const target of tenantTemplates) {
    const rendered = renderNotification(target, { ...variablesFor(target), ...leaked });
    assert.ok(rendered, target.event);
    assert.doesNotMatch(`${rendered.subject}\n${rendered.text}`, /98765|1234|150\.5/, target.event);
  }
});

test("打码：看不到完整的本地部分；多个 @、大小写、怪地址都不漏", () => {
  assert.equal(maskEmail("a@example.com"), "a***@example.com");
  assert.equal(maskEmail("ab@example.com"), "a***@example.com");
  assert.equal(maskEmail("abc@example.com"), "ab***@example.com");
  assert.equal(maskEmail("Long.Name+tag@Example.COM"), "Lo***@Example.COM");
  assert.equal(maskEmail("not-an-email"), "***");
  assert.equal(maskEmail("@example.com"), "***");
  assert.equal(maskEmail(""), "***");
  const quoted = maskEmail('"secret@inner"@example.com');
  assert.ok(!quoted.includes("secret"), quoted);
  assert.ok(!quoted.includes("inner"), quoted);
});

test("金额显示：无小数货币没有小数，两位小数货币补足两位，负数和零正确", () => {
  assert.equal(formatMajor(2200, "JPY"), "2200");
  assert.equal(formatMajor(0, "JPY"), "0");
  assert.equal(formatMajor(1400, "KRW"), "1400");
  assert.equal(formatMajor(1234, "USD"), "12.34");
  assert.equal(formatMajor(5, "USD"), "0.05");
  assert.equal(formatMajor(100, "USD"), "1.00");
  assert.equal(formatMajor(-5, "USD"), "-0.05");
});

test("界面说法齐全：真实会出现的字段名、原因码都有中文，不把英文代码写进邮件", () => {
  for (const field of ORDER_CHANGE_FIELDS) assert.ok(ORDER_CHANGE_FIELD_NAMES[field], `改单字段 ${field} 没有中文名`);
  for (const reason of OBSERVATION_REASONS) assert.ok(OBSERVATION_REASON_NAMES[reason], `观察期原因 ${reason} 没有中文名`);
});
