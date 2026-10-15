/**
 * M1-10 测试角色补的契约测试：页面用到的每一个接口——客户端真正发出去的方法、路径、查询参数、请求体、请求头——
 * 逐个和 `apps/api/openapi.yaml` 对账；页面专门处理的错误码写在对应的接口上；页面的长度上限和接口一致。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { fetchDashboardSummary } from "./master.ts";
import { PAGE_LIMIT, createStaff, createTenant, getTenant, inviteTenantAdmin, issueStaffReset, issueTenantAdminReset, listAllStaff, listAllTenants, listAuditLogs, listIntegrations, resumeTenant, setStaffEnabled, suspendTenant } from "./platform.ts";
import { NAME_MAX, REASON_MAX, emailProblem } from "../lib/platform-display.ts";

interface Schema {
  $ref?: string;
  type?: string | string[];
  format?: string;
  maxLength?: number;
  minLength?: number;
  maximum?: number;
  required?: string[];
  additionalProperties?: boolean;
  properties?: Record<string, Schema>;
}
interface Parameter {
  $ref?: string;
  name?: string;
  in?: string;
  schema?: Schema;
}
interface Operation {
  security?: Record<string, string[]>[];
  description?: string;
  parameters?: Parameter[];
  requestBody?: { required?: boolean; content?: { "application/json"?: { schema?: Schema } } };
  responses: Record<string, { $ref?: string; description?: string }>;
}
interface OpenApi {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema>; parameters: Record<string, Parameter>; responses: Record<string, { description?: string }> };
}

const spec = parse(await readFile(new URL("../../../api/openapi.yaml", import.meta.url), "utf8")) as OpenApi;
const deref = (schema: Schema | undefined): Schema | undefined => (schema?.$ref ? spec.components.schemas[schema.$ref.replace("#/components/schemas/", "")] : schema);
const parameter = (entry: Parameter): Parameter => (entry.$ref ? (spec.components.parameters[entry.$ref.replace("#/components/parameters/", "")] as Parameter) : entry);
const responseText = (operation: Operation, status: string): string => {
  const response = operation.responses[status];
  if (!response) return "";
  return (response.$ref ? spec.components.responses[response.$ref.replace("#/components/responses/", "")]?.description : response.description) ?? "";
};

interface Sent {
  method: string;
  path: string;
  query: string[];
  headers: Record<string, string>;
  body: unknown;
}
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
/** 调一次客户端的函数，记下它真正发出去的请求。 */
/** 应答的替身：列表是空的一页；发令牌的接口带着令牌（客户端不认没有令牌的成功应答）。 */
const ONE_TIME = { token: "nzi_contract-test-token", expires_at: "2026-10-16T05:30:00.000Z" };
async function capture(run: () => Promise<unknown>, answer: unknown = { items: [], next_cursor: null, invite: ONE_TIME, reset: ONE_TIME }): Promise<Sent> {
  const sent: Sent[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    sent.push({ method: (init?.method ?? "GET").toLowerCase(), path: url.pathname, query: [...url.searchParams.keys()], headers: (init?.headers ?? {}) as Record<string, string>, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  await run();
  assert.equal(sent.length, 1, "一次调用只发一个请求");
  return sent[0] as Sent;
}
/** 在 openapi.yaml 里找到和这个请求对得上的接口（路径里的 {id} 对任何一段）。 */
function operationFor(sent: Sent): { template: string; operation: Operation } {
  for (const [template, methods] of Object.entries(spec.paths)) {
    const pattern = new RegExp(`^${template.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "[^/]+")}$`);
    const operation = methods[sent.method];
    if (pattern.test(sent.path) && operation) return { template, operation };
  }
  throw new Error(`openapi.yaml 里没有 ${sent.method.toUpperCase()} ${sent.path}`);
}

const ID = "7b1c2d3e-aaaa-4bbb-8ccc-ddddeeeeffff";
const CALLS: readonly { name: string; run: () => Promise<unknown>; template: string; method: string; errors?: Record<string, RegExp>; issuesToken?: boolean }[] = [
  { name: "供应商列表", run: () => listAllTenants("t"), template: "/platform/v1/tenants", method: "get" },
  { name: "供应商详情", run: () => getTenant("t", ID), template: "/platform/v1/tenants/{id}", method: "get", errors: { "404": /NOT_FOUND/ } },
  { name: "新建供应商", run: () => createTenant("t", { name: "车队", admin: { email: "a@example.com", name: "甲" } }), template: "/platform/v1/tenants", method: "post", errors: { "409": /EMAIL_TAKEN/ }, issuesToken: true },
  { name: "暂停", run: () => suspendTenant("t", ID, "原因"), template: "/platform/v1/tenants/{id}/suspend", method: "post", errors: { "404": /NOT_FOUND/ } },
  { name: "恢复", run: () => resumeTenant("t", ID), template: "/platform/v1/tenants/{id}/resume", method: "post", errors: { "404": /NOT_FOUND/ } },
  { name: "邀请管理员", run: () => inviteTenantAdmin("t", ID, { email: "a@example.com", name: "甲" }), template: "/platform/v1/tenants/{id}/admin-invites", method: "post", errors: { "404": /NOT_FOUND/, "409": /EMAIL_TAKEN/ }, issuesToken: true },
  { name: "给管理员发密码重置", run: () => issueTenantAdminReset("t", ID, "a@example.com"), template: "/platform/v1/tenants/{id}/admin-password-resets", method: "post", errors: { "404": /NOT_FOUND/, "409": /ACCOUNT_NOT_ACTIVE/ }, issuesToken: true },
  { name: "员工列表", run: () => listAllStaff("t"), template: "/platform/v1/staff", method: "get" },
  { name: "新增员工", run: () => createStaff("t", { email: "a@example.com", name: "甲", role: "readonly" }), template: "/platform/v1/staff", method: "post", errors: { "409": /EMAIL_TAKEN/ }, issuesToken: true },
  { name: "停用员工", run: () => setStaffEnabled("t", ID, "disable"), template: "/platform/v1/staff/{id}/disable", method: "post", errors: { "404": /NOT_FOUND/, "409": /LAST_ADMIN_REQUIRED/ } },
  { name: "启用员工", run: () => setStaffEnabled("t", ID, "enable"), template: "/platform/v1/staff/{id}/enable", method: "post", errors: { "404": /NOT_FOUND/, "409": /ACCOUNT_NOT_ACTIVATED/ } },
  { name: "给员工发密码重置", run: () => issueStaffReset("t", ID), template: "/platform/v1/staff/{id}/password-reset", method: "post", errors: { "404": /NOT_FOUND/, "409": /ACCOUNT_NOT_ACTIVE/ }, issuesToken: true },
  { name: "审计日志", run: () => listAuditLogs("t", { actor_id: ID, tenant_id: ID, resource: "tenant", resource_id: ID, action: "suspend", from: "2026-10-01T00:00:00.000Z", to: "2026-10-02T00:00:00.000Z", limit: 50, cursor: "c" }), template: "/platform/v1/audit-logs", method: "get" },
  { name: "系统状态", run: () => listIntegrations("t"), template: "/platform/v1/integrations", method: "get" },
  { name: "首页数量", run: () => fetchDashboardSummary("t"), template: "/platform/v1/dashboard/summary", method: "get" },
];

for (const call of CALLS) {
  test(`对账「${call.name}」：客户端发出的方法、路径、查询参数、请求体都在 openapi.yaml 里；只带登录令牌；页面处理的错误码写在这个接口上`, async () => {
    const sent = await capture(call.run);
    const { template, operation } = operationFor(sent);
    assert.deepEqual([sent.method, template], [call.method, call.template]);
    assert.deepEqual(operation.security, [{ platformToken: [] }], "运营后台的接口都要平台员工的令牌");
    assert.equal(sent.headers["authorization"], "Bearer t");
    assert.deepEqual(Object.keys(sent.headers).filter((name) => !["accept", "authorization", "content-type"].includes(name.toLowerCase())), [], "不带别的请求头（没有幂等键）");
    const declared = (operation.parameters ?? []).map(parameter);
    for (const key of sent.query) assert.ok(declared.some((entry) => entry.in === "query" && entry.name === key), `查询参数 ${key} 不在 openapi.yaml 里`);
    const schema = deref(operation.requestBody?.content?.["application/json"]?.schema);
    if (sent.body === undefined) {
      assert.ok(operation.requestBody === undefined || operation.requestBody.required !== true, "接口要求请求体，客户端没有带");
    } else {
      assert.ok(schema, "客户端带了请求体，接口没有声明");
      const check = (value: unknown, shape: Schema | undefined, at: string): void => {
        const resolved = deref(shape);
        if (typeof value !== "object" || value === null) return;
        assert.equal(resolved?.additionalProperties, false, `${at} 应当不接受多余的字段`);
        for (const key of Object.keys(value)) assert.ok(resolved?.properties?.[key], `请求体里的 ${at}${key} 不在 openapi.yaml 里`);
        for (const key of resolved?.required ?? []) assert.ok(key in value, `请求体缺少必填的 ${at}${key}`);
        for (const [key, inner] of Object.entries(value)) check(inner, resolved?.properties?.[key], `${at}${key}.`);
      };
      check(sent.body, schema, "");
    }
    for (const [status, code] of Object.entries(call.errors ?? {})) assert.match(responseText(operation, status), code, `${call.name} 的 ${status} 应当写明 ${code}`);
    if (call.issuesToken) {
      assert.ok(!declared.some((entry) => entry.in === "header" && /idempotency/i.test(entry.name ?? "")), "这个发令牌的接口还没有幂等键：页面不能自动重试。接口加了以后这条会失败，提醒把页面改过去");
      assert.match(operation.description ?? "", /令牌只在这一次响应里出现/);
      assert.ok(operation.responses["201"], "发令牌的接口成功是 201");
    }
  });
}

test("页面的长度上限和接口一致：供应商名称、姓名 100，暂停原因 500，邮箱 254；一次取 200 条不超过接口的上限；审计日志的每页条数也不超过", () => {
  const create = deref(spec.paths["/platform/v1/tenants"]?.["post"]?.requestBody?.content?.["application/json"]?.schema);
  assert.deepEqual([create?.properties?.["name"]?.minLength, create?.properties?.["name"]?.maxLength], [1, NAME_MAX]);
  assert.deepEqual([spec.components.schemas["PersonName"]?.minLength, spec.components.schemas["PersonName"]?.maxLength], [1, NAME_MAX]);
  const suspend = deref(spec.paths["/platform/v1/tenants/{id}/suspend"]?.["post"]?.requestBody?.content?.["application/json"]?.schema);
  assert.equal(suspend?.properties?.["reason"]?.maxLength, REASON_MAX);
  assert.ok(!(suspend?.required ?? []).includes("reason"), "接口的原因还是可选的：页面自己要求必填。接口改成必填以后这条会失败，提醒核对");
  const emailMax = spec.components.schemas["Email"]?.maxLength as number;
  assert.equal(emailMax, 254);
  assert.equal(emailProblem(`${"a".repeat(emailMax - 12)}@example.com`), null, "正好 254 个字符可以");
  assert.equal(emailProblem(`${"a".repeat(emailMax - 11)}@example.com`), "这不是一个邮箱地址", "255 个字符页面就拦下");
  const limit = spec.components.parameters["Limit"]?.schema?.maximum as number;
  assert.ok(PAGE_LIMIT <= limit, `一次取 ${PAGE_LIMIT} 条，接口最多 ${limit}`);
  assert.ok(100 <= limit, "审计日志每页最多选 100 条");
});

test("一次性令牌和首页数量的形状：令牌是字符串、有效期是时间；首页的供应商数量有正常和已暂停两个数", () => {
  for (const name of ["Invite", "ResetToken"]) {
    const schema = spec.components.schemas[name];
    assert.deepEqual([schema?.properties?.["token"]?.type, schema?.properties?.["expires_at"]?.type, schema?.properties?.["expires_at"]?.format], ["string", "string", "date-time"], name);
    assert.equal(schema?.additionalProperties, false);
  }
  const tenants = spec.components.schemas["DashboardSummary"]?.properties?.["tenants"];
  assert.deepEqual(tenants?.type, ["object", "null"]);
  for (const key of ["active", "suspended"]) assert.ok((tenants?.required ?? []).includes(key), `首页卡片用的 ${key}`);
  const audit = (spec.paths["/platform/v1/audit-logs"]?.["get"]?.parameters ?? []).map(parameter);
  const formatOf = (name: string): string | undefined => audit.find((entry) => entry.name === name)?.schema?.format;
  assert.deepEqual([formatOf("actor_id"), formatOf("tenant_id"), formatOf("from"), formatOf("to")], ["uuid", "uuid", "date-time", "date-time"], "页面把这四个条件核对成编号 / 带时区的时刻以后才发");
});
