/**
 * 端到端：有经停点的包车也能手动升到更长的套餐（M9P-03，规格步骤 3「客人可以手动改成更长的套餐，不能改成短于 T 的」，ADR 0093 第四节第 7、9 条）。
 * 真实浏览器 → 前端 → 真实 API（`/site/v1`）→ 真实 PostgreSQL，不改应答。城市、区域、包车商品见 charter-support.ts，另上架 4 小时（40,000，含 80 公里）、
 * 10 小时（90,000，含 200 公里）两档：商品共 4 / 8 / 10 小时。这个 API 没配谷歌路线，两段路线预先写进路线缓存（每段 6.8 公里、18 分钟，同 km-display.spec.ts），用例结束删掉。
 *
 * 流程：电脑 1280 打开带上下车地点的包车链接 → 第 1 步加一个经停点、停留 5 小时（预计用时 5 小时 36 分）→ 服务器自动选 8 小时（不是 4 小时）→
 * 「包车时长」下拉默认「自动（8 小时）」、只有 10 小时可升（没有 4 小时）→ 选 10 小时重新报价（请求带 itinerary_pricing + package_hours: 10）、
 * 车型卡 99,000 JPY → 选回「自动」又是 8 小时。亮暗两色 axe 0。
 */
import { type Page, type Route, expect, test } from "@playwright/test";
import { type LatLng, routeCacheKey } from "@nozomi/domain";
import { withPlatformTx } from "../../api/src/db/context.ts";
import { createPool } from "../../api/src/db/pool.ts";
import { E2E_WEB_STRIPE_PORT } from "../playwright.config.ts";
import { tomorrowInTokyo } from "./book-new-support.ts";
import { expectAccessible } from "./catalog.ts";
import { charterWorld, linkPoint } from "./charter-support.ts";
import { platformAdminHeaders, randomLetters } from "./support.ts";

const SITE = `http://127.0.0.1:${E2E_WEB_STRIPE_PORT}`;

async function asPlatform<T>(run: (query: (text: string, values: unknown[]) => Promise<unknown>) => Promise<T>): Promise<T> {
  const url = process.env["E2E_DATABASE_URL"];
  if (!url) throw new Error("global-setup 没有交出本次运行的数据库连接串");
  const pool = createPool(url, { max: 1 });
  try {
    return await withPlatformTx(pool, (tx) => run((text, values) => tx.query(text, values)));
  } finally {
    await pool.end();
  }
}

/** 本用例写进路线缓存的键（结束时删掉） */
const seeded: string[] = [];
test.afterAll(async () => {
  if (seeded.length > 0) await asPlatform((query) => query("delete from route_estimates where cache_key = any($1::text[])", [seeded]));
});
async function seedLeg(from: LatLng, to: LatLng): Promise<void> {
  const key = routeCacheKey(from, to);
  seeded.push(key.key);
  await asPlatform((query) => query("insert into route_estimates (cache_key, distance_meters, duration_seconds, fetched_at, expires_at) values ($1, 6800, 1080, now(), now() + interval '7 days') on conflict (cache_key) do update set failure_code = null, distance_meters = 6800, duration_seconds = 1080, expires_at = excluded.expires_at", [key.key]));
}

async function expectBothThemes(page: Page, what: string): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${what}（${scheme === "light" ? "亮色" : "暗色"}）`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

test("有经停点：服务器按预计用时自动选 8 小时；下拉只列比它长的 10 小时（没有 4 小时），升到 10 小时重新报价，选回自动又是 8 小时", async ({ page, request }) => {
  test.setTimeout(120_000);
  const trip = await charterWorld(request, { packages: [{ hours: 4, price: 40_000, km: 80 }, { hours: 10, price: 90_000, km: 200 }] });
  const admin = await platformAdminHeaders(request);
  const stopName = `景点${randomLetters(4)}`;
  const stopAt = { lat: Number((trip.center.lat + 0.02).toFixed(6)), lng: Number((trip.center.lng - 0.01).toFixed(6)) };
  const made = await request.post("/platform/v1/master/places", { headers: admin, data: { type: "station", code: `STN-JP-${randomLetters(6)}`, city_id: trip.cityId, category: "rail", name: { zh: stopName }, location: stopAt } });
  expect(made.status(), await made.text()).toBe(201);
  await seedLeg(trip.pickup, stopAt);
  await seedLeg(stopAt, trip.nearby);
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `192.0.2.${1 + Math.floor(Math.random() * 250)}` });

  const bodies: Record<string, unknown>[] = [];
  await page.route(`${SITE}/site/v1/quotes`, async (route: Route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.continue();
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${SITE}/book/new?mode=charter&${linkPoint("from", trip.pickup, "上车酒店")}&${linkPoint("to", trip.nearby, "市内下车点")}&date=${tomorrowInTokyo()}&time=10:00`);
  const add = page.getByRole("button", { name: "添加经停点" });
  await expect(add).toBeVisible();
  await add.click();
  const box = page.getByRole("combobox", { name: "经停点 1", exact: true });
  await box.fill(stopName);
  await page.getByRole("listbox", { name: "经停点 1的候选" }).getByRole("option", { name: new RegExp(stopName) }).click();
  await expect(box).toHaveValue(stopName);
  const stay = page.getByLabel("经停点 1 停留时长");
  await stay.selectOption("300");
  await expect(stay).toHaveValue("300");

  // 自动选档：预计 5 小时 36 分，4 小时不够，8 小时（70,000）比 10 小时（90,000）便宜
  const hours = page.getByLabel(/^包车时长/);
  await expect(hours).toBeVisible();
  await expect(hours).toHaveValue("");
  await expect(hours.locator("option")).toHaveText(["自动（8 小时）", "10 小时"]);
  await expect(hours.locator("option", { hasText: "4 小时" })).toHaveCount(0);
  const auto = bodies.at(-1) ?? {};
  expect(auto).toMatchObject({ category: "charter", itinerary_pricing: true });
  expect(Object.keys(auto)).not.toContain("package_hours");
  await expectBothThemes(page, "新预订页包车第 1 步（有经停点、可升档）");

  await hours.selectOption("10");
  await expect.poll(() => bodies.at(-1)?.["package_hours"]).toBe(10);
  expect(bodies.at(-1)).toMatchObject({ itinerary_pricing: true, waypoints: [{ name: stopName, ...stopAt, stay_minutes: 300 }], package_hours: 10 });
  await page.getByRole("button", { name: "下一步：选择车型" }).click();
  const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: trip.groupName }) });
  await expect(card).toContainText("99,000 JPY");
  await expect(card).toContainText("10 小时");

  // 选回自动：不带 package_hours，又是 8 小时（77,000）
  await page.getByRole("button", { name: "上一步" }).click();
  await page.getByLabel(/^包车时长/).selectOption("");
  await expect.poll(() => "package_hours" in (bodies.at(-1) ?? {})).toBe(false);
  await page.getByRole("button", { name: "下一步：选择车型" }).click();
  await expect(card).toContainText("77,000 JPY");
});
