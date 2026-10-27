/**
 * 付款组件的接入点（M3-05 定接口，M3-08 接上 Stripe Elements，ADR 0032、0046）。订单页只认 `PaymentDriver`：挂上付款表单、校验、确认付款、拆掉。
 * 真实实现是 `stripePaymentDriver`：Stripe.js 从 js.stripe.com 加载，用后端给的 publishable key 和 client_secret（`GET /site/v1/order/payment`）
 * 挂 Payment Element，`confirmPayment({ redirect: "if_required" })` 确认付款（3D 验证由 Stripe 弹窗完成）。组件测试换成 Stripe.js 的假实现。
 *
 * 付款结果只认 Stripe 发给平台的通知（ADR 0026）：这里的「成功」只代表 Stripe 接受了这次付款，订单页随后轮询订单，
 * 订单是否「已确认」以平台为准，前端不自己宣布订单已确认。
 */
import { createContext, useContext } from "react";
import { type StripeAppearance, type StripeJsError, type StripeJsFactory, type StripeJsPaymentIntent, type StripeJsResult, loadStripeJs } from "./stripe-js.ts";

/** 挂表单时这笔付款在 Stripe 那边的样子。客人已经付过（刷新页面、从银行验证页回来）时不再显示表单。 */
export type PaymentIntentState = "open" | "processing" | "succeeded" | "canceled";

export type ConfirmOutcome =
  /** Stripe 收下了这笔付款，等平台收到通知后确认订单 */
  | { kind: "succeeded" }
  /** 银行还在处理（少数卡），处理完 Stripe 通知平台 */
  | { kind: "processing" }
  /** 卡被拒、验证没通过、卡号填得不对：`message` 是 Stripe 写给付款人的话，可以改了或换卡再付 */
  | { kind: "declined"; message: string }
  /** 没连上 Stripe：这次付款可能没提交，可以再点（同一笔付款，不会扣两次） */
  | { kind: "network" }
  /** 其他原因没付成；`message` 是 Stripe 给的说明（可能没有） */
  | { kind: "failed"; message: string | null };

export interface PaymentMount {
  readonly state: PaymentIntentState;
  /** 上一次没付成的原因（从银行验证页回来、刷新时 Stripe 告诉的），没有为 null */
  readonly lastError: string | null;
  /** 校验表单；不完整时 Stripe 在表单里标出，`message` 再给一句总的 */
  validate(): Promise<{ ok: true } | { ok: false; message: string }>;
  /** 确认付款（需要时弹出 3D 验证）。`returnUrl`：少数需要整页跳去银行的情况，验证完回到这里 */
  confirm(returnUrl: string): Promise<ConfirmOutcome>;
  destroy(): void;
}

export interface PaymentDriver {
  /** 在 `container` 里挂上付款表单（卡号等由 Stripe 的 iframe 收，不经过本站）。加载失败时抛 `PaymentLoadError`。 */
  mount(container: HTMLElement, options: { publishableKey: string; clientSecret: string }): Promise<PaymentMount>;
}

/** 付款组件没加载出来（Stripe.js 或 Payment Element 加载失败、查不到这笔付款）：页面提示检查网络后「重新加载」。 */
export class PaymentLoadError extends Error {
  constructor(what: string) {
    super(what);
    this.name = "PaymentLoadError";
  }
}

/** 官网是中文界面：Stripe 表单和它给的出错说明用简体中文。 */
export const STRIPE_LOCALE = "zh";

/** Stripe 给的错误里，哪些是「卡 / 填写的问题」——原话给客人看，客人可以改了或换卡再付。 */
const DECLINE_TYPES = new Set(["card_error", "validation_error"]);
const AUTHENTICATION_FAILED = "payment_intent_authentication_failure";

function stateOf(intent: StripeJsPaymentIntent): PaymentIntentState {
  switch (intent.status) {
    case "succeeded":
    case "requires_capture":
      return "succeeded";
    case "processing":
      return "processing";
    case "canceled":
      return "canceled";
    default:
      return "open";
  }
}

function outcomeOf(intent: StripeJsPaymentIntent): ConfirmOutcome {
  const state = stateOf(intent);
  if (state === "succeeded") return { kind: "succeeded" };
  if (state === "processing") return { kind: "processing" };
  const message = intent.last_payment_error?.message ?? null;
  return message === null ? { kind: "failed", message: null } : { kind: "declined", message };
}

/** Stripe 的错误 → 给页面的结果。 */
export function outcomeOfError(error: StripeJsError): ConfirmOutcome {
  if (error.type === "api_connection_error") return { kind: "network" };
  const message = error.message ?? null;
  if ((DECLINE_TYPES.has(error.type) || error.code === AUTHENTICATION_FAILED) && message !== null) return { kind: "declined", message };
  return { kind: "failed", message };
}

function darkTheme(): boolean {
  const chosen = document.documentElement.dataset["theme"];
  if (chosen === "dark" || chosen === "light") return chosen === "dark";
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Payment Element 的外观：Stripe 的表单在 iframe 里，读不到本站的 CSS 变量，所以挂表单时把设计令牌的当前值读出来交给它；
 * 主题切换时重新读一遍（见 `watchTheme`）。读不到（值为空）的项不传，用 Stripe 的默认值。
 */
export function stripeAppearance(): StripeAppearance {
  const style = getComputedStyle(document.documentElement);
  const pick = (entries: [string, string][]): Record<string, string> =>
    Object.fromEntries(entries.map(([key, name]) => [key, style.getPropertyValue(name).trim()]).filter(([, value]) => value !== ""));
  return {
    theme: darkTheme() ? "night" : "stripe",
    variables: pick([
      ["colorPrimary", "--color-primary"],
      ["colorBackground", "--color-bg-surface"],
      ["colorText", "--color-text-primary"],
      ["colorTextSecondary", "--color-text-secondary"],
      ["colorTextPlaceholder", "--color-text-tertiary"],
      ["colorDanger", "--color-danger-text"],
      ["fontFamily", "--font-family-sans"],
      ["fontSizeBase", "--font-size-lg"],
      ["borderRadius", "--radius-md"],
    ]),
    rules: {
      ".Input": pick([["borderColor", "--color-border-strong"]]),
      ".Input:focus": pick([["borderColor", "--color-border-focus"]]),
      ".Label": pick([["color", "--color-text-primary"]]),
    },
  };
}

/** 主题变了（手动切换、跟随系统时系统变了）就调 `onChange`。返回取消监听的函数。 */
function watchTheme(onChange: () => void): () => void {
  const observer = typeof MutationObserver === "function" ? new MutationObserver(onChange) : null;
  observer?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  media?.addEventListener("change", onChange);
  return () => {
    observer?.disconnect();
    media?.removeEventListener("change", onChange);
  };
}

/** 没有表单的挂载（付款已经成功、处理中、已取消）：不能再确认。 */
function settledMount(state: Exclude<PaymentIntentState, "open">): PaymentMount {
  const outcome: ConfirmOutcome = state === "succeeded" ? { kind: "succeeded" } : state === "processing" ? { kind: "processing" } : { kind: "failed", message: null };
  return { state, lastError: null, validate: async () => ({ ok: true }), confirm: async () => outcome, destroy: () => undefined };
}

const connectionError = (): StripeJsResult => ({ error: { type: "api_connection_error" } });

/**
 * Stripe Elements 的实现。`load` 只给测试换（Stripe.js 的假实现）；默认从 js.stripe.com 加载。
 * 挂表单前先查这笔付款的状态：已经付过、处理中的不再显示表单（刷新页面、从银行验证页回来时）。
 */
export function createStripePaymentDriver(load: () => Promise<StripeJsFactory> = () => loadStripeJs()): PaymentDriver {
  return {
    async mount(container, { publishableKey, clientSecret }) {
      let factory: StripeJsFactory;
      try {
        factory = await load();
      } catch {
        throw new PaymentLoadError("Stripe.js 没有加载出来");
      }
      const stripe = factory(publishableKey, { locale: STRIPE_LOCALE });
      const retrieved = await stripe.retrievePaymentIntent(clientSecret).catch(connectionError);
      if (retrieved.paymentIntent === undefined) throw new PaymentLoadError("查不到这笔付款");
      const state = stateOf(retrieved.paymentIntent);
      if (state !== "open") return settledMount(state);
      const lastError = retrieved.paymentIntent.last_payment_error?.message ?? null;

      const elements = stripe.elements({ clientSecret, appearance: stripeAppearance(), locale: STRIPE_LOCALE });
      const element = elements.create("payment", { layout: "tabs" });
      const ready = new Promise<void>((resolve, reject) => {
        element.on("ready", () => resolve());
        element.on("loaderror", () => reject(new PaymentLoadError("付款表单没有加载出来")));
      });
      element.mount(container);
      try {
        await ready;
      } catch (err) {
        element.destroy();
        throw err;
      }
      const stopWatching = watchTheme(() => elements.update({ appearance: stripeAppearance() }));

      // 确认时出了不认识的错、或没连上（例如另一个标签页已经付过、确认请求发出去了但应答丢了）：再查一次这笔付款，已付过的按已付过算
      const recheck = async (fallback: ConfirmOutcome): Promise<ConfirmOutcome> => {
        const again = await stripe.retrievePaymentIntent(clientSecret).catch(connectionError);
        if (again.paymentIntent !== undefined && stateOf(again.paymentIntent) !== "open") return outcomeOf(again.paymentIntent);
        return fallback;
      };

      return {
        state,
        lastError,
        async validate() {
          const result: { error?: StripeJsError } = await elements.submit().catch(connectionError);
          if (result.error?.type === "validation_error") return { ok: false, message: result.error.message ?? "请检查银行卡信息" };
          return { ok: true };
        },
        async confirm(returnUrl) {
          const result = await stripe.confirmPayment({ elements, confirmParams: { return_url: returnUrl }, redirect: "if_required" }).catch(connectionError);
          if (result.error !== undefined) {
            const outcome = outcomeOfError(result.error);
            return outcome.kind === "failed" || outcome.kind === "network" ? recheck(outcome) : outcome;
          }
          return result.paymentIntent === undefined ? recheck({ kind: "failed", message: null }) : outcomeOf(result.paymentIntent);
        },
        destroy() {
          stopWatching();
          element.destroy();
        },
      };
    },
  };
}

export const stripePaymentDriver: PaymentDriver = createStripePaymentDriver();

export const PaymentDriverContext = createContext<PaymentDriver>(stripePaymentDriver);

export function usePaymentDriver(): PaymentDriver {
  return useContext(PaymentDriverContext);
}
