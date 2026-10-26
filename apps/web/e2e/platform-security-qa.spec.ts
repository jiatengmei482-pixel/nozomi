/**
 * 测试角色补充（M4-05，ADR 0030）端到端：账号安全的页面在 320px 宽、亮暗两套主题下没有横向溢出、没有无障碍问题；
 * 恢复码和密钥只显示一次——不在地址、浏览器存储里，刷新后不再出现。
 * 全部数据经真实接口创建在本次运行的临时 schema 里。
 */
import { AxeBuilder } from "@axe-core/playwright";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { nextCode, rememberSecret } from "./mfa.ts";
import { adminCredentials, expectNoHorizontalOverflow, fillLogin, loginAs, newPassword, platformAdminHeaders, uniqueEmail } from "./support.ts";

const NARROW = { width: 320, height: 640 };

async function expectAccessible(page: Page, what: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = results.violations.map((violation) => `${violation.id}: ${violation.help}（${violation.nodes.map((node) => node.target.join(" ")).join("；")}）`);
  expect(summary, `${what} 的无障碍问题`).toEqual([]);
}

/** 320px、亮暗两套主题各查一遍横向溢出和无障碍，查完回到亮色。 */
async function checkNarrowBothThemes(page: Page, what: string): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectNoHorizontalOverflow(page, `${what}（${scheme}，320px）`);
    await expectAccessible(page, `${what}（${scheme}，320px）`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

async function invitedStaff(request: APIRequestContext): Promise<{ email: string; password: string }> {
  const headers = await platformAdminHeaders(request);
  const email = uniqueEmail("m405-qa");
  const created = await request.post("/platform/v1/staff", { headers, data: { email, name: "安全验收", role: "readonly" } });
  expect(created.status(), await created.text()).toBe(201);
  const body = (await created.json()) as { invite: { token: string } };
  const password = newPassword();
  expect((await request.post("/platform/v1/auth/accept-invite", { data: { token: body.invite.token, password } })).ok()).toBe(true);
  return { email, password };
}

/** 浏览器里留下的东西：地址、两种存储、历史记录的状态。 */
async function browserTraces(page: Page): Promise<string> {
  return page.evaluate(() => {
    const dump = (store: Storage): Record<string, string | null> => Object.fromEntries(Array.from({ length: store.length }, (_, i) => store.key(i) as string).map((key) => [key, store.getItem(key)]));
    return JSON.stringify({ href: location.href, local: dump(localStorage), session: dump(sessionStorage), history: history.state, cookie: document.cookie });
  });
}

test("绑定页、恢复码页、动态码页、恢复码输入、账号安全页：320px 亮暗两套主题无溢出、无无障碍问题；恢复码和密钥不进地址和存储，刷新后不再出现", async ({ page, request }) => {
  test.setTimeout(180_000);
  const staff = await invitedStaff(request);
  await page.setViewportSize(NARROW);
  await page.goto("/platform/login");
  await fillLogin(page, staff.email, staff.password, { secondFactor: "manual" });
  await expect(page.getByRole("heading", { level: 1, name: "绑定两步验证" })).toBeVisible();
  await expect(page.getByRole("img", { name: "绑定两步验证的二维码" })).toBeVisible();
  await expect(page.locator(".mfa-secret__value")).toBeVisible();
  await checkNarrowBothThemes(page, "绑定两步验证页");
  const secret = ((await page.locator(".mfa-secret__value").textContent()) ?? "").replace(/\s/g, "");
  rememberSecret(staff.email, secret);
  expect(await browserTraces(page)).not.toContain(secret);

  await page.getByLabel("动态码").fill("000000");
  await page.getByRole("button", { name: "完成绑定" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "动态码或恢复码不对" })).toBeVisible();
  await checkNarrowBothThemes(page, "绑定两步验证页（动态码不对）");

  await page.getByLabel("动态码").fill((await nextCode(secret)).code);
  await page.getByRole("button", { name: "完成绑定" }).click();
  const codes = page.getByRole("list", { name: "恢复码" }).getByRole("listitem");
  await expect(codes).toHaveCount(10);
  await checkNarrowBothThemes(page, "恢复码页");
  const shown = (await codes.allTextContents()).map((text) => text.trim());
  const traces = await browserTraces(page);
  for (const code of shown) {
    expect(traces, "恢复码不进地址和存储").not.toContain(code);
    expect(traces).not.toContain(code.replace(/[\s-]/g, ""));
  }
  expect(traces).not.toContain(secret);

  // 刷新：恢复码不再出现（绑定已完成，直接进页面）
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("list", { name: "恢复码" })).toHaveCount(0);
  const body = (await page.locator("body").textContent()) ?? "";
  for (const code of shown) expect(body).not.toContain(code);

  // 再登录一次：动态码页、恢复码输入
  await page.getByRole("button", { name: /账号菜单/ }).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await fillLogin(page, staff.email, staff.password, { secondFactor: "manual" });
  await expect(page.getByRole("heading", { level: 1, name: "两步验证" })).toBeVisible();
  await checkNarrowBothThemes(page, "输入动态码页");
  await page.getByRole("button", { name: "手机不在身边？用恢复码" }).click();
  await expect(page.getByLabel("恢复码")).toBeVisible();
  await checkNarrowBothThemes(page, "输入恢复码页");
  await page.getByLabel("恢复码").fill(shown[0] as string);
  await page.getByRole("button", { name: "验证", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();

  await page.getByRole("button", { name: /账号菜单/ }).click();
  await page.getByRole("menuitem", { name: "账号安全" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "账号安全" })).toBeVisible();
  await expect(page.getByText("9 个")).toBeVisible();
  await checkNarrowBothThemes(page, "账号安全页");
});

test("角色列表、新建角色页：320px 亮暗两套主题无溢出、无无障碍问题", async ({ page }) => {
  test.setTimeout(120_000);
  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);
  await page.setViewportSize(NARROW);
  await page.goto("/platform/settings/roles");
  await expect(page.getByRole("heading", { level: 1, name: "角色" })).toBeVisible();
  await expect(page.getByRole("region", { name: "角色列表" })).toContainText("超级管理员");
  await checkNarrowBothThemes(page, "角色列表页");
  await page.getByRole("link", { name: "新建角色" }).click();
  await expect(page.getByLabel("名字")).toBeVisible();
  await checkNarrowBothThemes(page, "新建角色页");
  await page.getByRole("button", { name: "新建" }).click();
  await checkNarrowBothThemes(page, "新建角色页（没填名字）");
});
