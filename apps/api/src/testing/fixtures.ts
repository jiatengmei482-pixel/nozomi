/**
 * 测试专用的配置构造。这里的「密钥」全部是一眼可辨的假值，只用来验证响应和日志里不会出现密钥原文。
 * 不读环境变量，保证单元测试在任何机器上结果一致。
 */
import { type AppConfig, loadConfig } from "@nozomi/config";

/** 假密钥原文。断言「响应里不包含这些字符串」时用。 */
export const FAKE_SECRETS = {
  databasePassword: "fake-db-password-Zq7",
  authJwtSecret: "fake-jwt-secret-for-tests-only-0123456789abcdef",
  stripeSecretKey: "sk_test_FAKEfakeFAKEfake0000",
  stripePublishableKey: "pk_test_FAKEfakeFAKEfake0000",
  stripeWebhookSecret: "whsec_FAKEfakeFAKEfake0000",
  googleMapsApiKey: "AIzaFAKEfakeFAKEfakeFAKE0000",
} as const;

/** 指向本机 1 号端口的连接串：必然连不上，用来模拟数据库故障。 */
export const UNREACHABLE_DATABASE_URL = `postgres://app:${FAKE_SECRETS.databasePassword}@127.0.0.1:1/nozomi`;

/** 配齐全部集成（都是假值）的 ci 环境配置。 */
export function testConfig(databaseUrl: string = UNREACHABLE_DATABASE_URL): AppConfig {
  return loadConfig(testEnv(databaseUrl));
}

/** 与 testConfig 对应的环境变量，用于启动子进程。 */
export function testEnv(databaseUrl: string): Record<string, string> {
  return {
    APP_ENV: "ci",
    DATABASE_URL: databaseUrl,
    AUTH_JWT_SECRET: FAKE_SECRETS.authJwtSecret,
    STRIPE_SECRET_KEY: FAKE_SECRETS.stripeSecretKey,
    STRIPE_PUBLISHABLE_KEY: FAKE_SECRETS.stripePublishableKey,
    STRIPE_WEBHOOK_SECRET: FAKE_SECRETS.stripeWebhookSecret,
    GOOGLE_MAPS_API_KEY: FAKE_SECRETS.googleMapsApiKey,
  };
}

/** 迁移命令（`db:migrate`）的环境变量：只需要迁移账号的连接串。 */
export function migrateEnv(migrationDatabaseUrl: string): Record<string, string> {
  return { APP_ENV: "ci", DATABASE_MIGRATION_URL: migrationDatabaseUrl };
}

/** 断言一段文本里没有任何假密钥原文；返回泄露了的密钥名称列表。 */
export function leakedSecrets(text: string): string[] {
  return Object.entries(FAKE_SECRETS)
    .filter(([, value]) => text.includes(value))
    .map(([name]) => name);
}
