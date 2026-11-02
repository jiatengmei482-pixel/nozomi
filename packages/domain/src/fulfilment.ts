/**
 * 履约：实际落地时间的取证规则、免费等待、客人未出现（no-show）的 5 项证据（M3-02，ADR 0027）。纯函数，不碰数据库和网络。
 *
 * 需求：《用车报价服务平台》「8. 订单与履约」的「落地时间」（取客人「我已落地」的时间；没有则取司机在 H5 填写的时间，填写时必须拍到达屏；
 * 都没有则取计划到达时间。客人和司机不一致时取较晚者；提交后不能改。航班延误 6 小时内顺延且不加收费用）、「客人未出现」；
 * 《平台运营端与渠道对接》「航班信息」「免费等待与 no-show」（no-show 成立必须同时满足 5 项）、「航班延误与取消」；第五轮决策 ③。
 */
import { detectFileTypeAmong } from "./files.ts";
import { haversineMeters } from "./geo.ts";
import type { OrderStatus } from "./orders.ts";
import { instantToLocal, localDateTimeToInstant } from "./service-time.ts";

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

// ---- 评分 ----

/**
 * 准时到达的基准时间（ADR 0052「评分」，M4-20）：接机单有落地时间时取计划时间和落地时间中较晚的，航班晚点不算供应商迟到；
 * 航班提前落地不会让基准提前。其他订单、没有落地时间的按用车时间。`landedAt` 是到达那一刻已知的落地时间。
 */
export function arrivalBaseline(serviceAt: Date, landedAt: Date | null): Date {
  return landedAt !== null && landedAt.getTime() > serviceAt.getTime() ? landedAt : serviceAt;
}

/** 准时到达（需求「准时到达率：用车时间前到达上车点」，ADR 0028；基准见 `arrivalBaseline`）：不晚于基准时间。 */
export function arrivalOnTime(arrivedAt: Date, serviceAt: Date, landedAt: Date | null = null): boolean {
  return arrivedAt.getTime() <= arrivalBaseline(serviceAt, landedAt).getTime();
}

// ---- 平台代传履约（M4-18，ADR 0052） ----

export const FULFILMENT_EVENTS = ["departed", "arrived", "picked_up", "completed"] as const;
export type FulfilmentEventType = (typeof FULFILMENT_EVENTS)[number];

export const FULFILMENT_EVENT_NAMES: Readonly<Record<FulfilmentEventType, string>> = {
  departed: "司机已出发",
  arrived: "司机已到达",
  picked_up: "已接到客人",
  completed: "已完成",
};

// ---- 履约回传的时间窗口（M4-32，ADR 0064；代传沿用 ADR 0052 的数） ----

/**
 * 每一步最早可以在用车前多少小时发生。司机自己回传（按系统收到的时间）和平台代传（按运营填的发生时间）都用这一份。
 * - 出发、到达：24 小时。远途接人、包车要提前赶路，用车前 1 小时还没出发才提醒（需求「履约时间点」），这里只挡明显点错的；
 * - 接到客人、完成：3 小时。这两步不可逆（服务中客人不能再取消；完成进账单、是终态），接到客人最多是航班提前落地（`LANDING_RULES.earliestHoursBeforeScheduled`）。
 * 只管「太早」：航班晚点时到达、接到客人比计划晚很多都正常，不设上限。
 */
export const FULFILMENT_EARLIEST_HOURS_BEFORE_SERVICE: Readonly<Record<FulfilmentEventType, number>> = { departed: 24, arrived: 24, picked_up: 3, completed: 3 };

/** 这一步最早可以在什么时候发生（含这一刻）。 */
export function fulfilmentEarliestAt(type: FulfilmentEventType, serviceAt: Date): Date {
  return new Date(serviceAt.getTime() - FULFILMENT_EARLIEST_HOURS_BEFORE_SERVICE[type] * HOUR);
}

/** `at` 比这一步的最早时间还早。正好在最早时间那一刻不算早。 */
export function fulfilmentTooEarly(type: FulfilmentEventType, at: Date, serviceAt: Date): boolean {
  return at.getTime() < fulfilmentEarliestAt(type, serviceAt).getTime();
}

/**
 * 最早时间写给人看：城市当地时间 `YYYY-MM-DD HH:mm`。保证照着写的当地时间去点不会被拒：
 * - 带秒的进到下一分钟；
 * - 夏令时拨回、当地时间出现两次的那一小时：写出来的钟面如果先出现的那一次还早于最早时间（最早时间落在第二次），往后写到这一小时结束后的第一分钟。
 *   手机上只看得到钟面、分不清是第一次还是第二次，往后写最多晚一小时，但不会让司机照着点被拒。
 */
export function fulfilmentEarliestLocal(type: FulfilmentEventType, serviceAt: Date, timeZone: string): string {
  const earliest = fulfilmentEarliestAt(type, serviceAt).getTime();
  let at = Math.ceil(earliest / MINUTE) * MINUTE;
  for (let step = 0; step <= 24 * 60; step += 1) {
    const local = instantToLocal(new Date(at), timeZone).dateTime;
    const first = localDateTimeToInstant(local, timeZone);
    if (first === null || first.getTime() >= earliest) return local.replace("T", " ");
    at += MINUTE;
  }
  return instantToLocal(new Date(at), timeZone).dateTime.replace("T", " ");
}

/** 司机页上每一步的按钮叫法：说明里也用它，司机看到的和要点的是同一个词。 */
export const DRIVER_ACTION_LABELS: Readonly<Record<FulfilmentEventType, string>> = {
  departed: "我出发了",
  arrived: "已到达上车点",
  picked_up: "接到客人了",
  completed: "服务完成",
};

/** 太早时给司机看的说明：哪一步（按钮上的叫法）、最早几点可以点（当地时间）、为什么。 */
export function fulfilmentTooEarlyMessage(type: FulfilmentEventType, serviceAt: Date, timeZone: string): string {
  const service = instantToLocal(serviceAt, timeZone).dateTime.replace("T", " ");
  return `现在还不能点「${DRIVER_ACTION_LABELS[type]}」：最早在用车前 ${FULFILMENT_EARLIEST_HOURS_BEFORE_SERVICE[type]} 小时，也就是 ${fulfilmentEarliestLocal(type, serviceAt, timeZone)}（${timeZone} 当地时间）以后才能点（用车时间 ${service}）。行程有变请联系调度。`;
}

export const PROXY_FULFILMENT_RULES = {
  /** 报的时间最早可以比现在早多少天；再久的补录走工单 */
  maxBackdateDays: 7,
  reasonMax: 500,
} as const;

/** 履约的下一步（状态只能向前走一步）。这个状态不能回传履约时为 null：待派车要先派车，服务结束了、没付款、已取消、救援中、no-show 审核中都不走这里。 */
export function nextFulfilmentEvent(status: OrderStatus): FulfilmentEventType | null {
  if (status === "assigned") return "departed";
  if (status === "departed") return "arrived";
  if (status === "arrived") return "picked_up";
  if (status === "in_service") return "completed";
  return null;
}

/**
 * 代传「已接到客人」「已完成」要另一位同事批准（ADR 0052）：服务中不可逆，客人和运营都不能再取消；已完成的单进供应商账单、是终态、打开事后加收的窗口。
 * 出发、到达不走复核：改派、取消都还能挽回。
 */
export function proxyEventNeedsReview(type: FulfilmentEventType): type is "picked_up" | "completed" {
  return type === "picked_up" || type === "completed";
}

/** 代传这一步的发生时间最早可以比用车时间早多少小时：和司机同一份（`FULFILMENT_EARLIEST_HOURS_BEFORE_SERVICE`）。不说哪一步时按出发、到达算。 */
export function proxyEarliestHoursBeforeService(type?: FulfilmentEventType): number {
  return FULFILMENT_EARLIEST_HOURS_BEFORE_SERVICE[type ?? "departed"];
}

export type ProxyTimeIssue = "IN_FUTURE" | "BEFORE_PREVIOUS" | "TOO_EARLY" | "TOO_OLD";

export function proxyTimeIssueMessage(issue: ProxyTimeIssue, type?: FulfilmentEventType): string {
  if (issue === "IN_FUTURE") return "发生时间不能晚于现在";
  if (issue === "BEFORE_PREVIOUS") return "发生时间不能早于上一个履约节点";
  if (issue === "TOO_EARLY") return `发生时间不能早于用车时间前 ${proxyEarliestHoursBeforeService(type)} 小时`;
  return `发生时间不能早于 ${PROXY_FULFILMENT_RULES.maxBackdateDays} 天前，更早的请走工单`;
}

/**
 * 代传时运营填的发生时间合不合规则。`previousAt` 是上一个履约节点（派车、出发、到达、接到）的时间。合理返回 null。
 * 页面只填到分钟，而节点的时间带秒：和上一个节点同一分钟不算早（写入时用 `proxyEffectiveOccurredAt`，流水仍然不倒退）。
 */
export function proxyFulfilmentTimeIssue(input: { occurredAt: Date; previousAt: Date | null; serviceAt: Date; now: Date; type?: FulfilmentEventType }): ProxyTimeIssue | null {
  const at = input.occurredAt.getTime();
  if (at > input.now.getTime()) return "IN_FUTURE";
  if (at < input.now.getTime() - PROXY_FULFILMENT_RULES.maxBackdateDays * 24 * HOUR) return "TOO_OLD";
  if (fulfilmentTooEarly(input.type ?? "departed", input.occurredAt, input.serviceAt)) return "TOO_EARLY";
  if (input.previousAt !== null && at < Math.floor(input.previousAt.getTime() / MINUTE) * MINUTE) return "BEFORE_PREVIOUS";
  return null;
}

/** 实际写入的发生时间：和上一个节点同一分钟、又比它早几秒的，按上一个节点算。 */
export function proxyEffectiveOccurredAt(occurredAt: Date, previousAt: Date | null): Date {
  return previousAt !== null && occurredAt.getTime() < previousAt.getTime() ? previousAt : occurredAt;
}
