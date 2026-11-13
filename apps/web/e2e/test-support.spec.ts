/**
 * 端到端测试公用步骤自己的检查（M8-29）：建测试城市撞上已用的编码时换一个 tag 重建，别的错误照常让用例失败。
 * 随机撞号在一次运行里只是偶尔发生，这里用指定的 tag 把「撞上」做成必然。
 */
import { expect, test } from "@playwright/test";
import { CENTER } from "./catalog.ts";
import { createTestCity, platformAdminHeaders, randomLetters } from "./support.ts";

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
