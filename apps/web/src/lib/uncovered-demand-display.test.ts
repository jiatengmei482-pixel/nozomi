import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dateRangeProblem, demandDotRadius, demandMapPoints, endText, refusalName, refusalSummary, serviceLocalText, shiftDate, tokyoToday, tripText } from "./uncovered-demand-display.ts";

describe("未覆盖需求的说法（M8-20）", () => {
  it("用车类型：接机 / 送机 / 点对点 / 包车几小时", () => {
    assert.equal(tripText({ category: "airport_transfer", direction: "pickup", package_hours: null }), "接机");
    assert.equal(tripText({ category: "airport_transfer", direction: "dropoff", package_hours: null }), "送机");
    assert.equal(tripText({ category: "point_to_point", direction: null, package_hours: null }), "点对点");
    assert.equal(tripText({ category: "charter", direction: null, package_hours: 8 }), "包车 8 小时");
  });

  it("两端：有名称写名称，没有写 4 位小数的坐标；没给下车点写「没有给」；用车时间不换算", () => {
    assert.equal(endText("东京站", { lat: 35.6812, lng: 139.7671 }), "东京站");
    assert.equal(endText(null, { lat: 35.68, lng: 139.7 }), "35.6800, 139.7000");
    assert.equal(endText("  ", { lat: 1, lng: 2 }), "1.0000, 2.0000");
    assert.equal(endText(null, null), "没有给");
    assert.equal(serviceLocalText("2026-11-20T09:30"), "2026-11-20 09:30");
  });

  it("拒绝原因：按次数从多到少，认识的写中文，不认识的写原样", () => {
    assert.equal(refusalSummary({ SOLD_OUT: 1, NO_PRICING_AREA: 3 }), "在运营区域里，但商品没有勾选覆盖它的报价区域 × 3、库存不足 × 1");
    assert.equal(refusalSummary({}), "—");
    assert.equal(refusalName("SOMETHING_NEW"), "SOMETHING_NEW");
  });

  it("地图上的点：上车、下车各一个，没给的那一端不画；大小按次数三档", () => {
    const points = demandMapPoints([{ id: "d", category: "charter", reason: "OTHER", repeat_count: 2, pickup: { lat: 1, lng: 2 }, dropoff: null, service_local: "2026-12-01T09:00", last_seen_at: "2026-11-10T01:00:00.000Z" }]);
    assert.deepEqual(points.map((point) => [point.key, point.end]), [["d:p", "pickup"]]);
    assert.deepEqual([1, 2, 4, 5, 100].map(demandDotRadius), [5, 7, 7, 9, 9]);
  });

  it("日期：东京的今天、往前推、范围检查和接口同一套（开始不晚于结束、最长 366 天）", () => {
    assert.equal(tokyoToday(new Date("2026-11-09T15:30:00Z")), "2026-11-10", "UTC 15:30 是东京第二天 0:30");
    assert.equal(shiftDate("2026-03-01", -1), "2026-02-28");
    assert.equal(shiftDate("2026-11-10", -29), "2026-10-12");
    assert.equal(dateRangeProblem("", ""), null);
    assert.equal(dateRangeProblem("2026-11-10", "2026-11-01"), "开始日期不能晚于结束日期。");
    assert.equal(dateRangeProblem("2025-01-01", "2026-01-01"), null, "366 天可以");
    assert.equal(dateRangeProblem("2025-01-01", "2026-01-02"), "日期范围最长 366 天，请缩短。");
    assert.match(dateRangeProblem("2026/11/01", "") ?? "", /写法不对/);
  });
});
