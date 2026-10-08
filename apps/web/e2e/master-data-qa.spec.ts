/**
 * M1-08 主数据列表、表单、权限、首页统计的边界（测试角色补的用例），真实后端、真实 PostgreSQL。
 * 数据全部由用例自己准备；并行的用例共用一个库，所以每条用例用自己的国家和随机编码，断言不依赖全库的数量。
 */
import { AxeBuilder } from "@axe-core/playwright";
import { type APIRequestContext, type Page, type Request, expect, test } from "@playwright/test";
import {
  adminCredentials,
  createActiveTenant,
  createTemporaryPasswordAdmin,
  expectNoHorizontalOverflow,
  fillLogin,
  importAirports,
  loginAs,
  newPassword,
  platformAdminHeaders,
  randomLetters,
  uniqueEmail,
} from "./support.ts";

const MASTER = "/platform/v1/master";

async function expectAccessible(page: Page, what: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = results.violations.map((violation) => `${violation.id}: ${violation.help}（${violation.nodes.map((node) => node.target.join(" ")).join("；")}）`);
  expect(summary, `${what} 的无障碍问题`).toEqual([]);
}

async function signInAsAdmin(page: Page): Promise<void> {
  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);
}

async function post<T>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const headers = await platformAdminHeaders(request);
  const response = await request.post(`${MASTER}/${path}`, { headers, data });
  expect(response.status(), `接口新建 ${path}：${await response.text()}`).toBe(201);
  return (await response.json()) as T;
}

async function getJson<T>(request: APIRequestContext, path: string): Promise<T> {
  const headers = await platformAdminHeaders(request);
  const response = await request.get(path, { headers });
  expect(response.status(), path).toBe(200);
  return (await response.json()) as T;
}

interface Row {
  id: string;
  code: string;
  version: number;
  status: string;
  name: Record<string, string>;
}
interface ListBody {
  items: Row[];
  total: number;
  next_cursor: string | null;
}

async function createCity(request: APIRequestContext, country: string, timezone: string, name: Record<string, string>): Promise<Row> {
  return post<Row>(request, "cities", { code: `CTY-${country}-${randomLetters(6)}`, country_code: country, name, timezone, center: { lng: -0.186964, lat: 5.603717 } });
}

function iata(prefix: string, n: number): string {
  return `${prefix}${String.fromCharCode(65 + Math.floor(n / 26))}${String.fromCharCode(65 + (n % 26))}`;
}

const rowOf = (page: Page, code: string) => page.getByRole("row").filter({ has: page.getByRole("link", { name: code, exact: true }) });
const codesOnPage = (page: Page) => page.locator("tbody th[scope=row] a");
const toast = (page: Page, text: string | RegExp) => page.locator(".toast").filter({ hasText: text });
const searchBox = (page: Page) => page.getByRole("searchbox", { name: "按编码或名称搜索" });
const pager = (page: Page) => page.getByRole("navigation", { name: "分页" });

/** 等列表按现在的条件取完（表格不再是「正在刷新」）。 */
async function settled(page: Page): Promise<void> {
  await expect(page.locator(".table-wrap")).not.toHaveAttribute("aria-busy", "true");
}

/* ───────────── 列表：分页、筛选、关键字 ───────────── */

test("机场列表超过一页（120 个）：游标翻页前进后退不重不漏、total 与实际一致；改每页条数、改筛选回到第一页；关键字里的 % _ 空格 表情按字面查", async ({ page, request }) => {
  test.setTimeout(180_000);
  const country = "GH";
  const prefix = "G";
  const total = 120;
  const special: Record<number, string> = { 3: "QA G 100%_done Airport", 4: "QA G emoji 😀 Airport", 5: "QA G two  spaces Airport", 6: `QA G ${"Unbroken".repeat(12)} Airport` };
  await importAirports(country, Array.from({ length: total }, (_, n) => ({ iata: iata(prefix, n), name: special[n] ?? `QA G Airport ${String(n + 1).padStart(3, "0")}`, lat: 5.6 + n / 1000, lng: -0.17 - n / 1000 })));
  const city = await createCity(request, country, "Africa/Accra", { zh: `阿克拉${randomLetters(4)}` });
  const all = (await getJson<ListBody>(request, `${MASTER}/places?type=airport&country_code=${country}&sort=code&limit=200`)).items;
  expect(all).toHaveLength(total);
  const headers = await platformAdminHeaders(request);
  // 前 10 个启用（有城市），其余停用、待指定城市
  for (const place of all.slice(0, 10)) expect((await request.post(`${MASTER}/places/${place.id}/enable`, { headers, data: { city_id: city.id } })).status()).toBe(200);
  const order = all.map((place) => place.code);
  await signInAsAdmin(page);

  // 第一页：默认每页 50 条
  await page.goto(`/platform/master/places?country=${country}`);
  await expect(pager(page).getByText(`共 ${total} 条`)).toBeVisible();
  await expect(codesOnPage(page)).toHaveText(order.slice(0, 50));
  await expect(pager(page).getByRole("button", { name: "上一页" })).toBeDisabled();
  await expect(pager(page).getByRole("combobox")).toHaveValue("50");

  // 前进到最后一页
  await pager(page).getByRole("button", { name: "下一页" }).click();
  await expect(codesOnPage(page)).toHaveText(order.slice(50, 100));
  await expect(pager(page).getByText(`共 ${total} 条`), "每一页的总数都一样").toBeVisible();
  await pager(page).getByRole("button", { name: "下一页" }).click();
  await expect(codesOnPage(page)).toHaveText(order.slice(100));
  await expect(pager(page).getByRole("button", { name: "下一页" }), "最后一页").toBeDisabled();
  expect(page.url(), "游标不写进网址").not.toMatch(/cursor/);

  // 后退两页，回到第一页
  await pager(page).getByRole("button", { name: "上一页" }).click();
  await expect(codesOnPage(page)).toHaveText(order.slice(50, 100));
  await pager(page).getByRole("button", { name: "上一页" }).click();
  await expect(codesOnPage(page)).toHaveText(order.slice(0, 50));
  await expect(pager(page).getByRole("button", { name: "上一页" })).toBeDisabled();

  // 翻到第二页后改每页条数：回到第一页，写进网址；刷新后保留
  await pager(page).getByRole("button", { name: "下一页" }).click();
  await expect(codesOnPage(page).first()).toHaveText(order[50] ?? "");
  await pager(page).getByRole("combobox").selectOption("20");
  await expect(page).toHaveURL(/[?&]size=20(&|$)/);
  await expect(codesOnPage(page)).toHaveText(order.slice(0, 20));
  await expect(pager(page).getByRole("button", { name: "上一页" })).toBeDisabled();
  await page.reload();
  await expect(codesOnPage(page)).toHaveText(order.slice(0, 20));
  await expect(pager(page).getByRole("combobox")).toHaveValue("20");

  // 翻到第三页后改筛选：回到第一页，总数跟着筛选变
  await pager(page).getByRole("button", { name: "下一页" }).click();
  await pager(page).getByRole("button", { name: "下一页" }).click();
  await expect(codesOnPage(page)).toHaveText(order.slice(40, 60));
  await page.getByLabel("状态").selectOption("disabled");
  await expect(page).toHaveURL(/[?&]status=disabled(&|$)/);
  await expect(pager(page).getByText(`共 ${total - 10} 条`)).toBeVisible();
  await expect(codesOnPage(page)).toHaveText(order.slice(10, 30));
  await expect(pager(page).getByRole("button", { name: "上一页" })).toBeDisabled();
  await page.getByLabel("状态").selectOption("active");
  await expect(pager(page).getByText("共 10 条")).toBeVisible();
  await expect(codesOnPage(page)).toHaveText(order.slice(0, 10));
  await expect(pager(page).getByRole("button", { name: "下一页" }), "只有一页").toBeDisabled();

  // 筛选组合：所属城市 + 状态 + 国家；「待指定城市」+ 启用是空的
  await page.goto(`/platform/master/places?country=${country}&city=${city.id}&status=active`);
  await expect(pager(page).getByText("共 10 条")).toBeVisible();
  await expect(page.getByText(`正在查看城市「${city.name["zh"]}」下启用中的地点。车站、地标请切换页签查看。`)).toBeVisible();
  await page.goto(`/platform/master/places?country=${country}&city=none`);
  await expect(pager(page).getByText(`共 ${total - 10} 条`)).toBeVisible();
  await expect(page.locator("tbody tr").first()).toContainText("待指定城市");
  await page.goto(`/platform/master/places?country=${country}&city=none&status=active`);
  await expect(page.getByRole("heading", { name: "没有符合条件的机场" })).toBeVisible();
  await expect(pager(page).getByText("共 0 条")).toBeVisible();
  await page.getByRole("button", { name: "清空筛选" }).last().click();
  await expect(page).toHaveURL(/\/platform\/master\/places$/);

  // 关键字：特殊字符按字面
  const find = async (text: string, expected: string[]): Promise<void> => {
    await page.goto(`/platform/master/places?country=${country}`);
    await settled(page);
    await searchBox(page).fill(text);
    await searchBox(page).press("Enter");
    await settled(page);
    await expect(pager(page).getByText(`共 ${expected.length} 条`), `搜索 ${JSON.stringify(text)}`).toBeVisible();
    await expect(codesOnPage(page), `搜索 ${JSON.stringify(text)}`).toHaveText(expected);
  };
  await find("100%", [order[order.indexOf(iata(prefix, 3))] ?? ""]);
  await find("%", [iata(prefix, 3)]);
  await find("_", [iata(prefix, 3)]);
  await find("%_d", [iata(prefix, 3)]);
  await find("😀", [iata(prefix, 4)]);
  await find("  two  spaces  ", [iata(prefix, 5)]);
  await expect(page, "首尾空格去掉，中间的保留").toHaveURL(/[?&]q=two\+\+spaces(&|$)/);
  await find("two spaces", []);
  await find(iata(prefix, 7).toLowerCase(), [iata(prefix, 7)]);
  await find("\\", []);
  await find("' or 1=1 --", []);
  // 超长：输入框最多 100 个字，不会把后端拒绝的长度发出去
  await page.goto(`/platform/master/places?country=${country}`);
  await searchBox(page).fill("x".repeat(150));
  await expect(searchBox(page)).toHaveValue("x".repeat(100));
  await searchBox(page).press("Enter");
  await expect(page.getByRole("heading", { name: "没有符合条件的机场" })).toBeVisible();
  // 「清除搜索」回到全部
  await page.getByRole("button", { name: "清除搜索" }).click();
  await expect(pager(page).getByText(`共 ${total} 条`)).toBeVisible();
  expect(page.url()).not.toMatch(/[?&]q=/);

  // 超长不带空格的名称：只在表格容器里滚动，页面不横向滚动
  await find("Unbroken", [iata(prefix, 6)]);
  await expectNoHorizontalOverflow(page, "超长名称的机场列表 1280px");

  // 列表开着的时候数据变了：在第一页时别人启用了后面的 3 个，下一页照常，不重复
  await page.goto(`/platform/master/places?country=${country}&status=disabled&size=20`);
  await expect(codesOnPage(page)).toHaveText(order.slice(10, 30));
  for (const place of all.slice(12, 15)) expect((await request.post(`${MASTER}/places/${place.id}/enable`, { headers, data: { city_id: city.id } })).status()).toBe(200);
  await pager(page).getByRole("button", { name: "下一页" }).click();
  await expect(codesOnPage(page)).toHaveText(order.slice(30, 50));
  await expect(pager(page).getByText(`共 ${total - 13} 条`)).toBeVisible();
});

test("地址栏参数被改坏：每页条数、状态、页签、城市、国家、关键字写成不认识的值时按默认值显示，不报错、不把坏值发给接口", async ({ page }) => {
  await signInAsAdmin(page);
  const sent: URL[] = [];
  page.on("request", (request: Request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith(`${MASTER}/`)) sent.push(url);
  });
  const failed: number[] = [];
  page.on("response", (response) => {
    if (response.url().includes(`${MASTER}/`) && response.status() >= 400) failed.push(response.status());
  });

  await page.goto(`/platform/master/places?size=7&status=zzz&type=terminal&city=not-a-uuid&country=jp&q=${encodeURIComponent("   ")}&cursor=abc&limit=9999`);
  await settled(page);
  await expect(page.getByRole("tab", { name: "机场" })).toHaveAttribute("aria-selected", "true");
  await expect(pager(page).getByRole("combobox")).toHaveValue("50");
  await expect(page.getByLabel("状态")).toHaveValue("all");
  await expect(searchBox(page)).toHaveValue("");
  await expect(page.getByRole("heading", { name: "加载失败" })).toHaveCount(0);
  const list = sent.filter((url) => url.pathname === `${MASTER}/places`).at(-1);
  expect(Object.fromEntries(list?.searchParams ?? []), "只发认识的条件（默认按编码排）").toEqual({ limit: "50", sort: "code", status: "all", type: "airport" });

  sent.length = 0;
  await page.goto(`/platform/master/cities?q=${"长".repeat(300)}&size=100&country=ZZ&status=active`);
  await settled(page);
  const cities = sent.filter((url) => url.pathname === `${MASTER}/cities` && url.searchParams.get("limit") === "100").at(-1);
  expect(cities?.searchParams.get("q"), "关键字截到 100 个字").toBe("长".repeat(100));
  await expect(page.getByRole("heading", { name: "没有符合条件的城市" })).toBeVisible();

  for (const path of ["/platform/master/vehicle-groups?grade=supreme&size=-1", "/platform/master/addons?status=&q=&size=1e2", "/platform/master/places?type=poi&city=none", "/platform/master/places/pending?country=xx&start=1%27%20or%201=1"]) {
    await page.goto(path);
    await expect(page.locator("main h1")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "加载失败" }), path).toHaveCount(0);
  }
  expect(failed, "没有任何一个接口请求被拒绝").toEqual([]);

  // 编号格式不对、或不存在的记录：显示「找不到」，有回列表的按钮
  for (const [path, title, back] of [
    ["/platform/master/cities/not-a-uuid", "找不到这个城市", "回到城市列表"],
    ["/platform/master/places/99999999-9999-4999-8999-999999999999", "找不到这个机场", "回到地点列表"],
    ["/platform/master/vehicle-groups/%3Cscript%3E", "找不到这个车型组", "回到车型组列表"],
    ["/platform/master/places/new?type=terminal&parent=99999999-9999-4999-8999-999999999999", "找不到所属的机场", "回到地点列表"],
    ["/platform/master/places/new?type=exit", "找不到所属的车站", "回到地点列表"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: title }), path).toBeVisible();
    await expect(page.getByRole("link", { name: back })).toBeVisible();
  }
});

test("【缺陷】从列表第二页点进编辑页再回来（取消、保存、浏览器后退），应当回到离开时的那一页，实际每次都回到第一页", async ({ page, request }) => {
  const country = "BJ";
  const prefix = "H";
  await importAirports(country, Array.from({ length: 45 }, (_, n) => ({ iata: iata(prefix, n), name: `QA H Airport ${String(n + 1).padStart(3, "0")}`, lat: 6.35 + n / 1000, lng: 2.38 + n / 1000 })));
  const order = (await getJson<ListBody>(request, `${MASTER}/places?type=airport&country_code=${country}&sort=code&limit=200`)).items.map((item) => item.code);
  await signInAsAdmin(page);
  await page.goto(`/platform/master/places?country=${country}&size=20`);
  await expect(codesOnPage(page)).toHaveText(order.slice(0, 20));
  await pager(page).getByRole("button", { name: "下一页" }).click();
  await expect(codesOnPage(page)).toHaveText(order.slice(20, 40));

  // 02-components.md 第 6 节：「从列表进编辑页再回来时，列表要恢复到离开时的那一页」；master-data.md 5.3：「带着它的筛选条件和页码」
  await rowOf(page, order[25] ?? "").getByRole("link", { name: /^编辑/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("QA H Airport");
  await page.getByRole("button", { name: "取消" }).click();
  await expect(page, "筛选条件和每页条数是保留的").toHaveURL(new RegExp(`country=${country}&size=20$`));
  await expect(codesOnPage(page).first(), "取消后应当还在第二页").toHaveText(order[20] ?? "", { timeout: 5_000 });
});

/* ───────────── 表单 ───────────── */

test("编辑城市：只提交改过的字段、名称整体提交不丢语言、清空一种语言就是删掉它；坐标一起提交；编码和国家改不了；什么都没改不发请求", async ({ page, request }) => {
  test.slow();
  const country = "SN";
  const names = { zh: `达喀尔${randomLetters(4)}`, ja: "ダカール", en: "Dakar", ko: "다카르" };
  const city = await createCity(request, country, "Africa/Dakar", names);
  await signInAsAdmin(page);
  const bodies: { headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  page.on("request", (sent) => {
    if (sent.method() === "PATCH") bodies.push({ headers: sent.headers(), body: sent.postDataJSON() as Record<string, unknown> });
  });
  const open = async (): Promise<void> => {
    await page.goto(`/platform/master/cities?q=${city.code}`);
    await rowOf(page, city.code).getByRole("link", { name: city.code, exact: true }).click();
    await expect(page.getByLabel("名称 中文")).toHaveValue(names.zh);
  };

  await open();
  await expect(page.getByLabel(/^编码/), "编码只读").toHaveAttribute("readonly", "");
  await expect(page.getByLabel(/^编码/)).toHaveValue(city.code);
  await page.getByLabel(/^编码/).focus();
  await page.keyboard.type("X");
  await expect(page.getByLabel(/^编码/), "敲键盘改不了").toHaveValue(city.code);
  await expect(page.getByRole("combobox", { name: /国家/ }), "国家不是可选的控件").toHaveCount(0);
  await expect(page.getByText("塞内加尔（SN）")).toBeVisible();
  await expect(page.getByText("创建后不能修改。").first()).toBeVisible();

  // 什么都没改：不发请求，回到来的地方（带着筛选条件）
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/platform/master/cities\\?q=${city.code}$`));
  expect(bodies).toEqual([]);
  await expect(page.locator(".toast")).toHaveCount(0);

  // 改了又改回去：算没改
  await open();
  await page.getByLabel("名称 日语").fill("改一下");
  await page.getByLabel("名称 日语").fill(`  ${names.ja}  `);
  await page.getByLabel(/^纬度/).fill("5.6037170");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/platform/master/cities\\?q=${city.code}$`));
  expect(bodies, "首尾空格、多写的小数位不算改动").toEqual([]);

  // 只改日语名：请求体只有 name，而且四种语言都带着
  await open();
  await page.getByLabel("名称 日语").fill("ダカール市");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(toast(page, `已保存「${names.zh}」`)).toBeVisible();
  expect(bodies).toHaveLength(1);
  expect(bodies[0]?.body).toEqual({ name: { ...names, ja: "ダカール市" } });
  expect(bodies[0]?.headers["if-match"]).toBe(`"${city.version}"`);
  let saved = await getJson<Row & { center: { lat: number; lng: number }; timezone: string }>(request, `${MASTER}/cities/${city.id}`);
  expect(saved.name, "别的语言没有丢").toEqual({ ...names, ja: "ダカール市" });

  // 清空韩语 + 只改纬度：name 整体提交且没有韩语；center 带上没改的经度；时区没改不提交
  await open();
  await page.getByLabel("名称 韩语").fill("");
  await page.getByLabel(/^纬度/).fill("14.7167");
  await page.getByLabel(/^纬度/).blur();
  await expect(page.getByLabel(/^纬度/)).toHaveValue("14.716700");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(toast(page, "已保存")).toBeVisible();
  expect(bodies[1]?.body).toEqual({ name: { zh: names.zh, ja: "ダカール市", en: names.en }, center: { lat: 14.7167, lng: -0.186964 } });
  expect(bodies[1]?.headers["if-match"]).toBe(`"${city.version + 1}"`);
  saved = await getJson(request, `${MASTER}/cities/${city.id}`);
  expect(saved.name).toEqual({ zh: names.zh, ja: "ダカール市", en: names.en });
  expect(saved.center).toEqual({ lat: 14.7167, lng: -0.186964 });
  expect(saved.timezone).toBe("Africa/Dakar");

  // 粘贴「经度, 纬度」：自动对调并提示
  await open();
  await page.getByLabel(/^纬度/).focus();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text", "139.779694，35.552258");
    document.activeElement?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(page.getByLabel(/^纬度/)).toHaveValue("35.552258");
  await expect(page.getByLabel(/^经度/)).toHaveValue("139.779694");
  await expect(page.getByText("看起来是经度在前，已自动对调。请核对。")).toBeVisible();

  // 所有语言都清空：不发请求
  for (const language of ["中文", "日语", "英语"]) await page.getByLabel(`名称 ${language}`).fill(language === "英语" ? "​ 　" : "");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("至少填一种语言", { exact: true })).toBeVisible();
  await expect(page.getByText(/有 1 处需要修改/)).toBeVisible();
  expect(bodies).toHaveLength(2);
});

test("保存时的意外：连点两下只新增一条；断网时提示留在表单上、内容都在，恢复后再点就好；登录过期回登录页，重新登录回到原来的页面", async ({ page, request, context }) => {
  test.slow();
  await signInAsAdmin(page);
  const suffix = randomLetters(6);
  const addonCode = `ADD-QA_${suffix}`;
  const posts: string[] = [];
  page.on("request", (sent) => {
    if (sent.method() === "POST" && sent.url().includes(`${MASTER}/addons`)) posts.push(sent.url());
  });

  await page.goto("/platform/master/addons/new");
  await page.getByLabel(/^编码/).fill(addonCode);
  await page.getByLabel("名称 中文").fill(`迎宾牌${suffix}`);
  await page.getByLabel("接送机").check();
  await page.getByLabel(/按次/).check();

  // 断网
  await context.setOffline(true);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "网络连接失败，请检查网络后重试。你填写的内容还在。" })).toBeVisible();
  await expect(page.getByLabel(/^编码/)).toHaveValue(addonCode);
  await expect(page.getByLabel("名称 中文")).toHaveValue(`迎宾牌${suffix}`);
  await expect(page.getByLabel("接送机")).toBeChecked();
  await expect(page.getByRole("button", { name: "保存", exact: true }), "可以直接再点").toBeEnabled();
  await context.setOffline(false);

  // 恢复后连点两下
  posts.length = 0;
  await page.getByRole("button", { name: "保存", exact: true }).dblclick();
  await expect(toast(page, `已新增附加服务「迎宾牌${suffix}」`)).toBeVisible();
  await expect(page).toHaveURL(/\/platform\/master\/addons$/);
  await page.waitForTimeout(500);
  expect(posts, "只发了一次新增").toHaveLength(1);
  expect((await getJson<ListBody>(request, `${MASTER}/addons?q=${addonCode}`)).total).toBe(1);

  // 「保存并继续新增」：留在新增页，保留适用品类和计费方式，编码只留前缀；同一个编码再来一次被拒绝，内容保留
  await page.goto("/platform/master/addons/new");
  await page.getByLabel(/^编码/).fill(`${addonCode}_2`);
  await page.getByLabel("名称 中文").fill("第二条");
  await page.getByLabel("包车").check();
  await page.getByLabel(/按人/).check();
  await page.getByRole("button", { name: "保存并继续新增" }).click();
  await expect(toast(page, "已新增附加服务「第二条」")).toBeVisible();
  await expect(page).toHaveURL(/\/platform\/master\/addons\/new$/);
  await expect(page.getByLabel(/^编码/)).toHaveValue("ADD-");
  await expect(page.getByLabel("名称 中文")).toHaveValue("");
  await expect(page.getByLabel("包车")).toBeChecked();
  await expect(page.getByLabel(/按人/)).toBeChecked();
  await expect(page.getByText(/有 \d+ 处需要修改/), "清空后不带着上一条的出错提示").toHaveCount(0);
  await page.getByLabel(/^编码/).fill(addonCode);
  await page.getByLabel("名称 中文").fill("重复的");
  await page.getByRole("button", { name: "保存并继续新增" }).click();
  await expect(page.getByText("这个编码已经被使用，请换一个")).toBeVisible();
  await expect(page.getByLabel(/^编码/)).toBeFocused();
  await expect(page.getByLabel("名称 中文")).toHaveValue("重复的");

  // 登录过期：让这个会话在后端失效，再点保存
  const token = await page.evaluate(() => (JSON.parse(sessionStorage.getItem("nozomi.session.platform") ?? "{}") as { accessToken?: string }).accessToken ?? "");
  expect(token).not.toBe("");
  expect((await request.post("/platform/v1/auth/logout", { headers: { authorization: `Bearer ${token}` } })).status()).toBeLessThan(300);
  await page.getByLabel(/^编码/).fill(`${addonCode}_3`);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page).toHaveURL(/\/platform\/login$/);
  await expect(page.getByText("登录已过期，请重新登录。")).toBeVisible();
  const admin = adminCredentials();
  await fillLogin(page, admin.email, admin.password);
  await expect(page, "登录后回到原来的页面").toHaveURL(/\/platform\/master\/addons\/new$/);
  expect((await getJson<ListBody>(request, `${MASTER}/addons?q=${addonCode}_3`)).total, "过期的那次没有写进去").toBe(0);
});

test("各表单的上限值前后端一致：前端放行的最大值后端都接受（名称 200 字、说明 2000 字、地址 300 字、编码最长、60 座、99 件行李、坐标 ±90 / ±180）", async ({ page, request }) => {
  test.setTimeout(120_000);
  const country = "CM";
  const city = await createCity(request, country, "Africa/Douala", { zh: `杜阿拉${randomLetters(4)}` });
  await signInAsAdmin(page);
  const save = async (expected: RegExp): Promise<void> => {
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.locator(".field__error"), "前端放行的值，后端不应该拒绝").toHaveCount(0);
    await expect(toast(page, expected)).toBeVisible();
  };

  // 附加服务：编码 ADD- + 40 位，名称 200 字，说明 2000 字，三个品类全选
  const addonCode = `ADD-Q${randomLetters(8)}_${"9".repeat(30)}`;
  expect(addonCode.length).toBe(44);
  await page.goto("/platform/master/addons/new");
  await page.getByLabel(/^编码/).fill(addonCode);
  await page.getByLabel("名称 中文").fill("名".repeat(200));
  await page.getByLabel("名称 韩语").fill(`  ${"가".repeat(200)}  `);
  await page.getByLabel("说明 日语").fill("説".repeat(2000));
  await expect(page.getByText("2000 / 2000")).toBeVisible();
  for (const category of ["接送机", "点对点", "包车"]) await page.getByLabel(category).check();
  await page.getByLabel(/按时长/).check();
  await save(/已新增附加服务「名{20}…」/);
  const addon = (await getJson<{ items: { name: Record<string, string>; description: Record<string, string>; categories: string[] }[] }>(request, `${MASTER}/addons?code=${addonCode}`)).items[0];
  expect([addon?.name["zh"]?.length, addon?.name["ko"]?.length, addon?.description["ja"]?.length, [...(addon?.categories ?? [])].sort()]).toEqual([200, 200, 2000, ["airport_transfer", "charter", "point_to_point"]]);

  // 超过一个字：前端拦下，写明哪种语言
  await page.goto("/platform/master/addons/new");
  await page.getByLabel(/^编码/).fill(`${addonCode}9`);
  await page.getByLabel("名称 中文").fill("名".repeat(201));
  await page.getByLabel("说明 日语").fill("説".repeat(2001));
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("编码格式应为 ADD-代码，代码以大写字母开头，只用大写字母、数字、下划线，例如 ADD-CHILD_SEAT")).toBeVisible();
  await expect(page.getByText("中文名称最多 200 个字")).toBeVisible();
  await expect(page.getByText("日语说明最多 2000 个字")).toBeVisible();
  await expect(page.getByText("请至少选择一个品类")).toBeVisible();
  await expect(page.getByText("请选择计费方式")).toBeVisible();
  await expect(page.getByText("有 5 处需要修改")).toBeVisible();

  // 车型组：60 座，人数 60、行李 99 和 1 人 0 件
  const tag = `Q${randomLetters(6)}`;
  await page.goto("/platform/master/vehicle-groups/new");
  await page.getByLabel("豪华").check();
  await page.getByLabel(/^座位数/).fill("60");
  await expect(page.getByLabel(/^编码/)).toHaveValue("VG-LUX-60");
  await page.getByLabel(/^编码/).fill(`VG-${tag}-60`);
  await page.getByLabel("名称 中文").fill(`大巴${tag}`);
  await page.getByLabel("燃油").check();
  await page.getByLabel("第 1 个组合的人数").fill("60");
  await page.getByLabel("第 1 个组合的行李数").fill("99");
  await page.getByRole("button", { name: "添加组合" }).click();
  await page.getByLabel("第 2 个组合的人数").fill("1");
  await page.getByLabel("第 2 个组合的行李数").fill("0");
  await page.getByRole("button", { name: "添加代表车型" }).click();
  await page.getByRole("textbox", { name: "第 1 个代表车型" }).fill("型".repeat(100));
  await save(new RegExp(`已新增车型组「大巴${tag}」`));
  const group = (await getJson<{ items: { seats: number; combos: unknown; sample_models: string[] }[] }>(request, `${MASTER}/vehicle-groups?code=VG-${tag}-60`)).items[0];
  expect([group?.seats, group?.combos, group?.sample_models[0]?.length]).toEqual([60, [{ passengers: 60, luggage: 99 }, { passengers: 1, luggage: 0 }], 100]);

  // 车型组超限：61 座、人数超过座位数、行李 100、重复的组合
  await page.goto("/platform/master/vehicle-groups/new");
  await page.getByLabel("经济").check();
  await page.getByLabel(/^座位数/).fill("61");
  await page.getByLabel(/^座位数/).blur();
  await expect(page.getByText("座位数要填 1 到 60 的整数")).toBeVisible();
  await page.getByLabel(/^座位数/).fill("4");
  await expect(page.getByLabel(/^编码/)).toHaveValue("VG-ECO-4");
  await page.getByLabel("第 1 个组合的人数").fill("5");
  await page.getByLabel("第 1 个组合的行李数").fill("100");
  await page.getByLabel("第 1 个组合的行李数").blur();
  await expect(page.getByText("人数不能超过座位数（4 座）")).toBeVisible();
  await expect(page.getByText("行李数要填 0 到 99 的整数")).toBeVisible();
  await page.getByLabel(/^编码/).fill("VG-LUX-4");
  await page.getByLabel(/^编码/).blur();
  await expect(page.getByText("编码里的 LUX 是「豪华」的缩写，和所选等级「经济」不一致。「经济」的缩写是 ECO")).toBeVisible();

  // 地标：地址 300 字，坐标取极值
  const poiCode = `POI-${randomLetters(12)}`;
  await page.goto("/platform/master/places/new?type=poi");
  await page.getByRole("combobox", { name: /所属城市/ }).fill(city.code);
  await page.getByRole("option", { name: new RegExp(city.code) }).click();
  await page.getByLabel(/^编码/).fill(poiCode);
  await page.getByLabel("名称 英语").fill("N".repeat(200));
  await page.getByLabel("酒店").check();
  await page.getByLabel(/^纬度/).fill("-90");
  await page.getByLabel(/^经度/).fill("180");
  await page.getByLabel(/^地址/).fill("址".repeat(300));
  await save(/已新增地标「N{20}…」/);
  const poi = (await getJson<{ items: { location: unknown; address: string }[] }>(request, `${MASTER}/places?code=${poiCode}`)).items[0];
  expect([poi?.location, poi?.address.length]).toEqual([{ lat: -90, lng: 180 }, 300]);

  // 地标超限：坐标出界、不是数字、地址 301 字、编码 13 位
  await page.goto("/platform/master/places/new?type=poi");
  await page.getByLabel(/^编码/).fill(`${poiCode}9`);
  await page.getByLabel(/^纬度/).fill("90.000001");
  await page.getByLabel(/^经度/).fill("1e2");
  await page.getByLabel(/^地址/).fill("址".repeat(301));
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("纬度必须在 -90 到 90 之间")).toBeVisible();
  await expect(page.getByText("经度要填数字，例如 139.779694")).toBeVisible();
  await expect(page.getByText("地址最多 300 个字")).toBeVisible();
  await expect(page.getByText("编码格式应为 POI-序号，序号是 1 到 12 位大写字母或数字，例如 POI-000123")).toBeVisible();
  await expect(page.getByText("请选择所属城市")).toBeVisible();
  await expect(page.getByText("请选择地标类型")).toBeVisible();

  // 车站：编码的国家码跟着所属城市；写成别的国家被拦下
  await page.goto("/platform/master/places/new?type=station");
  await page.getByRole("combobox", { name: /所属城市/ }).fill(city.code);
  await page.getByRole("option", { name: new RegExp(city.code) }).click();
  await expect(page.getByLabel(/^编码/)).toHaveValue(`STN-${country}-`);
  await page.getByLabel(/^编码/).fill("STN-JP-TOKYO");
  await page.getByLabel(/^编码/).blur();
  await expect(page.getByText(`编码里的国家码 JP 和所属城市的国家 喀麦隆（${country}） 不一致`)).toBeVisible();
});

test("名称、说明里有表情或生僻字（一个字占两个 UTF-16 单位）：前后端按同一口径计数——超出上限的前端自己拦下、不发请求；恰好在上限上的前端放行、后端接受", async ({ page, request }) => {
  await signInAsAdmin(page);
  const code = `ADD-QE_${randomLetters(8)}`;
  const posts: string[] = [];
  page.on("request", (sent) => {
    if (sent.method() === "POST" && sent.url().includes(`${MASTER}/addons`)) posts.push(sent.url());
  });
  await page.goto("/platform/master/addons/new");
  await page.getByLabel(/^编码/).fill(code);
  await page.getByLabel("接送机").check();
  await page.getByLabel(/按次/).check();

  // 超出：150 个表情 = 300 单位（上限 200）；1500 个「𠮷」= 3000 单位（上限 2000）
  await page.getByLabel("名称 中文").fill("😀".repeat(150));
  await page.getByLabel("说明 中文").fill("𠮷".repeat(1500));
  await expect(page.getByText("3000 / 2000"), "计数和后端同一口径").toBeVisible();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText(/^中文名称最多 200 个/)).toBeVisible();
  await expect(page.getByText(/^中文说明最多 2000 个/)).toBeVisible();
  await expect(page.getByText(/有 2 处需要修改/)).toBeVisible();
  await page.waitForTimeout(300);
  expect(posts, "前端自己拦下，不把后端会拒绝的内容发出去").toEqual([]);
  await expect(page.locator(".toast")).toHaveCount(0);

  // 多一个单位也拦：100 个表情 + 1 个字母 = 201
  await page.getByLabel("名称 中文").fill(`${"😀".repeat(100)}a`);
  await page.getByLabel("说明 中文").fill(`${"𠮷".repeat(1000)}a`);
  await expect(page.getByText("2001 / 2000")).toBeVisible();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText(/^中文名称最多 200 个/)).toBeVisible();
  await expect(page.getByText(/^中文说明最多 2000 个/)).toBeVisible();
  expect(posts).toEqual([]);

  // 恰好在上限上：100 个表情 = 200 单位，1000 个「𠮷」= 2000 单位 → 前端放行，后端接受，原样存下
  await page.getByLabel("名称 中文").fill("😀".repeat(100));
  await page.getByLabel("说明 中文").fill("𠮷".repeat(1000));
  await expect(page.getByText("2000 / 2000")).toBeVisible();
  await expect(page.getByText(/最多 \d+ 个/)).toHaveCount(0);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(toast(page, "已新增附加服务")).toBeVisible();
  expect(posts).toHaveLength(1);
  const saved = (await getJson<{ items: { name: Record<string, string>; description: Record<string, string> }[] }>(request, `${MASTER}/addons?code=${code}`)).items[0];
  expect([saved?.name["zh"], saved?.description["zh"]]).toEqual(["😀".repeat(100), "𠮷".repeat(1000)]);
});

test("【缺陷】编辑页有没保存的修改时，点面包屑 / 侧边栏 / 「新增航站楼」离开应当先确认（只有「取消」按钮会确认），实际直接离开、修改丢失", async ({ page, request }) => {
  const country = "TG";
  const city = await createCity(request, country, "Africa/Lome", { zh: `洛美${randomLetters(4)}` });
  await signInAsAdmin(page);
  await page.goto(`/platform/master/cities/${city.id}`);
  await expect(page.getByLabel("名称 中文")).toHaveValue(city.name["zh"] ?? "");

  // 「取消」是有确认的
  await page.getByLabel("名称 英语").fill("Typed but not saved");
  await page.getByRole("button", { name: "取消" }).click();
  await expect(page.getByRole("dialog", { name: "有未保存的修改，确定离开吗？" })).toBeVisible();
  await page.getByRole("button", { name: "继续编辑" }).click();
  await expect(page.getByLabel("名称 英语")).toHaveValue("Typed but not saved");

  // 02-components.md 第 4 节：「离开未保存的表单时弹确认」；master-data.md 6.3：点「新增航站楼」照常弹确认
  await page.getByRole("navigation", { name: "当前位置" }).getByRole("link", { name: "城市" }).click();
  await expect(page.getByRole("dialog", { name: "有未保存的修改，确定离开吗？" }), "点面包屑离开应当先确认").toBeVisible({ timeout: 5_000 });
  await expect(page).toHaveURL(new RegExp(`/platform/master/cities/${city.id}$`));
});

/* ───────────── 权限 ───────────── */

test("只读角色（客服）：首页卡片按权限裁剪；四个列表没有新增和操作列；每个编辑页只读；新增页和流水线页直接输地址也进不去", async ({ page, request }) => {
  test.setTimeout(120_000);
  const country = "ZM";
  const headers = await platformAdminHeaders(request);
  const city = await createCity(request, country, "Africa/Lusaka", { zh: `卢萨卡${randomLetters(4)}`, en: "Lusaka" });
  const location = { lng: 28.452722, lat: -15.330817 };
  const tag = randomLetters(6);
  const airportCode = `I${randomLetters(2)}`;
  const airport = await post<Row>(request, "places", { type: "airport", code: airportCode, city_id: city.id, name: { zh: `只读测试机场${tag}` }, location, flight_scope: "mixed" });
  const terminal = await post<Row>(request, "places", { type: "terminal", code: `${airportCode}-T1`, parent_id: airport.id, name: { zh: "一号航站楼" }, location });
  const station = await post<Row>(request, "places", { type: "station", code: `STN-${country}-${tag}`, city_id: city.id, category: "rail", name: { zh: `只读测试站${tag}` }, location });
  const poi = await post<Row>(request, "places", { type: "poi", code: `POI-${tag}`, city_id: city.id, category: "hotel", name: { zh: `只读测试酒店${tag}` }, location, address: "独立大道 1 号" });
  const group = await post<Row>(request, "vehicle-groups", { code: `VG-R${tag}-7`, grade: "business", seats: 7, power: "ev", name: { zh: `只读测试车型${tag}` }, combos: [{ passengers: 6, luggage: 4 }], sample_models: ["测试车型甲"] });
  const addon = await post<Row>(request, "addons", { code: `ADD-R_${tag}`, categories: ["charter"], charge_unit: "per_person", name: { zh: `只读测试服务${tag}` }, description: { zh: "说明文字" } });
  await importAirports(country, [{ iata: `I${randomLetters(2)}`, name: `QA Readonly Pending ${tag} Airport`, lat: -15.33, lng: 28.45 }]);

  const email = uniqueEmail("cs");
  const created = await request.post("/platform/v1/staff", { headers, data: { email, name: "端到端测试客服", role: "customer_service" } });
  expect(created.status()).toBe(201);
  const { invite } = (await created.json()) as { invite: { token: string } };
  const password = newPassword();
  expect((await request.post("/platform/v1/auth/accept-invite", { data: { token: invite.token, password } })).status()).toBe(200);

  const rejected: string[] = [];
  page.on("response", (response) => {
    if (response.status() === 403) rejected.push(`${response.request().method()} ${new URL(response.url()).pathname}`);
  });
  const written: string[] = [];
  page.on("request", (sent) => {
    if (sent.method() !== "GET" && sent.url().includes(MASTER)) written.push(`${sent.method()} ${sent.url()}`);
  });
  await loginAs(page, "platform", email, password);

  // 首页：客服不能看供应商，没有「运营」分区；主数据四张卡片都在；提醒行去筛好的列表，没有「先新增城市」
  await expect(page.locator(".entry-card__title")).toHaveText(["城市", "地点", "车型组", "附加服务"]);
  await expect(page.getByRole("heading", { level: 2, name: "运营" })).toHaveCount(0);
  await expect(page.locator(".entry-card").filter({ hasText: "地点" }).locator("dl")).toBeVisible();
  const reminder = page.locator(".entry-card__reminder");
  await expect(reminder).toHaveCount(1);
  await expect(reminder).toHaveAttribute("href", "/platform/master/places?city=none");
  await expect(page.getByRole("navigation", { name: "主菜单" }).getByRole("link")).toHaveText(["首页", "城市", "地点", "车型组", "附加服务"]);
  await reminder.click();
  await expect(page).toHaveURL(/\/platform\/master\/places\?city=none$/);
  await expect(page.getByRole("link", { name: "只看这些" })).toBeVisible();
  await expect(page.getByRole("link", { name: "去处理" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^指定城市/ })).toHaveCount(0);

  // 四个列表（地点三个页签）：没有新增、没有操作列
  for (const [path, codeText] of [
    [`/platform/master/cities?q=${city.code}`, city.code],
    [`/platform/master/places?q=${airportCode}&country=${country}`, airportCode],
    [`/platform/master/places?type=station&q=${station.code}`, station.code],
    [`/platform/master/places?type=poi&q=${poi.code}`, poi.code],
    [`/platform/master/vehicle-groups?q=${group.code}`, group.code],
    [`/platform/master/addons?q=${addon.code}`, addon.code],
  ] as const) {
    await page.goto(path);
    await expect(rowOf(page, codeText), path).toBeVisible();
    await expect(page.getByRole("link", { name: /^新增/ }), path).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "操作" }), path).toHaveCount(0);
    await expect(page.locator("tbody").getByRole("button"), `${path}：行内没有任何按钮`).toHaveCount(0);
  }

  // 每个编辑页：只读提示、没有任何可以改的输入框、没有保存 / 停用 / 启用 / 新增下级
  for (const [kind, id, text] of [
    ["cities", city.id, city.name["zh"]],
    ["places", airport.id, `只读测试机场${tag}`],
    ["places", terminal.id, "一号航站楼"],
    ["places", station.id, `只读测试站${tag}`],
    ["places", poi.id, "独立大道 1 号"],
    ["vehicle-groups", group.id, "测试车型甲"],
    ["addons", addon.id, "说明文字"],
  ] as const) {
    await page.goto(`/platform/master/${kind}/${id}`);
    await expect(page.getByText("你可以查看主数据，但不能修改。需要修改的话，请联系管理员开通。"), `${kind}/${id}`).toBeVisible();
    await expect(page.locator("main").getByText(text ?? "", { exact: false }).first()).toBeVisible();
    await expect(page.locator("main input:not([readonly]), main textarea:not([readonly]), main select"), `${kind}：没有可以改的控件`).toHaveCount(0);
    for (const name of ["保存", "保存并继续新增", "停用", "启用", "取消"]) await expect(page.locator("main").getByRole("button", { name, exact: true }), `${kind}：没有「${name}」`).toHaveCount(0);
    await expect(page.locator("main").getByRole("link", { name: /^新增/ })).toHaveCount(0);
    await expect(page.locator("main").getByRole("button", { name: /^(停用|启用|填入)/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "回到列表" })).toBeVisible();
  }

  // 新增页、流水线页：直接输地址也进不去，而且没有发出任何写请求
  for (const path of [
    "/platform/master/cities/new",
    "/platform/master/places/new",
    "/platform/master/places/new?type=station",
    "/platform/master/places/new?type=poi",
    `/platform/master/places/new?type=terminal&parent=${airport.id}`,
    "/platform/master/vehicle-groups/new",
    "/platform/master/addons/new",
    "/platform/master/places/pending",
    `/platform/master/places/pending?country=${country}`,
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "你没有权限查看这里" }), path).toBeVisible();
    await expect(page.locator("main form"), path).toHaveCount(0);
    await expect(page.locator(".pending__code"), path).toHaveCount(0);
  }
  expect(written).toEqual([]);
  expect(rejected, "只读角色正常浏览时不应该撞到 403").toEqual([]);
});

test("必须先改密码的账号：首页和主数据的每个新页面都被带回改密页；租户后台的账号打开运营后台的主数据地址只会到运营后台登录页", async ({ page, request }) => {
  test.slow();
  const paths = [
    "/platform",
    "/platform/master/cities",
    "/platform/master/cities/new",
    "/platform/master/cities/99999999-9999-4999-8999-999999999999",
    "/platform/master/places",
    "/platform/master/places?type=station&city=none&q=abc",
    "/platform/master/places/pending",
    "/platform/master/places/pending?country=JP",
    "/platform/master/places/new?type=airport",
    "/platform/master/vehicle-groups",
    "/platform/master/vehicle-groups/new",
    "/platform/master/addons",
    "/platform/master/addons/new",
  ];
  const admin = await createTemporaryPasswordAdmin();
  const leaked: string[] = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if ((url.pathname.startsWith(MASTER) || url.pathname.endsWith("/dashboard/summary")) && response.status() === 200) leaked.push(url.pathname);
  });
  await page.goto("/platform/login");
  await fillLogin(page, admin.email, admin.temporaryPassword);
  await expect(page).toHaveURL(/\/platform\/account\/password$/);
  for (const path of paths) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/platform\/account\/password$/);
    await expect(page.getByRole("heading", { level: 1, name: "设置新密码" }), path).toBeVisible();
    await expect(page.getByRole("navigation", { name: "主菜单" }), `${path}：不显示菜单`).toHaveCount(0);
    await expect(page.locator(".entry-card, table, .pending__code"), `${path}：不显示任何主数据`).toHaveCount(0);
  }
  expect(leaked, "没有任何主数据或统计接口成功返回").toEqual([]);

  // 租户后台的账号
  const tenant = await createActiveTenant(request);
  const tenantPage = await page.context().browser()!.newPage();
  const tenantLeaks: string[] = [];
  tenantPage.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/platform/v1/") && !url.pathname.includes("/auth/") && response.status() === 200) tenantLeaks.push(url.pathname);
  });
  await loginAs(tenantPage, "tenant", tenant.adminEmail, tenant.password);
  for (const path of paths) {
    await tenantPage.goto(path);
    await expect(tenantPage, path).toHaveURL(/\/platform\/login$/);
  }
  // 把租户的令牌硬塞进运营后台的会话里：后端不认，回到登录页
  await tenantPage.goto("/");
  await tenantPage.evaluate(() => sessionStorage.setItem("nozomi.session.platform", sessionStorage.getItem("nozomi.session.tenant") ?? ""));
  await tenantPage.goto("/platform/master/cities");
  await expect(tenantPage).toHaveURL(/\/platform\/login$/);
  await expect(tenantPage.locator("table")).toHaveCount(0);
  // 租户后台自己没有这些页面
  await tenantPage.goto("/master/cities");
  await expect(tenantPage.locator("table")).toHaveCount(0);
  expect(tenantLeaks).toEqual([]);
  await tenantPage.close();
});

test("没登录直接打开带筛选条件的列表：先去登录页，登录后回到这个列表，筛选条件都在", async ({ page }) => {
  await page.goto("/platform/master/places?type=station&status=disabled&q=abc&size=20");
  await expect(page).toHaveURL(/\/platform\/login$/);
  const admin = adminCredentials();
  await fillLogin(page, admin.email, admin.password);
  await expect(page).toHaveURL(/\/platform\/master\/places\?type=station&status=disabled&q=abc&size=20$/);
  await expect(page.getByRole("tab", { name: "车站" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("状态")).toHaveValue("disabled");
  await expect(searchBox(page)).toHaveValue("abc");
  await expect(pager(page).getByRole("combobox")).toHaveValue("20");
});

/* ───────────── 首页统计 ───────────── */

test("首页的数量和各列表的「共 N 条」对得上：城市、地点（机场 + 车站 + 地标）、车型组、附加服务的启用 / 已停用，以及待指定城市的机场", async ({ page, request }) => {
  test.setTimeout(240_000);
  await signInAsAdmin(page);
  interface Counts {
    active: number;
    disabled: number;
  }
  interface Summary {
    master_data: { cities: Counts; places: { by_type: Record<string, Counts>; airports_without_city: number }; vehicle_groups: Counts; addons: Counts };
  }
  const number = (text: string | null): number => Number((text ?? "").replace(/[^\d]/g, ""));
  const summaryNow = async (): Promise<Summary["master_data"]> => (await getJson<Summary>(request, "/platform/v1/dashboard/summary")).master_data;
  /**
   * 并行的用例也在改数据：读界面之前、之后各看一次接口，接口这个数字没动的那一轮才算数。
   * 首页的卡片和各个列表都和同一个接口的数字比，所以它们彼此也一致。
   */
  const sameAsSummary = async <T>(what: string, fromSummary: (summary: Summary["master_data"]) => T, fromPage: () => Promise<T>): Promise<void> => {
    await expect(async () => {
      const before = fromSummary(await summaryNow());
      const shown = await fromPage();
      const after = fromSummary(await summaryNow());
      expect(after as unknown, `${what}：这一轮中途数据变了，重来`).toEqual(before);
      expect(shown as unknown, what).toEqual(before);
    }).toPass({ timeout: 60_000 });
  };
  const cardCounts = async (title: string): Promise<Counts> => {
    const card = page.locator(".entry-card").filter({ has: page.locator(".entry-card__title", { hasText: new RegExp(`^${title}$`) }) });
    await expect(card.locator("dd")).toHaveCount(2);
    const [active, disabled] = await card.locator("dd").allTextContents();
    return { active: number(active ?? ""), disabled: number(disabled ?? "") };
  };
  const listTotal = async (path: string): Promise<number> => {
    await page.goto(path);
    const label = pager(page).getByText(/^共 [\d,]+ 条$/);
    await expect(label).toBeVisible();
    await settled(page);
    return number(await label.textContent());
  };
  const pick = ({ active, disabled }: Counts): Counts => ({ active, disabled });
  const placeSum = (summary: Summary["master_data"]): Counts => ({
    active: ["airport", "station", "poi"].reduce((sum, type) => sum + (summary.places.by_type[type]?.active ?? 0), 0),
    disabled: ["airport", "station", "poi"].reduce((sum, type) => sum + (summary.places.by_type[type]?.disabled ?? 0), 0),
  });

  // 首页的四张卡片和提醒行
  await sameAsSummary(
    "首页卡片",
    (summary) => ({ cities: pick(summary.cities), places: placeSum(summary), groups: pick(summary.vehicle_groups), addons: pick(summary.addons), waiting: summary.places.airports_without_city }),
    async () => {
      await page.goto("/platform");
      const cards = { cities: await cardCounts("城市"), places: await cardCounts("地点"), groups: await cardCounts("车型组"), addons: await cardCounts("附加服务") };
      const reminder = page.locator(".entry-card__reminder").filter({ hasText: "个机场待指定城市" });
      return { ...cards, waiting: (await reminder.count()) === 0 ? 0 : number(await reminder.textContent()) };
    },
  );

  // 各列表按状态筛选后的「共 N 条」
  for (const status of ["active", "disabled"] as const) {
    await sameAsSummary(`城市列表（${status}）`, (summary) => summary.cities[status], () => listTotal(`/platform/master/cities?status=${status}`));
    await sameAsSummary(`车型组列表（${status}）`, (summary) => summary.vehicle_groups[status], () => listTotal(`/platform/master/vehicle-groups?status=${status}`));
    await sameAsSummary(`附加服务列表（${status}）`, (summary) => summary.addons[status], () => listTotal(`/platform/master/addons?status=${status}`));
    for (const type of ["airport", "station", "poi"] as const) {
      await sameAsSummary(`地点列表 ${type}（${status}）`, (summary) => summary.places.by_type[type]?.[status] ?? 0, () => listTotal(`/platform/master/places?type=${type}&status=${status}`));
    }
  }
  // 「待指定城市」筛选和流水线页的「还剩」
  await sameAsSummary("机场列表筛「待指定城市」", (summary) => summary.places.airports_without_city, () => listTotal("/platform/master/places?city=none"));
  await sameAsSummary("流水线页的「还剩」", (summary) => summary.places.airports_without_city, async () => {
    await page.goto("/platform/master/places/pending");
    const label = page.locator(".pending__toolbar").getByText(/^还剩 [\d,]+ 个$/);
    await expect(label).toBeVisible();
    return number(await label.textContent());
  });
  await sameAsSummary("机场页签的提醒条", (summary) => summary.places.airports_without_city, async () => {
    await page.goto("/platform/master/places");
    const alert = page.getByText(/有 [\d,]+ 个导入的机场还没有指定城市。/);
    await settled(page);
    return (await alert.count()) === 0 ? 0 : number(await alert.textContent());
  });
});

/* ───────────── XSS ───────────── */

test("名称、地址里的 HTML 经真实后端存取后只当文字显示：列表、编辑页、停用确认、Toast、组合框选项、流水线页、首页都不执行", async ({ page, request }) => {
  test.slow();
  const country = "CI";
  const mark = randomLetters(5);
  const evil = `<img src=x onerror="window.__xss='${mark}-img'">`;
  const evilEn = `"><script>window.__xss='${mark}-script'</script>`;
  const fired: string[] = [];
  page.on("dialog", (dialog) => {
    fired.push(dialog.message());
    void dialog.dismiss();
  });
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });
  const expectInert = async (what: string): Promise<void> => {
    expect(await page.evaluate(() => (window as unknown as { __xss?: string }).__xss ?? null), `${what}：脚本被执行了`).toBeNull();
    await expect(page.locator("img[src=x], main script, svg[onload], [onerror], [onload], [onmouseover], main iframe"), `${what}：HTML 被当成了元素`).toHaveCount(0);
    expect(fired, what).toEqual([]);
  };

  await signInAsAdmin(page);
  // 经界面录入
  const cityCode = `CTY-${country}-${randomLetters(6)}`;
  await page.goto("/platform/master/cities/new");
  await page.getByRole("combobox", { name: /国家/ }).fill(country);
  await page.getByRole("option", { name: /科特迪瓦（CI）/ }).click();
  await page.getByLabel(/^编码/).fill(cityCode);
  await page.getByLabel("名称 中文").fill(evil);
  await page.getByLabel("名称 英语").fill(evilEn);
  await page.getByRole("combobox", { name: /时区/ }).fill("abidjan");
  await page.keyboard.press("Enter");
  await page.getByLabel(/^纬度/).fill("5.36");
  await page.getByLabel(/^经度/).fill("-4.0083");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("已新增城市「<img src=x onerror=");
  await expectInert("新增城市后的 Toast");

  // 城市列表
  await page.goto(`/platform/master/cities?q=${cityCode}`);
  await expect(rowOf(page, cityCode)).toContainText(evil);
  await expect(rowOf(page, cityCode)).toContainText(evilEn);
  await expectInert("城市列表");
  const stored = (await getJson<ListBody>(request, `${MASTER}/cities?code=${cityCode}`)).items[0];
  expect(stored?.name, "原样存取，没有被改写或转义两次").toEqual({ zh: evil, en: evilEn });

  // 用名称里的 HTML 搜索
  await searchBox(page).fill("<img src=x");
  await searchBox(page).press("Enter");
  await expect(rowOf(page, cityCode)).toBeVisible();
  await expectInert("用 HTML 当关键字搜索");

  // 停用确认对话框的标题、停用后的 Toast
  await rowOf(page, cityCode).getByRole("button", { name: /^停用/ }).click();
  await expect(page.getByRole("dialog")).toContainText(`停用城市「${evil}」？`);
  await expectInert("停用确认对话框");
  await page.getByRole("dialog").getByRole("button", { name: "停用" }).click();
  await expect(page.locator(".toast").filter({ hasText: "已停用" })).toContainText("<img src=x");
  await rowOf(page, cityCode).getByRole("button", { name: /^启用/ }).click();
  await expect(page.locator(".toast").filter({ hasText: "已启用" })).toBeVisible();
  await expectInert("停用 / 启用后的 Toast");

  // 编辑页：标题、标签页标题、输入框里的值
  await rowOf(page, cityCode).getByRole("link", { name: cityCode, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(evil);
  await expect(page).toHaveTitle(`${evil} · 城市 · NOZOMI 运营后台`);
  await expect(page.getByLabel("名称 英语")).toHaveValue(evilEn);
  await expectInert("城市编辑页");

  // 地标的地址、机场的名称（导入的）、航站楼
  const cityId = stored?.id ?? "";
  const poiCode = `POI-X${randomLetters(8)}`;
  await post(request, "places", { type: "poi", code: poiCode, city_id: cityId, category: "mall", name: { zh: `<svg onload="window.__xss='${mark}-svg'">` }, location: { lng: -4.0083, lat: 5.36 }, address: `<iframe src="javascript:window.__xss='${mark}-iframe'"></iframe>` });
  await page.goto(`/platform/master/places?type=poi&q=${poiCode}`);
  await expect(rowOf(page, poiCode)).toContainText("<iframe src=");
  await expect(rowOf(page, poiCode)).toContainText("<svg onload=");
  await expectInert("地标列表");
  await rowOf(page, poiCode).getByRole("link", { name: poiCode, exact: true }).click();
  await expect(page.getByLabel(/^地址/)).toHaveValue(/<iframe/);
  // 所属城市的组合框里，城市名是 HTML
  await page.getByRole("combobox", { name: /所属城市/ }).click();
  await expect(page.getByRole("option", { name: new RegExp(cityCode) })).toContainText("<img src=x");
  await expectInert("地标编辑页和所属城市选项");

  const airportCode = `X${randomLetters(2)}`;
  const airportName = `<b onmouseover=window.__xss=1>QA ${mark}</b><script>window.__xss=2</script>`;
  await importAirports(country, [{ iata: airportCode, name: airportName, lat: 5.26, lng: -3.93 }]);
  await page.goto(`/platform/master/places/pending?country=${country}`);
  await expect(page.locator(".pending__name")).toHaveText(airportName);
  await expectInert("流水线页的卡片");
  await page.getByRole("combobox", { name: /所属城市/ }).click();
  await page.getByRole("option", { name: new RegExp(cityCode) }).click();
  await page.getByRole("button", { name: "保存并启用" }).click();
  await expect(page.locator(".toast").filter({ hasText: `已启用「${airportCode}` })).toBeVisible();
  await expect(page.locator(".done-list__item")).toContainText(airportName);
  await expect(page.locator(".done-list__item")).toContainText(`→ ${evil}`);
  await expectInert("流水线页处理完之后");

  await page.goto(`/platform/master/places?country=${country}`);
  await expect(rowOf(page, airportCode)).toContainText(airportName);
  await expect(rowOf(page, airportCode)).toContainText(evil);
  await expectInert("机场列表（名称和所属城市）");
  await page.goto("/platform");
  await expect(page.locator(".entry-card").first()).toBeVisible();
  await expectInert("首页");
  expect(violations, "页面自己没有触发内容安全策略的拦截（没有靠 CSP 兜底）").toEqual([]);
});

/* ───────────── 手机宽度、键盘、Toast ───────────── */

test("320 / 360 / 768 宽度下，超长不带空格的名称和编码不撑破页面：列表、编辑页、停用确认、Toast、流水线页的卡片和「本次已处理」；亮色、暗色通过 axe", async ({ page, request }) => {
  test.setTimeout(240_000);
  const country = "ML";
  const long = `Supercalifragilistic${"expialidocious".repeat(12)}`.slice(0, 200);
  const city = await createCity(request, country, "Africa/Bamako", { zh: "巴".repeat(200), en: long });
  const airportCode = `Y${randomLetters(2)}`;
  await importAirports(country, [
    { iata: airportCode, name: `QA${"VeryLongUnbrokenAirportName".repeat(6)}`, lat: 12.533544, lng: -7.949944 },
    { iata: `Y${randomLetters(2)}`, name: "QA Second Airport", lat: 12.5, lng: -7.9 },
  ]);
  const addonCode = `ADD-Y${randomLetters(8)}_${"LONG_".repeat(6)}`.slice(0, 44);
  await post(request, "addons", { code: addonCode, categories: ["airport_transfer", "point_to_point", "charter"], charge_unit: "per_duration", name: { zh: "服".repeat(200), ja: "サ".repeat(200), en: long, ko: "서".repeat(200) }, description: { zh: "说".repeat(2000) } });
  await signInAsAdmin(page);

  const widths = [320, 360, 768] as const;
  const sweep = async (what: string): Promise<void> => {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 740 });
      await expectNoHorizontalOverflow(page, `${what} ${width}px`);
    }
    await page.setViewportSize({ width: 320, height: 640 });
  };
  const bothThemes = async (what: string): Promise<void> => {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expectAccessible(page, `${what}（${scheme}）`);
    }
    await page.emulateMedia({ colorScheme: "light" });
  };
  await page.setViewportSize({ width: 320, height: 640 });

  // 城市列表：表格只在自己的容器里滚动
  await page.goto(`/platform/master/cities?q=${city.code}`);
  await expect(rowOf(page, city.code)).toBeVisible();
  await sweep("超长名称的城市列表");
  const scroller = page.getByRole("region", { name: "城市列表" });
  expect(await scroller.evaluate((element) => element.scrollWidth > element.clientWidth), "表格在自己的容器里可以横向滚动").toBe(true);
  await expect(scroller, "键盘能聚焦到表格容器").toHaveAttribute("tabindex", "0");
  await bothThemes("超长名称的城市列表");

  // 停用确认：对话框标题是 200 个字的名称
  await page.setViewportSize({ width: 768, height: 740 });
  const trigger = rowOf(page, city.code).getByRole("button", { name: /^停用/ });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "取消" })).toBeFocused();
  await sweep("停用确认对话框（超长名称）");
  for (const width of widths) {
    await page.setViewportSize({ width, height: 740 });
    const box = await dialog.locator(".dialog__panel").boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= width + 0.5, `对话框在 ${width}px 下不超出屏幕`).toBe(true);
  }
  await bothThemes("停用确认对话框");
  // Tab 只在对话框里循环；Esc 关闭后焦点回到打开它的按钮
  for (let n = 0; n < 6; n += 1) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement === document.body || document.activeElement?.closest("dialog") !== null), "Tab 不会落到对话框后面的页面上").toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  // 关闭后焦点应当回到「停用」——现在没有，见下面的缺陷用例；这里手工放回去，继续后面的检查
  await trigger.focus();

  // 停用成功的 Toast：读屏区域一直在、Toast 自己是 status、不抢焦点、名称截断、不撑破页面、4 秒后消失
  await expect(page.locator(".toast-region")).toHaveAttribute("aria-live", "polite");
  await expect(page.locator(".toast-region .toast"), "没有 Toast 时区域是空的").toHaveCount(0);
  await page.keyboard.press("Enter");
  await dialog.getByRole("button", { name: "停用" }).click();
  const stopped = page.locator(".toast-region [role=status]").filter({ hasText: "已停用" });
  await expect(stopped).toHaveText(`已停用「${"巴".repeat(20)}…」`);
  await expect(rowOf(page, city.code).getByRole("button", { name: /^启用/ }), "焦点在这一行的新按钮上，没有被 Toast 抢走").toBeFocused();
  await sweep("Toast 显示时");
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 740 });
    const box = await stopped.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= width + 0.5, `Toast 在 ${width}px 下不超出屏幕`).toBe(true);
  }
  await bothThemes("Toast 显示时");
  await expect(stopped, "停留 4 秒后自己消失").toHaveCount(0, { timeout: 8_000 });
  // 悬停时不消失
  await rowOf(page, city.code).getByRole("button", { name: /^启用/ }).click();
  const started = page.locator(".toast").filter({ hasText: "已启用" });
  await expect(started).toBeVisible();
  await started.hover();
  await page.waitForTimeout(5_000);
  await expect(started, "鼠标停在上面时不消失").toBeVisible();
  await started.getByRole("button", { name: "关闭提示" }).click();
  await expect(started).toHaveCount(0);

  // 城市编辑页：标题是 200 个字
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`/platform/master/cities/${city.id}`);
  await expect(page.getByLabel("名称 英语")).toHaveValue(long);
  await sweep("超长名称的城市编辑页");
  await bothThemes("超长名称的城市编辑页");

  // 附加服务：44 位的编码、四种语言各 200 字、2000 字的说明
  await page.goto(`/platform/master/addons?q=${addonCode}`);
  await expect(rowOf(page, addonCode)).toBeVisible();
  await sweep("长编码的附加服务列表");
  await rowOf(page, addonCode).getByRole("link", { name: addonCode, exact: true }).click();
  await expect(page.getByLabel("说明 中文")).toHaveValue("说".repeat(2000));
  await sweep("长内容的附加服务编辑页");
  await bothThemes("长内容的附加服务编辑页");

  // 机场页签：警告提示条 + 启用被拒的提示条（城市已停用）
  await page.goto(`/platform/master/places?country=${country}`);
  await expect(page.getByText(/有 [\d,]+ 个导入的机场还没有指定城市。/)).toBeVisible();
  await sweep("机场页签（带待处理提醒）");
  await bothThemes("机场页签（带待处理提醒）");

  // 流水线页：超长机场名、组合框里超长的城市名、处理后的「本次已处理」和 Toast
  await page.goto(`/platform/master/places/pending?country=${country}&start=${(await getJson<ListBody>(request, `${MASTER}/places?code=${airportCode}`)).items[0]?.id ?? ""}`);
  await expect(page.locator(".pending__code")).toHaveText(airportCode);
  await sweep("流水线页（超长机场名）");
  await page.getByRole("combobox", { name: /所属城市/ }).click();
  await expect(page.getByRole("option").first()).toBeVisible();
  await sweep("流水线页：组合框打开（超长城市名）");
  await bothThemes("流水线页：组合框打开");
  await page.keyboard.press("Escape");
  // 超长名称的这个先跳过，处理名称长度正常的那个：「本次已处理」、Toast、「跳过过」标签
  await page.getByRole("button", { name: "跳过" }).click();
  await expect(page.locator(".pending__name")).toHaveText("QA Second Airport");
  await page.getByRole("combobox", { name: /所属城市/ }).click();
  await page.getByRole("option").first().click();
  await page.getByRole("button", { name: "保存并启用" }).click();
  await expect(page.locator(".toast").filter({ hasText: "已启用「" })).toBeVisible();
  await expect(page.locator(".done-list__item")).toHaveCount(1);
  await expect(page.getByText("跳过过")).toBeVisible();
  await sweep("流水线页：处理完一个（本次已处理 + Toast + 跳过过的标签）");
  await bothThemes("流水线页：处理完一个");
});

test("【缺陷】320px 下流水线页的「本次已处理」里，超长不带空格的机场名不折行，把整个页面撑出横向滚动（验收标准 ④）", async ({ page, request }) => {
  const country = "NE";
  const city = await createCity(request, country, "Africa/Niamey", { zh: `尼亚美${randomLetters(4)}` });
  const airportCode = `V${randomLetters(2)}`;
  await importAirports(country, [
    { iata: airportCode, name: `QA${"VeryLongUnbrokenAirportName".repeat(3)}`, lat: 13.4815, lng: 2.1836 },
    { iata: `V${randomLetters(2)}`, name: "QA Niamey Second Airport", lat: 13.5, lng: 2.1 },
  ]);
  const first = (await getJson<ListBody>(request, `${MASTER}/places?code=${airportCode}`)).items[0];
  await signInAsAdmin(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`/platform/master/places/pending?country=${country}&start=${first?.id ?? ""}`);
  await expect(page.locator(".pending__code")).toHaveText(airportCode);
  await expectNoHorizontalOverflow(page, "处理之前（卡片里同一个名称是折行的）");
  await page.getByRole("combobox", { name: /所属城市/ }).click();
  await page.getByRole("option", { name: new RegExp(city.code) }).click();
  await page.getByRole("button", { name: "保存并启用" }).click();
  await expect(page.locator(".done-list__item")).toHaveCount(1);
  await expectNoHorizontalOverflow(page, "处理完一个之后（本次已处理里有 83 个字母连写的机场名）");
});

test("【缺陷】手机宽度（< 768px）的列表筛选条应当只留搜索框和「筛选」按钮、其余条件进底部面板（master-data.md 2.8），实际所有条件直接折行排在表格上方", async ({ page }) => {
  await signInAsAdmin(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/platform/master/places");
  await expect(searchBox(page)).toBeVisible();
  await expect(page.getByRole("search").getByRole("button", { name: /^筛选/ }), "应当有「筛选」按钮").toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("search").getByLabel("状态"), "状态等条件收进面板，不直接排在表格上方").toBeHidden();
});

test("【缺陷】对话框关闭后（Esc、取消、关闭按钮）焦点应当回到打开它的那个按钮，实际落到页面开头：只用键盘的人每取消一次都要从头 Tab", async ({ page, request }) => {
  const country = "BF";
  const city = await createCity(request, country, "Africa/Ouagadougou", { zh: `瓦加杜古${randomLetters(4)}` });
  await importAirports(country, [{ iata: `W${randomLetters(2)}`, name: "QA Dialog Focus Airport", lat: 12.35, lng: -1.51 }]);
  await signInAsAdmin(page);

  // 流水线页：打开「新增城市」再按 Esc，焦点应当回到「新增城市」按钮，接着就能继续用键盘
  await page.goto(`/platform/master/places/pending?country=${country}`);
  const addCity = page.getByRole("button", { name: "新增城市" });
  await addCity.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "新增城市" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const afterPipeline = await page.evaluate(() => document.activeElement?.tagName ?? "");

  // 列表：打开停用确认再取消，焦点应当回到这一行的「停用」
  await page.goto(`/platform/master/cities?q=${city.code}`);
  const trigger = rowOf(page, city.code).getByRole("button", { name: /^停用/ });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog").getByRole("button", { name: "取消" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // 02-components.md 第 9 节：「关闭后焦点回到打开它的那个按钮」
  await expect(trigger, "取消停用后焦点回到这一行的「停用」").toBeFocused({ timeout: 3_000 });
  expect(afterPipeline, "流水线页关掉新增城市对话框后，焦点不应该落在 <body> 上").not.toBe("BODY");
});

test("键盘：地点页签用 ← → 切换并保留关键字和状态、清掉这个页签没有的条件；筛选的组合框 ↓ 打开、Enter 选中、Esc 关闭后焦点留在输入框；「跳到正文」可用", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/platform/master/places?q=qa&status=disabled&city=none&size=20");
  await settled(page);
  const tab = (name: string) => page.getByRole("tab", { name });
  await tab("机场").focus();
  await page.keyboard.press("ArrowRight");
  await expect(tab("车站")).toHaveAttribute("aria-selected", "true");
  await expect(tab("车站"), "选中的页签才在 Tab 顺序里").toHaveAttribute("tabindex", "0");
  await expect(tab("机场")).toHaveAttribute("tabindex", "-1");
  await expect(page).toHaveURL(/type=station/);
  await expect(page, "关键字和状态保留").toHaveURL(/q=qa/);
  await expect(page).toHaveURL(/status=disabled/);
  expect(page.url(), "「待指定城市」只有机场页签有，切走时清掉").not.toMatch(/city=none/);
  await expect(page.getByRole("link", { name: "新增车站" }).first()).toBeVisible();
  // 切换后焦点应当留在页签上——现在没有，见下面的缺陷用例；这里每次手工放回去
  await tab("车站").focus();
  await page.keyboard.press("ArrowRight");
  await expect(tab("地标")).toHaveAttribute("aria-selected", "true");
  await tab("地标").focus();
  await page.keyboard.press("ArrowRight");
  await expect(tab("机场"), "到头了绕回第一个").toHaveAttribute("aria-selected", "true");
  await tab("机场").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(tab("地标")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("columnheader", { name: "地址" })).toBeVisible();
  expect(await page.evaluate(() => history.length), "切页签用 replace，不把后退记录塞满").toBeLessThan(6);

  // 国家筛选（组合框）：键盘操作
  const country = page.getByRole("search").getByRole("combobox", { name: "国家" });
  await country.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox", { name: "国家" })).toBeVisible();
  await expect(country).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox", { name: "国家" })).toBeHidden();
  await expect(country).toBeFocused();
  await page.keyboard.type("jp");
  await expect(page.getByRole("option", { name: "日本（JP）" })).toBeVisible();
  await expect(country).toHaveAttribute("aria-activedescendant", /option-0$/);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/country=JP/);
  await expect(country).toHaveValue("日本（JP）");
  await expect(country).toBeFocused();

  // 跳到正文
  await page.goto("/platform/master/addons");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "跳到正文" })).toBeFocused();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("main");
});

test("【缺陷】地点页签用 ← → 切换后焦点应当留在新选中的页签上（才能接着按 → 切下一个），实际焦点丢了，要从页面开头重新 Tab", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/platform/master/places");
  await settled(page);
  await page.getByRole("tab", { name: "机场" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "车站" })).toHaveAttribute("aria-selected", "true");
  // master-data.md 第 11 节：「页签，←→ 切换」
  await expect(page.getByRole("tab", { name: "车站" })).toBeFocused({ timeout: 3_000 });
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "地标" })).toHaveAttribute("aria-selected", "true");
});

test("【缺陷】城市的时区是浏览器清单里没有的写法（别名，接口接受）时，编辑页的「时区」显示成空的，像是没填", async ({ page, request }) => {
  await signInAsAdmin(page);
  // 同一个时区的新旧两种写法，后端都接受；浏览器的清单里一般只有其中一种
  const pairs = [["Asia/Kolkata", "Asia/Calcutta"], ["Asia/Ho_Chi_Minh", "Asia/Saigon"], ["Europe/Kyiv", "Europe/Kiev"], ["Asia/Yangon", "Asia/Rangoon"], ["Asia/Kathmandu", "Asia/Katmandu"]] as const;
  const listed = new Set(await page.evaluate(() => Intl.supportedValuesOf("timeZone")));
  const missing = pairs.flat().find((zone) => !listed.has(zone));
  test.skip(missing === undefined, "这个浏览器的时区清单里两种写法都有");
  const zone = missing as string;
  const city = await createCity(request, "IN", zone, { zh: `时区别名城${randomLetters(4)}` });
  await page.goto(`/platform/master/cities/${city.id}`);
  await expect(page.getByLabel("名称 中文")).toHaveValue(city.name["zh"] ?? "");
  await expect(page.getByRole("combobox", { name: /时区/ }), `接口里存的是 ${zone}`).toHaveValue(new RegExp(zone.split("/")[1] ?? zone), { timeout: 5_000 });
});
