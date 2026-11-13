/**
 * M8-20 切换前的只读清单 `pnpm areas:role-preview`（ADR 0075 第三部分第 3 节）：
 * - 列出每个供应商的区域数（按业务类型、启停、用途）、已上架商品勾选的报价区域；
 * - 回放最近 N 天询价日志里的请求（渠道的、官网的两种写法），「迁移后的用途」和「不做运营判断」对外结果 0 处不同；
 *   内部原因的细分（`OUT_OF_SERVICE_AREA` → `NO_PRICING_AREA`）单独计数；迁移前（区域还没有用途这一列）按每个区域都是运营 + 报价算；
 * - 只读：在平台的只读事务里，数据库拒绝任何写入；命令没有写入的开关。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readPreviewOptions } from "./cli/areas-role-preview.ts";
import { withPlatformTx } from "./db/context.ts";
import { buildRolePreview, renderRolePreview } from "./services/area-role-preview.ts";
import type { TestApi } from "./testing/api.ts";
import { createTestApi } from "./testing/api.ts";
import { type Market, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

let api: TestApi;
let m: Market;
let site: SiteApi;

const square = (west: number, south: number, east: number, north: number) => ({ type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });
const preview = (days = 30) => withPlatformTx(api.db.pool, (db) => buildRolePreview(db, { days, now: api.clock.now() }), { snapshot: true });

before(async () => {
  api = await createTestApi();
  m = await buildMarket(api);
  // 甲另有一个商品没选的区域（运营 + 报价）：点落在那里时内部原因细分为 NO_PRICING_AREA
  await ok(api.call("POST", "/tenant/v1/areas", { token: m.a.adminToken, headers: { "idempotency-key": randomUUID() }, body: { city_id: m.ids.tokyo, name: { zh: "千叶" }, biz_type: "general", polygons: [{ kind: "operate", geometry: square(140.0, 35.0, 141.0, 36.0) }] } }), 201);
  api.clock.advance(31_000);
  const channel = await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" });
  const creds = await salesCredentials(api, m, channel.id);
  site = await siteApi(api, creds.clientId, null);
  const quote = (dropoff: { lng: number; lat: number }, extra: Record<string, unknown> = {}) =>
    ok(api.call("POST", "/sales/v1/quotes", { token: creds.token, body: { city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, direction: "pickup", dropoff, service_time: "2026-10-20T10:00:00+09:00", passengers: 2, luggage: 1, currency: "JPY", ...extra } }));
  await quote({ lng: 139.7, lat: 35.6 });
  await quote({ lng: 140.5, lat: 35.5 });
  await quote({ lng: 145, lat: 35.5 });
  await quote({ lng: 139.7, lat: 35.6 }, { service_time: "2026-10-07T12:00:00+09:00" });
  await ok(site.call("POST", "/site/v1/quotes", { body: { city_id: m.ids.tokyo, airport_id: m.ids.narita, direction: "dropoff", address: { lng: 140.5, lat: 35.5 }, service_local: "2026-10-21T08:00", passengers: 1 } }));
  await api.app.backgroundIdle();
  await site.app.backgroundIdle();
  // 回放窗口不含截止时间（默认现在）：测试的时钟是停着的，往前走 1 毫秒，刚才的询价才在窗口里（真实环境里时间总在走）
  api.clock.advance(1);
});
after(async () => {
  await site?.close();
  await api.close();
});

test("清单：每个供应商的区域数（按业务类型、启停、用途）、已上架商品勾选的报价区域；回放询价对外结果 0 处不同，内部原因的细分单独计数", async () => {
  const result = await preview();
  assert.equal(result.migrated, true);
  assert.equal(result.totalAreas, 3);
  const byName = new Map(result.suppliers.map((supplier) => [supplier.tenantName, supplier]));
  assert.deepEqual(byName.get("甲车队"), { tenantId: m.a.tenantId, tenantName: "甲车队", total: 2, byBizType: { general: 2 }, byStatus: { active: 2 }, byRole: { both: 2 } });
  assert.deepEqual(byName.get("乙车队")?.total, 1);
  assert.deepEqual(result.published.map((product) => [product.tenantName, product.productAreas, product.surchargeAreas, product.routeAreas]).sort(), [["乙车队", ["东京全域"], [], []], ["甲车队", ["东京全域"], [], []]]);
  assert.deepEqual([result.replay.logs, result.replay.replayed, result.replay.skipped, result.replay.evaluations], [5, 5, 0, 10]);
  assert.deepEqual([result.replay.externalDiffCount, result.replay.externalDiffs], [0, []]);
  // 千叶的两次询价：甲的商品没选千叶，内部原因细分（对外一样）
  assert.deepEqual(result.replay.refinements, { "OUT_OF_SERVICE_AREA → NO_PRICING_AREA": 2 });
  const text = renderRolePreview(result);
  assert.match(text, /对外结果不同：0 处（可以上线）/);
  assert.match(text, /OUT_OF_SERVICE_AREA → NO_PRICING_AREA 2 次/);
  // 报价结果摘要值：每次「询价 × 候选商品」一行；同样的数据再跑一次摘要不变
  assert.equal(result.replay.resultLines, result.replay.evaluations);
  assert.match(result.replay.resultDigest, /^[0-9a-f]{64}$/);
  assert.equal((await preview()).replay.resultDigest, result.replay.resultDigest);
  assert.ok(text.includes(`10 行）：${result.replay.resultDigest}；回放用到的数据的状态摘要：${result.replay.stateDigest}`));
  assert.match(result.replay.stateDigest, /^[0-9a-f]{64}$/);
  assert.equal(result.replay.until, api.clock.now().toISOString());
  assert.ok(!text.includes("140.5") && !text.includes("35.5"), "不打印坐标");
  // 回放的天数：询价都在今天，0 天以前的不算
  assert.equal((await preview(1)).replay.logs, 5);
});

test("只读：清单在平台的只读事务里，数据库拒绝写入；命令没有写入的开关，天数要在 1–90", async () => {
  await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query("insert into uncovered_demand_drops (day, dropped) values ('2026-01-01', 1)"), { snapshot: true }), { code: "25006" });
  assert.deepEqual(readPreviewOptions([]), { days: 30, json: false });
  assert.deepEqual(readPreviewOptions(["--days", "7", "--json"]), { days: 7, json: true });
  for (const argv of [["--execute"], ["--apply"], ["--days", "0"], ["--days", "91"], ["--days", "x"], ["extra"]]) assert.throws(() => readPreviewOptions(argv), /参数不正确|--days/, argv.join(" "));
});

test("摘要值：供应商的价改一分钱，结果摘要和状态摘要都变；改回来，两个摘要都和原来一样（引擎改动前后比对用）", async () => {
  const original = (await preview()).replay;
  const bump = async (delta: number) => {
    const updated = await api.db.owner.query("update price_rules set params = jsonb_set(params, '{basePriceMinor}', to_jsonb((params->>'basePriceMinor')::bigint + $2)) where tenant_id = $1 and pricing_model = 'fixed'", [m.a.tenantId, delta]);
    assert.ok((updated.rowCount ?? 0) > 0);
  };
  await bump(1);
  const changed = (await preview()).replay;
  assert.notEqual(changed.resultDigest, original.resultDigest);
  assert.notEqual(changed.stateDigest, original.stateDigest);
  assert.equal(changed.resultLines, original.resultLines);
  // 逐行摘要能定位到变了的行：甲的商品的每一行
  const moved = changed.resultLineDigests.filter((entry, i) => entry.digest !== original.resultLineDigests[i]?.digest);
  assert.ok(moved.length > 0 && moved.length < original.resultLines);
  await bump(-1);
  const restored = (await preview()).replay;
  assert.deepEqual([restored.resultDigest, restored.stateDigest], [original.resultDigest, original.stateDigest]);
});

test("迁移之前（区域还没有用途这一列）：按迁移后的样子算——每个区域都是运营 + 报价，回放结果和迁移之后一样", async () => {
  const migrated = await preview();
  // 模拟还没执行迁移 0290 的库：去掉用途这一列（这是本文件最后一条用例，测试的 schema 随后整个删除）
  await api.db.owner.query("alter table areas drop column role cascade");
  const before = await preview();
  assert.equal(before.migrated, false);
  assert.deepEqual(before.suppliers, migrated.suppliers);
  assert.deepEqual(before.replay, migrated.replay);
  assert.match(renderRolePreview(before), /还没执行，按迁移后的样子算/);
});
