import assert from "node:assert/strict";
import { test } from "node:test";
import { SecretBox, SecretBoxError } from "./secret-box.ts";

const KEY = "unit-test-master-key-not-a-real-secret-000000";

test("加密后能用同一把主密钥、同一个归属解开；每次加密的密文都不同", () => {
  const box = new SecretBox(KEY);
  const a = box.seal("platform-totp-secret", "user-1", "JBSWY3DPEHPK3PXP");
  const b = box.seal("platform-totp-secret", "user-1", "JBSWY3DPEHPK3PXP");
  assert.notEqual(a, b, "随机 IV：同一原文两次加密结果不同");
  assert.match(a, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.ok(!a.includes("JBSWY3DPEHPK3PXP"));
  assert.equal(box.open("platform-totp-secret", "user-1", a), "JBSWY3DPEHPK3PXP");
  assert.equal(new SecretBox(KEY).open("platform-totp-secret", "user-1", b), "JBSWY3DPEHPK3PXP", "换一个实例（重启进程）也能解开");
});

test("换了主密钥、换了归属（搬到别人的行里）、改过任何一段都解不开", () => {
  const box = new SecretBox(KEY);
  const sealed = box.seal("platform-totp-secret", "user-1", "secret");
  assert.throws(() => new SecretBox(`${KEY}x`).open("platform-totp-secret", "user-1", sealed), SecretBoxError);
  assert.throws(() => box.open("platform-totp-secret", "user-2", sealed), SecretBoxError);
  const parts = sealed.split(".");
  for (let i = 1; i < parts.length; i += 1) {
    const changed = [...parts];
    const segment = changed[i] as string;
    changed[i] = `${segment.startsWith("A") ? "B" : "A"}${segment.slice(1)}`;
    assert.throws(() => box.open("platform-totp-secret", "user-1", changed.join(".")), SecretBoxError, `第 ${i} 段被改`);
  }
  for (const bad of ["", "v1", "v2.a.b.c", "v1.a.b", "v1.AAAA.AAAA.AAAA.extra"]) {
    assert.throws(() => box.open("platform-totp-secret", "user-1", bad), SecretBoxError, bad);
  }
});

test("主密钥太短拒绝", () => {
  assert.throws(() => new SecretBox("short"), RangeError);
});

test("不同用途派生不同的子密钥：两步验证密钥的密文不能当 Webhook 签名密钥解开，反过来也不行", () => {
  const box = new SecretBox(KEY);
  const totp = box.seal("platform-totp-secret", "owner-1", "secret");
  const webhook = box.seal("tenant-webhook-secret", "owner-1", "secret");
  assert.throws(() => box.open("tenant-webhook-secret", "owner-1", totp), SecretBoxError);
  assert.throws(() => box.open("platform-totp-secret", "owner-1", webhook), SecretBoxError);
  assert.equal(box.open("tenant-webhook-secret", "owner-1", webhook), "secret");
});
