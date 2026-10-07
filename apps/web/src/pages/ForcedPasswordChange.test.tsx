/** 临时密码与强制修改密码（ADR 0013）的组件测试，接口用测试替身。 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Outlet, Route } from "react-router";
import { ApiError } from "../api/client.ts";
import { PortalSession, usePortalSession } from "../auth/PortalSession.tsx";
import { sessionStore } from "../auth/session-store.ts";
import { FAR_FUTURE, apiError, assertAbsent, assertFocused, deferred, json, renderAt, resetBrowser, signIn, stubApi } from "../testing/harness.tsx";
import { ChangePasswordPage } from "./ChangePasswordPage.tsx";
import { HomePage } from "./HomePage.tsx";
import { LoginPage } from "./LoginPage.tsx";
import { NotFoundPage } from "./NotFoundPage.tsx";

afterEach(resetBrowser);

/** 一个会去调「别的接口」的页面：把失败交给登录状态处理，处理不了才显示成没有权限。 */
function OtherPage() {
  const { handleAuthFailure } = usePortalSession();
  return (
    <button
      type="button"
      onClick={() => {
        const handled = handleAuthFailure(new ApiError(403, "PASSWORD_CHANGE_REQUIRED", "请先修改密码，再继续使用", {}, null));
        if (!handled) document.title = "没有权限";
      }}
    >
      调别的接口
    </button>
  );
}

function portal(key: "tenant" | "platform", base: string) {
  return (
    <>
      <Route path={`${base}/login`} element={<LoginPage key={key} portal={key} />} />
      <Route
        element={
          <PortalSession portal={key}>
            <Outlet />
          </PortalSession>
        }
      >
        <Route path={base === "" ? "/" : base} element={<HomePage />} />
        <Route path={`${base}/account/password`} element={<ChangePasswordPage />} />
        <Route path={`${base}/other`} element={<OtherPage />} />
        <Route path={`${base}/*`} element={<NotFoundPage />} />
      </Route>
    </>
  );
}

const ROUTES = (
  <>
    {portal("platform", "/platform")}
    {portal("tenant", "")}
  </>
);

const stamps = { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" };
const platformMe = (mustChange: boolean) => () =>
  json(200, {
    user: { id: "p1", email: "owner@platform.example", name: "测试负责人", role: "super_admin", status: "active", ...stamps },
    permissions: [],
    must_change_password: mustChange,
  });
const tenantMe = (mustChange: boolean) => () =>
  json(200, {
    user: { id: "u1", email: "admin@supplier.example", name: "测试租户管理员", role: "admin", status: "active", ...stamps },
    tenant: { id: "t1", name: "测试用供应商", status: "active", ...stamps },
    permissions: [],
    must_change_password: mustChange,
  });

const WARNING = "你正在使用临时密码，请先设置新密码。设置完成前不能使用其他功能。";
const TEMPORARY = "aB3de-Fg4hJ-k5LmN-6pQrS";
const NEW_PASSWORD = "Osaka-Castle-2026";

async function fillAndSave(current: string, next: string): Promise<void> {
  const user = userEvent.setup();
  if (current) await user.type(screen.getByLabelText("临时密码"), current);
  if (next) {
    await user.type(screen.getByLabelText("新密码"), next);
    await user.type(screen.getByLabelText("再输入一次新密码"), next);
  }
  await user.click(screen.getByRole("button", { name: "保存新密码" }));
}

test("用临时密码登录：不管原来想去哪，直接进修改密码页；令牌照常存下", async () => {
  for (const [key, loginPath, target] of [
    ["platform", "/platform/login", "/platform/account/password"],
    ["tenant", "/login", "/account/password"],
  ] as const) {
    stubApi({
      [`POST /${key}/v1/auth/login`]: () => json(200, { access_token: "temp-session", token_type: "Bearer", expires_at: FAR_FUTURE, user: {}, must_change_password: true }),
      [`GET /${key}/v1/auth/me`]: key === "platform" ? platformMe(true) : tenantMe(true),
    });
    renderAt({ pathname: loginPath, state: { from: key === "platform" ? "/platform" : "/" } }, ROUTES);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("邮箱"), "owner@platform.example");
    await user.type(screen.getByLabelText("密码"), TEMPORARY);
    await user.click(screen.getByRole("button", { name: "登录" }));
    assert.ok(await screen.findByText(WARNING), key);
    assert.equal(screen.getByRole("heading", { level: 1 }).textContent, "设置新密码");
    assert.equal(sessionStore.get(key)?.accessToken, "temp-session");
    assertAbsent(document.querySelector('nav[aria-label="主菜单"]'));
    assert.ok(target);
    resetBrowser();
  }
});

test("必须先改密码时：本后台的首页、不存在的页面都带回修改密码页；说明在提示条里，「当前密码」改叫「临时密码」", async () => {
  for (const start of ["/platform", "/platform/no-such-page", "/platform/account/password"]) {
    signIn("platform");
    stubApi({ "GET /platform/v1/auth/me": platformMe(true) });
    renderAt(start, ROUTES);
    const warning = await screen.findByText(WARNING);
    assert.ok(warning.closest('[role="alert"]'), start);
    assert.ok(warning.closest(".alert--warning"));
    assert.equal(screen.getByRole("heading", { level: 1 }).textContent, "设置新密码");
    assert.ok(screen.getByLabelText("临时密码"));
    assertAbsent(screen.queryByLabelText("当前密码"));
    assertAbsent(screen.queryByText("找不到这个页面"));
    resetBrowser();
  }
});

test("必须先改密码时：没有侧边栏和菜单按钮，账号菜单里只有「退出登录」，顶栏仍写明是哪个后台", async () => {
  signIn("tenant", "temp-session");
  const calls = stubApi({ "GET /tenant/v1/auth/me": tenantMe(true), "POST /tenant/v1/auth/logout": () => new Response(null, { status: 204 }) });
  const user = userEvent.setup();
  renderAt("/", ROUTES);
  await screen.findByText(WARNING);
  assertAbsent(document.querySelector('nav[aria-label="主菜单"]'));
  assertAbsent(document.querySelector(".sidebar"));
  assertAbsent(screen.queryByRole("button", { name: "打开菜单" }));
  assertAbsent(screen.queryByRole("link", { name: "首页" }));
  assert.equal(document.querySelector(".topbar__brand")?.textContent, "NOZOMI供应商后台");
  assert.equal(document.querySelectorAll("main").length, 1);
  assert.ok(screen.getByRole("button", { name: "切换主题" }));

  await user.click(screen.getByRole("button", { name: /账号菜单/ }));
  assert.deepEqual(within(screen.getByRole("menu")).getAllByRole("menuitem").map((item) => item.textContent), ["退出登录"]);
  await user.click(screen.getByRole("menuitem", { name: "退出登录" }));
  assert.ok(await screen.findByText("已退出登录。"));
  assert.ok(screen.getByLabelText("邮箱"), "回到登录页");
  assert.equal(calls.find((call) => call.path.endsWith("/logout"))?.headers["authorization"], "Bearer temp-session");
  assert.equal(sessionStore.get("tenant"), null);
});

test("改掉临时密码：提交临时密码和新密码，成功后直接进首页、不用重新登录，导航恢复并提示新密码已生效", async () => {
  signIn("platform", "temp-session");
  const calls = stubApi({ "GET /platform/v1/auth/me": platformMe(true), "POST /platform/v1/auth/change-password": () => new Response(null, { status: 204 }) });
  renderAt("/platform/account/password", ROUTES);
  await screen.findByText(WARNING);
  await fillAndSave(TEMPORARY, NEW_PASSWORD);
  assert.ok(await screen.findByRole("heading", { level: 1, name: "首页" }));
  assert.ok(screen.getByText("新密码已生效，临时密码已作废。").closest('[role="status"]'));
  const call = calls.find((entry) => entry.method === "POST");
  assert.deepEqual(call?.body, { current_password: TEMPORARY, new_password: NEW_PASSWORD });
  assert.equal(call?.headers["authorization"], "Bearer temp-session");
  assert.equal(sessionStore.get("platform")?.accessToken, "temp-session", "当前令牌继续用");
  assert.equal(calls.filter((entry) => entry.path.endsWith("/login")).length, 0);
  assert.ok(document.querySelector('.sidebar--pinned nav[aria-label="主菜单"]'));
  assertAbsent(screen.queryByText(WARNING));
  await userEvent.setup().click(screen.getByRole("button", { name: /账号菜单/ }));
  assert.deepEqual(within(screen.getByRole("menu")).getAllByRole("menuitem").map((item) => item.textContent), ["修改密码", "退出登录"]);

});

test("临时密码填错、新密码与临时密码相同、空着提交：出错文字都说「临时密码」，仍留在修改密码页", async () => {
  const cases: [Response | null, string, string, string, string][] = [
    [null, "", NEW_PASSWORD, "临时密码", "请输入临时密码"],
    [apiError(400, "CURRENT_PASSWORD_INCORRECT", "当前密码不正确"), "wrong-temporary", NEW_PASSWORD, "临时密码", "临时密码不正确，请重新输入"],
    [apiError(400, "PASSWORD_UNCHANGED", "新密码不能和当前密码相同"), TEMPORARY, TEMPORARY, "新密码", "新密码不能和临时密码相同"],
  ];
  for (const [response, current, next, field, message] of cases) {
    signIn("platform");
    stubApi({ "GET /platform/v1/auth/me": platformMe(true), ...(response ? { "POST /platform/v1/auth/change-password": () => response } : {}) });
    renderAt("/platform/account/password", ROUTES);
    await screen.findByText(WARNING);
    await fillAndSave(current, next);
    await screen.findByText(message);
    assertFocused(screen.getByLabelText(field));
    assert.ok(screen.getByText(WARNING), "还没改成功，说明和限制都还在");
    assertAbsent(document.querySelector('nav[aria-label="主菜单"]'));
    resetBrowser();
  }
});

test("刚用临时密码登录带来的提示只是提示：auth/me 回来之前先不显示导航；auth/me 说不需要改，就按正常页面显示", async () => {
  signIn("platform");
  const pending = deferred();
  stubApi({ "GET /platform/v1/auth/me": () => pending.promise });
  renderAt({ pathname: "/platform/account/password", state: { passwordChangeRequired: true } }, ROUTES);
  assert.ok(screen.getByText(WARNING));
  assertAbsent(document.querySelector('nav[aria-label="主菜单"]'));
  pending.resolve(await platformMe(false)());
  await screen.findByLabelText("当前密码");
  assertAbsent(screen.queryByText(WARNING));
  assert.ok(document.querySelector('.sidebar--pinned nav[aria-label="主菜单"]'));
});

test("不需要改密码的账号一切照旧：首页有导航，修改密码页写「当前密码」，没有临时密码的说明", async () => {
  signIn("tenant");
  stubApi({ "GET /tenant/v1/auth/me": tenantMe(false) });
  renderAt("/account/password", ROUTES);
  await screen.findByRole("button", { name: /账号菜单：\s*测试租户管理员/ });
  assert.ok(screen.getByLabelText("当前密码"));
  assertAbsent(screen.queryByText(WARNING));
  assert.ok(document.querySelector('.sidebar--pinned nav[aria-label="主菜单"]'));
});

test("别的接口返回 403 PASSWORD_CHANGE_REQUIRED（标记在别处被重新置上）：带到修改密码页，不显示成没有权限", async () => {
  signIn("platform");
  stubApi({ "GET /platform/v1/auth/me": platformMe(false) });
  renderAt("/platform/other", ROUTES);
  await userEvent.setup().click(screen.getByRole("button", { name: "调别的接口" }));
  assert.ok(await screen.findByText(WARNING));
  assert.equal(screen.getByRole("heading", { level: 1 }).textContent, "设置新密码");
  assert.ok(screen.getByLabelText("临时密码"));
  assert.notEqual(document.title, "没有权限");
  assert.ok(sessionStore.get("platform"), "不是 401，不退出登录");
});

test("一个后台必须改密码，不影响另一个后台", async () => {
  signIn("platform");
  signIn("tenant");
  stubApi({ "GET /platform/v1/auth/me": platformMe(true), "GET /tenant/v1/auth/me": tenantMe(false) });
  renderAt("/", ROUTES);
  await screen.findByText("测试用供应商");
  assert.equal(screen.getByRole("heading", { level: 1 }).textContent, "首页");
  assertAbsent(screen.queryByText(WARNING));
});
