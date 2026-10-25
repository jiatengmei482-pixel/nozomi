import assert from "node:assert/strict";
import { test } from "node:test";
import { placeQueryMatches } from "./place-search.ts";

const NARITA = "成田国际机场 NRT · 机场 Narita International Airport 成田国际机场 成田国際空港 NRT";
const HANEDA = "東京国際空港 HND · 机场 Tokyo Haneda International Airport 東京国際空港 HND";

test("接送点搜索：整段包含照常匹配，不分大小写和全角半角", () => {
  for (const query of ["成田", "成田国际", "成田国際空港", "NRT", "nrt", "ＮＲＴ", "  narita  ", "Narita International"]) assert.equal(placeQueryMatches(NARITA, query), true, query);
  assert.equal(placeQueryMatches(NARITA, ""), true);
});

test("接送点搜索：去掉机场、空港、国际、国際等通用词后按字找（M1-17）", () => {
  for (const query of ["成田机场", "成田空港", "成田國際機場", "成田 机场", "narita airport", "Narita Intl", "nrt airport", "田成"]) assert.equal(placeQueryMatches(NARITA, query), true, query);
  assert.equal(placeQueryMatches(HANEDA, "东京机场"), false, "简体「东」不等于「東」");
  assert.equal(placeQueryMatches(HANEDA, "東京空港"), true);
  assert.equal(placeQueryMatches(HANEDA, "成田机场"), false);
  assert.equal(placeQueryMatches(NARITA, "羽田机场"), false);
  assert.equal(placeQueryMatches(NARITA, "kansai airport"), false);
});

test("接送点搜索：只输了通用词时按整段包含找", () => {
  assert.equal(placeQueryMatches(NARITA, "机场"), true);
  assert.equal(placeQueryMatches(NARITA, "国际机场"), true);
  assert.equal(placeQueryMatches(HANEDA, "国际机场"), false);
  assert.equal(placeQueryMatches("Shinjuku Station STN-JP-SJK · 车站", "station"), true);
  assert.equal(placeQueryMatches("Shinjuku STN-JP-SJK", "airport"), false);
});
