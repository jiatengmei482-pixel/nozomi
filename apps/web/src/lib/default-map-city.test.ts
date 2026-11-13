/**
 * 「在地图上选点」还没有地点可参照时默认打开的城市（M8-43，`defaultMapCity`）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SiteCity } from "../api/site.ts";
import { cityOffersTab, defaultMapCity } from "./book-new.ts";

const city = (code: string, categories: SiteCity["categories"]) => ({ code, categories });

// 和测试站同样的形状：按编码排，第一项是只开了接送机的城市
const LIST = [city("CTY-CN-A", ["airport_transfer"]), city("CTY-CN-B", ["airport_transfer"]), city("CTY-JP-C", ["point_to_point", "charter"]), city("CTY-JP-D", ["airport_transfer", "point_to_point", "charter"]), city("CTY-JP-E", ["airport_transfer", "point_to_point", "charter"])];

test("区间、包车都取能订当前标签、品类最多的城市；一样多按列表顺序取第一个（不是列表第一项）", () => {
  assert.equal(defaultMapCity(LIST, "transfer")?.code, "CTY-JP-D");
  assert.equal(defaultMapCity(LIST, "charter")?.code, "CTY-JP-D");
});

test("只看能订当前标签的城市：包车时只开接送机的城市品类再多也不选", () => {
  const list = [city("CTY-A", ["airport_transfer", "point_to_point"]), city("CTY-B", ["charter"])];
  assert.equal(defaultMapCity(list, "charter")?.code, "CTY-B");
  assert.equal(defaultMapCity(list, "transfer")?.code, "CTY-A");
});

test("品类一样多时按列表顺序；没有能订当前标签的城市时退回列表第一项；列表空为 null", () => {
  assert.equal(defaultMapCity([city("CTY-A", ["airport_transfer"]), city("CTY-B", ["point_to_point"])], "transfer")?.code, "CTY-A");
  assert.equal(defaultMapCity([city("CTY-A", ["airport_transfer"])], "charter")?.code, "CTY-A");
  assert.equal(defaultMapCity([], "transfer"), null);
});

test("能订哪个标签：区间看接送机或点对点，包车看包车", () => {
  assert.deepEqual([cityOffersTab(city("x", ["airport_transfer"]), "transfer"), cityOffersTab(city("x", ["point_to_point"]), "transfer"), cityOffersTab(city("x", ["charter"]), "transfer")], [true, true, false]);
  assert.deepEqual([cityOffersTab(city("x", ["charter"]), "charter"), cityOffersTab(city("x", ["airport_transfer", "point_to_point"]), "charter")], [true, false]);
});
