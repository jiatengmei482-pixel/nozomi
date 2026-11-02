/**
 * M4-32：履约回传的时间窗口（ADR 0064）。司机自己回传和平台代传用同一份「最早可以在用车前多少小时」。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DRIVER_ACTION_LABELS,
  FULFILMENT_EARLIEST_HOURS_BEFORE_SERVICE,
  FULFILMENT_EVENTS,
  fulfilmentEarliestAt,
  fulfilmentEarliestLocal,
  fulfilmentTooEarly,
  fulfilmentTooEarlyMessage,
  proxyEarliestHoursBeforeService,
  proxyFulfilmentTimeIssue,
} from "./fulfilment.ts";

const HOUR = 3_600_000;
const TOKYO = "Asia/Tokyo";

test("窗口：出发、到达最早用车前 24 小时；接到客人、完成最早用车前 3 小时", () => {
  assert.deepEqual(FULFILMENT_EARLIEST_HOURS_BEFORE_SERVICE, { departed: 24, arrived: 24, picked_up: 3, completed: 3 });
});

test("一个规则一处定义：平台代传的最早时间就是这一份", () => {
  for (const type of FULFILMENT_EVENTS) assert.equal(proxyEarliestHoursBeforeService(type), FULFILMENT_EARLIEST_HOURS_BEFORE_SERVICE[type], type);
  const now = new Date("2026-11-10T12:00:00Z");
  const serviceAt = new Date("2026-11-10T14:00:00Z");
  for (const type of FULFILMENT_EVENTS) {
    const earliest = fulfilmentEarliestAt(type, serviceAt);
    const inWindow = earliest.getTime() <= now.getTime();
    if (!inWindow) continue;
    assert.equal(proxyFulfilmentTimeIssue({ occurredAt: earliest, previousAt: null, serviceAt, now, type }), null, type);
    assert.equal(proxyFulfilmentTimeIssue({ occurredAt: new Date(earliest.getTime() - 1), previousAt: null, serviceAt, now, type }), "TOO_EARLY", type);
  }
});

test("边界：正好在窗口开始那一刻可以点，早 1 毫秒不行（每一步）", () => {
  const serviceAt = new Date("2026-11-10T10:00:00.000Z");
  for (const type of FULFILMENT_EVENTS) {
    const earliest = serviceAt.getTime() - FULFILMENT_EARLIEST_HOURS_BEFORE_SERVICE[type] * HOUR;
    assert.equal(fulfilmentEarliestAt(type, serviceAt).getTime(), earliest, type);
    assert.equal(fulfilmentTooEarly(type, new Date(earliest), serviceAt), false, `${type} 正好`);
    assert.equal(fulfilmentTooEarly(type, new Date(earliest - 1), serviceAt), true, `${type} 早 1 毫秒`);
    assert.equal(fulfilmentTooEarly(type, new Date(serviceAt.getTime() + 10 * HOUR), serviceAt), false, `${type} 晚很多（航班晚点）不管`);
  }
});

test("真实发生的测试单：用车 11-04 20:26（东京），11-02 19:29 点出发、到达、接到、完成，四步都太早", () => {
  const serviceAt = new Date("2026-11-04T11:26:00Z");
  const clickedAt = new Date("2026-11-02T10:29:00Z");
  for (const type of FULFILMENT_EVENTS) assert.equal(fulfilmentTooEarly(type, clickedAt, serviceAt), true, type);
  assert.equal(fulfilmentEarliestLocal("departed", serviceAt, TOKYO), "2026-11-03 20:26");
  assert.equal(fulfilmentEarliestLocal("completed", serviceAt, TOKYO), "2026-11-04 17:26");
});

test("东京时区、跨午夜：用车 11-05 01:30（东京）= UTC 11-04 16:30；完成最早 11-04 22:30，出发最早 11-04 01:30（都按当地时间写）", () => {
  const serviceAt = new Date("2026-11-04T16:30:00Z");
  assert.equal(fulfilmentEarliestLocal("completed", serviceAt, TOKYO), "2026-11-04 22:30");
  assert.equal(fulfilmentEarliestLocal("picked_up", serviceAt, TOKYO), "2026-11-04 22:30");
  assert.equal(fulfilmentEarliestLocal("departed", serviceAt, TOKYO), "2026-11-04 01:30");
  assert.equal(fulfilmentTooEarly("completed", new Date("2026-11-04T13:29:59.999Z"), serviceAt), true, "当地 22:29:59.999");
  assert.equal(fulfilmentTooEarly("completed", new Date("2026-11-04T13:30:00Z"), serviceAt), false, "当地 22:30");
});

test("最早时间带秒时，写给司机的时间进到下一分钟：照着写的时间点不会再被拒", () => {
  const serviceAt = new Date("2026-11-04T11:26:30.500Z");
  assert.equal(fulfilmentEarliestLocal("completed", serviceAt, TOKYO), "2026-11-04 17:27");
  const shown = new Date("2026-11-04T08:27:00Z");
  assert.equal(fulfilmentTooEarly("completed", shown, serviceAt), false);
});

test("太早的说明：哪一步、最早几点（当地时间和时区）、用车时间", () => {
  const serviceAt = new Date("2026-11-04T11:26:00Z");
  const message = fulfilmentTooEarlyMessage("completed", serviceAt, TOKYO);
  assert.match(message, /「服务完成」/);
  assert.match(message, /2026-11-04 17:26/);
  assert.match(message, /Asia\/Tokyo/);
  assert.match(message, /用车时间 2026-11-04 20:26/);
  assert.match(message, /前 3 小时/);
  assert.match(fulfilmentTooEarlyMessage("departed", serviceAt, TOKYO), /「我出发了」.*前 24 小时.*2026-11-03 20:26/);
});

test("夏令时拨回（纽约 2027-11-07 01:00–02:00 出现两次）：最早时间落在第二次时往后写到 02:00，照着点不被拒；落在第一次时照常写", () => {
  const ny = "America/New_York";
  const second = new Date("2027-11-07T04:00:00-05:00");
  assert.equal(fulfilmentEarliestAt("picked_up", second).toISOString(), "2027-11-07T06:00:00.000Z");
  assert.equal(fulfilmentEarliestLocal("picked_up", second, ny), "2027-11-07 02:00");
  assert.equal(fulfilmentTooEarly("picked_up", new Date("2027-11-07T02:00:00-05:00"), second), false);
  const first = new Date("2027-11-07T03:30:00-05:00");
  assert.equal(fulfilmentEarliestLocal("picked_up", first, ny), "2027-11-07 01:30", "最早 05:30Z 是第一次的 01:30（EDT）");
  assert.equal(fulfilmentTooEarly("picked_up", new Date("2027-11-07T01:30:00-04:00"), first), false);
});

test("步骤名用司机页按钮上的叫法", () => {
  assert.deepEqual(DRIVER_ACTION_LABELS, { departed: "我出发了", arrived: "已到达上车点", picked_up: "接到客人了", completed: "服务完成" });
});
