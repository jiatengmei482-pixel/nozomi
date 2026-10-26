/**
 * 运营后台「渠道」「待审核」的接口（`/platform/v1/channels*`、`/platform/v1/approvals*`，ADR 0023）。
 * 字段与 `apps/api/openapi.yaml` 对齐，由 channels.contract.test.ts 保证。
 *
 * - 改定价参数、加价规则、暂停渠道不直接生效：接口返回 202 和一条待审核的复核记录（`Approval`）。
 * - 新建、轮换 API 客户端的应答里有密钥原文（`client_secret`）：只在这一次应答里出现。这里原样交给页面，不缓存、不打日志、不自动重试。
 */
import type { ServiceCategory } from "@nozomi/domain";
import { query } from "./areas.ts";
import { apiRequest } from "./client.ts";
import { PAGE_LIMIT, PLATFORM_BASE, type Page } from "./platform.ts";

export const CHANNELS_PATH = `${PLATFORM_BASE}/channels`;
export const APPROVALS_PATH = `${PLATFORM_BASE}/approvals`;

export type ChannelType = "own" | "api" | "ota" | "offline";
export type ChannelStatus = "testing" | "active" | "paused";
export type TenantScope = "all" | "allow" | "deny";
export type PaymentMode = "prepaid" | "credit";

export interface NamedRef {
  id: string;
  name: string | null;
}

export interface ChannelPricing {
  default_markup_bp: number;
  markup_floor_bp: number;
  band_bp: number;
  /** 最低毛利金额（渠道结算币种的最小货币单位） */
  min_margin: number;
  /** { 客人支付币种: 取整单位（最小货币单位） } */
  sell_rounding: Record<string, number>;
}

export interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  status: ChannelStatus;
  company: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contract_ref: string | null;
  notes: string | null;
  settle_currency: string;
  payment_mode: PaymentMode;
  credit_limit: number | null;
  show_tenant_after_pay: boolean;
  scope: { tenant_scope: TenantScope; tenants: NamedRef[]; cities: NamedRef[] | null; categories: ServiceCategory[] };
  pricing: ChannelPricing;
  version: number;
  pricing_version: number;
  created_at: string;
  updated_at: string;
}

export interface MarkupRule {
  id: string;
  level: 1 | 2 | 3 | 4 | 5;
  tenant: NamedRef | null;
  city: NamedRef | null;
  category: ServiceCategory | null;
  vehicle_group: NamedRef | null;
  markup_bp: number;
  valid_from: string | null;
  valid_to: string | null;
  note: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ChannelDetail {
  channel: Channel;
  markup_rules: MarkupRule[];
}

export interface ChannelScopeInput {
  tenant_scope: TenantScope;
  tenant_ids: string[];
  city_ids: string[] | null;
  categories: ServiceCategory[];
}

export interface ChannelProfileInput {
  name: string;
  type: ChannelType;
  company: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contract_ref: string | null;
  notes: string | null;
  settle_currency: string;
  payment_mode: PaymentMode;
  credit_limit: number | null;
  show_tenant_after_pay: boolean;
}

export interface ChannelCreate extends ChannelProfileInput {
  scope: ChannelScopeInput;
  pricing: ChannelPricing;
}

export type ChannelPatch = Partial<ChannelProfileInput> & { scope?: ChannelScopeInput };

export interface MarkupRuleInput {
  tenant_id: string | null;
  city_id: string | null;
  category: ServiceCategory | null;
  vehicle_group_id: string | null;
  markup_bp: number;
  valid_from: string | null;
  valid_to: string | null;
  note: string | null;
  request_note: string | null;
}

export interface Person {
  id: string;
  name: string;
  email: string;
}

export type ApprovalKind = "channel.pricing" | "channel.pause" | "markup_rule.create" | "markup_rule.update" | "markup_rule.delete" | "fx_lock.create" | "fx_lock.release" | "tenant.suspend" | "tenant.terminate" | "tenant.contract" | "cancellation_policy.update" | "order.cancel_refund" | "rescue.manual_assign";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "withdrawn";

export interface Approval {
  id: string;
  kind: ApprovalKind;
  resource: string;
  resource_id: string;
  summary: string;
  payload: Record<string, unknown>;
  before: Record<string, unknown> | null;
  base_version: number | null;
  status: ApprovalStatus;
  requested_by: Person;
  requested_at: string;
  request_note: string | null;
  decided_by: Person | null;
  decided_at: string | null;
  decision_note: string | null;
  can: { approve: boolean; reject: boolean; withdraw: boolean };
}

export interface ApiClient {
  id: string;
  client_id: string;
  name: string;
  secret_last4: string;
  secret_generation: number;
  previous_valid_until: string | null;
  status: "active" | "revoked";
  created_at: string;
  rotated_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
}

export interface IssuedSecret {
  api_client: ApiClient;
  /** 密钥原文：只在这一次应答里 */
  client_secret: string;
}

export interface QuoteLogEntry {
  id: string;
  created_at: string;
  client_id: string;
  currency: string;
  city_id: string;
  category: ServiceCategory;
  candidate_count: number;
  quote_count: number;
  reject_count: number;
  duration_ms: number;
  request: Record<string, unknown>;
  quotes: { quote_id: string; vehicle_group_id: string; winner_tenant_id: string }[];
}

const one = (id: string): string => `${CHANNELS_PATH}/${encodeURIComponent(id)}`;

/** 渠道最多载入多少个（渠道不多，筛选在浏览器里做）。 */
export const CHANNEL_LOAD_MAX = 1000;

export async function listAllChannels(token: string): Promise<{ items: Channel[]; truncated: boolean }> {
  const items: Channel[] = [];
  let cursor: string | null = null;
  do {
    const page: Page<Channel> = await apiRequest("GET", query(CHANNELS_PATH, { limit: PAGE_LIMIT, ...(cursor !== null ? { cursor } : {}) }), { token });
    items.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor !== null && items.length < CHANNEL_LOAD_MAX);
  return { items, truncated: cursor !== null };
}

/** 首页卡片的两个数：全部渠道、启用中的。 */
export async function countChannels(token: string): Promise<{ total: number; active: number }> {
  const [all, active] = await Promise.all([
    apiRequest<{ total: number }>("GET", query(CHANNELS_PATH, { limit: 1 }), { token }),
    apiRequest<{ total: number }>("GET", query(CHANNELS_PATH, { limit: 1, status: "active" }), { token }),
  ]);
  return { total: all.total, active: active.total };
}

export function getChannel(token: string, id: string): Promise<ChannelDetail> {
  return apiRequest("GET", one(id), { token });
}

export function createChannel(token: string, body: ChannelCreate): Promise<ChannelDetail> {
  return apiRequest("POST", CHANNELS_PATH, { token, body });
}

export function updateChannel(token: string, id: string, version: number, body: ChannelPatch): Promise<ChannelDetail> {
  return apiRequest("PATCH", one(id), { token, body, headers: { "if-match": `"${version}"` } });
}

export function activateChannel(token: string, id: string): Promise<ChannelDetail> {
  return apiRequest("POST", `${one(id)}/activate`, { token });
}

export function requestChannelPause(token: string, id: string, requestNote: string | null): Promise<{ approval: Approval }> {
  return apiRequest("POST", `${one(id)}/pause`, { token, body: { request_note: requestNote } });
}

export function requestPricingChange(token: string, id: string, body: ChannelPricing & { request_note: string | null }): Promise<{ approval: Approval }> {
  return apiRequest("POST", `${one(id)}/pricing-changes`, { token, body });
}

export function requestRuleCreate(token: string, channelId: string, body: MarkupRuleInput): Promise<{ approval: Approval }> {
  return apiRequest("POST", `${one(channelId)}/markup-rules`, { token, body });
}

export function requestRuleUpdate(token: string, channelId: string, rule: MarkupRule, body: MarkupRuleInput): Promise<{ approval: Approval }> {
  return apiRequest("PUT", `${one(channelId)}/markup-rules/${encodeURIComponent(rule.id)}`, { token, body, headers: { "if-match": `"${rule.version}"` } });
}

export function requestRuleDelete(token: string, channelId: string, rule: MarkupRule): Promise<{ approval: Approval }> {
  return apiRequest("DELETE", `${one(channelId)}/markup-rules/${encodeURIComponent(rule.id)}`, { token, headers: { "if-match": `"${rule.version}"` } });
}

export function listApiClients(token: string, channelId: string): Promise<{ items: ApiClient[] }> {
  return apiRequest("GET", `${one(channelId)}/api-clients`, { token });
}

export function createApiClient(token: string, channelId: string, name: string): Promise<IssuedSecret> {
  return apiRequest("POST", `${one(channelId)}/api-clients`, { token, body: { name } });
}

export function rotateApiClient(token: string, channelId: string, clientId: string, immediate: boolean): Promise<IssuedSecret> {
  return apiRequest("POST", `${one(channelId)}/api-clients/${encodeURIComponent(clientId)}/rotate`, { token, body: { immediate } });
}

export function revokeApiClient(token: string, channelId: string, clientId: string): Promise<{ api_client: ApiClient }> {
  return apiRequest("POST", `${one(channelId)}/api-clients/${encodeURIComponent(clientId)}/revoke`, { token });
}

export function listQuoteLogs(token: string, channelId: string, limit = 20): Promise<Page<QuoteLogEntry>> {
  return apiRequest("GET", query(`${one(channelId)}/quote-logs`, { limit }), { token });
}

export function listApprovals(token: string, filter: { status?: ApprovalStatus | "all"; resource_id?: string; limit?: number; cursor?: string } = {}): Promise<Page<Approval> & { total: number }> {
  return apiRequest("GET", query(APPROVALS_PATH, { limit: filter.limit ?? 100, ...(filter.status ? { status: filter.status } : {}), ...(filter.resource_id ? { resource_id: filter.resource_id } : {}), ...(filter.cursor ? { cursor: filter.cursor } : {}) }), { token });
}

export async function countPendingApprovals(token: string): Promise<number> {
  return (await apiRequest<{ total: number }>("GET", query(APPROVALS_PATH, { limit: 1, status: "pending" }), { token })).total;
}

export function decideApproval(token: string, id: string, decision: "approve" | "reject" | "withdraw", note: string | null): Promise<{ approval: Approval }> {
  return apiRequest("POST", `${APPROVALS_PATH}/${encodeURIComponent(id)}/${decision}`, { token, body: { note } });
}

/** 对账用：字段名清单。 */
export const CHANNEL_SCHEMA_FIELDS = {
  Channel: ["id", "name", "type", "status", "company", "contact_name", "contact_email", "contact_phone", "contract_ref", "notes", "settle_currency", "payment_mode", "credit_limit", "show_tenant_after_pay", "scope", "pricing", "version", "pricing_version", "created_at", "updated_at"],
  ChannelPricing: ["default_markup_bp", "markup_floor_bp", "band_bp", "min_margin", "sell_rounding"],
  ChannelScope: ["tenant_scope", "tenants", "cities", "categories"],
  ChannelScopeInput: ["tenant_scope", "tenant_ids", "city_ids", "categories"],
  ChannelCreate: ["name", "type", "company", "contact_name", "contact_email", "contact_phone", "contract_ref", "notes", "settle_currency", "payment_mode", "credit_limit", "show_tenant_after_pay", "scope", "pricing"],
  MarkupRule: ["id", "level", "tenant", "city", "category", "vehicle_group", "markup_bp", "valid_from", "valid_to", "note", "version", "created_at", "updated_at"],
  MarkupRuleInput: ["tenant_id", "city_id", "category", "vehicle_group_id", "markup_bp", "valid_from", "valid_to", "note", "request_note"],
  Approval: ["id", "kind", "resource", "resource_id", "summary", "payload", "before", "base_version", "status", "requested_by", "requested_at", "request_note", "decided_by", "decided_at", "decision_note", "can"],
  ApiClient: ["id", "client_id", "name", "secret_last4", "secret_generation", "previous_valid_until", "status", "created_at", "rotated_at", "revoked_at", "last_used_at"],
  QuoteLogEntry: ["id", "created_at", "client_id", "currency", "city_id", "category", "candidate_count", "quote_count", "reject_count", "duration_ms", "request", "quotes"],
} as const satisfies {
  Channel: readonly (keyof Channel)[];
  ChannelPricing: readonly (keyof ChannelPricing)[];
  ChannelScope: readonly (keyof Channel["scope"])[];
  ChannelScopeInput: readonly (keyof ChannelScopeInput)[];
  ChannelCreate: readonly (keyof ChannelCreate)[];
  MarkupRule: readonly (keyof MarkupRule)[];
  MarkupRuleInput: readonly (keyof MarkupRuleInput)[];
  Approval: readonly (keyof Approval)[];
  ApiClient: readonly (keyof ApiClient)[];
  QuoteLogEntry: readonly (keyof QuoteLogEntry)[];
};

/** 页面专门处理的错误码。 */
export const CHANNEL_ERROR_CODES = ["VALIDATION_FAILED", "CHANNEL_NAME_TAKEN", "VERSION_CONFLICT", "MARKUP_RULE_CONFLICT", "RULES_BELOW_FLOOR", "CHANNEL_STATUS_UNCHANGED", "APPROVAL_SELF_REVIEW", "APPROVAL_NOT_PENDING", "APPROVAL_STALE", "API_CLIENT_REVOKED", "CHANNEL_SCOPE_DENIED"] as const;
