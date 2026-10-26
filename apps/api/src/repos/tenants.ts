/**
 * 租户主体的数据访问。
 * - 带 `AcrossTenants` 或以平台视角操作的函数只在 withPlatformTx 里调用（平台员工的操作、定时任务）。
 * - `findOwnTenant` 在 withTenantTx 里调用：行级安全保证只读得到自己这一行。租户角色不能改这张表：
 *   供应商自己触发的状态变化（提交审核）也在平台事务里做（ADR 0028）。
 */
import type { ObservationReason, SuspensionReason, TenantStatus } from "@nozomi/domain";
import type { Db } from "../db/context.ts";
import { type Page, type TimeCursor, toPage } from "../pagination.ts";

export type { TenantStatus };

export interface Tenant {
  id: string;
  name: string;
  status: TenantStatus;
  /** 暂停之前的状态（恢复时回到它）；不在暂停中为 null */
  suspendedFrom: TenantStatus | null;
  suspensionReasons: SuspensionReason[];
  suspendedAt: Date | null;
  /** 观察期的原因；空 = 不在观察期 */
  observationReasons: ObservationReason[];
  observationSince: Date | null;
  signedAt: Date | null;
  trialStartedAt: Date | null;
  activatedAt: Date | null;
  terminatedAt: Date | null;
  /** 最近一次每日评分：比价用的分、按数据算出的分、近 90 天完成订单数、近 30 天司机未到次数、算的是哪一天 */
  score: { scoreCenti: number | null; rawScoreCenti: number | null; completedOrders: number; noShows: number; scoreOn: string | null };
  evaluatedOn: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** 状态机改得到的那几项。 */
export interface TenantState {
  status: TenantStatus;
  suspendedFrom: TenantStatus | null;
  suspensionReasons: SuspensionReason[];
  suspendedAt: Date | null;
  observationReasons: ObservationReason[];
  observationSince: Date | null;
  signedAt: Date | null;
  trialStartedAt: Date | null;
  activatedAt: Date | null;
  terminatedAt: Date | null;
}

type Row = Record<string, any>;

const COLUMNS = `id, name, status, suspended_from, suspension_reasons, suspended_at, observation_reasons, observation_since,
  signed_at, trial_started_at, activated_at, terminated_at, score_centi, score_raw_centi, score_completed_orders, score_no_shows,
  score_on::text as score_on, evaluated_on::text as evaluated_on, version, created_at, updated_at`;

function toTenant(row: Row): Tenant {
  return {
    id: row["id"],
    name: row["name"],
    status: row["status"],
    suspendedFrom: row["suspended_from"],
    suspensionReasons: row["suspension_reasons"],
    suspendedAt: row["suspended_at"],
    observationReasons: row["observation_reasons"],
    observationSince: row["observation_since"],
    signedAt: row["signed_at"],
    trialStartedAt: row["trial_started_at"],
    activatedAt: row["activated_at"],
    terminatedAt: row["terminated_at"],
    score: { scoreCenti: row["score_centi"], rawScoreCenti: row["score_raw_centi"], completedOrders: row["score_completed_orders"], noShows: row["score_no_shows"], scoreOn: row["score_on"] },
    evaluatedOn: row["evaluated_on"],
    version: row["version"],
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
  };
}

export function tenantState(tenant: Tenant): TenantState {
  const { status, suspendedFrom, suspensionReasons, suspendedAt, observationReasons, observationSince, signedAt, trialStartedAt, activatedAt, terminatedAt } = tenant;
  return { status, suspendedFrom, suspensionReasons, suspendedAt, observationReasons, observationSince, signedAt, trialStartedAt, activatedAt, terminatedAt };
}

/** 新的供应商从「申请中」开始（需求「租户状态」：招商代建）。 */
export async function insertTenant(db: Db, name: string, now: Date): Promise<Tenant> {
  const result = await db.query<Row>(`insert into tenants (name, status, created_at, updated_at) values ($1, 'applying', $2, $2) returning ${COLUMNS}`, [name, now]);
  return toTenant(result.rows[0] as Row);
}

export async function listTenantsAcrossTenants(db: Db, limit: number, after: TimeCursor | null): Promise<Page<Tenant>> {
  const result = await db.query<Row>(
    `select ${COLUMNS}, created_at::text as cursor_time
       from tenants
      where $1::timestamptz is null or (created_at, id) > ($1::timestamptz, $2::uuid)
      order by created_at, id
      limit $3`,
    [after?.t ?? null, after?.id ?? null, limit + 1],
  );
  return toPage(result.rows, limit, toTenant, (row) => ({ t: row["cursor_time"], id: row["id"] }));
}

/** 平台按编号取租户。`lock` 为真时锁住这一行直到事务结束（改状态前用）。 */
export async function findTenantForPlatform(db: Db, tenantId: string, options: { lock: boolean }): Promise<Tenant | null> {
  const result = await db.query<Row>(`select ${COLUMNS} from tenants where id = $1 ${options.lock ? "for update" : ""}`, [tenantId]);
  const row = result.rows[0];
  return row ? toTenant(row) : null;
}

/** 改状态机的那几项，版本加一。调用方已经锁住这一行，并负责写状态记录和审计。 */
export async function saveTenantState(db: Db, tenantId: string, state: TenantState, now: Date): Promise<Tenant> {
  const result = await db.query<Row>(
    `update tenants
        set status = $2, suspended_from = $3, suspension_reasons = $4::text[], suspended_at = $5, observation_reasons = $6::text[], observation_since = $7,
            signed_at = $8, trial_started_at = $9, activated_at = $10, terminated_at = $11, version = version + 1, updated_at = $12
      where id = $1 returning ${COLUMNS}`,
    [tenantId, state.status, state.suspendedFrom, state.suspensionReasons, state.suspendedAt, state.observationReasons, state.observationSince, state.signedAt, state.trialStartedAt, state.activatedAt, state.terminatedAt, now],
  );
  return toTenant(result.rows[0] as Row);
}

/** 每日检查做完：记下评分结果和做到了哪一天（不加版本：不是人改的，也不改状态）。 */
export async function saveTenantEvaluation(db: Db, tenantId: string, evaluation: { scoreCenti: number; rawScoreCenti: number | null; completedOrders: number; noShows: number; scoreOn: string }): Promise<void> {
  await db.query(
    "update tenants set score_centi = $2, score_raw_centi = $3, score_completed_orders = $4, score_no_shows = $5, score_on = $6::date, evaluated_on = $6::date where id = $1",
    [tenantId, evaluation.scoreCenti, evaluation.rawScoreCenti, evaluation.completedOrders, evaluation.noShows, evaluation.scoreOn],
  );
}

/** 今天还没做每日检查的供应商（已清退的不做），最早的在前。 */
export async function listTenantsToEvaluate(db: Db, today: string, limit: number): Promise<string[]> {
  const result = await db.query<{ id: string }>(
    "select id from tenants where status <> 'terminated' and (evaluated_on is null or evaluated_on < $1::date) order by evaluated_on nulls first, id limit $2",
    [today, limit],
  );
  return result.rows.map((row) => row.id);
}

/** 锁住一个还没做今天检查的供应商；别的实例正在做（锁着）或已经做完，返回 null。 */
export async function lockTenantToEvaluate(db: Db, tenantId: string, today: string): Promise<Tenant | null> {
  const result = await db.query<Row>(`select ${COLUMNS} from tenants where id = $1 and status <> 'terminated' and (evaluated_on is null or evaluated_on < $2::date) for update skip locked`, [tenantId, today]);
  const row = result.rows[0];
  return row ? toTenant(row) : null;
}

/** 租户事务里读自己的租户。 */
export async function findOwnTenant(db: Db, tenantId: string): Promise<Tenant | null> {
  const result = await db.query<Row>(`select ${COLUMNS} from tenants where id = $1`, [tenantId]);
  const row = result.rows[0];
  return row ? toTenant(row) : null;
}
