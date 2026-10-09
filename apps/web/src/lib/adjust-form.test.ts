import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAdjustRules, exactFromMinor } from "@nozomi/domain";
import { type AdjustContext, type AdjustForm, basisPointsText, cycleText, emptyAdjustForm, exactMoneyText, formFromAdjustRule, percentTextToBasisPoints, reachWarning, readAdjustForm, slotReadback, slotText, stepsText, travelText } from "./adjust-form.ts";

const jpy: AdjustContext = { category: "airport_transfer", currency: "JPY" };
const form = (changes: Partial<AdjustForm> = {}): AdjustForm => ({ ...emptyAdjustForm("2026-10-08"), name: "国庆旺季", steps: [{ up: true, type: "percent", value: "20" }], ...changes });
const texts = (value: AdjustForm, context = jpy): string[] => readAdjustForm(value, context).problems.map((problem) => problem.text);

test("百分比和基点用字符串换算：最多两位小数，来回不变", () => {
  for (const [text, bp] of [["20", 2000], ["12.5", 1250], ["0.01", 1], ["1000", 100000], ["99.99", 9999], ["２０", 2000], ["20%", 2000]] as const) assert.equal(percentTextToBasisPoints(text), bp, text);
  for (const text of ["", "1.234", "abc", "-5", "1."]) assert.equal(percentTextToBasisPoints(text), null, text);
  for (const bp of [1, 50, 100, 1250, 2000, 9999, 100000]) assert.equal(percentTextToBasisPoints(basisPointsText(bp)), bp);
  assert.equal(basisPointsText(-1250), "12.5");
});

test("读表单：上调 / 下调换成带正负号的数；全部 = 空数组；指定日期时不带出行日期；读回表单再读一遍不变", () => {
  const reading = readAdjustForm(form({ to: "2027/10/7", cycle: "weekly", weekdays: [6, 5], slotMode: "slot", slotStart: "22", slotEnd: "600", areaMode: "some", areaIds: ["a1"], direction: "pickup", steps: [{ up: true, type: "percent", value: "12.5" }, { up: false, type: "amount", value: "1,000" }] }), jpy);
  assert.deepEqual(reading.problems, []);
  assert.deepEqual(reading.input, { name: "国庆旺季", travel_from: "2026-10-08", travel_to: "2027-10-07", cycle: { type: "weekly", weekdays: [5, 6] }, time_slot: { start: "22:00", end: "06:00" }, area_ids: ["a1"], vehicle_group_ids: [], directions: ["pickup"], package_hours: [], steps: [{ type: "percent", value: 1250 }, { type: "amount", value: -1000 }], status: "enabled" });
  assert.deepEqual(readAdjustForm(formFromAdjustRule(reading.input as NonNullable<typeof reading.input>, "JPY"), jpy).input, reading.input);
  const dates = readAdjustForm(form({ cycle: "dates", dates: ["2027-01-02", "2027-01-01"], from: "乱写的" }), jpy).input;
  assert.deepEqual([dates?.travel_from, dates?.travel_to, dates?.cycle], [null, null, { type: "dates", dates: ["2027-01-01", "2027-01-02"] }]);
  assert.equal(readAdjustForm(form({ slotMode: "slot", slotStart: "18:00", slotEnd: "24:00" }), jpy).input?.time_slot?.end, "24:00");
  const usd = readAdjustForm(form({ steps: [{ up: false, type: "amount", value: "12.5" }] }), { category: "charter", currency: "USD" });
  assert.deepEqual(usd.input?.steps, [{ type: "amount", value: -1250 }]);
});

test("写错了的和没填的：每一种都有定稿的话", () => {
  assert.deepEqual(texts(form({ name: " " })), ["请填写名称"]);
  assert.deepEqual(texts(form({ from: "2026-10-10", to: "2026-10-01" })), ["出行日期：结束日期不能早于开始日期"]);
  assert.deepEqual(texts(form({ cycle: "weekly" })), ["周期：请至少选一天"]);
  assert.deepEqual(texts(form({ cycle: "dates" })), ["周期：请至少添加一个日期"]);
  assert.deepEqual(texts(form({ cycle: "holidays" })), ["周期：请至少选一个国家的节假日"]);
  assert.deepEqual(texts(form({ slotMode: "slot", slotStart: "22:00", slotEnd: "22:00" })), ["时段：开始和结束不能相同。全天都调请选「全天」"]);
  assert.deepEqual(texts(form({ slotMode: "slot" })), ["时段：请填时间，例如 22:00", "时段：请填时间，例如 06:00"]);
  assert.deepEqual(texts(form({ areaMode: "some", groupMode: "some" })), ["区域：请至少选一个区域，或改成「全部区域」", "车型组：请至少选一个车型组，或改成「全部车型组」"]);
  assert.deepEqual(texts(form({ steps: [{ up: true, type: "percent", value: "0" }, { up: true, type: "percent", value: "1000.01" }, { up: false, type: "percent", value: "100" }, { up: false, type: "amount", value: "1.5" }, { up: true, type: "amount", value: "" }] })), [
    "第 1 步：请填大于 0 的数。不想调，请删掉这一步",
    "第 2 步：上调最多 1,000%",
    "第 3 步：下调要小于 100%",
    "第 4 步：JPY没有小数，请填整数",
    "第 5 步：请填大于 0 的数。不想调，请删掉这一步",
  ]);
  assert.deepEqual(texts(form({ steps: [] })), ["怎么调：至少要有一步"]);
  assert.deepEqual(readAdjustForm(form({ steps: [{ up: false, type: "percent", value: "99.99" }] }), jpy).input?.steps, [{ type: "percent", value: -9999 }]);
});

test("读回来的话：出行日期、周期、时段、步骤", () => {
  assert.equal(travelText("2027-10-01", "2027-10-07"), "2027-10-01 至 2027-10-07");
  assert.equal(travelText("2026-10-10", null), "2026-10-10 起");
  assert.equal(travelText(null, null), "不限日期");
  assert.equal(cycleText({ type: "weekly", weekdays: [7, 6] }), "每周六、周日");
  assert.equal(cycleText({ type: "dates", dates: ["2027-01-01"] }), "指定日期 2027-01-01");
  assert.equal(cycleText({ type: "dates", dates: ["2027-01-01", "2027-01-02", "2027-01-03", "2027-01-04"] }), "指定的 4 天");
  assert.equal(slotText(null), "全天");
  assert.equal(slotText({ start: "22:00", end: "06:00" }), "22:00–次日 06:00");
  assert.equal(slotText({ start: "18:00", end: "24:00" }), "18:00–24:00");
  assert.deepEqual(stepsText([{ type: "percent", value: 2000 }, { type: "amount", value: -1000 }, { type: "percent", value: -550 }], "JPY"), ["上调 20%", "再下调 JPY 1,000", "再下调 5.5%"]);
});

test("试算的数全部来自 domain 的 applyAdjustRules；精确值按币种挪小数点，不取整", () => {
  const result = applyAdjustRules(exactFromMinor(20000), [{ steps: [{ type: "percent", value: 2000 }, { type: "amount", value: -1000 }] }], 100);
  assert.deepEqual(result.adjusts[0]?.steps.map((step) => [exactMoneyText(step.delta, "JPY", true), exactMoneyText(step.after, "JPY")]), [["+JPY 4,000", "JPY 24,000"], ["−JPY 1,000", "JPY 23,000"]]);
  assert.equal(result.finalMinor, 23000);
  // 中间结果不是整数：照实显示
  const odd = applyAdjustRules(exactFromMinor(15555), [{ steps: [{ type: "percent", value: 333 }] }], 1);
  assert.equal(exactMoneyText(odd.unrounded, "JPY"), "JPY 16,072.9815");
  assert.equal(odd.finalMinor, 16073);
  // 两位小数的币种：460050 个最小单位的 10.5% → 508355.25 个最小单位 = 5,083.5525
  const usd = applyAdjustRules(exactFromMinor(460050), [{ steps: [{ type: "percent", value: 1050 }] }], 1);
  assert.equal(exactMoneyText(usd.unrounded, "USD"), "USD 5,083.5525");
  assert.equal(exactMoneyText(exactFromMinor(460050), "USD"), "USD 4,600.50");
  assert.equal(exactMoneyText(exactFromMinor(5), "USD"), "USD 0.05");
});

test("碰不碰得到价格：没有价格、日期不重合、周几不出现", () => {
  const price = { areaId: "a1", vehicleGroupId: "g1", direction: "both" as const, packageHours: null, pricing: { model: "fixed" as const, basePriceMinor: 20000 }, validFrom: "2026-10-01", validTo: "2026-12-31", status: "enabled" as const };
  const rule = (changes: Partial<AdjustForm>) => readAdjustForm(form(changes), jpy).rule as NonNullable<ReturnType<typeof readAdjustForm>["rule"]>;
  assert.equal(reachWarning(rule({}), [price]), null);
  assert.equal(reachWarning(rule({}), []), "适用范围里现在没有价格，这条规则暂时调不到任何东西。");
  assert.equal(reachWarning(rule({ areaMode: "some", areaIds: ["别的"] }), [price]), "适用范围里现在没有价格，这条规则暂时调不到任何东西。");
  assert.equal(reachWarning(rule({ from: "2027-01-01", to: "2027-01-31" }), [price]), "这段出行日期里，适用范围内没有生效的价格。");
  assert.equal(reachWarning(rule({ cycle: "dates", dates: ["2027-02-01"] }), [price]), "这段出行日期里，适用范围内没有生效的价格。");
  assert.equal(reachWarning(rule({ cycle: "dates", dates: ["2026-11-01", "2027-02-01"] }), [price]), null);
  // 2026-10-12 是周一，到周三为止；选的是周六
  assert.equal(reachWarning(rule({ from: "2026-10-12", to: "2026-10-14", cycle: "weekly", weekdays: [6] }), [price]), "出行日期里没有周六，这条规则不会生效。");
  assert.equal(reachWarning(rule({ from: "2026-10-12", to: "2026-10-14", cycle: "weekly", weekdays: [6, 2] }), [price]), null);
});

test("时段读回来的话：跨午夜的算在开始那一天头上", () => {
  const night = { start: "22:00", end: "06:00" };
  assert.equal(slotReadback({ type: "daily" }, night), "每天 22:00–次日 06:00，共 8 小时（跨午夜）");
  assert.equal(slotReadback({ type: "weekly", weekdays: [6, 5] }, night), "周五 22:00–周六 06:00、周六 22:00–周日 06:00");
  assert.equal(slotReadback({ type: "weekly", weekdays: [7] }, night), "周日 22:00–周一 06:00");
  assert.equal(slotReadback({ type: "dates", dates: ["2026-12-31"] }, night), "2026-12-31 22:00–2027-01-01 06:00");
  assert.equal(slotReadback({ type: "daily" }, { start: "18:00", end: "24:00" }), "每天 18:00–24:00，共 6 小时");
  assert.equal(slotReadback({ type: "daily" }, { start: "18:00", end: "18:00" }), null);
});

test("百分比的写法：出错文字里写的「1,000%」本身能输入；逗号位置不对的不认", () => {
  assert.equal(percentTextToBasisPoints("1,000"), 100000);
  assert.equal(percentTextToBasisPoints("1,000%"), 100000);
  assert.equal(percentTextToBasisPoints("１，０００％"), 100000);
  for (const text of ["1,00", "10,00", ",5", "1,0000"]) assert.equal(percentTextToBasisPoints(text), null, text);
});
