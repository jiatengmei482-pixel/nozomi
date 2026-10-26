/**
 * 订单中心（异常、工单、赔付表）和财务结算页面的组件测试共用的测试替身数据和打开页面的辅助函数（M4-03）。
 * 只被 *.test.tsx 引用，不进正式构建；数据只在测试里构造。
 */
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { App } from "../App.tsx";
import type { PlatformStatement, PlatformStatementDetail, TenantStatementDetail } from "../api/billing.ts";
import type { OrderException, PlatformTicket, PlatformTicketDetail, TenantTicket, TenantTicketDetail } from "../api/order-center.ts";
import { type ApiCall, json, signIn, stubApiWith } from "./harness.tsx";

export const stamps = { created_at: "2026-10-06T00:12:00.000Z", updated_at: "2026-10-08T05:30:00.000Z" };
export const ME = "11111111-1111-4111-8111-111111111111";
export const COLLEAGUE = "22222222-2222-4222-8222-222222222222";
export const ORDER_ID = "0a0a0a0a-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const TENANT_ID = "7b7b7b7b-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const EXCEPTION_ID = "e1e1e1e1-eeee-4eee-8eee-eeeeeeeeeeee";
export const TICKET_ID = "d1d1d1d1-dddd-4ddd-8ddd-dddddddddddd";
export const STATEMENT_ID = "51515151-5555-4555-8555-555555555555";
export const BATCH_ID = "b2b2b2b2-bbbb-4bbb-8bbb-bbbbbbbbbbb2";

export type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;

/**
 * 打开一个页面：运营后台的 `role` 是内置角色键，或自建角色（`custom_…`，权限按 `permissions` 给）；供应商后台是租户角色键。
 * 同事名单默认有「我」和一位同事。
 */
export function openApp(path: string, portal: "tenant" | "platform", role: string, routes: Route, permissions: string[] = []): ApiCall[] {
  signIn(portal, "the-token");
  const calls = stubApiWith((call) => {
    const custom = routes(call);
    if (custom !== null) return custom;
    if (call.method === "GET" && call.url.pathname === "/platform/v1/auth/me") return json(200, { user: { id: ME, email: "me@platform.example", name: "测试员工", role, role_name: role.startsWith("custom_") ? "自建角色" : null, status: "active", ...stamps }, permissions, must_change_password: false });
    if (call.method === "GET" && call.url.pathname === "/tenant/v1/auth/me") return json(200, { user: { id: "u1", email: "user@supplier.example", name: "供应商用户", role, status: "active", ...stamps }, tenant: { id: TENANT_ID, name: "乙车队", status: "active", ...stamps }, permissions: [], must_change_password: false });
    if (call.method === "GET" && call.url.pathname === "/platform/v1/colleagues") return json(200, { items: [{ id: ME, name: "测试员工", active: true }, { id: COLLEAGUE, name: "佐藤", active: true }] });
    return null;
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

export const exceptionOf = (changes: Partial<OrderException> = {}): OrderException => ({
  id: EXCEPTION_ID,
  type: "dispatch_overdue",
  type_name: "超时未派车",
  handling: "电话催租户；用车前 6 小时仍未派车，自动进入救援改派",
  order: { id: ORDER_ID, order_no: "NZ20261007ABCDEFGH", service_time: "2026-10-20T01:00:00.000Z" },
  tenant: { id: TENANT_ID, name: "乙车队" },
  detail: { dispatch_due_at: "2026-10-19T01:00:00.000Z", service_at: "2026-10-20T01:00:00.000Z" },
  status: "open",
  opened_at: stamps.created_at,
  due_at: stamps.created_at,
  overdue: true,
  assignee: null,
  claimed_at: null,
  close_kind: null,
  closed_at: null,
  closed_by: null,
  resolution: null,
  version: 1,
  ...changes,
});

const money = (amount: string, currency = "JPY") => ({ amount, currency });

export const platformTicketOf = (changes: Partial<PlatformTicket> = {}): PlatformTicket => ({
  id: TICKET_ID,
  ticket_no: "TK20261026K3M9Q2",
  type: "complaint",
  source: "channel",
  created_by_type: "channel",
  created_by: null,
  order: { id: ORDER_ID, order_no: "NZ20261007ABCDEFGH" },
  tenant: { id: TENANT_ID, name: "乙车队" },
  parent_ticket_id: null,
  priority: "normal",
  subject: "司机迟到 25 分钟",
  description: "客人说司机 10:25 才到。",
  language: "zh",
  status: "in_progress",
  assignee_id: ME,
  assigned_at: stamps.created_at,
  first_response_due_at: "2999-01-01T00:00:00.000Z",
  first_responded_at: stamps.created_at,
  resolution_due_at: "2999-01-01T00:00:00.000Z",
  overdue: false,
  tenant_reply_requested_at: null,
  tenant_reply_due_at: null,
  tenant_replied_at: null,
  outcome: null,
  liable_party: null,
  decision_note: null,
  decided_at: null,
  decided_by: null,
  approval_id: null,
  appeal_until: null,
  closed_at: null,
  closed_by: null,
  close_note: null,
  version: 3,
  ...stamps,
  ...changes,
});

export const platformTicketDetailOf = (ticket: PlatformTicket = platformTicketOf(), changes: Partial<PlatformTicketDetail> = {}): PlatformTicketDetail => ({
  ticket,
  messages: [{ id: "m1", author_type: "tenant_user", author_id: "u1", body: "司机 10:02 已到达。", file_ids: [], created_at: stamps.updated_at }],
  notes: [{ id: "n1", author: { id: COLLEAGUE, name: "佐藤" }, body: "客人第二次投诉，留意语气。", created_at: stamps.updated_at }],
  compensation: null,
  deductions: [],
  refund_ids: [],
  parent: null,
  appeal: null,
  approval: null,
  ...changes,
});

export const compensationOf = (): NonNullable<PlatformTicketDetail["compensation"]> => ({
  scenario: "late_15_29",
  scenario_name: "司机迟到 15–29 分钟",
  liable_party: "tenant",
  table_version: 0,
  customer_bp: 1000,
  sell: money("21780"),
  ratio_amount: money("2178"),
  downgrade_difference: money("0"),
  minimum: money("500"),
  minimum_fx: null,
  topped_up: false,
  compensation: money("2178"),
  reimbursement_claimed: money("0"),
  reimbursement_cap: money("0"),
  reimbursement: money("0"),
  refund: money("2178"),
  manual_payout: money("0"),
  order_cancelled: false,
  payout_status: "none",
  payout_reference: null,
  paid_at: null,
  paid_by: null,
  tenant_total: money("1980"),
  created_at: stamps.updated_at,
});

export const tenantTicketOf = (changes: Partial<TenantTicket> = {}): TenantTicket => ({
  id: TICKET_ID,
  ticket_no: "TK20261026K3M9Q2",
  type: "complaint",
  source: "channel",
  order: { id: ORDER_ID, order_no: "NZ20261007ABCDEFGH" },
  parent_ticket_id: null,
  priority: "normal",
  subject: "司机迟到 25 分钟",
  description: "客人说司机 10:25 才到。",
  status: "awaiting_tenant",
  tenant_reply_requested_at: stamps.created_at,
  tenant_reply_due_at: "2999-01-01T00:00:00.000Z",
  tenant_replied_at: null,
  outcome: null,
  liable_party: null,
  decision_note: null,
  decided_at: null,
  appeal_until: null,
  closed_at: null,
  ...stamps,
  ...changes,
});

export const tenantTicketDetailOf = (ticket: TenantTicket = tenantTicketOf(), changes: Partial<TenantTicketDetail> = {}): TenantTicketDetail => ({
  ticket,
  messages: [{ id: "m1", author_type: "platform_user", author_id: null, body: "请提供司机到达的定位截图。", file_ids: [], created_at: stamps.created_at }],
  deductions: [],
  appeal: null,
  ...changes,
});

export const platformStatementOf = (changes: Partial<PlatformStatement> = {}): PlatformStatement => ({
  id: STATEMENT_ID,
  statement_no: "ST202609ABCDEFGH",
  period: "2026-09",
  currency: "JPY",
  status: "issued",
  total: money("38600"),
  line_count: 3,
  pay_due_on: "2026-10-20",
  payout_on: null,
  issued_at: stamps.created_at,
  confirm_due_at: "2026-10-13T00:12:00.000Z",
  confirmed_at: null,
  confirmed_by_type: null,
  disputed_at: null,
  dispute_reason: null,
  approved_at: null,
  paid_at: null,
  voided_at: null,
  void_reason: null,
  version: 1,
  tenant: { id: TENANT_ID, name: "乙车队" },
  confirmed_by: null,
  approval_id: null,
  payout_batch_id: null,
  voided_by: null,
  ...changes,
});

const LINES: PlatformStatementDetail["lines"] = [
  { id: "l1", kind: "order", order_id: ORDER_ID, order_no: "NZ20261007ABCDEFGH", service_date: "2026-09-10", prior_period: false, amount: money("19800"), detail: { order_status: "completed", settlement_minor: 19800 }, voided: false },
  { id: "l2", kind: "order", order_id: ORDER_ID, order_no: "NZ20261008ABCDEFGH", service_date: "2026-09-11", prior_period: false, amount: money("20000"), detail: { order_status: "completed", settlement_minor: 20000 }, voided: false },
  { id: "l3", kind: "deduction", order_id: ORDER_ID, order_no: "NZ20261009ABCDEFGH", service_date: "2026-09-12", prior_period: true, amount: money("-1200"), detail: { deduction_kind: "compensation" }, voided: false },
];

export const platformStatementDetailOf = (statement: PlatformStatement = platformStatementOf(), changes: Partial<PlatformStatementDetail> = {}): PlatformStatementDetail => ({
  ...statement,
  pending_approval_id: null,
  summary: [
    { kind: "order", count: 2, amount: money("39800") },
    { kind: "deduction", count: 1, amount: money("-1200") },
  ],
  lines: LINES,
  events: [{ action: "issue", actor_type: "system", actor_id: null, note: null, at: stamps.created_at }],
  ...changes,
});

export const tenantStatementDetailOf = (changes: Partial<TenantStatementDetail> = {}): TenantStatementDetail => {
  const { tenant: _tenant, confirmed_by: _c, approval_id: _a, payout_batch_id: _p, voided_by: _v, pending_approval_id: _pa, ...rest } = platformStatementDetailOf();
  return { ...rest, events: [{ action: "issue", actor_type: "system", note: null, at: stamps.created_at }], ...changes };
};
