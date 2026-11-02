/** QA（M4-06，ADR 0050）：登录页邮箱验证码，开发的 LoginPage.email-code.test.tsx 没有覆盖的部分。接口全部是替身，邮箱都是虚构的。 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Route } from "react-router";
import { sessionStore } from "../auth/session-store.ts";
import { FAR_FUTURE, apiError, assertAbsent, assertFocused, json, renderAt, resetBrowser, stubApi } from "../testing/harness.tsx";
import { EMAIL_CODE_REJECTED_TEXT, EMAIL_CODE_UNAVAILABLE_TEXT, LoginPage, emailCodeSentText } from "./LoginPage.tsx";

afterEach(resetBrowser);

const ROUTES = <Route path="/login" element={<LoginPage key="tenant" portal="tenant" />} />;
const METHODS = "GET /tenant/v1/auth/login-methods";
const REQUEST = "POST /tenant/v1/auth/email-code/request";
const VERIFY = "POST /tenant/v1/auth/email-code/verify";
const both = () => json(200, { email_code: true, password: true });
const sentOk = () => json(202, { expires_in_seconds: 600, resend_after_seconds: 60 });
const success = () => json(200, { access_token: "qa-token", token_type: "Bearer", expires_at: FAR_FUTURE, user: {}, tenant: {}, must_change_password: false });
const SWITCH = "改用邮箱验证码";
const EMAIL = "qa-user@example.test";
const verifies = (calls: ReturnType<typeof stubApi>) => calls.filter((call) => call.path.endsWith("/verify"));
const requests = (calls: ReturnType<typeof stubApi>) => calls.filter((call) => call.path.endsWith("/request"));
const codeInput = (): HTMLInputElement => screen.getByLabelText("验证码") as HTMLInputElement;

async function toCodeStep(routes: Parameters<typeof stubApi>[0] = {}): Promise<{ calls: ReturnType<typeof stubApi>; user: ReturnType<typeof userEvent.setup> }> {
  const calls = stubApi({ [METHODS]: both, [REQUEST]: sentOk, ...routes });
  renderAt("/login", ROUTES);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: SWITCH }));
  await user.type(screen.getByLabelText("邮箱"), EMAIL);
  await user.click(screen.getByRole("button", { name: "发送验证码" }));
  await screen.findByLabelText("验证码");
  return { calls, user };
}

test("缺陷：密码已关闭的页面，邮件配置刚被清空（503）：文案说「请用密码登录」，必须真的能看到密码框，否则人被锁在这一页", async () => {
  stubApi({ [METHODS]: () => json(200, { email_code: true, password: false }), [REQUEST]: () => apiError(503, "EMAIL_CODE_UNAVAILABLE", "现在不能发送") });
  renderAt("/login", ROUTES);
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("邮箱"), EMAIL);
  await user.click(await screen.findByRole("button", { name: "发送验证码" }));
  assert.ok(await screen.findByText(EMAIL_CODE_UNAVAILABLE_TEXT));
  assert.ok(screen.queryByLabelText("密码"), "提示说用密码登录，页面上却没有密码框（ADR 0050 第 1 节：密码已关闭 + 邮件没配置 = 密码可用）");
});

test("缺陷：从邮件里复制验证码常带一个前导空格：粘贴「 042917」不能被 maxlength 截成「 04291」", async () => {
  const { calls, user } = await toCodeStep({ [VERIFY]: success });
  await user.click(codeInput());
  await user.paste(" 042917");
  await user.click(screen.getByRole("button", { name: "登录" }));
  // 登录成功后页面就跳走了，输入框不一定还在：说明文字里不能用 codeInput()（找不到会抛错，waitFor 就一直重试到超时）
  await waitFor(() => assert.equal(verifies(calls).length, 1, `输入框里是 ${JSON.stringify((screen.queryByLabelText("验证码") as HTMLInputElement | null)?.value)}，被前端判成格式不对`));
  assert.deepEqual(verifies(calls)[0]?.body, { email: EMAIL, code: "042917" });
});

test("缺陷：键盘操作「重新发送」之后按钮进入倒计时被禁用，焦点要回到验证码框，键盘用户不能丢位置", async () => {
  const { calls, user } = await toCodeStep({ [REQUEST]: () => json(202, { expires_in_seconds: 600, resend_after_seconds: 1 }) });
  const ready = await screen.findByRole("button", { name: "重新发送" }, { timeout: 2_000 });
  ready.focus();
  await user.keyboard("{Enter}");
  await waitFor(() => assert.equal(requests(calls).length, 2));
  await screen.findByRole("button", { name: /^重新发送（/ });
  assertFocused(codeInput());
});

test("缺陷：页面打开后密码才被关闭（403）：换成验证码这一步之后不该还留着「改用密码」，点了只会再被弹回来", async () => {
  stubApi({ [METHODS]: both, "POST /tenant/v1/auth/login": () => apiError(403, "PASSWORD_LOGIN_DISABLED", "密码登录已关闭") });
  renderAt("/login", ROUTES);
  const user = userEvent.setup();
  await screen.findByRole("button", { name: SWITCH });
  await user.type(screen.getByLabelText("邮箱"), EMAIL);
  await user.type(screen.getByLabelText("密码"), "Qa-Typed-Password-1");
  await user.click(screen.getByRole("button", { name: "登录" }));
  await screen.findByRole("button", { name: "发送验证码" });
  assertAbsent(screen.queryByRole("button", { name: "改用密码" }));
});

test("粘贴：恰好 6 位、结尾带空格换行的都能直接登录，发给后端的是干净的 6 位", async () => {
  for (const pasted of ["042917", "042917 ", "042917\n"]) {
    const { calls, user } = await toCodeStep({ [VERIFY]: success });
    await user.click(codeInput());
    await user.paste(pasted);
    await user.keyboard("{Enter}");
    await waitFor(() => assert.equal(verifies(calls).length, 1, JSON.stringify(pasted)));
    assert.deepEqual(verifies(calls)[0]?.body, { email: EMAIL, code: "042917" });
    resetBrowser();
  }
});

test("键盘：邮箱框回车发码，验证码框回车登录；Tab 顺序是验证码 → 登录 → 换一个邮箱 → 改用密码，倒计时的按钮被跳过", async () => {
  const calls = stubApi({ [METHODS]: both, [REQUEST]: sentOk, [VERIFY]: success });
  renderAt("/login", ROUTES);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: SWITCH }));
  await user.keyboard(`${EMAIL}{Enter}`);
  await screen.findByLabelText("验证码");
  assert.equal(requests(calls).length, 1);
  assertFocused(codeInput());
  await user.tab();
  assertFocused(screen.getByRole("button", { name: "登录" }));
  await user.tab();
  assertFocused(screen.getByRole("button", { name: "换一个邮箱" }));
  await user.tab();
  assertFocused(screen.getByRole("button", { name: "改用密码" }));
  codeInput().focus();
  await user.keyboard("042917{Enter}");
  await waitFor(() => assert.equal(verifies(calls).length, 1));
});

test("重复提交：回车连按、发码连按都只发一个请求（等应答期间）", async () => {
  let answer: (value: Response) => void = () => undefined;
  const pending = new Promise<Response>((resolve) => {
    answer = resolve;
  });
  const { calls, user } = await toCodeStep({ [VERIFY]: () => pending });
  await user.type(codeInput(), "042917");
  await user.keyboard("{Enter}{Enter}{Enter}");
  await waitFor(() => assert.equal(verifies(calls).length, 1));
  await user.click(screen.getByRole("button", { name: /正在登录|登录/ }));
  assert.equal(verifies(calls).length, 1);
  answer(success());
  await waitFor(() => assert.equal(sessionStore.get("tenant")?.accessToken, "qa-token"));
  resetBrowser();

  let answerSend: (value: Response) => void = () => undefined;
  const pendingSend = new Promise<Response>((resolve) => {
    answerSend = resolve;
  });
  const sendCalls = stubApi({ [METHODS]: both, [REQUEST]: () => pendingSend });
  renderAt("/login", ROUTES);
  const again = userEvent.setup();
  await again.click(await screen.findByRole("button", { name: SWITCH }));
  await again.type(screen.getByLabelText("邮箱"), `${EMAIL}{Enter}{Enter}`);
  await waitFor(() => assert.equal(requests(sendCalls).length, 1));
  answerSend(sentOk());
  await screen.findByLabelText("验证码");
  assert.equal(requests(sendCalls).length, 1);
});

test("错误提示：过期、用尽、用过（后端都是 EMAIL_CODE_INVALID）和 400 都是同一句，不说账号状态；后端的 message 不直接显示", async () => {
  for (const responder of [() => apiError(401, "EMAIL_CODE_INVALID", "后端内部的说法，不应显示"), () => apiError(400, "VALIDATION_FAILED", "后端内部的说法，不应显示")]) {
    const { user } = await toCodeStep({ [VERIFY]: responder });
    await user.type(codeInput(), "000000{Enter}");
    assert.ok(await screen.findByText(EMAIL_CODE_REJECTED_TEXT));
    assertAbsent(screen.queryByText(/后端内部的说法/));
    resetBrowser();
  }
  assert.doesNotMatch(EMAIL_CODE_REJECTED_TEXT, /账号|停用|不存在|激活|次数/);
  assert.match(emailCodeSentText(600, "供应商后台"), /10 分钟/);
  assert.doesNotMatch(emailCodeSentText(600, "供应商后台"), /已发送到|停用|不存在|激活/);
});

test("服务器出错、网络不通：保留已填的验证码（用户不用重新输），不说验证码错了", async () => {
  for (const [responder, text] of [
    [() => apiError(500, "INTERNAL_ERROR", "内部错误"), "系统暂时无法登录，请稍后再试。"],
    [
      () => {
        throw new TypeError("fetch failed");
      },
      /网络/,
    ],
  ] as const) {
    const { user } = await toCodeStep({ [VERIFY]: responder });
    await user.type(codeInput(), "042917{Enter}");
    assert.ok(await screen.findByText(text));
    assert.equal(codeInput().value, "042917");
    assertAbsent(screen.queryByText(EMAIL_CODE_REJECTED_TEXT));
    assert.equal(sessionStore.get("tenant"), null);
    resetBrowser();
  }
});

test("限速：重新发送被 429 时留在这一步，Retry-After 不足一分钟也显示「1 分钟」，不清掉已输入的码", async () => {
  let throttled = false;
  const { calls, user } = await toCodeStep({
    [REQUEST]: () => (throttled ? apiError(429, "TOO_MANY_LOGIN_ATTEMPTS", "太多", {}, { "retry-after": "20" }) : json(202, { expires_in_seconds: 600, resend_after_seconds: 1 })),
  });
  throttled = true;
  const ready = await screen.findByRole("button", { name: "重新发送" }, { timeout: 2_000 });
  await user.type(codeInput(), "0429");
  await user.click(ready);
  assert.ok(await screen.findByText("尝试次数过多，请 1 分钟后再试。"));
  assert.equal(codeInput().value, "0429");
  assert.equal(requests(calls).length, 2);
});

test("第二步重新发送时邮件配置被清空（503）：回到密码表单，邮箱还在，能继续登录", async () => {
  let cleared = false;
  const { user } = await toCodeStep({
    [REQUEST]: () => (cleared ? apiError(503, "EMAIL_CODE_UNAVAILABLE", "现在不能发送") : json(202, { expires_in_seconds: 600, resend_after_seconds: 1 })),
  });
  cleared = true;
  await user.click(await screen.findByRole("button", { name: "重新发送" }, { timeout: 2_000 }));
  assert.ok(await screen.findByText(EMAIL_CODE_UNAVAILABLE_TEXT));
  assert.ok(screen.getByLabelText("密码"));
  assert.equal((screen.getByLabelText("邮箱") as HTMLInputElement).value, EMAIL);
  assertAbsent(screen.queryByLabelText("验证码"));
});

test("发信失败时用户能换回密码：第二步一直有「改用密码」，点了之后密码框可用；切换前填的密码不会带进验证码请求", async () => {
  const calls = stubApi({ [METHODS]: both, [REQUEST]: sentOk, [VERIFY]: success });
  renderAt("/login", ROUTES);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("密码"), "Qa-Typed-Password-1");
  await user.click(await screen.findByRole("button", { name: SWITCH }));
  await user.type(screen.getByLabelText("邮箱"), EMAIL);
  await user.click(screen.getByRole("button", { name: "发送验证码" }));
  await screen.findByLabelText("验证码");
  assert.deepEqual(requests(calls)[0]?.body, { email: EMAIL });
  await user.click(screen.getByRole("button", { name: "改用密码" }));
  const password = screen.getByLabelText("密码") as HTMLInputElement;
  assert.equal(password.value, "", "切换时密码已清掉，不留在内存和页面上");
  assertAbsent(screen.queryByLabelText("验证码"));
});

test("换一个邮箱再发：新邮箱走同一流程，验证码发给新邮箱，不用旧邮箱校验", async () => {
  const { calls, user } = await toCodeStep({ [VERIFY]: success });
  await user.type(codeInput(), "111");
  await user.click(screen.getByRole("button", { name: "换一个邮箱" }));
  const input = screen.getByLabelText("邮箱") as HTMLInputElement;
  await user.clear(input);
  await user.type(input, "qa-other@example.test");
  await user.click(screen.getByRole("button", { name: "发送验证码" }));
  await screen.findByLabelText("验证码");
  assert.equal(codeInput().value, "", "旧的输入没有带过来");
  await user.type(codeInput(), "042917{Enter}");
  await waitFor(() => assert.equal(verifies(calls).length, 1));
  assert.deepEqual(verifies(calls)[0]?.body, { email: "qa-other@example.test", code: "042917" });
});
