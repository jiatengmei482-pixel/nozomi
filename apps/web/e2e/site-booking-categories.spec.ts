/**
 * 端到端：官网订点对点和包车（M3-10）。真实浏览器 → 前端 → 真实 API（`/site/v1`）→ 真实 PostgreSQL，不 mock 接口。
 * 供应商经接口在本用例自己的城市（book-new-support.ts 的 pointToPointCity）上架一个点对点商品（一口价 15,000 日元）。客人打开带参数的预订链接 /book（M8-05 起是四步新流程；两端都不是机场，按点对点报价）
 * → 选车 → 乘客信息 → 核对、去付款 → 订单页看到这一单的行程（端到端没有 Stripe，订单待付款）。包车的旧链接 /book/new?mode=charter 转到预订页的包车。
 * 每一步在 320 / 360 / 400 宽不横向滚动，亮色、暗色各过一遍 axe。
 */
import { type Page, expect, test } from "@playwright/test";
import { pointToPointCity } from "./book-new-support.ts";
import { expectAccessible } from "./catalog.ts";
import { randomLetters, OWN_SITE_SOURCE } from "./support.ts";

// 官网按来源地址限速：每条用例带自己的文档专用地址，不和并行的官网用例在 127.0.0.1 上抢同一份额度（M8-17）
test.use(OWN_SITE_SOURCE);

/** 东京的明天 10:00。 */
function tomorrowInTokyo(): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(Date.now() + 24 * 3_600_000)).map((part) => [part.type, part.value]));
  return `${parts["year"]}-${parts["month"]}-${parts["day"]}`;
}

async function expectNoOverflow(page: Page, what: string): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  for (const size of [{ width: 320, height: 640 }, { width: 360, height: 740 }, { width: 400, height: 800 }]) {
    await page.setViewportSize(size);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${what}：${size.width}px 宽横向溢出`).toBe(0);
  }
  await page.setViewportSize(viewport);
}

async function expectAccessibleBothThemes(page: Page, what: string): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${what}（${scheme === "light" ? "亮色" : "暗色"}）`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

/** 第 2 步选好车型以后：乘客信息（点对点没有航班号）→ 核对 → 同意保存银行卡、去付款 → 订单页；返回订单号。 */
async function placeFromVehicles(page: Page, email: string): Promise<string> {
  const bar = page.locator(".step-bar");
  await bar.getByRole("button", { name: "下一步：填写乘客信息" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "乘客信息" })).toBeFocused();
  await expect(page.getByLabel(/^航班号/)).toHaveCount(0);
  await page.getByLabel("乘车人姓名").fill("陈小红");
  await page.getByLabel("手机号（含国家区号）").fill("+81 90-2222-3333");
  await page.getByLabel("邮箱").fill(email);
  await page.getByRole("button", { name: "下一步：核对订单" }).click();
  await page.getByRole("checkbox", { name: /同意保存这次付款用的银行卡/ }).check();
  await expectNoOverflow(page, "预订页（核对）");
  await bar.getByRole("button", { name: "去付款 →" }).click();
  const heading = page.getByRole("heading", { level: 1, name: /^订单 NZ/ });
  await expect(heading).toBeVisible();
  await expect(page.getByText("待付款", { exact: true })).toBeVisible();
  return ((await heading.textContent()) ?? "").replace("订单 ", "").trim();
}

test("官网点对点：带参数的预订链接（两端都不是机场）→ 报价 → 选车 → 下单 → 订单页按服务显示行程；没有供应商和结算价；包车的旧链接转到预订页的包车", async ({ page, request }) => {
  test.setTimeout(150_000);
  const { world, center } = await pointToPointCity(request, { pricing_model: "fixed", base_price: 15000 });
  const station = `望站${randomLetters(4)}`;
  const date = tomorrowInTokyo();
  await page.setViewportSize({ width: 400, height: 800 });

  // 点对点：M8-05 起 /book 是四步新流程，客人不选「接送机还是点对点」，两端都不是机场就按点对点报价
  await page.goto(`/book?from=${center.lat},${center.lng}&from_name=${encodeURIComponent(station)}&to=${center.lat + 0.01},${center.lng + 0.01}&to_name=${encodeURIComponent("新宿站南口")}&date=${date}&time=10:00`);
  await expect(page.getByRole("heading", { level: 1, name: "预订接送车" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "选择车型" })).toBeVisible();
  await expect(page.locator(".book-summary-bar__text")).toContainText(`${station} → 新宿站南口`);
  const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: world.group.name }) });
  await expect(card).toContainText("16,500 JPY");
  await expect(page.locator("main")).not.toContainText(/结算|加价|供应商|15,000/);
  await expectNoOverflow(page, "预订页（点对点，车型和价格）");
  await expectAccessibleBothThemes(page, "预订页（点对点，车型和价格）");
  await card.getByRole("button", { name: `选择 ${world.group.name}` }).click();
  await placeFromVehicles(page, `p2p-${crypto.randomUUID().slice(0, 8)}@e2e.example.com`);
  const trip = page.getByRole("region", { name: "行程" });
  await expect(trip).toContainText("点对点");
  await expect(trip).toContainText(`${station} → 新宿站南口`);
  await expect(page.getByRole("button", { name: "我已落地" })).toHaveCount(0);
  await expectNoOverflow(page, "订单页（点对点）");
  await expectAccessibleBothThemes(page, "订单页（点对点）");

  // 包车：M8-15 起旧询价页跳去的地址 /book/new?mode=charter 转到 /book?mode=charter，第 1 步的「包车」标签已选上；包车下单由 site-booking-charter.spec.ts 覆盖
  await page.goto("/book/new?mode=charter");
  await expect(page).toHaveURL(/\/book\?mode=charter$/);
  await expect(page.getByRole("heading", { name: "你的行程" })).toBeVisible();
  await expect(page.getByRole("group", { name: "用车类型" }).getByRole("radio", { name: "包车" })).toBeChecked();
  await expect(page.getByLabel(/^城市/)).toHaveCount(0);
});
