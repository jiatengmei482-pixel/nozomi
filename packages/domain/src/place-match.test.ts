import { test } from "node:test";
import assert from "node:assert/strict";
import { type PlatformSuggestionPlace, placeQueryMatch, platformPlaceDisplayName, platformPlaceSuggestions } from "./place-match.ts";

const place = (id: string, type: PlatformSuggestionPlace["type"], code: string, name: PlatformSuggestionPlace["name"], parentName: PlatformSuggestionPlace["parentName"] = null): PlatformSuggestionPlace => ({ id, type, code, name, parentName, lat: 35, lng: 139 });
const NARITA = place("nrt", "airport", "NRT", { zh: "成田国际机场", ja: "成田国際空港", en: "Narita International Airport" });
const NRT_T1 = place("nrt-t1", "terminal", "NRT-T1", { zh: "第 1 航站楼", en: "Terminal 1" }, NARITA.name);
const HANEDA = place("hnd", "airport", "HND", { ja: "東京国際空港", en: "Tokyo Haneda International Airport" });
const TOKYO_STATION = place("tyo-stn", "station", "STN-JP-TYO", { zh: "东京站", ja: "東京駅", en: "Tokyo Station" });
const ALL = [TOKYO_STATION, NRT_T1, HANEDA, NARITA];

test("匹配方式：整段包含是 whole，去掉通用词按字找是 pieces，对不上是 null", () => {
  assert.equal(placeQueryMatch("成田国际机场 NRT", "成田"), "whole");
  assert.equal(placeQueryMatch("成田国际机场 NRT", "成田机场"), "pieces");
  assert.equal(placeQueryMatch("成田国际机场 NRT", "羽田"), null);
});

test("平台地点：名称（各语言）、编码都能搜到；航站楼连同所属机场的名称；整段包含的在前，再按机场、航站楼、车站", () => {
  assert.deepEqual(platformPlaceSuggestions(ALL, "成田").map((p) => p.id), ["nrt", "nrt-t1"]);
  assert.deepEqual(platformPlaceSuggestions(ALL, "Narita terminal").map((p) => p.id), ["nrt-t1"]);
  assert.deepEqual(platformPlaceSuggestions(ALL, "hnd").map((p) => p.id), ["hnd"]);
  assert.deepEqual(platformPlaceSuggestions(ALL, "東京").map((p) => p.id), ["hnd", "tyo-stn"]);
  assert.deepEqual(platformPlaceSuggestions(ALL, "Tokyo Station").map((p) => p.id), ["tyo-stn", "hnd"], "整段包含的车站排在只按词匹配上的机场前面");
  assert.deepEqual(platformPlaceSuggestions(ALL, "希尔顿酒店"), []);
});

test("平台地点最多给 5 个；同一档里按编码排", () => {
  const many = Array.from({ length: 8 }, (_, i) => place(`s${i}`, "station", `STN-JP-S${7 - i}`, { zh: `新宿站 ${i}` }));
  const found = platformPlaceSuggestions(many, "新宿");
  assert.equal(found.length, 5);
  assert.deepEqual(found.map((p) => p.code), ["STN-JP-S0", "STN-JP-S1", "STN-JP-S2", "STN-JP-S3", "STN-JP-S4"]);
});

test("给客人看的名称：中文优先，其次日文、英文；航站楼前面加机场名；都没有用编码", () => {
  assert.equal(platformPlaceDisplayName(NARITA), "成田国际机场");
  assert.equal(platformPlaceDisplayName(HANEDA), "東京国際空港");
  assert.equal(platformPlaceDisplayName(NRT_T1), "成田国际机场 第 1 航站楼");
  assert.equal(platformPlaceDisplayName({ code: "XYZ", name: {}, parentName: null }), "XYZ");
});
