/**
 * `/site/v1`：官网（自营渠道）的公开接口（M3-05，ADR 0032）。浏览器直接调，不需要登录、也不持有任何渠道密钥。
 * 这里只做限速、校验、调用、返回；渠道身份在服务端（`SITE_CLIENT_ID`），业务流程和 `/sales/v1` 是同一批 service。
 *
 * 接新单（官网暂未开放时 503 `SITE_NOT_OPEN`）：
 * - `GET /site/v1/config`：开没开、币种、Stripe 的 publishable key（只有它）、客服电话（登记了才有，官网没开也给）；
 * - `GET /site/v1/cities`：能预订的城市和各自能订的品类（接送机、点对点、包车）；
 * - `GET /site/v1/cities/{id}/airports`：能预订接送机的机场；`GET …/charter-packages`：能选的包车套餐时长（M3-10）；
 * - `GET /site/v1/cities/{id}/places`：地址输入辅助——城市里的机场、车站、地标（主数据，不调外部地图服务，M3-10）；
 * - `GET /site/v1/places/search`、`GET /site/v1/places/reverse`：地址搜索、地图上那一点的地址（后端代调谷歌，密钥不进浏览器；
 *   每个地址每分钟 20 次、每天 300 次；谷歌出问题时 200 + `available: false`，页面退回常用地点和手填，M3-12，ADR 0044）；
 *   搜索可以不带城市（渠道授权的范围里搜），候选带类型（机场 / 其他），平台的机场、车站排在最前（M8-02，ADR 0069）；
 * - `GET /site/v1/places/autocomplete`、`GET /site/v1/places/details`：输入即提示和选中后取坐标（谷歌 Autocomplete / Place Details，同一个会话令牌；
 *   每个地址每分钟 60 次，和搜索、反查共用每天 300 次，M8-02，ADR 0069 B1）；
 * - `GET /site/v1/fx/reference?to=`：订单币种 → 客人币种的参考汇率（只读汇率中心现在生效的汇率，只用于显示，M8-02，ADR 0069 B16）；
 * - `POST /site/v1/quotes`：询价，三种品类，可带附加服务（每个地址每分钟 30 次；报价带「这个车型能加哪些附加服务」，M8-02）；
 * - `POST /site/v1/quotes/by-points`：按两个坐标报价——认出机场和接机 / 送机 / 点对点后走同一个询价，顺带给路线的时间、距离（和询价共用每分钟 30 次，M8-02，ADR 0069 A1）；
 * - `GET /site/v1/route-map`：行程摘要的路线小地图（谷歌静态地图，后端代调、密钥不进浏览器；灰色调底图、品牌色路线；每个地址每分钟 30 次、每天 200 次；
 *   出不了图 503 `ROUTE_MAP_UNAVAILABLE`，`details.reason` 只有 `NOT_ENABLED`（页面用原来的地图）和 `UNAVAILABLE`（只显示时间和距离），M8-10，ADR 0072）；
 * - `POST /site/v1/orders`：下单（`Idempotency-Key`，每个地址 10 分钟 10 次），应答里有查看链接的令牌（只这一次）。
 * 测试环境的验收通道（M8-26，ADR 0078）：`POST / GET / DELETE /site/v1/qa-acceptance/session`；带有效验收会话 Cookie 时，城市、机场、包车套餐、
 * 询价（含按两个坐标）只看 QA 测试供应商的「验收可售」商品，下的是验收单。没带 Cookie 的请求和以前完全一样。
 * 客人自己的订单（凭查看链接的令牌 `Authorization: Bearer nzo_…`；一个令牌只对应一张单，路径里没有订单编号）：
 * - `POST /site/v1/orders/lookup`：订单号 + 下单邮箱，对上了把新链接发到下单邮箱（ADR 0061）。一律 202，不透露订单存不存在；
 *   按地址、订单号、邮箱限速（domain 的 `VIEW_LINK_REQUEST_LIMITS`），和订单存不存在无关；
 * - `GET /site/v1/order`、`GET …/order/payment`、`GET …/order/cancel-fee`、`POST …/order/cancel`、`PATCH /site/v1/order`、
 *   `POST …/order/landed`（我已落地）、`POST …/order/extra-charges/{chargeId}/dispute`（对加收提异议）。
 * 订单的应答是 `{ order, timeline, names }`：`order` 是 `/sales/v1` 同一份 `salesOrderJson`（没有结算价、加价比例；付款前没有中标供应商），
 * 只去掉落地信息里司机到达屏照片的文件编号（客人用不上）。
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { CurrencyCode } from "@nozomi/domain";
import { z } from "zod";
import { FX_CURRENCIES, MESSAGING_APPS, PLACE_KINDS, PRICE_LIMITS, QUOTE_RULES, SERVICE_CATEGORIES, STATIC_MAP_RULES, STATIC_MAP_THEMES, type RouteMapReason, isGooglePlaceId, isPlaceSessionToken, normalizePlaceQuery, placeQueryIssue, viewLinkLookupEmail } from "@nozomi/domain";
import { bearerToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import { AppError } from "../errors.ts";
import { notFound } from "../services/errors.ts";
import { cancelForChannel, previewCancellation } from "../services/cancellations.ts";
import { disputeExtraCharge } from "../services/extra-charges.ts";
import { changeForChannel } from "../services/order-changes.ts";
import { type SalesOrderView, getSalesOrderView, orderPaymentForChannel, reportGuestLanding } from "../services/orders.ts";
import {
  type SiteLink,
  type SitePlaceItem,
  type SiteQuote,
  type SiteQuoteInput,
  type SiteQuoteResult,
  type SiteTrip,
  placeSiteOrder,
  requestSiteOrderLink,
  resolveSiteLink,
  siteAirports,
  siteAutocomplete,
  siteCharterPackages,
  siteCities,
  siteConfig,
  siteFxReference,
  siteOrderExtras,
  sitePlaceDetails,
  sitePlaces,
  sitePlaceByCode,
  siteQuotes,
  siteQuotesByPoints,
  siteReversePlace,
  siteRouteMap,
  siteSearchPlaces,
  takeSiteSlot,
} from "../services/site.ts";
import { salesMoney } from "../services/sales-quotes.ts";
import { type InputIssue, idempotencyKey, ifMatchVersion, parseInput, passengerInput, resourceId, singleLine, uuidSchema, validationFailed } from "../validation.ts";
import { changeSchema, disputeSchema, feeJson, salesCancelSchema, salesFeeQuerySchema, toChangeInput } from "./order-actions.ts";
import { distanceJson, paymentJson, salesOrderJson } from "./sales.ts";
import { mapConfigJson } from "./areas.ts";
import type { OrderVehicleGroupRef } from "../repos/master-data.ts";
import { siteSupportWhatsapp } from "../services/manual-quotes.ts";
import { QaAcceptanceHidden, currentQaAcceptance, endQaAcceptance, qaAcceptanceActive, sessionCookie, siteAudienceOf, unlockQaAcceptance } from "../services/qa-acceptance.ts";
import { errorBody } from "../errors.ts";
import { pathOnly } from "../logging.ts";

type Json = Record<string, unknown>;

const pointSchema = z.object({ lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90) }).strict();

/**
 * 客人选的附加服务和数量（M8-02，ADR 0069 B15）：照原样交给报价引擎。同一项写两次、数量超出范围由报价引擎报 400；
 * 没有商品提供（或目录里没有这一项）的车型组报不出价（`ADDON_NOT_OFFERED`）。
 */
const addonsSchema = z
  .array(z.object({ addon_id: uuidSchema, quantity: z.number().int().min(1).max(QUOTE_RULES.maxAddonQuantity).default(1) }).strict())
  .max(QUOTE_RULES.maxAddonKinds)
  .default([]);
const addonsOf = (addons: z.output<typeof addonsSchema>): { addonId: string; quantity: number }[] => addons.map((addon) => ({ addonId: addon.addon_id, quantity: addon.quantity }));

/**
 * 地址联想里选中的那一项的名称（M8-20，ADR 0075 第四部分）：可选，只在一个价都报不出时记进「未覆盖需求」；不影响报价。
 * 页面只在客人从联想列表里选了地址时才带（手打的文字不带）。
 */
const demandNameSchema = z.string().max(200).nullable().optional();

/**
 * 询价请求：`category` 不填是接送机（M3-05 的请求照旧能用）。各品类要的字段：
 * 接送机 `airport_id` + `direction` + `address`；点对点 `pickup` + `dropoff`；包车 `pickup` + `dropoff` + `package_hours`
 * （下车点 M8-15 暂为可选，M8-19 新预订页加了下车地点输入框后改回必填，ADR 0073；`/sales/v1` 仍可选）。
 * 该给的没给是 `REQUIRED`，不该给的给了是 `NOT_APPLICABLE`（和 `/sales/v1` 同一种说法），见 `siteTripOf`。
 */
const quoteSchema = z
  .object({
    category: z.enum(SERVICE_CATEGORIES).default("airport_transfer"),
    city_id: uuidSchema,
    airport_id: uuidSchema.optional(),
    direction: z.enum(["pickup", "dropoff"]).optional(),
    address: pointSchema.optional(),
    pickup: pointSchema.optional(),
    dropoff: pointSchema.optional(),
    package_hours: z.number().int().min(1).max(PRICE_LIMITS.maxPackageHours).optional(),
    service_local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "写成当地时间 YYYY-MM-DDTHH:mm"),
    passengers: z.number().int().min(1).max(60),
    luggage: z.number().int().min(0).max(60).default(0),
    addons: addonsSchema,
    pickup_name: demandNameSchema,
    dropoff_name: demandNameSchema,
  })
  .strict();

type QuoteBody = z.output<typeof quoteSchema>;
type TripField = "airport_id" | "direction" | "address" | "pickup" | "dropoff" | "package_hours";

const TRIP_FIELDS: Readonly<Record<QuoteBody["category"], readonly TripField[]>> = {
  airport_transfer: ["airport_id", "direction", "address"],
  point_to_point: ["pickup", "dropoff"],
  charter: ["pickup", "dropoff", "package_hours"],
};
const TRIP_FIELD_NAMES: Readonly<Record<TripField, string>> = { airport_id: "机场", direction: "接机还是送机", address: "地址那一端的坐标", pickup: "上车点的坐标", dropoff: "下车点的坐标", package_hours: "包车套餐时长" };
const CATEGORY_NAMES: Readonly<Record<QuoteBody["category"], string>> = { airport_transfer: "接送机", point_to_point: "点对点", charter: "包车" };

/** 按品类核对该给的字段给了、不该给的没给，换成服务层的行程。 */
export function siteTripOf(body: QuoteBody): SiteTrip {
  const needed = TRIP_FIELDS[body.category];
  const issues: InputIssue[] = [];
  for (const field of Object.keys(TRIP_FIELD_NAMES) as TripField[]) {
    const given = body[field] !== undefined;
    if (needed.includes(field) && !given) issues.push({ path: `/${field}`, reason: "REQUIRED", message: `${CATEGORY_NAMES[body.category]}要填${TRIP_FIELD_NAMES[field]}` });
    if (!needed.includes(field) && given) issues.push({ path: `/${field}`, reason: "NOT_APPLICABLE", message: `${CATEGORY_NAMES[body.category]}不用填${TRIP_FIELD_NAMES[field]}（请删掉）` });
  }
  if (issues.length > 0) throw validationFailed("body", issues);
  const { airport_id: airportId, direction, address, pickup, dropoff, package_hours: packageHours } = body;
  switch (body.category) {
    case "airport_transfer":
      return { category: "airport_transfer", airportId: airportId as string, direction: direction as "pickup" | "dropoff", address: address as { lng: number; lat: number } };
    case "point_to_point":
      return { category: "point_to_point", pickup: pickup as { lng: number; lat: number }, dropoff: dropoff as { lng: number; lat: number } };
    case "charter":
      return { category: "charter", pickup: pickup as { lng: number; lat: number }, dropoff: dropoff as { lng: number; lat: number }, packageHours: packageHours as number };
  }
}

/** 地址搜索：关键字（规范化后 2–100 个字，见 domain 的 `placeQueryIssue`），城市可以不带（M8-02：在渠道授权的范围里搜）。 */
const placeSearchSchema = z.object({ city_id: uuidSchema.optional(), q: z.string().max(400) }).strict();
/** 输入即提示：关键字 + 浏览器生成的会话令牌（一次「输入 → 选中」同一个，见 domain 的 `isPlaceSessionToken`）。 */
const sessionSchema = z.string().refine(isPlaceSessionToken, "会话令牌是 16–36 个字母、数字、下划线或连字符（推荐用 UUID）");
const placeAutocompleteSchema = z.object({ q: z.string().max(400), session: sessionSchema }).strict();
/** 输入即提示选中之后：谷歌的地点 ID + 同一个会话令牌（不给也行，按单次计费）。 */
const placeDetailsSchema = z.object({ id: z.string().refine(isGooglePlaceId, "不是谷歌地点 ID 的格式"), session: sessionSchema.optional() }).strict();

/** 按两个坐标报价的一端：名称（客人看到的地址文字，只校验、不进日志）、坐标、地址搜索给的类型（手填的不给）。 */
const tripEndSchema = z
  .object({
    name: singleLine(300).refine((value) => value.trim() !== "", "请填地址"),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    kind: z.enum(PLACE_KINDS).optional(),
  })
  .strict();
const byPointsSchema = z
  .object({
    pickup: tripEndSchema,
    dropoff: tripEndSchema,
    service_local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "写成当地时间 YYYY-MM-DDTHH:mm"),
    passengers: z.number().int().min(1).max(60),
    luggage: z.number().int().min(0).max(60).default(0),
    addons: addonsSchema,
    pickup_name: demandNameSchema,
    dropoff_name: demandNameSchema,
  })
  .strict();

/** 路线小地图：起终点坐标、主题、尺寸（CSS 像素）、倍率（高清屏 2）。 */
const routeMapSchema = z
  .object({
    from_lat: z.coerce.number().finite().min(-90).max(90),
    from_lng: z.coerce.number().finite().min(-180).max(180),
    to_lat: z.coerce.number().finite().min(-90).max(90),
    to_lng: z.coerce.number().finite().min(-180).max(180),
    theme: z.enum(STATIC_MAP_THEMES).default("light"),
    width: z.coerce.number().int().min(STATIC_MAP_RULES.minWidth).max(STATIC_MAP_RULES.maxWidth),
    height: z.coerce.number().int().min(STATIC_MAP_RULES.minHeight).max(STATIC_MAP_RULES.maxHeight),
    scale: z.enum(["1", "2"]).default("1"),
  })
  .strict();
const ROUTE_MAP_REQUIRED = ["from_lat", "from_lng", "to_lat", "to_lng", "width", "height"] as const;

const ROUTE_MAP_MESSAGES: Readonly<Record<RouteMapReason, string>> = {
  NOT_ENABLED: "路线图服务没有开通，请用页面上的地图",
  UNAVAILABLE: "路线图暂时出不了，请稍后再试",
};

/** 出不了图（ADR 0072）：页面按 `details.reason` 决定用原来的地图（NOT_ENABLED）还是只显示时间和距离（UNAVAILABLE）。 */
function routeMapUnavailable(reason: RouteMapReason): AppError {
  return new AppError(503, "ROUTE_MAP_UNAVAILABLE", ROUTE_MAP_MESSAGES[reason], { reason });
}

/** 参考汇率：客人币种（汇率中心支持的币种，大写三位）。 */
const fxReferenceSchema = z.object({ to: z.enum(FX_CURRENCIES as [string, ...string[]]) }).strict();

/** 关键字规范化后核对长短（搜索、输入即提示同一个规则）。 */
function placeQueryOf(raw: string): string {
  const query = normalizePlaceQuery(raw);
  const issue = placeQueryIssue(query);
  if (issue !== null) throw validationFailed("querystring", [{ path: "/q", reason: issue, message: issue === "TOO_SHORT" ? "请至少输入 2 个字（字母、数字、汉字或假名），如酒店名、地址" : "关键字太长了，最多 100 个字" }]);
  return query;
}

function placeItemJson(item: SitePlaceItem): Json {
  return { source: item.source, id: item.id, name: item.name, address: item.address, location: item.location === null ? null : { lat: item.location.lat, lng: item.location.lng }, kind: item.kind };
}
/** 地图上一个位置：城市 + 坐标。 */
const placeReverseSchema = z
  .object({
    city_id: uuidSchema,
    lat: z.coerce.number().finite().min(-90).max(90),
    lng: z.coerce.number().finite().min(-180).max(180),
  })
  .strict();

const text = (max: number) => z.string().max(max).nullable().default(null);
const singleLineText = (max: number) => singleLine(max).nullable().default(null);
const orderSchema = z
  .object({
    quote_id: z.string().regex(/^QT\d{8}[0-9A-Z]{10}$/, "不是报价编号的格式"),
    passenger: passengerInput(),
    flight_no: text(20),
    pickup_address: singleLineText(1_000),
    dropoff_address: singleLineText(1_000),
    messaging: z.object({ app: z.enum(MESSAGING_APPS), handle: z.string().max(200) }).strict().nullable().default(null),
    notes: text(2_000),
    // 客人勾选「同意保存支付方式，用于服务后加收」（第五轮决策 ⑤）；没勾不能下单
    save_payment_method: z.boolean(),
  })
  .strict();

/** 解锁验收会话（M8-26，ADR 0078）：口令只在请求体里（不进网址、访问日志）。长度不在这里卡：不合格的口令照样按「不对」处理、照样计数 */
const qaUnlockSchema = z.object({ token: z.string().max(1_000) }).strict();

/** 查订单：订单号（不分大小写）+ 下单邮箱（全角转半角、不分大小写；手机号不行：链接只发邮箱，ADR 0061）。 */
const lookupSchema = z
  .object({
    order_no: z.string().trim().toUpperCase().regex(/^NZ\d{8}[0-9A-Z]{8}$/, "订单号是 NZ 开头的 18 位，如 NZ20261026AB12CD34"),
    email: z.string().max(400).transform((value, issue) => {
      const email = viewLinkLookupEmail(value);
      if (email === null) issue.addIssue({ code: "custom", message: "请填写下单时的邮箱" });
      return email ?? "";
    }),
  })
  .strict();

function linkJson(link: SiteLink): Json {
  return { token: link.token, expires_at: link.expiresAt.toISOString() };
}

function quoteJson(quote: SiteQuote): Json {
  const group = quote.vehicleGroup;
  return {
    quote_id: quote.quoteId,
    expires_at: quote.expiresAt,
    service_date: quote.serviceDate,
    urgent: quote.urgent,
    vehicle_group: { id: group.id, code: group.code, name: group.name, grade: group.grade, seats: group.seats, sample_models: group.sampleModels, combos: group.combos },
    package: quote.packageHours === null ? null : { hours: quote.packageHours, km: quote.packageKm },
    // 包车：这个价里含区域加价（上车或下车不在商品本身的区域里，ADR 0073）；只说明「含区域加价」，不单列金额
    includes_area_surcharge: quote.includesAreaSurcharge,
    // 点对点设了含公里数的价（M8-11，ADR 0073 第四部分）：含 X 公里、本次路线 D 米、超出 Z 公里 × 每公里对外价（已含在 price.total 里）；没设为 null
    distance: distanceJson(quote),
    price: { total: salesMoney(quote.sellMinor, quote.currency), fx: quote.fx === null ? null : { rate: quote.fx.rate, as_of: quote.fx.asOf } },
    free_wait_minutes: quote.freeWaitMinutes,
    cancel_policy: { category: quote.cancelPolicy.category, level: quote.cancelPolicy.level, tiers: quote.cancelPolicy.tiers.map((tier) => ({ min_hours_before: tier.minHoursBefore, fee_bp: tier.feeBp })) },
    // 只有目录信息（编码、名称、计费方式），不带供应商单价、也不带对外单价：价格只在加了之后重新询价的合计里（ADR 0069 B15）
    available_addons: quote.availableAddons.map((addon) => ({ id: addon.id, code: addon.code, name: addon.name, charge_unit: addon.chargeUnit })),
  };
}

function quoteResultJson(result: SiteQuoteResult): Json {
  return { currency: result.currency, quotes: result.quotes.map(quoteJson), unavailable: result.unavailable.map((entry) => ({ vehicle_group_id: entry.vehicleGroupId, reasons: entry.reasons })) };
}

/** 渠道看到的那一份订单，落地信息去掉司机到达屏照片的文件编号（照片只给平台和供应商核对）。 */
function guestOrderJson(view: SalesOrderView, now: Date): Json {
  const order = salesOrderJson(view, now);
  const landing = order["landing"] as Json | null;
  if (landing === null) return order;
  const { driver_photo_file_id: _photo, ...guestLanding } = landing;
  return { ...order, landing: guestLanding };
}

/** 订单页的车型组：名称、座位数和车型标识的来源（代表车型、组合，M7-02）。车型组当前的值。 */
function siteOrderVehicleGroupJson(group: OrderVehicleGroupRef | null): Json | null {
  if (group === null) return null;
  return { code: group.code, name: group.name, seats: group.seats, sample_models: group.sampleModels, combos: group.combos.map((combo) => ({ passengers: combo.passengers, luggage: combo.luggage })) };
}

/**
 * 客人看到的订单：`order` 就是渠道看到的那一份（没有结算价、加价比例，付款前没有中标供应商），
 * 另加状态时间线（不含操作人和派车细节）和城市、机场、车型组的名称。
 */
async function siteOrderJson(ctx: AppContext, view: SalesOrderView): Promise<Json> {
  const extras = await siteOrderExtras(ctx, view);
  return {
    order: guestOrderJson(view, ctx.now()),
    timeline: extras.events.map((event) => ({ from_status: event.fromStatus, to_status: event.toStatus, reason: event.reason, occurred_at: event.occurredAt.toISOString() })),
    names: { city: extras.names.city, place: extras.names.place, vehicle_group: siteOrderVehicleGroupJson(extras.names.vehicleGroup) },
  };
}

/** 和接口不存在时一模一样的 404（app.ts 的 `setNotFoundHandler`）：验收通道没开、口令不对时用，不透露这个接口存在。 */
function routeNotFound(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return reply.code(404).send(errorBody("NOT_FOUND", "接口不存在", { method: request.method, path: pathOnly(request.url) }));
}

/**
 * 测试环境的验收通道（M8-26，ADR 0078）：`POST` 解锁（口令在请求体里）、`GET` 看这个浏览器的会话、`DELETE` 结束。
 * 没开（没配口令、production）时三个都在解析请求体之前答 404，和接口不存在一样；口令不对也是同样的 404（另外计数、记审计）。
 */
function registerQaAcceptanceRoutes(app: FastifyInstance, ctx: AppContext): void {
  const path = "/site/v1/qa-acceptance/session";
  const hidden = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!qaAcceptanceActive(ctx)) await routeNotFound(request, reply);
  };
  const hide = (request: FastifyRequest, reply: FastifyReply, err: unknown): FastifyReply => {
    if (err instanceof QaAcceptanceHidden) return routeNotFound(request, reply);
    throw err;
  };

  app.post(path, { onRequest: hidden }, async (request, reply) => {
    try {
      const input = parseInput(qaUnlockSchema, request.body, "body");
      const session = await unlockQaAcceptance(ctx, { token: input.token, ip: request.ip });
      return reply.code(201).header("set-cookie", sessionCookie(session.value)).send({ active: true, expires_at: session.expiresAt.toISOString() });
    } catch (err) {
      return hide(request, reply, err);
    }
  });

  app.get(path, { onRequest: hidden }, async (request, reply) => {
    try {
      const session = await currentQaAcceptance(ctx, request.headers.cookie);
      return { active: true, expires_at: session.expiresAt.toISOString() };
    } catch {
      // 没有有效会话时也答 404：不让人用 GET 探出测试环境开着验收通道（M8-26 验收观察）
      return routeNotFound(request, reply);
    }
  });

  app.delete(path, { onRequest: hidden }, async (request, reply) => {
    try {
      await endQaAcceptance(ctx, { cookieHeader: request.headers.cookie, ip: request.ip });
      return reply.code(204).header("set-cookie", sessionCookie(null)).send();
    } catch (err) {
      return hide(request, reply, err);
    }
  });
}

export function registerSiteRoutes(app: FastifyInstance, ctx: AppContext): void {
  registerQaAcceptanceRoutes(app, ctx);
  /** 这次请求看哪一类商品：没带验收会话是普通客人；带了要有效（M8-26，ADR 0078） */
  const audience = (request: FastifyRequest) => siteAudienceOf(ctx, request.headers.cookie);
  /** 凭查看链接：限速（按地址）后找到这一张单。 */
  const guest = async (request: FastifyRequest): Promise<{ orderId: string; channelId: string }> => {
    await takeSiteSlot(ctx, "site_read", { ip: request.ip });
    return resolveSiteLink(ctx, bearerToken(request.headers.authorization));
  };
  const orderView = async (who: { orderId: string; channelId: string }): Promise<Json> => {
    const view = await getSalesOrderView(ctx, who.channelId, who.orderId);
    if (view === null) throw notFound("订单");
    return siteOrderJson(ctx, view);
  };

  app.get("/site/v1/config", async (request) => {
    await takeSiteSlot(ctx, "site_read", { ip: request.ip });
    const config = await siteConfig(ctx);
    return {
      open: config.open,
      currency: config.currency,
      payments: config.payments === null ? null : { provider: config.payments.provider, publishable_key: config.payments.publishableKey },
      support_phone: ctx.config.siteSupportPhone,
      // 客服 WhatsApp 号码（M8-21，ADR 0076）：运营后台「官网设置」填的，纯数字；没填为 null，页面不显示 WhatsApp 按钮
      support_whatsapp: await siteSupportWhatsapp(ctx),
      // 地址搜索（谷歌，后端代调）和地图底图（ADR 0044、0015）：页面按这两项决定显示哪几种选地址的方式
      address_search: config.addressSearch,
      map_tiles: config.open ? mapConfigJson(ctx.config.mapTiles)["tiles"] : null,
    };
  });

  app.get("/site/v1/cities", async (request) => {
    await takeSiteSlot(ctx, "site_read", { ip: request.ip });
    const cities = await siteCities(ctx, await audience(request));
    return { items: cities.map((city) => ({ id: city.id, code: city.code, name: city.name, timezone: city.timezone, country_code: city.countryCode, center: { lat: city.center.lat, lng: city.center.lng }, categories: city.categories })) };
  });

  app.get("/site/v1/cities/:id/airports", async (request) => {
    await takeSiteSlot(ctx, "site_read", { ip: request.ip });
    const airports = await siteAirports(ctx, resourceId(request.params, "城市"), await audience(request));
    return { items: airports.map((airport) => ({ id: airport.id, code: airport.code, name: airport.name, location: { lng: airport.lng, lat: airport.lat } })) };
  });

  app.get("/site/v1/cities/:id/charter-packages", async (request) => {
    await takeSiteSlot(ctx, "site_read", { ip: request.ip });
    const hours = await siteCharterPackages(ctx, resourceId(request.params, "城市"), await audience(request));
    return { items: hours.map((value) => ({ hours: value })) };
  });

  app.get("/site/v1/cities/:id/places", async (request) => {
    await takeSiteSlot(ctx, "site_read", { ip: request.ip });
    const places = await sitePlaces(ctx, resourceId(request.params, "城市"));
    return { items: places.map((place) => ({ id: place.id, type: place.type, code: place.code, name: place.name, address: place.address, location: { lng: place.lng, lat: place.lat } })) };
  });

  /** 按编码取平台地点（M8-04，新预订页链接参数 from=NRT）：只读主数据、不调谷歌，和城市地点同一份读接口限速 */
  app.get("/site/v1/places/by-code", async (request) => {
    await takeSiteSlot(ctx, "site_read", { ip: request.ip });
    const raw = (request.query as { code?: unknown }).code;
    const code = typeof raw === "string" ? raw.trim() : "";
    if (!/^[A-Za-z0-9-]{1,32}$/.test(code)) throw validationFailed("querystring", [{ path: "/code", reason: "FORMAT", message: "地点编码只能是 1 到 32 位字母、数字和连字符" }]);
    const place = await sitePlaceByCode(ctx, code);
    return { id: place.id, type: place.type, code: place.code, name: place.name, address: place.address, location: { lng: place.lng, lat: place.lat } };
  });

  /** 地址搜索、反查的限速：每个地址每分钟、每天各一份额度（每次都可能花钱调谷歌） */
  const placeSlot = async (request: FastifyRequest): Promise<void> => {
    await takeSiteSlot(ctx, "site_places", { ip: request.ip });
    await takeSiteSlot(ctx, "site_places_day", { ip: request.ip });
  };

  app.get("/site/v1/places/search", async (request) => {
    await placeSlot(request);
    const input = parseInput(placeSearchSchema, request.query, "querystring");
    const found = await siteSearchPlaces(ctx, input.city_id ?? null, placeQueryOf(input.q));
    return { available: found.available, items: found.items.map(placeItemJson) };
  });

  /** 输入即提示每输入几个字就调一次（页面防抖 300 毫秒）：每分钟的额度比搜索宽，每天的额度和搜索、反查共用 */
  const autocompleteSlot = async (request: FastifyRequest): Promise<void> => {
    await takeSiteSlot(ctx, "site_autocomplete", { ip: request.ip });
    await takeSiteSlot(ctx, "site_places_day", { ip: request.ip });
  };

  app.get("/site/v1/places/autocomplete", async (request) => {
    await autocompleteSlot(request);
    const input = parseInput(placeAutocompleteSchema, request.query, "querystring");
    const found = await siteAutocomplete(ctx, placeQueryOf(input.q), input.session);
    return { available: found.available, items: found.items.map(placeItemJson) };
  });

  app.get("/site/v1/places/details", async (request) => {
    await autocompleteSlot(request);
    const input = parseInput(placeDetailsSchema, request.query, "querystring");
    const found = await sitePlaceDetails(ctx, input.id, input.session ?? null);
    return { available: found.available, place: found.place === null ? null : { id: found.place.id, address: found.place.address, location: { lat: found.place.location.lat, lng: found.place.location.lng }, kind: found.place.kind } };
  });

  app.get("/site/v1/places/reverse", async (request) => {
    await placeSlot(request);
    // 留空的坐标是「没填」，不能被当成 0（数字转换会把空字符串变成 0）
    const query = (request.query ?? {}) as Record<string, unknown>;
    const missing = (["lat", "lng"] as const).filter((name) => query[name] === undefined || (typeof query[name] === "string" && (query[name] as string).trim() === ""));
    if (missing.length > 0) throw validationFailed("querystring", missing.map((name) => ({ path: `/${name}`, reason: "REQUIRED", message: name === "lat" ? "请给出纬度" : "请给出经度" })));
    const input = parseInput(placeReverseSchema, request.query, "querystring");
    return siteReversePlace(ctx, input.city_id, { lat: input.lat, lng: input.lng });
  });

  // 按客人币种显示参考价（M8-02，ADR 0069 B16）：只读汇率中心现在生效的汇率，不拉外部服务；不可用时 200 + available false
  app.get("/site/v1/fx/reference", async (request) => {
    await takeSiteSlot(ctx, "site_read", { ip: request.ip });
    const input = parseInput(fxReferenceSchema, request.query, "querystring");
    const found = await siteFxReference(ctx, input.to as CurrencyCode);
    return { available: found.available, from: found.from, to: found.to, rate: found.rate, as_of: found.asOf, reason: found.reason };
  });

  /** 路线小地图（M8-10，ADR 0072）：每次可能花钱调谷歌静态地图（缓存命中不花钱），每个地址每分钟、每天各一份额度 */
  app.get("/site/v1/route-map", async (request, reply) => {
    await takeSiteSlot(ctx, "site_route_map", { ip: request.ip });
    await takeSiteSlot(ctx, "site_route_map_day", { ip: request.ip });
    // 留空的参数是「没填」，不能被当成 0（数字转换会把空字符串变成 0）
    const query = (request.query ?? {}) as Record<string, unknown>;
    const missing = ROUTE_MAP_REQUIRED.filter((name) => query[name] === undefined || (typeof query[name] === "string" && (query[name] as string).trim() === ""));
    if (missing.length > 0) throw validationFailed("querystring", missing.map((name) => ({ path: `/${name}`, reason: "REQUIRED", message: `请给出 ${name}` })));
    const input = parseInput(routeMapSchema, request.query, "querystring");
    const result = await siteRouteMap(ctx, {
      from: { lat: input.from_lat, lng: input.from_lng },
      to: { lat: input.to_lat, lng: input.to_lng },
      theme: input.theme,
      width: input.width,
      height: input.height,
      scale: input.scale === "2" ? 2 : 1,
    });
    if (!result.ok) throw routeMapUnavailable(result.reason);
    return reply
      .header("content-type", result.contentType)
      .header("cache-control", `private, max-age=${STATIC_MAP_RULES.browserMaxAgeSeconds}`)
      .header("x-content-type-options", "nosniff")
      .send(result.image);
  });

  app.post("/site/v1/quotes", async (request) => {
    await takeSiteSlot(ctx, "site_quote", { ip: request.ip });
    const input = parseInput(quoteSchema, request.body, "body");
    const seen = await audience(request);
    const quoteInput: SiteQuoteInput = {
      cityId: input.city_id,
      trip: siteTripOf(input),
      serviceLocal: input.service_local,
      passengers: input.passengers,
      luggage: input.luggage,
      addons: addonsOf(input.addons),
      demand: { ip: request.ip, pickupName: input.pickup_name ?? null, dropoffName: input.dropoff_name ?? null, log: request.log },
      ...(seen === "acceptance" ? { audience: seen } : {}),
    };
    return quoteResultJson(await siteQuotes(ctx, quoteInput));
  });

  app.post("/site/v1/quotes/by-points", async (request) => {
    await takeSiteSlot(ctx, "site_quote", { ip: request.ip });
    const input = parseInput(byPointsSchema, request.body, "body");
    const seen = await audience(request);
    const end = (value: z.output<typeof tripEndSchema>) => ({ lat: value.lat, lng: value.lng, kind: value.kind ?? null });
    const result = await siteQuotesByPoints(ctx, {
      pickup: end(input.pickup),
      dropoff: end(input.dropoff),
      serviceLocal: input.service_local,
      passengers: input.passengers,
      luggage: input.luggage,
      addons: addonsOf(input.addons),
      demand: { ip: request.ip, pickupName: input.pickup_name ?? null, dropoffName: input.dropoff_name ?? null, log: request.log },
      ...(seen === "acceptance" ? { audience: seen } : {}),
    });
    return {
      trip_type: result.tripType,
      airport: result.airport === null ? null : { id: result.airport.id, code: result.airport.code, name: result.airport.name, matched_by: result.airport.matchedBy, distance_meters: result.airport.meters },
      city: result.city,
      ...quoteResultJson(result),
      expires_at: result.expiresAt,
      route: result.route === null ? null : { minutes: result.route.minutes, meters: result.route.meters, polyline: result.route.polyline },
    };
  });

  app.post("/site/v1/orders", async (request, reply) => {
    await takeSiteSlot(ctx, "site_order", { ip: request.ip });
    const key = idempotencyKey(request.headers["idempotency-key"]);
    const input = parseInput(orderSchema, request.body, "body");
    const seen = await audience(request);
    const created = await placeSiteOrder(
      ctx,
      {
        quoteId: input.quote_id,
        idempotencyKey: key,
        details: {
          passenger: input.passenger,
          flightNo: input.flight_no,
          pickupAddress: input.pickup_address,
          dropoffAddress: input.dropoff_address,
          messaging: input.messaging,
          notes: input.notes,
          channelOrderNo: null,
          savePaymentMethodConsent: input.save_payment_method,
        },
      },
      request.log,
      seen,
    );
    if (created.replayed) reply.header("idempotent-replayed", "true");
    return reply.code(201).send({ ...(await siteOrderJson(ctx, created.view)), payment: created.payment === null ? null : paymentJson(created.payment), link: linkJson(created.link) });
  });

  // 对上、对不上、订单号不存在都是这一句：查单和发信在应答之后的后台任务里
  app.post("/site/v1/orders/lookup", async (request, reply) => {
    await takeSiteSlot(ctx, "site_lookup", { ip: request.ip });
    const input = parseInput(lookupSchema, request.body, "body");
    await requestSiteOrderLink(ctx, request.log, { orderNo: input.order_no, email: input.email });
    return reply.code(202).send({ status: "accepted" });
  });

  app.get("/site/v1/order", async (request) => orderView(await guest(request)));

  app.get("/site/v1/order/payment", async (request) => {
    const who = await guest(request);
    return { payment: paymentJson(await orderPaymentForChannel(ctx, who.channelId, who.orderId, request.log)) };
  });

  app.get("/site/v1/order/cancel-fee", async (request) => {
    const who = await guest(request);
    const query = parseInput(salesFeeQuerySchema, request.query, "querystring");
    return feeJson((await previewCancellation(ctx, { channelId: who.channelId }, who.orderId, query.reason, false)).quote, "sales");
  });

  app.post("/site/v1/order/cancel", async (request) => {
    const who = await guest(request);
    const input = parseInput(salesCancelSchema, request.body ?? {}, "body");
    const result = await cancelForChannel(ctx, who.channelId, who.orderId, input.reason, request.log);
    return { ...(await orderView(who)), replayed: result.kind === "cancelled" && result.replayed };
  });

  app.patch("/site/v1/order", async (request) => {
    const who = await guest(request);
    const version = ifMatchVersion(request.headers["if-match"]);
    const input = parseInput(changeSchema, request.body ?? {}, "body");
    const result = await changeForChannel(ctx, who.channelId, who.orderId, version, toChangeInput(input), request.log);
    const view = await orderView(who);
    return { ...view, change: ((view["order"] as Json)["changes"] as Json[]).find((change) => change["id"] === result.change.id) ?? null };
  });

  app.post("/site/v1/order/landed", async (request) => {
    const who = await guest(request);
    await reportGuestLanding(ctx, who.channelId, who.orderId);
    return orderView(who);
  });

  app.post("/site/v1/order/extra-charges/:chargeId/dispute", async (request) => {
    const who = await guest(request);
    const chargeId = resourceId({ id: (request.params as { chargeId?: unknown }).chargeId }, "加收");
    const input = parseInput(disputeSchema, request.body, "body");
    await disputeExtraCharge(ctx, who.channelId, who.orderId, chargeId, input.reason);
    const view = await orderView(who);
    return { ...view, extra_charge: ((view["order"] as Json)["extra_charges"] as Json[]).find((charge) => charge["id"] === chargeId) ?? null };
  });
}
