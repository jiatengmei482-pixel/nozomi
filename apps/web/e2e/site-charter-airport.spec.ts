/**
 * 端到端：包车机场套餐的快捷入口（M9P-22，ADR 0098 第三节第 6、7 小节，第六节第 10 条）——主站 /book/new。
 * 真实浏览器 → 构建好的前端 → 真实 API → 真实 PostgreSQL。准备见 charter-airport-support.ts（迁移过三层区域的包车商品绑了一个机场，机场在①里）。
 * 嵌入页（iframe）的那一半在 site-embed-booking.spec.ts 的「M9P-22 跨站」（chromium + webkit-embed）。
 *
 * - 手机 390（M9E-32 底部按钮条）：「机场接机开始」→ 上车点改成「选择航站楼」下拉，列出绑定的机场和区域里的航站楼；有「从预约时间开始计时」的提示；
 *   第 1 步的「下一步：选择车型」在底部按钮条里，没有旧的 .book-actions / .book-bar；询价带航站楼坐标，引擎按几何匹配到机场开始，
 *   明细套餐行写「{简称}接机 + 8 小时包车」；第 3 步备注框提示「如需司机知道航班号，请填在这里」，没有航班号字段、没有免费等待；
 * - 电脑 1280：「改填其他地点」退回普通地址输入；「机场送机结束」→ 下车点按航站楼选，明细写「8 小时包车 + {简称}送机」。
 * 亮色 axe。
 */
import { expect, test } from "@playwright/test";
import { E2E_WEB_STRIPE_PORT } from "../playwright.config.ts";
import { tomorrowInTokyo } from "./book-new-support.ts";
import { expectAccessible } from "./catalog.ts";
import { charterAirportWorld } from "./charter-airport-support.ts";
import { linkPoint } from "./charter-support.ts";
import { OWN_SITE_SOURCE } from "./support.ts";

test.use(OWN_SITE_SOURCE);

const SITE = `http://127.0.0.1:${E2E_WEB_STRIPE_PORT}`;

test("M9P-22 主站手机 390：「机场接机开始」按航站楼选，底部条里点「下一步：选择车型」，询价匹配到机场开始、明细写场景名；第 3 步备注提示航班号，没有航班号字段", async ({ page, request }) => {
  test.setTimeout(180_000);
  const trip = await charterAirportWorld(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${SITE}/book/new?mode=charter&${linkPoint("to", trip.nearby, "市内下车点")}&date=${tomorrowInTokyo()}&time=10:00`);
  await expect(page.getByRole("heading", { name: "你的行程" })).toBeVisible();

  await page.getByRole("button", { name: "机场接机开始" }).click();
  await expect(page.getByRole("button", { name: "机场接机开始" })).toHaveAttribute("aria-pressed", "true");
  const terminal = page.getByLabel("上车地点（选择航站楼）");
  await expect(terminal.locator("option", { hasText: trip.terminalLabel })).toHaveCount(1);
  // 选好航站楼、行程填齐后页面自己就去询价（停顿一下），所以在选之前就开始等这次询价
  const quoted = page.waitForResponse((res) => new URL(res.url()).pathname === "/site/v1/quotes" && res.request().method() === "POST");
  await terminal.selectOption({ label: trip.terminalLabel });
  await expect(page.getByText("包车从预约的上车时间开始计时，没有免费等待，航班晚到也照常计时。建议把上车时间定在航班落地后 60–90 分钟（留出入境、取行李的时间）；担心航班延误请下单前联系客服")).toBeVisible();
  await expect(page.getByLabel(/^包车时长/)).toHaveValue("8");

  // M9E-32：第 1 步的主按钮在底部按钮条里；旧的按钮区不在了；快捷入口在行程区、不在条里
  const bar = page.getByRole("group", { name: "本步操作" });
  await expect(page.locator(".book-actions, .book-bar")).toHaveCount(0);
  await expect(bar.getByRole("button", { name: "机场接机开始" })).toHaveCount(0);
  await expectAccessible(page, "包车快捷入口（手机）");
  await bar.getByRole("button", { name: "下一步：选择车型" }).click();
  const response = await quoted;
  expect(response.status()).toBe(200);
  const body = JSON.parse(response.request().postData() ?? "{}") as { pickup: { lat: number; lng: number } };
  expect(body.pickup).toEqual(trip.terminal);
  const result = (await response.json()) as { quotes: { price_breakdown?: { kind: string; scenario?: { kind: string; airport_name: string } }[] }[] };
  expect(result.quotes[0]?.price_breakdown?.find((item) => item.kind === "base")?.scenario, "引擎按几何匹配到机场开始").toMatchObject({ kind: "airport_start", airport_name: trip.shortName });
  await expect(page.getByText(`${trip.shortName}接机 + 8 小时包车`).first()).toBeVisible();

  await page.getByRole("button", { name: `选择 ${trip.groupName}` }).click();
  await bar.getByRole("button", { name: "下一步：填写乘客信息" }).click();
  await expect(page.getByRole("heading", { name: "乘客信息", level: 2 })).toBeVisible();
  await expect(page.locator("#book-notes-hint")).toHaveText("如需司机知道航班号，请填在这里");
  await expect(page.getByLabel("给司机的备注（选填）")).toHaveAttribute("aria-describedby", /book-notes-hint/);
  // 包车不加航班号字段、不给免费等待（ADR 0098 第三节第 6 小节）
  await expect(page.getByLabel(/航班号/)).toHaveCount(0);
  await expect(page.getByText(/免费等待/)).toHaveCount(0);
});

test("M9P-22 主站电脑 1280：「改填其他地点」退回普通地址输入；「机场送机结束」按航站楼选下车点，明细写「8 小时包车 + 简称送机」", async ({ page, request }) => {
  test.setTimeout(180_000);
  const trip = await charterAirportWorld(request);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${SITE}/book/new?mode=charter&${linkPoint("from", trip.pickup, "上车酒店")}&date=${tomorrowInTokyo()}&time=10:00`);
  await expect(page.getByRole("heading", { name: "你的行程" })).toBeVisible();

  await page.getByRole("button", { name: "机场接机开始" }).click();
  await expect(page.getByLabel("上车地点（选择航站楼）")).toBeVisible();
  await page.getByRole("button", { name: "改填其他地点" }).click();
  await expect(page.getByLabel("上车地点（选择航站楼）")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "机场接机开始" })).toHaveAttribute("aria-pressed", "false");

  await page.getByRole("button", { name: "机场送机结束" }).click();
  const terminal = page.getByLabel("下车地点（选择航站楼）");
  await expect(terminal.locator("option", { hasText: trip.terminalLabel })).toHaveCount(1);
  // 选好航站楼、行程填齐后页面自己就去询价（停顿一下），所以在选之前就开始等这次询价
  const quoted = page.waitForResponse((res) => new URL(res.url()).pathname === "/site/v1/quotes" && res.request().method() === "POST");
  await terminal.selectOption({ label: trip.terminalLabel });
  // 机场送机结束不出「从预约时间开始计时」的提示
  await expect(page.getByText(/包车从预约的上车时间开始计时/)).toHaveCount(0);
  await page.getByRole("button", { name: "下一步：选择车型" }).click();
  const body = JSON.parse((await quoted).request().postData() ?? "{}") as { dropoff: { lat: number; lng: number } };
  expect(body.dropoff).toEqual(trip.terminal);
  await expect(page.getByText(`8 小时包车 + ${trip.shortName}送机`).first()).toBeVisible();
});
