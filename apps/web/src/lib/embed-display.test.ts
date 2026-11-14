import { test } from "node:test";
import assert from "node:assert/strict";
import { entrySourceText } from "./embed-display.ts";

test("订单来源的说法：主站；嵌入组件写网站和嵌入码名称；在合作网站页面里下单的写「宿主页内」（M9E-16）", () => {
  assert.equal(entrySourceText({ kind: "book", embed_key_id: null, embed_key_name: null, embed_origin: null, delivery: null }), "主站");
  assert.equal(entrySourceText({ kind: "embed", embed_key_id: "k", embed_key_name: "MoveGlobal 演示站", embed_origin: "https://embed-demo.moveglobal.io", delivery: "redirect" }), "嵌入组件 · embed-demo.moveglobal.io（MoveGlobal 演示站）");
  assert.equal(entrySourceText({ kind: "embed", embed_key_id: "k", embed_key_name: null, embed_origin: "http://localhost:5173", delivery: "redirect" }), "嵌入组件 · localhost:5173");
  assert.equal(entrySourceText({ kind: "embed", embed_key_id: "k", embed_key_name: "MoveGlobal 演示站", embed_origin: "https://embed-demo.moveglobal.io", delivery: "host_page" }), "嵌入组件（宿主页内） · embed-demo.moveglobal.io（MoveGlobal 演示站）");
});
