/**
 * 回放差异归类（M9P-14，ADR 0093 第六节第 5 小节）：部署前后各取一次逐行明细（`GET /platform/v1/reports/area-role-preview?rows=true`，同一个 until、天数），
 * 按「询价编号 × 商品编码」对齐，摘要不同的行逐车型组比，归到第 5 小节表里的类别；归不进去的是「未归类」（判失败，要查）。
 *
 * 逐行明细是「每个候选商品各自报的价」，所以只看得出单个商品的变化；中标商品换了（第 3、6、11 类）是比价层面的，不在逐行明细里。
 * 一行可能同时有几类（例如选档变了、加价也变了），都列出来。
 */
import type { ReplayRow, ReplayRowOffer } from "./replay-digest.ts";

export type ReplayCategory =
  /** 第 1、2、9、10 类：上车、下车、行程加价金额变了 */
  | "surcharge"
  /** 第 4 类：不再预收超时费 */
  | "overtime"
  /** 第 5、7 类：同一个商品选的档变了 */
  | "package"
  /** 第 8 类：套餐价变了（统一为来源区域的价） */
  | "package_price"
  /** 第 12 类：T 超过在线下单上限，不再报价 */
  | "too_long"
  /** 归不进上面任何一类 */
  | "unclassified";

/** 每一类对应 ADR 0093 第六节第 5 小节表里的编号（给人看的说明） */
export const REPLAY_CATEGORY_TEXT: Readonly<Record<ReplayCategory, string>> = {
  surcharge: "加价金额变化（第 1、2、9、10 类）",
  overtime: "不再预收超时费（第 4 类）",
  package: "选档变化（第 5、7 类）",
  package_price: "套餐价变化（第 8 类）",
  too_long: "超过在线下单上限不报价（第 12 类）",
  unclassified: "未归类（要查）",
};

export interface ReplayRowDiff {
  logId: string;
  productCode: string;
  categories: ReplayCategory[];
  /** 前后每个车型组的档和结算价（没有这一行 / 报不出为空） */
  before: { vehicleGroupId: string; packageHours: number | null; totalMinor: number }[];
  after: { vehicleGroupId: string; packageHours: number | null; totalMinor: number }[];
}

export interface ReplayClassification {
  /** 两边都有、摘要一样的行数 */
  unchanged: number;
  /** 只有一边有的行（候选商品变了；stateDigest 一样时不该出现） */
  onlyBefore: number;
  onlyAfter: number;
  diffs: ReplayRowDiff[];
  /** 每一类的行数（一行算进它的每一类） */
  counts: Partial<Record<ReplayCategory, number>>;
}

const keyOf = (row: Pick<ReplayRow, "logId" | "productCode">): string => `${row.logId}\u0000${row.productCode}`;
const brief = (row: ReplayRow | undefined): ReplayRowDiff["before"] => (row?.offers ?? []).map((offer) => ({ vehicleGroupId: offer.vehicleGroupId, packageHours: offer.packageHours, totalMinor: offer.totalMinor }));

/** 一行前后的类别：逐车型组比 */
export function classifyRow(before: ReplayRow, after: ReplayRow): ReplayCategory[] {
  const found = new Set<ReplayCategory>();
  // 整个商品不报了：只有 T 超过上限这一种是有意的
  if (after.refused !== null && after.refused !== before.refused) return [after.refused === "ITINERARY_TOO_LONG" ? "too_long" : "unclassified"];
  const tooLong = (row: ReplayRow, vehicleGroupId: string | null): boolean => row.refused === "ITINERARY_TOO_LONG" || row.refusedGroups.some((entry) => entry.reason === "ITINERARY_TOO_LONG" && (vehicleGroupId === null || entry.vehicleGroupId === vehicleGroupId));
  const groups = new Set<string>([...before.offers, ...after.offers].map((offer) => offer.vehicleGroupId));
  for (const group of groups) {
    const was: ReplayRowOffer | undefined = before.offers.find((offer) => offer.vehicleGroupId === group);
    const now: ReplayRowOffer | undefined = after.offers.find((offer) => offer.vehicleGroupId === group);
    if (was !== undefined && now === undefined) {
      found.add(tooLong(after, group) && !tooLong(before, group) ? "too_long" : "unclassified");
      continue;
    }
    if (was === undefined || now === undefined) {
      found.add("unclassified");
      continue;
    }
    // 金额能拆开的部分：选档、套餐价、加价、超时费；拆完还对不上的才算未归类
    let explained = 0;
    const categories: ReplayCategory[] = [];
    if (was.packageHours !== now.packageHours) categories.push("package");
    else if (was.surcharge !== null && now.surcharge !== null && was.surcharge.packageMinor !== now.surcharge.packageMinor) {
      categories.push("package_price");
      explained += now.surcharge.packageMinor - was.surcharge.packageMinor;
    }
    if (was.surcharge !== null && now.surcharge !== null) {
      const ends = (entry: NonNullable<ReplayRowOffer["surcharge"]>): number => entry.pickupMinor + entry.dropoffMinor + entry.itineraryMinor;
      if (ends(was.surcharge) !== ends(now.surcharge)) {
        categories.push("surcharge");
        explained += ends(now.surcharge) - ends(was.surcharge);
      }
    }
    if ((was.overtimeMinor ?? 0) > 0 && (now.overtimeMinor ?? 0) === 0) {
      categories.push("overtime");
      explained -= was.overtimeMinor ?? 0;
    }
    // 选档变了，金额怎么变都由它解释（套餐价、超公里跟着档变）；否则差额要被拆开的部分正好解释
    const totalsExplained = categories.includes("package") || now.totalMinor - was.totalMinor === explained;
    for (const category of categories) found.add(category);
    if (!totalsExplained || (categories.length === 0 && was.totalMinor !== now.totalMinor)) found.add("unclassified");
  }
  for (const entry of after.refusedGroups) {
    // 以前报得出、现在报不出的已经在上面逐车型组算过；这里只看「报不出的原因换了」
    const already = before.refusedGroups.some((old) => old.vehicleGroupId === entry.vehicleGroupId && old.reason === entry.reason) || before.offers.some((offer) => offer.vehicleGroupId === entry.vehicleGroupId);
    if (!already) found.add(entry.reason === "ITINERARY_TOO_LONG" ? "too_long" : "unclassified");
  }
  if (found.size === 0) found.add("unclassified");
  const order: ReplayCategory[] = ["surcharge", "overtime", "package", "package_price", "too_long", "unclassified"];
  return order.filter((category) => found.has(category));
}

/** 部署前后两份逐行明细归类 */
export function classifyReplay(before: readonly ReplayRow[], after: readonly ReplayRow[]): ReplayClassification {
  const old = new Map(before.map((row) => [keyOf(row), row]));
  const result: ReplayClassification = { unchanged: 0, onlyBefore: 0, onlyAfter: 0, diffs: [], counts: {} };
  const seen = new Set<string>();
  for (const row of after) {
    const key = keyOf(row);
    seen.add(key);
    const was = old.get(key);
    if (was === undefined) {
      result.onlyAfter += 1;
      continue;
    }
    if (was.digest === row.digest) {
      result.unchanged += 1;
      continue;
    }
    const categories = classifyRow(was, row);
    for (const category of categories) result.counts[category] = (result.counts[category] ?? 0) + 1;
    result.diffs.push({ logId: row.logId, productCode: row.productCode, categories, before: brief(was), after: brief(row) });
  }
  result.onlyBefore = [...old.keys()].filter((key) => !seen.has(key)).length;
  return result;
}
