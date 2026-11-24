/**
 * 端到端测试公用步骤自己的检查（M8-29b）：建测试城市撞上已用的编码时换一个 tag 重建，别的错误照常让用例失败；
 * 导入机场时三字码已被手工建的机场占着，换一个三字码重导。随机撞号在一次运行里只是偶尔发生，这里用指定的编码把「撞上」做成必然。
 */
import { expect, test } from "@playwright/test";
import { CENTER } from "./catalog.ts";
import { createTestCity, importNewAirports, platformAdminHeaders, randomLetters } from "./support.ts";

const body = (tag: string) => ({ name: { zh: `撞号城市${tag}` }, timezone: "Asia/Tokyo", center: CENTER });

test("建测试城市：编码已被使用就换一个 tag 重建；连续撞上、别的错误都让用例失败", async ({ request }) => {
  const headers = await platformAdminHeaders(request);
  const taken = await createTestCity(request, headers, body);
  expect(taken.code).toBe(`CTY-JP-${taken.tag}`);

  const fresh = randomLetters(5);
  const tags = [taken.tag, fresh];
  const retried = await createTestCity(request, headers, body, { nextTag: () => tags.shift() ?? randomLetters(5) });
  expect(tags, "第一个 tag 撞上后接着用了第二个").toEqual([]);
  expect(retried.tag).toBe(fresh);
  expect(retried.code).toBe(`CTY-JP-${fresh}`);
  expect(retried.name).toBe(`撞号城市${fresh}`);
  const saved = await request.get(`/platform/v1/master/cities/${retried.id}`, { headers });
  expect(((await saved.json()) as { code: string }).code).toBe(retried.code);

  await expect(createTestCity(request, headers, body, { nextTag: () => taken.tag })).rejects.toThrow("连续 8 次撞上已用的城市编码");
  await expect(createTestCity(request, headers, (tag) => ({ ...body(tag), timezone: "Not/AZone" }))).rejects.toThrow("新建城市只容许编码已被使用：400");
});

test("导入机场：三字码已被手工建的机场占着时换一个三字码重导，名称、坐标不变", async ({ request }) => {
  const headers = await platformAdminHeaders(request);
  const city = await createTestCity(request, headers, body);
  let taken = "";
  for (let attempt = 0; attempt < 8 && taken === ""; attempt += 1) {
    const code = `U${randomLetters(2)}`;
    const made = await request.post("/platform/v1/master/places", { headers, data: { type: "airport", code, city_id: city.id, name: { zh: `占号机场${city.tag}` }, location: CENTER, flight_scope: "mixed" } });
    if (made.status() === 201) taken = code;
    else expect(made.status(), await made.text()).toBe(409);
  }
  const wanted = { iata: taken, name: `E2E Occupied ${city.tag} Airport`, lat: -1.3, lng: 36.8 };
  const [imported] = await importNewAirports("KE", [wanted], () => `U${randomLetters(2)}`);
  expect(imported?.iata, "换了三字码").not.toBe(taken);
  expect(imported?.name).toBe(wanted.name);
  const found = (await (await request.get(`/platform/v1/master/places?q=${imported?.iata}`, { headers })).json()) as { items: { code: string; name: { en?: string } }[] };
  expect(found.items.map((item) => item.code)).toContain(imported?.iata);
});
