/**
 * 供应商后台「商品」的组件测试（测试工程师补，M1-03）。接口用测试替身；真实后端由端到端测试覆盖。
 * 已有的 products.test.tsx 是主干；这里补：「去填」落到的位置、步骤导航和每一步底部「还差几项」的一致、
 * 以及几处会把人卡住的情形。名字以「【缺陷】」开头的是现在会失败的：复现、期望、实际写在测试里。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { AreaSummary } from "../../api/areas.ts";
import type { Addon, City, Place, VehicleGroup } from "../../api/master.ts";
import type { Brand, Product, ProductServiceRules, PublishCheckItemBody, PublishCheckResult, ServiceRulesBody } from "../../api/products.ts";
import { type ApiCall, apiError, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T03:04:00.000Z" };
const CITY_ID = "11111111-1111-4111-8111-111111111111";
const POI_ID = "22222222-2222-4222-8222-222222222222";
const BRAND_ID = "33333333-3333-4333-8333-333333333333";
const AREA_ID = "44444444-4444-4444-8444-444444444444";
const GROUP_ID = "55555555-5555-4555-8555-555555555555";
const ADDON_ID = "66666666-6666-4666-8666-666666666666";
const PRODUCT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BASE = `/tenant/v1/products/${PRODUCT_ID}`;

const tokyo: City = { id: CITY_ID, code: "CTY-JP-TYO", country_code: "JP", name: { zh: "东京" }, timezone: "Asia/Tokyo", center: { lng: 139.7, lat: 35.7 }, boundary: null, status: "active", version: 1, ...stamps };
const haneda = { id: POI_ID, type: "airport", code: "HND", country_code: "JP", city_id: CITY_ID, parent_id: null, city: null, parent: null, name: { zh: "羽田机场" }, location: { lng: 139.78, lat: 35.55 }, category: null, flight_scope: "mixed", address: null, source: null, status: "active", version: 1, ...stamps } as unknown as Place;
const brand: Brand = { id: BRAND_ID, name: "NOZOMI", currency: "JPY", status: "active", version: 1, ...stamps };
const group: VehicleGroup = { id: GROUP_ID, code: "VG-BIZ-7", grade: "business", seats: 7, name: { zh: "商务七座" }, sample_models: ["丰田埃尔法"], power: "fuel", combos: [{ passengers: 6, luggage: 4 }, { passengers: 5, luggage: 5 }], status: "active", version: 1, ...stamps };
const seat: Addon = { id: ADDON_ID, code: "ADD-SEAT", categories: ["airport_transfer", "charter"], charge_unit: "per_item", name: { zh: "儿童座椅" }, description: {}, status: "active", version: 1, ...stamps };
const area = { id: AREA_ID, name: { zh: "东京 23 区" }, city_id: CITY_ID, city: { id: CITY_ID, code: tokyo.code, name: tokyo.name, status: "active", center: tokyo.center, boundary: null }, biz_type: "general", status: "active", operate_polygon_count: 1, forbid_polygon_count: 0, usage: { product_count: 0, published_product_count: 0 }, version: 1, ...stamps } as unknown as AreaSummary;
const productOf = (overrides: Partial<Product> = {}): Product =>
  ({
    id: PRODUCT_ID,
    code: "PRD202610081430050001",
    status: "draft",
    category: "airport_transfer",
    title: { zh: "羽田机场接送" },
    brand_id: BRAND_ID,
    brand: { id: BRAND_ID, name: "NOZOMI", currency: "JPY", status: "active" },
    city_id: CITY_ID,
    city: { id: CITY_ID, code: tokyo.code, name: tokyo.name, country_code: "JP", timezone: "Asia/Tokyo", status: "active" },
    poi_id: POI_ID,
    poi: { id: POI_ID, code: "HND", name: { zh: "羽田机场" }, type: "airport", flight_scope: "mixed", status: "active" },
    area_count: 1,
    vehicle_group_count: 1,
    version: 7,
    published_at: null,
    ...stamps,
    areas: [{ area_id: AREA_ID, priority: 0, name: { zh: "东京 23 区" }, biz_type: "general", status: "active" }],
    vehicle_groups: [{ vehicle_group_id: GROUP_ID, passengers: 6, luggage: 4, code: group.code, name: group.name, grade: "business", seats: 7, sample_models: group.sample_models, combos: group.combos, status: "active" }],
    dispatchers: [{ name: "山田", phone: "+81 90 1234 5678" }],
    ...overrides,
  }) as Product;
const emptyRules: ServiceRulesBody = { booking: { sale_from: null, sale_to: null, service_time: null, lead_time_hours: null, note: null }, urgent: { enabled: false, daily_quota: null, tiers: [] }, night: { enabled: false, window: null, amount: null, charge_unit: null }, free_wait: { pickup: null, dropoff: null, general: null }, addons: [], driver_languages: [] };
const completeRules: ServiceRulesBody = { ...emptyRules, booking: { sale_from: null, sale_to: null, service_time: { start: "06:00", end: "23:00" }, lead_time_hours: 24, note: null }, free_wait: { pickup: { mode: "limited", minutes: 60 }, dropoff: { mode: "limited", minutes: 15 }, general: null } };
const rulesOf = (rules: Partial<ServiceRulesBody> = {}, version = 7): ProductServiceRules => ({ version, currency: "JPY", free_wait_minimums: { pickup: 60, dropoff: 15, general: null }, rules: { ...emptyRules, ...rules } });
const item = (key: string, issues: { path: string; reason: string }[] = [], required = true): PublishCheckItemBody => ({ key, required, passed: issues.length === 0, issues: issues.map((issue) => ({ ...issue, message: "说明" })) });
const checkOf = (changes: Record<string, { path: string; reason: string }[]> = {}): PublishCheckResult => {
  const items = [item("basic_info", changes["basic_info"]), item("service_rules", changes["service_rules"]), item("price_rules", [{ path: "/", reason: "FEATURE_NOT_AVAILABLE" }]), item("content", changes["content"]), item("adjust_rules", [], false), item("inventory", [], false)];
  return { can_publish: false, items };
};
const page = <T,>(items: T[]) => json(200, { items, next_cursor: null, total: items.length });

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;
interface World {
  product?: Product;
  check?: PublishCheckResult;
  rules?: ProductServiceRules;
  content?: Record<string, unknown>;
  addons?: Addon[];
}

function open(path: string, world: World = {}, routes: Route = () => null): ApiCall[] {
  signIn("tenant", "tenant-token");
  const calls = stubApiWith((call) => {
    const custom = routes(call);
    if (custom !== null) return custom;
    const at = call.url.pathname;
    if (call.method !== "GET") return null;
    if (at === "/tenant/v1/auth/me") return json(200, { user: { id: "u1", email: "user@supplier.example", name: "测试用户", role: "admin", status: "active", ...stamps }, tenant: { id: "t1", name: "测试用供应商", status: "active", ...stamps }, permissions: [], must_change_password: false });
    if (at === "/tenant/v1/dashboard/summary") return json(200, { areas: { active: 1, disabled: 0 }, products: { draft: 1, published: 0, unpublished: 0 } });
    if (at === "/tenant/v1/master/cities") return page([tokyo]);
    if (at === "/tenant/v1/master/places") return page([haneda]);
    if (at === "/tenant/v1/master/vehicle-groups") return page([group]);
    if (at === "/tenant/v1/master/addons") return page(world.addons ?? [seat]);
    if (at === "/tenant/v1/brands") return json(200, { items: [brand] });
    if (at === "/tenant/v1/areas") return page([area]);
    if (at === "/tenant/v1/map/config") return json(200, { tiles: null });
    if (at === BASE) return json(200, world.product ?? productOf());
    if (at === `${BASE}/publish-check`) return json(200, world.check ?? checkOf());
    if (at === `${BASE}/service-rules`) return json(200, world.rules ?? rulesOf());
    if (at === `${BASE}/content`) return json(200, { version: 7, content: world.content ?? { zh: { title: "羽田机场接送", summary: null, includes: [], excludes: [], itinerary: null, pickup_guide: "2 号出口" } } });
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
const summaryText = (): string => document.querySelector(".step__summary")?.textContent ?? "";
const user = () => userEvent.setup();

test("上架检查里每一条「去填」都落得到地方：链接指向的步骤里有那个位置，打开后焦点就在那个位置里，并显示「上架前要填这一项」一类的提示", async () => {
  const check = checkOf({
    basic_info: [{ path: "/areas", reason: "NO_AREA" }, { path: "/vehicle_groups", reason: "NO_VEHICLE_GROUP" }, { path: "/dispatchers", reason: "NO_DISPATCHER" }],
    service_rules: [
      { path: "/booking/service_time", reason: "REQUIRED" }, { path: "/booking/lead_time_hours", reason: "REQUIRED" }, { path: "/urgent/tiers", reason: "REQUIRED" }, { path: "/night/window", reason: "REQUIRED" },
      { path: "/free_wait/pickup", reason: "REQUIRED" }, { path: "/addons/0/addon_id", reason: "ADDON_DISABLED" },
    ],
    content: [{ path: "/title", reason: "REQUIRED" }],
  });
  const world: World = {
    product: productOf({ title: {}, areas: [], vehicle_groups: [], dispatchers: [], area_count: 0, vehicle_group_count: 0 }),
    check,
    rules: rulesOf({ urgent: { enabled: true, daily_quota: null, tiers: [] }, night: { enabled: true, window: null, amount: null, charge_unit: null }, addons: [{ addon_id: ADDON_ID, enabled: true, unit_price: 100, first_free: false }] }),
    content: {},
    addons: [{ ...seat, status: "disabled" }],
  };
  open(`/products/${PRODUCT_ID}/publish`, world);
  await screen.findByText("还不能上架：还有 3 项要补");
  const links = [...document.querySelectorAll<HTMLAnchorElement>('.checklist-card a[href*="#"], [data-check] a[href*="#"]')].map((link) => link.getAttribute("href") ?? "");
  const targets = [...new Set(links)].sort();
  assert.deepEqual(targets, ["basic#areas", "basic#dispatchers", "basic#vehicle-groups", "content#title", "service-rules#addons", "service-rules#free-wait", "service-rules#lead-time", "service-rules#night", "service-rules#service-time", "service-rules#urgent"].map((tail) => `/products/${PRODUCT_ID}/${tail}`));
  for (const href of targets) {
    resetBrowser();
    open(href, world);
    const anchor = href.split("#")[1] as string;
    await waitFor(() => {
      const node = document.getElementById(anchor);
      assert.ok(node, `${href}：页面上没有 id="${anchor}" 的位置`);
      const active = document.activeElement;
      assert.ok(active !== null && active !== document.body && node.contains(active), `${href}：焦点应该在「${anchor}」里，实际在 <${active?.tagName.toLowerCase()}> ${active?.getAttribute("aria-label") ?? active?.textContent?.slice(0, 20) ?? ""}`);
    });
    // 免费等待是页面替用户填好、等他确认保存的，提示是另一句；被停用的附加服务旁边是「上架前请取消勾选」
    const expectedHint = anchor === "free-wait" ? /确认后点保存才会存下来/ : /上架前/;
    assert.match(document.getElementById(anchor)?.closest("section, fieldset, .field, .step__cards")?.textContent ?? "", expectedHint, `${href}：有提示告诉用户这里要补什么`);
  }
  // 接送机缺接机指引：四种语言各自的输入框
  for (const language of ["zh", "ja", "en", "ko"]) {
    resetBrowser();
    const content = { [language]: { title: "有标题", summary: null, includes: [], excludes: [], itinerary: null, pickup_guide: null } };
    open(`/products/${PRODUCT_ID}/content#pickup-guide-${language}`, { ...world, content, check: checkOf({ content: [{ path: `/${language}/pickup_guide`, reason: "REQUIRED" }] }) });
    await waitFor(() => assert.equal(document.activeElement?.id, `pickup-guide-${language}`, `${language}：焦点在接机指引的输入框上`));
    assert.equal(document.activeElement?.getAttribute("lang") !== null, true);
  }
});

test("步骤导航的完成度取自上架检查：每一步「还差 N 项」的 N 就是上架检查里这一项列出来的原因条数；都通过时是「已完成」；检查说没通过时不会显示成完成", async () => {
  const cases: [Record<string, { path: string; reason: string }[]>, [string, string, string]][] = [
    [{}, ["已完成", "已完成", "已完成"]],
    [{ basic_info: [{ path: "/areas", reason: "NO_AREA" }, { path: "/dispatchers", reason: "NO_DISPATCHER" }] }, ["还差 2 项", "已完成", "已完成"]],
    [{ basic_info: [{ path: "/areas/0", reason: "AREA_DISABLED" }, { path: "/areas/1", reason: "AREA_DISABLED" }, { path: "/areas/2", reason: "AREA_NOT_USABLE" }] }, ["还差 2 项", "已完成", "已完成"]],
    [{ service_rules: [{ path: "/booking/service_time", reason: "REQUIRED" }, { path: "/night/window", reason: "REQUIRED" }, { path: "/night/amount", reason: "REQUIRED" }, { path: "/free_wait/pickup", reason: "REQUIRED" }, { path: "/free_wait/dropoff", reason: "REQUIRED" }] }, ["已完成", "还差 3 项", "已完成"]],
    [{ content: [{ path: "/zh/pickup_guide", reason: "REQUIRED" }, { path: "/ja/pickup_guide", reason: "REQUIRED" }] }, ["已完成", "已完成", "还差 2 项"]],
    [{ service_rules: [{ path: "/booking/sale_to", reason: "DATE_RANGE_REVERSED" }] }, ["已完成", "还差 1 项", "已完成"]],
    [{ basic_info: [{ path: "/city_id", reason: "CITY_DISABLED" }] }, ["还差 1 项", "已完成", "已完成"]],
  ];
  for (const [changes, expected] of cases) {
    resetBrowser();
    // 价格规则已经开放：这里摆成真实会出现的「还没有设价格」
    const base = checkOf(changes);
    const check = { ...base, items: base.items.map((entry) => (entry.key === "price_rules" ? item("price_rules", [{ path: "/", reason: "NO_ACTIVE_PRICE_RULE" }]) : entry)) };
    open(`/products/${PRODUCT_ID}/publish`, { check });
    await screen.findByRole("heading", { level: 2, name: "上架检查" });
    await waitFor(() => assert.deepEqual(["基础信息", "服务规则", "商品详情"].map((name) => /已完成|还差 \d+ 项/.exec(stepText(name))?.[0]), expected, JSON.stringify(changes)));
    // 价格规则、库存都已开放：价格这一项没通过（还没有设价格）就是「还差 1 项」，库存不是必须的、默认算完成
    assert.match(stepText("价格规则"), /还差 1 项/);
    assert.match(stepText("库存"), /已完成/);
    for (const [index, key] of (["basic_info", "service_rules", "content"] as const).entries()) {
      const card = document.querySelector(`[data-check="${key}"]`) as HTMLElement;
      const listed = card.querySelectorAll(".checklist__reasons > li").length;
      assert.equal(expected[index] === "已完成" ? 0 : Number(/\d+/.exec(expected[index] as string)?.[0]), listed, `${key}：导航上的个数 = 清单里的原因条数`);
    }
    const done = expected.filter((text) => text === "已完成").length;
    assert.match(document.querySelector(".step-nav")?.textContent ?? "", new RegExp(`已完成 ${done + 1} / 5`));
  }
});

test("【缺陷】每一步底部的「这一步已完成 / 还差 N 项」应该和步骤导航（上架检查）说的一样——勾着的附加服务被平台停用时，导航说服务规则「还差 1 项」，底部却说「这一步已完成」", async () => {
  // 复现：商品的服务规则里勾着附加服务「儿童座椅」，平台把它停用了；打开 ② 服务规则。
  // 期望：左边步骤导航和这一步底部说的一样（都是还差 1 项），点底部的「还差 1 项」能带到那个附加服务。
  // 实际：导航（取自上架检查）说「还差 1 项」，底部（页面自己算，只数没填的必填项）说「这一步已完成」。
  const check = checkOf({ service_rules: [{ path: "/addons/0/addon_id", reason: "ADDON_DISABLED" }] });
  open(`/products/${PRODUCT_ID}/service-rules`, { check, rules: rulesOf({ ...completeRules, addons: [{ addon_id: ADDON_ID, enabled: true, unit_price: 1000, first_free: false }] }), addons: [{ ...seat, status: "disabled" }] });
  await screen.findByText("上架前请取消勾选。");
  await waitFor(() => assert.match(stepText("服务规则"), /还差 1 项/));
  assert.doesNotMatch(summaryText(), /这一步已完成/, `步骤导航说「${/还差 \d+ 项/.exec(stepText("服务规则"))?.[0]}」，底部却说「${summaryText()}」`);
});

test("【缺陷】平台把附加服务从「按个」改成别的计费方式之后，原来勾了「第一个免费」的商品应该还能在页面上保存服务规则", async () => {
  // 复现：商品开着「儿童座椅」（按个计费）并勾了「第一个免费」；平台把这个附加服务改成按次计费。供应商打开 ② 服务规则，改一下备注，点保存。
  // 期望：能保存——「第一个免费」已经不适用（页面也不再显示这个勾选框），提交时不该再带 first_free: true。
  // 实际：勾选框不显示了，但提交的内容里仍然是 first_free: true，后端按「只有按个计费的可以设」拒绝（400）。
  //       页面上没有任何地方可以把它取消，这个商品的服务规则从此存不了（除非先取消这个附加服务、保存、刷新、再勾回来）。
  const actor = user();
  const rules = rulesOf({ ...completeRules, addons: [{ addon_id: ADDON_ID, enabled: true, unit_price: 1000, first_free: true }] });
  const calls = open(`/products/${PRODUCT_ID}/service-rules`, { rules, addons: [{ ...seat, charge_unit: "per_order" }] }, (call) => {
    if (call.method !== "PUT" || call.path !== `${BASE}/service-rules`) return null;
    const body = call.body as ServiceRulesBody;
    // 和真实后端同一条规则：只有按个计费的附加服务可以设「首个免费」
    if (body.addons.some((addon) => addon.first_free)) return apiError(400, "VALIDATION_FAILED", "请求参数校验未通过", { issues: [{ path: "/addons/0/first_free", reason: "NOT_APPLICABLE", message: "只有按个计费的附加服务（如儿童座椅）可以设「首个免费」" }] });
    return json(200, rulesOf(body, 8));
  });
  await screen.findByLabelText("儿童座椅的单价");
  assert.equal(screen.queryByRole("checkbox", { name: /第一个免费/ }), null, "前提：按次计费的附加服务没有「第一个免费」可勾");
  await actor.type(screen.getByLabelText(/备注/), "只加了一句备注");
  await actor.click(screen.getByRole("button", { name: "保存草稿" }));
  await waitFor(() => assert.equal(writes(calls).length, 1));
  const sent = writes(calls)[0]?.body as ServiceRulesBody;
  assert.equal(sent.addons[0]?.first_free, false, "页面上已经没有这个勾选框，提交时却还带着 first_free: true，保存被后端拒绝，用户没有办法取消它");
});

test("【缺陷】提前预订时长用全角数字填（日文输入法默认就是全角）时，下面读回来的话应该照常算——提交出去的是 24，读回来的话却说「先填上面的提前预订时长」", async () => {
  // 复现：② 服务规则里「提前预订时长」填全角的「２４」，勾「允许加急预订」，填一档「6 小时 / 5000」。
  // 期望：和填半角「24」一样：显示「= 1 天」，加急阶梯读回「提前不足 6 小时下单：加收 JPY 5,000」，并提示 6 到 24 小时的空档。
  //       （时间、金额、每日加急库存这些输入框都认全角数字；保存时这一格也是按 24 提交的。）
  // 实际：读回来的话停在「先填上面的提前预订时长，这里会算出每一段怎么收。」，空档提醒不出现——页面上最重要的防错文字在这种输入下失效。
  const actor = user();
  let saved: ServiceRulesBody | null = null;
  open(`/products/${PRODUCT_ID}/service-rules`, {}, (call) => {
    if (call.method !== "PUT") return null;
    saved = call.body as ServiceRulesBody;
    return json(200, rulesOf(saved, 8));
  });
  await screen.findByLabelText("提前预订时长（小时）");
  await actor.click(screen.getByRole("checkbox", { name: "全天 24 小时" }));
  await actor.type(screen.getByLabelText("提前预订时长（小时）"), "２４");
  await actor.click(screen.getByRole("checkbox", { name: "允许加急预订" }));
  await actor.type(screen.getByLabelText("第 1 档：提前不足多少小时"), "6");
  await actor.type(screen.getByLabelText("第 1 档：加收的金额"), "5000");
  await actor.click(screen.getByRole("button", { name: "保存草稿" }));
  await screen.findByText("已保存");
  assert.equal((saved as ServiceRulesBody | null)?.booking.lead_time_hours, 24, "前提：页面是把全角的２４当 24 提交的");
  resetBrowser();
  open(`/products/${PRODUCT_ID}/service-rules`);
  await screen.findByLabelText("提前预订时长（小时）");
  await actor.type(screen.getByLabelText("提前预订时长（小时）"), "２４");
  await actor.click(screen.getByRole("checkbox", { name: "允许加急预订" }));
  await actor.type(screen.getByLabelText("第 1 档：提前不足多少小时"), "6");
  await actor.type(screen.getByLabelText("第 1 档：加收的金额"), "5000");
  const readback = document.querySelector("#urgent-body .readback")?.textContent ?? "";
  assert.match(readback, /提前不足 6 小时下单：加收 JPY 5,000/, `读回来的话是：「${readback}」`);
});

test("【缺陷】新建商品时第一次保存其实成功了但应答没收到（断网），改一处再保存——不应该从此卡在「系统暂时无法保存」，而应该接上已经建好的那个草稿", async () => {
  // 复现：新建页填好点「保存草稿」，请求到了后端并建成了草稿，但应答在路上丢了（页面提示网络失败）；用户改了一处（比如调度人电话）再点保存。
  // 期望：ADR 0015 为这种情况准备了 details.created（那一条的编号和版本号）：页面应该转到已经建好的那个草稿（或至少告诉用户草稿已经建好、给出链接）。
  // 实际：这一页的幂等键从打开起就固定不变，内容一改后端就回 422 IDEMPOTENCY_KEY_REUSED；页面把它当「服务器出错」，
  //       显示「系统暂时无法保存，请稍后再试。」——之后怎么点都是这句话，而列表里已经多了一个没人知道的草稿。
  const actor = user();
  const CREATED = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const posts: ApiCall[] = [];
  const created = productOf({ id: CREATED, title: {}, version: 1 });
  open("/products/new", {}, (call) => {
    if (call.method === "POST" && call.path === "/tenant/v1/products") {
      posts.push(call);
      // 第一次：后端建成了，应答丢了。之后：同一个键、内容不同 → 422，带着建成的那一条
      if (posts.length === 1) return Promise.reject(new TypeError("fetch failed"));
      return JSON.stringify(call.body) === JSON.stringify(posts[0]?.body) ? json(201, created) : apiError(422, "IDEMPOTENCY_KEY_REUSED", "这个 Idempotency-Key 上一次已经创建成功", { created: { id: CREATED, version: 1 } });
    }
    const at = call.url.pathname;
    if (call.method === "GET" && at === `/tenant/v1/products/${CREATED}`) return json(200, created);
    if (call.method === "GET" && at === `/tenant/v1/products/${CREATED}/publish-check`) return json(200, checkOf());
    if (call.method === "PATCH" && at === `/tenant/v1/products/${CREATED}`) return json(200, { ...created, version: 2, dispatchers: (call.body as { dispatchers: Product["dispatchers"] }).dispatchers });
    return null;
  });
  const cityBox = await screen.findByRole("combobox", { name: /城市/ });
  await actor.click(cityBox);
  await actor.click(await screen.findByRole("option", { name: /东京/ }));
  await actor.click(screen.getByRole("radio", { name: /^包车/ }));
  await actor.type(screen.getByLabelText("第 1 个调度人的姓名"), "山田");
  await actor.type(screen.getByLabelText("第 1 个调度人的电话"), "0312345678");
  await actor.click(screen.getByRole("button", { name: "保存草稿" }));
  await screen.findByText("网络连接失败，请检查网络后重试。你填写的内容还在。");
  await actor.clear(screen.getByLabelText("第 1 个调度人的电话"));
  await actor.type(screen.getByLabelText("第 1 个调度人的电话"), "0398765432");
  await actor.click(screen.getByRole("button", { name: "保存草稿" }));
  await waitFor(() => assert.equal(posts.length, 2));
  assert.equal(posts[1]?.headers["idempotency-key"], posts[0]?.headers["idempotency-key"], "前提：两次提交用的是同一个幂等键");
  await waitFor(() => {
    const stuck = /系统暂时无法保存/.test(document.body.textContent ?? "");
    const reachesCreated = document.querySelector(`a[href*="${CREATED}"]`) !== null;
    assert.ok(reachesCreated && !stuck, `草稿 ${CREATED} 已经建好，页面却显示：「${document.querySelector(".step__alerts")?.textContent ?? ""}」，也没有任何去那个草稿的入口`);
  });
});

test("版本冲突之后（② 服务规则）：保存停用并说明；点「载入最新内容」换上别人存的内容和新版本号，之后的保存带新的 If-Match", async () => {
  const actor = user();
  let version = 7;
  let stored: ServiceRulesBody = { ...completeRules };
  const calls = open(`/products/${PRODUCT_ID}/service-rules`, {}, (call) => {
    if (call.path === `${BASE}/service-rules` && call.method === "GET") return json(200, rulesOf(stored, version));
    if (call.path === BASE && call.method === "GET") return json(200, productOf({ version }));
    if (call.path === `${BASE}/service-rules` && call.method === "PUT") {
      if (call.headers["if-match"] !== `"${version}"`) return apiError(409, "VERSION_CONFLICT", "版本号不是最新的", { current_version: version });
      stored = call.body as ServiceRulesBody;
      version += 1;
      return json(200, rulesOf(stored, version));
    }
    return null;
  });
  await waitFor(() => assert.equal((screen.getByLabelText("提前预订时长（小时）") as HTMLInputElement).value, "24"));
  // 别人先存了一次：提前时长改成 48，版本号 8
  stored = { ...completeRules, booking: { ...completeRules.booking, lead_time_hours: 48 } };
  version = 8;
  await actor.type(screen.getByLabelText(/备注/), "我的修改");
  await actor.click(screen.getByRole("button", { name: "保存草稿" }));
  await screen.findByText("这个商品刚被别人修改过，你在这一步的修改还没有保存。");
  assert.equal((screen.getByRole("button", { name: "保存草稿" }) as HTMLButtonElement).disabled, true);
  assert.equal((screen.getByRole("button", { name: "保存并下一步" }) as HTMLButtonElement).disabled, true);
  assert.match(summaryText(), /请先载入最新内容/);
  assert.equal((screen.getByLabelText(/备注/) as HTMLTextAreaElement).value, "我的修改", "自己填的还在，方便抄下来");
  await actor.click(screen.getByRole("button", { name: "载入最新内容" }));
  await screen.findByText("已载入最新内容。");
  await waitFor(() => assert.equal((screen.getByLabelText("提前预订时长（小时）") as HTMLInputElement).value, "48"));
  assert.equal((screen.getByLabelText(/备注/) as HTMLTextAreaElement).value, "");
  assert.doesNotMatch(summaryText(), /有未保存的修改/);
  await actor.type(screen.getByLabelText(/备注/), "再改一次");
  await actor.click(screen.getByRole("button", { name: "保存草稿" }));
  await screen.findByText("已保存");
  const puts = writes(calls);
  assert.deepEqual(puts.map((call) => call.headers["if-match"]), ['"7"', '"8"']);
  assert.deepEqual([(puts[1]?.body as ServiceRulesBody).booking.lead_time_hours, (puts[1]?.body as ServiceRulesBody).booking.note], [48, "再改一次"]);
});

test("创建后锁定的四项在编辑页是只读的文字、没有任何输入控件；保存时也不会把它们带出去", async () => {
  const actor = user();
  const calls = open(`/products/${PRODUCT_ID}/basic`, {}, (call) => (call.method === "PATCH" && call.path === BASE ? json(200, productOf({ version: 8, dispatchers: [{ name: "佐藤", phone: "+81 90 1234 5678" }] })) : null));
  const card = (await screen.findByText("这几项创建后不能修改。要换，请新建一个商品。")).closest("section") as HTMLElement;
  assert.deepEqual([...card.querySelectorAll("dt")].map((node) => node.textContent), ["子品牌", "品类", "城市", "接送点"]);
  assert.deepEqual([...card.querySelectorAll("dd")].map((node) => node.textContent), ["NOZOMI（JPY）", "接送机", "东京（日本（JP））", "羽田机场（HND）"]);
  assert.equal(card.querySelectorAll("input, select, textarea, button, [role=combobox]").length, 0, "没有任何可以改的控件");
  await actor.clear(screen.getByLabelText("第 1 个调度人的姓名"));
  await actor.type(screen.getByLabelText("第 1 个调度人的姓名"), "佐藤");
  await actor.click(screen.getByRole("button", { name: "保存草稿" }));
  await screen.findByText("已保存");
  assert.deepEqual(Object.keys(writes(calls)[0]?.body as object).sort(), ["areas", "dispatchers", "vehicle_groups"]);
  // 包车没有接送点这一行
  resetBrowser();
  open(`/products/${PRODUCT_ID}/basic`, { product: productOf({ category: "charter", poi_id: null, poi: null }) });
  const charter = (await screen.findByText("这几项创建后不能修改。要换，请新建一个商品。")).closest("section") as HTMLElement;
  assert.deepEqual([...charter.querySelectorAll("dt")].map((node) => node.textContent), ["子品牌", "品类", "城市"]);
  assert.equal(within(charter).queryByText("接送点"), null);
});
