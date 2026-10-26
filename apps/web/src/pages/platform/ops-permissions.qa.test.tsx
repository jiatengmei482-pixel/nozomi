/**
 * M4-03 测试角色：运营后台订单中心、工单、赔付表、财务结算页面的权限矩阵。
 * - 10 个内置角色逐个打开每一页：看得到的页面 / 「你没有权限查看这里」、每个会改数据的按钮出不出现。期望值按 ADR 0034、0040 的权限表写死在这里
 *   （不从 @nozomi/domain 推，免得权限表本身写错时页面和测试一起错）；
 * - 自建角色只勾部分格：按 `auth/me` 的操作清单；
 * - 限定了数据范围的员工：异常、工单范围外 404 →「找不到」，财务结算 403 DATA_SCOPE_DENIED → 说明为什么不能看，都不报「加载失败」。
 * 接口用测试替身。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { screen } from "@testing-library/react";
import { PLATFORM_ROLES } from "@nozomi/domain";
import type { PayoutBatchDetail } from "../../api/billing.ts";
import { BATCH_ID, COLLEAGUE, EXCEPTION_ID, ORDER_ID, STATEMENT_ID, TICKET_ID, compensationOf, exceptionOf, openApp, platformStatementDetailOf, platformStatementOf, platformTicketDetailOf, platformTicketOf } from "../../testing/order-center-fixtures.tsx";
import { type ApiCall, apiError, json, resetBrowser } from "../../testing/harness.tsx";

afterEach(resetBrowser);

type Ability = "order.read" | "exception.manage" | "ticket.read" | "ticket.manage" | "payment.manage" | "compensation_table.manage" | "statement.read" | "statement.manage" | "master_data.read";

/** ADR 0034「权限（新增）」、ADR 0040「权限」两张表。 */
const WHO: Record<Ability, readonly string[]> = {
  "order.read": ["super_admin", "operations", "customer_service", "finance", "risk", "readonly"],
  "exception.manage": ["super_admin", "operations", "customer_service", "finance"],
  "ticket.read": ["super_admin", "operations", "customer_service", "finance", "risk", "readonly"],
  "ticket.manage": ["super_admin", "operations", "customer_service"],
  "payment.manage": ["super_admin", "operations", "finance"],
  "compensation_table.manage": ["super_admin", "operations"],
  "statement.read": ["super_admin", "finance", "readonly"],
  "statement.manage": ["super_admin", "finance"],
  "master_data.read": PLATFORM_ROLES.map((role) => role.key),
};

const NO_ACCESS = "你没有权限查看这里";

const batch: PayoutBatchDetail = {
  id: BATCH_ID,
  pay_date: "2026-10-20",
  status: "open",
  created_at: "2026-10-09T00:00:00.000Z",
  closed_at: null,
  closed_by: null,
  paid_at: null,
  statement_count: 1,
  totals: [{ currency: "JPY", count: 1, total: { amount: "38600", currency: "JPY" } }],
  version: 1,
  statements: [platformStatementOf({ status: "in_payout", payout_batch_id: BATCH_ID, payout_on: "2026-10-20" })],
};

const decidedTicket = platformTicketDetailOf(platformTicketOf({ status: "decided", outcome: "upheld", liable_party: "tenant", decided_at: "2026-10-08T00:00:00.000Z", decided_by: COLLEAGUE, decision_note: "迟到属实" }), {
  compensation: { ...compensationOf(), reimbursement_claimed: { amount: "3000", currency: "JPY" }, reimbursement: { amount: "3000", currency: "JPY" }, manual_payout: { amount: "3000", currency: "JPY" }, payout_status: "pending" },
});

/** 运营后台这几页用到的全部接口（成功的样子）。 */
function backend(ticketDetail = platformTicketDetailOf(platformTicketOf({ assignee_id: COLLEAGUE }))) {
  return (call: ApiCall & { url: URL }): Response | null => {
    if (call.method !== "GET") return null;
    const path = call.url.pathname;
    if (path === `/platform/v1/exceptions/${EXCEPTION_ID}`) return json(200, { exception: exceptionOf() });
    if (path === "/platform/v1/exceptions") return json(200, { items: [exceptionOf()], next_cursor: null, total: 1 });
    if (path === "/platform/v1/tickets") return json(200, { items: [platformTicketOf()], next_cursor: null, total: 1 });
    if (path === `/platform/v1/tickets/${TICKET_ID}`) return json(200, ticketDetail);
    if (path === "/platform/v1/statements") return json(200, { items: [platformStatementOf()], next_cursor: null, total: 1 });
    if (path === `/platform/v1/statements/${STATEMENT_ID}`) return json(200, { statement: platformStatementDetailOf(platformStatementOf({ status: "disputed", disputed_at: "2026-10-09T00:00:00.000Z", dispute_reason: "少了一单" })) });
    if (path === `/platform/v1/payout-batches/${BATCH_ID}`) return json(200, { batch });
    if (path === "/platform/v1/payout-batches") return json(200, { items: [batch] });
    return null;
  };
}

/** 按钮或做成按钮样子的链接（「新建工单」）。 */
async function shown(name: string): Promise<boolean> {
  return screen.queryByRole("button", { name }) !== null || screen.queryByRole("link", { name }) !== null;
}

/** 打开一页，等它定下来（看得到 `ready` 的文字或「没有权限」），返回是不是「没有权限」。 */
async function open(path: string, role: string, ready: string | RegExp, permissions: string[] = [], routes = backend()): Promise<boolean> {
  openApp(path, "platform", role, routes, permissions);
  const settled = await screen.findAllByText((_content, element) => {
    const text = element?.textContent ?? "";
    return element?.children.length === 0 && (text === NO_ACCESS || (typeof ready === "string" ? text === ready : ready.test(text)));
  });
  assert.ok(settled.length > 0);
  return screen.queryByText(NO_ACCESS) !== null;
}

function expectButtons(role: string, page: string, buttons: Record<string, boolean>): Promise<void> {
  return (async () => {
    for (const [name, want] of Object.entries(buttons)) assert.equal(await shown(name), want, `${role} 在${page}：「${name}」${want ? "应该有" : "不该有"}`);
  })();
}

for (const { key: role, name: roleName } of PLATFORM_ROLES) {
  const can = (ability: Ability): boolean => WHO[ability].includes(role);

  test(`内置角色「${roleName}」：异常、工单、赔付表、财务结算各页看不看得到，每个会改数据的按钮出不出现，都按权限表`, async () => {
    // 异常详情（待处理）
    let denied = await open(`/platform/exceptions/${EXCEPTION_ID}`, role, "电话催租户；用车前 6 小时仍未派车，自动进入救援改派");
    assert.equal(denied, !can("order.read"), `${roleName}：异常详情`);
    if (!denied) await expectButtons(roleName, "异常详情", { 认领: can("exception.manage"), 指派给同事: can("exception.manage"), 写说明并关闭: can("exception.manage") });
    resetBrowser();

    // 工单列表
    denied = await open("/platform/tickets", role, "司机迟到 25 分钟");
    assert.equal(denied, !can("ticket.read"), `${roleName}：工单列表`);
    if (!denied) await expectButtons(roleName, "工单列表", { 新建工单: can("ticket.manage") });
    resetBrowser();

    // 新建工单：没有 ticket.manage 直接打开地址
    denied = await open(`/platform/tickets/new?order=${ORDER_ID}`, role, /^(新建工单|按订单号查找|类型)/);
    assert.equal(denied, !can("ticket.manage"), `${roleName}：新建工单`);
    resetBrowser();

    // 工单详情（处理中，同事在处理，渠道提的）
    denied = await open(`/platform/tickets/${TICKET_ID}`, role, "客人说司机 10:25 才到。");
    assert.equal(denied, !can("ticket.read"), `${roleName}：工单详情`);
    if (!denied) {
      const manage = can("ticket.manage");
      await expectButtons(roleName, "工单详情", { 改由我处理: manage, 交给同事: manage, 征求供应商意见: manage, 判定: manage, 关闭工单: manage, 发给供应商: manage, 回复客人: manage, 加备注: manage });
    }
    resetBrowser();

    // 工单详情（已判定、待财务另付）：登记另付已付只看 payment.manage
    denied = await open(`/platform/tickets/${TICKET_ID}`, role, "客人说司机 10:25 才到。", [], backend(decidedTicket));
    if (!denied) await expectButtons(roleName, "已判定的工单", { 登记另付已付: can("payment.manage"), 关闭工单: can("ticket.manage"), 加备注: can("ticket.manage"), 回复客人: can("ticket.manage"), 发给供应商: false, 判定: false });
    resetBrowser();

    // 账单列表、详情（有异议）、付款批次
    denied = await open("/platform/finance/statements", role, "ST202609ABCDEFGH");
    assert.equal(denied, !can("statement.read"), `${roleName}：账单列表`);
    if (!denied) await expectButtons(roleName, "账单列表", { 手工出账: can("statement.manage") });
    resetBrowser();
    denied = await open(`/platform/finance/statements/${STATEMENT_ID}`, role, /少了一单/);
    assert.equal(denied, !can("statement.read"), `${roleName}：账单详情`);
    if (!denied) await expectButtons(roleName, "账单详情", { 答复异议: can("statement.manage"), 作废并重出: can("statement.manage"), 发起付款复核: false });
    resetBrowser();
    denied = await open(`/platform/finance/payout-batches/${BATCH_ID}`, role, "JPY 38,600（1 张）");
    assert.equal(denied, !can("statement.read"), `${roleName}：付款批次`);
    if (!denied) await expectButtons(roleName, "付款批次", { 锁定批次: can("statement.manage") });
  });
}

test("赔付表：10 个内置角色都看得到；只有超级管理员、运营有「修改赔付表」", async () => {
  const scenario = (key: string, name: string, bp: number) => ({ scenario: key, name, customer_bp: bp, full_refund: key === "driver_no_show", reimbursement: key === "driver_no_show", downgrade_difference: key === "vehicle_downgrade" });
  const table = {
    version: 0,
    effective_at: null,
    scenarios: [scenario("late_15_29", "司机迟到 15–29 分钟", 1000), scenario("late_30_plus", "司机迟到 30 分钟及以上", 5000), scenario("driver_no_show", "司机未到", 10_000), scenario("vehicle_downgrade", "车型降级", 2000), scenario("no_signboard", "未举牌（商品含举牌）", 1000), scenario("not_delivered", "没送到目的地", 2500), scenario("service_complaint", "车况、司机态度投诉成立", 1000)],
    minimum_jpy: 500,
    reimbursement_cap_bp: 15_000,
    review_at_or_above_sell_bp: 5000,
  };
  for (const { key: role, name } of PLATFORM_ROLES) {
    const denied = await open("/platform/compensation-table", role, /每笔至少/, [], (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/compensation-table" ? json(200, { compensation_table: table }) : null));
    assert.equal(denied, false, `${name} 应该看得到赔付表`);
    assert.equal(await shown("修改赔付表"), WHO["compensation_table.manage"].includes(role), `${name}：「修改赔付表」`);
    resetBrowser();
  }
});

test("自建角色只勾「异常队列 · 查看」「工单 · 查看」：看得到异常和工单，没有任何处理按钮；财务结算、新建工单直接打开地址是「没有权限」", async () => {
  const role = "custom_0123456789abcdef";
  const permissions = ["order.read", "ticket.read"];
  assert.equal(await open(`/platform/exceptions/${EXCEPTION_ID}`, role, "电话催租户；用车前 6 小时仍未派车，自动进入救援改派", permissions), false);
  await expectButtons("自建角色", "异常详情", { 认领: false, 指派给同事: false, 写说明并关闭: false });
  assert.ok(screen.getByText("你可以查看，但没有处理异常的权限。"));
  resetBrowser();
  assert.equal(await open(`/platform/tickets/${TICKET_ID}`, role, "客人说司机 10:25 才到。", permissions), false);
  await expectButtons("自建角色", "工单详情", { 改由我处理: false, 判定: false, 回复客人: false, 加备注: false, 登记另付已付: false });
  resetBrowser();
  assert.equal(await open(`/platform/tickets/new?order=${ORDER_ID}`, role, /^新建工单$/, permissions), true);
  resetBrowser();
  assert.equal(await open("/platform/finance/statements", role, "ST202609ABCDEFGH", permissions), true);
  resetBrowser();
  assert.equal(await open(`/platform/finance/payout-batches/${BATCH_ID}`, role, "JPY 38,600（1 张）", permissions), true);
});

test("自建角色只勾「工单 · 编辑」和「财务结算 · 查看」（没勾订单、异常队列）：工单能处理但没有登记另付；异常队列是「没有权限」；账单看得到没有按钮", async () => {
  const role = "custom_fedcba9876543210";
  const permissions = ["ticket.read", "ticket.manage", "statement.read"];
  assert.equal(await open("/platform/exceptions", role, "超时未派车", permissions), true);
  resetBrowser();
  assert.equal(await open(`/platform/tickets/${TICKET_ID}`, role, "客人说司机 10:25 才到。", permissions, backend(decidedTicket)), false);
  await expectButtons("自建角色", "已判定的工单", { 关闭工单: true, 加备注: true, 登记另付已付: false });
  resetBrowser();
  assert.equal(await open(`/platform/finance/statements/${STATEMENT_ID}`, role, /少了一单/, permissions), false);
  await expectButtons("自建角色", "账单详情", { 答复异议: false, 作废并重出: false });
});

test("限定了数据范围的员工：范围外的异常、工单接口 404 → 页面写「找不到」（说明可能不在数据范围里），不写「加载失败」；财务结算各页 403 DATA_SCOPE_DENIED → 写明只给不限数据范围的账号用", async () => {
  const role = "custom_0011223344556677";
  const permissions = ["order.read", "exception.manage", "ticket.read", "ticket.manage", "statement.read", "statement.manage"];
  const scoped = (call: ApiCall & { url: URL }): Response | null => {
    const path = call.url.pathname;
    if (path.startsWith("/platform/v1/exceptions/") || path.startsWith("/platform/v1/tickets/")) return apiError(404, "NOT_FOUND", "找不到");
    if (path.startsWith("/platform/v1/statements") || path.startsWith("/platform/v1/payout-batches")) return apiError(403, "DATA_SCOPE_DENIED", "限定了数据范围的账号不能使用财务结算");
    return null;
  };
  for (const [path, text] of [
    [`/platform/exceptions/${EXCEPTION_ID}`, "找不到这条异常"],
    [`/platform/tickets/${TICKET_ID}`, "找不到这张工单"],
  ] as const) {
    openApp(path, "platform", role, scoped, permissions);
    await screen.findByText(text);
    assert.ok(screen.getByText(/可能不在你的数据范围里/), path);
    assert.equal(screen.queryByText("加载失败") === null, true, `${path}：不该写「加载失败」`);
    resetBrowser();
  }
  for (const path of ["/platform/finance/statements", `/platform/finance/statements/${STATEMENT_ID}`, "/platform/finance/payout-batches", `/platform/finance/payout-batches/${BATCH_ID}`]) {
    openApp(path, "platform", role, scoped, permissions);
    await screen.findByText(/财务结算只给不限数据范围的账号用/);
    assert.equal(screen.queryByText("加载失败") === null, true, `${path}：不该写「加载失败」`);
    resetBrowser();
  }
});

test("缺陷：限定了数据范围、有 statement.manage 的员工打开账单列表——页面写「你没有权限查看这里 / 财务结算只给不限数据范围的账号用」，标题行却还有「手工出账」主按钮（点了只会再收到 403）", async () => {
  openApp("/platform/finance/statements", "platform", "custom_0011223344556677", (call) => (call.url.pathname.startsWith("/platform/v1/statements") ? apiError(403, "DATA_SCOPE_DENIED", "限定了数据范围的账号不能使用财务结算") : null), ["statement.read", "statement.manage"]);
  await screen.findByText(/财务结算只给不限数据范围的账号用/);
  assert.equal(screen.queryByRole("button", { name: "手工出账" }) === null, true, "页面写着没有权限，就不该再有「手工出账」按钮");
});
