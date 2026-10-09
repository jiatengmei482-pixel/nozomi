/**
 * M1-03：子品牌和商品接口的实际行为和 apps/api/openapi.yaml 逐字段对账（测试工程师）。
 * 主数据、区域各有一份同类的测试；商品的 16 个接口此前没有——openapi.test.ts 只核对「有哪些路径」。这里核对内容：
 * - 每个接口实际返回的 JSON 逐字段符合定义里的结构（必填、类型、枚举、不多不少），成功和各种失败都算；
 * - 实际会返回的错误状态码、错误码都写在了定义里；VALIDATION_FAILED 的每个原因代码都在 ProductInvalid 的说明里，定义也没有多写；
 * - 上架校验实际给出的原因代码都在定义的说明里；
 * - 定义里的请求字段、必填项、枚举值、条数和长度上限和实现一致。
 * 测试数据都在这里构造，结束时连同 schema 一起删除。不联网。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { CURRENCIES, DRIVER_LANGUAGES, NIGHT_CHARGE_UNITS, PRODUCT_LIMITS, PRODUCT_STATUSES, PUBLISH_CHECK_KEYS, SERVICE_CATEGORIES } from "@nozomi/domain";
import { type ApiResponse, type HttpMethod, type TenantFixture, type TestApi, addTenantUser, createTestApi } from "./testing/api.ts";

type Schema = Record<string, any>;
interface Operation {
  parameters?: Schema[];
  requestBody?: { content: { "application/json": { schema: Schema } } };
  responses: Record<string, Schema>;
  description?: string;
}

const doc = parse(await readFile(new URL("../openapi.yaml", import.meta.url), "utf8")) as {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema>; parameters: Record<string, Schema>; responses: Record<string, Schema> };
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
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

/** 按定义检查一个值，返回不符合的地方。只实现了商品相关的定义用到的那些关键字。 */
function violations(schemaNode: Schema, value: unknown, path = ""): string[] {
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

let api: TestApi;
let root: string;
let tenant: TenantFixture;
const ids: Record<string, string> = {};
const MISSING = "99999999-9999-4999-8999-999999999999";

const BRANDS = "/tenant/v1/brands";
const BRAND = "/tenant/v1/brands/{id}";
const PRODUCTS = "/tenant/v1/products";
const ONE = "/tenant/v1/products/{id}";
const RULES = `${ONE}/service-rules`;
const CONTENT = `${ONE}/content`;
const CHECK = `${ONE}/publish-check`;
const PRODUCT_OPERATIONS = [
  `GET ${BRANDS}`, `POST ${BRANDS}`, `PUT ${BRAND}`,
  `GET ${PRODUCTS}`, `POST ${PRODUCTS}`, `GET ${ONE}`, `PATCH ${ONE}`, `DELETE ${ONE}`,
  `GET ${RULES}`, `PUT ${RULES}`, `GET ${CONTENT}`, `PUT ${CONTENT}`, `GET ${CHECK}`, `POST ${ONE}/publish`, `POST ${ONE}/unpublish`,
];

const exercised = new Set<string>();
/** 实际见过的 VALIDATION_FAILED 原因代码、上架校验原因代码。 */
const invalidReasons = new Set<string>();
const checkReasons = new Set<string>();

interface Options {
  id?: string;
  query?: string;
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/** 调一次接口，并按定义核对这次应答：状态码写在了定义里；应答内容符合那个状态码下的结构；错误码在说明里提到了。 */
async function call(method: HttpMethod, template: string, options: Options = {}): Promise<ApiResponse> {
  const url = template.replace("{id}", options.id ?? "") + (options.query ? `?${options.query}` : "");
  const res = await api.call(method, url, { token: options.token ?? tenant.adminToken, ...(options.body === undefined ? {} : { body: options.body }), ...(options.headers === undefined ? {} : { headers: options.headers }) });
  const operation = doc.paths[template]?.[method.toLowerCase()];
  assert.ok(operation, `定义里没有 ${method} ${template}`);
  exercised.add(`${method} ${template}`);
  if (res.status === 204) {
    assert.ok(operation.responses["204"], `${method} ${template} 返回了 204，定义里没有写`);
    assert.equal(res.text, "");
    return res;
  }
  if (res.status === 400 && res.body?.error?.code === "VALIDATION_FAILED") for (const issue of res.body.error.details.issues ?? []) if (issue.reason !== undefined) invalidReasons.add(issue.reason);
  const items = res.status === 200 && template === CHECK ? res.body.items : res.body?.error?.code === "PUBLISH_CHECK_FAILED" ? res.body.error.details.items : [];
  for (const item of items) for (const issue of item.issues) checkReasons.add(issue.reason);
  // 401、403 是所有需要登录的接口共有的，定义在总说明里，不在每个接口下重复；400 只有写了的接口才逐个核对
  if ([401, 403].includes(res.status) || (res.status === 400 && !operation.responses["400"])) {
    assert.deepEqual(violations(doc.components.schemas["ErrorResponse"] as Schema, res.body), [], res.text);
    return res;
  }
  const documented = operation.responses[String(res.status)];
  assert.ok(documented, `${method} ${template} 实际返回了 ${res.status}（${res.body?.error?.code ?? ""}），定义里没有写这个状态码`);
  const schema = deref(documented)["content"]?.["application/json"]?.["schema"];
  assert.ok(schema, `${method} ${template} 的 ${res.status} 在定义里没有写返回结构`);
  assert.deepEqual(violations(schema, res.body), [], `${method} ${url} 的 ${res.status} 应答不符合定义：${res.text.slice(0, 400)}`);
  if (res.status >= 400) {
    const described = String(deref(documented)["description"] ?? "");
    assert.ok(described.includes(res.body.error.code), `${method} ${template} 的 ${res.status} 实际错误码是 ${res.body.error.code}，定义的说明里没有提到它：${described.slice(0, 200)}`);
  }
  return res;
}

const key = (): Record<string, string> => ({ "idempotency-key": randomUUID() });
const ifMatch = (version: number): Record<string, string> => ({ "if-match": `"${version}"` });
const platform = async (path: string, body: unknown, method: HttpMethod = "POST", version?: number): Promise<any> => {
  const res = await api.call(method, `/platform/v1/master/${path}`, { token: root, ...(body === undefined ? {} : { body }), ...(version === undefined ? {} : { headers: ifMatch(version) }) });
  assert.ok(res.status === 200 || res.status === 201, res.text);
  return res.body;
};
const base = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ brand_id: ids["brand"], city_id: ids["tokyo"], category: "airport_transfer", poi_id: ids["narita"], ...extra });
const FULL_RULES = (): Record<string, unknown> => ({
  booking: { sale_from: "2026-10-01", sale_to: "2027-03-31", service_time: { start: "20:00", end: "04:00" }, lead_time_hours: 24, note: "内部备忘" },
  urgent: { enabled: true, daily_quota: 5, tiers: [{ within_hours: 12, surcharge: 2000 }, { within_hours: 6, surcharge: 5000 }] },
  night: { enabled: true, window: { start: "22:00", end: "06:00" }, amount: 3000, charge_unit: "per_order" },
  free_wait: { pickup: { mode: "limited", minutes: 90 }, dropoff: { mode: "unlimited" } },
  addons: [{ addon_id: ids["seat"], enabled: true, unit_price: 1000, first_free: true }, { addon_id: ids["sign"], enabled: false, unit_price: 0, first_free: false }],
  driver_languages: [{ language: "zh", unit_price: 5000 }, { language: "en", unit_price: 0 }],
});
const FULL_CONTENT = { zh: { title: "成田机场接送", summary: "简介", includes: ["司机", "油费"], excludes: ["高速费"], itinerary: null, pickup_guide: "到达大厅 3 号门" }, ja: { title: "成田空港送迎" }, en: { title: "Narita transfer", pickup_guide: "Gate 3" }, ko: { summary: "요약" } };
let serial = 0;
async function newArea(extra: Record<string, unknown> = {}): Promise<any> {
  api.clock.advance(1_000);
  const res = await api.call("POST", "/tenant/v1/areas", {
    token: tenant.adminToken,
    headers: key(),
    body: { city_id: ids["tokyo"], name: { zh: `对账区域 ${(serial += 1)}` }, biz_type: "general", polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [[[139.6, 35.6], [139.8, 35.6], [139.8, 35.8], [139.6, 35.8], [139.6, 35.6]]] } }], ...extra },
  });
  assert.equal(res.status, 201, res.text);
  return res.body;
}
/** 区域、车型组、调度人、服务规则、详情都填了的接送机草稿。 */
async function fullProduct(): Promise<any> {
  api.clock.advance(1_000);
  const created = await call("POST", PRODUCTS, { headers: key(), body: base({ areas: [{ area_id: ids["area"] }], vehicle_groups: [{ vehicle_group_id: ids["biz7"], passengers: 6, luggage: 2 }], dispatchers: [{ name: "调度小王", phone: "+81 90-1234-5678" }] }) });
  assert.equal(created.status, 201, created.text);
  assert.equal((await call("PUT", RULES, { id: created.body.id, headers: ifMatch(1), body: FULL_RULES() })).status, 200);
  assert.equal((await call("PUT", CONTENT, { id: created.body.id, headers: ifMatch(2), body: FULL_CONTENT })).status, 200);
  return (await call("GET", ONE, { id: created.body.id })).body;
}
const forcePublished = async (id: string): Promise<void> => void (await api.db.owner.query("update products set status = 'published', published_at = now() where id = $1", [id]));

before(async () => {
  api = await createTestApi();
  root = await api.superAdminToken();
  tenant = await api.tenantWithAdmin(root, "商品对账车队", "admin@product-openapi.test");
  ids["tokyo"] = (await platform("cities", { code: "CTY-JP-OPA", country_code: "JP", name: { zh: "东京", ja: "東京" }, timezone: "Asia/Tokyo", center: { lng: 139.6917, lat: 35.6895 } })).id;
  ids["osaka"] = (await platform("cities", { code: "CTY-JP-OPB", country_code: "JP", name: { zh: "大阪" }, timezone: "Asia/Tokyo", center: { lng: 135.5, lat: 34.69 } })).id;
  const location = { lng: 140.3887, lat: 35.7686 };
  ids["narita"] = (await platform("places", { type: "airport", code: "NRT", city_id: ids["tokyo"], name: { zh: "成田机场" }, location, flight_scope: "international" })).id;
  ids["station"] = (await platform("places", { type: "station", code: "STN-JP-OPATOKYO", city_id: ids["tokyo"], name: { zh: "东京站" }, location, category: "shinkansen" })).id;
  ids["hotel"] = (await platform("places", { type: "poi", code: "POI-000901", city_id: ids["tokyo"], name: { zh: "某酒店" }, location, category: "hotel" })).id;
  ids["kix"] = (await platform("places", { type: "airport", code: "KIX", city_id: ids["osaka"], name: { zh: "关西机场" }, location })).id;
  ids["biz7"] = (await platform("vehicle-groups", { grade: "business", seats: 7, power: "fuel", combos: [{ passengers: 6, luggage: 2 }, { passengers: 4, luggage: 4 }], code: "VG-BIZ-7", name: { zh: "商务 7 座" }, sample_models: ["丰田埃尔法"] })).id;
  ids["eco4"] = (await platform("vehicle-groups", { grade: "economy", seats: 4, power: "fuel", combos: [{ passengers: 3, luggage: 2 }], code: "VG-ECO-4", name: { zh: "经济 4 座" } })).id;
  ids["seat"] = (await platform("addons", { code: "ADD-CHILD_SEAT", categories: ["airport_transfer", "charter"], charge_unit: "per_item", name: { zh: "儿童座椅" } })).id;
  ids["sign"] = (await platform("addons", { code: "ADD-MEET_SIGN", categories: ["airport_transfer"], charge_unit: "per_order", name: { zh: "举牌接机" } })).id;
  ids["guide"] = (await platform("addons", { code: "ADD-GUIDE", categories: ["charter"], charge_unit: "per_duration", name: { zh: "导游" } })).id;
  ids["off"] = (await platform("addons", { code: "ADD-OFF", categories: ["airport_transfer"], charge_unit: "per_order", name: { zh: "已停用的服务" } })).id;
  await platform(`addons/${ids["off"]}/disable`, undefined);
  const brand = await api.call("POST", BRANDS, { token: tenant.adminToken, headers: key(), body: { name: "对账品牌", currency: "JPY" } });
  assert.equal(brand.status, 201, brand.text);
  ids["brand"] = brand.body.id;
  ids["area"] = (await newArea()).id;
});
after(() => api.close());

test("对账用的检查本身咬得住：多一个字段、少一个必填字段、枚举外的值、类型不对、金额是小数、编号不是 UUID，都会被指出来", async () => {
  const product = await fullProduct();
  const schema = doc.components.schemas["Product"] as Schema;
  assert.deepEqual(violations(schema, product), []);
  const broken: [string, Record<string, unknown>, RegExp][] = [
    ["多一个字段", { ...product, sell_price: 100 }, /多了定义里没有的字段 sell_price/],
    ["少一个必填字段", Object.fromEntries(Object.entries(product).filter(([name]) => name !== "version")), /缺少必填字段 version/],
    ["枚举外的值", { ...product, status: "archived" }, /不在枚举/],
    ["类型不对", { ...product, area_count: "1" }, /类型应为 integer/],
    ["编号不是 UUID", { ...product, brand_id: "brand-1" }, /不是 UUID/],
    ["区域里多一个字段", { ...product, areas: [{ ...product.areas[0], tenant_id: "x" }] }, /\/areas\/0：多了定义里没有的字段 tenant_id/],
    ["调度人少了电话", { ...product, dispatchers: [{ name: "x" }] }, /缺少必填字段 phone/],
    ["子品牌里多了加价比例", { ...product, brand: { ...product.brand, markup_bps: 1500 } }, /oneOf/],
  ];
  for (const [what, value, expected] of broken) assert.match(violations(schema, value).join("\n"), expected, what);
  const rules = (await call("GET", RULES, { id: product.id })).body;
  const rulesSchema = doc.components.schemas["ProductServiceRules"] as Schema;
  assert.deepEqual(violations(rulesSchema, rules), []);
  assert.match(violations(rulesSchema, { ...rules, rules: { ...rules.rules, night: { ...rules.rules.night, amount: 12.5 } } }).join("\n"), /类型应为 integer/, "金额是小数");
  assert.match(violations(rulesSchema, { ...rules, rules: { ...rules.rules, cancel_policy: {} } }).join("\n"), /多了定义里没有的字段 cancel_policy/);
});

test("成功的应答逐字段符合定义：子品牌（新增、列表、改名）；商品的新增（最少 / 填全 / 三个品类）、查看、列表（空筛选、翻页、各种筛选）、修改、服务规则、详情、上架校验、下架、删除", async () => {
  const brand = await call("POST", BRANDS, { headers: key(), body: { name: "对账品牌二", currency: "KRW" } });
  assert.equal(brand.status, 201, brand.text);
  assert.equal((await call("GET", BRANDS)).body.items.length, 2);
  assert.equal((await call("PUT", BRAND, { id: brand.body.id, headers: ifMatch(1), body: { name: "对账品牌二改" } })).body.version, 2);

  const minimal = await call("POST", PRODUCTS, { headers: key(), body: base() });
  assert.equal(minimal.status, 201, minimal.text);
  for (const category of ["charter", "point_to_point"]) assert.equal((await call("POST", PRODUCTS, { headers: key(), body: base({ category, poi_id: null, brand_id: brand.body.id }) })).status, 201);
  assert.equal((await call("POST", PRODUCTS, { headers: key(), body: base({ poi_id: ids["station"] }) })).status, 201);
  const full = await fullProduct();
  assert.deepEqual([full.areas.length, full.vehicle_groups.length, full.dispatchers.length, Object.keys(full.title).sort()], [1, 1, 1, ["en", "ja", "zh"]]);

  for (const id of [minimal.body.id, full.id]) {
    assert.equal((await call("GET", ONE, { id })).status, 200);
    assert.equal((await call("GET", RULES, { id })).status, 200);
    assert.equal((await call("GET", CONTENT, { id })).status, 200);
    assert.equal((await call("GET", CHECK, { id })).status, 200);
  }
  for (const query of ["", "limit=2", "status=draft", "status=published", "status=unpublished", "status=all", "category=charter", `city_id=${ids["tokyo"]}`, `brand_id=${brand.body.id}`, `area_id=${ids["area"]}`, `q=${encodeURIComponent("成田")}`, `q=${encodeURIComponent("没有这个名字")}`]) {
    const listed = await call("GET", PRODUCTS, { query });
    assert.equal(listed.status, 200, `${query}：${listed.text}`);
    assert.ok(listed.body.items.every((item: any) => !("areas" in item) && !("dispatchers" in item)), "列表项不带明细");
  }
  const firstPage = await call("GET", PRODUCTS, { query: "limit=2" });
  assert.equal(typeof firstPage.body.next_cursor, "string");
  assert.equal((await call("GET", PRODUCTS, { query: `limit=2&cursor=${encodeURIComponent(firstPage.body.next_cursor)}` })).body.items.length, 2);

  // 修改：分步保存、原样存回去（GET 拿到的 rules / content 原样提交是合法的）
  const patched = await call("PATCH", ONE, { id: minimal.body.id, headers: ifMatch(1), body: { areas: [{ area_id: ids["area"] }], vehicle_groups: [{ vehicle_group_id: ids["eco4"], passengers: 3, luggage: 2 }], dispatchers: [{ name: "小李", phone: "0312345678" }] } });
  assert.deepEqual([patched.status, patched.body.version], [200, 2]);
  const rules = (await call("GET", RULES, { id: full.id })).body;
  const echoedRules = await call("PUT", RULES, { id: full.id, headers: ifMatch(rules.version), body: rules.rules });
  assert.deepEqual([echoedRules.status, echoedRules.body.version], [200, rules.version], "读到的服务规则原样存回去：合法、不算修改");
  const content = (await call("GET", CONTENT, { id: full.id })).body;
  const echoedContent = await call("PUT", CONTENT, { id: full.id, headers: ifMatch(content.version), body: content.content });
  assert.deepEqual([echoedContent.status, echoedContent.body.version], [200, content.version]);
  assert.equal((await call("PUT", RULES, { id: minimal.body.id, headers: ifMatch(2), body: {} })).status, 200, "空的服务规则");
  assert.equal((await call("PUT", CONTENT, { id: minimal.body.id, headers: ifMatch(2), body: {} })).status, 200);

  // 已上架（摆出来的）：再上架原样返回、下架、再下架
  await forcePublished(full.id);
  assert.equal((await call("POST", `${ONE}/publish`, { id: full.id })).body.status, "published");
  assert.equal(typeof (await call("GET", ONE, { id: full.id })).body.published_at, "string");
  assert.equal((await call("GET", PRODUCTS, { query: "status=published" })).body.items.length, 1);
  assert.equal((await call("POST", `${ONE}/unpublish`, { id: full.id })).body.status, "unpublished");
  assert.equal((await call("POST", `${ONE}/unpublish`, { id: full.id })).body.status, "unpublished");
  assert.equal((await call("DELETE", ONE, { id: minimal.body.id })).status, 204);
});

test("失败的应答：实际会返回的状态码和错误码都写在了定义里，结构符合 ErrorResponse", async () => {
  const product = await fullProduct();
  const published = await fullProduct();
  await forcePublished(published.id);
  const expectError = async (method: HttpMethod, template: string, options: Options, status: number, code: string): Promise<ApiResponse> => {
    const res = await call(method, template, options);
    assert.deepEqual([res.status, res.body?.error?.code], [status, code], `${method} ${template}：${res.text.slice(0, 200)}`);
    return res;
  };
  // 子品牌
  await expectError("POST", BRANDS, { headers: key(), body: { name: "对账品牌", currency: "KRW" } }, 409, "BRAND_NAME_TAKEN");
  const usedKey = key();
  assert.equal((await call("POST", BRANDS, { headers: usedKey, body: { name: "幂等品牌", currency: "JPY" } })).status, 201);
  const reused = await expectError("POST", BRANDS, { headers: usedKey, body: { name: "幂等品牌二", currency: "JPY" } }, 422, "IDEMPOTENCY_KEY_REUSED");
  assert.equal(typeof reused.body.error.details.created.id, "string");
  await expectError("POST", BRANDS, { body: { name: "没带键", currency: "JPY" } }, 400, "VALIDATION_FAILED");
  await expectError("POST", BRANDS, { headers: key(), body: { name: "欧元", currency: "EUR" } }, 400, "VALIDATION_FAILED");
  await expectError("PUT", BRAND, { id: MISSING, headers: ifMatch(1), body: { name: "x" } }, 404, "NOT_FOUND");
  await expectError("PUT", BRAND, { id: ids["brand"] as string, body: { name: "x" } }, 428, "PRECONDITION_REQUIRED");
  await expectError("PUT", BRAND, { id: ids["brand"] as string, headers: ifMatch(9), body: { name: "x" } }, 409, "VERSION_CONFLICT");
  await expectError("PUT", BRAND, { id: ids["brand"] as string, headers: ifMatch(1), body: { name: "x", currency: "KRW" } }, 409, "FIELD_LOCKED");
  await expectError("PUT", BRAND, { id: ids["brand"] as string, headers: ifMatch(1), body: { name: "幂等品牌" } }, 409, "BRAND_NAME_TAKEN");
  // 新增商品
  const productKey = key();
  assert.equal((await call("POST", PRODUCTS, { headers: productKey, body: base() })).status, 201);
  await expectError("POST", PRODUCTS, { headers: productKey, body: base({ poi_id: ids["station"] }) }, 422, "IDEMPOTENCY_KEY_REUSED");
  await expectError("POST", PRODUCTS, { body: base() }, 400, "VALIDATION_FAILED");
  const disabledPlace = await platform("places", { type: "airport", code: "OPX", city_id: ids["tokyo"], name: { zh: "停用的机场" }, location: { lng: 140, lat: 35.5 } });
  await platform(`places/${disabledPlace.id}/disable`, undefined);
  const notReady = await expectError("POST", PRODUCTS, { headers: key(), body: base({ poi_id: disabledPlace.id }) }, 409, "MASTER_DATA_NOT_READY");
  assert.deepEqual(notReady.body.error.details, { reason: "PICKUP_PLACE_DISABLED" });
  // 查看、修改、删除、各子资源：不存在的、编号写法不对的
  for (const [method, template, options] of [
    ["GET", ONE, {}], ["PATCH", ONE, { headers: ifMatch(1), body: {} }], ["DELETE", ONE, {}], ["GET", RULES, {}], ["PUT", RULES, { headers: ifMatch(1), body: {} }],
    ["GET", CONTENT, {}], ["PUT", CONTENT, { headers: ifMatch(1), body: {} }], ["GET", CHECK, {}], ["POST", `${ONE}/publish`, {}], ["POST", `${ONE}/unpublish`, {}],
  ] as [HttpMethod, string, Options][]) {
    await expectError(method, template, { ...options, id: MISSING }, 404, "NOT_FOUND");
    await expectError(method, template, { ...options, id: "not-a-uuid" }, 404, "NOT_FOUND");
  }
  // 修改：没带版本号、版本号过期、锁定字段、已上架的改完不满足上架条件
  for (const template of [ONE, RULES, CONTENT]) {
    const method: HttpMethod = template === ONE ? "PATCH" : "PUT";
    await expectError(method, template, { id: product.id, body: {} }, 428, "PRECONDITION_REQUIRED");
    await expectError(method, template, { id: product.id, headers: ifMatch(99), body: {} }, 409, "VERSION_CONFLICT");
    await expectError(method, template, { id: product.id, headers: { "if-match": "abc" }, body: {} }, 400, "VALIDATION_FAILED");
    const refused = await expectError(method, template, { id: published.id, headers: ifMatch(published.version), body: template === ONE ? { dispatchers: [] } : {} }, 409, "PUBLISH_CHECK_FAILED");
    assert.deepEqual(violations((doc.components.schemas["PublishCheck"] as Schema)["properties"]["items"], refused.body.error.details.items), [], "details.items 和上架校验的 items 同一个结构");
  }
  const locked = await expectError("PATCH", ONE, { id: product.id, headers: ifMatch(product.version), body: { category: "charter", city_id: ids["osaka"] } }, 409, "FIELD_LOCKED");
  assert.deepEqual(locked.body.error.details, { fields: ["city_id", "category"] });
  // 上架、下架、删除
  const refused = await expectError("POST", `${ONE}/publish`, { id: product.id }, 409, "PUBLISH_CHECK_FAILED");
  assert.deepEqual(refused.body.error.details.items, (await call("GET", CHECK, { id: product.id })).body.items);
  await expectError("POST", `${ONE}/unpublish`, { id: product.id }, 409, "PRODUCT_STATE_INVALID");
  const notDraft = await expectError("DELETE", ONE, { id: published.id }, 409, "PRODUCT_NOT_DRAFT");
  assert.deepEqual(notDraft.body.error.details, { status: "published" });
  // 列表的查询参数
  for (const query of ["limit=0", "limit=201", "status=deleted", "category=bus", "city_id=tokyo", "brand_id=x", "area_id=x", "cursor=garbage", "q=", `q=${"x".repeat(101)}`]) await expectError("GET", PRODUCTS, { query }, 400, "VALIDATION_FAILED");
  // 没登录、没有权限
  const finance = await addTenantUser(api, tenant.adminToken, "finance@product-openapi.test", "finance");
  const pricing = await addTenantUser(api, tenant.adminToken, "pricing@product-openapi.test", "pricing");
  await expectError("GET", PRODUCTS, { token: finance.token }, 403, "FORBIDDEN");
  await expectError("GET", BRANDS, { token: finance.token }, 403, "FORBIDDEN");
  await expectError("POST", BRANDS, { token: pricing.token, headers: key(), body: { name: "x", currency: "JPY" } }, 403, "FORBIDDEN");
  await expectError("GET", PRODUCTS, { token: "not-a-token" }, 401, "UNAUTHENTICATED");
  await api.db.owner.query("update products set status = 'unpublished' where id = $1", [published.id]);
});

test("VALIDATION_FAILED 的原因代码：每一个实际会出现的都写在了 ProductInvalid 的说明里；说明里写的每一个都真的能触发（定义没有多写）", async () => {
  invalidReasons.clear();
  const invalidText = String(doc.components.responses["ProductInvalid"]?.["description"]);
  const product = (await call("POST", PRODUCTS, { headers: key(), body: base() })).body;
  const charter = (await call("POST", PRODUCTS, { headers: key(), body: base({ category: "charter", poi_id: null }) })).body;
  const disabledArea = await newArea();
  assert.equal((await api.call("POST", `/tenant/v1/areas/${disabledArea.id}/disable`, { token: tenant.adminToken })).status, 200);
  const charterArea = await newArea({ biz_type: "charter" });
  const osakaArea = await newArea({ city_id: ids["osaka"] });
  const offGroup = await platform("vehicle-groups", { grade: "luxury", seats: 4, power: "fuel", combos: [{ passengers: 3, luggage: 2 }], code: "VG-LUX-4", name: { zh: "停用的车型组" } });
  await platform(`vehicle-groups/${offGroup.id}/disable`, undefined);
  const expectInvalid = async (method: HttpMethod, template: string, options: Options, expected: string[], what: string): Promise<void> => {
    const res = await call(method, template, options);
    assert.deepEqual([res.status, res.body?.error?.code], [400, "VALIDATION_FAILED"], `${what}：${res.text.slice(0, 300)}`);
    const got = (res.body.error.details.issues as { path: string; message: string; reason?: string }[]).map((issue) => {
      assert.equal(typeof issue.path, "string");
      assert.match(issue.message, /[一-鿿]/, `${what}：说明是中文`);
      return issue.reason;
    });
    for (const reason of expected) assert.ok(got.includes(reason), `${what}：应该有 ${reason}，实际 ${JSON.stringify(got)}`);
  };
  const create = (body: Record<string, unknown>, expected: string[], what: string): Promise<void> => expectInvalid("POST", PRODUCTS, { headers: key(), body: base(body) }, expected, what);
  const patch = (body: Record<string, unknown>, expected: string[], what: string): Promise<void> => expectInvalid("PATCH", ONE, { id: product.id, headers: ifMatch(1), body }, expected, what);
  const rules = (body: Record<string, unknown>, expected: string[], what: string, target = product): Promise<void> => expectInvalid("PUT", RULES, { id: target.id, headers: ifMatch(1), body }, expected, what);
  const content = (body: Record<string, unknown>, expected: string[], what: string): Promise<void> => expectInvalid("PUT", CONTENT, { id: product.id, headers: ifMatch(1), body }, expected, what);

  await expectInvalid("POST", BRANDS, { headers: key(), body: { name: "x", currency: "EUR" } }, ["UNSUPPORTED_CURRENCY"], "币种不支持");
  await create({ brand_id: MISSING }, ["UNKNOWN_BRAND"], "子品牌不存在");
  await create({ city_id: MISSING }, ["UNKNOWN_CITY"], "城市不存在");
  await create({ poi_id: ids["hotel"] }, ["UNKNOWN_PLACE"], "接送点是酒店");
  await create({ poi_id: ids["kix"] }, ["PLACE_OTHER_CITY"], "接送点在别的城市");
  await create({ poi_id: null }, ["REQUIRED"], "接送机没有接送点");
  await create({ category: "charter" }, ["NOT_APPLICABLE"], "包车带了接送点");
  await api.db.owner.query("update brands set status = 'disabled' where id = $1", [ids["brand"]]);
  await create({}, ["BRAND_DISABLED"], "子品牌已停用");
  await api.db.owner.query("update brands set status = 'active' where id = $1", [ids["brand"]]);
  await patch({ areas: [{ area_id: MISSING }, { area_id: osakaArea.id }, { area_id: charterArea.id }, { area_id: disabledArea.id }, { area_id: ids["area"] }, { area_id: ids["area"] }] }, ["UNKNOWN_AREA", "AREA_OTHER_CITY", "AREA_NOT_USABLE", "AREA_DISABLED", "DUPLICATE"], "区域");
  await patch({ areas: Array.from({ length: 51 }, () => ({ area_id: ids["area"] })) }, ["TOO_MANY"], "区域太多");
  await patch({ vehicle_groups: [{ vehicle_group_id: MISSING, passengers: 1, luggage: 0 }, { vehicle_group_id: offGroup.id, passengers: 3, luggage: 2 }, { vehicle_group_id: ids["eco4"], passengers: 4, luggage: 4 }] }, ["UNKNOWN_VEHICLE_GROUP", "VEHICLE_GROUP_DISABLED", "VEHICLE_COMBO_NOT_OFFERED"], "车型组");
  await patch({ dispatchers: [{ name: "", phone: "abc" }] }, ["REQUIRED", "INVALID_PHONE"], "调度人");
  await rules({ booking: { sale_from: "2026-02-30" } }, ["INVALID_DATE"], "日期不存在");
  await rules({ booking: { sale_from: "2027-01-02", sale_to: "2027-01-01" } }, ["DATE_RANGE_REVERSED"], "日期颠倒");
  await rules({ booking: { service_time: { start: "8:00", end: "22:00" } } }, ["INVALID_TIME"], "时刻写法");
  await rules({ booking: { service_time: { start: "08:00", end: "08:00" } } }, ["EMPTY_WINDOW"], "空时段");
  await rules({ booking: { lead_time_hours: 721 } }, ["OUT_OF_RANGE"], "超范围");
  await rules({ booking: { lead_time_hours: 1.5 } }, ["NOT_INTEGER"], "不是整数");
  await rules({ booking: { note: "字".repeat(501) } }, ["TOO_LONG"], "备注太长");
  await rules({ booking: { lead_time_hours: 6 }, urgent: { tiers: [{ within_hours: 12, surcharge: 0 }, { within_hours: 3, surcharge: 0 }, { within_hours: 3, surcharge: 0 }] } }, ["TIER_NOT_WITHIN_LEAD_TIME", "DUPLICATE"], "加急阶梯");
  await rules({ urgent: { tiers: Array.from({ length: 11 }, (_, index) => ({ within_hours: index + 1, surcharge: 0 })) } }, ["TOO_MANY"], "阶梯太多");
  await rules({ free_wait: { pickup: { mode: "limited", minutes: 60 }, general: { mode: "unlimited" } } }, ["BELOW_PLATFORM_MINIMUM", "NOT_APPLICABLE"], "免等");
  await rules({ driver_languages: [{ language: "Chinese", unit_price: 0 }] }, ["INVALID_LANGUAGE"], "语言代码");
  await rules({ addons: [{ addon_id: MISSING, unit_price: 0 }, { addon_id: ids["off"], unit_price: 0 }, { addon_id: ids["guide"], unit_price: 0 }, { addon_id: ids["sign"], unit_price: 0, first_free: true }] }, ["UNKNOWN_ADDON", "ADDON_DISABLED", "ADDON_NOT_APPLICABLE"], "附加服务（按次计费的带了首个免费不再报错：当作没设）");
  await rules({ free_wait: { pickup: { mode: "unlimited" } } }, ["NOT_APPLICABLE"], "包车填了接机免等", charter);
  await content({ zh: { title: "题".repeat(101), includes: Array.from({ length: 31 }, () => "x") } }, ["TOO_LONG", "TOO_MANY"], "详情太长");
  await content({ zh: { title: "​" } }, ["REQUIRED"], "标题只有看不见的字符");

  for (const reason of invalidReasons) assert.ok(invalidText.includes(`\`${reason}\``), `原因代码 ${reason} 实际会出现，但没有写在 ProductInvalid 的说明里`);
  for (const documented of invalidText.match(/`[A-Z_]{5,}`/g) ?? []) {
    const code = documented.replace(/`/g, "");
    if (code === "VALIDATION_FAILED") continue;
    assert.ok(invalidReasons.has(code), `ProductInvalid 的说明里写了原因代码 ${code}，但没有任何输入能触发它`);
  }
});

test("上架校验：六项的键和顺序、必须 / 可选和定义一致；实际给出的每个原因代码都在定义的说明里；每条都有路径和中文说明", async () => {
  checkReasons.clear();
  const schema = doc.components.schemas["PublishCheck"] as Schema;
  const itemSchema = schema["properties"]["items"]["items"];
  assert.deepEqual(itemSchema["properties"]["key"]["enum"], [...PUBLISH_CHECK_KEYS]);
  const described = `${String(itemSchema["properties"]["issues"]["description"])}\n${String(doc.components.responses["ProductInvalid"]?.["description"])}`;

  const empty = (await call("POST", PRODUCTS, { headers: key(), body: base() })).body;
  const stale = await newArea();
  const group = await platform("vehicle-groups", { grade: "comfort", seats: 5, power: "fuel", combos: [{ passengers: 4, luggage: 3 }, { passengers: 3, luggage: 4 }], code: "VG-COMF-5", name: { zh: "会被改的车型组" } });
  const addon = await platform("addons", { code: "ADD-OPA_TMP", categories: ["airport_transfer"], charge_unit: "per_order", name: { zh: "会被停用的服务" } });
  const place = await platform("places", { type: "airport", code: "OPY", city_id: ids["tokyo"], name: { zh: "会被停用的机场" }, location: { lng: 140, lat: 35.5 }, flight_scope: "domestic" });
  const full = (await call("POST", PRODUCTS, { headers: key(), body: base({ poi_id: place.id, areas: [{ area_id: ids["area"] }, { area_id: stale.id }], vehicle_groups: [{ vehicle_group_id: group.id, passengers: 4, luggage: 3 }, { vehicle_group_id: ids["eco4"], passengers: 3, luggage: 2 }], dispatchers: [{ name: "x", phone: "0312345678" }] }) })).body;
  assert.equal((await call("PUT", RULES, { id: full.id, headers: ifMatch(1), body: { ...FULL_RULES(), free_wait: { pickup: { mode: "limited", minutes: 60 }, dropoff: { mode: "unlimited" } }, addons: [{ addon_id: addon.id, unit_price: 0 }] } })).status, 200);
  assert.equal((await call("PUT", CONTENT, { id: full.id, headers: ifMatch(2), body: { zh: { title: "有标题没指引" } } })).status, 200);
  // 之后引用的东西一样样变掉
  assert.equal((await api.call("POST", `/tenant/v1/areas/${stale.id}/disable`, { token: tenant.adminToken })).status, 200);
  await platform(`vehicle-groups/${group.id}`, { combos: [{ passengers: 3, luggage: 4 }] }, "PATCH", group.version);
  await platform(`vehicle-groups/${ids["eco4"]}/disable`, undefined);
  await platform(`addons/${addon.id}/disable`, undefined);
  await platform(`places/${place.id}`, { flight_scope: "international" }, "PATCH", place.version);
  await platform(`places/${place.id}/disable`, undefined);

  const results = [(await call("GET", CHECK, { id: empty.id })).body, (await call("GET", CHECK, { id: full.id })).body];
  for (const result of results) {
    assert.deepEqual(result.items.map((item: any) => [item.key, item.required]), [["basic_info", true], ["service_rules", true], ["price_rules", true], ["content", true], ["adjust_rules", false], ["inventory", false]]);
    assert.equal(result.can_publish, false);
    for (const item of result.items) {
      assert.equal(item.passed, item.issues.length === 0, item.key);
      for (const issue of item.issues) {
        assert.match(issue.path, /^\//);
        assert.match(issue.message, /[一-鿿]/);
      }
    }
  }
  const reasonsOf = (result: any, itemKey: string): string[] => result.items.find((item: any) => item.key === itemKey).issues.map((issue: any) => `${issue.path} ${issue.reason}`);
  assert.deepEqual(reasonsOf(results[1], "basic_info"), ["/poi_id PICKUP_PLACE_DISABLED", "/areas/1 AREA_DISABLED", "/vehicle_groups/0 VEHICLE_COMBO_NOT_OFFERED", "/vehicle_groups/1 VEHICLE_GROUP_DISABLED"]);
  assert.deepEqual(reasonsOf(results[1], "service_rules"), ["/free_wait/pickup/minutes BELOW_PLATFORM_MINIMUM", "/addons/0/addon_id ADDON_DISABLED"]);
  assert.deepEqual(reasonsOf(results[1], "content"), ["/zh/pickup_guide REQUIRED"]);
  assert.deepEqual(results[1].items[1].issues[0].detail, { min: 90 });
  assert.ok(checkReasons.size >= 11, `见到的原因代码：${[...checkReasons].join()}`);
  for (const reason of checkReasons) assert.ok(described.includes(`\`${reason}\``), `上架校验给出了原因代码 ${reason}，定义的说明里没有`);
  await platform(`vehicle-groups/${ids["eco4"]}/enable`, undefined);
});

test("请求定义和实现一致：必填项、枚举、条数和长度上限；按定义的上限造的请求被接受，超一个就被拒", async () => {
  const schemas = doc.components.schemas;
  assert.deepEqual(schemas["ProductStatus"]?.["enum"], [...PRODUCT_STATUSES]);
  assert.deepEqual(deref(schemas["ServiceCategory"] as Schema)["enum"], [...SERVICE_CATEGORIES]);
  assert.deepEqual([...(schemas["BrandCreate"]?.["properties"]["currency"]["enum"] as string[])].sort(), Object.keys(CURRENCIES).sort());
  assert.deepEqual(schemas["Brand"]?.["properties"]["currency"]["enum"], schemas["BrandCreate"]?.["properties"]["currency"]["enum"]);
  assert.deepEqual(schemas["BrandCreate"]?.["required"], ["name", "currency"]);
  assert.deepEqual(schemas["BrandUpdate"]?.["required"], ["name"]);
  assert.deepEqual(schemas["ProductCreate"]?.["required"], ["brand_id", "city_id", "category"]);
  assert.deepEqual(
    [schemas["BrandCreate"]?.["properties"]["name"]["maxLength"], schemas["ProductAreaChoices"]?.["maxItems"], schemas["ProductVehicleChoices"]?.["maxItems"], schemas["ProductCreate"]?.["properties"]["dispatchers"]["maxItems"], schemas["ProductPatch"]?.["properties"]["dispatchers"]["maxItems"], schemas["Dispatcher"]?.["properties"]["name"]["maxLength"]],
    [PRODUCT_LIMITS.maxBrandNameLength, PRODUCT_LIMITS.maxAreas, PRODUCT_LIMITS.maxVehicleGroups, PRODUCT_LIMITS.maxDispatchers, PRODUCT_LIMITS.maxDispatchers, PRODUCT_LIMITS.maxDispatcherNameLength],
  );
  const rules = schemas["ServiceRules"]?.["properties"];
  assert.deepEqual(
    [rules.booking.properties.lead_time_hours.maximum, rules.booking.properties.note.maxLength, rules.urgent.properties.tiers.maxItems, rules.addons.maxItems, rules.driver_languages.maxItems, schemas["FreeWait"]?.["properties"]["minutes"]["maximum"]],
    [PRODUCT_LIMITS.maxLeadTimeHours, PRODUCT_LIMITS.maxNoteLength, PRODUCT_LIMITS.maxUrgentTiers, PRODUCT_LIMITS.maxAddons, PRODUCT_LIMITS.maxDriverLanguages, PRODUCT_LIMITS.maxFreeWaitMinutes],
  );
  assert.deepEqual(rules.night.properties.charge_unit.enum, [...NIGHT_CHARGE_UNITS, null]);
  assert.deepEqual([...rules.driver_languages.items.properties.language.enum].sort(), [...DRIVER_LANGUAGES].sort(), "司机语言只能是支持的那几种");
  assert.deepEqual([rules.urgent.properties.daily_quota.minimum, rules.urgent.properties.daily_quota.maximum], [1, PRODUCT_LIMITS.maxUrgentDailyQuota]);
  const text = schemas["ProductContentText"]?.["properties"];
  assert.deepEqual(
    [text.title.maxLength, text.summary.maxLength, text.itinerary.maxLength, text.pickup_guide.maxLength, text.includes.maxItems, text.includes.items.maxLength, text.excludes.maxItems, text.excludes.items.maxLength],
    [PRODUCT_LIMITS.maxTitleLength, PRODUCT_LIMITS.maxSummaryLength, PRODUCT_LIMITS.maxGuideLength, PRODUCT_LIMITS.maxGuideLength, PRODUCT_LIMITS.maxListItems, PRODUCT_LIMITS.maxListItemLength, PRODUCT_LIMITS.maxListItems, PRODUCT_LIMITS.maxListItemLength],
  );
  assert.deepEqual(Object.keys(schemas["ProductContent"]?.["properties"]).sort(), ["en", "ja", "ko", "zh"]);

  // 按定义的上限造的请求：实现接受；请求本身也符合定义
  const product = (await call("POST", PRODUCTS, { headers: key(), body: base({ category: "charter", poi_id: null }) })).body;
  const atLimit = {
    booking: { sale_from: "2026-01-01", sale_to: "2026-12-31", service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 720, note: "字".repeat(500) },
    urgent: { enabled: true, daily_quota: 10_000, tiers: Array.from({ length: 10 }, (_, index) => ({ within_hours: index + 1, surcharge: 0 })) },
    night: { enabled: true, window: { start: "23:59", end: "00:00" }, amount: 0, charge_unit: "per_hour" },
    free_wait: { pickup: null, dropoff: null, general: { mode: "limited", minutes: 1440 } },
    addons: [{ addon_id: ids["seat"], enabled: true, unit_price: 0, first_free: false }],
    driver_languages: [...DRIVER_LANGUAGES].map((language) => ({ language, unit_price: 0 })),
  };
  assert.deepEqual(violations(schemas["ServiceRules"] as Schema, atLimit), [], "造的请求符合定义");
  const saved = await call("PUT", RULES, { id: product.id, headers: ifMatch(1), body: atLimit });
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(saved.body.rules, atLimit, "存进去的和读出来的一样");
  const contentAtLimit = Object.fromEntries(["ja", "zh", "en", "ko"].map((language) => [language, { title: "题".repeat(100), summary: "简".repeat(2000), includes: Array.from({ length: 30 }, () => "含".repeat(200)), excludes: Array.from({ length: 30 }, () => "不".repeat(200)), itinerary: "行".repeat(2000), pickup_guide: "指".repeat(2000) }]));
  assert.deepEqual(violations(schemas["ProductContent"] as Schema, contentAtLimit), []);
  const content = await call("PUT", CONTENT, { id: product.id, headers: ifMatch(2), body: contentAtLimit });
  assert.equal(content.status, 200, content.text);
  assert.deepEqual(content.body.content, contentAtLimit);
  const tenDispatchers = await call("PATCH", ONE, { id: product.id, headers: ifMatch(3), body: { dispatchers: Array.from({ length: 10 }, (_, index) => ({ name: "名".repeat(50), phone: `+81 90 1234 56${String(index).padStart(2, "0")}` })) } });
  assert.equal(tenDispatchers.status, 200, tenDispatchers.text);
  const brand = await call("POST", BRANDS, { headers: key(), body: { name: "名".repeat(50), currency: "THB" } });
  assert.equal(brand.status, 201, brand.text);
  // 超过定义的上限一个：实现拒绝
  const over: [HttpMethod, string, Options][] = [
    ["PUT", RULES, { id: product.id, headers: ifMatch(4), body: { ...atLimit, booking: { ...atLimit.booking, lead_time_hours: 721 } } }],
    ["PUT", RULES, { id: product.id, headers: ifMatch(4), body: { ...atLimit, booking: { ...atLimit.booking, note: "字".repeat(501) } } }],
    ["PUT", RULES, { id: product.id, headers: ifMatch(4), body: { ...atLimit, free_wait: { general: { mode: "limited", minutes: 1441 } } } }],
    ["PUT", RULES, { id: product.id, headers: ifMatch(4), body: { ...atLimit, driver_languages: [...atLimit.driver_languages, { language: "vi", unit_price: 0 }] } }],
    ["PUT", RULES, { id: product.id, headers: ifMatch(4), body: { ...atLimit, driver_languages: Array.from({ length: 11 }, () => ({ language: "zh", unit_price: 0 })) } }],
    ["PUT", RULES, { id: product.id, headers: ifMatch(4), body: { ...atLimit, urgent: { ...atLimit.urgent, daily_quota: 10_001 } } }],
    ["PUT", RULES, { id: product.id, headers: ifMatch(4), body: { ...atLimit, urgent: { ...atLimit.urgent, daily_quota: 0 } } }],
    ["PUT", CONTENT, { id: product.id, headers: ifMatch(4), body: { zh: { title: "题".repeat(101) } } }],
    ["PUT", CONTENT, { id: product.id, headers: ifMatch(4), body: { zh: { title: "题", includes: Array.from({ length: 31 }, () => "含") } } }],
    ["PATCH", ONE, { id: product.id, headers: ifMatch(4), body: { dispatchers: Array.from({ length: 11 }, () => ({ name: "名", phone: "0312345678" })) } }],
    ["PATCH", ONE, { id: product.id, headers: ifMatch(4), body: { dispatchers: [{ name: "名".repeat(51), phone: "0312345678" }] } }],
    ["POST", BRANDS, { headers: key(), body: { name: "名".repeat(51), currency: "JPY" } }],
  ];
  for (const [method, template, options] of over) assert.equal((await call(method, template, options)).status, 400, `${method} ${template} ${JSON.stringify(options.body).slice(0, 80)}`);
});

test("这份对账把子品牌和商品的每个接口都调到了", () => {
  assert.deepEqual(PRODUCT_OPERATIONS.filter((operation) => !exercised.has(operation)), []);
  const documented = Object.entries(doc.paths)
    // 价格规则、调价规则、取整单位是 M1-04 的接口，各有自己的对账（prices.itest.ts）；这里只管子品牌和商品本身的
    .filter(([path]) => (path.startsWith("/tenant/v1/brands") || path.startsWith("/tenant/v1/products")) && !/\/(price-rules|price-calendar|price-coverage|adjust-rules|rounding-unit)(\/|$)/.test(path))
    .flatMap(([path, methods]) => Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`));
  assert.deepEqual(documented.sort(), [...PRODUCT_OPERATIONS].sort(), "定义里商品相关的接口就是这 15 个操作（9 个路径）");
});
