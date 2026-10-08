/**
 * 处理导入的机场：建议城市（M1-09；排序规则见 M1-11），真实后端。
 * 城市经接口新建（启用的、中心坐标由用例给定），机场经真实的导入命令从用例构造的小样本导入。
 */
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { adminCredentials, importAirports, loginAs, platformAdminHeaders, randomLetters } from "./support.ts";

interface Created {
  id: string;
  code: string;
  name: string;
}

async function createCityAt(request: APIRequestContext, country: string, timezone: string, name: string, center: { lat: number; lng: number }): Promise<Created> {
  const headers = await platformAdminHeaders(request);
  const code = `CTY-${country}-${randomLetters(6)}`;
  const response = await request.post("/platform/v1/master/cities", { headers, data: { code, country_code: country, name: { zh: name }, timezone, center } });
  expect(response.status(), "接口新建城市").toBe(201);
  return { id: ((await response.json()) as { id: string }).id, code, name };
}

async function placeByCode(request: APIRequestContext, code: string): Promise<{ id: string; city_id: string | null; status: string }> {
  const headers = await platformAdminHeaders(request);
  const response = await request.get(`/platform/v1/master/places?code=${code}&status=all`, { headers });
  const item = ((await response.json()) as { items: { id: string; city_id: string | null; status: string }[] }).items[0];
  if (!item) throw new Error(`找不到地点 ${code}`);
  return item;
}

const cityBox = (page: Page) => page.getByRole("combobox", { name: /所属城市/ });
const code = (page: Page) => page.locator(".pending__code");
const candidates = (page: Page) => page.locator(".suggestions__option");

test("流水线页预填建议的城市并列出候选：连续按 Enter 处理、换候选、没有建议的机场保持原样", async ({ page, request }) => {
  test.slow();
  const country = "UY";
  const tag = randomLetters(4);
  // 两个城市相距约 20 公里：机场 A、B 离「近城」更近，但两个都在候选里；机场 C 在 300 多公里外，没有建议
  const near = await createCityAt(request, country, "America/Montevideo", `近城${tag}`, { lat: -34.9, lng: -56.2 });
  const far = await createCityAt(request, country, "America/Montevideo", `远城${tag}`, { lat: -34.72, lng: -56.2 });
  const prefix = `U${randomLetters(1)}`;
  const airports = [
    { iata: `${prefix}A`, name: `QA Suggest ${tag} Alpha Airport`, lat: -34.86, lng: -56.2 },
    { iata: `${prefix}B`, name: `QA Suggest ${tag} Bravo Airport`, lat: -34.84, lng: -56.2 },
    { iata: `${prefix}C`, name: `QA Suggest ${tag} Charlie Airport`, lat: -31.4, lng: -57.9 },
  ];
  await importAirports(country, airports);
  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);
  let writes = 0;
  page.on("request", (sent) => {
    if (sent.method() !== "GET" && sent.url().includes("/platform/v1/master/")) writes += 1;
  });

  await page.goto(`/platform/master/places/pending?country=${country}`);
  await expect(code(page)).toHaveText(`${prefix}A`);
  await expect(cityBox(page), "首选的城市预先填好").toHaveValue(near.name);
  await expect(page.getByText(new RegExp(`^建议：${near.name}（约 \\d+ 公里）。按机场资料里的所属城市和周边的大城市给出的建议，请核对后再保存。$`))).toBeVisible();
  await expect(candidates(page)).toHaveCount(2);
  await expect(candidates(page).nth(0)).toContainText(near.name);
  await expect(candidates(page).nth(0)).toHaveAttribute("aria-pressed", "true");
  await expect(candidates(page).nth(1)).toContainText(far.name);
  await expect(candidates(page).nth(1)).toContainText(/约 \d+ 公里/);
  await expect(page.getByText("建议不一定对，请核对", { exact: false })).toBeVisible();
  expect(writes, "预填不等于处理：还没有发任何修改请求").toBe(0);
  expect((await placeByCode(request, `${prefix}A`)).city_id).toBeNull();

  // 第一个：直接按 Enter
  await expect(cityBox(page), "轮到一个机场时焦点在所属城市").toBeFocused();
  await page.keyboard.press("Enter");
  await expect(code(page)).toHaveText(`${prefix}B`);
  await expect(cityBox(page)).toHaveValue(near.name);
  await expect(cityBox(page)).toBeFocused();

  // 第二个：首选的不对，用键盘换成另一个候选再确认
  await candidates(page).nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(cityBox(page)).toHaveValue(far.name);
  await expect(candidates(page).nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "保存并启用" })).toBeFocused();
  await page.keyboard.press("Enter");

  // 第三个：80 公里内没有城市，不预填、没有候选；按 Enter 不会把它处理掉
  await expect(code(page)).toHaveText(`${prefix}C`);
  await expect(cityBox(page)).toHaveValue("");
  await expect(candidates(page)).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(page.getByText("请选择所属城市")).toBeVisible();
  // 仍然可以自己搜一个
  await cityBox(page).fill(far.code);
  await page.keyboard.press("Enter");
  await expect(cityBox(page)).toHaveValue(far.name);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: /没有待指定城市的机场/ })).toBeVisible();

  expect(await placeByCode(request, `${prefix}A`)).toMatchObject({ city_id: near.id, status: "active" });
  expect(await placeByCode(request, `${prefix}B`)).toMatchObject({ city_id: far.id, status: "active" });
  expect(await placeByCode(request, `${prefix}C`)).toMatchObject({ city_id: far.id, status: "active" });
  const geonames = page.locator(".page__attribution").getByRole("link", { name: /^GeoNames/ });
  await expect(geonames).toHaveAttribute("href", "https://www.geonames.org/");
  await expect(geonames).toHaveAttribute("rel", "noopener noreferrer");
  await expect(page.locator(".page__attribution").filter({ hasText: "城市数据来自" })).toContainText("CC BY 4.0");
});

test("列表的编码列永远是单行（三字码不会被挤成一个字母一行），名称很长时名称列自己折行", async ({ page, request }) => {
  const country = "PY";
  const tag = randomLetters(4);
  const iata = `P${randomLetters(2)}`;
  const longName = `QA ${tag} Cheongju International Airport/Cheongju Air Base (K-59/G-513) Very Long Official Name`;
  await createCityAt(request, country, "America/Asuncion", `亚松森${tag}`, { lat: -25.3, lng: -57.6 });
  await importAirports(country, [{ iata, name: longName, lat: -25.24, lng: -57.52 }]);
  const headers = await platformAdminHeaders(request);
  const addonCode = `ADD-QA_SINGLE_LINE_${randomLetters(10)}`;
  expect((await request.post("/platform/v1/master/addons", { headers, data: { code: addonCode, categories: ["charter"], charge_unit: "per_order", name: { zh: `单行编码${tag}` }, description: {} } })).status()).toBe(201);
  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);

  const lines = (locator: ReturnType<Page["getByRole"]>): Promise<number> => locator.evaluate((element) => new Set([...element.getClientRects()].map((rect) => Math.round(rect.top))).size);
  const pages: [string, string][] = [
    [`/platform/master/places?country=${country}`, iata],
    [`/platform/master/cities?country=${country}`, `CTY-${country}-`],
    [`/platform/master/addons?q=${addonCode}`, addonCode],
    ["/platform/master/vehicle-groups", ""],
  ];
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 800 });
    for (const [path, expected] of pages) {
      await page.goto(path);
      await expect(page.getByRole("region", { name: /列表$/ })).toBeVisible();
      const links = page.locator("tbody th[scope=row] a");
      if (expected !== "") await expect(links.filter({ hasText: expected }).first()).toBeVisible();
      for (const link of await links.all()) {
        expect(await lines(link), `${path} @${width}px：编码「${await link.textContent()}」应是单行`).toBe(1);
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} @${width}px 页面不横向滚动`).toBe(0);
    }
  }
  // 长名称：在名称列里折行，不把表格撑到几千像素宽
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/platform/master/places?country=${country}`);
  const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: iata, exact: true }) });
  await expect(row).toContainText(longName);
  const nameCell = await row.locator("td").first().boundingBox();
  expect(nameCell?.width ?? 0, "名称列有宽度上限").toBeLessThanOrEqual(360);
});
