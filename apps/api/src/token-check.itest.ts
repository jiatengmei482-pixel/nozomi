/**
 * 只核对一次性令牌、不消费：`auth/check-invite`、`auth/check-reset-token`（平台、租户两边）。
 * 设密码页打开时先调它们，失效的链接直接提示，不再显示表单（M1-13）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { INVITE_TTL_MS } from "./auth/invite-token.ts";
import { RESET_TTL_MS } from "./auth/reset-token.ts";
import { type ApiResponse, TEST_PASSWORD, type TenantFixture, type TestApi, addTenantUser, createTestApi } from "./testing/api.ts";

let api: TestApi;
let rootToken: string;
let tenantA: TenantFixture;
let tenantB: TenantFixture;

before(async () => {
  api = await createTestApi();
  rootToken = await api.superAdminToken("root@platform.test");
  tenantA = await api.tenantWithAdmin(rootToken, "车队甲", "admin@a.test");
  tenantB = await api.tenantWithAdmin(rootToken, "车队乙", "admin@b.test");
});
after(() => api.close());

type Portal = "platform" | "tenant";

const checkInvite = (portal: Portal, token: unknown): Promise<ApiResponse> =>
  api.call("POST", `/${portal}/v1/auth/check-invite`, { body: { token } });
const checkReset = (portal: Portal, token: unknown): Promise<ApiResponse> =>
  api.call("POST", `/${portal}/v1/auth/check-reset-token`, { body: { token } });

let seq = 0;

/** 发一个新邀请，返回令牌和账号编号。 */
async function invite(portal: Portal): Promise<{ token: string; id: string; email: string }> {
  const email = `check-${seq++}@${portal}.test`;
  const res =
    portal === "platform"
      ? await api.call("POST", "/platform/v1/staff", { token: rootToken, body: { email, name: email, role: "operations" } })
      : await api.call("POST", "/tenant/v1/users", { token: tenantA.adminToken, body: { email, name: email, role: "dispatch" } });
  assert.equal(res.status, 201, res.text);
  return { token: res.body.invite.token as string, id: res.body.user.id as string, email };
}

/** 建一个在用的账号并给它发重置令牌。 */
async function issueReset(portal: Portal, tenant: TenantFixture = tenantA): Promise<{ token: string; id: string }> {
  const email = `reset-${seq++}@${portal}.test`;
  let id: string;
  let res: ApiResponse;
  if (portal === "platform") {
    const invited = await invite("platform");
    await api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.token, password: TEST_PASSWORD } });
    id = invited.id;
    res = await api.call("POST", `/platform/v1/staff/${id}/password-reset`, { token: rootToken });
  } else {
    id = (await addTenantUser(api, tenant.adminToken, email, "dispatch")).id;
    res = await api.call("POST", `/tenant/v1/users/${id}/password-reset`, { token: tenant.adminToken });
  }
  assert.ok(res.status === 200 || res.status === 201, res.text);
  return { token: res.body.reset.token as string, id };
}

async function auditCount(): Promise<number> {
  return Number((await api.db.owner.query("select count(*) as n from audit_logs")).rows[0].n);
}

function assertRejected(res: ApiResponse, code: string): void {
  assert.equal(res.status, 400, res.text);
  assert.equal(res.body.error.code, code);
}

for (const portal of ["platform", "tenant"] as const) {
  test(`${portal}：有效的邀请令牌返回 204、没有内容，核对不消费令牌也不写审计`, async () => {
    const { token, email } = await invite(portal);
    const before = await auditCount();
    for (let i = 0; i < 3; i++) {
      const res = await checkInvite(portal, token);
      assert.equal(res.status, 204, res.text);
      assert.equal(res.text, "");
      assert.ok(!res.text.includes(email));
    }
    assert.equal(await auditCount(), before);
    const accepted = await api.call("POST", `/${portal}/v1/auth/accept-invite`, { body: { token, password: TEST_PASSWORD } });
    assert.equal(accepted.status, 200, accepted.text);
  });

  test(`${portal}：用过的邀请令牌和不存在的令牌返回同一个错误`, async () => {
    const { token } = await invite(portal);
    await api.call("POST", `/${portal}/v1/auth/accept-invite`, { body: { token, password: TEST_PASSWORD } });
    const used = await checkInvite(portal, token);
    const missing = await checkInvite(portal, `nzi_${"x".repeat(43)}`);
    assertRejected(used, "INVITE_INVALID");
    assertRejected(missing, "INVITE_INVALID");
    assert.deepEqual(used.body, missing.body);
  });

  test(`${portal}：邀请令牌拿去核对重置、重置令牌拿去核对邀请，都无效`, async () => {
    const invited = await invite(portal);
    const reset = await issueReset(portal);
    assertRejected(await checkReset(portal, invited.token), "RESET_TOKEN_INVALID");
    assertRejected(await checkInvite(portal, reset.token), "INVITE_INVALID");
  });

  test(`${portal}：有效的重置令牌返回 204，核对后仍能用来设密码；用过就失效`, async () => {
    const { token } = await issueReset(portal);
    const before = await auditCount();
    assert.equal((await checkReset(portal, token)).status, 204);
    assert.equal((await checkReset(portal, token)).status, 204);
    assert.equal(await auditCount(), before);
    const reset = await api.call("POST", `/${portal}/v1/auth/reset-password`, { body: { token, password: "Fresh-Lantern-2027" } });
    assert.equal(reset.status, 200, reset.text);
    assertRejected(await checkReset(portal, token), "RESET_TOKEN_INVALID");
  });

  test(`${portal}：再发一次重置令牌，上一个就核对不过`, async () => {
    const first = await issueReset(portal);
    const again =
      portal === "platform"
        ? await api.call("POST", `/platform/v1/staff/${first.id}/password-reset`, { token: rootToken })
        : await api.call("POST", `/tenant/v1/users/${first.id}/password-reset`, { token: tenantA.adminToken });
    assert.ok(again.status === 200 || again.status === 201, again.text);
    assertRejected(await checkReset(portal, first.token), "RESET_TOKEN_INVALID");
    assert.equal((await checkReset(portal, again.body.reset.token)).status, 204);
  });

  test(`${portal}：账号停用后它的重置令牌核对不过`, async () => {
    const { token, id } = await issueReset(portal);
    const disabled =
      portal === "platform"
        ? await api.call("POST", `/platform/v1/staff/${id}/disable`, { token: rootToken })
        : await api.call("DELETE", `/tenant/v1/users/${id}`, { token: tenantA.adminToken });
    assert.ok(disabled.status === 200 || disabled.status === 204, disabled.text);
    assertRejected(await checkReset(portal, token), "RESET_TOKEN_INVALID");
  });

  test(`${portal}：没带令牌、令牌超长返回 VALIDATION_FAILED`, async () => {
    assertRejected(await api.call("POST", `/${portal}/v1/auth/check-invite`, { body: {} }), "VALIDATION_FAILED");
    assertRejected(await checkInvite(portal, "x".repeat(201)), "VALIDATION_FAILED");
    assertRejected(await checkReset(portal, ""), "VALIDATION_FAILED");
  });

  test(`${portal}：一个门户的令牌拿到另一个门户去核对无效`, async () => {
    const other: Portal = portal === "platform" ? "tenant" : "platform";
    const invited = await invite(portal);
    const reset = await issueReset(portal);
    assertRejected(await checkInvite(other, invited.token), "INVITE_INVALID");
    assertRejected(await checkReset(other, reset.token), "RESET_TOKEN_INVALID");
  });
}

test("租户：把租户 B 的重置令牌改成租户 A 的编号，核对不过（不会跨租户查到）", async () => {
  const { token } = await issueReset("tenant", tenantB);
  const idA = tenantA.tenantId.replaceAll("-", "").toLowerCase();
  const forged = token.replace(/^nzr_[0-9a-f]{32}\./, `nzr_${idA}.`);
  assert.notEqual(forged, token);
  assertRejected(await checkReset("tenant", forged), "RESET_TOKEN_INVALID");
  assert.equal((await checkReset("tenant", token)).status, 204);
});

test("租户：重新邀请管理员后，旧的邀请令牌核对不过", async () => {
  const created = await api.call("POST", "/platform/v1/tenants", {
    token: rootToken,
    body: { name: "车队丙", admin: { email: "admin@c.test", name: "丙管理员" } },
  });
  assert.equal(created.status, 201, created.text);
  const first = created.body.invite.token as string;
  assert.equal((await checkInvite("tenant", first)).status, 204);
  const again = await api.call("POST", `/platform/v1/tenants/${created.body.tenant.id}/admin-invites`, {
    token: rootToken,
    body: { email: "admin@c.test", name: "丙管理员" },
  });
  assert.ok(again.status === 200 || again.status === 201, again.text);
  assertRejected(await checkInvite("tenant", first), "INVITE_INVALID");
  assert.equal((await checkInvite("tenant", again.body.invite.token)).status, 204);
});

test("过期的邀请令牌和重置令牌都核对不过（放在最后：会把测试时钟往后拨）", async () => {
  const invites = [await invite("platform"), await invite("tenant")];
  const resets = [await issueReset("platform"), await issueReset("tenant")];
  api.clock.advance(RESET_TTL_MS + 1_000);
  assertRejected(await checkReset("platform", resets[0]!.token), "RESET_TOKEN_INVALID");
  assertRejected(await checkReset("tenant", resets[1]!.token), "RESET_TOKEN_INVALID");
  assert.equal((await checkInvite("platform", invites[0]!.token)).status, 204);
  api.clock.advance(INVITE_TTL_MS);
  assertRejected(await checkInvite("platform", invites[0]!.token), "INVITE_INVALID");
  assertRejected(await checkInvite("tenant", invites[1]!.token), "INVITE_INVALID");
});
