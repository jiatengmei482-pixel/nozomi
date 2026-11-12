/**
 * 「未覆盖需求」（M8-20，ADR 0075 第四部分）：一次询价一个价都报不出时，平台记下客人想去哪里、什么时候、什么车，
 * 运营据此找供应商补报价区域、招商找新供应商。这里是纯规则：归类、去重指纹、坐标取整、名称整理、保留期。
 *
 * **不含任何客人个人信息**：没有姓名、邮箱、电话、自由文本、IP、浏览器信息、会话编号、订单编号。
 * 坐标只留 4 位小数（约 10 米：够看分布、画区域，又不精确到门牌）；地点名称只用官网地址联想选中的那一项（不收客人手打的文字）。
 */
import { createHash } from "node:crypto";
import type { LatLng } from "./geo.ts";
import type { ServiceCategory } from "./master-data.ts";
import { type QuoteArea, locateInAreas } from "./quote.ts";
import type { TripDirection } from "./pricing.ts";

/** 主原因（一单只记一个） */
export const UNCOVERED_DEMAND_REASONS = ["OUTSIDE_OPERATING", "NO_PRICING_AREA", "OTHER"] as const;
export type UncoveredDemandReason = (typeof UNCOVERED_DEMAND_REASONS)[number];

export const UNCOVERED_DEMAND_REASON_NAMES: Readonly<Record<UncoveredDemandReason, string>> = {
  OUTSIDE_OPERATING: "不在任何供应商的运营区域里",
  NO_PRICING_AREA: "在运营区域里，但没有报价区域",
  OTHER: "其他原因",
};

export const UNCOVERED_DEMAND_RULES = {
  /** 存的坐标的小数位（约 10 米） */
  coordinateDecimals: 4,
  /** 去重指纹里坐标的小数位（约 100 米：客人在地图上挪一点点仍算同一条） */
  fingerprintDecimals: 3,
  /** 地点名称最多几个字 */
  maxNameLength: 200,
  /** 保留天数（看得出一整年的季节规律） */
  retentionDays: 365,
  /** 去重、按天计数用的时区 */
  timeZone: "Asia/Tokyo",
  /** 每个来源（官网客人地址的哈希、渠道的 API 客户端）每小时最多新增几行 */
  sourceNewRowsPerHour: 30,
  /** 全站每天最多新增几行 */
  globalNewRowsPerDay: 5_000,
  /** 记录最多等多久（毫秒）：超时就放弃，不影响报价 */
  recordTimeoutMs: 200,
  /** 地图上的点一次最多给几条 */
  maxMapPoints: 2_000,
} as const;

/** 算区域原因的那几种拒绝原因（报价引擎第 4 步）：都是这些时主原因是 `NO_PRICING_AREA` */
const AREA_REFUSALS: ReadonlySet<string> = new Set(["OUT_OF_SERVICE_AREA", "IN_FORBIDDEN_AREA", "NO_PRICING_AREA"]);

/** 一个点落在哪个供应商的哪个运营区域里 */
export interface DemandOperatingHit {
  tenantId: string;
  areaId: string;
}

/**
 * 一个点落在哪些供应商的哪些运营区域里（营运区里、不在那个区域的禁行区里；落在这家用途是「运营」的区域的禁行区里时这家不算，M8-36 补充）：按供应商、区域去重，按给的先后。
 * `suppliers` 是参加这次比价的供应商各自的运营范围（报价引擎的 `operatingAreas`）。
 */
export function operatingHits(suppliers: readonly { tenantId: string; operatingAreas: readonly QuoteArea[] }[], point: LatLng | null): DemandOperatingHit[] {
  if (point === null) return [];
  const seen = new Set<string>();
  const hits: DemandOperatingHit[] = [];
  for (const supplier of suppliers) {
    const located = locateInAreas(supplier.operatingAreas, point);
    // 点落在这家某个用途是「运营」的区域的禁行区里：这家在那里不接，哪怕别的运营区域盖住（M8-36 补充，口径同报价引擎）
    if (supplier.operatingAreas.some((area) => area.role === "operating" && located.forbidden.includes(area.areaId))) continue;
    for (const areaId of located.operating) {
      const key = `${supplier.tenantId}|${areaId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ tenantId: supplier.tenantId, areaId });
    }
  }
  return hits;
}

/**
 * 主原因（ADR 0075 第四部分第 1 节）：
 * - `OUTSIDE_OPERATING`：没有任何候选商品，或任一要校验的点不在任何候选供应商的运营区域里；
 * - `NO_PRICING_AREA`：每个要校验的点都在某家的运营区域里，而所有商品都因为区域原因（没勾覆盖它的报价区域、不在服务范围、禁行区）报不出；
 * - `OTHER`：其余（提前量不够、售罄、超出人数、缺价、路线取不到……）。
 * `checkedPoints` 是每个要校验的点各自落在的运营区域；`refusals` 是这次比价里全部的拒绝原因（商品层面和车型组层面）。
 */
export function uncoveredDemandReason(input: { candidateCount: number; checkedPoints: readonly (readonly DemandOperatingHit[])[]; refusals: readonly string[] }): UncoveredDemandReason {
  if (input.candidateCount === 0 || input.checkedPoints.some((hits) => hits.length === 0)) return "OUTSIDE_OPERATING";
  if (input.refusals.length > 0 && input.refusals.every((reason) => AREA_REFUSALS.has(reason))) return "NO_PRICING_AREA";
  return "OTHER";
}

/** 全部拒绝原因 → 次数（键按字母排，结果稳定） */
export function refusalCounts(refusals: readonly string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const reason of refusals) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** 坐标取 `decimals` 位小数（四舍五入；不是钱，用浮点没有问题） */
export function roundDemandCoordinate(value: number, decimals: number = UNCOVERED_DEMAND_RULES.coordinateDecimals): number {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function roundDemandPoint(point: LatLng | null, decimals: number = UNCOVERED_DEMAND_RULES.coordinateDecimals): LatLng | null {
  return point === null ? null : { lat: roundDemandCoordinate(point.lat, decimals), lng: roundDemandCoordinate(point.lng, decimals) };
}

/** 地点名称：去掉首尾空白、把连续的空白和控制字符合成一个空格，最多 200 个字（按字符，不切开一个字）；空的为 null */
export function demandPlaceName(text: string | null | undefined): string | null {
  if (typeof text !== "string") return null;
  const cleaned = text.replace(/[\s\u0000-\u001f\u007f-\u009f]+/gu, " ").trim();
  if (cleaned === "") return null;
  return Array.from(cleaned).slice(0, UNCOVERED_DEMAND_RULES.maxNameLength).join("").trim();
}

export interface DemandFingerprintInput {
  channelId: string;
  category: ServiceCategory;
  direction: TripDirection | null;
  packageHours: number | null;
  pickup: LatLng | null;
  dropoff: LatLng | null;
  /** 用车日期（当地） */
  serviceDate: string;
  passengers: number;
  vehicleGroupId: string | null;
}

/**
 * 去重指纹：sha256(渠道 | 品类 | 方向 | 套餐 | 上车点 3 位小数 | 下车点 3 位小数 | 用车日期 | 人数 | 车型组)。
 * 同一天（东京时间）同一个指纹只记一行、累加次数：客人反复点「重新报价」、改一下时间都只让次数变大。
 */
export function demandFingerprint(input: DemandFingerprintInput): string {
  const point = (value: LatLng | null): string => {
    const rounded = roundDemandPoint(value, UNCOVERED_DEMAND_RULES.fingerprintDecimals);
    return rounded === null ? "-" : `${rounded.lat.toFixed(UNCOVERED_DEMAND_RULES.fingerprintDecimals)},${rounded.lng.toFixed(UNCOVERED_DEMAND_RULES.fingerprintDecimals)}`;
  };
  const parts = [input.channelId, input.category, input.direction ?? "-", input.packageHours === null ? "-" : String(input.packageHours), point(input.pickup), point(input.dropoff), input.serviceDate, String(input.passengers), input.vehicleGroupId ?? "-"];
  return createHash("sha256").update(parts.join("|"), "utf8").digest("hex");
}

/** 保留期的分界：最近一次出现早于它的行由每天的清理任务删掉 */
export function uncoveredDemandCutoff(now: Date): Date {
  return new Date(now.getTime() - UNCOVERED_DEMAND_RULES.retentionDays * 86_400_000);
}
