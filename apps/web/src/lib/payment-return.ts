/**
 * 付款时被带去银行页面、再回到订单页（M3-08，ADR 0046）：订单页靠这里取回查看令牌。
 *
 * 银行卡的 3D 验证一般在 Stripe 的弹窗里完成，页面不离开；只有少数情况 Stripe 会把整页带去银行的页面，验证完回到
 * `return_url`（Stripe 在后面加 `?payment_intent=…&payment_intent_client_secret=…&redirect_status=…`）。
 * 订单页的令牌平时只在地址的 `#` 后面和请求头里（ADR 0032），**不能放进 return_url**：return_url 会发给 Stripe、记在这笔付款上。
 * 所以确认付款前把令牌放进本标签页的 sessionStorage（只在这一个标签页、关掉就没），回来时按付款编号核对后取出并立刻删掉；
 * 确认付款有了结果（没跳走）也立刻删掉。这是令牌唯一一次进浏览器存储，键只有这一个。
 */

const RETURN_KEY = "nozomi.payment-return";
/** 存了多久以后不再认（毫秒）：去银行页面验证不会超过这么久，过了就当是很久以前留下的 */
export const PAYMENT_RETURN_MAX_AGE_MS = 60 * 60_000;

/** 回到订单页时 Stripe 加在地址上的参数（有 payment_intent 才算是从付款回来）。 */
export interface PaymentReturnParams {
  intentId: string;
  redirectStatus: string | null;
}

/** client_secret 的格式是 `pi_…_secret_…`：前半段就是付款编号。 */
export function intentIdOf(clientSecret: string): string | null {
  const match = /^(pi_[A-Za-z0-9]+)_secret_[A-Za-z0-9]+$/.exec(clientSecret);
  return match?.[1] ?? null;
}

export function paymentReturnParams(search: string): PaymentReturnParams | null {
  const params = new URLSearchParams(search);
  const intentId = params.get("payment_intent");
  if (intentId === null || !/^pi_[A-Za-z0-9]+$/.test(intentId)) return null;
  return { intentId, redirectStatus: params.get("redirect_status") };
}

/** 确认付款前：记下这一笔付款对应哪个订单令牌。 */
export function rememberPaymentReturn(intentId: string, token: string, now = Date.now()): void {
  try {
    sessionStorage.setItem(RETURN_KEY, JSON.stringify({ intentId, token, at: now }));
  } catch {
    // 存不了（隐私模式、存储满）：不影响在弹窗里验证；真被带去银行页面再回来时，订单页会让客人用订单号找回
  }
}

export function forgetPaymentReturn(): void {
  try {
    sessionStorage.removeItem(RETURN_KEY);
  } catch {
    // 存储不可用时本来就没存
  }
}

/** 回到订单页：取出这一笔付款对应的令牌（付款编号对上、没过期才给），无论对没对上都删掉。 */
export function takePaymentReturn(intentId: string, now = Date.now()): string | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(RETURN_KEY);
  } catch {
    return null;
  }
  forgetPaymentReturn();
  if (raw === null) return null;
  try {
    const saved = JSON.parse(raw) as { intentId?: unknown; token?: unknown; at?: unknown };
    if (saved.intentId !== intentId || typeof saved.token !== "string" || typeof saved.at !== "number") return null;
    if (now - saved.at > PAYMENT_RETURN_MAX_AGE_MS || saved.at > now + 60_000) return null;
    return saved.token;
  } catch {
    return null;
  }
}
