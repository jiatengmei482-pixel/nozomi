import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BANK_FILE_TEMPLATES,
  type BankFileContent,
  accountLast4,
  accountNumberIssue,
  accountRecentlyChanged,
  bankFileCsv,
  bankFileName,
  bankFileRows,
  bankFileSummaryRows,
  guardCsvFormula,
  ibanCheckDigits,
  isBankReference,
  isValidIban,
  isValidSwiftBic,
  maskAccount,
  normalizeAccountNumber,
  normalizeSwiftText,
  paymentReference,
  payoutAccountIssues,
  statementFileIssue,
  swiftTextIssue,
} from "./bank-transfer.ts";

/** 虚构的 IBAN：BBAN 随便写，校验位用公开算法现算。 */
function fakeIban(country: string, bban: string): string {
  return `${country}${ibanCheckDigits(country, bban)}${bban}`;
}

const FAKE_ACCOUNT = { beneficiaryName: "Fictional Transport Pte Ltd", beneficiaryAddress: "1 Example Road, Testville", bankName: "Fictional Bank", bankAddress: "2 Sample Street, Testville", swiftBic: "FAKESGSGXXX" };

const item = (over: Partial<BankFileContent["items"][number]> = {}): BankFileContent["items"][number] => ({
  ...FAKE_ACCOUNT,
  accountNumber: "0012340000",
  amountMinor: 123_450,
  reference: paymentReference("ST202609AAAAAAAA", "2026-09"),
  ...over,
});

const file = (over: Partial<BankFileContent> = {}): BankFileContent => ({
  fileNo: "BF20261020AAAAAAAA",
  payDate: "2026-10-20",
  currency: "SGD",
  chargeBearer: "SHA",
  generatedAt: "2026-10-15T00:00:00.000Z",
  items: [item()],
  ...over,
});

test("账号规范化：去空格连字符、转大写；末 4 位和打码", () => {
  assert.equal(normalizeAccountNumber(" gb00 fake-0000 1234 "), "GB00FAKE00001234");
  assert.equal(accountLast4("GB00FAKE00001234"), "1234");
  assert.equal(maskAccount("1234"), "•••• 1234");
});

test("IBAN：国家、长度、校验位都要对；任何一位抄错都算出来", () => {
  const good = fakeIban("GB", "FAKE00000000000001");
  assert.equal(good.length, 22);
  assert.equal(isValidIban(good), true);
  // 公开文档里的示例算法结果：校验位计算和验证自洽（各国长度不同）
  for (const [country, bban] of [["DE", "000000000000000001"], ["FR", "00000000000000000000001"], ["NO", "00000000001"], ["MT", "FAKE00000000000000000000001"]] as const) {
    assert.equal(isValidIban(fakeIban(country, bban)), true, country);
  }
  // ISO 13616 的公开算法样例
  assert.equal(ibanCheckDigits("GB", "WEST12345698765432"), "82");
  assert.equal(isValidIban(good.slice(0, -1) + (good.endsWith("1") ? "2" : "1")), false, "末位抄错");
  assert.equal(isValidIban(`GB${good.slice(2, 4) === "00" ? "01" : "00"}${good.slice(4)}`), false, "校验位错");
  assert.equal(isValidIban(good.slice(0, -1)), false, "长度不对");
  assert.equal(isValidIban(fakeIban("ZZ", "FAKE0000")), false, "国家不在登记表");
  assert.equal(isValidIban("GB82-FAKE"), false, "没规范化的不认");
  assert.equal(isValidIban(""), false);
  assert.equal(isValidIban("gb82west12345698765432"), false, "小写不认（要先规范化）");
});

test("SWIFT/BIC：8 或 11 位、第 5–6 位是字母", () => {
  for (const bic of ["FAKEJPJT", "FAKESGSGXXX", "F4KEUS33"]) assert.equal(isValidSwiftBic(bic), true, bic);
  for (const bic of ["", "FAKEJP", "FAKEJPJTX", "FAKEJPJTXX", "FAKEJPJTXXXX", "FAKE12JT", "fakejpjt", "FAKE JPJT"]) assert.equal(isValidSwiftBic(bic), false, bic);
});

test("其他账号：4–34 位字母数字；IBAN 走校验位", () => {
  assert.equal(accountNumberIssue("account", ""), "REQUIRED");
  assert.equal(accountNumberIssue("account", "123"), "ACCOUNT_FORMAT");
  assert.equal(accountNumberIssue("account", "1234"), null);
  assert.equal(accountNumberIssue("account", "0".repeat(34)), null);
  assert.equal(accountNumberIssue("account", "0".repeat(35)), "ACCOUNT_FORMAT");
  assert.equal(accountNumberIssue("account", "12.34"), "ACCOUNT_FORMAT");
  assert.equal(accountNumberIssue("iban", "1234"), "IBAN_INVALID");
  assert.equal(accountNumberIssue("iban", fakeIban("GB", "FAKE00000000000001")), null);
});

test("SWIFT 字符集：拒绝中文和 &；不能以 - : 开头；长度上限；空白整理", () => {
  assert.equal(swiftTextIssue("Fictional Transport (S) Pte. Ltd.", 70), null);
  assert.equal(swiftTextIssue("", 70), "REQUIRED");
  assert.equal(swiftTextIssue("甲车队", 70), "CHARSET");
  assert.equal(swiftTextIssue("A&B Co", 70), "CHARSET");
  assert.equal(swiftTextIssue("=HYPERLINK(1)", 70), "CHARSET");
  assert.equal(swiftTextIssue("@evil", 70), "CHARSET");
  assert.equal(swiftTextIssue("line\nbreak", 70), "CHARSET");
  assert.equal(swiftTextIssue("-dash", 70), "LEADING");
  assert.equal(swiftTextIssue(":colon", 70), "LEADING");
  assert.equal(swiftTextIssue("x".repeat(71), 70), "TOO_LONG");
  assert.equal(normalizeSwiftText("  A   B\tC "), "A B C");
});

test("提交账户的校验：逐项给出路径和原因，不回显账号", () => {
  assert.deepEqual(payoutAccountIssues({ ...FAKE_ACCOUNT, currency: "SGD", accountKind: "account", accountNumber: "00123456" }), []);
  const issues = payoutAccountIssues({ beneficiaryName: "甲", beneficiaryAddress: "", bankName: "B&B", bankAddress: "x".repeat(106), swiftBic: "NOPE", currency: "EUR", accountKind: "iban", accountNumber: "GB00SECRET" });
  assert.deepEqual(issues, [
    { path: "/beneficiary_name", reason: "CHARSET" },
    { path: "/beneficiary_address", reason: "REQUIRED" },
    { path: "/bank_name", reason: "CHARSET" },
    { path: "/bank_address", reason: "TOO_LONG" },
    { path: "/swift_bic", reason: "SWIFT_BIC_INVALID" },
    { path: "/currency", reason: "UNSUPPORTED_CURRENCY" },
    { path: "/account_number", reason: "IBAN_INVALID" },
  ]);
  assert.ok(!JSON.stringify(issues).includes("SECRET"));
});

test("账单能不能进文件：按顺序判断", () => {
  const ok = { status: "in_payout", approvalId: "a", totalMinor: 100, currency: "SGD" };
  const accounts = { active: FAKE_ACCOUNT, hasPending: false };
  assert.equal(statementFileIssue(ok, accounts), null);
  assert.equal(statementFileIssue({ ...ok, status: "confirmed" }, accounts), "NOT_APPROVED");
  assert.equal(statementFileIssue({ ...ok, approvalId: null }, accounts), "NOT_APPROVED");
  assert.equal(statementFileIssue({ ...ok, totalMinor: 0 }, accounts), "NON_POSITIVE_AMOUNT");
  assert.equal(statementFileIssue({ ...ok, totalMinor: -5 }, accounts), "NON_POSITIVE_AMOUNT");
  assert.equal(statementFileIssue({ ...ok, currency: "EUR" }, accounts), "CURRENCY_UNSUPPORTED");
  assert.equal(statementFileIssue(ok, { active: null, hasPending: false }), "ACCOUNT_MISSING");
  assert.equal(statementFileIssue(ok, { active: null, hasPending: true }), "ACCOUNT_PENDING");
  assert.equal(statementFileIssue(ok, { active: { ...FAKE_ACCOUNT, beneficiaryName: "甲" }, hasPending: false }), "ACCOUNT_INVALID");
});

test("账户最近变更：替换了旧账户且不到 7 天才算", () => {
  const now = new Date("2026-10-15T00:00:00Z");
  const days = (n: number): Date => new Date(now.getTime() - n * 24 * 3_600_000);
  assert.equal(accountRecentlyChanged({ activatedAt: days(6), replacedPrevious: true }, now), true);
  assert.equal(accountRecentlyChanged({ activatedAt: days(7), replacedPrevious: true }, now), false);
  assert.equal(accountRecentlyChanged({ activatedAt: days(1), replacedPrevious: false }, now), false);
  assert.equal(accountRecentlyChanged({ activatedAt: null, replacedPrevious: true }, now), false);
});

test("流水号：可见字符、长度上限；付款参考在 SWIFT 字符集内", () => {
  for (const good of ["FT26293ABC", "2026/10/20-001", "A"]) assert.equal(isBankReference(good), true, good);
  for (const bad of ["", " x", "=1+1", "a b", "<x>", "x".repeat(65), "-1"]) assert.equal(isBankReference(bad), false, bad);
  assert.equal(swiftTextIssue(paymentReference("ST202609AAAAAAAA", "2026-09"), 140), null);
});

test("金额按币种小数位输出字符串：JPY 0 位、SGD / USD 2 位，合计是整数相加", () => {
  const amountOf = (content: BankFileContent): string[] => bankFileRows("swift-generic-v1", content).map((row) => row[8] as string);
  assert.deepEqual(amountOf(file({ currency: "JPY", items: [item({ amountMinor: 12_000 }), item({ amountMinor: 1 })] })), ["Amount", "12000", "1", "12001"]);
  assert.deepEqual(amountOf(file({ items: [item({ amountMinor: 123_450 }), item({ amountMinor: 5 })] })), ["Amount", "1234.50", "0.05", "1234.55"]);
  // 浮点会算错的和：0.10 + 0.20
  assert.deepEqual(amountOf(file({ currency: "USD", items: [item({ amountMinor: 10 }), item({ amountMinor: 20 })] })), ["Amount", "0.10", "0.20", "0.30"]);
  assert.throws(() => bankFileRows("swift-generic-v1", file({ items: [item({ amountMinor: 1.5 })] })), RangeError);
});

test("列定义：负责人要的 SWIFT 字段都有，合计行对得上", () => {
  const rows = bankFileRows("swift-generic-v1", file({ items: [item(), item({ amountMinor: 50 })] }));
  assert.deepEqual(rows[0], ["Seq", "Beneficiary Name", "Beneficiary Address", "Bank Name", "Bank Address", "SWIFT/BIC", "Account No/IBAN", "Currency", "Amount", "Value Date", "Payment Reference", "Charges"]);
  assert.deepEqual(rows[1], ["1", FAKE_ACCOUNT.beneficiaryName, FAKE_ACCOUNT.beneficiaryAddress, FAKE_ACCOUNT.bankName, FAKE_ACCOUNT.bankAddress, FAKE_ACCOUNT.swiftBic, "0012340000", "SGD", "1234.50", "2026-10-20", "NOZOMI ST202609AAAAAAAA SETTLEMENT 2026-09", "SHA"]);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[3], ["TOTAL", "", "", "", "", "", "", "SGD", "1235.00", "", "2 PAYMENTS", ""]);
  assert.equal(BANK_FILE_TEMPLATES["swift-generic-v1"].columns.length, rows[0]?.length);
});

test("CSV：UTF-8 BOM、CRLF、逗号和引号按 RFC 4180；账号开头的 0 不丢", () => {
  const csv = bankFileCsv("swift-generic-v1", file({ items: [item({ beneficiaryName: "Fictional, Inc", bankName: 'He said "x"' })] }));
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.ok(csv.endsWith("\r\n"));
  const lines = csv.slice(1).split("\r\n");
  assert.equal(lines.length, 4, "列头、一笔、合计、末尾换行");
  assert.ok(lines[1]?.startsWith('1,"Fictional, Inc",'));
  assert.ok(lines[1]?.includes('"He said ""x"""'));
  assert.ok(lines[1]?.includes(",0012340000,"));
  assert.ok(lines[1]?.includes(",1234.50,"));
});

test("公式注入：以 = + - @ 制表符、回车、全角符号开头的都加单引号；别的不动", () => {
  for (const text of ["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx", "＝1", "＋1", "－1", "＠x"]) assert.equal(guardCsvFormula(text), `'${text}`, text);
  for (const text of ["abc", "1234.50", "", "a=1", "'x"]) assert.equal(guardCsvFormula(text), text, text);
  const csv = bankFileCsv("swift-generic-v1", file({ items: [item({ beneficiaryName: "=cmd|'/c calc'!A0", bankAddress: "@x,y" })] }));
  assert.ok(csv.includes(",'=cmd|'/c calc'!A0,"));
  assert.ok(csv.includes(`,"'@x,y",`));
});

test("同样的内容每次生成都一样（哈希才能核对）；Summary 用生成时间", () => {
  assert.equal(bankFileCsv("swift-generic-v1", file()), bankFileCsv("swift-generic-v1", file()));
  const summary = Object.fromEntries(bankFileSummaryRows("swift-generic-v1", file({ items: [item(), item()] })));
  assert.deepEqual(summary, { "File No": "BF20261020AAAAAAAA", "Value Date": "2026-10-20", Currency: "SGD", Payments: "2", "Total Amount": "2469.00", Charges: "SHA", Template: "swift-generic-v1", "Generated At": "2026-10-15T00:00:00.000Z" });
});

test("文件名只有日期、币种、文件号", () => {
  assert.equal(bankFileName({ payDate: "2026-10-20", currency: "SGD", fileNo: "BF20261020AAAAAAAA" }, "csv"), "nozomi-bank-transfer-2026-10-20-SGD-BF20261020AAAAAAAA.csv");
});
