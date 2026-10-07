import { test } from "node:test";
import assert from "node:assert/strict";
import { newInvite } from "./invite-token.ts";
import { RESET_TTL_MS, hashResetToken, newPlatformResetToken, newTenantResetToken, tenantIdOfResetToken } from "./reset-token.ts";

const now = new Date("2026-10-07T01:00:00Z");
const TENANT = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

test("重置令牌：随机、24 小时过期、哈希是 SHA-256，从哈希看不出令牌", () => {
  const first = newPlatformResetToken(now);
  const second = newPlatformResetToken(now);
  assert.match(first.token, /^nzr_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.token, second.token);
  assert.equal(first.expiresAt.getTime() - now.getTime(), RESET_TTL_MS);
  assert.equal(RESET_TTL_MS, 24 * 60 * 60 * 1000);
  assert.match(first.tokenHash, /^[0-9a-f]{64}$/);
  assert.equal(first.tokenHash, hashResetToken(first.token));
});

test("租户的重置令牌带着租户编号，能原样取回；大小写不同的租户编号得到同样的写法", () => {
  const issued = newTenantResetToken(TENANT.toUpperCase(), now);
  assert.match(issued.token, /^nzr_[0-9a-f]{32}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(tenantIdOfResetToken(issued.token), TENANT);
  assert.notEqual(newTenantResetToken(TENANT, now).token, issued.token);
});

test("取不出租户编号的令牌：平台的重置令牌、邀请令牌、被截断或加了东西的令牌，一律返回 null", () => {
  const tenantToken = newTenantResetToken(TENANT, now).token;
  const bad = [
    newPlatformResetToken(now).token,
    newInvite(now).token,
    "",
    "nzr_",
    tenantToken.slice(0, -1),
    `${tenantToken}x`,
    tenantToken.replace(".", "_"),
    tenantToken.replace("nzr_", "nzr_G"),
    ` ${tenantToken}`,
    `${tenantToken}\n`,
  ];
  for (const token of bad) assert.equal(tenantIdOfResetToken(token), null, JSON.stringify(token));
});
