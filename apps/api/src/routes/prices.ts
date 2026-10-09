/**
 * 价格规则、调价规则、价格日历、缺价组合、价格概况、子品牌取整单位、节假日日历的接口（M1-04）。
 * 这里只做鉴权、校验字段的类型、调用、返回；规则和计算在 @nozomi/domain 的 pricing.ts，流程在 services/prices.ts。
 *
 * 租户编号只来自令牌（`principal.tenantId`）：这里没有任何地方从请求参数或请求体读 tenant_id，校验结构里也没有这个字段。
 * 规则 4：返回里没有对外价和加价比例——这里的每一个金额都是供应商自己设的结算价，或由它们算出来的结算价。
 * 金额一律是子品牌币种的最小货币单位整数，百分比是基点整数（1% = 100）。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  type AdjustRule,
  PRICE_DIRECTIONS,
  PRICE_RULE_STATUSES,
  PRICING_MODELS,
  type PlatformAction,
  type PriceRule,
  type Pricing,
  TRIP_DIRECTIONS,
  type TenantAction,
  adjustRuleHasEnded,
  basePrice,
  formatExact,
  weekdayOf,
} from "@nozomi/domain";
import { bearerToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import type { Holiday, StoredAdjustRule, StoredPriceRule } from "../repos/prices.ts";
import { notFound } from "../services/errors.ts";
import { authenticatePlatform } from "../services/platform-auth.ts";
import {
  type AdjustRulesView,
  type AdjustSaveResult,
  type CalendarView,
  type PriceChanges,
  type PriceRulesView,
  type PriceSaveResult,
  createAdjustRule,
  deleteAdjustRule,
  getAdjustRules,
  getPriceCalendar,
  getPriceCoverage,
  getPriceOverview,
  getPriceRules,
  listHolidays,
  putHoliday,
  removeHoliday,
  reorderAdjustRules,
  savePriceRules,
  setAdjustRuleStatus,
  setRoundingUnit,
  updateAdjustRule,
} from "../services/prices.ts";
import { type TenantPrincipal, authenticateTenant } from "../services/tenant-auth.ts";
import { isUuid } from "../pagination.ts";
import { type InputIssue, idempotencyKey, ifMatchVersion, parseInput, resourceId, uuidSchema, validationFailed } from "../validation.ts";
import { localized } from "./master-data.ts";

type Json = Record<string, unknown>;

const id = uuidSchema.transform((value) => value.toLowerCase());
const amount = z.number().finite().nullable().default(null);
const date = z.string().max(10);

/** 每种计价方式用哪几个数：接口里的字段名 → domain 里的字段名。 */
const MODEL_FIELDS = {
  fixed: { base_price: "basePriceMinor" },
  mileage_time: { start_price: "startPriceMinor", start_meters: "startMeters", start_minutes: "startMinutes", per_km: "perKmMinor", per_minute: "perMinuteMinor", min_price: "minPriceMinor" },
  charter_package: { package_km: "packageKm", package_price: "packagePriceMinor", overtime_per_hour: "overtimePerHourMinor", over_km_per_km: "overKmPerKmMinor" },
} as const;
const PRICE_FIELDS = [...new Set(Object.values(MODEL_FIELDS).flatMap((fields) => Object.keys(fields)))];
/** 可以不填（null）的数：最低消费 */
const OPTIONAL_FIELDS = ["min_price"];

// 这里只管类型；范围、整数、日期、品类和计价方式对不对由 domain 查，报出原因代码
const priceRuleSchema = z.object({
  area_id: id,
  vehicle_group_id: id,
  direction: z.enum(PRICE_DIRECTIONS).nullable().default(null),
  package_hours: z.number().finite().nullable().default(null),
  pricing_model: z.enum(PRICING_MODELS),
  base_price: amount,
  start_price: amount,
  start_meters: amount,
  start_minutes: amount,
  per_km: amount,
  per_minute: amount,
  min_price: amount,
  package_km: amount,
  package_price: amount,
  overtime_per_hour: amount,
  over_km_per_km: amount,
  valid_from: date,
  valid_to: date.nullable().default(null),
  status: z.enum(PRICE_RULE_STATUSES).default("enabled"),
});
type PriceRuleBody = z.output<typeof priceRuleSchema>;

const batchSchema = z.object({
  create: z.array(priceRuleSchema.extend({ ref: z.string().min(1).max(100).nullable().default(null) })).max(2_000).default([]),
  update: z.array(priceRuleSchema.extend({ id })).max(2_000).default([]),
  delete: z.array(id).max(2_000).default([]),
});

/** 请求里的一条价格 → domain 的样子。这种计价方式要的数没给、不该给的数给了，记到 `issues` 里。 */
function toPriceRule(body: PriceRuleBody, at: string, issues: InputIssue[]): PriceRule {
  const values = body as unknown as Record<string, number | null>;
  const wanted: Record<string, string> = MODEL_FIELDS[body.pricing_model];
  const pricing: Record<string, unknown> = { model: body.pricing_model };
  for (const field of PRICE_FIELDS) {
    const value = values[field] ?? null;
    const target = wanted[field];
    if (target === undefined) {
      if (value !== null) issues.push({ path: `${at}/${field}`, reason: "NOT_APPLICABLE", message: "这种计价方式不填这一项" });
    } else if (value === null && !OPTIONAL_FIELDS.includes(field)) {
      issues.push({ path: `${at}/${field}`, reason: "REQUIRED", message: "必填" });
      pricing[target] = 0;
    } else pricing[target] = value;
  }
  return {
    areaId: body.area_id,
    vehicleGroupId: body.vehicle_group_id,
    direction: body.direction,
    packageHours: body.package_hours,
    pricing: pricing as unknown as Pricing,
    validFrom: body.valid_from,
    validTo: body.valid_to,
    status: body.status,
  };
}

function priceRuleJson(rule: StoredPriceRule): Json {
  const fields: Record<string, string> = MODEL_FIELDS[rule.pricing.model];
  const pricing = rule.pricing as unknown as Record<string, number | null>;
  return {
    id: rule.id,
    area_id: rule.areaId,
    vehicle_group_id: rule.vehicleGroupId,
    direction: rule.direction,
    package_hours: rule.packageHours,
    pricing_model: rule.pricing.model,
    ...Object.fromEntries(PRICE_FIELDS.map((field) => [field, fields[field] === undefined ? null : (pricing[fields[field] as string] ?? null)])),
    // 这条价格能报出的最低数（一口价的基础价、里程 + 时长的起步价或最低消费、包车的套餐价）：试算和日历的基数
    base: formatExact(basePrice(rule.pricing, {}, rule.packageHours)),
    valid_from: rule.validFrom,
    valid_to: rule.validTo,
    status: rule.status,
    created_at: rule.createdAt.toISOString(),
    updated_at: rule.updatedAt.toISOString(),
  };
}

function coverageJson(view: { coverage: PriceRulesView["coverage"]; items: StoredPriceRule[] }): Json {
  const { coverage } = view;
  return {
    total: coverage.total,
    priced: coverage.priced,
    missing: coverage.total - coverage.priced,
    packages: coverage.packages,
    combos: coverage.combos.map((combo) => ({
      area_id: combo.areaId,
      vehicle_group_id: combo.vehicleGroupId,
      direction: combo.direction,
      package_hours: combo.packageHours,
      state: combo.state,
      price_rule_id: combo.ruleIndex === null ? null : (view.items[combo.ruleIndex]?.id ?? null),
      via_both: combo.viaBoth,
      from: combo.from,
    })),
  };
}

export function priceRulesJson(view: PriceRulesView): Json {
  const { coverage } = view;
  return {
    version: view.version,
    currency: view.currency,
    rounding_unit: view.roundingUnit,
    available_models: view.availableModels,
    today: view.today,
    items: view.items.map(priceRuleJson),
    coverage: { total: coverage.total, priced: coverage.priced, missing: coverage.total - coverage.priced },
  };
}

const windowSchema = z.object({ start: z.string().max(5), end: z.string().max(5) });
const cycleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("daily") }),
  z.object({ type: z.literal("weekly"), weekdays: z.array(z.number().finite()).max(100) }),
  z.object({ type: z.literal("dates"), dates: z.array(date).max(5_000) }),
  z.object({ type: z.literal("holidays"), countries: z.array(z.string().max(10)).max(500) }),
]);
const adjustRuleSchema = z.object({
  name: z.string().trim().max(500),
  travel_from: date.nullable().default(null),
  travel_to: date.nullable().default(null),
  cycle: cycleSchema,
  time_slot: windowSchema.nullable().default(null),
  area_ids: z.array(id).max(1_000).default([]),
  vehicle_group_ids: z.array(id).max(1_000).default([]),
  directions: z.array(z.enum(TRIP_DIRECTIONS)).max(10).default([]),
  package_hours: z.array(z.number().finite()).max(500).default([]),
  steps: z.array(z.object({ type: z.enum(["percent", "amount"]), value: z.number().finite() })).max(500),
  status: z.enum(PRICE_RULE_STATUSES).default("enabled"),
});

function toAdjustRule(body: z.output<typeof adjustRuleSchema>): AdjustRule {
  return {
    name: body.name,
    travelFrom: body.travel_from,
    travelTo: body.travel_to,
    cycle: body.cycle,
    timeSlot: body.time_slot,
    areaIds: body.area_ids,
    vehicleGroupIds: body.vehicle_group_ids,
    directions: body.directions,
    packageHours: body.package_hours,
    steps: body.steps,
    status: body.status,
  };
}

function adjustRuleJson(rule: StoredAdjustRule, today: string): Json {
  return {
    id: rule.id,
    name: rule.name,
    travel_from: rule.travelFrom,
    travel_to: rule.travelTo,
    cycle: rule.cycle,
    time_slot: rule.timeSlot,
    area_ids: rule.areaIds,
    vehicle_group_ids: rule.vehicleGroupIds,
    directions: rule.directions,
    package_hours: rule.packageHours,
    steps: rule.steps,
    status: rule.status,
    // 出行日期已经过去，以后不会再生效
    ended: adjustRuleHasEnded(rule, today),
    created_at: rule.createdAt.toISOString(),
    updated_at: rule.updatedAt.toISOString(),
  };
}

function adjustRulesJson(view: AdjustRulesView): Json {
  return { version: view.version, currency: view.currency, rounding_unit: view.roundingUnit, today: view.today, items: view.items.map((rule) => adjustRuleJson(rule, view.today)) };
}

const calendarQuerySchema = z.object({
  area_id: id,
  // 一个或几个车型组（逗号分隔，最多 20 个）：对比表一次取一行里的全部
  vehicle_group_id: z
    .string()
    .max(1_000)
    .transform((value) => [...new Set(value.split(",").map((entry) => entry.toLowerCase()))])
    .pipe(z.array(uuidSchema).min(1).max(20)),
  direction: z.enum(TRIP_DIRECTIONS).optional(),
  package_hours: z.string().regex(/^\d{1,3}$/, "必须是十进制整数").transform(Number).optional(),
  from: date,
  to: date,
});

const clock = (minute: number): string => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

function calendarDaysJson(days: CalendarView["groups"][number]["days"]): Json[] {
  return days.map((day) => {
    const rule = day.segments[0]?.priceRule ?? null;
    return {
      date: day.date,
      weekday: weekdayOf(day.date),
      holiday: day.holiday === null ? null : { name: day.holiday },
      price_rule: rule === null ? null : { id: rule.id, pricing_model: rule.pricing.model, direction: rule.direction, valid_from: rule.validFrom, valid_to: rule.validTo },
      segments: day.segments.map((segment) => ({
        from: clock(segment.fromMinute),
        to: clock(segment.toMinute),
        // 取整后的结算价；没有价格、或调完不大于 0 时为 null，原因在 no_price_reason
        final: segment.price?.finalMinor ?? null,
        no_price_reason: segment.noPriceReason,
        base: segment.price === null ? null : formatExact(segment.price.base),
        unrounded: segment.price === null ? null : formatExact(segment.price.unrounded),
        adjusts: (segment.price?.adjusts ?? []).map((entry) => ({
          rule_id: entry.rule.id,
          name: entry.rule.name,
          steps: entry.steps.map((step) => ({ type: step.step.type, value: step.step.value, delta: formatExact(step.delta), after: formatExact(step.after) })),
        })),
      })),
    };
  });
}

function calendarJson(view: CalendarView): Json {
  return {
    version: view.version,
    currency: view.currency,
    rounding_unit: view.roundingUnit,
    today: view.today,
    // 第一个车型组的日历（只给了一个车型组时就是它）
    days: calendarDaysJson(view.groups[0]?.days ?? []),
    // 每个车型组各一份，顺序和请求里的一样
    groups: view.groups.map((group) => ({ vehicle_group_id: group.vehicleGroupId, days: calendarDaysJson(group.days) })),
  };
}

const holidayQuerySchema = z.object({
  country_code: z.string().max(200).optional(),
  from: date,
  to: date,
});

function holidayJson(holiday: Holiday): Json {
  return { country_code: holiday.countryCode, date: holiday.date, name: holiday.name, updated_at: holiday.updatedAt.toISOString() };
}

/** 路径里的第二个编号（价格规则、调价规则）：写得不像编号就当作不存在。 */
function ruleIdParam(params: unknown, what: string): string {
  const value = typeof params === "object" && params !== null ? (params as { ruleId?: unknown }).ruleId : undefined;
  if (typeof value !== "string" || !isUuid(value)) throw notFound(what);
  return value.toLowerCase();
}

export function registerPriceRoutes(app: FastifyInstance, ctx: AppContext): void {
  const authenticate = (request: FastifyRequest, action: TenantAction): Promise<TenantPrincipal> => authenticateTenant(ctx, bearerToken(request.headers.authorization), { action });
  const platform = (request: FastifyRequest, action: PlatformAction) => authenticatePlatform(ctx, bearerToken(request.headers.authorization), { action });
  const single = (version: number, rule: StoredPriceRule | undefined): Json => ({ version, price_rule: rule === undefined ? null : priceRuleJson(rule) });

  // ---- 价格规则 ----

  app.get("/tenant/v1/products/:id/price-rules", async (request) => {
    const principal = await authenticate(request, "product.read");
    return priceRulesJson(await getPriceRules(ctx, principal.tenantId, resourceId(request.params, "商品")));
  });

  app.post("/tenant/v1/products/:id/price-rules", async (request, reply) => {
    const principal = await authenticate(request, "product.manage");
    const productId = resourceId(request.params, "商品");
    const key = idempotencyKey(request.headers["idempotency-key"]);
    const version = ifMatchVersion(request.headers["if-match"]);
    const issues: InputIssue[] = [];
    const rule = toPriceRule(parseInput(priceRuleSchema, request.body, "body"), "", issues);
    if (issues.length > 0) throw validationFailed("body", issues);
    const result = await savePriceRules(ctx, { principal, ip: request.ip }, productId, version, { create: [{ ref: null, rule }], update: [], remove: [] }, {
      single: true,
      idempotency: { scope: "POST /tenant/v1/products/:id/price-rules", key },
      respond: (saved: PriceSaveResult) => ({ status: 201, body: single(saved.view.version, saved.created[0]) }),
    });
    return reply.code(result.status).send(result.body);
  });

  app.post("/tenant/v1/products/:id/price-rules/batch", async (request, reply) => {
    const principal = await authenticate(request, "product.manage");
    const productId = resourceId(request.params, "商品");
    const key = idempotencyKey(request.headers["idempotency-key"]);
    const version = ifMatchVersion(request.headers["if-match"]);
    const input = parseInput(batchSchema, request.body, "body");
    const issues: InputIssue[] = [];
    const changes: PriceChanges = {
      create: input.create.map((entry, index) => ({ ref: entry.ref, rule: toPriceRule(entry, `/create/${index}`, issues) })),
      update: input.update.map((entry, index) => ({ id: entry.id, rule: toPriceRule(entry, `/update/${index}`, issues) })),
      remove: input.delete,
    };
    if (issues.length > 0) throw validationFailed("body", issues);
    const result = await savePriceRules(ctx, { principal, ip: request.ip }, productId, version, changes, {
      single: false,
      idempotency: { scope: "POST /tenant/v1/products/:id/price-rules/batch", key },
      respond: (saved) => ({ status: 200, body: { ...priceRulesJson(saved.view), created_ids: saved.created.map((rule) => rule.id) } }),
    });
    return reply.code(result.status).send(result.body);
  });

  app.put("/tenant/v1/products/:id/price-rules/:ruleId", async (request) => {
    const principal = await authenticate(request, "product.manage");
    const productId = resourceId(request.params, "商品");
    const ruleId = ruleIdParam(request.params, "价格规则");
    const version = ifMatchVersion(request.headers["if-match"]);
    const issues: InputIssue[] = [];
    const rule = toPriceRule(parseInput(priceRuleSchema, request.body, "body"), "", issues);
    if (issues.length > 0) throw validationFailed("body", issues);
    const result = await savePriceRules(ctx, { principal, ip: request.ip }, productId, version, { create: [], update: [{ id: ruleId, rule }], remove: [] }, {
      single: true,
      idempotency: null,
      respond: (saved) => ({ status: 200, body: single(saved.view.version, saved.view.items.find((item) => item.id === ruleId)) }),
    });
    return result.body;
  });

  app.delete("/tenant/v1/products/:id/price-rules/:ruleId", async (request) => {
    const principal = await authenticate(request, "product.manage");
    const productId = resourceId(request.params, "商品");
    const ruleId = ruleIdParam(request.params, "价格规则");
    const version = ifMatchVersion(request.headers["if-match"]);
    const result = await savePriceRules(ctx, { principal, ip: request.ip }, productId, version, { create: [], update: [], remove: [ruleId] }, {
      single: true,
      idempotency: null,
      respond: (saved) => ({ status: 200, body: { version: saved.view.version } }),
    });
    return result.body;
  });

  app.get("/tenant/v1/products/:id/price-coverage", async (request) => {
    const principal = await authenticate(request, "product.read");
    const view = await getPriceCoverage(ctx, principal.tenantId, resourceId(request.params, "商品"));
    return { today: view.today, ...coverageJson({ coverage: view.coverage, items: view.rules }) };
  });

  app.get("/tenant/v1/products/:id/price-calendar", async (request) => {
    const principal = await authenticate(request, "product.read");
    const productId = resourceId(request.params, "商品");
    const query = parseInput(calendarQuerySchema, request.query, "querystring");
    return calendarJson(
      await getPriceCalendar(ctx, principal.tenantId, productId, {
        areaId: query.area_id,
        vehicleGroupIds: query.vehicle_group_id,
        direction: query.direction ?? null,
        packageHours: query.package_hours ?? null,
        from: query.from,
        to: query.to,
      }),
    );
  });

  app.get("/tenant/v1/price-overview", async (request) => {
    const principal = await authenticate(request, "product.read");
    const query = parseInput(z.object({ summary: z.enum(["1", "true"]).optional() }), request.query, "querystring");
    const overview = await getPriceOverview(ctx, principal.tenantId, query.summary !== undefined);
    const totals = { products_with_price: overview.productsWithPrice, products_without_price: overview.productsWithoutPrice, published_without_inventory: overview.publishedWithoutInventory };
    // `summary=1`：只要两个数（首页的卡片），不带每个商品的明细
    if (overview.items === null) return totals;
    return {
      ...totals,
      items: overview.items.map((item) => ({
        product_id: item.productId,
        code: item.code,
        status: item.status,
        category: item.category,
        title: item.title,
        city: item.city,
        coverage: item.coverage,
        inventory_mode: item.inventoryMode,
        no_inventory_ahead: item.noInventoryAhead,
        price_rule_count: item.priceRuleCount,
        has_active_price: item.activePriceRuleCount > 0,
        active_price_rule_count: item.activePriceRuleCount,
        enabled_adjust_rule_count: item.enabledAdjustRuleCount,
      })),
    };
  });

  // ---- 调价规则 ----

  const adjustSaved = (result: AdjustSaveResult): Json => ({ version: result.version, adjust_rule: result.rule === null ? null : adjustRuleJson(result.rule, result.today) });

  app.get("/tenant/v1/products/:id/adjust-rules", async (request) => {
    const principal = await authenticate(request, "product.read");
    return adjustRulesJson(await getAdjustRules(ctx, principal.tenantId, resourceId(request.params, "商品")));
  });

  app.post("/tenant/v1/products/:id/adjust-rules", async (request, reply) => {
    const principal = await authenticate(request, "product.manage");
    const productId = resourceId(request.params, "商品");
    const key = idempotencyKey(request.headers["idempotency-key"]);
    const version = ifMatchVersion(request.headers["if-match"]);
    const rule = toAdjustRule(parseInput(adjustRuleSchema, request.body, "body"));
    const result = await createAdjustRule(ctx, { principal, ip: request.ip }, productId, version, rule, { scope: "POST /tenant/v1/products/:id/adjust-rules", key }, (saved) => ({ status: 201, body: adjustSaved(saved) }));
    return reply.code(result.status).send(result.body);
  });

  app.put("/tenant/v1/products/:id/adjust-rules/order", async (request) => {
    const principal = await authenticate(request, "product.manage");
    const productId = resourceId(request.params, "商品");
    const version = ifMatchVersion(request.headers["if-match"]);
    const input = parseInput(z.object({ ids: z.array(id).max(1_000) }), request.body, "body");
    return adjustRulesJson(await reorderAdjustRules(ctx, { principal, ip: request.ip }, productId, version, input.ids));
  });

  app.put("/tenant/v1/products/:id/adjust-rules/:ruleId", async (request) => {
    const principal = await authenticate(request, "product.manage");
    const productId = resourceId(request.params, "商品");
    const ruleId = ruleIdParam(request.params, "调价规则");
    const version = ifMatchVersion(request.headers["if-match"]);
    const rule = toAdjustRule(parseInput(adjustRuleSchema, request.body, "body"));
    return adjustSaved(await updateAdjustRule(ctx, { principal, ip: request.ip }, productId, ruleId, version, rule));
  });

  app.delete("/tenant/v1/products/:id/adjust-rules/:ruleId", async (request) => {
    const principal = await authenticate(request, "product.manage");
    const productId = resourceId(request.params, "商品");
    const ruleId = ruleIdParam(request.params, "调价规则");
    const version = ifMatchVersion(request.headers["if-match"]);
    return { version: (await deleteAdjustRule(ctx, { principal, ip: request.ip }, productId, ruleId, version)).version };
  });

  for (const [action, status] of [["enable", "enabled"], ["disable", "disabled"]] as const) {
    app.post(`/tenant/v1/products/:id/adjust-rules/:ruleId/${action}`, async (request) => {
      const principal = await authenticate(request, "product.manage");
      const productId = resourceId(request.params, "商品");
      const ruleId = ruleIdParam(request.params, "调价规则");
      return adjustSaved(await setAdjustRuleStatus(ctx, { principal, ip: request.ip }, productId, ruleId, status));
    });
  }

  // ---- 子品牌的取整单位 ----

  app.put("/tenant/v1/brands/:id/rounding-unit", async (request) => {
    const principal = await authenticate(request, "brand.manage");
    const brandId = resourceId(request.params, "子品牌");
    const version = ifMatchVersion(request.headers["if-match"]);
    const input = parseInput(z.object({ rounding_unit: z.number().int() }), request.body, "body");
    const saved = await setRoundingUnit(ctx, { principal, ip: request.ip }, brandId, version, input.rounding_unit);
    return { id: saved.id, rounding_unit: saved.roundingUnit, version: saved.version };
  });

  // ---- 节假日日历 ----

  const holidays = async (request: FastifyRequest, reader: { kind: "platform" } | { kind: "tenant"; tenantId: string }): Promise<Json> => {
    const query = parseInput(holidayQuerySchema, request.query, "querystring");
    const result = await listHolidays(ctx, reader, { countryCodes: query.country_code === undefined ? null : [...new Set(query.country_code.split(","))], from: query.from, to: query.to });
    return { items: result.items.map(holidayJson), countries: result.countries.map((country) => ({ country_code: country.countryCode, count: country.count, last_date: country.lastDate })) };
  };

  app.get("/tenant/v1/holidays", async (request) => {
    const principal = await authenticate(request, "master_data.read");
    return holidays(request, { kind: "tenant", tenantId: principal.tenantId });
  });

  app.get("/platform/v1/holidays", async (request) => {
    await platform(request, "master_data.read");
    return holidays(request, { kind: "platform" });
  });

  const holidayKey = (params: unknown): { country: string; date: string } => {
    const { country, date: day } = (params ?? {}) as { country?: unknown; date?: unknown };
    if (typeof country !== "string" || typeof day !== "string") throw notFound("节假日");
    return { country, date: day };
  };

  app.put("/platform/v1/holidays/:country/:date", async (request, reply) => {
    const principal = await platform(request, "master_data.manage");
    const key = holidayKey(request.params);
    const input = parseInput(z.object({ name: localized(100) }), request.body, "body");
    const saved = await putHoliday(ctx, { principal, ip: request.ip }, key.country, key.date, input.name);
    return reply.code(saved.created ? 201 : 200).send(holidayJson(saved.holiday));
  });

  app.delete("/platform/v1/holidays/:country/:date", async (request, reply) => {
    const principal = await platform(request, "master_data.manage");
    const key = holidayKey(request.params);
    await removeHoliday(ctx, { principal, ip: request.ip }, key.country, key.date);
    return reply.code(204).send();
  });
}
