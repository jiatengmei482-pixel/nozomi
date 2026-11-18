/**
 * 多日行程报价页（M9T-09，ADR 0101 第十三节）的地名暂存：行程单里只存坐标（服务端不收地名），客人选的地名按行程单编号存在本标签页的 sessionStorage，
 * 第 2 步（含刷新）和以后的转人工报价（M9T-08 的 `trip_labels`）要用。只有这一个键前缀；关掉标签页就没了，不进 localStorage、不进网址。
 * 存不了（隐私模式、存满了）、读不了、格式不对时一律当作没有：页面退回显示坐标，不报错。
 */

/** 每天按点的顺序的地名（空闲日为空数组），和行程单 `days[].items[]` 一一对应 */
export interface TripLabels {
  v: 1;
  days: string[][];
}

const TRIP_LABELS_PREFIX = "nozomi.trip-labels.";
const tripLabelsKey = (tripId: string): string => TRIP_LABELS_PREFIX + tripId;

/** 存地名；浏览器不让存时什么也不做 */
export function saveTripLabels(tripId: string, labels: TripLabels): void {
  try {
    sessionStorage.setItem(tripLabelsKey(tripId), JSON.stringify(labels));
  } catch {
    // 存不了只是第 2 步显示不了地名
  }
}

/** 读地名；没有、读不了、格式不对时为 null */
export function loadTripLabels(tripId: string): TripLabels | null {
  try {
    const raw = sessionStorage.getItem(tripLabelsKey(tripId));
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const { v, days } = parsed as { v?: unknown; days?: unknown };
    if (v !== 1 || !Array.isArray(days) || !days.every((day) => Array.isArray(day) && day.every((name) => typeof name === "string"))) return null;
    return { v: 1, days: days as string[][] };
  } catch {
    return null;
  }
}
