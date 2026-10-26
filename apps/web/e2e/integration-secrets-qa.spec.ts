/**
 * 运营后台填写第三方密钥（M4-09，ADR 0041）的补充端到端测试（测试角色），真实后端 + 真实 PostgreSQL：
 * - Stripe 的填写对话框：键盘打开、焦点在第一项、Tab / Shift+Tab 不跑出对话框、Esc 关掉后焦点回到「填写」、再打开输入框是空的；
 *   前端的提示性检查（没填、填反了）和后端的逐项出错（非正式环境填了正式密钥）都落到字段上，焦点到第一个出错的；
 *   请求体里是去掉首尾空白的值；亮暗两套主题（对话框开着、带出错）过 axe；320 / 768 宽不横向滚动；
 *   页面、属性、存储、地址、控制台、请求地址里都没有密钥或它的片段。
 *   只提交会被后端拒绝的值，Stripe 从不真的保存（同一个库里别的用例要下单，不能让 Stripe 突然变成已配置）。
 * - 只读角色（技术）：看得到状态和来源，没有任何按钮、没有任何打码值；亮暗 axe、320 宽。
 */
import { randomBytes } from "node:crypto";
import { AxeBuilder } from "@axe-core/playwright";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { adminCredentials, expectNoHorizontalOverflow, loginAs, newPassword, platformAdminHeaders, uniqueEmail } from "./support.ts";

async function expectAxeClean(page: Page, what: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`), what).toEqual([]);
}

const PREFIXES = ["sk_live_", "pk_live_", "sk_test_", "pk_test_", "whsec_"];
const fakeKey = (prefix: string): string => `${prefix}${randomBytes(18).toString("hex")}`;

/** 一把密钥不能出现的片段：整把、去掉末 4 位的前段、去掉前缀后的任意 8 个字符。 */
function pieces(secret: string): string[] {
  const prefix = PREFIXES.find((p) => secret.startsWith(p)) ?? "";
  const body = secret.slice(prefix.length);
  const out = new Set([secret, secret.slice(0, -4)]);
  for (let i = 0; i + 8 <= body.length; i++) out.add(body.slice(i, i + 8));
  return [...out];
}

/** 页面上能看到、存下来的地方（不含输入框的 value 属性——那是浏览器内部的值，只查属性里没有） */
async function pageDump(page: Page): Promise<string> {
  return page.evaluate(() => {
    const storage = [localStorage, sessionStorage].flatMap((store) => Object.keys(store).map((key) => `${key}=${store.getItem(key) ?? ""}`)).join("\n");
    const attributes = [...document.querySelectorAll("*")].flatMap((node) => [...node.attributes].map((attr) => `${attr.name}=${attr.value}`)).join("\n");
    return [document.documentElement.outerHTML, document.body.innerText, attributes, storage, location.href, document.title, window.name, JSON.stringify(history.state), document.cookie].join("\n");
  });
}

function leaked(text: string, secrets: readonly string[]): string[] {
  return secrets.flatMap((secret) => pieces(secret).filter((piece) => text.includes(piece)).map((piece) => `${secret.slice(0, 8)}…（${piece.slice(0, 3)}…）`));
}

async function stripeAdminConfigured(request: APIRequestContext): Promise<boolean> {
  const res = await request.get("/platform/v1/integration-secrets", { headers: await platformAdminHeaders(request) });
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { items: { key: string; admin: { configured: boolean } | null }[] };
  return body.items.find((item) => item.key === "stripe")?.admin?.configured === true;
}

/**
 * 焦点没有落到对话框外面的页面元素上。对话框是原生的模态 <dialog>（showModal）：Tab 到最后一个后，浏览器会把焦点交给自己的地址栏等界面
 * （此时页面里的 activeElement 是 body），再按 Tab 回到对话框的第一个——这是浏览器的标准行为，不算跑出去。
 */
const focusInsideDialog = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const active = document.activeElement;
    return active === null || active === document.body || active.closest("dialog[open]") !== null;
  });

test("Stripe 填写对话框：键盘操作与焦点、前后端的出错落到字段、请求体去掉首尾空白、亮暗 axe、320 / 768 宽；任何地方都没有密钥片段，也没有真的保存", async ({ page, request }) => {
  const live = { secret_key: fakeKey("sk_live_"), publishable_key: fakeKey("pk_live_"), webhook_secret: fakeKey("whsec_") };
  const swapped = { secret_key: fakeKey("whsec_"), publishable_key: fakeKey("sk_test_"), webhook_secret: fakeKey("pk_test_") };
  const secrets = [...Object.values(live), ...Object.values(swapped)];
  const consoleLines: string[] = [];
  page.on("console", (message) => consoleLines.push(message.text()));
  const requested: string[] = [];
  const bodies: string[] = [];
  page.on("request", (sent) => {
    requested.push(sent.url());
    if (sent.method() === "PUT") bodies.push(sent.postData() ?? "");
  });
  expect(await stripeAdminConfigured(request), "开始时后台没有填 Stripe").toBe(false);

  const { email, password } = adminCredentials();
  await loginAs(page, "platform", email, password);
  await page.goto("/platform/settings/integrations");
  const card = page.getByRole("region", { name: "Stripe 支付" });
  const fill = card.getByRole("button", { name: "填写" });
  await expect(fill).toBeVisible();

  // 键盘打开，焦点在第一项；Tab / Shift+Tab 都不跑出对话框
  await fill.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "填写「Stripe 支付」的密钥" });
  await expect(dialog).toBeVisible();
  const secretInput = dialog.getByLabel("Secret key（sk_ 开头）");
  const publishableInput = dialog.getByLabel("Publishable key（pk_ 开头）");
  const webhookInput = dialog.getByLabel("Webhook signing secret（whsec_ 开头）");
  await expect(secretInput).toBeFocused();
  for (const input of [secretInput, publishableInput, webhookInput]) {
    await expect(input).toHaveAttribute("type", "password");
    await expect(input).toHaveAttribute("autocomplete", "off");
  }
  let landedInside = 0;
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(await focusInsideDialog(page), `第 ${i + 1} 次 Tab 后焦点没有落到对话框外的页面元素上`).toBe(true);
    if (await page.evaluate(() => document.activeElement?.closest("dialog[open]") !== null)) landedInside++;
  }
  expect(landedInside, "Tab 一直在对话框里的元素之间转").toBeGreaterThanOrEqual(10);
  await secretInput.focus();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await focusInsideDialog(page), `第 ${i + 1} 次 Shift+Tab 后焦点没有落到对话框外的页面元素上`).toBe(true);
  }

  // 什么都没填就保存：三项都提示，焦点到第一项；没有发请求
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(dialog.getByText("请粘贴这一项（Stripe 的三项要一起填）")).toHaveCount(3);
  await expect(secretInput).toBeFocused();
  expect(bodies, "前端拦下的不发请求").toEqual([]);

  // 三项填反了：前端按开头提示
  await secretInput.fill(swapped.secret_key);
  await publishableInput.fill(swapped.publishable_key);
  await webhookInput.fill(swapped.webhook_secret);
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(dialog.getByText(/开头不对/)).toHaveCount(3);
  await expect(secretInput).toBeFocused();
  expect(bodies).toEqual([]);

  // 粘贴正式密钥（带首尾空白和换行）：请求体是去掉空白的值；后端说这个环境只能用测试密钥，落到 Secret key 上
  await secretInput.fill(`  ${live.secret_key}\n`);
  await publishableInput.fill(`\t${live.publishable_key} `);
  await webhookInput.fill(`${live.webhook_secret}\r\n`);
  const responded = page.waitForResponse((res) => res.url().endsWith("/platform/v1/integration-secrets/stripe") && res.request().method() === "PUT");
  await dialog.getByRole("button", { name: "保存" }).click();
  const response = await responded;
  expect(response.status()).toBe(400);
  expect(leaked(await response.text(), secrets), "后端的出错里没有密钥").toEqual([]);
  expect(bodies).toHaveLength(1);
  expect(JSON.parse(bodies[0] ?? "{}"), "请求体里是去掉首尾空白的值").toEqual(live);
  await expect(dialog.getByText("这个环境只能用 Stripe 的测试密钥（sk_test_ 开头）")).toBeVisible();
  await expect(dialog.getByRole("alert").filter({ hasText: "有几项需要修改" })).toBeVisible();
  await expect(secretInput).toBeFocused();
  for (const input of [secretInput, publishableInput, webhookInput]) expect(await input.getAttribute("value"), "值不写进 value 属性").toBeNull();

  // 显示 / 隐藏：只是换输入框类型，值仍不进属性和页面文字
  await dialog.getByRole("button", { name: "显示密钥" }).first().click();
  await expect(secretInput).toHaveAttribute("type", "text");
  expect(leaked(await pageDump(page), secrets), "显示出来以后，值也不在属性、页面文字、存储、地址里").toEqual([]);
  await dialog.getByRole("button", { name: "隐藏密钥" }).first().click();
  await expect(secretInput).toHaveAttribute("type", "password");

  // 带出错的对话框：亮暗 axe、320 / 768 宽
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAxeClean(page, `${scheme === "light" ? "亮色" : "暗色"}主题下带出错的 Stripe 填写对话框`);
  }
  await page.emulateMedia({ colorScheme: "light" });
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 700 });
    await expectNoHorizontalOverflow(page, `${width}px 宽的 Stripe 填写对话框`);
    await expect(dialog.getByRole("button", { name: "保存" })).toBeInViewport();
  }
  await page.setViewportSize({ width: 1280, height: 800 });

  // Esc 关掉：焦点回到「填写」，再打开时输入框都是空的
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(fill).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  for (const input of [secretInput, publishableInput, webhookInput]) await expect(input).toHaveValue("");
  await expect(dialog.getByText("这个环境只能用 Stripe 的测试密钥（sk_test_ 开头）")).toHaveCount(0);
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(fill).toBeFocused();

  expect(leaked(await pageDump(page), secrets), "页面、属性、存储、地址里没有密钥片段").toEqual([]);
  expect(leaked(requested.join("\n"), secrets), "请求地址里没有").toEqual([]);
  expect(leaked(consoleLines.join("\n"), secrets), "控制台里没有").toEqual([]);
  expect(await stripeAdminConfigured(request), "后端拒绝了：后台仍没有 Stripe").toBe(false);
});

test("只读角色（技术）：第三方密钥只看得到状态和来源，没有填写 / 清空 / 测试一下，没有任何打码值；亮暗 axe、320 宽", async ({ browser, request }) => {
  const headers = await platformAdminHeaders(request);
  const techEmail = uniqueEmail("qa-secrets-tech");
  const invited = await request.post("/platform/v1/staff", { headers, data: { email: techEmail, name: `技术 ${randomBytes(3).toString("hex")}`, role: "tech" } });
  expect(invited.status(), await invited.text()).toBe(201);
  const techPassword = newPassword();
  const token = ((await invited.json()) as { invite: { token: string } }).invite.token;
  expect((await request.post("/platform/v1/auth/accept-invite", { data: { token, password: techPassword } })).ok()).toBe(true);

  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const listed: string[] = [];
    page.on("response", (res) => {
      if (res.url().includes("/platform/v1/integration-secrets")) void res.text().then((text) => listed.push(text)).catch(() => undefined);
    });
    await loginAs(page, "platform", techEmail, techPassword);
    await page.goto("/platform/settings/integrations");
    const section = page.getByRole("region", { name: "第三方密钥" });
    await expect(section.getByText("只有超级管理员可以填写、更换、清空和测试密钥。需要的话，请联系超级管理员。")).toBeVisible();
    for (const label of ["谷歌地图", "Stripe 支付"]) {
      const card = section.getByRole("region", { name: label });
      await expect(card).toContainText("现在用的");
      await expect(card).toContainText("服务器配置文件里");
      await expect(card).not.toContainText("后台填写的");
      for (const name of ["填写", "更换", "清空", "测试一下"]) await expect(card.getByRole("button", { name })).toHaveCount(0);
    }
    expect((await section.innerText()).includes("•"), "只读角色的页面上没有任何打码值").toBe(false);
    expect(listed.length, "取过一次第三方密钥").toBeGreaterThan(0);
    for (const text of listed) expect(text.includes("•"), "接口返回里也没有打码值").toBe(false);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expectAxeClean(page, `只读角色 ${scheme === "light" ? "亮色" : "暗色"}`);
    }
    await page.setViewportSize({ width: 320, height: 800 });
    await expectNoHorizontalOverflow(page, "320px 宽的只读第三方密钥");
  } finally {
    await context.close();
  }
});
