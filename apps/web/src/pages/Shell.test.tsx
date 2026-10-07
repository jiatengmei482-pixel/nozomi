/** 后台框架、首页、修改密码页、登录状态的组件测试（接口用测试替身）。 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Outlet, Route } from "react-router";
import { PortalSession } from "../auth/PortalSession.tsx";
import { sessionStore } from "../auth/session-store.ts";
import { apiError, assertAbsent, assertFocused, currentLocation, deferred, json, renderAt, resetBrowser, signIn, stubApi } from "../testing/harness.tsx";
import { ChangePasswordPage } from "./ChangePasswordPage.tsx";
import { HomePage } from "./HomePage.tsx";
import { NotFoundPage } from "./NotFoundPage.tsx";

afterEach(resetBrowser);

function portal(key: "tenant" | "platform", base: string) {
  return (
    <Route
      element={
        <PortalSession portal={key}>
          <Outlet />
        </PortalSession>
      }
    >
      <Route path={base === "" ? "/" : base} element={<HomePage />} />
      <Route path={`${base}/account/password`} element={<ChangePasswordPage />} />
      <Route path={`${base}/nowhere`} element={<NotFoundPage />} />
    </Route>
  );
}

const ROUTES = (
  <>
    {portal("platform", "/platform")}
    {portal("tenant", "")}
  </>
);

const stamps = { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" };
const tenantMe = (status: "active" | "suspended") => () =>
  json(200, {
    user: { id: "u1", email: "dispatcher@supplier.example", name: "测试调度", role: "dispatch", status: "active", ...stamps },
    tenant: { id: "t1", name: "测试用供应商", status, ...stamps },
    permissions: [],
  });
const platformMe = () =>
  json(200, {
    user: { id: "p1", email: "admin@platform.example", name: "测试管理员", role: "super_admin", status: "active", ...stamps },
    permissions: ["tenant.read"],
  });

function detail(label: string): HTMLElement {
  const term = screen.getByText(label, { selector: "dt" });
  const value = term.parentElement?.querySelector("dd");
  assert.ok(value, `没有「${label}」这一项`);
  return value as HTMLElement;
}

test("没登录打开后台页面：去登录页，并记下原来想去的地址", () => {
  const calls = stubApi({});
  renderAt("/account/password", ROUTES);
  assert.deepEqual(currentLocation(), { path: "/login", state: { from: "/account/password" } });
  resetBrowser();
  renderAt("/platform", ROUTES);
  assert.deepEqual(currentLocation(), { path: "/platform/login", state: { from: "/platform" } });
  assert.equal(calls.length, 0);
});

test("本地令牌已过期：清掉它，带着「登录已过期」去登录页", async () => {
  sessionStore.set("tenant", { accessToken: "old", expiresAt: "2020-01-01T00:00:00.000Z" });
  stubApi({});
  renderAt("/", ROUTES);
  assert.deepEqual(currentLocation(), { path: "/login", state: { from: "/", reason: "expired" } });
  await waitFor(() => assert.equal(sessionStore.get("tenant"), null));
});

test("供应商后台首页：姓名、邮箱、角色中文名、供应商名称和状态都来自 auth/me", async () => {
  signIn("tenant", "tenant-token");
  const calls = stubApi({ "GET /tenant/v1/auth/me": tenantMe("active") });
  renderAt("/", ROUTES);
  await screen.findByText("dispatcher@supplier.example", { selector: "dd" });
  assert.equal(calls[0]?.headers["authorization"], "Bearer tenant-token");
  assert.equal(screen.getByRole("heading", { level: 1 }).textContent, "首页");
  assert.equal(document.title, "首页 · NOZOMI 供应商后台");
  assert.equal(detail("姓名").textContent, "测试调度");
  assert.equal(detail("角色").textContent, "调度");
  assert.equal(detail("供应商名称").textContent, "测试用供应商");
  assert.equal(detail("供应商状态").textContent, "正常");
  assert.ok(detail("供应商状态").querySelector(".badge--success"));
});

test("供应商被暂停：状态徽标写出「已暂停」（颜色 + 文字），页面照常可用", async () => {
  signIn("tenant");
  stubApi({ "GET /tenant/v1/auth/me": tenantMe("suspended") });
  renderAt("/", ROUTES);
  await screen.findByText("已暂停");
  assert.ok(detail("供应商状态").querySelector(".badge--warning"));
  assert.equal(detail("供应商状态").textContent, "已暂停");
});

test("运营后台首页：没有供应商那两项；侧边栏写明是运营后台", async () => {
  signIn("platform");
  stubApi({ "GET /platform/v1/auth/me": platformMe });
  renderAt("/platform", ROUTES);
  await screen.findByText("admin@platform.example", { selector: "dd" });
  assert.equal(detail("角色").textContent, "超级管理员");
  assertAbsent(screen.queryByText("供应商名称"));
  assertAbsent(screen.queryByText("供应商状态"));
  assert.equal(document.title, "首页 · NOZOMI 运营后台");
  assert.ok(document.querySelector(".sidebar--pinned")?.textContent?.includes("运营后台"));
});

test("后台框架：一个 main、一个 h1、跳到正文是第一个可聚焦元素；菜单只有真实存在的首页", async () => {
  signIn("tenant");
  stubApi({ "GET /tenant/v1/auth/me": tenantMe("active") });
  renderAt("/", ROUTES);
  await screen.findByText("测试用供应商");
  assert.equal(document.querySelectorAll("main").length, 1);
  assert.equal(document.querySelectorAll("h1").length, 1);
  assert.equal(document.querySelector("a, button, input")?.textContent, "跳到正文");
  assert.equal(document.querySelector(".skip-link")?.getAttribute("href"), "#main");
  assert.equal(document.querySelector("main")?.id, "main");

  const nav = document.querySelector('.sidebar--pinned nav[aria-label="主菜单"]') as HTMLElement;
  const links = within(nav).getAllByRole("link");
  assert.deepEqual(links.map((link) => link.textContent), ["首页"]);
  assert.equal(links[0]?.getAttribute("aria-current"), "page");
  assert.equal(document.querySelector('nav[aria-label="当前位置"] [aria-current="page"]')?.textContent, "首页");
  assert.ok(screen.getByRole("button", { name: "打开菜单" }));
  assert.ok(screen.getByRole("button", { name: "切换主题" }));
});

test("账号菜单：显示姓名和角色，有「修改密码」和「退出登录」；方向键移动，Esc 关闭并把焦点还给按钮", async () => {
  signIn("tenant");
  stubApi({ "GET /tenant/v1/auth/me": tenantMe("active") });
  const user = userEvent.setup();
  renderAt("/", ROUTES);
  const button = await screen.findByRole("button", { name: /账号菜单：\s*测试调度/ });
  assert.equal(button.getAttribute("aria-expanded"), "false");
  assert.equal(button.getAttribute("aria-haspopup"), "menu");
  await user.click(button);
  assert.equal(button.getAttribute("aria-expanded"), "true");
  const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
  assert.deepEqual(items.map((item) => item.textContent), ["修改密码", "退出登录"]);
  assert.equal(items[0]?.getAttribute("href"), "/account/password");
  assertFocused(items[0] ?? null);
  await user.keyboard("{ArrowDown}");
  assertFocused(items[1] ?? null);
  await user.keyboard("{ArrowDown}");
  assertFocused(items[0] ?? null);
  await user.keyboard("{Escape}");
  assertAbsent(screen.queryByRole("menu"));
  assertFocused(button);
});

test("退出登录：通知后端、清掉本地令牌、回登录页并提示；另一个后台的登录不受影响", async () => {
  signIn("tenant", "tenant-token");
  signIn("platform", "platform-token");
  const calls = stubApi({ "GET /tenant/v1/auth/me": tenantMe("active"), "POST /tenant/v1/auth/logout": () => new Response(null, { status: 204 }) });
  const user = userEvent.setup();
  renderAt("/", ROUTES);
  await user.click(await screen.findByRole("button", { name: /账号菜单/ }));
  await user.click(screen.getByRole("menuitem", { name: "退出登录" }));
  await waitFor(() => assert.deepEqual(currentLocation(), { path: "/login", state: { reason: "logged-out" } }));
  const logoutCall = calls.find((call) => call.path === "/tenant/v1/auth/logout");
  assert.equal(logoutCall?.headers["authorization"], "Bearer tenant-token");
  assert.equal(sessionStore.get("tenant"), null);
  assert.equal(sessionStore.get("platform")?.accessToken, "platform-token");
});

test("退出时网络不通：照样清掉本地令牌并回登录页", async () => {
  signIn("platform");
  stubApi({
    "GET /platform/v1/auth/me": platformMe,
    "POST /platform/v1/auth/logout": () => {
      throw new TypeError("fetch failed");
    },
  });
  const user = userEvent.setup();
  renderAt("/platform", ROUTES);
  await user.click(await screen.findByRole("button", { name: /账号菜单/ }));
  await user.click(screen.getByRole("menuitem", { name: "退出登录" }));
  await waitFor(() => assert.equal(currentLocation()?.path, "/platform/login"));
  assert.equal(sessionStore.get("platform"), null);
});

test("加载中：内容区是骨架屏并有只给读屏的「加载中」，框架照常显示", async () => {
  signIn("tenant");
  const pending = deferred();
  stubApi({ "GET /tenant/v1/auth/me": () => pending.promise });
  renderAt("/", ROUTES);
  const status = screen.getByText("加载中");
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.closest("[aria-busy]")?.getAttribute("aria-busy"), "true");
  assert.equal(document.querySelector(".skeleton__blocks")?.getAttribute("aria-hidden"), "true");
  assert.ok(screen.getByRole("heading", { level: 1, name: "首页" }));
  assertAbsent(screen.queryByText("姓名"));
  pending.resolve(await tenantMe("active")());
  await screen.findByText("测试用供应商");
  assertAbsent(screen.queryByText("加载中"));
});

test("取账号信息时后端说 401：清掉令牌，带着「登录已过期」和当前地址回登录页", async () => {
  signIn("tenant");
  stubApi({ "GET /tenant/v1/auth/me": () => apiError(401, "UNAUTHENTICATED", "请先登录") });
  renderAt("/account/password", ROUTES);
  await waitFor(() => assert.deepEqual(currentLocation(), { path: "/login", state: { reason: "expired", from: "/account/password" } }));
  assert.equal(sessionStore.get("tenant"), null);
});

test("取账号信息失败（网络或服务器）：内容区显示「加载失败」和「重试」，不退出登录；重试成功后显示内容", async () => {
  signIn("tenant");
  let attempts = 0;
  stubApi({
    "GET /tenant/v1/auth/me": () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError("fetch failed");
      if (attempts === 2) return apiError(500, "INTERNAL_ERROR", "服务器内部错误");
      return tenantMe("active")();
    },
  });
  const user = userEvent.setup();
  renderAt("/", ROUTES);
  assert.ok(await screen.findByRole("heading", { level: 2, name: "加载失败" }));
  assert.ok(screen.getByText("请检查网络后重试。"));
  assert.ok(sessionStore.get("tenant"), "不是 401 就不退出登录");
  assert.ok(screen.getByRole("button", { name: /账号菜单/ }), "顶栏照常可用");
  await user.click(screen.getByRole("button", { name: "重试" }));
  assert.ok(await screen.findByRole("heading", { level: 2, name: "加载失败" }));
  await user.click(screen.getByRole("button", { name: "重试" }));
  await screen.findByText("测试用供应商");
});

test("后台里不存在的页面：保留框架，提示找不到并给回首页的入口", async () => {
  signIn("platform");
  stubApi({ "GET /platform/v1/auth/me": platformMe });
  renderAt("/platform/nowhere", ROUTES);
  assert.equal(screen.getByRole("heading", { level: 1 }).textContent, "找不到这个页面");
  assert.equal(screen.getByRole("link", { name: "回到首页" }).getAttribute("href"), "/platform");
  assert.ok(document.querySelector('nav[aria-label="主菜单"]'));
  assert.ok(await screen.findByRole("button", { name: /账号菜单：\s*测试管理员/ }), "顶栏的账号照常加载");
});

test("修改密码页取不到账号信息：给出「加载失败」和「重试」，表单和已填内容保留；重试成功后提示消失", async () => {
  signIn("tenant");
  let attempts = 0;
  stubApi({
    "GET /tenant/v1/auth/me": () => {
      attempts += 1;
      return attempts === 1 ? apiError(500, "INTERNAL_ERROR", "服务器内部错误") : tenantMe("active")();
    },
  });
  const user = userEvent.setup();
  renderAt("/account/password", ROUTES);
  assert.ok(await screen.findByRole("heading", { level: 2, name: "加载失败" }));
  assert.ok(screen.getByText("请检查网络后重试。"));
  await user.type(screen.getByLabelText("当前密码"), "typed-before-retry");
  await user.click(screen.getByRole("button", { name: "重试" }));
  await screen.findByRole("button", { name: /账号菜单：\s*测试调度/ });
  assertAbsent(screen.queryByRole("heading", { level: 2, name: "加载失败" }));
  assert.equal((screen.getByLabelText("当前密码") as HTMLInputElement).value, "typed-before-retry");
});

const NEW_PASSWORD = "Kyoto-Station-2026";

async function fillChangePassword(current: string, next: string, confirmation: string): Promise<void> {
  const user = userEvent.setup();
  if (current) await user.type(screen.getByLabelText("当前密码"), current);
  if (next) await user.type(screen.getByLabelText("新密码"), next);
  if (confirmation) await user.type(screen.getByLabelText("再输入一次新密码"), confirmation);
  await user.click(screen.getByRole("button", { name: "保存新密码" }));
}

test("修改密码：空着提交逐项提示；新密码不能包含自己的邮箱名（邮箱来自 auth/me）", async () => {
  signIn("tenant");
  const calls = stubApi({ "GET /tenant/v1/auth/me": tenantMe("active") });
  renderAt("/account/password", ROUTES);
  await screen.findByRole("button", { name: /账号菜单：\s*测试调度/ });
  await fillChangePassword("", "", "");
  assert.ok(screen.getByText("请输入当前密码"));
  assert.ok(screen.getByText("请输入新密码"));
  assert.ok(screen.getByText("请再输入一次新密码"));
  assertFocused(screen.getByLabelText("当前密码"));
  await fillChangePassword("old-password", "Dispatcher-2026-x", "Dispatcher-2026-x");
  assert.ok(screen.getByText("密码不能包含邮箱名"));
  assert.equal(calls.filter((call) => call.method === "POST").length, 0);
  assert.equal((document.querySelector('input[autocomplete="username"]') as HTMLInputElement).value, "dispatcher@supplier.example");
});

test("修改密码成功：提交当前密码和新密码，清空表单，告诉用户其他设备已退出", async () => {
  signIn("platform", "platform-token");
  const calls = stubApi({ "GET /platform/v1/auth/me": platformMe, "POST /platform/v1/auth/change-password": () => new Response(null, { status: 204 }) });
  renderAt("/platform/account/password", ROUTES);
  assert.equal(screen.getByRole("heading", { level: 1 }).textContent, "修改密码");
  await fillChangePassword("old-password", NEW_PASSWORD, NEW_PASSWORD);
  const notice = await screen.findByText("密码已修改。这个账号在其他设备上的登录已全部退出。");
  assert.ok(notice.closest('[role="status"]'));
  const call = calls.find((entry) => entry.method === "POST");
  assert.deepEqual(call?.body, { current_password: "old-password", new_password: NEW_PASSWORD });
  assert.equal(call?.headers["authorization"], "Bearer platform-token");
  for (const label of ["当前密码", "新密码", "再输入一次新密码"]) {
    assert.equal((screen.getByLabelText(label) as HTMLInputElement).value, "");
    assert.equal(screen.getByLabelText(label).getAttribute("aria-invalid"), null);
  }
  assert.ok(sessionStore.get("platform"), "当前这次登录保留");
});

test("修改密码被拒：当前密码不对、新旧相同、强度不够各自显示在对应字段下，保留已填内容", async () => {
  const cases: [Response, string, string][] = [
    [apiError(400, "CURRENT_PASSWORD_INCORRECT", "当前密码不正确"), "当前密码", "当前密码不正确，请重新输入"],
    [apiError(400, "PASSWORD_UNCHANGED", "新密码不能和当前密码相同"), "新密码", "新密码不能和当前密码相同"],
    [apiError(400, "WEAK_PASSWORD", "密码强度不够", { issues: [{ code: "X", message: "密码里至少要有 6 个不同的字符" }] }), "新密码", "密码里至少要有 6 个不同的字符"],
  ];
  for (const [response, field, message] of cases) {
    signIn("tenant");
    stubApi({ "GET /tenant/v1/auth/me": tenantMe("active"), "POST /tenant/v1/auth/change-password": () => response });
    renderAt("/account/password", ROUTES);
    await screen.findByRole("button", { name: /账号菜单：\s*测试调度/ });
    await fillChangePassword("old-password", NEW_PASSWORD, NEW_PASSWORD);
    await screen.findByText(message);
    const input = screen.getByLabelText(field);
    assert.equal(input.getAttribute("aria-invalid"), "true");
    assertFocused(input);
    assert.equal((screen.getByLabelText("新密码") as HTMLInputElement).value, NEW_PASSWORD);
    resetBrowser();
  }
});

test("修改密码时被限流或会话失效：限流显示等多久；401 回登录页", async () => {
  signIn("tenant");
  stubApi({
    "GET /tenant/v1/auth/me": tenantMe("active"),
    "POST /tenant/v1/auth/change-password": () => apiError(429, "TOO_MANY_LOGIN_ATTEMPTS", "尝试次数过多", {}, { "retry-after": "300" }),
  });
  renderAt("/account/password", ROUTES);
  await screen.findByRole("button", { name: /账号菜单：\s*测试调度/ });
  await fillChangePassword("old-password", NEW_PASSWORD, NEW_PASSWORD);
  assert.ok((await screen.findByText("尝试次数过多，请 5 分钟后再试。")).closest('[role="alert"]'));
  resetBrowser();

  signIn("tenant");
  stubApi({
    "GET /tenant/v1/auth/me": tenantMe("active"),
    "POST /tenant/v1/auth/change-password": () => apiError(401, "UNAUTHENTICATED", "请先登录"),
  });
  renderAt("/account/password", ROUTES);
  await screen.findByRole("button", { name: /账号菜单：\s*测试调度/ });
  await fillChangePassword("old-password", NEW_PASSWORD, NEW_PASSWORD);
  await waitFor(() => assert.deepEqual(currentLocation(), { path: "/login", state: { reason: "expired", from: "/account/password" } }));
  assert.equal(sessionStore.get("tenant"), null);
});
