/**
 * 接送点（机场、车站）搜索的匹配规则（docs/design/pages/tenant-products.md 4.1「接送点」，M1-17）。
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

/** `haystack` 是选项的全部可搜文字（各语言名称、编码等，用空格连起来）。 */
export function placeQueryMatches(haystack: string, query: string): boolean {
  const needle = normalize(query.trim());
  if (needle === "") return true;
  const text = normalize(haystack);
  if (text.includes(needle)) return true;
  const parts = pieces(needle);
  return parts.length > 0 && parts.every((part) => text.includes(part));
}
