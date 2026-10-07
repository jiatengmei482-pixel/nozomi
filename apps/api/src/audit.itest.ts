/**
 * 验收标准 4：敏感操作写审计日志（谁、什么时间、从哪个 IP、哪个入口、对什么对象做了什么、前后值），
 * 只能追加不能改，里面没有密码、令牌；平台可以按人、对象、时间查询。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { leakedSecrets } from "./testing/fixtures.ts";

let api: TestApi;
let rootToken: string;
let rootId: string;
/** 流程里出现过的全部密码、邀请令牌、访问令牌：最后统一检查它们没有进审计日志和应用日志。 */
const sensitive = new Set<string>([TEST_PASSWORD, "Wrong-Password-000"]);

interface Flow {
  staffId: string;
  tenantId: string;
  tenantAdminId: string;
  tenantAdminToken: string;
  subUserId: string;
}
let flow: Flow;

const PLATFORM_IP = "203.0.113.10";
const TENANT_IP = "198.51.100.20";

async function logs(query: string): Promise<any[]> {
  const res = await api.call("GET", `/platform/v1/audit-logs?limit=200&${query}`, { token: rootToken });
  assert.equal(res.status, 200, res.text);
  return res.body.items;
}

before(async () => {
  api = await createTestApi();
  rootToken = await api.superAdminToken("root@platform.test");
  sensitive.add(rootToken);
  rootId = (await api.call("GET", "/platform/v1/auth/me", { token: rootToken })).body.user.id;
  const p = (method: "GET" | "POST", url: string, body?: unknown) => api.call(method, url, { token: rootToken, body, ip: PLATFORM_IP });

  // 平台侧：登录失败两种、创建平台账号、接受邀请、停用、启用、查看集成详情
  await api.call("POST", "/platform/v1/auth/login", { ip: PLATFORM_IP, body: { email: "root@platform.test", password: "Wrong-Password-000" } });
  await api.call("POST", "/platform/v1/auth/login", { ip: PLATFORM_IP, body: { email: "ghost@platform.test", password: "Wrong-Password-000" } });
  api.clock.advance(1_000);
  const staff = await p("POST", "/platform/v1/staff", { email: "ops@platform.test", name: "运营", role: "operations" });
  sensitive.add(staff.body.invite.token);
  await api.call("POST", "/platform/v1/auth/accept-invite", { ip: PLATFORM_IP, body: { token: staff.body.invite.token, password: TEST_PASSWORD } });
  await p("POST", `/platform/v1/staff/${staff.body.user.id}/disable`);
  await p("POST", `/platform/v1/staff/${staff.body.user.id}/enable`);
  await p("GET", "/platform/v1/integrations");

  // 租户侧：创建租户、接受邀请、登录、登录失败、邀请子账号、改角色、停用、启用、退出
  api.clock.advance(1_000);
  const created = await p("POST", "/platform/v1/tenants", { name: "车队甲", admin: { email: "admin@a.test", name: "甲管理员" } });
  sensitive.add(created.body.invite.token);
  await api.call("POST", "/tenant/v1/auth/accept-invite", { ip: TENANT_IP, body: { token: created.body.invite.token, password: TEST_PASSWORD } });
  await api.call("POST", "/tenant/v1/auth/login", { ip: TENANT_IP, body: { email: "admin@a.test", password: "Wrong-Password-000" } });
  await api.call("POST", "/tenant/v1/auth/login", { ip: TENANT_IP, body: { email: "ghost@a.test", password: "Wrong-Password-000" } });
  const login = await api.call("POST", "/tenant/v1/auth/login", { ip: TENANT_IP, body: { email: "admin@a.test", password: TEST_PASSWORD } });
  const tenantToken = login.body.access_token as string;
  sensitive.add(tenantToken);
  const t = (method: "POST" | "PUT" | "DELETE", url: string, body?: unknown) => api.call(method, url, { token: tenantToken, body, ip: TENANT_IP });
  const sub = await t("POST", "/tenant/v1/users", { email: "dispatch@a.test", name: "调度", role: "dispatch" });
  sensitive.add(sub.body.invite.token);
  await api.call("POST", "/tenant/v1/auth/accept-invite", { ip: TENANT_IP, body: { token: sub.body.invite.token, password: TEST_PASSWORD } });
  await t("PUT", `/tenant/v1/users/${sub.body.user.id}`, { name: "调度", role: "finance", status: "active" });
  await t("DELETE", `/tenant/v1/users/${sub.body.user.id}`);
  await t("PUT", `/tenant/v1/users/${sub.body.user.id}`, { name: "调度", role: "finance", status: "active" });
  const extra = await api.call("POST", "/tenant/v1/auth/login", { ip: TENANT_IP, body: { email: "admin@a.test", password: TEST_PASSWORD } });
  sensitive.add(extra.body.access_token);
  await api.call("POST", "/tenant/v1/auth/logout", { token: extra.body.access_token, ip: TENANT_IP });

  // 暂停、恢复租户
  api.clock.advance(1_000);
  await p("POST", `/platform/v1/tenants/${created.body.tenant.id}/suspend`, { reason: "资质过期" });
  await p("POST", `/platform/v1/tenants/${created.body.tenant.id}/resume`);

  flow = {
    staffId: staff.body.user.id,
    tenantId: created.body.tenant.id,
    tenantAdminId: created.body.admin_user.id,
    tenantAdminToken: tenantToken,
    subUserId: sub.body.user.id,
  };
});
after(() => api.close());

test("每条记录都有：时间、操作人、来源地址、入口、对象、动作；字段与接口定义一致", async () => {
  const all = await logs("");
  assert.ok(all.length >= 20);
  for (const log of all) {
    assert.deepEqual(Object.keys(log), [
      "id", "occurred_at", "tenant_id", "actor", "ip", "source", "resource", "resource_id", "action", "before", "after",
    ]);
    assert.ok(!Number.isNaN(Date.parse(log.occurred_at)));
    assert.deepEqual(Object.keys(log.actor), ["type", "id", "email"]);
    if (log.source === "cli") assert.equal(log.ip, null);
    else assert.ok([PLATFORM_IP, TENANT_IP, "127.0.0.1"].includes(log.ip), log.ip);
  }
});

test("命令行创建超级管理员：记为系统操作、入口是命令行，后值里有邮箱和角色但没有密码", async () => {
  const [log] = await logs(`resource=platform_user&resource_id=${rootId}&action=create`);
  assert.deepEqual(
    { actor: log.actor, source: log.source, ip: log.ip, before: log.before, after: log.after },
    {
      actor: { type: "system", id: null, email: null },
      source: "cli",
      ip: null,
      before: null,
      after: { email: "root@platform.test", name: "平台超管", role: "super_admin", status: "active" },
    },
  );
});

test("平台登录成功 / 失败（密码错误、邮箱不存在）", async () => {
  const success = await logs(`resource=platform_user&resource_id=${rootId}&action=login`);
  assert.equal(success.length, 1);
  assert.deepEqual(success[0].actor, { type: "platform_user", id: rootId, email: "root@platform.test" });
  assert.equal(success[0].source, "console");

  const failed = await logs("resource=platform_user&action=login_failed");
  assert.deepEqual(
    failed.map((l) => ({ actor: l.actor.type, resource_id: l.resource_id, after: l.after, ip: l.ip })).reverse(),
    [
      { actor: "anonymous", resource_id: rootId, after: { email: "root@platform.test", reason: "wrong_password" }, ip: PLATFORM_IP },
      { actor: "anonymous", resource_id: null, after: { email: "ghost@platform.test", reason: "unknown_email" }, ip: PLATFORM_IP },
    ],
  );
});

test("创建 / 停用 / 启用平台账号、接受邀请：按对象查得到完整经过，带前后值和操作人", async () => {
  const history = (await logs(`resource=platform_user&resource_id=${flow.staffId}`)).reverse();
  assert.deepEqual(
    history.map((l) => ({ action: l.action, actor: l.actor.email, before: l.before, after: l.after })),
    [
      { action: "invite", actor: "root@platform.test", before: null, after: { email: "ops@platform.test", name: "运营", role: "operations", status: "invited" } },
      { action: "accept_invite", actor: "ops@platform.test", before: { status: "invited" }, after: { status: "active" } },
      { action: "disable", actor: "root@platform.test", before: { status: "active" }, after: { status: "disabled" } },
      { action: "enable", actor: "root@platform.test", before: { status: "disabled" }, after: { status: "active" } },
    ],
  );
  assert.ok(history.every((l) => l.tenant_id === null && l.ip === PLATFORM_IP));
});

test("创建 / 暂停 / 恢复租户：记在该租户名下，操作人是平台员工，暂停带原因", async () => {
  const history = (await logs(`resource=tenant&resource_id=${flow.tenantId}`)).reverse();
  assert.deepEqual(
    history.map((l) => ({ action: l.action, before: l.before, after: l.after })),
    [
      { action: "create", before: null, after: { name: "车队甲", status: "active" } },
      { action: "suspend", before: { status: "active" }, after: { status: "suspended", reason: "资质过期" } },
      { action: "resume", before: { status: "suspended" }, after: { status: "active" } },
    ],
  );
  for (const log of history) {
    assert.equal(log.tenant_id, flow.tenantId);
    assert.deepEqual(log.actor, { type: "platform_user", id: rootId, email: "root@platform.test" });
  }
});

test("邀请 / 改角色 / 停用 / 启用租户用户、接受邀请", async () => {
  const history = (await logs(`resource=tenant_user&resource_id=${flow.subUserId}`)).reverse();
  assert.deepEqual(
    history.map((l) => ({ action: l.action, actor: l.actor.email, before: l.before, after: l.after })),
    [
      { action: "invite", actor: "admin@a.test", before: null, after: { email: "dispatch@a.test", name: "调度", role: "dispatch", status: "invited" } },
      { action: "accept_invite", actor: "dispatch@a.test", before: { status: "invited" }, after: { status: "active" } },
      { action: "change_role", actor: "admin@a.test", before: { role: "dispatch" }, after: { role: "finance" } },
      { action: "disable", actor: "admin@a.test", before: { status: "active" }, after: { status: "disabled" } },
      { action: "enable", actor: "admin@a.test", before: { status: "disabled" }, after: { status: "active" } },
    ],
  );
  assert.ok(history.every((l) => l.tenant_id === flow.tenantId && l.ip === TENANT_IP && l.source === "console"));

  const firstAdmin = (await logs(`resource=tenant_user&resource_id=${flow.tenantAdminId}&action=invite`))[0];
  assert.equal(firstAdmin.actor.type, "platform_user", "第一个管理员是平台邀请的");
});

test("租户登录成功 / 失败 / 退出：已知账号的失败记在它的租户名下，不存在的邮箱记为平台级", async () => {
  const mine = await logs(`tenant_id=${flow.tenantId}&resource=tenant_user&resource_id=${flow.tenantAdminId}`);
  assert.deepEqual(
    mine.map((l) => l.action).reverse(),
    ["invite", "accept_invite", "login_failed", "login", "login", "logout"],
  );
  const failed = mine.find((l) => l.action === "login_failed");
  assert.deepEqual(failed.after, { email: "admin@a.test", reason: "wrong_password" });
  assert.equal(failed.actor.type, "anonymous");

  const ghost = (await logs("resource=tenant_user&action=login_failed")).find((l) => l.after.email === "ghost@a.test");
  assert.deepEqual({ tenant_id: ghost.tenant_id, resource_id: ghost.resource_id, reason: ghost.after.reason }, { tenant_id: null, resource_id: null, reason: "unknown_email" });
});

test("查看集成详情：每看一次记一条", async () => {
  const before = (await logs("resource=integration&action=view")).length;
  assert.equal(before, 1);
  await api.call("GET", "/platform/v1/integrations", { token: rootToken, ip: PLATFORM_IP });
  const after = await logs("resource=integration&action=view");
  assert.equal(after.length, 2);
  assert.deepEqual(after[0].actor, { type: "platform_user", id: rootId, email: "root@platform.test" });
});

test("被拒绝的操作不产生「成功」的记录：没权限的、校验失败的、被「至少保留一个管理员」拦下的", async () => {
  const count = async (): Promise<number> => (await api.db.pool.query("select count(*)::int as n from audit_logs")).rows[0].n;
  // 用一个新的租户会话来做下面的尝试（登录本身会写一条记录，所以在计数之前做）
  const relogin = await api.call("POST", "/tenant/v1/auth/login", { ip: TENANT_IP, body: { email: "admin@a.test", password: TEST_PASSWORD } });
  const tenantToken = relogin.body.access_token as string;
  sensitive.add(tenantToken);
  const before = await count();
  const rejected = [
    await api.call("POST", "/platform/v1/tenants", { token: rootToken, body: { name: "" } }),
    await api.call("POST", "/platform/v1/tenants", { token: tenantToken, body: { name: "x", admin: { email: "x@x.test", name: "x" } } }),
    await api.call("DELETE", `/tenant/v1/users/${flow.tenantAdminId}`, { token: tenantToken }),
    await api.call("PUT", `/tenant/v1/users/${flow.subUserId}`, { token: tenantToken, body: { name: "x", role: "finance", status: "invited" } }),
    await api.call("POST", `/platform/v1/staff/${rootId}/disable`, { token: rootToken }),
  ];
  assert.deepEqual(rejected.map((r) => r.status), [400, 401, 409, 409, 409]);
  const unchanged = await api.call("POST", `/platform/v1/tenants/${flow.tenantId}/resume`, { token: rootToken });
  assert.equal(unchanged.status, 200, "状态没变化的重复操作不重复记录");
  assert.equal(await count(), before);
});

test("按人查、按租户查、按时间查，条件可以组合；从新到旧；翻页不重不漏", async () => {
  const byActor = await logs(`actor_id=${rootId}`);
  assert.ok(byActor.length >= 8);
  assert.ok(byActor.every((l) => l.actor.id === rootId));

  const byTenant = await logs(`tenant_id=${flow.tenantId}`);
  assert.ok(byTenant.length >= 12);
  assert.ok(byTenant.every((l) => l.tenant_id === flow.tenantId));

  const all = await logs("");
  const ids = all.map((l) => BigInt(l.id));
  assert.deepEqual(ids, [...ids].sort((x, y) => (x < y ? 1 : -1)), "应该从新到旧");

  const suspendAt = (await logs("action=suspend"))[0].occurred_at;
  const fromSuspend = await logs(`from=${encodeURIComponent(suspendAt)}`);
  // 暂停之后发生的：暂停、恢复，以及前面两个测试里的「再看一次集成详情」和「重新登录」
  assert.deepEqual(fromSuspend.map((l) => l.action).sort(), ["login", "resume", "suspend", "view"]);
  const beforeSuspend = await logs(`to=${encodeURIComponent(suspendAt)}`);
  assert.equal(beforeSuspend.length + fromSuspend.length, (await logs("")).length);
  const combined = await logs(`actor_id=${rootId}&tenant_id=${flow.tenantId}&from=${encodeURIComponent(suspendAt)}`);
  assert.deepEqual(combined.map((l) => l.action), ["resume", "suspend"]);

  const paged: string[] = [];
  let cursor: string | null = null;
  do {
    const res = await api.call("GET", `/platform/v1/audit-logs?limit=7${cursor ? `&cursor=${cursor}` : ""}`, { token: rootToken });
    paged.push(...res.body.items.map((l: any) => l.id));
    cursor = res.body.next_cursor;
  } while (cursor);
  assert.deepEqual(paged, (await logs("")).map((l) => l.id));
});

test("查询参数校验：编号、时间格式不对返回 400", async () => {
  for (const query of ["actor_id=abc", "tenant_id=1", "from=yesterday", "to=2026-10-07", "from=2026-10-07T00:00:00", "limit=0", "cursor=xyz"]) {
    const res = await api.call("GET", `/platform/v1/audit-logs?${query}`, { token: rootToken });
    assert.equal(res.status, 400, query);
    assert.equal(res.body.error.code, "VALIDATION_FAILED");
  }
});

test("只能追加：数据库层面拒绝修改、删除、清空（即使用表的所有者 / 超级用户连接）", async () => {
  const count = async (): Promise<number> => (await api.db.pool.query("select count(*)::int as n from audit_logs")).rows[0].n;
  const before = await count();
  const attempts = [
    "update audit_logs set action = 'tampered'",
    "update audit_logs set after = '{}'::jsonb where id = (select min(id) from audit_logs)",
    "delete from audit_logs",
    "delete from audit_logs where id = (select max(id) from audit_logs)",
    "truncate audit_logs",
    "truncate audit_logs, tenant_sessions cascade",
  ];
  for (const sql of attempts) {
    await assert.rejects(api.db.pool.query(sql), { code: "23001", message: /只能追加/ }, sql);
  }
  assert.equal(await count(), before);
  const tampered = await api.db.pool.query("select count(*)::int as n from audit_logs where action = 'tampered'");
  assert.equal(tampered.rows[0].n, 0);
});

test("接口上没有修改或删除审计日志的入口", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
    const res = await api.call(method, "/platform/v1/audit-logs", { token: rootToken, body: {} });
    assert.equal(res.status, 404, method);
  }
  assert.equal((await api.call("DELETE", "/platform/v1/audit-logs/1", { token: rootToken })).status, 404);
});

test("审计日志和应用日志里没有密码、密码哈希、邀请令牌、访问令牌、配置里的密钥", async () => {
  const table = await api.db.pool.query("select row_to_json(a)::text as line from audit_logs a");
  const auditText = table.rows.map((r) => r.line).join("\n");
  const apiText = JSON.stringify(await logs(""));
  const logText = api.logs();
  assert.ok(logText.length > 1_000, "应该截到了请求日志");
  for (const [name, text] of [["审计表", auditText], ["审计查询接口", apiText], ["应用日志", logText]] as const) {
    for (const value of sensitive) assert.ok(!text.includes(value), `${name}里出现了敏感内容 ${value.slice(0, 6)}…`);
    assert.ok(!text.includes("scrypt$"), `${name}里出现了密码哈希`);
    assert.doesNotMatch(text, /nzi_[A-Za-z0-9_-]{20,}/, `${name}里出现了邀请令牌`);
    assert.doesNotMatch(text, /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, `${name}里出现了访问令牌`);
    assert.deepEqual(leakedSecrets(text), [], name);
  }
  const hashes = await api.db.pool.query(
    "select password_hash as h from platform_users union all select password_hash from tenant_users union all select invite_token_hash from tenant_users",
  );
  for (const { h } of hashes.rows) if (h) assert.ok(!auditText.includes(h) && !logText.includes(h));
});

test("错误响应里不回显密码和令牌", async () => {
  const responses = [
    await api.call("POST", "/platform/v1/auth/login", { body: { email: "root@platform.test", password: "Wrong-Password-000" } }),
    await api.call("POST", "/tenant/v1/auth/login", { body: { email: "bad", password: "Wrong-Password-000" } }),
    await api.call("POST", "/tenant/v1/auth/accept-invite", { body: { token: "nzi_guess-guess-guess-guess", password: "Wrong-Password-000" } }),
    await api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: 12345, password: ["Wrong-Password-000"] } }),
    await api.call("GET", "/tenant/v1/users", { token: "eyJhbGciOiJIUzI1NiJ9.forged-token-value.signature" }),
  ];
  for (const res of responses) {
    assert.ok(res.status >= 400);
    assert.ok(!res.text.includes("Wrong-Password-000") && !res.text.includes("nzi_guess") && !res.text.includes("forged-token-value"), res.text);
  }
});
