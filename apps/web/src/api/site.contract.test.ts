/** 官网接口（`/site/v1`）的手写类型与 `apps/api/openapi.yaml` 对账：后端改了路径、字段，这里会失败。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { API_PATH_PREFIXES } from "../lib/api-prefixes.ts";
import { UNAVAILABLE_REASON_TEXT } from "../lib/site-display.ts";
import { SITE_BASE, SITE_ROUTE_MAP_LIMITS, siteRouteMapUrl, SITE_FX_REFERENCE_FIELDS, SITE_BY_POINTS_REQUEST_FIELDS, SITE_BY_POINTS_RESULT_FIELDS, SITE_ORDER_FIELDS, SITE_ORDER_REQUEST_FIELDS, SITE_ORDER_VEHICLE_GROUP_FIELDS, SITE_QUOTE_REQUEST_FIELDS, SITE_SCHEMA_FIELDS, SITE_TRIP_END_FIELDS, SITE_MANUAL_QUOTE_PATH, SITE_MANUAL_QUOTE_REQUEST_FIELDS, SITE_MANUAL_QUOTE_TRIP_FIELDS, SITE_TRIPS_PATH, SITE_TRIP_CREATED_FIELDS, SITE_TRIP_DAY_FIELDS, SITE_TRIP_FEE_FIELDS, SITE_TRIP_FIELDS, SITE_TRIP_ITEM_FIELDS, SITE_TRIP_ITEM_KINDS, SITE_TRIP_ITINERARY_FIELDS, SITE_TRIP_PARTY_FIELDS, SITE_TRIP_PLAN_DAY_FIELDS, SITE_TRIP_PLAN_FIELDS, SITE_TRIP_PLAN_KINDS, SITE_TRIP_SEGMENT_FIELDS, SITE_TRIP_UNQUOTED_FIELDS, SITE_TRIP_ORDER_QUOTE_FIELDS, SITE_TRIP_ORDER_QUOTE_REQUEST_FIELDS, siteTripOrderQuotePath, SITE_TRIP_PARSE_PATH, SITE_TRIP_PARSE_STATUS_PATH, SITE_TRIP_PARSE_STATUS_FIELDS, SITE_TRIP_PARSE_RESULT_FIELDS, SITE_TRIP_PARSE_DRAFT_FIELDS, SITE_TRIP_PARSE_DAY_FIELDS, SITE_TRIP_PARSE_PLACE_FIELDS, SITE_TRIP_PARSE_POINT_FIELDS } from "./site.ts";

interface Schema {
  $ref?: string;
  type?: string | string[];
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  oneOf?: Schema[];
  allOf?: Schema[];
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
    ["get", `${SITE_BASE}/places/by-code`],
    ["get", `${SITE_BASE}/places/reverse`],
    ["get", `${SITE_BASE}/places/autocomplete`],
    ["get", `${SITE_BASE}/places/details`],
    ["post", `${SITE_BASE}/quotes`],
    ["post", `${SITE_BASE}/quotes/by-points`],
    ["get", `${SITE_BASE}/fx/reference`],
    ["get", `${SITE_BASE}/booking-drafts/{id}`],
    ["get", `${SITE_BASE}/route-map`],
    ["get", `${SITE_BASE}/itinerary-map`],
    ["get", `${SITE_BASE}/itinerary-legs`],
    ["post", `${SITE_BASE}/charter/order-suggestion`],
    ["post", `${SITE_BASE}/orders`],
    ["post", `${SITE_BASE}/orders/lookup`],
    ["post", SITE_MANUAL_QUOTE_PATH],
    ["post", SITE_TRIPS_PATH],
    ["get", `${SITE_TRIPS_PATH}/{id}`],
    ["post", `${SITE_TRIPS_PATH}/{id}/quote`],
    ["post", `${SITE_TRIPS_PATH}/{id}/plans/{planId}/order-quote`],
    ["get", SITE_TRIP_PARSE_STATUS_PATH],
    ["post", SITE_TRIP_PARSE_PATH],
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
  const group = schemas["SiteOrderNames"]?.properties?.["vehicle_group"]?.oneOf?.[0];
  assert.deepEqual(props(group), sorted(SITE_ORDER_VEHICLE_GROUP_FIELDS), "订单页的车型组带车型标识的来源（M7-02）");
  assert.deepEqual(sorted(group?.required ?? []), sorted(SITE_ORDER_VEHICLE_GROUP_FIELDS), "订单页的车型组的必填字段");
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
  // M8-45：多了只在「这个地址今天的额度用完了」时出现的 unavailable_reason（不是必有的字段）
  assert.deepEqual(props(spec200(`${SITE_BASE}/places/search`)), ["available", "items", "unavailable_reason"]);
  assert.deepEqual(props(spec200(`${SITE_BASE}/places/reverse`)), ["address", "available", "unavailable_reason"]);
  assert.deepEqual(schemas["SitePlaceUnavailableReason"]?.enum, ["IP_DAILY_LIMIT"]);
  for (const path of ["search", "reverse", "autocomplete", "details"]) assert.ok(!(spec200(`${SITE_BASE}/places/${path}`)?.required ?? []).includes("unavailable_reason"), path);
  assert.deepEqual(props(schemas["SitePlaceCandidate"]), ["address", "id", "kind", "location", "name", "source"]);
  for (const schema of [spec200(`${SITE_BASE}/places/search`), spec200(`${SITE_BASE}/places/reverse`), schemas["SitePlaceCandidate"], schemas["SiteConfig"]]) {
    // 唯一的例外：浏览器加载谷歌地图用的密钥（M10-01 第 2 处），在谷歌后台限定了网址和 API，本来就要给浏览器；服务器用的密钥永远不出现
    assert.deepEqual(props(schema).filter((key) => /key|secret|token|google|raw/i.test(key) && !(schema === schemas["SiteConfig"] && key === "maps_browser_key")), []);
  }
  assert.equal(schemas["SiteConfig"]?.properties?.["map_tiles"]?.$ref, "#/components/schemas/MapConfig/properties/tiles");
});

test("按两个坐标报价、输入即提示（M8-02）：请求和应答的字段与 openapi.yaml 一致；应答里没有结算价、加价比例、中标供应商，也没有像密钥、谷歌原文的字段", () => {
  const post200 = (path: string): Schema | undefined => (spec.paths[path]?.["post"] as unknown as { responses: Record<string, { content: Record<string, { schema: Schema }> }> }).responses["200"]?.content["application/json"]?.schema;
  const get200 = (path: string): Schema | undefined => (spec.paths[path]?.["get"] as unknown as { responses: Record<string, { content: Record<string, { schema: Schema }> }> }).responses["200"]?.content["application/json"]?.schema;
  assert.deepEqual(props(schemas["SiteByPointsRequest"]), sorted(SITE_BY_POINTS_REQUEST_FIELDS));
  assert.deepEqual(props(schemas["SiteTripEnd"]), sorted(SITE_TRIP_END_FIELDS));
  const result = post200(`${SITE_BASE}/quotes/by-points`);
  assert.deepEqual(props(result), sorted(SITE_BY_POINTS_RESULT_FIELDS));
  assert.deepEqual(sorted(result?.required ?? []), sorted(SITE_BY_POINTS_RESULT_FIELDS));
  assert.deepEqual(result?.properties?.["trip_type"]?.enum, ["pickup", "dropoff", "point_to_point"]);
  assert.deepEqual(props(get200(`${SITE_BASE}/places/autocomplete`)), ["available", "items", "unavailable_reason"]);
  assert.deepEqual(props(get200(`${SITE_BASE}/places/details`)), ["available", "place", "unavailable_reason"]);
  assert.deepEqual(schemas["SitePlaceKind"]?.enum, ["airport", "other"]);
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
  for (const schema of [result, get200(`${SITE_BASE}/places/autocomplete`), get200(`${SITE_BASE}/places/details`)]) walk(schema, new Set());
  assert.ok(keys.has("route") && keys.has("polyline") && keys.has("kind"));
  assert.deepEqual([...keys].filter((key) => /settlement|markup|tenant_id|secret|key$|token|google|raw/i.test(key)), []);
});

test("附加服务、参考汇率（M8-02）：报价只给可加的附加服务的目录信息，没有任何单价；参考汇率的字段与 openapi.yaml 一致", () => {
  assert.deepEqual(props(schemas["SiteAddonOption"]), ["charge_unit", "code", "id", "name"]);
  assert.deepEqual(props(schemas["SiteAddonRequest"]), ["addon_id", "quantity"]);
  assert.equal(schemas["SiteQuote"]?.properties?.["available_addons"]?.items?.$ref, "#/components/schemas/SiteAddonOption");
  assert.equal(schemas["SiteByPointsRequest"]?.properties?.["addons"]?.items?.$ref, "#/components/schemas/SiteAddonRequest");
  const fx = (spec.paths[`${SITE_BASE}/fx/reference`]?.["get"] as unknown as { responses: Record<string, { content: Record<string, { schema: Schema }> }> }).responses["200"]?.content["application/json"]?.schema;
  assert.deepEqual(props(fx), sorted(SITE_FX_REFERENCE_FIELDS));
  assert.deepEqual(sorted(fx?.required ?? []), sorted(SITE_FX_REFERENCE_FIELDS));
});

test("路线小地图（M8-10）：前端发的查询参数正好是接口定义的那几个，尺寸范围、主题、倍率和接口一致", () => {
  interface Parameter {
    name: string;
    in: string;
    required?: boolean;
    schema?: { minimum?: number; maximum?: number; enum?: (string | number)[] };
  }
  const operation = spec.paths[`${SITE_BASE}/route-map`]?.["get"] as (Operation & { parameters?: Parameter[] }) | undefined;
  const parameters = new Map((operation?.parameters ?? []).filter((parameter) => parameter.in === "query").map((parameter) => [parameter.name, parameter]));
  const sent = new URL(siteRouteMapUrl({ from: { lat: 35.7, lng: 139.7 }, to: { lat: 35.6, lng: 139.8 }, theme: "dark", width: 300, height: 200, scale: 2 }), "http://localhost").searchParams;
  assert.deepEqual([...sent.keys()].sort(), [...parameters.keys()].sort(), "多余的参数后端回 400");
  for (const [name, parameter] of parameters) if (parameter.required === true) assert.ok(sent.has(name), name);
  assert.deepEqual([parameters.get("width")?.schema?.minimum, parameters.get("width")?.schema?.maximum], [SITE_ROUTE_MAP_LIMITS.minWidth, SITE_ROUTE_MAP_LIMITS.maxWidth]);
  assert.deepEqual([parameters.get("height")?.schema?.minimum, parameters.get("height")?.schema?.maximum], [SITE_ROUTE_MAP_LIMITS.minHeight, SITE_ROUTE_MAP_LIMITS.maxHeight]);
  assert.deepEqual(parameters.get("theme")?.schema?.enum, ["light", "dark"]);
  assert.deepEqual(parameters.get("scale")?.schema?.enum, [1, 2]);
  const error = schemas["RouteMapUnavailable"]?.properties?.["error"];
  assert.deepEqual(error?.properties?.["code"]?.enum, ["ROUTE_MAP_UNAVAILABLE"]);
  assert.deepEqual(error?.properties?.["details"]?.properties?.["reason"]?.enum, ["NOT_ENABLED", "UNAVAILABLE"], "页面只认 NOT_ENABLED（退回底图），其余只写字");
});

test("人工报价申请（M8-21）：请求体和行程的字段与 openapi.yaml 一致；只收邮箱、WhatsApp 两项联系方式；应答一律 202", () => {
  const operation = spec.paths[SITE_MANUAL_QUOTE_PATH]?.["post"] as unknown as { requestBody: { content: Record<string, { schema: Schema }> }; responses: Record<string, unknown> };
  const body = operation.requestBody.content["application/json"]?.schema;
  assert.deepEqual(props(body), sorted(SITE_MANUAL_QUOTE_REQUEST_FIELDS));
  assert.deepEqual(props(schemas["ManualQuoteTripInput"]), sorted(SITE_MANUAL_QUOTE_TRIP_FIELDS));
  assert.deepEqual(props(body).filter((key) => /name|phone|note/i.test(key)), [], "不收姓名、电话、备注");
  assert.ok(operation.responses["202"]);
  assert.equal(operation.responses["200"], undefined);
});

test("包车行程逐段的时长和里程（M9P-20）：应答字段和 openapi.yaml 一致", () => {
  const schema = (spec.paths[`${SITE_BASE}/itinerary-legs`]?.["get"] as unknown as { responses: Record<string, { content: Record<string, { schema: Schema }> }> }).responses["200"]?.content["application/json"]?.schema;
  assert.deepEqual(props(schema), ["available", "legs"]);
  assert.deepEqual(props(schema?.properties?.["legs"]?.items), ["meters", "minutes"]);
});

test("行程报价（M9T-03 / M9T-09）：建行程单的请求体、应答，读行程单 / 报价的应答逐层和 openapi.yaml 一致；对客应答没有结算价、加价比例、供应商编号", () => {
  interface Responses {
    requestBody?: { content: Record<string, { schema: Schema }> };
    responses: Record<string, { content?: Record<string, { schema: Schema }> }>;
  }
  const op = (method: string, path: string): Responses => spec.paths[path]?.[method] as unknown as Responses;
  const ref = (schema: Schema | undefined): Schema | undefined => (schema?.$ref === undefined ? schema : schemas[schema.$ref.replace("#/components/schemas/", "")]);
  assert.equal(SITE_TRIPS_PATH, `${SITE_BASE}/trips`);

  // 请求体：标准行程单（camelCase）
  const body = ref(op("post", SITE_TRIPS_PATH).requestBody?.content["application/json"]?.schema);
  assert.equal(body, schemas["TripItinerary"]);
  assert.deepEqual(props(body), sorted(SITE_TRIP_ITINERARY_FIELDS));
  assert.deepEqual(sorted(body?.required ?? []), ["days", "party", "schemaVersion"]);
  assert.deepEqual(body?.properties?.["schemaVersion"]?.enum, [1]);
  assert.deepEqual(props(body?.properties?.["party"]), sorted(SITE_TRIP_PARTY_FIELDS));
  assert.deepEqual(body?.properties?.["party"]?.required, ["adults"]);
  const day = body?.properties?.["days"]?.items;
  assert.deepEqual(props(day), sorted(SITE_TRIP_DAY_FIELDS));
  assert.deepEqual(sorted(day?.required ?? []), ["date", "items"]);
  const item = day?.properties?.["items"]?.items;
  assert.deepEqual(props(item), sorted(SITE_TRIP_ITEM_FIELDS));
  assert.deepEqual(sorted(item?.required ?? []), ["kind", "place"]);
  assert.deepEqual(item?.properties?.["kind"]?.enum, [...SITE_TRIP_ITEM_KINDS]);
  const places = item?.properties?.["place"]?.oneOf ?? [];
  assert.deepEqual(places.map((place) => props(place)), [["placeId"], ["kind", "lat", "lng"]], "平台地点或坐标（可带种类）");
  assert.deepEqual(places[1]?.properties?.["kind"]?.enum, ["hotel", "poi", "address"]);
  assert.deepEqual(props(day?.properties?.["nightAt"]), ["lat", "lng"]);

  // 建好的应答
  const created = op("post", SITE_TRIPS_PATH).responses["201"]?.content?.["application/json"]?.schema;
  assert.deepEqual(props(created), sorted(SITE_TRIP_CREATED_FIELDS));
  assert.deepEqual(sorted(created?.required ?? []), sorted(SITE_TRIP_CREATED_FIELDS));

  // 读行程单、报价：同一份 SiteTrip
  for (const [method, path] of [["get", `${SITE_TRIPS_PATH}/{id}`], ["post", `${SITE_TRIPS_PATH}/{id}/quote`]] as const) {
    assert.equal(op(method, path).responses["200"]?.content?.["application/json"]?.schema?.$ref, "#/components/schemas/SiteTrip", path);
  }
  assert.ok(op("post", `${SITE_TRIPS_PATH}/{id}/quote`).responses["422"], "太复杂 422 TRIP_TOO_COMPLEX");
  assert.ok(op("post", `${SITE_TRIPS_PATH}/{id}/quote`).responses["429"], "限频 429");
  const trip = schemas["SiteTrip"];
  assert.deepEqual(props(trip), sorted(SITE_TRIP_FIELDS));
  assert.deepEqual(sorted(trip?.required ?? []), sorted(SITE_TRIP_FIELDS));
  assert.equal(trip?.properties?.["itinerary"]?.$ref, "#/components/schemas/TripItinerary");
  const plan = trip?.properties?.["plans"]?.items;
  assert.deepEqual(props(plan), sorted(SITE_TRIP_PLAN_FIELDS));
  assert.deepEqual(sorted(plan?.required ?? []), sorted(SITE_TRIP_PLAN_FIELDS));
  assert.deepEqual(plan?.properties?.["kind"]?.enum, [...SITE_TRIP_PLAN_KINDS]);
  assert.deepEqual(props(plan?.properties?.["vehicle_group"]?.oneOf?.[0]), ["code", "id", "name", "seats"]);
  assert.deepEqual(plan?.properties?.["warnings"]?.items?.properties?.["code"]?.enum, ["SECOND_DRIVER", "SEGMENT_OTHER_VEHICLE", "WORK_HOURS_HARD_LIMIT"]);
  const planDay = plan?.properties?.["days"]?.items;
  assert.deepEqual(props(planDay), sorted(SITE_TRIP_PLAN_DAY_FIELDS));
  assert.deepEqual(sorted(planDay?.required ?? []), sorted(SITE_TRIP_PLAN_DAY_FIELDS));
  const segment = planDay?.properties?.["segments"]?.items;
  assert.deepEqual(props(segment), sorted(SITE_TRIP_SEGMENT_FIELDS));
  assert.deepEqual(sorted(segment?.required ?? []), sorted(SITE_TRIP_SEGMENT_FIELDS));
  assert.deepEqual(segment?.properties?.["type"]?.enum, ["airport_pickup", "airport_dropoff", "p2p", "charter", "idle_day"]);
  assert.equal(planDay?.properties?.["fees"]?.items?.$ref, "#/components/schemas/SiteTripFee");
  // 按晚算的费用：SiteTripFee 加一个 night_index
  const nightFee = plan?.properties?.["fees"]?.items;
  assert.equal(nightFee?.allOf?.[0]?.$ref, "#/components/schemas/SiteTripFee");
  assert.deepEqual(props(nightFee), ["night_index"]);
  assert.deepEqual(props(schemas["SiteTripFee"]), sorted(SITE_TRIP_FEE_FIELDS));
  assert.deepEqual(sorted(schemas["SiteTripFee"]?.required ?? []), sorted(SITE_TRIP_FEE_FIELDS));
  assert.deepEqual(schemas["SiteTripFee"]?.properties?.["type"]?.enum, ["lodging", "lodging_offset", "idle", "second_driver", "bundle_discount", "return"]);
  const unquoted = trip?.properties?.["unquoted"]?.items;
  assert.deepEqual(props(unquoted), sorted(SITE_TRIP_UNQUOTED_FIELDS));
  assert.deepEqual(sorted(unquoted?.required ?? []), sorted(SITE_TRIP_UNQUOTED_FIELDS));
  assert.deepEqual(unquoted?.properties?.["plan_kind"]?.enum, [...SITE_TRIP_PLAN_KINDS]);

  // 对客：整棵 SiteTrip 里没有结算价、加价比例、供应商编号
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
    for (const option of [...(schema.oneOf ?? []), ...(schema.allOf ?? [])]) walk(option, seen);
  };
  walk(trip, new Set(["SiteTrip"]));
  assert.ok(keys.has("plans") && keys.has("segments") && keys.has("price_breakdown"));
  assert.deepEqual([...keys].filter((key) => /settlement|markup|tenant_id|product_id|secret/i.test(key)), []);
});

test("行程下单出口（M9T-10）：请求体、应答字段和 openapi.yaml 一致；报价就是 SiteQuote、询价条件就是 SiteQuoteRequest；对客应答没有结算价、加价比例、供应商编号", () => {
  interface Responses {
    requestBody?: { required?: boolean; content: Record<string, { schema: Schema }> };
    responses: Record<string, { content?: Record<string, { schema: Schema }> }>;
  }
  const path = `${SITE_TRIPS_PATH}/{id}/plans/{planId}/order-quote`;
  assert.equal(siteTripOrderQuotePath("{id}", "{planId}").replaceAll("%7B", "{").replaceAll("%7D", "}"), path);
  const operation = spec.paths[path]?.["post"] as unknown as Responses;
  assert.notEqual(operation.requestBody?.required, true, "请求体可以不带");
  assert.deepEqual(props(operation.requestBody?.content["application/json"]?.schema), sorted(SITE_TRIP_ORDER_QUOTE_REQUEST_FIELDS));
  assert.equal(operation.responses["200"]?.content?.["application/json"]?.schema?.$ref, "#/components/schemas/SiteTripOrderQuote");
  for (const status of ["404", "409", "429"]) assert.ok(operation.responses[status], `${status} 要有定义`);
  const schema = schemas["SiteTripOrderQuote"];
  assert.deepEqual(props(schema), sorted(SITE_TRIP_ORDER_QUOTE_FIELDS));
  assert.deepEqual(sorted(schema?.required ?? []), sorted(SITE_TRIP_ORDER_QUOTE_FIELDS));
  assert.equal(schema?.properties?.["quote"]?.$ref, "#/components/schemas/SiteQuote");
  assert.equal(schema?.properties?.["quote_request"]?.$ref, "#/components/schemas/SiteQuoteRequest");
  assert.equal(schema?.properties?.["itinerary_route"]?.oneOf?.[1]?.$ref, "#/components/schemas/SiteItineraryRoute");
  const keys = [...props(schema), ...props(schemas["SiteQuote"])];
  assert.deepEqual(keys.filter((key) => /settlement|markup|tenant|product_id|secret/i.test(key)), []);
});

test("AI 一句话行程（M9T-33）：parse-status / parse 的请求体、应答各层字段和 openapi.yaml 一致；页面认的提示代码都在枚举里", () => {
  interface Operation2 {
    requestBody?: { content: Record<string, { schema: Schema }> };
    responses: Record<string, { content?: Record<string, { schema: Schema }>; $ref?: string }>;
  }
  const op = (method: string, path: string): Operation2 => spec.paths[path]?.[method] as unknown as Operation2;
  assert.equal(SITE_TRIP_PARSE_STATUS_PATH, `${SITE_TRIPS_PATH}/parse-status`);
  assert.equal(SITE_TRIP_PARSE_PATH, `${SITE_TRIPS_PATH}/parse`);

  const status = op("get", SITE_TRIP_PARSE_STATUS_PATH).responses["200"]?.content?.["application/json"]?.schema;
  assert.deepEqual(props(status), sorted(SITE_TRIP_PARSE_STATUS_FIELDS));
  assert.deepEqual(sorted(status?.required ?? []), sorted(SITE_TRIP_PARSE_STATUS_FIELDS));
  assert.deepEqual(status?.properties?.["reason"]?.enum, ["DAILY_LIMIT", null]);

  const request = op("post", SITE_TRIP_PARSE_PATH).requestBody?.content["application/json"]?.schema;
  assert.deepEqual(props(request), ["lang", "text"]);
  assert.deepEqual(request?.properties?.["lang"]?.enum, ["zh", "ja", "en"]);
  for (const code of ["400", "422", "429", "503"]) assert.ok(op("post", SITE_TRIP_PARSE_PATH).responses[code], `parse ${code}`);

  const result = schemas["TripParseResult"];
  assert.equal(op("post", SITE_TRIP_PARSE_PATH).responses["200"]?.content?.["application/json"]?.schema?.$ref, "#/components/schemas/TripParseResult");
  assert.deepEqual(props(result), sorted(SITE_TRIP_PARSE_RESULT_FIELDS), "没有 texts：对客文案只在前端");
  const draft = result?.properties?.["draft"];
  assert.deepEqual(props(draft), sorted(SITE_TRIP_PARSE_DRAFT_FIELDS));
  const day = draft?.properties?.["days"]?.items;
  assert.deepEqual(props(day), sorted(SITE_TRIP_PARSE_DAY_FIELDS));
  assert.equal(day?.properties?.["stops"]?.items?.$ref, "#/components/schemas/TripParsePlace");
  const place = schemas["TripParsePlace"];
  assert.deepEqual(props(place), sorted(SITE_TRIP_PARSE_PLACE_FIELDS));
  assert.deepEqual(
    (place?.properties?.["match"]?.oneOf ?? []).map((option) => option.properties?.["status"]?.enum?.[0]),
    ["resolved", "ambiguous", "unresolved"],
  );
  const point = schemas["TripParsePoint"];
  assert.deepEqual(props(point), sorted(SITE_TRIP_PARSE_POINT_FIELDS));
  assert.deepEqual(point?.properties?.["kind"]?.enum, ["airport", null], "填进表单的种类只有机场 / 其他");

  // 页面按代码拼文案：服务端会给的代码，页面都有说法（认不出的有通用说法，这里只核对已知的）
  const codes = (field: string): string[] => result?.properties?.[field]?.items?.properties?.["code"]?.enum ?? [];
  assert.deepEqual(codes("assumptions"), ["DATE_FROM_RELATIVE", "DATE_YEAR_INFERRED", "STAY_OFF_GRID"]);
  assert.deepEqual(codes("unused"), ["FLIGHT_NUMBER", "CHARTER_HOURS", "VEHICLE_TYPE", "DRIVER_LANGUAGE", "CHILD_SEAT", "OTHER_REQUEST"]);
  assert.deepEqual(codes("out_of_scope"), ["BUS", "ACCESSIBLE_VEHICLE", "OVERSEAS", "OTHER"]);
});
