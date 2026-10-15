/**
 * 集成测试里按 `apps/api/openapi.yaml` 核对一次应答：状态码写在了定义里，内容逐字段符合那个状态码下的结构（必填、类型、枚举、不多不少）。
 * 只实现了 openapi.yaml 里用到的那些关键字。400、401、403 是所有需要登录的接口共有的，按 `ErrorResponse` 核对。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import type { ApiResponse } from "./api.ts";

type Schema = Record<string, any>;
interface Operation {
  responses: Record<string, Schema>;
}

const doc = parse(await readFile(new URL("../../openapi.yaml", import.meta.url), "utf8")) as {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema> };
};

function deref(node: Schema): Schema {
  let current = node;
  while (typeof current["$ref"] === "string") {
    const parts = (current["$ref"] as string).replace(/^#\//, "").split("/");
    let target: any = doc;
    for (const part of parts) target = target?.[part];
    assert.ok(target, `定义里找不到 ${current["$ref"]}`);
    const { $ref: _ref, ...siblings } = current;
    current = { ...target, ...siblings };
  }
  return current;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

/** 按定义检查一个值，返回不符合的地方。 */
export function schemaViolations(schemaNode: Schema, value: unknown, path = ""): string[] {
  const schema = deref(schemaNode);
  const found: string[] = [];
  const at = path === "" ? "/" : path;
  if (schema["oneOf"]) {
    const matching = (schema["oneOf"] as Schema[]).filter((option) => schemaViolations(option, value, path).length === 0);
    if (matching.length !== 1) found.push(`${at}：应当恰好符合 oneOf 里的一种，实际符合 ${matching.length} 种`);
  }
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
    if (schema["pattern"] && !new RegExp(schema["pattern"]).test(value)) found.push(`${at}：${value} 不符合 ${schema["pattern"]}`);
  }
  if (typeof value === "number") {
    if (schema["minimum"] !== undefined && value < schema["minimum"]) found.push(`${at}：小于 ${schema["minimum"]}`);
    if (schema["maximum"] !== undefined && value > schema["maximum"]) found.push(`${at}：大于 ${schema["maximum"]}`);
  }
  if (Array.isArray(value) && schema["items"]) value.forEach((item, index) => found.push(...schemaViolations(schema["items"], item, `${path}/${index}`)));
  if (actual === "object") {
    const object = value as Record<string, unknown>;
    const properties: Record<string, Schema> = schema["properties"] ?? {};
    for (const key of (schema["required"] as string[] | undefined) ?? []) if (!(key in object)) found.push(`${at}：缺少必填字段 ${key}`);
    for (const [key, item] of Object.entries(object)) {
      if (properties[key]) found.push(...schemaViolations(properties[key], item, `${path}/${key}`));
      else if (schema["additionalProperties"] === false) found.push(`${at}：多了定义里没有的字段 ${key}`);
    }
  }
  return found;
}

/** 核对一次应答：`template` 是定义里的路径写法（如 `/platform/v1/fx-rates/fetches/{id}/confirm`）。 */
export function assertMatchesOpenApi(method: string, template: string, res: ApiResponse): void {
  const operation = doc.paths[template]?.[method.toLowerCase()];
  assert.ok(operation, `定义里没有 ${method} ${template}`);
  if ([400, 401, 403].includes(res.status)) {
    assert.deepEqual(schemaViolations(doc.components.schemas["ErrorResponse"] as Schema, res.body), [], res.text);
    return;
  }
  const documented = operation.responses[String(res.status)];
  assert.ok(documented, `${method} ${template} 实际返回了 ${res.status}（${res.body?.error?.code ?? ""}），定义里没有写这个状态码`);
  const schema = deref(documented)["content"]?.["application/json"]?.["schema"];
  assert.ok(schema, `${method} ${template} 的 ${res.status} 在定义里没有写返回结构`);
  assert.deepEqual(schemaViolations(schema, res.body), [], `${method} ${template} 的 ${res.status} 应答不符合定义：${res.text.slice(0, 400)}`);
}
