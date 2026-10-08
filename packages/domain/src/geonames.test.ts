import { test } from "node:test";
import assert from "node:assert/strict";
import { CsvError } from "./csv.ts";
import { nearestWithin } from "./geo.ts";
import {
  DEFAULT_MIN_POPULATION,
  type ExistingCity,
  GEONAMES,
  geonamesCityCode,
  geonamesNamesFile,
  planCityImport,
  selectCities,
} from "./geonames.ts";
import { CITY_SUGGESTION_MAX_KM, cityCodeIssue } from "./master-data.ts";

/** 下面的记录都是为测试编的（编号用 99 开头的大数），格式和 GeoNames 的 cities15000.txt 一样：19 列、制表符分隔。 */
interface Row {
  id: number | string;
  name?: string;
  lat?: string;
  lng?: string;
  code?: string;
  cls?: string;
  country?: string;
  population?: number | string;
  timezone?: string;
}

function line(row: Row): string {
  return [
    row.id, row.name ?? `City ${row.id}`, "ascii", "alt1,alt2", row.lat ?? "35.5", row.lng ?? "139.5", row.cls ?? "P", row.code ?? "PPL", row.country ?? "JP",
    "", "13", "", "", "", row.population ?? 500000, "", "40", row.timezone ?? "Asia/Tokyo", "2026-01-01",
  ].join("\t");
}

const file = (rows: Row[]): string => `${rows.map(line).join("\n")}\n`;

/** alternateNames 的一行：编号、城市编号、语言、名称、首选、简称、俗称、历史 */
function alt(cityId: number, tag: string, name: string, flags: { preferred?: boolean; short?: boolean; colloquial?: boolean; historic?: boolean } = {}): string {
  return [1, cityId, tag, name, flags.preferred ? "1" : "", flags.short ? "1" : "", flags.colloquial ? "1" : "", flags.historic ? "1" : "", "", ""].join("\t");
}

const all = { countries: null, minPopulation: DEFAULT_MIN_POPULATION };

test("数据源的说明齐全：名称、主页、许可（CC BY 4.0，须注明来源）、下载地址", () => {
  assert.equal(GEONAMES.source, "geonames");
  assert.match(GEONAMES.homepage, /^https:\/\/www\.geonames\.org\//);
  assert.match(GEONAMES.license, /CC BY 4\.0/);
  assert.match(GEONAMES.license, /注明来源/);
  assert.equal(GEONAMES.licenseUrl, "https://creativecommons.org/licenses/by/4.0/");
  assert.deepEqual(geonamesNamesFile("KR"), { url: "https://download.geonames.org/export/dump/alternatenames/KR.zip", entry: "KR.txt" });
  assert.equal(DEFAULT_MIN_POPULATION, 300_000);
});

test("导入城市的编码：只由数据源编号决定，符合城市编码的格式，不同编号一定不同", () => {
  assert.equal(geonamesCityCode("JP", 1850147), "CTY-JP-G13NKZ");
  assert.equal(geonamesCityCode("KR", 1835848), "CTY-KR-G13CJS");
  assert.equal(geonamesCityCode("JP", 1850147), geonamesCityCode("JP", 1850147));
  const codes = new Set<string>();
  for (const id of [1, 35, 36, 1295, 1296, 1850147, 13_713_025, 99_999_999, 2_000_000_000]) {
    const code = geonamesCityCode("JP", id);
    assert.equal(cityCodeIssue(code, "JP"), null, code);
    codes.add(code);
  }
  assert.equal(codes.size, 9);
});

test("范围：所选国家里人口达到门槛的城市，外加首都和一级行政区首府；城市里的区、非聚居地不算；按人口从多到少", () => {
  const text = file([
    { id: 990001, name: "Big", population: 2_000_000 },
    { id: 990002, name: "Edge", population: 300_000 },
    { id: 990003, name: "Small", population: 299_999 },
    { id: 990004, name: "Capital", population: 1000, code: "PPLC" },
    { id: 990005, name: "Prefecture seat", population: 90_000, code: "PPLA" },
    { id: 990006, name: "County seat", population: 90_000, code: "PPLA2" },
    { id: 990007, name: "Ward", population: 900_000, code: "PPLX" },
    { id: 990008, name: "Mountain", population: 900_000, cls: "T", code: "MT" },
    { id: 990009, name: "Abandoned", population: 900_000, code: "PPLQ" },
    { id: 990010, name: "Seoul-ish", population: 900_000, country: "KR", timezone: "Asia/Seoul" },
    { id: 990011, name: "Elsewhere", population: 900_000, country: "US", timezone: "America/New_York" },
    { id: 990012, name: "Big county seat", population: 700_000, code: "PPLA2" },
  ]);
  const jp = selectCities(text, [], { countries: ["JP"], minPopulation: DEFAULT_MIN_POPULATION });
  assert.equal(jp.totalRows, 12);
  assert.deepEqual(jp.cities.map((city) => city.name.en), ["Big", "Big county seat", "Edge", "Prefecture seat", "Capital"]);
  assert.deepEqual(jp.skipped, []);
  assert.deepEqual(jp.cities[0], { sourceRef: "990001", code: geonamesCityCode("JP", 990001), countryCode: "JP", name: { en: "Big" }, timezone: "Asia/Tokyo", lng: 139.5, lat: 35.5, population: 2_000_000 });
  assert.deepEqual(selectCities(text, [], { countries: ["JP", "KR"], minPopulation: 300_000 }).cities.length, 6);
  assert.deepEqual(selectCities(text, [], all).cities.length, 7);
  assert.deepEqual(selectCities(text, [], { countries: ["JP"], minPopulation: 1_000_000 }).cities.map((city) => city.name.en), ["Big", "Prefecture seat", "Capital"]);
  assert.deepEqual(selectCities(text, [], { countries: ["JP"], minPopulation: 0 }).cities.length, 7, "门槛为 0 时所有城市类型的都算");
});

test("范围内但数据不合格的行：跳过并说明原因，不影响其他行", () => {
  const selection = selectCities(
    file([
      { id: 990001 },
      { id: "x1" },
      { id: 990001, name: "Duplicate" },
      { id: 990003, country: "ZZ" },
      { id: 990004, name: " " },
      { id: 990005, name: "N".repeat(201) },
      { id: 990006, lat: "91" },
      { id: 990007, lng: "0x8B" },
      { id: 990008, lat: "" },
      { id: 990009, lat: "0", lng: "0" },
      { id: 990010, timezone: "JST" },
      { id: 990011, timezone: "" },
      { id: 990012, lat: "1e1" },
    ]) + "990013\tShort row\n",
    [],
    all,
  );
  assert.deepEqual(selection.cities.map((city) => city.sourceRef), ["990001"]);
  assert.deepEqual(
    selection.skipped.map((row) => `${row.row}：${row.reason}`),
    [
      "2：数据源编号不是数字",
      "3：数据源编号在文件里重复出现",
      "4：国家码 ZZ 不是合法的 ISO 3166-1 代码",
      "5：名称为空或超过 200 个字符",
      "6：名称为空或超过 200 个字符",
      "7：坐标缺失或超出范围（要求十进制数字）",
      "8：坐标缺失或超出范围（要求十进制数字）",
      "9：坐标缺失或超出范围（要求十进制数字）",
      "10：坐标是 (0, 0)，多半是没有填",
      "11：时区 JST 不是合法的 IANA 时区名",
      "12：时区 （空） 不是合法的 IANA 时区名",
      "13：坐标缺失或超出范围（要求十进制数字）",
      "14：这一行有 2 列，应当是 19 列",
    ],
  );
});

test("不是城市文件（空的、列数不对）、带 NUL：整份拒绝并说明", () => {
  assert.throws(() => selectCities("", [], all), (err: unknown) => err instanceof CsvError && /城市文件是空的/.test(err.message));
  assert.throws(() => selectCities("\n\n", [], all), CsvError);
  assert.throws(() => selectCities("id,name,lat\n1,Tokyo,35\n", [], all), (err: unknown) => err instanceof CsvError && /每行应当有 19 列/.test(err.message));
  assert.throws(() => selectCities(file([{ id: 990001 }, { id: 990002, name: "Bad\u0000" }]), [], all), (err: unknown) => err instanceof CsvError && /第 2 行里有 NUL/.test(err.message));
  assert.throws(() => selectCities(file([{ id: 990001 }]), ["1\t990001\tja\tだめ\u0000\n"], all), (err: unknown) => err instanceof CsvError && /名称文件的第 1 行里有 NUL/.test(err.message));
  assert.throws(() => selectCities(file([{ id: 990001 }]), ["not a names file\n"], all), (err: unknown) => err instanceof CsvError && /alternateNames/.test(err.message));
});

test("文件格式：BOM、CRLF 换行、末尾没有换行都能读", () => {
  const plain = selectCities(file([{ id: 990001 }, { id: 990002 }]), [], all);
  assert.deepEqual(selectCities(`﻿${file([{ id: 990001 }, { id: 990002 }]).replaceAll("\n", "\r\n")}`, [], all), plain);
  assert.deepEqual(selectCities(file([{ id: 990001 }, { id: 990002 }]).trimEnd(), [], all), plain);
});

test("各语言名称：数据源有的才填；简称优先于首选、首选优先于其余；历史名和俗称不取；中文优先取明确标了简体的", () => {
  const names = [
    alt(990001, "ja", "東京都", { preferred: true }),
    alt(990001, "ja", "東京", { short: true }),
    alt(990001, "ja", "江戸", { historic: true, preferred: true, short: true }),
    alt(990001, "en", "Edo", { historic: true }),
    alt(990001, "en", "Tokyo", { preferred: true }),
    alt(990001, "en", "Big T", { colloquial: true, short: true }),
    alt(990001, "zh", "東京", { preferred: true, short: true }),
    alt(990001, "zh-TW", "東京"),
    alt(990001, "zh-CN", "东京"),
    alt(990001, "ko", "동경"),
    alt(990001, "ko", "도쿄", { preferred: true }),
    alt(990001, "fr", "Tokyo"),
    alt(990001, "link", "https://en.wikipedia.org/wiki/Tokyo"),
    alt(990001, "", "Tōkyō"),
    alt(990002, "zh", "大阪"),
    alt(990002, "ja", "   "),
    alt(990002, "ko", "가".repeat(201)),
    alt(990999, "ja", "範囲外"),
    "",
  ].join("\n");
  const selection = selectCities(file([{ id: 990001, name: "Tokyo (file)" }, { id: 990002, name: "Osaka", population: 400000 }, { id: 990003, name: "Nameless", population: 350000 }]), [names], all);
  assert.deepEqual(selection.cities.map((city) => city.name), [
    { ja: "東京", zh: "东京", en: "Tokyo", ko: "도쿄" },
    { en: "Osaka", zh: "大阪" },
    { en: "Nameless" },
  ]);
  // 名称可以分在几个文件里（每个国家一个）；不给名称文件就只有英文名
  const split = selectCities(file([{ id: 990001 }, { id: 990002, population: 400000 }]), [alt(990001, "ja", "東京"), alt(990002, "ja", "大阪")], all);
  assert.deepEqual(split.cities.map((city) => city.name.ja), ["東京", "大阪"]);
  assert.deepEqual(selectCities(file([{ id: 990001, name: "Tokyo" }]), [], all).cities[0]?.name, { en: "Tokyo" });
});

const existing = (overrides: Partial<ExistingCity> & { code: string }): ExistingCity => ({
  id: `id-${overrides.code}`,
  countryCode: "JP",
  name: { en: "Somewhere" },
  timezone: "Asia/Tokyo",
  lng: 139.5,
  lat: 35.5,
  sourceRef: null,
  sourceOverridden: false,
  ...overrides,
});

test("导入计划：库里没有的新增；同一批文件再来一次什么都不用做", () => {
  const selection = selectCities(file([{ id: 990001, name: "Alpha" }, { id: 990002, name: "Beta", lat: "34.5" }]), [alt(990001, "ja", "アルファ")], all);
  const first = planCityImport([], selection);
  assert.deepEqual(first.creates.map((city) => city.name.en), ["Alpha", "Beta"]);
  assert.deepEqual([first.updates, first.unchanged, first.keptManual, first.conflicts], [[], [], [], []]);
  const stored = selection.cities.map((city) => existing({ code: city.code, sourceRef: city.sourceRef, name: city.name, lng: city.lng, lat: city.lat }));
  const second = planCityImport(stored, selection);
  assert.deepEqual(second.unchanged.sort(), selection.cities.map((city) => city.code).sort());
  assert.deepEqual([second.creates, second.updates, second.keptManual, second.conflicts], [[], [], [], []]);
});

test("导入计划：数据源里名称、时区、坐标变了的更新，平台另外补的语言保留；平台改过的不覆盖", () => {
  const selection = selectCities(
    file([
      { id: 990001, name: "Renamed" },
      { id: 990002, name: "Moved", lat: "36.1" },
      { id: 990003, name: "Rezoned", timezone: "Asia/Seoul" },
      { id: 990004, name: "Source name" },
      { id: 990005, name: "Same" },
    ]),
    [alt(990001, "ja", "新しい名前")],
    all,
  );
  const code = (id: number): string => geonamesCityCode("JP", id);
  const plan = planCityImport(
    [
      existing({ code: code(990001), sourceRef: "990001", name: { en: "Old", zh: "平台补的中文名" } }),
      existing({ code: code(990002), sourceRef: "990002", name: { en: "Moved" } }),
      existing({ code: code(990003), sourceRef: "990003", name: { en: "Rezoned" } }),
      existing({ code: code(990004), sourceRef: "990004", name: { en: "平台改的名字" }, sourceOverridden: true }),
      existing({ code: code(990005), sourceRef: "990005", name: { en: "Same", ko: "평台" }, sourceOverridden: true }),
    ],
    selection,
  );
  assert.deepEqual(plan.updates.map((update) => [update.code, update.before, update.after]), [
    [code(990001), { name: { en: "Old", zh: "平台补的中文名" }, timezone: "Asia/Tokyo", lng: 139.5, lat: 35.5 }, { name: { en: "Renamed", zh: "平台补的中文名", ja: "新しい名前" }, timezone: "Asia/Tokyo", lng: 139.5, lat: 35.5 }],
    [code(990002), { name: { en: "Moved" }, timezone: "Asia/Tokyo", lng: 139.5, lat: 35.5 }, { name: { en: "Moved" }, timezone: "Asia/Tokyo", lng: 139.5, lat: 36.1 }],
    [code(990003), { name: { en: "Rezoned" }, timezone: "Asia/Tokyo", lng: 139.5, lat: 35.5 }, { name: { en: "Rezoned" }, timezone: "Asia/Seoul", lng: 139.5, lat: 35.5 }],
  ]);
  assert.deepEqual(plan.keptManual, [code(990004)]);
  assert.deepEqual(plan.unchanged, [code(990005)], "平台改过但和数据源一致的（多出来的语言不算不同），算没有变化");
});

test("导入计划：和手工建的城市看起来相同（同国、名称相同或相距不到 5 公里）——不合并也不重复创建，列为需要人工处理", () => {
  const selection = selectCities(
    file([
      { id: 990001, name: "Tokyo", lat: "35.6895", lng: "139.6917" },
      { id: 990002, name: "Osaka", lat: "34.6938", lng: "135.5011" },
      { id: 990003, name: "Nagoya", lat: "35.1815", lng: "136.9064" },
      { id: 990004, name: "Sapporo", lat: "43.0667", lng: "141.35" },
      { id: 990005, name: "Seoul", lat: "37.566", lng: "126.9784", country: "KR", timezone: "Asia/Seoul" },
      { id: 990006, name: "Fukuoka", lat: "33.6", lng: "130.4167" },
    ]),
    [alt(990002, "ja", "大阪市"), alt(990003, "zh-CN", "名古屋")],
    all,
  );
  const plan = planCityImport(
    [
      existing({ code: "CTY-JP-TYO", name: { zh: "东京", en: "tokyo " }, lat: 35.0, lng: 139.0 }),
      existing({ code: "CTY-JP-OSA", name: { zh: "大阪" }, lat: 34.70, lng: 135.50 }),
      existing({ code: "CTY-JP-NGO", name: { ja: "名古屋" }, lat: 30, lng: 130 }),
      existing({ code: "CTY-JP-FAR", name: { zh: "别的城市" }, lat: 43.2, lng: 141.35 }),
      existing({ code: "CTY-KR-SEL", countryCode: "KR", name: { en: "Fukuoka" }, lat: 33.6, lng: 130.4167, timezone: "Asia/Seoul" }),
    ],
    selection,
  );
  assert.deepEqual(plan.conflicts.map((conflict) => [conflict.label.split("（")[0], /CTY-[A-Z]{2}-[A-Z]+/.exec(conflict.reason)?.[0]]), [
    ["Tokyo", "CTY-JP-TYO"],
    ["Osaka", "CTY-JP-OSA"],
    ["Nagoya", "CTY-JP-NGO"],
  ]);
  assert.match(plan.conflicts[0]?.reason ?? "", /看起来相同的城市 CTY-JP-TYO.*没有合并也没有重复创建/);
  assert.deepEqual(plan.creates.map((city) => city.name.en).sort(), ["Fukuoka", "Sapporo", "Seoul"], "名称、距离都对不上的，以及别的国家同名同地的，照常新增");
  assert.deepEqual(plan.updates, []);
});

test("导入计划：导入要用的编码已被别的城市占用、数据源里城市的国家变了——只列出来，不动", () => {
  const selection = selectCities(file([{ id: 990001, name: "Alpha" }, { id: 990002, name: "Beta", country: "KR", timezone: "Asia/Seoul" }]), [], all);
  const plan = planCityImport(
    [
      existing({ code: geonamesCityCode("JP", 990001), name: { zh: "手工占了这个编码" }, lat: 10, lng: 100 }),
      existing({ code: geonamesCityCode("JP", 990002), sourceRef: "990002", name: { en: "Beta" } }),
    ],
    selection,
  );
  assert.deepEqual([plan.creates, plan.updates], [[], []]);
  assert.match(plan.conflicts[0]?.reason ?? "", /编码已被库里另一个城市使用/);
  assert.match(plan.conflicts[1]?.reason ?? "", /国家由 JP 变成了 KR/);
});

test("最近的城市：只要范围以内的，由近到远，最多给几个；坐标不合法的忽略", () => {
  const haneda = { lat: 35.549678, lng: 139.786958 };
  const cities = [
    { id: "tokyo", lat: 35.6895, lng: 139.69171 },
    { id: "kawasaki", lat: 35.52056, lng: 139.71722 },
    { id: "yokohama", lat: 35.43333, lng: 139.65 },
    { id: "chiba", lat: 35.6, lng: 140.11667 },
    { id: "osaka", lat: 34.69379, lng: 135.50107 },
    { id: "broken", lat: 95, lng: 139 },
  ];
  const near = nearestWithin(haneda, cities, CITY_SUGGESTION_MAX_KM * 1000, 3);
  assert.deepEqual(near.map((entry) => entry.item.id), ["kawasaki", "tokyo", "yokohama"], "羽田离川崎比离东京近：所以要给出几个候选让人确认");
  assert.ok(near[0] && near[0].meters > 6_000 && near[0].meters < 8_000);
  assert.ok(near[1] && near[1].meters > 16_000 && near[1].meters < 19_000);
  assert.deepEqual(nearestWithin(haneda, cities, CITY_SUGGESTION_MAX_KM * 1000, 10).map((entry) => entry.item.id), ["kawasaki", "tokyo", "yokohama", "chiba"]);
  assert.deepEqual(nearestWithin(haneda, cities, 5_000, 3), []);
  assert.deepEqual(nearestWithin(haneda, [], 80_000, 3), []);
  assert.deepEqual(nearestWithin({ lat: 200, lng: 0 }, cities, 80_000, 3), []);
  // 成田到东京中心约 58 公里，在 80 公里的范围内
  const narita = nearestWithin({ lat: 35.76858, lng: 140.388714 }, [cities[0] as { id: string; lat: number; lng: number }], CITY_SUGGESTION_MAX_KM * 1000, 1);
  assert.ok(narita[0] && narita[0].meters > 55_000 && narita[0].meters < 66_000);
  assert.equal(CITY_SUGGESTION_MAX_KM, 80);
});
