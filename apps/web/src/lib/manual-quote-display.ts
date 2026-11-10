/**
 * 运营后台「人工报价」「官网设置」的地址、状态徽标和文字（M8-21，ADR 0076；规范 docs/design/pages/platform-tickets.md 第 8 节、platform-settings.md 第 6 节）。
 */
import { MANUAL_QUOTE_STATUSES, MANUAL_QUOTE_STATUS_NAMES, type ManualQuoteStatus, manualQuoteEmail, whatsappDigits } from "@nozomi/domain";
import type { ManualQuoteEvent, ManualQuoteSummary } from "../api/manual-quotes.ts";
import type { BadgeSpec } from "../components/StatusBadge.tsx";
import { SERVICE_CATEGORY_NAMES, displayName } from "./master-display.ts";
import { SETTINGS_ROOT } from "./platform-paths.ts";

export const MANUAL_QUOTES_PAGE = "/platform/manual-quotes";
export const SITE_SETTINGS_PAGE = `${SETTINGS_ROOT}/site`;

export function manualQuotePath(id: string): string {
  return `${MANUAL_QUOTES_PAGE}/${encodeURIComponent(id)}`;
}

/** 「新」要有人看，用警告色；跟进中、已报价是进行中；已转订单成功；关闭中性。 */
export const MANUAL_QUOTE_STATUS_BADGES: Readonly<Record<ManualQuoteStatus, BadgeSpec>> = {
  new: { tone: "warning", label: MANUAL_QUOTE_STATUS_NAMES.new },
  following: { tone: "info", label: MANUAL_QUOTE_STATUS_NAMES.following },
  quoted: { tone: "info", label: MANUAL_QUOTE_STATUS_NAMES.quoted },
  converted: { tone: "success", label: MANUAL_QUOTE_STATUS_NAMES.converted },
  closed: { tone: "neutral", label: MANUAL_QUOTE_STATUS_NAMES.closed },
};

export const PURGED_BADGE: BadgeSpec = { tone: "neutral", label: "已清除联系方式" };

/** 网址里的状态：认得的才用。 */
export function manualQuoteStatusOf(value: string | null): ManualQuoteStatus | null {
  return (MANUAL_QUOTE_STATUSES as readonly string[]).includes(value ?? "") ? (value as ManualQuoteStatus) : null;
}

/** 按联系方式查找：完整的邮箱，或带国家码的 WhatsApp 号码（+ 可有可无）。不完整的不去查（接口会 400）。 */
export function contactQueryValid(value: string): boolean {
  return manualQuoteEmail(value) !== null || whatsappDigits(value, { requirePlus: false }) !== null;
}

/** 行程一句话（列表、详情标题下）：「点对点 · 东京 · 2030-11-20 09:30（当地）· 2 人 1 件行李」，包车加时长。没有地点（地点是个人信息，只在详情里）。 */
export function manualQuoteTripText(request: Pick<ManualQuoteSummary, "category" | "city" | "service_local" | "passengers" | "luggage" | "package_hours">): string {
  const category = request.category === "charter" && request.package_hours !== null ? `包车 ${request.package_hours} 小时` : SERVICE_CATEGORY_NAMES[request.category];
  const city = request.city === null ? "城市未识别" : displayName(request.city.name).text;
  return `${category} · ${city} · ${request.service_local.replace("T", " ")}（当地）· ${request.passengers} 人 ${request.luggage} 件行李`;
}

/** 客人留了哪几项（列表只有「有没有」）。 */
export function contactKindsText(request: Pick<ManualQuoteSummary, "has_email" | "has_whatsapp">): string {
  const kinds = [request.has_email ? "邮箱" : null, request.has_whatsapp ? "WhatsApp" : null].filter((kind): kind is string => kind !== null);
  return kinds.length === 0 ? "—" : kinds.join("、");
}

/** 跟进记录的一句话。 */
export function manualQuoteEventText(event: ManualQuoteEvent): string {
  if (event.kind === "created") return "客人提交";
  if (event.kind === "status") return `状态：${event.from_status === null ? "—" : MANUAL_QUOTE_STATUS_NAMES[event.from_status]} → ${event.to_status === null ? "—" : MANUAL_QUOTE_STATUS_NAMES[event.to_status]}`;
  if (event.kind === "assign") return event.assignee === null ? "取消指派" : `指派给「${event.assignee.name}」`;
  return "备注";
}

/** 客人的 WhatsApp（`+819012345678`）去 wa.me 的链接：只要纯数字。 */
export function guestWhatsappUrl(whatsapp: string): string | null {
  const digits = whatsappDigits(whatsapp, { requirePlus: false });
  return digits === null ? null : `https://wa.me/${digits}`;
}

/** 客服 WhatsApp 号码显示成「+81 0000000000」这样带 + 的写法（存的是纯数字）。 */
export function supportWhatsappText(digits: string): string {
  return `+${digits}`;
}

export const SUPPORT_WHATSAPP_HINT = "填带国家码的号码，如 +81 开头的日本号码；可以有空格、连字符。保存后官网报不出价时显示「通过 WhatsApp 联系我们」，清空就不显示。";
export const SUPPORT_WHATSAPP_INVALID = "号码的格式不对：要带国家码（不以 0 开头），共 8 到 15 位数字，如 +81 开头的日本号码";
