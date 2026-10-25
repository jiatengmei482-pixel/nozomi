import assert from "node:assert/strict";
import { test } from "node:test";
import { brandLabel } from "./product-display.ts";

test("子品牌名后面补币种；名称自己已经带了同一个币种（全角、半角括号，大小写不论）时不再补，不出现「（JPY）（JPY）」（M1-18）", () => {
  assert.equal(brandLabel({ name: "NOZOMI", currency: "JPY" }), "NOZOMI（JPY）");
  assert.equal(brandLabel({ name: "测试（JPY）", currency: "JPY" }), "测试（JPY）");
  assert.equal(brandLabel({ name: "测试 (JPY)", currency: "JPY" }), "测试 (JPY)");
  assert.equal(brandLabel({ name: "测试（ jpy ）", currency: "JPY" }), "测试（ jpy ）");
  assert.equal(brandLabel({ name: "测试（JPY） ", currency: "JPY" }), "测试（JPY）");
  assert.equal(brandLabel({ name: "测试（USD）", currency: "JPY" }), "测试（USD）（JPY）", "名称里写的是别的币种，照样补上实际币种");
  assert.equal(brandLabel({ name: "JPY 专线", currency: "JPY" }), "JPY 专线（JPY）", "只认结尾的括号");
});
