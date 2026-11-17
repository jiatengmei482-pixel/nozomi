/** 包车机场套餐的机场绑定（M9P-22，ADR 0098）的手写类型与 `apps/api/openapi.yaml` 对账。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { AIRPORT_SCENARIO_KINDS } from "@nozomi/domain";
import { CHARTER_AIRPORT_FIELDS } from "./charter-airports.ts";

interface Schema {
  $ref?: string;
  type?: string | string[];
  enum?: (string | null)[];
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
}
interface Operation {
  requestBody?: { content?: { "application/json"?: { schema?: Schema } } };
  responses: Record<string, { $ref?: string; description?: string; content?: { "application/json"?: { schema?: Schema } } }>;
}
interface OpenApi {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema> };
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
const props = (schema: Schema | undefined): string[] => Object.keys(schema?.properties ?? {}).sort();
const sorted = (values: readonly string[]): string[] => [...values].sort();

test("机场绑定：供应商读、整组替换，运营只读；应答和请求体的字段", () => {
  const path = "/tenant/v1/products/{id}/charter-airports";
  assert.equal(ref(response(op("get", path), "200")), "CharterAirports");
  const put = op("put", path);
  assert.equal(ref(response(put, "200")), "CharterAirports");
  assert.ok(put.responses["400"] && put.responses["409"] && put.responses["428"], "校验失败 400、版本冲突 / 还有机场套餐价 409、没带版本号 428");
  assert.match(put.responses["409"]?.description ?? "", /AIRPORT_PRICES_EXIST/);
  const body = put.requestBody?.content?.["application/json"]?.schema;
  assert.deepEqual(props(body), ["bindings"]);
  const input = body?.properties?.["bindings"]?.items;
  assert.deepEqual(props(input), sorted(CHARTER_AIRPORT_FIELDS.CharterAirportBindingInput));
  assert.deepEqual(input?.properties?.["scenario"]?.enum, [...AIRPORT_SCENARIO_KINDS]);
  assert.equal(ref(response(op("get", "/platform/v1/products/{id}/charter-airports"), "200")), "CharterAirports");
  assert.equal(spec.paths["/platform/v1/products/{id}/charter-airports"]?.["put"], undefined, "运营后台没有改的接口");

  const view = schemas["CharterAirports"];
  assert.deepEqual(props(view), sorted(CHARTER_AIRPORT_FIELDS.CharterAirports));
  const binding = view?.properties?.["bindings"]?.items;
  assert.deepEqual(props(binding), sorted(CHARTER_AIRPORT_FIELDS.CharterAirportBinding));
  assert.deepEqual(sorted(binding?.required ?? []), sorted(CHARTER_AIRPORT_FIELDS.CharterAirportBinding));
});

test("价格方式里有机场套餐价 charter_airport_package", () => {
  assert.ok(schemas["PricingModel"]?.enum?.includes("charter_airport_package"));
});
