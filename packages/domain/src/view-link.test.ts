import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VIEW_LINK_REQUEST_LIMITS,
  VIEW_LINK_VERIFICATIONS,
  VIEW_LINK_VERIFICATION_NAMES,
  viewLinkLookupEmail,
  viewLinkResendRefusal,
  viewLinkThrottleSteps,
} from "./view-link.ts";

test("查订单的邮箱：NFKC 后按邮箱比较的口径（不分大小写、去首尾空白）；不像邮箱的不收", () => {
  assert.equal(viewLinkLookupEmail(" Guest.Site@Example.COM "), "guest.site@example.com");
  assert.equal(viewLinkLookupEmail("ｇｕｅｓｔ＠ｅｘａｍｐｌｅ．ｃｏｍ"), "guest@example.com");
  assert.equal(viewLinkLookupEmail("+81 90-1234-5678"), null, "手机号不能用来查：链接只发邮箱");
  assert.equal(viewLinkLookupEmail("a@"), null);
  assert.equal(viewLinkLookupEmail("@b.c"), null);
  assert.equal(viewLinkLookupEmail("a b@c.d"), null);
  assert.equal(viewLinkLookupEmail("a@b@c.d"), null);
  assert.equal(viewLinkLookupEmail(`${"x".repeat(320)}@example.com`), null);
  assert.equal(viewLinkLookupEmail("a@b.c\r\nBcc: x@y.z"), null, "中间的控制字符一律不收");
  assert.equal(viewLinkLookupEmail("\t A@B.cd \n"), "a@b.cd", "首尾的制表符、换行去掉");
});

test("限速的顺序：（地址在校验之前）订单号（小时、天）→ 邮箱（小时、天）；前面拦下的不占后面的额度", () => {
  const steps = viewLinkThrottleSteps();
  assert.deepEqual(steps.map((step) => step.dimension), ["order", "order", "email", "email"]);
  assert.ok(VIEW_LINK_REQUEST_LIMITS.ip.max <= 10);
  for (const step of steps) {
    assert.ok(step.max > 0 && step.windowMs > 0);
  }
  // 拿它轰炸一个邮箱：每天最多几封
  const perEmailDay = steps.filter((step) => step.dimension === "email" && step.windowMs === 86_400_000).map((step) => step.max);
  assert.deepEqual(perEmailDay, [VIEW_LINK_REQUEST_LIMITS.emailDay.max]);
  assert.ok(VIEW_LINK_REQUEST_LIMITS.emailDay.max <= 10);
  assert.ok(VIEW_LINK_REQUEST_LIMITS.orderDay.max <= 10);
  assert.ok(VIEW_LINK_REQUEST_LIMITS.orderHour.max < VIEW_LINK_REQUEST_LIMITS.orderDay.max);
  assert.ok(VIEW_LINK_REQUEST_LIMITS.emailHour.max < VIEW_LINK_REQUEST_LIMITS.emailDay.max);
});

test("核实方式：每一种都有中文名；没有空的", () => {
  assert.ok(VIEW_LINK_VERIFICATIONS.length >= 3);
  for (const method of VIEW_LINK_VERIFICATIONS) assert.ok(VIEW_LINK_VERIFICATION_NAMES[method].length > 0, method);
});

test("运营重发：不是官网的单、没有邮箱、已脱敏不能发；新邮箱和下单邮箱一样时让他选原邮箱", () => {
  const base = { siteOrder: true, anonymized: false, emailOnFile: "guest@example.com" };
  assert.equal(viewLinkResendRefusal({ ...base, target: "original", newEmail: null }), null);
  assert.equal(viewLinkResendRefusal({ ...base, siteOrder: false, target: "original", newEmail: null }), "NOT_SITE_ORDER");
  assert.equal(viewLinkResendRefusal({ ...base, anonymized: true, target: "original", newEmail: null }), "PASSENGER_ANONYMIZED");
  assert.equal(viewLinkResendRefusal({ ...base, anonymized: true, target: "new_email", newEmail: "new@example.com" }), "PASSENGER_ANONYMIZED");
  assert.equal(viewLinkResendRefusal({ ...base, emailOnFile: " ", target: "original", newEmail: null }), "NO_EMAIL_ON_FILE");
  assert.equal(viewLinkResendRefusal({ ...base, emailOnFile: "", target: "new_email", newEmail: "new@example.com" }), null, "下单时没留邮箱的，核实后可以发到新邮箱");
  assert.equal(viewLinkResendRefusal({ ...base, target: "new_email", newEmail: " GUEST@example.com" }), "SAME_AS_ORDER_EMAIL");
  assert.equal(viewLinkResendRefusal({ ...base, target: "new_email", newEmail: "new@example.com" }), null);
});
