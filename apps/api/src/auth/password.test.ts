import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, verifyPasswordAgainstNothing } from "./password.ts";

test("哈希的格式是 scrypt$版本$盐$哈希，里面没有密码原文；同一个密码每次的盐都不同", async () => {
  const password = "Quiet-Harbor-2026";
  const [first, second] = await Promise.all([hashPassword(password), hashPassword(password)]);
  assert.match(first, /^scrypt\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
  assert.ok(!first.includes(password));
  assert.notEqual(first, second);
});

test("正确的密码验证通过，错误的不通过（差一个字符、大小写不同、多一个空格）", async () => {
  const stored = await hashPassword("Quiet-Harbor-2026");
  assert.equal(await verifyPassword("Quiet-Harbor-2026", stored), true);
  for (const wrong of ["Quiet-Harbor-2027", "quiet-harbor-2026", "Quiet-Harbor-2026 ", ""]) {
    assert.equal(await verifyPassword(wrong, stored), false, wrong);
  }
});

test("同一个字符的不同 Unicode 写法视为同一个密码（NFKC 归一化）", async () => {
  const composed = "Café-Harbor-2026";
  const decomposed = "Café-Harbor-2026";
  assert.notEqual(composed, decomposed);
  assert.equal(await verifyPassword(decomposed, await hashPassword(composed)), true);
});

test("存储值格式不对、版本未知、被截断：一律验证不通过，不抛错", async () => {
  const stored = await hashPassword("Quiet-Harbor-2026");
  const [, , salt, key] = stored.split("$") as [string, string, string, string];
  const broken = [
    "",
    "not-a-hash",
    `bcrypt$1$${salt}$${key}`,
    `scrypt$99$${salt}$${key}`,
    `scrypt$1$${salt}$${key.slice(0, 20)}`,
    `scrypt$1$${salt}`,
    `${stored}$extra`,
  ];
  for (const value of broken) assert.equal(await verifyPassword("Quiet-Harbor-2026", value), false, value);
});

test("没有账号时的占位验证：永远不通过，而且真的做了同样量级的计算（不是立刻返回）", async () => {
  const stored = await hashPassword("Quiet-Harbor-2026");
  const timed = async (run: () => Promise<boolean>): Promise<number> => {
    const startedAt = performance.now();
    await run();
    return performance.now() - startedAt;
  };
  assert.equal(await verifyPasswordAgainstNothing("Quiet-Harbor-2026"), false);
  const real = await timed(() => verifyPassword("wrong-password", stored));
  const dummy = await timed(() => verifyPasswordAgainstNothing("wrong-password"));
  assert.ok(dummy > real / 5, `占位 ${dummy.toFixed(1)}ms，真实 ${real.toFixed(1)}ms`);
});
