/**
 * 汇率页（M2-03）测试角色补充：接口用测试替身，路由用真实的 <App>。
 * 覆盖立即拉取进行中（转圈文字、连点只发一次）、网络失败 / 403 / 已被处理的挂起批次的提示、看板加载失败可重试、
 * 走势和拉取记录的空状态、定时拉取关闭时的说明、过期提醒对有权限的人给出操作指引、确认对话框连点只提交一次。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { FxFetch, FxHistory, FxOverview } from "../../api/fx.ts";
import { type ApiCall, apiError, deferred, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T03:04:00.000Z" };
const AS_OF = "2026-10-14T00:02:31.000Z";
const record = (overrides: Partial<FxFetch> = {}): FxFetch => ({
  id: "7",
  started_at: "2026-10-14T00:10:00.000Z",
  finished_at: "2026-10-14T00:10:01.000Z",
  trigger: "schedule",
  triggered_by: null,
  source: "open.er-api.com",
  status: "accepted",
  error_code: null,
  error_detail: null,
  source_as_of: AS_OF,
  source_next_update_at: null,
  held_rates: null,
  jumps: null,
  decided_by: null,
  decided_at: null,
  ...overrides,
});
const board = (overrides: Partial<FxOverview> = {}): FxOverview => ({
  base: "USD",
  state: "fresh",
  as_of: AS_OF,
  fetched_at: "2026-10-14T00:10:01.000Z",
  stale_at: "2026-10-16T00:02:31.001Z",
  max_age_hours: 48,
  jump_threshold_bp: 300,
  source: "open.er-api.com",
  rates: [{ currency: "JPY", rate: "151.21" }],
  cross: [],
  source_status: { host: "open.er-api.com", auto_fetch: true, last_attempt: record(), last_success_at: "2026-10-14T00:10:01.000Z", next_fetch_at: "2026-10-14T12:10:01.000Z" },
  held: null,
  ...overrides,
});
const emptyHistory: FxHistory = { base: "USD", from: "2026-09-14T00:00:00.000Z", to: "2026-10-14T01:00:00.000Z", series: [{ currency: "JPY", points: [] }] };
const me = (role: string) => json(200, { user: { id: "p1", email: "staff@platform.example", name: "测试员工", role, status: "active", ...stamps }, permissions: [], must_change_password: false });

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;

function open(role: string, routes: Route = () => null): ApiCall[] {
  signIn("platform", "platform-token");
  const calls = stubApiWith((call) => {
    const custom = routes(call);
    if (custom !== null) return custom;
    if (call.url.pathname === "/platform/v1/auth/me") return me(role);
    if (call.url.pathname === "/platform/v1/fx-rates") return json(200, board());
    if (call.url.pathname === "/platform/v1/fx-rates/history") return json(200, emptyHistory);
    if (call.url.pathname === "/platform/v1/fx-rates/fetches") return json(200, { items: [] });
    return null;
  });
  render(
    <MemoryRouter initialEntries={["/platform/master/fx-rates"]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}
const main = (): HTMLElement => document.querySelector("main") as HTMLElement;
const posts = (calls: ApiCall[], path: string): number => calls.filter((call) => call.method === "POST" && call.path === path).length;

test("立即拉取进行中：按钮显示「正在拉取…」并标为忙，连点只发一次；结束后恢复", async () => {
  const pending = deferred();
  const calls = open("master_data", (call) => (call.method === "POST" && call.url.pathname === "/platform/v1/fx-rates/fetch" ? pending.promise : null));
  const button = await within(main()).findByRole("button", { name: "立即拉取" });
  await userEvent.click(button);
  const busy = await within(main()).findByRole("button", { name: /正在拉取…/ });
  assert.equal(busy.getAttribute("aria-busy"), "true");
  await userEvent.click(busy);
  await userEvent.click(busy);
  assert.equal(posts(calls, "/platform/v1/fx-rates/fetch"), 1);
  pending.resolve(json(200, { fetch: record({ id: "8", trigger: "manual", status: "unchanged" }) }));
  await within(main()).findByText("数据源还没有更新，汇率不变");
  await waitFor(() => assert.equal(within(main()).getByRole("button", { name: "立即拉取" }).getAttribute("aria-busy"), null));
});

test("立即拉取失败的各种提示：网络断开、没有权限、挂起的一批被拒收 / 内容不对", async () => {
  const replies: (() => Response | Promise<Response>)[] = [
    () => Promise.reject(new TypeError("Failed to fetch")),
    () => apiError(403, "FORBIDDEN", "没有权限", { required: "fx.manage" }),
    () => json(200, { fetch: record({ id: "9", trigger: "manual", status: "rejected", error_code: "FX_SOURCE_NOT_JSON", error_detail: "响应不是 JSON" }) }),
    () => json(200, { fetch: record({ id: "10", trigger: "manual", status: "held", error_code: "FX_RATE_JUMP" }) }),
  ];
  open("super_admin", (call) => (call.method === "POST" && call.url.pathname === "/platform/v1/fx-rates/fetch" ? (replies.shift() as () => Response)() : null));
  const button = await within(main()).findByRole("button", { name: "立即拉取" });
  await userEvent.click(button);
  await within(main()).findByText("网络连接失败，请重试");
  await userEvent.click(button);
  await within(main()).findByText("当前角色没有这个操作的权限");
  await userEvent.click(button);
  await within(main()).findByText("没有拉到汇率：响应不是 JSON。继续用最近一次的汇率");
  await userEvent.click(button);
  await within(main()).findByText("这批汇率变动超过 3%，已挂起，确认后才生效");
});

test("看板加载失败：说明失败并给「重试」，重试成功后显示数据", async () => {
  let failing = true;
  const calls = open("readonly", (call) => (call.url.pathname === "/platform/v1/fx-rates" && failing ? apiError(500, "INTERNAL", "出错了") : null));
  await within(main()).findByText("加载失败");
  failing = false;
  await userEvent.click(within(main()).getByRole("button", { name: "重试" }));
  await within(main()).findByRole("heading", { level: 2, name: "数据源" });
  assert.ok(calls.filter((call) => call.path.startsWith("/platform/v1/fx-rates?")).length >= 2);
});

test("空状态：近 30 天还没有汇率、还没有拉过汇率；定时拉取关闭时说明；没有汇率时对有权限的人提示可以立即拉取", async () => {
  open("master_data", (call) =>
    call.url.pathname === "/platform/v1/fx-rates"
      ? json(200, board({ state: "none", as_of: null, fetched_at: null, stale_at: null, rates: [{ currency: "JPY", rate: null }], source_status: { host: "open.er-api.com", auto_fetch: false, last_attempt: null, last_success_at: null, next_fetch_at: null } }))
      : null,
  );
  await within(main()).findByText("近 30 天还没有汇率");
  await within(main()).findByText("还没有拉过汇率");
  assert.ok(within(main()).getByText("没有打开定时拉取"));
  assert.ok(within(main()).getByText("还没有拉过"));
  const alert = within(main()).getByText("还没有汇率：跨币种的报价都报不出").closest(".alert") as HTMLElement;
  assert.match(alert.textContent ?? "", /定时拉取没有打开。也可以点「立即拉取」。/);
  const rates = within(main()).getByRole("region", { name: "当前汇率表" });
  assert.ok(within(rates).getAllByText("—").length > 0, "没有汇率的格子显示 —");
});

test("过期提醒：有权限的人看到「请检查数据源，或点立即拉取」，并写出现在这批的时间", async () => {
  open("master_data", (call) => (call.url.pathname === "/platform/v1/fx-rates" ? json(200, board({ state: "stale" })) : null));
  const alert = (await within(main()).findByText("汇率超过 48 小时没有更新，跨币种报价已暂停")).closest(".alert") as HTMLElement;
  assert.match(alert.textContent ?? "", /请检查数据源，或点「立即拉取」/);
  assert.match(alert.textContent ?? "", /现在这批是 \d{4}-\d{2}-\d{2} \d{2}:\d{2} 的/);
});

test("确认挂起的一批：对话框里连点只提交一次；那批已被处理（409）时提示并刷新", async () => {
  const held = record({ id: "12", status: "held", error_code: "FX_RATE_JUMP", source_as_of: "2026-10-15T00:02:31.000Z", jumps: [{ currency: "JPY", previous: "151.21", next: "157.3", change_bp: 403 }] });
  const pending = deferred();
  const calls = open("master_data", (call) => {
    if (call.url.pathname === "/platform/v1/fx-rates") return json(200, board({ held }));
    if (call.method === "POST" && call.url.pathname === "/platform/v1/fx-rates/fetches/12/dismiss") return pending.promise;
    return null;
  });
  const card = (await within(main()).findByRole("heading", { name: "有一批汇率变动超过 3%，等待确认" })).closest("section") as HTMLElement;
  await userEvent.click(within(card).getByRole("button", { name: "放弃这批" }));
  const dialog = await screen.findByRole("dialog", { name: "放弃这批汇率？" });
  const submit = within(dialog).getByRole("button", { name: "放弃" });
  await userEvent.click(submit);
  await userEvent.click(within(dialog).getByRole("button", { name: /正在提交…/ }));
  assert.equal(posts(calls, "/platform/v1/fx-rates/fetches/12/dismiss"), 1);
  const before = calls.filter((call) => call.path.startsWith("/platform/v1/fx-rates?")).length;
  pending.resolve(apiError(409, "FX_FETCH_NOT_HELD", "这次拉取没有挂起待确认的汇率", { status: "dismissed" }));
  await within(main()).findByText("这批汇率已经处理过，或已被更新的一批取代。页面已刷新");
  await waitFor(() => assert.ok(calls.filter((call) => call.path.startsWith("/platform/v1/fx-rates?")).length > before, "刷新了看板"));
});
