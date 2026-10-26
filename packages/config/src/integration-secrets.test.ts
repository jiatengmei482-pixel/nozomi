import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NO_ADMIN_SECRETS,
  adminStripeKeyIssues,
  effectiveSecretValues,
  googleMapsKeyIssues,
  integrationStatus,
  loadConfig,
  maskLast4,
  resolveIntegrations,
  stripeKeyIssues,
} from "./index.ts";

const base = { DATABASE_URL: "postgres://app:pw@localhost:5432/nozomi", AUTH_JWT_SECRET: "x".repeat(40) };
const envStripe = { STRIPE_SECRET_KEY: "sk_test_ENVenvENVenvENV0001", STRIPE_PUBLISHABLE_KEY: "pk_test_ENVenvENVenvENV0001", STRIPE_WEBHOOK_SECRET: "whsec_ENVenvENVenvENV0001" };
const adminStripe = { secretKey: "sk_test_ADMINadminADMIN0002", publishableKey: "pk_test_ADMINadminADMIN0002", webhookSecret: "whsec_ADMINadminADMIN0002" };
const liveStripe = { secretKey: "sk_live_ADMINadminADMIN0003", publishableKey: "pk_live_ADMINadminADMIN0003", webhookSecret: "whsec_ADMINadminADMIN0003" };
const ENV_MAPS = "AIzaEnvEnvEnvEnvEnvEnv000005678";
const ADMIN_MAPS = "AIzaAdminAdminAdminAdmin0001234";

test("打码：只露末 4 位；太短的值只有圆点，不露任何字符", () => {
  assert.equal(maskLast4(ADMIN_MAPS), "••••1234");
  assert.equal(maskLast4("sk_test_ADMINadminADMIN0002"), "••••0002");
  for (const short of ["", "a", "abcd", "abcdefghijklmno"]) assert.equal(maskLast4(short), "••••");
  assert.equal(maskLast4("abcdefghijklmnop"), "••••mnop");
});

test("优先顺序：后台填写的优先，后台没填用配置文件，都没有是未配置", () => {
  const both = loadConfig({ ...base, ...envStripe, GOOGLE_MAPS_API_KEY: ENV_MAPS });
  const fromAdmin = resolveIntegrations(both, { googleMaps: { apiKey: ADMIN_MAPS }, stripe: adminStripe });
  assert.deepEqual(fromAdmin.googleMaps, { apiKey: ADMIN_MAPS, source: "admin" });
  assert.deepEqual(fromAdmin.stripe, { config: { ...adminStripe, mode: "test" }, source: "admin" });
  assert.deepEqual(fromAdmin.adminIgnored, { googleMaps: false, stripe: false });

  const fromEnv = resolveIntegrations(both, NO_ADMIN_SECRETS);
  assert.deepEqual(fromEnv.googleMaps, { apiKey: ENV_MAPS, source: "env" });
  assert.equal(fromEnv.stripe.source, "env");
  assert.equal(fromEnv.stripe.config?.secretKey, envStripe.STRIPE_SECRET_KEY);

  const mixed = resolveIntegrations(both, { googleMaps: { apiKey: ADMIN_MAPS }, stripe: null });
  assert.equal(mixed.googleMaps.source, "admin");
  assert.equal(mixed.stripe.source, "env");

  const none = resolveIntegrations(loadConfig(base), NO_ADMIN_SECRETS);
  assert.deepEqual([none.googleMaps, none.stripe], [{ apiKey: null, source: "none" }, { config: null, source: "none" }]);
  const adminOnly = resolveIntegrations(loadConfig(base), { googleMaps: { apiKey: ADMIN_MAPS }, stripe: adminStripe });
  assert.deepEqual([adminOnly.googleMaps.source, adminOnly.stripe.source], ["admin", "admin"]);
});

test("后台的值不适用于当前环境（测试密钥到了正式环境）：不生效，回落到配置文件，并标出来", () => {
  const production = loadConfig({ ...base, AUTH_JWT_SECRET: "x".repeat(64), APP_ENV: "production", DATA_ENCRYPTION_KEY: "k".repeat(40) });
  const resolved = resolveIntegrations(production, { googleMaps: null, stripe: adminStripe });
  assert.deepEqual(resolved.stripe, { config: null, source: "none" });
  assert.equal(resolved.adminIgnored.stripe, true);
  const live = resolveIntegrations(production, { googleMaps: null, stripe: liveStripe });
  assert.equal(live.stripe.source, "admin");
  assert.equal(live.stripe.config?.mode, "live");
});

test("集成状态按生效的值：来源和打码都跟着变；/health 用的 state 也跟着变", () => {
  const config = loadConfig(base);
  const status = integrationStatus(config, { effective: resolveIntegrations(config, { googleMaps: { apiKey: ADMIN_MAPS }, stripe: adminStripe }) });
  const byKey = new Map(status.map((s) => [s.key, s]));
  assert.equal(byKey.get("googleMaps")?.state, "configured");
  assert.equal(byKey.get("googleMaps")?.detail, "后台设置（••••1234）");
  assert.equal(byKey.get("stripe")?.detail, "测试模式 · 后台设置（••••0002）");
  for (const value of [ADMIN_MAPS, ...Object.values(adminStripe)]) assert.ok(!JSON.stringify(status).includes(value));
});

test("Stripe 三项一组：只给一部分时缺的每一项都报 REQUIRED；都不给没有问题（= 不配置）", () => {
  assert.deepEqual(stripeKeyIssues("staging", {}), []);
  assert.deepEqual(stripeKeyIssues("staging", { secretKey: adminStripe.secretKey }), [
    { field: "publishable_key", reason: "REQUIRED" },
    { field: "webhook_secret", reason: "REQUIRED" },
  ]);
  assert.deepEqual(adminStripeKeyIssues("staging", { secretKey: adminStripe.secretKey, publishableKey: "", webhookSecret: adminStripe.webhookSecret }), [{ field: "publishable_key", reason: "REQUIRED" }]);
  assert.deepEqual(stripeKeyIssues("staging", adminStripe), []);
});

test("Stripe 前缀：非正式环境只认测试密钥，正式环境只认正式密钥；两把密钥同为测试或同为正式", () => {
  for (const env of ["local", "ci", "staging"] as const) {
    assert.deepEqual(stripeKeyIssues(env, liveStripe), [{ field: "secret_key", reason: "LIVE_KEY_NOT_ALLOWED" }], env);
    assert.deepEqual(adminStripeKeyIssues(env, adminStripe), [], env);
  }
  assert.deepEqual(stripeKeyIssues("production", adminStripe), [{ field: "secret_key", reason: "TEST_KEY_NOT_ALLOWED" }]);
  assert.deepEqual(stripeKeyIssues("production", liveStripe), []);
  assert.deepEqual(stripeKeyIssues("staging", { ...adminStripe, publishableKey: liveStripe.publishableKey }), [{ field: "publishable_key", reason: "MODE_MISMATCH" }]);
  assert.deepEqual(stripeKeyIssues("staging", { ...adminStripe, secretKey: "rk_test_ADMINadminADMIN0002" }), [{ field: "secret_key", reason: "PREFIX" }]);
  assert.deepEqual(stripeKeyIssues("staging", { ...adminStripe, publishableKey: "sk_test_ADMINadminADMIN0002" }), [{ field: "publishable_key", reason: "PREFIX" }]);
  assert.deepEqual(stripeKeyIssues("staging", { ...adminStripe, webhookSecret: "wh_ADMINadminADMINadmin0002" }), [{ field: "webhook_secret", reason: "PREFIX" }]);
});

test("后台填写的写法：太短、太长、带空格或别的字符的都不收；问题里只有字段名和原因，没有值", () => {
  assert.deepEqual(googleMapsKeyIssues(ADMIN_MAPS), []);
  assert.deepEqual(googleMapsKeyIssues("AIzaShort"), [{ field: "api_key", reason: "TOO_SHORT" }]);
  assert.deepEqual(googleMapsKeyIssues("A".repeat(256)), [{ field: "api_key", reason: "TOO_LONG" }]);
  for (const bad of ["AIzaAdminAdmin Admin0001234", "AIzaAdminAdminAdmin\n0001234", "AIzaAdminAdmin\"Admin0001234", "AIzaAdminAdminAdmin0001234é"]) {
    assert.deepEqual(googleMapsKeyIssues(bad), [{ field: "api_key", reason: "FORMAT" }], JSON.stringify(bad));
  }
  const issues = adminStripeKeyIssues("staging", { ...adminStripe, secretKey: "sk_test_ short" });
  assert.deepEqual(issues, [{ field: "secret_key", reason: "TOO_SHORT" }]);
  assert.ok(!JSON.stringify(issues).includes("sk_test_"));
});

test("日志脱敏要抹掉的生效值：谷歌地图密钥和 Stripe 三项", () => {
  const config = loadConfig(base);
  const values = effectiveSecretValues(resolveIntegrations(config, { googleMaps: { apiKey: ADMIN_MAPS }, stripe: adminStripe }));
  assert.deepEqual(values.sort(), [ADMIN_MAPS, ...Object.values(adminStripe)].sort());
  assert.deepEqual(effectiveSecretValues(resolveIntegrations(config, NO_ADMIN_SECRETS)), []);
});

test("测试用的服务地址：local / ci 可以指到本机，staging / production 不能改", () => {
  const ci = loadConfig({ ...base, APP_ENV: "ci", GOOGLE_MAPS_ROUTES_URL: "http://127.0.0.1:4010/directions/v2:computeRoutes", STRIPE_API_URL: "http://127.0.0.1:4011" });
  assert.deepEqual(ci.integrationEndpoints, { googleMapsRoutesUrl: "http://127.0.0.1:4010/directions/v2:computeRoutes", stripeApi: { host: "127.0.0.1", port: 4011, protocol: "http" } });
  assert.deepEqual(loadConfig(base).integrationEndpoints, { googleMapsRoutesUrl: "https://routes.googleapis.com/directions/v2:computeRoutes", stripeApi: null });
  for (const env of ["staging", "production"]) {
    const extra = env === "production" ? { AUTH_JWT_SECRET: "x".repeat(64), DATA_ENCRYPTION_KEY: "k".repeat(40) } : {};
    for (const override of [{ GOOGLE_MAPS_ROUTES_URL: "http://127.0.0.1:4010/x" }, { STRIPE_API_URL: "http://127.0.0.1:4011" }]) {
      assert.throws(() => loadConfig({ ...base, ...extra, APP_ENV: env, ...override }), /只给本机和 CI 的测试用/, `${env} ${Object.keys(override)[0]}`);
    }
  }
});
