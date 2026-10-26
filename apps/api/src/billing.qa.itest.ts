/**
 * M5-01 测试角色补充：供应商应付账单与付款批次（ADR 0040），经真实接口、真实 PostgreSQL。
 * 每个测试自己建一个测试库（`createTestApi`，有自己的时钟），自己建供应商和订单，结束随 schema 一起删除（规则 1）；测试之间不共享数据、不依赖执行顺序。
 *
 * - 金额：随机数据下和一套独立的对照实现核对每个币种的合计、明细；违约金等救援结论才扣；不可抗力在下一期退回且只退一次；多币种负数结转；
 * - 切月：城市当地日期跨月（东京、洛杉矶、奥克兰）、月末最后一分钟、闰年 2 月、出账时机按东京日期；
 * - 幂等与并发：同时出账只出一份；同时作废只作废一次；作废重出不重复计入；同时发起复核只有一条；
 * - 付款日：20 日当天最后一秒、21 日零点、锁定后顺延、连锁两个月顺延到下下个 20 日；
 * - 确认期正好 7 天；答复后重新计 7 天；
 * - 双人复核与权限；数据范围受限的员工；
 * - 租户隔离（接口 + 数据库层）；规则 4（字段扫描 + 按值比对）；
 * - 状态流转的非法跳转。
 */
import { type TestContext, test } from "node:test";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { type CurrencyCode, ORDER_NO_ALPHABET, dispatchDeadline, formatMajor, localDateTimeToInstant } from "@nozomi/domain";
import { withTenantTx } from "./db/context.ts";
import { TEST_PASSWORD, type TenantFixture, type TestApi, createTestApi } from "./testing/api.ts";
import { deniedByDatabase } from "./testing/db.ts";
import { type Staff, addStaff, allKeys, buildMarket, marketProduct, ok } from "./testing/market.ts";
import { platformLogin, tenantLogin } from "./testing/money.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { salesFlow } from "./testing/sales-flow.ts";

const DAY = 24 * 3_600_000;

interface World {
  api: TestApi;
  ids: { tokyo: string; la: string; akl: string; narita: string; biz7: string };
  finance1: Staff;
  finance2: Staff;
  root(): Promise<string>;
  fin1(): Promise<string>;
  fin2(): Promise<string>;
}

interface Supplier extends TenantFixture {
  name: string;
  productId: string;
}

/** 一个独立的测试库：东京、洛杉矶、奥克兰三个城市，成田机场，商务 7 座，两位财务。 */
async function world(t: TestContext): Promise<World> {
  const api = await createTestApi();
  t.after(() => api.close());
  const rootToken = await api.superAdminToken();
  const create = async (path: string, body: unknown): Promise<string> => (await ok(api.call("POST", `/platform/v1${path}`, { token: rootToken, body }), 201)).id;
  const tokyo = await create("/master/cities", { country_code: "JP", timezone: "Asia/Tokyo", code: "CTY-JP-TYO", name: { zh: "东京" }, center: { lng: 139.6917, lat: 35.6895 } });
  const la = await create("/master/cities", { country_code: "US", timezone: "America/Los_Angeles", code: "CTY-US-LAX", name: { zh: "洛杉矶" }, center: { lng: -118.2437, lat: 34.0522 } });
  const akl = await create("/master/cities", { country_code: "NZ", timezone: "Pacific/Auckland", code: "CTY-NZ-AKL", name: { zh: "奥克兰" }, center: { lng: 174.7633, lat: -36.8485 } });
  const narita = await create("/master/places", { location: { lng: 140.3887, lat: 35.7686 }, type: "airport", code: "NRT", city_id: tokyo, name: { zh: "成田机场" }, flight_scope: "international" });
  const biz7 = await create("/master/vehicle-groups", { grade: "business", seats: 7, power: "fuel", combos: [{ passengers: 6, luggage: 4 }], code: "VG-BIZ-7", name: { zh: "商务 7 座" } });
  const finance1 = await addStaff(api, rootToken, "fin1@platform.test", "finance");
  const finance2 = await addStaff(api, rootToken, "fin2@platform.test", "finance");
  return {
    api,
    ids: { tokyo, la, akl, narita, biz7 },
    finance1,
    finance2,
    root: () => platformLogin(api, "root@platform.test"),
    fin1: () => platformLogin(api, finance1.email),
    fin2: () => platformLogin(api, finance2.email),
  };
}

async function supplier(w: World, name: string): Promise<Supplier> {
  const fixture = await w.api.tenantWithAdmin(await w.root(), name, `admin-${randomUUID().slice(0, 8)}@supplier.test`);
  return { ...fixture, name, productId: await marketProduct(w.api, fixture, w.ids, [[w.ids.biz7, 20_000]]) };
}

function moveTo(w: World, iso: string): void {
  const delta = new Date(iso).getTime() - w.api.clock.now().getTime();
  assert.ok(delta >= 0, `时钟只能往后拨：${iso}`);
  w.api.clock.advance(delta);
}

interface OrderOptions {
  tz?: string;
  cityId?: string;
  status?: string;
  settlement?: number;
  currency?: string;
  share?: number;
  feeBp?: number;
}

interface Seeded {
  id: string;
  orderNo: string;
  serviceDate: string;
}

function newOrderNo(at: Date): string {
  let random = "";
  for (let i = 0; i < 8; i += 1) random += ORDER_NO_ALPHABET[randomInt(ORDER_NO_ALPHABET.length)];
  return `NZ${at.toISOString().slice(0, 10).replaceAll("-", "")}${random}`;
}

/** 一张城市当地时间 `local`（YYYY-MM-DDTHH:mm）的订单：服务日期就是当地日期（和下单时一样），按需要摆成各种终态。 */
async function order(w: World, who: Supplier, local: string, options: OrderOptions = {}): Promise<Seeded> {
  const tz = options.tz ?? "Asia/Tokyo";
  const cityId = options.cityId ?? (tz === "America/Los_Angeles" ? w.ids.la : tz === "Pacific/Auckland" ? w.ids.akl : w.ids.tokyo);
  const serviceAt = localDateTimeToInstant(local, tz);
  assert.ok(serviceAt, local);
  const confirmedAt = new Date(serviceAt.getTime() - 3 * DAY);
  const createdAt = new Date(confirmedAt.getTime() - 60_000);
  const id = randomUUID();
  const orderNo = newOrderNo(createdAt);
  const settlementMinor = options.settlement ?? 20_000;
  const currency = options.currency ?? "JPY";
  const settlement = { currency, roundingUnit: 1, totalMinor: settlementMinor, baseMinor: settlementMinor, adjustMinor: 0, urgentMinor: 0, nightMinor: 0, addonsMinor: 0, driverLanguageMinor: 0 };
  await w.api.db.owner.query(
    `insert into orders (tenant_id, id, order_no, status, category, city_id, place_id, direction, product_id, product_version, vehicle_group_id, service_at, service_local, timezone, service_date,
                         urgent, passengers, luggage, pickup, dropoff, addons, driver_language, flight_no, passenger, settlement_minor, settlement_currency, settlement, free_wait_minutes,
                         inventory_held, payment_due_at, confirmed_at, dispatch_due_at, created_at, updated_at)
     values ($1, $2, $3, 'confirmed', 'airport_transfer', $4, $5, 'pickup', $6, 1, $7, $8, $9, $10, $11,
             false, 2, 1, null, $12::jsonb, '[]'::jsonb, null, 'NH211', $13::jsonb, $14, $15, $16::jsonb, 90,
             false, $17, $18, $19, $20, $18)`,
    [
      who.tenantId, id, orderNo, cityId, w.ids.narita, who.productId, w.ids.biz7, serviceAt, local, tz, local.slice(0, 10),
      JSON.stringify({ lng: 139.7671, lat: 35.6812, address: "东京站八重洲口" }), JSON.stringify({ name: "王小明", phone: "+819012345678", email: "guest@example.com" }),
      settlementMinor, currency, JSON.stringify(settlement), new Date(createdAt.getTime() + 30 * 60_000), confirmedAt, dispatchDeadline(confirmedAt, serviceAt), createdAt,
    ],
  );
  const status = options.status ?? "completed";
  if (status === "cancelled") {
    await w.api.db.owner.query("update orders set status = 'cancelled', cancelled_at = $3, cancel_reason = 'GUEST_REQUEST', cancel_fee_bp = $4, cancel_tenant_share_minor = $5 where tenant_id = $1 and id = $2", [who.tenantId, id, serviceAt, options.feeBp ?? 0, options.share ?? 0]);
  } else if (status === "rescued") {
    await w.api.db.owner.query("update orders set status = 'rescued', rescued_at = $3 where tenant_id = $1 and id = $2", [who.tenantId, id, serviceAt]);
  } else if (status !== "confirmed") {
    await setStatus(w, who, id, status);
  }
  return { id, orderNo, serviceDate: local.slice(0, 10) };
}

async function setStatus(w: World, who: Supplier, orderId: string, status: string): Promise<void> {
  if (status === "rescued") {
    await w.api.db.owner.query("update orders set status = 'rescued', rescued_at = $3 where tenant_id = $1 and id = $2", [who.tenantId, orderId, w.api.clock.now()]);
    return;
  }
  await w.api.db.owner.query("update orders set status = $3 where tenant_id = $1 and id = $2", [who.tenantId, orderId, status]);
}

/** 事后加收：`charged` 已扣到款（`approved` 部分通过的金额）；别的状态按库里的约束摆好。 */
async function extraCharge(w: World, who: Supplier, orderId: string, amount: number, status: "charged" | "in_window" | "approved" | "rejected", approved: number | null = null, currency = "JPY"): Promise<string> {
  const id = randomUUID();
  const submitted = new Date("2026-09-01T00:00:00Z");
  const until = new Date(submitted.getTime() + 2 * DAY);
  const decided = status === "in_window" ? null : new Date(until.getTime() + 1_000);
  await w.api.db.owner.query(
    `insert into order_extra_charges (tenant_id, id, order_id, type, amount_minor, currency, status, review_reasons, submitted_at, submitted_by, dispute_until, decided_at, decided_by, approved_minor, charged_at, created_at, updated_at)
     values ($1, $2, $3, 'waiting', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $8, $8)`,
    [who.tenantId, id, orderId, amount, currency, status, decided === null ? [] : ["OVER_THRESHOLD"], submitted, who.adminId, until, decided, decided === null ? null : w.finance1.id, approved, status === "charged" ? new Date(until.getTime() + 2_000) : null],
  );
  return id;
}

/** 一条应扣款项（违约金），挂在一次已结束的救援上。 */
async function deduction(w: World, who: Supplier, orderId: string, amount: number, currency = "JPY"): Promise<string> {
  const rescueId = randomUUID();
  const at = new Date("2026-09-01T00:00:00Z");
  await w.api.db.owner.query(
    `insert into order_rescues (id, order_id, original_tenant_id, trigger, triggered_by_type, triggered_at, from_status, service_at, original_settlement_minor, original_settlement_currency, penalty_bp, penalty_tier, status, closed_at, created_at, updated_at)
     values ($1, $2, $3, 'dispatch_overdue', 'system', $4, 'confirmed', $4, 20000, $5, 10000, 'full', 'cancelled', $4, $4, $4)`,
    [rescueId, orderId, who.tenantId, at, currency],
  );
  const id = randomUUID();
  await w.api.db.owner.query(
    `insert into tenant_deductions (tenant_id, id, order_id, rescue_id, kind, amount_minor, currency, basis, status, created_at, updated_at)
     values ($1, $2, $3, $4, 'penalty', $5, $6, '{"bp": 10000}'::jsonb, 'pending', $7, $7)`,
    [who.tenantId, id, orderId, rescueId, amount, currency, at],
  );
  return id;
}

async function waive(w: World, who: Supplier, deductionId: string): Promise<void> {
  await w.api.db.owner.query("update tenant_deductions set status = 'waived', waived_at = $3, waive_reason = '台风停运（不可抗力）' where tenant_id = $1 and id = $2", [who.tenantId, deductionId, w.api.clock.now()]);
}

async function generate(w: World, period: string): Promise<any> {
  return ok(w.api.call("POST", "/platform/v1/statements/generate", { token: await w.fin1(), body: { period } }));
}

async function tenantList(w: World, who: Supplier, query = ""): Promise<any[]> {
  return (await ok(w.api.call("GET", `/tenant/v1/statements${query}`, { token: await tenantLogin(w.api, who.adminEmail) }))).items;
}

async function tenantDetail(w: World, who: Supplier, id: string): Promise<any> {
  return (await ok(w.api.call("GET", `/tenant/v1/statements/${id}`, { token: await tenantLogin(w.api, who.adminEmail) }))).statement;
}

async function platformDetail(w: World, id: string): Promise<any> {
  return (await ok(w.api.call("GET", `/platform/v1/statements/${id}`, { token: await w.fin1() }))).statement;
}

/** 这家供应商这一期这个币种的有效账单（没有为 undefined）。 */
async function current(w: World, who: Supplier, period: string, currency = "JPY"): Promise<any> {
  return (await tenantList(w, who, `?period=${period}`)).find((s) => s.currency === currency && s.status !== "void");
}

async function confirm(w: World, who: Supplier, id: string): Promise<void> {
  await ok(w.api.call("POST", `/tenant/v1/statements/${id}/confirm`, { token: await tenantLogin(w.api, who.adminEmail) }));
}

async function approvePayout(w: World, id: string): Promise<any> {
  const requested = await ok(w.api.call("POST", `/platform/v1/statements/${id}/payout-approval`, { token: await w.fin1(), body: {} }), 202);
  await ok(w.api.call("POST", `/platform/v1/approvals/${requested.approval.id}/approve`, { token: await w.fin2(), body: {} }));
  return platformDetail(w, id);
}

/** 同一笔应付不在两张有效的账单上（数据库里查）。 */
async function assertNoDoubleBilling(w: World): Promise<void> {
  const dup = await w.api.db.owner.query("select tenant_id, source_key, count(*)::int as n from statement_lines where voided_at is null group by 1, 2 having count(*) > 1");
  assert.deepEqual(dup.rows, [], "同一笔应付挂在了两张有效的账单上");
  const totals = await w.api.db.owner.query(
    `select s.id, s.total_minor::text as total, s.line_count, coalesce(sum(l.amount_minor), 0)::text as lines, count(l.id)::int as n
       from statements s left join statement_lines l on l.tenant_id = s.tenant_id and l.statement_id = s.id and l.voided_at is null
      where s.status <> 'void' group by s.id, s.total_minor, s.line_count`,
  );
  for (const row of totals.rows) assert.deepEqual([row.total, row.line_count], [row.lines, row.n], `账单 ${row.id} 的合计、条数和有效明细不一致`);
}

/** 有效账单（不含作废的）里这家供应商这种币种的合计：供应商实际拿到 / 被扣的总额。 */
async function netBilled(w: World, who: Supplier, currency = "JPY"): Promise<number> {
  const result = await w.api.db.owner.query("select coalesce(sum(total_minor), 0)::text as total from statements where tenant_id = $1 and currency = $2 and status not in ('void', 'carried')", [who.tenantId, currency]);
  return Number(result.rows[0].total);
}

const lineKeys = (detail: any): string[] => detail.lines.filter((line: any) => !line.voided).map((line: any) => `${line.kind}:${line.order_no}:${line.prior_period}`).sort();

// ==== 切月 ====

test("切月按城市当地日期：洛杉矶 9/30 23:30（东京已是 10/1）进 9 月；奥克兰 10/1 00:30（东京还是 9/30）进 10 月；东京 10/31 23:59 进 10 月、11/1 00:00 不进；东京 11/1 零点前不能出 10 月", async (t) => {
  const w = await world(t);
  const s = await supplier(w, "跨时区车队");
  const laSep30 = await order(w, s, "2026-09-30T23:30", { tz: "America/Los_Angeles" });
  const aklOct1 = await order(w, s, "2026-10-01T00:30", { tz: "Pacific/Auckland" });
  // 测试时钟：东京 2026-10-07，定时任务出 9 月
  assert.equal((await w.api.app.billingJobs.tick()).period, "2026-09");
  const sep = await current(w, s, "2026-09");
  assert.deepEqual(lineKeys(await tenantDetail(w, s, sep.id)), [`order:${laSep30.orderNo}:false`]);

  const tyoLastMinute = await order(w, s, "2026-10-31T23:59");
  const tyoFirstMinute = await order(w, s, "2026-11-01T00:00");
  const aklNov1 = await order(w, s, "2026-11-01T00:30", { tz: "Pacific/Auckland" });
  // 洛杉矶 10/31 23:30 那单：东京 11/1 零点出账时还没开始（洛杉矶才 10/31 上午）
  const laOct31 = await order(w, s, "2026-10-31T23:30", { tz: "America/Los_Angeles", status: "confirmed" });

  moveTo(w, "2026-10-31T14:59:59.999Z");
  const early = await w.api.call("POST", "/platform/v1/statements/generate", { token: await w.fin1(), body: { period: "2026-10" } });
  assert.deepEqual([early.status, early.body.error.code], [409, "PERIOD_NOT_ENDED"]);
  assert.equal((await w.api.app.billingJobs.tick()).period, "2026-09");
  assert.equal(await current(w, s, "2026-10"), undefined);

  moveTo(w, "2026-10-31T15:00:00.000Z");
  assert.equal((await w.api.app.billingJobs.tick()).period, "2026-10");
  const oct = await current(w, s, "2026-10");
  assert.deepEqual(lineKeys(await tenantDetail(w, s, oct.id)), [`order:${aklOct1.orderNo}:false`, `order:${tyoLastMinute.orderNo}:false`].sort());
  assert.equal(oct.pay_due_on, "2026-11-20");

  // 洛杉矶那单之后完成：进 11 月（往期调整，服务日期仍是 10/31）
  await setStatus(w, s, laOct31.id, "completed");
  moveTo(w, "2026-11-30T15:00:00.000Z");
  assert.equal((await w.api.app.billingJobs.tick()).period, "2026-11");
  const nov = await tenantDetail(w, s, (await current(w, s, "2026-11")).id);
  assert.deepEqual(lineKeys(nov), [`order:${tyoFirstMinute.orderNo}:false`, `order:${aklNov1.orderNo}:false`, `order:${laOct31.orderNo}:true`].sort());
  assert.equal(nov.lines.find((line: any) => line.order_no === laOct31.orderNo).service_date, "2026-10-31");
  assert.equal(nov.pay_due_on, "2026-12-20");
  await assertNoDoubleBilling(w);
});

test("闰年 2 月：2028-02-29 23:59 的单进 2 月、03-01 00:00 的不进；东京 2/29 最后一刻还不能出 2 月，3/1 零点起可以；应付日 3 月 20 日", async (t) => {
  const w = await world(t);
  const s = await supplier(w, "闰年车队");
  moveTo(w, "2028-02-29T14:00:00.000Z");
  const feb1 = await order(w, s, "2028-02-01T00:00");
  const feb29 = await order(w, s, "2028-02-29T23:59");
  const mar1 = await order(w, s, "2028-03-01T00:00");
  moveTo(w, "2028-02-29T14:59:59.999Z");
  const early = await w.api.call("POST", "/platform/v1/statements/generate", { token: await w.fin1(), body: { period: "2028-02" } });
  assert.deepEqual([early.status, early.body.error.code], [409, "PERIOD_NOT_ENDED"]);
  moveTo(w, "2028-02-29T15:00:00.000Z");
  const body = await generate(w, "2028-02");
  assert.equal(body.created.length, 1);
  const feb = body.created[0];
  assert.match(feb.statement_no, /^ST202802/);
  assert.equal(feb.pay_due_on, "2028-03-20");
  assert.deepEqual(lineKeys(await platformDetail(w, feb.id)), [`order:${feb1.orderNo}:false`, `order:${feb29.orderNo}:false`].sort());
  assert.equal(feb.total.amount, "40000");
  // 3 月 1 日那单留给 3 月
  assert.equal((await w.api.app.billingJobs.tick()).issued, 0);
  moveTo(w, "2028-03-31T15:00:00.000Z");
  await w.api.app.billingJobs.tick();
  assert.deepEqual(lineKeys(await tenantDetail(w, s, (await current(w, s, "2028-03")).id)), [`order:${mar1.orderNo}:false`]);
});

// ==== 金额 ====

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4_294_967_296;
  };
}

test("金额：随机 40 张单（多币种、各种状态、有偿取消、加收、违约金含 0 元）——每个币种的账单合计、明细和对照实现一致；金额按币种小数位显示（含负数）", async (t) => {
  const w = await world(t);
  const s = await supplier(w, "对账车队");
  const r = rng(5_0101);
  const pick = <T>(values: readonly T[]): T => values[Math.floor(r() * values.length)] as T;
  const currencies = ["JPY", "USD", "KRW"] as const;
  const expected = new Map<string, { total: bigint; keys: string[] }>();
  const add = (currency: string, minor: number, key: string): void => {
    const entry = expected.get(currency) ?? { total: 0n, keys: [] };
    entry.total += BigInt(minor);
    entry.keys.push(key);
    expected.set(currency, entry);
  };
  for (let i = 0; i < 40; i += 1) {
    const currency = pick(currencies);
    const status = pick(["completed", "completed", "no_show", "cancelled", "cancelled", "in_service", "no_show_claimed", "rescued", "rescue_pending", "confirmed"] as const);
    const settlement = 1 + Math.floor(r() * 3_000_000);
    const share = status === "cancelled" && r() < 0.7 ? 1 + Math.floor(r() * settlement) : 0;
    const day = String(1 + Math.floor(r() * 30)).padStart(2, "0");
    const seeded = await order(w, s, `2026-09-${day}T${String(Math.floor(r() * 24)).padStart(2, "0")}:${String(Math.floor(r() * 60)).padStart(2, "0")}`, { status, settlement, currency, share, feeBp: share > 0 ? 5_000 : 0 });
    // 对照：只有已完成、客人未出现（审核通过）按结算价；有偿取消按供应商应得；别的不出
    if (status === "completed") add(currency, settlement, `order:${seeded.orderNo}`);
    if (status === "no_show") add(currency, settlement, `no_show:${seeded.orderNo}`);
    if (status === "cancelled" && share > 0) add(currency, share, `cancellation:${seeded.orderNo}`);
    if (status === "completed" && r() < 0.6) {
      const amount = 1 + Math.floor(r() * 50_000);
      const chargeStatus = pick(["charged", "charged", "in_window", "approved", "rejected"] as const);
      const approved = chargeStatus === "charged" || chargeStatus === "approved" ? (r() < 0.5 ? null : 1 + Math.floor(r() * amount)) : null;
      await extraCharge(w, s, seeded.id, amount, chargeStatus, approved, currency);
      if (chargeStatus === "charged") add(currency, approved ?? amount, `extra_charge:${seeded.orderNo}`);
    }
    if ((status === "rescued" || status === "rescue_pending" || status === "in_service") && r() < 0.8) {
      const amount = r() < 0.2 ? 0 : 1 + Math.floor(r() * settlement);
      await deduction(w, s, seeded.id, amount, currency);
      // 违约金：救援有结论（rescued）、金额 > 0 才扣
      if (status === "rescued" && amount > 0) add(currency, -amount, `deduction:${seeded.orderNo}`);
    }
  }
  // 保证覆盖：部分通过的加收按通过的金额，不按报的金额
  const partial = await order(w, s, "2026-09-30T23:59", { settlement: 10_001 });
  add("JPY", 10_001, `order:${partial.orderNo}`);
  await extraCharge(w, s, partial.id, 9_999, "charged", 4_321);
  add("JPY", 4_321, `extra_charge:${partial.orderNo}`);
  const body = await generate(w, "2026-09");
  const created = body.created.filter((entry: any) => entry.tenant.id === s.tenantId);
  assert.deepEqual(created.map((entry: any) => entry.currency).sort(), [...expected.keys()].sort());
  for (const statement of created) {
    const want = expected.get(statement.currency) as { total: bigint; keys: string[] };
    const currency = statement.currency as CurrencyCode;
    assert.equal(statement.total.amount, formatMajor(Number(want.total), currency), `${currency} 合计`);
    const detail = await tenantDetail(w, s, statement.id);
    assert.deepEqual(detail.lines.map((line: any) => `${line.kind}:${line.order_no}`).sort(), [...want.keys].sort(), `${currency} 明细`);
    // 每条明细金额的显示：按币种小数位，负数带负号
    for (const line of detail.lines) {
      assert.equal(line.amount.currency, currency);
      assert.match(line.amount.amount, currency === "USD" ? /^-?\d+\.\d{2}$/ : /^-?\d+$/);
      assert.ok(!line.amount.amount.startsWith("-") || ["deduction", "carry_forward"].includes(line.kind), `${line.kind} 不该是负数`);
    }
    // 小计加起来等于合计
    const fromSummary = detail.summary.reduce((sum: bigint, entry: any) => sum + BigInt(entry.amount.amount.replace(".", "")), 0n);
    assert.equal(fromSummary, want.total);
  }
  await assertNoDoubleBilling(w);
});

test("金额：USD 负数的显示（-0.05、-12.30），0 元的违约金和免费取消不出账；只有这些的供应商不出账单", async (t) => {
  const w = await world(t);
  const s = await supplier(w, "美元车队");
  const done = await order(w, s, "2026-09-10T10:00", { currency: "USD", settlement: 1_225 });
  const rescued = await order(w, s, "2026-09-11T10:00", { currency: "USD", status: "rescued", settlement: 2_000 });
  await deduction(w, s, rescued.id, 1_230, "USD");
  const rescued2 = await order(w, s, "2026-09-12T10:00", { currency: "USD", status: "rescued", settlement: 2_000 });
  await deduction(w, s, rescued2.id, 0, "USD");
  await order(w, s, "2026-09-13T10:00", { currency: "USD", status: "cancelled", share: 0 });
  const zeroOnly = await supplier(w, "只有零元的车队");
  const z = await order(w, zeroOnly, "2026-09-10T10:00", { status: "rescued" });
  await deduction(w, zeroOnly, z.id, 0);
  await order(w, zeroOnly, "2026-09-11T10:00", { status: "cancelled", share: 0 });

  const body = await generate(w, "2026-09");
  assert.equal(body.created.filter((entry: any) => entry.tenant.id === zeroOnly.tenantId).length, 0, "只有 0 元项的供应商不出账单");
  const usd = body.created.find((entry: any) => entry.tenant.id === s.tenantId);
  assert.deepEqual([usd.currency, usd.total.amount, usd.line_count], ["USD", "-0.05", 2]);
  const detail = await tenantDetail(w, s, usd.id);
  assert.deepEqual(detail.lines.map((line: any) => [line.kind, line.order_no, line.amount.amount]), [["order", done.orderNo, "12.25"], ["deduction", rescued.orderNo, "-12.30"]]);
});

test("违约金：救援还没结论时不扣，有了结论在之后一期扣（往期调整）；从没出过账就被免除的不出；出过账再免除的在下一期退回且只退一次", async (t) => {
  const w = await world(t);
  const s = await supplier(w, "救援车队");
  const done = await order(w, s, "2026-09-05T10:00");
  const pendingRescue = await order(w, s, "2026-09-20T10:00", { status: "rescue_pending" });
  const d1 = await deduction(w, s, pendingRescue.id, 6_000);
  const waivedEarly = await order(w, s, "2026-09-21T10:00", { status: "rescued" });
  const d2 = await deduction(w, s, waivedEarly.id, 3_000);
  await waive(w, s, d2);

  await generate(w, "2026-09");
  const sep = await tenantDetail(w, s, (await current(w, s, "2026-09")).id);
  assert.deepEqual(lineKeys(sep), [`order:${done.orderNo}:false`], "救援没结论的违约金、出账前就免除的违约金都不出");

  await setStatus(w, s, pendingRescue.id, "rescued");
  const oct1 = await order(w, s, "2026-10-05T10:00", { settlement: 10_000 });
  moveTo(w, "2026-10-31T15:00:00.000Z");
  await generate(w, "2026-10");
  const oct = await tenantDetail(w, s, (await current(w, s, "2026-10")).id);
  assert.deepEqual(lineKeys(oct), [`deduction:${pendingRescue.orderNo}:true`, `order:${oct1.orderNo}:false`].sort());
  assert.equal(oct.total.amount, "4000");

  await waive(w, s, d1);
  const nov1 = await order(w, s, "2026-11-05T10:00", { settlement: 7_000 });
  moveTo(w, "2026-11-30T15:00:00.000Z");
  await generate(w, "2026-11");
  const nov = await tenantDetail(w, s, (await current(w, s, "2026-11")).id);
  assert.deepEqual(lineKeys(nov), [`deduction_waiver:${pendingRescue.orderNo}:true`, `order:${nov1.orderNo}:false`].sort());
  assert.equal(nov.total.amount, "13000");

  // 之后再出账不再退
  await order(w, s, "2026-12-05T10:00", { settlement: 1_000 });
  moveTo(w, "2026-12-31T15:00:00.000Z");
  await generate(w, "2026-12");
  const dec = await tenantDetail(w, s, (await current(w, s, "2026-12")).id);
  assert.equal(dec.lines.some((line: any) => line.kind === "deduction_waiver"), false);
  // 供应商一共拿到：20,000 + 10,000 − 6,000 + 6,000 + 7,000 + 1,000
  assert.equal(await netBilled(w, s), 38_000);
  await assertNoDoubleBilling(w);
});

test("负数结转按币种：日元为负转入下期，不并进美元账单；只有结转的月份不出账；之后的日元账单带结转；作废重出时结转只计一次", async (t) => {
  const w = await world(t);
  const s = await supplier(w, "多币种车队");
  await order(w, s, "2026-09-05T10:00", { settlement: 10_000 });
  const r1 = await order(w, s, "2026-09-06T10:00", { status: "rescued" });
  await deduction(w, s, r1.id, 30_000);
  await order(w, s, "2026-09-07T10:00", { currency: "USD", settlement: 5_000 });
  await generate(w, "2026-09");
  const sepJpy = await current(w, s, "2026-09", "JPY");
  const sepUsd = await current(w, s, "2026-09", "USD");
  assert.deepEqual([sepJpy.total.amount, sepUsd.total.amount], ["-20000", "50.00"]);
  await confirm(w, s, sepJpy.id);
  await confirm(w, s, sepUsd.id);
  assert.equal((await approvePayout(w, sepJpy.id)).status, "carried");
  assert.equal((await approvePayout(w, sepUsd.id)).status, "in_payout");

  // 10 月只有美元的新单：美元账单里没有日元的结转；日元不出账
  await order(w, s, "2026-10-05T10:00", { currency: "USD", settlement: 100 });
  moveTo(w, "2026-10-31T15:00:00.000Z");
  await generate(w, "2026-10");
  assert.equal(await current(w, s, "2026-10", "JPY"), undefined);
  const octUsd = await tenantDetail(w, s, (await current(w, s, "2026-10", "USD")).id);
  assert.deepEqual(octUsd.lines.map((line: any) => line.kind), ["order"]);

  // 11 月有日元的新单：结转一起出
  const nov = await order(w, s, "2026-11-05T10:00", { settlement: 50_000 });
  moveTo(w, "2026-11-30T15:00:00.000Z");
  await generate(w, "2026-11");
  const novJpy = await current(w, s, "2026-11", "JPY");
  assert.equal(novJpy.total.amount, "30000");
  const voided = await ok(w.api.call("POST", `/platform/v1/statements/${novJpy.id}/void`, { token: await w.fin1(), body: { reason: "测试作废重出" } }));
  assert.equal(voided.reissued.length, 1);
  const reissued = await tenantDetail(w, s, voided.reissued[0].id);
  assert.deepEqual(reissued.lines.map((line: any) => [line.kind, line.order_no, line.amount.amount]), [["carry_forward", null, "-20000"], ["order", nov.orderNo, "50000"]]);
  assert.equal(reissued.total.amount, "30000");
  await assertNoDoubleBilling(w);
});

// ==== 幂等与并发 ====

test("并发：接口出账 ×3 和定时任务 ×2 同时跑，每家每个币种只出一张、每笔应付只挂一次", async (t) => {
  const w = await world(t);
  const a = await supplier(w, "并发甲");
  const b = await supplier(w, "并发乙");
  for (let i = 1; i <= 5; i += 1) await order(w, a, `2026-09-${String(i).padStart(2, "0")}T10:00`);
  await order(w, a, "2026-09-10T10:00", { currency: "USD", settlement: 999 });
  for (let i = 1; i <= 3; i += 1) await order(w, b, `2026-09-${String(i).padStart(2, "0")}T12:00`);
  const token = await w.fin1();
  const call = (): Promise<any> => w.api.call("POST", "/platform/v1/statements/generate", { token, body: { period: "2026-09" } });
  const results = await Promise.all([call(), call(), call(), w.api.app.billingJobs.tick(), w.api.app.billingJobs.tick()]);
  for (const res of results.slice(0, 3)) assert.equal(res.status, 200, res.text);
  const issued = results.slice(0, 3).reduce((n: number, res: any) => n + res.body.created.length, 0) + results.slice(3).reduce((n: number, tick: any) => n + tick.issued, 0);
  assert.equal(issued, 3, "甲 JPY、甲 USD、乙 JPY 各一张");
  const rows = await w.api.db.owner.query("select tenant_id, currency, count(*)::int as n from statements where period = '2026-09' group by 1, 2 order by 2");
  assert.equal(rows.rows.length, 3);
  assert.ok(rows.rows.every((row) => row.n === 1));
  assert.ok(results.slice(3).every((tick: any) => tick.failed === 0), "定时任务不应因并发出错（失败的供应商会留到下一轮）");
  await assertNoDoubleBilling(w);
});

test("并发：同一张账单同时作废 3 次——只成功一次（其余 409），只重出一张；作废重出再作废，每笔应付始终只计一次、总额不变", async (t) => {
  const w = await world(t);
  const s = await supplier(w, "作废车队");
  const o1 = await order(w, s, "2026-09-03T10:00");
  await extraCharge(w, s, o1.id, 3_000, "charged", 2_500);
  const rescued = await order(w, s, "2026-09-04T10:00", { status: "rescued" });
  await deduction(w, s, rescued.id, 4_000);
  await order(w, s, "2026-09-05T10:00", { status: "cancelled", share: 6_000, feeBp: 3_000 });
  await generate(w, "2026-09");
  const sep = await current(w, s, "2026-09");
  assert.equal(sep.total.amount, "24500");
  const token = await w.fin1();
  const results = await Promise.all([1, 2, 3].map((i) => w.api.call("POST", `/platform/v1/statements/${sep.id}/void`, { token, body: { reason: `并发作废 ${i}` } })));
  assert.deepEqual(results.map((res) => res.status).sort(), [200, 409, 409]);
  for (const res of results.filter((x) => x.status === 409)) assert.equal(res.body.error.code, "STATEMENT_STATE_INVALID");
  const reissued = results.find((res) => res.status === 200)?.body.reissued;
  assert.equal(reissued.length, 1);
  assert.equal(reissued[0].total.amount, "24500");
  const all = await tenantList(w, s, "?period=2026-09");
  assert.deepEqual(all.map((x) => x.status).sort(), ["issued", "void"]);
  // 再作废一次重出的
  const again = await ok(w.api.call("POST", `/platform/v1/statements/${reissued[0].id}/void`, { token: await w.fin1(), body: { reason: "再来一次" } }));
  assert.equal(again.reissued[0].total.amount, "24500");
  assert.equal(await netBilled(w, s), 24_500);
  // 再出账也不会多出
  assert.deepEqual((await generate(w, "2026-09")).created, []);
  await assertNoDoubleBilling(w);
});

test("缺陷复现：已出账的违约金被免除并在下一期退回后，作废重出原来那期——违约金不再扣，但退回仍在，供应商多拿一笔", async (t) => {
  const w = await world(t);
  const s = await supplier(w, "退回车队");
  await order(w, s, "2026-09-05T10:00");
  const rescued = await order(w, s, "2026-09-06T10:00", { status: "rescued" });
  const penalty = await deduction(w, s, rescued.id, 6_000);
  await generate(w, "2026-09");
  const sep = await current(w, s, "2026-09");
  assert.equal(sep.total.amount, "14000");
  // 供应商对 9 月提异议，平台还没答复
  await ok(w.api.call("POST", `/tenant/v1/statements/${sep.id}/dispute`, { token: await tenantLogin(w.api, s.adminEmail), body: { reason: "违约金不该扣：台风" } }));
  // 运营认定不可抗力，10 月出账时退回 6,000
  await waive(w, s, penalty);
  await order(w, s, "2026-10-05T10:00", { settlement: 10_000 });
  moveTo(w, "2026-10-31T15:00:00.000Z");
  await generate(w, "2026-10");
  const oct = await current(w, s, "2026-10");
  assert.equal(oct.total.amount, "16000");
  // 平台作废重出 9 月（例如顺带更正别的明细）
  await ok(w.api.call("POST", `/platform/v1/statements/${sep.id}/void`, { token: await w.fin1(), body: { reason: "按异议重出" } }));
  // 期望：违约金免除 → 扣 0、退 0，供应商一共拿 20,000 + 10,000 = 30,000
  // 实际：重出的 9 月没有违约金（20,000），10 月的「扣款免除」+6,000 还在 → 36,000
  assert.equal(await netBilled(w, s), 30_000, "免除的违约金被退回了一笔从未扣过的钱");
});

test("并发：同一张账单同时发起两次付款复核只有一条（另一条 409）；供应商同时确认和提异议，结果一致、经过不重复", async (t) => {
  const w = await world(t);
  const s = await supplier(w, "并发复核车队");
  await order(w, s, "2026-09-05T10:00");
  await order(w, s, "2026-09-06T10:00", { currency: "USD", settlement: 500 });
  await generate(w, "2026-09");
  const jpy = await current(w, s, "2026-09", "JPY");
  const usd = await current(w, s, "2026-09", "USD");

  const tenantToken = await tenantLogin(w.api, s.adminEmail);
  const [confirmed, disputed] = await Promise.all([
    w.api.call("POST", `/tenant/v1/statements/${usd.id}/confirm`, { token: tenantToken }),
    w.api.call("POST", `/tenant/v1/statements/${usd.id}/dispute`, { token: tenantToken, body: { reason: "并发" } }),
  ]);
  assert.equal(confirmed.status, 200, confirmed.text);
  const final = await platformDetail(w, usd.id);
  // 先确认后异议：异议 409，最后是已确认；先异议后确认：两个都成功，最后也是已确认（异议后可以直接确认）
  assert.equal(final.status, "confirmed");
  assert.deepEqual(final.events.map((e: any) => e.action), disputed.status === 200 ? ["issue", "dispute", "confirm"] : ["issue", "confirm"]);
  if (disputed.status !== 200) assert.deepEqual([disputed.status, disputed.body.error.code], [409, "STATEMENT_STATE_INVALID"]);

  await confirm(w, s, jpy.id);
  const token = await w.fin1();
  const requests = await Promise.all([1, 2].map(() => w.api.call("POST", `/platform/v1/statements/${jpy.id}/payout-approval`, { token, body: {} })));
  assert.deepEqual(requests.map((res) => res.status).sort(), [202, 409]);
  assert.equal(requests.find((res) => res.status === 409)?.body.error.code, "STATEMENT_REVIEW_PENDING");
  const pending = await w.api.db.owner.query("select count(*)::int as n from approvals where kind = 'statement.payout' and resource_id = $1 and status = 'pending'", [jpy.id]);
  assert.equal(pending.rows[0].n, 1);
});

// ==== 付款日与批次 ====

test("付款批次：东京 10/20 23:59:59 批准进 10/20；锁定后批准的进 11/20；11/20 也锁了进 12/20（下下个 20 日）；10/21 零点批准的跳过已锁的 11/20；批次按币种合计", async (t) => {
  const w = await world(t);
  const sups: Supplier[] = [];
  for (const name of ["批次一", "批次二", "批次三", "批次四"]) {
    const s = await supplier(w, name);
    await order(w, s, "2026-09-10T10:00", { settlement: 10_000 * (sups.length + 1) });
    sups.push(s);
  }
  await order(w, sups[0] as Supplier, "2026-09-11T10:00", { currency: "USD", settlement: 1_234 });
  await generate(w, "2026-09");
  const ids: string[] = [];
  for (const s of sups) {
    const st = await current(w, s, "2026-09");
    assert.equal(st.pay_due_on, "2026-10-20");
    await confirm(w, s, st.id);
    ids.push(st.id);
  }
  const usd = await current(w, sups[0] as Supplier, "2026-09", "USD");
  await confirm(w, sups[0] as Supplier, usd.id);

  moveTo(w, "2026-10-20T14:59:59.000Z");
  assert.equal((await approvePayout(w, ids[0] as string)).payout_on, "2026-10-20");
  assert.equal((await approvePayout(w, usd.id)).payout_on, "2026-10-20");
  const batches = async (): Promise<any[]> => (await ok(w.api.call("GET", "/platform/v1/payout-batches", { token: await w.fin1() }))).items;
  const oct = (await batches()).find((b) => b.pay_date === "2026-10-20");
  assert.deepEqual(oct.totals.map((x: any) => [x.currency, x.count, x.total.amount]), [["JPY", 1, "10000"], ["USD", 1, "12.34"]]);
  await ok(w.api.call("POST", `/platform/v1/payout-batches/${oct.id}/close`, { token: await w.fin1() }));
  assert.equal((await approvePayout(w, ids[1] as string)).payout_on, "2026-11-20");
  const nov = (await batches()).find((b) => b.pay_date === "2026-11-20");
  await ok(w.api.call("POST", `/platform/v1/payout-batches/${nov.id}/close`, { token: await w.fin1() }));
  assert.equal((await approvePayout(w, ids[2] as string)).payout_on, "2026-12-20");

  moveTo(w, "2026-10-20T15:00:00.000Z");
  assert.equal((await approvePayout(w, ids[3] as string)).payout_on, "2026-12-20");
  const dec = await ok(w.api.call("GET", `/platform/v1/payout-batches/${(await batches()).find((b) => b.pay_date === "2026-12-20").id}`, { token: await w.fin1() }));
  assert.deepEqual(dec.batch.statements.map((x: any) => x.id).sort(), [ids[2], ids[3]].sort());
  assert.deepEqual(dec.batch.totals.map((x: any) => [x.currency, x.count, x.total.amount]), [["JPY", 2, "70000"]]);
  // 锁定的批次里账单不变
  const octAfter = await ok(w.api.call("GET", `/platform/v1/payout-batches/${oct.id}`, { token: await w.fin1() }));
  assert.deepEqual([octAfter.batch.status, octAfter.batch.statement_count], ["closed", 2]);
  // 每张账单的付款日和它所在批次的付款日一致
  const check = await w.api.db.owner.query("select count(*)::int as n from statements s join payout_batches b on b.id = s.payout_batch_id where s.payout_on <> b.pay_date");
  assert.equal(check.rows[0].n, 0);
});

// ==== 确认期 ====

test("确认期正好 7 天：截止前 1 毫秒定时任务不动，截止那一刻视为确认；异议后平台答复重新计 7 天，旧截止时间到了也不自动确认", async (t) => {
  const w = await world(t);
  const s1 = await supplier(w, "确认期一");
  const s2 = await supplier(w, "确认期二");
  await order(w, s1, "2026-09-05T10:00");
  await order(w, s2, "2026-09-05T10:00");
  await generate(w, "2026-09");
  const st1 = await current(w, s1, "2026-09");
  const st2 = await current(w, s2, "2026-09");
  const issuedAt = new Date(st1.issued_at).getTime();
  assert.equal(new Date(st1.confirm_due_at).getTime() - issuedAt, 7 * DAY);

  w.api.clock.advance(DAY);
  await ok(w.api.call("POST", `/tenant/v1/statements/${st2.id}/dispute`, { token: await tenantLogin(w.api, s2.adminEmail), body: { reason: "核对中" } }));
  w.api.clock.advance(DAY);
  const replied = await ok(w.api.call("POST", `/platform/v1/statements/${st2.id}/reply`, { token: await w.fin1(), body: { note: "已核对" } }));
  const newDue = new Date(replied.statement.confirm_due_at).getTime();
  assert.equal(newDue, w.api.clock.now().getTime() + 7 * DAY);

  moveTo(w, new Date(issuedAt + 7 * DAY - 1).toISOString());
  await w.api.app.billingJobs.tick();
  assert.equal((await platformDetail(w, st1.id)).status, "issued");
  moveTo(w, new Date(issuedAt + 7 * DAY).toISOString());
  await w.api.app.billingJobs.tick();
  const auto = await platformDetail(w, st1.id);
  assert.deepEqual([auto.status, auto.confirmed_by_type, auto.confirmed_by], ["confirmed", "system", null]);
  assert.equal((await platformDetail(w, st2.id)).status, "issued", "答复后重新计 7 天：旧的截止时间不算");
  moveTo(w, new Date(newDue - 1).toISOString());
  await w.api.app.billingJobs.tick();
  assert.equal((await platformDetail(w, st2.id)).status, "issued");
  moveTo(w, new Date(newDue).toISOString());
  await w.api.app.billingJobs.tick();
  assert.equal((await platformDetail(w, st2.id)).status, "confirmed");
  // 自动确认只记一次
  await w.api.app.billingJobs.tick();
  assert.deepEqual((await tenantDetail(w, s1, st1.id)).events.map((e: any) => e.action), ["issue", "auto_confirm"]);
});

test("缺陷复现：确认期截止那一刻（含）起账单已视为确认，但定时任务（每小时）还没跑到时，供应商仍能提异议", async (t) => {
  const w = await world(t);
  const s = await supplier(w, "超期异议车队");
  await order(w, s, "2026-09-05T10:00");
  await generate(w, "2026-09");
  const st = await current(w, s, "2026-09");
  // 截止后 30 分钟，定时任务这一小时还没跑
  moveTo(w, new Date(new Date(st.confirm_due_at).getTime() + 30 * 60_000).toISOString());
  const late = await w.api.call("POST", `/tenant/v1/statements/${st.id}/dispute`, { token: await tenantLogin(w.api, s.adminEmail), body: { reason: "过了确认期再提" } });
  // 期望：确认期已过（ADR 0040「到了截止（含那一刻）还是待确认：系统视为确认」），异议被拒（409）
  // 实际：200，账单变成「有异议」，自动确认也不再发生
  assert.equal(late.status, 409, late.text);
});

// ==== 双人复核与权限 ====

test("双人复核：发起人不能自己批准；没有 statement.review 的（只读、只有查看 + 编辑的自定义角色）批不了；驳回后可以作废或重新发起；超级管理员可以批", async (t) => {
  const w = await world(t);
  const s = await supplier(w, "复核车队");
  await order(w, s, "2026-09-05T10:00");
  await order(w, s, "2026-09-06T10:00", { currency: "USD", settlement: 700 });
  await generate(w, "2026-09");
  const st = await current(w, s, "2026-09");
  const usd = await current(w, s, "2026-09", "USD");
  await confirm(w, s, st.id);
  await confirm(w, s, usd.id);
  const root = await w.root();
  const readonly = await addStaff(w.api, root, "ro@platform.test", "readonly");
  const role = await ok(w.api.call("POST", "/platform/v1/roles", { token: root, body: { name: "财务助理", grants: ["finance:view", "finance:edit", "approvals:view"], data_scope: { city_ids: null, channel_ids: null } } }), 201);
  const invited = await ok(w.api.call("POST", "/platform/v1/staff", { token: root, body: { email: "assist@platform.test", name: "财务助理", role: role.key } }), 201);
  await ok(w.api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
  const assistant = await platformLogin(w.api, "assist@platform.test");
  const ops = await addStaff(w.api, root, "ops@platform.test", "operations");

  // 只读、运营不能发起
  for (const token of [await platformLogin(w.api, readonly.email), await platformLogin(w.api, ops.email)]) {
    assert.equal((await w.api.call("POST", `/platform/v1/statements/${st.id}/payout-approval`, { token, body: {} })).status, 403);
  }
  // 运营连看都看不了
  assert.equal((await w.api.call("GET", `/platform/v1/statements/${st.id}`, { token: await platformLogin(w.api, ops.email) })).status, 403);

  // 助理（有编辑）发起，自己不能批；只读、助理都批不了
  const requested = await ok(w.api.call("POST", `/platform/v1/statements/${st.id}/payout-approval`, { token: assistant, body: {} }), 202);
  const approveAs = (token: string): Promise<any> => w.api.call("POST", `/platform/v1/approvals/${requested.approval.id}/approve`, { token, body: {} });
  const self = await approveAs(assistant);
  assert.ok(self.status === 403 || (self.status === 409 && self.body.error.code === "APPROVAL_SELF_REVIEW"), self.text);
  assert.equal((await approveAs(await platformLogin(w.api, readonly.email))).status, 403);
  assert.equal((await platformDetail(w, st.id)).status, "confirmed");

  // 财务 1 驳回 → 账单还是待复核，可以重新发起；财务 1 自己发起的，自己批 409
  await ok(w.api.call("POST", `/platform/v1/approvals/${requested.approval.id}/reject`, { token: await w.fin1(), body: { note: "金额再核一下" } }));
  assert.equal((await platformDetail(w, st.id)).pending_approval_id, null);
  const second = await ok(w.api.call("POST", `/platform/v1/statements/${st.id}/payout-approval`, { token: await w.fin1(), body: {} }), 202);
  const selfFin = await w.api.call("POST", `/platform/v1/approvals/${second.approval.id}/approve`, { token: await w.fin1(), body: {} });
  assert.deepEqual([selfFin.status, selfFin.body.error.code], [409, "APPROVAL_SELF_REVIEW"]);
  // 撤回后可以作废
  await ok(w.api.call("POST", `/platform/v1/approvals/${second.approval.id}/withdraw`, { token: await w.fin1(), body: {} }));
  const voided = await ok(w.api.call("POST", `/platform/v1/statements/${st.id}/void`, { token: await w.fin1(), body: { reason: "撤回后作废重出" } }));
  assert.equal(voided.statement.status, "void");

  // 美元那张：财务发起、超级管理员批准
  const third = await ok(w.api.call("POST", `/platform/v1/statements/${usd.id}/payout-approval`, { token: await w.fin1(), body: {} }), 202);
  await ok(w.api.call("POST", `/platform/v1/approvals/${third.approval.id}/approve`, { token: await w.root(), body: {} }));
  assert.equal((await platformDetail(w, usd.id)).status, "in_payout");
});

test("数据范围：限定了城市或渠道的财务（含审核权限）调用所有财务结算接口一律 403 DATA_SCOPE_DENIED；待审核队列里看不到付款复核，按编号查、批准、驳回都是 404", async (t) => {
  const w = await world(t);
  const s = await supplier(w, "范围车队");
  await order(w, s, "2026-09-05T10:00");
  await ok(w.api.call("POST", "/platform/v1/statements/generate", { token: await w.fin1(), body: { period: "2026-09" } }));
  const st = await current(w, s, "2026-09");
  await confirm(w, s, st.id);
  const requested = await ok(w.api.call("POST", `/platform/v1/statements/${st.id}/payout-approval`, { token: await w.fin1(), body: {} }), 202);
  const batch = (await ok(w.api.call("GET", "/platform/v1/payout-batches", { token: await w.fin1() }))).items[0];
  const root = await w.root();
  for (const [label, scope] of [["城市", { city_ids: [w.ids.tokyo], channel_ids: null }], ["渠道", { city_ids: null, channel_ids: [randomUUID()] }]] as const) {
    const role = await w.api.call("POST", "/platform/v1/roles", { token: root, body: { name: `${label}财务`, grants: ["finance:view", "finance:edit", "finance:review", "approvals:view"], data_scope: scope } });
    if (role.status !== 201) {
      assert.equal(label, "渠道", role.text);
      continue;
    }
    const email = `scoped-${label === "城市" ? "city" : "channel"}@platform.test`;
    const invited = await ok(w.api.call("POST", "/platform/v1/staff", { token: root, body: { email, name: `${label}财务`, role: role.body.key } }), 201);
    await ok(w.api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
    const token = await platformLogin(w.api, email);
    const calls: [string, string, unknown][] = [
      ["GET", "/platform/v1/statements", undefined],
      ["GET", `/platform/v1/statements/${st.id}`, undefined],
      ["POST", "/platform/v1/statements/generate", { period: "2026-09" }],
      ["POST", `/platform/v1/statements/${st.id}/reply`, { note: "x" }],
      ["POST", `/platform/v1/statements/${st.id}/void`, { reason: "x" }],
      ["POST", `/platform/v1/statements/${st.id}/payout-approval`, {}],
      ["GET", "/platform/v1/payout-batches", undefined],
      ...(batch === undefined ? [] : ([["GET", `/platform/v1/payout-batches/${batch.id}`, undefined], ["POST", `/platform/v1/payout-batches/${batch.id}/close`, undefined]] as [string, string, unknown][])),
    ];
    for (const [method, path, body] of calls) {
      const res = await w.api.call(method as "GET" | "POST", path, { token, body });
      assert.deepEqual([res.status, res.body?.error?.code], [403, "DATA_SCOPE_DENIED"], `${label}：${method} ${path}`);
    }
    const queue = await ok(w.api.call("GET", "/platform/v1/approvals", { token }));
    assert.equal(queue.items.some((item: any) => item.id === requested.approval.id), false, label);
    for (const [method, path] of [["GET", `/platform/v1/approvals/${requested.approval.id}`], ["POST", `/platform/v1/approvals/${requested.approval.id}/approve`], ["POST", `/platform/v1/approvals/${requested.approval.id}/reject`]] as const) {
      assert.equal((await w.api.call(method, path, { token, body: method === "POST" ? { note: "x" } : undefined })).status, 404, `${label}：${method} ${path}`);
    }
  }
  const after = await platformDetail(w, st.id);
  assert.deepEqual([after.status, after.pending_approval_id], ["confirmed", requested.approval.id], "受限员工的请求没有改动任何东西");
});

// ==== 租户隔离 ====

test("规则 2（接口）：供应商乙读不到、确认不了、提不了甲的账单——和不存在的编号一样是 404；列表、筛选、伪造的租户参数都拿不到甲的；租户令牌调不了运营后台接口", async (t) => {
  const w = await world(t);
  const a = await supplier(w, "隔离甲");
  const b = await supplier(w, "隔离乙");
  await order(w, a, "2026-09-05T10:00", { settlement: 31_337 });
  await order(w, b, "2026-09-05T10:00");
  await generate(w, "2026-09");
  const stA = await current(w, a, "2026-09");
  const stB = await current(w, b, "2026-09");
  const tokenB = await tenantLogin(w.api, b.adminEmail);
  const ghost = randomUUID();
  for (const [method, suffix, body] of [["GET", "", undefined], ["POST", "/confirm", undefined], ["POST", "/dispute", { reason: "改别人的账" }]] as const) {
    const theirs = await w.api.call(method, `/tenant/v1/statements/${stA.id}${suffix}`, { token: tokenB, body });
    const missing = await w.api.call(method, `/tenant/v1/statements/${ghost}${suffix}`, { token: tokenB, body });
    assert.equal(theirs.status, 404, `${method} ${suffix}`);
    assert.deepEqual([theirs.body.error.code, theirs.body.error.message], [missing.body.error.code, missing.body.error.message], "别人的和不存在的应答一样（不泄露存在与否）");
  }
  assert.equal((await platformDetail(w, stA.id)).status, "issued");
  const listB = await ok(w.api.call("GET", "/tenant/v1/statements?period=2026-09", { token: tokenB }));
  assert.deepEqual(listB.items.map((x: any) => x.id), [stB.id]);
  // 租户编号只来自令牌：查询参数里的 tenant_id 拒绝（严格校验），请求头里的不理会
  const forged = await w.api.call("GET", `/tenant/v1/statements?tenant_id=${a.tenantId}`, { token: tokenB });
  assert.equal(forged.status, 400);
  const header = await ok(w.api.call("GET", "/tenant/v1/statements", { token: tokenB, headers: { "x-tenant-id": a.tenantId } }));
  assert.deepEqual(header.items.map((x: any) => x.id), [stB.id]);
  assert.equal(JSON.stringify(header).includes(stA.id), false);
  // 租户令牌不能用运营后台的账单接口
  for (const [method, path] of [["GET", "/platform/v1/statements"], ["GET", `/platform/v1/statements/${stA.id}`], ["POST", "/platform/v1/statements/generate"], ["GET", "/platform/v1/payout-batches"]] as const) {
    const res = await w.api.call(method, path, { token: tokenB, body: method === "POST" ? {} : undefined });
    assert.ok(res.status === 401 || res.status === 403, `${method} ${path}：${res.status}`);
  }
});

test("规则 2（数据库层）：租户事务里乙读不到甲的账单、明细、经过；三张表都不能增删改；付款批次表完全没有权限", async (t) => {
  const w = await world(t);
  const a = await supplier(w, "库甲");
  const b = await supplier(w, "库乙");
  await order(w, a, "2026-09-05T10:00");
  await order(w, b, "2026-09-05T10:00");
  await generate(w, "2026-09");
  const stA = await current(w, a, "2026-09");
  await confirm(w, a, stA.id);
  await approvePayout(w, stA.id);
  const lineA = (await w.api.db.owner.query("select id from statement_lines where tenant_id = $1 limit 1", [a.tenantId])).rows[0].id;
  const asB = <T>(sql: string, params: unknown[] = []): Promise<T> => withTenantTx(w.api.db.pool, b.tenantId, (db) => db.query(sql, params) as Promise<T>);
  for (const table of ["statements", "statement_lines", "statement_events"]) {
    const rows: any = await asB(`select tenant_id from ${table}`);
    assert.ok(rows.rows.length > 0, `${table}：乙自己的应该看得到`);
    assert.ok(rows.rows.every((row: any) => row.tenant_id === b.tenantId), `${table}：只看得到乙自己的`);
    const byId: any = await asB(`select 1 from ${table} where ${table === "statements" ? "id" : "statement_id"} = $1`, [stA.id]);
    assert.equal(byId.rowCount, 0, table);
  }
  const attempts: [string, unknown[]][] = [
    ["update statements set status = 'void' where id = $1", [stA.id]],
    ["update statements set total_minor = 1 where tenant_id = $1", [b.tenantId]],
    ["delete from statements where id = $1", [stA.id]],
    ["update statement_lines set voided_at = now() where id = $1", [lineA]],
    ["delete from statement_lines where tenant_id = $1", [b.tenantId]],
    ["insert into statement_events (tenant_id, statement_id, action, actor_type, actor_id, note, data, at) values ($1, $2, 'confirm', 'system', null, null, '{}', now())", [b.tenantId, stA.id]],
    ["insert into statement_events (tenant_id, statement_id, action, actor_type, actor_id, note, data, at) values ($1, $2, 'confirm', 'system', null, null, '{}', now())", [a.tenantId, stA.id]],
    ["select * from payout_batches", []],
    ["update payout_batches set status = 'paid', paid_at = now()", []],
  ];
  for (const [sql, params] of attempts) await assert.rejects(asB(sql, params), deniedByDatabase, sql);
  const still = await platformDetail(w, stA.id);
  assert.equal(still.status, "in_payout");
});

// ==== 规则 4 ====

/** 递归取出所有叶子值（数字、字符串、布尔），带路径。 */
function leaves(value: unknown, path = "$", out: [string, unknown][] = []): [string, unknown][] {
  if (Array.isArray(value)) value.forEach((item, i) => leaves(item, `${path}[${i}]`, out));
  else if (value !== null && typeof value === "object") for (const [key, item] of Object.entries(value)) leaves(item, `${path}.${key}`, out);
  else out.push([path, value]);
  return out;
}

test("规则 4：经销售端真实下单的订单出账后，供应商的账单列表、详情、确认、提异议的应答里没有对外价和加价比例——字段名扫描 + 每个值和对外价、加价比例逐一比对", async (t) => {
  const pay = new FakePaymentProvider();
  const api = await createTestApi({ payments: pay });
  t.after(() => api.close());
  const m = await buildMarket(api);
  const flow = await salesFlow(api, m, pay);
  const finance1 = await addStaff(api, m.root, "fin1@platform.test", "finance");
  const finance2 = await addStaff(api, m.root, "fin2@platform.test", "finance");
  const done = await flow.paidOrder();
  const cancelled = await flow.paidOrder();
  const sales = await api.db.owner.query("select o.id, o.tenant_id, o.settlement_minor, s.sell_minor, s.markup_bp, s.fx, s.fx_buffer_bp from order_sales s join orders o on o.id = s.order_id where o.id = any($1::uuid[])", [[done.id, cancelled.id]]);
  assert.equal(sales.rows.length, 2);
  const tenantId = sales.rows[0].tenant_id as string;
  const who = tenantId === m.a.tenantId ? m.a : m.b;
  await api.db.owner.query("update orders set status = 'completed' where id = $1", [done.id]);
  await api.db.owner.query("update orders set status = 'cancelled', cancelled_at = $2, cancel_reason = 'GUEST_REQUEST', cancel_fee_bp = 3000, cancel_tenant_share_minor = 5940 where id = $1", [cancelled.id, api.clock.now()]);

  const forbiddenValues = new Set<string>();
  for (const row of sales.rows) {
    const sell = Number(row.sell_minor);
    assert.notEqual(sell, Number(row.settlement_minor), "对外价应和结算价不同（否则比对没有意义）");
    for (const v of [sell, formatMajor(sell, "JPY"), Number(row.markup_bp), sell - Number(row.settlement_minor), formatMajor(sell - Number(row.settlement_minor), "JPY")]) forbiddenValues.add(String(v));
    if (Number(row.fx_buffer_bp) !== 0) forbiddenValues.add(String(row.fx_buffer_bp));
  }
  // 账单里本来就该出现的数（结算价、应得、扣款比例）不能和要找的数撞上，否则比对会误报
  for (const legit of [Number(sales.rows[0].settlement_minor), 5940, 3000]) assert.equal(forbiddenValues.has(String(legit)), false, `测试数据撞值：${legit}`);

  // 服务日期 2026-10-20：东京 11/1 起出 10 月
  api.clock.advance(new Date("2026-10-31T15:00:00Z").getTime() - api.clock.now().getTime());
  const fin1 = await platformLogin(api, finance1.email);
  await ok(api.call("POST", "/platform/v1/statements/generate", { token: fin1, body: { period: "2026-10" } }));
  const token = await tenantLogin(api, who.adminEmail);
  const list = await ok(api.call("GET", "/tenant/v1/statements", { token }));
  const st = list.items.find((x: any) => x.period === "2026-10");
  assert.ok(st);
  const responses: unknown[] = [list, await ok(api.call("GET", `/tenant/v1/statements/${st.id}`, { token }))];
  responses.push(await ok(api.call("POST", `/tenant/v1/statements/${st.id}/dispute`, { token, body: { reason: "核对一下" } })));
  await ok(api.call("POST", `/platform/v1/statements/${st.id}/reply`, { token: fin1, body: { note: "已核对" } }));
  responses.push(await ok(api.call("POST", `/tenant/v1/statements/${st.id}/confirm`, { token })));
  // 复核通过进批次后再看一次
  const requested = await ok(api.call("POST", `/platform/v1/statements/${st.id}/payout-approval`, { token: fin1, body: {} }), 202);
  await ok(api.call("POST", `/platform/v1/approvals/${requested.approval.id}/approve`, { token: await platformLogin(api, finance2.email), body: {} }));
  responses.push(await ok(api.call("GET", `/tenant/v1/statements/${st.id}`, { token })), await ok(api.call("GET", "/tenant/v1/statements?status=in_payout", { token })));

  const detail = responses[1] as any;
  assert.deepEqual(detail.statement.lines.map((line: any) => line.kind).sort(), ["cancellation", "order"]);
  const keys = allKeys(responses);
  for (const key of keys) assert.equal(/sell|markup|margin|profit|fx|rate|buffer|channel|gross/i.test(key), false, `字段名：${key}`);
  for (const [path, value] of leaves(responses)) {
    if (typeof value === "number" || typeof value === "string") assert.equal(forbiddenValues.has(String(value)), false, `${path} = ${String(value)} 是对外价 / 加价比例 / 加价金额`);
  }
});

// ==== 状态流转 ====

test("非法跳转：待确认不能答复、不能发起复核；有异议的不能再提、不能自动确认；进了批次 / 已付款的不能作废、确认、提异议、再发起；无需付款、转入下期、已作废的什么都不能做", async (t) => {
  const w = await world(t);
  const s = await supplier(w, "状态车队");
  const sZero = await supplier(w, "零元车队");
  const sNeg = await supplier(w, "负数车队");
  const sDisp = await supplier(w, "异议车队");
  const sPaid = await supplier(w, "已付车队");
  await order(w, s, "2026-09-05T10:00");
  await order(w, sZero, "2026-09-05T10:00", { settlement: 20_000 });
  const z = await order(w, sZero, "2026-09-06T10:00", { status: "rescued" });
  await deduction(w, sZero, z.id, 20_000);
  await order(w, sNeg, "2026-09-05T10:00", { settlement: 1_000 });
  const n = await order(w, sNeg, "2026-09-06T10:00", { status: "rescued" });
  await deduction(w, sNeg, n.id, 5_000);
  await order(w, sDisp, "2026-09-05T10:00");
  await order(w, sPaid, "2026-09-05T10:00");
  await generate(w, "2026-09");
  const st = await current(w, s, "2026-09");
  const zero = await current(w, sZero, "2026-09");
  const neg = await current(w, sNeg, "2026-09");
  const disp = await current(w, sDisp, "2026-09");
  const paid = await current(w, sPaid, "2026-09");
  assert.deepEqual([zero.total.amount, neg.total.amount], ["0", "-4000"]);

  const fin = await w.fin1();
  const expect409 = async (method: "POST", path: string, token: string, body: unknown, label: string): Promise<void> => {
    const res = await w.api.call(method, path, { token, body });
    assert.deepEqual([res.status, res.body?.error?.code], [409, "STATEMENT_STATE_INVALID"], `${label}：${path}`);
  };
  const tenant = async (who: Supplier): Promise<string> => tenantLogin(w.api, who.adminEmail);

  // 待确认
  await expect409("POST", `/platform/v1/statements/${st.id}/reply`, fin, { note: "x" }, "待确认不能答复");
  await expect409("POST", `/platform/v1/statements/${st.id}/payout-approval`, fin, {}, "待确认不能发起复核");
  // 有异议
  await ok(w.api.call("POST", `/tenant/v1/statements/${disp.id}/dispute`, { token: await tenant(sDisp), body: { reason: "有问题" } }));
  await expect409("POST", `/tenant/v1/statements/${disp.id}/dispute`, await tenant(sDisp), { reason: "再提" }, "有异议不能再提");
  await expect409("POST", `/platform/v1/statements/${disp.id}/payout-approval`, fin, {}, "有异议不能发起复核");

  // 无需付款（合计 0）、转入下期（合计为负）
  for (const [who, id, outcome] of [[sZero, zero.id, "settled"], [sNeg, neg.id, "carried"]] as const) {
    await confirm(w, who, id);
    const approved = await approvePayout(w, id);
    assert.deepEqual([approved.status, approved.payout_on, approved.payout_batch_id], [outcome, null, null]);
    await expect409("POST", `/platform/v1/statements/${id}/void`, fin, { reason: "x" }, outcome);
    await expect409("POST", `/platform/v1/statements/${id}/payout-approval`, fin, {}, outcome);
    await expect409("POST", `/platform/v1/statements/${id}/reply`, fin, { note: "x" }, outcome);
    await expect409("POST", `/tenant/v1/statements/${id}/dispute`, await tenant(who), { reason: "x" }, outcome);
    await expect409("POST", `/tenant/v1/statements/${id}/confirm`, await tenant(who), undefined, outcome);
  }

  // 进了批次（待付款）、已付款
  await confirm(w, s, st.id);
  assert.equal((await approvePayout(w, st.id)).status, "in_payout");
  await confirm(w, sPaid, paid.id);
  await approvePayout(w, paid.id);
  await w.api.db.owner.query("update statements set status = 'paid', paid_at = $2 where id = $1", [paid.id, w.api.clock.now()]);
  for (const [who, id, label] of [[s, st.id, "待付款"], [sPaid, paid.id, "已付款"]] as const) {
    await expect409("POST", `/platform/v1/statements/${id}/void`, fin, { reason: "x" }, label);
    await expect409("POST", `/platform/v1/statements/${id}/payout-approval`, fin, {}, label);
    await expect409("POST", `/platform/v1/statements/${id}/reply`, fin, { note: "x" }, label);
    await expect409("POST", `/tenant/v1/statements/${id}/dispute`, await tenant(who), { reason: "x" }, label);
    await expect409("POST", `/tenant/v1/statements/${id}/confirm`, await tenant(who), undefined, label);
  }

  // 已作废
  const voided = await ok(w.api.call("POST", `/platform/v1/statements/${disp.id}/void`, { token: fin, body: { reason: "重出" } }));
  for (const [path, token, body] of [
    [`/platform/v1/statements/${disp.id}/void`, fin, { reason: "x" }],
    [`/platform/v1/statements/${disp.id}/reply`, fin, { note: "x" }],
    [`/platform/v1/statements/${disp.id}/payout-approval`, fin, {}],
    [`/tenant/v1/statements/${disp.id}/dispute`, await tenant(sDisp), { reason: "x" }],
    [`/tenant/v1/statements/${disp.id}/confirm`, await tenant(sDisp), undefined],
  ] as const) await expect409("POST", path, token, body, "已作废");
  assert.equal(voided.reissued.length, 1);

  // 有异议的不自动确认：一个月后定时任务跑过，仍是有异议（重出的那张是待确认，到期会自动确认）
  const disp2 = voided.reissued[0];
  await ok(w.api.call("POST", `/tenant/v1/statements/${disp2.id}/dispute`, { token: await tenant(sDisp), body: { reason: "仍有问题" } }));
  w.api.clock.advance(30 * DAY);
  await w.api.app.billingJobs.tick();
  assert.equal((await platformDetail(w, disp2.id)).status, "disputed");
  // 状态都没被非法请求改动
  assert.deepEqual([(await platformDetail(w, st.id)).status, (await platformDetail(w, paid.id)).status, (await platformDetail(w, zero.id)).status, (await platformDetail(w, neg.id)).status], ["in_payout", "paid", "settled", "carried"]);
});

test("出账参数：不是 YYYY-MM、2000 年以前、多余字段 400；未结束的月份和未来月份 409；租户的列表筛选参数校验", async (t) => {
  const w = await world(t);
  const s = await supplier(w, "参数车队");
  const fin = await w.fin1();
  for (const body of [{ period: "2026-9" }, { period: "2026-00" }, { period: "1999-12" }, { period: "2026-09-01" }, { period: 202609 }, { period: "2026-09", tenant_id: s.tenantId }]) {
    const res = await w.api.call("POST", "/platform/v1/statements/generate", { token: fin, body });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  for (const period of ["2026-10", "2026-11", "2030-01"]) {
    const res = await w.api.call("POST", "/platform/v1/statements/generate", { token: fin, body: { period } });
    assert.deepEqual([res.status, res.body.error.code], [409, "PERIOD_NOT_ENDED"], period);
  }
  const token = await tenantLogin(w.api, s.adminEmail);
  for (const query of ["?period=2026-13", "?status=unknown", "?foo=1"]) assert.equal((await w.api.call("GET", `/tenant/v1/statements${query}`, { token })).status, 400, query);
  // 原因、答复超长、空白
  await order(w, s, "2026-09-05T10:00");
  await generate(w, "2026-09");
  const st = await current(w, s, "2026-09");
  for (const reason of ["", "   ", "x".repeat(501)]) assert.equal((await w.api.call("POST", `/tenant/v1/statements/${st.id}/dispute`, { token, body: { reason } })).status, 400, JSON.stringify(reason.slice(0, 5)));
  assert.equal((await w.api.call("POST", `/tenant/v1/statements/${st.id}/dispute`, { token, body: { reason: "x".repeat(500) } })).status, 200);
});
