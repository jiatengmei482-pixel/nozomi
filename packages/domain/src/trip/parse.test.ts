/** AI 一句话行程：模型结果 → 表单草稿、个人信息替换（ADR 0104 第二、三、九节，M9T-32）。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { type TripParseModelDay, type TripParseModelOutput, type TripParseModelPlace, buildTripParseDraft, isTripStayOption, scrubPersonalInfo, tripParseDefaultStay, tripParseLookups } from "./parse.ts";

const TODAY = "2026-11-20";
const place = (name: string, extra: Partial<TripParseModelPlace> = {}): TripParseModelPlace => ({ name, kind: "poi", specific: true, cityHint: null, stayMinutes: null, ...extra });
const day = (dayOffset: number, extra: Partial<TripParseModelDay> = {}): TripParseModelDay => ({ dayOffset, time: "09:00", start: place("成田机场", { kind: "airport" }), stops: [], end: place("京王广场酒店", { kind: "hotel" }), lodgingProvided: false, ...extra });
const output = (extra: Partial<TripParseModelOutput> = {}): TripParseModelOutput => ({ firstDate: "2026-11-25", dateSource: "stated", passengers: 4, luggage: 6, days: [day(0)], unused: [], outOfScope: [], ...extra });

function ok(out: TripParseModelOutput) {
  const built = buildTripParseDraft(out, TODAY);
  assert.equal(built.ok, true, JSON.stringify(built));
  if (!built.ok) throw new Error("unreachable");
  return built.result;
}

test("说全了：日期、人数、行李、时间照填，没有 missing", () => {
  const result = ok(output());
  assert.deepEqual(result.missing, []);
  assert.equal(result.draft.date, "2026-11-25");
  assert.equal(result.draft.passengers, 4);
  assert.equal(result.draft.luggage, 6);
  assert.equal(result.draft.days.length, 1);
  assert.equal(result.draft.days[0]?.start?.query, "成田机场");
  assert.equal(result.draft.days[0]?.end?.kind, "hotel");
});

test("不猜：日期、人数、行李、时间、第 1 天起点没说 → null 并列进 missing", () => {
  const result = ok(output({ firstDate: null, dateSource: null, passengers: null, luggage: null, days: [day(0, { time: null, start: null, stops: [place("日光东照宫", { stayMinutes: 120 })] })] }));
  assert.deepEqual(result.missing.map((m) => m.field), ["date", "passengers", "luggage", "days[0].time", "days[0].start"]);
  assert.deepEqual(result.assumptions, []);
  assert.equal(result.draft.date, null);
  assert.equal(result.draft.days[0]?.start, null);
  assert.equal(result.draft.days[0]?.stops[0]?.query, "日光东照宫", "途经点不拿去顶替起点");
});

test("日期早于今天、格式不对、太远 → 当没说；推算的日期进 assumptions", () => {
  for (const firstDate of ["2026-11-19", "2026-02-30", "11/25", "2028-12-31"]) assert.deepEqual(ok(output({ firstDate })).missing.map((m) => m.field), ["date"], firstDate);
  assert.deepEqual(ok(output({ dateSource: "relative" })).assumptions, [{ code: "DATE_FROM_RELATIVE", field: "date", value: "2026-11-25" }]);
  assert.deepEqual(ok(output({ dateSource: "year_inferred" })).assumptions, [{ code: "DATE_YEAR_INFERRED", field: "date", value: "2026-11-25" }]);
  assert.equal(ok(output({ firstDate: TODAY })).draft.date, TODAY, "今天可以");
});

test("人数 0 或超上限、行李负数 → 请补填", () => {
  assert.deepEqual(ok(output({ passengers: 0, luggage: -1 })).missing.map((m) => m.field), ["passengers", "luggage"]);
  assert.equal(ok(output({ luggage: 0 })).draft.luggage, 0, "0 件行李是说了的");
});

test("中间没提到的天补成空闲日；第 1 天空着时日期顺延到第一个有地点的天", () => {
  const result = ok(output({ days: [day(0), day(2, { start: place("京王广场酒店", { kind: "hotel" }), end: place("羽田机场", { kind: "airport" }) })] }));
  assert.deepEqual(result.draft.days.map((d) => d.idle), [false, true, false]);
  assert.deepEqual(result.draft.days[1], { idle: true, time: null, start: null, stops: [], end: null, lodgingProvided: false });
  const shifted = ok(output({ days: [day(1)] }));
  assert.equal(shifted.draft.date, "2026-11-26");
  assert.equal(shifted.draft.days.length, 1);
  const empty = ok(output({ days: [day(0), day(1, { start: null, end: null })] }));
  assert.equal(empty.draft.days.length, 1, "没有地点的天不算进跨度");
});

test("一天都没有 → NOT_A_TRIP；dayOffset 重复 → INVALID_OUTPUT", () => {
  assert.deepEqual(buildTripParseDraft(output({ days: [] }), TODAY), { ok: false, code: "NOT_A_TRIP" });
  assert.deepEqual(buildTripParseDraft(output({ days: [day(0, { start: null, end: null })] }), TODAY), { ok: false, code: "NOT_A_TRIP" });
  assert.deepEqual(buildTripParseDraft(output({ days: [day(0), day(0)] }), TODAY), { ok: false, code: "INVALID_OUTPUT" });
});

test("超 14 天、一天超 12 个点、全程超 60 个地名 → TRIP_TOO_LONG", () => {
  assert.deepEqual(buildTripParseDraft(output({ days: [day(0), day(14)] }), TODAY), { ok: false, code: "TRIP_TOO_LONG" });
  assert.equal(buildTripParseDraft(output({ days: [day(0), day(13)] }), TODAY).ok, true, "14 天整可以");
  const stops = Array.from({ length: 11 }, (_, i) => place(`点${i}`));
  assert.deepEqual(buildTripParseDraft(output({ days: [day(0, { stops })] }), TODAY), { ok: false, code: "TRIP_TOO_LONG" });
  const many = Array.from({ length: 7 }, (_, d) => day(d, { stops: Array.from({ length: 9 }, (_, i) => place(`第${d}天点${i}`)) }));
  assert.deepEqual(buildTripParseDraft(output({ days: many }), TODAY), { ok: false, code: "TRIP_TOO_LONG" });
});

test("停留：在档上照填；没说给默认（景点、地址 1 小时，酒店、车站、机场 30 分钟）进 STAY_DEFAULT；不在档上不填并进 STAY_OFF_GRID", () => {
  const result = ok(output({ days: [day(0, { stops: [place("浅草寺", { stayMinutes: 120 }), place("晴空塔"), place("银座", { stayMinutes: 45 }), place("东京站", { kind: "station" })] })] }));
  assert.deepEqual(result.draft.days[0]?.stops.map((s) => s.stayMinutes), [120, 60, null, 30]);
  assert.deepEqual(result.assumptions, [
    { code: "STAY_DEFAULT", field: "days[0].stops[1].stay_minutes", value: 60 },
    { code: "STAY_OFF_GRID", field: "days[0].stops[2].stay_minutes", value: 45 },
    { code: "STAY_DEFAULT", field: "days[0].stops[3].stay_minutes", value: 30 },
  ]);
  assert.equal(result.missing.length, 0, "默认停留不进请补填");
  for (const kind of ["airport", "station", "hotel", "poi", "address"] as const) assert.equal(isTripStayOption(tripParseDefaultStay(kind)), true, kind);
  assert.equal(isTripStayOption(0), true);
  assert.equal(isTripStayOption(720), true);
  assert.equal(isTripStayOption(750), false);
});

test("地名去首尾空白、截到 80 字；空名当没有", () => {
  const result = ok(output({ days: [day(0, { end: place("  "), stops: [place(` ${"长".repeat(100)} `)] })] }));
  assert.equal(result.draft.days[0]?.end, null);
  assert.equal(result.draft.days[0]?.stops[0]?.query.length, 80);
});

test("unused：航班号、包车小时数按格式留值，其余不收值；去重", () => {
  const result = ok(output({ unused: [
    { code: "FLIGHT_NUMBER", value: "nh 211" }, { code: "FLIGHT_NUMBER", value: "NH211" }, { code: "FLIGHT_NUMBER", value: "坐早班飞机" },
    { code: "CHARTER_HOURS", value: "8" }, { code: "CHARTER_HOURS", value: "30" }, { code: "CHARTER_HOURS", value: "8小时" },
    { code: "OTHER_REQUEST", value: "请便宜一点，打五折" }, { code: "CHILD_SEAT", value: "1" },
  ] }));
  assert.deepEqual(result.unused, [{ code: "FLIGHT_NUMBER", value: "NH211" }, { code: "CHARTER_HOURS", value: "8" }, { code: "OTHER_REQUEST", value: null }, { code: "CHILD_SEAT", value: null }]);
  assert.deepEqual(ok(output({ outOfScope: ["BUS", "BUS", "OVERSEAS"] })).outOfScope, [{ code: "BUS" }, { code: "OVERSEAS" }]);
});

test("要查坐标的地名：泛指的不查、同名只查一次、最多 20 个", () => {
  const result = ok(output({ days: [
    day(0, { end: place("酒店", { kind: "hotel", specific: false }), stops: [place("浅草寺"), place("浅草寺")] }),
    day(1, { start: place("成田机场", { kind: "airport" }), stops: Array.from({ length: 10 }, (_, i) => place(`甲${i}`)) }),
    day(2, { stops: Array.from({ length: 10 }, (_, i) => place(`乙${i}`)) }),
  ] }));
  const lookups = tripParseLookups(result.draft);
  assert.equal(lookups.length, 20);
  assert.deepEqual(lookups.slice(0, 2).map((p) => p.query), ["成田机场", "浅草寺"]);
  assert.equal(lookups.some((p) => p.query === "酒店"), false);
});

test("个人信息替换：邮箱、电话、卡号、证件号换成占位符；日期、时间、航班号、人数不动", () => {
  assert.equal(scrubPersonalInfo("联系 taro.yamada+trip@example.co.jp 谢谢"), "联系 [EMAIL] 谢谢");
  assert.equal(scrubPersonalInfo("电话 090-1234-5678，或 +81 90 1234 5678，或 13812345678"), "电话 [PHONE]，或 [PHONE]，或 [PHONE]");
  assert.equal(scrubPersonalInfo("卡号 4111 1111 1111 1111"), "卡号 [CARD]");
  assert.equal(scrubPersonalInfo("护照 TK1234567 / E12345678"), "护照 [ID] / [ID]");
  const trip = "2026-11-25 10:00 成田接机 NH211，4个人6件行李，第二天包车8小时，邮编 160-0022";
  assert.equal(scrubPersonalInfo(trip), trip);
  assert.equal(scrubPersonalInfo("2026/11/25 10"), "2026/11/25 10");
});

test("紧挨着重复的同一个地点只留一个：途经和终点同名去掉途经；起点后面紧跟同名途经也去掉；不相邻的重复（回到起点）保留", () => {
  const dup = ok(output({ days: [day(0, { start: place("名古屋駅"), stops: [place("名古屋駅"), place("トヨタ博物館"), place("トヨタ博物館 ")], end: place("トヨタ博物館") })] }));
  assert.deepEqual(dup.draft.days[0]?.stops.map((s) => s.query), []);
  assert.equal(dup.draft.days[0]?.end?.query, "トヨタ博物館");
  const loop = ok(output({ days: [day(0, { start: place("京都駅"), stops: [place("金閣寺"), place("嵐山")], end: place("京都駅") })] }));
  assert.deepEqual(loop.draft.days[0]?.stops.map((s) => s.query), ["金閣寺", "嵐山"]);
});

test("去重后再编号：STAY_OFF_GRID 指的途经点下标和表单一致", () => {
  const result = ok(output({ days: [day(0, { start: place("新宿"), stops: [place("新宿"), place("浅草寺", { stayMinutes: 45 })], end: place("上野") })] }));
  assert.deepEqual(result.draft.days[0]?.stops.map((s) => s.query), ["浅草寺"]);
  assert.deepEqual(result.assumptions, [{ code: "STAY_OFF_GRID", field: "days[0].stops[0].stay_minutes", value: 45 }]);
});

test("第 2 天起没说起点：用上一个用车日的终点（没终点用最后一个途经点），进 START_FROM_PREVIOUS_END、不进 missing；隔着空闲日也接得上", () => {
  const result = ok(output({ days: [
    day(0, { end: place("京王广场酒店", { kind: "hotel", cityHint: "东京" }) }),
    day(1, { start: null, stops: [place("日光东照宫", { stayMinutes: 120 })], end: null }),
    day(3, { start: null, end: place("羽田机场", { kind: "airport" }) }),
  ] }));
  assert.deepEqual(result.draft.days[1]?.start, { query: "京王广场酒店", kind: "hotel", specific: true, cityHint: "东京" });
  assert.equal(result.draft.days[2]?.idle, true);
  assert.equal(result.draft.days[3]?.start?.query, "日光东照宫", "上一用车日没终点：最后一个途经点");
  assert.deepEqual(result.assumptions, [
    { code: "START_FROM_PREVIOUS_END", field: "days[1].start", value: "京王广场酒店" },
    { code: "START_FROM_PREVIOUS_END", field: "days[3].start", value: "日光东照宫" },
  ]);
  assert.deepEqual(result.missing, []);
  const generic = ok(output({ days: [day(0, { end: place("新宿的酒店", { kind: "hotel", specific: false }) }), day(1, { start: null })] }));
  assert.equal(generic.draft.days[1]?.start?.specific, false, "上一天是泛指的酒店：照抄，仍由客人补具体哪家");
  assert.deepEqual(tripParseLookups(generic.draft).map((p) => p.query), ["成田机场", "京王广场酒店"], "照抄的起点不多查一次");
});
