import assert from "node:assert/strict";
import { test } from "node:test";
import { GUEST_UI, GUEST_UI_LANGUAGES, guestUiLanguage } from "./guest-ui-language.ts";

test("嵌入入口和嵌入页外层开放中、日、英三种语言（业主 2026-11-25）：定下哪种就显示哪种", () => {
  assert.deepEqual(GUEST_UI_LANGUAGES, ["zh", "ja", "en"]);
  assert.equal(GUEST_UI.languages, GUEST_UI_LANGUAGES);
  for (const lang of ["zh", "ja", "en"] as const) assert.equal(guestUiLanguage(lang), lang);
});

test("开关收窄时没开放的语言退回中文", (t) => {
  GUEST_UI.languages = ["zh"];
  t.after(() => {
    GUEST_UI.languages = GUEST_UI_LANGUAGES;
  });
  assert.equal(guestUiLanguage("ja"), "zh");
  assert.equal(guestUiLanguage("en"), "zh");
  assert.equal(guestUiLanguage("zh"), "zh");
});
