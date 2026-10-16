/**
 * 汇率页（M2-03）测试角色补充：真实后端、真实 PostgreSQL、本机假汇率源。
 * - 亮色 / 暗色各做 axe 检查：正常状态、过期提醒 + 挂起待确认的一批 + 确认对话框（这两种状态由真实应答改写而来，
 *   端到端环境里没法让真实汇率等 48 小时或让假数据源跳变）；
 * - 320px 宽度下（含过期提醒、挂起卡片、对话框）页面不横向滚动；
 * - 立即拉取进行中显示「正在拉取…」，结束后给结果。
 */
import { type Page, expect, test } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { adminCredentials, expectNoHorizontalOverflow, loginAs } from "./support.ts";

async function expectAccessible(page: Page, what: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = results.violations.map((violation) => `${violation.id}: ${violation.help}（${violation.nodes.map((node) => node.target.join(" ")).join("；")}）`);
  expect(summary, `${what} 的无障碍问题`).toEqual([]);
}

async function signIn(page: Page): Promise<void> {
  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);
}

/** 把真实的看板应答改成「已过期 + 有一批挂起待确认」：其余字段都是后端真实给的。 */
async function staleWithHeld(page: Page): Promise<void> {
  await page.route(/\/platform\/v1\/fx-rates(\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const held = {
      ...(body.source_status.last_attempt ?? {}),
      id: "999999",
      status: "held",
      error_code: "FX_RATE_JUMP",
      error_detail: "JPY、KRW 变动超过 3%，等待人工确认",
      source_as_of: new Date().toISOString(),
      held_rates: [{ currency: "JPY", rate: "160.123456" }],
      jumps: [
        { currency: "JPY", previous: "150.5", next: "160.123456", change_bp: 639 },
        { currency: "KRW", previous: "1400", next: "1300.987654321", change_bp: -707 },
      ],
      decided_by: null,
      decided_at: null,
    };
    await route.fulfill({ response, json: { ...body, state: "stale", held } });
  });
}

async function openFxPage(page: Page): Promise<void> {
  await page.goto("/platform/master/fx-rates");
  await expect(page.getByRole("heading", { level: 2, name: "数据源" })).toBeVisible();
}

for (const scheme of ["light", "dark"] as const) {
  test(`${scheme === "light" ? "亮色" : "暗色"}：汇率页正常、过期 + 挂起、确认对话框都通过 axe 检查`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ colorScheme: scheme });
    await signIn(page);
    await openFxPage(page);
    await page.getByRole("button", { name: "立即拉取" }).click();
    await expect(page.getByText(/^(汇率已更新|数据源还没有更新，汇率不变)$/)).toBeVisible();
    await expect(page.getByRole("img", { name: /近 30 天/ })).toBeVisible();
    await expectAccessible(page, `汇率页（${scheme}）`);

    await staleWithHeld(page);
    await page.reload();
    await expect(page.getByText("汇率超过 48 小时没有更新，跨币种报价已暂停").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "有一批汇率变动超过 3%，等待确认" })).toBeVisible();
    await expectAccessible(page, `汇率页过期 + 挂起（${scheme}）`);
    await page.getByRole("button", { name: "确认生效" }).click();
    await expect(page.getByRole("dialog", { name: "确认这批汇率生效？" })).toBeVisible();
    await expectAccessible(page, `确认对话框（${scheme}）`);
  });
}

test("320px 宽：汇率页（正常、过期 + 挂起、对话框打开）都不横向滚动", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await signIn(page);
  await openFxPage(page);
  await expect(page.getByRole("heading", { level: 2, name: "常用币种互换" })).toBeVisible();
  await expectNoHorizontalOverflow(page, "汇率页（320px）");
  await staleWithHeld(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "有一批汇率变动超过 3%，等待确认" })).toBeVisible();
  await expectNoHorizontalOverflow(page, "汇率页过期 + 挂起（320px）");
  await page.getByRole("button", { name: "放弃这批" }).click();
  await expect(page.getByRole("dialog", { name: "放弃这批汇率？" })).toBeVisible();
  await expectNoHorizontalOverflow(page, "放弃对话框（320px）");
});

test("立即拉取进行中：按钮显示「正在拉取…」，请求放行后给出结果并恢复按钮", async ({ page }) => {
  await signIn(page);
  await openFxPage(page);
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/platform/v1/fx-rates/fetch", async (route) => {
    await released;
    await route.continue();
  });
  await page.getByRole("button", { name: "立即拉取" }).click();
  await expect(page.getByRole("button", { name: /正在拉取…/ })).toHaveAttribute("aria-busy", "true");
  release();
  await expect(page.getByText(/^(汇率已更新|数据源还没有更新，汇率不变)$|正在拉取汇率（定时任务或其他同事）/)).toBeVisible();
  await expect(page.getByRole("button", { name: "立即拉取" })).not.toHaveAttribute("aria-busy", "true");
});
