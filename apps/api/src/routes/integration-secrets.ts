/**
 * 运营后台填写第三方密钥（M4-09，ADR 0041）：谷歌地图、Stripe；邮件发送（M4-14，ADR 0048）。这里只做鉴权、校验、调用、返回；流程在 services/integration-secrets.ts。
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
import { type AiTripSettingsView, getAiTripSettings, updateAiTripSettings } from "../services/ai-trip-settings.ts";
import { TRIP_PARSE_MODELS, TRIP_PARSE_MODES } from "../services/trip-parse.ts";
import { ifMatchVersion, parseInput } from "../validation.ts";
import type { PlatformAction } from "@nozomi/domain";

/** 粘贴进来的值：长度的业务限制（20–255）在 config 的校验里，这里只挡掉大得离谱的请求体。 */
const secretText = z.string().max(1_000);
const googleMapsSchema = z.object({ api_key: secretText });
const stripeSchema = z.object({ secret_key: secretText, publishable_key: secretText, webhook_secret: secretText });
/** 邮件发送七项：业务规则（端口、加密方式、主机）在 config 和 domain 的校验里，这里只看类型。 */
const emailSchema = z.object({ host: secretText, port: z.number(), encryption: secretText, username: secretText, password: secretText, from_name: secretText, from_address: secretText });

const aiTripSettingsSchema = z.object({ model_mode: z.enum(TRIP_PARSE_MODES) }).strict();

function aiTripSettingsJson(view: AiTripSettingsView): Record<string, unknown> {
  return {
    model_mode: view.mode,
    version: view.version,
    updated_at: view.updatedAt?.toISOString() ?? null,
    models: { sonnet: TRIP_PARSE_MODELS.sonnet, haiku: TRIP_PARSE_MODELS.haiku },
    today: { date: view.today.date, sonnet: view.today.sonnet, haiku: view.today.haiku, sonnet_retries: view.today.sonnetRetries, used: view.today.used, limit: view.today.limit },
  };
}

export function registerIntegrationSecretRoutes(app: FastifyInstance, ctx: AppContext): void {
  const authenticate = (request: FastifyRequest, action: PlatformAction): Promise<PlatformPrincipal> => authenticatePlatform(ctx, platformCredentials(request), { action });

  // AI 一句话行程用哪个 Claude 型号（M9T-32，ADR 0104 第六节）：和 Claude 密钥同一组权限，只有超级管理员能改
  app.get("/platform/v1/ai-trip-settings", async (request) => {
    await authenticate(request, "integration.read");
    return aiTripSettingsJson(await getAiTripSettings(ctx));
  });

  app.put("/platform/v1/ai-trip-settings", async (request) => {
    const principal = await authenticate(request, "integration.manage");
    const body = parseInput(aiTripSettingsSchema, request.body, "body");
    // 第一次保存（还没有设置行）不带 If-Match，之后必须带（同官网设置）
    const header = request.headers["if-match"];
    return aiTripSettingsJson(await updateAiTripSettings(ctx, principal, request.ip, body.model_mode, header === undefined ? 0 : ifMatchVersion(header)));
  });

  app.get("/platform/v1/integration-secrets", async (request) => {
    const principal = await authenticate(request, "integration.read");
    return listIntegrationSecretsJson(ctx, principal);
  });

  app.put("/platform/v1/integration-secrets/:key", async (request) => {
    const principal = await authenticate(request, "integration.manage");
    const key = integrationKeyOf(request.params);
    let input: SecretInput;
    if (key === "google_maps" || key === "anthropic") {
      input = { key, apiKey: parseInput(googleMapsSchema, request.body, "body").api_key };
    } else if (key === "stripe") {
      const body = parseInput(stripeSchema, request.body, "body");
      input = { key, keys: { secretKey: body.secret_key, publishableKey: body.publishable_key, webhookSecret: body.webhook_secret } };
    } else {
      const body = parseInput(emailSchema, request.body, "body");
      input = { key, settings: { host: body.host, port: body.port, encryption: body.encryption, username: body.username, password: body.password, fromName: body.from_name, fromAddress: body.from_address } };
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
