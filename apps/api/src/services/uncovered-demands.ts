/**
 * 「未覆盖需求」（M8-20，ADR 0075 第四部分）：一次询价（官网、渠道）一个价都报不出时，在应答之后记一条——客人想去哪里、什么时候、什么车，
 * 两端落在哪些供应商的哪些运营区域里、为什么报不出。运营据此联系供应商补报价区域，招商据此找新供应商。
 *
 * - 记录在应答之后的后台做（`inBackground`），最多等 200 毫秒（语句和锁的超时）；失败只记一条不含请求内容的错误日志，不影响报价。
 * - 去重：同一天（东京时间）同一个指纹只记一行、累加次数。新增行按来源（官网客人地址的哈希、渠道的 API 客户端）每小时最多 30 行、
 *   全站每天最多 5000 行；超了只累加当天的「被限掉」计数。
 * - 不含任何客人个人信息；坐标只存 4 位小数。保留 365 天，每天的清理任务删掉更早的（`UncoveredDemandJobs`）。
 * - 只有平台看得到（`demand.read`）：表只授权给平台角色，`/tenant/v1` 没有任何读它的接口。
 */
import { createHash } from "node:crypto";
import {
  type LatLng,
  type LocalizedText,
  type QuoteArea,
  type ServiceCategory,
  type TripDirection,
  UNCOVERED_DEMAND_RULES,
  type UncoveredDemandReason,
  addDays,
  demandFingerprint,
  demandPlaceName,
  instantToLocal,
  localDateTimeToInstant,
  operatingHits,
  refusalCounts,
  roundDemandPoint,
  uncoveredDemandCutoff,
  uncoveredDemandReason,
} from "@nozomi/domain";
import type { AppContext, DbContext } from "../context.ts";
import { withPlatformTx } from "../db/context.ts";
import { decodeTimeCursor } from "../pagination.ts";
import {
  type DemandDraft,
  type DemandFilter,
  type DemandPoint,
  type DemandSummary,
  type UncoveredDemand,
  countDroppedDemand,
  demandLabels,
  findDemandAirport,
  insertDemand,
  listDemandPoints,
  listDemands,
  purgeUncoveredDemands,
  repeatDemand,
  summarizeDemands,
  takeDemandSlot,
} from "../repos/uncovered-demands.ts";
import { type BackgroundLog, inBackground } from "./background.ts";

/** 这次询价从哪里来（只用来限流和取名称；不落库原文） */
export interface DemandSource {
  channelKind: "site" | "sales";
  /** 限流的来源：官网是客人地址的限流键，渠道是 API 客户端编号。只用来算哈希 */
  sourceKey: string;
  /** 官网地址联想选中的那一项的名称（渠道接口没有） */
  pickupName: string | null;
  dropoffName: string | null;
  log: BackgroundLog;
}

/** 这次询价报不出价的事实（由询价那一层整理好） */
export interface DemandFacts {
  channelId: string;
  category: ServiceCategory;
  direction: TripDirection | null;
  packageHours: number | null;
  cityId: string | null;
  /** 接送机的机场 */
  airportId: string | null;
  /** 两端坐标：接送机机场那一端可以不给（按机场的坐标记） */
  pickup: LatLng | null;
  dropoff: LatLng | null;
  /** 城市当地的用车时间 `YYYY-MM-DDTHH:mm` */
  serviceLocal: string;
  passengers: number;
  luggage: number;
  vehicleGroupId: string | null;
  /** 报价引擎要校验的点（接送机：非机场一端；点对点：两端；包车：上车点和给了时的下车点） */
  checked: ("pickup" | "dropoff")[];
  /** 参加比价的供应商各自的运营范围 */
  suppliers: { tenantId: string; operatingAreas: readonly QuoteArea[] }[];
  candidateCount: number;
  /** 这次比价里全部的拒绝原因 */
  refusals: string[];
}

const tokyoDate = (now: Date): string => instantToLocal(now, UNCOVERED_DEMAND_RULES.timeZone).date;
const sourceBucket = (source: DemandSource): string => `source:${createHash("sha256").update(`${source.channelKind}:${source.sourceKey}`, "utf8").digest("hex")}`;

function nameOf(name: LocalizedText): string | null {
  return demandPlaceName(name["zh"] ?? name["en"] ?? Object.values(name)[0] ?? null);
}

/** 整理成要记的一条（纯计算，坐标取 4 位小数、名称整理、主原因、指纹） */
export function demandDraft(source: DemandSource, facts: DemandFacts, airport: { name: LocalizedText; location: LatLng } | null, now: Date): DemandDraft {
  const airportEnd = facts.category === "airport_transfer" ? (facts.direction === "pickup" ? "pickup" : "dropoff") : null;
  const raw = { pickup: airportEnd === "pickup" ? (airport?.location ?? facts.pickup) : facts.pickup, dropoff: airportEnd === "dropoff" ? (airport?.location ?? facts.dropoff) : facts.dropoff };
  const pickupOperating = operatingHits(facts.suppliers, raw.pickup);
  const dropoffOperating = operatingHits(facts.suppliers, raw.dropoff);
  const reason: UncoveredDemandReason = uncoveredDemandReason({ candidateCount: facts.candidateCount, checkedPoints: facts.checked.map((end) => (end === "pickup" ? pickupOperating : dropoffOperating)), refusals: facts.refusals });
  const pickup = roundDemandPoint(raw.pickup);
  const dropoff = roundDemandPoint(raw.dropoff);
  const serviceDate = facts.serviceLocal.slice(0, 10);
  const airportName = airport === null ? null : nameOf(airport.name);
  return {
    seenOn: tokyoDate(now),
    channelKind: source.channelKind,
    channelId: facts.channelId,
    category: facts.category,
    direction: facts.direction,
    packageHours: facts.packageHours,
    cityId: facts.cityId,
    airportId: facts.airportId,
    pickup,
    dropoff,
    pickupName: airportEnd === "pickup" ? airportName : demandPlaceName(source.pickupName),
    dropoffName: airportEnd === "dropoff" ? airportName : demandPlaceName(source.dropoffName),
    serviceLocal: facts.serviceLocal,
    serviceDate,
    passengers: facts.passengers,
    luggage: facts.luggage,
    vehicleGroupId: facts.vehicleGroupId,
    pickupOperating,
    dropoffOperating,
    tenantIds: [...new Set([...pickupOperating, ...dropoffOperating].map((hit) => hit.tenantId))],
    reason,
    refusalCounts: refusalCounts(facts.refusals),
    fingerprint: demandFingerprint({ channelId: facts.channelId, category: facts.category, direction: facts.direction, packageHours: facts.packageHours, pickup, dropoff, serviceDate, passengers: facts.passengers, vehicleGroupId: facts.vehicleGroupId }),
  };
}

export type DemandRecordResult = "inserted" | "repeated" | "dropped";

/** 记一条（在调用方的后台任务里）：先累加同一天同一个指纹；没有才占新增额度，超了只记「被限掉」。 */
export async function recordUncoveredDemand(ctx: DbContext, source: DemandSource, facts: DemandFacts): Promise<DemandRecordResult> {
  const now = ctx.now();
  const timeoutMs = UNCOVERED_DEMAND_RULES.recordTimeoutMs;
  return withPlatformTx(ctx.pool, async (db) => {
    // 最多等 200 毫秒：超时数据库放弃这条语句、整个记录回滚，报价不受影响
    await db.query(`set local statement_timeout = ${timeoutMs}`);
    await db.query(`set local lock_timeout = ${timeoutMs}`);
    const airport = facts.airportId === null ? null : await findDemandAirport(db, facts.airportId);
    const draft = demandDraft(source, facts, airport, now);
    if (await repeatDemand(db, draft.fingerprint, draft.seenOn, now)) return "repeated";
    const sourceOk = await takeDemandSlot(db, sourceBucket(source), UNCOVERED_DEMAND_RULES.sourceNewRowsPerHour, 3_600_000, now);
    const globalOk = sourceOk && (await takeDemandSlot(db, "global", UNCOVERED_DEMAND_RULES.globalNewRowsPerDay, 86_400_000, now));
    if (!globalOk) {
      await countDroppedDemand(db, draft.seenOn);
      return "dropped";
    }
    await insertDemand(db, draft, now);
    return "inserted";
  });
}

/** 应答之后再记（失败只写一条不含请求内容的错误日志） */
export function recordUncoveredDemandLater(ctx: AppContext, source: DemandSource, facts: DemandFacts): void {
  inBackground(ctx, source.log, "uncovered_demand.record", async () => {
    await recordUncoveredDemand(ctx, source, facts);
  });
}

// ---- 运营后台 ----

export interface DemandQuery {
  /** 东京日期，含两头；默认最近 30 天 */
  from: string | null;
  to: string | null;
  cityId?: string | undefined;
  tenantId?: string | undefined;
  category?: ServiceCategory | undefined;
  reason?: UncoveredDemandReason | undefined;
}

/** 默认看最近 30 天 */
export const DEMAND_DEFAULT_DAYS = 30;

function demandFilter(query: DemandQuery, now: Date): { filter: DemandFilter; fromDay: string; toDay: string } {
  const toDay = query.to ?? tokyoDate(now);
  const fromDay = query.from ?? addDays(toDay, -(DEMAND_DEFAULT_DAYS - 1));
  const start = (day: string): Date => localDateTimeToInstant(`${day}T00:00`, UNCOVERED_DEMAND_RULES.timeZone) as Date;
  return { filter: { from: start(fromDay), to: start(addDays(toDay, 1)), cityId: query.cityId, tenantId: query.tenantId, category: query.category, reason: query.reason }, fromDay, toDay };
}

export interface DemandListView {
  items: UncoveredDemand[];
  nextCursor: string | null;
  summary: DemandSummary;
  from: string;
  to: string;
  tenants: Map<string, string>;
  cities: Map<string, LocalizedText>;
}

export async function listUncoveredDemands(ctx: DbContext, query: DemandQuery, limit: number, cursor: string | null): Promise<DemandListView> {
  const { filter, fromDay, toDay } = demandFilter(query, ctx.now());
  const after = decodeTimeCursor(cursor);
  return withPlatformTx(
    ctx.pool,
    async (db) => {
      const page = await listDemands(db, filter, limit, after);
      const summary = await summarizeDemands(db, filter, fromDay, toDay);
      const tenantIds = [...new Set([...page.items.flatMap((item) => item.tenantIds), ...summary.byTenant.map((entry) => entry.tenantId)])];
      const cityIds = [...new Set([...page.items.map((item) => item.cityId), ...summary.byCity.map((entry) => entry.cityId)].filter((id): id is string => id !== null))];
      const labels = await demandLabels(db, tenantIds, cityIds);
      return { items: page.items, nextCursor: page.nextCursor, summary, from: fromDay, to: toDay, ...labels };
    },
    { snapshot: true },
  );
}

export async function uncoveredDemandPoints(ctx: DbContext, query: DemandQuery): Promise<{ items: DemandPoint[]; truncated: boolean; from: string; to: string }> {
  const { filter, fromDay, toDay } = demandFilter(query, ctx.now());
  const found = await withPlatformTx(ctx.pool, (db) => listDemandPoints(db, filter, UNCOVERED_DEMAND_RULES.maxMapPoints), { snapshot: true });
  return { ...found, from: fromDay, to: toDay };
}

// ---- 保留期清理（每天一次；和别的定时任务一样跑在 API 进程里，ADR 0022） ----

const FIRST_TICK_MS = 30_000;
const TICK_INTERVAL_MS = 60 * 60_000;
const STOP_WAIT_MS = 3_000;

export interface DemandJobLog {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

/** 删掉最近一次出现早于 365 天的需求和「被限掉」计数、1 天以前的限流窗口。几个实例同时跑也只是多删一次（幂等）。 */
export async function purgeUncoveredDemandsNow(ctx: DbContext): Promise<number> {
  const now = ctx.now();
  const cutoff = uncoveredDemandCutoff(now);
  return withPlatformTx(ctx.pool, (db) => purgeUncoveredDemands(db, cutoff, tokyoDate(cutoff), new Date(now.getTime() - 86_400_000)));
}

/** 启动后 30 秒第一次，之后每小时一轮（每轮都是幂等的删除，一天里跑几轮都一样）。只有服务进程启动它；测试直接调 `tick()`。 */
export class UncoveredDemandJobs {
  private readonly ctx: AppContext;
  private readonly log: DemandJobLog;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ticking: Promise<unknown> | null = null;
  private stopped = true;

  constructor(ctx: AppContext, log: DemandJobLog) {
    this.ctx = ctx;
    this.log = log;
  }

  async tick(): Promise<number> {
    const deleted = await purgeUncoveredDemandsNow(this.ctx);
    if (deleted > 0) this.log.info({ event: "uncovered_demand.purge", deleted }, "删掉了超过保留期的未覆盖需求");
    return deleted;
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
        .catch((err: unknown) => this.log.error({ err, event: "uncovered_demand.purge" }, "未覆盖需求的保留期清理这一轮失败"))
        .finally(() => {
          this.ticking = null;
          this.schedule(TICK_INTERVAL_MS);
        });
    }, delay);
    this.timer.unref();
  }
}
