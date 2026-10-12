/** 子品牌、商品、服务规则、商品详情、上架检查的手写类型与 `apps/api/openapi.yaml` 对账。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { NIGHT_CHARGE_UNITS, PRODUCT_STATUSES, PUBLISH_CHECK_KEYS } from "@nozomi/domain";
import { TENANT_BASE } from "./areas.ts";
import { BRANDS_PATH, PRODUCTS_PATH, PRODUCT_ERROR_CODES, PRODUCT_LIST_QUERY_KEYS, PRODUCT_SCHEMA_FIELDS, PRODUCT_WRITE_FIELDS } from "./products.ts";

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


const body = (operation: Operation): string | undefined => ref(operation.requestBody?.content?.["application/json"]?.schema);

test("子品牌和商品的接口：路径、方法、请求体、应答、必须带的请求头", () => {
  assert.equal(ref(response(op("get", BRANDS_PATH), "200")?.properties?.["items"]?.items), "Brand");
  const brand = op("post", BRANDS_PATH);
  assert.equal(body(brand), "BrandCreate");
  assert.equal(ref(response(brand, "201")), "Brand");
  assert.ok(params(brand).includes("header:Idempotency-Key"));

  const list = response(op("get", PRODUCTS_PATH), "200");
  assert.deepEqual([...(list?.required ?? [])].sort(), ["items", "next_cursor", "total"]);
  assert.equal(ref(list?.properties?.["items"]?.items), "ProductSummary");
  const create = op("post", PRODUCTS_PATH);
  assert.equal(body(create), "ProductCreate");
  assert.equal(ref(response(create, "201")), "Product");
  assert.ok(params(create).includes("header:Idempotency-Key"));
  const one = `${PRODUCTS_PATH}/{id}`;
  assert.equal(ref(response(op("get", one), "200")), "Product");
  const patch = op("patch", one);
  assert.equal(body(patch), "ProductPatch");
  assert.equal(ref(response(patch, "200")), "Product");
  assert.ok(op("delete", one).responses["204"]);
  for (const [path, request, answer] of [
    ["service-rules", "ServiceRules", "ProductServiceRules"],
    ["content", "ProductContent", "ProductContentResponse"],
  ] as const) {
    assert.equal(ref(response(op("get", `${one}/${path}`), "200")), answer);
    const put = op("put", `${one}/${path}`);
    assert.equal(body(put), request);
    assert.equal(ref(response(put, "200")), answer);
    assert.ok(params(put).includes("header:If-Match"), `${path} 保存要带 If-Match`);
  }
  assert.ok(params(patch).includes("header:If-Match"));
  assert.equal(ref(response(op("get", `${one}/publish-check`), "200")), "PublishCheck");
  assert.equal(ref(response(op("post", `${one}/publish`), "200")), "Product");
  assert.equal(ref(response(op("post", `${one}/unpublish`), "200")), "Product");
});

test("列表的查询参数名接口都认；选项用的主数据接口在，接送点可以一次按机场和车站筛", () => {
  const accepted = params(op("get", PRODUCTS_PATH));
  for (const key of PRODUCT_LIST_QUERY_KEYS) assert.ok(accepted.includes(`query:${key}`), `商品列表没有查询参数 ${key}`);
  for (const kind of ["vehicle-groups", "addons"]) assert.ok(params(op("get", `${TENANT_BASE}/master/${kind}`)).includes("query:status"));
  const type = spec.components.parameters["PlaceTypeFilter"] ?? Object.values(spec.components.parameters).find((parameter) => parameter.name === "type");
  assert.match(JSON.stringify(type), /airport\|station/);
});

test("手写类型的字段与同名 schema 完全一致", () => {
  for (const [name, fields] of Object.entries(PRODUCT_SCHEMA_FIELDS)) {
    const schema = schemas[name];
    assert.ok(schema, `openapi.yaml 里没有 schema ${name}`);
    assert.deepEqual(Object.keys(schema.properties ?? {}).sort(), [...fields].sort(), `${name} 的字段不一致`);
    if (name !== "ProductContentText") assert.deepEqual([...(schema.required ?? [])].sort(), [...fields].sort(), `${name} 的必有字段不一致`);
  }
  for (const [name, fields] of Object.entries(PRODUCT_WRITE_FIELDS)) {
    const schema = schemas[name];
    assert.ok(schema, `openapi.yaml 里没有 schema ${name}`);
    const known = Object.keys(schema.properties ?? {});
    for (const field of fields) assert.ok(known.includes(field), `${name} 里没有字段 ${field}`);
    for (const required of schema.required ?? []) assert.ok((fields as readonly string[]).includes(required), `${name} 要求 ${required}，前端没有提交`);
  }
  assert.deepEqual(schemas["ProductSummary"]?.properties?.["check"]?.required, ["can_publish", "failed_required", "unavailable_required"]);
  const item = schemas["PublishCheck"]?.properties?.["items"]?.items;
  assert.deepEqual(item?.required, ["key", "required", "passed", "issues"]);
  assert.deepEqual(item?.properties?.["issues"]?.items?.required, ["path", "reason", "message"]);
  const rules = schemas["ProductServiceRules"]?.properties?.["rules"];
  assert.deepEqual(rules?.required, [...PRODUCT_WRITE_FIELDS.ServiceRules]);
  assert.deepEqual(rules?.properties?.["booking"]?.required, ["sale_from", "sale_to", "service_time", "lead_time_hours", "note"]);
  assert.deepEqual(rules?.properties?.["urgent"]?.properties?.["tiers"]?.items?.required, ["within_hours", "surcharge"]);
  assert.deepEqual(rules?.properties?.["night"]?.required, ["enabled", "window", "amount", "charge_unit"]);
  assert.deepEqual(rules?.properties?.["addons"]?.items?.required, ["addon_id", "enabled", "unit_price", "first_free"]);
  assert.deepEqual(rules?.properties?.["driver_languages"]?.items?.required, ["language", "unit_price"]);
  assert.deepEqual(schemas["DailyWindow"]?.required, ["start", "end"]);
});

test("枚举值与 @nozomi/domain 一致", () => {
  assert.deepEqual(schemas["ProductStatus"]?.enum, [...PRODUCT_STATUSES]);
  assert.deepEqual(schemas["PublishCheck"]?.properties?.["items"]?.items?.properties?.["key"]?.enum, [...PUBLISH_CHECK_KEYS]);
  assert.deepEqual((schemas["ServiceRules"]?.properties?.["night"]?.properties?.["charge_unit"]?.enum ?? []).filter((value) => value !== null), [...NIGHT_CHARGE_UNITS]);
  assert.deepEqual(schemas["FreeWait"]?.properties?.["mode"]?.enum, ["unlimited", "limited"]);
});

test("前端按代码处理的错误和原因都写在 openapi.yaml 里", () => {
  for (const code of [...PRODUCT_ERROR_CODES, "FEATURE_NOT_AVAILABLE", "NO_AREA", "NO_VEHICLE_GROUP", "NO_DISPATCHER", "AREA_DISABLED", "UNKNOWN_AREA", "AREA_NOT_USABLE", "AREA_OTHER_CITY", "VEHICLE_GROUP_DISABLED", "VEHICLE_COMBO_NOT_OFFERED", "ADDON_DISABLED", "ADDON_NOT_APPLICABLE", "CITY_DISABLED", "PICKUP_PLACE_DISABLED", "BRAND_DISABLED", "UNKNOWN_BRAND", "BELOW_PLATFORM_MINIMUM", "TIER_NOT_WITHIN_LEAD_TIME", "INVALID_PHONE"]) {
    assert.ok(text.includes(`\`${code}\``), `openapi.yaml 里找不到 ${code}`);
  }
});
