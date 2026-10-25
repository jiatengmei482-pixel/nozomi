/**
 * 履约：实际落地时间的取证规则、免费等待、客人未出现（no-show）的 5 项证据（M3-02，ADR 0027）。纯函数，不碰数据库和网络。
 *
 * 需求：《用车报价服务平台》「8. 订单与履约」的「落地时间」（取客人「我已落地」的时间；没有则取司机在 H5 填写的时间，填写时必须拍到达屏；
 * 都没有则取计划到达时间。客人和司机不一致时取较晚者；提交后不能改。航班延误 6 小时内顺延且不加收费用）、「客人未出现」；
 * 《平台运营端与渠道对接》「航班信息」「免费等待与 no-show」（no-show 成立必须同时满足 5 项）、「航班延误与取消」；第五轮决策 ③。
 */
import { detectFileTypeAmong } from "./files.ts";
import { haversineMeters } from "./geo.ts";

const MINUTE = 60_000;
const HOUR = 3_600_000;

// ---- 实际落地时间 ----

export const LANDING_RULES = {
  /** 计划到达后多少小时内的延误：租户必须顺延接机且不加收费用；超过则客人可免费改期或全额退款（M3-03） */
  delayAllowanceHours: 6,
  /** 报的落地时间最早可以比计划到达早多少小时（航班提前到达）；再早就是填错了 */
  earliestHoursBeforeScheduled: 3,
  /** 报的落地时间最多可以比提交时晚多少分钟（手机时钟的误差）；再晚就是还没落地 */
  futureToleranceMinutes: 5,
} as const;

/** 实际落地时间从哪里来：客人点「我已落地」/ 司机在 H5 填写（带到达屏照片）/ 计划到达时间。 */
export const LANDING_SOURCES = ["guest", "driver", "scheduled"] as const;
export type LandingSource = (typeof LANDING_SOURCES)[number];

export const LANDING_SOURCE_NAMES: Readonly<Record<LandingSource, string>> = {
  guest: "客人确认「我已落地」",
  driver: "司机填写（附到达屏照片）",
  scheduled: "计划到达时间",
};

export interface LandingInputs {
  /** 计划到达时间：接机单的用车时间（下单时按航班的计划到达时间填写） */
  scheduledAt: Date;
  /** 客人点「我已落地」的时间（系统记录），没有为 null */
  guestReportedAt: Date | null;
  /** 司机在 H5 填写的落地时间，和有没有拍到达屏照片；没有填写为 null */
  driver: { landedAt: Date; arrivalScreenPhoto: boolean } | null;
}

export interface LandingResult {
  landedAt: Date;
  source: LandingSource;
  /** 客人和司机都有记录且不一致（取了较晚的那个） */
  disagreement: boolean;
  /** 比计划晚了多少分钟（提前到达为 0） */
  delayMinutes: number;
  /** 延误在 6 小时以内：租户必须顺延接机且不加收费用 */
  withinDelayAllowance: boolean;
}

/**
 * 实际落地时间（逐条对应需求）：
 * 1. 司机填写的时间只有附了到达屏照片才算数（「填写时必须拍到达屏」）；
 * 2. 客人和司机都有：取较晚者（「不一致时取较晚者」），一样时记为客人确认；
 * 3. 只有客人的：取客人的（「客人确认优先」）；只有司机的（带照片）：取司机的；
 * 4. 都没有：取计划到达时间。
 */
export function effectiveLanding(inputs: LandingInputs): LandingResult {
  const guest = inputs.guestReportedAt;
  const driver = inputs.driver !== null && inputs.driver.arrivalScreenPhoto ? inputs.driver.landedAt : null;
  let landedAt: Date;
  let source: LandingSource;
  if (guest !== null && driver !== null) {
    const driverLater = driver.getTime() > guest.getTime();
    landedAt = driverLater ? driver : guest;
    source = driverLater ? "driver" : "guest";
  } else if (guest !== null) {
    landedAt = guest;
    source = "guest";
  } else if (driver !== null) {
    landedAt = driver;
    source = "driver";
  } else {
    landedAt = inputs.scheduledAt;
    source = "scheduled";
  }
  const delayMs = landedAt.getTime() - inputs.scheduledAt.getTime();
  const delayMinutes = Math.max(0, Math.floor(delayMs / MINUTE));
  return {
    landedAt,
    source,
    disagreement: guest !== null && driver !== null && guest.getTime() !== driver.getTime(),
    delayMinutes,
    withinDelayAllowance: delayMs <= LANDING_RULES.delayAllowanceHours * 60 * MINUTE,
  };
}

export type LandingReportIssue = "IN_FUTURE" | "TOO_EARLY";

/** 报上来的落地时间合不合理：不能晚于现在（留 5 分钟误差），不能比计划到达早 3 小时以上。合理返回 null。 */
export function landingReportIssue(reportedAt: Date, scheduledAt: Date, now: Date): LandingReportIssue | null {
  if (reportedAt.getTime() > now.getTime() + LANDING_RULES.futureToleranceMinutes * MINUTE) return "IN_FUTURE";
  if (reportedAt.getTime() < scheduledAt.getTime() - LANDING_RULES.earliestHoursBeforeScheduled * HOUR) return "TOO_EARLY";
  return null;
}

/** 只有接机（从机场接人）的单记落地时间；送机、接站、点对点、包车都不记。 */
export function landingApplies(trip: { category: string; direction: string | null; placeType: string | null }): boolean {
  return trip.category === "airport_transfer" && trip.direction === "pickup" && trip.placeType === "airport";
}

// ---- 免费等待 ----

export interface FreeWaitWindow {
  start: Date;
  /** 无限免等（商品设为「无限」）时为 null */
  end: Date | null;
}

/**
 * 免费等待从什么时候开始、到什么时候结束：接机从实际落地时间起算；其他（接站、送机、点对点、包车）从约定的用车时间起算
 * （需求「免费等待与 no-show」的起算时间表；接站按列车计划到达时间，也就是用车时间）。`minutes` 为 null 表示无限免等。
 */
export function freeWaitWindow(startsAt: Date, minutes: number | null): FreeWaitWindow {
  return { start: startsAt, end: minutes === null ? null : new Date(startsAt.getTime() + minutes * MINUTE) };
}

// ---- 客人未出现（no-show） ----

export const NO_SHOW_RULES = {
  /** 「已到达」时的定位距上车点最多多少米 */
  maxArrivalDistanceMeters: 300,
  /** 免费等待内至少几次联系记录 */
  minContactAttempts: 3,
  /** 司机点「申请离开」后，客服多少分钟内没处理视为同意 */
  leaveConsentMinutes: 10,
  /** 用车后多少小时内提交 */
  submitWithinHours: 24,
} as const;

export const NO_SHOW_ITEMS = ["arrived_on_time_nearby", "contact_attempts", "signboard_photo", "leave_consented", "submitted_in_time"] as const;
export type NoShowItem = (typeof NO_SHOW_ITEMS)[number];

export const NO_SHOW_ITEM_NAMES: Readonly<Record<NoShowItem, string>> = {
  arrived_on_time_nearby: "免费等待开始前点了「已到达」，定位距上车点 ≤ 300 米",
  contact_attempts: "免费等待内至少 3 次联系客人的记录",
  signboard_photo: "在上车点举牌的照片（带系统时间）",
  leave_consented: "点了「申请离开」，客服 10 分钟内没有反对",
  submitted_in_time: "用车后 24 小时内提交",
};

export interface NoShowFacts {
  serviceAt: Date;
  freeWait: FreeWaitWindow;
  /** 点「已到达」的时间（系统记录） */
  arrivedAt: Date | null;
  /** 「已到达」时的定位距上车点的距离（米）；没有定位为 null */
  arrivalDistanceMeters: number | null;
  /** 每次联系客人的时间（系统记录） */
  contactAttempts: readonly Date[];
  /** 举牌照片上传的时间（系统记录，即照片上的系统时间） */
  signboardPhotoAt: Date | null;
  /** 点「申请离开」的时间 */
  leaveRequestedAt: Date | null;
  now: Date;
}

export interface NoShowChecklistItem {
  item: NoShowItem;
  ok: boolean;
}

export interface NoShowChecklist {
  items: NoShowChecklistItem[];
  /** 5 项都满足，可以提交 */
  complete: boolean;
  /** 申请离开后，客服不处理即视为同意的时间点；还没申请为 null */
  leaveConsentAt: Date | null;
}

/** 联系记录里落在免费等待之内的次数。 */
export function contactsWithinFreeWait(window: FreeWaitWindow, attempts: readonly Date[]): number {
  return attempts.filter((at) => at.getTime() >= window.start.getTime() && (window.end === null || at.getTime() <= window.end.getTime())).length;
}

/** 免费等待结束了没有（结束后才能申请离开）。无限免等永远不结束。 */
export function freeWaitEnded(window: FreeWaitWindow, now: Date): boolean {
  return window.end !== null && now.getTime() >= window.end.getTime();
}

/**
 * no-show 的 5 项证据（需求「no-show 成立必须同时满足」），逐项判断：
 * 1. 免费等待开始前（含那一刻）点了「已到达」，且当时的定位距上车点 ≤ 300 米；
 * 2. 免费等待内至少 3 次联系记录；
 * 3. 到达之后在上车点拍的举牌照片（照片的时间是系统收到的时间，不认手机时钟）；
 * 4. 免费等待结束后点了「申请离开」，并且已经过了 10 分钟（客服没处理视为同意；客服反对的流程在 M4-02）；
 * 5. 在用车后 24 小时内提交。
 */
export function noShowChecklist(facts: NoShowFacts): NoShowChecklist {
  const { freeWait, now } = facts;
  const arrivedOnTime =
    facts.arrivedAt !== null &&
    facts.arrivedAt.getTime() <= freeWait.start.getTime() &&
    facts.arrivalDistanceMeters !== null &&
    facts.arrivalDistanceMeters <= NO_SHOW_RULES.maxArrivalDistanceMeters;
  const contacts = contactsWithinFreeWait(freeWait, facts.contactAttempts) >= NO_SHOW_RULES.minContactAttempts;
  const photo = facts.signboardPhotoAt !== null && facts.arrivedAt !== null && facts.signboardPhotoAt.getTime() >= facts.arrivedAt.getTime();
  const leaveConsentAt = facts.leaveRequestedAt === null ? null : new Date(facts.leaveRequestedAt.getTime() + NO_SHOW_RULES.leaveConsentMinutes * MINUTE);
  const leave =
    facts.leaveRequestedAt !== null &&
    freeWait.end !== null &&
    facts.leaveRequestedAt.getTime() >= freeWait.end.getTime() &&
    leaveConsentAt !== null &&
    now.getTime() >= leaveConsentAt.getTime();
  const inTime = now.getTime() <= facts.serviceAt.getTime() + NO_SHOW_RULES.submitWithinHours * HOUR;
  const items: NoShowChecklistItem[] = [
    { item: "arrived_on_time_nearby", ok: arrivedOnTime },
    { item: "contact_attempts", ok: contacts },
    { item: "signboard_photo", ok: photo },
    { item: "leave_consented", ok: leave },
    { item: "submitted_in_time", ok: inTime },
  ];
  return { items, complete: items.every((entry) => entry.ok), leaveConsentAt };
}

/** 「已到达」时的定位距上车点多少米（四舍五入到整米）。 */
export function distanceToPickupMeters(at: { lng: number; lat: number }, pickup: { lng: number; lat: number }): number {
  return Math.round(haversineMeters(at, pickup));
}

// ---- 照片（到达屏、举牌、联系截图） ----

export const EVIDENCE_FILE_RULES = {
  /** 一张照片最大 5 MB（手机拍的照片压缩后一般 1–3 MB） */
  maxBytes: 5 * 1024 * 1024,
  /** 认的格式：JPEG、PNG、WebP、HEIC（iPhone 的默认格式） */
  contentTypes: ["image/jpeg", "image/png", "image/webp", "image/heic"],
} as const;

export type EvidenceContentType = (typeof EVIDENCE_FILE_RULES.contentTypes)[number];

/** 按文件开头的字节判断是不是认的图片格式（不信上传时声明的类型，判断见 files.ts 的 `detectFileType`）；不是返回 null。 */
export function detectEvidenceType(bytes: Uint8Array): EvidenceContentType | null {
  return detectFileTypeAmong(bytes, EVIDENCE_FILE_RULES.contentTypes);
}
