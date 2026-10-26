/**
 * M3-03：平台统一取消政策（ADR 0029），经真实接口、真实 PostgreSQL。
 * - 运营后台、供应商后台都能看（供应商只读，没有改的接口）；还没人改过时是需求表里的默认政策（版本 0）；
 * - 修改走双人复核：运营发起，发起人不能自己批，财务（或另一位运营）批准后存成新的一版；批准时版本变了 → 已过时；不合规则、和现在一样的发起就拦；
 * - 只对之后下的单生效：已经下了的单按下单时的那一版算。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CANCELLATION_POLICY } from "@nozomi/domain";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, type Staff, addStaff, buildMarket, ok } from "./testing/market.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";
import { platformLogin } from "./testing/money.ts";

let api: TestApi;
let m: Market;
let flow: SalesFlow;
let finance: Staff;
let ops2: Staff;

before(async () => {
  const pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  flow = await salesFlow(api, m, pay);
  finance = await addStaff(api, m.root, "fin@platform.test", "finance");
  ops2 = await addStaff(api, m.root, "ops2@platform.test", "operations");
});
after(() => api.close());

const asBody = (rules: typeof DEFAULT_CANCELLATION_POLICY) => rules.map((rule) => ({ category: rule.category, level: rule.level, tiers: rule.tiers.map((tier) => ({ min_hours_before: tier.minHoursBefore, fee_bp: tier.feeBp })) }));
/** 默认政策里把「接送机 · 商务」改成 72 小时免费、72–24 小时扣 30%、24 小时内 100%。 */
const stricter = () => asBody(DEFAULT_CANCELLATION_POLICY).map((rule) => (rule.category === "airport_transfer" && rule.level === "business" ? { ...rule, tiers: [{ min_hours_before: 72, fee_bp: 0 }, { min_hours_before: 24, fee_bp: 3000 }, { min_hours_before: 0, fee_bp: 10000 }] } : rule));

test("看：运营后台（任何角色）、供应商后台都能看，还没人改过是需求表的默认政策（版本 0，15 条阶梯）", async () => {
  const platform = await api.call("GET", "/platform/v1/cancellation-policy", { token: m.staff.readonly.token });
  assertMatchesOpenApi("GET", "/platform/v1/cancellation-policy", platform);
  assert.deepEqual([platform.body.policy.version, platform.body.policy.effective_at, platform.body.policy.rules.length], [0, null, 15]);
  assert.deepEqual(platform.body.policy.rules, asBody(DEFAULT_CANCELLATION_POLICY));
  const tenant = await api.call("GET", "/tenant/v1/cancellation-policy", { token: m.a.adminToken });
  assertMatchesOpenApi("GET", "/tenant/v1/cancellation-policy", tenant);
  assert.deepEqual(tenant.body, platform.body, "供应商看到的和平台的是同一份");
  assert.equal((await api.call("POST", "/platform/v1/cancellation-policy/changes", { token: m.a.adminToken, body: { rules: stricter() } })).status, 401, "供应商的令牌进不了平台接口");
  assert.equal((await api.call("GET", "/tenant/v1/cancellation-policy")).status, 401);
});

test("改：运营发起（202，不立即生效）；发起人不能自己批；财务批准后成为版本 1；只读、渠道经理不能发起；之后下的单按新版本，之前的按旧版本", async () => {
  const before = await flow.paidOrder();
  assert.equal(before.cancel_policy.version, 0);
  assert.equal((await api.call("POST", "/platform/v1/cancellation-policy/changes", { token: m.staff.readonly.token, body: { rules: stricter() } })).status, 403);
  assert.equal((await api.call("POST", "/platform/v1/cancellation-policy/changes", { token: m.staff.cm1.token, body: { rules: stricter() } })).status, 403);
  const ops = await platformLogin(api, m.staff.operations.email);
  const requested = await api.call("POST", "/platform/v1/cancellation-policy/changes", { token: ops, body: { rules: stricter(), note: "商务车免费取消期延长到 72 小时" } });
  assertMatchesOpenApi("POST", "/platform/v1/cancellation-policy/changes", requested);
  assert.deepEqual([requested.status, requested.body.approval.kind, requested.body.approval.status], [202, "cancellation_policy.update", "pending"]);
  assert.match(requested.body.approval.summary, /接送机 · 商务/);
  assert.equal((await ok(api.call("GET", "/platform/v1/cancellation-policy", { token: ops }))).policy.version, 0, "还没生效");
  const self = await api.call("POST", `/platform/v1/approvals/${requested.body.approval.id}/approve`, { token: ops, body: {} });
  assert.equal(self.body.error.code, "APPROVAL_SELF_REVIEW");
  const approved = await api.call("POST", `/platform/v1/approvals/${requested.body.approval.id}/approve`, { token: await platformLogin(api, finance.email), body: {} });
  assert.equal(approved.status, 200, approved.text);
  const now = await ok(api.call("GET", "/tenant/v1/cancellation-policy", { token: m.b.adminToken }));
  assert.equal(now.policy.version, 1);
  assert.deepEqual(now.policy.rules.find((rule: any) => rule.category === "airport_transfer" && rule.level === "business").tiers, [{ min_hours_before: 72, fee_bp: 0 }, { min_hours_before: 24, fee_bp: 3000 }, { min_hours_before: 0, fee_bp: 10000 }]);
  const audit = await api.db.owner.query("select actor_email, after from audit_logs where resource = 'cancellation_policy' and action = 'update'");
  assert.deepEqual(audit.rows.map((row) => [row.actor_email, row.after.version]), [[finance.email, 1]]);

  const later = await flow.paidOrder();
  assert.deepEqual([later.cancel_policy.version, later.cancel_policy.tiers[0]], [1, { min_hours_before: 72, fee_bp: 0 }]);
  // 用车前 60 小时：旧单（48 小时免费）免费，新单（72 小时免费）扣 30%
  const move = new Date(before.service_time).getTime() - 60 * 3_600_000 - api.clock.now().getTime();
  api.clock.advance(move);
  const token = await flow.token();
  const fee = async (orderId: string) => (await ok(api.call("GET", `/sales/v1/orders/${orderId}/cancel-fee`, { token }))).fee_bp;
  assert.deepEqual([await fee(before.id), await fee(later.id)], [0, 3000]);
  const tenantView = await ok(api.call("GET", `/tenant/v1/orders/${later.id}`, { token: await (async () => (await ok(api.call("POST", "/tenant/v1/auth/login", { body: { email: m.b.adminEmail, password: "Quiet-Harbor-2026" } }))).access_token)() }));
  assert.equal(tenantView.order.cancel_policy.version, 1, "供应商在订单里看得到这一单适用的阶梯");
});

test("两条修改同时等审核：先批的生效，后批的已过时（409 APPROVAL_STALE）；不合规则、和现在一样的发起就拦（400）", async () => {
  const ops = await platformLogin(api, m.staff.operations.email);
  const current = (await ok(api.call("GET", "/platform/v1/cancellation-policy", { token: ops }))).policy;
  const tweak = (fee: number) => current.rules.map((rule: any) => (rule.category === "charter" && rule.level === "luxury" ? { ...rule, tiers: [{ min_hours_before: 48, fee_bp: 0 }, { min_hours_before: 24, fee_bp: fee }, { min_hours_before: 0, fee_bp: 10000 }] } : rule));
  const first = await ok(api.call("POST", "/platform/v1/cancellation-policy/changes", { token: ops, body: { rules: tweak(4000) } }), 202);
  const second = await ok(api.call("POST", "/platform/v1/cancellation-policy/changes", { token: ops, body: { rules: tweak(6000) } }), 202);
  const reviewer = await platformLogin(api, ops2.email);
  await ok(api.call("POST", `/platform/v1/approvals/${first.approval.id}/approve`, { token: reviewer, body: {} }));
  const stale = await api.call("POST", `/platform/v1/approvals/${second.approval.id}/approve`, { token: reviewer, body: {} });
  assert.deepEqual([stale.status, stale.body.error.code], [409, "APPROVAL_STALE"]);
  const after = (await ok(api.call("GET", "/platform/v1/cancellation-policy", { token: ops }))).policy;
  assert.equal(after.version, current.version + 1);
  assert.equal(after.rules.find((rule: any) => rule.category === "charter" && rule.level === "luxury").tiers[1].fee_bp, 4000);

  const reasons = async (rules: unknown): Promise<string[]> => {
    const res = await api.call("POST", "/platform/v1/cancellation-policy/changes", { token: ops, body: { rules } });
    assert.equal(res.status, 400, res.text);
    return res.body.error.details.issues.map((issue: any) => issue.reason);
  };
  assert.deepEqual(await reasons(after.rules), ["UNCHANGED"]);
  assert.deepEqual(await reasons(after.rules.slice(1)), ["MISSING_RULE"]);
  const bad = after.rules.map((rule: any, index: number) => (index === 0 ? { ...rule, tiers: [{ min_hours_before: 24, fee_bp: 5000 }, { min_hours_before: 6, fee_bp: 1000 }, { min_hours_before: 0, fee_bp: 10000 }] } : rule));
  assert.deepEqual(await reasons(bad), ["FEE_DECREASING"]);
  const unordered = after.rules.map((rule: any, index: number) => (index === 0 ? { ...rule, tiers: [{ min_hours_before: 6, fee_bp: 0 }, { min_hours_before: 24, fee_bp: 5000 }] } : rule));
  assert.deepEqual(await reasons(unordered), ["HOURS_NOT_DESCENDING", "LAST_TIER_NOT_ZERO"]);
  assert.equal((await api.call("POST", "/platform/v1/cancellation-policy/changes", { token: ops, body: { rules: after.rules, extra: 1 } })).status, 400, "不认识的字段");
});
