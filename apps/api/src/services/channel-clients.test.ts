import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_RETIRED_SECRETS, type RetiredSecret, SECRET_ROTATION_GRACE_MS, retireSecret, usableRetired } from "./channel-clients.ts";

const at = (iso: string): Date => new Date(iso);
const T0 = "2026-10-07T00:00:00.000Z";

test("轮换：被换下的那一代从换下的时刻起保留 24 小时；再轮换一次，之前那一代的 24 小时照旧，不被顶掉", () => {
  const first = retireSecret([], { generation: 1, hash: "h1" }, at(T0), false);
  assert.deepEqual(first, [{ generation: 1, hash: "h1", valid_until: "2026-10-08T00:00:00.000Z" }]);
  const second = retireSecret(first, { generation: 2, hash: "h2" }, at("2026-10-07T00:01:00.000Z"), false);
  assert.deepEqual(second.map((entry) => [entry.generation, entry.valid_until]), [[1, "2026-10-08T00:00:00.000Z"], [2, "2026-10-08T00:01:00.000Z"]]);
  // 第一代到点那一刻失效，第二代还在
  assert.deepEqual(usableRetired(second, at("2026-10-08T00:00:00.000Z")).map((entry) => entry.generation), [2]);
  assert.deepEqual(usableRetired(second, at("2026-10-07T23:59:59.999Z")).map((entry) => entry.generation), [1, 2]);
});

test("轮换：立即作废清空所有旧代；过期的旧代在下一次轮换时清掉；同时最多保留 5 代，多了去掉最早的", () => {
  const list: RetiredSecret[] = [{ generation: 1, hash: "h1", valid_until: "2026-10-08T00:00:00.000Z" }];
  assert.deepEqual(retireSecret(list, { generation: 2, hash: "h2" }, at(T0), true), []);
  const later = retireSecret(list, { generation: 2, hash: "h2" }, at("2026-10-09T00:00:00.000Z"), false);
  assert.deepEqual(later.map((entry) => entry.generation), [2]);
  let many: RetiredSecret[] = [];
  for (let generation = 1; generation <= 7; generation += 1) many = retireSecret(many, { generation, hash: `h${generation}` }, new Date(at(T0).getTime() + generation * 60_000), false);
  assert.equal(many.length, MAX_RETIRED_SECRETS);
  assert.deepEqual(many.map((entry) => entry.generation), [3, 4, 5, 6, 7]);
  assert.equal(new Date(many[4]?.valid_until ?? "").getTime() - (at(T0).getTime() + 7 * 60_000), SECRET_ROTATION_GRACE_MS);
});
