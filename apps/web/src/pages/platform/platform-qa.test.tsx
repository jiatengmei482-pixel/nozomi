/**
 * M1-10 测试角色补的组件测试：十个平台角色逐个的可见性、各接口各错误码、重复提交、供应商列表超过一页和上千家、
 * 审计日志里各种奇怪的值和被改坏的网址、系统状态不自动刷新。接口用测试替身；真实后端由 e2e/platform-tenants-qa.spec.ts 覆盖。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { AuditLog } from "../../api/platform.ts";
import type { PlatformUser, Tenant } from "../../api/types.ts";
import { ErrorBoundary } from "../../components/ErrorBoundary.tsx";
import { OneTimeLinkDialog } from "../../components/OneTimeLinkDialog.tsx";
import { type ApiCall, apiError, assertAbsent, assertFocused, deferred, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-10-06T00:12:00.000Z", updated_at: "2026-10-08T05:30:00.000Z" };
const TENANT_ID = "7b1c2d3e-aaaa-4bbb-8ccc-ddddeeeeffff";
const ME_ID = "11111111-1111-4111-8111-111111111111";
const STAFF_ID = "22222222-2222-4222-8222-222222222222";
const TOKEN = "nzi_QA-secret-token-0123456789abcdefghij";
const tenantOf = (changes: Partial<Tenant> = {}): Tenant => ({ id: TENANT_ID, name: "NOZOMI 自营车队", status: "active", ...stamps, ...changes });
const staffOf = (changes: Partial<PlatformUser> = {}): PlatformUser => ({ id: STAFF_ID, email: "sato@example.com", name: "佐藤 健", role: "operations", status: "active", ...stamps, ...changes });
const meOf = (role: string): PlatformUser => ({ id: ME_ID, email: "kato@example.com", name: "加藤 美咲", role: role as PlatformUser["role"], status: "active", ...stamps });
const logOf = (changes: Partial<AuditLog> = {}): AuditLog => ({ id: "7", occurred_at: "2026-10-09T02:02:37.000Z", tenant_id: TENANT_ID, actor: { type: "platform_user", id: ME_ID, email: "kato@example.com" }, ip: "203.0.113.9", source: "console", resource: "tenant", resource_id: TENANT_ID, action: "suspend", before: { status: "active" }, after: { status: "suspended", reason: "资质到期" }, ...changes });
const invite = { token: TOKEN, expires_at: "2026-10-16T05:30:00.000Z" };
const uuidOf = (index: number): string => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;
interface World {
  tenants?: Tenant[];
  staff?: PlatformUser[];
  logs?: AuditLog[];
  mustChange?: boolean;
}
function open(path: string | { pathname: string; search?: string; state?: unknown }, role: string, world: World = {}, routes: Route = () => null): ApiCall[] {
  signIn("platform", "platform-token");
  const calls = stubApiWith((call) => {
    const custom = routes(call);
    if (custom !== null) return custom;
    if (call.method !== "GET") return null;
    const at = call.url.pathname;
    if (at === "/platform/v1/auth/me") return json(200, { user: meOf(role), permissions: [], must_change_password: world.mustChange ?? false });
    if (at === "/platform/v1/dashboard/summary") return json(200, { tenants: ["super_admin", "operations", "tenant_onboarding", "channel_manager", "readonly"].includes(role) ? { total: 2, active: 1, suspended: 1 } : null, master_data: null });
    if (at === "/platform/v1/tenants") return json(200, { items: world.tenants ?? [tenantOf()], next_cursor: null });
    const found = (world.tenants ?? [tenantOf()]).find((tenant) => at === `/platform/v1/tenants/${tenant.id}`);
    if (found) return json(200, found);
    if (at.startsWith("/platform/v1/tenants/")) return apiError(404, "NOT_FOUND", "没有");
    if (at === "/platform/v1/staff") return json(200, { items: world.staff ?? [meOf(role), staffOf()], next_cursor: null });
    if (at === "/platform/v1/audit-logs") return json(200, { items: world.logs ?? [logOf()], next_cursor: null });
    if (at === "/platform/v1/integrations") return json(200, { items: [{ key: "database", label: "数据库", state: "configured", detail: "postgres://nozomi_app:•••@db:5432/nozomi" }, { key: "stripe", label: "Stripe 支付", state: "missing", detail: "未配置，无法收款" }] });
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
const menuLabels = (): string[] => [...new Set([...document.querySelectorAll('nav[aria-label="主菜单"] .nav-item')].map((node) => node.textContent ?? ""))];
const settle = (ms = 80): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const rowNames = (): string[] => [...document.querySelectorAll(".card-table tbody th")].map((node) => node.textContent ?? "");
const auditRequests = (calls: ApiCall[]): URL[] => calls.filter((call) => call.path.startsWith("/platform/v1/audit-logs")).map((call) => new URL(call.path, "http://localhost"));
/** 页面上任何地方（文字、属性值、输入框的值）出现了这段内容的元素。 */
function placesOf(secret: string): string[] {
  return [...document.querySelectorAll("*")].filter((node) => [...node.attributes].some((attribute) => attribute.value.includes(secret)) || (node.children.length === 0 && (node.textContent ?? "").includes(secret)) || String((node as HTMLInputElement).value ?? "").includes(secret)).map((node) => node.tagName);
}

// ───────────── 权限：十个平台角色逐个 ─────────────

/** 期望值单独写在这里（不从 access.ts 现算）：权限表被改动时这条会失败，提醒同时核对页面。 */
const ROLE_EXPECTATIONS: Readonly<Record<string, { tenants: "manage" | "read" | "none"; staff: boolean; audit: boolean; integrations: boolean }>> = {
  super_admin: { tenants: "manage", staff: true, audit: true, integrations: true },
  operations: { tenants: "manage", staff: false, audit: false, integrations: false },
  tenant_onboarding: { tenants: "manage", staff: false, audit: false, integrations: false },
  channel_manager: { tenants: "read", staff: false, audit: false, integrations: false },
  customer_service: { tenants: "none", staff: false, audit: false, integrations: false },
  finance: { tenants: "none", staff: false, audit: false, integrations: false },
  risk: { tenants: "none", staff: false, audit: false, integrations: false },
  master_data: { tenants: "none", staff: false, audit: false, integrations: false },
  tech: { tenants: "none", staff: false, audit: false, integrations: true },
  readonly: { tenants: "read", staff: false, audit: false, integrations: false },
};

for (const [role, expected] of Object.entries(ROLE_EXPECTATIONS)) {
  test(`角色 ${role}：菜单、首页卡片、七个页面直接输入地址、各按钮都只给该给的；没有权限的页面不去取对应的数据`, async () => {
    const actor = user();
    // 首页：菜单和供应商卡片
    open("/platform", role);
    await waitFor(() => assert.ok(menuLabels().includes("主数据")));
    assert.equal(menuLabels().includes("供应商"), expected.tenants !== "none", "菜单里的「供应商」");
    const settings = screen.queryAllByRole("button", { name: "系统设置" })[0] ?? null;
    assert.equal(settings !== null, expected.staff || expected.audit || expected.integrations, "菜单里的「系统设置」分组");
    if (settings !== null) {
      if (settings.getAttribute("aria-expanded") === "false") await actor.click(settings);
      assert.deepEqual([menuLabels().includes("平台员工"), menuLabels().includes("审计日志"), menuLabels().includes("系统状态")], [expected.staff, expected.audit, expected.integrations], "系统设置里的三项");
    }
    await settle();
    assert.equal(document.querySelector('.entry-card a[href="/platform/tenants"], a.entry-card[href="/platform/tenants"]') !== null || screen.queryAllByRole("link", { name: "供应商", description: /正常/ }).length > 0, expected.tenants !== "none", "首页的供应商卡片");

    const visit = async (path: string, allowed: boolean, heading: string, data: RegExp): Promise<ApiCall[]> => {
      resetBrowser();
      const calls = open(path, role);
      if (allowed) {
        await screen.findByRole("heading", { level: 1, name: heading });
        await settle();
        assertAbsent(screen.queryByText("你没有权限查看这里"));
      } else {
        await screen.findByText("你没有权限查看这里");
        await settle();
        assert.deepEqual(calls.filter((call) => data.test(call.path)).map((call) => call.path), [], `${role} 打开 ${path} 不该发这些请求`);
      }
      assert.deepEqual(writes(calls), [], "打开页面不发任何写请求");
      return calls;
    };

    await visit("/platform/tenants", expected.tenants !== "none", "供应商", /\/v1\/(tenants|audit-logs)/);
    if (expected.tenants !== "none") {
      await screen.findByRole("link", { name: "NOZOMI 自营车队" });
      assert.equal(screen.queryAllByRole("link", { name: "新建供应商" }).length > 0, expected.tenants === "manage");
      assert.equal(screen.queryByRole("button", { name: /的更多操作$/ }) !== null, expected.tenants === "manage");
      assert.equal(screen.queryByText("你可以查看供应商，但不能修改。") !== null, expected.tenants === "read");
    }
    await visit("/platform/tenants/new", expected.tenants === "manage", "新建供应商", /\/v1\/(tenants|audit-logs)/);
    const detailCalls = await visit(`/platform/tenants/${TENANT_ID}`, expected.tenants !== "none", "NOZOMI 自营车队", /\/v1\/(tenants|audit-logs)/);
    if (expected.tenants !== "none") {
      for (const name of ["暂停", "邀请管理员", "发密码重置链接"]) assert.equal(screen.queryByRole("button", { name }) !== null, expected.tenants === "manage", `详情页的「${name}」`);
      assert.equal(screen.queryByRole("link", { name: /看这家供应商的操作记录/ }) !== null, expected.audit);
      if (!expected.audit) assert.equal(detailCalls.filter((call) => call.path.includes("audit-logs")).length, 0);
    }
    // 已暂停的供应商：只有能看审计日志的角色去取暂停原因
    if (expected.tenants !== "none") {
      resetBrowser();
      const calls = open(`/platform/tenants/${TENANT_ID}`, role, { tenants: [tenantOf({ status: "suspended" })] });
      await screen.findByText("这家供应商已暂停。");
      await settle();
      assert.equal(calls.filter((call) => call.path.includes("audit-logs")).length > 0, expected.audit, "暂停原因只有能看审计日志的角色去取");
      assert.equal(screen.queryByRole("button", { name: "恢复" }) !== null, expected.tenants === "manage");
    }
    await visit("/platform/settings/staff", expected.staff, "平台员工", /\/v1\/(staff|audit-logs)/);
    await visit("/platform/settings/staff/new", expected.staff, "新增员工", /\/v1\/(staff|audit-logs)/);
    await visit("/platform/settings/audit-logs", expected.audit, "审计日志", /\/v1\/(audit-logs|tenants|staff)/);
    await visit("/platform/settings/integrations", expected.integrations, "系统状态", /\/v1\/integrations/);
    assert.doesNotMatch(pageText(), new RegExp(`\\b${role}\\b`), "页面上不出现角色的英文键");
  });
}

test("后端给了一个前端不认识的角色：不崩，菜单里没有供应商和系统设置，七个页面都是没有权限，也不去取数据", async () => {
  for (const path of ["/platform/tenants", "/platform/tenants/new", `/platform/tenants/${TENANT_ID}`, "/platform/settings/staff", "/platform/settings/staff/new", "/platform/settings/audit-logs", "/platform/settings/integrations"]) {
    resetBrowser();
    const calls = open(path, "regional_manager");
    await screen.findByText("你没有权限查看这里");
    await settle();
    assert.deepEqual(calls.filter((call) => /\/v1\/(tenants|staff|audit-logs|integrations)/.test(call.path)).map((call) => call.path), []);
    assert.ok(!menuLabels().includes("供应商") && !menuLabels().includes("系统设置"));
  }
});

test("供应商账号（只有供应商后台的登录）打开运营后台这几个地址：被送去运营后台的登录页，不带着供应商的令牌去请求任何运营接口", async () => {
  for (const path of ["/platform/tenants", "/platform/tenants/new", `/platform/tenants/${TENANT_ID}`, "/platform/settings/staff", "/platform/settings/audit-logs", "/platform/settings/integrations"]) {
    resetBrowser();
    signIn("tenant", "tenant-token");
    const calls = stubApiWith(() => null);
    render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "登录" });
    assert.match(pageText(), /运营后台/);
    await settle();
    assert.deepEqual(calls.map((call) => call.path), [], "没有登录运营后台时一个请求都不发");
  }
});

test("账号必须先改密码时：这几个地址都被带到修改密码页，不去取供应商、员工、审计日志、系统状态", async () => {
  for (const path of ["/platform/tenants", "/platform/tenants/new", "/platform/settings/staff", "/platform/settings/audit-logs", "/platform/settings/integrations"]) {
    resetBrowser();
    const calls = open(path, "super_admin", { mustChange: true });
    await screen.findByRole("heading", { level: 1, name: "设置新密码" });
    await settle();
    assert.deepEqual(calls.filter((call) => /\/v1\/(tenants|staff|audit-logs|integrations)/.test(call.path)).map((call) => call.path), [], `${path}：必须先改密码时不取数据`);
  }
});

test("操作到一半后端说必须先改密码（403 PASSWORD_CHANGE_REQUIRED）或登录已过期（401）：新建供应商分别被带去改密码页和登录页，不显示成别的错", async () => {
  const actor = user();
  for (const [answer, landing] of [[() => apiError(403, "PASSWORD_CHANGE_REQUIRED", "先改密码"), /设置新密码/], [() => apiError(401, "UNAUTHENTICATED", "过期"), /登录/]] as const) {
    resetBrowser();
    const calls = open("/platform/tenants/new", "super_admin", {}, (call) => (call.method === "POST" && call.path === "/platform/v1/tenants" ? answer() : null));
    await screen.findByRole("heading", { level: 1, name: "新建供应商" });
    await actor.type(screen.getByLabelText(/^名称/), "新车队");
    await actor.type(screen.getByLabelText(/^邮箱/), "yamada@example.com");
    await actor.type(screen.getByLabelText(/^姓名/), "山田太郎");
    await actor.click(screen.getByRole("button", { name: "新建" }));
    if (landing.source === "登录") await screen.findByRole("button", { name: "登录" });
    else await waitFor(() => assert.match(document.querySelector("h1")?.textContent ?? "", landing));
    assert.equal(writes(calls).filter((call) => call.path === "/platform/v1/tenants").length, 1);
    assertAbsent(screen.queryByRole("dialog", { name: /只显示这一次/ }));
  }
});

// ───────────── 新建供应商：各种应答 ─────────────

async function fillNewTenant(actor: ReturnType<typeof user>, name = "新车队"): Promise<void> {
  await screen.findByRole("heading", { level: 1, name: "新建供应商" });
  await actor.type(screen.getByLabelText(/^名称/), name);
  await actor.type(screen.getByLabelText(/^邮箱/), "yamada@example.com");
  await actor.type(screen.getByLabelText(/^姓名/), "山田太郎");
}

test("新建供应商被各种方式拒绝：429 说要等多久；500、502 网页、应答不是 JSON、断网都按「不确定有没有建成」并给去列表的链接；404、409 别的码用后端的中文；每点一次只发一次，页面上不出现状态码和英文错误码", async () => {
  const actor = user();
  let answer: () => Response | Promise<Response> = () => apiError(429, "RATE_LIMITED", "太快了", {}, { "retry-after": "120" });
  const calls = open("/platform/tenants/new", "operations", {}, (call) => (call.method === "POST" ? answer() : null));
  await fillNewTenant(actor);
  const submit = async (): Promise<void> => {
    const before = writes(calls).length;
    await actor.click(screen.getByRole("button", { name: "新建" }));
    await waitFor(() => assert.equal(writes(calls).length, before + 1));
    await settle(150);
    assert.equal(writes(calls).length, before + 1, "没有自动重试");
    assertAbsent(screen.queryByRole("dialog", { name: /只显示这一次/ }));
  };
  await submit();
  await screen.findByText("尝试次数过多，请 2 分钟后再试。");
  assertAbsent(screen.queryByText("不确定有没有建成。"));

  for (const unsure of [
    () => apiError(500, "INTERNAL_ERROR", "boom"),
    () => new Response("<html><body>502 Bad Gateway</body></html>", { status: 502, headers: { "content-type": "text/html" } }),
    () => new Response("<html>not json</html>", { status: 201, headers: { "content-type": "text/html" } }),
    () => new Response("", { status: 201 }),
    () => Promise.reject(new TypeError("Failed to fetch")),
    () => Promise.reject(new DOMException("The operation was aborted.", "AbortError")),
  ]) {
    answer = unsure;
    await submit();
    await screen.findByText("不确定有没有建成。");
    assert.match(pageText(), /请先回到供应商列表看一眼有没有「新车队」：有的话不要再建一次/);
    assert.equal(screen.getByRole("link", { name: "去供应商列表看一眼" }).getAttribute("href"), "/platform/tenants");
    assert.equal((screen.getByLabelText(/^邮箱/) as HTMLInputElement).value, "yamada@example.com", "填的内容还在");
    assert.equal((screen.getByLabelText(/^名称/) as HTMLInputElement).readOnly, false, "可以再点");
  }

  answer = () => apiError(409, "CONFLICT", "这家供应商正在被别人修改，请稍后再试。");
  await submit();
  await screen.findByText("这家供应商正在被别人修改，请稍后再试。");
  answer = () => apiError(400, "VALIDATION_FAILED", "请求参数校验未通过", { location: "body", issues: [{ path: "/name", message: "最多 100 个字符" }] });
  await submit();
  await screen.findByText("提交的内容不符合要求，请检查后重试。");
  assert.doesNotMatch(pageText(), /RATE_LIMITED|INTERNAL_ERROR|VALIDATION_FAILED|CONFLICT|Bad Gateway|Failed to fetch|AbortError|\b(4\d\d|5\d\d)\b|请求参数校验未通过/);
  assert.ok(writes(calls).every((call) => call.headers["authorization"] === "Bearer platform-token"));
});

test("新建供应商的应答是 201、却没有带令牌（接口坏了一半）：不能把「#token=undefined」当成邀请链接交出去", async () => {
  const actor = user();
  const created = tenantOf({ id: uuidOf(9), name: "新车队" });
  open("/platform/tenants/new", "operations", {}, (call) => (call.method === "POST" ? json(201, { tenant: created, admin_user: { id: "u9", email: "yamada@example.com", name: "山田太郎", role: "admin", status: "invited", ...stamps }, invite: { expires_at: invite.expires_at } }) : null));
  await fillNewTenant(actor);
  await actor.click(screen.getByRole("button", { name: "新建" }));
  await settle(200);
  const box = document.querySelector<HTMLTextAreaElement>("dialog[open] textarea");
  assert.ok(box === null || !/#token=(undefined|null)?$/.test(box.value), `对话框里出现了一条用不了的链接：${box?.value ?? ""}`);
  // 供应商其实已经建好了：要让人先去列表核对，而不是「稍后再试」再建一家
  await screen.findByText("不确定有没有建成。");
});

test("连点两下、回车加点击：新建供应商、邀请管理员、发密码重置、暂停、新增员工、给员工发重置、停用，应答没回来之前都只发一次；等待时按钮写着进行中，表单只读", async () => {
  const actor = user();
  // 新建供应商
  let pending = deferred();
  let calls = open("/platform/tenants/new", "operations", {}, (call) => (call.method === "POST" ? pending.promise : null));
  await fillNewTenant(actor);
  await actor.dblClick(screen.getByRole("button", { name: "新建" }));
  await actor.type(screen.getByLabelText(/^姓名/), "{Enter}");
  await screen.findByRole("button", { name: "新建中…" });
  await actor.click(screen.getByRole("button", { name: "新建中…" }));
  fireEvent.submit(document.querySelector("form") as HTMLFormElement);
  assert.equal(writes(calls).length, 1, "新建供应商只发一次");
  assert.deepEqual([...document.querySelectorAll<HTMLInputElement>("form .card input")].map((input) => input.readOnly), [true, true, true]);
  assert.equal((screen.getByRole("button", { name: "取消" }) as HTMLButtonElement).disabled, true);
  pending.resolve(apiError(409, "EMAIL_TAKEN", "taken"));
  await screen.findByText(/这个邮箱已经是某家供应商的账号了/);

  // 详情页的三个对话框
  resetBrowser();
  pending = deferred();
  calls = open(`/platform/tenants/${TENANT_ID}`, "operations", {}, (call) => (call.method === "POST" ? pending.promise : null));
  await screen.findByRole("heading", { level: 1, name: "NOZOMI 自营车队" });
  await actor.click(screen.getByRole("button", { name: "邀请管理员" }));
  let dialog = screen.getByRole("dialog", { name: "邀请管理员" });
  await actor.type(within(dialog).getByLabelText(/^邮箱/), "sato@example.com");
  await actor.type(within(dialog).getByLabelText(/^姓名/), "佐藤花子{Enter}");
  await within(dialog).findByRole("button", { name: "邀请中…" });
  await actor.click(within(dialog).getByRole("button", { name: "邀请中…" }));
  fireEvent.submit(dialog.querySelector("form") as HTMLFormElement);
  assert.equal(writes(calls).length, 1, "邀请只发一次");
  // 等待时 Esc、遮罩、右上角、取消都关不掉
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  fireEvent.click(dialog);
  assert.equal((within(dialog).getByRole("button", { name: "关闭" }) as HTMLButtonElement).disabled, true);
  assert.equal((within(dialog).getByRole("button", { name: "取消" }) as HTMLButtonElement).disabled, true);
  assert.ok(screen.getByRole("dialog", { name: "邀请管理员" }));
  pending.resolve(apiError(409, "EMAIL_TAKEN", "taken"));
  await within(dialog).findByText(/这个邮箱已经有账号了/);
  await actor.click(within(dialog).getByRole("button", { name: "取消" }));

  pending = deferred();
  await actor.click(screen.getByRole("button", { name: "发密码重置链接" }));
  dialog = screen.getByRole("dialog", { name: "给管理员发密码重置链接" });
  await actor.type(within(dialog).getByLabelText(/管理员的邮箱/), "sato@example.com{Enter}");
  await within(dialog).findByRole("button", { name: "发出中…" });
  await actor.click(within(dialog).getByRole("button", { name: "发出中…" }));
  assert.equal(writes(calls).length, 2, "重置只发一次");
  pending.resolve(apiError(404, "NOT_FOUND", "no"));
  await within(dialog).findByText(/这家供应商没有用这个邮箱的管理员/);
  await actor.click(within(dialog).getByRole("button", { name: "取消" }));

  pending = deferred();
  await actor.click(screen.getByRole("button", { name: "暂停" }));
  dialog = screen.getByRole("dialog", { name: "暂停「NOZOMI 自营车队」？" });
  await actor.type(within(dialog).getByLabelText(/暂停原因/), "测试");
  await actor.dblClick(within(dialog).getByRole("button", { name: "暂停" }));
  await within(dialog).findByRole("button", { name: "暂停中…" });
  await actor.click(within(dialog).getByRole("button", { name: "暂停中…" }));
  assert.equal(writes(calls).length, 3, "暂停只发一次");
  assert.equal((within(dialog).getByLabelText(/暂停原因/) as HTMLTextAreaElement).readOnly, true);
  pending.resolve(apiError(404, "NOT_FOUND", "no"));
  await within(dialog).findByText("找不到这家供应商，它可能已被删除。");
  assertAbsent(within(dialog).queryByRole("button", { name: "暂停" }));
  assert.ok(within(dialog).getByRole("button", { name: "知道了" }));

  // 新增员工
  resetBrowser();
  pending = deferred();
  calls = open("/platform/settings/staff/new", "super_admin", {}, (call) => (call.method === "POST" ? pending.promise : null));
  await screen.findByRole("heading", { level: 1, name: "新增员工" });
  await actor.type(screen.getByLabelText(/^邮箱/), "sato@example.com");
  await actor.type(screen.getByLabelText(/^姓名/), "佐藤 健");
  await actor.click(screen.getByRole("radio", { name: /^只读/ }));
  await actor.dblClick(screen.getByRole("button", { name: "新增" }));
  await screen.findByRole("button", { name: "新增中…" });
  fireEvent.submit(document.querySelector("form") as HTMLFormElement);
  assert.equal(writes(calls).length, 1, "新增员工只发一次");
  assert.ok(screen.getAllByRole("radio").every((radio) => (radio as HTMLInputElement).disabled), "等待时角色不能改");
  pending.resolve(apiError(409, "EMAIL_TAKEN", "taken"));
  await screen.findByText(/这个邮箱已经有一个设过密码的平台员工账号了/);

  // 员工列表：发重置、停用
  resetBrowser();
  pending = deferred();
  calls = open("/platform/settings/staff", "super_admin", {}, (call) => (call.method === "POST" ? pending.promise : null));
  const row = (await screen.findByText("sato@example.com")).closest("tr") as HTMLElement;
  await actor.click(within(row).getByRole("button", { name: /的更多操作$/ }));
  await actor.click(screen.getByRole("menuitem", { name: "发密码重置链接" }));
  dialog = screen.getByRole("dialog");
  await actor.dblClick(within(dialog).getByRole("button", { name: "发出" }));
  await within(dialog).findByRole("button", { name: "发出中…" });
  await actor.click(within(dialog).getByRole("button", { name: "发出中…" }));
  assert.equal(writes(calls).length, 1, "给员工发重置只发一次");
  pending.resolve(Promise.reject(new TypeError("Failed to fetch")) as unknown as Response);
  await within(dialog).findByText("不确定有没有成功。");
  await settle(150);
  assert.equal(writes(calls).length, 1, "网络不明时没有自动重试");
  assert.match(dialog.textContent ?? "", /再试一次会发出一条新的链接，之前那条作废/);
});

// ───────────── 名称、原因的边界；同名提示 ─────────────

test("供应商名称的边界：只有空白等于没填；100 个字可以、101 个不行；同名提示去掉首尾空格、不分大小写，只提示不拦；首尾空格不发给后端", async () => {
  const actor = user();
  const created = tenantOf({ id: uuidOf(9), name: "x" });
  const calls = open("/platform/tenants/new", "tenant_onboarding", { tenants: [tenantOf({ name: "  Relax Car  " })] }, (call) => (call.method === "POST" ? json(201, { tenant: created, admin_user: { id: "u9", email: "yamada@example.com", name: "山田太郎", role: "admin", status: "invited", ...stamps }, invite }) : null));
  await fillNewTenant(actor, "   ");
  await actor.click(screen.getByRole("button", { name: "新建" }));
  await screen.findByText("请填写名称");
  assertFocused(screen.getByLabelText(/^名称/));
  assert.equal(screen.getByLabelText(/^名称/).getAttribute("aria-invalid"), "true");
  fireEvent.change(screen.getByLabelText(/^名称/), { target: { value: "名".repeat(101) } });
  await screen.findByText("名称最多 100 个字");
  await actor.click(screen.getByRole("button", { name: "新建" }));
  assert.equal(writes(calls).length, 0);
  fireEvent.change(screen.getByLabelText(/^姓名/), { target: { value: "名".repeat(101) } });
  await screen.findByText("姓名最多 100 个字");
  fireEvent.change(screen.getByLabelText(/^姓名/), { target: { value: " 山田太郎 " } });
  fireEvent.change(screen.getByLabelText(/^邮箱/), { target: { value: "  Yamada@Example.com " } });

  fireEvent.change(screen.getByLabelText(/^名称/), { target: { value: " relax car " } });
  await screen.findByText("已经有一家叫「relax car」的供应商了。确定要再建一家同名的吗？");
  fireEvent.change(screen.getByLabelText(/^名称/), { target: { value: "relax car 2" } });
  await waitFor(() => assertAbsent(screen.queryByText(/已经有一家叫/)));
  fireEvent.change(screen.getByLabelText(/^名称/), { target: { value: `  ${"名".repeat(100)}  ` } });
  await waitFor(() => assertAbsent(screen.queryByText("名称最多 100 个字")));
  fireEvent.change(screen.getByLabelText(/^名称/), { target: { value: " RELAX CAR " } });
  await screen.findByText(/已经有一家叫「RELAX CAR」的供应商了/);
  await actor.click(screen.getByRole("button", { name: "新建" }));
  await screen.findByRole("dialog", { name: "邀请链接（只显示这一次）" });
  assert.deepEqual(writes(calls)[0]?.body, { name: "RELAX CAR", admin: { email: "Yamada@Example.com", name: "山田太郎" } });
});

test("暂停原因的边界：空、只有空白、换行都不发请求；500 个字可以（首尾空白不算）、501 个不行；带 HTML 的原样当文字发出去；剩 50 个字以内才播报字数", async () => {
  const actor = user();
  const calls = open(`/platform/tenants/${TENANT_ID}`, "operations", {}, (call) => (call.method === "POST" && call.path.endsWith("/suspend") ? json(200, tenantOf({ status: "suspended" })) : null));
  await screen.findByRole("heading", { level: 1, name: "NOZOMI 自营车队" });
  await actor.click(screen.getByRole("button", { name: "暂停" }));
  const dialog = screen.getByRole("dialog", { name: "暂停「NOZOMI 自营车队」？" });
  const box = within(dialog).getByLabelText(/暂停原因/) as HTMLTextAreaElement;
  const press = (): Promise<void> => actor.click(within(dialog).getByRole("button", { name: "暂停" }));
  const counter = (): Element => dialog.querySelector(".field__counter") as Element;
  for (const blank of ["", "   ", "\n\n \t", "　　"]) {
    fireEvent.change(box, { target: { value: blank } });
    await press();
    await within(dialog).findByText("请填写暂停原因");
    assert.equal(box.getAttribute("aria-invalid"), "true");
  }
  assert.equal(writes(calls).length, 0);
  // 点遮罩不关（有表单）
  fireEvent.click(dialog);
  assert.ok(screen.getByRole("dialog", { name: "暂停「NOZOMI 自营车队」？" }));

  fireEvent.change(box, { target: { value: "因".repeat(449) } });
  assert.deepEqual([counter().textContent, counter().getAttribute("aria-live")], ["449 / 500", "off"]);
  fireEvent.change(box, { target: { value: "因".repeat(450) } });
  assert.deepEqual([counter().textContent, counter().getAttribute("aria-live")], ["450 / 500", "polite"]);
  fireEvent.change(box, { target: { value: "因".repeat(501) } });
  await press();
  await within(dialog).findByText("原因最多 500 个字");
  assert.match(counter().className, /field__counter--over/);
  assert.equal(writes(calls).length, 0);
  const html = `<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>`;
  fireEvent.change(box, { target: { value: `  ${html}${"因".repeat(500 - html.length)}\n ` } });
  assert.equal(counter().textContent, "500 / 500");
  await press();
  await screen.findByText("已暂停「NOZOMI 自营车队」");
  assert.deepEqual(writes(calls).map((call) => [call.path, call.body]), [[`/platform/v1/tenants/${TENANT_ID}/suspend`, { reason: `${html}${"因".repeat(500 - html.length)}` }]]);
});

// ───────────── 供应商列表：超过一页、上千家、中途失败、搜索 ─────────────

test("供应商列表有 450 家：分三次取完（每次 200）；浏览器里每页 50 行，翻页、改每页条数、搜索、筛状态都不再请求；搜索不分大小写，正则和 SQL 的特殊字符只当普通文字", async () => {
  const actor = user();
  const special = ["a.c (Tokyo) [VIP]", "100% 安心_交通", "O'Brien \\ Sons", "C++ & <b>Taxi</b>", "ｆｕｌｌ ＷＩＤＴＨ"];
  const all = Array.from({ length: 450 }, (_, index) => tenantOf({ id: uuidOf(index), name: index < special.length ? (special[index] as string) : `车队 ${String(index).padStart(3, "0")}`, status: index % 9 === 0 ? "suspended" : "active", updated_at: new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString() }));
  const calls = open("/platform/tenants", "super_admin", {}, (call) => {
    if (call.method !== "GET" || call.url.pathname !== "/platform/v1/tenants") return null;
    const start = Number(call.url.searchParams.get("cursor") ?? "0");
    const limit = Number(call.url.searchParams.get("limit"));
    return json(200, { items: all.slice(start, start + limit), next_cursor: start + limit < all.length ? String(start + limit) : null });
  });
  await screen.findByRole("link", { name: "车队 449" });
  const listCalls = (): string[] => calls.filter((call) => call.path.startsWith("/platform/v1/tenants")).map((call) => call.path);
  assert.deepEqual(listCalls(), ["/platform/v1/tenants?limit=200", "/platform/v1/tenants?limit=200&cursor=200", "/platform/v1/tenants?limit=200&cursor=400"]);
  assert.equal(rowNames().length, 50);
  assert.deepEqual(rowNames().slice(0, 2), ["车队 449", "车队 448"], "最近修改的在前");
  assert.match(pageText(), /共 450 /);
  assertAbsent(screen.queryByText(/只载入了最早建的/));
  await actor.click(screen.getByRole("button", { name: "下一页" }));
  await waitFor(() => assert.equal(rowNames()[0], "车队 399"));
  assert.equal((screen.getByRole("button", { name: "上一页" }) as HTMLButtonElement).disabled, false);
  await actor.selectOptions(screen.getByRole("combobox", { name: /每页/ }), "100");
  await waitFor(() => assert.equal(rowNames().length, 100));
  assert.equal(rowNames()[0], "车队 449", "改每页条数回到第一页");

  const search = async (text: string): Promise<string[]> => {
    const box = screen.getByRole("searchbox", { name: "按名称搜索" });
    await actor.clear(box);
    if (text !== "") await actor.type(box, text.replace(/[[{]/g, "$&$&"));
    await actor.keyboard("{Enter}");
    await settle();
    return rowNames();
  };
  assert.deepEqual(await search("A.C (TOKYO)"), ["a.c (Tokyo) [VIP]"]);
  assert.deepEqual(await search(".*"), [], "正则的写法不当正则用");
  assert.ok(screen.getByText("没有符合条件的供应商"));
  assert.deepEqual(await search("[vip]"), ["a.c (Tokyo) [VIP]"]);
  assert.deepEqual(await search("100%"), ["100% 安心_交通"]);
  assert.deepEqual(await search("_"), ["100% 安心_交通"], "下划线不是通配符");
  assert.deepEqual(await search("o'brien \\"), ["O'Brien \\ Sons"]);
  assert.deepEqual(await search("<b>taxi</b>"), ["C++ & <b>Taxi</b>"]);
  assert.deepEqual(await search("  车队 44  "), ["车队 449", "车队 448", "车队 447", "车队 446", "车队 445", "车队 444", "车队 443", "车队 442", "车队 441", "车队 440"], "首尾空格不算");
  await search("");
  await actor.selectOptions(screen.getByRole("combobox", { name: "状态" }), "suspended");
  await waitFor(() => assert.match(pageText(), /共 50 /));
  assert.ok([...document.querySelectorAll(".card-table tbody tr")].every((row) => /已暂停/.test(row.textContent ?? "")));
  assert.equal(listCalls().length, 3, "翻页、搜索、筛选都在浏览器里做，不再请求");
  assert.equal(document.querySelector(".card-table b"), null, "名字里的标签只当文字");
});

test("供应商上千家：取到 2,000 家就停（10 次请求），表格上方提示只载入了最早建的 2,000 家；页面照常能用", async () => {
  const calls = open("/platform/tenants", "super_admin", {}, (call) => {
    if (call.method !== "GET" || call.url.pathname !== "/platform/v1/tenants") return null;
    const start = Number(call.url.searchParams.get("cursor") ?? "0");
    return json(200, { items: Array.from({ length: 200 }, (_, index) => tenantOf({ id: uuidOf(start + index), name: `车队 ${start + index}` })), next_cursor: String(start + 200) });
  });
  await screen.findByText("供应商太多，只载入了最早建的 2,000 家。请联系技术处理。", undefined, { timeout: 5000 });
  assert.equal(calls.filter((call) => call.path.startsWith("/platform/v1/tenants")).length, 10);
  assert.match(pageText(), /共 2,000 /);
  assert.equal(rowNames().length, 50);
  await settle(200);
  assert.equal(calls.filter((call) => call.path.startsWith("/platform/v1/tenants")).length, 10, "停下以后不再取");
});

test("供应商列表取到第三页时失败（500、断网、登录过期）：不显示半张表；重试从头取；登录过期回登录页", async () => {
  const actor = user();
  let mode: "500" | "network" | "ok" | "401" = "500";
  const calls = open("/platform/tenants", "readonly", {}, (call) => {
    if (call.method !== "GET" || call.url.pathname !== "/platform/v1/tenants") return null;
    const start = Number(call.url.searchParams.get("cursor") ?? "0");
    if (start === 400 && mode === "500") return apiError(500, "INTERNAL_ERROR", "boom");
    if (start === 400 && mode === "network") return Promise.reject(new TypeError("Failed to fetch"));
    if (start === 400 && mode === "401") return apiError(401, "UNAUTHENTICATED", "过期");
    return json(200, { items: Array.from({ length: start === 400 ? 3 : 200 }, (_, index) => tenantOf({ id: uuidOf(start + index), name: `车队 ${start + index}` })), next_cursor: start === 400 ? null : String(start + 200) });
  });
  await screen.findByText("加载失败");
  assert.equal(rowNames().length, 0, "不显示半张表");
  assertAbsent(screen.queryByText(/^共 /));
  mode = "network";
  await actor.click(screen.getByRole("button", { name: "重试" }));
  await waitFor(() => assert.equal(calls.filter((call) => call.path.startsWith("/platform/v1/tenants")).length, 6));
  await screen.findByText("加载失败");
  assert.equal(rowNames().length, 0);
  mode = "ok";
  await actor.click(screen.getByRole("button", { name: "重试" }));
  await waitFor(() => assert.match(pageText(), /共 403 /));
  assert.equal(calls.filter((call) => call.path.startsWith("/platform/v1/tenants")).at(-3)?.path, "/platform/v1/tenants?limit=200", "重试从第一页取起");

  resetBrowser();
  mode = "401";
  open("/platform/tenants", "readonly", {}, (call) => {
    if (call.method !== "GET" || call.url.pathname !== "/platform/v1/tenants") return null;
    const start = Number(call.url.searchParams.get("cursor") ?? "0");
    return start === 400 ? apiError(401, "UNAUTHENTICATED", "过期") : json(200, { items: [tenantOf({ id: uuidOf(start) })], next_cursor: String(start + 200) });
  });
  await screen.findByRole("button", { name: "登录" });
  assert.equal(sessionStorage.getItem("nozomi.session.platform"), null, "登录过期后令牌清掉");
});

test("供应商列表网址里的条件被改坏：不认识的状态、页码、每页条数都按默认；超长的搜索词只取前 100 个字；403 说没有权限", async () => {
  const tenants = Array.from({ length: 60 }, (_, index) => tenantOf({ id: uuidOf(index), name: `车队 ${String(index).padStart(2, "0")}`, updated_at: new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString() }));
  open(`/platform/tenants?status=deleted&page=-3&size=7&q=${encodeURIComponent(" ")}`, "super_admin", { tenants });
  await screen.findByRole("link", { name: "车队 59" });
  assert.equal(rowNames().length, 50);
  assert.equal((screen.getByRole("combobox", { name: "状态" }) as HTMLSelectElement).value, "all");
  for (const broken of ["page=999", "page=1.5", "page=abc", "page=0", "size=100000", "status=ACTIVE"]) {
    resetBrowser();
    open(`/platform/tenants?${broken}`, "super_admin", { tenants });
    await screen.findByRole("link", { name: "车队 59" });
    assert.ok(rowNames().length === 50 || rowNames().length === 60, broken);
  }
  resetBrowser();
  open(`/platform/tenants?q=${"长".repeat(300)}`, "super_admin", { tenants });
  await screen.findByText("没有符合条件的供应商");
  assert.equal((screen.getByRole("searchbox", { name: "按名称搜索" }) as HTMLInputElement).value.length, 100);

  resetBrowser();
  open("/platform/tenants", "super_admin", {}, (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/tenants" ? apiError(403, "FORBIDDEN", "no") : null));
  await screen.findByText("你没有权限查看这里");
  assertAbsent(screen.queryByText("加载失败"));
});

test("员工列表重新取失败时（发重置被拒「账号不在用」→ 知道了 → 重新取 → 500）：不能一声不响地继续显示旧的状态", async () => {
  const actor = user();
  let listFails = false;
  open("/platform/settings/staff", "super_admin", {}, (call) => {
    if (call.method === "POST") return apiError(409, "ACCOUNT_NOT_ACTIVE", "stale");
    if (call.method === "GET" && call.url.pathname === "/platform/v1/staff" && listFails) return apiError(500, "INTERNAL_ERROR", "boom");
    return null;
  });
  const row = (await screen.findByText("sato@example.com")).closest("tr") as HTMLElement;
  await actor.click(within(row).getByRole("button", { name: /的更多操作$/ }));
  await actor.click(screen.getByRole("menuitem", { name: "发密码重置链接" }));
  await actor.click(within(screen.getByRole("dialog")).getByRole("button", { name: "发出" }));
  await screen.findByText(/这个账号现在不是在用的状态/);
  listFails = true;
  await actor.click(within(screen.getByRole("dialog")).getByRole("button", { name: "知道了" }));
  await settle(200);
  // 后端刚说过这一行的状态是过时的，重新取又失败了：要么说加载失败，要么不再显示那一行过时的「在用」
  const stale = screen.queryByText("sato@example.com")?.closest("tr")?.textContent ?? "";
  assert.ok(screen.queryByText("加载失败") !== null || !/在用/.test(stale), `重新取失败后页面没有任何提示，仍显示：${stale}`);
});

// ───────────── 平台员工：各错误码 ─────────────

test("员工列表有 230 人：分两次取完（每次 200）；按姓名或邮箱搜索不分大小写、特殊字符只当文字；角色、状态可以一起筛；翻页、搜索、筛选都不再请求；网址里的条件被改坏按默认", async () => {
  const actor = user();
  const roles = ["operations", "finance", "readonly"] as const;
  const statuses = ["active", "invited", "disabled"] as const;
  const special = [
    { name: "O'Brien (Ops) [VIP]", email: "obrien@example.com" },
    { name: "100%_安心 <b>客服</b>", email: "Anshin.Plus+cs@Example.co.jp" },
  ];
  const all = Array.from({ length: 230 }, (_, index) =>
    staffOf({ id: uuidOf(index + 100), name: special[index]?.name ?? `员工 ${String(index).padStart(3, "0")}`, email: special[index]?.email ?? `staff${String(index).padStart(3, "0")}@example.com`, role: roles[index % 3] as PlatformUser["role"], status: statuses[index % 4 === 0 ? 2 : index % 2] as PlatformUser["status"] }),
  );
  const serve: Route = (call) => {
    if (call.method !== "GET" || call.url.pathname !== "/platform/v1/staff") return null;
    const start = Number(call.url.searchParams.get("cursor") ?? "0");
    const limit = Number(call.url.searchParams.get("limit"));
    return json(200, { items: all.slice(start, start + limit), next_cursor: start + limit < all.length ? String(start + limit) : null });
  };
  const calls = open("/platform/settings/staff", "super_admin", {}, serve);
  const emails = (): string[] => [...document.querySelectorAll(".card-table tbody .staff-email")].map((node) => node.textContent ?? "");
  const listCalls = (): string[] => calls.filter((call) => call.path.startsWith("/platform/v1/staff")).map((call) => call.path);
  await waitFor(() => assert.match(pageText(), /共 230 /));
  assert.deepEqual(listCalls(), ["/platform/v1/staff?limit=200", "/platform/v1/staff?limit=200&cursor=200"]);
  const firstPage = emails();
  assert.equal(firstPage.length, 50);
  await actor.click(screen.getByRole("button", { name: "下一页" }));
  await waitFor(() => assert.deepEqual([emails().length, emails().filter((email) => firstPage.includes(email))], [50, []], "第二页是另外 50 人"));

  const search = async (text: string): Promise<string[]> => {
    const box = screen.getByRole("searchbox", { name: "按姓名或邮箱搜索" });
    await actor.clear(box);
    if (text !== "") await actor.type(box, text.replace(/[[{]/g, "$&$&"));
    await actor.keyboard("{Enter}");
    await settle();
    return emails();
  };
  assert.deepEqual(await search("o'brien (OPS) [vip]"), ["obrien@example.com"]);
  assert.deepEqual(await search("ANSHIN.PLUS+CS@example"), ["Anshin.Plus+cs@Example.co.jp"], "按邮箱搜，不分大小写");
  assert.deepEqual(await search("100%_"), ["Anshin.Plus+cs@Example.co.jp"], "% 和 _ 不是通配符");
  assert.deepEqual(await search(".*"), [], "正则的写法不当正则用");
  assert.ok(screen.getByText("没有符合条件的员工"));
  assert.deepEqual(await search("<b>客服</b>"), ["Anshin.Plus+cs@Example.co.jp"]);
  assert.equal(document.querySelector(".card-table b"), null, "姓名里的标签只当文字");
  await search("");
  await actor.selectOptions(screen.getByRole("combobox", { name: "角色" }), "finance");
  await actor.selectOptions(screen.getByRole("combobox", { name: "状态" }), "disabled");
  const expected = all.filter((entry) => entry.role === "finance" && entry.status === "disabled");
  assert.ok(expected.length > 0 && expected.length < 50);
  await waitFor(() => assert.deepEqual(emails().sort(), expected.map((entry) => entry.email).sort()));
  assert.match(pageText(), new RegExp(`共 ${expected.length} `));
  assert.equal(listCalls().length, 2, "翻页、搜索、筛选都在浏览器里做，不再请求");
  assert.deepEqual(writes(calls), []);

  for (const broken of ["role=root", "status=ACTIVE", "page=999", "page=-1", "page=1.5", "size=7", "size=100000", `role=${encodeURIComponent("<script>")}&status=deleted&page=abc`]) {
    resetBrowser();
    open(`/platform/settings/staff?${broken}`, "super_admin", {}, serve);
    await waitFor(() => assert.match(pageText(), /共 230 /), { timeout: 3000 });
    assert.equal(emails().length, 50, broken);
    assert.deepEqual([(screen.getByRole("combobox", { name: "角色" }) as HTMLSelectElement).value, (screen.getByRole("combobox", { name: "状态" }) as HTMLSelectElement).value], ["all", "all"], broken);
    assertAbsent(screen.queryByText("页面出了点问题"));
  }
  resetBrowser();
  open(`/platform/settings/staff?q=${"长".repeat(300)}`, "super_admin", {}, serve);
  await screen.findByText("没有符合条件的员工");
  assert.equal((screen.getByRole("searchbox", { name: "按姓名或邮箱搜索" }) as HTMLInputElement).value.length, 100);
});

test("停用、启用员工的各种失败：404 说找不到并只留「知道了」；403 说没有权限；500、断网说得清并可以再点；401 回登录页；被拒以后页面上不出现英文错误码", async () => {
  const actor = user();
  let answer: () => Response | Promise<Response> = () => apiError(404, "NOT_FOUND", "no");
  const calls = open("/platform/settings/staff", "super_admin", { staff: [meOf("super_admin"), staffOf(), staffOf({ id: uuidOf(4), email: "old@example.com", name: "高桥", status: "disabled" })] }, (call) => (call.method === "POST" ? answer() : null));
  const openMenu = async (email: string, item: string): Promise<HTMLElement> => {
    await actor.click(within((await screen.findByText(email)).closest("tr") as HTMLElement).getByRole("button", { name: /的更多操作$/ }));
    await actor.click(screen.getByRole("menuitem", { name: item }));
    return screen.getByRole("dialog");
  };
  let dialog = await openMenu("sato@example.com", "停用");
  await actor.click(within(dialog).getByRole("button", { name: "停用" }));
  await within(dialog).findByText("找不到这个账号，它可能已被删除。");
  assertAbsent(within(dialog).queryByRole("button", { name: "停用" }));
  await actor.click(within(dialog).getByRole("button", { name: "知道了" }));

  for (const [reply, text] of [
    [() => apiError(403, "FORBIDDEN", "no"), "你没有权限做这个操作。需要的话，请联系管理员开通。"],
    [() => apiError(500, "INTERNAL_ERROR", "boom"), "系统暂时无法启用，请稍后再试。"],
    [() => Promise.reject(new TypeError("Failed to fetch")), "网络连接失败，请检查网络后重试。"],
    [() => apiError(429, "RATE_LIMITED", "slow", {}, { "retry-after": "30" }), "尝试次数过多，请 1 分钟后再试。"],
  ] as const) {
    answer = reply;
    dialog = await openMenu("old@example.com", "启用");
    await actor.click(within(dialog).getByRole("button", { name: "启用" }));
    await within(dialog).findByText(text);
    assert.ok(within(dialog).getByRole("button", { name: "启用" }), "可以再点");
    await actor.click(within(dialog).getByRole("button", { name: "取消" }));
  }
  assert.doesNotMatch(pageText(), /NOT_FOUND|FORBIDDEN|INTERNAL_ERROR|RATE_LIMITED|Failed to fetch/);
  assert.ok(writes(calls).every((call) => call.body === undefined), "停用、启用不带请求体");
  assert.match((screen.getByText("old@example.com").closest("tr") as HTMLElement).textContent ?? "", /已停用/, "失败以后那一行不变");

  answer = () => apiError(401, "UNAUTHENTICATED", "过期");
  dialog = await openMenu("sato@example.com", "停用");
  await actor.click(within(dialog).getByRole("button", { name: "停用" }));
  await screen.findByRole("button", { name: "登录" });
});

test("自己那一行：没有停用、启用、发重置、重新邀请（不管自己的状态在列表里显示成什么）；只有自己一个人时有一句提示", async () => {
  const actor = user();
  for (const status of ["active", "invited", "disabled"] as const) {
    resetBrowser();
    const calls = open("/platform/settings/staff", "super_admin", { staff: [{ ...meOf("super_admin"), status }] });
    const row = (await screen.findByText("kato@example.com")).closest("tr") as HTMLElement;
    assert.match(row.textContent ?? "", /你/);
    await actor.click(within(row).getByRole("button", { name: /的更多操作$/ }));
    assert.ok(screen.getByText("这是你自己的账号。"));
    assert.deepEqual(screen.getAllByRole("menuitem").map((entry) => entry.textContent), ["看他的操作记录", "看这个账号的变更记录"]);
    assert.ok(screen.getByText("现在只有你一个人。点右上角的「新增员工」给同事开账号。"));
    assert.equal(writes(calls).length, 0);
  }
});

test("新增员工页的状态被改坏（重新邀请带来的内容不合规、夹带了别的东西）：按普通的新增处理，不崩，也不把夹带的内容显示出来", async () => {
  for (const state of [{ reinvite: { email: "a@example.com", name: "甲", role: "root" } }, { reinvite: { email: 1, name: null, role: "readonly" } }, { reinvite: "x" }, { reinvite: null, token: TOKEN }, "text", 42]) {
    resetBrowser();
    open({ pathname: "/platform/settings/staff/new", state }, "super_admin");
    await screen.findByRole("heading", { level: 1, name: "新增员工" });
    assert.equal((screen.getByLabelText(/^邮箱/) as HTMLInputElement).readOnly, false);
    assert.deepEqual(placesOf(TOKEN), []);
  }
  resetBrowser();
  open({ pathname: "/platform/settings/staff/new", state: { reinvite: { email: "new@example.com", name: `<img src=x onerror="window.__xss=1">`, role: "tech", token: TOKEN } } }, "super_admin");
  await screen.findByRole("heading", { level: 1, name: `重新邀请 <img src=x onerror="window.__xss=1">` });
  assert.equal(document.querySelector("main img, h1 img"), null);
  assert.deepEqual(placesOf(TOKEN), [], "状态里夹带的别的内容不进页面");
  assert.equal((screen.getByRole("radio", { name: /^技术/ }) as HTMLInputElement).checked, true);
});

// ───────────── 一次性链接对话框本身 ─────────────

test("一次性链接对话框：四种链接的地址都对（两个后台 × 邀请 / 重置），令牌在 # 后面、不在查询串里；复制的说明写对了后台和用途；有效期没给或不是时间时只写时长", async () => {
  const cases = [
    { portal: "tenant", kind: "invite", path: "/accept-invite", label: "邀请链接", words: "供应商后台的账号开通链接", span: "7 天" },
    { portal: "tenant", kind: "reset", path: "/reset-password", label: "密码重置链接", words: "供应商后台的密码重置链接", span: "24 小时" },
    { portal: "platform", kind: "invite", path: "/platform/accept-invite", label: "邀请链接", words: "运营后台的账号开通链接", span: "7 天" },
    { portal: "platform", kind: "reset", path: "/platform/reset-password", label: "密码重置链接", words: "运营后台的密码重置链接", span: "24 小时" },
  ] as const;
  const actor = user();
  const clipboard = navigator.clipboard;
  try {
    for (const entry of cases) {
      for (const expiresAt of ["2026-10-16T05:30:00.000Z", null, "不是时间"]) {
        resetBrowser();
        const copied: string[] = [];
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (text: string) => (copied.push(text), Promise.resolve()) } });
        let closed = 0;
        render(<OneTimeLinkDialog issued={{ portal: entry.portal, kind: entry.kind, token: TOKEN, expiresAt, name: "山田太郎", email: "yamada@example.com", whom: "某某 的管理员" }} onClose={() => (closed += 1)} />);
        const dialog = screen.getByRole("dialog", { name: `${entry.label}（只显示这一次）` });
        const box = within(dialog).getByRole("textbox", { name: entry.label }) as HTMLTextAreaElement;
        const url = new URL(box.value);
        assert.deepEqual([url.origin, url.pathname, url.search, url.hash], ["http://localhost", entry.path, "", `#token=${TOKEN}`]);
        assert.match(dialog.textContent ?? "", expiresAt === "2026-10-16T05:30:00.000Z" ? new RegExp(`有效期到 \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}（${entry.span}），只能用一次。`) : new RegExp(`有效期：${entry.kind === "invite" ? "邀请" : "重置"} ${entry.span}，只能用一次。`));
        assert.doesNotMatch(dialog.textContent ?? "", /Invalid Date|NaN|undefined|null/);
        assert.equal(/再发一次会让这条链接作废。/.test(dialog.textContent ?? ""), entry.kind === "reset");
        await actor.click(within(dialog).getByRole("button", { name: "复制链接和说明" }));
        await within(dialog).findByText("链接和说明已复制");
        const lines = (copied[0] ?? "").split("\n");
        assert.equal(lines.length, 4);
        assert.equal(lines[0], "山田太郎，你好：");
        assert.ok((lines[1] ?? "").includes(entry.words) && !/Invalid Date|NaN|undefined|null/.test(lines[1] ?? ""), lines[1]);
        assert.equal(lines[2], box.value);
        assert.equal(lines[3], "链接只能用一次，请不要转发给别人。登录邮箱：yamada@example.com");
        // 播报区、标题、说明里都没有令牌；只在文本框里
        assert.deepEqual(placesOf(TOKEN), ["TEXTAREA"]);
        assert.ok(!(document.title ?? "").includes(TOKEN));
        await actor.click(within(dialog).getByRole("button", { name: "我已经发给对方，关闭" }));
        assert.equal(closed, 1, "复制过就直接关闭");
      }
    }
  } finally {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard });
  }
});

test("一次性链接对话框的关闭规则：浏览器没有剪贴板接口时选中链接并说明；复制失败不算复制过，关闭仍要确认；在文本框里手动复制过就直接关；「仍然关闭」才真的关；开着时刷新 / 关标签页会被浏览器拦一次，关掉以后不再拦", async () => {
  const actor = user();
  const clipboard = navigator.clipboard;
  try {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    let closed = 0;
    const view = render(<OneTimeLinkDialog issued={{ portal: "platform", kind: "invite", token: TOKEN, expiresAt: invite.expires_at, name: "佐藤 健", email: "sato@example.com", whom: "平台员工，运营" }} onClose={() => (closed += 1)} />);
    const dialog = screen.getByRole("dialog");
    const box = within(dialog).getByRole("textbox", { name: "邀请链接" }) as HTMLTextAreaElement;
    assert.equal(dialog.getAttribute("aria-describedby") !== null && document.getElementById(dialog.getAttribute("aria-describedby") ?? "")?.textContent?.includes("系统不会发邮件。"), true);
    assert.match(dialog.textContent ?? "", /给 佐藤 健（sato@example\.com）· 平台员工，运营/);
    const unload = (): boolean => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    assert.equal(unload(), true, "开着时离开页面会被拦");

    await actor.click(within(dialog).getByRole("button", { name: "复制链接" }));
    await within(dialog).findByText("没有复制成功。链接已经选中，请按 Ctrl + C（Mac 上是 ⌘ + C）复制。");
    assertFocused(box);
    assert.deepEqual([box.selectionStart, box.selectionEnd], [0, box.value.length]);
    assertAbsent(within(dialog).queryByText("链接已复制"));
    await actor.click(within(dialog).getByRole("button", { name: "我已经发给对方，关闭" }));
    await within(dialog).findByText("还没有复制过这条链接。关闭以后无法再看到，只能重新发起。");
    assert.equal(closed, 0);
    // 确认时 Esc、点遮罩仍然不关
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    fireEvent.click(dialog);
    assert.equal(closed, 0);
    await actor.click(within(dialog).getByRole("button", { name: "回去复制" }));
    assertAbsent(within(dialog).queryByText(/还没有复制过这条链接/));
    fireEvent.copy(box);
    await actor.click(within(dialog).getByRole("button", { name: "我已经发给对方，关闭" }));
    assert.equal(closed, 1, "手动复制过就直接关闭");

    view.unmount();
    assert.equal(unload(), false, "关掉以后不再拦");
    assert.deepEqual(placesOf(TOKEN), [], "卸载以后页面上没有令牌");

    closed = 0;
    render(<OneTimeLinkDialog issued={{ portal: "platform", kind: "reset", token: TOKEN, expiresAt: invite.expires_at, name: "佐藤 健", email: "sato@example.com", whom: "平台员工，运营" }} onClose={() => (closed += 1)} />);
    const again = screen.getByRole("dialog");
    await actor.click(within(again).getByRole("button", { name: "我已经发给对方，关闭" }));
    await actor.click(await within(again).findByRole("button", { name: "仍然关闭" }));
    assert.equal(closed, 1);
  } finally {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard });
  }
});

test("页面出错时的兜底页不显示错误的原文（哪怕错误信息里带着令牌）", () => {
  const Broken = (): never => {
    throw new Error(`boom ${TOKEN} {"invite":{"token":"${TOKEN}"}}`);
  };
  const original = console.error;
  console.error = () => undefined;
  try {
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );
  } finally {
    console.error = original;
  }
  assert.ok(screen.getByRole("heading", { level: 1, name: "页面出了点问题" }));
  assert.deepEqual(placesOf(TOKEN), []);
  assert.doesNotMatch(pageText(), /boom|invite|token/);
});

test("发过令牌以后的所有请求里都没有它：新建供应商 → 关闭对话框 → 详情页 → 审计日志，请求的地址、请求头、请求体里搜不到令牌；Toast 和播报区里也没有", async () => {
  const actor = user();
  const created = tenantOf({ id: uuidOf(9), name: "新车队" });
  const calls = open("/platform/tenants/new", "super_admin", { tenants: [tenantOf(), created] }, (call) => (call.method === "POST" && call.path === "/platform/v1/tenants" ? json(201, { tenant: created, admin_user: { id: "u9", email: "yamada@example.com", name: "山田太郎", role: "admin", status: "invited", ...stamps }, invite }) : null));
  await fillNewTenant(actor);
  await actor.click(screen.getByRole("button", { name: "新建" }));
  const dialog = await screen.findByRole("dialog", { name: "邀请链接（只显示这一次）" });
  // 对话框开着时：播报区（Toast 的容器、role=status、role=alert）里没有令牌
  for (const region of document.querySelectorAll('[aria-live], [role="status"], [role="alert"], .toast-region')) assert.ok(!(region.textContent ?? "").includes(TOKEN), "播报区里不能有令牌");
  fireEvent.copy(within(dialog).getByRole("textbox", { name: "邀请链接" }));
  await actor.click(within(dialog).getByRole("button", { name: "我已经发给对方，关闭" }));
  await screen.findByRole("heading", { level: 1, name: "新车队" });
  await actor.click(screen.getByRole("link", { name: /看这家供应商的操作记录/ }));
  await screen.findByRole("heading", { level: 1, name: "审计日志" });
  await settle();
  assert.deepEqual(placesOf(TOKEN), []);
  assert.ok(!document.title.includes(TOKEN));
  for (const call of calls) assert.ok(!JSON.stringify([call.path, call.headers, call.body ?? null]).includes(TOKEN), `请求里带着令牌：${call.method} ${call.path}`);
  assert.doesNotMatch([localStorage, sessionStorage].map((storage) => Object.keys(storage).map((key) => `${key}=${storage.getItem(key)}`).join()).join(), new RegExp(TOKEN));
});

// ───────────── 供应商详情：暂停原因 ─────────────

test("已暂停的供应商：原因没取到时说没加载出来并能重试；记录里没有原因写「没有填原因」；一条暂停记录都没有也说得清；原因里的 HTML 只当文字", async () => {
  const actor = user();
  let mode: "fail" | "empty-reason" | "none" | "html" = "fail";
  const html = `<img src=x onerror="window.__xss=1"><b>资质</b>`;
  open(`/platform/tenants/${TENANT_ID}`, "super_admin", { tenants: [tenantOf({ status: "suspended", name: `<i>车队</i>` })] }, (call) => {
    if (call.method !== "GET" || call.url.pathname !== "/platform/v1/audit-logs") return null;
    if (mode === "fail") return apiError(500, "INTERNAL_ERROR", "boom");
    if (mode === "none") return json(200, { items: [], next_cursor: null });
    return json(200, { items: [logOf({ after: mode === "html" ? { status: "suspended", reason: html } : { status: "suspended", reason: "   " }, actor: { type: "platform_user", id: ME_ID, email: mode === "html" ? null : "kato@example.com" } })], next_cursor: null });
  });
  await screen.findByText("原因没有加载出来。");
  assert.ok(screen.getByText("这家供应商已暂停。"), "提示条照常");
  const strip = screen.getByText("这家供应商已暂停。").closest('[role="status"]') as HTMLElement;
  mode = "empty-reason";
  await actor.click(within(strip).getByRole("button", { name: "重试" }));
  await within(strip).findByText(/原因：没有填原因（kato@example\.com，\d{4}-\d{2}-\d{2} \d{2}:\d{2}）/);
  await actor.click(screen.getByRole("button", { name: "恢复" }));
  assert.doesNotMatch(screen.getByRole("dialog").textContent ?? "", /当初暂停的原因/);
  await actor.click(within(screen.getByRole("dialog")).getByRole("button", { name: "取消" }));

  resetBrowser();
  mode = "none";
  open(`/platform/tenants/${TENANT_ID}`, "super_admin", { tenants: [tenantOf({ status: "suspended" })] }, (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/audit-logs" ? json(200, { items: [], next_cursor: null }) : null));
  await screen.findByText("原因：没有找到暂停的记录。");

  resetBrowser();
  mode = "html";
  open(`/platform/tenants/${TENANT_ID}`, "super_admin", { tenants: [tenantOf({ status: "suspended", name: `<i>车队</i>` })] }, (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/audit-logs" ? json(200, { items: [logOf({ after: { status: "suspended", reason: html }, actor: { type: "platform_user", id: ME_ID, email: null } })], next_cursor: null }) : null));
  await screen.findByText(new RegExp(`原因：${html.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}（—，`));
  assert.equal(document.querySelector("main img, main i, main b, h1 i"), null, "HTML 只当文字");
  await actor.click(screen.getByRole("button", { name: "恢复" }));
  const resume = screen.getByRole("dialog", { name: "恢复「<i>车队</i>」？" });
  assert.match(resume.textContent ?? "", /当初暂停的原因：<img src=x/);
  assert.equal(resume.querySelector("img, i, b"), null);
  assert.equal((window as unknown as { __xss?: number }).__xss, undefined);
});

// ───────────── 审计日志 ─────────────

test("审计日志的值什么样都不崩、都只当文字：嵌套对象、数组、null、0、false、空串、很长的字符串、带 HTML 的字符串、上千个坐标点；长的先折起来，展开后是全文；「复制这条记录」复制的是接口返回的原样", async () => {
  const actor = user();
  const html = `<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>`;
  const long = "很长的说明".repeat(200);
  const coordinates = Array.from({ length: 1500 }, (_, index) => [139 + index / 1000, 35 + index / 1000]);
  const log = logOf({
    id: "42",
    action: "update",
    resource: "area",
    resource_id: "area-1",
    before: { name: { zh: html }, note: null, count: 1, enabled: true, tags: ["a"], polygons: [], rules: { nested: { deep: [1, 2, { x: null }] } }, long: "短", empty: "", same: { a: 1 } },
    after: { name: { zh: html }, note: html, count: 0, enabled: false, tags: [], polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [coordinates] } }], rules: { nested: { deep: [] } }, long, empty: null, same: { a: 1 }, added: "新加的" },
  });
  open("/platform/settings/audit-logs", "super_admin", { logs: [log] });
  const clipboard = navigator.clipboard;
  const copied: string[] = [];
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (text: string) => (copied.push(text), Promise.resolve()) } });
  try {
    await actor.click(await screen.findByRole("button", { name: "第 42 条记录的详情" }));
    const detail = screen.getByRole("dialog");
    assert.equal(detail.querySelector("h2")?.textContent, `修改 · 区域 ${html}`);
    const diff = within(detail).getByRole("table");
    const rowOf = (field: string): HTMLElement => within(diff).getAllByRole("row").find((row) => row.querySelector("th code")?.textContent === field) as HTMLElement;
    assert.deepEqual(within(diff).getAllByRole("rowheader").map((cell) => cell.querySelector("code")?.textContent).sort(), ["added", "count", "empty", "enabled", "long", "note", "polygons", "rules", "tags"], "只列变了的");
    assert.match(rowOf("note").textContent ?? "", /（空）.*<img src=x onerror="window\.__xss=1"><script>/);
    assert.match(rowOf("count").textContent ?? "", /改前.?1|1.*0/);
    assert.match(rowOf("enabled").textContent ?? "", /是.*否/);
    assert.match(rowOf("added").textContent ?? "", /（空）.*新加的/);
    assert.match(rowOf("tags").textContent ?? "", /\[\s*"a"\s*\].*\[\]/s);
    assert.match(rowOf("rules").textContent ?? "", /"nested"/);
    // 很长的字符串、上千个坐标点：先折起来
    const longRow = rowOf("long");
    assert.ok((longRow.textContent ?? "").length < 600, "很长的字符串先折起来");
    const polygons = rowOf("polygons");
    assert.ok((polygons.textContent ?? "").length < 800, `上千个坐标点先折起来，实际 ${(polygons.textContent ?? "").length} 个字`);
    const expand = within(polygons).getByRole("button", { name: /^展开（共 [\d,]+ 行）$/ });
    assert.equal(expand.getAttribute("aria-expanded"), "false");
    await actor.click(expand);
    assert.ok((polygons.textContent ?? "").includes("140.499"), "展开后是全文");
    await actor.click(within(polygons).getByRole("button", { name: "收起" }));
    assert.ok(!(polygons.textContent ?? "").includes("140.499"));
    await actor.click(within(longRow).getByRole("button", { name: /^展开/ }));
    assert.ok((longRow.textContent ?? "").includes(long));
    assert.equal(detail.querySelector("img, script"), null, "HTML 只当文字");
    assert.equal(document.querySelector(".card-table img, .card-table script"), null);
    assert.ok(within(detail).getByText("另有 2 项没有变"));
    assert.match(rowOf("empty").textContent ?? "", /（空）.*（空）/);
    await actor.click(within(detail).getByRole("button", { name: "复制这条记录" }));
    await waitFor(() => assert.equal(copied.length, 1));
    assert.deepEqual(JSON.parse(copied[0] ?? "null"), log);
    assert.equal((window as unknown as { __xss?: number }).__xss, undefined);
  } finally {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard });
  }
});

test("审计日志里出现后端后来才加的东西：不认识的对象类型、操作、来源、操作人类型都原样显示，页面不崩；名称是奇怪的形状也不崩；时间不是时间写「—」", async () => {
  const actor = user();
  const logs = [
    logOf({ id: "1", resource: "price_plan", action: "bulk_adjust", source: "webhook" as AuditLog["source"], actor: { type: "service_account" as AuditLog["actor"]["type"], id: uuidOf(1), email: "bot@example.com" }, before: null, after: { rounding_unit: 100, items: [{ id: 1 }] } }),
    logOf({ id: "2", resource: "inventory_snapshot", action: "import", occurred_at: "不是时间", actor: { type: "system", id: null, email: null }, source: "cli", ip: null, tenant_id: null, resource_id: null, before: null, after: null }),
    logOf({ id: "3", resource: "city", action: "update", before: { name: { zh: 123, en: null } as unknown as string }, after: { name: { zh: ["x"], ja: { a: 1 } } as unknown as string } }),
    logOf({ id: "4", resource: "product", action: "publish", before: { name: [] as unknown as string, title: {} as unknown as string }, after: { name: 42 as unknown as string, code: "   " } }),
    logOf({ id: "5", resource: "tenant", action: "update", before: [] as unknown as Record<string, unknown>, after: "text" as unknown as Record<string, unknown> }),
  ];
  open("/platform/settings/audit-logs?resource=price_plan&action=bulk_adjust", "super_admin", { logs });
  await screen.findByRole("button", { name: "第 5 条记录的详情" });
  const rows = [...document.querySelectorAll(".card-table tbody tr")].map((row) => row.textContent ?? "");
  assert.equal(rows.length, 5);
  assert.match(rows[0] ?? "", /bot@example\.com.*service_account.*bulk_adjust.*price_plan.*webhook/);
  assert.match(rows[1] ?? "", /^—.*—系统（命令行或定时任务）import.*inventory_snapshot.*命令行/);
  assertAbsent(screen.queryByText("页面出了点问题"));
  // 两个下拉里带着网址里那个不认识的值，原样显示
  assert.equal((document.getElementById("audit-resource") as HTMLSelectElement).value, "price_plan");
  assert.equal((document.getElementById("audit-action") as HTMLSelectElement).value, "bulk_adjust");
  assertAbsent(screen.queryByText("网址里有一个筛选条件不对，已经忽略。"));
  for (const id of ["1", "2", "3", "4", "5"]) {
    await actor.click(screen.getByRole("button", { name: `第 ${id} 条记录的详情` }));
    const detail = screen.getByRole("dialog");
    assert.ok((detail.textContent ?? "").includes("密码、密码的哈希、邀请和重置链接里的令牌不会被记录"), `第 ${id} 条的详情打得开`);
    assert.doesNotMatch(detail.textContent ?? "", /\[object Object\]|undefined|NaN|Invalid Date/, `第 ${id} 条`);
    await actor.click(within(detail.querySelector(".dialog__footer") as HTMLElement).getByRole("button", { name: "关闭" }));
  }
});

test("审计日志的时间：表头写明是本地时区和 UTC 偏移，每一行的 title 给 UTC，详情里两种都有", async () => {
  const actor = user();
  open("/platform/settings/audit-logs", "super_admin", { logs: [logOf({ occurred_at: "2026-12-31T23:59:59.000Z" })] });
  const header = await screen.findByRole("columnheader", { name: /^时间（你的本地时区，UTC[+-]\d{1,2}(:\d{2})?）$/ });
  const minutes = -new Date().getTimezoneOffset();
  assert.ok((header.textContent ?? "").includes(`UTC${minutes < 0 ? "-" : "+"}${Math.trunc(Math.abs(minutes) / 60)}`));
  const time = await waitFor(() => {
    const found = document.querySelector(".card-table time");
    assert.ok(found);
    return found;
  });
  const local = new Date("2026-12-31T23:59:59.000Z");
  const pad = (value: number): string => String(value).padStart(2, "0");
  assert.equal(time.textContent, `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())} ${pad(local.getHours())}:${pad(local.getMinutes())}:${pad(local.getSeconds())}`);
  assert.deepEqual([time.getAttribute("datetime"), time.getAttribute("title")], ["2026-12-31T23:59:59.000Z", "2026-12-31 23:59:59 UTC"]);
  await actor.click(screen.getByRole("button", { name: "第 7 条记录的详情" }));
  assert.match(screen.getByRole("dialog").textContent ?? "", /2026-12-31 23:59:59 UTC/);
});

test("审计日志网址里的条件被改坏：每一种都只忽略坏的那一个、留下好的，并提示；没带对象类型的对象编号不发给接口；每页条数不认识按 50", async () => {
  const good = `tenant=${TENANT_ID}`;
  const cases: [string, Record<string, string | null>][] = [
    ["from=2026-13-01", { from: null }],
    ["from=2026-02-30", { from: null }],
    ["from=20261001", { from: null }],
    ["from=2026-10-01T00:00:00Z", { from: null }],
    ["to=abc", { to: null }],
    ["tenant=not-a-uuid", { tenant_id: null }],
    [`${good}&actor=1%27%20OR%201=1`, { actor_id: null }],
    [`${good}&resource=Tenant`, { resource: null }],
    [`${good}&resource=${encodeURIComponent("<script>")}`, { resource: null }],
    [`${good}&action=${encodeURIComponent("drop table")}`, { action: null }],
    [`${good}&resource=tenant&rid=${"x".repeat(101)}`, { resource: "tenant", resource_id: null }],
  ];
  for (const [search, expected] of cases) {
    resetBrowser();
    const calls = open(`/platform/settings/audit-logs?${search}`, "super_admin", { logs: [] });
    await screen.findByText("网址里有一个筛选条件不对，已经忽略。");
    await waitFor(() => assert.ok(auditRequests(calls).length >= 1));
    const sent = auditRequests(calls).at(-1) as URL;
    for (const [key, value] of Object.entries(expected)) assert.equal(sent.searchParams.get(key), value, `${search} → ${key}`);
    if (search.startsWith(good)) assert.equal(sent.searchParams.get("tenant_id"), TENANT_ID, `${search}：好的条件留着`);
    assertAbsent(screen.queryByText("页面出了点问题"));
  }
  resetBrowser();
  const calls = open(`/platform/settings/audit-logs?rid=${TENANT_ID}&size=7&cursor=abc&limit=9999`, "super_admin", { logs: [] });
  await screen.findByText("还没有记录");
  const sent = auditRequests(calls).at(-1) as URL;
  assert.deepEqual([sent.searchParams.get("resource_id"), sent.searchParams.get("limit"), sent.searchParams.get("cursor")], [null, "50", null]);
});

test("审计日志网址里「到」是一个不存在的日期（2026-02-31）：应当和「从」一样被忽略并提示，而不是悄悄算成 3 月 4 日发给接口", async () => {
  const calls = open("/platform/settings/audit-logs?to=2026-02-31", "super_admin", { logs: [] });
  await screen.findByRole("heading", { level: 1, name: "审计日志" });
  await waitFor(() => assert.ok(auditRequests(calls).length >= 1));
  await settle();
  assert.equal((auditRequests(calls).at(-1) as URL).searchParams.get("to"), null, "不存在的日期不该发给接口");
  assert.ok(screen.getByText("网址里有一个筛选条件不对，已经忽略。"));
});

test("审计日志游标翻页：下一页带上一页给的游标，上一页回到之前那一页；改筛选条件、改每页条数回到第一页；加载中不能再翻；游标不进网址", async () => {
  const actor = user();
  const pageOf = (cursor: string | null): { items: AuditLog[]; next_cursor: string | null } => {
    const index = cursor === null ? 0 : Number(cursor.replace("c", ""));
    return { items: [logOf({ id: String(100 - index) })], next_cursor: index < 2 ? `c${index + 1}` : null };
  };
  let hold: ReturnType<typeof deferred> | null = null;
  const calls = open("/platform/settings/audit-logs", "super_admin", {}, (call) => {
    if (call.method !== "GET" || call.url.pathname !== "/platform/v1/audit-logs") return null;
    if (hold !== null) return hold.promise;
    return json(200, pageOf(call.url.searchParams.get("cursor")));
  });
  const cursors = (): (string | null)[] => auditRequests(calls).map((url) => url.searchParams.get("cursor"));
  await screen.findByRole("button", { name: "第 100 条记录的详情" });
  assert.equal((screen.getByRole("button", { name: "上一页" }) as HTMLButtonElement).disabled, true);
  await actor.click(screen.getByRole("button", { name: "下一页" }));
  await screen.findByRole("button", { name: "第 99 条记录的详情" });
  await actor.click(screen.getByRole("button", { name: "下一页" }));
  await screen.findByRole("button", { name: "第 98 条记录的详情" });
  assert.equal((screen.getByRole("button", { name: "下一页" }) as HTMLButtonElement).disabled, true, "最后一页没有下一页");
  await actor.click(screen.getByRole("button", { name: "上一页" }));
  await screen.findByRole("button", { name: "第 99 条记录的详情" });
  assert.deepEqual(cursors(), [null, "c1", "c2", "c1"]);
  assert.match(pageText(), /本页 1 条/);

  // 加载中不能再翻
  hold = deferred();
  await actor.click(screen.getByRole("button", { name: "下一页" }));
  await waitFor(() => assert.equal(cursors().length, 5));
  assert.equal((screen.getByRole("button", { name: "下一页" }) as HTMLButtonElement).disabled, true);
  assert.equal((screen.getByRole("button", { name: "上一页" }) as HTMLButtonElement).disabled, true);
  const waiting = hold;
  hold = null;
  waiting.resolve(json(200, pageOf("c2")));
  await screen.findByRole("button", { name: "第 98 条记录的详情" });

  // 改条件回到第一页
  await actor.selectOptions(document.getElementById("audit-action") as HTMLSelectElement, "suspend");
  await waitFor(() => assert.deepEqual([cursors().at(-1), auditRequests(calls).at(-1)?.searchParams.get("action")], [null, "suspend"]));
  await screen.findByRole("button", { name: "第 100 条记录的详情" });
  await actor.click(screen.getByRole("button", { name: "下一页" }));
  await screen.findByRole("button", { name: "第 99 条记录的详情" });
  await actor.selectOptions(screen.getByRole("combobox", { name: /每页/ }), "20");
  await waitFor(() => assert.deepEqual([cursors().at(-1), auditRequests(calls).at(-1)?.searchParams.get("limit")], [null, "20"]));
  assert.ok(auditRequests(calls).every((url) => !url.searchParams.has("page")));
});

test("审计日志的日期筛选：「到」那一天整天都算（发给接口的是第二天零点、带时区的时刻）；跨月、跨年、闰日都对；三个快捷按钮填的是本地的今天往前数；输入不成日期的不发请求", async () => {
  const actor = user();
  const calls = open("/platform/settings/audit-logs?from=2024-02-29&to=2026-12-31", "super_admin", { logs: [] });
  await screen.findByText("没有符合条件的记录");
  const last = (): URL => auditRequests(calls).at(-1) as URL;
  assert.equal(new Date(last().searchParams.get("from") ?? "").getTime(), new Date(2024, 1, 29).getTime());
  assert.equal(new Date(last().searchParams.get("to") ?? "").getTime(), new Date(2027, 0, 1).getTime(), "到 12-31 = 次年 1 月 1 日零点之前");
  assert.match(last().searchParams.get("to") ?? "", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/, "带时区");
  assertAbsent(screen.queryByText("网址里有一个筛选条件不对，已经忽略。"));

  const today = new Date();
  const day = (offset: number): number => new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset).getTime();
  for (const [name, back] of [["今天", 0], ["最近 7 天", 6], ["最近 30 天", 29]] as const) {
    await actor.click(screen.getByRole("button", { name }));
    await waitFor(() => assert.equal(new Date(last().searchParams.get("from") ?? "").getTime(), day(-back), name));
    assert.equal(new Date(last().searchParams.get("to") ?? "").getTime(), day(1), `${name}：到今天整天`);
  }
  const before = auditRequests(calls).length;
  const from = document.getElementById("audit-from") as HTMLInputElement;
  await actor.clear(from);
  await actor.type(from, "不是日期{Enter}");
  await settle();
  assert.equal(auditRequests(calls).length, before, "不成日期的不发请求");
  await actor.click(screen.getAllByRole("button", { name: "清空筛选" })[0] as HTMLElement);
  await waitFor(() => assert.deepEqual([last().searchParams.get("from"), last().searchParams.get("to")], [null, null]));
});

test("审计日志的各种状态：403 说没有权限；500 说加载失败能重试；401 回登录页；供应商名单没取到不影响日志本身", async () => {
  const actor = user();
  let answer: () => Response = () => apiError(500, "INTERNAL_ERROR", "boom");
  open("/platform/settings/audit-logs", "super_admin", {}, (call) => {
    if (call.method === "GET" && call.url.pathname === "/platform/v1/tenants") return apiError(500, "INTERNAL_ERROR", "boom");
    return call.method === "GET" && call.url.pathname === "/platform/v1/audit-logs" ? answer() : null;
  });
  const table = (): HTMLElement => document.querySelector(".card-table") as HTMLElement;
  await waitFor(() => assert.ok(within(table()).getByText("加载失败")));
  answer = () => json(200, { items: [logOf()], next_cursor: null });
  await actor.click(within(table()).getByRole("button", { name: "重试" }));
  await actor.click(await screen.findByRole("button", { name: "第 7 条记录的详情" }));
  assert.match(screen.getByRole("dialog").textContent ?? "", new RegExp(`所属供应商${TENANT_ID}`), "供应商名单没取到时显示编号");
  await actor.keyboard("{Escape}");

  resetBrowser();
  open("/platform/settings/audit-logs", "super_admin", {}, (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/audit-logs" ? apiError(403, "FORBIDDEN", "no") : null));
  await screen.findByText("你没有权限查看这里");
  resetBrowser();
  open("/platform/settings/audit-logs", "super_admin", {}, (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/audit-logs" ? apiError(401, "UNAUTHENTICATED", "x") : null));
  await screen.findByRole("button", { name: "登录" });
});

// ───────────── 系统状态 ─────────────

test("系统状态：停留一段时间、窗口获得焦点、标签页切回来、网络恢复都不重新请求；连点「重新检查」只请求一次；离开再回来才请求；提示条里只有项目名，没有说明里的内容", async () => {
  const actor = user();
  const items = [
    { key: "database", label: "数据库", state: "configured", detail: "postgres://nozomi_app:•••@db:5432/nozomi" },
    { key: "stripe", label: "Stripe 支付", state: "missing", detail: "sk_live…9f3a" },
    { key: "googleMaps", label: "谷歌地图", state: "missing", detail: "" },
  ];
  const calls = open("/platform/settings/integrations", "tech", {}, (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/integrations" ? json(200, { items }) : null));
  const count = (): number => calls.filter((call) => call.path === "/platform/v1/integrations").length;
  await screen.findByText("postgres://nozomi_app:•••@db:5432/nozomi");
  for (const event of ["focus", "online", "pageshow"]) window.dispatchEvent(new Event(event));
  document.dispatchEvent(new Event("visibilitychange"));
  await settle(1200);
  assert.equal(count(), 1, "不自动刷新、不轮询");
  const alert = screen.getByText("有 2 项还没有配置").closest(".alert") as HTMLElement;
  assert.match(alert.textContent ?? "", /：Stripe 支付、谷歌地图。用到它们的功能现在不能用。/);
  assert.ok(!(alert.textContent ?? "").includes("sk_live"), "提示条里不带说明的内容");
  assert.match(screen.getByText("谷歌地图").closest("tr")?.textContent ?? "", /未配置—$/);

  await actor.click(screen.getByRole("button", { name: "重新检查" }));
  await waitFor(() => assert.equal(count(), 2));
  await settle(300);
  assert.equal(count(), 2, "点一次只请求一次");
});

test("系统状态点「重新检查」：应答回来之前按钮应是「检查中…」、不能再点，也不能提前播报；应答回来以后播报的是新结果的数量", async () => {
  const actor = user();
  const gate: { hold: ReturnType<typeof deferred> | null } = { hold: null };
  const items = [
    { key: "database", label: "数据库", state: "configured", detail: "postgres://nozomi_app:•••@db:5432/nozomi" },
    { key: "stripe", label: "Stripe 支付", state: "missing", detail: "未配置，无法收款" },
  ];
  const calls = open("/platform/settings/integrations", "tech", {}, (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/integrations" ? (gate.hold !== null ? gate.hold.promise.then((response) => response.clone()) : json(200, { items })) : null));
  const count = (): number => calls.filter((call) => call.path === "/platform/v1/integrations").length;
  await screen.findByText("postgres://nozomi_app:•••@db:5432/nozomi");
  gate.hold = deferred();
  await actor.click(screen.getByRole("button", { name: "重新检查" }));
  await waitFor(() => assert.equal(count(), 2));
  await settle(150);
  const problems: string[] = [];
  if (/已重新检查/.test(pageText())) problems.push(`应答还没回来就播报了「${/已重新检查，\d+ 项未配置/.exec(pageText())?.[0] ?? ""}」`);
  if (screen.queryByRole("button", { name: "检查中…" }) === null) problems.push("等待时按钮没有变成「检查中…」");
  let waiting = gate.hold as ReturnType<typeof deferred>;
  gate.hold = null;
  waiting.resolve(json(200, { items: items.map((item) => ({ ...item, state: "configured" })) }));
  await waitFor(() => assertAbsent(screen.queryByText(/还没有配置/)));
  await settle(150);
  if (!/已重新检查，0 项未配置/.test(pageText())) problems.push(`新结果是 0 项未配置，播报的却是「${/已重新检查，\d+ 项未配置/.exec(pageText())?.[0] ?? "（没有播报）"}」`);
  // 等待时再点：不该再发请求
  gate.hold = deferred();
  await actor.click(screen.getByRole("button", { name: "重新检查" }));
  await waitFor(() => assert.equal(count(), 3));
  for (const button of screen.queryAllByRole("button", { name: /重新检查|检查中…/ })) await actor.click(button);
  await settle(100);
  if (count() !== 3) problems.push(`等待时再点又发了请求（多发了 ${count() - 3} 次，每次都会写一条审计日志）`);
  waiting = gate.hold as ReturnType<typeof deferred>;
  gate.hold = null;
  waiting.resolve(json(200, { items }));
  await settle(100);
  assert.deepEqual(problems, []);
});

test("系统状态点「重新检查」失败（500 或断网）：不能什么都不说、继续显示上一次的结果", async () => {
  const actor = user();
  let fail = false;
  open("/platform/settings/integrations", "tech", {}, (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/integrations" && fail ? apiError(500, "INTERNAL_ERROR", "boom") : null));
  await screen.findByText("postgres://nozomi_app:•••@db:5432/nozomi");
  fail = true;
  await actor.click(screen.getByRole("button", { name: "重新检查" }));
  await waitFor(() => assert.ok(screen.queryByRole("button", { name: "检查中…" }) === null));
  await settle(150);
  const said = /加载失败|没有检查成功|检查失败|没有成功|请检查网络/.test(pageText());
  assert.ok(said, "重新检查失败了，页面上没有任何提示（表格还是上一次的结果，读屏也没有播报）");
});

test("系统状态的其他状态：首次加载失败说加载失败能重试；403 说没有权限；401 回登录页；项目名和说明里的 HTML 只当文字", async () => {
  const actor = user();
  let answer: () => Response = () => apiError(500, "INTERNAL_ERROR", "boom");
  open("/platform/settings/integrations", "super_admin", {}, (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/integrations" ? answer() : null));
  await screen.findByText("加载失败");
  answer = () => json(200, { items: [{ key: "x", label: "<b>新项目</b>", state: "configured", detail: `<img src=x onerror="window.__xss=1">` }] });
  await actor.click(screen.getByRole("button", { name: "重试" }));
  await screen.findByText("<b>新项目</b>");
  assert.equal(document.querySelector(".card-table b, .card-table img"), null);
  resetBrowser();
  open("/platform/settings/integrations", "super_admin", {}, (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/integrations" ? apiError(403, "FORBIDDEN", "no") : null));
  await screen.findByText("你没有权限查看这里");
  resetBrowser();
  open("/platform/settings/integrations", "super_admin", {}, (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/integrations" ? apiError(401, "UNAUTHENTICATED", "x") : null));
  await screen.findByRole("button", { name: "登录" });
});
