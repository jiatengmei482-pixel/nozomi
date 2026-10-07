/**
 * 临时密码与首次登录强制修改密码（ADR 0013），真实后端。
 * 带标记的账号用真实的命令行 `admin-create.ts --temporary-password` 创建，临时密码从它的标准输出里读。
 */
import { AxeBuilder } from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
import { createTemporaryPasswordAdmin, detail, expectNoHorizontalOverflow, fillLogin, newPassword } from "./support.ts";

const WARNING = "你正在使用临时密码，请先设置新密码。设置完成前不能使用其他功能。";

async function expectAccessible(page: Page, what: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = results.violations.map((violation) => `${violation.id}: ${violation.help}（${violation.nodes.map((node) => node.target.join(" ")).join("；")}）`);
  expect(summary, `${what} 的无障碍问题`).toEqual([]);
}

async function expectForcedPage(page: Page, what: string): Promise<void> {
  await expect(page, what).toHaveURL(/\/platform\/account\/password$/);
  await expect(page.getByRole("alert").filter({ hasText: WARNING }), what).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "修改密码" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "主菜单" }), `${what}：不显示导航`).toHaveCount(0);
  await expect(page.getByRole("button", { name: "打开菜单" })).toHaveCount(0);
}

test("临时密码登录 → 被带到修改密码页 → 去别的地址都被带回 → 改密码 → 进首页且导航可用 → 退出后临时密码作废、新密码可用", async ({ page, context }) => {
  test.slow(); // 步骤多（多次登录、每次都要算密码哈希），机器忙的时候 30 秒不够
  const admin = await createTemporaryPasswordAdmin();
  const password = newPassword();

  await page.goto("/platform");
  await expect(page).toHaveURL(/\/platform\/login$/);
  await fillLogin(page, admin.email, admin.temporaryPassword);
  await expectForcedPage(page, "登录后");
  await expect(page.getByLabel("临时密码")).toBeVisible();
  await expect(page.getByLabel("当前密码")).toHaveCount(0);
  await expect(page.locator(".topbar__brand")).toContainText("运营后台");

  for (const path of ["/platform", "/platform/no-such-page", "/platform/login"]) {
    await page.goto(path);
    await expectForcedPage(page, `直接打开 ${path}`);
  }
  await page.reload();
  await expectForcedPage(page, "刷新后（状态来自 auth/me）");
  await page.goBack();
  await expectForcedPage(page, "后退");

  const secondTab = await context.newPage();
  await secondTab.goto("/platform");
  await expect(secondTab, "新标签页没有登录状态，去登录页").toHaveURL(/\/platform\/login$/);
  await fillLogin(secondTab, admin.email, admin.temporaryPassword);
  await expectForcedPage(secondTab, "新标签页再登录");
  await secondTab.close();

  await page.getByRole("button", { name: /账号菜单/ }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["退出登录"]);
  await page.keyboard.press("Escape");

  const blocked = await page.evaluate(async () => {
    const stored = JSON.parse(sessionStorage.getItem("nozomi.session.platform") ?? "{}") as { accessToken?: string };
    const response = await fetch("/platform/v1/tenants", { headers: { authorization: `Bearer ${stored.accessToken}` } });
    return { status: response.status, code: ((await response.json()) as { error: { code: string } }).error.code };
  });
  expect(blocked, "后端此时确实拦着别的接口").toEqual({ status: 403, code: "PASSWORD_CHANGE_REQUIRED" });

  await page.getByLabel("临时密码").fill(admin.temporaryPassword);
  await page.getByLabel("新密码", { exact: true }).fill(admin.temporaryPassword);
  await page.getByLabel("再输入一次新密码").fill(admin.temporaryPassword);
  await page.getByRole("button", { name: "保存新密码" }).click();
  await expect(page.getByText("新密码不能和临时密码相同")).toBeVisible();
  await expectForcedPage(page, "新密码与临时密码相同被拒后");

  await page.getByLabel("新密码", { exact: true }).fill(password);
  await page.getByLabel("再输入一次新密码").fill(password);
  await page.getByRole("button", { name: "保存新密码" }).click();

  await expect(page).toHaveURL(/\/platform$/);
  await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "新密码已生效，临时密码已作废。" })).toBeVisible();
  await expect(detail(page, "邮箱")).toHaveText(admin.email);
  await expect(detail(page, "角色")).toHaveText("超级管理员");
  await expect(page.getByRole("navigation", { name: "主菜单" }).getByRole("link")).toHaveText(["首页"]);

  await page.reload();
  await expect(page, "刷新后仍在首页，不再被带去改密码").toHaveURL(/\/platform$/);
  await expect(page.getByRole("navigation", { name: "主菜单" })).toBeVisible();
  await page.getByRole("button", { name: /账号菜单/ }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["修改密码", "退出登录"]);
  await page.getByRole("menuitem", { name: "修改密码" }).click();
  await expect(page.getByLabel("当前密码"), "改完之后修改密码页恢复平常的样子").toBeVisible();
  await expect(page.getByText(WARNING)).toHaveCount(0);

  await page.getByRole("button", { name: /账号菜单/ }).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/platform\/login$/);

  await fillLogin(page, admin.email, admin.temporaryPassword);
  await expect(page.getByRole("alert").filter({ hasText: "邮箱或密码不正确。" }), "临时密码已作废").toBeVisible();
  await fillLogin(page, admin.email, password);
  await expect(page).toHaveURL(/\/platform$/);
  await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();
});

test("必须先改密码的状态下可以退出登录；临时密码仍然有效，再登录还是先改密码", async ({ page }) => {
  const admin = await createTemporaryPasswordAdmin();
  await page.goto("/platform/login");
  await fillLogin(page, admin.email, admin.temporaryPassword);
  await expectForcedPage(page, "登录后");
  await page.getByRole("button", { name: /账号菜单/ }).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/platform\/login$/);
  await expect(page.getByRole("status").filter({ hasText: "已退出登录。" })).toBeVisible();
  await page.goto("/platform");
  await expect(page).toHaveURL(/\/platform\/login$/);
  await fillLogin(page, admin.email, admin.temporaryPassword);
  await expectForcedPage(page, "再次登录");
});

test("强制修改密码页：320 / 360 / 1280 宽度下不横向滚动（含字段出错）；亮色、暗色通过 axe 检查", async ({ page }) => {
  test.slow(); // 步骤多（多次登录、每次都要算密码哈希），机器忙的时候 30 秒不够
  const admin = await createTemporaryPasswordAdmin();
  await page.goto("/platform/login");
  await fillLogin(page, admin.email, admin.temporaryPassword);
  await expectForcedPage(page, "登录后");

  for (const width of [320, 360, 1280]) {
    await page.setViewportSize({ width, height: 740 });
    await expectNoHorizontalOverflow(page, `强制修改密码页 ${width}px`);
  }
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByLabel("新密码", { exact: true }).fill("a");
  await page.getByRole("button", { name: "保存新密码" }).click();
  await expect(page.getByText("请输入临时密码")).toBeVisible();
  await expect(page.getByText("密码至少 12 个字符")).toBeVisible();
  await expectNoHorizontalOverflow(page, "强制修改密码页字段出错 320px");
  await page.getByRole("button", { name: /账号菜单/ }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expectNoHorizontalOverflow(page, "强制修改密码页账号菜单打开 320px");

  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `强制修改密码页（${scheme}，账号菜单打开、字段出错）`);
  }
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `强制修改密码页（${scheme}，1280px）`);
  }
});
