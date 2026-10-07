import { test } from "node:test";
import assert from "node:assert/strict";
import { ConfigError, integrationStatus, loadConfig, mask } from "./index.ts";

const base = {
  DATABASE_URL: "postgres://app:pw@localhost:5432/nozomi",
  AUTH_JWT_SECRET: "x".repeat(40),
};
const stripeTest = {
  STRIPE_SECRET_KEY: "sk_test_51Habcdefghijklmnop",
  STRIPE_PUBLISHABLE_KEY: "pk_test_51Habcdefghijklmnop",
  STRIPE_WEBHOOK_SECRET: "whsec_abcdefghijklmnop",
};

function issuesOf(env: Record<string, string>): string[] {
  try {
    loadConfig(env);
  } catch (e) {
    if (e instanceof ConfigError) return e.issues;
    throw e;
  }
  return [];
}

test("local 环境只需数据库和登录密钥，第三方集成显示未配置", () => {
  const c = loadConfig(base);
  assert.equal(c.appEnv, "local");
  assert.equal(c.stripe, null);
  const status = integrationStatus(c);
  assert.equal(status.find((s) => s.key === "stripe")?.state, "missing");
  assert.equal(status.find((s) => s.key === "googleMaps")?.state, "missing");
});

test("缺少 DATABASE_URL 时报错", () => {
  assert.ok(issuesOf({ AUTH_JWT_SECRET: "x".repeat(40) }).some((i) => i.startsWith("DATABASE_URL")));
});

test("staging 环境必须配齐 Stripe 和谷歌地图", () => {
  const issues = issuesOf({ ...base, APP_ENV: "staging" });
  assert.ok(issues.some((i) => i.includes("Stripe")));
  assert.ok(issues.some((i) => i.includes("GOOGLE_MAPS_API_KEY")));
});

test("Stripe 只填一部分时报错", () => {
  const issues = issuesOf({ ...base, STRIPE_SECRET_KEY: stripeTest.STRIPE_SECRET_KEY });
  assert.ok(issues.some((i) => i.includes("同时配置")));
});

test("非 production 环境禁止 Stripe 正式密钥", () => {
  const issues = issuesOf({
    ...base,
    APP_ENV: "staging",
    GOOGLE_MAPS_API_KEY: "AIzaSyExample000000000000000",
    STRIPE_SECRET_KEY: "sk_live_51Habcdefghijklmnop",
    STRIPE_PUBLISHABLE_KEY: "pk_live_51Habcdefghijklmnop",
    STRIPE_WEBHOOK_SECRET: "whsec_abcdefghijklmnop",
  });
  assert.ok(issues.some((i) => i.includes("禁止使用 Stripe 正式")));
});

test("测试密钥和正式密钥不能混用", () => {
  const issues = issuesOf({ ...base, ...stripeTest, STRIPE_PUBLISHABLE_KEY: "pk_live_51Habcdefghijklmnop" });
  assert.ok(issues.some((i) => i.includes("必须同为测试或同为正式")));
});

test("配齐后 staging 可以启动，状态里不出现密钥原文", () => {
  const c = loadConfig({ ...base, ...stripeTest, APP_ENV: "staging", GOOGLE_MAPS_API_KEY: "AIzaSyExample000000000000000" });
  assert.equal(c.stripe?.mode, "test");
  const text = JSON.stringify(integrationStatus(c));
  assert.ok(!text.includes(stripeTest.STRIPE_SECRET_KEY));
  assert.ok(!text.includes("pw@"));
});

test("空字符串视为未填写", () => {
  const c = loadConfig({ ...base, STRIPE_SECRET_KEY: "", STRIPE_PUBLISHABLE_KEY: " ", STRIPE_WEBHOOK_SECRET: "" });
  assert.equal(c.stripe, null);
});

test("mask 只保留首尾", () => {
  assert.equal(mask("sk_test_1234567890abcd"), "sk_test…abcd");
  assert.equal(mask("short"), "•••••");
});
