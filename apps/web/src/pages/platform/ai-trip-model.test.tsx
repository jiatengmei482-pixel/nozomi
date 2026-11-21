/**
 * 「第三方密钥」里 Claude 下面的「使用的型号」（M9T-32，ADR 0104 第六节）组件测试：技术只能看、看得到今天的次数；
 * 超级管理员三选一保存（第一次不带 If-Match，之后带）；别人刚改过（版本冲突）时提示并换成最新的。接口用测试替身。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { AiTripSettings, IntegrationSecretItem, IntegrationSecrets } from "../../api/platform.ts";
import type { PlatformUser } from "../../api/types.ts";
import { roleName } from "../../lib/portal.ts";
import { type ApiCall, apiError, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";
import { aiTripUsageText } from "./AiTripModelCard.tsx";

const stamps = { created_at: "2026-10-06T00:12:00.000Z", updated_at: "2026-10-08T05:30:00.000Z" };
const meOf = (role: string): PlatformUser => ({ id: "11111111-1111-4111-8111-111111111111", email: "kato@example.com", name: "加藤 美咲", role, role_name: roleName("platform", role) ?? role, status: "active", ...stamps });
const claude: IntegrationSecretItem = {
  key: "anthropic",
  label: "Claude（AI 行程解析）",
  fields: [{ name: "api_key", label: "API 密钥" }],
  state: "configured",
  source: "admin",
  source_label: "后台设置",
  mode: null,
  masked: null,
  settings: null,
  env_configured: false,
  admin: null,
};
const secrets = (canManage: boolean): IntegrationSecrets => ({ precedence_note: "运营后台填写的优先。", can_manage: canManage, encryption_configured: true, items: [claude] });
const settingsOf = (changes: Partial<AiTripSettings> = {}): AiTripSettings => ({
  model_mode: "haiku_then_sonnet",
  version: 0,
  updated_at: null,
  models: { sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-5-5" },
  today: { date: "2026-11-20", sonnet: 3, haiku: 5, sonnet_retries: 1, used: 7, limit: 300 },
  ...changes,
});

function open(role: string, settings: () => AiTripSettings, onPut: (call: ApiCall) => Response): ApiCall[] {
  signIn("platform", "platform-token");
  const calls = stubApiWith((call) => {
    const at = call.url.pathname;
    if (call.method === "PUT" && at === "/platform/v1/ai-trip-settings") return onPut(call);
    if (call.method !== "GET") return null;
    if (at === "/platform/v1/auth/me") return json(200, { user: meOf(role), permissions: [], must_change_password: false });
    if (at === "/platform/v1/integrations") return json(200, { items: [], fx_center: { state: "fresh", as_of: "2026-10-17T00:02:32.000Z", auto_fetch: true, last_attempt_status: "accepted", last_attempt_at: "2026-10-17T09:24:00.000Z", last_error_code: null }, routes: { day: "2026-10-17", calls: 0, daily_limit: 1000, daily_limit_reached: false, failures: 0, refused: 0, last_success_at: null, last_failure: null } });
    if (at === "/platform/v1/integration-secrets") return json(200, secrets(role === "super_admin"));
    if (at === "/platform/v1/ai-trip-settings") return json(200, settings());
    return null;
  });
  render(
    <MemoryRouter initialEntries={["/platform/settings/integrations"]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

afterEach(() => resetBrowser());

test("今天的次数：每个型号、重试、全站已用 / 上限；没有重试时不写", () => {
  assert.equal(aiTripUsageText(settingsOf().today), "今天（东京时间 2026-11-20）：Sonnet 3 次（其中改用 Sonnet 重试 1 次） · Haiku 5 次 · 全站已用 7 / 300 次");
  assert.doesNotMatch(aiTripUsageText({ ...settingsOf().today, sonnet_retries: 0 }), /重试/);
});

test("技术：看得到现在用的型号和今天的次数，没有单选、没有保存", async () => {
  const calls = open("tech", () => settingsOf({ model_mode: "haiku_then_sonnet", version: 2 }), () => json(500, {}));
  const region = await screen.findByRole("region", { name: "Claude（AI 行程解析）· 使用的型号" });
  await waitFor(() => assert.match(region.textContent ?? "", /先 Haiku，出错再用 Sonnet/));
  assert.match(region.textContent ?? "", /全站已用 7 \/ 300 次/);
  assert.equal(within(region).queryAllByRole("radio").length, 0);
  assert.equal(within(region).queryAllByRole("button", { name: "保存" }).length, 0);
  assert.equal(calls.filter((call) => call.method !== "GET").length, 0);
});

test("超级管理员：改成 Haiku 保存（第一次不带 If-Match）；再改带上版本号；版本冲突时提示并重新取", async () => {
  const actor = userEvent.setup();
  let current = settingsOf();
  let conflict = false;
  const calls = open("super_admin", () => current, (call) => {
    if (conflict) return apiError(409, "VERSION_CONFLICT", "版本对不上");
    const body = call.body as { model_mode: AiTripSettings["model_mode"] };
    current = settingsOf({ model_mode: body.model_mode, version: current.version + 1 });
    return json(200, current);
  });
  const region = await screen.findByRole("region", { name: "Claude（AI 行程解析）· 使用的型号" });
  const radio = await within(region).findByRole("radio", { name: /先 Haiku，出错再用 Sonnet（默认，推荐）/ });
  assert.equal((radio as HTMLInputElement).checked, true);
  await actor.click(within(region).getByRole("radio", { name: /^Haiku/ }));
  await actor.click(within(region).getByRole("button", { name: "保存" }));
  await screen.findByText("AI 行程解析改为「Haiku」，下一次解析起生效");
  const puts = calls.filter((call) => call.method === "PUT");
  assert.equal(puts.length, 1);
  assert.deepEqual(puts[0]?.body, { model_mode: "haiku" });
  assert.equal(new Headers(puts[0]?.headers).get("if-match"), null);

  await actor.click(within(region).getByRole("radio", { name: /先 Haiku/ }));
  conflict = true;
  await actor.click(within(region).getByRole("button", { name: "保存" }));
  await within(region).findByText("别人刚改过这里，已经换成最新的设置，请再确认一次。");
  const second = calls.filter((call) => call.method === "PUT")[1];
  assert.equal(new Headers(second?.headers).get("if-match"), '"1"');
});
