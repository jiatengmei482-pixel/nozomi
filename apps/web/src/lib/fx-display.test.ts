import { test } from "node:test";
import assert from "node:assert/strict";
import { FX_CURRENCIES, FX_FETCH_STATUSES } from "@nozomi/domain";
import { CURRENCY_NAMES, FX_DISPLAY_ORDER, FX_FETCH_BADGES, changeText, chartModel, fetchTriggerText, rateText } from "./fx-display.ts";

test("汇率的显示写法：只在字符串上截短，不进位、不经过浮点数", () => {
  assert.equal(rateText("20.833333333333"), "20.8333");
  assert.equal(rateText("150"), "150");
  assert.equal(rateText("151.2"), "151.2");
  assert.equal(rateText("1400.50001"), "1400.5");
  assert.equal(rateText("0.000714030703"), "0.000714030");
  assert.equal(rateText("0.048"), "0.048");
  assert.equal(rateText("0.138888888889"), "0.138888");
  assert.equal(rateText(null), "—");
});

test("变动幅度：基点 → 带符号的百分比，两位小数", () => {
  assert.deepEqual([changeText(400), changeText(-301), changeText(5), changeText(0), changeText(10_000)], ["+4.00%", "−3.01%", "+0.05%", "0.00%", "+100.00%"]);
});

test("每个币种都有中文名、每种拉取结果都有徽标；显示顺序覆盖全部币种", () => {
  for (const currency of FX_CURRENCIES) assert.ok(CURRENCY_NAMES[currency], currency);
  assert.deepEqual([...FX_DISPLAY_ORDER].sort(), [...FX_CURRENCIES].sort());
  for (const status of FX_FETCH_STATUSES) assert.ok(FX_FETCH_BADGES[status].label, status);
  assert.equal(fetchTriggerText({ trigger: "schedule", triggered_by: null }), "定时");
  assert.equal(fetchTriggerText({ trigger: "manual", triggered_by: { id: "x", name: "王五" } }), "手动（王五）");
});

test("曲线坐标：横轴按时间、纵轴按最低到最高；只有一个点画在中间；没有点为 null", () => {
  const model = chartModel(
    [
      { as_of: "2026-10-01T00:00:00Z", rate: "150" },
      { as_of: "2026-10-02T00:00:00Z", rate: "152" },
      { as_of: "2026-10-03T00:00:00Z", rate: "151" },
    ],
    216,
    116,
  );
  assert.deepEqual(model, { points: [{ x: 8, y: 108 }, { x: 108, y: 8 }, { x: 208, y: 58 }], min: "150", max: "152", first: "2026-10-01T00:00:00Z", last: "2026-10-03T00:00:00Z" });
  assert.deepEqual(chartModel([{ as_of: "2026-10-01T00:00:00Z", rate: "7.2" }], 100, 50, 10)?.points, [{ x: 50, y: 25 }]);
  assert.equal(chartModel([], 100, 50), null);
});
