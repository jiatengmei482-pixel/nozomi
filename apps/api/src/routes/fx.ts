/**
 * 汇率中心的接口（M2-03，ADR 0022）。这里只做鉴权、校验、调用、返回；流程在 services/fx-center.ts。
 *
 * - `/platform/v1/fx-rates*`：看板（当前汇率、交叉汇率、数据源状态、挂起待确认的一批）、近 N 天曲线、拉取记录——每个平台角色都能看（`master_data.read`）；
 *   「立即拉取」、确认 / 放弃挂起的一批要 `fx.manage`（主数据运营、超级管理员）。
 * - `/tenant/v1/fx-rates`：租户只读当前汇率（需求「租户和销售端只读」）。只有汇率本身，没有缓冲、加价这类平台参数（规则 4）。
 * 汇率一律是十进制字符串。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { CURRENCIES, type CurrencyCode, FX_RULES, type PlatformAction } from "@nozomi/domain";
import { bearerToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import { withPlatformTx, withTenantTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { type FxFetch, listFetches, rateHistory } from "../repos/fx.ts";
import { fxOverview, fxSeries, fxSourceStatus } from "../services/fx-center.ts";
import { authenticatePlatform } from "../services/platform-auth.ts";
import { authenticateTenant } from "../services/tenant-auth.ts";
import { parseInput } from "../validation.ts";

const CURRENCY_CODES = Object.keys(CURRENCIES) as [CurrencyCode, ...CurrencyCode[]];
const baseQuery = z.object({ base: z.enum(CURRENCY_CODES).default(FX_RULES.base) });
const historyQuery = baseQuery.extend({ days: z.coerce.number().int().min(1).max(365).default(30) });
const fetchListQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });
const fetchId = z.object({ id: z.string().regex(/^[1-9]\d{0,17}$/, "不是合法的编号") });

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

export function registerFxRoutes(app: FastifyInstance, ctx: AppContext): void {
  const platform = (request: FastifyRequest, action: PlatformAction) => authenticatePlatform(ctx, bearerToken(request.headers.authorization), { action });

  app.get("/platform/v1/fx-rates", async (request) => {
    await platform(request, "master_data.read");
    const { base } = parseInput(baseQuery, request.query, "querystring");
    const now = ctx.now();
    const { overview, status } = await withPlatformTx(
      ctx.pool,
      async (db) => ({ overview: await fxOverview(db, base, now), status: await fxSourceStatus(db, ctx.fx, ctx.config.fx.autoFetch, now) }),
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
      rates: overview.rates,
      cross: overview.cross,
      source_status: {
        host: status.host,
        auto_fetch: status.autoFetch,
        last_attempt: status.lastAttempt === null ? null : fxFetchJson(status.lastAttempt),
        last_success_at: iso(status.lastSuccessAt),
        next_fetch_at: iso(status.nextFetchAt),
      },
      held: status.held === null ? null : fxFetchJson(status.held),
    };
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
    return { base, state: overview.state, as_of: iso(overview.asOf), rates: overview.rates };
  });
}
