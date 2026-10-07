/**
 * M1-01 测试角色补充的机场导入测试：文件格式的各种变化、编码不对的文件、试运行、失败回滚、
 * 不覆盖平台维护的字段、两次导入同时进行、导入和后台修改同时进行。
 * 开发角色自己的测试在 masterdata-import-airports.itest.ts；这里不重复那边已经覆盖的主流程。
 *
 * 名字以「【缺陷】」开头的测试是已确认的缺陷的复现：现在会失败，修好之后应当通过。
 * 真的启动命令的入口文件，读测试里现场构造的小样本（编号用 98 开头的大数，和真实数据无关）。不联网。
 */
import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { selectAirports } from "@nozomi/domain";
import { importAirports } from "../services/airport-import.ts";
import { type TestApi, createTestApi } from "../testing/api.ts";
import { leakedSecrets, testEnv } from "../testing/fixtures.ts";
import { exitWithin, startNode } from "../testing/process.ts";

const ENTRY = fileURLToPath(new URL("./masterdata-import-airports.ts", import.meta.url));
const COLUMNS = ["id", "ident", "type", "name", "latitude_deg", "longitude_deg", "elevation_ft", "continent", "iso_country", "iso_region", "municipality", "scheduled_service", "icao_code", "iata_code", "gps_code", "local_code", "home_link", "wikipedia_link", "keywords"] as const;
type Column = (typeof COLUMNS)[number];

interface Row {
  id: number | string;
  iata: string;
  name: string;
  lat: number | string;
  lng: number | string;
  country?: string;
  type?: string;
  scheduled?: string;
}

function cells(row: Row): Record<Column, string> {
  return {
    id: String(row.id), ident: `T${row.id}`, type: row.type ?? "large_airport", name: row.name, latitude_deg: String(row.lat), longitude_deg: String(row.lng),
    elevation_ft: "10", continent: "AS", iso_country: row.country ?? "JP", iso_region: "JP-13", municipality: "Testville", scheduled_service: row.scheduled ?? "yes",
    icao_code: "", iata_code: row.iata, gps_code: "", local_code: "", home_link: "", wikipedia_link: "", keywords: "k1, k2",
  };
}

interface CsvOptions {
  columns?: readonly string[];
  newline?: string;
  bom?: boolean;
  /** 每个字段都加引号（OurAirports 的文件就是这样），还是只在必要时加 */
  quoteAll?: boolean;
}

function csv(rows: Row[], options: CsvOptions = {}): string {
  const columns = options.columns ?? COLUMNS;
  const newline = options.newline ?? "\n";
  const quote = (text: string): string => (options.quoteAll !== false || /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text);
  const lines = [columns.map(quote).join(","), ...rows.map((row) => columns.map((column) => quote((cells(row) as Record<string, string>)[column] ?? "extra")).join(","))];
  return `${options.bom ? "﻿" : ""}${lines.join(newline)}${newline}`;
}

let api: TestApi;
let root: string;
let dir: string;

before(async () => {
  api = await createTestApi();
  root = await api.superAdminToken();
  dir = await mkdtemp(join(tmpdir(), "nozomi-airports-qa-"));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
  await api.close();
});

/**
 * 每个测试结束后把地点清空：各测试从空的地点表开始，互不依赖。
 * 主数据没有删除权限、审计日志不能删，所以这里用迁移账号清地点表；审计日志按「本测试开始之后新增的」来数。
 */
let auditMark = 0;
afterEach(async () => {
  await api.db.owner.query("truncate places cascade");
  auditMark = (await api.db.owner.query("select coalesce(max(id), 0)::int as n from audit_logs")).rows[0].n;
});

let fileSerial = 0;
async function fileWith(content: string | Buffer): Promise<string> {
  fileSerial += 1;
  const path = join(dir, `airports-${fileSerial}.csv`);
  await writeFile(path, content);
  return path;
}

async function run(args: string[]): Promise<{ code: number | null | "timeout"; output: string }> {
  const running = startNode(ENTRY, testEnv(api.db.url), args);
  const code = await exitWithin(running, 30_000);
  if (code === "timeout") running.child.kill("SIGKILL");
  assert.deepEqual(leakedSecrets(running.output()), [], "输出里不能有密钥");
  return { code, output: running.output() };
}

async function stored(): Promise<any[]> {
  const res = await api.db.owner.query(
    "select code, country_code, name, lng::float8 as lng, lat::float8 as lat, status, city_id, source, source_ref, source_overridden, version, updated_at, source_synced_at from places where type = 'airport' order by code",
  );
  return res.rows;
}

async function newAudits(): Promise<any[]> {
  return (await api.db.owner.query("select action, resource, actor_type, actor_id, actor_email, ip, source, tenant_id, before, after from audit_logs where id > $1 order by id", [auditMark])).rows;
}

const ALPHA: Row = { id: 980001, iata: "XAA", name: "QA Alpha Airport", lat: 35.5496781, lng: 139.7869584 };
const BRAVO: Row = { id: 980002, iata: "XBB", name: "QA Bravo Airport", lat: 34.427299, lng: 135.244003, type: "medium_airport" };

// ---------------------------------------------------------------------------------------------------------------------
// 文件格式
// ---------------------------------------------------------------------------------------------------------------------

test("文件格式：BOM、CRLF 换行、列的顺序打乱、多出不认识的列、名称里有逗号 / 引号 / 换行、字段不加引号——导入结果都一样", async () => {
  const tricky: Row = { id: 980003, iata: "XCC", name: 'QA "Charlie" Airport, North\nTerminal Area', lat: -33.946098, lng: 151.177002, country: "AU" };
  const rows = [ALPHA, BRAVO, tricky];
  const shuffled = [...COLUMNS].reverse();
  const variants: [string, string][] = [
    ["原样", csv(rows)],
    ["带 BOM", csv(rows, { bom: true })],
    ["CRLF 换行", csv(rows, { newline: "\r\n" })],
    ["BOM + CRLF + 列倒序", csv(rows, { bom: true, newline: "\r\n", columns: shuffled })],
    ["多出不认识的列", csv(rows, { columns: ["new_column_a", ...COLUMNS, "new_column_b"] })],
    ["只在必要时加引号", csv(rows, { quoteAll: false })],
    ["只有用得到的 8 列", csv(rows, { columns: ["iata_code", "scheduled_service", "iso_country", "longitude_deg", "latitude_deg", "name", "type", "id"] })],
    ["末尾没有换行", csv(rows).trimEnd()],
    ["末尾多几个空行", `${csv(rows)}\n\n\n`],
  ];
  let expected: any[] | null = null;
  for (const [what, content] of variants) {
    const result = await run(["--all-countries", "--file", await fileWith(content)]);
    assert.equal(result.code, 0, `${what}：${result.output}`);
    assert.match(result.output, /新增 3 个/, what);
    const rowsNow = (await stored()).map((row) => [row.code, row.country_code, row.name, row.lng, row.lat, row.status, row.city_id, row.source, row.source_ref]);
    assert.deepEqual(rowsNow, [
      ["XAA", "JP", { en: "QA Alpha Airport" }, 139.786958, 35.549678, "disabled", null, "ourairports", "980001"],
      ["XBB", "JP", { en: "QA Bravo Airport" }, 135.244003, 34.427299, "disabled", null, "ourairports", "980002"],
      ["XCC", "AU", { en: 'QA "Charlie" Airport, North\nTerminal Area' }, 151.177002, -33.946098, "disabled", null, "ourairports", "980003"],
    ], what);
    expected ??= rowsNow;
    assert.deepEqual(rowsNow, expected);
    await api.db.owner.query("truncate places cascade");
  }
});

test("文件格式：只有表头（0 个机场）正常结束；空文件、缺列、引号没闭合、UTF-16、二进制——都不导入，退出码 1，说明原因；只有 CR 换行的文件什么都导不进去", async () => {
  const headerOnly = await run(["--country", "JP", "--file", await fileWith(csv([]))]);
  assert.equal(headerOnly.code, 0, headerOnly.output);
  assert.match(headerOnly.output, /共 0 条记录/);
  assert.match(headerOnly.output, /新增 0 个/);

  const good = csv([ALPHA, BRAVO]);
  const broken: [string, string | Buffer, RegExp][] = [
    ["空文件", "", /没有导入：文件是空的/],
    ["只有 BOM", "﻿", /没有导入：文件是空的/],
    ["只有空行", "\n\n\n", /没有导入：/],
    ["缺 iata_code 列", csv([ALPHA], { columns: COLUMNS.filter((column) => column !== "iata_code") }), /缺少列 iata_code/],
    ["缺坐标两列", csv([ALPHA], { columns: COLUMNS.filter((column) => !column.endsWith("_deg")) }), /缺少列 latitude_deg、longitude_deg/],
    ["表头大小写不对", good.replace('"iata_code"', '"IATA_CODE"'), /缺少列 iata_code/],
    ["没有表头，第一行就是数据", good.split("\n").slice(1).join("\n"), /缺少列/],
    ["引号没闭合", `${good}980009,"X980009","large_airport","QA Broken Airport,35,139\n`, /双引号没有闭合/],
    ["分号分隔", good.replaceAll('","', '";"'), /缺少列/],
    ["UTF-16 编码", Buffer.from(`﻿${good}`, "utf16le"), /没有导入：/],
    ["不是文本（二进制）", Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0xff, 0xfe, 0x22, 0x0a]), /没有导入：/],
  ];
  for (const [what, content, expected] of broken) {
    const result = await run(["--country", "JP", "--file", await fileWith(content)]);
    assert.equal(result.code, 1, `${what}：${result.output}`);
    assert.match(result.output, expected, what);
    assert.doesNotMatch(result.output, /\n\s+at .+:\d+:\d+/, `${what}：不应把程序的调用栈打给用户`);
  }
  // 老式 Mac 换行（只有 CR）：整份文件被当成一行表头，结果是「0 条记录」——不报错，但也什么都不会导入
  const crOnly = await run(["--country", "JP", "--file", await fileWith(good.replaceAll("\n", "\r"))]);
  assert.match(crOnly.output, /共 0 条记录|没有导入：/);
  assert.deepEqual(await stored(), []);
  assert.deepEqual(await newAudits(), []);
});

test("文件内容：缺字段的短行、超长名称、越界 / 缺失 / (0,0) 坐标、小写三字码、重复的三字码、重复的编号——逐条跳过并说明，其余照常导入", async () => {
  const rows: Row[] = [
    ALPHA,
    { id: 980010, iata: "XAA", name: "QA Duplicate Code Airport", lat: 36, lng: 140 },
    { id: 980001, iata: "XDD", name: "QA Duplicate Id Airport", lat: 36, lng: 140 },
    { id: 980011, iata: "XEE", name: "N".repeat(201), lat: 36, lng: 140 },
    { id: 980012, iata: "XFF", name: "N".repeat(200), lat: 36, lng: 140 },
    { id: 980013, iata: "XGG", name: "QA Out Of Range Airport", lat: 90.000001, lng: 140 },
    { id: 980014, iata: "XHH", name: "QA Edge Airport", lat: -90, lng: -180 },
    { id: 980015, iata: "XII", name: "QA Null Island Airport", lat: 0, lng: 0 },
    { id: 980016, iata: "XJJ", name: "QA Equator Airport", lat: 0, lng: 100.123456789 },
    { id: 980017, iata: "xkk", name: "QA Lowercase Airport", lat: 36, lng: 140 },
    { id: 980018, iata: "XLL", name: "QA No Latitude Airport", lat: "", lng: 140 },
    { id: 980019, iata: "XMM", name: "QA Text Latitude Airport", lat: "north", lng: 140 },
    { id: 980020, iata: "XNN", name: "   ", lat: 36, lng: 140 },
    { id: "98-0021", iata: "XOO", name: "QA Bad Id Airport", lat: 36, lng: 140 },
    { id: 980022, iata: "XPP", name: "QA Bad Country Airport", lat: 36, lng: 140, country: "ZZ" },
    { id: 980023, iata: "XQQ", name: "QA Closed Airport", lat: 36, lng: 140, type: "closed" },
    { id: 980024, iata: "XRR", name: "QA Seaplane Base", lat: 36, lng: 140, type: "seaplane_base" },
    { id: 980025, iata: "XSS", name: "QA Capital Yes Airport", lat: 36, lng: 140, scheduled: "YES" },
  ];
  const content = `${csv(rows)}980026,"T980026","large_airport"\n"980027"\n,,,,,,,,,,,,,,,,,,\n`;
  const result = await run(["--all-countries", "--file", await fileWith(content)]);
  assert.equal(result.code, 0, result.output);
  assert.deepEqual((await stored()).map((row) => [row.code, row.lng, row.lat, row.name.en.length]), [
    ["XAA", 139.786958, 35.549678, 16],
    ["XFF", 140, 36, 200],
    ["XHH", -180, -90, 15],
    ["XJJ", 100.123457, 0, 18],
  ]);
  for (const reason of [
    /XAA：IATA 三字码 XAA 在文件里重复出现，只取第一条/, /XDD：数据源编号在文件里重复出现/, /XEE：名称为空或超过 200 个字符/, /XGG：坐标缺失或超出范围/, /XII：坐标是 \(0, 0\)/,
    /xkk：IATA 三字码 xkk 格式不对/, /XLL：坐标缺失或超出范围/, /XMM：坐标缺失或超出范围/, /XNN：名称为空或超过 200 个字符/, /XOO：数据源编号不是数字/, /XPP：国家码 ZZ 不是合法的/,
  ]) {
    assert.match(result.output, reason);
  }
  assert.match(result.output, /跳过 11 条不合格的记录/);
  assert.equal((await newAudits()).length, 4, "导入了几个机场就是几条审计日志");
});

test("【缺陷】文件不是 UTF-8 编码（比如另存成了 Latin-1）：机场名里的重音字母变成乱码「�」照样导入，没有任何提示", async () => {
  // 复现：把一份 airports.csv 用 Latin-1（ISO-8859-1）保存，其中有个机场叫「Aéroport de Québec」，然后 --file 导入。
  // 期望：命令认出文件不是 UTF-8，不导入并说明原因（或至少跳过乱码的记录并提示）；库里不能出现替换字符 U+FFFD。
  // 实际：退出码 0、「导入完成」，库里的英文名是「A�roport de Qu�bec」，输出里没有任何警告。
  const content = Buffer.from(csv([ALPHA, { id: 980030, iata: "XQB", name: "Aéroport de Québec", lat: 46.7911, lng: -71.393303, country: "CA" }]), "latin1");
  const result = await run(["--all-countries", "--file", await fileWith(content)]);
  const names = (await stored()).map((row) => row.name.en as string);
  assert.deepEqual(names.filter((name) => name.includes("�")), [], `库里出现了乱码的机场名；命令的退出码 ${result.code}，输出：\n${result.output}`);
});

test("文件内容带 NUL 字符的记录：整次导入失败并回滚——前面已经处理的机场和审计日志都没有留下", async () => {
  // 数据库存不了 NUL。这里要验证的是「整次导入在一个事务里，失败则什么都不变」。
  const result = await run(["--country", "JP", "--file", await fileWith(csv([ALPHA, BRAVO, { id: 980040, iata: "XNU", name: "QA Nul\u0000 Airport", lat: 36, lng: 140 }]))]);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /没有导入：/);
  assert.match(result.output, /数据库没有任何变化/);
  assert.deepEqual(await stored(), []);
  assert.deepEqual(await newAudits(), [], "失败回滚后不留审计日志");
  // 去掉坏记录再来：正常导入，结果和从没失败过一样
  const retry = await run(["--country", "JP", "--file", await fileWith(csv([ALPHA, BRAVO]))]);
  assert.equal(retry.code, 0, retry.output);
  assert.deepEqual((await stored()).map((row) => [row.code, row.version]), [["XAA", 1], ["XBB", 1]]);
  assert.equal((await newAudits()).length, 2);
});

// ---------------------------------------------------------------------------------------------------------------------
// 试运行、重复执行、审计
// ---------------------------------------------------------------------------------------------------------------------

test("试运行：库里已有导入的机场、数据源又有变化时，--dry-run 报告将要新增和更新什么，但一个字节都不写（包括核对时间）", async () => {
  assert.equal((await run(["--country", "JP", "--file", await fileWith(csv([ALPHA, BRAVO]))])).code, 0);
  const before = await stored();
  const auditsBefore = (await newAudits()).length;
  const changed = await fileWith(csv([{ ...ALPHA, name: "QA Alpha Renamed Airport", lat: 35.6 }, BRAVO, { id: 980050, iata: "XNW", name: "QA New Airport", lat: 36, lng: 140 }]));
  for (const args of [["--country", "JP", "--file", changed, "--dry-run"], ["--dry-run", "--file", changed, "--all-countries"]]) {
    const result = await run(args);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /试运行：下面是将要做的改动，数据库没有任何变化/);
    assert.doesNotMatch(result.output, /导入完成/);
    assert.match(result.output, /新增 1 个/);
    assert.match(result.output, /更新 1 个；没有变化 1 个/);
    assert.deepEqual(await stored(), before, "试运行之后库里的每个字段（含版本、更新时间、核对时间）都没变");
    assert.equal((await newAudits()).length, auditsBefore);
  }
  // 试运行说的和真导入做的一致
  const real = await run(["--country", "JP", "--file", changed]);
  assert.match(real.output, /导入完成/);
  assert.match(real.output, /新增 1 个/);
  assert.match(real.output, /更新 1 个；没有变化 1 个/);
  assert.deepEqual((await stored()).map((row) => [row.code, row.name.en, row.lat, row.version]), [
    ["XAA", "QA Alpha Renamed Airport", 35.6, 2],
    ["XBB", "QA Bravo Airport", 34.427299, 1],
    ["XNW", "QA New Airport", 36, 1],
  ]);
});

test("重复执行：同一份文件连着导入三次，第二、三次零改动——版本、更新时间、审计日志都不变，只有「核对时间」往后走", async () => {
  const file = await fileWith(csv([ALPHA, BRAVO, { ...ALPHA, id: 980060, iata: "XKR", country: "KR", name: "QA Korea Airport" }]));
  const first = await run(["--country", "jp, kr", "--file", file]);
  assert.equal(first.code, 0, first.output);
  assert.match(first.output, /范围：JP、KR/, "国家码大小写、空格都能认");
  const afterFirst = await stored();
  const audits = await newAudits();
  assert.equal(audits.length, 3);
  for (const audit of audits) {
    assert.deepEqual(
      [audit.action, audit.resource, audit.actor_type, audit.actor_id, audit.actor_email, audit.ip, audit.source, audit.tenant_id, audit.before, audit.after.source, audit.after.status],
      ["create", "place", "system", null, null, null, "cli", null, null, "ourairports", "disabled"],
    );
  }
  for (const round of [2, 3]) {
    const again = await run(["--country", "JP,KR", "--file", file]);
    assert.equal(again.code, 0, again.output);
    assert.match(again.output, /新增 0 个/, `第 ${round} 次`);
    assert.match(again.output, /更新 0 个；没有变化 3 个；平台改过、没有覆盖 0 个/);
    const now = await stored();
    const strip = (rows: any[]): any[] => rows.map(({ source_synced_at: _synced, ...rest }) => rest);
    assert.deepEqual(strip(now), strip(afterFirst), `第 ${round} 次导入没有改动任何内容`);
    for (const [index, row] of now.entries()) assert.ok(row.source_synced_at >= afterFirst[index].source_synced_at);
    assert.equal((await newAudits()).length, 3, "没有新的审计日志");
  }
});

test("不覆盖平台维护的内容：平台指定了城市、启用、补了其他语言的名称和国际国内属性、建了航站楼之后，数据源变了再导入——只更新英文名和坐标，其余原样", async () => {
  assert.equal((await run(["--country", "JP", "--file", await fileWith(csv([ALPHA, BRAVO]))])).code, 0);
  const call = (method: "POST" | "PATCH" | "GET", path: string, body?: unknown, version?: number) =>
    api.call(method, `/platform/v1/master/${path}`, { token: root, ...(body === undefined ? {} : { body }), ...(version === undefined ? {} : { headers: { "if-match": `"${version}"` } }) });
  const city = await call("POST", "cities", { code: `CTY-JP-I${fileSerial}`, country_code: "JP", name: { zh: "测试市" }, timezone: "Asia/Tokyo", center: { lng: 139.7, lat: 35.6 } });
  assert.equal(city.status, 201, city.text);
  const alpha = (await call("GET", "places?code=XAA")).body.items[0];
  const edited = await call("PATCH", `places/${alpha.id}`, { city_id: city.body.id, name: { en: alpha.name.en, ja: "QAアルファ空港", zh: "测试甲机场" }, flight_scope: "international" }, alpha.version);
  assert.equal(edited.status, 200, edited.text);
  assert.equal(edited.body.source.overridden, false, "没有动英文名和坐标，不算「平台改过」");
  assert.equal((await call("POST", `places/${alpha.id}/enable`)).status, 200);
  const terminal = await call("POST", "places", { type: "terminal", code: "XAA-T1", parent_id: alpha.id, name: { zh: "T1" }, location: { lng: 139.78, lat: 35.55 } });
  assert.equal(terminal.status, 201, terminal.text);
  // 平台纠正了 XBB 的英文名
  const bravo = (await call("GET", "places?code=XBB")).body.items[0];
  const renamed = await call("PATCH", `places/${bravo.id}`, { name: { en: "QA Bravo (corrected)" } }, bravo.version);
  assert.equal(renamed.body.source.overridden, true);

  const updated = await run(["--country", "JP", "--file", await fileWith(csv([{ ...ALPHA, name: "QA Alpha Intl Airport", lat: 35.553333, lng: 139.781111 }, { ...BRAVO, lat: 34.5 }]))]);
  assert.equal(updated.code, 0, updated.output);
  assert.match(updated.output, /更新 1 个；没有变化 0 个；平台改过、没有覆盖 1 个/);
  assert.match(updated.output, /平台改过的：XBB/);

  const alphaNow = (await call("GET", `places/${alpha.id}`)).body;
  assert.deepEqual(
    [alphaNow.name, alphaNow.location, alphaNow.city_id, alphaNow.status, alphaNow.flight_scope, alphaNow.source.overridden],
    [{ en: "QA Alpha Intl Airport", ja: "QAアルファ空港", zh: "测试甲机场" }, { lng: 139.781111, lat: 35.553333 }, city.body.id, "active", "international", false],
  );
  const terminalNow = (await call("GET", `places/${terminal.body.id}`)).body;
  assert.deepEqual(terminalNow, terminal.body, "航站楼完全没动");
  const bravoNow = (await call("GET", `places/${bravo.id}`)).body;
  assert.deepEqual([bravoNow.name, bravoNow.location, bravoNow.version], [{ en: "QA Bravo (corrected)" }, { lng: 135.244003, lat: 34.427299 }, renamed.body.version]);
  // 导入的更新带了版本：后台拿着导入之前的版本号来改，要 409 而不是把导入的结果盖掉
  const stale = await call("PATCH", `places/${alpha.id}`, { name: { en: "stale" } }, alpha.version + 2);
  assert.equal(stale.status, 409, stale.text);
  assert.equal(stale.body.error.details.current_version, alphaNow.version);
});

// ---------------------------------------------------------------------------------------------------------------------
// 并发
// ---------------------------------------------------------------------------------------------------------------------

test("并发：同一份文件的两次导入同时运行——不会导入重复的机场，每个机场恰好一条审计日志；没成功的那次干净地失败", async () => {
  const rows: Row[] = Array.from({ length: 40 }, (_, index) => ({
    id: 981000 + index,
    iata: `Y${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + (index % 26))}`,
    name: `QA Concurrent Airport ${index}`,
    lat: 30 + index / 100,
    lng: 130 + index / 100,
  }));
  const file = await fileWith(csv(rows));
  const results = await Promise.all([run(["--country", "JP", "--file", file]), run(["--country", "JP", "--file", file])]);
  const codes = results.map((result) => result.code);
  assert.ok(codes.includes(0), `至少一次成功：${results.map((result) => result.output).join("\n---\n")}`);
  for (const result of results) {
    assert.ok(result.code === 0 || result.code === 1, String(result.code));
    if (result.code === 1) {
      assert.match(result.output, /没有导入：/);
      assert.doesNotMatch(result.output, /\n\s+at .+:\d+:\d+/, "不应把程序的调用栈打给用户");
    }
  }
  const airports = await stored();
  assert.equal(airports.length, 40, "没有重复、没有遗漏");
  assert.equal(new Set(airports.map((row) => row.source_ref)).size, 40);
  assert.ok(airports.every((row) => row.version === 1));
  const audits = await newAudits();
  assert.equal(audits.length, 40, "每个机场恰好一条审计日志");
  assert.equal(new Set(audits.map((audit) => audit.after.code)).size, 40);
  // 再来一次：稳定
  const again = await run(["--country", "JP", "--file", file]);
  assert.match(again.output, /新增 0 个/);
  assert.match(again.output, /没有变化 40 个/);
});

test("【缺陷】并发：导入运行期间平台在后台改了同一个机场的坐标和名称，导入把这次人工修改覆盖掉了", async () => {
  // 复现：
  //   1. 机场 XAA 已经导入过。数据源更新了它的英文名和纬度。
  //   2. 导入开始运行：读出库里的机场、算好「要把 XAA 更新成数据源的值」。
  //   3. 就在这时平台在后台把 XAA 的纬度纠正为 36.123456、补了日文名（另一个事务，先于导入提交；它把「平台改过」标成了 true）。
  //   4. 导入继续，写入第 2 步算好的值。
  // 期望：人工修改不丢——导入发现这条记录在自己读完之后被改过，就不再覆盖它（或整次导入失败回滚、提示重试）。
  // 实际：导入用旧的快照覆盖：纬度变回数据源的 35.6，日文名消失；「平台改过」仍是 true，以后也没人知道被盖过。
  //       原因：导入读机场时没有加锁，写的时候也不核对版本号。
  // 这里用一个没提交的事务占住那一行，把第 3 步稳定地卡在第 2 步和第 4 步之间。
  const source = (name: string, lat: number): ReturnType<typeof selectAirports> => selectAirports(csv([{ ...ALPHA, name, lat }]), ["JP"]);
  await importAirports(api.db.pool, source("QA Alpha Airport", 35.5), new Date(), { dryRun: false });
  const { id } = (await api.db.owner.query("select id from places where code = 'XAA'")).rows[0];

  const platform = await api.db.owner.connect();
  let importing: Promise<unknown>;
  try {
    await platform.query("begin");
    await platform.query(
      `update places set lat = 36.123456, name = name || '{"ja": "人工补的日文名"}'::jsonb, source_overridden = true, version = version + 1, updated_at = now() where id = $1`,
      [id],
    );
    importing = importAirports(api.db.pool, source("QA Alpha Renamed Airport", 35.6), new Date(), { dryRun: false });
    // 等导入的写语句排到这一行的锁后面
    for (let waited = 0; waited < 5_000; waited += 50) {
      const blocked = await api.db.owner.query("select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query ilike 'update places%'");
      if (blocked.rows[0].n > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await platform.query("commit");
  } finally {
    platform.release();
  }
  await importing.catch(() => undefined);
  const row = (await api.db.owner.query("select name, lat::float8 as lat, source_overridden from places where id = $1", [id])).rows[0];
  assert.deepEqual(
    { lat: row.lat, ja: row.name.ja ?? null, source_overridden: row.source_overridden },
    { lat: 36.123456, ja: "人工补的日文名", source_overridden: true },
    "平台在导入运行期间提交的人工修改被导入覆盖了",
  );
});
