/** 汇率人工锁定（M2-06）：汇率页的锁定状态、发起锁定 / 解锁的表单、待审核队列里的这类申请、首页卡片的提示。接口用测试替身；真实后端由集成测试和端到端测试覆盖。 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { Approval } from "../../api/channels.ts";
import type { FxLock, FxOverview } from "../../api/fx.ts";
import type { DashboardSummary } from "../../api/master.ts";
import { type ApiCall, apiError, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T03:04:00.000Z" };
const AS_OF = "2026-10-14T00:02:31.000Z";
const EXPIRES = "2999-01-02T03:00:00.000Z";
const person = (name: string) => ({ id: `id-${name}`, name, email: `${name}@platform.example` });
const lock = (overrides: Partial<FxLock> = {}): FxLock => ({
  id: "0f6c2d3e-0000-4000-8000-000000000001",
  currency: "JPY",
  rate: "151.2",
  reason: "行情剧烈波动",
  expires_at: EXPIRES,
  locked_at: "2026-10-14T01:00:00.000Z",
  central_rate: "150",
  central_as_of: AS_OF,
  deviation_bp: 80,
  lock_approval_id: "0f6c2d3e-0000-4000-8000-0000000000a1",
  requested_by: person("小王"),
  approved_by: person("小李"),
  status: "active",
  ended_at: null,
  end_approval_id: null,
  ended_by: null,
  ...overrides,
});
const approval = (overrides: Partial<Approval> = {}): Approval => ({
  id: "0f6c2d3e-0000-4000-8000-0000000000b1",
  kind: "fx_lock.create",
  resource: "fx_lock",
  resource_id: "CNY",
  summary: "锁定 CNY 汇率：1 USD = 7.3 CNY（中央汇率 7.2，偏离 +1.39%），到 2999-01-02 03:00 UTC",
  payload: { currency: "CNY", rate: "7.3", expires_at: EXPIRES, reason: null, central_rate: "7.2", central_as_of: AS_OF, deviation_bp: 139, replaces_lock_id: null },
  before: { currency: "CNY", rate: null, central_rate: "7.2" },
  base_version: null,
  status: "pending",
  requested_by: person("小王"),
  requested_at: "2026-10-14T02:00:00.000Z",
  request_note: null,
  decided_by: null,
  decided_at: null,
  decision_note: null,
  can: { approve: true, reject: true, withdraw: false },
  ...overrides,
});
const overview = (overrides: Partial<FxOverview> = {}): FxOverview => ({
  base: "USD",
  state: "fresh",
  as_of: AS_OF,
  fetched_at: AS_OF,
  stale_at: "2026-10-16T00:02:31.001Z",
  max_age_hours: 48,
  jump_threshold_bp: 300,
  source: "open.er-api.com",
  rates: [
    { currency: "JPY", rate: "151.2", central_rate: "150", locked: true },
    { currency: "CNY", rate: "7.2", central_rate: "7.2", locked: false },
  ],
  cross: [
    { from: "CNY", to: "JPY", rate: "21", locked: true },
    { from: "CNY", to: "KRW", rate: "194.444444444444", locked: false },
  ],
  source_status: { host: "open.er-api.com", auto_fetch: true, last_attempt: null, last_success_at: AS_OF, next_fetch_at: null },
  held: null,
  locks: [lock()],
  pending_locks: [],
  lock_rules: { max_hours: 72, min_minutes: 30, reason_above_bp: 300, max_deviation_bp: 2000 },
  ...overrides,
});
const me = (role: string) => json(200, { user: { id: "p1", email: "staff@platform.example", name: "测试员工", role, status: "active", ...stamps }, permissions: [], must_change_password: false });
const counts = (active: number) => ({ total: active, active, disabled: 0 });
const summary = (fx: DashboardSummary["fx"]): DashboardSummary => ({
  tenants: null,
  master_data: { cities: counts(1), places: { ...counts(1), by_type: { airport: counts(1), station: counts(0), poi: counts(0), terminal: counts(0), exit: counts(0) }, airports_without_city: 0 }, vehicle_groups: counts(1), addons: counts(1) },
  fx,
});

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;

function open(path: string, role: string, routes: Route = () => null): ApiCall[] {
  signIn("platform", "platform-token");
  const calls = stubApiWith((call) => {
    const custom = routes(call);
    if (custom !== null) return custom;
    if (call.url.pathname === "/platform/v1/auth/me") return me(role);
    if (call.url.pathname === "/platform/v1/fx-rates") return json(200, overview());
    if (call.url.pathname === "/platform/v1/fx-rates/history") return json(200, { base: "USD", from: AS_OF, to: AS_OF, series: [] });
    if (call.url.pathname === "/platform/v1/fx-rates/fetches") return json(200, { items: [] });
    if (call.url.pathname === "/platform/v1/fx-rates/locks" && call.method === "GET") return json(200, { items: [lock(), lock({ id: "0f6c2d3e-0000-4000-8000-000000000002", currency: "CNY", rate: "7.25", status: "released", ended_at: "2026-10-14T05:00:00.000Z", ended_by: person("小张") })] });
    if (call.url.pathname === "/platform/v1/dashboard/summary") return json(200, summary({ state: "fresh", as_of: AS_OF, stale_at: "2026-10-16T00:02:31.001Z", held: false, last_attempt_status: "accepted", locks: [{ currency: "JPY", rate: "151.2", expires_at: EXPIRES }] }));
    if (call.url.pathname === "/platform/v1/approvals" && call.method === "GET") return json(200, { items: [approval()], next_cursor: null, total: 1 });
    return null;
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}
const main = (): HTMLElement => document.querySelector("main") as HTMLElement;
const lockCard = async (): Promise<HTMLElement> => (await within(main()).findByRole("heading", { level: 2, name: "人工锁定" })).closest("section") as HTMLElement;

test("汇率页的锁定状态：哪个币种、锁定值、批准时的中央汇率、到期时间、谁发起谁批准；汇率表里锁定的值有标记、另列中央汇率；只读没有按钮", async () => {
  open("/platform/master/fx-rates", "readonly");
  const card = await lockCard();
  const row = within(within(card).getByRole("region", { name: "生效中的锁定" })).getByText("JPY 日元").closest("tr") as HTMLElement;
  assert.match(row.textContent ?? "", /151\.2/);
  assert.match(row.textContent ?? "", /150（\+0\.80%）/);
  assert.match(row.textContent ?? "", /小王 \/ 小李/);
  assert.match(row.textContent ?? "", /行情剧烈波动/);
  assert.equal(within(card).queryByRole("button"), null, "只读不能发起、不能解锁");
  const rates = within(main()).getByRole("region", { name: "当前汇率表" });
  const jpy = within(rates).getByRole("rowheader", { name: "JPY 日元" }).closest("tr") as HTMLElement;
  assert.ok(within(jpy).getByText("（用了人工锁定的汇率）"));
  assert.ok(within(jpy).getByTitle("150"), "右边一列是中央汇率");
  const matrix = within(main()).getByRole("region", { name: "币种互换表" });
  const cny = within(matrix).getByRole("rowheader", { name: "CNY" }).closest("tr") as HTMLElement;
  assert.equal(within(cny).getAllByText("（用了人工锁定的汇率）").length, 1, "只有 CNY→JPY 那一格用了锁定");
  // 锁定记录：含已结束的
  const history = await within(main()).findByRole("region", { name: "锁定记录表" });
  await within(history).findByText("已解锁");
  assert.match(history.textContent ?? "", /小张 批准解锁/);
});

test("没有锁定时：卡片说现在没有锁定，汇率表不多出一列；过期提示条里说明锁定的币种和美元之间照常报价", async () => {
  open("/platform/master/fx-rates", "readonly", (call) => (call.url.pathname === "/platform/v1/fx-rates" ? json(200, overview({ locks: [], rates: [{ currency: "JPY", rate: "150", central_rate: "150", locked: false }], cross: [] })) : null));
  const card = await lockCard();
  assert.ok(within(card).getByText("现在没有锁定的汇率。"));
  assert.equal(within(main()).queryByRole("columnheader", { name: "数据源（中央汇率）" }), null);
  resetBrowser();
  open("/platform/master/fx-rates", "readonly", (call) => (call.url.pathname === "/platform/v1/fx-rates" ? json(200, overview({ state: "stale" })) : null));
  const alert = (await within(main()).findByText("汇率超过 48 小时没有更新，跨币种报价已暂停")).closest(".alert") as HTMLElement;
  assert.match(alert.textContent ?? "", /人工锁定的币种（JPY）和美元之间照常报价/);
});

test("发起锁定（主数据运营）：锁定值按字符串解析、实时显示和中央汇率的偏离；超过 3% 没写原因不提交；提交后提示要另一位同事审核", async () => {
  const actor = userEvent.setup();
  const calls = open("/platform/master/fx-rates", "master_data", (call) =>
    call.method === "POST" && call.url.pathname === "/platform/v1/fx-rates/locks" ? json(202, { approval: approval({ resource_id: "JPY", can: { approve: false, reject: false, withdraw: true } }) }) : null,
  );
  const card = await lockCard();
  await actor.click(within(card).getByRole("button", { name: "发起锁定" }));
  const dialog = await screen.findByRole("dialog", { name: "改 JPY 的锁定" });
  assert.match(dialog.textContent ?? "", /现在的中央汇率：1 USD = 150 JPY；现在锁定在 151\.2/);
  await actor.selectOptions(within(dialog).getByLabelText("币种"), "CNY");
  assert.ok(await within(dialog).findByText("现在的中央汇率：1 USD = 7.2 CNY"));
  const rate = within(dialog).getByLabelText("锁定值（1 USD = ? CNY）");
  await actor.type(rate, "1.5e2");
  assert.ok(within(dialog).getByText(/写成大于 0 的十进制数/));
  await actor.clear(rate);
  await actor.type(rate, "7.5");
  assert.ok(within(dialog).getByText("和中央汇率相差 +4.17%"));
  await actor.click(within(dialog).getByRole("button", { name: "提交审核" }));
  assert.ok(within(dialog).getByText("和中央汇率相差超过 3%，请写明原因"));
  assert.equal(calls.filter((call) => call.method === "POST").length, 0, "没写原因不提交");
  await actor.type(within(dialog).getByLabelText("原因（必填）"), "数据源停更，按银行牌价");
  await actor.selectOptions(within(dialog).getByLabelText("锁定多久"), "72");
  await actor.click(within(dialog).getByRole("button", { name: "提交审核" }));
  await within(main()).findByText("已提交，等另一位有审核权限的同事在「待审核」里批准后生效");
  const post = calls.find((call) => call.method === "POST") as ApiCall;
  const body = post.body as { currency: string; rate: string; expires_at: string; reason: string };
  assert.deepEqual([body.currency, body.rate, body.reason], ["CNY", "7.5", "数据源停更，按银行牌价"]);
  const hours = (new Date(body.expires_at).getTime() - Date.now()) / 3_600_000;
  assert.ok(hours > 71.9 && hours <= 72, `到期时间是从现在起 72 小时：${hours}`);
});

test("发起锁定：服务器拒收的原因放回对应的字段；解锁要确认、提交后同样等审核", async () => {
  const actor = userEvent.setup();
  const calls = open("/platform/master/fx-rates", "super_admin", (call) => {
    if (call.method === "POST" && call.url.pathname === "/platform/v1/fx-rates/locks") return apiError(400, "VALIDATION_FAILED", "请求参数校验未通过", { location: "body", issues: [{ path: "/rate", reason: "DEVIATION_TOO_LARGE", message: "和现在的中央汇率相差超过 20%" }] });
    if (call.method === "POST" && call.url.pathname.endsWith("/release")) return json(202, { approval: approval({ kind: "fx_lock.release", resource_id: "JPY" }) });
    return null;
  });
  const card = await lockCard();
  await actor.click(within(card).getByRole("button", { name: "发起锁定" }));
  const dialog = await screen.findByRole("dialog");
  await actor.selectOptions(within(dialog).getByLabelText("币种"), "KRW");
  await actor.type(within(dialog).getByLabelText("锁定值（1 USD = ? KRW）"), "1400");
  await actor.click(within(dialog).getByRole("button", { name: "提交审核" }));
  assert.ok(await within(dialog).findByText("和中央汇率相差超过 20%，系统不允许；请核对币种和数量级"));
  await actor.click(within(dialog).getByRole("button", { name: "取消" }));
  // 解锁
  await actor.click(within(card).getByRole("button", { name: "解锁" }));
  const unlock = await screen.findByRole("dialog", { name: "解除 JPY 的锁定？" });
  await actor.type(within(unlock).getByLabelText("原因（选填）"), "行情恢复");
  await actor.click(within(unlock).getByRole("button", { name: "提交审核" }));
  await within(main()).findByText("已提交，等另一位有审核权限的同事在「待审核」里批准后生效");
  const release = calls.find((call) => call.method === "POST" && call.path.endsWith("/release")) as ApiCall;
  assert.deepEqual([release.path, release.body], [`/platform/v1/fx-rates/locks/${lock().id}/release`, { reason: "行情恢复" }]);
});

test("待审核的锁定申请：汇率页列出来（能审的人有去处理的链接，发起人看到要等别人）；待审核队列里写清锁定值、到期时间、偏离，能批准", async () => {
  const actor = userEvent.setup();
  open("/platform/master/fx-rates", "master_data", (call) =>
    call.url.pathname === "/platform/v1/fx-rates" ? json(200, overview({ pending_locks: [approval(), approval({ id: "0f6c2d3e-0000-4000-8000-0000000000b2", kind: "fx_lock.release", summary: "解除 JPY 的锁定", can: { approve: false, reject: false, withdraw: true } })] })) : null,
  );
  const card = await lockCard();
  const items = within(card).getAllByRole("listitem");
  assert.equal(items.length, 2);
  assert.ok(within(items[0] as HTMLElement).getByRole("link", { name: "去待审核处理" }));
  assert.match(items[1]?.textContent ?? "", /解除汇率锁定.*这是你发起的/);
  resetBrowser();
  const calls = open("/platform/approvals", "master_data", (call) => (call.method === "POST" && call.url.pathname.endsWith("/approve") ? json(200, { approval: approval({ status: "approved", decided_by: person("测试员工"), decided_at: "2026-10-14T03:00:00.000Z", can: { approve: false, reject: false, withdraw: false } }) }) : null));
  const heading = await screen.findByRole("heading", { name: "锁定汇率" });
  const approvalCard = heading.closest("section") as HTMLElement;
  assert.equal(within(approvalCard).getByRole("link", { name: /CNY 人民币（去汇率页）/ }).getAttribute("href"), "/platform/master/fx-rates");
  const changes = within(approvalCard).getByRole("region", { name: "改了什么" });
  assert.match(changes.textContent ?? "", /锁定值未锁定（中央汇率 1 USD = 7\.2 CNY）1 USD = 7\.3 CNY/);
  assert.match(changes.textContent ?? "", /和发起时中央汇率的偏离—\+1\.39%/);
  // 汇率锁定类复核的按钮读屏名字同样带摘要和发起时间（M1-17）
  const approve = within(approvalCard).getByRole("button", { name: /^批准：/ });
  assert.equal(approve.getAttribute("aria-label")?.startsWith(`批准：${approval().summary}（`), true);
  assert.equal(approve.textContent, "批准");
  await actor.click(approve);
  const dialog = await screen.findByRole("dialog");
  assert.ok(within(dialog).getByText(/之后的报价就按新的汇率算/));
  await actor.click(within(dialog).getByRole("button", { name: "批准" }));
  await waitFor(() => assert.ok(calls.some((call) => call.method === "POST" && call.path.endsWith(`/approvals/${approval().id}/approve`))));
});

test("首页汇率卡片：有锁定时提示哪些币种锁定到什么时候；主数据运营有「待审核」入口", async () => {
  open("/platform", "master_data");
  const card = (await within(main()).findByRole("link", { name: /^汇率/ })).closest(".entry-card") as HTMLElement;
  const reminder = await within(card).findByRole("link", { name: /人工锁定中：JPY（到 / });
  assert.equal(reminder.getAttribute("href"), "/platform/master/fx-rates");
  assert.ok(await within(main()).findByRole("link", { name: /^待审核/ }));
});
