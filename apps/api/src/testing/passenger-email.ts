/**
 * 运营代改乘客邮箱要另一位同事批准（M4-31，ADR 0065）。测加密、打码、保留期限的老测试改乘客信息时，用这里走完整的
 * 「发起复核 → 另一位运营批准」：结果和以前一样是订单上的乘客信息全部换成新的，只是邮箱那一项多经过了一次审核。
 * 审核人是测试里造的一位虚构运营（每个测试库一位，由超级管理员 root@platform.test 邀请，见 `buildMarket`）。
 */
import assert from "node:assert/strict";
import type { ApiResponse, TestApi } from "./api.ts";
import { addStaff } from "./market.ts";
import { platformLogin } from "./money.ts";

export const EMAIL_REVIEW = { verification: "callback_phone", reason: "测试：回拨下单电话确认是本人" } as const;

const approvers = new WeakMap<TestApi, Promise<string>>();

/** 这个测试库里能批改邮箱的第二位运营（邮箱）。 */
function approverEmail(api: TestApi): Promise<string> {
  let found = approvers.get(api);
  if (found === undefined) {
    found = (async () => (await addStaff(api, await platformLogin(api, "root@platform.test"), "email-review.approver@platform.test", "operations")).email)();
    approvers.set(api, found);
  }
  return found;
}

/**
 * 运营代改单（`If-Match` 用订单现在的版本）。`body.passenger.email` 和订单上的不是同一个地址时自动带上核实方式，
 * 再由另一位运营批准，返回 PATCH 的应答（200 或只改了邮箱时的 202）。
 */
export async function platformChangeWithEmailReview(api: TestApi, orderId: string, token: string, body: Record<string, unknown>, ifMatch?: string): Promise<ApiResponse> {
  const version = ifMatch ?? String((await api.call("GET", `/platform/v1/orders/${orderId}`, { token })).body.order.version);
  const first = await api.call("PATCH", `/platform/v1/orders/${orderId}`, { token, headers: { "if-match": version }, body });
  const needsReview = first.status === 400 && first.body?.error?.details?.issues?.some((issue: { path: string; reason?: string }) => issue.path === "/email_review");
  const res = needsReview ? await api.call("PATCH", `/platform/v1/orders/${orderId}`, { token, headers: { "if-match": version }, body: { ...body, email_review: EMAIL_REVIEW } }) : first;
  const approvalId = res.body?.email_review?.approval_id;
  if ((res.status === 200 || res.status === 202) && typeof approvalId === "string") {
    const approved = await api.call("POST", `/platform/v1/approvals/${approvalId}/approve`, { token: await platformLogin(api, await approverEmail(api)), body: {} });
    assert.equal(approved.status, 200, `批准改邮箱：${approved.text}`);
  }
  return res;
}
