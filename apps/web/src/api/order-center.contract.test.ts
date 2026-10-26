/** 订单中心（异常、工单、赔付表）和财务结算的手写类型与 `apps/api/openapi.yaml` 对账（M4-03）：后端改了路径、字段、枚举，这里会失败。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { COMPENSATION_SCENARIOS, EXCEPTION_TYPES, PAYOUT_BATCH_STATUSES, STATEMENT_LINE_KINDS, STATEMENT_STATUSES, TICKET_PRIORITIES, TICKET_STATUSES, TICKET_TYPES } from "@nozomi/domain";
import { BILLING_SCHEMA_FIELDS, PAYOUT_BATCHES_PATH, PLATFORM_STATEMENTS_PATH, TENANT_STATEMENTS_PATH } from "./billing.ts";
import { COLLEAGUES_PATH, COMPENSATION_TABLE_PATH, EXCEPTIONS_PATH, ORDER_CENTER_SCHEMA_FIELDS, PLATFORM_TICKETS_PATH, TENANT_TICKETS_PATH, TICKET_DETAIL_FIELDS } from "./order-center.ts";
import { PLATFORM_ORDERS_PATH } from "./order-money.ts";

interface Schema {
  type?: string | string[];
  enum?: (string | null)[];
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  oneOf?: Schema[];
  $ref?: string;
}
interface Operation {
  parameters?: { name?: string; $ref?: string }[];
  responses?: Record<string, { content?: { "application/json"?: { schema?: Schema } }; $ref?: string }>;
}
const spec = parse(await readFile(new URL("../../../api/openapi.yaml", import.meta.url), "utf8")) as { paths: Record<string, Record<string, Operation>>; components: { schemas: Record<string, Schema>; responses: Record<string, { content: { "application/json": { schema: Schema } } }> } };
const schemas = spec.components.schemas;
const sorted = (values: readonly string[]): string[] => [...values].sort();

test("前端用到的订单中心、财务结算接口都在 openapi.yaml 里", () => {
  const expected: [string, string][] = [
    ["get", COLLEAGUES_PATH],
    ["get", EXCEPTIONS_PATH],
    ["get", `${EXCEPTIONS_PATH}/{id}`],
    ["post", `${EXCEPTIONS_PATH}/{id}/claim`],
    ["post", `${EXCEPTIONS_PATH}/{id}/close`],
    ["get", COMPENSATION_TABLE_PATH],
    ["post", `${COMPENSATION_TABLE_PATH}/changes`],
    ["get", PLATFORM_TICKETS_PATH],
    ["post", PLATFORM_TICKETS_PATH],
    ["get", `${PLATFORM_TICKETS_PATH}/{id}`],
    ...(["assign", "messages", "request-reply", "compensation-quote", "decide", "close", "payout"].map((action) => ["post", `${PLATFORM_TICKETS_PATH}/{id}/${action}`]) as [string, string][]),
    ["get", TENANT_TICKETS_PATH],
    ["post", TENANT_TICKETS_PATH],
    ["get", `${TENANT_TICKETS_PATH}/{id}`],
    ["post", `${TENANT_TICKETS_PATH}/{id}/messages`],
    ["get", PLATFORM_STATEMENTS_PATH],
    ["post", `${PLATFORM_STATEMENTS_PATH}/generate`],
    ["get", `${PLATFORM_STATEMENTS_PATH}/{id}`],
    ["post", `${PLATFORM_STATEMENTS_PATH}/{id}/reply`],
    ["post", `${PLATFORM_STATEMENTS_PATH}/{id}/void`],
    ["post", `${PLATFORM_STATEMENTS_PATH}/{id}/payout-approval`],
    ["get", PAYOUT_BATCHES_PATH],
    ["get", `${PAYOUT_BATCHES_PATH}/{id}`],
    ["post", `${PAYOUT_BATCHES_PATH}/{id}/close`],
    ["get", TENANT_STATEMENTS_PATH],
    ["get", `${TENANT_STATEMENTS_PATH}/{id}`],
    ["post", `${TENANT_STATEMENTS_PATH}/{id}/confirm`],
    ["post", `${TENANT_STATEMENTS_PATH}/{id}/dispute`],
  ];
  for (const [method, path] of expected) assert.ok(spec.paths[path]?.[method], `${method.toUpperCase()} ${path}`);
});

test("订单列表的筛选参数（M4-02）都在接口里", () => {
  const names = (spec.paths[PLATFORM_ORDERS_PATH]?.["get"]?.parameters ?? []).map((parameter) => parameter.name).filter(Boolean);
  for (const name of ["status", "q", "service_from", "service_to", "created_from", "created_to", "city_id", "category", "exception", "passenger"]) assert.ok(names.includes(name), name);
  assert.ok(schemas["PlatformOrder"]?.properties?.["open_exceptions"], "订单列表每一行有没关的异常数");
});

test("应答的字段与 openapi.yaml 一致，且都是必有的", () => {
  for (const [name, fields] of Object.entries({ ...ORDER_CENTER_SCHEMA_FIELDS, ...BILLING_SCHEMA_FIELDS })) {
    const schema = schemas[name];
    assert.deepEqual(sorted(Object.keys(schema?.properties ?? {})), sorted(fields), name);
    assert.deepEqual(sorted(schema?.required ?? []), sorted(fields), `${name} 的必填字段`);
  }
  for (const [name, fields] of Object.entries(TICKET_DETAIL_FIELDS)) {
    const schema = spec.components.responses[name]?.content["application/json"].schema;
    assert.deepEqual(sorted(Object.keys(schema?.properties ?? {})), sorted(fields), name);
  }
});

test("枚举与 @nozomi/domain 一致：异常类型、工单类型、状态、优先级、赔付情形、账单状态和明细种类、付款批次状态", () => {
  assert.deepEqual(schemas["ExceptionType"]?.enum, [...EXCEPTION_TYPES]);
  assert.deepEqual(schemas["TicketType"]?.enum, [...TICKET_TYPES]);
  assert.deepEqual(schemas["TicketStatus"]?.enum, [...TICKET_STATUSES]);
  assert.deepEqual(schemas["TicketPriority"]?.enum, [...TICKET_PRIORITIES]);
  assert.deepEqual(schemas["CompensationScenario"]?.enum, [...COMPENSATION_SCENARIOS]);
  assert.deepEqual(schemas["StatementStatus"]?.enum, [...STATEMENT_STATUSES]);
  assert.deepEqual(schemas["StatementLineKind"]?.enum, [...STATEMENT_LINE_KINDS]);
  assert.deepEqual(schemas["PayoutBatch"]?.properties?.["status"]?.enum, [...PAYOUT_BATCH_STATUSES]);
  assert.deepEqual(schemas["OrderRefund"]?.properties?.["purpose"]?.enum, ["cancellation", "change", "compensation"]);
});

test("规则 4：供应商看到的工单、账单里没有对外价、加价比例、客人的赔付金额、内部备注、平台员工编号", () => {
  const keys = new Set<string>();
  const walk = (schema: Schema | undefined): void => {
    if (schema === undefined) return;
    if (schema.$ref !== undefined) return walk(schemas[schema.$ref.replace("#/components/schemas/", "")]);
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      keys.add(key);
      walk(child);
    }
    walk(schema.items);
    for (const option of schema.oneOf ?? []) walk(option);
  };
  walk(spec.components.responses["TenantTicketDetail"]?.content["application/json"].schema);
  for (const name of ["TenantStatement", "TenantStatementDetail", "TenantStatementEvent"]) walk(schemas[name]);
  assert.ok(keys.has("deductions") && keys.has("lines"));
  assert.deepEqual([...keys].filter((key) => /sell|markup|customer|refund|manual_payout|notes|assignee|decided_by|actor_id|compensation$/.test(key)), []);
});
