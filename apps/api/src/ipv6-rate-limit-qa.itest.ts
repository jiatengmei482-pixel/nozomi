/**
 * M4-11 测试角色补测（ADR 0045），经真实接口、真实 PostgreSQL：
 * - 登录「同一邮箱 + 同一地址」：同一 /64 换地址绕不过；换到别的 /64，同一个邮箱仍受「同一邮箱 20 次」那一层限制；
 *   登录成功按整个 /64 清零（占用和清零用的是同一个键）。
 * - 官网下单、凭链接看订单 / 工单（order-center 的 guest）同样按 /64 计。
 * - ADR 说的「上线后 IPv6 计数从零开始，窗口最长 15 分钟」：用旧算法写进表里的计数，IPv4 沿用、IPv6 和映射写法不再生效；
 *   按地址的各个额度窗口都不超过 15 分钟，过了窗口 /64 的计数清零。
 * 每个测试用自己的地址段和邮箱；测试数据都在测试库里，随测试 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { LOGIN_THROTTLE_WINDOW_MS } from "@nozomi/domain";
import { loadConfig } from "@nozomi/config";
import { buildApp } from "./app.ts";
import { withPlatformTx, withPreAuthTx } from "./db/context.ts";
import { loadMigrationFiles } from "./db/migrate.ts";
import { SALES_RATE_LIMITS } from "./services/rate-limit.ts";
import { type HttpMethod, TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { UNREACHABLE_INTEGRATIONS, testEnv } from "./testing/fixtures.ts";

let api: TestApi;
/** 「同一地址」50 次的默认配置，免得地址那一层先于邮箱那一层触发 */
let app: FastifyInstance;

before(async () => {
  api = await createTestApi();
  app = await buildApp({
    config: loadConfig({ ...testEnv(api.db.url), ...UNREACHABLE_INTEGRATIONS }),
    pool: api.db.pool,
    migrationFiles: await loadMigrationFiles(),
    now: api.clock.now,
    logger: false,
  });
});
after(async () => {
  await app?.close();
  await api?.close();
});

/** 同一个 /64 里的第 i 个地址，后 64 位和写法每次都不同。 */
function inSlash64(prefix: string, i: number): string {
  const host = `${(i + 3).toString(16)}:${(0xb000 + i).toString(16)}:${i}:${i + 11}`;
  const forms = [`${prefix}:${host}`, `${prefix}:${host}`.toUpperCase(), `[${prefix}:${host}]:${50000 + i}`, `${prefix}::${(i + 2).toString(16)}%25eth0`];
  return forms[i % forms.length] as string;
}

async function hit(target: FastifyInstance, method: HttpMethod, url: string, remoteAddress: string, options: { body?: unknown; headers?: Record<string, string> } = {}): Promise<number> {
  const res = await target.inject({ method, url, remoteAddress, ...(options.headers === undefined ? {} : { headers: options.headers }), ...(options.body === undefined ? {} : { payload: options.body as object }) });
  return res.statusCode;
}

async function burst(n: number, send: (i: number) => Promise<number>): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < n; i += 1) statuses.push(await send(i));
  return statuses;
}

const tenantLogin = (ip: string, email: string, password = "wrong-password") => hit(app, "POST", "/tenant/v1/auth/login", ip, { body: { email, password } });
const lookup = (ip: string) => hit(api.app, "POST", "/site/v1/orders/lookup", ip, { body: {} });

test("登录：同一个邮箱换到不同的 /64，每个 /64 各 5 次（同一邮箱 + 同一地址），合计满 20 次后第 5 个 /64 也被「同一邮箱」那一层挡下；换个邮箱不受影响", async () => {
  const email = "m411-qa-spread@tenant.test";
  for (const [n, prefix] of ["2001:db8:4111:a1", "2001:db8:4111:a2", "2001:db8:4111:a3", "2001:db8:4111:a4"].entries()) {
    const statuses = await burst(5, (i) => tenantLogin(inSlash64(prefix, i), email));
    assert.deepEqual(statuses, [401, 401, 401, 401, 401], `第 ${n + 1} 个 /64`);
  }
  assert.equal(await tenantLogin("2001:db8:4111:a5::1", email), 429, "第 21 次：新的 /64 也挡，挡它的是「同一邮箱」");
  assert.equal(await tenantLogin("2001:db8:4111:a5::2", "m411-qa-other@tenant.test"), 401, "同一个 /64 换个邮箱照常验证——不是地址那一层");
});

test("登录：同一 /64 里第 6 次被挡后，换到这个 /64 的别的地址、换写法都还是 429；别的 /64 同一个邮箱还能试", async () => {
  const email = "m411-qa-same64@tenant.test";
  assert.deepEqual(await burst(6, (i) => tenantLogin(inSlash64("2001:db8:4111:b1", i), email)), [401, 401, 401, 401, 401, 429]);
  for (const ip of ["2001:DB8:4111:B1:FFFF:FFFF:FFFF:FFFF", "[2001:0db8:4111:00b1::abcd]:1", "2001:db8:4111:b1::1.2.3.4", "2001:db8:4111:b1::"]) {
    assert.equal(await tenantLogin(ip, email), 429, ip);
  }
  assert.equal(await tenantLogin("2001:db8:4111:b2::1", email), 401);
});

test("登录成功按整个 /64 清零：同一 /64 的另一个地址失败 4 次，再从第三个地址登录成功，之后又能失败 5 次", async () => {
  const root = await api.superAdminToken("m411-qa-root@platform.test");
  const tenant = await api.tenantWithAdmin(root, "M4-11 补测车队", "m411-qa-admin@tenant.test");
  const email = tenant.adminEmail;
  const prefix = "2001:db8:4111:c1";
  assert.deepEqual(await burst(4, (i) => tenantLogin(inSlash64(prefix, i), email)), [401, 401, 401, 401]);
  assert.equal(await tenantLogin(`${prefix}::beef`, email, TEST_PASSWORD), 200);
  assert.deepEqual(await burst(6, (i) => tenantLogin(inSlash64(prefix, i + 20), email)), [401, 401, 401, 401, 401, 429], "清零的是整个 /64 的计数");
});

test("官网下单（每个地址 10 分钟 10 次）：同一 /64 换地址第 11 次 429；别的 /64 不受影响", async () => {
  const order = (ip: string) => hit(api.app, "POST", "/site/v1/orders", ip, { body: {} });
  const statuses = await burst(11, (i) => order(inSlash64("2001:db8:4111:d1", i)));
  assert.ok(statuses.slice(0, 10).every((status) => status !== 429), statuses.join(","));
  assert.equal(statuses[10], 429);
  assert.notEqual(await order("2001:db8:4111:d2::1"), 429);
});

test("凭链接看订单、看工单（site / order-center 两处的 guest）和官网读接口共用一份「每分钟 120 次」，按 /64 计", async () => {
  const prefix = "2001:db8:4111:e1";
  const urls = ["/site/v1/order", "/site/v1/order/tickets", "/site/v1/order/payment", "/site/v1/config"];
  const statuses = await burst(121, (i) => hit(api.app, "GET", urls[i % urls.length] as string, inSlash64(prefix, i)));
  assert.ok(statuses.slice(0, 120).every((status) => status !== 429), statuses.join(","));
  assert.equal(statuses[120], 429);
  assert.equal(await hit(api.app, "GET", "/site/v1/order/tickets", `${prefix}::77`), 429, "工单接口也算在同一个 /64 的额度里");
  assert.notEqual(await hit(api.app, "GET", "/site/v1/order/tickets", "2001:db8:4111:e2::1"), 429);
});

test("ADR「窗口最长 15 分钟」属实：按来源地址的额度窗口都不超过 15 分钟（按订单号的两层不按地址，不在此列）", () => {
  const perAddress = ["token", "site_quote", "site_order", "site_lookup", "site_read", "site_places"] as const;
  const longest = Math.max(...perAddress.map((scope) => SALES_RATE_LIMITS[scope].windowMs), LOGIN_THROTTLE_WINDOW_MS);
  assert.equal(longest, 15 * 60_000);
  // 官网地址搜索每个地址每天的额度（M3-12，ADR 0044）窗口是 24 小时，但它和 /64 的限流键同时上线（合并在 M4-11 之后），
  // 从来没有按旧算法写过计数，ADR 0045 说的「上线时 IPv6 计数从零开始」对它不适用
  const bornWithSlash64 = ["site_places_day"];
  assert.equal(SALES_RATE_LIMITS.site_places_day.windowMs, 24 * 3_600_000);
  const addressScopes = Object.keys(SALES_RATE_LIMITS).filter((scope) => scope !== "quote" && scope !== "other" && scope !== "site_lookup_order" && !bornWithSlash64.includes(scope));
  assert.deepEqual(addressScopes.sort(), [...perAddress].sort(), "新增按地址的额度时要重新核对 ADR 0045 的说法");
});

test("过了窗口，/64 的计数清零：找回订单 15 分钟、登录 15 分钟", async () => {
  assert.deepEqual(await burst(11, (i) => lookup(inSlash64("2001:db8:4111:f1", i))), [...Array(10).fill(400), 429]);
  const email = "m411-qa-window@tenant.test";
  assert.deepEqual(await burst(6, (i) => tenantLogin(inSlash64("2001:db8:4111:f2", i), email)), [401, 401, 401, 401, 401, 429]);
  api.clock.advance(15 * 60_000 - 1_000);
  assert.equal(await lookup("2001:db8:4111:f1::99"), 429, "窗口内还挡");
  assert.equal(await tenantLogin("2001:db8:4111:f2::99", email), 429);
  api.clock.advance(1_000);
  assert.equal(await lookup("2001:db8:4111:f1::99"), 400, "满 15 分钟放行");
  assert.equal(await tenantLogin("2001:db8:4111:f2::99", email), 401);
});

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

test("上线切换：按旧算法（地址原文的哈希）记的计数，IPv4 原样写法沿用（不从零开始）；IPv6 和映射写法不再生效（从零开始，ADR 已写明）", async () => {
  const now = api.clock.now();
  const seed = (ip: string) =>
    withPlatformTx(api.db.pool, (db) =>
      db.query("insert into sales_rate_limits (bucket, window_started_at, attempt_count) values ($1, $2, 10) on conflict (bucket) do update set window_started_at = $2, attempt_count = 10", [`site_lookup:${sha256(`site-ip:${ip}`)}`, now]),
    );
  await seed("198.51.100.90");
  await seed("2001:db8:4111:90::1");
  await seed("::ffff:198.51.100.91");
  assert.equal(await lookup("198.51.100.90"), 429, "IPv4：旧的计数还在，照样挡");
  assert.equal(await lookup("2001:db8:4111:90::1"), 400, "IPv6：旧的按单个地址的计数不再生效");
  assert.equal(await lookup("::ffff:198.51.100.91"), 400, "映射写法：旧计数记在映射原文上，现在按 IPv4 计");

  const loginKey = (ip: string) => createHash("sha256").update(["tenant", "ip", ip].join("\n"), "utf8").digest("hex");
  await withPreAuthTx(api.db.pool, (db) =>
    db.query("insert into login_throttles (key, attempt_count, window_started_at) values ($1, 50, $2), ($3, 50, $2)", [loginKey("198.51.100.92"), now, loginKey("2001:db8:4111:92::1")]),
  );
  assert.equal(await tenantLogin("198.51.100.92", "m411-qa-switch@tenant.test"), 429, "IPv4 的「同一地址」计数沿用");
  assert.equal(await tenantLogin("2001:db8:4111:92::1", "m411-qa-switch@tenant.test"), 401, "IPv6 的「同一地址」计数从零开始");
});
