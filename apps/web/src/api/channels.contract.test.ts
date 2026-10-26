/** 渠道、加价规则、API 客户端、双人复核的手写类型与 `apps/api/openapi.yaml` 对账：后端改了路径、字段、枚举、错误码，这里会失败。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { APPROVAL_STATUSES, CHANNEL_STATUSES, CHANNEL_TYPES, PLATFORM_ACTIONS, TENANT_SCOPES } from "@nozomi/domain";
import { APPROVALS_PATH, CHANNELS_PATH, CHANNEL_ERROR_CODES, CHANNEL_SCHEMA_FIELDS } from "./channels.ts";

interface Schema {
  $ref?: string;
  type?: string | string[];
  enum?: (string | null)[];
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
}
const spec = parse(await readFile(new URL("../../../api/openapi.yaml", import.meta.url), "utf8")) as { paths: Record<string, Record<string, unknown>>; components: { schemas: Record<string, Schema> } };
const schemas = spec.components.schemas;
const props = (schema: Schema | undefined): string[] => Object.keys(schema?.properties ?? {}).sort();
const sorted = (values: readonly string[]): string[] => [...values].sort();

test("前端用到的渠道和复核接口都在 openapi.yaml 里", () => {
  const expected: [string, string][] = [
    ["get", CHANNELS_PATH],
    ["post", CHANNELS_PATH],
    ["get", `${CHANNELS_PATH}/{id}`],
    ["patch", `${CHANNELS_PATH}/{id}`],
    ["post", `${CHANNELS_PATH}/{id}/activate`],
    ["post", `${CHANNELS_PATH}/{id}/pause`],
    ["post", `${CHANNELS_PATH}/{id}/pricing-changes`],
    ["post", `${CHANNELS_PATH}/{id}/markup-rules`],
    ["put", `${CHANNELS_PATH}/{id}/markup-rules/{ruleId}`],
    ["delete", `${CHANNELS_PATH}/{id}/markup-rules/{ruleId}`],
    ["get", `${CHANNELS_PATH}/{id}/api-clients`],
    ["post", `${CHANNELS_PATH}/{id}/api-clients`],
    ["post", `${CHANNELS_PATH}/{id}/api-clients/{clientId}/rotate`],
    ["post", `${CHANNELS_PATH}/{id}/api-clients/{clientId}/revoke`],
    ["get", `${CHANNELS_PATH}/{id}/quote-logs`],
    ["get", APPROVALS_PATH],
    ["post", `${APPROVALS_PATH}/{id}/approve`],
    ["post", `${APPROVALS_PATH}/{id}/reject`],
    ["post", `${APPROVALS_PATH}/{id}/withdraw`],
    ["post", `${CHANNELS_PATH}/{id}/pricing-impact`],
    ["post", `${APPROVALS_PATH}/{id}/pricing-impact`],
  ];
  for (const [method, path] of expected) assert.ok(spec.paths[path]?.[method], `${method.toUpperCase()} ${path}`);
});

test("应答的字段与 openapi.yaml 一致，且都是必有的", () => {
  const pairs: [keyof typeof CHANNEL_SCHEMA_FIELDS, Schema | undefined][] = [
    ["Channel", schemas["Channel"]],
    ["ChannelPricing", schemas["Channel"]?.properties?.["pricing"]],
    ["ChannelScope", schemas["Channel"]?.properties?.["scope"]],
    ["MarkupRule", schemas["MarkupRule"]],
    ["Approval", schemas["Approval"]],
    ["PricingImpact", schemas["PricingImpact"]],
    ["PricingImpactSection", schemas["PricingImpactSection"]],
    ["PricingImpactOrderSection", schemas["PricingImpactOrderSection"]],
    ["PricingImpactTotals", schemas["PricingImpactTotals"]],
    ["ApiClient", schemas["ApiClient"]],
    ["QuoteLogEntry", schemas["QuoteLogList"]?.properties?.["items"]?.items],
  ];
  for (const [name, schema] of pairs) {
    assert.deepEqual(props(schema), sorted(CHANNEL_SCHEMA_FIELDS[name]), name);
    assert.deepEqual(sorted(schema?.required ?? []), sorted(CHANNEL_SCHEMA_FIELDS[name]), `${name} 的必填字段`);
  }
});

test("请求体：页面发的字段都是接口认的，接口必填的页面都发", () => {
  const pairs: [keyof typeof CHANNEL_SCHEMA_FIELDS, string][] = [
    ["ChannelCreate", "ChannelCreateRequest"],
    ["ChannelScopeInput", "ChannelScopeRequest"],
    ["MarkupRuleInput", "MarkupRuleRequest"],
  ];
  for (const [mine, theirs] of pairs) {
    const known = props(schemas[theirs]);
    for (const field of CHANNEL_SCHEMA_FIELDS[mine]) assert.ok(known.includes(field), `${theirs} 不认 ${field}`);
    for (const field of schemas[theirs]?.required ?? []) assert.ok((CHANNEL_SCHEMA_FIELDS[mine] as readonly string[]).includes(field), `页面没有发 ${theirs} 必填的 ${field}`);
  }
  assert.deepEqual(props(schemas["ChannelPricingChangeRequest"]), sorted([...CHANNEL_SCHEMA_FIELDS.ChannelPricing, "request_note"]));
});

test("试算的请求体：四种改动和复核的类别一一对应，里面的内容和发起复核的请求体是同一个定义", () => {
  const options = (spec.components.schemas["PricingImpactRequest"] as { oneOf?: Schema[] }).oneOf ?? [];
  const shapes = options.map((option) => [option.properties?.["kind"]?.enum?.[0], sorted(option.required ?? []), option.properties?.["change"]?.$ref ?? option.properties?.["rule"]?.$ref ?? null]);
  assert.deepEqual(shapes, [
    ["channel.pricing", ["change", "kind"], "#/components/schemas/ChannelPricingChangeRequest"],
    ["markup_rule.create", ["kind", "rule"], "#/components/schemas/MarkupRuleRequest"],
    ["markup_rule.update", ["kind", "rule", "rule_id"], "#/components/schemas/MarkupRuleRequest"],
    ["markup_rule.delete", ["kind", "rule_id"], null],
  ]);
});

test("枚举与 @nozomi/domain 一致：渠道类型、状态、可卖租户的方式、复核状态、平台操作", () => {
  assert.deepEqual(schemas["ChannelType"]?.enum, [...CHANNEL_TYPES]);
  assert.deepEqual(schemas["ChannelStatus"]?.enum, [...CHANNEL_STATUSES]);
  assert.deepEqual(schemas["ChannelScopeRequest"]?.properties?.["tenant_scope"]?.enum, [...TENANT_SCOPES]);
  assert.deepEqual(schemas["Approval"]?.properties?.["status"]?.enum, [...APPROVAL_STATUSES]);
  assert.deepEqual(schemas["PlatformAction"]?.enum, [...PLATFORM_ACTIONS]);
});

test("前端按错误码处理的错误都写在 openapi.yaml 里", () => {
  const text = JSON.stringify(spec);
  for (const code of CHANNEL_ERROR_CODES) assert.ok(text.includes(code), code);
});
