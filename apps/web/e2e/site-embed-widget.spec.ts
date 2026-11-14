/**
 * 嵌入组件（M9E-03，ADR 0090）端到端：两个本机宿主网站（一个在嵌入码白名单里、一个不在）各放一段代码，
 * 加载构建好的 /embed/widget-v1.js，经真实的 /embed/v1 → 真实 API → 真实 PostgreSQL。谷歌是本机的假服务器（global-setup）。
 *
 * - 白名单网站：宿主页把 div、input、button 全设成红底，组件外观不受影响；320 px 不横向滚动；axe 无问题；
 *   键盘选地点、提交 → 建草稿 → 整页跳到主站 /book/new?draft= → 自动询价，价格等于在主站手填同样条件。
 * - 不在白名单的网站：只显示「预订组件暂时无法使用」和主站链接，没有表单；配置接口被拒、浏览器读不到。
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { AxeBuilder } from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
import { E2E_WEB_PLACES_PORT } from "../playwright.config.ts";
import { airportLink, createAirport, publishTransfer } from "./book-new-support.ts";
import { createSupplier, createWorld } from "./catalog.ts";
import { OWN_SITE_SOURCE, platformAdminHeaders } from "./support.ts";

test.use(OWN_SITE_SOURCE);

/** 有假谷歌密钥的那一组（地址输入即提示要用） */
const SITE = `http://127.0.0.1:${E2E_WEB_PLACES_PORT}`;

/** 宿主页：所有 div、input、button 红底白字、30px、粗体、字距、大写、斜体（都加 !important），看组件会不会被染上（会继承的几项最容易穿进 Shadow DOM） */
function hostPage(key: string): string {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>合作网站</title>
<style>div, input, button { background: rgb(255, 0, 0) !important; color: rgb(255, 255, 255) !important; font-size: 30px !important; font-weight: 700 !important; letter-spacing: 6px !important; text-transform: uppercase !important; font-style: italic !important; } body { margin: 0; }</style></head>
<body><main><h1>合作网站</h1><div id="nozomi-booking"></div></main>
<script src="${SITE}/embed/widget-v1.js"></script>
<script>NozomiBooking.init({ key: ${JSON.stringify(key)}, root: "#nozomi-booking", lang: "zh", services: ["transfer", "charter"], redirectUrl: location.origin + "/thanks" });</script>
</body></html>`;
}

async function startHost(key: () => string): Promise<{ server: Server; origin: string }> {
  const server = createServer((request, response) => {
    if (request.url !== "/" && request.url !== "/index.html") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(hostPage(key()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

let allowedHost: { server: Server; origin: string };
let otherHost: { server: Server; origin: string };
let embedKey = "";

test.beforeAll(async () => {
  allowedHost = await startHost(() => embedKey);
  otherHost = await startHost(() => embedKey);
});
test.afterAll(async () => {
  await new Promise((resolve) => allowedHost.server.close(resolve));
  await new Promise((resolve) => otherHost.server.close(resolve));
});

const dayAfterTomorrow = (): string => new Date(Date.now() + 2 * 86_400_000 + 9 * 3_600_000).toISOString().slice(0, 10);

async function quoteTotals(page: Page, open: () => Promise<unknown>): Promise<string[]> {
  const response = page.waitForResponse((res) => res.url().endsWith("/site/v1/quotes/by-points") && res.request().method() === "POST");
  await open();
  const body = (await (await response).json()) as { quotes: { vehicle_group: { id: string }; price: { total: { amount: string; currency: string } } }[] };
  return body.quotes.map((quote) => `${quote.vehicle_group.id}:${quote.price.total.amount} ${quote.price.total.currency}`).sort();
}

test("嵌入组件：白名单网站上样式不受宿主页影响、320 px、axe、键盘走完 → 建草稿 → 跳主站自动询价，价格等于手填；不在白名单的网站只显示暂时无法使用", async ({ page, request }) => {
  test.setTimeout(180_000);
  const world = await createWorld(request);
  const airport = await createAirport(request, world);
  const supplier = await createSupplier(request, world);
  await publishTransfer(request, supplier, { ...world, airport });
  const created = await request.post("/platform/v1/embed-keys", { headers: await platformAdminHeaders(request), data: { name: "端到端宿主", allowed_origins: [allowedHost.origin], default_lang: "ja", default_services: ["transfer", "charter"] } });
  expect(created.status(), await created.text()).toBe(201);
  embedKey = ((await created.json()) as { key: string }).key;

  // ---- 不在白名单的网站 ----
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(otherHost.origin);
  await expect(page.getByText("预订组件暂时无法使用。请稍后刷新，或直接到主站预订。")).toBeVisible();
  await expect(page.getByRole("link", { name: "到主站预订" })).toHaveAttribute("href", `${SITE}/book/new`);
  await expect(page.getByRole("button", { name: "查询价格" })).toHaveCount(0);

  // ---- 白名单网站 ----
  await page.goto(allowedHost.origin);
  const fromBox = page.getByRole("combobox", { name: "出发地" });
  await expect(fromBox).toBeVisible();
  await expect(page.getByRole("tab", { name: "区间" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "包车" })).toBeVisible();
  // 宿主页的红底和 30px 字号进不来
  const styles = await page.evaluate(() => {
    const shadow = document.querySelector("#nozomi-booking")?.shadowRoot;
    const pick = (selector: string) => {
      const node = shadow?.querySelector(selector);
      if (node === null || node === undefined) return null;
      const style = getComputedStyle(node);
      return { background: style.backgroundColor, color: style.color, fontSize: style.fontSize, fontWeight: style.fontWeight, letterSpacing: style.letterSpacing, textTransform: style.textTransform, fontStyle: style.fontStyle };
    };
    return { box: pick(".nzb"), input: pick("input"), button: pick(".nzb-primary"), hint: pick(".nzb-hint"), widgetOverflow: (shadow?.querySelector(".nzb") as HTMLElement | null)?.scrollWidth ?? 0, page: document.documentElement.scrollWidth };
  });
  for (const part of [styles.box, styles.input]) {
    expect(part?.background).toBe("rgb(255, 255, 255)");
    expect(part?.fontSize).not.toBe("30px");
  }
  expect(styles.button?.background).not.toBe("rgb(255, 0, 0)");
  for (const part of [styles.box, styles.hint, styles.input]) {
    expect(part?.fontWeight, "宿主页的粗体进不来").toBe("400");
    expect(part?.letterSpacing).toBe("normal");
    expect(part?.textTransform).toBe("none");
    expect(part?.fontStyle).toBe("normal");
  }
  expect(styles.page, "320 px 不横向滚动").toBeLessThanOrEqual(320);
  expect(styles.widgetOverflow).toBeLessThanOrEqual(320);
  const axe = await new AxeBuilder({ page }).include("#nozomi-booking").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);

  // 键盘：出发地选平台的机场，目的地选谷歌候选，日期改成后天，Tab 到「查询价格」回车
  await fromBox.focus();
  // 打完整名称（带随机后缀）：只打前几个字时，并行用例建的「新预订机场XXXXX」也会排在候选里，方向键可能选到别人的（M8-29 同类）
  await page.keyboard.type(airport.name);
  await expect(page.getByRole("listbox", { name: "出发地的候选" }).getByRole("option", { name: new RegExp(airport.name) })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox", { name: "出发地的候选" }).getByRole("option").first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(fromBox).toHaveValue(airport.name);
  const toBox = page.getByRole("combobox", { name: "目的地" });
  await toBox.focus();
  await page.keyboard.type("東京駅");
  const toList = page.getByRole("listbox", { name: "目的地的候选" });
  await expect(toList.getByRole("option", { name: /東京駅/ }).first()).toBeVisible();
  // 谷歌署名在候选列表外面、同一个弹出面板里（M9E-06）
  await expect(toList.locator("xpath=..").getByText("Google Maps", { exact: true })).toBeVisible();
  await expect(toList.getByText("Google Maps", { exact: true })).toHaveCount(0);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(toBox).toHaveValue(/東京駅/);
  await page.getByLabel("日期").fill(dayAfterTomorrow());

  const draftResponse = page.waitForResponse((res) => res.url().includes("/embed/v1/booking-drafts") && res.request().method() === "POST");
  const submit = page.getByRole("button", { name: "查询价格" });
  await submit.focus();
  const viaWidget = await quoteTotals(page, async () => {
    await page.keyboard.press("Enter");
    expect((await draftResponse).status()).toBe(201);
    await page.waitForURL(new RegExp(`^${SITE.replace(/\./g, "\\.")}/book/new\\?draft=[A-Za-z0-9_-]{43}`));
  });
  await expect(page.getByRole("heading", { name: "选择车型" })).toBeVisible();
  expect(viaWidget.length).toBeGreaterThan(0);

  // 主站手填同样条件（坐标、日期时间、人数行李取自草稿本身）：每个车型的价格一样
  const draftId = new URL(page.url()).searchParams.get("draft") as string;
  const saved = (await (await request.get(`${SITE}/site/v1/booking-drafts/${draftId}`)).json()) as { draft: { service_local: string; dropoff: { lat: number; lng: number; name: string }; passengers: number; luggage: number } };
  const [date, time] = saved.draft.service_local.split("T") as [string, string];
  const manual = await quoteTotals(page, () => page.goto(`${SITE}/book/new?${airportLink(airport)}&to=${saved.draft.dropoff.lat},${saved.draft.dropoff.lng}&to_name=${encodeURIComponent(saved.draft.dropoff.name)}&date=${date}&time=${time}&pax=${saved.draft.passengers}&bags=${saved.draft.luggage}`));
  expect(viaWidget).toEqual(manual);
});
