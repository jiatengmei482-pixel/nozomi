/**
 * M1-03 商品接口的边界和并发（测试工程师补）。已有的 products.itest.ts 是单个供应商视角下的主干，tenant-isolation.itest.ts 是跨租户；
 * 这里补：并发（同一商品的不同步骤、商品编号、幂等键）、幂等键的全部情形、审计（每种写操作一条、失败不留）、
 * 创建后锁定的四项逐个、金额和各上限经接口的边界、引用保护的并发、列表概况与上架校验一致、暂停的供应商、多币种。
 * 名字以「【缺陷】」开头的是现在会失败的：复现、期望、实际写在测试里。
 *
 * 全部经真实接口、真实 PostgreSQL；测试数据都在这里构造，结束时连同 schema 一起删除。不联网。
 * 需要已上架的商品时走真实的流程：加一条价格规则，再 `POST …/publish`（M1-04 起「价格规则」是真实的一项）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type ApiResponse, type HttpMethod, TEST_PASSWORD, type TenantFixture, type TestApi, addTenantUser, createTestApi } from "./testing/api.ts";

let api: TestApi;
let root: string;
let tenant: TenantFixture;
const MISSING = "99999999-9999-4999-8999-999999999999";
const ids: Record<string, string> = {};

const platform = (method: HttpMethod, path: string, body?: unknown, version?: number): Promise<ApiResponse> =>
  api.call(method, `/platform/v1${path}`, { token: root, ...(body === undefined ? {} : { body }), ...(version === undefined ? {} : { headers: { "if-match": `"${version}"` } }) });

interface CallOptions {
  token?: string;
  body?: unknown;
  version?: number;
  key?: string | null;
}
const call = (method: HttpMethod, path: string, options: CallOptions = {}): Promise<ApiResponse> =>
  api.call(method, `/tenant/v1${path}`, {
    token: options.token ?? tenant.adminToken,
    ...(options.body === undefined ? {} : { body: options.body }),
    headers: {
      ...(options.version === undefined ? {} : { "if-match": `"${options.version}"` }),
      ...(method === "POST" && /^\/(products|brands|areas)$|\/price-rules$/.test(path) && options.key !== null ? { "idempotency-key": options.key ?? randomUUID() } : {}),
    },
  });

async function ok(res: Promise<ApiResponse>, status = 200): Promise<any> {
  const done = await res;
  assert.equal(done.status, status, done.text);
  return done.body;
}
const errorOf = (res: ApiResponse): [number, string | undefined] => [res.status, res.body?.error?.code];
function issues(res: ApiResponse): [string, string | undefined][] {
  assert.deepEqual(errorOf(res), [400, "VALIDATION_FAILED"], res.text);
  return res.body.error.details.issues.map((issue: any) => [issue.path, issue.reason]);
}
/** 拨动时钟超过登录令牌的有效期之后重新登录（平台超管和甲车队管理员）。 */
async function relogin(): Promise<void> {
  root = (await ok(api.call("POST", "/platform/v1/auth/login", { body: { email: "root@platform.test", password: TEST_PASSWORD } }))).access_token;
  tenant.adminToken = (await ok(api.call("POST", "/tenant/v1/auth/login", { body: { email: tenant.adminEmail, password: TEST_PASSWORD } }))).access_token;
}
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * 把一个写请求停在「它的检查都通过了、修改也做了、只差提交」的地方：用迁移账号锁住审计日志表，写请求走到最后一步（写日志）时就会等着。
 * `reached()` 等到确实有一个请求停在那里；`waiting()` 是现在停在那里的请求个数；`release()` 放行。
 */
async function holdBeforeCommit(): Promise<{ reached: () => Promise<void>; waiting: () => Promise<number>; release: () => Promise<void> }> {
  const client = await api.db.owner.connect();
  await client.query("begin");
  await client.query("lock table audit_logs in exclusive mode");
  const waiting = async (): Promise<number> => (await api.db.owner.query("select count(*)::int as n from pg_locks where relation = 'audit_logs'::regclass and not granted")).rows[0].n;
  return {
    waiting,
    reached: async () => {
      for (let attempt = 0; (await waiting()) === 0; attempt += 1) {
        assert.ok(attempt < 200, "写请求一直没有走到写审计日志那一步");
        await pause(10);
      }
    },
    release: async () => {
      await client.query("commit");
      client.release();
    },
  };
}
/**
 * 第一个写请求停在提交之前时发出第二个写请求。返回两个应答，以及第二个请求在第一个提交之前是不是一直在等、等的是不是互斥用的锁
 * （`blockedByLock`：它还没走到写日志那一步——如果它也走到了，说明它的检查已经在第一个提交之前通过了）。
 */
async function whileUncommitted(first: () => Promise<ApiResponse>, second: () => Promise<ApiResponse>): Promise<{ first: ApiResponse; second: ApiResponse; blockedByLock: boolean }> {
  const hold = await holdBeforeCommit();
  let released = false;
  try {
    const running = first();
    await hold.reached();
    const following = second();
    const state = await Promise.race([following.then(() => "finished"), pause(400).then(() => "waiting")]);
    const blockedByLock = state === "waiting" && (await hold.waiting()) === 1;
    released = true;
    await hold.release();
    return { first: await running, second: await following, blockedByLock };
  } finally {
    if (!released) await hold.release();
  }
}

const SQUARE = { type: "Polygon", coordinates: [[[139.6, 35.6], [139.8, 35.6], [139.8, 35.8], [139.6, 35.8], [139.6, 35.6]]] };
let serial = 0;
async function area(extra: Record<string, unknown> = {}, token?: string): Promise<any> {
  api.clock.advance(1_000);
  return ok(call("POST", "/areas", { ...(token ? { token } : {}), body: { city_id: ids["tokyo"], name: { zh: `QA 区域 ${(serial += 1)}` }, biz_type: "general", polygons: [{ kind: "operate", geometry: SQUARE }], ...extra } }), 201);
}
const BASE = (): Record<string, unknown> => ({ brand_id: ids["brand"], city_id: ids["tokyo"], category: "airport_transfer", poi_id: ids["narita"] });
async function draft(extra: Record<string, unknown> = {}): Promise<any> {
  api.clock.advance(1_000);
  return ok(call("POST", "/products", { body: { ...BASE(), ...extra } }), 201);
}
const RULES = {
  booking: { service_time: { start: "06:00", end: "23:00" }, lead_time_hours: 24 },
  free_wait: { pickup: { mode: "limited", minutes: 60 }, dropoff: { mode: "limited", minutes: 15 } },
};
/** 除价格规则外全部填好的接送机商品（成田机场，东京）。 */
async function completeDraft(extra: Record<string, unknown> = {}, rules: Record<string, unknown> = RULES): Promise<any> {
  const product = await draft({
    areas: [{ area_id: ids["area"] }],
    vehicle_groups: [{ vehicle_group_id: ids["biz7"], passengers: 6, luggage: 2 }],
    dispatchers: [{ name: "调度小王", phone: "+81 90-1234-5678" }],
    ...extra,
  });
  const saved = await ok(call("PUT", `/products/${product.id}/service-rules`, { version: product.version, body: rules }));
  const content = await ok(call("PUT", `/products/${product.id}/content`, { version: saved.version, body: { zh: { title: "成田机场接送", pickup_guide: "到达大厅 3 号门" } } }));
  return { ...(await ok(call("GET", `/products/${product.id}`))), version: content.version };
}
/** 给商品加一条价格规则（第一个区域、第一个车型组的一口价）；返回商品的新版本号。 */
async function addPrice(productId: string): Promise<number> {
  const current = await ok(call("GET", `/products/${productId}`));
  const body = {
    area_id: current.areas[0].area_id,
    vehicle_group_id: current.vehicle_groups[0].vehicle_group_id,
    ...(current.category === "airport_transfer" ? { direction: "both" } : {}),
    pricing_model: "fixed",
    base_price: 20_000,
    valid_from: "2026-01-01",
  };
  return (await ok(call("POST", `/products/${productId}/price-rules`, { version: current.version, body }), 201)).version;
}
/** 经真实接口上架：加一条价格规则，再上架。返回上架后的版本号。 */
async function publish(productId: string): Promise<number> {
  await addPrice(productId);
  const published = await ok(call("POST", `/products/${productId}/publish`));
  assert.equal(published.status, "published");
  return published.version;
}
async function audits(resource: string, id: string): Promise<any[]> {
  return (await api.db.owner.query("select action, tenant_id, actor_type, actor_email, source, before, after from audit_logs where resource = $1 and resource_id = $2 order by id", [resource, id])).rows;
}
const auditCount = async (): Promise<number> => (await api.db.owner.query("select count(*)::int as n from audit_logs where resource in ('product', 'brand')")).rows[0].n;
const failedKeys = (check: any): string[] => check.items.filter((item: any) => !item.passed).map((item: any) => item.key);
const reasonsOf = (check: any, key: string): string[] => check.items.find((item: any) => item.key === key).issues.map((issue: any) => `${issue.path} ${issue.reason}`);

before(async () => {
  api = await createTestApi();
  root = await api.superAdminToken();
  tenant = await api.tenantWithAdmin(root, "QA 甲车队", "admin@qa-a.test");
  const city = { country_code: "JP", timezone: "Asia/Tokyo" };
  ids["tokyo"] = (await ok(platform("POST", "/master/cities", { ...city, code: "CTY-JP-TYO", name: { zh: "东京" }, center: { lng: 139.6917, lat: 35.6895 } }), 201)).id;
  ids["osaka"] = (await ok(platform("POST", "/master/cities", { ...city, code: "CTY-JP-OSA", name: { zh: "大阪" }, center: { lng: 135.5011, lat: 34.6938 } }), 201)).id;
  ids["seoul"] = (await ok(platform("POST", "/master/cities", { country_code: "KR", timezone: "Asia/Seoul", code: "CTY-KR-SEL", name: { zh: "首尔" }, center: { lng: 126.978, lat: 37.5665 } }), 201)).id;
  const place = { location: { lng: 140.3887, lat: 35.7686 } };
  ids["narita"] = (await ok(platform("POST", "/master/places", { ...place, type: "airport", code: "NRT", city_id: ids["tokyo"], name: { zh: "成田机场" }, flight_scope: "mixed" }), 201)).id;
  ids["haneda"] = (await ok(platform("POST", "/master/places", { ...place, type: "airport", code: "HND", city_id: ids["tokyo"], name: { zh: "羽田机场" }, flight_scope: "mixed" }), 201)).id;
  ids["biz7"] = (await ok(platform("POST", "/master/vehicle-groups", { grade: "business", seats: 7, power: "fuel", combos: [{ passengers: 6, luggage: 2 }, { passengers: 4, luggage: 4 }], code: "VG-BIZ-7", name: { zh: "商务 7 座" } }), 201)).id;
  ids["seat"] = (await ok(platform("POST", "/master/addons", { code: "ADD-CHILD_SEAT", categories: ["airport_transfer", "charter"], charge_unit: "per_item", name: { zh: "儿童座椅" } }), 201)).id;
  ids["brand"] = (await ok(call("POST", "/brands", { body: { name: "QA 甲 JP", currency: "JPY" } }), 201)).id;
  ids["area"] = (await area({ name: { zh: "东京市区" } })).id;
});
after(() => api.close());

// ---------- 并发 ----------

test("并发：两个人拿着同一个版本号同时保存同一个商品的不同步骤——只有一个成功，其余是 409 VERSION_CONFLICT 并带最新版本号；没有半截的修改，日志只多一条", async () => {
  for (let round = 0; round < 4; round += 1) {
    const product = await draft();
    const logsBefore = (await audits("product", product.id)).length;
    const results = await Promise.all([
      call("PATCH", `/products/${product.id}`, { version: 1, body: { dispatchers: [{ name: "甲", phone: "0312345678" }] } }),
      call("PUT", `/products/${product.id}/service-rules`, { version: 1, body: { booking: { lead_time_hours: 12 } } }),
      call("PUT", `/products/${product.id}/content`, { version: 1, body: { zh: { title: "同时保存" } } }),
      call("PATCH", `/products/${product.id}`, { version: 1, body: { areas: [{ area_id: ids["area"] }] } }),
    ]);
    const winners = results.filter((res) => res.status === 200);
    const losers = results.filter((res) => res.status !== 200);
    assert.equal(winners.length, 1, `第 ${round} 轮：${results.map((res) => res.status).join(",")}`);
    for (const res of losers) {
      assert.deepEqual(errorOf(res), [409, "VERSION_CONFLICT"], res.text);
      assert.deepEqual(res.body.error.details, { current_version: 2 });
    }
    const now = await ok(call("GET", `/products/${product.id}`));
    const rules = await ok(call("GET", `/products/${product.id}/service-rules`));
    const changed = [now.dispatchers.length > 0, rules.rules.booking.lead_time_hours !== null, Object.keys(now.title).length > 0, now.areas.length > 0].filter(Boolean).length;
    assert.deepEqual([now.version, rules.version, changed], [2, 2, 1], "只有赢的那一步写进去了");
    assert.equal((await audits("product", product.id)).length, logsBefore + 1);
  }
});

test("并发：同时新建 24 个商品（两个供应商各 12 个）——编号各不相同、格式是 PRD + 14 位 UTC 时间 + 至少 4 位流水号，流水号全平台递增不重复", async () => {
  const other = await api.tenantWithAdmin(root, "QA 并发乙", "admin@qa-seq.test");
  const otherBrand = await ok(call("POST", "/brands", { token: other.adminToken, body: { name: "乙品牌", currency: "KRW" } }), 201);
  api.clock.advance(1_000);
  const stamp = api.clock.now().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const created = await Promise.all(
    Array.from({ length: 24 }, (_, index) =>
      index % 2 === 0
        ? call("POST", "/products", { body: { ...BASE(), category: "charter", poi_id: null } })
        : call("POST", "/products", { token: other.adminToken, body: { brand_id: otherBrand.id, city_id: ids["tokyo"], category: "charter" } }),
    ),
  );
  assert.deepEqual(created.map((res) => res.status), Array(24).fill(201), created.find((res) => res.status !== 201)?.text);
  const codes: string[] = created.map((res) => res.body.code);
  assert.equal(new Set(codes).size, 24, "编号各不相同");
  for (const code of codes) assert.match(code, new RegExp(`^PRD${stamp}\\d{4,}$`), "时间部分是创建时刻的 UTC 年月日时分秒");
  const sequence = codes.map((code) => Number(code.slice(17)));
  assert.equal(new Set(sequence).size, 24, "流水号不重复（两个供应商共用一个序列）");
  const stored = await api.db.owner.query("select count(distinct code)::int as codes, count(*)::int as n from products where code = any($1::text[])", [codes]);
  assert.deepEqual(stored.rows[0], { codes: 24, n: 24 });
});

// ---------- 幂等键 ----------

test("幂等键：同一个键同时来 6 次只建一个，6 个应答一模一样；之后带同一个键再来还是那一个（哪怕它已经被改过、删掉）", async () => {
  const key = randomUUID();
  const body = { ...BASE(), dispatchers: [{ name: "幂等", phone: "0312345678" }] };
  const countBefore = (await api.db.owner.query("select count(*)::int as n from products")).rows[0].n;
  const logsBefore = await auditCount();
  const burst = await Promise.all(Array.from({ length: 6 }, () => call("POST", "/products", { key, body })));
  assert.deepEqual(burst.map((res) => res.status), Array(6).fill(201), burst.find((res) => res.status !== 201)?.text);
  for (const res of burst) assert.deepEqual(res.body, burst[0]?.body);
  assert.equal((await api.db.owner.query("select count(*)::int as n from products")).rows[0].n, countBefore + 1);
  assert.equal(await auditCount(), logsBefore + 1, "只记一条创建日志");
  const first = burst[0]?.body;
  // 键的先后不同不算不同的内容
  assert.deepEqual(await ok(call("POST", "/products", { key, body: Object.fromEntries(Object.entries(body).reverse()) }), 201), first);
  await ok(call("PATCH", `/products/${first.id}`, { version: 1, body: { dispatchers: [] } }));
  assert.deepEqual(await ok(call("POST", "/products", { key, body }), 201), first, "那一条后来被改了：回放的仍是当时的应答");
  assert.equal((await call("DELETE", `/products/${first.id}`)).status, 204);
  assert.deepEqual(await ok(call("POST", "/products", { key, body }), 201), first, "那一条被删了：不会再建一个");
  assert.equal((await api.db.owner.query("select count(*)::int as n from products")).rows[0].n, countBefore);
});

test("幂等键：同一个键换了内容是 422，带上一次建成的那一条的编号和当时的版本号；没带键、键写法不对是 400；失败的请求不占用键；键按接口、按供应商分开；24 小时后可以重新使用", async () => {
  const key = randomUUID();
  const body = { ...BASE(), category: "charter", poi_id: null };
  // 第一次失败（城市不存在）：键没有被占用，改对以后带同一个键能建
  assert.deepEqual(issues(await call("POST", "/products", { key, body: { ...body, city_id: MISSING } })), [["/city_id", "UNKNOWN_CITY"]]);
  const created = await ok(call("POST", "/products", { key, body }), 201);
  await ok(call("PUT", `/products/${created.id}/content`, { version: 1, body: { zh: { title: "后来改过" } } }));
  const reused = await call("POST", "/products", { key, body: { ...body, category: "point_to_point" } });
  assert.deepEqual(errorOf(reused), [422, "IDEMPOTENCY_KEY_REUSED"]);
  assert.deepEqual(reused.body.error.details, { created: { id: created.id, version: 1 } }, "带的是建成那一刻的版本号");
  assert.equal((await call("POST", "/products", { key: null, body })).status, 400);
  for (const bad of ["", "短", "x".repeat(300), "有 空格"]) {
    const res = await call("POST", "/products", { key: bad, body });
    assert.deepEqual(errorOf(res), [400, "VALIDATION_FAILED"], `键 ${JSON.stringify(bad).slice(0, 20)}：${res.text}`);
  }
  // 同一个键用在子品牌接口上互不相干；另一个供应商用同一个键也互不相干
  const brand = await ok(call("POST", "/brands", { key, body: { name: "同键品牌", currency: "KRW" } }), 201);
  assert.notEqual(brand.id, created.id);
  const brandReused = await call("POST", "/brands", { key, body: { name: "同键品牌二", currency: "KRW" } });
  assert.deepEqual([errorOf(brandReused), brandReused.body.error.details], [[422, "IDEMPOTENCY_KEY_REUSED"], { created: { id: brand.id, version: 1 } }]);
  const other = await api.tenantWithAdmin(root, "QA 同键乙", "admin@qa-key.test");
  const otherBrand = await ok(call("POST", "/brands", { token: other.adminToken, key, body: { name: "同键品牌", currency: "JPY" } }), 201);
  assert.notEqual(otherBrand.id, brand.id);
  // 没有权限的人带着别人用过的键来：是 403，不是回放
  const readonly = await addTenantUser(api, tenant.adminToken, "readonly-key@qa-a.test", "readonly");
  assert.equal((await call("POST", "/products", { token: readonly.token, key, body })).status, 403);
  // 24 小时以内同一个键还是原来那一条；过了 24 小时可以重新用来建别的
  api.clock.advance(24 * 3_600_000 - 60_000);
  await relogin();
  assert.equal((await ok(call("POST", "/products", { key, body }), 201)).id, created.id);
  api.clock.advance(120_000);
  const again = await ok(call("POST", "/products", { key, body: { ...body, category: "point_to_point" } }), 201);
  assert.notEqual(again.id, created.id);
  assert.equal(again.category, "point_to_point");
});

// ---------- 审计 ----------

test("审计：每种写操作正好一条（新增 / 改名子品牌；新增、改基础信息、改服务规则、改详情、上架、下架、删除商品），带操作人、供应商、前后值；内容没变的保存不留日志", async () => {
  const brand = await ok(call("POST", "/brands", { body: { name: "审计品牌", currency: "KRW" } }), 201);
  await ok(call("PUT", `/brands/${brand.id}`, { version: 1, body: { name: "审计品牌改" } }));
  await ok(call("PUT", `/brands/${brand.id}`, { version: 2, body: { name: "审计品牌改", currency: "KRW" } }));
  assert.deepEqual((await audits("brand", brand.id)).map((log) => [log.action, log.tenant_id, log.actor_type, log.actor_email, log.source, log.before, log.after]), [
    ["create", tenant.tenantId, "tenant_user", "admin@qa-a.test", "console", null, { name: "审计品牌", currency: "KRW", status: "active" }],
    ["update", tenant.tenantId, "tenant_user", "admin@qa-a.test", "console", { name: "审计品牌" }, { name: "审计品牌改" }],
  ]);

  const product = await draft({ areas: [{ area_id: ids["area"] }], dispatchers: [{ name: "老王", phone: "0312345678" }] });
  const id = product.id;
  await ok(call("PATCH", `/products/${id}`, { version: 1, body: { dispatchers: [{ name: "小李", phone: "0398765432" }], vehicle_groups: [{ vehicle_group_id: ids["biz7"], passengers: 4, luggage: 4 }] } }));
  await ok(call("PATCH", `/products/${id}`, { version: 2, body: { dispatchers: [{ name: "小李", phone: "0398765432" }] } }));
  const rules = await ok(call("PUT", `/products/${id}/service-rules`, { version: 2, body: RULES }));
  await ok(call("PUT", `/products/${id}/service-rules`, { version: 3, body: rules.rules }));
  const content = await ok(call("PUT", `/products/${id}/content`, { version: 3, body: { zh: { title: "审计用商品", pickup_guide: "到达大厅 3 号门" } } }));
  await ok(call("PUT", `/products/${id}/content`, { version: 4, body: content.content }));
  await publish(id);
  await ok(call("POST", `/products/${id}/publish`));
  await ok(call("POST", `/products/${id}/unpublish`));
  await ok(call("POST", `/products/${id}/unpublish`));
  const logs = await audits("product", id);
  assert.deepEqual(logs.map((log) => log.action), ["create", "update", "update", "update", "publish", "unpublish"], "没变化的保存、已上架再上架、已下架再下架都不留日志（价格规则的日志记在价格规则名下）");
  assert.ok(logs.every((log) => log.tenant_id === tenant.tenantId && log.actor_email === "admin@qa-a.test" && log.actor_type === "tenant_user" && log.source === "console"));
  assert.deepEqual(logs[0].after.dispatchers, [{ name: "老王", phone: "0312345678" }]);
  assert.deepEqual([logs[1].before, logs[1].after], [
    { vehicle_groups: [], dispatchers: [{ name: "老王", phone: "0312345678" }] },
    { vehicle_groups: [{ vehicle_group_id: ids["biz7"], passengers: 4, luggage: 4 }], dispatchers: [{ name: "小李", phone: "0398765432" }] },
  ]);
  assert.deepEqual([Object.keys(logs[2].before), logs[2].before.service_rules.booking.leadTimeHours, logs[2].after.service_rules.booking.leadTimeHours], [["service_rules"], null, 24]);
  assert.deepEqual([logs[3].before, logs[3].after.content.zh.title], [{ content: {} }, "审计用商品"]);
  assert.deepEqual([logs[4].before, logs[4].after], [{ status: "draft" }, { status: "published" }]);
  assert.deepEqual([logs[5].before, logs[5].after], [{ status: "published" }, { status: "unpublished" }]);

  const gone = await draft({ areas: [{ area_id: ids["area"] }] });
  assert.equal((await call("DELETE", `/products/${gone.id}`)).status, 204);
  const removed = (await audits("product", gone.id)).at(-1);
  assert.deepEqual([removed.action, removed.after, removed.before.code, removed.before.areas, removed.before.status], ["delete", null, gone.code, [ids["area"]], "draft"]);
  // 租户管理员自己查得到这些日志
  const listed = await ok(api.call("GET", `/tenant/v1/audit-logs?resource=product&limit=100`, { token: tenant.adminToken }));
  assert.ok(listed.items.some((item: any) => item.resource_id === gone.id && item.action === "delete"));
});

test("审计：被拒绝的写操作一条日志都不留、什么都不改——校验不过（400）、没带版本号（428）、版本号过期 / 锁定字段 / 上架条件不满足 / 状态不对（409）、没有权限（403）、不存在（404）、幂等键换了内容（422）", async () => {
  const product = await completeDraft();
  const published = await completeDraft();
  published.version = await publish(published.id);
  const readonly = await addTenantUser(api, tenant.adminToken, "readonly-audit@qa-a.test", "readonly");
  const key = randomUUID();
  await ok(call("POST", "/products", { key, body: BASE() }), 201);
  const snapshot = async (): Promise<unknown> => ({
    logs: await auditCount(),
    products: (await api.db.owner.query("select id, version, status, service_rules, content, updated_at from products order by id")).rows,
    areas: (await api.db.owner.query("select * from product_areas order by product_id, priority")).rows,
    groups: (await api.db.owner.query("select * from product_vehicle_groups order by product_id, position")).rows,
    dispatchers: (await api.db.owner.query("select * from product_dispatchers order by product_id, position")).rows,
    brands: (await api.db.owner.query("select id, name, version from brands order by id")).rows,
  });
  const before = await snapshot();
  const v = product.version;
  const attempts: [string, Promise<ApiResponse>, number, string][] = [
    ["新增：城市不存在", call("POST", "/products", { body: { ...BASE(), city_id: MISSING } }), 400, "VALIDATION_FAILED"],
    ["新增：幂等键换了内容", call("POST", "/products", { key, body: { ...BASE(), poi_id: ids["haneda"] } }), 422, "IDEMPOTENCY_KEY_REUSED"],
    ["新增：只读角色", call("POST", "/products", { token: readonly.token, body: BASE() }), 403, "FORBIDDEN"],
    ["基础信息：电话不对", call("PATCH", `/products/${product.id}`, { version: v, body: { dispatchers: [{ name: "x", phone: "abc" }] } }), 400, "VALIDATION_FAILED"],
    ["基础信息：没带版本号", call("PATCH", `/products/${product.id}`, { body: { dispatchers: [] } }), 428, "PRECONDITION_REQUIRED"],
    ["基础信息：版本号过期", call("PATCH", `/products/${product.id}`, { version: v - 1, body: { dispatchers: [] } }), 409, "VERSION_CONFLICT"],
    ["基础信息：改锁定的字段", call("PATCH", `/products/${product.id}`, { version: v, body: { category: "charter", dispatchers: [] } }), 409, "FIELD_LOCKED"],
    ["基础信息：只读角色", call("PATCH", `/products/${product.id}`, { token: readonly.token, version: v, body: { dispatchers: [] } }), 403, "FORBIDDEN"],
    ["基础信息：不存在", call("PATCH", `/products/${MISSING}`, { version: 1, body: { dispatchers: [] } }), 404, "NOT_FOUND"],
    ["基础信息：已上架的改完不满足上架条件", call("PATCH", `/products/${published.id}`, { version: published.version, body: { dispatchers: [] } }), 409, "PUBLISH_CHECK_FAILED"],
    ["服务规则：金额带小数", call("PUT", `/products/${product.id}/service-rules`, { version: v, body: { ...RULES, night: { amount: 0.5 } } }), 400, "VALIDATION_FAILED"],
    ["服务规则：版本号过期", call("PUT", `/products/${product.id}/service-rules`, { version: v + 5, body: {} }), 409, "VERSION_CONFLICT"],
    ["服务规则：只读角色", call("PUT", `/products/${product.id}/service-rules`, { token: readonly.token, version: v, body: {} }), 403, "FORBIDDEN"],
    ["详情：标题太长", call("PUT", `/products/${product.id}/content`, { version: v, body: { zh: { title: "题".repeat(101) } } }), 400, "VALIDATION_FAILED"],
    ["详情：没带版本号", call("PUT", `/products/${product.id}/content`, { body: {} }), 428, "PRECONDITION_REQUIRED"],
    ["上架：条件不满足", call("POST", `/products/${product.id}/publish`), 409, "PUBLISH_CHECK_FAILED"],
    ["下架：草稿", call("POST", `/products/${product.id}/unpublish`), 409, "PRODUCT_STATE_INVALID"],
    ["下架：只读角色", call("POST", `/products/${published.id}/unpublish`, { token: readonly.token }), 403, "FORBIDDEN"],
    ["删除：已上架", call("DELETE", `/products/${published.id}`), 409, "PRODUCT_NOT_DRAFT"],
    ["删除：只读角色", call("DELETE", `/products/${product.id}`, { token: readonly.token }), 403, "FORBIDDEN"],
    ["删除：不存在", call("DELETE", `/products/${MISSING}`), 404, "NOT_FOUND"],
    ["子品牌：重名", call("POST", "/brands", { body: { name: "qa 甲 jp", currency: "JPY" } }), 409, "BRAND_NAME_TAKEN"],
    ["子品牌：币种不支持", call("POST", "/brands", { body: { name: "欧元", currency: "EUR" } }), 400, "VALIDATION_FAILED"],
    ["子品牌：改币种", call("PUT", `/brands/${ids["brand"]}`, { version: 1, body: { name: "改名", currency: "KRW" } }), 409, "FIELD_LOCKED"],
    ["子品牌：只读角色", call("PUT", `/brands/${ids["brand"]}`, { token: readonly.token, version: 1, body: { name: "改名" } }), 403, "FORBIDDEN"],
  ];
  for (const [what, attempt, status, code] of attempts) assert.deepEqual(errorOf(await attempt), [status, code], what);
  assert.deepEqual(await snapshot(), before);
});

// ---------- 创建后锁定的四项 ----------

test("创建后不能改的四项逐个：带相同的值不算改；带不同的值是 409 FIELD_LOCKED 且只列被改的那一项；和别的修改一起带时整个请求都不生效", async () => {
  const product = await draft({ dispatchers: [{ name: "老王", phone: "0312345678" }] });
  const otherBrand = await ok(call("POST", "/brands", { body: { name: "锁定测试品牌", currency: "JPY" } }), 201);
  const same = await ok(call("PATCH", `/products/${product.id}`, { version: 1, body: BASE() }));
  assert.equal(same.version, 1);
  const cases: [string, Record<string, unknown>][] = [
    ["brand_id", { brand_id: otherBrand.id }],
    ["city_id", { city_id: ids["osaka"] }],
    ["category", { category: "point_to_point" }],
    ["poi_id", { poi_id: ids["haneda"] }],
    ["poi_id", { poi_id: null }],
  ];
  for (const [field, change] of cases) {
    const res = await call("PATCH", `/products/${product.id}`, { version: 1, body: { ...change, dispatchers: [] } });
    assert.deepEqual([errorOf(res), res.body.error.details], [[409, "FIELD_LOCKED"], { fields: [field] }], JSON.stringify(change));
  }
  // 版本号过期优先于锁定字段：先让人载入最新内容
  assert.deepEqual(errorOf(await call("PATCH", `/products/${product.id}`, { version: 9, body: { category: "charter" } })), [409, "VERSION_CONFLICT"]);
  const now = await ok(call("GET", `/products/${product.id}`));
  assert.deepEqual([now.version, now.brand_id, now.city_id, now.category, now.poi_id, now.dispatchers.length], [1, ids["brand"], ids["tokyo"], "airport_transfer", ids["narita"], 1]);
  // 包车没有接送点：带 null 是相同的值，带一个机场是改
  const charter = await draft({ category: "charter", poi_id: null });
  assert.equal((await ok(call("PATCH", `/products/${charter.id}`, { version: 1, body: { poi_id: null } }))).version, 1);
  assert.deepEqual((await call("PATCH", `/products/${charter.id}`, { version: 1, body: { poi_id: ids["narita"] } })).body.error.details, { fields: ["poi_id"] });
  // 服务规则、详情接口里夹带这四项：被忽略，不会改到
  await ok(call("PUT", `/products/${charter.id}/service-rules`, { version: 1, body: { category: "airport_transfer", brand_id: otherBrand.id, tenant_id: MISSING, booking: { lead_time_hours: 1 } } }));
  assert.deepEqual([(await ok(call("GET", `/products/${charter.id}`))).category, (await api.db.owner.query("select tenant_id from products where id = $1", [charter.id])).rows[0].tenant_id], ["charter", tenant.tenantId]);
});

// ---------- 校验边界（经接口）----------

test("金额经接口：字符串、小数、负数、超大数都被拒且什么都不存；0 和上限可以；应答里的金额原样是整数", async () => {
  const product = await draft();
  const put = (body: unknown): Promise<ApiResponse> => call("PUT", `/products/${product.id}/service-rules`, { version: 1, body });
  const places: [string, (amount: unknown) => unknown][] = [
    ["/urgent/tiers/0/surcharge", (amount) => ({ urgent: { enabled: true, tiers: [{ within_hours: 1, surcharge: amount }] } })],
    ["/night/amount", (amount) => ({ night: { amount } })],
    ["/addons/0/unit_price", (amount) => ({ addons: [{ addon_id: ids["seat"], unit_price: amount }] })],
    ["/driver_languages/0/unit_price", (amount) => ({ driver_languages: [{ language: "zh", unit_price: amount }] })],
  ];
  for (const [path, body] of places) {
    assert.deepEqual(issues(await put(body("3000"))), [[path, undefined]], `${path} 字符串`);
    assert.deepEqual(issues(await put(body(12.5))), [[path, "NOT_INTEGER"]], `${path} 小数`);
    assert.deepEqual(issues(await put(body(-1))), [[path, "OUT_OF_RANGE"]], `${path} 负数`);
    assert.deepEqual(issues(await put(body(1_000_000_001))), [[path, "OUT_OF_RANGE"]], `${path} 超过上限`);
    assert.deepEqual(issues(await put(body(9_007_199_254_740_993))), [[path, "OUT_OF_RANGE"]], `${path} 超出安全整数`);
    assert.deepEqual(issues(await put(body(true))), [[path, undefined]], `${path} 布尔`);
    if (path !== "/night/amount") assert.deepEqual(issues(await put(body(null))), [[path, undefined]], `${path} null`);
  }
  assert.equal((await ok(call("GET", `/products/${product.id}`))).version, 1, "被拒的都没存");
  const saved = await ok(put({ urgent: { enabled: true, tiers: [{ within_hours: 1, surcharge: 0 }] }, night: { amount: 1_000_000_000 }, addons: [{ addon_id: ids["seat"], unit_price: 0 }], driver_languages: [{ language: "zh", unit_price: 1 }] }));
  assert.deepEqual([saved.rules.urgent.tiers[0].surcharge, saved.rules.night.amount, saved.rules.addons[0].unit_price, saved.rules.driver_languages[0].unit_price], [0, 1_000_000_000, 0, 1]);
  assert.match(JSON.stringify(saved.rules), /"amount":1000000000[,}]/, "不带小数点、不是字符串");
});

test("多币种：金额的币种跟着商品的子品牌走，各商品互不影响；子品牌的币种改不了，所以已存的金额不会被换算或改义", async () => {
  const krw = await ok(call("POST", "/brands", { body: { name: "QA 甲 KR", currency: "KRW" } }), 201);
  const usd = await ok(call("POST", "/brands", { body: { name: "QA 甲 US", currency: "USD" } }), 201);
  const amounts: Record<string, number> = {};
  for (const [brand, amount] of [[krw, 30_000], [usd, 1_999], [{ id: ids["brand"], currency: "JPY" }, 3_000]] as const) {
    const product = await draft({ brand_id: brand.id, city_id: ids["seoul"], category: "charter", poi_id: null });
    const saved = await ok(call("PUT", `/products/${product.id}/service-rules`, { version: 1, body: { night: { enabled: true, window: { start: "22:00", end: "06:00" }, amount, charge_unit: "per_hour" } } }));
    assert.deepEqual([saved.currency, saved.rules.night.amount, product.brand.currency, product.city.timezone], [brand.currency, amount, brand.currency, "Asia/Seoul"]);
    amounts[product.id] = amount;
  }
  for (const [id, amount] of Object.entries(amounts)) assert.equal((await ok(call("GET", `/products/${id}/service-rules`))).rules.night.amount, amount);
  for (const currency of ["JPY", "USD", "usd", "EUR", ""]) {
    const res = await call("PUT", `/brands/${krw.id}`, { version: 1, body: { name: "QA 甲 KR", currency } });
    assert.ok([400, 409].includes(res.status), `改成 ${currency}：${res.text}`);
  }
  assert.equal((await ok(call("GET", "/brands"))).items.find((brand: any) => brand.id === krw.id).currency, "KRW");
});

test("条数上限经接口：区域 50、车型组 30、调度人 10——正好等于可以，多一个是 400 并指出是哪一项", async () => {
  const product = await draft();
  const dispatchers = (count: number): unknown[] => Array.from({ length: count }, (_, index) => ({ name: `调度 ${index}`, phone: `03123456${String(index).padStart(2, "0")}` }));
  const ten = await ok(call("PATCH", `/products/${product.id}`, { version: 1, body: { dispatchers: dispatchers(10) } }));
  assert.deepEqual([ten.dispatchers.length, ten.dispatchers[9].name], [10, "调度 9"]);
  assert.deepEqual(issues(await call("PATCH", `/products/${product.id}`, { version: 2, body: { dispatchers: dispatchers(11) } })), [["/dispatchers", "TOO_MANY"]]);
  const areas: string[] = [];
  for (let index = 0; index < 50; index += 1) areas.push((await area()).id);
  const fifty = await ok(call("PATCH", `/products/${product.id}`, { version: 2, body: { areas: areas.map((area_id) => ({ area_id })) } }));
  assert.deepEqual([fifty.area_count, fifty.areas.map((item: any) => item.priority).join(), fifty.areas.map((item: any) => item.area_id).join()], [50, Array.from({ length: 50 }, (_, index) => index).join(), areas.join()]);
  assert.deepEqual(issues(await call("PATCH", `/products/${product.id}`, { version: 3, body: { areas: [...areas, ids["area"]].map((area_id) => ({ area_id })) } })), [["/areas", "TOO_MANY"]]);
  assert.equal((await ok(call("GET", `/products/${product.id}`))).version, 3);
  assert.equal((await call("DELETE", `/products/${product.id}`)).status, 204);
  for (const id of areas) assert.equal((await call("DELETE", `/areas/${id}`)).status, 204);
});

// ---------- 上架检查 ----------

test("列表项的 check 概况和 publish-check 逐个商品对得上：空草稿、缺一项、填全、引用被停用、已上架、已下架", async () => {
  await api.db.owner.query("delete from products");
  const stale = await area();
  const products = [
    await draft(),
    await draft({ category: "charter", poi_id: null, dispatchers: [{ name: "x", phone: "0312345678" }] }),
    await completeDraft(),
    await completeDraft({ areas: [{ area_id: ids["area"] }, { area_id: stale.id }] }),
    await completeDraft(),
    await completeDraft(),
  ];
  await ok(call("POST", `/areas/${stale.id}/disable`));
  await publish(products[4].id);
  await publish(products[5].id);
  await ok(call("POST", `/products/${products[5].id}/unpublish`));
  const listed = await ok(call("GET", "/products?limit=200"));
  assert.equal(listed.items.length, products.length);
  const seen = new Set<string>();
  for (const item of listed.items) {
    const check = await ok(call("GET", `/products/${item.id}/publish-check`));
    const failed = check.items.filter((entry: any) => entry.required && !entry.passed);
    const unavailable = failed.filter((entry: any) => entry.issues.some((issue: any) => issue.reason === "FEATURE_NOT_AVAILABLE")).length;
    assert.deepEqual(item.check, { can_publish: check.can_publish, failed_required: failed.length - unavailable, unavailable_required: unavailable }, item.code);
    assert.equal(check.can_publish, failed.length === 0);
    seen.add(JSON.stringify(item.check));
  }
  assert.ok(seen.size >= 3, "这一组商品里至少有三种不同的概况");
  assert.deepEqual(listed.items.find((item: any) => item.id === products[3].id).check, { can_publish: false, failed_required: 2, unavailable_required: 0 }, "区域被停用 + 还没有价格规则：两项都是供应商自己能补的");
  assert.deepEqual(listed.items.find((item: any) => item.id === products[4].id).check, { can_publish: true, failed_required: 0, unavailable_required: 0 }, "已上架的");
  assert.equal((await call("DELETE", `/areas/${stale.id}`)).status, 204);
});

test("上架检查看现在：区域被删掉后回到「没有区域」；城市被平台停用后商品和它的区域都被指出；子品牌被停用；这些都不改商品的版本号", async () => {
  const kobe = await ok(platform("POST", "/master/cities", { code: "CTY-JP-UKB", country_code: "JP", timezone: "Asia/Tokyo", name: { zh: "神户" }, center: { lng: 135.19, lat: 34.69 } }), 201);
  const brand = await ok(call("POST", "/brands", { body: { name: "会被停用的品牌", currency: "JPY" } }), 201);
  const only = await area({ city_id: kobe.id });
  const product = await ok(call("POST", "/products", { body: { brand_id: brand.id, city_id: kobe.id, category: "point_to_point", areas: [{ area_id: only.id }], vehicle_groups: [{ vehicle_group_id: ids["biz7"], passengers: 6, luggage: 2 }], dispatchers: [{ name: "x", phone: "0312345678" }] } }), 201);
  assert.ok(!failedKeys(await ok(call("GET", `/products/${product.id}/publish-check`))).includes("basic_info"));
  await ok(platform("POST", `/master/cities/${kobe.id}/disable`));
  await api.db.owner.query("update brands set status = 'disabled' where id = $1", [brand.id]);
  assert.deepEqual(reasonsOf(await ok(call("GET", `/products/${product.id}/publish-check`)), "basic_info"), ["/brand_id BRAND_DISABLED", "/city_id CITY_DISABLED", "/areas/0 AREA_CITY_DISABLED"]);
  const shown = await ok(call("GET", `/products/${product.id}`));
  assert.deepEqual([shown.brand.status, shown.city.status, shown.version], ["disabled", "disabled", 1], "详情里带着引用现在的状态");
  // 用已停用的子品牌、城市不能再新建
  assert.deepEqual(issues(await call("POST", "/products", { body: { brand_id: brand.id, city_id: ids["tokyo"], category: "charter" } })), [["/brand_id", "BRAND_DISABLED"]]);
  await ok(platform("POST", `/master/cities/${kobe.id}/enable`));
  await api.db.owner.query("update brands set status = 'active' where id = $1", [brand.id]);
  assert.equal((await call("DELETE", `/areas/${only.id}`)).status, 204);
  const after = await ok(call("GET", `/products/${product.id}`));
  assert.deepEqual([after.areas, after.area_count, after.version], [[], 0, 1]);
  assert.deepEqual(reasonsOf(await ok(call("GET", `/products/${product.id}/publish-check`)), "basic_info"), ["/areas NO_AREA"]);
  assert.deepEqual((await ok(call("GET", `/products?area_id=${only.id}`))).items, []);
});

test("【缺陷】接送点被平台改到别的城市之后，商品的上架检查应该指出来（接送机商品必须有一个本城市的机场或车站）", async () => {
  // 复现：东京的接送机商品选了机场 X；平台把机场 X 的所属城市改成大阪（PATCH /platform/v1/master/places/{id}，city_id 可以改）。
  // 期望：上架检查的「基础信息」不通过（接送点已经不在商品所在的城市）——ADR 0016：校验看的是现在的情况；新建时这种组合是 400 PLACE_OTHER_CITY。
  // 实际：「基础信息」照样通过，商品可以带着一个别的城市的机场上架。
  const moved = await ok(platform("POST", "/master/places", { type: "airport", code: "QAM", city_id: ids["tokyo"], name: { zh: "会被挪走的机场" }, location: { lng: 140.1, lat: 35.5 }, flight_scope: "mixed" }), 201);
  const product = await completeDraft({ poi_id: moved.id });
  assert.deepEqual(failedKeys(await ok(call("GET", `/products/${product.id}/publish-check`))), ["price_rules"], "前提：挪走之前只差价格规则");
  const patched = await platform("PATCH", `/master/places/${moved.id}`, { city_id: ids["osaka"] }, moved.version);
  assert.equal(patched.status, 200, patched.text);
  assert.deepEqual(issues(await call("POST", "/products", { body: { ...BASE(), poi_id: moved.id } })), [["/poi_id", "PLACE_OTHER_CITY"]], "同样的组合新建时是被拒绝的");
  const check = await ok(call("GET", `/products/${product.id}/publish-check`));
  assert.ok(failedKeys(check).includes("basic_info"), `接送点已经在大阪，东京的商品的「基础信息」却仍然通过：${JSON.stringify(check.items[0])}`);
});

test("【缺陷】上架检查说「服务规则」已满足的商品，把读到的服务规则原样存回去应该能存——平台把附加服务改成不按个计费之后，检查通过但保存被拒", async () => {
  // 复现：商品开着附加服务「儿童座椅」（按个计费）并设了「第一个免费」；平台把这个附加服务的计费方式改成按次（PATCH addons，charge_unit 可以改）。
  // 期望：两处结论一致——要么上架检查指出「第一个免费不再适用」，要么保存不因为一个没动过的字段被拒。
  // 实际：上架检查的「服务规则」通过；但供应商改任何一项服务规则再保存都是 400（/addons/0/first_free NOT_APPLICABLE）。
  const seat = await ok(platform("POST", "/master/addons", { code: "ADD-QA_SEAT", categories: ["airport_transfer"], charge_unit: "per_item", name: { zh: "QA 座椅" } }), 201);
  const product = await completeDraft({}, { ...RULES, addons: [{ addon_id: seat.id, unit_price: 1000, first_free: true }] });
  const changed = await platform("PATCH", `/master/addons/${seat.id}`, { charge_unit: "per_order" }, seat.version);
  assert.equal(changed.status, 200, changed.text);
  const check = await ok(call("GET", `/products/${product.id}/publish-check`));
  const stored = await ok(call("GET", `/products/${product.id}/service-rules`));
  const resaved = await call("PUT", `/products/${product.id}/service-rules`, { version: stored.version, body: { ...stored.rules, booking: { ...stored.rules.booking, note: "只加了一句备注" } } });
  const checkPassed = !failedKeys(check).includes("service_rules");
  assert.ok(!(checkPassed && resaved.status === 400), `上架检查说服务规则已满足，原样存回去却被拒：${resaved.text}`);
});

// ---------- 引用保护 ----------

test("引用保护：区域被 3 个已上架的商品用着——个数如实；逐个下架，剩 0 个时才能停用 / 删除；已下架的商品用着的区域删掉后它少掉这个区域、版本号不变、其余区域的先后不变", async () => {
  const [first, used, last] = [await area(), await area(), await area()];
  const products: any[] = [];
  for (let index = 0; index < 3; index += 1) {
    const product = await completeDraft({ areas: [{ area_id: first.id }, { area_id: used.id }, { area_id: last.id }] });
    await publish(product.id);
    products.push(product);
  }
  for (const [remaining, product] of [[3, products[0]], [2, products[1]], [1, products[2]]] as const) {
    for (const [method, path] of [["DELETE", `/areas/${used.id}`], ["POST", `/areas/${used.id}/disable`]] as const) {
      const res = await call(method, path);
      assert.deepEqual([errorOf(res), res.body.error.details], [[409, "AREA_IN_USE"], { published_product_count: remaining }], `${method}，还有 ${remaining} 个`);
      assert.match(res.body.error.message, new RegExp(`有 ${remaining} 个已上架的商品在用`));
    }
    await ok(call("POST", `/products/${product.id}/unpublish`));
  }
  assert.deepEqual((await ok(call("GET", `/areas/${used.id}`))).usage, { product_count: 3, published_product_count: 0 });
  const versions = await Promise.all(products.map(async (product) => (await ok(call("GET", `/products/${product.id}`))).version));
  assert.equal((await ok(call("POST", `/areas/${used.id}/disable`))).status, "disabled", "只有已下架的在用：可以停用");
  assert.deepEqual(reasonsOf(await ok(call("GET", `/products/${products[0].id}/publish-check`)), "basic_info"), ["/areas/1 AREA_DISABLED"]);
  assert.equal((await call("DELETE", `/areas/${used.id}`)).status, 204, "也可以删除");
  for (const [index, product] of products.entries()) {
    const now = await ok(call("GET", `/products/${product.id}`));
    assert.deepEqual([now.areas.map((item: any) => item.area_id), now.area_count, now.version, now.status], [[first.id, last.id], 2, versions[index], "unpublished"]);
    assert.deepEqual(now.areas.map((item: any) => item.priority), [0, 1], "少掉中间一个之后优先级重新排成连续的");
    // 少掉一个之后原样存回去不算修改；再调个顺序也能存
    const same = await ok(call("PATCH", `/products/${product.id}`, { version: now.version, body: { areas: now.areas.map((item: any) => ({ area_id: item.area_id })) } }));
    assert.equal(same.version, now.version);
  }
  // 手上还留着旧的区域清单的人保存：被删的那一个按「不存在」指出来，位置对得上
  const stale = await call("PATCH", `/products/${products[0].id}`, { version: versions[0], body: { areas: [{ area_id: first.id }, { area_id: used.id }, { area_id: last.id }] } });
  assert.deepEqual(issues(stale), [["/areas/1/area_id", "UNKNOWN_AREA"]]);
});

test("引用保护（平台主数据）：附加服务只在商品里开着时才算在用；关着的、别的品类的草稿不拦停用；被拦时带着个数；下架后放行", async () => {
  const addon = await ok(platform("POST", "/master/addons", { code: "ADD-QA_WIFI", categories: ["airport_transfer", "charter"], charge_unit: "per_order", name: { zh: "QA 随车 WiFi" } }), 201);
  const off = await completeDraft({}, { ...RULES, addons: [{ addon_id: addon.id, enabled: false, unit_price: 500 }] });
  const on1 = await completeDraft({}, { ...RULES, addons: [{ addon_id: addon.id, unit_price: 500 }] });
  const on2 = await completeDraft({}, { ...RULES, addons: [{ addon_id: addon.id, unit_price: 0 }] });
  for (const product of [off, on1, on2]) await publish(product.id);
  const blocked = await platform("POST", `/master/addons/${addon.id}/disable`);
  assert.deepEqual([errorOf(blocked), blocked.body.error.details], [[409, "MASTER_DATA_IN_USE"], { active_count: 2 }], "关着的那一个不算");
  await ok(call("POST", `/products/${on1.id}/unpublish`));
  assert.deepEqual((await platform("POST", `/master/addons/${addon.id}/disable`)).body.error.details, { active_count: 1 });
  await ok(call("POST", `/products/${on2.id}/unpublish`));
  assert.equal((await platform("POST", `/master/addons/${addon.id}/disable`)).status, 200);
  assert.deepEqual(reasonsOf(await ok(call("GET", `/products/${on1.id}/publish-check`)), "service_rules"), ["/addons/0/addon_id ADDON_DISABLED"]);
  assert.deepEqual(reasonsOf(await ok(call("GET", `/products/${off.id}/publish-check`)), "service_rules"), [], "关着的不查");
  // 应答里只有个数，没有任何商品内容（平台看不到供应商的商品）
  assert.doesNotMatch(blocked.text, new RegExp(`${on1.id}|${on1.code}|成田机场接送`));
  for (const product of [off]) await ok(call("POST", `/products/${product.id}/unpublish`));
});

test("并发：上架事务进行中（检查已通过、还没提交）时删除 / 停用它选的区域——要等上架结束，然后被拒（409 AREA_IN_USE），不会两边都成功", async () => {
  for (const [method, suffix] of [["DELETE", ""], ["POST", "/disable"]] as const) {
    const target = await area();
    const product = await completeDraft({ areas: [{ area_id: ids["area"] }, { area_id: target.id }] });
    await addPrice(product.id);
    const raced = await whileUncommitted(() => call("POST", `/products/${product.id}/publish`), () => call(method, `/areas/${target.id}${suffix}`));
    assert.equal(raced.blockedByLock, true, `${method}${suffix} 应该等上架事务结束`);
    assert.equal(raced.first.status, 200, raced.first.text);
    assert.deepEqual([errorOf(raced.second), raced.second.body?.error?.details], [[409, "AREA_IN_USE"], { published_product_count: 1 }], `${method}${suffix}：${raced.second.text}`);
    const now = await ok(call("GET", `/products/${product.id}`));
    assert.deepEqual([now.status, now.areas.map((item: any) => [item.area_id, item.status])], ["published", [[ids["area"], "active"], [target.id, "active"]]]);
    await ok(call("POST", `/products/${product.id}/unpublish`));
  }
});

test("并发：已上架的商品正在加选一个区域（检查已通过、还没提交）时停用 / 删除这个区域——要等修改结束，然后被拒，不会留下「已上架却用着已停用区域」的商品", async () => {
  for (const [method, suffix] of [["POST", "/disable"], ["DELETE", ""]] as const) {
    const target = await area();
    const product = await completeDraft();
    const version = await publish(product.id);
    const raced = await whileUncommitted(
      () => call("PATCH", `/products/${product.id}`, { version, body: { areas: [{ area_id: ids["area"] }, { area_id: target.id }] } }),
      () => call(method, `/areas/${target.id}${suffix}`),
    );
    assert.equal(raced.blockedByLock, true, `${method}${suffix} 应该等修改结束`);
    assert.equal(raced.first.status, 200, raced.first.text);
    assert.deepEqual([errorOf(raced.second), raced.second.body?.error?.details], [[409, "AREA_IN_USE"], { published_product_count: 1 }], raced.second.text);
    const now = await ok(call("GET", `/products/${product.id}`));
    assert.deepEqual([now.status, now.areas.map((item: any) => [item.area_id, item.status])], ["published", [[ids["area"], "active"], [target.id, "active"]]]);
    await ok(call("POST", `/products/${product.id}/unpublish`));
  }
});

/** 上架和平台停用它引用的一条主数据同时发生：只能成一个，结束后不会有「已上架却用着已停用的东西」。 */
async function publishAgainstDisable(productId: string, disablePath: string, what: string): Promise<void> {
  // 上架先到（检查已通过、还没提交）：停用要等它结束，然后数到这个已上架的商品而被拒
  const raced = await whileUncommitted(() => call("POST", `/products/${productId}/publish`), () => platform("POST", disablePath));
  try {
    assert.ok(!(raced.first.status === 200 && raced.second.status === 200), `上架和停用${what}都成功了：两边的检查都通过了`);
    assert.equal(raced.blockedByLock, true, `停用${what}应该等上架事务结束`);
    assert.equal(raced.first.status, 200, raced.first.text);
    assert.deepEqual([errorOf(raced.second), raced.second.body?.error?.details], [[409, "MASTER_DATA_IN_USE"], { active_count: 1 }], raced.second.text);
  } finally {
    await ok(call("POST", `/products/${productId}/unpublish`));
  }
  // 反过来，停用先到（还没提交）：上架要等它结束，然后因为引用已停用而不通过
  const reversed = await whileUncommitted(() => platform("POST", disablePath), () => call("POST", `/products/${productId}/publish`));
  assert.equal(reversed.blockedByLock, true, `上架应该等停用${what}的事务结束`);
  assert.equal(reversed.first.status, 200, reversed.first.text);
  assert.deepEqual(errorOf(reversed.second), [409, "PUBLISH_CHECK_FAILED"], reversed.second.text);
  assert.equal((await ok(call("GET", `/products/${productId}`))).status, "unpublished");
}

test("并发：上架事务进行中（已经读到车型组是启用的、还没提交）时平台停用这个车型组——不应该两边都成功，留下「已上架却用着已停用车型组」的商品", async () => {
  // 原来的复现是手工重放上架的步骤；M1-04 接上真实上架之后改成走真实的 POST …/publish。
  // 修之前：上架一侧不锁它用到的平台主数据，停用时数到 0 个已上架商品直接成功，随后上架提交——商品已上架、车型组已停用。
  const group = await ok(platform("POST", "/master/vehicle-groups", { grade: "luxury", seats: 4, power: "fuel", combos: [{ passengers: 3, luggage: 2 }], code: "VG-LUX-4", name: { zh: "QA 豪华 4 座" } }), 201);
  const product = await completeDraft({ vehicle_groups: [{ vehicle_group_id: group.id, passengers: 3, luggage: 2 }] });
  await addPrice(product.id);
  await publishAgainstDisable(product.id, `/master/vehicle-groups/${group.id}/disable`, "车型组");
  const now = await ok(call("GET", `/products/${product.id}`));
  assert.deepEqual([now.status, now.vehicle_groups[0].status], ["unpublished", "disabled"]);
});

test("并发：上架 vs 平台停用它的接送点 / 城市 / 开着的附加服务——同样只能成一个", async () => {
  const airport = await ok(platform("POST", "/master/places", { type: "airport", code: "QAR", city_id: ids["tokyo"], name: { zh: "QA 并发机场" }, location: { lng: 140.2, lat: 35.6 }, flight_scope: "mixed" }), 201);
  const withPlace = await completeDraft({ poi_id: airport.id });
  await addPrice(withPlace.id);
  await publishAgainstDisable(withPlace.id, `/master/places/${airport.id}/disable`, "接送点");

  const addon = await ok(platform("POST", "/master/addons", { code: "ADD-QA_RACE", categories: ["airport_transfer"], charge_unit: "per_order", name: { zh: "QA 并发附加服务" } }), 201);
  const withAddon = await completeDraft({}, { ...RULES, addons: [{ addon_id: addon.id, unit_price: 500 }] });
  await addPrice(withAddon.id);
  await publishAgainstDisable(withAddon.id, `/master/addons/${addon.id}/disable`, "附加服务");

  const town = await ok(platform("POST", "/master/cities", { code: "CTY-JP-QAR", country_code: "JP", timezone: "Asia/Tokyo", name: { zh: "QA 并发城市" }, center: { lng: 139.7, lat: 35.7 } }), 201);
  const zone = await area({ city_id: town.id });
  const inTown = await ok(call("POST", "/products", { body: { brand_id: ids["brand"], city_id: town.id, category: "point_to_point", areas: [{ area_id: zone.id }], vehicle_groups: [{ vehicle_group_id: ids["biz7"], passengers: 6, luggage: 2 }], dispatchers: [{ name: "调度小王", phone: "0312345678" }] } }), 201);
  const rules = await ok(call("PUT", `/products/${inTown.id}/service-rules`, { version: inTown.version, body: { booking: RULES.booking, free_wait: { general: { mode: "limited", minutes: 15 } } } }));
  await ok(call("PUT", `/products/${inTown.id}/content`, { version: rules.version, body: { zh: { title: "QA 并发城市点对点" } } }));
  await addPrice(inTown.id);
  await publishAgainstDisable(inTown.id, `/master/cities/${town.id}/disable`, "城市");
});

test("并发：已上架的商品正在换上一个车型组 / 开一个附加服务（检查已通过、还没提交）时平台停用它——要等修改结束，然后被拒", async () => {
  const group = await ok(platform("POST", "/master/vehicle-groups", { grade: "luxury", seats: 5, power: "fuel", combos: [{ passengers: 4, luggage: 2 }], code: "VG-LUX-5", name: { zh: "QA 豪华 5 座" } }), 201);
  const addon = await ok(platform("POST", "/master/addons", { code: "ADD-QA_RACE2", categories: ["airport_transfer"], charge_unit: "per_order", name: { zh: "QA 并发附加服务 2" } }), 201);
  const product = await completeDraft();
  const version = await publish(product.id);
  const groups = [{ vehicle_group_id: ids["biz7"], passengers: 6, luggage: 2 }, { vehicle_group_id: group.id, passengers: 4, luggage: 2 }];
  const swapped = await whileUncommitted(() => call("PATCH", `/products/${product.id}`, { version, body: { vehicle_groups: groups } }), () => platform("POST", `/master/vehicle-groups/${group.id}/disable`));
  assert.equal(swapped.blockedByLock, true, "停用车型组应该等修改结束");
  assert.equal(swapped.first.status, 200, swapped.first.text);
  assert.deepEqual([errorOf(swapped.second), swapped.second.body?.error?.details], [[409, "MASTER_DATA_IN_USE"], { active_count: 1 }], swapped.second.text);
  const opened = await whileUncommitted(
    () => call("PUT", `/products/${product.id}/service-rules`, { version: swapped.first.body.version, body: { ...RULES, addons: [{ addon_id: addon.id, unit_price: 500 }] } }),
    () => platform("POST", `/master/addons/${addon.id}/disable`),
  );
  assert.equal(opened.blockedByLock, true, "停用附加服务应该等修改结束");
  assert.equal(opened.first.status, 200, opened.first.text);
  assert.deepEqual([errorOf(opened.second), opened.second.body?.error?.details], [[409, "MASTER_DATA_IN_USE"], { active_count: 1 }], opened.second.text);
  await ok(call("POST", `/products/${product.id}/unpublish`));
});

// ---------- 暂停的供应商、越权的细节 ----------

test("暂停的供应商：照常能看、能改自己的子品牌和商品（暂停只影响比价，不冻结配置，和区域一致）；恢复后也一样", async () => {
  const paused = await api.tenantWithAdmin(root, "QA 被暂停的车队", "admin@qa-paused.test");
  const token = paused.adminToken;
  const brand = await ok(call("POST", "/brands", { token, body: { name: "暂停前的品牌", currency: "JPY" } }), 201);
  const product = await ok(call("POST", "/products", { token, body: { brand_id: brand.id, city_id: ids["tokyo"], category: "charter" } }), 201);
  assert.equal((await platform("POST", `/tenants/${paused.tenantId}/suspend`, { reason: "QA" })).status, 200);
  for (const path of ["/brands", "/products", `/products/${product.id}`, `/products/${product.id}/service-rules`, `/products/${product.id}/content`, `/products/${product.id}/publish-check`]) {
    assert.equal((await call("GET", path, { token })).status, 200, path);
  }
  assert.equal((await call("POST", "/brands", { token, body: { name: "暂停期间的品牌", currency: "KRW" } })).status, 201);
  assert.equal((await call("PUT", `/brands/${brand.id}`, { token, version: 1, body: { name: "暂停期间改名" } })).status, 200);
  const made = await ok(call("POST", "/products", { token, body: { brand_id: brand.id, city_id: ids["tokyo"], category: "point_to_point" } }), 201);
  assert.equal((await call("PATCH", `/products/${product.id}`, { token, version: 1, body: { dispatchers: [{ name: "x", phone: "0312345678" }] } })).status, 200);
  assert.equal((await call("PUT", `/products/${product.id}/service-rules`, { token, version: 2, body: { booking: { lead_time_hours: 1 } } })).status, 200);
  assert.equal((await call("PUT", `/products/${product.id}/content`, { token, version: 3, body: { zh: { title: "暂停期间" } } })).status, 200);
  assert.deepEqual(errorOf(await call("POST", `/products/${product.id}/publish`, { token })), [409, "PUBLISH_CHECK_FAILED"]);
  assert.deepEqual(errorOf(await call("POST", `/products/${product.id}/unpublish`, { token })), [409, "PRODUCT_STATE_INVALID"]);
  assert.equal((await call("DELETE", `/products/${made.id}`, { token })).status, 204);
  assert.equal((await platform("POST", `/tenants/${paused.tenantId}/resume`)).status, 200);
  assert.equal((await ok(call("GET", `/products/${product.id}`, { token }))).version, 4);
});

test("规则 4：写操作的应答、各种被拒的应答、列表和校验结果里都没有对外价、加价比例字样，也没有 tenant_id", async () => {
  const product = await completeDraft();
  const texts: string[] = [];
  const keep = async (res: Promise<ApiResponse>): Promise<void> => void texts.push((await res).text);
  await keep(call("POST", "/brands", { body: { name: "规则四品牌", currency: "JPY", markup_bps: 1500, sell_price: 1 } }));
  await keep(call("POST", "/products", { body: { ...BASE(), markup_bps: 1500, sell_price: 99_999, tenant_id: MISSING } }));
  await keep(call("PATCH", `/products/${product.id}`, { version: product.version, body: { dispatchers: [{ name: "小周", phone: "0312345678" }], markup_bps: 1 } }));
  await keep(call("PUT", `/products/${product.id}/service-rules`, { version: product.version + 1, body: { ...RULES, sell_price: 1, markup: { bps: 1 } } }));
  await keep(call("PUT", `/products/${product.id}/content`, { version: product.version + 2, body: { zh: { title: "规则四", pickup_guide: "3 号门" } } }));
  await keep(call("POST", `/products/${product.id}/publish`));
  await keep(call("POST", `/products/${product.id}/unpublish`));
  await keep(call("PATCH", `/products/${product.id}`, { version: 1, body: {} }));
  await keep(call("PUT", `/products/${product.id}/service-rules`, { version: product.version + 3, body: { night: { amount: -1 } } }));
  for (const path of ["/brands", "/products?limit=200", `/products/${product.id}`, `/products/${product.id}/service-rules`, `/products/${product.id}/content`, `/products/${product.id}/publish-check`, "/dashboard/summary"]) await keep(call("GET", path));
  assert.equal(texts.length, 16);
  for (const text of texts) {
    assert.doesNotMatch(text, /markup|sell_price|selling_price|public_price|对外价|加价比例|tenant_id/i, text.slice(0, 200));
    assert.ok(!text.includes(tenant.tenantId), "应答里没有供应商编号");
  }
});
