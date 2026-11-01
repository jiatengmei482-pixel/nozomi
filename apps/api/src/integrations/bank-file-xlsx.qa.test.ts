/**
 * M5-02 测试角色补的单元测试（ADR 0051）：转账文件的 Excel 输出。用 @nozomi/domain 的模板出行，经真实的写入器，再解压看 XML。账号、名称都是虚构的。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { type BankFileContent, type BankFileItem, bankFileColumnWidths, bankFileRows, bankFileSummaryRows, paymentReference } from "@nozomi/domain";
import { guardFormula, readXlsxSheet, writeXlsx } from "./xlsx.ts";
import { unzipEntry } from "./zip.ts";

const T = "swift-generic-v1" as const;
const item = (over: Partial<BankFileItem> = {}): BankFileItem => ({ beneficiaryName: "Fictional Transport", beneficiaryAddress: "1 Example Road", bankName: "Fictional Bank", bankAddress: "2 Sample St", swiftBic: "FAKESGSG", accountNumber: "0012349876", amountMinor: 123_450, reference: paymentReference("ST202609ABCDEFGH", "2026-09"), ...over });
const content = (items: BankFileItem[]): BankFileContent => ({ fileNo: "BF20261020ABCDEFGH", payDate: "2026-10-20", currency: "SGD", chargeBearer: "SHA", generatedAt: "2026-10-11T00:00:00.000Z", items });
const workbook = (file: BankFileContent): Buffer =>
  writeXlsx([
    { name: "Payments", rows: bankFileRows(T, file), header: true, columnWidths: bankFileColumnWidths(T) },
    { name: "Summary", rows: bankFileSummaryRows(T, file), columnWidths: [18, 44] },
  ]);
const sheetXml = (bytes: Buffer, n = 1): string => unzipEntry(bytes, `xl/worksheets/sheet${n}.xml`).toString("utf8");

test("每个单元格都是行内文字：没有数字单元格、没有公式；账号前导零、长数字不变；金额是字符串", () => {
  const long = "1234567890123456789012345678901234";
  const bytes = workbook(content([item({ accountNumber: "0000000012" }), item({ accountNumber: long, amountMinor: 1 })]));
  const xml = sheetXml(bytes);
  assert.ok(!xml.includes("<f>") && !xml.includes("<f "), "没有公式");
  assert.ok(!xml.includes("<v>"), "没有数值单元格");
  for (const match of xml.matchAll(/<c [^>]*>/g)) assert.match(match[0], /t="inlineStr"/, match[0]);
  const sheet = readXlsxSheet(bytes);
  assert.deepEqual(sheet.rows[1]?.[6], { type: "text", text: "0000000012" });
  assert.deepEqual(sheet.rows[2]?.[6], { type: "text", text: long });
  assert.deepEqual(sheet.rows[2]?.[8], { type: "text", text: "0.01" });
  assert.deepEqual(sheet.rows[3]?.[8], { type: "text", text: "1234.51" }, "合计行也是文字");
});

test("XML 注入：尖括号、& 、引号、CDATA、闭合标签都被转义，读回来原样；控制字符去掉后文件仍合法", () => {
  const payloads = ['</t></is></c><c t="str"><f>HYPERLINK("http://evil.example")</f>', "<![CDATA[x]]>", "A & B", 'He said "x"', "&lt;already", "]]>"];
  const bytes = workbook(content(payloads.map((text) => item({ beneficiaryName: text, bankName: text }))));
  const xml = sheetXml(bytes);
  assert.ok(!xml.includes("<f>"), "注入的公式没有变成标签");
  assert.ok(!xml.includes("<![CDATA["));
  const sheet = readXlsxSheet(bytes);
  payloads.forEach((text, index) => assert.deepEqual(sheet.rows[index + 1]?.[1], { type: "text", text }));

  const control = workbook(content([item({ beneficiaryName: "Fic\u0000tio\u0008nal\u000bCo\u001f" })]));
  assert.doesNotMatch(sheetXml(control), /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/);
  assert.deepEqual(readXlsxSheet(control).rows[1]?.[1], { type: "text", text: "FictionalCo" });
});

test("公式注入：= + - @ 制表符、回车开头的单元格在 Excel 里前面有单引号", () => {
  for (const lead of ["=", "+", "-", "@", "\t", "\r"]) {
    const payload = `${lead}1+1`;
    assert.equal(guardFormula(payload), `'${payload}`, JSON.stringify(lead));
  }
  assert.ok(sheetXml(workbook(content([item({ beneficiaryName: "=1+1" })]))).includes(">'=1+1<"));
});

test("公式注入：全角的 ＝＋－＠ 开头，Excel 和 CSV 一样要加单引号（ADR 0051 第 1 节写的「CSV 和 Excel 都防」）", () => {
  for (const lead of ["＝", "＋", "－", "＠"]) assert.equal(guardFormula(`${lead}1+1`), `'${lead}1+1`, lead);
});

test("同样的内容逐字节相同（SHA-256 才能核对）；内容差一个字符就不同", () => {
  const file = content([item()]);
  assert.ok(workbook(file).equals(workbook(file)));
  assert.ok(!workbook(file).equals(workbook(content([item({ accountNumber: "0012349877" })]))));
});
