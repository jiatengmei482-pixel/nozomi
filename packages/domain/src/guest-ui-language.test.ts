import assert from "node:assert/strict";
import { test } from "node:test";
import { GUEST_UI, GUEST_UI_LANGUAGES, guestUiLanguage } from "./guest-ui-language.ts";

test("M11 之前客人界面只开放中文（业主 2026-11-25）", () => {
  assert.deepEqual(GUEST_UI_LANGUAGES, ["zh"]);
  assert.equal(GUEST_UI.languages, GUEST_UI_LANGUAGES);
});

test("请求日文、英文时显示中文；请求中文照旧中文", () => {
  assert.equal(guestUiLanguage("ja"), "zh");
  assert.equal(guestUiLanguage("en"), "zh");
  assert.equal(guestUiLanguage("zh"), "zh");
});

test("放开三种语言（M11 时）后按请求的语言显示", (t) => {
  GUEST_UI.languages = ["zh", "ja", "en"];
  t.after(() => {
    GUEST_UI.languages = GUEST_UI_LANGUAGES;
  });
  assert.equal(guestUiLanguage("ja"), "ja");
  assert.equal(guestUiLanguage("en"), "en");
  assert.equal(guestUiLanguage("zh"), "zh");
});
