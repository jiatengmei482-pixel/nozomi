import { test } from "node:test";
import assert from "node:assert/strict";
import { EMAIL_CODE_MAX_ATTEMPTS, EMAIL_CODE_RESEND_INTERVAL_MS, EMAIL_CODE_SEND_COOLDOWN, EMAIL_CODE_SEND_LIMITS_PER_EMAIL, EMAIL_CODE_TTL_MS, emailCodeMail, maskEmail, resolveLoginMethods } from "./email-login.ts";

test("登录方式：验证码只看邮件配没配；密码只有明确关闭且邮件可用时才关，没有邮件时关了也仍然开着", () => {
  assert.deepEqual(resolveLoginMethods({ mailConfigured: false, passwordLoginDisabled: false }), { emailCode: false, password: true });
  assert.deepEqual(resolveLoginMethods({ mailConfigured: true, passwordLoginDisabled: false }), { emailCode: true, password: true });
  assert.deepEqual(resolveLoginMethods({ mailConfigured: false, passwordLoginDisabled: true }), { emailCode: false, password: true });
  assert.deepEqual(resolveLoginMethods({ mailConfigured: true, passwordLoginDisabled: true }), { emailCode: true, password: false });
});

test("任何组合下都至少有一种登录方式", () => {
  for (const mailConfigured of [true, false]) {
    for (const passwordLoginDisabled of [true, false]) {
      const methods = resolveLoginMethods({ mailConfigured, passwordLoginDisabled });
      assert.ok(methods.emailCode || methods.password);
    }
  }
});

test("打码：只留第一个字符和域名；不合常理的输入也不露原文", () => {
  assert.equal(maskEmail("zhang.san@example.com"), "z***@example.com");
  assert.equal(maskEmail("a@b.co"), "a***@b.co");
  assert.equal(maskEmail("no-at-sign"), "***");
  assert.equal(maskEmail("@example.com"), "***");
});

test("邮件：主题没有验证码，正文有验证码、有效期、哪个后台、不是本人请忽略，没有链接", () => {
  const code = "042917";
  for (const [portal, name] of [["platform", "运营后台"], ["tenant", "供应商后台"]] as const) {
    const mail = emailCodeMail(portal, code);
    assert.ok(!mail.subject.includes(code));
    assert.ok(mail.text.includes(code), "前导 0 不丢");
    assert.ok(mail.text.includes(name));
    assert.ok(mail.text.includes("10 分钟"));
    assert.ok(mail.text.includes("如果不是你本人操作，请忽略"));
    assert.doesNotMatch(mail.text, /https?:|www\.|<a\b/);
  }
});

test("限速的数字：一个账号每天最多被猜 100 次；连发间隔和页面的倒计时是同一个数", () => {
  const daily = EMAIL_CODE_SEND_LIMITS_PER_EMAIL.find((limit) => limit.windowMs === 24 * 60 * 60 * 1000);
  assert.equal((daily?.maxSends ?? 0) * EMAIL_CODE_MAX_ATTEMPTS, 100);
  assert.equal(EMAIL_CODE_SEND_COOLDOWN.windowMs, EMAIL_CODE_RESEND_INTERVAL_MS);
  assert.equal(EMAIL_CODE_SEND_COOLDOWN.maxSends, 1);
  assert.equal(EMAIL_CODE_TTL_MS, 600_000);
});
