import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  type ExistingPlaceContent,
  REVIEWED_AIRPORT_TERMINALS_SOURCE,
  planReviewedAirportTerminals,
  readReviewedAirportTerminals,
} from "./reviewed-airport-terminals.ts";

const ADDRESS = { text: "〒144-0041 東京都大田区羽田空港3-3-2", source: "羽田机场官网「交通」页" };
const T1 = {
  suffix: "T1",
  names: { ja: "第1ターミナル", zh: "第1航站楼", en: "Terminal 1" },
  lat: 35.548,
  lng: 139.7845,
  coordSource: "维基数据 Q1（CC0）",
  flightScope: "domestic",
  meetingPoint: { zh: "1 楼到达大厅", ja: "1階到着ロビー" },
  sources: ["羽田机场官网"],
};
const T3 = { ...T1, suffix: "T3", names: { ja: "第3ターミナル", zh: "第3航站楼", en: "Terminal 3" }, lat: 35.5437, lng: 139.7686, flightScope: "international", meetingPoint: { zh: "2 楼到达大厅", source: "羽田机场官网 T3 页" }, address: { text: "〒144-0041 東京都大田区羽田空港2-6-5", source: "羽田机场官网" } };
const HND = { code: "HND", country: "JP", address: ADDRESS, terminals: [T1, T3] };
const UKB = { code: "UKB", country: "JP", address: { text: "〒650-0048 兵庫県神戸市中央区神戸空港1", source: "神户机场官网" }, meetingPoint: { zh: "1 楼到达口", source: "神户机场官网" } };

const table = (airports: unknown[]): unknown => ({ description: "测试", airports });

const place = (overrides: Partial<ExistingPlaceContent>): ExistingPlaceContent => ({
  id: `id-${overrides.code ?? "HND"}`,
  code: "HND",
  countryCode: "JP",
  parentId: null,
  cityId: "city-1",
  status: "active",
  lat: 35.553333,
  lng: 139.781111,
  name: { ja: "東京国際空港" },
  nameSources: {},
  address: null,
  meetingPoint: null,
  contentSources: {},
  ...overrides,
});

test("读核对表：合格的读出来；集合地点的来源没写时用航站楼的 sources；坐标取 6 位", () => {
  const { entries, issues } = readReviewedAirportTerminals(table([HND, UKB]));
  assert.deepEqual(issues, []);
  assert.equal(entries.length, 2);
  const hnd = entries[0]!;
  assert.deepEqual([hnd.code, hnd.address, hnd.meetingPoint], ["HND", ADDRESS, null]);
  assert.deepEqual(hnd.terminals.map((terminal) => terminal.code), ["HND-T1", "HND-T3"]);
  assert.deepEqual(hnd.terminals[0]?.meetingPoint, { text: { zh: "1 楼到达大厅", ja: "1階到着ロビー" }, source: "羽田机场官网" });
  assert.deepEqual(hnd.terminals[1]?.meetingPoint, { text: { zh: "2 楼到达大厅" }, source: "羽田机场官网 T3 页" });
  assert.equal(hnd.terminals[0]?.address, null);
  assert.equal(hnd.terminals[1]?.flightScope, "international");
  assert.deepEqual(entries[1]?.meetingPoint, { text: { zh: "1 楼到达口" }, source: "神户机场官网" });
  assert.deepEqual(entries[1]?.terminals, []);
  assert.deepEqual(readReviewedAirportTerminals(table([])), { entries: [], issues: [] });
});

test("读核对表：有一处不合格整张不用，问题全列出来", () => {
  const { entries, issues } = readReviewedAirportTerminals(
    table([
      { ...HND, code: "hnd" },
      { ...UKB, country: "Japan" },
      { ...UKB, code: "KIX", address: { text: "大阪府泉佐野市泉州空港北1", source: "x" } },
      { ...UKB, code: "ITM", address: { text: "〒560-0036 Osaka", source: "x" } },
      { ...UKB, code: "NGO", address: { text: "〒479-0881 愛知県常滑市セントレア1-1" } },
      { ...UKB, code: "CTS", meetingPoint: undefined },
      { ...HND, code: "NRT", meetingPoint: { zh: "大厅", source: "x" } },
      { ...UKB, code: "FUK", meetingPoint: { ja: "到着ロビー", source: "x" } },
      { ...UKB, code: "OKA", meetingPoint: { zh: "到达大厅", ko: "x", source: "x" } },
      { ...UKB, code: "KOJ", meetingPoint: { zh: "到达大厅" } },
      { ...UKB, code: "OIT", meetingPoint: { zh: "國際線大厅", source: "x" } },
      { ...UKB, code: "OIT" },
      {
        ...HND,
        code: "SDJ",
        terminals: [
          { ...T1, suffix: "t1" },
          { ...T1, suffix: "T2", names: { ja: "Terminal 2", zh: "國際線航站楼", en: "Terminal 2" } },
          { ...T1, suffix: "T3", names: { zh: "第3航站楼", en: "T3" } },
          { ...T1, suffix: "T4", lat: 95, lng: "139" },
          { ...T1, suffix: "T5", coordSource: "", sources: [] },
          { ...T1, suffix: "T6", flightScope: "regional" },
          { ...T1, suffix: "T7", meetingPoint: undefined },
          { ...T1, suffix: "T7" },
          { ...T1, suffix: "T8", address: { text: "宮城県名取市", source: "x" } },
        ],
      },
    ]),
  );
  assert.deepEqual(entries, []);
  const brief = issues.map((issue) => [issue.index, issue.code, issue.terminal ?? null, issue.problem, issue.field ?? null, issue.language ?? null]);
  assert.deepEqual(brief, [
    [1, "hnd", null, "CODE_FORMAT", null, null],
    [2, "UKB", null, "COUNTRY_FORMAT", null, null],
    [3, "KIX", null, "NO_POSTCODE", "address", null],
    [4, "ITM", null, "NOT_JAPANESE", "address", null],
    [5, "NGO", null, "NO_SOURCE", "address", null],
    [6, "CTS", null, "MEETING_POINT_PLACEMENT", "meetingPoint", null],
    [7, "NRT", null, "MEETING_POINT_PLACEMENT", "meetingPoint", null],
    [8, "FUK", null, "MEETING_POINT_FORMAT", "meetingPoint", "zh"],
    [9, "OKA", null, "MEETING_POINT_FORMAT", "meetingPoint", "ko"],
    [10, "KOJ", null, "NO_SOURCE", "meetingPoint", null],
    [11, "OIT", null, "NOT_SIMPLIFIED", "meetingPoint", "zh"],
    [12, "OIT", null, "DUPLICATE", null, null],
    [13, "SDJ", "#1", "SUFFIX_FORMAT", null, null],
    [13, "SDJ", "T2", "NOT_JAPANESE", "names", "ja"],
    [13, "SDJ", "T2", "NOT_SIMPLIFIED", "names", "zh"],
    [13, "SDJ", "T3", "NAME_FORMAT", "names", "ja"],
    [13, "SDJ", "T4", "COORDINATE", "lat", null],
    [13, "SDJ", "T4", "COORDINATE", "lng", null],
    [13, "SDJ", "T5", "NO_SOURCE", "sources", null],
    [13, "SDJ", "T5", "NO_SOURCE", "coordSource", null],
    [13, "SDJ", "T5", "NO_SOURCE", "meetingPoint", null],
    [13, "SDJ", "T6", "FLIGHT_SCOPE", "flightScope", null],
    [13, "SDJ", "T7", "MEETING_POINT_FORMAT", "meetingPoint", null],
    [13, "SDJ", "T7", "SUFFIX_DUPLICATE", null, null],
    [13, "SDJ", "T8", "NO_POSTCODE", "address", null],
  ]);
  assert.equal(issues.find((issue) => issue.terminal === "T2" && issue.problem === "NOT_SIMPLIFIED")?.chars, "國際");
  assert.deepEqual(readReviewedAirportTerminals({ airports: "x" }).issues, [{ index: 0, code: null, problem: "NO_LIST" }]);
  assert.deepEqual(readReviewedAirportTerminals(null).issues, [{ index: 0, code: null, problem: "NO_LIST" }]);
});

test("读核对表：日本以外的机场不查邮编和日文", () => {
  const { issues } = readReviewedAirportTerminals(table([{ code: "ICN", country: "KR", address: { text: "272 Gonghang-ro, Jung-gu, Incheon", source: "仁川机场官网" }, meetingPoint: { zh: "1 楼到达大厅", source: "仁川机场官网" } }]));
  assert.deepEqual(issues, []);
});

test("仓库里的核对表合格（M12-06 结构 PR 时是空列表，内容另一个 PR 填）", async () => {
  const raw = JSON.parse(await readFile(new URL("../../../apps/api/masterdata/airport-terminals-reviewed.json", import.meta.url), "utf8"));
  assert.equal(typeof raw.description, "string");
  assert.deepEqual(readReviewedAirportTerminals(raw).issues, []);
});

const read = (airports: unknown[]) => {
  const { entries, issues } = readReviewedAirportTerminals(table(airports));
  assert.deepEqual(issues, []);
  return entries;
};

test("计划：机场填地址；库里没有的航站楼新建（启用、城市跟机场、三种名称和来源都记上）；只看所选国家", () => {
  const airport = place({});
  const plan = planReviewedAirportTerminals([airport, place({ code: "ICN", countryCode: "KR", lat: 37.46, lng: 126.44 })], [], read([HND, { code: "ICN", country: "KR", address: { text: "Incheon", source: "x" }, meetingPoint: { zh: "大厅", source: "x" } }]), ["JP"]);
  assert.deepEqual(plan.fills.map((fill) => [fill.code, fill.fields]), [["HND", ["address"]]]);
  assert.deepEqual(plan.fills[0]?.values, { address: ADDRESS.text, content_sources: { address: { source: REVIEWED_AIRPORT_TERMINALS_SOURCE, ref: ADDRESS.source, value: ADDRESS.text } } });
  assert.deepEqual(plan.creates.map((create) => [create.code, create.status, create.cityId, create.flightScope]), [["HND-T1", "active", "city-1", "domestic"], ["HND-T3", "active", "city-1", "international"]]);
  const t1 = plan.creates[0]!;
  assert.deepEqual(t1.name, { ja: "第1ターミナル", zh: "第1航站楼", en: "Terminal 1" });
  assert.deepEqual(t1.nameSources.en, { source: REVIEWED_AIRPORT_TERMINALS_SOURCE, ref: "羽田机场官网", text: "Terminal 1" });
  assert.deepEqual(t1.meetingPoint, { zh: "1 楼到达大厅", ja: "1階到着ロビー" });
  assert.equal(t1.address, null);
  assert.deepEqual(Object.keys(t1.contentSources), ["meeting_point"]);
  assert.deepEqual(plan.creates[1]?.contentSources.address?.value, "〒144-0041 東京都大田区羽田空港2-6-5");
  assert.ok(t1.distanceMeters > 0 && t1.distanceMeters < 5_000);
  assert.deepEqual([plan.unchanged, plan.conflicts, plan.notInDatabase], [[], [], []]);
});

test("计划：机场停用或还没有城市时，新建的航站楼是停用的", () => {
  for (const airport of [place({ status: "disabled" }), place({ status: "disabled", cityId: null })]) {
    const plan = planReviewedAirportTerminals([airport], [], read([HND]), ["JP"]);
    assert.deepEqual(plan.creates.map((create) => [create.status, create.cityId]), [["disabled", airport.cityId], ["disabled", airport.cityId]]);
  }
});

test("计划：单航站楼的机场把集合地点填在机场上", () => {
  const plan = planReviewedAirportTerminals([place({ code: "UKB", lat: 34.6328, lng: 135.2239 })], [], read([UKB]), ["JP"]);
  assert.deepEqual(plan.fills[0]?.fields, ["address", "meeting_point"]);
  assert.deepEqual(plan.fills[0]?.values.meeting_point, { zh: "1 楼到达口" });
  assert.deepEqual(plan.creates, []);
});

test("计划：已有的航站楼只填空着的地址 / 集合地点 / 名称语言；已有的不改（不一样的列出来）；平台删掉的不补回去；坐标不动", () => {
  const airport = place({ address: "平台填的地址" });
  const t1 = place({ id: "t1", code: "HND-T1", parentId: airport.id, lat: 35.5, lng: 139.7, name: { zh: "一号航站楼（平台）" }, meetingPoint: { zh: "平台写的集合地点" } });
  const t3 = place({ id: "t3", code: "HND-T3", parentId: airport.id, name: { en: "T3" }, nameSources: { ja: { source: "nozomi-reviewed", ref: "x", text: "第3ターミナル" } }, contentSources: { meeting_point: { source: "nozomi-reviewed", ref: "x", value: { zh: "旧的" } } } });
  const plan = planReviewedAirportTerminals([airport], [t1, t3], read([HND]), ["JP"]);
  assert.deepEqual(plan.creates, []);
  assert.deepEqual(plan.fills.map((fill) => [fill.code, fill.fields]), [["HND-T1", ["name.ja", "name.en"]], ["HND-T3", ["address", "name.zh"]]]);
  const fillT1 = plan.fills[0]!;
  assert.deepEqual(fillT1.values.name, { zh: "一号航站楼（平台）", ja: "第1ターミナル", en: "Terminal 1" });
  assert.equal("lat" in fillT1.values, false);
  assert.deepEqual(plan.keptFilled.map((kept) => [kept.code, kept.field]), [["HND", "address"], ["HND-T1", "meeting_point"], ["HND-T1", "name.zh"], ["HND-T3", "name.en"]]);
  assert.deepEqual(plan.keptCleared, [{ code: "HND-T3", field: "meeting_point" }, { code: "HND-T3", field: "name.ja" }]);
  assert.deepEqual(plan.unchanged, ["HND"]);
});

test("计划：同一张表跑两次，第二次什么都不做", () => {
  const airport = place({});
  const first = planReviewedAirportTerminals([airport], [], read([HND]), ["JP"]);
  const fill = first.fills[0]!;
  const airportAfter = { ...airport, address: fill.values.address ?? null, contentSources: fill.values.content_sources ?? {} };
  const created = first.creates.map((create) => place({ id: create.code, code: create.code, parentId: create.airportId, lat: create.lat, lng: create.lng, name: create.name, nameSources: create.nameSources, address: create.address, meetingPoint: create.meetingPoint, contentSources: create.contentSources }));
  const second = planReviewedAirportTerminals([airportAfter], created, read([HND]), ["JP"]);
  assert.deepEqual([second.creates, second.fills, second.keptFilled, second.keptCleared, second.conflicts], [[], [], [], [], []]);
  assert.deepEqual(second.unchanged, ["HND", "HND-T1", "HND-T3"]);
});

test("计划：航站楼离机场超过 5 公里、国家对不上、同编码的航站楼挂在别的机场下：不动，交给人看；库里没有的机场列出来", () => {
  const far = { ...HND, terminals: [{ ...T1, lat: 35.6, lng: 139.78 }, T3] };
  const plan = planReviewedAirportTerminals([place({})], [], read([far, { ...UKB, code: "KIX" }]), ["JP"]);
  assert.deepEqual(plan.conflicts.map((conflict) => [conflict.code, conflict.problem]), [["HND-T1", "TOO_FAR"]]);
  const tooFar = plan.conflicts[0];
  assert.ok(tooFar?.problem === "TOO_FAR" && tooFar.distanceMeters > 5_000);
  assert.deepEqual(plan.creates.map((create) => create.code), ["HND-T3"]);
  assert.deepEqual(plan.notInDatabase, ["KIX"]);

  const country = planReviewedAirportTerminals([place({ countryCode: "KR" })], [], read([HND]), ["JP"]);
  assert.deepEqual(country.conflicts, [{ code: "HND", problem: "COUNTRY_MISMATCH", country: "JP", actual: "KR" }]);
  assert.deepEqual([country.creates, country.fills], [[], []]);

  const elsewhere = planReviewedAirportTerminals([place({})], [place({ id: "x", code: "HND-T1", parentId: "other-airport" })], read([HND]), ["JP"]);
  assert.deepEqual(elsewhere.conflicts, [{ code: "HND-T1", problem: "NOT_UNDER_AIRPORT" }]);
});
