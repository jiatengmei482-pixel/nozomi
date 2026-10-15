/** 运营后台只读查看商品（列表、详情、平台的节假日）的手写类型与 `apps/api/openapi.yaml` 对账。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { type PlatformRole, platformRoleCan } from "@nozomi/domain";
import { PLATFORM_HOLIDAYS_PATH, PLATFORM_PRODUCTS_PATH, PLATFORM_PRODUCT_DETAIL_PARTS, PLATFORM_PRODUCT_QUERY_KEYS, PLATFORM_PRODUCT_SCHEMA_FIELDS } from "./platform-products.ts";
import { PRODUCT_SCHEMA_FIELDS } from "./products.ts";

interface Schema {
  $ref?: string;
  type?: string | string[];
  enum?: (string | null)[];
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  oneOf?: Schema[];
  allOf?: Schema[];
}
interface Parameter {
  $ref?: string;
  name?: string;
  in?: string;
  schema?: Schema;
}
interface Operation {
  parameters?: Parameter[];
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
function op(method: string, path: string): Operation {
  const found = spec.paths[path]?.[method];
  assert.ok(found, `openapi.yaml 里没有 ${method.toUpperCase()} ${path}`);
  return found;
}
const response = (operation: Operation, status: string): Schema | undefined => operation.responses[status]?.content?.["application/json"]?.schema;
const params = (operation: Operation): Parameter[] => (operation.parameters ?? []).map((parameter) => (parameter.$ref ? (spec.components.parameters[parameter.$ref.replace("#/components/parameters/", "")] as Parameter) : parameter));
const props = (schema: Schema | undefined): string[] => Object.keys(schema?.properties ?? {}).sort();
const sorted = (values: readonly string[]): string[] => [...values].sort();

test("商品列表：路径、查询参数（筛选条件一个不差）、应答带 total；列表项的字段", () => {
  const list = op("get", PLATFORM_PRODUCTS_PATH);
  const query = params(list).filter((parameter) => parameter.in === "query");
  assert.deepEqual(sorted(query.map((parameter) => parameter.name ?? "")), sorted(PLATFORM_PRODUCT_QUERY_KEYS));
  assert.deepEqual(query.find((parameter) => parameter.name === "status")?.schema?.enum, ["draft", "published", "unpublished", "all"]);
  assert.deepEqual(query.find((parameter) => parameter.name === "has_active_price")?.schema?.enum, ["true", "false"]);
  const body = response(list, "200");
  assert.deepEqual(sorted(body?.required ?? []), ["items", "next_cursor", "total"]);
  assert.equal(ref(body?.properties?.["items"]?.items), "PlatformProductSummary");
  assert.ok(response(list, "400"), "查询参数不对是 400");

  const summary = schemas["PlatformProductSummary"];
  assert.deepEqual(props(summary), sorted(PLATFORM_PRODUCT_SCHEMA_FIELDS.PlatformProductSummary));
  assert.deepEqual(sorted(summary?.required ?? []), sorted(PLATFORM_PRODUCT_SCHEMA_FIELDS.PlatformProductSummary), "列表项的每个字段都一定有");
  assert.equal(ref(summary?.properties?.["tenant"]), "ProductTenantRef");
  assert.equal(summary?.properties?.["has_active_price"]?.type, "boolean");
  // 和供应商侧的列表项同结构：去掉上架检查的概况，加上供应商和价格情况
  const tenantSide = PRODUCT_SCHEMA_FIELDS.ProductSummary.filter((field) => field !== "check");
  assert.deepEqual(sorted(PLATFORM_PRODUCT_SCHEMA_FIELDS.PlatformProductSummary.filter((field) => !["tenant_id", "tenant", "has_active_price", "active_price_rule_count"].includes(field))), sorted(tenantSide));

  const tenant = schemas["ProductTenantRef"];
  assert.deepEqual(props(tenant), sorted(PLATFORM_PRODUCT_SCHEMA_FIELDS.ProductTenantRef));
  assert.deepEqual(tenant?.properties?.["status"]?.enum, ["active", "suspended"]);
});

test("商品详情：路径、404；各部分和供应商侧对应接口是同一个结构；库存只有模式和还有几天", () => {
  const detail = op("get", `${PLATFORM_PRODUCTS_PATH}/{id}`);
  assert.equal(ref(response(detail, "200")), "PlatformProductDetail");
  assert.ok(detail.responses["404"], "不存在的编号 404");
  const schema = schemas["PlatformProductDetail"];
  assert.deepEqual(props(schema), sorted(PLATFORM_PRODUCT_SCHEMA_FIELDS.PlatformProductDetail));
  assert.deepEqual(sorted(schema?.required ?? []), sorted(PLATFORM_PRODUCT_SCHEMA_FIELDS.PlatformProductDetail));
  for (const [part, name] of Object.entries(PLATFORM_PRODUCT_DETAIL_PARTS)) assert.equal(ref(schema?.properties?.[part]), name, `详情的 ${part}`);
  // 页面直接拿供应商侧的组件显示这几部分，所以结构必须就是供应商侧接口的那几个
  const tenantProduct = `/tenant/v1/products/{id}`;
  assert.equal(ref(response(op("get", tenantProduct), "200")), "Product");
  assert.equal(ref(response(op("get", `${tenantProduct}/service-rules`), "200")), "ProductServiceRules");
  assert.equal(ref(response(op("get", `${tenantProduct}/content`), "200")), "ProductContentResponse");
  assert.equal(ref(schemas["ProductContentResponse"]?.properties?.["content"]), "ProductContent");
  assert.equal(ref(response(op("get", `${tenantProduct}/price-rules`), "200")), "PriceRules");
  assert.equal(ref(response(op("get", `${tenantProduct}/adjust-rules`), "200")), "AdjustRules");
  assert.equal(ref(response(op("get", `${tenantProduct}/publish-check`), "200")), "PublishCheck");
  const inventory = schema?.properties?.["inventory"];
  assert.deepEqual(props(inventory), sorted(PLATFORM_PRODUCT_SCHEMA_FIELDS.PlatformProductInventory));
  assert.equal(ref(inventory?.properties?.["mode"]), "InventoryModeName");
});

test("这两个接口里没有对外价和加价比例（平台在这里只看结算价）", () => {
  const seen = new Set<string>();
  const names: string[] = [];
  const walk = (schema: Schema | undefined): void => {
    if (!schema) return;
    const name = ref(schema);
    if (name !== undefined) {
      if (seen.has(name)) return;
      seen.add(name);
      return walk(schemas[name]);
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      names.push(key);
      walk(child);
    }
    walk(schema.items);
    for (const child of [...(schema.oneOf ?? []), ...(schema.allOf ?? [])]) walk(child);
  };
  walk(schemas["PlatformProductSummary"]);
  walk(schemas["PlatformProductDetail"]);
  assert.deepEqual(names.filter((name) => /markup|^sell(_|$)|sell_price|retail|external_price|public_price/i.test(name)), []);
});

test("平台的节假日：和供应商侧同一个结构（调价规则的「节假日」周期用）", () => {
  assert.equal(ref(response(op("get", PLATFORM_HOLIDAYS_PATH), "200")), "Holidays");
  assert.equal(ref(response(op("get", "/tenant/v1/holidays"), "200")), "Holidays");
  assert.deepEqual(
    params(op("get", PLATFORM_HOLIDAYS_PATH)).map((parameter) => parameter.name).sort(),
    ["country_code", "from", "to"],
  );
});

test("权限：product.read 在平台操作清单里；有它的角色和 ADR 0021 一致", () => {
  assert.ok(schemas["PlatformAction"]?.enum?.includes("product.read"));
  const allowed: PlatformRole[] = ["super_admin", "operations", "tenant_onboarding", "channel_manager", "customer_service", "risk", "readonly"];
  const denied: PlatformRole[] = ["finance", "master_data", "tech"];
  for (const role of allowed) assert.ok(platformRoleCan(role, "product.read"), `${role} 应能看商品`);
  for (const role of denied) assert.ok(!platformRoleCan(role, "product.read"), `${role} 不能看商品`);
});
