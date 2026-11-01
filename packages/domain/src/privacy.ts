/**
 * 乘客信息打码（M4-19，ADR 0052；需求《平台运营端》「个人信息保护」：列表里默认打码，点「查看」才显示全文并记日志）。纯函数。
 * 只用在运营后台：供应商付款后看得到全文（需求「支付后可见乘客姓名、电话、航班号」），司机要联系客人。
 * M4-21（ADR 0055）：手写内容、审计和复核的前后值打码；订单结束超过期限后的不可逆脱敏。
 */
import { ORDER_CANCEL_REASONS } from "./cancellation.ts";
import { maskEmail } from "./notifications.ts";
import { tenantDayStart } from "./tenants.ts";

export interface PassengerContact {
  name: string;
  phone: string;
  email: string;
}

/** 脱敏后的占位：固定文字，不留任何原文片段（ADR 0055）。 */
export const ANONYMIZED_TEXT = "[已脱敏]";
export const ANONYMIZED_PASSENGER: Readonly<PassengerContact> = { name: ANONYMIZED_TEXT, phone: ANONYMIZED_TEXT, email: ANONYMIZED_TEXT };

export function isAnonymizedPassenger(passenger: { name: string }): boolean {
  return passenger.name === ANONYMIZED_TEXT;
}

/** 按字符（不是 UTF-16 单元）留第一个字，其余换成两个星号；只有一个字的全打码。 */
export function maskName(name: string): string {
  const chars = Array.from(name.trim());
  if (chars.length <= 1) return "*";
  return `${chars[0] as string}**`;
}

/** 只留末 4 位（前面的 + 留着，看得出是国际号码）；不足 8 位的全打码。 */
export function maskPhone(phone: string): string {
  const value = phone.trim();
  const plus = value.startsWith("+") ? "+" : "";
  const digits = value.slice(plus.length);
  if (digits.length < 8) return `${plus}****`;
  return `${plus}${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

/** 邮箱的本名、域名里不会有的字符：空白、标点、斜杠（「a@x.com/b@y.org」是两个地址）。@ 认半角和全角。 */
const EMAIL_PART = "[^\\s@＠，。；：、,;:()（）<>「」/／]+";
const EMAIL_IN_TEXT = new RegExp(`${EMAIL_PART}[@＠]${EMAIL_PART}[.．]${EMAIL_PART}`, "g");
/** 电话里的分隔：空白（含全角）、括号、点、斜杠和各种写法的连字符（输入法打出来的减号 U+2212、破折号 U+2013 / U+2014、不换行连字符 U+2011、长音 ー ｰ）。不含冒号，所以时间不会连起来。 */
const NUMBER_IN_TEXT = /[+＋(（]*[0-9０-９](?:[0-9０-９\s()（）.．/／\-‐‑–—−－ーｰ]*[0-9０-９])?/g;
/**
 * 不算电话的写法（ADR 0055）：订单号、工单号；带分隔的日期（年份 20 开头，月、日在合法范围内）；带货币标记的金额。匹配到的原样留着。
 * 先把它们切出来，只在它们之间找数字串：否则日期前面的短数字（「2 人 2026-11-01」）会和日期连成一串。
 * 前面紧挨「数字 + 连字符」的不算（090-2026-11-01、090-1234-5678円 是电话）。
 */
const ORDER_OR_TICKET_NO = "NZ[0-9]{8}[0-9A-HJ-NP-Z]{8}|TK[0-9]{8}[0-9A-HJ-NP-Z]{6}";
const DATE_IN_TEXT = "(?<![0-9０-９]|[0-9０-９][-‐‑–—−－./／])20[0-9]{2}(?:[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12][0-9]|3[01])|年(?:0?[1-9]|1[0-2])月(?:0?[1-9]|[12][0-9]|3[01])日)(?![0-9０-９])";
const MONEY_IN_TEXT = "[¥￥$][0-9０-９]+|(?<![0-9０-９+＋]|[0-9０-９][-‐‑–—−－./／])[0-9０-９]+(?=\\s?(?:JPY|CNY|USD|KRW|HKD|TWD|SGD|EUR|円|日元|元|韩元|美元)(?![A-Za-z]))";
const ORDER_OR_TICKET_NO_SPLIT = new RegExp(`(${ORDER_OR_TICKET_NO})`);
const NOT_A_PHONE_SPLIT = new RegExp(`(${ORDER_OR_TICKET_NO}|${DATE_IN_TEXT}|${MONEY_IN_TEXT})`);

/** 只改切出来的部分之间的文字；`split` 带一个捕获组，奇数位是切出来的部分。 */
function outside(text: string, split: RegExp, change: (part: string) => string): string {
  return text.split(split).map((part, index) => (index % 2 === 1 ? part : change(part))).join("");
}
const MIN_PHONE_DIGITS = 7;
const NAME_SEPARATOR = /[\s·・･,，.]+/u;
/** 姓名里连写时的间隔：备注里可能有也可能没有，半角全角都算（`\s` 包含全角空格）。 */
const NAME_GAP = "\\s*";
/** 中日文敬称：单字的姓只有紧跟这些才打码。 */
const HONORIFIC = "(?=先生|女士|小姐|太太|老师|さん|さま|様|氏|君|ちゃん)";
const LATIN_MIN_LENGTH = 3;
const CJK_MIN_LENGTH = 2;

const isLatin = (text: string): boolean => /^[\p{Script=Latin}\p{M}'’-]+$/u.test(text);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/**
 * 一段姓名的匹配式；太短、不打码时返回 null（规则见 ADR 0054「姓名的打码规则」）：
 * - 拉丁字母：至少 3 个字母，前后不能连着字母（否则 Li 会打到 line 里）；不区分大小写；
 * - 中日文：至少 2 个字；只有 1 个字的（姓「王」）只在紧跟敬称时才算，否则「王」「田」这样的普通字都会被打码。
 */
function namePattern(chars: readonly string[]): string | null {
  const text = chars.join("");
  const body = chars.map(escapeRegExp).join(NAME_GAP);
  if (isLatin(text)) return chars.length < LATIN_MIN_LENGTH ? null : `(?<![\\p{Script=Latin}])${body}(?![\\p{Script=Latin}])`;
  return chars.length < CJK_MIN_LENGTH ? `${body}${HONORIFIC}` : body;
}

/**
 * 要找的写法，长的在前：全名（忽略空格）、各段；中日文姓名连写（没有空格，分不出姓和名）时再加上第 1 个字、前 2 个字（都只算跟着敬称的）和后 2 个字（名）。
 */
function nameMatchers(name: string): { pattern: string; mask: string }[] {
  const parts = name.split(NAME_SEPARATOR).filter((part) => part !== "");
  if (parts.length === 0) return [];
  const whole = parts.flatMap((part) => Array.from(part));
  const found: { pattern: string | null; mask: string }[] = [{ pattern: namePattern(whole), mask: maskName(name) }];
  for (const part of parts.length > 1 ? parts : []) found.push({ pattern: namePattern(Array.from(part)), mask: maskName(part) });
  if (parts.length === 1 && !isLatin(parts[0] as string) && whole.length >= 3) {
    const given = whole.slice(-2);
    const family = whole.slice(0, 2);
    found.push({ pattern: namePattern(given), mask: maskName(given.join("")) });
    found.push({ pattern: `${family.map(escapeRegExp).join(NAME_GAP)}${HONORIFIC}`, mask: maskName(family.join("")) });
    found.push({ pattern: `${escapeRegExp(whole[0] as string)}${HONORIFIC}`, mask: maskName(whole[0] as string) });
  }
  return found.flatMap((entry) => (entry.pattern === null ? [] : [{ pattern: entry.pattern, mask: entry.mask }]));
}

function maskNameInText(text: string, name: string): string {
  return outside(text, ORDER_OR_TICKET_NO_SPLIT, (part) => {
    let result = part;
    for (const { pattern, mask } of nameMatchers(name)) result = result.replace(new RegExp(pattern, "giu"), () => mask);
    return result;
  });
}

function replaceNumbers(text: string, replace: (digits: string) => string): string {
  return outside(text, NOT_A_PHONE_SPLIT, (part) =>
    part.replace(NUMBER_IN_TEXT, (found) => {
      const digits = found.replace(/[^0-9０-９]/g, "");
      return digits.length < MIN_PHONE_DIGITS ? found : replace(digits);
    }),
  );
}

/**
 * 手写内容里的联系方式打码（M4-20，ADR 0054）：司机写的联系记录备注可能抄了客人的电话、邮箱、姓名。
 * 7 位以上的数字串只留末 4 位（日期、时间连写也可能被打码，宁可多打）；邮箱按 `maskEmail`；给了姓名的按 `nameMatchers` 找出来换成打码后的。
 * 只能认出这些形式，其他账号（如 LINE 编号）认不出。
 */
export function maskContactsInText(text: string, passengerName: string | null = null): string {
  const withoutName = passengerName === null || passengerName === ANONYMIZED_TEXT ? text : maskNameInText(text, passengerName);
  return replaceNumbers(withoutName.replace(EMAIL_IN_TEXT, (email) => maskEmail(email.replace("＠", "@"))), (digits) => `****${digits.slice(-4)}`);
}

export function maskPassenger(passenger: PassengerContact): PassengerContact {
  if (isAnonymizedPassenger(passenger)) return { ...ANONYMIZED_PASSENGER };
  return { name: maskName(passenger.name), phone: maskPhone(passenger.phone), email: maskEmail(passenger.email) };
}

/** 即时通讯账号：留前 2 个字符；不足 4 个字符的全打码。 */
export function maskHandle(handle: string): string {
  const chars = Array.from(handle.trim());
  return chars.length < 4 ? "***" : `${chars.slice(0, 2).join("")}***`;
}

/**
 * 不可逆地清掉手写内容里的联系方式（脱敏用，ADR 0055）：找法和 `maskContactsInText` 相同，但不留末 4 位、不留首字，都换成占位。
 * `names` 是这单用过的所有姓名（改单前的旧姓名也算），`literals` 是这单用过的电话和邮箱原文（规则认不出的写法也能清）。
 */
export function scrubContactsInText(text: string, names: readonly string[], literals: readonly string[] = []): string {
  let result = text;
  for (const literal of literals) if (literal.trim() !== "") result = result.replace(new RegExp(escapeRegExp(literal.trim()), "giu"), () => ANONYMIZED_TEXT);
  result = outside(result, ORDER_OR_TICKET_NO_SPLIT, (part) => {
    let scrubbed = part;
    for (const name of names) for (const { pattern } of nameMatchers(name)) scrubbed = scrubbed.replace(new RegExp(pattern, "giu"), () => ANONYMIZED_TEXT);
    return scrubbed;
  });
  return replaceNumbers(result.replace(EMAIL_IN_TEXT, () => ANONYMIZED_TEXT), () => ANONYMIZED_TEXT);
}

/** 前后值、复核内容、错误信息里算手写内容的键（白名单）：只看字符串值，编号、金额、状态、员工账号的 email 和 name 都不在里面。 */
export const HANDWRITTEN_KEYS: ReadonlySet<string> = new Set(["note", "notes", "reason", "description", "subject", "body", "request_note", "decision_note", "close_note", "resolution", "dispute_reason", "decline_reason", "proxy_reason", "waive_reason", "message", "last_error", "comment"]);

type JsonLike = unknown;

/**
 * 手写键一律按手写内容处理（只有一串电话、全大写的姓名、带下划线的账号都要打码），不按形状猜枚举（ADR 0055）。
 * 唯一的例外是 `reason` 键里系统写的原因代码：逐个列出，否则叫 Guest 的乘客会把取消原因打坏。不在清单里的代码照常走打码，只有碰巧和姓名相同才会变。
 */
const SYSTEM_REASON_CODES: ReadonlySet<string> = new Set([...ORDER_CANCEL_REASONS, "CHANGED", "DRIVER_MISSING_REPORTED", "DRIVER_NO_SHOW", "NO_SHOW_APPROVED", "PAYMENT_SUCCEEDED", "RESCUED", "RESCUE_ASSIGNED", "RESCUE_TRIGGERED", "refund_failed", "charge_failed", "chargeback", "paid_after_cancel"]);

function mapOrderValues(value: JsonLike, onPassenger: (passenger: Record<string, unknown>) => JsonLike, onMessaging: (messaging: Record<string, unknown>) => JsonLike, onText: (text: string) => string): JsonLike {
  if (Array.isArray(value)) return value.map((item) => mapOrderValues(item, onPassenger, onMessaging, onText));
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "passenger" && typeof item === "object" && item !== null && !Array.isArray(item)) out[key] = onPassenger(item as Record<string, unknown>);
    else if (key === "messaging" && typeof item === "object" && item !== null && !Array.isArray(item)) out[key] = onMessaging(item as Record<string, unknown>);
    else if (HANDWRITTEN_KEYS.has(key) && typeof item === "string") out[key] = key === "reason" && SYSTEM_REASON_CODES.has(item) ? item : onText(item);
    else out[key] = mapOrderValues(item, onPassenger, onMessaging, onText);
  }
  return out;
}

const textOf = (value: unknown): string => (typeof value === "string" ? value : "");

/** 内容里任何一层 `passenger.name` 写的姓名：改单前的旧姓名也要从手写内容里找出来。 */
function passengerNamesIn(value: JsonLike): string[] {
  if (Array.isArray(value)) return value.flatMap(passengerNamesIn);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, item]) => {
    if (key !== "passenger") return passengerNamesIn(item);
    const name = (item as { name?: unknown } | null)?.name;
    return typeof name === "string" ? [name] : [];
  });
}

/** 前后值、复核内容里的乘客、即时通讯账号和手写内容打码（ADR 0055）。别的键原样。`known` 是这单用过的姓名（现在的和改单前的），内容里带的姓名也会一起找。 */
export function maskOrderValues<T>(values: T, known: string | readonly string[] | null = null): T {
  const given = known === null ? [] : typeof known === "string" ? [known] : known;
  // 已经打过码的姓名（旧审计再打一次时带的）不能再当姓名找，否则星号会被当成姓名的一部分
  const names = [...new Set<string | null>([...given, ...passengerNamesIn(values)])].filter((item): item is string => item !== null && item !== ANONYMIZED_TEXT && item !== "" && !item.includes("*"));
  return mapOrderValues(
    values,
    (passenger) => maskPassenger({ name: textOf(passenger["name"]), phone: textOf(passenger["phone"]), email: textOf(passenger["email"]) }),
    (messaging) => ({ ...messaging, handle: maskHandle(textOf(messaging["handle"])) }),
    (text) => names.reduce((masked, each) => maskContactsInText(masked, each), names.length === 0 ? maskContactsInText(text) : text),
  ) as T;
}

/** 工单详情里能看原文的文字：字段和 `POST /platform/v1/tickets/{id}/texts/reveal` 返回的来源一一对应。 */
export interface TicketTextFields {
  ticket: { subject: string; description: string; decision_note: string | null; close_note: string | null };
  messages: readonly { body: string }[];
  notes: readonly { body: string }[];
}

export type TicketTextSource = "ticket_subject" | "ticket_description" | "ticket_decision_note" | "ticket_close_note" | "ticket_message" | "ticket_note";

/**
 * 工单里确实被打了码的文字（原文，ADR 0056）。`masked` 必须是 `raw` 过 `maskOrderValues` 的结果：比的就是页面实际收到的内容，不另算一遍规则，
 * 「有没有打码内容」和「打码了什么」不可能不一致。
 */
export function maskedTicketTexts(raw: TicketTextFields, masked: TicketTextFields): { source: TicketTextSource; text: string }[] {
  const found: { source: TicketTextSource; text: string }[] = [];
  const compare = (source: TicketTextSource, original: string | null, shown: string | null): void => {
    if (original !== null && original !== shown) found.push({ source, text: original });
  };
  compare("ticket_subject", raw.ticket.subject, masked.ticket.subject);
  compare("ticket_description", raw.ticket.description, masked.ticket.description);
  compare("ticket_decision_note", raw.ticket.decision_note, masked.ticket.decision_note);
  compare("ticket_close_note", raw.ticket.close_note, masked.ticket.close_note);
  raw.messages.forEach((message, index) => compare("ticket_message", message.body, masked.messages[index]?.body ?? null));
  raw.notes.forEach((note, index) => compare("ticket_note", note.body, masked.notes[index]?.body ?? null));
  return found;
}

/** 脱敏：前后值、推送内容里的乘客换成占位，手写内容清掉联系方式；即时通讯账号不在这次的范围（ADR 0055）。 */
export function scrubOrderValues<T>(values: T, names: readonly string[], literals: readonly string[] = []): T {
  return mapOrderValues(values, () => ({ ...ANONYMIZED_PASSENGER }), (messaging) => messaging, (text) => scrubContactsInText(text, names, literals)) as T;
}

/** 审计日志里和订单有关的对象：前后值要打码（ADR 0055）。 */
const ORDER_AUDIT_RESOURCES: ReadonlySet<string> = new Set(["order", "order_change", "extra_charge", "refund", "rescue", "rescue_offer", "order_exception", "ticket"]);
/** 复核里和订单有关的对象。 */
const ORDER_APPROVAL_RESOURCES: ReadonlySet<string> = new Set(["order", "ticket", "rescue"]);
const ORDER_APPROVAL_KIND = /^(?:order|ticket|rescue)\./;

export function isOrderApproval(approval: { resource: string }): boolean {
  return ORDER_APPROVAL_RESOURCES.has(approval.resource);
}

/** 这条审计的前后值要不要打码。复核的记录看它复核的是什么：发起时写在 `after.resource`，决定时写在 `after.kind`。 */
export function isOrderAudit(entry: { resource: string; after?: unknown }): boolean {
  if (ORDER_AUDIT_RESOURCES.has(entry.resource)) return true;
  if (entry.resource !== "approval") return false;
  const after = (entry.after ?? {}) as { resource?: unknown; kind?: unknown };
  return (typeof after.resource === "string" && ORDER_APPROVAL_RESOURCES.has(after.resource)) || (typeof after.kind === "string" && ORDER_APPROVAL_KIND.test(after.kind));
}

/** 乘客信息的保存期限不能低于这个天数（需求「订单完成 180 天后自动脱敏」）。 */
export const PASSENGER_RETENTION_MIN_DAYS = 180;

/**
 * 脱敏的截止时刻：结束时间**早于**它的单才算超过期限（ADR 0055）。按东京日历日算：今天 − 结束日期 > `days`。
 * 也就是结束后第 180 天还不动，第 181 天才动。日本没有夏令时，一天固定 24 小时。
 */
export function passengerRetentionCutoff(now: Date, days: number): Date {
  if (!Number.isInteger(days) || days < PASSENGER_RETENTION_MIN_DAYS) throw new RangeError(`乘客信息保存期限不能低于 ${PASSENGER_RETENTION_MIN_DAYS} 天`);
  return new Date(tenantDayStart(now).getTime() - days * 86_400_000);
}
