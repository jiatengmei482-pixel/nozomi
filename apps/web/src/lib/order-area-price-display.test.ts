import { test } from "node:test";
import assert from "node:assert/strict";
import { hasAreaSurcharge, itineraryOverageLines, platformDistanceLines, pricingRouteText, tenantDistanceLines, tenantSurchargeLines } from "./order-area-price-display.ts";
import { siteDistanceNote } from "./site-display.ts";

const yen = (amount: string) => ({ amount, currency: "JPY" });

test("用的价格：线路价 / 区域价；不知道上车区域、区域删了时的写法", () => {
  assert.equal(pricingRouteText({ kind: "route", area: { id: "a", name: { zh: "东京 23 区" } }, to_area: { id: "b", name: { zh: "成田周边" } } }), "线路价 · 东京 23 区 → 成田周边");
  assert.equal(pricingRouteText({ kind: "area", area: { id: "a", name: { zh: "东京 23 区" } }, to_area: null }), "区域价 · 东京 23 区");
  assert.equal(pricingRouteText({ kind: "route", area: null, to_area: { id: "b", name: { zh: "成田周边" } } }), "线路价 · 下车区域 成田周边");
  assert.equal(pricingRouteText({ kind: "route", area: { id: "a", name: null }, to_area: { id: "b", name: null } }), "线路价 · （已删除的区域） → （已删除的区域）");
  assert.equal(pricingRouteText({ kind: "area", area: null, to_area: null }), "区域价");
  assert.equal(pricingRouteText(null), null);
  assert.equal(pricingRouteText(undefined), null);
});

test("公里数：运营三行（对外价参考没有时写 —）；供应商一行带结算单价，币种在前", () => {
  const distance = { included_km: 30, route_meters: 34_153, over_km: 5, over_km_per_km: yen("250") };
  assert.deepEqual(platformDistanceLines({ ...distance, over_km_per_km_sell: yen("300") }), { summary: "含 30 公里 · 路线约 34.2 公里（报价时）· 超出 5 公里", perKm: "每公里 对外 300 JPY / 结算 250 JPY", meters: "路线 34,153 米" });
  assert.equal(platformDistanceLines({ ...distance, over_km_per_km_sell: null })?.perKm, "每公里 对外 — / 结算 250 JPY");
  assert.deepEqual(tenantDistanceLines(distance), { summary: "含 30 公里 · 路线约 34.2 公里（报价时）· 超出 5 公里 × JPY 250", meters: "路线 34,153 米" });
  assert.equal(tenantDistanceLines({ ...distance, over_km_per_km: { amount: "x", currency: "JPY" } })?.summary, "含 30 公里 · 路线约 34.2 公里（报价时）· 超出 5 公里", "金额读不出来时不写单价，不猜");
  assert.equal(tenantDistanceLines(null), null);
});

test("区域加价：两端都在服务区域里不算有加价；供应商写「加 JPY 1,000」", () => {
  const end = (area_id: string | null, amount: string) => ({ area_id, area_name: area_id === null ? null : { zh: "富士山" }, settlement: yen(amount) });
  assert.equal(hasAreaSurcharge({ package_settlement: yen("70000"), pickup: end(null, "0"), dropoff: end(null, "0") }), false);
  assert.deepEqual(tenantSurchargeLines({ package_settlement: yen("70000"), pickup: end(null, "0"), dropoff: end("a", "1000") }), ["上车：在服务区域里，不加价", "下车：富士山 · 加 JPY 1,000"]);
});

test("官网含公里数那一句：对外价的十进制写法换成最小单位交给 domain；币种不认识、写法不对、没有这一项时不写", () => {
  assert.equal(siteDistanceNote({ included_km: 30, route_meters: 34_200, over_km: 5, over_km_per_km: { amount: "12.50", currency: "CNY" } }), "含 30 公里，本次路线约 34.2 公里，超出 5 公里 × 12.50 CNY（已含在一口价里）");
  assert.equal(siteDistanceNote({ included_km: 30, route_meters: 34_200, over_km: 5, over_km_per_km: { amount: "330", currency: "XXX" } }), null);
  assert.equal(siteDistanceNote({ included_km: 30, route_meters: 34_200, over_km: 5, over_km_per_km: { amount: "3.3", currency: "JPY" } }), null);
  assert.equal(siteDistanceNote(null), null);
  assert.equal(siteDistanceNote(undefined), null);
});

test("超公里 / 超时（M9W-04）：运营「18,000 JPY」、供应商「JPY 18,000」，都是结算价；没超出写 0；没按行程计价为 null", () => {
  const itinerary = { route_meters: 254_300, route_minutes: 450, package_km: 200, package_minutes: 480, over_meters: 54_300, overtime_minutes: 0, over_km_fee: yen("16290"), overtime_fee: yen("0"), over_km_per_km: yen("300"), overtime_per_hour: yen("5000") };
  assert.deepEqual(itineraryOverageLines("platform", itinerary), ["超公里：全程 254.3 公里，套餐含 200 公里，超出 54.3 公里 × 每公里 300 JPY = 16,290 JPY", "超时：预计 7 小时 30 分（含停留），套餐 8 小时，超出 0 分钟 × 每小时 5,000 JPY = 0 JPY"]);
  assert.deepEqual(itineraryOverageLines("tenant", itinerary), ["超公里：全程 254.3 公里，套餐含 200 公里，超出 54.3 公里 × 每公里 JPY 300 = JPY 16,290", "超时：预计 7 小时 30 分（含停留），套餐 8 小时，超出 0 分钟 × 每小时 JPY 5,000 = JPY 0"]);
  assert.equal(itineraryOverageLines("tenant", null), null);
  assert.equal(itineraryOverageLines("platform", undefined), null);
});

test("超公里算式的公里数按米精确（M9W-09）：265,722 米、超出 65,722 米 × 每公里 100 = 6,572（6,572.2 取整，注明按米计）；整数公里、0 米不注", () => {
  const base = { route_meters: 265_722, route_minutes: 540, package_km: 200, package_minutes: 600, over_meters: 65_722, overtime_minutes: 0, over_km_fee: yen("6572"), overtime_fee: yen("0"), over_km_per_km: yen("100"), overtime_per_hour: yen("5000") };
  assert.equal(itineraryOverageLines("tenant", base)?.[0], "超公里：全程 265.722 公里，套餐含 200 公里，超出 65.722 公里 × 每公里 JPY 100 = JPY 6,572（按米计，四舍五入）");
  assert.equal(itineraryOverageLines("platform", base)?.[0], "超公里：全程 265.722 公里，套餐含 200 公里，超出 65.722 公里 × 每公里 100 JPY = 6,572 JPY（按米计，四舍五入）");
  // 65,720 米 × 100 = 6,572 正好是整数：不注
  assert.equal(itineraryOverageLines("tenant", { ...base, route_meters: 265_720, over_meters: 65_720 })?.[0], "超公里：全程 265.72 公里，套餐含 200 公里，超出 65.72 公里 × 每公里 JPY 100 = JPY 6,572");
  assert.equal(itineraryOverageLines("tenant", { ...base, route_meters: 260_000, over_meters: 60_000, over_km_fee: yen("6000") })?.[0], "超公里：全程 260 公里，套餐含 200 公里，超出 60 公里 × 每公里 JPY 100 = JPY 6,000");
  assert.equal(itineraryOverageLines("tenant", { ...base, route_meters: 0, over_meters: 0, over_km_fee: yen("0") })?.[0], "超公里：全程 0 公里，套餐含 200 公里，超出 0 公里 × 每公里 JPY 100 = JPY 0");
  // 小数币种按最小单位判断：65,722 米 × 12.50 CNY = 821.525 → 注明
  assert.equal(itineraryOverageLines("tenant", { ...base, over_km_per_km: { amount: "12.50", currency: "CNY" }, over_km_fee: { amount: "821.53", currency: "CNY" } })?.[0], "超公里：全程 265.722 公里，套餐含 200 公里，超出 65.722 公里 × 每公里 CNY 12.50 = CNY 821.53（按米计，四舍五入）");
  // 单价读不出来：不猜，不注
  assert.equal(itineraryOverageLines("tenant", { ...base, over_km_per_km: { amount: "100", currency: "XXX" } })?.[0], "超公里：全程 265.722 公里，套餐含 200 公里，超出 65.722 公里 × 每公里 XXX 100 = JPY 6,572");
});
