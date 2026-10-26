/** 运营后台账号安全（两步验证、员工详情、角色）的手写类型与 `apps/api/openapi.yaml` 对账（ADR 0030）。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { MENU_OPERATIONS, PLATFORM_MENUS } from "@nozomi/domain";
import { APPROVAL_KIND_NAMES } from "../lib/channel-display.ts";
import { MFA_PATHS, ROLES_PATH, SECURITY_SCHEMA_FIELDS } from "./platform-security.ts";
import { STAFF_PATH } from "./platform.ts";

interface Schema {
  $ref?: string;
  enum?: string[];
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  allOf?: Schema[];
}
interface Operation {
  requestBody?: { content?: { "application/json"?: { schema?: Schema } } };
  responses: Record<string, { $ref?: string; content?: { "application/json"?: { schema?: Schema } } }>;
}
const spec = parse(await readFile(new URL("../../../api/openapi.yaml", import.meta.url), "utf8")) as { paths: Record<string, Record<string, Operation>>; components: { schemas: Record<string, Schema> } };
const schemas = spec.components.schemas;
function op(method: string, path: string): Operation {
  const found = spec.paths[path]?.[method];
  assert.ok(found, `openapi.yaml 里没有 ${method.toUpperCase()} ${path}`);
  return found;
}
const ref = (schema: Schema | undefined): string | undefined => schema?.$ref?.replace("#/components/schemas/", "");
const body = (operation: Operation, status: string): Schema | undefined => operation.responses[status]?.content?.["application/json"]?.schema;

test("两步验证的四个接口都在，应答是页面以为的样子", () => {
  assert.equal(ref(body(op("post", MFA_PATHS.verify), "200")), "MfaVerified");
  assert.deepEqual(body(op("post", MFA_PATHS.enrollment), "200")?.required, ["secret", "otpauth_uri", "expires_at"]);
  const confirm = body(op("post", MFA_PATHS.confirm), "200");
  assert.equal(ref(confirm?.allOf?.[0]), "MfaVerified");
  assert.deepEqual(confirm?.allOf?.[1]?.required, ["recovery_codes"]);
  assert.deepEqual(body(op("post", MFA_PATHS.recoveryCodes), "200")?.required, ["recovery_codes"]);
  assert.deepEqual(Object.keys(schemas["MfaFactorRequest"]?.properties ?? {}).sort(), ["code", "recovery_code"]);
  assert.deepEqual(schemas["SecondFactorStatus"]?.enum, ["enrollment_required", "verify_required", "verified"]);
});

test("员工详情、修改、发起重置两步验证；角色的五个接口", () => {
  assert.equal(ref(body(op("get", `${STAFF_PATH}/{id}`), "200")), "StaffDetail");
  assert.equal(ref(body(op("patch", `${STAFF_PATH}/{id}`), "200")), "StaffDetail");
  assert.equal(op("post", `${STAFF_PATH}/{id}/mfa-reset`).responses["202"]?.$ref, "#/components/responses/ApprovalRequested");
  assert.equal(ref(body(op("get", ROLES_PATH), "200")?.properties?.["items"]?.items), "RoleView");
  assert.equal(ref(body(op("post", ROLES_PATH), "201")), "RoleView");
  assert.equal(ref(body(op("get", `${ROLES_PATH}/{key}`), "200")), "RoleView");
  assert.ok(op("delete", `${ROLES_PATH}/{key}`).responses["204"]);
  assert.equal(op("post", `${ROLES_PATH}/{key}/changes`).responses["202"]?.$ref, "#/components/responses/ApprovalRequested");
});

test("手写类型的字段和 openapi 的 schema 一致", () => {
  for (const [name, fields] of Object.entries(SECURITY_SCHEMA_FIELDS)) {
    assert.deepEqual(Object.keys(schemas[name]?.properties ?? {}).sort(), [...fields].sort(), name);
  }
  assert.deepEqual(schemas["RoleInput"]?.required, ["name", "grants"]);
});

test("复核的每一类都有说法（含修改角色、重置两步验证）；菜单表每个菜单都有查看", () => {
  const kinds = schemas["Approval"]?.properties?.["kind"]?.enum ?? [];
  assert.deepEqual(Object.keys(APPROVAL_KIND_NAMES).sort(), [...kinds].sort());
  assert.equal(MENU_OPERATIONS.length, 4);
  for (const menu of PLATFORM_MENUS) assert.ok("view" in menu.operations, menu.key);
});
