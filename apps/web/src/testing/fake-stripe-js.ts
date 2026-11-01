/**
 * Stripe.js 的假实现（组件测试用，M3-08）：和真 Stripe.js 一样的调用方式（`Stripe(pk, { locale })` → `elements()` → `create("payment")` →
 * `mount` / `on("ready")`、`retrievePaymentIntent`、`elements.submit`、`confirmPayment`），结果由测试决定。从不连网络。
 * 记下每次调用，测试核对页面交给 Stripe 的东西（publishable key、client_secret、return_url、语言、外观）。
 */
import type { StripeAppearance, StripeJsError, StripeJsFactory, StripeJsPaymentIntent, StripeJsResult } from "../lib/stripe-js.ts";

export interface FakeStripeJs {
  /** 交给 `createStripePaymentDriver` 的加载函数 */
  load: () => Promise<StripeJsFactory>;
  /** 下一次加载失败（Stripe.js 没加载出来） */
  failLoads: number;
  /** `retrievePaymentIntent` 给出的付款；null = 查不到（网络错误） */
  intent: StripeJsPaymentIntent | null;
  /** Payment Element 能不能加载出来 */
  elementLoads: boolean;
  /** `elements.submit()` 的结果 */
  submit: () => Promise<{ error?: StripeJsError }>;
  /** `confirmPayment` 的结果；默认付款成功 */
  confirm: () => Promise<StripeJsResult>;
  calls: {
    stripe: { publishableKey: string; locale: string }[];
    elements: { clientSecret: string; locale: string; appearance: StripeAppearance }[];
    retrieve: string[];
    confirm: { return_url: string; redirect: string }[];
    appearanceUpdates: StripeAppearance[];
    mounted: number;
    destroyed: number;
  };
}

export function intentOf(status: string, lastError: string | null = null): StripeJsPaymentIntent {
  return { id: "pi_1", status, last_payment_error: lastError === null ? null : { code: "card_declined", message: lastError } };
}

export function fakeStripeJs(): FakeStripeJs {
  const fake: FakeStripeJs = {
    failLoads: 0,
    intent: intentOf("requires_payment_method"),
    elementLoads: true,
    submit: async () => ({}),
    confirm: async () => ({ paymentIntent: intentOf("succeeded") }),
    calls: { stripe: [], elements: [], retrieve: [], confirm: [], appearanceUpdates: [], mounted: 0, destroyed: 0 },
    load: async () => {
      if (fake.failLoads > 0) {
        fake.failLoads -= 1;
        throw new Error("Stripe.js 没有加载出来（假）");
      }
      return factory;
    },
  };
  const factory: StripeJsFactory = (publishableKey, options) => {
    fake.calls.stripe.push({ publishableKey, locale: options.locale });
    return {
      async retrievePaymentIntent(clientSecret) {
        fake.calls.retrieve.push(clientSecret);
        return fake.intent === null ? { error: { type: "api_connection_error" } } : { paymentIntent: fake.intent };
      },
      elements(options) {
        fake.calls.elements.push({ clientSecret: options.clientSecret, locale: options.locale, appearance: options.appearance });
        const elements = {
          create() {
            const handlers = new Map<string, (event: { error?: StripeJsError }) => void>();
            let node: HTMLElement | null = null;
            return {
              mount(container: HTMLElement) {
                fake.calls.mounted += 1;
                node = document.createElement("div");
                node.setAttribute("data-fake-stripe", "payment-element");
                node.textContent = "银行卡（Stripe）";
                container.append(node);
                setTimeout(() => (fake.elementLoads ? handlers.get("ready")?.({}) : handlers.get("loaderror")?.({ error: { type: "api_connection_error" } })), 0);
              },
              on(event: string, handler: (event: { error?: StripeJsError }) => void) {
                handlers.set(event, handler);
              },
              focus() {},
              destroy() {
                fake.calls.destroyed += 1;
                node?.remove();
              },
            };
          },
          submit: () => fake.submit(),
          update(next: { appearance: StripeAppearance }) {
            fake.calls.appearanceUpdates.push(next.appearance);
          },
        };
        return elements;
      },
      async confirmPayment(options) {
        fake.calls.confirm.push({ return_url: options.confirmParams.return_url, redirect: options.redirect });
        return fake.confirm();
      },
    };
  };
  return fake;
}
