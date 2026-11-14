/**
 * 嵌入页本标签页的订单记录（M9E-17，ADR 0095 第八节第 2 小节）：草稿号对得上、令牌格式对、1 小时内才给；过期、写坏的按 stale（调用方删）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EMBED_ORDER_TTL_MS, readEmbedOrderRecord } from "./embed-order-store.ts";

const DRAFT = "D".repeat(43);
const OTHER = "E".repeat(43);
const TOKEN = `nzo_${"a".repeat(43)}`;
const NOW = 1_800_000_000_000;
const record = (changes: Record<string, unknown> = {}): string => JSON.stringify({ draft: DRAFT, token: TOKEN, at: NOW - 1_000, ...changes });

test("同一个草稿、1 小时内：给令牌", () => {
  assert.equal(readEmbedOrderRecord(record(), DRAFT, NOW), TOKEN);
  assert.equal(readEmbedOrderRecord(record({ at: NOW - EMBED_ORDER_TTL_MS + 1 }), DRAFT, NOW), TOKEN);
});

test("没有记录、别的草稿：null（别的草稿的记录不删，可能是同一标签页里另一次预订）", () => {
  assert.equal(readEmbedOrderRecord(null, DRAFT, NOW), null);
  assert.equal(readEmbedOrderRecord(record(), OTHER, NOW), null);
});

test("过期（满 1 小时）、时间在未来、写坏、令牌或草稿号格式不对：stale", () => {
  for (const raw of [
    record({ at: NOW - EMBED_ORDER_TTL_MS }),
    record({ at: NOW + 120_000 }),
    record({ at: "x" }),
    record({ token: "nzo_short" }),
    record({ token: `#${TOKEN}` }),
    record({ draft: "short" }),
    "{",
    "null",
    "[]",
  ]) {
    assert.equal(readEmbedOrderRecord(raw, DRAFT, NOW), "stale", raw);
  }
});
