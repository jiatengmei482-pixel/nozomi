import { test } from "node:test";
import assert from "node:assert/strict";
import { containsPattern } from "../repos/master-data.ts";
import { statusCounts } from "./dashboard.ts";

test("数量汇总：启用、停用、合计；没出现的状态是 0", () => {
  assert.deepEqual(statusCounts([]), { total: 0, active: 0, disabled: 0 });
  assert.deepEqual(statusCounts([{ status: "active", count: 3 }]), { total: 3, active: 3, disabled: 0 });
  assert.deepEqual(statusCounts([{ status: "disabled", count: 2 }, { status: "active", count: 5 }, { status: "active", count: 1 }]), { total: 8, active: 6, disabled: 2 });
});

test("关键字变成「包含」模式：%、_、反斜杠按字面匹配", () => {
  assert.equal(containsPattern("tokyo"), "%tokyo%");
  assert.equal(containsPattern("100%"), "%100\\%%");
  assert.equal(containsPattern("a_b"), "%a\\_b%");
  assert.equal(containsPattern("a\\b"), "%a\\\\b%");
});
