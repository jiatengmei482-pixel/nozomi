/**
 * 汇率人工锁定（M2-06，ADR 0025）的纯计算部分。存储、双人复核、到期处理在后端 `apps/api/src/services/fx-locks.ts`。
 *
 * - 按**币种**锁定「1 个基准币种（USD）= 多少该币种」，和数据源的存法一样；交叉汇率照常由两边算出，锁定的一边用锁定值。
 * - 锁定值是十进制字符串，只在字符串上解析，不经过浮点数；必须是正数。
 * - 锁定必须带到期时间（发起时离现在至少 30 分钟、最多 72 小时）；到期那一刻起不再用（不含这一刻）。
 * - 和发起那一刻的中央汇率比：偏离超过 3% 必须写原因，超过 20% 不允许（多半是输错了数量级或币种）。
 */
import type { CurrencyCode } from "./money.ts";
import { roundFractionHalfAwayFromZero } from "./money.ts";
import { type FxTable, FX_CURRENCIES, FX_RULES, crossRate, formatRate, fxQuoteFromTable, rateToFraction } from "./fx.ts";
import type { FxLockLeg, FxQuote } from "./quote.ts";

export const FX_LOCK_RULES = {
  /** 锁定最长多久（从发起算起；批准时到期时间不变） */
  maxHours: 72,
  /**
   * 「最长 72 小时」容许的钟差（分钟）：到期时刻由浏览器按本机时钟算好再提交，本机比服务器快一点时
   * 选「72 小时」也不该被拒。和汇率取数时间的钟差（FX_RULES 的 5 分钟）同一个口径。
   */
  maxHoursClockSkewMinutes: 5,
  /** 发起时到期时间离现在至少多久（太短的锁定来不及有人审核就到期了） */
  minMinutes: 30,
  /** 和中央汇率偏离超过它（严格大于）时必须写原因：和「单次变动超过 3% 挂起」同一个口径 */
  reasonAboveBp: FX_RULES.jumpThresholdBp,
  /** 偏离超过它（严格大于）不允许 */
  maxDeviationBp: 2_000,
  /** 锁定值最多几位整数、几位小数 */
  maxIntegerDigits: 12,
  maxFractionDigits: 12,
  /** 原因最长多少字 */
  reasonMaxLength: 500,
} as const;

/** 能锁定的币种：平台币种里除了基准币种（USD 自己恒等于 1）。 */
export const FX_LOCKABLE_CURRENCIES: readonly CurrencyCode[] = FX_CURRENCIES.filter((currency) => currency !== FX_RULES.base);

const LOCK_RATE_TEXT = /^(\d+)(?:\.(\d+))?$/;

/**
 * 运营填的锁定值（如 `151.20`、`0.0071`）→ 规范的十进制字符串（`151.2`、`0.0071`）。
 * 只认普通的十进制写法：没有正负号、指数、千分位、空格；必须大于 0；整数、小数各最多 12 位。不对返回 null。
 */
export function parseLockRate(text: string): string | null {
  const match = LOCK_RATE_TEXT.exec(text);
  if (!match) return null;
  const whole = (match[1] ?? "").replace(/^0+(?=\d)/, "");
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  if (whole.length > FX_LOCK_RULES.maxIntegerDigits || fraction.length > FX_LOCK_RULES.maxFractionDigits) return null;
  if (/^0*$/.test(whole + fraction)) return null;
  return fraction === "" ? whole : `${whole}.${fraction}`;
}

/** 一条生效中的锁定（给报价用的那几项）。 */
export interface FxLock {
  id: string;
  currency: CurrencyCode;
  /** 1 个基准币种 = rate 个该币种（规范的十进制字符串） */
  rate: string;
  /** 到这一刻起不再用（不含这一刻） */
  expiresAt: string;
}

/** 这条锁定在 `now` 还算不算数：到期那一刻起不算。 */
export function fxLockActive(lock: Pick<FxLock, "expiresAt">, now: Date): boolean {
  const expiresAt = new Date(lock.expiresAt).getTime();
  return Number.isFinite(expiresAt) && now.getTime() < expiresAt;
}

export interface LockDeviation {
  /** 偏离幅度，基点，带正负号（四舍五入到整数，只给人看；是否超限用精确值比） */
  changeBp: number;
  /** 严格大于「必须写原因」的门槛 */
  needsReason: boolean;
  /** 严格大于「不允许」的门槛 */
  tooLarge: boolean;
}

/** 锁定值相对中央汇率（同样是「1 USD = ?」）的偏离。全程精确分数。 */
export function lockDeviation(central: string, locked: string): LockDeviation {
  const c = rateToFraction(central);
  const l = rateToFraction(locked);
  // (l − c) / c = (l.num × c.den − c.num × l.den) / (l.den × c.num)
  const delta = l.numerator * c.denominator - c.numerator * l.denominator;
  const scale = l.denominator * c.numerator;
  const magnitude = (delta < 0n ? -delta : delta) * 10_000n;
  return {
    changeBp: Number(roundFractionHalfAwayFromZero(delta * 10_000n, scale)),
    needsReason: magnitude > BigInt(FX_LOCK_RULES.reasonAboveBp) * scale,
    tooLarge: magnitude > BigInt(FX_LOCK_RULES.maxDeviationBp) * scale,
  };
}

export type FxLockIssueReason =
  /** 基准币种（USD）不能锁定 */
  | "BASE_CURRENCY"
  /** 不是平台支持的币种 */
  | "UNSUPPORTED_CURRENCY"
  /** 锁定值写法不对、不是正数、位数太多 */
  | "INVALID_RATE"
  /** 到期时间离现在不到 30 分钟（或已经过去） */
  | "EXPIRES_TOO_SOON"
  /** 到期时间离现在超过 72 小时 */
  | "EXPIRES_TOO_LATE"
  /** 和中央汇率偏离超过 3%，没有写原因 */
  | "REASON_REQUIRED"
  /** 和中央汇率偏离超过 20% */
  | "DEVIATION_TOO_LARGE";

export interface FxLockIssue {
  path: string;
  reason: FxLockIssueReason;
  detail?: Record<string, number | string>;
}

export interface FxLockRequestInput {
  currency: string;
  rate: string;
  expiresAt: Date;
  reason: string | null;
}

export interface FxLockCheck {
  issues: FxLockIssue[];
  /** 规范后的锁定值（写法不对时为 null） */
  rate: string | null;
  /** 和中央汇率的偏离（锁定值或中央汇率不可用时为 null） */
  deviation: LockDeviation | null;
}

/**
 * 发起锁定前的校验。`central` 是这个币种现在的中央汇率（1 USD = ?），由调用方从现在用的那批里取。
 * 批准时按那一刻的数据另有 `fxLockApplyIssues`。
 */
export function fxLockRequestIssues(input: FxLockRequestInput, central: string, now: Date): FxLockCheck {
  const issues: FxLockIssue[] = [];
  const currency = input.currency as CurrencyCode;
  if (currency === FX_RULES.base) issues.push({ path: "/currency", reason: "BASE_CURRENCY" });
  else if (!FX_LOCKABLE_CURRENCIES.includes(currency)) issues.push({ path: "/currency", reason: "UNSUPPORTED_CURRENCY" });
  const rate = parseLockRate(input.rate);
  if (rate === null) issues.push({ path: "/rate", reason: "INVALID_RATE", detail: { max_integer_digits: FX_LOCK_RULES.maxIntegerDigits, max_fraction_digits: FX_LOCK_RULES.maxFractionDigits } });
  const untilMs = input.expiresAt.getTime() - now.getTime();
  if (!Number.isFinite(untilMs) || untilMs < FX_LOCK_RULES.minMinutes * 60_000) issues.push({ path: "/expires_at", reason: "EXPIRES_TOO_SOON", detail: { min_minutes: FX_LOCK_RULES.minMinutes } });
  else if (untilMs > FX_LOCK_RULES.maxHours * 3_600_000 + FX_LOCK_RULES.maxHoursClockSkewMinutes * 60_000) issues.push({ path: "/expires_at", reason: "EXPIRES_TOO_LATE", detail: { max_hours: FX_LOCK_RULES.maxHours } });
  const deviation = rate === null ? null : lockDeviation(central, rate);
  if (deviation !== null) {
    const detail = { change_bp: deviation.changeBp, central_rate: central };
    if (deviation.tooLarge) issues.push({ path: "/rate", reason: "DEVIATION_TOO_LARGE", detail: { ...detail, max_deviation_bp: FX_LOCK_RULES.maxDeviationBp } });
    else if (deviation.needsReason && (input.reason === null || input.reason.trim() === "")) issues.push({ path: "/reason", reason: "REASON_REQUIRED", detail: { ...detail, reason_above_bp: FX_LOCK_RULES.reasonAboveBp } });
  }
  return { issues, rate, deviation };
}

/**
 * 批准时（按那一刻的数据）还能不能生效：到期时间还没到；和那一刻的中央汇率比，偏离仍不超过 20%、超过 3% 时有原因。
 * 到期时间离批准时刻多近都可以（发起时已经保证了最长 72 小时，批准只会让剩下的时间变短）。
 */
export function fxLockApplyIssues(input: Omit<FxLockRequestInput, "currency"> & { currency: CurrencyCode }, central: string, now: Date): FxLockIssue[] {
  const issues: FxLockIssue[] = [];
  if (!fxLockActive({ expiresAt: input.expiresAt.toISOString() }, now)) issues.push({ path: "/expires_at", reason: "EXPIRES_TOO_SOON", detail: { min_minutes: 0 } });
  const rate = parseLockRate(input.rate);
  if (rate === null) return [...issues, { path: "/rate", reason: "INVALID_RATE" }];
  const deviation = lockDeviation(central, rate);
  const detail = { change_bp: deviation.changeBp, central_rate: central };
  if (deviation.tooLarge) issues.push({ path: "/rate", reason: "DEVIATION_TOO_LARGE", detail: { ...detail, max_deviation_bp: FX_LOCK_RULES.maxDeviationBp } });
  else if (deviation.needsReason && (input.reason === null || input.reason.trim() === "")) issues.push({ path: "/reason", reason: "REASON_REQUIRED", detail: { ...detail, reason_above_bp: FX_LOCK_RULES.reasonAboveBp } });
  return issues;
}

/**
 * 带人工锁定的汇率：1 个 `from` = ? 个 `to`。锁定的一边（`now` 时还没到期的锁定）用锁定值，另一边用这批汇率里的值，
 * 交叉汇率照常先用精确分数算、再四舍五入到 12 位小数。没有一边锁定时和 `fxQuoteFromTable` 完全一样（不带 `lock`）。
 * 有锁定时 `lock.legs` 列出用到的锁定，`lock.usesSource` 说明另一边是否还用数据源的汇率（是的话那一边仍受 48 小时过期约束）。
 * 不看是否过期——调用方用 `fxQuoteUsable` 判断。
 */
export function fxQuoteWithLocks(table: FxTable, locks: readonly FxLock[], from: CurrencyCode, to: CurrencyCode, now: Date): FxQuote | null {
  if (from === to) return { from, to, rate: "1", asOf: table.asOf };
  const active = new Map<CurrencyCode, FxLock>();
  for (const lock of locks) {
    if (lock.currency !== table.base && (lock.currency === from || lock.currency === to) && fxLockActive(lock, now) && !active.has(lock.currency)) active.set(lock.currency, lock);
  }
  if (active.size === 0) return fxQuoteFromTable(table, from, to);
  const rates = { ...table.rates };
  for (const lock of active.values()) rates[lock.currency] = lock.rate;
  const exact = crossRate({ ...table, rates }, from, to);
  const rate = exact === null ? null : formatRate(exact);
  if (rate === null) return null;
  const legs: FxLockLeg[] = [from, to].flatMap((currency) => {
    const lock = active.get(currency);
    return lock === undefined ? [] : [{ currency, rate: lock.rate, lockId: lock.id, expiresAt: lock.expiresAt }];
  });
  const usesSource = [from, to].some((currency) => currency !== table.base && !active.has(currency));
  return { from, to, rate, asOf: table.asOf, lock: { legs, usesSource } };
}
