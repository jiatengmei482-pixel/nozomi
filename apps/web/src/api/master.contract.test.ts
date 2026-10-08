/** 主数据与首页统计的手写类型与 `apps/api/openapi.yaml` 对账：后端改了路径、字段、枚举、参数名，这里会失败。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import {
  ADDON_CHARGE_UNITS,
  FLIGHT_SCOPES,
  MASTER_DATA_LANGUAGES,
  MASTER_DATA_STATUSES,
  PLACE_CATEGORIES,
  PLACE_TYPES,
  SERVICE_CATEGORIES,
  VEHICLE_GRADES,
  VEHICLE_POWERS,
} from "@nozomi/domain";
import { DASHBOARD_SUMMARY_PATH, MASTER_BASE, MASTER_ERROR_CODES, MASTER_KINDS, MASTER_LIST_QUERY_KEYS, MASTER_SCHEMA_FIELDS, MASTER_WRITE_FIELDS } from "./master.ts";

interface Schema {
  $ref?: string;
  type?: string | string[];
  enum?: string[];
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  oneOf?: Schema[];
  anyOf?: Schema[];
  allOf?: Schema[];
}
interface Parameter {
  $ref?: string;
  name?: string;
  in?: string;
}
interface Operation {
  parameters?: Parameter[];
  requestBody?: { content?: { "application/json"?: { schema?: Schema } } };
  responses: Record<string, { $ref?: string; content?: { "application/json"?: { schema?: Schema } } }>;
}
interface OpenApi {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema>; parameters: Record<string, Parameter> };
}

const text = await readFile(new URL("../../../api/openapi.yaml", import.meta.url), "utf8");
const spec = parse(text) as OpenApi;
const schemas = spec.components.schemas;
const ref = (schema: Schema | undefined): string | undefined => schema?.$ref?.replace("#/components/schemas/", "");
const SCHEMA_OF = { cities: "City", places: "Place", "vehicle-groups": "VehicleGroup", addons: "Addon" } as const;

function op(method: string, path: string): Operation {
  const found = spec.paths[path]?.[method];
  assert.ok(found, `openapi.yaml 里没有 ${method.toUpperCase()} ${path}`);
  return found;
}
const body = (operation: Operation, status: string): Schema | undefined => operation.responses[status]?.content?.["application/json"]?.schema;
const paramNames = (operation: Operation): string[] =>
  (operation.parameters ?? []).map((parameter) => {
    const resolved = parameter.$ref ? spec.components.parameters[parameter.$ref.replace("#/components/parameters/", "")] : parameter;
    return `${resolved?.in}:${resolved?.name}`;
  });

test("四类主数据的六个接口都在 openapi.yaml 里，应答就是前端以为的那个 schema", () => {
  for (const kind of MASTER_KINDS) {
    const base = `${MASTER_BASE}/${kind}`;
    const name = SCHEMA_OF[kind];
    const list = body(op("get", base), "200");
    assert.deepEqual([...(list?.required ?? [])].sort(), ["items", "next_cursor", "total"], `${kind} 列表的顶层字段`);
    assert.equal(ref(list?.properties?.["items"]?.items), name);
    assert.equal(ref(body(op("post", base), "201")), name);
    assert.equal(ref(body(op("get", `${base}/{id}`), "200")), name);
    const patch = op("patch", `${base}/{id}`);
    assert.equal(ref(body(patch, "200")), name);
    assert.ok(paramNames(patch).includes("header:If-Match"), `${kind} 修改要带 If-Match`);
    assert.equal(ref(patch.requestBody?.content?.["application/json"]?.schema), `${name}Patch`);
    assert.equal(ref(op("post", base).requestBody?.content?.["application/json"]?.schema), `${name}Create`);
    assert.equal(ref(body(op("post", `${base}/{id}/disable`), "200")), name);
    assert.equal(ref(body(op("post", `${base}/{id}/enable`), "200")), name);
  }
});

test("列表接口的查询参数名：前端用到的每一个，接口都认", () => {
  const accepted = new Set(MASTER_KINDS.flatMap((kind) => paramNames(op("get", `${MASTER_BASE}/${kind}`))));
  for (const key of MASTER_LIST_QUERY_KEYS) assert.ok(accepted.has(`query:${key}`), `列表接口没有查询参数 ${key}`);
  const places = paramNames(op("get", `${MASTER_BASE}/places`));
  for (const key of ["type", "city_id", "parent_id", "country_code", "status", "q"]) assert.ok(places.includes(`query:${key}`), `地点列表没有 ${key}`);
  assert.ok(paramNames(op("get", `${MASTER_BASE}/vehicle-groups`)).includes("query:grade"));
  assert.ok(paramNames(op("get", `${MASTER_BASE}/cities`)).includes("query:country_code"));
  assert.ok(text.includes("`none` 表示只看还没有所属城市的地点"), "city_id=none 的约定变了");
});

test("待指定城市的地点列表带城市建议：顶层可选字段 city_suggestions，每项指向 PlaceCitySuggestion", () => {
  const list = body(op("get", `${MASTER_BASE}/places`), "200");
  assert.equal(ref(list?.properties?.["city_suggestions"]?.items), "PlaceCitySuggestion");
  assert.equal((list?.required ?? []).includes("city_suggestions"), false, "只在 city_id=none 时才有，前端按可选处理");
  const suggestion = schemas["PlaceCitySuggestion"];
  assert.equal(ref(suggestion?.properties?.["nearby_cities"]?.items), "CitySuggestion");
  assert.ok((suggestion?.properties?.["suggested_city"]?.oneOf ?? []).some((option) => ref(option) === "CitySuggestion"));
  assert.ok((suggestion?.properties?.["suggested_city"]?.oneOf ?? []).some((option) => option.type === "null"), "没有合适的城市时是 null");
  assert.equal(schemas["CitySuggestion"]?.properties?.["distance_km"]?.type, "number");
});

test("启用地点时可以带 city_id 一次完成指定城市并启用", () => {
  const request = op("post", `${MASTER_BASE}/places/{id}/enable`).requestBody?.content?.["application/json"]?.schema;
  assert.deepEqual(Object.keys(request?.properties ?? {}), ["city_id"]);
});

test("手写类型的字段与 openapi.yaml 的同名 schema 完全一致，且都是必有的", () => {
  for (const [name, fields] of Object.entries(MASTER_SCHEMA_FIELDS)) {
    const schema = schemas[name];
    assert.ok(schema, `openapi.yaml 里没有 schema ${name}`);
    assert.deepEqual(Object.keys(schema.properties ?? {}).sort(), [...fields].sort(), `${name} 的字段不一致`);
    assert.deepEqual([...(schema.required ?? [])].sort(), [...fields].sort(), `${name} 的必有字段不一致`);
  }
  const source = schemas["Place"]?.properties?.["source"];
  assert.deepEqual([...(source?.required ?? [])].sort(), ["name", "overridden", "ref", "synced_at"]);
  assert.deepEqual(source?.properties?.["name"]?.enum, ["ourairports"]);
});

test("前端提交的字段都在接口的请求体定义里；新增时接口要求的字段前端都会给", () => {
  for (const [name, fields] of Object.entries(MASTER_WRITE_FIELDS)) {
    const schema = schemas[name];
    assert.ok(schema, `openapi.yaml 里没有 schema ${name}`);
    const known = Object.keys(schema.properties ?? {});
    for (const field of fields) assert.ok(known.includes(field), `${name} 里没有字段 ${field}`);
    for (const required of schema.required ?? []) assert.ok((fields as readonly string[]).includes(required), `${name} 要求 ${required}，前端没有提交`);
  }
  assert.equal("boundary" in (schemas["CityPatch"]?.properties ?? {}), true, "城市边界仍是可选字段（前端永远不提交它）");
});

test("枚举值与 @nozomi/domain 一致", () => {
  const expected: Record<string, readonly string[]> = {
    MasterDataStatus: MASTER_DATA_STATUSES,
    PlaceType: PLACE_TYPES,
    PlaceCategory: PLACE_CATEGORIES,
    FlightScope: FLIGHT_SCOPES,
    VehicleGrade: VEHICLE_GRADES,
    VehiclePower: VEHICLE_POWERS,
    ServiceCategory: SERVICE_CATEGORIES,
    AddonChargeUnit: ADDON_CHARGE_UNITS,
  };
  for (const [name, values] of Object.entries(expected)) assert.deepEqual(schemas[name]?.enum, [...values], name);
  assert.deepEqual(Object.keys(schemas["LocalizedText"]?.properties ?? {}).sort(), [...MASTER_DATA_LANGUAGES].sort());
  assert.deepEqual(Object.keys(schemas["VehicleCombo"]?.properties ?? {}).sort(), ["luggage", "passengers"]);
});

test("首页统计：路径和各层字段", () => {
  const summary = ref(body(op("get", DASHBOARD_SUMMARY_PATH), "200")) ?? "";
  const schema = schemas[summary];
  assert.deepEqual(Object.keys(schema?.properties ?? {}).sort(), ["master_data", "tenants"]);
  const unwrap = (value: Schema | undefined): Schema | undefined => (value?.oneOf ?? value?.anyOf)?.find((candidate) => candidate.type !== "null") ?? value;
  const tenants = unwrap(schema?.properties?.["tenants"]);
  assert.deepEqual(Object.keys(tenants?.properties ?? {}).sort(), ["active", "suspended", "total"]);
  const master = unwrap(schema?.properties?.["master_data"]);
  assert.deepEqual(Object.keys(master?.properties ?? {}).sort(), ["addons", "cities", "places", "vehicle_groups"]);
  const places = master?.properties?.["places"];
  assert.deepEqual(Object.keys(places?.properties ?? {}).sort(), ["active", "airports_without_city", "by_type", "disabled", "total"]);
  assert.deepEqual(Object.keys(places?.properties?.["by_type"]?.properties ?? {}).sort(), [...PLACE_TYPES].sort());
});

test("前端按错误码处理的主数据错误都写在 openapi.yaml 里", () => {
  for (const code of [...MASTER_ERROR_CODES, "CITY_MISSING", "CITY_DISABLED", "PARENT_DISABLED"]) assert.ok(text.includes(`\`${code}\``), `openapi.yaml 里找不到 ${code}`);
  for (const detail of ["details.active_count", "details.reason", "details.current_version", "details.fields"]) assert.ok(text.includes(detail), `openapi.yaml 里找不到 ${detail}`);
});
