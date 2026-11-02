/** 登录页的邮箱验证码（docs/design/pages/login.md 第 6 节，ADR 0050）。 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Route } from "react-router";
import { sessionStore } from "../auth/session-store.ts";
import { FAR_FUTURE, apiError, assertAbsent, assertFocused, currentLocation, json, renderAt, resetBrowser, stubApi } from "../testing/harness.tsx";
import { EMAIL_CODE_REJECTED_TEXT, EMAIL_CODE_UNAVAILABLE_TEXT, IP_NOT_ALLOWED_TEXT, LoginPage, PASSWORD_LOGIN_DISABLED_TEXT, emailCodeSentText } from "./LoginPage.tsx";

afterEach(resetBrowser);

const ROUTES = (
  <>
    <Route path="/login" element={<LoginPage key="tenant" portal="tenant" />} />
    <Route path="/platform/login" element={<LoginPage key="platform" portal="platform" />} />
  </>
);

const METHODS = "GET /tenant/v1/auth/login-methods";
const REQUEST = "POST /tenant/v1/auth/email-code/request";
const VERIFY = "POST /tenant/v1/auth/email-code/verify";
const both = () => json(200, { email_code: true, password: true });
const sentOk = () => json(202, { expires_in_seconds: 600, resend_after_seconds: 60 });
const SWITCH = "改用邮箱验证码";

async function toCodeStep(routes: Parameters<typeof stubApi>[0] = {}): Promise<ReturnType<typeof stubApi>> {
  const calls = stubApi({ [METHODS]: both, [REQUEST]: sentOk, ...routes });
  renderAt("/login", ROUTES);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: SWITCH }));
  await user.type(screen.getByLabelText("邮箱"), "  a@example.com ");
  await user.click(screen.getByRole("button", { name: "发送验证码" }));
  await screen.findByLabelText("验证码");
  return calls;
}

test("邮件没配置：和原来的登录页一样，没有任何验证码的入口", async () => {
  const calls = stubApi({ [METHODS]: () => json(200, { email_code: false, password: true }) });
  renderAt("/login", ROUTES);
  await waitFor(() => assert.equal(calls.length, 1));
  assert.ok(screen.getByLabelText("密码"));
  assertAbsent(screen.queryByRole("button", { name: SWITCH }));
  assertAbsent(screen.queryByText(/验证码/));
});

test("问不到可用的方式（网络不通、服务器出错、应答不对）：只有密码，能用，不报错", async () => {
  const responders = [
    () => {
      throw new TypeError("fetch failed");
    },
    () => apiError(500, "INTERNAL_ERROR", "服务器内部错误"),
    () => json(200, { email_code: "yes" }),
  ];
  for (const responder of responders) {
    const calls = stubApi({ [METHODS]: responder });
    renderAt("/login", ROUTES);
    await waitFor(() => assert.equal(calls.length, 1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(screen.getByLabelText("密码"));
    assertAbsent(screen.queryByRole("button", { name: SWITCH }));
    assertAbsent(document.querySelector(".alert"));
    resetBrowser();
  }
});

test("过渡期：先显示密码表单，不用等请求；邮件可用时多一个次要按钮，按钮文字不含「登录」，主按钮仍能按名字找到", async () => {
  stubApi({ [METHODS]: both });
  renderAt("/login", ROUTES);
  assert.ok(screen.getByLabelText("密码"), "第一屏就有密码框");
  const button = await screen.findByRole("button", { name: SWITCH });
  assert.ok(!button.textContent?.includes("登录"));
  assert.equal(screen.getAllByRole("button", { name: /登录/ }).length, 1);
});

test("密码已关闭：直接是验证码这一步，没有密码框和「改用密码」", async () => {
  stubApi({ [METHODS]: () => json(200, { email_code: true, password: false }) });
  renderAt("/login", ROUTES);
  assert.ok(await screen.findByRole("button", { name: "发送验证码" }));
  assertAbsent(screen.queryByLabelText("密码"));
  assertAbsent(screen.queryByRole("button", { name: "改用密码" }));
});

test("走完：发码 → 第二步显示邮箱、提示不说账号是否存在、焦点在验证码框 → 登录进首页；令牌存在这个后台自己的位置", async () => {
  const calls = await toCodeStep({ [VERIFY]: () => json(200, { access_token: "code-token", token_type: "Bearer", expires_at: FAR_FUTURE, user: {}, tenant: {}, must_change_password: false }) });
  assert.deepEqual(calls.find((call) => call.path.endsWith("/request"))?.body, { email: "a@example.com" }, "邮箱去掉首尾空格");
  assert.ok(screen.getByText("a@example.com"));
  assert.ok(screen.getByText(emailCodeSentText(600)).closest('[role="status"]'));
  // 账号存不存在都是这一句；要说清是哪个后台：运营和供应商是两个入口，账号不通用（业主用运营账号的邮箱在供应商入口收不到码）
  const sentText = emailCodeSentText(600, "供应商后台");
  assert.match(sentText, /如果这个邮箱是供应商后台的账号/);
  assert.match(sentText, /运营后台和供应商后台是两个入口，账号不通用/);
  const input = screen.getByLabelText("验证码") as HTMLInputElement;
  assertFocused(input);
  assert.equal(input.autocomplete, "one-time-code");
  assert.equal(input.getAttribute("inputmode"), "numeric");
  assert.equal(input.maxLength, -1, "不用 maxlength：粘贴带前导空格的码会被截掉最后一位");
  const user = userEvent.setup();
  await user.type(input, "042917");
  await user.click(screen.getByRole("button", { name: "登录" }));
  await waitFor(() => assert.equal(currentLocation()?.path, "/"));
  assert.deepEqual(calls.at(-1)?.body, { email: "a@example.com", code: "042917" });
  assert.equal(sessionStore.get("tenant")?.accessToken, "code-token");
  assert.equal(sessionStore.get("platform"), null);
});

test("运营后台：验证码通过后带着两步验证的提示进去，不是直接进后台", async () => {
  stubApi({
    "GET /platform/v1/auth/login-methods": both,
    "POST /platform/v1/auth/email-code/request": sentOk,
    "POST /platform/v1/auth/email-code/verify": () => json(200, { access_token: "pending", token_type: "Bearer", expires_at: FAR_FUTURE, user: {}, must_change_password: false, second_factor: { status: "verify_required" } }),
  });
  renderAt("/platform/login", ROUTES);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: SWITCH }));
  await user.type(screen.getByLabelText("邮箱"), "a@example.com");
  await user.click(screen.getByRole("button", { name: "发送验证码" }));
  await user.type(await screen.findByLabelText("验证码"), "123456");
  await user.click(screen.getByRole("button", { name: "登录" }));
  await waitFor(() => assert.equal(currentLocation()?.path, "/platform"));
  assert.deepEqual(currentLocation()?.state, { secondFactor: "verify_required" });
});

test("必须先改密码：验证码通过后去改密码页", async () => {
  await toCodeStep({ [VERIFY]: () => json(200, { access_token: "t", token_type: "Bearer", expires_at: FAR_FUTURE, user: {}, tenant: {}, must_change_password: true }) });
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("验证码"), "123456");
  await user.click(screen.getByRole("button", { name: "登录" }));
  await waitFor(() => assert.equal(currentLocation()?.path, "/account/password"));
});

test("验证码被拒：一律同一句，清空输入，焦点回到输入框；不解析更细的原因", async () => {
  await toCodeStep({ [VERIFY]: () => apiError(401, "EMAIL_CODE_INVALID", "验证码不正确或已失效") });
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("验证码"), "000000");
  await user.click(screen.getByRole("button", { name: "登录" }));
  assert.ok((await screen.findByText(EMAIL_CODE_REJECTED_TEXT)).closest('[role="alert"]'));
  assert.equal((screen.getByLabelText("验证码") as HTMLInputElement).value, "");
  assertFocused(screen.getByLabelText("验证码"));
  assert.equal(sessionStore.get("tenant"), null);
});

test("验证码格式不对：前端拦下，不发请求", async () => {
  const calls = await toCodeStep();
  const before = calls.length;
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "登录" }));
  assert.ok(screen.getByText("请输入验证码"));
  await user.type(screen.getByLabelText("验证码"), "12");
  await user.click(screen.getByRole("button", { name: "登录" }));
  assert.ok(screen.getByText("验证码是 6 位数字"));
  assert.equal(calls.length, before);
});

test("账号停用、不在 IP 白名单（只有验证码对了才会说）、被限速：各显示对应的话", async () => {
  const cases: [() => Response, string][] = [
    [() => apiError(403, "ACCOUNT_DISABLED", "账号已停用，请联系管理员"), "账号已停用，请联系管理员"],
    [() => apiError(403, "IP_NOT_ALLOWED", "不在白名单"), IP_NOT_ALLOWED_TEXT],
    [() => apiError(429, "TOO_MANY_LOGIN_ATTEMPTS", "太多", {}, { "retry-after": "840" }), "尝试次数过多，请 14 分钟后再试。"],
  ];
  for (const [responder, text] of cases) {
    await toCodeStep({ [VERIFY]: responder });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("验证码"), "123456");
    await user.click(screen.getByRole("button", { name: "登录" }));
    assert.ok(await screen.findByText(text));
    resetBrowser();
  }
});

test("重新发送：倒计时期间不能点，数字来自后端；到 0 才能再发，再发清空旧的输入", async () => {
  const calls = await toCodeStep({ [REQUEST]: () => json(202, { expires_in_seconds: 600, resend_after_seconds: 1 }) });
  const countdown = screen.getByRole("button", { name: "重新发送（1 秒）" }) as HTMLButtonElement;
  assert.equal(countdown.disabled, true);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("验证码"), "12");
  const ready = (await screen.findByRole("button", { name: "重新发送" }, { timeout: 2_000 })) as HTMLButtonElement;
  assert.equal(ready.disabled, false);
  const sentBefore = calls.filter((call) => call.path.endsWith("/request")).length;
  await user.click(ready);
  await waitFor(() => assert.equal(calls.filter((call) => call.path.endsWith("/request")).length, sentBefore + 1));
  await waitFor(() => assert.equal((screen.getByLabelText("验证码") as HTMLInputElement).value, ""));
});

test("换一个邮箱：回到第一步，邮箱还在；改用密码：回到密码表单", async () => {
  await toCodeStep();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "换一个邮箱" }));
  assert.ok(screen.getByRole("button", { name: "发送验证码" }));
  assert.equal((screen.getByLabelText("邮箱") as HTMLInputElement).value.trim(), "a@example.com");
  await user.click(screen.getByRole("button", { name: "改用密码" }));
  assert.ok(screen.getByLabelText("密码"));
  assertFocused(screen.getByLabelText("邮箱"));
});

test("发码时：邮箱没填不发请求；被限速留在这一步；邮件配置刚被清空回到密码表单", async () => {
  const calls = stubApi({ [METHODS]: both, [REQUEST]: () => apiError(429, "TOO_MANY_LOGIN_ATTEMPTS", "太多", {}, { "retry-after": "60" }) });
  renderAt("/login", ROUTES);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: SWITCH }));
  await user.click(screen.getByRole("button", { name: "发送验证码" }));
  assert.ok(screen.getByText("请输入邮箱"));
  assert.equal(calls.filter((call) => call.path.endsWith("/request")).length, 0);
  await user.type(screen.getByLabelText("邮箱"), "a@example.com");
  await user.click(screen.getByRole("button", { name: "发送验证码" }));
  assert.ok(await screen.findByText("尝试次数过多，请 1 分钟后再试。"));
  assertAbsent(screen.queryByLabelText("验证码"));
  resetBrowser();

  stubApi({ [METHODS]: both, [REQUEST]: () => apiError(503, "EMAIL_CODE_UNAVAILABLE", "现在不能发送") });
  renderAt("/login", ROUTES);
  const again = userEvent.setup();
  await again.click(await screen.findByRole("button", { name: SWITCH }));
  await again.type(screen.getByLabelText("邮箱"), "a@example.com");
  await again.click(screen.getByRole("button", { name: "发送验证码" }));
  assert.ok(await screen.findByText(EMAIL_CODE_UNAVAILABLE_TEXT));
  assert.ok(screen.getByLabelText("密码"), "能继续用密码");
});

test("页面打开之后密码才被关闭：提交密码时后端说已关闭，页面换成验证码，密码清掉", async () => {
  stubApi({ "POST /tenant/v1/auth/login": () => apiError(403, "PASSWORD_LOGIN_DISABLED", "密码登录已关闭") });
  renderAt("/login", ROUTES);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("邮箱"), "a@example.com");
  await user.type(screen.getByLabelText("密码"), "secret");
  await user.click(screen.getByRole("button", { name: "登录" }));
  assert.ok((await screen.findByText(PASSWORD_LOGIN_DISABLED_TEXT)).closest('[role="status"]'));
  assert.ok(screen.getByRole("button", { name: "发送验证码" }));
  assertAbsent(screen.queryByLabelText("密码"));
  assert.equal((screen.getByLabelText("邮箱") as HTMLInputElement).value, "a@example.com");
});

test("验证码输入时规整：空白去掉、全角转半角、别的字符去掉，最多 6 位；发给后端的是干净的 6 位", async () => {
  const calls = await toCodeStep({ [VERIFY]: () => apiError(401, "EMAIL_CODE_INVALID", "x") });
  const user = userEvent.setup();
  const input = screen.getByLabelText("验证码") as HTMLInputElement;
  for (const [pasted, expected] of [[" 042917", "042917"], ["０４２９１７", "042917"], ["042 917\n", "042917"], ["验证码：042917。", "042917"], ["0429170000", "042917"], ["abc", ""]] as const) {
    await user.clear(input);
    await user.click(input);
    await user.paste(pasted);
    assert.equal(input.value, expected, JSON.stringify(pasted));
  }
  await user.paste("０４２９１７");
  await user.keyboard("{Enter}");
  await waitFor(() => assert.deepEqual(calls.at(-1)?.body, { email: "a@example.com", code: "042917" }));
});
