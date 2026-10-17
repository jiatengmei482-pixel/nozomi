/**
 * 免费汇率源的解析（ADR 0022）：ExchangeRate-API 的格式（默认地址 https://open.er-api.com/v6/latest/USD，免密钥、每天更新一次）。
 * 付费档（v6 的 `conversion_rates`）是同一种格式，换源只改配置 `FX_SOURCE_URL`。
 *
 * **汇率全程不经过浮点数**：用 `JSON.parse` 的第三个参数（数字的原文，`context.source`，Node 22 起可用）
 * 把每个 JSON 数字按原文取出来，再在字符串上规范成十进制写法（`parseRateText`）。不能先解析成 number 再转字符串——
 * `0.1000000000000000055` 这类写法转一圈就变了。
 *
 * 纯函数：只看响应原文，不联网、不读库。内容不对时整份拒收并说明原因，不挑能用的部分入库。
 */
import type { CurrencyCode } from "./money.ts";
import { FX_CURRENCIES, FX_RULES, parseRateText } from "./fx.ts";

export const FX_SOURCE = {
  name: "ExchangeRate-API（open access）",
  homepage: "https://www.exchangerate-api.com/docs/free",
  defaultUrl: "https://open.er-api.com/v6/latest/USD",
  terms: "免费、免密钥；对方要求展示署名链接（https://www.exchangerate-api.com）；每天更新一次",
} as const;

export type FxSourceProblem =
  /** 不是 JSON，或结构不对 */
  | "FX_SOURCE_NOT_JSON"
  /** 对方明确说出错了（`result` 不是 success） */
  | "FX_SOURCE_ERROR_RESULT"
  /** 基准币种不是 USD，或 USD 自己不是 1 */
  | "FX_SOURCE_WRONG_BASE"
  /** 更新时间缺了、写法不对，或比现在晚得多 */
  | "FX_SOURCE_BAD_TIME"
  /** 缺平台要用的币种 */
  | "FX_SOURCE_MISSING_CURRENCY"
  /** 某个汇率不是正的十进制数，或位数大得不正常 */
  | "FX_SOURCE_BAD_RATE";

export interface FxSourceDocument {
  base: CurrencyCode;
  /** 这批汇率的时间（数据源的更新时间） */
  asOf: string;
  /** 数据源说的下次更新时间；没说为 null */
  nextUpdateAt: string | null;
  /** 平台币种的汇率（除基准币种外），规范的十进制字符串 */
  rates: Partial<Record<CurrencyCode, string>>;
}

export type FxSourceParse = { ok: true; document: FxSourceDocument } | { ok: false; problem: FxSourceProblem; detail: string };

/** JSON 数字的原文。和 JSON 里的字符串区分开：汇率必须是数字，写成字符串的不认。 */
class RawNumber {
  readonly source: string;
  constructor(source: string) {
    this.source = source;
  }
}

type Reviver = (this: unknown, key: string, value: unknown, context?: { source?: string }) => unknown;

function parseKeepingNumberText(text: string): unknown {
  const reviver: Reviver = (_key, value, context) => {
    if (typeof value !== "number") return value;
    if (context?.source === undefined) throw new Error("运行环境不支持读取 JSON 数字的原文（需要 Node 22 及以上）");
    return new RawNumber(context.source);
  };
  return JSON.parse(text, reviver as (this: unknown, key: string, value: unknown) => unknown);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof RawNumber);
}

/** Unix 秒（JSON 数字的原文）→ ISO 时间；写法不对返回 null。 */
function unixSeconds(value: unknown): string | null {
  if (!(value instanceof RawNumber) || !/^\d{9,11}$/.test(value.source)) return null;
  return new Date(Number(value.source) * 1000).toISOString();
}

/**
 * 解析数据源的响应原文。`now` 用来拒收更新时间比现在晚 5 分钟以上的（钟差之外）。
 * 只取平台支持的币种（`FX_CURRENCIES`）；缺任何一个整份拒收。
 */
export function parseFxSource(text: string, now: Date): FxSourceParse {
  let parsed: unknown;
  try {
    parsed = parseKeepingNumberText(text);
  } catch {
    return { ok: false, problem: "FX_SOURCE_NOT_JSON", detail: "响应不是 JSON" };
  }
  if (!isRecord(parsed)) return { ok: false, problem: "FX_SOURCE_NOT_JSON", detail: "响应不是一个 JSON 对象" };
  if (parsed["result"] !== "success") {
    const kind = typeof parsed["error-type"] === "string" ? `（${String(parsed["error-type"]).slice(0, 80)}）` : "";
    return { ok: false, problem: "FX_SOURCE_ERROR_RESULT", detail: `数据源返回的结果不是 success${kind}` };
  }
  if (parsed["base_code"] !== FX_RULES.base) return { ok: false, problem: "FX_SOURCE_WRONG_BASE", detail: `基准币种应为 ${FX_RULES.base}` };
  const asOf = unixSeconds(parsed["time_last_update_unix"]);
  if (asOf === null) return { ok: false, problem: "FX_SOURCE_BAD_TIME", detail: "没有可用的更新时间（time_last_update_unix）" };
  if (new Date(asOf).getTime() - now.getTime() > 5 * 60_000) return { ok: false, problem: "FX_SOURCE_BAD_TIME", detail: `更新时间 ${asOf} 比现在晚，数据源或时钟出了错` };
  const nextUpdateAt = parsed["time_next_update_unix"] === undefined ? null : unixSeconds(parsed["time_next_update_unix"]);
  const table = parsed["rates"] ?? parsed["conversion_rates"];
  if (!isRecord(table)) return { ok: false, problem: "FX_SOURCE_NOT_JSON", detail: "没有汇率表（rates）" };

  const baseRate = table[FX_RULES.base];
  if (!(baseRate instanceof RawNumber) || parseRateText(baseRate.source) !== "1") return { ok: false, problem: "FX_SOURCE_WRONG_BASE", detail: `汇率表里 ${FX_RULES.base} 应当是 1` };
  const rates: Partial<Record<CurrencyCode, string>> = {};
  const missing: string[] = [];
  for (const currency of FX_CURRENCIES) {
    if (currency === FX_RULES.base) continue;
    const raw = table[currency];
    if (raw === undefined) {
      missing.push(currency);
      continue;
    }
    const rate = raw instanceof RawNumber ? parseRateText(raw.source) : null;
    if (rate === null) return { ok: false, problem: "FX_SOURCE_BAD_RATE", detail: `${currency} 的汇率不是正的十进制数：${String(raw instanceof RawNumber ? raw.source : JSON.stringify(raw)).slice(0, 40)}` };
    rates[currency] = rate;
  }
  if (missing.length > 0) return { ok: false, problem: "FX_SOURCE_MISSING_CURRENCY", detail: `缺少币种：${missing.join("、")}` };
  return { ok: true, document: { base: FX_RULES.base, asOf, nextUpdateAt, rates } };
}
