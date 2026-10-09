import { test } from "node:test";
import assert from "node:assert/strict";
import { inventoryBatchDates } from "@nozomi/domain";
import type { InventoryDayBody } from "../api/inventory.ts";
import {
  type BatchForm,
  batchDatesText,
  batchEffectText,
  batchIssueText,
  batchOverwriteText,
  blockedDayText,
  blockedDays,
  blockedFromDetails,
  choiceOf,
  fileInvalidText,
  fileSizeText,
  inventoryCellView,
  inventoryConflictText,
  inventoryRowText,
  localFileIssue,
  occupiedText,
  priceConflictText,
  priceRowText,
  readBatchForm,
  readTotal,
  unsetDates,
} from "./inventory-form.ts";

const TODAY = "2026-10-08";
const day = (changes: Partial<InventoryDayBody> = {}): InventoryDayBody => ({ date: "2026-10-12", weekday: 1, total: 5, held: 0, sold: 0, remaining: 5, status: "open", ...changes });
const form = (changes: Partial<BatchForm> = {}): BatchForm => ({ from: "2026-10-10", to: "2026-10-18", everyDay: true, weekdays: [], choice: "total", value: "5", ...changes });

test("月历的一格：八种显示各有一句话，没设和停售分得清", () => {
  assert.deepEqual(inventoryCellView(day({ status: "unlimited", total: null, remaining: null })), { kind: "unlimited", main: "不限量", sub: "", spoken: "不限量" });
  assert.equal(inventoryCellView(day({ status: "unlimited", total: 5, remaining: null })).sub, "已设 5，限量时生效");
  assert.equal(inventoryCellView(day({ status: "unlimited", total: 0, remaining: null })).sub, "已设停售，限量时生效");
  assert.deepEqual(inventoryCellView(day()), { kind: "open", main: "剩 5", sub: "共 5", spoken: "还剩 5 单，共 5 单" });
  assert.deepEqual(inventoryCellView(day({ sold: 2, held: 1, remaining: 2 })), { kind: "open", main: "剩 2", sub: "共 5 · 已售 2 · 待付款 1", spoken: "还剩 2 单，共 5 单，已售 2 单，待付款 1 单" });
  assert.deepEqual(inventoryCellView(day({ status: "sold_out", sold: 5, remaining: 0 })), { kind: "sold_out", main: "已订满", sub: "共 5 · 已售 5", spoken: "已订满，共 5 单，已售 5 单" });
  assert.deepEqual(inventoryCellView(day({ status: "closed", total: 0, remaining: 0 })), { kind: "closed", main: "停售", sub: "", spoken: "停售" });
  assert.deepEqual(inventoryCellView(day({ status: "unset", total: null, remaining: 0 })), { kind: "unset", main: "没设", sub: "卖不出去", spoken: "没设，卖不出去" });
  assert.equal(inventoryCellView(null).kind, "beyond");
});

test("「设成」：可售 N 单要 1 到 9,999 的整数；停售是 0，清除是空", () => {
  assert.deepEqual(readTotal("total", " 5 "), { ok: true, total: 5 });
  assert.deepEqual(readTotal("total", "9,999"), { ok: true, total: 9999 });
  assert.deepEqual(readTotal("closed", "乱写"), { ok: true, total: 0 });
  assert.deepEqual(readTotal("clear", ""), { ok: true, total: null });
  for (const bad of ["", "0", "-1", "1.5", "10000", "五"]) assert.deepEqual(readTotal("total", bad), { ok: false, text: "请填 1 到 9,999 之间的整数。要停售请选「停售」" }, bad);
  assert.deepEqual(readTotal(null, "5"), { ok: false, text: "请选择要设成什么" });
  assert.deepEqual(choiceOf(day()), { choice: "total", value: "5" });
  assert.deepEqual(choiceOf(day({ total: 0 })), { choice: "closed", value: "" });
  assert.deepEqual(choiceOf(day({ total: null })), { choice: "total", value: "" });
});

test("批量设置：读出来的日期和 domain 的 inventoryBatchDates 一样；每种写错都有定稿的话", () => {
  const reading = readBatchForm(form({ everyDay: false, weekdays: [7, 6] }), TODAY);
  assert.deepEqual(reading.batch, { from: "2026-10-10", to: "2026-10-18", weekdays: [6, 7], total: 5 });
  assert.deepEqual(reading.dates, inventoryBatchDates({ from: "2026-10-10", to: "2026-10-18", weekdays: [6, 7] }));
  assert.deepEqual(reading.dates, ["2026-10-10", "2026-10-11", "2026-10-17", "2026-10-18"]);
  const texts = (changes: Partial<BatchForm>): string[] => readBatchForm(form(changes), TODAY).problems.map((problem) => problem.text);
  assert.deepEqual(texts({ from: "", to: "" }), ["请填开始日期", "请填结束日期"]);
  assert.deepEqual(texts({ to: "2026-10-09" }), ["结束日期不能早于开始日期"]);
  assert.deepEqual(texts({ from: "2026-10-01" }), ["过去的日子不能改，最早从今天（2026-10-08）开始"]);
  assert.deepEqual(texts({ to: "2029-01-01", from: "2028-12-01" }), ["最远只能设到 2028-10-07（今天之后 730 天）", "最远只能设到 2028-10-07（今天之后 730 天）"]);
  assert.deepEqual(texts({ to: "2027-10-11" }), ["一次最多设 366 天，请分几次"]);
  assert.deepEqual(texts({ everyDay: false }), ["请至少选一天"]);
  assert.deepEqual(texts({ from: "2026-10-12", to: "2026-10-14", everyDay: false, weekdays: [6] }), ["这段日期里没有周六，请改日期或换一天"]);
  assert.deepEqual(texts({ choice: null }), ["请选择要设成什么"]);
  assert.deepEqual(texts({ value: "0" }), ["请填 1 到 9,999 之间的整数。要停售请选「停售」"]);
  assert.equal(batchIssueText("/to", "TOO_MANY", TODAY), "一次最多设 366 天，请分几次");
  assert.equal(batchIssueText("/total", "OUT_OF_RANGE", TODAY), "请填 1 到 9,999 之间的整数。要停售请选「停售」");
});

test("批量设置读回来的话：哪些天、设成什么、会覆盖几天、不限量时的提醒", () => {
  assert.equal(batchDatesText({ from: "2026-10-10", to: "2026-12-31", weekdays: [6, 7] }, 24), "2026-10-10 至 2026-12-31 的每个周六、周日，共 24 天");
  assert.equal(batchDatesText({ from: "2026-10-10", to: "2026-10-18", weekdays: [] }, 9), "2026-10-10 至 2026-10-18 的每一天，共 9 天");
  assert.equal(batchDatesText({ from: "2026-10-10", to: "2026-10-10", weekdays: [] }, 1), "2026-10-10，共 1 天");
  assert.equal(batchEffectText(5), "每天可售 5 单。");
  assert.equal(batchEffectText(0), "停售，这些天不接单。");
  assert.equal(batchEffectText(null), "清除，改回「没设」。");
  const current = new Map([day({ date: "2026-10-10", total: 3 }), day({ date: "2026-10-11", total: 5 }), day({ date: "2026-10-12", total: null })].map((entry) => [entry.date, entry]));
  assert.equal(batchOverwriteText(["2026-10-10", "2026-10-11", "2026-10-12"], current, 5, "limited"), "其中 1 天现在已经有数，会被改成 5。");
  assert.equal(batchOverwriteText(["2026-10-12"], current, 5, "unlimited"), "现在是不限量，这些数要改成限量后才起作用。");
  assert.equal(batchOverwriteText(["2026-10-10", "2026-10-11"], current, null, "limited"), "其中 2 天现在已经有数，会被清除。");
});

test("有订单占着：改少了、停售、清除都被挡住；接口 409 给的日子同样写", () => {
  const current = new Map([day({ date: "2026-10-12", sold: 2, held: 1 }), day({ date: "2026-10-13" })].map((entry) => [entry.date, entry]));
  assert.deepEqual(blockedDays(["2026-10-12", "2026-10-13", "2026-10-14"], current, 2), [{ date: "2026-10-12", occupied: 3 }]);
  assert.deepEqual(blockedDays(["2026-10-12"], current, 3), []);
  assert.deepEqual(blockedDays(["2026-10-12"], current, 0), [{ date: "2026-10-12", occupied: 3 }]);
  assert.deepEqual(blockedDays(["2026-10-12"], current, null), [{ date: "2026-10-12", occupied: 3 }]);
  assert.equal(blockedDayText({ date: "2026-10-12", occupied: 3 }), "2026-10-12 周一：已占用 3 单");
  assert.deepEqual(blockedFromDetails({ days: [{ date: "2026-10-12", occupied: 3 }, { nope: 1 }] }), [{ date: "2026-10-12", occupied: 3 }]);
  assert.equal(occupiedText({ sold: 2, held: 1 }), "这一天已经有 3 单（已售 2 单、待付款 1 单），可售单数不能少于 3。");
  assert.deepEqual(unsetDates([day({ date: "2026-10-01", status: "unset" }), day({ date: "2026-10-09", status: "unset" }), day({ date: "2026-10-10" })], TODAY), ["2026-10-09"]);
});

test("选文件：类型、大小、空文件、一次好几个，页面先拦；读不了的每种原因各有一句", () => {
  assert.equal(localFileIssue([{ name: "prices.xlsx", size: 2048 }]), null);
  assert.equal(localFileIssue([{ name: "PRICES.XLSX", size: 1 }]), null);
  assert.equal(localFileIssue([{ name: "prices.csv", size: 10 }]), "只能导入 .xlsx 文件。「prices.csv」不是。如果是 .xls 或 .csv，请在 Excel 里另存为「Excel 工作簿（.xlsx）」。");
  assert.equal(localFileIssue([{ name: "big.xlsx", size: 1_572_864 }]), "「big.xlsx」有 1.5 MB，超过了 1 MB。请删掉用不到的行和工作表，或分成几份。");
  assert.equal(localFileIssue([{ name: "empty.xlsx", size: 0 }]), "这个文件是空的。");
  assert.equal(localFileIssue([{ name: "a.xlsx", size: 1 }, { name: "b.xlsx", size: 1 }]), "一次只能导入一个文件。");
  assert.deepEqual([fileSizeText(512), fileSizeText(2048), fileSizeText(49_152), fileSizeText(1_048_576)], ["512 B", "2 KB", "48 KB", "1 MB"]);
  assert.equal(fileInvalidText(400, { reason: "MISSING_COLUMNS", columns: ["区域", "基础价"] }), "表头里少了这几列：区域、基础价。第一行的表头不能改，请对照模版补上。");
  assert.equal(fileInvalidText(400, { reason: "TOO_MANY_ROWS", max: 500 }), "这个文件有效的行超过了 500 行。请分成几份，一份一份导入。");
  assert.equal(fileInvalidText(413, {}), "文件超过了 1 MB。");
  assert.equal(fileInvalidText(400, { reason: "没见过的" }), "这个文件读不了，请用下载的模版重新填。");
  for (const reason of ["NOT_XLSX", "CORRUPT", "TOO_LARGE", "UNSAFE", "EMPTY"]) assert.doesNotMatch(fileInvalidText(400, { reason }), /读不了，请用下载的模版重新填|[A-Z_]{4,}/, reason);
});

test("检查结果的每一行：价格写组合、主价格、生效日期；冲突写和哪一行或哪一条；库存写日期和设成什么", () => {
  const content = { area: "东京 23 区", vehicle_group: "VG-BIZ-7", direction: "pickup" as const, package_hours: null, pricing_model: "fixed" as const, main_price: 20000, valid_from: "2026-10-10", valid_to: null, status: "enabled" as const };
  assert.equal(priceRowText(content, "JPY", false), "东京 23 区 · VG-BIZ-7 · 接机，JPY 20,000，2026-10-10 起一直有效");
  assert.equal(priceRowText({ ...content, direction: "dropoff", status: "disabled", valid_to: "2026-12-31" }, "JPY", true), "东京 23 区 · VG-BIZ-7 · 送站，JPY 20,000，2026-10-10 至 2026-12-31，停用");
  assert.equal(priceRowText({ area: null, vehicle_group: null, direction: null, package_hours: null, pricing_model: null, main_price: null, valid_from: null, valid_to: null, status: "enabled" }, "JPY", false), "—");
  const conflict = { row: 30, price_rule_id: null, area: "东京 23 区", vehicle_group: "VG-BIZ-7", direction: "both" as const, package_hours: null, valid_from: "2026-10-10", valid_to: null };
  assert.equal(priceConflictText(conflict, false), "生效日期和第 30 行重叠（2026-10-10 起一直有效）");
  assert.equal(priceConflictText({ ...conflict, row: null, price_rule_id: "p1" }, false), "生效日期和已有的价格重叠：东京 23 区 · VG-BIZ-7 · 接送通用，2026-10-10 起一直有效");
  assert.equal(inventoryRowText({ date: "2026-10-12", total: 5, action: "set" }), "2026-10-12 周一，设成 5 单");
  assert.equal(inventoryRowText({ date: "2026-10-12", total: 0, action: "set" }), "2026-10-12 周一，停售");
  assert.equal(inventoryRowText({ date: "2026-10-12", total: null, action: "clear" }), "2026-10-12 周一，清除");
  assert.equal(inventoryRowText({ date: null, total: null, action: "error" }), "—");
  assert.equal(inventoryConflictText({ total: 2, occupied: 3 }), "这一天已经有 3 单，不能改成 2");
  assert.equal(inventoryConflictText({ total: null, occupied: 3 }), "这一天已经有 3 单，不能清除");
});
