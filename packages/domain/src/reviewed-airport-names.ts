/**
 * 机场名称核对表（M12-06，业主 2026-11-25「机场主数据每个机场都要预先填好」）。
 *
 * GeoNames 导入（geonames-airports.ts）之后还空着的日文、简体中文名，由人核对过的一张表补上：
 * 表放在仓库里（apps/api/masterdata/airport-names-reviewed.json），每一条写明来源（GeoNames 繁体转简体并经业主确认、维基数据 CC0、机场官方民航名称）。
 *
 * 规则和 GeoNames 导入一样（planAirportNameImport）：
 * - 按三字码 + 国家对应库里的机场；对不上的列出来，不填。
 * - 只填空着的语言；已经有名称的一律不改（不同的列出来给人看）。
 * - 以前由导入（任何来源）填过、后来平台删掉的：不再补回去。
 * - 不动搜索别名（那是 GeoNames 导入的事）。
 * 来源记进 `places.name_sources`，`source` 固定是 REVIEWED_AIRPORT_NAMES_SOURCE，`ref` 是表里这一条写的来源说明。
 */
import { AIRPORT_NAME_LANGUAGES, type AirportNameLanguage, type ExistingAirportNames, type NameSources } from "./geonames-airports.ts";
import { type LocalizedText, hasVisibleText, isCountryCode, isIataCode } from "./master-data.ts";

export const REVIEWED_AIRPORT_NAMES_SOURCE = "nozomi-reviewed";

const MAX_NAME_LENGTH = 200;
const MAX_REF_LENGTH = 300;

/**
 * 简体中文名里不该出现的繁体 / 日文字形（核对表里常见的那些）。维基数据的「简体」标签偶尔就是繁体（如仁川「仁川國際機場」），
 * 这里拦下来，不让它进库。不是完整的繁简表，只防常见错误；真正的把关是人核对。
 */
const NOT_SIMPLIFIED = /[國機場際飛島澤見標麗戶關東縣濟長岡靜賀兒廣灣華蘭門雲雞龍鳥齊陽運館風鄉歲輪橋鐵寶萬與屬馬魚聯陸當質樂豐濱廳莊綠過遠邊鄭倉蔵満沢広栄県]/gu;

/** 日文名里应有日文用的写法：至少有一个汉字或假名（防止把英文、韩文填进日文名） */
const JAPANESE_TEXT = /[぀-ヿ一-鿿]/u;

export interface ReviewedAirportName {
  code: string;
  country: string;
  names: Partial<Record<AirportNameLanguage, string>>;
  sources: Partial<Record<AirportNameLanguage, string>>;
}

/**
 * 核对表的问题（只给代码，文字由命令行入口写，见 cli/masterdata-import-airport-names-reviewed.ts）：
 * NO_LIST 整张表没有 airports；CODE_FORMAT 三字码格式；DUPLICATE 三字码重复；COUNTRY_FORMAT 国家码格式；UNKNOWN_LANGUAGE 不认识的语言；
 * NAME_FORMAT 名称为空 / 太长 / 首尾有空白；NOT_SIMPLIFIED 简体名里有繁体或日文字形；NOT_JAPANESE 日文名里没有汉字或假名；NO_SOURCE 没写来源；NOTHING_TO_FILL 没有要填的名称。
 */
export type ReviewedAirportNameProblem = "NO_LIST" | "CODE_FORMAT" | "DUPLICATE" | "COUNTRY_FORMAT" | "UNKNOWN_LANGUAGE" | "NAME_FORMAT" | "NOT_SIMPLIFIED" | "NOT_JAPANESE" | "NO_SOURCE" | "NOTHING_TO_FILL";

export interface ReviewedAirportNameIssue {
  /** 第几条（从 1 数），整张表的问题是 0 */
  index: number;
  code: string | null;
  problem: ReviewedAirportNameProblem;
  /** 涉及的语言、名称和字（有就给） */
  language?: string;
  text?: string;
  chars?: string;
}

/** 读核对表（JSON 解析后的值）。有任何一条不合格就整张表不用，把问题全列出来。 */
export function readReviewedAirportNames(value: unknown): { entries: ReviewedAirportName[]; issues: ReviewedAirportNameIssue[] } {
  const issues: ReviewedAirportNameIssue[] = [];
  const list = typeof value === "object" && value !== null ? (value as { airports?: unknown }).airports : undefined;
  if (!Array.isArray(list)) return { entries: [], issues: [{ index: 0, code: null, problem: "NO_LIST" }] };
  const entries: ReviewedAirportName[] = [];
  const seen = new Set<string>();
  list.forEach((raw: unknown, i) => {
    const index = i + 1;
    const row = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const code = typeof row["code"] === "string" ? row["code"] : null;
    const report = (problem: ReviewedAirportNameProblem, extra: Pick<ReviewedAirportNameIssue, "language" | "text" | "chars"> = {}): void => {
      issues.push({ index, code, problem, ...extra });
    };
    if (code === null || !isIataCode(code)) return report("CODE_FORMAT");
    if (seen.has(code)) return report("DUPLICATE");
    seen.add(code);
    const country = row["country"];
    if (typeof country !== "string" || !isCountryCode(country)) return report("COUNTRY_FORMAT");
    const names = (typeof row["names"] === "object" && row["names"] !== null ? row["names"] : {}) as Record<string, unknown>;
    const sources = (typeof row["sources"] === "object" && row["sources"] !== null ? row["sources"] : {}) as Record<string, unknown>;
    const entry: ReviewedAirportName = { code, country, names: {}, sources: {} };
    for (const key of Object.keys(names)) {
      if (!(AIRPORT_NAME_LANGUAGES as readonly string[]).includes(key)) report("UNKNOWN_LANGUAGE", { language: key });
    }
    for (const language of AIRPORT_NAME_LANGUAGES) {
      const text = names[language];
      if (text === undefined) continue;
      if (typeof text !== "string" || !hasVisibleText(text) || text !== text.trim() || text.length > MAX_NAME_LENGTH) {
        report("NAME_FORMAT", { language });
        continue;
      }
      if (language === "zh") {
        const bad = [...new Set(text.match(NOT_SIMPLIFIED) ?? [])];
        if (bad.length > 0) report("NOT_SIMPLIFIED", { language, text, chars: bad.join("") });
      }
      if (language === "ja" && !JAPANESE_TEXT.test(text)) report("NOT_JAPANESE", { language, text });
      const ref = sources[language];
      if (typeof ref !== "string" || !hasVisibleText(ref) || ref.length > MAX_REF_LENGTH) report("NO_SOURCE", { language });
      else {
        entry.names[language] = text;
        entry.sources[language] = ref;
      }
    }
    if (Object.keys(entry.names).length === 0) report("NOTHING_TO_FILL");
    entries.push(entry);
  });
  return issues.length > 0 ? { entries: [], issues } : { entries, issues };
}

export interface ReviewedAirportNameFill {
  id: string;
  code: string;
  languages: AirportNameLanguage[];
  before: LocalizedText;
  after: LocalizedText;
  nameSources: NameSources;
  /** 这次填的每种语言的来源说明 */
  refs: Partial<Record<AirportNameLanguage, string>>;
}

export interface ReviewedAirportNamePlan {
  fills: ReviewedAirportNameFill[];
  /** 表里有、库里也有，但没有要填的（都已经有了） */
  unchanged: string[];
  /** 已经有名称、和表里的不一样，没有覆盖 */
  keptFilled: { code: string; language: AirportNameLanguage; current: string; incoming: string }[];
  /** 以前由导入填过、后来平台在后台删掉了：不再补回去 */
  keptCleared: { code: string; language: AirportNameLanguage; incoming: string }[];
  /**
   * 交给人看、这次没有动的：COUNTRY_MISMATCH 国家对不上（country 是表里的、actual 是库里的）；CHANGED_DURING_IMPORT 写入期间平台在后台改了这个机场
   */
  conflicts: { code: string; problem: "COUNTRY_MISMATCH" | "CHANGED_DURING_IMPORT"; country?: string; actual?: string }[];
  /** 表里有、库里没有这个机场（还没导入），不用管 */
  notInDatabase: string[];
}

/** 比较核对表和库里的机场，算出要给哪些机场填哪种语言。同一张表运行两次，第二次什么都不用做。 */
export function planReviewedAirportNames(existing: readonly ExistingAirportNames[], entries: readonly ReviewedAirportName[], countries: readonly string[]): ReviewedAirportNamePlan {
  const scope = new Set(countries);
  const byCode = new Map(existing.map((airport) => [airport.code, airport]));
  const plan: ReviewedAirportNamePlan = { fills: [], unchanged: [], keptFilled: [], keptCleared: [], conflicts: [], notInDatabase: [] };
  for (const entry of [...entries].sort((x, y) => (x.code < y.code ? -1 : x.code > y.code ? 1 : 0))) {
    if (!scope.has(entry.country)) continue;
    const airport = byCode.get(entry.code);
    if (airport === undefined) {
      plan.notInDatabase.push(entry.code);
      continue;
    }
    if (airport.countryCode !== entry.country) {
      plan.conflicts.push({ code: entry.code, problem: "COUNTRY_MISMATCH", country: entry.country, actual: airport.countryCode });
      continue;
    }
    const name: LocalizedText = { ...airport.name };
    const nameSources: NameSources = { ...airport.nameSources };
    const languages: AirportNameLanguage[] = [];
    const refs: Partial<Record<AirportNameLanguage, string>> = {};
    for (const language of AIRPORT_NAME_LANGUAGES) {
      const text = entry.names[language];
      const ref = entry.sources[language];
      if (text === undefined || ref === undefined) continue;
      const current = airport.name[language];
      if (current !== undefined && hasVisibleText(current)) {
        if (current !== text) plan.keptFilled.push({ code: entry.code, language, current, incoming: text });
        continue;
      }
      if (airport.nameSources[language] !== undefined) {
        plan.keptCleared.push({ code: entry.code, language, incoming: text });
        continue;
      }
      name[language] = text;
      nameSources[language] = { source: REVIEWED_AIRPORT_NAMES_SOURCE, ref, text };
      refs[language] = ref;
      languages.push(language);
    }
    if (languages.length === 0) plan.unchanged.push(entry.code);
    else plan.fills.push({ id: airport.id, code: airport.code, languages, before: airport.name, after: name, nameSources, refs });
  }
  return plan;
}
