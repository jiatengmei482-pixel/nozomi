/**
 * M5-02 测试角色补的集成测试（ADR 0051）：收款方不被调包、金额、回填、敏感数据、权限和隔离。开发已有的覆盖见 bank-files.itest.ts，这里不重复。
 * 每个测试建自己的供应商和批次，不依赖别的测试的顺序。账号、IBAN、SWIFT、公司名都是现算的虚构值，随 schema 一起删除（规则 1）。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { loadConfig } from "@nozomi/config";
import { ibanCheckDigits } from "@nozomi/domain";
import { buildApp } from "./app.ts";
import { withPlatformTx, withTenantTx } from "./db/context.ts";
import { loadMigrationFiles } from "./db/migrate.ts";
import { SecretBox } from "./integrations/secret-box.ts";
import { readXlsxSheet } from "./integrations/xlsx.ts";
import { TEST_PASSWORD, type TenantFixture, type TestApi, addTenantUser, createTestApi, localWebhookSender } from "./testing/api.ts";
import { deniedByDatabase } from "./testing/db.ts";
import { seedOrder } from "./testing/dispatch.ts";
import { FAKE_SECRETS, UNREACHABLE_INTEGRATIONS, testEnv } from "./testing/fixtures.ts";
import { type Market, type Staff, addStaff, allKeys, buildMarket, marketProduct, ok } from "./testing/market.ts";

const DAY = 24 * 3_600_000;
const ROTATED_KEY = "qa-rotated-data-encryption-key-0123456789";
const COL = { name: 1, swift: 5, account: 6, currency: 7, amount: 8, reference: 10, charges: 11 } as const;

let api: TestApi;
let base: Market;
let finance1: Staff;
let finance2: Staff;
let seq = 0;
const tokens = new Map<string, string>();

before(async () => {
  api = await createTestApi();
  base = await buildMarket(api);
  finance1 = await addStaff(api, base.root, "qa-bf1@platform.test", "finance");
  finance2 = await addStaff(api, base.root, "qa-bf2@platform.test", "finance");
});
after(() => api.close());
// 有的测试拨时钟，令牌会过期：每个测试重新登录
beforeEach(() => tokens.clear());

async function platformToken(email: string): Promise<string> {
  let token = tokens.get(email);
  if (token === undefined) {
    token = (await ok(api.platformLogin({ body: { email, password: TEST_PASSWORD } }))).access_token as string;
    tokens.set(email, token);
  }
  return token;
}
async function tenantToken(email: string): Promise<string> {
  let token = tokens.get(email);
  if (token === undefined) {
    token = (await ok(api.call("POST", "/tenant/v1/auth/login", { body: { email, password: TEST_PASSWORD } }))).access_token as string;
    tokens.set(email, token);
  }
  return token;
}
const fin1 = (): Promise<string> => platformToken(finance1.email);
const fin2 = (): Promise<string> => platformToken(finance2.email);
const root = (): Promise<string> => platformToken("root@platform.test");
const admin = (who: TenantFixture): Promise<string> => tenantToken(who.adminEmail);
const owner = (sql: string, values: unknown[] = []): Promise<any> => api.db.owner.query(sql, values);
const fakeAccount = (): string => `00${randomInt(10_000_000, 99_999_999)}`;

/** 一对全新的供应商（各有一个已上架的商品）。 */
async function world(): Promise<Market> {
  seq += 1;
  const token = await root();
  const a = await api.tenantWithAdmin(token, `QA甲${seq}`, `a${seq}@qa-bf.test`);
  const b = await api.tenantWithAdmin(token, `QA乙${seq}`, `b${seq}@qa-bf.test`);
  const ids = base.ids;
  const pa = await marketProduct(api, a, ids, [[ids.biz7, 20_000]]);
  const pb = await marketProduct(api, b, ids, [[ids.biz7, 19_800]]);
  return { ...base, a, b, ids: { ...ids, pa, pb } };
}

function accountBody(number: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { currency: "JPY", beneficiary_name: "Fictional Transport KK", beneficiary_address: "1-1 Example Dori Testville", bank_name: "Fictional Bank", bank_address: "2 Sample Street Testville", swift_bic: "FAKEJPJT", account_kind: "account", account_number: number, current_password: TEST_PASSWORD, ...over };
}
async function submit(who: TenantFixture, body: Record<string, unknown>): Promise<any> {
  return (await ok(api.call("POST", "/tenant/v1/payout-accounts", { token: await admin(who), body }), 201)).account;
}
async function requestActivation(accountId: string, token?: string): Promise<string> {
  return (await ok(api.call("POST", `/platform/v1/payout-accounts/${accountId}/approval`, { token: token ?? (await fin1()), body: {} }), 202)).approval.id;
}
const approve = async (id: string, token?: string): Promise<any> => api.call("POST", `/platform/v1/approvals/${id}/approve`, { token: token ?? (await fin2()), body: {} });
async function activeAccount(who: TenantFixture, number: string, over: Record<string, unknown> = {}): Promise<any> {
  const account = await submit(who, accountBody(number, over));
  await ok(approve(await requestActivation(account.id)));
  return account;
}

async function orderFor(w: Market, side: "a" | "b", day: number, settlement: number, currency: string): Promise<void> {
  const at = new Date(`2026-09-${String(day).padStart(2, "0")}T10:00:00+09:00`);
  const seeded = await seedOrder(api, w, side, { serviceAt: at, confirmedAt: new Date(at.getTime() - 3 * DAY) });
  await owner("update orders set settlement_minor = $3, settlement_currency = $4, status = 'completed' where tenant_id = $1 and id = $2", [w[side].tenantId, seeded.id, settlement, currency]);
}

interface Batch {
  id: string;
  statements: any[];
  ofTenant(who: TenantFixture, currency: string): any;
}

/** 出账、供应商确认、付款复核通过、（默认）锁定批次。 */
async function batchFor(w: Market, options: { close?: boolean } = {}): Promise<Batch> {
  const generated = await ok(api.call("POST", "/platform/v1/statements/generate", { token: await fin1(), body: { period: "2026-09" } }));
  const created = generated.created.filter((statement: any) => statement.tenant.id === w.a.tenantId || statement.tenant.id === w.b.tenantId);
  assert.ok(created.length > 0, "这一批应该出账");
  let batchId = "";
  for (const statement of created) {
    const who = statement.tenant.id === w.a.tenantId ? w.a : w.b;
    await ok(api.call("POST", `/tenant/v1/statements/${statement.id}/confirm`, { token: await admin(who), body: {} }));
    const requested = await ok(api.call("POST", `/platform/v1/statements/${statement.id}/payout-approval`, { token: await fin1(), body: {} }), 202);
    await ok(approve(requested.approval.id));
    batchId = (await ok(api.call("GET", `/platform/v1/statements/${statement.id}`, { token: await fin1() }))).statement.payout_batch_id;
  }
  if (options.close !== false) await ok(api.call("POST", `/platform/v1/payout-batches/${batchId}/close`, { token: await fin1(), body: {} }));
  return { id: batchId, statements: created, ofTenant: (who, currency) => created.find((s: any) => s.tenant.id === who.tenantId && s.currency === currency) };
}

const requestFile = async (batchId: string, body: Record<string, unknown>, token?: string): Promise<any> => api.call("POST", `/platform/v1/payout-batches/${batchId}/bank-files`, { token: token ?? (await fin1()), body });
const fileDetail = async (id: string): Promise<any> => (await ok(api.call("GET", `/platform/v1/bank-files/${id}`, { token: await fin1() }))).file;
const filesOf = async (batchId: string): Promise<any[]> => (await ok(api.call("GET", `/platform/v1/bank-files?payout_batch_id=${batchId}`, { token: await fin1() }))).items;

async function generate(batchId: string, currency: string, extra: Record<string, unknown> = {}): Promise<any> {
  const known = new Set((await filesOf(batchId)).map((file) => file.id));
  const requested = await requestFile(batchId, { currency, ...extra });
  assert.equal(requested.status, 202, requested.text);
  await ok(approve(requested.body.approval.id));
  return (await filesOf(batchId)).find((file) => !known.has(file.id));
}

async function download(id: string, format: "csv" | "xlsx", token?: string, app: TestApi["app"] = api.app): Promise<{ status: number; headers: Record<string, unknown>; bytes: Buffer; code: string | null; text: string }> {
  const res = await app.inject({ method: "POST", url: `/platform/v1/bank-files/${id}/download`, headers: { authorization: `Bearer ${token ?? (await fin1())}`, "content-type": "application/json" }, payload: { format } });
  const json = String(res.headers["content-type"]).includes("json") ? res.json() : null;
  return { status: res.statusCode, headers: res.headers, bytes: res.rawPayload, code: json?.error?.code ?? null, text: res.body };
}
/** 名称地址里没有逗号时，按逗号切就够了。 */
const csvRows = (bytes: Buffer): string[][] => bytes.toString("utf8").slice(1).split("\r\n").filter((line) => line !== "").map((line) => line.split(","));
const pay = async (fileId: string, payments: { item_id: string; bank_reference: string }[], token?: string): Promise<any> => api.call("POST", `/platform/v1/bank-files/${fileId}/payments`, { token: token ?? (await fin1()), body: { payments } });

/** 同一个库上起一个主密钥不同的应用（模拟换了 DATA_ENCRYPTION_KEY）。 */
async function appWithKey(key: string): Promise<TestApi["app"]> {
  return buildApp({ config: loadConfig({ ...testEnv(api.db.url), ...UNREACHABLE_INTEGRATIONS, DATA_ENCRYPTION_KEY: key }), pool: api.db.pool, migrationFiles: await loadMigrationFiles(), now: api.clock.now, webhookSender: localWebhookSender(), logger: false });
}

// ---- 1. 收款方被调包 ----

test("全程一致：写进文件的是批准时那一份；批准后才提交、才生效的新账户都不会进已生成的文件；未下载、已下载都一样，详情标出账户已变更", async () => {
  const w = await world();
  const original = fakeAccount();
  await activeAccount(w.a, original);
  await orderFor(w, "a", 10, 20_000, "JPY");
  const batch = await batchFor(w);

  // 复核中提交（还没生效）的新账户：不影响批准，文件里还是生效的那一个
  const pendingNumber = fakeAccount();
  const requested = await requestFile(batch.id, { currency: "JPY" });
  assert.equal(requested.status, 202, requested.text);
  assert.equal(requested.body.approval.payload.items[0].account, `•••• ${original.slice(-4)}`);
  const replacement = await submit(w.a, accountBody(pendingNumber));
  await ok(approve(requested.body.approval.id));
  const [file] = await filesOf(batch.id);

  // 批准之后替换：已生成未下载
  await ok(approve(await requestActivation(replacement.id)));
  const detail = await fileDetail(file.id);
  assert.equal(detail.items[0].account_masked, `•••• ${original.slice(-4)}`);
  assert.equal(detail.items[0].account_changed, true, "已生成未下载的文件要标出账户已变更");
  const first = await download(file.id, "csv");
  assert.equal(first.status, 200, first.text);
  assert.equal(csvRows(first.bytes)[1]?.[COL.account], original, "写进文件的是批准时那一份");
  assert.ok(!first.bytes.toString("utf8").includes(pendingNumber));

  // 再换一次：已下载的文件照样不变
  await activeAccount(w.a, fakeAccount());
  const again = await download(file.id, "csv");
  assert.ok(again.bytes.equals(first.bytes), "再下载逐字节相同");
});

test("账户审核中被换掉：撤回后重新提交，旧复核批准不了，也不会把新账户启用", async () => {
  const w = await world();
  const first = await submit(w.a, accountBody(fakeAccount()));
  const review = await requestActivation(first.id);
  await ok(api.call("POST", `/tenant/v1/payout-accounts/${first.id}/withdraw`, { token: await admin(w.a), body: {} }));
  const swapped = await submit(w.a, accountBody(fakeAccount()));
  const stale = await approve(review);
  assert.deepEqual([stale.status, stale.body.error.code], [409, "APPROVAL_STALE"]);
  const rows = await owner("select id, status from payout_accounts where tenant_id = $1", [w.a.tenantId]);
  assert.deepEqual(Object.fromEntries(rows.rows.map((row: any) => [row.id, row.status])), { [first.id]: "withdrawn", [swapped.id]: "pending" });
});

test("复核发起后账户被替换，再驳回重新发起：新复核里是新账户；旧的复核内容不会被静默改写", async () => {
  const w = await world();
  const oldNumber = fakeAccount();
  const newNumber = fakeAccount();
  await activeAccount(w.a, oldNumber);
  await orderFor(w, "a", 10, 20_000, "JPY");
  const batch = await batchFor(w);
  const stale = await requestFile(batch.id, { currency: "JPY" });
  await activeAccount(w.a, newNumber);
  assert.equal((await approve(stale.body.approval.id)).status, 409);
  const frozen = await ok(api.call("GET", `/platform/v1/approvals/${stale.body.approval.id}`, { token: await fin2() }));
  assert.equal(frozen.approval.payload.items[0].account, `•••• ${oldNumber.slice(-4)}`);
  await ok(api.call("POST", `/platform/v1/approvals/${stale.body.approval.id}/reject`, { token: await fin2(), body: { note: "账户变了" } }));
  const file = await generate(batch.id, "JPY");
  assert.equal(csvRows((await download(file.id, "csv")).bytes)[1]?.[COL.account], newNumber);
});

test("复核内容以发起时为准：发起后才补好账户的账单不会被带进文件，要另出一个文件", async () => {
  const w = await world();
  await activeAccount(w.a, fakeAccount());
  await orderFor(w, "a", 10, 20_000, "JPY");
  await orderFor(w, "b", 11, 19_800, "JPY");
  const batch = await batchFor(w);
  const requested = await requestFile(batch.id, { currency: "JPY", allow_exclusions: true });
  assert.equal(requested.status, 202, requested.text);
  assert.equal(requested.body.approval.payload.item_count, 1);
  await activeAccount(w.b, fakeAccount());
  await ok(approve(requested.body.approval.id));
  const [file] = await filesOf(batch.id);
  assert.equal(file.item_count, 1, "没审过的那一张不进文件");
  const detail = await fileDetail(file.id);
  assert.deepEqual(detail.items.map((item: any) => item.tenant.id), [w.a.tenantId]);
  const second = await generate(batch.id, "JPY");
  assert.deepEqual((await fileDetail(second.id)).items.map((item: any) => item.tenant.id), [w.b.tenantId]);
});

test("复核发起后账单版本变了：批准要过期，不生成文件", async () => {
  const w = await world();
  await activeAccount(w.a, fakeAccount());
  await orderFor(w, "a", 10, 20_000, "JPY");
  const batch = await batchFor(w);
  const requested = await requestFile(batch.id, { currency: "JPY" });
  await owner("update statements set version = version + 1 where id = $1", [batch.ofTenant(w.a, "JPY").id]);
  const stale = await approve(requested.body.approval.id);
  assert.deepEqual([stale.status, stale.body.error.code], [409, "APPROVAL_STALE"]);
  assert.equal((await filesOf(batch.id)).length, 0);
});

test("发起人不能批准自己的复核：重新登录、超级管理员、驳回也一样；两类复核都拦", async () => {
  const w = await world();
  const account = await submit(w.a, accountBody(fakeAccount()));
  const activation = await requestActivation(account.id);
  const relogin = (await ok(api.platformLogin({ body: { email: finance1.email, password: TEST_PASSWORD } }))).access_token as string;
  for (const [decision, body] of [["approve", {}], ["reject", { note: "x" }]] as const) {
    const res = await api.call("POST", `/platform/v1/approvals/${activation}/${decision}`, { token: relogin, body });
    assert.deepEqual([res.status, res.body.error.code], [409, "APPROVAL_SELF_REVIEW"], decision);
  }
  await ok(approve(activation));
  assert.equal((await owner("select status from payout_accounts where id = $1", [account.id])).rows[0].status, "active");

  // 超级管理员发起，自己也批不了；另一位财务能批
  await orderFor(w, "a", 10, 20_000, "JPY");
  const batch = await batchFor(w);
  const requested = await requestFile(batch.id, { currency: "JPY" }, await root());
  assert.equal(requested.status, 202, requested.text);
  const self = await approve(requested.body.approval.id, await root());
  assert.deepEqual([self.status, self.body.error.code], [409, "APPROVAL_SELF_REVIEW"]);
  assert.equal((await filesOf(batch.id)).length, 0);
  await ok(approve(requested.body.approval.id, await fin2()));
  const [file] = await filesOf(batch.id);
  assert.equal(file.requested_by, (await owner("select requested_by from approvals where id = $1", [requested.body.approval.id])).rows[0].requested_by);
  assert.equal(file.approved_by, finance2.id);
});

test("两位审核人同时批准同一条：只有一个成功，只生成一个文件", async () => {
  const w = await world();
  await activeAccount(w.a, fakeAccount());
  await orderFor(w, "a", 10, 20_000, "JPY");
  const batch = await batchFor(w);
  const requested = await requestFile(batch.id, { currency: "JPY" }, await fin1());
  const results = await Promise.all([approve(requested.body.approval.id, await fin2()), approve(requested.body.approval.id, await root())]);
  assert.deepEqual(results.map((res: any) => res.status).sort(), [200, 409], results.map((res: any) => res.text).join(" | "));
  assert.equal((await filesOf(batch.id)).length, 1);
});

test("账户内容不可变：平台角色不管怎么写（单列、连带状态、upsert、改 tenant_id）都被拒；删不掉；租户角色写不了", async () => {
  const w = await world();
  const account = await activeAccount(w.a, fakeAccount());
  const key = [w.a.tenantId, account.id];
  const updates = [
    "update payout_accounts set account_sealed = 'v1.a.b.c' where tenant_id = $1 and id = $2",
    "update payout_accounts set account_last4 = '0000' where tenant_id = $1 and id = $2",
    "update payout_accounts set beneficiary_name = 'Other Co' where tenant_id = $1 and id = $2",
    "update payout_accounts set bank_name = 'Other Bank' where tenant_id = $1 and id = $2",
    "update payout_accounts set swift_bic = 'OTHRJPJT' where tenant_id = $1 and id = $2",
    "update payout_accounts set currency = 'USD' where tenant_id = $1 and id = $2",
    "update payout_accounts set account_kind = 'iban' where tenant_id = $1 and id = $2",
    "update payout_accounts set status = status, swift_bic = 'OTHRJPJT' where tenant_id = $1 and id = $2",
    `update payout_accounts set tenant_id = '${w.b.tenantId}' where tenant_id = $1 and id = $2`,
    `insert into payout_accounts select * from payout_accounts where tenant_id = $1 and id = $2 on conflict (tenant_id, id) do update set account_sealed = 'v1.a.b.c'`,
    "delete from payout_accounts where tenant_id = $1 and id = $2",
  ];
  for (const sql of updates) await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query(sql, key)), deniedByDatabase, sql);
  await assert.rejects(withTenantTx(api.db.pool, w.a.tenantId, (db) => db.query("update payout_accounts set beneficiary_name = 'x' where id = $1", [account.id])), deniedByDatabase);
  await assert.rejects(withTenantTx(api.db.pool, w.a.tenantId, (db) => db.query("delete from payout_accounts where id = $1", [account.id])), deniedByDatabase);
  await assert.rejects(withTenantTx(api.db.pool, w.a.tenantId, (db) => db.query("insert into payout_accounts select * from payout_accounts where id = $1", [account.id])), deniedByDatabase);
});

test("文件条目和文件也不能改：金额、密文、账户、租户、合计都被拒；删不掉", async () => {
  const w = await world();
  await activeAccount(w.a, fakeAccount());
  await orderFor(w, "a", 10, 20_000, "JPY");
  const batch = await batchFor(w);
  const file = await generate(batch.id, "JPY");
  const itemId = (await fileDetail(file.id)).items[0].id;
  for (const set of ["amount_minor = 1", "account_sealed = 'v1.a.b.c'", `account_id = '${itemId}'`, `tenant_id = '${w.b.tenantId}'`, "beneficiary_name = 'x'", "swift_bic = 'x'", "currency = 'USD'", "reference = 'x'"]) {
    await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query(`update bank_file_items set ${set} where id = $1`, [itemId])), deniedByDatabase, set);
  }
  await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query("delete from bank_file_items where id = $1", [itemId])), deniedByDatabase);
  for (const set of ["total_minor = 1", "currency = 'USD'", "item_count = 9", "charge_bearer = 'OUR'", "approved_by = requested_by"]) {
    await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query(`update bank_files set ${set} where id = $1`, [file.id])), deniedByDatabase, set);
  }
  await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query("delete from bank_files where id = $1", [file.id])), deniedByDatabase);
});

test("数据库层的账户状态机：已被替换的账户不能退回生效（纵深防御）", async () => {
  const w = await world();
  const old = await activeAccount(w.a, fakeAccount());
  const current = await activeAccount(w.a, fakeAccount());
  await assert.rejects(
    withPlatformTx(api.db.pool, async (db) => {
      await db.query("update payout_accounts set status = 'superseded', superseded_at = now() where tenant_id = $1 and id = $2", [w.a.tenantId, current.id]);
      await db.query("update payout_accounts set status = 'active', superseded_at = null where tenant_id = $1 and id = $2", [w.a.tenantId, old.id]);
    }),
    "平台角色的 SQL 能把旧账号复活成生效，绕过两人复核",
  );
});

test("数据库层的账户状态机：新账户不能跳过待审核直接写成生效，也不能挂别的账户的复核编号（纵深防御）", async () => {
  const w = await world();
  const reused = await activeAccount(w.b, fakeAccount());
  const approvalId = (await owner("select approval_id from payout_accounts where id = $1", [reused.id])).rows[0].approval_id;
  await assert.rejects(
    withPlatformTx(api.db.pool, (db) =>
      db.query(
        `insert into payout_accounts (tenant_id, id, currency, beneficiary_name, beneficiary_address, bank_name, bank_address, swift_bic, account_kind, account_sealed, account_last4, status, submitted_by, submitted_at, approval_id, activated_at, updated_at)
         values ($1, gen_random_uuid(), 'JPY', 'Attacker Co', 'x', 'x', 'x', 'OTHRJPJT', 'account', 'v1.a.b.c', '0000', 'active', $2, now(), $3, now(), now())`,
        [w.a.tenantId, w.a.adminId, approvalId],
      ),
    ),
    "平台角色能直接插入一条生效的账户",
  );
});

// ---- 租户 A 的账单打到 B 的账户 ----

test("B 的账单绝不用 A 的账户：同币种只有 A 有账户时 B 明确排除；文件每一行收款账户的租户都等于账单的租户", async () => {
  const w = await world();
  await activeAccount(w.a, fakeAccount());
  await orderFor(w, "a", 10, 20_000, "JPY");
  await orderFor(w, "b", 11, 19_800, "JPY");
  const batch = await batchFor(w);
  const preview = await ok(api.call("GET", `/platform/v1/payout-batches/${batch.id}/bank-file-preview`, { token: await fin1() }));
  const group = preview.preview.groups[0];
  assert.deepEqual(group.eligible.map((entry: any) => entry.tenant.id), [w.a.tenantId]);
  assert.deepEqual(group.excluded.map((entry: any) => [entry.tenant.id, entry.code]), [[w.b.tenantId, "ACCOUNT_MISSING"]]);
  await activeAccount(w.b, fakeAccount());
  const file = await generate(batch.id, "JPY", { allow_exclusions: true });
  const lines = await owner(
    `select i.tenant_id as item_tenant, s.tenant_id as statement_tenant, a.tenant_id as account_tenant, i.amount_minor, s.total_minor, i.currency as item_currency, s.currency as statement_currency, a.currency as account_currency
       from bank_file_items i join statements s on s.id = i.statement_id join payout_accounts a on a.id = i.account_id where i.file_id = $1`,
    [file.id],
  );
  assert.equal(lines.rows.length, 2);
  for (const row of lines.rows) {
    assert.equal(row.item_tenant, row.statement_tenant);
    assert.equal(row.account_tenant, row.statement_tenant);
    assert.equal(row.amount_minor, row.total_minor);
    assert.deepEqual([row.item_currency, row.account_currency], [row.statement_currency, row.statement_currency]);
  }
});

test("数据库层：条目的账户和账单必须是同一家（外键）；密文搬到别的账户上解不开", async () => {
  const w = await world();
  const accountA = await activeAccount(w.a, fakeAccount());
  const accountB = await activeAccount(w.b, fakeAccount());
  await orderFor(w, "a", 10, 20_000, "JPY");
  const batch = await batchFor(w);
  const file = await generate(batch.id, "JPY");
  const item = (await owner("select * from bank_file_items where file_id = $1", [file.id])).rows[0];
  await owner("update bank_file_items set voided_at = now() where id = $1", [item.id]);
  await assert.rejects(
    owner(
      `insert into bank_file_items (tenant_id, file_id, seq, statement_id, statement_no, account_id, amount_minor, currency, beneficiary_name, beneficiary_address, bank_name, bank_address, swift_bic, account_sealed, account_last4, reference)
       values ($1, $2, 2, $3, $4, $5, 1, 'JPY', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x')`,
      [w.a.tenantId, file.id, item.statement_id, item.statement_no, accountB.id],
    ),
    (err: any) => err.code === "23503",
    "A 的账单不能挂 B 的账户",
  );
  await owner("update bank_file_items set voided_at = null where id = $1", [item.id]);

  // 把 B 账户的密文搬到这一条上（迁移账号关掉触发器才做得到）：账号解不开，不会发出 B 的账号
  const sealedB = (await owner("select account_sealed from payout_accounts where id = $1", [accountB.id])).rows[0].account_sealed;
  await owner("alter table bank_file_items disable trigger bank_file_items_platform_columns");
  try {
    await owner("update bank_file_items set account_sealed = $2 where id = $1", [item.id, sealedB]);
    const res = await download(file.id, "csv");
    assert.deepEqual([res.status, res.code], [409, "BANK_FILE_ACCOUNT_UNREADABLE"]);
    assert.equal(accountA.id, item.account_id);
  } finally {
    await owner("update bank_file_items set account_sealed = $2 where id = $1", [item.id, item.account_sealed]);
    await owner("alter table bank_file_items enable trigger bank_file_items_platform_columns");
  }
});

// ---- SHA-256 ----

test("换了主密钥：下载一律拒绝（不给缺账号的文件），不改状态、不写哈希、不计次数；发起生成时明确排除", async () => {
  const w = await world();
  await activeAccount(w.a, fakeAccount());
  await orderFor(w, "a", 10, 20_000, "JPY");
  const batch = await batchFor(w);
  const file = await generate(batch.id, "JPY");
  const rotated = await appWithKey(ROTATED_KEY);
  try {
    const before = (await owner("select status, download_count, csv_sha256 from bank_files where id = $1", [file.id])).rows[0];
    const res = await download(file.id, "csv", await fin1(), rotated);
    assert.deepEqual([res.status, res.code], [409, "BANK_FILE_ACCOUNT_UNREADABLE"]);
    assert.deepEqual((await owner("select status, download_count, csv_sha256 from bank_files where id = $1", [file.id])).rows[0], before);
    assert.equal((await owner("select count(*)::int as n from audit_logs where resource = 'bank_file' and action = 'download' and resource_id = $1", [file.id])).rows[0].n, 0);

    // 同一个供应商的第二张账单：换密钥后发起生成，账号解不开，要明确排除
    await orderFor(w, "b", 11, 19_800, "JPY");
    await activeAccount(w.b, fakeAccount());
    const second = await batchFor(w);
    const refused = await rotated.inject({ method: "POST", url: `/platform/v1/payout-batches/${second.id}/bank-files`, headers: { authorization: `Bearer ${await fin1()}`, "content-type": "application/json" }, payload: { currency: "JPY" } });
    assert.equal(refused.statusCode, 409, refused.body);
    assert.deepEqual([refused.json().error.code, refused.json().error.details.excluded[0].code], ["BANK_FILE_EMPTY", "ACCOUNT_UNREADABLE"]);
  } finally {
    await rotated.close();
  }
});

/** 用合法的密文把条目换成同一家的另一个账户：解得开，只是账号变了（模拟有库权限的人改数据）。 */
async function swapItemAccount(itemId: string, accountId: string): Promise<void> {
  const sealed = (await owner("select account_sealed from payout_accounts where id = $1", [accountId])).rows[0].account_sealed;
  await owner("alter table bank_file_items disable trigger bank_file_items_platform_columns");
  try {
    await owner("update bank_file_items set account_id = $2, account_sealed = $3 where id = $1", [itemId, accountId, sealed]);
  } finally {
    await owner("alter table bank_file_items enable trigger bank_file_items_platform_columns");
  }
}

test("已记过哈希的格式：条目被换成同一家别的账户（密文合法），再下载必须拒绝", async () => {
  const w = await world();
  const other = await activeAccount(w.a, fakeAccount());
  await activeAccount(w.a, fakeAccount());
  await orderFor(w, "a", 10, 20_000, "JPY");
  const batch = await batchFor(w);
  const file = await generate(batch.id, "JPY");
  const first = await download(file.id, "csv");
  assert.equal(first.status, 200);
  await swapItemAccount((await fileDetail(file.id)).items[0].id, other.id);
  const res = await download(file.id, "csv");
  assert.deepEqual([res.status, res.code], [409, "BANK_FILE_INTEGRITY"]);
  assert.equal((await fileDetail(file.id)).download_count, 1, "拒绝的不计次数");
});

test("第一次下载之前条目被换了账户：不能静默发出和复核不一致的账号（账号末 4 位和快照对不上）", async () => {
  const w = await world();
  const approved = fakeAccount();
  const other = await activeAccount(w.a, fakeAccount());
  await activeAccount(w.a, approved);
  await orderFor(w, "a", 10, 20_000, "JPY");
  const batch = await batchFor(w);
  const file = await generate(batch.id, "JPY");
  await swapItemAccount((await fileDetail(file.id)).items[0].id, other.id);
  const res = await download(file.id, "csv");
  assert.notEqual(res.status, 200, `第一次下载没有任何比对，发出了复核时没有的账号：${res.status === 200 ? "下载成功" : res.code}`);
});

test("CSV 记过哈希后条目被改，第一次下载 Excel 不能绕过：两种格式应该用同一个基准", async () => {
  const w = await world();
  const other = await activeAccount(w.a, fakeAccount());
  await activeAccount(w.a, fakeAccount());
  await orderFor(w, "a", 10, 20_000, "JPY");
  const batch = await batchFor(w);
  const file = await generate(batch.id, "JPY");
  assert.equal((await download(file.id, "csv")).status, 200);
  await swapItemAccount((await fileDetail(file.id)).items[0].id, other.id);
  assert.equal((await download(file.id, "csv")).code, "BANK_FILE_INTEGRITY", "CSV 拦住了");
  const xlsx = await download(file.id, "xlsx");
  assert.notEqual(xlsx.status, 200, "Excel 第一次下载没有基准，发出了被改过的账号");
});

test("文件的合计、笔数和条目对不上（条目金额被改）：下载必须拒绝，不能发出合计和复核不一致的文件", async () => {
  const w = await world();
  await activeAccount(w.a, fakeAccount());
  await orderFor(w, "a", 10, 20_000, "JPY");
  const batch = await batchFor(w);
  const file = await generate(batch.id, "JPY");
  const itemId = (await fileDetail(file.id)).items[0].id;
  await owner("alter table bank_file_items disable trigger bank_file_items_platform_columns");
  try {
    await owner("update bank_file_items set amount_minor = 2000000 where id = $1", [itemId]);
  } finally {
    await owner("alter table bank_file_items enable trigger bank_file_items_platform_columns");
  }
  const res = await download(file.id, "csv");
  assert.notEqual(res.status, 200, `文件合计 ${file.total.amount}，条目被改成 2000000，下载没有核对就发出去了`);
});

test("并发第一次下载：内容一样，次数和审计都不丢；哈希和内容对得上", async () => {
  const w = await world();
  await activeAccount(w.a, fakeAccount());
  await orderFor(w, "a", 10, 20_000, "JPY");
  const batch = await batchFor(w);
  const file = await generate(batch.id, "JPY");
  const token = await fin1();
  const [one, two] = await Promise.all([download(file.id, "csv", token), download(file.id, "csv", token)]);
  assert.deepEqual([one.status, two.status], [200, 200]);
  assert.ok(one.bytes.equals(two.bytes));
  const detail = await fileDetail(file.id);
  assert.equal(detail.download_count, 2);
  assert.equal(detail.csv_sha256, createHash("sha256").update(one.bytes).digest("hex"));
  assert.equal((await owner("select count(*)::int as n from audit_logs where resource = 'bank_file' and action = 'download' and resource_id = $1", [file.id])).rows[0].n, 2);
});

// ---- 2. 金额 ----

test("文件金额等于账单应付额，合计等于各行之和：SGD 0.01、大额，JPY 无小数位", async () => {
  const w = await world();
  await activeAccount(w.a, fakeAccount(), { currency: "SGD", swift_bic: "FAKESGSG" });
  await activeAccount(w.b, fakeAccount(), { currency: "SGD", swift_bic: "FAKESGSG" });
  await activeAccount(w.a, fakeAccount());
  await orderFor(w, "a", 10, 1, "SGD");
  await orderFor(w, "b", 11, 99_999_999_999, "SGD");
  await orderFor(w, "a", 12, 1, "JPY");
  const batch = await batchFor(w);
  const sgd = await generate(batch.id, "SGD");
  assert.equal(sgd.total.amount, "1000000000.00");
  const rows = csvRows((await download(sgd.id, "csv")).bytes);
  const amounts = Object.fromEntries((await fileDetail(sgd.id)).items.map((item: any, index: number) => [item.tenant.id, rows[index + 1]?.[COL.amount]]));
  assert.deepEqual(amounts, { [w.a.tenantId]: "0.01", [w.b.tenantId]: "999999999.99" });
  const stored = await owner("select i.amount_minor, s.total_minor from bank_file_items i join statements s on s.id = i.statement_id where i.file_id = $1", [sgd.id]);
  for (const row of stored.rows) assert.equal(row.amount_minor, row.total_minor);
  assert.equal(rows.at(-1)?.[COL.amount], "1000000000.00");
  const jpy = await generate(batch.id, "JPY");
  const jpyRows = csvRows((await download(jpy.id, "csv")).bytes);
  assert.deepEqual([jpyRows[1]?.[COL.amount], jpyRows.at(-1)?.[COL.amount]], ["1", "1"]);
});

test("同一批次跨币种：各出各的文件，币种不串；同一家的两种币种各走自己币种的账户，不回退到别的币种", async () => {
  const w = await world();
  const jpyNumber = fakeAccount();
  const sgdNumber = fakeAccount();
  await activeAccount(w.a, jpyNumber);
  await activeAccount(w.a, sgdNumber, { currency: "SGD", swift_bic: "FAKESGSG" });
  await activeAccount(w.b, fakeAccount());
  await orderFor(w, "a", 10, 20_000, "JPY");
  await orderFor(w, "a", 11, 123_450, "SGD");
  await orderFor(w, "b", 12, 10_000, "SGD");
  const batch = await batchFor(w);
  const preview = await ok(api.call("GET", `/platform/v1/payout-batches/${batch.id}/bank-file-preview`, { token: await fin1() }));
  const sgdGroup = preview.preview.groups.find((group: any) => group.currency === "SGD");
  assert.deepEqual(sgdGroup.excluded.map((entry: any) => [entry.tenant.id, entry.code]), [[w.b.tenantId, "ACCOUNT_MISSING"]], "乙只有 JPY 账户，SGD 账单不能走它");
  const jpy = await generate(batch.id, "JPY");
  const sgd = await generate(batch.id, "SGD", { allow_exclusions: true });
  const jpyRows = csvRows((await download(jpy.id, "csv")).bytes);
  const sgdRows = csvRows((await download(sgd.id, "csv")).bytes);
  assert.deepEqual([jpyRows[1]?.[COL.account], jpyRows[1]?.[COL.currency], jpyRows[1]?.[COL.amount]], [jpyNumber, "JPY", "20000"]);
  assert.deepEqual([sgdRows[1]?.[COL.account], sgdRows[1]?.[COL.currency], sgdRows[1]?.[COL.amount]], [sgdNumber, "SGD", "1234.50"]);
  for (const rows of [jpyRows, sgdRows]) assert.equal(new Set(rows.slice(1).map((row) => row[COL.currency])).size, 1);
  assert.deepEqual([jpy.currency, sgd.currency], ["JPY", "SGD"]);
  for (const body of [{ currency: "EUR" }, { currency: "KWD" }, { currency: "jpy" }]) assert.equal((await requestFile(batch.id, body)).status, 400, body.currency);
  const none = await requestFile(batch.id, { currency: "USD" });
  assert.deepEqual([none.status, none.body.error.code], [409, "BANK_FILE_EMPTY"]);
});

test("批次里有平台不支持币种的账单：预览不能 500，要按 CURRENCY_UNSUPPORTED 明确列出（ADR 0051 的表）", async () => {
  const w = await world();
  await activeAccount(w.a, fakeAccount());
  await orderFor(w, "a", 10, 20_000, "JPY");
  await orderFor(w, "b", 11, 12_345, "JPY");
  const batch = await batchFor(w);
  await owner("update statements set currency = 'KWD' where id = $1", [batch.ofTenant(w.b, "JPY").id]);
  const res = await api.call("GET", `/platform/v1/payout-batches/${batch.id}/bank-file-preview`, { token: await fin1() });
  assert.equal(res.status, 200, `预览应该列出原因，实际：${res.status} ${res.text.slice(0, 200)}`);
  const group = res.body.preview.groups.find((entry: any) => entry.currency === "KWD");
  assert.deepEqual(group.excluded.map((entry: any) => entry.code), ["CURRENCY_UNSUPPORTED"]);
});

test("违约金扣减后合计为 0 或负数：复核后记「无需付款」「结转」，不进批次、不进文件；有账户也不会多打一笔", async () => {
  const w = await world();
  await activeAccount(w.a, fakeAccount());
  await activeAccount(w.b, fakeAccount());
  const penalty = async (side: "a" | "b", amount: number): Promise<void> => {
    await orderFor(w, side, 10, 20_000, "JPY");
    const at = new Date("2026-09-11T10:00:00+09:00");
    const rescued = await seedOrder(api, w, side, { serviceAt: at, confirmedAt: new Date(at.getTime() - 3 * DAY) });
    await owner("update orders set status = 'rescued', rescued_at = $3 where tenant_id = $1 and id = $2", [w[side].tenantId, rescued.id, at]);
    const rescueId = randomUUID();
    const now = new Date("2026-09-01T00:00:00Z");
    await owner(
      `insert into order_rescues (id, order_id, original_tenant_id, trigger, triggered_by_type, triggered_at, from_status, service_at, original_settlement_minor, original_settlement_currency, penalty_bp, penalty_tier, status, closed_at, created_at, updated_at)
       values ($1, $2, $3, 'dispatch_overdue', 'system', $4, 'confirmed', $4, 20000, 'JPY', 10000, 'full', 'cancelled', $4, $4, $4)`,
      [rescueId, rescued.id, w[side].tenantId, now],
    );
    await owner(
      `insert into tenant_deductions (tenant_id, id, order_id, rescue_id, kind, amount_minor, currency, basis, status, created_at, updated_at)
       values ($1, $2, $3, $4, 'penalty', $5, 'JPY', '{"bp": 10000}'::jsonb, 'pending', $6, $6)`,
      [w[side].tenantId, randomUUID(), rescued.id, rescueId, amount, now],
    );
  };
  await penalty("a", 20_000);
  await penalty("b", 50_000);
  const generated = await ok(api.call("POST", "/platform/v1/statements/generate", { token: await fin1(), body: { period: "2026-09" } }));
  const created = generated.created.filter((statement: any) => statement.tenant.id === w.a.tenantId || statement.tenant.id === w.b.tenantId);
  assert.equal(created.length, 2);
  for (const statement of created) {
    const who = statement.tenant.id === w.a.tenantId ? w.a : w.b;
    await ok(api.call("POST", `/tenant/v1/statements/${statement.id}/confirm`, { token: await admin(who), body: {} }));
    const requested = await ok(api.call("POST", `/platform/v1/statements/${statement.id}/payout-approval`, { token: await fin1(), body: {} }), 202);
    await ok(approve(requested.approval.id));
    const row = (await owner("select status, total_minor, payout_batch_id from statements where id = $1", [statement.id])).rows[0];
    assert.deepEqual([row.status, Number(row.total_minor), row.payout_batch_id], who === w.a ? ["settled", 0, null] : ["carried", -30_000, null]);
    assert.equal((await owner("select count(*)::int as n from bank_file_items where statement_id = $1", [statement.id])).rows[0].n, 0);
  }
});

// ---- 回填、作废 ----

test("一次回填里混了别的文件的条目：整体回滚，一笔都不记", async () => {
  const w = await world();
  await activeAccount(w.a, fakeAccount());
  await activeAccount(w.a, fakeAccount(), { currency: "SGD", swift_bic: "FAKESGSG" });
  await orderFor(w, "a", 10, 20_000, "JPY");
  await orderFor(w, "a", 11, 10_000, "SGD");
  const batch = await batchFor(w);
  const jpy = await generate(batch.id, "JPY");
  const sgd = await generate(batch.id, "SGD");
  await download(jpy.id, "csv");
  await download(sgd.id, "csv");
  const own = (await fileDetail(jpy.id)).items[0];
  const foreign = (await fileDetail(sgd.id)).items[0];
  const res = await pay(jpy.id, [{ item_id: own.id, bank_reference: "FT-OWN" }, { item_id: foreign.id, bank_reference: "FT-OWN" }]);
  assert.equal(res.status, 404);
  assert.equal((await fileDetail(jpy.id)).items[0].paid_at, null, "第一笔也回滚了");
  assert.equal((await owner("select status from statements where id = $1", [own.statement_id])).rows[0].status, "in_payout");
  assert.equal((await owner("select count(*)::int as n from webhook_deliveries where tenant_id = $1 and event_type = 'payout.paid'", [w.a.tenantId])).rows[0].n, 0);
});

test("回填幂等：并发同号、同一请求重复同一笔、提交两遍，payout.paid 只推一次，账单经过只有一条", async () => {
  const w = await world();
  await activeAccount(w.a, fakeAccount());
  await activeAccount(w.b, fakeAccount());
  await orderFor(w, "a", 10, 20_000, "JPY");
  await orderFor(w, "b", 11, 19_800, "JPY");
  const batch = await batchFor(w);
  await ok(api.call("PUT", "/tenant/v1/webhooks", { token: await admin(w.a), body: { url: "https://hooks.example.com/qa-nozomi", events: ["payout.paid"] } }), 201);
  const file = await generate(batch.id, "JPY");
  await download(file.id, "csv");
  const items = (await fileDetail(file.id)).items;
  const itemA = items.find((item: any) => item.tenant.id === w.a.tenantId);
  const itemB = items.find((item: any) => item.tenant.id === w.b.tenantId);
  const token = await fin1();
  const raced = await Promise.all([pay(file.id, [{ item_id: itemA.id, bank_reference: "FT-SAME" }], token), pay(file.id, [{ item_id: itemA.id, bank_reference: "FT-SAME" }], token)]);
  assert.deepEqual(raced.map((res: any) => res.status), [200, 200], raced.map((res: any) => res.text).join(" | "));
  const doubled = await pay(file.id, [{ item_id: itemB.id, bank_reference: "FT-B" }, { item_id: itemB.id, bank_reference: "FT-B" }], token);
  assert.equal(doubled.status, 200, doubled.text);
  assert.equal(doubled.body.file.status, "paid");
  for (const item of [itemA, itemB]) assert.equal((await owner("select count(*)::int as n from statement_events where statement_id = $1 and action = 'pay'", [item.statement_id])).rows[0].n, 1);
  const deliveries = await owner("select event_data from webhook_deliveries where tenant_id = $1 and event_type = 'payout.paid'", [w.a.tenantId]);
  assert.equal(deliveries.rows.length, 1);
  assert.deepEqual(Object.keys(deliveries.rows[0].event_data).sort(), ["bank_reference", "paid_at", "statement_id", "statement_no"], "推给供应商的没有账号、文件内容");
  const conflicting = await pay(file.id, [{ item_id: itemB.id, bank_reference: "FT-B" }, { item_id: itemB.id, bank_reference: "FT-OTHER" }]);
  assert.equal(conflicting.status, 409, "同一请求里同一笔两个流水号");
});

test("同一请求里同一笔先后两个不同流水号（文件未收尾）：整体拒绝，不留下任何一个", async () => {
  const w = await world();
  await activeAccount(w.a, fakeAccount());
  await activeAccount(w.b, fakeAccount());
  await orderFor(w, "a", 10, 20_000, "JPY");
  await orderFor(w, "b", 11, 19_800, "JPY");
  const batch = await batchFor(w);
  const file = await generate(batch.id, "JPY");
  await download(file.id, "csv");
  const [item] = (await fileDetail(file.id)).items;
  const res = await pay(file.id, [{ item_id: item.id, bank_reference: "FT-1" }, { item_id: item.id, bank_reference: "FT-2" }]);
  assert.deepEqual([res.status, res.body.error.code], [409, "BANK_FILE_ITEM_ALREADY_PAID"]);
  assert.equal((await fileDetail(file.id)).items[0].paid_at, null);
});

test("状态不能倒退：已作废的不能回填、下载；已付款的不能作废；付完的批次不能再生成；流水号去掉首尾空白；超过 500 笔拒绝", async () => {
  const w = await world();
  await activeAccount(w.a, fakeAccount());
  await activeAccount(w.a, fakeAccount(), { currency: "SGD", swift_bic: "FAKESGSG" });
  await orderFor(w, "a", 10, 20_000, "JPY");
  await orderFor(w, "a", 11, 10_000, "SGD");
  const batch = await batchFor(w);
  const jpy = await generate(batch.id, "JPY");
  await download(jpy.id, "csv");
  const jpyItem = (await fileDetail(jpy.id)).items[0];
  const voided = await ok(api.call("POST", `/platform/v1/bank-files/${jpy.id}/void`, { token: await fin1(), body: { reason: "重新生成" } }));
  assert.equal(voided.file.status, "void");
  const late = await pay(jpy.id, [{ item_id: jpyItem.id, bank_reference: "FT-LATE" }]);
  assert.deepEqual([late.status, late.body.error.code], [409, "BANK_FILE_STATE_INVALID"]);
  assert.equal((await owner("select status from statements where id = $1", [jpyItem.statement_id])).rows[0].status, "in_payout");

  const again = await generate(batch.id, "JPY");
  const sgd = await generate(batch.id, "SGD");
  await download(again.id, "csv");
  await download(sgd.id, "csv");
  const tooMany = Array.from({ length: 501 }, () => ({ item_id: (jpyItem as any).id, bank_reference: "FT" }));
  assert.equal((await pay(again.id, tooMany)).status, 400);
  const paidJpy = await pay(again.id, [{ item_id: (await fileDetail(again.id)).items[0].id, bank_reference: "  FT-TRIM  " }]);
  assert.equal(paidJpy.body.file.items[0].bank_reference, "FT-TRIM");
  const refused = await api.call("POST", `/platform/v1/bank-files/${again.id}/void`, { token: await fin1(), body: { reason: "x" } });
  assert.deepEqual([refused.status, refused.body.error.code], [409, "BANK_FILE_STATE_INVALID"]);
  await pay(sgd.id, [{ item_id: (await fileDetail(sgd.id)).items[0].id, bank_reference: "FT-SGD" }]);
  const finished = await ok(api.call("GET", `/platform/v1/payout-batches/${batch.id}`, { token: await fin1() }));
  assert.equal(finished.batch.status, "paid");
  const closedOut = await requestFile(batch.id, { currency: "JPY" });
  assert.deepEqual([closedOut.status, closedOut.body.error.code], [409, "BATCH_NOT_CLOSED"]);
});

test("部分回填后作废：已付的账单仍是已付、流水号不变、不会进新文件；只有没付的释放；同一张不会付两次", async () => {
  const w = await world();
  const accountB = fakeAccount();
  await activeAccount(w.a, fakeAccount());
  await activeAccount(w.b, accountB);
  await orderFor(w, "a", 10, 20_000, "JPY");
  await orderFor(w, "b", 11, 19_800, "JPY");
  const batch = await batchFor(w);
  const file = await generate(batch.id, "JPY");
  await download(file.id, "csv");
  const items = (await fileDetail(file.id)).items;
  const paid = items.find((item: any) => item.tenant.id === w.a.tenantId);
  await ok(pay(file.id, [{ item_id: paid.id, bank_reference: "FT-PARTIAL" }]));
  const closed = await ok(api.call("POST", `/platform/v1/bank-files/${file.id}/void`, { token: await fin1(), body: { reason: "第二笔退汇" } }));
  assert.equal(closed.file.status, "paid");
  const row = (await owner("select status, bank_reference from statements where id = $1", [paid.statement_id])).rows[0];
  assert.deepEqual([row.status, row.bank_reference], ["paid", "FT-PARTIAL"]);
  const next = await generate(batch.id, "JPY");
  assert.equal(next.item_count, 1);
  const detail = await fileDetail(next.id);
  assert.deepEqual(detail.items.map((item: any) => item.tenant.id), [w.b.tenantId]);
  assert.ok(!(await download(next.id, "csv")).bytes.toString("utf8").includes(paid.statement_no), "已付的账单不在新文件里");
  const again = await requestFile(batch.id, { currency: "JPY" });
  assert.deepEqual([again.status, again.body.error.code], [409, "BANK_FILE_EMPTY"]);
  const counts = await owner("select statement_id, count(*) filter (where voided_at is null)::int as active from bank_file_items where file_id in (select id from bank_files where payout_batch_id = $1) group by statement_id", [batch.id]);
  for (const entry of counts.rows) assert.equal(entry.active, 1, "每张账单只在一个未作废的条目里");
});

test("并发：回填和作废同一个文件，结果只能是两种之一，账单和条目一致；两个文件同时付完，批次只收尾一次", async () => {
  const w = await world();
  await activeAccount(w.a, fakeAccount());
  await activeAccount(w.a, fakeAccount(), { currency: "SGD", swift_bic: "FAKESGSG" });
  await orderFor(w, "a", 10, 20_000, "JPY");
  await orderFor(w, "a", 11, 10_000, "SGD");
  const batch = await batchFor(w);
  const file = await generate(batch.id, "JPY");
  await download(file.id, "csv");
  const item = (await fileDetail(file.id)).items[0];
  const token = await fin1();
  await Promise.all([pay(file.id, [{ item_id: item.id, bank_reference: "FT-RACE" }], token), api.call("POST", `/platform/v1/bank-files/${file.id}/void`, { token, body: { reason: "并发" } })]);
  const stored = (await owner("select i.paid_at, i.voided_at, s.status, f.status as file_status from bank_file_items i join statements s on s.id = i.statement_id join bank_files f on f.id = i.file_id where i.id = $1", [item.id])).rows[0];
  if (stored.paid_at !== null) assert.deepEqual([stored.status, stored.voided_at, stored.file_status], ["paid", null, "paid"]);
  else assert.deepEqual([stored.status, stored.file_status, stored.voided_at !== null], ["in_payout", "void", true]);

  // 把另一半也付掉：不管上面谁赢，都走到批次收尾
  const jpyAgain = stored.paid_at === null ? await generate(batch.id, "JPY") : null;
  const sgd = await generate(batch.id, "SGD");
  await download(sgd.id, "csv");
  if (jpyAgain !== null) await download(jpyAgain.id, "csv");
  const jobs = [pay(sgd.id, [{ item_id: (await fileDetail(sgd.id)).items[0].id, bank_reference: "FT-S" }], token)];
  if (jpyAgain !== null) jobs.push(pay(jpyAgain.id, [{ item_id: (await fileDetail(jpyAgain.id)).items[0].id, bank_reference: "FT-J" }], token));
  await Promise.all(jobs);
  assert.equal((await ok(api.call("GET", `/platform/v1/payout-batches/${batch.id}`, { token }))).batch.status, "paid");
  assert.equal((await owner("select count(*)::int as n from audit_logs where resource = 'payout_batch' and action = 'pay' and resource_id = $1", [batch.id])).rows[0].n, 1);
});

test("批次没锁定不能生成（生成前要先锁定）；锁定后的批次新复核通过的账单顺延，不进已锁定的批次", async () => {
  const w = await world();
  await activeAccount(w.a, fakeAccount());
  await activeAccount(w.b, fakeAccount());
  await orderFor(w, "a", 10, 20_000, "JPY");
  const open = await batchFor(w, { close: false });
  const refused = await requestFile(open.id, { currency: "JPY" });
  assert.deepEqual([refused.status, refused.body.error.code], [409, "BATCH_NOT_CLOSED"]);
  await ok(api.call("POST", `/platform/v1/payout-batches/${open.id}/close`, { token: await fin1(), body: {} }));
  await orderFor(w, "b", 11, 19_800, "JPY");
  const later = await batchFor(w);
  assert.notEqual(later.id, open.id);
});

// ---- 字段校验（接口层） ----

test("提交账户：换行和制表符整理成空格，存进库的字段没有控制字符；引号、等号、& 拒绝；IBAN 现算的能过，抄错校验位的不过；小写 BIC 转大写", async () => {
  const w = await world();
  const token = await admin(w.a);
  const bban = "FAKE00000000000042";
  const iban = `GB${ibanCheckDigits("GB", bban)}${bban}`;
  const created = await submit(w.a, accountBody(iban.toLowerCase().replace(/(.{4})/g, "$1 "), { currency: "USD", account_kind: "iban", swift_bic: "fakegb2lxxx", beneficiary_name: "Fictional\r\nTransport\tLtd" }));
  assert.equal(created.beneficiary_name, "Fictional Transport Ltd");
  assert.equal(created.swift_bic, "FAKEGB2LXXX");
  assert.equal(created.account_masked, `•••• ${iban.slice(-4)}`);
  for (const [bad, path] of [[{ beneficiary_name: 'Fictional "Co"' }, "/beneficiary_name"], [{ bank_name: "A=B" }, "/bank_name"], [{ bank_address: "A & B" }, "/bank_address"], [{ beneficiary_address: "-1 Road" }, "/beneficiary_address"], [{ swift_bic: "FAKE" }, "/swift_bic"], [{ account_kind: "iban", account_number: `GB00${bban}` }, "/account_number"], [{ account_number: "12" }, "/account_number"]] as const) {
    const res = await api.call("POST", "/tenant/v1/payout-accounts", { token, body: accountBody("00112233", { currency: "SGD", ...bad }) });
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.ok(res.body.error.details.issues.some((issue: any) => issue.path === path), res.text);
  }
  assert.equal((await api.call("POST", "/tenant/v1/payout-accounts", { token, body: accountBody("00112233", { currency: "KWD" }) })).status, 400);
  const stored = await owner("select beneficiary_name, beneficiary_address, bank_name, bank_address from payout_accounts where id = $1", [created.id]);
  for (const value of Object.values(stored.rows[0]) as string[]) assert.doesNotMatch(value, /[\u0000-\u001f]/);
});

// ---- 6. 敏感数据 ----

test("完整账号和密码不进任何表、日志、接口响应、错误信息（只有下载的文件例外）；库里是 packages/config 的主密钥加密的密文", async () => {
  const w = await world();
  const number = `QAFAKE${randomInt(100_000_000, 999_999_999)}`;
  const responses: string[] = [];
  const track = async (res: Promise<any>): Promise<any> => {
    const done = await res;
    responses.push(done.text);
    return done;
  };
  const token = await admin(w.a);
  const created = await track(api.call("POST", "/tenant/v1/payout-accounts", { token, body: accountBody(number) }));
  assert.equal(created.status, 201, created.text);
  await track(api.call("POST", "/tenant/v1/payout-accounts", { token, body: accountBody(number) }));
  const requested = await track(api.call("POST", `/platform/v1/payout-accounts/${created.body.account.id}/approval`, { token: await fin1(), body: {} }));
  await track(api.call("GET", `/platform/v1/approvals/${requested.body.approval.id}`, { token: await fin2() }));
  await track(approve(requested.body.approval.id));
  // 校验不过、太长、多余的键：错误信息不回显
  await track(api.call("POST", "/tenant/v1/payout-accounts", { token, body: accountBody(`${number}${"9".repeat(40)}`) }));
  await track(api.call("POST", "/tenant/v1/payout-accounts", { token, body: accountBody(`${number}!`) }));
  await track(api.call("POST", "/tenant/v1/payout-accounts", { token, body: accountBody(`${number}${"9".repeat(100)}`) }));
  await track(api.call("POST", "/tenant/v1/payout-accounts", { token, body: { ...accountBody(number), extra: number } }));
  await track(api.call("POST", "/tenant/v1/payout-accounts", { token, body: accountBody(number, { current_password: "wrong-password-value" }) }));

  await orderFor(w, "a", 10, 20_000, "JPY");
  const batch = await batchFor(w);
  const preview = await track(api.call("GET", `/platform/v1/payout-batches/${batch.id}/bank-file-preview`, { token: await fin1() }));
  assert.equal(preview.status, 200);
  const file = await generate(batch.id, "JPY");
  await track(api.call("GET", `/platform/v1/bank-files/${file.id}`, { token: await fin1() }));
  await track(api.call("GET", "/platform/v1/bank-files", { token: await fin1() }));
  await track(api.call("GET", `/platform/v1/payout-accounts?tenant_id=${w.a.tenantId}`, { token: await fin1() }));
  await track(api.call("GET", "/tenant/v1/payout-accounts", { token }));
  await track(api.call("GET", `/platform/v1/approvals?kind=bank_file.generate`, { token: await fin2() }));
  const csv = await download(file.id, "csv");
  assert.ok(csv.bytes.toString("utf8").includes(number), "文件里有完整账号");
  const xlsx = await download(file.id, "xlsx");
  assert.equal(xlsx.status, 200);
  for (const res of [csv, xlsx]) {
    assert.equal(res.headers["cache-control"], "no-store");
    assert.equal(res.headers["pragma"], "no-cache");
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.match(String(res.headers["content-disposition"]), /^attachment; filename="nozomi-bank-transfer-\d{4}-\d{2}-\d{2}-JPY-BF[0-9A-Z]+\.(csv|xlsx)"$/);
    assert.ok(!String(res.headers["content-disposition"]).includes(number));
    assert.ok(!String(res.headers["content-disposition"]).includes("Fictional"));
  }
  await ok(pay(file.id, [{ item_id: (await fileDetail(file.id)).items[0].id, bank_reference: "FT-SENSITIVE" }]));

  const leaks = (text: string): boolean => text.includes(number) || text.includes("wrong-password-value") || text.includes(TEST_PASSWORD);
  responses.forEach((text, index) => assert.ok(!leaks(text), `第 ${index} 个响应泄露：${text.slice(0, 200)}`));
  assert.ok(!leaks(api.logs()), "服务日志里没有账号和密码");
  const tables = await owner("select table_name from information_schema.tables where table_schema = current_schema() and table_type = 'BASE TABLE'");
  assert.ok(tables.rows.length > 20);
  for (const { table_name } of tables.rows) {
    const dump = JSON.stringify((await owner(`select * from "${table_name}"`)).rows);
    assert.ok(!dump.includes(number), `${table_name} 里有完整账号`);
  }

  // 密文：现在的主密钥解得开，别的主密钥解不开；同一个号码再提交密文不同
  const sealed = (await owner("select account_sealed from payout_accounts where id = $1", [created.body.account.id])).rows[0].account_sealed;
  const owned = `${w.a.tenantId}:${created.body.account.id}`;
  assert.equal(new SecretBox(FAKE_SECRETS.dataEncryptionKey).open("payout-account", owned, sealed), number);
  assert.throws(() => new SecretBox(ROTATED_KEY).open("payout-account", owned, sealed));
  assert.throws(() => new SecretBox(FAKE_SECRETS.dataEncryptionKey).open("payout-account", `${w.b.tenantId}:${created.body.account.id}`, sealed), "换到别的租户解不开");
  assert.throws(() => new SecretBox(FAKE_SECRETS.dataEncryptionKey).open("integration-secret", owned, sealed), "别的用途解不开");
  const twin = await submit(w.a, accountBody(number));
  const twinSealed = (await owner("select account_sealed from payout_accounts where id = $1", [twin.id])).rows[0].account_sealed;
  assert.notEqual(twinSealed, sealed);
});

test("没配 DATA_ENCRYPTION_KEY：提交账户、发起生成、下载都明确 503，一行不写，错误信息不回显", async () => {
  const w = await world();
  await activeAccount(w.a, fakeAccount());
  await orderFor(w, "a", 10, 20_000, "JPY");
  const batch = await batchFor(w);
  const file = await generate(batch.id, "JPY");
  await orderFor(w, "b", 11, 19_800, "JPY");
  await activeAccount(w.b, fakeAccount());
  const second = await batchFor(w);
  const app = buildApp({ config: loadConfig({ ...Object.fromEntries(Object.entries(testEnv(api.db.url)).filter(([key]) => key !== "DATA_ENCRYPTION_KEY")), ...UNREACHABLE_INTEGRATIONS }), pool: api.db.pool, migrationFiles: await loadMigrationFiles(), now: api.clock.now, webhookSender: localWebhookSender(), logger: false });
  try {
    const count = (await owner("select count(*)::int as n from payout_accounts where tenant_id = $1", [w.a.tenantId])).rows[0].n;
    const number = fakeAccount();
    const submitted = await app.inject({ method: "POST", url: "/tenant/v1/payout-accounts", headers: { authorization: `Bearer ${await admin(w.a)}`, "content-type": "application/json" }, payload: accountBody(number, { currency: "USD", swift_bic: "FAKEUS33" }) });
    assert.equal(submitted.statusCode, 503, submitted.body);
    assert.equal(submitted.json().error.code, "PAYOUT_ENCRYPTION_NOT_CONFIGURED");
    assert.ok(!submitted.body.includes(number));
    assert.equal((await owner("select count(*)::int as n from payout_accounts where tenant_id = $1", [w.a.tenantId])).rows[0].n, count);
    assert.equal((await download(file.id, "csv", await fin1(), app)).status, 503);
    assert.equal((await fileDetail(file.id)).download_count, 0);
    const refused = await app.inject({ method: "POST", url: `/platform/v1/payout-batches/${second.id}/bank-files`, headers: { authorization: `Bearer ${await fin1()}`, "content-type": "application/json" }, payload: { currency: "JPY" } });
    assert.equal(refused.statusCode, 503, refused.body);
  } finally {
    await app.close();
  }
});

// ---- 7. 权限和隔离 ----

test("平台权限矩阵：只读能看不能动；客服、招商、运营、主数据、渠道经理、风控、技术什么都不行；匿名 401；供应商令牌 401", async () => {
  const w = await world();
  const pending = await submit(w.a, accountBody(fakeAccount()));
  await activeAccount(w.b, fakeAccount());
  await orderFor(w, "b", 11, 19_800, "JPY");
  const batch = await batchFor(w);
  const file = await generate(batch.id, "JPY");
  await download(file.id, "csv");
  const item = (await fileDetail(file.id)).items[0];
  const fileReview = await ok(api.call("POST", `/platform/v1/payout-accounts/${pending.id}/approval`, { token: await fin1(), body: {} }), 202);
  const before = JSON.stringify(await fileDetail(file.id));
  const writes: [string, unknown][] = [
    [`/platform/v1/payout-accounts/${pending.id}/approval`, {}],
    [`/platform/v1/payout-accounts/${pending.id}/reject`, { reason: "x" }],
    [`/platform/v1/payout-batches/${batch.id}/bank-files`, { currency: "JPY" }],
    [`/platform/v1/bank-files/${file.id}/download`, { format: "csv" }],
    [`/platform/v1/bank-files/${file.id}/payments`, { payments: [{ item_id: item.id, bank_reference: "FT-NOPE" }] }],
    [`/platform/v1/bank-files/${file.id}/void`, { reason: "x" }],
  ];
  const reads = ["/platform/v1/payout-accounts", "/platform/v1/bank-files", `/platform/v1/bank-files/${file.id}`, `/platform/v1/payout-batches/${batch.id}/bank-file-preview`];

  const readonly = await platformToken(base.staff.readonly.email);
  for (const url of reads) assert.equal((await api.call("GET", url, { token: readonly })).status, 200, `只读能看 ${url}`);
  for (const [url, body] of writes) assert.equal((await api.call("POST", url, { token: readonly, body })).status, 403, `只读不能 ${url}`);
  const readonlyApprove = await api.call("POST", `/platform/v1/approvals/${fileReview.approval.id}/approve`, { token: readonly, body: {} });
  assert.equal(readonlyApprove.status, 403, "只读不能批准");

  for (const role of ["customer_service", "tenant_onboarding", "operations", "master_data", "channel_manager", "risk", "tech"] as const) {
    seq += 1;
    const staff = await addStaff(api, await root(), `qa-${role.replaceAll("_", "-")}${seq}@platform.test`, role);
    const token = await platformToken(staff.email);
    for (const url of reads) assert.equal((await api.call("GET", url, { token })).status, 403, `${role} 不能看 ${url}`);
    for (const [url, body] of writes) assert.equal((await api.call("POST", url, { token, body })).status, 403, `${role} 不能 ${url}`);
    assert.notEqual((await api.call("POST", `/platform/v1/approvals/${fileReview.approval.id}/approve`, { token, body: {} })).status, 200, `${role} 不能批准`);
    assert.equal((await api.call("GET", `/platform/v1/approvals/${fileReview.approval.id}`, { token })).status, 404, `${role} 看不到复核内容`);
  }
  for (const token of [undefined, await admin(w.a)]) {
    for (const url of reads) assert.equal((await api.call("GET", url, token === undefined ? {} : { token })).status, 401, url);
    for (const [url, body] of writes) assert.equal((await api.call("POST", url, { ...(token === undefined ? {} : { token }), body })).status, 401, url);
  }
  assert.equal(JSON.stringify(await fileDetail(file.id)), before, "都被拒了，文件没有变化");
  assert.equal((await owner("select status from payout_accounts where id = $1", [pending.id])).rows[0].status, "pending");
});

test("限定了数据范围的财务：写操作和批准都不行，包括回填、作废、驳回、发起", async () => {
  const w = await world();
  const pending = await submit(w.a, accountBody(fakeAccount()));
  await activeAccount(w.b, fakeAccount());
  await orderFor(w, "b", 11, 19_800, "JPY");
  const batch = await batchFor(w);
  const file = await generate(batch.id, "JPY");
  const item = (await fileDetail(file.id)).items[0];
  const review = await ok(api.call("POST", `/platform/v1/payout-accounts/${pending.id}/approval`, { token: await fin1(), body: {} }), 202);
  seq += 1;
  const role = await ok(api.call("POST", "/platform/v1/roles", { token: await root(), body: { name: `QA 东京财务 ${seq}`, grants: ["finance:view", "finance:edit", "finance:review"], data_scope: { city_ids: [base.ids.tokyo], channel_ids: null } } }), 201);
  const email = `qa-scoped${seq}@platform.test`;
  const invited = await ok(api.call("POST", "/platform/v1/staff", { token: await root(), body: { email, name: "东京财务", role: role.key } }), 201);
  await ok(api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
  const token = await platformToken(email);
  for (const [url, body] of [
    [`/platform/v1/payout-accounts/${pending.id}/approval`, {}],
    [`/platform/v1/payout-accounts/${pending.id}/reject`, { reason: "x" }],
    [`/platform/v1/payout-batches/${batch.id}/bank-files`, { currency: "JPY" }],
    [`/platform/v1/bank-files/${file.id}/payments`, { payments: [{ item_id: item.id, bank_reference: "FT-NOPE" }] }],
    [`/platform/v1/bank-files/${file.id}/void`, { reason: "x" }],
  ] as [string, unknown][]) {
    const res = await api.call("POST", url, { token, body });
    assert.deepEqual([res.status, res.body.error.code], [403, "DATA_SCOPE_DENIED"], url);
  }
  const scopedApprove = await api.call("POST", `/platform/v1/approvals/${review.approval.id}/approve`, { token, body: {} });
  assert.ok(scopedApprove.status === 403 || scopedApprove.status === 404, `批不了：${scopedApprove.status}`);
  const scopedRead = await api.call("GET", `/platform/v1/approvals/${review.approval.id}`, { token });
  assert.ok(scopedRead.status === 403 || scopedRead.status === 404, `看不到复核内容：${scopedRead.status}`);
  assert.equal((await owner("select status from payout_accounts where id = $1", [pending.id])).rows[0].status, "pending");
});

test("租户隔离：A 读不到、改不了 B 的账户；tenant_id 不接受来自请求；角色：只有管理员能提交、撤回", async () => {
  const w = await world();
  const accountB = await submit(w.b, accountBody(fakeAccount()));
  const tokenA = await admin(w.a);
  const listed = await ok(api.call("GET", "/tenant/v1/payout-accounts", { token: tokenA }));
  assert.deepEqual(listed.items, [], "A 读不到 B 的账户");
  assert.equal((await ok(api.call("GET", `/tenant/v1/payout-accounts?tenant_id=${w.b.tenantId}`, { token: tokenA }))).items.length, 0, "查询参数改不了租户");
  const withdraw = await api.call("POST", `/tenant/v1/payout-accounts/${accountB.id}/withdraw`, { token: tokenA, body: {} });
  assert.equal(withdraw.status, 404, "A 改不了 B 的账户");
  assert.equal((await owner("select status from payout_accounts where id = $1", [accountB.id])).rows[0].status, "pending");
  const smuggled = await api.call("POST", "/tenant/v1/payout-accounts", { token: tokenA, body: { ...accountBody(fakeAccount()), tenant_id: w.b.tenantId } });
  assert.equal(smuggled.status, 400, "请求体带 tenant_id 被拒绝");
  assert.equal((await owner("select count(*)::int as n from payout_accounts where tenant_id = $1", [w.b.tenantId])).rows[0].n, 1, "B 没有多出账户");
  const own = await submit(w.a, accountBody(fakeAccount()));
  assert.equal((await owner("select tenant_id from payout_accounts where id = $1", [own.id])).rows[0].tenant_id, w.a.tenantId);
  await assert.rejects(withTenantTx(api.db.pool, w.a.tenantId, (db) => db.query("update payout_accounts set status = 'withdrawn', withdrawn_at = now() where id = $1", [accountB.id])), deniedByDatabase);
  const crossRead = await withTenantTx(api.db.pool, w.a.tenantId, (db) => db.query("select id from payout_accounts where tenant_id = $1", [w.b.tenantId]));
  assert.equal(crossRead.rows.length, 0, "行级安全：显式写别家的 tenant_id 也读不到");

  seq += 1;
  for (const role of ["pricing", "dispatch", "finance", "readonly"] as const) {
    const user = await addTenantUser(api, await admin(w.a), `qa-${role}${seq}@qa-bf.test`, role);
    assert.equal((await api.call("POST", "/tenant/v1/payout-accounts", { token: user.token, body: accountBody(fakeAccount(), { currency: "USD", swift_bic: "FAKEUS33" }) })).status, 403, `${role} 不能提交`);
    assert.equal((await api.call("POST", `/tenant/v1/payout-accounts/${own.id}/withdraw`, { token: user.token, body: {} })).status, 403, `${role} 不能撤回`);
    const expected = role === "finance" || role === "readonly" ? 200 : 403;
    assert.equal((await api.call("GET", "/tenant/v1/payout-accounts", { token: user.token })).status, expected, `${role} 看`);
  }
  assert.equal((await api.call("POST", "/tenant/v1/payout-accounts", { body: accountBody(fakeAccount()) })).status, 401);
  assert.equal((await api.call("GET", "/tenant/v1/payout-accounts", { token: await platformToken(finance1.email) })).status, 401, "平台令牌不能冒充供应商");
});

test("提交账户重输密码有失败限速：同一地址错 5 次后，连对的密码也被挡（429），不写账户；和改密码共用计数；对了就清零", async () => {
  const w = await world();
  const token = await admin(w.a);
  const ip = "198.51.100.77";
  const body = (password: string): Record<string, unknown> => accountBody(fakeAccount(), { current_password: password });
  const good = await api.call("POST", "/tenant/v1/payout-accounts", { token, ip, body: { ...body("wrong-1") } });
  assert.deepEqual([good.status, good.body.error.code], [400, "CURRENT_PASSWORD_INCORRECT"]);
  // 中途输对一次：计数清零
  const passed = await api.call("POST", "/tenant/v1/payout-accounts", { token, ip, body: body(TEST_PASSWORD) });
  assert.equal(passed.status, 201, passed.text);
  await ok(api.call("POST", `/tenant/v1/payout-accounts/${passed.body.account.id}/withdraw`, { token, body: {} }));
  for (let i = 0; i < 5; i += 1) {
    const res = await api.call("POST", "/tenant/v1/payout-accounts", { token, ip, body: body(`wrong-${i}`) });
    assert.equal(res.status, 400, `第 ${i + 1} 次`);
  }
  const blocked = await api.call("POST", "/tenant/v1/payout-accounts", { token, ip, body: body(TEST_PASSWORD) });
  assert.deepEqual([blocked.status, blocked.body.error.code], [429, "TOO_MANY_LOGIN_ATTEMPTS"], blocked.text);
  assert.equal((await owner("select count(*)::int as n from payout_accounts where tenant_id = $1 and status = 'pending'", [w.a.tenantId])).rows[0].n, 0);
  const shared = await api.call("POST", "/tenant/v1/auth/change-password", { token, ip, body: { current_password: TEST_PASSWORD, new_password: "Another-Quiet-Harbor-2026" } });
  assert.equal(shared.status, 429, shared.text);
});

test("规则 4：供应商的账户接口、提交、撤回、账单、payout.paid 推送都没有对外价、加价比例，也没有密文、文件内部字段", async () => {
  const w = await world();
  const token = await admin(w.a);
  await ok(api.call("PUT", "/tenant/v1/webhooks", { token, body: { url: "https://hooks.example.com/qa-rule4", events: ["payout.paid"] } }), 201);
  const withdrawn = await submit(w.a, accountBody(fakeAccount()));
  const withdrawRes = await api.call("POST", `/tenant/v1/payout-accounts/${withdrawn.id}/withdraw`, { token, body: {} });
  await activeAccount(w.a, fakeAccount());
  await orderFor(w, "a", 10, 20_000, "JPY");
  const batch = await batchFor(w);
  const file = await generate(batch.id, "JPY");
  await download(file.id, "csv");
  const item = (await fileDetail(file.id)).items[0];
  await ok(pay(file.id, [{ item_id: item.id, bank_reference: "FT-RULE4" }]));
  const statement = await api.call("GET", `/tenant/v1/statements/${item.statement_id}`, { token });
  const list = await api.call("GET", "/tenant/v1/payout-accounts", { token });
  const delivery = await owner("select event_data from webhook_deliveries where tenant_id = $1 and event_type = 'payout.paid'", [w.a.tenantId]);
  const forbidden = /sell|markup|price_sell|margin|account_sealed|account_number|account_last4|csv_sha256|file_no|requested_by|approved_by/i;
  for (const [what, value] of [["账户列表", list.body], ["撤回", withdrawRes.body], ["账单", statement.body], ["推送", delivery.rows[0].event_data]] as const) {
    for (const key of allKeys(value)) assert.doesNotMatch(key, forbidden, `${what}：${key}`);
  }
  assert.doesNotMatch(list.text, /v1\.[A-Za-z0-9_-]+\./, "密文不出现");
  for (const path of ["/tenant/v1/bank-files", `/tenant/v1/bank-files/${file.id}`]) assert.equal((await api.call("GET", path, { token })).status, 404, `${path} 不存在`);
});
