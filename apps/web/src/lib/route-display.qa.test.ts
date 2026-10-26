/**
 * 路线预估的显示（M2-02，测试角色补充）：徽标的边界（成功和失败同一时刻、上限 0、超过上限）、三种来源都有说法、
 * 给客人的原因文字里没有平台内部的说法（谷歌、密钥、配额、上限、原因代码）。
 * M4-12 补充：地址问题（NO_ROUTE、INVALID_POINTS，说明谷歌地图应答了）和服务故障、成功、每日上限的先后组合。接口只给最近一次成功、最近一次失败各一条。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ROUTE_FAILURE_CODES } from "@nozomi/domain";
import type { RouteUsageStatus } from "../api/platform.ts";
import { ROUTE_SOURCE_TEXT, isAddressRouteFailure, routeUsageBadge } from "./route-display.ts";
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

const used: RouteUsageStatus = { ...base, calls: 10, failures: 2 };
const at = (hour: number): string => new Date(Date.UTC(2026, 9, 26, hour)).toISOString();
const failed = (code: string, hour: number) => ({ code, message: null, at: at(hour) });
const OK = { tone: "success", label: "正常" } as const;
const WARN = { tone: "warning", label: "最近一次失败" } as const;
const LIMIT = { tone: "warning", label: "已到每日上限" } as const;

test("M4-12 地址问题之后又有服务故障（最近一次失败是服务故障，晚于成功）：警示", () => {
  for (const code of ["TIMEOUT", "KEY_INVALID", "UNAVAILABLE", "UNREACHABLE", "BILLING_DISABLED"]) {
    assert.deepEqual(routeUsageBadge({ ...used, last_success_at: at(1), last_failure: failed(code, 3) }), WARN, code);
  }
});

test("M4-12 服务故障之后成功了（成功晚于最近一次失败）：正常；成功和失败同一时刻也不警示", () => {
  for (const code of ["TIMEOUT", "KEY_INVALID", "SOMETHING_NEW"]) {
    assert.deepEqual(routeUsageBadge({ ...used, last_success_at: at(4), last_failure: failed(code, 3) }), OK, code);
    assert.deepEqual(routeUsageBadge({ ...used, last_success_at: at(3), last_failure: failed(code, 3) }), OK, `${code} 同一时刻`);
  }
});

test("M4-12 服务故障之后来了一次地址问题（最近一次失败是地址问题）：谷歌应答了，按正常", () => {
  for (const code of ["NO_ROUTE", "INVALID_POINTS"]) {
    assert.deepEqual(routeUsageBadge({ ...used, last_success_at: at(1), last_failure: failed(code, 3) }), OK, code);
    assert.deepEqual(routeUsageBadge({ ...used, last_success_at: at(5), last_failure: failed(code, 3) }), OK, `${code}，后来又成功了`);
  }
});

test("M4-12 地址问题和每日上限同时：以上限为准，不管有没有成功过", () => {
  for (const code of ["NO_ROUTE", "INVALID_POINTS"]) {
    for (const success of [null, at(1), at(5)]) {
      assert.deepEqual(routeUsageBadge({ ...used, daily_limit_reached: true, last_success_at: success, last_failure: failed(code, 3) }), LIMIT, `${code} / ${success}`);
    }
  }
  assert.deepEqual(routeUsageBadge({ ...used, daily_limit: 0, calls: 0, daily_limit_reached: true, last_failure: failed("NO_ROUTE", 3) }), LIMIT, "上限设为 0");
});

test("M4-12 只有过地址问题、从没成功过：按正常，不是「还没有调用过」（调用过了，谷歌应答了）", () => {
  for (const code of ["NO_ROUTE", "INVALID_POINTS"]) assert.deepEqual(routeUsageBadge({ ...used, last_failure: failed(code, 3) }), OK, code);
  assert.deepEqual(routeUsageBadge({ ...used, calls: 0, failures: 0 }), { tone: "neutral", label: "还没有调用过" });
});

test("M4-12 只有原样的大写码才算地址问题：小写、带空格、像原型属性名的码都按服务故障", () => {
  for (const code of ["no_route", "NO_ROUTE ", " INVALID_POINTS", "toString", "constructor", "__proto__", "hasOwnProperty"]) {
    assert.equal(isAddressRouteFailure(code), false, code);
    assert.deepEqual(routeUsageBadge({ ...used, last_success_at: at(1), last_failure: failed(code, 3) }), WARN, code);
  }
  assert.equal(ROUTE_FAILURE_CODES.filter(isAddressRouteFailure).length, 2);
});
