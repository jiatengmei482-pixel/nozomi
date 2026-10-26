import { test } from "node:test";
import assert from "node:assert/strict";
import { PAYMENT_STATUSES } from "@nozomi/domain";
import { PAYMENT_STATUS_NAMES, paymentStatusName } from "./order-money-display.ts";

test("收款记录的每个状态都有中文名，不显示英文原值；名字各不相同", () => {
  for (const status of PAYMENT_STATUSES) {
    const name = paymentStatusName(status);
    assert.ok(name !== status && /[一-鿿]/.test(name), `${status} → ${name}`);
  }
  assert.equal(new Set(PAYMENT_STATUSES.map(paymentStatusName)).size, PAYMENT_STATUSES.length);
  assert.deepEqual(Object.keys(PAYMENT_STATUS_NAMES).sort(), [...PAYMENT_STATUSES].sort(), "没有多出来的");
  assert.equal(paymentStatusName("something_new"), "something_new", "以后后端加了新状态先原样显示");
});
