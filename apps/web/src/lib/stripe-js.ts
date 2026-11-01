/**
 * Stripe.js 的加载和本站用到的那一小部分类型（M3-08，ADR 0046）。
 *
 * Stripe.js 只能从 js.stripe.com 加载（`EXTERNAL_SCRIPTS.stripe`），不打包、不自托管；这里不引 `@stripe/stripe-js`
 * （它也只是插一个同样的 `<script>`），省一个依赖，类型只写本站用到的方法。
 * 加载失败（网络、被拦）时把这次的 `<script>` 拿掉、忘掉这次加载，客人点「重新加载」会真的再试一次。
 */
import { EXTERNAL_SCRIPTS } from "./external-scripts.ts";

/** Stripe.js 返回的错误（`type` 见 Stripe 文档：card_error、validation_error、invalid_request_error、api_connection_error 等）。 */
export interface StripeJsError {
  type: string;
  code?: string;
  decline_code?: string;
  /** Stripe 写给付款人看的话，已按 `locale` 翻译 */
  message?: string;
  payment_intent?: StripeJsPaymentIntent;
}

export interface StripeJsPaymentIntent {
  id: string;
  /** requires_payment_method / requires_confirmation / requires_action / processing / requires_capture / canceled / succeeded */
  status: string;
  last_payment_error?: { code?: string; message?: string } | null;
}

export type StripeJsResult = { paymentIntent?: StripeJsPaymentIntent; error?: StripeJsError };

/** Payment Element 的外观：颜色、字体、圆角取自本站的设计令牌（运行时从 CSS 变量读出），不写死。 */
export interface StripeAppearance {
  theme: "stripe" | "night";
  variables: Record<string, string>;
  rules: Record<string, Record<string, string>>;
}

export interface StripeJsElement {
  mount(container: HTMLElement): void;
  on(event: "ready" | "loaderror" | "change", handler: (event: { error?: StripeJsError; complete?: boolean }) => void): void;
  focus(): void;
  destroy(): void;
}

export interface StripeJsElements {
  create(type: "payment", options: Record<string, unknown>): StripeJsElement;
  /** 校验表单（卡号不完整等由 Stripe 在表单里标出来） */
  submit(): Promise<{ error?: StripeJsError }>;
  update(options: { appearance: StripeAppearance }): void;
}

export interface StripeJs {
  elements(options: { clientSecret: string; appearance: StripeAppearance; locale: string }): StripeJsElements;
  retrievePaymentIntent(clientSecret: string): Promise<StripeJsResult>;
  confirmPayment(options: { elements: StripeJsElements; confirmParams: { return_url: string }; redirect: "if_required" }): Promise<StripeJsResult>;
}

export type StripeJsFactory = (publishableKey: string, options: { locale: string }) => StripeJs;

/** Stripe.js 没加载出来：网络不通、被浏览器扩展或网络拦下、加载超时。 */
export class StripeJsLoadError extends Error {
  constructor() {
    super("Stripe.js 没有加载出来");
    this.name = "StripeJsLoadError";
  }
}

/** 等 Stripe.js 最多多久（毫秒）。超过就当没加载出来，让客人重试。 */
export const STRIPE_JS_TIMEOUT_MS = 20_000;

type Host = { Stripe?: StripeJsFactory };

let pending: Promise<StripeJsFactory> | null = null;

/**
 * 加载 Stripe.js（整个页面只插一次 `<script>`）。`append` 只给单元测试换：测试环境不真的去取站外脚本。
 */
export function loadStripeJs(append: (script: HTMLScriptElement) => void = (script) => document.head.append(script), timeoutMs = STRIPE_JS_TIMEOUT_MS): Promise<StripeJsFactory> {
  const loaded = (globalThis as Host).Stripe;
  if (loaded !== undefined) return Promise.resolve(loaded);
  if (pending !== null) return pending;
  const script = document.createElement("script");
  script.src = EXTERNAL_SCRIPTS.stripe;
  script.async = true;
  const attempt = new Promise<StripeJsFactory>((resolve, reject) => {
    const timer = setTimeout(() => reject(new StripeJsLoadError()), timeoutMs);
    script.addEventListener("load", () => {
      clearTimeout(timer);
      const factory = (globalThis as Host).Stripe;
      if (factory === undefined) reject(new StripeJsLoadError());
      else resolve(factory);
    });
    script.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new StripeJsLoadError());
    });
  });
  pending = attempt.catch((err: unknown) => {
    pending = null;
    script.remove();
    throw err;
  });
  append(script);
  return pending;
}
