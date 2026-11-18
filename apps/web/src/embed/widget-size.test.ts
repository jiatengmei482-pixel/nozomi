import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { WIDGET_GZIP_BUDGET } from "./widget-core.ts";
import { widgetSizeProblem } from "./widget-size.ts";

test("组件脚本的大小预算：gzip 后不超过 60 KB；超了给出字节数", () => {
  assert.equal(WIDGET_GZIP_BUDGET, 60 * 1024);
  assert.equal(widgetSizeProblem("var a = 1;".repeat(50_000)), null, "重复的内容压得很小");
  const random = randomBytes(WIDGET_GZIP_BUDGET + 1024).toString("base64");
  assert.match(widgetSizeProblem(random) ?? "", /^嵌入组件脚本 gzip 后 \d+ 字节，超过预算 61440 字节$/);
  assert.equal(widgetSizeProblem("x", 21), null, "正好等于预算不算超");
  assert.match(widgetSizeProblem("x", 20) ?? "", /gzip 后 21 字节，超过预算 20 字节/);
  assert.match(widgetSizeProblem(randomBytes(200).toString("hex"), 100) ?? "", /超过预算 100 字节/);
});
