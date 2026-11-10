/** 区域地图（M8-18）的手写类型与 `apps/api/openapi.yaml` 对账。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { AREA_SCHEMA_FIELDS } from "./areas.ts";
import { AREA_MAP_FIELDS, AREA_MAP_QUERY_KEYS, PLATFORM_AREA_MAP_PATH, PLATFORM_AREA_MAP_QUERY_KEYS, PLATFORM_MAP_CONFIG_PATH, TENANT_AREA_MAP_PATH } from "./area-map.ts";

interface Schema {
  $ref?: string;
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
}
interface Operation {
  parameters?: { name?: string; in?: string }[];
  responses: Record<string, { content?: { "application/json"?: { schema?: Schema } } }>;
}
const spec = parse(await readFile(new URL("../../../api/openapi.yaml", import.meta.url), "utf8")) as { paths: Record<string, Record<string, Operation>>; components: { schemas: Record<string, Schema> } };
const schemas = spec.components.schemas;
const sorted = (values: readonly string[]): string[] => [...values].sort();

test("两个区域地图接口和平台的底图配置都在定义里；查询参数和这里一致", () => {
  for (const [path, keys] of [[TENANT_AREA_MAP_PATH, AREA_MAP_QUERY_KEYS], [PLATFORM_AREA_MAP_PATH, PLATFORM_AREA_MAP_QUERY_KEYS]] as const) {
    const op = spec.paths[path]?.["get"];
    assert.ok(op, path);
    assert.deepEqual(sorted((op.parameters ?? []).map((parameter) => parameter.name ?? "")), sorted(keys));
    const body = op.responses["200"]?.content?.["application/json"]?.schema;
    assert.deepEqual(sorted(body?.required ?? []), ["items", "truncated"]);
  }
  assert.equal(spec.paths[PLATFORM_MAP_CONFIG_PATH]?.["get"]?.responses["200"]?.content?.["application/json"]?.schema?.$ref, "#/components/schemas/MapConfig");
});

test("AreaMapItem = 区域详情 + 最近修改人；PlatformAreaMapItem 另带所属供应商", () => {
  assert.deepEqual(sorted(schemas["AreaMapItem"]?.required ?? []), sorted([...AREA_SCHEMA_FIELDS.Area, ...AREA_MAP_FIELDS.AreaMapExtra]));
  assert.deepEqual(sorted(schemas["PlatformAreaMapItem"]?.required ?? []), sorted([...AREA_SCHEMA_FIELDS.Area, ...AREA_MAP_FIELDS.PlatformAreaMapExtra]));
  assert.deepEqual(sorted(Object.keys(schemas["AreaLastEditor"]?.properties ?? {})), sorted(AREA_MAP_FIELDS.AreaLastEditor));
});
