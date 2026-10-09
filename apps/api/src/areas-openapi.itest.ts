/**
 * M1-02：区域接口（含底图配置、首页数量）的实际行为和 apps/api/openapi.yaml 逐字段对账（测试工程师）。
 * 主数据有 master-data-openapi.itest.ts，区域接口此前没有同类的测试：openapi.test.ts 只核对「有哪些路径」。这里核对内容：
 * - 每个区域接口实际返回的 JSON 逐字段符合定义里的结构（必填、类型、枚举、不多不少），成功和各种失败都算；
 * - 实际会返回的错误状态码都写在了定义里；定义里写的错误码（本期会出现的）都真的能触发；
 * - 定义里的请求字段、必填项、查询参数、枚举值、长度上限和实现一致。
 * 测试数据都在这里构造，结束时连同 schema 一起删除。不联网。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { MAP_TILE_REFERRER_POLICIES } from "@nozomi/config";
import { AREA_BIZ_TYPES, AREA_LIMITS, AREA_POLYGON_KINDS, AREA_POLYGON_SOURCES, AREA_STATUSES } from "@nozomi/domain";
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

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

/** 按定义检查一个值，返回不符合的地方。只实现了 openapi.yaml 里区域相关的定义用到的那些关键字。 */
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
  if (schema["const"] !== undefined && value !== schema["const"]) found.push(`${at}：应为 ${JSON.stringify(schema["const"])}`);
  if (typeof value === "string") {
    if (schema["format"] === "uuid" && !UUID.test(value)) found.push(`${at}：不是 UUID`);
    if (schema["format"] === "date-time" && !DATE_TIME.test(value)) found.push(`${at}：不是带时区的时间`);
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
    if (schema["prefixItems"]) (schema["prefixItems"] as Schema[]).forEach((item, index) => index < value.length && found.push(...violations(item, value[index], `${path}/${index}`)));
  }
  if (actual === "object") {
    const object = value as Record<string, unknown>;
    const properties: Record<string, Schema> = schema["properties"] ?? {};
    for (const key of (schema["required"] as string[] | undefined) ?? []) if (!(key in object)) found.push(`${at}：缺少必填字段 ${key}`);
    if (schema["minProperties"] !== undefined && Object.keys(object).length < schema["minProperties"]) found.push(`${at}：字段少于 ${schema["minProperties"]} 个`);
    for (const [key, item] of Object.entries(object)) {
      if (properties[key]) found.push(...violations(properties[key], item, `${path}/${key}`));
      else if (schema["additionalProperties"] === false) found.push(`${at}：多了定义里没有的字段 ${key}`);
      else if (typeof schema["additionalProperties"] === "object") found.push(...violations(schema["additionalProperties"], item, `${path}/${key}`));
    }
  }
  return found;
}

let api: TestApi;
let mapped: TestApi;
let root: string;
let tenant: TenantFixture;
let tokyo: any;

const MISSING = "99999999-9999-4999-8999-999999999999";
const AREA_OPERATIONS = [
  "GET /tenant/v1/areas",
  "POST /tenant/v1/areas",
  "GET /tenant/v1/areas/{id}",
  "PUT /tenant/v1/areas/{id}",
  "DELETE /tenant/v1/areas/{id}",
  "POST /tenant/v1/areas/{id}/disable",
  "POST /tenant/v1/areas/{id}/enable",
  "POST /tenant/v1/areas/{id}/check-point",
  "GET /tenant/v1/map/config",
  "GET /tenant/v1/dashboard/summary",
];

/** 实际发生过的调用和见过的（状态码，错误码）：用来核对「每个接口都对过账」「定义里写的错误码都触发过」。 */
const exercised = new Set<string>();
const seen = new Set<string>();

/** 调一次接口，并按定义核对这次应答：状态码写在了定义里；应答内容符合那个状态码下的结构。 */
async function call(method: HttpMethod, template: string, options: { id?: string; query?: string; token?: string; body?: unknown; headers?: Record<string, string>; via?: TestApi } = {}): Promise<ApiResponse> {
  const url = template.replace("{id}", options.id ?? "") + (options.query ? `?${options.query}` : "");
  const res = await (options.via ?? api).call(method, url, {
    token: options.token ?? tenant.adminToken,
    ...(options.body === undefined ? {} : { body: options.body }),
    ...(options.headers === undefined ? {} : { headers: options.headers }),
  });
  const operation = doc.paths[template]?.[method.toLowerCase()];
  assert.ok(operation, `定义里没有 ${method} ${template}`);
  exercised.add(`${method} ${template}`);
  seen.add(`${method} ${template} ${res.status}${res.body?.error?.code ? ` ${res.body.error.code}` : ""}`);
  if (res.status === 204) {
    assert.ok(operation.responses["204"], `${method} ${template} 返回了 204，定义里没有写`);
    assert.equal(res.text, "");
    return res;
  }
  // 401、403 是所有需要登录的接口共有的，定义在总说明里，不在每个接口下重复；400 只有写了的接口才逐个核对
  if ([401, 403].includes(res.status) || (res.status === 400 && !operation.responses["400"])) {
    assert.deepEqual(violations(doc.components.schemas["ErrorResponse"]!, res.body), [], res.text);
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

const AREAS = "/tenant/v1/areas";
const ONE = "/tenant/v1/areas/{id}";
const key = (): Record<string, string> => ({ "idempotency-key": randomUUID() });
const ifMatch = (version: number): Record<string, string> => ({ "if-match": `"${version}"` });
const ring = (lng: number, lat: number, size: number): number[][] => [[lng, lat], [lng + size, lat], [lng + size, lat + size], [lng, lat + size], [lng, lat]];
let serial = 0;
const body = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  city_id: tokyo.id,
  name: { zh: `对账区域 ${(serial += 1)}`, ja: `照合エリア ${serial}`, en: `Area ${serial}`, ko: `구역 ${serial}` },
  biz_type: "general",
  polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [ring(139.6, 35.6, 0.2)] } }],
  ...extra,
});
const fullPolygons = [
  { kind: "operate", label: "市区", source: "pasted", geometry: { type: "Polygon", coordinates: [ring(139.6, 35.6, 0.2)] } },
  { kind: "forbid", label: null, circle: { center: { lat: 35.685175, lng: 139.752799 }, radius_m: 1500 } },
  { kind: "forbid", source: "drawn", circle: null, geometry: { type: "Polygon", coordinates: [ring(139.62, 35.62, 0.01)] } },
];

before(async () => {
  api = await createTestApi();
  root = await api.superAdminToken();
  tenant = await api.tenantWithAdmin(root, "区域对账车队", "admin@area-openapi.test");
  const city = await api.call("POST", "/platform/v1/master/cities", {
    token: root,
    body: { code: "CTY-JP-OAA", country_code: "JP", name: { zh: "东京", ja: "東京" }, timezone: "Asia/Tokyo", center: { lng: 139.6917, lat: 35.6895 }, boundary: { type: "Polygon", coordinates: [[[139, 35], [140, 35], [140, 36], [139, 35]]] } },
  });
  assert.equal(city.status, 201, city.text);
  tokyo = city.body;
  // 配了底图的环境：另起一个接口实例，核对 map/config 有值时的结构
  mapped = await createTestApi({
    env: {
      MAP_TILE_URL_TEMPLATE: "https://tiles.example.com/{z}/{x}/{y}.png?key=pk_public",
      MAP_TILE_DARK_URL_TEMPLATE: "https://dark.example.com/{z}/{x}/{y}.png",
      MAP_TILE_ATTRIBUTION: "© 底图甲|https://tiles.example.com/copyright;;只有文字的署名",
      MAP_TILE_REFERRER_POLICY: "origin",
      MAP_TILE_MIN_ZOOM: "4",
      MAP_TILE_MAX_ZOOM: "18",
      MAP_TILE_SIZE: "512",
    },
  });
});
after(async () => {
  await mapped.close();
  await api.close();
});

test("对账用的检查本身咬得住：多一个字段、少一个必填字段、枚举外的值、类型不对、编号不是 UUID、时间没有时区，都会被指出来", async () => {
  const created = await api.call("POST", AREAS, { token: tenant.adminToken, headers: key(), body: body({ polygons: fullPolygons }) });
  assert.equal(created.status, 201, created.text);
  const schema = doc.components.schemas["Area"] as Schema;
  const good = created.body as Record<string, any>;
  assert.deepEqual(violations(schema, good), []);
  const broken: [string, Record<string, unknown>, RegExp][] = [
    ["多一个字段", { ...good, sell_price: 100 }, /多了定义里没有的字段 sell_price/],
    ["少一个必填字段", Object.fromEntries(Object.entries(good).filter(([name]) => name !== "version")), /缺少必填字段 version/],
    ["枚举外的值", { ...good, biz_type: "bus" }, /不在枚举/],
    ["类型不对", { ...good, operate_polygon_count: "1" }, /类型应为 integer/],
    ["编号不是 UUID", { ...good, id: "area-1" }, /不是 UUID/],
    ["时间没有时区", { ...good, updated_at: "2026-10-08 10:00:00" }, /不是带时区的时间/],
    ["图形里多一个字段", { ...good, polygons: [{ ...good["polygons"][0], tenant_id: "x" }, ...good["polygons"].slice(1)] }, /\/polygons\/0：多了定义里没有的字段 tenant_id/],
    ["圆的半径超出范围", { ...good, polygons: [good["polygons"][0], { ...good["polygons"][1], circle: { ...good["polygons"][1].circle, radius_m: 50 } }, good["polygons"][2]] }, /oneOf|小于 100/],
    ["城市少了状态", { ...good, city: Object.fromEntries(Object.entries(good["city"]).filter(([name]) => name !== "status")) }, /缺少必填字段 status/],
  ];
  for (const [what, value, expected] of broken) assert.match(violations(schema, value).join("\n"), expected, what);
  assert.equal((await api.call("DELETE", `/tenant/v1/areas/${good["id"]}`, { token: tenant.adminToken })).status, 204);
});

test("成功的应答逐字段符合定义：新增（多边形 + 圆 + 备注名 + 四种语言）、查看、列表（空、有内容、翻页、各种筛选）、修改、停用、启用、自测三种结果、删除", async () => {
  const empty = await call("GET", AREAS);
  assert.deepEqual(empty.body, { items: [], next_cursor: null, total: 0 });

  const created = await call("POST", AREAS, { headers: key(), body: body({ biz_type: "airport_transfer", polygons: fullPolygons }) });
  assert.equal(created.status, 201, created.text);
  const area = created.body;
  assert.deepEqual([area.polygons.length, area.polygons[1].circle.radius_m, area.city.boundary.type], [3, 1500, "Polygon"]);
  const simple = await call("POST", AREAS, { headers: key(), body: body() });
  assert.equal(simple.status, 201, simple.text);

  assert.equal((await call("GET", ONE, { id: area.id })).status, 200);
  for (const query of ["", "limit=1", "status=active", "status=disabled", "status=all", `city_id=${tokyo.id}`, "biz_type=airport_transfer", `q=${encodeURIComponent("对账")}`, `q=${encodeURIComponent("没有这个名字")}`]) {
    const listed = await call("GET", AREAS, { query });
    assert.equal(listed.status, 200, `${query}：${listed.text}`);
    assert.ok(listed.body.items.every((item: any) => !("polygons" in item)), "列表项不带图形");
  }
  const firstPage = await call("GET", AREAS, { query: "limit=1" });
  assert.equal(typeof firstPage.body.next_cursor, "string");
  assert.equal((await call("GET", AREAS, { query: `limit=1&cursor=${encodeURIComponent(firstPage.body.next_cursor)}` })).body.items.length, 1);

  const updated = await call("PUT", ONE, { id: area.id, headers: ifMatch(1), body: { name: { zh: "改过的对账区域" }, biz_type: "charter", polygons: [...area.polygons.slice(0, 2), { kind: "operate", geometry: { type: "Polygon", coordinates: [ring(140, 35.6, 0.1)] } }] } });
  assert.deepEqual([updated.status, updated.body.version], [200, 2]);
  // GET 拿到的原样提交回去是合法的（定义的说明里写了这一条）
  const echoed = await call("PUT", ONE, { id: area.id, headers: ifMatch(2), body: { city_id: updated.body.city_id, name: updated.body.name, biz_type: updated.body.biz_type, polygons: updated.body.polygons } });
  assert.deepEqual([echoed.status, echoed.body.version], [200, 2]);

  assert.equal((await call("POST", `${ONE}/disable`, { id: area.id })).body.status, "disabled");
  assert.equal((await call("POST", `${ONE}/disable`, { id: area.id })).body.version, 3);
  assert.equal((await call("POST", `${ONE}/enable`, { id: area.id })).body.status, "active");
  const results = [];
  for (const point of [{ lat: 35.61, lng: 139.61 }, { lat: 35.685175, lng: 139.752799 }, { lat: 10, lng: 10 }]) results.push((await call("POST", `${ONE}/check-point`, { id: area.id, body: point })).body.result);
  assert.deepEqual(results, ["operate", "forbid", "outside"]);
  assert.equal((await call("DELETE", ONE, { id: simple.body.id })).status, 204);
});

test("失败的应答：实际会返回的状态码和错误码都写在了定义里，结构符合 ErrorResponse；VALIDATION_FAILED 的每个原因代码都在 AreaInvalid 的说明里", async () => {
  const area = (await call("POST", AREAS, { headers: key(), body: body({ polygons: fullPolygons }) })).body;
  const other = (await call("POST", AREAS, { headers: key(), body: body() })).body;
  const invalidText = String(doc.components.responses["AreaInvalid"]?.["description"]);
  const reasons = new Set<string>();
  const expectInvalid = async (method: HttpMethod, template: string, options: Parameters<typeof call>[2], what: string): Promise<void> => {
    const res = await call(method, template, options);
    assert.deepEqual([res.status, res.body.error.code], [400, "VALIDATION_FAILED"], `${what}：${res.text.slice(0, 200)}`);
    for (const issue of res.body.error.details.issues as { path: string; message: string; reason?: string }[]) {
      assert.equal(typeof issue.path, "string");
      assert.match(issue.message, /[一-鿿]/, "说明是中文");
      if (issue.reason !== undefined) {
        reasons.add(issue.reason);
        assert.ok(invalidText.includes(`\`${issue.reason}\``), `${what}：原因代码 ${issue.reason} 没有写在定义里`);
      }
    }
  };
  const polygon = (coordinates: unknown): unknown => ({ kind: "operate", geometry: { type: "Polygon", coordinates } });
  const shapes: [string, unknown[]][] = [
    ["NO_OPERATE_POLYGON", [{ kind: "forbid", geometry: { type: "Polygon", coordinates: [ring(139.6, 35.6, 0.1)] } }]],
    ["TOO_MANY_POLYGONS", Array.from({ length: 51 }, (_, i) => polygon([ring(139 + i * 0.02, 35, 0.01)]))],
    ["TOO_MANY_TOTAL_VERTICES", Array.from({ length: 6 }, (_, i) => polygon([Array.from({ length: 900 }, (_, k) => [Math.round((139 + i * 0.3 + 0.1 * Math.cos((2 * Math.PI * k) / 900)) * 1e6) / 1e6, Math.round((35 + 0.1 * Math.sin((2 * Math.PI * k) / 900)) * 1e6) / 1e6])]))],
    ["INVALID_COORDINATE", [polygon([[[139, 35], [139.2, 35], [139.2, 95]]])]],
    ["TOO_FEW_POINTS", [polygon([[[139, 35], [139.2, 35]]])]],
    ["TOO_MANY_VERTICES", [polygon([Array.from({ length: 1001 }, (_, k) => [Math.round((139 + 0.1 * Math.cos((2 * Math.PI * k) / 1001)) * 1e6) / 1e6, Math.round((35 + 0.1 * Math.sin((2 * Math.PI * k) / 1001)) * 1e6) / 1e6])])]],
    ["DUPLICATE_POINT", [polygon([[[139, 35], [139.2, 35], [139.2, 35], [139.2, 35.2]]])]],
    ["CROSSES_ANTIMERIDIAN", [polygon([[[179, 35], [-179, 35], [-179, 36], [179, 36]]])]],
    ["COLLINEAR", [polygon([[[139, 35], [139.1, 35.1], [139.2, 35.2]]])]],
    ["SELF_INTERSECTION", [polygon([[[139, 35], [139.2, 35.2], [139.2, 35], [139, 35.2]]])]],
    ["HAS_HOLES", [polygon([ring(139.6, 35.6, 0.2), ring(139.65, 35.65, 0.01)])]],
    ["RADIUS_OUT_OF_RANGE", [{ kind: "operate", circle: { center: { lat: 35.7, lng: 139.7 }, radius_m: 50 } }]],
    ["UNKNOWN_POLYGON", [{ ...(polygon([ring(139.6, 35.6, 0.2)]) as object), id: MISSING }]],
  ];
  for (const [reason, polygons] of shapes) {
    await expectInvalid("POST", AREAS, { headers: key(), body: body({ polygons }) }, reason);
    assert.ok(reasons.has(reason), `没有触发 ${reason}`);
    await expectInvalid("PUT", ONE, { id: area.id, headers: ifMatch(1), body: { name: area.name, biz_type: "general", polygons } }, `修改：${reason}`);
  }
  // 定义里列出的每个原因代码都触发过（定义没有多写）
  for (const documented of invalidText.match(/`[A-Z_]{5,}`/g) ?? []) {
    const code = documented.replace(/`/g, "");
    if (code === "VALIDATION_FAILED") continue;
    assert.ok(reasons.has(code), `定义里写了原因代码 ${code}，但没有任何输入能触发它`);
  }
  await expectInvalid("POST", AREAS, { body: body() }, "没带幂等键");
  await expectInvalid("POST", AREAS, { headers: key(), body: body({ name: {} }) }, "没有名称");
  await expectInvalid("POST", AREAS, { headers: key(), body: body({ city_id: MISSING }) }, "城市不存在");
  await expectInvalid("PUT", ONE, { id: area.id, headers: { "if-match": "abc" }, body: { name: area.name, biz_type: "general", polygons: area.polygons } }, "版本号写法不对");
  await expectInvalid("POST", `${ONE}/check-point`, { id: area.id, body: { lat: 91, lng: 0 } }, "自测：纬度超范围");
  await expectInvalid("GET", AREAS, { query: "limit=0" }, "列表：limit");

  const expectError = async (method: HttpMethod, template: string, options: Parameters<typeof call>[2], status: number, code: string): Promise<ApiResponse> => {
    const res = await call(method, template, options);
    assert.deepEqual([res.status, res.body?.error?.code], [status, code], `${method} ${template}：${res.text.slice(0, 200)}`);
    return res;
  };
  // 新增
  await expectError("POST", AREAS, { headers: key(), body: body({ name: area.name }) }, 409, "AREA_NAME_TAKEN");
  const usedKey = key();
  assert.equal((await call("POST", AREAS, { headers: usedKey, body: body() })).status, 201);
  await expectError("POST", AREAS, { headers: usedKey, body: body() }, 422, "IDEMPOTENCY_KEY_REUSED");
  // 查看、修改、删除、停用、启用、自测：不存在的
  await expectError("GET", ONE, { id: MISSING }, 404, "NOT_FOUND");
  await expectError("GET", ONE, { id: "not-a-uuid" }, 404, "NOT_FOUND");
  await expectError("PUT", ONE, { id: MISSING, headers: ifMatch(1), body: { name: area.name, biz_type: "general", polygons: area.polygons } }, 404, "NOT_FOUND");
  await expectError("DELETE", ONE, { id: MISSING }, 404, "NOT_FOUND");
  await expectError("POST", `${ONE}/disable`, { id: MISSING }, 404, "NOT_FOUND");
  await expectError("POST", `${ONE}/enable`, { id: MISSING }, 404, "NOT_FOUND");
  await expectError("POST", `${ONE}/check-point`, { id: MISSING, body: { lat: 35.7, lng: 139.7 } }, 404, "NOT_FOUND");
  // 修改
  const same = { name: area.name, biz_type: "general", polygons: area.polygons };
  await expectError("PUT", ONE, { id: area.id, body: same }, 428, "PRECONDITION_REQUIRED");
  const conflict = await expectError("PUT", ONE, { id: area.id, headers: ifMatch(7), body: same }, 409, "VERSION_CONFLICT");
  assert.equal(conflict.body.error.details.current_version, 1);
  const locked = await expectError("PUT", ONE, { id: area.id, headers: ifMatch(1), body: { ...same, city_id: MISSING } }, 409, "FIELD_LOCKED");
  assert.deepEqual(locked.body.error.details.fields, ["city_id"]);
  await expectError("PUT", ONE, { id: area.id, headers: ifMatch(1), body: { ...same, name: other.name } }, 409, "AREA_NAME_TAKEN");
  // 城市被停用：新增、启用
  const city = await api.call("POST", "/platform/v1/master/cities", { token: root, body: { code: "CTY-JP-OAB", country_code: "JP", name: { zh: "要停用的城市" }, timezone: "Asia/Tokyo", center: { lng: 135.5, lat: 34.7 } } });
  const parked = (await call("POST", AREAS, { headers: key(), body: body({ city_id: city.body.id }) })).body;
  assert.equal((await call("POST", `${ONE}/disable`, { id: parked.id })).status, 200);
  assert.equal((await api.call("POST", `/platform/v1/master/cities/${city.body.id}/disable`, { token: root, headers: ifMatch(city.body.version) })).status, 200);
  const notReady = await expectError("POST", AREAS, { headers: key(), body: body({ city_id: city.body.id }) }, 409, "MASTER_DATA_NOT_READY");
  assert.equal(notReady.body.error.details.reason, "CITY_DISABLED");
  await expectError("POST", `${ONE}/enable`, { id: parked.id }, 409, "MASTER_DATA_NOT_READY");
  // 城市停用以后区域的应答里带着城市的当前状态，结构照样符合定义
  assert.equal((await call("GET", ONE, { id: parked.id })).body.city.status, "disabled");
  assert.equal((await call("GET", AREAS, { query: `city_id=${city.body.id}` })).body.items[0].city.status, "disabled");
  // 权限
  const dispatcher = await addTenantUser(api, tenant.adminToken, "dispatch@area-openapi.test", "dispatch");
  await expectError("GET", AREAS, { token: dispatcher.token }, 403, "FORBIDDEN");
  await expectError("GET", AREAS, { token: "not-a-token" }, 401, "UNAUTHENTICATED");
  await expectError("GET", AREAS, { token: root }, 401, "UNAUTHENTICATED");
});

test("底图配置和首页数量：没有配置时 tiles 是 null；配置了以后每个字段符合定义；没有 area.read 的角色的 areas 是 null", async () => {
  const none = await call("GET", "/tenant/v1/map/config");
  assert.deepEqual(none.body, { tiles: null });
  const otherRoot = await mapped.superAdminToken();
  const otherTenant = await mapped.tenantWithAdmin(otherRoot, "配了底图的车队", "admin@mapped.test");
  const configured = await call("GET", "/tenant/v1/map/config", { via: mapped, token: otherTenant.adminToken });
  assert.deepEqual(configured.body, {
    tiles: {
      url_template: "https://tiles.example.com/{z}/{x}/{y}.png?key=pk_public",
      dark_url_template: "https://dark.example.com/{z}/{x}/{y}.png",
      min_zoom: 4,
      max_zoom: 18,
      tile_size: 512,
      referrer_policy: "origin",
      attribution: [{ text: "© 底图甲", href: "https://tiles.example.com/copyright" }, { text: "只有文字的署名", href: null }],
    },
  });
  const summary = await call("GET", "/tenant/v1/dashboard/summary");
  assert.equal(typeof summary.body.areas.active, "number");
  const finance = await addTenantUser(api, tenant.adminToken, "finance@area-openapi.test", "finance");
  assert.deepEqual((await call("GET", "/tenant/v1/dashboard/summary", { token: finance.token })).body, { areas: null });
  assert.equal((await call("GET", "/tenant/v1/map/config", { token: finance.token })).status, 200);
});

test("定义里的请求字段、必填项、枚举、上限和实现一致", async () => {
  const schemas = doc.components.schemas;
  // 枚举
  assert.deepEqual(schemas["AreaBizType"]?.["enum"], [...AREA_BIZ_TYPES]);
  assert.deepEqual(schemas["AreaPolygonKind"]?.["enum"], [...AREA_POLYGON_KINDS]);
  assert.deepEqual(schemas["AreaPolygonSource"]?.["enum"], [...AREA_POLYGON_SOURCES]);
  assert.deepEqual(deref(schemas["Area"]?.["properties"]["status"])["enum"], [...AREA_STATUSES]);
  assert.deepEqual(schemas["MapConfig"]?.["properties"]["tiles"]["properties"]["referrer_policy"]["enum"], [...MAP_TILE_REFERRER_POLICIES]);
  // 必填项：定义里写了必填的，少了就是 400；没写必填的，少了照样能建
  const create = schemas["AreaCreate"] as Schema;
  assert.deepEqual([...create["required"]].sort(), ["biz_type", "city_id", "name", "polygons"]);
  for (const field of create["required"] as string[]) {
    const payload = body();
    delete payload[field];
    const res = await call("POST", AREAS, { headers: key(), body: payload });
    assert.equal(res.status, 400, `少了必填的 ${field}`);
    assert.ok(res.body.error.details.issues.some((issue: any) => issue.path === `/${field}`), `${field}：${res.text}`);
  }
  const input = schemas["AreaPolygonInput"] as Schema;
  assert.deepEqual(input["required"], ["kind"]);
  assert.deepEqual(Object.keys(input["properties"]).sort(), ["circle", "geometry", "id", "kind", "label", "source"]);
  assert.equal((await call("POST", AREAS, { headers: key(), body: body({ polygons: [{ geometry: { type: "Polygon", coordinates: [ring(139.6, 35.6, 0.2)] } }] }) })).status, 400, "图形少了 kind");
  // 只给 kind + geometry、只给 kind + circle 都能建（别的都是选填）
  assert.equal((await call("POST", AREAS, { headers: key(), body: body({ polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [ring(139.6, 35.6, 0.2)] } }] }) })).status, 201);
  assert.equal((await call("POST", AREAS, { headers: key(), body: body({ polygons: [{ kind: "operate", circle: { center: { lat: 35.7, lng: 139.7 }, radius_m: 1000 } }] }) })).status, 201);
  // 修改：city_id 不是必填
  const update = schemas["AreaUpdate"] as Schema;
  assert.deepEqual([...update["required"]].sort(), ["biz_type", "name", "polygons"]);
  assert.deepEqual(Object.keys(update["properties"]).sort(), ["biz_type", "city_id", "name", "polygons"]);
  // 上限：备注名、圆的半径、名称的长度写的是 domain 里的数
  assert.equal(input["properties"]["label"]["maxLength"], AREA_LIMITS.maxLabelLength);
  assert.equal(deref(schemas["AreaPolygon"] as Schema)["properties"]["label"]["maxLength"], AREA_LIMITS.maxLabelLength);
  const circle = schemas["AreaCircle"] as Schema;
  const radius = deref(circle["properties"]["radius_m"]);
  assert.deepEqual([radius["type"], radius["minimum"], radius["maximum"]], ["integer", AREA_LIMITS.minRadiusM, AREA_LIMITS.maxRadiusM]);
  const createText = String(doc.paths[AREAS]?.["post"]?.description);
  for (const limit of [AREA_LIMITS.maxPolygons, AREA_LIMITS.maxRingVertices, AREA_LIMITS.maxTotalVertices, AREA_LIMITS.minRadiusM, AREA_LIMITS.maxRadiusM]) assert.ok(createText.includes(String(limit)), `新增接口的说明里没有写上限 ${limit}`);
  // 查询参数：定义里写的每一个接口都认；定义里没有的不认（400）还是被忽略——至少不能改变结果
  const parameters = (doc.paths[AREAS]?.["get"]?.parameters ?? []).map((parameter) => deref(parameter)["name"] as string);
  assert.deepEqual(parameters.sort(), ["biz_type", "city_id", "cursor", "limit", "q", "status"]);
  const statusEnum = deref((doc.paths[AREAS]?.["get"]?.parameters ?? []).map(deref).find((parameter) => parameter["name"] === "status") as Schema)["schema"]["enum"] as string[];
  for (const status of statusEnum) assert.equal((await call("GET", AREAS, { query: `status=${status}` })).status, 200, status);
  assert.equal((await call("GET", AREAS, { query: "status=archived" })).status, 400);
  // 请求头
  const idempotency = deref(doc.components.parameters["IdempotencyKey"] as Schema);
  assert.deepEqual([idempotency["in"], idempotency["required"], idempotency["schema"]["pattern"]], ["header", true, "^[A-Za-z0-9_.:-]{8,128}$"]);
  assert.ok((doc.paths[AREAS]?.["post"]?.parameters ?? []).some((parameter) => parameter["$ref"] === "#/components/parameters/IdempotencyKey"));
  assert.ok((doc.paths[ONE]?.["put"]?.parameters ?? []).some((parameter) => parameter["$ref"] === "#/components/parameters/IfMatch"));
  // 自测的请求体
  const point = doc.paths[`${ONE}/check-point`]?.["post"]?.requestBody?.content["application/json"].schema as Schema;
  assert.deepEqual([point["required"], point["properties"]["lat"]["minimum"], point["properties"]["lat"]["maximum"], point["properties"]["lng"]["minimum"], point["properties"]["lng"]["maximum"]], [["lat", "lng"], -90, 90, -180, 180]);
});

test("每个区域接口都对过账；定义里没有实现之外的区域路径", () => {
  assert.deepEqual([...exercised].sort(), [...AREA_OPERATIONS].sort());
  const documented = Object.entries(doc.paths)
    .filter(([path]) => /^\/tenant\/v1\/(areas|map|dashboard)/.test(path))
    .flatMap(([path, operations]) => Object.keys(operations).filter((method) => ["get", "post", "put", "patch", "delete"].includes(method)).map((method) => `${method.toUpperCase()} ${path}`));
  assert.deepEqual(documented.sort(), [...AREA_OPERATIONS].sort());
  const registered = api.app.registeredRoutes
    .filter((route) => route.method !== "HEAD" && /^\/tenant\/v1\/(areas|map|dashboard)/.test(route.path))
    .map((route) => `${route.method} ${route.path.replace(":id", "{id}")}`);
  assert.deepEqual(registered.sort(), [...AREA_OPERATIONS].sort());
  // 本期会出现的错误码都真的见过
  for (const expected of [
    "POST /tenant/v1/areas 409 AREA_NAME_TAKEN",
    "POST /tenant/v1/areas 409 MASTER_DATA_NOT_READY",
    "POST /tenant/v1/areas 422 IDEMPOTENCY_KEY_REUSED",
    "PUT /tenant/v1/areas/{id} 409 VERSION_CONFLICT",
    "PUT /tenant/v1/areas/{id} 409 FIELD_LOCKED",
    "PUT /tenant/v1/areas/{id} 409 AREA_NAME_TAKEN",
    "PUT /tenant/v1/areas/{id} 428 PRECONDITION_REQUIRED",
    "POST /tenant/v1/areas/{id}/enable 409 MASTER_DATA_NOT_READY",
  ]) {
    assert.ok(seen.has(expected), `没有见到 ${expected}`);
  }
});
