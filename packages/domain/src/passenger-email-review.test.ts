import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PASSENGER_EMAIL_REVIEW_KIND,
  PASSENGER_EMAIL_REVIEW_REFUSAL_MESSAGES,
  passengerEmailApprovalRefusal,
  passengerEmailNeedsReview,
} from "./passenger-email-review.ts";

test("代改乘客邮箱要不要复核：同一个邮箱（大小写、全角、首尾空白不同）不用；换了地址、原来没有邮箱的都要", () => {
  assert.equal(passengerEmailNeedsReview("guest@example.com", "guest@example.com"), false);
  assert.equal(passengerEmailNeedsReview("guest@example.com", " Guest@Example.COM "), false, "同一个收件箱：按盲索引的口径比");
  assert.equal(passengerEmailNeedsReview("guest@example.com", "ｇｕｅｓｔ＠ｅｘａｍｐｌｅ．ｃｏｍ"), false);
  assert.equal(passengerEmailNeedsReview("guest@example.com", "guest2@example.com"), true);
  assert.equal(passengerEmailNeedsReview("guest@example.com", "guest@example.org"), true);
  assert.equal(passengerEmailNeedsReview("", "guest@example.com"), true, "原来没有邮箱：加上一个同样是把通知交给这个地址");
  assert.equal(passengerEmailNeedsReview("  ", "guest@example.com"), true);
});

test("批准时还能不能改：已脱敏不能；审核期间订单上的邮箱被别人改过（客人、渠道）不能（包括客人自己已经改成了同一个新地址）", () => {
  const facts = { anonymized: false, emailOnFile: "old@example.com", emailAtRequest: "old@example.com" };
  assert.equal(passengerEmailApprovalRefusal(facts), null);
  assert.equal(passengerEmailApprovalRefusal({ ...facts, emailOnFile: " OLD@example.com" }), null, "同一个地址的不同写法不算被改过");
  assert.equal(passengerEmailApprovalRefusal({ ...facts, anonymized: true }), "PASSENGER_ANONYMIZED");
  assert.equal(passengerEmailApprovalRefusal({ ...facts, emailOnFile: "other@example.com" }), "EMAIL_CHANGED_SINCE_REQUEST");
  assert.equal(passengerEmailApprovalRefusal({ ...facts, emailOnFile: "new@example.com" }), "EMAIL_CHANGED_SINCE_REQUEST", "客人自己已经改成了这个：也按被改过处理，审核人驳回即可");
  assert.equal(passengerEmailApprovalRefusal({ ...facts, emailOnFile: "", emailAtRequest: "" }), null, "原来没有邮箱");
});

test("复核类别和拒绝原因的说明齐全", () => {
  assert.equal(PASSENGER_EMAIL_REVIEW_KIND, "order.passenger_email");
  for (const reason of ["PASSENGER_ANONYMIZED", "EMAIL_CHANGED_SINCE_REQUEST"] as const) assert.ok(PASSENGER_EMAIL_REVIEW_REFUSAL_MESSAGES[reason].length > 0);
});
