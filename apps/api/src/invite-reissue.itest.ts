/**
 * 重发邀请的数据访问函数在「账号刚好已经被激活」时的表现：不改任何东西、返回 null（由流程层转成 409），
 * 而不是把 undefined 当成一行数据继续用（那样接口会 500）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { newInvite } from "./auth/invite-token.ts";
import { withPlatformTx, withTenantTx } from "./db/context.ts";
import { reissuePlatformInvite } from "./repos/platform-users.ts";
import { reissueTenantInvite } from "./repos/tenant-users.ts";
import { type TenantFixture, type TestApi, createTestApi } from "./testing/api.ts";

let api: TestApi;
let tenant: TenantFixture;
let rootId: string;
before(async () => {
  api = await createTestApi();
  const token = await api.superAdminToken("root@platform.test");
  rootId = (await api.call("GET", "/platform/v1/auth/me", { token })).body.user.id;
  tenant = await api.tenantWithAdmin(token, "车队甲", "admin@a.test");
});
after(() => api.close());

test("对已经激活的账号调用重发邀请：返回 null，账号的姓名、角色、状态、密码都不变", async () => {
  const invite = newInvite(api.clock.now());
  const snapshot = async (): Promise<unknown> =>
    (
      await api.db.owner.query(
        `select 'p' as kind, name, role, status, password_hash, invite_token_hash from platform_users where id = $1
         union all
         select 't', name, role, status, password_hash, invite_token_hash from tenant_users where id = $2`,
        [rootId, tenant.adminId],
      )
    ).rows;
  const before = await snapshot();
  const platform = await withPlatformTx(api.db.pool, (db) =>
    reissuePlatformInvite(db, rootId, { email: "root@platform.test", name: "改名", role: "readonly", inviteTokenHash: invite.tokenHash, inviteExpiresAt: invite.expiresAt }, api.clock.now()),
  );
  const fields = { email: "admin@a.test", name: "改名", role: "readonly" as const, inviteTokenHash: invite.tokenHash, inviteExpiresAt: invite.expiresAt };
  const viaTenantTx = await withTenantTx(api.db.pool, tenant.tenantId, (db) => reissueTenantInvite(db, tenant.tenantId, tenant.adminId, fields, api.clock.now()));
  const viaPlatformTx = await withPlatformTx(api.db.pool, (db) => reissueTenantInvite(db, tenant.tenantId, tenant.adminId, fields, api.clock.now()));
  assert.deepEqual([platform, viaTenantTx, viaPlatformTx], [null, null, null]);
  assert.deepEqual(await snapshot(), before);
});
