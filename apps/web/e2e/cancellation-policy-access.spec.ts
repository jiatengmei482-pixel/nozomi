/**
 * M4-15（ADR 0047 补充）端到端：真实浏览器 → 真实 API → 真实 PostgreSQL。
 * - 只勾「商品 · 查看」的员工打开商品服务规则：看得到取消规则，没有被拒的请求；
 * - 只勾「渠道 · 查看」的员工手改地址打开新建渠道：写没有权限，没有被拒的请求；
 * - 320 宽的下拉里，英文城市名不在单词中间折行，编码换到下一行；1280 宽仍在同一行。
 */
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { CENTER, createProductByApi, createSupplier, createWorld } from "./catalog.ts";
import { loginAs, newPassword, platformAdminHeaders, randomLetters, uniqueEmail } from "./support.ts";

async function staffWith(request: APIRequestContext, page: Page, grants: string[]): Promise<void> {
  const headers = await platformAdminHeaders(request);
  const role = await request.post("/platform/v1/roles", { headers, data: { name: `QA ${crypto.randomUUID().slice(0, 8)}`, grants, data_scope: { city_ids: null, channel_ids: null } } });
  expect(role.status(), await role.text()).toBe(201);
  const email = uniqueEmail("m415");
  const created = await request.post("/platform/v1/staff", { headers, data: { email, name: "权限测试员", role: ((await role.json()) as { key: string }).key } });
  expect(created.status(), await created.text()).toBe(201);
  const password = newPassword();
  const invite = ((await created.json()) as { invite: { token: string } }).invite.token;
  expect((await request.post("/platform/v1/auth/accept-invite", { data: { token: invite, password } })).ok()).toBe(true);
  await loginAs(page, "platform", email, password);
}

function rejectedCalls(page: Page): string[] {
  const rejected: string[] = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/platform/v1/") && response.status() >= 400) rejected.push(`${response.status()} ${url.pathname}`);
  });
  return rejected;
}

test("只有商品查看：服务规则里看得到取消规则，没有被拒的请求", async ({ page, request }) => {
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  const product = await createProductByApi(request, supplier, world, "airport_transfer");
  await staffWith(request, page, ["products:view"]);
  const rejected = rejectedCalls(page);

  await page.goto(`/platform/products/${product.id}/service-rules`);
  await expect(page.getByRole("list", { name: "平台的取消政策" }).getByRole("listitem").first()).toBeVisible();
  await expect(page.getByText("正在取平台的取消政策…")).toHaveCount(0);
  expect(rejected).toEqual([]);
});

test("只有渠道查看：手改地址打开新建渠道，写没有权限，没有被拒的请求", async ({ page, request }) => {
  await staffWith(request, page, ["channels:view"]);
  const rejected = rejectedCalls(page);
  await page.goto("/platform/channels/new");
  await expect(page.getByText("你没有权限查看这里")).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(rejected).toEqual([]);
});

test("下拉里的英文城市名不在单词中间折行：320 宽编码换行，1280 宽同一行", async ({ page, request }) => {
  const tag = randomLetters(5);
  const name = `Yamaguchi${tag}`;
  const headers = await platformAdminHeaders(request);
  const city = await request.post("/platform/v1/master/cities", { headers, data: { code: `CTY-JP-${tag}`, country_code: "JP", name: { zh: name }, timezone: "Asia/Tokyo", center: CENTER } });
  expect(city.status(), await city.text()).toBe(201);
  await staffWith(request, page, ["quote_preview:view"]);

  const measure = async (): Promise<{ labelLines: number; labelFullWidth: boolean; detailBelow: boolean; panelOverflow: boolean }> => {
    const box = page.getByRole("combobox", { name: /城市/ });
    await box.fill(name);
    const option = page.getByRole("option").filter({ hasText: name });
    await expect(option).toBeVisible();
    return option.evaluate((node) => {
      const label = node.querySelector(".combobox__option-label") as HTMLElement;
      const detail = node.querySelector(".combobox__option-detail") as HTMLElement;
      const range = document.createRange();
      range.selectNodeContents(label);
      const lines = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
      const panel = node.closest(".combobox__panel") as HTMLElement;
      return { labelLines: lines, labelFullWidth: label.scrollWidth <= label.clientWidth, detailBelow: detail.getBoundingClientRect().top >= label.getBoundingClientRect().bottom, panelOverflow: panel.scrollWidth > panel.clientWidth };
    });
  };

  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/platform/quote-preview");
  const narrow = await measure();
  expect(narrow).toEqual({ labelLines: 1, labelFullWidth: true, detailBelow: true, panelOverflow: false });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload();
  const wide = await measure();
  expect(wide).toEqual({ labelLines: 1, labelFullWidth: true, detailBelow: false, panelOverflow: false });
});
