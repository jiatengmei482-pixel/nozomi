/** 运营后台「嵌入组件」的手写类型与 `apps/api/openapi.yaml` 对账（M9E-02）：后端改了路径、字段、枚举，这里会失败。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { EMBED_KEYS_PATH, EMBED_SCHEMA_FIELDS, type EmbedLayout, type OrderEntrySource } from "./embed.ts";

interface Schema {
  enum?: (string | null)[];
  properties?: Record<string, Schema>;
  items?: Schema;
}
const spec = parse(await readFile(new URL("../../../api/openapi.yaml", import.meta.url), "utf8")) as { paths: Record<string, Record<string, { security?: unknown }>>; components: { schemas: Record<string, Schema> } };
const sorted = (values: readonly string[]): string[] => [...values].sort();

test("前端用到的嵌入码接口都在 openapi.yaml 里，都要运营后台的令牌", () => {
  for (const [method, path] of [["get", EMBED_KEYS_PATH], ["post", EMBED_KEYS_PATH], ["get", `${EMBED_KEYS_PATH}/{id}`], ["patch", `${EMBED_KEYS_PATH}/{id}`]] as const) {
    assert.ok(spec.paths[path]?.[method], `${method} ${path}`);
    assert.deepEqual(spec.paths[path]?.[method]?.security, [{ platformToken: [] }], `${method} ${path}`);
  }
});

test("类型的字段和枚举与 openapi.yaml 一致", () => {
  for (const [name, fields] of Object.entries(EMBED_SCHEMA_FIELDS)) {
    assert.deepEqual(sorted(Object.keys(spec.components.schemas[name]?.properties ?? {})), sorted(fields), name);
  }
  const key = spec.components.schemas["EmbedKey"]?.properties ?? {};
  assert.deepEqual(key["default_lang"]?.enum, ["zh", "ja", "en"] satisfies string[]);
  assert.deepEqual(key["default_services"]?.items?.enum, ["transfer", "charter"] satisfies string[]);
  assert.deepEqual(key["layout"]?.enum, ["card", "bar"] satisfies EmbedLayout[]);
  assert.deepEqual(spec.components.schemas["EmbedKeyWrite"]?.properties?.["layout"]?.enum, ["card", "bar"] satisfies EmbedLayout[]);
  assert.deepEqual(key["status"]?.enum, ["active", "disabled"] satisfies string[]);
  assert.deepEqual(spec.components.schemas["OrderEntrySource"]?.properties?.["kind"]?.enum, ["book", "embed"] satisfies string[]);
  assert.deepEqual(spec.components.schemas["OrderEntrySource"]?.properties?.["delivery"]?.enum, ["redirect", "host_page", null] satisfies OrderEntrySource["delivery"][]);
});
