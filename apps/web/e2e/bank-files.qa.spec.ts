/**
 * M5-02 测试角色补的端到端（ADR 0051）：开发的 order-center.spec.ts 查过页面在 320px 不溢出，这里查对话框和极端长度的内容——
 * 名称 70 个不带空格的字符（SWIFT 字符集允许）、SHA-256、IBAN 长度的流水号。登录走真实后端，转账文件的数据由页面层拦截给出（都是虚构的，不写库）。
 */
import { type Locator, type Page, expect, test } from "@playwright/test";
import { createActiveTenant, expectNoHorizontalOverflow, adminCredentials, loginAs } from "./support.ts";

const BATCH_ID = "f0f0f0f0-0000-4000-8000-000000000001";
const FILE_ID = "f1f1f1f1-0000-4000-8000-000000000001";
const TENANT = { id: "f4f4f4f4-0000-4000-8000-000000000001", name: "超长名字的虚构供应商有限公司超长名字的虚构供应商有限公司" };
const LONG = "FICTIONALTRANSPORTCOMPANYWITHAVERYLONGUNBROKENNAMEFORTESTINGWIDTHS0123";
const money = { amount: "999999999.99", currency: "SGD" };
const ref = (n: number) => ({ statement_id: `f5f5f5f5-0000-4000-8000-00000000000${n}`, statement_no: `ST202609ABCDEFG${n}`, tenant: TENANT, amount: money });
const preview = {
  batch_id: BATCH_ID,
  pay_date: "2026-10-20",
  batch_status: "closed",
  groups: [
    {
      currency: "SGD",
      pending_approval_id: null,
      total: money,
      eligible: [{ ...ref(1), beneficiary_name: LONG, bank_name: LONG, swift_bic: "FAKESGSGXXX", account_masked: "•••• 9876", recently_changed: true }],
      excluded: [2, 3, 4, 5, 6, 7].map((n) => ({ ...ref(n), code: "ACCOUNT_MISSING", message: "供应商还没有这种币种的收款账户" })),
      in_files: [],
    },
  ],
};
const item = (seq: number) => ({ id: `f2f2f2f2-0000-4000-8000-00000000000${seq}`, seq, statement_id: ref(seq).statement_id, statement_no: ref(seq).statement_no, tenant: TENANT, beneficiary_name: LONG, bank_name: LONG, swift_bic: "FAKESGSGXXX", account_masked: "•••• 9876", amount: money, reference: `NOZOMI ${ref(seq).statement_no} SETTLEMENT 2026-09`, bank_reference: seq === 2 ? "A".repeat(64) : null, paid_at: seq === 2 ? "2026-10-13T00:00:00.000Z" : null, voided: false, account_changed: seq === 1 });
const file = {
  id: FILE_ID,
  file_no: "BF20261020ABCDEFGH",
  payout_batch_id: BATCH_ID,
  pay_date: "2026-10-20",
  currency: "SGD",
  template: "swift-generic-v1",
  charge_bearer: "SHA",
  status: "downloaded",
  item_count: 3,
  total: money,
  excluded: [{ statement_id: ref(7).statement_id, statement_no: ref(7).statement_no, tenant_name: TENANT.name, code: "ACCOUNT_MISSING", message: "供应商还没有这种币种的收款账户" }],
  approval_id: "f6f6f6f6-0000-4000-8000-000000000001",
  requested_by: "22222222-2222-4222-8222-222222222222",
  approved_by: "33333333-3333-4333-8333-333333333333",
  created_at: "2026-10-11T00:00:00.000Z",
  first_downloaded_at: "2026-10-12T00:00:00.000Z",
  download_count: 1,
  csv_sha256: "a".repeat(64),
  xlsx_sha256: "b".repeat(64),
  paid_at: null,
  voided_at: null,
  void_reason: "A".repeat(200),
  version: 2,
  items: [item(1), item(2), item(3)],
};
const batch = { id: BATCH_ID, pay_date: "2026-10-20", status: "closed", created_at: "2026-10-09T00:00:00.000Z", closed_at: "2026-10-10T00:00:00.000Z", closed_by: "22222222-2222-4222-8222-222222222222", paid_at: null, statement_count: 7, totals: [{ currency: "SGD", count: 7, total: money }], version: 2, statements: [] };

async function mockFinance(page: Page): Promise<void> {
  const reply = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  await page.route(`**/platform/v1/bank-files/${FILE_ID}`, (route) => route.fulfill(reply({ file })));
  await page.route(`**/platform/v1/payout-batches/${BATCH_ID}`, (route) => route.fulfill(reply({ batch })));
  await page.route(`**/platform/v1/payout-batches/${BATCH_ID}/bank-file-preview`, (route) => route.fulfill(reply({ preview })));
  await page.route("**/platform/v1/bank-files?*", (route) => route.fulfill(reply({ items: [{ ...file, items: undefined }] })));
}

/** 对话框整个在视口里，里面的内容不把它撑宽。 */
async function expectDialogFits(dialog: Locator, what: string): Promise<void> {
  await expect(dialog).toBeVisible();
  const fit = await dialog.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, right: box.right, viewport: document.documentElement.clientWidth, inner: element.scrollWidth - element.clientWidth };
  });
  expect(fit.left, `${what}：对话框左边超出视口`).toBeGreaterThanOrEqual(0);
  expect(fit.right, `${what}：对话框右边超出视口`).toBeLessThanOrEqual(fit.viewport);
  expect(fit.inner, `${what}：对话框里的内容横向溢出`).toBe(0);
}

test.describe("320px 宽度", () => {
  test("财务：批次的转账文件区、生成对话框（排除名单很长）；文件详情（指纹、超长名称）、回填和作废对话框都不溢出", async ({ page }) => {
    const admin = adminCredentials();
    await page.setViewportSize({ width: 1280, height: 900 });
    await loginAs(page, "platform", admin.email, admin.password);
    await mockFinance(page);
    await page.setViewportSize({ width: 320, height: 700 });

    await page.goto(`/platform/finance/payout-batches/${BATCH_ID}`);
    await expect(page.getByRole("region", { name: "SGD 的转账文件" })).toBeVisible();
    await expectNoHorizontalOverflow(page, "批次的转账文件区");
    await page.getByRole("button", { name: "生成 SGD 转账文件" }).click();
    const generate = page.getByRole("dialog", { name: "生成 SGD 转账文件" });
    await expectDialogFits(generate, "生成对话框");
    await expect(generate.getByRole("checkbox", { name: /确认这次不付/ })).not.toBeChecked();
    await generate.getByRole("button", { name: "取消" }).click();

    await page.goto(`/platform/finance/bank-files/${FILE_ID}`);
    await expect(page.getByRole("heading", { level: 1, name: /^转账文件 BF/ })).toBeVisible();
    await expectNoHorizontalOverflow(page, "文件详情");
    await page.getByRole("button", { name: "回填流水号" }).click();
    const payments = page.getByRole("dialog", { name: "回填银行流水号" });
    await expectDialogFits(payments, "回填对话框");
    await payments.getByRole("button", { name: "取消" }).click();
    await page.getByRole("button", { name: "作废" }).click();
    const voiding = page.getByRole("dialog", { name: "作废这个转账文件？" });
    await expectDialogFits(voiding, "作废对话框");
    await expect(voiding).toContainText("请先到银行撤销");
  });

  test("供应商：收款账户页（超长名称）、提交对话框、撤回对话框都不溢出；账号输入框不让浏览器记住", async ({ page, request }) => {
    const tenant = await createActiveTenant(request);
    await page.setViewportSize({ width: 1280, height: 900 });
    await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
    const account = { id: "f3f3f3f3-0000-4000-8000-000000000001", currency: "SGD", beneficiary_name: LONG, beneficiary_address: LONG, bank_name: LONG, bank_address: LONG, swift_bic: "FAKESGSGXXX", account_kind: "iban", account_masked: "•••• 9876", status: "pending", submitted_at: "2026-10-05T00:00:00.000Z", activated_at: null, superseded_at: null, rejected_at: null, reject_reason: LONG, withdrawn_at: null, version: 1 };
    await page.route("**/tenant/v1/payout-accounts", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [account] }) }));
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/statements/payout-accounts");
    await expect(page.getByRole("heading", { level: 1, name: "收款账户" })).toBeVisible();
    await expect(page.getByText("•••• 9876")).toBeVisible();
    await expectNoHorizontalOverflow(page, "供应商收款账户页");
    await page.getByRole("button", { name: "提交收款账户" }).click();
    const form = page.getByRole("dialog", { name: "提交收款账户" });
    await expectDialogFits(form, "提交对话框");
    await expect(form.getByRole("textbox", { name: /^银行账号/ })).toHaveAttribute("autocomplete", "off");
    await form.getByRole("button", { name: "取消" }).click();
    await page.getByRole("button", { name: "撤回 SGD 账户" }).click();
    await expectDialogFits(page.getByRole("dialog", { name: /撤回 SGD 账户/ }), "撤回对话框");
  });
});
