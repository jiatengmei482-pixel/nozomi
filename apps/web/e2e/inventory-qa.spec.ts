/**
 * M1-05 测试工程师补充（端到端，真实后端、真实 PostgreSQL）：
 * 文件里的内容在检查结果里只当文字（XSS）、真实的坏文件经页面上传得到看得懂的说明、
 * 网络不确定时重试不会导入两次、导出的令牌只走请求头、768 宽和暗色下的检查结果。
 * 测试用的 .xlsx 都在这里现场拼，不存二进制文件。
 */
import { type APIRequestContext, type Page, type Request, expect, test } from "@playwright/test";
import { addDays } from "@nozomi/domain";
import { type Supplier, type World, createArea, createProductByApi, createSupplier, createWorld, expectAccessible } from "./catalog.ts";
import { expectNoHorizontalOverflow, loginAs } from "./support.ts";
import { readDownload, readSheet, upload, writeSheet } from "./xlsx.ts";

async function version(request: APIRequestContext, supplier: Supplier, productId: string): Promise<number> {
  return ((await (await request.get(`/tenant/v1/products/${productId}`, { headers: supplier.headers })).json()) as { version: number }).version;
}
async function localToday(request: APIRequestContext, supplier: Supplier, productId: string): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  const response = await request.get(`/tenant/v1/products/${productId}/inventory`, { headers: supplier.headers, params: { from: day, to: day } });
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { today: string }).today;
}
async function totalOf(request: APIRequestContext, supplier: Supplier, productId: string, date: string): Promise<number | null> {
  const response = await request.get(`/tenant/v1/products/${productId}/inventory`, { headers: supplier.headers, params: { from: date, to: date } });
  return ((await response.json()) as { days: { total: number | null }[] }).days[0]?.total ?? null;
}
const chooseFile = (page: Page, name: string, bytes: Buffer): Promise<void> => page.locator("#import-file").setInputFiles(upload(name, bytes));

test("文件里的区域名、车型组、单元格内容带 HTML：检查结果里只当文字显示，不执行；坏文件（不是 xlsx、截断）经页面上传得到看得懂的说明；768 宽、亮暗两种配色没有无障碍问题", async ({ page, request }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  const world: World = await createWorld(request);
  const supplier = await createSupplier(request, world);
  const evil = '<img src=x onerror="window.__xss=1">';
  const evilArea = await createArea(request, supplier.headers, world.city, evil);
  const product = await createProductByApi(request, supplier, world, "airport_transfer");
  const withArea = await request.put(`/tenant/v1/products/${product.id}`, { headers: { ...supplier.headers, "if-match": `"${product.version}"` }, data: { areas: [{ area_id: supplier.area.id }, { area_id: evilArea.id }] } });
  const areaAdded = withArea.status() === 200;
  const now = await localToday(request, supplier, product.id);
  const template = await request.get(`/tenant/v1/products/${product.id}/price-rules/export?rows=none`, { headers: supplier.headers });
  expect(template.status()).toBe(200);
  const header = readSheet(await template.body()).rows[0] as string[];
  const row = (values: Record<string, string>): (string | null)[] => header.map((column) => values[column] ?? null);
  const base = { 车型组: world.group.code, 方向: "接送通用", 计价方式: "一口价", 基础价: "20000", 生效开始: now };
  const file = writeSheet({
    name: "价格",
    rows: [
      header,
      row({ ...base, 区域: areaAdded ? evil : supplier.area.name }),
      row({ ...base, 区域: "<script>window.__xss=2</script>", 方向: "接机" }),
      row({ ...base, 区域: supplier.area.name, 车型组: '"><svg onload="window.__xss=3">', 方向: "送机" }),
      row({ ...base, 区域: supplier.area.name, 方向: "<b onmouseover=\"window.__xss=4\">接机</b>", 基础价: "<i>很多</i>" }),
    ],
  });

  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);
  await page.goto(`/products/${product.id}/prices`);
  await page.getByRole("button", { name: "导入 / 导出" }).click();
  await page.getByRole("menuitem", { name: "导入价格…" }).click();
  await expect(page.getByRole("heading", { level: 3, name: "导入价格" })).toBeVisible();

  // 坏文件：每一种都回到选文件，说明看得懂，页面没有崩
  const good = Buffer.from(file);
  const bad: [string, Buffer, RegExp][] = [
    ["改了扩展名的文字.xlsx", Buffer.from("区域,基础价\n东京,20000\n"), /这不是一个 \.xlsx 文件/],
    ["截断的.xlsx", good.subarray(0, Math.floor(good.length * 0.6)), /这不是一个 \.xlsx 文件|这个文件打不开，可能已经损坏/],
    ["末尾少一个字节.xlsx", good.subarray(0, good.length - 1), /这不是一个 \.xlsx 文件|这个文件打不开，可能已经损坏/],
  ];
  for (const [name, bytes, message] of bad) {
    await chooseFile(page, name, bytes);
    await expect(page.getByText(message), name).toBeVisible();
    await expect(page.locator(".import-steps [aria-current=step]")).toHaveText("1 选文件");
  }

  await chooseFile(page, "带 HTML 的价格.xlsx", file);
  await expect(page.locator(".import-steps [aria-current=step]")).toHaveText("2 看检查结果");
  await page.getByRole("checkbox", { name: "只看有问题的" }).uncheck();
  const table = page.locator(".import-table");
  await expect(table.locator("tbody tr")).toHaveCount(4);
  await expect(table).toContainText("<script>window.__xss=2</script>");
  await expect(table).toContainText('"><svg onload="window.__xss=3">');
  if (areaAdded) await expect(table).toContainText(evil);
  expect(await page.locator("main img[src='x'], main svg[onload], main script, main b[onmouseover], main i").count(), "文件里的 HTML 没有变成页面上的元素").toBe(0);
  await table.locator("tbody tr").nth(3).hover();
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss ?? null), "文件里的脚本没有执行").toBeNull();
  expect(dialogs).toEqual([]);

  // 768 宽、亮暗两种配色
  await page.setViewportSize({ width: 768, height: 1024 });
  await expectNoHorizontalOverflow(page, "带 HTML 的检查结果（768 宽）");
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `导入价格的检查结果（768 宽，${scheme}）`);
  }
  await page.setViewportSize({ width: 320, height: 640 });
  await expectNoHorizontalOverflow(page, "带 HTML 的检查结果（320 宽）");
  await page.emulateMedia({ colorScheme: "light" });
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss ?? null)).toBeNull();
});

test("网络不确定（请求到了服务器、应答没回来）：页面说「不确定有没有导入成功」，再点一次用的是同一个幂等键，只导入了一次；导出的令牌只在请求头里，失败能重试", async ({ page, request }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  const product = await createProductByApi(request, supplier, world, "airport_transfer");
  const now = await localToday(request, supplier, product.id);
  const limited = await request.put(`/tenant/v1/products/${product.id}/inventory`, { headers: { ...supplier.headers, "if-match": `"${product.version}"` }, data: { mode: "limited" } });
  expect(limited.status(), await limited.text()).toBe(200);
  const before = await version(request, supplier, product.id);
  const file = writeSheet({ name: "库存", rows: [["日期", "可售单数"], [now, "7"], [addDays(now, 1), "8"]] });

  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);
  await page.goto(`/products/${product.id}/inventory/import`);
  await chooseFile(page, "库存.xlsx", file);
  await expect(page.getByText("检查通过，可以导入")).toBeVisible();

  const confirms: Request[] = [];
  page.on("request", (sent) => {
    if (sent.method() === "POST" && /\/inventory\/import\?/.test(sent.url())) confirms.push(sent);
  });
  let dropped = 0;
  await page.route(/\/inventory\/import\?/, async (route) => {
    if (dropped === 0) {
      dropped += 1;
      // 请求真的发到了服务器并且做完了，只是应答没有回到浏览器
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      return route.abort("connectionreset");
    }
    return route.continue();
  });
  const confirm = page.getByRole("dialog", { name: "确认导入？" });
  await page.getByRole("button", { name: "确认导入" }).click();
  await confirm.getByRole("button", { name: "确认导入" }).click();
  await expect(page.getByText("不确定有没有导入成功。")).toBeVisible();
  await expect(page.getByText("重复点不会导入两次", { exact: false })).toBeVisible();
  expect(await totalOf(request, supplier, product.id, now), "第一次其实已经写进去了").toBe(7);
  expect(await version(request, supplier, product.id)).toBe(before + 1);

  await page.getByRole("button", { name: "确认导入" }).click();
  await confirm.getByRole("button", { name: "确认导入" }).click();
  await expect(page.getByText("已给 2 天设了库存、清除了 0 天，共变了 2 天。")).toBeVisible();
  await expect(page.locator(".import-steps [aria-current=step]")).toHaveText("3 完成");
  expect(confirms.length).toBe(2);
  const keys = confirms.map((sent) => sent.headers()["idempotency-key"]);
  expect(keys[0], "带了幂等键").toMatch(/^[0-9a-f-]{36}$/);
  expect(keys[1], "重试用的是同一个幂等键").toBe(keys[0]);
  expect(await version(request, supplier, product.id), "没有导入两次").toBe(before + 1);
  expect([await totalOf(request, supplier, product.id, now), await totalOf(request, supplier, product.id, addDays(now, 1))]).toEqual([7, 8]);
  await page.unroute(/\/inventory\/import\?/);

  // 导出：令牌只在请求头里；第一次失败能重试；文件名是服务器给的
  await page.getByRole("button", { name: "回到库存" }).click();
  const exports: Request[] = [];
  page.on("request", (sent) => {
    if (/\/inventory\/export/.test(sent.url())) exports.push(sent);
  });
  let failed = 0;
  await page.route(/\/inventory\/export/, (route) => {
    if (failed === 0) {
      failed += 1;
      return route.abort("failed");
    }
    return route.continue();
  });
  await page.getByRole("button", { name: "导入 / 导出" }).click();
  await page.getByRole("menuitem", { name: "导出库存…" }).click();
  const exportDialog = page.getByRole("dialog", { name: "导出库存" });
  await exportDialog.getByRole("button", { name: "导出", exact: true }).click();
  await expect(page.getByText("文件没有准备好，请稍后再试。")).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "重试" }).first().click()]);
  const saved = await readDownload(download);
  expect(saved.name).toMatch(/^[A-Za-z0-9-]+-inventory-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.xlsx$/);
  expect(download.url(), "交给浏览器保存的是页面里的临时地址，不是带令牌的链接").toMatch(/^blob:/);
  expect(readSheet(saved.bytes).rows.slice(0, 3)).toEqual([["日期", "可售单数"], [now, "7"], [addDays(now, 1), "8"]]);
  expect(exports.length).toBe(2);
  for (const sent of exports) {
    expect(sent.headers()["authorization"], "令牌在请求头里").toMatch(/^Bearer \S+/);
    const token = (sent.headers()["authorization"] ?? "").replace(/^Bearer /, "");
    expect(sent.url()).not.toContain(token);
    expect(sent.url()).not.toMatch(/token|authorization|bearer|eyJ/i);
  }
});
