import assert from "node:assert/strict";
import { test } from "node:test";
import { ITINERARY_TEXTS, itineraryCopy } from "./itinerary-texts.ts";

test("行程地图的文案按键取（M11-01：新功能先只做中文）：中文齐全；日文、英文没有译文时退回中文；占位按参数替换", () => {
  for (const [key, text] of Object.entries(ITINERARY_TEXTS.zh)) assert.ok(typeof text === "string" && text.length > 0, `中文缺 ${key}`);
  assert.equal(itineraryCopy("updating"), "路线更新中");
  assert.equal(itineraryCopy("updating", {}, "ja"), "路线更新中", "日文没有译文：用中文");
  assert.equal(itineraryCopy("updating", {}, "en"), "路线更新中");
  assert.equal(itineraryCopy("unavailableStop", { number: 3, name: "河口湖" }), "3 号点「河口湖」");
  assert.equal(itineraryCopy("legFailure", { leg: 2, from: 2, fromName: "五合目", to: 3, toName: "新宿站" }), "第 2 段（2「五合目」→ 3「新宿站」）");
  assert.equal(itineraryCopy("mapAlt", {}), "路线图：{chain}", "没给的占位原样留着");
});
