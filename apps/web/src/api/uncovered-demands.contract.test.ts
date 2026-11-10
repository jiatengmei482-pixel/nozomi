/** 未覆盖需求（M8-20）的手写类型与 `apps/api/openapi.yaml` 对账。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { UNCOVERED_DEMAND_FIELDS, UNCOVERED_DEMAND_POINTS_PATH, UNCOVERED_DEMAND_POINT_QUERY_KEYS, UNCOVERED_DEMAND_QUERY_KEYS, UNCOVERED_DEMAND_REASONS, UNCOVERED_DEMANDS_PATH } from "./uncovered-demands.ts";

interface Schema {
  $ref?: string;
  required?: string[];
  enum?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
}
interface Parameter {
  $ref?: string;
  name?: string;
}
interface Operation {
  parameters?: Parameter[];
  responses: Record<string, { content?: { "application/json"?: { schema?: Schema } } }>;
}
const spec = parse(await readFile(new URL("../../../api/openapi.yaml", import.meta.url), "utf8")) as { paths: Record<string, Record<string, Operation>>; components: { schemas: Record<string, Schema>; parameters: Record<string, Parameter> } };
const schemas = spec.components.schemas;
const sorted = (values: readonly string[]): string[] => [...values].sort();
const paramName = (parameter: Parameter): string => (parameter.$ref ? (spec.components.parameters[parameter.$ref.split("/").pop() ?? ""]?.name ?? "") : (parameter.name ?? ""));

test("列表和地图点两个接口都在定义里；查询参数和这里一致", () => {
  for (const [path, keys] of [[UNCOVERED_DEMANDS_PATH, UNCOVERED_DEMAND_QUERY_KEYS], [UNCOVERED_DEMAND_POINTS_PATH, UNCOVERED_DEMAND_POINT_QUERY_KEYS]] as const) {
    const op = spec.paths[path]?.["get"];
    assert.ok(op, path);
    assert.deepEqual(sorted((op.parameters ?? []).map(paramName)), sorted(keys), path);
  }
});

test("应答的字段和这里的类型一致；原因的枚举一致", () => {
  const page = spec.paths[UNCOVERED_DEMANDS_PATH]?.["get"]?.responses["200"]?.content?.["application/json"]?.schema;
  assert.deepEqual(sorted(page?.required ?? []), sorted(UNCOVERED_DEMAND_FIELDS.Page));
  const points = spec.paths[UNCOVERED_DEMAND_POINTS_PATH]?.["get"]?.responses["200"]?.content?.["application/json"]?.schema;
  assert.deepEqual(sorted(points?.required ?? []), sorted(UNCOVERED_DEMAND_FIELDS.Points));
  assert.deepEqual(sorted(points?.properties?.["items"]?.items?.required ?? []), sorted(UNCOVERED_DEMAND_FIELDS.PointItem));
  for (const name of ["UncoveredDemand", "UncoveredDemandSummary", "UncoveredDemandPoint", "UncoveredDemandOperatingRef"] as const) {
    assert.deepEqual(sorted(Object.keys(schemas[name]?.properties ?? {})), sorted(UNCOVERED_DEMAND_FIELDS[name]), name);
  }
  assert.deepEqual(sorted(schemas["UncoveredDemandReason"]?.enum ?? []), sorted(UNCOVERED_DEMAND_REASONS));
});
