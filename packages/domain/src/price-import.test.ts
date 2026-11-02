/**
 * 价格表导入第 1 阶段（ADR 0062）：官网显示价的正向计算和倒算、导入范围、方向、归属、批次撤回。
 * 所有名称、价格都是虚构的，不来自真实价格表。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type PriceImportMapping,
  type PriceSheetCountry,
  type PriceSheetNotes,
  type SitePriceRules,
  PriceImportError,
  defaultPriceImportVehicle,
  groupPriceImport,
  inverseSitePrice,
  parsePriceImportMapping,
  parsePriceImportTarget,
  planPriceImportRevert,
  planPriceSheetImport,
  priceImportBatchIssue,
  priceImportBatchLabel,
  priceImportBrandName,
  priceImportExclusion,
  pricePriceImportCells,
  sellPrice,
  siteDisplayPrice,
} from "./index.ts";

const rules = (overrides: Partial<SitePriceRules> = {}): SitePriceRules => ({ currency: "JPY", brandRoundingUnit: 1, markupBp: 1_000, markupFloorBp: 1_000, minMarginMinor: 0, sellRoundingUnit: 1, ...overrides });

// ---- 正向 ----

test("正向：显示价和报价引擎的 sellPrice 一致（结算价 × 1.1，四舍五入到日元）", () => {
  assert.deepEqual(siteDisplayPrice(10_000, rules()), { settlementMinor: 10_000, displayMinor: 11_000 });
  assert.deepEqual(siteDisplayPrice(10_005, rules()), { settlementMinor: 10_005, displayMinor: 11_006 });
  const engine = sellPrice({ settlementMinor: 10_005, settlementCurrency: "JPY", currency: "JPY", markupBp: 1_000, markupFloorBp: 1_000, fx: null, channel: { minMargin: null, roundingUnit: 1 } });
  assert.ok(!("failure" in engine));
  assert.equal(engine.sellMinor, 11_006);
});

test("正向：子品牌取整单位先作用在结算价上，渠道取整单位向上取整对外价，加价低于下限按下限", () => {
  assert.deepEqual(siteDisplayPrice(10_049, rules({ brandRoundingUnit: 100 })), { settlementMinor: 10_000, displayMinor: 11_000 });
  assert.deepEqual(siteDisplayPrice(10_001, rules({ sellRoundingUnit: 100 })), { settlementMinor: 10_001, displayMinor: 11_100 });
  assert.deepEqual(siteDisplayPrice(10_000, rules({ markupBp: 500, markupFloorBp: 1_200 })), { settlementMinor: 10_000, displayMinor: 11_200 });
});

test("正向：最低毛利补足；结算价取整后不大于 0 的报不出", () => {
  assert.deepEqual(siteDisplayPrice(1_000, rules({ minMarginMinor: 500 })), { settlementMinor: 1_000, displayMinor: 1_500 });
  assert.equal(siteDisplayPrice(40, rules({ brandRoundingUnit: 100 })), null);
});

test("正向：子品牌币种和渠道币种不同时拒绝（跨币种要汇率，显示价每天变，导入不处理）", () => {
  assert.throws(() => siteDisplayPrice(1_000, rules({ currency: "CNY", channelCurrency: "JPY" })), PriceImportError);
});

// ---- 倒算 ----

test("倒算：能正好对上时取对得上的最大结算价，正向再算一遍等于表上价", () => {
  const result = inverseSitePrice(11_000, rules());
  assert.equal(result.status, "exact");
  assert.equal(result.baseMinor, 10_000);
  assert.equal(result.displayMinor, 11_000);
  assert.equal(result.diffMinor, 0);
  // 11,001 / 1.1 = 10,000.9…：10,001 × 1.1 = 11,001.1 → 11,001
  const odd = inverseSitePrice(11_001, rules());
  assert.equal(odd.status, "exact");
  assert.equal(odd.baseMinor, 10_001);
});

test("倒算：渠道向上取整到 100 时，同一显示价对应一段结算价，取最大的（加价最接近设定比例）", () => {
  const result = inverseSitePrice(11_000, rules({ sellRoundingUnit: 100 }));
  assert.equal(result.status, "exact");
  assert.equal(result.baseMinor, 10_000);
  // 9,910 × 1.1 = 10,901 → 11,000；10,000 × 1.1 = 11,000；10,001 × 1.1 = 11,001.1 → 11,100
  assert.equal(siteDisplayPrice(10_001, rules({ sellRoundingUnit: 100 }))?.displayMinor, 11_100);
});

test("倒算：表上价不是取整单位的倍数时对不上，取显示价不超过表上价的那一档，列出差额和原因，不硬凑", () => {
  const result = inverseSitePrice(11_050, rules({ sellRoundingUnit: 100 }));
  assert.equal(result.status, "below");
  assert.equal(result.displayMinor, 11_000);
  assert.equal(result.diffMinor, -50);
  assert.equal(result.baseMinor, 10_000);
  assert.equal(result.reason, "SELL_ROUNDING");
  assert.equal(result.next?.displayMinor, 11_100);
});

test("倒算：加价 10% 四舍五入到日元时有显示价是跳过去的（每 11 日元里有 1 个对不上）", () => {
  // 结算价每加 1 日元，显示价加 1.1：1,000 → 1,100，1,001 → 1,101.1 → 1,101 …… 1,004 → 1,104.4 → 1,104，1,005 → 1,105.5 → 1,106
  assert.equal(inverseSitePrice(1_105, rules()).status, "below");
  assert.equal(inverseSitePrice(1_105, rules()).reason, "MARKUP_STEP");
  assert.equal(inverseSitePrice(1_106, rules()).status, "exact");
  let misses = 0;
  for (let target = 1_100; target < 1_210; target += 1) if (inverseSitePrice(target, rules()).status !== "exact") misses += 1;
  assert.equal(misses, 10);
});

test("倒算：表上价比最低毛利还低时报不出，不导入", () => {
  const result = inverseSitePrice(400, rules({ minMarginMinor: 500 }));
  assert.equal(result.status, "impossible");
  assert.equal(result.baseMinor, null);
  assert.equal(result.reason, "BELOW_MINIMUM");
});

test("倒算：最低毛利起作用的区间里也能对上（显示价 = 结算价 + 最低毛利）", () => {
  const result = inverseSitePrice(1_400, rules({ minMarginMinor: 500 }));
  assert.equal(result.status, "exact");
  assert.equal(result.baseMinor, 900);
});

test("倒算：子品牌取整单位大于 1 时只取它的倍数作结算价", () => {
  const result = inverseSitePrice(11_000, rules({ brandRoundingUnit: 100 }));
  assert.equal(result.status, "exact");
  assert.equal((result.baseMinor as number) % 100, 0);
  const miss = inverseSitePrice(11_050, rules({ brandRoundingUnit: 100 }));
  assert.equal(miss.status, "below");
  assert.equal(miss.reason, "BRAND_ROUNDING");
});

test("倒算：任意表上价都满足「正向显示价 ≤ 表上价」且下一档 > 表上价（对不上的不往上凑）", () => {
  for (const sell of [1, 10, 100, 1_000]) {
    for (const markupBp of [1_000, 1_250, 3_333]) {
      for (let target = 2_000; target < 2_400; target += 7) {
        const r = rules({ sellRoundingUnit: sell, markupBp });
        const result = inverseSitePrice(target, r);
        assert.notEqual(result.status, "impossible");
        assert.equal(siteDisplayPrice(result.baseMinor as number, r)?.displayMinor, result.displayMinor);
        assert.ok((result.displayMinor as number) <= target);
        assert.ok((siteDisplayPrice((result.baseMinor as number) + 1, r)?.displayMinor as number) > target);
      }
    }
  }
});

test("倒算：金额只接受正的安全整数", () => {
  assert.throws(() => inverseSitePrice(0, rules()), RangeError);
  assert.throws(() => inverseSitePrice(1.5, rules()), RangeError);
});

// ---- 范围和方向 ----

const notes: PriceSheetNotes = { reverseSamePrice: true, startKilometers: 10, declaredRoutes: [] };
const CAP4 = { passengers: 4, luggage: 2 };
const CAP6 = { passengers: 6, luggage: 4 };

function country(routes: [string, string, (number | null)[]][]): PriceSheetCountry {
  return {
    sheet: "日本",
    countryCode: "JP",
    columns: [
      { column: 2, ref: "日本!C1", name: "Economy 5 Seater", capacity: CAP4 },
      { column: 3, ref: "日本!D1", name: "Economy 7 Seater", capacity: CAP6 },
    ],
    routes: routes.map(([from, to, prices], index) => ({ row: index + 3, from, to, prices, invalidCells: 0 })),
  };
}

const mapping = (overrides: Partial<{ airports: Record<string, string | null>; regions: Record<string, unknown>; vehicles: Record<string, string | null> }> = {}): PriceImportMapping =>
  parsePriceImportMapping({
    airports: { 甲机场: "AAA", 乙空港: "BBB", ...overrides.airports },
    regions: { 一号地区: { lat: 35.1, lng: 139.1, radius_m: 10_000 }, 二号地区: { lat: 35.2, lng: 139.2, radius_m: 15_000 }, 三号地区: null, ...overrides.regions },
    vehicles: { "Economy 5 Seater": "VG-ECO-5", "Economy 7 Seater": "VG-ECO-7", ...overrides.vehicles },
  });

test("范围：只取机场↔地区；滑雪场、港口（以「港」结尾，不含空港、香港）、码头不导", () => {
  assert.equal(priceImportExclusion("某某滑雪场"), "SKI_RESORT");
  assert.equal(priceImportExclusion("某某港"), "PORT");
  assert.equal(priceImportExclusion("某某邮轮码头"), "PORT");
  assert.equal(priceImportExclusion("某某空港"), null);
  assert.equal(priceImportExclusion("香港"), null);
  assert.equal(priceImportExclusion("一号地区"), null);
  const plan = planPriceSheetImport(
    country([
      ["甲机场", "一号地区", [10_000, 12_000]],
      ["甲机场", "某某滑雪场", [20_000, 22_000]],
      ["甲机场", "某某港", [9_000, 9_500]],
      ["一号地区", "二号地区", [8_000, 8_000]],
      ["甲机场", "乙空港", [30_000, 30_000]],
    ]),
    notes,
    mapping(),
  );
  assert.equal(plan.routesInScope, 3);
  assert.equal(plan.cells.length, 2);
  assert.deepEqual(
    plan.skips.map((skip) => [skip.to, skip.reason]),
    [
      ["某某滑雪场", "SKI_RESORT"],
      ["某某港", "PORT"],
    ],
  );
});

test("范围：度假小镇（名字里没有滑雪、港口字样）按普通地区导入；名字里有「滑雪」的才算滑雪场", () => {
  for (const name of ["北海道二世古", "北海道喜乐乐", "北海道留寿都"]) assert.equal(priceImportExclusion(name), null, name);
  assert.equal(priceImportExclusion("某县滑雪场"), "SKI_RESORT");
  const plan = planPriceSheetImport(country([["甲机场", "北海道二世古", [10_000, 12_000]]]), notes, mapping({ regions: { 北海道二世古: { lat: 42.8, lng: 140.7, radius_m: 10_000 } } }));
  assert.equal(plan.cells.length, 2);
  assert.deepEqual(plan.skips, []);
});

test("车型：等级不在现有四个里的列（Premium、Bus、Van、SUV、EV）不按建议编码导，必须在映射里写明；写了编码就按编码导，写 null 就不导", () => {
  assert.equal(defaultPriceImportVehicle("Economy 5 Seater"), "VG-ECO-5");
  assert.equal(defaultPriceImportVehicle("Comfort 7 Seater"), "VG-CMF-7");
  for (const name of ["Premium 5 Seater", "Bus 14 Seater", "Van 9 Seater", "SUV 5 Seater", "EV Car"]) assert.equal(defaultPriceImportVehicle(name), null, name);
  const wide: PriceSheetCountry = {
    ...country([]),
    columns: [
      { column: 2, ref: "日本!C1", name: "Economy 5 Seater", capacity: CAP4 },
      { column: 3, ref: "日本!D1", name: "Premium 5 Seater", capacity: CAP4 },
      { column: 4, ref: "日本!E1", name: "Bus 14 Seater", capacity: { passengers: 13, luggage: 6 } },
      { column: 5, ref: "日本!F1", name: "Bus 22 Seater", capacity: { passengers: 22, luggage: 18 } },
    ],
    routes: [{ row: 3, from: "甲机场", to: "一号地区", prices: [10_000, 15_000, 30_000, 50_000], invalidCells: 0 }],
  };
  // 映射里一个都没写：只有 Economy 按建议编码导，其余三列没有等级，不导
  const unmapped = planPriceSheetImport(wide, notes, parsePriceImportMapping({ airports: { 甲机场: "AAA" }, regions: { 一号地区: { lat: 35.1, lng: 139.1, radius_m: 10_000 } }, vehicles: {} }));
  assert.deepEqual(unmapped.cells.map((cell) => cell.vehicleGroupCode), ["VG-ECO-5"]);
  assert.deepEqual(unmapped.skips.map((skip) => [skip.column, skip.reason]), [
    ["Premium 5 Seater", "VEHICLE_GRADE_UNSET"],
    ["Bus 14 Seater", "VEHICLE_GRADE_UNSET"],
    ["Bus 22 Seater", "VEHICLE_GRADE_UNSET"],
  ]);
  // Premium 写成豪华级的编码，Bus 写 null：Premium 导、Bus 明确不导
  const mapped = planPriceSheetImport(wide, notes, parsePriceImportMapping({ airports: { 甲机场: "AAA" }, regions: { 一号地区: { lat: 35.1, lng: 139.1, radius_m: 10_000 } }, vehicles: { "Premium 5 Seater": "VG-LUX-5", "Bus 14 Seater": null, "Bus 22 Seater": null } }));
  assert.deepEqual(mapped.cells.map((cell) => `${cell.column}|${cell.vehicleGroupCode}|${cell.sheetPriceMinor}`), ["Economy 5 Seater|VG-ECO-5|10000", "Premium 5 Seater|VG-LUX-5|15000"]);
  assert.deepEqual(mapped.skips.map((skip) => [skip.column, skip.reason]), [
    ["Bus 14 Seater", "VEHICLE_EXCLUDED"],
    ["Bus 22 Seater", "VEHICLE_EXCLUDED"],
  ]);
});

test("方向：只列一个方向时（说明页写了反向同价）是接送通用；机场在后面的是送机方向的那一行", () => {
  const plan = planPriceSheetImport(country([["一号地区", "甲机场", [10_000, null]]]), notes, mapping());
  assert.equal(plan.cells.length, 1);
  assert.deepEqual(
    { airport: plan.cells[0]?.airport, region: plan.cells[0]?.region, direction: plan.cells[0]?.direction, price: plan.cells[0]?.sheetPriceMinor },
    { airport: "甲机场", region: "一号地区", direction: "both", price: 10_000 },
  );
  // 说明页没写反向同价：不导，列出来
  const strict = planPriceSheetImport(country([["甲机场", "一号地区", [10_000, null]]]), { ...notes, reverseSamePrice: false }, mapping());
  assert.equal(strict.cells.length, 0);
  assert.equal(strict.skips[0]?.reason, "REVERSE_RULE_MISSING");
});

test("方向：两个方向都列——同价是通用，不同价拆成接机 + 送机，只有一个方向有价的原样只导那个方向", () => {
  const plan = planPriceSheetImport(
    country([
      ["甲机场", "一号地区", [10_000, 12_000]],
      ["一号地区", "甲机场", [10_000, 13_000]],
      ["甲机场", "二号地区", [null, 15_000]],
      ["二号地区", "甲机场", [11_000, null]],
    ]),
    notes,
    mapping(),
  );
  const shown = plan.cells.map((cell) => `${cell.region}|${cell.vehicleGroupCode}|${cell.direction}|${cell.sheetPriceMinor}|${cell.oneSided}`).sort();
  assert.deepEqual(shown, [
    "一号地区|VG-ECO-5|both|10000|false",
    "一号地区|VG-ECO-7|dropoff|13000|false",
    "一号地区|VG-ECO-7|pickup|12000|false",
    "二号地区|VG-ECO-5|dropoff|11000|true",
    "二号地区|VG-ECO-7|pickup|15000|true",
  ]);
});

test("方向：同一方向重复几行、价格不一致的不选其中一行，整对不导", () => {
  const plan = planPriceSheetImport(
    country([
      ["甲机场", "一号地区", [10_000, 12_000]],
      ["甲机场", "一号地区", [10_500, 12_000]],
    ]),
    notes,
    mapping(),
  );
  assert.equal(plan.cells.filter((cell) => cell.vehicleGroupCode === "VG-ECO-5").length, 0);
  assert.ok(plan.skips.some((skip) => skip.reason === "DUPLICATE_CONFLICT"));
});

test("映射：地区待定（null）、没写进映射的地区和机场、映射成 null 的车型都不导，各有原因", () => {
  const plan = planPriceSheetImport(
    country([
      ["甲机场", "三号地区", [10_000, 12_000]],
      ["甲机场", "四号地区", [10_000, 12_000]],
      ["丙机场", "一号地区", [10_000, 12_000]],
      ["甲机场", "一号地区", [10_000, 12_000]],
    ]),
    notes,
    mapping({ vehicles: { "Economy 7 Seater": null } }),
  );
  assert.deepEqual(plan.cells.map((cell) => `${cell.region}|${cell.vehicleGroupCode}`), ["一号地区|VG-ECO-5"]);
  const reasons = new Set(plan.skips.map((skip) => skip.reason));
  for (const reason of ["REGION_PENDING", "REGION_UNMAPPED", "AIRPORT_UNMAPPED", "VEHICLE_EXCLUDED"]) assert.ok(reasons.has(reason as never), reason);
});

test("映射：写法不对就拒绝（坐标越界、半径超出区域的上限、编码不合规、多余的键）", () => {
  assert.throws(() => mapping({ regions: { 一号地区: { lat: 91, lng: 0, radius_m: 1_000 } } }), PriceImportError);
  assert.throws(() => mapping({ regions: { 一号地区: { lat: 35, lng: 139, radius_m: 150_000 } } }), PriceImportError);
  assert.throws(() => mapping({ vehicles: { "Economy 5 Seater": "eco 5" } }), PriceImportError);
  assert.throws(() => mapping({ airports: { 甲机场: "aaaa" } }), PriceImportError);
  assert.throws(() => parsePriceImportMapping({ airports: {}, regions: {}, vehicles: {}, extra: 1 }), PriceImportError);
});

// ---- 归属：只影响分组，不影响价格 ----

test("归属：机场归哪个城市只改变商品和区域挂在哪个城市，不改变任何一条价格（区域 × 车型组 × 方向 × 金额）", () => {
  const plan = planPriceSheetImport(
    country([
      ["甲机场", "一号地区", [10_000, 12_000]],
      ["乙空港", "一号地区", [10_500, 12_500]],
      ["乙空港", "二号地区", [11_000, 13_000]],
    ]),
    notes,
    mapping(),
  );
  const flat = (cityOf: (iata: string) => string) => groupPriceImport(plan.cells, cityOf);
  const together = flat(() => "CITY-1");
  const apart = flat((iata) => (iata === "AAA" ? "CITY-1" : "CITY-2"));
  assert.deepEqual(together.prices, apart.prices);
  assert.deepEqual(together.products.map((p) => [p.iata, p.city]), [["AAA", "CITY-1"], ["BBB", "CITY-1"]]);
  assert.deepEqual(apart.products.map((p) => [p.iata, p.city]), [["AAA", "CITY-1"], ["BBB", "CITY-2"]]);
  // 同一城市里同名的地区共用一个区域；不同城市各建一个
  assert.equal(together.areas.length, 2);
  assert.equal(apart.areas.length, 3);
  // 显示价和结算价：加价比例不随城市变时，归属怎么改都一样（规则按机场所属的城市取）
  const priced = (cityOf: (iata: string) => string) =>
    pricePriceImportCells(plan.cells, (cell) => rules({ sellRoundingUnit: cityOf(cell.iata) === "never" ? 1 : 100 })).map((cell) => [cell.iata, cell.region, cell.direction, cell.result.baseMinor, cell.result.displayMinor]);
  assert.deepEqual(priced(() => "CITY-1"), priced((iata) => (iata === "AAA" ? "CITY-1" : "CITY-2")));
});

test("归属：城市有单独的加价比例时，结算价跟着倒算变，官网显示价仍等于表上价", () => {
  const plan = planPriceSheetImport(country([["甲机场", "一号地区", [11_000, 22_000]]]), notes, mapping());
  const byCity = (city: string) => pricePriceImportCells(plan.cells, () => rules({ markupBp: city === "CITY-1" ? 1_000 : 2_000 }));
  const one = byCity("CITY-1");
  const two = byCity("CITY-2");
  assert.deepEqual(one.map((cell) => cell.result.displayMinor), [11_000, 22_000]);
  assert.deepEqual(two.map((cell) => cell.result.displayMinor), [11_000, 22_000]);
  assert.notDeepEqual(one.map((cell) => cell.result.baseMinor), two.map((cell) => cell.result.baseMinor));
});

// ---- 批次 ----

test("批次号：字母数字和短横线，3 到 24 位；子品牌名和区域标记由它生成", () => {
  assert.equal(priceImportBatchIssue("JP-2026-11-A"), null);
  assert.notEqual(priceImportBatchIssue("ab"), null);
  assert.notEqual(priceImportBatchIssue("有中文"), null);
  assert.notEqual(priceImportBatchIssue("a".repeat(25)), null);
  assert.equal(priceImportBrandName("JP-2026-11-A"), "价格表导入 JP-2026-11-A");
  assert.equal(priceImportBatchLabel("JP-2026-11-A"), "价格表导入 JP-2026-11-A");
  assert.ok(priceImportBatchLabel("a".repeat(24)).length <= 40);
});

test("撤回：只删这一批的草稿商品和只被它们用着的区域；有商品不是草稿、区域被批次外的商品用着就整批不动", () => {
  const ok = planPriceImportRevert({
    products: [
      { id: "p1", status: "draft" },
      { id: "p2", status: "draft" },
    ],
    areas: [
      { id: "a1", usedBy: ["p1"] },
      { id: "a2", usedBy: [] },
    ],
  });
  assert.deepEqual(ok, { ok: true, deleteProducts: ["p1", "p2"], deleteAreas: ["a1", "a2"] });

  const published = planPriceImportRevert({ products: [{ id: "p1", status: "published" }], areas: [] });
  assert.equal(published.ok, false);
  assert.deepEqual(!published.ok && published.blockers, [{ reason: "PRODUCT_NOT_DRAFT", id: "p1" }]);

  const borrowed = planPriceImportRevert({ products: [{ id: "p1", status: "draft" }], areas: [{ id: "a1", usedBy: ["p1", "other"] }] });
  assert.equal(borrowed.ok, false);
  assert.deepEqual(!borrowed.ok && borrowed.blockers, [{ reason: "AREA_USED_OUTSIDE_BATCH", id: "a1" }]);

  assert.deepEqual(planPriceImportRevert({ products: [], areas: [] }), { ok: true, deleteProducts: [], deleteAreas: [] });
});

// ---- 目标环境的只读导出 ----

test("导出：解析目标环境的只读导出（租户、渠道定价、加价规则、城市、机场、车型组），写法不对就拒绝", () => {
  const raw = {
    tenant: { id: "00000000-0000-4000-8000-000000000001", name: "虚构车队", status: "active" },
    channel: { id: "00000000-0000-4000-8000-000000000002", name: "虚构官网", settle_currency: "JPY", default_markup_bp: 1_500, markup_floor_bp: 1_000, min_margin_minor: 0, sell_rounding: { JPY: 100 } },
    markup_rules: [{ id: "00000000-0000-4000-8000-000000000003", level: 4, supplier_tenant_id: null, city_id: "00000000-0000-4000-8000-000000000004", category: "airport_transfer", vehicle_group_id: null, markup_bp: 1_200, valid_from: null, valid_to: null }],
    cities: [{ id: "00000000-0000-4000-8000-000000000004", code: "CTY-JP-X", status: "active", name: { zh: "虚构市" } }],
    places: [{ id: "00000000-0000-4000-8000-000000000005", code: "AAA", type: "airport", status: "active", city_id: "00000000-0000-4000-8000-000000000004", name: { zh: "甲机场" } }],
    vehicle_groups: [{ id: "00000000-0000-4000-8000-000000000006", code: "VG-ECO-5", status: "active", combos: [{ passengers: 4, luggage: 2 }] }],
  };
  const target = parsePriceImportTarget(raw);
  assert.equal(target.channel.sellRounding.get("JPY"), 100);
  assert.equal(target.markupRules[0]?.cityId, "00000000-0000-4000-8000-000000000004");
  assert.throws(() => parsePriceImportTarget({ tenant: {} }), PriceImportError);
  assert.throws(() => parsePriceImportTarget({ ...raw, channel: { ...raw.channel, settle_currency: "XXX" } }), PriceImportError);
  assert.throws(() => parsePriceImportTarget({ ...raw, markup_rules: [{ ...raw.markup_rules[0], category: null }] }), PriceImportError);
});
