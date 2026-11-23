/**
 * 端到端：官网下单（M3-05，ADR 0032）。真实浏览器 → 前端 → 真实 API（`/site/v1`，官网的渠道和 API 客户端由 global-setup 经运营后台接口建好）→ 真实 PostgreSQL，不 mock 接口。
 * 客人打开带参数的预订链接 /book（M8-05 起是四步新流程；本用例专用的机场，日期时间按东京的「现在」往后推）→ 选车 → 乘客信息 → 核对、去付款 →
 * 订单页：端到端测试里没有 Stripe，页面写「付款暂未开放」、订单待支付；
 * 「付款」由用例用迁移账号直接在库里把这一单记成已付款、已确认（支付替身：等同于收到 Stripe 的付款成功通知，只在测试里构造）→ 刷新后点「我已落地」（验收标准）。
 * 另外看「查订单」页（链接发到邮箱的流程见 site-lookup-email.spec.ts），用邮件里那种链接打开订单；每一步在 320 / 360 / 400 宽不横向滚动，亮色、暗色各过一遍 axe。
 * M3-11（pages/site-booking.md 11.2）：订单页「当下要做的事」排第一、取消政策的客人说法和「不退款」、
 * 日期「…月…日（周…）」、「复制链接」按钮、改单表单的字段级错误、顶栏当前页和 320px 的两行排法。
 */
import { type Page, expect, test } from "@playwright/test";
import { createPool } from "../../api/src/db/pool.ts";
import { airportLink, createAirport, publishTransfer } from "./book-new-support.ts";
import { CENTER, createSupplier, createWorld, expectAccessible } from "./catalog.ts";
import { E2E_SUPPORT_PHONE, issueSiteLink, OWN_SITE_SOURCE } from "./support.ts";

// 官网按来源地址限速：每条用例带自己的文档专用地址，不和并行的官网用例在 127.0.0.1 上抢同一份额度（M8-17）
test.use(OWN_SITE_SOURCE);

/** 东京的「现在 + 两小时」（取整到 5 分钟）：离计划到达不到 3 小时，付款后马上就能点「我已落地」。 */
function serviceTimeInTokyo(): { date: string; time: string } {
  const at = new Date(Math.ceil((Date.now() + 2 * 3_600_000) / 300_000) * 300_000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at).map((part) => [part.type, part.value]));
  return { date: `${parts["year"]}-${parts["month"]}-${parts["day"]}`, time: `${parts["hour"]}:${parts["minute"]}` };
}

/** 支付替身：把这一单记成「Stripe 通知付款成功、自动确认」之后的样子（端到端测试里没有 Stripe；只在本次运行的临时 schema 里写）。 */
async function markPaid(orderNo: string): Promise<void> {
  const url = process.env["E2E_DATABASE_OWNER_URL"];
  if (!url) throw new Error("global-setup 没有准备好数据库连接");
  const client = createPool(url, { max: 1 });
  try {
    const order = await client.query<{ tenant_id: string; id: string }>(
      "update orders set status = 'confirmed', confirmed_at = now(), dispatch_due_at = least(service_at, now() + interval '2 hours'), version = version + 1, updated_at = now() where order_no = $1 and status = 'pending_payment' returning tenant_id, id",
      [orderNo],
    );
    const row = order.rows[0];
    if (row === undefined) throw new Error(`没有找到待支付的订单 ${orderNo}`);
    await client.query("insert into order_events (tenant_id, order_id, from_status, to_status, actor, reason, occurred_at) values ($1, $2, 'pending_payment', 'confirmed', 'payment', 'PAYMENT_SUCCEEDED', now())", [row.tenant_id, row.id]);
    await client.query("update order_payments set status = 'succeeded', intent_id = 'pi_e2e_' || replace($1::text, '-', ''), succeeded_at = now(), updated_at = now() where order_id = $1 and kind = 'order'", [row.id]);
  } finally {
    await client.end();
  }
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

/** 订单页第一个区块的标题。 */
async function firstSection(page: Page): Promise<string> {
  return ((await page.locator("main h2").first().textContent()) ?? "").trim();
}

/** 320px 宽时顶栏：品牌和主题切换在第一行两端，入口在第二行（F10）。 */
async function expectHeaderRowsAt320(page: Page): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  await page.setViewportSize({ width: 320, height: 640 });
  const brand = await page.locator(".site__brand").boundingBox();
  const theme = await page.getByRole("button", { name: "切换主题" }).boundingBox();
  const nav = await page.getByRole("navigation", { name: "官网" }).boundingBox();
  if (brand === null || theme === null || nav === null) throw new Error("顶栏没有显示出来");
  expect(Math.abs(brand.y + brand.height / 2 - (theme.y + theme.height / 2)), "品牌和主题切换在同一行").toBeLessThan(8);
  expect(theme.x + theme.width, "主题切换在右端").toBeGreaterThan(320 - 40);
  expect(nav.y, "入口在第二行").toBeGreaterThanOrEqual(Math.max(brand.y + brand.height, theme.y + theme.height) - 1);
  await page.setViewportSize(viewport);
}

async function expectAccessibleBothThemes(page: Page, what: string): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${what}（${scheme === "light" ? "亮色" : "暗色"}）`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

test("官网：预订页带参数的链接报价 → 选车 → 乘客信息 → 核对、去付款（付款暂未开放，订单待支付）→ 订单页 → 付款后点「我已落地」；在查订单页，用邮件里那种链接打开订单", async ({ page, request, browser }) => {
  test.setTimeout(120_000);
  const world = await createWorld(request);
  const airport = await createAirport(request, world);
  const supplier = await createSupplier(request, world);
  await publishTransfer(request, supplier, { ...world, airport });
  const when = serviceTimeInTokyo();
  const email = `guest-${crypto.randomUUID().slice(0, 8)}@e2e.example.com`;
  await page.setViewportSize({ width: 400, height: 800 });

  // 预订页（M8-05 起 /book 就是四步新流程）：带参数的链接打开即报价——出发地是本用例的机场（坐标加名称，认出接机），目的地坐标加名称
  await page.goto(`/book?${airportLink(airport)}&to=${CENTER.lat + 0.01},${CENTER.lng + 0.01}&to_name=${encodeURIComponent("新宿站南口")}&date=${when.date}&time=${when.time}`);
  await expect(page.getByRole("heading", { level: 1, name: "预订用车" })).toBeVisible();
  await expect(page.getByText(/GeoNames/)).toBeVisible();
  await expect(page.getByText(/OurAirports/)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "官网" }).getByRole("link", { name: "预订用车" })).toHaveAttribute("aria-current", "page");
  await expectHeaderRowsAt320(page);
  // 旧页面的城市、机场下拉框和「查询价格」都没有了
  await expect(page.getByLabel(/^城市/)).toHaveCount(0);
  await expect(page.getByLabel(/^机场/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "查询价格" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "选择车型" })).toBeVisible();
  await expect(page.locator(".book-summary-bar__text")).toContainText(`接机 · ${airport.name} → 新宿站南口`);
  const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: world.group.name }) });
  await expect(card).toContainText("22,000 JPY");
  // 车型标识 4 项（M7-03，ADR 0068）
  await expect(card).toContainText("代表车型丰田埃尔法");
  await expect(card).toContainText("同级车型丰田埃尔法 or similar");
  await expect(card).toContainText("最多乘客6 人");
  await expect(card).toContainText("最多行李5 件");
  await expect(page.getByRole("region", { name: "一口价包含" })).toContainText("航班落地后免费等待：国际线最长 90 分钟、国内线最长 60 分钟");
  await expect(page.locator("main")).not.toContainText(/结算|加价|供应商|20,000/);
  await expectNoOverflow(page, "预订页（车型和价格）");
  await expectAccessibleBothThemes(page, "预订页（车型和价格）");
  await card.getByRole("button", { name: `选择 ${world.group.name}` }).click();
  await page.locator(".step-bar").getByRole("button", { name: "下一步：填写乘客信息" }).click();

  // 乘客信息 → 核对 → 去付款（下单）
  await expect(page.getByRole("heading", { level: 2, name: "乘客信息" })).toBeFocused();
  await page.getByLabel("乘车人姓名").fill("王小明");
  await page.getByLabel("手机号（含国家码）").fill("+81 90-1234-5678");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("航班号").fill("NH 211");
  await page.getByRole("radio", { name: /^国际航班/ }).check();
  await expectNoOverflow(page, "预订页（乘客信息）");
  await expectAccessibleBothThemes(page, "预订页（乘客信息）");
  await page.getByRole("button", { name: "下一步：核对订单" }).click();
  const review = page.getByRole("region", { name: "核对订单" });
  await expect(review).toContainText("新宿站南口");
  await expect(review).toContainText("24 小时内取消收全额");
  await expect(review).not.toContainText(/≥|扣 100%/);
  await page.locator(".step-bar").getByRole("button", { name: "去付款 →" }).click();
  await expect(page.getByText("需要同意保存支付方式才能下单")).toBeVisible();
  await page.getByRole("checkbox", { name: /同意保存这次付款用的银行卡/ }).check();
  await expectNoOverflow(page, "预订页（核对）");
  await expectAccessibleBothThemes(page, "预订页（核对）");
  await page.locator(".step-bar").getByRole("button", { name: "去付款 →" }).click();

  // 订单页：待付款，付款暂未开放
  const heading = page.getByRole("heading", { level: 1, name: /^订单 NZ/ });
  await expect(heading).toBeVisible();
  const orderNo = ((await heading.textContent()) ?? "").replace("订单 ", "").trim();
  expect(page.url()).toMatch(/\/book\/order#nzo_/);
  await expect(page.getByText("待付款", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "复制链接" })).toBeVisible();
  expect(await firstSection(page), "待付款时付款排第一").toBe("付款");
  // 登记了客服电话：最后一个区块是「需要帮助」，电话可以直接拨
  expect(((await page.locator("main h2").last().textContent()) ?? "").trim()).toBe("需要帮助");
  await expect(page.getByRole("link", { name: `打电话给客服 ${E2E_SUPPORT_PHONE}` })).toHaveAttribute("href", `tel:${E2E_SUPPORT_PHONE.replace(/[^+\d]/g, "")}`);
  await expect(page.getByText(`联系时请提供订单号 ${orderNo}。`)).toBeVisible();
  await expect(page.getByText(/付款暂未开放：订单已为您保留到当地时间/)).toBeVisible();
  await expect(page.getByText("已下单，等待付款")).toBeVisible();
  await expect(page.getByText(/付款后，航班落地时可以在这里点「我已落地」/)).toBeVisible();
  await expect(page.getByRole("button", { name: "我已落地" })).toHaveCount(0);
  await expectNoOverflow(page, "订单页（待付款）");
  await expectAccessibleBothThemes(page, "订单页（待付款）");

  // 支付替身：付款成功、自动确认 → 刷新订单页，点「我已落地」
  await markPaid(orderNo);
  await page.reload();
  await expect(page.getByText("已确认", { exact: true })).toBeVisible();
  await expect(page.getByText("付款成功，订单已确认")).toBeVisible();
  expect(await firstSection(page), "「我已落地」能点时航班落地排第一").toBe("航班落地");
  await page.getByRole("button", { name: "我已落地" }).click();
  await expect(page.getByText("确认您的航班已经落地？时间按现在记录，提交后不能修改。")).toBeVisible();
  await page.getByRole("button", { name: "确认已落地" }).click();
  await expect(page.getByText(/您已确认落地：当地时间 (\d{4}年)?\d{1,2}月\d{1,2}日（周[一二三四五六日]）\d{2}:\d{2}。/)).toBeVisible();
  await expect(page.getByRole("button", { name: "我已落地" })).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  await expectNoOverflow(page, "订单页（已落地）");
  await expectAccessibleBothThemes(page, "订单页（已落地）");

  // 取消先看退多少（不真的取消）
  await page.getByRole("button", { name: "取消订单" }).click();
  // 离用车不到 24 小时：扣全额，写「不退款」而不是「退还 0 JPY」（F7）
  await expect(page.getByRole("group", { name: "确认取消订单" })).toContainText("按取消政策，现在取消不退款（取消费 22,000 JPY）。");
  await expectNoOverflow(page, "订单页（确认取消）");
  await expectAccessibleBothThemes(page, "订单页（确认取消）");
  await page.getByRole("button", { name: "不取消了" }).click();

  // 修改订单：字段级错误（F12），展开的表单在窄屏不横向滚动、两色过 axe；不提交
  await page.getByRole("button", { name: "修改订单" }).click();
  await page.getByLabel("手机号（含国家码）").fill("090-1234-5678");
  await page.getByRole("button", { name: "提交修改" }).click();
  await expect(page.getByText("有几项没有填好，请看标红的地方。")).toBeVisible();
  await expect(page.getByLabel("手机号（含国家码）")).toHaveAttribute("aria-invalid", "true");
  await expectNoOverflow(page, "订单页（改单表单出错）");
  await expectAccessibleBothThemes(page, "订单页（改单表单出错）");
  await page.getByRole("button", { name: "不改了" }).click();

  // 换一个浏览器上下文：没有链接。查订单只把链接发到下单邮箱（ADR 0061，收信到打开见 site-lookup-email.spec.ts）；这里看页面，再用邮件里那种链接打开
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await other.setViewportSize({ width: 360, height: 740 });
  await other.goto("/book/order");
  await expect(other.getByRole("heading", { level: 1, name: "查订单" })).toBeVisible();
  await other.getByLabel("订单号").fill(orderNo.toLowerCase());
  await other.getByLabel("下单时的邮箱").fill(email.toUpperCase());
  await expect(other.getByRole("heading", { level: 2, name: "收不到邮件？" })).toBeVisible();
  await expectNoOverflow(other, "查订单");
  await expectAccessibleBothThemes(other, "查订单");
  await other.goto(`/book/order#${await issueSiteLink(orderNo)}`);
  await expect(other.getByRole("heading", { level: 1, name: `订单 ${orderNo}` })).toBeVisible();
  await expect(other.getByText(/您已确认落地/)).toBeVisible();
  const trip = other.locator("section").filter({ has: other.getByRole("heading", { level: 2, name: "行程" }) });
  await expect(trip).toContainText("代表车型丰田埃尔法");
  await expect(trip).toContainText("最多乘客6 人");
  await expect(trip).toContainText("最多行李5 件");
  await otherContext.close();
});
