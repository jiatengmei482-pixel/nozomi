/**
 * 地点名称的匹配规则（docs/design/pages/tenant-products.md 4.1「接送点」，M1-17；M8-02 起官网的地址搜索、输入即提示也用它找平台的机场、车站）。
 *
 * 只按「包含的文字」找时，「成田机场」找不到正式名称是「成田国际机场」的成田。规则：
 * 1. 整段输入包含在名称、编码里 → 匹配（原来的行为）；
 * 2. 否则去掉输入里的通用词（机场、空港、国际、国際、航站楼、火车站、车站、駅 等，以及英文的 airport、international、station），
 *    剩下的部分：汉字、假名一个字一个字地看，字母和数字按空格分成词，全部都出现在名称或编码里 → 匹配；
 * 3. 输入只剩通用词（例如只输了「机场」）时，只按第 1 条找。
 * 不分大小写，全角半角按 NFKC 统一。
 */

const GENERIC_WORDS = ["国际机场", "國際機場", "国際空港", "飞机场", "机场", "機場", "空港", "国际", "國際", "国際", "航站楼", "火车站", "车站", "車站", "駅", "airport", "international", "intl", "station"];

const CJK = /[぀-ヿ㐀-鿿豈-﫿]/u;

function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

/** 把输入拆成要逐个找的片段：汉字、假名单个字，其他按空格分词。 */
function pieces(query: string): string[] {
  let rest = query;
  for (const word of GENERIC_WORDS) rest = rest.split(word).join(" ");
  const result: string[] = [];
  for (const token of rest.split(/[\s·・,，、()（）-]+/u)) {
    let latin = "";
    for (const character of token) {
      if (CJK.test(character)) {
        if (latin !== "") result.push(latin);
        latin = "";
        result.push(character);
      } else latin += character;
    }
    if (latin !== "") result.push(latin);
  }
  return result;
}

/** 怎么匹配上的：`whole` 整段包含（第 1 条），`pieces` 按字 / 词（第 2 条）；没匹配上为 null。整段包含的排在前面。 */
export function placeQueryMatch(haystack: string, query: string): "whole" | "pieces" | null {
  const needle = normalize(query.trim());
  if (needle === "") return "whole";
  const text = normalize(haystack);
  if (text.includes(needle)) return "whole";
  const parts = pieces(needle);
  return parts.length > 0 && parts.every((part) => text.includes(part)) ? "pieces" : null;
}

/** `haystack` 是选项的全部可搜文字（各语言名称、编码等，用空格连起来）。 */
export function placeQueryMatches(haystack: string, query: string): boolean {
  return placeQueryMatch(haystack, query) !== null;
}

/** 平台主数据里给官网地址搜索、输入即提示用的地点（M8-02）：机场、航站楼（挂在机场下）、车站。 */
export const PLATFORM_SUGGESTION_TYPES = ["airport", "terminal", "station"] as const;
export type PlatformSuggestionType = (typeof PLATFORM_SUGGESTION_TYPES)[number];

export interface PlatformSuggestionPlace {
  id: string;
  type: PlatformSuggestionType;
  code: string;
  name: Partial<Record<"ja" | "zh" | "en" | "ko", string>>;
  /** 航站楼所属机场的名称（各语言）；其余为 null */
  parentName: Partial<Record<"ja" | "zh" | "en" | "ko", string>> | null;
  lat: number;
  lng: number;
}

/** 一次最多给几个平台的地点（排在谷歌的结果前面） */
export const PLATFORM_SUGGESTION_LIMIT = 5;

/** 给客人看的名称：中文优先，其次日文、英文、韩文，都没有用编码；航站楼前面加上所属机场的名称。 */
export function platformPlaceDisplayName(place: Pick<PlatformSuggestionPlace, "code" | "name" | "parentName">): string {
  const pick = (text: PlatformSuggestionPlace["name"] | null): string | null => text?.zh ?? text?.ja ?? text?.en ?? text?.ko ?? null;
  const own = pick(place.name) ?? place.code;
  const parent = pick(place.parentName);
  return parent === null ? own : `${parent} ${own}`;
}

/**
 * 关键字匹配的平台地点，排在谷歌的结果前面（不依赖谷歌也能搜到机场、航站楼、车站）：
 * 名称（各语言，航站楼连同所属机场的名称）或编码匹配 `placeQueryMatch`；整段包含的在前，再按机场、航站楼、车站，再按编码。最多 `limit` 个。
 */
export function platformPlaceSuggestions<T extends PlatformSuggestionPlace>(places: readonly T[], query: string, limit: number = PLATFORM_SUGGESTION_LIMIT): T[] {
  const typeOrder = (type: PlatformSuggestionType): number => PLATFORM_SUGGESTION_TYPES.indexOf(type);
  const ranked: { place: T; whole: boolean }[] = [];
  for (const place of places) {
    const haystack = [...Object.values(place.parentName ?? {}), ...Object.values(place.name), place.code].join(" ");
    const match = placeQueryMatch(haystack, query);
    if (match !== null) ranked.push({ place, whole: match === "whole" });
  }
  ranked.sort((a, b) => Number(b.whole) - Number(a.whole) || typeOrder(a.place.type) - typeOrder(b.place.type) || (a.place.code < b.place.code ? -1 : a.place.code > b.place.code ? 1 : 0));
  return ranked.slice(0, limit).map((entry) => entry.place);
}
