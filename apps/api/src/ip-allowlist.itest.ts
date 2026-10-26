/**
 * 平台员工的 IP 白名单（M4-05，ADR 0030），真实 PostgreSQL：
 * 按员工、按角色（员工自己的优先）；IPv4 / IPv6 / IPv4 映射地址；登录时（密码正确之后）和之后每个请求都检查；
 * 来源地址遵循 TRUST_PROXY_HOPS（默认不看 X-Forwarded-For）；不把自己锁在门外；命令行救急。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { type ApiResponse, TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { ok } from "./testing/market.ts";
import { assertMatchesOperation } from "./testing/openapi.ts";
import { testEnv } from "./testing/fixtures.ts";
import { exitWithin, startNode } from "./testing/process.ts";

const OFFICE = "203.0.113.";
const HOME = "198.51.100.";
const ROOT_IP = "192.0.2.10";

let api: TestApi;
let root: string;

before(async () => {
  api = await createTestApi();
  await api.superAdminToken("root@platform.test");
  root = (await ok(api.platformLogin({ ip: ROOT_IP, body: { email: "root@platform.test", password: TEST_PASSWORD } }))).access_token;
});
after(() => api.close());

async function addStaff(email: string, role = "readonly"): Promise<string> {
  const invited = await ok(api.call("POST", "/platform/v1/staff", { token: root, ip: ROOT_IP, body: { email, name: email.split("@")[0], role } }), 201);
  await ok(api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
  return invited.user.id as string;
}

const setAllowlist = (id: string, list: string[], token = root, ip = ROOT_IP): Promise<ApiResponse> => api.call("PATCH", `/platform/v1/staff/${id}`, { token, ip, body: { ip_allowlist: list } });
const login = (email: string, ip: string, password = TEST_PASSWORD): Promise<ApiResponse> => api.platformLogin({ ip, body: { email, password } });

test("默认不启用：空名单不限制来源地址", async () => {
  await addStaff("open@platform.test");
  for (const ip of [`${OFFICE}1`, `${HOME}1`, "2001:db8::1", "::ffff:192.0.2.99"]) assert.equal((await login("open@platform.test", ip)).status, 200, ip);
});

test("按员工：名单外登录 403 IP_NOT_ALLOWED 并审计（密码错时仍是 401，不暴露名单）；名单内照常；已登录的令牌换到名单外的地址也被拒", async () => {
  const id = await addStaff("office@platform.test");
  const inside = await login("office@platform.test", `${OFFICE}20`);
  assert.equal(inside.status, 200);
  const saved = await setAllowlist(id, [`${OFFICE}0/24`]);
  assert.equal(saved.status, 200, saved.text);
  assertMatchesOperation("PATCH", "/platform/v1/staff/{id}", saved.status, saved.body);
  assert.deepEqual(saved.body.ip_allowlist, ["203.0.113.0/24"]);

  const outside = await login("office@platform.test", `${HOME}7`);
  assert.equal(outside.status, 403);
  assert.deepEqual(outside.body.error.code, "IP_NOT_ALLOWED");
  const wrong = await login("office@platform.test", `${HOME}7`, "Wrong-Password-000");
  assert.equal(wrong.status, 401, "密码不对时不说名单的事");
  const audit = await api.db.owner.query("select ip, after from audit_logs where action = 'login_failed' and resource_id = $1 order by id", [id]);
  assert.deepEqual(audit.rows.map((r) => [r.ip, r.after.reason]), [[`${HOME}7`, "ip_not_allowed"], [`${HOME}7`, "wrong_password"]]);

  assert.equal((await login("office@platform.test", `${OFFICE}21`)).status, 200);
  const token = inside.body.access_token as string;
  assert.equal((await api.call("GET", "/platform/v1/tenants", { token, ip: `${OFFICE}20` })).status, 200);
  const moved = await api.call("GET", "/platform/v1/tenants", { token, ip: `${HOME}20` });
  assert.equal(moved.status, 403);
  assert.equal(moved.body.error.code, "IP_NOT_ALLOWED");
  assert.equal((await api.call("GET", "/platform/v1/auth/me", { token, ip: `${HOME}20` })).body.error.code, "IP_NOT_ALLOWED", "查看自己也不行");
});

test("IPv6 和 IPv4 映射地址：名单里的 IPv4 段也认 ::ffff: 写法的来源；IPv6 段按前缀匹配", async () => {
  const id = await addStaff("v6@platform.test");
  await ok(setAllowlist(id, ["2001:DB8:abcd::/48", "192.0.2.0/24"]));
  assert.equal((await login("v6@platform.test", "2001:db8:abcd:1::5")).status, 200);
  assert.equal((await login("v6@platform.test", "::ffff:192.0.2.77")).status, 200);
  assert.equal((await login("v6@platform.test", "2001:db8:abce::5")).status, 403);
  assert.equal((await login("v6@platform.test", "::ffff:198.51.100.1")).status, 403);
  const detail = await ok(api.call("GET", `/platform/v1/staff/${id}`, { token: root, ip: ROOT_IP }));
  assert.deepEqual(detail.ip_allowlist, ["2001:db8:abcd::/48", "192.0.2.0/24"]);
  assert.equal(detail.mfa_enabled, true);
});

test("按角色：自建角色的名单对没有自己名单的员工生效；员工自己的名单不空时以员工的为准", async () => {
  const role = await ok(api.call("POST", "/platform/v1/roles", { token: root, ip: ROOT_IP, body: { name: "办公室财务", grants: ["orders:view"], ip_allowlist: [`${OFFICE}0/24`] } }), 201);
  const id = await addStaff("role-list@platform.test", role.key);
  assert.equal((await login("role-list@platform.test", `${HOME}3`)).status, 403);
  assert.equal((await login("role-list@platform.test", `${OFFICE}3`)).status, 200);
  const detail = await ok(api.call("GET", `/platform/v1/staff/${id}`, { token: root, ip: ROOT_IP }));
  assert.deepEqual(detail.role_ip_allowlist, ["203.0.113.0/24"]);
  await ok(setAllowlist(id, [`${HOME}0/24`]));
  assert.equal((await login("role-list@platform.test", `${HOME}3`)).status, 200, "员工自己的名单优先");
  assert.equal((await login("role-list@platform.test", `${OFFICE}3`)).status, 403);
});

test("来源地址遵循 TRUST_PROXY_HOPS：默认 0 时伪造 X-Forwarded-For 换不了来源地址；设为 1 时取代理给的那一跳", async () => {
  const id = await addStaff("proxy@platform.test");
  await ok(setAllowlist(id, [`${OFFICE}0/24`]));
  const spoofed = await api.call("POST", "/platform/v1/auth/login", { ip: `${HOME}9`, headers: { "x-forwarded-for": `${OFFICE}9`, "x-real-ip": `${OFFICE}9` }, body: { email: "proxy@platform.test", password: TEST_PASSWORD } });
  assert.equal(spoofed.status, 403);

  const behind = await createTestApi({ env: { TRUST_PROXY_HOPS: "1" } });
  try {
    await behind.superAdminToken("boss@platform.test");
    const bossId = (await behind.db.owner.query("select id from platform_users where email = 'boss@platform.test'")).rows[0].id as string;
    await behind.db.owner.query("update platform_users set ip_allowlist = $2 where id = $1", [bossId, [`${OFFICE}0/24`]]);
    const viaProxy = await behind.platformLogin({ ip: "10.0.0.2", headers: { "x-forwarded-for": `${OFFICE}44` }, body: { email: "boss@platform.test", password: TEST_PASSWORD } });
    assert.equal(viaProxy.status, 200, viaProxy.text);
    const fromHome = await behind.call("POST", "/platform/v1/auth/login", { ip: "10.0.0.2", headers: { "x-forwarded-for": `${HOME}44` }, body: { email: "boss@platform.test", password: TEST_PASSWORD } });
    assert.equal(fromHome.status, 403);
  } finally {
    await behind.close();
  }
});

test("不把自己锁在门外：改自己的名单时当前地址必须在里面；写错的地址段逐条报出并给出正确写法", async () => {
  const me = (await ok(api.call("GET", "/platform/v1/auth/me", { token: root, ip: ROOT_IP }))).user.id as string;
  const locked = await setAllowlist(me, [`${OFFICE}0/24`]);
  assert.equal(locked.status, 409);
  assert.deepEqual(locked.body.error, { code: "IP_ALLOWLIST_EXCLUDES_CURRENT", message: locked.body.error.message, details: { current_ip: ROOT_IP } });
  assert.equal((await setAllowlist(me, [`${OFFICE}0/24`, "192.0.2.0/24"])).status, 200);
  assert.equal((await api.call("GET", "/platform/v1/tenants", { token: root, ip: ROOT_IP })).status, 200);
  assert.equal((await setAllowlist(me, [])).status, 200, "清空 = 不限制");

  const bad = await setAllowlist(me, ["10.1.2.3/8", "300.1.1.1", "10.0.0.0/8", "::ffff:10.0.0.0/104"]);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, "IP_ALLOWLIST_INVALID");
  assert.deepEqual(bad.body.error.details.issues.map((i: any) => [i.index, i.reason]), [[0, "HOST_BITS_SET"], [1, "INVALID"], [3, "DUPLICATE"]]);
  assert.equal(bad.body.error.details.issues[0].suggestion, "10.0.0.0/8");
  const tooMany = await setAllowlist(me, Array.from({ length: 51 }, (_, i) => `10.0.${i}.0/24`));
  assert.equal(tooMany.status, 400);
  const notAdmin = await api.platformLogin({ ip: `${OFFICE}50`, body: { email: "open@platform.test", password: TEST_PASSWORD } });
  assert.equal((await setAllowlist(me, [], notAdmin.body.access_token, `${OFFICE}50`)).status, 403);
});

test("命令行 pnpm admin:clear-ip-allowlist：清空员工自己的名单，审计记下清掉之前的；不存在的邮箱失败", async () => {
  const id = await addStaff("stuck@platform.test", "super_admin");
  await ok(setAllowlist(id, [`${OFFICE}0/24`]));
  assert.equal((await login("stuck@platform.test", `${HOME}5`)).status, 403);
  const entry = fileURLToPath(new URL("./cli/admin-clear-ip-allowlist.ts", import.meta.url));
  const run = async (args: string[]): Promise<{ code: number | null | "timeout"; output: string }> => {
    const running = startNode(entry, testEnv(api.db.url), args);
    const code = await exitWithin(running, 20_000);
    if (code === "timeout") running.child.kill("SIGKILL");
    return { code, output: running.output() };
  };
  assert.equal((await run(["--email", "ghost@platform.test"])).code, 1);
  const done = await run(["--email", "stuck@platform.test"]);
  assert.equal(done.code, 0, done.output);
  assert.match(done.output, /已清空 stuck@platform\.test 自己的 IP 白名单（原来 1 条）/);
  assert.equal((await login("stuck@platform.test", `${HOME}5`)).status, 200);
  const audit = await api.db.owner.query("select actor_type, source, before, after from audit_logs where action = 'clear_ip_allowlist'");
  assert.deepEqual(audit.rows, [{ actor_type: "system", source: "cli", before: { ip_allowlist: ["203.0.113.0/24"] }, after: { ip_allowlist: [] } }]);
});
