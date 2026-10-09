/** M1-05：表格里人填的数字和日期。全程按字符处理：金额不经过浮点数，写不尽的小数不会被悄悄四舍五入。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMajor } from "./money.ts";
import { plainDecimal, plainInteger, sheetDate } from "./spreadsheet.ts";

test("数字写成普通的十进制字符串：千分位、首尾空白、科学计数、多余的 0 都处理掉，值一位不改", () => {
  const cases: [string, string | null][] = [
    ["12000", "12000"], [" 12000 ", "12000"], ["12,000", "12000"], ["1,234,567.50", "1234567.5"], ["12000.00", "12000"], ["0.10", "0.1"], ["007", "7"], ["+5", "5"], ["-0.5", "-0.5"], ["-0", "0"], ["0.0", "0"],
    ["1.2E+4", "12000"], ["1.2e4", "12000"], ["1.25E+1", "12.5"], ["5E-1", "0.5"], ["1.5E-3", "0.0015"], ["12345E-2", "123.45"], ["1E0", "1"], ["9.8E+4", "98000"],
    ["0.30000000000000004", "0.30000000000000004"], ["123.456", "123.456"],
    ["", null], ["abc", null], ["12a", null], ["1.2.3", null], [".5", null], ["5.", null], ["１２３", null], ["1e", null], ["0x10", null], ["1,23", null], ["Infinity", null], ["1E400", null], ["12 000", null], ["--1", null],
  ];
  for (const [input, expected] of cases) assert.equal(plainDecimal(input), expected, JSON.stringify(input));
  assert.equal(plainDecimal(`1${"0".repeat(40)}`), null, "位数太多");
});

test("整数：只接受值是整数的写法", () => {
  assert.deepEqual(["10", "10.0", "1E+1", "0", "-3", "1,000"].map(plainInteger), [10, 10, 10, 0, -3, 1000]);
  assert.deepEqual(["10.5", "abc", "", "1E-1", "99999999999999999999"].map(plainInteger), [null, null, null, null, null]);
});

test("金额：表格里填主单位（日元整数、美元两位小数），换成最小货币单位的整数；小数位超过币种精度的报错，不四舍五入", () => {
  const minor = (text: string, currency: "JPY" | "USD"): number | string => {
    const plain = plainDecimal(text);
    if (plain === null) return "NOT_A_NUMBER";
    try {
      return parseMajor(plain, currency);
    } catch {
      return "PRECISION";
    }
  };
  assert.deepEqual([minor("20000", "JPY"), minor("20,000", "JPY"), minor("20000.00", "JPY"), minor("2E+4", "JPY")], [20_000, 20_000, 20_000, 20_000]);
  assert.deepEqual([minor("20000.5", "JPY"), minor("0.30000000000000004", "JPY")], ["PRECISION", "PRECISION"], "日元没有小数");
  assert.deepEqual([minor("123.45", "USD"), minor("123.4", "USD"), minor("123", "USD"), minor("0.01", "USD"), minor("1.2345E+2", "USD")], [12_345, 12_340, 12_300, 1, 12_345]);
  assert.deepEqual([minor("123.456", "USD"), minor("0.30000000000000004", "USD"), minor("19.999999999999996", "USD")], ["PRECISION", "PRECISION", "PRECISION"]);
  // 浮点数会算错的那些值，按字符处理没有问题
  assert.deepEqual([minor("0.29", "USD"), minor("1.005", "USD"), minor("4.35", "USD"), minor("1.15", "USD"), minor("8.2", "USD")], [29, "PRECISION", 435, 115, 820]);
  assert.equal(minor("90071992547409.93", "USD"), "PRECISION", "超出安全整数的范围");
});

test("日期：横线、斜线、点的写法，和 Excel 把日期存成的序号；不存在的日期、认不出的写法是 null", () => {
  assert.deepEqual(["2026-10-01", "2026/10/1", "2026.10.01", " 2026-1-5 ", "2028-02-29"].map(sheetDate), ["2026-10-01", "2026-10-01", "2026-10-01", "2026-01-05", "2028-02-29"]);
  assert.deepEqual(["46296", "46296.0", "61", "45658", "36526"].map(sheetDate), ["2026-10-01", "2026-10-01", "1900-03-01", "2025-01-01", "2000-01-01"]);
  for (const bad of ["2026-02-30", "10/01/2026", "2026年10月1日", "", "46296.5", "60", "0", "-1", "2958466", "abc", "20261001"]) assert.equal(sheetDate(bad), null, JSON.stringify(bad));
});
