/**
 * M4-01 测试角色补充：履约评分与独立实现比对（随机输入、阈值附近）、每日判断的不变量、到期提醒逐日模拟、东京日期边界。
 * 独立实现只用 BigInt 的有理数（最小公倍数通分），不复用被测代码的通分方式和取整函数。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type ScoreInput,
  type StandingInput,
  type SuspensionReason,
  SCORE_WEIGHTS_BP,
  TENANT_RULES,
  TENANT_STATUSES,
  computeTenantScore,
  daysUntilExpiry,
  documentValidOn,
  evaluateTenantStanding,
  expiryReminderDue,
  isCalendarDate,
  noShowWindowStart,
  scoreWindowStart,
  tenantDate,
  tenantDayStart,
  trialPromotionDue,
} from "./tenants.ts";

// ---- 独立实现 ----

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b));
const lcm = (a: bigint, b: bigint): bigint => (a / gcd(a, b)) * b;

/** 精确的分数（百分之一分为单位）：返回 [分子, 分母]；一项数据都没有为 null。 */
function exactScoreCenti(input: ScoreInput): [bigint, bigint] | null {
  const parts: [bigint, bigint, bigint][] = []; // [权重, 分子, 分母]：这一项 5 分制的得分 = 分子 / 分母
  const c = input.completedOrders;
  if (input.dispatch.total > 0) parts.push([BigInt(SCORE_WEIGHTS_BP.dispatch), 5n * BigInt(Math.min(input.dispatch.onTime, input.dispatch.total)), BigInt(input.dispatch.total)]);
  if (input.arrival.total > 0) parts.push([BigInt(SCORE_WEIGHTS_BP.arrival), 5n * BigInt(Math.min(input.arrival.onTime, input.arrival.total)), BigInt(input.arrival.total)]);
  if (input.ratings.count > 0) parts.push([BigInt(SCORE_WEIGHTS_BP.rating), BigInt(input.ratings.sum), BigInt(input.ratings.count)]);
  if (c > 0) parts.push([BigInt(SCORE_WEIGHTS_BP.complaint), 5n * BigInt(c - Math.min(input.upheldComplaints, c)), BigInt(c)]);
  if (c + input.failures > 0) parts.push([BigInt(SCORE_WEIGHTS_BP.failure), 5n * BigInt(c), BigInt(c + input.failures)]);
  if (parts.length === 0) return null;
  const common = parts.reduce((acc, [, , d]) => lcm(acc, d), 1n);
  const weight = parts.reduce((acc, [w]) => acc + w, 0n);
  const numerator = parts.reduce((acc, [w, n, d]) => acc + w * n * (common / d), 0n) * 100n;
  return [numerator, common * weight];
}

/** 四舍五入（非负）：floor((2n + d) / 2d)。 */
const roundHalfUp = ([n, d]: [bigint, bigint]): number => Number((2n * n + d) / (2n * d));

/** 可重复的伪随机数（mulberry32）。 */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function randomInput(rand: () => number, maxOrders: number): ScoreInput {
  const int = (max: number): number => Math.floor(rand() * (max + 1));
  const completed = int(maxOrders);
  const dispatchTotal = rand() < 0.15 ? 0 : int(maxOrders);
  const arrivalTotal = rand() < 0.15 ? 0 : int(maxOrders);
  const ratingCount = rand() < 0.15 ? 0 : int(maxOrders);
  return {
    completedOrders: completed,
    dispatch: { onTime: int(dispatchTotal), total: dispatchTotal },
    arrival: { onTime: int(arrivalTotal), total: arrivalTotal },
    ratings: { sum: ratingCount === 0 ? 0 : ratingCount + int(ratingCount * 4), count: ratingCount },
    upheldComplaints: int(Math.max(1, Math.floor(completed / 3))),
    failures: int(Math.max(1, Math.floor(completed / 4))),
  };
}

test("评分与独立实现比对：两万组随机输入，按数据的分、比价用的分、是否默认分逐个一致", () => {
  const rand = prng(20261025);
  for (let index = 0; index < 20_000; index += 1) {
    const input = randomInput(rand, index % 2 === 0 ? 60 : 997);
    const exact = exactScoreCenti(input);
    const result = computeTenantScore(input);
    const expected = exact === null ? null : roundHalfUp(exact);
    assert.equal(result.rawScoreCenti, expected, JSON.stringify(input));
    const isDefault = expected === null || input.completedOrders < 20;
    assert.equal(result.isDefault, isDefault, JSON.stringify(input));
    assert.equal(result.scoreCenti, isDefault ? 450 : expected, JSON.stringify(input));
    assert.ok(result.scoreCenti >= 0 && result.scoreCenti <= 500);
  }
});

test("评分在 4.00 / 3.50 阈值附近：精确值正好 .5 的进位、差一点不到的不进位，观察 / 暂停按取整后的分判断，和独立实现一致（不出现浮点误差）", () => {
  const rand = prng(7);
  const near: { input: ScoreInput; exact: [bigint, bigint] }[] = [];
  for (let index = 0; index < 400_000 && near.length < 4_000; index += 1) {
    const input = randomInput(rand, 400);
    if (input.completedOrders < 20) continue;
    const exact = exactScoreCenti(input);
    if (exact === null) continue;
    // 精确值落在 [348.5, 351.5] 或 [398.5, 401.5]（百分之一分）
    const twice = (2n * exact[0]) / exact[1];
    if ((twice >= 697n && twice <= 703n) || (twice >= 797n && twice <= 803n)) near.push({ input, exact });
  }
  assert.ok(near.length > 200, `阈值附近的样本太少：${near.length}`);
  for (const { input, exact } of near) {
    const result = computeTenantScore(input);
    const expected = roundHalfUp(exact);
    assert.equal(result.scoreCenti, expected, JSON.stringify(input));
    const decision = evaluateTenantStanding({ status: "active", suspensionReasons: [], previousDataScoreCenti: 450, scoreCenti: result.scoreCenti, isDefaultScore: result.isDefault, previousNoShows: 0, noShows: 0, documentsValid: true });
    assert.equal(decision.observation.includes("score_below_threshold"), expected < 400, JSON.stringify(input));
    assert.equal(decision.suspend.includes("score_below_red_line"), expected < 350, JSON.stringify(input));
  }
});

test("评分正好落在 x.xx5 的显式样本：3.995 → 4.00（不观察）、3.495 → 3.50（不暂停）；3.9949… → 3.99（观察）", () => {
  // 完成 20 单、没有派车 / 到达记录、投诉和失败都是 0：分 = (0.2×r + 0.2×5 + 0.1×5) / 0.5 = 0.4r + 3（r 是评价均分）
  // 3.995：r = 2.4875 = 199 / 80
  const base = { completedOrders: 20, dispatch: { onTime: 0, total: 0 }, arrival: { onTime: 0, total: 0 }, upheldComplaints: 0, failures: 0 };
  const at3995 = computeTenantScore({ ...base, ratings: { sum: 199, count: 80 } });
  const exact = exactScoreCenti({ ...base, ratings: { sum: 199, count: 80 } }) as [bigint, bigint];
  assert.equal(exact[0] * 2n, exact[1] * 799n, "精确值正好 399.5");
  assert.equal(at3995.rawScoreCenti, 400);
  assert.equal(evaluateTenantStanding({ status: "active", suspensionReasons: [], previousDataScoreCenti: 450, scoreCenti: at3995.scoreCenti, isDefaultScore: false, previousNoShows: 0, noShows: 0, documentsValid: true }).observation.length, 0);
  // 3.495：r = 1.2375 = 99 / 80
  const at3495 = computeTenantScore({ ...base, ratings: { sum: 99, count: 80 } });
  assert.equal(at3495.rawScoreCenti, 350);
  assert.deepEqual(evaluateTenantStanding({ status: "active", suspensionReasons: [], previousDataScoreCenti: 450, scoreCenti: at3495.scoreCenti, isDefaultScore: false, previousNoShows: 0, noShows: 0, documentsValid: true }).suspend, []);
  // 略低于 3.995：r = 1989 / 800 = 2.48625 → 3.9945 → 3.99
  const below = computeTenantScore({ ...base, ratings: { sum: 1989, count: 800 } });
  assert.equal(below.rawScoreCenti, 399);
  assert.deepEqual(evaluateTenantStanding({ status: "active", suspensionReasons: [], previousDataScoreCenti: 450, scoreCenti: below.scoreCenti, isDefaultScore: false, previousNoShows: 0, noShows: 0, documentsValid: true }).observation, ["score_below_threshold"]);
  // 浮点直算会算错的样本：派车 19/50、其余满分，精确值 4.225 → 4.23；双精度直算再 Math.round 得 4.22
  const floatTrap = { completedOrders: 50, dispatch: { onTime: 19, total: 50 }, arrival: { onTime: 50, total: 50 }, ratings: { sum: 250, count: 50 }, upheldComplaints: 0, failures: 0 };
  assert.equal(Math.round((0.25 * 5 * (19 / 50) + 0.25 * 5 + 0.2 * 5 + 0.2 * 5 + 0.1 * 5) * 100), 422, "浮点确实会算错");
  assert.equal(computeTenantScore(floatTrap).rawScoreCenti, 423);
});

test("每日判断的不变量（随机状态）：不重复加已有的暂停原因；默认分不触发评分类原因；入驻中、已清退什么都不做；资质过期必加（没有时）", () => {
  const rand = prng(99);
  const reasons: SuspensionReason[] = ["manual", "document_expired", "score_below_red_line", "driver_no_show"];
  for (let index = 0; index < 5_000; index += 1) {
    const status = TENANT_STATUSES[Math.floor(rand() * TENANT_STATUSES.length)] as StandingInput["status"];
    const suspensionReasons = status === "suspended" ? reasons.filter(() => rand() < 0.5) : [];
    const input: StandingInput = {
      status,
      suspensionReasons,
      previousDataScoreCenti: rand() < 0.2 ? null : Math.floor(rand() * 501),
      scoreCenti: Math.floor(rand() * 501),
      isDefaultScore: rand() < 0.3,
      previousNoShows: rand() < 0.2 ? null : Math.floor(rand() * 5),
      noShows: Math.floor(rand() * 5),
      documentsValid: rand() < 0.6,
    };
    const decision = evaluateTenantStanding(input);
    const watched = status === "trial" || status === "active" || status === "suspended";
    if (!watched) {
      assert.deepEqual(decision, { observation: [], suspend: [], clearDocumentExpired: false });
      continue;
    }
    for (const reason of decision.suspend) assert.ok(!suspensionReasons.includes(reason), `重复加 ${reason}`);
    assert.equal(new Set(decision.suspend).size, decision.suspend.length);
    if (input.isDefaultScore) {
      assert.ok(!decision.suspend.includes("score_below_red_line"));
      assert.ok(!decision.observation.includes("score_below_threshold"));
    }
    assert.equal(decision.suspend.includes("document_expired"), !input.documentsValid && !suspensionReasons.includes("document_expired"));
    assert.equal(decision.clearDocumentExpired, input.documentsValid && suspensionReasons.includes("document_expired"));
    assert.equal(decision.observation.includes("driver_no_show"), input.noShows >= 2);
    assert.ok(!decision.suspend.includes("manual"), "系统不会加人工暂停");
  }
});

test("到期提醒逐日模拟：从 60 天前到到期后 3 天每天跑一次，30 天那档和 7 天那档各发一次、发在第 30 / 7 天；20 天时才审核通过的立刻补 30 天那档；5 天时才通过的只发 7 天那档", () => {
  const simulate = (expiresOn: string, firstDay: string): [string, number][] => {
    const sent: number[] = [];
    const out: [string, number][] = [];
    for (let offset = 0; offset < 120; offset += 1) {
      const today = new Date(Date.parse(`${firstDay}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
      if (today > "2027-03-05") break;
      const tier = expiryReminderDue(daysUntilExpiry(expiresOn, today), sent);
      if (tier !== null) {
        sent.push(tier);
        out.push([today, tier]);
      }
    }
    return out;
  };
  // 跨年、跨 2 月（2027 不是闰年）
  assert.deepEqual(simulate("2027-03-02", "2027-01-01"), [["2027-01-31", 30], ["2027-02-23", 7]]);
  assert.deepEqual(simulate("2027-03-02", "2027-02-10"), [["2027-02-10", 30], ["2027-02-23", 7]]);
  assert.deepEqual(simulate("2027-03-02", "2027-02-25"), [["2027-02-25", 7]]);
});

test("到期日与东京日期边界：到期日当天 0 点（东京）起无效；UTC 的前一天 15:00 就是东京的第二天；跨月、闰年", () => {
  // 东京 2026-10-31 23:59:59.999 = UTC 14:59:59.999；下一毫秒是 11-01
  assert.equal(tenantDate(new Date("2026-10-31T14:59:59.999Z")), "2026-10-31");
  assert.equal(tenantDate(new Date("2026-10-31T15:00:00.000Z")), "2026-11-01");
  assert.equal(documentValidOn({ expiresOn: "2026-11-01" }, tenantDate(new Date("2026-10-31T14:59:59.999Z"))), true);
  assert.equal(documentValidOn({ expiresOn: "2026-11-01" }, tenantDate(new Date("2026-10-31T15:00:00.000Z"))), false);
  assert.equal(tenantDayStart(new Date("2026-12-31T15:00:00Z")).toISOString(), "2026-12-31T15:00:00.000Z");
  assert.equal(daysUntilExpiry("2028-03-01", "2028-02-28"), 2, "2028 是闰年");
  assert.equal(daysUntilExpiry("2027-03-01", "2027-02-28"), 1);
  assert.equal(isCalendarDate("2028-02-29"), true);
  assert.equal(isCalendarDate("2027-02-29"), false);
  // 90 天窗口跨年；30 天窗口跨月
  assert.equal(scoreWindowStart("2027-01-15"), "2026-10-18");
  assert.equal(noShowWindowStart("2026-03-01"), "2026-01-31");
  // 窗口正好 90 天（含今天）
  const from = scoreWindowStart("2026-10-25");
  assert.equal(daysUntilExpiry("2026-10-25", from), TENANT_RULES.scoreWindowDays - 1);
});

test("转正式的 30 天按时刻：跨夏令时无关（东京无夏令时），正好 30×24 小时转、差 1 毫秒不转", () => {
  const start = new Date("2026-10-01T03:00:00Z");
  const due = (ms: number): boolean => trialPromotionDue({ trialStartedAt: start, now: new Date(start.getTime() + ms), completedSinceTrial: 20, majorComplaintsSinceTrial: 0 });
  assert.equal(due(30 * 86_400_000), true);
  assert.equal(due(30 * 86_400_000 - 1), false);
});
