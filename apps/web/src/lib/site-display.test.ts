/**
 * 官网客人看到的说法和区块顺序（M3-11，pages/site-booking.md 第 11.2 节）：取消政策的客人说法（F7）、日期时间（F8）、
 * 报价按总价排序（F6）、订单页排第一的区块（F1）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SiteOrder, SiteQuote } from "../api/site.ts";
import { guestCancelPolicyText, guestInstantText, guestLocalText, orderSectionSequence, primaryOrderSection, quotesByTotal } from "./site-display.ts";

const HOUR = 3_600_000;

test("取消政策用客人的说法：没有 ≥ < 符号，扣全额写「收全额」，免费写「免费」，非整数的百分比照写", () => {
  assert.equal(
    guestCancelPolicyText([{ min_hours_before: 48, fee_bp: 0 }, { min_hours_before: 24, fee_bp: 5000 }, { min_hours_before: 0, fee_bp: 10000 }]),
    "用车前 48 小时以上取消免费；24–48 小时内取消收 50%；24 小时内取消收全额",
  );
  assert.equal(guestCancelPolicyText([{ min_hours_before: 0, fee_bp: 0 }]), "任何时候取消免费");
  assert.equal(guestCancelPolicyText([{ min_hours_before: 72, fee_bp: 0 }, { min_hours_before: 0, fee_bp: 1250 }]), "用车前 72 小时以上取消免费；72 小时内取消收 12.5%");
  assert.equal(guestCancelPolicyText([{ min_hours_before: 24, fee_bp: 5 }, { min_hours_before: 0, fee_bp: 10000 }]), "用车前 24 小时以上取消收 0.05%；24 小时内取消收全额");
  assert.doesNotMatch(guestCancelPolicyText([{ min_hours_before: 48, fee_bp: 0 }, { min_hours_before: 0, fee_bp: 10000 }]), /[≥<]|100%|扣/);
});

test("日期时间写成「10月26日（周一）17:45」；不在城市当地的今年时带年份；按城市当地时间换算", () => {
  const now = new Date("2026-10-26T03:00:00.000Z");
  assert.equal(guestLocalText("2026-10-26T17:45", "Asia/Tokyo", now), "10月26日（周一）17:45");
  assert.equal(guestLocalText("2027-01-03T09:05", "Asia/Tokyo", now), "2027年1月3日（周日）09:05");
  assert.equal(guestLocalText("2025-12-31T23:59", "Asia/Tokyo", now), "2025年12月31日（周三）23:59");
  // 东京已经是 2027 年元旦、UTC 还在 2026 年：「今年」按城市当地算
  assert.equal(guestLocalText("2027-01-01T10:00", "Asia/Tokyo", new Date("2026-12-31T16:00:00.000Z")), "1月1日（周五）10:00");
  // 一个时刻换成当地：UTC 2026-10-26 15:30 是东京 10 月 27 日 00:30
  assert.equal(guestInstantText("2026-10-26T15:30:00.000Z", "Asia/Tokyo", now), "10月27日（周二）00:30");
  assert.equal(guestInstantText(null, "Asia/Tokyo", now), "—");
  assert.equal(guestLocalText("不是时间", "Asia/Tokyo", now), "不是时间");
});

const quoteOf = (id: string, amount: string): SiteQuote => ({
  quote_id: id,
  expires_at: "2026-10-26T03:30:00.000Z",
  service_date: "2026-11-20",
  urgent: false,
  package: null,
  vehicle_group: { id, code: `VG-${id}`, name: { zh: id }, grade: "business", seats: 7, sample_models: [], combos: [] },
  price: { total: { amount, currency: "USD" }, fx: null },
  free_wait_minutes: 60,
  cancel_policy: { category: "airport_transfer", level: "business", tiers: [] },
});

test("报价按总价从低到高：按数值比较（含小数、位数不同），同价保持接口顺序，不改原数组", () => {
  const given = [quoteOf("a", "120.5"), quoteOf("b", "99.99"), quoteOf("c", "1000"), quoteOf("d", "120.50"), quoteOf("e", "9")];
  assert.deepEqual(quotesByTotal(given).map((quote) => quote.quote_id), ["e", "b", "a", "d", "c"]);
  assert.deepEqual(given.map((quote) => quote.quote_id), ["a", "b", "c", "d", "e"]);
});

type Primary = Pick<SiteOrder, "status" | "landing" | "extra_charges">;
const landing = (scheduledAt: Date, reported: string | null = null): NonNullable<SiteOrder["landing"]> => ({
  scheduled_at: scheduledAt.toISOString(),
  guest_reported_at: reported,
  driver_reported_at: null,
  landed_at: scheduledAt.toISOString(),
  source: "scheduled",
  disagreement: false,
  delay_minutes: 0,
  within_delay_allowance: true,
});
const charge = (open: boolean): SiteOrder["extra_charges"][number] => ({
  id: "c",
  type: "waiting",
  amount: { amount: "2200", currency: "JPY" },
  description: null,
  status: open ? "in_window" : "charged",
  submitted_at: "2026-10-26T00:00:00.000Z",
  dispute_until: "2026-10-28T00:00:00.000Z",
  dispute_open: open,
  disputed_at: null,
  charged_at: null,
});

test("订单页排第一的区块：待付款 → 付款；「我已落地」能点 → 航班落地；有异议期内的费用 → 服务后的费用；其他 → 行程", () => {
  const now = new Date("2026-10-26T03:00:00.000Z");
  const base: Primary = { status: "confirmed", landing: null, extra_charges: [] };
  assert.equal(primaryOrderSection({ ...base, status: "pending_payment", landing: landing(new Date(now.getTime() + HOUR)) }, now), "payment");
  assert.equal(primaryOrderSection({ ...base, landing: landing(new Date(now.getTime() + HOUR)) }, now), "landing");
  assert.equal(primaryOrderSection({ ...base, status: "arrived", landing: landing(new Date(now.getTime() - HOUR)) }, now), "landing");
  assert.equal(primaryOrderSection({ ...base, landing: landing(new Date(now.getTime() + 4 * HOUR)) }, now), "trip", "离计划到达 3 小时以上：还不能点");
  assert.equal(primaryOrderSection({ ...base, landing: landing(new Date(now.getTime() - HOUR), "2026-10-26T02:30:00.000Z") }, now), "trip", "已经点过");
  assert.equal(primaryOrderSection({ ...base, status: "completed", extra_charges: [charge(false), charge(true)] }, now), "charges");
  assert.equal(primaryOrderSection({ ...base, status: "completed", extra_charges: [charge(false)] }, now), "trip", "异议期过了");
  assert.equal(primaryOrderSection(base, now), "trip");
  assert.deepEqual(orderSectionSequence("landing"), ["landing", "trip", "timeline", "driver", "charges", "change", "cancel", "feedback", "help"]);
  assert.deepEqual(orderSectionSequence("payment"), ["payment", "trip", "timeline", "driver", "landing", "charges", "change", "cancel", "feedback", "help"]);
  assert.deepEqual(orderSectionSequence("trip"), ["trip", "timeline", "driver", "landing", "charges", "change", "cancel", "feedback", "help"]);
});

test("投诉和反馈（M4-03）：排在取消之后、需要帮助之前；客人看到的处理状态只有三种说法；结论用客人的说法", async () => {
  const { guestTicketBadge, guestTicketOutcome, GUEST_TICKET_TYPE_NAMES } = await import("./site-display.ts");
  const { SITE_TICKET_TYPES } = await import("../api/site.ts");
  assert.deepEqual(orderSectionSequence("trip").slice(-3), ["cancel", "feedback", "help"]);
  for (const type of SITE_TICKET_TYPES) assert.ok(GUEST_TICKET_TYPE_NAMES[type], type);
  assert.deepEqual(["open", "awaiting_tenant", "in_progress", "pending_review", "decided", "closed"].map((status) => guestTicketBadge(status).label), ["处理中", "处理中", "处理中", "处理中", "已有结果", "已结束"]);
  assert.equal(guestTicketOutcome("complaint", "upheld"), "投诉成立，平台按赔付标准给您补偿");
  assert.equal(guestTicketOutcome("complaint", null), null);
});
