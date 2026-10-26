/**
 * 测试角色补充（M3-11，F2）：官网客服电话 SITE_SUPPORT_PHONE 的格式边界。
 * 订单页把它做成 `tel:` 链接（只留 + 和数字），所以配置要挡住拨不通的号码：和客人手机号同一口径（E.164：+ 国家码不以 0 开头，共 8–15 位数字）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ConfigError, loadConfig } from "./index.ts";

const base = { DATABASE_URL: "postgres://app:pw@localhost:5432/nozomi", AUTH_JWT_SECRET: "x".repeat(40) };

function phoneIssue(value: string): boolean {
  try {
    loadConfig({ ...base, SITE_SUPPORT_PHONE: value });
    return false;
  } catch (e) {
    if (e instanceof ConfigError) return e.issues.some((issue) => issue.includes("SITE_SUPPORT_PHONE"));
    throw e;
  }
}

test("客服电话：常见的国际写法都接受，原样保存（首尾空白去掉）", () => {
  for (const ok of ["+81 3-1234-5678", "+81312345678", "+86 400 123 4567", "+1 212-555-0100", "+82 2-1234-5678", "+12345678", "+123456789012345"]) {
    assert.equal(phoneIssue(ok), false, ok);
    assert.equal(loadConfig({ ...base, SITE_SUPPORT_PHONE: `\t${ok} ` }).siteSupportPhone, ok);
  }
});

test("客服电话：不带 +、全角、带分机说明、带括号或点的写法不接受", () => {
  for (const wrong of ["81312345678", "＋81 3-1234-5678", "+81 3-1234-5678 ext 2", "+81 (3) 1234-5678", "+81.3.1234.5678", "+81 3-1234-5678\n+81 3-0000-0000"]) {
    assert.equal(phoneIssue(wrong), true, wrong);
  }
});

test("客服电话：拨不通的号码不接受——数字太少、太多，或国家码以 0 开头（tel: 链接里只剩下 + 和数字）", () => {
  for (const wrong of ["+1 - - - 2", "+1      2", "+1234567", "+1234567890123456", "+0 3-1234-5678", "+81 - - - - - - 5"]) {
    assert.equal(phoneIssue(wrong), true, `应拒绝：${JSON.stringify(wrong)}（数字：${wrong.replace(/[^\d]/g, "").length} 位）`);
  }
});
