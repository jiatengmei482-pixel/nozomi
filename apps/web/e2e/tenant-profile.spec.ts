/**
 * 供应商名称和企业信息的维护（M4-34，ADR 0071），真实后端、真实 PostgreSQL。
 * 主流程：平台在供应商详情「编辑企业信息」改名称和企业信息 → 供应商后台看到新内容；
 * 供应商在「设置 › 企业信息」申请改名 → 审核期间旧名照用 → 平台发起复核、另一位同事批准 → 新名生效。
 * 两套主题、360px 宽各看一遍，无障碍检查。
 */
import { expect, test } from "@playwright/test";
import { expectAccessible, toast } from "./catalog.ts";
import { adminCredentials, approveApproval, createActiveTenant, expectNoHorizontalOverflow, loginAs, pendingApproval, platformAdminHeaders } from "./support.ts";

test("平台改企业信息 → 供应商看到；供应商申请改名 → 平台发起复核、另一位批准后生效", async ({ page, browser, request }) => {
  test.setTimeout(180_000);
  const tenant = await createActiveTenant(request);
  const admin = adminCredentials();
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginAs(page, "platform", admin.email, admin.password);
  await page.goto(`/platform/tenants/${tenant.tenantId}`);
  const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "企业信息", exact: true }) });
  await expect(card.getByText("供应商还没有填企业信息。")).toBeVisible();

  // 平台直接改：名称和企业信息一起
  await card.getByRole("button", { name: "编辑企业信息" }).click();
  const dialog = page.getByRole("dialog", { name: "编辑企业信息" });
  const newName = `${tenant.tenantName}（东京）`;
  await dialog.getByLabel("对外显示名称").fill(newName);
  await dialog.getByLabel(/所在国家/).fill("jp");
  await dialog.getByLabel(/法定名称/).fill("株式会社端到端交通");
  await dialog.getByLabel(/登记号/).fill("0100-01-000001");
  await dialog.getByLabel("注册地址").fill("東京都千代田区1-1");
  await dialog.getByLabel("联系人").fill("山田");
  await dialog.getByLabel("联系电话").fill("+81 3-0000-0000");
  await dialog.getByLabel("联系邮箱").fill("ops@e2e-profile.test");
  await expectAccessible(page, "编辑企业信息对话框");
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(toast(page, "企业信息已保存")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: newName })).toBeVisible();
  await expect(card.getByText("株式会社端到端交通")).toBeVisible();
  await expect(card.getByText("JP", { exact: true })).toBeVisible();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `供应商详情的企业信息（${scheme}）`);
  }
  await page.emulateMedia({ colorScheme: "light" });

  // 供应商后台：设置 › 企业信息看到平台改的内容；申请改名
  const context = await browser.newContext();
  const supplier = await context.newPage();
  await supplier.setViewportSize({ width: 360, height: 800 });
  await loginAs(supplier, "tenant", tenant.adminEmail, tenant.password);
  await supplier.goto("/settings/company");
  await expect(supplier.getByRole("heading", { level: 1, name: "企业信息" })).toBeVisible();
  await expect(supplier.getByText("株式会社端到端交通")).toBeVisible();
  const requestCard = supplier.locator("section").filter({ has: supplier.getByRole("heading", { name: "申请修改名称、法定名称、登记号" }) });
  const wanted = `${tenant.tenantName}（新）`;
  await requestCard.getByLabel("对外显示名称").fill(wanted);
  await requestCard.getByRole("button", { name: "提交申请" }).click();
  await expect(toast(supplier, "已提交，等平台审核")).toBeVisible();
  await expect(requestCard.getByText("等平台审核")).toBeVisible();
  await expectNoHorizontalOverflow(supplier, "供应商的企业信息（360px）");
  await expectAccessible(supplier, "供应商的企业信息");

  // 平台：申请出现在详情页；发起复核后由另一位同事批准
  await page.reload();
  const changes = page.locator("section").filter({ has: page.getByRole("heading", { name: "资料修改申请" }) });
  await expect(changes.getByText(wanted)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: newName })).toBeVisible();
  await changes.getByRole("button", { name: "核对无误，发起复核" }).click();
  await expect(toast(page, "已发起复核，等另一位同事审核后生效")).toBeVisible();
  const listed = await request.get(`/platform/v1/tenants/${tenant.tenantId}/profile-changes`, { headers: await platformAdminHeaders(request) });
  expect(listed.ok()).toBe(true);
  const changeId = ((await listed.json()) as { items: { id: string }[] }).items[0]?.id ?? "";
  const approvalId = await pendingApproval(request, changeId, "tenant.profile_change");
  await approveApproval(request, approvalId);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: wanted })).toBeVisible();
  await supplier.reload();
  await expect(supplier.getByText("已生效")).toBeVisible();
  await context.close();
});
