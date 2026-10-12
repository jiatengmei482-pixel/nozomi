/**
 * 游标分页（需求文档「API 通用约定」）：`limit`（默认 50，最大 200）+ `cursor`，返回 `next_cursor`。
 * 游标对调用方是不透明的字符串；内容是「上一页最后一行的排序键」，所以翻页过程中有新数据写入也不会漏行或重复。
 */
import { AppError } from "./errors.ts";

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

/** 按「创建时间 + 编号」排序的列表用的游标。时间用数据库给出的文本（微秒精度），避免来回转换丢精度。 */
export interface TimeCursor {
  t: string;
  id: string;
}

/** 按递增编号排序的列表（审计日志）用的游标。 */
export interface SequenceCursor {
  id: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** 按「编码 + 编号」排序的列表（主数据的 `sort=code`）用的游标。 */
export interface CodeCursor {
  c: string;
  id: string;
}

export function encodeCursor(value: TimeCursor | SequenceCursor | CodeCursor): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function invalidCursor(): AppError {
  return new AppError(400, "VALIDATION_FAILED", "请求参数校验未通过", {
    location: "querystring",
    issues: [{ path: "/cursor", message: "游标无效，请使用上一页返回的 next_cursor" }],
  });
}

function decode(cursor: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof value === "object" && value !== null) return value as Record<string, unknown>;
  } catch {
    // 不是合法的 JSON：按无效游标处理
  }
  throw invalidCursor();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP_TEXT = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?([+-])(\d{2})(?::(\d{2}))?$/;
const MAX_BIGINT = 9_223_372_036_854_775_807n;
/** PostgreSQL 接受的时区偏移范围是 ±15:59 以内。 */
const MAX_OFFSET_HOURS = 15;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * 是否是数据库给出的那种时间文本（`2026-10-07 01:00:00.123456+00`），并且值本身合法：
 * 日期真实存在、时分秒和时区偏移都在范围内。只看「长得像」不够——13 月、+99 时区会让数据库转换报错。
 */
function isValidTimestampText(text: string): boolean {
  const match = TIMESTAMP_TEXT.exec(text);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  const offsetHours = Number(match[8]);
  const offsetMinutes = Number(match[9] ?? "0");
  if (year < 1 || hour > 23 || minute > 59 || second > 59) return false;
  if (offsetHours > MAX_OFFSET_HOURS || offsetMinutes > 59) return false;
  const date = new Date(Date.UTC(2000, month - 1, day));
  date.setUTCFullYear(year);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function decodeTimeCursor(cursor: string | null): TimeCursor | null {
  if (cursor === null) return null;
  const { t, id } = decode(cursor);
  if (typeof t !== "string" || typeof id !== "string" || !isValidTimestampText(t) || !isUuid(id)) throw invalidCursor();
  return { t, id };
}

/** 按编码排序的游标。按创建时间排序时拿到的游标里没有编码，带到这里会被拒绝（两种排序的游标不能混用）。 */
export function decodeCodeCursor(cursor: string | null): CodeCursor | null {
  if (cursor === null) return null;
  const { c, id } = decode(cursor);
  if (typeof c !== "string" || typeof id !== "string" || !/^[A-Z0-9_-]{1,50}$/.test(c) || !isUuid(id)) throw invalidCursor();
  return { c, id };
}

export function decodeSequenceCursor(cursor: string | null): SequenceCursor | null {
  if (cursor === null) return null;
  const { id } = decode(cursor);
  if (typeof id !== "string" || !/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > MAX_BIGINT) throw invalidCursor();
  return { id };
}

/**
 * 查询时多取一行来判断有没有下一页：传入取回的行（最多 limit + 1 行），
 * 返回本页的行和下一页的游标。
 */
export function toPage<Row, Item>(
  rows: readonly Row[],
  limit: number,
  toItem: (row: Row) => Item,
  toCursor: (lastRow: Row) => TimeCursor | SequenceCursor | CodeCursor,
): Page<Item> {
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  return {
    items: pageRows.map(toItem),
    nextCursor: rows.length > limit && last !== undefined ? encodeCursor(toCursor(last)) : null,
  };
}
