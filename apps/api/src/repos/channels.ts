/**
 * 渠道、授权范围、加价规则、API 客户端的数据访问（M2-04，ADR 0023）。全是平台表，只在 withPlatformTx 里调用。
 * 指向租户的列叫 supplier_tenant_id（平台的配置，不是租户的数据）。
 */
import type { ChannelPricing, ChannelScope, ChannelStatus, ChannelType, MarkupLevel, MarkupRule, PaymentMode, SellRounding, ServiceCategory, TenantScope } from "@nozomi/domain";
import type { CurrencyCode } from "@nozomi/domain";
import type { Db } from "../db/context.ts";
import { type Page, type TimeCursor, toPage } from "../pagination.ts";

export interface ChannelProfile {
  name: string;
  type: ChannelType;
  company: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  contractRef: string | null;
  notes: string | null;
  settleCurrency: CurrencyCode;
  paymentMode: PaymentMode;
  creditLimitMinor: number | null;
  showTenantAfterPay: boolean;
}

export interface Channel extends ChannelProfile {
  id: string;
  status: ChannelStatus;
  pricing: ChannelPricing;
  scope: ChannelScope;
  version: number;
  pricingVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

interface ChannelRow {
  id: string;
  name: string;
  type: ChannelType;
  status: ChannelStatus;
  company: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contract_ref: string | null;
  notes: string | null;
  settle_currency: CurrencyCode;
  tenant_scope: TenantScope;
  city_scope: "all" | "listed";
  categories: ServiceCategory[];
  payment_mode: PaymentMode;
  credit_limit_minor: string | null;
  default_markup_bp: number;
  markup_floor_bp: number;
  band_bp: number;
  min_margin_minor: string;
  sell_rounding: SellRounding;
  show_tenant_after_pay: boolean;
  version: number;
  pricing_version: number;
  created_at: Date;
  updated_at: Date;
  tenant_ids: string[];
  city_ids: string[];
}

const COLUMNS = `c.id, c.name, c.type, c.status, c.company, c.contact_name, c.contact_email, c.contact_phone, c.contract_ref, c.notes, c.settle_currency,
  c.tenant_scope, c.city_scope, c.categories, c.payment_mode, c.credit_limit_minor::text, c.default_markup_bp, c.markup_floor_bp, c.band_bp,
  c.min_margin_minor::text, c.sell_rounding, c.show_tenant_after_pay, c.version, c.pricing_version, c.created_at, c.updated_at,
  coalesce((select array_agg(t.supplier_tenant_id::text order by t.supplier_tenant_id) from channel_tenants t where t.channel_id = c.id), '{}') as tenant_ids,
  coalesce((select array_agg(x.city_id::text order by x.city_id) from channel_cities x where x.channel_id = c.id), '{}') as city_ids`;

function toChannel(row: ChannelRow): Channel {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    company: row.company,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    contractRef: row.contract_ref,
    notes: row.notes,
    settleCurrency: row.settle_currency,
    paymentMode: row.payment_mode,
    creditLimitMinor: row.credit_limit_minor === null ? null : Number(row.credit_limit_minor),
    showTenantAfterPay: row.show_tenant_after_pay,
    pricing: { defaultMarkupBp: row.default_markup_bp, markupFloorBp: row.markup_floor_bp, bandBp: row.band_bp, minMarginMinor: Number(row.min_margin_minor), sellRounding: row.sell_rounding },
    scope: { tenantScope: row.tenant_scope, tenantIds: row.tenant_ids, cityIds: row.city_scope === "all" ? null : row.city_ids, categories: row.categories },
    version: row.version,
    pricingVersion: row.pricing_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertChannel(db: Db, input: { profile: ChannelProfile; pricing: ChannelPricing; scope: ChannelScope; createdBy: string; now: Date }): Promise<string> {
  const { profile, pricing, scope } = input;
  const result = await db.query<{ id: string }>(
    `insert into channels (name, type, status, company, contact_name, contact_email, contact_phone, contract_ref, notes, settle_currency, tenant_scope, city_scope, categories,
                           payment_mode, credit_limit_minor, default_markup_bp, markup_floor_bp, band_bp, min_margin_minor, sell_rounding, show_tenant_after_pay, created_by, created_at, updated_at)
     values ($1, $2, 'testing', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20, $21, $22, $22)
     returning id`,
    [
      profile.name, profile.type, profile.company, profile.contactName, profile.contactEmail, profile.contactPhone, profile.contractRef, profile.notes, profile.settleCurrency,
      scope.tenantScope, scope.cityIds === null ? "all" : "listed", scope.categories, profile.paymentMode, profile.creditLimitMinor,
      pricing.defaultMarkupBp, pricing.markupFloorBp, pricing.bandBp, pricing.minMarginMinor, JSON.stringify(pricing.sellRounding), profile.showTenantAfterPay, input.createdBy, input.now,
    ],
  );
  const id = (result.rows[0] as { id: string }).id;
  await replaceScopeLists(db, id, scope);
  return id;
}

async function replaceScopeLists(db: Db, channelId: string, scope: ChannelScope): Promise<void> {
  await db.query("delete from channel_tenants where channel_id = $1", [channelId]);
  await db.query("delete from channel_cities where channel_id = $1", [channelId]);
  if (scope.tenantIds.length > 0) await db.query("insert into channel_tenants (channel_id, supplier_tenant_id) select $1, unnest($2::uuid[])", [channelId, scope.tenantIds]);
  if (scope.cityIds !== null && scope.cityIds.length > 0) await db.query("insert into channel_cities (channel_id, city_id) select $1, unnest($2::uuid[])", [channelId, scope.cityIds]);
}

export async function findChannel(db: Db, channelId: string, options: { lock?: boolean } = {}): Promise<Channel | null> {
  if (options.lock) await db.query("select 1 from channels where id = $1 for update", [channelId]);
  const result = await db.query<ChannelRow>(`select ${COLUMNS} from channels c where c.id = $1`, [channelId]);
  const row = result.rows[0];
  return row ? toChannel(row) : null;
}

export interface ChannelFilter {
  status: ChannelStatus | null;
  type: ChannelType | null;
  q: string | null;
}

export async function listChannels(db: Db, filter: ChannelFilter, limit: number, after: TimeCursor | null): Promise<Page<Channel> & { total: number }> {
  const where = `($1::text is null or c.status = $1) and ($2::text is null or c.type = $2) and ($3::text is null or c.name ilike '%' || $3 || '%' or c.company ilike '%' || $3 || '%')`;
  const params = [filter.status, filter.type, filter.q === null ? null : filter.q.replace(/[\\%_]/g, (ch) => `\\${ch}`)];
  const result = await db.query<ChannelRow & { cursor_time: string }>(
    `select ${COLUMNS}, c.created_at::text as cursor_time from channels c
      where ${where} and ($4::timestamptz is null or (c.created_at, c.id) > ($4::timestamptz, $5::uuid))
      order by c.created_at, c.id limit $6`,
    [...params, after?.t ?? null, after?.id ?? null, limit + 1],
  );
  const total = await db.query<{ n: number }>(`select count(*)::int as n from channels c where ${where}`, params);
  return { ...toPage(result.rows, limit, toChannel, (row) => ({ t: row.cursor_time, id: row.id })), total: (total.rows[0] as { n: number }).n };
}

export async function updateChannelProfile(db: Db, channelId: string, profile: ChannelProfile, scope: ChannelScope, now: Date): Promise<void> {
  await db.query(
    `update channels set name = $2, type = $3, company = $4, contact_name = $5, contact_email = $6, contact_phone = $7, contract_ref = $8, notes = $9, settle_currency = $10,
            payment_mode = $11, credit_limit_minor = $12, show_tenant_after_pay = $13, tenant_scope = $14, city_scope = $15, categories = $16, version = version + 1, updated_at = $17
      where id = $1`,
    [
      channelId, profile.name, profile.type, profile.company, profile.contactName, profile.contactEmail, profile.contactPhone, profile.contractRef, profile.notes, profile.settleCurrency,
      profile.paymentMode, profile.creditLimitMinor, profile.showTenantAfterPay, scope.tenantScope, scope.cityIds === null ? "all" : "listed", scope.categories, now,
    ],
  );
  await replaceScopeLists(db, channelId, scope);
}

export async function updateChannelPricing(db: Db, channelId: string, pricing: ChannelPricing, now: Date): Promise<void> {
  await db.query(
    `update channels set default_markup_bp = $2, markup_floor_bp = $3, band_bp = $4, min_margin_minor = $5, sell_rounding = $6::jsonb,
            version = version + 1, pricing_version = pricing_version + 1, updated_at = $7 where id = $1`,
    [channelId, pricing.defaultMarkupBp, pricing.markupFloorBp, pricing.bandBp, pricing.minMarginMinor, JSON.stringify(pricing.sellRounding), now],
  );
}

export async function updateChannelStatus(db: Db, channelId: string, status: ChannelStatus, now: Date): Promise<void> {
  await db.query("update channels set status = $2, version = version + 1, pricing_version = pricing_version + 1, updated_at = $3 where id = $1", [channelId, status, now]);
}

/** 加价规则变了：渠道的定价版本加一（之前发起、还没批准的定价复核据此判断「发起后被别人改过」）。 */
export async function bumpChannelPricingVersion(db: Db, channelId: string, now: Date): Promise<void> {
  await db.query("update channels set version = version + 1, pricing_version = pricing_version + 1, updated_at = $2 where id = $1", [channelId, now]);
}

// ---- 加价规则 ----

export interface StoredMarkupRule extends MarkupRule {
  channelId: string;
  level: MarkupLevel;
  note: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

interface MarkupRuleRow {
  id: string;
  channel_id: string;
  level: MarkupLevel;
  supplier_tenant_id: string | null;
  city_id: string | null;
  category: ServiceCategory | null;
  vehicle_group_id: string | null;
  markup_bp: number;
  valid_from: string | null;
  valid_to: string | null;
  note: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

const RULE_COLUMNS = "id, channel_id, level, supplier_tenant_id, city_id, category, vehicle_group_id, markup_bp, valid_from::text, valid_to::text, note, version, created_at, updated_at";

function toRule(row: MarkupRuleRow): StoredMarkupRule {
  return {
    id: row.id,
    channelId: row.channel_id,
    level: row.level,
    tenantId: row.supplier_tenant_id,
    cityId: row.city_id,
    category: row.category,
    vehicleGroupId: row.vehicle_group_id,
    markupBp: row.markup_bp,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    note: row.note,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 渠道现行的加价规则（不含已删除的），按级别、维度、日期排好。 */
export async function listMarkupRules(db: Db, channelId: string): Promise<StoredMarkupRule[]> {
  const result = await db.query<MarkupRuleRow>(
    `select ${RULE_COLUMNS} from markup_rules where channel_id = $1 and deleted_at is null
      order by level, supplier_tenant_id nulls first, city_id nulls first, category nulls first, vehicle_group_id nulls first, valid_from nulls first, id`,
    [channelId],
  );
  return result.rows.map(toRule);
}

export async function findMarkupRule(db: Db, channelId: string, ruleId: string): Promise<StoredMarkupRule | null> {
  const result = await db.query<MarkupRuleRow>(`select ${RULE_COLUMNS} from markup_rules where channel_id = $1 and id = $2 and deleted_at is null`, [channelId, ruleId]);
  const row = result.rows[0];
  return row ? toRule(row) : null;
}

export interface MarkupRuleInput extends Omit<MarkupRule, "id"> {
  level: MarkupLevel;
  note: string | null;
}

export async function insertMarkupRule(db: Db, channelId: string, rule: MarkupRuleInput, now: Date): Promise<string> {
  const result = await db.query<{ id: string }>(
    `insert into markup_rules (channel_id, level, supplier_tenant_id, city_id, category, vehicle_group_id, markup_bp, valid_from, valid_to, note, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11) returning id`,
    [channelId, rule.level, rule.tenantId, rule.cityId, rule.category, rule.vehicleGroupId, rule.markupBp, rule.validFrom, rule.validTo, rule.note, now],
  );
  return (result.rows[0] as { id: string }).id;
}

export async function updateMarkupRule(db: Db, ruleId: string, rule: MarkupRuleInput, now: Date): Promise<void> {
  await db.query(
    `update markup_rules set level = $2, supplier_tenant_id = $3, city_id = $4, category = $5, vehicle_group_id = $6, markup_bp = $7, valid_from = $8, valid_to = $9, note = $10,
            version = version + 1, updated_at = $11 where id = $1`,
    [ruleId, rule.level, rule.tenantId, rule.cityId, rule.category, rule.vehicleGroupId, rule.markupBp, rule.validFrom, rule.validTo, rule.note, now],
  );
}

export async function deleteMarkupRule(db: Db, ruleId: string, now: Date): Promise<void> {
  await db.query("update markup_rules set deleted_at = $2, version = version + 1, updated_at = $2 where id = $1", [ruleId, now]);
}

// ---- 引用检查 ----

/** 这些租户里哪些不存在。 */
export async function missingTenants(db: Db, tenantIds: readonly string[]): Promise<string[]> {
  if (tenantIds.length === 0) return [];
  const result = await db.query<{ id: string }>("select id::text from unnest($1::uuid[]) as wanted (id) where not exists (select 1 from tenants t where t.id = wanted.id)", [tenantIds]);
  return result.rows.map((row) => row.id);
}

export async function missingCities(db: Db, cityIds: readonly string[]): Promise<string[]> {
  if (cityIds.length === 0) return [];
  const result = await db.query<{ id: string }>("select id::text from unnest($1::uuid[]) as wanted (id) where not exists (select 1 from cities c where c.id = wanted.id)", [cityIds]);
  return result.rows.map((row) => row.id);
}

export async function vehicleGroupExists(db: Db, vehicleGroupId: string): Promise<boolean> {
  const result = await db.query("select 1 from vehicle_groups where id = $1", [vehicleGroupId]);
  return (result.rowCount ?? 0) > 0;
}

/** 渠道详情、加价规则表里要显示的名字：租户、城市、车型组。 */
export async function referenceNames(db: Db, ids: { tenantIds: readonly string[]; cityIds: readonly string[]; vehicleGroupIds: readonly string[] }): Promise<{ tenants: Map<string, string>; cities: Map<string, string>; vehicleGroups: Map<string, string> }> {
  const pick = async (sql: string, list: readonly string[]): Promise<Map<string, string>> => {
    if (list.length === 0) return new Map();
    const result = await db.query<{ id: string; name: string }>(sql, [[...new Set(list)]]);
    return new Map(result.rows.map((row) => [row.id, row.name]));
  };
  return {
    tenants: await pick("select id::text, name from tenants where id = any($1::uuid[])", ids.tenantIds),
    cities: await pick("select id::text, coalesce(name->>'zh', name->>'en', code) as name from cities where id = any($1::uuid[])", ids.cityIds),
    vehicleGroups: await pick("select id::text, coalesce(name->>'zh', name->>'en', code) as name from vehicle_groups where id = any($1::uuid[])", ids.vehicleGroupIds),
  };
}
