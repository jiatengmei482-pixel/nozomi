/** 救援改派的手写类型与 `apps/api/openapi.yaml` 对账（M3-04）：后端改了路径、字段、枚举，这里会失败。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { DEDUCTION_KINDS, DEDUCTION_STATUSES, ORDER_STATUSES, RESCUE_OFFER_STATUSES, RESCUE_STATUSES, RESCUE_TRIGGERS } from "@nozomi/domain";
import { ORDERS_PATH } from "./dispatch.ts";
import { PLATFORM_ORDERS_PATH } from "./order-money.ts";
import { PLATFORM_RESCUES_PATH, RESCUE_SCHEMA_FIELDS, TENANT_DEDUCTIONS_PATH, TENANT_RESCUE_OFFERS_PATH } from "./rescues.ts";
import { PLATFORM_BASE } from "./platform.ts";

interface Schema {
  type?: string | string[];
  enum?: (string | null)[];
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  oneOf?: Schema[];
  $ref?: string;
}
const spec = parse(await readFile(new URL("../../../api/openapi.yaml", import.meta.url), "utf8")) as { paths: Record<string, Record<string, unknown>>; components: { schemas: Record<string, Schema> } };
const schemas = spec.components.schemas;
const sorted = (values: readonly string[]): string[] => [...values].sort();

test("前端用到的救援接口都在 openapi.yaml 里", () => {
  const expected: [string, string][] = [
    ["post", `${ORDERS_PATH}/{id}/declare-unable`],
    ["get", TENANT_RESCUE_OFFERS_PATH],
    ["post", `${TENANT_RESCUE_OFFERS_PATH}/{id}/accept`],
    ["post", `${TENANT_RESCUE_OFFERS_PATH}/{id}/decline`],
    ["get", TENANT_DEDUCTIONS_PATH],
    ["get", PLATFORM_RESCUES_PATH],
    ["post", `${PLATFORM_ORDERS_PATH}/{id}/rescue`],
    ["get", `${PLATFORM_ORDERS_PATH}/{id}/rescue/candidates`],
    ["post", `${PLATFORM_ORDERS_PATH}/{id}/rescue/offers`],
    ["post", `${PLATFORM_ORDERS_PATH}/{id}/rescue/manual-assign`],
    ["post", `${PLATFORM_ORDERS_PATH}/{id}/rescue/force-majeure`],
    ["post", `${PLATFORM_BASE}/tenants/{id}/rescue`],
  ];
  for (const [method, path] of expected) assert.ok(spec.paths[path]?.[method], `${method.toUpperCase()} ${path}`);
});

test("应答的字段与 openapi.yaml 一致，且都是必有的；订单详情两边都带救援", () => {
  for (const [name, fields] of Object.entries(RESCUE_SCHEMA_FIELDS)) {
    const schema = schemas[name];
    assert.deepEqual(sorted(Object.keys(schema?.properties ?? {})), sorted(fields), name);
    assert.deepEqual(sorted(schema?.required ?? []), sorted(fields), `${name} 的必填字段`);
  }
});

test("枚举与 @nozomi/domain 一致：触发情形、救援 / 救援单 / 应扣款项的状态、订单状态（含已转给救援供应商）", () => {
  assert.deepEqual(schemas["RescueTrigger"]?.enum, [...RESCUE_TRIGGERS]);
  assert.deepEqual(schemas["RescueStatus"]?.enum, [...RESCUE_STATUSES]);
  assert.deepEqual(schemas["TenantRescueOffer"]?.properties?.["status"]?.enum, [...RESCUE_OFFER_STATUSES]);
  assert.deepEqual(schemas["TenantDeduction"]?.properties?.["kind"]?.enum, [...DEDUCTION_KINDS]);
  assert.deepEqual(schemas["TenantDeduction"]?.properties?.["status"]?.enum, [...DEDUCTION_STATUSES]);
  assert.deepEqual(schemas["OrderStatus"]?.enum, [...ORDER_STATUSES]);
});

test("规则 4：供应商看到的救援单、应扣款项、订单里的救援没有对外价、加价比例、别的供应商", () => {
  const keys = new Set<string>();
  const walk = (schema: Schema | undefined, seen = new Set<string>()): void => {
    if (schema === undefined) return;
    if (schema.$ref !== undefined) {
      const name = schema.$ref.split("/").pop() as string;
      if (seen.has(name)) return;
      seen.add(name);
      walk(schemas[name], seen);
      return;
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      keys.add(key);
      walk(child, seen);
    }
    walk(schema.items, seen);
    for (const option of schema.oneOf ?? []) walk(option, seen);
  };
  for (const name of ["TenantRescueOffer", "TenantDeduction", "TenantOrderRescue"]) walk(schemas[name]);
  assert.ok(keys.has("settlement") && keys.has("amount"));
  assert.deepEqual([...keys].filter((key) => /sell|markup|fx|channel|tenant|candidate|position/i.test(key)), []);
});
