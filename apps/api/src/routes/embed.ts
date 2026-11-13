/**
 * 嵌入组件（M9E-02，ADR 0090）。
 *
 * 运营后台（`embed.read` / `embed.manage`）：
 * - `GET /platform/v1/embed-keys`、`POST /platform/v1/embed-keys`：列表、新建（嵌入码由服务端生成）；
 * - `GET /platform/v1/embed-keys/{id}`、`PATCH /platform/v1/embed-keys/{id}`（`If-Match`）：详情（含合作网站要放的代码）、修改名称 / 白名单 / 默认值 / 状态。
 *
 * 跨域只开在 `/embed/v1`（合作网站页面上的组件调用；查询串带 `key`）：
 * - `GET /embed/v1/config`：默认语言、默认标签、主站地址（浏览器缓存 60 秒）；
 * - `GET /embed/v1/places/autocomplete`、`/places/details`：同官网的输入即提示（同样的每地址额度），另加每个嵌入码每分钟 600 次；
 * - `POST /embed/v1/booking-drafts`：建预订草稿（≤ 16 KB），返回编号和要跳转的主站地址。
 * 共同规则：`Origin` 规范化后完全等于这个嵌入码白名单的某一项才处理并回 `Access-Control-Allow-Origin`；
 * `null`、缺失、不在白名单、嵌入码不存在或停用一律 403 `EMBED_ORIGIN_NOT_ALLOWED`，不带 CORS 头。预检 `OPTIONS` 同样核对。
 * 不开 `Access-Control-Allow-Credentials`。其他前缀（`/site/v1` 等）永远不带 CORS 头。
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { BOOKING_DRAFT_RULES, EMBED_KEY_STATUSES, EMBED_LANGS, EMBED_RULES, EMBED_SERVICES, embedSnippet } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type EmbedGate, type EmbedKey, createEmbedDraft, createEmbedKey, embedGate, getEmbedKey, listEmbedKeys, takeEmbedPlacesSlot, updateEmbedKey } from "../services/embed.ts";
import { authenticatePlatform, platformCredentials } from "../services/platform-auth.ts";
import { siteAutocomplete, sitePlaceDetails, takeSiteSlot } from "../services/site.ts";
import { versionRequired } from "../services/errors.ts";
import { ifMatchVersion, parseInput, resourceId } from "../validation.ts";
import { placeAutocompleteSchema, placeDetailsSchema, placeItemJson, placeQueryOf } from "./site.ts";

type Json = Record<string, unknown>;

const writeSchema = z
  .object({
    name: z.string().max(200),
    allowed_origins: z.array(z.string().max(300)).max(50),
    default_lang: z.enum(EMBED_LANGS),
    default_services: z.array(z.enum(EMBED_SERVICES)).max(4),
    note: z.string().max(2_000).nullable().default(null),
  })
  .strict();
const updateSchema = writeSchema.extend({ status: z.enum(EMBED_KEY_STATUSES) }).strict();
const draftBodySchema = z.object({ draft: z.unknown(), return_url: z.unknown().optional() }).strict();

function embedKeyJson(ctx: AppContext, key: EmbedKey): Json {
  return {
    id: key.id,
    key: key.key,
    name: key.name,
    allowed_origins: key.allowedOrigins,
    default_lang: key.defaultLang,
    default_services: key.defaultServices,
    status: key.status,
    note: key.note,
    version: key.version,
    created_at: key.createdAt.toISOString(),
    updated_at: key.updatedAt.toISOString(),
    snippet: embedSnippet(new URL(ctx.config.publicBaseUrl).origin, key.key, key.defaultLang, key.defaultServices),
  };
}

/** `key` 在查询串里；其余查询参数交给各接口自己的校验 */
function splitKey(query: unknown): { key: unknown; rest: Record<string, unknown> } {
  const { key, ...rest } = (query ?? {}) as Record<string, unknown>;
  return { key, rest };
}

function allowCors(reply: FastifyReply, gate: EmbedGate): void {
  reply.header("access-control-allow-origin", gate.origin);
  reply.header("vary", "Origin");
}

export function registerEmbedRoutes(app: FastifyInstance, ctx: AppContext): void {
  // ---- 运营后台 ----
  app.get("/platform/v1/embed-keys", async (request) => {
    await authenticatePlatform(ctx, platformCredentials(request), { action: "embed.read" });
    return { items: (await listEmbedKeys(ctx)).map((key) => embedKeyJson(ctx, key)) };
  });

  app.post("/platform/v1/embed-keys", async (request, reply) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "embed.manage" });
    const body = parseInput(writeSchema, request.body, "body");
    const created = await createEmbedKey(ctx, principal, request.ip, { name: body.name, allowedOrigins: body.allowed_origins, defaultLang: body.default_lang, defaultServices: body.default_services, note: body.note });
    return reply.code(201).send(embedKeyJson(ctx, created));
  });

  app.get("/platform/v1/embed-keys/:id", async (request) => {
    await authenticatePlatform(ctx, platformCredentials(request), { action: "embed.read" });
    return embedKeyJson(ctx, await getEmbedKey(ctx, resourceId(request.params, "嵌入码")));
  });

  app.patch("/platform/v1/embed-keys/:id", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "embed.manage" });
    const id = resourceId(request.params, "嵌入码");
    const header = request.headers["if-match"];
    if (header === undefined) throw versionRequired();
    const version = ifMatchVersion(header);
    const body = parseInput(updateSchema, request.body, "body");
    const updated = await updateEmbedKey(ctx, principal, request.ip, id, version, { name: body.name, allowedOrigins: body.allowed_origins, defaultLang: body.default_lang, defaultServices: body.default_services, note: body.note, status: body.status });
    return embedKeyJson(ctx, updated);
  });

  // ---- /embed/v1 ----
  const gateOf = async (request: FastifyRequest, reply: FastifyReply): Promise<{ gate: EmbedGate; rest: Record<string, unknown> }> => {
    const { key, rest } = splitKey(request.query);
    const gate = await embedGate(ctx, key, request.headers.origin);
    allowCors(reply, gate);
    reply.header("cache-control", "no-store");
    return { gate, rest };
  };

  const preflight = (methods: string) => async (request: FastifyRequest, reply: FastifyReply) => {
    const { key } = splitKey(request.query);
    const gate = await embedGate(ctx, key, request.headers.origin);
    allowCors(reply, gate);
    reply.header("access-control-allow-methods", methods);
    reply.header("access-control-allow-headers", "content-type");
    reply.header("access-control-max-age", "600");
    return reply.code(204).send();
  };

  app.options("/embed/v1/config", preflight("GET"));
  app.get("/embed/v1/config", async (request, reply) => {
    const { gate } = await gateOf(request, reply);
    reply.header("cache-control", `private, max-age=${EMBED_RULES.configMaxAgeSeconds}`);
    return { lang: gate.embedKey.defaultLang, services: gate.embedKey.defaultServices, site_origin: new URL(ctx.config.publicBaseUrl).origin };
  });

  app.options("/embed/v1/places/autocomplete", preflight("GET"));
  app.get("/embed/v1/places/autocomplete", async (request, reply) => {
    const { gate, rest } = await gateOf(request, reply);
    await takeEmbedPlacesSlot(ctx, gate);
    await takeSiteSlot(ctx, "site_autocomplete", { ip: request.ip });
    await takeSiteSlot(ctx, "site_places_day", { ip: request.ip });
    const input = parseInput(placeAutocompleteSchema, rest, "querystring");
    const found = await siteAutocomplete(ctx, placeQueryOf(input.q), input.session);
    return { available: found.available, items: found.items.map(placeItemJson) };
  });

  app.options("/embed/v1/places/details", preflight("GET"));
  app.get("/embed/v1/places/details", async (request, reply) => {
    const { gate, rest } = await gateOf(request, reply);
    await takeEmbedPlacesSlot(ctx, gate);
    await takeSiteSlot(ctx, "site_autocomplete", { ip: request.ip });
    await takeSiteSlot(ctx, "site_places_day", { ip: request.ip });
    const input = parseInput(placeDetailsSchema, rest, "querystring");
    const found = await sitePlaceDetails(ctx, input.id, input.session ?? null);
    return { available: found.available, place: found.place === null ? null : { id: found.place.id, address: found.place.address, location: { lat: found.place.location.lat, lng: found.place.location.lng }, kind: found.place.kind } };
  });

  app.options("/embed/v1/booking-drafts", preflight("POST"));
  app.post("/embed/v1/booking-drafts", { bodyLimit: BOOKING_DRAFT_RULES.maxBytes }, async (request, reply) => {
    const { gate } = await gateOf(request, reply);
    const body = parseInput(draftBodySchema, request.body, "body");
    const stored = await createEmbedDraft(ctx, gate, request.ip, { draft: body.draft, return_url: body.return_url });
    const url = new URL("/book/new", ctx.config.publicBaseUrl);
    url.searchParams.set("draft", stored.id);
    return reply.code(201).send({ id: stored.id, expires_at: stored.expiresAt.toISOString(), url: url.href });
  });
}
