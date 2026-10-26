/**
 * 订单中心（异常队列、工单、赔付表）在页面上的说法（M4-03，ADR 0034）。名称取自 @nozomi/domain 的同一份清单；
 * 界面上叫「供应商」不叫「租户」，所以 domain 里带「租户」的名字在这里换成「供应商」。
 */
import {
  COMPENSATION_SCENARIO_NAMES,
  type CompensationScenario,
  EXCEPTION_STATUS_NAMES,
  type ExceptionStatus,
  type ExceptionType,
  EXCEPTION_TYPE_NAMES,
  type LiableParty,
  TICKET_PRIORITY_NAMES,
  TICKET_STATUS_NAMES,
  TICKET_TYPE_NAMES,
  type TicketOutcome,
  type TicketPriority,
  type TicketSource,
  type TicketStatus,
  type TicketType,
  isCurrencyCode,
} from "@nozomi/domain";
import type { Money } from "../api/dispatch.ts";
import type { OrderException } from "../api/order-center.ts";
import type { BadgeSpec } from "../components/StatusBadge.tsx";
import { basisPointsText } from "./adjust-form.ts";
import { formatLocalDateTime } from "./master-display.ts";
import { extraTypeName, REVIEW_REASON_NAMES } from "./order-money-display.ts";
import { moneyText as minorMoneyText } from "./product-display.ts";
import { triggerName } from "./rescue-display.ts";

// ---- 地址 ----

export const EXCEPTION_QUEUE_PATH = "/platform/exceptions";
export const PLATFORM_TICKETS_PAGE = "/platform/tickets";
export const PLATFORM_TICKET_NEW_PATH = `${PLATFORM_TICKETS_PAGE}/new`;
export const COMPENSATION_TABLE_PAGE = "/platform/compensation-table";
export const TENANT_TICKETS_PAGE = "/tickets";
export const TENANT_TICKET_NEW_PATH = `${TENANT_TICKETS_PAGE}/new`;

export function exceptionPath(id: string): string {
  return `${EXCEPTION_QUEUE_PATH}/${encodeURIComponent(id)}`;
}

export function platformTicketPath(id: string): string {
  return `${PLATFORM_TICKETS_PAGE}/${encodeURIComponent(id)}`;
}

/** 新建工单（关联订单）：从订单详情进来时带着订单编号。 */
export function newPlatformTicketPath(orderId: string): string {
  return `${PLATFORM_TICKET_NEW_PATH}?order=${encodeURIComponent(orderId)}`;
}

export function tenantTicketPath(id: string): string {
  return `${TENANT_TICKETS_PAGE}/${encodeURIComponent(id)}`;
}

/** 供应商发起工单：申诉时带着被申诉的工单，失物 / 其他时可以带着订单。 */
export function newTenantTicketPath(from: { appeal?: string; order?: string } = {}): string {
  const params = new URLSearchParams();
  if (from.appeal !== undefined) params.set("appeal", from.appeal);
  if (from.order !== undefined) params.set("order", from.order);
  const search = params.toString();
  return search === "" ? TENANT_TICKET_NEW_PATH : `${TENANT_TICKET_NEW_PATH}?${search}`;
}

// ---- 金额 ----

/** 接口里的金额（主单位的十进制字符串 + 币种）写成「JPY 1,200」「CNY -45.50」：走 domain 的 money.ts，不用浮点。 */
export function moneyLabel(money: Money): string {
  const negative = money.amount.startsWith("-");
  const digits = negative ? money.amount.slice(1) : money.amount;
  if (!isCurrencyCode(money.currency) || !/^\d+(\.\d+)?$/.test(digits)) return `${money.currency} ${money.amount}`;
  const [whole = "0", fraction] = digits.split(".");
  return `${money.currency} ${negative ? "-" : ""}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction === undefined ? "" : `.${fraction}`}`;
}

/** 金额是 0（「JPY 0」「CNY 0.00」）。 */
export function isZero(money: Money): boolean {
  return /^-?0+(\.0+)?$/.test(money.amount);
}

/** 最小单位整数 + 币种 → 「JPY 1,200」（异常详情里的金额是这样存的）。 */
export function minorLabel(minor: unknown, currency: unknown): string {
  return typeof minor === "number" && typeof currency === "string" ? minorMoneyText(minor, currency) : "—";
}

export function percentLabel(bp: number): string {
  return `${basisPointsText(bp)}%`;
}

// ---- 异常 ----

export function exceptionTypeName(type: ExceptionType): string {
  return EXCEPTION_TYPE_NAMES[type];
}

/** 异常的状态：待处理（有时限，警告色）、处理中（信息色）、已关闭（中性）。超时另外用危险色的「已超时」徽标。 */
export const EXCEPTION_STATUS_BADGES: Readonly<Record<ExceptionStatus, BadgeSpec>> = {
  open: { tone: "warning", label: EXCEPTION_STATUS_NAMES.open },
  claimed: { tone: "info", label: EXCEPTION_STATUS_NAMES.claimed },
  closed: { tone: "neutral", label: EXCEPTION_STATUS_NAMES.closed },
};

export const OVERDUE_BADGE: BadgeSpec = { tone: "danger", label: "已超时" };

export const CLOSE_KIND_NAMES: Readonly<Record<"resolved" | "cleared", string>> = { resolved: "人工处理完", cleared: "条件已解除（系统关闭）" };

const PAYMENT_ISSUE_NAMES: Readonly<Record<string, string>> = { refund_failed: "退款失败", charge_failed: "事后加收扣款失败", chargeback: "客人拒付", paid_after_cancel: "取消后才付到钱" };
const REFUND_PURPOSE_NAMES: Readonly<Record<string, string>> = { cancellation: "取消", change: "改期退差价", compensation: "工单赔付" };
const PAYMENT_KIND_NAMES: Readonly<Record<string, string>> = { order: "下单付款", change: "改期补差价", extra_charge: "事后加收" };

const when = (value: unknown): string | null => (typeof value === "string" ? formatLocalDateTime(value) : null);

/** 异常发现时的情况，按类型写成「标签：值」几行。认不出来的字段不显示（原样在审计日志里看得到）。 */
export function exceptionDetailLines(exception: Pick<OrderException, "type" | "detail">): { label: string; value: string }[] {
  const d = exception.detail;
  const lines: { label: string; value: string }[] = [];
  const add = (label: string, value: string | null): void => {
    if (value !== null && value !== "") lines.push({ label, value });
  };
  switch (exception.type) {
    case "dispatch_overdue":
      add("派车截止", when(d["dispatch_due_at"]));
      break;
    case "arrival_overdue":
      add("司机应到", when(d["service_at"]));
      if (typeof d["driver_missing_reported_at"] === "string") add("客人报告司机没到", when(d["driver_missing_reported_at"]));
      break;
    case "departure_overdue":
    case "fulfilment_unfinished":
      add("用车时间", when(d["service_at"]));
      break;
    case "push_failed":
      add("推送的事件", typeof d["event_type"] === "string" ? d["event_type"] : null);
      add("最后一次失败", when(d["failed_at"]));
      add("对方的应答", typeof d["last_status_code"] === "number" ? `HTTP ${d["last_status_code"]}` : typeof d["last_error_code"] === "string" ? d["last_error_code"] : null);
      break;
    case "no_show_review":
      add("供应商提交 no-show", when(d["submitted_at"]));
      break;
    case "extra_charge_review":
      add("加收类型", typeof d["type"] === "string" ? extraTypeName(d["type"] as Parameters<typeof extraTypeName>[0]) : null);
      add("转人工的原因", Array.isArray(d["review_reasons"]) ? d["review_reasons"].map((reason) => REVIEW_REASON_NAMES[String(reason)] ?? String(reason)).join("、") : null);
      add("客人异议期到", when(d["dispute_until"]));
      break;
    case "payment_issue":
      add("原因", typeof d["reason"] === "string" ? (PAYMENT_ISSUE_NAMES[d["reason"]] ?? d["reason"]) : null);
      if (typeof d["purpose"] === "string") add("退款用途", REFUND_PURPOSE_NAMES[d["purpose"]] ?? d["purpose"]);
      if (typeof d["kind"] === "string") add("收款", PAYMENT_KIND_NAMES[d["kind"]] ?? d["kind"]);
      if (typeof d["amount_minor"] === "number") add("金额", minorLabel(d["amount_minor"], d["currency"]));
      if (typeof d["refunded_minor"] === "number") add("已退", minorLabel(d["refunded_minor"], d["currency"]));
      break;
    case "rescue":
      add("救援情形", typeof d["trigger"] === "string" ? triggerName(d["trigger"] as Parameters<typeof triggerName>[0]) : null);
      add("用车时间", when(d["service_at"]));
      break;
  }
  return lines;
}

/** 认领这条异常的人：自己写「你」，别人写名字，没认领写「—」。 */
export function assigneeText(assignee: { id: string; name: string | null } | null, me: string | null): string {
  if (assignee === null) return "—";
  if (assignee.id === me) return "你";
  return assignee.name ?? "（已停用的同事）";
}

// ---- 工单 ----

/** 「租户申诉」在界面上叫「供应商申诉」。 */
export function ticketTypeName(type: TicketType): string {
  return TICKET_TYPE_NAMES[type].replace("租户", "供应商");
}

export const TICKET_STATUS_BADGES: Readonly<Record<TicketStatus, BadgeSpec>> = {
  open: { tone: "warning", label: TICKET_STATUS_NAMES.open },
  awaiting_tenant: { tone: "info", label: "等供应商回复" },
  in_progress: { tone: "info", label: TICKET_STATUS_NAMES.in_progress },
  pending_review: { tone: "warning", label: TICKET_STATUS_NAMES.pending_review },
  decided: { tone: "success", label: TICKET_STATUS_NAMES.decided },
  closed: { tone: "neutral", label: TICKET_STATUS_NAMES.closed },
};

export function priorityName(priority: TicketPriority): string {
  return TICKET_PRIORITY_NAMES[priority];
}

/** 紧急是危险色（15 分钟内要响应），高是警告色，其余不另标。 */
export const PRIORITY_BADGES: Readonly<Record<TicketPriority, BadgeSpec | null>> = {
  urgent: { tone: "danger", label: TICKET_PRIORITY_NAMES.urgent },
  high: { tone: "warning", label: TICKET_PRIORITY_NAMES.high },
  normal: null,
  low: null,
};

export const TICKET_SOURCE_NAMES: Readonly<Record<TicketSource, string>> = { guest: "客人", channel: "渠道", tenant: "供应商", platform: "客服", system: "系统" };

export const LIABLE_PARTY_NAMES: Readonly<Record<LiableParty, string>> = { tenant: "供应商", platform: "平台" };

/** 每种工单可选的结论和它在页面上的说法。 */
export function outcomeName(type: TicketType, outcome: TicketOutcome | string | null): string {
  if (outcome === null) return "—";
  if (type === "no_show_review") return outcome === "approved" ? "通过（客人未出现）" : outcome === "rejected" ? "驳回（按未履约处理）" : outcome;
  if (outcome === "upheld") return "成立";
  if (outcome === "rejected") return "不成立";
  if (outcome === "resolved") return "已处理";
  if (outcome === "approved") return "通过";
  return outcome;
}

export function scenarioName(scenario: CompensationScenario): string {
  return COMPENSATION_SCENARIO_NAMES[scenario];
}

export const PAYOUT_STATUS_NAMES: Readonly<Record<"none" | "pending" | "paid", string>> = { none: "不用另付", pending: "待财务另付", paid: "已另付" };

/** 留言是谁写的。运营后台：平台员工写名字（同事名单里找），别的写身份；供应商后台：平台写「平台」，自己这边写「你们」。 */
export function authorText(message: { author_type: string; author_id: string | null }, names: ReadonlyMap<string, string>, viewer: "platform" | "tenant"): string {
  switch (message.author_type) {
    case "platform_user":
      return viewer === "tenant" ? "平台" : message.author_id === null ? "平台员工" : (names.get(message.author_id) ?? "平台员工");
    case "tenant_user":
      return viewer === "tenant" ? "你们" : "供应商";
    case "channel":
      return "渠道";
    case "guest":
      return "客人";
    default:
      return "系统";
  }
}

/** 编号换成同事的名字：自己写「你」；名单里没有的写「（同事）」。 */
export function colleagueName(id: string | null, names: ReadonlyMap<string, string>, me: string | null): string {
  if (id === null) return "—";
  if (id === me) return "你";
  return names.get(id) ?? "（同事）";
}

/** 期限：已过的写「已超时」，没过的写到什么时候。 */
export function dueText(iso: string | null, now: Date): string {
  if (iso === null) return "—";
  return `${formatLocalDateTime(iso)}${new Date(iso).getTime() < now.getTime() ? "（已超时）" : ""}`;
}
