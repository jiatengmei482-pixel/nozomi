/** 汇率中心的纯计算部分（不连数据库）：曲线按批次换算到选的基准币种。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fxSeries } from "./fx-center.ts";

const day = (n: number): Date => new Date(Date.UTC(2026, 9, n));

test("曲线：每批汇率一个点，换算成「1 个基准 = ? 个该币种」；某批缺这个币种就没有这个点；基准币种自己不画", () => {
  const history = [
    { asOf: day(1), quote: "JPY" as const, rate: "150" },
    { asOf: day(1), quote: "CNY" as const, rate: "7.2" },
    { asOf: day(2), quote: "JPY" as const, rate: "151.2" },
    { asOf: day(2), quote: "CNY" as const, rate: "7.2" },
    { asOf: day(3), quote: "JPY" as const, rate: "152" },
  ];
  const usd = fxSeries(history, "USD");
  assert.deepEqual(usd.find((series) => series.currency === "JPY")?.points.map((point) => point.rate), ["150", "151.2", "152"]);
  const cny = fxSeries(history, "CNY");
  assert.equal(cny.some((series) => series.currency === "CNY"), false);
  assert.deepEqual(cny.find((series) => series.currency === "JPY")?.points, [
    { asOf: day(1), rate: "20.833333333333" },
    { asOf: day(2), rate: "21" },
  ]);
  assert.deepEqual(cny.find((series) => series.currency === "USD")?.points.map((point) => point.rate), ["0.138888888889", "0.138888888889"]);
  assert.deepEqual(cny.find((series) => series.currency === "KRW")?.points, []);
});
