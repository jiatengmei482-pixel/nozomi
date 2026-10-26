/**
 * 测试角色补充（M4-05，ADR 0030）：IP 白名单的边界，真实 PostgreSQL。
 * /32、/128 的相邻地址、/0、映射地址；名单变更（员工的、角色的）对已登录的令牌立即生效；
 * IP 检查排在两步验证之前；TRUST_PROXY_HOPS=1 时客户端在 X-Forwarded-For 前面伪造的地址无效；改自己的名单时映射地址也算当前地址。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { type ApiResponse, TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { ok } from "./testing/market.ts";
import { totpAt } from "./testing/totp.ts";

const ROOT_IP = "192.0.2.10";
const OFFICE = "203.0.113.";
const HOME = "198.51.100.";

let api: TestApi;
let root: string;
let root2: string;

before(async () => {
  api = await createTestApi();
  await api.superAdminToken("root@platform.test");
  root = (await ok(api.platformLogin({ ip: ROOT_IP, body: { email: "root@platform.test", password: TEST_PASSWORD } }))).access_token;
  const id = await addStaff("root2@platform.test", "super_admin");
  assert.ok(id);
  root2 = (await ok(api.platformLogin({ ip: ROOT_IP, body: { email: "root2@platform.test", password: TEST_PASSWORD } }))).access_token;
});
after(() => api.close());

async function addStaff(email: string, role = "readonly"): Promise<string> {
  const invited = await ok(api.call("POST", "/platform/v1/staff", { token: root, ip: ROOT_IP, body: { email, name: email.split("@")[0], role } }), 201);
  await ok(api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
  return invited.user.id as string;
}

const setAllowlist = (id: string, list: string[], token = root, ip = ROOT_IP): Promise<ApiResponse> => api.call("PATCH", `/platform/v1/staff/${id}`, { token, ip, body: { ip_allowlist: list } });
const login = (email: string, ip: string): Promise<ApiResponse> => api.platformLogin({ ip, body: { email, password: TEST_PASSWORD } });

test("/32 与 /128：只放行这一个地址，相邻的地址都不行；名单里写映射形式的单个地址存成 IPv4 的 /32", async () => {
  const id = await addStaff("single@platform.test");
  const saved = await ok(setAllowlist(id, [`${OFFICE}5`, "2001:db8::5/128", `::ffff:${HOME}9`]));
  assert.deepEqual(saved.ip_allowlist, [`${OFFICE}5/32`, "2001:db8::5/128", `${HOME}9/32`]);
  for (const ip of [`${OFFICE}5`, `::ffff:${OFFICE}5`, "2001:db8::5", "2001:DB8:0:0:0:0:0:5", `${HOME}9`]) assert.equal((await login("single@platform.test", ip)).status, 200, ip);
  for (const ip of [`${OFFICE}4`, `${OFFICE}6`, "2001:db8::4", "2001:db8::6", `${HOME}8`, `${HOME}10`, "::5", `::${OFFICE}5`]) {
    const res = await login("single@platform.test", ip);
    assert.equal(res.status, 403, ip);
    assert.equal(res.body.error.code, "IP_NOT_ALLOWED", ip);
  }
});

test("/0：0.0.0.0/0 放行所有 IPv4（含映射写法），IPv6 来源不在内；::/0 放行所有 IPv6", async () => {
  const id = await addStaff("everything@platform.test");
  await ok(setAllowlist(id, ["0.0.0.0/0"]));
  for (const ip of ["0.0.0.0", "255.255.255.255", `::ffff:${HOME}1`]) assert.equal((await login("everything@platform.test", ip)).status, 200, ip);
  assert.equal((await login("everything@platform.test", "2001:db8::1")).status, 403);
  await ok(setAllowlist(id, ["::/0"]));
  assert.equal((await login("everything@platform.test", "2001:db8::1")).status, 200);
  assert.equal((await login("everything@platform.test", "::1")).status, 200);
});

test("员工的名单变更对已经登录的令牌立即生效：加上就挡、清空就放（同一个令牌，会话不用重建）", async () => {
  const id = await addStaff("live@platform.test");
  const token = (await ok(login("live@platform.test", `${HOME}30`))).access_token as string;
  assert.equal((await api.call("GET", "/platform/v1/tenants", { token, ip: `${HOME}30` })).status, 200);
  await ok(setAllowlist(id, [`${OFFICE}0/24`]));
  const blocked = await api.call("GET", "/platform/v1/tenants", { token, ip: `${HOME}30` });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, "IP_NOT_ALLOWED");
  assert.equal((await api.call("GET", "/platform/v1/tenants", { token, ip: `${OFFICE}30` })).status, 200, "换到名单内的地址就能用");
  await ok(setAllowlist(id, []));
  assert.equal((await api.call("GET", "/platform/v1/tenants", { token, ip: `${HOME}30` })).status, 200, "清空后立即放行");
});

test("角色的名单经复核修改后，对这个角色已登录的员工立即生效；员工自己有名单时以员工的为准", async () => {
  const role = await ok(api.call("POST", "/platform/v1/roles", { token: root, ip: ROOT_IP, body: { name: "外勤", grants: ["orders:view"] } }), 201);
  await addStaff("field@platform.test", role.key);
  const pinnedId = await addStaff("pinned@platform.test", role.key);
  await ok(setAllowlist(pinnedId, [`${HOME}0/24`]));
  const field = (await ok(login("field@platform.test", `${HOME}40`))).access_token as string;
  const pinned = (await ok(login("pinned@platform.test", `${HOME}41`))).access_token as string;
  assert.equal((await api.call("GET", "/platform/v1/orders", { token: field, ip: `${HOME}40` })).status, 200);

  const requested = await ok(api.call("POST", `/platform/v1/roles/${role.key}/changes`, { token: root, ip: ROOT_IP, body: { name: "外勤", grants: ["orders:view"], ip_allowlist: [`${OFFICE}0/24`] } }), 202);
  assert.equal((await api.call("GET", "/platform/v1/orders", { token: field, ip: `${HOME}40` })).status, 200, "发起不生效");
  await ok(api.call("POST", `/platform/v1/approvals/${requested.approval.id}/approve`, { token: root2, ip: ROOT_IP, body: {} }));
  const blocked = await api.call("GET", "/platform/v1/orders", { token: field, ip: `${HOME}40` });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, "IP_NOT_ALLOWED");
  assert.equal((await api.call("GET", "/platform/v1/orders", { token: field, ip: `${OFFICE}40` })).status, 200);
  assert.equal((await api.call("GET", "/platform/v1/orders", { token: pinned, ip: `${HOME}41` })).status, 200, "员工自己的名单优先，不受角色名单影响");
  assert.equal((await api.call("GET", "/platform/v1/orders", { token: pinned, ip: `${OFFICE}41` })).status, 403);
});

test("IP 检查排在两步验证之前：名单外拿着待验证的令牌输入动态码 403 IP_NOT_ALLOWED，且这个码没有被用掉", async () => {
  const id = await addStaff("order-of-checks@platform.test");
  await ok(login("order-of-checks@platform.test", `${OFFICE}50`));
  const secret = api.totpSecret("order-of-checks@platform.test") as string;
  await ok(setAllowlist(id, [`${OFFICE}0/24`]));
  api.clock.advance(30_000);
  const pending = await ok(api.call("POST", "/platform/v1/auth/login", { ip: `${OFFICE}51`, body: { email: "order-of-checks@platform.test", password: TEST_PASSWORD } }));
  const code = totpAt(secret, api.clock.now());
  const outside = await api.call("POST", "/platform/v1/auth/mfa/verify", { token: pending.access_token, ip: `${HOME}51`, body: { code } });
  assert.equal(outside.status, 403);
  assert.equal(outside.body.error.code, "IP_NOT_ALLOWED");
  assert.equal((await api.call("POST", "/platform/v1/auth/mfa/enrollment", { token: pending.access_token, ip: `${HOME}51`, body: {} })).body.error.code, "IP_NOT_ALLOWED");
  assert.equal((await api.call("GET", "/platform/v1/tenants", { token: pending.access_token, ip: `${HOME}51` })).body.error.code, "IP_NOT_ALLOWED", "不是 MFA_REQUIRED");
  const inside = await api.call("POST", "/platform/v1/auth/mfa/verify", { token: pending.access_token, ip: `${OFFICE}51`, body: { code } });
  assert.equal(inside.status, 200, inside.text);
});

test("TRUST_PROXY_HOPS=1：客户端在 X-Forwarded-For 前面伪造名单内的地址无效，按代理追加的最后一跳判断", async () => {
  const behind = await createTestApi({ env: { TRUST_PROXY_HOPS: "1" } });
  try {
    await behind.superAdminToken("boss@platform.test");
    await behind.db.owner.query("update platform_users set ip_allowlist = $1 where email = 'boss@platform.test'", [[`${OFFICE}0/24`]]);
    const forged = await behind.call("POST", "/platform/v1/auth/login", { ip: "10.0.0.2", headers: { "x-forwarded-for": `${OFFICE}7, ${HOME}7` }, body: { email: "boss@platform.test", password: TEST_PASSWORD } });
    assert.equal(forged.status, 403, forged.text);
    assert.equal(forged.body.error.code, "IP_NOT_ALLOWED");
    const audit = await behind.db.owner.query("select ip from audit_logs where action = 'login_failed' order by id desc limit 1");
    assert.equal(audit.rows[0].ip, `${HOME}7`, "审计记的是真实来源");
    const real = await behind.platformLogin({ ip: "10.0.0.2", headers: { "x-forwarded-for": `${HOME}7, ${OFFICE}7` }, body: { email: "boss@platform.test", password: TEST_PASSWORD } });
    assert.equal(real.status, 200, real.text);
    const token = real.body.access_token as string;
    const moved = await behind.call("GET", "/platform/v1/tenants", { token, ip: "10.0.0.2", headers: { "x-forwarded-for": `${OFFICE}7, ${HOME}8` } });
    assert.equal(moved.status, 403, "已登录的请求同样按最后一跳");
    const noHeader = await behind.call("GET", "/platform/v1/tenants", { token, ip: `${OFFICE}9` });
    assert.equal(noHeader.status, 200, "没有请求头时就是连接地址");
  } finally {
    await behind.close();
  }
});

test("改自己的名单：当前地址是映射写法时，名单里的 IPv4 写法也算包含当前地址；IPv6 来源配只有 IPv4 的名单 409", async () => {
  const meId = (await ok(api.call("GET", "/platform/v1/auth/me", { token: root, ip: ROOT_IP }))).user.id as string;
  const mapped = await setAllowlist(meId, [`${ROOT_IP}`], root, `::ffff:${ROOT_IP}`);
  assert.equal(mapped.status, 200, mapped.text);
  assert.equal((await api.call("GET", "/platform/v1/tenants", { token: root, ip: ROOT_IP })).status, 200);
  const v6 = await setAllowlist(meId, [`${ROOT_IP}/32`, `${OFFICE}0/24`], root, ROOT_IP);
  assert.equal(v6.status, 200);
  await ok(setAllowlist(meId, []));
  const v6root = await ok(login("root2@platform.test", "2001:db8::10"));
  const root2Id = (await ok(api.call("GET", "/platform/v1/auth/me", { token: v6root.access_token, ip: "2001:db8::10" }))).user.id as string;
  const lockout = await setAllowlist(root2Id, ["0.0.0.0/0"], v6root.access_token, "2001:db8::10");
  assert.equal(lockout.status, 409);
  assert.equal(lockout.body.error.code, "IP_ALLOWLIST_EXCLUDES_CURRENT");
  assert.equal((await api.db.owner.query("select ip_allowlist from platform_users where id = $1", [root2Id])).rows[0].ip_allowlist.length, 0, "被拒时名单没变");
  // 改别人的名单不受「当前地址」限制
  const otherId = await addStaff("far@platform.test");
  assert.equal((await setAllowlist(otherId, [`${OFFICE}0/24`])).status, 200);
});
