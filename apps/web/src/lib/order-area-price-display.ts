/**
 * 订单详情「行程」卡片里的区域价说明（M8-13，ADR 0073 第四部分；规范 platform-orders.md 3d）：用的价格（线路价 / 区域价）、公里数、区域加价。
 * 数都是下单时锁定在订单上的（接口给的），这里只拼字；句子主干来自 domain `included-km.ts`，和官网、邮件同一来源。
 * - 运营后台：结算价和对外价都写（「每公里 对外 330 JPY / 结算 300 JPY」，同「对外价 / 结算价」那一项的写法）；
 * - 供应商后台：只有结算价（规则 4），金额币种在前（「JPY 250」，04 第 1 节）；接口里本来就没有对外价。
 * 一口价仍然只有一个总价：这些是说明，不写成算式。没有这些数的订单返回 null（那一项不出现，页面其余照常）。
 */
import { type LocalizedText, type PricingBasis, consoleMoneyText, includedKmSummary, isCurrencyCode, parseMajor, routeMetersText, tenantIncludedKmSummary } from "@nozomi/domain";
import { moneyText } from "./dispatch-display.ts";
import { displayName } from "./master-display.ts";
import { pricingBasisLines } from "./pricing-basis-display.ts";

type Money = { amount: string; currency: string };

/** 点对点用的价格（接口 `pricing_route`） */
export interface OrderPricingRoute {
  kind: "route" | "area";
  area: { id: string; name: LocalizedText | null } | null;
  to_area: { id: string; name: LocalizedText | null } | null;
}

/** 订单上锁定的含公里数（`over_km_per_km` 是结算价；运营另有 `over_km_per_km_sell`） */
export interface OrderDistanceView {
  included_km: number;
  route_meters: number;
  over_km: number;
  over_km_per_km: Money;
  over_km_per_km_sell?: Money | null;
}

/** 一端的区域加价（`area_id` 为 null = 在商品本身的区域里，不加价）；运营另有 `sell` */
export interface OrderAreaSurchargeEndView {
  area_id: string | null;
  area_name: LocalizedText | null;
  settlement: Money;
  sell?: Money | null;
}

export interface OrderAreaSurchargeView {
  package_settlement: Money;
  pickup: OrderAreaSurchargeEndView;
  dropoff: OrderAreaSurchargeEndView;
  /** 途经加价（M9W-01，和后端约定）：每个收了途经加价的区域一项，`stop_seqs` 是第几个经停点（从 1 起）；没有经停点、旧接口没有这一项 */
  waypoints?: (OrderAreaSurchargeEndView & { stop_seqs: number[] })[];
}

export const DELETED_AREA = "（已删除的区域）";

const areaName = (area: { name: LocalizedText | null }): string => (area.name === null ? DELETED_AREA : displayName(area.name).text);

/** 「线路价 · 东京 23 区 → 成田周边」/「区域价 · 东京 23 区」；不知道上车区域（救援、改期后对不上）时只写知道的部分。 */
export function pricingRouteText(route: OrderPricingRoute | null | undefined): string | null {
  if (route === null || route === undefined) return null;
  if (route.kind === "area") return route.area === null ? "区域价" : `区域价 · ${areaName(route.area)}`;
  const to = route.to_area === null ? null : areaName(route.to_area);
  if (route.area === null) return to === null ? "线路价" : `线路价 · 下车区域 ${to}`;
  return `线路价 · ${areaName(route.area)} → ${to ?? DELETED_AREA}`;
}

/** 金额 → 最小单位（币种不认识、写法不对时 null，不猜） */
function minorOf(money: Money): number | null {
  if (!isCurrencyCode(money.currency)) return null;
  try {
    return parseMajor(money.amount, money.currency);
  } catch {
    return null;
  }
}

/** 运营后台「公里数」：第一行概况、第二行每公里对外 / 结算、第三行核对用的米数。 */
export function platformDistanceLines(distance: OrderDistanceView | null | undefined): { summary: string; perKm: string; meters: string } | null {
  if (distance === null || distance === undefined) return null;
  const facts = { includedKm: distance.included_km, routeMeters: distance.route_meters, overKm: distance.over_km };
  const sell = distance.over_km_per_km_sell ?? null;
  return { summary: includedKmSummary(facts), perKm: `每公里 对外 ${sell === null ? "—" : moneyText(sell)} / 结算 ${moneyText(distance.over_km_per_km)}`, meters: routeMetersText(distance.route_meters) };
}

/** 供应商后台「公里数」：「含 30 公里 · 路线约 34.2 公里（报价时）· 超出 5 公里 × JPY 250」+ 核对用的米数。只有结算价。 */
export function tenantDistanceLines(distance: OrderDistanceView | null | undefined): { summary: string; meters: string } | null {
  if (distance === null || distance === undefined) return null;
  const perKm = minorOf(distance.over_km_per_km);
  const currency = distance.over_km_per_km.currency;
  const facts = { includedKm: distance.included_km, routeMeters: distance.route_meters, overKm: distance.over_km };
  const summary = perKm === null || !isCurrencyCode(currency) ? includedKmSummary(facts) : tenantIncludedKmSummary({ ...facts, overKmPerKmMinor: perKm, currency });
  return { summary, meters: routeMetersText(distance.route_meters) };
}

/** 至少一端在加价区域里才写「区域加价」这一项（两端都在服务区域里 = 没有加价，不出现）。 */
export function hasAreaSurcharge(surcharge: OrderAreaSurchargeView | null | undefined): surcharge is OrderAreaSurchargeView {
  return surcharge !== null && surcharge !== undefined && (surcharge.pickup.area_id !== null || surcharge.dropoff.area_id !== null || (surcharge.waypoints?.length ?? 0) > 0);
}

const END_LABELS = { pickup: "上车", dropoff: "下车" } as const;
const IN_SERVICE_AREA = "在服务区域里，不加价";

/** 途经加价那几行的开头：「经停（第 1、3 个经停点）」 */
const waypointLabel = (seqs: readonly number[]): string => (seqs.length === 0 ? "经停" : `经停（第 ${seqs.join("、")} 个经停点）`);

/** 运营后台「区域加价」：「上车：富士山 · 对外 1,100 JPY / 结算 1,000 JPY」「下车：在服务区域里，不加价」。 */
export function platformSurchargeLines(surcharge: OrderAreaSurchargeView | null | undefined): string[] | null {
  if (!hasAreaSurcharge(surcharge)) return null;
  return (["pickup", "dropoff"] as const).map((end) => {
    const entry = surcharge[end];
    if (entry.area_id === null) return `${END_LABELS[end]}：${IN_SERVICE_AREA}`;
    const sell = entry.sell ?? null;
    return `${END_LABELS[end]}：${areaName({ name: entry.area_name })} · 对外 ${sell === null ? "—" : moneyText(sell)} / 结算 ${moneyText(entry.settlement)}`;
  }).concat((surcharge.waypoints ?? []).map((entry) => `${waypointLabel(entry.stop_seqs)}：${areaName({ name: entry.area_name })} · 对外 ${entry.sell == null ? "—" : moneyText(entry.sell)} / 结算 ${moneyText(entry.settlement)}`));
}

/** 供应商后台「区域加价」：「上车：富士山 · 加 JPY 1,000」「下车：在服务区域里，不加价」。只有结算价。 */
export function tenantSurchargeLines(surcharge: OrderAreaSurchargeView | null | undefined): string[] | null {
  if (!hasAreaSurcharge(surcharge)) return null;
  return (["pickup", "dropoff"] as const).map((end) => {
    const entry = surcharge[end];
    if (entry.area_id === null) return `${END_LABELS[end]}：${IN_SERVICE_AREA}`;
    return `${END_LABELS[end]}：${areaName({ name: entry.area_name })} · 加 ${settlementText(entry.settlement)}`;
  }).concat((surcharge.waypoints ?? []).map((entry) => `${waypointLabel(entry.stop_seqs)}：${areaName({ name: entry.area_name })} · 加 ${settlementText(entry.settlement)}`));
}

function settlementText(money: Money): string {
  const minor = minorOf(money);
  return minor === null || !isCurrencyCode(money.currency) ? `${money.currency} ${money.amount}` : consoleMoneyText(minor, money.currency);
}

/**
 * 订单上锁定的计程部分（M8-30，ADR 0080；结算价，已含在基础价里）：一口价 + 区域外里程费、按计程价的订单才有。
 * 和后端约定的接口形状（订单详情的 `pricing_basis`、`mileage`，同 `distance` 的写法，金额是 `{ amount, currency }`）；旧接口、一口价的订单没有。
 */
export interface OrderMileageView {
  route_meters: number;
  included_km: number;
  km: number;
  start_price: Money;
  per_km: Money;
  fee: Money;
}

/** 金额写法：运营后台「1,500 JPY」，供应商后台「JPY 1,500」（04 第 1 节）；都是结算价 */
function auditMoney(audience: "platform" | "tenant", money: Money): string {
  if (audience === "platform") return moneyText(money);
  const minor = minorOf(money);
  return minor === null || !isCurrencyCode(money.currency) ? `${money.currency} ${money.amount}` : consoleMoneyText(minor, money.currency);
}

/** 订单详情「计价方式」那一项的几行；一口价、旧单返回 null（不出现）。 */
export function orderPricingBasisLines(audience: "platform" | "tenant", basis: PricingBasis | null | undefined, mileage: OrderMileageView | null | undefined): string[] | null {
  const facts = mileage === null || mileage === undefined ? null : { ...mileage, start_price: auditMoney(audience, mileage.start_price), per_km: auditMoney(audience, mileage.per_km), fee: auditMoney(audience, mileage.fee) };
  return pricingBasisLines(basis, facts);
}
