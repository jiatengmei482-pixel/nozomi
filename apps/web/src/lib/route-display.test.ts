import { test } from "node:test";
import assert from "node:assert/strict";
import { ROUTE_FAILURE_CODES } from "@nozomi/domain";
import type { RouteUsageStatus } from "../api/platform.ts";
import { ROUTE_FAILURE_TEXT, isAddressRouteFailure, routeFailureText, routeUsageBadge } from "./route-display.ts";

test("每个路线原因码都有说明，并且说了怎么办；不认识的码用接口的说明，接口也没给时有兜底", () => {
  assert.deepEqual(Object.keys(ROUTE_FAILURE_TEXT).sort(), [...ROUTE_FAILURE_CODES].sort());
  for (const code of ROUTE_FAILURE_CODES) {
    const text = routeFailureText(code, null);
    assert.equal(text, ROUTE_FAILURE_TEXT[code]);
    assert.match(text, /请|恢复|重试|可以不管/, `${code} 要说怎么办`);
  }
  assert.equal(routeFailureText("NEW_CODE", "接口的说明"), "接口的说明");
  assert.match(routeFailureText("NEW_CODE", null), /请稍后再试/);
  assert.match(ROUTE_FAILURE_TEXT.DAILY_LIMIT_REACHED, /明天自动恢复.*GOOGLE_ROUTES_DAILY_LIMIT/);
});

test("路线预估的徽标：到上限最要紧；最近一次失败晚于成功时提醒；从没调用过时中性", () => {
  const base: RouteUsageStatus = { day: "2026-10-26", calls: 0, daily_limit: 1000, daily_limit_reached: false, failures: 0, refused: 0, last_success_at: null, last_failure: null };
  const failure = (at: string) => ({ code: "TIMEOUT", message: null, at });
  assert.deepEqual(routeUsageBadge(base), { tone: "neutral", label: "还没有调用过" });
  assert.deepEqual(routeUsageBadge({ ...base, last_success_at: "2026-10-26T01:00:00.000Z" }), { tone: "success", label: "正常" });
  assert.deepEqual(routeUsageBadge({ ...base, last_success_at: "2026-10-26T01:00:00.000Z", last_failure: failure("2026-10-26T00:00:00.000Z") }), { tone: "success", label: "正常" });
  assert.deepEqual(routeUsageBadge({ ...base, last_success_at: "2026-10-26T01:00:00.000Z", last_failure: failure("2026-10-26T02:00:00.000Z") }), { tone: "warning", label: "最近一次失败" });
  assert.deepEqual(routeUsageBadge({ ...base, last_failure: failure("2026-10-26T02:00:00.000Z") }), { tone: "warning", label: "最近一次失败" });
  assert.deepEqual(routeUsageBadge({ ...base, calls: 1000, daily_limit_reached: true, last_success_at: "2026-10-26T01:00:00.000Z" }), { tone: "warning", label: "已到每日上限" });
});

test("M4-12 地址问题（NO_ROUTE、INVALID_POINTS）不是服务故障：最近一次失败是它们时不警示，谷歌应答了就按「正常」", () => {
  const base: RouteUsageStatus = { day: "2026-10-26", calls: 3, daily_limit: 1000, daily_limit_reached: false, failures: 1, refused: 0, last_success_at: "2026-10-26T01:00:00.000Z", last_failure: null };
  for (const code of ["NO_ROUTE", "INVALID_POINTS"]) {
    const failure = { code, message: null, at: "2026-10-26T02:00:00.000Z" };
    assert.deepEqual(routeUsageBadge({ ...base, last_failure: failure }), { tone: "success", label: "正常" }, code);
    assert.deepEqual(routeUsageBadge({ ...base, last_success_at: null, last_failure: failure }), { tone: "success", label: "正常" }, `${code}，还没有成功过`);
    assert.deepEqual(routeUsageBadge({ ...base, daily_limit_reached: true, last_failure: failure }), { tone: "warning", label: "已到每日上限" }, `${code}，到了上限仍以上限为准`);
  }
  // 服务类失败照旧警示，包括接口以后多出来、不认识的码
  for (const code of ["TIMEOUT", "KEY_INVALID", "QUOTA_EXCEEDED", "NOT_CONFIGURED", "DAILY_LIMIT_REACHED", "SOMETHING_NEW"]) {
    assert.deepEqual(routeUsageBadge({ ...base, last_failure: { code, message: null, at: "2026-10-26T02:00:00.000Z" } }), { tone: "warning", label: "最近一次失败" }, code);
  }
});

test("M4-12 哪些原因码算地址问题：只有 NO_ROUTE、INVALID_POINTS（和后端负缓存的同一组），其余和不认识的都算服务故障", () => {
  assert.deepEqual(ROUTE_FAILURE_CODES.filter(isAddressRouteFailure), ["INVALID_POINTS", "NO_ROUTE"]);
  assert.equal(isAddressRouteFailure("SOMETHING_NEW"), false);
  assert.equal(isAddressRouteFailure(""), false);
});
