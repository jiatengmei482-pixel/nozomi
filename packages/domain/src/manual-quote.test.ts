import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MANUAL_QUOTE_LIMITS,
  MANUAL_QUOTE_NO_FORMAT,
  MANUAL_QUOTE_RULES,
  MANUAL_QUOTE_STATUSES,
  MANUAL_QUOTE_STATUS_NAMES,
  type ManualQuoteTrip,
  isRealLocalDateTime,
  manualQuoteEmail,
  manualQuotePurgeCutoffs,
  manualQuotePurgeDue,
  manualQuoteStatusChangeAllowed,
  manualQuoteTripIssues,
  manualQuoteWhatsappText,
  whatsappChatUrl,
  whatsappDigits,
} from "./manual-quote.ts";

test("状态五种，各有中文名：新 / 跟进中 / 已报价 / 已转订单 / 关闭", () => {
  assert.deepEqual([...MANUAL_QUOTE_STATUSES], ["new", "following", "quoted", "converted", "closed"]);
  assert.deepEqual(MANUAL_QUOTE_STATUSES.map((status) => MANUAL_QUOTE_STATUS_NAMES[status]), ["新", "跟进中", "已报价", "已转订单", "关闭"]);
});

test("邮箱：全角转半角、去首尾空白、小写；不像邮箱的、带控制字符的、太长的不收", () => {
  assert.equal(manualQuoteEmail("  Guest@Example.COM "), "guest@example.com");
  assert.equal(manualQuoteEmail("ｇｕｅｓｔ＠ｅｘａｍｐｌｅ．ｃｏｍ"), "guest@example.com");
  for (const bad of ["", "guest", "guest@", "@example.com", "a b@example.com", "guest@exa\u0000mple.com", `${"a".repeat(320)}@example.com`]) {
    assert.equal(manualQuoteEmail(bad), null, JSON.stringify(bad));
  }
});

test("客人填的 WhatsApp：必须 + 开头，去掉空格、连字符、括号、点后 8–15 位数字、国家码不以 0 开头；返回纯数字", () => {
  assert.equal(whatsappDigits("+81 90-1234-5678", { requirePlus: true }), "819012345678");
  assert.equal(whatsappDigits("＋８１ ９０ １２３４ ５６７８", { requirePlus: true }), "819012345678");
  assert.equal(whatsappDigits("+1 (415) 555.0123", { requirePlus: true }), "14155550123");
  assert.equal(whatsappDigits("+12345678", { requirePlus: true }), "12345678");
  assert.equal(whatsappDigits("+123456789012345", { requirePlus: true }), "123456789012345");
  for (const bad of ["", "090-1234-5678", "819012345678", "+0 90 1234 5678", "+1234567", "+1234567890123456", "+81 90 1234 567a", "+81+9012345678", "0081 90 1234 5678"]) {
    assert.equal(whatsappDigits(bad, { requirePlus: true }), null, bad);
  }
});

test("运营后台填的客服 WhatsApp：+ 可有可无；00 开头的国际冠码不认", () => {
  assert.equal(whatsappDigits("819012345678", { requirePlus: false }), "819012345678");
  assert.equal(whatsappDigits("+81 90 1234 5678", { requirePlus: false }), "819012345678");
  assert.equal(whatsappDigits("0081 90 1234 5678", { requirePlus: false }), null);
  assert.equal(whatsappDigits("09012345678", { requirePlus: false }), null);
});

const trip = (overrides: Partial<ManualQuoteTrip> = {}): ManualQuoteTrip => ({
  category: "point_to_point",
  pickup: { name: "新宿站", lat: 35.69, lng: 139.7 },
  dropoff: { name: "成田机场", lat: 35.77, lng: 140.39 },
  serviceLocal: "2026-12-01T09:30",
  passengers: 2,
  luggage: 1,
  packageHours: null,
  ...overrides,
});

test("行程按用车类型核对：接送机、点对点要下车地点；包车要时长、下车地点可以没有；别的类型不能带时长", () => {
  assert.deepEqual(manualQuoteTripIssues(trip()), []);
  assert.deepEqual(manualQuoteTripIssues(trip({ category: "airport_transfer", dropoff: null })), [{ field: "dropoff", reason: "REQUIRED" }]);
  assert.deepEqual(manualQuoteTripIssues(trip({ category: "charter", dropoff: null, packageHours: 8 })), []);
  assert.deepEqual(manualQuoteTripIssues(trip({ category: "charter" })), [{ field: "package_hours", reason: "REQUIRED" }]);
  assert.deepEqual(manualQuoteTripIssues(trip({ packageHours: 4 })), [{ field: "package_hours", reason: "NOT_APPLICABLE" }]);
  assert.deepEqual(manualQuoteTripIssues(trip({ serviceLocal: "2026-02-30T09:30" })), [{ field: "service_local", reason: "INVALID" }]);
});

test("用车时间：真实存在的日期和时刻（闰年 2 月 29 日可以，24 点、13 月不行）", () => {
  assert.equal(isRealLocalDateTime("2028-02-29T23:59"), true);
  assert.equal(isRealLocalDateTime("2027-02-29T10:00"), false);
  assert.equal(isRealLocalDateTime("2026-12-01T24:00"), false);
  assert.equal(isRealLocalDateTime("2026-13-01T10:00"), false);
  assert.equal(isRealLocalDateTime("2026-12-01 10:00"), false);
});

test("状态：可以改成任何别的状态（关闭后也能重新跟进），不能改回「新」、不能原样再改一次", () => {
  assert.equal(manualQuoteStatusChangeAllowed("new", "following"), true);
  assert.equal(manualQuoteStatusChangeAllowed("closed", "following"), true);
  assert.equal(manualQuoteStatusChangeAllowed("quoted", "converted"), true);
  assert.equal(manualQuoteStatusChangeAllowed("following", "new"), false);
  assert.equal(manualQuoteStatusChangeAllowed("quoted", "quoted"), false);
});

test("保留期：结束满 180 天、或提交满 365 天清除；还没结束的不到 365 天不清", () => {
  const day = 86_400_000;
  const now = new Date("2027-06-01T00:00:00Z");
  const ago = (days: number) => new Date(now.getTime() - days * day);
  assert.equal(manualQuotePurgeDue({ createdAt: ago(200), finishedAt: ago(180) }, now), true);
  assert.equal(manualQuotePurgeDue({ createdAt: ago(200), finishedAt: new Date(ago(180).getTime() + 1) }, now), false);
  assert.equal(manualQuotePurgeDue({ createdAt: ago(364), finishedAt: null }, now), false);
  assert.equal(manualQuotePurgeDue({ createdAt: ago(365), finishedAt: null }, now), true);
  assert.deepEqual(manualQuotePurgeCutoffs(now), { finishedBefore: ago(MANUAL_QUOTE_RULES.retentionDaysAfterFinish), createdBefore: ago(MANUAL_QUOTE_RULES.retentionDaysMax) });
});

test("限速：每个地址 15 分钟 3 次、每天 10 次；每个联系方式每天 3 次；全站每小时 300 次", () => {
  assert.deepEqual(MANUAL_QUOTE_LIMITS, {
    ip: { max: 3, windowMs: 900_000 },
    ipDay: { max: 10, windowMs: 86_400_000 },
    contactDay: { max: 3, windowMs: 86_400_000 },
    globalHour: { max: 300, windowMs: 3_600_000 },
  });
});

test("申请编号的格式：MQ + 8 位日期 + 8 位数字和大写字母", () => {
  assert.match("MQ20261110AB12CD34", MANUAL_QUOTE_NO_FORMAT);
  assert.doesNotMatch("MQ20261110ab12cd34", MANUAL_QUOTE_NO_FORMAT);
  assert.doesNotMatch("NZ20261110AB12CD34", MANUAL_QUOTE_NO_FORMAT);
});

test("WhatsApp 预填的一句话：只有用车类型、上车 → 下车、时间、人数（包车加时长），没有任何联系方式", () => {
  assert.equal(manualQuoteWhatsappText(trip()), "您好，我想咨询用车报价：点对点，新宿站 → 成田机场，2026-12-01 09:30，2 人。");
  assert.equal(manualQuoteWhatsappText(trip({ category: "charter", dropoff: null, packageHours: 8 })), "您好，我想咨询用车报价：包车 8 小时，新宿站，2026-12-01 09:30，2 人。");
  const long = manualQuoteWhatsappText(trip({ pickup: { name: `东京${"很长的地址".repeat(40)}`, lat: 0, lng: 0 } }));
  assert.ok(long.length < 500);
  assert.match(long, /… → 成田机场/);
  assert.equal(manualQuoteWhatsappText(trip({ pickup: { name: "  新宿\n站 ", lat: 0, lng: 0 } })).includes("新宿 站 →"), true);
});

test("wa.me 链接：纯数字号码 + URL 编码的消息", () => {
  assert.equal(whatsappChatUrl("819012345678", "您好 & 谢谢"), "https://wa.me/819012345678?text=%E6%82%A8%E5%A5%BD%20%26%20%E8%B0%A2%E8%B0%A2");
});
