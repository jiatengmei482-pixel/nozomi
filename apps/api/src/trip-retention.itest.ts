/**
 * M9T-05（ADR 0100 第二节「保留期与清理」）：行程单清理任务，经真实 PostgreSQL。
 * - 只删 readable_until 已过的行程单，方案、段、费用随外键级联删除；没到期的留下；不碰别的表（同渠道的预订草稿、其余行程单）；
 * - 分批（每批 500、一轮最多 10 批）；别的进程正在清（拿不到锁）时这一轮跳过。
 * 测试数据全在本文件里建（规则 1）：渠道经接口建，行程单直接写库（清理任务只看 readable_until）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, buildMarket, newChannel } from "./testing/market.ts";

let api: TestApi;
let m: Market;
let channelId: string;
let seq = 0;

before(async () => {
  api = await createTestApi();
  m = await buildMarket(api);
  channelId = (await newChannel(api, m.staff.cm1.token, { name: "行程清理测试" })).id as string;
});
after(async () => {
  await api?.close();
});

const tripId = (): string => `T${String((seq += 1)).padStart(42, "0")}`;

/** 写一张行程单（可带一个方案、一段、一笔费用），`readableUntil` 相对现在的毫秒 */
async function insertTrip(readableInMs: number, withPlan = false): Promise<string> {
  const id = tripId();
  const now = api.clock.now();
  const created = new Date(now.getTime() + Math.min(0, readableInMs) - 30 * 24 * 3_600_000);
  await api.db.owner.query(
    "insert into trips (id, channel_id, source, status, itinerary, currency, created_at, updated_at, readable_until) values ($1, $2, 'form', 'quoted', '{}', 'JPY', $3, $3, $4)",
    [id, channelId, created, new Date(now.getTime() + readableInMs)],
  );
  if (withPlan) {
    const plan = (await api.db.owner.query<{ id: string }>("insert into trip_plans (trip_id, seq, kind, recommended, status, currency, quoted_at) values ($1, 0, 'daily_best', true, 'unquoted', 'JPY', $2) returning id", [id, created])).rows[0]?.id;
    await api.db.owner.query("insert into trip_segments (plan_id, seq, day_index, service_date, segment_type, points) values ($1, 0, 1, '2027-03-29', 'idle_day', '[]')", [plan]);
    await api.db.owner.query("insert into trip_fees (trip_id, plan_id, seq, fee_type, rule_version, settlement_minor, settlement_currency, sell_minor, label, calc) values ($1, $2, 0, 'idle', 0, 10000, 'JPY', 11000, '{}', '{}')", [id, plan]);
  }
  return id;
}

const count = async (sql: string, params: unknown[] = []): Promise<number> => Number((await api.db.owner.query<{ n: string }>(sql, params)).rows[0]?.n);

test("清理任务只删 readable_until 已过的行程单，方案、段、费用级联删除；没到期的留下，不碰别的表", async () => {
  await api.db.owner.query("delete from trips");
  const expired = await insertTrip(-60_000, true);
  const atEdge = await insertTrip(0);
  const fresh = await insertTrip(3_600_000, true);
  // 一条已过期的预订草稿：行程单清理不能碰它（它归预订草稿自己的清理任务管）
  const now = api.clock.now();
  await api.db.owner.query("insert into booking_drafts (id, content, created_at, expires_at) values ($1, '{}'::jsonb, $2, $3)", ["D".repeat(43), new Date(now.getTime() - 3 * 3_600_000), new Date(now.getTime() - 3_600_000)]);
  const draftsBefore = await count("select count(*) as n from booking_drafts");
  assert.equal(draftsBefore >= 1, true);
  const first = await api.app.tripRetention.tick();
  // readable_until 正好是现在的也删（GET 用 readable_until > now，到点就读不到了）
  assert.deepEqual(first, { deleted: 2, batches: 1, busy: false });
  const left = await api.db.owner.query<{ id: string }>("select id from trips order by id");
  assert.deepEqual(left.rows.map((row) => row.id), [fresh]);
  assert.equal(await count("select count(*) as n from trip_plans where trip_id = any($1)", [[expired, atEdge]]), 0);
  assert.equal(await count("select count(*) as n from trip_fees where trip_id = any($1)", [[expired, atEdge]]), 0);
  assert.equal(await count("select count(*) as n from trip_segments s where not exists (select 1 from trip_plans p where p.id = s.plan_id)"), 0);
  assert.equal(await count("select count(*) as n from trip_segments s join trip_plans p on p.id = s.plan_id where p.trip_id = $1", [expired]), 0);
  assert.equal(await count("select count(*) as n from trip_segments s join trip_plans p on p.id = s.plan_id where p.trip_id = $1", [fresh]), 1);
  assert.equal(await count("select count(*) as n from trip_fees where trip_id = $1", [fresh]), 1);
  assert.equal(await count("select count(*) as n from booking_drafts"), draftsBefore);
  // 被行程单外键引用的渠道照留
  assert.equal(await count("select count(*) as n from channels where id = $1", [channelId]), 1);
  assert.deepEqual(await api.app.tripRetention.tick(), { deleted: 0, batches: 1, busy: false });
  // 过了一小时，原来没到期的也到期了
  api.clock.advance(3_600_001);
  assert.deepEqual(await api.app.tripRetention.tick(), { deleted: 1, batches: 1, busy: false });
  assert.equal(await count("select count(*) as n from trip_plans where trip_id = $1", [fresh]), 0);
});

test("清理任务分批：每批 500、一轮最多 10 批；别的进程正在清（拿不到锁）时这一轮跳过", async () => {
  await api.db.owner.query("delete from trips");
  const now = api.clock.now();
  const insertExpired = (n: number) =>
    api.db.owner.query(
      "insert into trips (id, channel_id, source, status, itinerary, currency, created_at, updated_at, readable_until) select rpad(md5(random()::text || g::text), 43, 'x'), $1, 'form', 'draft', '{}', 'JPY', $2, $2, $3 from generate_series(1, $4::int) g",
      [channelId, new Date(now.getTime() - 31 * 24 * 3_600_000), new Date(now.getTime() - 3_600_000), n],
    );
  await insertExpired(1_200);
  assert.deepEqual(await api.app.tripRetention.tick(), { deleted: 1_200, batches: 3, busy: false });
  await insertExpired(5_600);
  assert.deepEqual(await api.app.tripRetention.tick(), { deleted: 5_000, batches: 10, busy: false }, "一轮最多 10 批，剩下的下一轮");
  assert.deepEqual(await api.app.tripRetention.tick(), { deleted: 600, batches: 2, busy: false });

  await insertExpired(10);
  const holder = await api.db.owner.connect();
  try {
    await holder.query("select pg_advisory_lock(hashtext(current_schema() || ':nozomi.trip-purge'))");
    assert.deepEqual(await api.app.tripRetention.tick(), { deleted: 0, batches: 0, busy: true });
    await holder.query("select pg_advisory_unlock(hashtext(current_schema() || ':nozomi.trip-purge'))");
  } finally {
    holder.release();
  }
  assert.deepEqual(await api.app.tripRetention.tick(), { deleted: 10, batches: 1, busy: false });
});
