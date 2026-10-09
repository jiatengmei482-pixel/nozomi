/**
 * 各页面在各种失败应答下的表现（接口用测试替身）：401 / 403 / 409 / 429 / 500 / 断网 / 非 JSON，
 * 表单内容是否保留、提示条在哪个播报区域、会不会被误判成「链接失效」或「登录过期」。
 * 另有：页面打开期间会话过期、后端返回的文字只当文字显示、表单输入的边界。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Outlet, Route } from "react-router";
import { PortalSession } from "../auth/PortalSession.tsx";
import { sessionStore } from "../auth/session-store.ts";
import { FAR_FUTURE, apiError, assertAbsent, assertFocused, currentLocation, deferred, json, renderAt, resetBrowser, signIn, stubApi } from "../testing/harness.tsx";
import { ChangePasswordPage } from "./ChangePasswordPage.tsx";
import { HomePage } from "./HomePage.tsx";
import { LoginPage } from "./LoginPage.tsx";
import { NotFoundPage } from "./NotFoundPage.tsx";
import { SetPasswordPage, tokenFromHash } from "./SetPasswordPage.tsx";

afterEach(resetBrowser);

function shell(key: "tenant" | "platform", base: string) {
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

const SHELL_ROUTES = (
  <>
    {shell("platform", "/platform")}
    {shell("tenant", "")}
  </>
);

const LOGIN_ROUTES = (
  <>
    <Route path="/login" element={<LoginPage key="tenant" portal="tenant" />} />
    <Route path="/platform/login" element={<LoginPage key="platform" portal="platform" />} />
  </>
);

const SET_PASSWORD_ROUTES = (
  <>
    <Route path="/accept-invite" element={<SetPasswordPage portal="tenant" kind="invite" />} />
    <Route path="/platform/reset-password" element={<SetPasswordPage portal="platform" kind="reset" />} />
  </>
);

const stamps = { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" };
const tenantMeBody = (overrides: { name?: string; email?: string; tenantName?: string } = {}) => ({
  user: { id: "u1", email: overrides.email ?? "dispatcher@supplier.example", name: overrides.name ?? "测试调度", role: "dispatch", status: "active", ...stamps },
  tenant: { id: "t1", name: overrides.tenantName ?? "测试用供应商", status: "active", ...stamps },
  permissions: [],
});
const tenantMe = () => json(200, tenantMeBody());

const GOOD_PASSWORD = "Tokyo-Haneda-2026";
const TENANT_LOGIN = "POST /tenant/v1/auth/login";
const loginOk = () => json(200, { access_token: "new-token", token_type: "Bearer", expires_at: FAR_FUTURE, user: {}, tenant: {}, must_change_password: false });
const html = (status: number) => () => new Response("<html><body><h1>Bad Gateway</h1></body></html>", { status, headers: { "content-type": "text/html" } });
const offline = () => {
  throw new TypeError("Failed to fetch");
};

const value = (label: string): string => (screen.getByLabelText(label) as HTMLInputElement).value;

async function fillLogin(email: string, password: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("邮箱"), email);
  await user.type(screen.getByLabelText("密码"), password);
  await user.click(screen.getByRole("button", { name: "登录" }));
}

/* ───────────── 登录页 ───────────── */

test("登录：凡是 4xx（404、409、413、422）都是同一句「邮箱或密码不正确」，不显示后端原文", async () => {
  for (const status of [404, 409, 413, 422]) {
    stubApi({ [TENANT_LOGIN]: () => apiError(status, "SOMETHING_SPECIFIC", "这句后端原文不应该出现") });
    renderAt("/login", LOGIN_ROUTES);
    await fillLogin("a@example.com", "wrong-password");
    assert.ok((await screen.findByText("邮箱或密码不正确。")).closest('[role="alert"]'), `HTTP ${status}`);
    assertAbsent(screen.queryByText(/后端原文|SOMETHING_SPECIFIC/));
    assert.equal(value("邮箱"), "a@example.com");
    assert.equal(value("密码"), "");
    resetBrowser();
  }
});

test("登录：502 / 503 / 504、代理返回的 HTML 错误页、200 却不是 JSON，都提示系统暂时无法登录并保留已填内容；可以直接再提交", async () => {
  const responders = [() => apiError(503, "UNAVAILABLE", "服务不可用"), html(502), html(504), () => new Response("<!doctype html><title>NOZOMI</title>", { status: 200, headers: { "content-type": "text/html" } })];
  for (const responder of responders) {
    let healthy = false;
    const calls = stubApi({ [TENANT_LOGIN]: () => (healthy ? loginOk() : responder()) });
    renderAt("/login", LOGIN_ROUTES);
    await fillLogin("a@example.com", "my-password");
    assert.ok((await screen.findByText("系统暂时无法登录，请稍后再试。")).closest('[role="alert"]'));
    assertAbsent(screen.queryByText(/Bad Gateway|50\d|UNAVAILABLE|服务不可用/));
    assert.equal(value("邮箱"), "a@example.com");
    assert.equal(value("密码"), "my-password");
    assert.equal((screen.getByLabelText("邮箱") as HTMLInputElement).readOnly, false, "出错后恢复可操作");
    assert.equal(sessionStore.get("tenant"), null);

    healthy = true;
    await userEvent.setup().click(screen.getByRole("button", { name: "登录" }));
    await waitFor(() => assert.equal(currentLocation()?.path, "/"));
    assert.equal(calls.length, 2);
    resetBrowser();
  }
});

test("登录：被限流时 Retry-After 是 HTTP 日期也能说出分钟数；是过去的时间或读不懂时不编数字", async () => {
  const inFiveMinutes = new Date(Date.now() + 5 * 60_000).toUTCString();
  const cases: [Record<string, string>, RegExp][] = [
    [{ "retry-after": inFiveMinutes }, /^尝试次数过多，请 [56] 分钟后再试。$/],
    [{ "retry-after": new Date(Date.now() - 60_000).toUTCString() }, /^尝试次数过多，请稍后再试。$/],
    [{ "retry-after": "soon" }, /^尝试次数过多，请稍后再试。$/],
    [{ "retry-after": "0" }, /^尝试次数过多，请稍后再试。$/],
    [{ "retry-after": "45" }, /^尝试次数过多，请 1 分钟后再试。$/],
  ];
  for (const [headers, expected] of cases) {
    stubApi({ [TENANT_LOGIN]: () => apiError(429, "TOO_MANY_LOGIN_ATTEMPTS", "尝试次数过多", {}, headers) });
    renderAt("/login", LOGIN_ROUTES);
    await fillLogin("a@example.com", "x");
    const alert = await screen.findByRole("alert");
    await waitFor(() => assert.match(alert.textContent ?? "", expected, JSON.stringify(headers)));
    assert.equal(value("邮箱"), "a@example.com");
    resetBrowser();
  }
});

test("登录：在密码框里按 Enter 就提交；点「显示密码」不提交表单，密码框的值不变", async () => {
  const calls = stubApi({ [TENANT_LOGIN]: loginOk });
  const user = userEvent.setup();
  renderAt("/login", LOGIN_ROUTES);
  await user.type(screen.getByLabelText("邮箱"), "a@example.com");
  await user.type(screen.getByLabelText("密码"), "my-password");

  const toggle = screen.getByRole("button", { name: "显示密码" });
  assert.equal(toggle.getAttribute("type"), "button", "不是 submit，否则会抢表单提交");
  await user.click(toggle);
  await user.click(screen.getByRole("button", { name: "隐藏密码" }));
  assert.equal(calls.length, 0);
  assert.equal(value("密码"), "my-password");

  await user.type(screen.getByLabelText("密码"), "{Enter}");
  await waitFor(() => assert.equal(currentLocation()?.path, "/"));
  assert.equal(calls.length, 1);
});

test("登录：在邮箱框里按 Enter 也提交", async () => {
  const calls = stubApi({ [TENANT_LOGIN]: loginOk });
  const user = userEvent.setup();
  renderAt("/login", LOGIN_ROUTES);
  await user.type(screen.getByLabelText("密码"), "my-password");
  await user.type(screen.getByLabelText("邮箱"), "a@example.com{Enter}");
  await waitFor(() => assert.equal(calls.length, 1));
});

test("登录：邮箱的大小写原样提交（后端负责统一成小写），首尾的空格、制表符、全角空格去掉；密码一个字符都不动", async () => {
  const calls = stubApi({ [TENANT_LOGIN]: loginOk });
  renderAt("/login", LOGIN_ROUTES);
  fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "\t Zhang.San@Example.COM　 " } });
  fireEvent.change(screen.getByLabelText("密码"), { target: { value: "  密码 with spaces\t" } });
  await userEvent.setup().click(screen.getByRole("button", { name: "登录" }));
  await waitFor(() => assert.equal(calls.length, 1));
  assert.deepEqual(calls[0]?.body, { email: "Zhang.San@Example.COM", password: "  密码 with spaces\t" });
});

test("登录：粘贴进来的内容、超长的内容照常处理，不报错不截断", async () => {
  const calls = stubApi({ [TENANT_LOGIN]: () => apiError(400, "VALIDATION_FAILED", "请求参数校验未通过") });
  const user = userEvent.setup();
  renderAt("/login", LOGIN_ROUTES);
  const longEmail = `${"a".repeat(300)}@example.com`;
  const longPassword = "密码Pw1!".repeat(400);
  await user.click(screen.getByLabelText("邮箱"));
  await user.paste(longEmail);
  await user.click(screen.getByLabelText("密码"));
  await user.paste(longPassword);
  await user.click(screen.getByRole("button", { name: "登录" }));
  assert.ok(await screen.findByText("邮箱或密码不正确。"));
  assert.deepEqual(calls[0]?.body, { email: longEmail, password: longPassword });
  assert.equal(value("邮箱"), longEmail);
});

test("登录：输入法正在组字时按下的 Enter 不会让页面报错或发出半截内容（组字结束后的值才提交）", async () => {
  const calls = stubApi({ [TENANT_LOGIN]: loginOk });
  renderAt("/login", LOGIN_ROUTES);
  const email = screen.getByLabelText("邮箱");
  fireEvent.compositionStart(email);
  fireEvent.change(email, { target: { value: "zhang" } });
  fireEvent.keyDown(email, { key: "Enter", isComposing: true, keyCode: 229 });
  assert.equal(calls.length, 0, "组字中的 Enter 只是确认候选词");
  fireEvent.compositionEnd(email, { data: "张" });
  fireEvent.change(email, { target: { value: "张@example.com" } });
  fireEvent.change(screen.getByLabelText("密码"), { target: { value: "x" } });
  await userEvent.setup().click(screen.getByRole("button", { name: "登录" }));
  await waitFor(() => assert.equal(calls.length, 1));
  assert.deepEqual(calls[0]?.body, { email: "张@example.com", password: "x" });
});

test("登录：同一个事件循环里连着来两次提交（双击、Enter 连按），只发一个请求", async () => {
  const pending = deferred();
  const calls = stubApi({ [TENANT_LOGIN]: () => pending.promise });
  renderAt("/login", LOGIN_ROUTES);
  fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "a@example.com" } });
  fireEvent.change(screen.getByLabelText("密码"), { target: { value: "x" } });
  const form = screen.getByLabelText("邮箱").closest("form") as HTMLFormElement;
  fireEvent.submit(form);
  fireEvent.submit(form);
  fireEvent.click(screen.getByRole("button", { name: /登录/ }));
  await screen.findByRole("button", { name: "正在登录…" });
  assert.equal(calls.length, 1);
  pending.resolve(loginOk());
  await waitFor(() => assert.equal(currentLocation()?.path, "/"));
});

test("【缺陷】登录：后端回了 200 却没有令牌（应答缺字段）时，不能当作登录成功，也不能把空令牌存下来", async () => {
  stubApi({ [TENANT_LOGIN]: () => json(200, { ok: true }) });
  renderAt("/login", LOGIN_ROUTES);
  await fillLogin("a@example.com", "my-password");
  await waitFor(() => assert.ok(screen.queryByRole("alert")?.textContent || currentLocation() !== null));
  assert.equal(sessionStore.get("tenant"), null, "没有令牌的应答不应该留下登录状态");
  assert.equal(currentLocation(), null, "不应该离开登录页");
  assert.equal(screen.getByRole("alert").textContent, "系统暂时无法登录，请稍后再试。");
});

/* ───────────── 凭令牌设置密码 ───────────── */

async function submitNewPassword(button: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("新密码"), GOOD_PASSWORD);
  await user.type(screen.getByLabelText("再输入一次"), GOOD_PASSWORD);
  await user.click(screen.getByRole("button", { name: button }));
}

test("设置密码：401 / 403 / 409 / 429 / 500 / 非 JSON / 断网 都显示在表单顶部的危险提示条里，保留两个密码框的内容，不误判成「链接已失效」", async () => {
  const cases: [() => Response, string][] = [
    [() => apiError(401, "UNAUTHENTICATED", "请先登录"), "请先登录"],
    [() => apiError(403, "ACCOUNT_DISABLED", "账号已停用，请联系管理员"), "账号已停用，请联系管理员"],
    [() => apiError(409, "CONFLICT", "这个账号已经设置过密码"), "这个账号已经设置过密码"],
    [() => apiError(429, "TOO_MANY_LOGIN_ATTEMPTS", "尝试次数过多", {}, { "retry-after": "180" }), "尝试次数过多，请 3 分钟后再试。"],
    [() => apiError(429, "TOO_MANY_LOGIN_ATTEMPTS", "尝试次数过多"), "尝试次数过多，请稍后再试。"],
    [() => apiError(400, "VALIDATION_FAILED", "请求参数校验未通过"), "提交的内容不符合要求，请检查后重试。"],
    [() => apiError(500, "INTERNAL_ERROR", "服务器内部错误"), "系统暂时无法设置密码，请稍后再试。"],
    [html(502), "系统暂时无法设置密码，请稍后再试。"],
    [html(404), "系统暂时无法设置密码，请稍后再试。"],
    [() => new Response("ok", { status: 200 }), "系统暂时无法设置密码，请稍后再试。"],
    [offline, "网络连接失败，请检查网络后重试。"],
  ];
  for (const [responder, text] of cases) {
    stubApi({ "POST /tenant/v1/auth/accept-invite": responder });
    renderAt({ pathname: "/accept-invite", hash: "#token=nzi_abc" }, SET_PASSWORD_ROUTES);
    await submitNewPassword("设置密码并继续");
    const alert = await screen.findByText(text);
    assert.ok(alert.closest('[role="alert"]'), text);
    assertAbsent(screen.queryByText("邀请链接已失效"));
    assertAbsent(screen.queryByText(/Bad Gateway|INTERNAL|服务器内部错误/));
    assert.equal(value("新密码"), GOOD_PASSWORD);
    assert.equal(value("再输入一次"), GOOD_PASSWORD);
    assert.equal((screen.getByLabelText("新密码") as HTMLInputElement).readOnly, false);
    assert.equal(currentLocation(), null, "留在本页");
    resetBrowser();
  }
});

test("设置密码：重设密码页收到「邀请失效」的错误码、邀请页收到「重置失效」的错误码，都不当成本页的链接失效", async () => {
  stubApi({ "POST /platform/v1/auth/reset-password": () => apiError(400, "INVITE_INVALID", "邀请已失效") });
  renderAt({ pathname: "/platform/reset-password", hash: "#token=nzr_abc" }, SET_PASSWORD_ROUTES);
  await submitNewPassword("设置新密码并继续");
  assert.ok(await screen.findByRole("alert"));
  await waitFor(() => assert.notEqual(screen.getByRole("alert").textContent, ""));
  assertAbsent(screen.queryByText("重置链接已失效"));
  assert.equal(value("新密码"), GOOD_PASSWORD);
});

test("设置密码：提交中再点、再按 Enter 都不会再发请求；提交中密码框只读", async () => {
  const pending = deferred();
  const calls = stubApi({ "POST /tenant/v1/auth/accept-invite": () => pending.promise });
  const user = userEvent.setup();
  renderAt({ pathname: "/accept-invite", hash: "#token=nzi_abc" }, SET_PASSWORD_ROUTES);
  await submitNewPassword("设置密码并继续");
  const busy = await screen.findByRole("button", { name: "正在设置…" });
  assert.equal(busy.getAttribute("aria-busy"), "true");
  assert.equal((screen.getByLabelText("新密码") as HTMLInputElement).readOnly, true);
  assert.equal((screen.getByLabelText("再输入一次") as HTMLInputElement).readOnly, true);
  await user.click(busy);
  fireEvent.submit(busy.closest("form") as HTMLFormElement);
  assert.equal(calls.length, 1);
  pending.resolve(json(200, { user: { email: "new@example.com" } }));
  await waitFor(() => assert.equal(currentLocation()?.path, "/login"));
});

test("设置密码：提交的密码一个字符都不动（首尾空格、中文、表情都原样），令牌原样", async () => {
  const calls = stubApi({ "POST /tenant/v1/auth/accept-invite": () => json(200, { user: { email: "new@example.com" } }) });
  const password = "  密码 Pw-2026 😀 ";
  const token = "nzi_AbC-dEf_0123456789";
  renderAt({ pathname: "/accept-invite", hash: `#token=${token}` }, SET_PASSWORD_ROUTES);
  fireEvent.change(screen.getByLabelText("新密码"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("再输入一次"), { target: { value: password } });
  await userEvent.setup().click(screen.getByRole("button", { name: "设置密码并继续" }));
  await waitFor(() => assert.equal(calls.length, 1));
  assert.deepEqual(calls[0]?.body, { token, password });
});

test("设置密码：两次输入只差首尾空格或大小写也算不一致", async () => {
  const calls = stubApi({});
  for (const confirmation of [`${GOOD_PASSWORD} `, ` ${GOOD_PASSWORD}`, GOOD_PASSWORD.toLowerCase()]) {
    renderAt({ pathname: "/accept-invite", hash: "#token=nzi_abc" }, SET_PASSWORD_ROUTES);
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: GOOD_PASSWORD } });
    fireEvent.change(screen.getByLabelText("再输入一次"), { target: { value: confirmation } });
    await userEvent.setup().click(screen.getByRole("button", { name: "设置密码并继续" }));
    assert.ok(screen.getByText("两次输入的密码不一致"), JSON.stringify(confirmation));
    assertFocused(screen.getByLabelText("再输入一次"));
    resetBrowser();
  }
  assert.equal(calls.length, 0);
});

test("令牌只认 # 后面的 token：放在 ? 后面的不读（那样会进服务器日志）；后端发的令牌字符集原样取出", () => {
  assert.equal(tokenFromHash("#token=nzi_AbC-dEf_012"), "nzi_AbC-dEf_012");
  assert.equal(tokenFromHash("#a=1&token=nzi_x&b=2"), "nzi_x");
  assert.equal(tokenFromHash("#token=first&token=second"), "first");
  assert.equal(tokenFromHash("#TOKEN=nzi_x"), null);
  assert.equal(tokenFromHash("#/token=nzi_x"), null);
  assert.equal(tokenFromHash("#token"), null);
  assert.equal(tokenFromHash("#"), null);
  assert.equal(tokenFromHash("#token=%6Ezi_x"), "nzi_x", "百分号编码会被解开");

  renderAt("/accept-invite?token=nzi_in_query", SET_PASSWORD_ROUTES);
  assert.ok(screen.getByRole("heading", { level: 1, name: "邀请链接已失效" }));
  assertAbsent(screen.queryByLabelText("新密码"));
});

/* ───────────── 登录后的页面 ───────────── */

test("首页：取账号信息时 403 / 404 / 429 / 500 / 非 JSON / 断网 都显示「加载失败」，不退出登录、不清令牌", async () => {
  const responders = [
    () => apiError(403, "FORBIDDEN", "没有权限"),
    () => apiError(404, "NOT_FOUND", "不存在"),
    () => apiError(429, "RATE_LIMITED", "太频繁", {}, { "retry-after": "60" }),
    () => apiError(500, "INTERNAL_ERROR", "服务器内部错误"),
    html(502),
    () => new Response("not json", { status: 200 }),
    offline,
  ];
  for (const responder of responders) {
    signIn("tenant", "keep-me");
    stubApi({ "GET /tenant/v1/auth/me": responder });
    renderAt("/", SHELL_ROUTES);
    assert.ok(await screen.findByRole("heading", { level: 2, name: "加载失败" }));
    assert.ok(screen.getByRole("button", { name: "重试" }));
    assertAbsent(screen.queryByText(/Bad Gateway|INTERNAL|没有权限|服务器内部错误/));
    assert.equal(sessionStore.get("tenant")?.accessToken, "keep-me");
    assert.equal(currentLocation(), null);
    resetBrowser();
  }
});

test("首页：代理返回的 401（不是 JSON）同样算登录失效，回登录页", async () => {
  signIn("platform", "stale");
  stubApi({ "GET /platform/v1/auth/me": html(401) });
  renderAt("/platform", SHELL_ROUTES);
  await waitFor(() => assert.deepEqual(currentLocation(), { path: "/platform/login", state: { reason: "expired", from: "/platform" } }));
  assert.equal(sessionStore.get("platform"), null);
});

test("退出登录：后端回 500、回 401、回 HTML 都照样清掉本地令牌并回登录页；连点两次只通知后端一次", async () => {
  for (const responder of [() => apiError(500, "INTERNAL_ERROR", "x"), () => apiError(401, "UNAUTHENTICATED", "x"), html(502)]) {
    signIn("tenant", "tenant-token");
    const calls = stubApi({ "GET /tenant/v1/auth/me": tenantMe, "POST /tenant/v1/auth/logout": responder });
    const user = userEvent.setup();
    renderAt("/", SHELL_ROUTES);
    await user.click(await screen.findByRole("button", { name: /账号菜单：\s*测试调度/ }));
    const item = screen.getByRole("menuitem", { name: "退出登录" });
    fireEvent.click(item);
    fireEvent.click(item);
    await waitFor(() => assert.deepEqual(currentLocation(), { path: "/login", state: { reason: "logged-out" } }));
    assert.equal(calls.filter((call) => call.path === "/tenant/v1/auth/logout").length, 1);
    assert.equal(sessionStore.get("tenant"), null);
    assert.equal(sessionStorage.length, 0);
    assert.equal(localStorage.length, 0);
    resetBrowser();
  }
});

test("退出登录后回登录页不带「回到原页面」：下一个登录的人不会被带到上一个人看的页面", async () => {
  signIn("tenant");
  stubApi({ "GET /tenant/v1/auth/me": tenantMe, "POST /tenant/v1/auth/logout": () => new Response(null, { status: 204 }) });
  const user = userEvent.setup();
  renderAt("/account/password", SHELL_ROUTES);
  await user.click(await screen.findByRole("button", { name: /账号菜单：\s*测试调度/ }));
  await user.click(screen.getByRole("menuitem", { name: "退出登录" }));
  await waitFor(() => assert.equal(currentLocation()?.path, "/login"));
  assert.equal("from" in (currentLocation()?.state as object), false);
});

async function fillChangePassword(current: string, next: string, confirmation: string): Promise<void> {
  fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: current } });
  fireEvent.change(screen.getByLabelText("新密码"), { target: { value: next } });
  fireEvent.change(screen.getByLabelText("再输入一次新密码"), { target: { value: confirmation } });
  await userEvent.setup().click(screen.getByRole("button", { name: "保存新密码" }));
}

test("修改密码：403 / 409 / 500 / 非 JSON / 断网 显示在表单顶部的危险提示条里，三个密码框的内容都保留，仍是登录状态", async () => {
  const cases: [() => Response, string][] = [
    [() => apiError(403, "FORBIDDEN", "没有权限执行这个操作"), "没有权限执行这个操作"],
    [() => apiError(409, "CONFLICT", "密码刚刚在别处被修改过"), "密码刚刚在别处被修改过"],
    [() => apiError(400, "VALIDATION_FAILED", "请求参数校验未通过"), "提交的内容不符合要求，请检查后重试。"],
    [() => apiError(500, "INTERNAL_ERROR", "服务器内部错误"), "系统暂时无法修改密码，请稍后再试。"],
    [html(502), "系统暂时无法修改密码，请稍后再试。"],
    [offline, "网络连接失败，请检查网络后重试。"],
  ];
  for (const [responder, text] of cases) {
    signIn("tenant", "keep-me");
    stubApi({ "GET /tenant/v1/auth/me": tenantMe, "POST /tenant/v1/auth/change-password": responder });
    renderAt("/account/password", SHELL_ROUTES);
    await screen.findByRole("button", { name: /账号菜单：\s*测试调度/ });
    await fillChangePassword("old-password", GOOD_PASSWORD, GOOD_PASSWORD);
    assert.ok((await screen.findByText(text)).closest('[role="alert"]'), text);
    assert.equal(value("当前密码"), "old-password");
    assert.equal(value("新密码"), GOOD_PASSWORD);
    assert.equal(value("再输入一次新密码"), GOOD_PASSWORD);
    assert.equal(screen.getByRole("button", { name: "保存新密码" }).getAttribute("aria-busy"), null, "出错后按钮恢复");
    assert.equal(sessionStore.get("tenant")?.accessToken, "keep-me");
    assert.equal(currentLocation(), null);
    resetBrowser();
  }
});

test("修改密码：提交中按钮是加载态、三个框只读、再提交不发第二个请求；失败后再提交会清掉上一次的提示", async () => {
  signIn("tenant");
  const pending = deferred();
  let attempt = 0;
  const calls = stubApi({
    "GET /tenant/v1/auth/me": tenantMe,
    "POST /tenant/v1/auth/change-password": () => {
      attempt += 1;
      return attempt === 1 ? apiError(500, "INTERNAL_ERROR", "x") : pending.promise;
    },
  });
  renderAt("/account/password", SHELL_ROUTES);
  await screen.findByRole("button", { name: /账号菜单：\s*测试调度/ });
  await fillChangePassword("old-password", GOOD_PASSWORD, GOOD_PASSWORD);
  await screen.findByText("系统暂时无法修改密码，请稍后再试。");

  await userEvent.setup().click(screen.getByRole("button", { name: "保存新密码" }));
  const busy = await screen.findByRole("button", { name: "保存中…" });
  assert.equal(busy.getAttribute("aria-busy"), "true");
  assertAbsent(screen.queryByText("系统暂时无法修改密码，请稍后再试。"));
  for (const label of ["当前密码", "新密码", "再输入一次新密码"]) assert.equal((screen.getByLabelText(label) as HTMLInputElement).readOnly, true, label);
  fireEvent.submit(busy.closest("form") as HTMLFormElement);
  fireEvent.click(busy);
  assert.equal(calls.filter((call) => call.method === "POST").length, 2);

  pending.resolve(new Response(null, { status: 204 }));
  assert.ok(await screen.findByText(/密码已修改。/));
});

test("后端返回的姓名、邮箱、供应商名称里带 HTML 时只当文字显示：不生成标签，不执行脚本", async () => {
  const payload = '<img src=x onerror="globalThis.__xss=1"><script>globalThis.__xss=1</script><b>粗体</b>';
  signIn("tenant");
  stubApi({ "GET /tenant/v1/auth/me": () => json(200, tenantMeBody({ name: payload, email: `"><svg onload=alert(1)>@x.example`, tenantName: `${payload}供应商` })) });
  const user = userEvent.setup();
  renderAt("/", SHELL_ROUTES);
  await waitFor(() => assert.ok(document.querySelector(".page__meta .tenant-name")));
  await user.click(screen.getByRole("button", { name: /账号菜单/ }));

  const main = document.querySelector("main") as HTMLElement;
  assert.ok(main.textContent?.includes(payload), "原样作为文字显示");
  assert.ok(main.textContent?.includes(`${payload}供应商`));
  assert.equal(document.querySelectorAll("img, script, b, svg[onload]").length, 0, "不应该出现由后端文字生成的标签");
  assert.equal((globalThis as { __xss?: number }).__xss, undefined);
  assert.equal(document.querySelector(".menu-header__name")?.textContent, payload);
  assert.equal(document.querySelector(".account-button__avatar")?.textContent, "<", "头像只取姓名的第一个字符");
});

test("后端返回的错误说明里带 HTML 时也只当文字显示（提示条、字段下的说明）", async () => {
  const payload = '<img src=x onerror="globalThis.__xss=2">请重试';
  stubApi({ "POST /tenant/v1/auth/accept-invite": () => apiError(409, "CONFLICT", payload) });
  renderAt({ pathname: "/accept-invite", hash: "#token=nzi_abc" }, SET_PASSWORD_ROUTES);
  await submitNewPassword("设置密码并继续");
  assert.equal((await screen.findByRole("alert")).textContent, payload);
  resetBrowser();

  stubApi({ "POST /tenant/v1/auth/accept-invite": () => apiError(400, "WEAK_PASSWORD", "密码强度不够", { issues: [{ code: "X", message: payload }] }) });
  renderAt({ pathname: "/accept-invite", hash: "#token=nzi_abc" }, SET_PASSWORD_ROUTES);
  await submitNewPassword("设置密码并继续");
  assert.ok(await screen.findByText(payload));
  assert.equal(document.querySelectorAll("img").length, 0);
  assert.equal((globalThis as { __xss?: number }).__xss, undefined);
});

test("姓名是空的、只有表情、是组合字符时，顶栏和首页照常显示，不报错", async () => {
  for (const name of ["", "👨‍👩‍👧", "é", " "]) {
    signIn("tenant");
    stubApi({ "GET /tenant/v1/auth/me": () => json(200, tenantMeBody({ name })) });
    renderAt("/", SHELL_ROUTES);
    await waitFor(() => assert.ok(document.querySelector(".page__meta .tenant-name"), JSON.stringify(name)));
    assert.ok(screen.getByRole("button", { name: /账号菜单/ }));
    resetBrowser();
  }
});

test("不认识的角色显示「—」（原来在「当前登录」卡片里，现在在顶栏的账号按钮上），页面照常可用", async () => {
  signIn("tenant");
  const body = tenantMeBody();
  stubApi({ "GET /tenant/v1/auth/me": () => json(200, { ...body, user: { ...body.user, role: "role_added_later" } }) });
  renderAt("/", SHELL_ROUTES);
  await screen.findByText("测试用供应商", { selector: ".page__meta .tenant-name" });
  assert.equal(document.querySelector(".account-button__role")?.textContent, "—");
  assert.doesNotMatch(document.body.textContent ?? "", /role_added_later/);
});
