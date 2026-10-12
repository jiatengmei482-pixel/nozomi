/**
 * /tenant/v1 的子品牌和商品接口（M1-03）。这里只做鉴权、校验字段的类型和长度、调用、返回；
 * 规则在 @nozomi/domain，流程在 services/products.ts。
 *
 * 租户编号只来自令牌（`principal.tenantId`）：这里没有任何地方从请求参数或请求体读 tenant_id，校验结构里也没有这个字段。
 * 规则 4：返回里没有对外价和加价比例。这里出现的金额（加急费、夜间费、附加服务单价）都是供应商自己设的结算侧金额。
 * 金额一律是子品牌币种的最小货币单位整数。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  MASTER_DATA_LANGUAGES,
  NIGHT_CHARGE_UNITS,
  PRODUCT_LIMITS,
  PRODUCT_STATUSES,
  type ProductContent,
  type ProductContentText,
  SERVICE_CATEGORIES,
  type ServiceRules,
  type TenantAction,
  contentTitles,
} from "@nozomi/domain";
import { bearerToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import { decodeTimeCursor } from "../pagination.ts";
import type { Brand } from "../repos/products.ts";
import {
  type ProductView,
  type PublishCheckView,
  type ServiceRulesView,
  createBrand,
  createProduct,
  deleteProduct,
  getProduct,
  getPublishCheck,
  getServiceRules,
  listBrands,
  listProducts,
  publishProduct,
  putContent,
  putServiceRules,
  unpublishProduct,
  updateBrand,
  updateProduct,
} from "../services/products.ts";
import { type TenantPrincipal, authenticateTenant } from "../services/tenant-auth.ts";
import { idempotencyKey, ifMatchVersion, pageQuerySchema, parseInput, resourceId, uuidSchema } from "../validation.ts";
import { visibleText } from "./master-data.ts";

type Json = Record<string, unknown>;

const id = uuidSchema.transform((value) => value.toLowerCase());

const brandSchema = z.object({ name: visibleText(PRODUCT_LIMITS.maxBrandNameLength), currency: z.string().min(1).max(10) });
const brandUpdateSchema = z.object({ name: visibleText(PRODUCT_LIMITS.maxBrandNameLength), currency: z.string().min(1).max(10).optional() });

// 条数这里只挡明显离谱的；业务上限由流程里的检查报出原因代码
const areasSchema = z.array(z.object({ area_id: id })).max(500);
const vehicleGroupsSchema = z.array(z.object({ vehicle_group_id: id, passengers: z.number().int().min(1).max(60), luggage: z.number().int().min(0).max(99) })).max(500);
const dispatchersSchema = z.array(z.object({ name: z.string().trim().max(200), phone: z.string().trim().max(50) })).max(100);

const productSchema = z.object({
  brand_id: id,
  city_id: id,
  category: z.enum(SERVICE_CATEGORIES),
  poi_id: id.nullable().default(null),
  areas: areasSchema.optional(),
  vehicle_groups: vehicleGroupsSchema.optional(),
  dispatchers: dispatchersSchema.optional(),
});

const productPatchSchema = z.object({
  brand_id: id.optional(),
  city_id: id.optional(),
  category: z.enum(SERVICE_CATEGORIES).optional(),
  poi_id: id.nullable().optional(),
  areas: areasSchema.optional(),
  vehicle_groups: vehicleGroupsSchema.optional(),
  dispatchers: dispatchersSchema.optional(),
});

const listQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().min(1).max(100).optional(),
  status: z.enum([...PRODUCT_STATUSES, "all"]).default("all"),
  category: z.enum(SERVICE_CATEGORIES).optional(),
  city_id: id.optional(),
  brand_id: id.optional(),
  area_id: id.optional(),
});

// 服务规则：这里只管类型；日期、时刻、范围、阶梯、免等的最低值等规则在 domain 里查，报出原因代码
const windowSchema = z.object({ start: z.string().max(5), end: z.string().max(5) });
const freeWaitSchema = z.discriminatedUnion("mode", [z.object({ mode: z.literal("unlimited") }), z.object({ mode: z.literal("limited"), minutes: z.number().finite() })]);
const amount = z.number().finite();

const serviceRulesSchema = z.object({
  booking: z
    .object({
      sale_from: z.string().max(10).nullable().default(null),
      sale_to: z.string().max(10).nullable().default(null),
      service_time: windowSchema.nullable().default(null),
      lead_time_hours: z.number().finite().nullable().default(null),
      note: z.string().trim().max(2000).nullable().default(null),
    })
    .default({}),
  urgent: z
    .object({
      enabled: z.boolean().default(false),
      daily_quota: z.number().finite().nullable().default(null),
      tiers: z.array(z.object({ within_hours: z.number().finite(), surcharge: amount })).max(100).default([]),
    })
    .default({}),
  night: z
    .object({
      enabled: z.boolean().default(false),
      window: windowSchema.nullable().default(null),
      amount: amount.nullable().default(null),
      charge_unit: z.enum(NIGHT_CHARGE_UNITS).nullable().default(null),
    })
    .default({}),
  free_wait: z
    .object({ pickup: freeWaitSchema.nullable().default(null), dropoff: freeWaitSchema.nullable().default(null), general: freeWaitSchema.nullable().default(null) })
    .default({}),
  addons: z.array(z.object({ addon_id: id, enabled: z.boolean().default(true), unit_price: amount, first_free: z.boolean().default(false) })).max(500).default([]),
  driver_languages: z.array(z.object({ language: z.string().max(10), unit_price: amount })).max(100).default([]),
});

function toServiceRules(input: z.output<typeof serviceRulesSchema>): ServiceRules {
  return {
    booking: {
      saleFrom: input.booking.sale_from,
      saleTo: input.booking.sale_to,
      serviceTime: input.booking.service_time,
      leadTimeHours: input.booking.lead_time_hours,
      note: input.booking.note === "" ? null : input.booking.note,
    },
    urgent: { enabled: input.urgent.enabled, dailyQuota: input.urgent.daily_quota, tiers: input.urgent.tiers.map((tier) => ({ withinHours: tier.within_hours, surchargeMinor: tier.surcharge })) },
    night: { enabled: input.night.enabled, window: input.night.window, amountMinor: input.night.amount, chargeUnit: input.night.charge_unit },
    freeWait: { pickup: input.free_wait.pickup, dropoff: input.free_wait.dropoff, general: input.free_wait.general },
    addons: input.addons.map((addon) => ({ addonId: addon.addon_id, enabled: addon.enabled, unitPriceMinor: addon.unit_price, firstFree: addon.first_free })),
    driverLanguages: input.driver_languages.map((entry) => ({ language: entry.language, unitPriceMinor: entry.unit_price })),
  };
}

function serviceRulesJson(view: ServiceRulesView): Json {
  const rules = view.product.serviceRules;
  return {
    version: view.product.version,
    currency: view.currency,
    free_wait_minimums: view.freeWaitMinimums,
    rules: {
      booking: {
        sale_from: rules.booking.saleFrom,
        sale_to: rules.booking.saleTo,
        service_time: rules.booking.serviceTime,
        lead_time_hours: rules.booking.leadTimeHours,
        note: rules.booking.note,
      },
      urgent: { enabled: rules.urgent.enabled, daily_quota: rules.urgent.dailyQuota, tiers: rules.urgent.tiers.map((tier) => ({ within_hours: tier.withinHours, surcharge: tier.surchargeMinor })) },
      night: { enabled: rules.night.enabled, window: rules.night.window, amount: rules.night.amountMinor, charge_unit: rules.night.chargeUnit },
      free_wait: { pickup: rules.freeWait.pickup, dropoff: rules.freeWait.dropoff, general: rules.freeWait.general },
      addons: rules.addons.map((addon) => ({ addon_id: addon.addonId, enabled: addon.enabled, unit_price: addon.unitPriceMinor, first_free: addon.firstFree })),
      driver_languages: rules.driverLanguages.map((entry) => ({ language: entry.language, unit_price: entry.unitPriceMinor })),
    },
  };
}

// 商品详情：空串当作没填；长度、条数、不能只有空白由 domain 查
const optionalText = z
  .string()
  .max(10_000)
  .nullable()
  .default(null)
  .transform((value) => (value === null || value.trim() === "" ? null : value.trim()));
const textList = z
  .array(z.string().max(10_000))
  .max(200)
  .default([])
  .transform((items) => items.map((item) => item.trim()));
const contentTextSchema = z.object({ title: optionalText, summary: optionalText, includes: textList, excludes: textList, itinerary: optionalText, pickup_guide: optionalText });
const contentSchema = z.object({ ja: contentTextSchema.optional(), zh: contentTextSchema.optional(), en: contentTextSchema.optional(), ko: contentTextSchema.optional() }).strict(`只支持这些语言：${MASTER_DATA_LANGUAGES.join("、")}`);

function toContent(input: z.output<typeof contentSchema>): ProductContent {
  const content: ProductContent = {};
  for (const language of MASTER_DATA_LANGUAGES) {
    const text = input[language];
    if (text) content[language] = { title: text.title, summary: text.summary, includes: text.includes, excludes: text.excludes, itinerary: text.itinerary, pickupGuide: text.pickup_guide };
  }
  return content;
}

function contentJson(content: ProductContent): Json {
  const json: Json = {};
  for (const language of MASTER_DATA_LANGUAGES) {
    const text: ProductContentText | undefined = content[language];
    if (text) json[language] = { title: text.title, summary: text.summary, includes: text.includes, excludes: text.excludes, itinerary: text.itinerary, pickup_guide: text.pickupGuide };
  }
  return json;
}

export function brandJson(brand: Brand): Json {
  return { id: brand.id, name: brand.name, currency: brand.currency, status: brand.status, version: brand.version, created_at: brand.createdAt.toISOString(), updated_at: brand.updatedAt.toISOString() };
}

/** 商品的应答。列表项没有 `areas`、`vehicle_groups`、`dispatchers`（只带个数），多一个上架校验的概况 `check`；详情相反。 */
export function productJson(view: ProductView): Json {
  const { product, brand, city, poi } = view;
  return {
    id: product.id,
    code: product.code,
    status: product.status,
    category: product.category,
    title: contentTitles(product.content),
    brand_id: product.brandId,
    brand: brand === null ? null : { id: brand.id, name: brand.name, currency: brand.currency, status: brand.status },
    city_id: product.cityId,
    city: city === null ? null : { id: city.id, code: city.code, name: city.name, country_code: city.countryCode, timezone: city.timezone, status: city.status },
    poi_id: product.poiId,
    poi: poi === null ? null : { id: poi.id, code: poi.code, name: poi.name, type: poi.type, flight_scope: poi.flightScope, status: poi.status },
    area_count: view.areaCount,
    vehicle_group_count: view.vehicleGroupCount,
    version: product.version,
    published_at: product.publishedAt?.toISOString() ?? null,
    created_at: product.createdAt.toISOString(),
    updated_at: product.updatedAt.toISOString(),
    ...(view.check === null ? {} : { check: { can_publish: view.check.canPublish, failed_required: view.check.failedRequired, unavailable_required: view.check.unavailableRequired } }),
    ...(view.areas === null
      ? {}
      : {
          areas: view.areas.map((area) => ({ area_id: area.areaId, priority: area.priority, name: area.name, biz_type: area.bizType, status: area.status })),
          vehicle_groups: (view.vehicleGroups ?? []).map((group) => ({
            vehicle_group_id: group.vehicleGroupId,
            passengers: group.passengers,
            luggage: group.luggage,
            code: group.code,
            name: group.name,
            grade: group.grade,
            seats: group.seats,
            sample_models: group.sampleModels,
            combos: group.combos,
            status: group.status,
          })),
          dispatchers: (view.dispatchers ?? []).map((dispatcher) => ({ name: dispatcher.name, phone: dispatcher.phone })),
        }),
  };
}

function publishCheckJson(view: PublishCheckView): Json {
  return { can_publish: view.canPublish, items: view.items.map((item) => ({ key: item.key, required: item.required, passed: item.passed, issues: item.issues })) };
}

export function registerProductRoutes(app: FastifyInstance, ctx: AppContext): void {
  const authenticate = (request: FastifyRequest, action: TenantAction): Promise<TenantPrincipal> =>
    authenticateTenant(ctx, bearerToken(request.headers.authorization), { action });

  app.get("/tenant/v1/brands", async (request) => {
    const principal = await authenticate(request, "product.read");
    return { items: (await listBrands(ctx, principal.tenantId)).map(brandJson) };
  });

  app.post("/tenant/v1/brands", async (request, reply) => {
    const principal = await authenticate(request, "brand.manage");
    const key = idempotencyKey(request.headers["idempotency-key"]);
    const input = parseInput(brandSchema, request.body, "body");
    const result = await createBrand(ctx, { principal, ip: request.ip }, input, { scope: "POST /tenant/v1/brands", key }, brandJson);
    return reply.code(result.status).send(result.body);
  });

  app.put("/tenant/v1/brands/:id", async (request) => {
    const principal = await authenticate(request, "brand.manage");
    const brandId = resourceId(request.params, "子品牌");
    const version = ifMatchVersion(request.headers["if-match"]);
    const input = parseInput(brandUpdateSchema, request.body, "body");
    return brandJson(await updateBrand(ctx, { principal, ip: request.ip }, brandId, version, { name: input.name, currency: input.currency ?? null }));
  });

  app.get("/tenant/v1/products", async (request) => {
    const principal = await authenticate(request, "product.read");
    const query = parseInput(listQuerySchema, request.query, "querystring");
    const page = await listProducts(
      ctx,
      principal.tenantId,
      { search: query.q, status: query.status === "all" ? undefined : query.status, category: query.category, cityId: query.city_id, brandId: query.brand_id, areaId: query.area_id },
      query.limit,
      decodeTimeCursor(query.cursor ?? null),
    );
    return { items: page.items.map(productJson), next_cursor: page.nextCursor, total: page.total };
  });

  app.post("/tenant/v1/products", async (request, reply) => {
    const principal = await authenticate(request, "product.manage");
    const key = idempotencyKey(request.headers["idempotency-key"]);
    const input = parseInput(productSchema, request.body, "body");
    const result = await createProduct(
      ctx,
      { principal, ip: request.ip },
      {
        brandId: input.brand_id,
        cityId: input.city_id,
        category: input.category,
        poiId: input.poi_id,
        areaIds: input.areas?.map((area) => area.area_id),
        vehicleGroups: input.vehicle_groups?.map((group) => ({ vehicleGroupId: group.vehicle_group_id, passengers: group.passengers, luggage: group.luggage })),
        dispatchers: input.dispatchers,
      },
      { scope: "POST /tenant/v1/products", key },
      productJson,
    );
    return reply.code(result.status).send(result.body);
  });

  app.get("/tenant/v1/products/:id", async (request) => {
    const principal = await authenticate(request, "product.read");
    return productJson(await getProduct(ctx, principal.tenantId, resourceId(request.params, "商品")));
  });

  app.patch("/tenant/v1/products/:id", async (request) => {
    const principal = await authenticate(request, "product.manage");
    const productId = resourceId(request.params, "商品");
    const version = ifMatchVersion(request.headers["if-match"]);
    const input = parseInput(productPatchSchema, request.body, "body");
    const updated = await updateProduct(ctx, { principal, ip: request.ip }, productId, version, {
      brandId: input.brand_id,
      cityId: input.city_id,
      category: input.category,
      poiId: input.poi_id,
      areaIds: input.areas?.map((area) => area.area_id),
      vehicleGroups: input.vehicle_groups?.map((group) => ({ vehicleGroupId: group.vehicle_group_id, passengers: group.passengers, luggage: group.luggage })),
      dispatchers: input.dispatchers,
    });
    return productJson(updated);
  });

  app.delete("/tenant/v1/products/:id", async (request, reply) => {
    const principal = await authenticate(request, "product.manage");
    await deleteProduct(ctx, { principal, ip: request.ip }, resourceId(request.params, "商品"));
    return reply.code(204).send();
  });

  app.get("/tenant/v1/products/:id/service-rules", async (request) => {
    const principal = await authenticate(request, "product.read");
    return serviceRulesJson(await getServiceRules(ctx, principal.tenantId, resourceId(request.params, "商品")));
  });

  app.put("/tenant/v1/products/:id/service-rules", async (request) => {
    const principal = await authenticate(request, "product.manage");
    const productId = resourceId(request.params, "商品");
    const version = ifMatchVersion(request.headers["if-match"]);
    const input = parseInput(serviceRulesSchema, request.body, "body");
    return serviceRulesJson(await putServiceRules(ctx, { principal, ip: request.ip }, productId, version, toServiceRules(input)));
  });

  app.get("/tenant/v1/products/:id/content", async (request) => {
    const principal = await authenticate(request, "product.read");
    const view = await getProduct(ctx, principal.tenantId, resourceId(request.params, "商品"));
    return { version: view.product.version, content: contentJson(view.product.content) };
  });

  app.put("/tenant/v1/products/:id/content", async (request) => {
    const principal = await authenticate(request, "product.manage");
    const productId = resourceId(request.params, "商品");
    const version = ifMatchVersion(request.headers["if-match"]);
    const input = parseInput(contentSchema, request.body, "body");
    const updated = await putContent(ctx, { principal, ip: request.ip }, productId, version, toContent(input));
    return { version: updated.version, content: contentJson(updated.content) };
  });

  app.get("/tenant/v1/products/:id/publish-check", async (request) => {
    const principal = await authenticate(request, "product.read");
    return publishCheckJson(await getPublishCheck(ctx, principal.tenantId, resourceId(request.params, "商品")));
  });

  app.post("/tenant/v1/products/:id/publish", async (request) => {
    const principal = await authenticate(request, "product.manage");
    return productJson(await publishProduct(ctx, { principal, ip: request.ip }, resourceId(request.params, "商品")));
  });

  app.post("/tenant/v1/products/:id/unpublish", async (request) => {
    const principal = await authenticate(request, "product.manage");
    return productJson(await unpublishProduct(ctx, { principal, ip: request.ip }, resourceId(request.params, "商品")));
  });
}
