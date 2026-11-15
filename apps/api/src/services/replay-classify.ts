/**
 * 回放差异归类（M9P-14，ADR 0093 第六节第 5 小节）：部署前后各取一次逐行明细（`GET /platform/v1/reports/area-role-preview?rows=true`，同一个 until、天数），
 * 按「询价编号 × 商品编码」对齐，摘要不同的行逐车型组比，归到第 5 小节表里的类别；归不进去的是「未归类」（判失败，要查）。
 *
 * - 金额拆账在**调价前的基础价**上做：调价（百分比）和取整跟着基础价变，用总价拆不平（#266 审查必改 3）。基础价的差额要正好等于套餐价、加价、超时费几项的差额之和；
 *   选档变了时基础价怎么变都由选档解释。
 * - 金额（基础价、调价、总价）都没变、只有摘要里的区域 / 价格规则 / 计价方式变了：单列一类 `ids_only`（#266 审查必改 1）。
 * - 包车旧格式询价日志（没有 charter_selection）按旧口径选档、算超时费，这两项应该逐字不变：变了单列 `package_legacy` / `overtime_legacy`，不混进有意改动的第 4、5、7 类。
 * - 逐行明细是「每个候选商品各自报的价」，只看得出单个商品的变化；中标商品换了（第 3、6、11 类）是比价层面的，不在逐行明细里。
 * 一行可能同时有几类（例如选档变了、加价也变了），都列出来。
 */
import type { ReplayRow, ReplayRowOffer } from "./replay-digest.ts";

export const REPLAY_CATEGORIES = ["surcharge", "overtime", "package", "package_price", "too_long", "ids_only", "package_legacy", "overtime_legacy", "unclassified"] as const;
export type ReplayCategory = (typeof REPLAY_CATEGORIES)[number];

/** 每一类对应 ADR 0093 第六节第 5 小节表里的编号（给人看的说明） */
export const REPLAY_CATEGORY_TEXT: Readonly<Record<ReplayCategory, string>> = {
  surcharge: "加价金额变化（第 1、2、9、10 类）",
  overtime: "不再预收超时费（第 4 类）",
  package: "选档变化（第 5、7 类）",
  package_price: "套餐价变化（第 8 类）",
  too_long: "超过在线下单上限不报价（第 12 类）",
  ids_only: "金额没变、只有区域 / 价格规则 / 计价方式变了",
  package_legacy: "旧格式日志的选档变了（应该不变）",
  overtime_legacy: "旧格式日志的超时费变了（应该不变）",
  unclassified: "未归类（要查）",
};

type Brief = { vehicleGroupId: string; packageHours: number | null; baseMinor: number; adjustMinor: number; totalMinor: number };

export interface ReplayRowDiff {
  logId: string;
  productCode: string;
  legacy: boolean;
  categories: ReplayCategory[];
  /** 前后每个车型组的档和金额；报不出的原因（商品层面、车型组）也带上 */
  before: { offers: Brief[]; refused: string | null; refusedGroups: ReplayRow["refusedGroups"] };
  after: { offers: Brief[]; refused: string | null; refusedGroups: ReplayRow["refusedGroups"] };
}

export interface ReplayClassification {
  /** 两边都有、摘要一样的行数 */
  unchanged: number;
  /** 只有一边有的行（候选商品变了）：判失败（#266 审查必改 2） */
  onlyBefore: { logId: string; productCode: string }[];
  onlyAfter: { logId: string; productCode: string }[];
  diffs: ReplayRowDiff[];
  /** 每一类的行数（一行算进它的每一类） */
  counts: Partial<Record<ReplayCategory, number>>;
}

const keyOf = (row: Pick<ReplayRow, "logId" | "productCode">): string => `${row.logId}\u0000${row.productCode}`;
const side = (row: ReplayRow): ReplayRowDiff["before"] => ({
  offers: row.offers.map((offer) => ({ vehicleGroupId: offer.vehicleGroupId, packageHours: offer.packageHours, baseMinor: offer.baseMinor, adjustMinor: offer.adjustMinor, totalMinor: offer.totalMinor })),
  refused: row.refused,
  refusedGroups: row.refusedGroups,
});

/** 同一个车型组前后都报得出时的类别 */
function offerCategories(was: ReplayRowOffer, now: ReplayRowOffer, legacy: boolean): ReplayCategory[] {
  const categories: ReplayCategory[] = [];
  let explained = 0;
  const packageChanged = was.packageHours !== now.packageHours;
  if (packageChanged) categories.push(legacy ? "package_legacy" : "package");
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
  if ((was.overtimeMinor ?? 0) !== (now.overtimeMinor ?? 0)) {
    // 有意的只有「不再预收」（新口径）；旧格式日志的超时费应该逐字不变
    categories.push(!legacy && (now.overtimeMinor ?? 0) === 0 ? "overtime" : "overtime_legacy");
    explained += (now.overtimeMinor ?? 0) - (was.overtimeMinor ?? 0);
  }
  const amountsSame = was.baseMinor === now.baseMinor && was.adjustMinor === now.adjustMinor && was.totalMinor === now.totalMinor;
  if (categories.length === 0) return [amountsSame ? "ids_only" : "unclassified"];
  // 拆账在基础价上：选档变了时由选档解释；否则基础价的差额要正好是上面几项之和
  if (!packageChanged && now.baseMinor - was.baseMinor !== explained) categories.push("unclassified");
  return categories;
}

/** 一行前后的类别：逐车型组比 */
export function classifyRow(before: ReplayRow, after: ReplayRow): ReplayCategory[] {
  // 整个商品不报了：只有 T 超过上限这一种是有意的
  if (after.refused !== null && after.refused !== before.refused) return [after.refused === "ITINERARY_TOO_LONG" ? "too_long" : "unclassified"];
  const found = new Set<ReplayCategory>();
  const tooLong = (row: ReplayRow, vehicleGroupId: string): boolean => row.refused === "ITINERARY_TOO_LONG" || row.refusedGroups.some((entry) => entry.reason === "ITINERARY_TOO_LONG" && entry.vehicleGroupId === vehicleGroupId);
  const groups = new Set<string>([...before.offers, ...after.offers].map((offer) => offer.vehicleGroupId));
  for (const group of groups) {
    const was = before.offers.find((offer) => offer.vehicleGroupId === group);
    const now = after.offers.find((offer) => offer.vehicleGroupId === group);
    if (was !== undefined && now !== undefined) for (const category of offerCategories(was, now, after.legacy)) found.add(category);
    else if (was !== undefined) found.add(tooLong(after, group) && !tooLong(before, group) ? "too_long" : "unclassified");
    // 以前报不出、现在报出来了：不在任何有意改动里
    else found.add("unclassified");
  }
  // 报不出的原因换了（以前报得出的已经在上面逐车型组算过）
  for (const entry of after.refusedGroups) {
    const known = before.refusedGroups.some((old) => old.vehicleGroupId === entry.vehicleGroupId && old.reason === entry.reason) || before.offers.some((offer) => offer.vehicleGroupId === entry.vehicleGroupId);
    if (!known) found.add(entry.reason === "ITINERARY_TOO_LONG" ? "too_long" : "unclassified");
  }
  if (found.size === 0) found.add("unclassified");
  return REPLAY_CATEGORIES.filter((category) => found.has(category));
}

/** 部署前后两份逐行明细归类 */
export function classifyReplay(before: readonly ReplayRow[], after: readonly ReplayRow[]): ReplayClassification {
  const old = new Map(before.map((row) => [keyOf(row), row]));
  const result: ReplayClassification = { unchanged: 0, onlyBefore: [], onlyAfter: [], diffs: [], counts: {} };
  const seen = new Set<string>();
  for (const row of after) {
    const key = keyOf(row);
    seen.add(key);
    const was = old.get(key);
    if (was === undefined) {
      result.onlyAfter.push({ logId: row.logId, productCode: row.productCode });
      continue;
    }
    if (was.digest === row.digest) {
      result.unchanged += 1;
      continue;
    }
    const categories = classifyRow(was, row);
    for (const category of categories) result.counts[category] = (result.counts[category] ?? 0) + 1;
    result.diffs.push({ logId: row.logId, productCode: row.productCode, legacy: row.legacy, categories, before: side(was), after: side(row) });
  }
  result.onlyBefore = before.filter((row) => !seen.has(keyOf(row))).map((row) => ({ logId: row.logId, productCode: row.productCode }));
  return result;
}

/**
 * 判定：未归类、只有一边有的行都失败；给了声明的类别（这个 PR 有意改动的）时，出现不在声明里的类别也失败。
 * 没给声明时，`ids_only`、`package_legacy`、`overtime_legacy` 也算失败（它们不在 ADR 0093 第六节第 5 小节的有意改动里）。
 */
export function replayVerdict(result: ReplayClassification, declared: readonly ReplayCategory[] | null): { passed: boolean; undeclared: ReplayCategory[] } {
  const allowed = new Set<ReplayCategory>(declared ?? ["surcharge", "overtime", "package", "package_price", "too_long"]);
  allowed.delete("unclassified");
  const undeclared = REPLAY_CATEGORIES.filter((category) => (result.counts[category] ?? 0) > 0 && !allowed.has(category));
  return { passed: undeclared.length === 0 && result.onlyBefore.length === 0 && result.onlyAfter.length === 0, undeclared };
}
