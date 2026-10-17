/**
 * 汇率中心的纯计算部分（ADR 0022）。取数、存储、定时拉取在后端 `apps/api/src/services/fx-center.ts`。
 *
 * - 按一个基准币种（USD，数据源的格式）存各币种的汇率：「1 USD = rate 单位该币种（主单位）」，汇率一律是十进制字符串，不经过浮点数。
 * - 任意两种币种走交叉汇率：先用精确分数算（两项相除），再四舍五入到 12 位小数写成十进制字符串（`FxQuote.rate`）。
 *   报价快照里记的就是这个字符串，之后的对外价、订单、结算都按它算，可以原样复算。
 * - 超过 48 小时没更新的汇率不用来报价（和报价引擎的 `fxQuoteUsable` 同一条规则）。
 * - 单次变动超过 3% 的一批汇率先挂起，人工确认后才生效（《平台运营端》「汇率中心运维」）。
 */
import { CURRENCIES, type CurrencyCode, roundFractionHalfAwayFromZero } from "./money.ts";
import { type FxQuote, QUOTE_RULES, fxQuoteUsable } from "./quote.ts";

export const FX_RULES = {
  /** 存汇率用的基准币种（数据源的报价基准） */
  base: "USD" as CurrencyCode,
  /** 超过这么久没更新就暂停跨币种报价并告警（和报价引擎同一个数） */
  maxAgeHours: QUOTE_RULES.fxMaxAgeHours,
  /** 单次变动超过 3%（严格大于）先挂起、告警，人工确认后才生效 */
  jumpThresholdBp: 300,
  /** 交叉汇率写成十进制字符串时保留的小数位数（报价引擎的 `rateFraction` 最多认 12 位） */
  quoteDecimals: 12,
  /** 存进库里的汇率最多几位整数、几位小数（数据源给得更长的整批拒收） */
  maxIntegerDigits: 15,
  maxFractionDigits: 18,
  /** 一次拉取开始后多久还没结束，算作中途中断（进程退出等），可以重新拉 */
  runningTimeoutMinutes: 5,
  /** 拉取失败（连不上、内容不对）后多久再试 */
  retryAfterFailureMinutes: 15,
  /** 数据源告诉了下次更新时间时：到点后再等几分钟再拉；最早、最晚的间隔 */
  afterSourceUpdateMinutes: 5,
  minIntervalMinutes: 15,
  maxIntervalHours: 12,
  /** 数据源没说下次什么时候更新时：每小时拉一次 */
  defaultIntervalMinutes: 60,
} as const;

/** 汇率中心管理的币种：平台支持的全部币种（money.ts 的 `CURRENCIES`）。数据源里别的币种不存。 */
export const FX_CURRENCIES = Object.keys(CURRENCIES) as CurrencyCode[];

/** 精确的分数（分母为正）。 */
export interface RateFraction {
  numerator: bigint;
  denominator: bigint;
}

/** 一批汇率：1 个 `base` = `rates[X]` 个 X（主单位）。`base` 自己不在 `rates` 里也算 1。 */
export interface FxTable {
  base: CurrencyCode;
  /** 这批汇率的时间（数据源的更新时间） */
  asOf: string;
  rates: Readonly<Partial<Record<CurrencyCode, string>>>;
}

const RATE_TEXT = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;
const CANONICAL_RATE = /^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/;

/**
 * 数据源里的一个汇率（JSON 数字的原文，如 `151.210`、`1e-5`）→ 规范的十进制字符串（`151.21`、`0.00001`）。
 * 只做字符串上的挪动，不经过浮点数。不是正数、写法不对、位数超出 `FX_RULES` 的返回 null。
 */
export function parseRateText(text: string): string | null {
  const match = RATE_TEXT.exec(text);
  if (!match) return null;
  const [, whole = "", fraction = "", exponentText = "0"] = match;
  const exponent = Number(exponentText);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 40) return null;
  const digits = `${whole}${fraction}`.replace(/^0+/, "");
  if (digits === "") return null;
  // 数值 = digits × 10^shift
  const shift = exponent - fraction.length;
  let integerPart: string;
  let fractionPart: string;
  if (shift >= 0) {
    integerPart = digits + "0".repeat(shift);
    fractionPart = "";
  } else {
    const padded = digits.padStart(-shift + 1, "0");
    integerPart = padded.slice(0, padded.length + shift);
    fractionPart = padded.slice(padded.length + shift);
  }
  integerPart = integerPart.replace(/^0+(?=\d)/, "");
  fractionPart = fractionPart.replace(/0+$/, "");
  if (integerPart.length > FX_RULES.maxIntegerDigits || fractionPart.length > FX_RULES.maxFractionDigits) return null;
  return fractionPart === "" ? integerPart : `${integerPart}.${fractionPart}`;
}

/** 规范写法的正数汇率 → 精确分数。写法不规范或不是正数时抛 RangeError（只用于已经校验过的值）。 */
export function rateToFraction(rate: string): RateFraction {
  if (!CANONICAL_RATE.test(rate)) throw new RangeError(`汇率写法不对：${rate}`);
  const [whole = "0", fraction = ""] = rate.split(".");
  const numerator = BigInt(`${whole}${fraction}`);
  if (numerator <= 0n) throw new RangeError(`汇率必须是正数：${rate}`);
  return { numerator, denominator: 10n ** BigInt(fraction.length) };
}

/**
 * 精确分数 → 十进制字符串，四舍五入（0.5 远离零）到 `decimals` 位小数，去掉末尾的 0。
 * 舍入后是 0、或整数部分超过 12 位（报价引擎认不了）时返回 null。
 */
export function formatRate(rate: RateFraction, decimals: number = FX_RULES.quoteDecimals): string | null {
  const scaled = roundFractionHalfAwayFromZero(rate.numerator * 10n ** BigInt(decimals), rate.denominator);
  if (scaled <= 0n) return null;
  const digits = scaled.toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
  if (whole.length > 12) return null;
  return fraction === "" ? whole : `${whole}.${fraction}`;
}

function perBase(table: FxTable, currency: CurrencyCode): RateFraction | null {
  if (currency === table.base) return { numerator: 1n, denominator: 1n };
  const rate = table.rates[currency];
  return rate === undefined ? null : rateToFraction(rate);
}

/** 交叉汇率的精确值：1 个 `from` = ? 个 `to`。等于 (1 base 的 to 数) ÷ (1 base 的 from 数)。表里缺任何一项返回 null。 */
export function crossRate(table: FxTable, from: CurrencyCode, to: CurrencyCode): RateFraction | null {
  const fromRate = perBase(table, from);
  const toRate = perBase(table, to);
  if (fromRate === null || toRate === null) return null;
  return { numerator: toRate.numerator * fromRate.denominator, denominator: toRate.denominator * fromRate.numerator };
}

/**
 * 从一批汇率里取「1 个 `from` = ? 个 `to`」给报价用（`FxQuote`）：交叉汇率四舍五入到 12 位小数。
 * 同币种是 "1"。表里缺币种、舍入后不能用时返回 null。不看是否过期——过期由调用方用 `fxTableState` 判断。
 */
export function fxQuoteFromTable(table: FxTable, from: CurrencyCode, to: CurrencyCode): FxQuote | null {
  if (from === to) return { from, to, rate: "1", asOf: table.asOf };
  const exact = crossRate(table, from, to);
  const rate = exact === null ? null : formatRate(exact);
  return rate === null ? null : { from, to, rate, asOf: table.asOf };
}

export type FxTableState = "none" | "fresh" | "stale";

/**
 * 汇率现在能不能用：没有汇率（`none`）；取数时间离现在不超过 48 小时（`fresh`，正好 48 小时还算）；否则 `stale`——暂停跨币种报价、告警。
 * 取数时间比现在晚超过 5 分钟（钟差之外）同样算 `stale`：那是数据源或时钟出了错。规则和报价引擎的 `fxQuoteUsable` 完全一致。
 */
export function fxTableState(asOf: string | null, now: Date): FxTableState {
  if (asOf === null) return "none";
  return fxQuoteUsable({ asOf }, now) ? "fresh" : "stale";
}

/** 这批汇率从什么时候起不能再用（取数时间 + 48 小时之后的那一刻）。 */
export function fxStaleAt(asOf: string): Date {
  return new Date(new Date(asOf).getTime() + FX_RULES.maxAgeHours * 3_600_000 + 1);
}

export interface RateJump {
  currency: CurrencyCode;
  previous: string;
  next: string;
  /** 变动幅度，基点，带正负号（四舍五入到整数，只给人看；是否超限用精确值比） */
  changeBp: number;
}

/**
 * 和上一批相比变动超过阈值（严格大于，默认 3%）的币种。只比两批里都有的币种。全程精确分数。
 */
export function findRateJumps(previous: FxTable["rates"], next: FxTable["rates"], thresholdBp: number = FX_RULES.jumpThresholdBp): RateJump[] {
  const jumps: RateJump[] = [];
  for (const currency of FX_CURRENCIES) {
    const before = previous[currency];
    const after = next[currency];
    if (before === undefined || after === undefined) continue;
    const p = rateToFraction(before);
    const n = rateToFraction(after);
    // (n − p) / p 化成一个分数：(n.num × p.den − p.num × n.den) / (n.den × p.num)
    const delta = n.numerator * p.denominator - p.numerator * n.denominator;
    const scale = n.denominator * p.numerator;
    const magnitude = delta < 0n ? -delta : delta;
    if (magnitude * 10_000n > BigInt(thresholdBp) * scale) {
      jumps.push({ currency, previous: before, next: after, changeBp: Number(roundFractionHalfAwayFromZero(delta * 10_000n, scale)) });
    }
  }
  return jumps;
}

export type FxFetchStatus =
  /** 正在拉 */
  | "running"
  /** 拉到了新的一批，已生效 */
  | "accepted"
  /** 拉到的和现在用的是同一批（数据源还没更新），什么都没写 */
  | "unchanged"
  /** 变动超过 3%，挂起等人工确认 */
  | "held"
  /** 挂起的那批已由人工确认生效 */
  | "confirmed"
  /** 挂起的那批被人工放弃 */
  | "dismissed"
  /** 内容不对（解析失败、缺币种、汇率不是正数、时间不对），不入库 */
  | "rejected"
  /** 连不上、超时、对方出错 */
  | "failed";

export const FX_FETCH_STATUSES: readonly FxFetchStatus[] = ["running", "accepted", "unchanged", "held", "confirmed", "dismissed", "rejected", "failed"];

export interface FxFetchSummary {
  status: FxFetchStatus;
  startedAt: Date;
  finishedAt: Date | null;
  /** 数据源说的下次更新时间（有的话） */
  sourceNextUpdateAt: Date | null;
}

const MINUTE = 60_000;

/** 一次「正在拉」的拉取是不是已经中断了（开始超过 5 分钟还没结束：进程退出、机器重启）。 */
export function fxFetchAbandoned(fetch: Pick<FxFetchSummary, "status" | "startedAt">, now: Date): boolean {
  return fetch.status === "running" && now.getTime() - fetch.startedAt.getTime() > FX_RULES.runningTimeoutMinutes * MINUTE;
}

/**
 * 下一次定时拉取的时间（按数据源的更新频率）：
 * - 从来没拉过：马上；
 * - 正在拉：等它结束，超过 5 分钟没结束算中断，可以重新拉；
 * - 上次失败或内容不对：15 分钟后重试；
 * - 上次拉到了（不论生效、没变、挂起）：数据源说了下次更新时间就在那之后 5 分钟，没说就 1 小时后；
 *   但不早于上次结束后 15 分钟（数据源还没更新时不会每分钟去问），不晚于 12 小时（数据源给的时间不对时也能自愈）。
 */
export function nextFxFetchAt(last: FxFetchSummary | null): Date {
  if (last === null) return new Date(0);
  if (last.status === "running") return new Date(last.startedAt.getTime() + FX_RULES.runningTimeoutMinutes * MINUTE + 1);
  const finished = (last.finishedAt ?? last.startedAt).getTime();
  if (last.status === "failed" || last.status === "rejected") return new Date(finished + FX_RULES.retryAfterFailureMinutes * MINUTE);
  const preferred = last.sourceNextUpdateAt === null ? finished + FX_RULES.defaultIntervalMinutes * MINUTE : last.sourceNextUpdateAt.getTime() + FX_RULES.afterSourceUpdateMinutes * MINUTE;
  const earliest = finished + FX_RULES.minIntervalMinutes * MINUTE;
  const latest = finished + FX_RULES.maxIntervalHours * 60 * MINUTE;
  return new Date(Math.min(latest, Math.max(earliest, preferred)));
}
