/**
 * 按 apps/api/openapi.yaml 核对接口实际返回的 JSON（集成测试用）。
 * 只实现了定义里用到的那些关键字：$ref、oneOf、allOf、type、enum、format（uuid / date-time / date）、pattern、长度、范围、条数、
 * required、properties、additionalProperties。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

export type Schema = Record<string, any>;

export interface OpenApiOperation {
  parameters?: Schema[];
  requestBody?: { content: { "application/json": { schema: Schema } } };
  responses: Record<string, Schema>;
  description?: string;
}

export const openApiDoc = parse(await readFile(new URL("../../openapi.yaml", import.meta.url), "utf8")) as {
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: { schemas: Record<string, Schema>; parameters: Record<string, Schema>; responses: Record<string, Schema> };
};

export function deref(node: Schema): Schema {
  let current = node;
  while (typeof current["$ref"] === "string") {
    const parts = (current["$ref"] as string).replace(/^#\//, "").split("/");
    let target: any = openApiDoc;
    for (const part of parts) target = target?.[part];
    assert.ok(target, `定义里找不到 ${current["$ref"]}`);
    const { $ref: _ref, ...siblings } = current;
    current = { ...target, ...siblings };
  }
  return current;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

/** 按定义检查一个值，返回不符合的地方（空数组 = 符合）。 */
export function violations(schemaNode: Schema, value: unknown, path = ""): string[] {
  const schema = deref(schemaNode);
  const found: string[] = [];
  const at = path === "" ? "/" : path;
  if (schema["oneOf"]) {
    const matching = (schema["oneOf"] as Schema[]).filter((option) => violations(option, value, path).length === 0);
    if (matching.length !== 1) found.push(`${at}：应当恰好符合 oneOf 里的一种，实际符合 ${matching.length} 种`);
  }
  for (const part of (schema["allOf"] as Schema[] | undefined) ?? []) found.push(...violations(part, value, path));
  const actual = typeOf(value);
  if (schema["type"] !== undefined) {
    const allowed: string[] = Array.isArray(schema["type"]) ? schema["type"] : [schema["type"]];
    const ok = allowed.includes(actual) || (actual === "integer" && allowed.includes("number"));
    if (!ok) return [...found, `${at}：类型应为 ${allowed.join(" / ")}，实际是 ${actual}`];
  }
  if (schema["enum"] && !(schema["enum"] as unknown[]).includes(value)) found.push(`${at}：${JSON.stringify(value)} 不在枚举 ${JSON.stringify(schema["enum"])} 里`);
  if (typeof value === "string") {
    if (schema["format"] === "uuid" && !UUID.test(value)) found.push(`${at}：不是 UUID`);
    if (schema["format"] === "date-time" && !DATE_TIME.test(value)) found.push(`${at}：不是带时区的时间`);
    if (schema["format"] === "date" && !DATE.test(value)) found.push(`${at}：不是日期`);
    if (schema["pattern"] && !new RegExp(schema["pattern"]).test(value)) found.push(`${at}：不符合 ${schema["pattern"]}`);
    if (schema["maxLength"] !== undefined && [...value].length > schema["maxLength"]) found.push(`${at}：超过 ${schema["maxLength"]} 个字符`);
    if (schema["minLength"] !== undefined && [...value].length < schema["minLength"]) found.push(`${at}：不到 ${schema["minLength"]} 个字符`);
  }
  if (typeof value === "number") {
    if (schema["minimum"] !== undefined && value < schema["minimum"]) found.push(`${at}：小于 ${schema["minimum"]}`);
    if (schema["maximum"] !== undefined && value > schema["maximum"]) found.push(`${at}：大于 ${schema["maximum"]}`);
  }
  if (Array.isArray(value)) {
    if (schema["minItems"] !== undefined && value.length < schema["minItems"]) found.push(`${at}：少于 ${schema["minItems"]} 项`);
    if (schema["maxItems"] !== undefined && value.length > schema["maxItems"]) found.push(`${at}：多于 ${schema["maxItems"]} 项`);
    if (schema["items"]) value.forEach((item, index) => found.push(...violations(schema["items"], item, `${path}/${index}`)));
  }
  if (actual === "object") {
    const object = value as Record<string, unknown>;
    const properties: Record<string, Schema> = schema["properties"] ?? {};
    for (const key of (schema["required"] as string[] | undefined) ?? []) if (!(key in object)) found.push(`${at}：缺少必填字段 ${key}`);
    for (const [key, item] of Object.entries(object)) {
      if (properties[key]) found.push(...violations(properties[key], item, `${path}/${key}`));
      else if (schema["additionalProperties"] === false) found.push(`${at}：多了定义里没有的字段 ${key}`);
      else if (typeof schema["additionalProperties"] === "object") found.push(...violations(schema["additionalProperties"], item, `${path}/${key}`));
    }
  }
  return found;
}

/** 一次应答符合定义里这个接口、这个状态码下的结构（状态码必须写在定义里）。 */
export function assertMatchesOperation(method: string, template: string, status: number, body: unknown): void {
  const operation = openApiDoc.paths[template]?.[method.toLowerCase()];
  assert.ok(operation, `定义里没有 ${method} ${template}`);
  const response = operation.responses[String(status)];
  assert.ok(response, `${method} ${template} 的定义里没有状态码 ${status}`);
  const schema = deref(response)["content"]?.["application/json"]?.["schema"];
  if (schema !== undefined) assert.deepEqual(violations(schema, body), [], `${method} ${template} ${status} 的应答不符合定义`);
}
