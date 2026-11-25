import assert from "node:assert/strict";
import { test } from "node:test";
import { JA_ONLY_HAN, TRADITIONAL_SHARED_HAN, ZH_SIMPLIFIED_HAN } from "./place-language-tables.ts";
import { DEFAULT_PLACE_LANGUAGE, JA_ONLY_HAN_WORDS, PLACE_LANGUAGES, detectPlaceLanguage, placeLanguageOf, placeLanguageOfPage } from "./place-language.ts";
import { normalizePlaceQuery } from "./place-search.ts";

const detect = (text: string, page: "zh" | "ja" | "en" | null = null) => detectPlaceLanguage(normalizePlaceQuery(text), page);

test("任务给的例子：中文给中文、日文给日文、英文给英文；中日写法相同的按页面语言", () => {
  const cases: [string, string, string][] = [
    ["新宿", "zh-CN", "PAGE"],
    ["東京駅", "ja", "JA_KANJI"],
    ["东京站", "zh-CN", "ZH_SIMPLIFIED"],
    ["渋谷", "ja", "JA_KANJI"],
    ["Shinjuku Station", "en", "LATIN"],
    ["ホテル", "ja", "KANA"],
    ["羽田空港", "ja", "JA_WORD"],
    ["浅草寺", "zh-CN", "PAGE"],
    ["銀座", "ja", "TRADITIONAL"],
    ["银座", "zh-CN", "ZH_SIMPLIFIED"],
    ["大阪城", "zh-CN", "PAGE"],
    ["", "zh-CN", "PAGE"],
    ["12345", "zh-CN", "PAGE"],
    ["Tokyo 駅", "ja", "JA_KANJI"],
  ];
  for (const [text, language, reason] of cases) assert.deepEqual(detect(text), { language, reason }, text);
});

test("判断不出时用页面语言（客人选的界面语言），没有页面语言时 zh-CN", () => {
  for (const text of ["新宿", "大阪城", "浅草寺", "", "12345", "!!"]) {
    assert.equal(placeLanguageOf(text), "zh-CN", text);
    assert.equal(placeLanguageOf(text, "zh"), "zh-CN", text);
    assert.equal(placeLanguageOf(text, "ja"), "ja", text);
    assert.equal(placeLanguageOf(text, "en"), "en", text);
  }
  assert.equal(DEFAULT_PLACE_LANGUAGE, "zh-CN");
  assert.deepEqual([placeLanguageOfPage(null), placeLanguageOfPage(undefined), placeLanguageOfPage("zh"), placeLanguageOfPage("ja"), placeLanguageOfPage("en")], ["zh-CN", "zh-CN", "zh-CN", "ja", "en"]);
  // 判断得出的不看页面语言
  assert.equal(placeLanguageOf("东京站", "ja"), "zh-CN");
  assert.equal(placeLanguageOf("ホテル", "en"), "ja");
  assert.equal(placeLanguageOf("Hilton", "ja"), "en");
});

test("优先级：假名 > 日文专用字形 > 简体专用字形 > 日文才用的词 > 繁体日文共用字形 > 只有拉丁字母", () => {
  assert.deepEqual(detect("东京タワー"), { language: "ja", reason: "KANA" }, "有假名就是日文，哪怕有简体字");
  assert.deepEqual(detect("东京駅"), { language: "ja", reason: "JA_KANJI" }, "日文专用字形先于简体");
  assert.deepEqual(detect("首尔空港"), { language: "zh-CN", reason: "ZH_SIMPLIFIED" }, "简体字先于「空港」这类词");
  assert.deepEqual(detect("東京车站"), { language: "zh-CN", reason: "ZH_SIMPLIFIED" }, "简体先于繁体共用字形");
  assert.deepEqual(detect("Hilton 东京"), { language: "zh-CN", reason: "ZH_SIMPLIFIED" });
  assert.deepEqual(detect("Tokyo 新宿"), { language: "zh-CN", reason: "PAGE" }, "拉丁字母夹着中日共用的汉字：判断不出");
  assert.deepEqual(detect("Tokyo 新宿", "en"), { language: "en", reason: "PAGE" });
  assert.deepEqual(detect("ﾎﾃﾙ ｸﾞﾗﾝﾄﾞ"), { language: "ja", reason: "KANA" }, "半角片假名");
  assert.deepEqual(detect("代々木公園"), { language: "ja", reason: "JA_KANJI" }, "日文的叠字符号 々");
  assert.deepEqual(detect("新宿3丁目"), { language: "ja", reason: "JA_WORD" });
});

test("更多常见地名", () => {
  const ja = ["沖縄", "関西空港", "心斎橋", "黒門市場", "道頓堀", "秋葉原", "金閣寺", "那覇空港", "東京タワー", "成田空港 第1ターミナル", "栃木", "桜木町", "峠", "込"];
  const zh = ["冲绳", "关西机场", "黑门市场", "涩谷", "环球影城", "济州", "首尔", "横滨", "东京塔", "台场"];
  const page = ["京都", "奈良", "札幌", "池袋", "品川", "上野", "梅田", "箱根", "富士山", "清水寺", "横浜", "明洞", "釜山", "景福"];
  for (const text of ja) assert.equal(placeLanguageOf(text), "ja", text);
  for (const text of zh) assert.equal(placeLanguageOf(text, "ja"), "zh-CN", text);
  for (const text of page) assert.equal(detect(text, "en").reason, "PAGE", text);
  for (const text of ["Hilton Tokyo", "Café de Flore", "7-11 Ginza", "Narita Airport T2", "Hôtel"]) assert.equal(placeLanguageOf(text), "en", text);
  assert.equal(detect("서울역").reason, "PAGE", "韩文不在三种语言里：按页面语言");
  assert.equal(detect("Москва").reason, "PAGE");
});

test("字表：来自 Unihan 的三张表互不重叠、没有兼容汉字；任务点名的字分在对的表里", () => {
  const ja = new Set(JA_ONLY_HAN);
  const zh = new Set(ZH_SIMPLIFIED_HAN);
  const traditional = new Set(TRADITIONAL_SHARED_HAN);
  for (const char of ja) assert.ok(!zh.has(char) && !traditional.has(char), char);
  for (const char of zh) assert.ok(!traditional.has(char), char);
  for (const char of [...ja, ...zh, ...traditional]) {
    const code = char.codePointAt(0) as number;
    assert.ok(/\p{Script=Han}/u.test(char), char);
    assert.ok(!(code >= 0xf900 && code <= 0xfaff) && !(code >= 0x2f800 && code <= 0x2fa1f), `兼容汉字 ${char}`);
    assert.equal(char.normalize("NFKC"), char, char);
  }
  for (const char of "駅沢辺広県渋図桜峠込畑栃働関黒") assert.ok(ja.has(char), `日文专用 ${char}`);
  for (const char of "东车门银场涩绳") assert.ok(zh.has(char), `简体专用 ${char}`);
  for (const char of "東銀車門場閣濟") assert.ok(traditional.has(char), `繁体日文共用 ${char}`);
  // 中日写法相同的（日本新字体和简体同形、或者本来就一样）哪张表都不在
  for (const char of "区国学新宿大阪站京都浅草寺") assert.ok(!ja.has(char) && !zh.has(char) && !traditional.has(char), `共用 ${char}`);
  assert.ok(ja.size > 800 && zh.size > 2000 && traditional.size > 2000);
  assert.deepEqual([...JA_ONLY_HAN_WORDS], ["空港", "丁目", "番地"]);
  assert.deepEqual([...PLACE_LANGUAGES], ["zh-CN", "ja", "en"]);
});
