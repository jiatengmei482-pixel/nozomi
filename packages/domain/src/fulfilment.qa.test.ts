/**
 * QA（M3-02）：落地时间的取证规则、no-show 的 5 项证据、照片格式判断，和按 ADR 0027 / 第五轮决策 ③ 独立写的参考实现逐一比对（随机用例 + 边界）。
 * 参考实现只照需求原文写，不看被测代码的写法。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectEvidenceType, effectiveLanding, freeWaitWindow, landingReportIssue, noShowChecklist } from "./fulfilment.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;

/** 可重复的伪随机数（不用 Math.random：失败时能复现）。 */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

// ---- 参考实现：落地时间 ----

function landingOracle(scheduled: number, guest: number | null, driver: { at: number; photo: boolean } | null): { at: number; source: string } {
  const d = driver !== null && driver.photo ? driver.at : null; // 规则 1：没有到达屏照片的司机时间不算数
  if (guest !== null && d !== null) return d > guest ? { at: d, source: "driver" } : { at: guest, source: "guest" }; // 规则 2：取较晚，一样时记客人
  if (guest !== null) return { at: guest, source: "guest" }; // 规则 3
  if (d !== null) return { at: d, source: "driver" };
  return { at: scheduled, source: "scheduled" }; // 规则 4
}

test("落地时间：2000 组随机的客人 / 司机 / 照片组合，和参考实现的取值、来源、是否不一致、延误分钟数完全一致", () => {
  const random = rng(20261025);
  const scheduled = Date.UTC(2026, 9, 31, 15, 0);
  for (let i = 0; i < 2_000; i += 1) {
    const offset = (): number => Math.round((random() * 12 - 3) * 60) * MIN;
    const guest = random() < 0.6 ? scheduled + offset() : null;
    const driver = random() < 0.6 ? { at: scheduled + offset(), photo: random() < 0.7 } : null;
    if (guest !== null && driver !== null && random() < 0.1) driver.at = guest;
    const expected = landingOracle(scheduled, guest, driver);
    const actual = effectiveLanding({ scheduledAt: new Date(scheduled), guestReportedAt: guest === null ? null : new Date(guest), driver: driver === null ? null : { landedAt: new Date(driver.at), arrivalScreenPhoto: driver.photo } });
    const label = JSON.stringify({ guest, driver });
    assert.equal(actual.landedAt.getTime(), expected.at, label);
    assert.equal(actual.source, expected.source, label);
    const validDriver = driver !== null && driver.photo ? driver.at : null;
    assert.equal(actual.disagreement, guest !== null && validDriver !== null && guest !== validDriver, label);
    assert.equal(actual.delayMinutes, Math.max(0, Math.round((expected.at - scheduled) / MIN)), label);
    assert.equal(actual.withinDelayAllowance, expected.at - scheduled <= 6 * HOUR, label);
  }
});

test("落地时间：司机没附照片时，即使比客人晚也不采用；客人没报时退回计划时间", () => {
  const scheduled = new Date("2026-10-31T15:00:00Z");
  const late = new Date("2026-10-31T19:00:00Z");
  assert.equal(effectiveLanding({ scheduledAt: scheduled, guestReportedAt: new Date("2026-10-31T15:30:00Z"), driver: { landedAt: late, arrivalScreenPhoto: false } }).source, "guest");
  const none = effectiveLanding({ scheduledAt: scheduled, guestReportedAt: null, driver: { landedAt: late, arrivalScreenPhoto: false } });
  assert.deepEqual([none.source, none.landedAt.getTime(), none.disagreement], ["scheduled", scheduled.getTime(), false]);
});

test("落地时间 · 6 小时顺延：恰好 6 小时在范围内，6 小时 1 分钟不在", () => {
  const scheduled = new Date("2026-10-31T15:00:00Z");
  const exactly = effectiveLanding({ scheduledAt: scheduled, guestReportedAt: new Date(scheduled.getTime() + 6 * HOUR), driver: null });
  assert.deepEqual([exactly.delayMinutes, exactly.withinDelayAllowance], [360, true]);
  const over = effectiveLanding({ scheduledAt: scheduled, guestReportedAt: new Date(scheduled.getTime() + 6 * HOUR + MIN), driver: null });
  assert.deepEqual([over.delayMinutes, over.withinDelayAllowance], [361, false]);
});

test("落地时间 · 6 小时顺延按毫秒比较：延误 6 小时 0 分 30 秒不在范围内（delayMinutes 只用于显示）", () => {
  const scheduled = new Date("2026-10-31T15:00:00Z");
  // 客人「我已落地」用的是系统收到的时间，精确到毫秒，超出 6 小时几十秒的情况是会出现的
  const result = effectiveLanding({ scheduledAt: scheduled, guestReportedAt: new Date(scheduled.getTime() + 6 * HOUR + 30_000), driver: null });
  assert.equal(result.withinDelayAllowance, false, "超过 6 小时（哪怕 30 秒）就不在顺延范围内");
});

test("报的落地时间：恰好「现在 + 5 分钟」可以、多 1 毫秒不行；恰好「计划 − 3 小时」可以、早 1 毫秒不行", () => {
  const now = new Date("2026-10-31T16:00:00Z");
  const scheduled = new Date("2026-10-31T15:00:00Z");
  assert.equal(landingReportIssue(new Date(now.getTime() + 5 * MIN), scheduled, now), null);
  assert.equal(landingReportIssue(new Date(now.getTime() + 5 * MIN + 1), scheduled, now), "IN_FUTURE");
  assert.equal(landingReportIssue(new Date(scheduled.getTime() - 3 * HOUR), scheduled, now), null);
  assert.equal(landingReportIssue(new Date(scheduled.getTime() - 3 * HOUR - 1), scheduled, now), "TOO_EARLY");
});

test("报的落地时间：跨午夜、跨月（计划 10/31 23:30 UTC，报 11/01 00:10）照常算", () => {
  const scheduled = new Date("2026-10-31T23:30:00Z");
  const now = new Date("2026-11-01T00:20:00Z");
  const reported = new Date("2026-11-01T00:10:00Z");
  assert.equal(landingReportIssue(reported, scheduled, now), null);
  const result = effectiveLanding({ scheduledAt: scheduled, guestReportedAt: null, driver: { landedAt: reported, arrivalScreenPhoto: true } });
  assert.deepEqual([result.delayMinutes, result.source], [40, "driver"]);
});

// ---- 参考实现：no-show 的 5 项证据 ----

interface Facts {
  service: number;
  fwStart: number;
  fwMinutes: number | null;
  arrived: number | null;
  distance: number | null;
  contacts: number[];
  signboard: number | null;
  leave: number | null;
  now: number;
}

function noShowOracle(f: Facts): Record<string, boolean> {
  const fwEnd = f.fwMinutes === null ? null : f.fwStart + f.fwMinutes * MIN;
  return {
    arrived_on_time_nearby: f.arrived !== null && f.arrived <= f.fwStart && f.distance !== null && f.distance <= 300,
    contact_attempts: f.contacts.filter((c) => c >= f.fwStart && (fwEnd === null || c <= fwEnd)).length >= 3,
    signboard_photo: f.signboard !== null && f.arrived !== null && f.signboard >= f.arrived,
    leave_consented: f.leave !== null && fwEnd !== null && f.leave >= fwEnd && f.now >= f.leave + 10 * MIN,
    submitted_in_time: f.now <= f.service + 24 * HOUR,
  };
}

test("no-show：3000 组随机事实，5 项逐项和参考实现一致；complete 当且仅当 5 项都满足", () => {
  const random = rng(4242);
  const service = Date.UTC(2026, 10, 1, 0, 0);
  const minutes = (lo: number, hi: number): number => Math.round(lo + random() * (hi - lo)) * MIN;
  for (let i = 0; i < 3_000; i += 1) {
    const fwStart = service + minutes(-30, 180);
    const fwMinutes = random() < 0.1 ? null : [0, 30, 60, 90][Math.floor(random() * 4)] as number;
    const facts: Facts = {
      service,
      fwStart,
      fwMinutes,
      arrived: random() < 0.85 ? fwStart + minutes(-60, 20) : null,
      distance: random() < 0.85 ? Math.round(random() * 600) : null,
      contacts: Array.from({ length: Math.floor(random() * 6) }, () => fwStart + minutes(-20, (fwMinutes ?? 120) + 20)),
      signboard: random() < 0.85 ? fwStart + minutes(-70, 60) : null,
      leave: random() < 0.8 ? fwStart + minutes(0, (fwMinutes ?? 120) + 30) : null,
      now: fwStart + minutes(0, 26 * 60),
    };
    const expected = noShowOracle(facts);
    const actual = noShowChecklist({
      serviceAt: new Date(facts.service),
      freeWait: freeWaitWindow(new Date(facts.fwStart), facts.fwMinutes),
      arrivedAt: facts.arrived === null ? null : new Date(facts.arrived),
      arrivalDistanceMeters: facts.distance,
      contactAttempts: facts.contacts.map((c) => new Date(c)),
      signboardPhotoAt: facts.signboard === null ? null : new Date(facts.signboard),
      leaveRequestedAt: facts.leave === null ? null : new Date(facts.leave),
      now: new Date(facts.now),
    });
    const label = JSON.stringify(facts);
    assert.deepEqual(Object.fromEntries(actual.items.map((entry) => [entry.item, entry.ok])), expected, label);
    assert.equal(actual.complete, Object.values(expected).every(Boolean), label);
  }
});

test("no-show 边界：到达恰好在免等开始那一刻、距离恰好 300 米、第 3 次联系恰好在免等结束那一刻、申请离开后恰好 10 分钟、恰好用车后 24 小时——都算满足；各差 1 毫秒 / 1 米都不满足", () => {
  const service = new Date("2026-11-01T00:00:00Z");
  const fw = freeWaitWindow(service, 60);
  const end = (fw.end as Date).getTime();
  const base = {
    serviceAt: service,
    freeWait: fw,
    arrivedAt: service,
    arrivalDistanceMeters: 300,
    contactAttempts: [service, new Date(service.getTime() + 30 * MIN), new Date(end)],
    signboardPhotoAt: service,
    leaveRequestedAt: new Date(end),
    now: new Date(service.getTime() + 24 * HOUR),
  };
  assert.equal(noShowChecklist(base).complete, true, JSON.stringify(noShowChecklist(base).items));
  const missing = (facts: typeof base): string[] => noShowChecklist(facts).items.filter((entry) => !entry.ok).map((entry) => entry.item);
  assert.deepEqual(missing({ ...base, arrivedAt: new Date(service.getTime() + 1) }), ["arrived_on_time_nearby", "signboard_photo"]);
  assert.deepEqual(missing({ ...base, arrivalDistanceMeters: 301 }), ["arrived_on_time_nearby"]);
  assert.deepEqual(missing({ ...base, contactAttempts: [service, new Date(service.getTime() + 30 * MIN), new Date(end + 1)] }), ["contact_attempts"]);
  assert.deepEqual(missing({ ...base, leaveRequestedAt: new Date(end - 1) }), ["leave_consented"]);
  assert.deepEqual(missing({ ...base, now: new Date(service.getTime() + 24 * HOUR + 1) }), ["submitted_in_time"]);
  assert.deepEqual(missing({ ...base, leaveRequestedAt: new Date(end + 1), now: new Date(end + 10 * MIN) }), ["leave_consented"], "申请离开后不足 10 分钟");
});

test("no-show：无限免等永远不能满足第 4 项；同一时刻重复记的联系也照次数算，免等之前的联系不算", () => {
  const service = new Date("2026-11-01T00:00:00Z");
  const unlimited = noShowChecklist({
    serviceAt: service,
    freeWait: freeWaitWindow(service, null),
    arrivedAt: service,
    arrivalDistanceMeters: 10,
    contactAttempts: [service, service, service],
    signboardPhotoAt: service,
    leaveRequestedAt: new Date(service.getTime() + 5 * HOUR),
    now: new Date(service.getTime() + 6 * HOUR),
  });
  assert.deepEqual(unlimited.items.filter((entry) => !entry.ok).map((entry) => entry.item), ["leave_consented"]);
  const early = noShowChecklist({
    serviceAt: service,
    freeWait: freeWaitWindow(service, 60),
    arrivedAt: new Date(service.getTime() - 30 * MIN),
    arrivalDistanceMeters: 10,
    contactAttempts: [new Date(service.getTime() - 20 * MIN), new Date(service.getTime() - 10 * MIN), service],
    signboardPhotoAt: service,
    leaveRequestedAt: new Date(service.getTime() + 60 * MIN),
    now: new Date(service.getTime() + 70 * MIN),
  });
  assert.equal(early.items.find((entry) => entry.item === "contact_attempts")?.ok, false);
});

// ---- 照片格式 ----

test("照片格式：SVG、HTML、XML、GIF、PDF、BMP、TIFF、AVIF、WAV（RIFF 但不是 WEBP）、只有两字节的 JPEG 头、空文件都不认", () => {
  const cases: Record<string, Buffer> = {
    svg: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'),
    svgWithBom: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("<svg/>")]),
    html: Buffer.from("<!doctype html><script>alert(1)</script>"),
    xml: Buffer.from('<?xml version="1.0"?><svg/>'),
    gif: Buffer.from("GIF89a\x01\x00\x01\x00", "latin1"),
    pdf: Buffer.from("%PDF-1.7\n"),
    bmp: Buffer.from("BM\x00\x00\x00\x00\x00\x00", "latin1"),
    tiff: Buffer.from([0x49, 0x49, 0x2a, 0x00, 0, 0, 0, 0]),
    avif: Buffer.concat([Buffer.from([0, 0, 0, 0x1c]), Buffer.from("ftypavif"), Buffer.alloc(8)]),
    wav: Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVEfmt ")]),
    shortJpeg: Buffer.from([0xff, 0xd8]),
    shortPng: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    empty: Buffer.alloc(0),
    ftypAtWrongOffset: Buffer.concat([Buffer.from("ftypheic"), Buffer.alloc(8)]),
  };
  for (const [name, bytes] of Object.entries(cases)) assert.equal(detectEvidenceType(bytes), null, name);
});

test("照片格式：四种认的格式按字节认出来，HEIC 的几个常见品牌都认", () => {
  assert.equal(detectEvidenceType(Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0, 0])), "image/jpeg");
  assert.equal(detectEvidenceType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "image/png");
  assert.equal(detectEvidenceType(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")])), "image/webp");
  for (const brand of ["heic", "heix", "mif1"]) assert.equal(detectEvidenceType(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from(`ftyp${brand}`), Buffer.alloc(8)])), "image/heic", brand);
});
