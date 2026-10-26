/**
 * M5-01 测试角色补充：账单纯规则的边界和对照实现（ADR 0040）。
 * - 金额：草稿合计、按币种分开、0 元项、负数结转、溢出，用一套独立写的对照实现核对随机数据；
 * - 切月：城市当地日期跨月（东京、洛杉矶、奥克兰）、月末最后一分钟、闰年 2 月、出账时机按东京日期；
 * - 应付日、付款日顺延（正好在付款日、过了一天、批次锁定）、确认期正好 7 天；
 * - 状态流转的完整矩阵（非法跳转）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type BillableItem,
  STATEMENT_LINE_KINDS,
  STATEMENT_STATUSES,
  type StatementAction,
  type StatementLineKind,
  type StatementStatus,
  autoConfirmDue,
  billingToday,
  confirmDueAt,
  deductionBillable,
  draftStatements,
  extraChargeBillable,
  instantToLocal,
  orderBillable,
  payDueDate,
  payoutDateFor,
  payoutTotals,
  periodEnded,
  periodLastDay,
  periodOfDate,
  periodToGenerate,
  shiftPeriod,
  statementActionAllowed,
  statementSummary,
  statusAfterApproval,
  sumMinor,
} from "./index.ts";

// ---- 可复现的随机数 ----

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const pick = <T>(r: () => number, values: readonly T[]): T => values[Math.floor(r() * values.length)] as T;
const between = (r: () => number, min: number, max: number): number => min + Math.floor(r() * (max - min + 1));

// ---- 对照实现：只按需求和 ADR 的文字写，不调用被测模块 ----

/** 一个月最后一天：按格里高利历的闰年规则自己算（不用 Date）。 */
function oracleLastDay(period: string): string {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] as number;
  return `${period}-${String(days).padStart(2, "0")}`;
}

interface OracleStatement {
  currency: string;
  totalMinor: bigint;
  keys: string[];
  prior: string[];
}

/**
 * ADR 0040 的出账口径：服务日期不晚于这一期最后一天的才算；按币种各一张；已经有有效账单的币种跳过；
 * 只有上期结转的币种不出；服务日期早于这一期第一天（或没有服务日期的结转）是往期调整。合计用 BigInt 精确相加。
 */
function oracleDraft(period: string, items: readonly BillableItem[], skip: readonly string[]): OracleStatement[] {
  const first = `${period}-01`;
  const last = oracleLastDay(period);
  const groups: Record<string, BillableItem[]> = {};
  for (const item of items) {
    if (item.serviceDate !== null && item.serviceDate > last) continue;
    if (skip.indexOf(item.currency) >= 0) continue;
    (groups[item.currency] ??= []).push(item);
  }
  const out: OracleStatement[] = [];
  for (const currency of Object.keys(groups).sort()) {
    const lines = groups[currency] as BillableItem[];
    if (lines.every((line) => line.kind === "carry_forward")) continue;
    let total = 0n;
    for (const line of lines) total += BigInt(line.amountMinor);
    out.push({
      currency,
      totalMinor: total,
      keys: lines.map((line) => line.sourceKey).sort(),
      prior: lines.filter((line) => line.serviceDate === null || line.serviceDate < first).map((line) => line.sourceKey).sort(),
    });
  }
  return out;
}

function randomItems(r: () => number, n: number, period: string): BillableItem[] {
  const items: BillableItem[] = [];
  const months = [shiftPeriod(period, -2), shiftPeriod(period, -1), period, shiftPeriod(period, 1)];
  for (let i = 0; i < n; i += 1) {
    const kind = pick(r, STATEMENT_LINE_KINDS);
    const currency = pick(r, ["JPY", "USD", "KRW", "CNY"] as const);
    const month = pick(r, months);
    const day = between(r, 1, Number(oracleLastDay(month).slice(8)));
    const serviceDate = kind === "carry_forward" ? null : `${month}-${String(day).padStart(2, "0")}`;
    const magnitude = between(r, 1, r() < 0.05 ? 900_000_000_000 : 5_000_000);
    const amountMinor = kind === "deduction" || kind === "carry_forward" ? -magnitude : magnitude;
    items.push({ sourceKey: `${kind}:${i}`, kind, currency, amountMinor, serviceDate, orderId: serviceDate === null ? null : `o${i}`, orderNo: serviceDate === null ? null : `NZ${i}`, detail: {} });
  }
  return items;
}

test("对照实现：500 组随机应付（多币种、跨期、结转、扣款、跳过的币种）——每一张草稿的币种、明细、往期调整、合计都和对照一致", () => {
  const r = rng(20261026);
  const periods = ["2026-01", "2026-02", "2026-12", "2028-02", "2100-02", "2000-02"];
  for (let round = 0; round < 500; round += 1) {
    const period = pick(r, periods);
    const items = randomItems(r, between(r, 0, 40), period);
    const skip = r() < 0.3 ? [pick(r, ["JPY", "USD", "KRW", "CNY"])] : [];
    const expected = oracleDraft(period, items, skip);
    const actual = draftStatements(period, items, skip);
    assert.deepEqual(
      actual.map((draft) => ({
        currency: draft.currency,
        totalMinor: BigInt(draft.totalMinor),
        keys: draft.lines.map((line) => line.sourceKey).sort(),
        prior: draft.lines.filter((line) => line.priorPeriod).map((line) => line.sourceKey).sort(),
      })),
      expected,
      `第 ${round} 组（${period}）`,
    );
    for (const draft of actual) {
      // 一张账单只有一种币种；合计等于明细之和；按种类的小计加起来也等于合计
      assert.ok(draft.lines.every((line) => line.currency === draft.currency));
      const summary = statementSummary(draft.lines);
      assert.equal(summary.totalMinor, draft.totalMinor);
      assert.equal(sumMinor(Object.values(summary.byKind).map((entry) => entry.amountMinor)), draft.totalMinor);
      assert.equal(Object.values(summary.byKind).reduce((n, entry) => n + entry.count, 0), draft.lines.length);
    }
  }
});

test("对照实现：批次按币种合计——随机 300 组账单，和逐笔 BigInt 相加一致，币种不混算", () => {
  const r = rng(7);
  for (let round = 0; round < 300; round += 1) {
    const statements = Array.from({ length: between(r, 0, 30) }, () => ({ currency: pick(r, ["JPY", "USD", "KRW"]), totalMinor: between(r, 1, 50_000_000) }));
    const expected = new Map<string, { count: number; total: bigint }>();
    for (const s of statements) {
      const e = expected.get(s.currency) ?? { count: 0, total: 0n };
      e.count += 1;
      e.total += BigInt(s.totalMinor);
      expected.set(s.currency, e);
    }
    const actual = payoutTotals(statements);
    assert.deepEqual(
      actual.map((entry) => [entry.currency, entry.count, BigInt(entry.totalMinor)]),
      [...expected.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, e]) => [currency, e.count, e.total]),
    );
  }
});

test("金额：只接受最小单位的安全整数——小数、NaN、超过安全整数的合计都抛错，不悄悄取整", () => {
  assert.throws(() => sumMinor([100, 0.5]), RangeError);
  assert.throws(() => sumMinor([Number.NaN]), RangeError);
  assert.throws(() => sumMinor([Number.MAX_SAFE_INTEGER, 1]), RangeError);
  // 正负抵消后在范围里：中间结果用 BigInt，不因中间溢出报错
  assert.equal(sumMinor([Number.MAX_SAFE_INTEGER, 1, -2]), Number.MAX_SAFE_INTEGER - 1);
  assert.throws(() => statusAfterApproval(0.1), RangeError);
  const item: BillableItem = { sourceKey: "order:x", kind: "order", currency: "JPY", amountMinor: 100.5, serviceDate: "2026-09-01", orderId: "x", orderNo: "NZ1", detail: {} };
  assert.throws(() => draftStatements("2026-09", [item]), RangeError);
});

test("金额：有偿取消按取消时算好的供应商应得原样出账（不再取整）；免费取消（应得 0）、应得为空的不出", () => {
  assert.deepEqual(orderBillable({ status: "cancelled", settlementMinor: 19_999, cancelTenantShareMinor: 10_000 }), { kind: "cancellation", amountMinor: 10_000 });
  assert.deepEqual(orderBillable({ status: "cancelled", settlementMinor: 19_999, cancelTenantShareMinor: 1 }), { kind: "cancellation", amountMinor: 1 });
  assert.equal(orderBillable({ status: "cancelled", settlementMinor: 19_999, cancelTenantShareMinor: 0 }), null);
  assert.equal(orderBillable({ status: "cancelled", settlementMinor: 19_999, cancelTenantShareMinor: null }), null);
  // no-show 只有审核通过（no_show）才出；申报中（no_show_claimed）、救援中、服务中都不出
  for (const status of ["no_show_claimed", "rescue_pending", "rescued", "in_service", "assigned", "confirmed", "pending_payment"]) {
    assert.equal(orderBillable({ status, settlementMinor: 20_000, cancelTenantShareMinor: null }), null, status);
  }
  assert.deepEqual(orderBillable({ status: "no_show", settlementMinor: 20_000, cancelTenantShareMinor: null }), { kind: "no_show", amountMinor: 20_000 });
});

test("加收只计已扣到款的：部分通过按通过的金额；异议期、待审核、已通过未扣款、正在扣、扣款失败、驳回、撤回都不出", () => {
  assert.equal(extraChargeBillable({ status: "charged", amountMinor: 3_000, approvedMinor: 2_001 }), 2_001);
  assert.equal(extraChargeBillable({ status: "charged", amountMinor: 3_000, approvedMinor: null }), 3_000);
  for (const status of ["in_window", "review", "disputed", "approved", "charging", "charge_failed", "rejected", "withdrawn"]) {
    assert.equal(extraChargeBillable({ status, amountMinor: 3_000, approvedMinor: 3_000 }), null, status);
  }
});

test("违约金：救援有结论（订单到终态）才扣；0 元不出；免除前没出过账的不退；出过账再免除的只退一次", () => {
  const base = { status: "pending", amountMinor: 6_000, orderConcluded: true, billed: false, waiverBilled: false };
  assert.deepEqual(deductionBillable(base), { kind: "deduction", amountMinor: -6_000 });
  assert.equal(deductionBillable({ ...base, orderConcluded: false }), null, "救援还没结论");
  assert.equal(deductionBillable({ ...base, amountMinor: 0 }), null, "0 元违约金");
  assert.equal(deductionBillable({ ...base, billed: true }), null, "已出过账");
  assert.equal(deductionBillable({ ...base, status: "waived" }), null, "没出过账就免除：什么都不出");
  assert.deepEqual(deductionBillable({ ...base, status: "waived", billed: true }), { kind: "deduction_waiver", amountMinor: 6_000 });
  assert.equal(deductionBillable({ ...base, status: "waived", billed: true, waiverBilled: true }), null, "已退过");
  assert.equal(deductionBillable({ ...base, status: "waived", billed: true, amountMinor: 0 }), null);
});

test("0 元项不出账：只有结转（负数）、或一个币种里只有结转的不出账单；扣款多于应付的照样出（合计为负）", () => {
  const carry: BillableItem = { sourceKey: "carry:1", kind: "carry_forward", currency: "JPY", amountMinor: -30_000, serviceDate: null, orderId: null, orderNo: null, detail: {} };
  assert.deepEqual(draftStatements("2026-11", [carry]), []);
  const usd: BillableItem = { sourceKey: "order:2", kind: "order", currency: "USD", amountMinor: 1_000, serviceDate: "2026-11-02", orderId: "2", orderNo: "NZ2", detail: {} };
  const drafts = draftStatements("2026-11", [carry, usd]);
  assert.deepEqual(drafts.map((d) => [d.currency, d.totalMinor, d.lines.length]), [["USD", 1_000, 1]], "日元的结转不并进美元账单");
  const penalty: BillableItem = { sourceKey: "deduction:3", kind: "deduction", currency: "JPY", amountMinor: -50_000, serviceDate: "2026-11-20", orderId: "3", orderNo: "NZ3", detail: {} };
  const negative = draftStatements("2026-11", [carry, penalty]);
  assert.deepEqual(negative.map((d) => [d.currency, d.totalMinor, d.lines.map((l) => l.kind)]), [["JPY", -80_000, ["carry_forward", "deduction"]]]);
  assert.equal(statusAfterApproval(-80_000), "carried");
  assert.equal(statusAfterApproval(0), "settled");
  assert.equal(statusAfterApproval(1), "in_payout");
});

// ---- 切月 ----

test("切月：服务日期按城市当地日期——洛杉矶 10/31 23:30（东京已是 11/1）属于 10 月；奥克兰 11/1 00:30（东京还是 10/31）属于 11 月；东京月末最后一分钟属于当月", () => {
  const la = new Date("2026-11-01T06:30:00Z"); // 洛杉矶夏令时（PDT，UTC−7）10/31 23:30
  assert.equal(instantToLocal(la, "America/Los_Angeles").dateTime, "2026-10-31T23:30");
  assert.equal(instantToLocal(la, "Asia/Tokyo").date, "2026-11-01");
  const akl = new Date("2026-10-31T11:30:00Z"); // 奥克兰夏令时（NZDT，UTC+13）11/1 00:30
  assert.equal(instantToLocal(akl, "Pacific/Auckland").dateTime, "2026-11-01T00:30");
  assert.equal(instantToLocal(akl, "Asia/Tokyo").date, "2026-10-31");
  const tokyoLastMinute = new Date("2026-10-31T14:59:00Z");
  assert.equal(instantToLocal(tokyoLastMinute, "Asia/Tokyo").dateTime, "2026-10-31T23:59");

  const item = (key: string, serviceDate: string): BillableItem => ({ sourceKey: `order:${key}`, kind: "order", currency: "JPY", amountMinor: 1_000, serviceDate, orderId: key, orderNo: `NZ${key}`, detail: {} });
  const items = [item("la", instantToLocal(la, "America/Los_Angeles").date), item("akl", instantToLocal(akl, "Pacific/Auckland").date), item("tyo", instantToLocal(tokyoLastMinute, "Asia/Tokyo").date)];
  const october = draftStatements("2026-10", items);
  assert.deepEqual(october[0]?.lines.map((line) => line.sourceKey).sort(), ["order:la", "order:tyo"]);
  const november = draftStatements("2026-11", items.filter((i) => i.sourceKey === "order:akl"));
  assert.deepEqual(november[0]?.lines.map((line) => [line.sourceKey, line.priorPeriod]), [["order:akl", false]]);
});

test("切月：出账时机按东京日期——东京 10/31 23:59:59.999 还不能出 10 月，11/1 00:00 起可以（此时洛杉矶还是 10/31 上午）", () => {
  const before = new Date("2026-10-31T14:59:59.999Z");
  const at = new Date("2026-10-31T15:00:00.000Z");
  assert.equal(billingToday(before), "2026-10-31");
  assert.equal(billingToday(at), "2026-11-01");
  assert.equal(periodEnded("2026-10", billingToday(before)), false);
  assert.equal(periodEnded("2026-10", billingToday(at)), true);
  assert.equal(periodToGenerate(before), "2026-09");
  assert.equal(periodToGenerate(at), "2026-10");
  assert.equal(instantToLocal(at, "America/Los_Angeles").date, "2026-10-31");
  // 跨年
  assert.equal(periodToGenerate(new Date("2026-12-31T14:59:59.999Z")), "2026-11");
  assert.equal(periodToGenerate(new Date("2026-12-31T15:00:00.000Z")), "2026-12");
  assert.equal(periodToGenerate(new Date("2027-01-01T00:00:00.000Z")), "2026-12");
});

test("切月：闰年 2 月——2028-02-29 属于 2 月；2 月最后一天是 29 日（2028、2000）、28 日（2027、2100）；29 日当天还不能出 2 月", () => {
  for (const [period, last] of [["2028-02", "2028-02-29"], ["2000-02", "2000-02-29"], ["2027-02", "2027-02-28"], ["2100-02", "2100-02-28"], ["2026-12", "2026-12-31"], ["2026-04", "2026-04-30"]] as const) {
    assert.equal(periodLastDay(period), last, period);
    assert.equal(periodLastDay(period), oracleLastDay(period), period);
  }
  assert.equal(periodOfDate("2028-02-29"), "2028-02");
  assert.equal(periodEnded("2028-02", "2028-02-29"), false);
  assert.equal(periodEnded("2028-02", "2028-03-01"), true);
  assert.equal(periodToGenerate(new Date("2028-02-29T14:59:59.999Z")), "2028-01");
  assert.equal(periodToGenerate(new Date("2028-02-29T15:00:00.000Z")), "2028-02");
  const leap: BillableItem = { sourceKey: "order:leap", kind: "order", currency: "JPY", amountMinor: 5_000, serviceDate: "2028-02-29", orderId: "leap", orderNo: "NZleap", detail: {} };
  assert.equal(draftStatements("2028-02", [leap]).length, 1);
  assert.equal(draftStatements("2028-01", [leap]).length, 0);
  assert.deepEqual(draftStatements("2028-03", [leap])[0]?.lines.map((l) => l.priorPeriod), [true]);
});

// ---- 应付日、付款日 ----

test("应付日：次月 20 日；12 月的跨年；已清退的再延后一个月（11 月 → 次年 1 月）；付款日不在 1–28 抛错", () => {
  assert.equal(payDueDate("2026-09", 20, false), "2026-10-20");
  assert.equal(payDueDate("2026-12", 20, false), "2027-01-20");
  assert.equal(payDueDate("2026-11", 20, true), "2027-01-20");
  assert.equal(payDueDate("2028-01", 28, false), "2028-02-28");
  for (const day of [0, 29, 31, 20.5]) assert.throws(() => payDueDate("2026-09", day, false), RangeError, String(day));
});

test("付款日：正好在 20 日批准进当天；21 日批准顺延到下个月 20 日；当月批次锁了顺延一个月，连着两个月都锁了顺延两个月", () => {
  const open = (): boolean => false;
  assert.equal(payoutDateFor("2026-10-20", "2026-10-20", open), "2026-10-20");
  assert.equal(payoutDateFor("2026-10-20", "2026-10-07", open), "2026-10-20");
  assert.equal(payoutDateFor("2026-10-20", "2026-10-21", open), "2026-11-20");
  assert.equal(payoutDateFor("2026-12-20", "2026-12-21", open), "2027-01-20");
  assert.equal(payoutDateFor("2026-10-20", "2026-10-07", (d) => d === "2026-10-20"), "2026-11-20");
  assert.equal(payoutDateFor("2026-10-20", "2026-10-07", (d) => d === "2026-10-20" || d === "2026-11-20"), "2026-12-20");
  // 过了付款日、下一个月的也锁了
  assert.equal(payoutDateFor("2026-10-20", "2026-10-25", (d) => d === "2026-11-20"), "2026-12-20");
  assert.throws(() => payoutDateFor("2026-10-20", "2026-10-07", () => true), RangeError);
});

// ---- 确认期 ----

test("确认期正好 7 天（按毫秒）：截止前 1 毫秒不自动确认，截止那一刻自动确认；有异议、已确认的不自动确认", () => {
  const issued = new Date("2026-10-31T15:00:00.000Z");
  const due = confirmDueAt(issued);
  assert.equal(due.toISOString(), "2026-11-07T15:00:00.000Z");
  assert.equal(autoConfirmDue({ status: "issued", confirmDueAt: due }, new Date(due.getTime() - 1)), false);
  assert.equal(autoConfirmDue({ status: "issued", confirmDueAt: due }, due), true);
  for (const status of STATEMENT_STATUSES.filter((s) => s !== "issued")) {
    assert.equal(autoConfirmDue({ status, confirmDueAt: due }, new Date(due.getTime() + 30 * 86_400_000)), false, status);
  }
});

// ---- 状态流转 ----

test("状态流转：完整矩阵——已付款、进了批次、无需付款、转入下期、作废的什么都不能做（付款只能从待付款）；有异议的不能自动确认、不能再提异议", () => {
  const allowed: Record<StatementAction, StatementStatus[]> = {
    confirm: ["issued", "disputed"],
    auto_confirm: ["issued"],
    dispute: ["issued"],
    reply: ["disputed"],
    void: ["issued", "disputed", "confirmed"],
    request_review: ["confirmed"],
    approve: ["confirmed"],
    pay: ["in_payout"],
  };
  for (const [action, from] of Object.entries(allowed) as [StatementAction, StatementStatus[]][]) {
    for (const status of STATEMENT_STATUSES) {
      assert.equal(statementActionAllowed(status, action), from.includes(status), `${status} → ${action}`);
    }
  }
});

test("状态流转：终态（已付款、无需付款、转入下期、已作废）不能再作废、确认、复核", () => {
  for (const status of ["paid", "settled", "carried", "void"] as const) {
    for (const action of ["void", "confirm", "auto_confirm", "dispute", "reply", "request_review", "approve"] as const) {
      assert.equal(statementActionAllowed(status, action), false, `${status} → ${action}`);
    }
  }
  assert.equal(statementActionAllowed("paid", "pay"), false, "已付款不能再付一次");
});

test("明细的种类和顺序：结转在最前；同类按服务日期、订单号", () => {
  const mk = (key: string, kind: StatementLineKind, serviceDate: string | null, amount: number, orderNo: string | null): BillableItem => ({ sourceKey: key, kind, currency: "JPY", amountMinor: amount, serviceDate, orderId: orderNo, orderNo, detail: {} });
  const drafts = draftStatements("2026-10", [
    mk("deduction:1", "deduction", "2026-10-02", -100, "NZ1"),
    mk("order:2", "order", "2026-10-03", 300, "NZ3"),
    mk("order:1", "order", "2026-10-03", 200, "NZ2"),
    mk("carry:1", "carry_forward", null, -50, null),
    mk("order:0", "order", "2026-09-30", 100, "NZ9"),
  ]);
  assert.deepEqual(drafts[0]?.lines.map((l) => l.sourceKey), ["carry:1", "order:0", "order:1", "order:2", "deduction:1"]);
  assert.equal(drafts[0]?.totalMinor, 450);
});
