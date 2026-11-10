/**
 * 运营后台「未覆盖需求」（M8-20，ADR 0075 第四部分）：一个价都报不出的询价。只有平台能看（`demand.read`），不含客人个人信息。
 * 类型手写，与 `apps/api/openapi.yaml` 对账（`uncovered-demands.contract.test.ts`）。
 */
import type { LocalizedText, ServiceCategory } from "@nozomi/domain";
import { apiRequest } from "./client.ts";
import { query } from "./areas.ts";

export const UNCOVERED_DEMANDS_PATH = "/platform/v1/uncovered-demands";
export const UNCOVERED_DEMAND_POINTS_PATH = "/platform/v1/uncovered-demands/points";

export const UNCOVERED_DEMAND_REASONS = ["OUTSIDE_OPERATING", "NO_PRICING_AREA", "OTHER"] as const;
export type UncoveredDemandReason = (typeof UNCOVERED_DEMAND_REASONS)[number];

export interface DemandPoint {
  lat: number;
  lng: number;
}

export interface DemandOperatingRef {
  tenant_id: string;
  area_id: string;
}

export interface UncoveredDemand {
  id: string;
  first_seen_at: string;
  last_seen_at: string;
  repeat_count: number;
  channel_kind: "site" | "sales";
  channel_id: string;
  category: ServiceCategory;
  direction: "pickup" | "dropoff" | null;
  package_hours: number | null;
  city_id: string | null;
  airport_id: string | null;
  pickup: DemandPoint | null;
  dropoff: DemandPoint | null;
  pickup_name: string | null;
  dropoff_name: string | null;
  /** 用车的当地时间 `YYYY-MM-DDTHH:mm` */
  service_local: string;
  service_date: string;
  passengers: number;
  luggage: number;
  vehicle_group_id: string | null;
  pickup_operating: DemandOperatingRef[];
  dropoff_operating: DemandOperatingRef[];
  tenant_ids: string[];
  reason: UncoveredDemandReason;
  /** 这次比价里全部的拒绝原因 → 次数 */
  refusal_counts: Record<string, number>;
}

export interface DemandCount {
  rows: number;
  repeats: number;
}

export interface UncoveredDemandSummary {
  rows: number;
  repeats: number;
  /** 这段日期里因为限流没记下来的新需求条数 */
  dropped: number;
  by_reason: (DemandCount & { reason: UncoveredDemandReason })[];
  by_city: (DemandCount & { city_id: string | null })[];
  by_tenant: (DemandCount & { tenant_id: string })[];
}

export interface UncoveredDemandPage {
  from: string;
  to: string;
  items: UncoveredDemand[];
  next_cursor: string | null;
  summary: UncoveredDemandSummary;
  tenants: { id: string; name: string }[];
  cities: { id: string; name: LocalizedText }[];
}

export interface UncoveredDemandPointItem {
  id: string;
  category: ServiceCategory;
  reason: UncoveredDemandReason;
  repeat_count: number;
  pickup: DemandPoint | null;
  dropoff: DemandPoint | null;
  /** 用车的当地时间 `YYYY-MM-DDTHH:mm` */
  service_local: string;
  /** 最近一次出现的时刻 */
  last_seen_at: string;
}

export interface UncoveredDemandPoints {
  from: string;
  to: string;
  items: UncoveredDemandPointItem[];
  /** 超过 2000 条，只给了最近的 2000 条 */
  truncated: boolean;
}

export interface UncoveredDemandFilter {
  city_id?: string;
  tenant_id?: string;
  /** 东京日期（含）；不给 = 结束日期往前 29 天 */
  from?: string;
  /** 东京日期（含）；不给 = 今天 */
  to?: string;
  category?: ServiceCategory;
  reason?: UncoveredDemandReason;
}

export interface UncoveredDemandQuery extends UncoveredDemandFilter {
  limit?: number;
  cursor?: string;
}

export function listUncoveredDemands(token: string, values: UncoveredDemandQuery): Promise<UncoveredDemandPage> {
  return apiRequest("GET", query(UNCOVERED_DEMANDS_PATH, values), { token });
}

export function fetchUncoveredDemandPoints(token: string, values: UncoveredDemandFilter): Promise<UncoveredDemandPoints> {
  return apiRequest("GET", query(UNCOVERED_DEMAND_POINTS_PATH, values), { token });
}

/** 对账用：字段名清单。 */
export const UNCOVERED_DEMAND_FIELDS = {
  UncoveredDemand: ["id", "first_seen_at", "last_seen_at", "repeat_count", "channel_kind", "channel_id", "category", "direction", "package_hours", "city_id", "airport_id", "pickup", "dropoff", "pickup_name", "dropoff_name", "service_local", "service_date", "passengers", "luggage", "vehicle_group_id", "pickup_operating", "dropoff_operating", "tenant_ids", "reason", "refusal_counts"],
  UncoveredDemandSummary: ["rows", "repeats", "dropped", "by_reason", "by_city", "by_tenant"],
  UncoveredDemandPoint: ["lat", "lng"],
  UncoveredDemandOperatingRef: ["tenant_id", "area_id"],
  Page: ["from", "to", "items", "next_cursor", "summary", "tenants", "cities"],
  Points: ["from", "to", "items", "truncated"],
  PointItem: ["id", "category", "reason", "repeat_count", "pickup", "dropoff", "service_local", "last_seen_at"],
} as const satisfies {
  UncoveredDemand: readonly (keyof UncoveredDemand)[];
  UncoveredDemandSummary: readonly (keyof UncoveredDemandSummary)[];
  UncoveredDemandPoint: readonly (keyof DemandPoint)[];
  UncoveredDemandOperatingRef: readonly (keyof DemandOperatingRef)[];
  Page: readonly (keyof UncoveredDemandPage)[];
  Points: readonly (keyof UncoveredDemandPoints)[];
  PointItem: readonly (keyof UncoveredDemandPointItem)[];
};
export const UNCOVERED_DEMAND_QUERY_KEYS = ["limit", "cursor", "city_id", "tenant_id", "from", "to", "category", "reason"] as const satisfies readonly (keyof UncoveredDemandQuery)[];
export const UNCOVERED_DEMAND_POINT_QUERY_KEYS = ["city_id", "tenant_id", "from", "to", "category", "reason"] as const satisfies readonly (keyof UncoveredDemandFilter)[];
