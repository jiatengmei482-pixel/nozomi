import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { issueSession, SESSION_TTL_MS } from "./session.ts";
import { type AccessTokenClaims, bearerToken, signAccessToken, verifyAccessToken } from "./token.ts";

const SECRET = "unit-test-secret-not-a-real-one-0123456789";
const now = new Date("2026-10-07T01:00:00Z");
const seconds = (date: Date): number => Math.floor(date.getTime() / 1000);

const platformClaims: AccessTokenClaims = {
  aud: "platform",
  sub: "11111111-1111-4111-8111-111111111111",
  sid: "22222222-2222-4222-8222-222222222222",
  tid: null,
  role: "super_admin",
  iat: seconds(now),
  exp: seconds(now) + 3600,
};
const tenantClaims: AccessTokenClaims = {
  ...platformClaims,
  aud: "tenant",
  tid: "33333333-3333-4333-8333-333333333333",
  role: "admin",
};

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

test("签发后能验证，取回的内容与签发时一致", () => {
  assert.deepEqual(verifyAccessToken(SECRET, "platform", signAccessToken(SECRET, platformClaims), now), platformClaims);
  assert.deepEqual(verifyAccessToken(SECRET, "tenant", signAccessToken(SECRET, tenantClaims), now), tenantClaims);
});

test("平台令牌过不了租户接口的验证，租户令牌过不了平台接口的验证", () => {
  assert.equal(verifyAccessToken(SECRET, "tenant", signAccessToken(SECRET, platformClaims), now), null);
  assert.equal(verifyAccessToken(SECRET, "platform", signAccessToken(SECRET, tenantClaims), now), null);
});

test("两类令牌的签名密钥不同：把平台令牌的受众改成 tenant 再套用原签名，验证不过", () => {
  const [header, , signature] = signAccessToken(SECRET, platformClaims).split(".");
  const forged = `${header}.${encode({ ...platformClaims, aud: "tenant", tid: tenantClaims.tid })}.${signature}`;
  assert.equal(verifyAccessToken(SECRET, "tenant", forged, now), null);
});

test("受众和租户编号必须配套：租户令牌没有租户编号、平台令牌带了租户编号，都不接受", () => {
  assert.equal(verifyAccessToken(SECRET, "tenant", signAccessToken(SECRET, { ...tenantClaims, tid: null }), now), null);
  assert.equal(
    verifyAccessToken(SECRET, "platform", signAccessToken(SECRET, { ...platformClaims, tid: tenantClaims.tid }), now),
    null,
  );
});

test("过期：到了过期时间那一秒就不再接受", () => {
  const token = signAccessToken(SECRET, platformClaims);
  assert.ok(verifyAccessToken(SECRET, "platform", token, new Date(platformClaims.exp * 1000 - 1)));
  assert.equal(verifyAccessToken(SECRET, "platform", token, new Date(platformClaims.exp * 1000)), null);
});

test("改动内容、换密钥、改签名：都验证不过", () => {
  const token = signAccessToken(SECRET, tenantClaims);
  const [header, payload, signature] = token.split(".") as [string, string, string];
  const otherTenant = encode({ ...tenantClaims, tid: "44444444-4444-4444-8444-444444444444" });
  assert.equal(verifyAccessToken(SECRET, "tenant", `${header}.${otherTenant}.${signature}`, now), null);
  assert.equal(verifyAccessToken(`${SECRET}x`, "tenant", token, now), null);
  assert.equal(verifyAccessToken(SECRET, "tenant", `${header}.${payload}.${signature.slice(0, -2)}AA`, now), null);
  assert.equal(verifyAccessToken(SECRET, "tenant", `${header}.${payload}.`, now), null);
});

test("签名只接受签发时的那一种写法：加补位、换成标准字母表、改末位无效比特的变体都不接受", () => {
  const token = signAccessToken(SECRET, tenantClaims);
  const [header, payload, signature] = token.split(".") as [string, string, string];
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const last = alphabet.indexOf(signature.at(-1) as string);
  const sameBytes = `${signature.slice(0, -1)}${alphabet[last ^ 1]}`;
  assert.deepEqual(Buffer.from(sameBytes, "base64url"), Buffer.from(signature, "base64url"), "前提：解码出同样的字节");
  for (const variant of [`${signature}=`, Buffer.from(signature, "base64url").toString("base64"), sameBytes, ` ${signature}`]) {
    if (variant === signature) continue;
    assert.equal(verifyAccessToken(SECRET, "tenant", `${header}.${payload}.${variant}`, now), null, variant);
  }
  assert.ok(verifyAccessToken(SECRET, "tenant", token, now));
});

test("不接受自称「不签名」或换了算法的令牌头", () => {
  const payload = encode(tenantClaims);
  const noneHeader = encode({ alg: "none", typ: "JWT" });
  assert.equal(verifyAccessToken(SECRET, "tenant", `${noneHeader}.${payload}.`, now), null);
  const otherHeader = encode({ alg: "HS512", typ: "JWT" });
  const signature = createHmac("sha512", SECRET).update(`${otherHeader}.${payload}`).digest("base64url");
  assert.equal(verifyAccessToken(SECRET, "tenant", `${otherHeader}.${payload}.${signature}`, now), null);
});

test("直接拿登录签名密钥本身做 HS256 签名的令牌不被接受（实际用的是派生密钥）", () => {
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode(tenantClaims);
  const signature = createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
  assert.equal(verifyAccessToken(SECRET, "tenant", `${header}.${payload}.${signature}`, now), null);
});

test("乱七八糟的输入：返回 null，不抛错", () => {
  for (const token of ["", "abc", "a.b", "a.b.c.d", "..", `${"x".repeat(3000)}.y.z`]) {
    assert.equal(verifyAccessToken(SECRET, "platform", token, now), null, token.slice(0, 20));
  }
});

test("字段缺失或类型不对的令牌（即使签名正确）不接受", () => {
  const { sid: _sid, ...withoutSession } = platformClaims;
  for (const claims of [withoutSession, { ...platformClaims, exp: "never" }, { ...platformClaims, aud: "sales" }]) {
    const token = signAccessToken(SECRET, claims as unknown as AccessTokenClaims);
    assert.equal(verifyAccessToken(SECRET, "platform", token, now), null);
  }
});

test("会话 8 小时过期；令牌里带会话编号、受众、租户和角色", () => {
  assert.equal(SESSION_TTL_MS, 8 * 60 * 60 * 1000);
  const session = issueSession(SECRET, { audience: "tenant", userId: tenantClaims.sub, tenantId: tenantClaims.tid, role: "admin" }, now);
  assert.equal(session.expiresAt.getTime() - now.getTime(), SESSION_TTL_MS);
  const claims = verifyAccessToken(SECRET, "tenant", session.accessToken, now);
  assert.deepEqual(claims, {
    aud: "tenant",
    sub: tenantClaims.sub,
    sid: session.sessionId,
    tid: tenantClaims.tid,
    role: "admin",
    iat: seconds(now),
    exp: seconds(now) + 8 * 3600,
  });
  const other = issueSession(SECRET, { audience: "tenant", userId: tenantClaims.sub, tenantId: tenantClaims.tid, role: "admin" }, now);
  assert.notEqual(other.sessionId, session.sessionId);
});

test("bearerToken：只认 `Bearer <令牌>` 这一种写法", () => {
  assert.equal(bearerToken("Bearer abc.def-_.ghi"), "abc.def-_.ghi");
  for (const header of [undefined, "", "Bearer", "Bearer ", "bearer abc", "Basic abc", "Bearer a b", "Bearer abc\n"]) {
    assert.equal(bearerToken(header), null, String(header));
  }
});
