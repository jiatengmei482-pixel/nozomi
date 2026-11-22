/**
 * AI 一句话行程（M9T-33，ADR 0104 第三节）：解析应答 → 表单草稿、标记、摘要；失败的说法。
 * 和 Codespace 开发在 #288 对过的 4 点：point.kind 只认 airport、停留只收 30 分钟档、不用 texts、空闲日原样排。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, NetworkError } from "../api/client.ts";
import type { SiteTripParseDay, SiteTripParseResult } from "../api/site.ts";
import { initialTripDraft, newTripStop, tripItineraryOf, validateTripDraft, hasTripErrors } from "./trip-form.ts";
import { tripAiFailureOf, tripAiFieldText, tripAiFillOf, tripAiLength, tripDraftBlank } from "./trip-ai.ts";

const HOTEL = { name: "京王广场酒店", address: "东京都新宿区西新宿 2-2-1", lat: 35.6905, lng: 139.6948, kind: "hotel" };
const TEMPLE = { name: "浅草寺", address: "东京都台东区浅草 2-3-1", lat: 35.7148, lng: 139.7967, kind: "poi" };
const NARITA = { name: "成田国际机场", lat: 35.772, lng: 140.3929, kind: "airport" };
const at = (query: string, point: typeof HOTEL | typeof NARITA) => ({ query, match: { status: "resolved" as const, point } });

function result(days: SiteTripParseDay[], changes: Partial<SiteTripParseResult["draft"]> = {}, rest: Partial<Omit<SiteTripParseResult, "draft">> = {}): SiteTripParseResult {
  return { draft: { date: "2030-11-20", passengers: 4, luggage: 6, days, ...changes }, missing: [], assumptions: [], unused: [], out_of_scope: [], ...rest };
}

const filled = (value: SiteTripParseResult) => {
  const fill = tripAiFillOf(value);
  assert.equal(fill.kind, "filled");
  return fill as Extract<typeof fill, { kind: "filled" }>;
};

test("齐全的行程：直接能建行程单；机场认成 airport，酒店、景点（poi / hotel）当普通地点；地名带地址；AI 填的格子都记下", () => {
  const fill = filled(
    result([
      { idle: false, time: "14:30", start: at("成田机场", NARITA), stops: [], end: at("酒店", HOTEL), lodging_provided: true },
      { idle: false, time: "09:00", start: at("酒店", HOTEL), stops: [{ ...at("浅草寺", TEMPLE), stay_minutes: 90 }], end: at("成田", NARITA) },
    ]),
  );
  const { draft } = fill;
  assert.equal(hasTripErrors(validateTripDraft(draft)), false);
  assert.equal(draft.days[0]?.start?.kind, "airport");
  assert.equal(draft.days[0]?.end?.kind, null);
  assert.equal(draft.days[0]?.end?.name, "京王广场酒店（东京都新宿区西新宿 2-2-1）");
  assert.equal(draft.days[0]?.end?.suggestionName, "京王广场酒店");
  assert.equal(draft.days[1]?.stops[0]?.point?.kind, null);
  assert.equal(draft.days[1]?.stops[0]?.stay, "90");
  const itinerary = tripItineraryOf(draft);
  assert.deepEqual(itinerary.party, { adults: 4, children: 0, luggage: 6 });
  assert.equal(itinerary.days[0]?.items[0]?.kind, "arrive_flight");
  assert.equal(itinerary.days[0]?.driverLodgingProvided, true);
  assert.equal(itinerary.days[1]?.items[2]?.kind, "depart_flight");
  assert.deepEqual(fill.marks.missing, []);
  assert.ok(fill.marks.filled.includes("date") && fill.marks.filled.includes("passengers") && fill.marks.filled.includes("luggage"));
  assert.equal(fill.marks.filled.length, 3 + 3 + 5, "日期、人数、行李 + 第 1 天时间和两个点 + 第 2 天时间、三个点、一个停留");
  assert.deepEqual(fill.summary, { missing: [], confirm: [], unused: [], outOfScope: null });
  assert.equal(fill.headline, "已按你的描述填好 2 天行程。标黄的地方请补填或确认，然后点「查看报价」");
});

test("不猜：日期、人数、行李、时间没给的进「请补填」；人数行李先按表单默认值填并写明；时间格式不对当没给", () => {
  const fill = filled(result([{ idle: false, time: "25:00", start: at("酒店", HOTEL), stops: [], end: at("酒店", HOTEL) }], { date: null, passengers: null, luggage: 99 }));
  const defaults = initialTripDraft();
  assert.equal(fill.draft.date, "");
  assert.equal(fill.draft.passengers, defaults.passengers);
  assert.equal(fill.draft.luggage, defaults.luggage, "超出上限当没给");
  assert.equal(fill.draft.days[0]?.time, "");
  assert.deepEqual(fill.summary.missing, ["第 1 天的日期", `人数（先按 ${defaults.passengers} 人填了）`, `行李件数（先按 ${defaults.luggage} 件填了）`, "第 1 天的上车时间"]);
  const dayKey = fill.draft.days[0]?.key ?? "";
  assert.deepEqual(fill.marks.missing, ["date", "passengers", "luggage", `${dayKey}.time`]);
});

test("地点：多个候选留空并记下候选（最多 5 个，只有 1 个有效时直接填）；没找到留空并记下地名；都进「请补填」", () => {
  const many = Array.from({ length: 7 }, (_, i) => ({ ...HOTEL, name: `酒店 ${i + 1}`, lat: 35.69 + i / 1000 }));
  const fill = filled(
    result([
      {
        idle: false,
        time: "09:00",
        start: { query: "新宿的酒店", match: { status: "ambiguous", candidates: many } },
        stops: [{ query: "浅草", match: { status: "ambiguous", candidates: [TEMPLE, { ...TEMPLE, name: "坏的", lat: Number.NaN }] }, stay_minutes: 60 }],
        end: { query: "  某个地方 ", match: { status: "unresolved" } },
      },
    ]),
  );
  const day = fill.draft.days[0];
  assert.ok(day);
  assert.equal(day.start, null);
  assert.equal(fill.marks.candidates[`${day.key}.start`]?.length, 5);
  assert.equal(fill.marks.candidates[`${day.key}.start`]?.[0]?.address, HOTEL.address);
  assert.equal(day.stops[0]?.point?.name, "浅草寺（东京都台东区浅草 2-3-1）", "只剩一个有效候选：直接填");
  assert.equal(day.end, null);
  assert.equal(fill.marks.notFound[`${day.key}.end`], "某个地方");
  assert.deepEqual(fill.summary.missing, ["第 1 天的上车地点", "第 1 天的最后下车地点"]);
});

test("停留：只收 0–720、每 30 分钟一档；不在档上的丢掉进「请确认」，没给的进「请补填」（页面检查要求选停留）", () => {
  const stop = (stay_minutes: number | null) => ({ ...at("浅草寺", TEMPLE), stay_minutes });
  const fill = filled(result([{ idle: false, time: "09:00", start: at("酒店", HOTEL), stops: [stop(0), stop(45), stop(null), stop(750)], end: at("酒店", HOTEL) }]));
  assert.deepEqual(
    fill.draft.days[0]?.stops.map((item) => item.stay),
    ["0", "", "", ""],
  );
  assert.deepEqual(fill.summary.confirm, ["第 1 天第 2 个中间地点的停留时长没有对应的选项，请自己选", "第 1 天第 4 个中间地点的停留时长没有对应的选项，请自己选"]);
  assert.deepEqual(fill.summary.missing, ["第 1 天第 3 个中间地点的停留时长"]);
});

test("空闲日：忽略当天的时间和地点、照给住宿；天数按应答原样排，不自己插天", () => {
  const fill = filled(
    result([
      { idle: false, time: "09:00", start: at("酒店", HOTEL), stops: [], end: at("酒店", HOTEL), lodging_provided: true },
      { idle: true, time: "10:00", start: at("酒店", HOTEL), stops: [{ ...at("浅草寺", TEMPLE), stay_minutes: 30 }], end: null, lodging_provided: true },
      { idle: false, time: "09:00", start: at("酒店", HOTEL), stops: [], end: at("成田", NARITA) },
    ]),
  );
  assert.equal(fill.draft.days.length, 3);
  const idle = fill.draft.days[1];
  assert.deepEqual([idle?.idle, idle?.time, idle?.start, idle?.stops.length, idle?.end, idle?.lodgingProvided], [true, "", null, 0, null, true]);
  assert.equal(hasTripErrors(validateTripDraft(fill.draft)), false);
  assert.deepEqual(tripItineraryOf(fill.draft).days[1]?.items, []);
});

test("一天都没有（或全是空闲日）→ 没看出行程；超过 14 天或每天超过 10 个中间地点 → 行程较长（不截断）", () => {
  assert.deepEqual(tripAiFillOf(result([])), { kind: "failed", text: "没看出行程，请写上日期、地点，或直接在下面填写" });
  assert.deepEqual(tripAiFillOf(result([{ idle: true }])), { kind: "failed", text: "没看出行程，请写上日期、地点，或直接在下面填写" });
  const day: SiteTripParseDay = { idle: false, time: "09:00", start: at("酒店", HOTEL), stops: [], end: at("酒店", HOTEL) };
  assert.equal(tripAiFillOf(result(Array.from({ length: 15 }, () => day))).kind, "failed");
  assert.deepEqual(tripAiFillOf(result([{ ...day, stops: Array.from({ length: 11 }, () => ({ ...at("浅草寺", TEMPLE), stay_minutes: 30 })) }])), { kind: "failed", text: "行程较长，请分段报价或转人工" });
});

test("请确认 / 没有用上 / 不在报价范围：只按代码拼文案；航班号、小时数格式不对的丢掉；同一句不重复；认不出的代码有通用说法", () => {
  const day: SiteTripParseDay = { idle: false, time: "09:00", start: at("酒店", HOTEL), stops: [], end: at("酒店", HOTEL) };
  const fill = filled(
    result([day], {}, {
      assumptions: [
        { code: "DATE_FROM_RELATIVE", field: "date", value: "2030-11-20" },
        { code: "SOMETHING_NEW", field: "days[0].time" },
        { code: "SOMETHING_NEW" },
      ],
      unused: [
        { code: "FLIGHT_NUMBER", value: "NH211" },
        { code: "FLIGHT_NUMBER", value: "<b>坏</b>" },
        { code: "CHARTER_HOURS", value: "8" },
        { code: "CHARTER_HOURS", value: 30 },
        { code: "CHILD_SEAT" },
        { code: "OTHER_REQUEST", value: "随便写的" },
        { code: "NEW_CODE" },
        { code: "NEW_CODE_2" },
      ],
      out_of_scope: [{ code: "BUS" }, { code: "OVERSEAS" }, { code: "BUS" }, { code: "WHAT" }],
    }),
  );
  assert.deepEqual(fill.summary.confirm, ["第 1 天的日期按 11 月 20 日填", "第 1 天的上车时间是推算出来的", "标黄的地方是推算出来的"]);
  assert.deepEqual(fill.summary.unused, [
    "航班号 NH211：行程报价暂不用航班号，下单时可以填在备注里",
    "你说的「包车 8 小时」会按实际路线自动选套餐，报价里能看到",
    "儿童座椅：报价后在附加服务里选",
    "其他要求：下单时可以填在备注里",
    "有一些信息报价用不上，下单时可以填在备注里",
  ]);
  assert.equal(fill.summary.outOfScope, "行程里有暂时报不了价的部分（大巴、海外段、其他），可以转人工报价");
  assert.doesNotMatch(JSON.stringify(fill.summary), /随便写的|<b>/, "AI 的自由文字不上页面");
});

test("字段路径的说法", () => {
  const party = { passengers: 2, luggage: 1 };
  assert.equal(tripAiFieldText("date", party), "第 1 天的日期");
  assert.equal(tripAiFieldText("days[2].start", party), "第 3 天的上车地点");
  assert.equal(tripAiFieldText("days[0].stops[1]", party), "第 1 天第 2 个中间地点");
  assert.equal(tripAiFieldText("days[0].stops[1].stay_minutes", party), "第 1 天第 2 个中间地点的停留时长");
  assert.equal(tripAiFieldText("days[0].weird", party), null);
});

test("字数按 Unicode 码点、去掉首尾空白；空表单判断（页面自动填的日期、默认人数不算填过）", () => {
  assert.equal(tripAiLength("  成田🛫  "), 3);
  const draft = { ...initialTripDraft(), date: "2030-11-20" };
  assert.equal(tripDraftBlank(draft), true);
  assert.equal(tripDraftBlank({ ...draft, days: [{ ...(draft.days[0] as (typeof draft.days)[number]), time: "09:00" }] }), false);
  assert.equal(tripDraftBlank({ ...draft, days: [{ ...(draft.days[0] as (typeof draft.days)[number]), stops: [newTripStop()] }] }), false);
});

test("失败的说法：没配密钥收起；额度用完、没看出行程、太长、太频繁（带秒数）、字数各自一句；其余（断网、AI 出错）同一句", () => {
  const api = (status: number, code: string, retry: number | null = null) => new ApiError(status, code, "x", {}, retry);
  assert.deepEqual(tripAiFailureOf(api(503, "AI_NOT_CONFIGURED")), { text: "暂时没法自动整理，请直接在下面填写", hide: true });
  assert.equal(tripAiFailureOf(api(503, "AI_DAILY_LIMIT")).text, "今天的自动整理次数已满，请直接填写");
  assert.equal(tripAiFailureOf(api(422, "NOT_A_TRIP")).text, "没看出行程，请写上日期、地点，或直接在下面填写");
  assert.equal(tripAiFailureOf(api(422, "TRIP_TOO_LONG")).text, "行程较长，请分段报价或转人工");
  assert.equal(tripAiFailureOf(api(400, "VALIDATION_FAILED")).text, "最多 500 字，请删短一些");
  assert.equal(tripAiFailureOf(api(429, "RATE_LIMITED", 12)).text, "请 12 秒后再试");
  assert.equal(tripAiFailureOf(api(429, "RATE_LIMITED", 120)).text, "请 2 分钟后再试");
  assert.equal(tripAiFailureOf(api(429, "RATE_LIMITED")).text, "请稍后再试");
  assert.deepEqual(tripAiFailureOf(api(503, "AI_UNAVAILABLE")), { text: "暂时没法自动整理，请直接在下面填写", hide: false });
  assert.deepEqual(tripAiFailureOf(new NetworkError()), { text: "暂时没法自动整理，请直接在下面填写", hide: false });
});

test("服务端的新提示代码：没说年份（DATE_YEAR_INFERRED）进请确认；停留不在档上（STAY_OFF_GRID，服务端已置空）改进请确认、不再算请补填", () => {
  const fill = filled(
    result([{ idle: false, time: "09:00", start: at("酒店", HOTEL), stops: [{ ...at("浅草寺", TEMPLE), stay_minutes: null }], end: at("酒店", HOTEL) }], {}, {
      assumptions: [
        { code: "DATE_YEAR_INFERRED", field: "date", value: "2030-11-20" },
        { code: "STAY_OFF_GRID", field: "days[0].stops[0].stay_minutes", value: 45 },
      ],
    }),
  );
  assert.deepEqual(fill.summary.confirm, ["第 1 天的日期按 11 月 20 日填（没说年份，取今天以后最近的那天）", "第 1 天第 1 个中间地点的停留时长没有对应的选项，请自己选"]);
  assert.deepEqual(fill.summary.missing, []);
  assert.equal(fill.draft.days[0]?.stops[0]?.stay, "");
});

test("服务端直接认定 / 给默认（监工 11-21 验收意见）：PLACE_PICKED、START_FROM_PREVIOUS_END 只标 AI 填的、摘要不另说；STAY_DEFAULT 合成一句；都不进请补填", () => {
  const stop = (stay: number) => ({ ...at("浅草寺", TEMPLE), stay_minutes: stay });
  const fill = filled(
    result(
      [
        { idle: false, time: "10:00", start: at("成田机场", NARITA), stops: [stop(60), stop(60)], end: at("新宿酒店", HOTEL) },
        { idle: false, time: "08:00", start: at("新宿酒店", HOTEL), stops: [], end: at("成田", NARITA) },
      ],
      {},
      {
        assumptions: [
          { code: "PLACE_PICKED", field: "days[0].start" },
          { code: "PLACE_PICKED", field: "days[0].stops[0]" },
          { code: "START_FROM_PREVIOUS_END", field: "days[1].start" },
          { code: "STAY_DEFAULT", field: "days[0].stops[0].stay_minutes", value: 60 },
          { code: "STAY_DEFAULT", field: "days[0].stops[1].stay_minutes", value: 60 },
        ],
      },
    ),
  );
  assert.deepEqual(fill.marks.missing, []);
  assert.deepEqual(fill.summary.missing, []);
  assert.deepEqual(fill.summary.confirm, ["没说停留多久的地点先按 1 小时填了，可改"]);
  const stays = fill.draft.days[0]?.stops.map((item) => item.stay);
  assert.deepEqual(stays, ["60", "60"]);
  assert.ok(fill.draft.days[0]?.stops.every((item) => fill.marks.filled.includes(`${item.key}.stay`)));

  const mixed = filled(
    result([{ idle: false, time: "10:00", start: at("成田机场", NARITA), stops: [stop(60), stop(90)], end: at("新宿酒店", HOTEL) }], {}, {
      assumptions: [
        { code: "STAY_DEFAULT", field: "days[0].stops[0].stay_minutes", value: 60 },
        { code: "STAY_DEFAULT", field: "days[0].stops[1].stay_minutes", value: 90 },
        { code: "STAY_DEFAULT", field: "days[0].stops[5].stay_minutes", value: 60 },
      ],
    }),
  );
  assert.deepEqual(mixed.summary.confirm, ["没说停留多久的地点先按常见时长填了，可改"]);

  const half = filled(result([{ idle: false, time: "10:00", start: at("成田机场", NARITA), stops: [stop(90)], end: at("新宿酒店", HOTEL) }], {}, { assumptions: [{ code: "STAY_DEFAULT", field: "days[0].stops[0].stay_minutes" }] }));
  assert.deepEqual(half.summary.confirm, ["没说停留多久的地点先按 1 小时 30 分钟填了，可改"], "以表单里实际填的为准，不看 value");
});

test("STAY_DEFAULT 碰上不在档上的停留（表单里是空的）：不出默认那句，照旧只有「请自己选」一句", () => {
  const fill = filled(
    result([{ idle: false, time: "10:00", start: at("成田机场", NARITA), stops: [{ ...at("浅草寺", TEMPLE), stay_minutes: 45 }], end: at("新宿酒店", HOTEL) }], {}, {
      assumptions: [{ code: "STAY_DEFAULT", field: "days[0].stops[0].stay_minutes", value: 45 }],
    }),
  );
  assert.deepEqual(fill.summary.confirm, ["第 1 天第 1 个中间地点的停留时长没有对应的选项，请自己选"]);
  assert.equal(fill.draft.days[0]?.stops[0]?.stay, "");
});

test("END_AT_START 只标 AI 填的、摘要不另说；PLACE_TOO_VAGUE 让那一格提示「没说是哪一家」（照旧请补填），对不上格子的忽略", () => {
  const vague = { query: "新宿的酒店", match: { status: "unresolved" as const } };
  const fill = filled(
    result(
      [
        { idle: false, time: "10:00", start: at("成田机场", NARITA), stops: [], end: vague },
        { idle: false, time: "08:00", start: at("新宿", HOTEL), stops: [{ ...at("日光", NARITA), stay_minutes: 240 }], end: at("新宿", HOTEL) },
      ],
      {},
      {
        assumptions: [
          { code: "END_AT_START", field: "days[1].end", value: "新宿" },
          { code: "PLACE_TOO_VAGUE", field: "days[0].end", value: "新宿的酒店" },
          { code: "PLACE_TOO_VAGUE", field: "days[1].start", value: "新宿" },
          { code: "PLACE_TOO_VAGUE", field: "days[9].end", value: "x" },
        ],
      },
    ),
  );
  const endCell = `${fill.draft.days[0]?.key}.end`;
  assert.deepEqual(fill.marks.vague, [endCell], "已经填好的格子不算");
  assert.deepEqual(fill.marks.missing, [endCell]);
  assert.equal(fill.marks.notFound[endCell], "新宿的酒店");
  assert.ok(fill.marks.filled.includes(`${fill.draft.days[1]?.key}.end`));
  assert.deepEqual(fill.summary.confirm, []);
});
