/**
 * M1-05：价格规则和库存的 Excel 批量导入导出——下载模版 / 导出 → 上传预览（只校验不写入）→ 确认导入（全部成功或全部失败）。
 * 跨租户的验证在 tenant-isolation.itest.ts。全部经真实接口、真实 PostgreSQL；上传的文件都是测试里现场拼的。
 * 测试时钟固定在 2026-10-07 10:00（东京）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { XLSX_CONTENT_TYPE, XLSX_LIMITS, type XlsxWriteCell, readXlsx, writeXlsx } from "./integrations/xlsx.ts";
import { type ApiResponse, type HttpMethod, type TenantFixture, type TestApi, addTenantUser, createTestApi } from "./testing/api.ts";
import { unzipEntry } from "./integrations/zip.ts";
import { type TestZipOptions, buildZip } from "./testing/zip.ts";

let api: TestApi;
let root: string;
let tenant: TenantFixture;
const MISSING = "99999999-9999-4999-8999-999999999999";
const ids: Record<string, string> = {};
const TODAY = "2026-10-07";

const platform = (method: HttpMethod, path: string, body?: unknown): Promise<ApiResponse> => api.call(method, `/platform/v1${path}`, { token: root, ...(body === undefined ? {} : { body }) });
const call = (method: HttpMethod, path: string, options: { token?: string; body?: unknown; version?: number } = {}): Promise<ApiResponse> =>
  api.call(method, `/tenant/v1${path}`, {
    token: options.token ?? tenant.adminToken,
    ...(options.body === undefined ? {} : { body: options.body }),
    headers: { ...(options.version === undefined ? {} : { "if-match": `"${options.version}"` }), ...(method === "POST" && /(^\/(products|brands|areas)$)|\/price-rules$/.test(path) ? { "idempotency-key": randomUUID() } : {}) },
  });

async function ok(res: Promise<ApiResponse>, status = 200): Promise<any> {
  const done = await res;
  assert.equal(done.status, status, done.text);
  return done.body;
}

/** 上传一个文件（请求体就是文件本身）。 */
async function upload(path: string, file: Buffer, options: { token?: string; version?: number; key?: string | null; contentType?: string } = {}): Promise<ApiResponse> {
  const res = await api.app.inject({
    method: "POST",
    url: `/tenant/v1${path}`,
    payload: file,
    headers: {
      "content-type": options.contentType ?? XLSX_CONTENT_TYPE,
      authorization: `Bearer ${options.token ?? tenant.adminToken}`,
      ...(options.version === undefined ? {} : { "if-match": `"${options.version}"` }),
      ...(options.key === null || !path.includes("/import?") ? {} : { "idempotency-key": options.key ?? randomUUID() }),
    },
  });
  let body: any = null;
  try {
    body = res.json();
  } catch {
    body = null;
  }
  return { status: res.statusCode, headers: res.headers, text: res.body, body };
}

/** 下载一个导出的文件，读出第一张表。 */
async function download(path: string, token: string = tenant.adminToken): Promise<{ status: number; headers: Record<string, unknown>; rows: (string | null)[][]; bytes: Buffer }> {
  const res = await api.app.inject({ method: "GET", url: `/tenant/v1${path}`, headers: { authorization: `Bearer ${token}` } });
  const bytes = res.rawPayload;
  const rows = res.statusCode === 200 ? readXlsx(bytes).map((cells) => cells.map((cell) => (cell.type === "text" || cell.type === "number" ? cell.text : null))) : [];
  return { status: res.statusCode, headers: res.headers, rows, bytes };
}

const sheet = (rows: XlsxWriteCell[][]): Buffer => writeXlsx([{ name: "价格", rows }]);
const num = (value: number | string): XlsxWriteCell => ({ number: String(value) });
const sha = (file: Buffer): string => createHash("sha256").update(file).digest("hex");

const TRANSFER_HEADER = ["价格编号", "区域", "车型组", "方向", "计价方式", "基础价", "起步价", "起步里程(公里)", "起步时长(分钟)", "每公里单价", "每分钟单价", "最低消费", "生效开始", "生效结束", "状态"];
const CHARTER_HEADER = ["价格编号", "区域", "车型组", "套餐时长(小时)", "套餐公里", "套餐价", "超时单价(每小时)", "超公里单价(每公里)", "生效开始", "生效结束", "状态"];
/** 接送机的一行一口价。 */
const fixedRow = (extra: Partial<Record<string, XlsxWriteCell>> = {}): XlsxWriteCell[] => {
  const values: Record<string, XlsxWriteCell> = { 区域: "东京市区", 车型组: "VG-BIZ-7", 方向: "接送通用", 计价方式: "一口价", 基础价: num(20000), 生效开始: "2026-10-01", ...extra };
  return TRANSFER_HEADER.map((column) => values[column] ?? null);
};

async function product(category: "airport_transfer" | "charter" = "airport_transfer", brand = "brand"): Promise<string> {
  api.clock.advance(1_000);
  const body = {
    brand_id: ids[brand],
    city_id: ids["tokyo"],
    category,
    ...(category === "airport_transfer" ? { poi_id: ids["narita"] } : {}),
    areas: [{ area_id: ids["a1"] }, { area_id: ids["a2"] }],
    vehicle_groups: [{ vehicle_group_id: ids["biz7"], passengers: 6, luggage: 2 }, { vehicle_group_id: ids["eco4"], passengers: 3, luggage: 2 }],
  };
  return (await ok(call("POST", "/products", { body }), 201)).id;
}

const prices = (productId: string): Promise<any> => ok(call("GET", `/products/${productId}/price-rules`));
const preview = async (productId: string, file: Buffer): Promise<any> => ok(upload(`/products/${productId}/price-rules/import/preview`, file));
const rowSummary = (body: any): unknown[] => body.rows.map((row: any) => [row.row, row.action, row.issues.map((issue: any) => `${issue.cell} ${issue.reason}`)]);

before(async () => {
  api = await createTestApi();
  root = await api.superAdminToken();
  tenant = await api.tenantWithAdmin(root, "甲车队", "admin@a.test");
  ids["tokyo"] = (await ok(platform("POST", "/master/cities", { country_code: "JP", timezone: "Asia/Tokyo", code: "CTY-JP-TYO", name: { zh: "东京" }, center: { lng: 139.6917, lat: 35.6895 } }), 201)).id;
  ids["narita"] = (await ok(platform("POST", "/master/places", { location: { lng: 140.3887, lat: 35.7686 }, type: "airport", code: "NRT", city_id: ids["tokyo"], name: { zh: "成田机场" }, flight_scope: "international" }), 201)).id;
  ids["biz7"] = (await ok(platform("POST", "/master/vehicle-groups", { grade: "business", seats: 7, power: "fuel", combos: [{ passengers: 6, luggage: 2 }], code: "VG-BIZ-7", name: { zh: "商务 7 座" } }), 201)).id;
  ids["eco4"] = (await ok(platform("POST", "/master/vehicle-groups", { grade: "economy", seats: 4, power: "fuel", combos: [{ passengers: 3, luggage: 2 }], code: "VG-ECO-4", name: { zh: "经济 4 座" } }), 201)).id;
  ids["brand"] = (await ok(call("POST", "/brands", { body: { name: "甲车队 JP", currency: "JPY" } }), 201)).id;
  ids["usd"] = (await ok(call("POST", "/brands", { body: { name: "甲车队 USD", currency: "USD" } }), 201)).id;
  const polygon = { kind: "operate", geometry: { type: "Polygon", coordinates: [[[139.6, 35.6], [139.8, 35.6], [139.8, 35.8], [139.6, 35.8], [139.6, 35.6]]] } };
  ids["a1"] = (await ok(call("POST", "/areas", { body: { city_id: ids["tokyo"], name: { zh: "东京市区", en: "Central Tokyo" }, biz_type: "general", polygons: [polygon] } }), 201)).id;
  api.clock.advance(1_000);
  ids["a2"] = (await ok(call("POST", "/areas", { body: { city_id: ids["tokyo"], name: { zh: "=横滨+川崎" }, biz_type: "general", polygons: [polygon] } }), 201)).id;
});
after(() => api.close());

test("下载模版：只有表头，不预置任何价格；第二张表列出这个商品可以填的区域和车型组；导出则带上现有的价格（金额是主单位）", async () => {
  const id = await product();
  const template = await download(`/products/${id}/price-rules/export?rows=none`);
  assert.equal(template.status, 200);
  assert.equal(template.headers["content-type"], XLSX_CONTENT_TYPE);
  assert.match(String(template.headers["content-disposition"]), /^attachment; filename="PRD\d+-prices-template\.xlsx"$/);
  assert.deepEqual(template.rows, [TRANSFER_HEADER]);
  // 「填写说明」里有区域名和车型组编码；会被 Excel 当成公式的区域名前面加了单引号
  const help = Buffer.from(template.bytes).toString("latin1");
  assert.ok(help.length > 0);
  const { unzipEntry } = await import("./integrations/zip.ts");
  const helpXml = unzipEntry(template.bytes, "xl/worksheets/sheet2.xml").toString("utf8");
  for (const expected of ["东京市区", "'=横滨+川崎", "VG-BIZ-7", "VG-ECO-4", "JPY", "接机、送机、接送通用"]) assert.ok(helpXml.includes(expected), expected);

  await ok(call("POST", `/products/${id}/price-rules`, { version: 1, body: { area_id: ids["a1"], vehicle_group_id: ids["biz7"], direction: "pickup", pricing_model: "fixed", base_price: 20_000, valid_from: "2026-10-01", valid_to: "2027-03-31" } }), 201);
  api.clock.advance(1_000);
  await ok(call("POST", `/products/${id}/price-rules`, { version: 2, body: { area_id: ids["a2"], vehicle_group_id: ids["eco4"], direction: "both", pricing_model: "mileage_time", start_price: 3_000, start_meters: 5_500, start_minutes: 20, per_km: 400, per_minute: 80, valid_from: "2026-10-01", status: "disabled" } }), 201);
  const exported = await download(`/products/${id}/price-rules/export`);
  const rules = (await prices(id)).items;
  assert.deepEqual(exported.rows, [
    TRANSFER_HEADER,
    [rules[0].id, "东京市区", "VG-BIZ-7", "接机", "固定一口价", "20000", null, null, null, null, null, null, "2026-10-01", "2027-03-31", "启用"],
    [rules[1].id, "=横滨+川崎", "VG-ECO-4", "接送通用", "里程 + 时长", null, "3000", "5.5", "20", "400", "80", null, "2026-10-01", null, "停用"],
  ]);
  // 导出的文件原样传回去：全部「没有变化」
  const again = await preview(id, exported.bytes);
  assert.deepEqual([again.summary, again.can_import], [{ rows: 2, create: 0, update: 0, unchanged: 2, error: 0, conflict: 0 }, false]);
  // 两位小数的币种：导出的是主单位
  const usd = await product("charter", "usd");
  await ok(call("POST", `/products/${usd}/price-rules`, { version: 1, body: { area_id: ids["a1"], vehicle_group_id: ids["biz7"], package_hours: 10, pricing_model: "charter_package", package_km: 300, package_price: 98_050, overtime_per_hour: 5_000, over_km_per_km: 5, valid_from: "2026-10-01" } }), 201);
  const charter = await download(`/products/${usd}/price-rules/export`);
  assert.deepEqual(charter.rows[0], CHARTER_HEADER);
  assert.deepEqual(charter.rows[1]?.slice(1), ["东京市区", "VG-BIZ-7", "10", "300", "980.50", "50.00", "0.05", "2026-10-01", null, "启用"]);
  // 导出失败时是统一的 JSON 错误格式，不是文件（页面按 Content-Type 分辨）
  const failed = await api.app.inject({ method: "GET", url: `/tenant/v1/products/${MISSING}/price-rules/export`, headers: { authorization: `Bearer ${tenant.adminToken}` } });
  assert.deepEqual([failed.statusCode, String(failed.headers["content-type"]).split(";")[0], failed.json().error.code, failed.headers["content-disposition"]], [404, "application/json", "NOT_FOUND", undefined]);
  const badRange = await api.app.inject({ method: "GET", url: `/tenant/v1/products/${id}/inventory/export?from=2026-10-09&to=2026-10-01`, headers: { authorization: `Bearer ${tenant.adminToken}` } });
  assert.deepEqual([badRange.statusCode, String(badRange.headers["content-type"]).split(";")[0], badRange.json().error.code], [400, "application/json", "VALIDATION_FAILED"]);
  assert.equal((await download(`/products/${MISSING}/price-rules/export`)).status, 404);
  assert.equal((await api.app.inject({ method: "GET", url: `/tenant/v1/products/${id}/price-rules/export?rows=some`, headers: { authorization: `Bearer ${tenant.adminToken}` } })).statusCode, 400);
});

test("预览：只校验不写入——逐行给出新增 / 修改 / 没变 / 出错 / 冲突，出错的指到单元格；返回文件指纹和商品的版本号", async () => {
  const id = await product();
  const existing = (await ok(call("POST", `/products/${id}/price-rules`, { version: 1, body: { area_id: ids["a1"], vehicle_group_id: ids["biz7"], direction: "pickup", pricing_model: "fixed", base_price: 20_000, valid_from: "2026-10-01", valid_to: "2026-12-31" } }), 201)).price_rule;
  const before = await prices(id);
  const file = sheet([
    TRANSFER_HEADER,
    fixedRow({ 价格编号: existing.id, 方向: "接机", 基础价: num(21000), 生效结束: "2026-12-31" }), // 2 修改
    fixedRow({ 车型组: "vg-eco-4", 方向: "pickup", 基础价: "12,000" }), // 3 新增（编码不分大小写、英文方向、带千分位的文字）
    fixedRow({ 区域: "Central Tokyo", 方向: "送机", 计价方式: "里程+时长", 基础价: null, 起步价: num(3000), "起步里程(公里)": num("5.5"), "起步时长(分钟)": num(20), 每公里单价: num(400), 每分钟单价: num(80), 生效开始: num(46296), 状态: "停用" }), // 4 新增（英文区域名、Excel 日期序号）
    [], // 空行跳过
    fixedRow({ 区域: "大阪", 车型组: "VG-LUX-4", 方向: "往返", 计价方式: "按人", 生效开始: "10/01/2026" }), // 6 出错
    fixedRow({ 方向: "送机", 基础价: num("20000.5") }), // 7 日元不能有小数
    fixedRow({ 方向: "送机", 基础价: num(0), 生效开始: "2026-10-02", 生效结束: "2026-10-01" }), // 8 范围和日期倒置（domain 的检查）
    fixedRow({ 价格编号: MISSING }), // 9 编号不是这个商品的
    fixedRow({ 方向: "送机", 起步价: num(100), 基础价: null }), // 10 一口价不填起步价、缺基础价
    fixedRow({ 区域: null, 车型组: null, 方向: null, 计价方式: null, 生效开始: null, 状态: "暂停" }), // 11 必填都空着
  ]);
  const body = await preview(id, file);
  assert.deepEqual(Object.keys(body).sort(), ["can_import", "currency", "file_sha256", "rows", "summary", "version"]);
  assert.deepEqual([body.version, body.file_sha256, body.currency, body.can_import], [before.version, sha(file), "JPY", false]);
  assert.deepEqual(body.summary, { rows: 9, create: 2, update: 1, unchanged: 0, error: 6, conflict: 0 });
  assert.deepEqual(rowSummary(body), [
    [2, "update", []],
    [3, "create", []],
    [4, "create", []],
    [6, "error", ["B6 AREA_NOT_IN_PRODUCT", "C6 VEHICLE_GROUP_NOT_IN_PRODUCT", "D6 UNKNOWN_VALUE", "E6 UNKNOWN_VALUE", "M6 INVALID_DATE"]],
    [7, "error", ["F7 PRECISION"]],
    [8, "error", ["F8 OUT_OF_RANGE", "N8 DATE_RANGE_REVERSED"]],
    [9, "error", ["A9 UNKNOWN_PRICE_RULE"]],
    [10, "error", ["G10 NOT_APPLICABLE", "F10 REQUIRED"]],
    [11, "error", ["B11 REQUIRED", "C11 REQUIRED", "D11 REQUIRED", "E11 REQUIRED", "M11 REQUIRED", "O11 UNKNOWN_VALUE"]],
  ]);
  assert.deepEqual([body.rows[0].price_rule_id, body.rows[1].price_rule_id], [existing.id, null]);
  // 每一行带着它读到的内容，新增的行也有：确认前可以核对「新增的是不是我想的那些」
  assert.deepEqual(Object.keys(body.rows[0]).sort(), ["action", "conflicts_with", "content", "issues", "price_rule_id", "row"]);
  assert.deepEqual(body.rows.slice(0, 3).map((row: any) => row.content), [
    { area: "东京市区", vehicle_group: "VG-BIZ-7", direction: "pickup", package_hours: null, pricing_model: "fixed", main_price: 21_000, valid_from: "2026-10-01", valid_to: "2026-12-31", status: "enabled" },
    { area: "东京市区", vehicle_group: "VG-ECO-4", direction: "pickup", package_hours: null, pricing_model: "fixed", main_price: 12_000, valid_from: "2026-10-01", valid_to: null, status: "enabled" },
    { area: "东京市区", vehicle_group: "VG-BIZ-7", direction: "dropoff", package_hours: null, pricing_model: "mileage_time", main_price: 3_000, valid_from: "2026-10-01", valid_to: null, status: "disabled" },
  ]);
  // 出错的行：认得出来的照样带着，认不出来的写表里填的原文，读不出来的是 null
  assert.deepEqual(body.rows[3].content, { area: "大阪", vehicle_group: "VG-LUX-4", direction: null, package_hours: null, pricing_model: null, main_price: null, valid_from: null, valid_to: null, status: "enabled" });
  assert.deepEqual([body.rows[4].content.main_price, body.rows[4].content.direction, body.rows[8].content.area], [null, "dropoff", null]);
  const issue = body.rows[4].issues[0];
  assert.deepEqual([issue.cell, issue.column, issue.reason, typeof issue.message], ["F7", "基础价", "PRECISION", "string"]);
  assert.ok(body.rows.flatMap((row: any) => row.issues).every((entry: any) => entry.message.length > 0));
  // 什么都没写：价格、版本号、审计日志都没变
  assert.deepEqual(await prices(id), before);
  assert.equal((await api.db.owner.query("select count(*)::int as n from audit_logs where resource = 'price_rule'")).rows[0].n >= 1, true);
  // 冲突：文件里两行互相重叠；一行和库里没动的那条重叠
  const conflicts = await preview(id, sheet([TRANSFER_HEADER, fixedRow({ 方向: "送机" }), fixedRow({ 方向: "送机", 生效开始: "2027-01-01" }), fixedRow({ 方向: "接机", 生效开始: "2026-11-01" }), fixedRow({ 车型组: "VG-ECO-4" })]));
  assert.deepEqual(conflicts.summary, { rows: 4, create: 1, update: 0, unchanged: 0, error: 0, conflict: 3 });
  assert.deepEqual(conflicts.rows.map((row: any) => [row.row, row.action, row.conflicts_with]), [
    [2, "conflict", [{ row: 3, price_rule_id: null, area: "东京市区", vehicle_group: "VG-BIZ-7", direction: "dropoff", package_hours: null, valid_from: "2027-01-01", valid_to: null }]],
    [3, "conflict", [{ row: 2, price_rule_id: null, area: "东京市区", vehicle_group: "VG-BIZ-7", direction: "dropoff", package_hours: null, valid_from: "2026-10-01", valid_to: null }]],
    [4, "conflict", [{ row: null, price_rule_id: existing.id, area: "东京市区", vehicle_group: "VG-BIZ-7", direction: "pickup", package_hours: null, valid_from: "2026-10-01", valid_to: "2026-12-31" }]],
    [5, "create", []],
  ]);
  assert.equal(conflicts.can_import, false);
});

test("确认导入：文件指纹和商品版本号都对才写入，全部成功或全部失败；带幂等键；每条变了的价格各有一条审计日志", async () => {
  const id = await product();
  const existing = (await ok(call("POST", `/products/${id}/price-rules`, { version: 1, body: { area_id: ids["a1"], vehicle_group_id: ids["biz7"], direction: "pickup", pricing_model: "fixed", base_price: 20_000, valid_from: "2026-10-01" } }), 201)).price_rule;
  const file = sheet([TRANSFER_HEADER, fixedRow({ 价格编号: existing.id, 方向: "接机", 基础价: num(21000) }), fixedRow({ 方向: "送机", 基础价: num(19000) }), fixedRow({ 区域: "=横滨+川崎", 车型组: "VG-ECO-4", 基础价: num(12000) })]);
  const seen = await preview(id, file);
  assert.deepEqual([seen.can_import, seen.summary], [true, { rows: 3, create: 2, update: 1, unchanged: 0, error: 0, conflict: 0 }]);
  const path = `/products/${id}/price-rules/import?file_sha256=${seen.file_sha256}`;
  // 缺幂等键、缺版本号、缺指纹
  assert.equal((await upload(path, file, { version: seen.version, key: null })).status, 400);
  assert.equal((await upload(path, file)).status, 428);
  assert.equal((await upload(`/products/${id}/price-rules/import?x=1`, file, { version: seen.version })).status, 400);
  // 文件和预览时的不是同一份
  const other = sheet([TRANSFER_HEADER, fixedRow({ 方向: "送机", 基础价: num(1) })]);
  const changed = await upload(path, other, { version: seen.version });
  assert.deepEqual([changed.status, changed.body.error.code], [409, "IMPORT_FILE_CHANGED"]);
  // 预览之后商品被别人改过
  const stale = await upload(path, file, { version: seen.version + 1 });
  assert.deepEqual([stale.status, stale.body.error.code], [409, "VERSION_CONFLICT"]);
  assert.equal((await prices(id)).items.length, 1, "被拒绝的都没有写");
  // 写入
  const key = randomUUID();
  const done = await ok(upload(path, file, { version: seen.version, key }));
  assert.deepEqual([done.version, done.summary, done.items.length, done.coverage], [seen.version + 1, seen.summary, 3, { total: 8, priced: 4, missing: 4 }]);
  assert.deepEqual(done.items.map((item: any) => [item.direction, item.base_price]).sort(), [["both", 12_000], ["dropoff", 19_000], ["pickup", 21_000]]);
  // 同一个键再来：原样返回，没有再写一遍；同一个键换一份文件：拒绝
  assert.deepEqual(await ok(upload(path, file, { version: seen.version, key })), done);
  assert.equal((await prices(id)).items.length, 3);
  assert.equal((await upload(`/products/${id}/price-rules/import?file_sha256=${sha(other)}`, other, { version: seen.version + 1, key })).body.error.code, "IDEMPOTENCY_KEY_REUSED");
  // 审计：改的那条记前后值，新增的两条各记一条
  const logs = (await api.db.owner.query("select action, resource_id, before, after from audit_logs where resource = 'price_rule' and (resource_id = $1 or after->>'product_id' = $2) order by id", [existing.id, id])).rows;
  assert.deepEqual(logs.map((log) => log.action), ["create", "update", "create", "create"]);
  assert.deepEqual([logs[1].before, logs[1].after], [{ params: { basePriceMinor: 20_000 } }, { params: { basePriceMinor: 21_000 } }]);
  // 再导入同一份（换新的键）：现在第 3、4 行会和刚写进去的重叠，整份拒绝
  const again = await upload(path, file, { version: seen.version + 1 });
  assert.deepEqual([again.status, again.body.error.code, again.body.error.details.summary], [409, "IMPORT_NOT_CLEAN", { rows: 3, create: 0, update: 0, unchanged: 1, error: 0, conflict: 2 }]);
  // 被拒时 details.preview 就是这次重新校验的完整结果，和再调一次预览接口拿到的一模一样
  assert.deepEqual(again.body.error.details.preview, await preview(id, file));
  assert.deepEqual(again.body.error.details.preview.rows.map((row: any) => row.action), ["unchanged", "conflict", "conflict"]);
  // 有一行出错的文件：整份不写
  const bad = sheet([TRANSFER_HEADER, fixedRow({ 车型组: "VG-ECO-4", 方向: "送机" }), fixedRow({ 车型组: "VG-ECO-4", 方向: "接机", 基础价: "很多" })]);
  const refused = await upload(`/products/${id}/price-rules/import?file_sha256=${sha(bad)}`, bad, { version: seen.version + 1 });
  assert.deepEqual([refused.status, refused.body.error.code, refused.body.error.details.summary.error], [409, "IMPORT_NOT_CLEAN", 1]);
  assert.equal((await prices(id)).items.length, 3);
  // 已上架的商品也一样走上架条件的检查；没有要改的内容
  const same = (await download(`/products/${id}/price-rules/export`)).bytes;
  assert.equal((await upload(`/products/${id}/price-rules/import?file_sha256=${sha(same)}`, same, { version: seen.version + 1 })).body.error.code, "IMPORT_NOT_CLEAN");
});

test("包车和两位小数的币种：套餐各列必填；金额按字符换成最小货币单位，超过两位小数的报到单元格，不四舍五入", async () => {
  const id = await product("charter", "usd");
  const row = (extra: Partial<Record<string, XlsxWriteCell>> = {}): XlsxWriteCell[] => {
    const values: Record<string, XlsxWriteCell> = { 区域: "东京市区", 车型组: "VG-BIZ-7", "套餐时长(小时)": num(10), 套餐公里: num(300), 套餐价: num("980.5"), "超时单价(每小时)": num(50), "超公里单价(每公里)": num("0.05"), 生效开始: "2026/10/1", ...extra };
    return CHARTER_HEADER.map((column) => values[column] ?? null);
  };
  const file = sheet([
    CHARTER_HEADER,
    row(),
    row({ "套餐时长(小时)": num(5), 套餐价: "1.2345E+2" }),
    row({ "套餐时长(小时)": num(8), 套餐价: num("0.30000000000000004") }),
    row({ "套餐时长(小时)": num("4.5"), 套餐价: "abc", 套餐公里: null }),
    row({ "套餐时长(小时)": num(99) }),
  ]);
  const body = await preview(id, file);
  assert.deepEqual(rowSummary(body), [[2, "create", []], [3, "create", []], [4, "error", ["F4 PRECISION"]], [5, "error", ["D5 NOT_INTEGER", "E5 REQUIRED", "F5 NOT_A_NUMBER"]], [6, "error", ["D6 OUT_OF_RANGE"]]]);
  const good = sheet([CHARTER_HEADER, row(), row({ "套餐时长(小时)": num(5), 套餐价: "1.2345E+2" })]);
  const done = await ok(upload(`/products/${id}/price-rules/import?file_sha256=${sha(good)}`, good, { version: 1 }));
  assert.deepEqual(done.items.map((item: any) => [item.package_hours, item.package_price, item.over_km_per_km, item.valid_from]).sort(), [[10, 98_050, 5, "2026-10-01"], [5, 12_345, 5, "2026-10-01"]].sort());
});

test("读不了的文件：不是 xlsx、缺列、空的、行太多、带公式、太大——明确的 400 / 413，什么都不写", async () => {
  const id = await product();
  const reason = async (file: Buffer, contentType?: string): Promise<unknown> => {
    const res = await upload(`/products/${id}/price-rules/import/preview`, file, contentType ? { contentType } : {});
    return [res.status, res.body?.error?.code, res.body?.error?.details?.reason];
  };
  assert.deepEqual(await reason(Buffer.from("区域,基础价\n东京,20000\n")), [400, "IMPORT_FILE_INVALID", "NOT_XLSX"]);
  assert.deepEqual(await reason(Buffer.from("PK\u0003\u0004 not really a zip")), [400, "IMPORT_FILE_INVALID", "NOT_XLSX"]);
  assert.deepEqual(await reason(sheet([])), [400, "IMPORT_FILE_INVALID", "EMPTY"]);
  const missing = await upload(`/products/${id}/price-rules/import/preview`, sheet([["区域", "车型组", "基础价"]]));
  assert.deepEqual([missing.body.error.details.reason, missing.body.error.details.columns], ["MISSING_COLUMNS", ["方向", "计价方式", "起步价", "起步里程(公里)", "起步时长(分钟)", "每公里单价", "每分钟单价", "生效开始"]]);
  assert.deepEqual(await reason(sheet([TRANSFER_HEADER, ...Array.from({ length: 501 }, () => fixedRow())])), [400, "IMPORT_FILE_INVALID", "TOO_MANY_ROWS"]);
  // 只有表头：没有要导入的行
  const header = await preview(id, sheet([TRANSFER_HEADER]));
  assert.deepEqual([header.summary.rows, header.can_import], [0, false]);
  // 表头换了顺序、多了不认识的列：按表头的文字认列
  const reordered = await preview(id, sheet([["备注", ...[...TRANSFER_HEADER].reverse()], ["随便写", ...[...fixedRow()].reverse()]]));
  assert.deepEqual(rowSummary(reordered), [[2, "create", []]]);
  // 带公式的单元格：不取它的值，报到那一格
  const formula = buildZip([
    { name: "xl/workbook.xml", content: Buffer.from("<workbook/>") },
    {
      name: "xl/worksheets/sheet1.xml",
      content: Buffer.from(
        `<worksheet><sheetData><row r="1">${TRANSFER_HEADER.map((text, index) => `<c r="${String.fromCharCode(65 + index)}1" t="inlineStr"><is><t>${text}</t></is></c>`).join("")}</row>` +
          '<row r="2"><c r="B2" t="inlineStr"><is><t>东京市区</t></is></c><c r="C2" t="inlineStr"><is><t>VG-BIZ-7</t></is></c><c r="D2" t="inlineStr"><is><t>接机</t></is></c><c r="E2" t="inlineStr"><is><t>一口价</t></is></c><c r="F2"><f>10000*2</f><v>20000</v></c><c r="M2" t="inlineStr"><is><t>2026-10-01</t></is></c></row></sheetData></worksheet>',
      ),
    },
  ]);
  assert.deepEqual(rowSummary(await preview(id, formula)), [[2, "error", ["F2 FORMULA"]]]);
  // 太大的文件在读之前就被拒绝；不是文件的请求体
  assert.equal((await upload(`/products/${id}/price-rules/import/preview`, Buffer.alloc(XLSX_LIMITS.maxFileBytes + 1, 0x50))).status, 413);
  assert.deepEqual(await reason(Buffer.from("{}"), "application/json"), [415, "UNSUPPORTED_MEDIA_TYPE", undefined]);
  assert.equal((await upload(`/products/${id}/price-rules/import/preview`, sheet([TRANSFER_HEADER]), { contentType: "application/octet-stream" })).status, 200);
  assert.equal((await upload(`/products/${MISSING}/price-rules/import/preview`, sheet([TRANSFER_HEADER]))).status, 404);
  assert.deepEqual((await prices(id)).items, []);
});

test("库存的导出和导入：每天一行，留空 = 清除；预览逐行给出设置 / 清除 / 没变 / 出错 / 有订单占着；确认后一次写入，记一条带每天前后值的日志", async () => {
  const id = await product();
  await ok(call("PUT", `/products/${id}/inventory`, { version: 1, body: { mode: "limited" } }));
  await ok(call("POST", `/products/${id}/inventory/batch-set`, { version: 2, body: { from: "2026-10-10", to: "2026-10-12", total: 5 } }));
  await api.db.owner.query("update inventory_days set held = 1, sold = 1 where product_id = $1 and day = '2026-10-12'", [id]);
  const exported = await download(`/products/${id}/inventory/export?from=2026-10-09&to=2026-10-13`);
  assert.match(String(exported.headers["content-disposition"]), /-inventory-2026-10-09-2026-10-13\.xlsx"$/);
  assert.deepEqual(exported.rows, [["日期", "可售单数"], ["2026-10-09"], ["2026-10-10", "5"], ["2026-10-11", "5"], ["2026-10-12", "5"], ["2026-10-13"]]);
  assert.equal((await api.app.inject({ method: "GET", url: `/tenant/v1/products/${id}/inventory/export?from=2026-10-09&to=2028-10-13`, headers: { authorization: `Bearer ${tenant.adminToken}` } })).statusCode, 400);

  const file = writeXlsx([{ name: "库存", rows: [["日期", "可售单数"], ["2026-10-09", num(3)], ["2026-10-10", num(5)], ["2026-10-11", null], [num(46307), num(1)], ["2026-10-13", num(0)], ["2026-10-06", num(1)], ["2026-10-14", num("2.5")], ["2026-10-09", num(9)], ["明天", num(1)], ["2026-10-15", num(10000)]] }]);
  const seen = await ok(upload(`/products/${id}/inventory/import/preview`, file));
  assert.deepEqual([seen.version, seen.file_sha256, seen.can_import], [3, sha(file), false]);
  assert.deepEqual(seen.summary, { rows: 10, set: 2, clear: 1, unchanged: 1, error: 5, conflict: 1 });
  assert.deepEqual(seen.rows.map((row: any) => [row.row, row.date, row.action, row.total, row.occupied, row.issues.map((issue: any) => `${issue.cell} ${issue.reason}`)]), [
    [2, "2026-10-09", "set", 3, null, []],
    [3, "2026-10-10", "unchanged", 5, null, []],
    [4, "2026-10-11", "clear", null, null, []],
    [5, "2026-10-12", "conflict", 1, 2, ["B5 INVENTORY_BELOW_OCCUPIED"]],
    [6, "2026-10-13", "set", 0, null, []],
    [7, "2026-10-06", "error", 1, null, ["A7 DATE_IN_PAST"]],
    [8, "2026-10-14", "error", null, null, ["B8 NOT_INTEGER"]],
    [9, "2026-10-09", "error", 9, null, ["A9 DUPLICATE"]],
    [10, null, "error", 1, null, ["A10 INVALID_DATE"]],
    [11, "2026-10-15", "error", 10000, null, ["B11 OUT_OF_RANGE"]],
  ]);
  const refused = await upload(`/products/${id}/inventory/import?file_sha256=${sha(file)}`, file, { version: 3 });
  assert.deepEqual([refused.status, refused.body.error.code], [409, "IMPORT_NOT_CLEAN"]);
  assert.deepEqual(refused.body.error.details.preview, seen, "被拒时带着完整的检查结果");
  // 过去的日子：原样留着算「没变」（导出一整个月、只改后半个月不会被前半个月挡住）；改了才出错
  await api.db.owner.query("insert into inventory_days (tenant_id, product_id, day, total, created_at, updated_at) values ($1, $2, '2026-10-05', 4, now(), now())", [tenant.tenantId, id]);
  const month = await download(`/products/${id}/inventory/export?from=2026-10-04&to=2026-10-10`);
  assert.deepEqual(month.rows.slice(1, 4), [["2026-10-04"], ["2026-10-05", "4"], ["2026-10-06"]]);
  const untouched = await ok(upload(`/products/${id}/inventory/import/preview`, month.bytes));
  assert.deepEqual([untouched.summary, untouched.rows.slice(0, 3).map((row: any) => [row.date, row.action])], [{ rows: 7, set: 0, clear: 0, unchanged: 7, error: 0, conflict: 0 }, [["2026-10-04", "unchanged"], ["2026-10-05", "unchanged"], ["2026-10-06", "unchanged"]]]);
  const edited = await ok(upload(`/products/${id}/inventory/import/preview`, writeXlsx([{ name: "库存", rows: [["日期", "可售单数"], ["2026-10-04", num(1)], ["2026-10-05", null], ["2026-10-05", num(4)], ["2026-10-09", num(6)]] }])));
  assert.deepEqual(edited.rows.map((row: any) => [row.date, row.action, row.issues.map((issue: any) => `${issue.cell} ${issue.reason}`)]), [
    ["2026-10-04", "error", ["A2 DATE_IN_PAST"]],
    ["2026-10-05", "error", ["A3 DATE_IN_PAST"]],
    ["2026-10-05", "error", ["A4 DUPLICATE"]],
    ["2026-10-09", "set", []],
  ]);
  assert.match(edited.rows[0].issues[0].message, /已经过去了.*改回原来的数/);
  // 干净的文件
  const good = writeXlsx([{ name: "库存", rows: [["日期", "可售单数"], ["2026-10-09", num(3)], ["2026-10-10", num(5)], ["2026-10-11", null], ["2026-10-12", num(2)], ["2026-10-13", num(0)]] }]);
  const path = `/products/${id}/inventory/import?file_sha256=${sha(good)}`;
  assert.equal((await upload(path, good, { version: 3, key: null })).status, 400);
  assert.equal((await upload(path, good)).status, 428);
  assert.equal((await upload(path, file, { version: 3 })).body.error.code, "IMPORT_FILE_CHANGED");
  assert.equal((await upload(path, good, { version: 9 })).body.error.code, "VERSION_CONFLICT");
  const key = randomUUID();
  const done = await ok(upload(path, good, { version: 3, key }));
  assert.deepEqual(done, { version: 4, changed_days: 4, summary: { rows: 5, set: 3, clear: 1, unchanged: 1, error: 0, conflict: 0 } });
  assert.deepEqual(await ok(upload(path, good, { version: 3, key })), done, "同一个键再来：原样返回");
  const view = await ok(call("GET", `/products/${id}/inventory?from=2026-10-09&to=2026-10-13`));
  assert.deepEqual(view.days.map((day: any) => [day.total, day.remaining, day.status]), [[3, 3, "open"], [5, 5, "open"], [null, 0, "unset"], [2, 0, "sold_out"], [0, 0, "closed"]]);
  const log = (await api.db.owner.query("select before, after from audit_logs where resource = 'inventory' and resource_id = $1 order by id desc limit 1", [id])).rows[0];
  assert.deepEqual(log.before, { days: { "2026-10-09": null, "2026-10-11": 5, "2026-10-12": 5, "2026-10-13": null } });
  assert.deepEqual(log.after, { source: "import", file_sha256: sha(good), changed_days: 4, days: { "2026-10-09": 3, "2026-10-11": null, "2026-10-12": 2, "2026-10-13": 0 } });
  // 文件级的错误同价格
  const invalid = await upload(`/products/${id}/inventory/import/preview`, writeXlsx([{ name: "库存", rows: [["日期"]] }]));
  assert.deepEqual([invalid.status, invalid.body.error.details.reason, invalid.body.error.details.columns], [400, "MISSING_COLUMNS", ["可售单数"]]);
  const many = await upload(`/products/${id}/inventory/import/preview`, writeXlsx([{ name: "库存", rows: [["日期", "可售单数"], ...Array.from({ length: 367 }, (): XlsxWriteCell[] => [TODAY, num(1)])] }]));
  assert.equal(many.body.error.details.reason, "TOO_MANY_ROWS");
});

/** 把我们写出的文件重新打包：可以改工作簿的声明、换压缩包的写法——模拟别的软件另存之后的样子。 */
function repack(file: Buffer, options: { workbook?: (xml: string) => string; zip?: TestZipOptions } = {}): Buffer {
  const names = ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"];
  const parts = names.map((name) => {
    const content = unzipEntry(file, name);
    return { name, content: name === "xl/workbook.xml" && options.workbook ? Buffer.from(options.workbook(content.toString("utf8")), "utf8") : content };
  });
  return buildZip([...parts, { name: "docProps/app.xml", content: Buffer.from("<Properties><Application>Microsoft Excel</Application></Properties>") }], options.zip ?? {});
}

test("别的软件另存过的文件：数据不在第一张表（按表名找）、1904 纪元的日期序号、ZIP64 和数据描述符的压缩包——导入的结果和原文件一样", async () => {
  const id = await product();
  // 说明排在前面，数据在第二张：按表名「价格」找到
  const rows = [TRANSFER_HEADER, fixedRow({ 生效开始: num(46296) })];
  const helpFirst = writeXlsx([{ name: "填写说明", rows: [["区域", "车型组"], ["这一张不是数据"]] }, { name: "价格", rows }]);
  const seen = await preview(id, helpFirst);
  assert.deepEqual([seen.summary.create, seen.summary.error, seen.rows[0].content.area, seen.rows[0].content.valid_from], [1, 0, "东京市区", "2026-10-01"]);
  // 同一个序号，文件声明了 1904 纪元：是另一天
  const mac = repack(helpFirst, { workbook: (xml) => xml.replace("<sheets>", '<workbookPr date1904="1"/><sheets>') });
  assert.equal((await preview(id, mac)).rows[0].content.valid_from, "2030-10-02");
  // 压缩包换一种写法：内容不变，结果不变（文件指纹跟着字节变）
  for (const zip of [{ zip64: true }, { dataDescriptor: true }, { zip64: true, dataDescriptor: true, level: 1 }] satisfies TestZipOptions[]) {
    const again = await preview(id, repack(helpFirst, { zip }));
    assert.deepEqual([again.summary, again.rows], [seen.summary, seen.rows], JSON.stringify(zip));
    assert.notEqual(again.file_sha256, seen.file_sha256);
  }
  // 库存：1904 纪元的日期序号
  await ok(call("PUT", `/products/${id}/inventory`, { version: 1, body: { mode: "limited" } }));
  const stock = repack(writeXlsx([{ name: "库存", rows: [["日期", "可售单数"], [num(44843), num(3)]] }, { name: "填写说明", rows: [["说明"]] }]), { workbook: (xml) => xml.replace("<sheets>", '<workbookPr date1904="true"/><sheets>'), zip: { zip64: true } });
  const stockSeen = await ok(upload(`/products/${id}/inventory/import/preview`, stock));
  assert.deepEqual(stockSeen.rows.map((row: any) => [row.date, row.action, row.total]), [["2026-10-10", "set", 3]]);
  const done = await upload(`/products/${id}/inventory/import?file_sha256=${sha(stock)}`, stock, { version: 2 });
  assert.equal(done.status, 200);
  assert.deepEqual((await ok(call("GET", `/products/${id}/inventory?from=2026-10-10&to=2026-10-10`))).days.map((day: any) => [day.date, day.total]), [["2026-10-10", 3]]);
});

test("权限：导出要能看（只读可以），预览和导入要能改（只读不行）；调度和财务都不行；应答里没有对外价和加价比例", async () => {
  const id = await product();
  const file = sheet([TRANSFER_HEADER, fixedRow()]);
  const stock = writeXlsx([{ name: "库存", rows: [["日期", "可售单数"], [TODAY, num(1)]] }]);
  const tokens: Record<string, string> = {};
  for (const role of ["pricing", "dispatch", "finance", "readonly"]) tokens[role] = (await addTenantUser(api, tenant.adminToken, `${role}-io@a.test`, role)).token;
  const exports = [`/products/${id}/price-rules/export`, `/products/${id}/inventory/export?from=${TODAY}&to=${TODAY}`];
  const uploads: [string, Buffer][] = [
    [`/products/${id}/price-rules/import/preview`, file],
    [`/products/${id}/price-rules/import?file_sha256=${sha(file)}`, file],
    [`/products/${id}/inventory/import/preview`, stock],
    [`/products/${id}/inventory/import?file_sha256=${sha(stock)}`, stock],
  ];
  for (const role of ["dispatch", "finance"]) {
    for (const path of exports) assert.equal((await download(path, tokens[role] as string)).status, 403, `${role} ${path}`);
    for (const [path, bytes] of uploads) assert.equal((await upload(path, bytes, { token: tokens[role] as string, version: 1 })).status, 403, `${role} ${path}`);
  }
  for (const path of exports) assert.equal((await download(path, tokens["readonly"] as string)).status, 200);
  for (const [path, bytes] of uploads) assert.equal((await upload(path, bytes, { token: tokens["readonly"] as string, version: 1 })).status, 403, `readonly ${path}`);
  const seen = await ok(upload(uploads[0]![0], file, { token: tokens["pricing"] as string }));
  assert.equal((await upload(uploads[1]![0], file, { token: tokens["pricing"] as string, version: seen.version })).status, 200);
  assert.equal((await api.app.inject({ method: "GET", url: `/tenant/v1${exports[0]}` })).statusCode, 401);
  assert.equal((await api.app.inject({ method: "POST", url: `/tenant/v1${uploads[0]![0]}`, payload: file, headers: { "content-type": XLSX_CONTENT_TYPE } })).statusCode, 401);
  const texts = [JSON.stringify(seen), JSON.stringify((await download(exports[0] as string)).rows), JSON.stringify(await ok(upload(uploads[2]![0], stock)))];
  for (const text of texts) assert.doesNotMatch(text, /markup|sell_price|selling_price|public_price|channel|对外价|加价比例/i);
});

test("接口定义对账：库存和导入导出应答的字段和 openapi.yaml 里各 schema 的必有字段一致", async () => {
  const doc = parse(await readFile(new URL("../openapi.yaml", import.meta.url), "utf8")) as { components: { schemas: Record<string, any> } };
  const schema = (name: string): any => doc.components.schemas[name];
  const same = (actual: object, required: string[], label: string): void => assert.deepEqual(Object.keys(actual).sort(), [...required].sort(), label);
  const id = await product();
  const view = await ok(call("GET", `/products/${id}/inventory?from=${TODAY}&to=${TODAY}`));
  same(view, schema("Inventory").required, "Inventory");
  same(view.days[0], schema("Inventory").properties.days.items.required, "Inventory.days[]");
  assert.ok(schema("Inventory").properties.days.items.properties.status.enum.includes(view.days[0].status));
  same(await ok(call("PUT", `/products/${id}/inventory`, { version: 1, body: { mode: "limited" } })), schema("InventoryMode").required, "InventoryMode");
  const batch = await ok(call("POST", `/products/${id}/inventory/batch-set`, { version: 2, body: { from: TODAY, to: TODAY, total: 2 } }));
  same(batch, schema("InventoryBatchResult").required, "InventoryBatchResult");
  const stock = writeXlsx([{ name: "库存", rows: [["日期", "可售单数"], [TODAY, num(4)], ["bad", num(1)]] }]);
  const stockPreview = await ok(upload(`/products/${id}/inventory/import/preview`, stock));
  same(stockPreview, schema("InventoryImportPreview").required, "InventoryImportPreview");
  same(stockPreview.summary, schema("InventoryImportSummary").required, "InventoryImportSummary");
  same(stockPreview.rows[0], schema("InventoryImportPreview").properties.rows.items.required, "InventoryImportPreview.rows[]");
  same(stockPreview.rows[1].issues[0], schema("ImportCellIssue").required, "issues[]");
  assert.ok(schema("ImportCellIssue").properties.reason.enum.includes(stockPreview.rows[1].issues[0].reason));
  same(view.ahead, schema("Inventory").properties.ahead.required, "Inventory.ahead");
  const good = writeXlsx([{ name: "库存", rows: [["日期", "可售单数"], [TODAY, num(4)]] }]);
  same(await ok(upload(`/products/${id}/inventory/import?file_sha256=${sha(good)}`, good, { version: stockPreview.version })), schema("InventoryImportResult").required, "InventoryImportResult");
  const file = sheet([TRANSFER_HEADER, fixedRow(), fixedRow({ 生效开始: "2027-01-01" })]);
  const pricePreview = await preview(id, file);
  same(pricePreview, schema("PriceImportPreview").required, "PriceImportPreview");
  same(pricePreview.summary, schema("ImportSummary").required, "ImportSummary");
  same(pricePreview.rows[0], schema("PriceImportPreview").properties.rows.items.required, "PriceImportPreview.rows[]");
  same(pricePreview.rows[0].content, schema("PriceImportPreview").properties.rows.items.properties.content.required, "PriceImportPreview.rows[].content");
  same(pricePreview.rows[0].conflicts_with[0], schema("PriceImportPreview").properties.rows.items.properties.conflicts_with.items.required, "conflicts_with[]");
  const clean = sheet([TRANSFER_HEADER, fixedRow()]);
  const imported = await ok(upload(`/products/${id}/price-rules/import?file_sha256=${sha(clean)}`, clean, { version: pricePreview.version }));
  same(imported, [...schema("PriceRules").required, "summary"], "PriceImportResult");
});

/** 直接写工作表的 XML（模拟 Excel 存盘的各种单元格类型）：`cells` 是每一行的单元格 XML，第一行是表头。 */
function rawSheet(name: string, header: readonly string[], rows: readonly string[][]): Buffer {
  const inline = (text: string): string => `<c t="inlineStr"><is><t>${text}</t></is></c>`;
  const data = [header.map(inline), ...rows].map((cells, index) => `<row r="${index + 1}">${cells.join("")}</row>`).join("");
  return buildZip([
    { name: "xl/workbook.xml", content: Buffer.from(`<workbook xmlns:r="x"><sheets><sheet name="${name}" r:id="rId1"/></sheets></workbook>`) },
    { name: "xl/_rels/workbook.xml.rels", content: Buffer.from('<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/></Relationships>') },
    { name: "xl/worksheets/sheet1.xml", content: Buffer.from(`<worksheet><sheetData>${data}</sheetData></worksheet>`) },
  ]);
}
const cellText = (text: string): string => `<c t="inlineStr"><is><t>${text}</t></is></c>`;
const cellNumber = (text: string): string => `<c><v>${text}</v></c>`;
const BLANK = "<c/>";

test("Excel 存盘的数字：17 位有效数字的金额和里程读回用户填的数；存成文字的按敲的字符；逻辑值、错误值在数字和日期列里报到单元格，不变成 1", async () => {
  const usd = await product("airport_transfer", "usd");
  // 价格编号 区域 车型组 方向 计价方式 基础价 起步价 起步里程 起步时长 每公里 每分钟 最低消费 生效开始 生效结束 状态
  const fixed = (price: string, from: string, extra: { validFrom?: string } = {}): string[] => [BLANK, cellText("东京市区"), cellText("VG-BIZ-7"), cellText("接送通用"), cellText("一口价"), price, BLANK, BLANK, BLANK, BLANK, BLANK, BLANK, extra.validFrom ?? cellText(`${from}-01-01`), cellText(`${from}-12-31`), BLANK];
  const metered = (km: string, from: string): string[] => [BLANK, cellText("东京市区"), cellText("VG-BIZ-7"), cellText("接送通用"), cellText("里程+时长"), BLANK, cellNumber("30.5"), km, cellNumber("20"), cellNumber("3.2999999999999998"), cellNumber("0.57999999999999996"), BLANK, cellText(`${from}-01-01`), cellText(`${from}-12-31`), BLANK];
  const file = rawSheet("价格", TRANSFER_HEADER, [
    fixed(cellNumber("19.989999999999998"), "2030"),
    fixed(cellNumber("1234.5599999999999"), "2031"),
    fixed(cellText("19.989999999999998"), "2032"),
    fixed(cellNumber("0.30000000000000004"), "2033"),
    fixed('<c t="b"><v>1</v></c>', "2034"),
    fixed('<c t="e"><v>#N/A</v></c>', "2035"),
    fixed(cellNumber("20"), "2036", { validFrom: '<c t="b"><v>1</v></c>' }),
    metered(cellNumber("5.0999999999999996"), "2037"),
    metered(cellNumber("-0.5"), "2038"),
    metered(cellNumber("5.25"), "2039"),
    metered(cellNumber("1000.1"), "2040"),
    metered('<c t="b"><v>0</v></c>', "2041"),
  ]);
  const seen = await preview(usd, file);
  assert.deepEqual(seen.rows.map((row: any) => [row.action, row.content.main_price, row.issues.map((issue: any) => `${issue.cell} ${issue.reason}`)]), [
    ["create", 1_999, []],
    ["create", 123_456, []],
    ["error", null, ["F4 PRECISION"]],
    ["error", null, ["F5 PRECISION"]],
    ["error", null, ["F6 NOT_A_NUMBER"]],
    ["error", null, ["F7 NOT_A_NUMBER"]],
    ["error", 2_000, ["M8 INVALID_DATE"]],
    ["create", 3_050, []],
    ["error", 3_050, ["H10 OUT_OF_RANGE"]],
    ["error", 3_050, ["H11 PRECISION"]],
    ["error", 3_050, ["H12 OUT_OF_RANGE"]],
    ["error", 3_050, ["H13 NOT_A_NUMBER"]],
  ]);
  assert.match(seen.rows[4].issues[0].message, /这一格是逻辑值 TRUE，不是数字/);
  assert.match(seen.rows[5].issues[0].message, /这一格是错误值 #N\/A，不是数字/);
  assert.match(seen.rows[8].issues[0].message, /起步里程要在 0 到 1000 公里之间/);
  // 读对的那几行写进去：里程 5.1 公里 = 5100 米，单价 3.30 / 0.58 美元
  const clean = rawSheet("价格", TRANSFER_HEADER, [metered(cellNumber("5.0999999999999996"), "2037")]);
  const done = await ok(upload(`/products/${usd}/price-rules/import?file_sha256=${sha(clean)}`, clean, { version: seen.version }));
  assert.deepEqual(done.items.map((item: any) => [item.start_price, item.start_meters, item.per_km, item.per_minute]), [[3_050, 5_100, 330, 58]]);
  // 文字列里的逻辑值是它显示的字（认不出这个区域），不是 1
  const named = await preview(usd, rawSheet("价格", TRANSFER_HEADER, [[BLANK, '<c t="b"><v>1</v></c>', cellText("VG-BIZ-7"), cellText("接送通用"), cellText("一口价"), cellNumber("20"), BLANK, BLANK, BLANK, BLANK, BLANK, BLANK, cellText("2030-01-01"), BLANK, BLANK]]));
  assert.deepEqual([named.rows[0].content.area, named.rows[0].issues.map((issue: any) => issue.reason)], ["TRUE", ["AREA_NOT_IN_PRODUCT"]]);
  // 库存：逻辑值、错误值的可售单数；逻辑值的日期
  const stock = rawSheet("库存", ["日期", "可售单数"], [[cellText("2026-10-20"), '<c t="b"><v>1</v></c>'], [cellText("2026-10-21"), '<c t="e"><v>#REF!</v></c>'], ['<c t="b"><v>1</v></c>', cellNumber("3")], [cellText("2026-10-22"), cellNumber("3.0000000000000004")], [cellNumber("46317"), cellNumber("3")]]);
  const stockSeen = await ok(upload(`/products/${usd}/inventory/import/preview`, stock));
  assert.deepEqual(stockSeen.rows.map((row: any) => [row.date, row.action, row.total, row.issues.map((issue: any) => `${issue.cell} ${issue.reason}`)]), [
    ["2026-10-20", "error", null, ["B2 NOT_INTEGER"]],
    ["2026-10-21", "error", null, ["B3 NOT_INTEGER"]],
    [null, "error", 3, ["A4 INVALID_DATE"]],
    ["2026-10-22", "error", null, ["B5 NOT_INTEGER"]],
    ["2026-10-22", "error", 3, ["A6 DUPLICATE"]],
  ]);
  assert.match(stockSeen.rows[0].issues[0].message, /这一格是逻辑值 TRUE，不是数字/);
});

test("金额超出范围的提示写出确切的上限（按币种的主单位）；大得存不下的数是超出范围，不是「不是整数」", async () => {
  const jpy = await product();
  const usd = await product("airport_transfer", "usd");
  const rows = (prices: XlsxWriteCell[]): Buffer => sheet([TRANSFER_HEADER, ...prices.map((price, index) => fixedRow({ 基础价: price, 生效开始: `203${index}-01-01`, 生效结束: `203${index}-12-31` }))]);
  const file = rows([num("1000000001"), "1E+21", num("90071992547409920"), num("-100"), num("0"), num("1000000000")]);
  const seen = await preview(jpy, file);
  assert.deepEqual(seen.rows.map((row: any) => [row.action, row.issues.map((issue: any) => issue.reason)]), [["error", ["OUT_OF_RANGE"]], ["error", ["OUT_OF_RANGE"]], ["error", ["OUT_OF_RANGE"]], ["error", ["OUT_OF_RANGE"]], ["error", ["OUT_OF_RANGE"]], ["create", []]]);
  for (const row of seen.rows.slice(0, 4)) assert.match(row.issues[0].message, /最多 1,000,000,000 JPY/);
  assert.match(seen.rows[4].issues[0].message, /金额要大于 0，最多 1,000,000,000 JPY/);
  const dollars = await preview(usd, rows([num("10000000.01"), num("10000000.00")]));
  assert.deepEqual(dollars.rows.map((row: any) => [row.action, row.content.main_price]), [["error", null], ["create", 1_000_000_000]]);
  assert.match(dollars.rows[0].issues[0].message, /最多 10,000,000\.00 USD/);
  for (const body of [seen, dollars]) assert.doesNotMatch(JSON.stringify(body), /10 位数/);
});

test("确认导入时在同一个事务里锁着重新检查：检查和写入之间挤不进订单——被拒一律是 IMPORT_NOT_CLEAN 加最新的检查结果，不会是 INVENTORY_BELOW_OCCUPIED", async () => {
  const id = await product();
  await ok(call("PUT", `/products/${id}/inventory`, { version: 1, body: { mode: "limited" } }));
  await ok(call("POST", `/products/${id}/inventory/batch-set`, { version: 2, body: { from: "2026-10-20", to: "2026-10-21", total: 5 } }));
  const file = writeXlsx([{ name: "库存", rows: [["日期", "可售单数"], ["2026-10-20", num(1)], ["2026-10-21", num(4)]] }]);
  const seen = await ok(upload(`/products/${id}/inventory/import/preview`, file));
  assert.equal(seen.can_import, true);
  // 一笔下单正在占 10-20 的库存（事务还没提交，行被它锁着）；这时供应商确认导入
  const order = await api.db.owner.connect();
  let confirming: Promise<ApiResponse>;
  try {
    await order.query("begin");
    await order.query("update inventory_days set held = 3 where product_id = $1 and day = '2026-10-20'", [id]);
    confirming = upload(`/products/${id}/inventory/import?file_sha256=${seen.file_sha256}`, file, { version: seen.version });
    const state = await Promise.race([confirming.then(() => "finished"), new Promise((resolve) => setTimeout(() => resolve("waiting"), 400))]);
    assert.equal(state, "waiting", "确认要等这笔下单结束（它在检查的时候就去锁这一天了）");
    await order.query("commit");
  } finally {
    order.release();
  }
  const refused = await confirming;
  assert.deepEqual([refused.status, refused.body.error.code, refused.body.error.details.summary], [409, "IMPORT_NOT_CLEAN", { rows: 2, set: 1, clear: 0, unchanged: 0, error: 0, conflict: 1 }], refused.text);
  assert.deepEqual(refused.body.error.details.preview.rows.map((row: any) => [row.date, row.action, row.occupied]), [["2026-10-20", "conflict", 3], ["2026-10-21", "set", null]]);
  assert.deepEqual((await ok(call("GET", `/products/${id}/inventory?from=2026-10-20&to=2026-10-21`))).days.map((day: any) => [day.date, day.total]), [["2026-10-20", 5], ["2026-10-21", 5]], "什么都没写");
});
