/**
 * 测试角色补充（M1-13）：设密码页打开时先核对链接。`SetPasswordPage.test.tsx` 已有的不重复；这里补：
 * 重试后才发现失效、限速 / 校验失败不说成「已失效」、核对通过后设密码成功的完整一轮请求顺序、
 * 各个状态下令牌都不出现在标题、存储、页面文字和属性里，核对请求不把令牌放进网址或请求头。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Route } from "react-router";
import { type ApiCall, apiError, assertAbsent, currentLocation, deferred, json, renderAt, resetBrowser, stubApi } from "../testing/harness.tsx";
import { SetPasswordPage } from "./SetPasswordPage.tsx";

afterEach(resetBrowser);

const ROUTES = (
  <>
    <Route path="/accept-invite" element={<SetPasswordPage portal="tenant" kind="invite" />} />
    <Route path="/platform/accept-invite" element={<SetPasswordPage portal="platform" kind="invite" />} />
    <Route path="/reset-password" element={<SetPasswordPage portal="tenant" kind="reset" />} />
    <Route path="/platform/reset-password" element={<SetPasswordPage portal="platform" kind="reset" />} />
  </>
);

const TOKEN = "nzi_QA-secret-token-0123456789abcdefghijklmn";
const GOOD_PASSWORD = "Tokyo-Haneda-2026";
const noContent = (): Response => new Response(null, { status: 204 });

/** 令牌不在标题、存储、页面文字、任何属性值或输入框的值里。 */
function assertNoTokenOnPage(token: string, when: string): void {
  assert.ok(!document.title.includes(token), `${when}：标题里有令牌`);
  for (const storage of [localStorage, sessionStorage]) {
    for (const key of Object.keys(storage)) assert.ok(!key.includes(token) && !(storage.getItem(key) ?? "").includes(token), `${when}：存储里有令牌`);
  }
  assert.ok(!(document.body.textContent ?? "").includes(token), `${when}：页面文字里有令牌`);
  for (const node of document.body.querySelectorAll("*")) {
    for (const attribute of node.attributes) assert.ok(!attribute.value.includes(token), `${when}：<${node.tagName}> 的 ${attribute.name} 里有令牌`);
    const value = (node as HTMLInputElement).value;
    if (typeof value === "string") assert.ok(!value.includes(token), `${when}：<${node.tagName}> 的值里有令牌`);
  }
}

function assertCheckRequestClean(call: ApiCall | undefined, path: string): void {
  assert.ok(call !== undefined);
  assert.equal(call.method, "POST");
  assert.equal(call.path, path, "令牌不在网址里");
  assert.deepEqual(call.body, { token: TOKEN });
  assert.ok(!JSON.stringify(call.headers).includes(TOKEN), "令牌不在请求头里");
}

test("核对时网络不通 → 重试 → 这回服务器说链接已失效：显示「邀请链接已失效」，不显示表单", async () => {
  let attempts = 0;
  const calls = stubApi({
    "POST /platform/v1/auth/check-invite": () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError("fetch failed");
      return apiError(400, "INVITE_INVALID", "后端原文");
    },
  });
  renderAt({ pathname: "/platform/accept-invite", hash: `#token=${TOKEN}` }, ROUTES);
  assert.equal((await screen.findByRole("heading", { level: 1 })).textContent, "加载失败");
  assertNoTokenOnPage(TOKEN, "加载失败");
  await userEvent.setup().click(screen.getByRole("button", { name: "重试" }));
  assert.equal((await screen.findByRole("heading", { level: 1, name: "邀请链接已失效" })).textContent, "邀请链接已失效");
  assertAbsent(screen.queryByLabelText("新密码"));
  assertAbsent(screen.queryByRole("button", { name: "重试" }));
  assertNoTokenOnPage(TOKEN, "已失效");
  assert.equal(calls.length, 2);
  for (const call of calls) assertCheckRequestClean(call, "/platform/v1/auth/check-invite");
});

for (const [status, code] of [
  [429, "RATE_LIMITED"],
  [400, "VALIDATION_FAILED"],
  [400, "RESET_TOKEN_INVALID"],
  [503, "SERVICE_UNAVAILABLE"],
] as const) {
  test(`邀请页核对时收到 ${status} ${code}：不是「邀请链接已失效」，而是「加载失败」可以重试`, async () => {
    stubApi({ "POST /tenant/v1/auth/check-invite": () => apiError(status, code, "原文", {}, status === 429 ? { "retry-after": "30" } : {}) });
    renderAt({ pathname: "/accept-invite", hash: `#token=${TOKEN}` }, ROUTES);
    assert.equal((await screen.findByRole("heading", { level: 1 })).textContent, "加载失败");
    assertAbsent(screen.queryByText("邀请链接已失效"));
    assertAbsent(screen.queryByLabelText("新密码"));
    assert.ok(screen.getByRole("button", { name: "重试" }));
  });
}

for (const [pathname, portal, kind, setPath, submit] of [
  ["/accept-invite", "tenant", "check-invite", "accept-invite", "设置密码并继续"],
  ["/platform/reset-password", "platform", "check-reset-token", "reset-password", "设置新密码并继续"],
] as const) {
  test(`${pathname}：核对通过后才出表单，填好提交，先核对、再设密码各一次，回登录页；全程令牌不在页面、标题、存储里`, async () => {
    const check = deferred();
    const calls = stubApi({
      [`POST /${portal}/v1/auth/${kind}`]: () => check.promise,
      [`POST /${portal}/v1/auth/${setPath}`]: () =>
        json(200, { user: { id: "u1", email: "sato@example.com", name: "佐藤", role: "dispatch", status: "active", created_at: "2026-10-06T00:00:00Z", updated_at: "2026-10-06T00:00:00Z" } }),
    });
    renderAt({ pathname, hash: `#token=${TOKEN}` }, ROUTES);
    assert.equal(screen.getByRole("status").textContent, "正在核对链接");
    assertAbsent(screen.queryByLabelText("新密码"));
    assertNoTokenOnPage(TOKEN, "核对中");
    check.resolve(noContent());
    const actor = userEvent.setup();
    await actor.type(await screen.findByLabelText("新密码"), GOOD_PASSWORD);
    await actor.type(screen.getByLabelText("再输入一次"), GOOD_PASSWORD);
    assertNoTokenOnPage(TOKEN, "表单");
    await actor.click(screen.getByRole("button", { name: submit }));
    await screen.findByTestId("location");
    assert.equal(currentLocation()?.path, portal === "platform" ? "/platform/login" : "/login");
    assert.deepEqual(
      calls.map((call) => call.path),
      [`/${portal}/v1/auth/${kind}`, `/${portal}/v1/auth/${setPath}`],
      "核对一次、设密码一次，没有多余请求",
    );
    assertCheckRequestClean(calls[0], `/${portal}/v1/auth/${kind}`);
    assert.deepEqual(calls[1]?.body, { token: TOKEN, password: GOOD_PASSWORD });
    assert.ok(!JSON.stringify(currentLocation()?.state ?? null).includes(TOKEN), "跳转带的 state 里没有令牌");
    assertNoTokenOnPage(TOKEN, "跳转后");
  });
}

test("核对还没回来就离开页面：迟到的结果不会让页面出错或再发请求", async () => {
  const check = deferred();
  const calls = stubApi({ "POST /tenant/v1/auth/check-reset-token": () => check.promise });
  const view = renderAt({ pathname: "/reset-password", hash: `#token=${TOKEN}` }, ROUTES);
  view.unmount();
  check.resolve(apiError(400, "RESET_TOKEN_INVALID", "原文"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls.length, 1);
});
