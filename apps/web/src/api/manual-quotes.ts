/**
 * 运营后台「人工报价」和「官网设置」的接口（M8-21，ADR 0076）。字段与 `apps/api/openapi.yaml` 对齐，由 manual-quotes.contract.test.ts 保证。
 *
 * - 列表没有个人信息：只有有没有邮箱 / WhatsApp；打开详情才解密联系方式、地点和备注，每次打开后端写一条审计。
 * - 改状态、指派要带版本号（If-Match）；备注不改版本号。
 * - 官网设置：客服 WhatsApp 号码（wa.me 用的纯数字），只有超级管理员能改；第一次保存不带 If-Match。
 */
import type { LocalizedText, ManualQuoteStatus, ServiceCategory } from "@nozomi/domain";
import type { SitePageWidth } from "./site.ts";
import { query } from "./areas.ts";
import { apiRequest } from "./client.ts";
import { PLATFORM_BASE } from "./platform.ts";

export const MANUAL_QUOTES_PATH = `${PLATFORM_BASE}/manual-quote-requests`;
export const SITE_SETTINGS_PATH = `${PLATFORM_BASE}/site-settings`;

export interface ManualQuotePerson {
  id: string;
  name: string;
}

export interface ManualQuoteSummary {
  id: string;
  request_no: string;
  status: ManualQuoteStatus;
  category: ServiceCategory;
  city: { id: string; code: string; name: LocalizedText } | null;
  service_local: string;
  passengers: number;
  luggage: number;
  package_hours: number | null;
  has_email: boolean;
  has_whatsapp: boolean;
  assignee: ManualQuotePerson | null;
  version: number;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  purged_at: string | null;
}

export interface ManualQuotePlace {
  name: string;
  lat: number;
  lng: number;
}

export interface ManualQuoteEvent {
  id: string;
  kind: "created" | "status" | "assign" | "note";
  from_status: ManualQuoteStatus | null;
  to_status: ManualQuoteStatus | null;
  assignee: ManualQuotePerson | null;
  note: string | null;
  actor: ManualQuotePerson | null;
  created_at: string;
}

export interface ManualQuoteDetail {
  request: ManualQuoteSummary;
  contact: { email: string | null; whatsapp: string | null } | null;
  pickup: ManualQuotePlace | null;
  dropoff: ManualQuotePlace | null;
  events: ManualQuoteEvent[];
}

export type ManualQuoteCounts = Record<ManualQuoteStatus, number>;

export interface ManualQuotePage {
  items: ManualQuoteSummary[];
  next_cursor: string | null;
  counts: ManualQuoteCounts;
}

export interface ManualQuoteQuery {
  limit?: number;
  cursor?: string;
  status?: ManualQuoteStatus;
  /** `me`、`unassigned` 或某位同事的编号 */
  assignee?: string;
  /** 完整的邮箱，或带国家码的 WhatsApp 号码 */
  contact?: string;
}

export interface ManualQuoteChange {
  status?: ManualQuoteStatus;
  assignee_id?: string | null;
}

export interface SiteSettings {
  support_whatsapp: string | null;
  /** 官网页面宽度（M8-28，ADR 0079）；后端还没带这一项时缺省，按 standard */
  page_width?: SitePageWidth;
  /** 0 表示还没有设置过 */
  version: number;
  updated_at: string | null;
  updated_by: ManualQuotePerson | null;
}

/** 与 openapi.yaml 对账的字段（manual-quotes.contract.test.ts）。 */
export const MANUAL_QUOTE_SCHEMA_FIELDS = {
  ManualQuoteRequestSummary: ["id", "request_no", "status", "category", "city", "service_local", "passengers", "luggage", "package_hours", "has_email", "has_whatsapp", "assignee", "version", "created_at", "updated_at", "finished_at", "purged_at"],
  ManualQuoteEvent: ["id", "kind", "from_status", "to_status", "assignee", "note", "actor", "created_at"],
  ManualQuotePlace: ["name", "lat", "lng"],
  ManualQuotePerson: ["id", "name"],
  SiteSettings: ["support_whatsapp", "version", "updated_at", "updated_by"],
} as const satisfies Record<string, readonly string[]>;
export const MANUAL_QUOTE_DETAIL_FIELDS: readonly (keyof ManualQuoteDetail)[] = ["request", "contact", "pickup", "dropoff", "events"];
export const MANUAL_QUOTE_QUERY_KEYS = ["limit", "cursor", "status", "assignee", "contact"] as const satisfies readonly (keyof ManualQuoteQuery)[];

const one = (id: string): string => `${MANUAL_QUOTES_PATH}/${encodeURIComponent(id)}`;
const ifMatch = (version: number): Record<string, string> => ({ "if-match": `"${version}"` });

export function listManualQuotes(token: string, values: ManualQuoteQuery): Promise<ManualQuotePage> {
  return apiRequest("GET", query(MANUAL_QUOTES_PATH, values), { token });
}

export function listManualQuoteAssignees(token: string): Promise<{ items: ManualQuotePerson[] }> {
  return apiRequest("GET", `${MANUAL_QUOTES_PATH}/assignees`, { token });
}

/** 打开一条：后端解密联系方式、地点、备注，并写一条审计。 */
export function getManualQuote(token: string, id: string): Promise<ManualQuoteDetail> {
  return apiRequest("GET", one(id), { token });
}

export function updateManualQuote(token: string, id: string, version: number, change: ManualQuoteChange): Promise<{ request: ManualQuoteSummary }> {
  return apiRequest("PATCH", one(id), { token, body: change, headers: ifMatch(version) });
}

export function addManualQuoteNote(token: string, id: string, note: string): Promise<{ event: ManualQuoteEvent }> {
  return apiRequest("POST", `${one(id)}/notes`, { token, body: { note } });
}

export function getSiteSettings(token: string): Promise<SiteSettings> {
  return apiRequest("GET", SITE_SETTINGS_PATH, { token });
}

/**
 * 改官网设置。客服 WhatsApp 号码 `null` 是不设（官网不显示按钮）；`page_width` 不给是不改（M8-28）。已经设置过（版本 > 0）的带 If-Match。
 */
export function updateSiteSettings(token: string, version: number, supportWhatsapp: string | null, pageWidth?: SitePageWidth): Promise<SiteSettings> {
  return apiRequest("PUT", SITE_SETTINGS_PATH, { token, body: { support_whatsapp: supportWhatsapp, ...(pageWidth !== undefined ? { page_width: pageWidth } : {}) }, ...(version > 0 ? { headers: ifMatch(version) } : {}) });
}
