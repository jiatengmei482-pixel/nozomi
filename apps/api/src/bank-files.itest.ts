/**
 * M5-02：供应商收款账户、银行转账文件、流水号回填（ADR 0051），经真实接口、真实 PostgreSQL。
 * 所有账号、IBAN、SWIFT 都是这里现算的虚构值；订单直接写进库，测试结束随 schema 一起删除（规则 1）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ibanCheckDigits } from "@nozomi/domain";
import { withPlatformTx, withTenantTx } from "./db/context.ts";
import { readXlsxSheet } from "./integrations/xlsx.ts";
import { unzipEntry } from "./integrations/zip.ts";
import { TEST_PASSWORD, type TenantFixture, type TestApi, addTenantUser, createTestApi } from "./testing/api.ts";
import { deniedByDatabase } from "./testing/db.ts";
import { seedOrder } from "./testing/dispatch.ts";
import { type Market, type Staff, addStaff, allKeys, buildMarket, ok } from "./testing/market.ts";
import { platformLogin, tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";

const DAY = 24 * 3_600_000;

let api: TestApi;
let m: Market;
let finance1: Staff;
let finance2: Staff;

before(async () => {
  api = await createTestApi();
  m = await buildMarket(api);
  finance1 = await addStaff(api, m.root, "bf1@platform.test", "finance");
  finance2 = await addStaff(api, m.root, "bf2@platform.test", "finance");
});
after(() => api.close());

const fin1 = (): Promise<string> => platformLogin(api, finance1.email);
const fin2 = (): Promise<string> => platformLogin(api, finance2.email);
const admin = (who: TenantFixture): Promise<string> => tenantLogin(api, who.adminEmail);

/** 虚构的账户：账号由调用方给（现算校验位的 IBAN，或明显虚构的数字）。 */
function accountInput(number: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    currency: "JPY",
    beneficiary_name: "Fictional Transport KK",
    beneficiary_address: "1-1 Example Dori, Testville",
    bank_name: "Fictional Bank",
    bank_address: "2 Sample Street, Testville",
    swift_bic: "fakejpjt",
    account_kind: "account",
    account_number: number,
    current_password: TEST_PASSWORD,
    ...over,
  };
}

async function submit(who: TenantFixture, body: Record<string, unknown>): Promise<any> {
  const res = await api.call("POST", "/tenant/v1/payout-accounts", { token: await admin(who), body });
  assert.equal(res.status, 201, res.text);
  assertMatchesOpenApi("POST", "/tenant/v1/payout-accounts", res);
  return res.body.account;
}

/** 财务 1 发起启用复核、财务 2 批准。 */
async function activate(accountId: string): Promise<void> {
  const requested = await api.call("POST", `/platform/v1/payout-accounts/${accountId}/approval`, { token: await fin1(), body: {} });
  assert.equal(requested.status, 202, requested.text);
  assertMatchesOpenApi("POST", "/platform/v1/payout-accounts/{id}/approval", requested);
  await ok(api.call("POST", `/platform/v1/approvals/${requested.body.approval.id}/approve`, { token: await fin2(), body: {} }));
}

/** 拨到下个月（东京），才能出上个月的账。 */
function moveToNextMonth(): void {
  api.clock.advance(new Date("2026-11-05T00:00:00Z").getTime() - api.clock.now().getTime());
}

const FAKE_ACCOUNT_A = "0012349876";
const FAKE_BBAN = "FAKE00000000000001";
const FAKE_IBAN = `GB${ibanCheckDigits("GB", FAKE_BBAN)}${FAKE_BBAN}`;

test("提交账户：校验不过逐项说明且不回显账号；密码错、非管理员不行；只返回末 4 位，库里只有密文", async () => {
  const token = await admin(m.a);
  const bad = await api.call("POST", "/tenant/v1/payout-accounts", { token, body: accountInput("GB00SECRETVALUE", { account_kind: "iban", beneficiary_name: "甲车队", swift_bic: "NOPE" }) });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body.error.details.issues.map((issue: any) => [issue.path, issue.reason]), [["/beneficiary_name", "CHARSET"], ["/swift_bic", "SWIFT_BIC_INVALID"], ["/account_number", "IBAN_INVALID"]]);
  assert.ok(!bad.text.includes("SECRETVALUE"), "错误信息不回显账号");

  const wrong = await api.call("POST", "/tenant/v1/payout-accounts", { token, body: accountInput(FAKE_ACCOUNT_A, { current_password: "not-the-password" }) });
  assert.deepEqual([wrong.status, wrong.body.error.code], [400, "CURRENT_PASSWORD_INCORRECT"]);

  const finance = await addTenantUser(api, m.a.adminToken, "fin-a@a.test", "finance");
  assert.equal((await api.call("POST", "/tenant/v1/payout-accounts", { token: finance.token, body: accountInput(FAKE_ACCOUNT_A) })).status, 403, "只有管理员能提交");
  assert.equal((await api.call("GET", "/tenant/v1/payout-accounts", { token: finance.token })).status, 200, "财务能看");

  const account = await submit(m.a, accountInput("0012-3498 76"));
  assert.equal(account.account_masked, "•••• 9876");
  assert.equal(account.swift_bic, "FAKEJPJT");
  assert.equal(account.status, "pending");
  const keys = allKeys(account);
  for (const key of ["account_number", "account_sealed", "account_last4"]) assert.ok(!keys.has(key), key);

  const stored = await api.db.owner.query("select account_sealed, account_last4 from payout_accounts where id = $1", [account.id]);
  assert.match(stored.rows[0].account_sealed, /^v1\./);
  assert.ok(!stored.rows[0].account_sealed.includes(FAKE_ACCOUNT_A));
  assert.equal(stored.rows[0].account_last4, "9876");

  const dup = await api.call("POST", "/tenant/v1/payout-accounts", { token, body: accountInput("11112222") });
  assert.deepEqual([dup.status, dup.body.error.code], [409, "PAYOUT_ACCOUNT_PENDING_EXISTS"]);

  const list = await api.call("GET", "/tenant/v1/payout-accounts", { token });
  assert.equal(list.status, 200);
  assertMatchesOpenApi("GET", "/tenant/v1/payout-accounts", list);
  assert.ok(!list.text.includes(FAKE_ACCOUNT_A) && !list.text.includes("v1."));
});

test("启用账户要双人复核：发起人不能批；批准后生效；改账户要重新复核，批准前旧账户有效，批准后旧的被替换", async () => {
  const [first] = (await ok(api.call("GET", "/tenant/v1/payout-accounts", { token: await admin(m.a) }))).items;
  const requested = await ok(api.call("POST", `/platform/v1/payout-accounts/${first.id}/approval`, { token: await fin1(), body: { note: "核对过证明文件" } }), 202);
  assert.ok(!JSON.stringify(requested).includes(FAKE_ACCOUNT_A), "复核内容里没有完整账号");
  assert.match(requested.approval.summary, /•••• 9876/);
  const self = await api.call("POST", `/platform/v1/approvals/${requested.approval.id}/approve`, { token: await fin1(), body: {} });
  assert.equal(self.body.error.code, "APPROVAL_SELF_REVIEW");
  const again = await api.call("POST", `/platform/v1/payout-accounts/${first.id}/approval`, { token: await fin1(), body: {} });
  assert.deepEqual([again.status, again.body.error.code], [409, "PAYOUT_ACCOUNT_REVIEW_PENDING"]);
  const rejectBlocked = await api.call("POST", `/platform/v1/payout-accounts/${first.id}/reject`, { token: await fin1(), body: { reason: "x" } });
  assert.deepEqual([rejectBlocked.status, rejectBlocked.body.error.code], [409, "PAYOUT_ACCOUNT_REVIEW_PENDING"]);
  await ok(api.call("POST", `/platform/v1/approvals/${requested.approval.id}/approve`, { token: await fin2(), body: {} }));

  const replacement = await submit(m.a, accountInput("99990000"));
  const during = await ok(api.call("GET", "/tenant/v1/payout-accounts", { token: await admin(m.a) }));
  assert.deepEqual(Object.fromEntries(during.items.map((item: any) => [item.id, item.status])), { [first.id]: "active", [replacement.id]: "pending" });
  await activate(replacement.id);
  const afterSwap = await ok(api.call("GET", "/platform/v1/payout-accounts?tenant_id=" + m.a.tenantId, { token: await fin1() }));
  assert.deepEqual(Object.fromEntries(afterSwap.items.map((item: any) => [item.id, item.status])), { [first.id]: "superseded", [replacement.id]: "active" });
  assert.equal(afterSwap.items.find((item: any) => item.id === replacement.id).recently_changed, true);

  // 再换回虚构账号 A，留给后面的文件测试
  const back = await submit(m.a, accountInput(FAKE_ACCOUNT_A));
  await activate(back.id);

  // 审计只有末 4 位
  const audit = await api.db.owner.query("select before, after from audit_logs where resource = 'payout_account'");
  const text = JSON.stringify(audit.rows);
  assert.ok(audit.rows.length >= 3);
  assert.ok(text.includes("•••• 9876") && !text.includes(FAKE_ACCOUNT_A) && !text.includes("99990000"));
});

test("驳回和撤回：驳回写原因、供应商看得到；撤回之后复核过期；撤回只限待审核", async () => {
  const rejected = await submit(m.a, accountInput("55556666", { currency: "USD" }));
  const res = await api.call("POST", `/platform/v1/payout-accounts/${rejected.id}/reject`, { token: await fin1(), body: { reason: "和证明文件的户名不一致" } });
  assert.equal(res.status, 200, res.text);
  assertMatchesOpenApi("POST", "/platform/v1/payout-accounts/{id}/reject", res);
  const list = await ok(api.call("GET", "/tenant/v1/payout-accounts", { token: await admin(m.a) }));
  assert.equal(list.items.find((item: any) => item.id === rejected.id).reject_reason, "和证明文件的户名不一致");

  const second = await submit(m.a, accountInput("55557777", { currency: "USD" }));
  const review = await ok(api.call("POST", `/platform/v1/payout-accounts/${second.id}/approval`, { token: await fin1(), body: {} }), 202);
  const withdrawn = await api.call("POST", `/tenant/v1/payout-accounts/${second.id}/withdraw`, { token: await admin(m.a), body: {} });
  assert.equal(withdrawn.status, 200, withdrawn.text);
  assertMatchesOpenApi("POST", "/tenant/v1/payout-accounts/{id}/withdraw", withdrawn);
  assert.equal(withdrawn.body.account.status, "withdrawn");
  const stale = await api.call("POST", `/platform/v1/approvals/${review.approval.id}/approve`, { token: await fin2(), body: {} });
  assert.deepEqual([stale.status, stale.body.error.code], [409, "APPROVAL_STALE"]);
  await ok(api.call("POST", `/platform/v1/approvals/${review.approval.id}/reject`, { token: await fin2(), body: { note: "已撤回" } }));
  const twice = await api.call("POST", `/tenant/v1/payout-accounts/${second.id}/withdraw`, { token: await admin(m.a), body: {} });
  assert.deepEqual([twice.status, twice.body.error.code], [409, "PAYOUT_ACCOUNT_STATE_INVALID"]);
});

test("数据库层：账户内容不可变；租户角色写不了账户、读不到文件；行级安全挡住别的供应商", async () => {
  const account = (await api.db.owner.query("select tenant_id, id from payout_accounts where tenant_id = $1 and status = 'active' limit 1", [m.a.tenantId])).rows[0];
  await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query("update payout_accounts set account_sealed = 'v1.x' where tenant_id = $1 and id = $2", [account.tenant_id, account.id])), deniedByDatabase);
  await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query("update payout_accounts set swift_bic = 'XXXXJPJT' where tenant_id = $1 and id = $2", [account.tenant_id, account.id])), deniedByDatabase);
  await assert.rejects(withTenantTx(api.db.pool, m.a.tenantId, (db) => db.query("update payout_accounts set status = 'active' where id = $1", [account.id])), deniedByDatabase);
  await assert.rejects(withTenantTx(api.db.pool, m.a.tenantId, (db) => db.query("select * from bank_files")), deniedByDatabase);
  await assert.rejects(withTenantTx(api.db.pool, m.a.tenantId, (db) => db.query("select * from bank_file_items")), deniedByDatabase);
  const seen = await withTenantTx(api.db.pool, m.b.tenantId, (db) => db.query("select id from payout_accounts where id = $1", [account.id]));
  assert.equal(seen.rows.length, 0, "乙看不到甲的账户");
});

// ---- 账单到批次 ----

async function statementFor(side: "a" | "b", serviceAt: string, settlement: number, currency: string): Promise<void> {
  const at = new Date(serviceAt);
  const seeded = await seedOrder(api, m, side, { serviceAt: at, confirmedAt: new Date(at.getTime() - 3 * DAY) });
  await api.db.owner.query("update orders set settlement_minor = $3, settlement_currency = $4, status = 'completed' where tenant_id = $1 and id = $2", [m[side].tenantId, seeded.id, settlement, currency]);
}

async function approved(id: string): Promise<void> {
  const requested = await ok(api.call("POST", `/platform/v1/statements/${id}/payout-approval`, { token: await fin1(), body: {} }), 202);
  await ok(api.call("POST", `/platform/v1/approvals/${requested.approval.id}/approve`, { token: await fin2(), body: {} }));
}

/** 生成一期账单、供应商确认、付款复核通过，返回批次。 */
async function batchOf(period: string): Promise<{ statements: any[]; batchId: string }> {
  const generated = await ok(api.call("POST", "/platform/v1/statements/generate", { token: await fin1(), body: { period } }));
  for (const statement of generated.created) {
    const owner = statement.tenant.id === m.a.tenantId ? m.a : m.b;
    await ok(api.call("POST", `/tenant/v1/statements/${statement.id}/confirm`, { token: await admin(owner), body: {} }));
    await approved(statement.id);
  }
  const detail = await ok(api.call("GET", `/platform/v1/statements/${generated.created[0].id}`, { token: await fin1() }));
  return { statements: generated.created, batchId: detail.statement.payout_batch_id };
}

let batchId: string;
let septStatements: any[];

const requestFile = (id: string, body: Record<string, unknown>, token?: string): Promise<any> => fin1().then((own) => api.call("POST", `/platform/v1/payout-batches/${id}/bank-files`, { token: token ?? own, body }));

async function generateFile(id: string, body: Record<string, unknown>): Promise<any> {
  const known = new Set((await ok(api.call("GET", `/platform/v1/bank-files?payout_batch_id=${id}`, { token: await fin1() }))).items.map((file: any) => file.id));
  const requested = await requestFile(id, body);
  assert.equal(requested.status, 202, requested.text);
  assertMatchesOpenApi("POST", "/platform/v1/payout-batches/{id}/bank-files", requested);
  await ok(api.call("POST", `/platform/v1/approvals/${requested.body.approval.id}/approve`, { token: await fin2(), body: {} }));
  const list = await ok(api.call("GET", `/platform/v1/bank-files?payout_batch_id=${id}`, { token: await fin1() }));
  return list.items.find((file: any) => !known.has(file.id));
}

async function fileDetail(id: string): Promise<any> {
  const res = await api.call("GET", `/platform/v1/bank-files/${id}`, { token: await fin1() });
  assert.equal(res.status, 200, res.text);
  assertMatchesOpenApi("GET", "/platform/v1/bank-files/{id}", res);
  return res.body.file;
}

async function download(id: string, format: "csv" | "xlsx", token?: string): Promise<{ status: number; headers: Record<string, unknown>; bytes: Buffer; json: any }> {
  const res = await api.app.inject({ method: "POST", url: `/platform/v1/bank-files/${id}/download`, headers: { authorization: `Bearer ${token ?? (await fin1())}`, "content-type": "application/json" }, payload: { format } });
  let json: any = null;
  if (String(res.headers["content-type"]).includes("json")) json = res.json();
  return { status: res.statusCode, headers: res.headers, bytes: res.rawPayload, json };
}

test("预览：列出能进的、有问题的（不静默跳过）；批次没锁定不能生成；有问题的不确认就 409", async () => {
  await statementFor("a", "2026-09-10T10:00:00+09:00", 123_450, "SGD");
  await statementFor("a", "2026-09-11T10:00:00+09:00", 20_000, "JPY");
  await statementFor("b", "2026-09-12T10:00:00+09:00", 19_800, "JPY");
  await statementFor("b", "2026-09-13T10:00:00+09:00", 10_000, "SGD");
  const sgdA = await submit(m.a, accountInput(FAKE_IBAN, { currency: "SGD", account_kind: "iban", swift_bic: "FAKESGSGXXX", beneficiary_name: "Fictional Transport Pte Ltd" }));
  await activate(sgdA.id);
  // 乙的 SGD 账户还在审核，乙没有 JPY 账户
  await submit(m.b, accountInput("44445555", { currency: "SGD", swift_bic: "FAKESGSG" }));

  const { statements, batchId: id } = await batchOf("2026-09");
  batchId = id;
  septStatements = statements;
  assert.equal(statements.length, 4);

  const notClosed = await requestFile(id, { currency: "JPY" });
  assert.deepEqual([notClosed.status, notClosed.body.error.code], [409, "BATCH_NOT_CLOSED"]);
  await ok(api.call("POST", `/platform/v1/payout-batches/${id}/close`, { token: await fin1(), body: {} }));

  const preview = await api.call("GET", `/platform/v1/payout-batches/${id}/bank-file-preview`, { token: await fin1() });
  assert.equal(preview.status, 200, preview.text);
  assertMatchesOpenApi("GET", "/platform/v1/payout-batches/{id}/bank-file-preview", preview);
  assert.ok(!preview.text.includes(FAKE_ACCOUNT_A) && !preview.text.includes(FAKE_IBAN));
  const groups = Object.fromEntries(preview.body.preview.groups.map((group: any) => [group.currency, group]));
  assert.deepEqual(groups.JPY.eligible.map((entry: any) => [entry.tenant.id, entry.amount.amount, entry.account_masked]), [[m.a.tenantId, "20000", "•••• 9876"]]);
  assert.deepEqual(groups.JPY.excluded.map((entry: any) => [entry.tenant.id, entry.code]), [[m.b.tenantId, "ACCOUNT_MISSING"]]);
  assert.deepEqual(groups.SGD.eligible.map((entry: any) => entry.amount.amount), ["1234.50"]);
  assert.deepEqual(groups.SGD.excluded.map((entry: any) => [entry.tenant.id, entry.code]), [[m.b.tenantId, "ACCOUNT_PENDING"]]);
  assert.equal(groups.JPY.total.amount, "20000");

  const refused = await requestFile(id, { currency: "JPY" });
  assert.deepEqual([refused.status, refused.body.error.code], [409, "BANK_FILE_EXCLUSIONS"]);
  assert.deepEqual(refused.body.error.details.excluded.map((entry: any) => entry.code), ["ACCOUNT_MISSING"]);
});

test("生成走双人复核：驳回不留文件；批准时生成；排除名单写进文件记录；复核内容没有完整账号", async () => {
  const first = await requestFile(batchId, { currency: "JPY", allow_exclusions: true, charge_bearer: "OUR", note: "乙的账户下批再付" });
  assert.equal(first.status, 202, first.text);
  assert.ok(!first.text.includes(FAKE_ACCOUNT_A));
  const dup = await requestFile(batchId, { currency: "JPY", allow_exclusions: true });
  assert.deepEqual([dup.status, dup.body.error.code], [409, "BANK_FILE_REVIEW_PENDING"]);
  const self = await api.call("POST", `/platform/v1/approvals/${first.body.approval.id}/approve`, { token: await fin1(), body: {} });
  assert.notEqual(self.status, 200, "发起人不能批");
  await ok(api.call("POST", `/platform/v1/approvals/${first.body.approval.id}/reject`, { token: await fin2(), body: { note: "再确认一下" } }));
  assert.equal((await ok(api.call("GET", `/platform/v1/bank-files?payout_batch_id=${batchId}`, { token: await fin1() }))).items.length, 0, "驳回不留文件");

  const file = await generateFile(batchId, { currency: "JPY", allow_exclusions: true, charge_bearer: "OUR" });
  assert.equal(file.status, "generated");
  assert.equal(file.charge_bearer, "OUR");
  assert.deepEqual([file.currency, file.total.amount, file.item_count], ["JPY", "20000", 1]);
  assert.match(file.file_no, /^BF20261020[0-9A-HJ-NP-Z]{8}$/);
  assert.deepEqual(file.excluded.map((entry: any) => entry.code), ["ACCOUNT_MISSING"]);
  assert.equal(file.requested_by, finance1.id);
  assert.equal(file.approved_by, finance2.id);
  const list = await api.call("GET", "/platform/v1/bank-files", { token: await fin1() });
  assertMatchesOpenApi("GET", "/platform/v1/bank-files", list);

  // 已在文件里的账单不会再进：同币种只剩有问题的
  const again = await requestFile(batchId, { currency: "JPY", allow_exclusions: true });
  assert.deepEqual([again.status, again.body.error.code], [409, "BANK_FILE_EMPTY"]);
  const preview = await ok(api.call("GET", `/platform/v1/payout-batches/${batchId}/bank-file-preview`, { token: await fin1() }));
  const jpy = preview.preview.groups.find((group: any) => group.currency === "JPY");
  assert.deepEqual(jpy.in_files.map((entry: any) => entry.file_no), [file.file_no]);

  // 数据库保证：一张账单不能在两个未作废的文件里
  const item = (await fileDetail(file.id)).items[0];
  const row = (await api.db.owner.query("select * from bank_file_items where id = $1", [item.id])).rows[0];
  const other = (await api.db.owner.query("select * from bank_files where id = $1", [file.id])).rows[0];
  await api.db.owner.query("insert into bank_files (file_no, payout_batch_id, currency, template, charge_bearer, status, item_count, total_minor, excluded, approval_id, requested_by, approved_by, created_at, updated_at) values ('BF20261020ZZZZZZZZ', $1, 'JPY', $2, 'SHA', 'generated', 1, 1, '[]', $3, $4, $5, now(), now())", [other.payout_batch_id, other.template, other.approval_id, other.requested_by, other.approved_by]);
  const twin = (await api.db.owner.query("select id from bank_files where file_no = 'BF20261020ZZZZZZZZ'")).rows[0];
  await assert.rejects(
    api.db.owner.query(
      "insert into bank_file_items (tenant_id, file_id, seq, statement_id, statement_no, account_id, amount_minor, currency, beneficiary_name, beneficiary_address, bank_name, bank_address, swift_bic, account_sealed, account_last4, reference) values ($1, $2, 1, $3, $4, $5, 1, 'JPY', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x')",
      [row.tenant_id, twin.id, row.statement_id, row.statement_no, row.account_id],
    ),
    (err: any) => err.code === "23505" && err.constraint === "bank_file_items_active_key",
  );
  await api.db.owner.query("delete from bank_files where id = $1", [twin.id]);
});

let jpyFile: any;

test("下载：只读角色不能；CSV 有 BOM、CRLF、完整账号、字符串金额、合计；防缓存；文件名不含敏感信息；审计有哈希没账号", async () => {
  [jpyFile] = (await ok(api.call("GET", `/platform/v1/bank-files?payout_batch_id=${batchId}`, { token: await fin1() }))).items;
  const readonly = await download(jpyFile.id, "csv", await platformLogin(api, m.staff.readonly.email));
  assert.equal(readonly.status, 403);

  const paidTooEarly = await api.call("POST", `/platform/v1/bank-files/${jpyFile.id}/payments`, { token: await fin1(), body: { payments: [{ item_id: (await fileDetail(jpyFile.id)).items[0].id, bank_reference: "FT1" }] } });
  assert.deepEqual([paidTooEarly.status, paidTooEarly.body.error.code], [409, "BANK_FILE_STATE_INVALID"]);

  const csv = await download(jpyFile.id, "csv");
  assert.equal(csv.status, 200, csv.bytes.toString());
  assert.equal(csv.headers["cache-control"], "no-store");
  assert.equal(csv.headers["pragma"], "no-cache");
  assert.equal(csv.headers["x-content-type-options"], "nosniff");
  assert.match(String(csv.headers["content-type"]), /^text\/csv/);
  assert.equal(csv.headers["content-disposition"], `attachment; filename="nozomi-bank-transfer-2026-10-20-JPY-${jpyFile.file_no}.csv"`);
  assert.deepEqual([...csv.bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const lines = csv.bytes.toString("utf8").slice(1).split("\r\n");
  assert.equal(lines[0], "Seq,Beneficiary Name,Beneficiary Address,Bank Name,Bank Address,SWIFT/BIC,Account No/IBAN,Currency,Amount,Value Date,Payment Reference,Charges");
  const statement = septStatements.find((entry) => entry.tenant.id === m.a.tenantId && entry.currency === "JPY");
  assert.equal(lines[1], `1,Fictional Transport KK,"1-1 Example Dori, Testville",Fictional Bank,"2 Sample Street, Testville",FAKEJPJT,${FAKE_ACCOUNT_A},JPY,20000,2026-10-20,NOZOMI ${statement.statement_no} SETTLEMENT 2026-09,OUR`);
  assert.equal(lines[2], "TOTAL,,,,,,,JPY,20000,,1 PAYMENTS,");

  const detail = await fileDetail(jpyFile.id);
  assert.equal(detail.status, "downloaded");
  assert.equal(detail.download_count, 1);
  const sha = createHash("sha256").update(csv.bytes).digest("hex");
  assert.equal(detail.csv_sha256, sha);
  assert.equal(detail.xlsx_sha256, null);
  assert.ok(!JSON.stringify(detail).includes(FAKE_ACCOUNT_A), "详情里没有完整账号");

  // 再下载：内容不变；Excel 单元格都是文字，账号开头的 0 还在
  const again = await download(jpyFile.id, "csv");
  assert.ok(again.bytes.equals(csv.bytes));
  const xlsx = await download(jpyFile.id, "xlsx");
  assert.equal(xlsx.status, 200);
  const sheet = readXlsxSheet(xlsx.bytes);
  assert.equal(sheet.name, "Payments");
  assert.deepEqual(sheet.rows[1]?.[6], { type: "text", text: FAKE_ACCOUNT_A });
  assert.deepEqual(sheet.rows[1]?.[8], { type: "text", text: "20000" });
  assert.deepEqual(sheet.rows[2]?.[0], { type: "text", text: "TOTAL" });
  const summary = readXlsxSheet(xlsx.bytes, ["Summary"]);
  assert.equal(summary.name, "Summary");
  assert.deepEqual(summary.rows[4]?.map((cell: any) => cell.text), ["Total Amount", "20000"]);

  const audit = await api.db.owner.query("select actor_id, before, after from audit_logs where resource = 'bank_file' and action = 'download' and resource_id = $1 order by id", [jpyFile.id]);
  assert.equal(audit.rows.length, 3);
  assert.equal(audit.rows[0].actor_id, finance1.id);
  assert.deepEqual([audit.rows[0].after.format, audit.rows[0].after.sha256, audit.rows[0].after.item_count, audit.rows[0].after.download_count], ["csv", sha, 1, 1]);
  assert.equal(audit.rows[2].after.format, "xlsx");
  for (const table of ["audit_logs", "approvals", "bank_files", "statement_events"]) {
    const dump = JSON.stringify((await api.db.owner.query(`select * from ${table}`)).rows);
    assert.ok(!dump.includes(FAKE_ACCOUNT_A) && !dump.includes(FAKE_IBAN), `${table} 里不能有完整账号`);
  }
});

test("下载的防护：条目被动过拒绝（哈希不一致）；密文解不开不给文件", async () => {
  const item = (await fileDetail(jpyFile.id)).items[0];
  await api.db.owner.query("alter table bank_file_items disable trigger bank_file_items_platform_columns");
  await api.db.owner.query("update bank_file_items set reference = 'TAMPERED' where id = $1", [item.id]);
  const tampered = await download(jpyFile.id, "csv");
  assert.deepEqual([tampered.status, tampered.json.error.code], [409, "BANK_FILE_INTEGRITY"]);
  const statement = septStatements.find((entry) => entry.tenant.id === m.a.tenantId && entry.currency === "JPY");
  await api.db.owner.query("update bank_file_items set reference = $2 where id = $1", [item.id, `NOZOMI ${statement.statement_no} SETTLEMENT 2026-09`]);

  const sealed = (await api.db.owner.query("select account_sealed from bank_file_items where id = $1", [item.id])).rows[0].account_sealed as string;
  await api.db.owner.query("update bank_file_items set account_sealed = 'v1.AAAA.BBBB.CCCC' where id = $1", [item.id]);
  const unreadable = await download(jpyFile.id, "csv");
  assert.deepEqual([unreadable.status, unreadable.json.error.code], [409, "BANK_FILE_ACCOUNT_UNREADABLE"]);
  await api.db.owner.query("update bank_file_items set account_sealed = $2 where id = $1", [item.id, sealed]);
  await api.db.owner.query("alter table bank_file_items enable trigger bank_file_items_platform_columns");
  assert.equal((await download(jpyFile.id, "csv")).status, 200);
});

test("批准时账户变过：复核过期；账单不会带着没审过的账号进文件", async () => {
  const requested = await requestFile(batchId, { currency: "SGD", allow_exclusions: true, charge_bearer: "BEN" });
  assert.equal(requested.status, 202, requested.text);
  const replacement = await submit(m.a, accountInput("88887777", { currency: "SGD", swift_bic: "FAKESGSG" }));
  await activate(replacement.id);
  const stale = await api.call("POST", `/platform/v1/approvals/${requested.body.approval.id}/approve`, { token: await fin2(), body: {} });
  assert.deepEqual([stale.status, stale.body.error.code], [409, "APPROVAL_STALE"]);
  await ok(api.call("POST", `/platform/v1/approvals/${requested.body.approval.id}/reject`, { token: await fin2(), body: { note: "账户变了" } }));
});

test("文件快照：批准后再改账户，文件内容不变，详情标出账户已变更", async () => {
  const file = await generateFile(batchId, { currency: "SGD", allow_exclusions: true, charge_bearer: "BEN" });
  const replacement = await submit(m.a, accountInput("77776666", { currency: "SGD", swift_bic: "FAKESGSG" }));
  await activate(replacement.id);
  const detail = await fileDetail(file.id);
  assert.equal(detail.items[0].account_masked, "•••• 7777");
  assert.equal(detail.items[0].account_changed, true);
  const csv = await download(file.id, "csv");
  const line = csv.bytes.toString("utf8").split("\r\n")[1] as string;
  assert.ok(line.includes(",88887777,SGD,1234.50,"), line);
  assert.ok(line.endsWith(",BEN"));
});

test("回填流水号：格式校验、别的文件的条目 404、分次回填；账单已付款、供应商看得到流水号；重复同号幂等、不同号 409；批次付完才收尾", async () => {
  const token = await fin1();
  const files = (await ok(api.call("GET", `/platform/v1/bank-files?payout_batch_id=${batchId}`, { token }))).items;
  const sgd = await fileDetail(files.find((file: any) => file.currency === "SGD").id);
  const jpy = await fileDetail(jpyFile.id);
  const webhook = await api.call("PUT", "/tenant/v1/webhooks", { token: await admin(m.a), body: { url: "https://hooks.example.com/nozomi", events: ["payout.paid"] } });
  assert.equal(webhook.status, 201, webhook.text);

  const bad = await api.call("POST", `/platform/v1/bank-files/${jpy.id}/payments`, { token, body: { payments: [{ item_id: jpy.items[0].id, bank_reference: "=1+1" }] } });
  assert.equal(bad.status, 400);
  const foreign = await api.call("POST", `/platform/v1/bank-files/${jpy.id}/payments`, { token, body: { payments: [{ item_id: sgd.items[0].id, bank_reference: "FT1" }] } });
  assert.equal(foreign.status, 404);

  const paid = await api.call("POST", `/platform/v1/bank-files/${jpy.id}/payments`, { token, body: { payments: [{ item_id: jpy.items[0].id, bank_reference: "FT26293JPY" }] } });
  assert.equal(paid.status, 200, paid.text);
  assertMatchesOpenApi("POST", "/platform/v1/bank-files/{id}/payments", paid);
  assert.equal(paid.body.file.status, "paid");
  assert.equal(paid.body.file.items[0].bank_reference, "FT26293JPY");

  const statementId = jpy.items[0].statement_id;
  const seenByTenant = await ok(api.call("GET", `/tenant/v1/statements/${statementId}`, { token: await admin(m.a) }));
  assert.deepEqual([seenByTenant.statement.status, seenByTenant.statement.bank_reference], ["paid", "FT26293JPY"]);
  assert.ok(seenByTenant.statement.events.some((event: any) => event.action === "pay"));
  const deliveries = await api.db.owner.query("select event_type, event_data from webhook_deliveries where tenant_id = $1 and event_type = 'payout.paid'", [m.a.tenantId]);
  assert.equal(deliveries.rows.length, 1);
  assert.equal(deliveries.rows[0].event_data.statement_id, statementId);

  const afterPaid = await api.call("POST", `/platform/v1/bank-files/${jpy.id}/payments`, { token, body: { payments: [{ item_id: jpy.items[0].id, bank_reference: "FT26293JPY" }] } });
  assert.deepEqual([afterPaid.status, afterPaid.body.error.code], [409, "BANK_FILE_STATE_INVALID"], "文件已付款不能再回填");
  assert.equal((await download(jpy.id, "csv")).status, 409, "已付款的不能再下载");

  const batch = await ok(api.call("GET", `/platform/v1/payout-batches/${batchId}`, { token }));
  assert.equal(batch.batch.status, "closed", "批次里还有没付的账单");
});

test("作废：未付款的账单释放，可以进新文件；作废的文件不能再下载；部分回填的文件作废只作废没付的，已付的不退回；批次全部付完收尾", async () => {
  const token = await fin1();
  const files = (await ok(api.call("GET", `/platform/v1/bank-files?payout_batch_id=${batchId}`, { token }))).items;
  const sgd = files.find((file: any) => file.currency === "SGD");
  const voided = await api.call("POST", `/platform/v1/bank-files/${sgd.id}/void`, { token, body: { reason: "账户已变更，重新生成" } });
  assert.equal(voided.status, 200, voided.text);
  assertMatchesOpenApi("POST", "/platform/v1/bank-files/{id}/void", voided);
  assert.equal(voided.body.file.status, "void");
  assert.equal(voided.body.file.items[0].voided, true);
  assert.equal((await download(sgd.id, "csv")).status, 409);
  const twice = await api.call("POST", `/platform/v1/bank-files/${sgd.id}/void`, { token, body: { reason: "再来" } });
  assert.deepEqual([twice.status, twice.body.error.code], [409, "BANK_FILE_STATE_INVALID"]);

  // 乙的账户都好了：SGD 新文件两笔（甲 + 乙）、JPY 新文件一笔（乙）
  const [bPending] = (await ok(api.call("GET", "/tenant/v1/payout-accounts", { token: await admin(m.b) }))).items;
  await activate(bPending.id);
  const bJpy = await submit(m.b, accountInput("33334444", { currency: "JPY" }));
  await activate(bJpy.id);
  const sgd2 = await generateFile(batchId, { currency: "SGD" });
  assert.deepEqual([sgd2.item_count, sgd2.total.amount, sgd2.charge_bearer, sgd2.excluded], [2, "1334.50", "SHA", []]);
  const jpy2 = await generateFile(batchId, { currency: "JPY" });
  assert.equal(jpy2.item_count, 1);
  await download(sgd2.id, "csv");
  await download(jpy2.id, "csv");
  const sgdDetail = await fileDetail(sgd2.id);
  const line = (await download(sgd2.id, "csv")).bytes.toString("utf8").split("\r\n")[1] as string;
  assert.ok(line.includes(",SGD,"), "新文件用新账户");

  // 部分回填：第一笔付了，第二笔退汇
  const partial = await ok(api.call("POST", `/platform/v1/bank-files/${sgd2.id}/payments`, { token, body: { payments: [{ item_id: sgdDetail.items[0].id, bank_reference: "FT-SGD-1" }] } }));
  assert.equal(partial.file.status, "downloaded");
  const sameRef = await api.call("POST", `/platform/v1/bank-files/${sgd2.id}/payments`, { token, body: { payments: [{ item_id: sgdDetail.items[0].id, bank_reference: "FT-SGD-1" }] } });
  assert.equal(sameRef.status, 200, "同号幂等");
  const otherRef = await api.call("POST", `/platform/v1/bank-files/${sgd2.id}/payments`, { token, body: { payments: [{ item_id: sgdDetail.items[0].id, bank_reference: "FT-SGD-2" }] } });
  assert.deepEqual([otherRef.status, otherRef.body.error.code], [409, "BANK_FILE_ITEM_ALREADY_PAID"]);
  const closed = await ok(api.call("POST", `/platform/v1/bank-files/${sgd2.id}/void`, { token, body: { reason: "第二笔被银行退回" } }));
  assert.equal(closed.file.status, "paid");
  assert.deepEqual(closed.file.items.map((item: any) => [item.bank_reference, item.voided]), [["FT-SGD-1", false], [null, true]]);
  const preview = await ok(api.call("GET", `/platform/v1/payout-batches/${batchId}/bank-file-preview`, { token }));
  assert.equal(preview.preview.groups.find((group: any) => group.currency === "SGD").eligible.length, 1, "退汇的账单释放了");

  const jpyDetail = await fileDetail(jpy2.id);
  await ok(api.call("POST", `/platform/v1/bank-files/${jpy2.id}/payments`, { token, body: { payments: [{ item_id: jpyDetail.items[0].id, bank_reference: "FT-JPY-2" }] } }));
  assert.equal((await ok(api.call("GET", `/platform/v1/payout-batches/${batchId}`, { token }))).batch.status, "closed", "还有一笔 SGD 没付");
  const sgd3 = await generateFile(batchId, { currency: "SGD" });
  await download(sgd3.id, "xlsx");
  const sgd3Detail = await fileDetail(sgd3.id);
  await ok(api.call("POST", `/platform/v1/bank-files/${sgd3.id}/payments`, { token, body: { payments: [{ item_id: sgd3Detail.items[0].id, bank_reference: "FT-SGD-3" }] } }));
  const finished = await ok(api.call("GET", `/platform/v1/payout-batches/${batchId}`, { token }));
  assert.equal(finished.batch.status, "paid");
  assert.ok(finished.batch.statements.every((statement: any) => statement.status === "paid" && statement.bank_reference !== null));
  const audit = await api.db.owner.query("select after from audit_logs where resource = 'payout_batch' and action = 'pay' and resource_id = $1", [batchId]);
  assert.equal(audit.rows.length, 1);
});

test("公式注入：名称以 + 开头（SWIFT 字符集允许）时，CSV 和 Excel 都加单引号；两人复核数据库也保证", async () => {
  moveToNextMonth();
  await statementFor("a", "2026-10-10T10:00:00+09:00", 5_000, "THB");
  const thb = await submit(m.a, accountInput("22223333", { currency: "THB", beneficiary_name: "+1 Fictional Co", swift_bic: "FAKETHBK" }));
  await activate(thb.id);
  const { batchId: id } = await batchOf("2026-10");
  await ok(api.call("POST", `/platform/v1/payout-batches/${id}/close`, { token: await fin1(), body: {} }));
  const file = await generateFile(id, { currency: "THB" });
  const csv = await download(file.id, "csv");
  const line = csv.bytes.toString("utf8").split("\r\n")[1] as string;
  assert.ok(line.startsWith("1,'+1 Fictional Co,"), line);
  assert.ok(line.includes(",THB,50.00,"), line);
  const sheetXml = unzipEntry((await download(file.id, "xlsx")).bytes, "xl/worksheets/sheet1.xml").toString("utf8");
  assert.ok(sheetXml.includes(">'+1 Fictional Co<"), "Excel 里存的文字带单引号");
  assert.ok(!sheetXml.includes("<f>"), "没有公式");
  await assert.rejects(api.db.owner.query("update bank_files set approved_by = requested_by where id = $1", [file.id]), (err: any) => err.constraint === "bank_files_two_person");
});

test("并发：同一批次同一币种同时发起两次生成，只有一条进复核；同时回填同一笔只记一次", async () => {
  await statementFor("a", "2026-10-11T10:00:00+09:00", 7_000, "KRW");
  const krw = await submit(m.a, accountInput("66667777", { currency: "KRW", swift_bic: "FAKEKRSE" }));
  await activate(krw.id);
  // 10 月这一期已经出过（THB 那张），KRW 是新币种，再出一次只出它；批次已锁定，顺延到下个月同一天
  const { batchId: id } = await batchOf("2026-10");
  await ok(api.call("POST", `/platform/v1/payout-batches/${id}/close`, { token: await fin1(), body: {} }));
  const results = await Promise.all([requestFile(id, { currency: "KRW" }), requestFile(id, { currency: "KRW" })]);
  assert.deepEqual(results.map((res: any) => res.status).sort(), [202, 409], results.map((res: any) => res.text).join(" | "));
  const winner = results.find((res: any) => res.status === 202);
  await ok(api.call("POST", `/platform/v1/approvals/${winner.body.approval.id}/approve`, { token: await fin2(), body: {} }));
  const [file] = (await ok(api.call("GET", `/platform/v1/bank-files?payout_batch_id=${id}`, { token: await fin1() }))).items;
  await download(file.id, "csv");
  const item = (await fileDetail(file.id)).items[0];
  const token = await fin1();
  const pay = (reference: string): Promise<any> => api.call("POST", `/platform/v1/bank-files/${file.id}/payments`, { token, body: { payments: [{ item_id: item.id, bank_reference: reference }] } });
  const paid = await Promise.all([pay("FT-RACE-1"), pay("FT-RACE-2")]);
  assert.deepEqual(paid.map((res) => res.status).sort(), [200, 409], paid.map((res) => res.text).join(" | "));
  const events = await api.db.owner.query("select count(*)::int as n from statement_events where statement_id = $1 and action = 'pay'", [item.statement_id]);
  assert.equal(events.rows[0].n, 1);
});

test("金额为 0 或负数：不进批次（ADR 0040 分流），数据库也拦；文件条目金额必须为正", async () => {
  await assert.rejects(api.db.owner.query("update statements set total_minor = 0 where status = 'paid' and tenant_id = $1", [m.a.tenantId]), (err: any) => err.constraint === "statements_outcome_total");
  const inPayout = await api.db.owner.query("select count(*)::int as n from statements where status in ('in_payout', 'paid') and total_minor <= 0");
  assert.equal(inPayout.rows[0].n, 0);
  await assert.rejects(api.db.owner.query("update bank_file_items set amount_minor = 0 where tenant_id = $1", [m.a.tenantId]), (err: any) => err.constraint === "bank_file_items_amount_positive");
});

test("数据范围：限定了范围的员工不能用；规则 4：供应商的返回里没有对外价和加价比例，也没有文件和密文", async () => {
  const role = await ok(api.call("POST", "/platform/v1/roles", { token: await platformLogin(api, "root@platform.test"), body: { name: "东京财务 2", grants: ["finance:view", "finance:edit", "finance:review"], data_scope: { city_ids: [m.ids.tokyo], channel_ids: null } } }), 201);
  const invited = await ok(api.call("POST", "/platform/v1/staff", { token: await platformLogin(api, "root@platform.test"), body: { email: "bf-tokyo@platform.test", name: "东京财务", role: role.key } }), 201);
  await ok(api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
  const scoped = await platformLogin(api, "bf-tokyo@platform.test");
  for (const [method, path, body] of [
    ["GET", "/platform/v1/payout-accounts"],
    ["GET", "/platform/v1/bank-files"],
    ["GET", `/platform/v1/payout-batches/${batchId}/bank-file-preview`],
    ["POST", `/platform/v1/bank-files/${jpyFile.id}/download`, { format: "csv" }],
  ] as const) {
    const res = await api.call(method, path, { token: scoped, ...(body === undefined ? {} : { body }) });
    assert.deepEqual([res.status, res.body.error.code], [403, "DATA_SCOPE_DENIED"], path);
  }

  const responses = [
    await api.call("GET", "/tenant/v1/payout-accounts", { token: await admin(m.a) }),
    await api.call("GET", "/tenant/v1/statements", { token: await admin(m.a) }),
  ];
  for (const res of responses) {
    const keys = allKeys(res.body);
    for (const forbidden of ["sell", "sell_price", "markup", "markup_bp", "account_sealed", "account_number", "file_no"]) assert.ok(!keys.has(forbidden), forbidden);
    assert.ok(!res.text.includes(FAKE_ACCOUNT_A));
  }
  // 平台接口不对供应商开放
  assert.equal((await api.call("GET", "/platform/v1/bank-files", { token: await admin(m.a) })).status, 401);
});
