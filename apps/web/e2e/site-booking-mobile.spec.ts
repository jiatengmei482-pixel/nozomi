/**
 * 端到端：手机上的新预订页 `/book/new`（M8-37，用户反馈：手机上地址候选被输入框、键盘盖住选不了）。
 * 业主 2026-11-12 的方案：移动设备优先保证操作流程——手机触屏上地址、日期、时间都是「点一下 → 全屏选择页 → 选好回到页面」。
 * 全屏选择页是原生 <dialog>（在页面最上层），这里核对：
 * - 选择页占满屏幕、在最上层（候选正中这一点上就是候选本身，没有别的东西盖住）；
 * - 用 `visualViewport` 模拟手机键盘已经弹出（可见区域只剩上面 364px，真机上页面不变矮）：输入框和第一条候选都在键盘上面；
 * - 用手指点选后选择页关闭、页面上显示选中的值；「取消」不改原来的值；
 * - 在地图上选点（选择页里打开地图、选中间位置）后回到页面；
 * - 日期、时间的选择页「确定」后回到页面；
 * - 走到第 2 步。电脑和鼠标操作的窄窗口不受影响（site-booking-new.spec.ts 照旧在页面上选）。
 * 用地址搜索专用的那组 API 和前端（假谷歌，见 site-booking-new.spec.ts），不调用真实的谷歌。
 */
import { type Locator, type Page, expect, test } from "@playwright/test";
import { E2E_WEB_PLACES_PORT } from "../playwright.config.ts";
import { createAirport, publishTransfer, tomorrowInTokyo } from "./book-new-support.ts";
import { createSupplier, createWorld } from "./catalog.ts";
import { OWN_SITE_SOURCE } from "./support.ts";

test.use(OWN_SITE_SOURCE);
// iPhone 13 的可见区域（390 × 664，去掉浏览器地址栏和工具栏），手指操作
const PHONE = { width: 390, height: 664 };
test.use({ viewport: PHONE, hasTouch: true, isMobile: true });
/** 键盘弹出后的可见高度：iPhone 键盘约占 300px，键盘上沿在 364 */
const KEYBOARD_TOP = 364;

const SITE = `http://127.0.0.1:${E2E_WEB_PLACES_PORT}`;

/** 模拟手机键盘已经弹出：`visualViewport` 只剩上面一截（真机上页面和 `innerHeight` 不变，只有可见区域变矮）。 */
async function simulateKeyboard(page: Page): Promise<void> {
  await page.addInitScript((top) => {
    const view = Object.assign(new EventTarget(), { offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1, height: top, width: window.innerWidth });
    Object.defineProperty(window, "visualViewport", { configurable: true, get: () => view });
  }, KEYBOARD_TOP);
}

/** 打开某一格的全屏选择页，确认它占满屏幕。 */
async function openSheet(page: Page, label: string): Promise<Locator> {
  await page.getByRole("button", { name: new RegExp(`^${label}`) }).tap();
  const sheet = page.getByRole("dialog", { name: label });
  await expect(sheet).toBeVisible();
  const box = await sheet.boundingBox();
  if (box === null) throw new Error(`${label}：量不到选择页`);
  expect([Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)], `${label}：选择页应占满屏幕`).toEqual([0, 0, PHONE.width, PHONE.height]);
  return sheet;
}

/** 地址：打开选择页 → 一个字一个字输入 → 候选在键盘上面、没被盖住 → 用手指点选 → 回到页面。 */
async function pickByTouch(page: Page, label: string, query: string, option: RegExp): Promise<void> {
  const sheet = await openSheet(page, label);
  const input = sheet.getByRole("combobox", { name: label });
  await expect(input).toBeFocused();
  await input.clear();
  await input.pressSequentially(query);
  const first = sheet.getByRole("listbox", { name: `${label}的候选` }).getByRole("option", { name: option }).first();
  await expect(first).toBeVisible();
  const field = await input.boundingBox();
  const item = await first.boundingBox();
  if (field === null || item === null) throw new Error(`${label}：量不到输入框或候选`);
  expect(field.y + field.height, `${label}：输入框应在键盘上面`).toBeLessThan(KEYBOARD_TOP);
  expect(item.y + item.height, `${label}：第一条候选应在键盘上面`).toBeLessThan(KEYBOARD_TOP);
  const uncovered = await first.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return hit !== null && element.contains(hit);
  });
  expect(uncovered, `${label}：第一条候选被盖住了`).toBe(true);
  await first.tap();
  await expect(sheet).toBeHidden();
}

/** 日期、时间：打开选择页 → 填 → 「确定」→ 回到页面，页面上显示选的值。 */
async function pickValue(page: Page, label: string, value: string): Promise<void> {
  const sheet = await openSheet(page, label);
  await sheet.getByLabel(label).fill(value);
  await sheet.getByRole("button", { name: "确定" }).tap();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("button", { name: new RegExp(`^${label}`) })).toContainText(value);
}

test("M8-37 手机：地址、日期、时间都是全屏选择页（占满屏幕、在最上层、候选在键盘上面、点得中），选好回到页面；取消不改；在地图上选点能用；进入第 2 步", async ({ page, request }) => {
  test.setTimeout(150_000);
  const world = await createWorld(request);
  const airport = await createAirport(request, world);
  const supplier = await createSupplier(request, world);
  await publishTransfer(request, supplier, { ...world, airport });
  await simulateKeyboard(page);

  await page.goto(`${SITE}/book/new`);
  await expect(page.getByRole("heading", { level: 1, name: "预订接送车" })).toBeVisible();
  expect(await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches)).toBe(true);
  // 页面上没有直接打字的地址框，只有点了打开选择页的那一格
  await expect(page.getByRole("combobox", { name: "出发地" })).toHaveCount(0);

  // 在地图上选点：选择页里打开地图、选中间位置 → 回到页面，出发地有了值
  const mapSheet = await openSheet(page, "出发地");
  await mapSheet.getByRole("button", { name: "在地图上选点" }).tap();
  await expect(mapSheet.getByRole("application")).toBeVisible();
  await mapSheet.getByRole("button", { name: "选地图中间这个位置" }).tap();
  await expect(mapSheet).toBeHidden();
  const fromCell = page.getByRole("button", { name: /^出发地/ });
  await expect(fromCell).not.toContainText("点按输入地址");
  const picked = (await fromCell.textContent()) ?? "";

  // 取消：选择页里打了字也不改原来的值
  const cancelSheet = await openSheet(page, "出发地");
  await cancelSheet.getByRole("combobox", { name: "出发地" }).fill("随便打的字");
  await cancelSheet.getByRole("button", { name: "取消" }).tap();
  await expect(cancelSheet).toBeHidden();
  await expect(fromCell).toHaveText(picked);

  // 出发地：平台的机场（覆盖地图选的点）；目的地：谷歌候选（选中后后端取坐标）
  await pickByTouch(page, "出发地", airport.name, new RegExp(airport.name));
  await expect(fromCell).toContainText(airport.name);
  await pickByTouch(page, "目的地", "東京駅", /東京駅/);
  await expect(page.getByRole("button", { name: /^目的地/ })).toContainText("東京駅");

  await pickValue(page, "日期（当地）", tomorrowInTokyo());
  await pickValue(page, "航班落地时间（当地）", "10:00");
  await expect(page.getByText(/^已识别为接机/)).toBeVisible();
  await page.getByRole("button", { name: "下一步：选择车型" }).tap();
  await expect(page.getByRole("heading", { name: "选择车型" })).toBeFocused();
  await expect(page).toHaveURL(/[?&]step=2/);
  await expect(page.locator(".book-summary-bar__text")).toContainText(`接机 · ${airport.name} → 東京駅`);
});
