/** 运营后台登录的第二步、个人页「账号安全」、角色编辑的勾选（ADR 0030）的组件测试，接口用测试替身。 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Outlet, Route } from "react-router";
import { ApiError } from "../api/client.ts";
import { PortalSession, usePortalSession } from "../auth/PortalSession.tsx";
import { FAR_FUTURE, type ApiCall, apiError, assertAbsent, json, renderAt, resetBrowser, signIn, stubApi, stubApiWith } from "../testing/harness.tsx";
import { ChangePasswordPage } from "./ChangePasswordPage.tsx";
import { LoginPage } from "./LoginPage.tsx";
import { AccountSecurityPage, RoleEditorPage } from "./platform/SecurityPages.tsx";

afterEach(resetBrowser);

function Target() {
  const { handleAuthFailure } = usePortalSession();
  return (
    <>
      <p>要去的页面</p>
      <button type="button" onClick={() => handleAuthFailure(new ApiError(403, "MFA_REQUIRED", "请先输入两步验证的动态码，再继续使用", { status: "verify_required" }, null))}>
        调别的接口
      </button>
    </>
  );
}

const ROUTES = (
  <>
    <Route path="/platform/login" element={<LoginPage portal="platform" />} />
    <Route
      element={
        <PortalSession portal="platform">
          <Outlet />
        </PortalSession>
      }
    >
      <Route path="/platform/target" element={<Target />} />
      <Route path="/platform/account/password" element={<ChangePasswordPage />} />
      <Route path="/platform/account/security" element={<AccountSecurityPage />} />
      <Route path="/platform/settings/roles/new" element={<RoleEditorPage key="new" />} />
    </Route>
  </>
);

const stamps = { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" };
const user = { id: "p1", email: "owner@platform.example", name: "测试负责人", role: "super_admin", role_name: "超级管理员", status: "active", ...stamps };
const me = (status: string, extra: Record<string, unknown> = {}) => () =>
  json(200, { user, permissions: [], data_scope: { city_ids: null, channel_ids: null }, must_change_password: false, second_factor: { status, enabled_at: status === "enrollment_required" ? null : "2026-10-01T00:00:00.000Z", recovery_codes_remaining: status === "verified" ? 10 : null }, ...extra });
const loginWith = (status: string, mustChange = false) => () => json(200, { access_token: "pending-token", token_type: "Bearer", expires_at: FAR_FUTURE, user, must_change_password: mustChange, second_factor: { status } });
const CODES = Array.from({ length: 10 }, (_, i) => `abcd-efgh-jkmn-pq${String.fromCharCode(97 + i)}${String.fromCharCode(98 + i)}`);
const verified = (method = "totp", remaining = 10) => json(200, { user, must_change_password: false, second_factor: { status: "verified", method, recovery_codes_remaining: remaining } });

async function passwordLogin(): Promise<void> {
  const actor = userEvent.setup();
  await actor.type(screen.getByLabelText("邮箱"), "owner@platform.example");
  await actor.type(screen.getByLabelText("密码"), "Quiet-Harbor-2026");
  await actor.click(screen.getByRole("button", { name: "登录" }));
}

test("绑定过的账号：输完密码不进要去的页面，先输动态码；只认 6 位数字；输错有说明、清空重输；对了才进去", async () => {
  let attempts = 0;
  const calls = stubApi({
    "POST /platform/v1/auth/login": loginWith("verify_required"),
    "GET /platform/v1/auth/me": () => (attempts >= 2 ? me("verified")() : me("verify_required")()),
    "POST /platform/v1/auth/mfa/verify": () => {
      attempts += 1;
      return attempts === 1 ? apiError(400, "MFA_CODE_INVALID", "动态码或恢复码不正确") : verified();
    },
  });
  renderAt({ pathname: "/platform/login", state: { from: "/platform/target" } }, ROUTES);
  await passwordLogin();
  assert.equal((await screen.findByRole("heading", { level: 1 })).textContent, "两步验证");
  assertAbsent(screen.queryByText("要去的页面"));
  const actor = userEvent.setup();
  const input = screen.getByLabelText("动态码") as HTMLInputElement;
  await actor.type(input, "12a 34");
  assert.equal(input.value, "1234", "只留数字");
  await actor.click(screen.getByRole("button", { name: "验证" }));
  assert.ok(await screen.findByText("请输入验证器上显示的 6 位数字"));
  assert.ok(!calls.some((call: ApiCall) => call.path.endsWith("/mfa/verify")), "格式不对不发请求");
  await actor.type(input, "56");
  await actor.click(screen.getByRole("button", { name: "验证" }));
  assert.ok(await screen.findByText(/动态码或恢复码不对/));
  assert.equal(input.value, "");
  await actor.type(input, "654321");
  await actor.click(screen.getByRole("button", { name: "验证" }));
  assert.ok(await screen.findByText("要去的页面"));
  const sent = calls.filter((call: ApiCall) => call.path.endsWith("/mfa/verify")).map((call) => call.body);
  assert.deepEqual(sent, [{ code: "123456" }, { code: "654321" }]);
  assert.equal(calls.find((call) => call.path.endsWith("/mfa/verify"))?.headers["authorization"], "Bearer pending-token");
});

test("用恢复码登录：切换后输入恢复码；剩得不多时先提醒再进去", async () => {
  stubApi({
    "POST /platform/v1/auth/login": loginWith("verify_required"),
    "GET /platform/v1/auth/me": me("verify_required"),
    "POST /platform/v1/auth/mfa/verify": (call) => {
      assert.deepEqual(call.body, { recovery_code: "abcd-efgh-jkmn-pqrs" });
      return verified("recovery_code", 2);
    },
  });
  renderAt({ pathname: "/platform/login", state: { from: "/platform/target" } }, ROUTES);
  await passwordLogin();
  const actor = userEvent.setup();
  await actor.click(await screen.findByRole("button", { name: "手机不在身边？用恢复码" }));
  await actor.type(screen.getByLabelText("恢复码"), "abcd-efgh-jkmn-pqrs");
  await actor.click(screen.getByRole("button", { name: "验证" }));
  assert.ok(await screen.findByText("恢复码只剩 2 个了。"));
  stubApi({ "GET /platform/v1/auth/me": me("verified") });
  await actor.click(screen.getByRole("button", { name: "知道了，继续" }));
  assert.ok(await screen.findByText("要去的页面"));
});

test("没绑定过的账号：先绑定——二维码和密钥、输一次动态码；恢复码只显示一次，勾选「已存好」才能继续；必须先改密码的接着去改密码", async () => {
  const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
  stubApi({
    "POST /platform/v1/auth/login": loginWith("enrollment_required", true),
    "GET /platform/v1/auth/me": me("enrollment_required", { must_change_password: true }),
    "POST /platform/v1/auth/mfa/enrollment": () => json(200, { secret, otpauth_uri: `otpauth://totp/NOZOMI:owner%40platform.example?secret=${secret}&issuer=NOZOMI`, expires_at: FAR_FUTURE }),
    "POST /platform/v1/auth/mfa/enrollment/confirm": (call) => {
      assert.deepEqual(call.body, { code: "123456" });
      return json(200, { user, must_change_password: true, second_factor: { status: "verified", method: "enrollment", recovery_codes_remaining: 10 }, recovery_codes: CODES });
    },
  });
  renderAt({ pathname: "/platform/login", state: { from: "/platform/target" } }, ROUTES);
  await passwordLogin();
  assert.equal((await screen.findByRole("heading", { level: 1 })).textContent, "绑定两步验证");
  assert.ok(await screen.findByRole("img", { name: "绑定两步验证的二维码" }));
  assert.ok(screen.getByText("JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP"));
  const actor = userEvent.setup();
  await actor.type(screen.getByLabelText("动态码"), "123456");
  await actor.click(screen.getByRole("button", { name: "完成绑定" }));
  const list = await screen.findByRole("list", { name: "恢复码" });
  assert.equal(within(list).getAllByRole("listitem").length, 10);
  const next = screen.getByRole("button", { name: "继续" }) as HTMLButtonElement;
  assert.equal(next.disabled, true);
  await actor.click(screen.getByLabelText("我已经把恢复码存好了"));
  stubApi({ "GET /platform/v1/auth/me": me("verified", { must_change_password: true }) });
  await actor.click(next);
  await waitFor(() => assert.equal(screen.getByRole("heading", { level: 1 }).textContent, "设置新密码"));
});

test("已经在里面的页面上，接口返回 403 MFA_REQUIRED：回到两步验证页（地址不变）", async () => {
  signIn("platform");
  stubApi({ "GET /platform/v1/auth/me": me("verified") });
  renderAt("/platform/target", ROUTES);
  const actor = userEvent.setup();
  await actor.click(await screen.findByRole("button", { name: "调别的接口" }));
  assert.equal((await screen.findByRole("heading", { level: 1 })).textContent, "两步验证");
});

test("账号安全：显示绑定时间和剩余恢复码；重新生成恢复码要先输入现在的动态码，新的一组只显示一次", async () => {
  signIn("platform");
  stubApi({
    "GET /platform/v1/auth/me": me("verified"),
    "POST /platform/v1/auth/mfa/recovery-codes": (call) => {
      assert.deepEqual(call.body, { code: "111222" });
      return json(200, { recovery_codes: CODES });
    },
  });
  renderAt("/platform/account/security", ROUTES);
  assert.ok(await screen.findByText("10 个"));
  const actor = userEvent.setup();
  await actor.click(screen.getByRole("button", { name: "重新生成恢复码" }));
  const dialog = await screen.findByRole("dialog");
  await actor.type(within(dialog).getByLabelText("动态码"), "111222");
  await actor.click(within(dialog).getByRole("button", { name: "确认" }));
  const list = await screen.findByRole("list", { name: "恢复码" });
  assert.equal(within(list).getAllByRole("listitem").length, 10);
});

test("新建角色：勾「编辑」自动带上「查看」，去掉「查看」整行清空；只归超级管理员的格子勾不了；提交的是勾选的「菜单:操作」", async () => {
  signIn("platform");
  const created: unknown[] = [];
  stubApiWith((call) => {
    const at = `${call.method} ${call.url.pathname}`;
    if (at === "GET /platform/v1/auth/me") return me("verified")();
    if (at === "GET /platform/v1/master/cities" || at === "GET /platform/v1/channels") return json(200, { items: [], next_cursor: null, total: 0 });
    if (at === "POST /platform/v1/roles") {
      created.push(call.body);
      return apiError(409, "ROLE_NAME_TAKEN", "已经有同名的角色");
    }
    return null;
  });
  renderAt("/platform/settings/roles/new", ROUTES);
  const actor = userEvent.setup();
  await actor.type(await screen.findByLabelText("名字"), "渠道观察员");
  await actor.click(screen.getByLabelText("渠道 · 编辑"));
  assert.equal((screen.getByLabelText("渠道 · 查看") as HTMLInputElement).checked, true);
  await actor.click(screen.getByLabelText("订单 · 查看"));
  await actor.click(screen.getByLabelText("渠道 · 查看"));
  assert.equal((screen.getByLabelText("渠道 · 编辑") as HTMLInputElement).checked, false);
  assertAbsent(screen.queryByLabelText("平台账号 · 编辑"));
  await actor.click(screen.getByRole("button", { name: "新建" }));
  assert.ok(await screen.findByText("已经有同名的角色了，换个名字。"));
  assert.deepEqual(created, [{ name: "渠道观察员", description: null, grants: ["orders:view"], data_scope: { city_ids: null, channel_ids: null }, ip_allowlist: [] }]);
});
