import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Route } from "react-router";
import { sessionStore } from "../auth/session-store.ts";
import { FAR_FUTURE, apiError, assertAbsent, assertFocused, currentLocation, deferred, json, renderAt, resetBrowser, signIn, stubApi } from "../testing/harness.tsx";
import { LoginPage } from "./LoginPage.tsx";

afterEach(resetBrowser);

const ROUTES = (
  <>
    <Route path="/login" element={<LoginPage key="tenant" portal="tenant" />} />
    <Route path="/platform/login" element={<LoginPage key="platform" portal="platform" />} />
  </>
);

const TENANT_LOGIN = "POST /tenant/v1/auth/login";
const loginOk = () => json(200, { access_token: "new-token", token_type: "Bearer", expires_at: FAR_FUTURE, user: {}, tenant: {} });

async function fillAndSubmit(email: string, password: string): Promise<void> {
  const user = userEvent.setup();
  if (email) await user.type(screen.getByLabelText("邮箱"), email);
  if (password) await user.type(screen.getByLabelText("密码"), password);
  await user.click(screen.getByRole("button", { name: "登录" }));
}

test("供应商后台登录页：副标题、标签、切换链接、页面标题，输入框属性符合规范，没有占位文字", () => {
  renderAt("/login", ROUTES);
  assert.equal(screen.getByRole("heading", { level: 1 }).textContent, "供应商后台");
  assert.equal(document.title, "登录 · NOZOMI 供应商后台");
  assert.equal(screen.getByText("NOZOMI").tagName, "P");
  const email = screen.getByLabelText("邮箱") as HTMLInputElement;
  assert.equal(email.type, "email");
  assert.equal(email.name, "email");
  assert.equal(email.autocomplete, "username");
  assert.equal(email.getAttribute("inputmode"), "email");
  assert.equal(email.getAttribute("autocapitalize"), "none");
  assert.equal(email.getAttribute("spellcheck"), "false");
  assert.equal(email.required, true);
  assert.equal(email.placeholder, "");
  const password = screen.getByLabelText("密码") as HTMLInputElement;
  assert.equal(password.type, "password");
  assert.equal(password.autocomplete, "current-password");
  assert.equal(password.placeholder, "");
  assert.equal(screen.getByRole("button", { name: "登录" }).getAttribute("type"), "submit");
  assert.equal(screen.getByRole("link", { name: "我是平台员工，去运营后台登录" }).getAttribute("href"), "/platform/login");
  assertAbsent(screen.queryByText(/忘记密码|注册|记住我/));
});

test("运营后台登录页：同一个组件，只有副标题和切换链接不同", () => {
  renderAt("/platform/login", ROUTES);
  assert.equal(screen.getByRole("heading", { level: 1 }).textContent, "运营后台");
  assert.equal(document.title, "登录 · NOZOMI 运营后台");
  assert.equal(screen.getByRole("link", { name: "我是供应商，去供应商后台登录" }).getAttribute("href"), "/login");
});

test("什么都不填就提交：两个字段各自报错并与输入框关联，焦点到第一个出错的字段，不发请求", async () => {
  const calls = stubApi({});
  renderAt("/login", ROUTES);
  await fillAndSubmit("", "");
  const email = screen.getByLabelText("邮箱");
  const password = screen.getByLabelText("密码");
  assert.equal(email.getAttribute("aria-invalid"), "true");
  assert.equal(document.getElementById(email.getAttribute("aria-describedby") ?? "")?.textContent, "请输入邮箱");
  assert.equal(document.getElementById(password.getAttribute("aria-describedby") ?? "")?.textContent, "请输入密码");
  assertFocused(email);
  assert.equal(calls.length, 0);
});

test("邮箱格式不对：提示怎么错了；改对之后提示实时消失", async () => {
  stubApi({});
  renderAt("/login", ROUTES);
  await fillAndSubmit("zhang", "x");
  assert.ok(screen.getByText("邮箱格式不正确"));
  await userEvent.setup().type(screen.getByLabelText("邮箱"), "@example.com");
  assertAbsent(screen.queryByText("邮箱格式不正确"));
  assert.equal(screen.getByLabelText("邮箱").getAttribute("aria-invalid"), null);
});

test("登录成功：邮箱去掉首尾空格后提交，令牌存进这个后台自己的位置，直接进首页，不提示「登录成功」", async () => {
  const calls = stubApi({ [TENANT_LOGIN]: loginOk });
  renderAt("/login", ROUTES);
  await fillAndSubmit("  a@example.com ", " Pass word ");
  await waitFor(() => assert.equal(currentLocation()?.path, "/"));
  assert.deepEqual(calls[0]?.body, { email: "a@example.com", password: " Pass word " });
  assert.deepEqual(sessionStore.get("tenant"), { accessToken: "new-token", expiresAt: FAR_FUTURE });
  assert.equal(sessionStore.get("platform"), null);
  assert.equal(localStorage.length, 0, "令牌不能进 localStorage");
});

test("登录成功后回到登录前想去的页面；站外或别的后台的地址一律忽略", async () => {
  stubApi({ [TENANT_LOGIN]: loginOk });
  renderAt({ pathname: "/login", state: { from: "/account/password" } }, ROUTES);
  await fillAndSubmit("a@example.com", "x");
  await waitFor(() => assert.equal(currentLocation()?.path, "/account/password"));
  resetBrowser();

  stubApi({ [TENANT_LOGIN]: loginOk });
  renderAt({ pathname: "/login", state: { from: "//evil.example/x" } }, ROUTES);
  await fillAndSubmit("a@example.com", "x");
  await waitFor(() => assert.equal(currentLocation()?.path, "/"));
});

test("登录失败不暴露原因：401、参数被拒的 400、别的 403 显示完全相同的提示和行为", async () => {
  const seen: string[] = [];
  for (const response of [
    () => apiError(401, "INVALID_CREDENTIALS", "邮箱或密码不正确"),
    () => apiError(403, "FORBIDDEN", "没有权限"),
    () => apiError(400, "VALIDATION_FAILED", "请求参数校验未通过"),
  ]) {
    stubApi({ [TENANT_LOGIN]: response });
    renderAt("/login", ROUTES);
    await fillAndSubmit("a@example.com", "wrong-password");
    const alert = await screen.findByText("邮箱或密码不正确。");
    assert.ok(alert.closest('[role="alert"]'));
    seen.push(document.querySelector(".auth-card")?.innerHTML.replace(/id="[^"]*"|for="[^"]*"|aria-describedby="[^"]*"/g, "") ?? "");
    assert.equal((screen.getByLabelText("邮箱") as HTMLInputElement).value, "a@example.com");
    assert.equal((screen.getByLabelText("密码") as HTMLInputElement).value, "");
    assertFocused(screen.getByLabelText("密码"));
    assert.equal(screen.getByLabelText("邮箱").getAttribute("aria-invalid"), null, "输入框本身不标红");
    assert.equal(screen.getByLabelText("密码").getAttribute("aria-invalid"), null);
    assertAbsent(screen.queryByText(/停用|未注册|不存在|请去/));
    resetBrowser();
  }
  assert.equal(seen[0], seen[1]);
  assert.equal(seen[0], seen[2]);
});

test("账号已停用（后端只在密码正确时才这样回）：显示后端给的专门说明，保留邮箱、清空密码；后端没带说明时用兜底的话", async () => {
  stubApi({ [TENANT_LOGIN]: () => apiError(403, "ACCOUNT_DISABLED", "账号已停用，请联系管理员") });
  renderAt("/login", ROUTES);
  await fillAndSubmit("a@example.com", "right-password");
  assert.ok((await screen.findByText("账号已停用，请联系管理员")).closest('[role="alert"]'));
  assertAbsent(screen.queryByText("邮箱或密码不正确。"));
  assert.equal((screen.getByLabelText("邮箱") as HTMLInputElement).value, "a@example.com");
  assert.equal((screen.getByLabelText("密码") as HTMLInputElement).value, "");
  assertFocused(screen.getByLabelText("密码"));
  assert.equal(sessionStore.get("tenant"), null);
  resetBrowser();

  stubApi({ [TENANT_LOGIN]: () => apiError(403, "ACCOUNT_DISABLED", "") });
  renderAt("/login", ROUTES);
  await fillAndSubmit("a@example.com", "right-password");
  assert.ok(await screen.findByText("账号已停用，请联系管理员。"));
});

test("任何一次提交都把密码切回隐藏：前端校验没过的那次也一样", async () => {
  const calls = stubApi({});
  const user = userEvent.setup();
  renderAt("/login", ROUTES);
  await user.type(screen.getByLabelText("密码"), "visible-password");
  await user.click(screen.getByRole("button", { name: "显示密码" }));
  assert.equal((screen.getByLabelText("密码") as HTMLInputElement).type, "text");
  await user.click(screen.getByRole("button", { name: "登录" }));
  assert.ok(screen.getByText("请输入邮箱"), "邮箱没填，前端校验没过");
  assert.equal(calls.length, 0);
  assert.equal((screen.getByLabelText("密码") as HTMLInputElement).type, "password");
  assert.equal(screen.getByRole("button", { name: "显示密码" }).getAttribute("aria-pressed"), "false");
  assert.equal((screen.getByLabelText("密码") as HTMLInputElement).value, "visible-password");
});

test("被限流：用响应头 Retry-After 说出还要等几分钟；后端没给时间时不编数字", async () => {
  stubApi({ [TENANT_LOGIN]: () => apiError(429, "TOO_MANY_LOGIN_ATTEMPTS", "尝试次数过多", { retry_after_seconds: 1 }, { "retry-after": "840" }) });
  renderAt("/login", ROUTES);
  await fillAndSubmit("a@example.com", "x");
  assert.ok(await screen.findByText("尝试次数过多，请 14 分钟后再试。"));
  assert.equal((screen.getByLabelText("密码") as HTMLInputElement).value, "");
  assert.equal((screen.getByLabelText("邮箱") as HTMLInputElement).value, "a@example.com");
  resetBrowser();

  stubApi({ [TENANT_LOGIN]: () => apiError(429, "TOO_MANY_LOGIN_ATTEMPTS", "尝试次数过多") });
  renderAt("/login", ROUTES);
  await fillAndSubmit("a@example.com", "x");
  assert.ok(await screen.findByText("尝试次数过多，请稍后再试。"));
});

test("网络不通：告诉用户检查网络，保留邮箱和密码，焦点留在登录按钮", async () => {
  stubApi({
    [TENANT_LOGIN]: () => {
      throw new TypeError("fetch failed");
    },
  });
  renderAt("/login", ROUTES);
  await fillAndSubmit("a@example.com", "my-password");
  assert.ok(await screen.findByText("网络连接失败，请检查网络后重试。"));
  assert.equal((screen.getByLabelText("密码") as HTMLInputElement).value, "my-password");
  assertFocused(screen.getByRole("button", { name: "登录" }));
});

test("服务器出错：不显示状态码和后端原文，保留已填内容", async () => {
  stubApi({ [TENANT_LOGIN]: () => apiError(500, "INTERNAL_ERROR", "服务器内部错误，请稍后重试") });
  renderAt("/login", ROUTES);
  await fillAndSubmit("a@example.com", "my-password");
  assert.ok(await screen.findByText("系统暂时无法登录，请稍后再试。"));
  assertAbsent(screen.queryByText(/500|INTERNAL/));
  assert.equal((screen.getByLabelText("密码") as HTMLInputElement).value, "my-password");
});

test("提交中：按钮进入加载态且不能重复提交，输入框只读，密码切回隐藏，上一次的提示清掉", async () => {
  const pending = deferred();
  let first = true;
  const calls = stubApi({
    [TENANT_LOGIN]: () => {
      if (first) {
        first = false;
        return apiError(401, "INVALID_CREDENTIALS", "邮箱或密码不正确");
      }
      return pending.promise;
    },
  });
  const user = userEvent.setup();
  renderAt("/login", ROUTES);
  await fillAndSubmit("a@example.com", "wrong");
  await screen.findByText("邮箱或密码不正确。");

  await user.type(screen.getByLabelText("密码"), "second-try");
  await user.click(screen.getByRole("button", { name: "显示密码" }));
  assert.equal((screen.getByLabelText("密码") as HTMLInputElement).type, "text");
  assertFocused(screen.getByLabelText("密码"));
  assert.equal(screen.getByRole("button", { name: "隐藏密码" }).getAttribute("aria-pressed"), "true");

  await user.click(screen.getByRole("button", { name: "登录" }));
  const busy = await screen.findByRole("button", { name: "正在登录…" });
  assert.equal(busy.getAttribute("aria-busy"), "true");
  assert.equal((busy as HTMLButtonElement).disabled, false, "加载态不用 disabled，焦点不丢");
  assert.equal((screen.getByLabelText("邮箱") as HTMLInputElement).readOnly, true);
  assert.equal((screen.getByLabelText("密码") as HTMLInputElement).readOnly, true);
  assert.equal((screen.getByLabelText("密码") as HTMLInputElement).type, "password");
  assertAbsent(screen.queryByText("邮箱或密码不正确。"));
  assert.equal(screen.getByRole("link", { name: /去运营后台登录/ }).getAttribute("aria-disabled"), "true");

  await user.click(busy);
  await user.keyboard("{Enter}");
  assert.equal(calls.length, 2, "提交中再点或按 Enter 不会再发请求");

  pending.resolve(loginOk());
  await waitFor(() => assert.equal(currentLocation()?.path, "/"));
});

test("带着原因来到登录页：过期、已退出、刚设置完密码各有提示；邮箱预填", () => {
  const cases: [unknown, string, string][] = [
    [{ reason: "expired" }, "登录已过期，请重新登录。", "status"],
    [{ reason: "logged-out" }, "已退出登录。", "status"],
    [{ reason: "password-set", email: "new@example.com" }, "密码已设置，请登录。", "status"],
    [{ reason: "password-reset", email: "new@example.com" }, "密码已重设，请用新密码登录。", "status"],
  ];
  for (const [state, text, role] of cases) {
    renderAt({ pathname: "/login", state }, ROUTES);
    assert.ok(screen.getByText(text).closest(`[role="${role}"]`));
    const expected = (state as { email?: string }).email ?? "";
    assert.equal((screen.getByLabelText("邮箱") as HTMLInputElement).value, expected);
    resetBrowser();
  }
  renderAt({ pathname: "/login", state: { reason: "made-up", email: 42 } }, ROUTES);
  assertAbsent(document.querySelector(".alert"));
});

test("提示条的两个播报区域一开始就在页面里（空的）", () => {
  renderAt("/login", ROUTES);
  assert.equal(document.querySelector('[role="alert"]')?.childElementCount, 0);
  assert.equal(document.querySelector('[role="status"]')?.childElementCount, 0);
});

test("已经登录的人打开登录页：确认期间显示骨架屏不闪出表单，确认有效后直接进首页", async () => {
  signIn("platform", "still-valid");
  const pending = deferred();
  const calls = stubApi({ "GET /platform/v1/auth/me": () => pending.promise });
  renderAt("/platform/login", ROUTES);
  assertAbsent(screen.queryByLabelText("邮箱"));
  assert.ok(screen.getByText("正在确认登录状态"));
  pending.resolve(json(200, { user: {}, permissions: [] }));
  await waitFor(() => assert.equal(currentLocation()?.path, "/platform"));
  assert.equal(calls[0]?.headers["authorization"], "Bearer still-valid");
});

test("本地的令牌已被后端作废：清掉它并显示登录表单；另一个后台的登录状态不受影响", async () => {
  signIn("tenant", "revoked");
  signIn("platform", "other-portal");
  stubApi({ "GET /tenant/v1/auth/me": () => apiError(401, "UNAUTHENTICATED", "请先登录") });
  renderAt("/login", ROUTES);
  assert.ok(await screen.findByLabelText("邮箱"));
  assert.equal(sessionStore.get("tenant"), null);
  assert.equal(sessionStore.get("platform")?.accessToken, "other-portal");
});

test("本地的令牌已过期：不问后端，直接清掉并显示表单", () => {
  sessionStore.set("tenant", { accessToken: "old", expiresAt: "2020-01-01T00:00:00.000Z" });
  const calls = stubApi({});
  renderAt("/login", ROUTES);
  assert.ok(screen.getByLabelText("邮箱"));
  assert.equal(calls.length, 0);
  assert.equal(sessionStore.get("tenant"), null);
});
