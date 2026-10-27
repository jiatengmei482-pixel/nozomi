/**
 * 安全相关的端到端检查（真实浏览器 + 真实后端）：
 * 令牌去了哪里、退出后还剩什么、回跳地址能不能跳到站外、两个后台会不会串、后端返回的文字会不会被当成 HTML、
 * 浏览器存储被改坏时页面是否还正常；内容安全策略（只有官网页面放行 Stripe，ADR 0046）。
 */
import { type Page, type Request, expect, test } from "@playwright/test";
import { adminCredentials, createActiveTenant, createTenant, detail, expectSignedInAs, fillLogin, loginAs, newPassword, platformAdminHeaders, uniqueEmail } from "./support.ts";

const SESSION_KEYS = { tenant: "nozomi.session.tenant", platform: "nozomi.session.platform" } as const;

function storedToken(page: Page, portal: keyof typeof SESSION_KEYS): Promise<string> {
  return page.evaluate((key) => (JSON.parse(sessionStorage.getItem(key) ?? "{}") as { accessToken?: string }).accessToken ?? "", SESSION_KEYS[portal]);
}

/** 记下这个页面发出的每一个请求（含静态文件），供事后检查。 */
function recordRequests(page: Page): Request[] {
  const requests: Request[] = [];
  page.on("request", (request) => requests.push(request));
  return requests;
}

/** 任何去 evil.example 的请求都拦下并记录；正常情况下一个都不该有。 */
async function trapOffSite(page: Page): Promise<string[]> {
  const seen: string[] = [];
  await page.route(
    (url) => url.hostname.endsWith("evil.example"),
    (route) => {
      seen.push(route.request().url());
      return route.fulfill({ status: 200, contentType: "text/html", body: "<title>evil</title>off-site" });
    },
  );
  return seen;
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: /账号菜单/ }).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await expect(page.getByRole("status").filter({ hasText: "已退出登录。" })).toBeVisible();
}

test("邀请令牌、访问令牌、密码：不进任何请求的网址和 Referer，不进 localStorage 和 Cookie；全程不请求站外", async ({ page, request, context, baseURL }) => {
  const origin = new URL(baseURL ?? "").origin;
  const tenant = await createTenant(request);
  const password = newPassword();
  const requests = recordRequests(page);

  await page.goto(`/accept-invite#token=${tenant.inviteToken}`);
  await page.getByLabel("新密码").fill(password);
  await page.getByLabel("再输入一次").fill(password);
  await page.getByRole("button", { name: "设置密码并继续" }).click();
  await expect(page).toHaveURL(`${origin}/login`);
  expect(await page.evaluate(() => location.href), "提交成功后地址栏里不再有令牌").not.toContain(tenant.inviteToken);

  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(detail(page, "供应商名称")).toHaveText(tenant.tenantName);
  const accessToken = await storedToken(page, "tenant");
  expect(accessToken.length).toBeGreaterThan(20);

  await page.goto("/account/password");
  await expect(page.getByRole("heading", { level: 1, name: "修改密码" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "修改密码" })).toBeVisible();

  const storage = await page.evaluate(() => ({
    local: Object.entries(localStorage).map(([key, value]) => `${key}=${String(value)}`),
    session: Object.keys(sessionStorage),
    cookie: document.cookie,
    referrer: document.referrer,
    href: location.href,
  }));
  expect(storage.local.join("\n")).not.toContain(accessToken);
  expect(storage.local.filter((entry) => !entry.startsWith("nozomi.theme=")), "localStorage 里只允许有主题选择").toEqual([]);
  expect(storage.session).toEqual([SESSION_KEYS.tenant]);
  expect(storage.cookie).toBe("");
  expect(storage.referrer).toBe("");
  expect(await context.cookies(), "后端和前端都不种 Cookie").toEqual([]);

  await signOut(page);
  expect(await context.cookies(), "退出以后也没有任何 Cookie").toEqual([]);

  expect(requests.length).toBeGreaterThan(8);
  const secrets = [tenant.inviteToken, accessToken, password, encodeURIComponent(password)];
  let withBearer = 0;
  for (const sent of requests) {
    const url = sent.url();
    expect(new URL(url).origin, `请求了站外地址 ${url}`).toBe(origin);
    for (const secret of secrets) expect(url.includes(secret), `令牌或密码出现在请求网址里：${sent.method()} ${new URL(url).pathname}`).toBe(false);
    // 不用 allHeaders()：它等的是网络层补报的原始请求头（CDP 的 requestWillBeSentExtraInfo），刷新、跳转时还在路上的请求偶尔收不到这条事件，
    // Playwright 就一直等到用例超时（CI 上出现过两次）。Referer、Authorization 在浏览器发出请求时就定了，headers() 里就有；
    // Cookie 只在网络层才加上，改为核对浏览器里从头到尾没有 Cookie 可带（上面登录后和退出后 context.cookies() 都为空）。
    const headers = sent.headers();
    const referer = headers["referer"] ?? "";
    expect(referer, `${new URL(url).pathname} 带了 Referer`).toBe("");
    const authorization = headers["authorization"];
    if (authorization !== undefined) {
      withBearer += 1;
      expect(authorization).toBe(`Bearer ${accessToken}`);
      expect(new URL(url).pathname, "访问令牌只发给本后台的接口").toMatch(/^\/tenant\/v1\//);
    }
    const body = sent.postData() ?? "";
    if (body.includes(tenant.inviteToken)) expect(new URL(url).pathname, "邀请令牌只发给核对和接受邀请这两个接口").toMatch(/^\/tenant\/v1\/auth\/(check-invite|accept-invite)$/);
    if (body.includes(password)) expect(new URL(url).pathname).toMatch(/^\/tenant\/v1\/auth\/(accept-invite|login)$/);
  }
  expect(withBearer, "auth/me 和 logout 应该带着令牌").toBeGreaterThanOrEqual(2);
});

test("邀请链接里的令牌：提交成功后不留在浏览历史里，按「后退」回不到带令牌的地址", async ({ page, request }) => {
  const tenant = await createTenant(request);
  const password = newPassword();
  await page.goto("/login");
  await page.goto(`/accept-invite#token=${tenant.inviteToken}`);
  await page.getByLabel("新密码").fill(password);
  await page.getByLabel("再输入一次").fill(password);
  await page.getByRole("button", { name: "设置密码并继续" }).click();
  await expect(page.getByRole("status").filter({ hasText: "密码已设置，请登录。" })).toBeVisible();

  const visited: string[] = [page.url()];
  for (let step = 0; step < 3; step += 1) {
    await page.goBack().catch(() => null);
    visited.push(page.url());
  }
  for (let step = 0; step < 4; step += 1) {
    await page.goForward().catch(() => null);
    visited.push(page.url());
  }
  for (const url of visited) expect(url, "浏览历史里还留着带令牌的地址").not.toContain(tenant.inviteToken);
  expect(visited.some((url) => url.includes("#token="))).toBe(false);
});

test("退出登录后：sessionStorage 清空，令牌在后端作废，「后退」和刷新都看不到登录后的内容", async ({ page, request }) => {
  const tenant = await createActiveTenant(request);
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  await expectSignedInAs(page, { email: tenant.adminEmail });
  const token = await storedToken(page, "tenant");
  await page.getByRole("button", { name: /账号菜单/ }).click();
  await page.getByRole("menuitem", { name: "修改密码" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "修改密码" })).toBeVisible();

  await signOut(page);
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
  expect(await page.evaluate((secret) => JSON.stringify(Object.entries(localStorage)).includes(secret), token)).toBe(false);
  const reused = await request.get("/tenant/v1/auth/me", { headers: { authorization: `Bearer ${token}` } });
  expect(reused.status(), "退出后旧令牌不能再用").toBe(401);

  const loggedInContent = page.getByText(tenant.adminEmail).or(page.getByText(tenant.tenantName)).or(page.getByRole("button", { name: /账号菜单/ }));
  // 历史记录：登录页（登录后被首页替换）→ 修改密码页（退出时被登录页替换）。后退一步是当初的首页。
  await page.goBack();
  await expect(page.getByRole("button", { name: "登录" }), "后退到当初的首页：应回到登录页").toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await expect(loggedInContent).toHaveCount(0);
  await page.goForward().catch(() => null);
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await expect(loggedInContent).toHaveCount(0);
  for (const path of ["/", "/account/password"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
    await expect(loggedInContent).toHaveCount(0);
  }
  await page.reload();
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
});

test("同一个浏览器先后登录两个供应商：后一个人直接进首页，看不到前一个人的资料，也不会被带到前一个人最后看的页面；令牌各是各的", async ({ page, request }) => {
  const first = await createActiveTenant(request);
  const second = await createActiveTenant(request);
  await loginAs(page, "tenant", first.adminEmail, first.password);
  const firstToken = await storedToken(page, "tenant");
  await page.goto("/account/password");
  await expect(page.getByRole("heading", { level: 1, name: "修改密码" })).toBeVisible();
  await signOut(page);

  await fillLogin(page, second.adminEmail, second.password);
  await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expectSignedInAs(page, { email: second.adminEmail });
  await expect(detail(page, "供应商名称")).toHaveText(second.tenantName);
  await expect(page.getByText(first.tenantName)).toHaveCount(0);
  await expect(page.getByText(first.adminEmail)).toHaveCount(0);

  const secondToken = await storedToken(page, "tenant");
  expect(secondToken).not.toBe(firstToken);
  const me = await request.get("/tenant/v1/auth/me", { headers: { authorization: `Bearer ${secondToken}` } });
  const body = (await me.json()) as { tenant: { id: string } };
  expect(body.tenant.id, "租户只由令牌决定").toBe(second.tenantId);
  expect(JSON.stringify(body)).not.toContain(first.tenantId);
  expect(JSON.stringify(body), "租户接口的返回里不出现对外价和加价比例").not.toMatch(/markup|sale_price|selling_price|public_price/i);
  const spoofed = await request.get(`/tenant/v1/auth/me?tenant_id=${first.tenantId}`, { headers: { authorization: `Bearer ${secondToken}`, "x-tenant-id": first.tenantId } });
  expect(((await spoofed.json()) as { tenant: { id: string } }).tenant.id, "请求参数里带别人的 tenant_id 没有用").toBe(second.tenantId);
});

test("两个后台不串：用租户的令牌打不开运营后台，用平台的令牌打不开供应商后台", async ({ page, request }) => {
  const admin = adminCredentials();
  const tenant = await createActiveTenant(request);
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  const tenantSession = await page.evaluate((key) => sessionStorage.getItem(key) ?? "", SESSION_KEYS.tenant);

  await page.goto("/platform");
  await expect(page, "只登录了供应商后台的人打开运营后台，要先登录").toHaveURL(/\/platform\/login$/);
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
  await expect(page.getByText(tenant.adminEmail)).toHaveCount(0);

  await page.evaluate(([key, value]) => sessionStorage.setItem(key ?? "", value ?? ""), [SESSION_KEYS.platform, tenantSession]);
  for (const path of ["/platform", "/platform/account/password", "/platform/login"]) {
    await page.evaluate(([key, value]) => sessionStorage.setItem(key ?? "", value ?? ""), [SESSION_KEYS.platform, tenantSession]);
    await page.goto(path);
    await expect(page.getByRole("button", { name: "登录" }), `${path}：把租户令牌塞进运营后台的位置也进不去`).toBeVisible();
    await expect(page).toHaveURL(/\/platform\/login$/);
    await expect(page.getByText(tenant.adminEmail)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /账号菜单/ })).toHaveCount(0);
    expect(await page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEYS.platform), "后端不认的令牌被清掉").toBeNull();
  }
  expect(await page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEYS.tenant), "供应商后台的登录不受影响").toBe(tenantSession);

  const platformLogin = await request.post("/platform/v1/auth/login", { data: admin });
  const platformBody = (await platformLogin.json()) as { access_token: string; expires_at: string };
  await page.evaluate(([key, value]) => sessionStorage.setItem(key ?? "", value ?? ""), [SESSION_KEYS.tenant, JSON.stringify({ accessToken: platformBody.access_token, expiresAt: platformBody.expires_at })]);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("status").filter({ hasText: "登录已过期，请重新登录。" })).toBeVisible();
  await expect(page.getByText(admin.email)).toHaveCount(0);
});

test("回跳地址不能把人带到站外：各种带站外地址的网址，登录后都还在本站", async ({ page, request, baseURL }) => {
  test.setTimeout(60_000);
  const origin = new URL(baseURL ?? "").origin;
  const tenant = await createActiveTenant(request);
  const offSite = await trapOffSite(page);
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });

  const urls = [
    `${origin}//evil.example/`,
    `${origin}/%2F%2Fevil.example`,
    `${origin}/login?from=//evil.example&redirect=https%3A%2F%2Fevil.example&returnTo=javascript:alert(1)`,
  ];
  for (const url of urls) {
    await page.goto("/login");
    await page.evaluate(() => sessionStorage.clear());
    await page.goto(url);
    await expect(page.getByRole("button", { name: "登录" }), url).toBeVisible();
    expect(new URL(page.url()).origin).toBe(origin);
    await fillLogin(page, tenant.adminEmail, tenant.password);
    await expect(page.getByRole("button", { name: /账号菜单/ }), `${url}：登录后应进入后台`).toBeVisible();
    expect(new URL(page.url()).origin, `${url}：登录后跳到了 ${page.url()}`).toBe(origin);
    expect(new URL(page.url()).pathname.startsWith("/platform"), "不会被带到另一个后台").toBe(false);
  }
  expect(offSite, "不应该向站外发任何请求").toEqual([]);
  expect(dialogs).toEqual([]);
});

test("回跳地址取自浏览器的历史状态：里面被写进站外地址、脚本地址时，登录后进本后台首页", async ({ page, request, baseURL }) => {
  test.setTimeout(60_000);
  const origin = new URL(baseURL ?? "").origin;
  const tenant = await createActiveTenant(request);
  const offSite = await trapOffSite(page);
  for (const from of ["//evil.example", "javascript:alert(document.domain)"]) {
    await page.goto("/login");
    await page.evaluate(() => sessionStorage.clear());
    await page.evaluate((value) => history.replaceState({ usr: { from: value }, key: "tampered", idx: 0 }, "", "/login"), from);
    await page.reload();
    await fillLogin(page, tenant.adminEmail, tenant.password);
    await expect(page.getByRole("heading", { level: 1, name: "首页" }), JSON.stringify(from)).toBeVisible();
    expect(page.url()).toBe(`${origin}/`);
  }
  expect(offSite).toEqual([]);
});

test("【缺陷】回跳地址里夹着制表符（浏览器会把「/<Tab>/evil.example」读成「//evil.example」）：登录后应进首页，不能卡在登录页报「系统暂时无法登录」", async ({ page, request, baseURL }) => {
  const origin = new URL(baseURL ?? "").origin;
  const tenant = await createActiveTenant(request);
  const offSite = await trapOffSite(page);
  await page.goto("/login");
  await page.evaluate(() => history.replaceState({ usr: { from: "/\t/evil.example" }, key: "tampered", idx: 0 }, "", "/login"));
  await page.reload();
  await fillLogin(page, tenant.adminEmail, tenant.password);
  await expect(page.getByRole("button", { name: /账号菜单/ }).or(page.getByRole("alert").filter({ hasText: /./ }))).toBeVisible();
  expect(offSite, "实测浏览器会拒绝这次跳转，不会真的到站外").toEqual([]);
  expect(new URL(page.url()).origin).toBe(origin);
  await expect(page.getByRole("alert"), "登录其实已经成功（令牌已存下），不该再有出错提示").toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();
});

test("姓名、供应商名称里带 HTML 和脚本：经真实后端存取后，页面只当文字显示，不执行", async ({ page, request }) => {
  const headers = await platformAdminHeaders(request);
  const personName = '<img src=x onerror="window.__xss=1"><b>名</b>';
  const tenantName = `"><script>window.__xss=2</script><svg onload="window.__xss=3"> ${uniqueEmail("x").slice(2, 12)}`;
  const adminEmail = uniqueEmail("xss");
  const created = await request.post("/platform/v1/tenants", { headers, data: { name: tenantName, admin: { email: adminEmail, name: personName } } });
  expect(created.status()).toBe(201);
  const { invite } = (await created.json()) as { invite: { token: string } };
  const password = newPassword();
  expect((await request.post("/tenant/v1/auth/accept-invite", { data: { token: invite.token, password } })).status()).toBe(200);

  const dialogs: string[] = [];
  const pageErrors: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await loginAs(page, "tenant", adminEmail, password);
  await expect(detail(page, "姓名")).toHaveText(personName);
  await expect(detail(page, "供应商名称")).toHaveText(tenantName);
  await page.getByRole("button", { name: /账号菜单/ }).click();
  await expect(page.locator(".menu-header__name")).toHaveText(personName);
  await page.getByRole("menuitem", { name: "修改密码" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "修改密码" })).toBeVisible();
  await page.goto("/");
  await expect(detail(page, "姓名")).toHaveText(personName);

  const injected = await page.evaluate(() => ({
    flag: (window as unknown as { __xss?: number }).__xss ?? null,
    tags: document.querySelectorAll("#root img, #root script, #root b, #root svg[onload], #root [onerror]").length,
  }));
  expect(injected).toEqual({ flag: null, tags: 0 });
  expect(dialogs).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("浏览器存储被改坏：登录状态的内容是乱码、缺字段、类型不对、伪造的令牌时都回登录页，页面不报错", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const future = "2999-01-01T00:00:00.000Z";
  const tampered: [string, boolean][] = [
    ["not json at all", false],
    ["", false],
    ["null", false],
    ["[]", false],
    ['"just a string"', false],
    ["{}", false],
    ['{"accessToken":"x"}', false],
    [`{"accessToken":"","expiresAt":"${future}"}`, false],
    [`{"accessToken":{"nested":true},"expiresAt":"${future}"}`, false],
    [`{"accessToken":12345,"expiresAt":"${future}"}`, false],
    ['{"accessToken":"x.y.z","expiresAt":"not a date"}', false],
    ['{"accessToken":"x.y.z","expiresAt":"2000-01-01T00:00:00.000Z"}', true],
    [`{"accessToken":"forged.token.value","expiresAt":"${future}"}`, true],
    [`{"accessToken":"<img src=x onerror=alert(1)>","expiresAt":"${future}"}`, true],
  ];
  await page.goto("/login");
  for (const [value, saysExpired] of tampered) {
    await page.evaluate(([key, stored]) => sessionStorage.setItem(key ?? "", stored ?? ""), [SESSION_KEYS.tenant, value]);
    await page.goto("/account/password");
    await expect(page.getByRole("button", { name: "登录" }), value.slice(0, 60)).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: /账号菜单/ })).toHaveCount(0);
    if (saysExpired) await expect(page.getByRole("status").filter({ hasText: "登录已过期，请重新登录。" }), value.slice(0, 60)).toBeVisible();
  }
  expect(pageErrors).toEqual([]);
});

test("浏览器存储被改坏：主题的值不是 light / dark 时按跟随系统处理，<html> 上不留任何东西，页面照常", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/login");
  const lightBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  for (const value of ['"><script>window.__theme=1</script>', 'dark" onload="window.__theme=1', "DARK", " dark", "dark light", "system", "", "x".repeat(100_000)]) {
    await page.evaluate((stored) => localStorage.setItem("nozomi.theme", stored), value);
    await page.reload();
    await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
    const state = await page.evaluate(() => ({
      attributes: document.documentElement.getAttributeNames().sort(),
      background: getComputedStyle(document.body).backgroundColor,
      flag: (window as unknown as { __theme?: number }).__theme ?? null,
    }));
    expect(state, value.slice(0, 40)).toEqual({ attributes: ["lang"], background: lightBackground, flag: null });
    await page.getByRole("button", { name: "切换主题" }).click();
    await expect(page.getByRole("menuitemradio", { name: "跟随系统" })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
  }
  expect(pageErrors).toEqual([]);
});

test("内容安全策略（和正式环境同一条）：内联的主题脚本按哈希放行并照常执行；登录、切换主题、退出全程没有任何东西被策略拦下；别的内联脚本会被拦", async ({ page }) => {
  // 浏览器每拦下一样东西就触发一次 securitypolicyviolation；这段监听由 Playwright 注入，不受页面的策略约束。
  await page.addInitScript(() => {
    const blocked: string[] = [];
    (window as unknown as { __cspBlocked: string[] }).__cspBlocked = blocked;
    document.addEventListener("securitypolicyviolation", (event) => blocked.push(`${event.violatedDirective} ${event.blockedURI}`));
  });
  const blockedSoFar = (): Promise<string[]> => page.evaluate(() => (window as unknown as { __cspBlocked: string[] }).__cspBlocked);

  const response = await page.goto("/login");
  const policy = response?.headers()["content-security-policy"] ?? "";
  expect(policy, "vite preview 应带上和正式环境同一条策略").toMatch(/^default-src 'self'; script-src 'self' 'sha256-[A-Za-z0-9+/]{43}='; /);
  expect(policy).not.toMatch(/unsafe-inline|unsafe-eval/);
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
  expect(await blockedSoFar()).toEqual([]);

  // 只让内联脚本有机会设置主题：把打包出来的脚本全部拦掉再刷新，<html> 上的 data-theme 只可能来自 index.html 里那一段。
  await page.evaluate(() => localStorage.setItem("nozomi.theme", "dark"));
  await page.route("**/assets/*.js", (route) => route.abort());
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await blockedSoFar(), "内联的主题脚本不应被策略拦下").toEqual([]);
  await page.unroute("**/assets/*.js");

  const { email, password } = adminCredentials();
  await loginAs(page, "platform", email, password);
  await page.getByRole("button", { name: "切换主题" }).click();
  await page.getByRole("menuitemradio", { name: "跟随系统" }).click();
  await page.keyboard.press("Escape");
  await signOut(page);
  expect(await blockedSoFar(), "登录后的页面里有东西被策略拦下了").toEqual([]);

  // 反过来确认策略真的在起作用：页面里新插入的内联脚本不执行，并被记为一次违规。
  const executed = await page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "window.__injected = 1";
    document.head.append(script);
    return (window as unknown as { __injected?: number }).__injected ?? null;
  });
  expect(executed).toBeNull();
  expect((await blockedSoFar()).some((entry) => entry.startsWith("script-src"))).toBe(true);
});

test("内容安全策略分两条（ADR 0046）：只有官网页面（/book…）放行 Stripe.js 的来源；登录页、运营后台、供应商后台上插 js.stripe.com 的脚本和框架、连 api.stripe.com 都被拦下，官网页面上照常加载", async ({ page }) => {
  await page.addInitScript(() => {
    const blocked: string[] = [];
    (window as unknown as { __cspBlocked: string[] }).__cspBlocked = blocked;
    document.addEventListener("securitypolicyviolation", (event) => blocked.push(`${event.violatedDirective} ${event.blockedURI}`));
  });
  // Stripe 的地址在网络层拦下、回一段本地的内容（测试从不连 Stripe）；被策略拦下的请求根本到不了这里
  const reached: string[] = [];
  await page.route(
    (url) => url.hostname.endsWith("stripe.com"),
    (route) => {
      const url = new URL(route.request().url());
      reached.push(`${url.hostname}${url.pathname}`);
      if (url.hostname === "js.stripe.com" && url.pathname === "/v3/") return route.fulfill({ contentType: "application/javascript", body: "window.__stripeLoaded = true;" });
      if (url.hostname === "api.stripe.com") return route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "{}" });
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="zh-CN"><title>stripe</title></html>' });
    },
  );
  /** 在当前页面上试着加载 Stripe 的脚本、框架，连 Stripe 的接口；返回脚本是否执行、接口是否连上。 */
  const tryStripe = (): Promise<{ script: boolean; api: boolean }> =>
    page.evaluate(async () => {
      const script = document.createElement("script");
      script.src = "https://js.stripe.com/v3/";
      const loaded = new Promise<boolean>((resolve) => {
        script.addEventListener("load", () => resolve(true));
        script.addEventListener("error", () => resolve(false));
      });
      document.head.append(script);
      for (const src of ["https://js.stripe.com/v3/elements-inner.html", "https://hooks.stripe.com/3d_secure/x"]) {
        const frame = document.createElement("iframe");
        frame.src = src;
        frame.title = "stripe";
        document.body.append(frame);
      }
      const api = await fetch("https://api.stripe.com/v1/payment_intents/pi_x").then(
        () => true,
        () => false,
      );
      return { script: (await loaded) && (window as unknown as { __stripeLoaded?: boolean }).__stripeLoaded === true, api };
    });
  const blockedSoFar = (): Promise<string[]> => page.evaluate(() => (window as unknown as { __cspBlocked: string[] }).__cspBlocked);

  for (const path of ["/login", "/platform/login", "/platform", "/bookx"]) {
    const response = await page.goto(path);
    const policy = response?.headers()["content-security-policy"] ?? "";
    expect(policy, `${path} 的策略不放行 Stripe`).not.toMatch(/stripe/);
    expect(await tryStripe(), `${path} 上 Stripe 的东西应全被拦下`).toEqual({ script: false, api: false });
    // 被拦下的框架只报来源（不带路径），脚本和接口报完整地址
    await expect.poll(blockedSoFar).toEqual(
      expect.arrayContaining(["script-src-elem https://js.stripe.com/v3/", "connect-src https://api.stripe.com/v1/payment_intents/pi_x", "frame-src https://js.stripe.com", "frame-src https://hooks.stripe.com"]),
    );
  }
  expect(reached, "被策略拦下的请求不会发出去").toEqual([]);

  for (const path of ["/book", "/book/order", "/book/checkout"]) {
    const response = await page.goto(path);
    expect(response?.headers()["content-security-policy"] ?? "", `${path} 的策略放行 Stripe`).toContain("script-src 'self' 'sha256-");
    expect(await tryStripe(), `${path} 上 Stripe.js 能加载、能连 Stripe 的接口`).toEqual({ script: true, api: true });
    await page.waitForTimeout(200);
    expect(await blockedSoFar(), `${path} 上有东西被策略拦下`).toEqual([]);
  }
  expect(reached).toEqual(expect.arrayContaining(["js.stripe.com/v3/", "js.stripe.com/v3/elements-inner.html", "hooks.stripe.com/3d_secure/x", "api.stripe.com/v1/payment_intents/pi_x"]));
});
