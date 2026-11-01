/**
 * 银行转账文件和收款账户（M5-02，ADR 0051）的组件测试：批次详情列出进不了文件的账单、排除要确认；文件详情的下载、回填、作废和权限；
 * 账户队列的发起复核、驳回；供应商提交账户（校验、密码错、账号只显示末 4 位）。账号都是明显虚构的。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { BankFileDetail, BankFilePreview, PlatformPayoutAccount } from "../../api/bank-files.ts";
import type { PayoutBatchDetail } from "../../api/billing.ts";
import { BATCH_ID, STATEMENT_ID, openApp, platformStatementOf } from "../../testing/order-center-fixtures.tsx";
import { apiError, assertAbsent, json, resetBrowser } from "../../testing/harness.tsx";

afterEach(resetBrowser);
const user = () => userEvent.setup();

const FILE_ID = "f1f1f1f1-0000-4000-8000-000000000001";
const ITEM_ID = "f2f2f2f2-0000-4000-8000-000000000001";
const ACCOUNT_ID = "f3f3f3f3-0000-4000-8000-000000000001";
const TENANT = { id: "f4f4f4f4-0000-4000-8000-000000000001", name: "甲车队" };

const batch: PayoutBatchDetail = { id: BATCH_ID, pay_date: "2026-10-20", status: "closed", created_at: "2026-10-09T00:00:00.000Z", closed_at: "2026-10-10T00:00:00.000Z", closed_by: "22222222-2222-4222-8222-222222222222", paid_at: null, statement_count: 2, totals: [{ currency: "SGD", count: 2, total: { amount: "1334.50", currency: "SGD" } }], version: 2, statements: [platformStatementOf({ status: "in_payout", payout_batch_id: BATCH_ID })] };

const ref = { statement_id: STATEMENT_ID, statement_no: "ST202609ABCDEFGH", tenant: TENANT, amount: { amount: "1234.50", currency: "SGD" } };
const preview: BankFilePreview = {
  batch_id: BATCH_ID,
  pay_date: "2026-10-20",
  batch_status: "closed",
  groups: [
    {
      currency: "SGD",
      pending_approval_id: null,
      total: { amount: "1234.50", currency: "SGD" },
      eligible: [{ ...ref, beneficiary_name: "Fictional Transport", bank_name: "Fictional Bank", swift_bic: "FAKESGSG", account_masked: "•••• 9876", recently_changed: true }],
      excluded: [{ ...ref, statement_id: "f5f5f5f5-0000-4000-8000-000000000001", statement_no: "ST202609ZZZZZZZZ", tenant: { id: TENANT.id, name: "乙车队" }, amount: { amount: "100.00", currency: "SGD" }, code: "ACCOUNT_MISSING", message: "供应商还没有这种币种的收款账户" }],
      in_files: [],
    },
  ],
};

const fileOf = (changes: Partial<BankFileDetail> = {}): BankFileDetail => ({
  id: FILE_ID,
  file_no: "BF20261020ABCDEFGH",
  payout_batch_id: BATCH_ID,
  pay_date: "2026-10-20",
  currency: "SGD",
  template: "swift-generic-v1",
  charge_bearer: "SHA",
  status: "generated",
  item_count: 1,
  total: { amount: "1234.50", currency: "SGD" },
  excluded: [],
  approval_id: "f6f6f6f6-0000-4000-8000-000000000001",
  requested_by: "22222222-2222-4222-8222-222222222222",
  approved_by: "33333333-3333-4333-8333-333333333333",
  created_at: "2026-10-11T00:00:00.000Z",
  first_downloaded_at: null,
  download_count: 0,
  csv_sha256: null,
  xlsx_sha256: null,
  paid_at: null,
  voided_at: null,
  void_reason: null,
  version: 1,
  items: [{ id: ITEM_ID, seq: 1, statement_id: STATEMENT_ID, statement_no: "ST202609ABCDEFGH", tenant: TENANT, beneficiary_name: "Fictional Transport", bank_name: "Fictional Bank", swift_bic: "FAKESGSG", account_masked: "•••• 9876", amount: { amount: "1234.50", currency: "SGD" }, reference: "NOZOMI ST202609ABCDEFGH SETTLEMENT 2026-09", bank_reference: null, paid_at: null, voided: false, account_changed: false }],
  ...changes,
});

const accountOf = (changes: Partial<PlatformPayoutAccount> = {}): PlatformPayoutAccount => ({
  id: ACCOUNT_ID,
  currency: "SGD",
  beneficiary_name: "Fictional Transport",
  beneficiary_address: "1 Example Road",
  bank_name: "Fictional Bank",
  bank_address: "2 Sample Street",
  swift_bic: "FAKESGSG",
  account_kind: "account",
  account_masked: "•••• 9876",
  status: "pending",
  submitted_at: "2026-10-05T00:00:00.000Z",
  activated_at: null,
  superseded_at: null,
  rejected_at: null,
  reject_reason: null,
  withdrawn_at: null,
  version: 1,
  tenant: TENANT,
  approval_id: null,
  pending_approval_id: null,
  recently_changed: false,
  ...changes,
});

test("批次详情：进不了文件的账单明确列出、写原因；排除要勾选确认才能提交；提交后走复核", async () => {
  const posted: unknown[] = [];
  openApp(`/platform/finance/payout-batches/${BATCH_ID}`, "platform", "finance", (call) => {
    if (call.url.pathname === `/platform/v1/payout-batches/${BATCH_ID}`) return json(200, { batch });
    if (call.url.pathname.endsWith("/bank-file-preview")) return json(200, { preview });
    if (call.method === "GET" && call.url.pathname === "/platform/v1/bank-files") return json(200, { items: [] });
    if (call.method === "POST" && call.url.pathname.endsWith("/bank-files")) {
      posted.push(call.body);
      return json(202, { approval: {} });
    }
    return null;
  });
  const u = user();
  await screen.findByText("供应商还没有这种币种的收款账户");
  assert.ok(screen.getAllByText("乙车队").length > 0);
  assert.ok(screen.getAllByText("账户最近变更").length > 0);
  assert.ok(screen.getAllByText("•••• 9876", { exact: false }).length > 0);
  await u.click(screen.getByRole("button", { name: "生成 SGD 转账文件" }));
  const dialog = await screen.findByRole("dialog", { name: "生成 SGD 转账文件" });
  await u.click(within(dialog).getByRole("button", { name: "提交复核" }));
  await within(dialog).findByText("请确认后再继续");
  assert.equal(posted.length, 0);
  await u.selectOptions(within(dialog).getByLabelText(/手续费/), "OUR");
  await u.click(within(dialog).getByRole("checkbox", { name: /确认这次不付 ST202609ZZZZZZZZ/ }));
  await u.click(within(dialog).getByRole("button", { name: "提交复核" }));
  await screen.findByText("已提交复核，另一位同事批准后文件才生成");
  assert.deepEqual(posted, [{ currency: "SGD", charge_bearer: "OUR", allow_exclusions: true, note: null }]);
});

test("文件详情：财务能下载、回填（格式校验、选笔）、作废（提醒先到银行撤销）；只读只能看；完整账号不出现", async () => {
  let current = fileOf({ status: "downloaded", first_downloaded_at: "2026-10-12T00:00:00.000Z", download_count: 1, csv_sha256: "a".repeat(64) });
  const posted: { path: string; body: unknown }[] = [];
  const route = (call: { method: string; url: URL; body: unknown }) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/bank-files/${FILE_ID}`) return json(200, { file: current });
    if (call.method === "POST" && call.url.pathname.endsWith("/payments")) {
      posted.push({ path: "payments", body: call.body });
      current = fileOf({ ...current, status: "paid", paid_at: "2026-10-20T00:00:00.000Z", items: current.items.map((item) => ({ ...item, bank_reference: "FT26293ABC", paid_at: "2026-10-20T00:00:00.000Z" })) });
      return json(200, { file: current });
    }
    return null;
  };
  openApp(`/platform/finance/bank-files/${FILE_ID}`, "platform", "finance", route);
  const u = user();
  await screen.findByRole("heading", { level: 1, name: "转账文件 BF20261020ABCDEFGH" });
  assert.ok(screen.getByRole("button", { name: "下载 CSV" }));
  assert.ok(screen.getByRole("button", { name: "下载 Excel" }));
  assert.ok(screen.getByText("a".repeat(64)));
  await u.click(screen.getByRole("button", { name: "作废" }));
  const voidDialog = await screen.findByRole("dialog", { name: "作废这个转账文件？" });
  assert.ok(within(voidDialog).getByText(/请先到银行撤销/));
  await u.click(within(voidDialog).getByRole("button", { name: "取消" }));

  await u.click(screen.getByRole("button", { name: "回填流水号" }));
  const dialog = await screen.findByRole("dialog", { name: "回填银行流水号" });
  await u.click(within(dialog).getByRole("button", { name: "记为已付款" }));
  await within(dialog).findByText(/流水号是 1–64 位/);
  await u.type(within(dialog).getByLabelText(/银行流水号/), "FT26293ABC");
  await u.click(within(dialog).getByRole("button", { name: "记为已付款" }));
  await screen.findByText("已回填流水号");
  assert.deepEqual(posted, [{ path: "payments", body: { payments: [{ item_id: ITEM_ID, bank_reference: "FT26293ABC" }] } }]);
  await waitFor(() => assert.ok(screen.getByText("FT26293ABC")));
  assertAbsent(screen.queryByRole("button", { name: "下载 CSV" }));
  assertAbsent(screen.queryByRole("button", { name: "回填流水号" }));

  resetBrowser();
  current = fileOf();
  openApp(`/platform/finance/bank-files/${FILE_ID}`, "platform", "readonly", route);
  await screen.findByRole("heading", { level: 1, name: "转账文件 BF20261020ABCDEFGH" });
  assertAbsent(screen.queryByRole("button", { name: "下载 CSV" }));
  assertAbsent(screen.queryByRole("button", { name: "作废" }));
});

test("限定了数据范围的员工：转账文件和收款账户不发请求，说明原因", async () => {
  for (const path of [`/platform/finance/bank-files/${FILE_ID}`, "/platform/finance/payout-accounts"]) {
    resetBrowser();
    const calls = openApp(path, "platform", "custom_0123456789abcdef", () => null, ["statement.read"], { city_ids: null, channel_ids: ["c4c4c4c4-0000-4000-8000-000000000002"] });
    await screen.findByText(/财务结算只给不限数据范围的账号用/);
    assert.deepEqual(calls.filter((call) => /bank-files|payout-accounts/.test(call.path)), [], path);
  }
});

test("账户队列：默认看待审核；发起复核、驳回（原因必填）；有待审核的复核时去「待审核」", async () => {
  const posted: { path: string; body: unknown }[] = [];
  let items = [accountOf()];
  openApp("/platform/finance/payout-accounts", "platform", "finance", (call) => {
    if (call.method === "GET" && call.url.pathname === "/platform/v1/payout-accounts") {
      assert.equal(call.url.searchParams.get("status"), "pending");
      return json(200, { items });
    }
    if (call.method === "POST" && call.url.pathname.endsWith("/approval")) {
      posted.push({ path: "approval", body: call.body });
      items = [accountOf({ pending_approval_id: "f7f7f7f7-0000-4000-8000-000000000001" })];
      return json(202, { approval: {} });
    }
    return null;
  });
  const u = user();
  await screen.findByText("•••• 9876");
  await u.click(screen.getByRole("button", { name: "驳回：甲车队 SGD" }));
  const reject = await screen.findByRole("dialog", { name: "驳回 甲车队 的 SGD 账户？" });
  await u.click(within(reject).getByRole("button", { name: "驳回" }));
  await within(reject).findByText("请写驳回原因");
  await u.click(within(reject).getByRole("button", { name: "取消" }));
  await u.click(screen.getByRole("button", { name: "发起复核：甲车队 SGD" }));
  const review = await screen.findByRole("dialog", { name: "发起复核：甲车队 的 SGD 账户" });
  await u.click(within(review).getByRole("button", { name: "提交复核" }));
  await screen.findByText("已提交复核");
  await screen.findByRole("link", { name: "等复核" });
  assert.deepEqual(posted, [{ path: "approval", body: { note: null } }]);
});

test("供应商提交账户：先查填没填、SWIFT 和 IBAN 格式；密码错写在密码框下；后端的逐项错误写到对应字段；账号提交后只看到末 4 位", async () => {
  const posted: Record<string, unknown>[] = [];
  let items: unknown[] = [];
  openApp("/statements/payout-accounts", "tenant", "admin", (call) => {
    if (call.method === "GET" && call.url.pathname === "/tenant/v1/payout-accounts") return json(200, { items });
    if (call.method === "POST" && call.url.pathname === "/tenant/v1/payout-accounts") {
      posted.push(call.body as Record<string, unknown>);
      if (posted.length === 1) return apiError(400, "CURRENT_PASSWORD_INCORRECT", "当前密码不正确");
      if (posted.length === 2) return apiError(400, "VALIDATION_FAILED", "请求参数校验未通过", { location: "body", issues: [{ path: "/beneficiary_name", reason: "CHARSET", message: "x" }] });
      const { tenant: _tenant, approval_id: _a, pending_approval_id: _p, recently_changed: _r, ...account } = accountOf();
      items = [account];
      return json(201, { account });
    }
    return null;
  });
  const u = user();
  await screen.findByText("还没有收款账户");
  await u.click(screen.getByRole("button", { name: "提交收款账户" }));
  const dialog = await screen.findByRole("dialog", { name: "提交收款账户" });
  await u.click(within(dialog).getByRole("button", { name: "提交审核" }));
  await within(dialog).findByText("请选币种");
  assert.equal(posted.length, 0);
  await u.selectOptions(within(dialog).getByLabelText(/币种/), "SGD");
  await u.type(within(dialog).getByLabelText(/收款人名称/), "Fictional Transport");
  await u.type(within(dialog).getByLabelText(/收款人地址/), "1 Example Road");
  await u.type(within(dialog).getByLabelText(/银行名称/), "Fictional Bank");
  await u.type(within(dialog).getByLabelText(/银行地址/), "2 Sample Street");
  await u.type(within(dialog).getByLabelText(/SWIFT/), "NOPE");
  await u.click(within(dialog).getByRole("radio", { name: "IBAN" }));
  await u.type(within(dialog).getByRole("textbox", { name: /^IBAN/ }), "GB00FAKE");
  await u.type(within(dialog).getByLabelText(/当前登录密码/), "fake-password");
  await u.click(within(dialog).getByRole("button", { name: "提交审核" }));
  await within(dialog).findByText(/SWIFT\/BIC 要 8 或 11 位/);
  await within(dialog).findByText(/IBAN 不对/);
  assert.equal(posted.length, 0, "前端拦住了明显不对的");
  await u.clear(within(dialog).getByLabelText(/SWIFT/));
  await u.type(within(dialog).getByLabelText(/SWIFT/), "FAKESGSG");
  await u.click(within(dialog).getByRole("radio", { name: "银行账号" }));
  await u.clear(within(dialog).getByRole("textbox", { name: /^银行账号/ }));
  await u.type(within(dialog).getByRole("textbox", { name: /^银行账号/ }), "0012349876");
  await u.click(within(dialog).getByRole("button", { name: "提交审核" }));
  await within(dialog).findByText("当前密码不正确");
  await u.click(within(dialog).getByRole("button", { name: "提交审核" }));
  await within(dialog).findByText(/中文、& 银行传不了/);
  await u.click(within(dialog).getByRole("button", { name: "提交审核" }));
  await screen.findByText("已提交，平台审核通过后生效");
  await screen.findByText("•••• 9876");
  assertAbsent(screen.queryByText("0012349876"));
  assert.equal(posted[0]?.["account_number"], "0012349876");
  assert.equal(posted[0]?.["account_kind"], "account");
  assert.equal(posted[0]?.["currency"], "SGD");
  assert.ok(!window.location.href.includes("0012349876"));
});

test("供应商：只读看得到列表没有提交按钮；财务同样不能提交；待审核的管理员可以撤回", async () => {
  const route = (call: { method: string; url: URL }) => (call.method === "GET" && call.url.pathname === "/tenant/v1/payout-accounts" ? json(200, { items: [accountOf()] }) : null);
  for (const role of ["readonly", "finance"] as const) {
    resetBrowser();
    openApp("/statements/payout-accounts", "tenant", role, route);
    await screen.findByText("•••• 9876");
    assertAbsent(screen.queryByRole("button", { name: "提交收款账户" }));
    assertAbsent(screen.queryByRole("button", { name: "撤回 SGD 账户" }));
  }
  resetBrowser();
  openApp("/statements/payout-accounts", "tenant", "admin", route);
  await screen.findByText("•••• 9876");
  assert.ok(screen.getByRole("button", { name: "撤回 SGD 账户" }));
});
