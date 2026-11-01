import { test } from "node:test";
import assert from "node:assert/strict";
import { maskContactsInText, maskName, maskPassenger, maskPhone } from "./privacy.ts";

test("姓名留第一个字；一个字的全打码；表情不会被切成半个", () => {
  assert.equal(maskName("王小明"), "王**");
  assert.equal(maskName("Satoh Ichiro"), "S**");
  assert.equal(maskName("王"), "*");
  assert.equal(maskName(""), "*");
  assert.equal(maskName("😀小明"), "😀**");
});

test("电话只留末 4 位，太短的全打码", () => {
  assert.equal(maskPhone("+819012345678"), "+********5678");
  assert.equal(maskPhone("09012345678"), "*******5678");
  assert.equal(maskPhone("+8112345"), "+****");
  assert.equal(maskPhone("1234"), "****");
});

test("打码后的结果里没有原文", () => {
  const masked = JSON.stringify(maskPassenger({ name: "王小明", phone: "+819012345678", email: "guest@example.com" }));
  for (const secret of ["小明", "90123", "guest"]) assert.ok(!masked.includes(secret), secret);
});

test("手写内容里的电话打码，只留末 4 位；短数字（次数、航站楼、分钟）不动", () => {
  assert.equal(maskContactsInText("打了 +81 90-1234-5678 没人接"), "打了 ****5678 没人接");
  assert.equal(maskContactsInText("电话０９０１２３４５６７８"), "电话****５６７８");
  assert.equal(maskContactsInText("第 3 次，T2 等了 15 分钟"), "第 3 次，T2 等了 15 分钟");
});

test("手写内容里的邮箱、乘客姓名打码；其他文字原样", () => {
  assert.equal(maskContactsInText("发到 guest@example.com，已读不回"), "发到 gu***@example.com，已读不回");
  assert.equal(maskContactsInText("王小明没有回复", "王小明"), "王**没有回复");
  assert.equal(maskContactsInText("LINE 已读不回", "王小明"), "LINE 已读不回");
  assert.equal(maskContactsInText("没有写名字", null), "没有写名字");
});
