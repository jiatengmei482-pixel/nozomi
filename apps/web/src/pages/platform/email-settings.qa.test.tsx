/**
 * QA（M4-14，ADR 0048）：「邮件发送」卡片的组件测试，开发的 email-settings.test.tsx 没有覆盖的部分：
 * 取消后不留密码、配置文件来源时的表单、其余字段的后端出错和焦点、端口的边界、连点、保存失败后的状态、测试进行中配置被换掉。
 * 接口用测试替身，值都是虚构的。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { IntegrationSecretItem, IntegrationSecrets, SmtpSettings } from "../../api/platform.ts";
import type { PlatformUser } from "../../api/types.ts";
import { roleName } from "../../lib/portal.ts";
import { type ApiCall, apiError, assertFocused, deferred, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";

const PASSWORD = "qa-fake-pass-0123456789-WXYZ";
const PORT_LABEL = "端口（25、465、587、2525）";
const ME_ID = "11111111-1111-4111-8111-111111111111";
const meOf = (role: string): PlatformUser => ({ id: ME_ID, email: "qa@example.test", name: "QA", role, role_name: roleName("platform", role) ?? role, status: "active", created_at: "2026-10-06T00:12:00.000Z", updated_at: "2026-10-08T05:30:00.000Z" });

const NOT_FILLED = { configured: false, hints: null, updated_at: null, updated_by: null, problem: null } as const;
const FILLED = { configured: true, hints: { password: "••••WXYZ" }, updated_at: "2026-11-01T01:02:00.000Z", updated_by: { id: ME_ID, name: "QA" }, problem: null };
const SMTP: SmtpSettings = { host: "smtp.example.test", port: 587, encryption: "starttls", username: "qa-mailer@example.test", from_name: "NOZOMI 用车", from_address: "noreply@example.test" };

const email = (changes: Partial<IntegrationSecretItem> = {}): IntegrationSecretItem => ({
  key: "email",
  label: "邮件发送",
  fields: [
    { name: "host", label: "SMTP 主机" },
    { name: "port", label: PORT_LABEL },
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
const secretsOf = (item: IntegrationSecretItem): IntegrationSecrets => ({ precedence_note: "运营后台填写的优先；后台没填（或清空后）才用服务器配置文件里的值。", can_manage: true, encryption_configured: true, items: [item] });

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;
function open(secrets: () => IntegrationSecrets, routes: Route = () => null): ApiCall[] {
  signIn("platform", "platform-token");
  const calls = stubApiWith((call) => {
    const custom = routes(call);
    if (custom !== null) return custom;
    if (call.method !== "GET") return null;
    const at = call.url.pathname;
    if (at === "/platform/v1/auth/me") return json(200, { user: meOf("super_admin"), permissions: [], must_change_password: false });
    if (at === "/platform/v1/integrations") return json(200, { items: [], fx_center: { state: "fresh", as_of: "2026-10-17T00:02:32.000Z", auto_fetch: true, last_attempt_status: "accepted", last_attempt_at: "2026-10-17T09:24:00.000Z", last_error_code: null }, routes: { day: "2026-10-17", calls: 0, daily_limit: 1000, daily_limit_reached: false, failures: 0, refused: 0, last_success_at: null, last_failure: null } });
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

const findCard = (): Promise<HTMLElement> => screen.findByRole("region", { name: "邮件发送" });
const writes = (calls: ApiCall[]): ApiCall[] => calls.filter((call) => call.method !== "GET");
const inputOf = (dialog: HTMLElement, label: string): HTMLInputElement => within(dialog).getByLabelText(label) as HTMLInputElement;
const errorOf = (input: HTMLElement): string => (input.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
const saveButton = (dialog: HTMLElement): HTMLElement => within(dialog).getByRole("button", { name: /保存/ });

async function pastePassword(actor: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, value = PASSWORD): Promise<void> {
  await actor.click(inputOf(dialog, "密码"));
  await actor.paste(value);
}

afterEach(() => {
  resetBrowser();
});

test("填了密码又取消：再打开时密码是空的，改过的主机也退回原值，什么请求都没发", async () => {
  const actor = userEvent.setup();
  const calls = open(() => secretsOf(filled()));
  const card = await findCard();
  await actor.click(within(card).getByRole("button", { name: "更换" }));
  let dialog = await screen.findByRole("dialog");
  await pastePassword(actor, dialog);
  const host = inputOf(dialog, "SMTP 主机");
  await actor.clear(host);
  await actor.type(host, "smtp.other.test");
  await actor.click(within(dialog).getByRole("button", { name: "取消" }));
  await waitFor(() => assert.ok(screen.queryByRole("dialog") === null, "对话框应当已关闭"));
  assert.ok(!document.documentElement.outerHTML.includes(PASSWORD));

  await actor.click(within(card).getByRole("button", { name: "更换" }));
  dialog = await screen.findByRole("dialog");
  assert.equal(inputOf(dialog, "密码").value, "");
  assert.equal(inputOf(dialog, "SMTP 主机").value, SMTP.host);
  assert.equal(writes(calls).length, 0);
});

test("密码框不让浏览器帮忙：type=password、autocomplete=new-password，其余几项不自动填", async () => {
  const actor = userEvent.setup();
  open(() => secretsOf(email()));
  await actor.click(within(await findCard()).getByRole("button", { name: "填写" }));
  const dialog = await screen.findByRole("dialog");
  const password = inputOf(dialog, "密码");
  assert.equal(password.type, "password");
  assert.equal(password.getAttribute("autocomplete"), "new-password");
  for (const label of ["SMTP 主机", PORT_LABEL, "用户名", "发件人名称", "发件人地址"]) assert.equal(inputOf(dialog, label).getAttribute("autocomplete"), "off", label);
  await pastePassword(actor, dialog);
  assert.equal(password.getAttribute("value"), null, "原文不写进 value 属性");
  assert.ok(!document.documentElement.outerHTML.includes(PASSWORD));
});

test("现在用的是服务器配置文件：按钮是「填写」、没有「清空」；表单带上配置文件里不是密钥的几项，密码是空的", async () => {
  const actor = userEvent.setup();
  open(() => secretsOf(email({ state: "configured", source: "env", source_label: "服务器配置文件", masked: "••••ENVV", settings: SMTP, env_configured: true })));
  const card = await findCard();
  assert.equal(within(card).queryAllByRole("button", { name: "清空" }).length, 0);
  await actor.click(within(card).getByRole("button", { name: "填写" }));
  const dialog = await screen.findByRole("dialog", { name: "填写「邮件发送」的设置" });
  assert.equal(inputOf(dialog, "SMTP 主机").value, SMTP.host);
  assert.equal(inputOf(dialog, "密码").value, "");
  assert.ok(!dialog.innerHTML.includes("ENVV"));
});

test("后台那一份解不开、配置文件也没有：未配置，可以更换和清空，没有「测试一下」；表单不带任何旧值", async () => {
  const actor = userEvent.setup();
  open(() => secretsOf(email({ admin: { ...FILLED, problem: "UNREADABLE" } })));
  const card = await findCard();
  assert.match(card.textContent ?? "", /读不出来/);
  assert.equal(within(card).queryAllByRole("button", { name: "测试一下" }).length, 0);
  assert.equal(within(card).getAllByRole("button", { name: "清空" }).length, 1);
  await actor.click(within(card).getByRole("button", { name: "更换" }));
  const dialog = await screen.findByRole("dialog");
  for (const label of ["SMTP 主机", PORT_LABEL, "用户名", "密码", "发件人名称", "发件人地址"]) assert.equal(inputOf(dialog, label).value, "", label);
  assert.equal((within(dialog).getByLabelText("加密方式") as HTMLSelectElement).value, "tls");
});

test("后端说用户名、密码、发件人名称、发件人地址不合格：错误落到各自字段，焦点按页面顺序到第一处，开始修改后这一项的错误消失", async () => {
  const actor = userEvent.setup();
  const issue = (path: string, message: string) => ({ path, reason: "FORMAT", message });
  open(() => secretsOf(filled()), (call) => (call.method === "PUT" ? apiError(400, "VALIDATION_FAILED", "请求参数校验未通过", { location: "body", issues: [issue("/from_address", "地址不合格"), issue("/from_name", "名称不合格"), issue("/password", "密码不合格"), issue("/username", "用户名不合格")] }) : null));
  await actor.click(within(await findCard()).getByRole("button", { name: "更换" }));
  const dialog = await screen.findByRole("dialog");
  await pastePassword(actor, dialog);
  await actor.click(saveButton(dialog));
  await waitFor(() => assert.match(errorOf(inputOf(dialog, "用户名")), /用户名不合格/));
  assert.match(errorOf(inputOf(dialog, "密码")), /密码不合格/);
  assert.match(errorOf(inputOf(dialog, "发件人名称")), /名称不合格/);
  assert.match(errorOf(inputOf(dialog, "发件人地址")), /地址不合格/);
  assert.equal(inputOf(dialog, "用户名").getAttribute("aria-invalid"), "true");
  assertFocused(inputOf(dialog, "用户名"));
  assert.match(within(dialog).getByRole("alert").textContent ?? "", /有几项需要修改/);
  assert.equal(inputOf(dialog, "密码").value, PASSWORD, "填过的密码保留，不用重新粘贴");
  await actor.type(inputOf(dialog, "用户名"), "x");
  assert.doesNotMatch(errorOf(inputOf(dialog, "用户名")), /用户名不合格/);
  assert.match(errorOf(inputOf(dialog, "密码")), /密码不合格/);
  assert.ok(!document.documentElement.outerHTML.includes(PASSWORD));
});

test("端口的边界：0、65536、小数、负数、科学计数、全角、中间有空格都在前端拦下；0587 按 587 提交，提交的是数字", async () => {
  const actor = userEvent.setup();
  const calls = open(() => secretsOf(filled()), (call) => (call.method === "PUT" ? json(200, { action: "replace", item: filled() }) : null));
  await actor.click(within(await findCard()).getByRole("button", { name: "更换" }));
  const dialog = await screen.findByRole("dialog");
  await pastePassword(actor, dialog);
  const port = inputOf(dialog, PORT_LABEL);
  for (const value of ["0", "65536", "587.5", "-25", "1e3", "５８７", "5 87", "0x24b"]) {
    await actor.clear(port);
    await actor.type(port, value);
    await actor.click(saveButton(dialog));
    assert.equal(writes(calls).length, 0, value);
    assert.match(errorOf(port), /端口是一个数字/, value);
    assertFocused(port);
  }
  await actor.clear(port);
  await actor.type(port, "0587");
  await actor.click(saveButton(dialog));
  await waitFor(() => assert.equal(writes(calls).length, 1));
  assert.equal((writes(calls)[0]?.body as { port: unknown }).port, 587);
});

test("保存连点两次、回车再点：只发一次请求", async () => {
  const actor = userEvent.setup();
  const reply = deferred();
  const calls = open(() => secretsOf(filled()), (call) => (call.method === "PUT" ? reply.promise : null));
  await actor.click(within(await findCard()).getByRole("button", { name: "更换" }));
  const dialog = await screen.findByRole("dialog");
  await pastePassword(actor, dialog);
  const button = saveButton(dialog);
  await actor.click(button);
  await actor.click(button);
  await actor.type(inputOf(dialog, "密码"), "{Enter}");
  assert.equal(writes(calls).length, 1);
  reply.resolve(json(200, { action: "replace", item: filled() }));
  await waitFor(() => assert.ok(screen.queryByRole("dialog") === null, "对话框应当已关闭"));
});

test("「测试一下」连点：只发一次请求，按钮显示测试中", async () => {
  const actor = userEvent.setup();
  const reply = deferred();
  const calls = open(() => secretsOf(filled()), (call) => (call.method === "POST" ? reply.promise : null));
  const card = await findCard();
  const button = within(card).getByRole("button", { name: "测试一下" });
  await actor.click(button);
  assert.match(button.textContent ?? "", /测试中/);
  await actor.click(button);
  assert.equal(writes(calls).length, 1);
  reply.resolve(json(200, { key: "email", ok: true, code: null, message: "邮件服务器已接收", source: "admin", source_label: "后台设置", tested_at: "2026-11-01T03:04:05.000Z" }));
  await waitFor(() => assert.match(card.textContent ?? "", /邮件服务器已接收/));
});

test("保存时服务器出错（500）：对话框留着、说明没有保存、卡片不变、再点能重试；错误说明里没有密码", async () => {
  const actor = userEvent.setup();
  let attempts = 0;
  const calls = open(() => secretsOf(filled()), (call) => {
    if (call.method !== "PUT") return null;
    attempts += 1;
    return attempts === 1 ? apiError(500, "INTERNAL_ERROR", "服务器内部错误，请稍后重试") : json(200, { action: "replace", item: filled({ masked: "••••NEW1" }) });
  });
  const card = await findCard();
  await actor.click(within(card).getByRole("button", { name: "更换" }));
  const dialog = await screen.findByRole("dialog");
  await pastePassword(actor, dialog);
  await actor.click(saveButton(dialog));
  await waitFor(() => assert.match(within(dialog).getByRole("alert").textContent ?? "", /没有保存/));
  assert.match(card.textContent ?? "", /••••WXYZ/);
  assert.ok(!document.documentElement.outerHTML.includes(PASSWORD));
  await actor.click(saveButton(dialog));
  await waitFor(() => assert.ok(screen.queryByRole("dialog") === null, "对话框应当已关闭"));
  assert.equal(writes(calls).length, 2);
  assert.match(card.textContent ?? "", /••••NEW1/);
});

test("测试结果里接口给的未知原因：显示接口自己那一句；不认识的原因不会变成空白", async () => {
  const actor = userEvent.setup();
  open(() => secretsOf(filled()), (call) => (call.method === "POST" ? json(200, { key: "email", ok: false, code: "SOMETHING_NEW", message: "接口给的一句话", source: "admin", source_label: "后台设置", tested_at: "2026-11-01T03:04:05.000Z" }) : null));
  const card = await findCard();
  await actor.click(within(card).getByRole("button", { name: "测试一下" }));
  await waitFor(() => assert.match(card.textContent ?? "", /接口给的一句话/));
});

test("测试进行中把配置换了：旧配置的测试结果回来时不能显示在新配置上（页面写的是「测的是后台设置里的那一份」）", async () => {
  const actor = userEvent.setup();
  const reply = deferred();
  let current = filled();
  open(() => secretsOf(current), (call) => {
    if (call.method === "POST") return reply.promise;
    if (call.method === "PUT") {
      current = filled({ masked: "••••NEW1", settings: { ...SMTP, host: "smtp.new.test" }, admin: { ...FILLED, updated_at: "2026-11-01T01:09:00.000Z" } });
      return json(200, { action: "replace", item: current });
    }
    return null;
  });
  const card = await findCard();
  await actor.click(within(card).getByRole("button", { name: /测试/ }));
  await actor.click(within(card).getByRole("button", { name: "更换" }));
  const dialog = await screen.findByRole("dialog");
  await pastePassword(actor, dialog);
  await actor.click(saveButton(dialog));
  await waitFor(() => assert.match(card.textContent ?? "", /smtp\.new\.test/));

  reply.resolve(json(200, { key: "email", ok: true, code: null, message: "旧配置的结果：邮件服务器已接收", source: "admin", source_label: "后台设置", tested_at: "2026-11-01T01:08:00.000Z" }));
  await new Promise((done) => setTimeout(done, 50));
  assert.doesNotMatch(card.querySelector('[role="status"]')?.textContent ?? "", /旧配置的结果/);
});

