/**
 * 包车经停点和按行程计价的纯逻辑（M9W-02）：停留必填、请求体、排序、时长文字、明细之和必须等于总价、行程时间表、转人工指出经停点。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_WAYPOINTS, STAY_OPTIONS, breakdownLines, durationText, exactKmText, itineraryRouteFailureText, itineraryText, kmText, orderItineraryText, moveWaypoint, scheduleRows, waypointErrors, waypointUnavailableTexts, waypointsBody } from "./charter-itinerary.ts";

const point = (name: string) => ({ name, lat: 35.5, lng: 138.7, kind: null });
const yen = (amount: number) => ({ amount: String(amount), currency: "JPY" });

test("停留时长 30 分钟一档到 8 小时；最多 10 个经停点", () => {
  assert.equal(MAX_WAYPOINTS, 10);
  assert.deepEqual([STAY_OPTIONS[0], STAY_OPTIONS[1], STAY_OPTIONS.at(-1), STAY_OPTIONS.length], [30, 60, 480, 16]);
  assert.deepEqual([durationText(30), durationText(60), durationText(90), durationText(450)], ["30 分钟", "1 小时", "1 小时 30 分", "7 小时 30 分"]);
});

test("地点、停留都必填；都填好了才有请求体（按顺序），一个都没有是空数组", () => {
  assert.deepEqual(waypointsBody([]), []);
  const missing = [{ key: "a", point: point("五合目"), stay: "" }, { key: "b", point: null, stay: "60" }];
  assert.deepEqual(waypointErrors(missing), { a: { stay: "请选择停留时长" }, b: { point: "请选择第 2 个经停点，或删除这一行" } });
  assert.equal(waypointsBody(missing), null);
  assert.deepEqual(waypointErrors([{ key: "c", point: point("x"), stay: "45" }]), { c: { stay: "请选择停留时长" } }, "不是 30 分钟一档的不收");
  assert.deepEqual(waypointsBody([{ key: "a", point: point("五合目"), stay: "60" }, { key: "b", point: point("河口湖"), stay: "90" }]), [
    { name: "五合目", lat: 35.5, lng: 138.7, stay_minutes: 60 },
    { name: "河口湖", lat: 35.5, lng: 138.7, stay_minutes: 90 },
  ]);
});

test("上下移动：到头了不动", () => {
  assert.deepEqual(moveWaypoint(["a", "b", "c"], 1, -1), ["b", "a", "c"]);
  assert.deepEqual(moveWaypoint(["a", "b", "c"], 1, 1), ["a", "c", "b"]);
  assert.deepEqual(moveWaypoint(["a", "b", "c"], 0, -1), ["a", "b", "c"]);
  assert.deepEqual(moveWaypoint(["a", "b", "c"], 2, 1), ["a", "b", "c"]);
});

test("按行程预计：只用服务器算的总时长、行驶、停留和全程；公里四舍五入到 0.1（M9W-09 起，原来向上取）；没有路线时没有这一句", () => {
  const route = { legs: [{ minutes: 100, meters: 60_000 }, { minutes: 50, meters: 30_020 }], drive_minutes: 150, stay_minutes: 90, total_minutes: 240, total_meters: 90_020 };
  assert.equal(itineraryText(route, 8), "按行程预计 4 小时（行驶 2 小时 30 分 + 停留 1 小时 30 分），全程约 90 公里，套餐 8 小时");
  assert.equal(itineraryText({ ...route, total_meters: 90_050 }, 8), "按行程预计 4 小时（行驶 2 小时 30 分 + 停留 1 小时 30 分），全程约 90.1 公里，套餐 8 小时");
  assert.equal(itineraryText({ ...route, stay_minutes: 0, total_minutes: 150, total_meters: 90_000 }, null), "按行程预计 2 小时 30 分，全程约 90 公里");
  assert.equal(itineraryText(undefined, 8), null);
  assert.equal(orderItineraryText({ route_meters: 254_000, route_minutes: 450, package_km: 200, package_minutes: 600, over_meters: 54_000, overtime_minutes: 0 }), "全程约 254 公里，预计 7 小时 30 分（含停留）");
  assert.equal(orderItineraryText(null), null);
});

test("公里数的两种口径（M9W-09）：「约」四舍五入到 0.1 公里；后台算式按米精确，和按米算的金额对得上", () => {
  assert.equal(kmText(65_722), "65.7 公里");
  assert.equal(kmText(265_722), "265.7 公里");
  assert.equal(kmText(265_750), "265.8 公里");
  assert.equal(kmText(254_000), "254 公里");
  assert.equal(kmText(0), "0 公里");
  assert.equal(kmText(1_234_560), "1,234.6 公里");
  assert.equal(exactKmText(65_722), "65.722 公里");
  assert.equal(exactKmText(265_722), "265.722 公里");
  assert.equal(exactKmText(54_300), "54.3 公里");
  assert.equal(exactKmText(65_720), "65.72 公里");
  assert.equal(exactKmText(260_000), "260 公里");
  assert.equal(exactKmText(0), "0 公里");
  assert.equal(exactKmText(1_234_005), "1,234.005 公里");
  assert.equal(orderItineraryText({ route_meters: 265_722, route_minutes: 540, package_km: 200, package_minutes: 600, over_meters: 65_722, overtime_minutes: 0 }), "全程约 265.7 公里，预计 9 小时（含停留）");
  assert.equal(orderItineraryText({ route_meters: 0, route_minutes: 60, package_km: 200, package_minutes: 600, over_meters: 0, overtime_minutes: 0 }), "全程约 0 公里，预计 1 小时（含停留）");
});

test("按行程计价有一段路线算不出来：说清是哪两个点之间；段号不对时笼统地说", () => {
  const points = ["新宿", "五合目", "河口湖", "新宿站"];
  assert.equal(itineraryRouteFailureText(2, points), "「五合目」到「河口湖」这一段路线暂时算不出来，没有在线报价。请联系客服人工报价，或调整经停点再试。");
  assert.equal(itineraryRouteFailureText(9, points), "有一段路线暂时算不出来，没有在线报价。请联系客服人工报价，或调整经停点再试。");
  assert.equal(itineraryRouteFailureText("x", points), "有一段路线暂时算不出来，没有在线报价。请联系客服人工报价，或调整经停点再试。");
});

test("明细：各项之和等于总价才给；对不上、币种不同、读不出来、没有明细都是 null", () => {
  const items = [
    { kind: "base" as const, amount: yen(60_500), area_name: null, stop_seqs: null },
    { kind: "pickup" as const, amount: yen(550), area_name: { zh: "东区" }, stop_seqs: null },
    { kind: "waypoint" as const, amount: yen(11_000), area_name: { zh: "富士山地区" }, stop_seqs: [1, 3] },
    { kind: "adjust" as const, amount: yen(-550), area_name: null, stop_seqs: null },
    { kind: "other" as const, amount: yen(1_000), area_name: null, stop_seqs: null },
  ];
  const quote = { price: { total: yen(72_500), fx: null }, price_breakdown: items };
  assert.deepEqual(
    breakdownLines(quote, 10)?.map((line) => [line.label, line.amount]),
    [
      ["包车套餐 10 小时", "60,500 JPY"],
      ["上车加价（东区）", "550 JPY"],
      ["经停加价（富士山地区，第 1、3 个经停点）", "11,000 JPY"],
      ["调价", "-550 JPY"],
      ["其他费用（加急、夜间、附加服务等）", "1,000 JPY"],
    ],
  );
  assert.equal(breakdownLines({ ...quote, price: { total: yen(72_501), fx: null } }, 10), null);
  assert.equal(breakdownLines({ ...quote, price_breakdown: items.map((item) => ({ ...item, amount: { ...item.amount, currency: "USD" } })) }, 10), null);
  assert.equal(breakdownLines({ ...quote, price_breakdown: [{ ...items[0]!, amount: { amount: "abc", currency: "JPY" } }] }, 10), null);
  assert.equal(breakdownLines({ price: quote.price }, 10), null);
  assert.equal(breakdownLines({ price: { total: yen(100), fx: null }, price_breakdown: [{ kind: "base", amount: yen(100), area_name: null, stop_seqs: null }] }, null)?.[0]?.label, "基础价");
});

test("行程时间表：上车 → 经停 → 下车；段数对得上才写行驶分钟", () => {
  const stops = [{ name: "五合目", stay_minutes: 60 }];
  assert.deepEqual(
    scheduleRows("新宿", "河口湖", stops, [{ minutes: 120 }, { minutes: 30 }]).map((row) => [row.label, row.name, row.driveMinutes, row.stayMinutes]),
    [
      ["上车", "新宿", null, null],
      ["经停 1", "五合目", 120, 60],
      ["下车", "河口湖", 30, null],
    ],
  );
  assert.deepEqual(scheduleRows("新宿", "河口湖", stops, [{ minutes: 120 }]).map((row) => row.driveMinutes), [null, null, null]);
  assert.deepEqual(scheduleRows("新宿", null, stops).map((row) => row.label), ["上车", "经停 1"]);
});

test("经停点报不出价：指出第几个、叫什么；没有编号时一句笼统的；没有这个原因时空", () => {
  const stops = [{ name: "五合目" }, { name: "河口湖" }, { name: "忠灵塔" }];
  assert.deepEqual(waypointUnavailableTexts([{ vehicle_group_id: null, reasons: ["WAYPOINT_NOT_PRICED"], waypoint_stop_seqs: [3, 1] }], stops), ["第 1 个经停点「五合目」、第 3 个经停点「忠灵塔」暂时没有在线报价，请联系客服人工报价，或去掉这个经停点再试。"]);
  assert.deepEqual(waypointUnavailableTexts([{ vehicle_group_id: null, reasons: ["WAYPOINT_NOT_PRICED"] }], stops), ["有经停点暂时没有在线报价，请联系客服人工报价，或去掉这个经停点再试。"]);
  assert.deepEqual(waypointUnavailableTexts([{ vehicle_group_id: null, reasons: ["SOLD_OUT"] }], stops), []);
});
