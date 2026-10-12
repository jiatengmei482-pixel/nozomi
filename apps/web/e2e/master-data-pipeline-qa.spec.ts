/**
 * M1-08「处理导入的机场」流水线页在真实数量下的行为（测试角色补的用例），真实后端、真实 PostgreSQL。
 * 测试环境里是 97 个导入的机场（全部停用、没有城市），这里按同样的数量构造样本，经真实的导入命令导入。
 * 并行的用例共用一个库：每条用例用自己的国家和三字码前缀，页面都带上国家筛选，断言不依赖全库的数量。
 */
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { adminCredentials, importAirports, loginAs, platformAdminHeaders, randomLetters } from "./support.ts";

interface Created {
  id: string;
  code: string;
  name: string;
}

/** 第 n 个三字码：首字母区分用例，后两位依次排，保证不重复、顺序固定。 */
function iata(prefix: string, n: number): string {
  return `${prefix}${String.fromCharCode(65 + Math.floor(n / 26))}${String.fromCharCode(65 + (n % 26))}`;
}

function sampleAirports(prefix: string, count: number): { iata: string; name: string; lat: number; lng: number }[] {
  return Array.from({ length: count }, (_, n) => ({ iata: iata(prefix, n), name: `QA ${prefix} Airport ${String(n + 1).padStart(3, "0")}`, lat: -1.3 + n / 1000, lng: 36.8 + n / 1000 }));
}

async function createCity(request: APIRequestContext, country: string, timezone: string, name: string): Promise<Created> {
  const headers = await platformAdminHeaders(request);
  const code = `CTY-${country}-${randomLetters(6)}`;
  const response = await request.post("/platform/v1/master/cities", { headers, data: { code, country_code: country, name: { zh: name }, timezone, center: { lng: 36.817223, lat: -1.286389 } } });
  expect(response.status(), "接口新建城市").toBe(201);
  return { id: ((await response.json()) as { id: string }).id, code, name };
}

interface PendingPlace {
  id: string;
  code: string;
  version: number;
  name: Record<string, string>;
}

async function pendingOf(request: APIRequestContext, country: string): Promise<{ total: number; items: PendingPlace[] }> {
  const headers = await platformAdminHeaders(request);
  const response = await request.get(`/platform/v1/master/places?type=airport&city_id=none&country_code=${country}&sort=code&limit=200`, { headers });
  expect(response.status()).toBe(200);
  return (await response.json()) as { total: number; items: PendingPlace[] };
}

/** 每个待指定城市的机场，接口建议的城市叫什么（没有建议的不在表里）。 */
async function suggestedCityNames(request: APIRequestContext, country: string): Promise<Map<string, string>> {
  const headers = await platformAdminHeaders(request);
  const response = await request.get(`/platform/v1/master/places?type=airport&city_id=none&country_code=${country}&sort=code&limit=200`, { headers });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { city_suggestions?: { place_id: string; suggested_city: { name: Record<string, string> } | null }[] };
  return new Map((body.city_suggestions ?? []).flatMap((entry) => (entry.suggested_city ? [[entry.place_id, entry.suggested_city.name["zh"] ?? ""] as const] : [])));
}

async function signIn(page: Page): Promise<void> {
  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);
}

/** 队列的顺序：按编码升序（接口的 sort=code），和样本里的先后、导入时的内部编号无关。 */
const at = (order: readonly PendingPlace[], n: number): string => order[n]?.code ?? `（没有第 ${n + 1} 个）`;
const nameAt = (order: readonly PendingPlace[], n: number): string => order[n]?.name["en"] ?? "";

const code = (page: Page) => page.locator(".pending__code");
const remaining = (page: Page) => page.locator(".pending__toolbar").getByText(/^还剩 [\d,]+ 个$/);
const cityBox = (page: Page) => page.getByRole("combobox", { name: /所属城市/ });
const toast = (page: Page, text: string | RegExp) => page.locator(".toast").filter({ hasText: text });

/** 只用键盘处理当前这一个：输入城市名的几个字 → Enter 选中高亮的那个 → Enter 提交。 */
async function assignByKeyboard(page: Page, fragment: string): Promise<void> {
  await expect(cityBox(page)).toBeFocused();
  await page.keyboard.type(fragment);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
}

test("97 个导入的机场：只用键盘连续处理几十个，「还剩」逐个递减；跳过、只保存、刷新后的位置、最后一个处理完的空状态；首页和列表的数量跟着变", async ({ page, request }) => {
  test.setTimeout(240_000);
  const country = "KE";
  const prefix = "A";
  const total = 97;
  const nairobi = await createCity(request, country, "Africa/Nairobi", `内罗毕${randomLetters(4)}`);
  const mombasa = await createCity(request, country, "Africa/Nairobi", `蒙巴萨${randomLetters(4)}`);
  await importAirports(country, sampleAirports(prefix, total));
  const order = (await pendingOf(request, country)).items;
  expect(order).toHaveLength(total);
  await signIn(page);

  // 首页的提醒行是全库的数量：至少包含这 97 个，并且和接口此刻的数量一致
  await expect(async () => {
    await page.goto("/platform");
    const headers = await platformAdminHeaders(request);
    const before = ((await (await request.get("/platform/v1/master/places?type=airport&city_id=none&limit=1", { headers })).json()) as { total: number }).total;
    const reminder = page.locator(".entry-card__reminder").filter({ hasText: "个机场待指定城市" });
    await expect(reminder).toBeVisible();
    const shown = Number(((await reminder.textContent()) ?? "").replace(/[^\d]/g, ""));
    const after = ((await (await request.get("/platform/v1/master/places?type=airport&city_id=none&limit=1", { headers })).json()) as { total: number }).total;
    expect(before, "别的用例正好在改数据，重来一次").toBe(after);
    expect(shown).toBe(after);
    expect(shown).toBeGreaterThanOrEqual(total);
  }).toPass({ timeout: 30_000 });

  // 从首页的提醒行进流水线页（鼠标只用这一次），再按国家只看这一批
  await page.locator(".entry-card__reminder").filter({ hasText: "个机场待指定城市" }).click();
  await expect(page).toHaveURL(/\/platform\/master\/places\/pending$/);
  await page.goto(`/platform/master/places/pending?country=${country}`);
  await expect(remaining(page)).toHaveText(`还剩 ${total} 个`);
  await expect(code(page)).toHaveText(at(order, 0));
  await expect(page.locator(".pending__head .badge")).toHaveText("已停用");

  // 连续 30 个，全程键盘：每处理一个，换下一个、「还剩」减一、焦点回到所属城市、读屏播报下一个
  const suggestedName = await suggestedCityNames(request, country);
  let notCarriedOver = 0;
  await cityBox(page).focus();
  for (let n = 0; n < 30; n += 1) {
    await expect(code(page), `第 ${n + 1} 个`).toHaveText(at(order, n));
    await assignByKeyboard(page, n % 2 === 0 ? nairobi.name.slice(0, 3) : mombasa.code.slice(-6).toLowerCase());
    await expect(code(page), `第 ${n + 1} 个处理完换下一个`).toHaveText(at(order, n + 1));
    await expect(remaining(page)).toHaveText(`还剩 ${total - n - 1} 个`);
    await expect(cityBox(page)).toBeFocused();
    // 换到下一个机场后，所属城市是「这个机场自己的建议城市」（没有建议时为空），不是上一个机场手工选的那个
    const picked = n % 2 === 0 ? nairobi.name : mombasa.name;
    const suggestedForNext = suggestedName.get(order[n + 1]?.id ?? "") ?? "";
    await expect(cityBox(page), "所属城市是这个机场自己的建议").toHaveValue(suggestedForNext);
    if (picked !== suggestedForNext) {
      notCarriedOver += 1;
      await expect(cityBox(page), "不沿用上一个机场选的城市").not.toHaveValue(picked);
    }
  }
  expect(notCarriedOver, "至少有一步手工选的不是下一个机场的建议城市，「不沿用上一个」才算验证过").toBeGreaterThan(0);
  await expect(page.getByRole("status").filter({ hasText: `下一个：${at(order, 30)} ${nameAt(order, 30)}，还剩 67 个` })).toHaveCount(1);
  await expect(page.locator(".done-list__item"), "「本次已处理」最多 10 条").toHaveCount(10);
  await expect(page.locator(".done-list__item").first(), "最新的在最上面").toContainText(at(order, 29));
  await expect(page.locator(".done-list__item").first()).toContainText(`→ ${mombasa.name}`);
  await expect(page.locator(".done-list__item").first().locator(".badge")).toHaveText("启用");
  await expect(toast(page, /^已启用「/), "同时最多 3 条 Toast").not.toHaveCount(4);

  // 选过的城市排在最前，带「最近用过」
  await cityBox(page).press("ArrowDown");
  const options = page.getByRole("listbox", { name: "所属城市" });
  await expect(options.getByText("最近用过")).toBeVisible();
  await expect(options.getByRole("option").first()).toContainText(mombasa.name);
  await page.keyboard.press("Escape");
  await expect(options).toBeHidden();
  await expect(cityBox(page), "Esc 只关面板，焦点留在输入框").toBeFocused();

  // 跳过两个（键盘：Tab 到「跳过」再按 Enter 太依赖 Tab 顺序，这里直接聚焦按钮按 Enter）：不减数量，换到下一个
  for (const n of [30, 31]) {
    await expect(code(page)).toHaveText(at(order, n));
    await page.getByRole("button", { name: "跳过" }).focus();
    await page.keyboard.press("Enter");
    await expect(code(page)).toHaveText(at(order, n + 1));
    await expect(remaining(page), "跳过的不减").toHaveText("还剩 67 个");
    await expect(cityBox(page), "跳过后焦点也回到所属城市").toBeFocused();
  }

  // 只保存不启用：减一，「本次已处理」里是已停用
  await page.keyboard.type(nairobi.name.slice(0, 3));
  await page.keyboard.press("Enter");
  await expect(cityBox(page)).toHaveValue(nairobi.name);
  await page.getByRole("button", { name: "只保存，先不启用" }).focus();
  await page.keyboard.press("Enter");
  await expect(toast(page, `已保存「${at(order, 32)}`)).toContainText("还没有启用");
  await expect(remaining(page)).toHaveText("还剩 66 个");
  await expect(page.locator(".done-list__item").first().locator(".badge")).toHaveText("已停用");
  await expect(code(page)).toHaveText(at(order, 33));

  // 没选城市直接按 Enter：不发请求，提示在字段下，焦点在所属城市
  // （这个机场有建议的城市、已经预填了：先清掉，才是「没选城市」）
  await cityBox(page).fill("");
  await page.keyboard.press("Escape");
  await cityBox(page).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("请选择所属城市")).toBeVisible();
  await expect(cityBox(page)).toBeFocused();
  await expect(cityBox(page)).toHaveAttribute("aria-invalid", "true");
  await expect(remaining(page)).toHaveText("还剩 66 个");

  // 刷新：从还没处理的第一个开始（跳过的两个排回前面），数量和接口一致
  await page.reload();
  await expect(remaining(page)).toHaveText("还剩 66 个");
  await expect(code(page)).toHaveText(at(order, 30));
  expect((await pendingOf(request, country)).total).toBe(66);
  await expect(page.getByRole("heading", { name: "本次已处理" }), "刷新后「本次已处理」清空").toHaveCount(0);

  // 去编辑页再后退：回到流水线页同一个国家、同一个机场
  await page.goto(`/platform/master/places?country=${country}&city=none`);
  await expect(page.getByText("共 66 条")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/pending\\?country=${country}$`));
  await expect(code(page)).toHaveText(at(order, 30));

  // 别人（另一个会话，经接口）把后面的大部分处理掉，只留最后 3 个；刷新后接着处理到最后一个
  const headers = await platformAdminHeaders(request);
  const left = (await pendingOf(request, country)).items;
  expect(left).toHaveLength(66);
  for (const place of left.slice(0, 63)) {
    const response = await request.post(`/platform/v1/master/places/${place.id}/enable`, { headers, data: { city_id: nairobi.id } });
    expect(response.status()).toBe(200);
  }
  await page.reload();
  await expect(remaining(page)).toHaveText("还剩 3 个");
  await cityBox(page).focus();
  for (let n = 0; n < 3; n += 1) {
    await expect(code(page)).toHaveText(left[63 + n]?.code ?? "");
    await assignByKeyboard(page, nairobi.name.slice(0, 3));
    if (n < 2) await expect(remaining(page)).toHaveText(`还剩 ${2 - n} 个`);
  }
  await expect(page.getByRole("heading", { name: "没有待指定城市的机场了" })).toBeVisible();
  await expect(page.getByText("这一批都处理完了。")).toBeVisible();
  await expect(remaining(page)).toHaveText("还剩 0 个");
  await expect(page.locator(".pending__code")).toHaveCount(0);
  expect((await pendingOf(request, country)).total).toBe(0);

  // 回到地点列表核对：这个国家 97 个机场，96 个启用、1 个只保存没启用；没有「待指定城市」
  await page.getByRole("link", { name: "回到地点列表" }).last().click();
  await expect(page).toHaveURL(/\/platform\/master\/places$/);
  await page.goto(`/platform/master/places?country=${country}`);
  await expect(page.getByText(`共 ${total} 条`)).toBeVisible();
  await page.goto(`/platform/master/places?country=${country}&status=active`);
  await expect(page.getByText(`共 ${total - 1} 条`)).toBeVisible();
  await page.goto(`/platform/master/places?country=${country}&city=none`);
  await expect(page.getByRole("heading", { name: "没有符合条件的机场" })).toBeVisible();
  await page.goto(`/platform/master/places/pending?country=${country}`);
  await expect(page.getByRole("heading", { name: "肯尼亚没有待指定城市的机场" })).toBeVisible();
});

test("处理导入的机场：新增城市对话框真实提交后立即可选并已选中，按 Enter 就完成；所选城市被别人停用时说明原因，换一个城市能继续", async ({ page, request }) => {
  test.slow();
  const country = "TZ";
  const prefix = "B";
  await importAirports(country, sampleAirports(prefix, 4));
  const order = (await pendingOf(request, country)).items;
  expect(order).toHaveLength(4);
  await signIn(page);
  await page.goto(`/platform/master/places/pending?country=${country}`);
  await expect(code(page)).toHaveText(at(order, 0));

  // 这个国家一个城市都没有：不能保存，提示先新增
  await expect(page.getByText("还没有坦桑尼亚（TZ）的启用中的城市。请先新增城市。")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存并启用" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "只保存，先不启用" })).toBeDisabled();

  // 对话框里新增城市（键盘为主）
  const cityCode = `CTY-${country}-${randomLetters(6)}`;
  const cityName = `达累斯萨拉姆${cityCode.slice(-4)}`;
  await page.getByRole("button", { name: "新增城市" }).click();
  const dialog = page.getByRole("dialog", { name: "新增城市" });
  await expect(dialog.getByLabel(/^编码/), "光标在前缀后面").toBeFocused();
  await expect(dialog.getByLabel(/^编码/)).toHaveValue(`CTY-${country}-`);
  await expect(dialog.getByText("坦桑尼亚（TZ）")).toBeVisible();
  await page.keyboard.type(cityCode.slice(-6).toLowerCase());
  await expect(dialog.getByLabel(/^编码/)).toHaveValue(cityCode);
  await dialog.getByLabel("名称 中文").fill(cityName);
  await dialog.getByRole("combobox", { name: /时区/ }).fill("dar_es");
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("combobox", { name: /时区/ })).toHaveValue(/Africa\/Dar_es_Salaam/);
  await dialog.getByRole("button", { name: "填入这个机场的坐标" }).click();
  const shownPoint = ((await page.locator(".pending__facts .mono").textContent()) ?? "").split(", ");
  expect(shownPoint[0]).toMatch(/^-1\.\d{6}$/);
  await expect(dialog.getByLabel(/^纬度/), "纬度在左").toHaveValue(shownPoint[0] ?? "");
  await expect(dialog.getByLabel(/^经度/)).toHaveValue(shownPoint[1] ?? "");
  // 点遮罩不关闭（表单对话框）
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();
  // 键盘：Tab 走到对话框底部的「新增城市」按钮再按 Enter（在输入框里直接按 Enter 不提交，见本文件末尾的缺陷用例）
  await dialog.getByRole("button", { name: "新增城市" }).focus();
  await page.keyboard.press("Enter");
  await expect(toast(page, `已新增城市「${cityName}」`)).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(cityBox(page), "新城市已经选好").toHaveValue(cityName);
  await expect(page.getByRole("button", { name: "保存并启用" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(toast(page, `已启用「${at(order, 0)}`)).toBeVisible();
  await expect(code(page)).toHaveText(at(order, 1));
  await expect(page.locator(".done-list__item").first()).toContainText(`→ ${cityName}`);

  // 再新增一个：时区沿用同一个国家最近新增的城市；编码重复时提示在编码下，内容保留
  await page.getByRole("button", { name: "新增城市" }).click();
  await expect(dialog.getByRole("combobox", { name: /时区/ }), "时区沿用上一个").toHaveValue(/Africa\/Dar_es_Salaam/);
  await dialog.getByLabel(/^编码/).fill(cityCode);
  await dialog.getByLabel("名称 中文").fill("重复编码的城市");
  await dialog.getByLabel(/^纬度/).fill("-6.8");
  await dialog.getByLabel(/^经度/).fill("39.28");
  await dialog.getByRole("button", { name: "新增城市" }).click();
  await expect(dialog.getByText("这个编码已经被使用，请换一个")).toBeVisible();
  await expect(dialog.getByLabel("名称 中文")).toHaveValue("重复编码的城市");
  // Esc：直接关闭，不再弹确认
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(cityBox(page), "取消后没有选上任何城市").toHaveValue("");

  // 选好城市后，别人把这个城市停用了：城市下有启用中的机场时停不掉，所以另建一个空城市来停
  const other = await createCity(request, country, "Africa/Dar_es_Salaam", `多多马${randomLetters(4)}`);
  await page.reload();
  await expect(code(page)).toHaveText(at(order, 1));
  await cityBox(page).click();
  await cityBox(page).fill(other.name);
  await page.getByRole("option", { name: new RegExp(other.name) }).click();
  const headers = await platformAdminHeaders(request);
  expect((await request.post(`/platform/v1/master/cities/${other.id}/disable`, { headers })).status()).toBe(200);
  await page.getByRole("button", { name: "保存并启用" }).click();
  await expect(page.getByText(/这个城市已经停用/)).toBeVisible();
  await expect(code(page), "没有换下一个").toHaveText(at(order, 1));
  await expect(page.locator(".pending__head .badge")).toHaveText("已停用");
  expect((await pendingOf(request, country)).items.map((item) => item.code), "被拒绝的没有留下半截状态").toContain(at(order, 1));
  // 城市清单重新取过：停用的城市不再是选项
  await cityBox(page).click();
  await cityBox(page).fill("");
  await expect(page.getByRole("listbox", { name: "所属城市" }).getByRole("option")).toHaveText([new RegExp(cityName)]);
  await page.getByRole("option", { name: new RegExp(cityName) }).click();
  await page.keyboard.press("Enter");
  await expect(toast(page, `已启用「${at(order, 1)}`)).toBeVisible();
  await expect(code(page)).toHaveText(at(order, 2));
});

test("处理导入的机场：连按两下 Enter、连点两下按钮只处理一个；断网时内容还在，恢复后再按一次就好；顺手改了名称时先保存再启用", async ({ page, request, context }) => {
  test.slow();
  const country = "UG";
  const prefix = "C";
  const city = await createCity(request, country, "Africa/Kampala", `坎帕拉${randomLetters(4)}`);
  await importAirports(country, sampleAirports(prefix, 5));
  const order = (await pendingOf(request, country)).items;
  expect(order).toHaveLength(5);
  await signIn(page);
  await page.goto(`/platform/master/places/pending?country=${country}`);
  await expect(code(page)).toHaveText(at(order, 0));

  const writes: string[] = [];
  page.on("request", (sent) => {
    if (sent.method() !== "GET" && sent.url().includes("/platform/v1/master/places/")) writes.push(`${sent.method()} ${new URL(sent.url()).pathname.split("/").slice(-2).join("/")}`);
  });

  // 连点两下「保存并启用」
  await cityBox(page).fill(city.name);
  await page.getByRole("option", { name: new RegExp(city.name) }).click();
  await page.getByRole("button", { name: "保存并启用" }).dblclick();
  await expect(code(page)).toHaveText(at(order, 1));
  await expect(remaining(page)).toHaveText("还剩 4 个");
  await page.waitForTimeout(500);
  expect(writes.filter((entry) => entry.endsWith("/enable")), "只发了一次启用").toHaveLength(1);
  expect((await pendingOf(request, country)).total, "只处理了一个").toBe(4);

  // 断网：提示留在卡片上，城市和补的名称都还在；恢复后直接再按
  await cityBox(page).fill(city.name);
  await page.getByRole("option", { name: new RegExp(city.name) }).click();
  await page.getByLabel("名称 中文").fill("恩德培机场");
  await context.setOffline(true);
  await page.getByRole("button", { name: "保存并启用" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "网络连接失败，请检查网络后重试。你填写的内容还在。" })).toBeVisible();
  await expect(cityBox(page)).toHaveValue(city.name);
  await expect(page.getByLabel("名称 中文")).toHaveValue("恩德培机场");
  await expect(code(page)).toHaveText(at(order, 1));
  await context.setOffline(false);
  writes.length = 0;
  await page.getByRole("button", { name: "保存并启用" }).click();
  await expect(toast(page, `已启用「${at(order, 1)} 恩德培机场」`)).toBeVisible();
  await expect(code(page)).toHaveText(at(order, 2));
  expect(writes, "改了名称：先保存（带版本号），再启用").toEqual([`PATCH places/${(await placeByCode(request, at(order, 1))).id}`, `POST ${(await placeByCode(request, at(order, 1))).id}/enable`]);
  const saved = await placeByCode(request, at(order, 1));
  expect(saved.name).toEqual({ zh: "恩德培机场", en: nameAt(order, 1) });
  expect(saved.status).toBe("active");
  expect(saved.source?.overridden, "只补中文名不算改了数据源的内容").toBe(false);

  // 改了英语名：字段旁立即提示不再随导入更新；保存后来源标成「已改过」
  await page.getByLabel("名称 英语").fill("Renamed By QA Airport");
  await expect(page.getByText("保存后，这个机场的英语名和坐标不再随 OurAirports 更新。")).toBeVisible();
  await cityBox(page).fill(city.name);
  await page.getByRole("option", { name: new RegExp(city.name) }).click();
  await page.getByRole("button", { name: "只保存，先不启用" }).click();
  await expect(toast(page, "还没有启用")).toBeVisible();
  const renamed = await placeByCode(request, at(order, 2));
  expect([renamed.name["en"], renamed.status, renamed.source?.overridden]).toEqual(["Renamed By QA Airport", "disabled", true]);

  // 名称全清空：不发请求，提示至少一种语言
  await expect(code(page)).toHaveText(at(order, 3));
  await cityBox(page).fill(city.name);
  await page.getByRole("option", { name: new RegExp(city.name) }).click();
  await page.getByLabel("名称 英语").fill("   ");
  writes.length = 0;
  await page.getByRole("button", { name: "保存并启用" }).click();
  await expect(page.getByText("至少填一种语言")).toBeVisible();
  expect(writes).toEqual([]);
  await expect(code(page)).toHaveText(at(order, 3));
});

interface PlaceBody {
  id: string;
  code: string;
  status: string;
  version: number;
  city_id: string | null;
  name: Record<string, string>;
  source: { overridden: boolean } | null;
}

async function placeByCode(request: APIRequestContext, placeCode: string): Promise<PlaceBody> {
  const headers = await platformAdminHeaders(request);
  const response = await request.get(`/platform/v1/master/places?code=${placeCode}`, { headers });
  const body = (await response.json()) as { items: PlaceBody[] };
  expect(body.items).toHaveLength(1);
  return body.items[0] as PlaceBody;
}

test("处理导入的机场：别人刚改过当前这个机场——只改了名称的，载入最新内容并保留我选的城市；已经指定了城市的，自动换下一个并说明", async ({ page, request }) => {
  test.slow();
  const country = "RW";
  const prefix = "D";
  const city = await createCity(request, country, "Africa/Kigali", `基加利${randomLetters(4)}`);
  await importAirports(country, sampleAirports(prefix, 4));
  const order = (await pendingOf(request, country)).items;
  expect(order).toHaveLength(4);
  const headers = await platformAdminHeaders(request);
  await signIn(page);
  await page.goto(`/platform/master/places/pending?country=${country}`);
  await expect(code(page)).toHaveText(at(order, 0));

  // 别人改了名称（版本变了，仍然没有城市）；我补了韩语名再保存 → 被版本号拦下
  const first = await placeByCode(request, at(order, 0));
  const renamed = await request.patch(`/platform/v1/master/places/${first.id}`, { headers: { ...headers, "if-match": `"${first.version}"` }, data: { name: { ...first.name, zh: "别人补的中文名" } } });
  expect(renamed.status()).toBe(200);
  await cityBox(page).fill(city.name);
  await page.getByRole("option", { name: new RegExp(city.name) }).click();
  await page.getByLabel("名称 韩语").fill("내가 쓴 이름");
  await page.getByRole("button", { name: "保存并启用" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "这个机场刚被别人修改过，已载入最新内容，请再确认一次。" })).toBeVisible();
  await expect(code(page)).toHaveText(at(order, 0));
  await expect(page.getByLabel("名称 中文"), "载入了别人改的内容").toHaveValue("别人补的中文名");
  await expect(cityBox(page), "保留我选的城市").toHaveValue(city.name);
  await page.getByRole("button", { name: "保存并启用" }).click();
  await expect(toast(page, `已启用「${at(order, 0)}`)).toBeVisible();
  await expect(code(page)).toHaveText(at(order, 1));
  expect((await placeByCode(request, at(order, 0))).name["zh"], "没有盖掉别人的修改").toBe("别人补的中文名");

  // 别人已经给它指定了城市并启用；我顺手补了名称再保存 → 自动换下一个并说明
  const second = await placeByCode(request, at(order, 1));
  expect((await request.post(`/platform/v1/master/places/${second.id}/enable`, { headers, data: { city_id: city.id } })).status()).toBe(200);
  await cityBox(page).fill(city.name);
  await page.getByRole("option", { name: new RegExp(city.name) }).click();
  await page.getByLabel("名称 中文").fill("我补的名字");
  await page.getByRole("button", { name: "保存并启用" }).click();
  await expect(page.getByText(`「${at(order, 1)} ${nameAt(order, 1)}」刚被别人处理过了，已为你换到下一个。`)).toBeVisible();
  await expect(code(page)).toHaveText(at(order, 2));
  await expect(remaining(page)).toHaveText("还剩 2 个");
  expect((await placeByCode(request, at(order, 1))).name["zh"], "我的修改没有写进去").toBeUndefined();
  await page.getByRole("button", { name: "知道了" }).click();
  await expect(page.getByText(/刚被别人处理过了/)).toHaveCount(0);

  // 别人用同一个城市启用了它，我只选了城市按 Enter：结果一样，照常换下一个
  const third = await placeByCode(request, at(order, 2));
  expect((await request.post(`/platform/v1/master/places/${third.id}/enable`, { headers, data: { city_id: city.id } })).status()).toBe(200);
  await cityBox(page).fill(city.name);
  await page.getByRole("option", { name: new RegExp(city.name) }).click();
  await page.getByRole("button", { name: "保存并启用" }).click();
  await expect(code(page)).toHaveText(at(order, 3));
  await expect(remaining(page)).toHaveText("还剩 1 个");
});

test("【缺陷】处理导入的机场：别人已经给当前这个机场指定了别的城市，我只选城市按「保存并启用」——应当自动换下一个并说明，实际卡在原地并提示「这个城市已经停用」", async ({ page, request }) => {
  test.slow();
  const country = "ET";
  const prefix = "E";
  const mine = await createCity(request, country, "Africa/Addis_Ababa", `亚的斯亚贝巴${randomLetters(4)}`);
  const theirs = await createCity(request, country, "Africa/Addis_Ababa", `德雷达瓦${randomLetters(4)}`);
  await importAirports(country, sampleAirports(prefix, 3));
  const order = (await pendingOf(request, country)).items;
  expect(order).toHaveLength(3);
  const headers = await platformAdminHeaders(request);
  await signIn(page);
  await page.goto(`/platform/master/places/pending?country=${country}`);
  await expect(code(page)).toHaveText(at(order, 0));

  // 另一个人（另一个标签页 / 另一位同事）先一步把它指定到了别的城市并启用
  const current = await placeByCode(request, at(order, 0));
  expect((await request.post(`/platform/v1/master/places/${current.id}/enable`, { headers, data: { city_id: theirs.id } })).status()).toBe(200);

  await cityBox(page).fill(mine.name);
  await page.getByRole("option", { name: new RegExp(mine.name) }).click();
  await page.getByRole("button", { name: "保存并启用" }).click();

  // master-data.md 4.5：它已经有城市了 → 从队列里去掉、换下一个，提示「刚被别人处理过了，已为你换到下一个。」
  await expect(page.getByText(/这个城市已经停用/), "城市并没有停用，不应该让人去换城市").toHaveCount(0, { timeout: 5_000 });
  await expect(code(page), "应当换到下一个").toHaveText(at(order, 1));
  await expect(page.getByText(`「${at(order, 0)} ${nameAt(order, 0)}」刚被别人处理过了，已为你换到下一个。`)).toBeVisible();
  await expect(remaining(page)).toHaveText("还剩 2 个");
  expect((await placeByCode(request, at(order, 0))).city_id, "别人指定的城市没有被改掉").toBe(theirs.id);
});

test("【缺陷】处理导入的机场：新增城市对话框里填完后在输入框按 Enter 应当提交（页面其余表单都是这样），实际没有任何反应", async ({ page }) => {
  const country = "SO";
  const prefix = "F";
  await importAirports(country, sampleAirports(prefix, 1));
  await signIn(page);
  await page.goto(`/platform/master/places/pending?country=${country}`);
  await expect(code(page)).toBeVisible();
  const cityCode = `CTY-${country}-${randomLetters(6)}`;
  const cityName = `摩加迪沙${cityCode.slice(-4)}`;
  await page.getByRole("button", { name: "新增城市" }).click();
  const dialog = page.getByRole("dialog", { name: "新增城市" });
  await dialog.getByLabel(/^编码/).fill(cityCode);
  await dialog.getByLabel("名称 中文").fill(cityName);
  await dialog.getByRole("combobox", { name: /时区/ }).fill("mogadishu");
  await page.keyboard.press("Enter");
  await dialog.getByLabel(/^纬度/).fill("2.046934");
  await dialog.getByLabel(/^经度/).fill("45.318162");
  // 02-components.md 第 4 节的表单都能用 Enter 提交；流水线页是为「全程不用碰鼠标」设计的（master-data.md 4.3）
  await dialog.getByLabel(/^经度/).press("Enter");
  await expect(toast(page, `已新增城市「${cityName}」`)).toBeVisible({ timeout: 5_000 });
  await expect(dialog).toHaveCount(0);
  await expect(cityBox(page)).toHaveValue(cityName);
});
