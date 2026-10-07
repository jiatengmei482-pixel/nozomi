import { test } from "node:test";
import assert from "node:assert/strict";
import { ConfigError, databaseUserOf, integrationStatus, loadConfig, loadMigrationConfig, mask } from "./index.ts";

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

test("production 环境必须配齐 Stripe 和谷歌地图", () => {
  const issues = issuesOf({ ...base, AUTH_JWT_SECRET: "x".repeat(64), APP_ENV: "production" });
  assert.ok(issues.some((i) => i.includes("Stripe")));
  assert.ok(issues.some((i) => i.includes("GOOGLE_MAPS_API_KEY")));
});

test("staging 环境缺 Stripe 和谷歌地图时照常启动，两项显示未配置", () => {
  const c = loadConfig({ ...base, APP_ENV: "staging" });
  assert.equal(c.appEnv, "staging");
  assert.equal(c.stripe, null);
  assert.equal(c.googleMapsApiKey, null);
  const status = integrationStatus(c);
  assert.equal(status.find((s) => s.key === "stripe")?.state, "missing");
  assert.equal(status.find((s) => s.key === "googleMaps")?.state, "missing");
});

test("staging 环境只配了其中一项（只有谷歌地图，或只有 Stripe）也能启动", () => {
  const mapsOnly = loadConfig({ ...base, APP_ENV: "staging", GOOGLE_MAPS_API_KEY: "AIzaSyExample000000000000000" });
  assert.equal(mapsOnly.stripe, null);
  assert.ok(mapsOnly.googleMapsApiKey);
  const stripeOnly = loadConfig({ ...base, ...stripeTest, APP_ENV: "staging" });
  assert.equal(stripeOnly.stripe?.mode, "test");
  assert.equal(stripeOnly.googleMapsApiKey, null);
});

test("staging 环境 Stripe 只填一部分仍然报错（放宽的只是「可以整体不配」）", () => {
  const issues = issuesOf({ ...base, APP_ENV: "staging", STRIPE_SECRET_KEY: stripeTest.STRIPE_SECRET_KEY });
  assert.ok(issues.some((i) => i.includes("同时配置")));
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

test("mask：不够长的密钥全部打码，脱敏结果里不含任何原文字符", () => {
  for (const length of [0, 1, 10, 11, 12, 14, 19]) {
    const secret = "Zk3".repeat(7).slice(0, length);
    assert.equal(mask(secret), "•".repeat(length));
  }
  const twenty = "abcdefg" + "X".repeat(9) + "wxyz";
  assert.equal(mask(twenty), "abcdefg…wxyz");
});

test("DATABASE_URL 前缀正确但无法解析（端口超范围、主机名有空格）：报错，且报错里没有原值", () => {
  for (const url of ["postgres://app:pw-Zq7@127.0.0.1:99999/nozomi", "postgres://app:pw-Zq7@db host/nozomi"]) {
    const issues = issuesOf({ ...base, DATABASE_URL: url });
    assert.ok(issues.some((i) => i.startsWith("DATABASE_URL") && i.includes("无法解析")), url);
    assert.ok(!issues.join("\n").includes("pw-Zq7"));
  }
});

test("连接串脱敏：密码写在查询参数里也不输出", () => {
  const c = loadConfig({ ...base, DATABASE_URL: "postgres://app@localhost:5432/nozomi?password=query-pw&sslmode=disable" });
  const detail = integrationStatus(c).find((s) => s.key === "database")?.detail;
  assert.equal(detail, "postgres://app:•••@localhost:5432/nozomi");
});

test("TRUST_PROXY_HOPS：默认 0（不信任 X-Forwarded-For），只接受 0 ~ 5 的整数", () => {
  assert.equal(loadConfig(base).trustProxyHops, 0);
  assert.equal(loadConfig({ ...base, TRUST_PROXY_HOPS: "1" }).trustProxyHops, 1);
  for (const value of ["-1", "6", "1.5", "true"]) {
    assert.ok(issuesOf({ ...base, TRUST_PROXY_HOPS: value }).some((i) => i.startsWith("TRUST_PROXY_HOPS")), value);
  }
});

const migrationUrl = "postgres://owner:owner-pw@localhost:5432/nozomi";

test("服务进程的配置：DATABASE_MIGRATION_URL 可以没有（服务进程不需要迁移账号）；填了就必须是另一个账号的合法连接串", () => {
  assert.equal(loadConfig(base).databaseMigrationUrl, null);
  assert.equal(loadConfig({ ...base, DATABASE_MIGRATION_URL: "" }).databaseMigrationUrl, null);
  assert.equal(loadConfig({ ...base, DATABASE_MIGRATION_URL: migrationUrl }).databaseMigrationUrl, migrationUrl);
  assert.equal(loadConfig({ ...base, DATABASE_MIGRATION_URL: migrationUrl }).databaseUrl, base.DATABASE_URL);

  const sameAccount = issuesOf({ ...base, DATABASE_MIGRATION_URL: "postgres://app:other-pw@other-host:5432/nozomi" });
  assert.equal(sameAccount.length, 1);
  assert.match(sameAccount[0] as string, /不能是同一个数据库账号/);
  const malformed = issuesOf({ ...base, DATABASE_MIGRATION_URL: "mysql://owner:secret-owner-pw@db:3306/nozomi" });
  assert.ok(malformed.some((i) => i.startsWith("DATABASE_MIGRATION_URL")));
  assert.ok(!malformed.join(" ").includes("secret-owner-pw"));
});

test("迁移命令的配置：只要求 DATABASE_MIGRATION_URL，不要求登录签名密钥；缺失、格式不对、和应用账号相同都报错且不带原值", () => {
  assert.deepEqual(loadMigrationConfig({ DATABASE_MIGRATION_URL: migrationUrl }), {
    databaseMigrationUrl: migrationUrl,
    databaseUrl: null,
  });
  assert.deepEqual(loadMigrationConfig({ DATABASE_MIGRATION_URL: migrationUrl, DATABASE_URL: base.DATABASE_URL }), {
    databaseMigrationUrl: migrationUrl,
    databaseUrl: base.DATABASE_URL,
  });
  assert.equal(loadMigrationConfig({ DATABASE_MIGRATION_URL: migrationUrl, DATABASE_URL: " " }).databaseUrl, null);

  const failing: [Record<string, string>, RegExp][] = [
    [{}, /DATABASE_MIGRATION_URL/],
    [{ DATABASE_URL: base.DATABASE_URL }, /DATABASE_MIGRATION_URL/],
    [{ DATABASE_MIGRATION_URL: "postgres://owner:secret-owner-pw@db host/nozomi" }, /DATABASE_MIGRATION_URL/],
    [{ DATABASE_MIGRATION_URL: migrationUrl, DATABASE_URL: "postgres://owner:secret-owner-pw@elsewhere/nozomi" }, /不能是同一个数据库账号/],
    [{ DATABASE_MIGRATION_URL: migrationUrl, DATABASE_URL: "mysql://app:secret-owner-pw@db/nozomi" }, /DATABASE_URL/],
  ];
  for (const [env, expected] of failing) {
    assert.throws(
      () => loadMigrationConfig(env),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.match(err.message, expected);
        assert.ok(!err.message.includes("secret-owner-pw") && !err.message.includes("owner-pw"));
        return true;
      },
    );
  }
});

test("databaseUserOf：取连接串里的账号名（还原百分号编码）；没有账号名或解析不了时为 null", () => {
  assert.equal(databaseUserOf("postgres://nozomi_api:pw@db:5432/nozomi"), "nozomi_api");
  assert.equal(databaseUserOf("postgres://a%40b:pw@db/nozomi"), "a@b");
  assert.equal(databaseUserOf("postgres://db/nozomi"), null);
  assert.equal(databaseUserOf("postgres://app:pw@db host/nozomi"), null);
});
