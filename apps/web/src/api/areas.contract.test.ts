/** 区域、地图配置、供应商首页数量的手写类型与 `apps/api/openapi.yaml` 对账。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { AREA_BIZ_TYPES, AREA_POLYGON_KINDS, AREA_POLYGON_SOURCES } from "@nozomi/domain";
import { AREAS_PATH, AREA_ERROR_CODES, AREA_LIST_QUERY_KEYS, AREA_SCHEMA_FIELDS, AREA_WRITE_FIELDS, MAP_TILE_FIELDS, TENANT_BASE } from "./areas.ts";

interface Schema {
  $ref?: string;
  type?: string | string[];
  enum?: string[];
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
  requestBody?: { content?: { "application/json"?: { schema?: Schema } } };
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
const params = (operation: Operation): string[] =>
  (operation.parameters ?? []).map((parameter) => {
    const resolved = parameter.$ref ? spec.components.parameters[parameter.$ref.replace("#/components/parameters/", "")] : parameter;
    return `${resolved?.in}:${resolved?.name}`;
  });

test("区域的八个接口：路径、方法、请求体和应答的 schema", () => {
  const list = response(op("get", AREAS_PATH), "200");
  assert.deepEqual([...(list?.required ?? [])].sort(), ["items", "next_cursor", "total"]);
  assert.equal(ref(list?.properties?.["items"]?.items), "AreaSummary");
  const create = op("post", AREAS_PATH);
  assert.equal(ref(create.requestBody?.content?.["application/json"]?.schema), "AreaCreate");
  assert.equal(ref(response(create, "201")), "Area");
  assert.ok(params(create).includes("header:Idempotency-Key"), "新增要带 Idempotency-Key");
  assert.equal(ref(response(op("get", `${AREAS_PATH}/{id}`), "200")), "Area");
  const update = op("put", `${AREAS_PATH}/{id}`);
  assert.equal(ref(update.requestBody?.content?.["application/json"]?.schema), "AreaUpdate");
  assert.equal(ref(response(update, "200")), "Area");
  assert.ok(params(update).includes("header:If-Match"), "修改要带 If-Match");
  assert.ok(op("delete", `${AREAS_PATH}/{id}`).responses["204"]);
  assert.equal(ref(response(op("post", `${AREAS_PATH}/{id}/disable`), "200")), "Area");
  assert.equal(ref(response(op("post", `${AREAS_PATH}/{id}/enable`), "200")), "Area");
  const check = op("post", `${AREAS_PATH}/{id}/check-point`);
  assert.deepEqual(check.requestBody?.content?.["application/json"]?.schema?.required, ["lat", "lng"]);
  assert.equal(ref(response(check, "200")), "AreaPointCheck");
});

test("列表的查询参数名接口都认；选城市和参考点用的主数据接口在", () => {
  const accepted = params(op("get", AREAS_PATH));
  for (const key of AREA_LIST_QUERY_KEYS) assert.ok(accepted.includes(`query:${key}`), `区域列表没有查询参数 ${key}`);
  assert.ok(params(op("get", `${TENANT_BASE}/master/cities`)).includes("query:status"));
  const places = params(op("get", `${TENANT_BASE}/master/places`));
  for (const key of ["city_id", "type"]) assert.ok(places.includes(`query:${key}`));
});

test("手写类型的字段与同名 schema 完全一致", () => {
  for (const [name, fields] of Object.entries(AREA_SCHEMA_FIELDS)) {
    const schema = schemas[name];
    assert.ok(schema, `openapi.yaml 里没有 schema ${name}`);
    assert.deepEqual(Object.keys(schema.properties ?? {}).sort(), [...fields].sort(), `${name} 的字段不一致`);
    assert.deepEqual([...(schema.required ?? [])].sort(), [...fields].sort(), `${name} 的必有字段不一致`);
  }
  for (const [name, fields] of Object.entries(AREA_WRITE_FIELDS)) {
    const schema = schemas[name];
    assert.ok(schema, `openapi.yaml 里没有 schema ${name}`);
    const known = Object.keys(schema.properties ?? {});
    for (const field of fields) assert.ok(known.includes(field), `${name} 里没有字段 ${field}`);
    for (const required of schema.required ?? []) assert.ok((fields as readonly string[]).includes(required), `${name} 要求 ${required}，前端没有提交`);
  }
});

test("枚举值与 @nozomi/domain 一致；圆的半径是整数米", () => {
  assert.deepEqual(schemas["AreaBizType"]?.enum, [...AREA_BIZ_TYPES]);
  assert.deepEqual(schemas["AreaPolygonKind"]?.enum, [...AREA_POLYGON_KINDS]);
  assert.deepEqual(schemas["AreaPolygonSource"]?.enum, [...AREA_POLYGON_SOURCES]);
  assert.deepEqual(schemas["AreaPointCheck"]?.properties?.["result"]?.enum, ["operate", "forbid", "outside"]);
  assert.equal(schemas["AreaCircle"]?.properties?.["radius_m"]?.type, "integer");
});

test("地图底图配置和首页数量", () => {
  const config = schemas[ref(response(op("get", `${TENANT_BASE}/map/config`), "200")) ?? ""];
  const tiles = config?.properties?.["tiles"];
  assert.deepEqual(tiles?.type, ["object", "null"], "没有配置底图时是 null");
  assert.deepEqual(Object.keys(tiles?.properties ?? {}).sort(), [...MAP_TILE_FIELDS].sort());
  assert.deepEqual(tiles?.properties?.["attribution"]?.items?.required, ["text", "href"]);
  const summary = schemas[ref(response(op("get", `${TENANT_BASE}/dashboard/summary`), "200")) ?? ""];
  assert.deepEqual(Object.keys(summary?.properties ?? {}), ["areas"]);
  assert.deepEqual(summary?.properties?.["areas"]?.required, ["active", "disabled"]);
});

test("前端按代码处理的区域错误和原因都写在 openapi.yaml 里", () => {
  for (const code of [...AREA_ERROR_CODES, "NO_OPERATE_POLYGON", "SELF_INTERSECTION", "DUPLICATE_POINT", "COLLINEAR", "CROSSES_ANTIMERIDIAN", "TOO_FEW_POINTS", "RADIUS_OUT_OF_RANGE", "INVALID_COORDINATE", "TOO_MANY_TOTAL_VERTICES"]) {
    assert.ok(text.includes(`\`${code}\``), `openapi.yaml 里找不到 ${code}`);
  }
});
