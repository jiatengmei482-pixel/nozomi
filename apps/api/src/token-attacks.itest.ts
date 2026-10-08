/**
 * 像攻击者一样摆弄访问令牌（ADR 0008）。auth/token.test.ts 在函数层面验证了验签；
 * 这里走真实接口，重点是「就算签名是对的，也只认数据库里的会话、账号和角色」：
 * 假设签名密钥泄露，攻击者能改令牌里的任何字段，仍然提不了权、续不了期、冒充不了别人。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { SESSION_TTL_MS } from "./auth/session.ts";
import { type AccessTokenClaims, signAccessToken } from "./auth/token.ts";
import { type TenantFixture, type TestApi, TEST_PASSWORD, addTenantUser, createTestApi } from "./testing/api.ts";
import { FAKE_SECRETS } from "./testing/fixtures.ts";

let api: TestApi;
let rootToken: string;
let staffToken: string;
let a: TenantFixture;
let reader: { id: string; token: string };

before(async () => {
  api = await createTestApi();
  rootToken = await api.superAdminToken();
  a = await api.tenantWithAdmin(rootToken, "车队甲", "admin@a.test");
  reader = await addTenantUser(api, a.adminToken, "reader@a.test", "readonly");
  const invited = await api.call("POST", "/platform/v1/staff", {
    token: rootToken,
    body: { email: "viewer@platform.test", name: "只读员工", role: "readonly" },
  });
  assert.equal(invited.status, 201, invited.text);
  const accepted = await api.call("POST", "/platform/v1/auth/accept-invite", {
    body: { token: invited.body.invite.token, password: TEST_PASSWORD },
  });
  assert.equal(accepted.status, 200, accepted.text);
  staffToken = await login("platform", "viewer@platform.test");
});
after(() => api.close());

async function login(entry: "platform" | "tenant", email: string): Promise<string> {
  const res = await api.call("POST", `/${entry}/v1/auth/login`, { body: { email, password: TEST_PASSWORD } });
  assert.equal(res.status, 200, res.text);
  return res.body.access_token as string;
}

function claimsOf(token: string): AccessTokenClaims {
  return JSON.parse(Buffer.from(token.split(".")[1] as string, "base64url").toString("utf8")) as AccessTokenClaims;
}

/** 用真实的签名密钥重新签一个令牌（模拟密钥泄露后的伪造）。 */
function forge(token: string, changes: Partial<AccessTokenClaims>): string {
  return signAccessToken(FAKE_SECRETS.authJwtSecret, { ...claimsOf(token), ...changes });
}

const me = (entry: "platform" | "tenant", token: string) => api.call("GET", `/${entry}/v1/auth/me`, { token });

test("前提：伪造用的签名方式和真实的一致（原样重签的令牌能用）", async () => {
  assert.equal((await me("tenant", forge(reader.token, {}))).status, 200);
  assert.equal((await me("platform", forge(staffToken, {}))).status, 200);
});

test("把令牌里的角色改成管理员 / 超级管理员再重签：权限仍按数据库里的角色判断，提不了权", async () => {
  const elevated = forge(reader.token, { role: "admin" });
  const invite = await api.call("POST", "/tenant/v1/users", { token: elevated, body: { email: "x@a.test", name: "x", role: "admin" } });
  assert.equal(invite.status, 403, invite.text);
  const promote = await api.call("PUT", `/tenant/v1/users/${reader.id}`, { token: elevated, body: { name: "x", role: "admin", status: "active" } });
  assert.equal(promote.status, 403, promote.text);
  const self = await me("tenant", elevated);
  assert.equal(self.body.user.role, "readonly");
  assert.deepEqual(self.body.permissions, ["user.read", "master_data.read"]);

  const elevatedStaff = forge(staffToken, { role: "super_admin" });
  for (const [method, url] of [["GET", "/platform/v1/staff"], ["GET", "/platform/v1/audit-logs"], ["GET", "/platform/v1/integrations"]] as const) {
    const res = await api.call(method, url, { token: elevatedStaff });
    assert.equal(res.status, 403, `${url}: ${res.text}`);
  }
  const created = await api.call("POST", "/platform/v1/staff", { token: elevatedStaff, body: { email: "y@platform.test", name: "y", role: "super_admin" } });
  assert.equal(created.status, 403, created.text);
});

test("会话编号和用户编号不配套（拿自己的会话冒充同租户的管理员、冒充超级管理员）：401", async () => {
  const asAdmin = forge(reader.token, { sub: a.adminId, role: "admin" });
  assert.equal((await me("tenant", asAdmin)).status, 401);
  assert.equal((await api.call("GET", "/tenant/v1/users", { token: asAdmin })).status, 401);

  const rootId = claimsOf(rootToken).sub;
  const asRoot = forge(staffToken, { sub: rootId, role: "super_admin" });
  assert.equal((await me("platform", asRoot)).status, 401);
  // 反过来：用户编号是自己的，会话编号是别人的
  assert.equal((await me("platform", forge(staffToken, { sid: claimsOf(rootToken).sid }))).status, 401);
  assert.equal((await me("tenant", forge(reader.token, { sid: claimsOf(a.adminToken).sid }))).status, 401);
});

test("把一类令牌的内容改签成另一类（平台会话 → 租户令牌，租户会话 → 平台令牌）：401", async () => {
  const platformAsTenant = forge(rootToken, { aud: "tenant", tid: a.tenantId, role: "admin" });
  assert.equal((await me("tenant", platformAsTenant)).status, 401);
  assert.equal((await api.call("GET", "/tenant/v1/users", { token: platformAsTenant })).status, 401);
  const tenantAsPlatform = forge(a.adminToken, { aud: "platform", tid: null, role: "super_admin" });
  assert.equal((await me("platform", tenantAsPlatform)).status, 401);
  assert.equal((await api.call("GET", "/platform/v1/tenants", { token: tenantAsPlatform })).status, 401);
});

test("把令牌的过期时间改到一年后再重签：会话在数据库里满 8 小时就失效，续不了期", async () => {
  const tenantToken = await login("tenant", "reader@a.test");
  const platformToken = await login("platform", "viewer@platform.test");
  const farFuture = Math.floor(api.clock.now().getTime() / 1000) + 365 * 24 * 3600;
  const longTenant = forge(tenantToken, { exp: farFuture });
  const longPlatform = forge(platformToken, { exp: farFuture });
  api.clock.advance(SESSION_TTL_MS - 1000);
  try {
    assert.equal((await me("tenant", longTenant)).status, 200);
    assert.equal((await me("platform", longPlatform)).status, 200);
    api.clock.advance(1000);
    assert.equal((await me("tenant", longTenant)).status, 401, "租户会话到期后仍可用");
    assert.equal((await me("platform", longPlatform)).status, 401, "平台会话到期后仍可用");
  } finally {
    api.clock.advance(-SESSION_TTL_MS);
  }
});

test("令牌头被换掉（alg: none、HS512、字段顺序不同）或用别的密钥签名：401", async () => {
  const [, payload, sig] = reader.token.split(".") as [string, string, string];
  const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");
  const none = b64({ alg: "none", typ: "JWT" });
  const hs512 = b64({ alg: "HS512", typ: "JWT" });
  const reordered = b64({ typ: "JWT", alg: "HS256" });
  const tokens = [
    `${none}.${payload}.`,
    `${none}.${payload}.${sig}`,
    `${none}.${payload}`,
    `${hs512}.${payload}.${createHmac("sha512", FAKE_SECRETS.authJwtSecret).update(`${hs512}.${payload}`).digest("base64url")}`,
    `${reordered}.${payload}.${sig}`,
    signAccessToken("another-secret-that-is-long-enough-0123456789", claimsOf(reader.token)),
    // 直接拿签名密钥本身（不派生）签
    `${reader.token.split(".")[0]}.${payload}.${createHmac("sha256", FAKE_SECRETS.authJwtSecret).update(`${reader.token.split(".")[0]}.${payload}`).digest("base64url")}`,
    // 改动内容但保留原签名
    `${reader.token.split(".")[0]}.${b64({ ...claimsOf(reader.token), role: "admin" })}.${sig}`,
    // 截断
    reader.token.slice(0, -1),
    reader.token.slice(0, reader.token.lastIndexOf(".")),
    `${reader.token}.extra`,
  ];
  for (const token of tokens) {
    const res = await me("tenant", token);
    assert.equal(res.status, 401, token.slice(0, 60));
    assert.equal(res.body.error.code, "UNAUTHENTICATED");
  }
});

test("超长的令牌、令牌放在查询串或 Cookie 里、重复的 Authorization：一律 401，不是 500", async () => {
  const huge = `${reader.token}${"A".repeat(4000)}`;
  assert.equal((await me("tenant", huge)).status, 401);
  const viaQuery = await api.call("GET", `/tenant/v1/auth/me?access_token=${reader.token}&token=${reader.token}`);
  assert.equal(viaQuery.status, 401);
  const viaCookie = await api.app.inject({ method: "GET", url: "/tenant/v1/auth/me", headers: { cookie: `access_token=${reader.token}; token=${reader.token}` } });
  assert.equal(viaCookie.statusCode, 401);
  for (const authorization of [`Bearer ${reader.token}, Bearer ${reader.token}`, `bearer ${reader.token}`, `Basic ${reader.token}`, `Bearer  ${reader.token}`, `Bearer ${reader.token} `, reader.token]) {
    const res = await api.app.inject({ method: "GET", url: "/tenant/v1/auth/me", headers: { authorization } });
    assert.equal(res.statusCode, 401, authorization.slice(0, 20));
  }
});

/**
 * 缺陷（低）：验签时用宽松的 base64 解码，同一个签名有多种写法都能通过
 * （加 `=` 补位、换成标准字母表的 `+` `/`、改最后一个字符里不参与解码的低位）。
 * 伪造不了内容，但「一个会话只有一个合法令牌串」不成立：按令牌原文做的黑名单、去重、日志比对都会被绕过。
 */
test("令牌的签名只接受签发时的那一种写法：加补位、换字母表、改末位无效比特的变体都应当 401", async () => {
  const [header, payload, sig] = reader.token.split(".") as [string, string, string];
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const lastIndex = alphabet.indexOf(sig.at(-1) as string);
  const sameBytesOtherChar = `${sig.slice(0, -1)}${alphabet[lastIndex ^ 1]}`;
  assert.deepEqual(Buffer.from(sameBytesOtherChar, "base64url"), Buffer.from(sig, "base64url"), "前提：两种写法解码出同样的字节");
  const variants = {
    "加 = 补位": `${sig}=`,
    "标准字母表并补位": Buffer.from(sig, "base64url").toString("base64"),
    "末位无效比特不同": sameBytesOtherChar,
  };
  const accepted: string[] = [];
  for (const [label, variant] of Object.entries(variants)) {
    if (variant === sig) continue;
    const res = await me("tenant", `${header}.${payload}.${variant}`);
    if (res.status !== 401) accepted.push(label);
  }
  assert.deepEqual(accepted, [], "这些不同于原文的写法也被当成有效令牌");
});

test("停用后再启用：停用前发出的令牌不会复活；改角色不影响会话但权限立即按新角色算", async () => {
  const user = await addTenantUser(api, a.adminToken, "temp@a.test", "readonly");
  assert.equal((await api.call("DELETE", `/tenant/v1/users/${user.id}`, { token: a.adminToken })).status, 204);
  assert.equal((await me("tenant", user.token)).status, 401);
  const enabled = await api.call("PUT", `/tenant/v1/users/${user.id}`, { token: a.adminToken, body: { name: "temp", role: "admin", status: "active" } });
  assert.equal(enabled.status, 200, enabled.text);
  assert.equal((await me("tenant", user.token)).status, 401, "停用前的令牌在重新启用后又能用了");
  // 即使把旧令牌的角色、时间重签一遍也不行：会话行已经删了
  assert.equal((await me("tenant", forge(user.token, { role: "admin", exp: claimsOf(user.token).exp + 3600 }))).status, 401);
});

test("管理员停用自己（还有别的管理员时允许）：自己的令牌立即失效；降级自己后立即失去管理权限", async () => {
  const second = await addTenantUser(api, a.adminToken, "second@a.test", "admin");
  const third = await addTenantUser(api, a.adminToken, "third@a.test", "admin");
  const demoted = await api.call("PUT", `/tenant/v1/users/${second.id}`, { token: second.token, body: { name: "二号", role: "readonly", status: "active" } });
  assert.equal(demoted.status, 200, demoted.text);
  const afterDemotion = await api.call("PUT", `/tenant/v1/users/${second.id}`, { token: second.token, body: { name: "二号", role: "admin", status: "active" } });
  assert.equal(afterDemotion.status, 403, "降级后还能把自己升回管理员");
  assert.equal((await api.call("GET", "/tenant/v1/users", { token: second.token })).status, 200, "只读角色仍可看列表");

  assert.equal((await api.call("DELETE", `/tenant/v1/users/${third.id}`, { token: third.token })).status, 204);
  assert.equal((await me("tenant", third.token)).status, 401);
  const relogin = await api.call("POST", "/tenant/v1/auth/login", { body: { email: "third@a.test", password: TEST_PASSWORD } });
  assert.equal(relogin.status, 403);
  assert.equal(relogin.body.error.code, "ACCOUNT_DISABLED");
  // 原来的管理员不受影响
  assert.equal((await me("tenant", a.adminToken)).status, 200);
});
