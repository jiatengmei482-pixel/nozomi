import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { ExistingAirportNames } from "./geonames-airports.ts";
import { REVIEWED_AIRPORT_NAMES_SOURCE, planReviewedAirportNames, readReviewedAirportNames } from "./reviewed-airport-names.ts";

const airport = (overrides: Partial<ExistingAirportNames>): ExistingAirportNames => ({
  id: "id-" + (overrides.code ?? "HND"),
  code: "HND",
  countryCode: "JP",
  name: { en: "Tokyo Haneda International Airport", ja: "東京国際空港" },
  lat: 35.55,
  lng: 139.78,
  nameSources: {},
  searchNames: [],
  ...overrides,
});

const table = (airports: unknown[]): unknown => ({ airports });

test("读核对表：合格的原样读出", () => {
  const { entries, issues } = readReviewedAirportNames(table([{ code: "HND", country: "JP", names: { zh: "东京国际机场" }, sources: { zh: "GeoNames 繁体转简体" } }]));
  assert.deepEqual(issues, []);
  assert.deepEqual(entries, [{ code: "HND", country: "JP", names: { zh: "东京国际机场" }, sources: { zh: "GeoNames 繁体转简体" } }]);
});

test("读核对表：有一条不合格整张不用，问题全列出来", () => {
  const { entries, issues } = readReviewedAirportNames(
    table([
      { code: "ICN", country: "KR", names: { zh: "仁川國際機場" }, sources: { zh: "维基数据" } },
      { code: "hnd", country: "JP", names: { zh: "东京" }, sources: { zh: "x" } },
      { code: "NRT", country: "JP", names: { zh: "成田国际机场" } },
      { code: "KIX", country: "JP", names: { ko: "간사이" }, sources: { ko: "x" } },
      { code: "ITM", country: "JP", names: { ja: "Osaka" }, sources: { ja: "x" } },
      { code: "NGO", country: "JP", names: { zh: " 中部国际机场" }, sources: { zh: "x" } },
      { code: "NGO", country: "JP", names: { zh: "中部国际机场" }, sources: { zh: "x" } },
      { code: "CTS", country: "Japan", names: { zh: "新千岁机场" }, sources: { zh: "x" } },
    ]),
  );
  assert.deepEqual(entries, []);
  assert.deepEqual(
    issues.map((issue) => [issue.index, issue.problem]),
    [
      [1, "NOT_SIMPLIFIED"],
      [2, "CODE_FORMAT"],
      [3, "NO_SOURCE"],
      [3, "NOTHING_TO_FILL"],
      [4, "UNKNOWN_LANGUAGE"],
      [4, "NOTHING_TO_FILL"],
      [5, "NOT_JAPANESE"],
      [6, "NAME_FORMAT"],
      [6, "NOTHING_TO_FILL"],
      [7, "DUPLICATE"],
      [8, "COUNTRY_FORMAT"],
    ],
  );
  assert.deepEqual(issues[0], { index: 1, code: "ICN", problem: "NOT_SIMPLIFIED", language: "zh", text: "仁川國際機場", chars: "國際機場" });
  assert.deepEqual(readReviewedAirportNames({}).issues, [{ index: 0, code: null, problem: "NO_LIST" }]);
});

test("只填空着的语言：已有的不改、不同的列出来；来源记进 name_sources", () => {
  const plan = planReviewedAirportNames(
    [airport({}), airport({ code: "NRT", name: { en: "Narita", ja: "成田国際空港", zh: "成田国际机场" } }), airport({ code: "KIX", name: { en: "Kansai", zh: "关西机场" } })],
    [
      { code: "HND", country: "JP", names: { zh: "东京国际机场", ja: "羽田空港" }, sources: { zh: "转简体", ja: "维基数据" } },
      { code: "NRT", country: "JP", names: { zh: "成田国际机场" }, sources: { zh: "维基数据" } },
      { code: "KIX", country: "JP", names: { zh: "关西国际机场", ja: "関西国際空港" }, sources: { zh: "维基数据", ja: "维基数据" } },
    ],
    ["JP"],
  );
  assert.deepEqual(
    plan.fills.map((fill) => [fill.code, fill.languages, fill.after]),
    [
      ["HND", ["zh"], { en: "Tokyo Haneda International Airport", ja: "東京国際空港", zh: "东京国际机场" }],
      ["KIX", ["ja"], { en: "Kansai", zh: "关西机场", ja: "関西国際空港" }],
    ],
  );
  assert.deepEqual(plan.fills[0]?.nameSources, { zh: { source: REVIEWED_AIRPORT_NAMES_SOURCE, ref: "转简体", text: "东京国际机场" } });
  assert.deepEqual(plan.unchanged, ["NRT"]);
  assert.deepEqual(plan.keptFilled, [
    { code: "HND", language: "ja", current: "東京国際空港", incoming: "羽田空港" },
    { code: "KIX", language: "zh", current: "关西机场", incoming: "关西国际机场" },
  ]);
});

test("平台删掉的不补回去；库里没有的、别的国家的、国家对不上的分别处理；运行两次第二次没事做", () => {
  const existing = [
    airport({ name: { en: "Haneda" }, nameSources: { zh: { source: "geonames", ref: "1", text: "东京国际机场" } } }),
    airport({ code: "ICN", countryCode: "JP", name: { en: "Incheon" } }),
  ];
  const entries = [
    { code: "HND", country: "JP", names: { zh: "东京国际机场" }, sources: { zh: "x" } },
    { code: "ICN", country: "KR", names: { zh: "仁川国际机场" }, sources: { zh: "x" } },
    { code: "XXX", country: "JP", names: { zh: "不存在机场" }, sources: { zh: "x" } },
  ];
  const plan = planReviewedAirportNames(existing, entries, ["JP", "KR"]);
  assert.deepEqual(plan.keptCleared, [{ code: "HND", language: "zh", incoming: "东京国际机场" }]);
  assert.deepEqual(plan.conflicts.map((conflict) => conflict.code), ["ICN"]);
  assert.deepEqual(plan.notInDatabase, ["XXX"]);
  assert.deepEqual(plan.fills, []);
  assert.deepEqual(planReviewedAirportNames(existing, entries, ["KR"]).conflicts.map((conflict) => conflict.code), ["ICN"]);
  assert.deepEqual(planReviewedAirportNames(existing, entries, ["CN"]), { fills: [], unchanged: [], keptFilled: [], keptCleared: [], conflicts: [], notInDatabase: [] });

  const fresh = [airport({ name: { en: "Haneda" } })];
  const first = planReviewedAirportNames(fresh, entries, ["JP"]);
  assert.equal(first.fills.length, 1);
  const after = [airport({ name: first.fills[0]?.after ?? {}, nameSources: first.fills[0]?.nameSources ?? {} })];
  const second = planReviewedAirportNames(after, entries, ["JP"]);
  assert.deepEqual(second.fills, []);
  assert.deepEqual(second.unchanged, ["HND"]);
});

test("仓库里的核对表合格：每条有来源、简体名没有繁体字形、业主确认的 21 个都在", async () => {
  const raw = JSON.parse(await readFile(new URL("../../../apps/api/masterdata/airport-names-reviewed.json", import.meta.url), "utf8")) as unknown;
  const { entries, issues } = readReviewedAirportNames(raw);
  assert.deepEqual(issues, []);
  const zh = new Map(entries.map((entry) => [entry.code, entry.names.zh]));
  const approved: Record<string, string> = { AKJ: "旭川机场", ASJ: "奄美机场", FUJ: "福江机场", GAJ: "山形机场", HND: "东京国际机场", IWJ: "石见机场", KIJ: "新潟机场", KKJ: "北九州机场", KUM: "屋久岛机场", MMY: "宫古机场", MSJ: "三泽机场", MYJ: "松山机场", NGO: "中部国际机场", NKM: "名古屋机场", NTQ: "能登机场", OIR: "奥尻机场", RSU: "丽水机场", SDS: "佐渡机场", SHB: "中标津机场", UKB: "神户机场", YGJ: "米子机场" };
  for (const [code, name] of Object.entries(approved)) assert.equal(zh.get(code), name, code);
});
