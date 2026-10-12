/**
 * 运营后台主数据与首页（M1-08），真实后端、真实 PostgreSQL。
 * 数据全部由用例自己准备：城市等经界面或接口新建，机场经真实的导入命令从用例里构造的小样本导入。
 * 并行的用例共用一个库，所以每条用例用自己的国家和随机编码，断言不依赖全库的数量。
 */
import { AxeBuilder } from "@axe-core/playwright";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { adminCredentials, expectNoHorizontalOverflow, fillLogin, importAirports, loginAs, newPassword, platformAdminHeaders, randomLetters, uniqueEmail } from "./support.ts";

async function expectAccessible(page: Page, what: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = results.violations.map((violation) => `${violation.id}: ${violation.help}（${violation.nodes.map((node) => node.target.join(" ")).join("；")}）`);
  expect(summary, `${what} 的无障碍问题`).toEqual([]);
}

async function signInAsAdmin(page: Page): Promise<void> {
  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);
}

interface CreatedCity {
  id: string;
  code: string;
  name: string;
}

async function createCity(request: APIRequestContext, country: string, timezone: string): Promise<CreatedCity> {
  const headers = await platformAdminHeaders(request);
  const code = `CTY-${country}-${randomLetters(5)}`;
  const name = `端到端城市${code.slice(-5)}`;
  const response = await request.post("/platform/v1/master/cities", { headers, data: { code, country_code: country, name: { zh: name }, timezone, center: { lng: 174.763336, lat: -36.848461 } } });
  expect(response.status(), "接口新建城市").toBe(201);
  return { id: ((await response.json()) as { id: string }).id, code, name };
}

/** 在搜索框里输入并等查询条件写进网址（停止输入 300ms 后才查询）。 */
async function search(page: Page, text: string): Promise<void> {
  await page.getByRole("searchbox", { name: "按编码或名称搜索" }).fill(text);
  await expect(page).toHaveURL(new RegExp(`[?&]q=${encodeURIComponent(text)}(&|$)`));
}

const rowOf = (page: Page, code: string) => page.getByRole("row").filter({ has: page.getByRole("link", { name: code, exact: true }) });

async function chooseOption(page: Page, label: RegExp | string, text: string, option: string | RegExp): Promise<void> {
  const box = page.getByRole("combobox", { name: label });
  await box.click();
  await box.fill(text);
  await page.getByRole("option", { name: option }).first().click();
}

test("新建城市 → 导入机场 → 在流水线页只用键盘指定城市并启用 → 列表里看到启用；另一个只保存不启用", async ({ page }) => {
  test.slow();
  const country = "NZ";
  const cityCode = `CTY-NZ-${randomLetters(5)}`;
  const cityName = `奥克兰${cityCode.slice(-5)}`;
  const first = { iata: `Q${randomLetters(2)}`, name: `E2E Auckland ${randomLetters(4)} International Airport`, lat: -37.008056, lng: 174.791667 };
  const second = { iata: `Q${randomLetters(2)}`, name: `E2E Wellington ${randomLetters(4)} Airport`, lat: -41.327221, lng: 174.805278 };
  test.skip(first.iata === second.iata, "两个随机三字码恰好相同");
  await signInAsAdmin(page);

  // 新建城市（界面）
  await page.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "城市" }).click();
  await expect(page).toHaveURL(/\/platform\/master\/cities$/);
  await page.getByRole("link", { name: "新增城市" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "新增城市" })).toBeVisible();
  await chooseOption(page, /国家/, "NZ", /新西兰（NZ）/);
  await expect(page.getByLabel(/^编码/)).toHaveValue("CTY-NZ-");
  await page.getByLabel(/^编码/).fill(cityCode.toLowerCase());
  await expect(page.getByLabel(/^编码/), "小写自动转大写").toHaveValue(cityCode);
  await page.getByLabel("名称 中文").fill(cityName);
  await page.getByLabel("名称 英语").fill("Auckland");
  await chooseOption(page, /时区/, "auckland", /Pacific\/Auckland/);
  await page.getByLabel(/^纬度/).fill("-36.848461");
  await page.getByLabel(/^经度/).fill("174.7633");
  await page.getByLabel(/^经度/).blur();
  await expect(page.getByLabel(/^经度/), "失去焦点后整理成 6 位小数").toHaveValue("174.763300");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: `已新增城市「${cityName}」` })).toBeVisible();
  await expect(page).toHaveURL(/\/platform\/master\/cities$/);
  await search(page, cityCode);
  await expect(rowOf(page, cityCode)).toContainText("新西兰（NZ）");
  await expect(rowOf(page, cityCode)).toContainText("Pacific/Auckland（UTC+1");
  await expect(rowOf(page, cityCode).locator(".badge")).toHaveText("启用");
  await expect(page).toHaveURL(new RegExp(`q=${cityCode}`));

  // 导入机场（真实命令）
  await importAirports(country, [first, second]);

  // 机场列表：导入的是已停用、待指定城市
  await page.goto(`/platform/master/places?country=${country}&q=${first.iata}`);
  await expect(rowOf(page, first.iata)).toContainText("待指定城市");
  await expect(rowOf(page, first.iata)).toContainText("OurAirports");
  await expect(rowOf(page, first.iata).locator(".badge").last()).toHaveText("已停用");
  await expect(page.getByText(/有 [\d,]+ 个导入的机场还没有指定城市。/)).toBeVisible();
  await rowOf(page, first.iata).getByRole("link", { name: /^指定城市/ }).click();

  // 流水线：从这一个开始，只用键盘
  await expect(page).toHaveURL(/\/platform\/master\/places\/pending\?start=/);
  await expect(page.getByRole("heading", { level: 2, name: first.name })).toBeVisible();
  await expect(page.locator(".pending__code")).toHaveText(first.iata);
  const city = page.getByRole("combobox", { name: /所属城市/ });
  await city.focus();
  await page.keyboard.type(cityCode.slice(-5).toLowerCase());
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(city).toHaveValue(cityName);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: `已启用「${first.iata}` })).toBeVisible();
  await expect(page.locator(".done-list__item").filter({ hasText: first.iata })).toContainText(`→ ${cityName}`);
  await expect(page.locator(".done-list__item").filter({ hasText: first.iata }).locator(".badge")).toHaveText("启用");
  await expect(page.getByRole("combobox", { name: /所属城市/ }), "换下一个后焦点回到所属城市").toBeFocused();
  await expect(page.locator(".pending__code")).not.toHaveText(first.iata);

  // 第二个：按国家只看新西兰，补一个中文名，只保存不启用
  await page.goto(`/platform/master/places/pending?country=${country}`);
  await expect(page.getByRole("heading", { level: 2, name: second.name })).toBeVisible();
  await chooseOption(page, /所属城市/, cityCode, new RegExp(cityName));
  await page.getByLabel("名称 中文").fill("惠灵顿机场");
  await expect(page.getByText("保存后，这个机场的英语名和坐标不再随 OurAirports 更新。")).toHaveCount(0);
  await page.getByRole("button", { name: "只保存，先不启用" }).click();
  await expect(page.getByRole("status").filter({ hasText: "还没有启用" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "新西兰没有待指定城市的机场" }).or(page.getByRole("heading", { name: "没有待指定城市的机场了" }))).toBeVisible();

  // 回列表核对：一个启用，一个已停用但有了城市，可以直接启用
  await page.goto(`/platform/master/places?country=${country}`);
  await search(page, first.iata);
  await expect(rowOf(page, first.iata)).toContainText(cityName);
  await expect(rowOf(page, first.iata).locator(".badge").last()).toHaveText("启用");
  await search(page, second.iata);
  await expect(rowOf(page, second.iata)).toContainText("惠灵顿机场");
  await expect(rowOf(page, second.iata).locator(".badge").last()).toHaveText("已停用");
  await rowOf(page, second.iata).getByRole("button", { name: /^启用/ }).click();
  await expect(rowOf(page, second.iata).locator(".badge").last()).toHaveText("启用");
  await expect(rowOf(page, second.iata).getByRole("button", { name: /^停用/ }), "操作后焦点留在这一行").toBeFocused();

  // 城市下还有启用中的机场：不能停用
  await page.goto(`/platform/master/cities?q=${cityCode}`);
  await rowOf(page, cityCode).getByRole("button", { name: /^停用/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "取消" }), "默认焦点在取消").toBeFocused();
  await dialog.getByRole("button", { name: "停用" }).click();
  await expect(dialog.getByRole("alert")).toContainText("这个城市下还有 2 个启用中的地点");
  await expect(dialog.getByRole("button", { name: "停用" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "知道了" }).click();
  await expect(rowOf(page, cityCode).locator(".badge")).toHaveText("启用");
});

test("车型组、附加服务、车站、地标：各新增一条 → 修改 → 停用 → 启用", async ({ page, request }) => {
  test.slow();
  const city = await createCity(request, "FJ", "Pacific/Fiji");
  const suffix = randomLetters(4);
  await signInAsAdmin(page);

  // 车型组
  await page.goto("/platform/master/vehicle-groups/new");
  await page.getByLabel("商务").check();
  await page.getByLabel(/^座位数/).fill("7");
  await expect(page.getByLabel(/^编码/)).toHaveValue("VG-BIZ-7");
  const groupCode = `VG-BIZ${suffix}-7`;
  await page.getByLabel(/^编码/).fill(groupCode);
  await page.getByLabel("名称 中文").fill(`商务七座${suffix}`);
  await page.getByLabel("燃油").check();
  await page.getByLabel("第 1 个组合的人数").fill("6");
  await page.getByLabel("第 1 个组合的行李数").fill("4");
  await page.getByRole("button", { name: "添加代表车型" }).click();
  await page.getByRole("textbox", { name: "第 1 个代表车型" }).fill("丰田埃尔法");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: `已新增车型组「商务七座${suffix}」` })).toBeVisible();
  await search(page, groupCode);
  await expect(rowOf(page, groupCode)).toContainText("6 人 4 件");
  await rowOf(page, groupCode).getByRole("link", { name: /^编辑/ }).click();
  await expect(page.getByLabel(/^编码/)).toHaveJSProperty("readOnly", true);
  await page.getByRole("button", { name: "添加组合" }).click();
  await page.getByLabel("第 2 个组合的人数").fill("5");
  await page.getByLabel("第 2 个组合的行李数").fill("5");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "已保存" })).toBeVisible();
  await expect(page, "回到来的地方，筛选条件还在").toHaveURL(new RegExp(`vehicle-groups\\?q=${groupCode}`));
  await expect(rowOf(page, groupCode)).toContainText("5 人 5 件");
  await rowOf(page, groupCode).getByRole("button", { name: /^停用/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "停用" }).click();
  await expect(rowOf(page, groupCode).locator(".badge")).toHaveText("已停用");
  await rowOf(page, groupCode).getByRole("button", { name: /^启用/ }).click();
  await expect(rowOf(page, groupCode).locator(".badge")).toHaveText("启用");

  // 附加服务
  const addonCode = `ADD-E2E_${suffix}`;
  await page.goto("/platform/master/addons/new");
  await expect(page.getByLabel(/^编码/)).toHaveValue("ADD-");
  await page.getByLabel(/^编码/).fill(addonCode);
  await page.getByLabel("名称 中文").fill(`儿童座椅${suffix}`);
  await page.getByLabel("说明 中文").fill("适合 9 个月到 4 岁的儿童。");
  await page.getByLabel("接送机").check();
  await page.getByLabel("包车").check();
  await page.getByLabel(/按个/).check();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "已新增附加服务" })).toBeVisible();
  await search(page, addonCode);
  await expect(rowOf(page, addonCode)).toContainText("接送机");
  await expect(rowOf(page, addonCode)).toContainText("按个");
  await rowOf(page, addonCode).getByRole("link", { name: addonCode, exact: true }).click();
  await page.getByLabel(/按人/).check();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(rowOf(page, addonCode)).toContainText("按人");
  await rowOf(page, addonCode).getByRole("button", { name: /^停用/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "停用" }).click();
  await expect(rowOf(page, addonCode).locator(".badge")).toHaveText("已停用");
  await rowOf(page, addonCode).getByRole("button", { name: /^启用/ }).click();
  await expect(rowOf(page, addonCode).locator(".badge")).toHaveText("启用");

  // 车站 + 出口
  const stationCode = `STN-FJ-${suffix}`;
  await page.goto("/platform/master/places?type=station");
  await page.getByRole("link", { name: "新增车站" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "新增车站" })).toBeVisible();
  await chooseOption(page, /所属城市/, city.code, new RegExp(city.name));
  await expect(page.getByLabel(/^编码/)).toHaveValue("STN-FJ-");
  await page.getByLabel(/^编码/).fill(stationCode);
  await page.getByLabel("名称 中文").fill(`苏瓦站${suffix}`);
  await page.getByLabel("铁路").check();
  await page.getByLabel(/^纬度/).fill("-18.141600");
  await page.getByLabel(/^经度/).fill("178.441900");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "已新增车站" })).toBeVisible();
  await search(page, stationCode);
  await expect(rowOf(page, stationCode)).toContainText("铁路");
  await expect(rowOf(page, stationCode)).toContainText(city.name);
  await rowOf(page, stationCode).getByRole("link", { name: stationCode, exact: true }).click();
  await expect(page.getByRole("heading", { name: "还没有出口" })).toBeVisible();
  await page.getByRole("link", { name: "新增出口" }).first().click();
  await expect(page.getByLabel(/^编码/)).toHaveValue(`${stationCode}-`);
  await page.getByLabel(/^编码/).fill(`${stationCode}-E1`);
  await page.getByLabel("名称 中文").fill("东口");
  await page.getByRole("button", { name: "填入车站的坐标" }).click();
  await expect(page.getByLabel(/^纬度/)).toHaveValue("-18.141600");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "已新增出口「东口」" })).toBeVisible();
  await expect(rowOf(page, `${stationCode}-E1`)).toContainText("东口");
  await page.getByRole("button", { name: "停用", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "停用" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("这个车站下还有 1 个启用中的出口");
  await page.getByRole("dialog").getByRole("button", { name: "知道了" }).click();

  // 地标
  const poiCode = `POI-${suffix}${randomLetters(3)}`;
  await page.goto("/platform/master/places/new?type=poi");
  await chooseOption(page, /所属城市/, city.code, new RegExp(city.name));
  await page.getByLabel(/^编码/).fill(poiCode);
  await page.getByLabel("名称 中文").fill(`苏瓦港${suffix}`);
  await page.getByLabel("港口").check();
  await page.getByLabel(/^纬度/).fill("-18.133000");
  await page.getByLabel(/^经度/).fill("178.425000");
  await page.getByLabel(/^地址/).fill("Suva Harbour, Fiji");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "已新增地标" })).toBeVisible();
  await expect(page).toHaveURL(/places\?type=poi/);
  await search(page, poiCode);
  await expect(rowOf(page, poiCode)).toContainText("港口");
  await expect(rowOf(page, poiCode)).toContainText("Suva Harbour, Fiji");
  await rowOf(page, poiCode).getByRole("button", { name: /^停用/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "停用" }).click();
  await expect(rowOf(page, poiCode).locator(".badge")).toHaveText("已停用");
  await rowOf(page, poiCode).getByRole("button", { name: /^启用/ }).click();
  await expect(rowOf(page, poiCode).locator(".badge")).toHaveText("启用");
});

test("别人先改了同一条记录：保存被拦下并提示，载入最新内容后再改能保存；编码重复提示在编码下", async ({ page, request }) => {
  const city = await createCity(request, "TO", "Pacific/Tongatapu");
  const headers = await platformAdminHeaders(request);
  await signInAsAdmin(page);
  await page.goto(`/platform/master/cities/${city.id}`);
  await expect(page.getByRole("heading", { level: 1, name: city.name })).toBeVisible();
  await page.getByLabel("名称 英语").fill("Mine");

  const other = await request.patch(`/platform/v1/master/cities/${city.id}`, { headers: { ...headers, "if-match": '"1"' }, data: { name: { zh: city.name, ja: "別の人" } } });
  expect(other.status()).toBe(200);

  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "这条记录刚被别人修改过，你的修改还没有保存。" })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  await expect(page.getByLabel("名称 英语"), "点载入之前自己的内容还在").toHaveValue("Mine");
  await page.getByRole("button", { name: "载入最新内容" }).click();
  await expect(page.getByText("已载入最新内容。")).toBeVisible();
  await expect(page.getByLabel("名称 日语")).toHaveValue("別の人");
  await expect(page.getByLabel("名称 英语")).toHaveValue("");
  await page.getByLabel("名称 英语").fill("Mine again");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "已保存" })).toBeVisible();
  const saved = (await (await request.get(`/platform/v1/master/cities/${city.id}`, { headers })).json()) as { name: Record<string, string>; version: number };
  expect(saved.name).toEqual({ zh: city.name, ja: "別の人", en: "Mine again" });
  expect(saved.version).toBe(3);

  await page.goto("/platform/master/cities/new");
  await chooseOption(page, /国家/, "TO", /（TO）/);
  await page.getByLabel(/^编码/).fill(city.code);
  await page.getByLabel("名称 中文").fill("重复的城市");
  await chooseOption(page, /时区/, "tongatapu", /Pacific\/Tongatapu/);
  await page.getByLabel(/^纬度/).fill("-21.139300");
  await page.getByLabel(/^经度/).fill("-175.204900");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("这个编码已经被使用，请换一个")).toBeVisible();
  await expect(page.getByLabel(/^编码/)).toBeFocused();
  await expect(page.getByLabel("名称 中文")).toHaveValue("重复的城市");
});

test("首页：数量与接口一致、入口能进到各列表；只读角色能看不能改，流水线页进不去", async ({ page, request }) => {
  const headers = await platformAdminHeaders(request);
  await signInAsAdmin(page);
  const card = (title: string) => page.locator(".entry-card").filter({ has: page.locator(".entry-card__title", { hasText: new RegExp(`^${title}$`) }) });
  const summaryResponse = page.waitForResponse((response) => response.url().endsWith("/platform/v1/dashboard/summary") && response.status() === 200);
  await page.reload();
  const summary = (await (await summaryResponse).json()) as {
    tenants: { active: number; suspended: number };
    master_data: { cities: { active: number; disabled: number }; places: { by_type: Record<string, { active: number; disabled: number }>; airports_without_city: number }; vehicle_groups: { active: number; disabled: number }; addons: { active: number; disabled: number } };
  };
  const format = (value: number): string => new Intl.NumberFormat("zh-Hans").format(value);
  const line = (counts: { active: number; disabled: number }): string => `启用${format(counts.active)}已停用${format(counts.disabled)}`;
  const types = summary.master_data.places.by_type;
  const places = { active: (types["airport"]?.active ?? 0) + (types["station"]?.active ?? 0) + (types["poi"]?.active ?? 0), disabled: (types["airport"]?.disabled ?? 0) + (types["station"]?.disabled ?? 0) + (types["poi"]?.disabled ?? 0) };
  await expect(card("城市").locator("dl")).toHaveText(line(summary.master_data.cities));
  await expect(card("地点").locator("dl")).toHaveText(line(places));
  await expect(card("车型组").locator("dl")).toHaveText(line(summary.master_data.vehicle_groups));
  await expect(card("附加服务").locator("dl")).toHaveText(line(summary.master_data.addons));
  await expect(card("供应商").locator("dl")).toHaveText(`正常${format(summary.tenants.active)}已暂停${format(summary.tenants.suspended)}`);
  await expect(card("供应商").getByRole("link")).toHaveCount(0);
  await expect(page.getByText("当前登录")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "主菜单" }).getByRole("link")).toHaveText(["首页", "城市", "地点", "车型组", "附加服务"]);

  for (const [title, path, heading] of [
    ["城市", "/platform/master/cities", "城市"],
    ["地点", "/platform/master/places", "地点"],
    ["车型组", "/platform/master/vehicle-groups", "车型组"],
    ["附加服务", "/platform/master/addons", "附加服务"],
  ] as const) {
    await page.goto("/platform");
    await card(title).getByRole("link", { name: title, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page).toHaveTitle(`${heading} · NOZOMI 运营后台`);
  }

  // 只读角色
  const email = uniqueEmail("finance");
  const created = await request.post("/platform/v1/staff", { headers, data: { email, name: "端到端测试财务", role: "finance" } });
  expect(created.status()).toBe(201);
  const { invite } = (await created.json()) as { invite: { token: string } };
  const password = newPassword();
  expect((await request.post("/platform/v1/auth/accept-invite", { data: { token: invite.token, password } })).status()).toBe(200);
  const city = await createCity(request, "WS", "Pacific/Apia");
  await page.getByRole("button", { name: /账号菜单/ }).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await fillLogin(page, email, password);
  await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();
  await expect(card("城市")).toBeVisible();
  await expect(card("供应商"), "财务不能看供应商").toHaveCount(0);
  await page.goto(`/platform/master/cities?q=${city.code}`);
  await expect(rowOf(page, city.code)).toBeVisible();
  await expect(page.getByRole("link", { name: "新增城市" })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "操作" })).toHaveCount(0);
  await rowOf(page, city.code).getByRole("link", { name: city.code, exact: true }).click();
  await expect(page.getByText("你可以查看主数据，但不能修改。需要修改的话，请联系管理员开通。")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "停用", exact: true })).toHaveCount(0);
  await page.goto("/platform/master/places/pending");
  await expect(page.getByRole("heading", { name: "你没有权限查看这里" })).toBeVisible();
  await page.goto("/platform/master/cities/new");
  await expect(page.getByRole("heading", { name: "你没有权限查看这里" })).toBeVisible();
});

test("320 / 360 / 400 宽度下首页和各列表都不横向滚动；亮色、暗色通过 axe 检查", async ({ page, request }) => {
  test.setTimeout(240_000); // 十几个页面状态 × 三个宽度 × 两套主题的 axe，一条用例里做完
  const country = "IS";
  const city = await createCity(request, country, "Atlantic/Reykjavik");
  const headers = await platformAdminHeaders(request);
  const longAddon = `ADD-${"E2E_LONG_CODE_".repeat(2)}${randomLetters(8)}`;
  expect((await request.post("/platform/v1/master/addons", { headers, data: { code: longAddon, categories: ["airport_transfer", "point_to_point", "charter"], charge_unit: "per_duration", name: { zh: "名字很长很长的附加服务".repeat(4), en: "A".repeat(120) }, description: {} } })).status()).toBe(201);
  await importAirports(country, [{ iata: `Y${randomLetters(2)}`, name: `E2E Keflavik ${"Very Long Name ".repeat(6)}Airport`, lat: 63.985, lng: -22.605556 }]);
  await signInAsAdmin(page);

  const widths = [320, 360, 400] as const;
  const sweep = async (what: string): Promise<void> => {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 740 });
      await expectNoHorizontalOverflow(page, `${what} ${width}px`);
    }
  };
  const bothThemes = async (what: string): Promise<void> => {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expectAccessible(page, `${what}（${scheme}）`);
    }
    await page.emulateMedia({ colorScheme: "light" });
  };

  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/platform");
  await expect(page.locator(".entry-card__counts").first()).toBeVisible();
  await expect(page.locator(".entry-card__reminder").first()).toBeVisible();
  await sweep("首页");
  await bothThemes("首页");
  await page.getByRole("button", { name: "打开菜单" }).click();
  await expect(page.getByRole("dialog", { name: "主菜单" })).toBeVisible();
  await sweep("首页侧边栏滑出");
  await bothThemes("首页侧边栏滑出");
  await page.keyboard.press("Escape");

  await page.goto(`/platform/master/cities?country=${country}`);
  await expect(rowOf(page, city.code)).toBeVisible();
  await sweep("城市列表");
  await bothThemes("城市列表");
  const scroller = page.getByRole("region", { name: "城市列表" });
  expect(await scroller.evaluate((element) => element.scrollWidth > element.clientWidth), "表格在自己的容器里横向滚动").toBe(true);
  await rowOf(page, city.code).getByRole("button", { name: /^停用/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await sweep("停用确认对话框");
  await bothThemes("停用确认对话框");
  await page.getByRole("dialog").getByRole("button", { name: "取消" }).click();

  await page.goto("/platform/master/cities?q=不会有这样的城市");
  await expect(page.getByRole("heading", { name: "没有符合条件的城市" })).toBeVisible();
  await sweep("城市列表筛选无结果");

  await page.goto(`/platform/master/places?country=${country}`);
  await expect(page.locator(".badge", { hasText: "待指定城市" }).first()).toBeVisible();
  await sweep("机场页签");
  await bothThemes("机场页签");
  await page.goto("/platform/master/places?type=station");
  await expect(page.getByRole("tab", { name: "车站" })).toHaveAttribute("aria-selected", "true");
  await sweep("车站页签");
  await page.goto("/platform/master/vehicle-groups");
  await expect(page.getByRole("heading", { level: 1, name: "车型组" })).toBeVisible();
  await sweep("车型组列表");
  await page.goto(`/platform/master/addons?q=${longAddon}`);
  await expect(rowOf(page, longAddon)).toBeVisible();
  await sweep("附加服务列表（长编码）");
  await bothThemes("附加服务列表");

});

test("320 / 360 / 400 宽度下流水线页和各表单都不横向滚动；亮色、暗色通过 axe 检查", async ({ page, request }) => {
  test.setTimeout(240_000); // 十几个页面状态 × 三个宽度 × 两套主题的 axe，一条用例里做完
  const country = "MT";
  const city = await createCity(request, country, "Europe/Malta");
  await importAirports(country, [{ iata: `Z${randomLetters(2)}`, name: `E2E Luqa ${"Very Long Name ".repeat(6)}Airport`, lat: 63.985, lng: -22.605556 }]);
  await signInAsAdmin(page);

  const widths = [320, 360, 400] as const;
  const sweep = async (what: string): Promise<void> => {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 740 });
      await expectNoHorizontalOverflow(page, `${what} ${width}px`);
    }
  };
  const bothThemes = async (what: string): Promise<void> => {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expectAccessible(page, `${what}（${scheme}）`);
    }
    await page.emulateMedia({ colorScheme: "light" });
  };

  await page.setViewportSize({ width: 320, height: 640 });

  await page.goto(`/platform/master/places/pending?country=${country}`);
  await expect(page.locator(".pending__code")).toBeVisible();
  await sweep("处理导入的机场");
  await bothThemes("处理导入的机场");
  await page.getByRole("combobox", { name: /所属城市/ }).click();
  await expect(page.getByRole("listbox", { name: "所属城市" })).toBeVisible();
  await sweep("处理导入的机场：组合框打开");
  await bothThemes("处理导入的机场：组合框打开");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "新增城市" }).click();
  await expect(page.getByRole("dialog", { name: "新增城市" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "新增城市" }).click();
  await expect(page.getByRole("dialog").getByText("请输入编码")).toBeVisible();
  await sweep("新增城市对话框（字段出错）");
  await bothThemes("新增城市对话框");
  await page.getByRole("dialog").getByRole("button", { name: "取消" }).click();

  for (const path of ["/platform/master/cities/new", "/platform/master/places/new?type=airport", "/platform/master/vehicle-groups/new", "/platform/master/addons/new"]) {
    await page.goto(path);
    await expect(page.getByRole("button", { name: "保存", exact: true })).toBeVisible();
    await sweep(`${path} 默认`);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByText(/有 \d+ 处需要修改/)).toBeVisible();
    await sweep(`${path} 字段出错`);
    await bothThemes(`${path} 字段出错`);
  }
  await page.goto(`/platform/master/cities/${city.id}`);
  await expect(page.getByLabel("名称 中文")).toHaveValue(city.name);
  await sweep("城市编辑页");
  await bothThemes("城市编辑页");
});
