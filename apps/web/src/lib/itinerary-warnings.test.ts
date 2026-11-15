/**
 * M9P-10：超限提醒的说法（旧需求第四节第 3 条原文）+ 耗时 / 距离最长的一段；经停点放满时的说明。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { UNAVAILABLE_REASON_TEXT } from "./site-display.ts";
import { itineraryWarningLines, waypointLimitText } from "./itinerary-warnings.ts";

const route = (legs: { minutes: number; meters: number }[]) => ({ legs, drive_minutes: legs.reduce((sum, leg) => sum + leg.minutes, 0), stay_minutes: 60, total_minutes: legs.reduce((sum, leg) => sum + leg.minutes, 60), total_meters: legs.reduce((sum, leg) => sum + leg.meters, 0) });
const POINTS = ["新宿", "镰仓", "日光", "新宿站"];

test("用时超限：预计用时用报价的 T（含缓冲），写出耗时最长的一段（一样长取前面的）", () => {
  const lines = itineraryWarningLines({ itinerary_warnings: ["LONG_DURATION"], estimated_minutes: 750 }, route([{ minutes: 200, meters: 10_000 }, { minutes: 250, meters: 5_000 }, { minutes: 250, meters: 1_000 }]), POINTS);
  assert.deepEqual(lines, [
    {
      kind: "LONG_DURATION",
      text: "您的行程预计用时 12 小时 30 分，已超出司机单日法定工作时长的建议范围。建议适当缩减行程或减少经停点，让旅途更轻松舒适。",
      longest: "耗时最长的一段：镰仓 → 日光，行驶约 4 小时 10 分。",
    },
  ]);
});

test("距离超限：全程四舍五入到公里，写出距离最长的一段；两种都超时先用时后距离", () => {
  const legs = route([{ minutes: 100, meters: 151_400 }, { minutes: 120, meters: 152_600 }, { minutes: 130, meters: 150_499 }]);
  const lines = itineraryWarningLines({ itinerary_warnings: ["LONG_DURATION", "LONG_DISTANCE"], estimated_minutes: 780 }, legs, POINTS);
  assert.deepEqual(lines.map((line) => line.kind), ["LONG_DURATION", "LONG_DISTANCE"]);
  assert.equal(lines[1]?.text, "您的行程全程约 454 公里，超出单日包车的建议距离，将产生较多超公里费。建议适当缩减行程或减少经停点，让旅途更轻松舒适。");
  assert.equal(lines[1]?.longest, "距离最长的一段：镰仓 → 日光，约 153 公里。");
  assert.equal(lines[0]?.longest, "耗时最长的一段：日光 → 新宿站，行驶约 2 小时 10 分。");
});

test("没有提醒（null、空数组、没有报价）不显示；没有逐段路线时只写提醒、不写最长的一段", () => {
  assert.deepEqual(itineraryWarningLines({ itinerary_warnings: null, estimated_minutes: 900 }, route([{ minutes: 900, meters: 1 }]), POINTS), []);
  assert.deepEqual(itineraryWarningLines({ itinerary_warnings: [], estimated_minutes: 900 }, route([{ minutes: 900, meters: 1 }]), POINTS), []);
  assert.deepEqual(itineraryWarningLines(null, route([{ minutes: 900, meters: 1 }]), POINTS), []);
  const noLegs = itineraryWarningLines({ itinerary_warnings: ["LONG_DURATION", "LONG_DISTANCE"], estimated_minutes: 800 }, { ...route([]), total_meters: 400_000 }, POINTS);
  assert.deepEqual(noLegs.map((line) => [line.kind, line.longest]), [["LONG_DURATION", null], ["LONG_DISTANCE", null]]);
  // 报价没有 T 时用路线的总时长；连路线都没有时距离提醒不写
  assert.match(itineraryWarningLines({ itinerary_warnings: ["LONG_DURATION"], estimated_minutes: null }, route([{ minutes: 700, meters: 1 }]), POINTS)[0]?.text ?? "", /预计用时 12 小时 40 分/);
  assert.deepEqual(itineraryWarningLines({ itinerary_warnings: ["LONG_DISTANCE"], estimated_minutes: 100 }, null, POINTS), []);
});

test("经停点放满、超过在线下单上限的说法（和提醒同一套文案，旧需求第四节第 3 条）", () => {
  assert.equal(waypointLimitText(), "最多 25 个经停点，更多请联系客服定制。");
  assert.equal(UNAVAILABLE_REASON_TEXT.ITINERARY_TOO_LONG, "该行程超出司机单日法定工作时长，无法在线预订。请缩减行程，或联系客服安排分两天用车。");
});
