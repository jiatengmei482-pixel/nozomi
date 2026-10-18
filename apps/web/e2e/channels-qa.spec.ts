/**
 * 渠道、待审核页面（M2-04）测试角色补充：真实后端、真实 PostgreSQL。
 * - 亮色 / 暗色各做 axe 检查：渠道列表、新建渠道、渠道详情（含加价规则、定价参数、暂停的对话框）、密钥只显示一次的对话框、待审核队列；
 * - 320px 宽度下这些页面和对话框都不横向滚动；
 * - 密钥只显示一次：关掉后刷新、后退再前进，页面、本地存储、网址、标题里都没有原文；
 * - 待审核：发起人自己的那条没有「批准」「驳回」，另一位同事的有。
 */
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { adminCredentials, expectNoHorizontalOverflow, loginAs, newPassword, platformAdminHeaders, uniqueEmail } from "./support.ts";

async function expectAccessible(page: Page, what: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = results.violations.map((violation) => `${violation.id}: ${violation.help}（${violation.nodes.map((node) => node.target.join(" ")).join("；")}）`);
  expect(summary, `${what} 的无障碍问题`).toEqual([]);
}

async function createStaff(request: APIRequestContext, role: string, name: string): Promise<{ email: string; password: string; headers: Record<string, string> }> {
  const headers = await platformAdminHeaders(request);
  const email = uniqueEmail(`m204qa-${role}`);
  const created = await request.post("/platform/v1/staff", { headers, data: { email, name, role } });
  expect(created.status(), await created.text()).toBe(201);
  const password = newPassword();
  const accepted = await request.post("/platform/v1/auth/accept-invite", { data: { token: ((await created.json()) as { invite: { token: string } }).invite.token, password } });
  expect(accepted.ok(), "接受邀请").toBe(true);
  const login = await request.post("/platform/v1/auth/login", { data: { email, password } });
  return { email, password, headers: { authorization: `Bearer ${((await login.json()) as { access_token: string }).access_token}` } };
}

/** 一个渠道，带一条已经生效的规则、一个 API 客户端，以及另一位渠道经理发起的一条待审核 */
async function channelWithPending(request: APIRequestContext): Promise<{ id: string; name: string }> {
  const admin = await platformAdminHeaders(request);
  const name = `QA 渠道 ${crypto.randomUUID().slice(0, 6)}`;
  const created = await request.post("/platform/v1/channels", { headers: admin, data: { name, type: "own", settle_currency: "JPY" } });
  expect(created.status(), await created.text()).toBe(201);
  const id = ((await created.json()) as { channel: { id: string } }).channel.id;
  const other = await createStaff(request, "channel_manager", "QA 同事");
  const rule = await request.post(`/platform/v1/channels/${id}/markup-rules`, { headers: other.headers, data: { markup_bp: 1200, valid_from: "2026-12-01", valid_to: "2026-12-31", note: "年末促销" } });
  expect(rule.status(), await rule.text()).toBe(202);
  const approval = ((await rule.json()) as { approval: { id: string } }).approval.id;
  expect((await request.post(`/platform/v1/approvals/${approval}/approve`, { headers: admin, data: {} })).status()).toBe(200);
  const pending = await request.post(`/platform/v1/channels/${id}/pricing-changes`, { headers: other.headers, data: { default_markup_bp: 1300, request_note: "旺季" } });
  expect(pending.status(), await pending.text()).toBe(202);
  const mine = await request.post(`/platform/v1/channels/${id}/pause`, { headers: admin, data: { request_note: "QA 自己发起" } });
  expect(mine.status(), await mine.text()).toBe(202);
  expect((await request.post(`/platform/v1/channels/${id}/api-clients`, { headers: admin, data: { name: "QA 已有客户端" } })).status()).toBe(201);
  return { id, name };
}

async function signIn(page: Page): Promise<void> {
  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);
}

async function openDetail(page: Page, channel: { id: string; name: string }): Promise<void> {
  await page.goto(`/platform/channels/${channel.id}`);
  await expect(page.getByRole("heading", { level: 1, name: channel.name })).toBeVisible();
  await expect(page.getByRole("region", { name: "API 客户端", exact: true })).toBeVisible();
}

async function showSecret(page: Page): Promise<string> {
  await page.getByRole("button", { name: /新建 API 客户端/ }).click();
  const form = page.getByRole("dialog", { name: "新建 API 客户端" });
  await form.getByRole("textbox", { name: "名称" }).fill(`QA ${crypto.randomUUID().slice(0, 4)}`);
  await form.getByRole("button", { name: "新建并显示密钥" }).click();
  const dialog = page.getByRole("dialog", { name: "API 密钥（只显示这一次）" });
  const secret = await dialog.getByRole("textbox", { name: "client_secret" }).inputValue();
  expect(secret).toMatch(/^nzs_/);
  return secret;
}

async function closeSecret(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "API 密钥（只显示这一次）" });
  await dialog.getByRole("button", { name: "我已保存好，关闭" }).click();
  await dialog.getByRole("button", { name: "不复制，关闭" }).click();
  await expect(dialog).toHaveCount(0);
}

async function expectSecretNowhere(page: Page, secret: string, what: string): Promise<void> {
  await expect(page.locator("body"), `${what}：页面上`).not.toContainText(secret);
  expect(page.url(), `${what}：网址`).not.toContain(secret);
  expect(await page.title(), `${what}：标题`).not.toContain(secret);
  const stored = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, history.state]));
  expect(stored, `${what}：本地存储 / 历史状态`).not.toContain(secret);
  expect(await page.content(), `${what}：页面源码`).not.toContain(secret);
}

for (const scheme of ["light", "dark"] as const) {
  test(`${scheme === "light" ? "亮色" : "暗色"}：渠道列表、新建、详情和各个对话框、密钥对话框、待审核都通过 axe 检查`, async ({ page, request }) => {
    test.setTimeout(120_000);
    const channel = await channelWithPending(request);
    await page.emulateMedia({ colorScheme: scheme });
    await signIn(page);
    await page.goto("/platform/channels");
    await expect(page.getByRole("link", { name: channel.name })).toBeVisible();
    await expectAccessible(page, `渠道列表（${scheme}）`);
    await page.goto("/platform/channels/new");
    await expect(page.getByRole("textbox", { name: "名称" })).toBeVisible();
    await page.getByRole("button", { name: "新建", exact: true }).click();
    await expect(page.getByText("请选择渠道类型")).toBeVisible();
    await expectAccessible(page, `新建渠道（带校验错误，${scheme}）`);
    await openDetail(page, channel);
    await expect(page.locator('[aria-label="加价规则"]')).toContainText("12%");
    await expectAccessible(page, `渠道详情（${scheme}）`);
    for (const [button, dialog] of [[/新增加价规则/, "新增加价规则"], ["申请修改定价参数", /定价参数/]] as const) {
      await page.getByRole("button", { name: button }).click();
      const opened = page.getByRole("dialog", { name: dialog });
      await expect(opened).toBeVisible();
      await expectAccessible(page, `对话框 ${String(dialog)}（${scheme}）`);
      await opened.getByRole("button", { name: "取消" }).click();
      await expect(opened).toHaveCount(0);
    }
    await showSecret(page);
    await expectAccessible(page, `密钥对话框（${scheme}）`);
    await closeSecret(page);
    await page.goto("/platform/approvals");
    await expect(page.locator(".approval-card").filter({ hasText: channel.name }).first()).toBeVisible();
    await expectAccessible(page, `待审核（${scheme}）`);
  });
}

test("320px 宽：渠道列表、新建、详情、加价规则对话框、密钥对话框、待审核都不横向滚动", async ({ page, request }) => {
  test.setTimeout(120_000);
  const channel = await channelWithPending(request);
  await page.setViewportSize({ width: 320, height: 640 });
  await signIn(page);
  await page.goto("/platform/channels");
  await expect(page.getByRole("link", { name: channel.name })).toBeVisible();
  await expectNoHorizontalOverflow(page, "渠道列表（320px）");
  await page.goto("/platform/channels/new");
  await expect(page.getByRole("textbox", { name: "名称" })).toBeVisible();
  await expectNoHorizontalOverflow(page, "新建渠道（320px）");
  await openDetail(page, channel);
  await expectNoHorizontalOverflow(page, "渠道详情（320px）");
  await page.getByRole("button", { name: /新增加价规则/ }).click();
  await expect(page.getByRole("dialog", { name: "新增加价规则" })).toBeVisible();
  await expectNoHorizontalOverflow(page, "新增加价规则对话框（320px）");
  await page.getByRole("dialog", { name: "新增加价规则" }).getByRole("button", { name: "取消" }).click();
  await showSecret(page);
  await expectNoHorizontalOverflow(page, "密钥对话框（320px）");
  await closeSecret(page);
  await page.goto("/platform/approvals");
  await expect(page.locator(".approval-card").filter({ hasText: channel.name }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page, "待审核（320px）");
});

test("密钥只显示一次：关掉后刷新、后退再前进，页面、本地存储、网址、标题、页面源码里都没有原文；列表只有后 4 位", async ({ page, request }) => {
  test.setTimeout(90_000);
  const channel = await channelWithPending(request);
  await signIn(page);
  await openDetail(page, channel);
  const secret = await showSecret(page);
  expect(page.url()).not.toContain(secret);
  expect(await page.title()).not.toContain(secret);
  expect(await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]))).not.toContain(secret);
  await closeSecret(page);
  await expectSecretNowhere(page, secret, "关掉以后");
  await expect(page.getByRole("region", { name: "API 客户端", exact: true })).toContainText(`••••${secret.slice(-4)}`);
  await page.reload();
  await expect(page.getByRole("region", { name: "API 客户端", exact: true })).toContainText(`••••${secret.slice(-4)}`);
  await expectSecretNowhere(page, secret, "刷新以后");
  await page.goto("/platform/channels");
  await expect(page.getByRole("link", { name: channel.name })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: channel.name })).toBeVisible();
  await expectSecretNowhere(page, secret, "后退回来");
  await page.goForward();
  await expect(page.getByRole("link", { name: channel.name })).toBeVisible();
  await expectSecretNowhere(page, secret, "再前进");
});

test("待审核：自己发起的那条只有「撤回」，同事发起的有「批准」「驳回」", async ({ page, request }) => {
  test.setTimeout(90_000);
  const channel = await channelWithPending(request);
  await signIn(page);
  await page.goto("/platform/approvals");
  const cards = page.locator(".approval-card").filter({ hasText: channel.name });
  const mine = cards.filter({ hasText: "QA 自己发起" });
  const theirs = cards.filter({ hasText: "旺季" });
  await expect(mine).toHaveCount(1);
  await expect(mine.getByRole("button", { name: "批准" })).toHaveCount(0);
  await expect(mine.getByRole("button", { name: "驳回" })).toHaveCount(0);
  await expect(mine.getByRole("button", { name: "撤回" })).toBeVisible();
  await expect(theirs.getByRole("button", { name: "批准" })).toBeVisible();
  await expect(theirs.getByRole("button", { name: "驳回" })).toBeVisible();
  await expect(theirs.getByRole("button", { name: "撤回" })).toHaveCount(0);
});
