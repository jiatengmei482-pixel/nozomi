import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleTimeline } from "./site-display.ts";

test("客人的订单进度只显示状态真的变了的行：改乘客信息那条（已确认 → 已确认）不显示；下单、确认、取消都在", () => {
  const entries = [
    { from_status: null, to_status: "pending_payment" },
    { from_status: "pending_payment", to_status: "confirmed" },
    { from_status: "confirmed", to_status: "confirmed" },
    { from_status: "confirmed", to_status: "cancelled" },
  ];
  assert.deepEqual(visibleTimeline(entries).map((entry) => entry.to_status), ["pending_payment", "confirmed", "cancelled"]);
});
