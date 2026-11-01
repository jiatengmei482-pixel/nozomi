/**
 * M4-21 QA：`PASSENGER_RETENTION_DAYS`、`PASSENGER_RETENTION_ENABLED` 配错必须启动失败（脱敏不可逆，不能静默用一个小值）。已有 index.test.ts 测过 179、0、-1、abc、180.5。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigError, loadConfig } from "./index.ts";

const base = { DATABASE_URL: "postgres://app@localhost/db", AUTH_JWT_SECRET: "x".repeat(48) };

function issuesOf(env: Record<string, string>): string[] {
  try {
    loadConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) return err.issues;
    throw err;
  }
  return [];
}

const rejected = (name: string, value: string): boolean => issuesOf({ ...base, [name]: value }).some((issue) => issue.startsWith(name));

test("前提：合法的值都能启动", () => {
  assert.deepEqual(loadConfig({ ...base, PASSENGER_RETENTION_DAYS: "180", PASSENGER_RETENTION_ENABLED: "true" }).passengerRetention, { enabled: true, days: 180 });
  assert.equal(loadConfig({ ...base, PASSENGER_RETENTION_DAYS: "36500" }).passengerRetention.days, 36_500);
});

for (const value of ["36501", "99999999", "1e9", "Infinity", "-Infinity", "NaN", "null", "undefined", "180abc", "abc180", "180 天", "１８０", "true", "-180", "179.999", "0.5", "1e2"]) {
  test(`PASSENGER_RETENTION_DAYS=${value} 启动失败`, () => {
    assert.equal(rejected("PASSENGER_RETENTION_DAYS", value), true);
  });
}

for (const value of ["0xB4", "0x100", "1e3", "2E2"]) {
  test(`PASSENGER_RETENTION_DAYS=${value}（不是十进制整数）启动失败：不能靠隐式转换算出一个没人写过的天数`, () => {
    assert.equal(rejected("PASSENGER_RETENTION_DAYS", value), true);
  });
}

for (const value of ["TRUE", "False", "1", "0", "yes", "no", "on", "off", " false", "false "]) {
  test(`PASSENGER_RETENTION_ENABLED=${value} 启动失败：写错的开关不能当成默认的「开」`, () => {
    assert.equal(rejected("PASSENGER_RETENTION_ENABLED", value), true);
  });
}
