/** 运营后台下拉框的选项接口（M4-13，ADR 0046）：手写类型、路径、查询参数与 `apps/api/openapi.yaml` 对账。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { CITY_OPTIONS_PATH, CITY_OPTION_FIELDS } from "./city-options.ts";
import { ADDON_OPTIONS_PATH, MASTER_OPTION_FIELDS, OPTION_PLACE_TYPES, PLACE_OPTIONS_PATH, VEHICLE_GROUP_OPTIONS_PATH } from "./master-options.ts";

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
  required?: boolean;
  schema?: Schema;
}
interface Operation {
  parameters?: Parameter[];
  responses: Record<string, { content?: { "application/json"?: { schema?: Schema } } }>;
}
interface OpenApi {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema>; parameters: Record<string, Parameter> };
}

const spec = parse(await readFile(new URL("../../../api/openapi.yaml", import.meta.url), "utf8")) as OpenApi;
const schemas = spec.components.schemas;
const sorted = (values: readonly string[]): string[] => [...values].sort();
function op(path: string): Operation {
  const found = spec.paths[path]?.["get"];
  assert.ok(found, `openapi.yaml 里没有 GET ${path}`);
  return found;
}
const query = (operation: Operation): Parameter[] =>
  (operation.parameters ?? []).map((parameter) => (parameter.$ref ? (spec.components.parameters[parameter.$ref.replace("#/components/parameters/", "")] as Parameter) : parameter)).filter((parameter) => parameter.in === "query");
/** 应答是 `{ items: [<schema>] }`，返回列表项的定义名 */
function itemSchema(operation: Operation): string | undefined {
  const body = operation.responses["200"]?.content?.["application/json"]?.schema;
  assert.deepEqual(body?.required, ["items"], "不分页：只有 items");
  assert.deepEqual(Object.keys(body?.properties ?? {}), ["items"]);
  return body?.properties?.["items"]?.items?.$ref?.replace("#/components/schemas/", "");
}

test("城市选项：路径、只有 include_disabled 一个查询参数（true / false）；字段一个不差，status 只在带了 include_disabled 时有", () => {
  const operation = op(CITY_OPTIONS_PATH);
  const params = query(operation);
  assert.deepEqual(params.map((parameter) => parameter.name), ["include_disabled"]);
  assert.deepEqual(params[0]?.schema?.enum, ["true", "false"]);
  const name = itemSchema(operation);
  assert.equal(name, "CityOption");
  const schema = schemas["CityOption"];
  assert.deepEqual(sorted(Object.keys(schema?.properties ?? {})), sorted([...CITY_OPTION_FIELDS.required, ...CITY_OPTION_FIELDS.optional]));
  assert.deepEqual(sorted(schema?.required ?? []), sorted(CITY_OPTION_FIELDS.required));
  assert.equal(schema?.properties?.["name"]?.$ref, "#/components/schemas/LocalizedText", "名称是多语言对象");
  assert.ok(operation.responses["400"], "查询参数不对 400");
});

test("车型组选项：路径、没有查询参数；字段一个不差", () => {
  const operation = op(VEHICLE_GROUP_OPTIONS_PATH);
  assert.deepEqual(query(operation), []);
  assert.equal(itemSchema(operation), "VehicleGroupOption");
  const schema = schemas["VehicleGroupOption"];
  assert.deepEqual(sorted(Object.keys(schema?.properties ?? {})), sorted(MASTER_OPTION_FIELDS.VehicleGroupOption));
  assert.deepEqual(sorted(schema?.required ?? []), sorted(MASTER_OPTION_FIELDS.VehicleGroupOption));
});

test("地点选项：city_id、type 都必填；能取的类型和前端一致；字段一个不差", () => {
  const operation = op(PLACE_OPTIONS_PATH);
  const params = query(operation);
  assert.deepEqual(sorted(params.map((parameter) => parameter.name ?? "")), ["city_id", "type"]);
  assert.ok(params.every((parameter) => parameter.required === true));
  assert.equal(itemSchema(operation), "PlaceOption");
  const schema = schemas["PlaceOption"];
  assert.deepEqual(sorted(Object.keys(schema?.properties ?? {})), sorted(MASTER_OPTION_FIELDS.PlaceOption));
  assert.deepEqual(sorted(schema?.required ?? []), sorted(MASTER_OPTION_FIELDS.PlaceOption));
  assert.deepEqual(schema?.properties?.["type"]?.enum, [...OPTION_PLACE_TYPES]);
});

test("附加服务选项：只有 include_disabled 一个查询参数；字段一个不差，status 只在带了 include_disabled 时有", () => {
  const operation = op(ADDON_OPTIONS_PATH);
  assert.deepEqual(query(operation).map((parameter) => parameter.name), ["include_disabled"]);
  assert.equal(itemSchema(operation), "AddonOption");
  const schema = schemas["AddonOption"];
  assert.deepEqual(sorted(Object.keys(schema?.properties ?? {})), sorted([...MASTER_OPTION_FIELDS.AddonOption, "status"]));
  assert.deepEqual(sorted(schema?.required ?? []), sorted(MASTER_OPTION_FIELDS.AddonOption));
});
