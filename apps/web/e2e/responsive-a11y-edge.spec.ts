/**
 * 版式与无障碍的补充检查（layout-theme-a11y.spec.ts 没覆盖到的）：
 * - 320 / 360 / 768 三个宽度下，带各种提示条、带「一个空格都没有」的超长姓名 / 邮箱 / 供应商名称时不横向滚动、文字不被裁掉；
 * - 亮、暗两套主题下，404、加载失败、提示条、手机上滑出的侧边栏通过 axe 检查（同一个页面状态切换两套主题各查一次）；
 * - 键盘：账号菜单、侧边栏滑出面板的焦点限制、换页后的焦点去向、聚焦环；
 * - 出错文字与输入框的关联、减少动态效果、把浏览器默认字号放大到 200%。
 */
import { AxeBuilder } from "@axe-core/playwright";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { createActiveTenant, createTenant, expectNoHorizontalOverflow, fillLogin, loginAs, platformAdminHeaders, uniqueEmail } from "./support.ts";

const PASSWORD = "Layout-edge-Password-2026";

interface WideAccount {
  email: string;
  personName: string;
  tenantName: string;
}

/** 姓名、供应商名称各 100 个不带空格的宽字母（后端允许的上限），邮箱 @ 前面 64 个字符：没有任何可以自然折行的位置。 */
async function createWideAccount(request: APIRequestContext): Promise<WideAccount> {
  const headers = await platformAdminHeaders(request);
  const email = `${"w".repeat(50)}${uniqueEmail("x").split("@")[0]?.replaceAll("-", "")}@${"m".repeat(40)}.example.com`;
  const personName = "M".repeat(100);
  const tenantName = "W".repeat(100);
  const created = await request.post("/platform/v1/tenants", { headers, data: { name: tenantName, admin: { email, name: personName } } });
  expect(created.status(), "创建超长名称的供应商").toBe(201);
  const { invite } = (await created.json()) as { invite: { token: string } };
  expect((await request.post("/tenant/v1/auth/accept-invite", { data: { token: invite.token, password: PASSWORD } })).status()).toBe(200);
  return { email, personName, tenantName };
}

/** 除了页面不横向滚动，再查一遍：没有哪个可见元素伸出视口右边（被藏起来的溢出也算）。 */
async function expectNothingPastViewport(page: Page, what: string): Promise<void> {
  await expectNoHorizontalOverflow(page, what);
  const offenders = await page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const found: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>("#root *")) {
      if (element.closest(".visually-hidden, .tooltip, .skip-link, dialog:not([open])")) continue;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.right > limit + 0.5 || box.left < -0.5) found.push(`${element.tagName.toLowerCase()}.${element.className} [${Math.round(box.left)}, ${Math.round(box.right)}] > ${limit}`);
    }
    return found.slice(0, 5);
  });
  expect(offenders, `${what}：有元素伸出了视口`).toEqual([]);
}

/** aria-describedby 指向的每个元素都存在且有文字；标了出错的输入框一定关联着出错文字。 */
async function expectDescriptionsResolve(page: Page, what: string): Promise<void> {
  const problems = await page.evaluate(() => {
    const found: string[] = [];
    for (const input of document.querySelectorAll<HTMLInputElement>("input:not([aria-hidden])")) {
      const label = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent : null;
      if (!label) found.push(`输入框 ${input.name} 没有关联的 <label>`);
      const ids = (input.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
      const texts = ids.map((id) => document.getElementById(id)?.textContent?.trim() ?? null);
      if (texts.some((text) => text === null || text === "")) found.push(`「${label}」的 aria-describedby 指向了不存在或没有文字的元素`);
      if (input.getAttribute("aria-invalid") === "true" && !ids.some((id) => document.getElementById(id)?.classList.contains("field__errors"))) {
        found.push(`「${label}」标了出错却没有关联出错文字`);
      }
    }
    return found;
  });
  expect(problems, what).toEqual([]);
}

async function expectAccessible(page: Page, what: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = results.violations.map((violation) => `${violation.id}: ${violation.help}（${violation.nodes.map((node) => node.target.join(" ")).join("；")}）`);
  expect(summary, `${what} 的无障碍问题`).toEqual([]);
}

const WIDTHS = [320, 360, 768] as const;

test("320 / 360 / 768px：超长且不带空格的姓名、邮箱、供应商名称，加上各种提示条，都不横向滚动、不伸出视口", async ({ page, request }) => {
  test.setTimeout(90_000);
  const account = await createWideAccount(request);
  /** 同一个状态在三个宽度下各查一次（改窗口宽度不会改变页面状态）。 */
  const checkAtEveryWidth = async (what: string, extra?: (width: number) => Promise<void>): Promise<void> => {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 720 });
      await expectNothingPastViewport(page, `${what}（${width}px）`);
      await extra?.(width);
    }
  };

  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/login");
  await fillLogin(page, account.email, "Definitely-wrong-password-1");
  await expect(page.getByRole("alert").filter({ hasText: "邮箱或密码不正确。" })).toBeVisible();
  await checkAtEveryWidth("登录失败，邮箱超长");
  await expectDescriptionsResolve(page, "登录失败");

  await page.getByLabel("密码", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.locator(".details")).toContainText(account.tenantName);
  await checkAtEveryWidth("首页，名称超长", async () => {
    const clipped = await page.locator(".details dd").evaluateAll((items) => items.filter((item) => item.scrollWidth > item.clientWidth + 1).map((item) => item.textContent?.slice(0, 12)));
    expect(clipped, "首页的值应折行显示完整，不能被裁掉").toEqual([]);
  });

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 720 });
    await page.getByRole("button", { name: /账号菜单/ }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expectNothingPastViewport(page, `账号菜单打开，姓名和邮箱超长（${width}px）`);
    const menu = await page.getByRole("menu").boundingBox();
    expect(menu?.x ?? -1, "菜单距屏幕左边至少 8px").toBeGreaterThanOrEqual(8);
    expect((menu?.x ?? 0) + (menu?.width ?? 0), "菜单距屏幕右边至少 8px").toBeLessThanOrEqual(width - 8);
    await page.keyboard.press("Escape");
  }

  await page.goto("/account/password");
  await page.getByLabel("当前密码").fill("Wrong-current-password-1");
  await page.getByLabel("新密码", { exact: true }).fill(`${PASSWORD}-2`);
  await page.getByLabel("再输入一次新密码").fill(`${PASSWORD}-2`);
  await page.getByRole("button", { name: "保存新密码" }).click();
  await expect(page.getByText("当前密码不正确，请重新输入")).toBeVisible();
  await checkAtEveryWidth("修改密码被后端拒绝");
  await expectDescriptionsResolve(page, "修改密码被后端拒绝");

  await page.getByLabel("当前密码").fill(PASSWORD);
  await page.getByRole("button", { name: "保存新密码" }).click();
  await expect(page.getByRole("status").filter({ hasText: "密码已修改。" })).toBeVisible();
  await checkAtEveryWidth("修改密码成功的提示条");

  await page.goto(`/${"long-unknown-path-segment".repeat(12)}`);
  await expect(page.getByRole("heading", { level: 1, name: "找不到这个页面" })).toBeVisible();
  await checkAtEveryWidth("找不到页面，地址超长");

  await page.getByRole("button", { name: /账号菜单/ }).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await expect(page.getByRole("status").filter({ hasText: "已退出登录。" })).toBeVisible();
  await checkAtEveryWidth("登录页的「已退出登录」提示条");
});

test("后端给的说明很长时（提示条里还夹着一长串不带空格的字符；字段下的出错文字是很长的中文），320 和 360 宽度下照样折行、不横向滚动", async ({ page, request }) => {
  // 真实后端不会返回这么长的说明；这里只为了版式，把这一个应答换成超长文字，其余请求照常走真实后端。
  const longText = `${"说明文字很长".repeat(30)}${"UNBROKEN_".repeat(40)}`;
  const longFieldText = `${"字段下的说明文字也很长，".repeat(20)}订单号 NZ-2026-0000000001`;
  const tenant = await createTenant(request);
  for (const width of [320, 360]) {
    await page.setViewportSize({ width, height: 720 });
    await page.route("**/tenant/v1/auth/accept-invite", (route) =>
      route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "CONFLICT", message: longText, details: {} } }) }),
    );
    await page.goto(`/accept-invite#token=${tenant.inviteToken}`);
    await page.getByLabel("新密码").fill(PASSWORD);
    await page.getByLabel("再输入一次").fill(PASSWORD);
    await page.getByRole("button", { name: "设置密码并继续" }).click();
    await expect(page.getByRole("alert")).toHaveText(longText);
    await expectNothingPastViewport(page, `提示条里的超长说明（${width}px）`);
    await page.unroute("**/tenant/v1/auth/accept-invite");

    await page.route("**/tenant/v1/auth/accept-invite", (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "WEAK_PASSWORD", message: "密码强度不够", details: { issues: [{ code: "X", message: longFieldText }, { code: "Y", message: "第二条说明" }] } } }),
      }),
    );
    await page.getByRole("button", { name: "设置密码并继续" }).click();
    await expect(page.getByText("第二条说明")).toBeVisible();
    await expectNothingPastViewport(page, `字段下的超长说明（${width}px）`);
    await expectDescriptionsResolve(page, "字段下的后端说明");
    await page.unroute("**/tenant/v1/auth/accept-invite");
  }
});

const SCHEMES = [
  ["light", "亮色"],
  ["dark", "暗色"],
] as const;

/** 同一个页面状态在亮、暗两套主题下各做一次 axe 检查。 */
async function expectAccessibleInBothThemes(page: Page, what: string): Promise<void> {
  for (const [scheme, name] of SCHEMES) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${what}（${name}）`);
  }
}

test("亮色和暗色：找不到页面、首页加载失败、修改密码成功的提示条通过 axe 检查；断网时保留已填内容，恢复后可直接再提交", async ({ page, request }) => {
  test.setTimeout(90_000);
  const invited = await createTenant(request);

  await page.goto(`/accept-invite#token=${invited.inviteToken}`);
  await page.getByLabel("新密码").fill(PASSWORD);
  await page.getByLabel("再输入一次").fill(PASSWORD);
  await page.getByRole("button", { name: "设置密码并继续" }).click();
  await expect(page.getByRole("status").filter({ hasText: "密码已设置，请登录。" })).toBeVisible();

  await page.getByLabel("密码", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.locator(".details")).toBeVisible();

  await page.goto("/no-such-page");
  await expect(page.getByRole("heading", { level: 1, name: "找不到这个页面" })).toBeVisible();
  await expectAccessibleInBothThemes(page, "找不到页面");

  await page.goto("/account/password");
  await page.getByLabel("当前密码").fill(PASSWORD);
  await page.getByLabel("新密码", { exact: true }).fill(`${PASSWORD}-2`);
  await page.getByLabel("再输入一次新密码").fill(`${PASSWORD}-2`);
  await page.context().setOffline(true);
  await page.getByRole("button", { name: "保存新密码" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "网络连接失败，请检查网络后重试。" })).toBeVisible();
  await expect(page.getByLabel("新密码", { exact: true }), "出错后保留已填内容").toHaveValue(`${PASSWORD}-2`);
  await page.context().setOffline(false);
  await page.getByRole("button", { name: "保存新密码" }).click();
  await expect(page.getByRole("status").filter({ hasText: "密码已修改。" })).toBeVisible();
  await expect(page.getByRole("alert"), "成功后上一次的出错提示消失").toHaveText("");
  await expectAccessibleInBothThemes(page, "修改密码成功提示条");

  await page.route("**/tenant/v1/auth/me", (route) => route.abort("connectionfailed"));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 2, name: "加载失败" })).toBeVisible();
  await expectAccessibleInBothThemes(page, "首页加载失败");
  await page.unroute("**/tenant/v1/auth/me");
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.locator(".details")).toContainText(invited.tenantName);
});

test("手机上滑出的侧边栏：亮、暗两套都通过 axe 检查；Tab 一直留在面板里；键盘聚焦到的控件都有 2px 的聚焦环，颜色是聚焦令牌；减少动态效果时没有滑入过程", async ({ page, request }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 360, height: 740 });
  const tenant = await createActiveTenant(request);
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  await expect(page.locator(".details")).toBeVisible();

  for (const [scheme, name] of SCHEMES) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.reload();
    await expect(page.locator(".details")).toBeVisible();
    const focusColor = await page.evaluate(() => {
      const hex = getComputedStyle(document.documentElement).getPropertyValue("--color-border-focus").trim();
      const channel = (start: number): number => Number.parseInt(hex.slice(start, start + 2), 16);
      return `rgb(${channel(1)}, ${channel(3)}, ${channel(5)})`;
    });
    const seen: string[] = [];
    for (let step = 0; step < 4; step += 1) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement;
        const style = getComputedStyle(element);
        return { name: element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 12) ?? "", ring: `${style.outlineStyle} ${style.outlineWidth}`, color: style.outlineColor };
      });
      seen.push(focused.name);
      expect(focused.ring, `${name}「${focused.name}」的聚焦环`).toBe("solid 2px");
      expect(focused.color, `${name}「${focused.name}」的聚焦环颜色`).toBe(focusColor);
    }
    expect(seen.slice(0, 3)).toEqual(["跳到正文", "打开菜单", "切换主题"]);
  }

  await page.getByRole("button", { name: "打开菜单" }).focus();
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog", { name: "主菜单" });
  await expect(drawer).toBeVisible();
  await expect.poll(async () => (await drawer.boundingBox())?.x).toBe(0);
  await expectAccessibleInBothThemes(page, "侧边栏滑出");
  for (let step = 0; step < 5; step += 1) {
    await page.keyboard.press(step % 2 === 0 ? "Tab" : "Shift+Tab");
    const inside = await page.evaluate(() => {
      const active = document.activeElement;
      return active === document.body || Boolean(active?.closest("dialog[open]"));
    });
    expect(inside, "侧边栏滑出时焦点不能跑到后面的页面上").toBe(true);
  }
  const behind = await page.getByRole("button", { name: /账号菜单/ }).click({ timeout: 1_000, trial: true }).then(
    () => "clickable",
    () => "blocked",
  );
  expect(behind, "滑出面板后面的内容不可操作").toBe("blocked");
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("button", { name: "打开菜单" })).toBeFocused();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "打开菜单" }).click();
  await expect(drawer).toBeVisible();
  expect(await drawer.evaluate((element) => getComputedStyle(element).animationDuration), "减少动态效果时滑入时长为 0").toBe("0s");
  expect((await drawer.boundingBox())?.x, "没有滑入过程，直接到位").toBe(0);
  await page.keyboard.press("Escape");
  const durations = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".button, .icon-button, .tooltip, .nav-item, .account-button")].flatMap((element) => getComputedStyle(element).transitionDuration.split(", ")),
  );
  expect(durations.length).toBeGreaterThan(2);
  expect(durations.filter((duration) => duration !== "0s"), "减少动态效果时按钮、气泡的过渡时长为 0").toEqual([]);
});

test("只用键盘：打开账号菜单 → 修改密码 → 填表提交出错 → 焦点到出错的字段 → 退出登录", async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const tenant = await createActiveTenant(request);
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  await expect(page.locator(".details")).toBeVisible();

  const accountButton = page.getByRole("button", { name: /账号菜单/ });
  await accountButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "修改密码" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "退出登录" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "修改密码" }), "方向键在菜单项之间循环").toBeFocused();
  await page.keyboard.press("Escape");
  await expect(accountButton).toBeFocused();
  await expect(page.getByRole("menu")).toHaveCount(0);

  await page.keyboard.press("Space");
  await expect(page.getByRole("menuitem", { name: "修改密码" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "修改密码" })).toBeVisible();

  await page.getByLabel("当前密码").focus();
  await page.keyboard.type("Wrong-current-password-1");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "显示密码" }).first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("当前密码"), "在「显示密码」上按 Enter 只切换显示，不提交表单").toHaveAttribute("type", "text");
  await expect(page.getByLabel("当前密码")).toBeFocused();
  await expect(page.getByText("请输入新密码")).toHaveCount(0);

  await page.getByLabel("新密码", { exact: true }).focus();
  await page.keyboard.type("short");
  await page.keyboard.press("Enter");
  await expect(page.getByText("密码至少 12 个字符")).toBeVisible();
  await expect(page.getByLabel("新密码", { exact: true }), "提交有错时焦点到第一个出错的字段").toBeFocused();
  await expect(page.getByLabel("新密码", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expectDescriptionsResolve(page, "修改密码页字段出错");

  await accountButton.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await expect(page.getByRole("menuitem", { name: "退出登录" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("status").filter({ hasText: "已退出登录。" })).toBeVisible();
  await expect(page.getByLabel("邮箱"), "回到登录页后焦点在邮箱框，可以直接输入").toBeFocused();
});

test("【缺陷】换页后焦点应交给正文（AppShell 里写了这段逻辑），现在换页后焦点掉到 <body> 上，键盘用户要从页面最上面重新 Tab", async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const tenant = await createActiveTenant(request);
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  const focused = (): Promise<string> => page.evaluate(() => document.activeElement?.tagName.toLowerCase() ?? "");

  await page.getByRole("button", { name: /账号菜单/ }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "修改密码" })).toBeVisible();
  expect(await focused(), "首页 → 修改密码：焦点应在 <main>").toBe("main");

  await page.goto("/no-such-page");
  await page.getByRole("link", { name: "回到首页" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();
  expect(await focused(), "找不到页面 → 首页：焦点应在 <main>").toBe("main");
});

test("把浏览器默认字号放大到 200%（字号用 rem，会跟着放大）：360px 宽的登录页和首页不横向滚动、不伸出视口", async ({ page, request }) => {
  const tenant = await createActiveTenant(request);
  // 直接改 <html> 的样式属性，而不是往页面里插一段 <style>：页面带着正式环境的内容安全策略，内联样式会被拦下。
  const enlarge = (): Promise<unknown> => page.evaluate(() => document.documentElement.style.setProperty("font-size", "200%"));
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/login");
  await enlarge();
  expect(await page.getByLabel("邮箱").evaluate((element) => getComputedStyle(element).fontSize), "字号确实放大了").toBe("28px");
  await expectNothingPastViewport(page, "登录页 200% 字号");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByText("请输入邮箱")).toBeVisible();
  await expectNothingPastViewport(page, "登录页字段出错 200% 字号");

  await fillLogin(page, tenant.adminEmail, tenant.password);
  await expect(page.locator(".details")).toContainText(tenant.tenantName);
  await enlarge();
  await expectNothingPastViewport(page, "首页 200% 字号");
});

test("表单输入的边界（真实后端）：邮箱带首尾空格和大写也能登录；密码首尾的空格是密码的一部分", async ({ page, request }) => {
  const invited = await createTenant(request);
  const password = `  ${PASSWORD} 尾巴 `;
  await page.goto(`/accept-invite#token=${invited.inviteToken}`);
  await page.getByLabel("新密码").fill(password);
  await page.getByLabel("再输入一次").fill(password);
  await page.getByRole("button", { name: "设置密码并继续" }).click();
  await expect(page.getByRole("status").filter({ hasText: "密码已设置，请登录。" })).toBeVisible();

  await page.getByLabel("密码", { exact: true }).fill(password.trim());
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "邮箱或密码不正确。" }), "去掉首尾空格的密码不是同一个密码").toBeVisible();

  await page.getByLabel("邮箱").fill(`  ${invited.adminEmail.toUpperCase()}\t`);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();
  await expect(page.locator(".details")).toContainText(invited.adminEmail);
});

test("前后端的密码规则逐条一致：前端即时提示放行的，后端也接受；前端拦下的每一种，后端同样拒绝并给出同一句话", async ({ page, request }) => {
  test.setTimeout(60_000);
  const invited = await createTenant(request);
  const headers = await platformAdminHeaders(request);
  const cases: [string, string[]][] = [
    ["Aa1!Aa1!Aa1", ["密码至少 12 个字符", "密码里至少要有 6 个不同的字符"]],
    ["abcdefghijkl", ["密码要包含小写字母、大写字母、数字、符号中的至少三类"]],
    ["Aa1Aa1Aa1Aa1", ["密码里至少要有 6 个不同的字符"]],
    ["密码密码密码密码密码密码", ["密码要包含小写字母、大写字母、数字、符号中的至少三类", "密码里至少要有 6 个不同的字符"]],
    [`Ab1!${"xyz".repeat(41)}wv`, ["密码最多 128 个字符"]],
    ["😀😀😀😀😀😀Aa1bcd", []],
    ["Abcdef 12345", []],
    [`Ab1!${"xyz".repeat(41)}w`, []],
  ];
  await page.goto(`/accept-invite#token=${invited.inviteToken}`);
  for (const [password, expected] of cases) {
    await page.getByLabel("新密码").fill(password);
    await page.getByLabel("再输入一次").focus();
    const shown = await page.locator(".field").first().locator(".field__error").allTextContents();
    expect(shown, `前端对 ${JSON.stringify(password.slice(0, 20))}（${[...password].length} 个字符）的即时提示`).toEqual(expected);

    const probe = await request.post("/platform/v1/tenants", { headers, data: { name: `密码规则核对 ${uniqueEmail("p").slice(2, 12)}`, admin: { email: uniqueEmail("rules"), name: "密码规则核对" } } });
    expect(probe.status()).toBe(201);
    const { invite } = (await probe.json()) as { invite: { token: string } };
    const response = await request.post("/tenant/v1/auth/accept-invite", { data: { token: invite.token, password } });
    if (expected.length === 0) {
      expect(response.status(), `后端应接受 ${JSON.stringify(password.slice(0, 20))}`).toBe(200);
    } else {
      expect(response.status()).toBe(400);
      const body = (await response.json()) as { error: { code: string; details: { issues: { message: string }[] } } };
      expect(body.error.code).toBe("WEAK_PASSWORD");
      expect(body.error.details.issues.map((issue) => issue.message), "后端的说明与前端的即时提示逐字相同").toEqual(expected);
    }
  }
});
