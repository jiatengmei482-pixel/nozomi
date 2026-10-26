/**
 * 派车、司机 H5、Webhook 的集成测试共用的搭建（M3-02）：在 testing/market.ts 的市场上直接写入已付款的订单（下单和付款的全流程在 orders.itest.ts），
 * 经真实接口建司机和车辆，起一个本机的假接收方收 Webhook。数据都在测试里构造，测试结束随 schema 一起删除（规则 1）。
 */
import { randomInt, randomUUID } from "node:crypto";
import { type IncomingHttpHeaders, type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { ORDER_NO_ALPHABET, dispatchDeadline } from "@nozomi/domain";
import { type ApiResponse, LOCAL_WEBHOOK_HOST, type TenantFixture, type TestApi } from "./api.ts";
import { type Market, ok } from "./market.ts";

export interface SeedOrderOptions {
  serviceAt: Date;
  confirmedAt?: Date;
  direction?: "pickup" | "dropoff";
  flightNo?: string | null;
  vehicleGroupId?: string;
  driverLanguage?: string | null;
  freeWaitMinutes?: number | null;
  status?: string;
}

export interface SeededOrder {
  id: string;
  orderNo: string;
  tenantId: string;
}

function orderNo(at: Date): string {
  let random = "";
  for (let i = 0; i < 8; i += 1) random += ORDER_NO_ALPHABET[randomInt(ORDER_NO_ALPHABET.length)];
  return `NZ${at.toISOString().slice(0, 10).replaceAll("-", "")}${random}`;
}

/** 写入一张已付款（已确认）的成田接机单：机场那一端没有坐标，市区那一端是东京站。 */
export async function seedOrder(api: TestApi, market: Market, side: "a" | "b", options: SeedOrderOptions): Promise<SeededOrder> {
  const tenant = market[side];
  const productId = side === "a" ? market.ids.pa : market.ids.pb;
  const confirmedAt = options.confirmedAt ?? api.clock.now();
  const createdAt = new Date(confirmedAt.getTime() - 60_000);
  const direction = options.direction ?? "pickup";
  const id = randomUUID();
  const no = orderNo(createdAt);
  const local = new Date(options.serviceAt.getTime() + 9 * 3_600_000).toISOString().slice(0, 16);
  const settlement = { currency: "JPY", roundingUnit: 1, totalMinor: 20_000, baseMinor: 20_000, adjustMinor: 0, urgentMinor: 0, nightMinor: 0, addonsMinor: 0, driverLanguageMinor: 0 };
  const city = { lng: 139.7671, lat: 35.6812, address: "东京站八重洲口" };
  await api.db.owner.query(
    `insert into orders (tenant_id, id, order_no, status, category, city_id, place_id, direction, product_id, product_version, vehicle_group_id, service_at, service_local, timezone, service_date,
                         urgent, passengers, luggage, pickup, dropoff, addons, driver_language, flight_no, passenger, settlement_minor, settlement_currency, settlement, free_wait_minutes,
                         inventory_held, payment_due_at, confirmed_at, dispatch_due_at, created_at, updated_at)
     values ($1, $2, $3, $4, 'airport_transfer', $5, $6, $7, $8, 1, $9, $10, $11, 'Asia/Tokyo', $12,
             false, 2, 1, $13::jsonb, $14::jsonb, '[]'::jsonb, $15, $16, $17::jsonb, 20000, 'JPY', $18::jsonb, $19,
             false, $20, $21, $22, $23, $21)`,
    [
      tenant.tenantId, id, no, options.status ?? "confirmed", market.ids.tokyo, market.ids.narita, direction, productId, options.vehicleGroupId ?? market.ids.biz7, options.serviceAt, local, local.slice(0, 10),
      direction === "dropoff" ? JSON.stringify(city) : null, direction === "pickup" ? JSON.stringify(city) : null, options.driverLanguage ?? null,
      options.flightNo === undefined ? (direction === "pickup" ? "NH211" : null) : options.flightNo,
      JSON.stringify({ name: "王小明", phone: "+819012345678", email: "guest@example.com" }), JSON.stringify(settlement),
      options.freeWaitMinutes === undefined ? 90 : options.freeWaitMinutes, new Date(createdAt.getTime() + 30 * 60_000), confirmedAt, dispatchDeadline(confirmedAt, options.serviceAt), createdAt,
    ],
  );
  return { id, orderNo: no, tenantId: tenant.tenantId };
}

/** 成田机场的坐标（主数据里的）：接机单的上车点。 */
export const NARITA = { lng: 140.3887, lat: 35.7686 };

export async function newDriver(api: TestApi, who: TenantFixture, extra: Record<string, unknown> = {}): Promise<any> {
  return ok(
    api.call("POST", "/tenant/v1/drivers", {
      token: who.adminToken,
      headers: { "idempotency-key": randomUUID() },
      body: { name: `司机-${randomUUID().slice(0, 6)}`, phone: `+8190${String(randomInt(10_000_000, 99_999_999))}`, languages: ["ja", "zh"], license_expires_on: "2030-01-01", driving_years: 12, gold: false, ...extra },
    }),
    201,
  );
}

/** 同一个供应商的车牌不能重复：按顺序发号（起点随机），同一个测试进程里不会撞号 */
let plateSeq = randomInt(1000, 9000);
const nextPlate = (): string => `品川 300 あ ${String(1000 + (plateSeq++ % 9000))}`;

export async function newVehicle(api: TestApi, who: TenantFixture, vehicleGroupId: string, extra: Record<string, unknown> = {}): Promise<any> {
  return ok(
    api.call("POST", "/tenant/v1/vehicles", {
      token: who.adminToken,
      headers: { "idempotency-key": randomUUID() },
      body: {
        plate: nextPlate(),
        vehicle_group_id: vehicleGroupId,
        model: "丰田埃尔法",
        color: "黑",
        seats: 7,
        mileage_km: 30_000,
        plate_type: "business",
        insurance_expires_on: "2030-01-01",
        inspection_expires_on: "2030-01-01",
        ...extra,
      },
    }),
    201,
  );
}

/** 当前的订单版本（派车要用 If-Match 带上）。 */
export async function orderVersion(api: TestApi, who: TenantFixture, orderId: string): Promise<number> {
  return (await ok(api.call("GET", `/tenant/v1/orders/${orderId}`, { token: who.adminToken }))).order.version;
}

export async function assign(api: TestApi, who: { adminToken: string } | { token: string }, orderId: string, driverId: string, vehicleId: string, options: { version?: number; confirmConflicts?: boolean } = {}): Promise<ApiResponse> {
  const token = "adminToken" in who ? who.adminToken : who.token;
  const version = options.version ?? (await ok(api.call("GET", `/tenant/v1/orders/${orderId}`, { token }))).order.version;
  return api.call("POST", `/tenant/v1/orders/${orderId}/assign`, { token, headers: { "if-match": `"${version}"` }, body: { driver_id: driverId, vehicle_id: vehicleId, ...(options.confirmConflicts ? { confirm_conflicts: true } : {}) } });
}

// ---- 本机的假接收方 ----

export interface ReceivedWebhook {
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}

export interface FakeReceiver {
  /** 填进供应商后台的地址：https + 公网形状的名字（经接口保存时只认这种）；测试的发送器把它换成本机的端口（testing/api.ts 的 `localWebhookSender`） */
  url: string;
  /** 真正监听的地址 */
  localUrl: string;
  received: ReceivedWebhook[];
  /** 下一次（及之后）怎么应答：状态码；`hang` 表示不应答 */
  respond(statuses: (number | "hang")[]): void;
  close(): Promise<void>;
}

export async function startFakeReceiver(): Promise<FakeReceiver> {
  const received: ReceivedWebhook[] = [];
  let plan: (number | "hang")[] = [200];
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    req.on("end", () => {
      received.push({ path: req.url ?? "", headers: req.headers, body });
      const next = plan.length > 1 ? plan.shift() : plan[0];
      if (next === "hang") return;
      res.writeHead(next ?? 200, { "content-type": "text/plain" }).end("ok");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `https://${LOCAL_WEBHOOK_HOST}:${port}/nozomi/webhook`,
    localUrl: `http://127.0.0.1:${port}/nozomi/webhook`,
    received,
    respond: (statuses) => {
      plan = [...statuses];
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
