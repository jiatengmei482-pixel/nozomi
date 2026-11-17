/** 新预订页按钮条的文案和第 2 步「下一步」点不了的原因（M9E-32，ADR 0100）。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { STEP_BAR_TEXTS, stepBarCopy, vehicleStepReason } from "./step-bar-texts.ts";

test("中文每个键都有；日文、英文没译时退回中文", () => {
  for (const key of ["label", "needVehicle", "quoting", "quoteFailed"] as const) {
    assert.ok((STEP_BAR_TEXTS.zh[key] ?? "").length > 0, key);
    assert.equal(stepBarCopy(key, "ja"), stepBarCopy(key));
    assert.equal(stepBarCopy(key, "en"), stepBarCopy(key));
  }
  assert.equal(stepBarCopy("needVehicle"), "请先选择车型");
});

test("第 2 步「下一步」点不了的原因：正在报价 / 报价失败 / 还没选车；选了车、只能人工报价时没有", () => {
  assert.equal(vehicleStepReason({ selected: false, manualOnly: false, quote: "ready" }), "needVehicle");
  assert.equal(vehicleStepReason({ selected: false, manualOnly: false, quote: "none" }), "needVehicle");
  assert.equal(vehicleStepReason({ selected: false, manualOnly: false, quote: "loading" }), "quoting");
  assert.equal(vehicleStepReason({ selected: false, manualOnly: false, quote: "failed" }), "quoteFailed");
  assert.equal(vehicleStepReason({ selected: true, manualOnly: false, quote: "ready" }), null);
  assert.equal(vehicleStepReason({ selected: true, manualOnly: false, quote: "loading" }), null, "改附加服务重新报价时选中的车还在，按钮照旧可点");
  assert.equal(vehicleStepReason({ selected: false, manualOnly: true, quote: "failed" }), null, "只能人工报价：没有「下一步」");
});
