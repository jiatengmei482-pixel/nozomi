/**
 * 区域重叠清理（ADR 0102 第五节第 3 步）：runAreaCleanup，部署时由 area-cleanup-cli.ts 用迁移账号执行。经真实接口建数据、真实 PostgreSQL。
 * - 试跑：算出计数，库里什么都不变（备份、记录也回滚）；
 * - 执行：名称带「·通用」的标成平台共享；同名同形状、一份在用的重复里，没人用的停用（在用的哪怕在别的城市也不动）；
 *   包车商品同一层的重叠（同为供应商独立）切掉：大的减去小的；切完上架检查的三层重叠为 0；备份表有清理前的整行、图形和关联；
 * - 命令行参数。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { parseCleanupArgs } from "./db/area-cleanup-cli.ts";
import { cleanupCountsLine, runAreaCleanup } from "./services/area-cleanup.ts";
import type { ApiResponse, HttpMethod, TenantFixture, TestApi } from "./testing/api.ts";
import { createTestApi } from "./testing/api.ts";
import { type Market, buildMarket, ok } from "./testing/market.ts";
import { tenantLogin } from "./testing/money.ts";

let api: TestApi;
let m: Market;
const square = (west: number, south: number, east: number, north: number) => ({ type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });

async function tenantCall(who: TenantFixture, method: HttpMethod, path: string, options: { body?: unknown; version?: number } = {}): Promise<ApiResponse> {
  const token = await tenantLogin(api, who.adminEmail);
  api.clock.advance(1_000);
  return api.call(method, `/tenant/v1${path}`, {
    token,
    ...(options.body === undefined ? {} : { body: options.body }),
    headers: { ...(options.version === undefined ? {} : { "if-match": `"${options.version}"` }), ...(method === "POST" && /^\/(products|brands|areas)$|\/price-rules(\/batch)?$/.test(path) ? { "idempotency-key": randomUUID() } : {}) },
  });
}
async function newArea(cityId: string, name: string, polygon: ReturnType<typeof square>, bizType = "charter"): Promise<string> {
  return (await ok(tenantCall(m.b, "POST", "/areas", { body: { city_id: cityId, name: { zh: name }, biz_type: bizType, polygons: [{ kind: "operate", geometry: polygon }] } }), 201)).id;
}
const statusOf = async (id: string): Promise<{ status: string; sharing: string; shape_version: number }> => (await api.db.owner.query("select status, sharing, shape_version from areas where id = $1", [id])).rows[0];

let city: string;
let ward: string;
let tokyoShared: string;
let osakaShared: string;
let osakaUnusedTwin: string;

before(async () => {
  api = await createTestApi();
  m = await buildMarket(api);
  // 包车商品的①：同为供应商独立、同一层、互相重叠的两个区域（「东京市」包住一部分「浅草一带」）
  city = await newArea(m.ids.tokyo, "东京市", square(139.55, 35.55, 139.85, 35.80));
  ward = await newArea(m.ids.tokyo, "浅草一带", square(139.86, 35.70, 139.95, 35.75));
  // 「·通用」：东京、大阪各一份，形状相同；大阪还有一份同名同形状（另一个城市不能重名，所以放进大阪以外——用东京的商品挂东京那份）
  tokyoShared = await newArea(m.ids.tokyo, "箱根·通用", square(138.95, 35.15, 139.15, 35.30), "general");
  osakaShared = await newArea(m.ids.osaka, "箱根·通用", square(138.95, 35.15, 139.15, 35.30), "general");
  osakaUnusedTwin = osakaShared;
  const brand = (await ok(tenantCall(m.b, "POST", "/brands", { body: { name: `清理-${randomUUID().slice(0, 6)}`, currency: "JPY" } }), 201)).id;
  await ok(tenantCall(m.b, "POST", "/products", { body: { brand_id: brand, city_id: m.ids.tokyo, category: "charter", areas: [{ area_id: city }, { area_id: ward }, { area_id: tokyoShared }], vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0312345678" }] } }), 201);
  // 挂上商品之后在区域页把「浅草一带」往西扩，和「东京市」重叠（区域页改图形只提醒、不拦——测试站的旧重叠就是这样来的）
  const current = await ok(tenantCall(m.b, "GET", `/areas/${ward}`));
  await ok(tenantCall(m.b, "PUT", `/areas/${ward}`, { version: current.version, body: { name: { zh: "浅草一带" }, biz_type: "charter", polygons: [{ kind: "operate", geometry: square(139.78, 35.70, 139.95, 35.75) }] } }));
});
after(async () => {
  await api?.close();
});

test("命令行参数：--dry-run / --apply 二选一，或按 AREA_OVERLAP_CLEANUP；别的报错", () => {
  assert.equal(parseCleanupArgs(["--dry-run"]), "dry-run");
  assert.equal(parseCleanupArgs([], { AREA_OVERLAP_CLEANUP: "apply" }), "apply");
  assert.throws(() => parseCleanupArgs([]), /dry-run/);
  assert.throws(() => parseCleanupArgs(["--dry-run", "--apply"]), /dry-run/);
  assert.throws(() => parseCleanupArgs(["--x"]), /不认识/);
  assert.throws(() => parseCleanupArgs([], { AREA_OVERLAP_CLEANUP: "yes" }), /dry-run/);
});

test("试跑：计数里有标共享、停用没人用的重复、切掉的重叠，库里什么都不变（备份、记录也不留）", async () => {
  const report = await runAreaCleanup(api.db.owner, { mode: "dry-run", now: new Date(api.clock.now()) });
  assert.ok(report.counts.markedShared >= 2);
  assert.equal(report.counts.disabled, 1);
  assert.ok(report.counts.overlapsBefore >= 1);
  assert.equal(report.counts.overlapsAfter, 0);
  assert.match(cleanupCountsLine(report), /试跑，没有写库/);
  assert.doesNotMatch(cleanupCountsLine(report), /箱根|东京市|浅草/, "日志里没有区域名称");
  assert.deepEqual(await statusOf(osakaUnusedTwin), { status: "active", sharing: "own", shape_version: 1 });
  assert.equal((await statusOf(city)).shape_version, 1);
  assert.equal((await api.db.owner.query("select count(*)::int as n from area_cleanup_backups")).rows[0].n, 0);
  assert.equal((await api.db.owner.query("select count(*)::int as n from area_cleanup_runs")).rows[0].n, 0);
});

test("执行：「·通用」标成平台共享；在用的那份不动、没人用的那份停用；同层重叠大的减去小的，之后三层重叠为 0；备份有清理前的整行、图形和关联", async () => {
  const wardBefore = (await statusOf(ward)).shape_version;
  const report = await runAreaCleanup(api.db.owner, { mode: "apply", now: new Date(api.clock.now()) });
  assert.equal((await statusOf(tokyoShared)).sharing, "shared");
  assert.equal((await statusOf(tokyoShared)).status, "active", "在用的那份不动");
  assert.deepEqual([(await statusOf(osakaUnusedTwin)).status, (await statusOf(osakaUnusedTwin)).sharing], ["disabled", "shared"]);
  assert.equal(report.counts.overlapsAfter, 0);
  assert.ok(report.counts.subtracted >= 1);
  assert.equal((await statusOf(city)).shape_version, 2, "大的「东京市」被减去「浅草一带」");
  assert.equal((await statusOf(ward)).shape_version, wardBefore, "小的不动");
  const cut = report.changes.find((change) => change.action === "subtract");
  assert.deepEqual([cut?.areaId, cut?.keepAreaId], [city, ward]);
  assert.ok((cut?.removedM2 ?? 0) > 1_000_000);

  const backup = (await api.db.owner.query("select area, polygons, refs from area_cleanup_backups where run_id = $1 and area_id = $2", [report.runId, city])).rows[0];
  assert.equal(backup.area.shape_version, 1, "备份的是清理前的样子");
  assert.equal(backup.polygons.length, 1);
  assert.equal(backup.refs.product_areas.length, 1);
  assert.equal((await api.db.owner.query("select count(*)::int as n from area_cleanup_runs where id = $1 and mode = 'apply'", [report.runId])).rows[0].n, 1);

  // 再跑一次：没有新的改动
  const again = await runAreaCleanup(api.db.owner, { mode: "dry-run", now: new Date(api.clock.now()) });
  assert.deepEqual([again.counts.markedShared, again.counts.disabled, again.counts.subtracted, again.counts.overlapsBefore], [0, 0, 0, 0]);
});
