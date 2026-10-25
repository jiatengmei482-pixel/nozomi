import { test } from "node:test";
import assert from "node:assert/strict";
import { hashDriverToken, newDriverToken, tenantIdOfDriverToken } from "./driver-token.ts";

const TENANT = "7b1c2d3e-aaaa-4bbb-8ccc-ddddeeeeffff";

test("司机链接的令牌：带着租户编号、随机部分 32 字节；库里只存 SHA-256；每次都不同", () => {
  const first = newDriverToken(TENANT.toUpperCase());
  const second = newDriverToken(TENANT);
  assert.match(first.token, /^nzd_7b1c2d3eaaaa4bbb8cccddddeeeeffff\.[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.token, second.token);
  assert.equal(first.tokenHash, hashDriverToken(first.token));
  assert.match(first.tokenHash, /^[0-9a-f]{64}$/);
  assert.ok(!first.tokenHash.includes(first.token.slice(4, 20)));
  assert.equal(tenantIdOfDriverToken(first.token), TENANT);
});

test("格式不对的令牌认不出租户（包括别的令牌、改了长度、换了前缀）", () => {
  const { token } = newDriverToken(TENANT);
  for (const bad of ["", "garbage", token.slice(0, -1), `${token}x`, token.replace("nzd_", "nzr_"), `nzd_${"g".repeat(32)}.${"a".repeat(43)}`]) {
    assert.equal(tenantIdOfDriverToken(bad), null, bad);
  }
});
