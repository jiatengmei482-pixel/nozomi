/**
 * 渠道、加价规则、API 客户端、双人复核的平台接口（M2-04，ADR 0023）。这里只做鉴权、校验、调用、返回；流程在 services/。
 *
 * - 看：`channel.read`（除主数据运营外的每个角色）。改：`channel.manage`（渠道经理、超级管理员）。
 * - 定价参数、加价规则、暂停渠道的修改不直接生效：返回 202 和一条待审核的复核记录，另一个有 `channel.review` 的人批准后才生效。
 * - 待审核队列：`/platform/v1/approvals`（`approval.read`；只列自己看得到的那几类）。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { APPROVAL_STATUSES, CHANNEL_RULES, type ChannelPricing, CHANNEL_STATUSES, CHANNEL_TYPES, CURRENCIES, type CurrencyCode, PAYMENT_MODES, type PlatformAction, SERVICE_CATEGORIES, TENANT_SCOPES } from "@nozomi/domain";
import { bearerToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import { withPlatformTx } from "../db/context.ts";
import { decodeTimeCursor, isUuid, toPage } from "../pagination.ts";
import type { Approval } from "../repos/approvals.ts";
import { type Channel, type StoredMarkupRule, referenceNames } from "../repos/channels.ts";
import { APPROVAL_KINDS } from "../services/approval-kinds.ts";
import { approvalAbilities, decideApproval, getApproval, listApprovalsFor } from "../services/approvals.ts";
import { type ApiClient, createApiClient, listApiClients, revokeApiClient, rotateApiClient } from "../services/channel-clients.ts";
import { type RuleInput, activateChannel, createChannel, getChannelDetail, listChannelsFor, requestChannelPause, requestPricingChange, requestRuleCreate, requestRuleDelete, requestRuleUpdate, updateChannel } from "../services/channels.ts";
import { notFound } from "../services/errors.ts";
import { type PricingProposal, channelPricingImpact, recomputeApprovalImpact } from "../services/pricing-impact.ts";
import { type PlatformPrincipal, authenticatePlatform } from "../services/platform-auth.ts";
import type { Db } from "../db/context.ts";
import { ifMatchVersion, pageQuerySchema, parseInput, resourceId, uuidSchema } from "../validation.ts";

type Json = Record<string, unknown>;

const CURRENCY_CODES = Object.keys(CURRENCIES) as [CurrencyCode, ...CurrencyCode[]];
const optionalText = (max: number) => z.string().trim().max(max).nullable().default(null).transform((value) => (value === "" ? null : value));
const bp = z.number().int().min(0).max(CHANNEL_RULES.maxMarkupBp);
const money = z.number().int().min(0).max(CHANNEL_RULES.maxMoneyMinor);
const noteSchema = optionalText(500);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期写成 YYYY-MM-DD").nullable().default(null);

const scopeSchema = z
  .object({
    tenant_scope: z.enum(TENANT_SCOPES).default("all"),
    tenant_ids: z.array(uuidSchema).max(500).default([]),
    city_ids: z.array(uuidSchema).max(500).nullable().default(null),
    categories: z.array(z.enum(SERVICE_CATEGORIES)).min(1).max(3).default([...SERVICE_CATEGORIES]),
  })
  .strict();

const pricingShape = {
  default_markup_bp: bp.default(CHANNEL_RULES.defaultMarkupBp),
  markup_floor_bp: bp.default(CHANNEL_RULES.defaultMarkupFloorBp),
  band_bp: z.number().int().min(0).max(CHANNEL_RULES.maxBandBp).default(CHANNEL_RULES.defaultBandBp),
  min_margin: money.default(0),
  sell_rounding: z.record(z.enum(CURRENCY_CODES), z.number().int().min(1).max(CHANNEL_RULES.maxRoundingUnit)).default({}),
};
const pricingSchema = z.object(pricingShape).strict();

const profileShape = {
  name: z.string().trim().min(1).max(100),
  type: z.enum(CHANNEL_TYPES),
  company: optionalText(200),
  contact_name: optionalText(100),
  contact_email: optionalText(254),
  contact_phone: optionalText(50),
  contract_ref: optionalText(100),
  notes: optionalText(1000),
  settle_currency: z.enum(CURRENCY_CODES),
  payment_mode: z.enum(PAYMENT_MODES).default("prepaid"),
  credit_limit: money.nullable().default(null),
  show_tenant_after_pay: z.boolean().default(true),
};

const createSchema = z.object({ ...profileShape, scope: scopeSchema.default({}), pricing: pricingSchema.default({}) }).strict();
const patchSchema = z
  .object({
    name: profileShape.name.optional(),
    type: profileShape.type.optional(),
    company: z.string().trim().max(200).nullable().optional(),
    contact_name: z.string().trim().max(100).nullable().optional(),
    contact_email: z.string().trim().max(254).nullable().optional(),
    contact_phone: z.string().trim().max(50).nullable().optional(),
    contract_ref: z.string().trim().max(100).nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    settle_currency: profileShape.settle_currency.optional(),
    payment_mode: z.enum(PAYMENT_MODES).optional(),
    credit_limit: money.nullable().optional(),
    show_tenant_after_pay: z.boolean().optional(),
    scope: scopeSchema.optional(),
  })
  .strict();
/** 发起修改定价参数：只给要改的那几项，没给的保持现在的值（合并）；`sell_rounding` 给了就整体替换 */
const pricingChangeSchema = z
  .object({
    default_markup_bp: bp.optional(),
    markup_floor_bp: bp.optional(),
    band_bp: z.number().int().min(0).max(CHANNEL_RULES.maxBandBp).optional(),
    min_margin: money.optional(),
    sell_rounding: z.record(z.enum(CURRENCY_CODES), z.number().int().min(1).max(CHANNEL_RULES.maxRoundingUnit)).optional(),
    request_note: noteSchema,
  })
  .strict();
const noteOnlySchema = z.object({ request_note: noteSchema }).strict();
const decisionSchema = z.object({ note: noteSchema }).strict();
const ruleSchema = z
  .object({
    tenant_id: uuidSchema.nullable().default(null),
    city_id: uuidSchema.nullable().default(null),
    category: z.enum(SERVICE_CATEGORIES).nullable().default(null),
    vehicle_group_id: uuidSchema.nullable().default(null),
    markup_bp: bp,
    valid_from: dateSchema,
    valid_to: dateSchema,
    note: optionalText(200),
    request_note: noteSchema,
  })
  .strict();
/**
 * 生效前试算（M3-07，ADR 0033）：入参是待提交的改动，和发起复核的四种入参同形（`request_note` 可以带，不用）。
 * `kind` 和复核的类别一致。
 */
const impactSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("channel.pricing"), change: pricingChangeSchema }).strict(),
  z.object({ kind: z.literal("markup_rule.create"), rule: ruleSchema }).strict(),
  z.object({ kind: z.literal("markup_rule.update"), rule_id: uuidSchema, rule: ruleSchema }).strict(),
  z.object({ kind: z.literal("markup_rule.delete"), rule_id: uuidSchema }).strict(),
]);
const listQuery = pageQuerySchema.extend({ status: z.enum(CHANNEL_STATUSES).optional(), type: z.enum(CHANNEL_TYPES).optional(), q: z.string().trim().min(1).max(100).optional() });
const approvalQuery = pageQuerySchema.extend({ status: z.enum([...APPROVAL_STATUSES, "all"]).default("pending"), resource_id: uuidSchema.optional() });
const clientSchema = z.object({ name: z.string().trim().min(1).max(100) }).strict();
const rotateSchema = z.object({ immediate: z.boolean().default(false) }).strict();

const emptyToNull = (value: string | null | undefined): string | null | undefined => (value === "" ? null : value);

function pricingChange(input: z.output<typeof pricingChangeSchema>): Partial<ChannelPricing> {
  return {
    ...(input.default_markup_bp === undefined ? {} : { defaultMarkupBp: input.default_markup_bp }),
    ...(input.markup_floor_bp === undefined ? {} : { markupFloorBp: input.markup_floor_bp }),
    ...(input.band_bp === undefined ? {} : { bandBp: input.band_bp }),
    ...(input.min_margin === undefined ? {} : { minMarginMinor: input.min_margin }),
    ...(input.sell_rounding === undefined ? {} : { sellRounding: input.sell_rounding }),
  };
}

function proposalOf(input: z.output<typeof impactSchema>): PricingProposal {
  switch (input.kind) {
    case "channel.pricing":
      return { kind: input.kind, change: pricingChange(input.change) };
    case "markup_rule.create":
      return { kind: input.kind, rule: ruleInput(input.rule) };
    case "markup_rule.update":
      return { kind: input.kind, ruleId: input.rule_id.toLowerCase(), rule: ruleInput(input.rule) };
    case "markup_rule.delete":
      return { kind: input.kind, ruleId: input.rule_id.toLowerCase() };
  }
}

function ruleInput(input: z.output<typeof ruleSchema>): RuleInput {
  return { tenantId: input.tenant_id, cityId: input.city_id, category: input.category, vehicleGroupId: input.vehicle_group_id, markupBp: input.markup_bp, validFrom: input.valid_from, validTo: input.valid_to, note: input.note };
}

/** 路径里的第二个编号（规则、API 客户端）。 */
function childId(params: unknown, key: string, what: string): string {
  const value = typeof params === "object" && params !== null ? (params as Record<string, unknown>)[key] : undefined;
  if (typeof value !== "string" || !isUuid(value)) throw notFound(what);
  return value.toLowerCase();
}

type Names = Awaited<ReturnType<typeof referenceNames>>;

async function namesFor(db: Db, channels: readonly Channel[], rules: readonly StoredMarkupRule[]): Promise<Names> {
  return referenceNames(db, {
    tenantIds: [...channels.flatMap((channel) => channel.scope.tenantIds), ...rules.flatMap((rule) => (rule.tenantId === null ? [] : [rule.tenantId]))],
    cityIds: [...channels.flatMap((channel) => channel.scope.cityIds ?? []), ...rules.flatMap((rule) => (rule.cityId === null ? [] : [rule.cityId]))],
    vehicleGroupIds: rules.flatMap((rule) => (rule.vehicleGroupId === null ? [] : [rule.vehicleGroupId])),
  });
}

const ref = (map: Map<string, string>, id: string | null): Json | null => (id === null ? null : { id, name: map.get(id) ?? null });

export function channelJson(channel: Channel, names: Names): Json {
  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    status: channel.status,
    company: channel.company,
    contact_name: channel.contactName,
    contact_email: channel.contactEmail,
    contact_phone: channel.contactPhone,
    contract_ref: channel.contractRef,
    notes: channel.notes,
    settle_currency: channel.settleCurrency,
    payment_mode: channel.paymentMode,
    credit_limit: channel.creditLimitMinor,
    show_tenant_after_pay: channel.showTenantAfterPay,
    scope: {
      tenant_scope: channel.scope.tenantScope,
      tenants: channel.scope.tenantIds.map((id) => ref(names.tenants, id)),
      cities: channel.scope.cityIds === null ? null : channel.scope.cityIds.map((id) => ref(names.cities, id)),
      categories: channel.scope.categories,
    },
    pricing: {
      default_markup_bp: channel.pricing.defaultMarkupBp,
      markup_floor_bp: channel.pricing.markupFloorBp,
      band_bp: channel.pricing.bandBp,
      min_margin: channel.pricing.minMarginMinor,
      sell_rounding: channel.pricing.sellRounding,
    },
    version: channel.version,
    pricing_version: channel.pricingVersion,
    created_at: channel.createdAt.toISOString(),
    updated_at: channel.updatedAt.toISOString(),
  };
}

export function ruleJson(rule: StoredMarkupRule, names: Names): Json {
  return {
    id: rule.id,
    level: rule.level,
    tenant: ref(names.tenants, rule.tenantId),
    city: ref(names.cities, rule.cityId),
    category: rule.category,
    vehicle_group: ref(names.vehicleGroups, rule.vehicleGroupId),
    markup_bp: rule.markupBp,
    valid_from: rule.validFrom,
    valid_to: rule.validTo,
    note: rule.note,
    version: rule.version,
    created_at: rule.createdAt.toISOString(),
    updated_at: rule.updatedAt.toISOString(),
  };
}

const person = (value: { id: string; name: string; email: string } | null): Json | null => (value === null ? null : { id: value.id, name: value.name, email: value.email });

export function approvalJson(approval: Approval, principal: PlatformPrincipal): Json {
  return {
    id: approval.id,
    kind: approval.kind,
    resource: approval.resource,
    resource_id: approval.resourceId,
    summary: approval.summary,
    payload: approval.payload,
    before: approval.before,
    base_version: approval.baseVersion,
    status: approval.status,
    requested_by: person(approval.requestedBy),
    requested_at: approval.requestedAt.toISOString(),
    request_note: approval.requestNote,
    decided_by: person(approval.decidedBy),
    decided_at: approval.decidedAt?.toISOString() ?? null,
    decision_note: approval.decisionNote,
    impact: approval.impact,
    can: approvalAbilities(APPROVAL_KINDS, principal, approval),
  };
}

function apiClientJson(client: ApiClient): Json {
  return {
    id: client.id,
    client_id: client.clientId,
    name: client.name,
    secret_last4: client.secretLast4,
    secret_generation: client.secretGeneration,
    previous_valid_until: client.previousValidUntil?.toISOString() ?? null,
    status: client.status,
    created_at: client.createdAt.toISOString(),
    rotated_at: client.rotatedAt?.toISOString() ?? null,
    revoked_at: client.revokedAt?.toISOString() ?? null,
    last_used_at: client.lastUsedAt?.toISOString() ?? null,
  };
}

export function registerChannelRoutes(app: FastifyInstance, ctx: AppContext): void {
  const platform = (request: FastifyRequest, action: PlatformAction): Promise<PlatformPrincipal> => authenticatePlatform(ctx, bearerToken(request.headers.authorization), { action });

  const detail = async (channelId: string): Promise<Json> => {
    const { channel, rules } = await getChannelDetail(ctx, channelId);
    const names = await withPlatformTx(ctx.pool, (db) => namesFor(db, [channel], rules));
    return { channel: channelJson(channel, names), markup_rules: rules.map((rule) => ruleJson(rule, names)) };
  };

  app.get("/platform/v1/channels", async (request) => {
    await platform(request, "channel.read");
    const query = parseInput(listQuery, request.query, "querystring");
    const page = await listChannelsFor(ctx, { status: query.status ?? null, type: query.type ?? null, q: query.q ?? null }, query.limit, decodeTimeCursor(query.cursor ?? null));
    const names = await withPlatformTx(ctx.pool, (db) => namesFor(db, page.items, []));
    return { items: page.items.map((channel) => channelJson(channel, names)), next_cursor: page.nextCursor, total: page.total };
  });

  app.post("/platform/v1/channels", async (request, reply) => {
    const principal = await platform(request, "channel.manage");
    const input = parseInput(createSchema, request.body, "body");
    const channel = await createChannel(
      ctx,
      principal,
      {
        profile: {
          name: input.name,
          type: input.type,
          company: input.company,
          contactName: input.contact_name,
          contactEmail: input.contact_email,
          contactPhone: input.contact_phone,
          contractRef: input.contract_ref,
          notes: input.notes,
          settleCurrency: input.settle_currency,
          paymentMode: input.payment_mode,
          creditLimitMinor: input.credit_limit,
          showTenantAfterPay: input.show_tenant_after_pay,
        },
        scope: { tenantScope: input.scope.tenant_scope, tenantIds: [...new Set(input.scope.tenant_ids)], cityIds: input.scope.city_ids === null ? null : [...new Set(input.scope.city_ids)], categories: [...new Set(input.scope.categories)] },
        pricing: { defaultMarkupBp: input.pricing.default_markup_bp, markupFloorBp: input.pricing.markup_floor_bp, bandBp: input.pricing.band_bp, minMarginMinor: input.pricing.min_margin, sellRounding: input.pricing.sell_rounding },
      },
      request.ip,
    );
    return reply.code(201).send(await detail(channel.id));
  });

  app.get("/platform/v1/channels/:id", async (request) => {
    await platform(request, "channel.read");
    return detail(resourceId(request.params, "渠道"));
  });

  app.patch("/platform/v1/channels/:id", async (request) => {
    const principal = await platform(request, "channel.manage");
    const channelId = resourceId(request.params, "渠道");
    const version = ifMatchVersion(request.headers["if-match"]);
    const input = parseInput(patchSchema, request.body, "body");
    await updateChannel(
      ctx,
      principal,
      channelId,
      version,
      (current) => ({
        profile: {
          name: input.name ?? current.name,
          type: input.type ?? current.type,
          company: input.company === undefined ? current.company : (emptyToNull(input.company) ?? null),
          contactName: input.contact_name === undefined ? current.contactName : (emptyToNull(input.contact_name) ?? null),
          contactEmail: input.contact_email === undefined ? current.contactEmail : (emptyToNull(input.contact_email) ?? null),
          contactPhone: input.contact_phone === undefined ? current.contactPhone : (emptyToNull(input.contact_phone) ?? null),
          contractRef: input.contract_ref === undefined ? current.contractRef : (emptyToNull(input.contract_ref) ?? null),
          notes: input.notes === undefined ? current.notes : (emptyToNull(input.notes) ?? null),
          settleCurrency: input.settle_currency ?? current.settleCurrency,
          paymentMode: input.payment_mode ?? current.paymentMode,
          creditLimitMinor: input.credit_limit === undefined ? current.creditLimitMinor : input.credit_limit,
          showTenantAfterPay: input.show_tenant_after_pay ?? current.showTenantAfterPay,
        },
        scope:
          input.scope === undefined
            ? current.scope
            : { tenantScope: input.scope.tenant_scope, tenantIds: [...new Set(input.scope.tenant_ids)], cityIds: input.scope.city_ids === null ? null : [...new Set(input.scope.city_ids)], categories: [...new Set(input.scope.categories)] },
      }),
      request.ip,
    );
    return detail(channelId);
  });

  app.post("/platform/v1/channels/:id/activate", async (request) => {
    const principal = await platform(request, "channel.manage");
    const channelId = resourceId(request.params, "渠道");
    await activateChannel(ctx, principal, channelId, request.ip);
    return detail(channelId);
  });

  app.post("/platform/v1/channels/:id/pause", async (request, reply) => {
    const principal = await platform(request, "channel.manage");
    const channelId = resourceId(request.params, "渠道");
    const input = parseInput(noteOnlySchema, request.body, "body");
    const approval = await requestChannelPause(ctx, principal, channelId, input.request_note, request.ip);
    return reply.code(202).send({ approval: approvalJson(approval, principal) });
  });

  app.post("/platform/v1/channels/:id/pricing-changes", async (request, reply) => {
    const principal = await platform(request, "channel.manage");
    const channelId = resourceId(request.params, "渠道");
    const input = parseInput(pricingChangeSchema, request.body, "body");
    const change = pricingChange(input);
    // 发起时按当时的数据试算一次，存进复核记录给审核人看（ADR 0033）；入参不合规则时这里就拦下，和发起的校验一样
    const impact = await channelPricingImpact(ctx, channelId, { kind: "channel.pricing", change });
    const approval = await requestPricingChange(ctx, principal, channelId, change, input.request_note, request.ip, impact);
    return reply.code(202).send({ approval: approvalJson(approval, principal) });
  });

  app.post("/platform/v1/channels/:id/pricing-impact", async (request) => {
    await platform(request, "channel.manage");
    const channelId = resourceId(request.params, "渠道");
    const input = parseInput(impactSchema, request.body, "body");
    return { impact: await channelPricingImpact(ctx, channelId, proposalOf(input)) };
  });

  app.get("/platform/v1/channels/:id/markup-rules", async (request) => {
    await platform(request, "channel.read");
    const { rules, channel } = await getChannelDetail(ctx, resourceId(request.params, "渠道"));
    const names = await withPlatformTx(ctx.pool, (db) => namesFor(db, [], rules));
    return { channel_id: channel.id, default_markup_bp: channel.pricing.defaultMarkupBp, markup_floor_bp: channel.pricing.markupFloorBp, items: rules.map((rule) => ruleJson(rule, names)) };
  });

  app.post("/platform/v1/channels/:id/markup-rules", async (request, reply) => {
    const principal = await platform(request, "channel.manage");
    const channelId = resourceId(request.params, "渠道");
    const input = parseInput(ruleSchema, request.body, "body");
    const impact = await channelPricingImpact(ctx, channelId, { kind: "markup_rule.create", rule: ruleInput(input) });
    const approval = await requestRuleCreate(ctx, principal, channelId, ruleInput(input), input.request_note, request.ip, impact);
    return reply.code(202).send({ approval: approvalJson(approval, principal) });
  });

  app.put("/platform/v1/channels/:id/markup-rules/:ruleId", async (request, reply) => {
    const principal = await platform(request, "channel.manage");
    const channelId = resourceId(request.params, "渠道");
    const ruleId = childId(request.params, "ruleId", "加价规则");
    const version = ifMatchVersion(request.headers["if-match"]);
    const input = parseInput(ruleSchema, request.body, "body");
    const impact = await channelPricingImpact(ctx, channelId, { kind: "markup_rule.update", ruleId, rule: ruleInput(input) });
    const approval = await requestRuleUpdate(ctx, principal, channelId, ruleId, version, ruleInput(input), input.request_note, request.ip, impact);
    return reply.code(202).send({ approval: approvalJson(approval, principal) });
  });

  app.delete("/platform/v1/channels/:id/markup-rules/:ruleId", async (request, reply) => {
    const principal = await platform(request, "channel.manage");
    const channelId = resourceId(request.params, "渠道");
    const ruleId = childId(request.params, "ruleId", "加价规则");
    const version = ifMatchVersion(request.headers["if-match"]);
    const input = parseInput(noteOnlySchema, request.body ?? {}, "body");
    const impact = await channelPricingImpact(ctx, channelId, { kind: "markup_rule.delete", ruleId });
    const approval = await requestRuleDelete(ctx, principal, channelId, ruleId, version, input.request_note, request.ip, impact);
    return reply.code(202).send({ approval: approvalJson(approval, principal) });
  });

  app.get("/platform/v1/channels/:id/api-clients", async (request) => {
    await platform(request, "channel.read");
    const items = await listApiClients(ctx, resourceId(request.params, "渠道"));
    return { items: items.map(apiClientJson) };
  });

  app.post("/platform/v1/channels/:id/api-clients", async (request, reply) => {
    const principal = await platform(request, "channel.manage");
    const channelId = resourceId(request.params, "渠道");
    const input = parseInput(clientSchema, request.body, "body");
    const issued = await createApiClient(ctx, principal, channelId, input.name, request.ip);
    return reply.code(201).send({ api_client: apiClientJson(issued.client), client_secret: issued.secret });
  });

  app.post("/platform/v1/channels/:id/api-clients/:clientId/rotate", async (request) => {
    const principal = await platform(request, "channel.manage");
    const channelId = resourceId(request.params, "渠道");
    const id = childId(request.params, "clientId", "API 客户端");
    const input = parseInput(rotateSchema, request.body ?? {}, "body");
    const issued = await rotateApiClient(ctx, principal, channelId, id, input.immediate, request.ip);
    return { api_client: apiClientJson(issued.client), client_secret: issued.secret };
  });

  app.post("/platform/v1/channels/:id/api-clients/:clientId/revoke", async (request) => {
    const principal = await platform(request, "channel.manage");
    const client = await revokeApiClient(ctx, principal, resourceId(request.params, "渠道"), childId(request.params, "clientId", "API 客户端"), request.ip);
    return { api_client: apiClientJson(client) };
  });

  app.get("/platform/v1/channels/:id/quote-logs", async (request) => {
    await platform(request, "channel.read");
    const channelId = resourceId(request.params, "渠道");
    const query = parseInput(pageQuerySchema, request.query, "querystring");
    const after = decodeTimeCursor(query.cursor ?? null);
    const page = await withPlatformTx(
      ctx.pool,
      async (db) => {
        const exists = await db.query("select 1 from channels where id = $1", [channelId]);
        if ((exists.rowCount ?? 0) === 0) throw notFound("渠道");
        const result = await db.query<{ id: string; created_at: Date; cursor_time: string; currency: string; city_id: string; category: string; candidate_count: number; quote_count: number; duration_ms: number; bids: { quote_id: string; vehicle_group_id: string; winner_tenant_id: string }[]; rejects: unknown[]; client_id: string; request: Json }>(
          `select l.id, l.created_at, l.created_at::text as cursor_time, l.currency, l.city_id, l.category, l.candidate_count, l.quote_count, l.duration_ms, l.bids, l.rejects, k.client_id, l.request
             from quote_logs l join channel_api_clients k on k.id = l.api_client_id
            where l.channel_id = $1 and ($2::timestamptz is null or (l.created_at, l.id) < ($2::timestamptz, $3::uuid))
            order by l.created_at desc, l.id desc limit $4`,
          [channelId, after?.t ?? null, after?.id ?? null, query.limit + 1],
        );
        return toPage(result.rows, query.limit, (row) => row, (row) => ({ t: row.cursor_time, id: row.id }));
      },
      { snapshot: true },
    );
    return {
      items: page.items.map((row) => ({
        id: row.id,
        created_at: row.created_at.toISOString(),
        client_id: row.client_id,
        currency: row.currency,
        city_id: row.city_id,
        category: row.category,
        candidate_count: row.candidate_count,
        quote_count: row.quote_count,
        reject_count: row.rejects.length,
        duration_ms: row.duration_ms,
        request: row.request,
        quotes: row.bids.map((bid) => ({ quote_id: bid.quote_id, vehicle_group_id: bid.vehicle_group_id, winner_tenant_id: bid.winner_tenant_id })),
      })),
      next_cursor: page.nextCursor,
    };
  });

  // ---- 双人复核 ----

  app.get("/platform/v1/approvals", async (request) => {
    const principal = await platform(request, "approval.read");
    const query = parseInput(approvalQuery, request.query, "querystring");
    const page = await listApprovalsFor(ctx, APPROVAL_KINDS, principal, { status: query.status === "all" ? null : query.status, resource: null, resourceId: query.resource_id ?? null }, query.limit, decodeTimeCursor(query.cursor ?? null));
    return { items: page.items.map((approval) => approvalJson(approval, principal)), next_cursor: page.nextCursor, total: page.total };
  });

  app.get("/platform/v1/approvals/:id", async (request) => {
    const principal = await platform(request, "approval.read");
    const approval = await getApproval(ctx, APPROVAL_KINDS, principal, resourceId(request.params, "复核记录"));
    return { approval: approvalJson(approval, principal) };
  });

  // 审核人「按现在的数据再算一次」（ADR 0033）：只读，不改复核记录里发起时存的那一份
  app.post("/platform/v1/approvals/:id/pricing-impact", async (request) => {
    const principal = await platform(request, "approval.read");
    return { impact: await recomputeApprovalImpact(ctx, APPROVAL_KINDS, principal, resourceId(request.params, "复核记录")) };
  });

  for (const decision of ["approve", "reject", "withdraw"] as const) {
    app.post(`/platform/v1/approvals/:id/${decision}`, async (request) => {
      const principal = await platform(request, "approval.read");
      const id = resourceId(request.params, "复核记录");
      const input = parseInput(decisionSchema, request.body ?? {}, "body");
      const approval = await decideApproval(ctx, APPROVAL_KINDS, principal, id, decision, input.note, request.ip);
      return { approval: approvalJson(approval, principal) };
    });
  }
}
