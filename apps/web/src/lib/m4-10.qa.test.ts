/**
 * M4-10 测试角色：本任务改到的几处页面说法（纯函数）补边界。
 * - 入驻进度按实际阶段说：资质已到期（DOCUMENT_EXPIRED）不是「正在审核」；
 * - 行程按品类：供应商后台订单（同一个 routeText）里的包车；接送机缺一头时仍写机场；
 * - 收款状态每一种都有中文名；
 * - 「操作」筛选的选项值都能通过接口的校验（最多 10 个、每个 1–50 字）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { AUDIT_ACTIONS, PAYMENT_STATUSES } from "@nozomi/domain";
import type { CompanyOverview } from "../api/onboarding.ts";
import { ACTION_FILTER_OPTIONS, ACTION_NAMES, isActionFilter } from "./audit-display.ts";
import { routeText } from "./dispatch-display.ts";
import { PAYMENT_STATUS_NAMES, paymentStatusName } from "./order-money-display.ts";
import { progressHint } from "./onboarding-display.ts";

const reviewing = { status: "reviewing" } as CompanyOverview["tenant"];
const hint = (issues: { path: string; reason: string }[], audience: "tenant" | "platform" = "platform"): string => progressHint({ tenant: reviewing, next_step_issues: issues }, audience);

test("入驻进度（审核中）：有资质已到期的，不说「资质正在审核」（已到期要供应商重新上传）", () => {
  for (const audience of ["platform", "tenant"] as const) {
    const text = hint([{ path: "/documents/vehicle_insurance", reason: "DOCUMENT_EXPIRED" }], audience);
    assert.doesNotMatch(text, /资质正在审核/, `${audience}：${text}`);
    assert.match(text, /到期/, `${audience}：要说清是到期了：${text}`);
  }
});

test("入驻进度（审核中）：资质还没审完（DOCUMENT_NOT_APPROVED）、合同也没生效时照旧说正在审核", () => {
  assert.match(hint([{ path: "/documents/business_license", reason: "DOCUMENT_NOT_APPROVED" }, { path: "/contract", reason: "CONTRACT_NOT_EFFECTIVE" }]), /资质正在审核/);
});

test("行程（供应商后台订单列表和详情用同一个 routeText）：包车写时长和上车点；接送机缺的一头写机场名；点对点照常", () => {
  assert.equal(routeText({ category: "charter", direction: null, package_hours: 4, pickup: { lng: 1, lat: 1, address: "新宿站" }, dropoff: null }), "包车 4 小时 · 上车：新宿站");
  assert.doesNotMatch(routeText({ category: "charter", direction: null, package_hours: 4, pickup: { lng: 1, lat: 1, address: "新宿站" }, dropoff: null }), /→ —/);
  assert.equal(routeText({ category: "airport_transfer", direction: "pickup", pickup: null, dropoff: { lng: 1, lat: 1, address: "东京站" } }, "成田机场"), "成田机场 → 东京站");
  assert.equal(routeText({ category: "airport_transfer", direction: "dropoff", pickup: { lng: 1, lat: 1, address: "东京站" }, dropoff: null }, "羽田机场"), "东京站 → 羽田机场");
});

test("收款状态：每一种都有中文名，不显示英文原值；不认识的原样（以后新增的状态也看得出来）", () => {
  for (const status of PAYMENT_STATUSES) {
    const name = paymentStatusName(status);
    assert.match(name, /[一-鿿]/, status);
    assert.notEqual(name, status);
    assert.equal(name, PAYMENT_STATUS_NAMES[status]);
  }
  assert.equal(paymentStatusName("weird_new_status"), "weird_new_status");
});

test("「操作」筛选：每个选项的值都满足接口的限制（最多 10 个、每个 1–50 字、无空项），每个已知动作都有中文名并在某一项里", () => {
  for (const option of ACTION_FILTER_OPTIONS) {
    const parts = option.value.split(",");
    assert.ok(parts.length <= 10, option.value);
    assert.ok(parts.every((part) => part.length >= 1 && part.length <= 50), option.value);
    assert.ok(option.value.length <= 500, option.value);
    assert.ok(isActionFilter(option.value), option.value);
  }
  const covered = new Set(ACTION_FILTER_OPTIONS.flatMap((option) => option.value.split(",")));
  assert.deepEqual(AUDIT_ACTIONS.filter((action) => ACTION_NAMES[action] === undefined || !covered.has(action)), [], "每个已知动作都能在「操作」里选到");
});
