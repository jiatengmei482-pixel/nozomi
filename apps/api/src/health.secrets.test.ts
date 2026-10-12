/**
 * /health 没有鉴权，任何人都能访问。这里验证各种形态的密钥和连接串都不会出现在响应里——
 * 包括脱敏后的片段：M0-06 起 /health 只给「已配置 / 未配置」，脱敏详情在需要平台登录的接口。
 * 不需要数据库（连接池指向必然连不上的地址）。
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import type { AppConfig } from "@nozomi/config";
import { buildApp } from "./app.ts";
import { createPool } from "./db/pool.ts";
import { FAKE_SECRETS, UNREACHABLE_DATABASE_URL, leakedSecrets, testConfig } from "./testing/fixtures.ts";

const pool = createPool(UNREACHABLE_DATABASE_URL, { connectionTimeoutMs: 1_000 });
after(() => pool.end());

interface Integration {
  key: string;
  label: string;
  state: string;
}

async function healthWith(config: AppConfig): Promise<{ statusCode: number; text: string; integrations: Map<string, Integration> }> {
  const app = buildApp({ config, pool, migrationFiles: [], logger: false, healthTimeoutMs: 1_500 });
  const res = await app.inject({ method: "GET", url: "/health" });
  await app.close();
  const integrations = new Map<string, Integration>();
  if (res.statusCode !== 500) {
    for (const item of (res.json() as { integrations: Integration[] }).integrations) integrations.set(item.key, item);
  }
  return { statusCode: res.statusCode, text: res.body, integrations };
}

test("配了 Stripe 和谷歌地图假密钥：响应里没有任何密钥原文，也没有 publishable key 和 webhook 密钥的片段", async () => {
  const { text, integrations } = await healthWith(testConfig());
  assert.deepEqual(leakedSecrets(text), []);
  assert.equal(integrations.get("stripe")?.state, "configured");
  assert.equal(integrations.get("googleMaps")?.state, "configured");
  assert.ok(!text.includes("whsec_"), "响应里出现了 webhook 密钥的片段");
  assert.ok(!text.includes("pk_test_"), "响应里出现了 publishable key 的片段");
  // 登录签名密钥只报长度，不报任何字符
  assert.ok(!text.includes(FAKE_SECRETS.authJwtSecret.slice(0, 8)));
  assert.ok(!text.includes(FAKE_SECRETS.authJwtSecret.slice(-8)));
});

test("公开的集成状态每项只有 key、label、state：没有 detail，也没有密钥的首尾片段", async () => {
  const { text, integrations } = await healthWith(testConfig());
  assert.equal(integrations.size, 5);
  for (const item of integrations.values()) assert.deepEqual(Object.keys(item), ["key", "label", "state"]);
  assert.ok(!text.includes("detail"));
  for (const secret of [FAKE_SECRETS.stripeSecretKey, FAKE_SECRETS.googleMapsApiKey]) {
    assert.ok(!text.includes(secret.slice(0, 7)), "响应里出现了密钥的前缀");
    assert.ok(!text.includes(secret.slice(-4)), "响应里出现了密钥的后缀");
  }
});

test("数据库连接串的各种写法：响应里都没有密码（含转义字符的密码、写在查询参数里的密码）", async () => {
  const cases: { name: string; url: string; forbidden: string[] }[] = [
    {
      name: "密码含需要转义的字符",
      url: "postgres://app:p%40ss%2Fw0rd%3AZq7@127.0.0.1:1/nozomi",
      forbidden: ["p%40ss%2Fw0rd%3AZq7", "p@ss/w0rd:Zq7", "w0rd"],
    },
    {
      name: "密码写在查询参数里",
      url: "postgres://app@127.0.0.1:1/nozomi?password=query-pw-Zq7&sslmode=disable",
      forbidden: ["query-pw-Zq7", "password="],
    },
    {
      name: "只有密码没有用户名",
      url: "postgres://:only-pw-Zq7@127.0.0.1:1/nozomi",
      forbidden: ["only-pw-Zq7"],
    },
    {
      name: "postgresql:// 前缀",
      url: `postgresql://app:${FAKE_SECRETS.databasePassword}@127.0.0.1:1/nozomi`,
      forbidden: [FAKE_SECRETS.databasePassword],
    },
  ];
  for (const { name, url, forbidden } of cases) {
    const { statusCode, text } = await healthWith(testConfig(url));
    assert.equal(statusCode, 503, name);
    for (const value of forbidden) assert.ok(!text.includes(value), `${name}：响应里出现了 ${value}`);
  }
});

test("较短的密钥（11 个字符）：响应里一个片段都没有", async () => {
  const shortKey = "AIzaShort11";
  assert.equal(shortKey.length, 11);
  const { text, integrations } = await healthWith({ ...testConfig(), googleMapsApiKey: shortKey });
  assert.equal(integrations.get("googleMaps")?.state, "configured");
  assert.ok(!text.includes("AIza") && !text.includes("Short") && !text.includes("•"));
});
