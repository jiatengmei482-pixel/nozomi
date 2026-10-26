/**
 * 取消、改单、事后加收的集成测试共用的搭建（M3-03）：经真实接口下单付款（testing/sales-flow.ts）、派车并履约到完成、
 * 平台员工和供应商重新登录（测试里时钟一拨就是几天，令牌会过期）。数据都在测试里构造，测试结束随 schema 一起删除（规则 1）。
 */
import { TEST_PASSWORD, type TestApi } from "./api.ts";
import { assign, newDriver, newVehicle } from "./dispatch.ts";
import { type Market, ok } from "./market.ts";

/** 平台员工重新登录（令牌 8 小时过期）。 */
export async function platformLogin(api: TestApi, email: string): Promise<string> {
  return (await ok(api.platformLogin({ body: { email, password: TEST_PASSWORD } }))).access_token;
}

/** 供应商用户重新登录。 */
export async function tenantLogin(api: TestApi, email: string): Promise<string> {
  return (await ok(api.call("POST", "/tenant/v1/auth/login", { body: { email, password: TEST_PASSWORD } }))).access_token;
}

/** 派车、出发、到达、接到客人、完成（供应商后台的接口）。 */
export async function completeOrder(api: TestApi, m: Market, side: "a" | "b", orderId: string, until: "assigned" | "in_service" | "completed" = "completed"): Promise<void> {
  const who = { ...m[side], adminToken: await tenantLogin(api, m[side].adminEmail) };
  await ok(assign(api, who, orderId, (await newDriver(api, who)).id, (await newVehicle(api, who, m.ids.biz7)).id));
  if (until === "assigned") return;
  for (const type of ["departed", "arrived", "picked_up"]) await ok(api.call("POST", `/tenant/v1/orders/${orderId}/events`, { token: who.adminToken, body: { type } }));
  if (until === "in_service") return;
  await ok(api.call("POST", `/tenant/v1/orders/${orderId}/events`, { token: who.adminToken, body: { type: "completed" } }));
}

/** 一张 JPEG（格式按开头的字节判断，内容是什么不重要）。 */
export const RECEIPT_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);

/** 供应商后台上传一张票据，返回照片编号。 */
export async function uploadReceipt(api: TestApi, token: string, orderId: string): Promise<string> {
  const res = await api.app.inject({ method: "POST", url: `/tenant/v1/orders/${orderId}/files?kind=receipt`, headers: { authorization: `Bearer ${token}`, "content-type": "image/jpeg" }, payload: RECEIPT_JPEG });
  if (res.statusCode !== 201) throw new Error(`上传票据失败：${res.statusCode} ${res.body}`);
  return (res.json() as { file: { id: string } }).file.id;
}
