/** 派车、司机和车辆、Webhook、司机 H5 的手写类型与 `apps/api/openapi.yaml` 对账：后端改了路径、字段、枚举，这里会失败。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { DRIVER_STATUSES, ORDER_STATUSES, PLATE_TYPES, TENANT_WEBHOOK_EVENTS, VEHICLE_STATUSES } from "@nozomi/domain";
import { DISPATCH_SCHEMA_FIELDS, DRIVERS_PATH, DRIVER_TRIP_PATH, ORDERS_PATH, PLATFORM_DELIVERIES_PATH, VEHICLES_PATH, WEBHOOK_PATH } from "./dispatch.ts";

interface Schema {
  $ref?: string;
  type?: string | string[];
  enum?: (string | null)[];
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  oneOf?: Schema[];
}
const spec = parse(await readFile(new URL("../../../api/openapi.yaml", import.meta.url), "utf8")) as { paths: Record<string, Record<string, unknown>>; components: { schemas: Record<string, Schema> } };
const schemas = spec.components.schemas;
const props = (schema: Schema | undefined): string[] => Object.keys(schema?.properties ?? {}).sort();
const sorted = (values: readonly string[]): string[] => [...values].sort();

test("前端用到的派车、车队、Webhook、司机 H5 接口都在 openapi.yaml 里", () => {
  const expected: [string, string][] = [
    ["get", ORDERS_PATH],
    ["get", `${ORDERS_PATH}/{id}`],
    ["get", `${ORDERS_PATH}/{id}/assignable`],
    ["post", `${ORDERS_PATH}/{id}/assign`],
    ["post", `${ORDERS_PATH}/{id}/driver-link`],
    ["delete", `${ORDERS_PATH}/{id}/driver-link`],
    ["post", `${ORDERS_PATH}/{id}/events`],
    ["get", `${ORDERS_PATH}/{id}/files/{fileId}`],
    ["get", "/platform/v1/orders/{id}/files/{fileId}"],
    ["get", DRIVERS_PATH],
    ["post", DRIVERS_PATH],
    ["put", `${DRIVERS_PATH}/{id}`],
    ["delete", `${DRIVERS_PATH}/{id}`],
    ["get", VEHICLES_PATH],
    ["post", VEHICLES_PATH],
    ["put", `${VEHICLES_PATH}/{id}`],
    ["delete", `${VEHICLES_PATH}/{id}`],
    ["get", WEBHOOK_PATH],
    ["put", WEBHOOK_PATH],
    ["delete", WEBHOOK_PATH],
    ["post", `${WEBHOOK_PATH}/rotate-secret`],
    ["post", `${WEBHOOK_PATH}/test`],
    ["get", `${WEBHOOK_PATH}/deliveries`],
    ["post", `${WEBHOOK_PATH}/deliveries/{id}/retry`],
    ["get", PLATFORM_DELIVERIES_PATH],
    ["post", `${PLATFORM_DELIVERIES_PATH}/{id}/retry`],
    ["get", DRIVER_TRIP_PATH],
    ["post", `${DRIVER_TRIP_PATH}/events`],
    ["post", `${DRIVER_TRIP_PATH}/locations`],
    ["post", `${DRIVER_TRIP_PATH}/landing`],
    ["post", `${DRIVER_TRIP_PATH}/contacts`],
    ["post", `${DRIVER_TRIP_PATH}/request-leave`],
    ["post", `${DRIVER_TRIP_PATH}/no-show`],
    ["post", `${DRIVER_TRIP_PATH}/files`],
    ["get", `${DRIVER_TRIP_PATH}/files/{id}`],
  ];
  for (const [method, path] of expected) assert.ok(spec.paths[path]?.[method], `${method.toUpperCase()} ${path}`);
});

test("应答的字段与 openapi.yaml 一致，且都是必有的", () => {
  const pairs: [keyof typeof DISPATCH_SCHEMA_FIELDS, Schema | undefined][] = [
    ["Driver", schemas["Driver"]],
    ["Vehicle", schemas["Vehicle"]],
    ["OrderDispatch", schemas["OrderDispatch"]],
    ["OrderFulfilment", schemas["OrderFulfilment"]],
    ["OrderRecords", schemas["OrderRecords"]],
    ["OrderFile", schemas["OrderFile"]],
    ["IssuedDriverLink", schemas["IssuedDriverLink"]],
    ["TenantWebhook", schemas["TenantWebhook"]],
    ["WebhookDelivery", schemas["WebhookDelivery"]],
    ["WebhookAttempt", schemas["WebhookAttempt"]],
    ["DriverTrip", schemas["DriverTrip"]],
  ];
  for (const [name, schema] of pairs) {
    assert.deepEqual(props(schema), sorted(DISPATCH_SCHEMA_FIELDS[name]), name);
    assert.deepEqual(sorted(schema?.required ?? []), sorted(DISPATCH_SCHEMA_FIELDS[name]), `${name} 的必填字段`);
  }
  for (const field of ["dispatch", "fulfilment", "landing"]) assert.ok(schemas["TenantOrder"]?.required?.includes(field), `TenantOrder 缺 ${field}`);
});

test("枚举与 @nozomi/domain 一致：订单状态、司机和车辆的状态、牌照类型、Webhook 事件", () => {
  assert.deepEqual(schemas["OrderStatus"]?.enum, [...ORDER_STATUSES]);
  assert.deepEqual(schemas["DriverStatus"]?.enum, [...DRIVER_STATUSES]);
  assert.deepEqual(schemas["VehicleStatus"]?.enum, [...VEHICLE_STATUSES]);
  assert.deepEqual(schemas["VehicleInput"]?.properties?.["plate_type"]?.enum, [...PLATE_TYPES]);
  assert.deepEqual(schemas["TenantWebhookEvent"]?.enum, [...TENANT_WEBHOOK_EVENTS]);
});

test("规则 4：供应商看到的订单、司机页面里没有对外价、加价比例的字段", () => {
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
  for (const name of ["TenantOrder", "OrderDispatch", "OrderFulfilment", "DriverTrip"]) walk(schemas[name]);
  assert.ok(keys.has("settlement") && keys.has("dispatch"));
  assert.deepEqual([...keys].filter((key) => /markup|sell|price|fx/i.test(key)), []);
});
