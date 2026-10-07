/**
 * 汇率换算（中央换算中心的纯计算部分；取数和缓存在后端服务里做）。
 *
 * - 汇率表以 USD 为报价基准（数据源的格式），平台本身不设本位币。
 * - 跨币种时在中央汇率上加缓冲（默认 150 bp = 1.5%），同币种不加。
 * - 报价时把用到的汇率写进快照（FxSnapshot），之后的结算都用快照，不再取实时汇率。
 */
import { type CurrencyCode, assertMinor, minorDigits, roundHalfAwayFromZero } from "./money.ts";

export interface FxTable {
  base: "USD";
  /** 1 USD = rates[code] 单位该币种（主单位） */
  rates: Partial<Record<CurrencyCode, number>>;
  asOf: string;
}

export interface FxSnapshot {
  from: CurrencyCode;
  to: CurrencyCode;
  /** 1 主单位 from = rate 主单位 to，已含缓冲 */
  rate: number;
  bufferBasisPoints: number;
  asOf: string;
}

export class FxRateMissingError extends Error {
  constructor(code: CurrencyCode) {
    super(`汇率表缺少 ${code}`);
    this.name = "FxRateMissingError";
  }
}

function usdRate(table: FxTable, code: CurrencyCode): number {
  if (code === "USD") return 1;
  const r = table.rates[code];
  if (r === undefined || !Number.isFinite(r) || r <= 0) throw new FxRateMissingError(code);
  return r;
}

export function snapshotRate(
  table: FxTable,
  from: CurrencyCode,
  to: CurrencyCode,
  bufferBasisPoints: number,
): FxSnapshot {
  if (!Number.isInteger(bufferBasisPoints) || bufferBasisPoints < 0) {
    throw new RangeError(`汇率缓冲必须是非负整数基点：${bufferBasisPoints}`);
  }
  if (from === to) return { from, to, rate: 1, bufferBasisPoints: 0, asOf: table.asOf };
  const mid = usdRate(table, to) / usdRate(table, from);
  return { from, to, rate: mid * (1 + bufferBasisPoints / 10_000), bufferBasisPoints, asOf: table.asOf };
}

/** 用快照把最小单位金额从 from 换到 to，结果四舍五入到 to 的最小单位。 */
export function convertMinor(minor: number, snapshot: FxSnapshot): number {
  assertMinor(minor);
  const major = minor / 10 ** minorDigits(snapshot.from);
  return roundHalfAwayFromZero(major * snapshot.rate * 10 ** minorDigits(snapshot.to));
}
