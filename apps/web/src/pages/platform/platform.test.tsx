/**
 * 运营后台「供应商、平台员工、审计日志、系统状态」的组件测试：各种状态、各种被拒、各角色看得到什么，
 * 以及一次性链接的硬性要求（令牌只在对话框里、不重试、只能用底部的按钮关闭）。
 * 接口用测试替身；真实后端由端到端测试 e2e/platform-tenants.spec.ts 覆盖。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import { ApiError } from "../../api/client.ts";
import { type AuditLog, createStaff, createTenant, inviteTenantAdmin, issueStaffReset, issueTenantAdminReset } from "../../api/platform.ts";
import type { PlatformUser, Tenant } from "../../api/types.ts";
import { type ApiCall, apiError, assertAbsent, assertFocused, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-10-06T00:12:00.000Z", updated_at: "2026-10-08T05:30:00.000Z" };
const TENANT_ID = "7b1c2d3e-aaaa-4bbb-8ccc-ddddeeeeffff";
const TENANT2_ID = "8c2d3e4f-aaaa-4bbb-8ccc-ddddeeeeffff";
const ME_ID = "11111111-1111-4111-8111-111111111111";
const STAFF_ID = "22222222-2222-4222-8222-222222222222";
/** 测试里用的令牌：页面上除了对话框的文本框，哪里都不该有它 */
const TOKEN = "nzi_SECRET-token-0123456789abcdefghij";
const tenantOf = (changes: Partial<Tenant> = {}): Tenant => ({ id: TENANT_ID, name: "NOZOMI 自营车队", status: "active", ...stamps, ...changes });
const staffOf = (changes: Partial<PlatformUser> = {}): PlatformUser => ({ id: STAFF_ID, email: "sato@example.com", name: "佐藤 健", role: "operations", status: "active", ...stamps, ...changes });
const meOf = (role: string): PlatformUser => ({ id: ME_ID, email: "kato@example.com", name: "加藤 美咲", role: role as PlatformUser["role"], status: "active", ...stamps });
const logOf = (changes: Partial<AuditLog> = {}): AuditLog => ({ id: "7", occurred_at: "2026-10-09T02:02:37.000Z", tenant_id: TENANT_ID, actor: { type: "platform_user", id: ME_ID, email: "kato@example.com" }, ip: "203.0.113.9", source: "console", resource: "tenant", resource_id: TENANT_ID, action: "suspend", before: { status: "active" }, after: { status: "suspended", reason: "资质到期，等补件" }, ...changes });
const invite = { token: TOKEN, expires_at: "2026-10-16T05:30:00.000Z" };

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;
interface World {
  tenants?: Tenant[];
  staff?: PlatformUser[];
  logs?: AuditLog[];
}
function open(path: string, role: string, world: World = {}, routes: Route = () => null): ApiCall[] {
  signIn("platform", "platform-token");
  const calls = stubApiWith((call) => {
    const custom = routes(call);
    if (custom !== null) return custom;
    if (call.method !== "GET") return null;
    const at = call.url.pathname;
    if (at === "/platform/v1/auth/me") return json(200, { user: meOf(role), permissions: [], must_change_password: false });
    if (at === "/platform/v1/dashboard/summary") return json(200, { tenants: role === "tech" ? null : { active: 1, suspended: 1 }, master_data: null });
    if (at === "/platform/v1/tenants") return json(200, { items: world.tenants ?? [tenantOf()], next_cursor: null });
    const found = (world.tenants ?? [tenantOf()]).find((tenant) => at === `/platform/v1/tenants/${tenant.id}`);
    if (found) return json(200, found);
    if (at.startsWith("/platform/v1/tenants/")) return apiError(404, "NOT_FOUND", "没有");
    if (at === "/platform/v1/staff") return json(200, { items: world.staff ?? [meOf(role), staffOf()], next_cursor: null });
    if (at === "/platform/v1/audit-logs") return json(200, { items: world.logs ?? [logOf()], next_cursor: null });
    if (at === "/platform/v1/products") return json(200, { items: [], next_cursor: null, total: 0 });
    if (at === "/platform/v1/integrations") return json(200, { items: [{ key: "database", label: "数据库", state: "configured", detail: "postgres://nozomi_app:••••@db:5432/nozomi" }, { key: "stripe", label: "Stripe", state: "missing", detail: "" }] });
    return null;
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}
const writes = (calls: ApiCall[]): ApiCall[] => calls.filter((call) => call.method !== "GET");
const user = () => userEvent.setup();
const pageText = (): string => document.body.textContent ?? "";
/** 菜单在宽屏侧栏和手机抽屉里各有一份，这里去重 */
const menuLabels = (): string[] => [...new Set([...document.querySelectorAll('nav[aria-label="主菜单"] .nav-item')].map((node) => node.textContent ?? ""))];
const storageDump = (): string => [localStorage, sessionStorage].map((storage) => Object.keys(storage).map((key) => `${key}=${storage.getItem(key)}`).join("\n")).join("\n");
/** 令牌只在对话框的文本框里：存储、对话框以外的页面、各种属性值里都没有。 */
function assertTokenOnlyInDialog(): void {
  assert.doesNotMatch(storageDump(), new RegExp(TOKEN), "存储里不能有令牌");
  const outside = [...document.body.querySelectorAll("*")].filter((node) => node.closest("dialog") === null);
  assert.ok(!outside.some((node) => [...node.attributes].some((attribute) => attribute.value.includes(TOKEN)) || (node.children.length === 0 && (node.textContent ?? "").includes(TOKEN))), "对话框以外不能有令牌");
  const dialog = screen.getByRole("dialog");
  const places = [...dialog.querySelectorAll("*")].filter((node) => [...node.attributes].some((attribute) => attribute.value.includes(TOKEN)) || (node.children.length === 0 && (node.textContent ?? "").includes(TOKEN)) || ((node as HTMLTextAreaElement).value ?? "").toString().includes(TOKEN));
  assert.deepEqual(places.map((node) => node.tagName), ["TEXTAREA"], "令牌只出现在那个只读的文本框里（不在 title、aria-label 里）");
}

// ───────────── 菜单、首页、权限 ─────────────

test("菜单按角色显示：超级管理员有供应商和系统设置（默认收起）；运营没有系统设置；技术只有系统状态、没有供应商；首页的供应商卡片可以点进列表", async () => {
  open("/platform", "super_admin");
  const card = (await screen.findByRole("link", { name: "供应商", description: /正常/ })) as HTMLAnchorElement;
  assert.equal(card.getAttribute("href"), "/platform/tenants");
  assert.deepEqual(menuLabels(), ["首页", "供应商", "商品", "报价试算", "主数据", "城市", "地点", "车型组", "附加服务", "汇率", "系统设置"]);
  const group = screen.getByRole("button", { name: "系统设置" });
  assert.equal(group.getAttribute("aria-expanded"), "false");
  await user().click(group);
  assert.deepEqual(menuLabels().slice(-4), ["系统设置", "平台员工", "审计日志", "系统状态"]);

  resetBrowser();
  open("/platform", "operations");
  await waitFor(() => assert.ok(menuLabels().includes("供应商")));
  assert.ok(!menuLabels().includes("系统设置"));

  resetBrowser();
  open("/platform/settings/integrations", "tech");
  await screen.findByRole("heading", { level: 1, name: "系统状态" });
  assert.ok(menuLabels().includes("系统状态") && !menuLabels().includes("平台员工") && !menuLabels().includes("审计日志") && !menuLabels().includes("供应商"));

  for (const [path, role] of [["/platform/tenants", "tech"], ["/platform/tenants/new", "readonly"], ["/platform/settings/staff", "operations"], ["/platform/settings/staff/new", "operations"], ["/platform/settings/audit-logs", "operations"], ["/platform/settings/integrations", "readonly"]] as const) {
    resetBrowser();
    const calls = open(path, role);
    await screen.findByText("你没有权限查看这里");
    assert.ok(screen.getByText("需要的话，请联系管理员开通。"));
    assert.equal(calls.filter((call) => /\/(staff|audit-logs|integrations)$/.test(call.path) || (role === "tech" && call.path.includes("/tenants"))).length, 0, `${role} 打开 ${path} 不该去取数据`);
  }
});

// ───────────── 供应商：列表 ─────────────

test("供应商列表：全部取完后在浏览器里搜、筛、排（最近修改的在前）；加载失败能重试；一家都没有、筛不到各有说法；只读角色没有任何操作", async () => {
  const actor = user();
  const tenants = [tenantOf(), tenantOf({ id: TENANT2_ID, name: "Relaxcar", status: "suspended", updated_at: "2026-10-09T02:02:00.000Z" })];
  let fail = true;
  const calls = open("/platform/tenants", "super_admin", {}, (call) => {
    if (call.method !== "GET" || call.url.pathname !== "/platform/v1/tenants") return null;
    if (fail) return apiError(500, "INTERNAL", "boom");
    // 分两页给：页面要一直取到没有下一页
    return call.url.searchParams.get("cursor") === null ? json(200, { items: [tenants[0]], next_cursor: "c2" }) : json(200, { items: [tenants[1]], next_cursor: null });
  });
  await screen.findByText("加载失败");
  fail = false;
  await actor.click(screen.getByRole("button", { name: "重试" }));
  await screen.findByRole("link", { name: "Relaxcar" });
  assert.deepEqual([...document.querySelectorAll("tbody th a")].map((node) => node.textContent), ["Relaxcar", "NOZOMI 自营车队"]);
  assert.deepEqual(calls.filter((call) => call.path.startsWith("/platform/v1/tenants?")).slice(-2).map((call) => call.path), ["/platform/v1/tenants?limit=200", "/platform/v1/tenants?limit=200&cursor=c2"]);
  const row = screen.getByRole("link", { name: "Relaxcar" }).closest("tr") as HTMLElement;
  assert.match(row.textContent ?? "", /已暂停/);
  assert.equal(within(row).getByRole("link", { name: "查看 Relaxcar" }).getAttribute("href"), `/platform/tenants/${TENANT2_ID}`);
  await actor.click(within(row).getByRole("button", { name: "Relaxcar 的更多操作" }));
  assert.deepEqual(screen.getAllByRole("menuitem").map((entry) => entry.textContent), ["邀请管理员", "恢复"]);
  await actor.keyboard("{Escape}");
  assert.match(pageText(), /共 2 条/);

  const requests = calls.length;
  await actor.type(screen.getByRole("searchbox", { name: "按名称搜索" }), "relax{Enter}");
  await waitFor(() => assert.deepEqual([...document.querySelectorAll("tbody th a")].map((node) => node.textContent), ["Relaxcar"]));
  assert.equal(calls.length, requests, "搜索不再请求");
  await actor.clear(screen.getByRole("searchbox", { name: "按名称搜索" }));
  await actor.type(screen.getByRole("searchbox", { name: "按名称搜索" }), "没有这家{Enter}");
  await screen.findByText("没有符合条件的供应商");

  resetBrowser();
  open("/platform/tenants?status=suspended", "readonly", { tenants });
  await screen.findByRole("link", { name: "Relaxcar" });
  assertAbsent(screen.queryByRole("link", { name: "NOZOMI 自营车队" }));
  assert.ok(screen.getByText("你可以查看供应商，但不能修改。"));
  assertAbsent(screen.queryByRole("link", { name: "新建供应商" }));
  assertAbsent(screen.queryByRole("button", { name: /的更多操作$/ }));

  resetBrowser();
  open("/platform/tenants", "tenant_onboarding", { tenants: [] });
  await screen.findByText("还没有供应商");
  assert.match(pageText(), /供应商就是在平台上接单的车队。/);
  assert.ok(screen.getAllByRole("link", { name: "新建供应商" }).length >= 1);
  assert.doesNotMatch(pageText(), /tenant|suspended|租户/);
});

// ───────────── 一次性链接 ─────────────

test("新建供应商：成功后弹出一次性链接——令牌只在对话框的文本框里；Esc、遮罩、右上角都关不掉；没复制就关要再确认；关闭以后才换到详情页，页面上再也找不到令牌", async () => {
  const actor = user();
  const created = tenantOf({ id: TENANT2_ID, name: "新车队" });
  const calls = open("/platform/tenants/new", "operations", { tenants: [tenantOf(), created] }, (call) => (call.method === "POST" && call.path === "/platform/v1/tenants" ? json(201, { tenant: created, admin_user: { id: "u9", email: "yamada@example.com", name: "山田太郎", role: "admin", status: "invited", ...stamps }, invite }) : null));
  await screen.findByRole("heading", { level: 1, name: "新建供应商" });
  assert.match(pageText(), /系统不会给对方发邮件。点「新建」后，这里会显示一条邀请链接，只显示一次，请当场复制并发给对方。/);
  await actor.click(screen.getByRole("button", { name: "新建" }));
  await screen.findByText("请填写名称");
  assert.equal(writes(calls).length, 0);
  await actor.type(screen.getByLabelText(/^名称/), "nozomi 自营车队");
  await screen.findByText("已经有一家叫「nozomi 自营车队」的供应商了。确定要再建一家同名的吗？");
  await actor.clear(screen.getByLabelText(/^名称/));
  await actor.type(screen.getByLabelText(/^名称/), "  新车队 ");
  await actor.type(screen.getByLabelText(/^邮箱/), "yamada@example.com");
  await actor.type(screen.getByLabelText(/^姓名/), "山田太郎");
  await actor.click(screen.getByRole("button", { name: "新建" }));

  const dialog = await screen.findByRole("dialog", { name: "邀请链接（只显示这一次）" });
  assert.deepEqual(writes(calls).map((call) => [call.method, call.path, call.body]), [["POST", "/platform/v1/tenants", { name: "新车队", admin: { email: "yamada@example.com", name: "山田太郎" } }]]);
  assert.equal(writes(calls)[0]?.headers["idempotency-key"], undefined);
  const box = within(dialog).getByRole("textbox", { name: "邀请链接" }) as HTMLTextAreaElement;
  assert.equal(box.value, `http://localhost/accept-invite#token=${TOKEN}`);
  assert.deepEqual([box.readOnly, box.getAttribute("autocomplete"), box.getAttribute("spellcheck")], [true, "off", "false"]);
  assert.match(dialog.textContent ?? "", /给 山田太郎（yamada@example\.com）· 新车队 的管理员/);
  assert.match(dialog.textContent ?? "", /系统不会发邮件。请你自己把链接发给对方本人/);
  assert.match(dialog.textContent ?? "", /有效期到 \d{4}-\d{2}-\d{2} \d{2}:\d{2}（7 天），只能用一次。/);
  assert.match(dialog.textContent ?? "", /这个对话框只能用最下面的按钮关闭。/);
  assertFocused(within(dialog).getByRole("button", { name: "复制链接" }));
  assertAbsent(within(dialog).queryByRole("button", { name: "关闭" }));
  assertTokenOnlyInDialog();

  // Esc（dialog 的 cancel 事件）和点遮罩都不关
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  fireEvent.click(dialog);
  assert.ok(screen.getByRole("dialog", { name: "邀请链接（只显示这一次）" }));

  // 还没复制过就关：再确认；浏览器不让写剪贴板时，把链接选中并说明
  await actor.click(within(dialog).getByRole("button", { name: "我已经发给对方，关闭" }));
  await within(dialog).findByText("还没有复制过这条链接。关闭以后无法再看到，只能重新发起。");
  await waitFor(() => assertFocused(within(dialog).getByRole("button", { name: "回去复制" })));
  await actor.click(within(dialog).getByRole("button", { name: "回去复制" }));
  const clipboard = navigator.clipboard;
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("denied")) } });
  await actor.click(within(dialog).getByRole("button", { name: "复制链接" }));
  await within(dialog).findByText("没有复制成功。链接已经选中，请按 Ctrl + C（Mac 上是 ⌘ + C）复制。");
  assert.deepEqual([box.selectionStart, box.selectionEnd], [0, box.value.length]);
  const copied: string[] = [];
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (text: string) => (copied.push(text), Promise.resolve()) } });
  await actor.click(within(dialog).getByRole("button", { name: "复制链接和说明" }));
  await within(dialog).findByText("链接和说明已复制");
  assert.match(copied[0] ?? "", /^山田太郎，你好：\n这是 NOZOMI 供应商后台的账号开通链接，请在 \d{4}-\d{2}-\d{2} \d{2}:\d{2} 前打开，设置你自己的密码：\nhttp:\/\/localhost\/accept-invite#token=.+\n链接只能用一次，请不要转发给别人。登录邮箱：yamada@example\.com$/);
  assertAbsent(document.querySelector(".toast"));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard });

  await actor.click(within(dialog).getByRole("button", { name: "我已经发给对方，关闭" }));
  await screen.findByRole("heading", { level: 1, name: "新车队" });
  await screen.findByText("已新建供应商「新车队」");
  assert.ok(!document.body.innerHTML.includes(TOKEN), "关闭以后页面上任何地方都没有令牌");
  assert.doesNotMatch(storageDump(), new RegExp(TOKEN));
  assert.ok(calls.every((call) => !call.path.includes(TOKEN)), "令牌不进任何请求的地址");
});

test("发令牌的请求不自动重试：网络不明时只发了一次，说清楚「不确定有没有建成」；邮箱已被占用落在邮箱下面；没有权限说清楚", async () => {
  const actor = user();
  let answer: Response | "network" = "network";
  const calls = open("/platform/tenants/new", "super_admin", {}, (call) => (call.method === "POST" ? (answer === "network" ? Promise.reject(new TypeError("fetch failed")) : answer) : null));
  await screen.findByRole("heading", { level: 1, name: "新建供应商" });
  await actor.type(screen.getByLabelText(/^名称/), "新车队");
  await actor.type(screen.getByLabelText(/^邮箱/), "yamada@example.com");
  await actor.type(screen.getByLabelText(/^姓名/), "山田太郎");
  await actor.click(screen.getByRole("button", { name: "新建" }));
  await screen.findByText("不确定有没有建成。");
  assert.match(pageText(), /请先回到供应商列表看一眼有没有「新车队」：有的话不要再建一次，到它的详情页点「邀请管理员」重新拿链接；没有再回来重试。/);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(writes(calls).length, 1, "没有自动重试");
  assert.equal((screen.getByLabelText(/^名称/) as HTMLInputElement).value, "新车队");

  answer = apiError(409, "EMAIL_TAKEN", "taken");
  await actor.click(screen.getByRole("button", { name: "新建" }));
  await screen.findByText(/这个邮箱已经是某家供应商的账号了，一个邮箱只能属于一家供应商。/);
  assertFocused(screen.getByLabelText(/^邮箱/));
  answer = apiError(403, "FORBIDDEN", "no");
  await actor.click(screen.getByRole("button", { name: "新建" }));
  await screen.findByText("你没有权限新建供应商。需要的话，请联系管理员开通。");
  assertAbsent(screen.queryByRole("dialog"));
  assert.doesNotMatch(pageText(), /EMAIL_TAKEN|FORBIDDEN/);
});

// ───────────── 供应商：详情、暂停、恢复、邀请、重置 ─────────────

test("供应商详情：暂停要填原因（接口不要求，页面要求）；已暂停时能看审计日志的角色看得到原因，恢复的确认里带着它；别的角色看不到原因；不存在的说清楚", async () => {
  const actor = user();
  let tenant = tenantOf();
  const calls = open(`/platform/tenants/${TENANT_ID}`, "super_admin", {}, (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/tenants/${TENANT_ID}`) return json(200, tenant);
    if (call.method === "POST" && call.path.endsWith("/suspend")) return json(200, (tenant = tenantOf({ status: "suspended", updated_at: "2026-10-09T02:02:37.000Z" })));
    if (call.method === "POST" && call.path.endsWith("/resume")) return json(200, (tenant = tenantOf()));
    return null;
  });
  await screen.findByRole("heading", { level: 1, name: "NOZOMI 自营车队" });
  assert.match(pageText(), /供应商编号7b1c2d3e-aaaa-4bbb-8ccc-ddddeeeeffff/);
  assert.equal(screen.getByRole("link", { name: /看这家供应商的操作记录/ }).getAttribute("href"), `/platform/settings/audit-logs?tenant=${TENANT_ID}`);
  await actor.click(screen.getByRole("button", { name: "暂停" }));
  const dialog = screen.getByRole("dialog", { name: "暂停「NOZOMI 自营车队」？" });
  assertFocused(within(dialog).getByRole("button", { name: "取消" }));
  assert.match(dialog.textContent ?? "", /已经接下的订单不受影响，仍然要照常派车、履约；/);
  await actor.click(within(dialog).getByRole("button", { name: "暂停" }));
  await within(dialog).findByText("请填写暂停原因");
  await actor.type(within(dialog).getByLabelText(/暂停原因/), "   ");
  await actor.click(within(dialog).getByRole("button", { name: "暂停" }));
  assert.equal(writes(calls).length, 0, "只有空格等于没填");
  await actor.type(within(dialog).getByLabelText(/暂停原因/), "资质到期，等补件");
  assert.match(dialog.textContent ?? "", /8 \/ 500/);
  await actor.click(within(dialog).getByRole("button", { name: "暂停" }));
  await screen.findByText("已暂停「NOZOMI 自营车队」");
  assert.deepEqual(writes(calls)[0]?.body, { reason: "资质到期，等补件" });
  await screen.findByText("这家供应商已暂停。");
  await screen.findByText(/原因：资质到期，等补件（kato@example\.com，\d{4}-\d{2}-\d{2} \d{2}:\d{2}）/);
  assert.match(calls.filter((call) => call.path.includes("/audit-logs")).at(-1)?.path ?? "", new RegExp(`resource=tenant&resource_id=${TENANT_ID}&action=suspend&limit=1`));

  await actor.click(screen.getByRole("button", { name: "恢复" }));
  const resume = screen.getByRole("dialog", { name: "恢复「NOZOMI 自营车队」？" });
  assert.match(resume.textContent ?? "", /恢复以后，它的商品重新参与比价、可以接新订单。当初暂停的原因：资质到期，等补件。请确认问题已经解决。/);
  await actor.click(within(resume).getByRole("button", { name: "恢复" }));
  await screen.findByText("已恢复「NOZOMI 自营车队」");
  assert.equal(writes(calls)[1]?.body, undefined, "恢复不带原因");
  assertAbsent(screen.queryByText("这家供应商已暂停。"));

  resetBrowser();
  const viewed = open(`/platform/tenants/${TENANT_ID}`, "tenant_onboarding", { tenants: [tenantOf({ status: "suspended" })] });
  await screen.findByText("这家供应商已暂停。");
  assert.ok(screen.getByText("暂停原因记在审计日志里，需要的话请问超级管理员。"));
  assert.equal(viewed.filter((call) => call.path.includes("/audit-logs")).length, 0, "看不了审计日志的角色不去取");
  assertAbsent(screen.queryByRole("link", { name: /操作记录/ }));
  assert.ok(screen.getByRole("button", { name: "恢复" }) && screen.getByRole("button", { name: "邀请管理员" }));

  for (const path of [`/platform/tenants/${TENANT2_ID}`, "/platform/tenants/not-a-uuid"]) {
    resetBrowser();
    open(path, "super_admin");
    await screen.findByText("找不到这家供应商");
    assert.equal(screen.getByRole("link", { name: "回到供应商列表" }).getAttribute("href"), "/platform/tenants");
  }
});

test("邀请管理员和发密码重置：成功后同一处换成一次性链接；邮箱已有账号、不是这家的管理员、账号不在用，各落在邮箱下面；网络不明只发一次", async () => {
  const actor = user();
  let answer: Response | "network" = apiError(409, "EMAIL_TAKEN", "taken");
  const calls = open(`/platform/tenants/${TENANT_ID}`, "operations", {}, (call) => (call.method === "POST" ? (answer === "network" ? Promise.reject(new TypeError("fetch failed")) : answer.clone()) : null));
  await screen.findByRole("heading", { level: 1, name: "NOZOMI 自营车队" });
  await actor.click(screen.getByRole("button", { name: "邀请管理员" }));
  const dialog = screen.getByRole("dialog", { name: "邀请管理员" });
  assert.match(dialog.textContent ?? "", /给「NOZOMI 自营车队」开一个管理员账号。/);
  assert.match(dialog.textContent ?? "", /系统不会发邮件。点「邀请」后会显示一条邀请链接，只显示一次。/);
  await actor.click(within(dialog).getByRole("button", { name: "邀请" }));
  await within(dialog).findByText("请填写邮箱");
  await actor.type(within(dialog).getByLabelText(/^邮箱/), "sato@example.com");
  await actor.type(within(dialog).getByLabelText(/^姓名/), "佐藤花子");
  await actor.click(within(dialog).getByRole("button", { name: "邀请" }));
  await within(dialog).findByText(/这个邮箱已经有账号了（在这家或别的供应商，并且已经设过密码）。/);
  answer = "network";
  await actor.click(within(dialog).getByRole("button", { name: "邀请" }));
  await within(dialog).findByText("不确定有没有成功。");
  assert.match(dialog.textContent ?? "", /如果其实已经成功了，再试一次会发出一条新的链接，之前那条作废——没有影响，因为它还没有交到任何人手里。/);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(writes(calls).length, 2, "网络不明时没有自动重试");
  answer = json(201, { user: { id: "u2", email: "sato@example.com", name: "佐藤花子", role: "admin", status: "invited", ...stamps }, invite });
  await actor.click(within(dialog).getByRole("button", { name: "邀请" }));
  const link = await screen.findByRole("dialog", { name: "邀请链接（只显示这一次）" });
  assert.equal(document.querySelectorAll("dialog[open]").length, 1, "不叠两层");
  assert.match(link.textContent ?? "", /给 佐藤花子（sato@example\.com）· NOZOMI 自营车队 的管理员/);
  assert.deepEqual(writes(calls).at(-1)?.body, { email: "sato@example.com", name: "佐藤花子" });
  assertTokenOnlyInDialog();
  fireEvent.copy(within(link).getByRole("textbox", { name: "邀请链接" }));
  await actor.click(within(link).getByRole("button", { name: "我已经发给对方，关闭" }));
  await screen.findByText("已邀请「佐藤花子」");
  assert.ok(!document.body.innerHTML.includes(TOKEN));
  await waitFor(() => assertFocused(screen.getByRole("button", { name: "邀请管理员" })));

  // 发密码重置
  answer = apiError(404, "NOT_FOUND", "no");
  await actor.click(screen.getByRole("button", { name: "发密码重置链接" }));
  const reset = screen.getByRole("dialog", { name: "给管理员发密码重置链接" });
  assert.match(reset.textContent ?? "", /只能发给「NOZOMI 自营车队」里在用的管理员。/);
  await actor.type(within(reset).getByLabelText(/管理员的邮箱/), "nobody@example.com");
  await actor.click(within(reset).getByRole("button", { name: "发出" }));
  await within(reset).findByText("这家供应商没有用这个邮箱的管理员。请核对邮箱；如果他不是管理员，请让他们的管理员处理。");
  answer = apiError(409, "ACCOUNT_NOT_ACTIVE", "inactive");
  await actor.click(within(reset).getByRole("button", { name: "发出" }));
  await within(reset).findByText(/这个账号现在不是在用的状态。还没设过密码的，请用「邀请管理员」重新发邀请；/);
  answer = json(201, { user: { id: "u2", email: "sato@example.com", name: "佐藤花子", role: "admin", status: "active", ...stamps }, reset: invite });
  await actor.click(within(reset).getByRole("button", { name: "发出" }));
  const resetLink = await screen.findByRole("dialog", { name: "密码重置链接（只显示这一次）" });
  assert.equal((within(resetLink).getByRole("textbox", { name: "密码重置链接" }) as HTMLTextAreaElement).value, `http://localhost/reset-password#token=${TOKEN}`);
  assert.match(resetLink.textContent ?? "", /（24 小时），只能用一次。/);
  assert.match(resetLink.textContent ?? "", /发出链接不会改掉对方现在的密码；对方用它设了新密码以后，旧密码才失效，他在所有设备上都要重新登录。再发一次会让这条链接作废。/);
  assert.doesNotMatch(pageText(), /EMAIL_TAKEN|ACCOUNT_NOT_ACTIVE|NOT_FOUND/);
});

// ───────────── 平台员工 ─────────────

test("平台员工列表：自己那一行不能停用、不能给自己发重置；菜单按状态给；停用最后一个超级管理员被拒；从没设过密码的启用被拒并带去重新邀请；状态过时的重置被拒后重新取", async () => {
  const actor = user();
  const staff = [meOf("super_admin"), staffOf(), staffOf({ id: "33333333-3333-4333-8333-333333333333", email: "new@example.com", name: "铃木", status: "invited", role: "readonly" }), staffOf({ id: "44444444-4444-4444-8444-444444444444", email: "old@example.com", name: "高桥", status: "disabled", role: "finance" })];
  let answer: Response = apiError(409, "LAST_ADMIN_REQUIRED", "last");
  const calls = open("/platform/settings/staff", "super_admin", { staff }, (call) => (call.method === "POST" ? answer.clone() : null));
  const mine = (await screen.findByText("kato@example.com")).closest("tr") as HTMLElement;
  assert.match(mine.textContent ?? "", /加藤 美咲你kato@example\.com超级管理员在用/);
  await actor.click(within(mine).getByRole("button", { name: /的更多操作$/ }));
  assert.ok(screen.getByText("这是你自己的账号。"));
  assert.deepEqual(screen.getAllByRole("menuitem").map((entry) => entry.textContent), ["看他的操作记录", "看这个账号的变更记录"]);
  await actor.keyboard("{Escape}");
  const menuOf = async (email: string): Promise<string[]> => {
    await actor.click(within(screen.getByText(email).closest("tr") as HTMLElement).getByRole("button", { name: /的更多操作$/ }));
    return screen.getAllByRole("menuitem").map((entry) => entry.textContent ?? "");
  };
  assert.deepEqual(await menuOf("new@example.com"), ["重新邀请", "停用", "看他的操作记录", "看这个账号的变更记录"]);
  await actor.keyboard("{Escape}");
  assert.deepEqual(await menuOf("old@example.com"), ["启用", "看他的操作记录", "看这个账号的变更记录"]);
  await actor.keyboard("{Escape}");
  assert.deepEqual(await menuOf("sato@example.com"), ["发密码重置链接", "停用", "看他的操作记录", "看这个账号的变更记录"]);
  assert.equal(screen.getByRole("menuitem", { name: "看他的操作记录" }).getAttribute("href"), `/platform/settings/audit-logs?actor=${STAFF_ID}`);

  await actor.click(screen.getByRole("menuitem", { name: "停用" }));
  const disable = screen.getByRole("dialog", { name: "停用「佐藤 健」？" });
  assert.match(disable.textContent ?? "", /停用以后，他马上不能登录，已经登录着的也会立刻退出。之后可以重新启用。/);
  assertFocused(within(disable).getByRole("button", { name: "取消" }));
  await actor.click(within(disable).getByRole("button", { name: "停用" }));
  await within(disable).findByText("现在不能停用。");
  assert.match(disable.textContent ?? "", /他是最后一个在用的超级管理员。请先给另一个人开一个超级管理员账号，等对方设好密码以后再停用他。/);
  assertAbsent(within(disable).queryByRole("button", { name: "停用" }));
  assert.equal(writes(calls)[0]?.path, `/platform/v1/staff/${STAFF_ID}/disable`);
  await actor.click(within(disable).getByRole("button", { name: "知道了" }));

  answer = apiError(409, "ACCOUNT_NOT_ACTIVATED", "never");
  await menuOf("old@example.com");
  await actor.click(screen.getByRole("menuitem", { name: "启用" }));
  const enable = screen.getByRole("dialog", { name: "启用「高桥」？" });
  assert.match(enable.textContent ?? "", /启用以后，他可以用原来的密码登录，角色不变（财务）。/);
  await actor.click(within(enable).getByRole("button", { name: "启用" }));
  await within(enable).findByText("这个账号还没有设过密码，不能直接启用。请重新邀请他。");
  assert.equal(within(enable).getByRole("link", { name: "去重新邀请" }).getAttribute("href"), "/platform/settings/staff/new");
  await actor.click(within(enable).getByRole("button", { name: "知道了" }));

  answer = apiError(409, "ACCOUNT_NOT_ACTIVE", "stale");
  const before = calls.filter((call) => call.method === "GET" && call.path.startsWith("/platform/v1/staff")).length;
  await menuOf("sato@example.com");
  await actor.click(screen.getByRole("menuitem", { name: "发密码重置链接" }));
  const reset = screen.getByRole("dialog", { name: "给「佐藤 健」发密码重置链接？" });
  assert.match(reset.textContent ?? "", /发出链接不会改掉他现在的密码，也不会让他退出登录；/);
  await actor.click(within(reset).getByRole("button", { name: "发出" }));
  await within(reset).findByText("这个账号现在不是在用的状态。待激活的请用「重新邀请」，已停用的请先「启用」。");
  await actor.click(within(reset).getByRole("button", { name: "知道了" }));
  await waitFor(() => assert.ok(calls.filter((call) => call.method === "GET" && call.path.startsWith("/platform/v1/staff")).length > before, "关掉以后列表重新取"));

  answer = json(201, { user: staffOf(), reset: invite });
  await menuOf("sato@example.com");
  await actor.click(screen.getByRole("menuitem", { name: "发密码重置链接" }));
  await actor.click(within(screen.getByRole("dialog")).getByRole("button", { name: "发出" }));
  const link = await screen.findByRole("dialog", { name: "密码重置链接（只显示这一次）" });
  assert.equal((within(link).getByRole("textbox", { name: "密码重置链接" }) as HTMLTextAreaElement).value, `http://localhost/platform/reset-password#token=${TOKEN}`);
  assert.match(link.textContent ?? "", /给 佐藤 健（sato@example\.com）· 平台员工，运营/);
  assertTokenOnlyInDialog();
  assert.doesNotMatch(pageText(), /LAST_ADMIN_REQUIRED|ACCOUNT_NOT_ACTIVATED|ACCOUNT_NOT_ACTIVE|super_admin|invited/);
});

test("停用、启用员工成功：确认后只发一次、不带请求体；那一行换成应答里的状态，菜单跟着变；有提示", async () => {
  const actor = user();
  const disabled = staffOf({ status: "disabled" });
  const calls = open("/platform/settings/staff", "super_admin", {}, (call) => {
    if (call.method !== "POST") return null;
    return json(200, call.path.endsWith("/disable") ? disabled : staffOf());
  });
  const row = (): HTMLElement => screen.getByText("sato@example.com").closest("tr") as HTMLElement;
  await screen.findByText("sato@example.com");
  assert.match(row().textContent ?? "", /在用/);

  await actor.click(within(row()).getByRole("button", { name: /的更多操作$/ }));
  await actor.click(screen.getByRole("menuitem", { name: "停用" }));
  const disable = screen.getByRole("dialog", { name: "停用「佐藤 健」？" });
  await actor.click(within(disable).getByRole("button", { name: "停用" }));
  await screen.findByText("已停用「佐藤 健」");
  await waitFor(() => assertAbsent(screen.queryByRole("dialog", { name: "停用「佐藤 健」？" })));
  assert.match(row().textContent ?? "", /已停用/);
  await actor.click(within(row()).getByRole("button", { name: /的更多操作$/ }));
  assert.deepEqual(screen.getAllByRole("menuitem").map((entry) => entry.textContent), ["启用", "看他的操作记录", "看这个账号的变更记录"]);

  await actor.click(screen.getByRole("menuitem", { name: "启用" }));
  const enable = screen.getByRole("dialog", { name: "启用「佐藤 健」？" });
  await actor.click(within(enable).getByRole("button", { name: "启用" }));
  await screen.findByText("已启用「佐藤 健」");
  await waitFor(() => assertAbsent(screen.queryByRole("dialog", { name: "启用「佐藤 健」？" })));
  assert.match(row().textContent ?? "", /在用/);
  assert.doesNotMatch(row().textContent ?? "", /已停用/);

  assert.deepEqual(writes(calls).map((call) => [call.method, call.path, call.body]), [
    ["POST", `/platform/v1/staff/${STAFF_ID}/disable`, undefined],
    ["POST", `/platform/v1/staff/${STAFF_ID}/enable`, undefined],
  ]);
});

test("新增员工：十个角色各有说明，「现在能做的」按权限现算；没选角色不能交；邮箱已被占用；重新邀请时邮箱只读；成功后链接是运营后台的", async () => {
  const actor = user();
  let answer: Response = apiError(409, "EMAIL_TAKEN", "taken");
  const calls = open("/platform/settings/staff/new", "super_admin", {}, (call) => (call.method === "POST" ? answer.clone() : null));
  await screen.findByRole("heading", { level: 1, name: "新增员工" });
  assert.equal(screen.getAllByRole("radio").length, 10);
  assert.ok(screen.getAllByRole("radio").every((radio) => !(radio as HTMLInputElement).checked), "没有默认值");
  const hintOf = (name: RegExp): string => document.getElementById(screen.getByRole("radio", { name }).getAttribute("aria-describedby") ?? "")?.textContent ?? "";
  assert.equal(hintOf(/^运营/), "日常运营：管理供应商，处理订单和异常。 现在能做的：管理供应商（新建、邀请管理员、暂停和恢复）、看主数据。");
  assert.equal(hintOf(/^只读/), "只能看，不能改。 现在能做的：看供应商、看主数据。");
  assert.equal(hintOf(/^技术/), "负责连接器和系统配置，可以看系统状态。 现在能做的：看主数据、看系统状态。");
  assert.equal(hintOf(/^主数据运营/), "维护城市、机场、车站、车型组、附加服务。 现在能做的：维护主数据。");
  assert.match(hintOf(/^财务/), /现在能做的：看主数据。 他负责的模块还没有上线，现在登录后只能看主数据。$/);
  assert.match(hintOf(/^超级管理员/), /现在能做的：管理供应商（新建、邀请管理员、暂停和恢复）、维护主数据、管理平台员工、看审计日志、看系统状态。$/);
  await actor.type(screen.getByLabelText(/^邮箱/), "sato@example.com");
  await actor.type(screen.getByLabelText(/^姓名/), "佐藤 健");
  await actor.click(screen.getByRole("button", { name: "新增" }));
  await screen.findByText("请选择角色");
  assert.equal(writes(calls).length, 0);
  await actor.click(screen.getByRole("radio", { name: /^超级管理员/ }));
  assert.ok(screen.getByText("超级管理员可以管理所有平台员工、看到全部审计日志。"));
  await actor.click(screen.getByRole("radio", { name: /^客服/ }));
  await actor.click(screen.getByRole("button", { name: "新增" }));
  await screen.findByText(/这个邮箱已经有一个设过密码的平台员工账号了。/);
  assert.deepEqual(writes(calls)[0]?.body, { email: "sato@example.com", name: "佐藤 健", role: "customer_service" });
  answer = json(201, { user: staffOf({ role: "customer_service", status: "invited" }), invite });
  await actor.click(screen.getByRole("button", { name: "新增" }));
  const link = await screen.findByRole("dialog", { name: "邀请链接（只显示这一次）" });
  assert.equal((within(link).getByRole("textbox", { name: "邀请链接" }) as HTMLTextAreaElement).value, `http://localhost/platform/accept-invite#token=${TOKEN}`);
  assert.match(link.textContent ?? "", /给 佐藤 健（sato@example\.com）· 平台员工，客服/);
  assertTokenOnlyInDialog();
  fireEvent.copy(within(link).getByRole("textbox", { name: "邀请链接" }));
  await actor.click(within(link).getByRole("button", { name: "我已经发给对方，关闭" }));
  await screen.findByRole("heading", { level: 1, name: "平台员工" });
  await screen.findByText("已邀请「佐藤 健」");
  assert.ok(!document.body.innerHTML.includes(TOKEN));

  // 重新邀请：从列表带着邮箱（只读）、姓名、角色过来
  resetBrowser();
  open("/platform/settings/staff", "super_admin", { staff: [meOf("super_admin"), staffOf({ status: "invited", role: "readonly" })] });
  await actor.click(within((await screen.findByText("sato@example.com")).closest("tr") as HTMLElement).getByRole("button", { name: /的更多操作$/ }));
  await actor.click(screen.getByRole("menuitem", { name: "重新邀请" }));
  await screen.findByRole("heading", { level: 1, name: "重新邀请 佐藤 健" });
  assert.deepEqual([(screen.getByLabelText(/^邮箱/) as HTMLInputElement).value, (screen.getByLabelText(/^邮箱/) as HTMLInputElement).readOnly], ["sato@example.com", true]);
  assert.equal((screen.getByRole("radio", { name: /^只读/ }) as HTMLInputElement).checked, true);
  assert.ok(screen.getByText("会发出一条新的邀请链接，之前那条作废。姓名和角色按这次填的更新。"));
  assert.ok(screen.getByRole("button", { name: "重新邀请" }));
});

// ───────────── 审计日志、系统状态 ─────────────

test("审计日志：每一行读得出谁、做了什么、对什么；不认识的类型原样显示；详情里「改了什么」只列变了的，值换成中文并带原值，长的可以展开；筛选条件写进请求", async () => {
  const actor = user();
  const logs = [
    logOf(),
    logOf({ id: "6", action: "login_failed", actor: { type: "anonymous", id: null, email: null }, resource: "tenant_user", resource_id: null, tenant_id: null, before: null, after: { email: "a@example.com", reason: "WRONG_PASSWORD" } }),
    logOf({ id: "5", action: "bulk_import", resource: "settlement", resource_id: "pr-1", before: null, after: null, source: "api" }),
    logOf({ id: "4", action: "update", resource: "area", resource_id: "area-1", before: { name: { zh: "东京 23 区" }, status: "active", polygons: Array.from({ length: 12 }, (_, index) => [139 + index, 35]) }, after: { name: { zh: "东京 23 区" }, status: "disabled", polygons: Array.from({ length: 13 }, (_, index) => [139 + index, 35]) } }),
  ];
  const calls = open(`/platform/settings/audit-logs?tenant=${TENANT_ID}&from=2026-10-01&to=2026-10-09`, "super_admin", { logs });
  await screen.findByRole("heading", { level: 1, name: "审计日志" });
  assert.match(pageText(), /只能查看，不能修改或删除。密码、链接里的令牌不会被记录。/);
  const rows = await waitFor(() => {
    const found = [...document.querySelectorAll(".card-table tbody tr")].map((row) => row.textContent ?? "");
    assert.equal(found.length, 4);
    return found;
  });
  assert.match(rows[0] ?? "", /kato@example\.com操作人 kato@example\.com平台员工暂停供应商对象 供应商7b1c2d3e…后台详情/);
  assert.match(rows[1] ?? "", /—没有登录的访问者登录失败供应商的账号 a@example\.com后台详情/);
  assert.match(rows[2] ?? "", /bulk_importsettlement对象 settlementpr-1接口详情/);
  const request = new URL(calls.filter((call) => call.path.includes("/audit-logs")).at(-1)?.path ?? "", "http://localhost");
  assert.deepEqual([request.searchParams.get("tenant_id"), request.searchParams.get("limit")], [TENANT_ID, "50"]);
  assert.equal(new Date(request.searchParams.get("to") ?? "").getTime() - new Date(request.searchParams.get("from") ?? "").getTime(), 9 * 24 * 3600 * 1000, "「到 10-09」是 10-10 零点之前");

  await actor.click(screen.getByRole("button", { name: "第 4 条记录的详情" }));
  const detail = screen.getByRole("dialog", { name: "修改 · 区域 东京 23 区" });
  const diff = within(detail).getByRole("table");
  assert.deepEqual(within(diff).getAllByRole("rowheader").map((cell) => cell.textContent), ["状态status", "polygons"]);
  assert.match(within(diff).getByRole("row", { name: /状态/ }).textContent ?? "", /启用active.*已停用disabled/);
  assert.ok(within(detail).getByText("另有 1 项没有变"));
  const expand = within(diff).getAllByRole("button", { name: /^展开（共 \d+ 行）$/ });
  assert.equal(expand[0]?.getAttribute("aria-expanded"), "false");
  await actor.click(expand[0] as HTMLElement);
  assert.ok(within(diff).getAllByRole("button", { name: "收起" }).length >= 1);
  await actor.click(within(detail).getByRole("button", { name: "全部显示" }));
  assert.match(within(diff).getByRole("row", { name: /名称/ }).textContent ?? "", /没有变/);
  assert.match(detail.textContent ?? "", /来源地址203\.0\.113\.9/);
  assert.match(detail.textContent ?? "", /所属供应商NOZOMI 自营车队/);
  assert.match(detail.textContent ?? "", /密码、密码的哈希、邀请和重置链接里的令牌不会被记录，所以这里看不到，不是被隐藏了。/);
  await actor.click(within(detail.querySelector(".dialog__footer") as HTMLElement).getByRole("button", { name: "关闭" }));

  await actor.click(screen.getByRole("button", { name: "第 6 条记录的详情" }));
  const failedLogin = screen.getByRole("dialog", { name: "登录失败 · 供应商的账号 a@example.com" });
  assert.deepEqual(within(within(failedLogin).getByRole("table")).getAllByRole("columnheader").map((cell) => cell.textContent), ["项目", "内容"]);
  await actor.keyboard("{Escape}");
  await actor.click(screen.getByRole("button", { name: "第 5 条记录的详情" }));
  assert.ok(within(screen.getByRole("dialog")).getByText("这次操作没有记下更多内容。"));
  await actor.keyboard("{Escape}");

  // 只看这个人：带上操作人的编号，标签上写邮箱
  await actor.click(screen.getAllByRole("button", { name: "操作人 kato@example.com" })[0] as HTMLElement);
  await actor.click(screen.getByRole("menuitem", { name: "只看这个人" }));
  await screen.findByText("操作人：kato@example.com");
  await waitFor(() => assert.equal(new URL(calls.filter((call) => call.path.includes("/audit-logs")).at(-1)?.path ?? "", "http://localhost").searchParams.get("actor_id"), ME_ID));
  assert.ok(screen.getByRole("button", { name: "移除条件：操作人：kato@example.com" }));

  resetBrowser();
  const bad = open("/platform/settings/audit-logs?actor=不是编号&from=2026-02-31&resource=tenant", "super_admin", { logs: [] });
  await screen.findByText("网址里有一个筛选条件不对，已经忽略。");
  await screen.findByText("没有符合条件的记录");
  const sent = new URL(bad.filter((call) => call.path.includes("/audit-logs")).at(-1)?.path ?? "", "http://localhost");
  assert.deepEqual([sent.searchParams.get("actor_id"), sent.searchParams.get("from"), sent.searchParams.get("resource")], [null, null, "tenant"]);
});

test("系统状态：只读；有未配置的项时说清楚密钥只能由负责人本人填；不自动刷新（窗口重新获得焦点也不重取），点「重新检查」才请求", async () => {
  const actor = user();
  const calls = open("/platform/settings/integrations", "tech");
  await screen.findByText("postgres://nozomi_app:••••@db:5432/nozomi");
  assert.match(pageText(), /这里只显示各项配好了没有，以及打过码的信息；看不到密钥原文。每次打开这一页都会记入审计日志。/);
  assert.match(pageText(), /有 1 项还没有配置：Stripe。用到它们的功能现在不能用。配置要由技术在服务器上做；密钥只能由负责人本人填进各平台的设置页面，不要发在聊天里。/);
  assert.match(screen.getByText("Stripe").closest("tr")?.textContent ?? "", /Stripe未配置—/);
  const count = (): number => calls.filter((call) => call.path === "/platform/v1/integrations").length;
  assert.equal(count(), 1);
  window.dispatchEvent(new Event("focus"));
  document.dispatchEvent(new Event("visibilitychange"));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(count(), 1, "不自动刷新");
  await actor.click(screen.getByRole("button", { name: "重新检查" }));
  await screen.findByText("已重新检查，1 项未配置");
  assert.equal(count(), 2);
  assert.doesNotMatch(pageText(), /configured|missing|integration/);
});

test("五个发令牌的接口：应答成功却没有带令牌（缺了、是空的、不是字符串），都按「不知道有没有成功」报出来，只发一次", async () => {
  const user = { id: STAFF_ID, email: "sato@example.com", name: "佐藤 健", role: "admin", status: "invited", ...stamps };
  const requests: [string, () => Promise<unknown>, (issued: unknown) => unknown][] = [
    ["新建供应商", () => createTenant("t", { name: "新车队", admin: { email: "sato@example.com", name: "佐藤 健" } }), (issued) => ({ tenant: tenantOf(), admin_user: user, invite: issued })],
    ["邀请管理员", () => inviteTenantAdmin("t", TENANT_ID, { email: "sato@example.com", name: "佐藤 健" }), (issued) => ({ user, invite: issued })],
    ["给管理员发密码重置", () => issueTenantAdminReset("t", TENANT_ID, "sato@example.com"), (issued) => ({ user, reset: issued })],
    ["新增员工", () => createStaff("t", { email: "sato@example.com", name: "佐藤 健", role: "operations" }), (issued) => ({ user: staffOf(), invite: issued })],
    ["给员工发密码重置", () => issueStaffReset("t", STAFF_ID), (issued) => ({ user: staffOf(), reset: issued })],
  ];
  for (const [what, send, bodyOf] of requests) {
    for (const issued of [undefined, null, { expires_at: invite.expires_at }, { token: "", expires_at: invite.expires_at }, { token: 42, expires_at: invite.expires_at }]) {
      const calls = stubApiWith(() => json(201, bodyOf(issued)));
      await assert.rejects(send, (err: unknown) => err instanceof ApiError && err.code === "UNKNOWN" && err.status >= 500, `${what}：${JSON.stringify(issued)}`);
      assert.equal(calls.length, 1, `${what} 不重试`);
    }
    stubApiWith(() => json(201, bodyOf(invite)));
    await assert.doesNotReject(send, `${what}：带了令牌的照常交给页面`);
  }
});

test("邮箱过了页面的格式检查、却被后端判为不合规：新建供应商、新增员工、邀请管理员都把出错落在邮箱字段下面并把焦点放回去，页面顶上不再只有一句「不符合要求」；改了邮箱提示就消失", async () => {
  const actor = user();
  const refusal = (path: string): Response => apiError(400, "VALIDATION_FAILED", "请求参数校验未通过", { location: "body", issues: [{ path, message: "不是合法的邮箱" }] });
  const refusedText = /^系统不接受这个邮箱地址。/;

  let calls = open("/platform/tenants/new", "operations", {}, (call) => (call.method === "POST" ? refusal("/admin/email") : null));
  await screen.findByRole("heading", { level: 1, name: "新建供应商" });
  await actor.type(screen.getByLabelText(/^名称/), "新车队");
  await actor.type(screen.getByLabelText(/^邮箱/), "山田@example.com");
  await actor.type(screen.getByLabelText(/^姓名/), "山田太郎");
  await actor.click(screen.getByRole("button", { name: "新建" }));
  await waitFor(() => assert.match(document.getElementById("tenant-email-error")?.textContent ?? "", refusedText));
  assert.equal(screen.getByLabelText(/^邮箱/).getAttribute("aria-invalid"), "true");
  assertFocused(screen.getByLabelText(/^邮箱/));
  assert.doesNotMatch(pageText(), /提交的内容不符合要求|请求参数校验未通过|不是合法的邮箱/);
  assert.equal(writes(calls).length, 1);
  await actor.type(screen.getByLabelText(/^邮箱/), "x");
  assert.equal(document.getElementById("tenant-email-error")?.textContent ?? "", "");

  resetBrowser();
  calls = open("/platform/settings/staff/new", "super_admin", {}, (call) => (call.method === "POST" ? refusal("/email") : null));
  await screen.findByRole("heading", { level: 1, name: "新增员工" });
  await actor.type(screen.getByLabelText(/^邮箱/), "a@b.c");
  await actor.type(screen.getByLabelText(/^姓名/), "佐藤花子");
  await actor.click(screen.getByRole("radio", { name: /^只读/ }));
  await actor.click(screen.getByRole("button", { name: "新增" }));
  await waitFor(() => assert.match(document.getElementById("staff-email-error")?.textContent ?? "", refusedText));
  assertFocused(screen.getByLabelText(/^邮箱/));
  assert.doesNotMatch(pageText(), /提交的内容不符合要求/);
  await actor.type(screen.getByLabelText(/^邮箱/), "x");
  assert.equal(document.getElementById("staff-email-error")?.textContent ?? "", "");

  resetBrowser();
  calls = open(`/platform/tenants/${TENANT_ID}`, "operations", {}, (call) => (call.method === "POST" ? refusal("/email") : null));
  await screen.findByRole("heading", { level: 1, name: "NOZOMI 自营车队" });
  await actor.click(screen.getByRole("button", { name: "邀请管理员" }));
  const dialog = screen.getByRole("dialog", { name: "邀请管理员" });
  await actor.type(within(dialog).getByLabelText(/^邮箱/), "山田@example.com");
  await actor.type(within(dialog).getByLabelText(/^姓名/), "山田太郎");
  await actor.click(within(dialog).getByRole("button", { name: "邀请" }));
  await waitFor(() => assert.match(document.getElementById("tenant-admin-email-error")?.textContent ?? "", refusedText));
  assert.doesNotMatch(dialog.textContent ?? "", /提交的内容不符合要求/);
  assert.equal(writes(calls).length, 1);

  // 被点名的不是邮箱：仍然是页面顶上的那一句
  resetBrowser();
  open("/platform/settings/staff/new", "super_admin", {}, (call) => (call.method === "POST" ? refusal("/name") : null));
  await screen.findByRole("heading", { level: 1, name: "新增员工" });
  await actor.type(screen.getByLabelText(/^邮箱/), "sato@example.com");
  await actor.type(screen.getByLabelText(/^姓名/), "佐藤花子");
  await actor.click(screen.getByRole("radio", { name: /^只读/ }));
  await actor.click(screen.getByRole("button", { name: "新增" }));
  await screen.findByText("提交的内容不符合要求，请检查后重试。");
  assert.equal(document.getElementById("staff-email-error")?.textContent ?? "", "");
});

test("审计日志的「筛选」面板（手机宽度用）：面板里改的是草稿，不发请求；日期写错不关面板并指出是哪一个；点「查看结果」才一起生效并关闭；「清空」清掉面板里的条件；直接关掉不生效", async () => {
  const actor = user();
  const calls = open("/platform/settings/audit-logs?action=suspend", "super_admin");
  const requests = (): URL[] => calls.filter((call) => call.path.startsWith("/platform/v1/audit-logs")).map((call) => new URL(call.path, "http://localhost"));
  await screen.findByText("本页 1 条");
  const before = requests().length;
  await actor.click(screen.getByRole("button", { name: "筛选 · 1" }));
  const panel = screen.getByRole("dialog", { name: "筛选" });
  const field = (id: string): HTMLInputElement => panel.querySelector(`#audit-panel-${id}`) as HTMLInputElement;
  assert.equal(field("action").value, "suspend", "面板打开时带着现在生效的条件");
  await actor.selectOptions(field("resource"), "tenant");
  await actor.type(field("from"), "2026/10/1");
  await actor.type(field("to"), "2026-02-31");
  assert.equal(requests().length, before, "面板里改条件不发请求");
  await actor.click(within(panel).getByRole("button", { name: "查看结果" }));
  assert.ok(within(panel).getByText("这不是一个日期，请按 2026-10-08 的格式填写"));
  assert.equal(field("to").getAttribute("aria-invalid"), "true");
  assert.equal(field("from").getAttribute("aria-invalid"), null);
  assertFocused(field("to"));
  assert.equal(requests().length, before, "日期不对时不生效");
  await actor.clear(field("to"));
  await actor.type(field("to"), "20261009");
  await actor.click(within(panel).getByRole("button", { name: "查看结果" }));
  await waitFor(() => assertAbsent(screen.queryByRole("dialog", { name: "筛选" })));
  await waitFor(() => assert.equal(requests().length, before + 1, "一起生效，只发一次"));
  const sent = requests().at(-1) as URL;
  assert.deepEqual([sent.searchParams.get("resource"), sent.searchParams.get("action")], ["tenant", "suspend"]);
  assert.equal(sent.searchParams.get("from"), new Date(2026, 9, 1).toISOString());
  assert.equal(sent.searchParams.get("to"), new Date(2026, 9, 10).toISOString());
  await screen.findByRole("button", { name: "筛选 · 4" });

  // 面板里的快捷按钮只填草稿；改了没点「查看结果」就关掉，不生效
  await actor.click(screen.getByRole("button", { name: "筛选 · 4" }));
  let again = screen.getByRole("dialog", { name: "筛选" });
  await actor.click(within(again).getByRole("button", { name: "今天" }));
  assert.equal((again.querySelector("#audit-panel-from") as HTMLInputElement).value, (again.querySelector("#audit-panel-to") as HTMLInputElement).value);
  assert.notEqual((again.querySelector("#audit-panel-from") as HTMLInputElement).value, "2026-10-01");
  await actor.click(within(again).getByRole("button", { name: "关闭" }));
  await waitFor(() => assertAbsent(screen.queryByRole("dialog", { name: "筛选" })));
  assert.equal(requests().length, before + 1);
  assert.ok(screen.getByRole("button", { name: "筛选 · 4" }));

  // 清空：面板里的条件都清掉，点「查看结果」后不带任何条件
  await actor.click(screen.getByRole("button", { name: "筛选 · 4" }));
  again = screen.getByRole("dialog", { name: "筛选" });
  await actor.click(within(again).getByRole("button", { name: "清空" }));
  assert.equal((again.querySelector("#audit-panel-from") as HTMLInputElement).value, "");
  assert.equal((again.querySelector("#audit-panel-action") as HTMLSelectElement).value, "");
  await actor.click(within(again).getByRole("button", { name: "查看结果" }));
  await waitFor(() => assert.equal(requests().length, before + 2));
  const cleared = requests().at(-1) as URL;
  assert.deepEqual(["from", "to", "resource", "action", "tenant_id"].map((name) => cleared.searchParams.get(name)), [null, null, null, null, null]);
  assert.ok(screen.getByRole("button", { name: "筛选" }));
});
