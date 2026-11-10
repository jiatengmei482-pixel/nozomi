import { test } from "node:test";
import assert from "node:assert/strict";
import { AREA_SURCHARGE_MAIL_NOTE, AREA_SURCHARGE_NOTE, consoleMoneyText, guestMoneyText, includedKmNote, includedKmSummary, routeKmText, routeMetersText, tenantIncludedKmSummary } from "./included-km.ts";
import { overKm } from "./pricing.ts";

const facts = (routeMeters: number, extra: { includedKm?: number; overKmPerKmMinor?: number; currency?: "JPY" | "CNY" } = {}) => {
  const includedKm = extra.includedKm ?? 30;
  return { includedKm, routeMeters, overKm: overKm(routeMeters, includedKm), overKmPerKmMinor: extra.overKmPerKmMinor ?? 300, currency: extra.currency ?? "JPY" };
};

test("路线距离 D：向上取整到 0.1 公里，整数不带 .0，带千分位", () => {
  assert.equal(routeKmText(34_200), "34.2");
  assert.equal(routeKmText(34_153), "34.2");
  assert.equal(routeKmText(30_040), "30.1", "30.04 公里写 30.1，不写 30.0");
  assert.equal(routeKmText(30_000), "30");
  assert.equal(routeKmText(30_001), "30.1");
  assert.equal(routeKmText(29_901), "30");
  assert.equal(routeKmText(29_900), "29.9");
  assert.equal(routeKmText(1), "0.1");
  assert.equal(routeKmText(0), "0");
  assert.equal(routeKmText(1_234_501), "1,234.6");
  assert.equal(routeKmText(-5), "0");
});

test("超出了、单价大于 0：「含 X 公里，本次路线约 D 公里，超出 Z 公里 × Y（已含在一口价里）」，不写成算式", () => {
  const text = includedKmNote(facts(34_200, { overKmPerKmMinor: 330 }));
  assert.equal(text, "含 30 公里，本次路线约 34.2 公里，超出 5 公里 × 330 JPY（已含在一口价里）");
  assert.doesNotMatch(text, /[=+]|合计/);
});

test("没超出：「在含的公里数以内」（含正好在含的公里数上）", () => {
  assert.equal(includedKmNote(facts(28_400)), "含 30 公里，本次路线约 28.4 公里，在含的公里数以内");
  assert.equal(includedKmNote(facts(30_000)), "含 30 公里，本次路线约 30 公里，在含的公里数以内", "正好 30.0 公里：Z = 0");
  assert.equal(includedKmNote(facts(29_950)), "含 30 公里，本次路线约 30 公里，在含的公里数以内", "29.95 公里向上取整写 30，仍在以内");
});

test("刚超过边界：30.001 公里 → D = 30.1、Z = 1，两个数对得上；31.0 → 1；31.4 → 2", () => {
  assert.equal(includedKmNote(facts(30_001)), "含 30 公里，本次路线约 30.1 公里，超出 1 公里 × 300 JPY（已含在一口价里）");
  assert.equal(includedKmNote(facts(30_040)), "含 30 公里，本次路线约 30.1 公里，超出 1 公里 × 300 JPY（已含在一口价里）");
  assert.equal(includedKmNote(facts(31_000)), "含 30 公里，本次路线约 31 公里，超出 1 公里 × 300 JPY（已含在一口价里）");
  assert.equal(includedKmNote(facts(31_400)), "含 30 公里，本次路线约 31.4 公里，超出 2 公里 × 300 JPY（已含在一口价里）");
});

test("超出了、单价是 0：「超出的公里不另收」", () => {
  assert.equal(includedKmNote(facts(34_200, { overKmPerKmMinor: 0 })), "含 30 公里，本次路线约 34.2 公里，超出的公里不另收");
});

test("Z 用给的数，不重算（订单上锁定的数）", () => {
  assert.equal(includedKmNote({ includedKm: 30, routeMeters: 34_200, overKm: 4, overKmPerKmMinor: 300, currency: "JPY" }), "含 30 公里，本次路线约 34.2 公里，超出 4 公里 × 300 JPY（已含在一口价里）");
});

test("有小数的币种和大数：金额按币种位数、带千分位；公里数带千分位", () => {
  assert.equal(includedKmNote(facts(1_250_000, { includedKm: 1_200, overKmPerKmMinor: 123_450, currency: "CNY" })), "含 1,200 公里，本次路线约 1,250 公里，超出 50 公里 × 1,234.50 CNY（已含在一口价里）");
  assert.equal(guestMoneyText(1_000, "JPY"), "1,000 JPY");
  assert.equal(guestMoneyText(5, "CNY"), "0.05 CNY");
  assert.equal(consoleMoneyText(250, "JPY"), "JPY 250");
  assert.equal(consoleMoneyText(460_050, "CNY"), "CNY 4,600.50");
});

test("后台订单详情：第一行「含 30 公里 · 路线约 34.2 公里（报价时）· 超出 5 公里」；供应商接结算单价；核对用的米数", () => {
  assert.equal(includedKmSummary(facts(34_200)), "含 30 公里 · 路线约 34.2 公里（报价时）· 超出 5 公里");
  assert.equal(includedKmSummary(facts(30_000)), "含 30 公里 · 路线约 30 公里（报价时）· 在含的公里数以内");
  assert.equal(tenantIncludedKmSummary(facts(34_200, { overKmPerKmMinor: 250 })), "含 30 公里 · 路线约 34.2 公里（报价时）· 超出 5 公里 × JPY 250");
  assert.equal(tenantIncludedKmSummary(facts(30_000, { overKmPerKmMinor: 250 })), "含 30 公里 · 路线约 30 公里（报价时）· 在含的公里数以内");
  assert.equal(tenantIncludedKmSummary(facts(34_200, { overKmPerKmMinor: 0 })), "含 30 公里 · 路线约 34.2 公里（报价时）· 超出 5 公里，不另收");
  assert.equal(routeMetersText(34_153), "路线 34,153 米");
});

test("含区域加价：只说已含，不写金额、不写「附加费」「另收」", () => {
  for (const text of [AREA_SURCHARGE_NOTE, AREA_SURCHARGE_MAIL_NOTE]) {
    assert.match(text, /含区域加价/);
    assert.doesNotMatch(text, /\d|附加费|另收/);
  }
});
