/**
 * 包车经停点和按行程计价的纯逻辑（M9W-02）：停留必填、请求体、排序、时长文字、明细之和必须等于总价、行程时间表、转人工指出经停点。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_WAYPOINTS, STAY_OPTIONS, autoPackageChoice, autoPackageHoursByVehicle, breakdownLines, estimatedTimeText, hoursMinutesText, minPackageHints, upgradePackageHours, durationText, itineraryMapAlt, itineraryMapPoints, itineraryRouteFailureText, itineraryText, orderItineraryText, moveWaypoint, scheduleRows, waypointErrors, waypointUnavailableTexts, waypointsBody } from "./charter-itinerary.ts";

const point = (name: string) => ({ name, lat: 35.5, lng: 138.7, kind: null });
const yen = (amount: number) => ({ amount: String(amount), currency: "JPY" });

test("停留时长 30 分钟一档到 8 小时；最多 25 个经停点（M9P-10，和后端同一个常量）", () => {
  assert.equal(MAX_WAYPOINTS, 25);
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

test("按行程预计：只用服务器算的总时长、行驶、停留和全程；公里向上取整到 0.1；没有路线时没有这一句", () => {
  const route = { legs: [{ minutes: 100, meters: 60_000 }, { minutes: 50, meters: 30_020 }], drive_minutes: 150, stay_minutes: 90, total_minutes: 240, total_meters: 90_020 };
  assert.equal(itineraryText(route, 8), "按行程预计 4 小时（行驶 2 小时 30 分 + 停留 1 小时 30 分），全程约 90.1 公里，套餐 8 小时");
  assert.equal(itineraryText({ ...route, stay_minutes: 0, total_minutes: 150, total_meters: 90_000 }, null), "按行程预计 2 小时 30 分，全程约 90 公里");
  assert.equal(itineraryText(undefined, 8), null);
  assert.equal(orderItineraryText({ route_meters: 254_000, route_minutes: 450, package_km: 200, package_minutes: 600, over_meters: 54_000, overtime_minutes: 0 }), "全程约 254 公里，预计 7 小时 30 分（含停留）");
  assert.equal(orderItineraryText(null), null);
});

test("按行程计价有一段路线算不出来：说清第几段、是哪两个点之间（编号上车 = 1，M9P-20）；段号不对时笼统地说", () => {
  const points = ["新宿", "五合目", "河口湖", "新宿站"];
  assert.equal(itineraryRouteFailureText(2, points), "第 2 段（2「五合目」→ 3「河口湖」）路线暂时算不出来，没有在线报价。请联系客服人工报价，或调整经停点再试。");
  assert.equal(itineraryRouteFailureText(1, points), "第 1 段（1「新宿」→ 2「五合目」）路线暂时算不出来，没有在线报价。请联系客服人工报价，或调整经停点再试。");
  assert.equal(itineraryRouteFailureText(0, points), "有一段路线暂时算不出来，没有在线报价。请联系客服人工报价，或调整经停点再试。");
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
      ["行程加价（富士山地区，2、4 · 经停）", "11,000 JPY"],
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

test("行程时间表：上车 = 1、经停依次、下车 = 最后（M9P-20）；段数对得上才写每段的行驶分钟和米数", () => {
  const stops = [{ name: "五合目", stay_minutes: 60 }];
  assert.deepEqual(
    scheduleRows("新宿", "河口湖", stops, [
      { minutes: 120, meters: 98_400 },
      { minutes: 30, meters: 21_050 },
    ]).map((row) => [row.number, row.label, row.name, row.driveMinutes, row.driveMeters, row.stayMinutes]),
    [
      [1, "1 上车", "新宿", null, null, null],
      [2, "2 经停", "五合目", 120, 98_400, 60],
      [3, "3 下车", "河口湖", 30, 21_050, null],
    ],
  );
  assert.deepEqual(scheduleRows("新宿", "河口湖", stops, [{ minutes: 120 }]).map((row) => row.driveMinutes), [null, null, null]);
  assert.deepEqual(scheduleRows("新宿", "河口湖", stops, [{ minutes: 120 }, { minutes: 30 }]).map((row) => row.driveMeters), [null, null, null], "没有米数时不写公里");
  assert.deepEqual(scheduleRows("新宿", null, stops).map((row) => row.label), ["1 上车", "2 经停"], "没有下车点的旧订单：最后一个仍是经停");
  assert.deepEqual(scheduleRows("新宿", "河口湖", []).map((row) => row.label), ["1 上车", "2 下车"]);
  const ten = scheduleRows("新宿", "新宿", Array.from({ length: 10 }, (_, i) => ({ name: `点${i + 1}`, stay_minutes: 30 })));
  assert.deepEqual(ten.map((row) => row.number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual([ten[10]?.label, ten[11]?.label], ["11 经停", "12 下车"]);
});

test("行程地图的替代文字：全程各点带编号，有路线时加总时长和公里", () => {
  const rows = scheduleRows("新宿", "新宿", [
    { name: "河口湖", stay_minutes: 60 },
    { name: "箱根", stay_minutes: 60 },
  ]);
  assert.equal(itineraryMapAlt(rows, { total_minutes: 370, total_meters: 311_950 }), "路线图：1 新宿 → 2 河口湖 → 3 箱根 → 4 新宿，约 6 小时 10 分 · 312 公里");
  assert.equal(itineraryMapAlt(rows, null), "路线图：1 新宿 → 2 河口湖 → 3 箱根 → 4 新宿");
});

test("经停点报不出价：指出第几个、叫什么；没有编号时一句笼统的；没有这个原因时空", () => {
  const stops = [{ name: "五合目" }, { name: "河口湖" }, { name: "忠灵塔" }];
  assert.deepEqual(waypointUnavailableTexts([{ vehicle_group_id: null, reasons: ["WAYPOINT_NOT_PRICED"], waypoint_stop_seqs: [3, 1] }], stops), ["2 号点「五合目」、4 号点「忠灵塔」暂时没有在线报价，请联系客服人工报价，或去掉这个经停点再试。"]);
  assert.deepEqual(waypointUnavailableTexts([{ vehicle_group_id: null, reasons: ["WAYPOINT_NOT_PRICED"] }], stops), ["有经停点暂时没有在线报价，请联系客服人工报价，或去掉这个经停点再试。"]);
  assert.deepEqual(waypointUnavailableTexts([{ vehicle_group_id: null, reasons: ["SOLD_OUT"] }], stops), []);
});

test("M8-43 明细：金额为 0 的超公里费、超时费不列；不是 0 的照旧列；别的项目是 0 也照旧列；先按全部项目核对总价", () => {
  const quote = (overKm: number, overtime: number, adjust = 0) => ({
    price: { total: yen(60_500 + overKm + overtime + adjust), fx: null },
    price_breakdown: [
      { kind: "base" as const, amount: yen(60_500), area_name: null, stop_seqs: null },
      { kind: "over_km" as const, amount: yen(overKm), area_name: null, stop_seqs: null },
      { kind: "overtime" as const, amount: yen(overtime), area_name: null, stop_seqs: null },
      { kind: "adjust" as const, amount: yen(adjust), area_name: null, stop_seqs: null },
    ],
  });
  const labels = (q: ReturnType<typeof quote>) => breakdownLines(q, 10)?.map((line) => [line.label, line.amount]);
  assert.deepEqual(labels(quote(0, 0)), [["包车套餐 10 小时", "60,500 JPY"], ["调价", "0 JPY"]]);
  assert.deepEqual(labels(quote(7_229, 0)), [["包车套餐 10 小时", "60,500 JPY"], ["超公里费", "7,229 JPY"], ["调价", "0 JPY"]]);
  assert.deepEqual(labels(quote(0, 605)), [["包车套餐 10 小时", "60,500 JPY"], ["超时费", "605 JPY"], ["调价", "0 JPY"]]);
  assert.deepEqual(labels(quote(7_229, 605, -100)), [["包车套餐 10 小时", "60,500 JPY"], ["超公里费", "7,229 JPY"], ["超时费", "605 JPY"], ["调价", "-100 JPY"]]);
  // 去掉的 0 不影响核对：总价对不上照样不给明细
  assert.equal(breakdownLines({ ...quote(0, 0), price: { total: yen(60_501), fx: null } }, 10), null);
});

test("M9P-04 有经停点时的套餐下拉按车型：选了车型写它自己的自动档、只列比它长的；没选时各车型一样就写这一档，不一样写范围、只列比最长的还长的；能升的去重、从短到长", () => {
  const vg = (id: string) => ({ id, code: id, name: { zh: id }, grade: "economy", seats: 7, sample_models: [], combos: [] }) as never;
  // 用例 10：经济 7 座自动 5 小时（4 小时含公里不够、更贵），别的车型 4 小时
  const byVehicle = autoPackageHoursByVehicle([{ vehicle_group: vg("eco7"), auto_package_hours: 5 }, { vehicle_group: vg("biz5"), auto_package_hours: 4 }, { vehicle_group: vg("old"), auto_package_hours: null }, { vehicle_group: vg("older") }]);
  assert.deepEqual(byVehicle, { eco7: 5, biz5: 4 });
  assert.deepEqual(autoPackageChoice(byVehicle, "eco7", ["eco7", "biz5"]), { label: "自动（5 小时）", floor: 5 });
  assert.deepEqual(autoPackageChoice(byVehicle, "biz5", ["eco7", "biz5"]), { label: "自动（4 小时）", floor: 4 });
  assert.deepEqual(upgradePackageHours([4, 5, 6, 8], autoPackageChoice(byVehicle, "eco7", [])?.floor ?? null), [6, 8], "选经济 7 座：不列 4、5 小时");
  assert.deepEqual(upgradePackageHours([4, 5, 6, 8], autoPackageChoice(byVehicle, "biz5", [])?.floor ?? null), [5, 6, 8]);
  assert.deepEqual(autoPackageChoice(byVehicle, null, ["eco7", "biz5"]), { label: "自动（按车型 4–5 小时）", floor: 5 });
  assert.deepEqual(autoPackageChoice(byVehicle, null, ["biz5"]), { label: "自动（4 小时）", floor: 4 }, "只按列出来的车型");
  assert.deepEqual(autoPackageChoice(byVehicle, "gone", []), { label: "自动（按车型 4–5 小时）", floor: 5 }, "选的车型报不出了、列表也空：按记得的");
  assert.equal(autoPackageChoice({}, null, []), null);
  assert.deepEqual(upgradePackageHours([10, 4, 8, 5, 10, 12], 5), [8, 10, 12]);
  assert.deepEqual(upgradePackageHours([4, 5], 5), []);
  assert.deepEqual(upgradePackageHours([4, 8, 10], null), []);
});

test("经停超过 10 个（M9P-10 放开上限后）：列表编号照常到 27；地图最多 12 个点，超过不画图（只显示列表）", () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ name: `点${i + 1}`, stay_minutes: 30 }));
  const rows = scheduleRows("新宿", "新宿", many);
  assert.deepEqual(rows.map((row) => row.number), Array.from({ length: 27 }, (_, i) => i + 1));
  assert.deepEqual([rows[25]?.label, rows[26]?.label], ["26 经停", "27 下车"]);
  const at = (i: number) => ({ lat: 35 + i / 100, lng: 139 });
  assert.equal(itineraryMapPoints(at(0), Array.from({ length: 10 }, (_, i) => at(i + 1)), at(11))?.length, 12);
  assert.equal(itineraryMapPoints(at(0), Array.from({ length: 11 }, (_, i) => at(i + 1)), at(12)), null);
  assert.deepEqual(itineraryMapPoints(at(0), [], at(1)), [at(0), at(1)]);
});

test("M9P-04 预计用时：「X 小时 Y 分钟（含缓冲）」写在套餐那一行下面；没含缓冲不写「含缓冲」；超过套餐时说超出部分服务后收；不按行程计价没有", () => {
  assert.equal(hoursMinutesText(252), "4 小时 12 分钟");
  assert.equal(hoursMinutesText(300), "5 小时");
  assert.equal(hoursMinutesText(45), "45 分钟");
  assert.equal(estimatedTimeText({ estimated_minutes: 252, includes_buffer: true }, 5), "预计用时 4 小时 12 分钟（含缓冲）");
  assert.equal(estimatedTimeText({ estimated_minutes: 177, includes_buffer: false }, 5), "预计用时 2 小时 57 分钟");
  assert.equal(estimatedTimeText({ estimated_minutes: 780, includes_buffer: true }, 12), "预计用时 13 小时（含缓冲），超过套餐时长，超出部分服务后按实际收取");
  assert.equal(estimatedTimeText({ estimated_minutes: null, includes_buffer: null }, 8), null);
  // 边界：预计用时正好等于套餐时长不算超过（引擎的候选是「时长 ≥ T」），多 1 分钟才算
  assert.equal(estimatedTimeText({ estimated_minutes: 300, includes_buffer: true }, 5), "预计用时 5 小时（含缓冲）");
  assert.equal(estimatedTimeText({ estimated_minutes: 301, includes_buffer: true }, 5), "预计用时 5 小时 1 分钟（含缓冲），超过套餐时长，超出部分服务后按实际收取");
  assert.equal(estimatedTimeText({ estimated_minutes: 299, includes_buffer: false }, 5), "预计用时 4 小时 59 分钟");
  const quote = { price: { total: yen(41_000), fx: null }, estimated_minutes: 252, includes_buffer: true, price_breakdown: [{ kind: "base" as const, amount: yen(33_000), area_name: null, stop_seqs: null }, { kind: "waypoint" as const, amount: yen(8_000), area_name: { zh: "镰仓" }, stop_seqs: [1] }] };
  assert.deepEqual(breakdownLines(quote, 5)?.map((line) => [line.label, line.amount, line.note ?? null]), [
    ["包车套餐 5 小时", "33,000 JPY", "预计用时 4 小时 12 分钟（含缓冲）"],
    ["行程加价（镰仓，2 · 经停）", "8,000 JPY", null],
  ]);
});

test("M9P-04 明细逐项：套餐、上车加价、下车加价、行程加价（按第几个经停，下车点那一条写「下车点」、排最后）、超公里、调价；不填经停点时也一样逐项", () => {
  const items = [
    { kind: "base" as const, amount: yen(55_000), area_name: null, stop_seqs: null },
    { kind: "pickup" as const, amount: yen(10_000), area_name: { zh: "富士山" }, stop_seqs: null },
    { kind: "waypoint" as const, amount: yen(10_000), area_name: { zh: "箱根" }, stop_seqs: [2] },
    { kind: "waypoint" as const, amount: yen(8_000), area_name: { zh: "镰仓" }, stop_seqs: [1] },
    { kind: "dropoff" as const, amount: yen(10_000), area_name: { zh: "富士山" }, stop_seqs: null },
    { kind: "over_km" as const, amount: yen(1_000), area_name: null, stop_seqs: null },
  ];
  assert.deepEqual(breakdownLines({ price: { total: yen(94_000), fx: null }, price_breakdown: items }, 10)?.map((line) => line.label), ["包车套餐 10 小时", "上车加价（富士山）", "下车加价（富士山）", "行程加价（镰仓，2 · 经停）", "行程加价（箱根，3 · 经停）", "超公里费"]);
  // 规格用例 16：新宿 → 河口湖站下车，不填经停点：套餐 + 下车加价 + 下车点行程加价
  const noStops = [
    { kind: "base" as const, amount: yen(60_500), area_name: null, stop_seqs: null },
    { kind: "waypoint" as const, amount: yen(11_000), area_name: { zh: "富士山" }, stop_seqs: [], from_dropoff: true as const },
    { kind: "dropoff" as const, amount: yen(11_000), area_name: { zh: "富士山" }, stop_seqs: null },
  ];
  assert.deepEqual(breakdownLines({ price: { total: yen(82_500), fx: null }, price_breakdown: noStops, estimated_minutes: null, includes_buffer: null }, 10)?.map((line) => [line.label, line.amount, line.note ?? null]), [
    ["包车套餐 10 小时", "60,500 JPY", null],
    ["下车加价（富士山）", "11,000 JPY", null],
    ["行程加价（富士山，下车点）", "11,000 JPY", null],
  ]);
});

test("M9P-04 选的时长低于最低套餐（ADR 0093 第四节第 7 条）：按最短时长分组写几个车型最短几小时；不比所选长的、别的原因、没带时长的不算", () => {
  const unavailable = [
    { vehicle_group_id: "a", reasons: ["PACKAGE_TOO_SHORT" as const], min_package_hours: 5 },
    { vehicle_group_id: "b", reasons: ["PACKAGE_TOO_SHORT" as const], min_package_hours: 5 },
    { vehicle_group_id: "c", reasons: ["PACKAGE_TOO_SHORT" as const], min_package_hours: 8 },
    { vehicle_group_id: "d", reasons: ["SOLD_OUT" as const], min_package_hours: 6 },
    { vehicle_group_id: "e", reasons: ["PACKAGE_TOO_SHORT" as const] },
    { vehicle_group_id: "f", reasons: ["PACKAGE_TOO_SHORT" as const], min_package_hours: 4 },
  ];
  assert.deepEqual(minPackageHints(unavailable, 4), [
    { hours: 5, count: 2, text: "有 2 个车型最短 5 小时，选 4 小时订不了。" },
    { hours: 8, count: 1, text: "有一个车型最短 8 小时，选 4 小时订不了。" },
  ]);
  assert.deepEqual(minPackageHints(unavailable, 8), []);
  assert.deepEqual(minPackageHints([], 4), []);
});
