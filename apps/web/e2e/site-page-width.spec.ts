/**
 * 端到端：官网页面宽度（M8-28，ADR 0079）。真实浏览器 → 前端 → 真实 API → 真实 PostgreSQL，不 mock 接口。
 * 超级管理员在运营后台「系统设置 → 官网设置 → 页面宽度」选「最宽」保存 → 客人打开 `/book/new`，1920 宽的屏幕上内容比「标准」宽、右侧栏宽度不变；
 * 平板（820）和手机（390）不受影响：单栏、摘要条、不横向滚动。用例结束改回原来的宽度（官网设置是全站一份，别的用例也在用）。
 */
import { type APIRequestContext, expect, test } from "@playwright/test";
import { publishTransfer } from "./book-new-support.ts";
import { createSupplier, createWorld } from "./catalog.ts";
import { OWN_SITE_SOURCE, adminCredentials, expectNoHorizontalOverflow, loginAs, platformAdminHeaders } from "./support.ts";

test.use(OWN_SITE_SOURCE);

type Width = "standard" | "wide" | "full";

async function readSettings(request: APIRequestContext): Promise<{ version: number; support_whatsapp: string | null; page_width: Width }> {
  const headers = await platformAdminHeaders(request);
  return (await (await request.get("/platform/v1/site-settings", { headers })).json()) as { version: number; support_whatsapp: string | null; page_width: Width };
}

async function setWidth(request: APIRequestContext, width: Width): Promise<void> {
  const headers = await platformAdminHeaders(request);
  const current = await readSettings(request);
  const response = await request.put("/platform/v1/site-settings", { headers: { ...headers, ...(current.version > 0 ? { "if-match": `"${current.version}"` } : {}) }, data: { support_whatsapp: current.support_whatsapp, page_width: width } });
  expect(response.status(), await response.text()).toBe(200);
}

test("页面宽度：超级管理员在官网设置选「最宽」→ 官网电脑上变宽、右侧栏宽度不变；平板和手机单栏不受影响", async ({ page, request }) => {
  test.setTimeout(120_000);
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  await publishTransfer(request, supplier, world);
  const before = (await readSettings(request)).page_width;
  try {
    await setWidth(request, "standard");
    await page.setViewportSize({ width: 1920, height: 1000 });
    await page.goto("/book/new");
    await expect(page.locator(".site")).toHaveAttribute("data-width", "standard");
    const standard = await page.locator(".site__main").boundingBox();
    const standardAside = await page.locator(".book-new__aside").boundingBox();

    const admin = adminCredentials();
    await loginAs(page, "platform", admin.email, admin.password);
    await page.getByRole("navigation", { name: "主菜单" }).getByRole("button", { name: "系统设置" }).click();
    await page.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "官网设置" }).click();
    const card = page.getByRole("region", { name: "页面宽度" });
    await card.getByRole("radio", { name: /^最宽/ }).check();
    await card.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText(/官网页面宽度改为「最宽」/)).toBeVisible();

    await page.goto("/book/new");
    await expect(page.locator(".site")).toHaveAttribute("data-width", "full");
    const full = await page.locator(".site__main").boundingBox();
    const fullAside = await page.locator(".book-new__aside").boundingBox();
    expect(full?.width ?? 0, "最宽比标准宽").toBeGreaterThan((standard?.width ?? 0) + 400);
    expect(Math.round(fullAside?.width ?? 0), "右侧栏宽度不变").toBe(Math.round(standardAside?.width ?? 0));

    for (const size of [{ width: 820, height: 1180 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(size);
      await expect(page.locator(".book-new__aside")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^行程摘要/ })).toBeVisible();
      await expectNoHorizontalOverflow(page, `页面宽度最宽时 ${size.width} 宽`);
    }
  } finally {
    await setWidth(request, before ?? "standard");
  }
});
