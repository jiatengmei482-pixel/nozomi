/**
 * M1-05 测试工程师补充（集成，真实接口 + 真实 PostgreSQL）：
 * 上传文件的健壮性（经接口只会是 200 或明确的 4xx）、金额和数量的读法、导入流程的每个岔路、库存的并发不变量、
 * 当地日期的边界、暂停的租户、审计、和 openapi 的对账。测试数据（含各种 xlsx）都在这里现场构造，测试库随测试结束删除。
 * 测试时钟固定在 2026-10-07 10:00（东京，周三）。名字以「【缺陷】」开头的是现在会失败的测试，交回开发处理。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { XLSX_CONTENT_TYPE, XLSX_LIMITS, type XlsxWriteCell, readXlsx, writeXlsx } from "./integrations/xlsx.ts";
import { type ApiResponse, type HttpMethod, TEST_PASSWORD, type TenantFixture, type TestApi, addTenantUser, createTestApi } from "./testing/api.ts";
import { buildZip } from "./testing/zip.ts";

let api: TestApi;
let root: string;
let tenant: TenantFixture;
const ids: Record<string, string> = {};
const TODAY = "2026-10-07";
const POLYGON = { kind: "operate", geometry: { type: "Polygon", coordinates: [[[139.6, 35.6], [139.8, 35.6], [139.8, 35.8], [139.6, 35.8], [139.6, 35.6]]] } };

interface Env {
  api: TestApi;
  token: string;
}
const env = (): Env => ({ api, token: tenant.adminToken });

const platformCall = (target: TestApi, token: string, method: HttpMethod, path: string, body?: unknown): Promise<ApiResponse> => target.call(method, `/platform/v1${path}`, { token, ...(body === undefined ? {} : { body }) });
const call = (method: HttpMethod, path: string, options: { token?: string; body?: unknown; version?: number; on?: Env } = {}): Promise<ApiResponse> => {
  const target = options.on ?? env();
  return target.api.call(method, `/tenant/v1${path}`, {
    token: options.token ?? target.token,
    ...(options.body === undefined ? {} : { body: options.body }),
    headers: { ...(options.version === undefined ? {} : { "if-match": `"${options.version}"` }), ...(method === "POST" && /(^\/(products|brands|areas)$)|\/price-rules(\/batch)?$/.test(path) ? { "idempotency-key": randomUUID() } : {}) },
  });
};

async function ok(res: Promise<ApiResponse>, status = 200): Promise<any> {
  const done = await res;
  assert.equal(done.status, status, done.text);
  return done.body;
}

async function upload(path: string, file: Buffer, options: { token?: string; version?: number; key?: string | null; contentType?: string; on?: Env } = {}): Promise<ApiResponse> {
  const target = options.on ?? env();
  const res = await target.api.app.inject({
    method: "POST",
    url: `/tenant/v1${path}`,
    payload: file,
    headers: {
      "content-type": options.contentType ?? XLSX_CONTENT_TYPE,
      authorization: `Bearer ${options.token ?? target.token}`,
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

async function download(path: string, token: string = tenant.adminToken): Promise<{ status: number; headers: Record<string, unknown>; rows: (string | null)[][]; bytes: Buffer }> {
  const res = await api.app.inject({ method: "GET", url: `/tenant/v1${path}`, headers: { authorization: `Bearer ${token}` } });
  const rows = res.statusCode === 200 ? readXlsx(res.rawPayload).map((cells) => cells.map((cell) => (cell.type === "text" || cell.type === "number" ? cell.text : null))) : [];
  return { status: res.statusCode, headers: res.headers, rows, bytes: res.rawPayload };
}

const num = (value: number | string): XlsxWriteCell => ({ number: String(value) });
const sha = (file: Buffer): string => createHash("sha256").update(file).digest("hex");
const stockFile = (rows: XlsxWriteCell[][]): Buffer => writeXlsx([{ name: "库存", rows: [["日期", "可售单数"], ...rows] }]);

/** 按 Excel 存盘的样子直接写单元格的 XML（用来放 writeXlsx 写不出来的东西：布尔、公式、共享字符串…）。 */
function rawXlsx(sheetName: string, sheetData: string, sharedStrings?: string): Buffer {
  return buildZip([
    { name: "[Content_Types].xml", content: Buffer.from("<Types/>") },
    { name: "xl/workbook.xml", content: Buffer.from(`<workbook xmlns:r="x"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
    { name: "xl/_rels/workbook.xml.rels", content: Buffer.from('<Relationships><Relationship Id="rId1" Type="http://x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>') },
    ...(sharedStrings === undefined ? [] : [{ name: "xl/sharedStrings.xml", content: Buffer.from(sharedStrings) }]),
    { name: "xl/worksheets/sheet1.xml", content: Buffer.from(`<worksheet><sheetData>${sheetData}</sheetData></worksheet>`) },
  ]);
}
const inline = (reference: string, text: string): string => `<c r="${reference}" t="inlineStr"><is><t>${text}</t></is></c>`;
const STOCK_HEADER = `<row r="1">${inline("A1", "日期")}${inline("B1", "可售单数")}</row>`;

type Category = "airport_transfer" | "point_to_point" | "charter";

async function product(options: { category?: Category; brand?: string; complete?: boolean; on?: Env; cityId?: string; areaIds?: string[] } = {}): Promise<string> {
  const target = options.on ?? env();
  target.api.clock.advance(1_000);
  const category = options.category ?? "airport_transfer";
  const areaIds = options.areaIds ?? [ids["a1"] as string, ids["a2"] as string];
  const body = {
    brand_id: ids[options.brand ?? "brand"],
    city_id: options.cityId ?? ids["tokyo"],
    category,
    ...(category === "airport_transfer" ? { poi_id: ids["narita"] } : {}),
    areas: areaIds.map((area_id) => ({ area_id })),
    vehicle_groups: [{ vehicle_group_id: ids["biz7"], passengers: 6, luggage: 2 }, { vehicle_group_id: ids["eco4"], passengers: 3, luggage: 2 }],
    dispatchers: [{ name: "调度小王", phone: "09012345678" }],
  };
  const created = await ok(call("POST", "/products", { body, on: target }), 201);
  if (options.complete) {
    const rules = await ok(call("PUT", `/products/${created.id}/service-rules`, { version: 1, on: target, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { general: { mode: "unlimited" } } } }));
    const content = await ok(call("PUT", `/products/${created.id}/content`, { version: rules.version, on: target, body: { zh: { title: "测试商品" } } }));
    await ok(call("POST", `/products/${created.id}/price-rules`, { version: content.version, on: target, body: { area_id: areaIds[0], vehicle_group_id: ids["biz7"], pricing_model: "fixed", base_price: 9_000, valid_from: "2026-01-01" } }), 201);
  }
  return created.id;
}

const inventory = (productId: string, from: string, to: string, on?: Env): Promise<any> => ok(call("GET", `/products/${productId}/inventory?from=${from}&to=${to}`, on === undefined ? {} : { on }));
const version = async (productId: string, on?: Env): Promise<number> => (await ok(call("GET", `/products/${productId}`, on === undefined ? {} : { on }))).version;
const batchSet = async (productId: string, body: Record<string, unknown>, on?: Env): Promise<any> => ok(call("POST", `/products/${productId}/inventory/batch-set`, { version: await version(productId, on), body, ...(on === undefined ? {} : { on }) }));
const limited = async (productId: string, on?: Env): Promise<any> => ok(call("PUT", `/products/${productId}/inventory`, { version: await version(productId, on), body: { mode: "limited" }, ...(on === undefined ? {} : { on }) }));
const prices = (productId: string): Promise<any> => ok(call("GET", `/products/${productId}/price-rules`));

/** 这个商品的价格表表头（从空白模版里取），和按列名填一行的小工具。 */
async function priceSheet(productId: string): Promise<{ header: string[]; file: (rows: Record<string, XlsxWriteCell>[]) => Buffer }> {
  const header = (await download(`/products/${productId}/price-rules/export?rows=none`)).rows[0] as string[];
  return { header, file: (rows) => writeXlsx([{ name: "价格", rows: [header, ...rows.map((values) => header.map((column) => values[column] ?? null))] }]) };
}
const FIXED: Record<string, XlsxWriteCell> = { 区域: "东京市区", 车型组: "VG-BIZ-7", 方向: "接送通用", 计价方式: "一口价", 基础价: num(20000), 生效开始: "2026-10-01" };
const MILEAGE: Record<string, XlsxWriteCell> = { 区域: "东京市区", 车型组: "VG-ECO-4", 方向: "接送通用", 计价方式: "里程+时长", 起步价: num(3000), "起步里程(公里)": num(5), "起步时长(分钟)": num(20), 每公里单价: num(400), 每分钟单价: num(80), 生效开始: "2026-10-01" };
const rowSummary = (body: any): unknown[] => body.rows.map((row: any) => [row.row, row.action, row.issues.map((issue: any) => `${issue.cell} ${issue.reason}`)]);

/** 库里和这次测试有关的全部内容：用来断言「什么都没写」。 */
async function snapshot(target: TestApi = api): Promise<unknown> {
  const rows = async (sql: string): Promise<unknown[]> => (await target.db.owner.query(sql)).rows;
  return {
    products: await rows("select id, version, inventory_mode, status, updated_at from products order by id"),
    prices: await rows("select to_jsonb(p) as row from price_rules p order by id"),
    days: await rows("select to_jsonb(d) as row from inventory_days d order by product_id, day"),
    audits: await rows("select count(*)::int as n from audit_logs"),
    keys: await rows("select count(*)::int as n from idempotency_keys"),
  };
}
const auditCount = async (resource: string, id: string): Promise<number> => (await api.db.owner.query("select count(*)::int as n from audit_logs where resource = $1 and resource_id = $2", [resource, id])).rows[0].n;
const dayRow = async (productId: string, day: string, target: TestApi = api): Promise<{ total: number; held: number; sold: number } | null> => (await target.db.owner.query("select total, held, sold from inventory_days where product_id = $1 and day = $2", [productId, day])).rows[0] ?? null;

async function setup(target: TestApi, platformToken: string, token: string): Promise<void> {
  const on: Env = { api: target, token };
  const platform = (method: HttpMethod, path: string, body?: unknown): Promise<ApiResponse> => platformCall(target, platformToken, method, path, body);
  ids["tokyo"] = (await ok(platform("POST", "/master/cities", { country_code: "JP", timezone: "Asia/Tokyo", code: "CTY-JP-TYO", name: { zh: "东京" }, center: { lng: 139.6917, lat: 35.6895 } }), 201)).id;
  ids["narita"] = (await ok(platform("POST", "/master/places", { location: { lng: 140.3887, lat: 35.7686 }, type: "airport", code: "NRT", city_id: ids["tokyo"], name: { zh: "成田机场" }, flight_scope: "international" }), 201)).id;
  ids["biz7"] = (await ok(platform("POST", "/master/vehicle-groups", { grade: "business", seats: 7, power: "fuel", combos: [{ passengers: 6, luggage: 2 }], code: "VG-BIZ-7", name: { zh: "商务 7 座" } }), 201)).id;
  ids["eco4"] = (await ok(platform("POST", "/master/vehicle-groups", { grade: "economy", seats: 4, power: "fuel", combos: [{ passengers: 3, luggage: 2 }], code: "VG-ECO-4", name: { zh: "经济 4 座" } }), 201)).id;
  ids["brand"] = (await ok(call("POST", "/brands", { on, body: { name: "甲车队 JP", currency: "JPY" } }), 201)).id;
  ids["usd"] = (await ok(call("POST", "/brands", { on, body: { name: "甲车队 USD", currency: "USD" } }), 201)).id;
  ids["a1"] = (await ok(call("POST", "/areas", { on, body: { city_id: ids["tokyo"], name: { zh: "东京市区", en: "Central Tokyo", ja: "東京都心" }, biz_type: "general", polygons: [POLYGON] } }), 201)).id;
  target.clock.advance(1_000);
  ids["a2"] = (await ok(call("POST", "/areas", { on, body: { city_id: ids["tokyo"], name: { en: "Yokohama <b>Bay</b>" }, biz_type: "general", polygons: [POLYGON] } }), 201)).id;
}

before(async () => {
  api = await createTestApi();
  root = await api.superAdminToken();
  tenant = await api.tenantWithAdmin(root, "甲车队", "admin@a.test");
  await setup(api, root, tenant.adminToken);
});
after(() => api.close());

// ---- 文件的健壮性（经接口）----

test("经接口上传各种读不了的文件（四个上传接口）：都是 400 IMPORT_FILE_INVALID，原因在 openapi 列出的七种之内，说明是中文；什么都不写；每个请求几秒内返回", async () => {
  const id = await product();
  const wb = '<workbook xmlns:r="x"><sheets><sheet name="价格" r:id="rId1"/></sheets></workbook>';
  const rel = (target: string): string => `<Relationships><Relationship Id="rId1" Type="http://x/worksheet" Target="${target}"/></Relationships>`;
  const zip = (sheetXml: string | Buffer, rels = rel("worksheets/sheet1.xml")): Buffer =>
    buildZip([{ name: "xl/workbook.xml", content: Buffer.from(wb) }, { name: "xl/_rels/workbook.xml.rels", content: Buffer.from(rels) }, { name: "xl/worksheets/sheet1.xml", content: typeof sheetXml === "string" ? Buffer.from(sheetXml) : sheetXml }]);
  const good = writeXlsx([{ name: "价格", rows: [["区域"]] }]);
  const encrypted = Buffer.from(zip("<worksheet/>"));
  for (let at = 0; at + 4 <= encrypted.length; at += 1) if (encrypted.readUInt32LE(at) === 0x02014b50) encrypted.writeUInt16LE(1, at + 8);
  const samples: [string, Buffer, string[]][] = [
    ["一段文字", Buffer.from("区域,基础价\n东京,20000\n"), ["NOT_XLSX"]],
    ["老的 .xls", Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(600)]), ["NOT_XLSX"]],
    ["一个字节", Buffer.from("P"), ["NOT_XLSX"]],
    ["不是 xlsx 的 zip（docx）", buildZip([{ name: "word/document.xml", content: Buffer.from("<w/>") }]), ["NOT_XLSX"]],
    ["截掉一半", good.subarray(0, Math.floor(good.length / 2)), ["CORRUPT", "NOT_XLSX"]],
    ["截掉最后一个字节", good.subarray(0, good.length - 1), ["CORRUPT", "NOT_XLSX"]],
    ["加密的条目", encrypted, ["CORRUPT"]],
    ["DOCTYPE + 外部实体", zip('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><worksheet><sheetData><row><c t="inlineStr"><is><t>&e;</t></is></c></row></sheetData></worksheet>'), ["UNSAFE"]],
    ["工作表指到包外", zip("<worksheet/>", rel("../../../etc/passwd")), ["UNSAFE"]],
    ["工作表是绝对路径", zip("<worksheet/>", rel("/etc/passwd")), ["UNSAFE", "CORRUPT"]],
    ["64 MB 的压缩炸弹", zip(Buffer.alloc(64 * 1024 * 1024, 0x20)), ["TOO_LARGE", "CORRUPT"]],
    ["6000 行", zip(`<worksheet><sheetData>${"<row><c><v>1</v></c></row>".repeat(6000)}</sheetData></worksheet>`), ["TOO_LARGE"]],
    ["一张空表", zip("<worksheet><sheetData/></worksheet>"), ["EMPTY"]],
    ["UTF-16 的 XML", zip(Buffer.from('﻿<worksheet><sheetData><row><c t="inlineStr"><is><t>区域</t></is></c></row></sheetData></worksheet>', "utf16le")), ["EMPTY", "CORRUPT", "NOT_XLSX"]],
    ["表头是公式", zip('<worksheet><sheetData><row r="1"><c r="A1"><f>"区域"</f><v>区域</v></c></row></sheetData></worksheet>'), ["MISSING_COLUMNS", "EMPTY"]],
    ["表头不对", good, ["MISSING_COLUMNS"]],
    ["130 万个重复的行标签", zip(`<worksheet><sheetData>${'<row r="1"/>'.repeat(1_300_000)}</sheetData></worksheet>`), ["EMPTY", "TOO_LARGE"]],
  ];
  const paths = [`/products/${id}/price-rules/import/preview`, `/products/${id}/inventory/import/preview`];
  const before = await snapshot();
  const logMark = api.logs().length;
  for (const [label, bytes, reasons] of samples) {
    assert.ok(bytes.length <= XLSX_LIMITS.maxFileBytes, label);
    for (const path of [...paths, `/products/${id}/price-rules/import?file_sha256=${sha(bytes)}`, `/products/${id}/inventory/import?file_sha256=${sha(bytes)}`]) {
      const started = performance.now();
      const res = await upload(path, bytes, { version: 1 });
      assert.ok(performance.now() - started < 10_000, `${label} ${path} 用了 ${Math.round(performance.now() - started)} ms`);
      assert.deepEqual([res.status, res.body?.error?.code], [400, "IMPORT_FILE_INVALID"], `${label} ${path}：${res.text.slice(0, 300)}`);
      assert.ok(reasons.includes(res.body.error.details.reason), `${label}：${res.body.error.details.reason}`);
      assert.match(res.body.error.message, /[一-鿿]/);
      assert.doesNotMatch(res.text, /node:|\.ts:\d+|at \w+ \(/, "不把内部的出错位置带给用户");
    }
  }
  assert.deepEqual(await snapshot(), before, "读不了的文件什么都不写（审计、幂等键也没有）");
  assert.doesNotMatch(api.logs().slice(logMark), /未预期的异常/, "没有一个请求走到 500");
});

test("上传的方式不对：表单上传、JSON、文字、空请求体是明确的 4xx；超过 1 MB 是 413；都不是 500", async () => {
  const id = await product();
  const file = stockFile([[TODAY, num(1)]]);
  const path = `/products/${id}/inventory/import/preview`;
  const boundary = "----qa";
  const multipart = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.xlsx"\r\nContent-Type: ${XLSX_CONTENT_TYPE}\r\n\r\n`), file, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const attempts: [string, Buffer, string, number[]][] = [
    ["表单上传", multipart, `multipart/form-data; boundary=${boundary}`, [415]],
    ["JSON", Buffer.from(JSON.stringify({ file: file.toString("base64") })), "application/json", [415, 400]],
    ["文字", file, "text/plain", [415, 400]],
    ["没有类型的类型", file, "application/x-unknown", [415]],
    ["空请求体", Buffer.alloc(0), XLSX_CONTENT_TYPE, [400, 415]],
    ["刚好超过 1 MB", Buffer.alloc(XLSX_LIMITS.maxFileBytes + 1, 0x41), XLSX_CONTENT_TYPE, [413]],
    ["8 MB", Buffer.alloc(8 * 1024 * 1024, 0x41), "application/octet-stream", [413]],
  ];
  for (const [label, bytes, contentType, statuses] of attempts) {
    const res = await upload(path, bytes, { contentType });
    assert.ok(statuses.includes(res.status), `${label}：${res.status} ${res.text.slice(0, 200)}`);
    assert.equal(typeof res.body?.error?.code, "string", `${label}：应答是统一的错误结构`);
    assert.match(res.body.error.message, /[一-鿿]/, label);
  }
  // application/octet-stream 也收
  assert.equal((await upload(path, file, { contentType: "application/octet-stream" })).status, 200);
});

test("模糊测试（经接口）：对合法的价格表和库存表随机变异 300 次上传预览——只会是 200 或 400 IMPORT_FILE_INVALID，什么都不写", async () => {
  const id = await product();
  const sheet = await priceSheet(id);
  const seeds: [string, Buffer][] = [
    [`/products/${id}/price-rules/import/preview`, sheet.file([FIXED, MILEAGE])],
    [`/products/${id}/inventory/import/preview`, stockFile([[TODAY, num(3)], ["2026-10-08", null]])],
    [`/products/${id}/inventory/import/preview`, buildZip([{ name: "xl/workbook.xml", content: Buffer.from("<workbook/>"), method: "store" }, { name: "xl/worksheets/sheet1.xml", content: Buffer.from(`<worksheet><sheetData>${STOCK_HEADER}<row r="2">${inline("A2", TODAY)}<c r="B2"><v>3</v></c></row></sheetData></worksheet>`), method: "store" }])],
  ];
  let state = 7_2026;
  const pick = (max: number): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return Math.floor((state / 4_294_967_296) * max);
  };
  const before = await snapshot();
  const seen: Record<string, number> = {};
  for (let round = 0; round < 300; round += 1) {
    const [path, seed] = seeds[round % seeds.length] as [string, Buffer];
    let bytes = Buffer.from(seed);
    for (let step = 1 + pick(3); step > 0 && bytes.length > 0; step -= 1) {
      const at = pick(bytes.length);
      const kind = pick(4);
      if (kind === 0) bytes[at] = (bytes[at] as number) ^ (1 << pick(8));
      else if (kind === 1) bytes = bytes.subarray(0, at);
      else if (kind === 2) bytes = Buffer.concat([bytes.subarray(0, at), bytes.subarray(at, Math.min(bytes.length, at + 1 + pick(40))), bytes.subarray(at)]);
      else bytes[at] = pick(256);
    }
    const res = await upload(path, bytes);
    const outcome = res.status === 200 ? "200" : `${res.status} ${res.body?.error?.code}`;
    assert.ok(outcome === "200" || outcome === "400 IMPORT_FILE_INVALID", `第 ${round} 轮：${outcome} ${res.text.slice(0, 200)}；样本 base64 ${bytes.toString("base64").slice(0, 300)}`);
    seen[outcome] = (seen[outcome] ?? 0) + 1;
  }
  assert.ok((seen["200"] ?? 0) > 0 && (seen["400 IMPORT_FILE_INVALID"] ?? 0) > 100, JSON.stringify(seen));
  assert.deepEqual(await snapshot(), before);
});

// ---- 金额和数量 ----

test("金额的每种写法经导入读到的数：日元（0 位小数）和美元（2 位小数）；读不了的指到单元格并说明原因，不四舍五入", async () => {
  const jpy = await product();
  const usd = await product({ brand: "usd" });
  const cases: [XlsxWriteCell, number | string, number | string][] = [
    [num("20000"), 20_000, 2_000_000],
    [num("20000.00"), 20_000, 2_000_000],
    [num("123.45"), "PRECISION", 12_345],
    [num("123.456"), "PRECISION", "PRECISION"],
    [num("0.30000000000000004"), "PRECISION", "PRECISION"],
    [num("18500.000000001"), "PRECISION", "PRECISION"],
    ["1.2E+4", 12_000, 1_200_000],
    ["20,000", 20_000, 2_000_000],
    ["1,234.5", "PRECISION", 123_450],
    [" 20000 ", 20_000, 2_000_000],
    ["２００００", "NOT_A_NUMBER", "NOT_A_NUMBER"],
    ["20 000", "NOT_A_NUMBER", "NOT_A_NUMBER"],
    ["¥20000", "NOT_A_NUMBER", "NOT_A_NUMBER"],
    ["两万", "NOT_A_NUMBER", "NOT_A_NUMBER"],
    [num("-100"), "OUT_OF_RANGE", "OUT_OF_RANGE"],
    [num("0"), "OUT_OF_RANGE", "OUT_OF_RANGE"],
    [num("1000000000"), 1_000_000_000, "OUT_OF_RANGE"],
    [num("10000000.00"), 10_000_000, 1_000_000_000],
    [num("1000000001"), "OUT_OF_RANGE", "OUT_OF_RANGE"],
    [num("10000000.01"), "PRECISION", "OUT_OF_RANGE"],
  ];
  for (const [id, column] of [[jpy, 1], [usd, 2]] as const) {
    const sheet = await priceSheet(id);
    const file = sheet.file(cases.map(([cell], index) => ({ ...FIXED, 基础价: cell, 生效开始: `20${30 + index}-01-01`, 生效结束: `20${30 + index}-12-31` })));
    const seen = await ok(upload(`/products/${id}/price-rules/import/preview`, file));
    const at = `${String.fromCharCode(65 + sheet.header.indexOf("基础价"))}`;
    cases.forEach((entry, index) => {
      const expected = entry[column];
      const row = seen.rows[index];
      const label = `${id === jpy ? "JPY" : "USD"} 第 ${index + 2} 行 ${JSON.stringify(entry[0])}`;
      if (typeof expected === "number") assert.deepEqual([row.action, row.content.main_price, row.issues], ["create", expected, []], label);
      else assert.deepEqual([row.action, row.issues.map((issue: any) => `${issue.cell} ${issue.reason}`)], ["error", [`${at}${index + 2} ${expected}`]], label);
      assert.ok(row.content.main_price === null || Number.isSafeInteger(row.content.main_price), label);
    });
  }
});

test("【缺陷】Excel 存盘时把小数写成 17 位有效数字（19.99 存成 19.989999999999998、起步 5.1 公里存成 5.0999999999999996）：用户填得没错，却被报「最多 2 位小数」；应当读成 19.99", async () => {
  // Excel 文件里数字是按 IEEE 双精度的 17 位有效数字写的；这里用同样的办法算出 Excel 会写进文件的字符
  const stored = (typed: string): string => Number(typed).toPrecision(17).replace(/\.?0+$/, "");
  assert.deepEqual([stored("19.99"), stored("5.1"), stored("0.58"), stored("1234.56")], ["19.989999999999998", "5.0999999999999996", "0.57999999999999996", "1234.5599999999999"]);
  const usd = await product({ brand: "usd" });
  const sheet = await priceSheet(usd);
  const typed = ["19.99", "0.58", "1234.56", "4.35", "8.2"];
  const file = sheet.file(typed.map((value, index) => ({ ...FIXED, 基础价: num(stored(value)), 生效开始: `203${index}-01-01`, 生效结束: `203${index}-12-31` })));
  const seen = await ok(upload(`/products/${usd}/price-rules/import/preview`, file));
  assert.deepEqual(seen.rows.map((row: any) => [row.action, row.content.main_price, row.issues.map((issue: any) => issue.reason)]), [["create", 1999, []], ["create", 58, []], ["create", 123_456, []], ["create", 435, []], ["create", 820, []]]);
  // 日元的商品同样受影响：起步里程 5.1 公里
  const jpy = await product();
  const km = (await priceSheet(jpy)).file([{ ...MILEAGE, "起步里程(公里)": num(stored("5.1")) }]);
  assert.deepEqual(rowSummary(await ok(upload(`/products/${jpy}/price-rules/import/preview`, km))), [[2, "create", []]]);
});

test("【缺陷】起步里程填 -0.5（负数）被读成 0.5 公里并当作可以导入；应当报这一格超出范围", async () => {
  const id = await product();
  const sheet = await priceSheet(id);
  const at = `${String.fromCharCode(65 + sheet.header.indexOf("起步里程(公里)"))}2`;
  for (const value of ["-0.5", "-0.1"]) {
    const seen = await ok(upload(`/products/${id}/price-rules/import/preview`, sheet.file([{ ...MILEAGE, "起步里程(公里)": num(value) }])));
    assert.deepEqual([seen.rows[0].action, seen.rows[0].issues.map((issue: any) => issue.cell), seen.can_import], ["error", [at], false], value);
  }
});

test("【缺陷】单元格是布尔值 TRUE 时被读成数字 1：库存的可售单数成了 1 单、价格成了 1 日元；应当报这一格不是数字", async () => {
  const id = await product();
  const stock = rawXlsx("库存", `${STOCK_HEADER}<row r="2">${inline("A2", "2026-10-20")}<c r="B2" t="b"><v>1</v></c></row>`);
  const seen = await ok(upload(`/products/${id}/inventory/import/preview`, stock));
  assert.deepEqual([seen.rows[0].action, seen.rows[0].total, seen.can_import], ["error", null, false]);
});

test("【缺陷】金额大到存不下（1E+21）时报的是「JPY 的金额只能是整数」（PRECISION）——它就是整数；应当报超出范围", async () => {
  const id = await product();
  const sheet = await priceSheet(id);
  const seen = await ok(upload(`/products/${id}/price-rules/import/preview`, sheet.file([{ ...FIXED, 基础价: "1E+21" }, { ...FIXED, 车型组: "VG-ECO-4", 基础价: num("90071992547409920") }])));
  assert.deepEqual(seen.rows.map((row: any) => [row.action, row.issues.map((issue: any) => issue.reason)]), [["error", ["OUT_OF_RANGE"]], ["error", ["OUT_OF_RANGE"]]]);
});

test("数量和里程的读法：整数的各种写法；小数、负数、公式、错误值、文字都指到单元格；起步里程最多一位小数、按字符换成米", async () => {
  const id = await product();
  await limited(id);
  const rows = `${STOCK_HEADER}` +
    `<row r="2">${inline("A2", "2026-10-20")}<c r="B2"><v>3</v></c></row>` +
    `<row r="3">${inline("A3", "2026-10-21")}<c r="B3"><v>3.0</v></c></row>` +
    `<row r="4">${inline("A4", "2026-10-22")}<c r="B4"><v>1E+1</v></c></row>` +
    `<row r="5">${inline("A5", "2026-10-23")}${inline("B5", " 7 ")}</row>` +
    `<row r="6">${inline("A6", "2026-10-24")}<c r="B6"><v>2.5</v></c></row>` +
    `<row r="7">${inline("A7", "2026-10-25")}<c r="B7"><v>-1</v></c></row>` +
    `<row r="8">${inline("A8", "2026-10-26")}<c r="B8"><f>B2*2</f><v>6</v></c></row>` +
    `<row r="9">${inline("A9", "2026-10-27")}<c r="B9" t="e"><v>#N/A</v></c></row>` +
    `<row r="10">${inline("A10", "2026-10-28")}${inline("B10", "三")}</row>` +
    `<row r="11">${inline("A11", "2026-10-29")}<c r="B11"><v>2.9999999999999996</v></c></row>` +
    `<row r="12">${inline("A12", "2026-10-30")}<c r="B12"><v>9999</v></c></row>` +
    `<row r="13">${inline("A13", "2026-10-31")}<c r="B13"><v>1E+4</v></c></row>` +
    `<row r="14"><c r="A14"><v>46327</v></c><c r="B14"><v>0</v></c></row>` +
    `<row r="15"><c r="A15"><v>46328.5</v></c><c r="B15"><v>1</v></c></row>` +
    `<row r="16"><c r="A16"><f>TODAY()</f><v>46329</v></c><c r="B16"><v>1</v></c></row>`;
  const seen = await ok(upload(`/products/${id}/inventory/import/preview`, rawXlsx("库存", rows)));
  assert.deepEqual(seen.rows.map((row: any) => [row.row, row.date, row.action, row.total, row.issues.map((issue: any) => `${issue.cell} ${issue.reason}`)]), [
    [2, "2026-10-20", "set", 3, []],
    [3, "2026-10-21", "set", 3, []],
    [4, "2026-10-22", "set", 10, []],
    [5, "2026-10-23", "set", 7, []],
    [6, "2026-10-24", "error", null, ["B6 NOT_INTEGER"]],
    [7, "2026-10-25", "error", -1, ["B7 OUT_OF_RANGE"]],
    [8, "2026-10-26", "error", null, ["B8 FORMULA"]],
    [9, "2026-10-27", "error", null, ["B9 NOT_INTEGER"]],
    [10, "2026-10-28", "error", null, ["B10 NOT_INTEGER"]],
    [11, "2026-10-29", "error", null, ["B11 NOT_INTEGER"]],
    [12, "2026-10-30", "set", 9999, []],
    [13, "2026-10-31", "error", 10000, ["B13 OUT_OF_RANGE"]],
    [14, "2026-11-01", "set", 0, []],
    [15, null, "error", 1, ["A15 INVALID_DATE"]],
    [16, null, "error", 1, ["A16 FORMULA"]],
  ]);
  for (const row of seen.rows) for (const issue of row.issues) assert.match(issue.message, /[一-鿿]/);
  // 起步里程：5 / 5.5 / 0.1 可以，5.55 不行；写进库里的是米
  const sheet = await priceSheet(id);
  const km = ["5", "5.5", "0.1", "12.0", "5.55", "1e30"];
  const file = sheet.file(km.map((value, index) => ({ ...MILEAGE, "起步里程(公里)": num(value.includes("e") ? "1000000000000000000000000000000" : value), 生效开始: `203${index}-01-01`, 生效结束: `203${index}-12-31` })));
  const preview = await ok(upload(`/products/${id}/price-rules/import/preview`, file));
  assert.deepEqual(preview.rows.map((row: any) => row.action), ["create", "create", "create", "create", "error", "error"]);
  const clean = sheet.file(km.slice(0, 4).map((value, index) => ({ ...MILEAGE, "起步里程(公里)": num(value), 生效开始: `203${index}-01-01`, 生效结束: `203${index}-12-31` })));
  const done = await ok(upload(`/products/${id}/price-rules/import?file_sha256=${sha(clean)}`, clean, { version: await version(id) }));
  assert.deepEqual(done.items.map((item: any) => item.start_meters).sort((a: number, b: number) => a - b), [100, 5_000, 5_500, 12_000]);
});

// ---- 导入流程 ----

test("预览和被拒绝的确认都不写入：价格、库存、商品版本、审计日志、幂等键一样都不变；被拒绝后用同一个幂等键改好再来可以成功", async () => {
  const id = await product();
  await limited(id);
  await batchSet(id, { from: "2026-10-20", to: "2026-10-21", total: 5 });
  const sheet = await priceSheet(id);
  const clean = sheet.file([FIXED]);
  const dirty = sheet.file([FIXED, { ...FIXED, 基础价: "很多" }, FIXED]);
  const stockClean = stockFile([["2026-10-20", num(6)], ["2026-10-22", num(1)], ["2026-10-21", null]]);
  const stockDirty = stockFile([["2026-10-20", num(6)], ["2026-10-06", num(1)]]);
  const current = await version(id);
  const before = await snapshot();
  for (const [path, file] of [[`/products/${id}/price-rules/import/preview`, clean], [`/products/${id}/price-rules/import/preview`, dirty], [`/products/${id}/inventory/import/preview`, stockClean], [`/products/${id}/inventory/import/preview`, stockDirty]] as const) {
    for (let times = 0; times < 2; times += 1) assert.equal((await upload(path, file)).status, 200);
  }
  assert.deepEqual(await snapshot(), before, "预览不写入");
  const key = randomUUID();
  const refusals: [string, Buffer, number, string][] = [
    [`/products/${id}/price-rules/import?file_sha256=${sha(clean)}`, dirty, current, "IMPORT_FILE_CHANGED"],
    [`/products/${id}/price-rules/import?file_sha256=${sha(clean)}`, clean, current + 1, "VERSION_CONFLICT"],
    [`/products/${id}/price-rules/import?file_sha256=${sha(clean)}`, clean, current - 1, "VERSION_CONFLICT"],
    [`/products/${id}/price-rules/import?file_sha256=${sha(dirty)}`, dirty, current, "IMPORT_NOT_CLEAN"],
    [`/products/${id}/inventory/import?file_sha256=${sha(stockClean)}`, stockDirty, current, "IMPORT_FILE_CHANGED"],
    [`/products/${id}/inventory/import?file_sha256=${sha(stockClean)}`, stockClean, current + 1, "VERSION_CONFLICT"],
    [`/products/${id}/inventory/import?file_sha256=${sha(stockDirty)}`, stockDirty, current, "IMPORT_NOT_CLEAN"],
  ];
  for (const [path, file, v, code] of refusals) {
    const res = await upload(path, file, { version: v, key });
    assert.deepEqual([res.status, res.body.error.code], [409, code], path);
    if (code === "VERSION_CONFLICT") assert.equal(res.body.error.details.current_version ?? res.body.error.details.version, current, "告诉页面现在的版本号");
  }
  assert.deepEqual(await snapshot(), before, "被拒绝的确认不写入，也不占用幂等键");
  // 指纹的大小写不敏感；同一个幂等键现在可以用来做成功的那一次
  const done = await ok(upload(`/products/${id}/inventory/import?file_sha256=${sha(stockClean).toUpperCase()}`, stockClean, { version: current, key }));
  assert.deepEqual(done, { version: current + 1, changed_days: 3, summary: { rows: 3, set: 2, clear: 1, unchanged: 0, error: 0, conflict: 0 } });
  assert.deepEqual((await inventory(id, "2026-10-20", "2026-10-22")).days.map((day: any) => day.total), [6, null, 1]);
});

test("IMPORT_NOT_CLEAN 的 details.preview 和预览接口的应答逐字段相同（库存和价格；出错、冲突、没有要改的三种情形）", async () => {
  const id = await product();
  await limited(id);
  await batchSet(id, { from: "2026-10-20", to: "2026-10-21", total: 5 });
  await api.db.owner.query("update inventory_days set held = 2 where product_id = $1 and day = '2026-10-21'", [id]);
  const sheet = await priceSheet(id);
  const current = await version(id);
  const files: [string, Buffer][] = [
    ["inventory", stockFile([["2026-10-20", num(6)], ["2026-10-21", num(1)], ["bad", num(1)], ["2026-10-06", num(2)], ["2029-01-01", num(2)]])],
    ["inventory", stockFile([["2026-10-20", num(5)], ["2026-10-21", num(5)]])],
    ["price-rules", sheet.file([FIXED, FIXED, { ...FIXED, 区域: "没有的区域", 车型组: "VG-NONE", 方向: "向上", 计价方式: "免费", 生效开始: "昨天", 状态: "也许" }])],
    ["price-rules", sheet.file([])],
  ];
  for (const [kind, file] of files) {
    const seen = await ok(upload(`/products/${id}/${kind}/import/preview`, file));
    assert.equal(seen.can_import, false);
    const refused = await upload(`/products/${id}/${kind}/import?file_sha256=${seen.file_sha256}`, file, { version: current });
    assert.deepEqual([refused.status, refused.body.error.code], [409, "IMPORT_NOT_CLEAN"]);
    assert.deepEqual(refused.body.error.details.preview, seen);
    assert.deepEqual(refused.body.error.details.summary.error, seen.summary.error);
    assert.match(refused.body.error.message, /[一-鿿]/);
  }
});

test("预览和确认之间数据变了：这一天被订单占了、别人改了库存、区域改了名——确认时重新校验，拒绝并给出新的检查结果，什么都不写", async () => {
  const id = await product();
  await limited(id);
  await batchSet(id, { from: "2026-10-20", to: "2026-10-22", total: 5 });
  // ① 预览之后来了订单（下单不动商品的版本号）
  const lower = stockFile([["2026-10-20", num(1)], ["2026-10-21", null], ["2026-10-22", num(9)]]);
  const seen = await ok(upload(`/products/${id}/inventory/import/preview`, lower));
  assert.equal(seen.can_import, true);
  await api.db.owner.query("update inventory_days set held = 2, sold = 1 where product_id = $1 and day in ('2026-10-20', '2026-10-21')", [id]);
  const before = await snapshot();
  const refused = await upload(`/products/${id}/inventory/import?file_sha256=${seen.file_sha256}`, lower, { version: seen.version });
  assert.deepEqual([refused.status, refused.body.error.code, refused.body.error.details.summary], [409, "IMPORT_NOT_CLEAN", { rows: 3, set: 1, clear: 0, unchanged: 0, error: 0, conflict: 2 }]);
  assert.deepEqual(refused.body.error.details.preview.rows.map((row: any) => [row.date, row.action, row.occupied]), [["2026-10-20", "conflict", 3], ["2026-10-21", "conflict", 3], ["2026-10-22", "set", null]]);
  assert.deepEqual(await snapshot(), before, "10-22 也没有写");
  // ② 预览之后别人在页面上改了库存（版本号变了）
  await batchSet(id, { from: "2026-10-25", to: "2026-10-25", total: 1 });
  const stale = await upload(`/products/${id}/inventory/import?file_sha256=${seen.file_sha256}`, stockFile([["2026-10-22", num(9)]]), { version: seen.version });
  assert.equal(stale.body.error.code, "IMPORT_FILE_CHANGED");
  const fine = stockFile([["2026-10-22", num(9)]]);
  assert.equal((await upload(`/products/${id}/inventory/import?file_sha256=${sha(fine)}`, fine, { version: seen.version })).body.error.code, "VERSION_CONFLICT");
  // ③ 价格：预览之后区域改了名（不动商品的版本号）——确认时按新名字认不出来，拒绝
  const areaId = (await ok(call("POST", "/areas", { body: { city_id: ids["tokyo"], name: { zh: "改名前" }, biz_type: "general", polygons: [POLYGON] } }), 201)).id;
  const other = await product({ areaIds: [areaId] });
  const sheet = await priceSheet(other);
  const file = sheet.file([{ ...FIXED, 区域: "改名前" }]);
  const pricePreview = await ok(upload(`/products/${other}/price-rules/import/preview`, file));
  assert.equal(pricePreview.can_import, true);
  const area = await ok(call("GET", `/areas/${areaId}`));
  await ok(call("PUT", `/areas/${areaId}`, { version: area.version, body: { city_id: ids["tokyo"], name: { zh: "改名后" }, biz_type: "general", polygons: [POLYGON] } }));
  const currentVersion = await version(other);
  const renamed = await upload(`/products/${other}/price-rules/import?file_sha256=${pricePreview.file_sha256}`, file, { version: currentVersion });
  assert.deepEqual([renamed.status, renamed.body.error.code], [409, "IMPORT_NOT_CLEAN"]);
  assert.deepEqual(renamed.body.error.details.preview.rows[0].issues.map((issue: any) => issue.reason), ["AREA_NOT_IN_PRODUCT"]);
  assert.equal((await prices(other)).items.length, 0);
});

test("全部成功或全部失败：写到一半数据库出错（审计日志写不进去）——已经写的价格 / 库存整份回滚，版本号不变；故障排除后用同一个幂等键重试成功", async () => {
  const id = await product();
  await limited(id);
  await batchSet(id, { from: "2026-10-20", to: "2026-10-20", total: 5 });
  const sheet = await priceSheet(id);
  const priceFile = sheet.file([FIXED, MILEAGE, { ...FIXED, 车型组: "VG-ECO-4", 方向: "接机", 生效开始: "2027-01-01" }]);
  const stock = stockFile([["2026-10-20", null], ["2026-10-21", num(3)], ["2026-10-22", num(0)]]);
  const current = await version(id);
  const before = await snapshot();
  const keys = { price: randomUUID(), stock: randomUUID() };
  await api.db.owner.query("create function qa_induced_failure() returns trigger language plpgsql as $$ begin raise exception 'qa induced failure'; end $$");
  await api.db.owner.query("create trigger qa_fail_audit before insert on audit_logs for each row when (new.resource in ('inventory', 'price_rule')) execute function qa_induced_failure()");
  try {
    assert.equal((await upload(`/products/${id}/price-rules/import?file_sha256=${sha(priceFile)}`, priceFile, { version: current, key: keys.price })).status, 500);
    assert.equal((await upload(`/products/${id}/inventory/import?file_sha256=${sha(stock)}`, stock, { version: current, key: keys.stock })).status, 500);
    assert.equal((await call("POST", `/products/${id}/inventory/batch-set`, { version: current, body: { from: "2026-10-20", to: "2026-10-25", total: 9 } })).status, 500);
    assert.deepEqual(await snapshot(), before, "一行都没有留下");
  } finally {
    await api.db.owner.query("drop trigger qa_fail_audit on audit_logs");
    await api.db.owner.query("drop function qa_induced_failure()");
  }
  const priced = await ok(upload(`/products/${id}/price-rules/import?file_sha256=${sha(priceFile)}`, priceFile, { version: current, key: keys.price }));
  assert.deepEqual([priced.version, priced.items.length], [current + 1, 3]);
  const stocked = await ok(upload(`/products/${id}/inventory/import?file_sha256=${sha(stock)}`, stock, { version: current + 1, key: keys.stock }));
  assert.deepEqual([stocked.version, stocked.changed_days], [current + 2, 3]);
});

test("重复确认：同一个幂等键同时发 8 次、网络不确定后重试——只导入一次、应答相同、审计只有一份；不同的键同时确认同一份预览，只有一个成功", async () => {
  const id = await product();
  await limited(id);
  const stock = stockFile([["2026-10-20", num(4)], ["2026-10-21", num(4)]]);
  const current = await version(id);
  const path = `/products/${id}/inventory/import?file_sha256=${sha(stock)}`;
  const key = randomUUID();
  const same = await Promise.all(Array.from({ length: 8 }, () => upload(path, stock, { version: current, key })));
  const succeeded = same.filter((res) => res.status === 200);
  assert.ok(succeeded.length >= 1, same.map((res) => res.status).join(","));
  for (const res of same) assert.ok(res.status === 200 || res.status === 409, `${res.status} ${res.text.slice(0, 200)}`);
  for (const res of succeeded) assert.deepEqual(res.body, succeeded[0]?.body);
  // 之后再重试（商品的版本号已经变了，带的还是当时的版本号）：原样返回第一次的结果
  assert.deepEqual(await ok(upload(path, stock, { version: current, key })), succeeded[0]?.body);
  assert.equal(await version(id), current + 1);
  assert.equal(await auditCount("inventory", id), 1);
  // 同一个键配别的内容：拒绝
  const other = stockFile([["2026-10-25", num(1)]]);
  assert.equal((await upload(`/products/${id}/inventory/import?file_sha256=${sha(other)}`, other, { version: current + 1, key })).body.error.code, "IDEMPOTENCY_KEY_REUSED");
  // 不同的键同时确认同一份价格预览
  const sheet = await priceSheet(id);
  const file = sheet.file([FIXED, MILEAGE]);
  const base = await version(id);
  const racing = await Promise.all(Array.from({ length: 8 }, () => upload(`/products/${id}/price-rules/import?file_sha256=${sha(file)}`, file, { version: base })));
  assert.deepEqual(racing.map((res) => (res.status === 200 ? "200" : `${res.status} ${res.body?.error?.code}`)).sort(), ["200", ...Array.from({ length: 7 }, () => "409 VERSION_CONFLICT")]);
  assert.equal((await prices(id)).items.length, 2, "没有导入两次");
  assert.equal(await version(id), base + 1);
});

test("导出再原样导入，全部「没变」：一口价、里程 + 时长、包车套餐，日元和美元，多语言的区域名、只有英文名且带 HTML 字符的区域，停用的价格，过去的库存日子", async () => {
  // 接送机（日元）：两种计价方式
  const transfer = await product();
  const add = async (productId: string, body: Record<string, unknown>): Promise<void> => {
    api.clock.advance(1_000);
    await ok(call("POST", `/products/${productId}/price-rules`, { version: await version(productId), body }), 201);
  };
  await add(transfer, { area_id: ids["a1"], vehicle_group_id: ids["biz7"], direction: "pickup", pricing_model: "fixed", base_price: 20_000, valid_from: "2025-01-01", valid_to: "2025-12-31" });
  await add(transfer, { area_id: ids["a2"], vehicle_group_id: ids["eco4"], direction: "dropoff", pricing_model: "mileage_time", start_price: 3_000, start_meters: 12_300, start_minutes: 20, per_km: 400, per_minute: 80, min_price: 5_000, valid_from: "2026-10-01", status: "disabled" });
  await add(transfer, { area_id: ids["a2"], vehicle_group_id: ids["biz7"], direction: "both", pricing_model: "mileage_time", start_price: 1, start_meters: 0, start_minutes: 0, per_km: 1, per_minute: 1, valid_from: "2026-10-01" });
  // 包车（美元）
  const charter = await product({ category: "charter", brand: "usd" });
  await add(charter, { area_id: ids["a1"], vehicle_group_id: ids["biz7"], package_hours: 8, pricing_model: "charter_package", package_km: 100, package_price: 45_050, overtime_per_hour: 5_001, over_km_per_km: 99, valid_from: "2026-10-01" });
  await add(charter, { area_id: ids["a2"], vehicle_group_id: ids["biz7"], package_hours: 4, pricing_model: "charter_package", package_km: 50, package_price: 7, overtime_per_hour: 100, over_km_per_km: 10, valid_from: "2026-10-01", valid_to: "2026-10-01" });
  for (const id of [transfer, charter]) {
    const exported = await download(`/products/${id}/price-rules/export`);
    const count = (await prices(id)).items.length;
    assert.equal(exported.rows.length, count + 1);
    const seen = await ok(upload(`/products/${id}/price-rules/import/preview`, exported.bytes));
    assert.deepEqual([seen.summary, seen.can_import, rowSummary(seen).filter((row: any) => row[1] !== "unchanged")], [{ rows: count, create: 0, update: 0, unchanged: count, error: 0, conflict: 0 }, false, []]);
    assert.doesNotMatch(JSON.stringify(exported.rows), /markup|sell_price|对外价|加价/i);
  }
  const usdRows = (await download(`/products/${charter}/price-rules/export`)).rows;
  assert.deepEqual(usdRows[1]?.slice(3, 8), ["8", "100", "450.50", "50.01", "0.99"], "美元：主单位、两位小数");
  assert.deepEqual(usdRows[2]?.slice(3, 8), ["4", "50", "0.07", "1.00", "0.10"]);
  // 区域可以用任何一种语言的名字来认，大小写和全角半角不计较；车型组编码同理
  const sheet = await priceSheet(transfer);
  const named = await ok(upload(`/products/${transfer}/price-rules/import/preview`, sheet.file([
    { ...FIXED, 区域: "central tokyo", 车型组: "vg-eco-4", 生效开始: "2030-01-01" },
    { ...FIXED, 区域: " 東京都心 ", 车型组: "ＶＧ－ＥＣＯ－４", 生效开始: "2031-01-01", 生效结束: "2031-12-31", 方向: "送机" },
    { ...FIXED, 区域: "Yokohama <b>Bay</b>", 车型组: "VG-ECO-4", 方向: "接机", 生效开始: "2030-01-01" },
    { ...FIXED, 区域: "Yokohama Bay", 车型组: "VG-ECO-4", 生效开始: "2032-01-01" },
  ])));
  assert.deepEqual(named.rows.map((row: any) => [row.action, row.content.area, row.content.vehicle_group, row.issues.map((issue: any) => issue.reason)]), [
    ["create", "东京市区", "VG-ECO-4", []],
    ["create", "东京市区", "VG-ECO-4", []],
    ["create", "Yokohama <b>Bay</b>", "VG-ECO-4", []],
    ["error", "Yokohama Bay", "VG-ECO-4", ["AREA_NOT_IN_PRODUCT"]],
  ]);
  // 库存：导出的范围里有过去的日子（已经过去的那几天是当时设的数）
  await limited(transfer);
  await batchSet(transfer, { from: TODAY, to: "2026-10-09", total: 5 });
  const tenantId = (await api.db.owner.query("select tenant_id from products where id = $1", [transfer])).rows[0].tenant_id;
  await api.db.owner.query("insert into inventory_days (tenant_id, product_id, day, total, held, sold, created_at, updated_at) values ($1, $2, '2026-10-05', 3, 0, 2, now(), now()), ($1, $2, '2026-10-06', 0, 0, 0, now(), now())", [tenantId, transfer]);
  const exported = await download(`/products/${transfer}/inventory/export?from=2026-10-03&to=2026-10-11`);
  assert.deepEqual(exported.rows.slice(1), [["2026-10-03"], ["2026-10-04"], ["2026-10-05", "3"], ["2026-10-06", "0"], ["2026-10-07", "5"], ["2026-10-08", "5"], ["2026-10-09", "5"], ["2026-10-10"], ["2026-10-11"]]);
  const again = await ok(upload(`/products/${transfer}/inventory/import/preview`, exported.bytes));
  assert.deepEqual([again.summary, again.can_import], [{ rows: 9, set: 0, clear: 0, unchanged: 9, error: 0, conflict: 0 }, false]);
  // 只改以后的日子：过去的原样留着不挡路；动了过去的日子（改数、清除、给没设的填数）都报到那一行
  const edited = stockFile([["2026-10-04", null], ["2026-10-05", num(3)], ["2026-10-06", num(0)], [TODAY, num(6)], ["2026-10-10", num(2)]]);
  const editedPreview = await ok(upload(`/products/${transfer}/inventory/import/preview`, edited));
  assert.deepEqual([editedPreview.summary, editedPreview.can_import], [{ rows: 5, set: 2, clear: 0, unchanged: 3, error: 0, conflict: 0 }, true]);
  const touched = await ok(upload(`/products/${transfer}/inventory/import/preview`, stockFile([["2026-10-04", num(1)], ["2026-10-05", num(4)], ["2026-10-06", null]])));
  assert.deepEqual(touched.rows.map((row: any) => [row.action, row.issues.map((issue: any) => `${issue.cell} ${issue.reason}`)]), [["error", ["A2 DATE_IN_PAST"]], ["error", ["A3 DATE_IN_PAST"]], ["error", ["A4 DATE_IN_PAST"]]]);
});

test("按名称认区域的歧义：两个区域在不同语言下重名时报到单元格、不猜；文件里写别的商品才有的区域、别的商品的价格编号都不认", async () => {
  const first = await call("POST", "/areas", { body: { city_id: ids["tokyo"], name: { zh: "港区", en: "Minato" }, biz_type: "general", polygons: [POLYGON] } });
  api.clock.advance(1_000);
  const second = await call("POST", "/areas", { body: { city_id: ids["tokyo"], name: { zh: "港湾", ja: "港区" }, biz_type: "general", polygons: [POLYGON] } });
  assert.equal(first.status, 201, first.text);
  const id = await product({ areaIds: [first.body.id, ...(second.status === 201 ? [second.body.id] : []), ids["a1"] as string] });
  const sheet = await priceSheet(id);
  const rows = [{ ...FIXED, 区域: "港区" }, { ...FIXED, 区域: "Minato", 方向: "接机", 生效开始: "2030-01-01" }, { ...FIXED, 区域: "Yokohama <b>Bay</b>", 方向: "送机", 生效开始: "2031-01-01" }];
  const seen = await ok(upload(`/products/${id}/price-rules/import/preview`, sheet.file(rows)));
  if (second.status === 201) assert.deepEqual([seen.rows[0].action, seen.rows[0].issues.map((issue: any) => `${issue.cell} ${issue.reason}`)], ["error", ["B2 AMBIGUOUS"]]);
  else assert.equal(second.status, 409, "不同语言下重名的区域建不出来，也就不会有歧义");
  assert.deepEqual([seen.rows[1].action, seen.rows[1].content.area], ["create", "港区"]);
  assert.deepEqual([seen.rows[2].action, seen.rows[2].issues.map((issue: any) => issue.reason)], ["error", ["AREA_NOT_IN_PRODUCT"]], "租户里有、但这个商品没选的区域");
  // 别的商品的价格编号
  const other = await product();
  const foreign = (await ok(call("POST", `/products/${other}/price-rules`, { version: 1, body: { area_id: ids["a1"], vehicle_group_id: ids["biz7"], direction: "pickup", pricing_model: "fixed", base_price: 20_000, valid_from: "2026-10-01" } }), 201)).price_rule;
  const stolen = await ok(upload(`/products/${id}/price-rules/import/preview`, sheet.file([{ ...FIXED, 价格编号: foreign.id, 区域: "东京市区", 基础价: num(1) }, { ...FIXED, 价格编号: "不是编号", 区域: "东京市区", 方向: "接机" }, { ...FIXED, 价格编号: "'; drop table price_rules; --", 区域: "东京市区", 方向: "送机" }])));
  assert.deepEqual(stolen.rows.map((row: any) => [row.action, row.price_rule_id, row.issues.map((issue: any) => `${issue.cell} ${issue.reason}`)]), [["error", null, ["A2 UNKNOWN_PRICE_RULE"]], ["error", null, ["A3 UNKNOWN_PRICE_RULE"]], ["error", null, ["A4 UNKNOWN_PRICE_RULE"]]]);
  assert.equal((await prices(other)).items[0].base_price, 20_000);
});

test("价格导入和页面保存是同一套规则：同样的改动经批量保存接口被拒绝的（重叠、超范围、已上架商品停掉最后一条启用的价格），经导入也被拒绝，而且都不写", async () => {
  const id = await product({ category: "point_to_point", complete: true });
  assert.equal((await ok(call("POST", `/products/${id}/publish`))).status, "published");
  const only = (await prices(id)).items[0];
  const sheet = await priceSheet(id);
  const current = await version(id);
  const base = { area_id: ids["a1"], vehicle_group_id: ids["biz7"], pricing_model: "fixed", base_price: 9_000, valid_from: "2026-01-01" };
  const P2P: Record<string, XlsxWriteCell> = { 区域: "东京市区", 车型组: "VG-BIZ-7", 计价方式: "一口价", 基础价: num(9000), 生效开始: "2026-01-01" };
  const attempts: [string, Record<string, unknown>, Record<string, XlsxWriteCell>[]][] = [
    ["停掉最后一条启用的价格", { update: [{ id: only.id, ...base, status: "disabled" }] }, [{ ...P2P, 价格编号: only.id, 状态: "停用" }]],
    ["让最后一条价格过期", { update: [{ id: only.id, ...base, valid_to: "2026-10-01" }] }, [{ ...P2P, 价格编号: only.id, 生效结束: "2026-10-01" }]],
    ["新增一条日期重叠的", { create: [{ ...base, valid_from: "2026-06-01" }] }, [{ ...P2P, 生效开始: "2026-06-01" }]],
    ["金额为 0", { create: [{ ...base, vehicle_group_id: ids["eco4"], base_price: 0 }] }, [{ ...P2P, 车型组: "VG-ECO-4", 基础价: num(0) }]],
    ["结束早于开始", { create: [{ ...base, vehicle_group_id: ids["eco4"], valid_from: "2026-06-01", valid_to: "2026-05-01" }] }, [{ ...P2P, 车型组: "VG-ECO-4", 生效开始: "2026-06-01", 生效结束: "2026-05-01" }]],
  ];
  const before = await snapshot();
  for (const [label, body, rows] of attempts) {
    const page = await call("POST", `/products/${id}/price-rules/batch`, { version: current, body });
    assert.ok(page.status >= 400 && page.status < 500, `${label}：页面保存应当被拒绝，实际 ${page.status} ${page.text.slice(0, 200)}`);
    const file = sheet.file(rows);
    const imported = await upload(`/products/${id}/price-rules/import?file_sha256=${sha(file)}`, file, { version: current });
    assert.ok(imported.status >= 400 && imported.status < 500, `${label}：导入也应当被拒绝，实际 ${imported.status} ${imported.text.slice(0, 300)}`);
  }
  assert.deepEqual(await snapshot(), before);
  assert.equal((await ok(call("GET", `/products/${id}`))).status, "published");
  // 页面保存能过的，导入也能过：改价
  const raise = sheet.file([{ ...P2P, 价格编号: only.id, 基础价: num(9500) }]);
  const done = await ok(upload(`/products/${id}/price-rules/import?file_sha256=${sha(raise)}`, raise, { version: current }));
  assert.deepEqual(done.items.map((item: any) => item.base_price), [9_500]);
  // 导入不能删除价格：文件里少了的行不会被删
  const none = sheet.file([{ ...P2P, 车型组: "VG-ECO-4" }]);
  const added = await ok(upload(`/products/${id}/price-rules/import?file_sha256=${sha(none)}`, none, { version: done.version }));
  assert.equal(added.items.length, 2);
});

test("导出的文件防公式注入：区域名、车型组名里以 = + - @ 开头的文字在文件里都带单引号；文件名只有商品编码和日期", async () => {
  const names = ["=HYPERLINK(\"http://evil.example\",\"点我\")", "+cmd|' /C calc'!A0", "-2+3", "@SUM(1+1)"];
  const areaIds: string[] = [];
  for (const name of names) {
    api.clock.advance(1_000);
    areaIds.push((await ok(call("POST", "/areas", { body: { city_id: ids["tokyo"], name: { zh: name }, biz_type: "general", polygons: [POLYGON] } }), 201)).id);
  }
  const id = await product({ areaIds });
  for (const [index, areaId] of areaIds.entries()) {
    api.clock.advance(1_000);
    await ok(call("POST", `/products/${id}/price-rules`, { version: await version(id), body: { area_id: areaId, vehicle_group_id: ids["biz7"], direction: "both", pricing_model: "fixed", base_price: 1_000 + index, valid_from: "2026-10-01" } }), 201);
  }
  const { unzipEntry } = await import("./integrations/zip.ts");
  const exported = await download(`/products/${id}/price-rules/export`);
  assert.match(String(exported.headers["content-disposition"]), /^attachment; filename="[A-Za-z0-9-]+-prices\.xlsx"$/);
  for (const part of ["xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]) {
    const xml = unzipEntry(exported.bytes, part).toString("utf8");
    assert.ok(!/<f[\s>/]/.test(xml));
    const texts = [...xml.matchAll(/<t xml:space="preserve">([^<]*)<\/t>/g)].map((match) => match[1] as string);
    assert.ok(texts.length > 0);
    for (const text of texts) assert.ok(!/^[=+\-@\t\r]/.test(text), `${part}：${text}`);
    for (const name of names) assert.ok(texts.some((text) => text.startsWith("'") && text.includes(name.slice(0, 4).replace(/"/g, "&quot;"))), `${part} 里有带保护的 ${name}`);
  }
  // 读回来名字不变，原样导入全部没变
  assert.deepEqual(exported.rows.slice(1).map((row) => row[1]), names);
  const seen = await ok(upload(`/products/${id}/price-rules/import/preview`, exported.bytes));
  assert.deepEqual(seen.summary, { rows: 4, create: 0, update: 0, unchanged: 4, error: 0, conflict: 0 });
});

// ---- 库存规则 ----

test("模式切换保留各天的数，占用也不受影响；不限量时也可以先设好；切换本身不动 held / sold", async () => {
  const id = await product();
  await batchSet(id, { from: "2026-10-20", to: "2026-10-22", total: 5 });
  assert.deepEqual((await inventory(id, "2026-10-20", "2026-10-22")).days.map((day: any) => [day.total, day.remaining, day.status]), [[5, null, "unlimited"], [5, null, "unlimited"], [5, null, "unlimited"]]);
  await limited(id);
  await api.db.owner.query("update inventory_days set held = 1, sold = 2 where product_id = $1 and day = '2026-10-21'", [id]);
  const rows = async (): Promise<unknown[]> => (await api.db.owner.query("select day::text, total, held, sold from inventory_days where product_id = $1 order by day", [id])).rows;
  const before = await rows();
  for (const mode of ["unlimited", "limited", "unlimited", "unlimited", "limited"]) await ok(call("PUT", `/products/${id}/inventory`, { version: await version(id), body: { mode } }));
  assert.deepEqual(await rows(), before);
  assert.deepEqual((await inventory(id, "2026-10-20", "2026-10-22")).days.map((day: any) => [day.total, day.held, day.sold, day.remaining, day.status]), [[5, 0, 0, 5, "open"], [5, 1, 2, 2, "open"], [5, 0, 0, 5, "open"]]);
  // 不限量模式下占用保护照样起作用
  await ok(call("PUT", `/products/${id}/inventory`, { version: await version(id), body: { mode: "unlimited" } }));
  const blocked = await call("POST", `/products/${id}/inventory/batch-set`, { version: await version(id), body: { from: "2026-10-20", to: "2026-10-22", total: null } });
  assert.deepEqual([blocked.status, blocked.body.error.code, blocked.body.error.details], [409, "INVENTORY_BELOW_OCCUPIED", { days: [{ date: "2026-10-21", occupied: 3 }] }]);
  assert.deepEqual(await rows(), before);
});

test("占用保护的边界（用迁移账号摆占用数）：只有预占、只有已售、两者都有；正好等于占用数可以；按星期批量时只看选中的日子；导入和批量设置的说法一致", async () => {
  const id = await product();
  await limited(id);
  await batchSet(id, { from: "2026-10-19", to: "2026-10-25", total: 6 });
  // 10-19 周一 预占 2；10-21 周三 已售 3；10-24 周六 预占 1 已售 5（占满）
  await api.db.owner.query("update inventory_days set held = 2 where product_id = $1 and day = '2026-10-19'", [id]);
  await api.db.owner.query("update inventory_days set sold = 3 where product_id = $1 and day = '2026-10-21'", [id]);
  await api.db.owner.query("update inventory_days set held = 1, sold = 5 where product_id = $1 and day = '2026-10-24'", [id]);
  const attempt = async (body: Record<string, unknown>): Promise<unknown> => {
    const res = await call("POST", `/products/${id}/inventory/batch-set`, { version: await version(id), body: { from: "2026-10-19", to: "2026-10-25", ...body } });
    return res.status === 200 ? res.body.changed_days : [res.body.error.code, res.body.error.details.days];
  };
  assert.deepEqual(await attempt({ total: 5 }), ["INVENTORY_BELOW_OCCUPIED", [{ date: "2026-10-24", occupied: 6 }]]);
  assert.deepEqual(await attempt({ total: 2 }), ["INVENTORY_BELOW_OCCUPIED", [{ date: "2026-10-21", occupied: 3 }, { date: "2026-10-24", occupied: 6 }]]);
  assert.deepEqual(await attempt({ total: 1 }), ["INVENTORY_BELOW_OCCUPIED", [{ date: "2026-10-19", occupied: 2 }, { date: "2026-10-21", occupied: 3 }, { date: "2026-10-24", occupied: 6 }]]);
  // 只选没有占用的星期（周二、周四、周五、周日）：清除也可以
  assert.equal(await attempt({ total: null, weekdays: [2, 4, 5, 7] }), 4);
  // 正好等于占用数
  assert.equal(await attempt({ total: 2, weekdays: [1] }), 1);
  assert.equal(await attempt({ total: 3, weekdays: [3] }), 1);
  assert.equal(await attempt({ total: 6, weekdays: [6] }), 0, "没有变化");
  assert.deepEqual((await inventory(id, "2026-10-19", "2026-10-25")).days.map((day: any) => [day.total, day.remaining, day.status]), [[2, 0, "sold_out"], [null, 0, "unset"], [3, 0, "sold_out"], [null, 0, "unset"], [null, 0, "unset"], [6, 0, "sold_out"], [null, 0, "unset"]]);
  // 导入对同样的三天给出同样的占用数
  const seen = await ok(upload(`/products/${id}/inventory/import/preview`, stockFile([["2026-10-19", num(1)], ["2026-10-21", null], ["2026-10-24", num(5)], ["2026-10-20", num(1)]])));
  assert.deepEqual(seen.rows.map((row: any) => [row.action, row.occupied]), [["conflict", 2], ["conflict", 3], ["conflict", 6], ["set", null]]);
});

test("ahead 概况和上架检查的「库存」一项说法一致：没设、只有过去的日子、今天停售、今天占满、今天还有 1 单、只有第 730 天有", async () => {
  const id = await product({ category: "point_to_point", complete: true });
  await limited(id);
  const tenantId = (await api.db.owner.query("select tenant_id from products where id = $1", [id])).rows[0].tenant_id;
  const both = async (): Promise<[number, string | null, boolean]> => {
    const view = await inventory(id, TODAY, TODAY);
    const item = (await ok(call("GET", `/products/${id}/publish-check`))).items.find((entry: any) => entry.key === "inventory");
    assert.equal(item.passed, view.ahead.sellable_days > 0, `概况说 ${view.ahead.sellable_days} 天可售，上架检查说 ${item.passed ? "通过" : "不通过"}`);
    assert.deepEqual(item.issues.map((issue: any) => issue.reason), item.passed ? [] : ["NO_INVENTORY_AHEAD"]);
    return [view.ahead.sellable_days, view.ahead.last_set_date, item.passed];
  };
  assert.deepEqual(await both(), [0, null, false]);
  await api.db.owner.query("insert into inventory_days (tenant_id, product_id, day, total, created_at, updated_at) values ($1, $2, '2026-10-06', 9, now(), now())", [tenantId, id]);
  assert.deepEqual(await both(), [0, null, false], "昨天的库存不算");
  await batchSet(id, { from: TODAY, to: TODAY, total: 0 });
  assert.deepEqual(await both(), [0, TODAY, false]);
  await batchSet(id, { from: TODAY, to: TODAY, total: 2 });
  assert.deepEqual(await both(), [1, TODAY, true]);
  await api.db.owner.query("update inventory_days set held = 1, sold = 1 where product_id = $1 and day = $2", [id, TODAY]);
  assert.deepEqual(await both(), [0, TODAY, false], "今天占满了");
  await batchSet(id, { from: "2028-10-06", to: "2028-10-06", total: 1 });
  assert.deepEqual(await both(), [1, "2028-10-06", true], "第 730 天");
  const tooFar = await call("POST", `/products/${id}/inventory/batch-set`, { version: await version(id), body: { from: "2028-10-07", to: "2028-10-07", total: 1 } });
  assert.deepEqual(tooFar.body.error.details.issues.map((issue: any) => [issue.path, issue.reason]), [["/from", "TOO_FAR_AHEAD"], ["/to", "TOO_FAR_AHEAD"]]);
  // 不限量：上架检查通过，概况照样给出
  await ok(call("PUT", `/products/${id}/inventory`, { version: await version(id), body: { mode: "unlimited" } }));
  const view = await inventory(id, TODAY, TODAY);
  assert.deepEqual([view.ahead, (await ok(call("GET", `/products/${id}/publish-check`))).items.find((entry: any) => entry.key === "inventory").passed], [{ sellable_days: 1, last_set_date: "2028-10-06" }, true]);
});

test("「今天」按城市当地日期，跨午夜、跨月、跨年（独立的时钟）：同一时刻纽约的商品还能改 10-06，东京的不行；东京过了午夜，昨天就不能改了", async () => {
  const own = await createTestApi();
  try {
    const ownRoot = await own.superAdminToken();
    const fixture = await own.tenantWithAdmin(ownRoot, "乙车队", "admin@b.test");
    const saved = { ...ids };
    await setup(own, ownRoot, fixture.adminToken);
    const on: Env = { api: own, token: fixture.adminToken };
    try {
      const nyc = (await ok(platformCall(own, ownRoot, "POST", "/master/cities", { country_code: "US", timezone: "America/New_York", code: "CTY-US-NYC", name: { zh: "纽约" }, center: { lng: -74.006, lat: 40.7128 } }), 201)).id;
      const nycArea = (await ok(call("POST", "/areas", { on, body: { city_id: nyc, name: { zh: "曼哈顿" }, biz_type: "general", polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [[[-74.02, 40.7], [-73.93, 40.7], [-73.93, 40.8], [-74.02, 40.8], [-74.02, 40.7]]] } }] } }), 201)).id;
      const tokyo = await product({ category: "point_to_point", on });
      const newYork = await product({ category: "point_to_point", on, cityId: nyc, areaIds: [nycArea] });
      const reasons = async (id: string, from: string, to = from): Promise<string> => {
        const res = await call("POST", `/products/${id}/inventory/batch-set`, { on, version: await version(id, on), body: { from, to, total: 1 } });
        return res.status === 200 ? "ok" : res.body.error.details.issues.filter((issue: any) => to !== from || issue.path === "/from").map((issue: any) => `${issue.path} ${issue.reason}`).join(",");
      };
      // 开始时是东京 10-07 10:00 = 纽约 10-06 21:00
      assert.deepEqual([(await inventory(tokyo, TODAY, TODAY, on)).today, (await inventory(newYork, TODAY, TODAY, on)).today], ["2026-10-07", "2026-10-06"]);
      assert.deepEqual([await reasons(tokyo, "2026-10-06"), await reasons(newYork, "2026-10-06"), await reasons(newYork, "2026-10-05")], ["/from DATE_IN_PAST", "ok", "/from DATE_IN_PAST"]);
      // 最远的一天也跟着当地的今天走
      assert.deepEqual([await reasons(tokyo, "2028-10-06"), await reasons(tokyo, "2028-10-07"), await reasons(newYork, "2028-10-05"), await reasons(newYork, "2028-10-06")], ["ok", "/from TOO_FAR_AHEAD", "ok", "/from TOO_FAR_AHEAD"]);
      // 东京 23:59:59 → 00:00:00
      // 把时钟拨到某个时刻；令牌会过期，拨完重新登录
      const toTokyo = async (iso: string): Promise<void> => {
        own.clock.advance(new Date(iso).getTime() - own.clock.now().getTime());
        on.token = (await ok(own.call("POST", "/tenant/v1/auth/login", { body: { email: "admin@b.test", password: TEST_PASSWORD } }))).access_token;
      };
      await toTokyo("2026-10-07T14:59:59Z");
      assert.deepEqual([(await inventory(tokyo, TODAY, TODAY, on)).today, await reasons(tokyo, "2026-10-07")], ["2026-10-07", "ok"]);
      await toTokyo("2026-10-07T15:00:00Z");
      assert.deepEqual([(await inventory(tokyo, TODAY, TODAY, on)).today, await reasons(tokyo, "2026-10-07"), await reasons(tokyo, "2026-10-08")], ["2026-10-08", "/from DATE_IN_PAST", "ok"]);
      // 导入：昨天那一行原样留着算没变，改了就报错
      const yesterday = await ok(upload(`/products/${tokyo}/inventory/import/preview`, stockFile([["2026-10-07", num(1)], ["2026-10-08", num(2)]]), { on }));
      assert.deepEqual(yesterday.rows.map((row: any) => row.action), ["unchanged", "set"]);
      // 跨月（10-31 → 11-01）和纽约夏令时结束那天（11-01 有 25 个小时）
      await toTokyo("2026-11-01T03:59:59Z");
      assert.deepEqual([(await inventory(tokyo, TODAY, TODAY, on)).today, (await inventory(newYork, TODAY, TODAY, on)).today], ["2026-11-01", "2026-10-31"]);
      await toTokyo("2026-11-01T04:00:00Z");
      assert.equal((await inventory(newYork, TODAY, TODAY, on)).today, "2026-11-01");
      await toTokyo("2026-11-02T04:59:59Z");
      assert.deepEqual([(await inventory(newYork, TODAY, TODAY, on)).today, await reasons(newYork, "2026-11-01")], ["2026-11-01", "ok"]);
      await toTokyo("2026-11-02T05:00:00Z");
      assert.deepEqual([(await inventory(newYork, TODAY, TODAY, on)).today, await reasons(newYork, "2026-11-01")], ["2026-11-02", "/from DATE_IN_PAST"]);
      // 跨年，批量设置的范围跨过闰日
      await toTokyo("2027-12-31T15:00:00Z");
      assert.equal((await inventory(tokyo, TODAY, TODAY, on)).today, "2028-01-01");
      const leap = await ok(call("POST", `/products/${tokyo}/inventory/batch-set`, { on, version: await version(tokyo, on), body: { from: "2028-02-27", to: "2028-03-01", total: 2 } }));
      assert.deepEqual(leap.days.map((day: any) => day.date), ["2028-02-27", "2028-02-28", "2028-02-29", "2028-03-01"]);
      assert.equal(await reasons(tokyo, "2028-01-01", "2028-12-31"), "ok", "闰年一整年正好 366 天");
      assert.equal(await reasons(tokyo, "2028-01-01", "2029-01-01"), "/to TOO_MANY");
    } finally {
      Object.assign(ids, saved);
    }
  } finally {
    await own.close();
  }
});

// ---- 并发 ----

test("并发不超卖：多条连接同时预占 / 释放 / 确认，同时供应商在批量调低、清除、切模式、导入——每一轮之后 held + sold <= total，成功预占的单一单不丢，接口只有 200 或 409", async () => {
  const id = await product();
  await limited(id);
  const day = "2026-11-10";
  await batchSet(id, { from: day, to: day, total: 6 });
  const hold = (n: number): Promise<number> => api.db.owner.query("update inventory_days set held = held + $3 where product_id = $1 and day = $2 and vehicle_group_id is null and total - held - sold >= $3", [id, day, n]).then((result) => (result.rowCount === 1 ? n : 0));
  const release = (): Promise<number> => api.db.owner.query("update inventory_days set held = held - 1 where product_id = $1 and day = $2 and vehicle_group_id is null and held >= 1", [id, day]).then((result) => (result.rowCount === 1 ? -1 : 0));
  const confirm = (): Promise<number> => api.db.owner.query("update inventory_days set held = held - 1, sold = sold + 1 where product_id = $1 and day = $2 and vehicle_group_id is null and held >= 1", [id, day]).then(() => 0);
  const occupied = async (): Promise<number> => {
    const row = await dayRow(id, day);
    if (row !== null) assert.ok(row.held >= 0 && row.sold >= 0 && row.held + row.sold <= row.total, JSON.stringify(row));
    return row === null ? 0 : row.held + row.sold;
  };
  const supplierMoves: ((v: number) => Promise<ApiResponse>)[] = [
    (v) => call("POST", `/products/${id}/inventory/batch-set`, { version: v, body: { from: day, to: day, total: 2 } }),
    (v) => call("POST", `/products/${id}/inventory/batch-set`, { version: v, body: { from: day, to: day, total: null } }),
    (v) => call("POST", `/products/${id}/inventory/batch-set`, { version: v, body: { from: day, to: day, total: 0 } }),
    (v) => call("POST", `/products/${id}/inventory/batch-set`, { version: v, body: { from: "2026-11-01", to: "2026-11-30", total: 8 } }),
    (v) => call("PUT", `/products/${id}/inventory`, { version: v, body: { mode: "unlimited" } }),
    (v) => call("PUT", `/products/${id}/inventory`, { version: v, body: { mode: "limited" } }),
    (v) => {
      const file = stockFile([[day, num(3)], ["2026-11-11", null]]);
      return upload(`/products/${id}/inventory/import?file_sha256=${sha(file)}`, file, { version: v });
    },
    (v) => {
      const file = stockFile([[day, null]]);
      return upload(`/products/${id}/inventory/import?file_sha256=${sha(file)}`, file, { version: v });
    },
  ];
  const outcomes: Record<string, number> = {};
  let held = 0;
  const logMark = api.logs().length;
  for (let round = 0; round < 24; round += 1) {
    const before = await occupied();
    const v = await version(id);
    const moves = [supplierMoves[round % supplierMoves.length], supplierMoves[(round * 3 + 1) % supplierMoves.length], supplierMoves[(round * 5 + 2) % supplierMoves.length]] as ((v: number) => Promise<ApiResponse>)[];
    const orders = Array.from({ length: 16 }, (_, index) => (index % 5 === 3 ? release() : index % 5 === 4 ? confirm() : hold(1 + (index % 3))));
    const [units, responses] = await Promise.all([Promise.all(orders), Promise.all(moves.map((move) => move(v)))]);
    for (const res of responses) {
      const outcome = res.status === 200 ? "200" : `${res.status} ${res.body?.error?.code}`;
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      assert.ok(res.status === 200 || res.status === 409, `第 ${round} 轮：${outcome} ${res.text.slice(0, 300)}`);
    }
    const net = units.reduce((sum, unit) => sum + unit, 0);
    held += units.filter((unit) => unit > 0).length;
    assert.equal(await occupied(), before + net, `第 ${round} 轮：成功的预占 / 释放净 ${net} 单，库里的占用数应当从 ${before} 变成 ${before + net}（少了就是订单占的库存被供应商的修改抹掉了）`);
  }
  // 两边确实交错发生过（具体次数随时机变化，这里只要求不是空跑）
  assert.ok(held >= 3 && (outcomes["200"] ?? 0) >= 3, `${held} 次预占成功；供应商的修改：${JSON.stringify(outcomes)}`);
  assert.doesNotMatch(api.logs().slice(logMark), /未预期的异常/, "这个测试期间没有一个请求走到 500");
});

test("并发的供应商修改：两次批量设置、批量设置和导入、导入和切模式用同一个版本号同时到——只有一个成功，结果是它的，别的是 409 VERSION_CONFLICT，审计各一条", async () => {
  const id = await product();
  await limited(id);
  for (let round = 0; round < 6; round += 1) {
    const v = await version(id);
    const audits = await auditCount("inventory", id);
    const file = stockFile([["2026-11-10", num(50 + round)], ["2026-11-11", num(50 + round)]]);
    const contenders: [string, Promise<ApiResponse>][] = [
      ["set-a", call("POST", `/products/${id}/inventory/batch-set`, { version: v, body: { from: "2026-11-10", to: "2026-11-12", total: 10 + round } })],
      ["set-b", call("POST", `/products/${id}/inventory/batch-set`, { version: v, body: { from: "2026-11-11", to: "2026-11-13", total: 30 + round } })],
      ["import", upload(`/products/${id}/inventory/import?file_sha256=${sha(file)}`, file, { version: v })],
      ["clear", call("POST", `/products/${id}/inventory/batch-set`, { version: v, body: { from: "2026-11-10", to: "2026-11-13", total: null } })],
    ];
    const results = await Promise.all(contenders.map(async ([label, pending]) => [label, await pending] as const));
    const winners = results.filter(([, res]) => res.status === 200);
    for (const [label, res] of results) if (res.status !== 200) assert.deepEqual([res.status, res.body.error.code], [409, "VERSION_CONFLICT"], label);
    // 第一轮全是没设的，清除没有变化也算成功（不加版本）；其余只有一个赢家改了数据
    const changed = winners.filter(([label, res]) => (label === "import" ? res.body.changed_days : res.body.changed_days) > 0);
    assert.equal(changed.length, 1, `第 ${round} 轮：${results.map(([label, res]) => `${label}=${res.status}`).join(" ")}`);
    const totals = (await inventory(id, "2026-11-10", "2026-11-13")).days.map((day: any) => day.total);
    const expected: Record<string, (number | null)[]> = { "set-a": [10 + round, 10 + round, 10 + round, null], "set-b": [null, 30 + round, 30 + round, 30 + round], import: [50 + round, 50 + round, null, null], clear: [null, null, null, null] };
    const winner = (changed[0] as (typeof changed)[number])[0];
    if (round === 0) assert.deepEqual(totals, expected[winner]);
    else assert.ok(["set-a", "set-b", "import", "clear"].includes(winner));
    assert.equal(await version(id), v + 1);
    assert.equal(await auditCount("inventory", id), audits + 1);
  }
});

// ---- 权限、暂停的租户、审计、对账 ----

test("九个接口逐个：管理员都能用，只读角色只能看和导出；租户被平台暂停后（需求：暂停 = 商品不参与比价、已有订单继续履约）接口的表现不变，不出 500", async () => {
  const other = await api.tenantWithAdmin(root, "丙车队", "admin@c.test");
  const on: Env = { api, token: other.adminToken };
  const brand = (await ok(call("POST", "/brands", { on, body: { name: "丙车队", currency: "JPY" } }), 201)).id;
  const area = (await ok(call("POST", "/areas", { on, body: { city_id: ids["tokyo"], name: { zh: "东京市区" }, biz_type: "general", polygons: [POLYGON] } }), 201)).id;
  const created = await ok(call("POST", "/products", { on, body: { brand_id: brand, city_id: ids["tokyo"], category: "airport_transfer", poi_id: ids["narita"], areas: [{ area_id: area }], vehicle_groups: [{ vehicle_group_id: ids["biz7"], passengers: 6, luggage: 2 }] } }), 201);
  const id = created.id;
  const readonly = (await addTenantUser(api, other.adminToken, "ro@c.test", "readonly")).token;
  const priceFile = (await priceSheet(await product())).file([FIXED]);
  const stock = stockFile([[TODAY, num(1)]]);
  const all = async (token: string): Promise<Record<string, number>> => {
    const get = async (path: string): Promise<number> => (await api.app.inject({ method: "GET", url: `/tenant/v1${path}`, headers: { authorization: `Bearer ${token}` } })).statusCode;
    return {
      "GET inventory": await get(`/products/${id}/inventory?from=${TODAY}&to=${TODAY}`),
      "GET inventory/export": await get(`/products/${id}/inventory/export?from=${TODAY}&to=${TODAY}`),
      "GET price-rules/export": await get(`/products/${id}/price-rules/export`),
      "POST inventory/import/preview": (await upload(`/products/${id}/inventory/import/preview`, stock, { token })).status,
      "POST price-rules/import/preview": (await upload(`/products/${id}/price-rules/import/preview`, priceFile, { token })).status,
      "PUT inventory": (await call("PUT", `/products/${id}/inventory`, { token, version: 1, body: { mode: "unlimited" } })).status,
      "POST inventory/batch-set": (await call("POST", `/products/${id}/inventory/batch-set`, { token, version: 1, body: { from: TODAY, to: TODAY, total: null } })).status,
      "POST inventory/import": (await upload(`/products/${id}/inventory/import?file_sha256=${sha(stock)}`, stock, { token, version: 99 })).status,
      "POST price-rules/import": (await upload(`/products/${id}/price-rules/import?file_sha256=${sha(priceFile)}`, priceFile, { token, version: 99 })).status,
    };
  };
  assert.deepEqual(Object.values(await all(other.adminToken)), [200, 200, 200, 200, 200, 200, 200, 409, 409]);
  assert.deepEqual(Object.values(await all(readonly)), [200, 200, 200, 403, 403, 403, 403, 403, 403], "只读：只能看和导出");
  const before = await snapshot();
  await ok(platformCall(api, root, "POST", `/tenants/${other.tenantId}/suspend`, { reason: "测试" }));
  try {
    assert.deepEqual(Object.values(await all(other.adminToken)), [200, 200, 200, 200, 200, 200, 200, 409, 409]);
    assert.deepEqual(Object.values(await all(readonly)), [200, 200, 200, 403, 403, 403, 403, 403, 403]);
    const { audits: _audits, ...rest } = (await snapshot()) as Record<string, unknown>;
    const { audits: _before, ...restBefore } = before as Record<string, unknown>;
    assert.deepEqual(rest, restBefore, "这些调用本身没有改动数据");
  } finally {
    await ok(platformCall(api, root, "POST", `/tenants/${other.tenantId}/resume`, {}));
  }
  assert.equal((await api.call("GET", `/tenant/v1/products/${id}/inventory?from=${TODAY}&to=${TODAY}`, { token: other.adminToken })).status, 200);
});

test("审计：批量设置记一条（范围、星期、数量、每一天的前后值）；库存导入记一条（带文件指纹）；价格导入逐条带前后值；没有变化、预览、被拒绝的都不留；日志里没有文件内容", async () => {
  const id = await product();
  await limited(id);
  const logs = async (resource: string, where = "resource_id = $2"): Promise<any[]> => (await api.db.owner.query(`select action, actor_email, before, after from audit_logs where resource = $1 and ${where} order by id`, [resource, id])).rows;
  await batchSet(id, { from: "2026-10-19", to: "2026-10-25", weekdays: [6, 7], total: 4 });
  await batchSet(id, { from: "2026-10-24", to: "2026-10-26", total: 4 });
  await batchSet(id, { from: "2026-10-24", to: "2026-10-26", total: 4 });
  await batchSet(id, { from: "2026-10-24", to: "2026-10-24", total: null });
  const stock = stockFile([["2026-10-24", num(0)], ["2026-10-25", null], ["2026-10-26", num(4)]]);
  await ok(upload(`/products/${id}/inventory/import/preview`, stock));
  await ok(upload(`/products/${id}/inventory/import?file_sha256=${sha(stock)}`, stock, { version: await version(id) }));
  assert.deepEqual(await logs("inventory"), [
    { action: "update", actor_email: "admin@a.test", before: { days: { "2026-10-24": null, "2026-10-25": null } }, after: { from: "2026-10-19", to: "2026-10-25", weekdays: [6, 7], total: 4, changed_days: 2, days: { "2026-10-24": 4, "2026-10-25": 4 } } },
    { action: "update", actor_email: "admin@a.test", before: { days: { "2026-10-26": null } }, after: { from: "2026-10-24", to: "2026-10-26", weekdays: [], total: 4, changed_days: 1, days: { "2026-10-26": 4 } } },
    { action: "update", actor_email: "admin@a.test", before: { days: { "2026-10-24": 4 } }, after: { from: "2026-10-24", to: "2026-10-24", weekdays: [], total: null, changed_days: 1, days: { "2026-10-24": null } } },
    { action: "update", actor_email: "admin@a.test", before: { days: { "2026-10-24": null, "2026-10-25": 4 } }, after: { source: "import", file_sha256: sha(stock), changed_days: 2, days: { "2026-10-24": 0, "2026-10-25": null } } },
  ]);
  // 价格导入：新增一条、改一条、一条没变
  const sheet = await priceSheet(id);
  const first = sheet.file([FIXED, MILEAGE]);
  await ok(upload(`/products/${id}/price-rules/import?file_sha256=${sha(first)}`, first, { version: await version(id) }));
  const rules = (await prices(id)).items;
  const fixedRule = rules.find((rule: any) => rule.pricing_model === "fixed");
  const mileageRule = rules.find((rule: any) => rule.pricing_model === "mileage_time");
  const second = sheet.file([{ ...FIXED, 价格编号: fixedRule.id, 基础价: num(21000), 状态: "停用" }, { ...MILEAGE, 价格编号: mileageRule.id }, { ...FIXED, 方向: "接机", 车型组: "VG-ECO-4", 生效开始: "2027-01-01" }]);
  const done = await ok(upload(`/products/${id}/price-rules/import?file_sha256=${sha(second)}`, second, { version: await version(id) }));
  assert.deepEqual(done.summary, { rows: 3, create: 1, update: 1, unchanged: 1, error: 0, conflict: 0 });
  const priceLogs = (await api.db.owner.query("select action, resource_id, before, after from audit_logs where resource = 'price_rule' and (resource_id = any($1::text[]) or after->>'product_id' = $2) order by id", [rules.map((rule: any) => rule.id), id])).rows;
  assert.deepEqual(priceLogs.map((log) => log.action), ["create", "create", "update", "create"]);
  const update = priceLogs[2];
  assert.equal(update.resource_id, fixedRule.id);
  assert.deepEqual([update.before.params, update.after.params, update.before.status, update.after.status], [{ basePriceMinor: 20_000 }, { basePriceMinor: 21_000 }, "enabled", "disabled"]);
  const everything = JSON.stringify((await api.db.owner.query("select before, after from audit_logs")).rows);
  assert.doesNotMatch(everything, /markup|sell_price|对外价|加价比例|UEsDB/);
});

test("接口定义对账（逐字段）：九个接口的应答和 openapi.yaml 的 schema 一致——没有文档外的字段，必有的都在，枚举值在列；错误代码和读不了的原因都写在文档里", async () => {
  const text = await readFile(new URL("../openapi.yaml", import.meta.url), "utf8");
  const doc = parse(text) as { paths: Record<string, any>; components: { schemas: Record<string, any>; responses: Record<string, any> } };
  const resolve = (node: any): any => (node && typeof node.$ref === "string" ? resolve(node.$ref.split("/").slice(1).reduce((at: any, key: string) => at[key], doc)) : node);
  /** 按 schema 核对一个值：类型、必有字段、没有多余字段、枚举。 */
  const check = (value: unknown, rawSchema: any, at: string): void => {
    const schema = resolve(rawSchema);
    assert.ok(schema, `${at}：文档里没有定义`);
    if (schema.allOf) {
      const merged = { type: "object", required: [] as string[], properties: {} as Record<string, unknown> };
      for (const part of schema.allOf.map(resolve)) {
        merged.required.push(...(part.required ?? []));
        Object.assign(merged.properties, part.properties ?? {});
      }
      return check(value, merged, at);
    }
    if (schema.oneOf || schema.anyOf) return;
    const types: string[] = Array.isArray(schema.type) ? schema.type : schema.type === undefined ? [] : [schema.type];
    if (value === null) {
      assert.ok(types.includes("null") || schema.nullable === true, `${at}：是 null，文档没说可以为空`);
      return;
    }
    if (schema.enum) assert.ok(schema.enum.includes(value), `${at}：${JSON.stringify(value)} 不在文档的枚举里（${schema.enum.join(" / ")}）`);
    if (Array.isArray(value)) {
      assert.ok(types.includes("array"), `${at}：是数组，文档写的是 ${types.join("|")}`);
      value.forEach((item, index) => check(item, schema.items, `${at}[${index}]`));
    } else if (typeof value === "object") {
      assert.ok(types.includes("object") || types.length === 0, `${at}：是对象，文档写的是 ${types.join("|")}`);
      const properties = schema.properties ?? {};
      for (const key of schema.required ?? []) assert.ok(key in (value as object), `${at}：缺少必有的 ${key}`);
      for (const [key, item] of Object.entries(value as object)) {
        if (key in properties) check(item, properties[key], `${at}.${key}`);
        else assert.ok(schema.additionalProperties !== undefined && schema.additionalProperties !== false, `${at}：应答里的 ${key} 不在文档里`);
        if (!(key in properties) && typeof schema.additionalProperties === "object") check(item, schema.additionalProperties, `${at}.${key}`);
      }
    } else {
      const actual = Number.isInteger(value) ? ["integer", "number"] : [typeof value];
      assert.ok(types.length === 0 || actual.some((type) => types.includes(type)), `${at}：是 ${typeof value}（${JSON.stringify(value)}），文档写的是 ${types.join("|")}`);
    }
  };
  const responseSchema = (path: string, method: string, status: number): any => {
    const operation = doc.paths[path]?.[method];
    assert.ok(operation, `文档里没有 ${method} ${path}`);
    const response = resolve(operation.responses[String(status)]);
    assert.ok(response, `文档里 ${method} ${path} 没有写 ${status}`);
    return response.content?.["application/json"]?.schema;
  };
  const base = "/tenant/v1/products/{id}";
  const id = await product();
  check(await inventory(id, TODAY, "2026-10-09"), responseSchema(`${base}/inventory`, "get", 200), "GET inventory");
  check(await ok(call("PUT", `/products/${id}/inventory`, { version: 1, body: { mode: "limited" } })), responseSchema(`${base}/inventory`, "put", 200), "PUT inventory");
  await api.db.owner.query("select 1");
  const batch = await ok(call("POST", `/products/${id}/inventory/batch-set`, { version: 2, body: { from: TODAY, to: "2026-10-10", weekdays: [3, 4, 5], total: 2 } }));
  check(batch, responseSchema(`${base}/inventory/batch-set`, "post", 200), "POST batch-set");
  await api.db.owner.query("update inventory_days set held = 1, sold = 1 where product_id = $1 and day = $2", [id, TODAY]);
  check(await inventory(id, "2026-10-06", "2026-10-10"), responseSchema(`${base}/inventory`, "get", 200), "GET inventory（各种状态）");
  const occupiedError = await call("POST", `/products/${id}/inventory/batch-set`, { version: 3, body: { from: TODAY, to: TODAY, total: 0 } });
  assert.equal(occupiedError.status, 409);
  assert.ok(doc.paths[`${base}/inventory/batch-set`].post.responses["409"], "批量设置的 409 写在文档里");
  assert.ok(text.includes("INVENTORY_BELOW_OCCUPIED"));
  // 库存导入：各种行
  const stock = stockFile([[TODAY, num(1)], ["2026-10-08", null], ["2026-10-09", num(2)], ["2026-10-11", num(7)], ["bad", num("1.5")], ["2026-10-06", num(1)], ["2029-12-31", num(1)], ["2026-10-11", num(10000)], [null, num(1)]]);
  const stockPreview = await ok(upload(`/products/${id}/inventory/import/preview`, stock));
  check(stockPreview, responseSchema(`${base}/inventory/import/preview`, "post", 200), "库存预览");
  assert.deepEqual([...new Set(stockPreview.rows.map((row: any) => row.action))].sort(), ["clear", "conflict", "error", "set", "unchanged"]);
  const good = stockFile([["2026-10-12", num(1)]]);
  check(await ok(upload(`/products/${id}/inventory/import?file_sha256=${sha(good)}`, good, { version: 3 })), responseSchema(`${base}/inventory/import`, "post", 200), "库存导入");
  // 价格导入：出错的每一种原因都在文档的枚举里
  const sheet = await priceSheet(id);
  const messy = sheet.file([
    FIXED,
    FIXED,
    { ...FIXED, 区域: "没有", 车型组: "没有", 方向: "向上", 计价方式: "免费", 生效开始: "昨天", 状态: "也许" },
    { ...FIXED, 价格编号: randomUUID(), 基础价: "很多", 生效开始: null },
    { ...FIXED, 方向: "接机", 基础价: num("1.5"), 起步价: num(1) },
    { ...MILEAGE, "起步里程(公里)": num("5.55"), "起步时长(分钟)": num("1.5"), 每公里单价: num(0), 生效开始: "2026-10-02", 生效结束: "2026-10-01" },
    { ...FIXED, 计价方式: "包车套餐", 方向: "送机" },
    { ...MILEAGE, 方向: "送机", 生效开始: "2026-10-02", 生效结束: "2026-10-01" },
  ]);
  const pricePreview = await ok(upload(`/products/${id}/price-rules/import/preview`, messy));
  check(pricePreview, responseSchema(`${base}/price-rules/import/preview`, "post", 200), "价格预览");
  const reasons = new Set<string>(pricePreview.rows.flatMap((row: any) => row.issues.map((issue: any) => issue.reason)));
  assert.ok(reasons.size >= 8, [...reasons].join(","));
  const refused = await upload(`/products/${id}/price-rules/import?file_sha256=${sha(messy)}`, messy, { version: 4 });
  check(refused.body, responseSchema(`${base}/price-rules/import`, "post", 409), "价格导入被拒");
  const clean = sheet.file([FIXED, MILEAGE]);
  check(await ok(upload(`/products/${id}/price-rules/import?file_sha256=${sha(clean)}`, clean, { version: 4 })), responseSchema(`${base}/price-rules/import`, "post", 200), "价格导入");
  // 读不了的文件、413、415
  const invalid = await upload(`/products/${id}/price-rules/import/preview`, Buffer.from("not a zip"));
  check(invalid.body, responseSchema(`${base}/price-rules/import/preview`, "post", 400), "读不了的文件");
  for (const code of ["IMPORT_FILE_INVALID", "IMPORT_FILE_CHANGED", "IMPORT_NOT_CLEAN", "VERSION_CONFLICT", "IDEMPOTENCY_KEY_REUSED", "NOT_XLSX", "CORRUPT", "TOO_LARGE", "UNSAFE", "EMPTY", "MISSING_COLUMNS", "TOO_MANY_ROWS", "NO_INVENTORY_AHEAD"]) assert.ok(text.includes(code), `文档里没有提到 ${code}`);
  for (const [path, method] of [[`${base}/price-rules/import/preview`, "post"], [`${base}/price-rules/import`, "post"], [`${base}/inventory/import/preview`, "post"], [`${base}/inventory/import`, "post"]] as const) {
    for (const status of ["400", "404", "413", "415"]) assert.ok(doc.paths[path][method].responses[status], `${method} ${path} 的 ${status} 没写在文档里`);
    const request = doc.paths[path][method].requestBody.content;
    assert.ok(request[XLSX_CONTENT_TYPE] && request["application/octet-stream"], `${path} 的两种上传类型`);
  }
  for (const path of [`${base}/price-rules/export`, `${base}/inventory/export`]) assert.ok(resolve(doc.paths[path].get.responses["200"]).content[XLSX_CONTENT_TYPE], `${path} 的应答类型`);
});
