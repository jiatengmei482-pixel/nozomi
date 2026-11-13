/**
 * 运营后台「共享区域去重」（M8-31b，ADR 0083 补充）：一个城市里共享库的全部区域（含隐藏中的），标为重复、撤销。
 * 看要 `master_data.read`，标记、撤销要 `master_data.manage`。类型手写，与 `apps/api/openapi.yaml` 对账（`shared-area-duplicates.contract.test.ts`）。
 */
import type { LocalizedText, SharedAreaSimilarity } from "@nozomi/domain";
import { query } from "./areas.ts";
import { apiRequest } from "./client.ts";

export const PLATFORM_SHARED_AREAS_PATH = "/platform/v1/shared-areas";
export const PLATFORM_SHARED_AREA_QUERY_KEYS = ["city_id", "q"] as const;

export interface SharedAreaDuplicateActor {
  id: string;
  name: string;
}

export interface PlatformSharedAreaMark {
  id: string;
  keep_area_id: string;
  /** 保留那份的名称；它已不在共享库里时为 null */
  keep_area_name: LocalizedText | null;
  /** 保留的那份还在共享库里（false 时以后引用被隐藏的那份会失败，请撤销） */
  keep_area_listed: boolean;
  reason: string;
  marked_by: SharedAreaDuplicateActor;
  marked_at: string;
}

export interface PlatformSharedArea {
  id: string;
  city_id: string;
  name: LocalizedText;
  shape_version: number;
  operate_polygon_count: number;
  forbid_polygon_count: number;
  updated_at: string;
  copy_count: number;
  duplicate: PlatformSharedAreaMark | null;
  similar: { id: string; reasons: SharedAreaSimilarity[] }[];
}

export interface SharedAreaDuplicate {
  id: string;
  area_id: string;
  keep_area_id: string;
  reason: string;
  marked_by: SharedAreaDuplicateActor;
  marked_at: string;
  revoked_by: SharedAreaDuplicateActor | null;
  revoked_at: string | null;
  revoke_reason: string | null;
}

/** 与 openapi.yaml 对账用的字段清单 */
export const SHARED_AREA_DUPLICATE_FIELDS = {
  PlatformSharedArea: ["id", "city_id", "name", "shape_version", "operate_polygon_count", "forbid_polygon_count", "updated_at", "copy_count", "duplicate", "similar"],
  Mark: ["id", "keep_area_id", "keep_area_name", "keep_area_listed", "reason", "marked_by", "marked_at"],
  SharedAreaDuplicate: ["id", "area_id", "keep_area_id", "reason", "marked_by", "marked_at", "revoked_by", "revoked_at", "revoke_reason"],
  Page: ["items", "truncated"],
} as const;

export function listPlatformSharedAreas(token: string, cityId: string, q: string): Promise<{ items: PlatformSharedArea[]; truncated: boolean }> {
  return apiRequest("GET", query(PLATFORM_SHARED_AREAS_PATH, { city_id: cityId, q: q.trim() === "" ? undefined : q.trim() }), { token });
}

export function markSharedAreaDuplicate(token: string, id: string, body: { keep_area_id: string; reason: string }): Promise<SharedAreaDuplicate> {
  return apiRequest("POST", `${PLATFORM_SHARED_AREAS_PATH}/${encodeURIComponent(id)}/mark-duplicate`, { token, body });
}

export function unmarkSharedAreaDuplicate(token: string, id: string, reason: string | null): Promise<SharedAreaDuplicate> {
  return apiRequest("POST", `${PLATFORM_SHARED_AREAS_PATH}/${encodeURIComponent(id)}/unmark-duplicate`, { token, body: { reason } });
}
