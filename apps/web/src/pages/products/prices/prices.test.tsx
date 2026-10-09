/**
 * 第 ③ 步「价格规则」的组件测试：价格表、调价规则的列表和表单，各种状态、各种被拒、只读角色。
 * 接口用测试替身；真实后端由端到端测试（e2e/prices.spec.ts）覆盖。金额的期望值和 @nozomi/domain 的计算对照。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { addDays, applyAdjustRules, exactFromMinor, roundToUnit, weekdayOf } from "@nozomi/domain";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../../App.tsx";
import type { AdjustRuleBody, AdjustRules, CalendarDay, CalendarSegment, PriceCalendar, PriceOverviewItem, PriceRuleBody, PriceRules } from "../../../api/prices.ts";
import type { Product, PublishCheckItemBody, PublishCheckResult } from "../../../api/products.ts";
import { type ApiCall, apiError, assertAbsent, assertFocused, json, resetBrowser, signIn, stubApiWith } from "../../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T03:04:00.000Z" };
const PRODUCT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AREA_ID = "44444444-4444-4444-8444-444444444444";
const GROUP_ID = "55555555-5555-4555-8555-555555555555";
const PRICE_ID = "77777777-7777-4777-8777-777777777777";
const RULE_ID = "88888888-8888-4888-8888-888888888888";
const RULE2_ID = "99999999-9999-4999-8999-999999999999";
const BASE = `/tenant/v1/products/${PRODUCT_ID}`;
const TODAY = "2026-10-08";

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
    areas: [{ area_id: AREA_ID, priority: 0, name: { zh: "东京 23 区" }, biz_type: "general", status: "active" }],
    vehicle_groups: [{ vehicle_group_id: GROUP_ID, passengers: 6, luggage: 4, code: "VG-BIZ-7", name: { zh: "商务七座" }, grade: "business", seats: 7, sample_models: [], combos: [{ passengers: 6, luggage: 4 }], status: "active" }],
    dispatchers: [{ name: "山田", phone: "+81 90 1234 5678" }],
    ...overrides,
  }) as unknown as Product;

const item = (key: string, issues: { path: string; reason: string }[] = [], required = true): PublishCheckItemBody => ({ key, required, passed: issues.length === 0, issues: issues.map((issue) => ({ ...issue, message: "说明" })) });
const checkOf = (changes: Record<string, { path: string; reason: string }[]> = {}): PublishCheckResult => {
  const items = [item("basic_info"), item("service_rules"), item("price_rules", changes["price_rules"]), item("content"), item("adjust_rules", changes["adjust_rules"], false), item("inventory", changes["inventory"], false)];
  return { can_publish: items.every((entry) => !entry.required || entry.passed), items };
};
const NO_PRICE = { price_rules: [{ path: "/", reason: "NO_ACTIVE_PRICE_RULE" }] };

const priceOf = (overrides: Partial<PriceRuleBody> = {}): PriceRuleBody => ({ id: PRICE_ID, area_id: AREA_ID, vehicle_group_id: GROUP_ID, direction: "both", package_hours: null, pricing_model: "fixed", base_price: 20000, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null, valid_from: "2026-10-01", valid_to: null, status: "enabled", base: "20000", ...stamps, ...overrides });
const pricesOf = (items: PriceRuleBody[] = [priceOf()], overrides: Partial<PriceRules> = {}): PriceRules => ({ version: 7, currency: "JPY", rounding_unit: 100, available_models: ["fixed", "mileage_time"], today: TODAY, items, coverage: { total: 2, priced: items.length > 0 ? 2 : 0, missing: items.length > 0 ? 0 : 2 }, ...overrides });
const adjustOf = (overrides: Partial<AdjustRuleBody> = {}): AdjustRuleBody => ({ id: RULE_ID, name: "国庆旺季", travel_from: "2026-10-01", travel_to: "2027-10-07", cycle: { type: "daily" }, time_slot: null, area_ids: [], vehicle_group_ids: [], directions: [], package_hours: [], steps: [{ type: "percent", value: 2000 }], status: "enabled", ended: false, ...stamps, ...overrides });
const adjustsOf = (items: AdjustRuleBody[] = [], version = 7): AdjustRules => ({ version, currency: "JPY", rounding_unit: 100, today: TODAY, items });
const weekend = adjustOf({ id: RULE2_ID, name: "周末夜间", travel_from: "2026-10-10", travel_to: null, cycle: { type: "weekly", weekdays: [6, 7] }, time_slot: { start: "22:00", end: "06:00" }, area_ids: [AREA_ID], directions: ["pickup"], steps: [{ type: "percent", value: 1000 }, { type: "amount", value: 500 }], status: "disabled" });

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;
interface State {
  product?: Product;
  check?: PublishCheckResult;
  prices?: PriceRules;
  adjusts?: AdjustRules;
  holidays?: { items: unknown[]; countries: unknown[] };
  calendar?: (query: URLSearchParams) => PriceCalendar;
  overview?: PriceOverviewItem[];
  summary?: { products: { draft: number; published: number; unpublished: number } | null };
}

const segmentOf = (changes: Partial<CalendarSegment> = {}): CalendarSegment => ({ from: "00:00", to: "24:00", final: 20000, no_price_reason: null, base: "20000", unrounded: "20000", adjusts: [], ...changes });
/** 一个月的日历：每天都是基础价；`special` 里的日子换成给的段。 */
function calendarOf(query: URLSearchParams, special: Record<string, CalendarSegment[]> = {}, holiday: Record<string, string> = {}): PriceCalendar {
  const days: CalendarDay[] = [];
  for (let date = query.get("from") ?? ""; date <= (query.get("to") ?? ""); date = addDays(date, 1)) {
    days.push({ date, weekday: weekdayOf(date), holiday: holiday[date] ? { name: { zh: holiday[date] as string } } : null, price_rule: { id: PRICE_ID, pricing_model: "fixed", direction: "both", valid_from: "2026-10-01", valid_to: null }, segments: special[date] ?? [segmentOf()] });
  }
  return { version: 7, currency: "JPY", rounding_unit: 100, today: TODAY, days, groups: [{ vehicle_group_id: query.get("vehicle_group_id") ?? "", days }] };
}
const overviewOf = (changes: Partial<PriceOverviewItem> = {}): PriceOverviewItem => ({ product_id: PRODUCT_ID, code: "PRD202610081430050001", status: "draft", category: "airport_transfer", title: { zh: "羽田机场接送" }, city: { id: "c1", name: { zh: "东京" } }, coverage: { total: 2, missing: 0 }, inventory_mode: "unlimited", no_inventory_ahead: false, price_rule_count: 12, has_active_price: true, active_price_rule_count: 12, enabled_adjust_rule_count: 2, ...changes });

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
    if (at === `${BASE}/price-rules`) return json(200, state.prices ?? pricesOf());
    if (at === `${BASE}/adjust-rules`) return json(200, state.adjusts ?? adjustsOf());
    if (at === "/tenant/v1/holidays") return json(200, state.holidays ?? { items: [], countries: [] });
    if (at === `${BASE}/price-calendar`) return json(200, (state.calendar ?? calendarOf)(call.url.searchParams));
    if (at === "/tenant/v1/price-overview") {
      const items = state.overview ?? [];
      const counted = items.filter((entry) => entry.status !== "unpublished");
      const numbers = { products_with_price: counted.filter((entry) => entry.has_active_price).length, products_without_price: counted.filter((entry) => !entry.has_active_price).length, published_without_inventory: items.filter((entry) => entry.status === "published" && entry.no_inventory_ahead).length };
      return json(200, call.url.searchParams.get("summary") === "1" ? numbers : { ...numbers, items });
    }
    if (at === "/tenant/v1/dashboard/summary") return json(200, { areas: { active: 1, disabled: 0 }, ...(state.summary ?? { products: { draft: 1, published: 0, unpublished: 0 } }) });
    if (at === "/tenant/v1/brands") return json(200, { items: [{ id: "b1", name: "NOZOMI", currency: "JPY", status: "active", version: 4, ...stamps }] });
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
const stepText = (name: string): string => [...document.querySelectorAll(".step-nav__item")].find((node) => node.textContent?.includes(name))?.textContent ?? "";
const user = () => userEvent.setup();
const ROW = "东京 23 区 · 商务七座 · 接送通用";
const jpy = (minor: number | null): string => `JPY ${(minor ?? 0).toLocaleString("en-US")}`;
const pageText = (): string => document.body.textContent ?? "";
/** 规则 4：供应商后台的页面上不能出现对外价和加价比例。 */
const assertNoRetailWords = (): void => assert.doesNotMatch(pageText(), /对外价|加价比例|markup|sell_price/i);

// ───────────── 框架和价格表 ─────────────

test("第 ③ 步：还没有价格时步骤导航说的是真实原因；说明行有币种、取整、时区；每个缺价的组合占一行；加载失败能重试", async () => {
  let fail = true;
  open(`/products/${PRODUCT_ID}`, "admin", { check: checkOf(NO_PRICE), prices: pricesOf([]) }, (call) => (call.method === "GET" && call.url.pathname === `${BASE}/price-rules` && fail ? apiError(500, "INTERNAL", "boom") : null));
  await screen.findByRole("heading", { level: 2, name: "③ 价格规则" });
  assert.match(stepText("价格规则"), /还差 1 项/);
  assert.match(stepText("库存"), /已完成/);
  await screen.findByText("加载失败");
  fail = false;
  await user().click(screen.getByRole("button", { name: "重试" }));
  await screen.findByRole("heading", { level: 3, name: "还没有设价格" });
  assert.match(document.querySelector(".price-info")?.textContent ?? "", /金额都是结算价，币种 JPY（日元没有小数） · 调价后的结算价取整到 JPY 100修改 · 日期按东京当地时间/);
  assert.equal(document.querySelectorAll(".price-table tbody tr").length, 1);
  assert.match(document.querySelector(".price-table tbody tr")?.textContent ?? "", /没有价格/);
  const tabs = within(screen.getByRole("navigation", { name: "价格规则的分区" }));
  assert.equal(tabs.getByRole("link", { name: /价格规则/ }).getAttribute("aria-current"), "page");
  assert.match(tabs.getByRole("link", { name: /价格规则/ }).textContent ?? "", /缺 2/);
  assert.equal(tabs.getByRole("link", { name: /调价规则/ }).getAttribute("href"), `/products/${PRODUCT_ID}/prices/adjust`);
  assertNoRetailWords();
  assert.doesNotMatch(pageText(), /NO_ACTIVE_PRICE_RULE|FEATURE_NOT_AVAILABLE|airport_transfer/);
});

test("第 ③ 步：商品还没有选区域或车型组时，不显示价格表，带去第 ① 步", async () => {
  open(`/products/${PRODUCT_ID}/prices`, "admin", { product: productOf({ areas: [] }), prices: pricesOf([]) });
  await screen.findByText("先选服务区域和车型组");
  assert.match(pageText(), /这个商品还没有选服务区域。/);
  assert.equal(screen.getByRole("link", { name: "去第 ① 步选" }).getAttribute("href"), `/products/${PRODUCT_ID}/basic#areas`);
  assertAbsent(document.querySelector(".price-table"));
});

test("价格表：填一口价 → 批量保存带 If-Match 和 Idempotency-Key，只提交新增的那一条；金额是整数的最小货币单位；保存后换成最新的版本号", async () => {
  const actor = user();
  const saved = { ...pricesOf([priceOf({ valid_from: TODAY })], { version: 8 }), created_ids: [PRICE_ID] };
  const calls = open(`/products/${PRODUCT_ID}/prices`, "admin", { check: checkOf(NO_PRICE), prices: pricesOf([]) }, (call) => (call.method === "POST" && call.url.pathname === `${BASE}/price-rules/batch` ? json(200, saved) : null));
  const cell = await screen.findByLabelText(`${ROW} 的基础价`);
  await actor.type(cell, "20000.5");
  await actor.click(screen.getByRole("button", { name: "保存草稿" }));
  await screen.findByText("有 1 处需要修改");
  assert.equal(writes(calls).length, 0, "写错了的不发请求");
  await actor.clear(cell);
  await actor.type(cell, "20000");
  await actor.tab();
  assert.equal((cell as HTMLInputElement).value, "20,000");
  assert.match(document.querySelector(".price-meaning")?.textContent ?? "", /每单 JPY 20,000，不看里程和时长。/);
  await actor.click(screen.getByRole("button", { name: "保存草稿" }));
  await waitFor(() => assert.equal(writes(calls).length, 1));
  const post = writes(calls)[0] as ApiCall;
  assert.equal(post.headers["if-match"], '"7"');
  assert.match(post.headers["idempotency-key"] ?? "", /^[0-9a-f-]{36}$/);
  const batch = post.body as { create: Record<string, unknown>[]; update: unknown[]; delete: unknown[] };
  assert.deepEqual([batch.create.length, batch.update, batch.delete], [1, [], []]);
  assert.deepEqual([batch.create[0]?.["base_price"], batch.create[0]?.["direction"], batch.create[0]?.["pricing_model"], batch.create[0]?.["valid_from"], batch.create[0]?.["valid_to"], batch.create[0]?.["status"]], [20000, "both", "fixed", TODAY, null, "enabled"]);
  await waitFor(() => assert.match(document.querySelector(".price-table tbody tr")?.textContent ?? "", /生效中/));
  assert.doesNotMatch(JSON.stringify(batch), /markup|sell_price/);
});

test("价格表被拒：日期和别人刚加的重叠（409）指回那一行；别人先改了（409）保留我的修改；已上架改完不满足上架条件；后端指出的格子", async () => {
  const actor = user();
  let answer: Response = apiError(409, "PRICE_RULE_CONFLICT", "overlap", { conflicts: [{ id: PRICE_ID, valid_from: "2026-10-01", valid_to: null, with: [{ id: "other", valid_from: "2026-11-01", valid_to: null }] }] });
  const calls = open(`/products/${PRODUCT_ID}/prices`, "admin", {}, (call) => (call.method === "POST" && call.url.pathname === `${BASE}/price-rules/batch` ? answer : null));
  const cell = (await screen.findByLabelText(`${ROW} 的基础价`)) as HTMLInputElement;
  await actor.clear(cell);
  await actor.type(cell, "21000");
  await actor.click(screen.getByRole("button", { name: "保存草稿" }));
  await screen.findByText(/有 1 条价格的生效日期和已有的价格重叠，所以这一批都没有保存。/);
  const pointer = screen.getByRole("button", { name: `${ROW}：2026-10-01 起一直有效 ↔ 2026-11-01 起一直有效（别人刚加的）` });
  await actor.click(pointer);
  assertFocused(screen.getByLabelText(`${ROW} 的生效日期从`));
  assert.equal(cell.value, "21,000", "被拒以后填的还在");
  assert.ok(screen.getByRole("button", { name: "重新读取价格" }));

  answer = apiError(409, "VERSION_CONFLICT", "stale");
  await actor.click(screen.getByRole("button", { name: "保存草稿" }));
  await screen.findByText("这个商品刚被别人修改过，你的修改还没有保存。");
  await actor.click(screen.getByRole("button", { name: "载入最新内容，保留我的修改" }));
  await screen.findByText("已载入最新内容，你的修改还在，检查后再点保存。");
  assert.equal((screen.getByLabelText(`${ROW} 的基础价`) as HTMLInputElement).value, "21,000");

  answer = apiError(409, "PUBLISH_CHECK_FAILED", "no", { items: [item("price_rules", [{ path: "/", reason: "NO_ACTIVE_PRICE_RULE" }])] });
  await actor.click(screen.getByRole("button", { name: "保存草稿" }));
  await waitFor(() => assert.match(pageText(), /没有保存。/));

  answer = apiError(400, "VALIDATION_FAILED", "bad", { issues: [{ path: "/update/0/base_price", reason: "OUT_OF_RANGE", message: "基础价太大了" }] });
  await actor.click(screen.getByRole("button", { name: "保存草稿" }));
  await screen.findByRole("button", { name: `${ROW}：基础价太大了` });
  assert.equal(writes(calls).length, 4);
  assert.doesNotMatch(pageText(), /PRICE_RULE_CONFLICT|VERSION_CONFLICT|PUBLISH_CHECK_FAILED|VALIDATION_FAILED|OUT_OF_RANGE/);
});

test("价格表：同一个组合再加一段日期，重叠当场标出来，点保存不发请求", async () => {
  const actor = user();
  const calls = open(`/products/${PRODUCT_ID}/prices`, "admin");
  await screen.findByLabelText(`${ROW} 的基础价`);
  await actor.click(screen.getByRole("button", { name: `${ROW} 的更多操作` }));
  await actor.click(screen.getByRole("menuitem", { name: "再加一段日期" }));
  const added = screen.getAllByLabelText(`${ROW} 的生效日期从`).find((node) => (node as HTMLInputElement).value === "") as HTMLInputElement;
  await actor.type(added, "2026-12-01");
  await screen.findByText("有 2 条价格的生效日期重叠，保存前要改。");
  assert.equal([...document.querySelectorAll(".price-table tbody tr")].filter((row) => row.textContent?.includes("和 1 条价格的日期重叠")).length, 2);
  await actor.click(screen.getByRole("button", { name: "保存草稿" }));
  await screen.findByRole("button", { name: /^生效日期重叠——/ });
  assert.equal(writes(calls).length, 0);
});

test("价格表：只读角色看得到价格，不能改，没有保存", async () => {
  open(`/products/${PRODUCT_ID}/prices`, "readonly");
  const cell = (await screen.findByLabelText(`${ROW} 的基础价`)) as HTMLInputElement;
  assert.deepEqual([cell.value, cell.readOnly], ["20,000", true]);
  assert.equal(document.querySelectorAll(".price-table select:not([disabled])").length, 0);
  assert.equal(document.querySelectorAll(".price-table input:not([readonly]):not([disabled])").length, 0);
  assertAbsent(screen.queryByRole("button", { name: "保存草稿" }));
  assertAbsent(screen.queryByRole("button", { name: /的更多操作$/ }));
  assertNoRetailWords();
});

// ───────────── 调价规则：列表 ─────────────

test("调价规则列表：加载失败、一条都没有、只有已结束的、还没有价格时的提示", async () => {
  let fail = true;
  open(`/products/${PRODUCT_ID}/prices/adjust`, "admin", { prices: pricesOf([]) }, (call) => (call.method === "GET" && call.url.pathname === `${BASE}/adjust-rules` && fail ? apiError(500, "INTERNAL", "boom") : null));
  await screen.findByText("加载失败");
  assert.match(pageText(), /调价规则可以不设。设了以后，命中的日子会在基础价上再调一次。/);
  fail = false;
  await user().click(screen.getByRole("button", { name: "重试" }));
  await screen.findByRole("heading", { name: "还没有调价规则" });
  assert.equal(screen.getByRole("link", { name: "新建调价规则" }).getAttribute("href"), `/products/${PRODUCT_ID}/prices/adjust/new`);
  assert.ok(screen.getByText("这个商品还没有价格。调价规则是在基础价上调的，先到「价格规则」页签把价格填上。"));

  resetBrowser();
  open(`/products/${PRODUCT_ID}/prices/adjust`, "admin", { adjusts: adjustsOf([adjustOf({ ended: true, travel_to: "2026-01-01" })]) });
  await screen.findByText("现在没有生效或将要生效的调价规则。");
  await user().click(screen.getByRole("checkbox", { name: "显示已结束的（1 条）" }));
  const row = screen.getByRole("link", { name: "国庆旺季" }).closest("tr") as HTMLElement;
  assert.match(row.textContent ?? "", /已结束/);
  assertAbsent(within(row).queryByRole("button", { name: /上移/ }));

  resetBrowser();
  open(`/products/${PRODUCT_ID}/prices/adjust`, "readonly", { adjusts: adjustsOf([]) });
  await screen.findByRole("heading", { name: "还没有调价规则" });
  assertAbsent(screen.queryByRole("link", { name: "新建调价规则" }));
});

test("调价规则列表：每一行读得出什么时候、对哪些、怎么调；碰不到价格的有提醒；只读角色只有「查看」", async () => {
  open(`/products/${PRODUCT_ID}/prices/adjust`, "admin", { adjusts: adjustsOf([adjustOf(), weekend, adjustOf({ id: "r3", name: "别处", area_ids: ["gone"] })]) });
  const first = (await screen.findByRole("link", { name: "国庆旺季" })).closest("tr") as HTMLElement;
  for (const text of ["2026-10-01 至 2027-10-07", "每天 · 全天", "全部区域 · 全部车型组", "接机和送机", "上调 20%", "已启用"]) assert.ok(first.textContent?.includes(text), `第一行应该有「${text}」，实际：${first.textContent}`);
  const second = screen.getByRole("link", { name: "周末夜间" }).closest("tr") as HTMLElement;
  for (const text of ["2026-10-10 起", "每周六、周日 · 22:00–次日 06:00", "东京 23 区 · 全部车型组", "只接机", "上调 10%", "再上调 JPY 500", "已停用"]) assert.ok(second.textContent?.includes(text), `第二行应该有「${text}」，实际：${second.textContent}`);
  assert.equal(within(second).getByRole("link", { name: "周末夜间" }).getAttribute("href"), `/products/${PRODUCT_ID}/prices/adjust/${RULE2_ID}`);
  assert.match(screen.getByRole("link", { name: "别处" }).closest("tr")?.textContent ?? "", /适用范围里现在没有价格，这条规则暂时调不到任何东西。/);
  assert.match(screen.getByRole("navigation", { name: "价格规则的分区" }).textContent ?? "", /调价规则2/);
  assertNoRetailWords();

  resetBrowser();
  open(`/products/${PRODUCT_ID}/prices/adjust`, "readonly", { adjusts: adjustsOf([adjustOf()]) });
  const row = (await screen.findByRole("link", { name: "国庆旺季" })).closest("tr") as HTMLElement;
  assert.ok(within(row).getByRole("link", { name: "查看 国庆旺季" }));
  assertAbsent(within(row).queryByRole("switch"));
  assertAbsent(within(row).queryByRole("button"));
  assertAbsent(screen.queryByRole("link", { name: "新建调价规则" }));
});

test("调价规则列表：顺序只靠上移 / 下移，动过要点保存；编号对不上（别人刚改过）重新取列表；还原顺序", async () => {
  const actor = user();
  let answer: Response = apiError(400, "VALIDATION_FAILED", "bad", { issues: [{ path: "/ids", reason: "IDS_MISMATCH", message: "x" }] });
  const calls = open(`/products/${PRODUCT_ID}/prices/adjust`, "admin", { adjusts: adjustsOf([adjustOf(), weekend]) }, (call) => (call.method === "PUT" && call.url.pathname === `${BASE}/adjust-rules/order` ? answer : null));
  await screen.findByRole("link", { name: "国庆旺季" });
  assert.equal((screen.getByRole("button", { name: "上移 国庆旺季" }) as HTMLButtonElement).disabled, true);
  await actor.click(screen.getByRole("button", { name: "下移 国庆旺季" }));
  await screen.findByText("顺序改了，还没有保存。");
  assert.match(pageText(), /国庆旺季 现在排第 2，共 2 条/);
  assert.deepEqual([...document.querySelectorAll(".adjust-table tbody th a")].map((node) => node.textContent), ["周末夜间", "国庆旺季"]);
  await actor.click(screen.getByRole("button", { name: "还原顺序" }));
  assert.deepEqual([...document.querySelectorAll(".adjust-table tbody th a")].map((node) => node.textContent), ["国庆旺季", "周末夜间"]);
  assertAbsent(screen.queryByText("顺序改了，还没有保存。"));

  await actor.click(screen.getByRole("button", { name: "下移 国庆旺季" }));
  await actor.click(screen.getByRole("button", { name: "保存顺序" }));
  await screen.findByText("调价规则刚被别人改过，顺序没有保存。");
  const put = writes(calls)[0] as ApiCall;
  assert.deepEqual(put.body, { ids: [RULE2_ID, RULE_ID] });
  assert.equal(put.headers["if-match"], '"7"');
  assert.equal(calls.filter((call) => call.method === "GET" && call.path.endsWith("/adjust-rules")).length, 2, "列表重新取了一次");

  answer = json(200, adjustsOf([weekend, adjustOf()], 8));
  await actor.click(screen.getByRole("button", { name: "下移 国庆旺季" }));
  await actor.click(screen.getByRole("button", { name: "保存顺序" }));
  await screen.findByText("已保存顺序");
  assert.deepEqual([...document.querySelectorAll(".adjust-table tbody th a")].map((node) => node.textContent), ["周末夜间", "国庆旺季"]);
  assert.doesNotMatch(pageText(), /IDS_MISMATCH/);
});

test("调价规则列表：草稿的启停立即生效；已上架的先确认；启用被拒（调完不大于 0）开关弹回并带去修改；删除要确认并带 If-Match", async () => {
  const actor = user();
  let toggle: Response = json(200, { version: 8, adjust_rule: adjustOf({ status: "disabled" }) });
  const calls = open(`/products/${PRODUCT_ID}/prices/adjust`, "admin", { adjusts: adjustsOf([adjustOf(), weekend]) }, (call) => {
    if (call.method === "POST" && /\/(enable|disable)$/.test(call.url.pathname)) return toggle;
    if (call.method === "DELETE") return json(200, { version: 9 });
    return null;
  });
  await actor.click(await screen.findByRole("switch", { name: "启用 国庆旺季" }));
  await screen.findByText("已停用「国庆旺季」");
  assert.equal(writes(calls)[0]?.path, `${BASE}/adjust-rules/${RULE_ID}/disable`);
  assert.equal(writes(calls)[0]?.headers["if-match"], undefined, "启停不带版本号");
  assert.equal((screen.getByRole("switch", { name: "启用 国庆旺季" }) as HTMLInputElement).checked, false);

  toggle = apiError(400, "VALIDATION_FAILED", "bad", { issues: [{ path: "/steps", reason: "ADJUST_RESULT_NOT_POSITIVE", message: "x", detail: { count: 3 } }] });
  await actor.click(screen.getByRole("switch", { name: "启用 周末夜间" }));
  await screen.findByText("按现在的价格算，这条规则有 3 条价格调完不大于 0。请先改这条规则。");
  assert.equal(screen.getByRole("link", { name: "去修改" }).getAttribute("href"), `/products/${PRODUCT_ID}/prices/adjust/${RULE2_ID}`);
  assert.equal((screen.getByRole("switch", { name: "启用 周末夜间" }) as HTMLInputElement).checked, false);

  await actor.click(screen.getByRole("button", { name: "周末夜间 的更多操作" }));
  await actor.click(screen.getByRole("menuitem", { name: "删除" }));
  const dialog = screen.getByRole("dialog", { name: "删除调价规则「周末夜间」？" });
  assert.match(dialog.textContent ?? "", /删除后不能恢复。只是暂时不用的话，可以停用。/);
  assertFocused(within(dialog).getByRole("button", { name: "取消" }));
  await actor.click(within(dialog).getByRole("button", { name: "删除" }));
  await screen.findByText("已删除调价规则「周末夜间」");
  const removal = writes(calls).at(-1) as ApiCall;
  assert.deepEqual([removal.method, removal.path, removal.headers["if-match"]], ["DELETE", `${BASE}/adjust-rules/${RULE2_ID}`, '"8"']);
  assertAbsent(screen.queryByRole("link", { name: "周末夜间" }));

  // 已上架：先确认，默认焦点在「取消」
  resetBrowser();
  const published = open(`/products/${PRODUCT_ID}/prices/adjust`, "admin", { product: productOf({ status: "published" }), adjusts: adjustsOf([adjustOf()]) }, (call) => (call.method === "POST" && call.url.pathname.endsWith("/disable") ? json(200, { version: 8, adjust_rule: adjustOf({ status: "disabled" }) }) : null));
  await actor.click(await screen.findByRole("switch", { name: "启用 国庆旺季" }));
  const confirm = screen.getByRole("dialog", { name: "停用「国庆旺季」？" });
  assert.match(confirm.textContent ?? "", /这个商品已上架，停用后大约 1 分钟生效，之后的报价就会不再按这条规则调价。已经下的订单不受影响。/);
  assertFocused(within(confirm).getByRole("button", { name: "取消" }));
  assert.equal(writes(published).length, 0);
  await actor.click(within(confirm).getByRole("button", { name: "停用" }));
  await screen.findByText("已停用「国庆旺季」");
  assert.doesNotMatch(pageText(), /ADJUST_RESULT_NOT_POSITIVE|VALIDATION_FAILED/);
});

// ───────────── 调价规则：新建 / 编辑 ─────────────

test("新建调价规则：没填完整不能保存；周期、时段、适用范围、两步都读回来；试算的每个数和 domain 一样；提交带 If-Match 和 Idempotency-Key", async () => {
  const actor = user();
  const created = adjustOf({ id: RULE2_ID, name: "周末夜间" });
  const calls = open(`/products/${PRODUCT_ID}/prices/adjust/new`, "admin", {}, (call) => (call.method === "POST" && call.url.pathname === `${BASE}/adjust-rules` ? json(201, { version: 8, adjust_rule: created }) : null));
  await screen.findByRole("heading", { level: 3, name: "新建调价规则" });
  assert.equal((screen.getByLabelText("出行日期从") as HTMLInputElement).value, TODAY);
  assert.equal(within(screen.getByRole("navigation", { name: "价格规则的分区" })).getByRole("link", { name: /调价规则/ }).getAttribute("aria-current"), "page");
  assert.match(pageText(), /下面三项同时满足的用车时间，才会被这条规则调价。都按东京当地时间。/);
  await actor.click(screen.getByRole("button", { name: "保存" }));
  await screen.findByText("有 2 处需要修改");
  assertFocused(screen.getByRole("textbox", { name: "名称" }));
  assert.equal(writes(calls).length, 0);

  await actor.type(screen.getByRole("textbox", { name: "名称" }), "周末夜间");
  await actor.click(screen.getByRole("radio", { name: /每周的某几天/ }));
  await actor.click(screen.getByRole("button", { name: "周末" }));
  assert.equal(screen.getByRole("button", { name: "周六" }).getAttribute("aria-pressed"), "true");
  await actor.click(screen.getByRole("radio", { name: "指定时段" }));
  await actor.type(screen.getByLabelText("时段从"), "22");
  await actor.type(screen.getByLabelText("时段到"), "6");
  await actor.tab();
  await screen.findByText("周六 22:00–周日 06:00、周日 22:00–周一 06:00");
  await actor.click(screen.getByRole("radio", { name: "指定区域" }));
  await actor.click(screen.getByRole("checkbox", { name: "东京 23 区" }));
  await actor.click(screen.getByRole("radio", { name: "只接机" }));
  await actor.type(screen.getByLabelText("第 1 步的数值"), "12.5");
  await actor.click(screen.getByRole("button", { name: "加一步" }));
  await actor.selectOptions(screen.getByLabelText("第 2 步的方向"), "down");
  await actor.selectOptions(screen.getByLabelText("第 2 步的方式"), "amount");
  await actor.type(screen.getByLabelText("第 2 步的数值"), "333");

  const steps = [{ type: "percent" as const, value: 1250 }, { type: "amount" as const, value: -333 }];
  const expected = applyAdjustRules(exactFromMinor(20000), [{ steps }], 100);
  await waitFor(() => assert.match(document.querySelector(".adjust-trial__final")?.textContent ?? "", new RegExp(`四舍五入、取整到 JPY 100${jpy(expected.finalMinor)}`)), { timeout: 3000 });
  const trial = document.querySelector(".adjust-trial")?.textContent ?? "";
  assert.match(trial, /第 1 步　上调 12\.5%\+2,500JPY 22,500/);
  assert.match(trial, /第 2 步　下调 JPY 333−333JPY 22,167/);
  assert.match(document.querySelector(".adjust-meaning__sentence")?.textContent ?? "", new RegExp(`${TODAY} 起，每周六、周日、22:00–次日 06:00；东京 23 区、全部车型组、只接机：在基础价上上调 12\\.5%，再下调 JPY 333。`));
  assert.match(document.querySelector(".adjust-trial__summary")?.textContent ?? "", new RegExp(`JPY 20,000 → ${jpy(expected.finalMinor)}，比基础价高 ${jpy(expected.adjustMinor)}。`));
  assert.match((screen.getByLabelText("用哪个价来算") as HTMLSelectElement).selectedOptions[0]?.textContent ?? "", /东京 23 区 · 商务七座 · 接送通用　JPY 20,000/);

  await actor.click(screen.getByRole("button", { name: "保存" }));
  await screen.findByText("已新建调价规则「周末夜间」");
  const post = writes(calls)[0] as ApiCall;
  assert.equal(post.headers["if-match"], '"7"');
  assert.match(post.headers["idempotency-key"] ?? "", /^[0-9a-f-]{36}$/);
  assert.deepEqual(post.body, { name: "周末夜间", travel_from: TODAY, travel_to: null, cycle: { type: "weekly", weekdays: [6, 7] }, time_slot: { start: "22:00", end: "06:00" }, area_ids: [AREA_ID], vehicle_group_ids: [], directions: ["pickup"], package_hours: [], steps, status: "enabled" });
  await screen.findByRole("link", { name: "周末夜间" });
  assert.ok(document.querySelector(".adjust-table"), "保存后回到列表");
  assertNoRetailWords();
});

test("调价规则保存：调完不大于 0 不发请求；调得很多再问一次（默认焦点在「回去检查」）；后端指出的步骤；别人先改了；规则被删了", async () => {
  const actor = user();
  let answer: Response = apiError(400, "VALIDATION_FAILED", "bad", { issues: [{ path: "/steps/0/value", reason: "OUT_OF_RANGE", message: "这一步的数太大了" }] });
  const calls = open(`/products/${PRODUCT_ID}/prices/adjust/${RULE_ID}`, "admin", { adjusts: adjustsOf([adjustOf()]) }, (call) => (call.method === "PUT" && call.url.pathname === `${BASE}/adjust-rules/${RULE_ID}` ? answer : null));
  await screen.findByRole("heading", { level: 3, name: "国庆旺季" });
  assert.equal((screen.getByLabelText("第 1 步的数值") as HTMLInputElement).value, "20");
  assert.equal((screen.getByRole("checkbox", { name: /启用这条规则/ }) as HTMLInputElement).checked, true);

  // 下调 JPY 20,000：调完是 0
  await actor.selectOptions(screen.getByLabelText("第 1 步的方向"), "down");
  await actor.selectOptions(screen.getByLabelText("第 1 步的方式"), "amount");
  await actor.type(screen.getByLabelText("第 1 步的数值"), "20000");
  await actor.click(screen.getByRole("button", { name: "保存" }));
  await screen.findByText("按「东京 23 区 · 商务七座 · 接送通用」的价格 JPY 20,000 算，调完不大于 0。请把下调改小、缩小适用范围，或先不勾「启用」。");
  assert.equal(writes(calls).length, 0);
  await screen.findByText("按这个价算下来不大于 0，这样的规则保存不了。请把下调改小。", {}, { timeout: 3000 });

  // 下调 JPY 15,000：低于一半 → 再问一次
  await actor.clear(screen.getByLabelText("第 1 步的数值"));
  await actor.type(screen.getByLabelText("第 1 步的数值"), "15000");
  await actor.click(screen.getByRole("button", { name: "保存" }));
  const dialog = screen.getByRole("dialog", { name: "这条规则调得很多，确认保存？" });
  assert.match(dialog.textContent ?? "", /按「东京 23 区 · 商务七座 · 接送通用」的价格算，JPY 20,000 会变成 JPY 5,000（下调了约 JPY 15,000）。如果是多敲了一个 0，请回去改。/);
  assertFocused(within(dialog).getByRole("button", { name: "回去检查" }));
  assert.equal(writes(calls).length, 0);
  await actor.click(within(dialog).getByRole("button", { name: "确认保存" }));
  await screen.findByRole("button", { name: "这一步的数太大了" });
  const put = writes(calls)[0] as ApiCall;
  assert.equal(put.headers["if-match"], '"7"');
  assert.deepEqual((put.body as { steps: unknown }).steps, [{ type: "amount", value: -15000 }]);

  // 改成不算「调得很多」的：直接提交
  await actor.clear(screen.getByLabelText("第 1 步的数值"));
  await actor.type(screen.getByLabelText("第 1 步的数值"), "1000");
  answer = apiError(409, "VERSION_CONFLICT", "stale");
  await actor.click(screen.getByRole("button", { name: "保存" }));
  await screen.findByText("这个商品刚被别人修改过，你的修改还没有保存。");
  assert.equal((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled, true);
  await actor.click(screen.getByRole("button", { name: "载入最新内容，保留我的修改" }));
  assert.equal((screen.getByLabelText("第 1 步的数值") as HTMLInputElement).value, "1,000", "金额离开输入框后带千分位");

  answer = apiError(400, "VALIDATION_FAILED", "bad", { issues: [{ path: "/steps", reason: "ADJUST_RESULT_NOT_POSITIVE", message: "x", detail: { count: 2 } }] });
  await actor.click(screen.getByRole("button", { name: "保存" }));
  await screen.findByText("按适用范围内的 2 条价格算，调完不大于 0。请把下调改小、缩小适用范围，或先不勾「启用」。");

  answer = apiError(404, "NOT_FOUND", "gone");
  await actor.click(screen.getByRole("button", { name: "保存" }));
  await screen.findByText("找不到这条调价规则，它可能已被别人删除。");
  assert.equal((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled, true);
  assert.doesNotMatch(pageText(), /VERSION_CONFLICT|VALIDATION_FAILED|NOT_FOUND|ADJUST_RESULT_NOT_POSITIVE|OUT_OF_RANGE/);
});

test("调价规则表单：指定日期可以加、去重、删除；节假日只列平台登记了的国家，没有登记时不能选；自己填一个数试算；有修改离开先问", async () => {
  const actor = user();
  open(`/products/${PRODUCT_ID}/prices/adjust/new`, "admin", { prices: pricesOf([]) });
  await screen.findByRole("heading", { level: 3, name: "新建调价规则" });
  assert.equal((screen.getByRole("radio", { name: /节假日/ }) as HTMLInputElement).disabled, true);
  assert.match(pageText(), /平台还没有登记节假日，暂时不能选。可以先用「指定日期」。/);
  assert.match(pageText(), /填一个基础价，这里会一步一步算给你看。/);
  assert.equal((screen.getByLabelText("用哪个价来算") as HTMLSelectElement).value, "custom");
  assert.equal((screen.getByLabelText("用来试算的基础价") as HTMLInputElement).value, "", "页面不预先放示例数字");

  await actor.click(screen.getByRole("radio", { name: /^指定日期/ }));
  assertAbsent(screen.queryByLabelText("出行日期从"));
  await actor.type(screen.getByLabelText("要添加的日期"), "2027/1/1{Enter}");
  assert.ok(within(screen.getByRole("list", { name: "已选的日期" })).getByText("2027-01-01 周五"));
  await actor.type(screen.getByLabelText("要添加的日期"), "2027-01-01{Enter}");
  await screen.findByText("2027-01-01 已经在里面了");
  await actor.click(screen.getByRole("button", { name: "去掉 2027-01-01" }));
  assertAbsent(screen.queryByRole("list", { name: "已选的日期" }));

  await actor.type(screen.getByLabelText("第 1 步的数值"), "3.33");
  await actor.type(screen.getByLabelText("用来试算的基础价"), "15555");
  const expected = applyAdjustRules(exactFromMinor(15555), [{ steps: [{ type: "percent", value: 333 }] }], 100);
  await waitFor(() => assert.match(document.querySelector(".adjust-trial")?.textContent ?? "", /JPY 16,072\.9815（还没取整）/), { timeout: 3000 });
  assert.match(document.querySelector(".adjust-trial__final")?.textContent ?? "", new RegExp(jpy(expected.finalMinor)));

  await actor.click(screen.getByRole("link", { name: "‹ 回到调价规则" }));
  const leave = screen.getByRole("dialog", { name: "这条调价规则有未保存的修改" });
  assertFocused(within(leave).getByRole("button", { name: "继续编辑" }));
  await actor.click(within(leave).getByRole("button", { name: "不保存，离开" }));
  await screen.findByRole("heading", { name: "还没有调价规则" });

  resetBrowser();
  open(`/products/${PRODUCT_ID}/prices/adjust/new`, "admin", { holidays: { items: [{ country_code: "JP", date: "2027-01-01", name: { zh: "元日" }, ...stamps }], countries: [{ country_code: "JP", count: 1, last_date: "2027-01-01" }] } });
  await screen.findByRole("heading", { level: 3, name: "新建调价规则" });
  await actor.click(screen.getByRole("radio", { name: /节假日/ }));
  assert.equal((screen.getByRole("checkbox", { name: "日本的节假日" }) as HTMLInputElement).checked, true, "默认勾商品所在的国家");
  await screen.findByText(/今后 12 个月里有 1 个假日：2027-01-01 周五 元日/);
});

test("调价规则表单：只读角色看得到内容和试算，没有保存；打不开新建页；不存在的规则说明原因", async () => {
  open(`/products/${PRODUCT_ID}/prices/adjust/${RULE2_ID}`, "readonly", { adjusts: adjustsOf([weekend]) });
  await screen.findByRole("heading", { level: 3, name: "周末夜间" });
  assert.match(pageText(), /第 1 步：上调 10%/);
  assert.match(pageText(), /第 2 步：上调 JPY 500/);
  assert.match(pageText(), /每周六、周日/);
  assertAbsent(screen.queryByRole("button", { name: "保存" }));
  assertAbsent(screen.queryByRole("textbox", { name: "名称" }));
  assert.ok(screen.getByLabelText("用哪个价来算"));
  assert.ok(screen.getByRole("link", { name: "回到调价规则" }));

  resetBrowser();
  open(`/products/${PRODUCT_ID}/prices/adjust/new`, "readonly");
  await screen.findByText("你没有权限查看这里");

  resetBrowser();
  open(`/products/${PRODUCT_ID}/prices/adjust/${RULE_ID}`, "admin", { adjusts: adjustsOf([]) });
  await screen.findByText("找不到这条调价规则");
  assert.equal(screen.getByRole("link", { name: "回到调价规则" }).getAttribute("href"), `/products/${PRODUCT_ID}/prices/adjust`);
});

test("上架检查：价格规则、调价规则的真实原因和去处", async () => {
  open(`/products/${PRODUCT_ID}/publish`, "admin", { check: checkOf({ price_rules: [{ path: "/", reason: "ALL_PRICE_RULES_EXPIRED" }], adjust_rules: [{ path: "/0", reason: "ADJUST_RESULT_NOT_POSITIVE" }] }) });
  await waitFor(() => assert.ok(document.querySelector('[data-check="price_rules"]')));
  const prices = document.querySelector('[data-check="price_rules"]') as HTMLElement;
  assert.doesNotMatch(prices.textContent ?? "", /即将开放|已满足/);
  assert.equal(prices.querySelector("a")?.getAttribute("href")?.startsWith(`/products/${PRODUCT_ID}/prices`), true);
  const adjusts = document.querySelector('[data-check="adjust_rules"]') as HTMLElement;
  assert.equal(adjusts.querySelector("a")?.getAttribute("href"), `/products/${PRODUCT_ID}/prices/adjust`);
  assert.doesNotMatch(pageText(), /ALL_PRICE_RULES_EXPIRED|ADJUST_RESULT_NOT_POSITIVE/);
});

// ───────────── 价格日历 ─────────────

const dayCell = (date: string): HTMLElement => document.getElementById(`calendar-day-${date}`) as HTMLElement;
const dayLabel = (date: string): string => dayCell(date).getAttribute("aria-label") ?? "";
const boosted = segmentOf({ final: 24000, unrounded: "24000", adjusts: [{ rule_id: RULE_ID, name: "国庆旺季", steps: [{ type: "percent", value: 2000, delta: "4000", after: "24000" }] }] });

test("价格日历：每一格读得出日期、结算价、被哪条规则调过；没有价格、分时段有文字；明细逐步列出接口给的数；换方向重新取", async () => {
  const actor = user();
  const night = segmentOf({ from: "22:00", final: 26400, unrounded: "26400", adjusts: [...boosted.adjusts, { rule_id: RULE2_ID, name: "周末夜间", steps: [{ type: "percent", value: 1000, delta: "2400", after: "26400" }] }] });
  const special = { "2026-10-01": [boosted], "2026-10-03": [{ ...boosted, to: "22:00" }, night], "2026-10-05": [segmentOf({ final: null, base: null, unrounded: null, no_price_reason: "NO_RULE" })], "2026-10-06": [segmentOf({ final: null, no_price_reason: "RULE_DISABLED" })] };
  const calls = open(`/products/${PRODUCT_ID}/prices/calendar?month=2026-10`, "admin", { adjusts: adjustsOf([adjustOf(), weekend]), calendar: (query) => calendarOf(query, query.get("direction") === "pickup" ? special : {}, { "2026-10-01": "国庆节" }) });
  await waitFor(() => assert.match(dayLabel("2026-10-01"), /^10 月 1 日周四，国庆节，结算价 JPY 24,000，上调，命中国庆旺季$/));
  assert.equal(screen.getByRole("heading", { level: 3, name: "2026 年 10 月" }).getAttribute("aria-live"), "polite");
  assert.match(dayLabel("2026-10-03"), /结算价 JPY 24,000，上调，命中国庆旺季，分时段$/);
  assert.match(dayLabel("2026-10-05"), /^10 月 5 日周一，没有价格$/);
  assert.match(dayLabel("2026-10-06"), /没有价格，已停用$/);
  assert.match(dayLabel("2026-10-08"), /今天，结算价 JPY 20,000$/);
  assert.equal(dayCell("2026-10-08").getAttribute("aria-current"), "date");
  assert.equal(document.querySelectorAll('.calendar [role="gridcell"][data-date]').length, 31);
  const request = calls.find((call) => call.path.includes("/price-calendar")) as ApiCall;
  assert.match(request.path, new RegExp(`area_id=${AREA_ID}&vehicle_group_id=${GROUP_ID}&direction=pickup&from=2026-10-01&to=2026-10-31`));

  // 明细默认是今天；点一天换成那一天
  const panel = document.querySelector(".calendar-layout > .calendar-detail") as HTMLElement;
  assert.match(panel.textContent ?? "", /2026-10-08 周四结算价 JPY 20,00010:00 用车 · 东京 23 区 · 商务七座 · 接机/);
  await actor.click(dayCell("2026-10-03"));
  await waitFor(() => assert.match(panel.textContent ?? "", /2026-10-03 周六结算价 JPY 24,000/));
  assert.match(panel.textContent ?? "", /基础价JPY 20,000/);
  assert.match(panel.textContent ?? "", /1　国庆旺季改这条规则上调 20%\+4,000JPY 24,000取整到 JPY 100JPY 24,000/);
  assert.match(panel.textContent ?? "", /这一天不同时段的价现在看的00:00–22:00JPY 24,000命中「国庆旺季」22:00–24:00JPY 26,400命中「国庆旺季」「周末夜间」/);
  assert.equal(within(panel).getByRole("link", { name: "改这条规则：国庆旺季" }).getAttribute("href"), `/products/${PRODUCT_ID}/prices/adjust/${RULE_ID}`);
  assert.equal(within(panel).getByRole("link", { name: "改这条价格" }).getAttribute("href"), `/products/${PRODUCT_ID}/prices#price-row-${PRICE_ID}`);

  // 「用车时间」换到夜里：不重新取，格子显示夜里的价
  const before = calls.filter((call) => call.path.includes("/price-calendar")).length;
  const time = screen.getByLabelText("用车时间");
  await actor.clear(time);
  await actor.type(time, "23{Enter}");
  await waitFor(() => assert.match(dayLabel("2026-10-03"), /结算价 JPY 26,400，上调，命中国庆旺季等 2 条规则，分时段/));
  assert.equal(calls.filter((call) => call.path.includes("/price-calendar")).length, before);

  // 没有价格的那一天：说明原因和去处
  await actor.click(dayCell("2026-10-05"));
  await waitFor(() => assert.match(panel.textContent ?? "", /这一天没有价格.*这个组合还没有价格，客人询价时报不出价。去填价格/));

  await actor.selectOptions(screen.getByLabelText("方向"), "dropoff");
  await waitFor(() => assert.match(dayLabel("2026-10-01"), /结算价 JPY 20,000$/));
  assert.match(calls.filter((call) => call.path.includes("/price-calendar")).at(-1)?.path ?? "", /direction=dropoff/);
  assert.match(pageText(), /日历上是按价格规则和调价规则算出来的结算价，不含加急费、夜间加价和附加服务。日期是东京当地的用车日期。/);
  assertNoRetailWords();
});

test("价格日历：点一天再按住 Shift 点另一天选一段；键盘也能选；从选的日期去新建调价规则，日期和适用范围已经填好，取消回到日历", async () => {
  const actor = user();
  open(`/products/${PRODUCT_ID}/prices/calendar?month=2026-10`, "admin");
  await waitFor(() => assert.match(dayLabel("2026-10-10"), /结算价/));
  assertAbsent(screen.queryByLabelText("用车时间"));
  await actor.click(dayCell("2026-10-10"));
  await actor.keyboard("{Shift>}");
  await actor.click(dayCell("2026-10-12"));
  await actor.keyboard("{/Shift}");
  const bar = document.querySelector(".calendar-bar") as HTMLElement;
  assert.equal(bar.getAttribute("role"), "status");
  assert.match(bar.textContent ?? "", /已选 2026-10-10 至 2026-10-12，共 3 天/);
  assert.deepEqual(["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"].map((date) => dayCell(date).getAttribute("aria-selected")), ["false", "true", "true", "true", "false"]);
  assert.match(dayLabel("2026-10-10"), /选中的起点$/);
  assert.match(dayCell("2026-10-12").textContent ?? "", /止/);

  // 键盘：Esc 取消；方向键走；Shift + 方向键选；空格起、空格止
  dayCell("2026-10-12").focus();
  await actor.keyboard("{Escape}");
  assert.equal(bar.textContent, "");
  await actor.keyboard("{ArrowDown}");
  assertFocused(dayCell("2026-10-19"));
  await actor.keyboard("{Shift>}{ArrowRight}{ArrowRight}{/Shift}");
  assert.match(bar.textContent ?? "", /已选 2026-10-19 至 2026-10-21，共 3 天/);
  await actor.keyboard("{Escape}{Home} {End} ");
  assert.match(bar.textContent ?? "", /已选 2026-10-19 至 2026-10-25，共 7 天/);
  await actor.keyboard("{PageDown}");
  await screen.findByRole("heading", { level: 3, name: "2026 年 11 月" });
  await waitFor(() => assertFocused(dayCell("2026-11-25")));
  await actor.click(screen.getByRole("button", { name: "回到本月" }));
  await screen.findByRole("heading", { level: 3, name: "2026 年 10 月" });

  await waitFor(() => assert.match(dayLabel("2026-10-10"), /结算价/));
  await actor.click(dayCell("2026-10-10"));
  await actor.keyboard("{Shift>}");
  await actor.click(dayCell("2026-10-12"));
  await actor.keyboard("{/Shift}");
  await actor.click(within(bar).getByRole("link", { name: "新建调价规则" }));
  await screen.findByRole("heading", { level: 3, name: "新建调价规则" });
  assert.match(pageText(), /已按你在日历上选的填好了日期和适用范围（东京 23 区 · 商务七座 · 接机）。想对全部区域或车型组都调，把下面的「对哪些」改成「全部」。/);
  assert.deepEqual([(screen.getByLabelText("出行日期从") as HTMLInputElement).value, (screen.getByLabelText("出行日期到") as HTMLInputElement).value], ["2026-10-10", "2026-10-12"]);
  assert.equal((screen.getByRole("checkbox", { name: "东京 23 区" }) as HTMLInputElement).checked, true);
  assert.equal((screen.getByRole("checkbox", { name: "商务七座" }) as HTMLInputElement).checked, true);
  assert.equal((screen.getByRole("radio", { name: "只接机" }) as HTMLInputElement).checked, true);
  await actor.click(screen.getByRole("button", { name: "取消" }));
  await waitFor(() => assert.match((document.querySelector(".calendar-bar") as HTMLElement | null)?.textContent ?? "", /已选 2026-10-10 至 2026-10-12/));
});

test("价格日历的各种状态：还没有价格、加载失败能重试、整个月没有价格、网址里的组合不认识、月份不合法；只读角色不能新建调价规则", async () => {
  open(`/products/${PRODUCT_ID}/prices/calendar`, "admin", { prices: pricesOf([]) });
  await screen.findByText("还没有价格，日历上没有东西可看");
  assert.equal(screen.getByRole("link", { name: "去填价格" }).getAttribute("href"), `/products/${PRODUCT_ID}/prices`);
  assertAbsent(document.querySelector(".calendar"));

  resetBrowser();
  let fail = true;
  const none = [segmentOf({ final: null, base: null, unrounded: null, no_price_reason: "NOT_IN_EFFECT" })];
  open(`/products/${PRODUCT_ID}/prices/calendar?month=2099-13&area=gone&vg=${GROUP_ID}`, "readonly", { calendar: (query) => calendarOf(query, Object.fromEntries(Array.from({ length: 31 }, (_, index) => [`2026-10-${String(index + 1).padStart(2, "0")}`, none]))) }, (call) => (call.method === "GET" && call.url.pathname === `${BASE}/price-calendar` && fail ? apiError(500, "INTERNAL", "boom") : null));
  await screen.findByText("加载失败");
  assert.ok(screen.getByRole("heading", { level: 3, name: "2026 年 10 月" }), "不合法的月份换成本月");
  assert.ok(screen.getByText("原来看的那个组合已经不在这个商品里了，现在显示的是「东京 23 区 · 商务七座 · 接机」。"));
  fail = false;
  await user().click(screen.getByRole("button", { name: "重试" }));
  await screen.findByText("「东京 23 区 · 商务七座 · 接机」这个月没有价格。");
  assert.match(dayLabel("2026-10-10"), /没有价格$/);
  await user().click(dayCell("2026-10-10"));
  assert.match(document.querySelector(".calendar-bar")?.textContent ?? "", /已选 2026-10-10，共 1 天/);
  assertAbsent(screen.queryByRole("link", { name: "新建调价规则" }));
  assertAbsent(screen.queryByText("拖动或用键盘选一段日期，可以直接新建调价规则"));
  assert.match(document.querySelector(".calendar-layout > .calendar-detail")?.textContent ?? "", /这个组合的价格在这一天不生效：现有的价格是 2026-10-01 起。去看价格/);
});

// ───────────── 取整单位 ─────────────

test("取整单位：管理员能改——选项和例子来自 domain，保存带子品牌的 If-Match；别人先改了载入最新的；没改直接关；商品价格角色没有「修改」", async () => {
  const actor = user();
  let answer: Response = apiError(409, "VERSION_CONFLICT", "stale");
  const calls = open(`/products/${PRODUCT_ID}/prices`, "admin", {}, (call) => (call.method === "PUT" && call.url.pathname === "/tenant/v1/brands/b1/rounding-unit" ? answer : null));
  await actor.click(await screen.findByRole("button", { name: "修改取整单位" }));
  const dialog = screen.getByRole("dialog", { name: "修改取整单位" });
  assert.match(dialog.textContent ?? "", /这是子品牌「NOZOMI」的设置。这个子品牌下的所有商品都会跟着变，已上架的商品也一样。/);
  const select = within(dialog).getByLabelText(/取整到/) as HTMLSelectElement;
  assert.deepEqual([...select.options].map((option) => option.textContent), ["不另外取整（JPY 1）", "JPY 10", "JPY 100", "JPY 1,000"]);
  assert.equal(select.value, "100");
  assert.match(dialog.textContent ?? "", new RegExp(`例：JPY 23,150 → JPY ${roundToUnit(23150, 100).toLocaleString("en-US")}；JPY 23,149 → JPY ${roundToUnit(23149, 100).toLocaleString("en-US")}。四舍五入，正好一半时往大的取。`));
  await actor.click(within(dialog).getByRole("button", { name: "保存" }));
  assert.equal(writes(calls).length, 0, "没有改就点保存：不发请求");
  assertAbsent(screen.queryByRole("dialog", { name: "修改取整单位" }));

  await actor.click(screen.getByRole("button", { name: "修改取整单位" }));
  const again = screen.getByRole("dialog", { name: "修改取整单位" });
  await actor.selectOptions(within(again).getByLabelText(/取整到/), "1000");
  assert.match(again.textContent ?? "", new RegExp(`JPY 231,500 → JPY ${roundToUnit(231500, 1000).toLocaleString("en-US")}`));
  await waitFor(() => assert.equal((within(again).getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled, false));
  await actor.click(within(again).getByRole("button", { name: "保存" }));
  await within(again).findByText("这个子品牌刚被别人修改过。已经载入最新的设置，请确认后再保存。");
  const put = writes(calls)[0] as ApiCall;
  assert.deepEqual([put.headers["if-match"], put.body], ['"4"', { rounding_unit: 1000 }]);
  assert.equal((within(again).getByLabelText(/取整到/) as HTMLSelectElement).value, "100", "换成最新的值");

  answer = json(200, { id: "b1", rounding_unit: 10, version: 5 });
  await actor.selectOptions(within(again).getByLabelText(/取整到/), "10");
  await actor.click(within(again).getByRole("button", { name: "保存" }));
  await screen.findByText("已保存取整单位");
  assert.deepEqual(writes(calls).at(-1)?.body, { rounding_unit: 10 });
  assert.doesNotMatch(pageText(), /VERSION_CONFLICT/);

  resetBrowser();
  open(`/products/${PRODUCT_ID}/prices`, "pricing");
  await screen.findByLabelText(`${ROW} 的基础价`);
  assertAbsent(screen.queryByRole("button", { name: "修改取整单位" }));
});

// ───────────── 菜单里的「价格规则」和首页 ─────────────

test("价格规则总览：每个商品的价格情况四种写法，缺价数和接口给的一致；只看没设价格的、搜索都在浏览器里做；链接进第 ③ 步", async () => {
  const actor = user();
  const items = [
    overviewOf(),
    overviewOf({ product_id: "p2", code: "PRD2", title: { zh: "东京市内包车" }, category: "charter", price_rule_count: 0, has_active_price: false, active_price_rule_count: 0, enabled_adjust_rule_count: 0, coverage: { total: 3, missing: 3 } }),
    overviewOf({ product_id: "p3", code: "PRD3", title: { zh: "成田接送" }, price_rule_count: 4, has_active_price: false, active_price_rule_count: 0, coverage: { total: 2, missing: 2 } }),
    overviewOf({ product_id: "p4", code: "PRD4", title: { zh: "京都点对点" }, category: "point_to_point", status: "published", active_price_rule_count: 5, coverage: { total: 6, missing: 2 }, city: { id: "c2", name: { zh: "京都" } } }),
    overviewOf({ product_id: "p5", code: "PRD5", title: { zh: "下架的" }, status: "unpublished", has_active_price: false, price_rule_count: 0, active_price_rule_count: 0 }),
  ];
  const calls = open("/price-rules", "admin", { overview: items });
  const first = (await screen.findByRole("link", { name: "羽田机场接送" })).closest("tr") as HTMLElement;
  for (const text of ["PRD202610081430050001", "接送机", "东京", "草稿", "12 条生效中的价格", "2 条启用"]) assert.ok(first.textContent?.includes(text), `应该有「${text}」：${first.textContent}`);
  assert.equal(within(first).getByRole("link", { name: "设价格：羽田机场接送" }).getAttribute("href"), `/products/${PRODUCT_ID}/prices`);
  const row = (name: string): string => screen.getByRole("link", { name }).closest("tr")?.textContent ?? "";
  assert.match(row("东京市内包车"), /还没有设价格/);
  assert.match(row("成田接送"), /没有可用的价格有 4 条，都停用或过期了/);
  assert.match(row("京都点对点"), /京都.*6 个组合里 2 个没有价格/);
  assert.match(pageText(), /价格是按商品设的。选一个商品，进去设它的价格、调价规则，或看价格日历。/);
  assert.match(pageText(), /共 5 条/);
  assert.equal(within(screen.getByRole("navigation", { name: "主菜单" })).getByRole("link", { name: "价格规则" }).getAttribute("aria-current"), "page");
  await actor.click(screen.getByRole("button", { name: "羽田机场接送 的更多操作" }));
  assert.equal(screen.getByRole("menuitem", { name: "价格日历" }).getAttribute("href"), `/products/${PRODUCT_ID}/prices/calendar`);
  assert.equal(screen.getByRole("menuitem", { name: "调价规则" }).getAttribute("href"), `/products/${PRODUCT_ID}/prices/adjust`);

  // 只看还没有设价格的：不含已下架的；不再请求
  const requests = calls.length;
  await actor.click(screen.getByRole("checkbox", { name: "只看还没有设价格的" }));
  await waitFor(() => assertAbsent(screen.queryByRole("link", { name: "羽田机场接送" })));
  assert.deepEqual([...document.querySelectorAll(".price-overview tbody th a")].map((node) => node.textContent), ["东京市内包车", "成田接送"]);
  await actor.type(screen.getByRole("searchbox", { name: "按标题或商品编号搜索" }), "prd3{Enter}");
  await waitFor(() => assert.deepEqual([...document.querySelectorAll(".price-overview tbody th a")].map((node) => node.textContent), ["成田接送"]));
  assert.equal(calls.length, requests, "搜索和筛选都在浏览器里做");
  assertNoRetailWords();
});

test("价格规则总览的状态：加载失败、还没有商品、都设了价格、只读角色写「看价格」、带着 priced=no 进来", async () => {
  let fail = true;
  open("/price-rules", "admin", { overview: [] }, (call) => (call.method === "GET" && call.url.pathname === "/tenant/v1/price-overview" && fail ? apiError(500, "INTERNAL", "boom") : null));
  await screen.findByText("加载失败");
  fail = false;
  await user().click(screen.getByRole("button", { name: "重试" }));
  await screen.findByText("先建商品，再设价格");
  assert.equal(screen.getByRole("link", { name: "新建商品" }).getAttribute("href"), "/products/new");

  resetBrowser();
  open("/price-rules?priced=no", "readonly", { overview: [overviewOf()] });
  await screen.findByText("所有商品都设了价格");
  assert.equal((screen.getByRole("checkbox", { name: "只看还没有设价格的" }) as HTMLInputElement).checked, true);
  await user().click(screen.getByRole("button", { name: "看全部商品" }));
  const row = (await screen.findByRole("link", { name: "羽田机场接送" })).closest("tr") as HTMLElement;
  assert.ok(within(row).getByRole("link", { name: "看价格：羽田机场接送" }));
});

test("首页：价格规则卡片的两个数只要概况（summary=1）；有没设价格的提醒去总览；都设了、还没有上架的提醒去商品列表；只读角色没有提醒；数取不到写「—」", async () => {
  const calls = open("/", "admin", { overview: [overviewOf(), overviewOf({ product_id: "p2", has_active_price: false })], summary: { products: { draft: 2, published: 0, unpublished: 0 } } });
  const reminder = await screen.findByRole("link", { name: "1 个商品还没有设价格" });
  assert.equal(reminder.getAttribute("href"), "/price-rules?priced=no");
  assert.match([...document.querySelectorAll(".entry-card")].map((card) => card.textContent).join("|"), /价格规则已设价格1还没有设1/);
  assert.ok(calls.some((call) => call.path.endsWith("/tenant/v1/price-overview?summary=1")));
  assertAbsent(screen.queryByText(/个商品还没有上架/));

  resetBrowser();
  open("/", "admin", { overview: [overviewOf(), overviewOf({ product_id: "p2" })], summary: { products: { draft: 2, published: 0, unpublished: 0 } } });
  assert.equal((await screen.findByRole("link", { name: "2 个商品还没有上架" })).getAttribute("href"), "/products?status=draft");
  assertAbsent(screen.queryByText(/个商品还没有设价格/));

  resetBrowser();
  open("/", "readonly", { overview: [overviewOf({ has_active_price: false })] });
  await waitFor(() => assert.match([...document.querySelectorAll(".entry-card")].map((card) => card.textContent).join("|"), /价格规则已设价格0还没有设1/));
  assertAbsent(screen.queryByText(/个商品还没有设价格/));

  resetBrowser();
  open("/", "admin", {}, (call) => (call.method === "GET" && call.url.pathname === "/tenant/v1/price-overview" ? apiError(500, "INTERNAL", "boom") : null));
  await waitFor(() => assert.match([...document.querySelectorAll(".entry-card")].find((card) => card.textContent?.includes("价格规则"))?.textContent ?? "", /—/));
  assertAbsent(screen.queryByText("数量没有加载出来", { selector: ".alert__title" }));
});

test("价格表：基础价不是取整单位的整数倍时，读回来的话里说明报价会取整成多少（数来自 domain）", async () => {
  const actor = user();
  open(`/products/${PRODUCT_ID}/prices`, "admin");
  const cell = await screen.findByLabelText(`${ROW} 的基础价`);
  assert.doesNotMatch(document.querySelector(".price-meaning")?.textContent ?? "", /取整单位是/);
  await actor.clear(cell);
  await actor.type(cell, "20050");
  const quoted = applyAdjustRules(exactFromMinor(20050), [], 100).finalMinor;
  await waitFor(() => assert.match(document.querySelector(".price-meaning")?.textContent ?? "", new RegExp(`取整单位是 JPY 100，报价时会取整成 ${jpy(quoted)}。`)));
});

test("价格表的金额格：已经有千分位的数（18,500），键盘进到这一格变回纯数字并全选，直接敲新数是盖掉旧的，不是接在后面；离开后带千分位", async () => {
  const actor = user();
  open(`/products/${PRODUCT_ID}/prices`, "admin", { prices: pricesOf([priceOf({ base_price: 18500, base: "18500" })]) });
  const cell = (await screen.findByLabelText(`${ROW} 的基础价`)) as HTMLInputElement;
  assert.equal(cell.value, "18,500");
  // 先有值 → 聚焦 → 键入 → 失焦
  cell.focus();
  await waitFor(() => assert.equal(cell.value, "18500"));
  assert.deepEqual([cell.selectionStart, cell.selectionEnd], [0, 5], "聚焦后全选，重新渲染以后选中的范围还在");
  await actor.keyboard("9000");
  assert.equal(cell.value, "9000", "新敲的数盖掉旧的");
  await actor.tab();
  assert.equal(cell.value, "9,000");
  assert.match(document.querySelector(".step__summary")?.textContent ?? "", /有 1 条未保存的修改/);
  // 再进来一次、什么都不敲就离开：数不变，也不算又改了一次
  await actor.tab({ shift: true });
  assert.equal(document.activeElement === cell ? cell.value : "9000", "9000");
  await actor.tab();
  assert.equal(cell.value, "9,000");
});
