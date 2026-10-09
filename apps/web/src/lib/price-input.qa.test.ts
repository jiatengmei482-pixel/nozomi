/**
 * M1-04 验收测试（测试工程师）：价格表、调价表单、价格日历的「把用户敲的字读成数、把数写成给人看的字」。
 * 页面上不重算任何价格（全部问 @nozomi/domain 或接口），所以这里盯的是输入输出这一层会不会把金额读错、写错：
 * 全角数字、千分位、币种小数位、负数、超大数、粘贴带货币符号；接口的数 → 行 → 读回来必须原样；百分比和基点来回不变。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { type AdjustStep, type ExactAmount, PRICE_LIMITS, type PriceRule, applyAdjustRules, basePrice, formatExact, priceRuleIssues } from "@nozomi/domain";
import type { CalendarDay, PriceRuleBody } from "../api/prices.ts";
import { basisPointsText, emptyAdjustForm, exactMoneyText, formFromAdjustRule, percentTextToBasisPoints, readAdjustForm } from "./adjust-form.ts";
import { cellView, exactFromText, exactTextMoney, segmentAt } from "./price-calendar.ts";
import { type PriceContext, blankRow, buildBatch, kmTextToMeters, lowestText, metersToKmText, pricingSentence, readRow, rowChange, rowFromRule } from "./price-form.ts";

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (r: () => number, min: number, max: number): number => min + Math.floor(r() * (max - min + 1));

const context = (currency: string, category: PriceContext["category"] = "point_to_point"): PriceContext => ({ category, currency, today: "2026-10-07", station: false });
const combo = { areaId: "11111111-1111-4111-8111-111111111111", vehicleGroupId: "22222222-2222-4222-8222-222222222222", direction: null, packageHours: null };

/** 在一口价的基础价格里敲这些字，读出来的最小货币单位整数；读不出来返回那句提示。 */
function typed(text: string, currency: string): number | string {
  const reading = readRow(blankRow(combo, "fixed", "2026-10-07", { base: text }), context(currency));
  if (reading.rule) {
    assert.equal(reading.rule.pricing.model, "fixed");
    assert.deepEqual(priceRuleIssues(reading.rule, { category: "point_to_point" }), [], "读出来的规则 domain 也认为是对的");
    assert.equal(reading.input?.base_price, (reading.rule.pricing as { basePriceMinor: number }).basePriceMinor, "提交给接口的数就是读出来的数");
    return reading.input?.base_price as number;
  }
  assert.equal(reading.input, null, "有问题的行不产生请求");
  return reading.problems[0]?.text ?? "";
}

test("金额输入（日元，没有小数）：半角、全角数字、千分位、空格、带「JPY / ¥ / 円」粘贴都读成同一个整数；小数一律报错，不四舍五入、不去掉小数", () => {
  for (const text of ["20000", "20,000", "２００００", "２０，０００", " 20000 ", "20 000", "JPY 20,000", "jpy20000", "¥20,000", "20,000円", "２０，０００円", "020000", "20000\n", "20000\t"]) assert.equal(typed(text, "JPY"), 20_000, JSON.stringify(text));
  for (const text of ["20000.5", "20000.0", "２００００．５", "0.5"]) assert.equal(typed(text, "JPY"), "日元金额不能有小数", JSON.stringify(text));
  assert.equal(typed("20000.4", "KRW"), "韩元金额不能有小数");
  // 上限 10 亿：恰好可以，多 1 不行；位数再多也不会读成别的数（不经过会丢精度的浮点数）
  assert.equal(typed("1000000000", "JPY"), 1_000_000_000);
  assert.equal(typed("1,000,000,000", "JPY"), 1_000_000_000);
  for (const text of ["1000000001", "9007199254740993", "99999999999999999999", "1" + "0".repeat(400)]) assert.equal(typed(text, "JPY"), "基础价最多 JPY 1,000,000,000", text.slice(0, 30));
  assert.equal(typed("0", "JPY"), "基础价要大于 0");
  assert.equal(typed("000", "JPY"), "基础价要大于 0");
  assert.equal(typed("-20000", "JPY"), "基础价不能是负数");
  // 只有符号、没有数字：当作没填
  for (const text of [",", "¥", "JPY", " 円 "]) assert.equal(typed(text, "JPY"), "请填基础价", JSON.stringify(text));
  for (const text of ["－20000", "−20000", "+20000", "2e4", "0x4e20", "2万", "二万", "20000abc", "abc", "1_000", "1'000", ".5", "5.", "..", "NaN", "Infinity", "١٢٣"]) assert.equal(typed(text, "JPY"), "请填数字", JSON.stringify(text));
});

test("金额输入（人民币，两位小数）：元换成分用字符串挪小数点，不乘 100——4.35、1.15、0.07、1.005 这些浮点数里乘不准的数都读得一分不差；超过两位小数报错", () => {
  // 4.35 × 100 = 434.99999999999994、1.15 × 100 = 114.99999999999999、0.07 × 100 = 7.000000000000001（浮点）
  const exact: [string, number][] = [["4.35", 435], ["1.15", 115], ["0.07", 7], ["0.1", 10], ["0.29", 29], ["0.57", 57], ["0.58", 58], ["1.1", 110], ["8.2", 820], ["9.95", 995], ["19.99", 1_999], ["33.33", 3_333], ["1001.1", 100_110], ["4600.5", 460_050], ["4,600.50", 460_050], ["４６００．５", 460_050], ["CNY 4,600.50", 460_050], ["4600.50元", 460_050], ["¥4600.5", 460_050], ["0.01", 1], ["100", 10_000], ["100.0", 10_000], ["100.00", 10_000], ["10000000", 1_000_000_000], ["10,000,000.00", 1_000_000_000], ["9999999.99", 999_999_999]];
  for (const [text, minor] of exact) assert.equal(typed(text, "CNY"), minor, text);
  for (const text of ["1.005", "0.001", "4600.505", "100.000"]) assert.equal(typed(text, "CNY"), "CNY 最多 2 位小数", text);
  for (const text of ["10000000.01", "10000001", "99999999999999999999.99"]) assert.equal(typed(text, "CNY"), "基础价最多 CNY 10,000,000.00", text);
  assert.equal(typed("0.00", "CNY"), "基础价要大于 0");
  assert.equal(typed("-0.01", "CNY"), "基础价不能是负数");
  // 每一个「分」都读得准：0.00 到 99.99 的每一个两位小数
  for (let cents = 1; cents < 10_000; cents += 1) {
    const text = `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
    assert.equal(typed(text, "USD"), cents, text);
  }
});

test("写法不明确的不静默读成别的数：千分位的逗号后面必须正好三位（「12,50」可能是把逗号当小数点）；全角的 ￥ 和 $ 认得；带着别的币种的标记报错，不按本币读", () => {
  // M1-04 的输入容错收紧之后的口径（原来是「逗号不管在哪都去掉」「别的币种的符号也去掉」，12,50 会被读成 1,250.00）
  const GROUPING = "逗号的位置不对：千分位的逗号后面要正好三位（如 12,500）；小数点请用「.」";
  for (const [text, currency] of [["12,50", "CNY"], ["1,00", "JPY"], ["1,,000", "JPY"], ["1 000,50", "JPY"], ["1.000,50", "JPY"], ["1,0000", "JPY"], [",500", "JPY"]] as const) assert.equal(typed(text, currency), GROUPING, text);
  assert.equal(typed("12,500", "CNY"), 1_250_000);
  assert.equal(typed("1,234,567.89", "CNY"), 123_456_789);
  // 自己币种的符号，半角全角都认
  for (const text of ["￥1,000", "¥1,000", "JPY1000", "1,000円"]) assert.equal(typed(text, "JPY"), 1_000, text);
  for (const text of ["￥1,000", "¥1,000.00", "1000元", "RMB 1,000", "CNY 1000"]) assert.equal(typed(text, "CNY"), 100_000, text);
  for (const text of ["$100", "＄100", "US$100", "USD 100.00"]) assert.equal(typed(text, "USD"), 10_000, text);
  // 别的币种的标记：报错，不按本币读
  for (const text of ["$100", "US$100", "CN¥ 100", "USD 100", "₩1000", "100元"]) assert.equal(typed(text, "JPY"), "这一格的币种是 JPY，请不要带别的币种的符号，只填数字", text);
  for (const text of ["1,000円", "JPY 1,000", "$100"]) assert.equal(typed(text, "CNY"), "这一格的币种是 CNY，请不要带别的币种的符号，只填数字", text);
});

test("接口的价格 → 页面上的行 → 读回来：2,000 条随机价格（三种计价方式 × 日元 / 人民币 / 美元 / 韩元）原样不变，不会平白多出一次修改；读回的那句话里的数和 domain 算的一样", () => {
  const r = rng(104);
  const amounts = [0, 1, 7, 99, 100, 101, 999, 1_000, 4_350, 115, 20_050, 460_050, 999_999_999, 1_000_000_000];
  const money = (min: number): number => Math.max(min, r() < 0.5 ? (amounts[int(r, 0, amounts.length - 1)] as number) : int(r, 0, 1_000_000_000));
  let changed = 0;
  for (let i = 0; i < 2_000; i += 1) {
    const currency = ["JPY", "CNY", "USD", "KRW"][int(r, 0, 3)] as string;
    const kind = int(r, 0, 2);
    const category = kind === 2 ? "charter" : "point_to_point";
    const none = { base_price: null, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null };
    const start = money(0);
    const fields =
      kind === 0
        ? { ...none, pricing_model: "fixed" as const, base_price: money(1) }
        : kind === 1
          ? { ...none, pricing_model: "mileage_time" as const, start_price: start, start_meters: int(r, 0, 10_000) * 100, start_minutes: int(r, 0, 1_440), per_km: money(0), per_minute: money(0), min_price: start === 0 || r() < 0.5 ? money(1) : null }
          : { ...none, pricing_model: "charter_package" as const, package_km: int(r, 1, 5_000), package_price: money(1), overtime_per_hour: money(0), over_km_per_km: money(0) };
    const body = { id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, area_id: combo.areaId, vehicle_group_id: combo.vehicleGroupId, direction: null, package_hours: kind === 2 ? int(r, 1, 72) : null, ...fields, base: "0", valid_from: "2026-10-01", valid_to: r() < 0.5 ? null : "2027-03-31", status: r() < 0.8 ? "enabled" : "disabled", created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z" } as unknown as PriceRuleBody;
    const row = rowFromRule(body, currency);
    const reading = readRow(row, context(currency, category));
    assert.deepEqual(reading.problems, [], `第 ${i} 条 ${currency} ${JSON.stringify(body)}`);
    if (rowChange(row, reading) !== "none") changed += 1;
    assert.deepEqual(buildBatch([row], context(currency, category)), { create: [], update: [], delete: [] }, `第 ${i} 条读回来和原来不一样：${JSON.stringify(reading.input)}`);
    // 读出来的规则交给 domain 算的最低价，和页面写的那句一致（都来自 basePrice，这里核对没有在中间变样）
    const rule = reading.rule as PriceRule;
    const lowest = formatExact(basePrice(rule.pricing, {}, rule.packageHours));
    assert.ok(/^\d+$/.test(lowest));
    const shown = lowestText(rule.pricing, currency).replace(/[, 起]/g, "").replace(".", "");
    assert.equal(BigInt(shown), BigInt(lowest), `第 ${i} 条最低价的写法`);
  }
  assert.equal(changed, 0);
});

test("公里和米：0 到 1,000 公里每 100 米一档，写成公里再读回来不变；不是 100 米整数倍的写法（两位小数）读不出来", () => {
  for (let meters = 0; meters <= PRICE_LIMITS.maxStartMeters; meters += 100) assert.equal(kmTextToMeters(metersToKmText(meters)), meters, String(meters));
  assert.equal(metersToKmText(10_300), "10.3");
  assert.equal(kmTextToMeters("10.3"), 10_300);
  // 10.3 × 1000 = 10300.000000000002（浮点）：这里必须正好是 10300
  for (const [text, meters] of [["0.1", 100], ["0.3", 300], ["0.7", 700], ["1.1", 1_100], ["2.3", 2_300], ["8.7", 8_700], ["１０．３", 10_300], ["1,000", 1_000_000]] as [string, number][]) assert.equal(kmTextToMeters(text), meters, text);
  for (const text of ["10.35", "-1", "1e3", "", "abc", "1.", ".5"]) assert.equal(kmTextToMeters(text), null, text);
});

test("百分比和基点：−99.99% 到 +1000% 的每一个基点，写成百分比再读回来不变（不经过浮点数）；多于两位小数、带正负号的读不出来", () => {
  for (let bp = 1; bp <= PRICE_LIMITS.maxPercentBp; bp += 1) assert.equal(percentTextToBasisPoints(basisPointsText(bp)), bp, String(bp));
  for (let bp = -1; bp >= PRICE_LIMITS.minPercentBp; bp -= 1) assert.equal(percentTextToBasisPoints(basisPointsText(bp)), -bp, String(bp));
  // 0.07 × 100、0.57 × 100、1.15 × 100、8.2 × 100 在浮点数里都不是整数
  for (const [text, bp] of [["0.07", 7], ["0.57", 57], ["1.15", 115], ["8.2", 820], ["12.5", 1_250], ["33.33", 3_333], ["99.99", 9_999], ["1000", 100_000], ["２０", 2_000], ["20%", 2_000], [" 20 ", 2_000]] as [string, number][]) assert.equal(percentTextToBasisPoints(text), bp, text);
  for (const text of ["12.555", "0.001", "-20", "+20", "1e2", ".5", "5.", "abc", ""]) assert.equal(percentTextToBasisPoints(text), null, text);
});

test("调价表单：上调 / 下调 + 不带符号的数 → 带正负号的整数；读出来的步骤交给 domain 试算，页面读回表单再读一遍不变；人民币的金额步骤按分存", () => {
  const read = (steps: { up: boolean; type: "percent" | "amount"; value: string }[], currency: string) => readAdjustForm({ ...emptyAdjustForm("2026-10-07"), name: "验收", steps }, { category: "point_to_point", currency });
  const cny = read([{ up: true, type: "percent", value: "12.5" }, { up: false, type: "amount", value: "4.35" }, { up: false, type: "percent", value: "0.07" }, { up: true, type: "amount", value: "1,000.10" }], "CNY");
  assert.deepEqual(cny.problems, []);
  assert.deepEqual(cny.input?.steps, [{ type: "percent", value: 1_250 }, { type: "amount", value: -435 }, { type: "percent", value: -7 }, { type: "amount", value: 100_010 }]);
  const again = readAdjustForm(formFromAdjustRule(cny.input as NonNullable<typeof cny.input>, "CNY"), { category: "point_to_point", currency: "CNY" });
  assert.deepEqual(again.input, cny.input);
  // 试算：100.00 元 → +12.5% = 112.50 → −4.35 = 108.15 → −0.07% = 108.074295 → +1000.10 = 1108.174295 元
  const priced = applyAdjustRules({ numerator: 10_000n, denominator: 1n }, [{ steps: cny.steps }], 1);
  assert.deepEqual(priced.adjusts[0]?.steps.map((step) => exactMoneyText(step.after, "CNY")), ["CNY 112.50", "CNY 108.15", "CNY 108.074295", "CNY 1,108.174295"]);
  assert.equal(priced.finalMinor, 110_817);
  // 写错的：下调 100% 和以上、上调超过 1000%、0、负号、日元带小数、金额超上限
  const problem = (step: { up: boolean; type: "percent" | "amount"; value: string }, currency = "JPY"): string => read([step], currency).problems[0]?.text ?? "";
  assert.equal(problem({ up: false, type: "percent", value: "100" }), "第 1 步：下调要小于 100%");
  assert.equal(problem({ up: false, type: "percent", value: "99.99" }), "");
  assert.equal(problem({ up: true, type: "percent", value: "1000.01" }), "第 1 步：上调最多 1,000%");
  assert.equal(problem({ up: true, type: "percent", value: "1000" }), "");
  assert.match(problem({ up: true, type: "percent", value: "0" }), /请填大于 0 的数/);
  assert.match(problem({ up: true, type: "percent", value: "-20" }), /请填数字/);
  assert.match(problem({ up: true, type: "amount", value: "500.5" }), /没有小数/);
  assert.match(problem({ up: true, type: "amount", value: "-500" }), /不能是负数/);
  assert.match(problem({ up: true, type: "amount", value: "1000000001" }), /金额太大/);
  assert.match(problem({ up: true, type: "amount", value: "0" }), /请填大于 0 的数/);
  assert.equal(read([{ up: false, type: "amount", value: "５００" }], "JPY").input?.steps[0]?.value, -500);
});

test("精确值写成金额：按币种挪小数点、补齐小数位、加千分位，全程整数；随机 3,000 个分数和 bigint 对照逐位相等；负数用减号、带符号的写法正数有加号", () => {
  assert.equal(exactMoneyText({ numerator: 46_299n, denominator: 2n }, "JPY"), "JPY 23,149.5");
  assert.equal(exactMoneyText({ numerator: 460_050n, denominator: 1n }, "CNY"), "CNY 4,600.50");
  assert.equal(exactMoneyText({ numerator: 5n, denominator: 1n }, "CNY"), "CNY 0.05");
  assert.equal(exactMoneyText({ numerator: -920_101n, denominator: 2n }, "CNY", true), "−CNY 4,600.505");
  assert.equal(exactMoneyText({ numerator: 300_750n, denominator: 1n }, "CNY", true), "+CNY 3,007.50");
  assert.equal(exactMoneyText({ numerator: 0n, denominator: 1n }, "JPY", true), "+JPY 0");
  const r = rng(7);
  for (let i = 0; i < 3_000; i += 1) {
    const decimals = int(r, 0, 6);
    const numerator = BigInt(int(r, 0, 2_000_000_000)) * BigInt(int(r, 1, 1_000_000));
    const amount: ExactAmount = { numerator: r() < 0.3 ? -numerator : numerator, denominator: 10n ** BigInt(decimals) };
    for (const [currency, digits] of [["JPY", 0], ["CNY", 2]] as [string, number][]) {
      const text = exactMoneyText(amount, currency);
      // 把写出来的字读回成分数，应当和原来的值相等
      const negative = text.startsWith("−");
      const [whole = "", fraction = ""] = text.replace(/^−/, "").replace(`${currency} `, "").replace(/,/g, "").split(".");
      assert.ok(fraction.length >= digits, `${text} 至少有 ${digits} 位小数`);
      const back = BigInt(whole + fraction) * (negative ? -1n : 1n);
      assert.equal(back * amount.denominator * 10n ** BigInt(digits), amount.numerator * 10n ** BigInt(fraction.length), `${amount.numerator}/${amount.denominator} ${currency} → ${text}`);
    }
  }
});

test("读回来的话里的例子：里程 + 时长「预估 N 公里、M 分钟 = …」的数等于 domain 的基础价四舍五入到最小货币单位（恰好一半往大的取）", () => {
  const sentence = (perKm: number, startMeters: number): string => pricingSentence({ model: "mileage_time", startPriceMinor: 3_000, startMeters, startMinutes: 30, perKmMinor: perKm, perMinuteMinor: 7, minPriceMinor: null }, null, "JPY");
  // 例子是「起步 + 10 公里、+ 20 分钟」：3000 + 333 × 10 + 7 × 20 = 6,470
  assert.match(sentence(333, 10_000), /预估 20 公里、50 分钟 = JPY 6,470。/);
  assert.match(sentence(333, 10_300), /预估 20\.3 公里、50 分钟 = JPY 6,470。/);
  const r = rng(11);
  for (let i = 0; i < 500; i += 1) {
    const pricing = { model: "mileage_time" as const, startPriceMinor: int(r, 0, 50_000), startMeters: int(r, 0, 300) * 100, startMinutes: int(r, 0, 120), perKmMinor: int(r, 0, 5_000), perMinuteMinor: int(r, 0, 500), minPriceMinor: r() < 0.5 ? int(r, 1, 80_000) : null };
    const exact = basePrice(pricing, { meters: pricing.startMeters + 10_000, minutes: pricing.startMinutes + 20 });
    const rounded = (2n * exact.numerator + exact.denominator) / (2n * exact.denominator);
    const shown = /= JPY ([\d,]+)。/.exec(pricingSentence(pricing, null, "JPY"))?.[1]?.replace(/,/g, "");
    assert.equal(BigInt(shown ?? "-1"), rounded, JSON.stringify(pricing));
  }
});

test("价格日历：接口给的每一段，页面上任何一分钟落到的段都对（开始含、结束不含、最后一段到 24:00）；格子的结算价、调高调低直接取自接口，不重算", () => {
  const segment = (from: string, to: string, final: number | null, base: string | null, names: string[] = [], reason: string | null = null) => ({ from, to, final, no_price_reason: reason, base, unrounded: base, adjusts: names.map((name) => ({ rule_id: name, name, steps: [] })) });
  const day = { date: "2026-10-09", weekday: 5, holiday: null, price_rule: null, segments: [segment("00:00", "06:00", 24_000, "20000", ["夜间"]), segment("06:00", "22:00", 20_000, "20000"), segment("22:00", "24:00", 19_000, "20000", ["深夜减价"])] } as unknown as CalendarDay;
  for (let minute = 0; minute < 1440; minute += 1) {
    const time = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    const expected = minute < 360 ? 24_000 : minute < 1320 ? 20_000 : 19_000;
    assert.equal(segmentAt(day, time)?.final, expected, time);
    assert.equal(cellView(day, time).final, expected, time);
  }
  assert.deepEqual([cellView(day, "05:59").trend, cellView(day, "06:00").trend, cellView(day, "22:00").trend, cellView(day, "23:59").trend], ["up", null, "down", "down"]);
  assert.equal(cellView(day, "10:00").split, true);
  // 调完和基础价一样（+500 再 −500）
  const same = { ...day, segments: [segment("00:00", "24:00", 20_000, "20000", ["加", "减"])] } as unknown as CalendarDay;
  assert.equal(cellView(same, "10:00").trend, "same");
  // 基础价带小数（里程 + 时长）：和取整后的结算价比高低用精确值，不用浮点数
  const fractional = { ...day, segments: [segment("00:00", "24:00", 3_000, "3000.333", ["微调"])] } as unknown as CalendarDay;
  assert.equal(cellView(fractional, "10:00").trend, "down");
  const none = { ...day, segments: [segment("00:00", "24:00", null, null, [], "NO_RULE")] } as unknown as CalendarDay;
  assert.deepEqual([cellView(none, "10:00").kind, cellView(none, "10:00").final], ["none", null]);
  const bad = { ...day, segments: [segment("00:00", "24:00", null, "1000", ["减太多"], "NOT_POSITIVE")] } as unknown as CalendarDay;
  assert.equal(cellView(bad, "10:00").kind, "bad");
  // 接口里的精确值字符串 → 分数 → 金额，逐位不变
  for (const text of ["0", "20050", "23149.5", "3375.374625", "-0.333333", "98083.333333", "1000000000", "13454999898651200000000000"]) {
    const amount = exactFromText(text);
    assert.equal(formatExact(amount.denominator === 1n ? amount : { numerator: amount.numerator, denominator: amount.denominator }).replace(/^-0$/, "0"), text, text);
  }
  assert.equal(exactTextMoney("23149.5", "JPY"), "JPY 23,149.5");
  assert.equal(exactTextMoney("460050.5", "CNY"), "CNY 4,600.505");
  assert.equal(exactTextMoney("-3007.5", "JPY", true), "−JPY 3,007.5");
});

test("调价步骤的试算和 domain 一致：页面读出来的步骤（1,000 组随机的上调 / 下调、百分比 / 金额）交给 applyAdjustRules，和直接用带符号整数算的结果相同", () => {
  const r = rng(55);
  for (let i = 0; i < 1_000; i += 1) {
    const expected: AdjustStep[] = [];
    const forms = Array.from({ length: int(r, 1, 10) }, () => {
      const up = r() < 0.5;
      if (r() < 0.5) {
        const bp = up ? int(r, 1, 100_000) : int(r, 1, 9_999);
        expected.push({ type: "percent", value: up ? bp : -bp });
        return { up, type: "percent" as const, value: basisPointsText(bp) };
      }
      const cents = int(r, 1, 5_000_000);
      expected.push({ type: "amount", value: up ? cents : -cents });
      return { up, type: "amount" as const, value: `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}` };
    });
    const reading = readAdjustForm({ ...emptyAdjustForm("2026-10-07"), name: "随机", steps: forms }, { category: "point_to_point", currency: "USD" });
    assert.deepEqual(reading.problems, [], JSON.stringify(forms));
    assert.deepEqual(reading.steps, expected);
    const base = { numerator: BigInt(int(r, 1, 10_000_000)), denominator: 1n };
    assert.deepEqual(applyAdjustRules(base, [{ steps: reading.steps }], 100).unrounded, applyAdjustRules(base, [{ steps: expected }], 100).unrounded);
  }
});
