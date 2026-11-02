/**
 * 官网订单链接发到下单邮箱（M4-30，ADR 0061）的纯规则：查订单用的邮箱怎么认、限速、运营重发能不能发。
 *
 * 查订单不再在页面上直接打开订单：客人填订单号 + 下单邮箱，对上了就把一条新签发的查看链接发到**订单上的邮箱**，
 * 页面不管对没对上都说同一句话。所以这里的限速全部按请求里的东西计（来源地址、订单号、填的邮箱），和订单存不存在无关。
 */
import { normalizeEmailForIndex } from "./privacy.ts";

/** 限速（固定时间窗，计数存在 `sales_rate_limits`）：不管订单存不存在、邮箱对不对都计。 */
export const VIEW_LINK_REQUEST_LIMITS = {
  /** 同一来源地址 15 分钟 10 次（沿用 ADR 0032 找回的地址额度） */
  ip: { max: 10, windowMs: 900_000 },
  /** 同一订单号每小时 3 次、每天 6 次：换着地址也不能拿一张单的邮箱当靶子 */
  orderHour: { max: 3, windowMs: 3_600_000 },
  orderDay: { max: 6, windowMs: 86_400_000 },
  /** 同一个邮箱每小时 3 次、每天 10 次（一个客人可能有几张单）：拿它轰炸一个邮箱，每天最多 10 封 */
  emailHour: { max: 3, windowMs: 3_600_000 },
  emailDay: { max: 10, windowMs: 86_400_000 },
} as const;

export type ViewLinkThrottleDimension = "ip" | "order" | "email";

export interface ViewLinkThrottleStep {
  dimension: ViewLinkThrottleDimension;
  /** 限速表里区分额度的名字 */
  scope: "site_lookup" | "site_link_order_hour" | "site_link_order_day" | "site_link_email_hour" | "site_link_email_day";
  max: number;
  windowMs: number;
}

/** 依次占用的额度：先看地址，再看订单号，最后看邮箱。被前面拦下的不占后面的，否则别人连点就能顶满一张单、一个邮箱的额度。 */
export function viewLinkThrottleSteps(): readonly ViewLinkThrottleStep[] {
  const limits = VIEW_LINK_REQUEST_LIMITS;
  return [
    { dimension: "ip", scope: "site_lookup", ...limits.ip },
    { dimension: "order", scope: "site_link_order_hour", ...limits.orderHour },
    { dimension: "order", scope: "site_link_order_day", ...limits.orderDay },
    { dimension: "email", scope: "site_link_email_hour", ...limits.emailHour },
    { dimension: "email", scope: "site_link_email_day", ...limits.emailDay },
  ];
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
// 控制字符写成转义：这是正则要匹配的内容
const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f\\u0085\\u2028\\u2029]");

/**
 * 查订单填的邮箱：NFKC（全角转半角）后按订单盲索引同一个口径规整（不分大小写、去首尾空白）。
 * 不像邮箱（没有 @、有空白、有控制字符、太长）的返回 null：链接只发邮箱，手机号不能用来查（ADR 0061）。
 */
export function viewLinkLookupEmail(value: string): string | null {
  if (CONTROL.test(value)) return null;
  const email = normalizeEmailForIndex(value);
  if (email.length > 320 || !EMAIL_SHAPE.test(email)) return null;
  return email;
}

/** 运营重发时核实客人身份的方式（必填，进审计和复核）。 */
export const VIEW_LINK_VERIFICATIONS = ["callback_phone", "email_from_order_address", "order_details", "payment_details", "other"] as const;
export type ViewLinkVerification = (typeof VIEW_LINK_VERIFICATIONS)[number];

export const VIEW_LINK_VERIFICATION_NAMES: Readonly<Record<ViewLinkVerification, string>> = {
  callback_phone: "回拨下单时留的电话，本人确认",
  email_from_order_address: "客人用下单邮箱来信",
  order_details: "核对订单细节（行程、用车时间、人数、航班号）",
  payment_details: "核对付款信息（卡号末 4 位、付款时间、金额）",
  other: "其他（在原因里写清楚怎么核实的）",
};

export const VIEW_LINK_TARGETS = ["original", "new_email"] as const;
export type ViewLinkTarget = (typeof VIEW_LINK_TARGETS)[number];

export type ViewLinkResendRefusal = "NOT_SITE_ORDER" | "PASSENGER_ANONYMIZED" | "NO_EMAIL_ON_FILE" | "SAME_AS_ORDER_EMAIL";

export interface ViewLinkResendFacts {
  /** 是不是官网的单（有官网的查看链接）。别的渠道的客人由渠道联系 */
  siteOrder: boolean;
  anonymized: boolean;
  /** 订单上现在的邮箱（解密后） */
  emailOnFile: string;
  target: ViewLinkTarget;
  newEmail: string | null;
}

/**
 * 运营重发链接能不能发；null = 可以。
 * - 只有官网的单：别的渠道的客人由渠道发通知（需求「客人：由渠道发；自有官网由平台发邮件」）；
 * - 已脱敏（ADR 0055）：没有邮箱，链接也全部作废了；
 * - 发到原邮箱要订单上有邮箱；发到新邮箱时新邮箱不能就是订单上的那个（那就是「发到原邮箱」，不用复核）。
 */
export function viewLinkResendRefusal(facts: ViewLinkResendFacts): ViewLinkResendRefusal | null {
  if (!facts.siteOrder) return "NOT_SITE_ORDER";
  if (facts.anonymized) return "PASSENGER_ANONYMIZED";
  const onFile = normalizeEmailForIndex(facts.emailOnFile);
  if (facts.target === "original") return onFile === "" ? "NO_EMAIL_ON_FILE" : null;
  return facts.newEmail !== null && onFile !== "" && normalizeEmailForIndex(facts.newEmail) === onFile ? "SAME_AS_ORDER_EMAIL" : null;
}

export const VIEW_LINK_RESEND_REFUSAL_MESSAGES: Readonly<Record<ViewLinkResendRefusal, string>> = {
  NOT_SITE_ORDER: "这不是官网的订单：客人的通知由下单的渠道发，平台不发订单链接",
  PASSENGER_ANONYMIZED: "这张单的乘客信息已按隐私规则清除，链接也已作废，不能再发",
  NO_EMAIL_ON_FILE: "这张单没有下单邮箱：核实客人身份后，选「发到核实后的新邮箱」",
  SAME_AS_ORDER_EMAIL: "新邮箱和下单邮箱是同一个：请选「发到下单邮箱」，不用复核",
};

/** 运营重发的连点保护：同一张单每小时最多 5 次（含发到新邮箱的申请）。 */
export const VIEW_LINK_STAFF_LIMIT = { max: 5, windowMs: 3_600_000 } as const;
