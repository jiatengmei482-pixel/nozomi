import { test } from "node:test";
import assert from "node:assert/strict";
import { CsvError, decodeUtf8Strict, parseCsv } from "./csv.ts";

test("普通的行和字段；文件末尾有没有换行结果一样", () => {
  assert.deepEqual(parseCsv("a,b,c\n1,2,3\n"), [["a", "b", "c"], ["1", "2", "3"]]);
  assert.deepEqual(parseCsv("a,b,c\n1,2,3"), [["a", "b", "c"], ["1", "2", "3"]]);
  assert.deepEqual(parseCsv("a,b\r\n1,2\r\n"), [["a", "b"], ["1", "2"]]);
});

test("空字段保留；空文件没有任何行", () => {
  assert.deepEqual(parseCsv("a,,c\n,,\n"), [["a", "", "c"], ["", "", ""]]);
  assert.deepEqual(parseCsv(""), []);
  assert.deepEqual(parseCsv('""\n'), [[""]]);
});

test("引号里的逗号、换行、双引号原样保留", () => {
  assert.deepEqual(parseCsv('id,name,keywords\n1,"Tokyo, Haneda","TYO, 羽田空港"\n'), [
    ["id", "name", "keywords"],
    ["1", "Tokyo, Haneda", "TYO, 羽田空港"],
  ]);
  assert.deepEqual(parseCsv('1,"first line\nsecond line",x\n'), [["1", "first line\nsecond line", "x"]]);
  assert.deepEqual(parseCsv('1,"the ""big"" one",x\n'), [["1", 'the "big" one', "x"]]);
});

test("开头的 BOM 被去掉", () => {
  assert.deepEqual(parseCsv("﻿id,name\n1,a\n"), [["id", "name"], ["1", "a"]]);
});

test("引号没有闭合：报错而不是悄悄吞掉后面的内容", () => {
  assert.throws(() => parseCsv('1,"never closed\n2,b\n'), CsvError);
});

test("只有 CR 的旧式换行：报错并说明，不会把整份文件当成一行；引号里的 CR 是内容", () => {
  assert.throws(() => parseCsv("a,b\r1,2\r"), (err: unknown) => err instanceof CsvError && /只有 CR/.test(err.message));
  assert.deepEqual(parseCsv('a,"x\ry"\n'), [["a", "x\ry"]]);
});

test("严格按 UTF-8 解码：合法的原样给出（含中日文和表情），不合法的字节报错而不是变成乱码", () => {
  assert.equal(decodeUtf8Strict(Buffer.from("Aéroport 東京 🚗", "utf8")), "Aéroport 東京 🚗");
  for (const bytes of [Buffer.from("Aéroport", "latin1"), Buffer.from("\ufeffid,name", "utf16le"), Buffer.from([0xff, 0xfe, 0x00]), Buffer.from("东京", "utf8").subarray(0, 4)]) {
    assert.throws(() => decodeUtf8Strict(bytes), (err: unknown) => err instanceof CsvError && /不是 UTF-8/.test(err.message));
  }
});
