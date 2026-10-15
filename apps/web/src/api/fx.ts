/**
 * 汇率中心的接口（apps/api/openapi.yaml 的「汇率」；ADR 0022）。手写类型由 fx.contract.test.ts 和 openapi.yaml 对账。
 * 汇率一律是十进制字符串，前端不拿它算钱（曲线只拿来定点的位置）。
 */
import type { CurrencyCode, FxFetchStatus, FxTableState } from "@nozomi/domain";
import { apiRequest } from "./client.ts";

export const FX_BASE = "/platform/v1/fx-rates";

export interface FxStaffRef {
  id: string;
  name: string;
}

export interface FxFetch {
  id: string;
  started_at: string;
  finished_at: string | null;
  trigger: "schedule" | "manual";
  triggered_by: FxStaffRef | null;
  source: string;
  status: FxFetchStatus;
  error_code: string | null;
  error_detail: string | null;
  source_as_of: string | null;
  source_next_update_at: string | null;
  held_rates: { currency: CurrencyCode; rate: string }[] | null;
  jumps: { currency: CurrencyCode; previous: string; next: string; change_bp: number }[] | null;
  decided_by: FxStaffRef | null;
  decided_at: string | null;
}

export interface FxRateItem {
  currency: CurrencyCode;
  rate: string | null;
}

export interface FxOverview {
  base: CurrencyCode;
  state: FxTableState;
  as_of: string | null;
  fetched_at: string | null;
  stale_at: string | null;
  max_age_hours: number;
  jump_threshold_bp: number;
  source: string | null;
  rates: FxRateItem[];
  cross: { from: CurrencyCode; to: CurrencyCode; rate: string | null }[];
  source_status: {
    host: string;
    auto_fetch: boolean;
    last_attempt: FxFetch | null;
    last_success_at: string | null;
    next_fetch_at: string | null;
  };
  held: FxFetch | null;
}

export interface FxHistory {
  base: CurrencyCode;
  from: string;
  to: string;
  series: { currency: CurrencyCode; points: { as_of: string; rate: string }[] }[];
}

/** 首页统计里汇率的那一组（`DashboardSummary.fx`）。 */
export interface DashboardFx {
  state: FxTableState;
  as_of: string | null;
  stale_at: string | null;
  held: boolean;
  last_attempt_status: FxFetchStatus | null;
}

export function fetchFxOverview(token: string, base: CurrencyCode): Promise<FxOverview> {
  return apiRequest("GET", `${FX_BASE}?base=${base}`, { token });
}

export function fetchFxHistory(token: string, base: CurrencyCode, days = 30): Promise<FxHistory> {
  return apiRequest("GET", `${FX_BASE}/history?base=${base}&days=${days}`, { token });
}

export function fetchFxFetches(token: string, limit = 20): Promise<{ items: FxFetch[] }> {
  return apiRequest("GET", `${FX_BASE}/fetches?limit=${limit}`, { token });
}

export function fetchFxNow(token: string): Promise<{ fetch: FxFetch }> {
  return apiRequest("POST", `${FX_BASE}/fetch`, { token });
}

export function decideFxFetch(token: string, id: string, decision: "confirm" | "dismiss"): Promise<{ fetch: FxFetch }> {
  return apiRequest("POST", `${FX_BASE}/fetches/${encodeURIComponent(id)}/${decision}`, { token });
}

/** 对账用：每个类型的字段名清单。 */
export const FX_SCHEMA_FIELDS = {
  FxFetch: ["id", "started_at", "finished_at", "trigger", "triggered_by", "source", "status", "error_code", "error_detail", "source_as_of", "source_next_update_at", "held_rates", "jumps", "decided_by", "decided_at"],
  FxOverview: ["base", "state", "as_of", "fetched_at", "stale_at", "max_age_hours", "jump_threshold_bp", "source", "rates", "cross", "source_status", "held"],
  FxHistory: ["base", "from", "to", "series"],
  DashboardFx: ["state", "as_of", "stale_at", "held", "last_attempt_status"],
} as const satisfies {
  FxFetch: readonly (keyof FxFetch)[];
  FxOverview: readonly (keyof FxOverview)[];
  FxHistory: readonly (keyof FxHistory)[];
  DashboardFx: readonly (keyof DashboardFx)[];
};

/** 前端按错误码处理的汇率错误。 */
export const FX_ERROR_CODES = ["FX_FETCH_IN_PROGRESS", "FX_FETCH_NOT_HELD", "FX_HELD_OUTDATED"] as const;
