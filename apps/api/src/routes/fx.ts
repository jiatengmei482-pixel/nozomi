/**
 * 汇率中心的接口（M2-03，ADR 0022）。这里只做鉴权、校验、调用、返回；流程在 services/fx-center.ts。
 *
 * - `/platform/v1/fx-rates*`：看板（当前汇率、交叉汇率、数据源状态、挂起待确认的一批）、近 N 天曲线、拉取记录——每个平台角色都能看（`master_data.read`）；
 *   「立即拉取」、确认 / 放弃挂起的一批要 `fx.manage`（主数据运营、超级管理员）。
 * - `/tenant/v1/fx-rates`：租户只读当前汇率（需求「租户和销售端只读」）。只有汇率本身，没有缓冲、加价这类平台参数（规则 4）。
 * - 人工锁定（M2-06，ADR 0025）：`POST /platform/v1/fx-rates/locks` 发起锁定、`/locks/{id}/release` 发起解锁（`fx.manage`），都是双人复核，
 *   在待审核队列里由另一位有 `fx.review` 的同事批准后生效；`GET /platform/v1/fx-rates/locks` 锁定记录。租户的汇率接口不受锁定影响（中央汇率）。
 * 汇率一律是十进制字符串。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { CURRENCIES, type CurrencyCode, FX_LOCK_RULES, FX_RULES, type PlatformAction } from "@nozomi/domain";
import { bearerToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import { withPlatformTx, withTenantTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { listApprovals } from "../repos/approvals.ts";
import { type StoredFxLock, activeFxLocks, listFxLocks } from "../repos/fx-locks.ts";
import { type FxFetch, listFetches, rateHistory } from "../repos/fx.ts";
import { APPROVAL_KINDS } from "../services/approval-kinds.ts";
import { visibleKinds } from "../services/approvals.ts";
import { fxLockOf, fxOverview, fxSeries, fxSourceStatus } from "../services/fx-center.ts";
import { FX_APPROVAL_KINDS, requestFxLock, requestFxUnlock } from "../services/fx-locks.ts";
import { authenticatePlatform, platformCredentials } from "../services/platform-auth.ts";
import { authenticateTenant } from "../services/tenant-auth.ts";
import { dateTimeSchema, parseInput, resourceId } from "../validation.ts";
import { approvalJson } from "./channels.ts";

const CURRENCY_CODES = Object.keys(CURRENCIES) as [CurrencyCode, ...CurrencyCode[]];
const baseQuery = z.object({ base: z.enum(CURRENCY_CODES).default(FX_RULES.base) });
const historyQuery = baseQuery.extend({ days: z.coerce.number().int().min(1).max(365).default(30) });
const fetchListQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });
const fetchId = z.object({ id: z.string().regex(/^[1-9]\d{0,17}$/, "不是合法的编号") });
const reasonSchema = z.string().trim().max(FX_LOCK_RULES.reasonMaxLength).nullable().default(null).transform((value) => (value === "" ? null : value));
const lockSchema = z
  .object({
    currency: z.enum(CURRENCY_CODES),
    // 十进制字符串（如 "151.2"），不接受 JSON 数字：数字在解析时就已经变成浮点数了
    rate: z.string().max(40),
    expires_at: dateTimeSchema,
    reason: reasonSchema,
  })
  .strict();
const unlockSchema = z.object({ reason: reasonSchema }).strict();
const lockListQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });

const iso = (date: Date | null): string | null => (date === null ? null : date.toISOString());

export function fxFetchJson(fetch: FxFetch): Record<string, unknown> {
  return {
    id: fetch.id,
    started_at: fetch.startedAt.toISOString(),
    finished_at: iso(fetch.finishedAt),
    trigger: fetch.trigger,
    triggered_by: fetch.triggeredBy,
    source: fetch.source,
    status: fetch.status,
    error_code: fetch.errorCode,
    error_detail: fetch.errorDetail,
    source_as_of: iso(fetch.sourceAsOf),
    source_next_update_at: iso(fetch.sourceNextUpdateAt),
    held_rates: fetch.heldRates === null ? null : Object.entries(fetch.heldRates).map(([currency, rate]) => ({ currency, rate })),
    jumps: fetch.jumps === null ? null : fetch.jumps.map((jump) => ({ currency: jump.currency, previous: jump.previous, next: jump.next, change_bp: jump.changeBp })),
    decided_by: fetch.decidedBy,
    decided_at: iso(fetch.decidedAt),
  };
}

const staff = (value: { id: string; name: string; email: string } | null): Record<string, unknown> | null => (value === null ? null : { id: value.id, name: value.name, email: value.email });

export function fxLockJson(lock: StoredFxLock): Record<string, unknown> {
  return {
    id: lock.id,
    currency: lock.currency,
    rate: lock.rate,
    reason: lock.reason,
    expires_at: lock.expiresAt.toISOString(),
    locked_at: lock.lockedAt.toISOString(),
    central_rate: lock.centralRate,
    central_as_of: lock.centralAsOf.toISOString(),
    deviation_bp: lock.deviationBp,
    lock_approval_id: lock.lockApprovalId,
    requested_by: staff(lock.requestedBy),
    approved_by: staff(lock.approvedBy),
    status: lock.status,
    ended_at: iso(lock.endedAt),
    end_approval_id: lock.endApprovalId,
    ended_by: staff(lock.endedBy),
  };
}

export function registerFxRoutes(app: FastifyInstance, ctx: AppContext): void {
  const platform = (request: FastifyRequest, action: PlatformAction) => authenticatePlatform(ctx, platformCredentials(request), { action });

  app.get("/platform/v1/fx-rates", async (request) => {
    const principal = await platform(request, "master_data.read");
    const { base } = parseInput(baseQuery, request.query, "querystring");
    const now = ctx.now();
    const fxKinds = visibleKinds(APPROVAL_KINDS, principal).filter((kind) => FX_APPROVAL_KINDS.some((fxKind) => fxKind.kind === kind));
    const { overview, status, locks, pending } = await withPlatformTx(
      ctx.pool,
      async (db) => {
        const locks = await activeFxLocks(db, now);
        return {
          overview: await fxOverview(db, base, now, locks.map(fxLockOf)),
          status: await fxSourceStatus(db, ctx.fx, ctx.config.fx.autoFetch, now),
          locks,
          pending: await listApprovals(db, { status: "pending", kinds: fxKinds, resource: null, resourceId: null }, 100, null),
        };
      },
      { snapshot: true },
    );
    return {
      base: overview.base,
      state: overview.state,
      as_of: iso(overview.asOf),
      fetched_at: iso(overview.fetchedAt),
      stale_at: iso(overview.staleAt),
      max_age_hours: FX_RULES.maxAgeHours,
      jump_threshold_bp: FX_RULES.jumpThresholdBp,
      source: overview.source,
      rates: overview.rates.map((item) => ({ currency: item.currency, rate: item.rate, central_rate: item.central, locked: item.locked })),
      cross: overview.cross.map((item) => ({ from: item.from, to: item.to, rate: item.rate, locked: item.locked })),
      source_status: {
        host: status.host,
        auto_fetch: status.autoFetch,
        last_attempt: status.lastAttempt === null ? null : fxFetchJson(status.lastAttempt),
        last_success_at: iso(status.lastSuccessAt),
        next_fetch_at: iso(status.nextFetchAt),
      },
      held: status.held === null ? null : fxFetchJson(status.held),
      locks: locks.map(fxLockJson),
      pending_locks: pending.items.map((approval) => approvalJson(approval, principal)),
      lock_rules: { max_hours: FX_LOCK_RULES.maxHours, min_minutes: FX_LOCK_RULES.minMinutes, reason_above_bp: FX_LOCK_RULES.reasonAboveBp, max_deviation_bp: FX_LOCK_RULES.maxDeviationBp },
    };
  });

  app.get("/platform/v1/fx-rates/locks", async (request) => {
    await platform(request, "master_data.read");
    const { limit } = parseInput(lockListQuery, request.query, "querystring");
    const items = await withPlatformTx(ctx.pool, (db) => listFxLocks(db, limit));
    return { items: items.map(fxLockJson) };
  });

  app.post("/platform/v1/fx-rates/locks", async (request, reply) => {
    const principal = await platform(request, "fx.manage");
    const input = parseInput(lockSchema, request.body ?? {}, "body");
    const approval = await requestFxLock(ctx, principal, { currency: input.currency, rate: input.rate, expiresAt: input.expires_at, reason: input.reason }, request.ip);
    return reply.code(202).send({ approval: approvalJson(approval, principal) });
  });

  app.post("/platform/v1/fx-rates/locks/:id/release", async (request, reply) => {
    const principal = await platform(request, "fx.manage");
    const lockId = resourceId(request.params, "锁定记录");
    const input = parseInput(unlockSchema, request.body ?? {}, "body");
    const approval = await requestFxUnlock(ctx, principal, lockId, input.reason, request.ip);
    return reply.code(202).send({ approval: approvalJson(approval, principal) });
  });

  app.get("/platform/v1/fx-rates/history", async (request) => {
    await platform(request, "master_data.read");
    const { base, days } = parseInput(historyQuery, request.query, "querystring");
    const to = ctx.now();
    const from = new Date(to.getTime() - days * 86_400_000);
    const history = await withPlatformTx(ctx.pool, (db) => rateHistory(db, from));
    return {
      base,
      from: from.toISOString(),
      to: to.toISOString(),
      series: fxSeries(history, base).map((series) => ({ currency: series.currency, points: series.points.map((point) => ({ as_of: point.asOf.toISOString(), rate: point.rate })) })),
    };
  });

  app.get("/platform/v1/fx-rates/fetches", async (request) => {
    await platform(request, "master_data.read");
    const { limit } = parseInput(fetchListQuery, request.query, "querystring");
    const items = await withPlatformTx(ctx.pool, (db) => listFetches(db, limit));
    return { items: items.map(fxFetchJson) };
  });

  app.post("/platform/v1/fx-rates/fetch", async (request) => {
    const principal = await platform(request, "fx.manage");
    const fetch = await ctx.fx.fetch("manual", { kind: "staff", user: principal.user, ip: request.ip });
    return { fetch: fxFetchJson(fetch) };
  });

  for (const decision of ["confirm", "dismiss"] as const) {
    app.post(`/platform/v1/fx-rates/fetches/:id/${decision}`, async (request) => {
      const principal = await platform(request, "fx.manage");
      const params = fetchId.safeParse(request.params);
      if (!params.success) throw new AppError(404, "NOT_FOUND", "这次拉取记录不存在");
      const actor = { kind: "staff" as const, user: principal.user, ip: request.ip };
      const fetch = decision === "confirm" ? await ctx.fx.confirm(params.data.id, actor) : await ctx.fx.dismiss(params.data.id, actor);
      return { fetch: fxFetchJson(fetch) };
    });
  }

  app.get("/tenant/v1/fx-rates", async (request) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "master_data.read" });
    const { base } = parseInput(baseQuery, request.query, "querystring");
    const now = ctx.now();
    const overview = await withTenantTx(ctx.pool, principal.tenantId, (db) => fxOverview(db, base, now));
    // 租户看的是数据源的中央汇率：不受人工锁定影响，也不说有没有锁定（锁定是平台的风控手段，ADR 0025）
    return { base, state: overview.state, as_of: iso(overview.asOf), rates: overview.rates.map((item) => ({ currency: item.currency, rate: item.central })) };
  });
}
