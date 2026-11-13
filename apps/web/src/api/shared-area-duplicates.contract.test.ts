/** 共享区域去重（M8-31b）的手写类型与 `apps/api/openapi.yaml` 对账。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { PLATFORM_SHARED_AREAS_PATH, PLATFORM_SHARED_AREA_QUERY_KEYS, SHARED_AREA_DUPLICATE_FIELDS } from "./shared-area-duplicates.ts";

interface Schema {
  $ref?: string;
  required?: string[];
  oneOf?: Schema[];
  properties?: Record<string, Schema>;
  items?: Schema;
}
interface Operation {
  parameters?: { name?: string }[];
  responses: Record<string, { content?: { "application/json"?: { schema?: Schema } } }>;
}
const spec = parse(await readFile(new URL("../../../api/openapi.yaml", import.meta.url), "utf8")) as { paths: Record<string, Record<string, Operation>>; components: { schemas: Record<string, Schema> } };
const schemas = spec.components.schemas;
const sorted = (values: readonly string[]): string[] => [...values].sort();
const refName = (schema: Schema | undefined): string => schema?.$ref?.split("/").pop() ?? "";

test("三个接口都在定义里；列表的查询参数和这里一致", () => {
  const list = spec.paths[PLATFORM_SHARED_AREAS_PATH]?.["get"];
  assert.ok(list);
  assert.deepEqual(sorted((list.parameters ?? []).map((parameter) => parameter.name ?? "")), sorted(PLATFORM_SHARED_AREA_QUERY_KEYS));
  for (const action of ["mark-duplicate", "unmark-duplicate"]) {
    const op = spec.paths[`${PLATFORM_SHARED_AREAS_PATH}/{id}/${action}`]?.["post"];
    assert.ok(op, action);
    assert.equal(refName(op.responses["200"]?.content?.["application/json"]?.schema), "SharedAreaDuplicate", action);
  }
});

test("应答的字段和这里的类型一致", () => {
  const page = spec.paths[PLATFORM_SHARED_AREAS_PATH]?.["get"]?.responses["200"]?.content?.["application/json"]?.schema;
  assert.deepEqual(sorted(page?.required ?? []), sorted(SHARED_AREA_DUPLICATE_FIELDS.Page));
  assert.equal(refName(page?.properties?.["items"]?.items), "PlatformSharedArea");
  const item = schemas["PlatformSharedArea"];
  assert.deepEqual(sorted(Object.keys(item?.properties ?? {})), sorted(SHARED_AREA_DUPLICATE_FIELDS.PlatformSharedArea));
  assert.deepEqual(sorted(item?.required ?? []), sorted(SHARED_AREA_DUPLICATE_FIELDS.PlatformSharedArea));
  const mark = item?.properties?.["duplicate"]?.oneOf?.find((option) => option.properties !== undefined);
  assert.deepEqual(sorted(Object.keys(mark?.properties ?? {})), sorted(SHARED_AREA_DUPLICATE_FIELDS.Mark));
  assert.deepEqual(sorted(schemas["SharedAreaDuplicate"]?.required ?? []), sorted(SHARED_AREA_DUPLICATE_FIELDS.SharedAreaDuplicate));
  assert.deepEqual(sorted(Object.keys(schemas["SharedAreaDuplicate"]?.properties ?? {})), sorted(SHARED_AREA_DUPLICATE_FIELDS.SharedAreaDuplicate));
});
