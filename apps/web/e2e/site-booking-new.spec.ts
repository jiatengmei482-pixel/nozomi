/**
 * 端到端：新预订页 `/book/new`（M8-03，ADR 0069 A3、修正版 v2）。真实浏览器 → 前端 → 真实 API（`/site/v1`）→ 真实 PostgreSQL，不 mock 接口；
 * 谷歌是 global-setup 起的本机假服务器（假 Autocomplete 对任何关键字都给「東京駅」，假 Place Details 给它的坐标），**从不调用真实的谷歌**。
 * 用地址搜索专用的那组 API 和前端（配置里有假密钥，见 playwright.config.ts 的 E2E_API_PLACES_PORT）。
 *
 * 平台经接口新建一个本用例专用的机场（坐标随机落在城市中心附近，不和别的用例的机场重叠，按两个坐标报价才认得出是它），
 * 供应商上架这个机场的接送机商品（一口价 20,000 日元，接机免费等待 60 分钟）。客人走四步（M8-27，ADR 0079）：
 * - 手机宽：第 1 步出发地输入机场名 → 平台的机场在候选最前 → 选中；目的地输入「東京駅」→ 谷歌候选 → 选中（取坐标）→ 日期时间 →
 *   自动报价、认出接机（时间标签、免费等待 60 分钟的提示）→ 第 2 步车型卡、座位示意图、一口价包含、底部固定条 →
 *   第 3 步乘客信息（航班号、举牌姓名）→ 第 4 步核对；顶部摘要条逐步累积；
 * - 电脑宽：两栏，右侧栏路线图在最上面、下面是确认过的内容；浏览器后退回到上一步、内容还在；
 * - 带参数的链接（from 机场编码、to 坐标加名称、日期、时间、人数、行李）打开就报价、到第 2 步。
 * 每一步 320 / 360 / 400 宽不横向滚动，亮暗两色 axe；浏览器只连本站。
 */
import { expect, test } from "@playwright/test";
import { E2E_TILE_PORT, E2E_WEB_PLACES_PORT, E2E_WEB_STRIPE_PORT } from "../playwright.config.ts";
import { TOKYO_STATION, airportLink, createAirport, encodePolyline, expectNarrowAndAccessible, expectRouteLineVisible, publishTransfer, tomorrowInTokyo } from "./book-new-support.ts";
import { createSupplier, createWorld, expectAccessible } from "./catalog.ts";
import { TEST_CARDS, routeStripe } from "./fake-stripe.ts";
import { OWN_SITE_SOURCE } from "./support.ts";

// 官网按来源地址限速：每条用例带自己的文档专用地址，不和并行的官网用例在 127.0.0.1 上抢同一份额度（M8-17）
test.use(OWN_SITE_SOURCE);

const SITE = `http://127.0.0.1:${E2E_WEB_PLACES_PORT}`;
const STRIPE_SITE = `http://127.0.0.1:${E2E_WEB_STRIPE_PORT}`;
const TILE_ORIGIN = `http://127.0.0.1:${E2E_TILE_PORT}`;

test("新预订页四步：输入即提示选机场和酒店 → 自动报价、认出接机 → 选车型 → 乘客信息 → 核对；摘要条 / 右侧栏逐步累积；后退回上一步；带参数的链接到第 2 步；窄屏、亮暗 axe；浏览器只连本站", async ({ page, request }) => {
  test.setTimeout(180_000);
  const world = await createWorld(request);
  const airport = await createAirport(request, world);
  const supplier = await createSupplier(request, world);
  await publishTransfer(request, supplier, { ...world, airport });
  const origins = new Set<string>();
  page.on("request", (sent) => origins.add(new URL(sent.url()).origin));
  // 假谷歌路线不给折线（只有时间距离）；为了检查路线图真的画出了线，只把真实应答的 route 换成一条从机场到东京站的折线（价格等其余内容原样）
  await page.route(`${SITE}/site/v1/quotes/by-points`, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    route.fulfill({ response, json: { ...body, route: { minutes: 25, meters: 14_200, polyline: encodePolyline([airport.location, { lat: (airport.location.lat + TOKYO_STATION.lat) / 2 + 0.01, lng: (airport.location.lng + TOKYO_STATION.lng) / 2 }, TOKYO_STATION]) } } });
  });
  // 路线小地图（M8-10）：这里固定成「平台还没开通谷歌静态地图」，核对的是后备的现有底图；静态图的各种结果见 site-booking-route-map.spec.ts
  await page.route(`${SITE}/site/v1/route-map?**`, (route) => route.fulfill({ status: 503, json: { error: { code: "ROUTE_MAP_UNAVAILABLE", message: "路线图暂不可用", details: { reason: "NOT_ENABLED" } } } }));
  await page.setViewportSize({ width: 400, height: 800 });

  await page.goto(`${SITE}/book/new`);
  await expect(page.getByRole("heading", { level: 1, name: "预订接送车" })).toBeVisible();
  await expect(page.getByRole("list", { name: "预订步骤" }).getByRole("listitem")).toHaveCount(4);
  await expect(page.getByRole("heading", { name: "选择车型" })).toHaveCount(0);

  // 出发地：平台的机场排在谷歌候选前面
  const from = page.getByRole("combobox", { name: "出发地" });
  await from.fill(airport.name);
  const fromList = page.getByRole("listbox", { name: "出发地的候选" });
  await expect(fromList.getByRole("option").first()).toContainText(airport.name);
  await expect(fromList.getByRole("option").first()).toContainText("机场");
  await expect(fromList.getByRole("option", { name: /東京駅/ })).toBeVisible();
  // 有谷歌候选：候选列表下面、同一个面板里署名「Google Maps」一次（M9E-06），不在 listbox 里；亮暗两色、窄屏的 axe 在下面一起核对
  const fromPanel = fromList.locator("xpath=..");
  await expect(fromPanel.getByText("Google Maps", { exact: true })).toBeVisible();
  await expect(fromPanel.getByText("Google Maps", { exact: true })).toHaveCount(1);
  await expect(fromList.getByText("Google Maps", { exact: true })).toHaveCount(0);
  await expect(fromPanel.locator(".google-attribution")).toHaveAttribute("translate", "no");
  await expectNarrowAndAccessible(page, "新预订页（候选展开）");
  await from.press("Enter");
  await expect(from).toHaveValue(airport.name);

  // 目的地：谷歌候选，键盘选中（选中后后端取坐标）
  const to = page.getByRole("combobox", { name: "目的地" });
  await to.fill("東京駅");
  await expect(page.getByRole("listbox", { name: "目的地的候选" }).getByRole("option", { name: /東京駅/ })).toBeVisible();
  await to.press("ArrowDown");
  await to.press("Enter");
  await expect(to).toHaveValue(/^東京駅/);

  await page.getByLabel("日期（当地）").fill(tomorrowInTokyo());
  await page.getByLabel("航班落地时间（当地）").fill("10:00");
  // 填齐就自动报价：认出接机，时间标签、提示（免费等待取报价的 60 分钟）
  await expect(page.getByText("已识别为接机：司机按航班落地时间等候，落地后免费等待 60 分钟")).toBeVisible();
  // 标签条按所有可订城市的品类出现（测试库里别的用例的城市也算）；标签和标签不符的提示见组件测试 book-new.test.tsx
  const travellers = page.getByRole("button", { name: "乘客 / 行李 2 人 · 2 件" });
  await travellers.click();
  await page.getByRole("button", { name: "增加乘客" }).click();
  await expect(page.getByRole("button", { name: "乘客 / 行李 3 人 · 2 件" })).toHaveAttribute("aria-expanded", "true");
  await expectNarrowAndAccessible(page, "新预订页第 1 步（认出接机、乘客行李展开）");

  await page.getByRole("button", { name: "下一步：选择车型" }).click();
  await expect(page.getByRole("heading", { name: "选择车型" })).toBeFocused();
  await expect(page).toHaveURL(/[?&]step=2/);
  await expect(page.locator(".book-summary-bar__text")).toContainText(`接机 · ${airport.name} → 東京駅`);
  const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: world.group.name }) });
  await expect(card).toContainText("22,000 JPY");
  await expect(card).toContainText("5 件（行李按 28 寸行李箱计）");
  await card.getByRole("button", { name: `选择 ${world.group.name}` }).click();
  const seats = card.getByRole("img", { name: `${world.group.name}的车内示意图：乘客座位 6 个，行李 5 件（行李按 28 寸行李箱计）` });
  await expect(seats).toBeVisible();
  await expect(card.locator("figcaption")).toContainText("乘客座位 6 个 · 行李 5 件（行李按 28 寸行李箱计） · 人数少时空座位也可以放行李");
  await expect(card.locator("figcaption")).toContainText("示意图");
  const includes = page.getByRole("region", { name: "一口价包含" });
  await expect(includes.getByRole("listitem")).toHaveText(["一口价已含所有费用（高速费、停车费等），无需另付", "专车专用，不拼车", "航班落地后免费等待 60 分钟"]);
  await expect(page.locator("main")).not.toContainText("跟踪航班");
  const bar = page.locator(".book-bar");
  await expect(bar).toContainText(`${world.group.name} · 一口价 22,000 JPY`);
  await expectNarrowAndAccessible(page, "新预订页第 2 步（座位示意图展开、底部固定条）");
  await bar.getByRole("button", { name: "下一步" }).click();

  // 第 3 步：乘客信息（接机的航班号必填、举牌姓名选填）
  await expect(page.getByRole("heading", { level: 2, name: "乘客信息" })).toBeFocused();
  await page.getByLabel("航班号").fill("NH211");
  await page.getByLabel("举牌姓名（选填）").fill("WANG XIAOMING");
  await page.getByLabel("乘车人姓名").fill("王小明");
  await page.getByLabel("邮箱").fill(`book-new-${crypto.randomUUID().slice(0, 8)}@e2e.example.com`);
  await page.getByLabel("手机号（含国家区号）").fill("+81 90-1234-5678");
  await expectNarrowAndAccessible(page, "新预订页第 3 步（乘客信息）");
  await page.getByRole("button", { name: "下一步：核对订单" }).click();

  // 第 4 步：核对（各块有「修改」）、取消规则、同意保存银行卡、去付款；摘要条展开是累积的内容
  await expect(page.getByRole("heading", { name: "核对订单" })).toBeFocused();
  const review = page.getByRole("region", { name: "核对订单" });
  await expect(review.getByRole("button", { name: "修改行程" })).toBeVisible();
  await expect(review).toContainText("WANG XIAOMING");
  await expect(review).toContainText("22,000");
  await expect(review).toContainText("取消规则");
  await expect(page.getByRole("button", { name: "去付款 →" })).toBeVisible();
  await page.getByRole("button", { name: /^行程摘要/ }).click();
  const panel = page.locator("#book-summary-panel");
  await expect(panel).toContainText("3 人 · 2 件");
  await expect(panel).toContainText(world.group.name);
  await expect(panel).toContainText("NH211");
  await expectNarrowAndAccessible(page, "新预订页第 4 步（核对、摘要条展开）");

  // 电脑宽：两栏，右侧栏最上面是路线图，下面是三步确认过的内容
  await page.setViewportSize({ width: 1280, height: 900 });
  const aside = page.getByRole("complementary", { name: "行程摘要" });
  await expect(aside).toBeVisible();
  await expectRouteLineVisible(page, airport.location);
  await expect(aside).toContainText(world.group.name);
  await expect(aside).toContainText("22,000");
  await expect(aside).toContainText("NH211");
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `新预订页电脑第 4 步（${scheme === "light" ? "亮色" : "暗色"}）`);
  }
  await page.emulateMedia({ colorScheme: "light" });
  // 浏览器后退：回到第 3 步，填过的还在
  await page.goBack();
  await expect(page.getByRole("heading", { level: 2, name: "乘客信息" })).toBeVisible();
  await expect(page.getByLabel("举牌姓名（选填）")).toHaveValue("WANG XIAOMING");

  // 带参数的链接：出发地写机场编码（按编码取一次平台地点，不调谷歌），目的地是坐标加名称，打开就报价、到第 2 步
  await page.setViewportSize({ width: 400, height: 800 });
  await page.goto(`${SITE}/book/new?from=${airport.code}&to=${TOKYO_STATION.lat},${TOKYO_STATION.lng}&to_name=${encodeURIComponent("東京駅八重洲口")}&date=${tomorrowInTokyo()}&time=11:30&pax=3&bags=1`);
  await expect(page.getByRole("heading", { name: "选择车型" })).toBeVisible();
  await expect(page.locator(".book-summary-bar__text")).toContainText(`接机 · ${airport.name} → 東京駅八重洲口`);
  await page.getByRole("button", { name: /^行程摘要/ }).click();
  await expect(page.locator("#book-summary-panel")).toContainText("3 人 · 1 件");
  await expect(page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: world.group.name }) })).toContainText("22,000 JPY");

  // 浏览器只连本站和底图（不连谷歌）
  expect([...origins].filter((origin) => origin !== SITE && origin !== TILE_ORIGIN)).toEqual([]);
});

test("新预订页付款：选车 → 加附加服务（重新报价、右侧栏合计）→ 乘客信息校验 → 核对（车费、差额、合计、参考价）→ 同意保存银行卡 → 去付款 → 现有订单页用 Stripe 付款（假 Stripe，测试卡 4242）；窄屏、亮暗 axe", async ({ page, request }) => {
  test.setTimeout(150_000);
  const world = await createWorld(request);
  const airport = await createAirport(request, world);
  const supplier = await createSupplier(request, world);
  await publishTransfer(request, supplier, { ...world, airport }, world.seat);
  const fakeStripe = process.env["E2E_FAKE_STRIPE_URL"];
  if (!fakeStripe) throw new Error("global-setup 没有启动假 Stripe");
  await routeStripe(page, fakeStripe);
  const link = `${STRIPE_SITE}/book/new?${airportLink(airport)}&to=${TOKYO_STATION.lat},${TOKYO_STATION.lng}&to_name=${encodeURIComponent("東京駅八重洲口")}&date=${tomorrowInTokyo()}&time=11:30&pax=2&bags=2`;

  // 电脑：链接打开到第 2 步 → 选车 → 加附加服务，右侧栏的合计跟着变
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(link);
  const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: world.group.name }) });
  await card.getByRole("button", { name: `选择 ${world.group.name}` }).click();
  await expect(page.getByRole("region", { name: "请客服人工报价" })).toHaveCount(0);
  const aside = page.getByRole("complementary", { name: "行程摘要" });
  await page.getByRole("region", { name: "附加服务（选填）" }).getByRole("button", { name: `增加${world.seat.name}` }).click();
  await expect(aside).toContainText("23,100");
  await page.getByRole("button", { name: "下一步：填写乘客信息" }).click();

  // 第 3 步：空着点「下一步」标红（航班号也在这一步）
  await page.getByRole("button", { name: "下一步：核对订单" }).click();
  await expect(page.getByText("有几项没有填好，请看标红的地方。")).toBeVisible();
  await expect(page.getByLabel("航班号")).toHaveAttribute("aria-invalid", "true");
  // 为他人预订：预订人收确认邮件，另填乘车人；举牌姓名默认跟乘车人
  await page.getByText("为他人预订", { exact: true }).click();
  await page.getByLabel("航班号").fill("NH 211");
  await page.getByLabel("预订人姓名").fill("王小明");
  await page.getByLabel("邮箱").fill(`book-new-${crypto.randomUUID().slice(0, 8)}@e2e.example.com`);
  await page.getByLabel("手机号（含国家区号）").fill("+81 90-1234-5678");
  await page.getByLabel("乘车人姓名").fill("李华");
  await page.getByLabel("乘车人电话/WhatsApp").fill("+81 90-5555-6666");
  await expect(page.getByLabel("举牌姓名（选填）")).toHaveValue("李华");
  await page.getByLabel("给司机的备注（选填）").fill("两个大箱子");
  await expectNarrowAndAccessible(page, "新预订页第 3 步（为他人预订）");
  await page.getByRole("button", { name: "下一步：核对订单" }).click();
  await expect(page.getByRole("region", { name: "核对订单" })).toContainText("+81 90-5555-6666");

  // 第 4 步：车费、附加服务差额、合计、参考价、支付方式
  const review = page.getByRole("region", { name: "核对订单" });
  await expect(review).toContainText("附加服务（合计差额）");
  await expect(review).toContainText("+1,100 JPY");
  await expect(review).toContainText("23,100");
  await expect(review).toContainText("22,000 JPY");
  await expect(review).toContainText("银行卡");
  await expect(review.getByText(/^≈ /)).toBeVisible();
  await expect(review).toContainText("按当前汇率换算，仅供参考，实际以支付金额为准");
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `新预订页第 4 步（附加服务、参考价，${scheme === "light" ? "亮色" : "暗色"}）`);
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 360, height: 740 });
  await expectNarrowAndAccessible(page, "新预订页手机第 4 步");

  await page.getByRole("button", { name: "去付款 →" }).click();
  await expect(page.getByText("需要同意保存支付方式才能下单")).toBeVisible();
  await page.getByRole("checkbox", { name: /同意保存这次付款用的银行卡/ }).check();
  const placed = page.waitForRequest((sent) => new URL(sent.url()).pathname === "/site/v1/orders" && sent.method() === "POST");
  await page.getByRole("button", { name: "去付款 →" }).click();
  // M8-32（ADR 0082）：举牌姓名、乘车人姓名和电话是正式字段，不再写进备注
  const sent = (await placed).postDataJSON() as { notes: string; sign_name: string | null; passenger_name: string | null; passenger_phone: string | null };
  expect([sent.notes, sent.sign_name, sent.passenger_name, sent.passenger_phone]).toEqual(["两个大箱子", "李华", "李华", "+81 90-5555-6666"]);
  await expect(page.getByRole("heading", { level: 1, name: /^订单 NZ/ })).toBeVisible();
  await expect(page.getByLabel("卡号（假 Stripe）")).toBeVisible();
  await expect(page.locator("main")).toContainText("23,100 JPY");
  await page.getByLabel("卡号（假 Stripe）").fill(TEST_CARDS.success);
  await page.getByRole("button", { name: "付款 23,100 JPY" }).click();
  await page.getByRole("button", { name: "确认支付" }).click();
  await expect(page.getByRole("region", { name: "付款", exact: true }).getByRole("status")).toContainText("付款成功，等待确认。");
  await expect(page.getByText("付款成功，订单已确认。派车后这里会显示司机和车辆。")).toBeVisible({ timeout: 20_000 });
});
