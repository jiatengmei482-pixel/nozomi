/**
 * M3-04 测试角色补充：救援改派的纯规则（ADR 0031）和一份独立实现在随机输入上逐条比对。
 * - 违约金阶梯：边界两侧按毫秒（正好 24 小时 0、少 1 毫秒 30%；正好 2 小时 30%、少 1 毫秒 100%），未派车 / 司机未到一律 100%；
 * - 违约金金额：基数是原结算价、四舍五入（0.5 远离零），和逐位手算的结果一致；
 * - 救援差价：两边各用自己的快照汇率、精确分数、只取整一次；为负记 0；同币种直接相减不看汇率；汇率方向对不上时拒绝；
 * - 救援单期限（2 小时整是 15 分钟、少 1 毫秒 5 分钟）、到期那一刻起算超时、改派后的派车截止至少留 30 分钟；
 * - 未派车的触发时刻 = max(用车前 6 小时, 派车截止)、司机未到 = max(用车, 落地) + 15 分钟（含那一刻）、暂停只认暂停中 / 已清退。
 * 随机数用固定种子，失败时能复现。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatchDeadline } from "./dispatch.ts";
import type { CurrencyCode } from "./money.ts";
import {
  RESCUE_TRIGGERS,
  type RescueTrigger,
  dispatchRescueDueAt,
  driverLateAt,
  rescueDifference,
  rescueOfferDeadline,
  rescueOfferExpired,
  rescuePenalty,
  rescuePenaltyMinor,
  rescueTriggerRefusal,
  rescuedDispatchDeadline,
  tenantCanRescue,
  tenantOutOfService,
} from "./rescue.ts";
import { TENANT_STATUSES } from "./tenants.ts";
import { ORDER_STATUSES } from "./orders.ts";

const HOUR = 3_600_000;
const MINUTE = 60_000;

/** mulberry32：固定种子的伪随机数，失败时能复现 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
const intIn = (next: () => number, lo: number, hi: number): number => lo + Math.floor(next() * (hi - lo + 1));

// ---- 独立实现 ----

function oraclePenaltyBp(trigger: RescueTrigger, msBefore: number): number {
  if (trigger === "dispatch_overdue" || trigger === "driver_no_show") return 10_000;
  if (msBefore >= 24 * HOUR) return 0;
  if (msBefore >= 2 * HOUR) return 3_000;
  return 10_000;
}

/** 非负整数 × 基点 / 10000，四舍五入（0.5 进位）：用 Number 的整除和余数手算（乘积在安全整数范围内） */
function oraclePenaltyMinor(settlement: number, bp: number): number {
  const product = settlement * bp;
  const whole = Math.floor(product / 10_000);
  const rest = product - whole * 10_000;
  return rest * 2 >= 10_000 ? whole + 1 : whole;
}

interface Q {
  n: bigint;
  d: bigint;
}
const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x === 0n ? 1n : x;
};
const q = (n: bigint, d: bigint): Q => {
  const sign = d < 0n ? -1n : 1n;
  const g = gcd(n, d < 0n ? -d : d);
  return { n: (sign * n) / g, d: (sign * d) / g };
};
const mul = (a: Q, b: Q): Q => q(a.n * b.n, a.d * b.d);
const div = (a: Q, b: Q): Q => q(a.n * b.d, a.d * b.n);
const sub = (a: Q, b: Q): Q => q(a.n * b.d - b.n * a.d, a.d * b.d);
/** 十进制汇率字符串 → 分数（不用被测模块的 rateToFraction） */
const rateQ = (rate: string): Q => {
  const [whole, frac = ""] = rate.split(".");
  return q(BigInt(`${whole}${frac}`), 10n ** BigInt(frac.length));
};
/** 四舍五入（0.5 远离零）：|x| 的整数部分 = floor((2|n| + d) / 2d) */
const roundQ = (x: Q): bigint => {
  const abs = x.n < 0n ? -x.n : x.n;
  const r = (2n * abs + x.d) / (2n * x.d);
  return x.n < 0n ? -r : r;
};
const DIGITS: Record<CurrencyCode, number> = { JPY: 0, KRW: 0, CNY: 2, USD: 2, HKD: 2, TWD: 2, THB: 2 };
const major = (minor: number, currency: CurrencyCode): Q => q(BigInt(minor), 10n ** BigInt(DIGITS[currency]));

/** 救援差价的独立实现：先把两边各自换到客人币种（各自的快照汇率），在客人币种里相减，再按原快照汇率换回原结算币种的最小单位，取整一次。 */
function oracleDifference(input: { originalMinor: number; originalCurrency: CurrencyCode; originalRate: string | null; rescueMinor: number; rescueCurrency: CurrencyCode; rescueRate: string | null; customer: CurrencyCode }): { raw: number; minor: number } {
  if (input.originalCurrency === input.rescueCurrency) {
    const raw = input.rescueMinor - input.originalMinor;
    return { raw, minor: Math.max(0, raw) };
  }
  const toCustomerRescue = input.rescueCurrency === input.customer ? q(1n, 1n) : rateQ(input.rescueRate as string);
  const toCustomerOriginal = input.originalCurrency === input.customer ? q(1n, 1n) : rateQ(input.originalRate as string);
  const rescueInCustomer = mul(major(input.rescueMinor, input.rescueCurrency), toCustomerRescue);
  const originalInCustomer = mul(major(input.originalMinor, input.originalCurrency), toCustomerOriginal);
  const diffInOriginalMajor = div(sub(rescueInCustomer, originalInCustomer), toCustomerOriginal);
  const raw = Number(roundQ(mul(diffInOriginalMajor, q(10n ** BigInt(DIGITS[input.originalCurrency]), 1n))));
  return { raw, minor: Math.max(0, raw) };
}

function randomRate(next: () => number): string {
  // 0.001 – 200，最多 6 位小数，规范写法（不带末尾 0）：现实里的汇率范围，结果不出安全整数
  const micro = intIn(next, 1_000, 200_000_000);
  const whole = Math.floor(micro / 1_000_000);
  const frac = String(micro % 1_000_000).padStart(6, "0").replace(/0+$/, "");
  return frac === "" ? String(whole) : `${whole}.${frac}`;
}

const CURRENCY_LIST: CurrencyCode[] = ["JPY", "KRW", "CNY", "USD", "HKD", "TWD", "THB"];
const service = new Date("2026-12-31T15:00:00.000Z"); // 东京时间 2027-01-01 00:00：跨年、跨月、跨午夜

test("违约金阶梯和独立实现比对：边界两侧 ±3 毫秒 + 10,000 个随机距离，4 种情形", () => {
  const next = rng(20261026);
  const edges = [24 * HOUR, 2 * HOUR, 0].flatMap((edge) => [-3, -2, -1, 0, 1, 2, 3].map((delta) => edge + delta));
  const samples = [...edges, ...Array.from({ length: 10_000 }, () => intIn(next, -5 * HOUR, 72 * HOUR))];
  for (const trigger of RESCUE_TRIGGERS) {
    for (const ms of samples) {
      const got = rescuePenalty(trigger, service, new Date(service.getTime() - ms));
      assert.equal(got.bp, oraclePenaltyBp(trigger, ms), `${trigger} 距用车 ${ms} 毫秒`);
      assert.equal(got.msBeforeService, ms);
      assert.equal(got.tier, got.bp === 0 ? "none" : got.bp === 3_000 ? "partial" : "full");
    }
  }
});

test("违约金阶梯：正好 24 小时 / 2 小时那一刻算宽松的一档（声明、暂停各自都一样），少 1 毫秒就进下一档", () => {
  for (const trigger of ["tenant_declared", "tenant_suspended"] as const) {
    assert.equal(rescuePenalty(trigger, service, new Date(service.getTime() - 24 * HOUR)).bp, 0, trigger);
    assert.equal(rescuePenalty(trigger, service, new Date(service.getTime() - 24 * HOUR + 1)).bp, 3_000, trigger);
    assert.equal(rescuePenalty(trigger, service, new Date(service.getTime() - 2 * HOUR)).bp, 3_000, trigger);
    assert.equal(rescuePenalty(trigger, service, new Date(service.getTime() - 2 * HOUR + 1)).bp, 10_000, trigger);
  }
});

test("违约金金额 = 原结算价 × 比例，和逐位手算一致（随机 5,000 个结算价 × 0 / 30% / 100% / 任意基点），结果不超过原结算价", () => {
  const next = rng(42);
  for (let i = 0; i < 5_000; i += 1) {
    const settlement = intIn(next, 0, 1e11);
    for (const bp of [0, 3_000, 10_000, intIn(next, 0, 10_000)]) {
      const got = rescuePenaltyMinor(settlement, bp);
      assert.equal(got, oraclePenaltyMinor(settlement, bp), `${settlement} × ${bp}`);
      assert.ok(got >= 0 && got <= settlement);
    }
  }
  // 0.5 进位的几个点（基数是结算价，不是对外价）
  assert.equal(rescuePenaltyMinor(5, 3_000), 2, "1.5 进位");
  assert.equal(rescuePenaltyMinor(15, 3_000), 5, "4.5 进位");
  assert.equal(rescuePenaltyMinor(19_801, 3_000), 5_940, "5940.3 舍去");
  assert.throws(() => rescuePenaltyMinor(100, -1), RangeError);
});

test("救援差价（跨币种）和独立实现比对：7 种币种两两组合、客人付任一币种、随机金额和汇率 20,000 组；为负记 0；只取整一次", () => {
  const next = rng(7_310);
  let negatives = 0;
  let positives = 0;
  for (let i = 0; i < 20_000; i += 1) {
    const originalCurrency = CURRENCY_LIST[intIn(next, 0, CURRENCY_LIST.length - 1)] as CurrencyCode;
    const rescueCurrency = CURRENCY_LIST[intIn(next, 0, CURRENCY_LIST.length - 1)] as CurrencyCode;
    const customer = CURRENCY_LIST[intIn(next, 0, CURRENCY_LIST.length - 1)] as CurrencyCode;
    const originalRate = originalCurrency === customer ? null : randomRate(next);
    const rescueRate = rescueCurrency === customer ? null : randomRate(next);
    const originalMinor = intIn(next, 1, 5_000_000);
    const rescueMinor = intIn(next, 1, 5_000_000);
    const got = rescueDifference({
      originalMinor,
      originalCurrency,
      originalFx: originalRate === null ? null : { from: originalCurrency, to: customer, rate: originalRate },
      rescueMinor,
      rescueCurrency,
      rescueFx: rescueRate === null ? null : { from: rescueCurrency, to: customer, rate: rescueRate },
      customerCurrency: customer,
    });
    const expected = oracleDifference({ originalMinor, originalCurrency, originalRate, rescueMinor, rescueCurrency, rescueRate, customer });
    assert.ok(got.ok, JSON.stringify({ originalCurrency, rescueCurrency, customer }));
    assert.equal(got.rawMinor, expected.raw, JSON.stringify({ originalMinor, originalCurrency, originalRate, rescueMinor, rescueCurrency, rescueRate, customer }));
    assert.equal(got.minor, expected.minor);
    assert.ok(got.minor >= 0);
    if (expected.raw < 0) negatives += 1;
    if (expected.raw > 0) positives += 1;
  }
  assert.ok(negatives > 1_000 && positives > 1_000, "两种符号都要覆盖到");
});

test("救援差价：两次取整会差 1 的输入——按「只取整一次」得出", () => {
  // 原 JPY 10,000（1 JPY = 0.01 USD）；救援 KRW，1 KRW = 0.005 USD
  const base = { originalMinor: 10_000, originalCurrency: "JPY", originalFx: { from: "JPY", to: "USD", rate: "0.01" }, rescueCurrency: "KRW", customerCurrency: "USD" } as const;
  const exact = rescueDifference({ ...base, rescueMinor: 19_999, rescueFx: { from: "KRW", to: "USD", rate: "0.005" } });
  // 19,999 KRW × 0.005 = 99.995 USD → ÷ 0.01 = 9,999.5 JPY → 差 −0.5 → 四舍五入远离零 −1，记 0；救援价单独显示是 10,000
  assert.deepEqual(exact, { ok: true, minor: 0, rawMinor: -1, rescueInOriginalMinor: 10_000 });
  const up = rescueDifference({ ...base, rescueMinor: 20_001, rescueFx: { from: "KRW", to: "USD", rate: "0.005" } });
  assert.deepEqual(up, { ok: true, minor: 1, rawMinor: 1, rescueInOriginalMinor: 10_001 }, "10,000.5 → 差 0.5 → 1");
});

test("救援差价：用的是传进来的快照汇率——原快照汇率变了，结果跟着变（不会去取现在的汇率）", () => {
  const input = { originalMinor: 19_800, originalCurrency: "JPY", rescueMinor: 200_000, rescueCurrency: "KRW", rescueFx: { from: "KRW", to: "USD", rate: "0.00072" }, customerCurrency: "USD" } as const;
  const a = rescueDifference({ ...input, originalFx: { from: "JPY", to: "USD", rate: "0.0067" } });
  const b = rescueDifference({ ...input, originalFx: { from: "JPY", to: "USD", rate: "0.007" } });
  // 200,000 × 0.00072 = 144 USD；÷ 0.0067 = 21,492.537… → 21,493 − 19,800 = 1,693；÷ 0.007 = 20,571.43 → 771
  assert.deepEqual(a, { ok: true, minor: 1_693, rawMinor: 1_693, rescueInOriginalMinor: 21_493 });
  assert.deepEqual(b, { ok: true, minor: 771, rawMinor: 771, rescueInOriginalMinor: 20_571 });
});

test("救援差价：汇率缺失或方向不对（from / to 对不上）时拒绝，不会按 1:1 算", () => {
  const base = { originalMinor: 10_000, originalCurrency: "JPY", rescueMinor: 100_000, rescueCurrency: "KRW", customerCurrency: "USD" } as const;
  const jpyUsd = { from: "JPY", to: "USD", rate: "0.0067" } as const;
  const krwUsd = { from: "KRW", to: "USD", rate: "0.00072" } as const;
  assert.deepEqual(rescueDifference({ ...base, originalFx: jpyUsd, rescueFx: null }), { ok: false, reason: "FX_RATE_UNAVAILABLE" });
  assert.deepEqual(rescueDifference({ ...base, originalFx: null, rescueFx: krwUsd }), { ok: false, reason: "FX_RATE_UNAVAILABLE" });
  assert.deepEqual(rescueDifference({ ...base, originalFx: { from: "USD", to: "JPY", rate: "149" }, rescueFx: krwUsd }), { ok: false, reason: "FX_RATE_UNAVAILABLE" }, "方向反了");
  assert.deepEqual(rescueDifference({ ...base, originalFx: jpyUsd, rescueFx: { from: "KRW", to: "CNY", rate: "0.005" } }), { ok: false, reason: "FX_RATE_UNAVAILABLE" }, "换到的不是客人币种");
});

test("救援单期限：发出时距用车正好 2 小时 15 分钟、少 1 毫秒 5 分钟；期限那一刻起超时，前 1 毫秒还能接", () => {
  const next = rng(99);
  for (let i = 0; i < 5_000; i += 1) {
    const msBefore = intIn(next, -HOUR, 5 * HOUR);
    const offeredAt = new Date(service.getTime() - msBefore);
    const deadline = rescueOfferDeadline(offeredAt, service);
    assert.equal(deadline.getTime() - offeredAt.getTime(), (msBefore >= 2 * HOUR ? 15 : 5) * MINUTE, `距用车 ${msBefore}`);
    assert.equal(rescueOfferExpired(deadline, new Date(deadline.getTime() - 1)), false);
    assert.equal(rescueOfferExpired(deadline, deadline), true);
  }
  assert.equal(rescueOfferDeadline(new Date(service.getTime() - 2 * HOUR), service).getTime() - (service.getTime() - 2 * HOUR), 15 * MINUTE);
  assert.equal(rescueOfferDeadline(new Date(service.getTime() - 2 * HOUR + 1), service).getTime() - (service.getTime() - 2 * HOUR + 1), 5 * MINUTE);
});

test("改派后的派车截止：普通规则（> 24 小时：用车前 24 小时；不足：接单后 2 小时、不晚于用车），但至少留 30 分钟——用车时间已过也一样", () => {
  const next = rng(5);
  for (let i = 0; i < 5_000; i += 1) {
    const acceptedAt = new Date(service.getTime() - intIn(next, -3 * HOUR, 72 * HOUR));
    const due = rescuedDispatchDeadline(acceptedAt, service).getTime();
    const regular = dispatchDeadline(acceptedAt, service).getTime();
    assert.equal(due, Math.max(regular, acceptedAt.getTime() + 30 * MINUTE));
    assert.ok(due >= acceptedAt.getTime() + 30 * MINUTE);
  }
  // 用车后 20 分钟改派（司机未到）：截止 = 接单后 30 分钟
  const late = new Date(service.getTime() + 20 * MINUTE);
  assert.equal(rescuedDispatchDeadline(late, service).getTime(), late.getTime() + 30 * MINUTE);
  // 用车前 25 小时接单：截止 = 用车前 24 小时
  assert.equal(rescuedDispatchDeadline(new Date(service.getTime() - 25 * HOUR), service).getTime(), service.getTime() - 24 * HOUR);
});

test("未派车的自动触发时刻 = max(用车前 6 小时, 派车截止)：付款时已不足 6 小时的单从截止时间起算，那一刻起（含）成立", () => {
  const next = rng(77);
  for (let i = 0; i < 3_000; i += 1) {
    const paidMsBefore = intIn(next, 10 * MINUTE, 48 * HOUR);
    const paidAt = new Date(service.getTime() - paidMsBefore);
    const due = dispatchDeadline(paidAt, service);
    const at = dispatchRescueDueAt(service, due).getTime();
    assert.equal(at, Math.max(service.getTime() - 6 * HOUR, due.getTime()));
    const facts = { status: "confirmed", serviceAt: service, dispatchDueAt: due, landedAt: null, tenantSuspended: false } as const;
    assert.equal(rescueTriggerRefusal("dispatch_overdue", { ...facts, now: new Date(at - 1) }), "TOO_EARLY");
    assert.equal(rescueTriggerRefusal("dispatch_overdue", { ...facts, now: new Date(at) }), null);
    if (paidMsBefore < 6 * HOUR) assert.ok(at > paidAt.getTime(), "不能一付款就触发");
  }
  // 用车前 3 小时付款：截止 = 付款后 2 小时（用车前 1 小时），之前不触发
  const paid = new Date(service.getTime() - 3 * HOUR);
  assert.equal(dispatchRescueDueAt(service, dispatchDeadline(paid, service)).getTime(), service.getTime() - HOUR);
});

test("司机未到 = max(用车时间, 实际落地) + 15 分钟，含那一刻；落地早于用车时不提前", () => {
  const next = rng(1_234);
  for (let i = 0; i < 3_000; i += 1) {
    const landedAt = intIn(next, 0, 2) === 0 ? null : new Date(service.getTime() + intIn(next, -2 * HOUR, 3 * HOUR));
    const reference = Math.max(service.getTime(), landedAt?.getTime() ?? service.getTime());
    assert.equal(driverLateAt(service, landedAt).getTime(), reference + 15 * MINUTE);
    for (const status of ["confirmed", "assigned", "departed"] as const) {
      const facts = { status, serviceAt: service, dispatchDueAt: null, landedAt, tenantSuspended: false };
      assert.equal(rescueTriggerRefusal("driver_no_show", { ...facts, now: new Date(reference + 15 * MINUTE - 1) }), "TOO_EARLY");
      assert.equal(rescueTriggerRefusal("driver_no_show", { ...facts, now: new Date(reference + 15 * MINUTE) }), null);
    }
  }
});

test("能触发的状态：司机已到达、服务中、已完成、已取消、已在救援、已转出的单一律不能触发；未派车只认「已确认」", () => {
  const far = new Date(service.getTime() + 30 * HOUR);
  const allowed: Record<RescueTrigger, string[]> = {
    tenant_declared: ["confirmed", "assigned", "departed"],
    dispatch_overdue: ["confirmed"],
    driver_no_show: ["confirmed", "assigned", "departed"],
    tenant_suspended: ["confirmed", "assigned", "departed"],
  };
  for (const trigger of RESCUE_TRIGGERS) {
    for (const status of ORDER_STATUSES) {
      const refusal = rescueTriggerRefusal(trigger, { status, serviceAt: service, dispatchDueAt: new Date(service.getTime() - 24 * HOUR), landedAt: null, tenantSuspended: true, now: trigger === "tenant_suspended" ? new Date(service.getTime() - HOUR) : far });
      if (allowed[trigger].includes(status)) assert.equal(refusal, null, `${trigger} / ${status}`);
      else assert.equal(refusal, "ORDER_STATE_INVALID", `${trigger} / ${status}`);
    }
  }
  // 已确认但没有派车截止时间（数据异常）不按「未派车」触发
  assert.equal(rescueTriggerRefusal("dispatch_overdue", { status: "confirmed", serviceAt: service, dispatchDueAt: null, landedAt: null, tenantSuspended: false, now: far }), "ORDER_STATE_INVALID");
});

test("供应商被暂停：只认暂停中、已清退；用车时间那一刻起不算未来订单；没暂停的不能按这种情形触发", () => {
  assert.deepEqual(TENANT_STATUSES.filter(tenantOutOfService), ["suspended", "terminated"]);
  assert.deepEqual(TENANT_STATUSES.filter(tenantCanRescue), ["trial", "active"]);
  const facts = { status: "assigned", serviceAt: service, dispatchDueAt: null, landedAt: null } as const;
  assert.equal(rescueTriggerRefusal("tenant_suspended", { ...facts, tenantSuspended: false, now: new Date(service.getTime() - HOUR) }), "TENANT_NOT_SUSPENDED");
  assert.equal(rescueTriggerRefusal("tenant_suspended", { ...facts, tenantSuspended: true, now: new Date(service.getTime() - 1) }), null);
  assert.equal(rescueTriggerRefusal("tenant_suspended", { ...facts, tenantSuspended: true, now: service }), "SERVICE_TIME_PASSED");
});
