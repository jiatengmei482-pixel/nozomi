/**
 * M4-01 供应商入驻（ADR 0028），真实后端、真实 PostgreSQL、真实浏览器：
 * 招商建供应商（申请中）→ 供应商在「企业资质」填企业信息、逐项上传资质、提交审核 → 运营驳回一份（供应商看到原因、重传、再提交）→
 * 运营逐项通过 → 发起合同（另一位同事批准）→ 签约（不能上架）→ 开始试运营（可以上架）；资质审核队列、履约评分页、亮暗两种主题的 axe。
 * 日期一律按今天往后推。
 */
import { addDays } from "@nozomi/domain";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { type World, createArea, createBrand, createWorld, expectAccessible, post, tenantHeaders, toast } from "./catalog.ts";
import { adminCredentials, approveApproval, createTenant, expectNoHorizontalOverflow, loginAs, newPassword, pendingApproval } from "./support.ts";

const JP_DOCUMENTS = ["登记簿謄本（履历事项全部证明书）", "旅客运输营运许可", "旅客赔偿责任保险", "营运车辆商业保险", "结算账户证明"];
const WITH_EXPIRY = new Set(["旅客运输营运许可", "旅客赔偿责任保险", "营运车辆商业保险"]);

const pdf = (label: string): { name: string; mimeType: string; buffer: Buffer } => ({ name: `${label}.pdf`, mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.7\n${label}\n%%EOF\n`) });

async function upload(page: Page, document: string, expiresOn: string, action = "上传"): Promise<void> {
  await page.getByRole("button", { name: `${action} ${document}` }).click();
  const dialog = page.getByRole("dialog", { name: new RegExp(`：${document.replace(/[（）]/g, ".")}$`) });
  await dialog.getByLabel(/^文件/).setInputFiles(pdf(document));
  if (WITH_EXPIRY.has(document)) await dialog.getByLabel(/^到期日/).fill(expiresOn);
  await dialog.getByRole("button", { name: "提交", exact: true }).click();
  await expect(toast(page, `已提交「${document}」，等平台审核`)).toBeVisible();
  await expect(dialog).toBeHidden();
}

/** 一个能通过上架校验的接送机商品（经接口建好，不上架）。 */
async function publishableProduct(request: APIRequestContext, headers: Record<string, string>, world: World): Promise<string> {
  const brand = await createBrand(request, headers, `入驻品牌 ${Date.now()}`);
  const area = await createArea(request, headers, world.city, `入驻区域 ${Date.now()}`);
  const created = await post<{ id: string; version: number }>(request, { ...headers, "idempotency-key": crypto.randomUUID() }, "/tenant/v1/products", { brand_id: brand.id, city_id: world.city.id, category: "airport_transfer", poi_id: world.airport.id, areas: [{ area_id: area.id }], vehicle_groups: [{ vehicle_group_id: world.group.id, passengers: 6, luggage: 4 }], dispatchers: [{ name: "山田", phone: "+81 90 1234 5678" }] }, "新建商品");
  const rules = await request.put(`/tenant/v1/products/${created.id}/service-rules`, {
    headers: { ...headers, "if-match": `"${created.version}"` },
    data: { booking: { sale_from: null, sale_to: null, service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 0, note: null }, urgent: { enabled: false, daily_quota: null, tiers: [] }, night: { enabled: false, window: null, amount: null, charge_unit: null }, free_wait: { pickup: { mode: "limited", minutes: 60 }, dropoff: { mode: "limited", minutes: 60 }, general: null }, addons: [], driver_languages: [] },
  });
  expect(rules.status(), await rules.text()).toBe(200);
  const content = await request.put(`/tenant/v1/products/${created.id}/content`, { headers: { ...headers, "if-match": `"${((await rules.json()) as { version: number }).version}"` }, data: { zh: { title: "成田机场接送", pickup_guide: "到达大厅 2 号出口" } } });
  expect(content.status(), await content.text()).toBe(200);
  const { today } = (await (await request.get(`/tenant/v1/products/${created.id}/price-rules`, { headers })).json()) as { today: string };
  const version = ((await (await request.get(`/tenant/v1/products/${created.id}`, { headers })).json()) as { version: number }).version;
  const price = await request.post(`/tenant/v1/products/${created.id}/price-rules/batch`, {
    headers: { ...headers, "if-match": `"${version}"`, "idempotency-key": crypto.randomUUID() },
    data: { create: [{ ref: "a", area_id: area.id, vehicle_group_id: world.group.id, direction: "both", package_hours: null, pricing_model: "fixed", base_price: 18_000, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null, valid_from: today, valid_to: null, status: "enabled" }], update: [], delete: [] },
  });
  expect(price.status(), await price.text()).toBe(200);
  return created.id;
}

test("供应商入驻：企业信息 → 逐项上传资质 → 提交审核 → 驳回后重传 → 逐项通过 → 合同（双人复核）→ 签约（不能上架）→ 开始试运营（可以上架）", async ({ browser, page, request }) => {
  test.setTimeout(300_000);
  const world = await createWorld(request);
  const invited = await createTenant(request, { onboarding: "applying" });
  const password = newPassword();
  expect((await request.post("/tenant/v1/auth/accept-invite", { data: { token: invited.inviteToken, password } })).ok()).toBe(true);
  const headers = await tenantHeaders(request, invited.adminEmail, password);
  const { today } = (await (await request.get("/tenant/v1/company", { headers })).json()) as { today: string };
  const expiresOn = addDays(today, 400);

  // ── 供应商：企业信息、资质、提交审核 ──
  const theirs = await browser.newContext();
  const tenantPage = await theirs.newPage();
  await tenantPage.setViewportSize({ width: 1280, height: 900 });
  await loginAs(tenantPage, "tenant", invited.adminEmail, password);
  await expect(tenantPage.locator(".tenant-status")).toHaveText("申请中");
  await tenantPage.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "企业资质" }).click();
  await expect(tenantPage.getByRole("heading", { level: 1, name: "企业资质" })).toBeVisible();
  const progress = tenantPage.getByRole("region", { name: "入驻进度" });
  await expect(progress).toContainText("所在国家：必填");
  for (const [label, value] of [["所在国家（两位代码）", "JP"], ["法定名称", "株式会社 入驻测试交通"], ["登记号 / 统一社会信用代码", "0100-01-123456"], ["地址", "东京都千代田区丸之内 1-1"], ["联系人", "山田"], ["联系电话", "+81 3-1234-5678"], ["联系邮箱", "ops@onboarding.example.com"]] as const) {
    await tenantPage.getByLabel(label, { exact: true }).fill(value);
  }
  await tenantPage.getByRole("button", { name: "保存", exact: true }).click();
  await expect(toast(tenantPage, "企业信息已保存")).toBeVisible();
  const documents = tenantPage.getByRole("region", { name: "资质清单" });
  await expect(documents.getByRole("row")).toHaveCount(JP_DOCUMENTS.length + 1);
  // 页面先拦下已经到期的到期日
  await tenantPage.getByRole("button", { name: "上传 营运车辆商业保险" }).click();
  const early = tenantPage.getByRole("dialog", { name: "上传：营运车辆商业保险" });
  await early.getByLabel(/^文件/).setInputFiles(pdf("营运车辆商业保险"));
  await early.getByLabel(/^到期日/).fill(today);
  await early.getByRole("button", { name: "提交", exact: true }).click();
  await expect(early.getByText(/到期日已经到了或过了/)).toBeVisible();
  await early.getByRole("button", { name: "取消" }).click();
  for (const document of JP_DOCUMENTS) await upload(tenantPage, document, expiresOn);
  await expectAccessible(tenantPage, "企业资质（资料交齐）");
  await tenantPage.getByRole("button", { name: "提交审核", exact: true }).click();
  await expect(toast(tenantPage, "已提交审核")).toBeVisible();
  await expect(tenantPage.locator(".page__meta")).toContainText("审核中");

  // ── 运营：审核队列、驳回一份 ──
  const admin = adminCredentials();
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAs(page, "platform", admin.email, admin.password);
  await page.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "资质审核" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "资质审核" })).toBeVisible();
  await expect(page.getByRole("link", { name: `去审核 ${invited.tenantName} 的 营运车辆商业保险` })).toBeVisible();
  await expectAccessible(page, "资质审核队列");
  await page.getByRole("link", { name: `去审核 ${invited.tenantName} 的 营运车辆商业保险` }).click();
  await expect(page.getByRole("heading", { level: 1, name: invited.tenantName })).toBeVisible();
  await page.getByRole("button", { name: "驳回 营运车辆商业保险" }).click();
  const reject = page.getByRole("dialog", { name: "驳回：营运车辆商业保险" });
  await reject.getByRole("button", { name: "驳回", exact: true }).click();
  await expect(reject.getByText("必填：供应商会看到这段文字")).toBeVisible();
  await reject.getByLabel(/驳回原因/).fill("保单上的车牌看不清，请重新扫描");
  await reject.getByRole("button", { name: "驳回", exact: true }).click();
  await expect(toast(page, "营运车辆商业保险：已驳回")).toBeVisible();
  await expect(page.locator(".page__meta")).toContainText("申请中");

  // ── 供应商：看到原因、重传、再提交 ──
  await tenantPage.reload();
  await expect(documents).toContainText("保单上的车牌看不清，请重新扫描");
  await expect(tenantPage.locator(".page__meta")).toContainText("申请中");
  await upload(tenantPage, "营运车辆商业保险", expiresOn, "重新上传");
  await tenantPage.getByRole("button", { name: "提交审核", exact: true }).click();
  await expect(toast(tenantPage, "已提交审核")).toBeVisible();

  // ── 运营：逐项通过、合同（另一位同事批准）、签约 ──
  await page.reload();
  for (const document of JP_DOCUMENTS) {
    await page.getByRole("button", { name: `通过 ${document}` }).click();
    const dialog = page.getByRole("dialog", { name: `通过：${document}` });
    await dialog.getByRole("button", { name: "通过", exact: true }).click();
    await expect(toast(page, `${document}：已通过`)).toBeVisible();
    await expect(dialog).toBeHidden();
  }
  const progressCard = page.getByRole("region", { name: "入驻进度" });
  await expect(progressCard).toContainText("签约前还缺：");
  await expect(progressCard).toContainText("还没有已生效的合同");
  await page.getByRole("button", { name: "发起新版本" }).click();
  const contract = page.getByRole("dialog", { name: "发起合同新版本" });
  await expect(contract.getByLabel("生效日期")).toHaveValue(today);
  await contract.getByLabel(/合同扫描件/).setInputFiles(pdf("合同"));
  await contract.getByRole("button", { name: "提交审核", exact: true }).click();
  await expect(toast(page, "已提交合同新版本，等另一位同事审核后写入")).toBeVisible();
  await approveApproval(request, await pendingApproval(request, invited.tenantId, "tenant.contract"));
  await page.reload();
  await expect(page.getByRole("region", { name: "合同版本" })).toContainText("第 1 版现在生效");
  await page.getByRole("button", { name: "签约", exact: true }).click();
  await page.getByRole("dialog", { name: `和「${invited.tenantName}」签约` }).getByRole("button", { name: "签约", exact: true }).click();
  await expect(toast(page, `「${invited.tenantName}」已签约`)).toBeVisible();
  await expect(page.locator(".page__meta")).toContainText("已签约");

  // ── 已签约：能建商品，不能上架；开始试运营后能上架 ──
  const productId = await publishableProduct(request, headers, world);
  const blocked = await request.post(`/tenant/v1/products/${productId}/publish`, { headers });
  expect(blocked.status()).toBe(409);
  expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe("TENANT_NOT_ONBOARDED");
  await page.reload();
  await page.getByRole("button", { name: "开始试运营", exact: true }).click();
  const trial = page.getByRole("dialog", { name: `「${invited.tenantName}」开始试运营` });
  await trial.getByRole("button", { name: "开始试运营", exact: true }).click();
  await expect(trial.getByText("必填")).toBeVisible();
  await trial.getByLabel(/测试单的情况/).fill("测试单已由运营跑通：接机、派车、完成");
  await trial.getByRole("button", { name: "开始试运营", exact: true }).click();
  await expect(toast(page, `「${invited.tenantName}」已开始试运营`)).toBeVisible();
  await expect(page.locator(".page__meta")).toContainText("试运营");
  expect((await request.post(`/tenant/v1/products/${productId}/publish`, { headers })).status()).toBe(200);
  // 状态变更记录：每一步都在
  const events = page.getByRole("region", { name: "状态变更记录" });
  for (const action of ["提交审核", "退回补充", "签约", "开始试运营"]) await expect(events).toContainText(action);
  await expect(events).toContainText("测试单已由运营跑通：接机、派车、完成");
  await expectAccessible(page, "供应商详情（入驻部分）");
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalOverflow(page, `供应商详情（${width}px）`);
  }

  // ── 供应商：试运营、履约评分（还没有评分）、状态记录里没有平台的说明 ──
  await tenantPage.reload();
  await expect(tenantPage.locator(".page__meta")).toContainText("试运营");
  await expect(tenantPage.getByRole("region", { name: "状态变更记录" })).not.toContainText("测试单已由运营跑通");
  await tenantPage.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "履约评分" }).click();
  await expect(tenantPage.getByRole("heading", { level: 1, name: "履约评分" })).toBeVisible();
  await expect(tenantPage.getByText(/还没有评分：每天会按最近 90 天的数据算一次/)).toBeVisible();
  await expectAccessible(tenantPage, "履约评分");
  await theirs.close();
});

for (const scheme of ["light", "dark"] as const) {
  test(`${scheme === "light" ? "亮色" : "暗色"}：企业资质的上传对话框、运营的驳回对话框通过 axe 检查；320px 不横向滚动`, async ({ browser, page, request }) => {
    test.setTimeout(120_000);
    const invited = await createTenant(request, { onboarding: "applying" });
    const password = newPassword();
    expect((await request.post("/tenant/v1/auth/accept-invite", { data: { token: invited.inviteToken, password } })).ok()).toBe(true);
    const theirs = await browser.newContext({ colorScheme: scheme });
    const tenantPage = await theirs.newPage();
    await loginAs(tenantPage, "tenant", invited.adminEmail, password);
    await tenantPage.goto("/company");
    await tenantPage.getByRole("button", { name: "上传 营运车辆商业保险" }).click();
    await expect(tenantPage.getByRole("dialog", { name: "上传：营运车辆商业保险" })).toBeVisible();
    await expectAccessible(tenantPage, `上传对话框（${scheme}）`);
    await tenantPage.setViewportSize({ width: 320, height: 800 });
    await expectNoHorizontalOverflow(tenantPage, "上传对话框（320px）");
    await tenantPage.getByRole("dialog").getByRole("button", { name: "取消" }).click();
    await expectNoHorizontalOverflow(tenantPage, "企业资质（320px）");
    await upload(tenantPage, "营运车辆商业保险", "2099-12-31");
    await theirs.close();

    await page.emulateMedia({ colorScheme: scheme });
    const admin = adminCredentials();
    await loginAs(page, "platform", admin.email, admin.password);
    await page.goto(`/platform/tenants/${invited.tenantId}`);
    await page.getByRole("button", { name: "要求补充 营运车辆商业保险" }).click();
    await expect(page.getByRole("dialog", { name: "要求补充：营运车辆商业保险" })).toBeVisible();
    await expectAccessible(page, `要求补充对话框（${scheme}）`);
    await page.setViewportSize({ width: 320, height: 800 });
    await expectNoHorizontalOverflow(page, "要求补充对话框（320px）");
  });
}
