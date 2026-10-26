/**
 * 供应商入驻的接口（M4-01，ADR 0028）：供应商自己的企业信息、资质、合同、状态记录、提醒、评分（`/tenant/v1/company*`、`/tenant/v1/performance`），
 * 运营后台的审核、合同、状态动作（`/platform/v1/tenants/:id/*`、`/platform/v1/tenant-documents`）。
 * 字段与 `apps/api/openapi.yaml` 对齐，由 onboarding.contract.test.ts 保证。
 */
import { query } from "./areas.ts";
import type { Approval } from "./channels.ts";
import { type DownloadedFile, apiDownload, apiRequest, apiUpload } from "./client.ts";
import type { Tenant, TenantStatus } from "./types.ts";

export const TENANT_COMPANY_PATH = "/tenant/v1/company";
export const TENANT_PERFORMANCE_PATH = "/tenant/v1/performance";
export const PLATFORM_TENANTS_PATH = "/platform/v1/tenants";
export const DOCUMENT_QUEUE_PATH = "/platform/v1/tenant-documents";

export type DocumentType = "commercial_registration" | "business_license" | "passenger_transport_license" | "passenger_liability_insurance" | "vehicle_insurance" | "settlement_account" | "other";
export type DocumentStatus = "pending" | "approved" | "rejected" | "supplement_requested" | "superseded";
export type RequirementState = "missing" | "pending" | "rejected" | "supplement_requested" | "approved" | "expiring" | "expired";
export type FileContentType = "application/pdf" | "image/jpeg" | "image/png";

export interface CompanyProfile {
  country_code: string | null;
  legal_name: string | null;
  registration_no: string | null;
  address: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  version: number;
  updated_at: string;
}

export type ProfileInput = Omit<CompanyProfile, "version" | "updated_at">;

export interface TenantFile {
  id: string;
  purpose: "document" | "contract";
  content_type: FileContentType;
  byte_size: number;
  sha256: string;
  file_name: string;
  uploaded_at: string;
}

export interface TenantDocument {
  id: string;
  type: DocumentType;
  type_name: string;
  status: DocumentStatus;
  expires_on: string | null;
  note: string | null;
  file: { id: string; content_type: string; byte_size: number; file_name: string };
  submitted_at: string;
  reviewed_at: string | null;
  review_reason: string | null;
  /** 只在运营后台的接口里有 */
  reviewed_by?: { id: string; name: string; email: string } | null;
}

export interface DocumentRequirement {
  type: DocumentType;
  type_name: string;
  required: boolean;
  expiry: "required" | "optional" | "none";
  state: RequirementState;
  approved_document_id: string | null;
  latest_document_id: string | null;
  expires_on: string | null;
  days_left: number | null;
}

export interface TenantContract {
  id: string;
  version: number;
  valid_from: string;
  settle_currency: string;
  settle_cycle: "monthly";
  payment_day: number;
  service_fee_bp: number;
  deposit: number;
  file_id: string | null;
  note: string | null;
  created_at: string;
}

export interface TenantIssue {
  path: string;
  reason: string;
  detail?: Record<string, unknown>;
}

export interface CompanyOverview {
  tenant: Tenant;
  today: string;
  profile: CompanyProfile | null;
  required_document_types: DocumentType[];
  requirements: DocumentRequirement[];
  documents: TenantDocument[];
  contracts: TenantContract[];
  effective_contract: TenantContract | null;
  next_step_issues: TenantIssue[];
}

export type StatusTrigger = "submit" | "return" | "sign" | "start_trial" | "promote" | "suspend" | "resume" | "terminate" | "observation";

export interface TenantStatusEvent {
  id: string;
  trigger: StatusTrigger;
  from_status: TenantStatus;
  to_status: TenantStatus;
  suspension_before: string[];
  suspension_after: string[];
  observation_before: string[];
  observation_after: string[];
  /** 供应商看到的只有 type */
  actor: { type: "tenant_user" | "platform_user" | "system"; id?: string | null; email?: string | null };
  /** 只在运营后台 */
  note?: string | null;
  approval_id?: string | null;
  occurred_at: string;
}

export type NoticeKind = "document_expiring" | "document_expired" | "document_reviewed" | "status_changed" | "observation_started" | "observation_ended";

export interface TenantNotice {
  id: string;
  kind: NoticeKind;
  data: Record<string, unknown>;
  created_at: string;
}

export type ScoreComponentKey = "dispatch" | "arrival" | "rating" | "complaint" | "failure";

export interface ScoreComponent {
  value: number | null;
  points_centi: number | null;
  weight_bp: number;
}

export interface ScoreDay {
  date: string;
  window_from: string;
  score_centi: number;
  raw_score_centi: number | null;
  is_default: boolean;
  completed_orders: number;
  no_shows: number;
  components: Record<ScoreComponentKey, ScoreComponent>;
  inputs: Record<string, number>;
}

export interface TenantPerformance {
  today: string;
  status: TenantStatus;
  observation_reasons: string[];
  suspension_reasons: string[];
  rules: {
    window_days: number;
    default_score_centi: number;
    min_completed_orders: number;
    observation_below_centi: number;
    suspend_below_centi: number;
    no_show_window_days: number;
    no_show_observation: number;
    no_show_suspend: number;
    weights_bp: Record<ScoreComponentKey, number>;
    trial_daily_order_limit: number;
  };
  latest: ScoreDay | null;
  trend: { date: string; score_centi: number; raw_score_centi: number | null; is_default: boolean; completed_orders: number }[];
}

export interface QueuedDocument {
  tenant: { id: string; name: string; status: TenantStatus };
  document: TenantDocument;
}

const one = (id: string): string => `${PLATFORM_TENANTS_PATH}/${encodeURIComponent(id)}`;

/** 资质文件的类型：按扩展名猜不出来时让服务器按字节判断（`application/octet-stream`）。 */
export function fileContentType(file: File): string {
  if (file.type === "application/pdf" || file.type === "image/jpeg" || file.type === "image/png") return file.type;
  return "application/octet-stream";
}

// ───────────── 供应商自己 ─────────────

export function getOwnCompany(token: string): Promise<CompanyOverview> {
  return apiRequest("GET", TENANT_COMPANY_PATH, { token });
}

/** 企业信息：第一次（`version` 为 null）不带 If-Match，以后带当前版本。 */
export function putOwnProfile(token: string, body: ProfileInput, version: number | null): Promise<CompanyProfile> {
  return apiRequest("PUT", `${TENANT_COMPANY_PATH}/profile`, { token, body, ...(version === null ? {} : { headers: { "if-match": `"${version}"` } }) });
}

export function uploadOwnFile(token: string, file: File, signal?: AbortSignal): Promise<TenantFile> {
  return apiUpload(query(`${TENANT_COMPANY_PATH}/files`, { file_name: file.name }), file, { token, contentType: fileContentType(file), ...(signal === undefined ? {} : { signal }) });
}

export function submitOwnDocument(token: string, body: { type: DocumentType; file_id: string; expires_on: string | null; note: string | null }): Promise<TenantDocument> {
  return apiRequest("POST", `${TENANT_COMPANY_PATH}/documents`, { token, body });
}

export function submitForReview(token: string): Promise<Tenant> {
  return apiRequest("POST", `${TENANT_COMPANY_PATH}/submit`, { token });
}

export function listOwnStatusEvents(token: string): Promise<{ items: TenantStatusEvent[] }> {
  return apiRequest("GET", `${TENANT_COMPANY_PATH}/status-events`, { token });
}

export function listOwnNotices(token: string): Promise<{ items: TenantNotice[]; next_cursor: string | null }> {
  return apiRequest("GET", query(`${TENANT_COMPANY_PATH}/notices`, { limit: 20 }), { token });
}

export function getOwnPerformance(token: string): Promise<TenantPerformance> {
  return apiRequest("GET", TENANT_PERFORMANCE_PATH, { token });
}

export function downloadOwnFile(token: string, fileId: string): Promise<DownloadedFile> {
  return apiDownload(`${TENANT_COMPANY_PATH}/files/${encodeURIComponent(fileId)}`, { token, accept: "application/pdf, image/jpeg, image/png" });
}

// ───────────── 运营后台 ─────────────

export function getTenantCompany(token: string, id: string): Promise<CompanyOverview> {
  return apiRequest("GET", `${one(id)}/company`, { token });
}

export function listTenantStatusEvents(token: string, id: string): Promise<{ items: TenantStatusEvent[] }> {
  return apiRequest("GET", `${one(id)}/status-events`, { token });
}

export function getTenantPerformance(token: string, id: string): Promise<TenantPerformance> {
  return apiRequest("GET", `${one(id)}/performance`, { token });
}

export function downloadTenantFile(token: string, id: string, fileId: string): Promise<DownloadedFile> {
  return apiDownload(`${one(id)}/files/${encodeURIComponent(fileId)}`, { token, accept: "application/pdf, image/jpeg, image/png" });
}

export function uploadContractFile(token: string, id: string, file: File): Promise<TenantFile> {
  return apiUpload(query(`${one(id)}/files`, { file_name: file.name }), file, { token, contentType: fileContentType(file) });
}

export function listDocumentQueue(token: string, filter: { kind: "pending" | "expiring"; withinDays?: number; cursor?: string | null }): Promise<{ items: QueuedDocument[]; next_cursor: string | null; total: number }> {
  return apiRequest("GET", query(DOCUMENT_QUEUE_PATH, { kind: filter.kind, limit: 50, ...(filter.withinDays === undefined ? {} : { within_days: filter.withinDays }), ...(filter.cursor ? { cursor: filter.cursor } : {}) }), { token });
}

export type DocumentDecision = "approve" | "reject" | "request-supplement";

export function reviewDocument(token: string, tenantId: string, documentId: string, decision: DocumentDecision, body: { reason?: string; expires_on?: string | null }): Promise<{ document: TenantDocument; tenant: Tenant }> {
  return apiRequest("POST", `${one(tenantId)}/documents/${encodeURIComponent(documentId)}/${decision}`, { token, body });
}

export function requestContract(token: string, id: string, body: { valid_from: string; settle_currency: string; file_id: string | null; note: string | null }): Promise<{ approval: Approval }> {
  return apiRequest("POST", `${one(id)}/contracts`, { token, body });
}

export function signTenant(token: string, id: string, note: string | null): Promise<Tenant> {
  return apiRequest("POST", `${one(id)}/sign`, { token, body: { note } });
}

export function startTenantTrial(token: string, id: string, testOrderNote: string): Promise<Tenant> {
  return apiRequest("POST", `${one(id)}/start-trial`, { token, body: { test_order_note: testOrderNote } });
}

export function requestTerminateTenant(token: string, id: string, reason: string): Promise<{ approval: Approval }> {
  return apiRequest("POST", `${one(id)}/terminate`, { token, body: { reason } });
}
