/**
 * M4-21 QA：并发和中断（两个实例、一单出错、批次上限、崩溃后幂等、和业务写入并发）、命令（默认 dry-run、真的不写、输出没有个人信息）、权限和结构（update 的范围、RLS、迁移）。
 * 真实 PostgreSQL，数据虚构，测试后随 schema 删除。
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ANONYMIZED_TEXT } from "@nozomi/domain";
import type { AppContext } from "./context.ts";
import { withPlatformTx, withTenantTx } from "./db/context.ts";
import { loadMigrationFiles, runMigrations } from "./db/migrate.ts";
import { anonymizeOrderPassenger, lockRetentionOrder } from "./repos/passenger-retention.ts";
import { type RetentionLog, retentionCutoff, runPassengerRetention } from "./services/passenger-retention.ts";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { deniedByDatabase } from "./testing/db.ts";
import { assign, newDriver, newVehicle } from "./testing/dispatch.ts";
import { testEnv } from "./testing/fixtures.ts";
import { type Market, buildMarket, ok } from "./testing/market.ts";
import { tenantLogin } from "./testing/money.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { exitWithin, startNode } from "./testing/process.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";
import { DAY, type Seeded, aged, endAt, insertChange, insertRescue, insertTicket, isDone, retentionCtx, tokyoDaysAgo } from "./testing/retention-fixtures.ts";

const ENTRY = fileURLToPath(new URL("./cli/privacy-anonymize.ts", import.meta.url));

let api: TestApi;
let m: Market;
let flow: SalesFlow;
let ctx: AppContext;

before(async () => {
  const pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  flow = await salesFlow(api, m, pay);
  ctx = retentionCtx(api);
});
after(() => api.close());

const q = (sql: string, args: unknown[] = []) => api.db.owner.query(sql, args);
const tick = () => api.app.passengerRetention.tick();
const old = (days = 200): Promise<Seeded> => aged(api, m, days);
const lockKey = "hashtext(current_schema() || ':nozomi.passenger-retention')";

function spyLog(): RetentionLog & { errors: { orderId?: string; err?: unknown }[]; lines: string[] } {
  const errors: { orderId?: string; err?: unknown }[] = [];
  const lines: string[] = [];
  return {
    errors,
    lines,
    info: (obj, msg) => void lines.push(JSON.stringify({ obj, msg })),
    error: (obj, msg) => {
      errors.push(obj as { orderId?: string });
      lines.push(JSON.stringify({ obj, msg, err: String((obj as { err?: unknown }).err ?? ""), detail: (obj as { err?: { detail?: unknown } }).err?.detail }));
    },
  };
}

/** 在库里挂一个触发器，让这一单的改单更新报错（模拟这一单数据有问题）。用完 drop。 */
async function breakOrder(orderId: string): Promise<() => Promise<void>> {
  const name = `qa_break_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await q(`create function ${name}() returns trigger language plpgsql as $$ begin if new.order_id = '${orderId}' then raise exception '模拟这一单出错'; end if; return new; end $$`);
  await q(`create trigger ${name} before update on order_changes for each row execute function ${name}()`);
  return async () => {
    await q(`drop trigger ${name} on order_changes`);
    await q(`drop function ${name}()`);
  };
}

async function clone(source: string, count: number, ended: Date): Promise<void> {
  await q(
    `insert into orders (tenant_id, id, order_no, status, category, city_id, place_id, direction, product_id, product_version, vehicle_group_id, service_at, service_local, timezone, service_date, urgent, passengers, luggage, pickup, dropoff, addons, driver_language, flight_no, passenger, settlement_minor, settlement_currency, settlement, inventory_held, payment_due_at, confirmed_at, dispatch_due_at, cancelled_at, cancel_reason, created_at, updated_at)
     select tenant_id, gen_random_uuid(), 'NZ20260101' || upper(substr(translate(md5(random()::text), '01il', '2345'), 1, 8)), status, category, city_id, place_id, direction, product_id, product_version, vehicle_group_id, $3, service_local, timezone, service_date, urgent, passengers, luggage, pickup, dropoff, addons, driver_language, flight_no, passenger, settlement_minor, settlement_currency, settlement, inventory_held, $3, $4, dispatch_due_at, $3, cancel_reason, $4, $3
       from orders, generate_series(1, $2) where id = $1`,
    [source, count, ended, new Date(ended.getTime() - 3_600_000)],
  );
}

// ---- 并发 ----

test("别的实例正拿着锁：这一轮 busy，什么都不做；锁放开后下一轮才做", async () => {
  await tick();
  const order = await old();
  const client = await api.db.owner.connect();
  try {
    await client.query("begin");
    await client.query(`select pg_advisory_xact_lock(${lockKey})`);
    const result = await tick();
    assert.equal(result.busy, true);
    assert.equal(result.anonymized, 0);
    assert.equal(await isDone(api, order.id), false);
    await client.query("commit");
  } finally {
    client.release();
  }
  assert.equal((await tick()).anonymized, 1);
  assert.equal(await isDone(api, order.id), true);
});

test("业务事务正锁着这一单：跳过这一单（不等、不报错），别的单照做；放开后下一轮再做", async () => {
  await tick();
  const locked = await old();
  const free = await old();
  const client = await api.db.owner.connect();
  try {
    await client.query("begin");
    await client.query("select 1 from orders where id = $1 for update", [locked.id]);
    const result = await tick();
    assert.equal(result.anonymized, 1);
    assert.equal(result.skipped, 1);
    assert.equal(await isDone(api, free.id), true);
    await client.query("rollback");
  } finally {
    client.release();
  }
  assert.equal(await isDone(api, locked.id), false);
  await tick();
  assert.equal(await isDone(api, locked.id), true);
});

test("客人此时开工单：工单事务还没提交（持有外键锁），这一轮跳过；提交后这单有未结工单，不脱敏", async () => {
  await tick();
  const order = await old();
  const client = await api.db.owner.connect();
  try {
    await client.query("begin");
    const now = api.clock.now();
    await client.query(
      `insert into tickets (tenant_id, ticket_no, type, source, created_by_type, order_id, priority, subject, description, status, first_response_due_at, resolution_due_at, created_at, updated_at)
       values ($1, $2, 'complaint', 'guest', 'guest', $3, 'normal', '投诉', '客人写的说明 09011112222', 'open', $4, $4, $4, $4)`,
      [order.tenantId, `TK20260101${randomUUID().replace(/[^2-9A-HJ-NP-Z]/gi, "2").toUpperCase().slice(0, 6)}`, order.id, now],
    );
    await tick();
    assert.equal(await isDone(api, order.id), false, "外键锁挡住了，不能在这时脱敏");
    await client.query("commit");
  } finally {
    client.release();
  }
  await tick();
  assert.equal(await isDone(api, order.id), false, "已提交的未结工单挡住");
});

test("脱敏事务进行中客人开工单：工单等脱敏提交；提交之后工单里的联系方式不能原样留在已脱敏的单上", async () => {
  await tick();
  const paid = await flow.paidOrder({ serviceTime: new Date(api.clock.now().getTime() + 40 * DAY).toISOString().replace(/\.\d{3}Z$/, "Z") });
  await endAt(api, paid.id, tokyoDaysAgo(api, 200));
  const token = m.staff.operations.token;
  const client = await api.db.pool.connect();
  let creating: Promise<any> | null = null;
  try {
    await client.query("begin");
    await client.query("select set_config('role', 'nozomi_platform', true)");
    const db = { query: client.query.bind(client) } as any;
    const cutoff = retentionCutoff(ctx).cutoff;
    assert.equal(await lockRetentionOrder(db, paid.id, cutoff), true);
    await anonymizeOrderPassenger(db, paid.id, api.clock.now());
    creating = api.call("POST", "/platform/v1/tickets", { token, body: { order_id: paid.id, type: "other", subject: "事后联系", description: "客人回电 08033334444" } });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
  const created = await creating;
  assert.ok([201, 404, 409].includes(created.status), `${created.status} ${created.text}`);
  const rows = (await q("select description, status from tickets where order_id = $1", [paid.id])).rows;
  assert.ok(created.status !== 201 || rows.every((row: { description: string }) => !row.description.includes("08033334444")), `工单 ${created.status}：${JSON.stringify(rows)}：这单已标脱敏，以后不会再被选中，这段联系方式永远留在库里`);
});

// ---- 一单出错、中断 ----

test("一单出错：只跳过它（保存点回滚干净），别的单照做；这一轮只试一次；下一轮再试；修好后完成", async () => {
  await tick();
  const broken = await old(500);
  await insertChange(api, broken, "rejected", { before: { passenger: { name: "王小明", phone: "+819012345678", email: "guest@example.com" } }, after: {} });
  const fine = await old(400);
  const repair = await breakOrder(broken.id);
  try {
    const log = spyLog();
    const result = await runPassengerRetention(ctx, log);
    assert.equal(result.anonymized, 1);
    assert.equal(result.skipped, 1);
    assert.equal(log.errors.length, 1, "这一轮只试一次，不会在同一单上打转");
    assert.equal(log.errors[0]?.orderId, broken.id);
    assert.equal(await isDone(api, fine.id), true);
    assert.equal(await isDone(api, broken.id), false, "出错的这单回滚干净：乘客还在");
    const row = (await q("select passenger_anonymized_at from orders where id = $1", [broken.id])).rows[0];
    assert.equal(row.passenger_anonymized_at, null, "标记也回滚");
    assert.ok(!log.lines.join("\n").includes("王小明") && !log.lines.join("\n").includes("guest@example.com"), "日志里没有个人信息");
    const next = spyLog();
    await runPassengerRetention(ctx, next);
    assert.equal(next.errors.length, 1, "下一轮再试一次");
  } finally {
    await repair();
  }
  await tick();
  assert.equal(await isDone(api, broken.id), true);
});

test("一单出错不挡队列：最早的 200 单都有问题，也不影响后面的单在同一轮处理", async () => {
  await tick();
  const first = await old(700);
  await clone(first.id, 199, tokyoDaysAgo(api, 700));
  const later = await old(600);
  const name = `qa_block_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await q(`create function ${name}() returns trigger language plpgsql as $$ begin if new.passenger_anonymized_at is not null and old.passenger_anonymized_at is null and old.service_at < '${tokyoDaysAgo(api, 650).toISOString()}'::timestamptz then raise exception '模拟出错'; end if; return new; end $$`);
  await q(`create trigger ${name} before update on orders for each row execute function ${name}()`);
  try {
    const log = spyLog();
    const result = await runPassengerRetention(ctx, log);
    assert.equal(result.skipped, 200);
    assert.equal(result.anonymized, 1);
    assert.equal(await isDone(api, later.id), true);
    assert.equal(result.batches, 2);
  } finally {
    await q(`drop trigger ${name} on orders`);
    await q(`drop function ${name}()`);
  }
  await tick();
  assert.equal(await isDone(api, first.id), true);
});

test("批次上限：一轮最多 10 批，每批 200 单；剩下的下一轮接着做", async () => {
  await tick();
  const seed = await old(800);
  await clone(seed.id, 2004, tokyoDaysAgo(api, 800));
  const started = Date.now();
  const first = await tick();
  assert.equal(first.batches, 10);
  assert.equal(first.anonymized, 2000);
  assert.equal((await q("select count(*)::int as n from orders where service_at = $1 and passenger_anonymized_at is null", [tokyoDaysAgo(api, 800)])).rows[0].n, 5);
  const second = await tick();
  assert.equal(second.anonymized, 5);
  assert.equal(second.batches, 1);
  const audits = (await q("select after from audit_logs where action = 'anonymize_passenger' order by id desc limit 11")).rows;
  assert.equal(audits[0].after.count, 5);
  assert.ok(audits.slice(1).every((row: { after: { count: number } }) => row.after.count === 200), "每批一条审计");
  assert.ok(Date.now() - started < 170_000, `2005 单用了 ${Date.now() - started} 毫秒，一轮不能拖太久`);
});

test("任务中途崩溃（这一批的事务提交不了）：整批回滚，一单也没改；重启后完成", async () => {
  await tick();
  const order = await old();
  const before = (await q("select passenger from orders where id = $1", [order.id])).rows[0].passenger;
  const name = `qa_crash_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await q(`create function ${name}() returns trigger language plpgsql as $$ begin if new.action = 'anonymize_passenger' then raise exception '模拟崩溃'; end if; return new; end $$`);
  await q(`create trigger ${name} before insert on audit_logs for each row execute function ${name}()`);
  try {
    await assert.rejects(tick());
    assert.deepEqual((await q("select passenger, passenger_anonymized_at from orders where id = $1", [order.id])).rows[0], { passenger: before, passenger_anonymized_at: null });
  } finally {
    await q(`drop trigger ${name} on audit_logs`);
    await q(`drop function ${name}()`);
  }
  const result = await tick();
  assert.equal(result.anonymized, 1);
  assert.equal(await isDone(api, order.id), true);
});

test("脱敏改过长的文字不会让这单永远处理不了：救援原因、不可抗力说明写满 500 字（两个字的姓名换成占位后变长）", async () => {
  await tick();
  const order = await old(300);
  await q("update orders set passenger = $2::jsonb where id = $1", [order.id, JSON.stringify({ name: "王明", phone: "+819012345678", email: "guest@example.com" })]);
  await insertRescue(api, order, "cancelled", { reason: "王明".repeat(250), forceMajeureNote: "王明".repeat(250) });
  try {
    const log = spyLog();
    const result = await runPassengerRetention(ctx, log);
    assert.equal(log.errors.length, 0, `这单每小时报错一次，永远脱敏不了：${log.lines.join("\n").slice(0, 300)}`);
    assert.equal(result.skipped, 0);
    assert.equal(await isDone(api, order.id), true);
  } finally {
    await q("update order_rescues set reason = '车坏了', force_majeure_note = '台风' where order_id = $1", [order.id]);
    await tick();
  }
});

test("脱敏改过长的文字：备注、工单、加收、改单的文字截断到列的上限，不报错", async () => {
  await tick();
  const order = await old(300);
  await q("update orders set passenger = $2::jsonb, cancel_note = $3 where id = $1", [order.id, JSON.stringify({ name: "王明", phone: "+819012345678", email: "guest@example.com" }), "王明".repeat(250)]);
  await insertTicket(api, order, "closed", { subject: "王明".repeat(100), description: "王明".repeat(2000), closeNote: "王明".repeat(500), decisionNote: "王明".repeat(500) });
  await insertChange(api, order, "rejected", { decisionNote: "王明".repeat(250) });
  const log = spyLog();
  await runPassengerRetention(ctx, log);
  assert.equal(log.errors.length, 0, log.lines.join("\n").slice(0, 300));
  assert.equal(await isDone(api, order.id), true);
});

// ---- 命令 ----

const run = async (args: string[], env: Record<string, string> = {}): Promise<{ code: unknown; output: string }> => {
  const running = startNode(ENTRY, { ...testEnv(api.db.url), ...env }, args);
  const code = await exitWithin(running, 20_000);
  if (code === "timeout") running.child.kill("SIGKILL");
  return { code, output: running.output() };
};

async function databaseFingerprint(): Promise<string> {
  const tables = (await q("select table_name from information_schema.tables where table_schema = current_schema() and table_type = 'BASE TABLE' order by 1")).rows.map((row: { table_name: string }) => row.table_name);
  const out: string[] = [];
  for (const table of tables) {
    const row = (await q(`select count(*) as n, coalesce(sum(hashtext(t::text)::bigint), 0) as h from ${table} t`)).rows[0];
    out.push(`${table}:${row.n}:${row.h}`);
  }
  return out.join("\n");
}

test("dry-run 真的不写：全库每张表的内容前后一样，审计也没有；连写两次都一样", async () => {
  await tick();
  const count = (output: string, pattern: RegExp): number => Number(pattern.exec(output)?.[1] ?? 0);
  const baseline = await run([]);
  await old(200);
  await insertTicket(api, await old(200), "open");
  const before = await databaseFingerprint();
  const first = await run([]);
  assert.equal(first.code, 0, first.output);
  const second = await run(["--dry-run"]);
  assert.equal(second.code, 0, second.output);
  assert.equal(await databaseFingerprint(), before);
  assert.equal(count(first.output, /现在可以脱敏：(\d+) 单/), count(baseline.output, /现在可以脱敏：(\d+) 单/) + 1, first.output);
  assert.equal(count(first.output, /未结工单或赔付没付完 (\d+) 单/), count(baseline.output, /未结工单或赔付没付完 (\d+) 单/) + 1, first.output);
});

for (const args of [["--execute=false"], ["--execute=true"], ["execute"], ["--exec"], ["-e"], ["--force"], ["--dry-run=false"], ["--dry-run", "--execute"]]) {
  test(`命令：写错的参数 ${args.join(" ")} 不执行，退出码不是 0，不写任何数据`, async () => {
    const before = await databaseFingerprint();
    const result = await run(args);
    assert.notEqual(result.code, 0, result.output);
    assert.equal(await databaseFingerprint(), before);
    assert.match(result.output, /用法/);
  });
}

for (const [name, value] of [["abc", "abc"], ["0", "0"], ["负数", "-1"], ["小数", "180.5"], ["179", "179"], ["超大", "99999999"], ["无穷", "Infinity"]] as const) {
  test(`命令：PASSENGER_RETENTION_DAYS=${name} 启动失败，不执行也不静默用默认值`, async () => {
    const order = await old(200);
    const before = await databaseFingerprint();
    const result = await run(["--execute"], { PASSENGER_RETENTION_DAYS: value });
    assert.notEqual(result.code, 0, result.output);
    assert.match(result.output, /PASSENGER_RETENTION_DAYS/);
    assert.equal(await isDone(api, order.id), false);
    assert.equal(await databaseFingerprint(), before);
    await tick();
  });
}

test("命令输出没有个人信息：连订单出错的时候也没有姓名、电话、邮箱；--execute 只跑这一轮", async () => {
  await tick();
  const broken = await old(500);
  await insertChange(api, broken, "rejected");
  await old(400);
  const repair = await breakOrder(broken.id);
  try {
    const result = await run(["--execute"]);
    assert.equal(result.code, 0, result.output);
    for (const secret of ["王小明", "小明", "guest@", "9012345678", "12345678"]) assert.ok(!result.output.includes(secret), result.output);
    assert.match(result.output, /已脱敏 \d+ 单，跳过 1 单/);
  } finally {
    await repair();
  }
  await tick();
});

test("开关关闭：定时任务不启动；--execute 拒绝但 dry-run 还能看", async () => {
  await tick();
  const order = await old(200);
  const dry = await run([], { PASSENGER_RETENTION_ENABLED: "false" });
  assert.equal(dry.code, 0, dry.output);
  assert.match(dry.output, /自动任务：关/);
  assert.equal((await run(["--execute"], { PASSENGER_RETENTION_ENABLED: "FALSE" })).code, 1, "写错的开关值也不执行");
  assert.equal(await isDone(api, order.id), false);
  await tick();
});

// ---- 权限和结构 ----

test("权限：平台角色新增的 update 只放行手写列：order_contacts 没脱敏时拒绝，脱敏后也只能改 note", async () => {
  const paid = await flow.paidOrder({ serviceTime: new Date(api.clock.now().getTime() + 41 * DAY).toISOString().replace(/\.\d{3}Z$/, "Z") });
  const row = (await q("select tenant_id from orders where id = $1", [paid.id])).rows[0];
  const who = { adminToken: await tenantLogin(api, row.tenant_id === m.a.tenantId ? m.a.adminEmail : m.b.adminEmail) };
  await ok(assign(api, who, paid.id, (await newDriver(api, who as any)).id, (await newVehicle(api, who as any, m.ids.biz7)).id));
  const link = (await q("select id from driver_links where order_id = $1 limit 1", [paid.id])).rows[0].id;
  await q("insert into order_contacts (tenant_id, order_id, method, note, occurred_at, link_id) values ($1, $2, 'phone', '联系记录', $3, $4)", [row.tenant_id, paid.id, api.clock.now(), link]);
  await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query("update order_contacts set note = '改' where order_id = $1", [paid.id])), deniedByDatabase, "没脱敏的单不能改");
  await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query("update order_contacts set method = 'messaging' where order_id = $1", [paid.id])), deniedByDatabase);
  await endAt(api, paid.id, tokyoDaysAgo(api, 200));
  await tick();
  assert.equal(await isDone(api, paid.id), true);
  await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query("update order_contacts set method = 'messaging' where order_id = $1", [paid.id])), deniedByDatabase, "已脱敏也只能改 note");
  await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query("update order_contacts set occurred_at = now(), note = 'x' where order_id = $1", [paid.id])), deniedByDatabase);
  const changed = await withPlatformTx(api.db.pool, (db) => db.query("update order_contacts set note = '清除' where order_id = $1", [paid.id]));
  assert.equal(changed.rowCount, 1);
  await assert.rejects(withTenantTx(api.db.pool, row.tenant_id, (db) => db.query("update order_contacts set note = '供应商改' where order_id = $1", [paid.id])), deniedByDatabase, "供应商不能改");
  await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query("delete from order_contacts where order_id = $1", [paid.id])), deniedByDatabase);
});

test("权限：供应商读不到、改不了别家的已脱敏工单和联系记录；RLS 仍然开着，新策略只给平台角色", async () => {
  const rls = (await q("select relname, relrowsecurity, relforcerowsecurity from pg_class where relname in ('order_contacts', 'ticket_messages', 'ticket_notes') and relnamespace = current_schema()::regnamespace order by relname")).rows;
  assert.ok(rls.filter((row: { relname: string }) => row.relname !== "ticket_notes").every((row: { relrowsecurity: boolean }) => row.relrowsecurity === true), JSON.stringify(rls));
  const policies = (await q("select roles from pg_policies where schemaname = current_schema() and policyname = 'order_contacts_platform_anonymize'")).rows;
  assert.equal(policies.length, 1);
  assert.deepEqual(String(policies[0].roles).replace(/[{}]/g, ""), "nozomi_platform");
  const grants = (await q("select grantee, table_name from information_schema.role_table_grants where table_schema = current_schema() and table_name in ('order_contacts', 'ticket_messages', 'ticket_notes') and privilege_type = 'UPDATE' and grantee <> (select tableowner from pg_tables where schemaname = current_schema() and tablename = 'orders')")).rows;
  assert.deepEqual([...new Set(grants.map((row: { grantee: string }) => row.grantee))], ["nozomi_platform"], "只有平台角色多了 update，别的角色（供应商、登录前）没有");
});

test("权限：触发器只认这一单的标记：别的单已脱敏，不能借机改没脱敏单的对话", async () => {
  const live = await flow.paidOrder({ serviceTime: new Date(api.clock.now().getTime() + 42 * DAY).toISOString().replace(/\.\d{3}Z$/, "Z") });
  const dead = await old(300);
  await tick();
  assert.equal(await isDone(api, dead.id), true);
  const ticket = await ok(api.call("POST", "/platform/v1/tickets", { token: m.staff.operations.token, body: { order_id: live.id, type: "other", subject: "标题", description: "说明" } }), 201);
  await ok(api.call("POST", `/platform/v1/tickets/${ticket.ticket.id}/messages`, { token: m.staff.operations.token, body: { body: "对话" } }), 201);
  await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query("update ticket_messages set body = '***' where ticket_id = $1", [ticket.ticket.id])), deniedByDatabase);
});

test("权限：供应商不能把脱敏标记清掉，也不能把乘客改回去；脱敏任务本身用的是平台事务，不依赖迁移账号", async () => {
  const order = await old(300);
  await tick();
  await assert.rejects(withTenantTx(api.db.pool, order.tenantId, (db) => db.query("update orders set passenger_anonymized_at = null where id = $1", [order.id])), deniedByDatabase);
  await assert.rejects(withTenantTx(api.db.pool, order.tenantId, (db) => db.query("update orders set passenger = '{}'::jsonb where id = $1", [order.id])), deniedByDatabase);
});

test("迁移：再执行一次是空操作，已有数据、已脱敏的单都不变；迁移文件只改结构，不动数据", async () => {
  const live = await old(50);
  const done = await old(300);
  await tick();
  const before = (await q("select id, passenger, passenger_anonymized_at from orders where id = any($1::uuid[]) order by id", [[live.id, done.id]])).rows;
  const fingerprint = await databaseFingerprint();
  await runMigrations(api.db.owner, await loadMigrationFiles());
  assert.equal(await databaseFingerprint(), fingerprint);
  assert.deepEqual((await q("select id, passenger, passenger_anonymized_at from orders where id = any($1::uuid[]) order by id", [[live.id, done.id]])).rows, before);
  assert.equal((await q("select passenger ->> 'name' as name from orders where id = $1", [done.id])).rows[0].name, ANONYMIZED_TEXT);
  const sql = await readFile(new URL("../migrations/0190_passenger_retention.sql", import.meta.url), "utf8");
  const statements = sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
  assert.ok(!/^\s*(insert\s+into|delete\s+from|update\s+\w+\s+set|truncate)\b/im.test(statements), "迁移不能含写数据的语句");
});

test("新加的列默认空，索引只收没脱敏的单", async () => {
  const definition = (await q("select indexdef from pg_indexes where schemaname = current_schema() and indexname = 'orders_retention_idx'")).rows[0].indexdef as string;
  assert.match(definition, /passenger_anonymized_at IS NULL/);
  const order = await old(10);
  assert.equal((await q("select passenger_anonymized_at from orders where id = $1", [order.id])).rows[0].passenger_anonymized_at, null);
});
