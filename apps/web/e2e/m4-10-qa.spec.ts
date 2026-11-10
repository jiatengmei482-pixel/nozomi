/**
 * M4-10 测试角色：在真实浏览器里核对两条验收标准的原始复现。
 * - 搜索框停止输入 300ms 后写网址的延时，不能在用户已经点进详情页后把页面换回列表（运营后台「供应商」「工单」列表：输入后不等就点进详情）；
 * - 格式不对的订单链接也提示「订单链接无效或已过期」（M3 验收报告：/book/order#bogus-link-value 只显示查订单表单）。
 * 数据经接口现建（供应商名字带随机后缀），不依赖其他用例。
 */
import { expect, test } from "@playwright/test";
import { adminCredentials, createTenant, loginAs, OWN_SITE_SOURCE } from "./support.ts";

// 官网按来源地址限速：每条用例带自己的文档专用地址，不和并行的官网用例在 127.0.0.1 上抢同一份额度（M8-17）
test.use(OWN_SITE_SOURCE);

test("运营后台供应商列表：搜索框输入后马上点进某家供应商，过了 300ms 仍停在详情页，没有被换回列表", async ({ page, request }) => {
  const tenant = await createTenant(request);
  await page.setViewportSize({ width: 1280, height: 900 });
  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);
  await page.goto(`/platform/tenants?q=${encodeURIComponent(tenant.tenantName)}`);
  const link = page.getByRole("link", { name: tenant.tenantName, exact: true });
  await expect(link).toBeVisible();
  // 在搜索框里改一个字（还没到 300ms）就点进详情
  await page.getByRole("searchbox", { name: "按名称搜索" }).fill(`${tenant.tenantName} `);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/platform/tenants/${tenant.tenantId}`));
  await page.waitForTimeout(800);
  await expect(page).toHaveURL(new RegExp(`/platform/tenants/${tenant.tenantId}`));
  await expect(page.getByRole("heading", { level: 1, name: tenant.tenantName })).toBeVisible();
});

test("运营后台供应商列表：正常停止输入 300ms 后仍会把关键字写进网址并查询", async ({ page, request }) => {
  const tenant = await createTenant(request);
  await page.setViewportSize({ width: 1280, height: 900 });
  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);
  await page.goto("/platform/tenants");
  await page.getByRole("searchbox", { name: "按名称搜索" }).fill(tenant.tenantName);
  await expect(page).toHaveURL(/[?&]q=/);
  await expect(page.getByRole("link", { name: tenant.tenantName, exact: true })).toBeVisible();
});

test("官网查订单：链接格式不对（# 后面被改坏、被截断）也提示「订单链接无效或已过期」；只有 # 时只显示查订单表单", async ({ page }) => {
  for (const hash of ["#bogus-link-value", "#nzo_abc", "#%E4%B8%AD"]) {
    await page.goto(`/book/order${hash}`);
    await expect(page.getByRole("heading", { level: 1, name: "查订单" })).toBeVisible();
    await expect(page.getByText("订单链接无效或已过期。请填订单号和下单邮箱，我们会把新的订单链接发到您的邮箱。")).toBeVisible();
  }
  await page.goto("/book/order#");
  await expect(page.getByRole("heading", { level: 1, name: "查订单" })).toBeVisible();
  await expect(page.getByText(/订单链接无效或已过期/)).toHaveCount(0);
});
