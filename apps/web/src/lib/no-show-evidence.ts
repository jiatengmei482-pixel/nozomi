/**
 * 运营审核 no-show 时看的证据（M4-20，验收报告 M3-06 第二轮缺陷 1，ADR 0054）：把订单详情接口的数据整理成逐项的说明，缺什么写明。
 * 5 项是否满足只认提交时存下的核对结果，这里不重新判断；免费等待按提交时存下的时段，没有提交的按现在的落地时间算。
 */
import { NO_SHOW_ITEMS, NO_SHOW_ITEM_NAMES, NO_SHOW_RULES, type NoShowItem, contactsWithinFreeWait, freeWaitWindow } from "@nozomi/domain";
import type { OrderFile, OrderFileKind } from "../api/dispatch.ts";
import type { PlatformOrderDetail } from "../api/order-money.ts";
import { formatInZone, landingSourceName } from "./dispatch-display.ts";

const MINUTE = 60_000;
const HOUR = 3_600_000;

export type EvidenceSource = Pick<PlatformOrderDetail, "order" | "records" | "events">;
export type EvidenceItemState = "ok" | "failed" | "unknown";

export interface EvidenceItem {
  item: NoShowItem;
  name: string;
  state: EvidenceItemState;
  /** 这一项背后的事实；没有的写明 */
  facts: string;
}

export interface EvidenceContact {
  id: string;
  text: string;
  fileId: string | null;
  /** 没有截图的也列出来；有截图但查不到记录的 file 为 null */
  file: OrderFile | null;
}

export const EVIDENCE_STATE_MARKS: Readonly<Record<EvidenceItemState, string>> = { ok: "✓ 满足", failed: "✗ 不满足", unknown: "？没有核对记录" };
export const CLAIM_STATUS_NAMES = { pending_review: "等平台审核", approved: "审核通过", rejected: "审核驳回" } as const;

const FILE_KIND_NAMES: Readonly<Record<OrderFileKind, string>> = { arrival_screen: "到达屏", signboard: "举牌照片", contact_screenshot: "联系截图", receipt: "票据" };

export function fileKindName(kind: OrderFileKind): string {
  return FILE_KIND_NAMES[kind];
}

function windowText(start: string, end: string | null, zone: string): string {
  return end === null ? `${formatInZone(start, zone)} 起，不限时长` : `${formatInZone(start, zone)} 到 ${formatInZone(end, zone)}`;
}

/** 现在的免费等待（接机从实际落地时间起算，其他从用车时间起算，和后端同一个公式）。 */
function currentFreeWait({ order }: EvidenceSource): { start: string; end: string | null } {
  const window = freeWaitWindow(new Date(order.landing?.landed_at ?? order.service_time), order.free_wait_minutes);
  return { start: window.start.toISOString(), end: window.end?.toISOString() ?? null };
}

/** 免费等待时段：提交过 no-show 的按提交时存下的（核对结果就是按它算的）。 */
export function evidenceFreeWait(source: EvidenceSource): { start: string; end: string | null } {
  const claim = source.records.no_show_claim;
  return claim === null ? currentFreeWait(source) : { start: claim.free_wait_start, end: claim.free_wait_end };
}

export function freeWaitText(source: EvidenceSource): string {
  const { start, end } = evidenceFreeWait(source);
  const zone = source.order.timezone;
  return source.records.no_show_claim === null ? `${windowText(start, end, zone)}（按现在的落地时间算）` : `${windowText(start, end, zone)}（提交时）`;
}

/** 提交之后落地时间变了（客人后来才确认）：提交时的核对结果可能不再准确，要提醒。没变返回 null。 */
export function freeWaitChangedNote(source: EvidenceSource): string | null {
  const claim = source.records.no_show_claim;
  if (claim === null) return null;
  const current = currentFreeWait(source);
  if (new Date(current.start).getTime() === new Date(claim.free_wait_start).getTime()) return null;
  return `提交之后落地时间变了，现在的免费等待是 ${windowText(current.start, current.end, source.order.timezone)}。5 项核对结果是按提交那一刻算的，判定时请留意。`;
}

function arrivalProxied({ events }: EvidenceSource): boolean {
  return events.findLast((event) => event.to_status === "arrived")?.source === "platform_proxy";
}

export function arrivalText(source: EvidenceSource): string {
  const { fulfilment, timezone } = source.order;
  if (fulfilment.arrived_at === null) return "司机没有点「已到达」";
  const at = formatInZone(fulfilment.arrived_at, timezone);
  if (fulfilment.arrival_distance_m === null) return `${at}，${arrivalProxied(source) ? "平台代传，没有定位" : "没有定位"}`;
  return `${at}，距上车点 ${fulfilment.arrival_distance_m} 米${fulfilment.arrival_within_range ? "" : `（超过 ${NO_SHOW_RULES.maxArrivalDistanceMeters} 米）`}`;
}

export function landingText({ order }: EvidenceSource): string {
  const { landing, timezone } = order;
  if (landing === null) return "这一单不是接机，不记落地时间";
  if (landing.source === "scheduled") return `${formatInZone(landing.landed_at, timezone)}（客人和司机都没有报，按计划到达时间算）`;
  return `${formatInZone(landing.landed_at, timezone)}（来源：${landingSourceName(landing.source)}）${landing.disagreement ? "；客人和司机报的不一致，取较晚的" : ""}`;
}

function photosOf(source: EvidenceSource, kinds: readonly OrderFileKind[]): OrderFile[] {
  return source.records.files.filter((file) => kinds.includes(file.kind));
}

function contactCount(source: EvidenceSource): { total: number; within: number } {
  const { start, end } = evidenceFreeWait(source);
  const attempts = source.records.contacts.map((contact) => new Date(contact.occurred_at));
  return { total: attempts.length, within: contactsWithinFreeWait({ start: new Date(start), end: end === null ? null : new Date(end) }, attempts) };
}

function itemFacts(source: EvidenceSource, item: NoShowItem): string {
  const { order, records } = source;
  const zone = order.timezone;
  switch (item) {
    case "arrived_on_time_nearby":
      return `到达：${arrivalText(source)}；免费等待 ${formatInZone(evidenceFreeWait(source).start, zone)} 开始`;
    case "contact_attempts": {
      const { total, within } = contactCount(source);
      return total === 0 ? "没有联系记录" : `共 ${total} 次，免费等待内 ${within} 次（至少要 ${NO_SHOW_RULES.minContactAttempts} 次）`;
    }
    case "signboard_photo": {
      const photos = photosOf(source, ["signboard"]);
      const latest = photos.at(-1);
      return latest === undefined ? "没有举牌照片" : `${photos.length} 张，最新一张的系统时间 ${formatInZone(latest.uploaded_at, zone)}`;
    }
    case "leave_consented": {
      const at = order.fulfilment.leave_requested_at;
      if (at === null) return "司机没有点「申请离开」";
      return `申请离开 ${formatInZone(at, zone)}，${NO_SHOW_RULES.leaveConsentMinutes} 分钟后（${formatInZone(new Date(new Date(at).getTime() + NO_SHOW_RULES.leaveConsentMinutes * MINUTE).toISOString(), zone)}）没人反对视为同意`;
    }
    case "submitted_in_time": {
      const due = formatInZone(new Date(new Date(order.service_time).getTime() + NO_SHOW_RULES.submitWithinHours * HOUR).toISOString(), zone);
      return records.no_show_claim === null ? `还没有提交，期限 ${due}` : `提交 ${formatInZone(records.no_show_claim.submitted_at, zone)}，期限 ${due}`;
    }
  }
}

/** 5 项逐条列出（固定顺序、一项不少）：提交时的核对结果里没有的写「没有核对记录」，不当作满足。 */
export function evidenceItems(source: EvidenceSource): EvidenceItem[] {
  const checklist = source.records.no_show_claim?.checklist ?? [];
  return NO_SHOW_ITEMS.map((item) => {
    const found = checklist.find((entry) => entry.item === item);
    return { item, name: NO_SHOW_ITEM_NAMES[item], state: found === undefined ? "unknown" : found.ok ? "ok" : "failed", facts: itemFacts(source, item) };
  });
}

export function evidenceContacts(source: EvidenceSource): EvidenceContact[] {
  const zone = source.order.timezone;
  const { start, end } = evidenceFreeWait(source);
  const window = { start: new Date(start), end: end === null ? null : new Date(end) };
  return source.records.contacts.map((contact) => {
    const within = contactsWithinFreeWait(window, [new Date(contact.occurred_at)]) === 1;
    const text = `${formatInZone(contact.occurred_at, zone)} ${contact.method === "phone" ? "打电话" : "即时通讯"}${within ? "" : "（不在免费等待内）"}${contact.note ? `：${contact.note}` : ""}`;
    return { id: contact.id, text, fileId: contact.file_id, file: source.records.files.find((file) => file.id === contact.file_id) ?? null };
  });
}

/** 打开页面就显示的照片：举牌、到达屏，判定要用。 */
export function reviewPhotos(source: EvidenceSource): OrderFile[] {
  return photosOf(source, ["signboard", "arrival_screen"]);
}

/** 联系记录没有挂上的截图和票据：可能带着客人的联系方式，点了才取。 */
export function otherPhotos(source: EvidenceSource): OrderFile[] {
  const attached = new Set(source.records.contacts.map((contact) => contact.file_id));
  return photosOf(source, ["contact_screenshot", "receipt"]).filter((file) => !attached.has(file.id));
}

/** 同一种照片有好几张时的序号（按上传顺序），只有一张的没有序号。按钮和链接的名字要分得清。 */
export function photoOrdinals(files: readonly OrderFile[]): ReadonlyMap<string, number> {
  const seen = new Map<OrderFileKind, number>();
  const result = new Map<string, number>();
  for (const file of files) {
    const next = (seen.get(file.kind) ?? 0) + 1;
    seen.set(file.kind, next);
    if (next > 1 || files.filter((other) => other.kind === file.kind).length > 1) result.set(file.id, next);
  }
  return result;
}

export function hasEvidence({ records, order }: EvidenceSource): boolean {
  return records.no_show_claim !== null || records.files.length > 0 || records.contacts.length > 0 || records.locations.length > 0 || order.fulfilment.arrived_at !== null;
}
