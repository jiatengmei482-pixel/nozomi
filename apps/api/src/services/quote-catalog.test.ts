import { test } from "node:test";
import assert from "node:assert/strict";
import { QUOTE_CATALOG_TTL_MS, QuoteCatalogCache } from "./quote-catalog.ts";

test("报价目录的缓存：30 秒内用缓存里的，过了就重新取（改规则后 1 分钟内生效）；试算要新的（fresh）；同时来的请求只取一次；取数失败不留下；条目数有上限", async () => {
  let clock = 0;
  let loads = 0;
  const cache = new QuoteCatalogCache<string>({ now: () => clock, maxEntries: 2 });
  const load = async (): Promise<string> => `第 ${(loads += 1)} 次`;
  assert.equal(await cache.get("tokyo", load), "第 1 次");
  clock = QUOTE_CATALOG_TTL_MS - 1;
  assert.equal(await cache.get("tokyo", load), "第 1 次", "没过期");
  clock = QUOTE_CATALOG_TTL_MS;
  assert.equal(await cache.get("tokyo", load), "第 2 次", "正好到有效期：重新取");
  assert.ok(QUOTE_CATALOG_TTL_MS * 2 <= 60_000, "两个实例各差一个有效期，也在 1 分钟以内");
  // 试算：不用旧的，取到的新数据更新缓存
  assert.equal(await cache.get("tokyo", load, { fresh: true }), "第 3 次");
  assert.equal(await cache.get("tokyo", load), "第 3 次");
  // 同时来几个：只取一次
  const before = loads;
  const slow = (): Promise<string> => new Promise((resolve) => setTimeout(() => resolve(`第 ${(loads += 1)} 次`), 20));
  assert.deepEqual(await Promise.all([cache.get("osaka", slow), cache.get("osaka", slow), cache.get("osaka", slow)]), ["第 4 次", "第 4 次", "第 4 次"]);
  assert.equal(loads, before + 1);
  // 取数失败：抛给调用方，下一次重新取
  await assert.rejects(cache.get("kyoto", async () => Promise.reject(new Error("数据库断了"))), /数据库断了/);
  assert.equal(await cache.get("kyoto", load), "第 5 次");
  // 上限 2 条：最久没用的 tokyo 被挤掉了
  assert.equal(cache.size, 2);
  assert.equal(await cache.get("tokyo", load), "第 6 次");
  cache.clear();
  assert.equal(cache.size, 0);
});
