/**
 * 地址搜索按客人输入的语言请求谷歌（M12-07，ADR 0108；取代 ADR 0044 / 0069 里固定 `zh-CN` 的做法）：输入中文给中文结果、日文给日文、英文给英文。
 * 纯函数，不碰网络和数据库。规则（按先后，前一条成立就不再往下看）：
 *
 * 1. 有平假名或片假名 → `ja`（`KANA`）；
 * 2. 有日文专用的汉字字形（日本新字体、和制汉字，如 駅 沢 渋 図 栃；外加日文的叠字符号 々 〆）→ `ja`（`JA_KANJI`）；
 * 3. 有简体专用字形（如 东 车 门 银 涩）→ `zh-CN`（`ZH_SIMPLIFIED`）；
 * 4. 有日文才用的汉字词（空港、丁目、番地：中文分别说机场、—、号）→ `ja`（`JA_WORD`）；
 * 5. 有繁体、日文共用而简体不用的字形（如 東 銀 車 門）→ `ja`（`TRADITIONAL`）：官网只给简体中文的结果，简体输入法打不出这些字，
 *    这类输入几乎都是从日文网页、日文的预订确认里复制来的；对日本的地点，日文结果的汉字繁体读者也看得懂；
 * 6. 只有拉丁字母（加数字、标点、空白），至少一个字母 → `en`（`LATIN`）；
 * 7. 其余（中日共用的汉字如「新宿」「大阪城」、空串、纯数字、韩文等）判断不出 → 页面语言（客人选的界面语言），没有时 `zh-CN`（`PAGE`）。
 *
 * 三张字表和日文词表见 `place-language-tables.ts`（字表由 Unicode 的 Unihan 数据按写明的条件生成）。
 */
import { JA_HAN_MARKS, JA_ONLY_HAN, JA_ONLY_HAN_WORDS, TRADITIONAL_SHARED_HAN, ZH_SIMPLIFIED_HAN } from "./place-language-tables.ts";

export { JA_ONLY_HAN_WORDS };

/** 请求谷歌 Places / Geocoding 用的语言（谷歌的 `languageCode`） */
export const PLACE_LANGUAGES = ["zh-CN", "ja", "en"] as const;
export type PlaceLanguage = (typeof PLACE_LANGUAGES)[number];

/** 判断不出、也没有页面语言时用的（官网现在只有中文页面） */
export const DEFAULT_PLACE_LANGUAGE: PlaceLanguage = "zh-CN";

/** 页面语言（客人选的界面语言，和嵌入组件的 `default_lang` 同一组） */
export const PLACE_PAGE_LANGS = ["zh", "ja", "en"] as const;
export type PlacePageLang = (typeof PLACE_PAGE_LANGS)[number];

/** 判断出语言的依据（单元测试和排查用） */
export type PlaceLanguageReason = "KANA" | "JA_KANJI" | "ZH_SIMPLIFIED" | "JA_WORD" | "TRADITIONAL" | "LATIN" | "PAGE";

const toSet = (chars: string): ReadonlySet<string> => new Set([...chars]);
let tables: { ja: ReadonlySet<string>; zh: ReadonlySet<string>; traditional: ReadonlySet<string> } | null = null;
function hanTables(): NonNullable<typeof tables> {
  tables ??= { ja: toSet(JA_ONLY_HAN + JA_HAN_MARKS), zh: toSet(ZH_SIMPLIFIED_HAN), traditional: toSet(TRADITIONAL_SHARED_HAN) };
  return tables;
}

const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const LETTER = /\p{L}/u;
const LATIN = /\p{Script=Latin}/u;
const HAN = /\p{Script=Han}/u;

/** 页面语言 → 请求谷歌的语言；没有页面语言时 `zh-CN`。 */
export function placeLanguageOfPage(page: PlacePageLang | null | undefined): PlaceLanguage {
  switch (page) {
    case "ja":
      return "ja";
    case "en":
      return "en";
    default:
      return DEFAULT_PLACE_LANGUAGE;
  }
}

/** 按输入的文字（最好是规范化过的关键字）判断请求谷歌用的语言和依据，规则见文件开头。 */
export function detectPlaceLanguage(text: string, page: PlacePageLang | null = null): { language: PlaceLanguage; reason: PlaceLanguageReason } {
  const chars = [...text.normalize("NFKC")];
  if (chars.some((char) => KANA.test(char))) return { language: "ja", reason: "KANA" };
  const han = chars.filter((char) => HAN.test(char));
  if (han.length > 0) {
    const { ja, zh, traditional } = hanTables();
    if (han.some((char) => ja.has(char))) return { language: "ja", reason: "JA_KANJI" };
    if (han.some((char) => zh.has(char))) return { language: "zh-CN", reason: "ZH_SIMPLIFIED" };
    const joined = han.join("");
    if (JA_ONLY_HAN_WORDS.some((word) => joined.includes(word))) return { language: "ja", reason: "JA_WORD" };
    if (han.some((char) => traditional.has(char))) return { language: "ja", reason: "TRADITIONAL" };
    return { language: placeLanguageOfPage(page), reason: "PAGE" };
  }
  const letters = chars.filter((char) => LETTER.test(char));
  if (letters.length > 0 && letters.every((char) => LATIN.test(char))) return { language: "en", reason: "LATIN" };
  return { language: placeLanguageOfPage(page), reason: "PAGE" };
}

/** 同上，只要语言。 */
export function placeLanguageOf(text: string, page: PlacePageLang | null = null): PlaceLanguage {
  return detectPlaceLanguage(text, page).language;
}
