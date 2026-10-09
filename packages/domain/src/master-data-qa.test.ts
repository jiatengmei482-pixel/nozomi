/**
 * M1-01 测试角色补充的单元测试：CSV 解析、机场数据的挑选和导入计划、主数据规则的边界。
 * 开发角色自己的测试在 csv.test.ts、ourairports.test.ts、master-data.test.ts；这里不重复那边已经覆盖的内容。
 * 名字以「【缺陷】」开头的测试是已确认的缺陷的复现：现在会失败，修好之后应当通过。
 * 样本都是为测试编的（编号用 97 开头的大数），和真实数据无关。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CsvError, parseCsv } from "./csv.ts";
import {
  MAX_BOUNDARY_POINTS,
  boundaryIssues,
  cityCodeIssue,
  isCountryCode,
  isIanaTimeZone,
  isIataCode,
  isLatitude,
  isLongitude,
  placeCodeIssue,
  roundCoordinate,
  vehicleComboIssues,
  vehicleGroupCodeIssue,
} from "./master-data.ts";
import { type AirportSelection, type ExistingAirport, planAirportImport, selectAirports } from "./ourairports.ts";

// ---------------------------------------------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------------------------------------------

test("CSV：引号里的逗号、LF、CRLF、连续两个引号、首尾空格都原样保留；引号外的空格也保留", () => {
  const text = 'a,b,c\r\n"x,1","line1\nline2","he said ""hi"""\r\n"cr\r\nlf", plain ,"  padded  "\r\n';
  assert.deepEqual(parseCsv(text), [
    ["a", "b", "c"],
    ["x,1", "line1\nline2", 'he said "hi"'],
    ["cr\r\nlf", " plain ", "  padded  "],
  ]);
});

test("CSV：空字段、空的引号字段、只有逗号的行、行与行字段数不同——都按原样给出，不补齐、不丢弃", () => {
  assert.deepEqual(parseCsv('a,,c\n"",""\n,,\nonly\n1,2,3,4,5\n'), [["a", "", "c"], ["", ""], ["", "", ""], ["only"], ["1", "2", "3", "4", "5"]]);
  assert.deepEqual(parseCsv('""'), [[""]], "只有一个空的引号字段也是一行");
  assert.deepEqual(parseCsv(","), [["", ""]]);
  assert.deepEqual(parseCsv("a\n\nb\n"), [["a"], [""], ["b"]], "中间的空行是一条只有一个空字段的记录");
});

test("CSV：BOM 只去掉文件开头的那一个；换行混用（LF 和 CRLF）都认；末尾有没有换行结果一样", () => {
  assert.deepEqual(parseCsv("﻿id,name\n1,a"), [["id", "name"], ["1", "a"]]);
  assert.deepEqual(parseCsv('﻿"id","name"\r\n"1","a"\r\n'), [["id", "name"], ["1", "a"]]);
  assert.deepEqual(parseCsv("﻿﻿id\n"), [["﻿id"]], "第二个 BOM 是内容");
  assert.deepEqual(parseCsv("id\n1,﻿a\n"), [["id"], ["1", "﻿a"]]);
  assert.deepEqual(parseCsv("a,b\r\nc,d\ne,f\r\n"), [["a", "b"], ["c", "d"], ["e", "f"]]);
  assert.deepEqual(parseCsv("a,b\nc,d"), parseCsv("a,b\nc,d\n"));
  assert.deepEqual(parseCsv("a,b\r\nc,d"), parseCsv("a,b\r\nc,d\r\n"));
  assert.deepEqual(parseCsv(""), []);
  assert.deepEqual(parseCsv("﻿"), []);
});

test("CSV：引号没闭合一律报错（哪怕在最后一个字段、哪怕后面还有很多行），不会把后面的内容吞进一个字段", () => {
  for (const text of ['"', 'a,"b', 'a,b\n"c,d\ne,f\ng,h\n', 'a,"b""', '"a""', 'a,b\n1,"x\n'.repeat(3)]) {
    assert.throws(() => parseCsv(text), (err: unknown) => err instanceof CsvError && /没有闭合/.test(err.message), JSON.stringify(text));
  }
  assert.deepEqual(parseCsv('a,"b"""\n'), [["a", 'b"']]);
});

test("CSV：超长的字段、超长的行、十万行的文件都能解析，耗时在合理范围内", () => {
  const long = "x".repeat(1_000_000);
  assert.deepEqual(parseCsv(`id,name\n1,"${long}"\n`)[1], ["1", long]);
  const wide = Array.from({ length: 20_000 }, (_, index) => `c${index}`);
  assert.deepEqual(parseCsv(`${wide.join(",")}\n`)[0], wide);
  const line = '900001,"T900001","large_airport","Some Airport, With Comma",35.5,139.5,10,"AS","JP","JP-13","Testville","yes","RJTT","TST","RJTT","","https://example.invalid/","https://example.invalid/wiki","k1, k2"\n';
  const started = Date.now();
  const rows = parseCsv(line.repeat(100_000));
  assert.equal(rows.length, 100_000);
  assert.equal(rows[99_999]?.[3], "Some Airport, With Comma");
  assert.ok(Date.now() - started < 20_000, `解析十万行用了 ${Date.now() - started} 毫秒`);
});

// ---------------------------------------------------------------------------------------------------------------------
// 挑选机场
// ---------------------------------------------------------------------------------------------------------------------

const COLUMNS = ["id", "type", "name", "latitude_deg", "longitude_deg", "iso_country", "scheduled_service", "iata_code"];

interface Row {
  id?: string;
  type?: string;
  name?: string;
  latitude_deg?: string;
  longitude_deg?: string;
  iso_country?: string;
  scheduled_service?: string;
  iata_code?: string;
}

function file(rows: Row[], columns: readonly string[] = COLUMNS): string {
  const defaults: Required<Row> = { id: "970001", type: "large_airport", name: "QA Airport", latitude_deg: "35.5", longitude_deg: "139.5", iso_country: "JP", scheduled_service: "yes", iata_code: "QAA" };
  const lines = rows.map((row) => columns.map((column) => `"${((({ ...defaults, ...row }) as Record<string, string>)[column] ?? "other").replaceAll('"', '""')}"`).join(","));
  return `${[columns.join(","), ...lines].join("\n")}\n`;
}

test("挑选机场：列的顺序变了、多了别的列、同名的列出现两次——按列名取值，结果不变", () => {
  const rows: Row[] = [{ id: "970001", iata_code: "QAA" }, { id: "970002", iata_code: "QAB", iso_country: "KR", name: "QA Korea" }];
  const expected = selectAirports(file(rows), null);
  assert.deepEqual(expected.airports.map((airport) => [airport.sourceRef, airport.iata, airport.countryCode, airport.name, airport.lng, airport.lat]), [
    ["970001", "QAA", "JP", "QA Airport", 139.5, 35.5],
    ["970002", "QAB", "KR", "QA Korea", 139.5, 35.5],
  ]);
  assert.deepEqual(selectAirports(file(rows, [...COLUMNS].reverse()), null), expected);
  assert.deepEqual(selectAirports(file(rows, ["ident", ...COLUMNS.slice(0, 4), "elevation_ft", ...COLUMNS.slice(4), "keywords"]), null), expected);
  assert.deepEqual(selectAirports(`﻿${file(rows).replaceAll("\n", "\r\n")}`, null), expected);
});

test("挑选机场：必需的 8 列少了任何一列都报错并指出是哪一列；只有表头是 0 个机场；空文件报错", () => {
  for (const missing of COLUMNS) {
    assert.throws(
      () => selectAirports(file([{}], COLUMNS.filter((column) => column !== missing)), null),
      (err: unknown) => err instanceof CsvError && err.message.includes(`缺少列 ${missing}`),
      missing,
    );
  }
  const headerOnly = selectAirports(`${COLUMNS.join(",")}\n`, null);
  assert.deepEqual([headerOnly.totalRows, headerOnly.airports, headerOnly.skipped, headerOnly.outOfScopeRefs], [0, [], [], []]);
  for (const empty of ["", "﻿"]) assert.throws(() => selectAirports(empty, null), CsvError);
  assert.throws(() => selectAirports(`${COLUMNS.map((column) => column.toUpperCase()).join(",")}\n`, null), CsvError, "列名区分大小写");
});

test("挑选机场：国家筛选——空名单一个都不挑；只按国家码精确匹配；筛掉的国家里不合格的记录不报告", () => {
  const text = file([
    { id: "970001", iata_code: "QAA", iso_country: "JP" },
    { id: "970002", iata_code: "QAB", iso_country: "KR" },
    { id: "970003", iata_code: "qac", iso_country: "US" },
    { id: "970004", iata_code: "QAD", iso_country: "jp" },
    { id: "970005", iata_code: "QAE", iso_country: " JP " },
  ]);
  assert.deepEqual(selectAirports(text, []).airports, []);
  assert.deepEqual(selectAirports(text, ["JP"]).airports.map((airport) => airport.iata), ["QAA", "QAE"], "国家码两边的空格会去掉，小写的不算");
  assert.deepEqual(selectAirports(text, ["JP"]).skipped, []);
  assert.deepEqual(selectAirports(text, ["KR", "JP"]).airports.map((airport) => airport.iata), ["QAA", "QAB", "QAE"]);
  const all = selectAirports(text, null);
  assert.deepEqual(all.skipped.map((row) => [row.row, row.label]), [[4, "qac"], [5, "QAD"]], "不限国家时，不合格的逐条报告，行号从表头算第 1 条");
});

test("挑选机场：坐标——边界值、6 位小数取整、科学计数法可以；缺失、文字、越界、NaN、无穷大、小数逗号、(0,0) 跳过", () => {
  const accepted: [string, string, number, number][] = [
    ["90", "180", 90, 180],
    ["-90", "-180", -90, -180],
    ["35.5496781", "139.7869584", 35.549678, 139.786958],
    ["35.5496785", "-139.7869585", 35.549679, -139.786958],
    ["0", "100", 0, 100],
    ["12", "0", 12, 0],
    [" 35.5 ", " 139.5 ", 35.5, 139.5],
    ["3.55e1", "1.395e2", 35.5, 139.5],
    ["+35.5", "+139.5", 35.5, 139.5],
    ["-0.0000001", "100", 0, 100],
  ];
  for (const [lat, lng, expectedLat, expectedLng] of accepted) {
    const { airports, skipped } = selectAirports(file([{ latitude_deg: lat, longitude_deg: lng }]), null);
    assert.deepEqual(skipped, [], `${lat}, ${lng}`);
    assert.equal(airports[0]?.lat === 0 ? 0 : airports[0]?.lat, expectedLat, `${lat}`);
    assert.equal(airports[0]?.lng, expectedLng, `${lng}`);
  }
  for (const [lat, lng] of [
    ["", "139.5"], ["35.5", ""], ["", ""], ["north", "139.5"], ["35.5", "east"], ["90.0000001", "0"], ["-90.5", "0"], ["0", "180.0000001"], ["0", "-181"],
    ["NaN", "139.5"], ["Infinity", "139.5"], ["35.5", "-Infinity"], ["35,5", "139,5"], ["35.5N", "139.5E"], ["35°30'", "139°30'"], ["0", "0"], ["0.0", "-0.0"], ["1e400", "1"],
  ] as const) {
    const { airports, skipped } = selectAirports(file([{ latitude_deg: lat, longitude_deg: lng }]), null);
    assert.deepEqual(airports, [], `${JSON.stringify(lat)}, ${JSON.stringify(lng)} 不该被导入`);
    assert.equal(skipped.length, 1);
    assert.match(skipped[0]?.reason ?? "", /坐标/);
  }
});

test("【缺陷】挑选机场：坐标写成十六进制 / 二进制 / 八进制（0x23、0b11、0o17）时被当成数字导入，应当按「坐标不合格」跳过", () => {
  // 复现：airports.csv 里某一行 latitude_deg = "0x23"、longitude_deg = "0b1100100"。
  // 期望：这不是十进制的经纬度，跳过并报告「坐标缺失或超出范围」。
  // 实际：被 Number() 解析成 35 和 100，机场以 (100, 35) 这个凭空出现的坐标导入。
  for (const [lat, lng] of [["0x23", "139.5"], ["35.5", "0x8B"], ["0b100011", "0b1100100"], ["0o43", "0o144"]] as const) {
    const { airports, skipped } = selectAirports(file([{ latitude_deg: lat, longitude_deg: lng }]), null);
    assert.deepEqual(airports.map((airport) => [airport.lat, airport.lng]), [], `${lat}, ${lng} 不是十进制坐标，不该被导入`);
    assert.equal(skipped.length, 1);
  }
});

test("挑选机场：范围——只有「大型 / 中型 + 有定期航班」；类型和 yes 都要逐字一致；不在范围内的记录只记编号，不合格也不报告", () => {
  const rows: Row[] = [
    { id: "970001", iata_code: "QAA", type: "large_airport" },
    { id: "970002", iata_code: "QAB", type: "medium_airport" },
    { id: "970003", iata_code: "QAC", type: "small_airport" },
    { id: "970004", iata_code: "QAD", type: "heliport" },
    { id: "970005", iata_code: "QAE", type: "seaplane_base" },
    { id: "970006", iata_code: "QAF", type: "balloonport" },
    { id: "970007", iata_code: "QAG", type: "closed" },
    { id: "970008", iata_code: "QAH", type: "Large_Airport" },
    { id: "970009", iata_code: "QAI", type: "" },
    { id: "970010", iata_code: "QAJ", scheduled_service: "no" },
    { id: "970011", iata_code: "QAK", scheduled_service: "" },
    { id: "970012", iata_code: "QAL", scheduled_service: "YES" },
    { id: "970013", iata_code: "QAM", scheduled_service: "1" },
    { id: "abc", iata_code: "", type: "closed", latitude_deg: "", name: "" },
  ];
  const selection = selectAirports(file(rows), null);
  assert.deepEqual(selection.airports.map((airport) => airport.iata), ["QAA", "QAB"]);
  assert.deepEqual(selection.skipped, []);
  assert.deepEqual(selection.outOfScopeRefs, ["970003", "970004", "970005", "970006", "970007", "970008", "970009", "970010", "970011", "970012", "970013"]);
  assert.equal(selection.totalRows, 14);
});

test("挑选机场：三字码重复只取第一条，后面的逐条报告；被跳过的记录不占用三字码；名称首尾空格去掉、内部换行保留", () => {
  const selection = selectAirports(
    file([
      { id: "970001", iata_code: "QAA", latitude_deg: "95" },
      { id: "970002", iata_code: "QAA", name: "  Second  " },
      { id: "970003", iata_code: "QAA", name: "Third" },
      { id: "970002", iata_code: "QAB", name: "Same Id Again" },
      { id: "970004", iata_code: " QAC ", name: "Line1\nLine2" },
    ]),
    null,
  );
  assert.deepEqual(selection.airports.map((airport) => [airport.sourceRef, airport.iata, airport.name]), [["970002", "QAA", "Second"], ["970004", "QAC", "Line1\nLine2"]]);
  assert.deepEqual(selection.skipped.map((row) => row.row), [2, 4, 5]);
  assert.match(selection.skipped[0]?.reason ?? "", /^坐标缺失或超出范围/);
  assert.match(selection.skipped[1]?.reason ?? "", /^IATA 三字码 QAA 在文件里重复出现/);
  assert.match(selection.skipped[2]?.reason ?? "", /^数据源编号在文件里重复出现/);
});

// ---------------------------------------------------------------------------------------------------------------------
// 导入计划
// ---------------------------------------------------------------------------------------------------------------------

const existing = (overrides: Partial<ExistingAirport> & { code: string }): ExistingAirport => ({
  id: `id-${overrides.code}`,
  countryCode: "JP",
  nameEn: "QA Airport",
  lng: 139.5,
  lat: 35.5,
  sourceRef: null,
  sourceOverridden: false,
  ...overrides,
});
const select = (rows: Row[]): AirportSelection => selectAirports(file(rows), null);
const summary = (plan: ReturnType<typeof planAirportImport>) => ({
  creates: plan.creates.map((airport) => airport.iata),
  updates: plan.updates.map((update) => update.code),
  unchanged: plan.unchanged,
  keptManual: plan.keptManual,
  conflicts: plan.conflicts.map((conflict) => conflict.iata),
  outOfScope: plan.outOfScope,
});

test("导入计划：同一个机场在数据源里改了三字码——不新增、不改编码、原来的机场不动，列为需要人工处理", () => {
  const plan = planAirportImport([existing({ code: "QAA", sourceRef: "970001" })], select([{ id: "970001", iata_code: "QAZ", name: "Renamed Too", latitude_deg: "36" }]));
  assert.deepEqual(summary(plan), { creates: [], updates: [], unchanged: [], keptManual: [], conflicts: ["QAZ"], outOfScope: [] });
  assert.match(plan.conflicts[0]?.reason ?? "", /由 QAA 变成了 QAZ/);
});

test("导入计划：两个机场在数据源里互换了三字码——两个都列为需要人工处理，谁也不被对方的数据覆盖", () => {
  const plan = planAirportImport(
    [existing({ code: "QAA", sourceRef: "970001" }), existing({ code: "QAB", sourceRef: "970002" })],
    select([{ id: "970001", iata_code: "QAB", name: "Was A" }, { id: "970002", iata_code: "QAA", name: "Was B" }]),
  );
  assert.deepEqual(summary(plan), { creates: [], updates: [], unchanged: [], keptManual: [], conflicts: ["QAB", "QAA"], outOfScope: [] });
});

test("导入计划：旧机场关闭后三字码给了新机场——新机场不会顶替旧记录，列为需要人工处理；旧机场提示已不在范围内、不停用", () => {
  const plan = planAirportImport(
    [existing({ code: "QAA", sourceRef: "970001" })],
    select([{ id: "970001", iata_code: "QAA", type: "closed" }, { id: "970099", iata_code: "QAA", name: "Brand New Airport", latitude_deg: "36" }]),
  );
  assert.deepEqual(summary(plan), { creates: [], updates: [], unchanged: [], keptManual: [], conflicts: ["QAA"], outOfScope: ["QAA"] });
  assert.match(plan.conflicts[0]?.reason ?? "", /已被另一条导入的机场使用/);
});

test("导入计划：已关闭的机场——以前导入过的只提示；从没导入过的不新增也不提示；手工录入的同码机场不受影响", () => {
  const selection = select([
    { id: "970001", iata_code: "QAA", type: "closed" },
    { id: "970002", iata_code: "QAB", type: "closed" },
    { id: "970003", iata_code: "QAC", scheduled_service: "no" },
  ]);
  const plan = planAirportImport([existing({ code: "QAA", sourceRef: "970001" }), existing({ code: "QAB" }), existing({ code: "QAC", sourceRef: "970003", sourceOverridden: true })], selection);
  assert.deepEqual(summary(plan), { creates: [], updates: [], unchanged: [], keptManual: [], conflicts: [], outOfScope: ["QAA", "QAC"] });
});

test("导入计划：只变了名称、只变了经度、只变了纬度，各自都算更新；平台改过的机场只要和数据源有任何不同就不覆盖，完全相同则算没有变化", () => {
  const base = { id: "970001", iata_code: "QAA" };
  for (const change of [{ name: "New Name" }, { longitude_deg: "139.500001" }, { latitude_deg: "35.499999" }] as Row[]) {
    const fresh = planAirportImport([existing({ code: "QAA", sourceRef: "970001" })], select([{ ...base, ...change }]));
    assert.deepEqual(summary(fresh).updates, ["QAA"], JSON.stringify(change));
    assert.deepEqual(fresh.updates[0]?.before, { nameEn: "QA Airport", lng: 139.5, lat: 35.5 });
    const overridden = planAirportImport([existing({ code: "QAA", sourceRef: "970001", sourceOverridden: true })], select([{ ...base, ...change }]));
    assert.deepEqual(summary(overridden), { creates: [], updates: [], unchanged: [], keptManual: ["QAA"], conflicts: [], outOfScope: [] });
  }
  // 小于 6 位小数精度的差别不算变化
  const tiny = planAirportImport([existing({ code: "QAA", sourceRef: "970001" })], select([{ ...base, longitude_deg: "139.5000004", latitude_deg: "35.4999996" }]));
  assert.deepEqual(summary(tiny).unchanged, ["QAA"]);
  const same = planAirportImport([existing({ code: "QAA", sourceRef: "970001", sourceOverridden: true })], select([base]));
  assert.deepEqual(summary(same).unchanged, ["QAA"]);
  // 英文名被平台清掉了（没标「改过」的情况不会出现，但规则上应当补回来）
  const cleared = planAirportImport([existing({ code: "QAA", sourceRef: "970001", nameEn: null })], select([base]));
  assert.deepEqual(cleared.updates[0]?.before.nameEn, null);
  assert.deepEqual(cleared.updates[0]?.after.nameEn, "QA Airport");
});

test("导入计划：按计划执行之后再算一次，一定是「全部没有变化」（重复执行零改动）", () => {
  const rows: Row[] = Array.from({ length: 60 }, (_, index) => ({
    id: String(971000 + index),
    iata_code: `Q${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + (index % 26))}`,
    name: `QA Airport ${index}`,
    latitude_deg: (20 + index * 0.7654321).toFixed(7),
    longitude_deg: (100 + index * 1.2345678).toFixed(7),
    iso_country: index % 3 === 0 ? "KR" : "JP",
  }));
  const selection = select(rows);
  // 库里的起点：三分之一没有、三分之一内容过期、其余一致
  const start: ExistingAirport[] = selection.airports.flatMap((airport, index) =>
    index % 3 === 0 ? [] : [existing({ code: airport.iata, countryCode: airport.countryCode, sourceRef: airport.sourceRef, nameEn: index % 3 === 1 ? "Old Name" : airport.name, lng: airport.lng, lat: airport.lat })],
  );
  const plan = planAirportImport(start, selection);
  assert.deepEqual([plan.creates.length, plan.updates.length, plan.unchanged.length, plan.conflicts.length], [20, 20, 20, 0]);
  const applied: ExistingAirport[] = [
    ...start.map((airport) => {
      const update = plan.updates.find((candidate) => candidate.id === airport.id);
      return update ? { ...airport, ...update.after } : airport;
    }),
    ...plan.creates.map((airport) => existing({ code: airport.iata, countryCode: airport.countryCode, sourceRef: airport.sourceRef, nameEn: airport.name, lng: airport.lng, lat: airport.lat })),
  ];
  const second = planAirportImport(applied, selection);
  assert.deepEqual([second.creates, second.updates, second.keptManual, second.conflicts, second.outOfScope], [[], [], [], [], []]);
  assert.equal(second.unchanged.length, 60);
});

// ---------------------------------------------------------------------------------------------------------------------
// 主数据规则的边界
// ---------------------------------------------------------------------------------------------------------------------

test("规则：坐标取整——保留 6 位小数，取整不会把合法坐标变成越界；NaN 和无穷大不是合法坐标", () => {
  assert.equal(roundCoordinate(139.7671254), 139.767125);
  assert.equal(roundCoordinate(139.7671256), 139.767126);
  assert.equal(roundCoordinate(-139.7671256), -139.767126);
  assert.equal(roundCoordinate(179.9999999), 180);
  assert.equal(roundCoordinate(-89.9999999), -90);
  for (let i = 0; i < 2_000; i += 1) {
    const lng = -180 + (360 * i) / 1_999;
    const lat = -90 + (180 * i) / 1_999;
    assert.ok(isLongitude(roundCoordinate(lng)) && isLatitude(roundCoordinate(lat)));
    assert.ok(Math.abs(roundCoordinate(lng) - lng) <= 0.0000005 + Number.EPSILON * 256);
    assert.equal(roundCoordinate(roundCoordinate(lat)), roundCoordinate(lat), "取整两次和取整一次一样");
  }
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(isLongitude(bad), false);
    assert.equal(isLatitude(bad), false);
  }
  assert.deepEqual([isLongitude(180), isLongitude(-180), isLongitude(180.0000001), isLatitude(90), isLatitude(-90), isLatitude(-90.0000001)], [true, true, false, true, true, false]);
});

test("规则：时区——任何奇怪的输入都只是返回 false，不抛异常", () => {
  for (const value of ["", " ", "/", "//", "Asia//Tokyo", "Asia/Tokyo/", "A/B", "Asia/Tokyo\u0000", "Asia/東京", "../../etc/passwd", "Asia/Tokyo?x=1", "Etc/GMT+9", "Etc/Unknown", "GMT+9", "UTC", "utc", "Z", "x".repeat(10_000), "Asia/" + "A".repeat(5_000)]) {
    assert.equal(isIanaTimeZone(value), false, JSON.stringify(value.slice(0, 30)));
  }
  for (const value of ["Asia/Tokyo", "Asia/Seoul", "America/New_York", "America/Argentina/Buenos_Aires", "Europe/London", "Australia/Sydney", "Pacific/Auckland"]) {
    assert.equal(isIanaTimeZone(value), true, value);
  }
});

test("规则：国家码和各种编码只认半角大写；正则的「结尾」不会放过末尾的换行", () => {
  for (const value of ["JP\n", "\nJP", "jp", "ＪＰ", "J P", "JP ", ""]) assert.equal(isCountryCode(value), false, JSON.stringify(value));
  for (const value of ["HND\n", "\nHND", "hnd", "ＨＮＤ", "HN1", "HNDX", "HN"]) assert.equal(isIataCode(value), false, JSON.stringify(value));
  assert.notEqual(cityCodeIssue("CTY-JP-TYO\n", "JP"), null);
  assert.notEqual(cityCodeIssue("x\nCTY-JP-TYO", "JP"), null);
  assert.notEqual(vehicleGroupCodeIssue("VG-BIZ-7\n", 7), null);
  assert.notEqual(vehicleGroupCodeIssue("VG-BIZ-07", 7), null);
  assert.notEqual(vehicleGroupCodeIssue("VG-BIZ-0", 0), null);
  assert.equal(vehicleGroupCodeIssue("VG-BIZ-60", 60), null);
  assert.notEqual(placeCodeIssue("station", "STN-JP-TOKYO\n", { countryCode: "JP", parentCode: null }), null);
  assert.notEqual(placeCodeIssue("terminal", "HND-T3", { countryCode: "JP", parentCode: null }), null, "没有上级编码时航站楼的编码无从校验，一律不通过");
  assert.notEqual(placeCodeIssue("terminal", "HND-T3", { countryCode: "JP", parentCode: "" }), null);
  assert.notEqual(placeCodeIssue("terminal", "HNDX-T3", { countryCode: "JP", parentCode: "HND" }), null, "只是以上级编码的字母开头不够，要紧跟连字符");
  assert.equal(placeCodeIssue("exit", "STN-JP-TOKYO-E1", { countryCode: "JP", parentCode: "STN-JP-TOKYO" }), null);
  assert.notEqual(placeCodeIssue("exit", "STN-JP-TOKYO-E1-A", { countryCode: "JP", parentCode: "STN-JP-TOKYO" }), null);
});

test("规则：边界顶点上限按所有多边形、所有环（含洞）的顶点总数算，正好等于上限可以", () => {
  const ring = (points: number, offset = 0): [number, number][] => {
    const result: [number, number][] = [];
    for (let i = 0; i < points - 1; i += 1) result.push([100 + offset + Math.cos((i / (points - 1)) * 2 * Math.PI), 30 + Math.sin((i / (points - 1)) * 2 * Math.PI)]);
    result.push(result[0] as [number, number]);
    return result;
  };
  assert.deepEqual(boundaryIssues({ type: "Polygon", coordinates: [ring(MAX_BOUNDARY_POINTS)] }), []);
  assert.equal(boundaryIssues({ type: "Polygon", coordinates: [ring(MAX_BOUNDARY_POINTS + 1)] }).length, 1);
  assert.deepEqual(boundaryIssues({ type: "Polygon", coordinates: [ring(MAX_BOUNDARY_POINTS - 4), ring(4)] }), []);
  assert.equal(boundaryIssues({ type: "Polygon", coordinates: [ring(MAX_BOUNDARY_POINTS - 3), ring(4)] }).length, 1);
  assert.deepEqual(boundaryIssues({ type: "MultiPolygon", coordinates: [[ring(2_500)], [ring(2_496, 5), ring(4, 5)]] }), []);
  assert.equal(boundaryIssues({ type: "MultiPolygon", coordinates: [[ring(2_500)], [ring(2_497, 5), ring(4, 5)]] }).length, 1);
});

test("规则：人数 / 行李数组合——20 个可以、21 个不行；每条问题都指出是第几个组合", () => {
  const combos = (count: number) => Array.from({ length: count }, (_, index) => ({ passengers: 1 + (index % 7), luggage: Math.floor(index / 7) }));
  assert.deepEqual(vehicleComboIssues(7, combos(20)), []);
  assert.deepEqual(vehicleComboIssues(7, combos(21)), ["组合最多 20 个"]);
  assert.deepEqual(vehicleComboIssues(7, [{ passengers: 7, luggage: 99 }, { passengers: 1, luggage: 0 }]), []);
  const issues = vehicleComboIssues(4, [{ passengers: 4, luggage: 2 }, { passengers: 5, luggage: 2 }, { passengers: 4, luggage: 2 }, { passengers: 1.5, luggage: -1 }, { passengers: Number.NaN, luggage: Number.NaN }]);
  assert.deepEqual(issues.map((issue) => issue.split("：")[0]), ["第 2 个组合", "第 3 个组合", "第 4 个组合", "第 4 个组合", "第 5 个组合", "第 5 个组合"]);
});
