/**
 * 汇率人工锁定（M2-06），真实后端、真实 PostgreSQL：主数据运营在汇率页发起锁定泰铢（自己批不了）→ 超级管理员在「待审核」里批准 → 汇率页、首页卡片看到锁定；
 * 超级管理员发起解锁 → 主数据运营批准 → 恢复用数据源的汇率，锁定记录里是「已解锁」。
 * 锁的是泰铢：别的端到端测试不看泰铢的汇率，同时跑也互不影响。到期时间按「锁定多久」从现在算，不写死日期。
 */
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { E2E_FX_RATES, adminCredentials, loginAs, newPassword, platformAdminHeaders, uniqueEmail } from "./support.ts";

async function createStaff(request: APIRequestContext, role: string, name: string): Promise<{ email: string; password: string }> {
  const headers = await platformAdminHeaders(request);
  const email = uniqueEmail(`m206-${role}`);
  const created = await request.post("/platform/v1/staff", { headers, data: { email, name, role } });
  expect(created.status(), await created.text()).toBe(201);
  const password = newPassword();
  const accepted = await request.post("/platform/v1/auth/accept-invite", { data: { token: ((await created.json()) as { invite: { token: string } }).invite.token, password } });
  expect(accepted.ok(), "接受邀请").toBe(true);
  return { email, password };
}

const menu = (page: Page) => page.getByRole("navigation", { name: "主菜单" }).first();
const lockCard = (page: Page) => page.locator("section.card", { has: page.getByRole("heading", { level: 2, name: "人工锁定" }) });

async function approveIn(page: Page, kind: string): Promise<void> {
  await page.goto("/platform/approvals");
  const card = page.locator(".approval-card").filter({ hasText: kind }).filter({ hasText: "THB" }).first();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "批准" }).click();
  const dialog = page.getByRole("dialog", { name: /^批准/ });
  await dialog.getByRole("button", { name: "批准" }).click();
  await expect(page.getByText("已批准，改动已生效")).toBeVisible();
}

test("主数据运营发起锁定泰铢、自己批不了 → 超级管理员批准后生效（汇率页、首页卡片）→ 超级管理员发起解锁 → 主数据运营批准，恢复用数据源的汇率", async ({ page, browser, request }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  // 先确保有汇率（定时任务可能已经拉到）
  const fetched = await request.post("/platform/v1/fx-rates/fetch", { headers: await platformAdminHeaders(request) });
  expect([200, 409]).toContain(fetched.status());
  const masterData = await createStaff(request, "master_data", "主数据甲");

  // 主数据运营：发起锁定
  await loginAs(page, "platform", masterData.email, masterData.password);
  await expect(menu(page).getByRole("link", { name: "待审核" })).toBeVisible();
  await page.goto("/platform/master/fx-rates");
  await expect(page.getByRole("heading", { level: 1, name: "汇率" })).toBeVisible();
  await lockCard(page).getByRole("button", { name: "发起锁定" }).click();
  const dialog = page.getByRole("dialog", { name: "发起锁定汇率" });
  await dialog.getByLabel("币种").selectOption("THB");
  await expect(dialog.getByText(`现在的中央汇率：1 USD = ${E2E_FX_RATES.THB} THB`)).toBeVisible();
  // 36 → 37.5：+4.17%，要写原因
  await dialog.getByLabel("锁定值（1 USD = ? THB）").fill("37.5");
  await expect(dialog.getByText("和中央汇率相差 +4.17%")).toBeVisible();
  await dialog.getByRole("button", { name: "提交审核" }).click();
  await expect(dialog.getByText("和中央汇率相差超过 3%，请写明原因")).toBeVisible();
  await dialog.getByLabel("原因（必填）").fill("端到端测试：按银行牌价锁定");
  await dialog.getByLabel("锁定多久").selectOption("12");
  await dialog.getByRole("button", { name: "提交审核" }).click();
  await expect(page.getByText("已提交，等另一位有审核权限的同事在「待审核」里批准后生效")).toBeVisible();
  const pending = lockCard(page).getByRole("listitem").filter({ hasText: "THB" });
  await expect(pending).toContainText("这是你发起的");
  // 自己在待审核里批不了
  await page.goto("/platform/approvals");
  const mine = page.locator(".approval-card").filter({ hasText: "锁定汇率" }).filter({ hasText: "THB" }).first();
  await expect(mine.getByRole("button", { name: "批准" })).toHaveCount(0);
  await expect(mine.getByRole("button", { name: "撤回" })).toBeVisible();

  // 超级管理员：批准
  const admin = await browser.newPage();
  await admin.setViewportSize({ width: 1280, height: 900 });
  const adminLogin = adminCredentials();
  await loginAs(admin, "platform", adminLogin.email, adminLogin.password);
  await approveIn(admin, "锁定汇率");
  await admin.goto("/platform/master/fx-rates");
  const active = lockCard(admin).getByRole("region", { name: "生效中的锁定" }).getByRole("row", { name: /THB 泰铢/ });
  await expect(active).toContainText("37.5");
  await expect(active).toContainText("主数据甲");
  await expect(active).toContainText("端到端测试：按银行牌价锁定");
  const rates = admin.getByRole("region", { name: "当前汇率表" }).getByRole("row", { name: /THB 泰铢/ });
  await expect(rates).toContainText("37.5");
  await expect(rates).toContainText("用了人工锁定的汇率");
  // 首页的汇率卡片：提示锁定
  await admin.goto("/platform");
  await expect(admin.getByRole("link", { name: /人工锁定中：.*THB（到 / })).toBeVisible();

  // 超级管理员：发起解锁
  await admin.goto("/platform/master/fx-rates");
  await lockCard(admin).getByRole("region", { name: "生效中的锁定" }).getByRole("row", { name: /THB 泰铢/ }).getByRole("button", { name: "解锁" }).click();
  const unlock = admin.getByRole("dialog", { name: "解除 THB 的锁定？" });
  await unlock.getByLabel("原因（选填）").fill("行情恢复");
  await unlock.getByRole("button", { name: "提交审核" }).click();
  await expect(admin.getByText("已提交，等另一位有审核权限的同事在「待审核」里批准后生效")).toBeVisible();
  await admin.close();

  // 主数据运营：批准解锁
  await approveIn(page, "解除汇率锁定");
  await page.goto("/platform/master/fx-rates");
  await expect(lockCard(page).getByRole("region", { name: "生效中的锁定" }).getByRole("row", { name: /THB 泰铢/ })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "当前汇率表" }).getByRole("row", { name: /THB 泰铢/ })).toContainText(E2E_FX_RATES.THB);
  await expect(page.getByRole("region", { name: "锁定记录表" }).getByRole("row", { name: /THB/ }).first()).toContainText("已解锁");
});
