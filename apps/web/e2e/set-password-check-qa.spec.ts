/**
 * 测试角色补充（M1-13），真实浏览器 + 真实后端：设密码页打开时先核对链接。
 * `ui-fixes.spec.ts` 已覆盖「用过 / 作废的链接一打开就失效」；这里补：核对时断网 → 加载失败 → 重试 → 表单 → 设密码成功，
 * 全程令牌不在网址查询串、标题、存储、Cookie、任何请求的网址和请求头（含 Referer）里，核对请求只把它放在请求体；
 * 以及手机宽度下审计日志「筛选」面板填错日期后按 Esc 关掉、再打开不残留错误。
 */
import { type Page, type Request, expect, test } from "@playwright/test";
import { adminCredentials, createTenant, loginAs, newPassword } from "./support.ts";

async function tokenTraces(page: Page, token: string): Promise<string[]> {
  const found = await page.evaluate((secret) => {
    const out: string[] = [];
    if (location.search.includes(secret)) out.push("查询串");
    if (document.title.includes(secret)) out.push("标题");
    for (const [name, storage] of [["localStorage", localStorage], ["sessionStorage", sessionStorage]] as const) {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i) ?? "";
        if (key.includes(secret) || (storage.getItem(key) ?? "").includes(secret)) out.push(`${name} ${key}`);
      }
    }
    if (JSON.stringify(history.state ?? null).includes(secret)) out.push("history.state");
    if (document.body.innerText.includes(secret)) out.push("页面文字");
    for (const node of document.querySelectorAll("*")) {
      for (const attribute of node.attributes) if (attribute.value.includes(secret)) out.push(`<${node.tagName}> ${attribute.name}`);
    }
    return out;
  }, token);
  const cookies = (await page.context().cookies()).filter((cookie) => cookie.value.includes(token)).map((cookie) => `Cookie ${cookie.name}`);
  return [...found, ...cookies];
}

test("供应商邀请链接：核对时断网显示「加载失败」，点重试核对通过才出表单，设好密码回登录页；令牌只出现在核对和设密码两个请求的请求体里", async ({ page, request }) => {
  test.setTimeout(90_000);
  const invited = await createTenant(request);
  const token = invited.inviteToken;
  const requests: Request[] = [];
  page.on("request", (sent) => requests.push(sent));
  let block = true;
  await page.route("**/tenant/v1/auth/check-invite", (route) => (block ? route.abort("internetdisconnected") : route.continue()));

  await page.goto(`/accept-invite#token=${token}`);
  await expect(page.getByRole("heading", { level: 1, name: "加载失败" })).toBeVisible();
  await expect(page.getByText("邀请链接已失效")).toHaveCount(0);
  await expect(page.getByLabel("新密码")).toHaveCount(0);
  expect(await tokenTraces(page, token), "加载失败时").toEqual([]);

  block = false;
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByRole("button", { name: "设置密码并继续" })).toBeVisible();
  expect(await tokenTraces(page, token), "表单出来以后").toEqual([]);
  expect(new URL(page.url()).search, "令牌不在查询串里").toBe("");

  const password = newPassword();
  await page.getByLabel("新密码").fill(password);
  await page.getByLabel("再输入一次").fill(password);
  await page.getByRole("button", { name: "设置密码并继续" }).click();
  await expect(page.getByRole("status").filter({ hasText: "密码已设置，请登录。" })).toBeVisible();
  expect(page.url().includes(token), "跳到登录页后地址栏里不留令牌").toBe(false);
  expect(await tokenTraces(page, token), "跳到登录页以后").toEqual([]);

  const withToken = requests.filter((sent) => sent.url().includes(token) || JSON.stringify(sent.headers()).includes(token) || (sent.postData() ?? "").includes(token));
  for (const sent of withToken) {
    expect(sent.url().includes(token) || JSON.stringify(sent.headers()).includes(token), `${sent.method()} ${sent.url()} 的网址或请求头带了令牌`).toBe(false);
  }
  expect(withToken.map((sent) => `${sent.method()} ${new URL(sent.url()).pathname}`)).toEqual([
    "POST /tenant/v1/auth/check-invite",
    "POST /tenant/v1/auth/check-invite",
    "POST /tenant/v1/auth/accept-invite",
  ]);

  // 用掉以后再打开：直接失效
  await page.goto(`/accept-invite#token=${token}`);
  await expect(page.getByRole("heading", { level: 1, name: "邀请链接已失效" })).toBeVisible();
});

test("手机宽度审计日志「筛选」面板：填了不存在的日期被拦下，按 Esc 关掉再打开，不残留上次的错误提示", async ({ page }) => {
  test.setTimeout(60_000);
  const admin = adminCredentials();
  await page.setViewportSize({ width: 375, height: 800 });
  await loginAs(page, "platform", admin.email, admin.password);
  await page.goto("/platform/settings/audit-logs");
  const toggle = page.getByRole("button", { name: /^筛选/ });
  await toggle.click();
  const panel = page.getByRole("dialog", { name: "筛选" });
  await panel.locator("#audit-panel-from").fill("2026-02-30");
  await panel.getByRole("button", { name: "查看结果" }).click();
  await expect(panel.getByText("这不是一个日期，请按 2026-10-08 的格式填写")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await toggle.click();
  await expect(panel).toBeVisible();
  await expect(panel.getByText("这不是一个日期，请按 2026-10-08 的格式填写")).toHaveCount(0);
  await expect(panel.locator("#audit-panel-from")).toHaveValue("");
});
