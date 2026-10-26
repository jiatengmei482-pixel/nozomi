/**
 * 加价规则 / 渠道定价参数生效前的毛利试算（M3-07，ADR 0033）。
 *
 * - 发起复核前（`POST /platform/v1/channels/{id}/pricing-impact`）和发起时（结果存进复核记录）：按「现在的规则」和「改动后的规则」
 *   重算这个渠道近 30 天的报价（`quotes` 的快照）和付过款的订单，看对外价、结算价、毛利的差、中标换人数。
 * - 审核人在批准前看发起时存下的结果，也可以「按现在的数据再算一次」（`POST /platform/v1/approvals/{id}/pricing-impact`）。
 * 只读：在一个只读快照事务里分批取数，domain 的纯函数计算，不写库、不写审计。
 */
import {
  type ChannelPricing,
  type CurrencyCode,
  type FxQuote,
  type ImpactCandidate,
  type ImpactOrder,
  type ImpactQuote,
  type ImpactSection,
  type MarkupRule,
  PRICING_IMPACT_RULES,
  type PlatformAction,
  type PricingImpactResult,
  type PricingState,
  SERVICE_CATEGORIES,
  type ServiceCategory,
  isCurrencyCode,
  platformRoleCan,
  pricingImpactAccumulator,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, withPlatformTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { findApproval } from "../repos/approvals.ts";
import type { AuditValues } from "../repos/audit-logs.ts";
import { type Channel, type StoredMarkupRule, findMarkupRule, listMarkupRules } from "../repos/channels.ts";
import type { ApprovalKinds } from "./approvals.ts";
import { type RuleInput, assertNoRuleBelowFloor, assertPricing, assertRule, loadChannel, pricingFromValues, ruleFromValues } from "./channels.ts";
import { forbidden, notFound } from "./errors.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";

/** 待提交的改动：和发起复核的四种入参一一对应。 */
export type PricingProposal =
  | { kind: "channel.pricing"; change: Partial<ChannelPricing> }
  | { kind: "markup_rule.create"; rule: RuleInput }
  | { kind: "markup_rule.update"; ruleId: string; rule: RuleInput }
  | { kind: "markup_rule.delete"; ruleId: string };

export const PRICING_IMPACT_KINDS: readonly PricingProposal["kind"][] = ["channel.pricing", "markup_rule.create", "markup_rule.update", "markup_rule.delete"];

/** 一次读多少行（报价、订单各自分批）：不一次把几万行快照读进内存 */
const BATCH = 5_000;
const PROPOSED_RULE_ID = "proposed";

const toRule = (rule: Pick<StoredMarkupRule, "id" | "tenantId" | "cityId" | "category" | "vehicleGroupId" | "markupBp" | "validFrom" | "validTo">): MarkupRule => ({
  id: rule.id,
  tenantId: rule.tenantId,
  cityId: rule.cityId,
  category: rule.category,
  vehicleGroupId: rule.vehicleGroupId,
  markupBp: rule.markupBp,
  validFrom: rule.validFrom,
  validTo: rule.validTo,
});

function ruleGone(): AppError {
  return new AppError(409, "APPROVAL_STALE", "要改的这条加价规则已经被删除了，无法试算；请驳回", { current_version: null });
}

/**
 * 现在的定价和改动后的定价。`validate`（发起之前的试算、发起时）：按发起复核的规则校验——不合规则、低于下限、日期重叠的直接拦，和发起时一样；
 * 不查「和现在一样」和版本（试算只是看看）。复核的「再算一次」不校验（是否还能生效由批准时判断）。
 */
async function pricingStates(db: Db, channel: Channel, proposal: PricingProposal, options: { validate: boolean; now: Date }): Promise<{ before: PricingState; after: PricingState }> {
  const rules = await listMarkupRules(db, channel.id);
  const before: PricingState = { pricing: channel.pricing, rules: rules.map(toRule) };
  switch (proposal.kind) {
    case "channel.pricing": {
      const pricing: ChannelPricing = { ...channel.pricing, ...proposal.change };
      if (options.validate) {
        assertPricing(pricing);
        await assertNoRuleBelowFloor(db, channel.id, pricing.markupFloorBp, options.now);
      }
      return { before, after: { pricing, rules: before.rules } };
    }
    case "markup_rule.create": {
      if (options.validate) await assertRule(db, channel, proposal.rule, null);
      return { before, after: { pricing: channel.pricing, rules: [...before.rules, toRule({ ...proposal.rule, id: PROPOSED_RULE_ID })] } };
    }
    case "markup_rule.update": {
      const current = await findMarkupRule(db, channel.id, proposal.ruleId);
      if (!current) throw options.validate ? notFound("加价规则") : ruleGone();
      if (options.validate) await assertRule(db, channel, proposal.rule, proposal.ruleId);
      return { before, after: { pricing: channel.pricing, rules: before.rules.map((rule) => (rule.id === proposal.ruleId ? toRule({ ...proposal.rule, id: rule.id }) : rule)) } };
    }
    case "markup_rule.delete": {
      const current = await findMarkupRule(db, channel.id, proposal.ruleId);
      if (!current) throw options.validate ? notFound("加价规则") : ruleGone();
      return { before, after: { pricing: channel.pricing, rules: before.rules.filter((rule) => rule.id !== proposal.ruleId) } };
    }
  }
}

// ---- 取数：快照里试算要用的那几项（用 jsonb 取字段，不把整份快照读回来）；城市和品类在询价日志上 ----

interface QuoteRow {
  id: string;
  created_at: Date;
  currency: string;
  vehicle_group_id: string;
  city_id: string | null;
  category: string | null;
  service_date: string | null;
  candidates: unknown;
  settle_fx: unknown;
  winner_fx: unknown;
  margin_fx: unknown;
  winner_buffer: number | null;
}

interface OrderRow extends QuoteRow {
  order_created_at: Date;
  order_id: string;
  status: string;
  cancel_fee_bp: number | null;
}

const QUOTE_FIELDS = `q.id, q.created_at, q.currency, q.vehicle_group_id::text,
  l.city_id::text as city_id,
  l.category,
  coalesce(q.snapshot->>'serviceDate', left(q.snapshot->'request'->>'serviceLocal', 10)) as service_date,
  q.snapshot->'candidates' as candidates,
  q.snapshot->'channel'->'settleFx' as settle_fx,
  q.snapshot->'winner'->'sell'->'fx' as winner_fx,
  q.snapshot->'winner'->'sell'->'channel'->'minMarginFx' as margin_fx,
  (q.snapshot->'winner'->'sell'->>'fxBufferBp')::integer as winner_buffer`;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function fxOf(value: unknown): FxQuote | null {
  if (!isObject(value)) return null;
  const { from, to, rate, asOf } = value;
  if (typeof from !== "string" || typeof to !== "string" || typeof rate !== "string" || !isCurrencyCode(from) || !isCurrencyCode(to)) return null;
  return { from, to, rate, asOf: typeof asOf === "string" ? asOf : "" };
}

const isCategory = (value: unknown): value is ServiceCategory => typeof value === "string" && (SERVICE_CATEGORIES as readonly string[]).includes(value);
const isInt = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;

/**
 * 快照的那几项 → domain 的报价。M3-07 之前的快照没有每个候选的汇率和缓冲、没有渠道结算币种的汇率：
 * 候选的汇率能用中标者的就用（同一个结算币种、同一刻）；渠道结算币种的汇率用最低毛利换币种时记下的、或结算币种正好是渠道结算币种的那个候选的；
 * 还缺的留空，domain 判为「没法重算」（不计入、单独计数）。快照写坏了的同样。
 */
function impactQuoteOf(row: QuoteRow, settleCurrency: CurrencyCode, defaultBufferBp: number): ImpactQuote {
  const broken: ImpactQuote = { cityId: "", category: "airport_transfer", vehicleGroupId: row.vehicle_group_id, serviceDate: "", currency: settleCurrency, settleFx: null, candidates: [] };
  if (!isCurrencyCode(row.currency) || row.city_id === null || !isCategory(row.category) || row.service_date === null || !Array.isArray(row.candidates)) return broken;
  const currency = row.currency;
  const winnerFx = fxOf(row.winner_fx);
  const candidates: ImpactCandidate[] = [];
  for (const item of row.candidates as unknown[]) {
    if (!isObject(item)) return broken;
    const { tenantId, productId, settlementMinor, settlementCurrency, observation, scoreCenti, completedOrders } = item;
    if (typeof tenantId !== "string" || typeof productId !== "string" || !isInt(settlementMinor, 1, Number.MAX_SAFE_INTEGER) || typeof settlementCurrency !== "string" || !isCurrencyCode(settlementCurrency)) return broken;
    const crossing = settlementCurrency !== currency;
    const fx = !crossing ? null : "fx" in item ? fxOf(item["fx"]) : winnerFx !== null && winnerFx.from === settlementCurrency ? winnerFx : null;
    const storedBuffer = item["fxBufferBp"];
    const fxBufferBp = !crossing ? 0 : isInt(storedBuffer, 0, 1_000) ? storedBuffer : isInt(row.winner_buffer, 1, 1_000) ? row.winner_buffer : defaultBufferBp;
    candidates.push({
      tenantId,
      productId,
      settlementMinor,
      settlementCurrency,
      fx,
      fxBufferBp,
      observation: observation === true,
      scoreCenti: isInt(scoreCenti, 0, 500) ? scoreCenti : 0,
      completedOrders: isInt(completedOrders, 0, Number.MAX_SAFE_INTEGER) ? completedOrders : 0,
    });
  }
  let settleFx: FxQuote | null = null;
  if (currency !== settleCurrency) {
    const direct = fxOf(row.settle_fx) ?? fxOf(row.margin_fx);
    const viaCandidate = candidates.find((candidate) => candidate.settlementCurrency === settleCurrency && candidate.fx !== null)?.fx ?? null;
    const found = direct ?? viaCandidate;
    settleFx = found !== null && found.from === settleCurrency && found.to === currency ? found : null;
  }
  return { cityId: row.city_id, category: row.category, vehicleGroupId: row.vehicle_group_id, serviceDate: row.service_date, currency, settleFx, candidates };
}

export interface PricingImpactReport {
  computedAt: Date;
  from: Date;
  to: Date;
  result: PricingImpactResult;
  quotesTotal: number;
  ordersTotal: number;
}

/** 在一个只读快照事务里：取现在的规则、组出改动后的规则，分批取近 30 天的报价和订单，算。 */
async function compute(db: Db, ctx: AppContext, channel: Channel, states: { before: PricingState; after: PricingState }, now: Date): Promise<PricingImpactReport> {
  const from = new Date(now.getTime() - PRICING_IMPACT_RULES.windowDays * 86_400_000);
  const settleCurrency = channel.settleCurrency;
  const acc = pricingImpactAccumulator({ before: states.before, after: states.after, settleCurrency });
  const bufferBp = ctx.config.fx.bufferBp;

  const quotesTotal = Number((await db.query<{ n: string }>("select count(*)::text as n from quotes where channel_id = $1 and created_at >= $2 and created_at <= $3", [channel.id, from, now])).rows[0]?.n ?? 0);
  let cursor: { t: Date; id: string } | null = null;
  let read = 0;
  while (read < PRICING_IMPACT_RULES.maxQuotes) {
    const limit = Math.min(BATCH, PRICING_IMPACT_RULES.maxQuotes - read);
    const page: QuoteRow[] = (
      await db.query<QuoteRow>(
        `select ${QUOTE_FIELDS} from quotes q join quote_logs l on l.id = q.quote_log_id
          where q.channel_id = $1 and q.created_at >= $2 and q.created_at <= $3 and ($4::timestamptz is null or (q.created_at, q.id) < ($4::timestamptz, $5::text))
          order by q.created_at desc, q.id desc limit $6`,
        [channel.id, from, now, cursor?.t ?? null, cursor?.id ?? null, limit],
      )
    ).rows;
    for (const row of page) acc.addQuote(impactQuoteOf(row, settleCurrency, bufferBp));
    read += page.length;
    const last = page.at(-1);
    if (page.length < limit || last === undefined) break;
    cursor = { t: last.created_at, id: last.id };
  }

  // 订单：近 30 天下单、付过款的（没付款就取消的、还在待支付的不算）。按下单时的报价快照重算
  const ordersWhere = `s.channel_id = $1 and s.created_at >= $2 and s.created_at <= $3 and o.confirmed_at is not null`;
  const ordersFrom = `order_sales s join orders o on o.tenant_id = s.supplier_tenant_id and o.id = s.order_id join quotes q on q.id = s.quote_id join quote_logs l on l.id = q.quote_log_id`;
  const ordersTotal = Number((await db.query<{ n: string }>(`select count(*)::text as n from ${ordersFrom} where ${ordersWhere}`, [channel.id, from, now])).rows[0]?.n ?? 0);
  let orderCursor: { t: Date; id: string } | null = null;
  let ordersRead = 0;
  while (ordersRead < PRICING_IMPACT_RULES.maxOrders) {
    const limit = Math.min(BATCH, PRICING_IMPACT_RULES.maxOrders - ordersRead);
    const page: OrderRow[] = (
      await db.query<OrderRow>(
        `select ${QUOTE_FIELDS}, s.created_at as order_created_at, s.order_id::text, o.status, o.cancel_fee_bp
           from ${ordersFrom}
          where ${ordersWhere} and ($4::timestamptz is null or (s.created_at, s.order_id) < ($4::timestamptz, $5::uuid))
          order by s.created_at desc, s.order_id desc limit $6`,
        [channel.id, from, now, orderCursor?.t ?? null, orderCursor?.id ?? null, limit],
      )
    ).rows;
    for (const row of page) {
      const cancelled = row.status === "cancelled";
      // 付过款后的取消按扣款比例计入（M3-03 之前的取消没有比例：都是付款前的，走不到这里；保险起见按免费算）
      const shareBp = cancelled ? (row.cancel_fee_bp ?? 0) : 10_000;
      const order: ImpactOrder = { ...impactQuoteOf(row, settleCurrency, bufferBp), cancelled, shareBp };
      acc.addOrder(order);
    }
    ordersRead += page.length;
    const last = page.at(-1);
    if (page.length < limit || last === undefined) break;
    orderCursor = { t: last.order_created_at, id: last.order_id };
  }
  return { computedAt: now, from, to: now, result: acc.result(), quotesTotal, ordersTotal };
}

// ---- 应答（也是存进复核记录的样子）----

function sectionJson(section: ImpactSection, total: number, limit: number): AuditValues {
  const totals = (value: ImpactSection["before"]): AuditValues => ({ sell_minor: value.sellMinor, settlement_minor: value.settlementMinor, margin_minor: value.marginMinor });
  return {
    total,
    truncated: total > limit,
    count: section.count,
    skipped: section.skipped,
    before: totals(section.before),
    after: totals(section.after),
    diff: totals(section.diff),
    winner_changed: section.winnerChanged,
    min_margin_raised_before: section.minMarginRaisedBefore,
    min_margin_raised_after: section.minMarginRaisedAfter,
    became_unquotable: section.becameUnquotable,
    became_quotable: section.becameQuotable,
  };
}

export function pricingImpactJson(report: PricingImpactReport): AuditValues {
  const { result } = report;
  return {
    computed_at: report.computedAt.toISOString(),
    window_days: PRICING_IMPACT_RULES.windowDays,
    from: report.from.toISOString(),
    to: report.to.toISOString(),
    settle_currency: result.settleCurrency,
    quotes: sectionJson(result.quotes, report.quotesTotal, PRICING_IMPACT_RULES.maxQuotes),
    orders: { ...sectionJson(result.orders, report.ordersTotal, PRICING_IMPACT_RULES.maxOrders), cancelled_with_fee: result.orders.cancelledWithFee, cancelled_free: result.orders.cancelledFree },
  };
}

/** 发起之前 / 发起时的试算：按发起复核的规则校验入参。渠道不存在 404。 */
export function channelPricingImpact(ctx: AppContext, channelId: string, proposal: PricingProposal): Promise<AuditValues> {
  const now = ctx.now();
  return withPlatformTx(
    ctx.pool,
    async (db) => {
      const channel = await loadChannel(db, channelId);
      const states = await pricingStates(db, channel, proposal, { validate: true, now });
      return pricingImpactJson(await compute(db, ctx, channel, states, now));
    },
    { snapshot: true },
  );
}

/** 复核记录里存的改动 → 试算的改动。 */
function proposalOf(kind: string, payload: AuditValues): PricingProposal | null {
  switch (kind) {
    case "channel.pricing":
      return { kind, change: pricingFromValues(payload) };
    case "markup_rule.create":
      return { kind, rule: ruleFromValues(payload) };
    case "markup_rule.update":
      return { kind, ruleId: payload["rule_id"] as string, rule: ruleFromValues(payload) };
    case "markup_rule.delete":
      return { kind, ruleId: payload["rule_id"] as string };
    default:
      return null;
  }
}

/**
 * 审核人「按现在的数据再算一次」：只读，不改复核记录里存的那一份。
 * 看不到这一类的当作不存在（404）；能看到、但既不能审核也不能发起这一类的 403；不是定价、规则的复核 409；已经有结论的 409。
 */
export async function recomputeApprovalImpact(ctx: AppContext, kinds: ApprovalKinds, principal: PlatformPrincipal, approvalId: string): Promise<AuditValues> {
  const now = ctx.now();
  return withPlatformTx(
    ctx.pool,
    async (db) => {
      const approval = await findApproval(db, approvalId);
      const kind = approval === null ? undefined : kinds.get(approval.kind);
      if (!approval || !kind || !platformRoleCan(principal.user.role, kind.readAction)) throw notFound("复核记录");
      if (!platformRoleCan(principal.user.role, kind.reviewAction) && !platformRoleCan(principal.user.role, kind.requestAction)) throw forbidden(kind.reviewAction satisfies PlatformAction);
      const proposal = proposalOf(approval.kind, approval.payload);
      if (proposal === null) throw new AppError(409, "PRICING_IMPACT_NOT_APPLICABLE", "只有改定价参数、加价规则的复核才有毛利试算", { kind: approval.kind });
      if (approval.status !== "pending") throw new AppError(409, "APPROVAL_NOT_PENDING", "这条复核已经有结论了，不用再试算", { status: approval.status });
      const channel = await loadChannel(db, approval.resourceId);
      const states = await pricingStates(db, channel, proposal, { validate: false, now });
      return pricingImpactJson(await compute(db, ctx, channel, states, now));
    },
    { snapshot: true },
  );
}
