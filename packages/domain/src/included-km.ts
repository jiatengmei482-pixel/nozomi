/**
 * 含公里数和区域加价的说法（M8-13，ADR 0073 第四部分；规范 site-booking-v2.md 10.2、10.3，platform-orders.md 3d，04-data-display.md 第 9 节）。
 * 官网报价卡片、新预订页、订单页、确认邮件、运营 / 供应商订单详情都用这里的函数，同一句话只在这里拼。
 *
 * - 路线距离 D：报价时锁定的路线米数**向上取整到 0.1 公里**，整数不带 .0，整数部分带千分位（30,040 米 → 30.1；30,000 米 → 30）。
 *   向上取整是为了不出现「约 30.0 公里，超出 1 公里」（超出公里数按 ADR 0073 向上取整到 1 公里）这种看起来对不上的写法（规范 10.8 第 1 条）。
 * - 超出公里数 Z 用订单 / 报价上存的数（后端算好的整数），这里不重算。
 * - 每公里单价 Y：客人看对外价，写成「300 JPY」（官网写法，`site-booking.md` 2.6）；供应商看结算价，写成「JPY 250」（后台写法，04 第 1 节）。
 * - 一口价只有一个总价：这些是说明，**不写成算式**（每公里对外价单独取整，和总价可能差一个取整单位）。
 */
import { type CurrencyCode, formatMajor } from "./money.ts";

/** 含公里数在一单 / 一个报价上的情况（Y 的币种由调用方给） */
export interface IncludedKmFacts {
  includedKm: number;
  routeMeters: number;
  overKm: number;
  overKmPerKmMinor: number;
  currency: CurrencyCode;
}

const groupThousands = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** 报价时的路线距离（米）→ 显示用的公里数（不带单位）：向上取整到 0.1 公里、整数不带 .0、带千分位。负数、非整数先按 0 / 舍去小数。 */
export function routeKmText(routeMeters: number): string {
  const meters = BigInt(Math.max(0, Math.trunc(routeMeters)));
  const tenths = (meters + 99n) / 100n;
  const whole = groupThousands(String(tenths / 10n));
  const tenth = tenths % 10n;
  return tenth === 0n ? whole : `${whole}.${tenth}`;
}

/** 金额的数字部分：按币种的小数位、带千分位（`1,234.50`）。 */
function amountText(minor: number, currency: CurrencyCode): string {
  const text = formatMajor(minor, currency);
  const negative = text.startsWith("-");
  const [whole = "", fraction] = (negative ? text.slice(1) : text).split(".");
  return `${negative ? "-" : ""}${groupThousands(whole)}${fraction === undefined ? "" : `.${fraction}`}`;
}

/** 客人看到的金额（官网写法）：`300 JPY`、`1,041.72 CNY`。 */
export function guestMoneyText(minor: number, currency: CurrencyCode): string {
  return `${amountText(minor, currency)} ${currency}`;
}

/** 后台看到的金额（04 第 1 节）：`JPY 250`、`CNY 4,600.50`。 */
export function consoleMoneyText(minor: number, currency: CurrencyCode): string {
  return `${currency} ${amountText(minor, currency)}`;
}

/**
 * 客人看到的含公里数那一句（规范 10.3）：
 * - 超出了、单价大于 0：「含 30 公里，本次路线约 34.2 公里，超出 5 公里 × 300 JPY（已含在一口价里）」
 * - 没超出：「含 30 公里，本次路线约 28.4 公里，在含的公里数以内」
 * - 超出了、单价是 0：「含 30 公里，本次路线约 34.2 公里，超出的公里不另收」
 * `overKmPerKmMinor` 是每公里的对外价（客人币种）。
 */
export function includedKmNote(facts: IncludedKmFacts): string {
  const head = `含 ${groupThousands(String(facts.includedKm))} 公里，本次路线约 ${routeKmText(facts.routeMeters)} 公里，`;
  if (facts.overKm <= 0) return `${head}在含的公里数以内`;
  if (facts.overKmPerKmMinor === 0) return `${head}超出的公里不另收`;
  return `${head}超出 ${groupThousands(String(facts.overKm))} 公里 × ${guestMoneyText(facts.overKmPerKmMinor, facts.currency)}（已含在一口价里）`;
}

/**
 * 后台订单详情「公里数」的第一行（规范 platform-orders.md 3d）：「含 30 公里 · 路线约 34.2 公里（报价时）· 超出 5 公里」；
 * 没超出时最后一段是「在含的公里数以内」。供应商后台另外接「 × JPY 250」（`withSettlementPerKm`）；运营后台的每公里单价另起一行。
 */
export function includedKmSummary(facts: Pick<IncludedKmFacts, "includedKm" | "routeMeters" | "overKm">): string {
  const head = `含 ${groupThousands(String(facts.includedKm))} 公里 · 路线约 ${routeKmText(facts.routeMeters)} 公里（报价时）· `;
  return facts.overKm <= 0 ? `${head}在含的公里数以内` : `${head}超出 ${groupThousands(String(facts.overKm))} 公里`;
}

/** 供应商后台订单详情「公里数」：第一行后面接超出的结算单价（「× JPY 250」）；没超出时不接；单价是 0 时接「，不另收」。 */
export function tenantIncludedKmSummary(facts: IncludedKmFacts): string {
  const summary = includedKmSummary(facts);
  if (facts.overKm <= 0) return summary;
  return facts.overKmPerKmMinor === 0 ? `${summary}，不另收` : `${summary} × ${consoleMoneyText(facts.overKmPerKmMinor, facts.currency)}`;
}

/** 核对用的路线米数（规范 3d 第三行）：「路线 34,153 米」。 */
export function routeMetersText(routeMeters: number): string {
  return `路线 ${groupThousands(String(Math.max(0, Math.trunc(routeMeters))))} 米`;
}

/** 客人看到的「含区域加价」（规范 10.2）：车型卡、车费、订单页「总价」下面；确认邮件里接在已付金额后面的是 `AREA_SURCHARGE_MAIL_NOTE`。不写金额、不写是哪个区域。 */
export const AREA_SURCHARGE_NOTE = "含区域加价，已算在这个价格里";
export const AREA_SURCHARGE_MAIL_NOTE = "（含区域加价）";
