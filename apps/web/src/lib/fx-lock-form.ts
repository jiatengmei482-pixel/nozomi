/**
 * 汇率页「发起锁定」表单的规则（M2-06，ADR 0025）。和后端同一套：锁定值用 @nozomi/domain 的 `parseLockRate` 在字符串上解析（不经过浮点数），
 * 偏离用 `lockDeviation` 精确比较；超过 3% 要写原因、超过 20% 不允许。到期时间由「锁定多久」算出来（最长 72 小时）。
 * 这里只是让人提交前就看到问题；最终以后端的校验为准（服务器返回的问题按字段放回表单）。
 */
import { type CurrencyCode, FX_LOCKABLE_CURRENCIES, FX_LOCK_RULES, type LockDeviation, lockDeviation, parseLockRate } from "@nozomi/domain";
import { ApiError } from "../api/client.ts";
import { serverIssues } from "./product-failure.ts";

/** 「锁定多久」的选项（小时）：最长 72 小时。 */
export const LOCK_DURATION_HOURS: readonly number[] = [1, 2, 4, 8, 12, 24, 48, 72].filter((hours) => hours <= FX_LOCK_RULES.maxHours);
/** 「锁定多久」不预选（M1-18）：锁多久要发起人自己想好，没选就提交时在这个字段下面说明。 */
export const LOCK_HOURS_MESSAGE = "请选择锁定多久";

/** 下拉框的值换成小时数；没选（空）或不是选项之一时为 null。 */
export function lockHoursOf(value: string): number | null {
  const hours = Number(value);
  return value !== "" && LOCK_DURATION_HOURS.includes(hours) ? hours : null;
}
export { FX_LOCKABLE_CURRENCIES };

export interface LockDraft {
  currency: CurrencyCode;
  rate: string;
  hours: number;
  reason: string;
}

export interface LockFormCheck {
  /** 规范后的锁定值；写法不对时为 null */
  rate: string | null;
  deviation: LockDeviation | null;
  errors: { rate: string[]; reason: string[] };
}

export const LOCK_RATE_FORMAT_MESSAGE = `写成大于 0 的十进制数，如 151.2；不带正负号、千分位、指数，整数、小数各最多 ${FX_LOCK_RULES.maxIntegerDigits} 位`;
export const LOCK_REASON_MESSAGE = `和中央汇率相差超过 ${FX_LOCK_RULES.reasonAboveBp / 100}%，请写明原因`;
export const LOCK_TOO_FAR_MESSAGE = `和中央汇率相差超过 ${FX_LOCK_RULES.maxDeviationBp / 100}%，系统不允许；请核对币种和数量级`;

/** 按现在的中央汇率（1 USD = ?）核对表单。`touched` 为 false 时空的锁定值不报错（还没填）。 */
export function checkLockDraft(draft: Pick<LockDraft, "rate" | "reason">, central: string | null, touched: boolean): LockFormCheck {
  const text = draft.rate.trim();
  const rate = text === "" ? null : parseLockRate(text);
  const errors: LockFormCheck["errors"] = { rate: [], reason: [] };
  if (text === "" && touched) errors.rate.push("请填锁定值");
  else if (text !== "" && rate === null) errors.rate.push(LOCK_RATE_FORMAT_MESSAGE);
  const deviation = rate === null || central === null ? null : lockDeviation(central, rate);
  if (deviation?.tooLarge) errors.rate.push(LOCK_TOO_FAR_MESSAGE);
  else if (deviation?.needsReason && draft.reason.trim() === "") errors.reason.push(LOCK_REASON_MESSAGE);
  return { rate, deviation, errors };
}

/** 从现在起锁定 `hours` 小时：到期时刻（ISO）。 */
export function lockExpiresAt(now: Date, hours: number): string {
  return new Date(now.getTime() + hours * 3_600_000).toISOString();
}

/** 服务器拒收的原因 → 表单上的字段和文字（字段对不上的放进 `form`）。 */
export function lockServerErrors(err: unknown): { rate: string[]; reason: string[]; form: string[] } | null {
  if (!(err instanceof ApiError)) return null;
  const out = { rate: [] as string[], reason: [] as string[], form: [] as string[] };
  if (err.code === "VALIDATION_FAILED") {
    for (const issue of serverIssues(err)) {
      const message = issue.message;
      if (issue.path === "/rate") out.rate.push(issue.reason === "DEVIATION_TOO_LARGE" ? LOCK_TOO_FAR_MESSAGE : issue.reason === "INVALID_RATE" ? LOCK_RATE_FORMAT_MESSAGE : message);
      else if (issue.path === "/reason") out.reason.push(issue.reason === "REASON_REQUIRED" ? LOCK_REASON_MESSAGE : message);
      else if (issue.reason === "UNCHANGED") out.form.push("和现在的锁定一样，不用发起");
      else out.form.push(message);
    }
    return out;
  }
  if (err.code === "FX_RATE_UNAVAILABLE") return { ...out, form: ["还没有汇率，无法和中央汇率比对；请先拉取汇率"] };
  if (err.code === "FX_LOCK_NOT_ACTIVE") return { ...out, form: ["这条锁定已经结束（到期、解除或被取代），不用再解锁"] };
  return null;
}
