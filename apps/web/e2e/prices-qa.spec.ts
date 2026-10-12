/**
 * M1-04 验收测试（测试工程师）：真实浏览器 → 真实后端 → 真实 PostgreSQL。补开发的 prices.spec.ts 没有覆盖的：
 * - 规则名称、商品标题里的 HTML / 脚本在价格相关的每个页面上都只是文字（XSS）；
 * - 月历上每一天的结算价和后端 price-calendar 逐日一致（含取整单位、每周几、指定日期、跨午夜时段，换用车时间再比一遍）；
 * - 价格表里的金额输入：全角数字、千分位、粘贴带货币符号、小数、负数、超大数，存进去的是敲的那个数；
 * - 768px 宽（平板）亮色 / 暗色下各页不横向滚动、通过 axe。
 * 测试数据都经接口现造，每个用例自己的供应商，互不依赖。
 */
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { type Supplier, type World, createProductByApi, createSupplier, createWorld, expectAccessible, toast } from "./catalog.ts";
import { expectNoHorizontalOverflow, loginAs } from "./support.ts";

const RULES = {
  booking: { sale_from: null, sale_to: null, service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 0, note: null },
  urgent: { enabled: false, daily_quota: null, tiers: [] },
  night: { enabled: false, window: null, amount: null, charge_unit: null },
  addons: [],
  driver_languages: [],
};

async function readyProduct(request: APIRequestContext, supplier: Supplier, world: World, title: string): Promise<{ id: string }> {
  const product = await createProductByApi(request, supplier, world, "airport_transfer");
  const wait = { mode: "limited", minutes: 60 };
  const rules = await request.put(`/tenant/v1/products/${product.id}/service-rules`, { headers: { ...supplier.headers, "if-match": `"${product.version}"` }, data: { ...RULES, free_wait: { pickup: wait, dropoff: wait, general: null } } });
  expect(rules.status(), `保存服务规则：${await rules.text()}`).toBe(200);
  const content = await request.put(`/tenant/v1/products/${product.id}/content`, { headers: { ...supplier.headers, "if-match": `"${((await rules.json()) as { version: number }).version}"` }, data: { zh: { title, pickup_guide: "到达大厅 2 号出口" } } });
  expect(content.status(), `保存商品详情：${await content.text()}`).toBe(200);
  return { id: product.id };
}

interface PriceView {
  version: number;
  today: string;
  rounding_unit: number;
  items: { id: string; base_price: number | null; direction: string | null; valid_from: string; valid_to: string | null }[];
}

async function priceView(request: APIRequestContext, supplier: Supplier, productId: string): Promise<PriceView> {
  return (await (await request.get(`/tenant/v1/products/${productId}/price-rules`, { headers: supplier.headers })).json()) as PriceView;
}

async function addPrice(request: APIRequestContext, supplier: Supplier, world: World, productId: string, amount: number, validFrom: string, direction = "both"): Promise<void> {
  const response = await request.post(`/tenant/v1/products/${productId}/price-rules`, {
    headers: { ...supplier.headers, "if-match": `"${(await priceView(request, supplier, productId)).version}"`, "idempotency-key": crypto.randomUUID() },
    data: { area_id: supplier.area.id, vehicle_group_id: world.group.id, direction, pricing_model: "fixed", base_price: amount, valid_from: validFrom },
  });
  expect(response.status(), `接口新建价格：${await response.text()}`).toBe(201);
}

async function addAdjust(request: APIRequestContext, supplier: Supplier, productId: string, data: Record<string, unknown>): Promise<string> {
  const response = await request.post(`/tenant/v1/products/${productId}/adjust-rules`, {
    headers: { ...supplier.headers, "if-match": `"${(await priceView(request, supplier, productId)).version}"`, "idempotency-key": crypto.randomUUID() },
    data: { cycle: { type: "daily" }, ...data },
  });
  expect(response.status(), `接口新建调价规则：${await response.text()}`).toBe(201);
  return ((await response.json()) as { adjust_rule: { id: string } }).adjust_rule.id;
}

const money = (minor: number): string => `JPY ${String(minor).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

test("XSS：调价规则名称和商品标题里的 HTML、脚本，在价格规则、调价规则列表和表单、价格日历、上架检查、价格规则总览上都只是文字，不执行", async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  const title = '<script>window.__xss=1</script><b>粗体</b>';
  const ruleName = '<img src=x onerror="window.__xss=1">';
  const second = '"><svg onload=window.__xss=1>';
  const product = await readyProduct(request, supplier, world, title);
  const info = await priceView(request, supplier, product.id);
  await addPrice(request, supplier, world, product.id, 20_000, `${info.today.slice(0, 8)}01`);
  const ruleId = await addAdjust(request, supplier, product.id, { name: ruleName, steps: [{ type: "percent", value: 2_000 }] });
  await addAdjust(request, supplier, product.id, { name: second, steps: [{ type: "amount", value: 500 }] });
  // 一条会把价格调到不大于 0 的（先停用着存，再把价格降下来让它成立），上架检查里会写出它的名字
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  const safe = async (what: string): Promise<void> => {
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss), `${what}：脚本被执行了`).toBeUndefined();
    expect(await page.locator('img[src="x"], svg[onload], main script, b:text-is("粗体")').count(), `${what}：名称被当成 HTML 插进了页面`).toBe(0);
    expect(dialogs, what).toEqual([]);
  };
  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);

  await page.goto(`/products/${product.id}/prices`);
  await expect(page.getByLabel(/的基础价$/).first()).toBeVisible();
  await expect(page.locator("body")).toContainText(title);
  await safe("价格规则");

  await page.goto(`/products/${product.id}/prices/adjust`);
  await expect(page.getByText(ruleName, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(second, { exact: true }).first()).toBeVisible();
  await safe("调价规则列表");

  await page.goto(`/products/${product.id}/prices/adjust/${ruleId}`);
  await expect(page.getByRole("textbox", { name: "名称", exact: true })).toHaveValue(ruleName);
  await safe("调价规则表单");

  await page.goto(`/products/${product.id}/prices/calendar`);
  await expect(page.getByRole("grid")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(`#calendar-day-${info.today}`)).toHaveAttribute("aria-label", new RegExp(`命中${ruleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}等 2 条规则`));
  await expect(page.locator(".calendar-layout > .calendar-detail")).toContainText(ruleName);
  await expect(page.locator(".calendar-layout > .calendar-detail")).toContainText(second);
  await safe("价格日历");

  await page.goto("/price-rules");
  await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();
  await safe("价格规则总览");

  await page.goto(`/products/${product.id}`);
  await expect(page.locator("body")).toContainText(title);
  await safe("商品详情（上架检查）");
  await page.goto("/");
  await safe("首页");
});

test("月历上每一天的结算价和后端 price-calendar 逐日一致：取整单位 100、每周五六上调 12.5%、指定两天下调 3,333、每天 22:00–06:00 夜间加 1,050；用车时间 10:00 和 23:30 各比一遍", async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  const product = await readyProduct(request, supplier, world, "逐日核对的商品");
  const info = await priceView(request, supplier, product.id);
  const month = info.today.slice(0, 7);
  await addPrice(request, supplier, world, product.id, 20_050, `${month}-01`, "both");
  // 月中起另有一条只管接机的价（具体方向优先于接送通用）
  await addPrice(request, supplier, world, product.id, 23_349, `${month}-15`, "pickup");
  const brands = (await (await request.get("/tenant/v1/brands", { headers: supplier.headers })).json()) as { items: { id: string; version: number }[] };
  const brand = brands.items.find((item) => item.id === supplier.brand.id) as { id: string; version: number };
  const rounding = await request.put(`/tenant/v1/brands/${brand.id}/rounding-unit`, { headers: { ...supplier.headers, "if-match": `"${brand.version}"` }, data: { rounding_unit: 100 } });
  expect(rounding.status(), await rounding.text()).toBe(200);
  await addAdjust(request, supplier, product.id, { name: "周末", cycle: { type: "weekly", weekdays: [5, 6] }, steps: [{ type: "percent", value: 1_250 }] });
  await addAdjust(request, supplier, product.id, { name: "指定两天", cycle: { type: "dates", dates: [`${month}-03`, `${month}-17`] }, steps: [{ type: "amount", value: -3_333 }] });
  await addAdjust(request, supplier, product.id, { name: "夜间", time_slot: { start: "22:00", end: "06:00" }, steps: [{ type: "amount", value: 1_050 }] });

  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const query = `area_id=${supplier.area.id}&vehicle_group_id=${world.group.id}&direction=pickup&from=${month}-01&to=${month}-${String(lastDay).padStart(2, "0")}`;
  const backend = (await (await request.get(`/tenant/v1/products/${product.id}/price-calendar?${query}`, { headers: supplier.headers })).json()) as { days: { date: string; segments: { from: string; to: string; final: number | null; adjusts: { name: string }[] }[] }[] };
  expect(backend.days.length).toBe(lastDay);
  const at = (day: (typeof backend.days)[number], time: string) => day.segments.find((segment) => segment.from <= time && (segment.to === "24:00" || time < segment.to)) as (typeof day.segments)[number];
  // 例子本身要有意思：这个月里结算价至少有 4 种，而且夜里和白天不一样
  expect(new Set(backend.days.map((day) => at(day, "10:00").final)).size).toBeGreaterThanOrEqual(4);
  expect(backend.days.every((day) => day.segments.length === 3)).toBe(true);

  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);
  await page.goto(`/products/${product.id}/prices/calendar`);
  await expect(page.getByRole("grid")).toHaveAttribute("aria-busy", "false");
  const compare = async (time: string): Promise<void> => {
    for (const day of backend.days) {
      const segment = at(day, time);
      const cell = page.locator(`#calendar-day-${day.date}`);
      await expect(cell, `${day.date} ${time}`).toHaveAttribute("aria-label", new RegExp(`结算价 ${money(segment.final as number)}(，|$)`));
      await expect(cell, `${day.date} ${time} 格子上写的数`).toContainText(String(segment.final).replace(/\B(?=(\d{3})+(?!\d))/g, ","));
      if (segment.adjusts.length > 0) await expect(cell).toHaveAttribute("aria-label", new RegExp(`命中${segment.adjusts[0]?.name}`));
      await expect(cell).toHaveAttribute("aria-label", /分时段/);
    }
  };
  await expect(page.getByLabel("用车时间")).toHaveValue("10:00");
  await compare("10:00");
  await page.getByLabel("用车时间").fill("23:30");
  await page.getByLabel("用车时间").blur();
  await compare("23:30");
  // 明细面板里某一天的逐步结果也是后端的数：点 17 日（指定日期，可能还叠周末）
  const picked = backend.days.find((day) => day.date === `${month}-17`) as (typeof backend.days)[number];
  await page.locator(`#calendar-day-${picked.date}`).click();
  const panel = page.locator(".calendar-layout > .calendar-detail");
  await expect(panel).toContainText(picked.date);
  await expect(panel).toContainText(`结算价 ${money(at(picked, "23:30").final as number)}`);
  for (const adjust of at(picked, "23:30").adjusts) await expect(panel).toContainText(adjust.name);
});

test("价格表里的金额输入：全角数字、带千分位、粘贴带「¥」和「円」的都整理成同一个数并存对；日元带小数、负数、超过上限当场报错且不发保存请求", async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  const product = await readyProduct(request, supplier, world, "金额输入的商品");
  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);
  await page.goto(`/products/${product.id}/prices`);
  const input = page.getByLabel(`${supplier.area.name} · ${world.group.name} · 接送通用 的基础价`, { exact: true });
  await expect(input).toBeVisible();
  const saves: string[] = [];
  page.on("request", (sent) => {
    if (sent.method() === "POST" && sent.url().includes("/price-rules")) saves.push(sent.postData() ?? "");
  });
  // 聚焦（页面这时把千分位去掉）→ 自己全选 → 敲 / 粘贴 → 离开。「聚焦后自动全选」另有一个【缺陷】测试
  const type = async (text: string): Promise<void> => {
    const before = await input.inputValue();
    await input.focus();
    await expect(input).toHaveValue(before.replace(/,/g, ""));
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.insertText(text);
    await input.blur();
  };
  const meaning = page.locator(".price-meaning");
  // 写错的：有提示、点保存不发请求
  for (const [text, message] of [["20000.5", "日元金额不能有小数"], ["-20000", "基础价不能是负数"], ["1000000001", "基础价最多 JPY 1,000,000,000"], ["2e4", "请填数字"], ["０．５", "日元金额不能有小数"]] as [string, string][]) {
    await type(text);
    await expect(input, text).toHaveAttribute("aria-invalid", "true");
    await input.focus();
    await expect(meaning, text).toContainText(message);
    await page.getByRole("button", { name: "保存草稿" }).click();
    await expect(page.getByRole("alert").first(), text).toBeVisible();
  }
  expect(saves).toEqual([]);
  // 写对的各种写法：都读成 18,500（读回来的那句话里是这个数），不报错
  for (const text of ["１８５００", "18,500", "¥18,500", "18500円", " JPY 18 500 ", "18500"]) {
    await type(text);
    await expect(input, text).not.toHaveAttribute("aria-invalid", "true");
    await input.focus();
    await expect(meaning, text).toContainText("每单 JPY 18,500");
    await input.blur();
  }
  // 纯数字、全角数字失去焦点后整理成带千分位的写法（带货币符号的另有一个【缺陷】测试）
  await type("１８５００");
  await expect(input).toHaveValue("18,500");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(toast(page, "已保存 1 条价格")).toBeVisible();
  expect(saves.length).toBe(1);
  const sent = JSON.parse(saves[0] as string) as { create: { base_price: number }[] };
  expect(sent.create.map((entry) => entry.base_price)).toEqual([18_500]);
  const stored = await priceView(request, supplier, product.id);
  expect(stored.items.map((item) => item.base_price)).toEqual([18_500]);
  // 刷新后读回来的还是这个数
  await page.reload();
  await expect(input).toHaveValue("18,500");
});

test("【缺陷】价格表里已经有千分位的金额（如 18,500），用 Tab 进到这一格直接敲新的数，没有盖掉旧的而是接在后面：敲 9000 得到 185,009,000（规范 3.4：再聚焦时变回纯数字并全选）", async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  const product = await readyProduct(request, supplier, world, "改价的商品");
  const info = await priceView(request, supplier, product.id);
  await addPrice(request, supplier, world, product.id, 18_500, `${info.today.slice(0, 8)}01`);
  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);
  await page.goto(`/products/${product.id}/prices`);
  const input = page.getByLabel(`${supplier.area.name} · ${world.group.name} · 接送通用 的基础价`, { exact: true });
  await expect(input).toHaveValue("18,500");
  // 复现：键盘从后一格 Shift+Tab 回到基础价这一格（浏览器本来会全选），直接敲 9000，再 Tab 离开
  await input.focus();
  await page.keyboard.press("Tab");
  await expect(input).not.toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("18500");
  await page.keyboard.type("9000");
  await page.keyboard.press("Tab");
  // 期望：这一格是 9,000；实际：185,009,000（旧的 18500 没被盖掉，新敲的数接在了后面；这个数没超过上限，可以直接保存）
  await expect(input).toHaveValue("9,000");
});

test("【缺陷】粘贴带货币符号的金额（¥18,500、18500円、JPY 18,500）：数读对了，但失去焦点后格子里没有整理成 18,500，仍然显示粘贴进来的原样（规范 3.4：失去焦点或粘贴时去掉币种代码和符号）", async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  const product = await readyProduct(request, supplier, world, "粘贴金额的商品");
  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);
  await page.goto(`/products/${product.id}/prices`);
  const input = page.getByLabel(`${supplier.area.name} · ${world.group.name} · 接送通用 的基础价`, { exact: true });
  const shown: string[] = [];
  for (const text of ["¥18,500", "18500円", "JPY 18,500"]) {
    await input.focus();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.insertText(text);
    await input.blur();
    await expect(input).not.toHaveAttribute("aria-invalid", "true");
    shown.push(await input.inputValue());
  }
  // 期望：三次都显示 18,500；实际：显示的还是 ¥18,500、18500円、JPY 18,500
  expect(shown).toEqual(["18,500", "18,500", "18,500"]);
});

for (const scheme of ["light", "dark"] as const) {
  test(`768px 宽（平板，${scheme === "light" ? "亮色" : "暗色"}）：价格规则、调价规则列表和表单、价格日历、价格规则总览不横向滚动，通过 axe 检查`, async ({ page, request }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 768, height: 1024 });
    const world = await createWorld(request);
    const supplier = await createSupplier(request, world);
    const product = await readyProduct(request, supplier, world, "平板上看的商品，标题比较长".repeat(3));
    const info = await priceView(request, supplier, product.id);
    await addPrice(request, supplier, world, product.id, 20_050, `${info.today.slice(0, 8)}01`, "pickup");
    const ruleId = await addAdjust(request, supplier, product.id, { name: "名字很长的调价规则".repeat(5).slice(0, 50), cycle: { type: "weekly", weekdays: [1, 2, 3, 4, 5, 6, 7] }, time_slot: { start: "22:00", end: "06:00" }, steps: [{ type: "percent", value: 1_250 }, { type: "amount", value: -333 }] });
    await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);
    const check = async (what: string): Promise<void> => {
      await expectNoHorizontalOverflow(page, `${what}（768px）`);
      await expectAccessible(page, `${what}（768px，${scheme}）`);
    };
    await page.goto(`/products/${product.id}/prices`);
    await expect(page.getByLabel(/的基础价$/).first()).toBeVisible();
    await check("价格规则");
    await page.goto(`/products/${product.id}/prices/adjust`);
    await expect(page.getByRole("switch").first()).toBeVisible();
    await check("调价规则列表");
    await page.goto(`/products/${product.id}/prices/adjust/${ruleId}`);
    await expect(page.locator(".adjust-trial")).toBeVisible();
    await check("调价规则表单");
    await page.goto(`/products/${product.id}/prices/calendar`);
    await expect(page.getByLabel("用车时间")).toBeVisible();
    await expect(page.locator(`#calendar-day-${info.today}`)).toHaveAttribute("aria-label", /结算价/);
    await check("价格日历");
    await page.goto("/price-rules");
    await expect(page.getByRole("heading", { level: 1, name: "价格规则" })).toBeVisible();
    await expect(page.getByRole("row").nth(1)).toBeVisible();
    await check("价格规则总览");
  });
}
