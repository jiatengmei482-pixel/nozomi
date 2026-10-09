import { test } from "node:test";
import assert from "node:assert/strict";
import { INVITE_TTL_MS, hashInviteToken, newInvite } from "./invite-token.ts";

test("邀请令牌：随机、带前缀、7 天过期；哈希是 SHA-256，从哈希看不出令牌", () => {
  const now = new Date("2026-10-07T01:00:00Z");
  const first = newInvite(now);
  const second = newInvite(now);
  assert.match(first.token, /^nzi_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.token, second.token);
  assert.equal(first.expiresAt.getTime() - now.getTime(), INVITE_TTL_MS);
  assert.equal(INVITE_TTL_MS, 7 * 24 * 60 * 60 * 1000);
  assert.match(first.tokenHash, /^[0-9a-f]{64}$/);
  assert.equal(first.tokenHash, hashInviteToken(first.token));
  assert.ok(!first.tokenHash.includes(first.token.slice(4, 12)));
});
