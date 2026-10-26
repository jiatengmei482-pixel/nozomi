/**
 * 付款组件的接入点（M3-05，ADR 0032）。订单页只认 `PaymentDriver` 这个接口：挂上付款表单、确认付款、拆掉。
 * 真实实现用 Stripe Elements（只用 publishable key，从 `GET /site/v1/config` / 下单应答里拿，不写死），在 Stripe 上线的任务里接；组件测试用替身。
 *
 * 付款结果只认 Stripe 发给平台的通知（ADR 0026）：这里的「确认成功」只代表 Stripe 接受了这次付款，页面随后刷新订单，
 * 订单是否「已确认」以平台为准，前端不自己宣布付款成功。
 */
import { createContext, useContext } from "react";

export interface PaymentMount {
  /** 客人点「付款」：确认付款（需要时弹出 3DS 验证）。失败时 `message` 是给客人看的话 */
  confirm(): Promise<{ ok: true } | { ok: false; message: string }>;
  destroy(): void;
}

export interface PaymentDriver {
  /** 在 `container` 里挂上付款表单（卡号等由 Stripe 的 iframe 收，不经过本站）。 */
  mount(container: HTMLElement, options: { publishableKey: string; clientSecret: string }): Promise<PaymentMount>;
}

/**
 * 现在用的实现：还没有接入 Stripe.js，挂付款表单时直接失败，页面告诉客人「在线付款还在接入中」。
 * 不在这里加载 Stripe.js：站外脚本要先放进内容安全策略和站外地址的登记（styles.edge.test.ts 的守则），属于 Stripe 上线的任务。
 * 那时新写一个 Stripe Elements 的实现（`loadStripe(publishableKey)` → `elements({ clientSecret })` → `create("payment")` → `confirmPayment({ redirect: "if_required" })`），
 * 换掉这里的默认值即可，订单页不用改。
 */
export class PaymentNotIntegratedError extends Error {
  constructor() {
    super("在线付款组件还没有接入");
    this.name = "PaymentNotIntegratedError";
  }
}

export const unavailablePaymentDriver: PaymentDriver = {
  mount: () => Promise.reject(new PaymentNotIntegratedError()),
};

export const PaymentDriverContext = createContext<PaymentDriver>(unavailablePaymentDriver);

export function usePaymentDriver(): PaymentDriver {
  return useContext(PaymentDriverContext);
}
