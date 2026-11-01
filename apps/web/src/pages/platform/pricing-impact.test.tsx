/**
 * M3-07：加价规则 / 定价参数生效前的毛利试算（ADR 0033）的组件测试。
 * 发起修改的对话框里试算（请求体和发起复核同形；内容改了旧结果作废），删除规则打开就算；待审核里显示发起时存下的试算、能「按现在的数据再算一次」。
 * 接口用测试替身；真实后端由集成测试 pricing-impact.itest.ts 和端到端测试 e2e/pricing-impact.spec.ts 覆盖。
 */
import { roleName } from "../../lib/portal.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { Approval, Channel, ChannelDetail, MarkupRule, PricingImpact } from "../../api/channels.ts";
import type { City, VehicleGroup } from "../../api/master.ts";
import type { PlatformUser, Tenant } from "../../api/types.ts";
import { type ApiCall, apiError, json, resetBrowser, signIn, stubApiWith, TENANT_EXTRAS } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-10-06T00:12:00.000Z", updated_at: "2026-10-08T05:30:00.000Z" };
const CHANNEL_ID = "c1c1c1c1-aaaa-4bbb-8ccc-ddddeeeeffff";
const TENANT_ID = "7b1c2d3e-aaaa-4bbb-8ccc-ddddeeeeffff";
const RULE_ID = "88888888-8888-4888-8888-888888888888";
const APPROVAL_ID = "a0a0a0a0-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ME_ID = "99999999-9999-4999-8999-999999999999";
const OTHER_ID = "98989898-9898-4898-8898-989898989898";

const meOf = (role: string): PlatformUser => ({ id: ME_ID, email: "kato@example.com", name: "加藤", role: role as PlatformUser["role"], role_name: roleName("platform", role) ?? role, status: "active", ...stamps });
const tenant: Tenant = { id: TENANT_ID, name: "NOZOMI 自营车队", status: "active", ...TENANT_EXTRAS, ...stamps };
const tokyo: City = { id: "11111111-1111-4111-8111-111111111111", code: "CTY-JP-TYO", country_code: "JP", name: { zh: "东京" }, timezone: "Asia/Tokyo", center: { lng: 139.7, lat: 35.7 }, boundary: null, status: "active", version: 1, ...stamps };
const group: VehicleGroup = { id: "55555555-5555-4555-8555-555555555555", code: "VG-BIZ-7", grade: "business", seats: 7, name: { zh: "商务七座" }, sample_models: [], power: "fuel", combos: [{ passengers: 6, luggage: 4 }], status: "active", version: 1, ...stamps };
const channel: Channel = {
  id: CHANNEL_ID,
  name: "NOZOMI 官网",
  type: "own",
  status: "active",
  company: null,
  contact_name: null,
  contact_email: null,
  contact_phone: null,
  contract_ref: null,
  notes: null,
  settle_currency: "JPY",
  payment_mode: "prepaid",
  credit_limit: null,
  show_tenant_after_pay: true,
  scope: { tenant_scope: "all", tenants: [], cities: null, categories: ["airport_transfer", "point_to_point", "charter"] },
  pricing: { default_markup_bp: 1000, markup_floor_bp: 1000, band_bp: 300, min_margin: 0, sell_rounding: {} },
  version: 1,
  pricing_version: 1,
  ...stamps,
};
const rule: MarkupRule = { id: RULE_ID, level: 2, tenant: { id: TENANT_ID, name: "NOZOMI 自营车队" }, city: null, category: null, vehicle_group: null, markup_bp: 1500, valid_from: null, valid_to: null, note: null, version: 3, ...stamps };
const detail: ChannelDetail = { channel, markup_rules: [rule] };

const totals = (sell: number, settlement: number) => ({ sell_minor: sell, settlement_minor: settlement, margin_minor: sell - settlement });
const section = (overrides: Record<string, unknown> = {}) => ({
  total: 7,
  truncated: false,
  count: 7,
  skipped: 0,
  before: totals(135_300, 123_000),
  after: totals(136_400, 124_000),
  diff: totals(1_100, 1_000),
  winner_changed: 5,
  min_margin_raised_before: 0,
  min_margin_raised_after: 2,
  became_unquotable: 0,
  became_quotable: 0,
  ...overrides,
});
const impactOf = (overrides: Partial<PricingImpact> = {}): PricingImpact => ({
  computed_at: "2026-10-08T05:30:00.000Z",
  window_days: 30,
  from: "2026-09-08T05:30:00.000Z",
  to: "2026-10-08T05:30:00.000Z",
  settle_currency: "JPY",
  quotes: section(),
  orders: { ...section({ total: 4, count: 3, before: totals(45_870, 41_700), after: totals(46_200, 42_000), diff: totals(330, 300), winner_changed: 2 }), cancelled_with_fee: 1, cancelled_free: 1 },
  ...overrides,
});
const approvalOf = (changes: Partial<Approval> = {}): Approval => ({
  id: APPROVAL_ID,
  kind: "markup_rule.create",
  resource: "channel",
  resource_id: CHANNEL_ID,
  summary: "「NOZOMI 官网」新增加价规则：NOZOMI 自营车队 = 15%",
  payload: { level: 2, tenant_id: TENANT_ID, city_id: null, category: null, vehicle_group_id: null, markup_bp: 1500, valid_from: null, valid_to: null, note: null },
  before: null,
  base_version: null,
  status: "pending",
  requested_by: { id: OTHER_ID, name: "佐藤", email: "sato@example.com" },
  requested_at: "2026-10-08T05:30:00.000Z",
  request_note: null,
  decided_by: null,
  decided_at: null,
  decision_note: null,
  impact: impactOf(),
  can: { approve: true, reject: true, withdraw: false },
  ...changes,
});
const page = <T,>(items: T[]) => json(200, { items, next_cursor: null, total: items.length });

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;
function open(path: string, role: string, routes: Route = () => null, approvals: Approval[] = [approvalOf()]): ApiCall[] {
  signIn("platform", "platform-token");
  const calls = stubApiWith((call) => {
    const custom = routes(call);
    if (custom !== null) return custom;
    if (call.method !== "GET") return null;
    const at = call.url.pathname;
    if (at === "/platform/v1/auth/me") return json(200, { user: meOf(role), permissions: [], must_change_password: false });
    if (at === "/platform/v1/channels") return page([channel]);
    if (at === "/platform/v1/approvals") return call.url.searchParams.get("resource_id") !== null ? page([]) : page(approvals);
    if (at === `/platform/v1/channels/${CHANNEL_ID}`) return json(200, detail);
    if (at === `/platform/v1/channels/${CHANNEL_ID}/api-clients`) return page([]);
    if (at === `/platform/v1/channels/${CHANNEL_ID}/quote-logs`) return json(200, { items: [], next_cursor: null });
    if (at === "/platform/v1/tenants") return json(200, { items: [tenant], next_cursor: null });
    if (at === "/platform/v1/city-options") return json(200, { items: [tokyo].map(({ id, code, name, country_code, timezone }) => ({ id, code, name, country_code, timezone })) });
    if (at === "/platform/v1/vehicle-group-options") return json(200, { items: [group].map(({ id, code, name }) => ({ id, code, name })) });
    return null;
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}
const user = () => userEvent.setup();
const impactCalls = (calls: ApiCall[]): ApiCall[] => calls.filter((call) => call.method === "POST" && call.path.endsWith("/pricing-impact"));
const impactRoute: Route = (call) => (call.method === "POST" && call.url.pathname.endsWith("/pricing-impact") ? json(200, { impact: impactOf() }) : null);

test("改定价参数的对话框：试算按发起复核同样的内容发（kind = channel.pricing），显示订单和询价的改前 / 改后 / 差额、中标换人数，写明是估算；改了内容旧结果作废", async () => {
  const actor = user();
  const calls = open(`/platform/channels/${CHANNEL_ID}`, "channel_manager", impactRoute);
  await screen.findByRole("heading", { level: 1, name: "NOZOMI 官网" });
  await actor.click(screen.getByRole("button", { name: "申请修改定价参数" }));
  const dialog = await screen.findByRole("dialog", { name: "申请修改定价参数" });
  await actor.clear(within(dialog).getByRole("textbox", { name: "默认加价比例（%）" }));
  await actor.type(within(dialog).getByRole("textbox", { name: "默认加价比例（%）" }), "12");
  await actor.click(within(dialog).getByRole("button", { name: "试算近 30 天毛利影响" }));
  const result = await within(dialog).findByRole("region", { name: "近 30 天毛利试算" });
  assert.deepEqual(impactCalls(calls).map((call) => [call.path, call.body]), [[`/platform/v1/channels/${CHANNEL_ID}/pricing-impact`, { kind: "channel.pricing", change: { default_markup_bp: 1200, markup_floor_bp: 1000, band_bp: 300, min_margin: 0, sell_rounding: {} } }]]);
  const orders = within(result).getByRole("region", { name: "付过款的订单" });
  const marginRow = within(orders).getByRole("row", { name: /毛利/ });
  assert.deepEqual(within(marginRow).getAllByRole("cell").map((cell) => cell.textContent), ["JPY 4,170", "JPY 4,200", "+JPY 30"]);
  assert.ok(within(orders).getByText("付过款的订单：3 单"));
  assert.ok(within(result).getByText("中标会换人：2 单"));
  assert.ok(within(result).getByText("中标会换人：5 个"));
  assert.ok(within(result).getByText("要按最低毛利补价：改前 0 个，改后 2 个"));
  assert.ok(within(result).getByText("其中付款后有偿取消、按扣款比例计入：1 单"));
  assert.ok(within(result).getByText(/这是估算：.*客人面对新的价格还会不会下单，无法知道/));
  // 改了内容：旧结果不再显示，提示重新试算；改「给审核人的说明」不算改内容
  await actor.type(within(dialog).getByRole("textbox", { name: "给审核人的说明（选填）" }), "旺季");
  assert.ok(within(dialog).getByRole("region", { name: "近 30 天毛利试算" }));
  await actor.type(within(dialog).getByRole("textbox", { name: "默认加价比例（%）" }), ".5");
  assert.equal(within(dialog).queryByRole("region", { name: "近 30 天毛利试算" }), null);
  assert.ok(within(dialog).getByText("内容改过了，上次的结果不再适用，请重新试算。"));
  // 填得不对时不能试算
  await actor.clear(within(dialog).getByRole("textbox", { name: "默认加价比例（%）" }));
  assert.equal((within(dialog).getByRole("button", { name: "重新试算" }) as HTMLButtonElement).disabled, true);
});

test("加价规则的对话框：试算发 markup_rule.create / update（修改时带 rule_id）；后端拦下的原因写出来", async () => {
  const actor = user();
  let reject = false;
  const calls = open(`/platform/channels/${CHANNEL_ID}`, "channel_manager", (call) => {
    if (call.method === "POST" && call.url.pathname.endsWith("/pricing-impact")) return reject ? apiError(409, "MARKUP_RULE_CONFLICT", "冲突") : json(200, { impact: impactOf() });
    return null;
  });
  await screen.findByRole("heading", { level: 1, name: "NOZOMI 官网" });
  await actor.click(screen.getByRole("button", { name: /修改 .* 的规则/ }));
  const dialog = await screen.findByRole("dialog", { name: "修改加价规则" });
  await actor.clear(within(dialog).getByRole("textbox", { name: "加价比例（%）" }));
  await actor.type(within(dialog).getByRole("textbox", { name: "加价比例（%）" }), "12");
  await actor.click(within(dialog).getByRole("button", { name: "试算近 30 天毛利影响" }));
  await within(dialog).findByRole("region", { name: "近 30 天毛利试算" });
  const sent = impactCalls(calls)[0]?.body as any;
  assert.deepEqual([sent.kind, sent.rule_id, sent.rule.tenant_id, sent.rule.markup_bp, sent.rule.request_note], ["markup_rule.update", RULE_ID, TENANT_ID, 1200, null]);
  reject = true;
  await actor.click(within(dialog).getByRole("button", { name: "重新试算" }));
  assert.ok(await within(dialog).findByText(/没法试算：同一组维度上已经有一条规则/));
  assert.equal(within(dialog).queryByRole("region", { name: "近 30 天毛利试算" }), null);
});

test("删除加价规则：对话框一打开就试算（kind = markup_rule.delete）", async () => {
  const actor = user();
  const calls = open(`/platform/channels/${CHANNEL_ID}`, "channel_manager", impactRoute);
  await screen.findByRole("heading", { level: 1, name: "NOZOMI 官网" });
  await actor.click(screen.getByRole("button", { name: /删除 .* 的规则/ }));
  const dialog = await screen.findByRole("dialog", { name: "申请删除加价规则" });
  await within(dialog).findByRole("region", { name: "近 30 天毛利试算" });
  assert.deepEqual(impactCalls(calls).map((call) => call.body), [{ kind: "markup_rule.delete", rule_id: RULE_ID }]);
});

test("待审核：审核人看到发起时存下的试算；「按现在的数据再算一次」调复核的试算接口、另外显示，存的那一份还在", async () => {
  const actor = user();
  const now = impactOf({ computed_at: "2026-10-09T01:00:00.000Z", orders: { ...impactOf().orders, count: 4, diff: totals(550, 500) } });
  const calls = open("/platform/approvals", "channel_manager", (call) => (call.method === "POST" && call.url.pathname === `/platform/v1/approvals/${APPROVAL_ID}/pricing-impact` ? json(200, { impact: now }) : null));
  const stored = await screen.findByRole("region", { name: "发起时的毛利试算（近 30 天）" });
  assert.ok(within(stored).getByText("付过款的订单：3 单"));
  await actor.click(screen.getByRole("button", { name: /按现在的数据再算一次/ }));
  const fresh = await screen.findByRole("region", { name: "按现在的数据再算的结果" });
  assert.ok(within(fresh).getByText("付过款的订单：4 单"));
  assert.ok(screen.getByRole("region", { name: "发起时的毛利试算（近 30 天）" }));
  assert.deepEqual(impactCalls(calls).map((call) => call.path), [`/platform/v1/approvals/${APPROVAL_ID}/pricing-impact`]);
});

test("待审核：没有审核、发起权限的只看存下的结果，没有「再算一次」；暂停渠道这类不涉及定价的复核不显示试算；没存试算的写明", async () => {
  open("/platform/approvals", "readonly", () => null, [
    approvalOf({ can: { approve: false, reject: false, withdraw: false } }),
    approvalOf({ id: "a1a1a1a1-aaaa-4aaa-8aaa-aaaaaaaaaaaa", kind: "channel.pause", summary: "暂停渠道「NOZOMI 官网」", impact: null, payload: { status: "paused" }, before: { status: "active" } }),
    approvalOf({ id: "a2a2a2a2-aaaa-4aaa-8aaa-aaaaaaaaaaaa", kind: "channel.pricing", summary: "「NOZOMI 官网」改定价参数：默认加价 10% → 12%", impact: null, payload: { default_markup_bp: 1200, markup_floor_bp: 1000, band_bp: 300, min_margin_minor: 0, sell_rounding: {} }, before: { default_markup_bp: 1000, markup_floor_bp: 1000, band_bp: 300, min_margin_minor: 0, sell_rounding: {} }, can: { approve: false, reject: false, withdraw: false } }),
  ]);
  await screen.findByRole("region", { name: "发起时的毛利试算（近 30 天）" });
  assert.equal(screen.queryAllByRole("button", { name: /按现在的数据再算一次/ }).length, 0);
  assert.equal(screen.getAllByRole("region", { name: "发起时的毛利试算（近 30 天）" }).length, 1, "暂停渠道没有试算");
  assert.ok(screen.getByText("这条复核发起时没有保存毛利试算（M3-07 之前发起的）。"));
});

test("待审核：再算一次失败（规则已被删）写出原因", async () => {
  const actor = user();
  open("/platform/approvals", "channel_manager", (call) => (call.method === "POST" && call.url.pathname.endsWith("/pricing-impact") ? apiError(409, "APPROVAL_STALE", "要改的这条加价规则已经被删除了，无法试算；请驳回") : null));
  await screen.findByRole("region", { name: "发起时的毛利试算（近 30 天）" });
  await actor.click(screen.getByRole("button", { name: /按现在的数据再算一次/ }));
  assert.ok(await screen.findByText("没法试算：要改的这条加价规则已经被删除了，无法试算；请驳回。"));
  await waitFor(() => assert.equal(screen.queryByRole("region", { name: "按现在的数据再算的结果" }), null));
});
