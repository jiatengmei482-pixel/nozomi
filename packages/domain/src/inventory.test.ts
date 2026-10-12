/** M1-05：库存的规则。对应需求文档「5. 商品 · ④ 库存」和报价引擎第 9 步「有限库存时当日剩余 > 0」。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INVENTORY_LIMITS,
  INVENTORY_MODES,
  INVENTORY_MODE_NAMES,
  type InventoryBatch,
  hasInventory,
  inventoryBatchDates,
  inventoryBatchIssues,
  inventoryDateIssue,
  inventoryDayStatus,
  inventoryOccupiedBlocking,
  inventoryRemaining,
  inventoryTotalIssue,
} from "./inventory.ts";
import { addDays } from "./pricing.ts";

const TODAY = "2026-10-07"; // 周三
const day = (total: number, held = 0, sold = 0) => ({ total, held, sold });
const batch = (extra: Partial<InventoryBatch> = {}): InventoryBatch => ({ from: "2026-10-10", to: "2026-10-20", weekdays: [], total: 5, ...extra });
const reasons = (issues: { path: string; reason: string }[]): string[] => issues.map((issue) => `${issue.path} ${issue.reason}`);

test("模式：无限（默认）和有限，都有中文名", () => {
  assert.deepEqual([...INVENTORY_MODES], ["unlimited", "limited"]);
  assert.deepEqual(INVENTORY_MODES.map((mode) => INVENTORY_MODE_NAMES[mode]), ["不限量", "限量"]);
});

test("剩余和有没有库存：不限量永远有；限量时剩余 = 总数 − 预占 − 已售，剩余 > 0 才有；没设过的日子没有", () => {
  assert.equal(inventoryRemaining("unlimited", null), null);
  assert.equal(inventoryRemaining("unlimited", day(0)), null, "不限量时设过的数不起作用");
  assert.equal(hasInventory("unlimited", null), true);
  assert.equal(hasInventory("unlimited", day(0), 99), true);
  assert.deepEqual([inventoryRemaining("limited", null), hasInventory("limited", null)], [0, false], "限量但这一天没设：不可售");
  assert.deepEqual([inventoryRemaining("limited", day(5)), hasInventory("limited", day(5))], [5, true]);
  assert.deepEqual([inventoryRemaining("limited", day(5, 2, 2)), hasInventory("limited", day(5, 2, 2))], [1, true]);
  assert.deepEqual([inventoryRemaining("limited", day(5, 2, 3)), hasInventory("limited", day(5, 2, 3))], [0, false], "占满了");
  assert.deepEqual([inventoryRemaining("limited", day(0)), hasInventory("limited", day(0))], [0, false], "停售");
  assert.equal(inventoryRemaining("limited", day(3, 2, 2)), 0, "不会是负数");
  // 一次要几单
  assert.deepEqual([hasInventory("limited", day(5, 1, 1), 3), hasInventory("limited", day(5, 1, 1), 4)], [true, false]);
});

test("库存日历上一天的状态：不限量 / 没设 / 停售 / 售罄 / 可售", () => {
  assert.equal(inventoryDayStatus("unlimited", null), "unlimited");
  assert.equal(inventoryDayStatus("unlimited", day(0)), "unlimited");
  assert.equal(inventoryDayStatus("limited", null), "unset");
  assert.equal(inventoryDayStatus("limited", day(0)), "closed");
  assert.equal(inventoryDayStatus("limited", day(3, 1, 2)), "sold_out");
  assert.equal(inventoryDayStatus("limited", day(3, 1, 1)), "open");
});

test("可售单数和日期的校验：0 到 9999 的整数，null = 清除；日期合法、不早于今天、不超过两年以后", () => {
  assert.deepEqual([null, 0, 1, 9_999].map(inventoryTotalIssue), [null, null, null, null]);
  assert.deepEqual([-1, 10_000, 1.5, Number.NaN].map(inventoryTotalIssue), ["OUT_OF_RANGE", "OUT_OF_RANGE", "NOT_INTEGER", "NOT_INTEGER"]);
  assert.equal(inventoryDateIssue(TODAY, TODAY), null, "今天可以设");
  assert.equal(inventoryDateIssue("2026-10-06", TODAY), "DATE_IN_PAST");
  assert.equal(inventoryDateIssue("2026-02-30", TODAY), "INVALID_DATE");
  assert.equal(inventoryDateIssue(addDays(TODAY, INVENTORY_LIMITS.maxDaysAhead), TODAY), null);
  assert.equal(inventoryDateIssue(addDays(TODAY, INVENTORY_LIMITS.maxDaysAhead + 1), TODAY), "TOO_FAR_AHEAD");
});

test("批量设置：日期范围（两端都含）× 星期（空 = 每天）× 数量；不填数量 = 清除", () => {
  assert.deepEqual(inventoryBatchIssues(batch(), TODAY), []);
  assert.deepEqual(inventoryBatchIssues(batch({ total: null }), TODAY), [], "清除");
  assert.deepEqual(inventoryBatchIssues(batch({ total: 0 }), TODAY), [], "停售");
  assert.deepEqual(inventoryBatchIssues(batch({ from: TODAY, to: TODAY }), TODAY), [], "只设今天这一天");
  assert.deepEqual(reasons(inventoryBatchIssues(batch({ from: "2026-10-06" }), TODAY)), ["/from DATE_IN_PAST"]);
  assert.deepEqual(reasons(inventoryBatchIssues(batch({ from: "2026-13-01" }), TODAY)), ["/from INVALID_DATE"]);
  assert.deepEqual(reasons(inventoryBatchIssues(batch({ from: "2026-10-20", to: "2026-10-10" }), TODAY)), ["/to DATE_RANGE_REVERSED"]);
  assert.deepEqual(reasons(inventoryBatchIssues(batch({ to: addDays("2026-10-10", 365) }), TODAY)), [], "正好 366 天");
  assert.deepEqual(reasons(inventoryBatchIssues(batch({ to: addDays("2026-10-10", 366) }), TODAY)), ["/to TOO_MANY"]);
  assert.deepEqual(reasons(inventoryBatchIssues(batch({ from: addDays(TODAY, 700), to: addDays(TODAY, 731) }), TODAY)), ["/to TOO_FAR_AHEAD"]);
  assert.deepEqual(reasons(inventoryBatchIssues(batch({ weekdays: [0, 8, 1.5, 3, 3] }), TODAY)), ["/weekdays/0 OUT_OF_RANGE", "/weekdays/1 OUT_OF_RANGE", "/weekdays/2 NOT_INTEGER", "/weekdays/4 DUPLICATE"]);
  assert.deepEqual(reasons(inventoryBatchIssues(batch({ total: -1 }), TODAY)), ["/total OUT_OF_RANGE"]);
  assert.deepEqual(reasons(inventoryBatchIssues(batch({ total: 2.5 }), TODAY)), ["/total NOT_INTEGER"]);
  // 2026-10-12（周一）到 10-14（周三）里没有周六
  assert.deepEqual(reasons(inventoryBatchIssues(batch({ from: "2026-10-12", to: "2026-10-14", weekdays: [6] }), TODAY)), ["/weekdays NO_DAY_SELECTED"]);

  // 选中的日期：2026-10-09 是周五
  assert.deepEqual(inventoryBatchDates({ from: "2026-10-09", to: "2026-10-12", weekdays: [] }), ["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12"]);
  assert.deepEqual(inventoryBatchDates({ from: "2026-10-09", to: "2026-10-18", weekdays: [6, 7] }), ["2026-10-10", "2026-10-11", "2026-10-17", "2026-10-18"]);
  assert.deepEqual(inventoryBatchDates({ from: "2026-12-30", to: "2027-01-02", weekdays: [] }), ["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"], "跨年");
  assert.deepEqual(inventoryBatchDates({ from: "2028-02-28", to: "2028-03-01", weekdays: [] }), ["2028-02-28", "2028-02-29", "2028-03-01"], "闰年");
  assert.deepEqual(inventoryBatchDates({ from: "2026-10-12", to: "2026-10-09", weekdays: [] }), []);
  assert.equal(inventoryBatchDates({ from: "2026-01-01", to: "2026-12-31", weekdays: [] }).length, 365);
});

test("已经预占、已售的单不能被改没：可售总数不能小于占用数，有占用的日子不能清除", () => {
  assert.equal(inventoryOccupiedBlocking(null, 0), null);
  assert.equal(inventoryOccupiedBlocking(null, null), null);
  assert.equal(inventoryOccupiedBlocking(day(5), null), null, "没有占用：可以清除");
  assert.equal(inventoryOccupiedBlocking(day(5, 1, 2), 3), null, "正好等于占用数：可以（这一天就售罄了）");
  assert.equal(inventoryOccupiedBlocking(day(5, 1, 2), 2), 3);
  assert.equal(inventoryOccupiedBlocking(day(5, 1, 2), 0), 3, "有人订了的日子不能直接停售成 0");
  assert.equal(inventoryOccupiedBlocking(day(5, 1, 0), null), 1, "有占用的日子不能清除");
  assert.equal(inventoryOccupiedBlocking(day(5, 1, 2), 9), null);
});
