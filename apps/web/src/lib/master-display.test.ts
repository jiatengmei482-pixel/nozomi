import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanLocalized, countryLabel, displayName, formatCount, formatPoint, otherNames, sameLocalized, shortName, timeZoneLabel, timeZoneOffset } from "./master-display.ts";

test("显示名按 中文 → 英语 → 日语 → 韩语 取第一个有内容的，并带上对应的 lang；只有空格的不算", () => {
  assert.deepEqual(displayName({ ja: "東京", zh: "东京", en: "Tokyo" }), { text: "东京", lang: "zh-Hans" });
  assert.deepEqual(displayName({ ja: "東京", en: "Tokyo" }), { text: "Tokyo", lang: "en" });
  assert.deepEqual(displayName({ ja: "東京", zh: "  " }), { text: "東京", lang: "ja" });
  assert.deepEqual(displayName({ ko: "도쿄" }), { text: "도쿄", lang: "ko" });
  assert.deepEqual(displayName({}), { text: "—", lang: "zh-Hans" });
  assert.deepEqual(displayName(null), { text: "—", lang: "zh-Hans" });
});

test("其余语言的名称：不含显示名本身", () => {
  assert.deepEqual(otherNames({ ja: "東京", zh: "东京", en: "Tokyo" }), [{ text: "Tokyo", lang: "en" }, { text: "東京", lang: "ja" }]);
  assert.deepEqual(otherNames({ en: "Tokyo" }), []);
});

test("国家写成「中文国名（代码）」，取不到国名时只有代码", () => {
  assert.equal(countryLabel("JP"), "日本（JP）");
  assert.equal(countryLabel("KR"), "韩国（KR）");
  assert.equal(countryLabel("ZZ"), countryLabel("ZZ").includes("（") ? countryLabel("ZZ") : "ZZ");
});

test("时区写成「IANA 名称（当前偏移）」，考虑夏令时和半小时时区", () => {
  assert.equal(timeZoneLabel("Asia/Tokyo"), "Asia/Tokyo（UTC+9）");
  assert.equal(timeZoneOffset("Asia/Kolkata"), "UTC+5:30");
  assert.equal(timeZoneOffset("America/New_York", new Date("2026-01-15T12:00:00Z")), "UTC-5");
  assert.equal(timeZoneOffset("America/New_York", new Date("2026-07-15T12:00:00Z")), "UTC-4");
  assert.equal(timeZoneOffset("Europe/London", new Date("2026-01-15T12:00:00Z")), "UTC+0");
  assert.equal(timeZoneOffset("Not/AZone"), null);
  assert.equal(timeZoneLabel("Not/AZone"), "Not/AZone");
});

test("坐标永远是「纬度, 经度」，各 6 位小数", () => {
  assert.equal(formatPoint({ lng: 139.779694, lat: 35.552258 }), "35.552258, 139.779694");
  assert.equal(formatPoint({ lng: -0.5, lat: 51 }), "51.000000, -0.500000");
});

test("多语言内容提交前去掉首尾空格、只留有内容的语言；比较时按整理后的内容", () => {
  assert.deepEqual(cleanLocalized({ zh: " 东京 ", ja: "", en: "   ", ko: "도쿄" }), { zh: "东京", ko: "도쿄" });
  assert.equal(sameLocalized({ zh: "东京 " }, { zh: "东京", en: "" }), true);
  assert.equal(sameLocalized({ zh: "东京" }, { zh: "东京", en: "Tokyo" }), false);
});

test("数量带千分位；Toast 里的长名称截断到 20 个字", () => {
  assert.equal(formatCount(3244), "3,244");
  assert.equal(shortName("短名字"), "短名字");
  assert.equal(shortName("一二三四五六七八九十一二三四五六七八九十多"), "一二三四五六七八九十一二三四五六七八九十…");
});
