import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OPEN_RESCUE_STATUSES,
  RESCUE_RULES,
  RESCUE_STATUSES,
  RESCUE_TRIGGERS,
  RESCUE_TRIGGER_NAMES,
  type RescueTriggerFacts,
  dispatchRescueDueAt,
  driverLateAt,
  rescueDifference,
  rescueOfferDeadline,
  rescueOfferExpired,
  rescuePenalty,
  rescuePenaltyMinor,
  rescueTransitionAllowed,
  rescueTriggerRefusal,
  rescuedDispatchDeadline,
  tenantCanRescue,
  tenantOutOfService,
} from "./rescue.ts";
import { TENANT_STATUSES } from "./tenants.ts";

const HOUR = 3_600_000;
const MINUTE = 60_000;
const service = new Date("2026-11-20T01:00:00.000Z");
const before = (ms: number): Date => new Date(service.getTime() - ms);

test("违约金阶梯（声明无法履约）：正好 24 小时 0、少 1 毫秒 30%；正好 2 小时 30%、少 1 毫秒 100%；用车时间之后 100%", () => {
  assert.deepEqual(rescuePenalty("tenant_declared", service, before(72 * HOUR)), { tier: "none", bp: 0, msBeforeService: 72 * HOUR });
  assert.equal(rescuePenalty("tenant_declared", service, before(24 * HOUR)).bp, 0);
  assert.equal(rescuePenalty("tenant_declared", service, before(24 * HOUR - 1)).bp, 3_000);
  assert.equal(rescuePenalty("tenant_declared", service, before(24 * HOUR - 1)).tier, "partial");
  assert.equal(rescuePenalty("tenant_declared", service, before(2 * HOUR)).bp, 3_000);
  assert.equal(rescuePenalty("tenant_declared", service, before(2 * HOUR - 1)).bp, 10_000);
  assert.equal(rescuePenalty("tenant_declared", service, before(0)).tier, "full");
  const late = rescuePenalty("tenant_declared", service, before(-30 * MINUTE));
  assert.deepEqual(late, { tier: "full", bp: 10_000, msBeforeService: -30 * MINUTE });
});

test("违约金阶梯：用车前 6 小时仍未派车、司机未到一律 100%，不看离用车多久", () => {
  for (const trigger of ["dispatch_overdue", "driver_no_show"] as const) {
    assert.equal(rescuePenalty(trigger, service, before(6 * HOUR)).bp, 10_000, trigger);
    assert.equal(rescuePenalty(trigger, service, before(30 * HOUR)).bp, 10_000, `${trigger}：即使离用车还远`);
    assert.equal(rescuePenalty(trigger, service, before(-20 * MINUTE)).tier, "full");
  }
});

test("违约金阶梯：供应商被暂停按触发时距用车时间套用前 3 行（和声明同一套边界）", () => {
  assert.equal(rescuePenalty("tenant_suspended", service, before(24 * HOUR)).bp, 0);
  assert.equal(rescuePenalty("tenant_suspended", service, before(24 * HOUR - 1)).bp, 3_000);
  assert.equal(rescuePenalty("tenant_suspended", service, before(2 * HOUR)).bp, 3_000);
  assert.equal(rescuePenalty("tenant_suspended", service, before(2 * HOUR - 1)).bp, 10_000);
});

test("违约金金额 = 原结算价 × 比例，最小单位四舍五入（0.5 远离零）", () => {
  assert.equal(rescuePenaltyMinor(10_000, 3_000), 3_000);
  assert.equal(rescuePenaltyMinor(12_345, 3_000), 3_704, "3703.5 进位");
  assert.equal(rescuePenaltyMinor(12_345, 10_000), 12_345);
  assert.equal(rescuePenaltyMinor(12_345, 0), 0);
  assert.equal(rescuePenaltyMinor(1, 3_000), 0, "0.3 舍去");
  assert.throws(() => rescuePenaltyMinor(100, 10_001), RangeError);
  assert.throws(() => rescuePenaltyMinor(100, 1.5), RangeError);
});

test("救援差价（同币种）：救援结算价 − 原结算价，为负记 0，原差额留着对账", () => {
  const base = { originalCurrency: "JPY", originalFx: null, rescueCurrency: "JPY", rescueFx: null, customerCurrency: "JPY" } as const;
  assert.deepEqual(rescueDifference({ ...base, originalMinor: 10_000, rescueMinor: 12_500 }), { ok: true, minor: 2_500, rawMinor: 2_500, rescueInOriginalMinor: 12_500 });
  assert.deepEqual(rescueDifference({ ...base, originalMinor: 10_000, rescueMinor: 9_000 }), { ok: true, minor: 0, rawMinor: -1_000, rescueInOriginalMinor: 9_000 });
  assert.deepEqual(rescueDifference({ ...base, originalMinor: 10_000, rescueMinor: 10_000 }), { ok: true, minor: 0, rawMinor: 0, rescueInOriginalMinor: 10_000 });
});

test("救援差价（同币种、客人付别的币种）：不用汇率，直接相减", () => {
  const result = rescueDifference({ originalMinor: 10_000, originalCurrency: "JPY", originalFx: { from: "JPY", to: "CNY", rate: "0.047" }, rescueMinor: 11_000, rescueCurrency: "JPY", rescueFx: { from: "JPY", to: "CNY", rate: "0.05" }, customerCurrency: "CNY" });
  assert.deepEqual(result, { ok: true, minor: 1_000, rawMinor: 1_000, rescueInOriginalMinor: 11_000 });
});

test("救援差价（跨币种）：救援结算价按救援快照汇率换到客人币种，再按原订单快照汇率换回原结算币种；只取整一次", () => {
  // 原供应商 JPY 10,000，客人付 CNY，原快照 1 JPY = 0.05 CNY；救援供应商 KRW 100,000，救援快照 1 KRW = 0.0053 CNY
  // 100,000 KRW × 0.0053 = 530 CNY → ÷ 0.05 = 10,600 JPY → 差价 600 JPY
  const result = rescueDifference({ originalMinor: 10_000, originalCurrency: "JPY", originalFx: { from: "JPY", to: "CNY", rate: "0.05" }, rescueMinor: 100_000, rescueCurrency: "KRW", rescueFx: { from: "KRW", to: "CNY", rate: "0.0053" }, customerCurrency: "CNY" });
  assert.deepEqual(result, { ok: true, minor: 600, rawMinor: 600, rescueInOriginalMinor: 10_600 });
});

test("救援差价（跨币种、有小数位的币种）：最小单位按两边的小数位挪；四舍五入在最后一次", () => {
  // 原供应商 CNY 500.00（50,000 分），客人付 CNY；救援供应商 JPY 10,333，1 JPY = 0.05 CNY → 516.65 CNY → 差 16.65 CNY = 1,665 分
  const result = rescueDifference({ originalMinor: 50_000, originalCurrency: "CNY", originalFx: null, rescueMinor: 10_333, rescueCurrency: "JPY", rescueFx: { from: "JPY", to: "CNY", rate: "0.05" }, customerCurrency: "CNY" });
  assert.deepEqual(result, { ok: true, minor: 1_665, rawMinor: 1_665, rescueInOriginalMinor: 51_665 });
  // 反过来：原供应商 JPY 10,000，客人付 JPY；救援供应商 CNY 480.01，1 CNY = 21.3 JPY → 10,224.213 → 差 224.213 → 224
  const back = rescueDifference({ originalMinor: 10_000, originalCurrency: "JPY", originalFx: null, rescueMinor: 48_001, rescueCurrency: "CNY", rescueFx: { from: "CNY", to: "JPY", rate: "21.3" }, customerCurrency: "JPY" });
  assert.deepEqual(back, { ok: true, minor: 224, rawMinor: 224, rescueInOriginalMinor: 10_224 });
  // 正好一半远离零：1 CNY = 20.005 JPY，100.00 CNY → 2,000.5 JPY → 2,001；差 2,001 − 2,000 = 0.5 → 1
  const half = rescueDifference({ originalMinor: 2_000, originalCurrency: "JPY", originalFx: null, rescueMinor: 10_000, rescueCurrency: "CNY", rescueFx: { from: "CNY", to: "JPY", rate: "20.005" }, customerCurrency: "JPY" });
  assert.deepEqual(half, { ok: true, minor: 1, rawMinor: 1, rescueInOriginalMinor: 2_001 });
});

test("救援差价（跨币种）为负记 0；缺汇率、汇率方向对不上时报 FX_RATE_UNAVAILABLE", () => {
  const cheaper = rescueDifference({ originalMinor: 10_000, originalCurrency: "JPY", originalFx: { from: "JPY", to: "CNY", rate: "0.05" }, rescueMinor: 90_000, rescueCurrency: "KRW", rescueFx: { from: "KRW", to: "CNY", rate: "0.0053" }, customerCurrency: "CNY" });
  assert.deepEqual(cheaper, { ok: true, minor: 0, rawMinor: -460, rescueInOriginalMinor: 9_540 });
  assert.deepEqual(rescueDifference({ originalMinor: 10_000, originalCurrency: "JPY", originalFx: null, rescueMinor: 100_000, rescueCurrency: "KRW", rescueFx: { from: "KRW", to: "CNY", rate: "0.0053" }, customerCurrency: "CNY" }), { ok: false, reason: "FX_RATE_UNAVAILABLE" });
  assert.deepEqual(rescueDifference({ originalMinor: 10_000, originalCurrency: "JPY", originalFx: { from: "JPY", to: "CNY", rate: "0.05" }, rescueMinor: 100_000, rescueCurrency: "KRW", rescueFx: { from: "KRW", to: "USD", rate: "0.0007" }, customerCurrency: "CNY" }), { ok: false, reason: "FX_RATE_UNAVAILABLE" });
});

test("自动触发「用车前 6 小时仍未派车」：用车前 6 小时起，但不早于派车截止时间（付款时已不足 6 小时的单）", () => {
  assert.equal(dispatchRescueDueAt(service, before(24 * HOUR)).toISOString(), before(6 * HOUR).toISOString());
  assert.equal(dispatchRescueDueAt(service, before(1 * HOUR)).toISOString(), before(1 * HOUR).toISOString());
  const facts = (now: Date): RescueTriggerFacts => ({ status: "confirmed", serviceAt: service, dispatchDueAt: before(24 * HOUR), landedAt: null, tenantSuspended: false, now });
  assert.equal(rescueTriggerRefusal("dispatch_overdue", facts(before(6 * HOUR + 1))), "TOO_EARLY");
  assert.equal(rescueTriggerRefusal("dispatch_overdue", facts(before(6 * HOUR))), null, "正好 6 小时就触发");
  assert.equal(rescueTriggerRefusal("dispatch_overdue", { ...facts(before(5 * HOUR)), status: "assigned" }), "ORDER_STATE_INVALID", "派了车就不是未派车");
  assert.equal(rescueTriggerRefusal("dispatch_overdue", { ...facts(before(5 * HOUR)), dispatchDueAt: null }), "ORDER_STATE_INVALID");
});

test("司机未到：到点 15 分钟（含那一刻）仍未到达；接机晚点时从实际落地时间算", () => {
  assert.equal(driverLateAt(service, null).toISOString(), new Date(service.getTime() + 15 * MINUTE).toISOString());
  assert.equal(driverLateAt(service, before(20 * MINUTE)).toISOString(), new Date(service.getTime() + 15 * MINUTE).toISOString(), "早到的航班仍从用车时间算");
  const landed = new Date(service.getTime() + 2 * HOUR);
  assert.equal(driverLateAt(service, landed).toISOString(), new Date(landed.getTime() + 15 * MINUTE).toISOString());
  const facts = (now: Date, status: RescueTriggerFacts["status"] = "assigned"): RescueTriggerFacts => ({ status, serviceAt: service, dispatchDueAt: before(24 * HOUR), landedAt: null, tenantSuspended: false, now });
  assert.equal(rescueTriggerRefusal("driver_no_show", facts(new Date(service.getTime() + 15 * MINUTE - 1))), "TOO_EARLY");
  assert.equal(rescueTriggerRefusal("driver_no_show", facts(new Date(service.getTime() + 15 * MINUTE))), null);
  assert.equal(rescueTriggerRefusal("driver_no_show", facts(new Date(service.getTime() + HOUR), "departed")), null);
  assert.equal(rescueTriggerRefusal("driver_no_show", facts(new Date(service.getTime() + HOUR), "arrived")), "ORDER_STATE_INVALID", "到了就不是未到");
});

test("司机未到（改派转来的那一行）：到点不早于改派后 60 分钟，再过 15 分钟仍未到达才算；改派得早的照常从用车时间算", () => {
  const lateRescue = new Date(service.getTime() + 20 * MINUTE);
  assert.equal(driverLateAt(service, null, lateRescue).toISOString(), new Date(lateRescue.getTime() + 75 * MINUTE).toISOString());
  const landed = new Date(service.getTime() + 2 * HOUR);
  assert.equal(driverLateAt(service, landed, lateRescue).toISOString(), new Date(landed.getTime() + 15 * MINUTE).toISOString(), "落地更晚的从落地时间算");
  assert.equal(driverLateAt(service, null, before(3 * HOUR)).toISOString(), new Date(service.getTime() + 15 * MINUTE).toISOString(), "用车前 3 小时改派的从用车时间算");
  assert.equal(driverLateAt(service, null, before(60 * MINUTE)).toISOString(), new Date(service.getTime() + 15 * MINUTE).toISOString(), "正好用车前 60 分钟改派，仍从用车时间算");
  assert.equal(driverLateAt(service, null, before(60 * MINUTE - 1)).getTime(), service.getTime() + 15 * MINUTE + 1, "少 1 毫秒就往后推 1 毫秒");
  const facts = (now: Date): RescueTriggerFacts => ({ status: "confirmed", serviceAt: service, dispatchDueAt: new Date(lateRescue.getTime() + 30 * MINUTE), landedAt: null, rescuedAt: lateRescue, tenantSuspended: false, now });
  assert.equal(rescueTriggerRefusal("driver_no_show", facts(new Date(lateRescue.getTime() + MINUTE))), "TOO_EARLY", "接手 1 分钟不能按司机未到再救援");
  assert.equal(rescueTriggerRefusal("driver_no_show", facts(new Date(lateRescue.getTime() + 75 * MINUTE - 1))), "TOO_EARLY");
  assert.equal(rescueTriggerRefusal("driver_no_show", facts(new Date(lateRescue.getTime() + 75 * MINUTE))), null);
  assert.equal(rescueTriggerRefusal("driver_no_show", { ...facts(new Date(service.getTime() + 15 * MINUTE)), rescuedAt: null }), null, "不是转来的照旧");
});

test("声明无法履约：已确认、已派车、司机已出发都可以；到达之后、已完成、已取消、救援中不行", () => {
  const facts = (status: RescueTriggerFacts["status"]): RescueTriggerFacts => ({ status, serviceAt: service, dispatchDueAt: before(24 * HOUR), landedAt: null, tenantSuspended: false, now: before(48 * HOUR) });
  for (const status of ["confirmed", "assigned", "departed"] as const) assert.equal(rescueTriggerRefusal("tenant_declared", facts(status)), null, status);
  for (const status of ["pending_payment", "arrived", "in_service", "completed", "cancelled", "rescue_pending", "rescued", "no_show_claimed"] as const) assert.equal(rescueTriggerRefusal("tenant_declared", facts(status)), "ORDER_STATE_INVALID", status);
});

test("供应商被暂停：只能救暂停中的供应商的未来订单", () => {
  const facts = (overrides: Partial<RescueTriggerFacts>): RescueTriggerFacts => ({ status: "assigned", serviceAt: service, dispatchDueAt: before(24 * HOUR), landedAt: null, tenantSuspended: true, now: before(HOUR), ...overrides });
  assert.equal(rescueTriggerRefusal("tenant_suspended", facts({})), null);
  assert.equal(rescueTriggerRefusal("tenant_suspended", facts({ tenantSuspended: false })), "TENANT_NOT_SUSPENDED");
  assert.equal(rescueTriggerRefusal("tenant_suspended", facts({ now: service })), "SERVICE_TIME_PASSED", "用车时间到了就不是未来订单");
});

test("救援单的接单期限：15 分钟；发出时离用车不足 2 小时的 5 分钟（正好 2 小时仍是 15 分钟）；到期那一刻起不能接", () => {
  assert.equal(rescueOfferDeadline(before(3 * HOUR), service).getTime(), before(3 * HOUR).getTime() + 15 * MINUTE);
  assert.equal(rescueOfferDeadline(before(2 * HOUR), service).getTime(), before(2 * HOUR).getTime() + 15 * MINUTE);
  assert.equal(rescueOfferDeadline(before(2 * HOUR - 1), service).getTime(), before(2 * HOUR - 1).getTime() + 5 * MINUTE);
  const expires = new Date("2026-11-19T10:15:00.000Z");
  assert.equal(rescueOfferExpired(expires, new Date(expires.getTime() - 1)), false);
  assert.equal(rescueOfferExpired(expires, expires), true);
});

test("救援的状态：没有结论的三种；已改派、已取消是终态；不能回到待处理", () => {
  assert.deepEqual(OPEN_RESCUE_STATUSES, ["open", "offering", "exhausted"]);
  for (const status of RESCUE_STATUSES) assert.equal(rescueTransitionAllowed(status, "open"), false, `${status} 不能回到待处理`);
  for (const status of ["rescued", "cancelled"] as const) for (const to of RESCUE_STATUSES) assert.equal(rescueTransitionAllowed(status, to), false);
  assert.equal(rescueTransitionAllowed("offering", "exhausted"), true);
  assert.equal(rescueTransitionAllowed("exhausted", "offering"), true, "运营可以再发一轮");
  assert.equal(rescueTransitionAllowed("open", "rescued"), true, "人工指定可以不经过救援单");
});

test("4 种触发情形都有中文名；规则常量和需求一致", () => {
  assert.deepEqual([...RESCUE_TRIGGERS], ["tenant_declared", "dispatch_overdue", "driver_no_show", "tenant_suspended"]);
  for (const trigger of RESCUE_TRIGGERS) assert.ok(RESCUE_TRIGGER_NAMES[trigger].length > 0);
  assert.equal(RESCUE_RULES.partialPenaltyBp, 3_000);
  assert.equal(RESCUE_RULES.fullPenaltyBp, 10_000);
  assert.equal(RESCUE_RULES.offerMinutes, 15);
  assert.equal(RESCUE_RULES.shortOfferMinutes, 5);
});

test("救援供应商接单后的派车截止时间：离用车还远按普通规则（用车前 24 小时 / 接单后 2 小时）；到点之后才改派的至少留 30 分钟", () => {
  assert.equal(rescuedDispatchDeadline(before(72 * HOUR), service).toISOString(), before(24 * HOUR).toISOString());
  assert.equal(rescuedDispatchDeadline(before(10 * HOUR), service).getTime(), before(10 * HOUR).getTime() + 2 * HOUR);
  assert.equal(rescuedDispatchDeadline(before(20 * MINUTE), service).getTime(), before(20 * MINUTE).getTime() + 30 * MINUTE, "不晚于用车时间的规则让它落在 20 分钟后，这里至少 30 分钟");
  const late = new Date(service.getTime() + 20 * MINUTE);
  assert.equal(rescuedDispatchDeadline(late, service).getTime(), late.getTime() + 30 * MINUTE);
});

test("供应商状态（ADR 0028）：暂停中、已清退才算「被暂停或解约」；能接救援单的是试运营和正式", () => {
  assert.deepEqual(TENANT_STATUSES.filter(tenantOutOfService), ["suspended", "terminated"]);
  assert.deepEqual(TENANT_STATUSES.filter(tenantCanRescue), ["trial", "active"]);
});
