/**
 * 运营后台「供应商与平台员工管理」（M1-10），真实后端、真实 PostgreSQL。
 * 最要紧的是一次性链接：令牌只出现在对话框里——地址、历史记录、两种存储、Cookie、控制台里都搜不到；
 * 拿到的链接真的能用（接受邀请、重置密码、登录）。
 */
import { type Browser, type ConsoleMessage, type Page, expect, test } from "@playwright/test";
import { expectAccessible, toast } from "./catalog.ts";
import { adminCredentials, expectNoHorizontalOverflow, loginAs, newPassword, snapshot, uniqueEmail } from "./support.ts";

const random = (): string => Math.random().toString(36).slice(2, 8);

/** 一次性链接对话框里的链接和令牌。 */
async function readLink(page: Page, title: string): Promise<{ link: string; token: string }> {
  const dialog = page.getByRole("dialog", { name: `${title}（只显示这一次）` });
  await expect(dialog).toBeVisible();
  const link = await dialog.getByRole("textbox", { name: title }).inputValue();
  const token = link.split("#token=")[1] ?? "";
  expect(token.length, "链接里有令牌").toBeGreaterThan(20);
  return { link, token };
}

/** 令牌不能去的地方：地址、历史记录的状态、两种存储、Cookie、页面上对话框以外的地方、控制台。 */
async function expectTokenNowhere(page: Page, token: string, logs: readonly string[], options: { dialogOpen: boolean }): Promise<void> {
  const seen = await page.evaluate(
    ({ secret, dialogOpen }) => {
      const dump = (storage: Storage): string => Object.keys(storage).map((key) => `${key}=${storage.getItem(key) ?? ""}`).join("\n");
      const outside = [...document.body.querySelectorAll("*")].filter((node) => node.closest("dialog") === null);
      const attributes = (dialogOpen ? outside : [...document.body.querySelectorAll("*")]).flatMap((node) => [...node.attributes].map((attribute) => attribute.value));
      return {
        href: location.href.includes(secret),
        history: JSON.stringify(history.state ?? null).includes(secret),
        local: dump(localStorage).includes(secret),
        session: dump(sessionStorage).includes(secret),
        cookie: document.cookie.includes(secret),
        attributes: attributes.some((value) => value.includes(secret)),
        text: dialogOpen ? outside.some((node) => node.children.length === 0 && (node.textContent ?? "").includes(secret)) : (document.body.textContent ?? "").includes(secret),
        toasts: [...document.querySelectorAll(".toast, [role=status], [role=alert]")].filter((node) => node.closest("dialog") === null).some((node) => (node.textContent ?? "").includes(secret)),
      };
    },
    { secret: token, dialogOpen: options.dialogOpen },
  );
  expect(seen, "令牌不进地址、历史记录、存储、Cookie、属性值、对话框以外的文字").toEqual({ href: false, history: false, local: false, session: false, cookie: false, attributes: false, text: false, toasts: false });
  expect((await page.context().cookies()).some((cookie) => cookie.value.includes(token)), "Cookie 里没有令牌").toBe(false);
  expect(logs.filter((line) => line.includes(token)), "控制台里没有令牌").toEqual([]);
}

/** 在一个新的浏览器环境里（对方的电脑）打开链接、设置密码、登录。 */
async function useLink(browser: Browser, link: string, email: string, portal: "tenant" | "platform"): Promise<{ page: Page; password: string }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const password = newPassword();
  await page.goto(link);
  await page.getByLabel("新密码").fill(password);
  await page.getByLabel("再输入一次").fill(password);
  await page.getByRole("button", { name: /^设置(新)?密码并继续$/ }).click();
  await expect(page.getByLabel("邮箱")).toHaveValue(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(portal === "tenant" ? "/" : "/platform");
  return { page, password };
}

function collectLogs(page: Page): string[] {
  const logs: string[] = [];
  page.on("console", (message: ConsoleMessage) => logs.push(message.text()));
  page.on("pageerror", (error) => logs.push(String(error)));
  return logs;
}

test("供应商：首页卡片进列表 → 新建拿到一次性链接（令牌不外泄）→ 对方用链接设密码登录 → 暂停（原因必填）→ 对方仍可登录并看到已暂停 → 恢复 → 再邀请一个管理员 → 发密码重置并重置成功 → 审计日志里查得到改前改后", async ({ page, browser, context }) => {
  test.setTimeout(240_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1280, height: 800 });
  const logs = collectLogs(page);
  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);

  // 首页的供应商卡片可以点进列表；菜单里有「供应商」和「系统设置」
  await page.locator(".entry-card").getByRole("link", { name: "供应商" }).click();
  await expect(page).toHaveURL(/\/platform\/tenants$/);
  await expect(page.getByRole("heading", { level: 1, name: "供应商" })).toBeVisible();
  const menu = page.getByRole("navigation", { name: "主菜单" });
  await expect(menu.getByRole("link", { name: "供应商" })).toHaveAttribute("aria-current", "page");
  await expect(menu.getByRole("button", { name: "系统设置" })).toHaveAttribute("aria-expanded", "false");

  // 新建：没填的报错；填好后拿到链接
  const name = `一次性链接车队 ${random()}`;
  const firstEmail = uniqueEmail("m110-admin");
  await page.getByRole("link", { name: "新建供应商" }).first().click();
  await expect(page).toHaveURL(/\/platform\/tenants\/new$/);
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await expect(page.getByText("请填写名称")).toBeVisible();
  await page.getByLabel(/^名称/).fill(name);
  await page.getByLabel(/^邮箱/).fill("不是邮箱");
  await page.getByLabel(/^姓名/).fill("山田太郎");
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await expect(page.getByText("这不是一个邮箱地址")).toBeVisible();
  await page.getByLabel(/^邮箱/).fill(firstEmail);
  await expect(page.getByText("系统不会给对方发邮件。")).toBeVisible();
  await page.getByRole("button", { name: "新建", exact: true }).click();
  const invite = await readLink(page, "邀请链接");
  expect(invite.link).toBe(`${new URL(page.url()).origin}/accept-invite#token=${invite.token}`);
  const dialog = page.getByRole("dialog", { name: "邀请链接（只显示这一次）" });
  await expect(dialog).toContainText(`给 山田太郎（${firstEmail}）· ${name} 的管理员`);
  await expect(dialog).toContainText("系统不会发邮件。");
  await expect(dialog).toContainText(/有效期到 \d{4}-\d{2}-\d{2} \d{2}:\d{2}（7 天），只能用一次。/);
  await expect(dialog.getByRole("button", { name: "复制链接", exact: true })).toBeFocused();
  await expect(dialog.getByRole("button", { name: "关闭", exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/\/platform\/tenants\/new$/);
  await expectTokenNowhere(page, invite.token, logs, { dialogOpen: true });
  await snapshot(page, "platform-link-dialog-desktop");
  await expectAccessible(page, "一次性链接对话框");

  // Esc、点遮罩都不关；没复制过就关要再确认
  await page.keyboard.press("Escape");
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "我已经发给对方，关闭" }).click();
  await expect(dialog.getByText("还没有复制过这条链接。关闭以后无法再看到，只能重新发起。")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "回去复制" })).toBeFocused();
  await dialog.getByRole("button", { name: "回去复制" }).click();
  await dialog.getByRole("button", { name: "复制链接", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "已复制" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(invite.link);
  await dialog.getByRole("button", { name: "复制链接和说明" }).click();
  const message = await page.evaluate(() => navigator.clipboard.readText());
  expect(message).toContain(`山田太郎，你好：\n这是 NOZOMI 供应商后台的账号开通链接`);
  expect(message).toContain(`${invite.link}\n链接只能用一次，请不要转发给别人。登录邮箱：${firstEmail}`);
  await dialog.getByRole("button", { name: "我已经发给对方，关闭" }).click();

  // 关闭以后才换到详情页；页面上、地址里都没有令牌
  await expect(page).toHaveURL(/\/platform\/tenants\/[0-9a-f-]{36}$/);
  await expect(toast(page, `已新建供应商「${name}」`)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expectTokenNowhere(page, invite.token, logs, { dialogOpen: false });
  const tenantId = page.url().split("/").at(-1) ?? "";
  await page.goBack();
  await expect(page, "后退不会回到填好的表单").not.toHaveURL(/\/tenants\/new$/);
  await page.goto(`/platform/tenants/${tenantId}`);

  // 对方用链接设密码并登录供应商后台
  const first = await useLink(browser, invite.link, firstEmail, "tenant");
  await expect(first.page.locator(".tenant-name")).toHaveText(name);
  await expect(first.page.locator(".tenant-status")).toHaveText("正常");

  // 暂停：原因必填
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  const suspend = page.getByRole("dialog", { name: `暂停「${name}」？` });
  await expect(suspend).toContainText("它的账号仍然可以登录供应商后台，页面上会看到「已暂停」；");
  await expect(suspend.getByRole("button", { name: "取消" })).toBeFocused();
  await suspend.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(suspend.getByText("请填写暂停原因")).toBeVisible();
  await suspend.getByLabel(/暂停原因/).fill("资质到期，等补件");
  await expect(suspend.getByText("8 / 500")).toBeVisible();
  await suspend.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(toast(page, `已暂停「${name}」`)).toBeVisible();
  await expect(page.getByText("这家供应商已暂停。")).toBeVisible();
  await expect(page.getByText(new RegExp(`原因：资质到期，等补件（${admin.email.replace(/[.+]/g, "\\$&")}，\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}）`))).toBeVisible();
  await expect(page.getByRole("button", { name: "恢复", exact: true })).toBeVisible();
  await snapshot(page, "platform-tenant-suspended-desktop");
  await expectAccessible(page, "供应商详情（已暂停）");

  // 对方仍然可以登录，首页显示已暂停
  await first.page.reload();
  await expect(first.page.locator(".tenant-status")).toHaveText("已暂停");

  // 恢复：确认里带着当初的原因
  await page.getByRole("button", { name: "恢复", exact: true }).click();
  const resume = page.getByRole("dialog", { name: `恢复「${name}」？` });
  await expect(resume).toContainText("当初暂停的原因：资质到期，等补件。请确认问题已经解决。");
  await resume.getByRole("button", { name: "恢复", exact: true }).click();
  await expect(toast(page, `已恢复「${name}」`)).toBeVisible();
  await expect(page.getByText("这家供应商已暂停。")).toHaveCount(0);
  await first.page.reload();
  await expect(first.page.locator(".tenant-status")).toHaveText("正常");

  // 再邀请一个管理员：已经在用的邮箱被拒；换一个邮箱拿到链接并能用
  const secondEmail = uniqueEmail("m110-admin2");
  await page.getByRole("button", { name: "邀请管理员" }).click();
  const inviteDialog = page.getByRole("dialog", { name: "邀请管理员" });
  await inviteDialog.getByLabel(/^邮箱/).fill(firstEmail);
  await inviteDialog.getByLabel(/^姓名/).fill("佐藤花子");
  await inviteDialog.getByRole("button", { name: "邀请", exact: true }).click();
  await expect(inviteDialog.getByText("这个邮箱已经有账号了", { exact: false })).toBeVisible();
  await inviteDialog.getByLabel(/^邮箱/).fill(secondEmail);
  await inviteDialog.getByRole("button", { name: "邀请", exact: true }).click();
  const secondInvite = await readLink(page, "邀请链接");
  await expectTokenNowhere(page, secondInvite.token, logs, { dialogOpen: true });
  await page.getByRole("dialog").getByRole("button", { name: "复制链接", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "我已经发给对方，关闭" }).click();
  await expect(toast(page, "已邀请「佐藤花子」")).toBeVisible();
  await expect(page.getByRole("button", { name: "邀请管理员" })).toBeFocused();
  await expectTokenNowhere(page, secondInvite.token, logs, { dialogOpen: false });
  const second = await useLink(browser, secondInvite.link, secondEmail, "tenant");
  await second.page.context().close();

  // 发密码重置：填错邮箱说得清；对的拿到链接，对方重置成功、旧密码作废
  await page.getByRole("button", { name: "发密码重置链接" }).click();
  const resetDialog = page.getByRole("dialog", { name: "给管理员发密码重置链接" });
  await resetDialog.getByLabel(/管理员的邮箱/).fill(uniqueEmail("nobody"));
  await resetDialog.getByRole("button", { name: "发出", exact: true }).click();
  await expect(resetDialog.getByText("这家供应商没有用这个邮箱的管理员。", { exact: false })).toBeVisible();
  await resetDialog.getByLabel(/管理员的邮箱/).fill(firstEmail);
  await resetDialog.getByRole("button", { name: "发出", exact: true }).click();
  const reset = await readLink(page, "密码重置链接");
  expect(reset.link).toContain("/reset-password#token=");
  await expect(page.getByRole("dialog")).toContainText("发出链接不会改掉对方现在的密码");
  await expect(page.getByRole("dialog")).toContainText(/（24 小时），只能用一次。/);
  await expectTokenNowhere(page, reset.token, logs, { dialogOpen: true });
  await page.getByRole("dialog").getByRole("button", { name: "复制链接", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "我已经发给对方，关闭" }).click();
  await expect(toast(page, "已给「山田太郎」发出密码重置链接")).toBeVisible();
  await first.page.context().close();
  const renewed = await useLink(browser, reset.link, firstEmail, "tenant");
  await renewed.page.context().close();
  const old = await page.request.post("/tenant/v1/auth/login", { data: { email: firstEmail, password: first.password } });
  expect(old.status(), "旧密码作废").toBe(401);

  // 审计日志：从详情页带着供应商过去，查得到这些操作和改前改后
  await page.getByRole("link", { name: "看这家供应商的操作记录" }).click();
  await expect(page).toHaveURL(new RegExp(`/platform/settings/audit-logs\\?tenant=${tenantId}$`));
  await expect(page.getByRole("heading", { level: 1, name: "审计日志" })).toBeVisible();
  const table = page.getByRole("region", { name: "审计日志" });
  for (const action of ["暂停", "恢复", "邀请", "发出密码重置", "接受邀请", "重设密码", "登录"]) await expect(table.locator(".tag", { hasText: new RegExp(`^${action}$`) }).first(), action).toBeVisible();
  const suspendRow = table.getByRole("row").filter({ has: page.locator(".tag", { hasText: /^暂停$/ }) });
  await expect(suspendRow).toContainText(admin.email);
  await expect(suspendRow).toContainText("供应商");
  await suspendRow.getByRole("button", { name: /条记录的详情$/ }).click();
  const detail = page.getByRole("dialog", { name: /^暂停 · 供应商/ });
  const diff = detail.getByRole("table");
  await expect(diff.getByRole("row", { name: /状态/ })).toContainText("正常");
  await expect(diff.getByRole("row", { name: /状态/ })).toContainText("已暂停");
  await expect(diff.getByRole("row", { name: /原因/ })).toContainText("资质到期，等补件");
  await expect(detail).toContainText("密码、密码的哈希、邀请和重置链接里的令牌不会被记录");
  await expect(detail).toContainText(name);
  await snapshot(page, "platform-audit-detail-desktop");
  await expectAccessible(page, "审计日志详情");
  // 审计日志里没有任何一个令牌
  const everything = await page.request.get(`/platform/v1/audit-logs?tenant_id=${tenantId}&limit=200`, { headers: { authorization: `Bearer ${await page.evaluate(() => JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find((key) => key.includes("platform")) ?? "") ?? "{}").accessToken as string)}` } });
  const audit = await everything.text();
  for (const token of [invite.token, secondInvite.token, reset.token]) expect(audit.includes(token), "审计日志里没有令牌").toBe(false);
  await page.keyboard.press("Escape");
  await expect(detail).toBeHidden();

  // 只看这个人、对象类型筛选、清空
  await table.getByRole("button", { name: `操作人 ${admin.email}` }).first().click();
  await page.getByRole("menuitem", { name: "只看这个人" }).click();
  await expect(page.getByText(`操作人：${admin.email}`)).toBeVisible();
  await page.locator("#audit-action").selectOption("suspend");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: `移除条件：操作人：${admin.email}` }).click();
  await page.getByRole("button", { name: "清空筛选" }).first().click();
  await expect(page).toHaveURL(/\/audit-logs$/);

  // 列表：搜得到，状态筛选，「更多」里的操作和详情页是同一套
  await page.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "供应商" }).click();
  await page.getByRole("searchbox", { name: "按名称搜索" }).fill(name.slice(0, 9).toUpperCase());
  await page.getByRole("searchbox", { name: "按名称搜索" }).press("Enter");
  const row = page.getByRole("row").filter({ has: page.getByRole("link", { name, exact: true }) });
  await expect(row).toContainText("正常");
  await row.getByRole("button", { name: /的更多操作$/ }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["邀请管理员", "暂停"]);
  await page.keyboard.press("Escape");
  expect(logs.filter((line) => [invite.token, secondInvite.token, reset.token].some((token) => line.includes(token)))).toEqual([]);
});

test("平台员工：新增（角色说明）拿到链接 → 对方设密码登录，只看到这个角色该看的 → 停用后登录被拒 → 启用 → 发密码重置；最后一个超级管理员停不掉；系统状态只读", async ({ page, browser, context }) => {
  test.setTimeout(240_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1280, height: 800 });
  const logs = collectLogs(page);
  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);
  await page.getByRole("navigation", { name: "主菜单" }).getByRole("button", { name: "系统设置" }).click();
  await page.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "平台员工" }).click();
  await expect(page).toHaveURL(/\/platform\/settings\/staff$/);
  const mine = page.getByRole("row").filter({ hasText: admin.email });
  await expect(mine).toContainText("你");
  await expect(mine).toContainText("超级管理员");
  await mine.getByRole("button", { name: /的更多操作$/ }).click();
  await expect(page.getByText("这是你自己的账号。")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "停用" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // 新增：角色没选不能交；每个角色写着现在能做什么
  const email = uniqueEmail("m110-staff");
  const staffName = `运营 ${random()}`;
  await page.getByRole("link", { name: "新增员工" }).click();
  await expect(page.getByRole("radio")).toHaveCount(10);
  await expect(page.getByText("现在能做的：管理供应商（新建、邀请管理员、暂停和恢复）、查看供应商的商品和价格、报价试算、看主数据、看渠道、看待审核的改动、看订单、手动重推给供应商的 Webhook。").first()).toBeVisible();
  // M2-04 起财务也能看渠道和待审核：不再有「负责的模块还没有上线」的角色
  await expect(page.getByText("负责对账、结算和付款。 现在能做的：看主数据、看渠道、看待审核的改动、看订单。").first()).toBeVisible();
  await page.getByLabel(/^邮箱/).fill(email);
  await page.getByLabel(/^姓名/).fill(staffName);
  await page.getByRole("button", { name: "新增", exact: true }).click();
  await expect(page.getByText("请选择角色")).toBeVisible();
  await page.getByRole("radio", { name: /^超级管理员/ }).check();
  await expect(page.getByText("超级管理员可以管理所有平台员工、看到全部审计日志。")).toBeVisible();
  await page.getByRole("radio", { name: /^运营/ }).check();
  await expectNoHorizontalOverflow(page, "新增员工");
  await expectAccessible(page, "新增员工");
  await page.getByRole("button", { name: "新增", exact: true }).click();
  const invite = await readLink(page, "邀请链接");
  expect(invite.link).toBe(`${new URL(page.url()).origin}/platform/accept-invite#token=${invite.token}`);
  await expect(page.getByRole("dialog")).toContainText(`给 ${staffName}（${email}）· 平台员工，运营`);
  await expectTokenNowhere(page, invite.token, logs, { dialogOpen: true });
  await page.getByRole("dialog").getByRole("button", { name: "复制链接", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "我已经发给对方，关闭" }).click();
  await expect(page).toHaveURL(/\/platform\/settings\/staff$/);
  await expect(toast(page, `已邀请「${staffName}」`)).toBeVisible();
  await expectTokenNowhere(page, invite.token, logs, { dialogOpen: false });
  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row).toContainText("待激活");

  // 对方设密码登录：运营看得到供应商和主数据，没有系统设置；直接打开地址说没有权限
  const staff = await useLink(browser, invite.link, email, "platform");
  const staffMenu = staff.page.getByRole("navigation", { name: "主菜单" });
  await expect(staffMenu.getByRole("link", { name: "供应商" })).toBeVisible();
  await expect(staffMenu.getByRole("button", { name: "系统设置" })).toHaveCount(0);
  for (const path of ["/platform/settings/staff", "/platform/settings/audit-logs", "/platform/settings/integrations"]) {
    await staff.page.goto(path);
    await expect(staff.page.getByText("你没有权限查看这里"), path).toBeVisible();
  }
  await staff.page.goto("/platform/tenants");
  await expect(staff.page.getByRole("link", { name: "新建供应商" })).toBeVisible();

  // 停用：确认；他马上不能登录
  await page.reload();
  await expect(row).toContainText("在用");
  await row.getByRole("button", { name: /的更多操作$/ }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["发密码重置链接", "停用", "看他的操作记录", "看这个账号的变更记录"]);
  await page.getByRole("menuitem", { name: "停用" }).click();
  const disable = page.getByRole("dialog", { name: `停用「${staffName}」？` });
  await expect(disable).toContainText("他马上不能登录，已经登录着的也会立刻退出。");
  await expect(disable.getByRole("button", { name: "取消" })).toBeFocused();
  await disable.getByRole("button", { name: "停用", exact: true }).click();
  await expect(toast(page, `已停用「${staffName}」`)).toBeVisible();
  await expect(row).toContainText("已停用");
  await staff.page.reload();
  await expect(staff.page).toHaveURL(/\/platform\/login/);
  const denied = await page.request.post("/platform/v1/auth/login", { data: { email, password: staff.password } });
  expect(denied.ok(), "停用后登录被拒").toBe(false);

  // 启用 → 发密码重置 → 用链接重置成功
  await row.getByRole("button", { name: /的更多操作$/ }).click();
  await page.getByRole("menuitem", { name: "启用" }).click();
  await page.getByRole("dialog", { name: `启用「${staffName}」？` }).getByRole("button", { name: "启用", exact: true }).click();
  await expect(toast(page, `已启用「${staffName}」`)).toBeVisible();
  await row.getByRole("button", { name: /的更多操作$/ }).click();
  await page.getByRole("menuitem", { name: "发密码重置链接" }).click();
  const ask = page.getByRole("dialog", { name: `给「${staffName}」发密码重置链接？` });
  await expect(ask).toContainText("发出链接不会改掉他现在的密码");
  await ask.getByRole("button", { name: "发出", exact: true }).click();
  const reset = await readLink(page, "密码重置链接");
  expect(reset.link).toContain("/platform/reset-password#token=");
  await expectTokenNowhere(page, reset.token, logs, { dialogOpen: true });
  await page.getByRole("dialog").getByRole("button", { name: "复制链接", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "我已经发给对方，关闭" }).click();
  await expect(toast(page, `已给「${staffName}」发出密码重置链接`)).toBeVisible();
  await staff.page.context().close();
  const renewed = await useLink(browser, reset.link, email, "platform");
  await renewed.page.context().close();

  // 看他的操作记录：带着操作人过去
  await row.getByRole("button", { name: /的更多操作$/ }).click();
  await page.getByRole("menuitem", { name: "看这个账号的变更记录" }).click();
  await expect(page).toHaveURL(/audit-logs\?resource=platform_user&rid=[0-9a-f-]{36}$/);
  await expect(page.getByText(`对象：平台员工 ${staffName}`)).toBeVisible();
  const table = page.getByRole("region", { name: "审计日志" });
  for (const action of ["邀请", "停用", "启用", "发出密码重置"]) await expect(table.locator(".tag", { hasText: new RegExp(`^${action}$`) }).first(), action).toBeVisible();

  // 系统状态：只读，写着每次打开都会记入日志；不带密钥原文
  await page.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "系统状态" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "系统状态" })).toBeVisible();
  await expect(page.getByText("每次打开这一页都会记入审计日志。", { exact: false })).toBeVisible();
  await expect(page.getByRole("region", { name: "系统状态" })).toContainText("数据加密密钥");
  await expect(page.getByRole("region", { name: "系统状态" }).getByRole("row")).toHaveCount(7);
  await expect(page.getByRole("region", { name: "系统状态" })).toContainText("数据库");
  await page.getByRole("button", { name: "重新检查" }).click();
  await expect(page.getByRole("status").filter({ hasText: /已重新检查，\d+ 项未配置/ })).toHaveCount(1);
  await expectAccessible(page, "系统状态");
  expect(logs.filter((line) => line.includes(invite.token) || line.includes(reset.token))).toEqual([]);
});

for (const scheme of ["light", "dark"] as const) {
  test(`${scheme === "light" ? "亮色" : "暗色"}：供应商列表、新建、详情、暂停对话框、平台员工、审计日志、系统状态通过 axe 检查；320px 宽都不横向滚动；只读角色只能看`, async ({ page, request }) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ colorScheme: scheme });
    const admin = adminCredentials();
    const login = await request.post("/platform/v1/auth/login", { data: admin });
    const headers = { authorization: `Bearer ${((await login.json()) as { access_token: string }).access_token}` };
    const tenantName = `很长很长的供应商名字`.repeat(6).slice(0, 90) + random();
    const created = await request.post("/platform/v1/tenants", { headers, data: { name: tenantName, admin: { email: uniqueEmail("m110-a11y"), name: "名字很长的管理员".repeat(8) } } });
    expect(created.status(), await created.text()).toBe(201);
    const tenantId = ((await created.json()) as { tenant: { id: string } }).tenant.id;
    const viewerEmail = uniqueEmail("m110-readonly");
    const invited = await request.post("/platform/v1/staff", { headers, data: { email: viewerEmail, name: "只读的同事", role: "readonly" } });
    const viewerPassword = newPassword();
    expect((await request.post("/platform/v1/auth/accept-invite", { data: { token: ((await invited.json()) as { invite: { token: string } }).invite.token, password: viewerPassword } })).ok()).toBe(true);

    await loginAs(page, "platform", admin.email, admin.password);
    const check = async (what: string): Promise<void> => {
      for (const width of [1280, 320]) {
        await page.setViewportSize({ width, height: 800 });
        await expectNoHorizontalOverflow(page, `${what}（${width}px）`);
        await expectAccessible(page, `${what}（${width}px，${scheme}）`);
      }
      await page.setViewportSize({ width: 1280, height: 800 });
    };
    await page.goto("/platform/tenants");
    await expect(page.getByRole("link", { name: tenantName, exact: true })).toBeVisible();
    await check("供应商列表");
    await page.goto("/platform/tenants/new");
    await page.getByRole("button", { name: "新建", exact: true }).click();
    await expect(page.getByText("请填写名称")).toBeVisible();
    await check("新建供应商（出错）");
    await page.goto(`/platform/tenants/${tenantId}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("很长很长的供应商名字");
    await check("供应商详情");
    await page.getByRole("button", { name: "暂停", exact: true }).click();
    await page.getByLabel(/暂停原因/).fill("原因".repeat(260));
    await page.getByRole("dialog").getByRole("button", { name: "暂停", exact: true }).click();
    await expect(page.getByText("原因最多 500 个字")).toBeVisible();
    await check("暂停对话框");
    await page.getByRole("dialog").getByRole("button", { name: "取消" }).click();
    await page.getByRole("button", { name: "邀请管理员" }).click();
    await page.getByRole("dialog").getByLabel(/^邮箱/).fill(uniqueEmail("m110-long"));
    await page.getByRole("dialog").getByLabel(/^姓名/).fill("名字很长的第二个管理员".repeat(6));
    await page.getByRole("dialog").getByRole("button", { name: "邀请", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "邀请链接（只显示这一次）" })).toBeVisible();
    await check("一次性链接对话框");
    await page.getByRole("dialog").getByRole("button", { name: "我已经发给对方，关闭" }).click();
    await check("一次性链接对话框（没复制就关的确认）");
    await page.getByRole("dialog").getByRole("button", { name: "仍然关闭" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.goto("/platform/settings/staff");
    await expect(page.getByRole("row").filter({ hasText: viewerEmail })).toBeVisible();
    await check("平台员工");
    await page.goto(`/platform/settings/audit-logs?tenant=${tenantId}`);
    await expect(page.getByRole("region", { name: "审计日志" }).locator(".tag").first()).toBeVisible();
    await check("审计日志");
    await page.getByRole("button", { name: /条记录的详情$/ }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await check("审计日志详情");
    await page.keyboard.press("Escape");
    await page.goto("/platform/settings/integrations");
    await expect(page.getByRole("region", { name: "系统状态" })).toContainText("数据库");
    await check("系统状态");
    await page.goto("/platform/settings/audit-logs?actor=不是编号&from=2026-02-31");
    await expect(page.getByText("网址里有一个筛选条件不对，已经忽略。")).toBeVisible();

    // 只读角色：看得到供应商，没有任何修改的入口；没有系统设置
    await page.evaluate(() => sessionStorage.clear());
    await loginAs(page, "platform", viewerEmail, viewerPassword);
    await expect(page.getByRole("navigation", { name: "主菜单" }).getByRole("button", { name: "系统设置" })).toHaveCount(0);
    await page.goto("/platform/tenants");
    await expect(page.getByText("你可以查看供应商，但不能修改。")).toBeVisible();
    await expect(page.getByRole("link", { name: "新建供应商" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /的更多操作$/ })).toHaveCount(0);
    await page.goto(`/platform/tenants/${tenantId}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("很长很长的供应商名字");
    await expect(page.getByRole("button", { name: /暂停|恢复|邀请管理员|发密码重置链接/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "看这家供应商的操作记录" })).toHaveCount(0);
    await page.goto("/platform/tenants/new");
    await expect(page.getByText("你没有权限查看这里")).toBeVisible();
    await check("只读角色的供应商详情");
  });
}
