import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionStore, isExpired } from "./session-store.ts";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

const SESSION = { accessToken: "aaa.bbb.ccc", expiresAt: "2026-01-01T08:00:00.000Z" };

test("两个后台的登录状态分开存，互不覆盖", () => {
  const storage = fakeStorage();
  const store = createSessionStore(storage);
  store.set("tenant", SESSION);
  store.set("platform", { ...SESSION, accessToken: "ppp" });
  assert.equal(store.get("tenant")?.accessToken, "aaa.bbb.ccc");
  assert.equal(store.get("platform")?.accessToken, "ppp");
  assert.deepEqual([...storage.data.keys()].sort(), ["nozomi.session.platform", "nozomi.session.tenant"]);
  store.clear("tenant");
  assert.equal(store.get("tenant"), null);
  assert.equal(store.get("platform")?.accessToken, "ppp");
  assert.deepEqual([...storage.data.keys()], ["nozomi.session.platform"]);
});

test("刷新页面后（新的 store、同一个存储）还能读到", () => {
  const storage = fakeStorage();
  createSessionStore(storage).set("tenant", SESSION);
  assert.deepEqual(createSessionStore(storage).get("tenant"), SESSION);
});

test("只存令牌和过期时间，不存账号资料", () => {
  const storage = fakeStorage();
  createSessionStore(storage).set("tenant", SESSION);
  assert.deepEqual(Object.keys(JSON.parse(storage.data.get("nozomi.session.tenant") ?? "{}")).sort(), ["accessToken", "expiresAt"]);
});

test("存储里的内容被改坏时当作没登录", () => {
  for (const raw of ["", "not json", "null", "[]", '{"accessToken":""}', '{"accessToken":"x","expiresAt":"昨天"}', '{"accessToken":1,"expiresAt":"2026-01-01T00:00:00Z"}']) {
    const store = createSessionStore(fakeStorage({ "nozomi.session.tenant": raw }));
    assert.equal(store.get("tenant"), null, raw);
  }
});

test("没有存储或存储抛错时退回只用内存", () => {
  const memoryOnly = createSessionStore(null);
  memoryOnly.set("tenant", SESSION);
  assert.deepEqual(memoryOnly.get("tenant"), SESSION);
  memoryOnly.clear("tenant");
  assert.equal(memoryOnly.get("tenant"), null);

  const broken = createSessionStore({
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("quota");
    },
    removeItem: () => {
      throw new Error("denied");
    },
  });
  assert.equal(broken.get("platform"), null);
  broken.set("platform", SESSION);
  assert.deepEqual(broken.get("platform"), SESSION);
  broken.clear("platform");
  assert.equal(broken.get("platform"), null);
});

test("过期判断：到点即过期", () => {
  assert.equal(isExpired(SESSION, new Date("2026-01-01T07:59:59.999Z")), false);
  assert.equal(isExpired(SESSION, new Date("2026-01-01T08:00:00.000Z")), true);
});
