/**
 * 经销售端真实接口下一张单并付款（询价 → 下单 → Stripe 通知付款成功 → 自动确认），给需要「真的付过款的订单」的集成测试用（M3-02）。
 * 收款服务用替身（testing/payments.ts），通知按 Stripe 的格式和签名算法现场生成。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestApi } from "./api.ts";
import { DROPOFF, type Market, SERVICE_TIME, newChannel, ok, salesCredentials } from "./market.ts";
import { type FakePaymentProvider, deliverWebhook } from "./payments.ts";

export interface SalesFlow {
  channelId: string;
  /** 现在可用的渠道令牌（2 小时过期，过了 1 小时自动重新换） */
  token(): Promise<string>;
  /** 询价、下单、付款：返回付过款的订单（渠道看到的）。商务 7 座：乙 19,800 比甲 20,000 便宜，乙中标 */
  paidOrder(options?: { vehicleGroupId?: string; serviceTime?: string }): Promise<any>;
}

export async function salesFlow(api: TestApi, market: Market, pay: FakePaymentProvider): Promise<SalesFlow> {
  const channelId = (await newChannel(api, market.staff.cm1.token, { name: `官网-${randomUUID().slice(0, 4)}` })).id;
  const creds = await salesCredentials(api, market, channelId);
  let token = creds.token;
  let issuedAt = api.clock.now().getTime();
  const current = async (): Promise<string> => {
    if (api.clock.now().getTime() - issuedAt > 3_600_000) {
      api.clock.advance(1_000);
      token = (await ok(api.call("POST", "/sales/v1/oauth/token", { ip: "198.51.100.10", body: { grant_type: "client_credentials", client_id: creds.clientId, client_secret: creds.secret } }))).access_token;
      issuedAt = api.clock.now().getTime();
    }
    return token;
  };
  return {
    channelId,
    token: current,
    async paidOrder(options = {}) {
      const vehicleGroupId = options.vehicleGroupId ?? market.ids.biz7;
      api.clock.advance(1_000);
      const quoted = await ok(
        api.call("POST", "/sales/v1/quotes", {
          token: await current(),
          body: { city_id: market.ids.tokyo, category: "airport_transfer", place_id: market.ids.narita, direction: "pickup", dropoff: DROPOFF, service_time: options.serviceTime ?? SERVICE_TIME, passengers: 2, luggage: 1, currency: "JPY", vehicle_group_ids: [vehicleGroupId] },
        }),
      );
      const quote = quoted.quotes.find((q: any) => q.vehicle_group_id === vehicleGroupId);
      assert.ok(quote, JSON.stringify(quoted));
      api.clock.advance(1_000);
      const created = await ok(
        api.call("POST", "/sales/v1/orders", {
          token: await current(),
          headers: { "idempotency-key": randomUUID() },
          body: { quote_id: quote.quote_id, passenger: { name: "王小明", phone: "+81 90-1234-5678", email: "guest@example.com" }, flight_no: "NH 211", dropoff_address: "东京站八重洲口", save_payment_method: true },
        }),
        201,
      );
      const intent = pay.intentOf(created.order.id);
      assert.ok(intent);
      pay.pay(intent.id);
      const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
      const res = await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      return created.order;
    },
  };
}
