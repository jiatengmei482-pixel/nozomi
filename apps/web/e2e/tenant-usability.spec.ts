/**
 * M1-14 供应商后台易用性改进（M1 验收发现），真实后端、真实 PostgreSQL。日期一律相对接口给的「今天」，不写死。
 * 价格日历 / 库存日历里过去的日子不再是警告、手机上打开直接看到今天、只选一天不写「起止」；
 * 手机上价格页底部的操作栏不占四分之一屏；接送点用中文找；系统状态里的汇率；汇率页四舍五入和完整数值。
 */
import { addDays } from "@nozomi/domain";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { CENTER, type Supplier, type World, choose, createProductByApi, createSupplier, createWorld, expectAccessible } from "./catalog.ts";
import { adminCredentials, expectNoHorizontalOverflow, loginAs, platformAdminHeaders, randomLetters, snapshot } from "./support.ts";

async function productVersion(request: APIRequestContext, supplier: Supplier, productId: string): Promise<number> {
  return ((await (await request.get(`/tenant/v1/products/${productId}`, { headers: supplier.headers })).json()) as { version: number }).version;
}

/** 接口给的城市当地的今天。 */
async function todayOf(request: APIRequestContext, supplier: Supplier, productId: string): Promise<string> {
  const response = await request.get(`/tenant/v1/products/${productId}/price-rules`, { headers: supplier.headers });
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { today: string }).today;
}

/** 一条从 `from` 起一直有效的一口价。 */
async function fixedPrice(request: APIRequestContext, supplier: Supplier, world: World, productId: string, from: string): Promise<void> {
  const response = await request.post(`/tenant/v1/products/${productId}/price-rules/batch`, {
    headers: { ...supplier.headers, "if-match": `"${await productVersion(request, supplier, productId)}"`, "idempotency-key": crypto.randomUUID() },
    data: { create: [{ ref: "a", area_id: supplier.area.id, vehicle_group_id: world.group.id, direction: "both", package_hours: null, pricing_model: "fixed", base_price: 18000, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null, valid_from: from, valid_to: null, status: "enabled" }], update: [], delete: [] },
  });
  expect(response.status(), `接口新建价格：${await response.text()}`).toBe(200);
}

/** 限量，从今天起 `days` 天每天 3 单（今天以前的日子都是「没设」）。 */
async function limitedStock(request: APIRequestContext, supplier: Supplier, productId: string, today: string, days: number): Promise<void> {
  const set = await request.post(`/tenant/v1/products/${productId}/inventory/batch-set`, { headers: { ...supplier.headers, "if-match": `"${await productVersion(request, supplier, productId)}"` }, data: { from: today, to: addDays(today, days - 1), weekdays: [], total: 3 } });
  expect(set.status(), await set.text()).toBe(200);
  const mode = await request.put(`/tenant/v1/products/${productId}/inventory`, { headers: { ...supplier.headers, "if-match": `"${await productVersion(request, supplier, productId)}"` }, data: { mode: "limited" } });
  expect(mode.status(), await mode.text()).toBe(200);
}

const previousMonth = (today: string): string => addDays(`${today.slice(0, 8)}01`, -1).slice(0, 7);

/** 这个元素整个在视口里。 */
async function expectInViewport(page: Page, selector: string, what: string): Promise<void> {
  const box = await page.locator(selector).boundingBox();
  const height = page.viewportSize()?.height ?? 0;
  expect(box, `${what}：找不到`).not.toBeNull();
  expect((box?.y ?? -1) >= 0 && (box?.y ?? 0) + (box?.height ?? 0) <= height, `${what}：不在屏幕里（y=${box?.y}，视口高 ${height}）`).toBe(true);
}

test("价格日历：上个月（都已过去）没有价格只写文字、不是警告、不提示「这个月没有价格」；只选一天不写「起止」；手机上打开直接看到今天", async ({ page, request }) => {
  test.setTimeout(120_000);
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  const product = await createProductByApi(request, supplier, world, "airport_transfer");
  const today = await todayOf(request, supplier, product.id);
  await fixedPrice(request, supplier, world, product.id, today);
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);

  const last = previousMonth(today);
  await page.goto(`/products/${product.id}/prices/calendar?month=${last}`);
  const pastDay = page.locator(`#calendar-day-${last}-15`);
  await expect(pastDay).toHaveAttribute("aria-label", /没有价格$/);
  await expect(pastDay).not.toHaveClass(/calendar__cell--none/);
  await expect(pastDay.locator("svg")).toHaveCount(0);
  await expect(pastDay.locator(".calendar__flag--past")).toHaveText("没有价格");
  await expect(page.getByText(/这个月没有价格。/)).toHaveCount(0);
  await pastDay.click();
  await expect(page.locator(".calendar-layout > .calendar-detail")).toContainText("这一天已经过去了，不会再有客人订这一天，不用补价格。");
  await expect(pastDay.locator(".calendar__mark")).toHaveCount(0);
  await expect(page.locator(".calendar-bar")).toContainText(`已选 ${last}-15，共 1 天`);

  // 本月：今天有价；选一天不写「起止」，选一段两头写「起」「止」
  await page.getByRole("button", { name: "回到本月" }).click();
  const todayCell = page.locator(`#calendar-day-${today}`);
  await expect(todayCell).toHaveAttribute("aria-label", /今天，结算价 JPY 18,000/);
  await todayCell.click();
  await expect(todayCell.locator(".calendar__mark")).toHaveCount(0);
  await expect(page.locator(".calendar")).not.toContainText("起止");

  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`/products/${product.id}/prices/calendar`);
    await expect(todayCell).toHaveAttribute("aria-label", /今天/);
    await expectInViewport(page, `#calendar-day-${today}`, `价格日历手机上的今天（${scheme}）`);
    await snapshot(page, `m114-price-calendar-phone-${scheme}`);
    await page.setViewportSize({ width: 320, height: 640 });
    await expectNoHorizontalOverflow(page, `价格日历（320px，${scheme}）`);
    await expectAccessible(page, `价格日历（手机，${scheme}）`);
    await page.goto(`/products/${product.id}/prices/calendar?month=${last}`);
    await expect(page.locator(`#calendar-day-${last}-15`)).toHaveAttribute("aria-label", /没有价格$/);
    await expectAccessible(page, `价格日历上个月（手机，${scheme}）`);
  }
});

test("库存日历：过去的「没设」只写「没设」，没有三角和「卖不出去」；只选一天不写「起止」；手机上打开直接看到今天", async ({ page, request }) => {
  test.setTimeout(120_000);
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  const product = await createProductByApi(request, supplier, world, "airport_transfer");
  const today = await todayOf(request, supplier, product.id);
  await limitedStock(request, supplier, product.id, today, 40);
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);

  const last = previousMonth(today);
  await page.goto(`/products/${product.id}/inventory?month=${last}`);
  const pastDay = page.locator(`#inventory-day-${last}-15`);
  await expect(pastDay).toHaveAttribute("aria-label", /，没设，已经过去，只能看$/);
  await expect(pastDay).not.toContainText("卖不出去");
  await expect(pastDay.locator("svg")).toHaveCount(0);

  await page.goto(`/products/${product.id}/inventory`);
  await expect(page.locator(`#inventory-day-${today}`)).toHaveAttribute("aria-label", /今天/);
  // 明天：今天是月底时在下个月
  const next = page.locator(`#inventory-day-${addDays(today, 1)}`);
  if (addDays(today, 1).slice(0, 7) !== today.slice(0, 7)) await page.getByRole("button", { name: "下个月" }).click();
  await expect(next).toHaveAttribute("aria-label", /还剩 3 单/);
  await next.click();
  await expect(next).toHaveClass(/calendar__cell--selected/);
  await expect(next.locator(".calendar__mark")).toHaveCount(0);
  await expect(page.locator(".calendar")).not.toContainText("起止");

  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`/products/${product.id}/inventory`);
    await expect(page.locator(`#inventory-day-${today}`)).toHaveAttribute("aria-label", /今天，还剩 3 单/);
    await expectInViewport(page, `#inventory-day-${today}`, `库存日历手机上的今天（${scheme}）`);
    await snapshot(page, `m114-inventory-phone-${scheme}`);
    await page.setViewportSize({ width: 320, height: 640 });
    await expectNoHorizontalOverflow(page, `库存日历（320px，${scheme}）`);
    await expectAccessible(page, `库存日历（手机，${scheme}）`);
  }
});

test("手机上价格页底部的操作栏最多两行，不到屏幕的四分之一；按钮都看得到、用键盘按得到", async ({ page, request }) => {
  test.setTimeout(90_000);
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  const product = await createProductByApi(request, supplier, world, "airport_transfer");
  const today = await todayOf(request, supplier, product.id);
  await fixedPrice(request, supplier, world, product.id, today);
  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);
  for (const size of [{ width: 375, height: 667 }, { width: 320, height: 568 }]) {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize(size);
      await page.goto(`/products/${product.id}/prices`);
      const bar = page.locator(".step__bar");
      await expect(bar.getByRole("button", { name: "保存并下一步" })).toBeVisible();
      const box = await bar.boundingBox();
      expect(box?.height ?? 999, `${size.width}px：操作栏高 ${box?.height}px`).toBeLessThan(size.height / 4);
      for (const name of ["取消", "保存草稿", "保存并下一步"]) {
        const button = bar.getByRole("button", { name });
        const at = await button.boundingBox();
        expect((at?.x ?? -1) >= 0 && (at?.x ?? 0) + (at?.width ?? 0) <= size.width, `${size.width}px：「${name}」超出屏幕`).toBe(true);
      }
      await expectNoHorizontalOverflow(page, `价格页（${size.width}px，${scheme}）`);
      await expectAccessible(page, `价格页（${size.width}px，${scheme}）`);
      await snapshot(page, `m114-prices-bar-${size.width}-${scheme}`);
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  // 键盘：Tab 走得到底部的三个按钮，焦点看得见
  const save = page.locator(".step__bar").getByRole("button", { name: "保存草稿" });
  await save.focus();
  await expect(save).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator(".step__bar").getByRole("button", { name: "保存并下一步" })).toBeFocused();
});

test("接送点：用中文名找得到（平台补过中文名的机场）；只有英文名的机场用中文找不到时说清楚怎么办", async ({ page, request }) => {
  test.setTimeout(90_000);
  const world = await createWorld(request);
  const headers = await platformAdminHeaders(request);
  // 同一个城市里再加一个只有英文名的机场（导入的机场一开始就是这样）
  let englishCode = "";
  for (let attempt = 0; englishCode === "" && attempt < 8; attempt += 1) {
    const code = `Y${randomLetters(2)}`;
    const response = await request.post("/platform/v1/master/places", { headers, data: { type: "airport", code, city_id: world.city.id, name: { en: `English Only Airport ${code}` }, location: { lat: CENTER.lat + 0.1, lng: CENTER.lng - 0.1 }, flight_scope: "mixed" } });
    if (response.status() === 201) englishCode = code;
    else expect(response.status(), `新建机场：${await response.text()}`).toBe(409);
  }
  const supplier = await createSupplier(request, world);
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);
  await page.goto("/products/new");
  await choose(page, /城市/, world.city.code);
  await page.getByRole("radio", { name: /^接送机/ }).check();
  const poi = page.getByRole("combobox", { name: /接送点/ });
  await poi.click();
  // world.airport 的中文名是「商品机场{tag}」：用中文的一部分就找得到
  await poi.fill("商品机场");
  await page.getByRole("option", { name: new RegExp(world.airport.name) }).click();
  await expect(poi).toHaveValue(world.airport.name);
  await poi.fill("成田");
  const listbox = page.getByRole("listbox", { name: /接送点/ });
  await expect(listbox).toContainText("没有名称里带「成田」的接送点。有 1 个机场或车站目前只有英文名");
  await expect(listbox).toContainText("请输入英文名或三字代码查找；要用中文名搜，请联系平台运营在「主数据 → 地点」里补上中文名。");
  await poi.fill(englishCode.toLowerCase());
  await expect(page.getByRole("option", { name: new RegExp(`English Only Airport ${englishCode}`) })).toBeVisible();
});

test("运营后台：系统状态显示汇率是否过期和这批汇率的时间；汇率页四舍五入显示，手机上点「显示完整数值」看完整值；320px 不横向滚动，亮暗两色 axe", async ({ page, request }) => {
  test.setTimeout(120_000);
  const headers = await platformAdminHeaders(request);
  // 先保证有一批汇率（别的用例可能正在拉，后端回 409「正在拉取」时等一下再试）
  await expect(async () => {
    const response = await request.post("/platform/v1/fx-rates/fetch", { headers });
    expect(response.status()).toBe(200);
  }).toPass({ timeout: 45_000 });
  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/platform/settings/integrations");
    const card = page.locator("section", { has: page.getByRole("heading", { level: 2, name: "汇率数据" }) });
    await expect(card).toContainText(/是否过期(没有过期，跨币种报价照常|已过期（超过 48 小时没有更新），跨币种报价已暂停)/);
    await expect(card).toContainText(/这批汇率的时间（数据源给的）\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    await expect(card).toContainText(/最近一次拉取\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    await expect(card.getByRole("link", { name: "看汇率和拉取记录" })).toHaveAttribute("href", "/platform/master/fx-rates");
    await expectAccessible(page, `系统状态（${scheme}）`);
    await page.setViewportSize({ width: 320, height: 640 });
    await expectNoHorizontalOverflow(page, `系统状态（320px，${scheme}）`);
    await expectAccessible(page, `系统状态（320px，${scheme}）`);

    await page.goto("/platform/master/fx-rates");
    const matrix = page.getByRole("region", { name: "币种互换表" });
    // 1 CNY = 150.5 / 7.2 = 20.902777…（假汇率源给的数）：四舍五入是 20.9028
    await expect(matrix.getByRole("row", { name: /^CNY/ }).getByTitle("20.902777777778")).toHaveText("20.9028");
    await page.getByRole("button", { name: "显示完整数值" }).first().click();
    await expect(matrix.getByRole("row", { name: /^CNY/ }).getByTitle("20.902777777778")).toHaveText("20.902777777778");
    await expect(page.getByText("现在显示的是完整数值（报价用的就是它）。").first()).toBeVisible();
    await expectNoHorizontalOverflow(page, `汇率页完整数值（320px，${scheme}）`);
    await expectAccessible(page, `汇率页完整数值（320px，${scheme}）`);
    await snapshot(page, `m114-fx-full-320-${scheme}`);
  }
});
