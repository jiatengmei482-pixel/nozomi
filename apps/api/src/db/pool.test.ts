import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_QUERY_TIMEOUT_MS,
  DEFAULT_STATEMENT_TIMEOUT_MS,
  createPool,
  driverErrorCode,
  isDriverTimeout,
  timedQuery,
} from "./pool.ts";
import { UNREACHABLE_DATABASE_URL } from "../testing/fixtures.ts";

test("连接池默认带三层超时和 TCP keepalive；客户端时限比数据库端时限长", async () => {
  const pool = createPool(UNREACHABLE_DATABASE_URL);
  assert.equal(pool.options.query_timeout, DEFAULT_QUERY_TIMEOUT_MS);
  assert.equal(pool.options.statement_timeout, DEFAULT_STATEMENT_TIMEOUT_MS);
  assert.ok(DEFAULT_QUERY_TIMEOUT_MS > DEFAULT_STATEMENT_TIMEOUT_MS);
  assert.equal(pool.options.connectionTimeoutMillis, 5_000);
  assert.equal(pool.options.keepAlive, true);
  await pool.end();
});

test("时限传 0 表示不限（迁移用）", async () => {
  const pool = createPool(UNREACHABLE_DATABASE_URL, { queryTimeoutMs: 0, statementTimeoutMs: 0 });
  assert.equal(pool.options.query_timeout, undefined);
  assert.equal(pool.options.statement_timeout, undefined);
  await pool.end();
});

test("timedQuery：时限向上取整且至少 1 毫秒；没给的项不出现", () => {
  assert.deepEqual(timedQuery("select 1", 250.2), { text: "select 1", query_timeout: 251 });
  assert.deepEqual(timedQuery("select 1", 0), { text: "select 1", query_timeout: 1 });
  assert.deepEqual(timedQuery("select $1", undefined, [7]), { text: "select $1", values: [7] });
  assert.deepEqual(timedQuery("select 1", undefined), { text: "select 1" });
});

test("driverErrorCode / isDriverTimeout", () => {
  assert.equal(driverErrorCode(Object.assign(new Error("x"), { code: "ECONNREFUSED" })), "ECONNREFUSED");
  assert.equal(driverErrorCode(new Error("x")), null);
  assert.equal(driverErrorCode({ code: 42 }), null);
  assert.equal(driverErrorCode(null), null);
  assert.equal(isDriverTimeout(new Error("Query read timeout")), true);
  assert.equal(isDriverTimeout(new Error("connect ECONNREFUSED")), false);
  assert.equal(isDriverTimeout("timeout"), false);
});
