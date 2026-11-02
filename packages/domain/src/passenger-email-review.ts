/**
 * 运营「代客人改单」改乘客邮箱要双人复核（M4-31，ADR 0065）的纯规则。
 *
 * 订单上的邮箱决定之后带订单管理链接的通知发到哪（ADR 0049、0061）：改掉它等于把订单交给另一个人，和「把订单链接发到核实后的新邮箱」
 * 同一类风险，所以同样要另一位同事批准。批准之前订单上的邮箱不变；同一次提交里的其他字段照常处理（ADR 0060）。
 * 客人自己（官网订单链接）、渠道替客人改不在这里：拿着链接的人本来就有权改。
 */
import { normalizeEmailForIndex } from "./privacy.ts";

/** 双人复核的类别（ADR 0023）。 */
export const PASSENGER_EMAIL_REVIEW_KIND = "order.passenger_email";

/** 代改的邮箱要不要复核：和订单上的比，按盲索引的口径（NFKC、不分大小写、去首尾空白）是同一个地址就不用；原来没有邮箱的也要。 */
export function passengerEmailNeedsReview(emailOnFile: string, requested: string): boolean {
  return normalizeEmailForIndex(emailOnFile) !== normalizeEmailForIndex(requested);
}

export type PassengerEmailReviewRefusal = "PASSENGER_ANONYMIZED" | "EMAIL_CHANGED_SINCE_REQUEST";

export interface PassengerEmailApprovalFacts {
  anonymized: boolean;
  /** 订单上现在的邮箱（解密后） */
  emailOnFile: string;
  /** 发起时订单上的邮箱 */
  emailAtRequest: string;
}

/**
 * 批准时还能不能改；null = 可以。已脱敏的单没有乘客信息可改；审核期间订单上的邮箱被别人改过（客人用订单链接、渠道），
 * 审核人批准的是「从旧地址改成新地址」，不能覆盖客人后来自己填的——驳回，需要的话重新发起。
 */
export function passengerEmailApprovalRefusal(facts: PassengerEmailApprovalFacts): PassengerEmailReviewRefusal | null {
  if (facts.anonymized) return "PASSENGER_ANONYMIZED";
  if (normalizeEmailForIndex(facts.emailOnFile) !== normalizeEmailForIndex(facts.emailAtRequest)) return "EMAIL_CHANGED_SINCE_REQUEST";
  return null;
}

export const PASSENGER_EMAIL_REVIEW_REFUSAL_MESSAGES: Readonly<Record<PassengerEmailReviewRefusal, string>> = {
  PASSENGER_ANONYMIZED: "这张单的乘客信息已按隐私规则清除，不能再改邮箱",
  EMAIL_CHANGED_SINCE_REQUEST: "审核期间订单上的邮箱已经被改过（客人或渠道），这条申请已经不适用",
};
