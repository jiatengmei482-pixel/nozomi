import { test } from "node:test";
import assert from "node:assert/strict";
import { directionName, driverLinkEmailNotice, driverLinkUrl, durationText, formatInZone, moneyText, retryResultText, routeText, serviceLocalText, webhookErrorText, webhookEventName } from "./dispatch-display.ts";

test("用车时间按服务城市的时区显示（Intl 换算，不手工加减小时）", () => {
  assert.equal(formatInZone("2026-10-20T01:00:00.000Z", "Asia/Tokyo"), "2026-10-20 10:00");
  assert.equal(formatInZone("2026-10-19T16:30:00.000Z", "Asia/Tokyo"), "2026-10-20 01:30", "跨日");
  assert.equal(formatInZone(null, "Asia/Tokyo"), "—");
  assert.equal(formatInZone("not a date", "Asia/Tokyo"), "—");
  assert.equal(serviceLocalText({ service_local: "2026-10-20T10:00" }), "2026-10-20 10:00");
});

test("路线、方向、金额、时长、错误码、事件的中文", () => {
  assert.equal(routeText({ category: "airport_transfer", direction: "pickup", pickup: null, dropoff: { lng: 1, lat: 1, address: "东京站" } }, "成田机场"), "成田机场 → 东京站");
  assert.equal(routeText({ category: "airport_transfer", direction: "dropoff", pickup: { lng: 1, lat: 1, address: "酒店" }, dropoff: null }, "成田机场"), "酒店 → 成田机场");
  assert.equal(routeText({ category: "point_to_point", direction: null, pickup: { lng: 1, lat: 1, address: "东京站" }, dropoff: { lng: 1, lat: 1, address: "新宿酒店" } }), "东京站 → 新宿酒店");
  assert.equal(routeText({ category: "charter", direction: null, package_hours: 8, pickup: { lng: 1, lat: 1, address: "东京站" }, dropoff: null }), "包车 8 小时 · 上车：东京站", "包车不写「→ —」");
  assert.equal(routeText({ category: "charter", direction: null, package_hours: null, pickup: { lng: 1, lat: 1, address: "东京站" }, dropoff: null }), "包车 · 上车：东京站");
  assert.equal(routeText({ category: "charter", direction: null, package_hours: 10, pickup: { lng: 1, lat: 1, address: "东京站" }, dropoff: { lng: 1, lat: 1, address: "箱根" } }), "包车 10 小时 · 东京站 → 箱根");
  assert.equal(routeText({ category: "charter", direction: null, pickup: null, dropoff: null }), "包车 · 上车：—");
  assert.equal(directionName({ category: "airport_transfer", direction: "pickup" }), "接机");
  assert.equal(directionName({ category: "charter", direction: null }), "包车");
  assert.equal(moneyText({ amount: "1234567", currency: "JPY" }), "1,234,567 JPY");
  assert.equal(moneyText({ amount: "1234.50", currency: "CNY" }), "1,234.50 CNY");
  assert.equal(moneyText({ amount: "-500", currency: "JPY" }), "-500 JPY");
  assert.deepEqual([60, 300, 7_200, 86_400, 45].map(durationText), ["1 分钟", "5 分钟", "2 小时", "1 天", "45 秒"]);
  assert.equal(webhookErrorText("WEBHOOK_HTTP_STATUS", 503), "对方返回的不是 2xx（HTTP 503）");
  assert.equal(webhookErrorText("WEBHOOK_TIMEOUT", null), "5 秒内没有应答");
  assert.equal(webhookErrorText(null, 200), "HTTP 200");
  assert.equal(webhookErrorText("SOMETHING_NEW", null), "SOMETHING_NEW");
  assert.equal(webhookEventName("webhook.test"), "测试事件");
  assert.match(webhookEventName("order.assigned"), /派车/);
  assert.equal(driverLinkUrl("https://nozomi.example.com", "/driver#nzd_x"), "https://nozomi.example.com/driver#nzd_x");
});

test("手动重推的提示：推送任务正在发时提示稍后看结果，没发的说明原因，发了的看成败", () => {
  assert.equal(retryResultText({ delivery: { status: "pending" }, result: "in_flight" }), "这条推送正在发送，稍后刷新查看结果");
  assert.equal(retryResultText({ delivery: { status: "failed" }, result: "not_configured" }), "供应商的 Webhook 设置已删除或暂停，没有发送");
  assert.equal(retryResultText({ delivery: { status: "succeeded" }, result: "sent" }), "已重推成功");
  assert.equal(retryResultText({ delivery: { status: "pending" }, result: "sent" }), "重推了，对方还是没收到");
});

test("司机链接邮件的说法：已发送只说邮件服务器已接收，从不说司机收到了", () => {
  const base = { recipient_masked: "fi***@example.test", error_code: null, error_message: null, address_changed: false };
  const sent = driverLinkEmailNotice({ ...base, state: "sent" });
  assert.equal(sent.kind, "success");
  assert.match(sent.text, /fi\*\*\*@example\.test/);
  assert.match(sent.text, /邮件服务器已接收/);
  assert.match(driverLinkEmailNotice({ ...base, state: "pending" }).text, /等待邮件服务器接收/);
  assert.equal(driverLinkEmailNotice({ ...base, state: "pending", error_code: "NOT_CONFIGURED", error_message: "平台的邮件发送还没有配置好，请先复制链接手动发给司机" }).kind, "warning");
  assert.match(driverLinkEmailNotice({ ...base, state: "pending", error_code: "NOT_CONFIGURED", error_message: "平台的邮件发送还没有配置好，请先复制链接手动发给司机" }).text, /手动发/);
  assert.match(driverLinkEmailNotice({ ...base, state: "pending", error_code: "TIMEOUT", error_message: "x" }).text, /自动重试/);
  const failed = driverLinkEmailNotice({ ...base, state: "failed", error_code: "RECIPIENT_REJECTED", error_message: "对方拒收" });
  assert.equal(failed.kind, "danger");
  assert.match(failed.text, /发送失败：对方拒收/);
  assert.match(driverLinkEmailNotice({ ...base, state: "manual" }).text, /当前设置是手动发送/);
  assert.match(driverLinkEmailNotice({ ...base, state: "no_email" }).text, /没有邮箱，请复制链接手动发/);
  assert.match(driverLinkEmailNotice({ ...base, state: "not_sent" }).text, /还没有发邮件/);
  assert.match(driverLinkEmailNotice({ ...base, state: "not_sent", address_changed: true }).text, /之前那封邮件里的链接已作废/);
  assert.match(driverLinkEmailNotice({ ...base, state: "no_link" }).text, /重新生成/);
  for (const state of ["sent", "pending", "failed", "manual", "no_email", "not_sent", "no_link"] as const) assert.doesNotMatch(driverLinkEmailNotice({ ...base, state }).text, /已收到|已看到|已送达/);
});
