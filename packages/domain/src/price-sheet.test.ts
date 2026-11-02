/**
 * 价格表第 0 阶段的解析和映射（ADR 0059）。所有名称、价格都是虚构的，不来自真实价格表。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type PriceSheetCell,
  PRICE_SHEET_COUNTRIES,
  PRICE_SHEET_MILEAGE,
  PRICE_SHEET_NOTES,
  PRICE_SHEET_VEHICLES,
  type PriceSheetRawSheet,
  PriceSheetError,
  analyzePriceSheetReverse,
  buildPriceSheetReport,
  classifyPriceSheetEndpoint,
  classifyPriceSheetRoute,
  escapePriceSheetText,
  findPriceSheetDuplicateColumns,
  findPriceSheetInversions,
  matchPriceSheetCity,
  normalizePriceSheetName,
  parsePriceSheetMaster,
  parsePriceWorkbook,
  priceSheetEndpointSuspicion,
  priceSheetEndpoints,
  renderPriceSheetMarkdown,
  suggestPriceSheetVehicleCode,
  summarizePriceSheetReverse,
} from "./index.ts";

const t = (text: string): PriceSheetCell => ({ type: "text", text });
const n = (value: number): PriceSheetCell => ({ type: "number", text: String(value) });
const E: PriceSheetCell = { type: "empty" };
const cell = (value: string | number | null): PriceSheetCell => (value === null ? E : typeof value === "number" ? n(value) : t(value));
const rows = (...list: (string | number | null)[][]): PriceSheetCell[][] => list.map((row) => row.map(cell));

const CAP = "最多4人/2件";

function routeSheet(name: string, columns: string[], routes: (string | number | null)[][], capacities?: string[]): PriceSheetRawSheet {
  return { name, rows: rows(["出发地", "目的地", ...columns], [null, null, ...(capacities ?? columns.map(() => CAP))], ...routes) };
}

/** 除了给定的表，其余都是只有表头的空表。说明页的路线数按 `declared` 写。 */
function workbook(overrides: Partial<Record<string, PriceSheetRawSheet>> = {}, declared?: Record<string, number>): PriceSheetRawSheet[] {
  const notes: PriceSheetRawSheet = {
    name: PRICE_SHEET_NOTES,
    rows: rows(
      ["• 若未单独列出反向线路，反向同价。"],
      ["• 「里程价」页：起步价含前10公里，之后按每公里计价。"],
      ...PRICE_SHEET_COUNTRIES.map((country) => [`  ${country.sheet}：${declared?.[country.sheet] ?? 0} 条`]),
    ),
  };
  return [
    overrides[PRICE_SHEET_NOTES] ?? notes,
    overrides[PRICE_SHEET_VEHICLES] ?? { name: PRICE_SHEET_VEHICLES, rows: rows(["国家/地区", "车型", "代表车型（或同级）", "最多乘客", "最多行李"]) },
    ...PRICE_SHEET_COUNTRIES.map((country) => overrides[country.sheet] ?? routeSheet(country.sheet, [], [])),
    overrides[PRICE_SHEET_MILEAGE] ?? { name: PRICE_SHEET_MILEAGE, rows: rows(["国家/地区", "车型", "价格包", "起步价（日元）", "最低消费（日元）", "超出后每公里（日元）", "来源"]) },
  ];
}

const JAPAN_ROUTES: (string | number | null)[][] = [
  ["甲城机场", "甲城市", 1000, 900],
  ["甲城市", "甲城机场", 1100, 1200],
  ["乙城机场", "乙城市", 2000, 2500],
  ["丙站", "丙城市", 3000, null],
  ["丁码头", "丁城市", 4000, 4500],
  ["甲城机场", "乙城机场", 5000, 5500],
  ["甲城市", "甲城市", 600, 700],
  ["甲城市", "乙城市", 800, 850],
  ["乙城市", "甲城市", 810, 850],
  ["甲城机场", "丙站", 900, null],
];

test("解析路线表：车型、容量、有价和空的格", () => {
  const book = parsePriceWorkbook(workbook({ 日本: routeSheet("日本", ["Economy 5 Seater", "Economy 7 Seater"], JAPAN_ROUTES, ["最多4人/2件", "最多6人/4件"]) }, { 日本: 10 }));
  const japan = book.countries[0];
  assert.equal(japan?.countryCode, "JP");
  assert.deepEqual(japan?.columns.map((column) => [column.name, column.capacity]), [["Economy 5 Seater", { passengers: 4, luggage: 2 }], ["Economy 7 Seater", { passengers: 6, luggage: 4 }]]);
  assert.equal(japan?.routes.length, 10);
  assert.deepEqual(japan?.routes[3]?.prices, [3000, null]);
  assert.equal(japan?.routes[0]?.row, 3, "行号从表里的第 3 行开始");
  assert.deepEqual(book.issues, []);
  assert.equal(book.notes.reverseSamePrice, true);
  assert.equal(book.notes.startKilometers, 10);
});

test("价格格只接受十进制正整数：公式、文字、小数、科学计数、零、错误值都是问题，不是价格也不算空", () => {
  const weird: PriceSheetCell[] = [{ type: "formula" }, t("1000"), { type: "number", text: "12.5" }, { type: "number", text: "1.2E+4" }, { type: "number", text: "0" }, { type: "error", text: "#N/A" }, { type: "boolean", text: "TRUE" }, { type: "number", text: "2000000000" }];
  const columns = weird.map((_, index) => `Economy ${index + 2} Seater`);
  const sheet: PriceSheetRawSheet = { name: "日本", rows: [...rows(["出发地", "目的地", ...columns], [null, null, ...columns.map(() => CAP)]), [t("甲"), t("乙"), ...weird]] };
  const book = parsePriceWorkbook(workbook({ 日本: sheet }));
  const route = book.countries[0]?.routes[0];
  assert.deepEqual(route?.prices, weird.map(() => null));
  assert.equal(route?.invalidCells, weird.length);
  assert.deepEqual(book.issues.filter((issue) => issue.where.startsWith("日本")).map((issue) => issue.code), ["FORMULA_CELL", ...weird.slice(1).map(() => "INVALID_PRICE_CELL")]);
  assert.equal(book.issues[0]?.where, "日本!C3");
  const report = buildPriceSheetReport(book, null);
  assert.equal(report.totals.pricedCells, 0);
  assert.equal(report.totals.emptyCells, 0);
  assert.equal(report.totals.invalidCells, weird.length);
});

test("结构不对的表直接拒绝：缺表、表头不对", () => {
  assert.throws(() => parsePriceWorkbook(workbook().filter((sheet) => sheet.name !== "越南")), (err: unknown) => err instanceof PriceSheetError && err.code === "MISSING_SHEET");
  assert.throws(() => parsePriceWorkbook(workbook({ 日本: { name: "日本", rows: rows(["起点", "终点"]) } })), (err: unknown) => err instanceof PriceSheetError && err.code === "BAD_HEADER");
  assert.throws(() => parsePriceWorkbook(workbook({ [PRICE_SHEET_MILEAGE]: { name: PRICE_SHEET_MILEAGE, rows: rows(["国家/地区", "车型", "价格包", "起步价（美元）"]) } })), (err: unknown) => err instanceof PriceSheetError && err.code === "BAD_HEADER");
  assert.throws(() => parsePriceWorkbook(workbook({ 日本: { name: "日本", rows: [] } })), (err: unknown) => err instanceof PriceSheetError && err.code === "BAD_HEADER");
});

test("行的问题逐条报告：端点不是文字、没有表头的列有值、容量写法不对、说明页路线数对不上", () => {
  const sheet: PriceSheetRawSheet = {
    name: "日本",
    rows: [...rows(["出发地", "目的地", "Economy 5 Seater"], [null, null, "四人"]), [{ type: "formula" }, t("乙"), n(100)], [t("甲"), t("乙"), n(100), E, n(999)]],
  };
  const book = parsePriceWorkbook(workbook({ 日本: sheet }, { 日本: 5 }));
  assert.deepEqual(book.issues.map((issue) => issue.code), ["CAPACITY_UNPARSEABLE", "INVALID_ENDPOINT", "ORPHAN_VALUE", "DECLARED_COUNT_MISMATCH"]);
  assert.equal(book.countries[0]?.routes.length, 1);
});

test("名字的归一化：全半角、空白、大小写、不可见字符；不做繁简转换", () => {
  assert.equal(normalizePriceSheetName("  ＡＢＣ　  市（Ｘ）​ "), "abc 市(x)");
  assert.equal(normalizePriceSheetName("Tokyo\nCity"), "tokyo city");
  assert.notEqual(normalizePriceSheetName("機場"), normalizePriceSheetName("机场"));
});

test("端点分类只看明确的字", () => {
  for (const name of ["甲城机场", "乙城機場", "丙空港(XYZ)", "丁国際空港"]) assert.equal(classifyPriceSheetEndpoint(name), "airport", name);
  for (const name of ["甲南站", "乙城火车站", "丙-丙站"]) assert.equal(classifyPriceSheetEndpoint(name), "station", name);
  for (const name of ["甲码头", "乙國際客運碼頭", "丙邮轮中心港", "丁 港口", "戊北（甲、游轮码头）"]) assert.equal(classifyPriceSheetEndpoint(name), "pier", name);
  for (const name of ["甲城市", "香港某区", "乙港", "丙滑雪场", "丁站前区"]) assert.equal(classifyPriceSheetEndpoint(name), "place", name);
});

test("算成地点但名字存疑的只提示，不改分类", () => {
  assert.match(priceSheetEndpointSuspicion("乙港") ?? "", /港/);
  assert.equal(classifyPriceSheetEndpoint("乙港"), "place");
  assert.match(priceSheetEndpointSuspicion("丙国际场") ?? "", /场/);
  assert.match(priceSheetEndpointSuspicion("丁口岸") ?? "", /口岸/);
  assert.equal(priceSheetEndpointSuspicion("香港"), null);
  assert.equal(priceSheetEndpointSuspicion("甲城市"), null);
  assert.equal(priceSheetEndpointSuspicion("甲机场"), null, "已经判断成别的类型");
});

test("路线分类：大类先看机场，结论在小类", () => {
  const check = (from: string, to: string, routeClass: string, detail: string): void => assert.deepEqual(classifyPriceSheetRoute(from, to), { routeClass, detail }, `${from}→${to}`);
  check("甲机场", "甲城市", "airport_place", "airport_place");
  check("甲城市", "甲机场", "airport_place", "airport_place");
  check("甲机场", "乙机场", "airport_airport", "airport_airport");
  check("甲机场", "甲站", "airport_place", "station_airport");
  check("甲码头", "甲机场", "airport_place", "pier_airport");
  check("甲站", "甲城市", "station_pier_other", "station_place");
  check("甲站", "乙站", "station_pier_other", "station_station");
  check("甲码头", "甲城市", "station_pier_other", "pier_place");
  check("甲码头", "甲站", "station_pier_other", "pier_station");
  check("甲码头", "乙码头", "station_pier_other", "pier_pier");
  check("甲城市", "甲城市", "place_place", "place_same");
  check("甲城市", "乙城市", "place_place", "place_other");
});

test("反向价：单向、双向同价、双向不同、部分有价、起终点相同、重复行", () => {
  const pairs = analyzePriceSheetReverse([
    { from: "甲机场", to: "甲城市", prices: [100, 200] },
    { from: "乙机场", to: "乙城市", prices: [100, 200] },
    { from: "乙城市", to: "乙机场", prices: [100, 200] },
    { from: "丙机场", to: "丙城市", prices: [100, 200] },
    { from: "丙城市", to: "丙机场", prices: [100, 300] },
    { from: "丁机场", to: "丁城市", prices: [100, null] },
    { from: "丁城市", to: "丁机场", prices: [100, 200] },
    { from: "戊城市", to: "戊城市", prices: [100, 200] },
    { from: "己机场", to: "己城市", prices: [100, 200] },
    { from: "己机场", to: "己城市", prices: [100, 900] },
    { from: "庚机场", to: "庚城市", prices: [100, 200] },
    { from: "庚机场", to: "庚城市", prices: [100, 200] },
  ]);
  const kinds = new Map(pairs.map((pair) => [pair.from, pair]));
  assert.equal(kinds.get("甲机场")?.kind, "one_way");
  assert.equal(kinds.get("甲机场")?.pricedColumns, 2);
  assert.equal(kinds.get("乙机场")?.kind, "both_same");
  assert.equal(kinds.get("丙机场")?.kind, "both_different");
  assert.equal(kinds.get("丙机场")?.sameColumns, 1);
  assert.equal(kinds.get("丙机场")?.differentColumns, 1);
  assert.equal(kinds.get("丁机场")?.kind, "both_partial");
  assert.equal(kinds.get("丁机场")?.oneSidedColumns, 1);
  assert.equal(kinds.get("戊城市")?.kind, "self");
  assert.equal(kinds.get("己机场")?.kind, "duplicate_conflict", "价格不一致的重复行不选其中一行");
  assert.equal(kinds.get("庚机场")?.kind, "one_way");
  assert.equal(kinds.get("庚机场")?.duplicateRows, 1);
});

test("反向价的映射：接送机按列算 both / pickup + dropoff，点对点无法表达，有规则才算框架内", () => {
  const pairs = analyzePriceSheetReverse([
    { from: "甲机场", to: "甲城市", prices: [100, 200] },
    { from: "丙机场", to: "丙城市", prices: [100, 200] },
    { from: "丙城市", to: "丙机场", prices: [100, 300] },
    { from: "丁机场", to: "丁城市", prices: [100, null] },
    { from: "丁城市", to: "丁机场", prices: [100, 200] },
    { from: "戊城市", to: "己城市", prices: [100, 200] },
    { from: "己城市", to: "戊城市", prices: [100, 300] },
    { from: "庚城市", to: "辛城市", prices: [100, 200] },
    { from: "壬城市", to: "壬城市", prices: [100, 200] },
    { from: "癸码头", to: "癸城市", prices: [100, 200] },
  ]);
  const summary = summarizePriceSheetReverse(pairs, true);
  assert.equal(summary.transferBothRules, 2 + 1 + 1);
  assert.equal(summary.transferPickupRules, 1);
  assert.equal(summary.transferDropoffRules, 1);
  assert.equal(summary.transferOneSidedCells, 1);
  assert.equal(summary.pointToPointUnexpressible, 2, "起终点相同的不算");
  const scope = (kind: string, group: string): string | undefined => summary.pairs.find((pair) => pair.kind === kind && pair.group === group)?.scope;
  assert.equal(scope("one_way", "transfer"), "in_framework");
  assert.equal(scope("both_different", "transfer"), "in_framework");
  assert.equal(scope("both_partial", "transfer"), "owner_confirm");
  assert.equal(scope("both_different", "point_to_point"), "out_of_framework");
  assert.equal(scope("self", "point_to_point"), "owner_confirm");
  assert.equal(scope("one_way", "conditional"), "owner_confirm");
  const withoutRule = summarizePriceSheetReverse(pairs, false);
  assert.equal(withoutRule.pairs.find((pair) => pair.kind === "one_way" && pair.group === "transfer")?.scope, "owner_confirm", "说明页没写反向同价，单向列出的不能当同价");
});

test("同名的车型列报成歧义，不合并、不覆盖", () => {
  const sheet = routeSheet("中国大陆", ["Comfort 5 Seater", "Economy 5 Seater", "Comfort 5 Seater"], [["甲", "乙", 100, 200, 300], ["甲", "丙", 100, 200, 100], ["甲", "丁", null, 200, 300]]);
  const book = parsePriceWorkbook(workbook({ 中国大陆: sheet }));
  const china = book.countries[1];
  assert.equal(china?.columns.length, 3, "两列都保留");
  assert.deepEqual(china?.routes[0]?.prices, [100, 200, 300]);
  const duplicates = findPriceSheetDuplicateColumns(china as NonNullable<typeof china>);
  assert.deepEqual(duplicates, [{ sheet: "中国大陆", name: "Comfort 5 Seater", refs: ["中国大陆!C1", "中国大陆!E1"], sameCapacity: true, rowsBothPriced: 2, rowsDiffering: 1 }]);
  const report = buildPriceSheetReport(book, null);
  assert.equal(report.items.find((item) => item.id === "vehicle.duplicate_columns")?.scope, "owner_confirm");
  assert.equal(report.items.find((item) => item.id === "vehicle.duplicate_columns")?.count, 1);
});

test("建议的车型组编码：符合格式、名字没座位数或有不认识的词时不猜", () => {
  const code = (name: string): string | null => suggestPriceSheetVehicleCode(name).code;
  assert.equal(code("Economy 7 Seater"), "VG-ECO-7");
  assert.equal(code("Comfort Sedan 5 Seater"), "VG-CMFSEDAN-5");
  assert.equal(code("economy sedan 4 seater"), "VG-ECOSEDAN-4");
  assert.equal(code("Luxury van 6 Seater"), "VG-LUXVAN-6");
  assert.equal(code("Premium electric MPV 7 Seater"), "VG-PRMEVMPV-7");
  assert.equal(code("Bus 53 Seater"), "VG-BUS-53");
  for (const name of ["Economy 7 Seater", "Bus 53 Seater", "Comfort MPV 7 Seater", "Van 11 Seater"]) assert.match(code(name) ?? "", /^VG-[A-Z0-9]{2,8}-[1-9][0-9]?$/);
  assert.equal(code("EV Car"), null);
  assert.equal(code("Hover 5 Seater"), null);
  assert.equal(code("Premium Comfort Sedan MPV 5 Seater"), null, "等级段超长");
  assert.equal(suggestPriceSheetVehicleCode("Premium 5 Seater").grade, null, "Premium 不在现有四级里");
  assert.equal(suggestPriceSheetVehicleCode("Comfort MPV 7 Seater").grade, "comfort");
});

test("车型汇总：容量差异、大小写变体、编码相撞、和车型表不一致、现有车型组", () => {
  const vehicles: PriceSheetRawSheet = {
    name: PRICE_SHEET_VEHICLES,
    rows: rows(
      ["国家/地区", "车型", "代表车型（或同级）", "最多乘客", "最多行李"],
      ["日本", "Economy 7 Seater", "虚构车 A", 6, 4],
      ["泰国", "Economy 7 Seater", "虚构车 A", 4, 3],
      ["泰国", "Economy sedan 4 Seater", "虚构车 B", 3, 2],
      ["日本", "Economy Sedan 4 Seater", "虚构车 B", 3, 2],
      ["日本", "Economy Sedan 4 Seater", "虚构车 C", 3, 2],
      ["日本", "Bus 9 Seater", "虚构车 D", 12, 2],
      ["日本", "Only In Table 5 Seater", "虚构车 E", 4, 2],
    ),
  };
  const book = parsePriceWorkbook(
    workbook({
      [PRICE_SHEET_VEHICLES]: vehicles,
      日本: routeSheet("日本", ["Economy 7 Seater", "Economy Sedan 4 Seater", "Bus 9 Seater", "Not In Table 5 Seater"], [], ["最多5人/4件", "最多3人/2件", "最多12人/2件", CAP]),
      泰国: routeSheet("泰国", ["Economy 7 Seater", "Economy sedan 4 Seater"], [], ["最多4人/3件", "最多3人/2件"]),
    }),
  );
  const report = buildPriceSheetReport(book, null).vehicles;
  const row = (name: string) => report.rows.find((entry) => entry.name === name);
  assert.equal(row("Economy 7 Seater")?.capacityDiffers, true);
  assert.equal(row("Economy 7 Seater")?.existing, true);
  assert.equal(row("Economy 7 Seater")?.scope, "owner_confirm", "容量不一致，即使编码已有也要确认");
  assert.equal(row("Bus 9 Seater")?.passengersOverSeats, true);
  assert.deepEqual(report.caseVariants, [["Economy sedan 4 Seater", "Economy Sedan 4 Seater"]]);
  assert.deepEqual(report.codeCollisions, [{ code: "VG-ECOSEDAN-4", names: ["Economy sedan 4 Seater", "Economy Sedan 4 Seater"] }]);
  assert.deepEqual(report.capacityMismatches.map((entry) => [entry.sheet, entry.name]), [["日本", "Economy 7 Seater"]]);
  assert.deepEqual(report.missingFromVehicleSheet, [{ sheet: "日本", name: "Not In Table 5 Seater" }]);
  assert.deepEqual(report.missingFromRouteSheet, [{ sheet: "日本", name: "Only In Table 5 Seater" }]);
  assert.deepEqual(report.duplicateEntries.map((entry) => [entry.sheet, entry.name, entry.rows, entry.sampleModels]), [["日本", "Economy Sedan 4 Seater", [5, 6], ["虚构车 B", "虚构车 C"]]]);
});

test("同级别座位多反而便宜：只比同级别，只数和举例", () => {
  const sheet = {
    sheet: "日本",
    columns: [
      { column: 2, ref: "日本!C1", name: "Economy 5 Seater", capacity: null },
      { column: 3, ref: "日本!D1", name: "Economy 7 Seater", capacity: null },
      { column: 4, ref: "日本!E1", name: "Comfort 9 Seater", capacity: null },
      { column: 5, ref: "日本!F1", name: "EV Car", capacity: null },
    ],
    routes: [
      { row: 3, from: "甲", to: "乙", prices: [1000, 900, 100, 1], invalidCells: 0 },
      { row: 4, from: "甲", to: "丙", prices: [1000, 1000, 100, 1], invalidCells: 0 },
      { row: 5, from: "甲", to: "丁", prices: [1000, null, 100, 1], invalidCells: 0 },
    ],
  };
  const result = findPriceSheetInversions(sheet);
  assert.equal(result.routes, 1);
  assert.equal(result.comparisons, 1);
  assert.deepEqual(result.examples[0]?.more, { name: "Economy 7 Seater", seats: 7, price: 900 });
  assert.equal(result.examples.length, 1);
  const many = findPriceSheetInversions({ ...sheet, routes: Array.from({ length: 9 }, (_, index) => ({ row: index + 3, from: "甲", to: `乙${index}`, prices: [1000, 900, 100, 1], invalidCells: 0 })) });
  assert.equal(many.routes, 9);
  assert.equal(many.examples.length, 5, "只列前几例");
});

test("里程价：最低消费高于起步价、重复行、起步价倒挂、车型表里没有", () => {
  const mileage: PriceSheetRawSheet = {
    name: PRICE_SHEET_MILEAGE,
    rows: rows(
      ["国家/地区", "车型", "价格包", "起步价（日元）", "最低消费（日元）", "超出后每公里（日元）", "来源"],
      ["日本", "Economy 5 Seater", "包 A", 500, 300, 10, "虚构来源一"],
      ["日本", "Economy 7 Seater", "包 B", 400, 600, 10, "虚构来源二"],
      ["泰国", "Comfort 5 Seater", "包 C", 500, 300, 10, "虚构来源一"],
      ["泰国", "Comfort 5 Seater", "包 C", 900, 300, 10, "虚构来源一"],
      ["外星", "Comfort 5 Seater", "包 D", 500, 300, 10, "虚构来源一"],
    ),
  };
  const book = parsePriceWorkbook(workbook({ [PRICE_SHEET_MILEAGE]: mileage }));
  assert.deepEqual(book.issues.map((issue) => issue.code), ["UNKNOWN_COUNTRY"]);
  const report = buildPriceSheetReport(book, null);
  assert.equal(report.mileage.rows, 4);
  assert.equal(report.mileage.minAboveStart.count, 1);
  assert.deepEqual(report.mileage.minAboveStart.examples, [{ sheet: "日本", name: "Economy 7 Seater", startPrice: 400, minPrice: 600 }]);
  assert.equal(report.mileage.duplicates.conflicting, 1);
  assert.equal(report.mileage.duplicates.identical, 0);
  assert.equal(report.mileage.inversions.count, 1);
  assert.equal(report.mileage.startKilometers, 10);
  assert.equal(report.mileage.unknownVehicles.length, 3);
  assert.deepEqual(report.mileage.bySource, [{ source: "虚构来源一", rows: 3 }, { source: "虚构来源二", rows: 1 }]);
});

test("里程价：说明页没有写起步公里数时不算框架内", () => {
  const notes: PriceSheetRawSheet = { name: PRICE_SHEET_NOTES, rows: rows(["• 若未单独列出反向线路，反向同价。"]) };
  const report = buildPriceSheetReport(parsePriceWorkbook(workbook({ [PRICE_SHEET_NOTES]: notes })), null);
  assert.equal(report.mileage.startKilometers, null);
  assert.equal(report.items.find((item) => item.id === "mileage.mapping")?.scope, "owner_confirm");
});

test("城市匹配：同国家、名字完全相同才算；歧义不选；匹配不上就是未匹配", () => {
  const cities = [
    { code: "CTY-JP-AA", countryCode: "JP", names: ["甲城市", "Alpha"], status: "active" },
    { code: "CTY-JP-BB", countryCode: "JP", names: ["乙城市"], status: "disabled" },
    { code: "CTY-JP-CC", countryCode: "JP", names: ["乙城市"], status: "active" },
    { code: "CTY-KR-DD", countryCode: "KR", names: ["丙城市"], status: "active" },
  ];
  assert.deepEqual(matchPriceSheetCity(normalizePriceSheetName("ALPHA"), "JP", cities), { status: "matched", code: "CTY-JP-AA", cityStatus: "active" });
  assert.deepEqual(matchPriceSheetCity("乙城市", "JP", cities), { status: "ambiguous", codes: ["CTY-JP-BB", "CTY-JP-CC"] });
  assert.deepEqual(matchPriceSheetCity("丙城市", "JP", cities), { status: "unmatched" }, "别的国家的不算");
  assert.deepEqual(matchPriceSheetCity("甲城", "JP", cities), { status: "unmatched" }, "不做模糊匹配");
});

test("主数据文件写法不对就拒绝，不跳过", () => {
  const master = parsePriceSheetMaster({ cities: [{ code: "CTY-JP-AA", country_code: "JP", name: { zh: "甲城市", en: "Alpha" }, status: "active", extra: 1 }], vehicle_groups: [{ code: "VG-ECO-7" }] });
  assert.deepEqual(master, { cities: [{ code: "CTY-JP-AA", countryCode: "JP", names: ["甲城市", "Alpha"], status: "active" }], vehicleGroupCodes: ["VG-ECO-7"] });
  assert.equal(parsePriceSheetMaster({ cities: [] }).vehicleGroupCodes, null);
  for (const bad of [null, [], {}, { cities: {} }, { cities: [{}] }, { cities: [{ code: "x", country_code: "JP", status: "active", name: "甲" }] }, { cities: [{ code: "x", country_code: "JP", status: "active", name: { zh: 1 } }] }, { cities: [], vehicle_groups: [{}] }, { cities: [], vehicle_groups: 1 }]) {
    assert.throws(() => parsePriceSheetMaster(bad), (err: unknown) => err instanceof PriceSheetError && err.code === "BAD_MASTER");
  }
});

test("端点清单：按归一化后的名字去重，标出可能是几个地方的，起终点相同只数一次", () => {
  const endpoints = priceSheetEndpoints({
    sheet: "韩国",
    countryCode: "KR",
    routes: [
      { row: 3, from: "甲机场", to: "乙市, 丙市", prices: [], invalidCells: 0 },
      { row: 4, from: "ＡＢ市", to: "ab市", prices: [], invalidCells: 0 },
      { row: 5, from: "丁市", to: "丁市", prices: [], invalidCells: 0 },
    ],
  });
  assert.deepEqual(endpoints.map((entry) => [entry.normalized, entry.kind, entry.composite, entry.routes]), [
    ["甲机场", "airport", false, 1],
    ["乙市, 丙市", "place", true, 1],
    ["ab市", "place", false, 2],
    ["丁市", "place", false, 1],
  ]);
});

test("整份报告：分国家统计、每一项都有结论、没有主数据时只给待匹配清单", () => {
  const book = parsePriceWorkbook(workbook({ 日本: routeSheet("日本", ["Economy 5 Seater", "Economy 7 Seater"], JAPAN_ROUTES) }, { 日本: 10 }));
  const report = buildPriceSheetReport(book, null);
  assert.equal(report.mode, "dry_run");
  assert.equal(report.totals.routes, 10);
  assert.equal(report.totals.pricedCells, 18);
  assert.equal(report.totals.emptyCells, 2);
  assert.deepEqual(Object.values(report.totals.classes).map((stats) => stats.routes), [4, 2, 1, 3]);
  const japan = report.countries[0];
  assert.equal(japan?.routes, 10);
  assert.equal(report.countries[1]?.routes, 0);
  assert.deepEqual(japan?.endpoints.byKind, { airport: 2, station: 1, pier: 1, place: 4 });
  assert.equal(japan?.details.find((detail) => detail.detail === "pier_place")?.scope, "out_of_framework");
  assert.equal(japan?.details.find((detail) => detail.detail === "airport_place")?.scope, "in_framework");
  assert.equal(report.cities.masterProvided, false);
  assert.ok(report.cities.endpoints.every((endpoint) => endpoint.match === null));
  assert.equal(report.existingVehicleCodes.source, "assumed");
  for (const item of report.items) assert.ok(["in_framework", "out_of_framework", "owner_confirm"].includes(item.scope), item.id);
  for (const id of ["price.meaning", "price.currency", "price.valid_from", "area.shapes", "area.cross_city"]) assert.equal(report.items.find((item) => item.id === id)?.scope, "owner_confirm", id);
});

test("整份报告：有主数据时只比较地点，用主数据里的车型组", () => {
  const book = parsePriceWorkbook(workbook({ 日本: routeSheet("日本", ["Economy 5 Seater", "Economy 7 Seater"], JAPAN_ROUTES) }, { 日本: 10 }));
  const master = parsePriceSheetMaster({ cities: [{ code: "CTY-JP-AA", country_code: "JP", name: { zh: "甲城市" }, status: "active" }, { code: "CTY-JP-BB", country_code: "JP", name: { zh: "甲城机场" }, status: "active" }], vehicle_groups: [{ code: "VG-ECO-5" }] });
  const report = buildPriceSheetReport(book, master);
  assert.equal(report.cities.matched, 1);
  assert.equal(report.cities.unmatched, 3);
  assert.equal(report.cities.notCompared, 4, "机场不和城市比");
  assert.equal(report.vehicles.rows.find((row) => row.name === "Economy 5 Seater")?.existing, true);
  assert.equal(report.vehicles.rows.find((row) => row.name === "Economy 7 Seater")?.existing, false);
  assert.equal(report.existingVehicleCodes.source, "master");
});

test("跨 sheet：同一端点名、同一端点对都报出来", () => {
  const book = parsePriceWorkbook(
    workbook({
      中国大陆: routeSheet("中国大陆", ["Economy 5 Seater"], [["甲区", "乙区", 100], ["甲区", "丙区", 100]]),
      中国香港: routeSheet("中国香港", ["Economy 5 Seater"], [["乙区", "甲区", 200], ["甲区", "丁区", 100]]),
    }),
  );
  const report = buildPriceSheetReport(book, null);
  assert.equal(report.crossSheetRoutes.count, 1);
  assert.equal(report.crossSheetRoutes.differingPrices, 1);
  assert.deepEqual(report.crossSheetEndpoints.map((entry) => [entry.name, entry.sheets, entry.routes]), [["甲区", ["中国大陆", "中国香港"], 4], ["乙区", ["中国大陆", "中国香港"], 2]]);
});

test("表里的名字不能把原型链弄坏", () => {
  const book = parsePriceWorkbook(workbook({ 日本: routeSheet("日本", ["__proto__", "constructor"], [["__proto__", "constructor", 1, 2]]) }));
  const report = buildPriceSheetReport(book, null);
  assert.equal(report.totals.routes, 1);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(Object.getPrototypeOf({}), Object.prototype);
});

test("Markdown：表里的文字转义，表格和 HTML 不会被文件内容破坏", () => {
  assert.equal(escapePriceSheetText("a|b\nc<script>`x`"), "a\\|b c&lt;script&gt;\\`x\\`");
  const book = parsePriceWorkbook(workbook({ 日本: routeSheet("日本", ["Economy 5 Seater"], [["甲|<img src=x>", "乙\n# 标题", 100]]) }));
  const markdown = renderPriceSheetMarkdown(buildPriceSheetReport(book, null), { name: "虚构.xlsx", sha256: "0".repeat(64), bytes: 1, masterProvided: false });
  assert.ok(!markdown.includes("<img"));
  assert.ok(!/^# 标题/m.test(markdown));
  assert.match(markdown, /只读 dry-run/);
  assert.match(markdown, /需业主确认/);
  assert.match(markdown, /框架外/);
  assert.match(markdown, /框架内/);
});
