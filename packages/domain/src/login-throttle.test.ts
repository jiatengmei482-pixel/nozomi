import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LOGIN_MAX_ATTEMPTS_PER_EMAIL,
  LOGIN_MAX_ATTEMPTS_PER_EMAIL_AND_IP,
  LOGIN_MAX_ATTEMPTS_PER_IP,
  LOGIN_THROTTLE_WINDOW_MS,
  combineThrottleDecisions,
  evaluateRollingWindow,
  evaluateThrottle,
} from "./login-throttle.ts";

const start = new Date("2026-10-07T00:00:00Z");
const after = (ms: number): Date => new Date(start.getTime() + ms);

test("限速参数：15 分钟窗口，同邮箱同地址 5 次，同邮箱 20 次，同地址不分邮箱 50 次", () => {
  assert.equal(LOGIN_MAX_ATTEMPTS_PER_IP, 50);
  assert.equal(LOGIN_THROTTLE_WINDOW_MS, 900_000);
  assert.equal(LOGIN_MAX_ATTEMPTS_PER_EMAIL_AND_IP, 5);
  assert.equal(LOGIN_MAX_ATTEMPTS_PER_EMAIL, 20);
});

test("窗口内第 5 次放行，第 6 次拦下并给出还要等多久", () => {
  assert.deepEqual(evaluateThrottle({ attemptCount: 5, windowStartedAt: start }, 5, after(60_000)), {
    allowed: true,
    retryAfterSeconds: 0,
  });
  assert.deepEqual(evaluateThrottle({ attemptCount: 6, windowStartedAt: start }, 5, after(60_000)), {
    allowed: false,
    retryAfterSeconds: 840,
  });
});

test("等待时间向上取整，至少 1 秒", () => {
  const counter = { attemptCount: 9, windowStartedAt: start };
  assert.equal(evaluateThrottle(counter, 5, after(LOGIN_THROTTLE_WINDOW_MS - 1_500)).retryAfterSeconds, 2);
  assert.equal(evaluateThrottle(counter, 5, after(LOGIN_THROTTLE_WINDOW_MS - 1)).retryAfterSeconds, 1);
  assert.equal(evaluateThrottle(counter, 5, after(LOGIN_THROTTLE_WINDOW_MS + 5_000)).retryAfterSeconds, 1);
});

test("多个维度合并：都放行才放行；拦下时等待时间取最长", () => {
  const ok = { allowed: true, retryAfterSeconds: 0 };
  assert.deepEqual(combineThrottleDecisions([ok, ok]), ok);
  assert.deepEqual(combineThrottleDecisions([]), ok);
  assert.deepEqual(
    combineThrottleDecisions([ok, { allowed: false, retryAfterSeconds: 30 }, { allowed: false, retryAfterSeconds: 90 }]),
    { allowed: false, retryAfterSeconds: 90 },
  );
});

test("滚动时间窗：窗口里少于上限放行；满上限拦下，等到最早的那次滑出窗口；窗口外的不算；多于上限时等到剩下的少于上限", () => {
  const day = 24 * 3_600_000;
  const now = new Date(start.getTime() + day);
  const at = (msBeforeNow: number) => new Date(now.getTime() - msBeforeNow);
  assert.deepEqual(evaluateRollingWindow([at(1_000), at(2_000)], 3, day, now), { allowed: true, retryAfterSeconds: 0 });
  assert.deepEqual(evaluateRollingWindow([at(1_000), at(3_600_000), at(2_000)], 3, day, now), { allowed: false, retryAfterSeconds: 23 * 3600 });
  assert.deepEqual(evaluateRollingWindow([at(day), at(1_000), at(2_000)], 3, day, now), { allowed: true, retryAfterSeconds: 0 }, "正好 24 小时前的已滑出");
  assert.deepEqual(evaluateRollingWindow([at(day - 500), at(1_000), at(2_000)], 3, day, now), { allowed: false, retryAfterSeconds: 1 }, "差 0.5 秒滑出：至少等 1 秒");
  assert.deepEqual(evaluateRollingWindow([at(5_000), at(4_000), at(3_000), at(2_000)], 3, day, now), { allowed: false, retryAfterSeconds: day / 1000 - 4 }, "4 次：要等最早的两次都滑出");
});
