/**
 * 系统状态页的「第三方密钥」（M4-09，ADR 0041）组件测试：只读角色看不到操作；填写成功后只显示打码、输入框清空；
 * Stripe 逐项出错；清空的确认；测试一下的结果；没有数据加密密钥时不能填写；密钥原文只在请求体里，页面、属性、存储、控制台都没有。
 * 接口用测试替身；真实后端由端到端测试 e2e/integration-secrets.spec.ts 覆盖。
 */
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { IntegrationSecretItem, IntegrationSecrets, IntegrationTestResult } from "../../api/platform.ts";
import type { PlatformUser } from "../../api/types.ts";
import { roleName } from "../../lib/portal.ts";
import { type ApiCall, apiError, assertFocused, deferred, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";

/** 测试里「填进去的密钥」：只该出现在请求体里 */
const GOOGLE_SECRET = "AIzaSyTEST-only-0123456789abcdefWXYZ";
const STRIPE_SECRET = "sk_test_51TESTONLYabcdefghijklmn1234";
const STRIPE_PUBLISHABLE = "pk_test_51TESTONLYopqrstuvwxyz5678";
const STRIPE_WEBHOOK = "whsec_TESTONLYabcdefghijklmnop9012";
const SECRETS = [GOOGLE_SECRET, STRIPE_SECRET, STRIPE_PUBLISHABLE, STRIPE_WEBHOOK];

const ME_ID = "11111111-1111-4111-8111-111111111111";
const stamps = { created_at: "2026-10-06T00:12:00.000Z", updated_at: "2026-10-08T05:30:00.000Z" };
const meOf = (role: string): PlatformUser => ({ id: ME_ID, email: "kato@example.com", name: "加藤 美咲", role, role_name: roleName("platform", role) ?? role, status: "active", ...stamps });

const NOTE = "运营后台填写的优先；后台没填（或清空后）才用服务器配置文件里的值。";
const NOT_FILLED = { configured: false, hints: null, updated_at: null, updated_by: null, problem: null } as const;
const google = (changes: Partial<IntegrationSecretItem> = {}): IntegrationSecretItem => ({
  key: "google_maps",
  label: "谷歌地图",
  fields: [{ name: "api_key", label: "API 密钥" }],
  state: "missing",
  source: "none",
  source_label: "未配置",
  mode: null,
  masked: null,
  env_configured: false,
  admin: NOT_FILLED,
  ...changes,
});
const stripe = (changes: Partial<IntegrationSecretItem> = {}): IntegrationSecretItem => ({
  key: "stripe",
  label: "Stripe 支付",
  fields: [
    { name: "secret_key", label: "Secret key（sk_ 开头）" },
    { name: "publishable_key", label: "Publishable key（pk_ 开头）" },
    { name: "webhook_secret", label: "Webhook signing secret（whsec_ 开头）" },
  ],
  state: "missing",
  source: "none",
  source_label: "未配置",
  mode: null,
  masked: null,
  env_configured: false,
  admin: NOT_FILLED,
  ...changes,
});
const filledByMe = { configured: true, hints: { api_key: "••••WXYZ" }, updated_at: "2026-10-26T01:02:00.000Z", updated_by: { id: ME_ID, name: "加藤 美咲" }, problem: null };
const secretsOf = (items: IntegrationSecretItem[], changes: Partial<IntegrationSecrets> = {}): IntegrationSecrets => ({ precedence_note: NOTE, can_manage: true, encryption_configured: true, items, ...changes });

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;
function open(role: string, secrets: () => IntegrationSecrets, routes: Route = () => null): ApiCall[] {
  signIn("platform", "platform-token");
  const calls = stubApiWith((call) => {
    const custom = routes(call);
    if (custom !== null) return custom;
    if (call.method !== "GET") return null;
    const at = call.url.pathname;
    if (at === "/platform/v1/auth/me") return json(200, { user: meOf(role), permissions: [], must_change_password: false });
    if (at === "/platform/v1/integrations") return json(200, { items: [{ key: "googleMaps", label: "谷歌地图", state: "missing", detail: "" }], fx_center: { state: "fresh", as_of: "2026-10-17T00:02:32.000Z", auto_fetch: true, last_attempt_status: "accepted", last_attempt_at: "2026-10-17T09:24:00.000Z", last_error_code: null }, routes: { day: "2026-10-17", calls: 0, daily_limit: 1000, daily_limit_reached: false, failures: 0, refused: 0, last_success_at: null, last_failure: null } });
    if (at === "/platform/v1/integration-secrets") return json(200, secrets());
    return null;
  });
  render(
    <MemoryRouter initialEntries={["/platform/settings/integrations"]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

const user = () => userEvent.setup();
const card = (label: string): HTMLElement => screen.getByRole("region", { name: label });
const writes = (calls: ApiCall[]): ApiCall[] => calls.filter((call) => call.method !== "GET");

/** 控制台输出全部记下来：哪一条都不能带密钥 */
const consoleLines: string[] = [];
const originalConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
beforeEach(() => {
  consoleLines.length = 0;
  for (const name of Object.keys(originalConsole) as (keyof typeof originalConsole)[]) {
    console[name] = (...args: unknown[]) => {
      consoleLines.push(args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack ?? ""}` : typeof arg === "string" ? arg : JSON.stringify(arg) ?? String(arg))).join(" "));
    };
  }
});
afterEach(() => {
  Object.assign(console, originalConsole);
  resetBrowser();
});

/**
 * 页面上（整份 HTML：文字、每个属性）、浏览器存储、地址、控制台里都没有密钥原文。
 * 打开着的输入框的 value 属性（不是输入的值）里也没有：输入框不受控，React 不往属性里写值。
 */
function assertNoSecretAnywhere(): void {
  const html = document.documentElement.outerHTML;
  const storage = [localStorage, sessionStorage].flatMap((store) => Object.keys(store).map((key) => `${key}=${store.getItem(key)}`)).join("\n");
  for (const secret of SECRETS) {
    for (const piece of [secret, secret.slice(0, 16), secret.slice(-12)]) {
      assert.ok(!html.includes(piece), "页面的文字和属性里不能有密钥");
      assert.ok(!storage.includes(piece), "浏览器存储里不能有密钥");
      assert.ok(!window.location.href.includes(piece), "地址里不能有密钥");
      assert.ok(!consoleLines.some((line) => line.includes(piece)), "控制台里不能有密钥");
    }
  }
}

test("只读：技术看得到优先顺序、每一项的生效来源（没有末 4 位），看不到填写 / 更换、清空、测试一下", async () => {
  const calls = open("tech", () =>
    secretsOf([google({ state: "configured", source: "admin", source_label: "后台设置", admin: null }), stripe({ state: "configured", source: "env", source_label: "服务器配置文件", mode: "test", env_configured: true, admin: null })], { can_manage: false }),
  );
  const maps = await screen.findByRole("region", { name: "谷歌地图" });
  assert.match(document.body.textContent ?? "", new RegExp(`哪一份生效：${NOTE}`));
  assert.match(maps.textContent ?? "", /现在用的后台设置/);
  assert.match(card("Stripe 支付").textContent ?? "", /现在用的服务器配置文件 · 测试密钥/);
  assert.doesNotMatch(document.body.textContent ?? "", /••••/);
  assert.ok(screen.getByText("只有超级管理员可以填写、更换、清空和测试密钥。需要的话，请联系超级管理员。"));
  for (const name of ["填写", "更换", "清空", "测试一下"]) assert.equal(screen.queryAllByRole("button", { name }).length, 0, `只读角色不该有「${name}」`);
  assert.equal(writes(calls).length, 0);
});

test("填写谷歌地图：粘贴进密码框（可以切换显示），保存后对话框关掉、输入框清空，卡片只显示后台设置和末 4 位；请求体里有密钥，页面任何地方都没有原文", async () => {
  const actor = user();
  let current = secretsOf([google(), stripe()]);
  const calls = open("super_admin", () => current, (call) => {
    if (call.method !== "PUT" || call.url.pathname !== "/platform/v1/integration-secrets/google-maps") return null;
    const item = google({ state: "configured", source: "admin", source_label: "后台设置", masked: "••••WXYZ", admin: filledByMe });
    current = secretsOf([item, stripe()]);
    return json(200, { action: "set", item });
  });
  const maps = await screen.findByRole("region", { name: "谷歌地图" });
  assert.match(maps.textContent ?? "", /现在用的未配置/);
  assert.equal(within(maps).queryAllByRole("button", { name: "测试一下" }).length, 0, "没有配置时没有可测的");
  assert.equal(within(maps).queryAllByRole("button", { name: "清空" }).length, 0, "后台没填过时不用清空");
  await actor.click(within(maps).getByRole("button", { name: "填写" }));
  const dialog = await screen.findByRole("dialog", { name: "填写「谷歌地图」的密钥" });
  const input = within(dialog).getByLabelText("API 密钥") as HTMLInputElement;
  assert.equal(input.type, "password");
  assert.equal(input.getAttribute("autocomplete"), "off");
  assertFocused(input);
  await actor.paste(`  ${GOOGLE_SECRET}\n`);
  assert.equal(input.getAttribute("value"), null, "输入的值不进 value 属性");
  await actor.click(within(dialog).getByRole("button", { name: "显示密钥" }));
  assert.equal(input.type, "text");
  assert.equal(within(dialog).getByRole("button", { name: "隐藏密钥" }).getAttribute("aria-pressed"), "true");
  assertNoSecretAnywhere();
  await actor.click(within(dialog).getByRole("button", { name: "保存" }));

  await screen.findByText("已填写「谷歌地图」的密钥");
  assert.equal(screen.queryByRole("dialog"), null);
  const put = writes(calls);
  assert.equal(put.length, 1);
  assert.deepEqual(put[0]?.body, { api_key: GOOGLE_SECRET }, "首尾空白去掉后提交");
  assert.match(card("谷歌地图").textContent ?? "", /现在用的后台设置（••••WXYZ）/);
  assert.match(card("谷歌地图").textContent ?? "", /后台填写的已填写（加藤 美咲，/);
  assert.ok(within(card("谷歌地图")).getByRole("button", { name: "更换" }));
  assert.ok(within(card("谷歌地图")).getByRole("button", { name: "清空" }));
  assert.equal(document.querySelectorAll("input[type=password], .secret-form input").length, 0, "输入框随对话框一起没有了");
  assertNoSecretAnywhere();

  // 再打开「更换」：输入框是空的
  await actor.click(within(card("谷歌地图")).getByRole("button", { name: "更换" }));
  const again = await screen.findByRole("dialog", { name: "更换「谷歌地图」的密钥" });
  assert.equal((within(again).getByLabelText("API 密钥") as HTMLInputElement).value, "");
  assert.match(again.textContent ?? "", /保存后马上改用新的/);
});

test("Stripe 三项一起填：前端先按开头提示、不发请求；后端逐项的出错落到对应的输入框下，焦点到第一处，填过的内容保留", async () => {
  const actor = user();
  const calls = open("super_admin", () => secretsOf([google(), stripe()]), (call) =>
    call.method === "PUT" && call.url.pathname === "/platform/v1/integration-secrets/stripe"
      ? apiError(400, "VALIDATION_FAILED", "请求参数校验未通过", { location: "body", issues: [{ path: "/secret_key", reason: "LIVE_KEY_NOT_ALLOWED", message: "这个环境只能用 Stripe 的测试密钥（sk_test_ 开头）" }, { path: "/webhook_secret", reason: "TOO_SHORT", message: "太短了，请检查是否复制完整" }] })
      : null,
  );
  await actor.click(within(await screen.findByRole("region", { name: "Stripe 支付" })).getByRole("button", { name: "填写" }));
  const dialog = await screen.findByRole("dialog", { name: "填写「Stripe 支付」的密钥" });
  const secretKey = within(dialog).getByLabelText("Secret key（sk_ 开头）") as HTMLInputElement;
  const publishable = within(dialog).getByLabelText("Publishable key（pk_ 开头）") as HTMLInputElement;
  const webhook = within(dialog).getByLabelText("Webhook signing secret（whsec_ 开头）") as HTMLInputElement;
  assert.match(dialog.textContent ?? "", /测试环境以 sk_test_ 开头/);
  assert.match(dialog.textContent ?? "", /测试环境以 pk_test_ 开头/);

  // 第二项粘成了 secret key、第三项没填：前端就拦下
  await actor.click(secretKey);
  await actor.paste(STRIPE_SECRET);
  await actor.click(publishable);
  await actor.paste(STRIPE_SECRET);
  await actor.click(within(dialog).getByRole("button", { name: "保存" }));
  assert.equal(writes(calls).length, 0);
  assert.equal(publishable.getAttribute("aria-invalid"), "true");
  assert.match(document.getElementById(publishable.getAttribute("aria-describedby")?.split(" ")[0] ?? "")?.textContent ?? "", /开头不对：Publishable key 以 pk_test_ 开头/);
  assert.match(document.getElementById(webhook.getAttribute("aria-describedby")?.split(" ")[0] ?? "")?.textContent ?? "", /请粘贴这一项（Stripe 的三项要一起填）/);
  assertFocused(publishable);

  publishable.value = "";
  await actor.paste(STRIPE_PUBLISHABLE);
  assert.equal(publishable.getAttribute("aria-invalid"), null, "改了以后那一项的出错消失");
  await actor.click(webhook);
  await actor.paste("whsec_short1");
  await actor.click(within(dialog).getByRole("button", { name: "保存" }));
  await within(dialog).findByText("有几项需要修改");
  assert.equal(writes(calls).length, 1);
  assert.deepEqual(writes(calls)[0]?.body, { secret_key: STRIPE_SECRET, publishable_key: STRIPE_PUBLISHABLE, webhook_secret: "whsec_short1" });
  assert.equal(secretKey.getAttribute("aria-invalid"), "true");
  assert.match(document.getElementById(secretKey.getAttribute("aria-describedby")?.split(" ")[0] ?? "")?.textContent ?? "", /这个环境只能用 Stripe 的测试密钥/);
  assert.match(document.getElementById(webhook.getAttribute("aria-describedby")?.split(" ")[0] ?? "")?.textContent ?? "", /太短了/);
  assert.equal(publishable.getAttribute("aria-invalid"), null);
  assertFocused(secretKey);
  assert.equal(secretKey.value, STRIPE_SECRET, "填过的保留，改一项就能再保存");
  assertNoSecretAnywhere();
});

test("清空：确认对话框写清「清空后改用服务器配置文件里的值」，默认焦点在「取消」；确认后卡片改成配置文件的那一份；已经被别人清空时只能「知道了」", async () => {
  const actor = user();
  const filled = google({ state: "configured", source: "admin", source_label: "后台设置", masked: "••••WXYZ", env_configured: true, admin: filledByMe });
  let current = secretsOf([filled, stripe({ state: "configured", source: "admin", source_label: "后台设置", masked: "••••1234", mode: "test", admin: { ...filledByMe, hints: { secret_key: "••••1234" } } })]);
  let stripeGone = false;
  const calls = open("super_admin", () => current, (call) => {
    if (call.method !== "DELETE") return null;
    if (call.url.pathname === "/platform/v1/integration-secrets/stripe") {
      stripeGone = true;
      return apiError(409, "INTEGRATION_SECRET_NOT_SET", "后台没有填写这一项，不用清空");
    }
    const item = google({ state: "configured", source: "env", source_label: "服务器配置文件", masked: "••••5678", env_configured: true });
    current = secretsOf([item, current.items[1] as IntegrationSecretItem]);
    return json(200, { item });
  });
  const maps = await screen.findByRole("region", { name: "谷歌地图" });
  await actor.click(within(maps).getByRole("button", { name: "清空" }));
  const dialog = await screen.findByRole("dialog", { name: "清空「谷歌地图」在后台填写的密钥？" });
  assert.match(dialog.textContent ?? "", /清空后改用服务器配置文件里的值（如果有）。服务器配置文件里也有这一项，清空后马上改用那里的值。/);
  assertFocused(within(dialog).getByRole("button", { name: "取消" }));
  await actor.click(within(dialog).getByRole("button", { name: "清空" }));
  await screen.findByText("已清空「谷歌地图」在后台填写的密钥");
  assert.equal(writes(calls).length, 1);
  assert.match(card("谷歌地图").textContent ?? "", /现在用的服务器配置文件（••••5678）/);
  assert.match(card("谷歌地图").textContent ?? "", /后台填写的没有填写/);
  assert.equal(within(card("谷歌地图")).queryAllByRole("button", { name: "清空" }).length, 0);
  await waitFor(() => assertFocused(within(card("谷歌地图")).getByRole("button", { name: "填写" })));

  // Stripe：配置文件里没有，清空就是未配置、客人不能付款；确认后发现已经被别人清空了
  await actor.click(within(card("Stripe 支付")).getByRole("button", { name: "清空" }));
  const second = await screen.findByRole("dialog", { name: "清空「Stripe 支付」在后台填写的密钥？" });
  assert.match(second.textContent ?? "", /服务器配置文件里没有这一项，清空后 Stripe 支付就是「未配置」，客人将不能在线付款/);
  current = secretsOf([current.items[0] as IntegrationSecretItem, stripe()]);
  await actor.click(within(second).getByRole("button", { name: "清空" }));
  await within(second).findByText(/后台已经没有填写这一项了/);
  assert.ok(stripeGone);
  assert.equal(within(second).queryAllByRole("button", { name: "清空" }).length, 0, "再点一次结果也一样：确认按钮去掉");
  await actor.click(within(second).getByRole("button", { name: "知道了" }));
  // 关掉后重新取一次
  await waitFor(() => assert.match(card("Stripe 支付").textContent ?? "", /现在用的未配置/));
});

test("测试一下：测试中按钮显示加载状态；可用、不可用（带原因）、没测成都写出来，带测试时间；谷歌地图写明会产生极少量费用，Stripe 写明不产生费用", async () => {
  const actor = user();
  const configured = google({ state: "configured", source: "env", source_label: "服务器配置文件", masked: "••••5678", env_configured: true });
  const replies: (() => Response | Promise<Response>)[] = [];
  open("super_admin", () => secretsOf([configured, stripe({ state: "configured", source: "env", source_label: "服务器配置文件", masked: "••••1234", mode: "test", env_configured: true })]), (call) =>
    call.method === "POST" && call.url.pathname === "/platform/v1/integration-secrets/google-maps/test" ? (replies.shift()?.() ?? null) : null,
  );
  const maps = await screen.findByRole("region", { name: "谷歌地图" });
  assert.match(maps.textContent ?? "", /每次产生极少量费用/);
  assert.match(card("Stripe 支付").textContent ?? "", /不收钱、不产生费用/);
  const result = (changes: Partial<IntegrationTestResult>): IntegrationTestResult => ({ key: "google_maps", ok: true, code: null, message: "谷歌地图可用", source: "env", source_label: "服务器配置文件", tested_at: "2026-10-26T03:04:05.000Z", ...changes });

  const pending = deferred();
  replies.push(() => pending.promise);
  const button = within(maps).getByRole("button", { name: "测试一下" });
  await actor.click(button);
  await waitFor(() => assert.equal(button.getAttribute("aria-busy"), "true"));
  assert.match(button.textContent ?? "", /测试中…/);
  pending.resolve(json(200, result({})));
  const status = maps.querySelector('[role="status"]') as HTMLElement;
  await waitFor(() => assert.match(status.textContent ?? "", /^可用测的是服务器配置文件里的那一份。测试时间 2026-10-26 \d\d:04:05$/));
  assert.equal(button.getAttribute("aria-busy"), null);

  replies.push(() => json(200, result({ ok: false, code: "API_NOT_ENABLED", message: "这把密钥没有启用 Routes API。请在谷歌云控制台启用后再试。", tested_at: "2026-10-26T03:10:00.000Z" })));
  await actor.click(button);
  await waitFor(() => assert.match(status.textContent ?? "", /^不可用这把密钥没有启用 Routes API。请在谷歌云控制台启用后再试。测试时间 2026-10-26 \d\d:10:00$/));

  replies.push(() => apiError(409, "INTEGRATION_NOT_CONFIGURED", "谷歌地图还没有配置，先填写密钥再测试"));
  await actor.click(button);
  await waitFor(() => assert.match(status.textContent ?? "", /没有测试成功这一项现在没有配置，先填写密钥再测试。/));

  replies.push(() => Promise.reject(new TypeError("Failed to fetch")));
  await actor.click(button);
  await waitFor(() => assert.match(status.textContent ?? "", /没有等到测试结果（网络不通或对方太慢）。请检查网络后再点一次「测试一下」。/));

  replies.push(() => apiError(429, "INTEGRATION_TEST_RATE_LIMITED", "刚测过，请过几秒再试"));
  await actor.click(button);
  await waitFor(() => assert.match(status.textContent ?? "", /没有测试成功刚测过，请过几秒再试。/));
});

test("服务器没有配置数据加密密钥：提示说清楚、「填写」不可用并关联到原因；万一填写时才发现（503），对话框里说明，页面上的按钮也变成不可用", async () => {
  const actor = user();
  open("super_admin", () => secretsOf([google(), stripe()], { encryption_configured: false }));
  const maps = await screen.findByRole("region", { name: "谷歌地图" });
  const fill = within(maps).getByRole("button", { name: "填写" }) as HTMLButtonElement;
  assert.equal(fill.disabled, true);
  const reason = document.getElementById(fill.getAttribute("aria-describedby") ?? "");
  assert.match(reason?.textContent ?? "", /现在不能在后台填写服务器还没有配置数据加密密钥，现在不能在后台填写密钥。请联系技术人员在服务器上配置好以后再来填写。/);

  resetBrowser();
  open("super_admin", () => secretsOf([google(), stripe()]), (call) => (call.method === "PUT" ? apiError(503, "INTEGRATION_ENCRYPTION_NOT_CONFIGURED", "服务器还没有配置数据加密密钥") : null));
  await actor.click(within(await screen.findByRole("region", { name: "谷歌地图" })).getByRole("button", { name: "填写" }));
  const dialog = await screen.findByRole("dialog");
  await actor.paste(GOOGLE_SECRET);
  await actor.click(within(dialog).getByRole("button", { name: "保存" }));
  await within(dialog).findByText("现在不能在后台填写");
  await actor.click(within(dialog).getByRole("button", { name: "取消" }));
  await waitFor(() => assert.equal((within(card("谷歌地图")).getByRole("button", { name: "填写" }) as HTMLButtonElement).disabled, true));
  assertNoSecretAnywhere();
});

test("第三方密钥加载失败（可以重试）、后台那一份读不出来时的提示", async () => {
  const actor = user();
  let fail = true;
  open("super_admin", () => secretsOf([google({ state: "missing", admin: { ...filledByMe, problem: "UNREADABLE" } }), stripe()]), (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/integration-secrets" && fail ? apiError(500, "INTERNAL", "boom") : null));
  await screen.findByText("第三方密钥加载失败");
  assert.ok(screen.getByText("请检查网络后重试。"));
  fail = false;
  await actor.click(screen.getByRole("button", { name: "重试" }));
  const maps = await screen.findByRole("region", { name: "谷歌地图" });
  assert.match(maps.textContent ?? "", /后台填写的那一份读不出来（服务器的数据加密密钥可能换过），现在没有用它。请重新填写一次。/);
});
