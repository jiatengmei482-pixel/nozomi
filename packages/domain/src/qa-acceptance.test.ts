import { test } from "node:test";
import assert from "node:assert/strict";
import { PRODUCT_STATUSES, PRODUCT_STATUS_NAMES } from "./products.ts";
import { QA_ACCEPTANCE_MAIL_RECIPIENT, QA_ACCEPTANCE_RULES, listedFor, qaAcceptanceEnabled, qaAcceptanceGuestEmailAllowed, qaAcceptanceMailAllowed, qaAcceptanceTokenIssue } from "./qa-acceptance.ts";

test("验收通道：配置了口令、而且不是 production 才开（两道关）", () => {
  assert.equal(qaAcceptanceEnabled("staging", true), true);
  assert.equal(qaAcceptanceEnabled("local", true), true);
  assert.equal(qaAcceptanceEnabled("ci", true), true);
  assert.equal(qaAcceptanceEnabled("production", true), false);
  assert.equal(qaAcceptanceEnabled("staging", false), false);
  assert.equal(qaAcceptanceEnabled("production", false), false);
});

test("口令的写法：32–256 个可见 ASCII 字符，不含空白；不合格只给原因代码", () => {
  assert.equal(qaAcceptanceTokenIssue("a".repeat(31)), "TOO_SHORT");
  assert.equal(qaAcceptanceTokenIssue("a".repeat(32)), null);
  assert.equal(qaAcceptanceTokenIssue("a".repeat(256)), null);
  assert.equal(qaAcceptanceTokenIssue("a".repeat(257)), "TOO_LONG");
  assert.equal(qaAcceptanceTokenIssue(`${"a".repeat(32)} b`), "INVALID_CHARACTERS");
  assert.equal(qaAcceptanceTokenIssue(`${"a".repeat(32)}口令`), "INVALID_CHARACTERS");
  assert.equal(qaAcceptanceTokenIssue(`${"a".repeat(32)}\n`), "INVALID_CHARACTERS");
});

test("验收单的客人邮箱：只认 …@example.com 和验收专用邮箱，不分大小写、全角转半角", () => {
  for (const email of ["guest@example.com", "Guest.Two+tag@Example.COM", " a@example.com ", QA_ACCEPTANCE_MAIL_RECIPIENT, "QA-Staging@Nozomi.MoveGlobal.io", "ｇｕｅｓｔ＠ｅｘａｍｐｌｅ．ｃｏｍ"]) {
    assert.equal(qaAcceptanceGuestEmailAllowed(email), true, email);
  }
  for (const email of ["guest@gmail.com", "guest@sub.example.com", "guest@example.com.cn", "guest@notexample.com", "@example.com", "a@b@example.com", "qa-staging@nozomi.moveglobal.io.evil.com", "other@nozomi.moveglobal.io", ""]) {
    assert.equal(qaAcceptanceGuestEmailAllowed(email), false, email);
  }
});

test("验收单的邮件：只有收件人正好是验收专用邮箱才真的发", () => {
  assert.equal(qaAcceptanceMailAllowed(QA_ACCEPTANCE_MAIL_RECIPIENT), true);
  assert.equal(qaAcceptanceMailAllowed(" QA-STAGING@nozomi.moveglobal.io "), true);
  for (const recipient of ["guest@example.com", "supplier@gmail.com", "qa-staging@nozomi.moveglobal.io.cn", "driver@example.com"]) assert.equal(qaAcceptanceMailAllowed(recipient), false, recipient);
});

test("报价时商品算不算在卖：普通客人只认已上架且供应商参与比价；验收会话只认测试供应商的验收可售，不看入驻状态", () => {
  assert.equal(listedFor("public", { status: "published", tenantActive: true }), null);
  assert.equal(listedFor("public", { status: "published", tenantActive: false }), "TENANT_NOT_ACTIVE");
  assert.equal(listedFor("public", { status: "qa_listed", tenantActive: false, testTenant: true }), "PRODUCT_NOT_PUBLISHED", "普通客人永远看不到验收可售");
  assert.equal(listedFor("public", { status: "draft", tenantActive: true }), "PRODUCT_NOT_PUBLISHED");
  assert.equal(listedFor("acceptance", { status: "qa_listed", tenantActive: false, testTenant: true }), null);
  assert.equal(listedFor("acceptance", { status: "qa_listed", tenantActive: true, testTenant: false }), "PRODUCT_NOT_PUBLISHED", "不是测试供应商的不算");
  assert.equal(listedFor("acceptance", { status: "published", tenantActive: true, testTenant: false }), "PRODUCT_NOT_PUBLISHED", "验收会话不看真实供应商的上架商品");
  assert.equal(listedFor("acceptance", { status: "published", tenantActive: false, testTenant: true }), "PRODUCT_NOT_PUBLISHED");
});

test("商品状态有「验收可售」，规则常量合理", () => {
  assert.ok(PRODUCT_STATUSES.includes("qa_listed"));
  assert.equal(PRODUCT_STATUS_NAMES.qa_listed, "验收可售");
  assert.ok(QA_ACCEPTANCE_RULES.sessionMs <= 8 * 3_600_000, "会话不超过几小时");
  assert.ok(QA_ACCEPTANCE_RULES.unlockPerIp.max < QA_ACCEPTANCE_RULES.unlockGlobal.max);
});
