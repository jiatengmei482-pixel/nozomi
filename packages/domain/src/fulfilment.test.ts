import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FULFILMENT_EVENTS,
  LANDING_SOURCES,
  LANDING_SOURCE_NAMES,
  EVIDENCE_FILE_RULES,
  NO_SHOW_ITEMS,
  NO_SHOW_ITEM_NAMES,
  type NoShowFacts,
  contactsWithinFreeWait,
  detectEvidenceType,
  distanceToPickupMeters,
  effectiveLanding,
  freeWaitEnded,
  freeWaitWindow,
  nextFulfilmentEvent,
  proxyEventNeedsReview,
  proxyEffectiveOccurredAt,
  proxyFulfilmentTimeIssue,
  landingApplies,
  landingReportIssue,
  noShowChecklist,
} from "./fulfilment.ts";

const at = (iso: string): Date => new Date(iso);
const scheduledAt = at("2026-10-20T01:00:00Z");

test("落地时间 · 规则 4：客人和司机都没有记录，取计划到达时间", () => {
  assert.deepEqual(effectiveLanding({ scheduledAt, guestReportedAt: null, driver: null }), { landedAt: scheduledAt, source: "scheduled", disagreement: false, delayMinutes: 0, withinDelayAllowance: true });
});

test("落地时间 · 规则 3：只有客人确认的，取客人的（客人确认优先）", () => {
  const result = effectiveLanding({ scheduledAt, guestReportedAt: at("2026-10-20T01:40:00Z"), driver: null });
  assert.equal(result.source, "guest");
  assert.deepEqual(result.landedAt, at("2026-10-20T01:40:00Z"));
  assert.equal(result.delayMinutes, 40);
});

test("落地时间 · 规则 3：只有司机填写的、附了到达屏照片，取司机的", () => {
  const result = effectiveLanding({ scheduledAt, guestReportedAt: null, driver: { landedAt: at("2026-10-20T01:20:00Z"), arrivalScreenPhoto: true } });
  assert.equal(result.source, "driver");
  assert.deepEqual(result.landedAt, at("2026-10-20T01:20:00Z"));
});

test("落地时间 · 规则 1：司机填写但没拍到达屏，不算数——回到计划到达时间", () => {
  const result = effectiveLanding({ scheduledAt, guestReportedAt: null, driver: { landedAt: at("2026-10-20T03:00:00Z"), arrivalScreenPhoto: false } });
  assert.equal(result.source, "scheduled");
  assert.deepEqual(result.landedAt, scheduledAt);
});

test("落地时间 · 规则 1：司机没拍到达屏时，有客人确认就用客人的，不算「不一致」", () => {
  const result = effectiveLanding({ scheduledAt, guestReportedAt: at("2026-10-20T01:10:00Z"), driver: { landedAt: at("2026-10-20T03:00:00Z"), arrivalScreenPhoto: false } });
  assert.equal(result.source, "guest");
  assert.equal(result.disagreement, false);
});

test("落地时间 · 规则 2：客人和司机不一致时取较晚者（司机晚）", () => {
  const result = effectiveLanding({ scheduledAt, guestReportedAt: at("2026-10-20T01:10:00Z"), driver: { landedAt: at("2026-10-20T01:30:00Z"), arrivalScreenPhoto: true } });
  assert.equal(result.source, "driver");
  assert.deepEqual(result.landedAt, at("2026-10-20T01:30:00Z"));
  assert.equal(result.disagreement, true);
});

test("落地时间 · 规则 2：客人和司机不一致时取较晚者（客人晚）；一样时记为客人确认", () => {
  const later = effectiveLanding({ scheduledAt, guestReportedAt: at("2026-10-20T01:50:00Z"), driver: { landedAt: at("2026-10-20T01:30:00Z"), arrivalScreenPhoto: true } });
  assert.equal(later.source, "guest");
  assert.deepEqual(later.landedAt, at("2026-10-20T01:50:00Z"));
  const same = effectiveLanding({ scheduledAt, guestReportedAt: at("2026-10-20T01:30:00Z"), driver: { landedAt: at("2026-10-20T01:30:00Z"), arrivalScreenPhoto: true } });
  assert.equal(same.source, "guest");
  assert.equal(same.disagreement, false);
});

test("落地时间：航班提前到达不算延误；延误 6 小时以内顺延不加收，超过 6 小时不在顺延范围", () => {
  assert.equal(effectiveLanding({ scheduledAt, guestReportedAt: at("2026-10-20T00:30:00Z"), driver: null }).delayMinutes, 0);
  const six = effectiveLanding({ scheduledAt, guestReportedAt: at("2026-10-20T07:00:00Z"), driver: null });
  assert.equal(six.delayMinutes, 360);
  assert.equal(six.withinDelayAllowance, true);
  const over = effectiveLanding({ scheduledAt, guestReportedAt: at("2026-10-20T07:01:00Z"), driver: null });
  assert.equal(over.withinDelayAllowance, false);
});

test("落地时间：报上来的时间不能晚于现在（留 5 分钟误差），不能比计划早 3 小时以上", () => {
  const now = at("2026-10-20T02:00:00Z");
  assert.equal(landingReportIssue(at("2026-10-20T01:30:00Z"), scheduledAt, now), null);
  assert.equal(landingReportIssue(at("2026-10-20T02:05:00Z"), scheduledAt, now), null);
  assert.equal(landingReportIssue(at("2026-10-20T02:05:01Z"), scheduledAt, now), "IN_FUTURE");
  assert.equal(landingReportIssue(at("2026-10-19T22:00:00Z"), scheduledAt, now), null);
  assert.equal(landingReportIssue(at("2026-10-19T21:59:59Z"), scheduledAt, now), "TOO_EARLY");
});

test("落地时间只用于接机（从机场接人）", () => {
  assert.equal(landingApplies({ category: "airport_transfer", direction: "pickup", placeType: "airport" }), true);
  assert.equal(landingApplies({ category: "airport_transfer", direction: "dropoff", placeType: "airport" }), false);
  assert.equal(landingApplies({ category: "airport_transfer", direction: "pickup", placeType: "station" }), false);
  assert.equal(landingApplies({ category: "charter", direction: null, placeType: null }), false);
  for (const source of LANDING_SOURCES) assert.ok(LANDING_SOURCE_NAMES[source].length > 0);
});

test("免费等待：从起算时间开始，无限免等没有结束时间", () => {
  const window = freeWaitWindow(at("2026-10-20T01:30:00Z"), 90);
  assert.deepEqual(window, { start: at("2026-10-20T01:30:00Z"), end: at("2026-10-20T03:00:00Z") });
  assert.equal(freeWaitEnded(window, at("2026-10-20T02:59:59Z")), false);
  assert.equal(freeWaitEnded(window, at("2026-10-20T03:00:00Z")), true);
  assert.equal(freeWaitEnded(freeWaitWindow(at("2026-10-20T01:30:00Z"), null), at("2030-01-01T00:00:00Z")), false);
  assert.equal(contactsWithinFreeWait(window, [at("2026-10-20T01:29:59Z"), at("2026-10-20T01:30:00Z"), at("2026-10-20T03:00:00Z"), at("2026-10-20T03:00:01Z")]), 2);
});

/** 一单证据齐全的接机 no-show：计划 01:00 落地，免等 90 分钟到 02:30；司机 00:50 到达；三次联系；举牌照片；02:31 申请离开；02:45 提交。 */
const complete = (extra: Partial<NoShowFacts> = {}): NoShowFacts => ({
  serviceAt: scheduledAt,
  freeWait: freeWaitWindow(scheduledAt, 90),
  arrivedAt: at("2026-10-20T00:50:00Z"),
  arrivalDistanceMeters: 120,
  contactAttempts: [at("2026-10-20T01:10:00Z"), at("2026-10-20T01:40:00Z"), at("2026-10-20T02:20:00Z")],
  signboardPhotoAt: at("2026-10-20T01:05:00Z"),
  leaveRequestedAt: at("2026-10-20T02:31:00Z"),
  now: at("2026-10-20T02:45:00Z"),
  ...extra,
});

const failed = (facts: NoShowFacts): string[] => noShowChecklist(facts).items.filter((entry) => !entry.ok).map((entry) => entry.item);

test("no-show：5 项都满足时可以提交；客服不处理视为同意的时间是申请离开后 10 分钟", () => {
  const result = noShowChecklist(complete());
  assert.equal(result.complete, true);
  assert.deepEqual(result.items.map((entry) => entry.item), [...NO_SHOW_ITEMS]);
  assert.deepEqual(result.leaveConsentAt, at("2026-10-20T02:41:00Z"));
  for (const item of NO_SHOW_ITEMS) assert.ok(NO_SHOW_ITEM_NAMES[item].length > 0);
});

test("no-show 第 1 项：免费等待开始之后才到达、离上车点超过 300 米、没有定位，都不满足", () => {
  assert.deepEqual(failed(complete({ arrivedAt: at("2026-10-20T01:00:01Z") })), ["arrived_on_time_nearby"]);
  assert.deepEqual(failed(complete({ arrivedAt: at("2026-10-20T01:00:00Z") })), [], "正好在免等开始的那一刻到达也算");
  assert.deepEqual(failed(complete({ arrivalDistanceMeters: 301 })), ["arrived_on_time_nearby"]);
  assert.deepEqual(failed(complete({ arrivalDistanceMeters: 300 })), []);
  assert.deepEqual(failed(complete({ arrivalDistanceMeters: null })), ["arrived_on_time_nearby"]);
  assert.deepEqual(failed(complete({ arrivedAt: null, signboardPhotoAt: null })), ["arrived_on_time_nearby", "signboard_photo"]);
});

test("no-show 第 2 项：免费等待内少于 3 次联系；免等之外的联系不算", () => {
  assert.deepEqual(failed(complete({ contactAttempts: [at("2026-10-20T01:10:00Z"), at("2026-10-20T01:40:00Z")] })), ["contact_attempts"]);
  assert.deepEqual(failed(complete({ contactAttempts: [at("2026-10-20T00:55:00Z"), at("2026-10-20T01:40:00Z"), at("2026-10-20T02:20:00Z")] })), ["contact_attempts"], "落地之前打的电话不算");
});

test("no-show 第 3 项：没有举牌照片，或照片早于到达（不在上车点拍的）", () => {
  assert.deepEqual(failed(complete({ signboardPhotoAt: null })), ["signboard_photo"]);
  assert.deepEqual(failed(complete({ signboardPhotoAt: at("2026-10-20T00:40:00Z") })), ["signboard_photo"]);
});

test("no-show 第 4 项：没申请离开、免等没结束就申请、申请后还不到 10 分钟、无限免等，都不满足", () => {
  assert.deepEqual(failed(complete({ leaveRequestedAt: null })), ["leave_consented"]);
  assert.deepEqual(failed(complete({ leaveRequestedAt: at("2026-10-20T02:29:00Z") })), ["leave_consented"]);
  assert.deepEqual(failed(complete({ now: at("2026-10-20T02:40:59Z") })), ["leave_consented"]);
  assert.deepEqual(failed(complete({ now: at("2026-10-20T02:41:00Z") })), []);
  assert.deepEqual(failed(complete({ freeWait: freeWaitWindow(scheduledAt, null) })), ["leave_consented"]);
});

test("no-show 第 5 项：用车后 24 小时内提交，超过就不满足", () => {
  assert.deepEqual(failed(complete({ now: at("2026-10-21T01:00:00Z") })), []);
  assert.deepEqual(failed(complete({ now: at("2026-10-21T01:00:01Z") })), ["submitted_in_time"]);
});

test("到达定位距上车点的距离四舍五入到整米", () => {
  assert.equal(distanceToPickupMeters({ lng: 140.3887, lat: 35.7686 }, { lng: 140.3887, lat: 35.7686 }), 0);
  const meters = distanceToPickupMeters({ lng: 140.3887, lat: 35.7713 }, { lng: 140.3887, lat: 35.7686 });
  assert.ok(meters > 290 && meters < 310, String(meters));
  assert.ok(Number.isInteger(meters));
});

test("照片格式按文件开头的字节判断：JPEG、PNG、WebP、HEIC；别的（含伪装成图片的文本）都不认", () => {
  const bytes = (...values: (number | string)[]): Uint8Array => new Uint8Array(values.flatMap((value) => (typeof value === "string" ? [...value].map((ch) => ch.charCodeAt(0)) : [value])));
  assert.equal(detectEvidenceType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0)), "image/jpeg");
  assert.equal(detectEvidenceType(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, 0)), "image/png");
  assert.equal(detectEvidenceType(bytes("RIFF", 0, 0, 0, 0, "WEBPVP8 ")), "image/webp");
  assert.equal(detectEvidenceType(bytes(0, 0, 0, 24, "ftypheic", 0, 0)), "image/heic");
  assert.equal(detectEvidenceType(bytes(0, 0, 0, 24, "ftypmif1", 0, 0)), "image/heic");
  assert.equal(detectEvidenceType(bytes(0, 0, 0, 24, "ftypisom", 0, 0)), null, "MP4 视频不是图片");
  assert.equal(detectEvidenceType(bytes("<svg xmlns")), null);
  assert.equal(detectEvidenceType(bytes("GIF89a")), null);
  assert.equal(detectEvidenceType(new Uint8Array()), null);
  assert.equal(detectEvidenceType(bytes(0xff, 0xd8)), null, "太短");
  assert.equal(EVIDENCE_FILE_RULES.maxBytes, 5_242_880);
});

test("平台代传（M4-18，ADR 0052）：下一步按状态只有一个；待派车、已结束、没付款、已取消、救援中、no-show 审核中都没有下一步", () => {
  assert.equal(nextFulfilmentEvent("assigned"), "departed");
  assert.equal(nextFulfilmentEvent("departed"), "arrived");
  assert.equal(nextFulfilmentEvent("arrived"), "picked_up");
  assert.equal(nextFulfilmentEvent("in_service"), "completed");
  for (const status of ["pending_payment", "confirmed", "completed", "no_show_claimed", "no_show", "cancelled", "rescue_pending", "rescued"] as const) assert.equal(nextFulfilmentEvent(status), null, status);
});

test("平台代传：只有「已完成」要复核", () => {
  assert.deepEqual(FULFILMENT_EVENTS.filter(proxyEventNeedsReview), ["completed"]);
});

test("平台代传的发生时间：不晚于现在（不留误差）、不早于上一个节点、不早于用车前 24 小时、不早于 7 天前，边界都算合规", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const serviceAt = new Date("2026-11-10T10:00:00Z");
  const previousAt = new Date("2026-11-10T09:00:00Z");
  const issue = (occurredAt: string, over: Partial<{ previousAt: Date | null; serviceAt: Date }> = {}) => proxyFulfilmentTimeIssue({ occurredAt: new Date(occurredAt), previousAt, serviceAt, now, ...over });
  assert.equal(issue("2026-11-10T12:00:00Z"), null);
  assert.equal(issue("2026-11-10T12:00:00.001Z"), "IN_FUTURE");
  assert.equal(issue("2026-11-10T09:00:00Z"), null);
  assert.equal(issue("2026-11-10T08:59:59Z"), "BEFORE_PREVIOUS");
  const previous = new Date("2026-11-10T09:00:30Z");
  assert.equal(issue("2026-11-10T09:00:00Z", { previousAt: previous }), null, "页面只填到分钟：同一分钟不算早");
  assert.equal(proxyEffectiveOccurredAt(new Date("2026-11-10T09:00:00Z"), previous).toISOString(), previous.toISOString(), "写入时按上一个节点算，流水不倒退");
  assert.equal(proxyEffectiveOccurredAt(new Date("2026-11-10T09:01:00Z"), previous).toISOString(), "2026-11-10T09:01:00.000Z");
  assert.equal(issue("2026-11-09T10:00:00Z", { previousAt: null }), null);
  assert.equal(issue("2026-11-09T09:59:59Z", { previousAt: null }), "TOO_EARLY");
  assert.equal(issue("2026-11-03T12:00:00Z", { previousAt: null, serviceAt: new Date("2026-11-03T12:00:00Z") }), null);
  assert.equal(issue("2026-11-03T11:59:59Z", { previousAt: null, serviceAt: new Date("2026-11-03T12:00:00Z") }), "TOO_OLD");
});

test("代传的「已到达」没有定位，no-show 第 1 项不成立：把到达时间填得再早也不行（ADR 0052）", () => {
  const facts = { serviceAt: new Date("2026-11-10T10:00:00Z"), freeWait: freeWaitWindow(new Date("2026-11-10T10:00:00Z"), 60), arrivedAt: new Date("2026-11-10T09:00:00Z"), arrivalDistanceMeters: null, contactAttempts: [], signboardPhotoAt: null, leaveRequestedAt: null, now: new Date("2026-11-10T11:00:00Z") };
  assert.equal(noShowChecklist(facts).items.find((entry) => entry.item === "arrived_on_time_nearby")?.ok, false);
});
