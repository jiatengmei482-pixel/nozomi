/**
 * 运营后台「测试一下」的结果（M4-09，ADR 0041）：可用，或不可用 + 原因代码 + 一句话说明。
 * 说明是我们自己写的，不带对方返回的原文（里面可能有请求的内容），更不带密钥。
 */
export type IntegrationCheckCode =
  /** 密钥不对（写错了、被删了、被作废了） */
  | "KEY_INVALID"
  /** 谷歌云项目里没有启用这个 API */
  | "API_NOT_ENABLED"
  /** 密钥设了限制，不允许调用这个 API（或不允许从这台服务器调用） */
  | "KEY_RESTRICTED"
  /** 谷歌云项目没有绑定付款方式 */
  | "BILLING_DISABLED"
  /** 权限不够（Stripe 的受限密钥没有读余额的权限，或别的拒绝访问） */
  | "PERMISSION_DENIED"
  /** 用量超限或被限流 */
  | "QUOTA_EXCEEDED"
  /** Stripe：密钥是测试的却连到了正式账户（或反过来） */
  | "MODE_MISMATCH"
  /** 在时限内没有应答（已重试） */
  | "TIMEOUT"
  /** 连不上（网络不通、域名解析失败）（已重试） */
  | "UNREACHABLE"
  /** 对方服务出错（5xx）（已重试） */
  | "UNAVAILABLE"
  /** 对方的应答看不懂 */
  | "UNEXPECTED";

export type IntegrationCheckResult = { ok: true } | { ok: false; code: IntegrationCheckCode; message: string };

export const CHECK_MESSAGES: Readonly<Record<IntegrationCheckCode, string>> = {
  KEY_INVALID: "密钥无效：请核对是否复制完整，或到对方的后台确认这把密钥还在",
  API_NOT_ENABLED: "这个谷歌云项目还没有启用 Routes API：到 Google Cloud Console →「API 和服务」里启用后再试",
  KEY_RESTRICTED: "密钥设了限制，不允许调用 Routes API（或不允许从这台服务器调用）：到 Google Cloud Console 的凭据页面检查这把密钥的限制",
  BILLING_DISABLED: "这个谷歌云项目还没有绑定付款方式：到 Google Cloud Console 的「结算」里绑定后再试",
  PERMISSION_DENIED: "密钥的权限不够：请换一把有读取权限的密钥",
  QUOTA_EXCEEDED: "用量超过了上限，或请求太频繁：稍后再试，或到对方后台检查每日用量上限",
  MODE_MISMATCH: "密钥的测试 / 正式模式和账户对不上",
  TIMEOUT: "对方在时限内没有应答（已重试）：稍后再试",
  UNREACHABLE: "连不上对方的服务器（网络不通）：稍后再试；一直这样请联系技术人员检查服务器的网络",
  UNAVAILABLE: "对方的服务暂时出错（已重试）：稍后再试",
  UNEXPECTED: "对方的应答看不懂：稍后再试；一直这样请联系技术人员",
};

export function checkFailed(code: IntegrationCheckCode): IntegrationCheckResult {
  return { ok: false, code, message: CHECK_MESSAGES[code] };
}
