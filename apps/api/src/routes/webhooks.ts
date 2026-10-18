/**
 * 收款服务的通知（M3-01，ADR 0026）：`POST /webhooks/stripe`。不需要登录——靠 `Stripe-Signature` 签名证明是 Stripe 发来的。
 * 签名要对**原始请求体**算，所以这一个接口把请求体按字节收下（不先解析成 JSON）。处理流程在 services/payment-webhooks.ts。
 * 应答：处理了、记录了不处理、重复的都是 200（Stripe 收到 2xx 就不再重发）；签名不对 400；Stripe 没配置 503；处理出错 500（Stripe 会重发）。
 */
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { handlePaymentWebhook } from "../services/payment-webhooks.ts";

/** 通知的请求体上限：Stripe 的事件一般几 KB */
const WEBHOOK_BODY_LIMIT = 256 * 1024;

export function registerWebhookRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.register(async (scoped) => {
    scoped.removeAllContentTypeParsers();
    scoped.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: WEBHOOK_BODY_LIMIT }, (_request, body, done) => done(null, body));
    scoped.post("/webhooks/stripe", async (request) => {
      const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      const signature = request.headers["stripe-signature"];
      const outcome = await handlePaymentWebhook(ctx, body, typeof signature === "string" ? signature : undefined, request.log);
      return { received: true, duplicate: outcome.duplicate, result: outcome.result };
    });
  });
}
