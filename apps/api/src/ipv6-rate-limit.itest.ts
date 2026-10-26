/**
 * M4-11：按来源地址的限流对 IPv6 按 /64 网段计数（ADR 0045）。经真实接口、真实 PostgreSQL。
 * 覆盖每一个按来源地址计数的地方：官网（询价、找回订单、其余读接口）、对外接口换令牌、登录限速的「同一地址」「同一邮箱 + 同一地址」两层。
 * - 同一个 /64 里每次换一个地址，到上限照样 429；别的 /64 不受影响；
 * - IPv4 不变：相邻地址各算各的，映射写法（::ffff:a.b.c.d）和 IPv4 是同一个；
 * - TRUST_PROXY_HOPS=0 时伪造 X-Forwarded-For 换不了来源地址；=1 时客户端在前面伪造的地址无效，按代理追加的那一跳的 /64 计。
 * 每个测试用自己的地址段，互不影响；测试数据都在测试库里，随测试 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@nozomi/config";
import { buildApp } from "./app.ts";
import { loadMigrationFiles } from "./db/migrate.ts";
import { type HttpMethod, type TestApi, createTestApi } from "./testing/api.ts";
import { UNREACHABLE_INTEGRATIONS, testEnv } from "./testing/fixtures.ts";

let api: TestApi;

before(async () => {
  // 登录「同一地址」这一层调低到 3（只有 ci / local 允许改），好在几次请求内测到它
  api = await createTestApi({ env: { LOGIN_MAX_ATTEMPTS_PER_IP: "3" } });
});
after(async () => {
  await api?.close();
});

/** 同一个 /64 里的第 i 个地址：后 64 位每次都不同，写法也轮换（大写、全写、带方括号和端口、区域标识）。 */
function inSlash64(prefix: string, i: number): string {
  const host = `${(i + 1).toString(16)}:${(0xa000 + i).toString(16)}:0:${i + 7}`;
  const forms = [`${prefix}:${host}`, `${prefix}:${host}`.toUpperCase(), `[${prefix}:${host}]:${40000 + i}`, `${prefix}::${(i + 1).toString(16)}%eth0`];
  return forms[i % forms.length] as string;
}

async function hit(app: FastifyInstance, method: HttpMethod, url: string, remoteAddress: string, options: { body?: unknown; headers?: Record<string, string> } = {}): Promise<number> {
  const res = await app.inject({ method, url, remoteAddress, ...(options.headers === undefined ? {} : { headers: options.headers }), ...(options.body === undefined ? {} : { payload: options.body as object }) });
  return res.statusCode;
}

/** 依次发 n 次，返回状态码。 */
async function burst(n: number, send: (i: number) => Promise<number>): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < n; i += 1) statuses.push(await send(i));
  return statuses;
}

/** 在同一个测试库上另起一个应用，带 TRUST_PROXY_HOPS。 */
async function appWith(env: Record<string, string>): Promise<FastifyInstance> {
  return buildApp({
    config: loadConfig({ ...testEnv(api.db.url), ...UNREACHABLE_INTEGRATIONS, ...env }),
    pool: api.db.pool,
    migrationFiles: await loadMigrationFiles(),
    now: api.clock.now,
    logger: false,
  });
}

// 格式不对的请求体：限流先占一次额度，再 400，不需要建任何业务数据
const lookup = (app: FastifyInstance, ip: string, headers?: Record<string, string>) => hit(app, "POST", "/site/v1/orders/lookup", ip, { body: {}, ...(headers === undefined ? {} : { headers }) });

test("官网找回订单（每个地址 15 分钟 10 次）：同一个 /64 里每次换地址、换写法，第 11 次 429；别的 /64 不受影响", async () => {
  const statuses = await burst(11, (i) => lookup(api.app, inSlash64("2001:db8:4110:1", i)));
  assert.deepEqual(statuses, [...Array(10).fill(400), 429]);
  assert.equal(await lookup(api.app, "2001:db8:4110:2::1"), 400, "相邻的 /64 有自己的额度");
  assert.equal(await lookup(api.app, "2001:db8:4110:1:ffff::1"), 429, "回到原来的 /64 仍被挡");
});

test("官网询价（每个地址每分钟 30 次）和其余读接口（每分钟 120 次）同样按 /64 计", async () => {
  const quotes = await burst(31, (i) => hit(api.app, "POST", "/site/v1/quotes", inSlash64("2001:db8:4110:11", i), { body: {} }));
  assert.deepEqual(quotes, [...Array(30).fill(400), 429]);
  assert.equal(await hit(api.app, "POST", "/site/v1/quotes", "2001:db8:4110:12::1", { body: {} }), 400);

  const reads = await burst(121, (i) => hit(api.app, "GET", "/site/v1/config", inSlash64("2001:db8:4110:13", i)));
  assert.deepEqual(reads, [...Array(120).fill(200), 429]);
  assert.equal(await hit(api.app, "GET", "/site/v1/config", "2001:db8:4110:14::1"), 200);
});

test("IPv4 不变：同一个地址第 11 次 429，相邻地址各算各的；映射写法 ::ffff:a.b.c.d 和 IPv4 算同一个地址", async () => {
  const statuses = await burst(11, (i) => lookup(api.app, i % 2 === 0 ? "198.51.100.41" : "::ffff:198.51.100.41"));
  assert.deepEqual(statuses, [...Array(10).fill(400), 429]);
  assert.equal(await lookup(api.app, "198.51.100.42"), 400, "IPv4 不按网段合并");
  assert.equal(await lookup(api.app, "[::ffff:c633:6429]:5000"), 429, "十六进制的映射写法也是同一个地址");
});

test("对外接口换令牌（每个地址每秒 10 次）：同一个 /64 换地址第 11 次 429，别的 /64 不受影响", async () => {
  const token = (ip: string) => hit(api.app, "POST", "/sales/v1/oauth/token", ip, { body: { grant_type: "client_credentials", client_id: "nzc_does_not_exist", client_secret: "wrong" } });
  const statuses = await burst(11, (i) => token(inSlash64("2001:db8:4110:21", i)));
  assert.deepEqual(statuses.slice(10), [429]);
  assert.ok(statuses.slice(0, 10).every((status) => status !== 429), statuses.join(","));
  assert.notEqual(await token("2001:db8:4110:22::1"), 429);
});

test("登录「同一邮箱 + 同一地址 5 次」：同一个 /64 换地址第 6 次 429（邮箱维度是 20 次，挡下它的是地址那一层）；别的 /64 不受影响", async () => {
  // 用默认配置（「同一地址」50 次）的应用，免得本文件调低的那一层先触发
  const app = await appWith({});
  const login = (ip: string) => hit(app, "POST", "/tenant/v1/auth/login", ip, { body: { email: "m411-email-ip@tenant.test", password: "wrong-password" } });
  try {
    const statuses = await burst(6, (i) => login(inSlash64("2001:db8:4110:31", i)));
    assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
    assert.equal(await login("2001:db8:4110:32::1"), 401);
  } finally {
    await app.close();
  }
});

test("登录「同一地址」这一层（本文件调成 3 次）：同一个 /64 里换地址、每次换邮箱，第 4 次 429；别的 /64 不受影响", async () => {
  const login = (ip: string, i: number) => hit(api.app, "POST", "/platform/v1/auth/login", ip, { body: { email: `m411-ip-${i}@platform.test`, password: "wrong-password" } });
  const statuses = await burst(4, (i) => login(inSlash64("2001:db8:4110:41", i), i));
  assert.deepEqual(statuses, [401, 401, 401, 429]);
  assert.equal(await login("2001:db8:4110:42::1", 9), 401);
});

test("TRUST_PROXY_HOPS=0：来源地址是连接本身的 IPv6，每次伪造不同网段的 X-Forwarded-For / Forwarded 也绕不过", async () => {
  const app = await appWith({ TRUST_PROXY_HOPS: "0" });
  try {
    const statuses = await burst(11, (i) =>
      lookup(app, inSlash64("2001:db8:4110:51", i), { "x-forwarded-for": `2001:db8:${(0x5100 + i).toString(16)}::1`, "x-real-ip": `2001:db8:${(0x5200 + i).toString(16)}::1`, forwarded: `for="[2001:db8:${(0x5300 + i).toString(16)}::1]"` }),
    );
    assert.deepEqual(statuses, [...Array(10).fill(400), 429]);
  } finally {
    await app.close();
  }
});

test("TRUST_PROXY_HOPS=1：客户端在 X-Forwarded-For 前面伪造的地址无效；按代理追加的那一跳的 /64 计，换地址绕不过，另一个 /64 的客人有自己的额度", async () => {
  const app = await appWith({ TRUST_PROXY_HOPS: "1" });
  try {
    const proxy = "10.41.1.2";
    const statuses = await burst(11, (i) => lookup(app, proxy, { "x-forwarded-for": `2001:db8:${(0x6100 + i).toString(16)}::1, ${inSlash64("2001:db8:4110:61", i)}` }));
    assert.deepEqual(statuses, [...Array(10).fill(400), 429], "伪造的最左边每次换一个 /64，最后一跳在同一个 /64 里换地址");
    assert.equal(await lookup(app, proxy, { "x-forwarded-for": "2001:db8:4110:62::1" }), 400, "同一个代理后面另一个 /64 的客人不受影响");
    assert.equal(await lookup(app, proxy, { "x-forwarded-for": "2001:db8:4110:61::1, 2001:db8:4110:63::1" }), 400, "伪造被挡的那个 /64 放在前面也不会被算到它头上");
  } finally {
    await app.close();
  }
});
