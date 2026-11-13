/**
 * M9W-04：订单的对外价明细（`orderSellBreakdown`）——从下单用的报价快照拆，只给包车按行程计价的单，对不上时不给。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { QuoteSnapshot, SellPrice, SettlementBreakdown } from "@nozomi/domain";
import { orderSellBreakdown } from "./order-price-notes.ts";

const itinerary = { routeMeters: 260_000, routeMinutes: 540, packageKm: 200, packageMinutes: 600, overMeters: 60_000, overtimeMinutes: 0, overKmPerKmMinor: 300, overtimePerHourMinor: 5_000, overKmMinor: 18_000, overtimeMinor: 0 };
const areaSurcharge = { packageMinor: 55_000, pickup: { areaId: null, amountMinor: 0 }, dropoff: { areaId: null, amountMinor: 0 }, waypoints: [{ areaId: "fuji", stopSeqs: [1], amountMinor: 10_000 }] };
const settlementOf = (extra: Partial<SettlementBreakdown>): SettlementBreakdown =>
  ({ currency: "JPY", roundingUnit: 1, totalMinor: 83_000, baseMinor: 83_000, adjustMinor: 0, urgentMinor: 0, nightMinor: 0, addonsMinor: 0, driverLanguageMinor: 0, areaSurcharge, itinerary, ...extra }) as SettlementBreakdown;
const sell: SellPrice = { currency: "JPY", sellMinor: 91_300, markupBp: 1_000, fxBufferBp: 0, fx: null, exact: "91300" };
const snapshotOf = (settlement: SettlementBreakdown, winnerSell: SellPrice = sell): Pick<QuoteSnapshot, "winner"> =>
  ({ winner: { tenantId: "t", productId: "p", productVersion: 1, offer: { settlement } as QuoteSnapshot["winner"]["offer"], sell: winnerSell } });

test("包车按行程计价：按快照拆出套餐、经停加价、超公里、超时，各项之和等于订单对外价", () => {
  const items = orderSellBreakdown(snapshotOf(settlementOf({})), { currency: "JPY", sellMinor: 91_300 });
  assert.deepEqual(items?.map((item) => [item.kind, item.areaId, item.amountMinor]), [["base", null, 60_500], ["waypoint", "fuji", 11_000], ["over_km", null, 19_800], ["overtime", null, 0]]);
  assert.equal(items?.reduce((sum, item) => sum + item.amountMinor, 0), 91_300);
});

test("不给的情况：没有快照、没按行程计价（旧单）、订单对外价或币种和快照不一样（改期重算过）、倒算的套餐价是负数", () => {
  assert.equal(orderSellBreakdown(null, { currency: "JPY", sellMinor: 91_300 }), null);
  const { itinerary: _itinerary, ...withoutItinerary } = settlementOf({});
  assert.equal(orderSellBreakdown(snapshotOf(withoutItinerary as SettlementBreakdown), { currency: "JPY", sellMinor: 91_300 }), null);
  assert.equal(orderSellBreakdown(snapshotOf(settlementOf({})), { currency: "JPY", sellMinor: 92_400 }), null);
  assert.equal(orderSellBreakdown(snapshotOf(settlementOf({})), { currency: "USD", sellMinor: 91_300 }), null);
  assert.equal(orderSellBreakdown(snapshotOf(settlementOf({}), { ...sell, sellMinor: 20_000 }), { currency: "JPY", sellMinor: 20_000 }), null);
});
