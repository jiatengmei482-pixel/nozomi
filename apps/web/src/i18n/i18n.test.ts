import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { defineMessages, formatMessage, lookup, setLang } from "./i18n.ts";
import { t } from "./index.ts";
import { MESSAGE_BOOKS } from "./messages/index.ts";

afterEach(() => setLang("zh"));

test("t()：按「模块名.key」取中文，{参数} 换成值；参数没给的原样留着", () => {
  assert.equal(t("freeWait.previewChange", { from: 60, to: "90 分钟" }), "同意后免费等待 60 → 90 分钟");
  assert.equal(t("freeWait.flightKindLegend"), "航班类型");
  assert.equal(formatMessage("还差 {n} 项、{missing}", { n: 2 }), "还差 2 项、{missing}");
});

test("缺的语言退回中文：只写了日文的那一条用日文，其余用中文", () => {
  const book = defineMessages("demo", { hello: "你好", bye: "再见" }, { ja: { hello: "こんにちは" } });
  assert.equal(lookup(book, "hello", "ja"), "こんにちは");
  assert.equal(lookup(book, "bye", "ja"), "再见");
  assert.equal(lookup(book, "hello", "en"), "你好");
  setLang("en");
  assert.equal(t("freeWait.flightKindLegend"), "航班类型", "没有英文的退回中文");
});

test("登记的文案本：模块名和登记名一致；模块名、key 只含字母数字（导出清单和 t() 都靠它）；中文都不为空", () => {
  for (const [name, book] of Object.entries(MESSAGE_BOOKS)) {
    assert.equal(book.ns, name, `${name} 登记名要和 defineMessages 的模块名一致`);
    assert.match(name, /^[a-z][A-Za-z0-9]*$/);
    for (const [key, text] of Object.entries(book.zh)) {
      assert.match(key, /^[a-z][A-Za-z0-9]*$/, `${name}.${key}`);
      assert.ok((text as string).trim() !== "", `${name}.${key} 的中文是空的`);
    }
  }
});
