/** 运营后台供应商、平台员工、审计日志、系统状态的手写类型与 `apps/api/openapi.yaml` 对账。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { PLATFORM_ROLES } from "@nozomi/domain";
import { ACTION_NAMES, ACTOR_TYPE_NAMES, RESOURCE_NAMES, SOURCE_NAMES } from "../lib/audit-display.ts";
import { ACCOUNT_STATUS_BADGES } from "../lib/platform-display.ts";
import { AUDIT_LOGS_PATH, AUDIT_QUERY_KEYS, type FxCenterStatus, INTEGRATIONS_PATH, PLATFORM_ERROR_CODES, PLATFORM_SCHEMA_FIELDS, STAFF_PATH, TENANTS_PATH } from "./platform.ts";

interface Schema {
  $ref?: string;
  type?: string | string[];
  enum?: (string | null)[];
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
}
interface Parameter {
  $ref?: string;
  name?: string;
  in?: string;
}
interface Operation {
  parameters?: Parameter[];
  requestBody?: { required?: boolean; content?: { "application/json"?: { schema?: Schema } } };
  responses: Record<string, { content?: { "application/json"?: { schema?: Schema } } }>;
}
interface OpenApi {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema>; parameters: Record<string, Parameter> };
}

const text = await readFile(new URL("../../../api/openapi.yaml", import.meta.url), "utf8");
const spec = parse(text) as OpenApi;
const schemas = spec.components.schemas;
const ref = (schema: Schema | undefined): string | undefined => schema?.$ref?.replace("#/components/schemas/", "");
function op(method: string, path: string): Operation {
  const found = spec.paths[path]?.[method];
  assert.ok(found, `openapi.yaml 里没有 ${method.toUpperCase()} ${path}`);
  return found;
}
const response = (operation: Operation, status: string): Schema | undefined => operation.responses[status]?.content?.["application/json"]?.schema;
const request = (operation: Operation): Schema | undefined => operation.requestBody?.content?.["application/json"]?.schema;
const params = (operation: Operation): string[] =>
  (operation.parameters ?? []).map((parameter) => {
    const resolved = parameter.$ref ? spec.components.parameters[parameter.$ref.replace("#/components/parameters/", "")] : parameter;
    return `${resolved?.in}:${resolved?.name}`;
  });
const props = (schema: Schema | undefined): string[] => Object.keys(schema?.properties ?? {}).sort();

test("供应商的接口：路径、方法、请求体、应答；五个发令牌的接口应答里是 { token, expires_at }", () => {
  const list = op("get", TENANTS_PATH);
  assert.equal(ref(response(list, "200")?.properties?.["items"]?.items), "Tenant");
  assert.deepEqual(response(list, "200")?.required, ["items", "next_cursor"]);
  for (const key of ["limit", "cursor"]) assert.ok(params(list).includes(`query:${key}`));
  assert.ok(!params(list).some((entry) => /query:(q|status)$/.test(entry)), "列表接口还不能筛：页面全部取完在浏览器里筛。接口支持以后这条会失败，提醒把页面改过去");

  const create = op("post", TENANTS_PATH);
  assert.deepEqual(request(create)?.required, ["name", "admin"]);
  assert.deepEqual(request(create)?.properties?.["admin"]?.required, ["email", "name"]);
  assert.deepEqual(props(response(create, "201")), ["admin_user", "invite", "tenant"]);
  assert.equal(ref(response(create, "201")?.properties?.["invite"]), "Invite");
  assert.ok(!params(create).includes("header:Idempotency-Key"), "新建供应商还没有幂等键：网络不明时页面请人先去列表看一眼。接口支持以后这条会失败");

  assert.equal(ref(response(op("get", `${TENANTS_PATH}/{id}`), "200")), "Tenant");
  const suspend = op("post", `${TENANTS_PATH}/{id}/suspend`);
  assert.deepEqual(props(request(suspend)), ["reason"]);
  assert.equal(ref(response(suspend, "200")), "Tenant");
  assert.equal(ref(response(op("post", `${TENANTS_PATH}/{id}/resume`), "200")), "Tenant");

  const invite = op("post", `${TENANTS_PATH}/{id}/admin-invites`);
  assert.deepEqual(request(invite)?.required, ["email", "name"]);
  assert.deepEqual(props(response(invite, "201")), ["invite", "user"]);
  const reset = op("post", `${TENANTS_PATH}/{id}/admin-password-resets`);
  assert.deepEqual(request(reset)?.required, ["email"]);
  assert.deepEqual(props(response(reset, "201")), ["reset", "user"]);
  assert.equal(ref(response(reset, "201")?.properties?.["reset"]), "ResetToken");
});

test("平台员工的接口：新增、停用、启用、发密码重置", () => {
  const list = op("get", STAFF_PATH);
  assert.equal(ref(response(list, "200")?.properties?.["items"]?.items), "StaffMember");
  const create = op("post", STAFF_PATH);
  assert.deepEqual(request(create)?.required, ["email", "name", "role"]);
  assert.deepEqual(props(response(create, "201")), ["invite", "user"]);
  for (const action of ["disable", "enable"]) assert.equal(ref(response(op("post", `${STAFF_PATH}/{id}/${action}`), "200")), "PlatformUser");
  const reset = op("post", `${STAFF_PATH}/{id}/password-reset`);
  assert.equal(reset.requestBody, undefined, "给员工发密码重置不带请求体");
  assert.deepEqual(props(response(reset, "201")), ["reset", "user"]);
  assert.deepEqual(schemas["PlatformRole"]?.enum, PLATFORM_ROLES.map((role) => role.key));
  assert.deepEqual([...(schemas["AccountStatus"]?.enum ?? [])].sort(), Object.keys(ACCOUNT_STATUS_BADGES).sort());
});

test("审计日志和系统状态：筛选参数、枚举都对得上；对象类型和操作在页面的对照表里都有中文名", () => {
  const list = op("get", AUDIT_LOGS_PATH);
  for (const key of AUDIT_QUERY_KEYS) assert.ok(params(list).includes(`query:${key}`), `审计日志没有查询参数 ${key}`);
  assert.ok(!params(list).includes("query:actor_email"), "还不能按操作人的邮箱筛：操作人只能从别处带进来。接口支持以后这条会失败");
  const log = schemas["AuditLog"];
  for (const resource of log?.properties?.["resource"]?.enum ?? []) assert.ok(RESOURCE_NAMES[resource as string], `对象类型 ${resource} 没有中文名`);
  for (const action of log?.properties?.["action"]?.enum ?? []) assert.ok(ACTION_NAMES[action as string], `操作 ${action} 没有中文名`);
  assert.deepEqual([...(log?.properties?.["actor"]?.properties?.["type"]?.enum ?? [])].sort(), Object.keys(ACTOR_TYPE_NAMES).sort());
  assert.deepEqual([...(log?.properties?.["source"]?.enum ?? [])].sort(), Object.keys(SOURCE_NAMES).sort());
  assert.deepEqual(log?.properties?.["actor"]?.required, ["type", "id", "email"]);
  assert.equal(ref(response(op("get", INTEGRATIONS_PATH), "200")?.properties?.["items"]?.items), "IntegrationStatusDetail");
  assert.deepEqual(schemas["IntegrationStatusDetail"]?.properties?.["state"]?.enum, ["configured", "missing"]);
  // 汇率数据源的运行状态（M1-14 起系统状态页显示）：字段和手写的 FxCenterStatus 一样
  const fx = response(op("get", INTEGRATIONS_PATH), "200")?.properties?.["fx_center"];
  const fields: (keyof FxCenterStatus)[] = ["state", "as_of", "auto_fetch", "last_attempt_status", "last_attempt_at", "last_error_code"];
  assert.deepEqual(Object.keys(fx?.properties ?? {}).sort(), [...fields].sort());
  assert.deepEqual([...(fx?.required ?? [])].sort(), [...fields].sort());
});

test("手写类型的字段与同名 schema 完全一致；页面处理的错误码都写在 openapi.yaml 里", () => {
  for (const [name, fields] of Object.entries(PLATFORM_SCHEMA_FIELDS)) {
    const schema = schemas[name];
    assert.ok(schema, `openapi.yaml 里没有 schema ${name}`);
    assert.deepEqual(props(schema), [...fields].sort(), `${name} 的字段不一致`);
    assert.deepEqual([...(schema.required ?? [])].sort(), [...fields].sort(), `${name} 的必有字段不一致`);
  }
  for (const code of PLATFORM_ERROR_CODES) assert.ok(text.includes(`\`${code}\``), `openapi.yaml 里找不到 ${code}`);
  assert.deepEqual(schemas["Tenant"]?.properties?.["status"]?.enum, ["active", "suspended"]);
});
