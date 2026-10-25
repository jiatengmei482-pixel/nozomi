/**
 * M1-10 测试角色补的端到端测试：真实浏览器、真实后端、真实 PostgreSQL。
 * 重点是一次性链接（邀请 / 密码重置）不外泄、不被误关，网络不明时不重复创建，十个平台角色各自看得到什么，
 * 以及供应商名、姓名、暂停原因里的 HTML 经真实后端存取后各处只当文字。
 * 只在「请求发出、应答丢失」「应答超时」「浏览器不让写剪贴板」这几种要注入故障的地方拦请求 / 换掉浏览器接口，其余都不 mock。
 */
import { type APIRequestContext, type Browser, type Page, type Request, expect, test } from "@playwright/test";
import { expectAccessible, toast } from "./catalog.ts";
import { adminCredentials, clickLogin, createActiveTenant, createTemporaryPasswordAdmin, createTenant, expectNoHorizontalOverflow, fillLogin, loginAs, newPassword, platformAdminHeaders, uniqueEmail } from "./support.ts";

const random = (): string => Math.random().toString(36).slice(2, 8);
type Headers = Record<string, string>;

interface Staff {
  id: string;
  email: string;
  name: string;
  role: string;
  password: string;
  inviteToken: string;
}

/** 经接口邀请一个平台员工；`accept` 为真时顺便替他接受邀请、设好密码。 */
async function inviteStaff(request: APIRequestContext, headers: Headers, role: string, options: { name?: string; accept?: boolean } = {}): Promise<Staff> {
  const email = uniqueEmail(`qa-${role.replace(/_/g, "-")}`);
  const name = options.name ?? `测试 ${role} ${random()}`;
  const response = await request.post("/platform/v1/staff", { headers, data: { email, name, role } });
  expect(response.status(), await response.text()).toBe(201);
  const body = (await response.json()) as { user: { id: string }; invite: { token: string } };
  const password = newPassword();
  if (options.accept !== false) expect((await request.post("/platform/v1/auth/accept-invite", { data: { token: body.invite.token, password } })).ok(), "接受邀请").toBe(true);
  return { id: body.user.id, email, name, role, password, inviteToken: body.invite.token };
}

async function readLink(page: Page, title: "邀请链接" | "密码重置链接"): Promise<{ link: string; token: string }> {
  const dialog = page.getByRole("dialog", { name: `${title}（只显示这一次）` });
  await expect(dialog).toBeVisible();
  const link = await dialog.getByRole("textbox", { name: title }).inputValue();
  const token = link.split("#token=")[1] ?? "";
  expect(token.length, "链接里有令牌").toBeGreaterThan(20);
  return { link, token };
}

/**
 * 令牌出现在哪些不该出现的地方。对话框开着时，唯一允许的地方是对话框里那个只读文本框的值。
 * 查：地址、history.state、标题、window.name、两种 Storage、Cookie、IndexedDB、CacheStorage、Service Worker、
 * performance 记录、window 上的全局变量、整棵 DOM 的文字 / 属性值 / 输入框的值、所有会被读屏念出来的区域。
 */
async function leaks(page: Page, token: string): Promise<string[]> {
  const inPage = await page.evaluate(async (secret) => {
    const found: string[] = [];
    const has = (value: unknown): boolean => typeof value === "string" && value.includes(secret);
    if (has(location.href)) found.push("地址栏");
    if (has(JSON.stringify(history.state ?? null))) found.push("history.state");
    if (has(document.title)) found.push("document.title");
    if (has(window.name)) found.push("window.name");
    if (has(document.referrer)) found.push("document.referrer");
    for (const [name, storage] of [["localStorage", localStorage], ["sessionStorage", sessionStorage]] as const) {
      for (const key of Object.keys(storage)) if (has(key) || has(storage.getItem(key))) found.push(`${name}[${key}]`);
    }
    if (has(document.cookie)) found.push("Cookie");
    const databases = await indexedDB.databases();
    if (databases.length > 0) found.push(`IndexedDB（页面不该用它）：${databases.map((entry) => entry.name).join()}`);
    if ("caches" in window && (await caches.keys()).length > 0) found.push("CacheStorage");
    if ((await navigator.serviceWorker?.getRegistrations())?.length) found.push("Service Worker");
    if (performance.getEntries().some((entry) => has(entry.name))) found.push("performance 记录");
    for (const key of Object.keys(window)) {
      try {
        const value = (window as unknown as Record<string, unknown>)[key];
        if (has(value) || (typeof value === "object" && value !== null && !(value instanceof Node) && !(value instanceof Window) && key.startsWith("__") && has(JSON.stringify(value)))) found.push(`window.${key}`);
      } catch {
        // 读不了的全局对象（跨域的 frame 等）不算
      }
    }
    for (const node of document.querySelectorAll("*")) {
      const allowed = node.tagName === "TEXTAREA" && node.closest("dialog[open]") !== null && (node as HTMLTextAreaElement).readOnly;
      const where = node.closest("dialog") !== null ? "对话框里" : "页面上";
      for (const attribute of node.attributes) if (has(attribute.value)) found.push(`${where} <${node.tagName.toLowerCase()}> 的属性 ${attribute.name}`);
      if (!allowed && node.children.length === 0 && has(node.textContent)) found.push(`${where} <${node.tagName.toLowerCase()}> 的文字`);
      if (!allowed && has((node as HTMLInputElement).value)) found.push(`${where} <${node.tagName.toLowerCase()}> 的值`);
    }
    for (const live of document.querySelectorAll('[aria-live], [role="status"], [role="alert"], [role="log"], .toast-region, .toast')) if (has(live.textContent)) found.push(`播报区 <${live.tagName.toLowerCase()} class="${live.className}">`);
    return found;
  }, token);
  const cookies = (await page.context().cookies()).filter((cookie) => cookie.value.includes(token) || cookie.name.includes(token)).map((cookie) => `Cookie ${cookie.name}`);
  return [...inPage, ...cookies];
}

/** 记下这一页之后发出的每个请求（地址、请求头、请求体），用来确认令牌没有被带出去。 */
function recordRequests(page: Page): { all: Request[]; carrying(token: string): string[] } {
  const all: Request[] = [];
  page.on("request", (request) => all.push(request));
  return {
    all,
    carrying: (token) => all.filter((request) => request.url().includes(token) || JSON.stringify(request.headers()).includes(token) || (request.postData() ?? "").includes(token)).map((request) => `${request.method()} ${request.url()}`),
  };
}

function collectLogs(page: Page): string[] {
  const logs: string[] = [];
  page.on("console", (message) => logs.push(message.text()));
  page.on("pageerror", (error) => logs.push(String(error)));
  return logs;
}

/** 对方在另一台电脑上打开链接、设密码、登录。 */
async function useLink(browser: Browser, link: string, email: string, portal: "tenant" | "platform"): Promise<{ page: Page; password: string }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const password = newPassword();
  await page.goto(link);
  await page.getByLabel("新密码").fill(password);
  await page.getByLabel("再输入一次").fill(password);
  await page.getByRole("button", { name: /^设置(新)?密码并继续$/ }).click();
  await expect(page.getByLabel("邮箱")).toHaveValue(email);
  // 设好密码以后，对方的浏览器里也不留令牌：地址、历史记录里都没有
  const token = link.split("#token=")[1] ?? "";
  expect(page.url().includes(token), "设好密码后地址栏里不留令牌").toBe(false);
  expect(await page.evaluate((secret) => JSON.stringify(history.state ?? null).includes(secret) || document.body.innerHTML.includes(secret), token)).toBe(false);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await clickLogin(page, email);
  await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(portal === "tenant" ? "/" : "/platform");
  return { page, password };
}

/** 这条链接已经用不了：一打开就说链接已失效，不显示设密码的表单（M1-13）。 */
async function expectDeadLink(browser: Browser, link: string, kind: "邀请" | "重置"): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(link);
  await expect(page.getByRole("heading", { level: 1, name: `${kind}链接已失效` })).toBeVisible();
  await expect(page.getByLabel("新密码")).toHaveCount(0);
  await context.close();
}

async function fillNewTenant(page: Page, name: string, email: string, adminName: string): Promise<void> {
  await page.goto("/platform/tenants/new");
  await page.getByLabel(/^名称/).fill(name);
  await page.getByLabel(/^邮箱/).fill(email);
  await page.getByLabel(/^姓名/).fill(adminName);
}

async function adminPage(page: Page): Promise<{ email: string; password: string }> {
  const admin = adminCredentials();
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginAs(page, "platform", admin.email, admin.password);
  return admin;
}

/** 全部供应商（接口只能翻页）。 */
async function allTenants(request: APIRequestContext, headers: Headers): Promise<{ id: string; name: string; status: string }[]> {
  const items: { id: string; name: string; status: string }[] = [];
  let cursor: string | null = null;
  do {
    const response = await request.get(`/platform/v1/tenants?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { headers });
    const page = (await response.json()) as { items: { id: string; name: string; status: string }[]; next_cursor: string | null };
    items.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor !== null);
  return items;
}

// ───────────── 一次性链接：不被误关 ─────────────

test("一次性链接对话框连按几次 Esc 也不会被浏览器关掉：链接还在，只能用底部的按钮关（规范：Esc、点遮罩都不关闭）", async ({ page }) => {
  await adminPage(page);
  await fillNewTenant(page, `连按 Esc ${random()}`, uniqueEmail("qa-esc"), "山田太郎");
  await page.getByRole("button", { name: "新建", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "邀请链接（只显示这一次）" });
  await expect(dialog).toBeVisible();
  const { link } = await readLink(page, "邀请链接");
  // 浏览器只允许页面拦下头一两次 Esc，再按就直接把 <dialog> 关掉，页面收不到可以拦的事件
  for (let press = 1; press <= 4; press += 1) {
    await page.keyboard.press("Escape");
    const state = await page.evaluate(() => {
      const box = [...document.querySelectorAll("dialog")].find((entry) => entry.querySelector("textarea") !== null);
      return { open: box?.open ?? false, stuck: [...document.querySelectorAll<HTMLButtonElement>(".form-bar button")].every((button) => button.disabled) };
    });
    expect(state.open, `第 ${press} 次按 Esc 后对话框被关掉了：链接看不到了${state.stuck ? "，「取消」「新建」都点不了，只能刷新页面" : ""}`).toBe(true);
  }
  await expect(dialog.getByRole("textbox", { name: "邀请链接" })).toHaveValue(link);
  await expect(dialog.getByRole("button", { name: "我已经发给对方，关闭" })).toBeVisible();
});

test("确认对话框在等结果时（暂停中…）连按 Esc 也不会被浏览器关掉：之后的出错提示看得到（规范：等待时 Esc、遮罩、关闭按钮都不起作用）", async ({ page, request }) => {
  const tenant = await createTenant(request);
  await adminPage(page);
  await page.goto(`/platform/tenants/${tenant.tenantId}`);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `暂停「${tenant.tenantName}」？` });
  await dialog.getByLabel(/暂停原因/).fill("连按 Esc");
  // 让应答晚一点回来，并且是一个出错的应答
  await page.route(/\/platform\/v1\/tenants\/[^/]+\/suspend$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await route.fulfill({ status: 500, json: { error: { code: "INTERNAL_ERROR", message: "x", details: {} } } });
  });
  await dialog.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "暂停中…" })).toBeVisible();
  for (let press = 1; press <= 4; press += 1) await page.keyboard.press("Escape");
  await expect(dialog, "等待时按 Esc 不该关掉对话框").toBeVisible();
  await expect(dialog.getByText("系统暂时无法暂停，请稍后再试。")).toBeVisible();
});

// ───────────── 一次性链接：令牌不外泄 ─────────────

test("新建供应商拿到链接后：令牌只在对话框那个只读文本框里——地址、历史、标题、存储、IndexedDB、Cookie、全局变量、播报区、之后的任何请求、控制台里都没有；改窗口宽度、换主题、刷新被拦下时链接都还在；Tab 出不了对话框；关闭后哪里都没有", async ({ page, browser, context }) => {
  test.setTimeout(180_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const logs = collectLogs(page);
  await adminPage(page);
  const name = `不外泄 ${random()}`;
  const email = uniqueEmail("qa-leak");
  await fillNewTenant(page, name, email, "山田太郎");
  const requests = recordRequests(page);
  await page.getByRole("button", { name: "新建", exact: true }).click();
  const { link, token } = await readLink(page, "邀请链接");
  const dialog = page.getByRole("dialog", { name: "邀请链接（只显示这一次）" });
  const box = dialog.getByRole("textbox", { name: "邀请链接" });
  expect(link).toBe(`${new URL(page.url()).origin}/accept-invite#token=${token}`);
  expect(new URL(link).search, "令牌不在查询串里").toBe("");
  expect(await leaks(page, token), "对话框开着时").toEqual([]);
  await expect(page).toHaveTitle("新建供应商 · NOZOMI 运营后台");

  // 焦点出不了对话框：Tab 顺序是 复制链接 → 复制链接和说明 → 关闭 →（绕回）链接文本框
  await expect(dialog.getByRole("button", { name: "复制链接", exact: true })).toBeFocused();
  const focusPath: string[] = [];
  for (let step = 0; step < 9; step += 1) {
    await page.keyboard.press("Tab");
    focusPath.push(await page.evaluate(() => (document.activeElement?.closest("dialog[open]") ? (document.activeElement.getAttribute("aria-label") ?? document.activeElement.textContent ?? "") : document.activeElement === document.body ? "（页面之外）" : `对话框外：${document.activeElement?.textContent ?? ""}`)));
  }
  expect(focusPath.filter((entry) => entry.startsWith("对话框外")), "Tab 不会走到对话框后面的页面上").toEqual([]);
  expect(focusPath.filter((entry) => entry !== "（页面之外）").slice(0, 4)).toEqual(["复制链接和说明", "我已经发给对方，关闭", "邀请链接", "复制链接"]);
  // 后面的页面点不到（遮罩挡着），点哪里都不关
  for (const [x, y] of [[5, 5], [1270, 5], [640, 790], [5, 400]] as const) await page.mouse.click(x, y);
  await expect(box).toHaveValue(link);
  await expect(page).toHaveURL(/\/platform\/tenants\/new$/);

  // 改窗口宽度、系统换成暗色：对话框还在、链接没变、不横向滚动；窄屏上链接不用在文本框里滚动就能看全
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 720 });
    await expect(box).toHaveValue(link);
    await expectNoHorizontalOverflow(page, `一次性链接对话框（${width}px）`);
    const fits = await box.evaluate((node) => ({ scroll: node.scrollHeight, client: node.clientHeight, horizontal: node.scrollWidth - node.clientWidth }));
    expect(fits.scroll, `${width}px 宽：链接要能看全（文本框里不用滚动）`).toBeLessThanOrEqual(fits.client + 1);
    expect(fits.horizontal, `${width}px 宽：链接不横向滚动`).toBeLessThanOrEqual(1);
  }
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(box).toHaveValue(link);
  await expectAccessible(page, "一次性链接对话框（暗色，换主题后）");
  await page.emulateMedia({ colorScheme: "light" });
  expect(await leaks(page, token), "改宽度、换主题以后").toEqual([]);

  // 刷新会被浏览器拦一次；选「留下」链接还在
  const prompts: string[] = [];
  page.once("dialog", (prompt) => {
    prompts.push(prompt.type());
    void prompt.dismiss();
  });
  await page.evaluate(() => location.reload()).catch(() => undefined);
  await expect.poll(() => prompts, "对话框开着时刷新，浏览器要问一次").toEqual(["beforeunload"]);
  await expect(box).toHaveValue(link);

  // 复制、关闭：之后才换到详情页；Toast 里没有链接
  await dialog.getByRole("button", { name: "复制链接", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("链接已复制");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  expect(await leaks(page, token), "复制以后（播报的是「链接已复制」，不是链接本身）").toEqual([]);
  await dialog.getByRole("button", { name: "我已经发给对方，关闭" }).click();
  await expect(page).toHaveURL(/\/platform\/tenants\/[0-9a-f-]{36}$/);
  await expect(toast(page, `已新建供应商「${name}」`)).toBeVisible();
  expect(await leaks(page, token), "关闭以后").toEqual([]);
  expect(await page.evaluate(() => [...document.querySelectorAll("dialog")].filter((entry) => entry.querySelector("textarea") !== null).length), "关闭后 DOM 里不留那个对话框").toBe(0);

  // 后退、前进、刷新、去别的页面：都找不回令牌
  const tenantUrl = page.url();
  await page.goBack();
  expect(await leaks(page, token), "后退以后").toEqual([]);
  await expect(page).not.toHaveURL(/\/tenants\/new$/);
  await page.goForward();
  await page.goto(tenantUrl);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  expect(await leaks(page, token), "刷新以后").toEqual([]);
  await page.getByRole("link", { name: "看这家供应商的操作记录" }).click();
  await expect(page.getByRole("region", { name: "审计日志" }).locator(".tag").first()).toBeVisible();
  await page.getByRole("button", { name: /条记录的详情$/ }).first().click();
  await expect(page.getByRole("dialog")).toContainText("邀请和重置链接里的令牌不会被记录");
  expect(await leaks(page, token), "审计日志里").toEqual([]);
  await page.keyboard.press("Escape");
  await page.goto("/platform");
  await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();
  expect(requests.carrying(token), "发出令牌之后的任何请求（地址、请求头含 Referer、请求体）里都不带它").toEqual([]);
  expect(requests.all.filter((request) => request.method() === "POST" && new URL(request.url()).pathname === "/platform/v1/tenants").length, "新建只发了一次").toBe(1);
  expect(logs.filter((line) => line.includes(token)), "控制台里没有令牌").toEqual([]);

  // 链接是真的：对方用它设密码、登录到这家供应商
  const used = await useLink(browser, link, email, "tenant");
  await expect(used.page.locator(".tenant-name")).toHaveText(name);
  await used.page.context().close();
  await expectDeadLink(browser, link, "邀请");
});

test("对话框开着时真的刷新了页面（在浏览器的确认里选了离开）：刷新后的页面、表单、存储里都找不回令牌；供应商已经建好，到详情页用同一个邮箱重新邀请，新链接能用、旧链接作废", async ({ page, browser, request }) => {
  test.setTimeout(120_000);
  await adminPage(page);
  const name = `刷新丢链接 ${random()}`;
  const email = uniqueEmail("qa-reload");
  await fillNewTenant(page, name, email, "山田太郎");
  await page.getByRole("button", { name: "新建", exact: true }).click();
  const first = await readLink(page, "邀请链接");
  page.once("dialog", (prompt) => void prompt.accept());
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "新建供应商" })).toBeVisible();
  await expect(page.getByLabel(/^名称/)).toHaveValue("");
  await expect(page.getByLabel(/^邮箱/)).toHaveValue("");
  expect(await leaks(page, first.token), "刷新以后（浏览器恢复表单时也不能把链接带回来）").toEqual([]);
  await page.goBack().catch(() => undefined);
  expect(await leaks(page, first.token), "刷新再后退").toEqual([]);

  // 供应商已经建好：列表里找得到，详情页重新邀请
  const tenant = (await allTenants(request, await platformAdminHeaders(request))).filter((entry) => entry.name === name);
  expect(tenant.length, "只建了一家").toBe(1);
  await page.goto(`/platform/tenants/${tenant[0]?.id ?? ""}`);
  await expect(page.getByText("之前的邀请链接没有交到对方手里、或已经过期：点「邀请管理员」，填同一个邮箱，会发出一条新的链接，旧的作废。")).toBeVisible();
  await page.getByRole("button", { name: "邀请管理员" }).click();
  const dialog = page.getByRole("dialog", { name: "邀请管理员" });
  await dialog.getByLabel(/^邮箱/).fill(email);
  await dialog.getByLabel(/^姓名/).fill("山田太郎");
  await dialog.getByLabel(/^姓名/).press("Enter");
  const second = await readLink(page, "邀请链接");
  expect(second.token).not.toBe(first.token);
  await page.getByRole("dialog").getByRole("button", { name: "我已经发给对方，关闭" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "仍然关闭" }).click();
  await expect(toast(page, "已邀请「山田太郎」")).toBeVisible();
  await expectDeadLink(browser, first.link, "邀请");
  const used = await useLink(browser, second.link, email, "tenant");
  await expect(used.page.locator(".tenant-name")).toHaveText(name);
  await used.page.context().close();
});

test("对话框开着时按浏览器的后退：令牌跟着页面一起消失，前进回来是空表单，哪里都找不回（这时链接已丢，只能重新邀请）", async ({ page }) => {
  await adminPage(page);
  await page.goto("/platform/tenants");
  await page.getByRole("link", { name: "新建供应商" }).first().click();
  await page.getByLabel(/^名称/).fill(`后退 ${random()}`);
  await page.getByLabel(/^邮箱/).fill(uniqueEmail("qa-back"));
  await page.getByLabel(/^姓名/).fill("山田太郎");
  await page.getByRole("button", { name: "新建", exact: true }).click();
  const { token } = await readLink(page, "邀请链接");
  await page.goBack();
  await expect(page).toHaveURL(/\/platform\/tenants$/);
  expect(await leaks(page, token), "后退以后").toEqual([]);
  await page.goForward();
  await expect(page.getByRole("heading", { level: 1, name: "新建供应商" })).toBeVisible();
  await expect(page.getByLabel(/^名称/)).toHaveValue("");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await leaks(page, token), "前进回来").toEqual([]);
});

test("浏览器不让写剪贴板：说没有复制成功、链接已选中；这时不算复制过，关闭要再确认；在文本框里按 Ctrl+C 复制以后才直接关闭", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new DOMException("denied", "NotAllowedError")) } });
  });
  await adminPage(page);
  const name = `复制失败 ${random()}`;
  await fillNewTenant(page, name, uniqueEmail("qa-clip"), "山田太郎");
  await page.getByRole("button", { name: "新建", exact: true }).click();
  const { link, token } = await readLink(page, "邀请链接");
  const dialog = page.getByRole("dialog", { name: "邀请链接（只显示这一次）" });
  const box = dialog.getByRole("textbox", { name: "邀请链接" });
  await dialog.getByRole("button", { name: "复制链接和说明" }).click();
  await expect(dialog.getByText("没有复制成功。链接已经选中，请按 Ctrl + C（Mac 上是 ⌘ + C）复制。")).toBeVisible();
  await expect(box).toBeFocused();
  expect(await box.evaluate((node: HTMLTextAreaElement) => node.value.slice(node.selectionStart, node.selectionEnd))).toBe(link);
  await expect(dialog.getByRole("button", { name: "已复制" })).toHaveCount(0);
  expect(await leaks(page, token), "复制失败的提示里不带链接").toEqual([]);
  await dialog.getByRole("button", { name: "我已经发给对方，关闭" }).click();
  await expect(dialog.getByText("还没有复制过这条链接。关闭以后无法再看到，只能重新发起。")).toBeVisible();
  await dialog.getByRole("button", { name: "回去复制" }).click();
  await box.focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+c");
  await dialog.getByRole("button", { name: "我已经发给对方，关闭" }).click();
  await expect(toast(page, `已新建供应商「${name}」`)).toBeVisible();
  await expect(page).toHaveURL(/\/platform\/tenants\/[0-9a-f-]{36}$/);
});

// ───────────── 网络不明：不重复创建、不重复发令牌 ─────────────

test("新建供应商的请求发出去了、应答丢了：页面说「不确定有没有建成」并且不自动重试；其实已经建成——再点一次被「邮箱已被使用」拦住，不会多出一家；按提示去列表找到它，在详情页重新邀请拿到的链接能用", async ({ page, browser, request }) => {
  test.setTimeout(150_000);
  await adminPage(page);
  const headers = await platformAdminHeaders(request);
  const name = `应答丢了 ${random()}`;
  const email = uniqueEmail("qa-lost");
  let posts = 0;
  await page.route("**/platform/v1/tenants", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    posts += 1;
    if (posts > 1) return route.fallback();
    await route.fetch();
    await route.abort("connectionreset");
  });
  await fillNewTenant(page, name, email, "山田太郎");
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await expect(page.getByText("不确定有没有建成。")).toBeVisible();
  await expect(page.getByText(`请先回到供应商列表看一眼有没有「${name}」：有的话不要再建一次，到它的详情页点「邀请管理员」重新拿链接；没有再回来重试。`)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.waitForTimeout(1500);
  expect(posts, "没有自动重试").toBe(1);
  expect((await allTenants(request, headers)).filter((entry) => entry.name === name).length, "其实已经建成了一家").toBe(1);

  // 不听劝直接再点一次：同一个邮箱被拦住，不会多出一家
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await expect(page.getByText("这个邮箱已经是某家供应商的账号了", { exact: false })).toBeVisible();
  expect(posts).toBe(2);
  expect((await allTenants(request, headers)).filter((entry) => entry.name === name).length, "没有多出一家同名的").toBe(1);

  // 去列表（被「邮箱已被使用」拦下以后，「不确定有没有建成」那一条和它的链接已经换掉了，从菜单走）：离开前会问一次（表单里有没提交的内容），列表里找得到
  await expect(page.getByRole("link", { name: "去供应商列表看一眼" })).toHaveCount(0);
  await page.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "供应商" }).click();
  await page.getByRole("dialog", { name: "填的内容还没有提交" }).getByRole("button", { name: "不保存，离开" }).click();
  await expect(page).toHaveURL(/\/platform\/tenants$/);
  await page.getByRole("searchbox", { name: "按名称搜索" }).fill(name);
  await page.getByRole("searchbox", { name: "按名称搜索" }).press("Enter");
  await page.getByRole("link", { name, exact: true }).click();
  await page.getByRole("button", { name: "邀请管理员" }).click();
  const dialog = page.getByRole("dialog", { name: "邀请管理员" });
  await dialog.getByLabel(/^邮箱/).fill(email);
  await dialog.getByLabel(/^姓名/).fill("山田太郎");
  await dialog.getByRole("button", { name: "邀请", exact: true }).click();
  const { link } = await readLink(page, "邀请链接");
  const used = await useLink(browser, link, email, "tenant");
  await expect(used.page.locator(".tenant-name")).toHaveText(name);
  await used.page.context().close();
});

test("给员工发密码重置时应答超时（10 秒）：说「不确定有没有成功」、不自动重试；迟到的应答不会把链接带到页面上；再点一次拿到新链接，丢掉的那一条确实作废了，新链接能用", async ({ page, browser, request }) => {
  test.setTimeout(180_000);
  const headers = await platformAdminHeaders(request);
  const staff = await inviteStaff(request, headers, "readonly");
  const logs = collectLogs(page);
  await adminPage(page);
  let calls = 0;
  let lost = "";
  await page.route(/\/platform\/v1\/staff\/[^/]+\/password-reset$/, async (route) => {
    calls += 1;
    if (calls > 1) return route.fallback();
    const response = await route.fetch();
    lost = ((await response.json()) as { reset: { token: string } }).reset.token;
    await new Promise((resolve) => setTimeout(resolve, 12_000));
    await route.fulfill({ response }).catch(() => undefined);
  });
  await page.goto(`/platform/settings/staff?q=${encodeURIComponent(staff.email)}`);
  const row = page.getByRole("row").filter({ hasText: staff.email });
  await row.getByRole("button", { name: /的更多操作$/ }).click();
  await page.getByRole("menuitem", { name: "发密码重置链接" }).click();
  const ask = page.getByRole("dialog", { name: `给「${staff.name}」发密码重置链接？` });
  await ask.getByRole("button", { name: "发出", exact: true }).click();
  await expect(ask.getByRole("button", { name: "发出中…" })).toBeVisible();
  await expect(ask.getByText("不确定有没有成功。")).toBeVisible({ timeout: 15_000 });
  await expect(ask).toContainText("如果其实已经成功了，再试一次会发出一条新的链接，之前那条作废——没有影响，因为它还没有交到任何人手里。");
  await page.waitForTimeout(3500);
  expect(calls, "没有自动重试").toBe(1);
  expect(lost.length).toBeGreaterThan(20);
  await expect(page.getByRole("dialog", { name: /只显示这一次/ })).toHaveCount(0);
  expect(await leaks(page, lost), "迟到的应答不进页面").toEqual([]);

  await ask.getByRole("button", { name: "发出", exact: true }).click();
  const fresh = await readLink(page, "密码重置链接");
  expect(fresh.token).not.toBe(lost);
  expect(fresh.link).toBe(`${new URL(page.url()).origin}/platform/reset-password#token=${fresh.token}`);
  const stale = await request.post("/platform/v1/auth/reset-password", { data: { token: lost, password: newPassword() } });
  expect(stale.ok(), "丢掉的那一条已经作废").toBe(false);
  await page.getByRole("dialog").getByRole("button", { name: "我已经发给对方，关闭" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "仍然关闭" }).click();
  await expect(toast(page, `已给「${staff.name}」发出密码重置链接`)).toBeVisible();
  const used = await useLink(browser, fresh.link, staff.email, "platform");
  await used.page.context().close();
  expect(logs.filter((line) => line.includes(lost) || line.includes(fresh.token)), "控制台里没有令牌（出错时也没有）").toEqual([]);
});

test("链接对话框开着时自己的登录被作废（账号被别的管理员停用）：对话框和链接都还在，可以复制、关闭；之后一操作就被送去登录页，地址、历史、存储里都不带令牌；发出去的链接照样能用", async ({ page, browser, request, context }) => {
  test.setTimeout(150_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const headers = await platformAdminHeaders(request);
  const second = await inviteStaff(request, headers, "super_admin");
  const target = await inviteStaff(request, headers, "finance");
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginAs(page, "platform", second.email, second.password);
  await page.goto(`/platform/settings/staff?q=${encodeURIComponent(target.email)}`);
  await page.getByRole("row").filter({ hasText: target.email }).getByRole("button", { name: /的更多操作$/ }).click();
  await page.getByRole("menuitem", { name: "发密码重置链接" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "发出", exact: true }).click();
  const { link, token } = await readLink(page, "密码重置链接");
  await expect(page.getByRole("dialog")).toContainText(`给 ${target.name}（${target.email}）· 平台员工，财务`);

  expect((await request.post(`/platform/v1/staff/${second.id}/disable`, { headers })).ok(), "另一个管理员把他停用").toBe(true);
  await page.waitForTimeout(1000);
  await expect(page.getByRole("dialog").getByRole("textbox", { name: "密码重置链接" }), "登录被作废时链接还在").toHaveValue(link);
  await page.getByRole("dialog").getByRole("button", { name: "复制链接", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "我已经发给对方，关闭" }).click();
  await expect(toast(page, `已给「${target.name}」发出密码重置链接`)).toBeVisible();
  // 之后的任何操作：登录已过期，回登录页
  await page.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "供应商" }).click();
  await expect(page).toHaveURL(/\/platform\/login$/);
  await expect(page.getByText("登录已过期，请重新登录。")).toBeVisible();
  expect(await leaks(page, token), "被送去登录页以后").toEqual([]);
  await page.goBack().catch(() => undefined);
  expect(await leaks(page, token), "登录页后退").toEqual([]);
  const used = await useLink(browser, link, target.email, "platform");
  await used.page.context().close();
});

// ───────────── 重新邀请、用过的链接 ─────────────

test("平台员工的重新邀请：从列表带着邮箱（只读）、姓名、角色过去，改了角色再发——新链接能用、旧链接作废、用过一次的链接不能再用；停用从没设过密码的账号后启用被拒，并能从提示里去重新邀请", async ({ page, browser, request }) => {
  test.setTimeout(200_000);
  const headers = await platformAdminHeaders(request);
  const invited = await inviteStaff(request, headers, "readonly", { accept: false });
  const logs = collectLogs(page);
  await adminPage(page);
  await page.goto(`/platform/settings/staff?q=${encodeURIComponent(invited.email)}`);
  const row = page.getByRole("row").filter({ hasText: invited.email });
  await expect(row).toContainText("待激活");
  await row.getByRole("button", { name: /的更多操作$/ }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["重新邀请", "停用", "看他的操作记录", "看这个账号的变更记录"]);
  await page.getByRole("menuitem", { name: "重新邀请" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `重新邀请 ${invited.name}` })).toBeVisible();
  await expect(page.getByLabel(/^邮箱/)).toHaveValue(invited.email);
  await expect(page.getByLabel(/^邮箱/)).not.toBeEditable();
  await expect(page.getByRole("radio", { name: /^只读/ })).toBeChecked();
  await page.getByRole("radio", { name: /^技术/ }).check();
  await page.getByRole("button", { name: "重新邀请", exact: true }).click();
  const second = await readLink(page, "邀请链接");
  expect(second.link).toBe(`${new URL(page.url()).origin}/platform/accept-invite#token=${second.token}`);
  expect(second.token).not.toBe(invited.inviteToken);
  await expect(page.getByRole("dialog")).toContainText(`给 ${invited.name}（${invited.email}）· 平台员工，技术`);
  expect(await leaks(page, second.token), "重新邀请的链接").toEqual([]);
  await page.getByRole("dialog").getByRole("button", { name: "我已经发给对方，关闭" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "仍然关闭" }).click();
  await expect(page).toHaveURL(/\/platform\/settings\/staff$/);
  await expect(toast(page, `已邀请「${invited.name}」`)).toBeVisible();
  expect(await leaks(page, second.token), "回到列表以后").toEqual([]);
  await expect(page.getByRole("row").filter({ hasText: invited.email })).toContainText("技术");
  const origin = new URL(page.url()).origin;
  await expectDeadLink(browser, `${origin}/platform/accept-invite#token=${invited.inviteToken}`, "邀请");
  const used = await useLink(browser, second.link, invited.email, "platform");
  // 他是技术：菜单里只有系统状态
  await used.page.getByRole("navigation", { name: "主菜单" }).getByRole("button", { name: "系统设置" }).click();
  await expect(used.page.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "系统状态" })).toBeVisible();
  await expect(used.page.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "平台员工" })).toHaveCount(0);
  await used.page.context().close();
  await expectDeadLink(browser, second.link, "邀请");

  // 从没设过密码就被停用的：启用被拒，从提示里去重新邀请
  const never = await inviteStaff(request, headers, "finance", { accept: false });
  await page.goto(`/platform/settings/staff?q=${encodeURIComponent(never.email)}`);
  const neverRow = page.getByRole("row").filter({ hasText: never.email });
  await neverRow.getByRole("button", { name: /的更多操作$/ }).click();
  await page.getByRole("menuitem", { name: "停用" }).click();
  const disable = page.getByRole("dialog", { name: `停用「${never.name}」？` });
  await expect(disable).toContainText("他还没有设过密码，之前发给他的邀请链接会作废。之后可以重新邀请。");
  await disable.getByRole("button", { name: "停用", exact: true }).click();
  await expect(toast(page, `已停用「${never.name}」`)).toBeVisible();
  await expect(neverRow).toContainText("已停用");
  await expectDeadLink(browser, `${origin}/platform/accept-invite#token=${never.inviteToken}`, "邀请");
  await neverRow.getByRole("button", { name: /的更多操作$/ }).click();
  await page.getByRole("menuitem", { name: "启用" }).click();
  const enable = page.getByRole("dialog", { name: `启用「${never.name}」？` });
  await enable.getByRole("button", { name: "启用", exact: true }).click();
  await expect(enable.getByText("这个账号还没有设过密码，不能直接启用。请重新邀请他。")).toBeVisible();
  await expect(enable.getByRole("button", { name: "启用", exact: true })).toHaveCount(0);
  await enable.getByRole("link", { name: "去重新邀请" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `重新邀请 ${never.name}` })).toBeVisible();
  await expect(page.getByLabel(/^邮箱/)).toHaveValue(never.email);
  await page.getByRole("button", { name: "重新邀请", exact: true }).click();
  const third = await readLink(page, "邀请链接");
  await page.getByRole("dialog").getByRole("button", { name: "我已经发给对方，关闭" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "仍然关闭" }).click();
  const again = await useLink(browser, third.link, never.email, "platform");
  await again.page.context().close();

  // 这些令牌都不在审计日志里（平台级的记录也查）
  const audit = await (await request.get("/platform/v1/audit-logs?limit=200", { headers })).text();
  const own = await (await request.get(`/platform/v1/audit-logs?resource=platform_user&resource_id=${invited.id}&limit=200`, { headers })).text();
  for (const token of [invited.inviteToken, second.token, never.inviteToken, third.token]) expect(audit.includes(token) || own.includes(token), "审计日志里没有令牌").toBe(false);
  expect(logs.filter((line) => [second.token, third.token].some((token) => line.includes(token)))).toEqual([]);
});

// ───────────── 只用键盘 ─────────────

test("只用键盘：从供应商列表走到「新建供应商 → 复制链接 → 关闭」，再走完「新增员工」；全程不碰鼠标", async ({ page, context }) => {
  test.setTimeout(150_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await adminPage(page);
  await page.goto("/platform/tenants");
  await expect(page.getByRole("heading", { level: 1, name: "供应商" })).toBeVisible();
  const tabTo = async (name: RegExp, limit = 60): Promise<void> => {
    for (let step = 0; step < limit; step += 1) {
      await page.keyboard.press("Tab");
      const label = await page.evaluate(() => `${document.activeElement?.getAttribute("aria-label") ?? ""}|${(document.activeElement?.textContent ?? "").trim()}|${document.activeElement?.id ?? ""}|${(document.activeElement as HTMLInputElement | null)?.name ?? ""}`);
      if (name.test(label)) return;
    }
    throw new Error(`按了 ${limit} 次 Tab 也没走到 ${String(name)}`);
  };
  const name = `键盘 ${random()}`;
  const email = uniqueEmail("qa-keyboard");
  await tabTo(/\|新建供应商\|/);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/platform\/tenants\/new$/);
  await tabTo(/\|tenant-name\|/);
  await page.keyboard.type(name);
  await page.keyboard.press("Tab");
  await page.keyboard.type(email);
  await page.keyboard.press("Tab");
  await page.keyboard.type("山田太郎");
  await page.keyboard.press("Enter");
  const first = await readLink(page, "邀请链接");
  await expect(page.getByRole("dialog").getByRole("button", { name: "复制链接", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog").getByRole("button", { name: "已复制" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(first.link);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("dialog").getByRole("button", { name: "我已经发给对方，关闭" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/platform\/tenants\/[0-9a-f-]{36}$/);
  await expect(toast(page, `已新建供应商「${name}」`)).toBeVisible();

  // 新增员工
  await page.goto("/platform/settings/staff");
  await expect(page.getByRole("heading", { level: 1, name: "平台员工" })).toBeVisible();
  const staffEmail = uniqueEmail("qa-keyboard-staff");
  const staffName = `键盘员工 ${random()}`;
  await tabTo(/\|新增员工\|/);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/platform\/settings\/staff\/new$/);
  await tabTo(/\|staff-email\|/);
  await page.keyboard.type(staffEmail);
  await page.keyboard.press("Tab");
  await page.keyboard.type(staffName);
  await page.keyboard.press("Tab");
  // 单选组：进来落在第一项上，空格选中，方向键往下走到「客服」（第五个）
  await page.keyboard.press("Space");
  for (let step = 0; step < 4; step += 1) await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("radio", { name: /^客服/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: /^客服/ })).toBeFocused();
  await tabTo(/\|新增\|/);
  await page.keyboard.press("Enter");
  const second = await readLink(page, "邀请链接");
  await expect(page.getByRole("dialog")).toContainText(`给 ${staffName}（${staffEmail}）· 平台员工，客服`);
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(second.link);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/platform\/settings\/staff$/);
  await expect(toast(page, `已邀请「${staffName}」`)).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: staffEmail })).toContainText("待激活");
});

// ───────────── 权限：十个平台角色，真实后端 ─────────────

const ROLE_EXPECTATIONS: Readonly<Record<string, { label: string; tenants: "manage" | "read" | "none"; staff: boolean; audit: boolean; integrations: boolean }>> = {
  super_admin: { label: "超级管理员", tenants: "manage", staff: true, audit: true, integrations: true },
  operations: { label: "运营", tenants: "manage", staff: false, audit: false, integrations: false },
  tenant_onboarding: { label: "招商", tenants: "manage", staff: false, audit: false, integrations: false },
  channel_manager: { label: "渠道经理", tenants: "read", staff: false, audit: false, integrations: false },
  customer_service: { label: "客服", tenants: "none", staff: false, audit: false, integrations: false },
  finance: { label: "财务", tenants: "none", staff: false, audit: false, integrations: false },
  risk: { label: "风控", tenants: "none", staff: false, audit: false, integrations: false },
  master_data: { label: "主数据运营", tenants: "none", staff: false, audit: false, integrations: false },
  tech: { label: "技术", tenants: "none", staff: false, audit: false, integrations: true },
  readonly: { label: "只读", tenants: "read", staff: false, audit: false, integrations: false },
};

for (const [role, expected] of Object.entries(ROLE_EXPECTATIONS)) {
  test(`角色「${expected.label}」登录真实后端：菜单、首页卡片、七个地址逐个打开——该看的看得到、不该看的说没有权限；整个过程页面没有发出一个被后端拒绝（403）的请求`, async ({ page, request }) => {
    test.setTimeout(150_000);
    const headers = await platformAdminHeaders(request);
    const tenant = await createTenant(request);
    await request.post(`/platform/v1/tenants/${tenant.tenantId}/suspend`, { headers, data: { reason: "角色测试" } });
    const staff = await inviteStaff(request, headers, role);
    const refused: string[] = [];
    const asked: string[] = [];
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (!url.pathname.startsWith("/platform/v1/")) return;
      asked.push(`${response.request().method()} ${url.pathname}`);
      if (response.status() === 403) refused.push(`${response.request().method()} ${url.pathname}`);
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAs(page, "platform", staff.email, staff.password);
    const menu = page.getByRole("navigation", { name: "主菜单" });
    await expect(menu.getByRole("link", { name: "首页" })).toBeVisible();
    await expect(menu.getByRole("link", { name: "供应商" })).toHaveCount(expected.tenants === "none" ? 0 : 1);
    await expect(page.locator(".entry-card").getByRole("link", { name: "供应商" })).toHaveCount(expected.tenants === "none" ? 0 : 1);
    const anySettings = expected.staff || expected.audit || expected.integrations;
    await expect(menu.getByRole("button", { name: "系统设置" })).toHaveCount(anySettings ? 1 : 0);
    if (anySettings) {
      await menu.getByRole("button", { name: "系统设置" }).click();
      await expect(menu.getByRole("link", { name: "平台员工" })).toHaveCount(expected.staff ? 1 : 0);
      await expect(menu.getByRole("link", { name: "审计日志" })).toHaveCount(expected.audit ? 1 : 0);
      await expect(menu.getByRole("link", { name: "系统状态" })).toHaveCount(expected.integrations ? 1 : 0);
    }

    const visit = async (path: string, allowed: boolean, heading: string | RegExp, data: RegExp): Promise<void> => {
      const before = asked.length;
      await page.goto(path);
      if (allowed) await expect(page.getByRole("heading", { level: 1, name: heading }), path).toBeVisible();
      else await expect(page.getByText("你没有权限查看这里"), path).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expect(page.getByText("你没有权限查看这里"), path).toHaveCount(allowed ? 0 : 1);
      if (!allowed) expect(asked.slice(before).filter((entry) => data.test(entry)), `${path}：没有权限时不发这些请求`).toEqual([]);
    };
    await visit("/platform/tenants", expected.tenants !== "none", "供应商", /\/(tenants|audit-logs)/);
    if (expected.tenants !== "none") {
      await expect(page.getByRole("link", { name: "新建供应商" })).toHaveCount(expected.tenants === "manage" ? 1 : 0);
      await expect(page.getByText("你可以查看供应商，但不能修改。")).toHaveCount(expected.tenants === "read" ? 1 : 0);
    }
    await visit("/platform/tenants/new", expected.tenants === "manage", "新建供应商", /\/(tenants|audit-logs)/);
    await visit(`/platform/tenants/${tenant.tenantId}`, expected.tenants !== "none", tenant.tenantName, /\/(tenants|audit-logs)/);
    if (expected.tenants !== "none") {
      await expect(page.getByText("这家供应商已暂停。")).toBeVisible();
      await expect(page.getByRole("button", { name: "恢复", exact: true })).toHaveCount(expected.tenants === "manage" ? 1 : 0);
      await expect(page.getByRole("button", { name: "邀请管理员" })).toHaveCount(expected.tenants === "manage" ? 1 : 0);
      await expect(page.getByRole("button", { name: "发密码重置链接" })).toHaveCount(expected.tenants === "manage" ? 1 : 0);
      await expect(page.getByRole("link", { name: "看这家供应商的操作记录" })).toHaveCount(expected.audit ? 1 : 0);
      if (expected.audit) await expect(page.getByText(/原因：角色测试（/)).toBeVisible();
      else await expect(page.getByText("暂停原因记在审计日志里，需要的话请问超级管理员。")).toBeVisible();
    }
    await visit("/platform/settings/staff", expected.staff, "平台员工", /\/(staff|audit-logs)/);
    await visit("/platform/settings/staff/new", expected.staff, "新增员工", /\/(staff|audit-logs)/);
    await visit("/platform/settings/audit-logs", expected.audit, "审计日志", /\/(audit-logs|tenants|staff)/);
    await visit("/platform/settings/integrations", expected.integrations, "系统状态", /\/integrations/);
    expect(refused, "页面不该发出后端会拒绝的请求").toEqual([]);
  });
}

test("供应商的账号打开运营后台的这些地址：被送去运营后台的登录页，供应商后台的登录不受影响；把供应商的令牌硬塞成运营后台的登录也进不去", async ({ page, request }) => {
  test.setTimeout(120_000);
  const tenant = await createActiveTenant(request);
  const platformCalls: string[] = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/platform/v1/")) platformCalls.push(`${response.status()} ${url.pathname}`);
  });
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  for (const path of ["/platform/tenants", "/platform/tenants/new", `/platform/tenants/${tenant.tenantId}`, "/platform/settings/staff", "/platform/settings/staff/new", "/platform/settings/audit-logs", "/platform/settings/integrations"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/platform\/login$/);
    await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
  }
  expect(platformCalls, "没有登录运营后台时不请求任何运营接口").toEqual([]);
  // 用供应商的账号密码登录运营后台：被拒
  await fillLogin(page, tenant.adminEmail, tenant.password);
  await expect(page.getByRole("alert").filter({ hasText: /邮箱或密码不正确|不正确/ })).toBeVisible();
  // 把供应商的令牌硬塞成运营后台的登录
  await page.evaluate(() => sessionStorage.setItem("nozomi.session.platform", sessionStorage.getItem("nozomi.session.tenant") ?? ""));
  platformCalls.length = 0;
  for (const path of ["/platform/tenants", "/platform/settings/staff", "/platform/settings/audit-logs", "/platform/settings/integrations"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/platform\/login$/);
    await page.evaluate(() => sessionStorage.setItem("nozomi.session.platform", sessionStorage.getItem("nozomi.session.tenant") ?? ""));
  }
  expect(platformCalls.filter((entry) => entry.startsWith("2")), "供应商的令牌在运营接口上拿不到任何数据").toEqual([]);
  await page.goto("/");
  await expect(page.locator(".tenant-name")).toHaveText(tenant.tenantName);
});

test("用临时密码登录、必须先改密码的超级管理员：这几个地址都被带回修改密码页，页面不去取供应商、员工、审计日志、系统状态；改完密码才进得去", async ({ page }) => {
  test.setTimeout(120_000);
  const temp = await createTemporaryPasswordAdmin();
  const answered: string[] = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (/^\/platform\/v1\/(tenants|staff|audit-logs|integrations)/.test(url.pathname)) answered.push(`${response.status()} ${url.pathname}`);
  });
  await page.goto("/platform/login");
  await fillLogin(page, temp.email, temp.temporaryPassword);
  await expect(page).toHaveURL(/\/platform\/account\/password$/);
  for (const path of ["/platform/tenants", "/platform/tenants/new", "/platform/settings/staff", "/platform/settings/staff/new", "/platform/settings/audit-logs", "/platform/settings/integrations"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/platform\/account\/password$/);
    await expect(page.getByRole("heading", { level: 1, name: "设置新密码" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "主菜单" })).toHaveCount(0);
  }
  expect(answered, "必须先改密码时页面不取这些数据").toEqual([]);
  const password = newPassword();
  await page.getByLabel("临时密码").fill(temp.temporaryPassword);
  await page.getByLabel("新密码", { exact: true }).fill(password);
  await page.getByLabel("再输入一次新密码").fill(password);
  await page.getByRole("button", { name: "保存新密码" }).click();
  await expect(page).toHaveURL(/\/platform$/);
  // 员工列表分页：按邮箱搜，免得并行的用例建的员工把它挤到后面几页
  await page.goto(`/platform/settings/staff?q=${encodeURIComponent(temp.email)}`);
  await expect(page.getByRole("heading", { level: 1, name: "平台员工" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: temp.email })).toContainText("你");
});

// ───────────── XSS：经真实后端存取 ─────────────

test("供应商名、管理员姓名、员工姓名、暂停原因里写 HTML 和脚本：经真实后端存进去再取出来，列表、详情、各对话框、Toast、链接对话框、审计日志、供应商自己的后台里都只当文字，脚本不执行", async ({ page, browser, request, context }) => {
  test.setTimeout(240_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const headers = await platformAdminHeaders(request);
  const tag = random();
  const tenantName = `<img src=x onerror="window.__xss=1"><b>${tag}</b>'"&amp;`;
  const adminName = `<script>window.__xss=2</script><i>管理员${tag}</i>`;
  const adminEmail = uniqueEmail("qa-xss");
  const created = await request.post("/platform/v1/tenants", { headers, data: { name: tenantName, admin: { email: adminEmail, name: adminName } } });
  expect(created.status(), await created.text()).toBe(201);
  const body = (await created.json()) as { tenant: { id: string }; invite: { token: string } };
  const staffName = `<svg onload="window.__xss=3"></svg><u>员工${tag}</u>`;
  const staff = await inviteStaff(request, headers, "readonly", { name: staffName });
  const reason = `<img src=x onerror="window.__xss=4"><a href="javascript:window.__xss=5">点我</a> ${tag}`;
  const alerts: string[] = [];
  page.on("dialog", (prompt) => {
    alerts.push(prompt.message());
    void prompt.dismiss();
  });
  const clean = async (where: string, target: Page = page): Promise<void> => {
    const state = await target.evaluate(() => ({ flag: (window as unknown as { __xss?: number }).__xss ?? null, injected: document.querySelectorAll('main img[src="x"], dialog img[src="x"], .toast img, main svg[onload], main script, dialog script, a[href^="javascript:"]').length }));
    expect(state, `${where}：HTML 只当文字`).toEqual({ flag: null, injected: 0 });
  };
  await adminPage(page);

  // 列表
  await page.goto(`/platform/tenants?q=${encodeURIComponent(tag)}`);
  const row = page.getByRole("row").filter({ hasText: tag });
  await expect(row.locator("a.tenant-name")).toHaveText(tenantName);
  await clean("供应商列表");
  await row.getByRole("button", { name: /的更多操作$/ }).click();
  await page.getByRole("menuitem", { name: "暂停" }).click();
  const suspend = page.getByRole("dialog");
  await expect(suspend.getByRole("heading", { level: 2 })).toHaveText(`暂停「${tenantName}」？`);
  await suspend.getByLabel(/暂停原因/).fill(reason);
  await clean("暂停对话框");
  await suspend.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(toast(page, `已暂停「${tenantName}」`)).toBeVisible();
  await clean("暂停后的 Toast");
  await expect(row).toContainText("已暂停");

  // 详情：标题、标签页标题、提示条里的原因、恢复的确认
  await row.getByRole("link", { name: /^查看 / }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(tenantName);
  await expect(page).toHaveTitle(`${tenantName} · 供应商 · NOZOMI 运营后台`);
  await expect(page.locator(".tenant-reason")).toContainText(`原因：${reason}（`);
  await clean("供应商详情（已暂停）");
  await page.getByRole("button", { name: "恢复", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(`当初暂停的原因：${reason}。请确认问题已经解决。`);
  await clean("恢复的确认");
  await page.getByRole("dialog").getByRole("button", { name: "取消" }).click();

  // 邀请管理员：姓名带 HTML → 链接对话框、复制的说明、Toast
  await page.getByRole("button", { name: "邀请管理员" }).click();
  const invite = page.getByRole("dialog", { name: "邀请管理员" });
  await expect(invite).toContainText(`给「${tenantName}」开一个管理员账号。这家供应商已暂停，仍然可以邀请。`);
  const secondEmail = uniqueEmail("qa-xss2");
  await invite.getByLabel(/^邮箱/).fill(secondEmail);
  await invite.getByLabel(/^姓名/).fill(adminName);
  await invite.getByRole("button", { name: "邀请", exact: true }).click();
  const issued = await readLink(page, "邀请链接");
  await expect(page.locator(".link-dialog__whom")).toHaveText(`给 ${adminName}（${secondEmail}）· ${tenantName} 的管理员`);
  await clean("一次性链接对话框");
  await page.getByRole("dialog").getByRole("button", { name: "复制链接和说明" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "已复制" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${adminName}，你好：\n这是 NOZOMI 供应商后台的账号开通链接，请在 ${/有效期到 (\d{4}-\d{2}-\d{2} \d{2}:\d{2})/.exec((await page.getByRole("dialog").textContent()) ?? "")?.[1] ?? ""} 前打开，设置你自己的密码：\n${issued.link}\n链接只能用一次，请不要转发给别人。登录邮箱：${secondEmail}`);
  await page.getByRole("dialog").getByRole("button", { name: "我已经发给对方，关闭" }).click();
  await expect(toast(page, `已邀请「${adminName}」`)).toBeVisible();
  await clean("邀请后的 Toast");

  // 审计日志：表格和详情
  await page.getByRole("link", { name: "看这家供应商的操作记录" }).click();
  const table = page.getByRole("region", { name: "审计日志" });
  await expect(table.locator(".tag", { hasText: /^暂停$/ })).toBeVisible();
  await clean("审计日志表格");
  await table.getByRole("row").filter({ has: page.locator(".tag", { hasText: /^暂停$/ }) }).getByRole("button", { name: /条记录的详情$/ }).click();
  await expect(page.getByRole("dialog").getByRole("row", { name: /原因/ })).toContainText(reason);
  await clean("审计日志详情（暂停）");
  await page.keyboard.press("Escape");
  await table.getByRole("row").filter({ has: page.locator(".tag", { hasText: /^新建$/ }) }).first().getByRole("button", { name: /条记录的详情$/ }).click();
  await expect(page.getByRole("dialog")).toContainText(tenantName);
  await clean("审计日志详情（新建）");
  await page.keyboard.press("Escape");

  // 平台员工：列表、停用的确认
  await page.goto(`/platform/settings/staff?q=${encodeURIComponent(staff.email)}`);
  const staffRow = page.getByRole("row").filter({ hasText: staff.email });
  await expect(staffRow.locator(".staff-name")).toHaveText(staffName);
  await staffRow.getByRole("button", { name: /的更多操作$/ }).click();
  await page.getByRole("menuitem", { name: "停用" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { level: 2 })).toHaveText(`停用「${staffName}」？`);
  await clean("停用员工的确认");
  await page.getByRole("dialog").getByRole("button", { name: "取消" }).click();
  await staffRow.getByRole("button", { name: /的更多操作$/ }).click();
  await page.getByRole("menuitem", { name: "看这个账号的变更记录" }).click();
  await expect(page.getByText(`对象：平台员工 ${staffName}`)).toBeVisible();
  await clean("审计日志的筛选标签");

  // 供应商自己的后台：名称和姓名
  const theirs = await browser.newContext();
  const tenantPage = await theirs.newPage();
  const password = newPassword();
  expect((await request.post("/tenant/v1/auth/accept-invite", { data: { token: body.invite.token, password } })).ok()).toBe(true);
  await loginAs(tenantPage, "tenant", adminEmail, password);
  await expect(tenantPage.locator(".tenant-name")).toHaveText(tenantName);
  await expect(tenantPage.locator(".account-button__name")).toHaveText(adminName);
  await clean("供应商后台首页", tenantPage);
  await theirs.close();
  expect(alerts, "没有弹出任何脚本对话框").toEqual([]);
});

// ───────────── 被拒的落点 ─────────────

test("邮箱通过了页面的格式检查、却被后端判为不合规（如「山田@example.com」「a@b.c」）：出错应当落在邮箱字段下面（规范 4.2：400 按字段显示），不能只有页面顶上一句「提交的内容不符合要求」", async ({ page }) => {
  await adminPage(page);
  await fillNewTenant(page, `邮箱被拒 ${random()}`, "山田@example.com", "山田太郎");
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await expect(page.locator("#tenant-email-error")).toContainText("系统不接受这个邮箱地址");
  await expect(page.getByText("提交的内容不符合要求")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel(/^邮箱/), "邮箱字段应当被标成有错").toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#tenant-email-error")).not.toBeEmpty();
});

// ───────────── 供应商：两个人同时操作 ─────────────

test("两个人同时处理同一家供应商：别人已经暂停了，我这边还显示正常并再点暂停——接口照常成功，页面变成已暂停，显示的是真正记下的那个原因（先暂停的人填的），不是我刚填的", async ({ page, request }) => {
  const headers = await platformAdminHeaders(request);
  const tenant = await createTenant(request);
  const admin = await adminPage(page);
  await page.goto(`/platform/tenants/${tenant.tenantId}`);
  await expect(page.getByRole("button", { name: "暂停", exact: true })).toBeVisible();
  expect((await request.post(`/platform/v1/tenants/${tenant.tenantId}/suspend`, { headers, data: { reason: "同事先填的原因" } })).ok()).toBe(true);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await page.getByRole("dialog").getByLabel(/暂停原因/).fill("我后填的原因");
  await page.getByRole("dialog").getByRole("button", { name: "暂停", exact: true }).click();
  await expect(toast(page, `已暂停「${tenant.tenantName}」`)).toBeVisible();
  await expect(page.getByText("这家供应商已暂停。")).toBeVisible();
  await expect(page.locator(".tenant-reason")).toContainText(`原因：同事先填的原因（${admin.email}，`);
  await expect(page.locator(".tenant-reason")).not.toContainText("我后填的原因");
  // 别人已经恢复了，我这边再点恢复：同样照常成功
  expect((await request.post(`/platform/v1/tenants/${tenant.tenantId}/resume`, { headers })).ok()).toBe(true);
  await page.getByRole("button", { name: "恢复", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "恢复", exact: true }).click();
  await expect(toast(page, `已恢复「${tenant.tenantName}」`)).toBeVisible();
  await expect(page.getByRole("button", { name: "暂停", exact: true })).toBeVisible();
  const logs = (await (await request.get(`/platform/v1/audit-logs?resource=tenant&resource_id=${tenant.tenantId}&limit=50`, { headers })).json()) as { items: { action: string }[] };
  expect(logs.items.map((entry) => entry.action).sort(), "重复的暂停、恢复不多记").toEqual(["create", "resume", "suspend"]);
});

// ───────────── 审计日志：真实后端 ─────────────

test("审计日志连真实后端：游标翻页不重不漏、从新到旧；「今天」筛得到刚发生的记录（当天整天都算）；不认识的对象类型和乱写的对象编号只是筛不到，不报错；系统状态的每次查看都记了一条", async ({ page, request }) => {
  test.setTimeout(150_000);
  const headers = await platformAdminHeaders(request);
  const tenant = await createTenant(request);
  for (let round = 0; round < 12; round += 1) {
    expect((await request.post(`/platform/v1/tenants/${tenant.tenantId}/suspend`, { headers, data: { reason: `第 ${round + 1} 次` } })).ok()).toBe(true);
    expect((await request.post(`/platform/v1/tenants/${tenant.tenantId}/resume`, { headers })).ok()).toBe(true);
  }
  // 这家供应商一共 26 条：新建、邀请、12 次暂停、12 次恢复
  await adminPage(page);
  await page.goto(`/platform/settings/audit-logs?tenant=${tenant.tenantId}&size=20`);
  const table = page.getByRole("region", { name: "审计日志" });
  const ids = async (): Promise<number[]> => (await table.getByRole("button", { name: /条记录的详情$/ }).evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label") ?? ""))).map((label) => Number(/第 (\d+) 条/.exec(label)?.[1]));
  await expect(table.getByRole("button", { name: /条记录的详情$/ })).toHaveCount(20);
  await expect(page.getByText("本页 20 条")).toBeVisible();
  const first = await ids();
  expect([...first].sort((x, y) => y - x), "从新到旧").toEqual(first);
  await expect(page.getByRole("button", { name: "上一页" })).toBeDisabled();
  await page.getByRole("button", { name: "下一页" }).click();
  await expect(page.getByText("本页 6 条")).toBeVisible();
  const second = await ids();
  expect(second.length).toBe(6);
  expect(second.filter((id) => first.includes(id)), "两页不重复").toEqual([]);
  expect(Math.max(...second), "第二页都比第一页旧").toBeLessThan(Math.min(...first));
  await expect(page.getByRole("button", { name: "下一页" })).toBeDisabled();
  await expect(page, "游标不进网址").toHaveURL(new RegExp(`audit-logs\\?tenant=${tenant.tenantId}&size=20$`));
  await page.getByRole("button", { name: "上一页" }).click();
  await expect(page.getByText("本页 20 条")).toBeVisible();
  expect(await ids()).toEqual(first);

  // 「今天」：刚发生的都在（到今天 = 明天零点之前）；只看暂停有 12 条
  await page.getByRole("button", { name: "今天", exact: true }).click();
  await expect(page.getByText("本页 20 条")).toBeVisible();
  await page.locator("#audit-action").selectOption("suspend");
  await expect(page.getByText("本页 12 条")).toBeVisible();
  const today = await page.evaluate(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  expect(new URL(page.url()).searchParams.get("from")).toBe(today);
  expect(new URL(page.url()).searchParams.get("to")).toBe(today);
  // 表头写明时区
  await expect(table.getByRole("columnheader", { name: /^时间（你的本地时区，UTC[+-]\d{1,2}(:\d{2})?）$/ })).toBeVisible();

  // 不认识的对象类型、乱写的对象编号：筛不到，不报错
  for (const search of [`resource=price_plan`, `resource=tenant&rid=${encodeURIComponent("不是编号'; DROP TABLE audit_logs;--")}`, `action=bulk_adjust`]) {
    await page.goto(`/platform/settings/audit-logs?${search}`);
    await expect(page.getByText("没有符合条件的记录"), search).toBeVisible();
    await expect(page.getByText("加载失败")).toHaveCount(0);
  }
  // 「从」晚于「到」不再只说「没有符合条件的记录」，而是说日期填反了（M1-13）
  await page.goto("/platform/settings/audit-logs?from=2026-10-09&to=2026-10-01");
  await expect(page.getByText("日期填反了")).toBeVisible();
  await expect(page.getByText("加载失败")).toHaveCount(0);
  await page.goto("/platform/settings/audit-logs?resource=price_plan");
  await expect(page.locator("#audit-resource")).toHaveValue("price_plan");

  // 系统状态：技术角色看一次记一条，停留、切走再回来都不多记；「重新检查」再记一条
  const tech = await inviteStaff(request, headers, "tech");
  const views = async (): Promise<number> => ((await (await request.get(`/platform/v1/audit-logs?actor_id=${tech.id}&resource=integration&action=view&limit=200`, { headers })).json()) as { items: unknown[] }).items.length;
  const theirs = await page.context().browser()?.newContext();
  if (!theirs) throw new Error("没有浏览器");
  const techPage = await theirs.newPage();
  await loginAs(techPage, "platform", tech.email, tech.password);
  await techPage.goto("/platform/settings/integrations");
  await expect(techPage.getByRole("region", { name: "系统状态" })).toContainText("数据库");
  expect(await views()).toBe(1);
  const other = await theirs.newPage();
  await other.goto("about:blank");
  await other.bringToFront();
  await techPage.bringToFront();
  await techPage.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
  });
  await techPage.waitForTimeout(4000);
  expect(await views(), "停留、切走再回来都不重新请求").toBe(1);
  await techPage.getByRole("button", { name: "重新检查" }).click();
  await expect.poll(views).toBe(2);
  // 页面上没有任何密钥原文：数据库密码、管理员密码、令牌
  const text = (await techPage.locator("body").innerText()) + (await techPage.content());
  const database = new URL(process.env["E2E_DATABASE_URL"] ?? "postgres://x:unset@x/x");
  expect(database.password.length).toBeGreaterThan(0);
  expect(text.includes(`:${database.password}@`), "页面上没有带着密码的数据库连接串").toBe(false);
  // 本地开发库的密码和账号名是同一个词（.env.example 的公开默认值），账号名本来就显示在页面上：只有两者不同时才能直接搜密码
  if (![database.username, database.hostname, database.pathname.slice(1)].some((shown) => shown.includes(database.password))) expect(text.includes(database.password), "页面上没有数据库密码").toBe(false);
  expect(text.includes(tech.password), "页面上没有登录密码").toBe(false);
  await expect(techPage.getByRole("row").filter({ hasText: "登录签名密钥" })).toContainText(/^登录签名密钥已配置\d+ 个字符$/);
  await expect(techPage.getByText(/有 2 项还没有配置/)).toBeVisible();
  await expect(techPage.locator(".alert").filter({ hasText: "还没有配置" })).toContainText("：Stripe 支付、谷歌地图。用到它们的功能现在不能用。配置要由技术在服务器上做；密钥只能由负责人本人填进各平台的设置页面，不要发在聊天里。");
  await theirs.close();
  // 管理员在审计日志里看得到这两次查看
  await page.goto(`/platform/settings/audit-logs?actor=${tech.id}&resource=integration`);
  await expect(page.getByText("本页 2 条")).toBeVisible();
  await expect(table.locator(".tag", { hasText: /^查看$/ })).toHaveCount(2);
  await expect(table.getByRole("row").nth(1)).toContainText("系统状态");
});

// ───────────── 手机宽度、平板宽度、亮暗 ─────────────

test("手机宽度（< 768px）的审计日志：筛选条件应当收进「筛选」面板（规范 platform-settings.md 3.2、第 5 节），不能把六个筛选控件直接摊在表格上方", async ({ page }) => {
  await adminPage(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/platform/settings/audit-logs");
  await expect(page.getByRole("region", { name: "审计日志" }).locator(".tag").first()).toBeVisible();
  const firstRowTop = await page.locator(".card-table").evaluate((node) => Math.round(node.getBoundingClientRect().top));
  await expect(page.getByRole("button", { name: /^筛选/ }), `没有「筛选」按钮；表格从 ${firstRowTop}px 才开始（屏幕高 740px）`).toBeVisible();
  await expect(page.locator("#audit-from")).toBeHidden();
  // 面板里选条件，点「查看结果」才生效；面板本身不横向滚动、通过 axe 检查
  await page.getByRole("button", { name: /^筛选/ }).click();
  const panel = page.getByRole("dialog", { name: "筛选" });
  await panel.locator("#audit-panel-action").selectOption("login");
  await panel.getByRole("button", { name: "今天" }).click();
  await expectNoHorizontalOverflow(page, "筛选面板（360px）");
  await expectAccessible(page, "筛选面板（360px）");
  await panel.getByRole("button", { name: "查看结果" }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button", { name: "筛选 · 3" })).toBeVisible();
  await expect(page).toHaveURL(/action=login/);
  const table = page.getByRole("region", { name: "审计日志" });
  await expect(table.locator(".tag").first()).toHaveText("登录");
  expect((await table.locator(".tag").allTextContents()).every((text) => text === "登录"), "只剩登录的记录").toBe(true);
  await page.getByRole("button", { name: "清空筛选" }).click();
  await expect(page.getByRole("button", { name: "筛选", exact: true })).toBeVisible();
});

for (const scheme of ["light", "dark"] as const) {
  test(`${scheme === "light" ? "亮色" : "暗色"}，320 和 768 宽：「更多」菜单打开、筛选无结果、员工的确认对话框和被拒、新增员工选了超级管理员并出错、带着两个筛选标签的审计日志和详情、密码重置链接和没复制就关的确认——都不横向滚动，通过 axe 检查`, async ({ page, request }) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ colorScheme: scheme });
    const headers = await platformAdminHeaders(request);
    const tenant = await createActiveTenant(request);
    await request.post(`/platform/v1/tenants/${tenant.tenantId}/suspend`, { headers, data: { reason: "很长的原因".repeat(60) } });
    const staff = await inviteStaff(request, headers, "customer_service", { name: "名字很长很长的同事".repeat(5) });
    const admin = await adminPage(page);
    const check = async (what: string): Promise<void> => {
      for (const width of [320, 768]) {
        await page.setViewportSize({ width, height: 800 });
        await expectNoHorizontalOverflow(page, `${what}（${width}px）`);
        await expectAccessible(page, `${what}（${width}px，${scheme}）`);
      }
    };
    await page.goto(`/platform/tenants?q=${encodeURIComponent(tenant.tenantName)}`);
    await page.setViewportSize({ width: 320, height: 800 });
    const card = page.getByRole("row").filter({ hasText: tenant.tenantName });
    await expect(card).toContainText("已暂停");
    await card.getByRole("button", { name: /的更多操作$/ }).click();
    await expect(page.getByRole("menuitem")).toHaveText(["邀请管理员", "恢复"]);
    await check("供应商列表（更多菜单打开）");
    await page.keyboard.press("Escape");
    await page.goto("/platform/tenants?q=肯定没有这一家&status=suspended");
    await expect(page.getByText("没有符合条件的供应商")).toBeVisible();
    await check("供应商列表（筛选无结果）");
    await page.goto(`/platform/tenants/${tenant.tenantId}`);
    await expect(page.locator(".tenant-reason")).toContainText("很长的原因很长的原因");
    await check("供应商详情（已暂停，原因很长）");
    await page.getByRole("button", { name: "发密码重置链接" }).click();
    await page.getByRole("dialog").getByLabel(/管理员的邮箱/).fill(uniqueEmail("nobody"));
    await page.getByRole("dialog").getByRole("button", { name: "发出", exact: true }).click();
    await expect(page.getByRole("dialog").getByText("这家供应商没有用这个邮箱的管理员。", { exact: false })).toBeVisible();
    await check("发密码重置（被拒）");
    await page.getByRole("dialog").getByLabel(/管理员的邮箱/).fill(tenant.adminEmail);
    await page.getByRole("dialog").getByRole("button", { name: "发出", exact: true }).click();
    await readLink(page, "密码重置链接");
    await check("密码重置链接对话框");
    await page.getByRole("dialog").getByRole("button", { name: "我已经发给对方，关闭" }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "回去复制" })).toBeFocused();
    await check("密码重置链接对话框（没复制就关的确认）");
    await page.getByRole("dialog").getByRole("button", { name: "仍然关闭" }).click();

    await page.goto(`/platform/settings/staff?q=${encodeURIComponent(staff.email)}`);
    const row = page.getByRole("row").filter({ hasText: staff.email });
    await row.getByRole("button", { name: /的更多操作$/ }).click();
    await expect(page.getByRole("menuitem").first()).toBeVisible();
    await check("平台员工（更多菜单打开）");
    await page.getByRole("menuitem", { name: "停用" }).click();
    await check("停用员工的确认");
    await page.getByRole("dialog").getByRole("button", { name: "取消" }).click();
    await page.goto("/platform/settings/staff/new");
    await page.getByRole("radio", { name: /^超级管理员/ }).check();
    await page.getByLabel(/^邮箱/).fill(admin.email);
    await page.getByLabel(/^姓名/).fill("重复的邮箱");
    await page.getByRole("button", { name: "新增", exact: true }).click();
    await expect(page.getByText("这个邮箱已经有一个设过密码的平台员工账号了。", { exact: false })).toBeVisible();
    await expect(page.getByText("超级管理员可以管理所有平台员工、看到全部审计日志。")).toBeVisible();
    await check("新增员工（选了超级管理员、邮箱被占用）");

    await page.goto(`/platform/settings/audit-logs?tenant=${tenant.tenantId}&resource=tenant&rid=${tenant.tenantId}&actor=${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)}`);
    await expect(page.getByText("没有符合条件的记录")).toBeVisible();
    await expect(page.getByRole("button", { name: /^移除条件：操作人：00000000…$/ })).toBeVisible();
    await check("审计日志（带着操作人和对象两个标签，无结果）");
    await page.getByRole("button", { name: /^移除条件：操作人/ }).click();
    await page.getByRole("button", { name: /条记录的详情$/ }).first().click();
    await expect(page.getByRole("dialog").getByRole("row", { name: /原因/ })).toContainText("很长的原因");
    await check("审计日志详情（很长的原因）");
    await page.keyboard.press("Escape");
    await page.goto("/platform/settings/integrations");
    await expect(page.getByText(/有 2 项还没有配置/)).toBeVisible();
    await check("系统状态（有未配置的）");
  });
}
