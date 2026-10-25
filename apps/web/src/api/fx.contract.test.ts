/** 汇率接口的手写类型与 `apps/api/openapi.yaml` 对账：后端改了路径、字段、枚举、错误码，这里会失败。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { FX_CURRENCIES, FX_FETCH_STATUSES } from "@nozomi/domain";
import { FX_BASE, FX_ERROR_CODES, FX_SCHEMA_FIELDS } from "./fx.ts";

interface Schema {
  type?: string | string[];
  enum?: (string | null)[];
  required?: string[];
  properties?: Record<string, Schema>;
}
const spec = parse(await readFile(new URL("../../../api/openapi.yaml", import.meta.url), "utf8")) as { paths: Record<string, Record<string, unknown>>; components: { schemas: Record<string, Schema> } };
const schemas = spec.components.schemas;

test("前端用到的汇率接口都在 openapi.yaml 里", () => {
  const expected: [string, string][] = [
    ["get", FX_BASE],
    ["get", `${FX_BASE}/history`],
    ["get", `${FX_BASE}/fetches`],
    ["post", `${FX_BASE}/fetch`],
    ["post", `${FX_BASE}/fetches/{id}/confirm`],
    ["post", `${FX_BASE}/fetches/{id}/dismiss`],
    ["get", `${FX_BASE}/locks`],
    ["post", `${FX_BASE}/locks`],
    ["post", `${FX_BASE}/locks/{id}/release`],
  ];
  for (const [method, path] of expected) assert.ok(spec.paths[path]?.[method], `${method.toUpperCase()} ${path}`);
});

test("手写类型的字段与 openapi.yaml 的同名 schema 完全一致，且都是必有的", () => {
  for (const [name, fields] of Object.entries(FX_SCHEMA_FIELDS)) {
    const schema = schemas[name];
    assert.deepEqual(Object.keys(schema?.properties ?? {}).sort(), [...fields].sort(), name);
    assert.deepEqual([...(schema?.required ?? [])].sort(), [...fields].sort(), `${name} 的必填字段`);
  }
});

test("枚举与 @nozomi/domain 一致：币种、拉取结果、汇率状态", () => {
  assert.deepEqual(schemas["FxCurrency"]?.enum, [...FX_CURRENCIES]);
  assert.deepEqual(schemas["FxFetch"]?.properties?.["status"]?.enum, [...FX_FETCH_STATUSES]);
  assert.deepEqual(schemas["FxTableState"]?.enum, ["none", "fresh", "stale"]);
  assert.deepEqual(schemas["FxLock"]?.properties?.["status"]?.enum, ["active", "released", "replaced", "expired"]);
});

test("前端按错误码处理的汇率错误都写在 openapi.yaml 里", () => {
  const text = JSON.stringify(spec.paths);
  for (const code of FX_ERROR_CODES) assert.ok(text.includes(code), code);
});
