/**
 * 端到端测试里的「Stripe」（M3-08，ADR 0046）：测试从不连真实的 Stripe，也不需要任何真实密钥。由三部分组成：
 *
 * 1. 假 Stripe 服务（本机 HTTP，global-setup 启动）：后端经 `STRIPE_API_URL` 调它建 Customer、PaymentIntent、查、取消（和 Stripe 一样的路径和
 *    form 编码的请求，按 Idempotency-Key 去重）；浏览器里的假 Stripe.js 确认付款、查付款时也到这里（经下面的转发）。
 *    付款有了结果就像 Stripe 一样给后端发签了名的 Webhook（`payment_intent.succeeded` / `payment_intent.payment_failed`），稍等一会儿再发，
 *    页面能看到「付款成功，等待确认」再变成已确认。签名用后端同一个函数、本次运行临时生成的 whsec。
 * 2. 假 Stripe.js：和真的一样从 https://js.stripe.com/v3/ 加载（`routeStripe` 拦下这个地址回这段脚本），所以内容安全策略照样起作用。
 *    付款表单里放一个 js.stripe.com 的 iframe（核对 frame-src），卡号框在页面上（测试好填）；3D 验证弹出一个 hooks.stripe.com 的 iframe
 *    （核对 frame-src），里面「完成验证 / 验证失败」两个按钮；查付款、确认付款调 https://api.stripe.com（核对 connect-src）。
 * 3. `routeStripe(page)`：把 js.stripe.com、api.stripe.com、hooks.stripe.com 的请求在浏览器网络层拦下，转给假 Stripe 服务；
 *    别的 *.stripe.com 一律拦下并记录（正常情况下一个都不该有）。被内容安全策略拦下的请求根本到不了这里。
 *
 * 测试卡号沿用 Stripe 的测试卡：4242… 成功、4000 0027 6000 3184 要 3D 验证、4000 0000 0000 0002 被拒、4000 0000 0000 9995 余额不足。
 */
import { randomBytes } from "node:crypto";
import { type Server, createServer } from "node:http";
import type { Page } from "@playwright/test";
import { stripeSignatureHeader } from "../../api/src/integrations/stripe-signature.ts";

export const TEST_CARDS = {
  success: "4242 4242 4242 4242",
  threeDs: "4000 0027 6000 3184",
  declined: "4000 0000 0000 0002",
  insufficientFunds: "4000 0000 0000 9995",
} as const;

/** 假 Stripe 写给付款人看的话（真 Stripe 按 locale 翻译，这里直接用中文）。 */
export const FAKE_STRIPE_MESSAGES = {
  declined: "您的银行卡被拒绝了。",
  insufficientFunds: "您的卡余额不足。",
  incomplete: "您的卡号不完整。",
  authenticationFailed: "我们无法验证您的支付方式。请选择另一种支付方式并重试。",
} as const;

/** 付款有了结果后多久才给后端发通知（毫秒）：页面先显示「付款成功，等待确认」，再轮询到已确认。 */
const WEBHOOK_DELAY_MS = 1_500;

interface Intent {
  id: string;
  clientSecret: string;
  amount: number;
  currency: string;
  customer: string;
  status: string;
  paymentMethod: string | null;
  lastError: { type: string; code: string; decline_code: string | null; message: string } | null;
  metadata: Record<string, string>;
}

export interface FakeStripeService {
  url: string;
  close(): Promise<void>;
}

const hex = (bytes: number): string => randomBytes(bytes).toString("hex");

/** Stripe 的请求体是 form 编码，嵌套字段写成 `metadata[order_id]`。 */
function formOf(body: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body));
}

function intentJson(intent: Intent, full: boolean): Record<string, unknown> {
  const base = { id: intent.id, object: "payment_intent", amount: intent.amount, currency: intent.currency, status: intent.status, client_secret: intent.clientSecret, livemode: false, last_payment_error: intent.lastError, payment_method: intent.paymentMethod };
  // 用 publishable key 查（浏览器）时 Stripe 不给 customer、metadata
  return full ? { ...base, customer: intent.customer, setup_future_usage: "off_session", metadata: intent.metadata } : base;
}

const THREE_DS_PAGE = (id: string): string => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>银行验证（假）</title></head>
<body><h1>银行验证（假 Stripe）</h1><p>付款编号 ${id}</p>
<form method="post" action="/3d_secure/${id}/complete?result=pass"><button type="submit">完成验证</button></form>
<form method="post" action="/3d_secure/${id}/complete?result=fail"><button type="submit">验证失败</button></form></body></html>`;

/**
 * 启动假 Stripe 服务。`webhookUrl` / `webhookSecret`：付款有结果后往哪里发通知、用什么签名。
 * 后端调它要带 `Authorization: Bearer sk_test_…`（和 Stripe 一样，用密钥调的接口才给完整对象）。
 */
export async function startFakeStripeService(options: { webhookUrl: string; webhookSecret: string; secretKey: string }): Promise<FakeStripeService> {
  const intents = new Map<string, Intent>();
  const idempotent = new Map<string, { status: number; body: unknown }>();
  const timers = new Set<NodeJS.Timeout>();

  const notify = (type: string, intent: Intent): void => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      const body = JSON.stringify({ id: `evt_e2e${hex(8)}`, object: "event", api_version: "2026-09-30", created: Math.floor(Date.now() / 1000), livemode: false, type, data: { object: intentJson(intent, true) } });
      void fetch(options.webhookUrl, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": stripeSignatureHeader(body, options.webhookSecret, Math.floor(Date.now() / 1000)) }, body }).catch(() => undefined);
    }, WEBHOOK_DELAY_MS);
    timers.add(timer);
  };

  const succeed = (intent: Intent): void => {
    intent.status = "succeeded";
    intent.paymentMethod = `pm_e2e${hex(6)}`;
    intent.lastError = null;
    notify("payment_intent.succeeded", intent);
  };
  const decline = (intent: Intent, error: NonNullable<Intent["lastError"]>): void => {
    intent.status = "requires_payment_method";
    intent.lastError = error;
    notify("payment_intent.payment_failed", intent);
  };

  const server: Server = createServer((request, response) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (raw += chunk));
    request.on("end", () => {
      const url = new URL(request.url ?? "/", "http://fake-stripe");
      const send = (status: number, body: unknown, contentType = "application/json"): void => {
        response.writeHead(status, { "content-type": contentType, "request-id": `req_e2e${hex(4)}`, "access-control-allow-origin": "*", "cache-control": "no-store" });
        response.end(typeof body === "string" ? body : JSON.stringify(body));
      };
      const fail = (status: number, type: string, code: string, message: string): void => send(status, { error: { type, code, message } });
      const withKey = request.headers.authorization === `Bearer ${options.secretKey}`;
      const segments = url.pathname.split("/").filter(Boolean);

      // ---- 后端用密钥调的接口 ----
      if (request.method === "POST" && url.pathname === "/v1/customers") {
        if (!withKey) return fail(401, "invalid_request_error", "api_key_invalid", "Invalid API Key provided");
        return send(200, { id: `cus_e2e${hex(6)}`, object: "customer" });
      }
      if (request.method === "POST" && url.pathname === "/v1/payment_intents") {
        if (!withKey) return fail(401, "invalid_request_error", "api_key_invalid", "Invalid API Key provided");
        const key = String(request.headers["idempotency-key"] ?? "");
        const replay = idempotent.get(key);
        if (replay !== undefined) return send(replay.status, replay.body);
        const form = formOf(raw);
        const id = `pi_e2e${hex(8)}`;
        const intent: Intent = {
          id,
          clientSecret: `${id}_secret_${hex(10)}`,
          amount: Number(form["amount"]),
          currency: form["currency"] ?? "jpy",
          customer: form["customer"] ?? "",
          status: "requires_payment_method",
          paymentMethod: null,
          lastError: null,
          metadata: { order_id: form["metadata[order_id]"] ?? "", order_no: form["metadata[order_no]"] ?? "" },
        };
        intents.set(id, intent);
        const body = intentJson(intent, true);
        if (key !== "") idempotent.set(key, { status: 200, body });
        return send(200, body);
      }
      if (request.method === "GET" && url.pathname === "/v1/balance") return send(200, { object: "balance", livemode: false, available: [], pending: [] });

      // ---- 付款：后端（密钥）和浏览器（client_secret）都能查；浏览器确认付款 ----
      if (segments[0] === "v1" && segments[1] === "payment_intents" && segments[2] !== undefined) {
        const intent = intents.get(segments[2]);
        if (intent === undefined) return fail(404, "invalid_request_error", "resource_missing", "No such payment_intent");
        const form = formOf(raw);
        const secret = url.searchParams.get("client_secret") ?? form["client_secret"];
        if (!withKey && secret !== intent.clientSecret) return fail(401, "invalid_request_error", "payment_intent_invalid_parameter", "The client_secret provided does not match");
        if (request.method === "GET" && segments.length === 3) return send(200, intentJson(intent, withKey));
        if (request.method === "POST" && segments[3] === "cancel" && withKey) {
          if (intent.status !== "succeeded") intent.status = "canceled";
          return send(200, intentJson(intent, true));
        }
        if (request.method === "POST" && segments[3] === "confirm") {
          if (intent.status === "succeeded" || intent.status === "canceled") return send(400, { error: { type: "invalid_request_error", code: "payment_intent_unexpected_state", message: "这笔付款已经完成或已取消。", payment_intent: intentJson(intent, false) } });
          const card = (form["card"] ?? "").replace(/\s/g, "");
          if (card === TEST_CARDS.success.replace(/\s/g, "")) {
            succeed(intent);
            return send(200, intentJson(intent, false));
          }
          if (card === TEST_CARDS.threeDs.replace(/\s/g, "")) {
            intent.status = "requires_action";
            intent.lastError = null;
            return send(200, { ...intentJson(intent, false), next_action: { type: "use_stripe_sdk" } });
          }
          const error =
            card === TEST_CARDS.insufficientFunds.replace(/\s/g, "")
              ? { type: "card_error", code: "card_declined", decline_code: "insufficient_funds", message: FAKE_STRIPE_MESSAGES.insufficientFunds }
              : { type: "card_error", code: "card_declined", decline_code: "generic_decline", message: FAKE_STRIPE_MESSAGES.declined };
          decline(intent, error);
          return send(402, { error: { ...error, payment_intent: intentJson(intent, false) } });
        }
      }

      // ---- 3D 验证（hooks.stripe.com 的 iframe 里） ----
      if (segments[0] === "3d_secure" && segments[1] !== undefined) {
        const intent = intents.get(segments[1]);
        if (intent === undefined) return send(404, "<p>没有这笔付款</p>", "text/html; charset=utf-8");
        if (request.method === "GET" && segments.length === 2) return send(200, THREE_DS_PAGE(intent.id), "text/html; charset=utf-8");
        if (request.method === "POST" && segments[2] === "complete" && intent.status === "requires_action") {
          if (url.searchParams.get("result") === "pass") succeed(intent);
          else decline(intent, { type: "card_error", code: "payment_intent_authentication_failure", decline_code: null, message: FAKE_STRIPE_MESSAGES.authenticationFailed });
          return send(200, "<p>验证已结束，可以关闭</p>", "text/html; charset=utf-8");
        }
      }
      send(404, { error: { type: "invalid_request_error", code: "resource_missing", message: `假 Stripe 不认识 ${request.method} ${url.pathname}` } });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const url = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`;
  return {
    url,
    close: async () => {
      for (const timer of timers) clearTimeout(timer);
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * 假 Stripe.js（浏览器里运行；由 `routeStripe` 当作 https://js.stripe.com/v3/ 的内容返回）。只实现本站用到的方法，行为照真 Stripe.js：
 * 查付款、挂表单（`ready` 事件）、`elements.submit()` 校验、`confirmPayment({ redirect: "if_required" })`（要 3D 验证时弹出验证框，等验证结束再给结果）。
 * 样式只用 CSSOM 设置（和真 Stripe.js 一样，不受 style-src 限制）。
 */
const FAKE_STRIPE_JS = String.raw`(function () {
  var API = "https://api.stripe.com/v1/payment_intents/";
  function idOf(secret) { return secret.split("_secret_")[0]; }
  function call(method, secret, path, fields) {
    var url = API + idOf(secret) + (path || "");
    var body = null;
    if (method === "GET") url += "?client_secret=" + encodeURIComponent(secret);
    else body = new URLSearchParams(Object.assign({ client_secret: secret }, fields || {})).toString();
    return fetch(url, { method: method, headers: body === null ? {} : { "content-type": "application/x-www-form-urlencoded" }, body: body }).then(function (response) { return response.json(); });
  }
  function Stripe(publishableKey, options) {
    if (!/^pk_test_/.test(publishableKey)) throw new Error("假 Stripe.js 只认测试用的 publishable key");
    window.__fakeStripe = { publishableKey: publishableKey, locale: options && options.locale };
    function retrieve(secret) {
      return call("GET", secret).then(function (intent) { return intent.error ? { error: intent.error } : { paymentIntent: intent }; }, function () { return { error: { type: "api_connection_error" } }; });
    }
    return {
      retrievePaymentIntent: retrieve,
      elements: function (elementsOptions) {
        var input = null;
        var elements = {
          __secret: elementsOptions.clientSecret,
          __card: function () { return input === null ? "" : input.value.replace(/\s/g, ""); },
          create: function () {
            var handlers = {};
            var wrap = null;
            return {
              mount: function (container) {
                wrap = document.createElement("div");
                var label = document.createElement("label");
                label.textContent = "卡号（假 Stripe）";
                input = document.createElement("input");
                input.setAttribute("inputmode", "numeric");
                input.setAttribute("autocomplete", "cc-number");
                input.style.display = "block";
                label.appendChild(input);
                var frame = document.createElement("iframe");
                frame.title = "Stripe 付款表单（假）";
                frame.src = "https://js.stripe.com/v3/elements-inner.html";
                frame.style.border = "0";
                frame.style.width = "100%";
                frame.style.height = "1px";
                frame.addEventListener("load", function () { if (handlers.ready) handlers.ready({}); });
                wrap.appendChild(label);
                wrap.appendChild(frame);
                container.appendChild(wrap);
              },
              on: function (event, handler) { handlers[event] = handler; },
              focus: function () { if (input) input.focus(); },
              destroy: function () { if (wrap) wrap.remove(); }
            };
          },
          submit: function () {
            return Promise.resolve(elements.__card().length < 16 ? { error: { type: "validation_error", code: "incomplete_number", message: "您的卡号不完整。" } } : {});
          },
          update: function () {}
        };
        return elements;
      },
      confirmPayment: function (args) {
        var secret = args.elements.__secret;
        window.__fakeStripe.returnUrl = args.confirmParams.return_url;
        return call("POST", secret, "/confirm", { card: args.elements.__card(), return_url: args.confirmParams.return_url }).then(function (result) {
          if (result.error) return { error: result.error };
          if (result.status !== "requires_action") return { paymentIntent: result };
          return new Promise(function (resolve) {
            var overlay = document.createElement("div");
            overlay.style.position = "fixed";
            overlay.style.inset = "0";
            overlay.style.zIndex = "2147483647";
            var frame = document.createElement("iframe");
            frame.title = "银行验证（假）";
            frame.src = "https://hooks.stripe.com/3d_secure/" + result.id;
            frame.style.width = "100%";
            frame.style.height = "100%";
            frame.style.border = "0";
            overlay.appendChild(frame);
            document.body.appendChild(overlay);
            var timer = setInterval(function () {
              retrieve(secret).then(function (checked) {
                var intent = checked.paymentIntent;
                if (!intent || intent.status === "requires_action") return;
                clearInterval(timer);
                overlay.remove();
                if (intent.status === "succeeded") resolve({ paymentIntent: intent });
                else resolve({ error: { type: "invalid_request_error", code: "payment_intent_authentication_failure", message: intent.last_payment_error && intent.last_payment_error.message, payment_intent: intent } });
              });
            }, 300);
          });
        }, function () { return { error: { type: "api_connection_error" } }; });
      }
    };
  }
  window.Stripe = Stripe;
})();`;

const STRIPE_HOST = /(^|\.)stripe\.com$/;

/**
 * 在这个页面上把 Stripe 的三个域名转给假 Stripe（`fakeUrl`）。返回记下的请求：`seen` 是转发了的，`unexpected` 是别的 stripe.com 地址（应为空）。
 * `stripeJs`：可以让 Stripe.js 加载失败（模拟网络不通）。
 */
export async function routeStripe(page: Page, fakeUrl: string, options: { stripeJs?: "ok" | "fail" } = {}): Promise<{ seen: string[]; unexpected: string[] }> {
  const seen: string[] = [];
  const unexpected: string[] = [];
  await page.route(
    (url) => STRIPE_HOST.test(url.hostname),
    async (route) => {
      const url = new URL(route.request().url());
      seen.push(`${route.request().method()} ${url.origin}${url.pathname}`);
      if (url.hostname === "js.stripe.com" && url.pathname === "/v3/") {
        if (options.stripeJs === "fail") return route.abort("internetdisconnected");
        return route.fulfill({ status: 200, contentType: "application/javascript; charset=utf-8", body: FAKE_STRIPE_JS });
      }
      if (url.hostname === "js.stripe.com" && url.pathname === "/v3/elements-inner.html") return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: '<!doctype html><html lang="zh-CN"><head><title>Stripe</title></head><body></body></html>' });
      if (url.hostname === "api.stripe.com" || url.hostname === "hooks.stripe.com") {
        const response = await route.fetch({ url: `${fakeUrl}${url.pathname}${url.search}` });
        return route.fulfill({ response });
      }
      unexpected.push(url.href);
      return route.abort("blockedbyclient");
    },
  );
  return { seen, unexpected };
}
