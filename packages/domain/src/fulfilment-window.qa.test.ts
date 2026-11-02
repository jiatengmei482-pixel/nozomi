/**
 * M4-32 测试角色：履约回传时间窗口的纯逻辑（ADR 0064）。
 * - 每一步的边界（正好、早 1 毫秒、晚 1 毫秒）；
 * - 东京以外的时区（半小时、45 分钟偏移、负偏移）、跨午夜、跨月、跨年；
 * - 用车时间带秒时「最早时间」进到下一分钟，照着写的时间点不会再被拒（含进位跨午夜、跨年）；
 * - 夏令时城市：窗口按真实经过的小时算；拨回那一小时写给人看的时间有歧义（ADR 承诺「照着写的时间点不会再被拒」）；
 * - 代传和 ADR 0052 的旧数完全一致；下一步只在能回传的状态有。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FULFILMENT_EARLIEST_HOURS_BEFORE_SERVICE,
  FULFILMENT_EVENTS,
  type FulfilmentEventType,
  fulfilmentEarliestAt,
  fulfilmentEarliestLocal,
  fulfilmentTooEarly,
  fulfilmentTooEarlyMessage,
  nextFulfilmentEvent,
  proxyEarliestHoursBeforeService,
  proxyFulfilmentTimeIssue,
} from "./fulfilment.ts";
import { ORDER_STATUSES } from "./orders.ts";
import { localDateTimeToInstant } from "./service-time.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** 用 Intl 独立算一遍城市当地时间 `YYYY-MM-DD HH:mm`（不经被测代码）。 */
function intlLocal(at: Date, timeZone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at).map((part) => [part.type, part.value]));
  return `${parts["year"]}-${parts["month"]}-${parts["day"]} ${parts["hour"]}:${parts["minute"]}`;
}

test("边界（每一步）：正好那一刻、晚 1 毫秒可以；早 1 毫秒不行", () => {
  const serviceAt = new Date("2026-11-04T11:26:00.000Z");
  for (const type of FULFILMENT_EVENTS) {
    const earliest = serviceAt.getTime() - FULFILMENT_EARLIEST_HOURS_BEFORE_SERVICE[type] * HOUR;
    assert.equal(fulfilmentEarliestAt(type, serviceAt).getTime(), earliest, type);
    assert.equal(fulfilmentTooEarly(type, new Date(earliest - 1), serviceAt), true, `${type} 早 1 毫秒`);
    assert.equal(fulfilmentTooEarly(type, new Date(earliest), serviceAt), false, `${type} 正好`);
    assert.equal(fulfilmentTooEarly(type, new Date(earliest + 1), serviceAt), false, `${type} 晚 1 毫秒`);
  }
});

test("只管太早：用车时间之后很久（航班晚 12 小时、两天）照样可以", () => {
  const serviceAt = new Date("2026-11-04T11:26:00.000Z");
  for (const type of FULFILMENT_EVENTS) {
    for (const late of [0, 6 * HOUR, 12 * HOUR, 48 * HOUR]) assert.equal(fulfilmentTooEarly(type, new Date(serviceAt.getTime() + late), serviceAt), false, `${type} +${late}`);
  }
});

test("业主的测试单：用车 11-04 20:26（东京），11-02 19:29 点四步全都太早", () => {
  const serviceAt = new Date("2026-11-04T20:26:00+09:00");
  const clicked = new Date("2026-11-02T19:29:00+09:00");
  for (const [i, type] of FULFILMENT_EVENTS.entries()) assert.equal(fulfilmentTooEarly(type, new Date(clicked.getTime() + i * 5_000), serviceAt), true, type);
  assert.equal(fulfilmentEarliestLocal("departed", serviceAt, "Asia/Tokyo"), "2026-11-03 20:26");
  assert.equal(fulfilmentEarliestLocal("completed", serviceAt, "Asia/Tokyo"), "2026-11-04 17:26");
});

test("东京：跨午夜、跨月、跨年都按当地日期写", () => {
  const tokyo = "Asia/Tokyo";
  // 用车 11-05 01:00：出发最早 11-04 01:00；接到客人最早前一天 22:00
  assert.equal(fulfilmentEarliestLocal("departed", new Date("2026-11-05T01:00:00+09:00"), tokyo), "2026-11-04 01:00");
  assert.equal(fulfilmentEarliestLocal("picked_up", new Date("2026-11-05T01:00:00+09:00"), tokyo), "2026-11-04 22:00");
  // 跨月：12-01 02:00
  assert.equal(fulfilmentEarliestLocal("arrived", new Date("2026-12-01T02:00:00+09:00"), tokyo), "2026-11-30 02:00");
  assert.equal(fulfilmentEarliestLocal("completed", new Date("2026-12-01T02:00:00+09:00"), tokyo), "2026-11-30 23:00");
  // 跨年：01-01 00:30
  assert.equal(fulfilmentEarliestLocal("picked_up", new Date("2027-01-01T00:30:00+09:00"), tokyo), "2026-12-31 21:30");
  assert.equal(fulfilmentEarliestLocal("departed", new Date("2027-01-01T00:30:00+09:00"), tokyo), "2026-12-31 00:30");
  // 闰年 2028-03-01 → 02-29
  assert.equal(fulfilmentEarliestLocal("departed", new Date("2028-03-01T10:00:00+09:00"), tokyo), "2028-02-29 10:00");
  // UTC 日期和东京日期不同的时刻（东京 08:00 = UTC 前一天 23:00）
  assert.equal(fulfilmentEarliestLocal("picked_up", new Date("2026-11-05T08:00:00+09:00"), tokyo), "2026-11-05 05:00");
});

test("其他时区（首尔、加德满都 +5:45、印度 +5:30、纽芬兰 −3:30、查塔姆 +13:45、檀香山 −10）：和 Intl 独立算的一致", () => {
  const zones = ["Asia/Seoul", "Asia/Kathmandu", "Asia/Kolkata", "America/St_Johns", "Pacific/Chatham", "Pacific/Honolulu", "UTC"];
  const services = ["2026-11-04T11:26:00Z", "2026-12-31T15:00:00Z", "2027-01-01T00:00:00Z", "2027-06-15T23:45:00Z"].map((value) => new Date(value));
  for (const zone of zones) {
    for (const serviceAt of services) {
      for (const type of FULFILMENT_EVENTS) {
        const expected = intlLocal(fulfilmentEarliestAt(type, serviceAt), zone);
        assert.equal(fulfilmentEarliestLocal(type, serviceAt, zone), expected, `${zone} ${serviceAt.toISOString()} ${type}`);
      }
    }
  }
});

test("用车时间带秒：最早时间进到下一分钟（含进位跨午夜、跨年）；整分钟不进位；时刻本身不变", () => {
  const tokyo = "Asia/Tokyo";
  assert.equal(fulfilmentEarliestLocal("completed", new Date("2026-11-04T20:26:30+09:00"), tokyo), "2026-11-04 17:27");
  assert.equal(fulfilmentEarliestLocal("completed", new Date("2026-11-04T20:26:00.001+09:00"), tokyo), "2026-11-04 17:27");
  assert.equal(fulfilmentEarliestLocal("completed", new Date("2026-11-04T20:26:00.000+09:00"), tokyo), "2026-11-04 17:26");
  assert.equal(fulfilmentEarliestLocal("completed", new Date("2026-11-04T20:26:59.999+09:00"), tokyo), "2026-11-04 17:27");
  // 23:59:30 → 次日 00:00；12-31 23:59:30 → 次年
  assert.equal(fulfilmentEarliestLocal("picked_up", new Date("2026-11-06T02:59:30+09:00"), tokyo), "2026-11-06 00:00");
  assert.equal(fulfilmentEarliestLocal("picked_up", new Date("2027-01-01T02:59:30+09:00"), tokyo), "2027-01-01 00:00");
  assert.equal(fulfilmentEarliestLocal("departed", new Date("2027-01-01T23:59:01+09:00"), tokyo), "2027-01-01 00:00");
  // 判断用的时刻不进位
  assert.equal(fulfilmentEarliestAt("picked_up", new Date("2027-01-01T02:59:30+09:00")).toISOString(), "2026-12-31T14:59:30.000Z");
});

test("照着写给人看的最早时间（当地时间、整分钟）去点不会被拒，早一分钟会被拒：非夏令时城市", () => {
  const zones = ["Asia/Tokyo", "Asia/Seoul", "Asia/Kathmandu", "America/St_Johns", "Pacific/Chatham"];
  const seconds = [0, 1, 29, 30, 59];
  for (const zone of zones) {
    for (const second of seconds) {
      const serviceAt = new Date(Date.UTC(2026, 10, 4, 11, 26, second, second === 59 ? 999 : 0));
      for (const type of FULFILMENT_EVENTS) {
        const shown = fulfilmentEarliestLocal(type, serviceAt, zone);
        const at = localDateTimeToInstant(shown.replace(" ", "T"), zone);
        assert.ok(at !== null, shown);
        assert.equal(fulfilmentTooEarly(type, at, serviceAt), false, `${zone} :${second} ${type} 照着 ${shown} 点`);
        assert.equal(fulfilmentTooEarly(type, new Date(at.getTime() - MINUTE), serviceAt), true, `${zone} :${second} ${type} 早一分钟`);
      }
    }
  }
});

test("夏令时城市（纽约、伦敦）：窗口按真实经过的小时，不按钟面（拨快那天写出来是前一天 11:00）", () => {
  // 2027-03-14 02:00 纽约拨快。用车 03-14 12:00 EDT（16:00Z）→ 出发最早 03-13 16:00Z = 11:00 EST
  const ny = "America/New_York";
  const serviceAt = new Date("2027-03-14T12:00:00-04:00");
  assert.equal(fulfilmentEarliestAt("departed", serviceAt).toISOString(), "2027-03-13T16:00:00.000Z");
  assert.equal(fulfilmentEarliestLocal("departed", serviceAt, ny), "2027-03-13 11:00");
  assert.equal(fulfilmentEarliestLocal("picked_up", serviceAt, ny), "2027-03-14 09:00");
  // 伦敦 2027-03-28 01:00 拨快：用车 03-28 03:30 BST（02:30Z）→ 接到客人最早 03-27 23:30Z = 23:30 GMT
  assert.equal(fulfilmentEarliestLocal("picked_up", new Date("2027-03-28T03:30:00+01:00"), "Europe/London"), "2027-03-27 23:30");
  // 拨回那天（11-07 02:00 EDT → 01:00 EST）：用车 11-07 12:00 EST，出发最早 11-06 17:00Z = 13:00 EDT
  assert.equal(fulfilmentEarliestLocal("departed", new Date("2027-11-07T12:00:00-05:00"), ny), "2027-11-06 13:00");
});

test("夏令时拨回的那一小时：写给人看的「最早 01:00」照着点也不应被拒（ADR 0064「照着写的时间去点不会再被拒」）", () => {
  // 纽约 2027-11-07 01:00–02:00 出现两次。用车 11-07 04:00 EST（09:00Z）→ 接到客人最早 06:00Z = 第二个 01:00（EST）。
  // 页面只写「2027-11-07 01:00」不带偏移；司机在第一个 01:00（EDT，05:00Z）照着点会被拒，说明里仍写「最早 01:00 以后才能点」。
  const ny = "America/New_York";
  const serviceAt = new Date("2027-11-07T04:00:00-05:00");
  const shown = fulfilmentEarliestLocal("picked_up", serviceAt, ny);
  assert.equal(shown, "2027-11-07 01:00");
  const firstOccurrence = new Date("2027-11-07T01:00:00-04:00");
  assert.equal(intlLocal(firstOccurrence, ny), shown, "这一刻手机上看到的当地时间就是写着的 01:00");
  assert.equal(fulfilmentTooEarly("picked_up", firstOccurrence, serviceAt), false, "照着写的当地时间点了却被拒：拨回那一小时的最早时间要么写明偏移（EST/EDT），要么按先到的那一次给");
});

test("说明：哪一步、几小时、最早几点（当地时间）、时区、用车时间、联系调度", () => {
  const serviceAt = new Date("2026-11-04T20:26:00+09:00");
  assert.equal(
    fulfilmentTooEarlyMessage("completed", serviceAt, "Asia/Tokyo"),
    "现在还不能点「服务完成」：最早在用车前 3 小时，也就是 2026-11-04 17:26（Asia/Tokyo 当地时间）以后才能点（用车时间 2026-11-04 20:26）。行程有变请联系调度。",
  );
  const names: Record<FulfilmentEventType, string> = { departed: "我出发了", arrived: "已到达上车点", picked_up: "接到客人了", completed: "服务完成" };
  for (const type of FULFILMENT_EVENTS) {
    const text = fulfilmentTooEarlyMessage(type, new Date("2026-11-05T01:00:00+09:00"), "Asia/Seoul");
    assert.ok(text.includes(`「${names[type]}」`), text);
    assert.ok(text.includes(`用车前 ${FULFILMENT_EARLIEST_HOURS_BEFORE_SERVICE[type]} 小时`), text);
    assert.ok(text.includes(`${fulfilmentEarliestLocal(type, new Date("2026-11-05T01:00:00+09:00"), "Asia/Seoul")}（Asia/Seoul 当地时间）`), text);
    assert.ok(text.includes("用车时间 2026-11-05 01:00"), text);
  }
});

test("代传和 ADR 0052 的旧数一致：出发、到达 24 小时，接到客人、完成 3 小时；不说哪一步按 24 小时；正好、早 1 毫秒", () => {
  assert.deepEqual(Object.fromEntries(FULFILMENT_EVENTS.map((type) => [type, proxyEarliestHoursBeforeService(type)])), { departed: 24, arrived: 24, picked_up: 3, completed: 3 });
  assert.equal(proxyEarliestHoursBeforeService(), 24);
  const serviceAt = new Date("2026-11-04T11:26:00.000Z");
  const now = new Date(serviceAt.getTime() + HOUR);
  for (const type of [...FULFILMENT_EVENTS, undefined]) {
    const hours = type === undefined ? 24 : { departed: 24, arrived: 24, picked_up: 3, completed: 3 }[type];
    const edge = serviceAt.getTime() - hours * HOUR;
    const issue = (at: number) => proxyFulfilmentTimeIssue({ occurredAt: new Date(at), previousAt: null, serviceAt, now, ...(type === undefined ? {} : { type }) });
    assert.equal(issue(edge), null, `${type} 正好`);
    assert.equal(issue(edge - 1), "TOO_EARLY", `${type} 早 1 毫秒`);
    assert.equal(issue(edge + 1), null, `${type} 晚 1 毫秒`);
  }
});

test("下一步：已派车→出发→到达→接到→完成；其他状态（待派车、已完成、已取消、no-show 等）没有下一步", () => {
  const expected: Record<string, FulfilmentEventType> = { assigned: "departed", departed: "arrived", arrived: "picked_up", in_service: "completed" };
  for (const status of ORDER_STATUSES) assert.equal(nextFulfilmentEvent(status), expected[status] ?? null, status);
});
