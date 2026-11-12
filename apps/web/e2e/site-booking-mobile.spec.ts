/**
 * 端到端：手机上新预订页 `/book/new` 的地址候选（M8-37，用户反馈）。
 * 以前 < 480px 时候选是贴在屏幕底部升起的面板；手机键盘弹出时页面不变矮，面板整个在键盘后面，客人只看到「找到 N 个地点」却选不了。
 * 现在候选紧贴输入框下面，打开时把输入框滚到屏幕上半部（键盘上面），列表高度按键盘上面剩下的空间算。
 * 模拟器里没有软键盘：用 `visualViewport` 模拟键盘弹出（可见区域只剩上面 364px，和真机一样页面本身不变矮），核对「候选贴在输入框下面、
 * 输入框和候选都在键盘上面、第一项没有被别的东西盖住、用手指点得中」。旧的贴底面板在 372–664，整个在「键盘」后面，这几条都会失败（见 PR 里的探测记录）。
 * 走一遍：在地图上选点（地图打开、选中间位置、收起）→ 出发地输入机场名、点候选 → 目的地输入「東京駅」、点候选 → 日期时间 → 第 2 步。
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

/** 模拟手机键盘已经弹出：`visualViewport` 只剩上面一截（真机上页面和 `innerHeight` 不变，只有可见区域变矮）。 */
async function simulateKeyboard(page: Page): Promise<void> {
  await page.addInitScript((top) => {
    const view = Object.assign(new EventTarget(), { offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1, height: top, width: window.innerWidth });
    Object.defineProperty(window, "visualViewport", { configurable: true, get: () => view });
  }, KEYBOARD_TOP);
}

const SITE = `http://127.0.0.1:${E2E_WEB_PLACES_PORT}`;

/** 手机上输入地址 → 候选紧贴输入框、在屏幕上半部、没被盖住 → 用手指点选。 */
async function pickByTouch(page: Page, label: string, query: string, option: RegExp): Promise<Locator> {
  const input = page.getByRole("combobox", { name: label });
  await input.tap();
  // 手指点一下不一定全选（地图选点后里面已有地址），先清空再像在手机上一样一个字一个字打
  await input.clear();
  await input.pressSequentially(query);
  const list = page.getByRole("listbox", { name: `${label}的候选` });
  const first = list.getByRole("option", { name: option }).first();
  await expect(first).toBeVisible();
  await expect(page.getByText(/^找到 \d+ 个地点/)).toBeVisible();
  const field = await input.boundingBox();
  const panel = await list.boundingBox();
  if (field === null || panel === null) throw new Error(`${label}：量不到输入框或候选列表`);
  const fieldBottom = field.y + field.height;
  // 紧贴输入框下面（旧的贴底面板在输入框上面、和输入框重叠）
  expect(panel.y, `${label}：候选应在输入框下面`).toBeGreaterThanOrEqual(fieldBottom - 1);
  expect(panel.y - fieldBottom, `${label}：候选应紧贴输入框`).toBeLessThan(16);
  // 输入框滚到了键盘上面，候选整个在键盘上面（高度按键盘上面剩下的空间算）
  expect(fieldBottom, `${label}：输入框应在键盘上面`).toBeLessThan(KEYBOARD_TOP);
  expect(panel.y + panel.height, `${label}：候选应整个在键盘上面`).toBeLessThanOrEqual(KEYBOARD_TOP);
  // 第一项正中这一点上没有别的东西（摘要条、地图、底部按钮）盖着
  const uncovered = await first.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return hit !== null && element.contains(hit);
  });
  expect(uncovered, `${label}：第一条候选被盖住了`).toBe(true);
  await first.tap();
  await expect(list).toBeHidden();
  return input;
}

test("M8-37 手机：出发地、目的地输入地址后候选紧贴输入框、在屏幕上半部、点得中；在地图上选点能用；进入第 2 步", async ({ page, request }) => {
  test.setTimeout(150_000);
  const world = await createWorld(request);
  const airport = await createAirport(request, world);
  const supplier = await createSupplier(request, world);
  await publishTransfer(request, supplier, { ...world, airport });
  await simulateKeyboard(page);

  await page.goto(`${SITE}/book/new`);
  await expect(page.getByRole("heading", { level: 1, name: "预订接送车" })).toBeVisible();

  // 在地图上选点：手机上地图打开、在屏幕宽度以内，选地图中间的位置后出发地有了值，再收起
  const fromMap = page.getByRole("group", { name: "出发地的地图" });
  await fromMap.getByRole("button", { name: "在地图上选点" }).tap();
  const canvas = fromMap.getByRole("application");
  await expect(canvas).toBeVisible();
  const mapBox = await canvas.boundingBox();
  if (mapBox === null) throw new Error("量不到地图");
  expect(mapBox.x).toBeGreaterThanOrEqual(0);
  expect(mapBox.x + mapBox.width).toBeLessThanOrEqual(PHONE.width);
  await fromMap.getByRole("button", { name: "选地图中间这个位置" }).tap();
  await expect(page.getByRole("combobox", { name: "出发地" })).not.toHaveValue("");
  await fromMap.getByRole("button", { name: "收起地图" }).tap();
  await expect(canvas).toHaveCount(0);

  // 出发地：平台的机场（覆盖掉地图选的点）；目的地：谷歌候选（选中后后端取坐标）
  const from = await pickByTouch(page, "出发地", airport.name, new RegExp(airport.name));
  await expect(from).toHaveValue(airport.name);
  const to = await pickByTouch(page, "目的地", "東京駅", /東京駅/);
  await expect(to).toHaveValue(/^東京駅/);

  await page.getByLabel("日期（当地）").fill(tomorrowInTokyo());
  await page.getByLabel("航班落地时间（当地）").fill("10:00");
  await expect(page.getByText(/^已识别为接机/)).toBeVisible();
  await page.getByRole("button", { name: "下一步：选择车型" }).tap();
  await expect(page.getByRole("heading", { name: "选择车型" })).toBeFocused();
  await expect(page).toHaveURL(/[?&]step=2/);
  await expect(page.locator(".book-summary-bar__text")).toContainText(`接机 · ${airport.name} → 東京駅`);
});
