import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyServiceRules, serviceRuleMissing } from "@nozomi/domain";
import type { ServiceRulesBody } from "../api/products.ts";
import { type RulesForm, type RulesFormContext, formFromRules, readRulesForm } from "./service-rules-form.ts";

const EMPTY: ServiceRulesBody = {
  booking: { sale_from: null, sale_to: null, service_time: null, lead_time_hours: null, note: null },
  urgent: { enabled: false, daily_quota: null, tiers: [] },
  night: { enabled: false, window: null, amount: null, charge_unit: null },
  free_wait: { pickup: null, dropoff: null, general: null },
  addons: [],
  driver_languages: [],
};
const airport: RulesFormContext = { category: "airport_transfer", pickupPlace: { type: "airport", flightScope: "mixed" }, currency: "JPY", minimums: { pickup: 60, dropoff: 15, general: null }, addonNames: { a1: "儿童座椅", a2: "举牌接机" } };
const fresh = (changes: Partial<RulesForm> = {}, context = airport): RulesForm => ({ ...formFromRules(EMPTY, context), ...changes });
const texts = (form: RulesForm, context = airport): string[] => readRulesForm(form, context).problems.map((problem) => problem.text);

test("新商品：免费等待预先填成平台规定的最少分钟数，夜间计费方式按品类预选；什么都没填时没有「写错了的」，缺的由域里的规则数", () => {
  const form = fresh();
  assert.deepEqual(form.wait.pickup, { mode: "limited", minutes: "60" });
  assert.deepEqual(form.wait.dropoff, { mode: "limited", minutes: "15" });
  assert.equal(form.nightUnit, "per_order");
  assert.equal(formFromRules(EMPTY, { ...airport, category: "charter", minimums: { pickup: null, dropoff: null, general: 0 } }).nightUnit, "per_hour");
  const reading = readRulesForm(form, airport);
  assert.deepEqual(reading.problems, []);
  assert.deepEqual(reading.body.free_wait, { pickup: { mode: "limited", minutes: 60 }, dropoff: { mode: "limited", minutes: 15 }, general: null });
  assert.deepEqual(serviceRuleMissing(reading.rules, airport).map((issue) => issue.path), ["/booking/service_time", "/booking/lead_time_hours"]);
  assert.deepEqual(serviceRuleMissing(emptyServiceRules(), airport).length, 4);
});

test("整理：时间、日期、数字的各种写法；全天是 00:00–24:00；加急阶梯按小时数从大到小；金额按币种换成最小单位", () => {
  const usd = { ...airport, currency: "USD" };
  const reading = readRulesForm(
    fresh({ saleMode: "range", saleFrom: "2026/3/1", saleTo: "", serviceStart: "8", serviceEnd: "2200", leadTime: " 24 ", note: " 备忘 ", urgent: true, quota: "", tiers: [{ hours: "6", amount: "50" }, { hours: "", amount: "" }, { hours: "12", amount: "30.5" }], night: true, nightStart: "22:00", nightEnd: "6", nightAmount: "1,000", wait: { pickup: { mode: "unlimited", minutes: "" }, dropoff: { mode: "limited", minutes: "20" }, general: { mode: "limited", minutes: "" } } }, usd),
    usd,
  );
  assert.deepEqual(reading.problems, []);
  assert.deepEqual(reading.body.booking, { sale_from: "2026-03-01", sale_to: null, service_time: { start: "08:00", end: "22:00" }, lead_time_hours: 24, note: "备忘" });
  assert.deepEqual(reading.body.urgent, { enabled: true, daily_quota: null, tiers: [{ within_hours: 12, surcharge: 3050 }, { within_hours: 6, surcharge: 5000 }] });
  assert.deepEqual(reading.body.night, { enabled: true, window: { start: "22:00", end: "06:00" }, amount: 100000, charge_unit: "per_order" });
  assert.deepEqual(reading.body.free_wait, { pickup: { mode: "unlimited" }, dropoff: { mode: "limited", minutes: 20 }, general: null });
  assert.deepEqual(readRulesForm(fresh({ allDay: true, serviceStart: "9", serviceEnd: "" }), airport).body.booking.service_time, { start: "00:00", end: "24:00" });
  // 读回表单再读一遍，结果不变
  assert.deepEqual(readRulesForm(formFromRules(reading.body, usd), usd).body, reading.body);
});

test("写错了的：每一种都有定稿的话，指到对应的输入框", () => {
  assert.deepEqual(texts(fresh({ saleMode: "range", saleFrom: "2026-02-30", saleTo: "2026-01-01" })), ["下单有效期：这不是一个日期，请按 2026-10-08 的格式填写"]);
  assert.deepEqual(texts(fresh({ saleMode: "range", saleFrom: "2026-03-02", saleTo: "2026-03-01" })), ["下单有效期：结束日期不能早于开始日期"]);
  assert.deepEqual(texts(fresh({ serviceStart: "8", serviceEnd: "" })), ["服务时间：请填时间，例如 08:00"]);
  assert.deepEqual(texts(fresh({ serviceStart: "24:00", serviceEnd: "9" })), ["服务时间：请填 00:00 到 23:59 之间的时间"]);
  assert.deepEqual(texts(fresh({ serviceStart: "9", serviceEnd: "09:00" })), ["服务时间：开始和结束不能相同。全天都接单请勾「全天 24 小时」"]);
  assert.deepEqual(texts(fresh({ leadTime: "721" })), ["提前预订时长：请填 0 到 720 之间的整数"]);
  assert.deepEqual(texts(fresh({ leadTime: "1.5" })), ["提前预订时长：请填 0 到 720 之间的整数"]);
  assert.deepEqual(texts(fresh({ note: "字".repeat(501) })), ["备注最多 500 个字"]);
  assert.deepEqual(texts(fresh({ urgent: true, quota: "0" })), ["每日加急库存：要停掉加急，请取消勾选「允许加急预订」"]);
  assert.deepEqual(texts(fresh({ urgent: true, quota: "10001" })), ["每日加急库存：请填 1 到 10,000 之间的整数，或留空表示不限"]);
  assert.deepEqual(texts(fresh({ leadTime: "24", urgent: true, tiers: [{ hours: "25", amount: "0" }, { hours: "6", amount: "" }, { hours: "", amount: "100" }, { hours: "12", amount: "1" }, { hours: "12", amount: "1" }] })), [
    "加急阶梯第 1 档：请填 1 到 24 之间的整数",
    "加急阶梯第 2 档：请填写加收的金额，不加收请填 0",
    "加急阶梯第 3 档：请填写小时数",
    "第 4 档和第 5 档的小时数相同",
  ]);
  assert.deepEqual(texts(fresh({ night: true, nightStart: "22", nightEnd: "22:00", nightAmount: "1.5" })), ["夜间时段：开始和结束不能相同", "夜间加价的金额：JPY没有小数，请填整数"]);
  assert.deepEqual(texts(fresh({ wait: { pickup: { mode: "limited", minutes: "30" }, dropoff: { mode: "limited", minutes: "" }, general: { mode: "limited", minutes: "" } } })), ["免费等待：不能少于平台规定的 60 分钟", "免费等待：请填 15 到 1,440 之间的整数"]);
  assert.deepEqual(readRulesForm(fresh({ leadTime: "x" }), airport).problems[0]?.target, "lead-time-input");
});

test("附加服务和司机语言：只带勾选了的；勾了没填单价要补；0 元时不带「第一个免费」；语言不能重复", () => {
  const form = fresh({
    addons: { a1: { enabled: true, price: "1000", firstFree: true }, a2: { enabled: true, price: "0", firstFree: true }, a3: { enabled: false, price: "500", firstFree: false } },
    languages: [{ language: "zh", price: "0" }, { language: "", price: "" }, { language: "en", price: "2000" }],
  });
  const reading = readRulesForm(form, airport);
  assert.deepEqual(reading.problems, []);
  assert.deepEqual(reading.body.addons, [{ addon_id: "a1", enabled: true, unit_price: 1000, first_free: true }, { addon_id: "a2", enabled: true, unit_price: 0, first_free: false }]);
  assert.deepEqual(reading.body.driver_languages, [{ language: "zh", unit_price: 0 }, { language: "en", unit_price: 2000 }]);
  assert.deepEqual(texts(fresh({ addons: { a1: { enabled: true, price: " ", firstFree: false } }, languages: [{ language: "zh", price: "1" }, { language: "zh", price: "2" }, { language: "ja", price: "" }] })), [
    "附加服务「儿童座椅」：请填单价，免费提供请填 0",
    "司机语言：中文已经在第 1 行了",
    "司机语言第 3 行：请填单价，免费提供请填 0",
  ]);
});

test("取消勾选加急、夜间：里面填过的内容不提交", () => {
  const body = readRulesForm(fresh({ urgent: false, quota: "5", tiers: [{ hours: "6", amount: "100" }], night: false, nightStart: "22:00", nightEnd: "06:00", nightAmount: "100" }), airport).body;
  assert.deepEqual(body.urgent, { enabled: false, daily_quota: null, tiers: [] });
  assert.deepEqual(body.night, { enabled: false, window: null, amount: null, charge_unit: null });
});
