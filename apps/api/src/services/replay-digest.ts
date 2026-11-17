/**
 * 只读回放的摘要值（M8-34 补充，ADR 0086）：引擎改动（如包车「途经加价」）部署前后各在测试环境回放一次（同一个截止时间 `until`、同样的天数），比较摘要。
 *
 * - `resultDigest`：每条「询价 × 候选商品」写成一行：询价日志编号、商品编码，加上用现在的规则报出来的结果里稳定的部分——
 *   商品层面报不出时是原因代码；报得出时是每个车型组（含套餐小时数）的结算价金额与币种、计价方式、区域编号（线路价的下车区域）、价格规则编号、
 *   包车区域加价的明细金额（套餐价、上车、下车加了多少），以及报不出的车型组和原因（排序后）。不含时间戳、随机编号、报价快照编号。
 *   所有行排序后用换行连起来取 SHA-256（十六进制），行的先后不影响结果。`resultLineDigests` 是逐行的 SHA-256，给有权限的人定位哪一行变了。
 * - `stateDigest`：回放用到的数据（商品、价格规则、调价规则、计程价、报价区域、区域、车型组、子品牌、供应商、附加服务、城市、地点）当前状态的 SHA-256，
 *   按列挑出来、键排序后序列化（见 area-role-preview.ts 的 `replayStateDigest`）。
 *   两次的 `stateDigest` 一样时 `resultDigest` 必须一样；`stateDigest` 不一样说明中间有人改了数据，比对无效，要重跑。
 */
import { createHash } from "node:crypto";
import type { ProductQuote, VehicleOffer } from "@nozomi/domain";

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/** 一条「询价 × 候选商品」的摘要行 */
export interface DigestLine {
  logId: string;
  productCode: string;
  line: string;
}

export interface LineDigest {
  logId: string;
  productCode: string;
  digest: string;
}

/**
 * 一个报价里参与摘要的字段。引擎改动的 PR（如途经加价）不能改这里：改了，部署前后两次的口径就不一样，摘要不能比（docs/deploy.md 第九节）。
 */
function offerParts(offer: VehicleOffer): unknown[] {
  const { settlement } = offer;
  const surcharge = settlement.areaSurcharge ?? null;
  return [
    offer.vehicleGroupId,
    offer.packageHours,
    settlement.totalMinor,
    settlement.currency,
    settlement.pricingBasis ?? "one_price",
    offer.areaId,
    settlement.toAreaId ?? null,
    offer.priceRuleId,
    surcharge === null ? null : [surcharge.packageMinor, surcharge.pickup.amountMinor, surcharge.dropoff.amountMinor],
  ];
}

export function replayDigestLine(logId: string, productCode: string, quote: ProductQuote): DigestLine {
  if (!quote.ok) return { logId, productCode, line: JSON.stringify([logId, productCode, "refused", quote.reason]) };
  const offers = quote.offers.map((offer) => JSON.stringify(offerParts(offer))).sort(compare);
  const refused = quote.refused.map((entry) => JSON.stringify([entry.vehicleGroupId, entry.reason])).sort(compare);
  return { logId, productCode, line: JSON.stringify([logId, productCode, "ok", offers, refused]) };
}

/**
 * 逐行明细（M9P-14）：和摘要行同一条「询价 × 候选商品」、同一份报价结果，拆成能比金额的字段；`digest` 就是这一行在 `resultLineDigests` 里的摘要。
 * 只在有权限的人要逐行明细时给（接口参数 `rows=true`），不参与摘要，所以这里加字段不影响部署前后的摘要口径。
 */
export interface ReplayRowOffer {
  vehicleGroupId: string;
  packageHours: number | null;
  totalMinor: number;
  currency: string;
  /** 摘要里也有的几项（审查 #266 必改 1）：计价方式、区域、线路价的下车区域、价格规则编号——金额不变、只有它们变了也能认出来 */
  pricingBasis: string;
  areaId: string | null;
  toAreaId: string | null;
  priceRuleId: string | null;
  /** 调价前的基础价（含套餐、加价、超公里、超时费）和调价合计（审查 #266 必改 3：调价按比例跟着基础价变，金额拆账在基础价上做） */
  baseMinor: number;
  adjustMinor: number;
  /** 包车按行程计价的超时费（预收的；M9P-03 起是 0）；不是按行程计价为 null */
  overtimeMinor: number | null;
  /** 包车区域加价：套餐价、上车、下车、行程加价合计（各区域之和）；不是包车为 null */
  surcharge: { packageMinor: number; pickupMinor: number; dropoffMinor: number; itineraryMinor: number } | null;
}

export interface ReplayRow {
  logId: string;
  productCode: string;
  digest: string;
  /** 包车的旧格式询价日志（没有 charter_selection，回放按旧口径选档、算超时费，这两项应该逐字不变） */
  legacy: boolean;
  /** 客人手动选的档（charter_selection: manual）：档应该不变 */
  manualPackage: boolean;
  /** 商品层面报不出时的原因；报得出时为 null */
  refused: string | null;
  offers: ReplayRowOffer[];
  /** 报不出的车型组和原因 */
  refusedGroups: { vehicleGroupId: string; reason: string }[];
}

export function replayRow(line: DigestLine, quote: ProductQuote, options: { legacy?: boolean; manualPackage?: boolean } = {}): ReplayRow {
  const base = { logId: line.logId, productCode: line.productCode, digest: sha256(line.line), legacy: options.legacy === true, manualPackage: options.manualPackage === true };
  if (!quote.ok) return { ...base, refused: quote.reason, offers: [], refusedGroups: [] };
  const offers = quote.offers
    .map((offer): ReplayRowOffer => {
      const { settlement } = offer;
      const surcharge = settlement.areaSurcharge ?? null;
      return {
        vehicleGroupId: offer.vehicleGroupId,
        packageHours: offer.packageHours,
        totalMinor: settlement.totalMinor,
        currency: settlement.currency,
        pricingBasis: settlement.pricingBasis ?? "one_price",
        areaId: offer.areaId,
        toAreaId: settlement.toAreaId ?? null,
        priceRuleId: offer.priceRuleId,
        baseMinor: settlement.baseMinor,
        adjustMinor: settlement.adjustMinor,
        overtimeMinor: settlement.itinerary?.overtimeMinor ?? null,
        surcharge: surcharge === null ? null : { packageMinor: surcharge.packageMinor, pickupMinor: surcharge.pickup.amountMinor, dropoffMinor: surcharge.dropoff.amountMinor, itineraryMinor: (surcharge.waypoints ?? []).reduce((sum, entry) => sum + entry.amountMinor, 0) },
      };
    })
    .sort((a, b) => compare(a.vehicleGroupId, b.vehicleGroupId) || (a.packageHours ?? 0) - (b.packageHours ?? 0));
  const refusedGroups = quote.refused.map((entry) => ({ vehicleGroupId: entry.vehicleGroupId, reason: entry.reason })).sort((a, b) => compare(a.vehicleGroupId, b.vehicleGroupId) || compare(a.reason, b.reason));
  return { ...base, refused: null, offers, refusedGroups };
}

/** 所有行排序后取 SHA-256（十六进制）；`resultLines` 是参与摘要的行数；`resultLineDigests` 按询价编号、商品编码排好 */
export function replayDigest(lines: readonly DigestLine[]): { resultDigest: string; resultLines: number; resultLineDigests: LineDigest[] } {
  const sorted = lines.map((entry) => entry.line).sort(compare);
  const resultLineDigests = lines
    .map((entry) => ({ logId: entry.logId, productCode: entry.productCode, digest: sha256(entry.line) }))
    .sort((a, b) => compare(a.logId, b.logId) || compare(a.productCode, b.productCode) || compare(a.digest, b.digest));
  return { resultDigest: sha256(sorted.join("\n")), resultLines: sorted.length, resultLineDigests };
}

/** 键排序后的 JSON（数据库 jsonb 的键顺序不当真） */
export function stableStringify(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item ?? null)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => compare(a, b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** 回放用到的数据的状态摘要：每张表的行各自序列化、排序；表按名字排序 */
export function stateDigest(state: Readonly<Record<string, readonly Record<string, unknown>[]>>): string {
  const tables = Object.keys(state)
    .sort(compare)
    .map((table) => [table, (state[table] ?? []).map(stableStringify).sort(compare)]);
  return sha256(JSON.stringify(tables));
}
