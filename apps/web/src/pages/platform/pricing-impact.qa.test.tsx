/**
 * M3-07 测试角色补充：毛利试算的界面边界（ADR 0033）。
 * - 慢的试算结果回来时内容已经改了：不能当成新内容的结果显示。
 * - 试算失败后改了内容：旧的失败原因也不再适用。
 * - 规则对话框只改「给审核人的说明」不作废结果，说明也不发给试算接口。
 * - 结果里截断、没法重算、改后报不出 / 报得出、免费取消都写出来；负的差额带「−」，美元按分显示。
 * - 「再算一次」：发起人（只能撤回）也有；已批准的没有。
 * 已知缺陷（留着当前失败的复现测试）：试算失败后改了内容，旧的失败原因还留着（PricingImpactPanel.tsx 的 ImpactPreview 只按内容作废结果，没作废失败原因）。
 */
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

const meOf = (role: string): PlatformUser => ({ id: ME_ID, email: "kato@example.com", name: "加藤", role: role as PlatformUser["role"], status: "active", ...stamps });
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
    if (at === "/platform/v1/master/cities") return page([tokyo]);
    if (at === "/platform/v1/master/vehicle-groups") return page([group]);
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


test("慢的试算回来时内容已经改了：结果不当成新内容的显示，提示重新试算", async () => {
  const actor = user();
  let release: (() => void) | null = null;
  const calls = open(`/platform/channels/${CHANNEL_ID}`, "channel_manager", (call) => {
    if (call.method === "POST" && call.url.pathname.endsWith("/pricing-impact")) {
      return new Promise<Response>((resolve) => {
        release = () => resolve(json(200, { impact: impactOf() }));
      });
    }
    return null;
  });
  await screen.findByRole("heading", { level: 1, name: "NOZOMI 官网" });
  await actor.click(screen.getByRole("button", { name: "申请修改定价参数" }));
  const dialog = await screen.findByRole("dialog", { name: "申请修改定价参数" });
  const markup = within(dialog).getByRole("textbox", { name: "默认加价比例（%）" });
  await actor.clear(markup);
  await actor.type(markup, "12");
  await actor.click(within(dialog).getByRole("button", { name: "试算近 30 天毛利影响" }));
  await waitFor(() => assert.equal(impactCalls(calls).length, 1));
  // 还在算：把比例改成 13，再放行 12 的结果
  await actor.clear(markup);
  await actor.type(markup, "13");
  (release as unknown as () => void)();
  await within(dialog).findByText("内容改过了，上次的结果不再适用，请重新试算。");
  assert.equal(within(dialog).queryByRole("region", { name: "近 30 天毛利试算" }) !== null, false, "12% 的结果不能当成 13% 的显示");
  assert.equal((impactCalls(calls)[0]?.body as any).change.default_markup_bp, 1200);
});

test("试算失败后改了内容：旧的失败原因不再显示（和旧结果一样作废）", async () => {
  const actor = user();
  open(`/platform/channels/${CHANNEL_ID}`, "channel_manager", (call) => (call.method === "POST" && call.url.pathname.endsWith("/pricing-impact") ? apiError(409, "MARKUP_RULE_CONFLICT", "冲突") : null));
  await screen.findByRole("heading", { level: 1, name: "NOZOMI 官网" });
  await actor.click(screen.getByRole("button", { name: /修改 .* 的规则/ }));
  const dialog = await screen.findByRole("dialog", { name: "修改加价规则" });
  const markup = within(dialog).getByRole("textbox", { name: "加价比例（%）" });
  await actor.clear(markup);
  await actor.type(markup, "12");
  await actor.click(within(dialog).getByRole("button", { name: "试算近 30 天毛利影响" }));
  await within(dialog).findByText(/没法试算：同一组维度上已经有一条规则/);
  await actor.type(markup, "5");
  assert.equal(within(dialog).queryByText(/没法试算：同一组维度上已经有一条规则/) !== null, false, "内容改了，上次的失败原因不再适用");
});

test("规则对话框：只改「给审核人的说明」不作废结果，说明也不发给试算接口", async () => {
  const actor = user();
  const calls = open(`/platform/channels/${CHANNEL_ID}`, "channel_manager", impactRoute);
  await screen.findByRole("heading", { level: 1, name: "NOZOMI 官网" });
  await actor.click(screen.getByRole("button", { name: /修改 .* 的规则/ }));
  const dialog = await screen.findByRole("dialog", { name: "修改加价规则" });
  await actor.type(within(dialog).getByRole("textbox", { name: "给审核人的说明（选填）" }), "旺季");
  await actor.click(within(dialog).getByRole("button", { name: "试算近 30 天毛利影响" }));
  await within(dialog).findByRole("region", { name: "近 30 天毛利试算" });
  await actor.type(within(dialog).getByRole("textbox", { name: "给审核人的说明（选填）" }), "，请尽快");
  assert.ok(within(dialog).getByRole("region", { name: "近 30 天毛利试算" }));
  assert.equal(within(dialog).queryByText("内容改过了，上次的结果不再适用，请重新试算。") !== null, false);
  assert.equal((impactCalls(calls)[0]?.body as any).rule.request_note, null);
  // 改备注（会存进规则）算改内容
  await actor.type(within(dialog).getByRole("textbox", { name: "备注（选填）" }), "促销");
  assert.equal(within(dialog).queryByRole("region", { name: "近 30 天毛利试算" }) !== null, false);
});

test("结果：截断写出总数；没法重算、改后报不出 / 报得出、免费取消都写出来；负的差额带「−」，美元按分显示", async () => {
  const usd = impactOf({
    settle_currency: "USD",
    quotes: section({ total: 100_250, truncated: true, count: 100_000, skipped: 12, became_unquotable: 3, became_quotable: 1, before: totals(1_000_000, 900_000), after: totals(999_850, 900_000), diff: totals(-150, 0) }),
    orders: { ...section({ total: 6, count: 3, before: totals(30_000, 27_000), after: totals(29_000, 27_000), diff: totals(-1_000, 0) }), cancelled_with_fee: 0, cancelled_free: 2 },
  });
  open("/platform/approvals", "channel_manager", () => null, [approvalOf({ impact: usd })]);
  const stored = await screen.findByRole("region", { name: "发起时的毛利试算（近 30 天）" });
  assert.ok(within(stored).getByText(/^询价（每个车型组一个报价）：100,?000 个（共 100,?250 个，只算了最近的这些）$/));
  assert.ok(within(stored).getByText("付过款的订单：3 单"));
  assert.ok(within(stored).getByText("缺报价时的汇率、没法重算（没计入）：12 个"));
  assert.ok(within(stored).getByText("改后报不出价：3 个"));
  assert.ok(within(stored).getByText("改后能报出价（改前报不出）：1 个"));
  assert.ok(within(stored).getByText("免费取消（毛利为 0，没计入）：2 单"));
  assert.equal(within(stored).queryByText(/有偿取消/) !== null, false);
  const quotes = within(stored).getByRole("region", { name: "询价（每个车型组一个报价）" });
  const margin = within(within(quotes).getByRole("row", { name: /毛利/ })).getAllByRole("cell").map((cell) => cell.textContent);
  assert.deepEqual(margin, ["USD 1,000.00", "USD 998.50", "−USD 1.50"]);
  const orders = within(stored).getByRole("region", { name: "付过款的订单" });
  const settlement = within(within(orders).getByRole("row", { name: /结算价合计/ })).getAllByRole("cell").map((cell) => cell.textContent);
  assert.deepEqual(settlement, ["USD 270.00", "USD 270.00", "USD 0.00"]);
  assert.ok(within(stored).getByText(/这是估算/));
  assert.ok(within(stored).getByText(/金额按报价时的汇率换成渠道结算币种/));
});

test("「再算一次」：发起人（只能撤回）也有", async () => {
  open("/platform/approvals", "channel_manager", () => null, [
    approvalOf({ can: { approve: false, reject: false, withdraw: true } }),
  ]);
  await screen.findByRole("region", { name: "发起时的毛利试算（近 30 天）" });
  assert.equal(screen.getAllByRole("button", { name: /按现在的数据再算一次/ }).length, 1);
});

test("「再算一次」：有结论的复核（已批准）只显示发起时的结果", async () => {
  open("/platform/approvals", "channel_manager", (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/approvals" ? page([approvalOf({ status: "approved", can: { approve: false, reject: false, withdraw: false } })]) : null));
  await screen.findByRole("region", { name: "发起时的毛利试算（近 30 天）" });
  assert.equal(screen.queryAllByRole("button", { name: /按现在的数据再算一次/ }).length, 0);
});
