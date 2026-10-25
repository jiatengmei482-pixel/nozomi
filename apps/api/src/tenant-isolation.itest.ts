/**
 * 验收标准 3：租户 A 读不到、改不了租户 B 的任何数据。
 * 逐个覆盖 /tenant/v1 的每个接口；最后一个测试会核对「这里覆盖的接口清单」和实际注册的租户接口一致，
 * 以后新增租户接口而没有在这里补跨租户测试，测试会失败。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { signAccessToken, verifyAccessToken } from "./auth/token.ts";
import { withPlatformTx, withTenantTx } from "./db/context.ts";
import { XLSX_CONTENT_TYPE, readXlsx, writeXlsx } from "./integrations/xlsx.ts";
import { type ApiResponse, type HttpMethod, TEST_PASSWORD, type TenantFixture, type TestApi, addTenantUser, approverToken, createTestApi, uploadBytes } from "./testing/api.ts";
import { deniedByDatabase } from "./testing/db.ts";
import { FAKE_SECRETS } from "./testing/fixtures.ts";

let api: TestApi;
let platformToken: string;
let a: TenantFixture;
let b: TenantFixture;
let bDispatcher: { id: string; token: string };

/** 本文件里做过跨租户验证的接口；与实际注册的租户接口核对。 */
const covered = new Set<string>();
const cover = (route: string): void => void covered.add(route);

before(async () => {
  api = await createTestApi();
  platformToken = await api.superAdminToken();
  a = await api.tenantWithAdmin(platformToken, "车队甲", "admin@a.test");
  b = await api.tenantWithAdmin(platformToken, "车队乙", "admin@b.test");
  bDispatcher = await addTenantUser(api, b.adminToken, "dispatch@b.test", "dispatch");
});
after(() => api.close());

async function userRow(id: string): Promise<Record<string, unknown>> {
  const result = await api.db.owner.query(
    "select tenant_id, email, name, role, status, password_hash is not null as has_password from tenant_users where id = $1",
    [id],
  );
  return result.rows[0];
}

test("GET /tenant/v1/users：只列出自己租户的账号，翻到底也没有别的租户的", async () => {
  cover("GET /tenant/v1/users");
  const emails: string[] = [];
  let cursor: string | null = null;
  do {
    const res = await api.call("GET", `/tenant/v1/users?limit=1${cursor ? `&cursor=${cursor}` : ""}`, { token: a.adminToken });
    assert.equal(res.status, 200);
    emails.push(...res.body.items.map((u: any) => u.email));
    cursor = res.body.next_cursor;
  } while (cursor);
  assert.deepEqual(emails, ["admin@a.test"]);
  assert.ok(!JSON.stringify(emails).includes("b.test"));
});

test("GET /tenant/v1/users：查询串里带别的租户的 tenant_id 不生效", async () => {
  const res = await api.call("GET", `/tenant/v1/users?tenant_id=${b.tenantId}`, { token: a.adminToken });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items.map((u: any) => u.email), ["admin@a.test"]);
});

test("GET /tenant/v1/users：拿租户乙的翻页游标到租户甲用，也翻不出乙的数据", async () => {
  const bPage = await api.call("GET", "/tenant/v1/users?limit=1", { token: b.adminToken });
  assert.ok(bPage.body.next_cursor, "租户乙有两个账号，应该有下一页");
  const res = await api.call("GET", `/tenant/v1/users?cursor=${bPage.body.next_cursor}`, { token: a.adminToken });
  assert.equal(res.status, 200);
  assert.ok(res.body.items.every((u: any) => u.email.endsWith("@a.test")));
});

test("GET /tenant/v1/auth/me：返回的是令牌所属的租户和账号", async () => {
  cover("GET /tenant/v1/auth/me");
  const res = await api.call("GET", `/tenant/v1/auth/me?tenant_id=${b.tenantId}`, { token: a.adminToken });
  assert.equal(res.status, 200);
  assert.equal(res.body.tenant.id, a.tenantId);
  assert.equal(res.body.user.id, a.adminId);
  assert.ok(!res.text.includes(b.tenantId));
});

test("PUT /tenant/v1/users/{id}：改租户乙的账号返回 404，乙的数据原样不动", async () => {
  cover("PUT /tenant/v1/users/:id");
  const before = await userRow(bDispatcher.id);
  const res = await api.call("PUT", `/tenant/v1/users/${bDispatcher.id}`, {
    token: a.adminToken,
    body: { name: "被甲改了", role: "admin", status: "disabled", tenant_id: b.tenantId },
  });
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, "NOT_FOUND");
  assert.deepEqual(await userRow(bDispatcher.id), before);
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: bDispatcher.token })).status, 200);
});

test("PUT /tenant/v1/users/{id}：别的租户的账号和根本不存在的账号，返回完全一样（不暴露是否存在）", async () => {
  const body = { name: "x", role: "readonly", status: "active" };
  const foreign = await api.call("PUT", `/tenant/v1/users/${bDispatcher.id}`, { token: a.adminToken, body });
  const missing = await api.call("PUT", "/tenant/v1/users/99999999-9999-4999-8999-999999999999", { token: a.adminToken, body });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.text, missing.text);
});

test("DELETE /tenant/v1/users/{id}：停用租户乙的账号返回 404，乙的账号照常能用", async () => {
  cover("DELETE /tenant/v1/users/:id");
  const res = await api.call("DELETE", `/tenant/v1/users/${bDispatcher.id}`, { token: a.adminToken });
  assert.equal(res.status, 404);
  assert.equal((await userRow(bDispatcher.id))["status"], "active");
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: bDispatcher.token })).status, 200);
  const missing = await api.call("DELETE", "/tenant/v1/users/99999999-9999-4999-8999-999999999999", { token: a.adminToken });
  assert.equal(res.text, missing.text);
});

test("POST /tenant/v1/users：请求体和查询串里的 tenant_id 不生效，账号建在令牌所属的租户", async () => {
  cover("POST /tenant/v1/users");
  const res = await api.call("POST", `/tenant/v1/users?tenant_id=${b.tenantId}`, {
    token: a.adminToken,
    body: { email: "new@a.test", name: "新同事", role: "dispatch", tenant_id: b.tenantId, tenantId: b.tenantId },
  });
  assert.equal(res.status, 201, res.text);
  assert.equal((await userRow(res.body.user.id))["tenant_id"], a.tenantId);
  const bUsers = await api.call("GET", "/tenant/v1/users", { token: b.adminToken });
  assert.ok(!bUsers.body.items.some((u: any) => u.email === "new@a.test"));
});

test("POST /tenant/v1/users：邀请一个已经属于租户乙的邮箱，只说「已被使用」，不动乙的账号、不透露它在哪个租户", async () => {
  const before = await userRow(bDispatcher.id);
  const res = await api.call("POST", "/tenant/v1/users", {
    token: a.adminToken,
    body: { email: "dispatch@b.test", name: "挖人", role: "admin" },
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, "EMAIL_TAKEN");
  assert.ok(!res.text.includes(b.tenantId) && !res.text.includes(bDispatcher.id) && !res.text.includes("车队乙"));
  assert.deepEqual(await userRow(bDispatcher.id), before);
});

test("POST /tenant/v1/users：租户乙有一个还没激活的邀请，租户甲用同一个邮箱再邀请，抢不走也重置不了它", async () => {
  const pending = await api.call("POST", "/tenant/v1/users", {
    token: b.adminToken,
    body: { email: "pending@b.test", name: "乙的新人", role: "finance" },
  });
  assert.equal(pending.status, 201);
  const hijack = await api.call("POST", "/tenant/v1/users", {
    token: a.adminToken,
    body: { email: "pending@b.test", name: "甲的人", role: "admin" },
  });
  assert.equal(hijack.status, 409);
  const accepted = await api.call("POST", "/tenant/v1/auth/accept-invite", {
    body: { token: pending.body.invite.token, password: TEST_PASSWORD },
  });
  assert.equal(accepted.status, 200, "乙发出的邀请应该仍然有效");
  assert.deepEqual(
    { tenant_id: (await userRow(pending.body.user.id))["tenant_id"], role: accepted.body.user.role },
    { tenant_id: b.tenantId, role: "finance" },
  );
});

test("POST /tenant/v1/auth/login：登录到的是邮箱所属的租户，请求体里的 tenant_id 不生效", async () => {
  cover("POST /tenant/v1/auth/login");
  const res = await api.call("POST", "/tenant/v1/auth/login", {
    body: { email: "admin@a.test", password: TEST_PASSWORD, tenant_id: b.tenantId },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.tenant.id, a.tenantId);
  const claims = verifyAccessToken(FAKE_SECRETS.authJwtSecret, "tenant", res.body.access_token, api.clock.now());
  assert.equal(claims?.tid, a.tenantId);
});

test("POST /tenant/v1/auth/accept-invite：激活的是令牌对应的那个账号，请求体里的 tenant_id 不生效", async () => {
  cover("POST /tenant/v1/auth/accept-invite");
  const invited = await api.call("POST", "/tenant/v1/users", {
    token: a.adminToken,
    body: { email: "invitee@a.test", name: "受邀人", role: "readonly" },
  });
  const res = await api.call("POST", "/tenant/v1/auth/accept-invite", {
    body: { token: invited.body.invite.token, password: TEST_PASSWORD, tenant_id: b.tenantId },
  });
  assert.equal(res.status, 200);
  assert.equal((await userRow(invited.body.user.id))["tenant_id"], a.tenantId);
});

test("POST /tenant/v1/auth/check-invite：只认令牌本身——甲的有效邀请照常通过，请求体里带乙的 tenant_id 不改变结果；乙那边用过的邀请也查不出来，核对不消费令牌", async () => {
  cover("POST /tenant/v1/auth/check-invite");
  const invited = await api.call("POST", "/tenant/v1/users", { token: a.adminToken, body: { email: "check-invitee@a.test", name: "核对邀请", role: "readonly" } });
  assert.equal(invited.status, 201, invited.text);
  const token = invited.body.invite.token as string;
  const withOther = await api.call("POST", "/tenant/v1/auth/check-invite", { body: { token, tenant_id: b.tenantId } });
  assert.equal(withOther.status, 204, withOther.text);
  assert.equal(withOther.text, "", "不返回账号、租户");
  const bogus = await api.call("POST", "/tenant/v1/auth/check-invite", { body: { token: `${token}x` } });
  assert.equal(bogus.status, 400);
  assert.equal(bogus.body.error.code, "INVITE_INVALID");
  assert.equal((await userRow(invited.body.user.id))["status"], "invited", "核对后账号仍是待激活");
});

test("POST /tenant/v1/auth/check-reset-token：把甲的令牌里的租户换成乙，核对不过；甲的原令牌照常通过，核对后仍能用", async () => {
  cover("POST /tenant/v1/auth/check-reset-token");
  const target = await addTenantUser(api, a.adminToken, "check-reset@a.test", "readonly");
  const issued = await api.call("POST", `/tenant/v1/users/${target.id}/password-reset`, { token: a.adminToken });
  assert.equal(issued.status, 201, issued.text);
  const token = issued.body.reset.token as string;
  const swapped = `nzr_${b.tenantId.replaceAll("-", "")}.${token.split(".")[1]}`;
  const forged = await api.call("POST", "/tenant/v1/auth/check-reset-token", { body: { token: swapped } });
  assert.equal(forged.status, 400);
  assert.equal(forged.body.error.code, "RESET_TOKEN_INVALID");
  const ok = await api.call("POST", "/tenant/v1/auth/check-reset-token", { body: { token, tenant_id: b.tenantId } });
  assert.equal(ok.status, 204, ok.text);
  const used = await api.call("POST", "/tenant/v1/auth/reset-password", { body: { token, password: "Fresh-Harbor-2027" } });
  assert.equal(used.status, 200, used.text);
});

test("POST /tenant/v1/auth/logout：只结束自己的会话，别的租户的会话不受影响", async () => {
  cover("POST /tenant/v1/auth/logout");
  const extra = await api.call("POST", "/tenant/v1/auth/login", { body: { email: "admin@a.test", password: TEST_PASSWORD } });
  const res = await api.call("POST", `/tenant/v1/auth/logout?tenant_id=${b.tenantId}`, { token: extra.body.access_token });
  assert.equal(res.status, 204);
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: extra.body.access_token })).status, 401);
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: b.adminToken })).status, 200);
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: a.adminToken })).status, 200);
});

test("POST /tenant/v1/auth/change-password：只改自己的密码，只让自己的其他会话失效；别的租户的密码和会话不受影响", async () => {
  cover("POST /tenant/v1/auth/change-password");
  const other = await api.call("POST", "/tenant/v1/auth/login", { body: { email: "admin@a.test", password: TEST_PASSWORD } });
  const bHashBefore = (await api.db.owner.query("select password_hash from tenant_users where id = $1", [b.adminId])).rows[0].password_hash;
  const res = await api.call("POST", `/tenant/v1/auth/change-password?tenant_id=${b.tenantId}`, {
    token: a.adminToken,
    body: { current_password: TEST_PASSWORD, new_password: "Changed-Harbor-2027", tenant_id: b.tenantId, user_id: b.adminId },
  });
  assert.equal(res.status, 204, res.text);
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: other.body.access_token })).status, 401, "自己的其他会话应失效");
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: a.adminToken })).status, 200, "当前会话保留");
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: b.adminToken })).status, 200, "租户乙的会话不受影响");
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: bDispatcher.token })).status, 200);
  const bHashAfter = (await api.db.owner.query("select password_hash from tenant_users where id = $1", [b.adminId])).rows[0].password_hash;
  assert.equal(bHashAfter, bHashBefore);
  // 改回去，后面的测试还用统一的密码
  const back = await api.call("POST", "/tenant/v1/auth/change-password", { token: a.adminToken, body: { current_password: "Changed-Harbor-2027", new_password: TEST_PASSWORD } });
  assert.equal(back.status, 204, back.text);
});

test("POST /tenant/v1/users/{id}/password-reset：给租户乙的账号发重置令牌返回 404（与不存在的账号一样），乙的账号上没有留下令牌", async () => {
  cover("POST /tenant/v1/users/:id/password-reset");
  const foreign = await api.call("POST", `/tenant/v1/users/${bDispatcher.id}/password-reset?tenant_id=${b.tenantId}`, { token: a.adminToken, body: { tenant_id: b.tenantId } });
  const missing = await api.call("POST", "/tenant/v1/users/99999999-9999-4999-8999-999999999999/password-reset", { token: a.adminToken });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.text, missing.text);
  const row = (await api.db.owner.query("select reset_token_hash from tenant_users where id = $1", [bDispatcher.id])).rows[0];
  assert.equal(row.reset_token_hash, null);
});

test("POST /tenant/v1/auth/reset-password：令牌只对发给它的那个租户的那个账号有效；把令牌里的租户换成乙、或请求体里带乙的 tenant_id，都改不了乙的任何密码", async () => {
  cover("POST /tenant/v1/auth/reset-password");
  const target = await addTenantUser(api, a.adminToken, "reset-target@a.test", "readonly");
  const issued = await api.call("POST", `/tenant/v1/users/${target.id}/password-reset`, { token: a.adminToken });
  assert.equal(issued.status, 201, issued.text);
  const token = issued.body.reset.token as string;
  const hashes = async (): Promise<unknown> =>
    (await api.db.owner.query("select id, password_hash from tenant_users where tenant_id = $1 order by id", [b.tenantId])).rows;
  const bBefore = await hashes();

  const swapped = `nzr_${b.tenantId.replaceAll("-", "")}.${token.split(".")[1]}`;
  const forged = await api.call("POST", "/tenant/v1/auth/reset-password", { body: { token: swapped, password: "Forged-Harbor-2027" } });
  assert.equal(forged.status, 400);
  assert.equal(forged.body.error.code, "RESET_TOKEN_INVALID");
  assert.deepEqual(await hashes(), bBefore);

  const ok = await api.call("POST", "/tenant/v1/auth/reset-password", { body: { token, password: "Fresh-Harbor-2027", tenant_id: b.tenantId, user_id: b.adminId } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.user.id, target.id);
  assert.deepEqual(await hashes(), bBefore, "租户乙的密码不应有任何变化");
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: b.adminToken })).status, 200);
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: target.token })).status, 401, "被重置的账号自己的旧会话失效");
});

test("GET /tenant/v1/audit-logs：只有自己租户的记录；翻到底、带别的租户的 tenant_id、用别的租户的对象编号筛选，都看不到乙的任何内容", async () => {
  cover("GET /tenant/v1/audit-logs");
  const everything: any[] = [];
  let cursor: string | null = null;
  do {
    const res = await api.call("GET", `/tenant/v1/audit-logs?limit=5&tenant_id=${b.tenantId}${cursor ? `&cursor=${cursor}` : ""}`, { token: a.adminToken });
    assert.equal(res.status, 200, res.text);
    everything.push(...res.body.items);
    cursor = res.body.next_cursor;
  } while (cursor);
  assert.ok(everything.length >= 5);
  const text = JSON.stringify(everything);
  for (const leaked of [b.tenantId, b.adminId, bDispatcher.id, "@b.test", "车队乙"]) {
    assert.ok(!text.includes(leaked), `租户甲的操作日志里出现了租户乙的内容：${leaked}`);
  }
  const own = await api.db.owner.query("select id::text as log_id from audit_logs where tenant_id = $1 and actor_type in ('tenant_user', 'anonymous') order by id desc", [a.tenantId]);
  assert.deepEqual(everything.map((l) => l.id), own.rows.map((r) => r.log_id));

  for (const query of [`resource_id=${bDispatcher.id}`, `actor_id=${b.adminId}`]) {
    const res = await api.call("GET", `/tenant/v1/audit-logs?${query}`, { token: a.adminToken });
    assert.deepEqual(res.body.items, [], query);
  }
  const bPage = await api.call("GET", "/tenant/v1/audit-logs?limit=1", { token: b.adminToken });
  assert.ok(bPage.body.next_cursor);
  const withForeignCursor = await api.call("GET", `/tenant/v1/audit-logs?cursor=${bPage.body.next_cursor}`, { token: a.adminToken });
  assert.ok(!withForeignCursor.text.includes("@b.test") && !withForeignCursor.text.includes(b.tenantId));
});

test("假设签名密钥泄露：把租户甲会话的令牌改签成租户乙的租户编号，仍然进不了乙（会话不在乙名下）", async () => {
  const claims = verifyAccessToken(FAKE_SECRETS.authJwtSecret, "tenant", a.adminToken, api.clock.now());
  assert.ok(claims);
  const forged = signAccessToken(FAKE_SECRETS.authJwtSecret, { ...claims, tid: b.tenantId });
  for (const [method, url] of [
    ["GET", "/tenant/v1/users"],
    ["GET", "/tenant/v1/auth/me"],
    ["DELETE", `/tenant/v1/users/${bDispatcher.id}`],
  ] as const) {
    assert.equal((await api.call(method, url, { token: forged })).status, 401, `${method} ${url}`);
  }
  const forgedUser = signAccessToken(FAKE_SECRETS.authJwtSecret, { ...claims, sub: b.adminId });
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: forgedUser })).status, 401);
});

const MASTER_PATHS = ["cities", "places", "vehicle-groups", "addons"] as const;
/** 平台建好的主数据：每类一条启用的、一条停用的。 */
const master: Record<string, { active: any; disabled: any }> = {};

async function seedMasterData(): Promise<void> {
  if (Object.keys(master).length > 0) return;
  const create = async (path: string, body: unknown): Promise<any> => {
    api.clock.advance(1_000);
    const res = await api.call("POST", `/platform/v1/master/${path}`, { token: platformToken, body });
    assert.equal(res.status, 201, res.text);
    return res.body;
  };
  const disable = async (path: string, id: string): Promise<any> => {
    const res = await api.call("POST", `/platform/v1/master/${path}/${id}/disable`, { token: platformToken });
    assert.equal(res.status, 200, res.text);
    return res.body;
  };
  const city = { country_code: "JP", timezone: "Asia/Tokyo", center: { lng: 139.767125, lat: 35.681236 } };
  const tokyo = await create("cities", { ...city, code: "CTY-JP-TYO", name: { zh: "东京" } });
  const closed = await create("cities", { ...city, code: "CTY-JP-OLD", name: { zh: "已停用的城市" } });
  master["cities"] = { active: tokyo, disabled: await disable("cities", closed.id) };
  const place = { type: "airport", city_id: tokyo.id, location: { lng: 139.786958, lat: 35.549678 } };
  const haneda = await create("places", { ...place, code: "HND", name: { zh: "羽田机场" } });
  const old = await create("places", { ...place, code: "OLD", name: { zh: "已停用的机场" } });
  master["places"] = { active: haneda, disabled: await disable("places", old.id) };
  const group = { grade: "business", seats: 7, power: "fuel", combos: [{ passengers: 6, luggage: 2 }] };
  const biz = await create("vehicle-groups", { ...group, code: "VG-BIZ-7", name: { zh: "商务 7 座" } });
  const retired = await create("vehicle-groups", { ...group, code: "VG-BIZOLD-7", name: { zh: "已停用的车型组" } });
  master["vehicle-groups"] = { active: biz, disabled: await disable("vehicle-groups", retired.id) };
  const addon = { categories: ["charter"], charge_unit: "per_item" };
  const seat = await create("addons", { ...addon, code: "ADD-CHILD_SEAT", name: { zh: "儿童座椅" } });
  const gone = await create("addons", { ...addon, code: "ADD-OLD", name: { zh: "已停用的附加服务" } });
  master["addons"] = { active: seat, disabled: await disable("addons", gone.id) };
}

/** 平台看到的记录去掉平台内部字段，就是租户应该看到的样子。 */
function asTenantSees(item: any): any {
  const { source: _source, ...rest } = item;
  return rest;
}

test("GET /tenant/v1/master/*：主数据全平台共用——两个租户看到的一模一样，默认只有启用中的，查询串里的 tenant_id 不起作用", async () => {
  await seedMasterData();
  for (const path of MASTER_PATHS) {
    cover(`GET /tenant/v1/master/${path}`);
    const fromA = await api.call("GET", `/tenant/v1/master/${path}?tenant_id=${b.tenantId}`, { token: a.adminToken });
    const fromB = await api.call("GET", `/tenant/v1/master/${path}`, { token: b.adminToken });
    assert.equal(fromA.status, 200, fromA.text);
    assert.deepEqual(fromA.body, fromB.body, path);
    assert.deepEqual(fromA.body, { items: [asTenantSees(master[path]!.active)], next_cursor: null, total: 1 }, path);
    assert.ok(!fromA.text.includes(a.tenantId) && !fromA.text.includes(b.tenantId), "主数据里没有任何租户的信息");

    const all = await api.call("GET", `/tenant/v1/master/${path}?status=all`, { token: a.adminToken });
    assert.deepEqual(all.body.items, [asTenantSees(master[path]!.active), asTenantSees(master[path]!.disabled)], path);
    const disabled = await api.call("GET", `/tenant/v1/master/${path}?status=disabled&limit=1`, { token: bDispatcher.token });
    assert.deepEqual(disabled.body.items, [asTenantSees(master[path]!.disabled)], "调度角色也能看");
  }
  const places = await api.call("GET", "/tenant/v1/master/places?status=all", { token: a.adminToken });
  assert.ok(!places.text.includes("source"), "租户看不到导入来源这些平台内部字段");
});

test("GET /tenant/v1/master/*/{id}：按编号查看，已停用的也查得到；不存在的 404", async () => {
  await seedMasterData();
  for (const path of MASTER_PATHS) {
    cover(`GET /tenant/v1/master/${path}/:id`);
    for (const item of [master[path]!.active, master[path]!.disabled]) {
      const fromA = await api.call("GET", `/tenant/v1/master/${path}/${item.id}?tenant_id=${b.tenantId}`, { token: a.adminToken });
      const fromB = await api.call("GET", `/tenant/v1/master/${path}/${item.id}`, { token: b.adminToken });
      assert.equal(fromA.status, 200, fromA.text);
      assert.deepEqual(fromA.body, asTenantSees(item));
      assert.deepEqual(fromB.body, fromA.body);
    }
    const missing = await api.call("GET", `/tenant/v1/master/${path}/99999999-9999-4999-8999-999999999999`, { token: a.adminToken });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, "NOT_FOUND");
  }
});

test("租户不能改主数据：租户接口里没有任何写操作，租户令牌进不了平台的主数据接口，主数据原样不动", async () => {
  await seedMasterData();
  const snapshot = async (): Promise<unknown> => {
    const tables: Record<string, unknown> = {};
    for (const table of ["cities", "places", "vehicle_groups", "addons"]) {
      tables[table] = (await api.db.owner.query(`select id, code, name, status, version, updated_at from ${table} order by code`)).rows;
    }
    return tables;
  };
  const before = await snapshot();
  const auditBefore = (await api.db.owner.query("select count(*)::int as n from audit_logs")).rows[0].n;
  for (const path of MASTER_PATHS) {
    const item = master[path]!.active;
    const body = { name: { zh: "被租户改了" }, code: item.code, tenant_id: a.tenantId };
    const headers = { "if-match": `"${item.version}"` };
    for (const [method, url] of [
      ["POST", `/tenant/v1/master/${path}`],
      ["PATCH", `/tenant/v1/master/${path}/${item.id}`],
      ["PUT", `/tenant/v1/master/${path}/${item.id}`],
      ["DELETE", `/tenant/v1/master/${path}/${item.id}`],
      ["POST", `/tenant/v1/master/${path}/${item.id}/disable`],
      ["POST", `/tenant/v1/master/${path}/${item.id}/enable`],
    ] as const) {
      const res = await api.call(method, url, { token: a.adminToken, body, headers });
      assert.equal(res.status, 404, `${method} ${url}`);
    }
    for (const [method, url] of [
      ["POST", `/platform/v1/master/${path}`],
      ["PATCH", `/platform/v1/master/${path}/${item.id}`],
      ["POST", `/platform/v1/master/${path}/${item.id}/disable`],
    ] as const) {
      const res = await api.call(method, url, { token: a.adminToken, body, headers });
      assert.equal(res.status, 401, `${method} ${url}`);
    }
  }
  assert.deepEqual(await snapshot(), before);
  assert.equal((await api.db.owner.query("select count(*)::int as n from audit_logs")).rows[0].n, auditBefore);
  const registered = api.app.registeredRoutes.filter((r) => r.path.startsWith("/tenant/v1/master/") && r.method !== "HEAD").map((r) => r.method);
  assert.deepEqual([...new Set(registered)], ["GET"], "租户的主数据接口只有读");
});

test("租户不能改主数据（数据库层面）：租户事务里对主数据表只有读权限，写、改、删都被数据库拒绝", async () => {
  await seedMasterData();
  for (const table of ["cities", "places", "vehicle_groups", "addons"]) {
    const read = await withTenantTx(api.db.pool, a.tenantId, (db) => db.query<{ n: number }>(`select count(*)::int as n from ${table}`));
    assert.equal(read.rows[0]?.n, 2, table);
    for (const sql of [
      `update ${table} set status = 'disabled'`,
      `update ${table} set name = '{"zh": "被租户改了"}'::jsonb`,
      `delete from ${table}`,
      `insert into ${table} select * from ${table}`,
      `truncate ${table} cascade`,
      `select 1 from ${table} for update`,
    ]) {
      await assert.rejects(withTenantTx(api.db.pool, a.tenantId, (db) => db.query(sql)), deniedByDatabase, `${table}: ${sql}`);
    }
  }
});

test("每个租户角色都能看主数据", async () => {
  await seedMasterData();
  for (const role of ["pricing", "dispatch", "finance", "readonly"]) {
    const user = await addTenantUser(api, a.adminToken, `${role}-master@a.test`, role);
    for (const path of MASTER_PATHS) {
      const res = await api.call("GET", `/tenant/v1/master/${path}`, { token: user.token });
      assert.equal(res.status, 200, `${role} ${path}`);
      assert.equal(res.body.items.length, 1);
    }
  }
  assert.equal((await api.call("GET", "/tenant/v1/master/cities")).status, 401);
});

/** 区域的跨租户验证用的数据：平台建一个城市，甲、乙各建一个同名的区域（不同供应商之间允许同名）。 */
const areaFixture: { cityId?: string; a?: any; b?: any; key?: string } = {};
const AREA_POLYGON = { kind: "operate", geometry: { type: "Polygon", coordinates: [[[139.6, 35.6], [139.8, 35.6], [139.8, 35.8], [139.6, 35.8], [139.6, 35.6]]] } };

async function seedAreas(): Promise<{ cityId: string; a: any; b: any; key: string }> {
  if (areaFixture.cityId === undefined) {
    const city = await api.call("POST", "/platform/v1/master/cities", {
      token: platformToken,
      body: { code: "CTY-JP-ISO", country_code: "JP", name: { zh: "隔离测试市" }, timezone: "Asia/Tokyo", center: { lng: 139.7, lat: 35.7 } },
    });
    assert.equal(city.status, 201, city.text);
    areaFixture.cityId = city.body.id;
    // 两个供应商用同一个幂等键、同一个名字各建一个区域：互不相干
    areaFixture.key = "shared-key-0001";
    for (const [name, fixture] of [["a", a], ["b", b]] as const) {
      api.clock.advance(1_000);
      const res = await api.call("POST", "/tenant/v1/areas", {
        token: fixture.adminToken,
        headers: { "idempotency-key": areaFixture.key },
        body: { city_id: areaFixture.cityId, name: { zh: "市区" }, biz_type: "general", polygons: [AREA_POLYGON, { ...AREA_POLYGON, kind: "forbid" }], tenant_id: name === "a" ? b.tenantId : a.tenantId },
      });
      assert.equal(res.status, 201, res.text);
      areaFixture[name] = res.body;
    }
  }
  return areaFixture as { cityId: string; a: any; b: any; key: string };
}

async function areaRows(): Promise<unknown> {
  return {
    areas: (await api.db.owner.query("select tenant_id, id, name, status, version, updated_at from areas order by id")).rows,
    polygons: (await api.db.owner.query("select tenant_id, id, area_id, kind, seq, geometry from area_polygons order by id")).rows,
  };
}

test("POST /tenant/v1/areas：区域建在令牌所属的供应商名下，请求体里的 tenant_id 不生效；同一个幂等键、同一个名字在两个供应商之间互不相干", async () => {
  cover("POST /tenant/v1/areas");
  const areas = await seedAreas();
  assert.notEqual(areas.a.id, areas.b.id, "同一个幂等键在乙那里没有拿到甲的结果");
  const rows = await api.db.owner.query("select tenant_id, id from areas order by created_at");
  assert.deepEqual(rows.rows, [{ tenant_id: a.tenantId, id: areas.a.id }, { tenant_id: b.tenantId, id: areas.b.id }]);
  // 甲带着同一个键再来：拿回的是甲自己的那一个
  const again = await api.call("POST", "/tenant/v1/areas", {
    token: a.adminToken,
    headers: { "idempotency-key": areas.key },
    body: { city_id: areas.cityId, name: { zh: "市区" }, biz_type: "general", polygons: [AREA_POLYGON, { ...AREA_POLYGON, kind: "forbid" }] },
  });
  assert.deepEqual([again.status, again.body.id], [201, areas.a.id]);
  assert.ok(!again.text.includes(areas.b.id) && !again.text.includes(b.tenantId));
  const keys = await api.db.owner.query("select tenant_id from idempotency_keys where key = $1 order by created_at", [areas.key]);
  assert.deepEqual(keys.rows.map((row) => row.tenant_id), [a.tenantId, b.tenantId]);
});

test("GET /tenant/v1/areas：只列出自己的区域，筛选、关键字、别人的翻页游标、查询串里的 tenant_id 都翻不出别人的", async () => {
  cover("GET /tenant/v1/areas");
  const areas = await seedAreas();
  for (const query of ["", `?tenant_id=${b.tenantId}`, `?q=${encodeURIComponent("市区")}`, `?city_id=${areas.cityId}`, "?status=all&limit=200"]) {
    const res = await api.call("GET", `/tenant/v1/areas${query}`, { token: a.adminToken });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual([res.body.total, res.body.items.map((item: any) => item.id)], [1, [areas.a.id]], query);
    assert.ok(!res.text.includes(areas.b.id));
  }
  // 乙再建一个，拿乙的翻页游标到甲这里用
  const more = await api.call("POST", "/tenant/v1/areas", {
    token: b.adminToken,
    headers: { "idempotency-key": "isolation-b-second" },
    body: { city_id: areas.cityId, name: { zh: "乙的第二个区域" }, biz_type: "general", polygons: [AREA_POLYGON] },
  });
  assert.equal(more.status, 201, more.text);
  const bPage = await api.call("GET", "/tenant/v1/areas?limit=1", { token: b.adminToken });
  assert.ok(bPage.body.next_cursor);
  const stolen = await api.call("GET", `/tenant/v1/areas?cursor=${bPage.body.next_cursor}`, { token: a.adminToken });
  assert.equal(stolen.status, 200);
  assert.ok(stolen.body.items.every((item: any) => item.id === areas.a.id));
  assert.equal((await api.call("DELETE", `/tenant/v1/areas/${more.body.id}`, { token: b.adminToken })).status, 204);
});

test("GET /tenant/v1/areas/{id}：别的供应商的区域是 404，和根本不存在的一模一样", async () => {
  cover("GET /tenant/v1/areas/:id");
  const areas = await seedAreas();
  const foreign = await api.call("GET", `/tenant/v1/areas/${areas.b.id}?tenant_id=${b.tenantId}`, { token: a.adminToken });
  const missing = await api.call("GET", "/tenant/v1/areas/99999999-9999-4999-8999-999999999999", { token: a.adminToken });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.text, missing.text);
  assert.equal((await api.call("GET", `/tenant/v1/areas/${areas.a.id}`, { token: a.adminToken })).body.id, areas.a.id);
});

test("PUT /tenant/v1/areas/{id}：改不了别的供应商的区域（404，对方的数据原样不动）；也不能把别人的图形编号塞进自己的区域", async () => {
  cover("PUT /tenant/v1/areas/:id");
  const areas = await seedAreas();
  const before = await areaRows();
  const payload = { name: { zh: "被甲改了" }, biz_type: "charter", polygons: [AREA_POLYGON], tenant_id: b.tenantId };
  for (const version of [1, areas.b.version, 99]) {
    const res = await api.call("PUT", `/tenant/v1/areas/${areas.b.id}`, { token: a.adminToken, headers: { "if-match": `"${version}"` }, body: payload });
    assert.equal(res.status, 404, `版本 ${version}`);
    assert.equal(res.body.error.code, "NOT_FOUND");
  }
  const smuggled = await api.call("PUT", `/tenant/v1/areas/${areas.a.id}`, {
    token: a.adminToken,
    headers: { "if-match": `"${areas.a.version}"` },
    body: { name: areas.a.name, biz_type: "general", polygons: [{ ...AREA_POLYGON, id: areas.b.polygons[0].id }] },
  });
  assert.equal(smuggled.status, 400);
  assert.deepEqual(smuggled.body.error.details.issues.map((issue: any) => [issue.path, issue.reason]), [["/polygons/0/id", "UNKNOWN_POLYGON"]]);
  assert.deepEqual(await areaRows(), before);
});

test("DELETE /tenant/v1/areas/{id}：删不了别的供应商的区域", async () => {
  cover("DELETE /tenant/v1/areas/:id");
  const areas = await seedAreas();
  const before = await areaRows();
  const res = await api.call("DELETE", `/tenant/v1/areas/${areas.b.id}`, { token: a.adminToken });
  const missing = await api.call("DELETE", "/tenant/v1/areas/99999999-9999-4999-8999-999999999999", { token: a.adminToken });
  assert.equal(res.status, 404);
  assert.equal(res.text, missing.text);
  assert.deepEqual(await areaRows(), before);
  assert.equal((await api.call("GET", `/tenant/v1/areas/${areas.b.id}`, { token: b.adminToken })).status, 200);
});

test("POST /tenant/v1/areas/{id}/disable、enable：停用、启用不了别的供应商的区域", async () => {
  cover("POST /tenant/v1/areas/:id/disable");
  cover("POST /tenant/v1/areas/:id/enable");
  const areas = await seedAreas();
  const before = await areaRows();
  for (const action of ["disable", "enable"]) {
    const res = await api.call("POST", `/tenant/v1/areas/${areas.b.id}/${action}`, { token: a.adminToken, body: { tenant_id: b.tenantId } });
    assert.equal(res.status, 404, action);
  }
  assert.deepEqual(await areaRows(), before);
});

test("POST /tenant/v1/areas/{id}/check-point：自测不了别的供应商的区域（不暴露它存不存在、画在哪里）", async () => {
  cover("POST /tenant/v1/areas/:id/check-point");
  const areas = await seedAreas();
  const point = { lat: 35.7, lng: 139.7 };
  const foreign = await api.call("POST", `/tenant/v1/areas/${areas.b.id}/check-point`, { token: a.adminToken, body: point });
  const missing = await api.call("POST", "/tenant/v1/areas/99999999-9999-4999-8999-999999999999/check-point", { token: a.adminToken, body: point });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.text, missing.text);
  const own = await api.call("POST", `/tenant/v1/areas/${areas.a.id}/check-point`, { token: a.adminToken, body: point });
  assert.deepEqual([own.body.result, own.body.forbid_polygon_ids], ["forbid", [areas.a.polygons[1].id]]);
  assert.ok(!own.text.includes(areas.b.polygons[0].id));
});

test("GET /tenant/v1/dashboard/summary：只数自己的区域和商品", async () => {
  cover("GET /tenant/v1/dashboard/summary");
  await seedAreas();
  const extra = await api.tenantWithAdmin(platformToken, "车队丙", "admin@c.test");
  await seedProducts();
  assert.deepEqual((await api.call("GET", `/tenant/v1/dashboard/summary?tenant_id=${b.tenantId}`, { token: extra.adminToken })).body, {
    areas: { active: 0, disabled: 0 },
    products: { draft: 0, published: 0, unpublished: 0 },
  });
  assert.deepEqual((await api.call("GET", "/tenant/v1/dashboard/summary", { token: a.adminToken })).body, { areas: { active: 1, disabled: 0 }, products: { draft: 1, published: 0, unpublished: 0 } });
});

test("GET /tenant/v1/map/config：底图配置和供应商无关，两边拿到的一样，里面没有任何供应商的信息", async () => {
  cover("GET /tenant/v1/map/config");
  const fromA = await api.call("GET", `/tenant/v1/map/config?tenant_id=${b.tenantId}`, { token: a.adminToken });
  const fromB = await api.call("GET", "/tenant/v1/map/config", { token: b.adminToken });
  assert.equal(fromA.status, 200);
  assert.deepEqual(fromA.body, fromB.body);
  assert.ok(!fromA.text.includes(a.tenantId) && !fromA.text.includes(b.tenantId));
});

test("区域的隔离（数据库层面）：租户事务里不带任何条件也只看得到、改得到、删得到自己的行；写不进别人名下；幂等键也一样", async () => {
  const areas = await seedAreas();
  const before = await areaRows();
  for (const table of ["areas", "area_polygons", "idempotency_keys"]) {
    const seen = await withTenantTx(api.db.pool, a.tenantId, (db) => db.query<{ tenant_id: string }>(`select distinct tenant_id from ${table}`));
    assert.deepEqual(seen.rows.map((row) => row.tenant_id), [a.tenantId], table);
  }
  const touched = await withTenantTx(api.db.pool, a.tenantId, async (db) => {
    const updated = await db.query("update areas set status = 'disabled' where id = $1", [areas.b.id]);
    const moved = await db.query("update area_polygons set kind = 'forbid' where area_id = $1", [areas.b.id]);
    const deleted = await db.query("delete from areas where id = $1", [areas.b.id]);
    const polygons = await db.query("delete from area_polygons where area_id = $1", [areas.b.id]);
    return [updated.rowCount, moved.rowCount, deleted.rowCount, polygons.rowCount];
  });
  assert.deepEqual(touched, [0, 0, 0, 0]);
  await assert.rejects(
    withTenantTx(api.db.pool, a.tenantId, (db) =>
      db.query(
        `insert into areas (tenant_id, city_id, name, name_keys, biz_type, status, created_at, updated_at)
         values ($1, $2, '{"zh": "塞进别人名下"}', '{塞进别人名下}', 'general', 'active', now(), now())`,
        [b.tenantId, areas.cityId],
      ),
    ),
    { code: "42501" },
  );
  await assert.rejects(withTenantTx(api.db.pool, a.tenantId, (db) => db.query("update areas set tenant_id = $1 where id = $2", [b.tenantId, areas.a.id])), { code: "42501" });
  await assert.rejects(
    withTenantTx(api.db.pool, a.tenantId, (db) => db.query("insert into idempotency_keys (tenant_id, scope, key, request_hash, created_at) values ($1, 's', 'stolen-key-0001', 'h', now())", [b.tenantId])),
    { code: "42501" },
  );
  // 没有设置租户（登录前的角色、平台角色）一行都碰不到：这三张表没有给它们任何权限
  // 平台角色：区域和图形只读（报价要把所有供应商的放在一起算，ADR 0020），不能写
  for (const table of ["areas", "area_polygons"]) {
    assert.ok(((await withPlatformTx(api.db.pool, (db) => db.query(`select 1 from ${table}`))).rowCount ?? 0) > 0, table);
    await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query(`delete from ${table}`)), deniedByDatabase, table);
    await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query(`update ${table} set tenant_id = tenant_id`)), deniedByDatabase, table);
  }
  await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query("select 1 from idempotency_keys")), deniedByDatabase);
  assert.deepEqual(await areaRows(), before);
});

// ---- 子品牌和商品（M1-03）----

const productFixture: { a?: { brand: any; product: any }; b?: { brand: any; product: any }; key?: string } = {};
const NO_SUCH_ID = "99999999-9999-4999-8999-999999999999";

/** 两个供应商用同一个幂等键、同一个名字各建一个子品牌，再各建一个选了自己区域、填了规则和详情的包车草稿。 */
async function seedProducts(): Promise<{ a: { brand: any; product: any }; b: { brand: any; product: any }; key: string; cityId: string; areas: { a: any; b: any } }> {
  const areas = await seedAreas();
  if (productFixture.key === undefined) {
    productFixture.key = "shared-key-0002";
    for (const [name, fixture] of [["a", a], ["b", b]] as const) {
      api.clock.advance(1_000);
      const headers = { "idempotency-key": productFixture.key };
      const other = name === "a" ? b.tenantId : a.tenantId;
      const brand = await api.call("POST", "/tenant/v1/brands", { token: fixture.adminToken, headers, body: { name: "主品牌", currency: "JPY", tenant_id: other } });
      assert.equal(brand.status, 201, brand.text);
      const created = await api.call("POST", "/tenant/v1/products", {
        token: fixture.adminToken,
        headers,
        body: { brand_id: brand.body.id, city_id: areas.cityId, category: "charter", areas: [{ area_id: areas[name].id }], dispatchers: [{ name: `调度 ${name}`, phone: "0312345678" }], tenant_id: other },
      });
      assert.equal(created.status, 201, created.text);
      const content = await api.call("PUT", `/tenant/v1/products/${created.body.id}/content`, { token: fixture.adminToken, headers: { "if-match": '"1"' }, body: { zh: { title: `${name} 的包车` } } });
      assert.equal(content.status, 200, content.text);
      const product = await api.call("GET", `/tenant/v1/products/${created.body.id}`, { token: fixture.adminToken });
      productFixture[name] = { brand: brand.body, product: product.body };
    }
  }
  return { ...(productFixture as { a: { brand: any; product: any }; b: { brand: any; product: any }; key: string }), cityId: areas.cityId, areas };
}

async function productRows(): Promise<unknown> {
  const rows: Record<string, unknown[]> = {};
  for (const [table, order] of [["brands", "id"], ["products", "id"], ["product_areas", "product_id, area_id"], ["product_vehicle_groups", "product_id, vehicle_group_id"], ["product_dispatchers", "product_id, position"]] as const) {
    rows[table] = (await api.db.owner.query(`select * from ${table} order by ${order}`)).rows;
  }
  return rows;
}

test("子品牌：建在令牌所属的供应商名下，请求体里的 tenant_id 不生效；同名、同幂等键在两个供应商之间互不相干；看不到、改不了别人的", async () => {
  cover("GET /tenant/v1/brands");
  cover("POST /tenant/v1/brands");
  cover("PUT /tenant/v1/brands/:id");
  const seeded = await seedProducts();
  assert.notEqual(seeded.a.brand.id, seeded.b.brand.id);
  const owners = await api.db.owner.query("select id, tenant_id from brands order by created_at");
  assert.deepEqual(owners.rows, [{ id: seeded.a.brand.id, tenant_id: a.tenantId }, { id: seeded.b.brand.id, tenant_id: b.tenantId }]);
  const listed = await api.call("GET", `/tenant/v1/brands?tenant_id=${b.tenantId}`, { token: a.adminToken });
  assert.deepEqual(listed.body.items.map((brand: any) => brand.id), [seeded.a.brand.id]);
  const before = await productRows();
  const foreign = await api.call("PUT", `/tenant/v1/brands/${seeded.b.brand.id}`, { token: a.adminToken, headers: { "if-match": '"1"' }, body: { name: "被甲改了", tenant_id: b.tenantId } });
  const missing = await api.call("PUT", `/tenant/v1/brands/${NO_SUCH_ID}`, { token: a.adminToken, headers: { "if-match": '"1"' }, body: { name: "被甲改了" } });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.text, missing.text);
  assert.deepEqual(await productRows(), before);
});

test("POST /tenant/v1/products：商品建在令牌所属的供应商名下；用不了别的供应商的子品牌和区域（和不存在一样）；幂等键互不相干", async () => {
  cover("POST /tenant/v1/products");
  const seeded = await seedProducts();
  assert.notEqual(seeded.a.product.id, seeded.b.product.id, "同一个幂等键，两个供应商各建各的");
  const owners = await api.db.owner.query("select id, tenant_id from products order by created_at");
  assert.deepEqual(owners.rows, [{ id: seeded.a.product.id, tenant_id: a.tenantId }, { id: seeded.b.product.id, tenant_id: b.tenantId }]);
  const before = await productRows();
  const create = (body: Record<string, unknown>): Promise<ApiResponse> =>
    api.call("POST", "/tenant/v1/products", { token: a.adminToken, headers: { "idempotency-key": randomUUID() }, body: { brand_id: seeded.a.brand.id, city_id: seeded.cityId, category: "charter", ...body } });
  const reasons = (res: ApiResponse): unknown => res.body.error?.details?.issues?.map((issue: any) => [issue.path, issue.reason]);
  const foreignBrand = await create({ brand_id: seeded.b.brand.id });
  assert.equal(foreignBrand.status, 400, foreignBrand.text);
  assert.deepEqual(reasons(foreignBrand), [["/brand_id", "UNKNOWN_BRAND"]]);
  assert.equal(foreignBrand.text, (await create({ brand_id: NO_SUCH_ID })).text, "别人的子品牌和不存在的子品牌，应答一模一样");
  const foreignArea = await create({ areas: [{ area_id: seeded.areas.a.id }, { area_id: seeded.areas.b.id }] });
  assert.equal(foreignArea.status, 400, foreignArea.text);
  assert.deepEqual(reasons(foreignArea), [["/areas/1/area_id", "UNKNOWN_AREA"]]);
  assert.equal(foreignArea.text, (await create({ areas: [{ area_id: seeded.areas.a.id }, { area_id: NO_SUCH_ID }] })).text);
  assert.deepEqual(await productRows(), before);
});

test("GET /tenant/v1/products、/products/{id}：只看得到自己的商品；按别人的子品牌、区域筛选什么都筛不出来", async () => {
  cover("GET /tenant/v1/products");
  cover("GET /tenant/v1/products/:id");
  const seeded = await seedProducts();
  const list = await api.call("GET", `/tenant/v1/products?tenant_id=${b.tenantId}`, { token: a.adminToken });
  assert.deepEqual([list.body.total, list.body.items.map((item: any) => item.id)], [1, [seeded.a.product.id]]);
  assert.ok(!list.text.includes(seeded.b.product.code) && !list.text.includes(b.tenantId));
  for (const query of [`brand_id=${seeded.b.brand.id}`, `area_id=${seeded.areas.b.id}`, `q=${seeded.b.product.code}`, `q=${encodeURIComponent("b 的包车")}`]) {
    const res = await api.call("GET", `/tenant/v1/products?${query}`, { token: a.adminToken });
    assert.deepEqual([res.status, res.body.total, res.body.items], [200, 0, []], query);
  }
  const foreign = await api.call("GET", `/tenant/v1/products/${seeded.b.product.id}`, { token: a.adminToken });
  const missing = await api.call("GET", `/tenant/v1/products/${NO_SUCH_ID}`, { token: a.adminToken });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.text, missing.text);
  assert.equal((await api.call("GET", `/tenant/v1/products/${seeded.b.product.id}`, { token: b.adminToken })).status, 200);
});

test("商品的其余接口：读不到、改不了、删不了、上不了架、下不了架别的供应商的商品（404，和不存在一样，对方的数据原样不动）", async () => {
  const seeded = await seedProducts();
  const before = await productRows();
  const requests: [HttpMethod, string, unknown][] = [
    ["PATCH", "", { dispatchers: [], tenant_id: b.tenantId }],
    ["DELETE", "", undefined],
    ["GET", "/service-rules", undefined],
    ["PUT", "/service-rules", { booking: { lead_time_hours: 1 } }],
    ["GET", "/content", undefined],
    ["PUT", "/content", { zh: { title: "被甲改了" } }],
    ["GET", "/publish-check", undefined],
    ["POST", "/publish", undefined],
    ["POST", "/unpublish", undefined],
  ];
  for (const [method, suffix, body] of requests) {
    cover(`${method} /tenant/v1/products/:id${suffix}`);
    const send = (id: string): Promise<ApiResponse> =>
      api.call(method, `/tenant/v1/products/${id}${suffix}`, { token: a.adminToken, headers: { "if-match": `"${seeded.b.product.version}"` }, ...(body === undefined ? {} : { body }) });
    const foreign = await send(seeded.b.product.id);
    assert.equal(foreign.status, 404, `${method} ${suffix}：${foreign.text}`);
    assert.equal(foreign.text, (await send(NO_SUCH_ID)).text, `${method} ${suffix}`);
  }
  // 给自己的商品选别人的区域：和选一个不存在的区域一样
  const patch = (areaId: string): Promise<ApiResponse> =>
    api.call("PATCH", `/tenant/v1/products/${seeded.a.product.id}`, { token: a.adminToken, headers: { "if-match": `"${seeded.a.product.version}"` }, body: { areas: [{ area_id: areaId }] } });
  const smuggled = await patch(seeded.areas.b.id);
  assert.equal(smuggled.status, 400, smuggled.text);
  assert.deepEqual(smuggled.body.error.details.issues.map((issue: any) => [issue.path, issue.reason]), [["/areas/0/area_id", "UNKNOWN_AREA"]]);
  assert.equal(smuggled.text, (await patch(NO_SUCH_ID)).text);
  assert.deepEqual(await productRows(), before);
  // 区域的使用数只数自己的商品
  assert.deepEqual((await api.call("GET", `/tenant/v1/areas/${seeded.areas.a.id}`, { token: a.adminToken })).body.usage, { product_count: 1, published_product_count: 0 });
});

test("子品牌和商品的隔离（数据库层面）：租户事务里只看得到、改得到、删得到自己的行，写不进别人名下；平台角色对这几张表只读（调度人自 M1-12 起也可读）、不能写", async () => {
  const seeded = await seedProducts();
  const before = await productRows();
  for (const table of ["brands", "products", "product_areas", "product_dispatchers"]) {
    const seen = await withTenantTx(api.db.pool, a.tenantId, (db) => db.query<{ tenant_id: string }>(`select distinct tenant_id from ${table}`));
    assert.deepEqual(seen.rows.map((row) => row.tenant_id), [a.tenantId], table);
  }
  const theirs = seeded.b.product.id;
  const touched = await withTenantTx(api.db.pool, a.tenantId, async (db) => {
    const counts: (number | null)[] = [];
    counts.push((await db.query("update brands set name = '被甲改了' where id = $1", [seeded.b.brand.id])).rowCount);
    counts.push((await db.query("update products set status = 'published' where id = $1", [theirs])).rowCount);
    counts.push((await db.query("delete from products where id = $1", [theirs])).rowCount);
    for (const table of ["product_areas", "product_vehicle_groups", "product_dispatchers"]) counts.push((await db.query(`delete from ${table} where product_id = $1`, [theirs])).rowCount);
    return counts;
  });
  assert.deepEqual(touched, [0, 0, 0, 0, 0, 0]);
  const denied: [string, string, unknown[]][] = [
    ["写子品牌到别人名下", "insert into brands (tenant_id, name, currency, status, created_at, updated_at) values ($1, '塞进来的', 'JPY', 'active', now(), now())", [b.tenantId]],
    ["把自己的商品挪给别人", "update products set tenant_id = $1 where id = $2", [b.tenantId, seeded.a.product.id]],
    ["给别人的商品加区域", "insert into product_areas (tenant_id, product_id, area_id, priority) values ($1, $2, $3, 9)", [b.tenantId, theirs, seeded.areas.b.id]],
    ["给别人的商品加调度人", "insert into product_dispatchers (tenant_id, product_id, position, name, phone) values ($1, $2, 9, '甲的人', '0312345678')", [b.tenantId, theirs]],
  ];
  for (const [label, sql, params] of denied) await assert.rejects(withTenantTx(api.db.pool, a.tenantId, (db) => db.query(sql, params)), { code: "42501" }, label);
  // 用自己的租户编号把别人的区域、别人的商品接到一起：外键带着租户编号，接不上
  await assert.rejects(
    withTenantTx(api.db.pool, a.tenantId, (db) => db.query("insert into product_areas (tenant_id, product_id, area_id, priority) values ($1, $2, $3, 9)", [a.tenantId, seeded.a.product.id, seeded.areas.b.id])),
    { code: "23503" },
  );
  // 平台角色：商品和它选的车型组只读（停用主数据前数已上架的商品用、运营后台查看商品），不能写
  const platformSees = await withPlatformTx(api.db.pool, (db) => db.query<{ n: number }>("select count(*)::int as n from products"));
  assert.equal(platformSees.rows[0]?.n, 2);
  await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query("update products set status = 'published'")), deniedByDatabase);
  await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query("delete from product_vehicle_groups")), deniedByDatabase);
  // 子品牌、商品选的区域（报价用，ADR 0020）、调度人（运营后台查看商品，ADR 0021）：平台只读，不能写
  for (const table of ["brands", "product_areas", "product_dispatchers"]) {
    assert.ok(((await withPlatformTx(api.db.pool, (db) => db.query(`select 1 from ${table}`))).rowCount ?? 0) > 0, table);
    await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query(`delete from ${table}`)), deniedByDatabase, table);
    await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query(`update ${table} set tenant_id = tenant_id`)), deniedByDatabase, table);
  }
  await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query("insert into product_dispatchers (tenant_id, product_id, position, name, phone) values ($1, $2, 9, '平台的人', '0312345678')", [b.tenantId, theirs])), deniedByDatabase);
  assert.deepEqual(await productRows(), before);
});

// ---- 价格规则、调价规则（M1-04）----

type PriceSide = { productId: string; brandId: string; areaId: string; priceRuleId: string; adjustRuleId: string };
const priceFixture: { a?: PriceSide; b?: PriceSide; vehicleGroupId?: string } = {};

/** 两个供应商各有一个点对点商品，选了自己的区域和同一个平台车型组，各有一条价格规则和一条调价规则（用的是同一个幂等键）。 */
async function seedPrices(): Promise<{ a: PriceSide; b: PriceSide; vehicleGroupId: string }> {
  const seeded = await seedProducts();
  await seedMasterData();
  if (priceFixture.vehicleGroupId === undefined) {
    const vehicleGroupId = master["vehicle-groups"]!.active.id as string;
    priceFixture.vehicleGroupId = vehicleGroupId;
    for (const [name, fixture] of [["a", a], ["b", b]] as const) {
      api.clock.advance(1_000);
      const call = (method: HttpMethod, path: string, body: unknown, version?: number): Promise<ApiResponse> =>
        api.call(method, `/tenant/v1${path}`, { token: fixture.adminToken, body, headers: { "idempotency-key": "shared-key-0003", ...(version === undefined ? {} : { "if-match": `"${version}"` }) } });
      const areaId = seeded.areas[name].id as string;
      const chosen = master["vehicle-groups"]!.active.combos[0];
      const product = await call("POST", "/products", { brand_id: seeded[name].brand.id, city_id: seeded.cityId, category: "point_to_point", areas: [{ area_id: areaId }], vehicle_groups: [{ vehicle_group_id: vehicleGroupId, ...chosen }] });
      assert.equal(product.status, 201, product.text);
      const price = await call("POST", `/products/${product.body.id}/price-rules`, { area_id: areaId, vehicle_group_id: vehicleGroupId, pricing_model: "fixed", base_price: name === "a" ? 11_000 : 22_000, valid_from: "2026-10-01", tenant_id: name === "a" ? b.tenantId : a.tenantId }, 1);
      assert.equal(price.status, 201, price.text);
      const adjust = await call("POST", `/products/${product.body.id}/adjust-rules`, { name: `${name} 的旺季`, cycle: { type: "daily" }, steps: [{ type: "percent", value: 1_000 }], tenant_id: name === "a" ? b.tenantId : a.tenantId }, 2);
      assert.equal(adjust.status, 201, adjust.text);
      priceFixture[name] = { productId: product.body.id, brandId: seeded[name].brand.id, areaId, priceRuleId: price.body.price_rule.id, adjustRuleId: adjust.body.adjust_rule.id };
    }
  }
  return priceFixture as { a: PriceSide; b: PriceSide; vehicleGroupId: string };
}

async function priceRows(): Promise<unknown> {
  return {
    prices: (await api.db.owner.query("select tenant_id, id, product_id, area_id, params, valid_from::text, valid_to::text, status, updated_at from price_rules order by id")).rows,
    adjusts: (await api.db.owner.query("select tenant_id, id, product_id, name, steps, position, status, updated_at from adjust_rules order by id")).rows,
    products: (await api.db.owner.query("select id, version, status, updated_at from products order by id")).rows,
    brands: (await api.db.owner.query("select id, rounding_unit, version from brands order by id")).rows,
  };
}

test("价格和调价建在令牌所属的供应商名下：请求体里的 tenant_id 不生效；同一个幂等键在两个供应商之间互不相干；各自只看得到自己的", async () => {
  cover("POST /tenant/v1/products/:id/price-rules");
  cover("POST /tenant/v1/products/:id/adjust-rules");
  cover("GET /tenant/v1/products/:id/price-rules");
  cover("GET /tenant/v1/products/:id/adjust-rules");
  cover("GET /tenant/v1/price-overview");
  const seeded = await seedPrices();
  assert.notEqual(seeded.a.priceRuleId, seeded.b.priceRuleId);
  const owners = await api.db.owner.query("select 'price' as kind, id, tenant_id from price_rules union all select 'adjust', id, tenant_id from adjust_rules order by kind, tenant_id");
  assert.deepEqual(
    owners.rows.map((row) => [row.kind, row.id, row.tenant_id]).sort(),
    [["price", seeded.a.priceRuleId, a.tenantId], ["price", seeded.b.priceRuleId, b.tenantId], ["adjust", seeded.a.adjustRuleId, a.tenantId], ["adjust", seeded.b.adjustRuleId, b.tenantId]].sort(),
  );
  const mine = await api.call("GET", `/tenant/v1/products/${seeded.a.productId}/price-rules?tenant_id=${b.tenantId}`, { token: a.adminToken });
  assert.deepEqual(mine.body.items.map((item: any) => [item.id, item.base_price]), [[seeded.a.priceRuleId, 11_000]]);
  const rules = await api.call("GET", `/tenant/v1/products/${seeded.a.productId}/adjust-rules`, { token: a.adminToken });
  assert.deepEqual(rules.body.items.map((item: any) => item.id), [seeded.a.adjustRuleId]);
  const overview = await api.call("GET", `/tenant/v1/price-overview?tenant_id=${b.tenantId}`, { token: a.adminToken });
  assert.ok(overview.body.items.some((item: any) => item.product_id === seeded.a.productId));
  assert.ok(!overview.text.includes(seeded.b.productId) && !overview.text.includes(b.tenantId));
  assert.deepEqual([overview.body.products_with_price, overview.body.items.length], [1, 2], "只数自己的两个商品，其中一个有价格");
});

test("价格、调价、日历、缺价的每个接口：别的供应商的商品一律 404（和不存在一样），对方的数据原样不动", async () => {
  const seeded = await seedPrices();
  const before = await priceRows();
  const theirs = seeded.b;
  const calendarQuery = `area_id=${theirs.areaId}&vehicle_group_id=${seeded.vehicleGroupId}&from=2026-10-01&to=2026-10-02`;
  const price = { area_id: theirs.areaId, vehicle_group_id: seeded.vehicleGroupId, pricing_model: "fixed", base_price: 1, valid_from: "2027-01-01", tenant_id: b.tenantId };
  const adjust = { name: "被甲改了", cycle: { type: "daily" }, steps: [{ type: "percent", value: -5_000 }] };
  const requests: [HttpMethod, string, (side: PriceSide | null) => string, unknown?][] = [
    ["GET", "/tenant/v1/products/:id/price-rules", () => "/price-rules"],
    ["POST", "/tenant/v1/products/:id/price-rules", () => "/price-rules", price],
    ["POST", "/tenant/v1/products/:id/price-rules/batch", () => "/price-rules/batch", { delete: [theirs.priceRuleId] }],
    ["PUT", "/tenant/v1/products/:id/price-rules/:ruleId", () => `/price-rules/${theirs.priceRuleId}`, price],
    ["DELETE", "/tenant/v1/products/:id/price-rules/:ruleId", () => `/price-rules/${theirs.priceRuleId}`],
    ["GET", "/tenant/v1/products/:id/price-coverage", () => "/price-coverage"],
    ["GET", "/tenant/v1/products/:id/price-calendar", () => `/price-calendar?${calendarQuery}`],
    ["GET", "/tenant/v1/products/:id/adjust-rules", () => "/adjust-rules"],
    ["POST", "/tenant/v1/products/:id/adjust-rules", () => "/adjust-rules", adjust],
    ["PUT", "/tenant/v1/products/:id/adjust-rules/order", () => "/adjust-rules/order", { ids: [theirs.adjustRuleId] }],
    ["PUT", "/tenant/v1/products/:id/adjust-rules/:ruleId", () => `/adjust-rules/${theirs.adjustRuleId}`, adjust],
    ["DELETE", "/tenant/v1/products/:id/adjust-rules/:ruleId", () => `/adjust-rules/${theirs.adjustRuleId}`],
    ["POST", "/tenant/v1/products/:id/adjust-rules/:ruleId/enable", () => `/adjust-rules/${theirs.adjustRuleId}/enable`],
    ["POST", "/tenant/v1/products/:id/adjust-rules/:ruleId/disable", () => `/adjust-rules/${theirs.adjustRuleId}/disable`],
  ];
  for (const [method, route, suffix, body] of requests) {
    cover(`${method} ${route}`);
    const send = (productId: string): Promise<ApiResponse> =>
      api.call(method, `/tenant/v1/products/${productId}${suffix(null)}`, { token: a.adminToken, headers: { "if-match": '"3"', "idempotency-key": randomUUID() }, ...(body === undefined ? {} : { body }) });
    const foreign = await send(theirs.productId);
    assert.equal(foreign.status, 404, `${method} ${route}：${foreign.text}`);
    assert.equal(foreign.text, (await send(NO_SUCH_ID)).text, `${method} ${route}`);
  }
  assert.deepEqual(await priceRows(), before);
  // 对方自己照常用得了
  assert.equal((await api.call("GET", `/tenant/v1/products/${theirs.productId}/price-calendar?${calendarQuery}`, { token: b.adminToken })).body.days[0].segments[0].final, 24_200);
});

test("在自己的商品里混进别的供应商的东西：对方的价格编号、调价编号、区域一律和不存在的一样被拒，整批不写", async () => {
  const seeded = await seedPrices();
  const before = await priceRows();
  const mine = seeded.a;
  const theirs = seeded.b;
  const version = (await api.call("GET", `/tenant/v1/products/${mine.productId}/price-rules`, { token: a.adminToken })).body.version as number;
  const send = (method: HttpMethod, suffix: string, body?: unknown): Promise<ApiResponse> =>
    api.call(method, `/tenant/v1/products/${mine.productId}${suffix}`, { token: a.adminToken, headers: { "if-match": `"${version}"`, "idempotency-key": randomUUID() }, ...(body === undefined ? {} : { body }) });
  const price = (areaId: string): Record<string, unknown> => ({ area_id: areaId, vehicle_group_id: seeded.vehicleGroupId, pricing_model: "fixed", base_price: 1, valid_from: "2027-01-01" });
  const reasons = (res: ApiResponse): unknown => res.body.error?.details?.issues?.map((issue: any) => [issue.path, issue.reason]);
  // 单条：别人的价格 / 调价编号挂在自己的商品下面——404
  for (const [method, suffix, body] of [
    ["PUT", `/price-rules/${theirs.priceRuleId}`, price(mine.areaId)],
    ["DELETE", `/price-rules/${theirs.priceRuleId}`, undefined],
    ["PUT", `/adjust-rules/${theirs.adjustRuleId}`, { name: "x", cycle: { type: "daily" }, steps: [{ type: "amount", value: 1 }] }],
    ["DELETE", `/adjust-rules/${theirs.adjustRuleId}`, undefined],
    ["POST", `/adjust-rules/${theirs.adjustRuleId}/disable`, undefined],
    ["POST", `/adjust-rules/${theirs.adjustRuleId}/enable`, undefined],
  ] as const) {
    const res = await send(method, suffix, body);
    assert.equal(res.status, 404, `${method} ${suffix}：${res.text}`);
  }
  // 批量：一条合法的新增 + 对方的价格编号（改、删）+ 对方的区域——整批 400，和写一个不存在的编号一模一样
  const batch = (priceId: string, areaId: string): Promise<ApiResponse> =>
    send("POST", "/price-rules/batch", { create: [price(mine.areaId), price(areaId)], update: [{ ...price(mine.areaId), id: priceId, valid_from: "2028-01-01" }], delete: [priceId] });
  const mixed = await batch(theirs.priceRuleId, theirs.areaId);
  assert.equal(mixed.status, 400, mixed.text);
  assert.deepEqual(reasons(mixed), [["/create/1/area_id", "AREA_NOT_IN_PRODUCT"], ["/update/0/id", "UNKNOWN_PRICE_RULE"], ["/delete/0", "UNKNOWN_PRICE_RULE"]]);
  // 和写一个不存在的编号时逐条一样（detail 里只是把请求里给的那个编号带回来）
  const plain = (res: ApiResponse): unknown => res.body.error.details.issues.map((issue: any) => [issue.path, issue.reason, issue.message]);
  assert.deepEqual(plain(mixed), plain(await batch(NO_SUCH_ID, NO_SUCH_ID)));
  assert.deepEqual(mixed.body.error.details.issues.map((issue: any) => issue.detail), [{}, { id: seeded.b.priceRuleId }, { id: seeded.b.priceRuleId }]);
  const single = await send("POST", "/price-rules", price(theirs.areaId));
  assert.deepEqual(reasons(single), [["/area_id", "AREA_NOT_IN_PRODUCT"]]);
  // 调价规则的适用区域、排序里混进对方的编号
  const adjust = await send("POST", "/adjust-rules", { name: "混进别人的区域", cycle: { type: "daily" }, area_ids: [mine.areaId, theirs.areaId], steps: [{ type: "amount", value: 1 }] });
  assert.deepEqual(reasons(adjust), [["/area_ids/1", "AREA_NOT_IN_PRODUCT"]]);
  const order = await send("PUT", "/adjust-rules/order", { ids: [mine.adjustRuleId, theirs.adjustRuleId] });
  assert.deepEqual(reasons(order), [["/ids", "IDS_MISMATCH"]]);
  assert.deepEqual(await priceRows(), before);
});

test("PUT /tenant/v1/brands/{id}/rounding-unit：改不了别的供应商的子品牌的取整单位；GET /tenant/v1/holidays：节假日是平台数据，两边看到的一样", async () => {
  cover("PUT /tenant/v1/brands/:id/rounding-unit");
  cover("GET /tenant/v1/holidays");
  const seeded = await seedPrices();
  const before = await priceRows();
  const put = (brandId: string): Promise<ApiResponse> => api.call("PUT", `/tenant/v1/brands/${brandId}/rounding-unit`, { token: a.adminToken, headers: { "if-match": '"1"' }, body: { rounding_unit: 100, tenant_id: b.tenantId } });
  const foreign = await put(seeded.b.brandId);
  assert.equal(foreign.status, 404);
  assert.equal(foreign.text, (await put(NO_SUCH_ID)).text);
  assert.deepEqual(await priceRows(), before);
  const day = await api.call("PUT", "/platform/v1/holidays/JP/2027-01-01", { token: platformToken, body: { name: { ja: "元日" } } });
  assert.ok([200, 201].includes(day.status), day.text);
  const fromA = await api.call("GET", `/tenant/v1/holidays?from=2027-01-01&to=2027-01-31&tenant_id=${b.tenantId}`, { token: a.adminToken });
  const fromB = await api.call("GET", "/tenant/v1/holidays?from=2027-01-01&to=2027-01-31", { token: b.adminToken });
  assert.equal(fromA.status, 200);
  assert.deepEqual(fromA.body, fromB.body);
  assert.ok(!fromA.text.includes(a.tenantId) && !fromA.text.includes(b.tenantId));
  // 租户写不了节假日（数据库层面也没有权限）
  await assert.rejects(withTenantTx(api.db.pool, a.tenantId, (db) => db.query("update holidays set name = '{\"ja\": \"x\"}'")), deniedByDatabase);
  await assert.rejects(withTenantTx(api.db.pool, a.tenantId, (db) => db.query("delete from holidays")), deniedByDatabase);
});

test("价格和调价的隔离（数据库层面）：租户事务里只看得到、改得到、删得到自己的行，写不进别人名下，也接不到别人的商品和区域上；平台角色对这两张表只读", async () => {
  const seeded = await seedPrices();
  const before = await priceRows();
  for (const table of ["price_rules", "adjust_rules"]) {
    const seen = await withTenantTx(api.db.pool, a.tenantId, (db) => db.query<{ tenant_id: string }>(`select distinct tenant_id from ${table}`));
    assert.deepEqual(seen.rows.map((row) => row.tenant_id), [a.tenantId], table);
  }
  const touched = await withTenantTx(api.db.pool, a.tenantId, async (db) => [
    (await db.query("update price_rules set params = '{\"basePriceMinor\": 1}' where id = $1", [seeded.b.priceRuleId])).rowCount,
    (await db.query("delete from price_rules where id = $1", [seeded.b.priceRuleId])).rowCount,
    (await db.query("update adjust_rules set status = 'disabled' where id = $1", [seeded.b.adjustRuleId])).rowCount,
    (await db.query("delete from adjust_rules where product_id = $1", [seeded.b.productId])).rowCount,
  ]);
  assert.deepEqual(touched, [0, 0, 0, 0]);
  const insertPrice = (tenantId: string, productId: string, areaId: string): Promise<unknown> =>
    withTenantTx(api.db.pool, a.tenantId, (db) =>
      db.query(
        `insert into price_rules (tenant_id, product_id, area_id, vehicle_group_id, pricing_model, params, valid_from, status, created_at, updated_at)
         values ($1, $2, $3, $4, 'fixed', '{"basePriceMinor": 1}', '2030-01-01', 'enabled', now(), now())`,
        [tenantId, productId, areaId, seeded.vehicleGroupId],
      ),
    );
  await assert.rejects(insertPrice(b.tenantId, seeded.b.productId, seeded.b.areaId), { code: "42501" }, "写进别人名下");
  await assert.rejects(insertPrice(a.tenantId, seeded.b.productId, seeded.a.areaId), { code: "23503" }, "自己的租户编号 + 别人的商品：外键带着租户编号，接不上");
  await assert.rejects(insertPrice(a.tenantId, seeded.a.productId, seeded.b.areaId), { code: "23503" }, "自己的商品 + 别人的区域");
  await assert.rejects(withTenantTx(api.db.pool, a.tenantId, (db) => db.query("update price_rules set tenant_id = $1 where id = $2", [b.tenantId, seeded.a.priceRuleId])), { code: "42501" });
  await assert.rejects(
    withTenantTx(api.db.pool, a.tenantId, (db) =>
      db.query("insert into adjust_rules (tenant_id, product_id, name, cycle, steps, position, status, created_at, updated_at) values ($1, $2, 'x', '{\"type\": \"daily\"}', '[]', 9, 'enabled', now(), now())", [b.tenantId, seeded.b.productId]),
    ),
    { code: "42501" },
  );
  // 平台角色：价格和调价只读（报价用，ADR 0020），不能写
  for (const table of ["price_rules", "adjust_rules"]) {
    assert.ok(((await withPlatformTx(api.db.pool, (db) => db.query(`select 1 from ${table}`))).rowCount ?? 0) > 0, table);
    await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query(`delete from ${table}`)), deniedByDatabase, table);
    await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query(`update ${table} set status = 'disabled'`)), deniedByDatabase, table);
  }
  assert.deepEqual(await priceRows(), before);
});

// ---- 库存和 Excel 导入导出（M1-05）----

/** 上传一个文件（请求体就是文件本身）。 */
async function uploadFile(url: string, token: string, file: Buffer, headers: Record<string, string> = {}): Promise<ApiResponse> {
  const res = await api.app.inject({ method: "POST", url, payload: file, headers: { "content-type": XLSX_CONTENT_TYPE, authorization: `Bearer ${token}`, "idempotency-key": randomUUID(), ...headers } });
  let body: any = null;
  try {
    body = res.json();
  } catch {
    body = null;
  }
  return { status: res.statusCode, headers: res.headers, text: res.body, body };
}

const fileSha = (file: Buffer): string => createHash("sha256").update(file).digest("hex");
const stockFile = (date: string, total: number): Buffer => writeXlsx([{ name: "库存", rows: [["日期", "可售单数"], [date, { number: String(total) }]] }]);

async function inventoryRows(): Promise<unknown> {
  return {
    days: (await api.db.owner.query("select tenant_id, product_id, day::text, total, held, sold, updated_at from inventory_days order by tenant_id, product_id, day")).rows,
    modes: (await api.db.owner.query("select id, inventory_mode, version from products order by id")).rows,
  };
}

/** 两个供应商各自给自己的商品设了一天库存。 */
async function seedInventory(): Promise<{ a: PriceSide; b: PriceSide; vehicleGroupId: string }> {
  const seeded = await seedPrices();
  const existing = await api.db.owner.query("select count(*)::int as n from inventory_days");
  if (existing.rows[0].n === 0) {
    for (const [fixture, side, total] of [[a, seeded.a, 3], [b, seeded.b, 7]] as const) {
      const version = (await api.call("GET", `/tenant/v1/products/${side.productId}/price-rules`, { token: fixture.adminToken })).body.version as number;
      const res = await api.call("POST", `/tenant/v1/products/${side.productId}/inventory/batch-set`, { token: fixture.adminToken, headers: { "if-match": `"${version}"` }, body: { from: "2026-11-01", to: "2026-11-01", total, tenant_id: fixture === a ? b.tenantId : a.tenantId } });
      assert.equal(res.status, 200, res.text);
    }
  }
  return seeded;
}

test("库存：看不到、改不了别的供应商商品的库存（404，和不存在一样）；自己的日历里只有自己的数", async () => {
  cover("GET /tenant/v1/products/:id/inventory");
  cover("PUT /tenant/v1/products/:id/inventory");
  cover("POST /tenant/v1/products/:id/inventory/batch-set");
  const seeded = await seedInventory();
  const before = await inventoryRows();
  const owners = await api.db.owner.query("select tenant_id, product_id, total from inventory_days order by total");
  assert.deepEqual(owners.rows, [{ tenant_id: a.tenantId, product_id: seeded.a.productId, total: 3 }, { tenant_id: b.tenantId, product_id: seeded.b.productId, total: 7 }]);
  const requests: [HttpMethod, string, unknown?][] = [
    ["GET", "/inventory?from=2026-11-01&to=2026-11-02"],
    ["PUT", "/inventory", { mode: "limited", tenant_id: b.tenantId }],
    ["POST", "/inventory/batch-set", { from: "2026-11-01", to: "2026-11-01", total: 0 }],
  ];
  for (const [method, suffix, body] of requests) {
    const send = (productId: string): Promise<ApiResponse> => api.call(method, `/tenant/v1/products/${productId}${suffix}`, { token: a.adminToken, headers: { "if-match": '"4"' }, ...(body === undefined ? {} : { body }) });
    const foreign = await send(seeded.b.productId);
    assert.equal(foreign.status, 404, `${method} ${suffix}：${foreign.text}`);
    assert.equal(foreign.text, (await send(NO_SUCH_ID)).text);
  }
  assert.deepEqual(await inventoryRows(), before);
  const mine = await api.call("GET", `/tenant/v1/products/${seeded.a.productId}/inventory?from=2026-11-01&to=2026-11-01&tenant_id=${b.tenantId}`, { token: a.adminToken });
  assert.deepEqual(mine.body.days.map((day: any) => day.total), [3]);
});

test("试算：试算不了别的供应商的商品（404，和不存在一样）；自己的商品试算出来的只有自己的结算价", async () => {
  cover("POST /tenant/v1/products/:id/quote-preview");
  const seeded = await seedInventory();
  const body = { pickup: { lng: 139.7, lat: 35.6 }, dropoff: { lng: 139.7, lat: 35.6 }, service_time: "2026-11-20T10:00", passengers: 2, tenant_id: b.tenantId };
  const send = (productId: string, token: string, payload: unknown = body): Promise<ApiResponse> => api.call("POST", `/tenant/v1/products/${productId}/quote-preview`, { token, body: payload });
  // 请求体里的 tenant_id 不认（不认识的字段：400），不会因此看到对方的商品
  assert.equal((await send(seeded.b.productId, a.adminToken)).status, 400);
  const { tenant_id: _ignored, ...clean } = body;
  const foreign = await send(seeded.b.productId, a.adminToken, clean);
  assert.equal(foreign.status, 404, foreign.text);
  assert.equal(foreign.text, (await send(NO_SUCH_ID, a.adminToken, clean)).text);
  const own = await send(seeded.a.productId, a.adminToken, clean);
  assert.equal(own.status, 200, own.text);
  assert.equal(own.body.product_id, seeded.a.productId);
  assert.doesNotMatch(own.text, new RegExp(`${b.tenantId}|${seeded.b.productId}|sell|markup`));
});

test("导入导出：导不出、预览不了、导入不了别的供应商的商品；往自己的商品里导入带着对方价格编号的文件，那一行和编号不存在一样被拒", async () => {
  for (const route of ["GET /tenant/v1/products/:id/price-rules/export", "POST /tenant/v1/products/:id/price-rules/import/preview", "POST /tenant/v1/products/:id/price-rules/import", "GET /tenant/v1/products/:id/inventory/export", "POST /tenant/v1/products/:id/inventory/import/preview", "POST /tenant/v1/products/:id/inventory/import"]) cover(route);
  const seeded = await seedInventory();
  const before = { prices: await priceRows(), inventory: await inventoryRows() };
  const stock = stockFile("2026-11-02", 9);
  const header = ["价格编号", "区域", "车型组", "计价方式", "基础价", "起步价", "起步里程(公里)", "起步时长(分钟)", "每公里单价", "每分钟单价", "最低消费", "生效开始", "生效结束", "状态"];
  const priceFile = (priceId: string): Buffer =>
    writeXlsx([{ name: "价格", rows: [header, [priceId, "市区", "VG-BIZ-7", "一口价", { number: "1" }, null, null, null, null, null, null, "2026-10-01", null, null]] }]);
  // 对方的商品：六个接口都是 404，和不存在的商品一模一样
  for (const productId of [seeded.b.productId]) {
    const exports = [`/price-rules/export`, `/inventory/export?from=2026-11-01&to=2026-11-02`];
    for (const suffix of exports) {
      const foreign = await api.call("GET", `/tenant/v1/products/${productId}${suffix}`, { token: a.adminToken });
      assert.equal(foreign.status, 404, suffix);
      assert.equal(foreign.text, (await api.call("GET", `/tenant/v1/products/${NO_SUCH_ID}${suffix}`, { token: a.adminToken })).text);
      assert.ok(!foreign.text.includes(seeded.b.priceRuleId));
    }
    const uploads: [string, Buffer][] = [
      ["/price-rules/import/preview", priceFile(seeded.b.priceRuleId)],
      [`/price-rules/import?file_sha256=${fileSha(priceFile(seeded.b.priceRuleId))}`, priceFile(seeded.b.priceRuleId)],
      ["/inventory/import/preview", stock],
      [`/inventory/import?file_sha256=${fileSha(stock)}`, stock],
    ];
    for (const [suffix, file] of uploads) {
      const foreign = await uploadFile(`/tenant/v1/products/${productId}${suffix}`, a.adminToken, file, { "if-match": '"4"' });
      assert.equal(foreign.status, 404, `${suffix}：${foreign.text}`);
      assert.equal(foreign.text, (await uploadFile(`/tenant/v1/products/${NO_SUCH_ID}${suffix}`, a.adminToken, file, { "if-match": '"4"' })).text);
    }
  }
  // 自己的商品 + 对方的价格编号：那一行出错，原因和编号不存在时一样；确认导入整份拒绝
  const smuggled = await uploadFile(`/tenant/v1/products/${seeded.a.productId}/price-rules/import/preview`, a.adminToken, priceFile(seeded.b.priceRuleId));
  const unknown = await uploadFile(`/tenant/v1/products/${seeded.a.productId}/price-rules/import/preview`, a.adminToken, priceFile(NO_SUCH_ID));
  assert.equal(smuggled.status, 200, smuggled.text);
  assert.deepEqual(smuggled.body.rows.map((row: any) => [row.action, row.price_rule_id, row.issues.map((issue: any) => issue.reason)]), [["error", null, ["UNKNOWN_PRICE_RULE"]]]);
  assert.deepEqual(smuggled.body.rows, unknown.body.rows);
  const version = smuggled.body.version as number;
  const forced = await uploadFile(`/tenant/v1/products/${seeded.a.productId}/price-rules/import?file_sha256=${fileSha(priceFile(seeded.b.priceRuleId))}`, a.adminToken, priceFile(seeded.b.priceRuleId), { "if-match": `"${version}"` });
  assert.deepEqual([forced.status, forced.body.error.code], [409, "IMPORT_NOT_CLEAN"]);
  // 自己导出的文件里只有自己的价格
  const exported = await api.app.inject({ method: "GET", url: `/tenant/v1/products/${seeded.a.productId}/price-rules/export`, headers: { authorization: `Bearer ${a.adminToken}` } });
  const cells = JSON.stringify(readXlsx(exported.rawPayload));
  assert.ok(cells.includes(seeded.a.priceRuleId) && !cells.includes(seeded.b.priceRuleId) && !cells.includes(b.tenantId));
  assert.deepEqual({ prices: await priceRows(), inventory: await inventoryRows() }, before);
});

test("库存的隔离（数据库层面）：租户事务里只看得到、改得到、删得到自己的行，写不进别人名下，也接不到别人的商品上；平台角色只能改预占数和已售数", async () => {
  const seeded = await seedInventory();
  const before = await inventoryRows();
  const seen = await withTenantTx(api.db.pool, a.tenantId, (db) => db.query<{ tenant_id: string }>("select distinct tenant_id from inventory_days"));
  assert.deepEqual(seen.rows.map((row) => row.tenant_id), [a.tenantId]);
  const touched = await withTenantTx(api.db.pool, a.tenantId, async (db) => [
    (await db.query("update inventory_days set total = 0 where product_id = $1", [seeded.b.productId])).rowCount,
    (await db.query("update inventory_days set held = held + 1 where product_id = $1 and total - held - sold >= 1", [seeded.b.productId])).rowCount,
    (await db.query("delete from inventory_days where product_id = $1", [seeded.b.productId])).rowCount,
    (await db.query("update products set inventory_mode = 'limited' where id = $1", [seeded.b.productId])).rowCount,
  ]);
  assert.deepEqual(touched, [0, 0, 0, 0]);
  const insert = (tenantId: string, productId: string): Promise<unknown> =>
    withTenantTx(api.db.pool, a.tenantId, (db) => db.query("insert into inventory_days (tenant_id, product_id, day, total, created_at, updated_at) values ($1, $2, '2027-01-01', 1, now(), now())", [tenantId, productId]));
  await assert.rejects(insert(b.tenantId, seeded.b.productId), { code: "42501" }, "写进别人名下");
  await assert.rejects(insert(a.tenantId, seeded.b.productId), { code: "23503" }, "自己的租户编号 + 别人的商品");
  await assert.rejects(withTenantTx(api.db.pool, a.tenantId, (db) => db.query("update inventory_days set tenant_id = $1 where product_id = $2", [b.tenantId, seeded.a.productId])), { code: "42501" });
  // 平台角色：库存能读（报价用，ADR 0020）；只能改预占数、已售数（下单预占、付款扣减、超时释放，ADR 0026），总量和所属改不了，删不掉
  assert.ok(((await withPlatformTx(api.db.pool, (db) => db.query("select 1 from inventory_days"))).rowCount ?? 0) > 0);
  await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query("update inventory_days set total = 99")), deniedByDatabase);
  for (const column of ["tenant_id", "product_id", "day", "vehicle_group_id", "created_at"]) {
    await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query(`update inventory_days set ${column} = ${column}`)), deniedByDatabase, column);
  }
  await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query("delete from inventory_days")), deniedByDatabase);
  assert.deepEqual(await inventoryRows(), before);
});

/** 两个供应商各有一张已确认的点对点订单（下单和付款的全流程在 orders.itest.ts；这里只要数据库里有两边的单）。 */
async function seedOrders(): Promise<{ a: string; b: string }> {
  const seeded = await seedPrices();
  const city = (await api.db.owner.query<{ city_id: string }>("select city_id from products where id = $1", [seeded.a.productId])).rows[0]!.city_id;
  const ids = { a: randomUUID(), b: randomUUID() };
  const settlement = JSON.stringify({ currency: "JPY", roundingUnit: 1, totalMinor: 11_000, baseMinor: 11_000, adjustMinor: 0, urgentMinor: 0, nightMinor: 0, addonsMinor: 0, driverLanguageMinor: 0 });
  for (const [name, fixture, side, orderNo] of [["a", a, seeded.a, "NZ20261007AAAAAAAA"], ["b", b, seeded.b, "NZ20261007BBBBBBBB"]] as const) {
    await api.db.owner.query(
      `insert into orders (tenant_id, id, order_no, status, category, city_id, product_id, product_version, vehicle_group_id, service_at, service_local, timezone, service_date,
                           urgent, passengers, luggage, pickup, dropoff, addons, passenger, settlement_minor, settlement_currency, settlement, inventory_held,
                           payment_due_at, confirmed_at, dispatch_due_at, created_at, updated_at)
       values ($1, $2, $3, 'confirmed', 'point_to_point', $4, $5, 1, $6, '2026-11-01T01:00:00Z', '2026-11-01T10:00', 'Asia/Tokyo', '2026-11-01',
               false, 1, 0, $7::jsonb, $7::jsonb, '[]'::jsonb, $8::jsonb, 11000, 'JPY', $9::jsonb, false,
               '2026-10-07T01:00:00Z', '2026-10-07T00:10:00Z', '2026-10-31T01:00:00Z', '2026-10-07T00:00:00Z', '2026-10-07T00:10:00Z')
       on conflict do nothing`,
      [fixture.tenantId, ids[name], orderNo, city, side.productId, seeded.vehicleGroupId, JSON.stringify({ lng: 139.7, lat: 35.6, address: `${name} 的地址` }), JSON.stringify({ name: `乘客 ${name}`, phone: "+81 90-1234-5678", email: `${name}@guest.test` }), settlement],
    );
  }
  return ids;
}

test("订单：只列出自己的单，带别人的 tenant_id 也一样；看不到别的供应商的单（404，和不存在一样）；数据库里读不到、改不了别人的单", async () => {
  cover("GET /tenant/v1/orders");
  cover("GET /tenant/v1/orders/:id");
  const ids = await seedOrders();
  for (const query of ["", `?tenant_id=${b.tenantId}`]) {
    const list = await api.call("GET", `/tenant/v1/orders${query}`, { token: a.adminToken });
    assert.equal(list.status, 200, list.text);
    assert.deepEqual(list.body.items.map((item: { id: string }) => item.id), [ids.a], query);
    assert.ok(!list.text.includes(ids.b) && !list.text.includes("b@guest.test"), query);
  }
  assert.equal((await api.call("GET", `/tenant/v1/orders/${ids.a}`, { token: a.adminToken })).status, 200);
  const foreign = await api.call("GET", `/tenant/v1/orders/${ids.b}?tenant_id=${b.tenantId}`, { token: a.adminToken });
  assert.equal(foreign.status, 404, foreign.text);
  assert.equal(foreign.text, (await api.call("GET", `/tenant/v1/orders/${NO_SUCH_ID}`, { token: a.adminToken })).text);
  assert.equal((await api.call("GET", `/tenant/v1/orders/${ids.b}`, { token: bDispatcher.token })).status, 200, "乙自己的调度看得到");
  const seen = await withTenantTx(api.db.pool, a.tenantId, (db) => db.query<{ id: string }>("select id from orders"));
  assert.deepEqual(seen.rows.map((row) => row.id), [ids.a]);
  assert.equal((await withTenantTx(api.db.pool, a.tenantId, (db) => db.query("select 1 from order_events where tenant_id = $1", [b.tenantId]))).rowCount, 0);
  await assert.rejects(withTenantTx(api.db.pool, a.tenantId, (db) => db.query("update orders set notes = 'x' where id = $1", [ids.b])), deniedByDatabase);
  await assert.rejects(withTenantTx(api.db.pool, a.tenantId, (db) => db.query("delete from orders where id = $1", [ids.b])), deniedByDatabase);
  const status = await api.db.owner.query<{ status: string; notes: string | null }>("select status, notes from orders where id = $1", [ids.b]);
  assert.deepEqual(status.rows[0], { status: "confirmed", notes: null });
});

test("供应商入驻（ADR 0028）：企业信息、资质文件、资质、提交审核、合同、状态记录、提醒、评分——甲读不到、改不了乙的，带乙的编号也一样；数据库层面同样拦得住", async () => {
  for (const route of ["GET /tenant/v1/company", "PUT /tenant/v1/company/profile", "POST /tenant/v1/company/files", "GET /tenant/v1/company/files/:id", "POST /tenant/v1/company/documents", "POST /tenant/v1/company/submit", "GET /tenant/v1/company/contracts", "GET /tenant/v1/company/status-events", "GET /tenant/v1/company/notices", "GET /tenant/v1/performance"]) cover(route);
  // 两家还在「申请中」的供应商：入驻的动作只在这个状态下能做
  const c = await api.tenantWithAdmin(platformToken, "车队丙", "admin@onboarding-c.test", { onboarding: "applying" });
  const d = await api.tenantWithAdmin(platformToken, "车队丁", "admin@onboarding-d.test", { onboarding: "applying" });
  const pdf = Buffer.from("%PDF-1.7\n乙的营业执照\n%%EOF");
  const upload = (who: TenantFixture, bytes: Buffer): Promise<ApiResponse> => uploadBytes(api, `/tenant/v1/company/files?file_name=${encodeURIComponent("执照.pdf")}`, bytes, who.adminToken, "application/pdf");
  const dFile = await upload(d, pdf);
  assert.equal(dFile.status, 201, dFile.text);
  // 丁交一份资质、填企业信息、提交审核
  const profile = { country_code: "KR", legal_name: "丁株式会社", registration_no: "D-1", address: "首尔", contact_name: "丁", contact_phone: "+8221234567", contact_email: "d@d.test" };
  assert.equal((await api.call("PUT", "/tenant/v1/company/profile", { token: d.adminToken, body: profile })).status, 200);
  const dDoc = await api.call("POST", "/tenant/v1/company/documents", { token: d.adminToken, body: { type: "settlement_account", file_id: dFile.body.id } });
  assert.equal(dDoc.status, 201, dDoc.text);

  // 文件：丙拿丁的文件编号下载，和不存在一样 404
  const foreignFile = await api.call("GET", `/tenant/v1/company/files/${dFile.body.id}`, { token: c.adminToken });
  assert.equal(foreignFile.status, 404);
  assert.equal(foreignFile.text, (await api.call("GET", `/tenant/v1/company/files/${NO_SUCH_ID}`, { token: c.adminToken })).text);
  assert.equal((await api.call("GET", `/tenant/v1/company/files/${dFile.body.id}`, { token: d.adminToken })).status, 200);
  // 资质：丙拿丁的文件提交资质，当作文件不存在；丁的文件仍然没被用过、丙一份资质都没有
  const stolen = await api.call("POST", "/tenant/v1/company/documents", { token: c.adminToken, body: { type: "settlement_account", file_id: dFile.body.id, tenant_id: d.tenantId } });
  assert.equal(stolen.status, 400, stolen.text);
  assert.equal(stolen.body.error.details.issues[0].reason, "UNKNOWN_FILE");
  assert.equal((await api.db.owner.query("select count(*)::int as n from tenant_documents where tenant_id = $1", [c.tenantId])).rows[0].n, 0);
  // 企业信息：丙改的只是自己的；带丁的 tenant_id 不生效
  const cProfile = await api.call("PUT", `/tenant/v1/company/profile?tenant_id=${d.tenantId}`, { token: c.adminToken, body: { ...profile, legal_name: "丙改的", tenant_id: d.tenantId } });
  assert.equal(cProfile.status, 200, cProfile.text);
  const profiles = await api.db.owner.query<{ tenant_id: string; legal_name: string }>("select tenant_id, legal_name from tenant_profiles order by legal_name");
  assert.deepEqual(profiles.rows.map((row) => [row.tenant_id, row.legal_name]), [[d.tenantId, "丁株式会社"], [c.tenantId, "丙改的"]]);
  // 提交审核：丙的资料不齐，提交不了，也不会动到丁
  const submitted = await api.call("POST", `/tenant/v1/company/submit?tenant_id=${d.tenantId}`, { token: c.adminToken, body: { tenant_id: d.tenantId } });
  assert.equal(submitted.status, 409, submitted.text);
  assert.deepEqual((await api.db.owner.query("select id, status from tenants where id = any($1::uuid[]) order by name", [[c.tenantId, d.tenantId]])).rows.map((row) => row.status), ["applying", "applying"]);
  // 丁这边有了合同、状态记录、提醒、评分；丙一样都看不到
  await api.db.owner.query("update tenants set status = 'reviewing' where id = $1", [d.tenantId]);
  const approver = await approverToken(api, platformToken);
  const contract = await api.call("POST", `/platform/v1/tenants/${d.tenantId}/contracts`, { token: platformToken, body: { valid_from: "2026-10-07", settle_currency: "KRW" } });
  assert.equal(contract.status, 202, contract.text);
  assert.equal((await api.call("POST", `/platform/v1/approvals/${contract.body.approval.id}/approve`, { token: approver, body: {} })).status, 200);
  const rejected = await api.call("POST", `/platform/v1/tenants/${d.tenantId}/documents/${dDoc.body.id}/reject`, { token: platformToken, body: { reason: "看不清" } });
  assert.equal(rejected.status, 200, rejected.text);
  await api.app.tenantJobs.tick();
  const fromD = await api.call("GET", "/tenant/v1/company/status-events", { token: d.adminToken });
  assert.ok(fromD.body.items.length > 0);
  assert.ok((await api.call("GET", "/tenant/v1/company/notices", { token: d.adminToken })).body.items.length > 0);
  for (const path of ["/tenant/v1/company", "/tenant/v1/company/contracts", "/tenant/v1/company/status-events", "/tenant/v1/company/notices", "/tenant/v1/performance"]) {
    const res = await api.call("GET", `${path}?tenant_id=${d.tenantId}`, { token: c.adminToken });
    assert.equal(res.status, 200, `${path} ${res.text}`);
    for (const secret of [d.tenantId, dDoc.body.id, dFile.body.id, contract.body.approval.id, "丁株式会社", "看不清"]) assert.ok(!res.text.includes(secret), `${path} 里有丁的 ${secret}`);
  }
  const cCompany = await api.call("GET", "/tenant/v1/company", { token: c.adminToken });
  assert.deepEqual([cCompany.body.tenant.id, cCompany.body.documents, cCompany.body.contracts], [c.tenantId, [], []]);
  // 数据库层面：丙的租户事务里看不到丁的任何一行，改不了、写不进
  for (const table of ["tenant_profiles", "tenant_files", "tenant_documents", "tenant_contracts", "tenant_status_events", "tenant_notices", "tenant_score_daily", "tenant_performance_events", "order_reviews"]) {
    const rows = await withTenantTx(api.db.pool, c.tenantId, (db) => db.query(`select 1 from ${table} where tenant_id = $1`, [d.tenantId]));
    assert.equal(rows.rowCount, 0, table);
  }
  await assert.rejects(withTenantTx(api.db.pool, c.tenantId, (db) => db.query("insert into tenant_files (tenant_id, purpose, content_type, byte_size, sha256, data, file_name, uploaded_at, uploaded_by_type, uploaded_by) values ($1, 'document', 'application/pdf', 1, repeat('0', 64), 'x', 'x', now(), 'tenant_user', $2)", [d.tenantId, c.adminId])), deniedByDatabase);
  await assert.rejects(withTenantTx(api.db.pool, c.tenantId, (db) => db.query("update tenant_documents set status = 'approved'")), deniedByDatabase);
  await assert.rejects(withTenantTx(api.db.pool, c.tenantId, (db) => db.query("update tenants set status = 'active'")), deniedByDatabase);
  await assert.rejects(withTenantTx(api.db.pool, c.tenantId, (db) => db.query("insert into tenant_contracts (tenant_id, version, valid_from, settle_currency, settle_cycle, payment_day, approval_id, requested_by, approved_by, created_at) select $1, 9, '2030-01-01', 'JPY', 'monthly', 20, approval_id, requested_by, approved_by, now() from tenant_contracts limit 1", [c.tenantId])), deniedByDatabase);
  const updated = await withTenantTx(api.db.pool, c.tenantId, (db) => db.query("update tenant_profiles set legal_name = 'x' where tenant_id = $1", [d.tenantId]));
  assert.equal(updated.rowCount, 0);
  assert.equal((await api.db.owner.query("select legal_name from tenant_profiles where tenant_id = $1", [d.tenantId])).rows[0].legal_name, "丁株式会社");
});

/** 两边的已确认订单（seedOrders 写入的，按订单号找回来）。 */
async function orderIds(): Promise<{ a: string; b: string }> {
  await seedOrders();
  const rows = await api.db.owner.query<{ id: string; order_no: string }>("select id, order_no from orders where order_no in ('NZ20261007AAAAAAAA', 'NZ20261007BBBBBBBB')");
  const byNo = new Map(rows.rows.map((row) => [row.order_no, row.id]));
  return { a: byNo.get("NZ20261007AAAAAAAA") as string, b: byNo.get("NZ20261007BBBBBBBB") as string };
}

async function fleetRows(): Promise<unknown> {
  return { drivers: (await api.db.owner.query("select * from drivers order by id")).rows, vehicles: (await api.db.owner.query("select * from vehicles order by id")).rows };
}

interface FleetSide {
  driverId: string;
  vehicleId: string;
}
const fleet: Partial<Record<"a" | "b", FleetSide>> = {};

/** 两边各一位司机、一辆车（经真实接口；同一个幂等键、同一个电话和车牌在两个供应商之间互不相干）。 */
async function seedFleet(): Promise<{ a: FleetSide; b: FleetSide; vehicleGroupId: string }> {
  const seeded = await seedPrices();
  const seats = (await api.db.owner.query<{ seats: number }>("select seats from vehicle_groups where id = $1", [seeded.vehicleGroupId])).rows[0]!.seats;
  for (const [name, fixture] of [["a", a], ["b", b]] as const) {
    if (fleet[name] !== undefined) continue;
    const headers = { "idempotency-key": "shared-key-fleet-0001" };
    const driver = await api.call("POST", "/tenant/v1/drivers", { token: fixture.adminToken, headers, body: { name: `司机 ${name}`, phone: "+81 90-0000-1111", languages: ["ja"], license_expires_on: "2030-01-01", tenant_id: name === "a" ? b.tenantId : a.tenantId } });
    assert.equal(driver.status, 201, driver.text);
    const vehicle = await api.call("POST", "/tenant/v1/vehicles", { token: fixture.adminToken, headers, body: { plate: "品川 300 あ 00-01", vehicle_group_id: seeded.vehicleGroupId, model: "埃尔法", seats, mileage_km: 100, plate_type: "business", insurance_expires_on: "2030-01-01", inspection_expires_on: "2030-01-01", tenant_id: name === "a" ? b.tenantId : a.tenantId } });
    assert.equal(vehicle.status, 201, vehicle.text);
    fleet[name] = { driverId: driver.body.id, vehicleId: vehicle.body.id };
  }
  return { a: fleet.a as FleetSide, b: fleet.b as FleetSide, vehicleGroupId: seeded.vehicleGroupId };
}

test("司机和车辆：建在令牌所属的供应商名下（请求体的 tenant_id 不生效）；只列出自己的；看不到、改不了、停用不了别人的（404，和不存在一样，对方原样不动）", async () => {
  for (const route of ["GET /tenant/v1/drivers", "POST /tenant/v1/drivers", "GET /tenant/v1/drivers/:id", "PUT /tenant/v1/drivers/:id", "DELETE /tenant/v1/drivers/:id", "GET /tenant/v1/vehicles", "POST /tenant/v1/vehicles", "GET /tenant/v1/vehicles/:id", "PUT /tenant/v1/vehicles/:id", "DELETE /tenant/v1/vehicles/:id"]) cover(route);
  const seeded = await seedFleet();
  const owners = await api.db.owner.query<{ id: string; tenant_id: string }>("select id, tenant_id from drivers union all select id, tenant_id from vehicles");
  const ownerOf = new Map(owners.rows.map((row) => [row.id, row.tenant_id]));
  assert.deepEqual([ownerOf.get(seeded.a.driverId), ownerOf.get(seeded.b.vehicleId)], [a.tenantId, b.tenantId]);
  for (const path of ["drivers", "vehicles"]) {
    const list = await api.call("GET", `/tenant/v1/${path}?tenant_id=${b.tenantId}`, { token: a.adminToken });
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.items.map((item: { id: string }) => item.id), [path === "drivers" ? seeded.a.driverId : seeded.a.vehicleId]);
  }
  const before = await fleetRows();
  for (const [path, id] of [["drivers", seeded.b.driverId], ["vehicles", seeded.b.vehicleId]] as const) {
    const body = path === "drivers" ? { name: "被甲改了", phone: "+819000001111", languages: ["ja"], license_expires_on: "2030-01-01", status: "disabled" } : { plate: "x", vehicle_group_id: seeded.vehicleGroupId, model: "x", seats: 7, mileage_km: 1, plate_type: "business", insurance_expires_on: "2030-01-01", inspection_expires_on: "2030-01-01", status: "disabled" };
    for (const [method, extra] of [["GET", {}], ["PUT", { headers: { "if-match": '"1"' }, body }], ["DELETE", {}]] as const) {
      const foreign = await api.call(method, `/tenant/v1/${path}/${id}`, { token: a.adminToken, ...extra });
      const missing = await api.call(method, `/tenant/v1/${path}/${NO_SUCH_ID}`, { token: a.adminToken, ...extra });
      assert.equal(foreign.status, 404, `${method} ${path}`);
      assert.equal(foreign.text, missing.text);
    }
  }
  assert.deepEqual(await fleetRows(), before);
  const seen = await withTenantTx(api.db.pool, a.tenantId, async (db) => [(await db.query("select id from drivers")).rows.length, (await db.query("select id from vehicles")).rows.length, (await db.query("update drivers set name = 'x' where id = $1", [seeded.b.driverId])).rowCount]);
  assert.deepEqual(seen, [1, 1, 0], "数据库层面也只看得到、改得到自己的");
  await assert.rejects(withTenantTx(api.db.pool, a.tenantId, (db) => db.query("delete from drivers where id = $1", [seeded.a.driverId])), deniedByDatabase, "司机不能删，只能停用");
});

test("派车：别的供应商的单看不到可派资源、派不了、生成 / 吊销不了链接、回传不了状态、看不到照片；自己的单也派不了别人的司机和车辆", async () => {
  for (const route of ["GET /tenant/v1/orders/:id/assignable", "POST /tenant/v1/orders/:id/assign", "POST /tenant/v1/orders/:id/driver-link", "DELETE /tenant/v1/orders/:id/driver-link", "POST /tenant/v1/orders/:id/events", "GET /tenant/v1/orders/:id/files/:fileId"]) cover(route);
  const seeded = await seedFleet();
  const ids = await orderIds();
  const version = async (who: TenantFixture, id: string): Promise<number> => (await api.call("GET", `/tenant/v1/orders/${id}`, { token: who.adminToken })).body.order.version;
  // 乙给自己的单派车，司机上传一张照片
  const bAssigned = await api.call("POST", `/tenant/v1/orders/${ids.b}/assign`, { token: b.adminToken, headers: { "if-match": `"${await version(b, ids.b)}"` }, body: { driver_id: seeded.b.driverId, vehicle_id: seeded.b.vehicleId } });
  assert.equal(bAssigned.status, 200, bAssigned.text);
  const photo = await api.app.inject({ method: "POST", url: "/driver/v1/trip/files?kind=signboard", headers: { authorization: `Bearer ${bAssigned.body.driver_link.token}`, "content-type": "image/jpeg" }, payload: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(32)]) });
  assert.equal(photo.statusCode, 201, photo.body);
  const fileId = photo.json().file.id as string;
  const bBefore = (await api.db.owner.query("select status, driver_id, vehicle_id, version from orders where id = $1", [ids.b])).rows[0];
  const attempts = [
    ["GET", `/tenant/v1/orders/${ids.b}/assignable`, {}],
    ["POST", `/tenant/v1/orders/${ids.b}/assign`, { headers: { "if-match": `"${bBefore.version}"` }, body: { driver_id: seeded.a.driverId, vehicle_id: seeded.a.vehicleId, tenant_id: b.tenantId } }],
    ["POST", `/tenant/v1/orders/${ids.b}/driver-link`, {}],
    ["DELETE", `/tenant/v1/orders/${ids.b}/driver-link`, {}],
    ["POST", `/tenant/v1/orders/${ids.b}/events`, { body: { type: "departed" } }],
    ["GET", `/tenant/v1/orders/${ids.b}/files/${fileId}`, {}],
  ] as const;
  for (const [method, url, extra] of attempts) {
    const foreign = await api.call(method, url, { token: a.adminToken, ...extra });
    const missing = await api.call(method, url.replace(ids.b, NO_SUCH_ID), { token: a.adminToken, ...extra });
    assert.equal(foreign.status, 404, `${method} ${url}`);
    assert.equal(foreign.text, missing.text, `${method} ${url}`);
  }
  assert.equal((await api.call("GET", `/tenant/v1/orders/${ids.a}/files/${fileId}`, { token: a.adminToken })).status, 404, "把乙的照片编号挂到自己的单上也看不到");
  assert.deepEqual((await api.db.owner.query("select status, driver_id, vehicle_id, version from orders where id = $1", [ids.b])).rows[0], bBefore, "乙的单原样不动");
  assert.equal((await api.call("GET", "/driver/v1/trip", { token: bAssigned.body.driver_link.token })).status, 200, "乙的司机链接照常能用");
  // 甲给自己的单派乙的司机和车辆：和不存在一样被拒
  const mixed = await api.call("POST", `/tenant/v1/orders/${ids.a}/assign`, { token: a.adminToken, headers: { "if-match": `"${await version(a, ids.a)}"` }, body: { driver_id: seeded.b.driverId, vehicle_id: seeded.b.vehicleId } });
  assert.deepEqual([mixed.status, mixed.body.error.details.issues.map((issue: { path: string }) => issue.path)], [400, ["/driver_id", "/vehicle_id"]]);
  // 数据库层面：甲的租户事务改不了乙的单，也写不进乙名下的派车记录、照片、链接；自己的单也只能改派车和履约的列
  assert.equal((await withTenantTx(api.db.pool, a.tenantId, (db) => db.query("update orders set status = 'cancelled' where id = $1", [ids.b]))).rowCount, 0);
  await assert.rejects(withTenantTx(api.db.pool, a.tenantId, (db) => db.query("update orders set settlement_minor = 1 where id = $1", [ids.a])), deniedByDatabase, "结算价只有平台能改");
  await assert.rejects(withTenantTx(api.db.pool, a.tenantId, (db) => db.query("update orders set passenger = '{}'::jsonb where id = $1", [ids.a])), deniedByDatabase);
  await assert.rejects(withTenantTx(api.db.pool, a.tenantId, (db) => db.query("update orders set guest_landed_at = now() where id = $1", [ids.a])), deniedByDatabase, "客人确认的落地时间只能从渠道接口来");
  await assert.rejects(
    withTenantTx(api.db.pool, a.tenantId, (db) => db.query("insert into order_assignments (tenant_id, order_id, driver_id, vehicle_id, is_change, assigned_at, actor_type) values ($1, $2, $3, $4, false, now(), 'tenant_user')", [b.tenantId, ids.b, seeded.b.driverId, seeded.b.vehicleId])),
    deniedByDatabase,
  );
  for (const table of ["order_assignments", "driver_links", "order_files", "order_contacts", "order_locations", "order_no_show_claims"]) {
    assert.equal((await withTenantTx(api.db.pool, a.tenantId, (db) => db.query(`select 1 from ${table} where tenant_id = $1`, [b.tenantId]))).rowCount, 0, table);
  }
});

test("Webhook：设置、密钥、测试事件、投递记录、重推都只对令牌所属的供应商；看不到、重推不了别人的投递（404，和不存在一样）", async () => {
  for (const route of ["GET /tenant/v1/webhooks", "PUT /tenant/v1/webhooks", "DELETE /tenant/v1/webhooks", "POST /tenant/v1/webhooks/rotate-secret", "POST /tenant/v1/webhooks/test", "GET /tenant/v1/webhooks/deliveries", "GET /tenant/v1/webhooks/deliveries/:id", "POST /tenant/v1/webhooks/deliveries/:id/retry"]) cover(route);
  const bSaved = await api.call("PUT", "/tenant/v1/webhooks", { token: b.adminToken, body: { url: "https://dispatch.b.example.com/hook", events: ["order.assigned"], tenant_id: a.tenantId } });
  assert.equal(bSaved.status, 201, bSaved.text);
  const bRow = (await api.db.owner.query<{ tenant_id: string }>("select tenant_id from tenant_webhooks")).rows;
  assert.deepEqual(bRow.map((row) => row.tenant_id), [b.tenantId], "请求体的 tenant_id 不生效");
  const delivery = (await api.db.owner.query<{ id: string }>("insert into webhook_deliveries (tenant_id, event_id, event_type, status, failed_at, created_at) values ($1, 'evt_isolation000000000000000', 'order.assigned', 'failed', now(), now()) returning id", [b.tenantId])).rows[0]!.id;
  assert.equal((await api.call("GET", "/tenant/v1/webhooks", { token: a.adminToken })).body.webhook, null, "甲看不到乙的设置");
  assert.equal((await api.call("POST", "/tenant/v1/webhooks/rotate-secret", { token: a.adminToken })).status, 404);
  assert.equal((await api.call("POST", "/tenant/v1/webhooks/test", { token: a.adminToken })).status, 404);
  assert.equal((await api.call("DELETE", "/tenant/v1/webhooks", { token: a.adminToken })).status, 404);
  assert.deepEqual((await api.call("GET", `/tenant/v1/webhooks/deliveries?tenant_id=${b.tenantId}`, { token: a.adminToken })).body.items, []);
  for (const [method, url] of [["GET", `/tenant/v1/webhooks/deliveries/${delivery}`], ["POST", `/tenant/v1/webhooks/deliveries/${delivery}/retry`]] as const) {
    const foreign = await api.call(method, url, { token: a.adminToken });
    assert.equal(foreign.status, 404);
    assert.equal(foreign.text, (await api.call(method, url.replace(delivery, NO_SUCH_ID), { token: a.adminToken })).text);
  }
  const aSaved = await api.call("PUT", "/tenant/v1/webhooks", { token: a.adminToken, body: { url: "https://dispatch.a.example.com/hook", events: ["order.confirmed"] } });
  assert.equal(aSaved.status, 201, "甲建自己的，不碰乙的");
  assert.notEqual(aSaved.body.secret, bSaved.body.secret);
  const rows = (await api.db.owner.query<{ tenant_id: string; url: string; status: string }>("select w.tenant_id, w.url, d.status from tenant_webhooks w left join webhook_deliveries d on d.tenant_id = w.tenant_id order by w.url")).rows;
  assert.deepEqual(rows, [{ tenant_id: a.tenantId, url: "https://dispatch.a.example.com/hook", status: null }, { tenant_id: b.tenantId, url: "https://dispatch.b.example.com/hook", status: "failed" }]);
  assert.equal((await withTenantTx(api.db.pool, a.tenantId, (db) => db.query("select 1 from tenant_webhooks where tenant_id = $1 union all select 1 from webhook_deliveries where tenant_id = $1", [b.tenantId]))).rowCount, 0);
  await assert.rejects(withTenantTx(api.db.pool, a.tenantId, (db) => db.query("insert into webhook_deliveries (tenant_id, event_id, event_type, status, next_attempt_at, created_at) values ($1, 'evt_isolation111111111111111', 'order.assigned', 'pending', now(), now())", [b.tenantId])), deniedByDatabase);
  // 乙的密钥：甲的租户事务里连密文都读不到
  assert.equal((await withTenantTx(api.db.pool, a.tenantId, (db) => db.query("select secret_ciphertext from tenant_webhooks"))).rows.length, 1);
});

test("平台令牌进不了租户接口，租户令牌进不了平台接口", async () => {
  for (const route of api.app.registeredRoutes) {
    if (route.method === "HEAD") continue;
    const url = route.path.replace(":id", b.tenantId);
    const isPublic = /\/auth\/(login|accept-invite|reset-password|check-invite|check-reset-token)$/.test(route.path);
    if (route.path.startsWith("/tenant/v1/") && !isPublic) {
      const res = await api.call(route.method as "GET", url, { token: platformToken, body: {} });
      assert.equal(res.status, 401, `平台令牌访问 ${route.method} ${route.path}`);
      assert.equal(res.body.error.code, "UNAUTHENTICATED");
    }
    if (route.path.startsWith("/platform/v1/") && !isPublic) {
      const res = await api.call(route.method as "GET", url, { token: a.adminToken, body: {} });
      assert.equal(res.status, 401, `租户令牌访问 ${route.method} ${route.path}`);
    }
  }
  assert.equal((await api.call("GET", `/platform/v1/tenants/${b.tenantId}`, { token: a.adminToken })).status, 401);
});

test("GET /tenant/v1/fx-rates：汇率是平台数据，两个供应商看到的一样，请求里带别人的 tenant_id 也一样；租户在数据库里只能读汇率，读不到拉取记录、写不了汇率", async () => {
  cover("GET /tenant/v1/fx-rates");
  const fetchId = (await api.db.owner.query<{ id: string }>("insert into fx_fetches (started_at, finished_at, trigger, source, status, source_as_of) values (now(), now(), 'schedule', 'fx.test', 'accepted', now()) returning id")).rows[0]?.id;
  await api.db.owner.query("insert into fx_rates (base, quote, rate, as_of, fetched_at, source, fetch_id) values ('USD', 'JPY', 150.5, now(), now(), 'fx.test', $1), ('USD', 'CNY', 7.2, now(), now(), 'fx.test', $1)", [fetchId]);
  const fromA = await api.call("GET", `/tenant/v1/fx-rates?base=JPY&tenant_id=${b.tenantId}`, { token: a.adminToken });
  const fromB = await api.call("GET", "/tenant/v1/fx-rates?base=JPY", { token: b.adminToken });
  assert.equal(fromA.status, 200, fromA.text);
  assert.deepEqual(fromA.body, fromB.body);
  assert.equal(fromA.body.rates.find((item: { currency: string }) => item.currency === "CNY").rate, "0.047840531561");
  assert.doesNotMatch(fromA.text, /buffer|markup|sell|tenant/i);
  await assert.rejects(withTenantTx(api.db.pool, a.tenantId, (db) => db.query("select * from fx_fetches")), deniedByDatabase);
  await assert.rejects(withTenantTx(api.db.pool, a.tenantId, (db) => db.query("update fx_rates set rate = 1")), deniedByDatabase);
  await assert.rejects(withTenantTx(api.db.pool, a.tenantId, (db) => db.query("delete from fx_rates")), deniedByDatabase);
  await assert.rejects(withTenantTx(api.db.pool, a.tenantId, (db) => db.query("insert into fx_rates (base, quote, rate, as_of, fetched_at, source, fetch_id) values ('USD', 'KRW', 1, now(), now(), 'x', $1)", [fetchId])), deniedByDatabase);
  assert.equal((await withTenantTx(api.db.pool, a.tenantId, (db) => db.query<{ n: number }>("select count(*)::int as n from fx_rates"))).rows[0]?.n, 2);
});

test("/tenant/v1 的每个接口都在本文件里做过跨租户验证", () => {
  const registered = api.app.registeredRoutes
    .filter((r) => r.method !== "HEAD" && r.path.startsWith("/tenant/v1/"))
    .map((r) => `${r.method} ${r.path}`)
    .sort();
  assert.deepEqual([...covered].sort(), registered);
});

test("规则 4：/tenant/v1 的返回里没有对外价和加价比例相关的字段", async () => {
  const responses = [
    await api.call("GET", "/tenant/v1/auth/me", { token: a.adminToken }),
    await api.call("GET", "/tenant/v1/users", { token: a.adminToken }),
    await api.call("POST", "/tenant/v1/auth/login", { body: { email: "admin@a.test", password: TEST_PASSWORD } }),
    ...(await Promise.all(MASTER_PATHS.map((path) => api.call("GET", `/tenant/v1/master/${path}?status=all`, { token: a.adminToken })))),
    await api.call("GET", "/tenant/v1/brands", { token: a.adminToken }),
    await api.call("GET", "/tenant/v1/products", { token: a.adminToken }),
    await api.call("GET", "/tenant/v1/price-overview", { token: a.adminToken }),
    await api.call("GET", "/tenant/v1/fx-rates", { token: a.adminToken }),
    await api.call("GET", "/tenant/v1/orders", { token: a.adminToken }),
    await api.call("GET", "/tenant/v1/company", { token: a.adminToken }),
    await api.call("GET", "/tenant/v1/performance", { token: a.adminToken }),
    await api.call("GET", "/tenant/v1/drivers", { token: a.adminToken }),
    await api.call("GET", "/tenant/v1/vehicles", { token: a.adminToken }),
    await api.call("GET", "/tenant/v1/webhooks", { token: a.adminToken }),
    await api.call("GET", "/tenant/v1/webhooks/deliveries", { token: a.adminToken }),
    ...(await Promise.all((await api.call("GET", "/tenant/v1/orders", { token: a.adminToken })).body.items.map((item: { id: string }) => api.call("GET", `/tenant/v1/orders/${item.id}`, { token: a.adminToken })))),
  ];
  for (const res of responses) assert.doesNotMatch(res.text, /markup|sell_price|selling_price|public_price|对外价|加价/i);
});
