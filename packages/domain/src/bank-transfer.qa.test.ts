/**
 * M5-02 测试角色补的规则测试（ADR 0051）：校验函数用独立算法对照，文件文本用独立的 RFC 4180 解析器读回来核对。
 * 账号、IBAN、SWIFT、公司名都是这里现算的虚构值。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type BankFileContent,
  type BankFileItem,
  accountNumberIssue,
  accountRecentlyChanged,
  bankFileCsv,
  bankFileName,
  bankFileRows,
  bankFileSummaryRows,
  bankFileTotal,
  formatMajor,
  guardCsvFormula,
  ibanCheckDigits,
  isBankFileTemplate,
  isBankReference,
  isCurrencyCode,
  isValidIban,
  isValidSwiftBic,
  normalizeAccountNumber,
  normalizeSwiftText,
  paymentReference,
  payoutAccountIssues,
  statementFileIssue,
  sumMinor,
  swiftTextIssue,
} from "./index.ts";

const T = "swift-generic-v1" as const;

/** 独立于被测实现的 mod-97：直接用大整数算（ISO 13616）。 */
function oracleMod97(iban: string): bigint {
  const moved = `${iban.slice(4)}${iban.slice(0, 4)}`;
  const digits = [...moved].map((char) => (char >= "A" && char <= "Z" ? String(char.charCodeAt(0) - 55) : char)).join("");
  return BigInt(digits) % 97n;
}
function oracleIban(country: string, bban: string): string {
  const moved = `${bban}${country}00`;
  const digits = [...moved].map((char) => (char >= "A" && char <= "Z" ? String(char.charCodeAt(0) - 55) : char)).join("");
  return `${country}${String(98n - BigInt(digits) % 97n).padStart(2, "0")}${bban}`;
}

const LENGTHS: [string, number][] = [["GB", 22], ["DE", 22], ["FR", 27], ["NL", 18], ["NO", 15], ["BE", 16], ["MT", 31], ["LC", 32], ["RU", 33], ["SA", 24], ["AE", 23], ["CH", 21]];
const digitsBban = (length: number, seed: number): string => {
  let text = "";
  let state = seed;
  while (text.length < length) {
    state = (state * 48271) % 2147483647;
    text += String(state % 10);
  }
  return text;
};

test("IBAN：不同国家的长度都按登记表，校验位和独立算法算的一致", () => {
  for (const [country, length] of LENGTHS) {
    const iban = oracleIban(country, digitsBban(length - 4, length * 7 + 3));
    assert.equal(iban.length, length);
    assert.equal(iban.slice(2, 4), ibanCheckDigits(country, iban.slice(4)), country);
    assert.equal(isValidIban(iban), true, `${country} 合格`);
    assert.equal(isValidIban(oracleIban(country, digitsBban(length - 3, 11))), false, `${country} 多一位`);
    assert.equal(isValidIban(oracleIban(country, digitsBban(length - 5, 11))), false, `${country} 少一位`);
  }
});

test("IBAN：任何一位数字抄错、任何相邻两位错位都和独立算法判断一致；单个数字错一定被拒", () => {
  const iban = oracleIban("GB", `FAKE${digitsBban(14, 99)}`);
  assert.equal(isValidIban(iban), true);
  for (let i = 2; i < iban.length; i += 1) {
    const char = iban[i] as string;
    if (char >= "0" && char <= "9") {
      for (let digit = 0; digit <= 9; digit += 1) {
        if (String(digit) === char) continue;
        const typo = `${iban.slice(0, i)}${digit}${iban.slice(i + 1)}`;
        assert.equal(isValidIban(typo), false, `第 ${i} 位抄错：${typo}`);
      }
    }
    if (i + 1 < iban.length && iban[i] !== iban[i + 1]) {
      const swapped = `${iban.slice(0, i)}${iban[i + 1]}${iban[i]}${iban.slice(i + 2)}`;
      const shape = /^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(swapped);
      assert.equal(isValidIban(swapped), shape && oracleMod97(swapped) === 1n, `第 ${i} 位错位：${swapped}`);
    }
  }
});

test("IBAN：登记表外的国家、小写、带空格（规范化之前）、非字母数字、换行都拒绝", () => {
  const iban = oracleIban("GB", `FAKE${digitsBban(14, 5)}`);
  assert.equal(isValidIban(oracleIban("ZZ", digitsBban(18, 5))), false);
  assert.equal(isValidIban(oracleIban("JP", digitsBban(18, 5))), false, "日本不用 IBAN");
  assert.equal(isValidIban(iban.toLowerCase()), false);
  assert.equal(isValidIban(`${iban.slice(0, 4)} ${iban.slice(4)}`), false);
  assert.equal(isValidIban(`${iban}\n`), false);
  assert.equal(isValidIban(""), false);
  assert.equal(isValidIban(normalizeAccountNumber(` ${iban.slice(0, 4)} ${iban.slice(4, 8).toLowerCase()} ${iban.slice(8)}\t`)), true, "人按 4 位一组抄的，规范化后合格");
});

test("IBAN：校验位只能是 02–98。00、01、99 和 97、98、02 同余，抄错时 mod-97 查不出来（ISO 13616）", () => {
  // 找校验位分别是 02、98、97 的虚构号码，把校验位换成同余的 99、01、00
  const pairs: [string, string][] = [["02", "99"], ["98", "01"], ["97", "00"]];
  for (const [real, alias] of pairs) {
    let seed = 1;
    let iban = "";
    do {
      iban = oracleIban("GB", `FAKE${digitsBban(14, seed)}`);
      seed += 1;
    } while (iban.slice(2, 4) !== real);
    assert.equal(isValidIban(iban), true);
    assert.equal(isValidIban(`GB${alias}${iban.slice(4)}`), false, `校验位 ${alias} 不是合法的 IBAN（${real} 抄错成 ${alias}）`);
  }
});

test("SWIFT/BIC：8 和 11 位；9、10、12 位、小写、全角、换行、第 5–6 位不是字母都拒绝", () => {
  for (const good of ["FAKEJPJT", "FAKEJPJTXXX", "FAK3SGSG", "FAKESGSG0A1"]) assert.equal(isValidSwiftBic(good), true, good);
  for (const bad of ["FAKEJPJ", "FAKEJPJTX", "FAKEJPJTXX", "FAKEJPJTXXXX", "fakejpjt", "FAKE1PJT", "FAKEJ1JT", "FAKEJPJT\n", "\nFAKEJPJT", "FAKE JPJT", "ＦＡＫＥJPJT", "FAKE-PJT", ""]) assert.equal(isValidSwiftBic(bad), false, JSON.stringify(bad));
});

test("其他账号：长度边界 4 和 34；全角、零宽字符、符号都拒绝", () => {
  assert.equal(accountNumberIssue("account", "1234"), null);
  assert.equal(accountNumberIssue("account", "1".repeat(34)), null);
  assert.equal(accountNumberIssue("account", "123"), "ACCOUNT_FORMAT");
  assert.equal(accountNumberIssue("account", "1".repeat(35)), "ACCOUNT_FORMAT");
  assert.equal(accountNumberIssue("account", ""), "REQUIRED");
  for (const bad of ["1234\n", "１２３４", "12​34", "12,34", "12=34", "12'34", "12\"34"]) assert.equal(accountNumberIssue("account", normalizeAccountNumber(bad)) === null && !/\n/.test(bad), false, JSON.stringify(bad));
});

test("账号规范化不能把一个字符变成另一个账号：ß、ı、ſ、ﬁ 转大写后变成 SS、I、S、FI，应该拒绝而不是静默改写", () => {
  for (const typed of ["1234ß5678", "1234ı5678", "1234ſ5678", "1234ﬁ5678"]) {
    assert.equal(accountNumberIssue("account", normalizeAccountNumber(typed)), "ACCOUNT_FORMAT", `${JSON.stringify(typed)} 规范化成了 ${normalizeAccountNumber(typed)}`);
  }
});

test("SWIFT 文字：能错位字段的字符（换行、回车、制表符、引号、分号）和公式符号（= @）都拒绝；末尾换行也拒绝", () => {
  for (const bad of ["Fictional\nCo", "Fictional\r\nCo", "Fictional\tCo", "Fictional\nCo\n", "Fictional\"Co", "Fictional;Co", "A=B", "=A", "@A", "A&B", "A<B>", "A_B", "A%B", "A#B", "虚构车队", "Ｆictional", " Co"]) {
    assert.equal(swiftTextIssue(bad, 70), "CHARSET", JSON.stringify(bad));
  }
  assert.equal(swiftTextIssue("-Co", 70), "LEADING");
  assert.equal(swiftTextIssue(":Co", 70), "LEADING");
  assert.equal(swiftTextIssue("A".repeat(70), 70), null);
  assert.equal(swiftTextIssue("A".repeat(71), 70), "TOO_LONG");
  assert.equal(normalizeSwiftText(" Fictional\r\n\t Co  Ltd "), "Fictional Co Ltd", "提交时先整理：换行不会留到校验之后");
});

test("3 位小数和不支持的币种：不算受支持；账单明确拒绝，账户提交也拒绝", () => {
  for (const code of ["KWD", "BHD", "OMR", "EUR", "jpy", "constructor", "__proto__", "toString", ""]) assert.equal(isCurrencyCode(code), false, code);
  assert.equal(statementFileIssue({ status: "in_payout", approvalId: "x", totalMinor: 1234, currency: "KWD" }, { active: null, hasPending: false }), "CURRENCY_UNSUPPORTED");
  const issues = payoutAccountIssues({ currency: "KWD", beneficiaryName: "A", beneficiaryAddress: "B", bankName: "C", bankAddress: "D", swiftBic: "FAKEKWKW", accountKind: "account", accountNumber: "12345678" });
  assert.deepEqual(issues, [{ path: "/currency", reason: "UNSUPPORTED_CURRENCY" }]);
});

test("金额换算：0、0.01、大额、无小数位都按字符换算；小数、NaN、无穷、超安全整数都拒绝，不会静默四舍五入", () => {
  const cases: [number, "JPY" | "KRW" | "SGD" | "USD", string][] = [
    [0, "JPY", "0"], [1, "JPY", "1"], [12_000, "JPY", "12000"], [1_000_000_000, "KRW", "1000000000"],
    [0, "SGD", "0.00"], [1, "SGD", "0.01"], [10, "USD", "0.10"], [99, "USD", "0.99"], [100, "SGD", "1.00"], [123_450, "SGD", "1234.50"], [100_000_000_000, "USD", "1000000000.00"],
    [Number.MAX_SAFE_INTEGER, "USD", "90071992547409.91"], [Number.MAX_SAFE_INTEGER, "JPY", "9007199254740991"],
  ];
  for (const [minor, currency, expected] of cases) assert.equal(formatMajor(minor, currency), expected, `${minor} ${currency}`);
  for (const bad of [0.5, 1.1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => formatMajor(bad, "SGD"), RangeError, String(bad));
    assert.throws(() => bankFileTotal([{ amountMinor: bad }]), RangeError, String(bad));
  }
  assert.throws(() => sumMinor([Number.MAX_SAFE_INTEGER, 1]), RangeError, "合计超出安全整数要报错，不能丢精度");
});

test("账单能不能进文件：金额边界 1、0、负数；顺序先看状态", () => {
  const account = { beneficiaryName: "Fictional Co", beneficiaryAddress: "1 Example Road", bankName: "Fictional Bank", bankAddress: "2 Sample St", swiftBic: "FAKESGSG" };
  const statement = { status: "in_payout", approvalId: "x", currency: "SGD" };
  assert.equal(statementFileIssue({ ...statement, totalMinor: 1 }, { active: account, hasPending: false }), null);
  assert.equal(statementFileIssue({ ...statement, totalMinor: 0 }, { active: account, hasPending: false }), "NON_POSITIVE_AMOUNT");
  assert.equal(statementFileIssue({ ...statement, totalMinor: -1 }, { active: account, hasPending: false }), "NON_POSITIVE_AMOUNT");
  assert.equal(statementFileIssue({ ...statement, status: "paid", totalMinor: 1 }, { active: account, hasPending: false }), "NOT_APPROVED", "已付款的不会再进");
  assert.equal(statementFileIssue({ ...statement, approvalId: null, totalMinor: 1 }, { active: account, hasPending: false }), "NOT_APPROVED");
  assert.equal(statementFileIssue({ ...statement, totalMinor: 1 }, { active: { ...account, swiftBic: "BAD" }, hasPending: true }), "ACCOUNT_INVALID", "有待审核的也不能用坏的生效账户");
});

// ---- 文件文本 ----

/** 独立的 RFC 4180 解析器：字段可含逗号、引号、换行；行尾只认 CRLF。 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] as string;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i += 1;
    } else {
      assert.ok(char !== "\r" && char !== "\n" && char !== '"', `引号之外不能有裸的回车、换行、引号（第 ${i} 个字符）`);
      cell += char;
    }
  }
  assert.equal(cell, "");
  assert.equal(row.length, 0, "文件以 CRLF 结束");
  return rows;
}

const item = (over: Partial<BankFileItem> = {}): BankFileItem => ({ beneficiaryName: "Fictional Transport", beneficiaryAddress: "1 Example Road", bankName: "Fictional Bank", bankAddress: "2 Sample St", swiftBic: "FAKESGSG", accountNumber: "0012349876", amountMinor: 123_450, reference: paymentReference("ST202609ABCDEFGH", "2026-09"), ...over });
const file = (items: BankFileItem[], over: Partial<BankFileContent> = {}): BankFileContent => ({ fileNo: "BF20261020ABCDEFGH", payDate: "2026-10-20", currency: "SGD", chargeBearer: "SHA", generatedAt: "2026-10-11T00:00:00.000Z", items, ...over });

test("CSV 结构：只有开头一个 BOM；全部 CRLF；任何字段内容都读得回原样，行数、列数不错位", () => {
  const nasty = ['Comma, Co', 'Quote " Co', 'Line\nFeed', 'Carriage\rReturn', 'CR\r\nLF', '"', '""', ',', 'x\r\n', ' leading space', 'trailing space '];
  const items = nasty.map((text) => item({ beneficiaryName: text, beneficiaryAddress: text, bankName: text, bankAddress: text }));
  const content = file(items);
  const text = bankFileCsv(T, content);
  assert.equal(text.charCodeAt(0), 0xfeff);
  assert.equal(text.indexOf("﻿", 1), -1, "只有一个 BOM");
  const rows = parseCsv(text.slice(1));
  assert.equal(rows.length, nasty.length + 2, "列头 + 每笔 + 合计");
  for (const row of rows) assert.equal(row.length, 12, "每行 12 列");
  nasty.forEach((value, index) => {
    const row = rows[index + 1] as string[];
    for (const column of [1, 2, 3, 4]) assert.equal(row[column], value);
    assert.equal(row[6], "0012349876", "账号那一列没有错位");
    assert.equal(row[8], "1234.50", "金额那一列没有错位");
  });
});

test("公式注入：= + - @ 制表符、回车、全角开头的每一列都加单引号；账号那一列也防；中间出现的不加", () => {
  for (const lead of ["=", "+", "-", "@", "\t", "\r", "＝", "＋", "－", "＠"]) {
    const payload = `${lead}cmd|'/C calc'!A0`;
    const rows = parseCsv(bankFileCsv(T, file([item({ beneficiaryName: payload, beneficiaryAddress: payload, bankName: payload, bankAddress: payload, swiftBic: payload, accountNumber: payload, reference: payload })])).slice(1));
    const row = rows[1] as string[];
    for (const column of [1, 2, 3, 4, 5, 6, 10]) assert.equal(row[column], `'${payload}`, `${JSON.stringify(lead)} 第 ${column} 列`);
  }
  assert.equal(guardCsvFormula("A=1+1@x-y"), "A=1+1@x-y");
  assert.equal(guardCsvFormula("0012349876"), "0012349876", "账号开头的 0 不动");
});

test("公式注入：换行开头（OWASP 列出的第七种前导字符）也要加单引号", () => {
  assert.equal(guardCsvFormula("\n=1+1"), "'\n=1+1");
});

test("合计：合计行等于各行金额相加，大额也不丢分；0.10 + 0.20 正好是 0.30（不用浮点）", () => {
  const amounts = [10, 20, 1, 99, 100_000_000_001, 7];
  const content = file(amounts.map((amountMinor) => item({ amountMinor })));
  const rows = parseCsv(bankFileCsv(T, content).slice(1));
  const body = rows.slice(1, -1);
  assert.deepEqual(body.map((row) => row[0]), ["1", "2", "3", "4", "5", "6"], "序号从 1 开始连续");
  const cents = body.map((row) => BigInt((row[8] as string).replace(".", "")));
  const total = cents.reduce((sum, value) => sum + value, 0n);
  const trailer = rows.at(-1) as string[];
  assert.equal(BigInt((trailer[8] as string).replace(".", "")), total);
  assert.equal(trailer[8], "1000000001.38");
  assert.deepEqual([trailer[0], trailer[7], trailer[10]], ["TOTAL", "SGD", "6 PAYMENTS"]);
  assert.equal(formatMajor(bankFileTotal([{ amountMinor: 10 }, { amountMinor: 20 }]), "USD"), "0.30");
  const summary = Object.fromEntries(bankFileSummaryRows(T, content));
  assert.equal(summary["Total Amount"], trailer[8], "Excel 的汇总和 CSV 的合计一致");
  assert.equal(summary["Payments"], "6");
});

test("币种不串：每一行都是文件的币种；JPY 没有小数点，SGD 有两位", () => {
  const jpy = parseCsv(bankFileCsv(T, file([item({ amountMinor: 12_000 })], { currency: "JPY" })).slice(1));
  assert.deepEqual([jpy[1]?.[7], jpy[1]?.[8], jpy[2]?.[7], jpy[2]?.[8]], ["JPY", "12000", "JPY", "12000"]);
  const sgd = parseCsv(bankFileCsv(T, file([item({ amountMinor: 12_000 })], { currency: "SGD" })).slice(1));
  assert.deepEqual([sgd[1]?.[7], sgd[1]?.[8], sgd[2]?.[7], sgd[2]?.[8]], ["SGD", "120.00", "SGD", "120.00"]);
});

test("没有账单的合计是 0；模板名不能是原型上的键；同样内容的 CSV 和表格行一致", () => {
  const rows = bankFileRows(T, file([]));
  assert.equal(rows.length, 2);
  assert.equal(rows[1]?.[8], "0.00");
  for (const key of ["__proto__", "constructor", "toString", "swift-generic-v2", ""]) assert.equal(isBankFileTemplate(key), false, key);
  assert.equal(isBankFileTemplate(T), true);
  const content = file([item()]);
  assert.deepEqual(parseCsv(bankFileCsv(T, content).slice(1)), bankFileRows(T, content));
});

test("文件名没有账号、名称；流水号的边界：64 / 65 位、前导符号、空白、换行、中文", () => {
  const name = bankFileName({ payDate: "2026-10-20", currency: "SGD", fileNo: "BF20261020ABCDEFGH" }, "xlsx");
  assert.equal(name, "nozomi-bank-transfer-2026-10-20-SGD-BF20261020ABCDEFGH.xlsx");
  assert.match(name, /^[A-Za-z0-9.-]+$/, "响应头里不会有要转义的字符");
  assert.equal(isBankReference("A".repeat(64)), true);
  assert.equal(isBankReference("FT-26/293_A.1:2"), true);
  for (const bad of ["", "A".repeat(65), "-FT1", "=FT1", "+FT1", "@FT1", "'FT1", " FT1", "FT 1", "FT1\n", "FT1\r\n", "FT\t1", "流水1", "ＦＴ１", 'FT"1', "FT,1", "FT<1"]) assert.equal(isBankReference(bad), false, JSON.stringify(bad));
});

test("账户最近变更的边界：刚好 7 天不算，差 1 毫秒算；第一次填的、没批准的不算；跨月、跨午夜都按绝对时间", () => {
  const activatedAt = new Date("2026-10-28T15:30:00.000Z");
  const day = 24 * 3_600_000;
  assert.equal(accountRecentlyChanged({ activatedAt, replacedPrevious: true }, new Date(activatedAt.getTime() + 7 * day - 1)), true);
  assert.equal(accountRecentlyChanged({ activatedAt, replacedPrevious: true }, new Date(activatedAt.getTime() + 7 * day)), false);
  assert.equal(accountRecentlyChanged({ activatedAt, replacedPrevious: false }, activatedAt), false);
  assert.equal(accountRecentlyChanged({ activatedAt: null, replacedPrevious: true }, activatedAt), false);
  assert.equal(accountRecentlyChanged({ activatedAt, replacedPrevious: true }, new Date("2026-11-01T00:00:00.000Z")), true, "跨月");
});
