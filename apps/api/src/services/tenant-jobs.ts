/**
 * 供应商的每日检查（M4-01，ADR 0028「每日检查」）：资质到期提醒和到期暂停、90 天滚动评分、自动观察 / 暂停 / 恢复、试运营转正式。
 *
 * 和订单、汇率的定时任务一样跑在 API 进程里（ADR 0022「定时任务和多实例」）：启动后 10 秒第一次，之后每小时一轮。
 * 「今天」按 `TENANT_RULES.timeZone`；每个供应商每天只做一次（`tenants.evaluated_on`），所以一天里跑几轮、几个实例同时跑都只做一次：
 * 每个供应商在自己的平台事务里先 `for update skip locked` 锁住、确认今天还没做，再做。东京时间过了午夜后的第一轮就把「到期当天」的暂停做掉。
 * 只有服务进程（`buildApp({ jobs: true })`）启动它；测试直接调 `tick()`。
 */
import { computeTenantScore, documentRequirements, evaluateTenantStanding, expiryReminderDue, noShowWindowStart, tenantDayStart, requiredDocumentsExpired, scoreWindowStart, trialPromotionDue, TENANT_RULES, daysUntilExpiry } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, withPlatformTx } from "../db/context.ts";
import { findProfile, insertNotice, listDocuments, loadScoreInput, loadTrialProgress, markDocumentReminder, upsertScoreDay } from "../repos/tenant-onboarding.ts";
import { type Tenant, listTenantsToEvaluate, lockTenantToEvaluate, saveTenantEvaluation, tenantState } from "../repos/tenants.ts";
import { applyTenantChange, systemChangeActor, tenantToday, withObservation, withSuspension, withoutSuspension } from "./tenant-onboarding.ts";

const FIRST_TICK_MS = 10_000;
const TICK_INTERVAL_MS = 60 * 60_000;
const STOP_WAIT_MS = 3_000;
/** 一轮最多做多少家；做不完的下一轮接着做（今天还没做的会一直排在前面） */
const BATCH = 200;

export interface TenantJobLog {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface TenantSweepResult {
  evaluated: number;
  /** 别的实例正在做、或这一轮里出错（下一轮再做） */
  skipped: number;
}

export class TenantJobs {
  private readonly ctx: AppContext;
  private readonly log: TenantJobLog;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ticking: Promise<unknown> | null = null;
  private stopped = true;

  constructor(ctx: AppContext, log: TenantJobLog) {
    this.ctx = ctx;
    this.log = log;
  }

  /** 一轮：把今天还没做检查的供应商做一遍（最多 `BATCH` 家）。 */
  async tick(): Promise<TenantSweepResult> {
    const now = this.ctx.now();
    const today = tenantToday(now);
    const ids = await withPlatformTx(this.ctx.pool, (db) => listTenantsToEvaluate(db, today, BATCH));
    const result: TenantSweepResult = { evaluated: 0, skipped: 0 };
    for (const id of ids) {
      try {
        const done = await withPlatformTx(this.ctx.pool, async (db) => {
          const tenant = await lockTenantToEvaluate(db, id, today);
          if (tenant === null) return false;
          await evaluateTenant(db, tenant, now, today);
          return true;
        });
        result[done ? "evaluated" : "skipped"] += 1;
      } catch (err) {
        // 一家出错不影响别的；它今天没做完，下一轮再做
        this.log.error({ err, tenantId: id }, "供应商每日检查失败，下一轮再试");
        result.skipped += 1;
      }
    }
    return result;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(FIRST_TICK_MS);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.ticking !== null) await Promise.race([this.ticking, new Promise((resolve) => setTimeout(resolve, STOP_WAIT_MS).unref())]);
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.ticking = this.tick()
        .catch((err: unknown) => this.log.error({ err }, "供应商每日检查这一轮失败"))
        .finally(() => {
          this.ticking = null;
          this.schedule(TICK_INTERVAL_MS);
        });
    }, delay);
    this.timer.unref();
  }
}

/** 某一天当地 0 点的时刻。 */
function startOf(date: string): Date {
  return tenantDayStart(new Date(0), date);
}

/**
 * 一个供应商今天的检查（调用方已经锁住它、确认今天还没做）：
 * 1. 资质：现在生效的每份证件到期前 30、7 天各提醒一次，到期当天提醒一次；
 * 2. 评分：近 90 天的输入 → `computeTenantScore`，写进每日评分（评分趋势）；
 * 3. 试运营满 30 天 / 20 单、无重大投诉 → 正式；
 * 4. `evaluateTenantStanding`：观察期的原因、要加的暂停原因（资质过期、评分跌破 3.5、司机未到达到 3 次）、资质恢复有效后去掉「资质过期」；
 * 5. 记下评分结果和「今天做过了」。
 */
export async function evaluateTenant(db: Db, tenant: Tenant, now: Date, today: string): Promise<Tenant> {
  const actor = systemChangeActor(now);
  const profile = await findProfile(db, tenant.id);
  const documents = await listDocuments(db, tenant.id, { withReviewerNames: false });
  const requirements = documentRequirements(profile?.countryCode ?? null, documents.map((document) => ({ id: document.id, type: document.type, status: document.status, expiresOn: document.expiresOn, seq: document.seq })), today);

  // 1. 资质到期提醒：只看现在生效的那份（换了新证的，旧的已经被取代，不再提醒）
  for (const item of requirements) {
    const current = item.approved === null ? undefined : documents.find((document) => document.id === item.approved?.id);
    if (current === undefined || current.expiresOn === null) continue;
    const left = daysUntilExpiry(current.expiresOn, today) as number;
    const tier = expiryReminderDue(left, current.remindersSent);
    if (tier !== null) {
      await insertNotice(db, tenant.id, { kind: "document_expiring", dedupeKey: `document_expiring:${current.id}:${tier}`, data: { document_id: current.id, type: current.type, expires_on: current.expiresOn, days_left: left }, now });
      await markDocumentReminder(db, tenant.id, current.id, { reminder: tier });
    }
    if (left <= 0 && !current.expiredNotified) {
      await insertNotice(db, tenant.id, { kind: "document_expired", dedupeKey: `document_expired:${current.id}`, data: { document_id: current.id, type: current.type, expires_on: current.expiresOn, required: item.required }, now });
      await markDocumentReminder(db, tenant.id, current.id, { expired: true });
    }
  }

  // 2. 评分
  const windowFrom = scoreWindowStart(today);
  const { input, noShows } = await loadScoreInput(db, tenant.id, { from: startOf(windowFrom), to: now, noShowFrom: startOf(noShowWindowStart(today)) });
  const score = computeTenantScore(input);
  await upsertScoreDay(db, tenant.id, { date: today, windowFrom, input, noShows, rawScoreCenti: score.rawScoreCenti, scoreCenti: score.scoreCenti, isDefault: score.isDefault, computedAt: now });

  // 3. 转正式（先转，后面的暂停会记下「暂停之前是正式」）
  let current = tenant;
  if (current.status === "trial" && current.trialStartedAt !== null) {
    const progress = await loadTrialProgress(db, current.id, current.trialStartedAt, now);
    if (trialPromotionDue({ trialStartedAt: current.trialStartedAt, now, completedSinceTrial: progress.completed, majorComplaintsSinceTrial: progress.majorComplaints })) {
      current = await applyTenantChange(db, current, { ...tenantState(current), status: "active", activatedAt: now }, { trigger: "promote", actor, note: `试运营满 ${TENANT_RULES.trialMinDays} 天，完成 ${progress.completed} 单，没有重大投诉` });
    }
  }

  // 4. 观察、暂停、资质恢复
  const decision = evaluateTenantStanding({
    status: current.status,
    suspensionReasons: current.suspensionReasons,
    previousScoreCenti: current.score.scoreOn === null ? null : current.score.scoreCenti,
    scoreCenti: score.scoreCenti,
    isDefaultScore: score.isDefault,
    previousNoShows: current.score.scoreOn === null ? null : current.score.noShows,
    noShows,
    documentsValid: requiredDocumentsExpired(requirements).length === 0,
  });
  const observed = withObservation(current, decision.observation, now);
  current = await applyTenantChange(db, current, observed, { trigger: "observation", actor, note: null });
  if (decision.suspend.length > 0) {
    current = await applyTenantChange(db, current, withSuspension(current, decision.suspend, now), { trigger: "suspend", actor, note: decision.suspend.map((reason) => SUSPEND_NOTES[reason]).join("；") });
  }
  if (decision.clearDocumentExpired) {
    const next = withoutSuspension(current, ["document_expired"]);
    current = await applyTenantChange(db, current, next, { trigger: next.status === "suspended" ? "suspend" : "resume", actor, note: "资质已恢复有效" });
  }

  // 5. 今天做过了
  await saveTenantEvaluation(db, current.id, { scoreCenti: score.scoreCenti, rawScoreCenti: score.rawScoreCenti, completedOrders: input.completedOrders, noShows, scoreOn: today });
  return current;
}

const SUSPEND_NOTES: Readonly<Record<string, string>> = {
  document_expired: "必交资质已到期",
  score_below_red_line: `履约评分低于 ${TENANT_RULES.suspendBelowCenti / 100}`,
  driver_no_show: `近 ${TENANT_RULES.noShowWindowDays} 天司机未到 ${TENANT_RULES.noShowSuspendCount} 次`,
  manual: "人工暂停",
};
