/** 运营后台报价试算（`POST /platform/v1/quotes/preview`）的手写类型与 `apps/api/openapi.yaml` 对账。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { type PlatformRole, QUOTE_REFUSALS, platformRoleCan } from "@nozomi/domain";
import { ROUTE_SOURCE_TEXT } from "../lib/route-display.ts";
import { QUOTE_ERROR_CODES, QUOTE_PREVIEW_PATH, QUOTE_SCHEMA_FIELDS } from "./quotes.ts";

interface Schema {
  $ref?: string;
  type?: string | string[];
  enum?: (string | null)[];
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  oneOf?: Schema[];
  pattern?: string;
}
interface Parameter {
  $ref?: string;
  name?: string;
  in?: string;
  schema?: Schema;
}
interface Operation {
  description?: string;
  parameters?: Parameter[];
  requestBody?: { required?: boolean; content?: { "application/json"?: { schema?: Schema } } };
  responses: Record<string, { description?: string; content?: { "application/json"?: { schema?: Schema } } }>;
}
interface OpenApi {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema>; parameters: Record<string, Parameter> };
}

const text = await readFile(new URL("../../../api/openapi.yaml", import.meta.url), "utf8");
const spec = parse(text) as OpenApi;
const schemas = spec.components.schemas;
const ref = (schema: Schema | undefined): string | undefined => schema?.$ref?.replace("#/components/schemas/", "");
const props = (schema: Schema | undefined): string[] => Object.keys(schema?.properties ?? {}).sort();
const sorted = (values: readonly string[]): string[] => [...values].sort();
const preview = spec.paths[QUOTE_PREVIEW_PATH]?.["post"] as Operation;

test("试算接口：路径、请求体、应答、被拒的三种（400 字段不对、409 城市或接送点停用、422 不在渠道的授权范围）", () => {
  assert.ok(preview, `openapi.yaml 里没有 POST ${QUOTE_PREVIEW_PATH}`);
  assert.equal(preview.requestBody?.required, true);
  assert.equal(ref(preview.requestBody?.content?.["application/json"]?.schema), "PlatformQuotePreviewRequest");
  assert.equal(ref(preview.responses["200"]?.content?.["application/json"]?.schema), "PlatformQuotePreview");
  assert.match(preview.responses["400"]?.description ?? "", /VALIDATION_FAILED/);
  assert.match(preview.responses["409"]?.description ?? "", /MASTER_DATA_NOT_READY/);
  assert.match(preview.responses["409"]?.description ?? "", /CITY_DISABLED/);
  assert.match(preview.responses["409"]?.description ?? "", /PLACE_DISABLED/);
  assert.match(preview.responses["422"]?.description ?? "", /CHANNEL_SCOPE_DENIED/);
  for (const code of QUOTE_ERROR_CODES) assert.ok(text.includes(code), `openapi.yaml 里没有错误码 ${code}`);
});

test("请求体：页面发的字段都是接口认的，接口必填的页面都发；坐标是经度、纬度两个数", () => {
  const request = schemas["PlatformQuotePreviewRequest"];
  const known = props(request);
  for (const field of QUOTE_SCHEMA_FIELDS.PlatformQuotePreviewRequest) assert.ok(known.includes(field), `接口不认 ${field}`);
  for (const field of request?.required ?? []) assert.ok((QUOTE_SCHEMA_FIELDS.PlatformQuotePreviewRequest as readonly string[]).includes(field), `页面没有发必填的 ${field}`);
  const point = schemas["Point"];
  assert.deepEqual(props(point), ["lat", "lng"]);
  assert.deepEqual(sorted(point?.required ?? []), ["lat", "lng"]);
  assert.deepEqual(request?.properties?.["direction"]?.enum, ["pickup", "dropoff", null]);
  assert.deepEqual(props(schemas["QuoteRouteEstimate"]), sorted(QUOTE_SCHEMA_FIELDS.QuoteRoute));
});

test("路线情况（M2-02）：字段、状态、来源和页面用的一一对上；原因码就是 QuoteRouteFailureCode", () => {
  assert.equal(ref(schemas["PlatformQuotePreview"]?.properties?.["route_status"]), "QuoteRouteStatus");
  const status = schemas["QuoteRouteStatus"];
  assert.deepEqual(props(status), sorted(QUOTE_SCHEMA_FIELDS.QuoteRouteStatus));
  assert.deepEqual(sorted(status?.required ?? []), sorted(QUOTE_SCHEMA_FIELDS.QuoteRouteStatus));
  assert.deepEqual(status?.properties?.["status"]?.enum, ["not_needed", "assumed", "ok", "unavailable"]);
  assert.deepEqual(status?.properties?.["source"]?.enum, [...Object.keys(ROUTE_SOURCE_TEXT), null]);
  assert.equal(ref(status?.properties?.["code"]?.oneOf?.[0]), "QuoteRouteFailureCode");
});

test("应答：每个车型组的中标、全部候选、报不出价的商品——字段和页面用的一一对上", () => {
  const result = schemas["PlatformQuotePreview"];
  assert.deepEqual(props(result), sorted(QUOTE_SCHEMA_FIELDS.PlatformQuotePreview));
  const group = result?.properties?.["groups"]?.items;
  assert.deepEqual(props(group), sorted(QUOTE_SCHEMA_FIELDS.QuoteGroup));
  assert.deepEqual(props(group?.properties?.["winner"]), sorted(QUOTE_SCHEMA_FIELDS.QuoteWinner));
  const candidate = group?.properties?.["candidates"]?.items;
  assert.deepEqual(props(candidate), sorted(QUOTE_SCHEMA_FIELDS.QuoteCandidate));
  assert.deepEqual(sorted(candidate?.required ?? []), sorted(QUOTE_SCHEMA_FIELDS.QuoteCandidate));
  assert.equal(ref(candidate?.properties?.["offer"]), "QuoteOffer");
  assert.deepEqual(props(candidate?.properties?.["fx"]), ["as_of", "from", "lock", "rate", "to"]);
  assert.deepEqual(props(schemas["QuoteOffer"]), sorted(QUOTE_SCHEMA_FIELDS.QuoteOffer));
  assert.equal(ref(schemas["QuoteOffer"]?.properties?.["settlement"]), "QuoteSettlement");
  const settlement = schemas["QuoteSettlement"];
  assert.deepEqual(props(settlement), sorted(QUOTE_SCHEMA_FIELDS.QuoteSettlement));
  assert.deepEqual(sorted(settlement?.required ?? []), sorted(QUOTE_SCHEMA_FIELDS.QuoteSettlement));
  assert.deepEqual(props(settlement?.properties?.["exact"]), ["addons", "adjusted", "base", "night", "total"]);
  assert.deepEqual(props(settlement?.properties?.["free_wait"]), ["item", "minutes", "mode", "platform_minimum_minutes"]);
  assert.deepEqual(props(result?.properties?.["channel"]), sorted(QUOTE_SCHEMA_FIELDS.QuoteChannel));
  assert.deepEqual(props(result?.properties?.["excluded"]?.items), sorted(QUOTE_SCHEMA_FIELDS.QuoteExcluded));
  const refused = result?.properties?.["refused"]?.items;
  assert.deepEqual(props(refused), sorted(QUOTE_SCHEMA_FIELDS.QuoteRefusal));
  assert.deepEqual(sorted(refused?.required ?? []), sorted(QUOTE_SCHEMA_FIELDS.QuoteRefusal));
  assert.equal(ref(refused?.properties?.["reason"]), "QuoteRefusalReason");
  assert.equal(refused?.properties?.["message"]?.type, "string", "页面直接显示后端写好的中文原因");
});

test("报不出价的原因：接口列的和 @nozomi/domain 的一致（另有平台比价才有的两个）", () => {
  const reasons = schemas["QuoteRefusalReason"]?.enum ?? [];
  assert.deepEqual(sorted(reasons as string[]), sorted([...QUOTE_REFUSALS, "FX_RATE_UNAVAILABLE", "SELL_PRICE_OVER_LIMIT"]));
});

test("接送点的选项：地点选项接口（M4-13）可以一次按机场和车站取，按城市取", () => {
  const places = spec.paths["/platform/v1/place-options"]?.["get"];
  const names = (places?.parameters ?? []).map((parameter) => parameter.name);
  assert.deepEqual([...names].sort(), ["city_id", "type"]);
  assert.match(JSON.stringify(places?.parameters), /airport,station/);
});

test("权限：quote.preview 只给超级管理员、运营、招商、渠道经理、客服（ADR 0020 待定事项 10）", () => {
  assert.ok(schemas["PlatformAction"]?.enum?.includes("quote.preview"));
  const allowed: PlatformRole[] = ["super_admin", "operations", "tenant_onboarding", "channel_manager", "customer_service"];
  const denied: PlatformRole[] = ["finance", "risk", "master_data", "tech", "readonly"];
  for (const role of allowed) assert.ok(platformRoleCan(role, "quote.preview"), `${role} 应能试算`);
  for (const role of denied) assert.ok(!platformRoleCan(role, "quote.preview"), `${role} 不能试算`);
});
