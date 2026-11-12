/**
 * 官网下单表单：后端退回的校验错误落到哪一栏（M8-32 起乘车人两栏也要标出来，不能只给一句笼统的提示）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../api/client.ts";
import { orderFailureOf } from "./site-order-form.ts";

const invalid = (issues: { path: string; message: string }[]): ApiError => new ApiError(400, "VALIDATION_FAILED", "invalid", { issues }, null);

test("后端退回乘车人电话 / 姓名：标在乘车人那两栏，提示「看标红的地方」；联系人的错误照旧", () => {
  const failure = orderFailureOf(invalid([
    { path: "/passenger_phone", message: "电话要以 + 和国家码开头" },
    { path: "/passenger_name", message: "太长了" },
    { path: "/passenger/email", message: "邮箱不对" },
  ]));
  assert.equal(failure.kind, "fields");
  if (failure.kind !== "fields") return;
  assert.deepEqual(failure.riderErrors, { riderPhone: "电话要以 + 和国家码开头", riderName: "太长了" });
  assert.deepEqual(failure.errors, { email: "邮箱不对" });
  assert.match(failure.text, /标红/);
});

test("只有乘车人那一栏被退回：也算有标红的地方，不是笼统的「不符合要求」", () => {
  const failure = orderFailureOf(invalid([{ path: "/passenger_phone", message: "电话要以 + 和国家码开头" }]));
  assert.ok(failure.kind === "fields" && failure.riderErrors.riderPhone !== undefined && /标红/.test(failure.text));
});
