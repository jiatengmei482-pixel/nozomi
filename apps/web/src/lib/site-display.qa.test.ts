/**
 * 测试角色补充（M3-11，pages/site-booking.md 第 11.2 节）：客人看的时间（F8）在跨午夜、跨月、跨年、闰日、不同城市时区下的写法；
 * 报价按总价排序（F6）在同价、超出浮点精度、写法不同的数值上的表现；取消政策客人说法（F7）的边界档；排第一的区块（F1）的优先级冲突。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SiteOrder, SiteQuote } from "../api/site.ts";
import { guestCancelPolicyText, guestInstantText, guestLocalText, primaryOrderSection, quotesByTotal } from "./site-display.ts";

const HOUR = 3_600_000;

test("F8 跨午夜：同一城市里 UTC 差一分钟，当地日期和星期跟着变（东京 UTC+9 的午夜是 UTC 15:00）", () => {
  const now = new Date("2026-10-26T03:00:00.000Z");
  assert.equal(guestInstantText("2026-10-26T14:59:00.000Z", "Asia/Tokyo", now), "10月26日（周一）23:59");
  assert.equal(guestInstantText("2026-10-26T15:00:00.000Z", "Asia/Tokyo", now), "10月27日（周二）00:00");
  // 同一时刻在不同城市：首尔与东京同为 UTC+9，曼谷 UTC+7 还在前一天
  assert.equal(guestInstantText("2026-10-26T15:30:00.000Z", "Asia/Seoul", now), "10月27日（周二）00:30");
  assert.equal(guestInstantText("2026-10-26T15:30:00.000Z", "Asia/Bangkok", now), "10月26日（周一）22:30");
  assert.equal(guestInstantText("2026-10-26T15:30:00.000Z", "Pacific/Honolulu", now), "10月26日（周一）05:30");
});

test("F8 跨月、闰日：月底到下月初、2 月 29 日的星期和月份都按当地日历", () => {
  const now = new Date("2028-01-15T00:00:00.000Z");
  assert.equal(guestInstantText("2028-01-31T15:00:00.000Z", "Asia/Tokyo", now), "2月1日（周二）00:00");
  assert.equal(guestLocalText("2028-02-29T08:00", "Asia/Tokyo", now), "2月29日（周二）08:00");
  assert.equal(guestInstantText("2028-02-29T15:00:00.000Z", "Asia/Tokyo", now), "3月1日（周三）00:00");
  // 月份、日期不补零，时间补零
  assert.equal(guestLocalText("2028-03-05T07:05", "Asia/Tokyo", now), "3月5日（周日）07:05");
});

test("F8 跨年：「今年」按订单城市的当地日期判断，不按浏览器或 UTC", () => {
  // UTC 2026-12-31 20:00：东京已是 2027-01-01 05:00，檀香山还是 2026-12-31 10:00
  const now = new Date("2026-12-31T20:00:00.000Z");
  assert.equal(guestLocalText("2027-01-01T10:00", "Asia/Tokyo", now), "1月1日（周五）10:00", "东京已经进入 2027 年：不带年份");
  assert.equal(guestLocalText("2027-01-01T10:00", "Pacific/Honolulu", now), "2027年1月1日（周五）10:00", "檀香山还在 2026 年：带年份");
  assert.equal(guestLocalText("2026-12-31T23:00", "Asia/Tokyo", now), "2026年12月31日（周四）23:00", "东京的去年要带年份（时间线里的旧事件）");
  // 一个时刻跨过当地新年零点：12-31 23:59 与 1-1 00:00 只差一分钟，前者带年份
  const tokyoNewYear = new Date("2027-01-01T00:00:00.000Z");
  assert.equal(guestInstantText("2026-12-31T14:59:00.000Z", "Asia/Tokyo", tokyoNewYear), "2026年12月31日（周四）23:59");
  assert.equal(guestInstantText("2026-12-31T15:00:00.000Z", "Asia/Tokyo", tokyoNewYear), "1月1日（周五）00:00");
});

test("F8 写法：带秒的当地时间只取到分钟；无效时刻写「—」，不写 Invalid Date", () => {
  const now = new Date("2026-10-26T03:00:00.000Z");
  assert.equal(guestLocalText("2026-10-26T17:45:59", "Asia/Tokyo", now), "10月26日（周一）17:45");
  assert.equal(guestInstantText("not-a-date", "Asia/Tokyo", now), "—");
  assert.doesNotMatch(guestInstantText("2026-10-26T08:45:00.000Z", "Asia/Tokyo", now), /\d{4}-\d{2}-\d{2}|T|Invalid/);
});

const quoteOf = (id: string, amount: string): SiteQuote => ({
  quote_id: id,
  expires_at: "2026-10-26T03:30:00.000Z",
  service_date: "2026-11-20",
  urgent: false,
  vehicle_group: { id, code: `VG-${id}`, name: { zh: id }, grade: "business", seats: 7, sample_models: [], combos: [] },
  price: { total: { amount, currency: "KRW" }, fx: null },
  free_wait_minutes: 60,
  cancel_policy: { category: "airport_transfer", level: "business", tiers: [] },
});
const ids = (quotes: SiteQuote[]): string[] => quotes.map((quote) => quote.quote_id);

test("F6 同价：所有报价总价相同（含写法不同的 100 / 100.0 / 100.00）时完全保持接口顺序", () => {
  assert.deepEqual(ids(quotesByTotal([quoteOf("c", "100.00"), quoteOf("a", "100"), quoteOf("b", "100.0")])), ["c", "a", "b"]);
  assert.deepEqual(ids(quotesByTotal([quoteOf("x", "0"), quoteOf("y", "0.00")])), ["x", "y"]);
  assert.deepEqual(quotesByTotal([]), []);
  assert.deepEqual(ids(quotesByTotal([quoteOf("only", "1")])), ["only"]);
});

test("F6 不经浮点：超过 2^53 的整数金额、浮点会算错的小数也能分出大小", () => {
  // 9007199254740993 用 Number 会变成 9007199254740992，两者比较相等；按数值它更大
  assert.deepEqual(ids(quotesByTotal([quoteOf("big", "9007199254740993"), quoteOf("small", "9007199254740992")])), ["small", "big"]);
  // 0.1 + 0.2 之类：0.30000000000000004 与 0.3 用浮点比较也能分开，这里比的是字符串里的十进制位
  assert.deepEqual(ids(quotesByTotal([quoteOf("p", "0.30000000000000004"), quoteOf("q", "0.3")])), ["q", "p"]);
  // 整数位数不同、小数位数不同
  assert.deepEqual(ids(quotesByTotal([quoteOf("ten", "10"), quoteOf("nine", "9.999"), quoteOf("hundred", "100.1"), quoteOf("cent", "0.01")])), ["cent", "nine", "ten", "hundred"]);
});

test("F7 边界档：第一档就收费、收全额；99.99% 不写成全额；只有一档的 0 小时收全额写「任何时候取消收全额」", () => {
  assert.equal(guestCancelPolicyText([{ min_hours_before: 0, fee_bp: 10000 }]), "任何时候取消收全额");
  assert.equal(guestCancelPolicyText([{ min_hours_before: 24, fee_bp: 9999 }, { min_hours_before: 0, fee_bp: 10000 }]), "用车前 24 小时以上取消收 99.99%；24 小时内取消收全额");
  assert.equal(guestCancelPolicyText([{ min_hours_before: 72, fee_bp: 0 }, { min_hours_before: 48, fee_bp: 2000 }, { min_hours_before: 24, fee_bp: 5000 }, { min_hours_before: 0, fee_bp: 10000 }]), "用车前 72 小时以上取消免费；48–72 小时内取消收 20%；24–48 小时内取消收 50%；24 小时内取消收全额");
  assert.equal(guestCancelPolicyText([]), "");
  for (const text of [guestCancelPolicyText([{ min_hours_before: 48, fee_bp: 0 }, { min_hours_before: 0, fee_bp: 10000 }])]) assert.doesNotMatch(text, /[≥≤<>]|bp|基点|扣/);
});

type Primary = Pick<SiteOrder, "status" | "landing" | "extra_charges">;
const landing = (scheduledAt: Date): NonNullable<SiteOrder["landing"]> => ({
  scheduled_at: scheduledAt.toISOString(),
  guest_reported_at: null,
  driver_reported_at: null,
  landed_at: scheduledAt.toISOString(),
  source: "scheduled",
  disagreement: false,
  delay_minutes: 0,
  within_delay_allowance: true,
});
const openCharge: SiteOrder["extra_charges"][number] = {
  id: "c",
  type: "waiting",
  amount: { amount: "2200", currency: "JPY" },
  description: null,
  status: "in_window",
  submitted_at: "2026-10-26T00:00:00.000Z",
  dispute_until: "2026-10-28T00:00:00.000Z",
  dispute_open: true,
  disputed_at: null,
  charged_at: null,
};

test("F1 冲突时的先后：待付款压过一切；「我已落地」能点压过异议期内的费用；已取消、已完成的单不把航班落地排第一", () => {
  const now = new Date("2026-10-26T03:00:00.000Z");
  const soon = landing(new Date(now.getTime() + HOUR));
  assert.equal(primaryOrderSection({ status: "pending_payment", landing: soon, extra_charges: [openCharge] } satisfies Primary, now), "payment");
  assert.equal(primaryOrderSection({ status: "confirmed", landing: soon, extra_charges: [openCharge] } satisfies Primary, now), "landing");
  assert.equal(primaryOrderSection({ status: "cancelled", landing: soon, extra_charges: [] } satisfies Primary, now), "trip");
  assert.equal(primaryOrderSection({ status: "completed", landing: soon, extra_charges: [] } satisfies Primary, now), "trip");
  // 能点的那一刻：离计划到达正好 3 小时
  const edge = landing(new Date(now.getTime() + 3 * HOUR));
  assert.equal(primaryOrderSection({ status: "confirmed", landing: edge, extra_charges: [] } satisfies Primary, now), "landing");
  assert.equal(primaryOrderSection({ status: "confirmed", landing: edge, extra_charges: [] } satisfies Primary, new Date(now.getTime() - 1)), "trip");
});
