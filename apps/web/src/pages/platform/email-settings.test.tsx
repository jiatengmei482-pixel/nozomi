/**
 * 系统状态页的「邮件发送」卡片（M4-14，ADR 0048）组件测试：只读角色只看到状态；填写的七项和请求体；端口按数字提交；
 * 更换时带上不是密钥的几项、密码一定要重填；前端和后端的逐项出错；不加密不给选（除非现在就是）；测试结果每种原因的说法；清空的确认；
 * 密码原文只在请求体里，页面、属性、存储、地址、控制台都没有。
 * 接口用测试替身；真实后端和假 SMTP 服务器由端到端测试 e2e/email-settings.spec.ts 覆盖。
 */
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { IntegrationSecretItem, IntegrationSecrets, IntegrationTestResult, SmtpSettings } from "../../api/platform.ts";
import type { PlatformUser } from "../../api/types.ts";
import { EMAIL_TEST_FAILURES } from "../../lib/secret-form.ts";
import { roleName } from "../../lib/portal.ts";
import { type ApiCall, apiError, assertFocused, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";

/** 测试里「填进去的密码」：只该出现在请求体里 */
const PASSWORD = "smtpTESTonly-pass-0123456789-WXYZ";
const SETTINGS_PATH = "/platform/v1/integration-secrets/email";

const ME_ID = "11111111-1111-4111-8111-111111111111";
const stamps = { created_at: "2026-10-06T00:12:00.000Z", updated_at: "2026-10-08T05:30:00.000Z" };
const meOf = (role: string): PlatformUser => ({ id: ME_ID, email: "kato@example.com", name: "加藤 美咲", role, role_name: roleName("platform", role) ?? role, status: "active", ...stamps });

const NOT_FILLED = { configured: false, hints: null, updated_at: null, updated_by: null, problem: null } as const;
const FILLED = { configured: true, hints: { password: "••••WXYZ" }, updated_at: "2026-11-01T01:02:00.000Z", updated_by: { id: ME_ID, name: "加藤 美咲" }, problem: null };
const SMTP: SmtpSettings = { host: "smtp.example.com", port: 587, encryption: "starttls", username: "mailer@example.com", from_name: "NOZOMI 用车", from_address: "noreply@example.com" };

const email = (changes: Partial<IntegrationSecretItem> = {}): IntegrationSecretItem => ({
  key: "email",
  label: "邮件发送",
  fields: [
    { name: "host", label: "SMTP 主机" },
    { name: "port", label: "端口（25、465、587、2525）" },
    { name: "encryption", label: "加密方式" },
    { name: "username", label: "用户名" },
    { name: "password", label: "密码" },
    { name: "from_name", label: "发件人名称" },
    { name: "from_address", label: "发件人地址" },
  ],
  state: "missing",
  source: "none",
  source_label: "未配置",
  mode: null,
  masked: null,
  settings: null,
  env_configured: false,
  admin: NOT_FILLED,
  ...changes,
});
const filled = (changes: Partial<IntegrationSecretItem> = {}): IntegrationSecretItem => email({ state: "configured", source: "admin", source_label: "后台设置", masked: "••••WXYZ", settings: SMTP, admin: FILLED, ...changes });
const secretsOf = (item: IntegrationSecretItem, changes: Partial<IntegrationSecrets> = {}): IntegrationSecrets => ({ precedence_note: "运营后台填写的优先；后台没填（或清空后）才用服务器配置文件里的值。", can_manage: true, encryption_configured: true, items: [item], ...changes });

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;
function open(role: string, secrets: () => IntegrationSecrets, routes: Route = () => null): ApiCall[] {
  signIn("platform", "platform-token");
  const calls = stubApiWith((call) => {
    const custom = routes(call);
    if (custom !== null) return custom;
    if (call.method !== "GET") return null;
    const at = call.url.pathname;
    if (at === "/platform/v1/auth/me") return json(200, { user: meOf(role), permissions: [], must_change_password: false });
    if (at === "/platform/v1/integrations") return json(200, { items: [{ key: "email", label: "邮件发送", state: "missing", detail: "" }], fx_center: { state: "fresh", as_of: "2026-10-17T00:02:32.000Z", auto_fetch: true, last_attempt_status: "accepted", last_attempt_at: "2026-10-17T09:24:00.000Z", last_error_code: null }, routes: { day: "2026-10-17", calls: 0, daily_limit: 1000, daily_limit_reached: false, failures: 0, refused: 0, last_success_at: null, last_failure: null } });
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
const findCard = (): Promise<HTMLElement> => screen.findByRole("region", { name: "邮件发送" });
const writes = (calls: ApiCall[]): ApiCall[] => calls.filter((call) => call.method !== "GET");
const inputOf = (dialog: HTMLElement, label: string): HTMLInputElement => within(dialog).getByLabelText(label) as HTMLInputElement;
const errorOf = (input: HTMLElement): string => document.getElementById(input.getAttribute("aria-describedby")?.split(" ")[0] ?? "")?.textContent ?? "";

/** 把七项都填上（密码用粘贴，和真实操作一样） */
async function fillAll(actor: ReturnType<typeof user>, dialog: HTMLElement, values: { host?: string; port?: string } = {}): Promise<void> {
  const type = async (label: string, value: string): Promise<void> => {
    const input = inputOf(dialog, label);
    await actor.clear(input);
    await actor.type(input, value);
  };
  await type("SMTP 主机", values.host ?? "smtp.example.com");
  await type("端口（25、465、587、2525）", values.port ?? "587");
  await actor.selectOptions(within(dialog).getByLabelText("加密方式"), "starttls");
  await type("用户名", "mailer@example.com");
  await actor.click(inputOf(dialog, "密码"));
  await actor.paste(`  ${PASSWORD}\n`);
  await type("发件人名称", "NOZOMI 用车");
  await type("发件人地址", "noreply@example.com");
}

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

function assertNoPasswordAnywhere(): void {
  const html = document.documentElement.outerHTML;
  const storage = [localStorage, sessionStorage].flatMap((store) => Object.keys(store).map((key) => `${key}=${store.getItem(key)}`)).join("\n");
  for (const piece of [PASSWORD, PASSWORD.slice(0, 16), PASSWORD.slice(-12)]) {
    assert.ok(!html.includes(piece), "页面的文字和属性里不能有密码");
    assert.ok(!storage.includes(piece), "浏览器存储里不能有密码");
    assert.ok(!window.location.href.includes(piece), "地址里不能有密码");
    assert.ok(!consoleLines.some((line) => line.includes(piece)), "控制台里不能有密码");
  }
}

test("只读角色：只看到已配置 / 未配置和来源；没有主机、发件人、打码值，也没有任何按钮", async () => {
  const calls = open("tech", () => secretsOf(email({ state: "configured", source: "admin", source_label: "后台设置", admin: null }), { can_manage: false }));
  const card = await findCard();
  assert.match(card.textContent ?? "", /已配置/);
  assert.match(card.textContent ?? "", /现在用的后台设置/);
  assert.doesNotMatch(card.textContent ?? "", /••••|邮件服务器|加密方式|发件人/);
  for (const name of ["填写", "更换", "清空", "测试一下"]) assert.equal(within(card).queryAllByRole("button", { name }).length, 0, `只读角色不该有「${name}」`);
  assert.equal(writes(calls).length, 0);
});

test("填写：七项的说明用大白话；加密方式默认 TLS、不提供不加密；端口按数字提交、首尾空白去掉；保存后卡片显示主机:端口、加密方式、发件人和打码，密码不回显", async () => {
  const actor = user();
  let current = secretsOf(email());
  const calls = open("super_admin", () => current, (call) => {
    if (call.method !== "PUT" || call.url.pathname !== SETTINGS_PATH) return null;
    const item = filled();
    current = secretsOf(item);
    return json(200, { action: "set", item });
  });
  const card = await findCard();
  assert.match(card.textContent ?? "", /现在用的未配置/);
  assert.equal(within(card).queryAllByRole("button", { name: "测试一下" }).length, 0);
  assert.equal(within(card).queryAllByRole("button", { name: "清空" }).length, 0);
  await actor.click(within(card).getByRole("button", { name: "填写" }));
  const dialog = await screen.findByRole("dialog", { name: "填写「邮件发送」的设置" });
  assertFocused(inputOf(dialog, "SMTP 主机"));
  assert.match(dialog.textContent ?? "", /一般在邮件服务商的 SMTP 设置页能找到/);
  assert.match(dialog.textContent ?? "", /每次保存都要重新填密码/);
  assert.match(dialog.textContent ?? "", /就算有人改了主机，旧密码也不会被发到别的服务器/);
  const select = within(dialog).getByLabelText("加密方式") as HTMLSelectElement;
  assert.equal(select.value, "tls");
  assert.deepEqual([...select.options].map((option) => option.textContent), ["TLS（推荐，常用端口 465）", "STARTTLS（常用端口 587）"]);

  await fillAll(actor, dialog);
  const password = inputOf(dialog, "密码");
  assert.equal(password.type, "password");
  assert.equal(password.getAttribute("autocomplete"), "new-password", "不让浏览器把后台登录密码自动填进来");
  assert.equal(password.getAttribute("value"), null, "输入的值不进 value 属性");
  await actor.click(within(dialog).getByRole("button", { name: "显示密码" }));
  assert.equal(password.type, "text");
  assertNoPasswordAnywhere();
  await actor.click(within(dialog).getByRole("button", { name: "保存" }));

  await screen.findByText("已填写「邮件发送」的设置");
  assert.equal(screen.queryByRole("dialog"), null);
  assert.deepEqual(writes(calls)[0]?.body, { host: "smtp.example.com", port: 587, encryption: "starttls", username: "mailer@example.com", password: PASSWORD, from_name: "NOZOMI 用车", from_address: "noreply@example.com" });
  const text = (await findCard()).textContent ?? "";
  assert.match(text, /现在用的后台设置（••••WXYZ）/);
  assert.match(text, /邮件服务器smtp\.example\.com:587/);
  assert.match(text, /加密方式STARTTLS/);
  assert.match(text, /发件人NOZOMI 用车 <noreply@example\.com>/);
  assert.match(text, /后台填写的已填写（加藤 美咲，/);
  assertNoPasswordAnywhere();
});

test("更换：不是密钥的几项带上现在的值，密码是空的；不填密码不能保存，焦点到密码框", async () => {
  const actor = user();
  const calls = open("super_admin", () => secretsOf(filled()));
  await actor.click(within(await findCard()).getByRole("button", { name: "更换" }));
  const dialog = await screen.findByRole("dialog", { name: "更换「邮件发送」的设置" });
  assert.equal(inputOf(dialog, "SMTP 主机").value, "smtp.example.com");
  assert.equal(inputOf(dialog, "端口（25、465、587、2525）").value, "587");
  assert.equal((within(dialog).getByLabelText("加密方式") as HTMLSelectElement).value, "starttls");
  assert.equal(inputOf(dialog, "用户名").value, "mailer@example.com");
  assert.equal(inputOf(dialog, "发件人名称").value, "NOZOMI 用车");
  assert.equal(inputOf(dialog, "发件人地址").value, "noreply@example.com");
  const password = inputOf(dialog, "密码");
  assert.equal(password.value, "");
  assert.doesNotMatch(dialog.innerHTML, /••••WXYZ/, "打码值也不放进表单");

  await actor.click(within(dialog).getByRole("button", { name: "保存" }));
  assert.equal(writes(calls).length, 0);
  assert.match(errorOf(password), /请重新填写密码（每次保存都要填）/);
  assertFocused(password);
});

test("字段错误：提交前拦下没填的、端口不是数字、密码太短、地址不像邮箱；后端逐项的出错（内网主机、端口、不加密）落到对应字段，焦点到第一处，填过的保留", async () => {
  const actor = user();
  const calls = open("super_admin", () => secretsOf(email()), (call) =>
    call.method === "PUT"
      ? apiError(400, "VALIDATION_FAILED", "请求参数校验未通过", {
          location: "body",
          issues: [
            { path: "/encryption", reason: "ENCRYPTION_NOT_ALLOWED", message: "这个环境不能用明文发信，请选 TLS 或 STARTTLS" },
            { path: "/host", reason: "HOST_FORBIDDEN", message: "不能填内网地址：请填写邮件服务商给的公网主机名" },
            { path: "/port", reason: "PORT_NOT_ALLOWED", message: "端口只能是 25、465、587、2525" },
          ],
        })
      : null,
  );
  await actor.click(within(await findCard()).getByRole("button", { name: "填写" }));
  const dialog = await screen.findByRole("dialog");
  const host = inputOf(dialog, "SMTP 主机");
  const port = inputOf(dialog, "端口（25、465、587、2525）");
  const password = inputOf(dialog, "密码");
  const address = inputOf(dialog, "发件人地址");
  const select = within(dialog).getByLabelText("加密方式");

  await actor.type(port, "abc");
  await actor.click(password);
  await actor.paste("short");
  await actor.type(address, "noreply");
  await actor.click(within(dialog).getByRole("button", { name: "保存" }));
  assert.equal(writes(calls).length, 0, "前端就拦下");
  assert.match(errorOf(host), /请填写这一项（七项要一起填）/);
  assert.match(errorOf(port), /端口是一个数字，例如 465/);
  assert.match(errorOf(password), /密码至少 8 个字符/);
  assert.match(errorOf(address), /这不是一个邮箱地址/);
  assertFocused(host);
  await actor.type(host, "a");
  assert.equal(host.getAttribute("aria-invalid"), null, "改了以后那一项的出错消失");

  await actor.clear(password);
  await fillAll(actor, dialog, { host: "10.0.0.5", port: "2526" });
  await actor.click(within(dialog).getByRole("button", { name: "保存" }));
  await within(dialog).findByText("有几项需要修改");
  assert.equal(writes(calls).length, 1);
  assert.match(errorOf(host), /不能填内网地址/);
  assert.match(errorOf(port), /端口只能是 25、465、587、2525/);
  assert.match(errorOf(select), /这个环境不能用明文发信/);
  assertFocused(host);
  assert.equal(host.value, "10.0.0.5", "填过的保留");
  assert.equal(password.value.trim(), PASSWORD, "密码也保留，改一项就能再保存");
  assertNoPasswordAnywhere();
});

test("加密方式：接口说现在就是不加密时才列出来，后端拒绝时焦点到下拉", async () => {
  const actor = user();
  open("super_admin", () => secretsOf(filled({ settings: { ...SMTP, encryption: "none" } })), (call) => (call.method === "PUT" ? apiError(400, "VALIDATION_FAILED", "请求参数校验未通过", { issues: [{ path: "/encryption", reason: "ENCRYPTION_NOT_ALLOWED", message: "这个环境不能用明文发信，请选 TLS 或 STARTTLS" }] }) : null));
  const card = await findCard();
  assert.match(card.textContent ?? "", /加密方式不加密/);
  await actor.click(within(card).getByRole("button", { name: "更换" }));
  const dialog = await screen.findByRole("dialog");
  const select = within(dialog).getByLabelText("加密方式") as HTMLSelectElement;
  assert.equal(select.value, "none");
  assert.deepEqual([...select.options].map((option) => option.value), ["tls", "starttls", "none"]);
  await actor.click(inputOf(dialog, "密码"));
  await actor.paste(PASSWORD);
  await actor.click(within(dialog).getByRole("button", { name: "保存" }));
  await within(dialog).findByText("有几项需要修改");
  assertFocused(select);
});

test("测试一下：写明发到自己的登录邮箱；请求不带任何参数；通过时写明发到哪；每个原因都有一句中文说明怎么办；没配置、刚测过、网络不通也说清楚", async () => {
  const actor = user();
  const replies: (() => Response | Promise<Response>)[] = [];
  const calls = open("super_admin", () => secretsOf(filled()), (call) => (call.method === "POST" && call.url.pathname === `${SETTINGS_PATH}/test` ? (replies.shift()?.() ?? null) : null));
  const card = await findCard();
  assert.match(card.textContent ?? "", /会发一封测试邮件到你自己的登录邮箱/);
  const result = (changes: Partial<IntegrationTestResult>): IntegrationTestResult => ({ key: "email", ok: false, code: null, message: "服务器原话", source: "admin", source_label: "后台设置", tested_at: "2026-11-01T03:04:05.000Z", ...changes });
  const button = within(card).getByRole("button", { name: "测试一下" });
  const status = card.querySelector('[role="status"]') as HTMLElement;

  replies.push(() => json(200, result({ ok: true, message: "邮件服务器已接收，测试邮件发到了 kato@example.com，请去邮箱确认（也看看垃圾邮件）" })));
  await actor.click(button);
  await waitFor(() => assert.match(status.textContent ?? "", /^可用邮件服务器已接收，测试邮件发到了 kato@example\.com，请去邮箱确认（也看看垃圾邮件）。测的是后台设置里的那一份。测试时间 2026-11-01 \d\d:04:05$/));
  const post = writes(calls)[0];
  assert.equal(post?.body, undefined, "收件人不由页面决定");

  const expected: Record<string, RegExp> = {
    UNREACHABLE: /连不上邮件服务器。请检查主机和端口/,
    TLS_FAILED: /建立加密连接失败。请检查加密方式和端口是否相配/,
    AUTH_FAILED: /不接受这组用户名和密码。请重新填写/,
    SENDER_REJECTED: /拒绝了发件人地址或这封邮件。请确认/,
    RECIPIENT_REJECTED: /拒绝了收件人（你的登录邮箱）。请确认/,
    TARGET_FORBIDDEN: /内网地址，不允许连接。请填写邮件服务商给的公网主机名/,
    TIMEOUT: /15 秒内没有完成。请检查主机和端口/,
    UNEXPECTED: /应答看不懂。请确认主机和端口/,
    MESSAGE_INVALID: /不能用来收这封测试邮件.*请换一个超级管理员账号/,
  };
  assert.deepEqual(Object.keys(expected).sort(), Object.keys(EMAIL_TEST_FAILURES).sort(), "每个原因都测到");
  for (const [code, pattern] of Object.entries(expected)) {
    replies.push(() => json(200, result({ code })));
    await actor.click(button);
    await waitFor(() => {
      assert.match(status.textContent ?? "", /^不可用/, code);
      assert.match(status.textContent ?? "", pattern, code);
      assert.doesNotMatch(status.textContent ?? "", /服务器原话/, code);
    });
  }

  replies.push(() => json(200, result({ code: "SOMETHING_NEW", message: "以后才有的原因" })));
  await actor.click(button);
  await waitFor(() => assert.match(status.textContent ?? "", /不可用以后才有的原因/));

  replies.push(() => apiError(409, "INTEGRATION_NOT_CONFIGURED", "邮件发送还没有配置，先填写再测试"));
  await actor.click(button);
  await waitFor(() => assert.match(status.textContent ?? "", /没有测试成功这一项现在没有配置，先填写设置再测试。/));

  replies.push(() => apiError(429, "INTEGRATION_TEST_RATE_LIMITED", "刚测过，请过几秒再试"));
  await actor.click(button);
  await waitFor(() => assert.match(status.textContent ?? "", /没有测试成功刚测过，请过几秒再试。/));

  replies.push(() => Promise.reject(new TypeError("Failed to fetch")));
  await actor.click(button);
  await waitFor(() => assert.match(status.textContent ?? "", /没有等到测试结果/));
});

test("清空：确认对话框写清后果，默认焦点在「取消」；确认后回到未配置；已经被别人清空时只能「知道了」", async () => {
  const actor = user();
  let current = secretsOf(filled());
  let gone = false;
  const calls = open("super_admin", () => current, (call) => {
    if (call.method !== "DELETE" || call.url.pathname !== SETTINGS_PATH) return null;
    if (gone) return apiError(409, "INTEGRATION_SECRET_NOT_SET", "后台没有填写这一项，不用清空");
    current = secretsOf(email());
    return json(200, { item: email() });
  });
  await actor.click(within(await findCard()).getByRole("button", { name: "清空" }));
  const dialog = await screen.findByRole("dialog", { name: "清空「邮件发送」在后台填写的设置？" });
  assert.match(dialog.textContent ?? "", /清空后邮件发送就是「未配置」，系统发不了邮件，直到重新填写。/);
  assertFocused(within(dialog).getByRole("button", { name: "取消" }));
  await actor.click(within(dialog).getByRole("button", { name: "清空" }));
  await screen.findByText("已清空「邮件发送」在后台填写的设置");
  assert.equal(writes(calls).length, 1);
  const text = (await findCard()).textContent ?? "";
  assert.match(text, /现在用的未配置/);
  assert.doesNotMatch(text, /邮件服务器|发件人/);
  await waitFor(() => assertFocused(within(screen.getByRole("region", { name: "邮件发送" })).getByRole("button", { name: "填写" })));

  resetBrowser();
  gone = true;
  current = secretsOf(filled({ env_configured: true }));
  open("super_admin", () => current, (call) => (call.method === "DELETE" ? apiError(409, "INTEGRATION_SECRET_NOT_SET", "后台没有填写这一项，不用清空") : null));
  await actor.click(within(await findCard()).getByRole("button", { name: "清空" }));
  const second = await screen.findByRole("dialog");
  assert.match(second.textContent ?? "", /服务器配置文件里也有这一项，清空后马上改用那里的值。/);
  await actor.click(within(second).getByRole("button", { name: "清空" }));
  await within(second).findByText(/后台已经没有填写这一项了/);
  assert.ok(within(second).getByRole("button", { name: "知道了" }));
});

test("后台那一份不能在这个环境用：提示不说测试密钥，说明原因和怎么办；服务器配置文件的那一份照样显示", async () => {
  open("super_admin", () => secretsOf(filled({ source: "env", source_label: "服务器配置文件", masked: "••••5678", env_configured: true, admin: { ...FILLED, problem: "NOT_ALLOWED_IN_ENV" } })));
  const text = (await findCard()).textContent ?? "";
  assert.match(text, /后台填写的那一份不能在这个环境用（不加密发信，或主机是内网地址），现在没有用它。请重新填写。/);
  assert.doesNotMatch(text, /测试密钥/);
  assert.match(text, /现在用的服务器配置文件（••••5678）/);
});
