/**
 * 登录防暴力破解的规则（M0-06）：固定时间窗内限制尝试次数。
 *
 * 计数方式是「先占用一次，再验证密码」：并发的猜测请求不可能绕过计数。
 * 窗口从第一次尝试开始算，满 15 分钟后下一次尝试从 1 重新计数（计数本身在数据库里原子完成）。
 * 三个维度同时限制：
 * - 同一来源地址（不分邮箱）：窗口内最多 50 次失败。挡住同一个地址轮换邮箱无限触发密码哈希计算、灌满审计日志。
 *   这一层最先检查；被它拦下的请求不占用下面两个维度的次数。登录成功的那一次会退还，
 *   所以很多人共用一个出口地址正常登录不受影响。
 * - 同一邮箱 + 同一来源地址：窗口内最多 5 次。登录成功后清零。
 * - 同一邮箱（不分来源）：窗口内最多 20 次，挡住换着地址猜同一个账号。登录成功后清零。
 * 邮箱不存在时同样计数、同样返回，所以从限速表现上看不出邮箱是否存在。
 */

export const LOGIN_THROTTLE_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_ATTEMPTS_PER_EMAIL_AND_IP = 5;
export const LOGIN_MAX_ATTEMPTS_PER_EMAIL = 20;
export const LOGIN_MAX_ATTEMPTS_PER_IP = 50;

export interface ThrottleCounter {
  /** 当前窗口内已经占用的次数（含本次） */
  attemptCount: number;
  /** 当前窗口的开始时间 */
  windowStartedAt: Date;
}

export interface ThrottleDecision {
  allowed: boolean;
  /** 被拦下时，还要等多少秒窗口才结束；放行时为 0 */
  retryAfterSeconds: number;
}

/** 本次尝试（已计入 counter）是否放行。 */
export function evaluateThrottle(counter: ThrottleCounter, maxAttempts: number, now: Date): ThrottleDecision {
  if (counter.attemptCount <= maxAttempts) return { allowed: true, retryAfterSeconds: 0 };
  const windowEndsAt = counter.windowStartedAt.getTime() + LOGIN_THROTTLE_WINDOW_MS;
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((windowEndsAt - now.getTime()) / 1000)) };
}

/** 多个维度的结论合并：任何一个拦下就拦下，等待时间取最长的。 */
export function combineThrottleDecisions(decisions: readonly ThrottleDecision[]): ThrottleDecision {
  const blocked = decisions.filter((decision) => !decision.allowed);
  if (blocked.length === 0) return { allowed: true, retryAfterSeconds: 0 };
  return { allowed: false, retryAfterSeconds: Math.max(...blocked.map((decision) => decision.retryAfterSeconds)) };
}
