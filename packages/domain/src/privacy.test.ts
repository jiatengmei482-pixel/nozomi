import { test } from "node:test";
import assert from "node:assert/strict";
import { maskName, maskPassenger, maskPhone } from "./privacy.ts";

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
