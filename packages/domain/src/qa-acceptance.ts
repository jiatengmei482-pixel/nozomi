/**
 * 测试环境的验收通道（M8-26，ADR 0078）：验收角色凭口令解锁一个浏览器会话，在这个会话里官网只看 QA 测试供应商的「验收可售」商品、
 * 能下单、能用 Stripe 测试卡付款；这样的单是「验收单」，不进结算，邮件只发给验收专用的邮箱。
 *
 * 这里是纯规则（没有 IO）：开没开、会话多久、限速、客人邮箱和收件人的白名单、报价时商品算不算在卖。
 * 口令本身只经 `packages/config` 读，比较、发 Cookie、存会话在 apps/api。
 */
import type { ProductStatus } from "./products.ts";

/** 官网询价看哪一类商品：普通客人（`public`，已上架）还是验收会话（`acceptance`，测试供应商的验收可售）。两类从不混在一起。 */
export type SiteAudience = "public" | "acceptance";

/** 验收单唯一会真的收到邮件的地址（负责人指定）。 */
export const QA_ACCEPTANCE_MAIL_RECIPIENT = "qa-staging@nozomi.moveglobal.io";

export const QA_ACCEPTANCE_RULES = {
  /** 解锁后的会话有效期：4 小时（够跑一轮全链路验收，不长期留着） */
  sessionMs: 4 * 3_600_000,
  /** 会话 Cookie 的名字（只在 `/site/v1` 下发送） */
  cookieName: "nozomi_qa",
  cookiePath: "/site/v1",
  /** 口令的长度范围（配置校验用）：至少 32 个字符，最多 256 */
  tokenMinLength: 32,
  tokenMaxLength: 256,
  /** 解锁的限速：每个来源地址 15 分钟 10 次；全站每小时 30 次（换地址也猜不动）。成功、失败都计 */
  unlockPerIp: { max: 10, windowMs: 15 * 60_000 },
  unlockGlobal: { max: 30, windowMs: 3_600_000 },
} as const;

/**
 * 验收通道开没开：配置了口令，而且不是 production（两道关：production 配了口令启动就失败，这里再挡一次）。
 * `appEnv` 用字符串，domain 不依赖 config。
 */
export function qaAcceptanceEnabled(appEnv: string, tokenConfigured: boolean): boolean {
  return tokenConfigured && appEnv !== "production";
}

/** 口令的写法：32–256 个可见 ASCII 字符（不含空白）。不合格返回原因代码，不带原值。 */
export function qaAcceptanceTokenIssue(token: string): "TOO_SHORT" | "TOO_LONG" | "INVALID_CHARACTERS" | null {
  if (token.length < QA_ACCEPTANCE_RULES.tokenMinLength) return "TOO_SHORT";
  if (token.length > QA_ACCEPTANCE_RULES.tokenMaxLength) return "TOO_LONG";
  return /^[\x21-\x7e]+$/.test(token) ? null : "INVALID_CHARACTERS";
}

const normalized = (email: string): string => email.normalize("NFKC").trim().toLowerCase();

/**
 * 验收单的客人邮箱：只能是 `…@example.com`（保留给文档和测试的域名，永远不会有真人收到）或者正好是验收专用邮箱。
 * 不分大小写；`@sub.example.com`、`@example.com.cn` 这类都不算。
 */
export function qaAcceptanceGuestEmailAllowed(email: string): boolean {
  const value = normalized(email);
  if (value === QA_ACCEPTANCE_MAIL_RECIPIENT) return true;
  const at = value.lastIndexOf("@");
  return at > 0 && value.indexOf("@") === at && value.slice(at + 1) === "example.com";
}

/** 验收单的邮件真的发出去吗：只有收件人正好是验收专用邮箱才发；其余（客人、供应商、司机、运营）一律不发，只留存内容。 */
export function qaAcceptanceMailAllowed(recipient: string): boolean {
  return normalized(recipient) === QA_ACCEPTANCE_MAIL_RECIPIENT;
}

/**
 * 报价时这个商品算不算「在卖」：普通客人只认已上架；验收会话只认测试供应商的验收可售（不看供应商的入驻状态：它永远停在申请中）。
 * 返回 null 表示在卖，否则是拒绝的原因（和报价引擎的原因代码一致）。
 */
export function listedFor(audience: SiteAudience, product: { status: ProductStatus; tenantActive: boolean; testTenant?: boolean }): "PRODUCT_NOT_PUBLISHED" | "TENANT_NOT_ACTIVE" | null {
  if (audience === "acceptance") return product.status === "qa_listed" && product.testTenant === true ? null : "PRODUCT_NOT_PUBLISHED";
  if (product.status !== "published") return "PRODUCT_NOT_PUBLISHED";
  return product.tenantActive ? null : "TENANT_NOT_ACTIVE";
}
