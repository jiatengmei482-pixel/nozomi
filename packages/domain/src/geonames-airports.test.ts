import { test } from "node:test";
import assert from "node:assert/strict";
import { CsvError } from "./csv.ts";
import {
  type AirportNameSelection,
  type ExistingAirportNames,
  SAME_AIRPORT_DISTANCE_METERS,
  looksTraditionalChinese,
  planAirportNameImport,
  selectAirportNames,
} from "./geonames-airports.ts";
import { geonamesCountryFile } from "./geonames.ts";

/** 下面的记录都是为测试编的（编号用 99 开头的大数、三字码用 Q 开头），格式和 GeoNames 的 <国家码>.txt 一样：19 列、制表符分隔。 */
interface Feature {
  id: number | string;
  name?: string;
  cls?: string;
  code?: string;
  country?: string;
  lat?: string;
  lng?: string;
}

function featureLine(row: Feature): string {
  return [
    row.id, row.name ?? `Test Airport ${row.id}`, "ascii", "", row.lat ?? "35.5", row.lng ?? "139.5", row.cls ?? "S", row.code ?? "AIRP", row.country ?? "JP",
    "", "12", "", "", "", "0", "", "40", "Asia/Tokyo", "2026-01-01",
  ].join("\t");
}

const countryFile = (rows: Feature[]): string => `${rows.map(featureLine).join("\n")}\n`;

interface Alt {
  nameId?: number;
  id: number | string;
  tag: string;
  name: string;
  preferred?: boolean;
  short?: boolean;
  colloquial?: boolean;
  historic?: boolean;
}

let nextNameId = 1;
function altLine(row: Alt): string {
  const flag = (value: boolean | undefined): string => (value ? "1" : "");
  return [row.nameId ?? nextNameId++, row.id, row.tag, row.name, flag(row.preferred), flag(row.short), flag(row.colloquial), flag(row.historic), "", ""].join("\t");
}

const namesFile = (rows: Alt[]): string => `${rows.map(altLine).join("\n")}\n`;

function select(features: Feature[], names: Alt[], countries: string[] = ["JP"]): AirportNameSelection {
  return selectAirportNames([countryFile(features)], [namesFile(names)], countries);
}

test("下载地址：国家的全部地理名称记录是 export/dump/<国家码>.zip", () => {
  assert.deepEqual(geonamesCountryFile("JP"), { url: "https://download.geonames.org/export/dump/JP.zip", entry: "JP.txt" });
});

test("只认类型是机场（S / AIRP）的记录：同一个三字码挂在城市、街区上的不算", () => {
  const selection = select(
    [{ id: 990001, name: "Test Narita Airport" }, { id: 990002, name: "Test Narita City", cls: "P", code: "PPLA2" }, { id: 990003, name: "Test Haneda", cls: "P", code: "PPLX" }],
    [
      { id: 990001, tag: "iata", name: "QNR" },
      { id: 990001, tag: "ja", name: "テスト成田空港" },
      { id: 990002, tag: "iata", name: "QNR" },
      { id: 990002, tag: "ja", name: "テスト成田市" },
      { id: 990003, tag: "iata", name: "QHN" },
    ],
  );
  assert.equal(selection.totalAirports, 1);
  assert.deepEqual(selection.ambiguous, []);
  assert.deepEqual(selection.airports.map((airport) => [airport.iata, airport.sourceRef, airport.names.ja]), [["QNR", "990001", "テスト成田空港"]]);
});

test("多语言：只取日文和中文；英文、韩文和其他语言、链接、ICAO 代码都不取", () => {
  const selection = select([{ id: 990010 }], [
    { id: 990010, tag: "iata", name: "QAA" },
    { id: 990010, tag: "icao", name: "RJQA" },
    { id: 990010, tag: "en", name: "Test Alpha Airport" },
    { id: 990010, tag: "ko", name: "테스트 공항" },
    { id: 990010, tag: "link", name: "https://example.invalid/QAA" },
    { id: 990010, tag: "ja", name: "テスト甲空港" },
    { id: 990010, tag: "zh-CN", name: "测试甲机场" },
    { id: 990010, tag: "yue", name: "测试甲机场粤" },
  ]);
  assert.deepEqual(selection.airports[0]?.names, { ja: "テスト甲空港", zh: "测试甲机场" });
});

test("首选名：「首选的简称」>「简称」>「首选」> 其余；都一样时取数据源里编号最小的那条，和文件里的顺序无关", () => {
  const ja = (rows: Alt[]): string | undefined => select([{ id: 990020 }], [{ id: 990020, tag: "iata", name: "QBB" }, ...rows]).airports[0]?.names.ja;
  assert.equal(ja([{ id: 990020, tag: "ja", name: "普通名" }, { id: 990020, tag: "ja", name: "首选名", preferred: true }]), "首选名");
  assert.equal(ja([{ id: 990020, tag: "ja", name: "首选名", preferred: true }, { id: 990020, tag: "ja", name: "简称名", short: true }]), "简称名");
  assert.equal(ja([{ id: 990020, tag: "ja", name: "简称名", short: true }, { id: 990020, tag: "ja", name: "首选简称", preferred: true, short: true }]), "首选简称");
  assert.equal(ja([{ nameId: 9_000_002, id: 990020, tag: "ja", name: "後の名前" }, { nameId: 9_000_001, id: 990020, tag: "ja", name: "先の名前" }]), "先の名前");
});

test("日文名必须有汉字或假名、中文名必须有汉字：数据源里标成 ja 的罗马字不要", () => {
  const selection = select([{ id: 990030 }], [
    { id: 990030, tag: "iata", name: "QCC" },
    { nameId: 1, id: 990030, tag: "ja", name: "Tesuto Kokusai Kūkō" },
    { nameId: 2, id: 990030, tag: "ja", name: "テスト国際空港" },
  ]);
  assert.equal(selection.airports[0]?.names.ja, "テスト国際空港");
  const romanOnly = select([{ id: 990031 }], [{ id: 990031, tag: "iata", name: "QCD" }, { id: 990031, tag: "ja", name: "Tesuto Kūkō" }]);
  assert.deepEqual(romanOnly.airports[0]?.names, {});
  const mixed = select([{ id: 990032 }], [{ id: 990032, tag: "iata", name: "QCE" }, { id: 990032, tag: "ja", name: "テストT2空港" }, { id: 990032, tag: "zh-CN", name: "Test 2" }]);
  assert.deepEqual(mixed.airports[0]?.names, { ja: "テストT2空港" }, "夹着字母、数字的照样取；中文名里没有汉字的不要");
});

test("中文：zh-CN > zh-Hans > zh-SG > zh；繁体（zh-Hant / zh-TW / zh-HK，或者标成 zh 却是繁体字）不要", () => {
  const zh = (rows: Alt[]): { zh: string | undefined; traditionalOnly: boolean | undefined } => {
    const airport = select([{ id: 990040 }], [{ id: 990040, tag: "iata", name: "QDD" }, ...rows]).airports[0];
    return { zh: airport?.names.zh, traditionalOnly: airport?.traditionalOnly };
  };
  assert.deepEqual(zh([{ id: 990040, tag: "zh", name: "测试机场" }, { id: 990040, tag: "zh-Hans", name: "测试汉机场" }, { id: 990040, tag: "zh-CN", name: "测试中机场" }]), { zh: "测试中机场", traditionalOnly: false });
  assert.deepEqual(zh([{ id: 990040, tag: "zh", name: "测试机场" }, { id: 990040, tag: "zh-SG", name: "测试新机场" }]), { zh: "测试新机场", traditionalOnly: false });
  assert.deepEqual(zh([{ id: 990040, tag: "zh", name: "测试国际机场" }]), { zh: "测试国际机场", traditionalOnly: false }, "只标了 zh、是简体的照样取");
  assert.deepEqual(zh([{ id: 990040, tag: "zh", name: "測試國際機場" }, { id: 990040, tag: "zh-Hant", name: "測試機場" }, { id: 990040, tag: "zh-TW", name: "測試台機場" }]), { zh: undefined, traditionalOnly: true }, "只有繁体：中文名不填，并标明原因");
  assert.deepEqual(zh([{ id: 990040, tag: "zh", name: "測試國際機場" }, { id: 990040, tag: "zh", name: "测试国际机场" }]), { zh: "测试国际机场", traditionalOnly: false }, "繁简都有：取简体");
  assert.deepEqual(zh([{ id: 990040, tag: "zh-HK", name: "測試機場" }]), { zh: undefined, traditionalOnly: false }, "zh-HK 不算中文的候选");
});

test("繁体专用字的判断：机场名里常见的繁体字认得出，简体和日文汉字不误判", () => {
  for (const text of ["東京國際機場", "松本機場", "札幌飛行場", "稚內機場", "神戶機場"]) assert.equal(looksTraditionalChinese(text), true, text);
  for (const text of ["东京国际机场", "成田国际机场", "稚内机场", "福冈机场", "新千岁机场", "与论机场"]) assert.equal(looksTraditionalChinese(text), false, text);
});

test("空值：空白、不可见字符、超过 200 字的名称当作没有；历史名称和俗称不取；没有三字码的机场只计数", () => {
  const selection = select([{ id: 990050 }, { id: 990051 }], [
    { id: 990050, tag: "iata", name: "QEE" },
    { id: 990050, tag: "ja", name: "   " },
    { id: 990050, tag: "ja", name: "​" },
    { id: 990050, tag: "ja", name: "長".repeat(201) },
    { id: 990050, tag: "ja", name: "旧テスト空港", historic: true },
    { id: 990050, tag: "zh-CN", name: "俗称机场", colloquial: true },
    { id: 990050, tag: "zh-CN", name: "" },
    { id: 990051, tag: "ja", name: "三字码なし空港" },
  ]);
  assert.deepEqual(selection.airports.map((airport) => [airport.iata, airport.names]), [["QEE", {}]]);
  assert.equal(selection.withoutIata, 1);
});

test("重复：同一个三字码挂在两个机场记录上，分不清，两个都不用；同一个名称重复出现不影响", () => {
  const selection = select([{ id: 990060 }, { id: 990061 }, { id: 990062 }], [
    { id: 990060, tag: "iata", name: "QFF" },
    { id: 990061, tag: "iata", name: "QFF" },
    { id: 990062, tag: "iata", name: "QGG" },
    { id: 990062, tag: "iata", name: "QGG" },
    { id: 990062, tag: "ja", name: "テスト乙空港" },
    { id: 990062, tag: "ja", name: "テスト乙空港" },
  ]);
  assert.deepEqual(selection.ambiguous, [{ iata: "QFF", refs: ["990060", "990061"] }]);
  assert.deepEqual(selection.airports.map((airport) => [airport.iata, airport.names.ja]), [["QGG", "テスト乙空港"]]);
});

test("三字码：历史上的、格式不对的不算；只看所选国家；国家文件里重复的编号和坏坐标跳过并说明", () => {
  const selection = select(
    [{ id: 990070 }, { id: 990071, country: "KR" }, { id: 990072, lat: "abc" }, { id: 990070, name: "Duplicate" }],
    [
      { id: 990070, tag: "iata", name: "QHH" },
      { id: 990070, tag: "iata", name: "QOL", historic: true },
      { id: 990070, tag: "iata", name: "Q1" },
      { id: 990071, tag: "iata", name: "QKR" },
      { id: 990072, tag: "iata", name: "QBD" },
    ],
  );
  assert.deepEqual(selection.airports.map((airport) => airport.iata), ["QHH"]);
  assert.deepEqual(selection.skipped.map((row) => [row.row, row.reason]), [[3, "坐标缺失或超出范围（要求十进制数字）"], [4, "数据源编号在文件里重复出现"]]);
});

test("文件格式不对整份拒绝：国家文件列数不对、有 NUL 字符；名称文件少于 4 列", () => {
  assert.throws(() => selectAirportNames(["a,b,c\n"], [], ["JP"]), CsvError);
  assert.throws(() => selectAirportNames([`${featureLine({ id: 990080 })}\n${featureLine({ id: 990081, name: "Bad\u0000" })}\n`], [], ["JP"]), /NUL/);
  assert.throws(() => selectAirportNames([countryFile([{ id: 990080 }])], ["990080\tiata\n"], ["JP"]), /alternateNames/);
  assert.throws(() => selectAirportNames([""], [], ["JP"]), /国家文件是空的/);
});

// ---- 和库里的机场比较 ----

const SOURCE: AirportNameSelection = select(
  [{ id: 990100, lat: "35.765", lng: "140.386" }, { id: 990101, lat: "35.553", lng: "139.781" }, { id: 990102, country: "KR", lat: "37.46", lng: "126.44" }],
  [
    { id: 990100, tag: "iata", name: "QNA" },
    { id: 990100, tag: "ja", name: "テスト成田国際空港" },
    { id: 990100, tag: "zh-CN", name: "测试成田国际机场" },
    { id: 990101, tag: "iata", name: "QHA" },
    { id: 990101, tag: "ja", name: "テスト東京国際空港" },
    { id: 990101, tag: "zh", name: "測試東京國際機場" },
    { id: 990102, tag: "iata", name: "QIC" },
    { id: 990102, tag: "ja", name: "テスト仁川空港" },
  ],
  ["JP", "KR"],
);

function existing(overrides: Partial<ExistingAirportNames> & { code: string }): ExistingAirportNames {
  return { id: `id-${overrides.code}`, countryCode: "JP", name: { en: `${overrides.code} Airport` }, lat: 35.765, lng: 140.386, nameSources: {}, ...overrides };
}

test("只填空着的语言：已经有的不改；记下是从哪条数据填的", () => {
  const plan = planAirportNameImport(
    [existing({ code: "QNA" }), existing({ code: "QHA", lat: 35.553, lng: 139.781, name: { en: "QHA Airport", ja: "平台填的名字" } })],
    SOURCE,
    ["JP"],
    "geonames",
  );
  assert.deepEqual(plan.fills, [
    {
      id: "id-QNA",
      code: "QNA",
      sourceRef: "990100",
      languages: ["ja", "zh"],
      before: { en: "QNA Airport" },
      after: { en: "QNA Airport", ja: "テスト成田国際空港", zh: "测试成田国际机场" },
      nameSources: { ja: { source: "geonames", ref: "990100", text: "テスト成田国際空港" }, zh: { source: "geonames", ref: "990100", text: "测试成田国际机场" } },
    },
  ]);
  assert.deepEqual(plan.keptFilled, [{ code: "QHA", language: "ja", current: "平台填的名字", incoming: "テスト東京国際空港", importedBefore: false }]);
  assert.deepEqual(plan.traditionalOnly, ["QHA"], "中文名空着、数据源只有繁体：列出来");
  assert.deepEqual(plan.unchanged, ["QHA"]);
});

test("可重复运行：把这次要填的写进去之后再比较一次，什么都不用做", () => {
  const before = [existing({ code: "QNA" })];
  const first = planAirportNameImport(before, SOURCE, ["JP"], "geonames");
  const fill = first.fills[0];
  assert.ok(fill);
  const second = planAirportNameImport([{ ...(before[0] as ExistingAirportNames), name: fill.after, nameSources: fill.nameSources }], SOURCE, ["JP"], "geonames");
  assert.deepEqual(second.fills, []);
  assert.deepEqual(second.unchanged, ["QNA"]);
  assert.deepEqual(second.keptFilled, []);
});

test("不覆盖人工修改：导入填过、平台改了的不覆盖；导入填过、平台删掉的不补回去；空白当作空着", () => {
  const sources = { ja: { source: "geonames", ref: "990100", text: "テスト成田国際空港" }, zh: { source: "geonames", ref: "990100", text: "测试成田国际机场" } };
  const plan = planAirportNameImport([existing({ code: "QNA", name: { en: "QNA Airport", ja: "平台改的名字", zh: " " }, nameSources: sources })], SOURCE, ["JP"], "geonames");
  assert.deepEqual(plan.fills, []);
  assert.deepEqual(plan.keptFilled, [{ code: "QNA", language: "ja", current: "平台改的名字", incoming: "テスト成田国際空港", importedBefore: false }]);
  assert.deepEqual(plan.keptCleared, [{ code: "QNA", language: "zh", incoming: "测试成田国际机场" }]);
  const changedUpstream = planAirportNameImport(
    [existing({ code: "QNA", name: { en: "QNA Airport", ja: "旧的导入名", zh: "测试成田国际机场" }, nameSources: { ...sources, ja: { source: "geonames", ref: "990100", text: "旧的导入名" } } })],
    SOURCE,
    ["JP"],
    "geonames",
  );
  assert.deepEqual(changedUpstream.keptFilled, [{ code: "QNA", language: "ja", current: "旧的导入名", incoming: "テスト成田国際空港", importedBefore: true }], "数据源后来改了名：只填空着的，不更新");
});

test("对不上的交给人：坐标相差超过 10 公里、国家不同、三字码有歧义；数据源里没有的、不在所选国家里的分开列", () => {
  const far = existing({ code: "QNA", lat: 35.765 + (SAME_AIRPORT_DISTANCE_METERS + 1_000) / 111_000 });
  const elsewhere = existing({ code: "QIC", countryCode: "JP", lat: 37.46, lng: 126.44 });
  const missing = existing({ code: "QZZ" });
  const otherCountry = existing({ code: "QKR", countryCode: "KR" });
  const ambiguous = select([{ id: 990110 }, { id: 990111 }], [{ id: 990110, tag: "iata", name: "QAM" }, { id: 990111, tag: "iata", name: "QAM" }]);
  const plan = planAirportNameImport([far, elsewhere, missing, otherCountry], SOURCE, ["JP"], "geonames");
  assert.deepEqual(plan.conflicts.map((conflict) => conflict.code), ["QIC", "QNA"]);
  assert.match(plan.conflicts[1]?.reason ?? "", /坐标相差约 11 公里/);
  assert.match(plan.conflicts[0]?.reason ?? "", /在 KR，库里的在 JP/);
  assert.deepEqual(plan.notFound, ["QZZ"]);
  assert.deepEqual(plan.fills, []);
  const unclear = planAirportNameImport([existing({ code: "QAM" })], ambiguous, ["JP"], "geonames");
  assert.match(unclear.conflicts[0]?.reason ?? "", /2 个机场记录都用这个三字码（990110、990111）/);
  const near = planAirportNameImport([existing({ code: "QNA", lat: 35.765 + 5_000 / 111_000 })], SOURCE, ["JP"], "geonames");
  assert.equal(near.fills.length, 1, "相差 5 公里以内照样填");
});
