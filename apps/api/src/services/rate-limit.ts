/**
 * `/sales/v1` 的限流（需求「API 通用约定」：按令牌，报价 50 次/秒，其他 10 次/秒；超限 429 + `Retry-After`）。ADR 0023。
 *
 * 和登录限速（ADR 0008）同一种做法：固定时间窗、计数在数据库里（多实例也有效）、「先占用一次再判断」在一条 SQL 里原子完成，并发请求绕不过去。
 * 判断规则是 domain 的 `evaluateFixedWindow`。限流按渠道计（一个渠道的几个 API 客户端共用一个额度），令牌接口按来源地址计。
 */
import { type ThrottleDecision, evaluateFixedWindow } from "@nozomi/domain";
import type { Db } from "../db/context.ts";
import { AppError } from "../errors.ts";

export const SALES_RATE_LIMITS = {
  /** 报价：每个渠道每秒 50 次 */
  quote: { max: 50, windowMs: 1_000 },
  /** 其他接口（查报价）：每个渠道每秒 10 次 */
  other: { max: 10, windowMs: 1_000 },
  /** 换令牌：每个来源地址每秒 10 次 */
  token: { max: 10, windowMs: 1_000 },
  // 官网 /site/v1（ADR 0032）：按来源地址计（地址只存哈希），不占渠道自己的额度
  /** 官网询价：每个地址每分钟 30 次 */
  site_quote: { max: 30, windowMs: 60_000 },
  /** 官网下单：每个地址 10 分钟 10 次 */
  site_order: { max: 10, windowMs: 600_000 },
  /** 用订单号找回订单：每个地址 15 分钟 10 次 */
  site_lookup: { max: 10, windowMs: 900_000 },
  /** 用订单号找回订单：每个订单号每小时 10 次（换着地址猜同一张单也挡得住） */
  site_lookup_order: { max: 10, windowMs: 3_600_000 },
  /** 官网的其余接口（配置、城市、机场、订单页）：每个地址每分钟 120 次 */
  site_read: { max: 120, windowMs: 60_000 },
} as const;

export type SalesRateScope = keyof typeof SALES_RATE_LIMITS;

/** 占用一次额度并判断这一次放不放行。在调用方的平台事务里执行。 */
export async function takeRateSlot(db: Db, bucket: string, scope: SalesRateScope, now: Date): Promise<ThrottleDecision> {
  const { max, windowMs } = SALES_RATE_LIMITS[scope];
  const result = await db.query<{ attempt_count: number; window_started_at: Date }>(
    `insert into sales_rate_limits (bucket, window_started_at, attempt_count) values ($1, $2, 1)
     on conflict (bucket) do update set
       attempt_count = case when sales_rate_limits.window_started_at <= $2::timestamptz - make_interval(secs => $3::double precision / 1000) then 1 else sales_rate_limits.attempt_count + 1 end,
       window_started_at = case when sales_rate_limits.window_started_at <= $2::timestamptz - make_interval(secs => $3::double precision / 1000) then $2 else sales_rate_limits.window_started_at end
     returning attempt_count, window_started_at`,
    [`${scope}:${bucket}`, now, windowMs],
  );
  const row = result.rows[0] as { attempt_count: number; window_started_at: Date };
  return evaluateFixedWindow({ attemptCount: row.attempt_count, windowStartedAt: row.window_started_at }, max, windowMs, now);
}

export function rateLimited(retryAfterSeconds: number): AppError {
  return new AppError(429, "RATE_LIMITED", "请求过于频繁，请稍后再试", { retry_after_seconds: retryAfterSeconds });
}
