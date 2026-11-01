/**
 * M4-20 测试角色：司机手写备注的打码（ADR 0054）。privacy.test.ts 已测基本形式，这里测实际会写出来的变体和误伤。
 * 全部是虚构数据。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { maskContactsInText } from "./privacy.ts";

const DIGITS_LEFT = (text: string): string => text.replace(/[^0-9０-９]/g, "");

for (const [label, note] of [
  ["连写", "打 09012345678 没人接"],
  ["全角数字", "打 ０９０１２３４５６７８ 没人接"],
  ["全角数字加全角连字符", "打 ０９０－１２３４－５６７８ 没人接"],
  ["空格分隔", "打 090 1234 5678 没人接"],
  ["全角空格分隔", "打 090　1234　5678 没人接"],
  ["括号", "打 (090) 1234-5678 没人接"],
  ["点分隔", "打 090.1234.5678 没人接"],
  ["+81 连字符", "打 +81-90-1234-5678 没人接"],
  ["全角加号和数字", "打 ＋８１　９０　１２３４　５６７８ 没人接"],
  ["长音符当连字符", "打 090ー1234ー5678 没人接"],
  ["紧贴中文", "电话09012345678没人接"],
  ["减号 U+2212（日文输入法常见）", "打 090−1234−5678 没人接"],
  ["短破折号 U+2013", "打 090–1234–5678 没人接"],
  ["长破折号 U+2014", "打 090—1234—5678 没人接"],
  ["不换行连字符 U+2011", "打 090‑1234‑5678 没人接"],
  ["半角长音 U+FF70", "打 090ｰ1234ｰ5678 没人接"],
  ["斜杠分隔", "打 090/1234/5678 没人接"],
] as const) {
  test(`电话打码（${label}）：只留末 4 位`, () => {
    const masked = maskContactsInText(note);
    const left = DIGITS_LEFT(masked);
    assert.ok(left.length === 4, `还留着 ${left}：${masked}`);
    assert.ok(masked.includes("****"), masked);
    assert.ok(masked.startsWith("打") || masked.startsWith("电话"), masked);
    assert.ok(masked.endsWith("没人接"), masked);
  });
}

test("一段备注里有多个电话：每个都打码", () => {
  const masked = maskContactsInText("先打 090-1234-5678，再打 +81 80 8765 4321，都没接");
  assert.equal(masked, "先打 ****5678，再打 ****4321，都没接");
});

test("混合：电话、邮箱、姓名同时出现，都打码，其他文字不动", () => {
  const masked = maskContactsInText("王小明 电话 090-1234-5678 邮箱 guest@example.com，等了 30 分钟", "王小明");
  assert.equal(masked, "王** 电话 ****5678 邮箱 gu***@example.com，等了 30 分钟");
});

test("邮箱紧贴中文：本名部分不留在结果里", () => {
  const masked = maskContactsInText("发到guest@example.com没回");
  assert.ok(!masked.includes("guest"), masked);
});

test("邮箱里的长数字：也不留原文", () => {
  const masked = maskContactsInText("发到 guest09012345678@example.com");
  assert.ok(!masked.includes("09012345678"), masked);
});

test("斜杠连着两个邮箱：两个都打码", () => {
  const masked = maskContactsInText("发到 guest@example.com/other@example.org 都没回");
  assert.ok(!masked.includes("guest@"), masked);
  assert.ok(!masked.includes("other"), masked);
});

test("全角 @（日文输入法常见）：同样打码", () => {
  const masked = maskContactsInText("发到 guest＠example.com 没回");
  assert.ok(!masked.includes("guest"), masked);
});

test("日文姓名：和订单上写法一样时打码，多次出现都打", () => {
  assert.equal(maskContactsInText("山田 太郎 没接，再打给山田 太郎", "山田 太郎"), "山** 没接，再打给山**");
  assert.equal(maskContactsInText("ヤマダ タロウ没回", "ヤマダ タロウ"), "ヤ**没回");
});

test("日文姓名：订单上有空格、备注里没有（或是全角空格）也要打码", () => {
  for (const written of ["山田太郎没接", "山田　太郎没接"]) {
    const masked = maskContactsInText(written, "山田 太郎");
    assert.ok(!masked.includes("太郎"), masked);
  }
});

test("日文姓名：备注只写姓（「山田さん」是最常见的写法）也要打码", () => {
  const masked = maskContactsInText("山田さん没接电话", "山田 太郎");
  assert.ok(!masked.includes("山田"), masked);
});

test("拉丁字母姓名：大小写不同也要打码（护照姓名常全大写）", () => {
  const masked = maskContactsInText("called TARO YAMADA, no answer", "Taro Yamada");
  assert.ok(!masked.includes("YAMADA"), masked);
});

test("没给乘客姓名、姓名是空白：不报错、不把正文清掉", () => {
  assert.equal(maskContactsInText("没人接", null), "没人接");
  assert.equal(maskContactsInText("没人接", "   "), "没人接");
});

for (const note of [
  "10:30 到达，等了 90 分钟，打了 3 次",
  "10:30-11:45 一直在 T2 3 号门",
  "从 10:30 等到 11:45，12:10 又打了一次",
  "11/01 到达 第 2 航站楼 北口",
  "千代田区丸の内1-9-1 见面",
  "2 号航站楼 12 号门 第 3 次",
]) {
  test(`不误伤时间、地址和短数字：${note}`, () => {
    assert.equal(maskContactsInText(note), note);
  });
}
