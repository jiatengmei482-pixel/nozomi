/** 价格规则、调价规则、价格日历、价格总览、节假日的手写类型与 `apps/api/openapi.yaml` 对账。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { ADJUST_CYCLE_TYPES, PRICE_DIRECTIONS, PRICING_MODELS } from "@nozomi/domain";
import { TENANT_BASE } from "./areas.ts";
import { CALENDAR_QUERY_KEYS, HOLIDAY_QUERY_KEYS, NO_PRICE_REASONS, PRICE_ERROR_CODES, PRICE_OVERVIEW_ITEM_FIELDS, PRICE_SCHEMA_FIELDS, PRICE_WRITE_FIELDS } from "./prices.ts";
import { BRANDS_PATH, PRODUCTS_PATH } from "./products.ts";

interface Schema {
  $ref?: string;
  type?: string | string[];
  enum?: (string | null)[];
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
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
/** 一个 schema 自己的和 allOf 里并进来的全部字段。 */
function fieldsOf(name: string): { properties: string[]; required: string[] } {
  const schema = schemas[name];
  assert.ok(schema, `openapi.yaml 里没有 schema ${name}`);
  const parts = [schema, ...(schema.allOf ?? []).map((part) => (part.$ref ? (schemas[ref(part) ?? ""] ?? {}) : part))];
  return { properties: parts.flatMap((part) => Object.keys(part.properties ?? {})), required: parts.flatMap((part) => part.required ?? []) };
}

const one = `${PRODUCTS_PATH}/{id}`;

test("价格规则和调价规则的接口：路径、方法、请求体、应答、必须带的请求头", () => {
  assert.equal(ref(response(op("get", `${one}/price-rules`), "200")), "PriceRules");
  const batch = op("post", `${one}/price-rules/batch`);
  assert.equal(body(batch), "PriceRuleBatch");
  assert.ok(params(batch).includes("header:If-Match"), "批量保存价格要带 If-Match");
  assert.ok(params(batch).includes("header:Idempotency-Key"), "批量保存价格要带 Idempotency-Key");
  assert.ok(response(batch, "200"));

  assert.equal(ref(response(op("get", `${one}/adjust-rules`), "200")), "AdjustRules");
  const create = op("post", `${one}/adjust-rules`);
  assert.equal(body(create), "AdjustRuleInput");
  assert.ok(params(create).includes("header:If-Match") && params(create).includes("header:Idempotency-Key"));
  const update = op("put", `${one}/adjust-rules/{ruleId}`);
  assert.equal(body(update), "AdjustRuleInput");
  assert.ok(params(update).includes("header:If-Match"));
  assert.ok(params(op("delete", `${one}/adjust-rules/{ruleId}`)).includes("header:If-Match"));
  for (const action of ["enable", "disable"]) {
    const toggle = op("post", `${one}/adjust-rules/{ruleId}/${action}`);
    assert.ok(!params(toggle).includes("header:If-Match"), `${action} 不要求 If-Match（页面没有带）`);
    assert.ok(response(toggle, "200"));
  }
  const order = op("put", `${one}/adjust-rules/order`);
  assert.equal(body(order), "AdjustRuleOrder");
  assert.ok(params(order).includes("header:If-Match"));
  assert.equal(ref(response(order, "200")), "AdjustRules");

  const calendar = op("get", `${one}/price-calendar`);
  assert.equal(ref(response(calendar, "200")), "PriceCalendar");
  for (const key of CALENDAR_QUERY_KEYS) assert.ok(params(calendar).includes(`query:${key}`), `价格日历没有查询参数 ${key}`);
  assert.ok(op("get", `${one}/price-coverage`));
  assert.equal(ref(response(op("get", `${TENANT_BASE}/price-overview`), "200")), "PriceOverview");
  const rounding = op("put", `${BRANDS_PATH}/{id}/rounding-unit`);
  assert.ok(params(rounding).includes("header:If-Match"));
  const holidays = op("get", `${TENANT_BASE}/holidays`);
  assert.equal(ref(response(holidays, "200")), "Holidays");
  for (const key of HOLIDAY_QUERY_KEYS) assert.ok(params(holidays).includes(`query:${key}`), `节假日没有查询参数 ${key}`);
});

test("手写类型的字段与同名 schema 完全一致；提交的字段接口都认", () => {
  for (const [name, fields] of Object.entries(PRICE_SCHEMA_FIELDS)) {
    const schema = fieldsOf(name);
    assert.deepEqual([...new Set(schema.properties)].sort(), [...fields].sort(), `${name} 的字段不一致`);
    assert.deepEqual([...new Set(schema.required)].sort(), [...fields].sort(), `${name} 的必有字段不一致`);
  }
  for (const [name, fields] of Object.entries(PRICE_WRITE_FIELDS)) {
    const schema = fieldsOf(name);
    for (const field of fields) assert.ok(schema.properties.includes(field), `${name} 里没有字段 ${field}`);
    for (const required of schema.required) assert.ok((fields as readonly string[]).includes(required), `${name} 要求 ${required}，前端没有提交`);
  }
  assert.deepEqual(schemas[ref(schemas["PriceRules"]?.properties?.["coverage"]) ?? ""]?.required, ["total", "priced", "missing"]);
  assert.deepEqual(schemas["Holidays"]?.properties?.["countries"]?.items?.required, ["country_code", "count", "last_date"]);
  const overview = schemas["PriceOverview"];
  assert.deepEqual(overview?.required, ["products_with_price", "products_without_price"], "带 summary=1 时没有 items");
  assert.deepEqual([...(overview?.properties?.["items"]?.items?.required ?? [])].sort(), [...PRICE_OVERVIEW_ITEM_FIELDS].sort());
  assert.deepEqual(overview?.properties?.["items"]?.items?.properties?.["coverage"]?.required, ["total", "missing"]);
  assert.ok(params(op("get", `${TENANT_BASE}/price-overview`)).includes("query:summary"));
  const segment = schemas["PriceCalendarDay"]?.properties?.["segments"]?.items;
  assert.deepEqual(segment?.required, ["from", "to", "final", "no_price_reason", "base", "unrounded", "adjusts"]);
  assert.deepEqual((segment?.properties?.["no_price_reason"]?.enum ?? []).filter((value) => value !== null), [...NO_PRICE_REASONS]);
  assert.deepEqual(segment?.properties?.["adjusts"]?.items?.properties?.["steps"]?.items?.required, ["type", "value", "delta", "after"]);
  assert.deepEqual(schemas["PriceCalendar"]?.properties?.["groups"]?.items?.required, ["vehicle_group_id", "days"]);
});

test("枚举值与 @nozomi/domain 一致", () => {
  const model = schemas["PriceRuleInput"]?.properties?.["pricing_model"] ?? {};
  assert.deepEqual((model.enum ?? schemas[ref(model) ?? ""]?.enum ?? []).filter((value) => value !== null), [...PRICING_MODELS]);
  assert.deepEqual(schemas["PriceDirection"]?.enum, [...PRICE_DIRECTIONS]);
  assert.match(JSON.stringify(schemas["PriceRuleInput"]?.properties?.["direction"]), /PriceDirection/);
  for (const type of ADJUST_CYCLE_TYPES) assert.ok(text.includes(type), `openapi.yaml 里找不到周期 ${type}`);
});

test("前端按代码处理的错误和原因都写在 openapi.yaml 里；规格里没有对外价和加价比例的字段", () => {
  for (const code of PRICE_ERROR_CODES) assert.ok(text.includes(`\`${code}\``) || text.includes(code), `openapi.yaml 里找不到 ${code}`);
  for (const name of [...Object.keys(PRICE_SCHEMA_FIELDS), "PriceCalendar", "PriceOverview"]) assert.doesNotMatch(JSON.stringify(schemas[name]?.properties ?? {}).replace(/"description":"[^"]*"/g, ""), /markup|sell_price|sale_price|retail/i, `${name} 不能带对外价或加价比例`);
});
