/** M1-05：表格里人填的数字和日期。全程按字符处理：金额不经过浮点数，写不尽的小数不会被悄悄四舍五入。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMajor } from "./money.ts";
import { plainDecimal, plainInteger, scaledInteger, sheetDate, storedNumberDecimal } from "./spreadsheet.ts";

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
  assert.deepEqual(["2026-10-01", "2026/10/1", "2026.10.01", " 2026-1-5 ", "2028-02-29"].map((text) => sheetDate(text)), ["2026-10-01", "2026-10-01", "2026-10-01", "2026-01-05", "2028-02-29"]);
  assert.deepEqual(["46296", "46296.0", "61", "45658", "36526"].map((text) => sheetDate(text)), ["2026-10-01", "2026-10-01", "1900-03-01", "2025-01-01", "2000-01-01"]);
  // 带着零点时间的写法（有的软件把日期存成这样的文字）
  assert.deepEqual(["2026-10-01T00:00:00", "2026-10-01 00:00:00", "2026-10-01T00:00:00.000Z", "2026/10/1 00:00"].map((text) => sheetDate(text)), ["2026-10-01", "2026-10-01", "2026-10-01", "2026-10-01"]);
  assert.deepEqual(["2026-10-01T08:30:00", "2026-10-01 12:00"].map((text) => sheetDate(text)), [null, null], "带着不是零点的时间：不是一个日期");
  // 1904 纪元（老版本的 Mac Excel）：同一天的序号小 1462
  assert.deepEqual(["44834", "0", "1", "44834.0"].map((text) => sheetDate(text, { date1904: true })), ["2026-10-01", "1904-01-01", "1904-01-02", "2026-10-01"]);
  assert.equal(sheetDate("46296", { date1904: true }), "2030-10-02", "按错纪元读会差四年多：所以要看文件的声明");
  assert.deepEqual(["-1", "2957004", "44834.5"].map((text) => sheetDate(text, { date1904: true })), [null, null, null]);
  assert.equal(sheetDate("2026-10-01", { date1904: true }), "2026-10-01", "写成文字的日期不受纪元影响");
  for (const bad of ["2026-02-30", "10/01/2026", "2026年10月1日", "", "46296.5", "60", "0", "-1", "2958466", "abc", "20261001"]) assert.equal(sheetDate(bad), null, JSON.stringify(bad));
});

test("千分位的逗号：第一组 1 到 3 位、不以 0 开头，后面每组正好三位；别的带逗号的写法都不是数字（逗号可能是小数点，不猜）", () => {
  const grouped: [string, string][] = [["1,000", "1000"], ["12,500", "12500"], ["999,999", "999999"], ["1,234,567", "1234567"], ["1,234.5", "1234.5"], ["-12,500.25", "-12500.25"], ["+1,000", "1000"], [" 20,000 ", "20000"], ["1,000E+2", "100000"]];
  for (const [input, expected] of grouped) assert.equal(plainDecimal(input), expected, input);
  for (const input of ["0,500", "0,123,456", "00,500", "01,000", "12,50", "1,2345", "1234,567", ",500", "1,", "1,,000", "1,000,", "1,000,00", "1.5,000", "1,000.5,000", "1 000", "1，000", "-,500", "1,0e3"]) assert.equal(plainDecimal(input), null, input);
});

test("存成数字的单元格：Excel 写的 17 位有效数字读回用户填的那个数；本来就超过 15 位的原样留着，不给近似的数", () => {
  // Excel 存盘写进文件的字符：双精度数的 17 位有效数字
  const stored = (typed: string): string => Number(typed).toPrecision(17).replace(/\.?0+$/, "");
  for (const typed of ["19.99", "5.1", "0.58", "1234.56", "4.35", "8.2", "0.1", "0.7", "1.005", "123456.78", "99999999.99", "0.000123", "-19.99", "1e-7", "123456789012.345"]) {
    assert.equal(storedNumberDecimal(stored(typed)), plainDecimal(typed), `${typed} 存成 ${stored(typed)}`);
  }
  // 15 位以内的原样（不经过浮点数）：包括浮点数表示不了的写法
  assert.deepEqual(["20000", "123.456", "18500.000000001", "1.2E+4", "0.10", "999999999999999"].map(storedNumberDecimal), ["20000", "123.456", "18500.000000001", "12000", "0.1", "999999999999999"]);
  // 最短写法仍然超过 15 位：原样返回，由后面按精度 / 范围去拒绝
  assert.deepEqual(["0.30000000000000004", "2.9999999999999996", "9007199254740993", "90071992547409920", "1234567890.1234567"].map(storedNumberDecimal), ["0.30000000000000004", "2.9999999999999996", "9007199254740993", "90071992547409920", "1234567890.1234567"]);
  assert.deepEqual(["1E+21", "1E+400", "abc", "", "TRUE"].map(storedNumberDecimal), ["1000000000000000000000", null, null, null, null]);
  // 随机的两位小数金额：Excel 存的 17 位读回来都是原来的数
  let seed = 20261007;
  for (let round = 0; round < 5_000; round += 1) {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    const typed = `${seed % 10_000_000}.${String(seed % 100).padStart(2, "0")}`;
    assert.equal(storedNumberDecimal(stored(typed)), plainDecimal(typed), typed);
  }
});

test("十进制写法换成整数（金额 → 最小货币单位、公里 → 百米）：符号、小数位、范围统一处理，按字符不经过浮点数", () => {
  const money = { min: 0, max: 1_000_000_000 };
  assert.deepEqual([scaledInteger("19.99", 2, money), scaledInteger("19.9", 2, money), scaledInteger("20000", 0, money), scaledInteger("0", 2, money), scaledInteger("10000000", 2, money), scaledInteger("0.07", 2, money)], [{ value: 1_999 }, { value: 1_990 }, { value: 20_000 }, { value: 0 }, { value: 1_000_000_000 }, { value: 7 }]);
  // 小数位超了：不四舍五入
  assert.deepEqual([scaledInteger("19.999", 2, money), scaledInteger("0.5", 0, money), scaledInteger("0.30000000000000004", 2, money)], [{ issue: "PRECISION" }, { issue: "PRECISION" }, { issue: "PRECISION" }]);
  // 负数、太大、大得存不下：超出范围（符号作用在整个数上，不只是整数部分）
  assert.deepEqual(
    [scaledInteger("-0.5", 1, { min: 0, max: 10_000 }), scaledInteger("-0.1", 1, { min: 0, max: 10_000 }), scaledInteger("-100", 0, money), scaledInteger("10000000.01", 2, money), scaledInteger("1000000001", 0, money), scaledInteger("1000000000000000000000", 0, money), scaledInteger("90071992547409920", 0, money)],
    Array(7).fill({ issue: "OUT_OF_RANGE" }),
  );
  assert.deepEqual([scaledInteger("-0.5", 1, { min: -10, max: 10 }), scaledInteger("-12.3", 1, { min: -1_000, max: 0 })], [{ value: -5 }, { value: -123 }], "允许负数的范围里负的小数换得对");
  // 先看小数位、再看范围
  assert.deepEqual(scaledInteger("99999999999.999", 2, money), { issue: "PRECISION" });
  assert.throws(() => scaledInteger("1,000", 0, money), RangeError, "只接受 plainDecimal 的结果");
});
