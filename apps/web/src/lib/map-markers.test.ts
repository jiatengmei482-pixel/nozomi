/**
 * 包车行程地图 10–12 号标记的自定义图标（M9P-20，ADR 0096 第二节第 2 小节）：谷歌的服务器出图时去取 `<官网>/map-markers/N.png`。
 * 谷歌的要求：PNG（推荐）、方形不超过 64 × 64；一次最多 5 种自定义图标（这里正好 10、11、12 三种，编号来自 domain 的 `ITINERARY_MAP_RULES`）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ITINERARY_MAP_RULES } from "@nozomi/domain";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

test("10–12 号标记图标：在官网静态目录、是 PNG、方形不超过 64 × 64", () => {
  for (let n = ITINERARY_MAP_RULES.firstIconNumber; n <= ITINERARY_MAP_RULES.maxPoints; n++) {
    const bytes = readFileSync(new URL(`../../public${ITINERARY_MAP_RULES.markerIconPath}/${n}.png`, import.meta.url));
    assert.deepEqual([...bytes.subarray(0, 8)], PNG_SIGNATURE, `${n}.png 不是 PNG`);
    assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR");
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    assert.equal(width, height, `${n}.png 不是方形`);
    assert.ok(width > 0 && width <= 64, `${n}.png 是 ${width} 像素宽`);
  }
});
