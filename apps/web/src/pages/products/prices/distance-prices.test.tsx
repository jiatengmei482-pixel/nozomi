/**
 * 点对点 / 接送机商品价格页的「计程价」小块（M8-30b，ADR 0080）：列表、新增、编辑、启停、删除（二次确认）、
 * 409 `DISTANCE_PRICE_CONFLICT` 和 400 的中文、包车不显示、只读角色、规则 4（不出现对外价、加价比例）。
 * 接口用测试替身；真实后端由端到端测试（e2e/distance-prices.spec.ts）覆盖。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../../App.tsx";
import type { DistancePriceBody, DistancePrices, PriceRuleBody, PriceRules } from "../../../api/prices.ts";
import type { Product } from "../../../api/products.ts";
import { type ApiCall, apiError, json, resetBrowser, signIn, stubApiWith } from "../../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T03:04:00.000Z" };
const PRODUCT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const BASE = `/tenant/v1/products/${PRODUCT_ID}`;
const TODAY = "2026-11-11";
const TOKYO = "11111111-1111-4111-8111-111111111111";
const COMFORT = "66666666-6666-4666-8666-666666666666";
const BUSINESS = "77777777-7777-4777-8777-777777777777";
const RULE_ID = "88888888-8888-4888-8888-888888888888";

const productOf = (category: Product["category"]): Product =>
  ({
    id: PRODUCT_ID,
    code: "PRD202611110001",
    status: "draft",
    category,
    title: { zh: "东京市内" },
    brand_id: "b1",
    brand: { id: "b1", name: "NOZOMI", currency: "JPY", status: "active" },
    city_id: "c1",
    city: { id: "c1", code: "CTY-JP-TYO", name: { zh: "东京" }, country_code: "JP", timezone: "Asia/Tokyo", status: "active" },
    poi_id: null,
    poi: null,
    area_count: 1,
    vehicle_group_count: 2,
    version: 7,
    ...stamps,
    areas: [{ area_id: TOKYO, priority: 0, name: { zh: "东京 23 区" }, biz_type: "general", status: "active" }],
    vehicle_groups: [
      { vehicle_group_id: COMFORT, passengers: 4, luggage: 2, code: "VG-CMF-5", name: { zh: "舒适五座" }, grade: "comfort", seats: 5, sample_models: [], combos: [{ passengers: 4, luggage: 2 }], status: "active" },
      { vehicle_group_id: BUSINESS, passengers: 6, luggage: 4, code: "VG-BIZ-7", name: { zh: "商务七座" }, grade: "business", seats: 7, sample_models: [], combos: [{ passengers: 6, luggage: 4 }], status: "active" },
    ],
    dispatchers: [{ name: "山田", phone: "+81 90 1234 5678" }],
  }) as unknown as Product;

const EMPTY = { to_area_id: null, direction: null, package_hours: null, base_price: null, included_km: null, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null, pickup_surcharge: null, dropoff_surcharge: null, valid_to: null, status: "enabled" as const, ...stamps };
const fixed = (id: string, group: string): PriceRuleBody => ({ ...EMPTY, id, area_id: TOKYO, vehicle_group_id: group, pricing_model: "fixed", base_price: 8000, valid_from: "2026-11-01", base: "8000" });
const PRICES: PriceRules = { version: 7, currency: "JPY", rounding_unit: 1, available_models: ["fixed"], surcharge_models: [], today: TODAY, items: [fixed("p1", COMFORT), fixed("p2", BUSINESS)], coverage: { total: 2, priced: 2, missing: 0 } };
const rule = (overrides: Partial<DistancePriceBody> = {}): DistancePriceBody => ({ id: RULE_ID, vehicle_group_id: COMFORT, start_price: 2000, per_km: 300, valid_from: "2026-11-01", valid_to: null, status: "enabled", ...stamps, ...overrides });
const listOf = (items: DistancePriceBody[], version = 7): DistancePrices => ({ version, currency: "JPY", today: TODAY, items });

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;
function open(options: { category?: Product["category"]; role?: string; list?: DistancePrices | null; extra?: Route } = {}): ApiCall[] {
  const { category = "point_to_point", role = "admin", list = listOf([rule()]), extra = () => null } = options;
  signIn("tenant", "tenant-token");
  const calls = stubApiWith((call) => {
    const custom = extra(call);
    if (custom !== null) return custom;
    if (call.method !== "GET") return null;
    const at = call.url.pathname;
    if (at === "/tenant/v1/auth/me") return json(200, { user: { id: "u1", email: "user@supplier.example", name: "测试用户", role, status: "active", ...stamps }, tenant: { id: "t1", name: "测试用供应商", status: "active", ...stamps }, permissions: [], must_change_password: false });
    if (at === BASE) return json(200, productOf(category));
    if (at === `${BASE}/publish-check`) return json(200, { can_publish: true, items: [] });
    if (at === `${BASE}/price-rules`) return json(200, category === "charter" ? { ...PRICES, available_models: ["charter_package"] } : PRICES);
    if (at === `${BASE}/adjust-rules`) return json(200, { version: 7, currency: "JPY", rounding_unit: 1, today: TODAY, items: [] });
    if (at === `${BASE}/distance-prices`) return list === null ? apiError(500, "INTERNAL", "boom") : json(200, list);
    if (at === "/tenant/v1/areas") return json(200, { items: [], next_cursor: null, total: 0 });
    if (at === "/tenant/v1/brands") return json(200, { items: [{ id: "b1", name: "NOZOMI", currency: "JPY", status: "active", version: 4, ...stamps }] });
    if (at === "/tenant/v1/dashboard/summary") return json(200, { areas: { active: 1, disabled: 0 }, products: { draft: 1, published: 0, unpublished: 0 } });
    return null;
  });
  render(
    <MemoryRouter initialEntries={[`/products/${PRODUCT_ID}/prices`]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

const user = () => userEvent.setup();
const block = async (): Promise<HTMLElement> => (await screen.findByRole("heading", { level: 3, name: "计程价" })).closest("section") as HTMLElement;
const writes = (calls: ApiCall[]): ApiCall[] => calls.filter((call) => call.method !== "GET");
const assertNoRetailWords = (): void => assert.doesNotMatch(document.body.textContent ?? "", /对外价|加价比例|markup|sell/i);

test("点对点价格页有「计程价」块：说明、按车型组的起步价 + 每公里、生效日期、启用；规则 4", async () => {
  open();
  const section = await block();
  assert.match(section.textContent ?? "", /两端都不在报价区域时按计程价报价；只有一端在区域内时，区域外那段按这里的每公里单价收里程费；不设则这些情况不报价/);
  const row = await within(section).findByRole("row", { name: /舒适五座/ });
  assert.match(row.textContent ?? "", /JPY 2,000/);
  assert.match(row.textContent ?? "", /JPY 300/);
  assert.match(row.textContent ?? "", /2026-11-01 起，一直有效/);
  assert.equal((within(row).getByRole("switch") as HTMLInputElement).checked, true);
  assertNoRetailWords();
});

test("接送机也有；包车没有这一块", async () => {
  open({ category: "airport_transfer" });
  await block();
  resetBrowser();
  open({ category: "charter", list: listOf([]) });
  await screen.findByRole("heading", { level: 3, name: "基础定价" });
  assert.equal(screen.queryByRole("heading", { level: 3, name: "计程价" }), null);
});

test("空状态说明不设的后果；加载失败可以重试", async () => {
  open({ list: listOf([]) });
  const section = await block();
  await within(section).findByText(/还没有设计程价/);
  resetBrowser();
  open({ list: null });
  const failed = await block();
  assert.ok(await within(failed).findByRole("button", { name: "重试" }));
});

test("新增：校验（必填、都是 0、日期）→ 提交 If-Match 和幂等键、金额是最小单位整数 → 列表多一行、版本号更新", async () => {
  const calls = open({
    list: listOf([]),
    extra: (call) => (call.method === "POST" && call.url.pathname === `${BASE}/distance-prices` ? json(201, { version: 8, distance_price: rule({ id: "99999999-9999-4999-8999-999999999999", vehicle_group_id: BUSINESS, start_price: 0, per_km: 450 }) }) : null),
  });
  const actor = user();
  const section = await block();
  await actor.click(await within(section).findByRole("button", { name: "新增计程价" }));
  const dialog = await screen.findByRole("dialog", { name: "新增计程价" });
  await actor.click(within(dialog).getByRole("button", { name: "新增" }));
  assert.match(dialog.textContent ?? "", /请选车型组/);
  assert.match(dialog.textContent ?? "", /请填起步价，不收起步价填 0/);
  assert.equal(writes(calls).length, 0);
  await actor.selectOptions(within(dialog).getByRole("combobox", { name: /车型组/ }), BUSINESS);
  await actor.type(within(dialog).getByRole("textbox", { name: /起步价/ }), "0");
  await actor.type(within(dialog).getByRole("textbox", { name: /每公里/ }), "0");
  await actor.type(within(dialog).getByRole("textbox", { name: /到（含这一天）/ }), "2026-10-01");
  await actor.click(within(dialog).getByRole("button", { name: "新增" }));
  assert.match(dialog.textContent ?? "", /起步价和每公里不能都是 0/);
  assert.match(dialog.textContent ?? "", /结束日期不能早于开始日期/);
  const perKm = within(dialog).getByRole("textbox", { name: /每公里/ });
  await actor.clear(perKm);
  await actor.type(perKm, "450");
  await actor.clear(within(dialog).getByRole("textbox", { name: /到（含这一天）/ }));
  await actor.click(within(dialog).getByRole("button", { name: "新增" }));
  await waitFor(() => assert.equal(screen.queryByRole("dialog", { name: "新增计程价" }), null));
  const post = writes(calls)[0];
  assert.equal(post?.method, "POST");
  assert.equal(post?.headers["if-match"], '"7"');
  assert.ok(post?.headers["idempotency-key"]);
  assert.deepEqual(post?.body, { vehicle_group_id: BUSINESS, start_price: 0, per_km: 450, valid_from: TODAY, valid_to: null, status: "enabled" });
  assert.ok(await within(section).findByRole("row", { name: /商务七座/ }));
});

test("409 DISTANCE_PRICE_CONFLICT：表单里说哪段日期撞上了，不显示原因代码；400 的原因落到对应的栏", async () => {
  let attempt = 0;
  open({
    extra: (call) => {
      if (call.method !== "POST" || call.url.pathname !== `${BASE}/distance-prices`) return null;
      attempt += 1;
      return attempt === 1
        ? apiError(409, "DISTANCE_PRICE_CONFLICT", "overlap", { conflicts: [{ id: RULE_ID, valid_from: "2026-11-01", valid_to: null }] })
        : apiError(400, "VALIDATION_FAILED", "bad", { issues: [{ path: "/per_km", reason: "OUT_OF_RANGE", message: "超出了允许的范围", detail: { min: 0, max: 100 } }] });
    },
  });
  const actor = user();
  const section = await block();
  await actor.click(await within(section).findByRole("button", { name: "新增计程价" }));
  const dialog = await screen.findByRole("dialog", { name: "新增计程价" });
  await actor.selectOptions(within(dialog).getByRole("combobox", { name: /车型组/ }), COMFORT);
  await actor.type(within(dialog).getByRole("textbox", { name: /起步价/ }), "1500");
  await actor.type(within(dialog).getByRole("textbox", { name: /每公里/ }), "280");
  await actor.click(within(dialog).getByRole("button", { name: "新增" }));
  const alert = await within(dialog).findByRole("alert");
  assert.match(alert.textContent ?? "", /生效日期和这段重叠（2026-11-01 至 一直有效）/);
  assert.doesNotMatch(dialog.textContent ?? "", /DISTANCE_PRICE_CONFLICT/);
  await actor.click(within(dialog).getByRole("button", { name: "新增" }));
  await within(dialog).findByText("金额太大了，请检查是不是多打了几个零");
});

test("编辑用 PUT 带 If-Match；停用立即生效；删除先在页面里确认", async () => {
  const calls = open({
    extra: (call) => {
      if (call.method === "PUT") return json(200, { version: 8, distance_price: rule({ per_km: 350 }) });
      if (call.method === "POST" && call.url.pathname.endsWith("/disable")) return json(200, { version: 9, distance_price: rule({ per_km: 350, status: "disabled" }) });
      if (call.method === "DELETE") return json(200, { version: 10 });
      return null;
    },
  });
  const actor = user();
  const section = await block();
  await actor.click(await within(section).findByRole("button", { name: /^编辑 舒适五座/ }));
  const dialog = await screen.findByRole("dialog", { name: "编辑计程价" });
  const perKm = within(dialog).getByRole("textbox", { name: /每公里/ });
  await actor.clear(perKm);
  await actor.type(perKm, "350");
  await actor.click(within(dialog).getByRole("button", { name: "保存" }));
  await waitFor(() => assert.match(within(section).getByRole("row", { name: /舒适五座/ }).textContent ?? "", /JPY 350/));
  const put = writes(calls)[0];
  assert.equal(put?.path.endsWith(`/distance-prices/${RULE_ID}`), true);
  assert.equal(put?.headers["if-match"], '"7"');
  await actor.click(within(section).getByRole("switch"));
  await waitFor(() => assert.equal((within(section).getByRole("switch") as HTMLInputElement).checked, false));
  assert.ok(writes(calls)[1]?.path.endsWith("/disable"));
  await actor.click(within(section).getByRole("button", { name: /^删除 舒适五座/ }));
  const confirm = await screen.findByRole("dialog", { name: "删除这条计程价？" });
  assert.equal(writes(calls).length, 2, "确认之前不删");
  await actor.click(within(confirm).getByRole("button", { name: "删除" }));
  await within(section).findByText(/还没有设计程价/);
  const del = writes(calls)[2];
  assert.equal(del?.method, "DELETE");
  assert.equal(del?.headers["if-match"], '"9"');
});

test("启用撞上别的生效日期：列表上说清楚", async () => {
  open({ list: listOf([rule({ status: "disabled" })]), extra: (call) => (call.method === "POST" && call.url.pathname.endsWith("/enable") ? apiError(409, "DISTANCE_PRICE_CONFLICT", "overlap", { conflicts: [{ id: "x", valid_from: "2026-12-01", valid_to: "2026-12-31" }] }) : null) });
  const actor = user();
  const section = await block();
  await actor.click(await within(section).findByRole("switch"));
  const alert = await within(section).findByRole("alert");
  await waitFor(() => assert.match(alert.textContent ?? "", /没有启用：这个车型组已经有计程价的生效日期和这段重叠（2026-12-01 至 2026-12-31）/));
});

test("只读角色只看不改", async () => {
  open({ role: "readonly" });
  const section = await block();
  await within(section).findByRole("row", { name: /舒适五座/ });
  assert.equal(within(section).queryByRole("switch"), null);
  assert.equal(within(section).queryByRole("button", { name: "新增计程价" }), null);
});
