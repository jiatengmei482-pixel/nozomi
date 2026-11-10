import { test } from "node:test";
import assert from "node:assert/strict";
import { ConfigError, integrationStatus, loadConfig } from "./index.ts";

const base = {
  DATABASE_URL: "postgres://app:pw@localhost:5432/nozomi",
  AUTH_JWT_SECRET: "x".repeat(64),
  DATA_ENCRYPTION_KEY: "k".repeat(40),
};
const TOKEN = "qa-token-for-config-tests-only-Zx81Q0vB7mN2";

function issuesOf(env: Record<string, string>): string[] {
  try {
    loadConfig(env);
  } catch (e) {
    if (e instanceof ConfigError) return e.issues;
    throw e;
  }
  return [];
}

test("验收通道口令（ADR 0078）：不配 = null（没有验收通道），空白也算不配", () => {
  assert.equal(loadConfig({ ...base, APP_ENV: "staging" }).qaAcceptance, null);
  assert.equal(loadConfig({ ...base, APP_ENV: "staging", QA_ACCEPTANCE_TOKEN: "   " }).qaAcceptance, null);
  assert.equal(loadConfig({ ...base, APP_ENV: "production" }).qaAcceptance, null);
});

test("验收通道口令：staging / local / ci 配了就有；production 配了启动失败，报错里没有口令", () => {
  for (const appEnv of ["staging", "local", "ci"]) assert.deepEqual(loadConfig({ ...base, APP_ENV: appEnv, QA_ACCEPTANCE_TOKEN: TOKEN }).qaAcceptance, { token: TOKEN }, appEnv);
  let error: unknown = null;
  try {
    loadConfig({ ...base, APP_ENV: "production", QA_ACCEPTANCE_TOKEN: TOKEN });
  } catch (err) {
    error = err;
  }
  assert.ok(error instanceof ConfigError, "production 配了口令必须拒绝启动");
  assert.ok(error.issues.some((issue) => issue.includes("production 环境不能配置 QA_ACCEPTANCE_TOKEN")));
  assert.ok(!error.message.includes(TOKEN), "报错里不能有口令");
});

test("验收通道口令：太短、太长、有空白、和别的密钥相同都报错，报错里没有口令", () => {
  const cases = ["short-token", "y".repeat(257), `${"z".repeat(32)} tail`, base.AUTH_JWT_SECRET, base.DATA_ENCRYPTION_KEY];
  for (const token of cases) {
    const issues = issuesOf({ ...base, APP_ENV: "staging", QA_ACCEPTANCE_TOKEN: token });
    assert.equal(issues.length, 1, token.slice(0, 8));
    assert.ok(issues[0]?.startsWith("QA_ACCEPTANCE_TOKEN"));
    assert.ok(!issues.join("\n").includes(token), "报错里不能有口令原文");
  }
});

test("验收通道口令不出现在集成状态里（/health、config:check 不透露有没有验收通道）", () => {
  const config = loadConfig({ ...base, APP_ENV: "staging", QA_ACCEPTANCE_TOKEN: TOKEN });
  const text = JSON.stringify(integrationStatus(config));
  assert.ok(!text.includes(TOKEN));
  assert.ok(!/QA_ACCEPTANCE|验收/.test(text));
});
