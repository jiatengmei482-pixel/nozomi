import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NO_ADMIN_SECRETS,
  adminStripeKeyIssues,
  effectiveSecretValues,
  envIntegrations,
  googleMapsKeyIssues,
  integrationStatus,
  loadConfig,
  maskLast4,
  resolveIntegrations,
  smtpSettingsIssues,
  stripeKeyIssues,
} from "./index.ts";

const base = { DATABASE_URL: "postgres://app:pw@localhost:5432/nozomi", AUTH_JWT_SECRET: "x".repeat(40) };
const envStripe = { STRIPE_SECRET_KEY: "sk_test_ENVenvENVenvENV0001", STRIPE_PUBLISHABLE_KEY: "pk_test_ENVenvENVenvENV0001", STRIPE_WEBHOOK_SECRET: "whsec_ENVenvENVenvENV0001" };
const adminStripe = { secretKey: "sk_test_ADMINadminADMIN0002", publishableKey: "pk_test_ADMINadminADMIN0002", webhookSecret: "whsec_ADMINadminADMIN0002" };
const liveStripe = { secretKey: "sk_live_ADMINadminADMIN0003", publishableKey: "pk_live_ADMINadminADMIN0003", webhookSecret: "whsec_ADMINadminADMIN0003" };
const ENV_MAPS = "AIzaEnvEnvEnvEnvEnvEnv000005678";
const ADMIN_MAPS = "AIzaAdminAdminAdminAdmin0001234";

test("打码：末 4 位按完整字符算，不切开表情；孤立代理项换成替换符（否则写不进 jsonb）", () => {
  assert.equal(maskLast4("0123456789abcdef😀😀a"), "••••f😀😀a");
  assert.equal(maskLast4("0123456789abcdef\ud83da"), "••••ef\ufffda");
});

test("打码：只露末 4 位；太短的值只有圆点，不露任何字符", () => {
  assert.equal(maskLast4(ADMIN_MAPS), "••••1234");
  assert.equal(maskLast4("sk_test_ADMINadminADMIN0002"), "••••0002");
  for (const short of ["", "a", "abcd", "abcdefghijklmno"]) assert.equal(maskLast4(short), "••••");
  assert.equal(maskLast4("abcdefghijklmnop"), "••••mnop");
});

test("优先顺序：后台填写的优先，后台没填用配置文件，都没有是未配置", () => {
  const both = loadConfig({ ...base, ...envStripe, GOOGLE_MAPS_API_KEY: ENV_MAPS });
  const fromAdmin = resolveIntegrations(both, { googleMaps: { apiKey: ADMIN_MAPS }, stripe: adminStripe, email: null });
  assert.deepEqual(fromAdmin.googleMaps, { apiKey: ADMIN_MAPS, source: "admin" });
  assert.deepEqual(fromAdmin.stripe, { config: { ...adminStripe, mode: "test" }, source: "admin" });
  assert.deepEqual(fromAdmin.adminIgnored, { googleMaps: false, stripe: false, email: false });

  const fromEnv = resolveIntegrations(both, NO_ADMIN_SECRETS);
  assert.deepEqual(fromEnv.googleMaps, { apiKey: ENV_MAPS, source: "env" });
  assert.equal(fromEnv.stripe.source, "env");
  assert.equal(fromEnv.stripe.config?.secretKey, envStripe.STRIPE_SECRET_KEY);

  const mixed = resolveIntegrations(both, { googleMaps: { apiKey: ADMIN_MAPS }, stripe: null, email: null });
  assert.equal(mixed.googleMaps.source, "admin");
  assert.equal(mixed.stripe.source, "env");

  const none = resolveIntegrations(loadConfig(base), NO_ADMIN_SECRETS);
  assert.deepEqual([none.googleMaps, none.stripe], [{ apiKey: null, source: "none" }, { config: null, source: "none" }]);
  const adminOnly = resolveIntegrations(loadConfig(base), { googleMaps: { apiKey: ADMIN_MAPS }, stripe: adminStripe, email: null });
  assert.deepEqual([adminOnly.googleMaps.source, adminOnly.stripe.source], ["admin", "admin"]);
});

test("后台的值不适用于当前环境（测试密钥到了正式环境）：不生效，回落到配置文件，并标出来", () => {
  const production = loadConfig({ ...base, AUTH_JWT_SECRET: "x".repeat(64), APP_ENV: "production", DATA_ENCRYPTION_KEY: "k".repeat(40) });
  const resolved = resolveIntegrations(production, { googleMaps: null, stripe: adminStripe, email: null });
  assert.deepEqual(resolved.stripe, { config: null, source: "none" });
  assert.equal(resolved.adminIgnored.stripe, true);
  const live = resolveIntegrations(production, { googleMaps: null, stripe: liveStripe, email: null });
  assert.equal(live.stripe.source, "admin");
  assert.equal(live.stripe.config?.mode, "live");
});

test("集成状态按生效的值：来源和打码都跟着变；/health 用的 state 也跟着变", () => {
  const config = loadConfig(base);
  const status = integrationStatus(config, { effective: resolveIntegrations(config, { googleMaps: { apiKey: ADMIN_MAPS }, stripe: adminStripe, email: null }) });
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
  const values = effectiveSecretValues(resolveIntegrations(config, { googleMaps: { apiKey: ADMIN_MAPS }, stripe: adminStripe, email: null }));
  assert.deepEqual(values.sort(), [ADMIN_MAPS, ...Object.values(adminStripe)].sort());
  assert.deepEqual(effectiveSecretValues(resolveIntegrations(config, NO_ADMIN_SECRETS)), []);
});

test("测试用的服务地址：local / ci 可以指到本机，staging / production 不能改", () => {
  const ci = loadConfig({ ...base, APP_ENV: "ci", GOOGLE_MAPS_ROUTES_URL: "http://127.0.0.1:4010/directions/v2:computeRoutes", GOOGLE_PLACES_SEARCH_URL: "http://127.0.0.1:4012/v1/places:searchText", GOOGLE_PLACES_AUTOCOMPLETE_URL: "http://127.0.0.1:4014/v1/places:autocomplete", GOOGLE_PLACE_DETAILS_URL: "http://127.0.0.1:4015/v1/places", GOOGLE_GEOCODE_URL: "http://127.0.0.1:4013/geocode", STRIPE_API_URL: "http://127.0.0.1:4011" });
  assert.deepEqual(ci.integrationEndpoints, {
    googleMapsRoutesUrl: "http://127.0.0.1:4010/directions/v2:computeRoutes",
    googlePlacesSearchUrl: "http://127.0.0.1:4012/v1/places:searchText",
    googlePlacesAutocompleteUrl: "http://127.0.0.1:4014/v1/places:autocomplete",
    googlePlaceDetailsUrl: "http://127.0.0.1:4015/v1/places",
    googleGeocodeUrl: "http://127.0.0.1:4013/geocode",
    stripeApi: { host: "127.0.0.1", port: 4011, protocol: "http" },
  });
  assert.deepEqual(loadConfig(base).integrationEndpoints, {
    googleMapsRoutesUrl: "https://routes.googleapis.com/directions/v2:computeRoutes",
    googlePlacesSearchUrl: "https://places.googleapis.com/v1/places:searchText",
    googlePlacesAutocompleteUrl: "https://places.googleapis.com/v1/places:autocomplete",
    googlePlaceDetailsUrl: "https://places.googleapis.com/v1/places",
    googleGeocodeUrl: "https://geocode.googleapis.com/v4beta/geocode/location",
    stripeApi: null,
  });
  for (const env of ["staging", "production"]) {
    const extra = env === "production" ? { AUTH_JWT_SECRET: "x".repeat(64), DATA_ENCRYPTION_KEY: "k".repeat(40) } : {};
    for (const override of [{ GOOGLE_MAPS_ROUTES_URL: "http://127.0.0.1:4010/x" }, { GOOGLE_PLACES_SEARCH_URL: "http://127.0.0.1:4012/x" }, { GOOGLE_GEOCODE_URL: "http://127.0.0.1:4013/x" }, { GOOGLE_PLACES_AUTOCOMPLETE_URL: "http://127.0.0.1:4014/x" }, { GOOGLE_PLACE_DETAILS_URL: "http://127.0.0.1:4015/x" }, { STRIPE_API_URL: "http://127.0.0.1:4011" }]) {
      assert.throws(() => loadConfig({ ...base, ...extra, APP_ENV: env, ...override }), /只给本机和 CI 的测试用/, `${env} ${Object.keys(override)[0]}`);
    }
  }
});

const SMTP = { host: "smtp.example.com", port: 587, encryption: "starttls", username: "mailer@example.com", password: "smtp-Pass-word-0001", fromName: "NOZOMI", fromAddress: "noreply@example.com" } as const;
const smtpEnv = { SMTP_HOST: "SMTP.env.example.com", SMTP_PORT: "465", SMTP_ENCRYPTION: "tls", SMTP_USERNAME: "env-user", SMTP_PASSWORD: "env-Pass-word-0002", SMTP_FROM_NAME: "配置文件", SMTP_FROM_ADDRESS: "env@example.com" };
const reasons = (input: Parameters<typeof smtpSettingsIssues>[1], env: Parameters<typeof smtpSettingsIssues>[0] = "staging"): string[] => smtpSettingsIssues(env, input).map((issue) => `${issue.field}:${issue.reason}`);

test("SMTP 校验：合格的没有问题；七项都必填", () => {
  assert.deepEqual(reasons(SMTP), []);
  assert.deepEqual(reasons({}), ["host:REQUIRED", "port:REQUIRED", "encryption:REQUIRED", "username:REQUIRED", "password:REQUIRED", "from_name:REQUIRED", "from_address:REQUIRED"]);
});

test("SMTP 校验：端口只认 25、465、587、2525；local / ci 的回环地址不限端口（本机假服务器），测试环境、正式环境没有这个例外", () => {
  for (const port of [25, 465, 587, 2525]) assert.deepEqual(reasons({ ...SMTP, port }), [], String(port));
  for (const port of [22, 80, 443, 5432, 6379, 8025]) assert.deepEqual(reasons({ ...SMTP, port }), ["port:PORT_NOT_ALLOWED"], String(port));
  for (const port of [0, -1, 70_000, 587.5, Number.NaN]) assert.deepEqual(reasons({ ...SMTP, port }), ["port:FORMAT"], String(port));
  for (const host of ["127.0.0.1", "localhost", "::1"]) {
    assert.deepEqual(reasons({ ...SMTP, host, port: 41234 }, "ci"), [], host);
    assert.deepEqual(reasons({ ...SMTP, host, port: 41234 }, "local"), [], host);
    assert.deepEqual(reasons({ ...SMTP, host, port: 41234 }, "staging"), ["port:PORT_NOT_ALLOWED"], host);
    assert.deepEqual(reasons({ ...SMTP, host, port: 41234 }, "production"), ["port:PORT_NOT_ALLOWED"], host);
  }
  assert.deepEqual(reasons({ ...SMTP, port: 41234 }, "ci"), ["port:PORT_NOT_ALLOWED"], "local / ci 的公网主机也不放开");
});

test("SMTP 校验：加密方式三选一；none 只有 local / ci 允许", () => {
  for (const encryption of ["tls", "starttls"]) assert.deepEqual(reasons({ ...SMTP, encryption }), []);
  for (const encryption of ["ssl", "TLS", "none "]) assert.deepEqual(reasons({ ...SMTP, encryption }), ["encryption:FORMAT"]);
  for (const env of ["local", "ci"] as const) assert.deepEqual(reasons({ ...SMTP, encryption: "none" }, env), []);
  for (const env of ["staging", "production"] as const) assert.deepEqual(reasons({ ...SMTP, encryption: "none" }, env), ["encryption:ENCRYPTION_NOT_ALLOWED"]);
});

test("SMTP 校验：换行等控制字符、写法、长度", () => {
  for (const fromName of ["a\r\nBcc: x@y.z", "a\nb", "a\u0000", "a\u2028b"]) assert.deepEqual(reasons({ ...SMTP, fromName }), ["from_name:FORMAT"]);
  for (const username of ["a\r\nb", "a\u0007"]) assert.deepEqual(reasons({ ...SMTP, username }), ["username:FORMAT"]);
  assert.deepEqual(reasons({ ...SMTP, password: "abcd\r\nefgh" }), ["password:FORMAT"]);
  assert.deepEqual(reasons({ ...SMTP, password: "x".repeat(7) }), ["password:TOO_SHORT"]);
  assert.deepEqual(reasons({ ...SMTP, password: "含 空格 和 中文 也可以 😀" }), []);
  assert.deepEqual(reasons({ ...SMTP, password: "x".repeat(256) }), ["password:TOO_LONG"]);
  assert.deepEqual(reasons({ ...SMTP, fromName: "x".repeat(101) }), ["from_name:TOO_LONG"]);
  for (const fromAddress of ["a@b.co, c@d.co", "A <a@b.co>", "a@b.co\r\nBcc: x@y.z", "a@b", "a b@c.co"]) assert.deepEqual(reasons({ ...SMTP, fromAddress }), ["from_address:FORMAT"], fromAddress);
  for (const host of ["smtp.example.com\r\nX: y", "smtp example.com", "http://smtp.example.com", "smtp.example.com:587", "-x.com", "x.com.", "用户.com", "a@b.com"]) assert.deepEqual(reasons({ ...SMTP, host }), ["host:FORMAT"], host);
  assert.deepEqual(reasons({ ...SMTP, host: `${"a".repeat(254)}.com` }), ["host:TOO_LONG"]);
});

test("SMTP 优先顺序：后台的优先，后台没填用配置文件，都没有未配置；明文的后台值到了测试环境不生效并标出，回落到配置文件", () => {
  const both = loadConfig({ ...base, ...smtpEnv });
  const admin = { ...SMTP, encryption: "starttls" as const };
  const fromAdmin = resolveIntegrations(both, { ...NO_ADMIN_SECRETS, email: admin });
  assert.deepEqual([fromAdmin.email.source, fromAdmin.email.config?.host, fromAdmin.adminIgnored.email], ["admin", "smtp.example.com", false]);
  const fromEnv = resolveIntegrations(both, NO_ADMIN_SECRETS);
  assert.deepEqual([fromEnv.email.source, fromEnv.email.config?.host, fromEnv.email.config?.port], ["env", "smtp.env.example.com", 465]);
  const none = resolveIntegrations(loadConfig(base), NO_ADMIN_SECRETS);
  assert.deepEqual([none.email.source, none.email.config], ["none", null]);
  const staging = loadConfig({ ...base, APP_ENV: "staging", ...smtpEnv });
  const plain = resolveIntegrations(staging, { ...NO_ADMIN_SECRETS, email: { ...admin, encryption: "none" } });
  assert.deepEqual([plain.email.source, plain.email.config?.host, plain.adminIgnored.email], ["env", "smtp.env.example.com", true]);
});

test("SMTP 配置文件：七项一组；端口、明文的规则同后台；报错里没有填的值", () => {
  assert.equal(loadConfig(base).smtp, null);
  assert.deepEqual(loadConfig({ ...base, ...smtpEnv }).smtp, { host: "smtp.env.example.com", port: 465, encryption: "tls", username: "env-user", password: "env-Pass-word-0002", fromName: "配置文件", fromAddress: "env@example.com" });
  const refused = (env: Record<string, string>): string => {
    try {
      loadConfig({ ...base, ...smtpEnv, ...env });
    } catch (err) {
      const text = (err as Error).message;
      assert.ok(!text.includes("env-Pass-word-0002"), "报错里有密码");
      return text;
    }
    assert.fail("应当拒绝启动");
  };
  assert.match(refused({ SMTP_FROM_NAME: "" }), /需要同时配置/);
  assert.match(refused({ SMTP_PORT: "8025" }), /SMTP_PORT 只能是/);
  assert.match(refused({ SMTP_PORT: "abc" }), /SMTP_PORT/);
  assert.match(refused({ SMTP_ENCRYPTION: "ssl" }), /SMTP_ENCRYPTION 只能是/);
  assert.match(refused({ APP_ENV: "staging", SMTP_ENCRYPTION: "none" }), /staging 环境的 SMTP_ENCRYPTION 不能是 none/);
  assert.match(refused({ SMTP_PASSWORD: "short" }), /SMTP_PASSWORD/);
  assert.equal(loadConfig({ ...base, ...smtpEnv, APP_ENV: "ci", SMTP_ENCRYPTION: "none" }).smtp?.encryption, "none");
});

test("SMTP 集成状态：超级管理员看到主机、端口、来源和末 4 位；其他人只有来源；日志脱敏名单只有密码；打码不露密码的其他部分", () => {
  const config = loadConfig({ ...base, ...smtpEnv });
  const of = (hints: boolean) => integrationStatus(config, { effective: envIntegrations(config), hints }).find((item) => item.key === "email");
  assert.equal(of(true)?.detail, "smtp.env.example.com:465 · 服务器配置文件（••••0002）");
  assert.deepEqual([of(false)?.state, of(false)?.detail], ["configured", "服务器配置文件"]);
  assert.deepEqual(integrationStatus(loadConfig(base)).find((item) => item.key === "email"), { key: "email", label: "邮件发送", state: "missing", detail: "未配置，不能发邮件" });
  const values = effectiveSecretValues(envIntegrations(config));
  assert.ok(values.includes("env-Pass-word-0002"));
  for (const notSecret of ["smtp.env.example.com", "env-user", "tls", "465"]) assert.ok(!values.includes(notSecret), notSecret);
});
