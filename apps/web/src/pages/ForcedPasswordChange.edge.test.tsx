/**
 * 强制修改密码（ADR 0013）前端一侧的边界：测试角色补的用例。接口用测试替身，路由表用真实的 <App>。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../App.tsx";
import { sessionStore } from "../auth/session-store.ts";
import { type ApiCall, FAR_FUTURE, apiError, assertAbsent, deferred, json, resetBrowser, signIn, stubApi } from "../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" };
const platformUser = { id: "p1", email: "owner@platform.example", name: "测试负责人", role: "super_admin", status: "active", ...stamps };
const tenantUser = { id: "u1", email: "admin@supplier.example", name: "测试租户管理员", role: "admin", status: "active", ...stamps };
const tenant = { id: "t1", name: "测试用供应商", status: "active", ...stamps };
const platformMe = (mustChange: unknown) => () => json(200, { user: platformUser, permissions: [], must_change_password: mustChange });
const tenantMe = (mustChange: unknown) => () => json(200, { user: tenantUser, tenant, permissions: [], must_change_password: mustChange });

const WARNING = "你正在使用临时密码，请先设置新密码。设置完成前不能使用其他功能。";
const TEMPORARY = "aB3de-Fg4hJ-k5LmN-6pQrS";
const NEW_PASSWORD = "Osaka-Castle-2026";

function renderApp(initial: string | { pathname: string; search?: string; state?: unknown }) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <App />
    </MemoryRouter>,
  );
}

async function expectForced(what: string, currentLabel = "临时密码"): Promise<void> {
  assert.ok(await screen.findByText(WARNING), what);
  assert.equal(screen.getByRole("heading", { level: 1 }).textContent, "修改密码", what);
  assert.ok(screen.getByLabelText(currentLabel), what);
  assertAbsent(document.querySelector('nav[aria-label="主菜单"]'));
  assertAbsent(screen.queryByRole("button", { name: "打开菜单" }));
}

async function fillAndSave(current: string, next: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("临时密码"), current);
  await user.type(screen.getByLabelText("新密码"), next);
  await user.type(screen.getByLabelText("再输入一次新密码"), next);
  await user.click(screen.getByRole("button", { name: "保存新密码" }));
}

async function logIn(email: string, password: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("邮箱"), email);
  await user.type(screen.getByLabelText("密码"), password);
  await user.click(screen.getByRole("button", { name: "登录" }));
}

function everythingStored(): string {
  const dump = (storage: Storage): string =>
    Array.from({ length: storage.length }, (_, index) => `${storage.key(index)}=${storage.getItem(storage.key(index) as string)}`).join("\n");
  return `${dump(sessionStorage)}\n${dump(localStorage)}\n${document.cookie}`;
}

test("真实路由表：必须先改密码时，本后台各种写法的地址（结尾斜杠、带查询串、大小写不同、更深的路径、不存在的页面）都落在修改密码页（两个后台）", async () => {
  const cases: ["platform" | "tenant", string][] = [
    ["platform", "/platform"],
    ["platform", "/platform/"],
    ["platform", "/platform?tab=staff"],
    ["platform", "/platform/account/password/"],
    ["platform", "/platform/account/password?next=/platform"],
    ["platform", "/platform/account/password/extra"],
    ["platform", "/platform/account"],
    ["platform", "/Platform/Account/Password"],
    ["platform", "/PLATFORM"],
    ["platform", "/platform/tenants/123"],
    ["platform", "/platform/login"],
    ["tenant", "/"],
    ["tenant", "/account/password/"],
    ["tenant", "/Account/Password"],
    ["tenant", "/users"],
    ["tenant", "/account"],
    ["tenant", "/login"],
  ];
  for (const [portal, start] of cases) {
    signIn(portal);
    stubApi({ "GET /platform/v1/auth/me": platformMe(true), "GET /tenant/v1/auth/me": tenantMe(true) });
    renderApp(start);
    await expectForced(start);
    assert.equal(document.querySelector(".topbar__brand")?.textContent, portal === "platform" ? "NOZOMI运营后台" : "NOZOMI供应商后台", start);
    assertAbsent(screen.queryByText("找不到这个页面"));
    assertAbsent(screen.queryByRole("heading", { level: 1, name: "首页" }));
    resetBrowser();
  }
});

test("另一个后台的地址：运营后台必须先改密码时去供应商后台的地址——那边没登录就是那边的登录页，不会把运营后台的改密页套过去，也不会放行", async () => {
  for (const start of ["/", "/account/password", "/users"]) {
    signIn("platform");
    const calls = stubApi({ "GET /platform/v1/auth/me": platformMe(true) });
    renderApp(start);
    assert.ok(await screen.findByRole("heading", { level: 1, name: "供应商后台" }), start);
    assert.ok(screen.getByLabelText("邮箱"));
    assertAbsent(screen.queryByText(WARNING));
    assert.equal(calls.filter((call) => call.path.startsWith("/tenant/")).length, 0, "没有拿运营后台的令牌去调供应商后台的接口");
    assert.ok(sessionStore.get("platform"), "运营后台的登录状态原样");
    resetBrowser();
  }
});

test("两个后台都登录着、各自的状态各自算：供应商后台必须改、运营后台不用——运营后台照常；两边都必须改——各自落在自己的改密页", async () => {
  signIn("platform");
  signIn("tenant");
  stubApi({ "GET /platform/v1/auth/me": platformMe(false), "GET /tenant/v1/auth/me": tenantMe(true) });
  renderApp("/platform");
  assert.ok(await screen.findByRole("heading", { level: 1, name: "首页" }));
  await screen.findByText("owner@platform.example");
  assertAbsent(screen.queryByText(WARNING));
  resetBrowser();

  for (const [start, brand, email] of [
    ["/platform", "NOZOMI运营后台", "owner@platform.example"],
    ["/", "NOZOMI供应商后台", "admin@supplier.example"],
  ] as const) {
    signIn("platform", "platform-token");
    signIn("tenant", "tenant-token");
    const calls = stubApi({ "GET /platform/v1/auth/me": platformMe(true), "GET /tenant/v1/auth/me": tenantMe(true) });
    renderApp(start);
    await expectForced(start);
    assert.equal(document.querySelector(".topbar__brand")?.textContent, brand);
    await waitFor(() => assert.equal((document.querySelector('input[name="email"]') as HTMLInputElement).value, email));
    assert.deepEqual([...new Set(calls.map((call) => call.headers["authorization"]))], [start === "/" ? "Bearer tenant-token" : "Bearer platform-token"]);
    resetBrowser();
  }
});

test("登录应答的 must_change_password 类型不对（字符串、数字、null、对象）：不当作登录成功——不存令牌、不进后台、提示系统暂时无法登录", async () => {
  for (const wrong of ["true", "false", 1, 0, null, {}, []]) {
    const calls = stubApi({
      "POST /platform/v1/auth/login": () => json(200, { access_token: "should-not-be-stored", token_type: "Bearer", expires_at: FAR_FUTURE, user: platformUser, must_change_password: wrong }),
      "GET /platform/v1/auth/me": platformMe(false),
    });
    renderApp("/platform/login");
    await logIn("owner@platform.example", TEMPORARY);
    assert.ok(await screen.findByText("系统暂时无法登录，请稍后再试。"), JSON.stringify(wrong));
    assert.equal(sessionStore.get("platform"), null);
    assert.ok(!everythingStored().includes("should-not-be-stored"));
    assert.equal(calls.filter((call) => call.path.endsWith("/auth/me")).length, 0);
    assert.ok(screen.getByLabelText("邮箱"), "还在登录页");
    resetBrowser();
  }
});

test("以 auth/me 为准：登录应答说不用改、auth/me 说必须改——仍然被带到修改密码页；伪造「刚改完」的页面状态也解除不了", async () => {
  stubApi({
    "POST /platform/v1/auth/login": () => json(200, { access_token: "session", token_type: "Bearer", expires_at: FAR_FUTURE, user: platformUser, must_change_password: false }),
    "GET /platform/v1/auth/me": platformMe(true),
  });
  renderApp("/platform/login");
  await logIn("owner@platform.example", TEMPORARY);
  await expectForced("登录应答与 auth/me 不一致");
  resetBrowser();

  for (const state of [{ passwordChanged: true }, { passwordChangeRequired: false }, { passwordChangeRequired: "false", passwordChanged: true }]) {
    signIn("platform");
    stubApi({ "GET /platform/v1/auth/me": platformMe(true) });
    renderApp({ pathname: "/platform", state });
    await expectForced(JSON.stringify(state));
    assertAbsent(screen.queryByText("新密码已生效，临时密码已作废。"));
    resetBrowser();
  }
});

test("auth/me 的 must_change_password 缺失或类型不对时页面不崩溃；之后任何接口返回 403 PASSWORD_CHANGE_REQUIRED（这里是改密接口自己）仍然把界面收紧到只剩改密", async () => {
  for (const wrong of [undefined, "true", 1, null]) {
    signIn("platform");
    stubApi({
      "GET /platform/v1/auth/me": platformMe(wrong),
      "POST /platform/v1/auth/change-password": () => apiError(403, "PASSWORD_CHANGE_REQUIRED", "请先修改密码，再继续使用"),
    });
    renderApp("/platform/account/password");
    const current = await screen.findByLabelText("当前密码");
    const user = userEvent.setup();
    await user.type(current, TEMPORARY);
    await user.type(screen.getByLabelText("新密码"), NEW_PASSWORD);
    await user.type(screen.getByLabelText("再输入一次新密码"), NEW_PASSWORD);
    await user.click(screen.getByRole("button", { name: "保存新密码" }));
    await expectForced(`auth/me 给了 ${JSON.stringify(wrong)}`);
    assert.ok(sessionStore.get("platform"), "不是 401，不退出登录");
    resetBrowser();
  }
});

test("刚用临时密码登录、auth/me 却失败了（断网、500）：限制不解除——仍然只有改密页、没有导航，可以重试", async () => {
  for (const failing of [() => Promise.reject(new TypeError("Failed to fetch")), () => apiError(500, "INTERNAL", "服务器内部错误")]) {
    signIn("platform");
    let attempts = 0;
    stubApi({
      "GET /platform/v1/auth/me": () => {
        attempts += 1;
        return attempts === 1 ? failing() : platformMe(true)();
      },
    });
    renderApp({ pathname: "/platform/account/password", state: { passwordChangeRequired: true } });
    assert.ok(await screen.findByText("加载失败"));
    await expectForced("auth/me 失败");
    await userEvent.setup().click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => assertAbsent(screen.queryByText("加载失败")));
    await expectForced("重试之后");
    resetBrowser();
  }
});

test("强制改密时会话已失效（别处改了密码 / 被重设）：auth/me 或改密接口返回 401——清掉令牌回登录页并提示登录已过期，不停在改密页", async () => {
  signIn("platform");
  stubApi({ "GET /platform/v1/auth/me": () => apiError(401, "UNAUTHENTICATED", "请先登录") });
  renderApp({ pathname: "/platform/account/password", state: { passwordChangeRequired: true } });
  assert.ok(await screen.findByText("登录已过期，请重新登录。"));
  assert.equal(sessionStore.get("platform"), null);
  resetBrowser();

  signIn("platform");
  stubApi({ "GET /platform/v1/auth/me": platformMe(true), "POST /platform/v1/auth/change-password": () => apiError(401, "UNAUTHENTICATED", "请先登录") });
  renderApp("/platform/account/password");
  await expectForced("提交之前");
  await fillAndSave(TEMPORARY, NEW_PASSWORD);
  assert.ok(await screen.findByText("登录已过期，请重新登录。"));
  assert.equal(sessionStore.get("platform"), null);
  assertAbsent(screen.queryByText(WARNING));
});

test("改密接口被限速、服务器出错、断网：给出能读懂的提示，仍然是受限状态（没有导航），不会被当成改好了", async () => {
  const cases: [() => Response | Promise<Response>, string][] = [
    [() => apiError(429, "TOO_MANY_ATTEMPTS", "尝试次数过多", { retry_after_seconds: 600 }, { "retry-after": "600" }), "尝试次数过多，请 10 分钟后再试。"],
    [() => apiError(500, "INTERNAL", "服务器内部错误"), "系统暂时无法修改密码，请稍后再试。"],
    [() => Promise.reject(new TypeError("Failed to fetch")), "网络连接失败，请检查网络后重试。"],
    [() => new Response("<html>502</html>", { status: 502 }), "系统暂时无法修改密码，请稍后再试。"],
  ];
  for (const [responder, message] of cases) {
    signIn("platform");
    stubApi({ "GET /platform/v1/auth/me": platformMe(true), "POST /platform/v1/auth/change-password": responder });
    renderApp("/platform/account/password");
    await expectForced("提交之前");
    await fillAndSave(TEMPORARY, NEW_PASSWORD);
    assert.ok(await screen.findByText(message), message);
    await expectForced(`失败之后（${message}）`);
    assertAbsent(screen.queryByText("新密码已生效，临时密码已作废。"));
    resetBrowser();
  }
});

test("重复提交：改密请求还没回来时再点保存、再按回车，只发出一个请求；回来之后进首页", async () => {
  signIn("platform");
  const pending = deferred();
  const calls = stubApi({ "GET /platform/v1/auth/me": platformMe(true), "POST /platform/v1/auth/change-password": () => pending.promise });
  renderApp("/platform/account/password");
  await expectForced("提交之前");
  await fillAndSave(TEMPORARY, NEW_PASSWORD);
  const user = userEvent.setup();
  const button = screen.getByRole("button", { name: /保存/ });
  await user.click(button);
  await user.click(button);
  await user.type(screen.getByLabelText("再输入一次新密码"), "{Enter}");
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  assert.ok(screen.getByText(WARNING), "还没成功之前限制都在");
  pending.resolve(new Response(null, { status: 204 }));
  assert.ok(await screen.findByRole("heading", { level: 1, name: "首页" }));
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
});

test("临时密码和新密码不落地：只出现在登录和改密两个请求的请求体里；不进网址、请求头、浏览器存储、Cookie、页面标题；改完之后页面上也没有了", async () => {
  const calls: ApiCall[] = stubApi({
    "POST /platform/v1/auth/login": () => json(200, { access_token: "temp-session", token_type: "Bearer", expires_at: FAR_FUTURE, user: platformUser, must_change_password: true }),
    "GET /platform/v1/auth/me": platformMe(true),
    "POST /platform/v1/auth/change-password": () => new Response(null, { status: 204 }),
  });
  renderApp({ pathname: "/platform/login", state: { from: "/platform" } });
  await logIn("owner@platform.example", TEMPORARY);
  await expectForced("登录后");
  assert.ok(!everythingStored().includes(TEMPORARY));
  assert.equal((screen.getByLabelText("临时密码") as HTMLInputElement).value, "", "临时密码不会被带进改密页自动填好");
  for (const label of ["临时密码", "新密码", "再输入一次新密码"]) {
    assert.equal((screen.getByLabelText(label) as HTMLInputElement).type, "password", `${label} 默认不明文显示`);
  }

  await fillAndSave(TEMPORARY, NEW_PASSWORD);
  assert.ok(await screen.findByRole("heading", { level: 1, name: "首页" }));
  for (const secret of [TEMPORARY, NEW_PASSWORD]) {
    assert.ok(!everythingStored().includes(secret), "存储里有密码");
    assert.ok(!document.body.innerHTML.includes(secret), "改完之后页面上还留着密码");
    assert.ok(!document.title.includes(secret));
    for (const call of calls) {
      assert.ok(!call.path.includes(secret) && !call.path.includes(encodeURIComponent(secret)), `密码进了网址：${call.path}`);
      assert.ok(!JSON.stringify(call.headers).includes(secret), "密码进了请求头");
    }
  }
  const withTemporary = calls.filter((call) => JSON.stringify(call.body ?? null).includes(TEMPORARY)).map((call) => `${call.method} ${call.path}`);
  assert.deepEqual(withTemporary, ["POST /platform/v1/auth/login", "POST /platform/v1/auth/change-password"]);
  assert.deepEqual(Object.keys(JSON.parse(sessionStorage.getItem("nozomi.session.platform") ?? "{}")).sort(), ["accessToken", "expiresAt"], "存储里只有令牌和过期时间，没有「是否必须改密码」");
});

test("必须先改密码时退出登录：后端没应答（断网）也照样清掉本地令牌回登录页；再打开后台地址要重新登录", async () => {
  signIn("tenant", "temp-session");
  stubApi({ "GET /tenant/v1/auth/me": tenantMe(true), "POST /tenant/v1/auth/logout": () => Promise.reject(new TypeError("Failed to fetch")) });
  renderApp("/");
  await expectForced("退出之前");
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /账号菜单/ }));
  await user.click(screen.getByRole("menuitem", { name: "退出登录" }));
  assert.ok(await screen.findByText("已退出登录。"));
  assert.equal(sessionStore.get("tenant"), null);
  assert.ok(!everythingStored().includes("temp-session"));
});
