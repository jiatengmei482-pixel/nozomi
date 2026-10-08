/**
 * 版式、主题、无障碍：
 * - 360 / 400 / 1280 三个宽度下每个页面、每个状态都不出现横向滚动（docs/design/03-layout.md 第 5 节）；
 * - 亮色、暗色（跟随系统 + 手动覆盖）；
 * - axe 自动化无障碍检查；键盘走完整个登录流程。
 */
import { readFileSync } from "node:fs";
import { AxeBuilder } from "@axe-core/playwright";
import { type Page, devices, expect, test } from "@playwright/test";
import { VIEWPORTS, adminCredentials, createActiveTenant, createTenant, expectNoHorizontalOverflow, fillLogin, loginAs, platformAdminHeaders, snapshot, uniqueEmail } from "./support.ts";

/** 页面底色的两套取值，直接从令牌文件读，不在测试里另抄一份。 */
function pageBackground(): { light: string; dark: string } {
  const tokens = readFileSync(new URL("../../../docs/design/tokens.css", import.meta.url), "utf8");
  const values = [...tokens.matchAll(/--color-bg-page:\s*#([0-9A-Fa-f]{6});/g)].map((match) => {
    const hex = match[1] ?? "";
    const channel = (start: number): number => Number.parseInt(hex.slice(start, start + 2), 16);
    return `rgb(${channel(0)}, ${channel(2)}, ${channel(4)})`;
  });
  const [light, dark] = values;
  if (!light || !dark) throw new Error("tokens.css 里没有找到 --color-bg-page 的亮、暗两个值");
  return { light, dark };
}

const BACKGROUND = pageBackground();
const bodyBackground = (page: Page): Promise<string> => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

async function expectAccessible(page: Page, what: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = results.violations.map((violation) => `${violation.id}: ${violation.help}（${violation.nodes.map((node) => node.target.join(" ")).join("；")}）`);
  expect(summary, `${what} 的无障碍问题`).toEqual([]);
}

/** 让登录请求晚一点到后端，好观察「提交中」的界面。请求原样放行，不改应答。 */
async function holdLoginRequests(page: Page): Promise<() => void> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/auth/login", async (route) => {
    await released;
    await route.continue();
  });
  return release;
}

for (const [name, viewport] of Object.entries({ ...VIEWPORTS, zoomed200: { width: 640, height: 400 } })) {
  test(`不需要登录的页面在 ${viewport.width}px 宽度下各状态都不横向滚动`, async ({ page, request }) => {
    await page.setViewportSize(viewport);
    const check = (what: string): Promise<void> => expectNoHorizontalOverflow(page, `${what}（${name}）`);

    for (const path of ["/login", "/platform/login"]) {
      await page.goto(path);
      await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
      await check(`${path} 默认`);
    }

    await page.goto("/login");
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page.getByText("请输入邮箱")).toBeVisible();
    await check("登录页字段出错");

    const release = await holdLoginRequests(page);
    const longEmail = `${"very-long-mailbox-name-".repeat(3)}${uniqueEmail("x")}`;
    await fillLogin(page, longEmail, "Definitely-wrong-password-1");
    await expect(page.getByRole("button", { name: "正在登录…" })).toHaveAttribute("aria-busy", "true");
    await expect(page.getByLabel("邮箱")).toHaveJSProperty("readOnly", true);
    await check("登录页提交中");
    release();
    await expect(page.getByRole("alert").filter({ hasText: "邮箱或密码不正确。" })).toBeVisible();
    await check("登录页登录失败");
    await page.unroute("**/auth/login");

    await page.getByRole("button", { name: "切换主题" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await check("主题菜单打开");
    await page.keyboard.press("Escape");

    const tenant = await createTenant(request);
    await page.goto(`/accept-invite#token=${tenant.inviteToken}`);
    await expect(page.getByRole("button", { name: "设置密码并继续" })).toBeVisible();
    await check("接受邀请页表单");
    await page.getByLabel("新密码").fill("a");
    await page.getByLabel("再输入一次").fill("b");
    await page.getByRole("button", { name: "设置密码并继续" }).click();
    await expect(page.getByText("两次输入的密码不一致")).toBeVisible();
    await expect(page.getByText("密码至少 12 个字符")).toBeVisible();
    await check("接受邀请页字段出错");

    await page.goto("/platform/reset-password#token=not-a-real-token");
    await expect(page.getByRole("button", { name: "设置新密码并继续" })).toBeVisible();
    await check("重设密码页表单");

    await page.goto("/accept-invite");
    await expect(page.getByRole("heading", { name: "邀请链接已失效" })).toBeVisible();
    await check("邀请链接已失效");
  });

  test(`登录后的页面在 ${viewport.width}px 宽度下各状态都不横向滚动`, async ({ page, request }) => {
    await page.setViewportSize(viewport);
    const check = (what: string): Promise<void> => expectNoHorizontalOverflow(page, `${what}（${name}）`);

    const headers = await platformAdminHeaders(request);
    const adminEmail = `${"long-mailbox-name-".repeat(4)}${uniqueEmail("t")}`;
    const tenantName = `端到端测试供应商-${"名称很长不带空格".repeat(8)}`;
    const created = await request.post("/platform/v1/tenants", { headers, data: { name: tenantName, admin: { email: adminEmail, name: "端到端测试-姓名也很长的租户管理员账号" } } });
    expect(created.status()).toBe(201);
    const { invite } = (await created.json()) as { invite: { token: string } };
    const password = "Layout-check-Password-2026";
    expect((await request.post("/tenant/v1/auth/accept-invite", { data: { token: invite.token, password } })).status()).toBe(200);

    await loginAs(page, "tenant", adminEmail, password);
    await expect(page.locator(".details")).toContainText(tenantName);
    await check("首页");

    await page.getByRole("button", { name: /账号菜单/ }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await check("账号菜单打开");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "切换主题" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await check("主题菜单打开");
    await page.keyboard.press("Escape");

    const menuButton = page.getByRole("button", { name: "打开菜单" });
    if (viewport.width < 1024) {
      await expect(page.locator(".sidebar--pinned")).toBeHidden();
      await menuButton.click();
      const drawer = page.getByRole("dialog", { name: "主菜单" });
      await expect(drawer).toBeVisible();
      await expect(menuButton).toHaveAttribute("aria-expanded", "true");
      await expect.poll(async () => (await drawer.boundingBox())?.x, { message: "滑入动画结束后贴着左边" }).toBe(0);
      await check("侧边栏滑出");
      const box = await drawer.boundingBox();
      expect((box?.width ?? 0) + 56, "滑出的侧边栏右侧至少留 56px").toBeLessThanOrEqual(viewport.width);
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
      await expect(menuButton, "关闭后焦点回到菜单按钮").toBeFocused();
      await menuButton.click();
      await drawer.getByRole("link", { name: "首页" }).click();
      await expect(drawer, "点菜单项后关闭").toBeHidden();
    } else {
      await expect(menuButton).toBeHidden();
      await expect(page.locator(".sidebar--pinned")).toBeVisible();
      expect((await page.locator(".sidebar--pinned").boundingBox())?.width).toBe(232);
    }

    await page.goto("/account/password");
    await expect(page.getByRole("heading", { level: 1, name: "修改密码" })).toBeVisible();
    await check("修改密码页");
    await page.getByLabel("新密码", { exact: true }).fill("a");
    await page.getByRole("button", { name: "保存新密码" }).click();
    await expect(page.getByText("请输入当前密码")).toBeVisible();
    await expect(page.getByText("密码至少 12 个字符")).toBeVisible();
    await check("修改密码页字段出错");

    await page.goto("/no-such-page");
    await expect(page.getByRole("heading", { level: 1, name: "找不到这个页面" })).toBeVisible();
    await expect(viewport.width < 1024 ? menuButton : page.getByRole("navigation", { name: "主菜单" }), "找不到页面时保留后台框架").toBeVisible();
    await check("找不到页面");
    await page.getByRole("link", { name: "回到首页" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`${scheme === "light" ? "亮色" : "暗色"}（跟随系统）：登录页用对应的令牌，通过 axe 检查`, async ({ page }) => {
    // 每个状态做一次 axe 检查，两核的机器上要 20 多秒；默认的 30 秒在机器忙的时候不够（实测超时过）。
    test.setTimeout(90_000);
    await page.emulateMedia({ colorScheme: scheme });
    for (const path of ["/login", "/platform/login"]) {
      await page.goto(path);
      await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.dataset["theme"]), "跟随系统时不设 data-theme").toBeUndefined();
      expect(await bodyBackground(page)).toBe(BACKGROUND[scheme]);
      await expectAccessible(page, `${path} 默认（${scheme}）`);
    }

    await page.getByRole("button", { name: "登录" }).click();
    await expect(page.getByText("请输入邮箱")).toBeVisible();
    await expectAccessible(page, `登录页字段出错（${scheme}）`);

    await fillLogin(page, uniqueEmail("nobody"), "Definitely-wrong-password-1");
    await expect(page.getByRole("alert").filter({ hasText: "邮箱或密码不正确。" })).toBeVisible();
    await expectAccessible(page, `登录页登录失败（${scheme}）`);

    await page.getByRole("button", { name: "切换主题" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expectAccessible(page, `主题菜单打开（${scheme}）`);
  });

  test(`${scheme === "light" ? "亮色" : "暗色"}：设置密码页、首页、修改密码页通过 axe 检查`, async ({ page, request }) => {
    // 每个状态做一次 axe 检查，两核的机器上要 20 多秒；默认的 30 秒在机器忙的时候不够（实测超时过）。
    test.setTimeout(90_000);
    await page.emulateMedia({ colorScheme: scheme });
    const invited = await createTenant(request);
    await page.goto(`/accept-invite#token=${invited.inviteToken}`);
    await page.getByLabel("新密码").fill("a");
    await page.getByLabel("再输入一次").fill("b");
    await page.getByRole("button", { name: "设置密码并继续" }).click();
    await expect(page.getByText("两次输入的密码不一致")).toBeVisible();
    await expectAccessible(page, `接受邀请页字段出错（${scheme}）`);
    await page.goto("/reset-password");
    await expect(page.getByRole("heading", { name: "重置链接已失效" })).toBeVisible();
    await expectAccessible(page, `重置链接已失效（${scheme}）`);

    const tenant = await createActiveTenant(request);
    await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
    await expect(page.locator(".details")).toContainText(tenant.tenantName);
    expect(await bodyBackground(page)).toBe(BACKGROUND[scheme]);
    await expectAccessible(page, `首页（${scheme}）`);
    await page.getByRole("button", { name: /账号菜单/ }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expectAccessible(page, `账号菜单打开（${scheme}）`);
    await page.getByRole("menuitem", { name: "修改密码" }).click();
    await page.getByRole("button", { name: "保存新密码" }).click();
    await expect(page.getByText("请输入当前密码")).toBeVisible();
    await expectAccessible(page, `修改密码页字段出错（${scheme}）`);
  });
}

test("主题手动覆盖：系统亮色时选暗色、系统暗色时选亮色都生效，刷新后保持，选回跟随系统则恢复", async ({ page }) => {
  const chosen = (): Promise<string | undefined> => page.evaluate(() => document.documentElement.dataset["theme"]);
  const choose = async (label: string): Promise<void> => {
    await page.getByRole("button", { name: "切换主题" }).click();
    await page.getByRole("menuitemradio", { name: label }).click();
  };

  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/login");
  expect(await bodyBackground(page)).toBe(BACKGROUND.light);
  await choose("暗色");
  expect(await chosen()).toBe("dark");
  expect(await bodyBackground(page)).toBe(BACKGROUND.dark);
  await expectAccessible(page, "登录页（手动暗色）");

  await page.reload();
  expect(await chosen(), "刷新后仍是手动选的暗色").toBe("dark");
  expect(await bodyBackground(page)).toBe(BACKGROUND.dark);
  expect(await page.evaluate(() => localStorage.getItem("nozomi.theme"))).toBe("dark");
  await page.goto("/platform/login");
  expect(await bodyBackground(page), "换个页面也保持").toBe(BACKGROUND.dark);

  await page.emulateMedia({ colorScheme: "dark" });
  await choose("亮色");
  expect(await chosen()).toBe("light");
  expect(await bodyBackground(page)).toBe(BACKGROUND.light);
  await expectAccessible(page, "登录页（手动亮色）");

  await choose("跟随系统");
  expect(await chosen()).toBeUndefined();
  expect(await bodyBackground(page)).toBe(BACKGROUND.dark);
  expect(await page.evaluate(() => localStorage.getItem("nozomi.theme"))).toBeNull();
});

test("首次绘制前就设好主题：保存过暗色的人打开页面，应用脚本运行之前 <html> 已经带 data-theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => {
    localStorage.setItem("nozomi.theme", "dark");
    document.addEventListener("readystatechange", () => {
      if (document.readyState === "interactive") {
        (window as unknown as { themeAtParse: string | undefined }).themeAtParse = document.documentElement.dataset["theme"];
      }
    });
  });
  await page.goto("/login");
  expect(await page.evaluate(() => (window as unknown as { themeAtParse: string | undefined }).themeAtParse)).toBe("dark");
});

test("只用键盘完成登录：Tab 顺序符合规范，聚焦环可见，Enter 提交", async ({ page }) => {
  const admin = adminCredentials();
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto("/platform/login");
  await expect(page.getByLabel("邮箱"), "桌面宽度下打开页面焦点在邮箱").toBeFocused();

  const focusName = (): Promise<string> =>
    page.evaluate(() => {
      const element = document.activeElement as HTMLElement;
      const label = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent : null;
      return label ?? element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "";
    });
  const order = [await focusName()];
  for (let step = 0; step < 5; step += 1) {
    await page.keyboard.press("Tab");
    order.push(await focusName());
    const ring = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement as Element);
      return { style: style.outlineStyle, width: style.outlineWidth };
    });
    expect(ring, `「${order.at(-1)}」的聚焦环`).toEqual({ style: "solid", width: "2px" });
  }
  expect(order).toEqual(["邮箱", "密码", "显示密码", "登录", "我是供应商，去供应商后台登录", "切换主题"]);

  await page.getByLabel("邮箱").focus();
  await page.keyboard.type(admin.email);
  await page.keyboard.press("Tab");
  await page.keyboard.type(admin.password);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "跳到正文" }), "后台里第一个可聚焦的是「跳到正文」").toBeFocused();
  await expect(page.getByRole("link", { name: "跳到正文" })).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
});

test("手机：360×640 首屏完整看到品牌名、后台名称、两个输入框和登录按钮；不自动聚焦；卡片靠上且没有边框", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/login");
  const button = page.getByRole("button", { name: "登录" });
  await expect(button).toBeVisible();
  for (const locator of [page.getByText("NOZOMI"), page.getByRole("heading", { level: 1 }), page.getByLabel("邮箱"), page.getByLabel("密码", { exact: true }), button]) {
    await expect(locator).toBeInViewport({ ratio: 1 });
  }
  expect(await page.evaluate(() => document.activeElement?.tagName), "手机上不自动聚焦，避免一打开就弹键盘").toBe("BODY");
  const card = await page.locator(".auth-card").evaluate((element) => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return { border: style.borderTopWidth, padding: style.paddingLeft, left: box.left, width: box.width, top: box.top };
  });
  expect(card).toEqual({ border: "0px", padding: "0px", left: 16, width: 328, top: 64 });
  const buttonBox = await button.boundingBox();
  expect(buttonBox?.width, "按钮撑满内容宽度").toBe(328);
});

test("桌面：登录卡片 400px 宽、有边框、垂直方向略偏上（上 : 下 ≈ 2 : 3）", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
  const card = await page.locator(".auth-card").evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { width: box.width, above: box.top, below: window.innerHeight - box.bottom, border: getComputedStyle(element).borderTopWidth };
  });
  expect(card.width).toBe(400);
  expect(card.border).toBe("1px");
  expect(card.above / card.below).toBeGreaterThan(0.55);
  expect(card.above / card.below).toBeLessThan(0.75);
});

test("触屏设备：输入框和按钮高 48px、输入文字 16px（令牌按 pointer: coarse 自动切换）", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ ...devices["Pixel 7"], ...(baseURL ? { baseURL } : {}) });
  const page = await context.newPage();
  await page.goto("/login");
  const input = await page.getByLabel("邮箱").evaluate((element) => ({ height: element.getBoundingClientRect().height, font: getComputedStyle(element).fontSize }));
  expect(input).toEqual({ height: 48, font: "16px" });
  expect((await page.getByRole("button", { name: "登录" }).boundingBox())?.height).toBe(48);
  await expectNoHorizontalOverflow(page, "触屏登录页");
  await context.close();
});

test("字段下的出错文字很长且不带空格时折行，不撑破页面（320px 宽）", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/login");
  await page.getByRole("button", { name: "登录" }).click();
  const message = page.locator(".field__error > span").first();
  await expect(message).toBeVisible();
  await message.evaluate((element) => {
    element.textContent = "x".repeat(400);
  });
  await expectNoHorizontalOverflow(page, "超长出错文字");
  expect((await message.boundingBox())?.width ?? 0).toBeLessThanOrEqual(320);
});

test("减少动态效果：提交中的转圈不转，文字「正在登录…」照常显示", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  const release = await holdLoginRequests(page);
  await fillLogin(page, uniqueEmail("nobody"), "Definitely-wrong-password-1");
  await expect(page.getByRole("button", { name: "正在登录…" })).toBeVisible();
  expect(await page.locator(".spinner").evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  release();
  await expect(page.getByRole("alert").filter({ hasText: "邮箱或密码不正确。" })).toBeVisible();
});

test("留图：亮 / 暗 × 360 / 400 / 1280 的登录页和首页（只在设置了 E2E_SCREENSHOT_DIR 时保存）", async ({ page, request }) => {
  test.skip(!process.env["E2E_SCREENSHOT_DIR"], "没有设置 E2E_SCREENSHOT_DIR");
  test.setTimeout(120_000);
  const tenant = await createActiveTenant(request);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const viewport of Object.values(VIEWPORTS)) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => sessionStorage.clear()).catch(() => undefined);
      await page.goto("/login");
      await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
      await snapshot(page, `login-tenant-${scheme}-${viewport.width}`);
      await page.goto("/platform/login");
      await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
      await snapshot(page, `login-platform-${scheme}-${viewport.width}`);
      await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
      await expect(page.locator(".details")).toContainText(tenant.tenantName);
      await snapshot(page, `home-tenant-${scheme}-${viewport.width}`);
    }
  }
});
