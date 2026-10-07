/**
 * 接口定义与实现对账：已注册的路由必须和 openapi.yaml 的 paths 完全一致，
 * 防止「加了接口没写定义」或「定义里有、代码里没有」。
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { buildApp } from "./app.ts";
import { createPool } from "./db/pool.ts";
import { errorBody } from "./errors.ts";
import { testConfig } from "./testing/fixtures.ts";

interface OpenApiDoc {
  openapi: string;
  paths: Record<string, Record<string, { operationId?: string; responses?: Record<string, unknown> }>>;
  components: { schemas: Record<string, { required?: string[]; properties?: Record<string, { required?: string[] }> }> };
}

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);
const doc = parse(await readFile(new URL("../openapi.yaml", import.meta.url), "utf8")) as OpenApiDoc;

const pool = createPool(testConfig().databaseUrl, { connectionTimeoutMs: 1_000 });
after(() => pool.end());

/** OpenAPI 的 `/a/{id}` 与 Fastify 的 `/a/:id` 统一成后者再比较。 */
function toFastifyPath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, ":$1");
}

test("已注册的路由与 openapi.yaml 的 paths 完全一致", async () => {
  const app = buildApp({ config: testConfig(), pool, migrationFiles: [], logger: false });
  await app.ready();
  const implemented = app.registeredRoutes
    .filter((r) => r.method !== "HEAD" && r.method !== "OPTIONS")
    .map((r) => `${r.method} ${r.path}`)
    .sort();
  const documented = Object.entries(doc.paths)
    .flatMap(([path, operations]) =>
      Object.keys(operations)
        .filter((method) => HTTP_METHODS.has(method))
        .map((method) => `${method.toUpperCase()} ${toFastifyPath(path)}`),
    )
    .sort();
  assert.deepEqual(implemented, documented);
  await app.close();
});

test("每个接口都有唯一的 operationId", () => {
  const ids = Object.values(doc.paths).flatMap((operations) =>
    Object.entries(operations)
      .filter(([method]) => HTTP_METHODS.has(method))
      .map(([, operation]) => operation.operationId),
  );
  assert.ok(ids.every((id) => typeof id === "string" && id.length > 0));
  assert.equal(new Set(ids).size, ids.length);
});

test("/health 的实际返回字段与定义里的必填字段一致", async () => {
  const app = buildApp({ config: testConfig(), pool, migrationFiles: [], logger: false, healthTimeoutMs: 1_500 });
  const body = (await app.inject({ method: "GET", url: "/health" })).json() as Record<string, Record<string, unknown>>;
  const schemas = doc.components.schemas;
  assert.deepEqual(Object.keys(body).sort(), [...(schemas["HealthResponse"]?.required ?? [])].sort());
  assert.deepEqual(Object.keys(body["database"] ?? {}).sort(), [...(schemas["DatabaseHealth"]?.required ?? [])].sort());
  assert.deepEqual(Object.keys(body["migrations"] ?? {}).sort(), [...(schemas["MigrationHealth"]?.required ?? [])].sort());
  const integrations = body["integrations"] as unknown as Record<string, unknown>[];
  assert.deepEqual(Object.keys(integrations[0] ?? {}).sort(), [...(schemas["IntegrationStatus"]?.required ?? [])].sort());
  await app.close();
});

test("统一错误格式与定义里的 ErrorResponse 一致", () => {
  const schema = doc.components.schemas["ErrorResponse"];
  const body = errorBody("X", "说明");
  assert.deepEqual(Object.keys(body), schema?.required);
  assert.deepEqual(Object.keys(body.error).sort(), [...(schema?.properties?.["error"]?.required ?? [])].sort());
});
