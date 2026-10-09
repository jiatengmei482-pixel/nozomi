import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { PASSWORD_ISSUE_MESSAGES } from "@nozomi/domain";
import { Route } from "react-router";
import { apiError, assertAbsent, assertFocused, currentLocation, deferred, json, renderAt, resetBrowser, stubApi } from "../testing/harness.tsx";
import { SetPasswordPage, tokenFromHash } from "./SetPasswordPage.tsx";

afterEach(resetBrowser);

const ROUTES = (
  <>
    <Route path="/accept-invite" element={<SetPasswordPage portal="tenant" kind="invite" />} />
    <Route path="/platform/accept-invite" element={<SetPasswordPage portal="platform" kind="invite" />} />
    <Route path="/reset-password" element={<SetPasswordPage portal="tenant" kind="reset" />} />
    <Route path="/platform/reset-password" element={<SetPasswordPage portal="platform" kind="reset" />} />
  </>
);

const GOOD_PASSWORD = "Tokyo-Haneda-2026";
const describedBy = (element: HTMLElement): string =>
  (element.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join("|");

async function fill(password: string, confirmation: string): Promise<void> {
  const user = userEvent.setup();
  if (password) await user.type(screen.getByLabelText("新密码"), password);
  if (confirmation) await user.type(screen.getByLabelText("再输入一次"), confirmation);
}

async function submit(name: string): Promise<void> {
  await userEvent.setup().click(screen.getByRole("button", { name }));
}

test("令牌从网址 # 后面读；没有、为空、超长都当作链接无效", () => {
  assert.equal(tokenFromHash("#token=abc"), "abc");
  assert.equal(tokenFromHash("#token=a%2Bb"), "a+b");
  assert.equal(tokenFromHash(""), null);
  assert.equal(tokenFromHash("#token="), null);
  assert.equal(tokenFromHash("#other=1"), null);
  assert.equal(tokenFromHash(`#token=${"x".repeat(201)}`), null);
});

test("接受邀请页：标题、规则说明常驻并与输入框关联，两个密码框是 new-password", () => {
  renderAt({ pathname: "/accept-invite", hash: "#token=invite-token" }, ROUTES);
  assert.equal(screen.getByRole("heading", { level: 1 }).textContent, "设置密码");
  assert.equal(document.title, "设置密码 · NOZOMI");
  const password = screen.getByLabelText("新密码") as HTMLInputElement;
  assert.equal(password.type, "password");
  assert.equal(password.autocomplete, "new-password");
  assert.equal(password.required, true);
  assert.match(describedBy(password), /^至少 12 个字符，包含小写字母、大写字母、数字、符号中的至少三类，不能包含邮箱名。$/);
  assert.equal((screen.getByLabelText("再输入一次") as HTMLInputElement).autocomplete, "new-password");
  assert.ok(screen.getByRole("button", { name: "设置密码并继续" }));
  assert.equal(screen.getAllByRole("button", { name: "显示密码" }).length, 2);
});

test("链接里没有令牌：不显示表单，显示「邀请链接已失效」和去登录的按钮", () => {
  renderAt("/platform/accept-invite", ROUTES);
  assert.equal(screen.getByRole("heading", { level: 1 }).textContent, "邀请链接已失效");
  assert.ok(screen.getByText("链接可能已过期或已经使用过。请联系邀请你的管理员重新发送。"));
  assertAbsent(screen.queryByLabelText("新密码"));
  assert.equal(screen.getByRole("link", { name: "去登录" }).getAttribute("href"), "/platform/login");
});

test("新密码失去焦点时校验：逐条写出没满足的规则（文案与后端同一份），规则说明保留", async () => {
  const user = userEvent.setup();
  renderAt({ pathname: "/accept-invite", hash: "#token=t" }, ROUTES);
  const password = screen.getByLabelText("新密码");
  await user.type(password, "abc");
  assertAbsent(screen.queryByText(PASSWORD_ISSUE_MESSAGES.PASSWORD_TOO_SHORT));
  await user.tab();
  assert.ok(screen.getByText(PASSWORD_ISSUE_MESSAGES.PASSWORD_TOO_SHORT));
  assert.ok(screen.getByText(PASSWORD_ISSUE_MESSAGES.PASSWORD_TOO_FEW_CHARACTER_CLASSES));
  assert.ok(screen.getByText(PASSWORD_ISSUE_MESSAGES.PASSWORD_TOO_REPETITIVE));
  assert.equal(password.getAttribute("aria-invalid"), "true");
  assert.match(describedBy(password), /密码至少 12 个字符.*\|至少 12 个字符，包含/);
  await user.type(password, "DEF-2026-xyz");
  assert.equal(password.getAttribute("aria-invalid"), null, "出过错后实时重新校验");
});

test("两次输入不一致：在「再输入一次」失去焦点后提示，之后任一框变化都实时重新比较", async () => {
  const user = userEvent.setup();
  renderAt({ pathname: "/accept-invite", hash: "#token=t" }, ROUTES);
  await fill(GOOD_PASSWORD, "Tokyo");
  assertAbsent(screen.queryByText("两次输入的密码不一致"));
  await user.tab();
  assert.ok(screen.getByText("两次输入的密码不一致"));
  await user.type(screen.getByLabelText("再输入一次"), "-Haneda-2026");
  assertAbsent(screen.queryByText("两次输入的密码不一致"));
  await user.type(screen.getByLabelText("新密码"), "!");
  assert.ok(screen.getByText("两次输入的密码不一致"));
});

test("指针按在提交按钮上时，字段失去焦点不立刻报错（否则出错文字把按钮推走，这次点击会丢）", async () => {
  renderAt({ pathname: "/accept-invite", hash: "#token=t" }, ROUTES);
  const password = screen.getByLabelText("新密码");
  await userEvent.setup().type(password, "abc");
  fireEvent.pointerDown(screen.getByRole("button", { name: "设置密码并继续" }));
  fireEvent.blur(password);
  assert.equal(password.getAttribute("aria-invalid"), null);
  fireEvent.pointerUp(window);
  fireEvent.blur(password);
  assert.equal(password.getAttribute("aria-invalid"), "true");
});

test("空着提交：两个字段各自提示，焦点到第一个出错的字段，不发请求", async () => {
  const calls = stubApi({});
  renderAt({ pathname: "/accept-invite", hash: "#token=t" }, ROUTES);
  await submit("设置密码并继续");
  assert.ok(screen.getByText("请输入新密码"));
  assert.ok(screen.getByText("请再输入一次新密码"));
  assertFocused(screen.getByLabelText("新密码"));
  assert.equal(calls.length, 0);
});

test("提交成功：把令牌和密码发给对应后台的接口，回登录页并带上提示和邮箱", async () => {
  const pending = deferred();
  const calls = stubApi({ "POST /tenant/v1/auth/accept-invite": () => pending.promise });
  renderAt({ pathname: "/accept-invite", hash: "#token=invite-token" }, ROUTES);
  await fill(GOOD_PASSWORD, GOOD_PASSWORD);
  await submit("设置密码并继续");
  const busy = await screen.findByRole("button", { name: "正在设置…" });
  assert.equal(busy.getAttribute("aria-busy"), "true");
  assert.equal((screen.getByLabelText("新密码") as HTMLInputElement).readOnly, true);
  assert.equal((screen.getByLabelText("再输入一次") as HTMLInputElement).readOnly, true);
  pending.resolve(json(200, { user: { email: "invited@example.com" } }));
  await waitFor(() => assert.equal(currentLocation()?.path, "/login"));
  assert.deepEqual(currentLocation()?.state, { reason: "password-set", email: "invited@example.com" });
  assert.deepEqual(calls[0]?.body, { token: "invite-token", password: GOOD_PASSWORD });
  assert.equal("authorization" in (calls[0]?.headers ?? {}), false);
});

test("提交时发现链接已失效：整张卡片换成「邀请链接已失效」，不显示后端原文", async () => {
  stubApi({ "POST /platform/v1/auth/accept-invite": () => apiError(400, "INVITE_INVALID", "邀请链接无效或已过期") });
  renderAt({ pathname: "/platform/accept-invite", hash: "#token=used" }, ROUTES);
  await fill(GOOD_PASSWORD, GOOD_PASSWORD);
  await submit("设置密码并继续");
  assert.equal((await screen.findByRole("heading", { level: 1 })).textContent, "邀请链接已失效");
  assertAbsent(screen.queryByLabelText("新密码"));
});

test("后端拒绝了前端放行的密码：把后端的每条说明显示在「新密码」下方，改密码后消失", async () => {
  stubApi({
    "POST /tenant/v1/auth/accept-invite": () =>
      apiError(400, "WEAK_PASSWORD", "密码强度不够", { issues: [{ code: "PASSWORD_CONTAINS_EMAIL", message: "密码不能包含邮箱名" }] }),
  });
  renderAt({ pathname: "/accept-invite", hash: "#token=t" }, ROUTES);
  await fill(GOOD_PASSWORD, GOOD_PASSWORD);
  await submit("设置密码并继续");
  const password = screen.getByLabelText("新密码");
  await waitFor(() => assert.match(describedBy(password), /^密码不能包含邮箱名\|/));
  assertFocused(password);
  assert.equal((password as HTMLInputElement).value, GOOD_PASSWORD, "保留已填内容");
  await userEvent.setup().type(password, "x");
  assertAbsent(screen.queryByText("密码不能包含邮箱名"));
});

test("提交时网络不通或服务器出错：表单顶部危险提示条，保留已填内容，可以再提交", async () => {
  let failures = 0;
  stubApi({
    "POST /tenant/v1/auth/accept-invite": () => {
      failures += 1;
      if (failures === 1) throw new TypeError("fetch failed");
      return apiError(500, "INTERNAL_ERROR", "服务器内部错误");
    },
  });
  renderAt({ pathname: "/accept-invite", hash: "#token=t" }, ROUTES);
  await fill(GOOD_PASSWORD, GOOD_PASSWORD);
  await submit("设置密码并继续");
  assert.ok((await screen.findByText("网络连接失败，请检查网络后重试。")).closest('[role="alert"]'));
  assert.equal((screen.getByLabelText("新密码") as HTMLInputElement).value, GOOD_PASSWORD);
  await submit("设置密码并继续");
  assert.ok(await screen.findByText("系统暂时无法设置密码，请稍后再试。"));
});

test("重设密码页：文案换成重设密码，调重置接口，失效时显示「重置链接已失效」", async () => {
  const calls = stubApi({ "POST /platform/v1/auth/reset-password": () => json(200, { user: { email: "staff@example.com" } }) });
  renderAt({ pathname: "/platform/reset-password", hash: "#token=reset-token" }, ROUTES);
  assert.equal(screen.getByRole("heading", { level: 1 }).textContent, "重设密码");
  assert.equal(document.title, "重设密码 · NOZOMI");
  await fill(GOOD_PASSWORD, GOOD_PASSWORD);
  await submit("设置新密码并继续");
  await waitFor(() => assert.equal(currentLocation()?.path, "/platform/login"));
  assert.deepEqual(currentLocation()?.state, { reason: "password-reset", email: "staff@example.com" });
  assert.deepEqual(calls[0]?.body, { token: "reset-token", password: GOOD_PASSWORD });
  resetBrowser();

  stubApi({ "POST /tenant/v1/auth/reset-password": () => apiError(400, "RESET_TOKEN_INVALID", "重置链接无效或已过期，请联系管理员重新发起") });
  renderAt({ pathname: "/reset-password", hash: "#token=old" }, ROUTES);
  await fill(GOOD_PASSWORD, GOOD_PASSWORD);
  await submit("设置新密码并继续");
  assert.equal((await screen.findByRole("heading", { level: 1 })).textContent, "重置链接已失效");
  assert.equal(screen.getByRole("link", { name: "去登录" }).getAttribute("href"), "/login");
});
