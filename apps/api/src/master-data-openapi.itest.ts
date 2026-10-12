/**
 * M1-01：主数据接口的实际行为和 apps/api/openapi.yaml 对账。
 * openapi.test.ts 只核对「有哪些路径」；这里核对内容：
 * - 每个主数据接口实际返回的 JSON 逐字段符合定义里的结构（必填、类型、枚举、不多不少）；
 * - 实际会返回的错误状态码都写在了定义里；
 * - 定义里的请求字段、必填项、查询参数、枚举值和实现一致。
 * 测试数据都在这里构造，结束时连同 schema 一起删除。不联网。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import {
  ADDON_CHARGE_UNITS,
  FLIGHT_SCOPES,
  MASTER_DATA_LANGUAGES,
  MASTER_DATA_STATUSES,
  PLACE_CATEGORIES,
  PLACE_TYPES,
  SERVICE_CATEGORIES,
  VEHICLE_GRADES,
  VEHICLE_POWERS,
  selectAirports,
} from "@nozomi/domain";
import { importAirports } from "./services/airport-import.ts";
import { type ApiResponse, type HttpMethod, type TestApi, type TenantFixture, createTestApi } from "./testing/api.ts";

type Schema = Record<string, any>;
interface Operation {
  parameters?: Schema[];
  requestBody?: { content: { "application/json": { schema: Schema } } };
  responses: Record<string, Schema>;
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

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

/** 按定义检查一个值，返回不符合的地方。只实现了 openapi.yaml 里用到的那些关键字。 */
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
    if (schema["pattern"] && !new RegExp(schema["pattern"]).test(value)) found.push(`${at}：不符合 ${schema["pattern"]}`);
    if (schema["maxLength"] !== undefined && value.length > schema["maxLength"]) found.push(`${at}：超过 ${schema["maxLength"]} 个字符`);
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
    if (schema["minProperties"] !== undefined && Object.keys(object).length < schema["minProperties"]) found.push(`${at}：字段少于 ${schema["minProperties"]} 个`);
    for (const [key, item] of Object.entries(object)) {
      if (properties[key]) found.push(...violations(properties[key], item, `${path}/${key}`));
      else if (schema["additionalProperties"] === false) found.push(`${at}：多了定义里没有的字段 ${key}`);
    }
  }
  return found;
}

let api: TestApi;
let root: string;
let tenant: TenantFixture;

const MISSING = "99999999-9999-4999-8999-999999999999";
const PATHS = ["cities", "places", "vehicle-groups", "addons"] as const;
type Path = (typeof PATHS)[number];
const SCHEMA_NAMES: Record<Path, string> = { cities: "City", places: "Place", "vehicle-groups": "VehicleGroup", addons: "Addon" };

/** 实际发生过的调用：用来核对「每个主数据接口都对过账」。 */
const exercised = new Set<string>();

/** 调一次接口，并按定义核对这次应答：状态码写在了定义里；应答内容符合那个状态码下的结构。 */
async function call(method: HttpMethod, template: string, options: { id?: string; query?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<ApiResponse> {
  const url = template.replace("{id}", options.id ?? "") + (options.query ? `?${options.query}` : "");
  const res = await api.call(method, url, {
    token: options.token ?? (template.startsWith("/tenant/") ? tenant.adminToken : root),
    ...(options.body === undefined ? {} : { body: options.body }),
    ...(options.headers === undefined ? {} : { headers: options.headers }),
  });
  const operation = doc.paths[template]?.[method.toLowerCase()];
  assert.ok(operation, `定义里没有 ${method} ${template}`);
  exercised.add(`${method} ${template}`);
  // 400、401、403 是所有需要登录的接口共有的，定义在总说明里，不在每个接口下重复
  if (![400, 401, 403].includes(res.status)) {
    const documented = operation.responses[String(res.status)];
    assert.ok(documented, `${method} ${template} 实际返回了 ${res.status}（${res.body?.error?.code ?? ""}），定义里没有写这个状态码`);
    const schema = deref(documented)["content"]?.["application/json"]?.["schema"];
    assert.ok(schema, `${method} ${template} 的 ${res.status} 在定义里没有写返回结构`);
    assert.deepEqual(violations(schema, res.body), [], `${method} ${url} 的 ${res.status} 应答不符合定义：${res.text.slice(0, 400)}`);
  } else {
    assert.deepEqual(violations(doc.components.schemas["ErrorResponse"]!, res.body), [], res.text);
  }
  return res;
}

const P = (path: Path, suffix = ""): string => `/platform/v1/master/${path}${suffix}`;
const T = (path: Path, suffix = ""): string => `/tenant/v1/master/${path}${suffix}`;
const ifMatch = (version: number): Record<string, string> => ({ "if-match": `"${version}"` });

let serial = 0;
const next = (): string => (serial += 1).toString(36).toUpperCase().padStart(3, "0");
const cityBody = (): Record<string, unknown> => ({
  code: `CTY-JP-O${next()}`,
  country_code: "JP",
  name: { ja: "東京", zh: "东京", en: "Tokyo", ko: "도쿄" },
  timezone: "Asia/Tokyo",
  center: { lng: 139.767125, lat: 35.681236 },
  boundary: { type: "Polygon", coordinates: [[[139, 35], [140, 35], [140, 36], [139, 35]]] },
});
const groupBody = (): Record<string, unknown> => ({
  code: `VG-O${next()}-7`,
  grade: "business",
  seats: 7,
  name: { zh: "商务 7 座" },
  sample_models: ["丰田埃尔法"],
  power: "ev",
  combos: [{ passengers: 6, luggage: 2 }, { passengers: 4, luggage: 4 }],
});
const addonBody = (): Record<string, unknown> => ({
  code: `ADD-O${next()}`,
  categories: ["airport_transfer", "charter"],
  charge_unit: "per_duration",
  name: { zh: "司机等候" },
  description: { zh: "按小时计", en: "Per hour" },
});

before(async () => {
  api = await createTestApi();
  root = await api.superAdminToken();
  tenant = await api.tenantWithAdmin(root, "对账测试车队", "admin@openapi.test");
});
after(() => api.close());

async function create(path: Path, body: unknown): Promise<any> {
  const res = await call("POST", P(path), { body });
  assert.equal(res.status, 201, res.text);
  return res.body;
}

/** 成功的应答：平台和租户；含导入的机场、航站楼、车站、出口、地标。每次调用都在 call() 里按定义核对。 */
async function exerciseSuccessResponses(): Promise<void> {
  const city = await create("cities", cityBody());
  const plainCity = await create("cities", { ...cityBody(), boundary: null });
  const base = { name: { zh: "地点", en: "Place" }, location: { lng: 139.786958, lat: 35.549678 } };
  const airport = await create("places", { ...base, type: "airport", code: "OAA", city_id: city.id, flight_scope: "mixed" });
  const terminal = await create("places", { ...base, type: "terminal", code: "OAA-T1", parent_id: airport.id, flight_scope: "international" });
  const station = await create("places", { ...base, type: "station", code: "STN-JP-OAS", city_id: city.id, category: "shinkansen" });
  const exit = await create("places", { ...base, type: "exit", code: "STN-JP-OAS-E1", parent_id: station.id });
  const poi = await create("places", { ...base, type: "poi", code: "POI-OA1", city_id: city.id, category: "hotel", address: "东京都港区 1-1" });
  const csv = "id,type,name,latitude_deg,longitude_deg,iso_country,scheduled_service,iata_code\n990101,large_airport,Imported Airport,35.5,139.5,JP,yes,OAI\n";
  await importAirports(api.db.pool, selectAirports(csv, ["JP"]), api.clock.now(), { dryRun: false });
  const imported = (await call("GET", P("places"), { query: "code=OAI" })).body.items[0];
  assert.equal(imported.source.name, "ourairports");
  const group = await create("vehicle-groups", groupBody());
  const addon = await create("addons", addonBody());
  const bareAddon = await create("addons", { ...addonBody(), description: undefined });
  assert.deepEqual(bareAddon.description, {});

  const samples: Record<Path, any[]> = {
    cities: [city, plainCity],
    places: [airport, terminal, station, exit, poi, imported],
    "vehicle-groups": [group],
    addons: [addon, bareAddon],
  };
  for (const path of PATHS) {
    for (const prefix of [P, T]) {
      const list = await call("GET", prefix(path), { query: "status=all&limit=200" });
      assert.equal(list.status, 200, list.text);
      assert.equal(list.body.items.length, samples[path].length, `${prefix(path)} 列出了全部样本`);
      const page = await call("GET", prefix(path), { query: "status=all&limit=1" });
      assert.equal(typeof page.body.next_cursor, samples[path].length > 1 ? "string" : "object");
      for (const item of samples[path]) assert.equal((await call("GET", prefix(path, "/{id}"), { id: item.id })).status, 200);
      assert.equal((await call("GET", prefix(path, "/{id}"), { id: MISSING })).status, 404);
    }
    const item = samples[path][0];
    const patched = await call("PATCH", P(path, "/{id}"), { id: item.id, headers: ifMatch(item.version), body: { name: { zh: "改名", en: "Renamed" } } });
    assert.equal(patched.status, 200, patched.text);
  }
  // 给导入的机场指定城市、改坐标（来源信息里 overridden 变成 true），再启用
  const assigned = await call("PATCH", P("places", "/{id}"), { id: imported.id, headers: ifMatch(imported.version), body: { city_id: city.id, location: { lng: 139.51, lat: 35.51 } } });
  assert.equal(assigned.body.source.overridden, true);
  assert.equal((await call("POST", P("places", "/{id}/enable"), { id: imported.id })).status, 200);
  assert.equal((await call("GET", T("places", "/{id}"), { id: imported.id })).status, 200);
  for (const path of ["vehicle-groups", "addons"] as const) {
    const item = samples[path][0];
    assert.equal((await call("POST", P(path, "/{id}/disable"), { id: item.id })).body.status, "disabled");
    assert.equal((await call("POST", P(path, "/{id}/enable"), { id: item.id })).body.status, "active");
  }
  assert.equal((await call("POST", P("places", "/{id}/disable"), { id: poi.id })).body.status, "disabled");
  assert.equal((await call("POST", P("cities", "/{id}/disable"), { id: plainCity.id })).body.status, "disabled");
  assert.equal((await call("POST", P("cities", "/{id}/enable"), { id: plainCity.id })).body.status, "active");
}

/** 实际会返回的错误：404、409、428 都要写在定义里，错误内容符合统一格式。 */
async function exerciseErrorResponses(): Promise<void> {
  const city = await create("cities", cityBody());
  const closedCity = await create("cities", cityBody());
  assert.equal((await call("POST", P("cities", "/{id}/disable"), { id: closedCity.id })).status, 200);
  const base = { name: { zh: "地点" }, location: { lng: 139.7, lat: 35.5 } };
  const airport = await create("places", { ...base, type: "airport", code: "OBA", city_id: city.id });
  const terminal = await create("places", { ...base, type: "terminal", code: "OBA-T1", parent_id: airport.id });
  const group = await create("vehicle-groups", groupBody());
  const addon = await create("addons", addonBody());
  const items: Record<Path, any> = { cities: city, places: airport, "vehicle-groups": group, addons: addon };
  const expectCode = async (pending: Promise<ApiResponse>, status: number, code: string): Promise<void> => {
    const res = await pending;
    assert.deepEqual([res.status, res.body.error.code], [status, code], res.text);
  };

  for (const path of PATHS) {
    const item = items[path];
    const { id: _id, status: _status, version: _version, created_at: _created, updated_at: _updated, source: _source, ...body } = item;
    const createBody = path === "cities" ? { ...body, center: item.center } : path === "places" ? { ...base, type: "airport", code: item.code, city_id: city.id } : body;
    await expectCode(call("POST", P(path), { body: createBody }), 409, "CODE_TAKEN");
    await expectCode(call("POST", P(path), { body: {} }), 400, "VALIDATION_FAILED");
    await expectCode(call("PATCH", P(path, "/{id}"), { id: item.id, body: { name: { zh: "x" } } }), 428, "PRECONDITION_REQUIRED");
    await expectCode(call("PATCH", P(path, "/{id}"), { id: item.id, headers: ifMatch(9), body: { name: { zh: "x" } } }), 409, "VERSION_CONFLICT");
    await expectCode(call("PATCH", P(path, "/{id}"), { id: item.id, headers: ifMatch(1), body: { code: "CHANGED" } }), 409, "FIELD_LOCKED");
    await expectCode(call("PATCH", P(path, "/{id}"), { id: item.id, headers: { "if-match": "abc" }, body: {} }), 400, "VALIDATION_FAILED");
    await expectCode(call("PATCH", P(path, "/{id}"), { id: MISSING, headers: ifMatch(1), body: {} }), 404, "NOT_FOUND");
    await expectCode(call("POST", P(path, "/{id}/disable"), { id: MISSING }), 404, "NOT_FOUND");
    await expectCode(call("POST", P(path, "/{id}/enable"), { id: MISSING }), 404, "NOT_FOUND");
    await expectCode(call("GET", P(path), { query: "limit=0" }), 400, "VALIDATION_FAILED");
    await expectCode(call("GET", T(path), { query: "limit=0" }), 400, "VALIDATION_FAILED");
    await expectCode(call("GET", T(path, "/{id}"), { id: "not-a-uuid" }), 404, "NOT_FOUND");
    await expectCode(call("GET", P(path), { token: tenant.adminToken }), 401, "UNAUTHENTICATED");
    await expectCode(call("GET", T(path), { token: root }), 401, "UNAUTHENTICATED");
  }
  // 地点和城市特有的 409
  await expectCode(call("POST", P("cities", "/{id}/disable"), { id: city.id }), 409, "MASTER_DATA_IN_USE");
  await expectCode(call("POST", P("places", "/{id}/disable"), { id: airport.id }), 409, "MASTER_DATA_IN_USE");
  await expectCode(call("POST", P("places"), { body: { ...base, type: "airport", code: "OBB", city_id: closedCity.id } }), 409, "MASTER_DATA_NOT_READY");
  await expectCode(call("PATCH", P("places", "/{id}"), { id: airport.id, headers: ifMatch(1), body: { city_id: closedCity.id } }), 409, "MASTER_DATA_NOT_READY");
  assert.equal((await call("POST", P("places", "/{id}/disable"), { id: terminal.id })).status, 200);
  assert.equal((await call("POST", P("places", "/{id}/disable"), { id: airport.id })).status, 200);
  await expectCode(call("POST", P("places", "/{id}/enable"), { id: terminal.id }), 409, "MASTER_DATA_NOT_READY");
  await expectCode(call("POST", P("places"), { body: { ...base, type: "terminal", code: "OBA-T2", parent_id: airport.id } }), 409, "MASTER_DATA_NOT_READY");
}

test("定义自检：这里用的结构检查确实能查出缺字段、多字段、类型不对、枚举外的值", () => {
  const good = { id: MISSING, code: "ADD-X1", categories: ["charter"], charge_unit: "per_item", name: { zh: "x" }, description: {}, status: "active", version: 1, created_at: "2026-10-07T01:00:00.000Z", updated_at: "2026-10-07T01:00:00.000Z" };
  const schema = doc.components.schemas["Addon"]!;
  assert.deepEqual(violations(schema, good), []);
  const { version: _version, ...withoutVersion } = good;
  for (const [what, bad] of [
    ["缺字段", withoutVersion],
    ["多字段", { ...good, markup_bps: 1200 }],
    ["类型不对", { ...good, version: "1" }],
    ["枚举外的值", { ...good, status: "deleted" }],
    ["数组元素不对", { ...good, categories: ["bus"] }],
    ["空数组", { ...good, categories: [] }],
    ["嵌套对象多字段", { ...good, name: { zh: "x", fr: "y" } }],
    ["名称为空对象", { ...good, name: {} }],
    ["编号不是 UUID", { ...good, id: "abc" }],
    ["时间格式不对", { ...good, created_at: "2026-10-07 01:00:00" }],
    ["版本小于 1", { ...good, version: 0 }],
  ] as const) {
    assert.notDeepEqual(violations(schema, bad), [], what);
  }
  const place = doc.components.schemas["TenantPlace"]!;
  assert.ok(!("source" in place["properties"]), "租户看到的地点定义里没有导入来源");
  assert.equal(place["additionalProperties"], false);
});

test("四类主数据的每个接口：成功应答逐字段符合定义；实际会返回的错误状态码都写在定义里；定义里的每个主数据接口都调到了，都要求登录，修改接口都声明了 If-Match", async () => {
  await exerciseSuccessResponses();
  await exerciseErrorResponses();

  const documented = Object.entries(doc.paths)
    .filter(([path]) => path.includes("/v1/master/"))
    .flatMap(([path, operations]) => Object.keys(operations).filter((method) => ["get", "post", "patch", "put", "delete"].includes(method)).map((method) => `${method.toUpperCase()} ${path}`));
  assert.equal(documented.length, 32);
  assert.deepEqual([...exercised].sort(), documented.sort());
  for (const [path, operations] of Object.entries(doc.paths)) {
    if (!path.includes("/v1/master/")) continue;
    for (const [method, operation] of Object.entries(operations)) {
      const security = (operation as Schema)["security"] as Record<string, unknown>[] | undefined;
      assert.deepEqual(security?.map((entry) => Object.keys(entry)[0]), [path.startsWith("/tenant/") ? "tenantToken" : "platformToken"], `${method} ${path}`);
      const parameters = (operation.parameters ?? []).map((parameter) => deref(parameter));
      const hasIfMatch = parameters.some((parameter) => parameter["in"] === "header" && parameter["name"] === "If-Match" && parameter["required"] === true);
      assert.equal(hasIfMatch, method === "patch", `${method} ${path}：只有修改接口要 If-Match`);
      if (path.startsWith("/tenant/")) assert.equal(method, "get", "租户的主数据接口只有读");
    }
  }
});

test("定义里的查询参数实现都认（给一个不合格的值会被拒绝，而不是被悄悄忽略）；平台和租户的同一类列表参数相同", async () => {
  for (const path of PATHS) {
    const names = (template: string): string[] =>
      (doc.paths[template]!["get"]!.parameters ?? []).map((parameter) => deref(parameter)).filter((parameter) => parameter["in"] === "query").map((parameter) => parameter["name"] as string).sort();
    const platformNames = names(P(path));
    assert.deepEqual(names(T(path)), platformNames, path);
    assert.ok(platformNames.includes("limit") && platformNames.includes("cursor") && platformNames.includes("status") && platformNames.includes("code") && platformNames.includes("updated_since"), path);
    for (const name of platformNames) {
      for (const template of [P(path), T(path)]) {
        const res = await call("GET", template, { query: `${name}=%00` });
        assert.equal(res.status, 400, `${template}?${name}=…：${res.text}`);
        assert.deepEqual(res.body.error.details.issues.map((issue: { path: string }) => issue.path), [`/${name}`]);
      }
    }
  }
  // 实现里有、定义里没写的筛选：给不合格的值如果被拒绝，说明实现认这个参数，那它就该出现在定义里
  const candidates = ["country_code", "type", "city_id", "parent_id", "grade", "category", "flight_scope", "seats", "power", "charge_unit", "name", "q", "source", "timezone"];
  for (const path of PATHS) {
    const documented = new Set((doc.paths[P(path)]!["get"]!.parameters ?? []).map((parameter) => deref(parameter)["name"] as string));
    for (const name of candidates) {
      if (documented.has(name)) continue;
      const res = await api.call("GET", `${P(path)}?${name}=`, { token: root });
      assert.equal(res.status, 200, `${path} 的实现认 ${name} 这个筛选参数，但定义里没有写`);
    }
  }
});

test("定义里的枚举值和实现里的清单一致", () => {
  const schemas = doc.components.schemas;
  const pairs: [string, readonly string[]][] = [
    ["MasterDataStatus", MASTER_DATA_STATUSES],
    ["PlaceType", PLACE_TYPES],
    ["PlaceCategory", PLACE_CATEGORIES],
    ["FlightScope", FLIGHT_SCOPES],
    ["VehicleGrade", VEHICLE_GRADES],
    ["VehiclePower", VEHICLE_POWERS],
    ["ServiceCategory", SERVICE_CATEGORIES],
    ["AddonChargeUnit", ADDON_CHARGE_UNITS],
  ];
  for (const [name, values] of pairs) assert.deepEqual(schemas[name]?.["enum"], [...values], name);
  assert.deepEqual(Object.keys(schemas["LocalizedText"]?.["properties"] ?? {}), [...MASTER_DATA_LANGUAGES]);
  assert.deepEqual(deref(doc.components.parameters["MasterStatusFilter"]!)["schema"]["enum"], [...MASTER_DATA_STATUSES, "all"]);
});

test("定义里的请求字段和实现一致：新增时每个必填项缺了都是 400、每个选填项缺了都能成功；修改时定义里的每个字段都真的能改", async () => {
  const city = await create("cities", cityBody());
  const otherCity = await create("cities", cityBody());
  const schemas = doc.components.schemas;
  const valid: Record<Path, () => Record<string, unknown>> = {
    cities: cityBody,
    places: () => ({ type: "poi", code: `POI-O${next()}`, city_id: city.id, parent_id: null, name: { zh: "酒店" }, location: { lng: 139.7, lat: 35.6 }, category: "hotel", flight_scope: null, address: "东京都港区 1-1" }),
    "vehicle-groups": groupBody,
    addons: addonBody,
  };
  // 修改时每个字段的一个「和原值不同的合法值」
  const changes: Record<Path, Record<string, unknown>> = {
    cities: { name: { en: "Renamed" }, timezone: "Asia/Seoul", center: { lng: 1.5, lat: 2.5 }, boundary: null },
    places: { city_id: otherCity.id, name: { en: "Renamed" }, location: { lng: 1.5, lat: 2.5 }, category: "mall", flight_scope: null, address: null },
    "vehicle-groups": { name: { en: "Renamed" }, sample_models: ["别的车型"], power: "fuel", combos: [{ passengers: 1, luggage: 0 }] },
    addons: { categories: ["point_to_point"], charge_unit: "per_order", name: { en: "Renamed" }, description: {} },
  };
  // 地点的选填项里，这些是「这个类型必须填」的（定义的说明里写了），单独处理
  const conditionallyRequired: Record<Path, string[]> = { cities: [], places: ["city_id", "category"], "vehicle-groups": [], addons: [] };

  for (const path of PATHS) {
    const createSchema = schemas[`${SCHEMA_NAMES[path]}Create`]!;
    const patchSchema = schemas[`${SCHEMA_NAMES[path]}Patch`]!;
    const sample = valid[path]();
    assert.deepEqual(Object.keys(sample).sort(), Object.keys(createSchema["properties"]).sort(), `${path}：新增请求的字段清单`);
    for (const field of Object.keys(createSchema["properties"])) {
      const body = valid[path]();
      delete body[field];
      const res = await api.call("POST", P(path), { token: root, body });
      const required = (createSchema["required"] as string[]).includes(field) || conditionallyRequired[path].includes(field);
      if (required) {
        assert.equal(res.status, 400, `${path}：缺 ${field} 应当是 400，实际 ${res.status}`);
        assert.deepEqual(res.body.error.details.issues.map((issue: { path: string }) => issue.path), [`/${field}`]);
      } else {
        assert.equal(res.status, 201, `${path}：${field} 是选填，缺了应当能成功：${res.text}`);
      }
    }
    assert.deepEqual(Object.keys(changes[path]).sort(), Object.keys(patchSchema["properties"]).sort(), `${path}：修改请求的字段清单`);
    const target = await create(path, path === "places" ? { ...valid.places(), flight_scope: undefined } : valid[path]());
    let version = target.version as number;
    for (const [field, value] of Object.entries(changes[path])) {
      const res = await api.call("PATCH", P(path, `/${target.id}`), { token: root, headers: ifMatch(version), body: { [field]: value } });
      assert.equal(res.status, 200, `${path}：修改 ${field}：${res.text}`);
      const responseField = field === "city_id" || field in res.body ? field : null;
      assert.ok(responseField, `${path}：应答里有 ${field}`);
      assert.deepEqual(res.body[field], value, `${path}：${field} 改成了提交的值`);
      // flight_scope 原来就是 null：没有变化，版本不加
      const unchanged = path === "places" && field === "flight_scope";
      assert.equal(res.body.version, unchanged ? version : version + 1, `${path}：改了 ${field} 之后的版本`);
      version = res.body.version;
    }
    // 定义里没有的字段：实现不认（被忽略，什么都不改）
    const ignored = await api.call("PATCH", P(path, `/${target.id}`), { token: root, headers: ifMatch(version), body: { status: "disabled", version: 99, id: MISSING, tenant_id: tenant.tenantId, source: null, created_at: "2000-01-01T00:00:00Z" } });
    assert.deepEqual([ignored.status, ignored.body.version, ignored.body.status, ignored.body.id], [200, version, "active", target.id], path);
  }
});
