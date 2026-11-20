/**
 * AI 一句话行程用哪个 Claude 型号（M9T-32，ADR 0104 第六节）：运营后台三选一，切换不改代码、不重新部署。
 * - 读：`integration.read`；改：`integration.manage`（只有超级管理员），带 `If-Match` 版本号，留审计（前后的用法）。
 * - 同时给出今天（东京时间）每个型号用了几次、其中改用 Sonnet 重试几次、全站已用 / 上限（数 `trip_parse_runs`）。
 */
import type { AppContext } from "../context.ts";
import { type Db, withPlatformTx } from "../db/context.ts";
import { insertAuditLog } from "../repos/audit-logs.ts";
import { consoleOrigin, platformActor } from "./audit.ts";
import { versionConflict } from "./errors.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";
import { DEFAULT_TRIP_PARSE_MODE, TRIP_PARSE_MODELS, type TripParseMode, forgetTripParseMode, tokyoToday } from "./trip-parse.ts";

export interface AiTripUsageToday {
  /** 东京时间的今天 YYYY-MM-DD */
  date: string;
  sonnet: number;
  haiku: number;
  /** 先 Haiku 失败、改用 Sonnet 重试的次数（已算在 sonnet 里） */
  sonnetRetries: number;
  /** 全站已用（客人的请求数，重试不另算） */
  used: number;
  limit: number;
}

export interface AiTripSettingsView {
  mode: TripParseMode;
  /** 0 = 还没保存过（用默认的 Sonnet） */
  version: number;
  updatedAt: Date | null;
  today: AiTripUsageToday;
}

async function readSettings(db: Db, lock = false): Promise<{ mode: TripParseMode; version: number; updatedAt: Date | null }> {
  const row = (await db.query<{ model_mode: TripParseMode; version: number; updated_at: Date }>(`select model_mode, version, updated_at from ai_trip_settings where id${lock ? " for update" : ""}`)).rows[0];
  return row === undefined ? { mode: DEFAULT_TRIP_PARSE_MODE, version: 0, updatedAt: null } : { mode: row.model_mode, version: row.version, updatedAt: row.updated_at };
}

async function usageToday(ctx: AppContext, db: Db): Promise<AiTripUsageToday> {
  const now = ctx.now();
  const row = (
    await db.query<{ sonnet: number; haiku: number; retries: number; used: number }>(
      `select count(*) filter (where model = $2)::int as sonnet, count(*) filter (where model = $3)::int as haiku,
              count(*) filter (where model = $2 and attempt = 2)::int as retries, count(*) filter (where attempt = 1)::int as used
         from trip_parse_runs where created_at >= (date_trunc('day', $1::timestamptz at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo')`,
      [now, TRIP_PARSE_MODELS.sonnet, TRIP_PARSE_MODELS.haiku],
    )
  ).rows[0] as { sonnet: number; haiku: number; retries: number; used: number };
  return { date: tokyoToday(now), sonnet: row.sonnet, haiku: row.haiku, sonnetRetries: row.retries, used: row.used, limit: ctx.config.aiTripParse.dailyLimit };
}

export async function getAiTripSettings(ctx: AppContext): Promise<AiTripSettingsView> {
  return withPlatformTx(ctx.pool, async (db) => ({ ...(await readSettings(db)), today: await usageToday(ctx, db) }), { snapshot: true });
}

/** 改用法。版本对不上 409；和现在一样不写。改完本进程立刻生效，别的进程最多 5 秒。 */
export async function updateAiTripSettings(ctx: AppContext, principal: PlatformPrincipal, ip: string, mode: TripParseMode, version: number): Promise<AiTripSettingsView> {
  const view = await withPlatformTx(ctx.pool, async (db) => {
    const before = await readSettings(db, true);
    if (version !== before.version) throw versionConflict(before.version);
    if (before.version > 0 && before.mode === mode) return { ...before, today: await usageToday(ctx, db) };
    const now = ctx.now();
    await db.query(
      `insert into ai_trip_settings (id, model_mode, version, updated_at, updated_by) values (true, $1, 1, $2, $3)
       on conflict (id) do update set model_mode = excluded.model_mode, version = ai_trip_settings.version + 1, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      [mode, now, principal.user.id],
    );
    await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, now), { tenantId: null, resource: "ai_trip_settings", resourceId: null, action: "update", before: { model_mode: before.mode }, after: { model_mode: mode } });
    return { ...(await readSettings(db)), today: await usageToday(ctx, db) };
  });
  forgetTripParseMode();
  return view;
}
