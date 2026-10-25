import { test } from "node:test";
import assert from "node:assert/strict";
import { directionName, driverLinkUrl, durationText, formatInZone, moneyText, retryResultText, routeText, serviceLocalText, webhookErrorText, webhookEventName } from "./dispatch-display.ts";

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
