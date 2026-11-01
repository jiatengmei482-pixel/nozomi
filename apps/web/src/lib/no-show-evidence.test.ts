import assert from "node:assert/strict";
import { test } from "node:test";
import type { EvidenceSource } from "./no-show-evidence.ts";
import { arrivalText, evidenceContacts, evidenceItems, freeWaitChangedNote, freeWaitText, hasEvidence, landingText, otherPhotos, reviewPhotos } from "./no-show-evidence.ts";

const landing = { scheduled_at: "2026-10-20T01:00:00.000Z", guest_reported_at: "2026-10-20T01:30:00.000Z", driver_reported_at: null, driver_photo_file_id: null, landed_at: "2026-10-20T01:30:00.000Z", source: "guest", disagreement: false, delay_minutes: 30, within_delay_allowance: true };
const fulfilment = { departed_at: null, arrived_at: "2026-10-20T01:10:00.000Z", arrival_distance_m: 120, arrival_within_range: true, picked_up_at: null, completed_at: null, actual_minutes: null, actual_km: null, leave_requested_at: "2026-10-20T03:00:00.000Z" };
const file = (id: string, kind: string, uploaded_at = "2026-10-20T01:40:00.000Z") => ({ id, kind, content_type: "image/jpeg", byte_size: 10, uploaded_at });
const claim = { status: "pending_review", submitted_at: "2026-10-20T03:20:00.000Z", free_wait_start: "2026-10-20T01:30:00.000Z", free_wait_end: "2026-10-20T03:00:00.000Z", checklist: [{ item: "arrived_on_time_nearby", ok: true }, { item: "contact_attempts", ok: false }, { item: "signboard_photo", ok: true }, { item: "leave_consented", ok: true }] };
const records = { assignments: [], driver_link: null, files: [], contacts: [], locations: [], no_show_claim: null };
const source = (order: object = {}, more: object = {}): EvidenceSource => ({ events: [], order: { timezone: "Asia/Tokyo", service_time: "2026-10-20T01:00:00.000Z", free_wait_minutes: 90, landing, fulfilment, ...order }, records: { ...records, ...more } }) as unknown as EvidenceSource;

test("5 项固定顺序、一项不少：核对结果里没有的不算满足；事实写在每一项下面", () => {
  const items = evidenceItems(source({}, { no_show_claim: claim, files: [file("s1", "signboard")], contacts: [{ id: "c1", method: "phone", note: null, file_id: null, occurred_at: "2026-10-20T01:40:00.000Z" }, { id: "c2", method: "phone", note: null, file_id: null, occurred_at: "2026-10-20T00:40:00.000Z" }] }));
  assert.deepEqual(items.map((entry) => entry.state), ["ok", "failed", "ok", "ok", "unknown"]);
  assert.match(items[0]?.facts ?? "", /距上车点 120 米/);
  assert.match(items[1]?.facts ?? "", /共 2 次，免费等待内 1 次（至少要 3 次）/);
  assert.match(items[2]?.facts ?? "", /1 张，最新一张的系统时间 2026-10-20 10:40/);
  assert.match(items[3]?.facts ?? "", /申请离开 2026-10-20 12:00，10 分钟后（2026-10-20 12:10）/);
  assert.match(items[4]?.facts ?? "", /提交 2026-10-20 12:20，期限 2026-10-21 10:00/);
});

test("缺项写明", () => {
  const items = evidenceItems(source({ fulfilment: { ...fulfilment, arrived_at: null, arrival_distance_m: null, leave_requested_at: null } }, { no_show_claim: { ...claim, checklist: [] } }));
  assert.ok(items.every((entry) => entry.state === "unknown"));
  assert.match(items[0]?.facts ?? "", /司机没有点「已到达」/);
  assert.equal(items[1]?.facts, "没有联系记录");
  assert.equal(items[2]?.facts, "没有举牌照片");
  assert.equal(items[3]?.facts, "司机没有点「申请离开」");
  assert.match(arrivalText(source({ fulfilment: { ...fulfilment, arrived_at: null } })), /没有点/);
  assert.match(arrivalText(source({ fulfilment: { ...fulfilment, arrival_distance_m: null, arrival_within_range: null } })), /，没有定位$/);
  assert.match(arrivalText({ ...source({ fulfilment: { ...fulfilment, arrival_distance_m: null, arrival_within_range: null } }), events: [{ to_status: "arrived", source: "platform_proxy" }] } as unknown as EvidenceSource), /平台代传，没有定位/);
  assert.match(arrivalText(source({ fulfilment: { ...fulfilment, arrival_distance_m: 500, arrival_within_range: false } })), /500 米（超过 300 米）/);
  assert.equal(landingText(source({ landing: null })), "这一单不是接机，不记落地时间");
  assert.match(landingText(source({ landing: { ...landing, source: "scheduled", landed_at: landing.scheduled_at } })), /都没有报，按计划到达时间算/);
  assert.match(landingText(source()), /2026-10-20 10:30（来源：客人确认/);
  assert.equal(hasEvidence(source({ fulfilment: { ...fulfilment, arrived_at: null } })), false);
  assert.equal(hasEvidence(source()), true);
});

test("免费等待：提交过的按提交时存下的时段；提交后落地时间变了要提醒；没提交的按现在的落地时间；不限时长写明", () => {
  assert.equal(freeWaitText(source({}, { no_show_claim: claim })), "2026-10-20 10:30 到 2026-10-20 12:00（提交时）");
  assert.equal(freeWaitChangedNote(source({}, { no_show_claim: claim })), null);
  assert.match(freeWaitChangedNote(source({ landing: { ...landing, landed_at: "2026-10-20T02:00:00.000Z" } }, { no_show_claim: claim })) ?? "", /现在的免费等待是 2026-10-20 11:00 到 2026-10-20 12:30/);
  assert.equal(freeWaitText(source()), "2026-10-20 10:30 到 2026-10-20 12:00（按现在的落地时间算）");
  assert.equal(freeWaitText(source({ landing: null })), "2026-10-20 10:00 到 2026-10-20 11:30（按用车时间算）");
  assert.equal(freeWaitText(source({ free_wait_minutes: null })), "2026-10-20 10:30 起，不限时长（按现在的落地时间算）");
  assert.equal(freeWaitChangedNote(source()), null);
});

test("联系记录标出不在免费等待内的、挂上截图；挂上的截图不重复列在照片里；票据归到点了才取的那一组", () => {
  const more = { no_show_claim: claim, files: [file("a", "arrival_screen"), file("s", "signboard"), file("shot", "contact_screenshot"), file("loose", "contact_screenshot"), file("r", "receipt")], contacts: [{ id: "c1", method: "messaging", note: "LINE 已读不回", file_id: "shot", occurred_at: "2026-10-20T01:40:00.000Z" }, { id: "c2", method: "phone", note: null, file_id: null, occurred_at: "2026-10-20T04:00:00.000Z" }] };
  const contacts = evidenceContacts(source({}, more));
  assert.equal(contacts[0]?.text, "2026-10-20 10:40 即时通讯：LINE 已读不回");
  assert.equal(contacts[0]?.file?.id, "shot");
  assert.equal(contacts[1]?.text, "2026-10-20 13:00 打电话（不在免费等待内）");
  assert.equal(contacts[1]?.file, null);
  assert.deepEqual(reviewPhotos(source({}, more)).map((f) => f.id), ["a", "s"]);
  assert.deepEqual(otherPhotos(source({}, more)).map((f) => f.id), ["loose", "r"]);
});
