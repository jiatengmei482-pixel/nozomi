/**
 * M4-03 测试角色：运营后台、供应商后台的订单中心、工单、财务结算页面（接口用测试替身）。
 * - 「全部操作留审计」：审计日志页把这几页的每一种操作按中文名列出来（操作、对象、改前改后的状态）；回复客人要和「给供应商的留言」分得开；
 * - 金额显示：日元没有小数、美元两位、负数负号在数字前、0；付款批次按币种分开合计；
 * - 409 的说法：被抢先认领、工单刚被改过、异常已关闭、作废时有待审核的复核、复核过时；
 * - 网络失败：列表、详情读不出来时有「重试」，点了能读出来；提交时网络断了，填的内容还在；
 * - 供应商后台的页面只调 /tenant/v1 的接口（不从别处拼数据）。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { AuditLog } from "../../api/platform.ts";
import type { PayoutBatchDetail } from "../../api/billing.ts";
import { BATCH_ID, COLLEAGUE, EXCEPTION_ID, ME, ORDER_ID, STATEMENT_ID, TENANT_ID, TICKET_ID, compensationOf, exceptionOf, openApp, platformStatementDetailOf, platformStatementOf, platformTicketDetailOf, platformTicketOf, tenantStatementDetailOf, tenantTicketDetailOf, tenantTicketOf } from "../../testing/order-center-fixtures.tsx";
import { type ApiCall, apiError, json, resetBrowser } from "../../testing/harness.tsx";

afterEach(resetBrowser);
const user = () => userEvent.setup();
const money = (amount: string, currency = "JPY") => ({ amount, currency });
const networkDown = (): Promise<Response> => Promise.reject(new TypeError("Failed to fetch"));

// ---- 审计日志 ----

let logSeq = 0;
const logOf = (resource: string, action: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null, actor: AuditLog["actor"] = { type: "platform_user", id: ME, email: "ops@platform.example" }): AuditLog => ({
  id: String(1000 + logSeq++),
  occurred_at: "2026-10-26T03:00:00.000Z",
  tenant_id: null,
  actor,
  ip: "203.0.113.10",
  source: "console",
  resource,
  resource_id: resource === "compensation_table" ? "3" : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  action,
  before,
  after,
});

function openAuditLog(logs: AuditLog[], path = "/platform/settings/audit-logs"): void {
  openApp(path, "platform", "super_admin", (call) => {
    if (call.method !== "GET") return null;
    if (call.url.pathname === "/platform/v1/audit-logs") return json(200, { items: logs, next_cursor: null });
    if (call.url.pathname === "/platform/v1/tenants") return json(200, { items: [], next_cursor: null });
    if (call.url.pathname === "/platform/v1/staff") return json(200, { items: [], next_cursor: null });
    return null;
  });
}

/** 审计日志表格里每一行的「操作」「对象」两格。 */
async function auditRows(count: number): Promise<{ action: string; object: string }[]> {
  const read = (): { action: string; object: string }[] =>
    [...document.querySelectorAll("tbody tr")]
      .map((row) => [...row.querySelectorAll("td, th")].map((cell) => (cell.textContent ?? "").trim()))
      .filter((cells) => cells.some((text) => text.includes("@")))
      .map((cells) => ({ action: cells.find((text) => ACTION_TEXTS.has(text)) ?? cells.join(" | "), object: cells.find((text) => OBJECT_PREFIXES.some((prefix) => text.startsWith(prefix))) ?? "" }));
  await waitFor(() => assert.ok(read().length >= count, "审计日志的行还没出来"));
  return read();
}

// 后端在这几页上会写的每一种审计记录（对象、操作）→ 审计日志页应该写的中文名
const CASES: { resource: string; action: string; after?: Record<string, unknown>; actor?: AuditLog["actor"]; object: string; name: string }[] = [
  { resource: "order_exception", action: "claim", object: "订单异常", name: "认领 / 转交" },
  { resource: "order_exception", action: "close", object: "订单异常", name: "写说明关闭" },
  { resource: "ticket", action: "create", object: "工单", name: "新建" },
  { resource: "ticket", action: "assign", object: "工单", name: "认领 / 转交" },
  { resource: "ticket", action: "reply", after: { internal: false, to_guest: false, body: "请说明到达时间" }, object: "工单", name: "留言（供应商看得到）" },
  { resource: "ticket", action: "note", after: { internal: true, to_guest: false, body: "内部" }, object: "工单", name: "内部备注" },
  { resource: "ticket", action: "request_reply", object: "工单", name: "征求供应商意见" },
  { resource: "ticket", action: "decide", object: "工单", name: "判定" },
  { resource: "ticket", action: "close", object: "工单", name: "关闭工单" },
  { resource: "ticket", action: "pay", object: "工单", name: "登记另付已付" },
  { resource: "compensation_table", action: "update", object: "客人赔付表", name: "修改" },
  { resource: "approval", action: "request", object: "双人复核", name: "发起复核" },
  { resource: "approval", action: "approve", object: "双人复核", name: "批准" },
  { resource: "statement", action: "issue", object: "账单", name: "出账" },
  { resource: "statement", action: "dispute", actor: { type: "tenant_user", id: "u1", email: "admin@supplier.example" }, object: "账单", name: "提异议" },
  { resource: "statement", action: "reply", object: "账单", name: "答复异议" },
  { resource: "statement", action: "void", object: "账单", name: "作废并重出" },
  { resource: "statement", action: "confirm", actor: { type: "tenant_user", id: "u1", email: "admin@supplier.example" }, object: "账单", name: "确认账单" },
  { resource: "statement", action: "approve", object: "账单", name: "批准" },
  { resource: "payout_batch", action: "close", object: "付款批次", name: "锁定" },
];
const ACTION_TEXTS = new Set([...CASES.map((c) => c.name), "回复客人", "留言（供应商看得到）"]);
const OBJECT_PREFIXES = [...new Set(CASES.map((c) => c.object))];

test("全部操作留审计：异常、工单、赔付表、复核、账单、付款批次的每一种操作在审计日志页都按中文名列出来（不显示英文原名）", async () => {
  const logs = CASES.map((c) => logOf(c.resource, c.action, { status: "open" }, { status: "claimed", ...(c.after ?? {}) }, c.actor));
  openAuditLog(logs);
  const rows = await auditRows(CASES.length);
  assert.deepEqual(
    rows.map((row) => row.action),
    CASES.map((c) => c.name),
  );
  rows.forEach((row, index) => assert.ok(row.object.startsWith(CASES[index]?.object ?? "?"), `第 ${index + 1} 行的对象：${row.object}`));
  const text = document.body.textContent ?? "";
  for (const raw of ["order_exception", "request_reply", "payout_batch", "compensation_table"]) assert.ok(!text.includes(raw), `页面上不该出现原名 ${raw}`);
});

test("全部操作留审计：详情里改前改后的状态按对象写中文（异常：待处理 → 处理中；工单：处理中 → 已判定；账单：待确认 → 有异议；付款批次：收账单中 → 已锁定）", async () => {
  const cases: [AuditLog, string, string][] = [
    [logOf("order_exception", "claim", { status: "open", assignee_id: null }, { status: "claimed", assignee_id: COLLEAGUE }), "待处理", "处理中"],
    [logOf("ticket", "decide", { status: "in_progress" }, { status: "decided", outcome: "upheld" }), "处理中", "已判定"],
    [logOf("statement", "dispute", { status: "issued" }, { status: "disputed", reason: "少了一单" }), "待确认", "有异议"],
    [logOf("payout_batch", "close", { status: "open" }, { status: "closed" }), "收账单中", "已锁定"],
  ];
  const u = user();
  for (const [log, before, after] of cases) {
    openAuditLog([log]);
    await auditRows(1);
    await u.click(screen.getByRole("button", { name: `第 ${log.id} 条记录的详情` }));
    const dialog = await screen.findByRole("dialog");
    const text = dialog.textContent ?? "";
    assert.ok(text.includes(before), `${log.resource} 改前：${before}`);
    assert.ok(text.includes(after), `${log.resource} 改后：${after}`);
    resetBrowser();
  }
});

test("缺陷：回复客人（客人在官网看得到、供应商看不到）在审计日志页写成「留言（供应商看得到）」——和给供应商的留言同名，而且说法正好相反", async () => {
  const toTenant = logOf("ticket", "reply", null, { ticket_no: "TK20261026K3M9Q2", internal: false, to_guest: false, body: "请说明司机几点到的" });
  const toGuest = logOf("ticket", "reply", null, { ticket_no: "TK20261026K3M9Q2", internal: false, to_guest: true, body: "您好，我们正在核实" });
  openAuditLog([toTenant, toGuest]);
  const rows = await auditRows(2);
  assert.notEqual(rows[1]?.action, rows[0]?.action, "回复客人和给供应商的留言在审计日志里分不开");
  assert.ok(!(rows[1]?.action ?? "").includes("供应商看得到"), `回复客人写成了「${rows[1]?.action}」`);
});

// ---- 金额 ----

test("金额（账单列表）：日元没有小数、千分位；美元两位小数；负数负号在数字前（转入下期）；0 写「JPY 0」", async () => {
  const items = [
    platformStatementOf({ id: "s1", statement_no: "ST202609AAAAAAAA", total: money("1234567"), status: "issued" }),
    platformStatementOf({ id: "s2", statement_no: "ST202609BBBBBBBB", total: money("123.45", "USD"), currency: "USD", status: "issued" }),
    platformStatementOf({ id: "s3", statement_no: "ST202609CCCCCCCC", total: money("-0.05", "USD"), currency: "USD", status: "carried" }),
    platformStatementOf({ id: "s4", statement_no: "ST202609DDDDDDDD", total: money("-1200"), status: "carried" }),
    platformStatementOf({ id: "s5", statement_no: "ST202609EEEEEEEE", total: money("0"), status: "settled" }),
  ];
  openApp("/platform/finance/statements", "platform", "finance", (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/statements" ? json(200, { items, next_cursor: null, total: items.length }) : null));
  const region = await screen.findByRole("region", { name: "账单" });
  await within(region).findByText("JPY 1,234,567");
  for (const text of ["USD 123.45", "USD -0.05", "JPY -1,200", "JPY 0"]) assert.ok(within(region).getByText(text), text);
  assert.ok(!(region.textContent ?? "").includes("1,234,567.00"), "日元不写小数");
});

test("金额（付款批次）：不同币种不相加，按币种各一行；美元两位小数", async () => {
  const batch: PayoutBatchDetail = {
    id: BATCH_ID,
    pay_date: "2026-10-20",
    status: "open",
    created_at: "2026-10-09T00:00:00.000Z",
    closed_at: null,
    closed_by: null,
    paid_at: null,
    statement_count: 3,
    totals: [
      { currency: "JPY", count: 2, total: money("58400") },
      { currency: "USD", count: 1, total: money("1000.10", "USD") },
    ],
    version: 1,
    statements: [platformStatementOf({ status: "in_payout", payout_batch_id: BATCH_ID, total: money("1000.10", "USD"), currency: "USD" })],
  };
  openApp(`/platform/finance/payout-batches/${BATCH_ID}`, "platform", "finance", (call) => (call.method === "GET" && call.url.pathname === `/platform/v1/payout-batches/${BATCH_ID}` ? json(200, { batch }) : null));
  await screen.findByText("JPY 58,400（2 张）");
  assert.ok(screen.getByText("USD 1,000.10（1 张）"));
  assert.ok(!(document.body.textContent ?? "").match(/59,400|1,000\.10 \+|JPY 59/), "不跨币种相加");
});

test("金额（工单赔付、异常详情）：美元的单写两位小数；补足到最低额写明；支付异常的金额按最小单位换算", async () => {
  const usd = { ...compensationOf(), sell: money("145.20", "USD"), ratio_amount: money("14.52", "USD"), minimum: money("3.30", "USD"), topped_up: false, compensation: money("14.52", "USD"), refund: money("14.52", "USD"), manual_payout: money("0.00", "USD"), tenant_total: money("1980") };
  openApp(`/platform/tickets/${TICKET_ID}`, "platform", "operations", (call) => (call.method === "GET" && call.url.pathname === `/platform/v1/tickets/${TICKET_ID}` ? json(200, platformTicketDetailOf(platformTicketOf({ status: "decided", outcome: "upheld", liable_party: "tenant", decided_by: COLLEAGUE, decided_at: "2026-10-08T00:00:00.000Z" }), { compensation: usd })) : null));
  const section = (await screen.findByRole("heading", { name: "赔付" })).closest("section") as HTMLElement;
  const text = section.textContent ?? "";
  assert.ok(text.includes("USD 145.20"), "对外价");
  assert.ok(text.includes("USD 14.52"), "赔客人");
  assert.ok(text.includes("JPY 1,980"), "供应商承担是结算币种");
  resetBrowser();
  openApp(`/platform/exceptions/${EXCEPTION_ID}`, "platform", "finance", (call) =>
    call.method === "GET" && call.url.pathname === `/platform/v1/exceptions/${EXCEPTION_ID}` ? json(200, { exception: exceptionOf({ type: "payment_issue", type_name: "支付异常", detail: { reason: "refund_failed", kind: "order", amount_minor: 1230, currency: "USD", refunded_minor: 5, unknown: 1 } }) }) : null,
  );
  await screen.findByText("USD 12.30");
  assert.ok(screen.getByText("USD 0.05"));
});

// ---- 409 ----

test("409：工单刚被别人改过（TICKET_CHANGED）时认领——页面顶部写原因，并重新读取工单", async () => {
  let reads = 0;
  openApp(`/platform/tickets/${TICKET_ID}`, "platform", "customer_service", (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/tickets/${TICKET_ID}`) {
      reads += 1;
      return json(200, platformTicketDetailOf(platformTicketOf({ assignee_id: reads === 1 ? null : COLLEAGUE })));
    }
    if (call.method === "POST" && call.url.pathname.endsWith("/assign")) return apiError(409, "TICKET_CHANGED", "工单刚被别人改过，请刷新后再试");
    return null;
  });
  await user().click(await screen.findByRole("button", { name: "认领" }));
  await screen.findByText(/这张工单刚被别人改过/);
  await waitFor(() => assert.ok(reads >= 2, "重新读取了工单"));
  await screen.findByRole("button", { name: "改由我处理" });
});

test("409：异常已经关闭（EXCEPTION_CLOSED，条件解除系统关的）时写说明关闭——对话框写原因、只剩「知道了」，写的说明不丢", async () => {
  openApp(`/platform/exceptions/${EXCEPTION_ID}`, "platform", "operations", (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/exceptions/${EXCEPTION_ID}`) return json(200, { exception: exceptionOf() });
    if (call.method === "POST" && call.url.pathname.endsWith("/close")) return apiError(409, "EXCEPTION_CLOSED", "这条异常已经关闭了");
    return null;
  });
  const u = user();
  await u.click(await screen.findByRole("button", { name: "写说明并关闭" }));
  const dialog = await screen.findByRole("dialog", { name: "关闭这条异常？" });
  await u.type(within(dialog).getByLabelText(/处理说明/), "已电话催供应商");
  await u.click(within(dialog).getByRole("button", { name: "关闭异常" }));
  await within(dialog).findByText(/已经关闭了/);
  assert.equal(within(dialog).queryByRole("button", { name: "关闭异常" }) === null, true, "去掉确认按钮");
  assert.ok(within(dialog).getByRole("button", { name: "知道了" }));
});

test("409：有待审核的付款复核时作废（STATEMENT_REVIEW_PENDING）——对话框写明先去「待审核」驳回或撤回，只剩「知道了」", async () => {
  openApp(`/platform/finance/statements/${STATEMENT_ID}`, "platform", "finance", (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/statements/${STATEMENT_ID}`) return json(200, { statement: platformStatementDetailOf(platformStatementOf({ status: "disputed", disputed_at: "2026-10-09T00:00:00.000Z", dispute_reason: "少了一单" })) });
    if (call.method === "POST" && call.url.pathname.endsWith("/void")) return apiError(409, "STATEMENT_REVIEW_PENDING", "有待审核的付款复核");
    return null;
  });
  const u = user();
  await u.click(await screen.findByRole("button", { name: "作废并重出" }));
  const dialog = await screen.findByRole("dialog");
  await u.type(within(dialog).getByLabelText(/原因/), "订单金额更正");
  await u.click(within(dialog).getByRole("button", { name: "作废并重出" }));
  await within(dialog).findByText(/有一条待审核的付款复核，不能作废/);
  assert.ok(within(dialog).getByRole("button", { name: "知道了" }));
});

test("409：复核过时（APPROVAL_STALE，付款给供应商）——待审核里批准时写明请驳回、让发起人重新发起", async () => {
  const approval = {
    id: "ap1",
    kind: "statement.payout",
    resource: "statement",
    resource_id: STATEMENT_ID,
    summary: "付款给供应商「乙车队」",
    payload: { statement_no: "ST202609ABCDEFGH", period: "2026-09", tenant_name: "乙车队", total_minor: 38600, currency: "JPY", pay_due_on: "2026-10-20" },
    before: null,
    base_version: 1,
    status: "pending",
    requested_by: { id: COLLEAGUE, name: "佐藤", email: "sato@platform.example" },
    requested_at: "2026-10-09T00:00:00.000Z",
    request_note: null,
    decided_by: null,
    decided_at: null,
    decision_note: null,
    impact: null,
    can: { approve: true, reject: true, withdraw: false },
  };
  openApp("/platform/approvals", "platform", "finance", (call) => {
    if (call.method === "GET" && call.url.pathname === "/platform/v1/approvals") return json(200, { items: [approval], next_cursor: null, total: 1 });
    if (call.method === "GET" && call.url.pathname === "/platform/v1/channels") return json(200, { items: [], next_cursor: null, total: 0 });
    if (call.method === "POST" && call.url.pathname.endsWith("/approve")) return apiError(409, "APPROVAL_STALE", "账单已经变了");
    return null;
  });
  const u = user();
  const card = (await screen.findByRole("heading", { name: "付款给供应商" })).closest("section") as HTMLElement;
  await u.click(within(card).getByRole("button", { name: /^批准/ }));
  const dialog = await screen.findByRole("dialog");
  await u.click(within(dialog).getByRole("button", { name: "批准" }));
  await within(dialog).findByText(/请驳回，让发起人按现在的内容重新发起/);
});

// ---- 网络失败 ----

type Page = { path: string; portal: "platform" | "tenant"; role: string; api: string; ok: () => Response; ready: string };
const PAGES: Page[] = [
  { path: "/platform/tickets", portal: "platform", role: "customer_service", api: "/platform/v1/tickets", ok: () => json(200, { items: [platformTicketOf()], next_cursor: null, total: 1 }), ready: "司机迟到 25 分钟" },
  { path: `/platform/tickets/${TICKET_ID}`, portal: "platform", role: "customer_service", api: `/platform/v1/tickets/${TICKET_ID}`, ok: () => json(200, platformTicketDetailOf()), ready: "客人说司机 10:25 才到。" },
  { path: `/platform/exceptions/${EXCEPTION_ID}`, portal: "platform", role: "operations", api: `/platform/v1/exceptions/${EXCEPTION_ID}`, ok: () => json(200, { exception: exceptionOf() }), ready: "电话催租户；用车前 6 小时仍未派车，自动进入救援改派" },
  { path: "/platform/finance/statements", portal: "platform", role: "finance", api: "/platform/v1/statements", ok: () => json(200, { items: [platformStatementOf()], next_cursor: null, total: 1 }), ready: "ST202609ABCDEFGH" },
  { path: `/platform/finance/statements/${STATEMENT_ID}`, portal: "platform", role: "finance", api: `/platform/v1/statements/${STATEMENT_ID}`, ok: () => json(200, { statement: platformStatementDetailOf() }), ready: "NZ20261008ABCDEFGH" },
  { path: "/platform/finance/payout-batches", portal: "platform", role: "finance", api: "/platform/v1/payout-batches", ok: () => json(200, { items: [] }), ready: "还没有付款批次" },
  { path: "/tickets", portal: "tenant", role: "admin", api: "/tenant/v1/tickets", ok: () => json(200, { items: [tenantTicketOf()], next_cursor: null, total: 1 }), ready: "司机迟到 25 分钟" },
  { path: `/tickets/${TICKET_ID}`, portal: "tenant", role: "admin", api: `/tenant/v1/tickets/${TICKET_ID}`, ok: () => json(200, tenantTicketDetailOf()), ready: "请提供司机到达的定位截图。" },
  { path: "/statements", portal: "tenant", role: "admin", api: "/tenant/v1/statements", ok: () => json(200, { items: [platformStatementOf()] }), ready: "ST202609ABCDEFGH" },
  { path: `/statements/${STATEMENT_ID}`, portal: "tenant", role: "admin", api: `/tenant/v1/statements/${STATEMENT_ID}`, ok: () => json(200, { statement: tenantStatementDetailOf() }), ready: "NZ20261008ABCDEFGH" },
];

for (const page of PAGES) {
  test(`网络失败：${page.path} 第一次读不出来时有「重试」（不白屏、不报错），点了读出来`, async () => {
    let attempts = 0;
    openApp(page.path, page.portal, page.role, (call) => {
      if (call.method !== "GET" || call.url.pathname !== page.api) return null;
      attempts += 1;
      return attempts === 1 ? networkDown() : page.ok();
    });
    await user().click(await screen.findByRole("button", { name: "重试" }));
    await screen.findAllByText(page.ready);
    assert.equal(attempts, 2);
  });
}

test("网络失败：回复客人时网络断了——写的话还在，提示能再发；再点一次发出去", async () => {
  let posts = 0;
  openApp(`/platform/tickets/${TICKET_ID}`, "platform", "customer_service", (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/tickets/${TICKET_ID}`) return json(200, platformTicketDetailOf());
    if (call.method === "POST" && call.url.pathname.endsWith("/messages")) {
      posts += 1;
      if (posts === 1) return networkDown();
      return json(201, platformTicketDetailOf(platformTicketOf(), { notes: [{ id: "g1", author: { id: ME, name: "测试员工" }, body: "您好，我们正在核实", to_guest: true, created_at: "2026-10-08T06:00:00.000Z" }] }));
    }
    return null;
  });
  const u = user();
  const section = (await screen.findByRole("heading", { name: "回复客人" })).closest("section") as HTMLElement;
  const box = within(section).getByLabelText("给客人的回复") as HTMLTextAreaElement;
  await u.type(box, "您好，我们正在核实");
  await u.click(within(section).getByRole("button", { name: "回复客人" }));
  await waitFor(() => assert.equal(posts, 1));
  await waitFor(() => assert.ok(/网络|连接|重试|再试/.test(section.textContent ?? ""), "写了网络出错"));
  assert.equal(box.value, "您好，我们正在核实", "写的话还在");
  await u.click(within(section).getByRole("button", { name: "回复客人" }));
  await within(section).findByText("您好，我们正在核实", { selector: "p" });
  assert.equal(posts, 2);
});

// ---- 规则 4：供应商后台不从别处拼 ----

test("规则 4：供应商后台的工单、账单页面只调 /tenant/v1 的接口（不调运营后台、同事名单），页面上没有平台员工和处理人", async () => {
  const visits: ApiCall[] = [];
  for (const [path, role] of [
    ["/tickets", "admin"],
    [`/tickets/${TICKET_ID}`, "admin"],
    ["/statements", "finance"],
    [`/statements/${STATEMENT_ID}`, "finance"],
  ] as const) {
    const calls = openApp(path, "tenant", role, (call) => {
      if (call.method !== "GET") return null;
      const at = call.url.pathname;
      if (at === "/tenant/v1/tickets") return json(200, { items: [tenantTicketOf()], next_cursor: null, total: 1 });
      if (at === `/tenant/v1/tickets/${TICKET_ID}`) return json(200, tenantTicketDetailOf(tenantTicketOf({ status: "decided", outcome: "upheld", liable_party: "tenant", decision_note: "迟到属实", decided_at: "2026-10-08T00:00:00.000Z", appeal_until: "2999-01-01T00:00:00.000Z" }), { deductions: [{ id: "d1", kind: "compensation", amount: money("1980"), status: "pending", basis: { bp: 1000, scenario: "late_15_29", ratio_minor: 1980, settlement_minor: 19800 }, waived_at: null, waive_reason: null, created_at: "2026-10-08T00:00:00.000Z" }] as never }));
      if (at === "/tenant/v1/statements") return json(200, { items: [platformStatementOf()] });
      if (at === `/tenant/v1/statements/${STATEMENT_ID}`) return json(200, { statement: tenantStatementDetailOf() });
      return null;
    });
    await waitFor(() => assert.ok(calls.some((call) => call.path.startsWith("/tenant/v1/tickets") || call.path.startsWith("/tenant/v1/statements")), path));
    await new Promise((resolve) => setTimeout(resolve, 100));
    visits.push(...calls);
    const text = document.body.textContent ?? "";
    for (const forbidden of ["佐藤", "测试员工", "处理人", "内部备注", "对外价", "加价"]) assert.ok(!text.includes(forbidden), `${path} 上出现了「${forbidden}」`);
    resetBrowser();
  }
  const foreign = visits.filter((call) => !call.path.startsWith("/tenant/v1/"));
  assert.deepEqual(foreign.map((call) => call.path), [], "供应商后台只调 /tenant/v1");
  assert.ok(!visits.some((call) => call.path.includes(TENANT_ID)), "租户编号不进请求地址（只来自令牌）");
  assert.ok(ORDER_ID);
});

// ---- 分页和筛选组合 ----

test("分页 + 筛选组合（工单列表）：下一页带上游标和全部筛选条件；改一个条件回到第一页（不带旧游标）；上一页回到第一页", async () => {
  const queries: URLSearchParams[] = [];
  openApp(`/platform/tickets?type=complaint&overdue=true&assignee=${COLLEAGUE}&status=all`, "platform", "operations", (call) => {
    if (call.method !== "GET" || call.url.pathname !== "/platform/v1/tickets") return null;
    queries.push(call.url.searchParams);
    const cursor = call.url.searchParams.get("cursor");
    return json(200, { items: [platformTicketOf({ id: cursor === null ? TICKET_ID : "d2d2d2d2-dddd-4ddd-8ddd-dddddddddddd", ticket_no: cursor === null ? "TK20261026PAGE001" : "TK20261026PAGE002" })], next_cursor: cursor === null ? "c2" : null, total: 2 });
  });
  const u = user();
  await screen.findByText("TK20261026PAGE001");
  await u.click(screen.getByRole("button", { name: "下一页" }));
  await screen.findByText("TK20261026PAGE002");
  const second = queries.at(-1) as URLSearchParams;
  assert.deepEqual([second.get("cursor"), second.get("type"), second.get("overdue"), second.get("assignee"), second.get("status")], ["c2", "complaint", "true", COLLEAGUE, null]);
  await u.selectOptions(screen.getByRole("combobox", { name: /类型/ }), "lost_and_found");
  await waitFor(() => assert.equal(queries.at(-1)?.get("type"), "lost_and_found"));
  const changed = queries.at(-1) as URLSearchParams;
  assert.deepEqual([changed.get("cursor"), changed.get("overdue"), changed.get("assignee")], [null, "true", COLLEAGUE], "改条件回到第一页，其余条件保留");
  await screen.findByText("TK20261026PAGE001");
  assert.equal(screen.queryByRole("button", { name: "上一页" })?.hasAttribute("disabled") ?? true, true, "第一页没有上一页");
});

test("分页 + 筛选组合（账单列表）：状态 + 周期 + 游标一起带上；周期写错的网址参数不带去接口", async () => {
  const queries: URLSearchParams[] = [];
  openApp("/platform/finance/statements?status=disputed&period=2026-09", "platform", "finance", (call) => {
    if (call.method !== "GET" || call.url.pathname !== "/platform/v1/statements") return null;
    queries.push(call.url.searchParams);
    const cursor = call.url.searchParams.get("cursor");
    return json(200, { items: [platformStatementOf({ id: cursor === null ? "s1" : "s2", statement_no: cursor === null ? "ST202609PAGEAAAA" : "ST202609PAGEBBBB", status: "disputed" })], next_cursor: cursor === null ? "c2" : null, total: 2 });
  });
  const u = user();
  await screen.findByText("ST202609PAGEAAAA");
  await u.click(screen.getByRole("button", { name: "下一页" }));
  await screen.findByText("ST202609PAGEBBBB");
  const last = queries.at(-1) as URLSearchParams;
  assert.deepEqual([last.get("status"), last.get("period"), last.get("cursor")], ["disputed", "2026-09", "c2"]);
  resetBrowser();
  const bad: URLSearchParams[] = [];
  openApp("/platform/finance/statements?status=nonsense&period=2026-13", "platform", "finance", (call) => {
    if (call.method !== "GET" || call.url.pathname !== "/platform/v1/statements") return null;
    bad.push(call.url.searchParams);
    return json(200, { items: [], next_cursor: null, total: 0 });
  });
  await waitFor(() => assert.ok(bad.length > 0));
  assert.deepEqual([bad[0]?.get("status"), bad[0]?.get("period")], [null, null]);
});
