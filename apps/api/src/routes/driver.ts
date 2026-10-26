/**
 * 司机 H5 的接口（M3-02，ADR 0027）：`/driver/v1/trip…`。司机没有账号，凭派车时生成的链接里的令牌（`Authorization: Bearer nzd_…`）。
 * 这里只做校验、调用、返回；规则在 services/driver-trip.ts。令牌无效、吊销、过期一律 401 `DRIVER_LINK_INVALID`。
 *
 * 应答里**没有任何价格**（规则 4 之外更严：结算价也不给司机看）；只有司机干活要用的：乘客、电话、航班、上下车点、时间、附加服务、备注、调度电话。
 * 照片按原始字节上传（`Content-Type: image/jpeg` 等，最大 5 MB），不用 multipart。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { EVIDENCE_FILE_RULES, NO_SHOW_ITEM_NAMES, ORDER_STATUS_NAMES, freeWaitEnded } from "@nozomi/domain";
import { bearerToken } from "../auth/token.ts";
import { tenantIdOfDriverToken } from "../auth/driver-token.ts";
import type { AppContext } from "../context.ts";
import { type TripView, addDriverContact, driverLinkInvalid, getTrip, readDriverFile, reportDriverEvent, reportDriverLanding, reportDriverLocation, requestLeave, submitNoShow, uploadDriverFile } from "../services/driver-trip.ts";
import { landingJson } from "../services/order-views.ts";
import { dateTimeSchema, parseInput, resourceId, uuidSchema } from "../validation.ts";
import { fileJson, sendFile } from "./orders.ts";
import { fulfilmentSchema, locationSchema, toLocation } from "./dispatch.ts";

const fileQuerySchema = z.object({ kind: z.enum(["arrival_screen", "signboard", "contact_screenshot"]) });
const landingSchema = z.object({ landed_at: dateTimeSchema, file_id: uuidSchema });
const contactSchema = z.object({ method: z.enum(["phone", "messaging"]), note: z.string().trim().max(200).nullable().default(null), file_id: uuidSchema.nullable().default(null) });
const locationBodySchema = z.object({ location: locationSchema.nullable().default(null) });
const pingSchema = z.object({ location: locationSchema });

const iso = (date: Date | null): string | null => date?.toISOString() ?? null;

/** 司机页面看到的这一单。没有任何金额。 */
function tripJson(view: TripView): Record<string, unknown> {
  const { order } = view;
  const d = order.dispatch;
  return {
    order: {
      order_no: order.orderNo,
      status: order.status,
      status_name: ORDER_STATUS_NAMES[order.status],
      category: order.category,
      direction: order.direction,
      service_time: order.serviceAt.toISOString(),
      service_local: order.serviceLocal,
      timezone: order.timezone,
      package_hours: order.packageHours,
      passengers: order.passengers,
      luggage: order.luggage,
      flight_no: order.flightNo,
      passenger: { name: order.passenger.name, phone: order.passenger.phone },
      messaging: order.messaging,
      notes: order.notes,
      place: view.place === null ? null : { name: view.place.name, code: view.place.code, lng: view.place.lng, lat: view.place.lat },
      pickup: order.pickup,
      dropoff: order.dropoff,
      pickup_point: view.pickup,
      addons: order.addons.map((addon) => ({ addon_id: addon.addonId, quantity: addon.quantity, name: view.addonNames.get(addon.addonId) ?? null })),
      driver_language: order.driverLanguage,
      free_wait_minutes: order.freeWaitMinutes,
    },
    driver: view.driver === null ? null : { name: view.driver.name },
    vehicle: view.vehicle === null ? null : { plate: view.vehicle.plate, model: view.vehicle.model, color: view.vehicle.color },
    dispatchers: view.dispatchers,
    fulfilment: {
      departed_at: iso(d.departedAt),
      arrived_at: iso(d.arrivedAt),
      arrival_distance_m: d.arrivalDistanceM,
      picked_up_at: iso(d.pickedUpAt),
      completed_at: iso(d.completedAt),
      leave_requested_at: iso(d.leaveRequestedAt),
    },
    landing: landingJson(order),
    free_wait: { start: view.freeWait.start.toISOString(), end: iso(view.freeWait.end), ended: freeWaitEnded(view.freeWait, view.now) },
    contacts: view.contacts.map((contact) => ({ id: contact.id, method: contact.method, note: contact.note, file_id: contact.fileId, occurred_at: contact.occurredAt.toISOString() })),
    files: view.files.map(fileJson),
    no_show: {
      checklist: view.checklist.items.map((entry) => ({ item: entry.item, name: NO_SHOW_ITEM_NAMES[entry.item], ok: entry.ok })),
      complete: view.checklist.complete,
      leave_consent_at: iso(view.checklist.leaveConsentAt),
      submitted_at: iso(view.claim?.submittedAt ?? null),
    },
    link: { expires_at: view.link.expiresAt.toISOString() },
    server_time: view.now.toISOString(),
  };
}

export function registerDriverRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** 先看令牌的格式再看请求体：拿着不是司机链接的令牌来，先得到 401，不会先拿到请求体的校验结果。完整核对（存在、吊销、过期）在 services/driver-trip.ts。 */
  const token = (request: FastifyRequest): string => {
    const value = bearerToken(request.headers.authorization);
    if (value === null || tenantIdOfDriverToken(value) === null) throw driverLinkInvalid();
    return value;
  };

  app.get("/driver/v1/trip", async (request) => tripJson(await getTrip(ctx, token(request))));

  app.post("/driver/v1/trip/events", async (request) => {
    const driverToken = token(request);
    const input = parseInput(fulfilmentSchema, request.body, "body");
    return tripJson(await reportDriverEvent(ctx, driverToken, { type: input.type, location: toLocation(input.location), actual: input.actual }));
  });

  app.post("/driver/v1/trip/locations", async (request, reply) => {
    const driverToken = token(request);
    const input = parseInput(pingSchema, request.body, "body");
    await reportDriverLocation(ctx, driverToken, toLocation(input.location) as NonNullable<ReturnType<typeof toLocation>>);
    return reply.code(204).send();
  });

  app.post("/driver/v1/trip/landing", async (request) => {
    const driverToken = token(request);
    const input = parseInput(landingSchema, request.body, "body");
    return tripJson(await reportDriverLanding(ctx, driverToken, { landedAt: input.landed_at, fileId: input.file_id.toLowerCase() }));
  });

  app.post("/driver/v1/trip/contacts", async (request) => {
    const driverToken = token(request);
    const input = parseInput(contactSchema, request.body, "body");
    return tripJson(await addDriverContact(ctx, driverToken, { method: input.method, note: input.note === "" ? null : input.note, fileId: input.file_id?.toLowerCase() ?? null }));
  });

  app.post("/driver/v1/trip/request-leave", async (request) => {
    const driverToken = token(request);
    const input = parseInput(locationBodySchema, request.body ?? {}, "body");
    return tripJson(await requestLeave(ctx, driverToken, toLocation(input.location)));
  });

  app.post("/driver/v1/trip/no-show", async (request) => {
    const driverToken = token(request);
    const input = parseInput(locationBodySchema, request.body ?? {}, "body");
    return tripJson(await submitNoShow(ctx, driverToken, toLocation(input.location)));
  });

  app.get("/driver/v1/trip/files/:id", async (request, reply) => {
    const id = resourceId(request.params, "照片");
    return sendFile(reply, await readDriverFile(ctx, token(request), id));
  });

  // 照片按原始字节上传：只在这一个接口上认图片类型，上限 5 MB（再大 413）
  app.register(async (scoped) => {
    for (const type of EVIDENCE_FILE_RULES.contentTypes) scoped.addContentTypeParser(type, { parseAs: "buffer", bodyLimit: EVIDENCE_FILE_RULES.maxBytes }, (_request, body, done) => done(null, body));
    scoped.post("/driver/v1/trip/files", async (request, reply) => {
      const driverToken = token(request);
      const query = parseInput(fileQuerySchema, request.query, "querystring");
      const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      const file = await uploadDriverFile(ctx, driverToken, query.kind, request.headers["content-type"], body);
      return reply.code(201).send({ file: fileJson(file) });
    });
  });
}
