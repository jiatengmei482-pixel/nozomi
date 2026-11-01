/**
 * M5-02 测试角色补的组件测试（ADR 0051）：开发的 bank-files.test.tsx 没覆盖的错误提示、连点、确认步骤。账号都是明显虚构的。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { BankFileDetail, BankFilePreview, PlatformPayoutAccount } from "../../api/bank-files.ts";
import type { PayoutBatchDetail } from "../../api/billing.ts";
import { BATCH_ID, STATEMENT_ID, openApp, platformStatementOf } from "../../testing/order-center-fixtures.tsx";
import { apiError, assertAbsent, deferred, json, resetBrowser } from "../../testing/harness.tsx";

afterEach(resetBrowser);
const user = () => userEvent.setup();

const FILE_ID = "f1f1f1f1-0000-4000-8000-000000000002";
const ITEM_ID = "f2f2f2f2-0000-4000-8000-000000000002";
const TENANT = { id: "f4f4f4f4-0000-4000-8000-000000000002", name: "甲车队" };
const batch: PayoutBatchDetail = { id: BATCH_ID, pay_date: "2026-10-20", status: "closed", created_at: "2026-10-09T00:00:00.000Z", closed_at: "2026-10-10T00:00:00.000Z", closed_by: "22222222-2222-4222-8222-222222222222", paid_at: null, statement_count: 1, totals: [{ currency: "SGD", count: 1, total: { amount: "1234.50", currency: "SGD" } }], version: 2, statements: [platformStatementOf({ status: "in_payout", payout_batch_id: BATCH_ID })] };
const ref = { statement_id: STATEMENT_ID, statement_no: "ST202609ABCDEFGH", tenant: TENANT, amount: { amount: "1234.50", currency: "SGD" } };
const previewOf = (excluded: BankFilePreview["groups"][number]["excluded"] = []): BankFilePreview => ({
  batch_id: BATCH_ID,
  pay_date: "2026-10-20",
  batch_status: "closed",
  groups: [{ currency: "SGD", pending_approval_id: null, total: { amount: "1234.50", currency: "SGD" }, eligible: [{ ...ref, beneficiary_name: "Fictional Transport", bank_name: "Fictional Bank", swift_bic: "FAKESGSG", account_masked: "•••• 9876", recently_changed: false }], excluded, in_files: [] }],
});
const fileOf = (changes: Partial<BankFileDetail> = {}): BankFileDetail => ({
  id: FILE_ID,
  file_no: "BF20261020ABCDEFGH",
  payout_batch_id: BATCH_ID,
  pay_date: "2026-10-20",
  currency: "SGD",
  template: "swift-generic-v1",
  charge_bearer: "SHA",
  status: "downloaded",
  item_count: 1,
  total: { amount: "1234.50", currency: "SGD" },
  excluded: [],
  approval_id: "f6f6f6f6-0000-4000-8000-000000000002",
  requested_by: "22222222-2222-4222-8222-222222222222",
  approved_by: "33333333-3333-4333-8333-333333333333",
  created_at: "2026-10-11T00:00:00.000Z",
  first_downloaded_at: "2026-10-12T00:00:00.000Z",
  download_count: 1,
  csv_sha256: "a".repeat(64),
  xlsx_sha256: null,
  paid_at: null,
  voided_at: null,
  void_reason: null,
  version: 1,
  items: [{ id: ITEM_ID, seq: 1, statement_id: STATEMENT_ID, statement_no: "ST202609ABCDEFGH", tenant: TENANT, beneficiary_name: "Fictional Transport", bank_name: "Fictional Bank", swift_bic: "FAKESGSG", account_masked: "•••• 9876", amount: { amount: "1234.50", currency: "SGD" }, reference: "NOZOMI ST202609ABCDEFGH SETTLEMENT 2026-09", bank_reference: null, paid_at: null, voided: false, account_changed: false }],
  ...changes,
});
const account: Omit<PlatformPayoutAccount, "tenant" | "approval_id" | "pending_approval_id" | "recently_changed"> = { id: "f3f3f3f3-0000-4000-8000-000000000002", currency: "SGD", beneficiary_name: "Fictional Transport", beneficiary_address: "1 Example Road", bank_name: "Fictional Bank", bank_address: "2 Sample Street", swift_bic: "FAKESGSG", account_kind: "account", account_masked: "•••• 9876", status: "pending", submitted_at: "2026-10-05T00:00:00.000Z", activated_at: null, superseded_at: null, rejected_at: null, reject_reason: null, withdrawn_at: null, version: 1 };

function openFile(file: BankFileDetail, respond: (call: { method: string; url: URL; body: unknown }) => Response | Promise<Response> | null) {
  return openApp(`/platform/finance/bank-files/${FILE_ID}`, "platform", "finance", (call) => {
    const custom = respond(call);
    if (custom !== null) return custom;
    if (call.method === "GET" && call.url.pathname === `/platform/v1/bank-files/${FILE_ID}`) return json(200, { file });
    return null;
  });
}

test("下载被拒：文件内容不一致、账号解不开都写清楚中文原因，不给文件，也不把内部代码显示给人", async () => {
  const cases: [number, string, string][] = [
    [409, "BANK_FILE_INTEGRITY", "文件内容和第一次下载时不一致，已拒绝下载。请联系技术核对，不要转账"],
    [409, "BANK_FILE_ACCOUNT_UNREADABLE", "有账号解不开（数据加密密钥可能换过），没有生成文件。请作废这个文件、让供应商重新提交账户后再生成"],
  ];
  for (const [status, code, message] of cases) {
    openFile(fileOf(), (call) => (call.method === "POST" && call.url.pathname.endsWith("/download") ? apiError(status, code, message) : null));
    const u = user();
    await u.click(await screen.findByRole("button", { name: "下载 CSV" }));
    await screen.findByText(message);
    assertAbsent(screen.queryByText(code));
    assertAbsent(screen.queryByText(/已下载 /));
    resetBrowser();
  }
});

test("下载遇到服务器错误：中文提示，按钮恢复可以再点", async () => {
  let attempts = 0;
  openFile(fileOf(), (call) => {
    if (call.method === "POST" && call.url.pathname.endsWith("/download")) {
      attempts += 1;
      return apiError(500, "INTERNAL_ERROR", "Internal Server Error");
    }
    return null;
  });
  const u = user();
  await u.click(await screen.findByRole("button", { name: "下载 Excel" }));
  await screen.findByText(/系统暂时无法下载/);
  assertAbsent(screen.queryByText("Internal Server Error"));
  await waitFor(() => assert.equal((screen.getByRole("button", { name: "下载 Excel" }) as HTMLButtonElement).disabled, false));
  await u.click(screen.getByRole("button", { name: "下载 Excel" }));
  await waitFor(() => assert.equal(attempts, 2));
});

test("连点：下载、回填、作废，响应回来之前再点都不会多发", async () => {
  const gate = deferred();
  const calls: string[] = [];
  openFile(fileOf(), (call) => {
    if (call.method !== "POST") return null;
    calls.push(call.url.pathname.split("/").at(-1) as string);
    return gate.promise;
  });
  const u = user();
  const button = await screen.findByRole("button", { name: "下载 CSV" });
  await u.dblClick(button);
  await u.click(screen.getByRole("button", { name: "下载 Excel" }));
  assert.deepEqual(calls, ["download"], "第一个下载没回来之前，两种下载都不能再发");
  gate.resolve(apiError(409, "BANK_FILE_STATE_INVALID", "已付款或已作废的文件不能再下载"));
  await screen.findByText("已付款或已作废的文件不能再下载");
  resetBrowser();

  const payGate = deferred();
  const pays: unknown[] = [];
  openFile(fileOf(), (call) => {
    if (call.method === "POST" && call.url.pathname.endsWith("/payments")) {
      pays.push(call.body);
      return payGate.promise;
    }
    return null;
  });
  const v = user();
  await v.click(await screen.findByRole("button", { name: "回填流水号" }));
  const dialog = await screen.findByRole("dialog", { name: "回填银行流水号" });
  await v.type(within(dialog).getByLabelText(/银行流水号/), "FT-QA-1");
  await v.dblClick(within(dialog).getByRole("button", { name: /记为已付款/ }));
  assert.equal(pays.length, 1, "连点只回填一次");
  payGate.resolve(apiError(409, "BANK_FILE_ITEM_ALREADY_PAID", "账单 ST202609ABCDEFGH 这一笔已经回填过别的流水号，不能改", { item_id: ITEM_ID }));
  await within(dialog).findByText(/已经回填过别的流水号/);
  resetBrowser();

  const voidGate = deferred();
  const voids: unknown[] = [];
  openFile(fileOf(), (call) => {
    if (call.method === "POST" && call.url.pathname.endsWith("/void")) {
      voids.push(call.body);
      return voidGate.promise;
    }
    return null;
  });
  const w = user();
  await w.click(await screen.findByRole("button", { name: "作废" }));
  const voidDialog = await screen.findByRole("dialog", { name: "作废这个转账文件？" });
  await w.click(within(voidDialog).getByRole("button", { name: "作废" }));
  await within(voidDialog).findByText("请写作废原因");
  assert.equal(voids.length, 0, "没写原因不发请求");
  await w.type(within(voidDialog).getByLabelText(/作废原因/), "账户已变更");
  await w.dblClick(within(voidDialog).getByRole("button", { name: /作废/ }));
  assert.deepEqual(voids, [{ reason: "账户已变更" }], "连点只作废一次");
  voidGate.resolve(apiError(409, "BANK_FILE_STATE_INVALID", "已付款或已作废的文件不能作废"));
  await within(voidDialog).findByText("已付款或已作废的文件不能作废");
});

test("回填：流水号不合规不发请求；已回填和作废的条目不在可选之列；一笔不选不发；流水号前后的空白去掉", async () => {
  const paid = { ...fileOf().items[0]!, id: "f2f2f2f2-0000-4000-8000-000000000003", seq: 2, bank_reference: "FT-OLD", paid_at: "2026-10-13T00:00:00.000Z" };
  const voided = { ...fileOf().items[0]!, id: "f2f2f2f2-0000-4000-8000-000000000004", seq: 3, voided: true };
  const posted: unknown[] = [];
  openFile(fileOf({ items: [...fileOf().items, paid, voided], item_count: 3 }), (call) => {
    if (call.method === "POST" && call.url.pathname.endsWith("/payments")) {
      posted.push(call.body);
      return json(200, { file: fileOf({ status: "paid", paid_at: "2026-10-14T00:00:00.000Z" }) });
    }
    return null;
  });
  const u = user();
  await u.click(await screen.findByRole("button", { name: "回填流水号" }));
  const dialog = await screen.findByRole("dialog", { name: "回填银行流水号" });
  assert.equal(within(dialog).getAllByRole("checkbox").length, 1, "只有没付、没作废的可选");
  for (const bad of ["=1+1", "FT 1", "流水号"]) {
    await u.clear(within(dialog).getByLabelText(/银行流水号/));
    await u.type(within(dialog).getByLabelText(/银行流水号/), bad);
    await u.click(within(dialog).getByRole("button", { name: "记为已付款" }));
    await within(dialog).findByText(/流水号是 1–64 位/);
  }
  assert.equal(posted.length, 0);
  await u.clear(within(dialog).getByLabelText(/银行流水号/));
  await u.type(within(dialog).getByLabelText(/银行流水号/), "  FT-QA-2  ");
  await u.click(within(dialog).getByRole("checkbox"));
  await u.click(within(dialog).getByRole("button", { name: "记为已付款" }));
  await within(dialog).findByText("至少选一笔");
  assert.equal(posted.length, 0);
  await u.click(within(dialog).getByRole("checkbox"));
  await u.click(within(dialog).getByRole("button", { name: "记为已付款" }));
  await screen.findByText("已回填流水号");
  assert.deepEqual(posted, [{ payments: [{ item_id: ITEM_ID, bank_reference: "FT-QA-2" }] }]);
});

test("账户已变更的文件：页面在下载之前标出来；已回填、已作废的条目不再提醒", async () => {
  const flagged = { ...fileOf().items[0]!, account_changed: true };
  const settled = { ...fileOf().items[0]!, id: "f2f2f2f2-0000-4000-8000-000000000005", seq: 2, account_changed: true, bank_reference: "FT-OLD", paid_at: "2026-10-13T00:00:00.000Z" };
  openFile(fileOf({ status: "generated", items: [flagged, settled], item_count: 2 }), () => null);
  await screen.findByRole("button", { name: "下载 CSV" });
  assert.equal(screen.getAllByText("账户已变更").length, 1);
});

test("排除名单：发起时才发现账号解不开（预览不解密）——对话框要列出那张账单并让人确认，不能卡死在一句「确认后才能继续」", async () => {
  const posted: Record<string, unknown>[] = [];
  const excluded = [{ statement_id: STATEMENT_ID, statement_no: "ST202609ABCDEFGH", tenant_id: TENANT.id, tenant_name: TENANT.name, code: "ACCOUNT_UNREADABLE", message: "收款账号解不开（数据加密密钥可能换过），请供应商重新提交", amount_minor: 123450 }];
  openApp(`/platform/finance/payout-batches/${BATCH_ID}`, "platform", "finance", (call) => {
    if (call.url.pathname === `/platform/v1/payout-batches/${BATCH_ID}`) return json(200, { batch });
    if (call.url.pathname.endsWith("/bank-file-preview")) return json(200, { preview: previewOf() });
    if (call.method === "GET" && call.url.pathname === "/platform/v1/bank-files") return json(200, { items: [] });
    if (call.method === "POST" && call.url.pathname.endsWith("/bank-files")) {
      posted.push(call.body as Record<string, unknown>);
      if ((call.body as Record<string, unknown>)["allow_exclusions"] === true) return json(202, { approval: {} });
      return apiError(409, "BANK_FILE_EXCLUSIONS", "有 1 张账单进不了文件，确认后才能继续", { currency: "SGD", excluded });
    }
    return null;
  });
  const u = user();
  await u.click(await screen.findByRole("button", { name: "生成 SGD 转账文件" }));
  const dialog = await screen.findByRole("dialog", { name: "生成 SGD 转账文件" });
  await u.click(within(dialog).getByRole("button", { name: "提交复核" }));
  await within(dialog).findByText("有 1 张账单进不了文件，确认后才能继续");
  await waitFor(() => assert.ok(within(dialog).queryByRole("checkbox", { name: /确认这次不付 ST202609ABCDEFGH/ }), "要列出后端给的账单，让人勾选确认；现在对话框里什么都确认不了，也永远发不出 allow_exclusions"));
});

test("排除名单：没勾选不发；后端拒绝（批次已变）时对话框不关，写中文原因；确认文字列出每张账单号", async () => {
  const posted: unknown[] = [];
  const excluded = [
    { ...ref, statement_id: "f5f5f5f5-0000-4000-8000-000000000011", statement_no: "ST202609ZZZZZZZA", tenant: { id: TENANT.id, name: "乙车队" }, code: "ACCOUNT_MISSING" as const, message: "供应商还没有这种币种的收款账户" },
    { ...ref, statement_id: "f5f5f5f5-0000-4000-8000-000000000012", statement_no: "ST202609ZZZZZZZB", tenant: { id: TENANT.id, name: "丙车队" }, code: "ACCOUNT_PENDING" as const, message: "供应商的收款账户还在审核，没有生效" },
  ];
  openApp(`/platform/finance/payout-batches/${BATCH_ID}`, "platform", "finance", (call) => {
    if (call.url.pathname === `/platform/v1/payout-batches/${BATCH_ID}`) return json(200, { batch });
    if (call.url.pathname.endsWith("/bank-file-preview")) return json(200, { preview: previewOf(excluded) });
    if (call.method === "GET" && call.url.pathname === "/platform/v1/bank-files") return json(200, { items: [] });
    if (call.method === "POST" && call.url.pathname.endsWith("/bank-files")) {
      posted.push(call.body);
      return apiError(409, "BANK_FILE_REVIEW_PENDING", "这个批次的 SGD 已经有一条待审核的生成复核", { approval_id: "x" });
    }
    return null;
  });
  const u = user();
  await u.click(await screen.findByRole("button", { name: "生成 SGD 转账文件" }));
  const dialog = await screen.findByRole("dialog", { name: "生成 SGD 转账文件" });
  const confirm = within(dialog).getByRole("checkbox", { name: /确认这次不付 ST202609ZZZZZZZA、ST202609ZZZZZZZB/ });
  assert.equal((confirm as HTMLInputElement).checked, false, "默认不勾");
  await u.click(within(dialog).getByRole("button", { name: "提交复核" }));
  await within(dialog).findByText("请确认后再继续");
  assert.equal(posted.length, 0);
  await u.click(confirm);
  await u.click(within(dialog).getByRole("button", { name: "提交复核" }));
  await within(dialog).findByText("这个批次的 SGD 已经有一条待审核的生成复核");
  assert.ok(screen.getByRole("dialog", { name: "生成 SGD 转账文件" }));
});

test("供应商提交：后端说币种有问题（字段不在输入框上）也要让人看到，不能点了没反应", async () => {
  openApp("/statements/payout-accounts", "tenant", "admin", (call) => {
    if (call.method === "GET" && call.url.pathname === "/tenant/v1/payout-accounts") return json(200, { items: [] });
    if (call.method === "POST" && call.url.pathname === "/tenant/v1/payout-accounts") return apiError(400, "VALIDATION_FAILED", "请求参数校验未通过", { location: "body", issues: [{ path: "/currency", reason: "UNSUPPORTED_CURRENCY", message: "x" }] });
    return null;
  });
  const u = user();
  await u.click(await screen.findByRole("button", { name: "提交收款账户" }));
  const dialog = await screen.findByRole("dialog", { name: "提交收款账户" });
  await u.selectOptions(within(dialog).getByLabelText(/币种/), "SGD");
  await u.type(within(dialog).getByLabelText(/收款人名称/), "Fictional Transport");
  await u.type(within(dialog).getByLabelText(/收款人地址/), "1 Example Road");
  await u.type(within(dialog).getByLabelText(/银行名称/), "Fictional Bank");
  await u.type(within(dialog).getByLabelText(/银行地址/), "2 Sample Street");
  await u.type(within(dialog).getByLabelText(/SWIFT/), "FAKESGSG");
  await u.type(within(dialog).getByRole("textbox", { name: /^银行账号/ }), "0012349876");
  await u.type(within(dialog).getByLabelText(/当前登录密码/), "fake-password");
  await u.click(within(dialog).getByRole("button", { name: "提交审核" }));
  await within(dialog).findByText("平台不支持这种币种");
});

test("供应商提交：密码失败次数太多（429）写中文和等待时间；连点只发一次；提交失败后账号不写进网址、存储", async () => {
  const gate = deferred();
  const posts: unknown[] = [];
  openApp("/statements/payout-accounts", "tenant", "admin", (call) => {
    if (call.method === "GET" && call.url.pathname === "/tenant/v1/payout-accounts") return json(200, { items: [] });
    if (call.method === "POST" && call.url.pathname === "/tenant/v1/payout-accounts") {
      posts.push(call.body);
      return gate.promise;
    }
    return null;
  });
  const u = user();
  await u.click(await screen.findByRole("button", { name: "提交收款账户" }));
  const dialog = await screen.findByRole("dialog", { name: "提交收款账户" });
  await u.selectOptions(within(dialog).getByLabelText(/币种/), "JPY");
  await u.type(within(dialog).getByLabelText(/收款人名称/), "Fictional Transport");
  await u.type(within(dialog).getByLabelText(/收款人地址/), "1 Example Road");
  await u.type(within(dialog).getByLabelText(/银行名称/), "Fictional Bank");
  await u.type(within(dialog).getByLabelText(/银行地址/), "2 Sample Street");
  await u.type(within(dialog).getByLabelText(/SWIFT/), "FAKEJPJT");
  await u.type(within(dialog).getByRole("textbox", { name: /^银行账号/ }), "0012349876");
  await u.type(within(dialog).getByLabelText(/当前登录密码/), "fake-password");
  await u.dblClick(within(dialog).getByRole("button", { name: /提交审核/ }));
  assert.equal(posts.length, 1, "连点只发一次");
  gate.resolve(apiError(429, "TOO_MANY_LOGIN_ATTEMPTS", "尝试次数过多，请稍后再试", { retry_after_seconds: 900 }));
  await within(dialog).findByText(/尝试次数过多/);
  const stored = JSON.stringify({ ...window.localStorage }) + JSON.stringify({ ...window.sessionStorage }) + window.location.href;
  assert.ok(!stored.includes("0012349876") && !stored.includes("fake-password"));
});

test("撤回：要确认；后端说状态变了（已被批准）写中文原因；连点只发一次", async () => {
  const gate = deferred();
  const posts: string[] = [];
  openApp("/statements/payout-accounts", "tenant", "admin", (call) => {
    if (call.method === "GET" && call.url.pathname === "/tenant/v1/payout-accounts") return json(200, { items: [account] });
    if (call.method === "POST" && call.url.pathname.endsWith("/withdraw")) {
      posts.push(call.url.pathname);
      return gate.promise;
    }
    return null;
  });
  const u = user();
  await u.click(await screen.findByRole("button", { name: "撤回 SGD 账户" }));
  const dialog = await screen.findByRole("dialog", { name: /撤回 SGD 账户/ });
  assert.equal(posts.length, 0, "点开对话框不算撤回");
  await u.dblClick(within(dialog).getByRole("button", { name: /^撤回/ }));
  assert.equal(posts.length, 1);
  gate.resolve(apiError(409, "PAYOUT_ACCOUNT_STATE_INVALID", "只有待审核的账户能撤回", { status: "active" }));
  await within(dialog).findByText("只有待审核的账户能撤回");
});
