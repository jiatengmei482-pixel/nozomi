/**
 * 测试角色补充（M4-05，ADR 0030）：恢复码、密钥「只显示一次」——不进浏览器存储、不进地址和路由状态，页面重新打开后不再出现。
 * 接口用测试替身。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { cleanup, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Outlet, Route, useLocation } from "react-router";
import { PortalSession } from "../auth/PortalSession.tsx";
import { FAR_FUTURE, assertAbsent, json, renderAt, resetBrowser, signIn, stubApi } from "../testing/harness.tsx";
import { LoginPage } from "./LoginPage.tsx";
import { AccountSecurityPage } from "./platform/SecurityPages.tsx";

afterEach(resetBrowser);

const seen: { pathname: string; search: string; hash: string; state: unknown }[] = [];

function Recorder() {
  const location = useLocation();
  seen.push({ pathname: location.pathname, search: location.search, hash: location.hash, state: location.state });
  return <Outlet />;
}

function Target() {
  return <p>要去的页面</p>;
}

const ROUTES = (
  <Route element={<Recorder />}>
    <Route path="/platform/login" element={<LoginPage portal="platform" />} />
    <Route
      element={
        <PortalSession portal="platform">
          <Outlet />
        </PortalSession>
      }
    >
      <Route path="/platform/target" element={<Target />} />
      <Route path="/platform/account/security" element={<AccountSecurityPage />} />
    </Route>
  </Route>
);

const stamps = { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" };
const user = { id: "p1", email: "owner@platform.example", name: "测试负责人", role: "super_admin", role_name: "超级管理员", status: "active", ...stamps };
const me = (status: string) => () =>
  json(200, { user, permissions: [], data_scope: { city_ids: null, channel_ids: null }, must_change_password: false, second_factor: { status, enabled_at: status === "enrollment_required" ? null : "2026-10-01T00:00:00.000Z", recovery_codes_remaining: status === "verified" ? 10 : null } });
const SECRET = "KRUGS4ZAONSWG4TFOQQGC3TEEBZXK4TF";
const CODES = Array.from({ length: 10 }, (_, i) => `wxyz-${"23456789"[i % 8]}${"abcdefgh"[i % 8]}hk-mnpq-rs${String.fromCharCode(116 + (i % 6))}${String.fromCharCode(97 + i)}`);

/** 浏览器里留下的一切：两种存储、cookie、地址、路由走过的每一个地址和状态。 */
function traces(): string {
  const dump = (store: Storage): Record<string, string | null> => Object.fromEntries(Array.from({ length: store.length }, (_, i) => store.key(i) as string).map((key) => [key, store.getItem(key)]));
  return JSON.stringify({ local: dump(localStorage), session: dump(sessionStorage), cookie: document.cookie, href: window.location.href, history: window.history.state, seen });
}

function assertNoSecrets(text: string): void {
  assert.ok(!text.includes(SECRET), "密钥原文");
  assert.ok(!text.includes("otpauth"), "otpauth 链接");
  for (const code of CODES) assert.ok(!text.includes(code) && !text.includes(code.replace(/-/g, "")), `恢复码 ${code}`);
}

test("绑定：密钥和恢复码不进存储、地址、路由状态；离开后再打开不再出现", async () => {
  seen.length = 0;
  stubApi({
    "POST /platform/v1/auth/login": () => json(200, { access_token: "pending-token", token_type: "Bearer", expires_at: FAR_FUTURE, user, must_change_password: false, second_factor: { status: "enrollment_required" } }),
    "GET /platform/v1/auth/me": me("enrollment_required"),
    "POST /platform/v1/auth/mfa/enrollment": () => json(200, { secret: SECRET, otpauth_uri: `otpauth://totp/NOZOMI:owner%40platform.example?secret=${SECRET}&issuer=NOZOMI`, expires_at: FAR_FUTURE }),
    "POST /platform/v1/auth/mfa/enrollment/confirm": () => json(200, { user, must_change_password: false, second_factor: { status: "verified", method: "enrollment", recovery_codes_remaining: 10 }, recovery_codes: CODES }),
  });
  renderAt({ pathname: "/platform/login", state: { from: "/platform/target" } }, ROUTES);
  const actor = userEvent.setup();
  await actor.type(screen.getByLabelText("邮箱"), "owner@platform.example");
  await actor.type(screen.getByLabelText("密码"), "Quiet-Harbor-2026");
  await actor.click(screen.getByRole("button", { name: "登录" }));
  assert.ok(await screen.findByRole("heading", { level: 1, name: "绑定两步验证" }));
  assertNoSecrets(traces());
  await actor.type(screen.getByLabelText("动态码"), "123456");
  await actor.click(screen.getByRole("button", { name: "完成绑定" }));
  const list = await screen.findByRole("list", { name: "恢复码" });
  assert.equal(within(list).getAllByRole("listitem").length, 10);
  assertNoSecrets(traces());
  await actor.click(screen.getByLabelText("我已经把恢复码存好了"));
  stubApi({ "GET /platform/v1/auth/me": me("verified") });
  await actor.click(screen.getByRole("button", { name: "继续" }));
  assert.ok(await screen.findByText("要去的页面"));
  assertNoSecrets(traces());

  // 「刷新」：卸载后在同一地址重新打开，登录状态还在，恢复码不再出现
  cleanup();
  stubApi({ "GET /platform/v1/auth/me": me("verified") });
  renderAt("/platform/account/security", ROUTES);
  assert.ok(await screen.findByText("10 个"));
  assertAbsent(screen.queryByRole("list", { name: "恢复码" }));
  assertNoSecrets(document.body.textContent ?? "");
});

test("重新生成恢复码：新的一组只在这一次显示，不进存储和地址；离开再回来就没有了", async () => {
  seen.length = 0;
  signIn("platform");
  stubApi({
    "GET /platform/v1/auth/me": me("verified"),
    "POST /platform/v1/auth/mfa/recovery-codes": () => json(200, { recovery_codes: CODES }),
  });
  renderAt("/platform/account/security", ROUTES);
  const actor = userEvent.setup();
  await actor.click(await screen.findByRole("button", { name: "重新生成恢复码" }));
  const dialog = await screen.findByRole("dialog");
  await actor.type(within(dialog).getByLabelText("动态码"), "111222");
  await actor.click(within(dialog).getByRole("button", { name: "确认" }));
  assert.ok(await screen.findByRole("list", { name: "恢复码" }));
  assertNoSecrets(traces());

  cleanup();
  renderAt("/platform/account/security", ROUTES);
  assert.ok(await screen.findByText("10 个"));
  assertAbsent(screen.queryByRole("list", { name: "恢复码" }));
  assertNoSecrets(document.body.textContent ?? "");
  assertNoSecrets(traces());
});
