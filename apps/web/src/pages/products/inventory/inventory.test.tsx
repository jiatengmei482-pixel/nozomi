/**
 * 第 ④ 步「库存」和导入页的组件测试：模式、日历的八种显示、改一天、批量设置、导出、导入的三段和各种被拒、只读角色。
 * 接口用测试替身；真实后端（含真的 .xlsx）由端到端测试 e2e/inventory.spec.ts 覆盖。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { addDays, inventoryBatchDates, weekdayOf } from "@nozomi/domain";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../../App.tsx";
import type { Inventory, InventoryDayBody, InventoryImportPreview, PriceImportPreview } from "../../../api/inventory.ts";
import type { Product, PublishCheckItemBody, PublishCheckResult } from "../../../api/products.ts";
import { type ApiCall, apiError, assertAbsent, assertFocused, json, resetBrowser, signIn, stubApiWith } from "../../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T03:04:00.000Z" };
const PRODUCT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BASE = `/tenant/v1/products/${PRODUCT_ID}`;
const TODAY = "2026-10-08";
const SHA = "a".repeat(64);

const productOf = (overrides: Partial<Product> = {}): Product =>
  ({
    id: PRODUCT_ID,
    code: "PRD202610081430050001",
    status: "draft",
    category: "airport_transfer",
    title: { zh: "羽田机场接送" },
    brand_id: "b1",
    brand: { id: "b1", name: "NOZOMI", currency: "JPY", status: "active" },
    city_id: "c1",
    city: { id: "c1", code: "CTY-JP-TYO", name: { zh: "东京" }, country_code: "JP", timezone: "Asia/Tokyo", status: "active" },
    poi_id: "p1",
    poi: { id: "p1", type: "airport", code: "HND", name: { zh: "羽田机场" }, status: "active" },
    area_count: 1,
    vehicle_group_count: 1,
    version: 7,
    ...stamps,
    areas: [{ area_id: "a1", priority: 0, name: { zh: "东京 23 区" }, biz_type: "general", status: "active" }],
    vehicle_groups: [{ vehicle_group_id: "g1", passengers: 6, luggage: 4, code: "VG-BIZ-7", name: { zh: "商务七座" }, grade: "business", seats: 7, sample_models: [], combos: [{ passengers: 6, luggage: 4 }], status: "active" }],
    dispatchers: [{ name: "山田", phone: "+81 90 1234 5678" }],
    ...overrides,
  }) as unknown as Product;
const item = (key: string, issues: { path: string; reason: string }[] = [], required = true): PublishCheckItemBody => ({ key, required, passed: issues.length === 0, issues: issues.map((issue) => ({ ...issue, message: "说明" })) });
const checkOf = (inventory: { path: string; reason: string }[] = []): PublishCheckResult => ({ can_publish: true, items: [item("basic_info"), item("service_rules"), item("price_rules"), item("content"), item("adjust_rules", [], false), item("inventory", inventory, false)] });
const NO_STOCK = [{ path: "/", reason: "NO_INVENTORY_AHEAD" }];

const dayOf = (date: string, mode: "unlimited" | "limited", changes: Partial<InventoryDayBody> = {}): InventoryDayBody => {
  const total = changes.total === undefined ? null : changes.total;
  const held = changes.held ?? 0;
  const sold = changes.sold ?? 0;
  const status = mode === "unlimited" ? "unlimited" : total === null ? "unset" : total === 0 ? "closed" : total - held - sold > 0 ? "open" : "sold_out";
  return { date, weekday: weekdayOf(date), total, held, sold, remaining: mode === "unlimited" ? null : total === null ? 0 : Math.max(0, total - held - sold), status };
};
/** 一段日期的库存：`set` 里的日子按给的写，其余没设。 */
function inventoryOf(query: URLSearchParams, mode: "unlimited" | "limited", set: Record<string, Partial<InventoryDayBody>> = {}, version = 7): Inventory {
  const days: InventoryDayBody[] = [];
  for (let date = query.get("from") ?? ""; date <= (query.get("to") ?? ""); date = addDays(date, 1)) days.push(dayOf(date, mode, set[date] ?? {}));
  const ahead = Object.entries(set).filter(([date, day]) => date >= TODAY && (day.total ?? 0) - (day.held ?? 0) - (day.sold ?? 0) > 0);
  return { version, mode, today: TODAY, ahead: { sellable_days: mode === "limited" ? ahead.length : 0, last_set_date: Object.keys(set).sort().at(-1) ?? null }, days };
}

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;
interface State {
  product?: Product;
  check?: PublishCheckResult;
  inventory?: (query: URLSearchParams) => Inventory;
}
function open(path: string, role: string, state: State = {}, extra: Route = () => null): ApiCall[] {
  signIn("tenant", "tenant-token");
  const calls = stubApiWith((call) => {
    const custom = extra(call);
    if (custom !== null) return custom;
    if (call.method !== "GET") return null;
    const at = call.url.pathname;
    if (at === "/tenant/v1/auth/me") return json(200, { user: { id: "u1", email: "user@supplier.example", name: "测试用户", role, status: "active", ...stamps }, tenant: { id: "t1", name: "测试用供应商", status: "active", ...stamps }, permissions: [], must_change_password: false });
    if (at === BASE) return json(200, state.product ?? productOf());
    if (at === `${BASE}/publish-check`) return json(200, state.check ?? checkOf());
    if (at === `${BASE}/inventory`) return json(200, (state.inventory ?? ((query) => inventoryOf(query, "unlimited")))(call.url.searchParams));
    return null;
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}
const writes = (calls: ApiCall[]): ApiCall[] => calls.filter((call) => call.method !== "GET");
const user = () => userEvent.setup();
const stepText = (name: string): string => [...document.querySelectorAll(".step-nav__item")].find((node) => node.textContent?.includes(name))?.textContent ?? "";
const pageText = (): string => document.body.textContent ?? "";
const dayCell = (date: string): HTMLElement => document.getElementById(`inventory-day-${date}`) as HTMLElement;
const dayLabel = (date: string): string => dayCell(date)?.getAttribute("aria-label") ?? "";
const panel = (): HTMLElement => document.querySelector(".calendar-layout > .stock-day") as HTMLElement;
const MONTH = "/inventory?month=2026-10";
/** 页面上不能出现内部的写法。 */
const assertNoInternalWords = (): void => assert.doesNotMatch(pageText(), /unlimited|\bunset\b|sold_out|\bheld\b|preview|sha256|[A-Z]{4,}_[A-Z_]{3,}|对外价|加价比例/);

// ───────────── 框架和模式 ─────────────

test("第 ④ 步：不限量时什么都不用设；步骤导航写「已完成 · 不限量」；加载失败能重试；这一步没有保存，只有下一步", async () => {
  let fail = true;
  open(`/products/${PRODUCT_ID}${MONTH}`, "admin", {}, (call) => (call.method === "GET" && call.url.pathname === `${BASE}/inventory` && call.url.searchParams.get("from") === "2026-10-01" && fail ? apiError(500, "INTERNAL", "boom") : null));
  await screen.findByRole("heading", { level: 2, name: "④ 库存" });
  await screen.findByText("加载失败");
  assert.match(pageText(), /库存按东京当地的用车日期算。一天一个数，不分时段，也不分车型组。/);
  fail = false;
  await user().click(screen.getByRole("button", { name: "重试" }));
  await waitFor(() => assert.match(dayLabel("2026-10-08"), /^10 月 8 日周四，今天，不限量$/));
  assert.match(document.querySelector(".stock-mode")?.textContent ?? "", /现在是：不限量每天接多少单都可以，不用设库存。/);
  await waitFor(() => assert.match(stepText("库存"), /已完成 · 不限量/));
  assert.ok(screen.getByRole("button", { name: "改成限量" }));
  assertAbsent(within(document.querySelector(".step__bar") as HTMLElement).queryByRole("button"));
  assert.equal(screen.getByRole("link", { name: "下一步" }).getAttribute("href"), `/products/${PRODUCT_ID}/content`);
  assertAbsent(document.querySelector(".stock-calendar ~ * .alert--warning"));
  assertNoInternalWords();
});

test("月历的每一格：有库存、已订满、停售、没设、预先设了数、过去的日子、超出范围，都读得出来；过去的不能选", async () => {
  const set = { "2026-10-08": { total: 5, sold: 2 }, "2026-10-09": { total: 3, sold: 2, held: 1 }, "2026-10-10": { total: 0 }, "2026-10-02": { total: 4 } };
  open(`/products/${PRODUCT_ID}${MONTH}`, "admin", { inventory: (query) => inventoryOf(query, "limited", set) });
  await waitFor(() => assert.match(dayLabel("2026-10-08"), /^10 月 8 日周四，今天，还剩 3 单，共 5 单，已售 2 单$/));
  assert.match(dayCell("2026-10-08").textContent ?? "", /剩 3共 5 · 已售 2/);
  assert.match(dayLabel("2026-10-09"), /已订满，共 3 单，已售 2 单，待付款 1 单$/);
  assert.match(dayLabel("2026-10-10"), /停售$/);
  assert.match(dayLabel("2026-10-11"), /没设，卖不出去$/);
  assert.match(dayLabel("2026-10-02"), /还剩 4 单，共 4 单，已经过去，只能看$/);
  assert.equal(dayCell("2026-10-02").getAttribute("aria-disabled"), "true");
  assert.match(dayLabel("2026-10-03"), /没设，卖不出去，已经过去，只能看$/);
  assert.ok(dayCell("2026-10-11").className.includes("stock-cell--unset") && !dayCell("2026-10-11").className.includes("stock-cell--past"));
  assert.ok(dayCell("2026-10-03").className.includes("stock-cell--past"), "过去的没设不用警告底色");
  await user().click(dayCell("2026-10-02"));
  assert.equal(document.querySelector(".calendar-bar")?.textContent, "", "过去的日子不能选");
  assert.match(pageText(), /日期是东京当地的用车日期。没设 = 限量时这一天卖不出去；停售 = 你把这一天设成了 0。/);
  assert.match(pageText(), /这个月有 21 天没设库存，这些天卖不出去。/);

  resetBrowser();
  open(`/products/${PRODUCT_ID}/inventory?month=2028-10`, "admin", { inventory: (query) => inventoryOf(query, "unlimited", { "2028-10-01": { total: 5 }, "2028-10-02": { total: 0 } }) });
  await waitFor(() => assert.match(dayLabel("2028-10-01"), /不限量，已设 5，限量时生效$/));
  assert.match(dayLabel("2028-10-02"), /不限量，已设停售，限量时生效$/);
  assert.match(dayLabel("2028-10-08"), /超出可以设库存的范围$/);
  assert.equal(dayCell("2028-10-08").getAttribute("aria-disabled"), "true");
  assert.equal((screen.getByRole("button", { name: "下个月" }) as HTMLButtonElement).disabled, true, "最远只能翻到今天之后 730 天所在的月份");
  assertNoInternalWords();
});

test("限量：从今天起没有库存时到处提醒；切换模式的两个确认把后果说清楚，带版本号提交", async () => {
  const actor = user();
  let mode: "unlimited" | "limited" = "limited";
  const calls = open(`/products/${PRODUCT_ID}${MONTH}`, "admin", { check: checkOf(NO_STOCK), inventory: (query) => inventoryOf(query, mode, mode === "unlimited" ? { "2026-10-20": { total: 5 }, "2026-10-21": { total: 0 } } : {}, mode === "limited" ? 7 : 8) }, (call) => {
    if (call.method !== "PUT" || call.url.pathname !== `${BASE}/inventory`) return null;
    mode = (call.body as { mode: "unlimited" | "limited" }).mode;
    return json(200, { version: 8, mode });
  });
  await screen.findByText("从今天起没有一天有库存，这个商品现在卖不出去。");
  assert.match(pageText(), /限量时，没有设库存的日子不接单。请给要卖的日子设上库存，或改成不限量。/);
  assert.match(document.querySelector(".stock-mode")?.textContent ?? "", /现在是：限量每天最多接你设的单数。没有设库存的日子卖不出去。/);
  await waitFor(() => assert.match(stepText("库存"), /从今天起没有库存/));
  assert.ok(screen.getByText("已完成 4 / 5"), "这一步不算进已完成");

  await actor.click(screen.getByRole("button", { name: "改成不限量" }));
  const toUnlimited = screen.getByRole("dialog", { name: "改成不限量？" });
  assert.match(toUnlimited.textContent ?? "", /改成不限量后，每天不再限制接单的数量，下多少单都会接。你设好的每日库存会留着，但不起作用；以后改回限量时还在。/);
  assertFocused(within(toUnlimited).getByRole("button", { name: "取消" }));
  await actor.click(within(toUnlimited).getByRole("button", { name: "改成不限量" }));
  await screen.findByText("已改成不限量");
  const put = writes(calls)[0] as ApiCall;
  assert.deepEqual([put.headers["if-match"], put.body], ['"7"', { mode: "unlimited" }]);
  await waitFor(() => assert.match(document.querySelector(".stock-mode")?.textContent ?? "", /下面日历里设的数现在不起作用，改成限量后才生效。/));
  assertAbsent(screen.queryByText("从今天起没有一天有库存，这个商品现在卖不出去。"));

  // 改成限量：先数今后一年设了几天
  await actor.click(screen.getByRole("button", { name: "改成限量" }));
  const toLimited = screen.getByRole("dialog", { name: "改成限量？" });
  await within(toLimited).findByText("今后一年里，你已经给 2 天设了库存（其中 1 天有库存可卖），最晚设到 2026-10-21。其余的日子卖不出去。");
  assert.match(toLimited.textContent ?? "", /改成限量后，每天最多接你设的单数；没有设库存的日子卖不出去。/);
  const year = calls.find((call) => call.path.includes("from=2026-10-08&to=2027-10-08")) as ApiCall | undefined;
  assert.ok(year, "一次请求取今天起 366 天");
  assertAbsent(within(toLimited).queryByRole("button", { name: "先去设库存" }));
  await actor.click(within(toLimited).getByRole("button", { name: "改成限量" }));
  await screen.findByText("已改成限量");
  assert.deepEqual([writes(calls)[1]?.headers["if-match"], writes(calls)[1]?.body], ['"8"', { mode: "limited" }]);
  assertNoInternalWords();
});

// ───────────── 改某一天 ─────────────

test("改某一天：预先选中现在的情况；填 0 换到停售；写错不提交；没变不提交；保存是起止同一天的批量设置", async () => {
  const actor = user();
  const set: Record<string, Partial<InventoryDayBody>> = { "2026-10-12": { total: 5 } };
  const calls = open(`/products/${PRODUCT_ID}${MONTH}`, "admin", { inventory: (query) => inventoryOf(query, "limited", set) }, (call) => {
    if (call.method !== "POST" || call.url.pathname !== `${BASE}/inventory/batch-set`) return null;
    const body = call.body as { from: string; to: string; total: number | null };
    if (body.total === null) delete set[body.from];
    else set[body.from] = { total: body.total };
    return json(200, { ...inventoryOf(new URLSearchParams({ from: body.from, to: body.to }), "limited", set, 8), changed_days: 1 });
  });
  await waitFor(() => assert.match(dayLabel("2026-10-12"), /还剩 5 单/));
  // 没有点过：面板显示今天（没设 → 第一项，输入框空着）
  assert.match(panel().textContent ?? "", /2026-10-08 周四没设，卖不出去/);
  await actor.click(dayCell("2026-10-12"));
  await waitFor(() => assert.match(panel().textContent ?? "", /2026-10-12 周一还剩 5 单共 5 单 · 已售 0 单 · 待付款 0 单/));
  const total = within(panel()).getByLabelText("可售单数") as HTMLInputElement;
  assert.equal(total.value, "5");
  assert.equal((within(panel()).getByRole("radio", { name: /^可售/ }) as HTMLInputElement).checked, true);
  await actor.click(within(panel()).getByRole("button", { name: "保存" }));
  assert.equal(writes(calls).length, 0, "没有变化不发请求");
  await actor.clear(total);
  await actor.type(total, "1.5");
  await actor.click(within(panel()).getByRole("button", { name: "保存" }));
  await within(panel()).findByText("请填 1 到 9,999 之间的整数。要停售请选「停售」");
  assert.equal(writes(calls).length, 0);
  await actor.clear(within(panel()).getByLabelText("可售单数"));
  await actor.type(within(panel()).getByLabelText("可售单数"), "0");
  assert.equal((within(panel()).getByRole("radio", { name: /^停售/ }) as HTMLInputElement).checked, true, "填 0 自动换到停售");
  await actor.click(within(panel()).getByRole("button", { name: "保存" }));
  await screen.findByText("已保存 10-12 的库存");
  const post = writes(calls)[0] as ApiCall;
  assert.deepEqual([post.headers["if-match"], post.body], ['"7"', { from: "2026-10-12", to: "2026-10-12", weekdays: [], total: 0 }]);
  await waitFor(() => assert.match(dayLabel("2026-10-12"), /停售/));
  await actor.click(within(panel()).getByRole("radio", { name: /^清除/ }));
  assert.match(panel().textContent ?? "", /改回「没设」。这一天同样卖不出去，日历上会一直标着提醒你。/);
  await actor.click(within(panel()).getByRole("button", { name: "保存" }));
  await waitFor(() => assert.deepEqual(writes(calls)[1]?.body, { from: "2026-10-12", to: "2026-10-12", weekdays: [], total: null }));
  assert.equal(writes(calls)[1]?.headers["if-match"], '"8"', "用上一次应答里的新版本号");
  assertNoInternalWords();
});

test("有订单占着的那一天：不能停售、不能清除、不能改到已占用的单数以下；别人先改了重新取库存；只读角色只能看", async () => {
  const actor = user();
  let answer: Response = apiError(409, "VERSION_CONFLICT", "stale");
  const calls = open(`/products/${PRODUCT_ID}${MONTH}`, "admin", { inventory: (query) => inventoryOf(query, "limited", { "2026-10-12": { total: 5, sold: 2, held: 1 } }) }, (call) => (call.method === "POST" ? answer : null));
  await waitFor(() => assert.match(dayLabel("2026-10-12"), /还剩 2 单/));
  await actor.click(dayCell("2026-10-12"));
  await waitFor(() => assert.match(panel().textContent ?? "", /共 5 单 · 已售 2 单 · 待付款 1 单/));
  assert.equal((within(panel()).getByRole("radio", { name: /^停售/ }) as HTMLInputElement).disabled, true);
  assert.equal((within(panel()).getByRole("radio", { name: /^清除/ }) as HTMLInputElement).disabled, true);
  assert.match(panel().textContent ?? "", /这一天已经有 3 单，不能停售，也不能清除。最少可以改成 3（改成 3 就是不再接新单）。/);
  const total = within(panel()).getByLabelText("可售单数");
  await actor.clear(total);
  await actor.type(total, "2{Enter}");
  await within(panel()).findByText("这一天已经有 3 单（已售 2 单、待付款 1 单），可售单数不能少于 3。");
  assert.equal(writes(calls).length, 0, "页面先拦住，不发请求");
  await actor.clear(within(panel()).getByLabelText("可售单数"));
  await actor.type(within(panel()).getByLabelText("可售单数"), "4{Enter}");
  await screen.findByText("这个商品刚被别人修改过，已经载入最新的库存。请核对后再点一次。");
  assert.equal((within(panel()).getByLabelText("可售单数") as HTMLInputElement).value, "4", "填的内容留着");
  answer = apiError(409, "INVENTORY_BELOW_OCCUPIED", "occupied", { days: [{ date: "2026-10-12", occupied: 6 }] });
  await actor.click(within(panel()).getByRole("button", { name: "保存" }));
  await within(panel()).findByText("这一天已经有 6 单，可售单数不能少于 6。");
  assertNoInternalWords();

  resetBrowser();
  open(`/products/${PRODUCT_ID}${MONTH}`, "readonly", { inventory: (query) => inventoryOf(query, "limited", { "2026-10-12": { total: 5 } }) });
  await waitFor(() => assert.match(dayLabel("2026-10-12"), /还剩 5 单/));
  assertAbsent(screen.queryByRole("button", { name: /改成/ }));
  assertAbsent(screen.queryByRole("button", { name: "批量设置" }));
  await actor.click(dayCell("2026-10-12"));
  await waitFor(() => assert.match(panel().textContent ?? "", /还剩 5 单/));
  assertAbsent(within(panel()).queryByRole("button", { name: "保存" }));
  assertAbsent(screen.queryByText("点一天直接改；拖动或用键盘选一段日期批量设置"));
  await actor.click(screen.getByRole("button", { name: "导入 / 导出" }));
  assert.deepEqual(screen.getAllByRole("menuitem").map((entry) => entry.textContent), ["导出库存…"]);
});

// ───────────── 批量设置 ─────────────

test("批量设置：选一段日期带进来；读回来的话和 domain 数的一样，写出会覆盖几天；30 天以上或停售要再确认；提交带版本号", async () => {
  const actor = user();
  const calls = open(`/products/${PRODUCT_ID}${MONTH}`, "admin", { inventory: (query) => inventoryOf(query, "limited", { "2026-10-10": { total: 3 }, "2026-10-11": { total: 5 } }) }, (call) => (call.method === "POST" ? json(200, { ...inventoryOf(new URLSearchParams({ from: "2026-10-10", to: "2026-10-18" }), "limited", {}, 8), changed_days: 3 }) : null));
  await waitFor(() => assert.match(dayLabel("2026-10-10"), /还剩 3 单/));
  await actor.click(dayCell("2026-10-10"));
  await actor.keyboard("{Shift>}");
  await actor.click(dayCell("2026-10-18"));
  await actor.keyboard("{/Shift}");
  const bar = document.querySelector(".calendar-bar") as HTMLElement;
  assert.match(bar.textContent ?? "", /已选 2026-10-10 至 2026-10-18，共 9 天/);
  await actor.click(within(bar).getByRole("button", { name: "批量设置" }));
  const dialog = screen.getByRole("dialog", { name: "批量设置库存" });
  assert.deepEqual([(within(dialog).getByLabelText("日期从") as HTMLInputElement).value, (within(dialog).getByLabelText("日期到") as HTMLInputElement).value], ["2026-10-10", "2026-10-18"]);
  assert.match(dialog.textContent ?? "", /停售和清除，现在的效果一样：这些天都不接单。.*不确定就用停售。/);
  await actor.click(within(dialog).getByRole("button", { name: "保存" }));
  await within(dialog).findByText("请选择要设成什么");
  assert.equal(writes(calls).length, 0);
  await actor.click(within(dialog).getByRole("radio", { name: "只设每周的某几天" }));
  await actor.click(within(dialog).getByRole("button", { name: "保存" }));
  await within(dialog).findByText("请至少选一天");
  await actor.click(within(dialog).getByRole("button", { name: "周末" }));
  await actor.type(within(dialog).getByLabelText("可售单数"), "5");
  const dates = inventoryBatchDates({ from: "2026-10-10", to: "2026-10-18", weekdays: [6, 7] });
  await waitFor(() => assert.match(dialog.querySelector(".stock-batch__readback")?.textContent ?? "", new RegExp(`2026-10-10 至 2026-10-18 的每个周六、周日，共 ${dates.length} 天：每天可售 5 单。其中 1 天现在已经有数，会被改成 5。`)));
  await actor.click(within(dialog).getByRole("button", { name: "保存" }));
  await screen.findByText("已设置 3 天的库存");
  const post = writes(calls)[0] as ApiCall;
  assert.deepEqual([post.path, post.headers["if-match"], post.body], [`${BASE}/inventory/batch-set`, '"7"', { from: "2026-10-10", to: "2026-10-18", weekdays: [6, 7], total: 5 }]);
  assertAbsent(screen.queryByRole("dialog", { name: "批量设置库存" }));

  // 停售：再确认一次
  await actor.click(within(document.querySelector(".stock-calendar__tools") as HTMLElement).getByRole("button", { name: "批量设置" }));
  const again = screen.getByRole("dialog", { name: "批量设置库存" });
  assert.equal((within(again).getByLabelText("日期从") as HTMLInputElement).value, TODAY, "「从」预先填今天");
  await actor.type(within(again).getByLabelText("日期到"), "2026-10-09");
  await actor.click(within(again).getByRole("radio", { name: /^停售/ }));
  await actor.click(within(again).getByRole("button", { name: "保存" }));
  await within(again).findByText("要改 2 天，确定吗？");
  assert.equal(writes(calls).length, 1);
  await actor.click(within(again).getByRole("button", { name: "确定" }));
  await waitFor(() => assert.deepEqual(writes(calls)[1]?.body, { from: "2026-10-08", to: "2026-10-09", weekdays: [], total: 0 }));
  assertNoInternalWords();
});

test("批量设置被拒：有订单占着的日子逐天列出（页面先查、后端 409 同样处理），点一天去日历；400 的原因对到字段", async () => {
  const actor = user();
  let answer: Response = apiError(409, "INVENTORY_BELOW_OCCUPIED", "occupied", { days: [{ date: "2026-10-12", occupied: 3 }, { date: "2026-10-13", occupied: 1 }] });
  const calls = open(`/products/${PRODUCT_ID}${MONTH}`, "admin", { inventory: (query) => inventoryOf(query, "limited", { "2026-10-20": { total: 5, sold: 2 } }) }, (call) => (call.method === "POST" ? answer : null));
  await waitFor(() => assert.match(dayLabel("2026-10-20"), /还剩 3 单/));
  await actor.click(screen.getByRole("button", { name: "批量设置" }));
  const dialog = screen.getByRole("dialog", { name: "批量设置库存" });
  const until = within(dialog).getByLabelText("日期到");
  await actor.type(until, "2026-10-21");
  await actor.type(within(dialog).getByLabelText("可售单数"), "1");
  // 页面先查到 10-20 有 2 单占着
  await within(dialog).findByText("这样保存不了。");
  assert.match(dialog.textContent ?? "", /这 1 天已经有订单占着库存，可售单数不能少于已占用的单数：2026-10-20 周二：已占用 2 单把数量改成不少于 2，或改日期避开这几天。/);
  assert.equal((within(dialog).getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled, true);
  // 改到 10-19 为止：页面查不到了，后端说另外两天有
  await actor.clear(until);
  await actor.type(until, "2026-10-19");
  await waitFor(() => assert.equal((within(dialog).getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled, false));
  await actor.click(within(dialog).getByRole("button", { name: "保存" }));
  await within(dialog).findByText("没有保存，一天都没有改。");
  assert.match(dialog.textContent ?? "", /这 2 天已经有订单占着库存.*2026-10-12 周一：已占用 3 单2026-10-13 周二：已占用 1 单把数量改成不少于 3，或改日期避开这几天。/);
  assert.equal(writes(calls).length, 1);

  answer = apiError(400, "VALIDATION_FAILED", "bad", { issues: [{ path: "/to", reason: "TOO_FAR_AHEAD", message: "x" }] });
  await actor.clear(within(dialog).getByLabelText("可售单数"));
  await actor.type(within(dialog).getByLabelText("可售单数"), "9");
  await actor.click(within(dialog).getByRole("button", { name: "保存" }));
  await within(dialog).findByText("最远只能设到 2028-10-07（今天之后 730 天）");

  // 本地的日期校验
  await actor.clear(until);
  await actor.type(until, "2026-10-01");
  await actor.click(within(dialog).getByRole("button", { name: "保存" }));
  await within(dialog).findByText("结束日期不能早于开始日期");
  await actor.clear(until);
  await actor.type(until, "2027-12-31");
  await within(dialog).findByText("一次最多设 366 天，请分几次");
  assertNoInternalWords();
});

// ───────────── 导出 ─────────────

test("导出库存：选日期（默认今天起 90 天，最多 366 天）→ 用请求取回文件交给浏览器保存；没准备好能重试", async () => {
  const actor = user();
  const saved: string[] = [];
  const realCreate = URL.createObjectURL;
  URL.createObjectURL = () => {
    saved.push("blob");
    return "blob:test";
  };
  try {
    let fail = true;
    const calls = open(`/products/${PRODUCT_ID}${MONTH}`, "admin", {}, (call) => {
      if (call.url.pathname !== `${BASE}/inventory/export`) return null;
      return fail ? apiError(500, "INTERNAL", "boom") : new Response(new Blob(["xlsx"]), { status: 200, headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": 'attachment; filename="PRD1-inventory-2026-10-08-2027-01-05.xlsx"' } });
    });
    await waitFor(() => assert.match(dayLabel("2026-10-08"), /不限量/));
    await actor.click(screen.getByRole("button", { name: "导入 / 导出" }));
    assert.deepEqual(screen.getAllByRole("menuitem").map((entry) => entry.textContent), ["导出库存…", "导入库存…"]);
    assert.equal(screen.getByRole("menuitem", { name: "导入库存…" }).getAttribute("href"), `/products/${PRODUCT_ID}/inventory/import`);
    await actor.click(screen.getByRole("menuitem", { name: "导出库存…" }));
    const dialog = screen.getByRole("dialog", { name: "导出库存" });
    assert.deepEqual([(within(dialog).getByLabelText("导出日期从") as HTMLInputElement).value, (within(dialog).getByLabelText("导出日期到") as HTMLInputElement).value], [TODAY, "2027-01-05"]);
    assert.match(dialog.textContent ?? "", /每天一行。没设的日子那一格是空的——填上数再导入就是设置，所以它也是导入用的模版。/);
    await actor.clear(within(dialog).getByLabelText("导出日期到"));
    await actor.type(within(dialog).getByLabelText("导出日期到"), "2028-01-01");
    await actor.click(within(dialog).getByRole("button", { name: "导出" }));
    await within(dialog).findByText("一次最多导出 366 天");
    await actor.clear(within(dialog).getByLabelText("导出日期到"));
    await actor.type(within(dialog).getByLabelText("导出日期到"), "2027-01-05");
    await actor.click(within(dialog).getByRole("button", { name: "导出" }));
    await screen.findByText("文件没有准备好，请稍后再试。");
    const request = calls.find((call) => call.path.includes("/inventory/export")) as ApiCall;
    assert.match(request.path, /from=2026-10-08&to=2027-01-05/);
    assert.equal(request.headers["authorization"], "Bearer tenant-token", "令牌只走请求头");
    assert.doesNotMatch(request.path, /tenant-token/);
    fail = false;
    await actor.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByText("已开始下载「PRD1-inventory-2026-10-08-2027-01-05.xlsx」");
    assert.equal(saved.length, 1);
    assertAbsent(screen.queryByText("文件没有准备好，请稍后再试。"));
  } finally {
    URL.createObjectURL = realCreate;
  }
});

// ───────────── 导入 ─────────────

const xlsx = (name = "inventory.xlsx", content = "file"): File => new File([content], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
const inventoryPreview = (changes: Partial<InventoryImportPreview> = {}): InventoryImportPreview => ({
  version: 7,
  file_sha256: SHA,
  can_import: true,
  summary: { rows: 4, set: 2, clear: 1, unchanged: 1, error: 0, conflict: 0 },
  rows: [
    { row: 2, date: "2026-10-12", action: "set", total: 9, occupied: 0, issues: [] },
    { row: 3, date: "2026-10-13", action: "set", total: 0, occupied: 0, issues: [] },
    { row: 4, date: "2026-10-14", action: "clear", total: null, occupied: 0, issues: [] },
    { row: 5, date: "2026-10-15", action: "unchanged", total: 5, occupied: 0, issues: [] },
  ],
  ...changes,
});
const brokenPreview = inventoryPreview({
  can_import: false,
  summary: { rows: 4, set: 1, clear: 0, unchanged: 1, error: 1, conflict: 1 },
  rows: [
    { row: 2, date: "2026-10-12", action: "set", total: 9, occupied: 0, issues: [] },
    { row: 3, date: "2026-10-13", action: "error", total: null, occupied: 0, issues: [{ cell: "B3", column: "可售单数", reason: "NOT_A_NUMBER", message: "要填数字" }] },
    { row: 4, date: "2026-10-14", action: "conflict", total: 1, occupied: 3, issues: [] },
    { row: 5, date: "2026-10-15", action: "unchanged", total: 5, occupied: 0, issues: [] },
  ],
});

test("导入库存：选文件时页面先拦（类型、大小、空）；读不了的文件说明原因；检查结果有问题时只列有问题的行，指到单元格，不能确认", async () => {
  const actor = userEvent.setup({ applyAccept: false });
  let answer: Response = apiError(400, "IMPORT_FILE_INVALID", "bad", { reason: "MISSING_COLUMNS", columns: ["可售单数"] });
  const calls = open(`/products/${PRODUCT_ID}/inventory/import`, "admin", {}, (call) => (call.method === "POST" && call.url.pathname === `${BASE}/inventory/import/preview` ? answer : null));
  await screen.findByRole("heading", { level: 3, name: "导入库存" });
  assert.equal(document.querySelector(".import-steps [aria-current=step]")?.textContent, "1 选文件");
  assert.match(pageText(), /传上来以后先检查，检查不会改动任何东西；你看过结果、点了确认才会写入。/);
  assert.match(pageText(), /「可售单数」填 0 到 9,999 的整数。填 0 = 停售；留空 = 清除（限量时没设的日子卖不出去）。/);
  assert.equal(screen.getByRole("link", { name: "‹ 回到库存" }).getAttribute("href"), `/products/${PRODUCT_ID}/inventory`);
  const input = document.getElementById("import-file") as HTMLInputElement;
  assert.equal(screen.getByText("选择文件").getAttribute("for"), "import-file", "「选择文件」是文件输入框的标签");

  await actor.upload(input, new File(["a,b"], "inventory.csv", { type: "text/csv" }));
  await screen.findByText(/只能导入 \.xlsx 文件。「inventory\.csv」不是。/);
  await actor.upload(input, new File([], "empty.xlsx"));
  await screen.findByText("这个文件是空的。");
  await actor.upload(input, new File([new Uint8Array(1_100_000)], "big.xlsx"));
  await screen.findByText(/「big\.xlsx」有 1 MB，超过了 1 MB。|「big\.xlsx」有 1\.\d MB，超过了 1 MB。/);
  assert.equal(writes(calls).length, 0, "不合格的不上传");

  await actor.upload(input, xlsx());
  await screen.findByText("表头里少了这几列：可售单数。第一行的表头不能改，请对照模版补上。");
  const sent = writes(calls)[0] as ApiCall;
  assert.equal(sent.headers["content-type"], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "请求体就是文件本身");
  assert.equal(sent.headers["if-match"], undefined);

  answer = json(200, brokenPreview);
  await actor.upload(document.getElementById("import-file") as HTMLInputElement, xlsx());
  await screen.findByText("现在不能导入：有 1 行出错、1 行冲突");
  assert.equal(document.querySelector(".import-steps [aria-current=step]")?.textContent, "2 看检查结果");
  assert.match(pageText(), /只要有一行有问题，整份都不会写入。请在 Excel 里改好（下面写了是哪一格），保存后点「换一个文件」重新上传。没问题的行不用动。/);
  assert.match(document.querySelector(".import-counts")?.textContent ?? "", /共 4 行：设库存 1清除 0没变 1出错 1冲突 1/);
  assert.equal((screen.getByRole("checkbox", { name: "只看有问题的" }) as HTMLInputElement).checked, true);
  const rows = (): string[] => [...document.querySelectorAll(".import-table tbody tr")].map((row) => row.textContent ?? "");
  assert.equal(rows().length, 2);
  assert.match(rows()[0] ?? "", /第 3 行出错2026-10-13 周二B3 可售单数：要填数字/);
  assert.match(rows()[1] ?? "", /第 4 行冲突2026-10-14 周三，设成 1 单这一天已经有 3 单，不能改成 1/);
  assert.ok(screen.getByText("另有 2 行没有问题，没有列出。"));
  assert.equal(screen.getByRole("table").querySelector("caption")?.textContent, "检查结果，共 4 行");
  const confirm = screen.getByRole("button", { name: "确认导入" });
  assert.equal(confirm.getAttribute("aria-disabled"), "true");
  assert.equal(document.getElementById(confirm.getAttribute("aria-describedby") ?? "")?.textContent, "先把有问题的行改好");
  await actor.click(confirm);
  assertAbsent(screen.queryByRole("dialog", { name: "确认导入？" }));
  await actor.click(screen.getByRole("checkbox", { name: "只看有问题的" }));
  assert.equal(rows().length, 4);
  await actor.click(screen.getByRole("button", { name: /^没变/ }));
  assert.equal(screen.getByRole("button", { name: /^没变/ }).getAttribute("aria-pressed"), "true");
  assert.equal(rows().length, 1);
  await actor.click(screen.getAllByRole("button", { name: "换一个文件" })[0] as HTMLElement);
  await screen.findByText("上一次检查：inventory.xlsx，1 行出错、1 行冲突。");
  assertNoInternalWords();
});

test("导入库存：检查通过 → 确认时再传一次同一个文件，带文件指纹、版本号、幂等键 → 各种被拒各有下一步 → 成功", async () => {
  const actor = userEvent.setup({ applyAccept: false });
  let confirmAnswer: Response | "network" = apiError(409, "CONCURRENT_UPDATE", "busy");
  let previewAnswer = json(200, inventoryPreview());
  const calls = open(`/products/${PRODUCT_ID}/inventory/import`, "admin", { product: productOf({ status: "published" }) }, (call) => {
    if (call.method !== "POST") return null;
    if (call.url.pathname === `${BASE}/inventory/import/preview`) return previewAnswer.clone();
    if (call.url.pathname !== `${BASE}/inventory/import`) return null;
    if (confirmAnswer === "network") return Promise.reject(new TypeError("fetch failed"));
    return confirmAnswer;
  });
  await screen.findByRole("heading", { level: 3, name: "导入库存" });
  await actor.upload(document.getElementById("import-file") as HTMLInputElement, xlsx());
  await screen.findByText("检查通过，可以导入");
  assert.match(pageText(), /会给 2 天设库存、清除 1 天，另有 1 天和现在一样，不动。点「确认导入」才会写入。/);
  assert.match(pageText(), /点「确认导入」时，系统会把这份文件再传一次，并再检查一遍文件和商品有没有变；有变化就不会写入，会请你重新检查。写入是整份一起成功或一起不写。/);
  assertAbsent(screen.queryByRole("checkbox", { name: "只看有问题的" }));
  assert.equal(document.querySelectorAll(".import-table tbody tr").length, 4);
  const confirmNow = async (): Promise<void> => {
    await actor.click(screen.getByRole("button", { name: "确认导入" }));
    const dialog = screen.getByRole("dialog", { name: "确认导入？" });
    assert.match(dialog.textContent ?? "", /会给 2 天设库存、清除 1 天。这个商品已上架，导入后大约 1 分钟生效。写入后不能一键撤销；要改回去，只能再导入一次或在页面上改。/);
    assertFocused(within(dialog).getByRole("button", { name: "取消" }));
    await actor.click(within(dialog).getByRole("button", { name: "确认导入" }));
  };
  const confirms = (): ApiCall[] => calls.filter((call) => call.method === "POST" && call.path.includes("/inventory/import?"));

  await confirmNow();
  await screen.findByText("同时有其他人在修改，这次没有导入。请再点一次「确认导入」。");
  const first = confirms()[0] as ApiCall;
  assert.equal(first.path, `${BASE}/inventory/import?file_sha256=${SHA}`);
  assert.equal(first.headers["if-match"], '"7"');
  assert.match(first.headers["idempotency-key"] ?? "", /^[0-9a-f-]{36}$/);
  assert.equal(first.headers["content-type"], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

  confirmAnswer = "network";
  await confirmNow();
  await screen.findByText("不确定有没有导入成功。");
  assert.match(pageText(), /请检查网络后再点一次「确认导入」——重复点不会导入两次。/);
  assert.equal(confirms()[1]?.headers["idempotency-key"], first.headers["idempotency-key"], "重试不换幂等键");

  confirmAnswer = apiError(409, "VERSION_CONFLICT", "stale");
  previewAnswer = json(200, inventoryPreview({ version: 9 }));
  await confirmNow();
  await screen.findByText("检查之后，这个商品被别人修改过。请重新检查这份文件。");
  await actor.click(screen.getByRole("button", { name: "重新检查" }));
  await screen.findByText("检查通过，可以导入");

  confirmAnswer = apiError(409, "IMPORT_NOT_CLEAN", "dirty", { preview: brokenPreview });
  await confirmNow();
  await screen.findByText("再检查时发现有问题（检查之后情况有变化）。下面是最新的检查结果。");
  assert.equal(confirms().at(-1)?.headers["if-match"], '"9"', "用重新检查拿到的版本号");
  assert.equal(document.querySelectorAll(".import-table tbody tr").length, 2, "换成最新的结果，只列有问题的");
  assert.equal(screen.getByRole("button", { name: "确认导入" }).getAttribute("aria-disabled"), "true");

  // 换一个文件重新来：这次传上去的和检查的不是同一份
  await actor.click(screen.getAllByRole("button", { name: "换一个文件" })[0] as HTMLElement);
  await actor.upload(document.getElementById("import-file") as HTMLInputElement, xlsx("inventory.xlsx", "changed"));
  await screen.findByText("检查通过，可以导入");
  confirmAnswer = apiError(409, "IMPORT_FILE_CHANGED", "changed");
  await confirmNow();
  await screen.findByText("没有导入。这次传上去的文件和刚才检查的不是同一份。请重新选择文件，再检查一次。");
  assert.equal(document.querySelector(".import-steps [aria-current=step]")?.textContent, "1 选文件");

  await actor.upload(document.getElementById("import-file") as HTMLInputElement, xlsx());
  await screen.findByText("检查通过，可以导入");
  confirmAnswer = json(200, { version: 10, changed_days: 3, summary: inventoryPreview().summary });
  await confirmNow();
  await screen.findByText("已给 2 天设了库存、清除了 1 天，共变了 3 天。");
  assert.equal(document.querySelector(".import-steps [aria-current=step]")?.textContent, "3 完成");
  assert.ok(screen.getByRole("button", { name: "再导入一份" }));
  await actor.click(screen.getByRole("button", { name: "回到库存" }));
  await screen.findByRole("heading", { level: 2, name: "④ 库存" });
  assertNoInternalWords();
});

test("导入价格：每一行写出它是什么（新增的也有），冲突写和哪一行；不在第 ③ 步的页签里；只读角色打不开导入页", async () => {
  const actor = userEvent.setup({ applyAccept: false });
  const content = { area: "东京 23 区", vehicle_group: "VG-BIZ-7", direction: "both" as const, package_hours: null, pricing_model: "fixed" as const, main_price: 21000, valid_from: "2026-10-10", valid_to: null, status: "enabled" as const };
  const preview: PriceImportPreview = {
    version: 7,
    file_sha256: SHA,
    currency: "JPY",
    can_import: false,
    summary: { rows: 4, create: 1, update: 1, unchanged: 0, error: 1, conflict: 1 },
    rows: [
      { row: 2, action: "update", price_rule_id: "p1", content, issues: [], conflicts_with: [] },
      { row: 3, action: "create", price_rule_id: null, content: { ...content, direction: "pickup", main_price: 18000 }, issues: [], conflicts_with: [] },
      { row: 4, action: "error", price_rule_id: null, content: { ...content, main_price: null }, issues: [{ cell: "F4", column: "基础价", reason: "PRECISION", message: "日元金额不能有小数" }, { cell: "K4", column: "生效开始", reason: "INVALID_DATE", message: "invalid" }], conflicts_with: [] },
      { row: 5, action: "conflict", price_rule_id: null, content, issues: [], conflicts_with: [{ row: 2, price_rule_id: "p1", area: "东京 23 区", vehicle_group: "VG-BIZ-7", direction: "both", package_hours: null, valid_from: "2026-10-10", valid_to: null }, { row: null, price_rule_id: "p9", area: "东京 23 区", vehicle_group: "VG-BIZ-7", direction: "both", package_hours: null, valid_from: "2026-01-01", valid_to: "2026-12-31" }] },
    ],
  };
  open(`/products/${PRODUCT_ID}/prices/import`, "admin", {}, (call) => (call.method === "POST" && call.url.pathname === `${BASE}/price-rules/import/preview` ? json(200, preview) : null));
  await screen.findByRole("heading", { level: 3, name: "导入价格" });
  assertAbsent(screen.queryByRole("navigation", { name: "价格规则的分区" }));
  assert.ok(screen.getByRole("button", { name: "下载空白模版" }) && screen.getByRole("button", { name: "导出现有的价格" }));
  assert.match(pageText(), /「价格编号」：导出的行带着它，留着 = 修改这一条；新增的行留空。导入不会删除价格，要删请在页面上删。/);
  assert.match(pageText(), /金额是结算价，币种 JPY，只能填整数。小数位多了会报错，不会自动四舍五入。/);
  await actor.upload(document.getElementById("import-file") as HTMLInputElement, xlsx("prices.xlsx"));
  await screen.findByText("现在不能导入：有 1 行出错、1 行冲突");
  assert.match(document.querySelector(".import-counts")?.textContent ?? "", /共 4 行：新增 1修改 1没变 0出错 1冲突 1/);
  await actor.click(screen.getByRole("checkbox", { name: "只看有问题的" }));
  const rows = [...document.querySelectorAll(".import-table tbody tr")].map((row) => row.textContent ?? "");
  assert.match(rows[0] ?? "", /第 2 行修改东京 23 区 · VG-BIZ-7 · 接送通用，JPY 21,000，2026-10-10 起一直有效/);
  assert.match(rows[1] ?? "", /第 3 行新增东京 23 区 · VG-BIZ-7 · 接机，JPY 18,000，2026-10-10 起一直有效/);
  assert.match(rows[2] ?? "", /F4 基础价：日元金额不能有小数K4 生效开始：这一格的内容不对/);
  assert.match(rows[3] ?? "", /生效日期和第 2 行重叠（2026-10-10 起一直有效）生效日期和已有的价格重叠：东京 23 区 · VG-BIZ-7 · 接送通用，2026-01-01 至 2026-12-31/);
  assert.doesNotMatch(pageText(), /对外价|加价比例|PRECISION|INVALID_DATE/);

  resetBrowser();
  open(`/products/${PRODUCT_ID}/prices/import`, "readonly");
  await screen.findByText("你没有权限查看这里");
  assertAbsent(document.getElementById("import-file"));
});

// ───────────── 上架检查 ─────────────

test("上架检查的库存一项：不限量 / 限量各有一句；限量但从今天起没有库存时写「有 1 处要留意」，不拦上架，上架确认里再提醒一次", async () => {
  const actor = user();
  open(`/products/${PRODUCT_ID}/publish`, "admin", { inventory: (query) => inventoryOf(query, "unlimited") });
  await waitFor(() => assert.match(document.querySelector('[data-check="inventory"]')?.textContent ?? "", /库存，不是必须现在是不限量，每天接多少单都可以。想限制每天接多少单时才用设。/));

  resetBrowser();
  open(`/products/${PRODUCT_ID}/publish`, "admin", { check: checkOf(NO_STOCK), inventory: (query) => inventoryOf(query, "limited") });
  await waitFor(() => assert.match(document.querySelector('[data-check="inventory"]')?.textContent ?? "", /库存，有 1 处要留意库存是限量的，但从今天起没有一天有库存——上了架也卖不出去。去设/));
  assert.equal(document.querySelector('[data-check="inventory"] a')?.getAttribute("href"), `/products/${PRODUCT_ID}/inventory`);
  assert.ok(screen.getByText("可以上架了"));
  assert.match(pageText(), /另外，库存是限量的，但从今天起没有一天有库存，这个商品现在卖不出去（见下面「库存」一项）。/);
  await actor.click(screen.getByRole("button", { name: "上架" }));
  assert.match(screen.getByRole("dialog", { name: "上架「羽田机场接送」？" }).textContent ?? "", /现在上架也卖不出去：库存是限量的，从今天起没有一天有库存。可以先去设库存，也可以先上架、之后再设。/);
  assert.doesNotMatch(pageText(), /NO_INVENTORY_AHEAD/);
});

test("导入：文件打不开时，固定的那句话后面接上后端说的具体原因；别的原因不重复后端的话", async () => {
  const actor = userEvent.setup({ applyAccept: false });
  let answer: Response = apiError(400, "IMPORT_FILE_INVALID", "文件的编码是 UTF-16，读不了。请用 Excel 另存为 .xlsx。", { reason: "CORRUPT" });
  open(`/products/${PRODUCT_ID}/inventory/import`, "admin", {}, (call) => (call.method === "POST" ? answer : null));
  await screen.findByRole("heading", { level: 3, name: "导入库存" });
  await actor.upload(document.getElementById("import-file") as HTMLInputElement, xlsx());
  await screen.findByText("这个文件打不开，可能已经损坏。请在 Excel 里重新保存一份再传。（文件的编码是 UTF-16，读不了。请用 Excel 另存为 .xlsx）");
  answer = apiError(400, "IMPORT_FILE_INVALID", "not a zip", { reason: "CORRUPT" });
  await actor.upload(document.getElementById("import-file") as HTMLInputElement, xlsx());
  await screen.findByText("这个文件打不开，可能已经损坏。请在 Excel 里重新保存一份再传。");
});
