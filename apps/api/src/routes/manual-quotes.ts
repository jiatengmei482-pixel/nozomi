/**
 * 人工报价申请和官网设置（M8-21，ADR 0076）。
 *
 * 官网（不登录）：
 * - `POST /site/v1/manual-quote-requests`：一家都报不出价时，客人留下邮箱或 WhatsApp（至少一项），行程由页面自动带上。
 *   每个地址 15 分钟 3 次、每天 10 次，每个联系方式每天 3 次，全站每小时 300 次；`website` 是给机器人填的陷阱字段（页面不显示），
 *   填了照样 202、什么都不记。应答一律 202 `{ status: "accepted" }`，重复提交也一样。
 *   带有效验收会话 Cookie 的记成验收留资（M8-39，ADR 0078 补充）；带了但会话无效、过期是 401 `QA_SESSION_INVALID`，和询价一样；production 不看 Cookie。
 *   从行程报价页转人工时可以带 `trip_id`（M9T-08，ADR 0101 第十二节）、`plan_kind`、`trip_labels`（各点名称）；`trip` 仍是第一天的一段，照旧必填。
 * 运营后台：
 * - `GET /platform/v1/manual-quote-requests`（`manual_quote.read`）：列表，没有个人信息，带各状态的数量；默认不列验收留资（`acceptance=only|include` 才列）；
 * - `GET /platform/v1/manual-quote-requests/assignees`（`manual_quote.manage`）：能被指派跟进的同事；
 * - `GET /platform/v1/manual-quote-requests/{id}`（`manual_quote.read`）：详情，解密联系方式、地点、备注，留审计；带了行程单的有整张行程单（`trip`）；
 * - `PATCH /platform/v1/manual-quote-requests/{id}`（`manual_quote.manage`，If-Match）：改状态、指派；
 * - `POST /platform/v1/manual-quote-requests/{id}/notes`（`manual_quote.manage`）：写备注；
 * - `GET /platform/v1/site-settings`（`site_settings.read`）、`PUT`（`site_settings.manage`，只归超级管理员）：客服 WhatsApp 号码、页面宽度（M8-28）。
 * 官网的 `GET /site/v1/config` 多 `support_whatsapp`、`page_width` 两项（在 `routes/site.ts`）。
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  type CurrencyCode,
  MANUAL_QUOTE_RULES,
  MANUAL_QUOTE_STATUSES,
  SERVICE_CATEGORIES,
  TRIP_LIMITS,
  arriveByIssue,
  isPlaceIdPlace,
  manualQuoteEmail,
  manualQuoteTripIssues,
  whatsappDigits,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { decodeTimeCursor } from "../pagination.ts";
import type { ManualQuoteRow, SiteSettingsRow } from "../repos/manual-quotes.ts";
import {
  type ManualQuoteDetail,
  type ManualQuoteEventView,
  type ManualQuoteTripRef,
  type ManualQuoteTripView,
  addManualQuoteNote,
  changeManualQuoteRequest,
  getManualQuoteRequest,
  getSiteSettings,
  listManualQuoteAssignees,
  listManualQuoteRequests,
  submitManualQuote,
  updateSiteSettings,
} from "../services/manual-quotes.ts";
import { authenticatePlatform, platformCredentials } from "../services/platform-auth.ts";
import { siteAudienceOf } from "../services/qa-acceptance.ts";
import { salesMoney } from "../services/sales-quotes.ts";
import { TRIP_ID } from "../services/trips.ts";
import { takeSiteSlot } from "../services/site.ts";
import { ARRIVE_BY_MESSAGES, arriveBySchema } from "./site.ts";
import { type InputIssue, ifMatchVersion, pageQuerySchema, parseInput, resourceId, singleLine, uuidSchema, validationFailed, visibleText } from "../validation.ts";

type Json = Record<string, unknown>;

/** 行程单一个点的名称（M9T-08）最多多少字 */
const MANUAL_QUOTE_TRIP_LABEL_MAX = 200;

const placeSchema = z
  .object({
    name: singleLine(MANUAL_QUOTE_RULES.maxPlaceName).refine((value) => value.trim() !== "", "请填地点名称"),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  })
  .strict();

const tripSchema = z
  .object({
    category: z.enum(SERVICE_CATEGORIES),
    city_id: uuidSchema.nullable().default(null),
    pickup: placeSchema,
    dropoff: placeSchema.nullable().default(null),
    service_local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "写成当地时间 YYYY-MM-DDTHH:mm"),
    passengers: z.number().int().min(1).max(MANUAL_QUOTE_RULES.maxPassengers),
    luggage: z.number().int().min(0).max(MANUAL_QUOTE_RULES.maxLuggage).default(0),
    package_hours: z.number().int().min(1).max(MANUAL_QUOTE_RULES.maxPackageHours).nullable().default(null),
    // 包车的经停点（M9W-04）：页面上客人填好的经停点按顺序带上；没有可以不给
    // 指定到达时间（M9P-20 P3）：和官网询价同一个写法和校验，只记下来给客服看
    waypoints: z
      .array(
        placeSchema
          .extend({
            stay_minutes: z.number().int().min(0).max(MANUAL_QUOTE_RULES.maxStayMinutes),
            arrive_by: arriveBySchema.optional(),
          })
          .strict(),
      )
      .max(MANUAL_QUOTE_RULES.maxWaypoints)
      .default([]),
  })
  .strict();

const submitSchema = z
  .object({
    email: z.string().max(400).nullable().default(null),
    whatsapp: z.string().max(60).nullable().default(null),
    // 页面在提交按钮旁写明「提交即同意客服通过您留下的方式联系您」，客人点提交时带 true
    consent: z.literal(true, { errorMap: () => ({ message: "需要同意客服通过您留下的方式联系您" }) }),
    trip: tripSchema,
    // 陷阱字段：页面不显示，人不会填
    website: z.string().max(400).optional(),
    // 从行程报价页转人工（M9T-08）：行程单编号（格式不对和不存在一样回 NOT_FOUND）、客人当时看的方案、各点在页面上的名称（按天、按点）
    trip_id: z.string().max(100).optional(),
    plan_kind: z.enum(["one_car", "daily_best"]).optional(),
    trip_labels: z
      .array(z.array(singleLine(MANUAL_QUOTE_TRIP_LABEL_MAX).nullable()).max(TRIP_LIMITS.maxItemsPerDay))
      .max(TRIP_LIMITS.maxDays)
      .optional(),
  })
  .strict();

const TRIP_ISSUE_MESSAGES = {
  dropoff: { REQUIRED: "接送机、点对点要有下车地点" },
  package_hours: { REQUIRED: "包车要有套餐时长（或经停点）", NOT_APPLICABLE: "只有包车有套餐时长（请删掉）" },
  waypoints: { NOT_APPLICABLE: "只有包车有经停点（请删掉）" },
  service_local: { INVALID: "用车时间不是真实存在的日期和时刻" },
} as const;

/** 邮箱、WhatsApp 至少一项，填了的要合格；行程按用车类型核对。 */
function submissionOf(body: z.output<typeof submitSchema>) {
  const issues: InputIssue[] = [];
  const blank = (value: string | null) => value === null || value.trim() === "";
  const email = blank(body.email) ? null : manualQuoteEmail(body.email as string);
  const whatsapp = blank(body.whatsapp) ? null : whatsappDigits(body.whatsapp as string, { requirePlus: true });
  if (blank(body.email) && blank(body.whatsapp)) issues.push({ path: "/email", reason: "REQUIRED", message: "请留下邮箱或 WhatsApp，至少一项" });
  if (!blank(body.email) && email === null) issues.push({ path: "/email", reason: "FORMAT", message: "邮箱格式不对，例如 name@example.com" });
  if (!blank(body.whatsapp) && whatsapp === null) issues.push({ path: "/whatsapp", reason: "FORMAT", message: "请填写带国家码的号码，以 + 开头，例如 +81 90 1234 5678" });
  const trip = {
    category: body.trip.category,
    pickup: body.trip.pickup,
    dropoff: body.trip.dropoff,
    serviceLocal: body.trip.service_local,
    passengers: body.trip.passengers,
    luggage: body.trip.luggage,
    packageHours: body.trip.package_hours,
    waypoints: body.trip.waypoints.map((stop) => ({ name: stop.name, lat: stop.lat, lng: stop.lng, stayMinutes: stop.stay_minutes, ...(stop.arrive_by === undefined ? {} : { arriveBy: { day_offset: stop.arrive_by.day_offset, time: stop.arrive_by.time } }) })),
  };
  body.trip.waypoints.forEach((stop, index) => {
    const issue = stop.arrive_by === undefined ? null : arriveByIssue(body.trip.service_local, stop.arrive_by);
    if (issue !== null) issues.push({ path: `/trip/waypoints/${index}/arrive_by`, reason: issue, message: ARRIVE_BY_MESSAGES[issue] });
  });
  for (const issue of manualQuoteTripIssues(trip)) {
    issues.push({ path: `/trip/${issue.field}`, reason: issue.reason, message: (TRIP_ISSUE_MESSAGES[issue.field] as Record<string, string>)[issue.reason] ?? "行程信息不对" });
  }
  let tripRef: ManualQuoteTripRef | null = null;
  if (body.trip_id === undefined) {
    if (body.plan_kind !== undefined) issues.push({ path: "/plan_kind", reason: "NOT_APPLICABLE", message: "没有行程单就没有方案（请删掉）" });
    if (body.trip_labels !== undefined) issues.push({ path: "/trip_labels", reason: "NOT_APPLICABLE", message: "没有行程单就没有地点名称（请删掉）" });
  } else if (!TRIP_ID.test(body.trip_id)) {
    // 格式不对和不存在同一个回答（不让人借此试探编号）
    issues.push({ path: "/trip_id", reason: "NOT_FOUND", message: "行程单不存在或已过期，请重新报价" });
  } else {
    const labels = body.trip_labels === undefined ? null : body.trip_labels.map((day) => day.map((label) => (label === null || label.trim() === "" ? null : label.trim())));
    tripRef = { tripId: body.trip_id, planKind: body.plan_kind ?? null, labels };
  }
  if (issues.length > 0) throw validationFailed("body", issues);
  return { email, whatsapp, cityId: body.trip.city_id, trip, tripRef };
}

const listSchema = pageQuerySchema.extend({
  status: z.enum(MANUAL_QUOTE_STATUSES).optional(),
  assignee: z.union([z.literal("me"), z.literal("unassigned"), uuidSchema.transform((value) => value.toLowerCase())]).optional(),
  contact: z.string().trim().min(1).max(400).optional(),
  // 验收留资（M8-39）：不给是 exclude，只列真实客人的
  acceptance: z.enum(["exclude", "only", "include"]).default("exclude"),
});

const changeSchema = z
  .object({
    status: z.enum(MANUAL_QUOTE_STATUSES).optional(),
    assignee_id: uuidSchema.transform((value) => value.toLowerCase()).nullable().optional(),
  })
  .strict()
  .refine((value) => value.status !== undefined || value.assignee_id !== undefined, { message: "至少改一项（状态或跟进人）" });

const noteSchema = z.object({ note: visibleText(MANUAL_QUOTE_RULES.maxNoteLength) }).strict();

const settingsSchema = z
  .object({
    support_whatsapp: z
      .string()
      .max(60)
      .nullable()
      .transform((value, issue) => {
        if (value === null || value.trim() === "") return null;
        const digits = whatsappDigits(value, { requirePlus: false });
        if (digits === null) issue.addIssue({ code: "custom", message: "请填写带国家码的号码，例如 +81 90 1234 5678（8–15 位数字，国家码不以 0 开头）" });
        return digits;
      }),
    // 页面宽度（M8-28，ADR 0079）：可选，不给是不改
    page_width: z.enum(["standard", "wide", "full"]).optional(),
  })
  .strict();

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

/** 列表、改动之后的应答：没有任何个人信息。 */
function summaryJson(row: ManualQuoteRow): Json {
  return {
    id: row.id,
    request_no: row.requestNo,
    status: row.status,
    category: row.category,
    city: row.city === null ? null : { id: row.city.id, code: row.city.code, name: row.city.name },
    service_local: row.serviceLocal,
    passengers: row.passengers,
    luggage: row.luggage,
    package_hours: row.packageHours,
    has_email: row.hasEmail,
    has_whatsapp: row.hasWhatsapp,
    is_acceptance: row.isAcceptance,
    // 带了行程单（M9T-08）：列表上显示「整张行程单」；行程单编号不给员工页面
    has_trip: row.hasTrip,
    assignee: row.assignee,
    version: row.version,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    finished_at: iso(row.finishedAt),
    purged_at: iso(row.purgedAt),
  };
}

function eventJson(event: ManualQuoteEventView): Json {
  return { id: event.id, kind: event.kind, from_status: event.fromStatus, to_status: event.toStatus, assignee: event.assignee, note: event.note, actor: event.actor, created_at: event.createdAt.toISOString() };
}

function detailJson(detail: ManualQuoteDetail): Json {
  const contact = detail.contact;
  return {
    request: summaryJson(detail.request),
    contact: contact === null ? null : { email: contact.email, whatsapp: contact.whatsapp === null ? null : `+${contact.whatsapp}` },
    pickup: contact === null ? null : contact.pickup,
    dropoff: contact === null ? null : contact.dropoff,
    // 包车的经停点（M9W-04），按顺序；没有经停点、清除后为 null
    waypoints: contact === null || contact.waypoints === undefined || contact.waypoints.length === 0 ? null : contact.waypoints.map((stop) => ({ name: stop.name, lat: stop.lat, lng: stop.lng, stay_minutes: stop.stayMinutes, ...(stop.arriveBy === undefined ? {} : { arrive_by: stop.arriveBy }) })),
    events: detail.events.map(eventJson),
    trip: tripJson(detail.trip),
  };
}

/**
 * 详情里的整张行程单（M9T-08）：每天的点（坐标或平台地点、时间、停留、客人页面上的名称）和当晚过夜点、最近一次报价的各方案（状态、总价）和报不出的原因。
 * 只给员工看：没有结算价、供应商编号，也没有行程单编号（客人的访问凭证）。
 */
function tripJson(view: ManualQuoteTripView): Json | null {
  if (view === null) return null;
  if (view.purged) return { purged: true };
  const { trip } = view;
  const currency = trip.currency as CurrencyCode;
  return {
    purged: false,
    // 行程单编号是客人访问行程单的凭证（bearer）：不给员工页面，数据最少
    plan_kind: view.planKind,
    currency,
    created_at: trip.createdAt.toISOString(),
    readable_until: trip.readableUntil.toISOString(),
    party: { adults: trip.itinerary.party.adults, children: trip.itinerary.party.children, luggage: trip.itinerary.party.luggage },
    days: trip.itinerary.days.map((day, dayIndex) => ({
      date: day.date,
      // 当晚过夜点（只有坐标）；没写为 null
      night_at: day.nightAt === undefined || day.nightAt === null ? null : { lat: day.nightAt.lat, lng: day.nightAt.lng },
      items: day.items.map((item, itemIndex) => {
        const place = isPlaceIdPlace(item.place) ? (view.places.get(item.place.placeId) ?? null) : null;
        const coords = isPlaceIdPlace(item.place) ? place : item.place;
        return {
          kind: item.kind,
          time: item.time ?? null,
          stay_minutes: item.stayMinutes ?? null,
          lat: coords === null ? null : coords.lat,
          lng: coords === null ? null : coords.lng,
          place_id: isPlaceIdPlace(item.place) ? item.place.placeId : null,
          place_name: place === null ? null : place.name,
          label: view.labels?.[dayIndex]?.[itemIndex] ?? null,
        };
      }),
    })),
    quoted_at: view.plans[0]?.quotedAt.toISOString() ?? null,
    plans: view.plans.map((plan) => ({ kind: plan.kind, status: plan.status, recommended: plan.recommended, total: plan.sellMinor === null ? null : salesMoney(plan.sellMinor, currency), expires_at: iso(plan.expiresAt) })),
    unquoted: view.plans.flatMap((plan) => plan.unquoted.map((entry) => ({ plan_kind: plan.kind, day_index: entry.day_index, reason: entry.reason }))),
  };
}

function settingsJson(settings: SiteSettingsRow): Json {
  return { support_whatsapp: settings.supportWhatsapp, page_width: settings.pageWidth, version: settings.version, updated_at: iso(settings.updatedAt), updated_by: settings.updatedBy };
}

export function registerManualQuoteRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post("/site/v1/manual-quote-requests", async (request, reply) => {
    await takeSiteSlot(ctx, "site_manual_quote", { ip: request.ip });
    await takeSiteSlot(ctx, "site_manual_quote_day", { ip: request.ip });
    const body = parseInput(submitSchema, request.body, "body");
    const input = submissionOf(body);
    // 和询价同一个判断：带了验收会话的 Cookie 但会话无效、过期，401，不悄悄按普通客人记（陷阱字段也一样，先判断会话）
    const acceptance = (await siteAudienceOf(ctx, request.headers.cookie)) === "acceptance";
    if (body.website === undefined || body.website === "") await submitManualQuote(ctx, { ...input, acceptance });
    return reply.code(202).send({ status: "accepted" });
  });

  app.get("/platform/v1/manual-quote-requests", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "manual_quote.read" });
    const query = parseInput(listSchema, request.query, "querystring");
    const page = await listManualQuoteRequests(ctx, principal, { status: query.status ?? null, assignee: query.assignee ?? null, contact: query.contact ?? null, acceptance: query.acceptance }, query.limit, decodeTimeCursor(query.cursor ?? null));
    return { items: page.items.map(summaryJson), next_cursor: page.nextCursor, counts: page.counts };
  });

  app.get("/platform/v1/manual-quote-requests/assignees", async (request) => {
    await authenticatePlatform(ctx, platformCredentials(request), { action: "manual_quote.manage" });
    return { items: await listManualQuoteAssignees(ctx) };
  });

  app.get("/platform/v1/manual-quote-requests/:id", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "manual_quote.read" });
    return detailJson(await getManualQuoteRequest(ctx, principal, request.ip, resourceId(request.params, "人工报价申请")));
  });

  app.patch("/platform/v1/manual-quote-requests/:id", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "manual_quote.manage" });
    const id = resourceId(request.params, "人工报价申请");
    const version = ifMatchVersion(request.headers["if-match"]);
    const body = parseInput(changeSchema, request.body ?? {}, "body");
    const change = { ...(body.status === undefined ? {} : { status: body.status }), ...(body.assignee_id === undefined ? {} : { assigneeId: body.assignee_id }) };
    return { request: summaryJson(await changeManualQuoteRequest(ctx, principal, request.ip, id, version, change)) };
  });

  app.post("/platform/v1/manual-quote-requests/:id/notes", async (request, reply) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "manual_quote.manage" });
    const id = resourceId(request.params, "人工报价申请");
    const body = parseInput(noteSchema, request.body, "body");
    return reply.code(201).send({ event: eventJson(await addManualQuoteNote(ctx, principal, request.ip, id, body.note)) });
  });

  app.get("/platform/v1/site-settings", async (request) => {
    await authenticatePlatform(ctx, platformCredentials(request), { action: "site_settings.read" });
    return settingsJson(await getSiteSettings(ctx));
  });

  app.put("/platform/v1/site-settings", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "site_settings.manage" });
    const body = parseInput(settingsSchema, request.body, "body");
    const header = request.headers["if-match"];
    return settingsJson(await updateSiteSettings(ctx, principal, request.ip, body.support_whatsapp, body.page_width ?? null, header === undefined ? null : ifMatchVersion(header)));
  });
}
