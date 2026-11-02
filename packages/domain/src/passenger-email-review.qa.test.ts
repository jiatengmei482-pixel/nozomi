/**
 * M4-31 测试角色：代改乘客邮箱要不要复核、批准时能不能改（ADR 0065）的纯规则边界。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { passengerEmailApprovalRefusal, passengerEmailNeedsReview } from "./passenger-email-review.ts";

const ON_FILE = "guest.qa@example.test";

test("同一个收件箱的写法：大小写、首尾空白（含全角空格、制表符）、全角字母数字——不用复核", () => {
  for (const same of [ON_FILE.toUpperCase(), ` ${ON_FILE}\t`, `　${ON_FILE}　`, "ｇｕｅｓｔ.ｑａ@ｅｘａｍｐｌｅ.ｔｅｓｔ", "Guest.QA@Example.Test"]) {
    assert.equal(passengerEmailNeedsReview(ON_FILE, same), false, JSON.stringify(same));
  }
});

test("看起来像、其实是另一个收件箱的：要复核（零宽字符、软连字符、西里尔字母、加号别名、点号不同、多一个地址）", () => {
  for (const other of [
    "guest.qa​@example.test",
    "guest.q­a@example.test",
    "guest.qа@example.test",
    "guest.qa+x@example.test",
    "guestqa@example.test",
    `${ON_FILE},attacker@example.test`,
    "guest.qa@example.test.attacker.test",
    "guest.qa@sub.example.test",
  ]) {
    assert.equal(passengerEmailNeedsReview(ON_FILE, other), true, JSON.stringify(other));
  }
});

test("原来没有邮箱（空字符串、只有空白）加一个：要复核；原来没有、请求也是空：不算改", () => {
  assert.equal(passengerEmailNeedsReview("", ON_FILE), true);
  assert.equal(passengerEmailNeedsReview("   ", ON_FILE), true);
  assert.equal(passengerEmailNeedsReview("", "  "), false);
});

test("批准时：脱敏优先于「被改过」；按同一口径比，写法不同不算被改过；从有到无、从无到有都算被改过", () => {
  assert.equal(passengerEmailApprovalRefusal({ anonymized: true, emailOnFile: "x@example.test", emailAtRequest: ON_FILE }), "PASSENGER_ANONYMIZED");
  assert.equal(passengerEmailApprovalRefusal({ anonymized: false, emailOnFile: ON_FILE.toUpperCase(), emailAtRequest: ON_FILE }), null);
  assert.equal(passengerEmailApprovalRefusal({ anonymized: false, emailOnFile: "", emailAtRequest: ON_FILE }), "EMAIL_CHANGED_SINCE_REQUEST");
  assert.equal(passengerEmailApprovalRefusal({ anonymized: false, emailOnFile: ON_FILE, emailAtRequest: "" }), "EMAIL_CHANGED_SINCE_REQUEST");
  assert.equal(passengerEmailApprovalRefusal({ anonymized: false, emailOnFile: "", emailAtRequest: "" }), null);
});
