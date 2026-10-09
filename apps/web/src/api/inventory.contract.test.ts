/** 库存、价格和库存的导入导出的手写类型与 `apps/api/openapi.yaml` 对账。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { INVENTORY_MODES } from "@nozomi/domain";
import { XLSX_CONTENT_TYPE, parseFilename } from "./client.ts";
import { IMPORT_FILE_REASONS, INVENTORY_ERROR_CODES, INVENTORY_NESTED_FIELDS, INVENTORY_QUERY_KEYS, INVENTORY_SCHEMA_FIELDS } from "./inventory.ts";
import { PRODUCTS_PATH } from "./products.ts";

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
  requestBody?: { content?: Record<string, { schema?: Schema }> };
  responses: Record<string, { content?: Record<string, { schema?: Schema }> }>;
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
const one = `${PRODUCTS_PATH}/{id}`;

test("库存的接口：路径、方法、请求体、应答、必须带的请求头", () => {
  const read = op("get", `${one}/inventory`);
  assert.equal(ref(response(read, "200")), "Inventory");
  for (const key of INVENTORY_QUERY_KEYS) assert.ok(params(read).includes(`query:${key}`), `库存没有查询参数 ${key}`);
  const mode = op("put", `${one}/inventory`);
  assert.equal(ref(mode.requestBody?.content?.["application/json"]?.schema), "InventoryModeInput");
  assert.equal(ref(response(mode, "200")), "InventoryMode");
  assert.ok(params(mode).includes("header:If-Match"));
  const batch = op("post", `${one}/inventory/batch-set`);
  assert.equal(ref(batch.requestBody?.content?.["application/json"]?.schema), "InventoryBatch");
  assert.equal(ref(response(batch, "200")), "InventoryBatchResult");
  assert.ok(params(batch).includes("header:If-Match"));
  assert.ok(!params(batch).includes("header:Idempotency-Key"), "批量设置不要求幂等键（页面没有带）");
});

test("导入导出：导出是 xlsx 文件；检查的请求体就是文件；确认导入带文件指纹、If-Match、Idempotency-Key", () => {
  for (const path of [`${one}/inventory/export`, `${one}/price-rules/export`]) assert.ok(op("get", path).responses["200"]?.content?.[XLSX_CONTENT_TYPE], `${path} 应答是 xlsx`);
  for (const key of INVENTORY_QUERY_KEYS) assert.ok(params(op("get", `${one}/inventory/export`)).includes(`query:${key}`));
  assert.ok(params(op("get", `${one}/price-rules/export`)).includes("query:rows"));
  assert.match(JSON.stringify(spec.components.parameters["ExportRows"]), /"all","none"/);
  for (const [kind, preview, result] of [["inventory", "InventoryImportPreview", "InventoryImportResult"], ["price-rules", "PriceImportPreview", "PriceImportResult"]] as const) {
    const check = op("post", `${one}/${kind}/import/preview`);
    assert.ok(check.requestBody?.content?.[XLSX_CONTENT_TYPE], `${kind} 检查的请求体是 xlsx`);
    assert.equal(ref(response(check, "200")), preview);
    assert.ok(!params(check).includes("header:If-Match"), "检查不写入，不带版本号");
    const confirm = op("post", `${one}/${kind}/import`);
    assert.ok(confirm.requestBody?.content?.[XLSX_CONTENT_TYPE]);
    assert.equal(ref(response(confirm, "200")), result);
    for (const needed of ["query:file_sha256", "header:If-Match", "header:Idempotency-Key"]) assert.ok(params(confirm).includes(needed), `${kind} 确认导入要带 ${needed}`);
  }
});

test("手写类型的字段与同名 schema 完全一致", () => {
  for (const [name, fields] of Object.entries(INVENTORY_SCHEMA_FIELDS)) {
    const schema = schemas[name];
    assert.ok(schema, `openapi.yaml 里没有 schema ${name}`);
    assert.deepEqual(Object.keys(schema.properties ?? {}).sort(), [...fields].sort(), `${name} 的字段不一致`);
    // 请求体：接口要求的页面都提交了就行（页面四项都给）；应答：必有的字段要全
    if (name === "InventoryBatch") for (const required of schema.required ?? []) assert.ok((fields as readonly string[]).includes(required), `${name} 要求 ${required}，前端没有提交`);
    else assert.deepEqual([...(schema.required ?? [])].sort(), [...fields].sort(), `${name} 的必有字段不一致`);
  }
  const inventory = schemas["Inventory"];
  assert.deepEqual(inventory?.properties?.["days"]?.items?.required, [...INVENTORY_NESTED_FIELDS.day]);
  assert.deepEqual(inventory?.properties?.["ahead"]?.required, [...INVENTORY_NESTED_FIELDS.ahead]);
  assert.deepEqual([...(schemas["InventoryBatchResult"]?.required ?? [])].sort(), [...INVENTORY_SCHEMA_FIELDS.Inventory, "changed_days"].sort());
  assert.deepEqual(schemas["InventoryImportPreview"]?.properties?.["rows"]?.items?.required, [...INVENTORY_NESTED_FIELDS.inventoryRow]);
  const priceRow = schemas["PriceImportPreview"]?.properties?.["rows"]?.items;
  assert.deepEqual(priceRow?.required, [...INVENTORY_NESTED_FIELDS.priceRow]);
  assert.deepEqual(priceRow?.properties?.["content"]?.required, [...INVENTORY_NESTED_FIELDS.priceContent]);
  assert.deepEqual(priceRow?.properties?.["conflicts_with"]?.items?.required, [...INVENTORY_NESTED_FIELDS.priceConflict]);
  assert.match(JSON.stringify(schemas["PriceImportResult"]), /PriceRules/);
  assert.match(JSON.stringify(schemas["PriceImportResult"]), /summary/);
});

test("枚举值与 @nozomi/domain、页面的写法一致", () => {
  assert.deepEqual(schemas["InventoryModeName"]?.enum, [...INVENTORY_MODES]);
  assert.deepEqual(schemas["Inventory"]?.properties?.["days"]?.items?.properties?.["status"]?.enum, ["unlimited", "unset", "closed", "sold_out", "open"]);
  assert.deepEqual(schemas["InventoryImportPreview"]?.properties?.["rows"]?.items?.properties?.["action"]?.enum, ["set", "clear", "unchanged", "error", "conflict"]);
  assert.deepEqual(schemas["PriceImportPreview"]?.properties?.["rows"]?.items?.properties?.["action"]?.enum, ["create", "update", "unchanged", "error", "conflict"]);
});

test("前端按代码处理的错误和原因都写在 openapi.yaml 里；规格里没有对外价和加价比例的字段", () => {
  for (const code of INVENTORY_ERROR_CODES) assert.ok(text.includes(code), `openapi.yaml 里找不到 ${code}`);
  for (const reason of IMPORT_FILE_REASONS) assert.ok(text.includes(`\`${reason}\``), `openapi.yaml 里找不到 ${reason}`);
  for (const name of ["Inventory", "InventoryImportPreview", "PriceImportPreview", "PriceImportResult"]) assert.doesNotMatch(JSON.stringify(schemas[name]).replace(/"description":"[^"]*"/g, ""), /markup|sell_price|sale_price|retail/i, `${name} 不能带对外价或加价比例`);
});

test("下载的文件名取自 Content-Disposition", () => {
  assert.equal(parseFilename("attachment; filename=\"PRD1-inventory.xlsx\""), "PRD1-inventory.xlsx");
  assert.equal(parseFilename("attachment; filename=\"x.xlsx\"; filename*=UTF-8''%E5%BA%93%E5%AD%98.xlsx"), "库存.xlsx");
  assert.equal(parseFilename("attachment"), null);
  assert.equal(parseFilename(null), null);
});
