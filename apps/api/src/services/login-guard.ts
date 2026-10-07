/**
 * 登录防暴力破解：验证密码之前先占用一次尝试；超过限制直接拒绝——不再验证密码（不做哈希计算）、不写审计。
 * 规则在 @nozomi/domain 的 login-throttle.ts。「已登录用户改密码时核对当前密码」也走这里，用自己的一组计数。
 */
import { createHash } from "node:crypto";
import {
  LOGIN_MAX_ATTEMPTS_PER_EMAIL,
  LOGIN_MAX_ATTEMPTS_PER_EMAIL_AND_IP,
  LOGIN_MAX_ATTEMPTS_PER_IP,
  combineThrottleDecisions,
  evaluateThrottle,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { withSystemTx } from "../db/context.ts";
import {
  clearLoginAttempts,
  deleteStaleLoginThrottles,
  refundLoginAttempt,
  reserveLoginAttempt,
} from "../repos/login-throttles.ts";
import { tooManyLoginAttempts } from "./errors.ts";

/** 哪一个验证密码的入口：各入口的计数互不影响。 */
export type PasswordCheckEntry = "platform" | "tenant" | "platform-change-password" | "tenant-change-password";

function throttleKey(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\n"), "utf8").digest("hex");
}

/** 一次尝试占用的计数；验证通过后凭它清零 / 退还。 */
export interface LoginReservation {
  perIp: string;
  perEmail: readonly string[];
}

/** 占用一次尝试。超过限制时抛 429，带还要等多少秒。 */
export async function reserveLogin(
  ctx: AppContext,
  entry: PasswordCheckEntry,
  email: string,
  ip: string,
  now: Date,
): Promise<LoginReservation> {
  const perIp = throttleKey(entry, "ip", ip);
  const perEmailAndIp = throttleKey(entry, "email+ip", email, ip);
  const perEmail = throttleKey(entry, "email", email);
  const decision = await withSystemTx(ctx.pool, async (db) => {
    await deleteStaleLoginThrottles(db, now);
    // 先看来源地址这一层：被它拦下的请求不再占用邮箱维度的次数，
    // 否则已经被拦下的攻击者还能继续把别人邮箱的计数顶满
    const ipDecision = evaluateThrottle(await reserveLoginAttempt(db, perIp, now), LOGIN_MAX_ATTEMPTS_PER_IP, now);
    if (!ipDecision.allowed) return ipDecision;
    // 各个 key 总是按同样的先后顺序占用，并发请求之间不会互相死锁
    const emailAndIpCounter = await reserveLoginAttempt(db, perEmailAndIp, now);
    const emailCounter = await reserveLoginAttempt(db, perEmail, now);
    return combineThrottleDecisions([
      evaluateThrottle(emailAndIpCounter, LOGIN_MAX_ATTEMPTS_PER_EMAIL_AND_IP, now),
      evaluateThrottle(emailCounter, LOGIN_MAX_ATTEMPTS_PER_EMAIL, now),
    ]);
  });
  if (!decision.allowed) throw tooManyLoginAttempts(decision.retryAfterSeconds);
  return { perIp, perEmail: [perEmailAndIp, perEmail] };
}

/** 验证通过：邮箱维度清零，来源地址维度退还这一次。 */
export async function clearLoginReservation(ctx: AppContext, reservation: LoginReservation): Promise<void> {
  await withSystemTx(ctx.pool, async (db) => {
    await refundLoginAttempt(db, reservation.perIp);
    await clearLoginAttempts(db, reservation.perEmail);
  });
}
