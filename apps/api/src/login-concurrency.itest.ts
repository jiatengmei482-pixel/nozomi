/**
 * 同一个账号并行登录（端到端测试刚开跑时多个用例同时用同一个管理员登录）偶尔有一条拿到 500。
 * 根因：登录成功后「退还来源地址的那一次计数」分两条语句（先删等于 1 的、再无条件减一），两次登录同时成功时
 * 后一个把计数减成 0，撞上 login_throttles 的检查约束。这里先用两个事务把那个交错摆出来（稳定复现），
 * 再经真实接口并行登录（并发数超过连接池大小），核对结果只有 200 和 429，没有 500。平台、租户两侧都测。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { withPreAuthTx } from "./db/context.ts";
import { refundLoginAttempt, reserveLoginAttempt } from "./repos/login-throttles.ts";
import { type ApiResponse, TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";

let api: TestApi;
const ADMIN = "root@platform.test";
const TENANT_ADMIN = "admin@parallel.test";

before(async () => {
  api = await createTestApi();
  const root = await api.superAdminToken(ADMIN);
  await api.tenantWithAdmin(root, "并行车队", TENANT_ADMIN);
});
after(() => api.close());

async function counter(key: string): Promise<number | null> {
  const result = await api.db.owner.query<{ attempt_count: number }>("select attempt_count from login_throttles where key = $1", [key]);
  return result.rows[0]?.attempt_count ?? null;
}

test("退还计数的交错：两次登录都占用了同一个来源地址的计数，前一个退还还没提交时后一个也来退还——两个都成功，计数不会减成 0", async () => {
  const now = api.clock.now();
  for (const [label, reservations] of [["两次占用、两次退还", 2], ["三次占用、两次退还", 3]] as const) {
    const key = `interleave-${reservations}`;
    for (let i = 0; i < reservations; i += 1) await withPreAuthTx(api.db.pool, (db) => reserveLoginAttempt(db, key, now));
    assert.equal(await counter(key), reservations);
    let firstRefunded!: () => void;
    let release!: () => void;
    const refunded = new Promise<void>((resolve) => (firstRefunded = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    // 第一个事务退还之后先不提交
    const first = withPreAuthTx(api.db.pool, async (db) => {
      await refundLoginAttempt(db, key);
      firstRefunded();
      await gate;
    });
    await refunded;
    // 第二个事务这时来退还：它会等第一个提交，然后必须按提交后的计数重新判断
    const second = withPreAuthTx(api.db.pool, (db) => refundLoginAttempt(db, key));
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    await assert.doesNotReject(Promise.all([first, second]), label);
    assert.equal(await counter(key), reservations === 2 ? null : 1, `${label}：两次都退还之后剩下的计数`);
  }
  // 顺序执行时的结果不变：1 → 行被删掉；不存在的 key 什么都不做
  await withPreAuthTx(api.db.pool, (db) => reserveLoginAttempt(db, "alone", now));
  await withPreAuthTx(api.db.pool, (db) => refundLoginAttempt(db, "alone"));
  assert.equal(await counter("alone"), null);
  await assert.doesNotReject(withPreAuthTx(api.db.pool, (db) => refundLoginAttempt(db, "never-reserved")));
});

async function parallelLogins(path: string, email: string, count: number): Promise<ApiResponse[]> {
  return Promise.all(Array.from({ length: count }, () => api.call("POST", path, { body: { email, password: TEST_PASSWORD } })));
}

for (const [side, path, email] of [["平台", "/platform/v1/auth/login", ADMIN], ["租户", "/tenant/v1/auth/login", TENANT_ADMIN]] as const) {
  test(`${side}：同一个账号并行登录（2 到 12 个同时来，超过连接池的 5 条连接），每一个不是 200 就是 429（带 Retry-After），没有 500；成功的各有各的会话`, async () => {
    const seen = new Set<string>();
    let succeeded = 0;
    for (let round = 0; round < 16; round += 1) {
      const count = [2, 2, 3, 4, 2, 3, 8, 12][round % 8] as number;
      const results = await parallelLogins(path, email, count);
      for (const res of results) {
        assert.ok(res.status === 200 || res.status === 429, `第 ${round + 1} 轮（${count} 个并行）出现了 ${res.status}：${res.text}`);
        if (res.status === 429) {
          assert.equal(res.body.error.code, "TOO_MANY_LOGIN_ATTEMPTS");
          assert.ok(Number(res.headers["retry-after"]) > 0);
        } else {
          succeeded += 1;
          seen.add(res.body.access_token);
        }
      }
      // 同一个邮箱在途的尝试最多 5 个：不超过 5 个并行时全部成功
      if (count <= 5) assert.deepEqual(results.map((res) => res.status), Array.from({ length: count }, () => 200), `第 ${round + 1} 轮`);
      else assert.ok(results.filter((res) => res.status === 200).length >= 1, "超过 5 个并行时至少有成功的");
    }
    assert.equal(seen.size, succeeded, "每次成功的登录都是一个新会话");
    // 全部结束后没有留下小于 1 的计数；成功的登录把自己的计数都退掉了
    const rows = await api.db.owner.query<{ attempt_count: number }>("select attempt_count from login_throttles");
    assert.ok(rows.rows.every((row) => row.attempt_count >= 1));
    // 令牌都能用
    const prefix = path.replace("/auth/login", "");
    for (const token of [...seen].slice(0, 5)) assert.equal((await api.call("GET", `${prefix}/auth/me`, { token })).status, 200);
  });
}
