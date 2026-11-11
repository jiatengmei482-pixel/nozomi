/**
 * 后台订单详情、报价试算的「计价方式」（M8-30b，ADR 0080）：一口价不出这一项；一口价 + 区域外里程费、按计程价写明细；
 * 运营、供应商都只写结算价（规则 4：供应商后台不出现对外价、加价比例）。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render } from "@testing-library/react";
import { pricingBasisLines } from "../lib/pricing-basis-display.ts";
import { OrderAreaPriceItems } from "./OrderAreaPriceItems.tsx";

afterEach(cleanup);

const yen = (amount: string) => ({ amount, currency: "JPY" });
const outside = { route_meters: 41_350, included_km: 30, km: 12, start_price: yen("0"), per_km: yen("300"), fee: yen("3600") };
const distance = { route_meters: 25_100, included_km: 0, km: 26, start_price: yen("2000"), per_km: yen("300"), fee: yen("9800") };

function items(audience: "platform" | "tenant", pricingBasis: "one_price" | "one_price_outside_km" | "distance_only" | undefined, mileage: typeof outside | null | undefined): HTMLElement {
  const { container } = render(
    <dl>
      <OrderAreaPriceItems audience={audience} pricingRoute={null} distance={null} areaSurcharge={null} pricingBasis={pricingBasis} mileage={mileage} />
    </dl>,
  );
  return container;
}

const valueOf = (container: HTMLElement, label: string): string | null => {
  const item = [...container.querySelectorAll(".details__item")].find((node) => node.querySelector("dt")?.textContent === label);
  return item === undefined ? null : ([...item.querySelectorAll("dd span span")].map((line) => line.textContent).join("\n") || null);
};

test("一口价、旧接口：没有「计价方式」这一项", () => {
  assert.equal(valueOf(items("platform", "one_price", null), "计价方式"), null);
  cleanup();
  assert.equal(valueOf(items("tenant", undefined, undefined), "计价方式"), null);
});

test("运营后台：一口价 + 区域外里程费写区域外公里 × 单价 = 里程费（结算价），路线和扣掉的含公里数", () => {
  assert.equal(valueOf(items("platform", "one_price_outside_km", outside), "计价方式"), ["一口价 + 区域外里程费", "区域外 12 公里 × 300 JPY = 3,600 JPY（已含在基础价里）", "路线约 41.4 公里（报价时），扣掉一口价含的 30 公里；不足 1 公里按 1 公里"].join("\n"));
});

test("供应商后台：按计程价写起步价 + 公里 × 单价（结算价，币种在前），不出现对外价和加价比例", () => {
  const container = items("tenant", "distance_only", distance);
  assert.equal(valueOf(container, "计价方式"), ["计程价（起步价 + 每公里）", "起步价 JPY 2,000 + 26 公里 × JPY 300 = JPY 9,800（已含在基础价里）", "路线约 25.1 公里（报价时）；不足 1 公里按 1 公里"].join("\n"));
  assert.doesNotMatch(container.textContent ?? "", /对外|加价比例|sell/i);
});

test("报价试算用的同一个函数：没有计程明细时只写计价方式", () => {
  assert.deepEqual(pricingBasisLines("distance_only", null), ["计程价（起步价 + 每公里）"]);
  assert.equal(pricingBasisLines("one_price", null), null);
  assert.deepEqual(pricingBasisLines("one_price_outside_km", { route_meters: 30_200, included_km: 0, km: 1, start_price: "JPY 0", per_km: "JPY 300", fee: "JPY 300" })?.slice(1), ["区域外 1 公里 × JPY 300 = JPY 300（已含在基础价里）", "路线约 30.2 公里（报价时）；不足 1 公里按 1 公里"]);
});
