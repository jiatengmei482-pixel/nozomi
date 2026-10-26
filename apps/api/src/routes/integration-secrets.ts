/**
 * 运营后台填写第三方密钥（M4-09，ADR 0041）：谷歌地图、Stripe。这里只做鉴权、校验、调用、返回；流程在 services/integration-secrets.ts。
 * 看：`integration.read`（超级管理员、技术，自建角色可以勾）；填写、更换、清空、测试：`integration.manage`（只归超级管理员）。
 * 两步验证没完成、必须先改密码的会话照例被鉴权这一步拦下（ADR 0013、0030）。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.ts";
import { type PlatformPrincipal, authenticatePlatform, platformCredentials } from "../services/platform-auth.ts";
import {
  type SecretInput,
  clearIntegrationSecretValue,
  integrationItemJson,
  integrationKeyOf,
  listIntegrationSecretsJson,
  saveIntegrationSecretValue,
  testIntegrationSecret,
} from "../services/integration-secrets.ts";
import { parseInput } from "../validation.ts";
import type { PlatformAction } from "@nozomi/domain";

/** 粘贴进来的值：长度的业务限制（20–255）在 config 的校验里，这里只挡掉大得离谱的请求体。 */
const secretText = z.string().max(1_000);
const googleMapsSchema = z.object({ api_key: secretText });
const stripeSchema = z.object({ secret_key: secretText, publishable_key: secretText, webhook_secret: secretText });

export function registerIntegrationSecretRoutes(app: FastifyInstance, ctx: AppContext): void {
  const authenticate = (request: FastifyRequest, action: PlatformAction): Promise<PlatformPrincipal> => authenticatePlatform(ctx, platformCredentials(request), { action });

  app.get("/platform/v1/integration-secrets", async (request) => {
    const principal = await authenticate(request, "integration.read");
    return listIntegrationSecretsJson(ctx, principal);
  });

  app.put("/platform/v1/integration-secrets/:key", async (request) => {
    const principal = await authenticate(request, "integration.manage");
    const key = integrationKeyOf(request.params);
    let input: SecretInput;
    if (key === "google_maps") {
      input = { key, apiKey: parseInput(googleMapsSchema, request.body, "body").api_key };
    } else {
      const body = parseInput(stripeSchema, request.body, "body");
      input = { key, keys: { secretKey: body.secret_key, publishableKey: body.publishable_key, webhookSecret: body.webhook_secret } };
    }
    const action = await saveIntegrationSecretValue(ctx, principal, input, request.ip);
    return { action, item: integrationItemJson(ctx, key) };
  });

  app.delete("/platform/v1/integration-secrets/:key", async (request) => {
    const principal = await authenticate(request, "integration.manage");
    const key = integrationKeyOf(request.params);
    await clearIntegrationSecretValue(ctx, principal, key, request.ip);
    return { item: integrationItemJson(ctx, key) };
  });

  app.post("/platform/v1/integration-secrets/:key/test", async (request) => {
    const principal = await authenticate(request, "integration.manage");
    const key = integrationKeyOf(request.params);
    return testIntegrationSecret(ctx, principal, key, request.ip);
  });
}
