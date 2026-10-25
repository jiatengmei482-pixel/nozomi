/**
 * 汇率中心的接口（apps/api/openapi.yaml 的「汇率」；ADR 0022）。手写类型由 fx.contract.test.ts 和 openapi.yaml 对账。
 * 汇率一律是十进制字符串，前端不拿它算钱（曲线只拿来定点的位置）。
 * 人工锁定（M2-06，ADR 0025）：发起锁定 / 解锁都返回一条待审核的复核记录（`Approval`），另一位同事在「待审核」里批准后才生效。
 */
import type { CurrencyCode, FxFetchStatus, FxTableState } from "@nozomi/domain";
import type { Approval } from "./channels.ts";
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
  /** 报价用的值（有锁定的用锁定值） */
  rate: string | null;
  /** 数据源的中央汇率 */
  central_rate: string | null;
  locked: boolean;
}

export interface FxPerson {
  id: string;
  name: string;
  email: string;
}

export type FxLockStatus = "active" | "released" | "replaced" | "expired";

export interface FxLock {
  id: string;
  currency: CurrencyCode;
  /** 1 USD = rate 个该币种 */
  rate: string;
  reason: string | null;
  expires_at: string;
  locked_at: string;
  central_rate: string;
  central_as_of: string;
  deviation_bp: number;
  lock_approval_id: string;
  requested_by: FxPerson;
  approved_by: FxPerson;
  status: FxLockStatus;
  ended_at: string | null;
  end_approval_id: string | null;
  ended_by: FxPerson | null;
}

export interface FxLockRules {
  max_hours: number;
  min_minutes: number;
  reason_above_bp: number;
  max_deviation_bp: number;
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
  cross: { from: CurrencyCode; to: CurrencyCode; rate: string | null; locked: boolean }[];
  source_status: {
    host: string;
    auto_fetch: boolean;
    last_attempt: FxFetch | null;
    last_success_at: string | null;
    next_fetch_at: string | null;
  };
  held: FxFetch | null;
  /** 生效中的人工锁定 */
  locks: FxLock[];
  /** 待审核的锁定 / 解锁申请 */
  pending_locks: Approval[];
  lock_rules: FxLockRules;
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
  /** 生效中的人工锁定 */
  locks: { currency: CurrencyCode; rate: string; expires_at: string }[];
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

export function fetchFxLocks(token: string, limit = 20): Promise<{ items: FxLock[] }> {
  return apiRequest("GET", `${FX_BASE}/locks?limit=${limit}`, { token });
}

/** 发起锁定（双人复核）：`rate` 是十进制字符串，`expires_at` 带时区。 */
export function requestFxLock(token: string, body: { currency: CurrencyCode; rate: string; expires_at: string; reason: string | null }): Promise<{ approval: Approval }> {
  return apiRequest("POST", `${FX_BASE}/locks`, { token, body });
}

/** 发起解锁（双人复核）。 */
export function requestFxUnlock(token: string, lockId: string, reason: string | null): Promise<{ approval: Approval }> {
  return apiRequest("POST", `${FX_BASE}/locks/${encodeURIComponent(lockId)}/release`, { token, body: { reason } });
}

/** 对账用：每个类型的字段名清单。 */
export const FX_SCHEMA_FIELDS = {
  FxFetch: ["id", "started_at", "finished_at", "trigger", "triggered_by", "source", "status", "error_code", "error_detail", "source_as_of", "source_next_update_at", "held_rates", "jumps", "decided_by", "decided_at"],
  FxOverview: ["base", "state", "as_of", "fetched_at", "stale_at", "max_age_hours", "jump_threshold_bp", "source", "rates", "cross", "source_status", "held", "locks", "pending_locks", "lock_rules"],
  FxHistory: ["base", "from", "to", "series"],
  DashboardFx: ["state", "as_of", "stale_at", "held", "last_attempt_status", "locks"],
  FxLock: ["id", "currency", "rate", "reason", "expires_at", "locked_at", "central_rate", "central_as_of", "deviation_bp", "lock_approval_id", "requested_by", "approved_by", "status", "ended_at", "end_approval_id", "ended_by"],
} as const satisfies {
  FxFetch: readonly (keyof FxFetch)[];
  FxLock: readonly (keyof FxLock)[];
  FxOverview: readonly (keyof FxOverview)[];
  FxHistory: readonly (keyof FxHistory)[];
  DashboardFx: readonly (keyof DashboardFx)[];
};

/** 前端按错误码处理的汇率错误。 */
export const FX_ERROR_CODES = ["FX_FETCH_IN_PROGRESS", "FX_FETCH_NOT_HELD", "FX_HELD_OUTDATED", "FX_LOCK_NOT_ACTIVE", "FX_RATE_UNAVAILABLE", "APPROVAL_STALE"] as const;
