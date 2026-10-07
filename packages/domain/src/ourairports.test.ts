import { test } from "node:test";
import assert from "node:assert/strict";
import { CsvError } from "./csv.ts";
import { type AirportSelection, type ExistingAirport, OURAIRPORTS, planAirportImport, selectAirports } from "./ourairports.ts";

/** 和真实文件一样的表头；下面的记录是测试里自己构造的，不是数据文件的拷贝。 */
const HEADER =
  '"id","ident","type","name","latitude_deg","longitude_deg","elevation_ft","continent","iso_country","iso_region","municipality","scheduled_service","icao_code","iata_code","gps_code","local_code","home_link","wikipedia_link","keywords"';

interface Row {
  id: string;
  type?: string;
  name?: string;
  lat?: string;
  lng?: string;
  country?: string;
  scheduled?: string;
  iata?: string;
}

function line(row: Row): string {
  const name = row.name ?? `Test Airport ${row.id}`;
  return [
    row.id, `"T${row.id}"`, `"${row.type ?? "large_airport"}"`, `"${name}"`, row.lat ?? "35.5", row.lng ?? "139.7", "10", '"AS"',
    `"${row.country ?? "JP"}"`, '"JP-13"', '"Testville"', `"${row.scheduled ?? "yes"}"`, "", `"${row.iata ?? ""}"`, "", "", "", "", '"a, b"',
  ].join(",");
}

function csv(rows: Row[]): string {
  return `${[HEADER, ...rows.map(line)].join("\n")}\n`;
}

test("数据源的说明齐全：名称、主页、下载地址、许可", () => {
  assert.equal(OURAIRPORTS.source, "ourairports");
  assert.match(OURAIRPORTS.homepage, /^https:\/\/ourairports\.com\//);
  assert.match(OURAIRPORTS.downloadUrl, /^https:\/\/.+\/airports\.csv$/);
  assert.match(OURAIRPORTS.license, /公有领域/);
});

test("只挑所选国家里有定期航班的大型、中型机场", () => {
  const selection = selectAirports(
    csv([
      { id: "1", iata: "AAA", name: "Alpha, International", lat: "35.5496781", lng: "139.7869584" },
      { id: "2", iata: "BBB", type: "medium_airport" },
      { id: "3", iata: "CCC", type: "small_airport" },
      { id: "4", iata: "DDD", type: "heliport" },
      { id: "5", iata: "EEE", type: "closed" },
      { id: "6", iata: "FFF", scheduled: "no" },
      { id: "7", iata: "GGG", country: "KR" },
      { id: "8", iata: "HHH", country: "US" },
    ]),
    ["JP", "KR"],
  );
  assert.equal(selection.totalRows, 8);
  assert.deepEqual(selection.airports.map((airport) => airport.iata), ["AAA", "BBB", "GGG"]);
  assert.deepEqual(selection.airports[0], { sourceRef: "1", iata: "AAA", countryCode: "JP", name: "Alpha, International", lat: 35.549678, lng: 139.786958 });
  assert.deepEqual(selection.skipped, []);
  assert.deepEqual(selection.outOfScopeRefs, ["3", "4", "5", "6"], "所选国家里不在范围内的记录要记下编号；别的国家的不记");
});

test("不限国家时每个国家都挑", () => {
  const selection = selectAirports(csv([{ id: "1", iata: "AAA" }, { id: "2", iata: "BBB", country: "US" }]), null);
  assert.deepEqual(selection.airports.map((airport) => airport.countryCode), ["JP", "US"]);
});

test("范围内但数据不合格的记录：跳过并说明原因，不影响其他记录", () => {
  const selection = selectAirports(
    csv([
      { id: "1", iata: "" },
      { id: "2", iata: "ab1" },
      { id: "3", iata: "CCC", lat: "91" },
      { id: "4", iata: "DDD", lng: "" },
      { id: "5", iata: "EEE", lat: "0", lng: "0" },
      { id: "6", iata: "FFF", name: "" },
      { id: "x7", iata: "GGG" },
      { id: "8", iata: "HHH" },
      { id: "9", iata: "HHH" },
      { id: "8", iata: "III" },
      { id: "10", iata: "JJJ", lat: "abc" },
      { id: "11", iata: "KKK", name: "N".repeat(201) },
    ]),
    ["JP"],
  );
  assert.deepEqual(selection.airports.map((airport) => airport.iata), ["HHH"]);
  assert.deepEqual(
    selection.skipped.map((row) => `${row.row}：${row.reason}`),
    [
      "2：没有 IATA 三字码",
      "3：IATA 三字码 ab1 格式不对",
      "4：坐标缺失或超出范围（要求十进制数字）",
      "5：坐标缺失或超出范围（要求十进制数字）",
      "6：坐标是 (0, 0)，多半是没有填",
      "7：名称为空或超过 200 个字符",
      "8：数据源编号不是数字",
      "10：IATA 三字码 HHH 在文件里重复出现，只取第一条",
      "11：数据源编号在文件里重复出现",
      "12：坐标缺失或超出范围（要求十进制数字）",
      "13：名称为空或超过 200 个字符",
    ],
  );
});

test("坐标只认十进制写法：十六进制、二进制、八进制、带单位的都跳过；名称只有不可见字符的跳过", () => {
  const selection = selectAirports(
    csv([
      { id: "1", iata: "AAA", lat: "0x23" },
      { id: "2", iata: "BBB", lng: "0b1100100" },
      { id: "3", iata: "CCC", lat: "0o43" },
      { id: "4", iata: "DDD", lat: "35.5N" },
      { id: "5", iata: "EEE", lat: "3.55e1", lng: "-1.5E2" },
      { id: "6", iata: "FFF", lat: "-0.0000001", lng: "-0" },
      { id: "7", iata: "GGG", name: "\u200b\u200b" },
    ]),
    ["JP"],
  );
  assert.deepEqual(selection.airports.map((airport) => [airport.iata, airport.lat, airport.lng]), [["EEE", 35.5, -150]]);
  assert.deepEqual(selection.skipped.map((row) => row.reason.slice(0, 2)), ["坐标", "坐标", "坐标", "坐标", "坐标", "名称"]);
});

test("某条记录里有 NUL 字符：整份文件不可信，报错并指出是第几条、哪个机场", () => {
  assert.throws(
    () => selectAirports(csv([{ id: "1", iata: "AAA" }, { id: "2", iata: "BBB", name: "Bad\u0000Name" }]), ["JP"]),
    (err: unknown) => err instanceof CsvError && /第 3 条记录（BBB）里有 NUL 字符/.test(err.message),
  );
});

test("国家码不是 ISO 代码的记录：跳过", () => {
  const selection = selectAirports(csv([{ id: "1", iata: "AAA", country: "ZZ" }]), null);
  assert.deepEqual(selection.airports, []);
  assert.match(selection.skipped[0]?.reason ?? "", /国家码/);
});

test("不是 airports.csv（缺列、空文件）：报错并说明缺什么", () => {
  assert.throws(() => selectAirports("", ["JP"]), CsvError);
  assert.throws(() => selectAirports("id,name\n1,x\n", ["JP"]), /缺少列 type、latitude_deg、longitude_deg、iso_country、scheduled_service、iata_code/);
});

const existing = (overrides: Partial<ExistingAirport> & { code: string }): ExistingAirport => ({
  id: `id-${overrides.code}`,
  countryCode: "JP",
  nameEn: `Test Airport ${overrides.code}`,
  lng: 139.7,
  lat: 35.5,
  sourceRef: null,
  sourceOverridden: false,
  ...overrides,
});

function selectionOf(rows: Row[]): AirportSelection {
  return selectAirports(csv(rows), ["JP"]);
}

test("导入计划：库里没有的新增", () => {
  const plan = planAirportImport([], selectionOf([{ id: "1", iata: "AAA" }, { id: "2", iata: "BBB" }]));
  assert.deepEqual(plan.creates.map((airport) => airport.iata), ["AAA", "BBB"]);
  assert.deepEqual([plan.updates, plan.unchanged, plan.keptManual, plan.conflicts, plan.outOfScope], [[], [], [], [], []]);
});

test("导入计划：同一份文件再来一次，什么都不用做", () => {
  const selection = selectionOf([{ id: "1", iata: "AAA" }, { id: "2", iata: "BBB" }]);
  const stored = selection.airports.map((airport) =>
    existing({ code: airport.iata, sourceRef: airport.sourceRef, nameEn: airport.name, lng: airport.lng, lat: airport.lat }),
  );
  const plan = planAirportImport(stored, selection);
  assert.deepEqual(plan.unchanged, ["AAA", "BBB"]);
  assert.deepEqual([plan.creates, plan.updates, plan.keptManual, plan.conflicts], [[], [], [], []]);
});

test("导入计划：数据源里名称或坐标变了的更新；平台改过的不覆盖", () => {
  const selection = selectionOf([
    { id: "1", iata: "AAA", name: "Renamed" },
    { id: "2", iata: "BBB", lat: "36.1" },
    { id: "3", iata: "CCC", name: "Source Name" },
    { id: "4", iata: "DDD" },
  ]);
  const plan = planAirportImport(
    [
      existing({ code: "AAA", sourceRef: "1", nameEn: "Old Name" }),
      existing({ code: "BBB", sourceRef: "2", nameEn: "Test Airport 2" }),
      existing({ code: "CCC", sourceRef: "3", nameEn: "平台改的名字", sourceOverridden: true }),
      existing({ code: "DDD", sourceRef: "4", nameEn: "Test Airport 4", sourceOverridden: true }),
    ],
    selection,
  );
  assert.deepEqual(plan.updates, [
    { id: "id-AAA", code: "AAA", before: { nameEn: "Old Name", lng: 139.7, lat: 35.5 }, after: { nameEn: "Renamed", lng: 139.7, lat: 35.5 } },
    { id: "id-BBB", code: "BBB", before: { nameEn: "Test Airport 2", lng: 139.7, lat: 35.5 }, after: { nameEn: "Test Airport 2", lng: 139.7, lat: 36.1 } },
  ]);
  assert.deepEqual(plan.keptManual, ["CCC"]);
  assert.deepEqual(plan.unchanged, ["DDD"], "平台改过但和数据源一致的，算没有变化");
});

test("导入计划：三字码已被手工录入的机场占用、三字码或国家在数据源里变了——都不自动处理，列为冲突", () => {
  const selection = selectAirports(
    csv([
      { id: "1", iata: "AAA" },
      { id: "2", iata: "BBX" },
      { id: "3", iata: "CCC", country: "KR" },
      { id: "4", iata: "DDD" },
    ]),
    null,
  );
  const plan = planAirportImport(
    [
      existing({ code: "AAA" }),
      existing({ code: "BBB", sourceRef: "2" }),
      existing({ code: "CCC", sourceRef: "3" }),
      existing({ code: "DDD", sourceRef: "99" }),
    ],
    selection,
  );
  assert.deepEqual(plan.creates, []);
  assert.deepEqual(plan.updates, []);
  assert.deepEqual(plan.conflicts.map((conflict) => conflict.iata), ["AAA", "BBX", "CCC", "DDD"]);
  assert.match(plan.conflicts[0]?.reason ?? "", /手工录入/);
  assert.match(plan.conflicts[1]?.reason ?? "", /由 BBB 变成了 BBX/);
  assert.match(plan.conflicts[2]?.reason ?? "", /由 JP 变成了 KR/);
  assert.match(plan.conflicts[3]?.reason ?? "", /另一条导入/);
});

test("导入计划：以前导入过、现在数据源里关闭了或没有定期航班了的，只提示不停用", () => {
  const selection = selectionOf([{ id: "1", iata: "AAA", type: "closed" }, { id: "2", iata: "BBB", scheduled: "no" }, { id: "3", iata: "CCC", type: "closed" }]);
  const plan = planAirportImport([existing({ code: "AAA", sourceRef: "1" }), existing({ code: "BBB", sourceRef: "2" })], selection);
  assert.deepEqual(plan.outOfScope, ["AAA", "BBB"]);
  assert.deepEqual([plan.creates, plan.updates, plan.unchanged], [[], [], []]);
});
