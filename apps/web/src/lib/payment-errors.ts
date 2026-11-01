/**
 * Stripe 的付款错误 → 给客人看的中文（M3-08，ADR 0046）。
 *
 * 不用 Stripe 的 `message`：确认付款时它按 locale 翻译，但之后再查付款（刷新、再打开）给的是英文，3D 验证失败时还是写给开发者的话。
 * 所以只看 `decline_code` 和 `code`（代码表见 Stripe 文档 error-codes、declines/codes），每句都写清原因和客人能做什么，页面不再另外加建议。
 *
 * 疑似盗刷、挂失、风控拦截（fraudulent、lost_card、stolen_card、merchant_blacklist 等）故意不进表：Stripe 要求不告诉客人真实原因，一律说被拒绝。
 */

export interface StripeFailure {
  type?: string | undefined;
  code?: string | undefined;
  decline_code?: string | undefined;
}

const DECLINED = "您的银行卡被拒绝了。请换一张卡，或联系发卡银行。";
const UNKNOWN = "银行没有接受这次付款。请换一张卡，或稍后再试；一直不行请联系客服。";
const CHECK_CARD = "请检查银行卡信息后再付。";

const NUMBER_WRONG = "卡号不正确。请检查后再付。";
const CVC_WRONG = "安全码不正确。请检查后再付。";
const EXPIRY_WRONG = "有效期不正确。请检查后再付。";
const EXPIRED = "这张卡已过期。请换一张卡。";
const NOT_SUPPORTED = "这张卡不支持这笔付款。请换一张卡。";
const OVER_LIMIT = "这张卡已超过可用额度或次数限制。请换一张卡，或联系发卡银行。";
const BANK_BUSY = "银行暂时没能处理这笔付款。请稍后再试，或换一张卡。";

const TEXTS: ReadonlyMap<string, string> = new Map([
  ["card_declined", DECLINED],
  ["generic_decline", DECLINED],
  ["insufficient_funds", "您的银行卡余额不足。请换一张卡。"],
  ["card_velocity_exceeded", OVER_LIMIT],
  ["withdrawal_count_limit_exceeded", OVER_LIMIT],
  ["expired_card", EXPIRED],
  ["card_not_supported", NOT_SUPPORTED],
  ["currency_not_supported", NOT_SUPPORTED],
  ["duplicate_transaction", "银行刚处理过一笔相同的付款，这次没有受理。请等几分钟，刷新页面看订单状态，还是待付款再重新付款。"],
  ["processing_error", BANK_BUSY],
  ["issuer_not_available", BANK_BUSY],
  ["try_again_later", BANK_BUSY],
  ["reenter_transaction", BANK_BUSY],
  ["payment_intent_authentication_failure", "银行验证没有通过。请重新付款并完成验证，或换一张卡。"],
  ["authentication_required", "银行要求验证，但这次验证没有完成。请重新付款并完成验证，或换一张卡。"],
  ["incorrect_number", NUMBER_WRONG],
  ["invalid_number", NUMBER_WRONG],
  ["incomplete_number", "卡号不完整。请检查后再付。"],
  ["incorrect_cvc", CVC_WRONG],
  ["invalid_cvc", CVC_WRONG],
  ["incomplete_cvc", "安全码不完整。请检查后再付。"],
  ["invalid_expiry_month", EXPIRY_WRONG],
  ["invalid_expiry_year", EXPIRY_WRONG],
  ["incomplete_expiry", "有效期不完整。请检查后再付。"],
  ["invalid_expiry_month_past", EXPIRED],
  ["invalid_expiry_year_past", EXPIRED],
  ["incorrect_zip", "邮编不正确。请检查后再付。"],
  ["incomplete_zip", "邮编不完整。请检查后再付。"],
]);

/** 表里所有的话（单元测试逐句核对：只有中文、建议不说两遍）。 */
export const PAYMENT_FAILURE_TEXTS: readonly string[] = [...new Set(TEXTS.values()), CHECK_CARD];

/** 一句完整的话：原因 + 客人能做什么。`decline_code` 比 `code` 具体，优先看。 */
export function paymentFailureText(failure: StripeFailure): string {
  const known = (failure.decline_code === undefined ? undefined : TEXTS.get(failure.decline_code)) ?? (failure.code === undefined ? undefined : TEXTS.get(failure.code));
  if (known !== undefined) return known;
  if (failure.decline_code !== undefined) return DECLINED;
  return failure.type === "validation_error" ? CHECK_CARD : UNKNOWN;
}
