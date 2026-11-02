/**
 * M4-30 测试角色：查订单的邮箱认法和限速规则（ADR 0061）。
 * 邮箱维度的限速键（`viewLinkLookupEmail` 的结果）必须和核对订单用的键（`contactLookupKey`）是同一个值：
 * 否则攻击者换一种写法（大小写、全角、兼容字符）就能让「对得上」的请求落进不同的限速桶，绕过「一个邮箱一天最多 10 封」。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { contactLookupKey } from "./privacy.ts";
import { VIEW_LINK_REQUEST_LIMITS, viewLinkLookupEmail, viewLinkThrottleSteps } from "./view-link.ts";

test("基本多文种平面的全部码位（另抽补充平面的兼容字符区）：插进邮箱的本地部分和域名中间，认出来的值再认一次不变（幂等），而且就是核对订单用的键", () => {
  const problems: string[] = [];
  const codePoints = [...Array.from({ length: 0x10000 }, (_, i) => i), ...Array.from({ length: 0x400 }, (_, i) => 0x1d400 + i), ...Array.from({ length: 0x100 }, (_, i) => 0x1f100 + i)];
  for (const cp of codePoints) {
    if (problems.length >= 5) break;
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const c = String.fromCodePoint(cp);
    for (const raw of [`a${c}b@example.test`, `AB@EX${c}AMPLE.TEST`]) {
      const once = viewLinkLookupEmail(raw);
      if (once === null) continue;
      if (viewLinkLookupEmail(once) !== once) problems.push(`U+${cp.toString(16)} 不幂等：${JSON.stringify(raw)}`);
      const key = contactLookupKey(once);
      if (key === null || key.kind !== "email" || key.value !== once) problems.push(`U+${cp.toString(16)} 限速键和核对键不同：${JSON.stringify(raw)}`);
    }
  }
  assert.deepEqual(problems, []);
});

test("同一个邮箱的各种写法落进同一个限速桶：大小写、全角、前后的空白和换行、全角空格", () => {
  const forms = ["guest@example.com", "GUEST@EXAMPLE.COM", " guest@example.com\t", "\nGuest@Example.com\r\n", "　ｇｕｅｓｔ＠ｅｘａｍｐｌｅ．ｃｏｍ　", "guest＠example.com"];
  assert.deepEqual(new Set(forms.map(viewLinkLookupEmail)), new Set(["guest@example.com"]));
});

test("不像邮箱的一律不收：手机号、中间有空白或控制字符、零宽字符之外的分隔、没有点、超过 320 字", () => {
  for (const value of ["+81 90-1234-5678", "09012345678", "guest @example.com", "guest@exa mple.com", "guest\u0007@example.com", "guest @example.com", "guest@example", "@example.com", "guest@", `${"a".repeat(309)}@example.com`, "", "   "]) {
    assert.equal(viewLinkLookupEmail(value), null, JSON.stringify(value));
  }
  assert.equal(viewLinkLookupEmail(`${"a".repeat(308)}@example.com`), `${"a".repeat(308)}@example.com`, "正好 320 字收");
});

test("限速顺序和额度：先订单号（小时、天），再邮箱（小时、天）；邮箱一天 10 次、订单号一天 6 次；小时额度不超过天额度", () => {
  assert.deepEqual(viewLinkThrottleSteps().map((step) => [step.dimension, step.scope, step.max]), [
    ["order", "site_link_order_hour", 3],
    ["order", "site_link_order_day", 6],
    ["email", "site_link_email_hour", 3],
    ["email", "site_link_email_day", 10],
  ]);
  const limits = VIEW_LINK_REQUEST_LIMITS;
  assert.ok(limits.orderHour.max <= limits.orderDay.max && limits.emailHour.max <= limits.emailDay.max);
  assert.ok(limits.ip.windowMs <= 15 * 60_000, "按地址的额度窗口最长 15 分钟（ADR 0045）");
});
