/** 运营后台「人工报价」「官网设置」的手写类型与 `apps/api/openapi.yaml` 对账（M8-21）：后端改了路径、字段、枚举，这里会失败。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { MANUAL_QUOTE_STATUSES } from "@nozomi/domain";
import { MANUAL_QUOTES_PATH, MANUAL_QUOTE_DETAIL_FIELDS, MANUAL_QUOTE_QUERY_KEYS, MANUAL_QUOTE_SCHEMA_FIELDS, SITE_SETTINGS_PATH } from "./manual-quotes.ts";

interface Schema {
  type?: string | string[];
  enum?: (string | null)[];
  required?: string[];
  properties?: Record<string, Schema>;
  oneOf?: Schema[];
  $ref?: string;
}
interface Operation {
  parameters?: { name?: string; $ref?: string }[];
  security?: unknown;
  requestBody?: { content: Record<string, { schema: Schema }> };
  responses?: Record<string, { content?: { "application/json"?: { schema?: Schema } }; $ref?: string }>;
}
const spec = parse(await readFile(new URL("../../../api/openapi.yaml", import.meta.url), "utf8")) as { paths: Record<string, Record<string, Operation>>; components: { schemas: Record<string, Schema>; parameters: Record<string, { name: string }> } };
const schemas = spec.components.schemas;
const sorted = (values: readonly string[]): string[] => [...values].sort();
const props = (schema: Schema | undefined): string[] => Object.keys(schema?.properties ?? {}).sort();

test("前端用到的人工报价、官网设置接口都在 openapi.yaml 里，都要运营后台的令牌", () => {
  const expected: [string, string][] = [
    ["get", MANUAL_QUOTES_PATH],
    ["get", `${MANUAL_QUOTES_PATH}/assignees`],
    ["get", `${MANUAL_QUOTES_PATH}/{id}`],
    ["patch", `${MANUAL_QUOTES_PATH}/{id}`],
    ["post", `${MANUAL_QUOTES_PATH}/{id}/notes`],
    ["get", SITE_SETTINGS_PATH],
    ["put", SITE_SETTINGS_PATH],
  ];
  for (const [method, path] of expected) {
    assert.ok(spec.paths[path]?.[method], `${method.toUpperCase()} ${path}`);
    assert.deepEqual(spec.paths[path]?.[method]?.security, [{ platformToken: [] }], `${method.toUpperCase()} ${path}`);
  }
});

test("列表的筛选参数与接口一致", () => {
  const names = (spec.paths[MANUAL_QUOTES_PATH]?.["get"]?.parameters ?? []).map((parameter) => parameter.name ?? spec.components.parameters[(parameter.$ref ?? "").replace("#/components/parameters/", "")]?.name);
  assert.deepEqual(sorted(names.filter((name): name is string => typeof name === "string")), sorted(MANUAL_QUOTE_QUERY_KEYS));
});

test("应答的字段与 openapi.yaml 一致，且都是必有的；列表那一份没有任何联系方式和地点", () => {
  for (const [name, fields] of Object.entries(MANUAL_QUOTE_SCHEMA_FIELDS)) {
    assert.deepEqual(props(schemas[name]), sorted(fields), name);
    assert.deepEqual(sorted(schemas[name]?.required ?? []), sorted(fields), `${name} 的必填字段`);
  }
  const detail = spec.paths[`${MANUAL_QUOTES_PATH}/{id}`]?.["get"]?.responses?.["200"]?.content?.["application/json"]?.schema;
  assert.deepEqual(props(detail), sorted(MANUAL_QUOTE_DETAIL_FIELDS));
  assert.deepEqual(props(schemas["ManualQuoteRequestSummary"]).filter((key) => !key.startsWith("has_") && /email|whatsapp|pickup|dropoff|note|contact/.test(key)), []);
  const counts = spec.paths[MANUAL_QUOTES_PATH]?.["get"]?.responses?.["200"]?.content?.["application/json"]?.schema?.properties?.["counts"];
  assert.deepEqual(props(counts), sorted(MANUAL_QUOTE_STATUSES));
});

test("状态的枚举与 @nozomi/domain 一致；改状态、指派的请求体只有这两项；官网设置是号码和页面宽度两项（M8-28），页面宽度三档", () => {
  assert.deepEqual(schemas["ManualQuoteStatus"]?.enum, [...MANUAL_QUOTE_STATUSES]);
  assert.deepEqual(props(spec.paths[`${MANUAL_QUOTES_PATH}/{id}`]?.["patch"]?.requestBody?.content["application/json"]?.schema), ["assignee_id", "status"]);
  assert.deepEqual(props(spec.paths[`${MANUAL_QUOTES_PATH}/{id}/notes`]?.["post"]?.requestBody?.content["application/json"]?.schema), ["note"]);
  assert.deepEqual(props(spec.paths[SITE_SETTINGS_PATH]?.["put"]?.requestBody?.content["application/json"]?.schema), ["page_width", "support_whatsapp"]);
  assert.deepEqual(schemas["SitePageWidth"]?.enum, ["standard", "wide", "full"]);
});
