/**
 * 渠道与加价规则（M2-04，ADR 0023）。平台员工的操作，都在 withPlatformTx 里，写审计日志。
 *
 * - 新建渠道、改基本信息和授权范围、启用：直接生效（`channel.manage`）。
 * - 改定价参数（默认加价比例、加价下限、价格带、最低毛利、对外价取整）、加价规则的新增 / 修改 / 删除、暂停渠道：
 *   发起一条双人复核，另一个人批准后才生效（需求「敏感操作双人复核」「修改加价规则需双人复核」）。发起时和批准时各校验一次：
 *   发起时挡住明显不对的（低于下限、日期重叠），批准时再按那一刻的数据校验（下限可能已经调高、别人可能先批了一条重叠的）。
 */
import {
  CHANNEL_RULES,
  type ChannelIssue,
  type ChannelPricing,
  type ChannelScope,
  type MarkupRuleIssue,
  type ServiceCategory,
  channelPricingIssues,
  conflictingMarkupRules,
  markupLevelOf,
  markupRuleIssues,
  rulesBelowFloor,
  samePricing,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, isUniqueViolation, withPlatformTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import type { Page, TimeCursor } from "../pagination.ts";
import type { Approval } from "../repos/approvals.ts";
import { type AuditOrigin, type AuditValues, insertAuditLog } from "../repos/audit-logs.ts";
import {
  type Channel,
  type ChannelFilter,
  type ChannelProfile,
  type MarkupRuleInput,
  type StoredMarkupRule,
  bumpChannelPricingVersion,
  deleteMarkupRule,
  findChannel,
  findMarkupRule,
  insertChannel,
  insertMarkupRule,
  listChannels,
  listMarkupRules,
  missingCities,
  missingTenants,
  updateChannelPricing,
  updateChannelProfile,
  updateChannelStatus,
  updateMarkupRule,
  vehicleGroupExists,
} from "../repos/channels.ts";
import { type InputIssue, validationFailed } from "../validation.ts";
import { type ApprovalKind, approvalStale, requestApproval } from "./approvals.ts";
import { consoleOrigin, platformActor } from "./audit.ts";
import { notFound, versionConflict } from "./errors.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";

// ---- 校验和错误 ----

const PRICING_MESSAGES: Readonly<Record<ChannelIssue["reason"], string>> = {
  OUT_OF_RANGE: "超出了允许的范围",
  BELOW_PLATFORM_FLOOR: `加价下限不能低于平台下限 ${CHANNEL_RULES.platformMarkupFloorBp / 100}%`,
  BELOW_FLOOR: "默认加价比例不能低于这个渠道的加价下限",
  UNSUPPORTED_CURRENCY: "不支持这个币种",
  NOT_INTEGER: "必须是整数",
};

const RULE_MESSAGES: Readonly<Record<MarkupRuleIssue["reason"], string>> = {
  UNSUPPORTED_COMBINATION: "维度组合只能是五级之一：租户 × 城市 × 品类 × 车型组、租户、城市 × 品类 × 车型组、城市 × 品类、全渠道（带日期）",
  OUT_OF_RANGE: "超出了允许的范围",
  BELOW_FLOOR: "加价比例低于这个渠道的加价下限，系统不允许",
  DATE_ORDER: "结束日期不能早于开始日期",
  INVALID_DATE: "不是真实存在的日期（YYYY-MM-DD）",
  DATES_REQUIRED: "全渠道的规则必须带日期范围（不带日期的全渠道比例就是渠道的默认加价比例）",
};

function assertPricing(pricing: ChannelPricing): void {
  const issues = channelPricingIssues(pricing).map((issue): InputIssue => ({ path: issue.path, reason: issue.reason, message: PRICING_MESSAGES[issue.reason] }));
  if (issues.length > 0) throw validationFailed("body", issues);
}

function channelNameTaken(): AppError {
  return new AppError(409, "CHANNEL_NAME_TAKEN", "已经有同名的渠道，请换一个名字");
}

async function assertScope(db: Db, scope: ChannelScope): Promise<void> {
  const issues: InputIssue[] = [];
  if (scope.tenantScope === "all" && scope.tenantIds.length > 0) issues.push({ path: "/scope/tenant_ids", reason: "NOT_APPLICABLE", message: "可卖全部租户时不填租户名单" });
  if (scope.tenantScope !== "all" && scope.tenantIds.length === 0) issues.push({ path: "/scope/tenant_ids", reason: "REQUIRED", message: "白名单或黑名单至少要有一个租户" });
  if (scope.cityIds !== null && scope.cityIds.length === 0) issues.push({ path: "/scope/city_ids", reason: "REQUIRED", message: "指定城市时至少选一个；不限城市请填 null" });
  for (const id of await missingTenants(db, scope.tenantIds)) issues.push({ path: "/scope/tenant_ids", reason: "UNKNOWN_TENANT", message: "租户不存在", detail: { id } });
  for (const id of await missingCities(db, scope.cityIds ?? [])) issues.push({ path: "/scope/city_ids", reason: "UNKNOWN_CITY", message: "城市不存在", detail: { id } });
  if (issues.length > 0) throw validationFailed("body", issues);
}

async function loadChannel(db: Db, channelId: string, lock = false): Promise<Channel> {
  const channel = await findChannel(db, channelId, { lock });
  if (!channel) throw notFound("渠道");
  return channel;
}

// ---- 审计里的前后值（白名单字段） ----

export function pricingValues(pricing: ChannelPricing): AuditValues {
  return { default_markup_bp: pricing.defaultMarkupBp, markup_floor_bp: pricing.markupFloorBp, band_bp: pricing.bandBp, min_margin_minor: pricing.minMarginMinor, sell_rounding: { ...pricing.sellRounding } as AuditValues };
}

function profileValues(channel: Pick<Channel, keyof ChannelProfile | "scope">): AuditValues {
  return {
    name: channel.name,
    type: channel.type,
    company: channel.company,
    contact_name: channel.contactName,
    contact_email: channel.contactEmail,
    contact_phone: channel.contactPhone,
    contract_ref: channel.contractRef,
    notes: channel.notes,
    settle_currency: channel.settleCurrency,
    payment_mode: channel.paymentMode,
    credit_limit_minor: channel.creditLimitMinor,
    show_tenant_after_pay: channel.showTenantAfterPay,
    tenant_scope: channel.scope.tenantScope,
    tenant_ids: [...channel.scope.tenantIds],
    city_ids: channel.scope.cityIds === null ? null : [...channel.scope.cityIds],
    categories: [...channel.scope.categories],
  };
}

export function ruleValues(rule: Omit<MarkupRuleInput, "level"> & { level?: number }): AuditValues {
  return {
    level: rule.level ?? markupLevelOf(rule),
    tenant_id: rule.tenantId,
    city_id: rule.cityId,
    category: rule.category,
    vehicle_group_id: rule.vehicleGroupId,
    markup_bp: rule.markupBp,
    valid_from: rule.validFrom,
    valid_to: rule.validTo,
    note: rule.note,
  };
}

function ruleFromValues(values: AuditValues): Omit<MarkupRuleInput, "level"> {
  const text = (key: string): string | null => (typeof values[key] === "string" ? (values[key] as string) : null);
  return {
    tenantId: text("tenant_id"),
    cityId: text("city_id"),
    category: text("category") as ServiceCategory | null,
    vehicleGroupId: text("vehicle_group_id"),
    markupBp: values["markup_bp"] as number,
    validFrom: text("valid_from"),
    validTo: text("valid_to"),
    note: text("note"),
  };
}

function pricingFromValues(values: AuditValues): ChannelPricing {
  return {
    defaultMarkupBp: values["default_markup_bp"] as number,
    markupFloorBp: values["markup_floor_bp"] as number,
    bandBp: values["band_bp"] as number,
    minMarginMinor: values["min_margin_minor"] as number,
    sellRounding: (values["sell_rounding"] ?? {}) as ChannelPricing["sellRounding"],
  };
}

// ---- 渠道 ----

export interface ChannelInput {
  profile: ChannelProfile;
  scope: ChannelScope;
  pricing: ChannelPricing;
}

/** 新建渠道：状态是「测试」。定价参数在新建时直接定（还没有在卖），以后再改走复核。 */
export async function createChannel(ctx: AppContext, principal: PlatformPrincipal, input: ChannelInput, ip: string): Promise<Channel> {
  assertPricing(input.pricing);
  const now = ctx.now();
  const origin = consoleOrigin(platformActor(principal.user), ip, now);
  try {
    return await withPlatformTx(ctx.pool, async (db) => {
      await assertScope(db, input.scope);
      const id = await insertChannel(db, { ...input, createdBy: principal.user.id, now });
      const channel = await loadChannel(db, id);
      await insertAuditLog(db, origin, { tenantId: null, resource: "channel", resourceId: id, action: "create", before: null, after: { ...profileValues(channel), status: channel.status, ...pricingValues(channel.pricing) } });
      return channel;
    });
  } catch (err) {
    if (isUniqueViolation(err, "channels_name_key")) throw channelNameTaken();
    throw err;
  }
}

export function listChannelsFor(ctx: AppContext, filter: ChannelFilter, limit: number, after: TimeCursor | null): Promise<Page<Channel> & { total: number }> {
  return withPlatformTx(ctx.pool, (db) => listChannels(db, filter, limit, after), { snapshot: true });
}

export interface ChannelDetail {
  channel: Channel;
  rules: StoredMarkupRule[];
}

export function getChannelDetail(ctx: AppContext, channelId: string): Promise<ChannelDetail> {
  return withPlatformTx(ctx.pool, async (db) => ({ channel: await loadChannel(db, channelId), rules: await listMarkupRules(db, channelId) }), { snapshot: true });
}

/** 改基本信息和授权范围（不含定价参数和状态）：直接生效，`If-Match` 带版本号。 */
export async function updateChannel(ctx: AppContext, principal: PlatformPrincipal, channelId: string, version: number, change: (current: Channel) => { profile: ChannelProfile; scope: ChannelScope }, ip: string): Promise<Channel> {
  const now = ctx.now();
  const origin = consoleOrigin(platformActor(principal.user), ip, now);
  try {
    return await withPlatformTx(ctx.pool, async (db) => {
      const current = await loadChannel(db, channelId, true);
      if (current.version !== version) throw versionConflict(current.version);
      const next = change(current);
      await assertScope(db, next.scope);
      await updateChannelProfile(db, channelId, next.profile, next.scope, now);
      const updated = await loadChannel(db, channelId);
      await insertAuditLog(db, origin, { tenantId: null, resource: "channel", resourceId: channelId, action: "update", before: profileValues(current), after: profileValues(updated) });
      return updated;
    });
  } catch (err) {
    if (isUniqueViolation(err, "channels_name_key")) throw channelNameTaken();
    throw err;
  }
}

/** 启用（测试 → 启用、暂停 → 启用）：直接生效。停用（暂停）要复核，见 `requestChannelPause`。 */
export async function activateChannel(ctx: AppContext, principal: PlatformPrincipal, channelId: string, ip: string): Promise<Channel> {
  const now = ctx.now();
  const origin = consoleOrigin(platformActor(principal.user), ip, now);
  return withPlatformTx(ctx.pool, async (db) => {
    const current = await loadChannel(db, channelId, true);
    if (current.status === "active") throw new AppError(409, "CHANNEL_STATUS_UNCHANGED", "渠道已经是启用状态");
    await updateChannelStatus(db, channelId, "active", now);
    await insertAuditLog(db, origin, { tenantId: null, resource: "channel", resourceId: channelId, action: "activate", before: { status: current.status }, after: { status: "active" } });
    return loadChannel(db, channelId);
  });
}

// ---- 发起复核 ----

const CATEGORY_NAMES: Readonly<Record<ServiceCategory, string>> = { airport_transfer: "接送机", point_to_point: "点对点", charter: "包车" };
const percent = (bp: number): string => `${(bp / 100).toFixed(2).replace(/\.?0+$/, "")}%`;

export const CHANNEL_PRICING: ApprovalKind = {
  kind: "channel.pricing",
  resource: "channel",
  readAction: "channel.read",
  requestAction: "channel.manage",
  reviewAction: "channel.review",
  async apply(db, approval, origin) {
    const channel = await loadChannel(db, approval.resourceId, true);
    if (approval.baseVersion !== null && channel.pricingVersion !== approval.baseVersion) throw approvalStale(channel.pricingVersion);
    const pricing = pricingFromValues(approval.payload);
    assertPricing(pricing);
    await assertNoRuleBelowFloor(db, channel.id, pricing.markupFloorBp, origin.occurredAt);
    await updateChannelPricing(db, channel.id, pricing, origin.occurredAt);
    await insertAuditLog(db, origin, { tenantId: null, resource: "channel", resourceId: channel.id, action: "update", before: pricingValues(channel.pricing), after: { ...pricingValues(pricing), approval_id: approval.id, requested_by: approval.requestedBy.email } });
  },
};

export const CHANNEL_PAUSE: ApprovalKind = {
  kind: "channel.pause",
  resource: "channel",
  readAction: "channel.read",
  requestAction: "channel.manage",
  reviewAction: "channel.review",
  async apply(db, approval, origin) {
    const channel = await loadChannel(db, approval.resourceId, true);
    if (channel.status === "paused") throw new AppError(409, "CHANNEL_STATUS_UNCHANGED", "渠道已经是暂停状态");
    await updateChannelStatus(db, channel.id, "paused", origin.occurredAt);
    await insertAuditLog(db, origin, { tenantId: null, resource: "channel", resourceId: channel.id, action: "pause", before: { status: channel.status }, after: { status: "paused", approval_id: approval.id, requested_by: approval.requestedBy.email } });
  },
};

function rulesBelowFloorError(ruleIds: readonly string[], floorBp: number): AppError {
  return new AppError(409, "RULES_BELOW_FLOOR", `有 ${ruleIds.length} 条还在用的加价规则低于新的下限 ${percent(floorBp)}，请先把它们改到下限以上再调高下限`, { rule_ids: [...ruleIds], floor_bp: floorBp });
}

async function assertNoRuleBelowFloor(db: Db, channelId: string, floorBp: number, now: Date): Promise<void> {
  const below = rulesBelowFloor(await listMarkupRules(db, channelId), floorBp, now.toISOString().slice(0, 10));
  if (below.length > 0) throw rulesBelowFloorError(below.map((rule) => rule.id), floorBp);
}

/** 发起修改定价参数。和现在一样的不发起（400）；不合规则的、会让现有规则低于新下限的，发起时就拦下。 */
export async function requestPricingChange(ctx: AppContext, principal: PlatformPrincipal, channelId: string, pricing: ChannelPricing, note: string | null, ip: string): Promise<Approval> {
  assertPricing(pricing);
  const now = ctx.now();
  const origin = consoleOrigin(platformActor(principal.user), ip, now);
  return withPlatformTx(ctx.pool, async (db) => {
    const channel = await loadChannel(db, channelId);
    if (samePricing(channel.pricing, pricing)) throw validationFailed("body", [{ path: "/", reason: "UNCHANGED", message: "和现在的定价参数一样，不用发起" }]);
    await assertNoRuleBelowFloor(db, channelId, pricing.markupFloorBp, now);
    const changes = [
      channel.pricing.defaultMarkupBp !== pricing.defaultMarkupBp ? `默认加价 ${percent(channel.pricing.defaultMarkupBp)} → ${percent(pricing.defaultMarkupBp)}` : null,
      channel.pricing.markupFloorBp !== pricing.markupFloorBp ? `加价下限 ${percent(channel.pricing.markupFloorBp)} → ${percent(pricing.markupFloorBp)}` : null,
      channel.pricing.bandBp !== pricing.bandBp ? `价格带 ${percent(channel.pricing.bandBp)} → ${percent(pricing.bandBp)}` : null,
      channel.pricing.minMarginMinor !== pricing.minMarginMinor ? "最低毛利金额" : null,
      JSON.stringify(channel.pricing.sellRounding) !== JSON.stringify(pricing.sellRounding) ? "对外价取整" : null,
    ].filter((item): item is string => item !== null);
    return requestApproval(db, origin, principal, {
      kind: CHANNEL_PRICING,
      resourceId: channelId,
      summary: `「${channel.name}」改定价参数：${changes.join("，")}`,
      payload: pricingValues(pricing),
      before: pricingValues(channel.pricing),
      baseVersion: channel.pricingVersion,
      note,
    });
  });
}

export async function requestChannelPause(ctx: AppContext, principal: PlatformPrincipal, channelId: string, note: string | null, ip: string): Promise<Approval> {
  const now = ctx.now();
  const origin = consoleOrigin(platformActor(principal.user), ip, now);
  return withPlatformTx(ctx.pool, async (db) => {
    const channel = await loadChannel(db, channelId);
    if (channel.status === "paused") throw new AppError(409, "CHANNEL_STATUS_UNCHANGED", "渠道已经是暂停状态");
    return requestApproval(db, origin, principal, { kind: CHANNEL_PAUSE, resourceId: channelId, summary: `暂停渠道「${channel.name}」`, payload: { status: "paused" }, before: { status: channel.status }, baseVersion: null, note });
  });
}

// ---- 加价规则 ----

export interface RuleInput {
  tenantId: string | null;
  cityId: string | null;
  category: ServiceCategory | null;
  vehicleGroupId: string | null;
  markupBp: number;
  validFrom: string | null;
  validTo: string | null;
  note: string | null;
}

/** 一条规则能不能存进这个渠道：维度组合、不低于下限、日期、引用的租户 / 城市 / 车型组存在、和现有规则不冲突。 */
async function assertRule(db: Db, channel: Channel, rule: RuleInput, exceptId: string | null): Promise<MarkupRuleInput> {
  const issues: InputIssue[] = markupRuleIssues(rule, channel.pricing.markupFloorBp).map((issue) => ({
    path: issue.path,
    reason: issue.reason,
    message: issue.reason === "BELOW_FLOOR" ? `加价比例不能低于这个渠道的加价下限 ${percent(Math.max(channel.pricing.markupFloorBp, CHANNEL_RULES.platformMarkupFloorBp))}，系统不允许` : RULE_MESSAGES[issue.reason],
    ...(issue.reason === "BELOW_FLOOR" ? { detail: { floor_bp: Math.max(channel.pricing.markupFloorBp, CHANNEL_RULES.platformMarkupFloorBp) } } : {}),
  }));
  if (rule.tenantId !== null && (await missingTenants(db, [rule.tenantId])).length > 0) issues.push({ path: "/tenant_id", reason: "UNKNOWN_TENANT", message: "租户不存在" });
  if (rule.cityId !== null && (await missingCities(db, [rule.cityId])).length > 0) issues.push({ path: "/city_id", reason: "UNKNOWN_CITY", message: "城市不存在" });
  if (rule.vehicleGroupId !== null && !(await vehicleGroupExists(db, rule.vehicleGroupId))) issues.push({ path: "/vehicle_group_id", reason: "UNKNOWN_VEHICLE_GROUP", message: "车型组不存在" });
  if (issues.length > 0) throw validationFailed("body", issues);
  const conflicts = conflictingMarkupRules(await listMarkupRules(db, channel.id), rule, exceptId);
  if (conflicts.length > 0) {
    throw new AppError(409, "MARKUP_RULE_CONFLICT", "同一组维度上已经有一条规则：不带日期的只能有一条，带日期的日期范围不能重叠", { rule_ids: conflicts.map((item) => item.id) });
  }
  return { ...rule, level: markupLevelOf(rule) as MarkupRuleInput["level"] };
}

async function ruleSummary(db: Db, rule: RuleInput): Promise<string> {
  const names = await db.query<{ tenant: string | null; city: string | null; vg: string | null }>(
    `select (select name from tenants where id = $1) as tenant,
            (select coalesce(name->>'zh', name->>'en', code) from cities where id = $2) as city,
            (select coalesce(name->>'zh', name->>'en', code) from vehicle_groups where id = $3) as vg`,
    [rule.tenantId, rule.cityId, rule.vehicleGroupId],
  );
  const row = names.rows[0] ?? { tenant: null, city: null, vg: null };
  const parts = [row.tenant, row.city, rule.category === null ? null : CATEGORY_NAMES[rule.category], row.vg].filter((part): part is string => part !== null);
  const dates = rule.validFrom !== null || rule.validTo !== null ? `（${rule.validFrom ?? "不限"} 至 ${rule.validTo ?? "不限"}）` : "";
  return `${parts.length === 0 ? "全渠道" : parts.join(" · ")} = ${percent(rule.markupBp)}${dates}`;
}

function sameRule(a: RuleInput, b: RuleInput): boolean {
  return a.tenantId === b.tenantId && a.cityId === b.cityId && a.category === b.category && a.vehicleGroupId === b.vehicleGroupId && a.markupBp === b.markupBp && a.validFrom === b.validFrom && a.validTo === b.validTo && a.note === b.note;
}

export const MARKUP_RULE_CREATE: ApprovalKind = {
  kind: "markup_rule.create",
  resource: "channel",
  readAction: "channel.read",
  requestAction: "channel.manage",
  reviewAction: "channel.review",
  async apply(db, approval, origin) {
    const channel = await loadChannel(db, approval.resourceId, true);
    const rule = await assertRule(db, channel, ruleFromValues(approval.payload), null);
    const id = await insertMarkupRule(db, channel.id, rule, origin.occurredAt);
    await bumpChannelPricingVersion(db, channel.id, origin.occurredAt);
    await insertAuditLog(db, origin, { tenantId: null, resource: "markup_rule", resourceId: id, action: "create", before: null, after: { channel_id: channel.id, ...ruleValues(rule), approval_id: approval.id, requested_by: approval.requestedBy.email } });
  },
};

export const MARKUP_RULE_UPDATE: ApprovalKind = {
  kind: "markup_rule.update",
  resource: "channel",
  readAction: "channel.read",
  requestAction: "channel.manage",
  reviewAction: "channel.review",
  async apply(db, approval, origin) {
    const channel = await loadChannel(db, approval.resourceId, true);
    const ruleId = approval.payload["rule_id"] as string;
    const current = await findMarkupRule(db, channel.id, ruleId);
    if (!current) throw new AppError(409, "APPROVAL_STALE", "要改的这条加价规则已经被删除了；请驳回", { current_version: null });
    if (approval.baseVersion !== null && current.version !== approval.baseVersion) throw approvalStale(current.version);
    const rule = await assertRule(db, channel, ruleFromValues(approval.payload), ruleId);
    await updateMarkupRule(db, ruleId, rule, origin.occurredAt);
    await bumpChannelPricingVersion(db, channel.id, origin.occurredAt);
    await insertAuditLog(db, origin, { tenantId: null, resource: "markup_rule", resourceId: ruleId, action: "update", before: ruleValues(current), after: { ...ruleValues(rule), approval_id: approval.id, requested_by: approval.requestedBy.email } });
  },
};

export const MARKUP_RULE_DELETE: ApprovalKind = {
  kind: "markup_rule.delete",
  resource: "channel",
  readAction: "channel.read",
  requestAction: "channel.manage",
  reviewAction: "channel.review",
  async apply(db, approval, origin) {
    const channel = await loadChannel(db, approval.resourceId, true);
    const ruleId = approval.payload["rule_id"] as string;
    const current = await findMarkupRule(db, channel.id, ruleId);
    if (!current) throw new AppError(409, "APPROVAL_STALE", "这条加价规则已经被删除了；请驳回", { current_version: null });
    if (approval.baseVersion !== null && current.version !== approval.baseVersion) throw approvalStale(current.version);
    await deleteMarkupRule(db, ruleId, origin.occurredAt);
    await bumpChannelPricingVersion(db, channel.id, origin.occurredAt);
    await insertAuditLog(db, origin, { tenantId: null, resource: "markup_rule", resourceId: ruleId, action: "delete", before: ruleValues(current), after: { approval_id: approval.id, requested_by: approval.requestedBy.email } });
  },
};

/** 渠道这一组的复核（登记到 services/approval-kinds.ts）。 */
export const CHANNEL_APPROVAL_KINDS: readonly ApprovalKind[] = [CHANNEL_PRICING, CHANNEL_PAUSE, MARKUP_RULE_CREATE, MARKUP_RULE_UPDATE, MARKUP_RULE_DELETE];

export async function requestRuleCreate(ctx: AppContext, principal: PlatformPrincipal, channelId: string, rule: RuleInput, note: string | null, ip: string): Promise<Approval> {
  const now = ctx.now();
  const origin = consoleOrigin(platformActor(principal.user), ip, now);
  return withPlatformTx(ctx.pool, async (db) => {
    const channel = await loadChannel(db, channelId);
    const checked = await assertRule(db, channel, rule, null);
    return requestApproval(db, origin, principal, { kind: MARKUP_RULE_CREATE, resourceId: channelId, summary: `「${channel.name}」新增加价规则：${await ruleSummary(db, rule)}`, payload: ruleValues(checked), before: null, baseVersion: null, note });
  });
}

export async function requestRuleUpdate(ctx: AppContext, principal: PlatformPrincipal, channelId: string, ruleId: string, version: number, rule: RuleInput, note: string | null, ip: string): Promise<Approval> {
  const now = ctx.now();
  const origin = consoleOrigin(platformActor(principal.user), ip, now);
  return withPlatformTx(ctx.pool, async (db) => {
    const channel = await loadChannel(db, channelId);
    const current = await findMarkupRule(db, channelId, ruleId);
    if (!current) throw notFound("加价规则");
    if (current.version !== version) throw versionConflict(current.version);
    if (sameRule(current, rule)) throw validationFailed("body", [{ path: "/", reason: "UNCHANGED", message: "和现在的规则一样，不用发起" }]);
    const checked = await assertRule(db, channel, rule, ruleId);
    return requestApproval(db, origin, principal, {
      kind: MARKUP_RULE_UPDATE,
      resourceId: channelId,
      summary: `「${channel.name}」修改加价规则：${await ruleSummary(db, current)} → ${await ruleSummary(db, rule)}`,
      payload: { rule_id: ruleId, ...ruleValues(checked) },
      before: ruleValues(current),
      baseVersion: current.version,
      note,
    });
  });
}

export async function requestRuleDelete(ctx: AppContext, principal: PlatformPrincipal, channelId: string, ruleId: string, version: number, note: string | null, ip: string): Promise<Approval> {
  const now = ctx.now();
  const origin = consoleOrigin(platformActor(principal.user), ip, now);
  return withPlatformTx(ctx.pool, async (db) => {
    const channel = await loadChannel(db, channelId);
    const current = await findMarkupRule(db, channelId, ruleId);
    if (!current) throw notFound("加价规则");
    if (current.version !== version) throw versionConflict(current.version);
    return requestApproval(db, origin, principal, { kind: MARKUP_RULE_DELETE, resourceId: channelId, summary: `「${channel.name}」删除加价规则：${await ruleSummary(db, current)}`, payload: { rule_id: ruleId }, before: ruleValues(current), baseVersion: current.version, note });
  });
}

