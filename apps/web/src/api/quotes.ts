/**
 * 运营后台的报价试算：`POST /platform/v1/quotes/preview`（ADR 0020「两个试算接口」）。
 * 所有供应商一起比，看得到每个车型组的中标、全部候选（结算价、对外价、加价比例、排序价）和每个报不出价的原因。
 * 只读：不生成可以下单的报价。类型与 `apps/api/openapi.yaml` 对账（`quotes.contract.test.ts`）。
 * 金额是最小货币单位整数；`exact`、`rank_price`、`sell_exact` 等是取整之前的精确值（十进制字符串）。
 */
import type { ServiceCategory } from "@nozomi/domain";
import { listAll } from "./areas.ts";
import { apiRequest } from "./client.ts";
import { MASTER_BASE, type Place } from "./master.ts";
import { PLATFORM_BASE } from "./platform.ts";

export const QUOTE_PREVIEW_PATH = `${PLATFORM_BASE}/quotes/preview`;

export interface QuotePoint {
  lng: number;
  lat: number;
}

export interface QuoteRoute {
  meters: number;
  minutes: number;
}

export interface PlatformQuotePreviewRequest {
  city_id: string;
  category: ServiceCategory;
  place_id: string | null;
  currency: string;
  pickup: QuotePoint | null;
  dropoff: QuotePoint | null;
  direction: "pickup" | "dropoff" | null;
  package_hours: number | null;
  /** 城市当地时间 `YYYY-MM-DDTHH:mm` */
  service_time: string;
  passengers: number;
  luggage: number;
  assume_route: QuoteRoute | null;
  /** 按哪个渠道的规则试算；null = 平台默认参数 */
  channel_id: string | null;
}

export interface QuoteSettlement {
  currency: string;
  rounding_unit: number;
  total: number;
  base: number;
  adjust: number;
  urgent: number;
  night: number;
  addons: number;
  driver_language: number;
  exact: { base: string; adjusted: string; night: string; addons: string; total: string };
  adjusts: { rule_id: string; name: string; steps: { type: "percent" | "amount"; value: number; delta: string; after: string }[] }[];
  urgent_tier: { within_hours: number; surcharge: number } | null;
  night_detail: { charge_unit: "per_order" | "per_hour"; overlap_minutes: number | null } | null;
  addon_items: { addon_id: string; charge_unit: "per_order" | "per_item" | "per_person" | "per_duration"; quantity: number; charged_quantity: string; first_free: boolean; unit_price: number; amount: number; amount_exact: string }[];
  driver_language_code: string | null;
  usage: QuoteRoute | null;
  free_wait: { item: "pickup" | "dropoff" | "general"; mode: "unlimited" | "limited" | null; minutes: number | null; platform_minimum_minutes: number };
}

export interface QuoteOffer {
  vehicle_group_id: string;
  package_hours: number | null;
  area_id: string;
  price_rule_id: string;
  settlement: QuoteSettlement;
}

export interface QuoteCandidate {
  position: number;
  in_band: boolean;
  rank_price: string;
  tenant_id: string | null;
  tenant_name: string | null;
  product_id: string;
  product_code: string | null;
  product_version: number;
  observation: boolean;
  score_centi: number;
  completed_orders: number;
  sell: number;
  sell_exact: string;
  markup_bp: number;
  /** 按渠道试算时命中的是第几级（5 = 渠道默认或全渠道促销）；平台默认参数时为 null */
  markup_level: number | null;
  markup_rule_id: string | null;
  /** 加价部分不足渠道的最低毛利、被补到了最低毛利 */
  min_margin_applied: boolean;
  fx_buffer_bp: number;
  fx: { from: string; to: string; rate: string; as_of: string } | null;
  offer: QuoteOffer;
}

export interface QuoteGroup {
  vehicle_group_id: string;
  package_hours: number | null;
  created_at: string;
  expires_at: string;
  winner: { tenant_id: string | null; tenant_name: string | null; product_id: string; product_code: string | null; sell: number; settlement: number; settlement_currency: string };
  candidates: QuoteCandidate[];
}

export interface QuoteRefusal {
  tenant_id: string | null;
  tenant_name: string | null;
  product_id: string;
  product_code: string | null;
  /** null：商品层面就报不出（对所有车型组都一样） */
  vehicle_group_id: string | null;
  reason: string;
  /** 后端写好的中文原因 */
  message: string;
}

export interface QuoteExcluded {
  tenant_id: string | null;
  tenant_name: string | null;
  product_id: string;
  product_code: string | null;
}

export interface PlatformQuotePreview {
  currency: string;
  band_bp: number;
  markup_floor_bp: number;
  /** 按哪个渠道试算的；平台默认参数时为 null */
  channel: { id: string; name: string; status: "testing" | "active" | "paused"; min_margin: number; settle_currency: string; rounding_unit: number } | null;
  /** 渠道不卖的供应商的商品（没参加比价） */
  excluded: QuoteExcluded[];
  route: QuoteRoute | null;
  candidate_count: number;
  groups: QuoteGroup[];
  refused: QuoteRefusal[];
}

export function previewPlatformQuote(token: string, body: PlatformQuotePreviewRequest): Promise<PlatformQuotePreview> {
  return apiRequest("POST", QUOTE_PREVIEW_PATH, { token, body });
}

/** 一个城市里启用中的机场和车站（接送机试算的接送点）。 */
export function listQuotePlaces(token: string, cityId: string): Promise<Place[]> {
  return listAll(`${MASTER_BASE}/places`, token, { city_id: cityId, type: "airport,station", status: "active", sort: "code" });
}

/** 对账用：字段名清单。 */
export const QUOTE_SCHEMA_FIELDS = {
  PlatformQuotePreviewRequest: ["city_id", "category", "place_id", "currency", "pickup", "dropoff", "direction", "package_hours", "service_time", "passengers", "luggage", "assume_route", "channel_id"],
  PlatformQuotePreview: ["currency", "band_bp", "markup_floor_bp", "channel", "excluded", "route", "candidate_count", "groups", "refused"],
  QuoteChannel: ["id", "name", "status", "min_margin", "settle_currency", "rounding_unit"],
  QuoteExcluded: ["tenant_id", "tenant_name", "product_id", "product_code"],
  QuoteGroup: ["vehicle_group_id", "package_hours", "created_at", "expires_at", "winner", "candidates"],
  QuoteWinner: ["tenant_id", "tenant_name", "product_id", "product_code", "sell", "settlement", "settlement_currency"],
  QuoteCandidate: ["position", "in_band", "rank_price", "tenant_id", "tenant_name", "product_id", "product_code", "product_version", "observation", "score_centi", "completed_orders", "sell", "sell_exact", "markup_bp", "markup_level", "markup_rule_id", "min_margin_applied", "fx_buffer_bp", "fx", "offer"],
  QuoteRefusal: ["tenant_id", "tenant_name", "product_id", "product_code", "vehicle_group_id", "reason", "message"],
  QuoteOffer: ["vehicle_group_id", "package_hours", "area_id", "price_rule_id", "settlement"],
  QuoteSettlement: ["currency", "rounding_unit", "total", "base", "adjust", "urgent", "night", "addons", "driver_language", "exact", "adjusts", "urgent_tier", "night_detail", "addon_items", "driver_language_code", "usage", "free_wait"],
  QuoteRoute: ["meters", "minutes"],
} as const satisfies {
  PlatformQuotePreviewRequest: readonly (keyof PlatformQuotePreviewRequest)[];
  PlatformQuotePreview: readonly (keyof PlatformQuotePreview)[];
  QuoteChannel: readonly (keyof NonNullable<PlatformQuotePreview["channel"]>)[];
  QuoteExcluded: readonly (keyof QuoteExcluded)[];
  QuoteGroup: readonly (keyof QuoteGroup)[];
  QuoteWinner: readonly (keyof QuoteGroup["winner"])[];
  QuoteCandidate: readonly (keyof QuoteCandidate)[];
  QuoteRefusal: readonly (keyof QuoteRefusal)[];
  QuoteOffer: readonly (keyof QuoteOffer)[];
  QuoteSettlement: readonly (keyof QuoteSettlement)[];
  QuoteRoute: readonly (keyof QuoteRoute)[];
};
/** 页面专门处理的错误码。 */
export const QUOTE_ERROR_CODES = ["VALIDATION_FAILED", "MASTER_DATA_NOT_READY", "CHANNEL_SCOPE_DENIED"] as const;
