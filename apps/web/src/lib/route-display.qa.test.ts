/**
 * 路线预估的显示（M2-02，测试角色补充）：徽标的边界（成功和失败同一时刻、上限 0、超过上限）、三种来源都有说法、
 * 给客人的原因文字里没有平台内部的说法（谷歌、密钥、配额、上限、原因代码）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { RouteUsageStatus } from "../api/platform.ts";
import { ROUTE_SOURCE_TEXT, routeUsageBadge } from "./route-display.ts";
import { UNAVAILABLE_REASON_TEXT } from "./site-display.ts";

const base: RouteUsageStatus = { day: "2026-10-26", calls: 0, daily_limit: 1000, daily_limit_reached: false, failures: 0, refused: 0, last_success_at: null, last_failure: null };

test("徽标边界：成功和失败在同一时刻不算「最近一次失败」；上限 0（还没调用过）也标「已到每日上限」；超过上限（调低了上限）同样", () => {
  const at = "2026-10-26T03:00:00.000Z";
  assert.deepEqual(routeUsageBadge({ ...base, last_success_at: at, last_failure: { code: "TIMEOUT", message: null, at } }), { tone: "success", label: "正常" });
  assert.deepEqual(routeUsageBadge({ ...base, daily_limit: 0, daily_limit_reached: true }), { tone: "warning", label: "已到每日上限" });
  assert.deepEqual(routeUsageBadge({ ...base, calls: 1_200, daily_limit_reached: true, last_success_at: at }), { tone: "warning", label: "已到每日上限" });
  // 跨天：最近一次失败是昨天、最近一次成功是今天
  assert.deepEqual(routeUsageBadge({ ...base, last_success_at: "2026-10-26T00:00:00.000Z", last_failure: { code: "QUOTA_EXCEEDED", message: null, at: "2026-10-25T14:59:59.999Z" } }), { tone: "success", label: "正常" });
});

test("三种来源（缓存、刚调用谷歌、起终点重合）都有说法，各不相同", () => {
  assert.deepEqual(Object.keys(ROUTE_SOURCE_TEXT).sort(), ["cache", "google", "same_point"]);
  assert.equal(new Set(Object.values(ROUTE_SOURCE_TEXT)).size, 3);
});

test("给客人的原因：没有路线、暂时算不出都告诉客人怎么办；所有原因文字里都没有平台内部的说法和英文代码", () => {
  assert.match(UNAVAILABLE_REASON_TEXT.NO_ROUTE, /换一个地址/);
  assert.match(UNAVAILABLE_REASON_TEXT.TEMPORARILY_UNAVAILABLE, /稍后再试/);
  assert.notEqual(UNAVAILABLE_REASON_TEXT.NO_ROUTE, UNAVAILABLE_REASON_TEXT.TEMPORARILY_UNAVAILABLE);
  for (const [reason, text] of Object.entries(UNAVAILABLE_REASON_TEXT)) {
    assert.doesNotMatch(text, /谷歌|Google|密钥|配额|上限|API|[A-Z]{2,}_[A-Z]/, reason);
  }
});
