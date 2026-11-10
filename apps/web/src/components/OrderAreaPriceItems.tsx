/**
 * 订单详情「行程」卡片里的「用的价格」「公里数」「区域加价」三项（M8-13，ADR 0073 第四部分；规范 platform-orders.md 3d）。
 * 放在「车型」那一组后面；没有这些数的订单（旧单、没设含公里数、没有区域加价、接送机）一项都不出，页面其余照常。
 * - `audience="platform"`：结算价和对外价都写；
 * - `audience="tenant"`：只有结算价（规则 4）——用的是供应商接口给的数，里面本来就没有对外价。
 * 这些是说明，不和总价做加减。
 */
import type { ReactNode } from "react";
import {
  type OrderAreaSurchargeView,
  type OrderDistanceView,
  type OrderPricingRoute,
  platformDistanceLines,
  platformSurchargeLines,
  pricingRouteText,
  tenantDistanceLines,
  tenantSurchargeLines,
} from "../lib/order-area-price-display.ts";

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="details__item">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Lines({ lines }: { lines: readonly string[] }) {
  return (
    <span className="details__lines">
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </span>
  );
}

export function OrderAreaPriceItems({
  audience,
  pricingRoute,
  distance,
  areaSurcharge,
}: {
  audience: "platform" | "tenant";
  pricingRoute: OrderPricingRoute | null | undefined;
  distance: OrderDistanceView | null | undefined;
  areaSurcharge: OrderAreaSurchargeView | null | undefined;
}) {
  const route = pricingRouteText(pricingRoute);
  const surcharge = audience === "platform" ? platformSurchargeLines(areaSurcharge) : tenantSurchargeLines(areaSurcharge);
  const platformKm = audience === "platform" ? platformDistanceLines(distance) : null;
  const tenantKm = audience === "tenant" ? tenantDistanceLines(distance) : null;
  return (
    <>
      {route !== null && <Item label="用的价格">{route}</Item>}
      {platformKm !== null && (
        <Item label="公里数">
          <span className="details__lines">
            <span>{platformKm.summary}</span>
            <span className="price">{platformKm.perKm}</span>
            <span className="details__meters mono">{platformKm.meters}</span>
          </span>
        </Item>
      )}
      {tenantKm !== null && (
        <Item label="公里数">
          <span className="details__lines">
            <span>{tenantKm.summary}</span>
            <span className="details__meters mono">{tenantKm.meters}</span>
          </span>
        </Item>
      )}
      {surcharge !== null && (
        <Item label="区域加价">
          <Lines lines={surcharge} />
        </Item>
      )}
    </>
  );
}
