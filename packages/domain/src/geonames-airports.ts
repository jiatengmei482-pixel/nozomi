/**
 * 机场的中文名、日文名从 GeoNames 导入（M1-15，ADR 0024）。
 *
 * - 来源：GeoNames，https://www.geonames.org/ ；许可：知识共享 署名 4.0（CC BY 4.0），使用时须注明来源；对方不保证准确。
 * - 用到同一个国家的两种文件（制表符分隔的 UTF-8 文本，下载下来是 zip）：
 *   - `https://download.geonames.org/export/dump/<国家码>.zip`：这个国家的全部地理名称记录（19 列）。
 *     类型（feature code）是 AIRP 的才算机场——同一个三字码在各语言名称文件里也会挂在城市、街区上
 *     （NRT 同时挂在成田机场和成田市上，HND 同时挂在羽田机场和羽田这个街区上），所以必须先用它认出机场；
 *   - `https://download.geonames.org/export/dump/alternatenames/<国家码>.zip`：各语言的名称。
 *     语言一栏是 `iata` 的那一行就是机场的三字码，`ja` / `zh…` 是日文、中文名称。
 * - 按三字码对应到库里的机场（`places` 里类型是机场、编码就是三字码的那些）。
 *
 * 这里是纯函数：从文件内容里挑出机场和它们的日文、中文名，再和库里已有的机场比较，算出这次要给哪些机场填哪种语言。
 * 读文件、下载、解压、写数据库都在 apps/api 里。
 */
import { CsvError } from "./csv.ts";
import { haversineMeters } from "./geo.ts";
import { type LocalizedText, hasVisibleText, isCountryCode, isIataCode, isLatitude, isLongitude, roundCoordinate } from "./master-data.ts";

/** 这个导入只管这两种语言。英文名来自 OurAirports（机场导入），韩文名目前不导入。 */
export const AIRPORT_NAME_LANGUAGES = ["ja", "zh"] as const;
export type AirportNameLanguage = (typeof AIRPORT_NAME_LANGUAGES)[number];

/**
 * GeoNames 的机场和库里的机场坐标相差超过这个距离（米），就不当作同一个机场，列出来交给人看。
 * 两个数据源给同一个机场的坐标一般相差不到 3 公里（取的是跑道中点还是航站楼）；10 公里以上多半是三字码挂错了记录。
 */
export const SAME_AIRPORT_DISTANCE_METERS = 10_000;

const COUNTRY_FILE_COLUMNS = 19;
const MAX_NAME_LENGTH = 200;
const DECIMAL_NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

/**
 * 中文名只要简体：明确标了简体的优先（`zh-CN` > `zh-Hans` > `zh-SG`），其次是只标了 `zh` 的。
 * `zh-Hant`、`zh-TW`、`zh-HK`、`zh-MO`（繁体）、`yue`（粤语）、`wuu`（吴语）不取。
 * 只标了 `zh` 的在日本的机场里大多是繁体（「松本機場」「東京國際機場」），所以任何一条中文名里出现繁体专用字
 * （见 TRADITIONAL_ONLY）就不要它；这个机场的中文名留空，由平台在后台填。
 */
const ZH_TAGS: readonly string[] = ["zh-CN", "zh-Hans", "zh-SG", "zh"];

/**
 * 繁体专用字：这些字在简体中文里都有另一种写法（機→机、場→场、國→国……），简体的文字里不会出现。
 * 只收了地名、机场名里常见的字，用来认出「标成 zh、其实是繁体」的名称；不是完整的繁简对照表，也不做转换。
 */
const TRADITIONAL_ONLY = new Set(
  [..."機場國際東島廣帶歲館釧滿內對馬奧長門關灣臺縣區鄉鎮華雲豐濱澤戶與論慶間飛見岡隱陽陸線鐵車號樓橋龍鳥嶼頭風開發圓萬寶興蘭蘇溫漢寧學運遠達邊舊樂經營黃葉齊嶺峽濟維綠陳鄭趙錦銀鏡隊險電領顯麗壓劍聖臨淺廳庫亞熱賀輪壽"],
);

export function looksTraditionalChinese(text: string): boolean {
  for (const char of text) if (TRADITIONAL_ONLY.has(char)) return true;
  return false;
}

/** 日文名里至少要有汉字或假名、中文名里至少要有汉字：数据源里标成 ja 的有不少是罗马字（「Kansai Kokusai Kūkō」）。 */
function isCjkName(language: AirportNameLanguage, text: string): boolean {
  return language === "ja" ? /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text) : /\p{Script=Han}/u.test(text);
}

function languageOf(tag: string): AirportNameLanguage | null {
  if (tag === "ja") return "ja";
  return ZH_TAGS.includes(tag) ? "zh" : null;
}

/**
 * 同一种语言有多个名称时取哪个，数字越小越好：
 * 先看语言标签（中文按 ZH_TAGS 的顺序），同一个标签里「首选的简称」>「简称」>「首选」> 其余；
 * 还一样就取数据源里编号最小的那条（最早录入的，一般是正式名称：羽田是「東京国際空港」而不是「羽田空港」）。
 */
function nameRank(language: AirportNameLanguage, tag: string, preferred: boolean, short: boolean): number {
  const kind = preferred && short ? 0 : short ? 1 : preferred ? 2 : 3;
  return (language === "ja" ? 0 : ZH_TAGS.indexOf(tag)) * 4 + kind;
}

/** 数据源里的一个机场：三字码、坐标和挑出来的日文、中文名。 */
export interface SourceAirportNames {
  /** GeoNames 的编号（geonameid） */
  sourceRef: string;
  iata: string;
  countryCode: string;
  /** 数据源里的主名称（一般是英文），给输出用 */
  label: string;
  lat: number;
  lng: number;
  /** 数据源里有的语言才有 */
  names: Partial<Record<AirportNameLanguage, string>>;
  /** 数据源里有中文名，但都是繁体（所以 names 里没有 zh） */
  traditionalOnly: boolean;
}

export interface SkippedAirportNameRow {
  /** 国家文件里的第几行 */
  row: number;
  label: string;
  reason: string;
}

export interface AirportNameSelection {
  /** 所选国家里类型是机场（AIRP）的记录数 */
  totalAirports: number;
  /** 有三字码、数据合格的机场，按三字码排序；一个三字码只出现一次 */
  airports: SourceAirportNames[];
  /** 没有三字码的机场记录数（小机场、军用机场多半没有） */
  withoutIata: number;
  /** 同一个三字码挂在好几个机场记录上：分不清是哪一个，都不用 */
  ambiguous: { iata: string; refs: string[] }[];
  /** 机场记录本身不合格（列数不对、坐标不对） */
  skipped: SkippedAirportNameRow[];
}

function lines(text: string): string[] {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return body.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

interface AirportRecord {
  sourceRef: string;
  countryCode: string;
  label: string;
  lat: number;
  lng: number;
}

function readCountryFiles(texts: readonly string[], countries: ReadonlySet<string>, skipped: SkippedAirportNameRow[]): Map<string, AirportRecord> {
  const airports = new Map<string, AirportRecord>();
  for (const text of texts) {
    const rows = lines(text);
    while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
    if (rows.length === 0) throw new CsvError("国家文件是空的");
    if ((rows[0] as string).split("\t").length !== COUNTRY_FILE_COLUMNS) {
      throw new CsvError(`国家文件不是 GeoNames 的 <国家码>.txt：每行应当有 ${COUNTRY_FILE_COLUMNS} 列（制表符分隔）`);
    }
    for (const [index, line] of rows.entries()) {
      if (line.includes("\u0000")) throw new CsvError(`国家文件的第 ${index + 1} 行里有 NUL 字符，文件可能已损坏或不是文本文件。请重新下载后再试`);
      const cells = line.split("\t");
      if (cells[7] !== "AIRP" || cells[6] !== "S") continue;
      const countryCode = (cells[8] ?? "").trim();
      if (!countries.has(countryCode)) continue;
      const sourceRef = (cells[0] ?? "").trim();
      const label = (cells[1] ?? "").trim() || sourceRef;
      const lat = DECIMAL_NUMBER.test((cells[4] ?? "").trim()) ? Number(cells[4]) : Number.NaN;
      const lng = DECIMAL_NUMBER.test((cells[5] ?? "").trim()) ? Number(cells[5]) : Number.NaN;
      const skip = (reason: string): void => {
        skipped.push({ row: index + 1, label, reason });
      };
      if (cells.length !== COUNTRY_FILE_COLUMNS) skip(`这一行有 ${cells.length} 列，应当是 ${COUNTRY_FILE_COLUMNS} 列`);
      else if (!/^[1-9]\d{0,9}$/.test(sourceRef)) skip("数据源编号不是数字");
      else if (airports.has(sourceRef)) skip("数据源编号在文件里重复出现");
      else if (!isLatitude(lat) || !isLongitude(lng)) skip("坐标缺失或超出范围（要求十进制数字）");
      else airports.set(sourceRef, { sourceRef, countryCode, label, lat: roundCoordinate(lat), lng: roundCoordinate(lng) });
    }
  }
  return airports;
}

interface Candidate {
  rank: number;
  order: number;
  text: string;
}

function better(current: Candidate | undefined, next: Candidate): boolean {
  return current === undefined || next.rank < current.rank || (next.rank === current.rank && next.order < current.order);
}

/**
 * 从国家文件里认出所选国家的机场，再从各语言名称文件里给它们配上三字码和日文、中文名。
 * 两种文件都可以给多个（每个国家一个）；名称文件里不是机场的记录、俗称、历史名称一律不看。
 */
export function selectAirportNames(countryTexts: readonly string[], namesTexts: readonly string[], countries: readonly string[]): AirportNameSelection {
  const wanted = new Set(countries.filter(isCountryCode));
  const skipped: SkippedAirportNameRow[] = [];
  const records = readCountryFiles(countryTexts, wanted, skipped);
  const codes = new Map<string, Set<string>>();
  const best = new Map<string, Partial<Record<AirportNameLanguage, Candidate>>>();
  const traditional = new Set<string>();
  for (const text of namesTexts) {
    for (const [index, line] of lines(text).entries()) {
      if (line === "") continue;
      if (line.includes("\u0000")) throw new CsvError(`名称文件的第 ${index + 1} 行里有 NUL 字符，文件可能已损坏或不是文本文件。请重新下载后再试`);
      const cells = line.split("\t");
      if (cells.length < 4) throw new CsvError(`名称文件的第 ${index + 1} 行不是 GeoNames 的 alternateNames 格式（至少要有 4 列）`);
      const [nameId, geonameId, tag, rawName, preferred, short, colloquial, historic] = cells;
      if (geonameId === undefined || tag === undefined || rawName === undefined || !records.has(geonameId)) continue;
      if (colloquial === "1" || historic === "1") continue;
      const text = rawName.trim();
      if (tag === "iata") {
        if (isIataCode(text)) (codes.get(geonameId) ?? codes.set(geonameId, new Set()).get(geonameId))?.add(text);
        continue;
      }
      const language = languageOf(tag);
      if (language === null || !hasVisibleText(text) || text.length > MAX_NAME_LENGTH || !isCjkName(language, text)) continue;
      if (language === "zh" && looksTraditionalChinese(text)) {
        traditional.add(geonameId);
        continue;
      }
      const candidate: Candidate = { rank: nameRank(language, tag, preferred === "1", short === "1"), order: /^\d+$/.test(nameId ?? "") ? Number(nameId) : Number.MAX_SAFE_INTEGER, text };
      const entry = best.get(geonameId) ?? {};
      if (better(entry[language], candidate)) entry[language] = candidate;
      best.set(geonameId, entry);
    }
  }

  const byIata = new Map<string, SourceAirportNames[]>();
  let withoutIata = 0;
  for (const record of records.values()) {
    const iataCodes = codes.get(record.sourceRef);
    if (iataCodes === undefined) {
      withoutIata += 1;
      continue;
    }
    const picked = best.get(record.sourceRef) ?? {};
    const names: Partial<Record<AirportNameLanguage, string>> = {};
    for (const language of AIRPORT_NAME_LANGUAGES) {
      const candidate = picked[language];
      if (candidate !== undefined) names[language] = candidate.text;
    }
    for (const iata of iataCodes) {
      const airport: SourceAirportNames = { ...record, iata, names, traditionalOnly: names.zh === undefined && traditional.has(record.sourceRef) };
      byIata.set(iata, [...(byIata.get(iata) ?? []), airport]);
    }
  }
  const airports: SourceAirportNames[] = [];
  const ambiguous: { iata: string; refs: string[] }[] = [];
  for (const [iata, list] of [...byIata].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) {
    if (list.length === 1) airports.push(list[0] as SourceAirportNames);
    else ambiguous.push({ iata, refs: list.map((airport) => airport.sourceRef).sort() });
  }
  return { totalAirports: records.size, airports, withoutIata, ambiguous, skipped };
}

/** 某种语言的名称是哪次导入填的：数据源、数据源编号、当时填进去的文字。存在 `places.name_sources` 里。 */
export interface NameSource {
  source: string;
  ref: string;
  text: string;
}
export type NameSources = Partial<Record<AirportNameLanguage, NameSource>>;

/** 库里已有的一个机场（手工录入的和从 OurAirports 导入的都算）。 */
export interface ExistingAirportNames {
  id: string;
  code: string;
  countryCode: string;
  name: LocalizedText;
  lat: number;
  lng: number;
  nameSources: NameSources;
}

export interface AirportNameFill {
  id: string;
  code: string;
  sourceRef: string;
  /** 这次填了哪几种语言 */
  languages: AirportNameLanguage[];
  before: LocalizedText;
  after: LocalizedText;
  nameSources: NameSources;
}

export interface AirportNamePlan {
  fills: AirportNameFill[];
  /** 对上了、但没有要填的（两种语言都已经有了，或数据源里没有这两种语言）的机场编码 */
  unchanged: string[];
  /** 已经有名称、和数据源的不一样，没有覆盖 */
  keptFilled: { code: string; language: AirportNameLanguage; current: string; incoming: string; importedBefore: boolean }[];
  /** 以前由导入填过、后来平台在后台删掉了：不再补回去 */
  keptCleared: { code: string; language: AirportNameLanguage; incoming: string }[];
  /** 对不上、交给人处理的（这次没有动它们） */
  conflicts: { code: string; reason: string }[];
  /** 库里有、数据源里找不到这个三字码的机场 */
  notFound: string[];
  /** 中文名空着、数据源里只有繁体的机场（中文名没有填） */
  traditionalOnly: string[];
}

function isEmpty(text: string | undefined): boolean {
  return text === undefined || !hasVisibleText(text);
}

/**
 * 比较数据源和库里的机场，算出这次要给哪些机场填哪种语言。同一批文件导入两次，第二次什么都不用做。
 *
 * - 只看所选国家里的机场；按三字码（机场的编码）对应。
 * - 只填空着的语言。已经有名称的（不管是平台填的还是以前导入的）一律不改。
 * - 「人工改过」用和城市导入一样的思路判断——记下导入写进去的是什么，和现在的值比：
 *   以前由导入填过、现在空了，说明平台在后台删掉了，不再补回去；现在的值和导入写的不一样，说明平台改过，不覆盖。
 * - 国家对不上、坐标相差超过 10 公里、三字码在数据源里挂了好几个机场：不填，列出来交给人看。
 */
export function planAirportNameImport(existing: readonly ExistingAirportNames[], selection: AirportNameSelection, countries: readonly string[], source: string): AirportNamePlan {
  const scope = new Set(countries);
  const byIata = new Map(selection.airports.map((airport) => [airport.iata, airport]));
  const ambiguous = new Map(selection.ambiguous.map((entry) => [entry.iata, entry.refs]));
  const plan: AirportNamePlan = { fills: [], unchanged: [], keptFilled: [], keptCleared: [], conflicts: [], notFound: [], traditionalOnly: [] };
  for (const airport of [...existing].sort((x, y) => (x.code < y.code ? -1 : x.code > y.code ? 1 : 0))) {
    if (!scope.has(airport.countryCode)) continue;
    const refs = ambiguous.get(airport.code);
    if (refs !== undefined) {
      plan.conflicts.push({ code: airport.code, reason: `数据源里有 ${refs.length} 个机场记录都用这个三字码（${refs.join("、")}），分不清是哪一个，没有填` });
      continue;
    }
    const incoming = byIata.get(airport.code);
    if (incoming === undefined) {
      plan.notFound.push(airport.code);
      continue;
    }
    if (incoming.countryCode !== airport.countryCode) {
      plan.conflicts.push({ code: airport.code, reason: `数据源里这个三字码的机场在 ${incoming.countryCode}，库里的在 ${airport.countryCode}，没有填` });
      continue;
    }
    const meters = haversineMeters({ lat: airport.lat, lng: airport.lng }, { lat: incoming.lat, lng: incoming.lng });
    if (meters > SAME_AIRPORT_DISTANCE_METERS) {
      plan.conflicts.push({ code: airport.code, reason: `数据源里这个三字码的机场「${incoming.label}」和库里的坐标相差约 ${Math.round(meters / 1000)} 公里，可能不是同一个机场，没有填` });
      continue;
    }
    const name: LocalizedText = { ...airport.name };
    const nameSources: NameSources = { ...airport.nameSources };
    const languages: AirportNameLanguage[] = [];
    for (const language of AIRPORT_NAME_LANGUAGES) {
      const text = incoming.names[language];
      const current = airport.name[language];
      const imported = airport.nameSources[language];
      if (text === undefined) {
        if (language === "zh" && incoming.traditionalOnly && isEmpty(current)) plan.traditionalOnly.push(airport.code);
        continue;
      }
      if (!isEmpty(current)) {
        if (current !== text) plan.keptFilled.push({ code: airport.code, language, current: current as string, incoming: text, importedBefore: imported?.text === current });
        continue;
      }
      if (imported !== undefined) {
        plan.keptCleared.push({ code: airport.code, language, incoming: text });
        continue;
      }
      name[language] = text;
      nameSources[language] = { source, ref: incoming.sourceRef, text };
      languages.push(language);
    }
    if (languages.length === 0) plan.unchanged.push(airport.code);
    else plan.fills.push({ id: airport.id, code: airport.code, sourceRef: incoming.sourceRef, languages, before: airport.name, after: name, nameSources });
  }
  return plan;
}
