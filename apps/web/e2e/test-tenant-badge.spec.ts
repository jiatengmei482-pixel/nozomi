/**
 * 端到端（M8-24，ADR 0077）：运营后台供应商列表、详情给 QA 测试供应商显示「测试」标记和说明，已签约也没有「开始试运营」；
 * 接口对它的「开始试运营」回 409 TEST_TENANT_NOT_FOR_SALE。真实浏览器 → 前端 → 真实 API → 真实 PostgreSQL，不 mock 接口。
 * QA 测试供应商只能由 `pnpm qa:tenant-ensure` 建；这里经真实接口新建一家，再用本次运行的数据库连接把它标成测试供应商并停在「已签约」
 * （只在测试里构造；全平台最多一家，用完立刻把标记去掉，运行结束随 schema 删除）。
 * 亮暗两色 axe、320 / 390 宽不横向滚动；截图存到 E2E_SCREENSHOT_DIR（没设时存到测试输出目录）。
 */
import { type Page, expect, test } from "@playwright/test";
import { withPlatformTx } from "../../api/src/db/context.ts";
import { createPool } from "../../api/src/db/pool.ts";
import { expectAccessible } from "./catalog.ts";
import { adminCredentials, createTenant, expectNoHorizontalOverflow, loginAs, platformAdminHeaders, settleAnimations } from "./support.ts";

async function setTestTenant(tenantId: string, on: boolean): Promise<void> {
  const databaseUrl = process.env["E2E_DATABASE_URL"];
  if (!databaseUrl) throw new Error("global-setup 没有交出本次运行的数据库连接串");
  const pool = createPool(databaseUrl, { max: 1 });
  try {
    await withPlatformTx(pool, (db) => (on ? db.query("update tenants set is_test_tenant = true, status = 'signed', signed_at = now() where id = $1", [tenantId]) : db.query("update tenants set is_test_tenant = false where id = $1", [tenantId])));
  } finally {
    await pool.end();
  }
}

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env["E2E_SCREENSHOT_DIR"];
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await settleAnimations(page);
    await page.screenshot({ path: dir ? `${dir}/m824-${name}-${scheme}.png` : test.info().outputPath(`m824-${name}-${scheme}.png`), fullPage: true });
  }
  await page.emulateMedia({ colorScheme: "light" });
}

async function bothThemes(page: Page, what: string): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${what}（${scheme === "light" ? "亮色" : "暗色"}）`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

test("QA 测试供应商：列表和详情有「测试」标记和说明，没有「开始试运营」，接口拒绝试运营；真实供应商没有标记；亮暗 axe、窄屏不横向滚动", async ({ page, request }) => {
  test.setTimeout(120_000);
  const qa = await createTenant(request, { onboarding: "applying" });
  const real = await createTenant(request, { onboarding: "applying" });
  await setTestTenant(qa.tenantId, true);
  try {
    const headers = await platformAdminHeaders(request);
    const trial = await request.post(`/platform/v1/tenants/${qa.tenantId}/start-trial`, { headers, data: { test_order_note: "端到端测试" } });
    expect(trial.status(), await trial.text()).toBe(409);
    expect(((await trial.json()) as { error: { code: string } }).error.code).toBe("TEST_TENANT_NOT_FOR_SALE");

    const admin = adminCredentials();
    await page.setViewportSize({ width: 1280, height: 900 });
    await loginAs(page, "platform", admin.email, admin.password);

    // 按名称各搜一次：并行的用例也在建供应商，不靠「两家都在第一页」
    await page.goto(`/platform/tenants?q=${encodeURIComponent(real.tenantName)}`);
    const realRow = page.getByRole("row").filter({ has: page.getByRole("link", { name: real.tenantName, exact: true }) });
    await expect(realRow).toBeVisible();
    await expect(realRow.locator(".badge", { hasText: /^测试$/ })).toHaveCount(0);
    await page.goto(`/platform/tenants?q=${encodeURIComponent(qa.tenantName)}`);
    const qaRow = page.getByRole("row").filter({ has: page.getByRole("link", { name: qa.tenantName, exact: true }) });
    await expect(qaRow.locator(".badge", { hasText: /^测试$/ })).toBeVisible();
    await bothThemes(page, "供应商列表");
    await shot(page, "list-1280");

    await page.goto(`/platform/tenants/${qa.tenantId}`);
    await expect(page.getByRole("heading", { level: 1, name: qa.tenantName })).toBeVisible();
    await expect(page.locator(".page__meta .badge", { hasText: /^测试$/ })).toBeVisible();
    await expect(page.getByText("测试供应商：只用于验收，不能上架、不参与官网和渠道比价（ADR 0077）。")).toBeVisible();
    const progress = page.locator("section").filter({ has: page.getByRole("heading", { name: "入驻进度" }) });
    await expect(progress).toContainText("测试供应商不能开始试运营");
    await expect(progress.getByRole("button", { name: "开始试运营" })).toHaveCount(0);
    await bothThemes(page, "测试供应商详情");
    await shot(page, "detail-1280");

    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/platform/tenants?q=${encodeURIComponent(qa.tenantName)}`);
      await expect(page.locator(".badge", { hasText: /^测试$/ }).first()).toBeVisible();
      await expectNoHorizontalOverflow(page, `供应商列表 ${width}`);
      await shot(page, `list-${width}`);
      await page.goto(`/platform/tenants/${qa.tenantId}`);
      await expect(page.locator(".page__meta .badge", { hasText: /^测试$/ })).toBeVisible();
      await expectNoHorizontalOverflow(page, `测试供应商详情 ${width}`);
      await shot(page, `detail-${width}`);
    }

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/platform/tenants/${real.tenantId}`);
    await expect(page.getByRole("heading", { level: 1, name: real.tenantName })).toBeVisible();
    await expect(page.locator(".page__meta .badge", { hasText: /^测试$/ })).toHaveCount(0);
    await expect(page.getByText(/测试供应商：只用于验收/)).toHaveCount(0);
  } finally {
    await setTestTenant(qa.tenantId, false);
  }
});
