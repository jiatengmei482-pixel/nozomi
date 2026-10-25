/**
 * 机场的中文名、日文名从 GeoNames 导入之后（M1-15），供应商新建接送机商品时在「接送点」里输入「成田」能找到成田机场。真实后端。
 * 机场经真实的机场导入命令导入（OurAirports 格式的小样本），名称经真实的机场名称导入命令填入（GeoNames 格式的小样本）：
 * 名称只出现在这条用例现场构造的文件里，不预置在仓库或数据库里。
 */
import { expect, test } from "@playwright/test";
import { createBrand, createWorld, tenantHeaders } from "./catalog.ts";
import { createActiveTenant, importAirportNames, importAirports, loginAs, platformAdminHeaders, randomLetters } from "./support.ts";

test("导入名称后，接送点里输入「成田」「成田机场」「成田空港」都找得到成田国际机场（导入的英文名里没有「成田」）", async ({ page, request }) => {
  test.slow();
  const world = await createWorld(request);
  const tag = randomLetters(4);
  const iata = `N${randomLetters(2)}`;
  const location = { lat: 35.764702, lng: 140.386002 };
  await importAirports("JP", [{ iata, name: `Sample Narita ${tag} International Airport`, ...location }]);
  await importAirportNames("JP", [{ iata, ...location, names: { ja: `成田${tag}国際空港`, "zh-CN": `成田${tag}国际机场`, "zh-Hant": `成田${tag}國際機場` } }]);

  const headers = await platformAdminHeaders(request);
  const listed = await request.get(`/platform/v1/master/places?code=${iata}&status=all`, { headers });
  const airport = ((await listed.json()) as { items: { id: string; name: Record<string, string> }[] }).items[0];
  expect(airport?.name, "名称导入命令填好了日文、简体中文").toEqual({ en: `Sample Narita ${tag} International Airport`, ja: `成田${tag}国際空港`, zh: `成田${tag}国际机场` });
  const enabled = await request.post(`/platform/v1/master/places/${airport?.id}/enable`, { headers, data: { city_id: world.city.id } });
  expect(enabled.status(), "平台指定城市并启用").toBe(200);

  const tenant = await createActiveTenant(request);
  await createBrand(request, await tenantHeaders(request, tenant.adminEmail, tenant.password), `品牌 ${randomLetters(4)}`);
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  await page.goto("/products/new");
  const cityBox = page.getByRole("combobox", { name: /城市/ });
  await cityBox.click();
  await cityBox.fill(world.city.code);
  await page.getByRole("option", { name: new RegExp(world.city.code) }).first().click();
  await page.getByRole("radio", { name: /^接送机/ }).check();
  const pickup = page.getByRole("combobox", { name: /接送点/ });
  await pickup.click();
  await pickup.fill(`成田${tag}`);
  const options = page.getByRole("option");
  await expect(options).toHaveCount(1);
  await expect(options.first()).toContainText(iata);
  for (const query of [`成田${tag}机场`, `成田${tag}空港`]) {
    await pickup.fill(query);
    await expect(options, `M1-17：「${query}」也找得到正式名称是「成田${tag}国际机场」的机场`).toHaveCount(1);
    await expect(options.first()).toContainText(iata);
  }
  await options.first().click();
  await expect(pickup).toHaveValue(`成田${tag}国际机场`);
});
