/** 供应商入驻（M4-01）的手写类型、路径、枚举与 `apps/api/openapi.yaml` 对账。后端改了接口，这里会失败。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { ACTOR_NAMES, DOCUMENT_STATUS_BADGES, REQUIREMENT_BADGES, SCORE_COMPONENT_NAMES, SUSPENSION_REASON_NAMES, OBSERVATION_REASON_NAMES, TENANT_STATUS_NAMES, TRIGGER_NAMES } from "../lib/onboarding-display.ts";
import { APPROVAL_KIND_NAMES } from "../lib/channel-display.ts";
import type { CompanyOverview, CompanyProfile, DocumentRequirement, TenantContract, TenantDocument, TenantFile, TenantNotice, TenantPerformance, TenantStatusEvent } from "./onboarding.ts";
import { DOCUMENT_QUEUE_PATH, PLATFORM_TENANTS_PATH, TENANT_COMPANY_PATH, TENANT_PERFORMANCE_PATH } from "./onboarding.ts";
import { SCHEMA_FIELDS, TENANT_STATUSES } from "./types.ts";

interface Schema {
  $ref?: string;
  type?: string | string[];
  enum?: (string | null)[];
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  oneOf?: Schema[];
}
interface Operation {
  responses: Record<string, { $ref?: string; content?: Record<string, { schema?: Schema }> }>;
  requestBody?: { $ref?: string; content?: Record<string, { schema?: Schema }> };
}

const spec = parse(await readFile(new URL("../../../api/openapi.yaml", import.meta.url), "utf8")) as { paths: Record<string, Record<string, Operation>>; components: { schemas: Record<string, Schema> } };
const schemas = spec.components.schemas;
const props = (name: string): string[] => Object.keys(schemas[name]?.properties ?? {}).sort();
const op = (method: string, path: string): Operation => {
  const found = spec.paths[path]?.[method];
  assert.ok(found, `openapi.yaml 里没有 ${method.toUpperCase()} ${path}`);
  return found;
};

/** 每个手写类型的字段清单：`satisfies` 保证没有类型上不存在的字段，对账测试保证和 openapi 一致。 */
const FIELDS = {
  CompanyProfile: ["country_code", "legal_name", "registration_no", "address", "contact_name", "contact_phone", "contact_email", "version", "updated_at"],
  TenantFile: ["id", "purpose", "content_type", "byte_size", "sha256", "file_name", "uploaded_at"],
  TenantDocument: ["id", "type", "type_name", "status", "expires_on", "note", "file", "submitted_at", "reviewed_at", "review_reason", "reviewed_by"],
  DocumentRequirement: ["type", "type_name", "required", "expiry", "state", "approved_document_id", "latest_document_id", "expires_on", "days_left"],
  TenantContract: ["id", "version", "valid_from", "settle_currency", "settle_cycle", "payment_day", "service_fee_bp", "deposit", "file_id", "note", "created_at"],
  CompanyOverview: ["tenant", "today", "profile", "required_document_types", "requirements", "documents", "contracts", "effective_contract", "next_step_issues"],
  TenantStatusEvent: ["id", "trigger", "from_status", "to_status", "suspension_before", "suspension_after", "observation_before", "observation_after", "actor", "note", "approval_id", "occurred_at"],
  TenantNotice: ["id", "kind", "data", "created_at"],
  TenantPerformance: ["today", "status", "observation_reasons", "suspension_reasons", "rules", "latest", "trend"],
} as const satisfies {
  CompanyProfile: readonly (keyof CompanyProfile)[];
  TenantFile: readonly (keyof TenantFile)[];
  TenantDocument: readonly (keyof TenantDocument)[];
  DocumentRequirement: readonly (keyof DocumentRequirement)[];
  TenantContract: readonly (keyof TenantContract)[];
  CompanyOverview: readonly (keyof CompanyOverview)[];
  TenantStatusEvent: readonly (keyof TenantStatusEvent)[];
  TenantNotice: readonly (keyof TenantNotice)[];
  TenantPerformance: readonly (keyof TenantPerformance)[];
};

test("入驻的几种对象：前端的字段和 openapi.yaml 的定义一一对应", () => {
  for (const [name, fields] of Object.entries(FIELDS)) assert.deepEqual([...fields].sort(), props(name), name);
  assert.deepEqual([...SCHEMA_FIELDS.Tenant].sort(), props("Tenant"));
});

test("枚举：状态、暂停和观察的原因、资质的状态和现状、状态记录的动作、提醒、评分的五项都有中文说法，和定义一致", () => {
  const enumOf = (schema: Schema | undefined): (string | null)[] => (schema?.$ref ? enumOf(schemas[schema.$ref.replace("#/components/schemas/", "")]) : (schema?.enum ?? []));
  assert.deepEqual([...TENANT_STATUSES].sort(), [...enumOf(schemas["TenantStatus"])].sort());
  assert.deepEqual(Object.keys(TENANT_STATUS_NAMES).sort(), [...TENANT_STATUSES].sort());
  assert.deepEqual(Object.keys(SUSPENSION_REASON_NAMES).sort(), [...enumOf(schemas["Tenant"]?.properties?.["suspension_reasons"]?.items)].sort());
  assert.deepEqual(Object.keys(OBSERVATION_REASON_NAMES).sort(), [...enumOf(schemas["Tenant"]?.properties?.["observation_reasons"]?.items)].sort());
  assert.deepEqual(Object.keys(DOCUMENT_STATUS_BADGES).sort(), [...enumOf(schemas["TenantDocument"]?.properties?.["status"])].sort());
  assert.deepEqual(Object.keys(REQUIREMENT_BADGES).sort(), [...enumOf(schemas["DocumentRequirement"]?.properties?.["state"])].sort());
  assert.deepEqual(Object.keys(TRIGGER_NAMES).sort(), [...enumOf(schemas["TenantStatusEvent"]?.properties?.["trigger"])].sort());
  assert.deepEqual(Object.keys(ACTOR_NAMES).sort(), [...enumOf(schemas["TenantStatusEvent"]?.properties?.["actor"]?.properties?.["type"])].sort());
  const latest = schemas["TenantPerformance"]?.properties?.["latest"]?.oneOf?.find((option) => option.type === "object");
  assert.deepEqual(Object.keys(SCORE_COMPONENT_NAMES).sort(), [...(latest?.properties?.["components"]?.required ?? [])].sort());
  assert.deepEqual(Object.keys(APPROVAL_KIND_NAMES).sort(), [...enumOf(schemas["Approval"]?.properties?.["kind"])].sort());
});

test("前端用到的入驻接口都在定义里，应答的结构对得上", () => {
  const ref = (schema: Schema | undefined): string | undefined => schema?.$ref?.replace("#/components/schemas/", "");
  const json = (operation: Operation, status: string): Schema | undefined => operation.responses[status]?.content?.["application/json"]?.schema;
  assert.equal(ref(json(op("get", TENANT_COMPANY_PATH), "200")), "CompanyOverview");
  assert.equal(ref(json(op("put", `${TENANT_COMPANY_PATH}/profile`), "200")), "CompanyProfile");
  assert.equal(ref(json(op("post", `${TENANT_COMPANY_PATH}/files`), "201")), "TenantFile");
  assert.ok(op("get", `${TENANT_COMPANY_PATH}/files/{id}`).responses["200"]);
  assert.equal(ref(json(op("post", `${TENANT_COMPANY_PATH}/documents`), "201")), "TenantDocument");
  assert.equal(ref(json(op("post", `${TENANT_COMPANY_PATH}/submit`), "200")), "Tenant");
  assert.ok(op("get", `${TENANT_COMPANY_PATH}/status-events`));
  assert.ok(op("get", `${TENANT_COMPANY_PATH}/notices`));
  assert.equal(ref(json(op("get", TENANT_PERFORMANCE_PATH), "200")), "TenantPerformance");
  assert.equal(ref(json(op("get", `${PLATFORM_TENANTS_PATH}/{id}/company`), "200")), "CompanyOverview");
  assert.equal(ref(json(op("get", `${PLATFORM_TENANTS_PATH}/{id}/performance`), "200")), "TenantPerformance");
  assert.ok(op("get", `${PLATFORM_TENANTS_PATH}/{id}/status-events`));
  assert.ok(op("get", `${PLATFORM_TENANTS_PATH}/{id}/files/{fileId}`));
  assert.ok(op("post", `${PLATFORM_TENANTS_PATH}/{id}/files`));
  assert.ok(op("get", DOCUMENT_QUEUE_PATH));
  for (const decision of ["approve", "reject", "request-supplement"]) assert.ok(op("post", `${PLATFORM_TENANTS_PATH}/{id}/documents/{documentId}/${decision}`));
  for (const action of ["contracts", "suspend", "terminate"]) assert.ok(op("post", `${PLATFORM_TENANTS_PATH}/{id}/${action}`).responses["202"], `${action} 是发起复核（202）`);
  for (const action of ["sign", "start-trial", "resume"]) assert.equal(ref(json(op("post", `${PLATFORM_TENANTS_PATH}/{id}/${action}`), "200")), "Tenant", action);
});
