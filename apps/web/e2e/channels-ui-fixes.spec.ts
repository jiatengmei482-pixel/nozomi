/**
 * 验收发现的渠道、复核界面小问题（M1-17），真实后端、真实 PostgreSQL：
 * 新建渠道的城市可以搜索、选上是标签；加价规则的城市只列渠道授权的；调高下限被拦时列出是哪几条规则；
 * 同一渠道已有待审核的定价改动时再发起先提醒；待审核每条的批准、驳回按钮读屏名字分得清；批准「暂停渠道」的说明讲暂停的后果。
 * 每个页面在 1280px 和 320px 下不横向滚动，亮暗两色各过一次 axe。
 */
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { createWorld, expectAccessible, toast } from "./catalog.ts";
import { expectNoHorizontalOverflow, loginAs, newPassword, platformAdminHeaders, uniqueEmail } from "./support.ts";

async function checkPage(page: Page, what: string): Promise<void> {
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await expectNoHorizontalOverflow(page, `${what}（${width}px）`);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expectAccessible(page, `${what}（${width}px，${scheme}）`);
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
}

async function createStaff(request: APIRequestContext, role: string, name: string): Promise<{ email: string; password: string; headers: Record<string, string> }> {
  const admin = await platformAdminHeaders(request);
  const email = uniqueEmail(`m117-${role}`);
  const created = await request.post("/platform/v1/staff", { headers: admin, data: { email, name, role } });
  expect(created.status(), await created.text()).toBe(201);
  const password = newPassword();
  const accepted = await request.post("/platform/v1/auth/accept-invite", { data: { token: ((await created.json()) as { invite: { token: string } }).invite.token, password } });
  expect(accepted.ok(), "接受邀请").toBe(true);
  const login = await request.post("/platform/v1/auth/login", { data: { email, password } });
  return { email, password, headers: { authorization: `Bearer ${((await login.json()) as { access_token: string }).access_token}` } };
}

async function pendingOf(request: APIRequestContext, headers: Record<string, string>, channelId: string): Promise<{ id: string; kind: string }[]> {
  const listed = await request.get(`/platform/v1/approvals?status=pending&resource_id=${channelId}`, { headers });
  expect(listed.status()).toBe(200);
  return ((await listed.json()) as { items: { id: string; kind: string }[] }).items;
}

test("渠道和复核：城市可搜索、规则只列授权城市、调高下限被拦列出规则、已有待审核时提醒、待审核按钮名字分得清、暂停的说明贴切", async ({ page, request }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const world = await createWorld(request);
  const other = await createWorld(request);
  const managerA = await createStaff(request, "channel_manager", "渠道经理甲");
  const managerB = await createStaff(request, "channel_manager", "渠道经理乙");
  const channelName = `M1-17 渠道 ${crypto.randomUUID().slice(0, 6)}`;

  // 新建渠道：只卖选中的城市，输入编码找到、Enter 选上，成了可以去掉的标签
  await loginAs(page, "platform", managerA.email, managerA.password);
  await page.goto("/platform/channels/new");
  await page.getByRole("textbox", { name: "名称" }).fill(channelName);
  await page.getByRole("radio", { name: /^自营/ }).check();
  await page.getByRole("radio", { name: "只卖选中的城市" }).check();
  const cityBox = page.getByRole("combobox", { name: /城市/ });
  await cityBox.click();
  await cityBox.fill(world.city.code);
  await expect(page.getByRole("listbox", { name: "城市" }).getByRole("option")).toHaveCount(1);
  await cityBox.press("Enter");
  await cityBox.fill(other.city.code);
  await cityBox.press("Enter");
  const chips = page.getByRole("list", { name: "已选的城市（2 个）" });
  await expect(chips.getByRole("listitem")).toHaveText([world.city.name, other.city.name]);
  await checkPage(page, "新建渠道（选了城市）");
  await chips.getByRole("button", { name: `去掉 ${other.city.name}` }).click();
  await expect(page.getByRole("list", { name: "已选的城市（1 个）" })).toBeVisible();
  await page.getByRole("group", { name: /^可卖的品类/ }).getByRole("checkbox", { name: "接送机" }).check();
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: channelName })).toBeVisible();
  const channelId = /\/platform\/channels\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? "";

  // 加价规则：城市只列渠道授权的那一个
  await page.getByRole("button", { name: /新增加价规则/ }).click();
  const ruleDialog = page.getByRole("dialog", { name: "新增加价规则" });
  await expect(ruleDialog.getByText("只列这个渠道授权卖的 1 个城市。", { exact: false })).toBeVisible();
  const ruleCity = ruleDialog.getByRole("combobox", { name: /城市/ });
  await ruleCity.click();
  const ruleCities = ruleDialog.getByRole("listbox", { name: "城市" }).getByRole("option");
  await expect(ruleCities).toHaveText([new RegExp(world.city.name)]);
  await ruleCity.fill(other.city.code);
  await expect(ruleCities).toHaveCount(0);
  await ruleCity.fill(world.city.code);
  await ruleCity.press("Enter");
  await expect(ruleCity).toHaveValue(world.city.name);
  await ruleDialog.getByRole("combobox", { name: "品类" }).selectOption("airport_transfer");
  await ruleDialog.getByRole("textbox", { name: "加价比例（%）" }).fill("12");
  await ruleDialog.getByRole("button", { name: "提交审核" }).click();
  await expect(toast(page, "已提交审核")).toBeVisible();
  const [ruleApproval] = await pendingOf(request, managerA.headers, channelId);
  const approved = await request.post(`/platform/v1/approvals/${ruleApproval?.id}/approve`, { headers: managerB.headers, data: { note: null } });
  expect(approved.status(), await approved.text()).toBe(200);
  await page.reload();
  await expect(page.locator('[aria-label="加价规则"]')).toContainText("12%");

  // 调高下限到 15%：被那条 12% 的规则挡住，对话框里列出它
  await page.getByRole("button", { name: "申请修改定价参数" }).click();
  let pricing = page.getByRole("dialog", { name: "申请修改定价参数" });
  await pricing.getByRole("textbox", { name: "加价下限（%）" }).fill("15");
  await pricing.getByRole("textbox", { name: "默认加价比例（%）" }).fill("15");
  await pricing.getByRole("button", { name: "提交审核" }).click();
  const blocked = pricing.locator(".alert--danger");
  await expect(blocked).toContainText("有 1 条还在用的加价规则低于新的下限 15%");
  await expect(blocked.getByRole("listitem")).toHaveText([`第 4 级 · ${world.city.name} · 接送机 = 12%（用车日期 不限）`]);
  await checkPage(page, "申请修改定价参数（被下限挡住）");

  // 改成只调默认加价：发起成功；再打开就提醒已有 1 条待审核的定价改动
  await pricing.getByRole("textbox", { name: "加价下限（%）" }).fill("10");
  await pricing.getByRole("textbox", { name: "默认加价比例（%）" }).fill("11");
  await pricing.getByRole("button", { name: "提交审核" }).click();
  await expect(toast(page, "已提交审核")).toBeVisible();
  await page.getByRole("button", { name: "申请修改定价参数" }).click();
  pricing = page.getByRole("dialog", { name: "申请修改定价参数" });
  const warning = pricing.locator(".alert--warning");
  await expect(warning).toContainText("这个渠道已经有 1 条待审核的定价改动：");
  await expect(warning).toContainText("渠道经理甲");
  await checkPage(page, "申请修改定价参数（已有待审核）");
  await pricing.getByRole("button", { name: "取消" }).click();

  // 再申请暂停
  await page.getByRole("button", { name: "申请暂停" }).click();
  const pause = page.getByRole("dialog", { name: /暂停/ });
  await pause.getByRole("button", { name: "提交审核" }).click();
  await expect(toast(page, "已提交审核")).toBeVisible();

  // 乙在待审核：每条的批准、驳回名字都带摘要，彼此不同；批准暂停的说明讲暂停的后果
  await page.getByRole("button", { name: /账号菜单/ }).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await loginAs(page, "platform", managerB.email, managerB.password);
  await page.goto("/platform/approvals");
  const cards = page.locator(".approval-card").filter({ hasText: channelName });
  await expect(cards).toHaveCount(2);
  const names = await cards.getByRole("button", { name: /^(批准|驳回)：/ }).evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label") ?? ""));
  expect(names).toHaveLength(4);
  expect(new Set(names).size, names.join(" / ")).toBe(4);
  await checkPage(page, "待审核");
  await cards.filter({ hasText: "暂停渠道" }).getByRole("button", { name: /^批准：/ }).click();
  const decide = page.getByRole("dialog", { name: "批准：暂停渠道" });
  await expect(decide).toContainText("批准后渠道立即暂停：它调用销售端接口（询价等）一律被拒绝");
  await expect(decide).not.toContainText("按新的规则算");
  await decide.getByRole("button", { name: "取消" }).click();
});
