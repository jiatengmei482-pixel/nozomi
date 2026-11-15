/**
 * 分段判定与同一天的拆法（ADR 0100 第三节第 3、4 小节；设计篇第三节第 3、4 小节）。
 * 输入是编排器已经识别好的点（是不是机场 / 车站 / 酒店；机场按 `placeId` 或坐标落在平台机场里，同官网按点询价）。
 */
export const TRIP_SEGMENT_TYPES = ["airport_pickup", "airport_dropoff", "p2p", "charter", "idle_day"] as const;
export type TripSegmentType = (typeof TRIP_SEGMENT_TYPES)[number];

/** 拆法用的平台常量（ADR 0100 第三节第 4 小节） */
export const TRIP_SPLIT_RULES = {
  /** 停留至少这么多分钟的点算自然断点 */
  splitStayMinutes: 60,
  /** 每天最多几种拆法（含「不拆」） */
  maxOptionsPerDay: 4,
} as const;

export interface SegmentPoint {
  isAirport: boolean;
  isStation: boolean;
  isHotel: boolean;
  /** 停留分钟（只有中间的经停点有，首末为 0） */
  stayMinutes: number;
}

export interface SegmentDraft {
  type: Exclude<TripSegmentType, "idle_day">;
  /** 在当天点序列里的起止下标（含两端） */
  from: number;
  to: number;
}

export interface SplitOption {
  /** 在哪些中间点拆开（升序）；空 = 不拆 */
  cuts: number[];
  segments: SegmentDraft[];
}

/**
 * 一段（`points[from..to]`）用什么产品（设计篇第三节第 3 小节）：
 * 只有两个点时——起点是机场 → 接机；终点是机场 → 送机；都不是 → 点对点（两点之间没有停留）；
 * 有经停（三个点以上）→ 包车（按行程计价，各商品按自己的 T 选档）。
 */
export function classifySegment(points: readonly SegmentPoint[], from: number, to: number): SegmentDraft["type"] {
  if (to - from < 1) throw new RangeError(`一段至少要两个点：${from}..${to}`);
  if (to - from >= 2) return "charter";
  const start = points[from] as SegmentPoint;
  const end = points[to] as SegmentPoint;
  if (start.isAirport) return "airport_pickup";
  if (end.isAirport) return "airport_dropoff";
  return "p2p";
}

function segmentsFor(points: readonly SegmentPoint[], cuts: readonly number[]): SegmentDraft[] {
  const bounds = [0, ...cuts, points.length - 1];
  const segments: SegmentDraft[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const from = bounds[i] as number;
    const to = bounds[i + 1] as number;
    segments.push({ type: classifySegment(points, from, to), from, to });
  }
  return segments;
}

/** 中间点里的自然断点：机场、车站、酒店、停留 ≥ 60 分钟；首末是机场时，紧挨它的那个点也算（试「接机 + 包车」「包车 + 送机」） */
export function naturalBreakpoints(points: readonly SegmentPoint[]): number[] {
  const n = points.length - 1;
  const cuts = new Set<number>();
  for (let i = 1; i < n; i++) {
    const p = points[i] as SegmentPoint;
    if (p.isAirport || p.isStation || p.isHotel || p.stayMinutes >= TRIP_SPLIT_RULES.splitStayMinutes) cuts.add(i);
  }
  if (n >= 2 && (points[0] as SegmentPoint).isAirport) cuts.add(1);
  if (n >= 2 && (points[n] as SegmentPoint).isAirport) cuts.add(n - 1);
  return [...cuts].sort((a, b) => a - b);
}

/**
 * 一天的候选拆法（每天最多 4 种，含「不拆」）：不拆 → 每个断点各拆一刀 → 所有断点都拆。
 * 超过 4 种时按这个先后留满 4 种：不拆、机场旁的那一刀（接机 + 包车 / 包车 + 送机）、第一个酒店、其余按先后。
 * ADR 0100 第三节第 4 小节字面是「超出只留不拆和第一个酒店」；这里多留到 4 种（每天仍不超过 8 段、预算不变），在 PR 里列为偏离。
 * 两个点的一天只有「不拆」。拆出来的段至少两个点（拆点不会是首末）。
 */
export function daySplitOptions(points: readonly SegmentPoint[]): SplitOption[] {
  if (points.length < 2) return [];
  const breakpoints = naturalBreakpoints(points);
  const n = points.length - 1;
  const candidates: number[][] = [[]];
  const priority: number[] = [];
  const airportCuts = breakpoints.filter((i) => (i === 1 && (points[0] as SegmentPoint).isAirport) || (i === n - 1 && (points[n] as SegmentPoint).isAirport));
  priority.push(...airportCuts);
  const firstHotel = breakpoints.find((i) => (points[i] as SegmentPoint).isHotel);
  if (firstHotel !== undefined && !priority.includes(firstHotel)) priority.push(firstHotel);
  for (const i of breakpoints) if (!priority.includes(i)) priority.push(i);
  for (const i of priority) candidates.push([i]);
  if (breakpoints.length >= 2) candidates.push([...breakpoints]);
  const kept = candidates.length > TRIP_SPLIT_RULES.maxOptionsPerDay ? candidates.slice(0, TRIP_SPLIT_RULES.maxOptionsPerDay) : candidates;
  return kept.map((cuts) => ({ cuts, segments: segmentsFor(points, cuts) }));
}

/**
 * 每个点的到达 / 出发时间（当天零点起的分钟，可以超过 1440）：起点出发 = `startMinute`；
 * 后一点到达 = 前一点出发 + 这一程行驶分钟；出发 = 到达 + 停留。客人只填起点时间，其余由服务器按路线推算（ADR 0100 第二节）。
 */
export function pointTimes(startMinute: number, legDriveMinutes: readonly number[], stays: readonly number[]): { arrive: number[]; depart: number[] } {
  if (stays.length !== legDriveMinutes.length + 1) throw new RangeError(`停留个数（${stays.length}）必须比行驶段数（${legDriveMinutes.length}）多一`);
  const arrive: number[] = [startMinute];
  const depart: number[] = [startMinute + (stays[0] ?? 0)];
  for (let i = 0; i < legDriveMinutes.length; i++) {
    const at = (depart[i] as number) + (legDriveMinutes[i] as number);
    arrive.push(at);
    depart.push(at + (stays[i + 1] ?? 0));
  }
  return { arrive, depart };
}
