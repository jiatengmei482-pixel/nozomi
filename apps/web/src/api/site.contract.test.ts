/** 官网接口（`/site/v1`）的手写类型与 `apps/api/openapi.yaml` 对账：后端改了路径、字段，这里会失败。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { API_PATH_PREFIXES } from "../lib/api-prefixes.ts";
import { UNAVAILABLE_REASON_TEXT } from "../lib/site-display.ts";
import { SITE_BASE, SITE_ORDER_FIELDS, SITE_ORDER_REQUEST_FIELDS, SITE_QUOTE_REQUEST_FIELDS, SITE_SCHEMA_FIELDS } from "./site.ts";

interface Schema {
  $ref?: string;
  type?: string | string[];
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  oneOf?: Schema[];
  enum?: string[];
}
interface Operation {
  security?: Record<string, unknown>[];
}
const spec = parse(await readFile(new URL("../../../api/openapi.yaml", import.meta.url), "utf8")) as { paths: Record<string, Record<string, Operation>>; components: { schemas: Record<string, Schema> } };
const schemas = spec.components.schemas;
const props = (schema: Schema | undefined): string[] => Object.keys(schema?.properties ?? {}).sort();
const sorted = (values: readonly string[]): string[] => [...values].sort();

test("前端用到的官网接口都在 openapi.yaml 里；订单页的接口要查看令牌，询价下单不要", () => {
  const open: [string, string][] = [
    ["get", `${SITE_BASE}/config`],
    ["get", `${SITE_BASE}/cities`],
    ["get", `${SITE_BASE}/cities/{id}/airports`],
    ["get", `${SITE_BASE}/cities/{id}/charter-packages`],
    ["get", `${SITE_BASE}/cities/{id}/places`],
    ["get", `${SITE_BASE}/places/search`],
    ["get", `${SITE_BASE}/places/reverse`],
    ["post", `${SITE_BASE}/quotes`],
    ["post", `${SITE_BASE}/orders`],
    ["post", `${SITE_BASE}/orders/lookup`],
  ];
  const guarded: [string, string][] = [
    ["get", `${SITE_BASE}/order`],
    ["patch", `${SITE_BASE}/order`],
    ["get", `${SITE_BASE}/order/payment`],
    ["get", `${SITE_BASE}/order/cancel-fee`],
    ["post", `${SITE_BASE}/order/cancel`],
    ["post", `${SITE_BASE}/order/landed`],
    ["post", `${SITE_BASE}/order/extra-charges/{chargeId}/dispute`],
  ];
  for (const [method, path] of open) {
    assert.ok(spec.paths[path]?.[method], `${method.toUpperCase()} ${path}`);
    assert.equal(spec.paths[path]?.[method]?.security, undefined, `${path} 不需要令牌`);
  }
  for (const [method, path] of guarded) assert.deepEqual(spec.paths[path]?.[method]?.security, [{ siteOrderLink: [] }], `${method.toUpperCase()} ${path}`);
  assert.ok(API_PATH_PREFIXES.includes(SITE_BASE), "反向代理和开发代理要把 /site/v1 转给 API");
});

test("应答的字段与 openapi.yaml 一致，且都是必有的", () => {
  for (const [name, fields] of Object.entries(SITE_SCHEMA_FIELDS)) {
    assert.deepEqual(props(schemas[name]), sorted(fields), name);
    assert.deepEqual(sorted(schemas[name]?.required ?? []), sorted(fields), `${name} 的必填字段`);
  }
  assert.deepEqual(props(schemas["SalesOrder"]), sorted(SITE_ORDER_FIELDS), "订单页用的订单就是渠道看到的那一份");
  assert.deepEqual(props(schemas["SiteQuoteRequest"]), sorted(SITE_QUOTE_REQUEST_FIELDS));
  assert.deepEqual(props(schemas["SiteOrderRequest"]), sorted(SITE_ORDER_REQUEST_FIELDS));
});

test("客人看到的报价和订单里没有结算价、加价比例、中标供应商的编号", () => {
  const keys = new Set<string>();
  const walk = (schema: Schema | undefined, seen: Set<string>): void => {
    if (schema === undefined) return;
    if (schema.$ref !== undefined) {
      const name = schema.$ref.replace("#/components/schemas/", "");
      if (seen.has(name)) return;
      walk(schemas[name], new Set([...seen, name]));
      return;
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      keys.add(key);
      walk(child, seen);
    }
    walk(schema.items, seen);
    for (const option of schema.oneOf ?? []) walk(option, seen);
  };
  for (const name of ["SiteQuote", "SiteOrderEnvelope", "SiteConfig"]) walk(schemas[name], new Set([name]));
  assert.ok(keys.has("price") && keys.has("cancel_policy"));
  assert.deepEqual([...keys].filter((key) => /settlement|markup|tenant_id|secret_key|webhook_secret/i.test(key)), []);
});

test("报不出价的每个原因（含路线预估的 NO_ROUTE、TEMPORARILY_UNAVAILABLE）都有给客人看的说法", () => {
  const reasons = schemas["SiteUnavailable"]?.properties?.["reasons"]?.items?.enum ?? [];
  assert.ok(reasons.includes("NO_ROUTE") && reasons.includes("TEMPORARILY_UNAVAILABLE"));
  assert.deepEqual(Object.keys(UNAVAILABLE_REASON_TEXT).sort(), sorted(reasons));
  for (const [reason, text] of Object.entries(UNAVAILABLE_REASON_TEXT)) {
    assert.match(text, /请|暂/, `${reason} 要告诉客人怎么办`);
    assert.doesNotMatch(text, /[A-Z_]{4,}|失败|错误/, `${reason} 不出现代码、不说失败`);
  }
});

test("地址搜索、反查（M3-12）：应答只有 available 和候选 / 地址，没有任何像密钥、谷歌原文的字段；底图沿用区域页的定义", () => {
  const spec200 = (path: string): Schema | undefined => (spec.paths[path]?.["get"] as unknown as { responses: Record<string, { content: Record<string, { schema: Schema }> }> }).responses["200"]?.content["application/json"]?.schema;
  assert.deepEqual(props(spec200(`${SITE_BASE}/places/search`)), ["available", "items"]);
  assert.deepEqual(props(spec200(`${SITE_BASE}/places/reverse`)), ["address", "available"]);
  assert.deepEqual(props(schemas["SitePlaceCandidate"]), ["address", "id", "location", "name"]);
  for (const schema of [spec200(`${SITE_BASE}/places/search`), spec200(`${SITE_BASE}/places/reverse`), schemas["SitePlaceCandidate"], schemas["SiteConfig"]]) {
    assert.deepEqual(props(schema).filter((key) => /key|secret|token|google|raw/i.test(key)), []);
  }
  assert.equal(schemas["SiteConfig"]?.properties?.["map_tiles"]?.$ref, "#/components/schemas/MapConfig/properties/tiles");
});
