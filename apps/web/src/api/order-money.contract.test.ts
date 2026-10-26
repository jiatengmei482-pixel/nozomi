/** 取消、改单、事后加收、取消政策的手写类型与 `apps/api/openapi.yaml` 对账（M3-03）：后端改了路径、字段、枚举，这里会失败。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { EXTRA_CHARGE_STATUSES, EXTRA_CHARGE_TYPES, ORDER_CANCEL_REASONS, ORDER_CHANGE_STATUSES, REFUND_STATUSES, VEHICLE_LEVELS } from "@nozomi/domain";
import { ORDER_MONEY_SCHEMA_FIELDS, PLATFORM_ORDERS_PATH, PLATFORM_POLICY_PATH, TENANT_POLICY_PATH } from "./order-money.ts";
import { ORDERS_PATH } from "./dispatch.ts";

interface Schema {
  type?: string | string[];
  enum?: (string | null)[];
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  oneOf?: Schema[];
}
const spec = parse(await readFile(new URL("../../../api/openapi.yaml", import.meta.url), "utf8")) as { paths: Record<string, Record<string, unknown>>; components: { schemas: Record<string, Schema> } };
const schemas = spec.components.schemas;
const sorted = (values: readonly string[]): string[] => [...values].sort();

test("前端用到的取消、改单、加收、取消政策接口都在 openapi.yaml 里", () => {
  const expected: [string, string][] = [
    ["get", TENANT_POLICY_PATH],
    ["get", PLATFORM_POLICY_PATH],
    ["post", `${PLATFORM_POLICY_PATH}/changes`],
    ["post", `${ORDERS_PATH}/{id}/files`],
    ["post", `${ORDERS_PATH}/{id}/extra-charges`],
    ["post", `${ORDERS_PATH}/{id}/extra-charges/{chargeId}/withdraw`],
    ["post", `${ORDERS_PATH}/{id}/changes/{changeId}/confirm`],
    ["post", `${ORDERS_PATH}/{id}/changes/{changeId}/reject`],
    ["get", PLATFORM_ORDERS_PATH],
    ["get", `${PLATFORM_ORDERS_PATH}/{id}`],
    ["patch", `${PLATFORM_ORDERS_PATH}/{id}`],
    ["get", `${PLATFORM_ORDERS_PATH}/{id}/cancel-fee`],
    ["post", `${PLATFORM_ORDERS_PATH}/{id}/cancel`],
    ["post", `${PLATFORM_ORDERS_PATH}/{id}/extra-charges/{chargeId}/decide`],
    ["post", `${PLATFORM_ORDERS_PATH}/{id}/extra-charges/{chargeId}/retry`],
    ["post", `${PLATFORM_ORDERS_PATH}/{id}/refunds/{refundId}/retry`],
  ];
  for (const [method, path] of expected) assert.ok(spec.paths[path]?.[method], `${method.toUpperCase()} ${path}`);
});

test("应答的字段与 openapi.yaml 一致，且都是必有的", () => {
  for (const [name, fields] of Object.entries(ORDER_MONEY_SCHEMA_FIELDS)) {
    const schema = schemas[name];
    assert.deepEqual(sorted(Object.keys(schema?.properties ?? {})), sorted(fields), name);
    assert.deepEqual(sorted(schema?.required ?? []), sorted(fields), `${name} 的必填字段`);
  }
  for (const field of ["cancel_policy", "cancellation"]) {
    assert.ok(schemas["TenantOrder"]?.required?.includes(field), `TenantOrder 缺 ${field}`);
    assert.ok(schemas["PlatformOrder"]?.required?.includes(field), `PlatformOrder 缺 ${field}`);
  }
});

test("枚举与 @nozomi/domain 一致：取消原因、改单状态、加收的类型和状态、退款状态、车型级别", () => {
  assert.deepEqual(schemas["OrderCancelReason"]?.enum, [...ORDER_CANCEL_REASONS]);
  assert.deepEqual(schemas["OrderChangeStatus"]?.enum, [...ORDER_CHANGE_STATUSES]);
  assert.deepEqual(schemas["ExtraChargeType"]?.enum, [...EXTRA_CHARGE_TYPES]);
  assert.deepEqual(schemas["ExtraChargeStatus"]?.enum, [...EXTRA_CHARGE_STATUSES]);
  assert.deepEqual(schemas["OrderRefund"]?.properties?.["status"]?.enum, [...REFUND_STATUSES]);
  assert.deepEqual(schemas["VehicleLevel"]?.enum, [...VEHICLE_LEVELS]);
});

test("规则 4：供应商看到的改单、加收、取消结果里没有对外价、客人付的金额", () => {
  const keys = new Set<string>();
  const walk = (schema: Schema | undefined): void => {
    if (schema === undefined) return;
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      keys.add(key);
      walk(child);
    }
    walk(schema.items);
    for (const option of schema.oneOf ?? []) walk(option);
  };
  for (const name of ["OrderChange", "ExtraCharge", "TenantCancellation", "OrderCancelPolicy"]) walk(schemas[name]);
  assert.ok(keys.has("settlement_after") && keys.has("tenant_share"));
  assert.deepEqual([...keys].filter((key) => /sell|customer|refund|markup|price/i.test(key)), []);
});
