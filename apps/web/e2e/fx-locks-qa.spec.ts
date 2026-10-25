/**
 * 汇率人工锁定（M2-06）测试角色补充：真实后端、真实 PostgreSQL、本机假汇率源。经接口只发起「待审核」的台币申请（不影响汇率）；
 * 「生效中的锁定」在页面上由真实看板应答改写而来——真的锁定会让同时在跑的别的汇率页测试看到锁定。
 * - 发起表单的校验：写法不对、偏离超过 20% 在提交前就拦下（不发请求）；超过 3% 要原因；提交后汇率页的待审核里写「这是你发起的」；
 * - 浏览器的时钟比服务器快几十秒时，选「72 小时」也要能提交（表单按本机时钟算到期时刻）；
 * - 有生效中的锁定 + 待审核的申请时：汇率页、发起 / 解锁对话框、待审核队列在亮色、暗色下都通过 axe；320px 宽度不横向滚动；
 *   汇率表里锁定的台币标着「用了人工锁定的汇率」，另列中央汇率。
 * 测试数据（员工、待审核的申请）都在测试里经接口建出来；结束时撤回。
 */
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { E2E_FX_RATES, expectNoHorizontalOverflow, loginAs, newPassword, platformAdminHeaders, uniqueEmail } from "./support.ts";

interface Person {
  email: string;
  password: string;
  headers: Record<string, string>;
}

async function createStaff(request: APIRequestContext, role: string, name: string): Promise<Person> {
  const admin = await platformAdminHeaders(request);
  const email = uniqueEmail(`m206qa-${role}`);
  const created = await request.post("/platform/v1/staff", { headers: admin, data: { email, name, role } });
  expect(created.status(), await created.text()).toBe(201);
  const password = newPassword();
  const accepted = await request.post("/platform/v1/auth/accept-invite", { data: { token: ((await created.json()) as { invite: { token: string } }).invite.token, password } });
  expect(accepted.ok(), "接受邀请").toBe(true);
  const login = await request.post("/platform/v1/auth/login", { data: { email, password } });
  expect(login.ok(), "登录").toBe(true);
  return { email, password, headers: { authorization: `Bearer ${((await login.json()) as { access_token: string }).access_token}` } };
}

async function ensureRates(request: APIRequestContext): Promise<void> {
  const fetched = await request.post("/platform/v1/fx-rates/fetch", { headers: await platformAdminHeaders(request) });
  expect([200, 409]).toContain(fetched.status());
}

async function expectAccessible(page: Page, what: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = results.violations.map((violation) => `${violation.id}: ${violation.help}（${violation.nodes.map((node) => node.target.join(" ")).join("；")}）`);
  expect(summary, `${what} 的无障碍问题`).toEqual([]);
}

/** 撤回 a 发起的、还待审核的这个币种的申请；解除 a 发起的这个币种的锁定（b 批准）。 */
async function cleanUp(request: APIRequestContext, a: Person, b: Person, currency = "TWD"): Promise<void> {
  const queue = (await (await request.get("/platform/v1/approvals?limit=100", { headers: a.headers })).json()) as { items: { id: string; resource_id: string; can: { withdraw: boolean } }[] };
  for (const item of queue.items.filter((entry) => entry.resource_id === currency && entry.can.withdraw)) await request.post(`/platform/v1/approvals/${item.id}/withdraw`, { headers: a.headers, data: {} });
  const board = (await (await request.get("/platform/v1/fx-rates", { headers: a.headers })).json()) as { locks: { id: string; currency: string; requested_by: { email: string } }[] };
  // 只解自己这个测试建的锁定（同一文件的其他测试并行在跑）
  for (const lock of board.locks.filter((entry) => entry.currency === currency && entry.requested_by.email === a.email)) {
    const released = await request.post(`/platform/v1/fx-rates/locks/${lock.id}/release`, { headers: a.headers, data: {} });
    if (released.status() !== 202) continue;
    await request.post(`/platform/v1/approvals/${((await released.json()) as { approval: { id: string } }).approval.id}/approve`, { headers: b.headers, data: {} });
  }
}

const lockCard = (page: Page) => page.locator("section.card", { has: page.getByRole("heading", { level: 2, name: "人工锁定" }) });

async function openLockDialog(page: Page): Promise<ReturnType<Page["getByRole"]>> {
  await page.goto("/platform/master/fx-rates");
  await expect(page.getByRole("heading", { level: 1, name: "汇率" })).toBeVisible();
  await lockCard(page).getByRole("button", { name: "发起锁定" }).click();
  const dialog = page.getByRole("dialog", { name: /^(发起锁定汇率|改 TWD 的锁定)$/ });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("币种").selectOption("TWD");
  await expect(dialog.getByText(`现在的中央汇率：1 USD = ${E2E_FX_RATES.TWD} TWD`)).toBeVisible();
  return dialog;
}

test("发起表单：写法不对、偏离超过 20% 在提交前拦下（不发请求）；超过 3% 要原因；提交后待审核里写「这是你发起的」", async ({ page, request }) => {
  test.setTimeout(120_000);
  await ensureRates(request);
  const md = await createStaff(request, "master_data", "主数据表单");
  const md2 = await createStaff(request, "master_data", "主数据表单二");
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    let posts = 0;
    page.on("request", (req) => {
      if (req.method() === "POST" && /\/platform\/v1\/fx-rates\/locks$/.test(req.url())) posts += 1;
    });
    await loginAs(page, "platform", md.email, md.password);
    const dialog = await openLockDialog(page);
    const rate = dialog.getByLabel("锁定值（1 USD = ? TWD）");
    const submit = dialog.getByRole("button", { name: "提交审核" });
    // 空着提交：要填
    await submit.click();
    await expect(dialog.getByText("请填锁定值")).toBeVisible();
    // 锁定多久不预选（M1-18）：没选时在字段下面说明
    await expect(dialog.getByLabel("锁定多久")).toHaveValue("");
    await expect(dialog.getByText("请选择锁定多久")).toBeVisible();
    for (const text of ["abc", "1.5e2", "-32", "32,1", "0", "32.0000000000001"]) {
      await rate.fill(text);
      await rate.blur();
      await expect(dialog.getByText(/写成大于 0 的十进制数/), text).toBeVisible();
      await submit.click();
    }
    // 32 → 40：+25%，超过 20%
    await rate.fill("40");
    await expect(dialog.getByText("和中央汇率相差超过 20%，系统不允许；请核对币种和数量级")).toBeVisible();
    await submit.click();
    // 正好 +20%（38.4）允许，但超过 3% 要原因
    await rate.fill("38.4");
    await expect(dialog.getByText("和中央汇率相差 +20.00%")).toBeVisible();
    await expect(dialog.getByText("和中央汇率相差超过 20%，系统不允许；请核对币种和数量级")).toHaveCount(0);
    await submit.click();
    await expect(dialog.getByText("和中央汇率相差超过 3%，请写明原因")).toBeVisible();
    expect(posts, "被表单拦下的都没有发请求").toBe(0);
    // 只有空格的原因不算
    await dialog.getByLabel("原因（必填）").fill("   ");
    await submit.click();
    await expect(dialog.getByText("和中央汇率相差超过 3%，请写明原因")).toBeVisible();
    expect(posts).toBe(0);
    // 正好 3%（32.96）不用原因：可以提交
    await rate.fill("32.96");
    await dialog.getByLabel("原因").fill("");
    await expect(dialog.getByText("和中央汇率相差 +3.00%")).toBeVisible();
    await submit.click();
    await expect(dialog.getByText("请选择锁定多久")).toBeVisible();
    expect(posts, "没选锁定多久不提交").toBe(0);
    await dialog.getByLabel("锁定多久").selectOption("24");
    await expect(dialog.getByText("请选择锁定多久")).toHaveCount(0);
    await submit.click();
    await expect(page.getByText("已提交，等另一位有审核权限的同事在「待审核」里批准后生效")).toBeVisible();
    expect(posts).toBe(1);
    const pending = lockCard(page).getByRole("listitem").filter({ hasText: "32.96" });
    await expect(pending).toContainText("这是你发起的");
  } finally {
    await cleanUp(request, md, md2);
  }
});

test("浏览器的时钟比服务器快 30 秒：选「72 小时」照样能提交（不应被服务器以「锁定最长 72 小时」拒收）", async ({ page, request }) => {
  test.setTimeout(90_000);
  await ensureRates(request);
  const md = await createStaff(request, "master_data", "主数据时钟");
  const md2 = await createStaff(request, "master_data", "主数据时钟二");
  try {
    // 模拟本机时钟快 30 秒（很多办公电脑的时钟会漂移几十秒）
    await page.addInitScript(() => {
      const offset = 30_000;
      const RealDate = Date;
      class SkewedDate extends RealDate {
        constructor(...args: unknown[]) {
          if (args.length === 0) super(RealDate.now() + offset);
          else super(...(args as [string]));
        }
        static override now(): number {
          return RealDate.now() + offset;
        }
      }
      globalThis.Date = SkewedDate as DateConstructor;
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await loginAs(page, "platform", md.email, md.password);
    const dialog = await openLockDialog(page);
    await dialog.getByLabel("锁定值（1 USD = ? TWD）").fill("32.1");
    await dialog.getByLabel("锁定多久").selectOption("72");
    await dialog.getByRole("button", { name: "提交审核" }).click();
    await expect(page.getByText("已提交，等另一位有审核权限的同事在「待审核」里批准后生效")).toBeVisible();
  } finally {
    await cleanUp(request, md, md2);
  }
});

/** a 发起一条待审核的锁定申请（待审核的不影响汇率，不会干扰同时在跑的别的测试）。 */
async function pendingLock(request: APIRequestContext, a: Person, currency: string, rate: string): Promise<void> {
  const requested = await request.post("/platform/v1/fx-rates/locks", { headers: a.headers, data: { currency, rate, expires_at: new Date(Date.now() + 5 * 3_600_000).toISOString(), reason: null } });
  expect(requested.status(), await requested.text()).toBe(202);
}

/**
 * 「生效中的锁定」由真实的看板应答改写而来（其余字段都是后端真实给的）：真的锁定一个币种会让同时在跑的别的汇率页测试看到锁定。
 * 锁定的形状和后端 fxLockJson 一致；汇率表、互换表里涉及这个币种的格子标 locked。
 */
async function injectActiveLock(page: Page, currency: string, rate: string): Promise<void> {
  await page.route(/\/platform\/v1\/fx-rates(\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { base: string; as_of: string; locks: unknown[]; rates: { currency: string; rate: string; central_rate: string; locked: boolean }[]; cross: { from: string; to: string; rate: string; locked: boolean }[] };
    const now = Date.now();
    const central = body.rates.find((item) => item.currency === currency)?.central_rate ?? "1";
    const staff = (id: string, name: string) => ({ id, name, email: `${id.slice(-4)}@platform.test` });
    const lock = {
      id: "00000000-0000-4000-8000-0000000000a1",
      currency,
      rate,
      reason: "端到端测试：外观检查",
      expires_at: new Date(now + 6 * 3_600_000).toISOString(),
      locked_at: new Date(now - 60_000).toISOString(),
      central_rate: central,
      central_as_of: body.as_of,
      deviation_bp: 31,
      lock_approval_id: "00000000-0000-4000-8000-0000000000a2",
      requested_by: staff("00000000-0000-4000-8000-0000000000a3", "主数据外观"),
      approved_by: staff("00000000-0000-4000-8000-0000000000a4", "主数据外观二"),
      status: "active",
      ended_at: null,
      end_approval_id: null,
      ended_by: null,
    };
    const rates = body.rates.map((item) => (body.base === "USD" && item.currency === currency ? { ...item, rate, locked: true } : item));
    const cross = body.cross.map((item) => (item.from === currency || item.to === currency ? { ...item, locked: true } : item));
    await route.fulfill({ response, json: { ...body, locks: [...body.locks, lock], rates, cross } });
  });
}

test("有生效中的锁定和待审核的申请：汇率页、改锁定值 / 解锁对话框、待审核队列在亮色和暗色下都通过 axe；汇率表里标明锁定、另列中央汇率；待审核队列 320px 不横向滚动", async ({ page, request }) => {
  test.setTimeout(180_000);
  await ensureRates(request);
  const md = await createStaff(request, "master_data", "主数据外观");
  const md2 = await createStaff(request, "master_data", "主数据外观二");
  try {
    await pendingLock(request, md, "TWD", "32.2");
    await injectActiveLock(page, "TWD", "32.1");
    await loginAs(page, "platform", md2.email, md2.password);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto("/platform/master/fx-rates");
      const active = lockCard(page).getByRole("region", { name: "生效中的锁定" }).getByRole("row", { name: /TWD/ });
      await expect(active).toContainText("32.1");
      await expect(active).toContainText("端到端测试：外观检查");
      const row = page.getByRole("region", { name: "当前汇率表" }).getByRole("row", { name: /TWD/ });
      await expect(row).toContainText("32.1");
      await expect(row).toContainText("用了人工锁定的汇率");
      await expect(row).toContainText(E2E_FX_RATES.TWD);
      // 待审核：md2 能审，看到「去待审核处理」
      await expect(lockCard(page).getByRole("listitem").filter({ hasText: "32.2" }).getByRole("link", { name: "去待审核处理" })).toBeVisible();
      await expectAccessible(page, `${scheme} 汇率页（有锁定）`);
      await active.getByRole("button", { name: "改锁定值" }).click();
      const dialog = page.getByRole("dialog", { name: "改 TWD 的锁定" });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("锁定值（1 USD = ? TWD）").fill("40");
      await expect(dialog.getByText("和中央汇率相差超过 20%，系统不允许；请核对币种和数量级")).toBeVisible();
      await expectAccessible(page, `${scheme} 改锁定值对话框（有错误）`);
      await dialog.getByRole("button", { name: "取消" }).click();
      await active.getByRole("button", { name: "解锁" }).click();
      const unlock = page.getByRole("dialog", { name: "解除 TWD 的锁定？" });
      await expect(unlock).toBeVisible();
      await expectAccessible(page, `${scheme} 解锁对话框`);
      await unlock.getByRole("button", { name: "取消" }).click();
      await page.goto("/platform/approvals");
      const card = page.locator(".approval-card").filter({ hasText: "锁定汇率" }).filter({ hasText: "32.2" }).first();
      await expect(card).toBeVisible();
      await expect(card.getByRole("link", { name: /TWD.*去汇率页/ })).toBeVisible();
      await expectAccessible(page, `${scheme} 待审核队列（汇率锁定）`);
      await page.setViewportSize({ width: 320, height: 800 });
      await expectNoHorizontalOverflow(page, `${scheme} 待审核队列 320px`);
    }
  } finally {
    await cleanUp(request, md, md2);
  }
});

test("320px 宽度、有生效中的锁定时：汇率页和发起锁定对话框不横向滚动（互换表里「用了人工锁定的汇率」的读屏文字不能把页面撑宽）", async ({ page, request }) => {
  test.setTimeout(120_000);
  await ensureRates(request);
  const md = await createStaff(request, "master_data", "主数据窄屏");
  const md2 = await createStaff(request, "master_data", "主数据窄屏二");
  try {
    await injectActiveLock(page, "HKD", "7.81");
    await loginAs(page, "platform", md2.email, md2.password);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/platform/master/fx-rates");
    await expect(lockCard(page).getByRole("region", { name: "生效中的锁定" }).getByRole("row", { name: /HKD/ })).toBeVisible();
    await expect(page.getByRole("region", { name: "币种互换表" })).toBeVisible();
    await expectNoHorizontalOverflow(page, "汇率页 320px（有锁定）");
    await lockCard(page).getByRole("button", { name: "发起锁定" }).click();
    const narrow = page.getByRole("dialog", { name: "发起锁定汇率" });
    await expect(narrow).toBeVisible();
    await narrow.getByLabel("锁定值（1 USD = ? JPY）").fill("200");
    await expect(narrow.getByText("和中央汇率相差超过 20%，系统不允许；请核对币种和数量级")).toBeVisible();
    await expectNoHorizontalOverflow(page, "发起锁定对话框 320px（有错误）");
  } finally {
    await cleanUp(request, md, md2, "HKD");
  }
});
