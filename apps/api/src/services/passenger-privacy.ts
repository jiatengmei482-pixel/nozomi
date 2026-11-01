/**
 * 运营看乘客的完整联系方式（M4-19，ADR 0052；需求《平台运营端》「个人信息保护」：默认打码，点「查看」才显示全文并记日志）。
 * 权限和数据范围由接口层检查（`order.read`、`assertPlatformOrderInScope`）。审计只记看了谁的，不记联系方式本身。
 */
import type { PassengerContact } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { withPlatformTx } from "../db/context.ts";
import { insertAuditLog } from "../repos/audit-logs.ts";
import { findOrderForPlatform } from "../repos/orders.ts";
import { consoleOrigin, platformActor } from "./audit.ts";
import { notFound } from "./errors.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";

export async function revealPassenger(ctx: AppContext, principal: PlatformPrincipal, orderId: string, ip: string): Promise<PassengerContact> {
  return withPlatformTx(ctx.pool, async (db) => {
    const order = await findOrderForPlatform(db, orderId);
    if (order === null) throw notFound("订单");
    await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, ctx.now()), { tenantId: null, resource: "order", resourceId: orderId, action: "view_passenger", before: null, after: { order_no: order.orderNo, fields: ["name", "phone", "email"] } });
    return { name: order.passenger.name, phone: order.passenger.phone, email: order.passenger.email };
  });
}
