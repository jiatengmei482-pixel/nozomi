/**
 * 审计日志与业务操作同生共死（验收标准 4）：
 * - 审计写不进去时，业务操作必须整体回滚——不能出现「事情做了但没留记录」。
 * - 被拒绝、没生效的操作不留「成功」的记录；一次请求改了几样就记几条。
 * audit.itest.ts 已经验证了每类操作正常情况下的记录内容，这里不重复。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { APP_DB_ROLE, withTenantTx } from "./db/context.ts";
import { type ApiResponse, type TenantFixture, type TestApi, TEST_PASSWORD, addTenantUser, createTestApi } from "./testing/api.ts";

let api: TestApi;
let platformToken: string;
let a: TenantFixture;
let b: TenantFixture;
let member: { id: string; token: string };

before(async () => {
  api = await createTestApi();
  platformToken = await api.superAdminToken();
  a = await api.tenantWithAdmin(platformToken, "车队甲", "admin@a.test");
  b = await api.tenantWithAdmin(platformToken, "车队乙", "admin@b.test");
  member = await addTenantUser(api, a.adminToken, "member@a.test", "readonly");
});
after(() => api.close());

interface AuditRow {
  tenant_id: string | null;
  actor_type: string;
  actor_id: string | null;
  resource: string;
  resource_id: string | null;
  action: string;
  before: unknown;
  after: unknown;
}

async function auditSince(id: string): Promise<AuditRow[]> {
  const rows = await api.db.pool.query<AuditRow>(
    "select tenant_id, actor_type, actor_id, resource, resource_id, action, before, after from audit_logs where id > $1 order by id",
    [id],
  );
  return rows.rows;
}

async function lastAuditId(): Promise<string> {
  return (await api.db.pool.query<{ id: string }>("select coalesce(max(id), 0)::text as id from audit_logs")).rows[0]?.id ?? "0";
}

/** 整个库的业务数据快照（不含审计日志本身和登录限速计数）。 */
async function snapshot(): Promise<unknown> {
  const q = async (sql: string): Promise<unknown[]> => (await api.db.pool.query(sql)).rows;
  return {
    tenants: await q("select * from tenants order by id"),
    tenantUsers: await q("select * from tenant_users order by tenant_id, id"),
    tenantSessions: await q("select * from tenant_sessions order by tenant_id, id"),
    platformUsers: await q("select * from platform_users order by id"),
    platformSessions: await q("select * from platform_sessions order by id"),
  };
}

test("审计日志写入失败时，每一类敏感操作都整体回滚：返回 500，数据原样不动，不发令牌、不泄露详情", async () => {
  // 先准备好两个邀请和一个待停用的平台账号（这些准备动作本身要能写审计）
  const pendingTenantUser = await api.call("POST", "/tenant/v1/users", { token: a.adminToken, body: { email: "pending@a.test", name: "待激活", role: "readonly" } });
  assert.equal(pendingTenantUser.status, 201, pendingTenantUser.text);
  const pendingStaff = await api.call("POST", "/platform/v1/staff", { token: platformToken, body: { email: "pending@platform.test", name: "待激活", role: "readonly" } });
  assert.equal(pendingStaff.status, 201, pendingStaff.text);
  const memberSession = await api.call("POST", "/tenant/v1/auth/login", { body: { email: "member@a.test", password: TEST_PASSWORD } });
  assert.equal(memberSession.status, 200, memberSession.text);

  const before = await snapshot();
  const auditBefore = await lastAuditId();
  await api.db.pool.query("create function itest_audit_down() returns trigger language plpgsql as $$ begin raise exception '审计存储不可用（测试）'; end $$");
  await api.db.pool.query("create trigger itest_audit_down before insert on audit_logs for each row execute function itest_audit_down()");
  const results: [string, ApiResponse][] = [];
  try {
    const attempt = async (label: string, res: Promise<ApiResponse>): Promise<void> => void results.push([label, await res]);
    const asAdmin = { token: a.adminToken };
    const asPlatform = { token: platformToken };
    await attempt("租户：邀请用户", api.call("POST", "/tenant/v1/users", { ...asAdmin, body: { email: "new@a.test", name: "新人", role: "readonly" } }));
    await attempt("租户：重发邀请", api.call("POST", "/tenant/v1/users", { ...asAdmin, body: { email: "pending@a.test", name: "改名重发", role: "admin" } }));
    await attempt("租户：改角色", api.call("PUT", `/tenant/v1/users/${member.id}`, { ...asAdmin, body: { name: "member@a.test", role: "admin", status: "active" } }));
    await attempt("租户：停用", api.call("DELETE", `/tenant/v1/users/${member.id}`, asAdmin));
    await attempt("租户：接受邀请", api.call("POST", "/tenant/v1/auth/accept-invite", { body: { token: pendingTenantUser.body.invite.token, password: TEST_PASSWORD } }));
    await attempt("租户：登录成功", api.call("POST", "/tenant/v1/auth/login", { body: { email: "member@a.test", password: TEST_PASSWORD } }));
    await attempt("租户：退出", api.call("POST", "/tenant/v1/auth/logout", { token: memberSession.body.access_token }));
    await attempt("平台：创建租户", api.call("POST", "/platform/v1/tenants", { ...asPlatform, body: { name: "车队丙", admin: { email: "admin@c.test", name: "丙" } } }));
    await attempt("平台：暂停租户", api.call("POST", `/platform/v1/tenants/${b.tenantId}/suspend`, { ...asPlatform, body: { reason: "测试" } }));
    await attempt("平台：补发管理员邀请", api.call("POST", `/platform/v1/tenants/${b.tenantId}/admin-invites`, { ...asPlatform, body: { email: "admin2@b.test", name: "乙二" } }));
    await attempt("平台：创建账号", api.call("POST", "/platform/v1/staff", { ...asPlatform, body: { email: "new@platform.test", name: "新员工", role: "readonly" } }));
    await attempt("平台：停用账号", api.call("POST", `/platform/v1/staff/${pendingStaff.body.user.id}/disable`, asPlatform));
    await attempt("平台：接受邀请", api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: pendingStaff.body.invite.token, password: TEST_PASSWORD } }));
    await attempt("平台：登录成功", api.call("POST", "/platform/v1/auth/login", { body: { email: "root@platform.test", password: TEST_PASSWORD } }));
    await attempt("平台：查看集成详情", api.call("GET", "/platform/v1/integrations", asPlatform));
  } finally {
    await api.db.pool.query("drop trigger itest_audit_down on audit_logs");
    await api.db.pool.query("drop function itest_audit_down()");
  }
  for (const [label, res] of results) {
    assert.equal(res.status, 500, `${label}: ${res.status} ${res.text.slice(0, 200)}`);
    assert.deepEqual(res.body, { error: { code: "INTERNAL_ERROR", message: "服务器内部错误，请稍后重试", details: {} } }, label);
  }
  assert.deepEqual(await snapshot(), before, "审计没写成，业务数据却变了");
  assert.deepEqual(await auditSince(auditBefore), []);
  // 会话都还在、邀请都还能用：说明刚才确实是整体回滚，而不是「做了一半」
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: memberSession.body.access_token })).status, 200, "退出失败后会话应当还在");
  const accepted = await api.call("POST", "/tenant/v1/auth/accept-invite", { body: { token: pendingTenantUser.body.invite.token, password: TEST_PASSWORD } });
  assert.equal(accepted.status, 200, `审计恢复后原邀请应当还能用：${accepted.text}`);
});

test("一次修改同时改了角色和状态：各记一条，前后值只含变了的那一项；什么都没变的修改不记；改别的租户的账号不在任何一方留记录", async () => {
  const target = await addTenantUser(api, a.adminToken, "target@a.test", "readonly");
  let mark = await lastAuditId();
  const both = await api.call("PUT", `/tenant/v1/users/${target.id}`, { token: a.adminToken, body: { name: "target@a.test", role: "dispatch", status: "disabled" } });
  assert.equal(both.status, 200, both.text);
  const expectedBase = { tenant_id: a.tenantId, actor_type: "tenant_user", actor_id: a.adminId, resource: "tenant_user", resource_id: target.id };
  assert.deepEqual(await auditSince(mark), [
    { ...expectedBase, action: "change_role", before: { role: "readonly" }, after: { role: "dispatch" } },
    { ...expectedBase, action: "disable", before: { status: "active" }, after: { status: "disabled" } },
  ]);

  mark = await lastAuditId();
  const same = await api.call("PUT", `/tenant/v1/users/${target.id}`, { token: a.adminToken, body: { name: "target@a.test", role: "dispatch", status: "disabled" } });
  assert.equal(same.status, 200, same.text);
  assert.equal((await api.call("DELETE", `/tenant/v1/users/${target.id}`, { token: a.adminToken })).status, 204);
  assert.deepEqual(await auditSince(mark), [], "没有任何变化的修改 / 重复停用不应留下记录");

  mark = await lastAuditId();
  assert.equal((await api.call("PUT", `/tenant/v1/users/${b.adminId}`, { token: a.adminToken, body: { name: "x", role: "readonly", status: "disabled" } })).status, 404);
  assert.equal((await api.call("DELETE", `/tenant/v1/users/${b.adminId}`, { token: a.adminToken })).status, 404);
  assert.equal((await api.call("POST", "/tenant/v1/users", { token: a.adminToken, body: { email: "admin@b.test", name: "抢注", role: "admin" } })).status, 409);
  assert.deepEqual(await auditSince(mark), [], "跨租户的失败尝试不应在任何租户名下留下「成功」记录");
});

/**
 * 缺陷（低，需要负责人判断「改姓名」算不算敏感操作）：
 * PUT /tenant/v1/users/{id} 只改姓名时不写任何审计日志。管理员可以把一个账号的显示名改成别人的名字而不留痕迹；
 * 而重发邀请时改姓名是有记录的（前后值里带 name），两处不一致。
 */
test("只改账号姓名也应当留下审计记录（谁、对哪个账号、前后的姓名）", async () => {
  const mark = await lastAuditId();
  const renamed = await api.call("PUT", `/tenant/v1/users/${member.id}`, { token: a.adminToken, body: { name: "冒用的名字", role: "readonly", status: "active" } });
  assert.equal(renamed.status, 200, renamed.text);
  const rows = await auditSince(mark);
  assert.equal(rows.length, 1, `改姓名产生了 ${rows.length} 条审计记录`);
  assert.equal(rows[0]?.resource_id, member.id);
  assert.equal((rows[0]?.before as { name?: string }).name, "member@a.test");
  assert.equal((rows[0]?.after as { name?: string }).name, "冒用的名字");
});

test("应用角色不能绕开「只能追加」：关触发器、删触发器、改表结构、换所有者都被数据库拒绝", async () => {
  const attempts = [
    "alter table audit_logs disable trigger all",
    "alter table audit_logs disable trigger user",
    "drop trigger audit_logs_no_update_delete on audit_logs",
    "drop trigger audit_logs_no_truncate on audit_logs",
    "create or replace function audit_logs_reject_change() returns trigger language plpgsql as $$ begin return old; end $$",
    "alter table audit_logs disable row level security",
    "drop policy audit_logs_same_tenant on audit_logs",
    "alter table audit_logs drop column before",
    `alter table audit_logs owner to ${APP_DB_ROLE}`,
    "drop table audit_logs",
    "set local session_replication_role = replica",
  ];
  for (const sql of attempts) {
    await assert.rejects(withTenantTx(api.db.pool, a.tenantId, (db) => db.query(sql)), { code: "42501" }, sql);
  }
  const triggers = await api.db.pool.query("select count(*)::int as n from pg_trigger where tgrelid = 'audit_logs'::regclass and not tgisinternal and tgenabled = 'O'");
  assert.equal(triggers.rows[0].n, 2);
});
