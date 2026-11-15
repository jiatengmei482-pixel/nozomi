/**
 * 端到端：包车行程超限提醒（M9P-10，规格步骤 5「T > 12 小时或 D > 360 公里：在行程时间表下提醒客人缩减行程、减少经停，仍可下单」）。
 * 真实浏览器 → 前端 → 真实 API（`/site/v1`）→ 真实 PostgreSQL，不改应答。城市、区域、包车商品见 charter-support.ts（8 小时 70,000、含 150 公里，商品没改提醒线 = 默认 12 小时 / 360 公里）。
 * 这个 API 没配谷歌路线，两段路线预先写进路线缓存（每段 200 公里、18 分钟），用例结束删掉。
 *
 * 流程：电脑 1280 打开带上下车地点的包车链接 → 加一个经停点 → 第 2 步「行程时间表」下方提醒「全程约 400 公里……」并写出距离最长的一段 →
 * 照样能选车型、填乘客信息（只提醒，不拦）。亮暗两色 axe 0。
 */
import { type Page, expect, test } from "@playwright/test";
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
async function seedLeg(from: LatLng, to: LatLng, meters: number): Promise<void> {
  const key = routeCacheKey(from, to);
  seeded.push(key.key);
  await asPlatform((query) => query("insert into route_estimates (cache_key, distance_meters, duration_seconds, fetched_at, expires_at) values ($1, $2, 1080, now(), now() + interval '7 days') on conflict (cache_key) do update set failure_code = null, distance_meters = $2, duration_seconds = 1080, expires_at = excluded.expires_at", [key.key, meters]));
}

async function expectBothThemes(page: Page, what: string): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${what}（${scheme === "light" ? "亮色" : "暗色"}）`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

test("全程 400 公里（超过 360）：行程时间表下方提醒、写出距离最长的一段；照样能选车型往下走", async ({ page, request }) => {
  test.setTimeout(120_000);
  const trip = await charterWorld(request);
  const admin = await platformAdminHeaders(request);
  const stopName = `景点${randomLetters(4)}`;
  const stopAt = { lat: Number((trip.center.lat + 0.02).toFixed(6)), lng: Number((trip.center.lng - 0.01).toFixed(6)) };
  const made = await request.post("/platform/v1/master/places", { headers: admin, data: { type: "station", code: `STN-JP-${randomLetters(6)}`, city_id: trip.cityId, category: "rail", name: { zh: stopName }, location: stopAt } });
  expect(made.status(), await made.text()).toBe(201);
  await seedLeg(trip.pickup, stopAt, 210_000);
  await seedLeg(stopAt, trip.nearby, 190_000);
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `192.0.2.${1 + Math.floor(Math.random() * 250)}` });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${SITE}/book/new?mode=charter&${linkPoint("from", trip.pickup, "上车酒店")}&${linkPoint("to", trip.nearby, "市内下车点")}&date=${tomorrowInTokyo()}&time=10:00`);
  // 只有一档套餐、条件齐全：页面直接询价到第 2 步，先回第 1 步加经停点
  await expect(page.getByRole("heading", { name: "选择车型" })).toBeVisible();
  await page.getByRole("button", { name: "上一步" }).click();
  await page.getByRole("button", { name: "添加经停点" }).click();
  const box = page.getByRole("combobox", { name: "经停点 1", exact: true });
  await box.fill(stopName);
  await page.getByRole("listbox", { name: "经停点 1的候选" }).getByRole("option", { name: new RegExp(stopName) }).click();
  await expect(box).toHaveValue(stopName);
  await page.getByLabel("经停点 1 停留时长").selectOption("60");
  await page.getByRole("button", { name: "下一步：选择车型" }).click();

  const schedule = page.getByRole("region", { name: "行程时间表" }).or(page.locator("section.book-itinerary"));
  const warning = schedule.getByRole("status").filter({ hasText: "全程约" });
  await expect(warning).toContainText("您的行程全程约 400 公里，超出单日包车的建议距离，将产生较多超公里费。建议适当缩减行程或减少经停点，让旅途更轻松舒适。");
  await expect(warning).toContainText(`距离最长的一段：上车酒店 → ${stopName}，约 210 公里。`);
  await expect(warning).not.toContainText("预计用时");
  await expectBothThemes(page, "新预订页包车第 2 步（距离超限提醒）");

  // 只提醒：照样能选车型、往下走
  await page.getByRole("button", { name: `选择 ${trip.groupName}` }).click();
  await page.getByRole("button", { name: "下一步：填写乘客信息" }).click();
  await expect(page.getByRole("heading", { name: "乘客信息", level: 2 })).toBeVisible();
});
