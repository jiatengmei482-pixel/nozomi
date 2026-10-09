/**
 * M1-05 测试工程师补充：库存的纯规则和表格里数字、日期的读法——边界一个个过。
 * 名字以「【缺陷】」开头的是现在会失败的测试。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INVENTORY_LIMITS,
  type InventoryDay,
  addDays,
  hasInventory,
  instantToLocal,
  inventoryBatchDates,
  inventoryBatchIssues,
  inventoryDateIssue,
  inventoryDayStatus,
  inventoryOccupiedBlocking,
  inventoryRemaining,
  inventoryTotalIssue,
  parseMajor,
  plainDecimal,
  plainInteger,
  sheetDate,
  weekdayOf,
} from "./index.ts";

const day = (total: number, held = 0, sold = 0): InventoryDay => ({ total, held, sold });

test("hasInventory / inventoryRemaining / inventoryDayStatus 三个函数对同一天的说法一致：穷举 0–4 的总数、预占、已售和要占的单数", () => {
  for (let total = 0; total <= 4; total += 1) {
    for (let held = 0; held <= total; held += 1) {
      for (let sold = 0; held + sold <= total; sold += 1) {
        const current = day(total, held, sold);
        const remaining = inventoryRemaining("limited", current);
        const status = inventoryDayStatus("limited", current);
        assert.equal(remaining, total - held - sold);
        assert.equal(status, total === 0 ? "closed" : remaining === 0 ? "sold_out" : "open");
        for (let quantity = 1; quantity <= 5; quantity += 1) assert.equal(hasInventory("limited", current, quantity), (remaining as number) >= quantity, `${total}/${held}/${sold} 占 ${quantity}`);
        assert.equal(hasInventory("limited", current), status === "open", "默认占 1 单：只有「可售」的日子有库存");
        // 不限量：这些数不起作用
        assert.deepEqual([inventoryRemaining("unlimited", current), hasInventory("unlimited", current, 9_999), inventoryDayStatus("unlimited", current)], [null, true, "unlimited"]);
      }
    }
  }
  // 没设过的日子：限量 = 不可售，不限量 = 可售
  assert.deepEqual([inventoryRemaining("limited", null), hasInventory("limited", null), inventoryDayStatus("limited", null)], [0, false, "unset"]);
  assert.deepEqual([inventoryRemaining("unlimited", null), hasInventory("unlimited", null), inventoryDayStatus("unlimited", null)], [null, true, "unlimited"]);
  // 数据被弄坏（占用超过总数）时剩余不出负数，也不当成有库存
  assert.deepEqual([inventoryRemaining("limited", day(2, 2, 1)), hasInventory("limited", day(2, 2, 1)), inventoryDayStatus("limited", day(2, 2, 1))], [0, false, "sold_out"]);
});

test("批量设置选中的日期：闰日、跨年、跨月、星期筛选、366 天的上限——和逐天数出来的一样", () => {
  assert.deepEqual(inventoryBatchDates({ from: "2028-02-27", to: "2028-03-02", weekdays: [] }), ["2028-02-27", "2028-02-28", "2028-02-29", "2028-03-01", "2028-03-02"]);
  assert.deepEqual(inventoryBatchDates({ from: "2027-02-27", to: "2027-03-01", weekdays: [] }), ["2027-02-27", "2027-02-28", "2027-03-01"]);
  assert.deepEqual(inventoryBatchDates({ from: "2026-12-30", to: "2027-01-02", weekdays: [] }), ["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  assert.deepEqual(inventoryBatchDates({ from: "2026-10-07", to: "2026-10-07", weekdays: [] }), ["2026-10-07"]);
  // 2026-10-07 是周三
  assert.equal(weekdayOf("2026-10-07"), 3);
  assert.deepEqual(inventoryBatchDates({ from: "2026-10-07", to: "2026-10-20", weekdays: [6, 7] }), ["2026-10-10", "2026-10-11", "2026-10-17", "2026-10-18"]);
  assert.deepEqual(inventoryBatchDates({ from: "2026-10-07", to: "2026-10-09", weekdays: [1] }), []);
  // 一整年（含闰日）：每个星期各 52 或 53 天，加起来正好 366
  const year = inventoryBatchDates({ from: "2028-01-01", to: "2028-12-31", weekdays: [] });
  assert.equal(year.length, 366);
  assert.equal(new Set(year).size, 366);
  let sum = 0;
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    const picked = inventoryBatchDates({ from: "2028-01-01", to: "2028-12-31", weekdays: [weekday] });
    assert.ok(picked.every((date) => weekdayOf(date) === weekday) && [52, 53].includes(picked.length));
    sum += picked.length;
  }
  assert.equal(sum, 366);
  // 夏令时切换的那几天（纽约 2026-03-08、2026-11-01；伦敦 2026-03-29、2026-10-25）：日期是日历上的日子，不多不少
  assert.deepEqual(inventoryBatchDates({ from: "2026-03-07", to: "2026-03-09", weekdays: [] }), ["2026-03-07", "2026-03-08", "2026-03-09"]);
  assert.deepEqual(inventoryBatchDates({ from: "2026-10-31", to: "2026-11-02", weekdays: [] }), ["2026-10-31", "2026-11-01", "2026-11-02"]);
  assert.deepEqual(inventoryBatchDates({ from: "2026-10-24", to: "2026-10-26", weekdays: [] }), ["2026-10-24", "2026-10-25", "2026-10-26"]);
  // 不合法的范围：空
  for (const [from, to] of [["2026-10-08", "2026-10-07"], ["2026-02-30", "2026-03-01"], ["", ""], ["2026-10-07", "2026/10/08"]] as const) assert.deepEqual(inventoryBatchDates({ from, to, weekdays: [] }), []);
});

test("批量设置的校验边界：今天可以、昨天不行；第 730 天可以、第 731 天不行；366 天可以、367 天不行；星期和数量逐项", () => {
  const today = "2026-10-07";
  const reasons = (batch: Partial<{ from: string; to: string; weekdays: number[]; total: number | null }>): string[] => inventoryBatchIssues({ from: today, to: today, weekdays: [], total: 1, ...batch }, today).map((issue) => `${issue.path} ${issue.reason}`);
  assert.deepEqual(reasons({}), []);
  assert.deepEqual(reasons({ from: "2026-10-06" }), ["/from DATE_IN_PAST"]);
  assert.deepEqual(reasons({ from: "2026-10-06", to: "2026-10-06" }), ["/from DATE_IN_PAST"], "结束日期在过去只报一次");
  const last = addDays(today, INVENTORY_LIMITS.maxDaysAhead);
  assert.deepEqual(reasons({ from: last, to: last }), []);
  assert.deepEqual(reasons({ from: last, to: addDays(last, 1) }), ["/to TOO_FAR_AHEAD"]);
  assert.deepEqual(reasons({ to: addDays(today, 365) }), []);
  assert.deepEqual(reasons({ to: addDays(today, 366) }), ["/to TOO_MANY"]);
  assert.deepEqual(reasons({ from: "2026-10-09", to: "2026-10-08" }), ["/to DATE_RANGE_REVERSED"]);
  assert.deepEqual(reasons({ from: "2026-02-30" }), ["/from INVALID_DATE"]);
  assert.deepEqual(reasons({ weekdays: [0, 8, 1.5, 3, 3] }), ["/weekdays/0 OUT_OF_RANGE", "/weekdays/1 OUT_OF_RANGE", "/weekdays/2 NOT_INTEGER", "/weekdays/4 DUPLICATE"]);
  assert.deepEqual(reasons({ weekdays: [1] }), ["/weekdays NO_DAY_SELECTED"], "今天是周三，只选周一就一天都没有");
  for (const [total, reason] of [[-1, "OUT_OF_RANGE"], [10_000, "OUT_OF_RANGE"], [1.5, "NOT_INTEGER"], [Number.NaN, "NOT_INTEGER"], [Number.POSITIVE_INFINITY, "NOT_INTEGER"]] as const) assert.equal(inventoryTotalIssue(total), reason);
  for (const total of [0, 1, 9_999, null]) assert.equal(inventoryTotalIssue(total), null);
  assert.equal(inventoryTotalIssue(-0), null);
  // 闰日当天往后 730 天
  assert.equal(inventoryDateIssue(addDays("2028-02-29", 730), "2028-02-29"), null);
  assert.equal(inventoryDateIssue(addDays("2028-02-29", 731), "2028-02-29"), "TOO_FAR_AHEAD");
});

test("「今天」是城市当地的日期：同一个时刻，东京已经是第二天、纽约还是前一天；夏令时切换前后、跨年、跨月的午夜", () => {
  const local = (iso: string, zone: string): string => instantToLocal(new Date(iso), zone).date;
  assert.deepEqual([local("2026-10-07T15:30:00Z", "Asia/Tokyo"), local("2026-10-07T15:30:00Z", "America/New_York"), local("2026-10-07T15:30:00Z", "UTC")], ["2026-10-08", "2026-10-07", "2026-10-07"]);
  // 东京的午夜前后一秒
  assert.deepEqual([local("2026-10-07T14:59:59Z", "Asia/Tokyo"), local("2026-10-07T15:00:00Z", "Asia/Tokyo")], ["2026-10-07", "2026-10-08"]);
  // 纽约：夏令时开始那天（2026-03-08，当天只有 23 小时）和结束那天（2026-11-01，25 小时）的午夜
  assert.deepEqual([local("2026-03-08T04:59:59Z", "America/New_York"), local("2026-03-08T05:00:00Z", "America/New_York"), local("2026-03-09T03:59:59Z", "America/New_York"), local("2026-03-09T04:00:00Z", "America/New_York")], ["2026-03-07", "2026-03-08", "2026-03-08", "2026-03-09"]);
  assert.deepEqual([local("2026-11-01T03:59:59Z", "America/New_York"), local("2026-11-01T04:00:00Z", "America/New_York"), local("2026-11-02T04:59:59Z", "America/New_York"), local("2026-11-02T05:00:00Z", "America/New_York")], ["2026-10-31", "2026-11-01", "2026-11-01", "2026-11-02"]);
  // 跨年、跨月、闰日
  assert.deepEqual([local("2026-12-31T14:59:59Z", "Asia/Tokyo"), local("2026-12-31T15:00:00Z", "Asia/Tokyo"), local("2028-02-28T15:00:00Z", "Asia/Tokyo"), local("2028-02-29T15:00:00Z", "Asia/Tokyo")], ["2026-12-31", "2027-01-01", "2028-02-29", "2028-03-01"]);
  // 当地的今天可以设、昨天不行：纽约的「今天」比东京晚
  const now = new Date("2026-10-07T15:30:00Z");
  assert.equal(inventoryDateIssue("2026-10-07", instantToLocal(now, "Asia/Tokyo").date), "DATE_IN_PAST");
  assert.equal(inventoryDateIssue("2026-10-07", instantToLocal(now, "America/New_York").date), null);
});

test("占用保护：能改到正好等于占用数，少一单就不行；没有占用的随便改；清除只在没有占用时可以", () => {
  for (let held = 0; held <= 3; held += 1) {
    for (let sold = 0; sold <= 3; sold += 1) {
      const occupied = held + sold;
      const current = day(6, held, sold);
      assert.equal(inventoryOccupiedBlocking(current, occupied), null);
      assert.equal(inventoryOccupiedBlocking(current, 9_999), null);
      assert.equal(inventoryOccupiedBlocking(current, null), occupied === 0 ? null : occupied);
      if (occupied > 0) assert.equal(inventoryOccupiedBlocking(current, occupied - 1), occupied);
    }
  }
  assert.equal(inventoryOccupiedBlocking(null, null), null);
  assert.equal(inventoryOccupiedBlocking(null, 0), null);
});

test("表格里的数字换成金额：0 位和 2 位小数的币种、超精度、负数、千分位、全角、空格、科学计数、极大数——要么是准确的整数，要么读不出来，从不四舍五入", () => {
  /** 导入时金额的读法：先写成普通十进制，再按币种换成最小单位；读不出来 / 超精度分别给出 */
  const amount = (text: string, currency: "JPY" | "USD"): number | "NOT_A_NUMBER" | "REJECTED" => {
    const plain = plainDecimal(text);
    if (plain === null) return "NOT_A_NUMBER";
    try {
      return parseMajor(plain, currency);
    } catch {
      return "REJECTED";
    }
  };
  const cases: [string, number | "NOT_A_NUMBER" | "REJECTED", number | "NOT_A_NUMBER" | "REJECTED"][] = [
    ["20000", 20_000, 2_000_000],
    ["20000.0", 20_000, 2_000_000],
    ["20000.00", 20_000, 2_000_000],
    ["123.45", "REJECTED", 12_345],
    ["123.4", "REJECTED", 12_340],
    ["123.450", "REJECTED", 12_345],
    ["123.456", "REJECTED", "REJECTED"],
    ["0.005", "REJECTED", "REJECTED"],
    ["0.01", "REJECTED", 1],
    ["0.1", "REJECTED", 10],
    ["0.30000000000000004", "REJECTED", "REJECTED"],
    ["18500.000000001", "REJECTED", "REJECTED"],
    ["1.005", "REJECTED", "REJECTED"],
    ["1,234", 1_234, 123_400],
    ["1,234,567.89", "REJECTED", 123_456_789],
    ["12,34", "NOT_A_NUMBER", "NOT_A_NUMBER"],
    ["1,2345", "NOT_A_NUMBER", "NOT_A_NUMBER"],
    [",123", "NOT_A_NUMBER", "NOT_A_NUMBER"],
    ["1e3", 1_000, 100_000],
    ["1.2E+4", 12_000, 1_200_000],
    ["1.2345E+2", "REJECTED", 12_345],
    ["12345E-2", "REJECTED", 12_345],
    ["1E-3", "REJECTED", "REJECTED"],
    ["1e21", "REJECTED", "REJECTED"],
    ["9007199254740991", 9_007_199_254_740_991, "REJECTED"],
    ["9007199254740992", "REJECTED", "REJECTED"],
    ["90071992547409.91", "REJECTED", 9_007_199_254_740_991],
    ["90071992547409.92", "REJECTED", "REJECTED"],
    ["1e400", "NOT_A_NUMBER", "NOT_A_NUMBER"],
    ["-100", -100, -10_000],
    ["-0", 0, 0],
    ["-0.00", 0, 0],
    ["+100", 100, 10_000],
    ["  100  ", 100, 10_000],
    ["100 ", 100, 10_000],
    ["1 000", "NOT_A_NUMBER", "NOT_A_NUMBER"],
    ["２００００", "NOT_A_NUMBER", "NOT_A_NUMBER"],
    ["20000円", "NOT_A_NUMBER", "NOT_A_NUMBER"],
    ["¥20000", "NOT_A_NUMBER", "NOT_A_NUMBER"],
    ["$1.00", "NOT_A_NUMBER", "NOT_A_NUMBER"],
    ["(100)", "NOT_A_NUMBER", "NOT_A_NUMBER"],
    ["1.", "NOT_A_NUMBER", "NOT_A_NUMBER"],
    [".5", "NOT_A_NUMBER", "NOT_A_NUMBER"],
    ["0x10", "NOT_A_NUMBER", "NOT_A_NUMBER"],
    ["1_000", "NOT_A_NUMBER", "NOT_A_NUMBER"],
    ["NaN", "NOT_A_NUMBER", "NOT_A_NUMBER"],
    ["Infinity", "NOT_A_NUMBER", "NOT_A_NUMBER"],
    ["", "NOT_A_NUMBER", "NOT_A_NUMBER"],
    ["1e", "NOT_A_NUMBER", "NOT_A_NUMBER"],
    ["--1", "NOT_A_NUMBER", "NOT_A_NUMBER"],
    ["1.2.3", "NOT_A_NUMBER", "NOT_A_NUMBER"],
  ];
  for (const [text, jpy, usd] of cases) assert.deepEqual([amount(text, "JPY"), amount(text, "USD")], [jpy, usd], JSON.stringify(text));
  // 所有两位小数的金额都一分不差（浮点数乘 100 会错的那些：0.07、0.57、1.15、4.35、8.2、19.99、1.005 …）
  for (let cents = 0; cents <= 20_000; cents += 1) {
    const major = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
    assert.equal(amount(major, "USD"), cents);
  }
});

test("表格里的整数和日期：小数、科学计数、负数、极大数；1900 / 1904 纪元、1900-02-29 那个不存在的日子、带时间的、闰日", () => {
  const integers: [string, number | null][] = [["10", 10], ["10.0", 10], ["1E+1", 10], ["1.5", null], ["1e-1", null], ["-3", -3], ["0", 0], ["-0", 0], ["9999", 9_999], ["1,000", 1_000], ["9007199254740991", 9_007_199_254_740_991], ["9007199254740992", null], ["1e21", null], ["", null], ["十", null], ["１０", null], ["0.30000000000000004", null], ["3.0000000000000001", null]];
  for (const [text, expected] of integers) assert.equal(plainInteger(text), expected, JSON.stringify(text));
  // 1900 纪元：61 = 1900-03-01；60 是 Excel 虚构的 1900-02-29，59 及以前和真实日历差一天——都不认
  for (const serial of ["60", "59", "1", "0", "-1", "46296.5", "46296.25", "2958466"]) assert.equal(sheetDate(serial), null, serial);
  assert.deepEqual([sheetDate("61"), sheetDate("46296"), sheetDate("46296.0"), sheetDate("4.6296E4"), sheetDate("47177"), sheetDate("2958465")], ["1900-03-01", "2026-10-01", "2026-10-01", "2026-10-01", "2029-02-28", "9999-12-31"]);
  // 闰日的序号：2028-02-29
  assert.equal(sheetDate(String(46296 + (Date.UTC(2028, 1, 29) - Date.UTC(2026, 9, 1)) / 86_400_000)), "2028-02-29");
  // 1904 纪元：同一个序号晚 1462 天
  assert.deepEqual([sheetDate("0", { date1904: true }), sheetDate("44834", { date1904: true }), sheetDate("-1", { date1904: true })], ["1904-01-01", "2026-10-01", null]);
  assert.equal(sheetDate("44834", { date1904: true }), sheetDate(String(44834 + 1462)));
  // 写成文字的
  const written: [string, string | null][] = [["2026-10-01", "2026-10-01"], ["2026/10/1", "2026-10-01"], ["2026.1.5", "2026-01-05"], [" 2026-10-01 ", "2026-10-01"], ["2026-10-01T00:00:00Z", "2026-10-01"], ["2026-10-01 00:00:00", "2026-10-01"], ["2028-02-29", "2028-02-29"], ["2026-02-29", null], ["2100-02-29", null], ["2026-04-31", null], ["2026-13-01", null], ["2026-00-10", null], ["2026-10-00", null], ["2026-10-01T10:00:00", null], ["2026-10-01 23:59", null], ["10/1/2026", null], ["2026年10月1日", null], ["20261001", null], ["26-10-01", null], ["2026-10-01-02", null], ["", null], ["明天", null]];
  for (const [text, expected] of written) assert.equal(sheetDate(text), expected, JSON.stringify(text));
});

test("【缺陷】「0,500」这种欧洲写法的小数（0.5）被当成千分位读成 500——整数部分是 0 的不该当千分位", () => {
  assert.equal(plainDecimal("0,500"), null);
  assert.equal(plainDecimal("0,123,456"), null);
});
