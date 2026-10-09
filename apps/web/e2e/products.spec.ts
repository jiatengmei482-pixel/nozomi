/**
 * 供应商后台「商品」（M1-03），真实后端、真实 PostgreSQL。
 * 城市、机场、车型组、附加服务经平台接口新建（都是启用的）；供应商和账号经真实的邀请流程创建；
 * 子品牌、商品、服务规则、商品详情都经界面填出来。并行的用例共用一个库，所以每条用自己的城市和随机编码。
 */
import { expect, test } from "@playwright/test";
import { checkItem, choose, createArea, createBrand, createProductByApi, createSupplier, createTenantUser, createWorld, expectAccessible, fillLocked, pick, productIdOf, step, tenantHeaders, toast } from "./catalog.ts";
import { createActiveTenant, expectNoHorizontalOverflow, loginAs, newPassword, platformAdminHeaders, randomLetters, snapshot, uniqueEmail } from "./support.ts";


test("没有子品牌时的引导 → 建子品牌 → 新建接送机商品 → 基础信息、服务规则、商品详情分别保存（中途离开再回来）→ 上架检查说明只差价格→ 列表 → 删除草稿", async ({ page, request }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const world = await createWorld(request);
  const tenant = await createActiveTenant(request);
  const headers = await tenantHeaders(request, tenant.adminEmail, tenant.password);
  const area = await createArea(request, headers, world.city, `市区 ${randomLetters(4)}`);
  const second = await createArea(request, headers, world.city, `机场周边 ${randomLetters(4)}`, "airport_transfer");
  await createArea(request, headers, world.city, `包车专用 ${randomLetters(4)}`, "charter");
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);

  // 首页：有区域、没有商品 → 提醒先建一个商品
  const card = page.locator(".entry-card").filter({ hasText: "商品" });
  await expect(card).toContainText("已上架0");
  await page.getByRole("link", { name: "还没有商品，先建一个" }).click();
  await expect(page).toHaveURL(/\/products\/new$/);
  await expect(page.getByRole("heading", { level: 1, name: "新建商品" })).toBeVisible();
  await expect(step(page, "库存")).toContainText("先保存第 1 步");
  await expect(step(page, "价格规则")).toContainText("先保存第 1 步");
  await expect(step(page, "服务规则")).toContainText("先保存第 1 步");
  await expect(page.getByRole("navigation", { name: "配置步骤" }).getByRole("link")).toHaveCount(0);

  // 还没有子品牌：不能保存，管理员可以当场建
  await expect(page.getByText("还没有子品牌。")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存草稿" })).toBeDisabled();
  await page.getByRole("button", { name: "新建子品牌" }).click();
  const dialog = page.getByRole("dialog", { name: "新建子品牌" });
  await expect(dialog).toContainText("币种创建后不能修改。");
  await dialog.getByRole("button", { name: "新建", exact: true }).click();
  await expect(dialog.getByText("请填写名称")).toBeVisible();
  const brandName = `自营车队 ${randomLetters(4)}`;
  await dialog.getByLabel(/名称/).fill(brandName);
  await dialog.getByLabel(/结算币种/).selectOption("JPY");
  await dialog.getByRole("button", { name: "新建", exact: true }).click();
  await expect(toast(page, `已新建子品牌「${brandName}」`)).toBeVisible();
  await expect(page.getByText(`${brandName}（JPY）`)).toBeVisible();

  // 创建后不能改的几项没填齐就保存：按必填报错
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page.getByText("有 2 处需要修改")).toBeVisible();
  await fillLocked(page, world, "接送机");
  await expect(page.getByText("这四项创建后不能修改。")).toBeVisible();

  // 服务区域：只列这个城市、适用于接送机的启用中的区域；顺序可以调
  await page.getByRole("button", { name: "添加区域", exact: true }).click();
  const areaPanel = page.getByRole("group", { name: "添加区域" });
  await expect(areaPanel.getByRole("checkbox")).toHaveCount(2);
  await areaPanel.getByRole("checkbox", { name: new RegExp(area.name) }).check();
  await areaPanel.getByRole("checkbox", { name: new RegExp(second.name) }).check();
  await areaPanel.getByRole("button", { name: "完成" }).click();
  await expect(page.locator("[data-area-pick]")).toHaveCount(2);
  await page.getByRole("button", { name: `把 ${second.name} 上移` }).click();
  await expect(page.locator("[data-area-pick]").first()).toContainText(second.name);
  await expect(page.getByRole("button", { name: `把 ${second.name} 下移` })).toBeFocused();

  // 车型组：没选「人数 / 行李数」不能保存
  await pick(page, "添加车型组", world.group.code);
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page.getByText(`车型组：请给「${world.group.name}」选一个「人数 / 行李数」组合`)).toBeVisible();
  await page.getByLabel(`${world.group.name} 的人数 / 行李数`).selectOption({ label: "6 人 4 件" });
  await page.getByLabel("第 1 个调度人的姓名").fill("山田");
  await page.getByLabel("第 1 个调度人的电话").fill("abc");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page.getByText(/第 1 个调度人的电话只能是数字/).first()).toBeVisible();
  await page.getByLabel("第 1 个调度人的电话").fill("+81 90 1234 5678");

  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(toast(page, "已创建商品，现在是草稿")).toBeVisible();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}\/basic$/);
  const productId = productIdOf(page);
  await expect(page.getByRole("heading", { level: 1, name: "未命名的接送机商品" })).toBeVisible();
  await expect(page.getByText("这个商品还没有名字。")).toBeVisible();
  await expect(step(page, "基础信息")).toContainText("已完成");
  await expect(step(page, "服务规则")).toContainText(/还差 \d 项/);
  await expect(page.getByText("这几项创建后不能修改。要换，请新建一个商品。")).toBeVisible();
  await expect(page.locator("[data-area-pick]").first()).toContainText(second.name);
  await snapshot(page, "products-basic-desktop");

  // ② 服务规则：时间按城市当地时间；跨午夜、加急阶梯的话读回来
  await page.getByRole("button", { name: "保存并下一步" }).click();
  await expect(page).toHaveURL(/\/service-rules$/);
  await expect(page.getByRole("heading", { level: 2, name: "② 服务规则" })).toBeFocused();
  await expect(page.getByText(/Asia\/Tokyo（UTC\+9）/)).toBeVisible();
  await expect(page.getByLabel("接机免费等待的分钟数")).toHaveValue("60");
  await page.getByLabel("服务时间从").fill("6");
  await page.getByLabel("服务时间到").fill("0100");
  await page.getByLabel("服务时间到").blur();
  await expect(page.getByLabel("服务时间从")).toHaveValue("06:00");
  await expect(page.getByText("每天 06:00–次日 01:00，共 19 小时（跨午夜）")).toBeVisible();
  await page.getByLabel("提前预订时长（小时）").fill("24");
  await page.getByRole("checkbox", { name: "允许加急预订" }).check();
  await page.getByLabel("第 1 档：提前不足多少小时").fill("6");
  await page.getByLabel("第 1 档：加收的金额").fill("5000");
  await expect(page.getByText("提前不足 6 小时下单：加收 JPY 5,000")).toBeVisible();
  await expect(page.locator(".readback__gap")).toContainText("提前 6 到 24 小时下单：不接");
  await page.getByRole("checkbox", { name: "收夜间加价" }).check();
  await expect(page.getByRole("radio", { name: /^按次/ })).toBeChecked();
  await page.getByLabel("夜间时段从").fill("22:00");
  await page.getByLabel("夜间时段到").fill("5");
  await page.getByLabel("夜间加价的金额").fill("1.5");
  await page.getByRole("checkbox", { name: new RegExp(world.seat.name) }).check();
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page.getByText("有 2 处需要修改")).toBeVisible();
  await expect(page.getByText("JPY没有小数，请填整数").first()).toBeVisible();
  await expect(page.getByText("请填单价，免费提供请填 0").first()).toBeVisible();
  await page.getByLabel("夜间加价的金额").fill("2000");
  await page.getByLabel(`${world.seat.name}的单价`).fill("1000");
  await page.getByRole("checkbox", { name: /第一个免费/ }).check();
  await page.getByRole("button", { name: "添加语言" }).click();
  await page.getByLabel("第 1 行：语言").selectOption({ label: "中文" });
  await page.getByLabel("第 1 行：单价").fill("0");
  await snapshot(page, "products-rules-desktop");

  // 有未保存的修改时换步骤：先问；选「保存并继续」
  await step(page, "商品详情").click();
  const leave = page.getByRole("dialog", { name: "这一步有未保存的修改" });
  await expect(leave).toBeVisible();
  await leave.getByRole("button", { name: "继续编辑" }).click();
  await expect(page).toHaveURL(/\/service-rules$/);
  await step(page, "商品详情").click();
  await leave.getByRole("button", { name: "保存并继续" }).click();
  await expect(toast(page, "已保存")).toBeVisible();
  await expect(page).toHaveURL(/\/content$/);
  await expect(step(page, "服务规则")).toContainText("已完成");

  // ⑤ 商品详情：先只填标题，离开再回来
  await page.getByLabel("标题").fill("羽田机场接送");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(toast(page, "已保存").last()).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "羽田机场接送" })).toBeVisible();
  await expect(step(page, "商品详情")).toContainText("还差 1 项");
  await page.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "商品" }).click();
  const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: "羽田机场接送", exact: true }) });
  await expect(row).toContainText("草稿");
  await expect(row).toContainText("接送机");
  await expect(row).toContainText(world.city.name);
  await expect(row).toContainText(world.airport.name);
  await expect(row.getByRole("link", { name: /的上架检查：还差 2 项/ })).toBeVisible();

  // 回来：/products/{id} 换到第一个还没完成的步骤；服务规则存的都在
  await row.getByRole("link", { name: "羽田机场接送", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/products/${productId}/prices$`));
  await step(page, "服务规则").click();
  await expect(page.getByLabel("服务时间到")).toHaveValue("01:00");
  await expect(page.getByLabel("第 1 档：加收的金额")).toHaveValue("5000");
  await expect(page.getByLabel("夜间时段到")).toHaveValue("05:00");
  await expect(page.getByLabel(`${world.seat.name}的单价`)).toHaveValue("1000");
  await expect(page.getByRole("checkbox", { name: /第一个免费/ })).toBeChecked();
  await expect(page.getByLabel("第 1 行：语言")).toHaveValue("zh");

  // 上架检查：还差接机指引；「去填」直接落在那个输入框上
  await step(page, "上架检查").click();
  await expect(page.getByRole("heading", { level: 2, name: "上架检查" })).toBeVisible();
  await expect(page.getByText("还不能上架：还有 2 项要补", { exact: true })).toBeVisible();
  await expect(checkItem(page, "basic_info")).toContainText("已满足");
  await expect(checkItem(page, "service_rules")).toContainText("已满足");
  await expect(checkItem(page, "content")).toContainText("中文还没有填接机指引");
  await expect(checkItem(page, "price_rules")).toContainText("还没有设价格（至少要有 1 条启用、没过期的价格）");
  await expect(checkItem(page, "inventory")).toContainText("不是必须");
  await expect(page.getByRole("button", { name: "上架", exact: true })).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("link", { name: "去填：中文还没有填接机指引" }).click();
  await expect(page.getByLabel(/接机指引/)).toBeFocused();
  await expect(page.getByText("上架前要填这一项。")).toBeVisible();
  await page.getByLabel(/接机指引/).fill("到达大厅 2 号出口，司机举 NOZOMI 的牌子。");
  await page.getByRole("button", { name: "添加一条" }).first().click();
  await page.getByRole("textbox", { name: "中文包含第 1 条" }).fill("高速费");
  await page.getByRole("button", { name: "保存并看上架检查" }).click();
  await expect(page).toHaveURL(/\/publish$/);

  // 只差价格：说的是真实的原因（价格的整条流程在 prices.spec.ts）
  await expect(page.getByText("还不能上架：还有 1 项要补", { exact: true })).toBeVisible();
  await expect(checkItem(page, "price_rules")).toContainText("还没有设价格");
  await expect(page.getByText(/失败|未通过/)).toHaveCount(0);
  await expect(step(page, "上架检查")).toContainText("还差 1 项");
  await expect(page.getByText("已完成 4 / 5")).toBeVisible();
  await expect(page.getByRole("button", { name: "上架", exact: true })).toHaveAttribute("aria-disabled", "true");
  // 禁用的「上架」键盘到得了、读得到原因，点了不做任何事
  await page.getByRole("button", { name: "上架", exact: true }).click({ force: true });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const published = await request.post(`/tenant/v1/products/${productId}/publish`, { headers });
  expect(published.status(), "后端：没有价格不能上架").toBe(409);
  expect(((await published.json()) as { error: { code: string } }).error.code).toBe("PUBLISH_CHECK_FAILED");
  await expectNoHorizontalOverflow(page, "上架检查");
  await snapshot(page, "products-publish-desktop");

  // 区域被商品选了：区域列表上看得到
  await page.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "区域" }).click();
  await expect(page.getByRole("row").filter({ hasText: area.name })).toContainText("1 个商品在用");

  // 列表：按品类筛、搜编号；删除草稿
  await page.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "商品" }).click();
  await expect(row.getByRole("link", { name: /的上架检查：还差 1 项/ })).toBeVisible();
  await row.getByRole("button", { name: "羽田机场接送 的更多操作" }).click();
  await page.getByRole("menuitem", { name: "删除" }).click();
  const remove = page.getByRole("dialog", { name: "删除草稿「羽田机场接送」？" });
  await expect(remove).toContainText("删除后不能恢复");
  await remove.getByRole("button", { name: "删除", exact: true }).click();
  await expect(toast(page, "已删除草稿「羽田机场接送」")).toBeVisible();
  await expect(page.getByRole("link", { name: "羽田机场接送", exact: true })).toHaveCount(0);
  expect((await request.get(`/tenant/v1/products/${productId}`, { headers })).status()).toBe(404);
});

test("包车和点对点：没有接送点；各自的服务规则只显示该有的项，夜间加价的默认计费方式不同", async ({ page, request }) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 800 });
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);

  for (const [category, unit] of [
    ["包车", "按小时"],
    ["点对点", "按次"],
  ] as const) {
    await page.goto("/products/new");
    await expect(page.getByText(`${supplier.brand.name}（JPY）`)).toBeVisible();
    await fillLocked(page, world, category);
    await expect(page.getByText("这三项创建后不能修改。")).toBeVisible();
    await expect(page.getByRole("combobox", { name: /接送点/ })).toHaveCount(0);
    await pick(page, "添加区域", supplier.area.name);
    await pick(page, "添加车型组", world.group.code);
    await page.getByLabel(`${world.group.name} 的人数 / 行李数`).selectOption({ label: "5 人 5 件" });
    await page.getByRole("button", { name: "保存并下一步" }).click();
    await expect(page).toHaveURL(/\/service-rules$/);
    await expect(page.getByRole("heading", { level: 1, name: `未命名的${category}商品` })).toBeVisible();
    await expect(step(page, "基础信息")).toContainText("还差 1 项");
    await expect(page.getByLabel("上车点免费等待的分钟数")).toHaveValue(category === "包车" ? "0" : "15");
    await expect(page.getByLabel("接机免费等待的分钟数")).toHaveCount(0);
    await page.getByRole("checkbox", { name: "收夜间加价" }).check();
    await expect(page.getByRole("radio", { name: new RegExp(`^${unit}`) })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: new RegExp(world.seat.name) })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: new RegExp(world.sign.name) })).toHaveCount(0);
    if (category === "包车") await expect(page.getByText("包车的超时费、超公里费在「价格规则」里设置。")).toBeVisible();
    // 免费等待是替用户填好的：没动过也能点保存存下来
    await page.getByRole("checkbox", { name: "收夜间加价" }).uncheck();
    await page.getByRole("button", { name: "保存草稿" }).click();
    await expect(toast(page, "已保存")).toBeVisible();
    await step(page, "商品详情").click();
    await expect(page.getByLabel(/接机指引/)).toHaveCount(0);
    await expect(page.getByLabel(/行程路线/)).toHaveCount(category === "包车" ? 1 : 0);
  }
});

test("别人先改了：说明、停用保存；载入最新内容后可以再保存", async ({ page, request }) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 800 });
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  const product = await createProductByApi(request, supplier, world, "charter");
  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);
  await page.goto(`/products/${product.id}/basic`);
  await expect(page.getByLabel("第 1 个调度人的姓名")).toHaveValue("山田");

  // 别人在另一步保存了一次（整个商品只有一个版本号）
  const other = await request.put(`/tenant/v1/products/${product.id}/content`, { headers: { ...supplier.headers, "if-match": `"${product.version}"` }, data: { zh: { title: "别人起的名字" } } });
  expect(other.status(), "接口保存商品详情").toBe(200);
  await page.getByLabel("第 1 个调度人的姓名").fill("佐藤");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page.getByText("这个商品刚被别人修改过，你在这一步的修改还没有保存。")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存草稿" })).toBeDisabled();
  await expect(page.getByLabel("第 1 个调度人的姓名")).toHaveValue("佐藤");
  await page.getByRole("button", { name: "载入最新内容" }).click();
  await expect(page.getByText("已载入最新内容。")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "别人起的名字" })).toBeVisible();
  await expect(page.getByLabel("第 1 个调度人的姓名")).toHaveValue("山田");
  await page.getByLabel("第 1 个调度人的姓名").fill("佐藤");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(toast(page, "已保存")).toBeVisible();
  const saved = (await (await request.get(`/tenant/v1/products/${product.id}`, { headers: supplier.headers })).json()) as { dispatchers: { name: string }[] };
  expect(saved.dispatchers[0]?.name).toBe("佐藤");
});

test("只读角色能看不能改；商品价格角色没有子品牌时请管理员建；另一个供应商看不到这个供应商的商品和子品牌", async ({ page, request, browser }) => {
  test.slow();
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  const product = await createProductByApi(request, supplier, world, "airport_transfer");
  const viewer = await createTenantUser(request, supplier.tenant, "readonly");

  await loginAs(page, "tenant", viewer.email, viewer.password);
  await page.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "商品" }).click();
  await expect(page.getByRole("link", { name: "新建商品" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /更多操作/ })).toHaveCount(0);
  await page.getByRole("link", { name: "未命名的接送机商品", exact: true }).click();
  await expect(page.getByText("你可以查看商品，但不能修改。")).toBeVisible();
  await expect(page).toHaveURL(/\/service-rules$/);
  await expect(page.getByRole("button", { name: /保存/ })).toHaveCount(0);
  await expect(page.getByLabel("服务时间从")).not.toBeEditable();
  await step(page, "基础信息").click();
  await expect(page.getByRole("button", { name: "添加区域" })).toHaveCount(0);
  await expect(page.locator("[data-area-pick]")).toContainText(supplier.area.name);
  await step(page, "上架检查").click();
  await expect(page.getByRole("button", { name: "上架", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^去查看/ }).first()).toBeVisible();
  await page.goto("/products/new");
  await expect(page.getByText("你没有权限查看这里")).toBeVisible();

  // 另一个供应商：列表是空的、打不开这个商品、也没有这个子品牌
  const other = await createActiveTenant(request);
  const pricing = await createTenantUser(request, other, "pricing");
  const context = await browser.newContext();
  const otherPage = await context.newPage();
  try {
    await loginAs(otherPage, "tenant", pricing.email, pricing.password);
    await otherPage.goto("/products");
    await expect(otherPage.getByText("先建区域，再建商品")).toBeVisible();
    await expect(otherPage.getByRole("link", { name: "未命名的接送机商品" })).toHaveCount(0);
    await otherPage.goto(`/products/${product.id}/basic`);
    await expect(otherPage.getByText("找不到这个商品")).toBeVisible();
    await otherPage.goto("/products/new");
    await expect(otherPage.getByText("还没有子品牌，暂时不能新建商品。")).toBeVisible();
    await expect(otherPage.getByText(supplier.brand.name)).toHaveCount(0);
    await expect(otherPage.getByRole("button", { name: "新建子品牌" })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("没有可选区域时的引导：去新增区域（带着城市和业务类型）→ 建好回来「重新读取」就能选", async ({ page, request }) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 800 });
  const world = await createWorld(request);
  const tenant = await createActiveTenant(request);
  const headers = await tenantHeaders(request, tenant.adminEmail, tenant.password);
  await createBrand(request, headers, `品牌 ${randomLetters(4)}`, "USD");
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  await page.goto("/products");
  await expect(page.getByText("先建区域，再建商品")).toBeVisible();
  await page.getByRole("link", { name: "新建商品" }).click();
  await expect(page.getByText("先选城市和品类，这里会列出可以用的区域。")).toBeVisible();
  await fillLocked(page, world, "包车");
  await expect(page.getByText("你们还没有区域。")).toBeVisible();
  const link = page.getByRole("link", { name: "新增区域" });
  await expect(link).toHaveAttribute("href", `/areas/new?city=${world.city.id}&biz=charter`);

  const area = await createArea(request, headers, world.city, `包车区域 ${randomLetters(4)}`, "charter");
  await page.getByRole("button", { name: "重新读取" }).click();
  await pick(page, "添加区域", area.name);
  await expect(page.locator("[data-area-pick]")).toContainText(area.name);
  // 没选车型组、没填调度人也能先存成草稿
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(toast(page, "已创建商品，现在是草稿")).toBeVisible();
  await expect(step(page, "基础信息")).toContainText("还差 2 项");
  // 币种跟着子品牌：USD 可以有两位小数
  await step(page, "服务规则").click();
  await expect(page.locator(".step .alert--info").first()).toContainText("币种 USD");

  // 区域新增页按参数预先选好城市和业务类型；预先选上的不算「有未保存的修改」
  await page.goto(`/areas/new?city=${world.city.id}&biz=airport_transfer`);
  await expect(page.getByRole("combobox", { name: /城市/ })).toHaveValue(world.city.name);
  await expect(page.getByRole("radio", { name: /^接送机/ })).toBeChecked();
  await page.getByRole("button", { name: "取消" }).click();
  await expect(page).toHaveURL(/\/areas$/);
});

for (const scheme of ["light", "dark"] as const) {
  test(`${scheme === "light" ? "亮色" : "暗色"}：商品列表、三个步骤、上架检查通过 axe 检查；320px 宽都不横向滚动`, async ({ page, request }) => {
    test.setTimeout(150_000);
    await page.emulateMedia({ colorScheme: scheme });
    const world = await createWorld(request);
    const supplier = await createSupplier(request, world);
    const product = await createProductByApi(request, supplier, world, "airport_transfer");
    await request.put(`/tenant/v1/products/${product.id}/content`, { headers: { ...supplier.headers, "if-match": `"${product.version}"` }, data: { zh: { title: `${"很长的标题".repeat(18)}结尾`, includes: ["高速费"] } } });
    await createProductByApi(request, supplier, world, "charter", false);
    await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);

    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: width === 1280 ? 800 : 640 });
      const wide = width === 1280;
      const check = async (what: string): Promise<void> => {
        await expectNoHorizontalOverflow(page, `${what}（${width}px）`);
        if (wide || scheme === "light") await expectAccessible(page, `${what}（${width}px）`);
        await snapshot(page, `products-${what}-${width}-${scheme}`);
      };
      await page.goto("/products");
      await expect(page.getByRole("link", { name: "未命名的包车商品", exact: true })).toBeVisible();
      await check("list");

      await page.goto(`/products/${product.id}/basic`);
      await expect(page.locator("[data-area-pick]")).toHaveCount(1);
      if (!wide) {
        // 窄屏：步骤导航收成一个按钮，点开在原地展开
        const toggle = page.getByRole("button", { name: /第 1 步，共 5 步 · 基础信息/ });
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
        await toggle.click();
        await expect(step(page, "价格规则")).toBeVisible();
        await expectNoHorizontalOverflow(page, "步骤导航展开（320px）");
        await toggle.click();
      }
      await page.getByRole("button", { name: "添加车型组", exact: true }).click();
      await check("basic");
      await page.getByRole("group", { name: "添加车型组" }).getByRole("button", { name: "完成" }).click();

      await page.goto(`/products/${product.id}/service-rules`);
      await page.getByLabel("服务时间从").fill("22:00");
      await page.getByLabel("服务时间到").fill("06:00");
      await page.getByLabel("提前预订时长（小时）").fill("48");
      await page.getByRole("checkbox", { name: "允许加急预订" }).check();
      await page.getByLabel("第 1 档：提前不足多少小时").fill("12");
      await page.getByLabel("第 1 档：加收的金额").fill("3000");
      await page.getByRole("checkbox", { name: "收夜间加价" }).check();
      await page.getByRole("checkbox", { name: new RegExp(world.seat.name) }).check();
      await page.getByRole("button", { name: "添加语言" }).click();
      await page.getByRole("button", { name: /保存草稿|保存$/ }).first().click();
      await expect(page.getByText(/有 \d 处需要修改/)).toBeVisible();
      await check("rules");

      await page.goto(`/products/${product.id}/content`);
      await expect(page.getByRole("textbox", { name: "标题" })).toBeVisible();
      await check("content");

      await page.goto(`/products/${product.id}/publish`);
      await expect(checkItem(page, "price_rules")).toContainText("还没有设价格");
      await check("publish");
    }
  });
}
