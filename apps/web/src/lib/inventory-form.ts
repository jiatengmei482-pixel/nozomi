/**
 * 库存日历每一格的话、改一天和批量设置的表单、导入页的文字（docs/design/pages/tenant-inventory.md）。
 * 一天是什么状态用接口给的 `status`（后端按 @nozomi/domain 的 inventoryDayStatus 算）；
 * 批量设置「写得对不对」、选中了哪些天、有没有被订单挡住，都问 @nozomi/domain，这里只写成给人看的话。
 */
import { INVENTORY_LIMITS, type InventoryBatch, type InventoryMode, addDays, inventoryBatchDates, inventoryBatchIssues, inventoryOccupiedBlocking, priceDirectionNames } from "@nozomi/domain";
import type { InventoryDayBody, PriceImportConflict, PriceImportContent } from "../api/inventory.ts";
import { IMPORT_MAX_BYTES } from "../api/inventory.ts";
import { WEEKDAY_NAMES } from "./adjust-form.ts";
import { weekdayName } from "./price-calendar.ts";
import { moneyText } from "./product-display.ts";
import { tidyDate } from "./time-input.ts";

const count = (value: number): string => value.toLocaleString("en-US");

export type InventoryCellKind = "unlimited" | "open" | "sold_out" | "closed" | "unset" | "beyond";

export interface InventoryCellView {
  kind: InventoryCellKind;
  /** 第二行：主要的一句 */
  main: string;
  /** 第三行；没有是空字符串 */
  sub: string;
  /** 读屏读的那一句（不含日期） */
  spoken: string;
}

/** 「共 5 · 已售 2 · 待付款 1」：哪个是 0 就不写哪个。 */
export function occupancyText(day: Pick<InventoryDayBody, "total" | "sold" | "held">, unit = ""): string {
  return [`共 ${count(day.total ?? 0)}${unit}`, day.sold > 0 ? `已售 ${count(day.sold)}${unit}` : "", day.held > 0 ? `待付款 ${count(day.held)}${unit}` : ""].filter((part) => part !== "").join(" · ");
}

/** 最远能设到哪一天。 */
export function lastSettableDate(today: string): string {
  return addDays(today, INVENTORY_LIMITS.maxDaysAhead);
}

/** 月历的一格。`day` 为 null 表示接口没有给这一天（超出可设范围）。 */
export function inventoryCellView(day: InventoryDayBody | null): InventoryCellView {
  if (day === null) return { kind: "beyond", main: "—", sub: "", spoken: "超出可以设库存的范围" };
  if (day.status === "unlimited") {
    const preset = day.total === null ? "" : day.total === 0 ? "已设停售，限量时生效" : `已设 ${count(day.total)}，限量时生效`;
    return { kind: "unlimited", main: "不限量", sub: preset, spoken: preset === "" ? "不限量" : `不限量，${preset}` };
  }
  if (day.status === "unset") return { kind: "unset", main: "没设", sub: "卖不出去", spoken: "没设，卖不出去" };
  if (day.status === "closed") return { kind: "closed", main: "停售", sub: "", spoken: "停售" };
  const detail = [`共 ${count(day.total ?? 0)} 单`, day.sold > 0 ? `已售 ${count(day.sold)} 单` : "", day.held > 0 ? `待付款 ${count(day.held)} 单` : ""].filter((part) => part !== "").join("，");
  if (day.status === "sold_out") return { kind: "sold_out", main: "已订满", sub: occupancyText(day), spoken: `已订满，${detail}` };
  return { kind: "open", main: `剩 ${count(day.remaining ?? 0)}`, sub: occupancyText(day), spoken: `还剩 ${count(day.remaining ?? 0)} 单，${detail}` };
}

// ───────────── 「设成」：可售 N 单 / 停售 / 清除 ─────────────

export type TotalChoice = "total" | "closed" | "clear";
export const TOTAL_PROBLEM = `请填 1 到 ${count(INVENTORY_LIMITS.maxDailyTotal)} 之间的整数。要停售请选「停售」`;

/** 这一天现在的情况对应哪个选项。 */
export function choiceOf(day: Pick<InventoryDayBody, "total"> | null): { choice: TotalChoice; value: string } {
  if (day === null || day.total === null) return { choice: "total", value: "" };
  return day.total === 0 ? { choice: "closed", value: "" } : { choice: "total", value: String(day.total) };
}

/** 读「设成」。返回要提交的 `total`（null = 清除，0 = 停售）；写得不对返回出错文字。 */
export function readTotal(choice: TotalChoice | null, value: string): { ok: true; total: number | null } | { ok: false; text: string } {
  if (choice === null) return { ok: false, text: "请选择要设成什么" };
  if (choice === "clear") return { ok: true, total: null };
  if (choice === "closed") return { ok: true, total: 0 };
  const text = value.trim().replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0)).replace(/,/g, "");
  if (!/^\d+$/.test(text)) return { ok: false, text: TOTAL_PROBLEM };
  const total = Number(text);
  return total >= 1 && total <= INVENTORY_LIMITS.maxDailyTotal ? { ok: true, total } : { ok: false, text: TOTAL_PROBLEM };
}

export function totalText(total: number | null): string {
  return total === null ? "清除" : total === 0 ? "停售" : `可售 ${count(total)} 单`;
}

/** 这一天被订单挡住时的话（改一天的面板）。 */
export function occupiedText(day: Pick<InventoryDayBody, "sold" | "held">): string {
  const occupied = day.sold + day.held;
  return `这一天已经有 ${count(occupied)} 单（已售 ${count(day.sold)} 单、待付款 ${count(day.held)} 单），可售单数不能少于 ${count(occupied)}。`;
}

// ───────────── 批量设置 ─────────────

export interface BatchForm {
  from: string;
  to: string;
  everyDay: boolean;
  weekdays: number[];
  choice: TotalChoice | null;
  value: string;
}

export interface BatchProblem {
  text: string;
  /** 页面上元素的 id */
  target: string;
}

const REASON_TARGETS: Readonly<Record<string, string>> = { "/from": "batch-from", "/to": "batch-to", "/weekdays": "batch-weekdays", "/total": "batch-total" };

/** 接口 400 里的原因（和 inventoryBatchIssues 是同一套）→ 页面上的话。 */
export function batchIssueText(path: string, reason: string, today: string, weekdays: readonly number[] = []): string {
  const start = path.startsWith("/from");
  switch (reason) {
    case "INVALID_DATE":
      return start ? "请填开始日期" : "请填结束日期";
    case "DATE_RANGE_REVERSED":
      return "结束日期不能早于开始日期";
    case "DATE_IN_PAST":
      return `过去的日子不能改，最早从今天（${today}）开始`;
    case "TOO_FAR_AHEAD":
      return `最远只能设到 ${lastSettableDate(today)}（今天之后 ${INVENTORY_LIMITS.maxDaysAhead} 天）`;
    case "TOO_MANY":
      return `一次最多设 ${INVENTORY_LIMITS.maxRangeDays} 天，请分几次`;
    case "NO_DAY_SELECTED":
      return weekdays.length === 0 ? "请至少选一天" : `这段日期里没有${[...weekdays].sort((x, y) => x - y).map((day) => WEEKDAY_NAMES[day - 1] ?? "").join("、")}，请改日期或换一天`;
    default:
      return path.startsWith("/total") ? TOTAL_PROBLEM : "这一项不符合要求，请检查后重试";
  }
}

export interface BatchReading {
  batch: InventoryBatch | null;
  problems: BatchProblem[];
  /** 选中的日期（日期和星期都读得出来时；「设成」没选也有） */
  dates: string[];
}

export function readBatchForm(form: BatchForm, today: string): BatchReading {
  const problems: BatchProblem[] = [];
  const from = form.from.trim() === "" ? null : tidyDate(form.from);
  const to = form.to.trim() === "" ? null : tidyDate(form.to);
  if (from === null) problems.push({ text: "请填开始日期", target: "batch-from" });
  if (to === null) problems.push({ text: "请填结束日期", target: "batch-to" });
  if (!form.everyDay && form.weekdays.length === 0) problems.push({ text: "请至少选一天", target: "batch-weekdays" });
  const total = readTotal(form.choice, form.value);
  const weekdays = form.everyDay ? [] : [...form.weekdays].sort((x, y) => x - y);
  let dates: string[] = [];
  if (from !== null && to !== null && (form.everyDay || weekdays.length > 0)) {
    const probe: InventoryBatch = { from, to, weekdays, total: total.ok ? total.total : 1 };
    for (const issue of inventoryBatchIssues(probe, today)) {
      if (issue.path.startsWith("/total")) continue;
      problems.push({ text: batchIssueText(issue.path, issue.reason, today, weekdays), target: REASON_TARGETS[issue.path.replace(/\/\d+$/, "")] ?? "batch-from" });
    }
    if (problems.length === 0) dates = inventoryBatchDates(probe);
  }
  if (!total.ok) problems.push({ text: total.text, target: form.choice === "total" ? "batch-total" : "batch-choice" });
  if (problems.length > 0 || from === null || to === null || !total.ok) return { batch: null, problems, dates };
  return { batch: { from, to, weekdays, total: total.total }, problems, dates };
}

/** 「2026-10-10 至 2026-12-31 的每个周六、周日，共 24 天」。 */
export function batchDatesText(batch: Pick<InventoryBatch, "from" | "to" | "weekdays">, days: number): string {
  const span = batch.from === batch.to ? batch.from : `${batch.from} 至 ${batch.to}`;
  const which = batch.weekdays.length === 0 ? (batch.from === batch.to ? "" : " 的每一天") : ` 的每个${[...batch.weekdays].sort((x, y) => x - y).map((day) => WEEKDAY_NAMES[day - 1] ?? "").join("、")}`;
  return `${span}${which}，共 ${count(days)} 天`;
}

export function batchEffectText(total: number | null): string {
  return total === null ? "清除，改回「没设」。" : total === 0 ? "停售，这些天不接单。" : `每天可售 ${count(total)} 单。`;
}

/** 「其中 6 天现在已经有数，会被改成 5。」；没有已经有数的返回空字符串。 */
export function batchOverwriteText(dates: readonly string[], current: ReadonlyMap<string, InventoryDayBody>, total: number | null, mode: InventoryMode): string {
  const existing = dates.filter((date) => {
    const day = current.get(date);
    return day !== undefined && day.total !== null && day.total !== total;
  }).length;
  const first = existing === 0 ? "" : `其中 ${count(existing)} 天现在已经有数，会被${total === null ? "清除" : total === 0 ? "改成停售" : `改成 ${count(total)}`}。`;
  return `${first}${mode === "unlimited" && total !== null ? "现在是不限量，这些数要改成限量后才起作用。" : ""}`;
}

export interface BlockedDay {
  date: string;
  occupied: number;
}

/** 选中的日子里，哪些已经有订单占着、改不成 `total`（用 @nozomi/domain 的 inventoryOccupiedBlocking）。 */
export function blockedDays(dates: readonly string[], current: ReadonlyMap<string, InventoryDayBody>, total: number | null): BlockedDay[] {
  return dates.flatMap((date) => {
    const day = current.get(date);
    const occupied = inventoryOccupiedBlocking(day === undefined ? null : { total: day.total ?? 0, held: day.held, sold: day.sold }, total);
    return occupied === null ? [] : [{ date, occupied }];
  });
}

/** 接口 409 `INVENTORY_BELOW_OCCUPIED` 的 `details.days`。 */
export function blockedFromDetails(details: Record<string, unknown>): BlockedDay[] {
  const days = Array.isArray(details["days"]) ? (details["days"] as unknown[]) : [];
  return days.flatMap((entry) => {
    const day = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
    return typeof day["date"] === "string" && typeof day["occupied"] === "number" ? [{ date: day["date"], occupied: day["occupied"] }] : [];
  });
}

export function blockedDayText(day: BlockedDay): string {
  return `${day.date} ${weekdayName(day.date)}：已占用 ${count(day.occupied)} 单`;
}

/** 这个月里（今天和以后）没设的日子。 */
export function unsetDates(days: readonly InventoryDayBody[], today: string): string[] {
  return days.filter((day) => day.status === "unset" && day.date >= today).map((day) => day.date);
}

// ───────────── 导入：选文件 ─────────────

export function fileSizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = Math.round(bytes / 102.4) / 10;
  return kb < 1024 ? `${kb >= 10 ? Math.round(kb) : kb} KB` : `${Math.round(bytes / 104857.6) / 10} MB`;
}

/** 选的时候页面先看的三件事；合格返回 null。 */
export function localFileIssue(files: readonly { name: string; size: number }[]): string | null {
  if (files.length > 1) return "一次只能导入一个文件。";
  const file = files[0];
  if (!file) return null;
  if (!/\.xlsx$/i.test(file.name)) return `只能导入 .xlsx 文件。「${file.name}」不是。如果是 .xls 或 .csv，请在 Excel 里另存为「Excel 工作簿（.xlsx）」。`;
  if (file.size === 0) return "这个文件是空的。";
  if (file.size > IMPORT_MAX_BYTES) return `「${file.name}」有 ${fileSizeText(file.size)}，超过了 1 MB。请删掉用不到的行和工作表，或分成几份。`;
  return null;
}

/** 文件读不了（`IMPORT_FILE_INVALID` 的 `details.reason`，或 413）。 */
export function fileInvalidText(status: number, details: Record<string, unknown>): string {
  if (status === 413) return "文件超过了 1 MB。";
  switch (details["reason"]) {
    case "NOT_XLSX":
      return "这不是一个 .xlsx 文件（可能只是改了扩展名）。请在 Excel 里另存为「Excel 工作簿（.xlsx）」再传。";
    case "CORRUPT":
      return "这个文件打不开，可能已经损坏。请在 Excel 里重新保存一份再传。";
    case "TOO_LARGE":
      return "这个文件的内容太多（行、列或某个格子里的字超过了上限）。请只保留要导入的那张表和那些行。";
    case "UNSAFE":
      return "这个文件里有不允许的内容，不能导入。请把数据复制到刚下载的模版里再传。";
    case "EMPTY":
      return "第一张表是空的，没有表头。请用下载的模版来填。";
    case "MISSING_COLUMNS": {
      const columns = Array.isArray(details["columns"]) ? (details["columns"] as unknown[]).filter((column): column is string => typeof column === "string") : [];
      return columns.length > 0 ? `表头里少了这几列：${columns.join("、")}。第一行的表头不能改，请对照模版补上。` : "表头里少了几列。第一行的表头不能改，请对照模版补上。";
    }
    case "TOO_MANY_ROWS":
      return `这个文件有效的行超过了${typeof details["max"] === "number" ? ` ${count(details["max"])} ` : "上限的"}行。请分成几份，一份一份导入。`;
    default:
      return "这个文件读不了，请用下载的模版重新填。";
  }
}

// ───────────── 导入：检查结果 ─────────────

/** 价格的一行（或冲突的那一条）是什么：「{区域} · {车型组} · {方向 / 套餐}」。读不出来的部分不写。 */
export function priceComboText(content: Pick<PriceImportContent | PriceImportConflict, "area" | "vehicle_group" | "direction" | "package_hours">, station: boolean): string {
  const variant = content.direction !== null ? priceDirectionNames(station ? "station" : null)[content.direction] : content.package_hours !== null ? `${count(content.package_hours)} 小时` : null;
  return [content.area, content.vehicle_group, variant].filter((part): part is string => part !== null && part !== "").join(" · ");
}

export function validityText(from: string | null, to: string | null): string {
  if (from === null) return "";
  return to === null ? `${from} 起一直有效` : `${from} 至 ${to}`;
}

/** 价格的一行写成一句：组合 + 主价格 + 生效日期。 */
export function priceRowText(content: PriceImportContent, currency: string | null, station: boolean): string {
  const combo = priceComboText(content, station);
  const price = content.main_price === null ? "" : moneyText(content.main_price, currency);
  const text = [combo, price, validityText(content.valid_from, content.valid_to), content.status === "disabled" ? "停用" : ""].filter((part) => part !== "").join("，");
  return text === "" ? "—" : text;
}

export function priceConflictText(conflict: PriceImportConflict, station: boolean): string {
  const span = validityText(conflict.valid_from, conflict.valid_to);
  if (conflict.row !== null) return `生效日期和第 ${conflict.row} 行重叠${span === "" ? "" : `（${span}）`}`;
  const combo = priceComboText(conflict, station);
  return combo === "" ? `生效日期和已有的一条价格重叠${span === "" ? "" : `（${span}）`}` : `生效日期和已有的价格重叠：${[combo, span].filter((part) => part !== "").join("，")}`;
}

export function inventoryRowText(row: { date: string | null; total: number | null; action: string }): string {
  if (row.date === null) return "—";
  const what = row.action === "error" && row.total === null ? "" : row.total === null ? "清除" : row.total === 0 ? "停售" : `设成 ${count(row.total)} 单`;
  return `${row.date} ${weekdayName(row.date)}${what === "" ? "" : `，${what}`}`;
}

export function inventoryConflictText(row: { total: number | null; occupied: number }): string {
  return `这一天已经有 ${count(row.occupied)} 单，${row.total === null ? "不能清除" : `不能改成 ${count(row.total)}`}`;
}
