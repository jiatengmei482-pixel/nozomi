/**
 * 城市主数据的公开数据源：GeoNames（M1-09 验收标准「主要城市从注明来源和许可的公开数据导入」）。
 *
 * - 来源：GeoNames，https://www.geonames.org/
 * - 许可：知识共享 署名 4.0（CC BY 4.0，https://creativecommons.org/licenses/by/4.0/）。可以商用和修改，条件是注明来源。
 *   数据「按原样」提供，对方不保证准确、及时、完整——所以导入的城市默认是停用的，由平台复核后启用。
 * - 用到的文件（制表符分隔的 UTF-8 文本，下载下来是 zip）：
 *   - https://download.geonames.org/export/dump/cities15000.zip：人口 1.5 万以上的城市和各级首府，带坐标、IANA 时区、人口；
 *   - https://download.geonames.org/export/dump/alternatenames/<国家码>.zip：各语言的名称（日文、中文、韩文从这里来）。
 *
 * 这里是纯函数：从文件内容里挑出要导入的城市、配上各语言的名称，再和库里已有的城市比较，算出这次导入要做什么。
 * 读文件、下载、解压、写数据库都在 apps/api 里。
 */
import { CsvError } from "./csv.ts";
import { haversineMeters } from "./geo.ts";
import {
  type LocalizedText,
  MASTER_DATA_LANGUAGES,
  type MasterDataLanguage,
  hasVisibleText,
  isCountryCode,
  isIanaTimeZone,
  isLatitude,
  isLongitude,
  roundCoordinate,
} from "./master-data.ts";

const DUMP = "https://download.geonames.org/export/dump";

export const GEONAMES = {
  /** 写进 cities.source 的标识 */
  source: "geonames",
  name: "GeoNames",
  homepage: "https://www.geonames.org/",
  license: "知识共享 署名 4.0（CC BY 4.0），使用时须注明来源 GeoNames；不保证准确",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  citiesUrl: `${DUMP}/cities15000.zip`,
  /** zip 里的文件名 */
  citiesEntry: "cities15000.txt",
} as const;

/** 某个国家的各语言名称文件的下载地址和 zip 里的文件名。 */
export function geonamesNamesFile(countryCode: string): { url: string; entry: string } {
  return { url: `${DUMP}/alternatenames/${countryCode}.zip`, entry: `${countryCode}.txt` };
}

/**
 * 默认的导入范围：人口 30 万以上的城市，外加首都和一级行政区（都道府县、道 / 广域市）的首府。
 * 按 2026-10-08 的文件，去掉区和市内的街区之后日本 84 个、韩国 35 个——是「会有接送需求的城市」的量级，而不是几千个町村。
 */
export const DEFAULT_MIN_POPULATION = 300_000;

/** 算作「城市」的类型：一般的聚居地和各级首府。城市里的区（PPLX）、已废弃的、历史上的都不算。 */
const CITY_FEATURE_CODES: readonly string[] = ["PPL", "PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLC", "PPLG"];
/** 各级行政区的首府 */
const SEAT_FEATURE_CODES: readonly string[] = ["PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLC"];
/**
 * 光看类型分不出「城市」和「城市里的区」：东京 23 区在 GeoNames 里和川崎、八王子一样是 PPLA2（二级行政区的首府），
 * 还有一些街区被标成 PPL 并带着所在城市的人口。下面两种不算城市（M1-11）：
 *
 * 1. 区：日本的记录，日文名里有以「区」结尾的（大田区、葛飾区），并且没有以「市」「町」「村」结尾的。
 *    需要各语言名称文件；没给名称文件时这一条判断不了，不排除。
 * 2. 市内的街区：类型是 PPL（不是任何一级的首府），而文件里同一个二级行政区（国家 + admin1 + admin2）另有一条首府记录——
 *    那条首府记录才是这个市本身（相原 → 相模原、湊 → 和歌山）。二级行政区代码为空的不适用。
 */
export type ExcludedCityReason = "ward" | "inside_city";
export const EXCLUDED_CITY_REASON_NAMES: Readonly<Record<ExcludedCityReason, string>> = {
  ward: "是城市里的区（日文名以「区」结尾），不是城市",
  inside_city: "是某个市里面的街区（同一个市另有一条首府记录），不是城市",
};
/** 不论人口多少都导入的类型：首都、一级行政区首府。 */
const ALWAYS_IMPORTED_CODES: readonly string[] = ["PPLC", "PPLA"];
const CITY_COLUMNS = 19;
const MAX_NAME_LENGTH = 200;
// 写成「整数部分 + 可选的小数部分」：`\d+\.?\d*` 对一长串数字有很多种拆法，不匹配时回溯次数随长度的平方增长
const DECIMAL_NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;
/** 手工建的城市和数据源里的城市相距这么近（米）就当作「看起来是同一个」，交给人判断 */
export const SAME_CITY_DISTANCE_METERS = 5_000;

/**
 * 导入的城市的编码：`CTY-国家码-G` + 数据源编号的 36 进制写法（如东京 1850147 → CTY-JP-G13NKZ）。
 * 编码只由数据源编号决定：同一个城市在任何环境、任何一次导入里都得到同一个编码，和导入的范围、顺序、
 * 库里已有多少城市都无关；也不会和手工起的助记码（CTY-JP-TYO）抢号。
 */
export function geonamesCityCode(countryCode: string, geonameId: number): string {
  return `CTY-${countryCode}-G${geonameId.toString(36).toUpperCase()}`;
}

export interface SourceCity {
  /** GeoNames 的编号（geonameid）：用它识别「同一个城市」 */
  sourceRef: string;
  code: string;
  countryCode: string;
  /** 数据源里有的语言才有；英文一定有 */
  name: LocalizedText;
  timezone: string;
  lng: number;
  lat: number;
  population: number;
}

export interface SkippedCityRow {
  /** 文件里的第几行 */
  row: number;
  label: string;
  reason: string;
}

export interface ExcludedCity {
  sourceRef: string;
  label: string;
  reason: ExcludedCityReason;
}

export interface CitySelection {
  /** 城市文件的总行数 */
  totalRows: number;
  /** 按人口从多到少 */
  cities: SourceCity[];
  /** 在导入范围内、但数据不合格而跳过的行 */
  skipped: SkippedCityRow[];
  /** 人口和类型都在导入范围内、但其实是区或市内街区而没有选的记录 */
  excluded: ExcludedCity[];
}

export interface CitySelectionOptions {
  /** 只导入这些国家（ISO 3166-1 alpha-2）；null 表示全部国家 */
  countries: readonly string[] | null;
  minPopulation: number;
}

function lines(text: string): string[] {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return body.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

/** 中文只取简体的写法：数据源里标成 zh 的常常是繁体，所以明确标了简体的优先。 */
const LANGUAGE_TAGS: Readonly<Record<MasterDataLanguage, readonly string[]>> = {
  ja: ["ja"],
  zh: ["zh-CN", "zh-Hans", "zh-SG", "zh"],
  en: ["en"],
  ko: ["ko"],
};

/** 同一种语言有多个名称时取哪个：标签越靠前越好；同一个标签里「首选的简称」>「简称」>「首选」> 其余。数字越小越好。 */
function nameRank(language: MasterDataLanguage, tag: string, preferred: boolean, short: boolean): number {
  const kind = preferred && short ? 0 : short ? 1 : preferred ? 2 : 3;
  return LANGUAGE_TAGS[language].indexOf(tag) * 4 + kind;
}

/**
 * 从各语言名称文件里给选中的城市挑名称（城市编号 → 语言 → 名称），顺便找出其中日文名说明它是「区」的那些。
 */
function pickNames(namesTexts: readonly string[], wanted: ReadonlySet<string>): { names: Map<string, LocalizedText>; wards: Set<string> } {
  const best = new Map<string, Partial<Record<MasterDataLanguage, { rank: number; text: string }>>>();
  const wardLike = new Set<string>();
  const cityLike = new Set<string>();
  for (const text of namesTexts) {
    for (const [index, line] of lines(text).entries()) {
      if (line === "") continue;
      if (line.includes("\u0000")) throw new CsvError(`名称文件的第 ${index + 1} 行里有 NUL 字符，文件可能已损坏或不是文本文件。请重新下载后再试`);
      const cells = line.split("\t");
      if (cells.length < 4) throw new CsvError(`名称文件的第 ${index + 1} 行不是 GeoNames 的 alternateNames 格式（至少要有 4 列）`);
      const [, geonameId, tag, rawName, preferred, short, colloquial, historic] = cells;
      if (geonameId === undefined || tag === undefined || rawName === undefined || !wanted.has(geonameId)) continue;
      if (colloquial === "1" || historic === "1") continue;
      const language = MASTER_DATA_LANGUAGES.find((candidate) => LANGUAGE_TAGS[candidate].includes(tag));
      const name = rawName.trim();
      if (language === undefined || !hasVisibleText(name) || name.length > MAX_NAME_LENGTH) continue;
      if (language === "ja" && name.endsWith("区")) wardLike.add(geonameId);
      if (language === "ja" && /[市町村]$/.test(name)) cityLike.add(geonameId);
      const rank = nameRank(language, tag, preferred === "1", short === "1");
      const entry = best.get(geonameId) ?? {};
      const current = entry[language];
      if (current === undefined || rank < current.rank) entry[language] = { rank, text: name };
      best.set(geonameId, entry);
    }
  }
  const result = new Map<string, LocalizedText>();
  for (const [geonameId, entry] of best) {
    const names: LocalizedText = {};
    for (const language of MASTER_DATA_LANGUAGES) {
      const picked = entry[language];
      if (picked !== undefined) names[language] = picked.text;
    }
    result.set(geonameId, names);
  }
  return { names: result, wards: new Set([...wardLike].filter((geonameId) => !cityLike.has(geonameId))) };
}

/**
 * 从城市文件（cities15000.txt）里挑出要导入的城市，并从各语言名称文件里配上日文、中文、英文、韩文的名称。
 * 名称文件可以不给：那样只有英文名（城市文件自带）。数据源里没有的语言不会编出来。
 */
export function selectCities(citiesText: string, namesTexts: readonly string[], options: CitySelectionOptions): CitySelection {
  const rows = lines(citiesText);
  while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
  if (rows.length === 0) throw new CsvError("城市文件是空的");
  if ((rows[0] as string).split("\t").length !== CITY_COLUMNS) {
    throw new CsvError(`城市文件不是 GeoNames 的 cities15000.txt：每行应当有 ${CITY_COLUMNS} 列（制表符分隔）`);
  }
  const wanted = options.countries === null ? null : new Set(options.countries);
  const selection: CitySelection = { totalRows: rows.length, cities: [], skipped: [], excluded: [] };
  const seen = new Set<string>();
  // 有首府记录的二级行政区，和每个候选所在的二级行政区、类型（判断「市内的街区」用）
  const seats = new Set<string>();
  const placement = new Map<string, { district: string | null; featureCode: string }>();
  for (const [index, line] of rows.entries()) {
    if (line.includes("\u0000")) throw new CsvError(`城市文件的第 ${index + 1} 行里有 NUL 字符，文件可能已损坏或不是文本文件。请重新下载后再试`);
    const cells = line.split("\t");
    const countryCode = (cells[8] ?? "").trim();
    if (wanted !== null && !wanted.has(countryCode)) continue;
    const sourceRef = (cells[0] ?? "").trim();
    const name = (cells[1] ?? "").trim();
    const skip = (reason: string): void => {
      selection.skipped.push({ row: index + 1, label: name || sourceRef || "（空行）", reason });
    };
    if (cells.length !== CITY_COLUMNS) {
      skip(`这一行有 ${cells.length} 列，应当是 ${CITY_COLUMNS} 列`);
      continue;
    }
    const featureCode = (cells[7] ?? "").trim();
    const admin2 = (cells[11] ?? "").trim();
    const district = admin2 === "" ? null : `${countryCode}|${(cells[10] ?? "").trim()}|${admin2}`;
    if (cells[6] === "P" && district !== null && SEAT_FEATURE_CODES.includes(featureCode)) seats.add(district);
    const populationText = (cells[14] ?? "").trim();
    const population = /^\d{1,12}$/.test(populationText) ? Number(populationText) : 0;
    if (cells[6] !== "P" || !CITY_FEATURE_CODES.includes(featureCode)) continue;
    if (population < options.minPopulation && !ALWAYS_IMPORTED_CODES.includes(featureCode)) continue;
    const latText = (cells[4] ?? "").trim();
    const lngText = (cells[5] ?? "").trim();
    const lat = DECIMAL_NUMBER.test(latText) ? Number(latText) : Number.NaN;
    const lng = DECIMAL_NUMBER.test(lngText) ? Number(lngText) : Number.NaN;
    const timezone = (cells[17] ?? "").trim();
    if (!/^[1-9]\d{0,9}$/.test(sourceRef)) skip("数据源编号不是数字");
    else if (seen.has(sourceRef)) skip("数据源编号在文件里重复出现");
    else if (!isCountryCode(countryCode)) skip(`国家码 ${countryCode || "（空）"} 不是合法的 ISO 3166-1 代码`);
    else if (!hasVisibleText(name) || name.length > MAX_NAME_LENGTH) skip("名称为空或超过 200 个字符");
    else if (!isLatitude(lat) || !isLongitude(lng)) skip("坐标缺失或超出范围（要求十进制数字）");
    else if (roundCoordinate(lat) === 0 && roundCoordinate(lng) === 0) skip("坐标是 (0, 0)，多半是没有填");
    else if (!isIanaTimeZone(timezone)) skip(`时区 ${timezone || "（空）"} 不是合法的 IANA 时区名`);
    else {
      seen.add(sourceRef);
      placement.set(sourceRef, { district, featureCode });
      selection.cities.push({
        sourceRef,
        code: geonamesCityCode(countryCode, Number(sourceRef)),
        countryCode,
        name: { en: name },
        timezone,
        lng: roundCoordinate(lng),
        lat: roundCoordinate(lat),
        population,
      });
    }
  }
  const { names, wards } = pickNames(namesTexts, seen);
  for (const city of selection.cities) city.name = { ...city.name, ...names.get(city.sourceRef) };
  const excludedReason = (city: SourceCity): ExcludedCityReason | null => {
    if (city.countryCode === "JP" && wards.has(city.sourceRef)) return "ward";
    const placed = placement.get(city.sourceRef);
    return placed && placed.featureCode === "PPL" && placed.district !== null && seats.has(placed.district) ? "inside_city" : null;
  };
  const kept: SourceCity[] = [];
  for (const city of selection.cities) {
    const reason = excludedReason(city);
    if (reason === null) kept.push(city);
    else selection.excluded.push({ sourceRef: city.sourceRef, label: `${city.name.ja ?? city.name.en ?? city.code}（${city.code}）`, reason });
  }
  selection.cities = kept;
  selection.cities.sort((x, y) => y.population - x.population || Number(x.sourceRef) - Number(y.sourceRef));
  return selection;
}

/** 库里已有的一个城市（手工录入的和以前导入的都算）。 */
export interface ExistingCity {
  id: string;
  code: string;
  countryCode: string;
  name: LocalizedText;
  timezone: string;
  lng: number;
  lat: number;
  /** 以前从这个数据源导入时记下的编号；手工录入的为 null */
  sourceRef: string | null;
  /** 平台在后台改过它的名称、时区或坐标：导入不再覆盖 */
  sourceOverridden: boolean;
}

export interface CitySourceFields {
  name: LocalizedText;
  timezone: string;
  lng: number;
  lat: number;
}

export interface CityUpdate {
  id: string;
  code: string;
  before: CitySourceFields;
  after: CitySourceFields;
}

export interface CityImportPlan {
  creates: SourceCity[];
  updates: CityUpdate[];
  /** 和数据源一致、不需要改的城市的编码 */
  unchanged: string[];
  /** 平台改过、数据源里的值与之不同、这次没有覆盖的城市 */
  keptManual: string[];
  /** 需要人工处理、这次没有动的情况 */
  conflicts: { label: string; reason: string }[];
  /** 以前导入过、按现在的规则其实是区或市内街区的城市：不自动停用、不删除，列出来请人在后台核对后停用 */
  excludedExisting: { code: string; label: string; reason: ExcludedCityReason }[];
}

function sameText(x: string, y: string): boolean {
  return x.trim().toLocaleLowerCase("en") === y.trim().toLocaleLowerCase("en");
}

/** 两个城市有没有哪一种语言的名称是相同的（不区分大小写，不要求是同一种语言：「東京」在日文名和中文名里都可能出现）。 */
function shareName(x: LocalizedText, y: LocalizedText): boolean {
  const mine = Object.values(x);
  return Object.values(y).some((theirs) => mine.some((name) => sameText(name, theirs)));
}

function sameFields(x: CitySourceFields, y: CitySourceFields): boolean {
  const languages = new Set([...Object.keys(x.name), ...Object.keys(y.name)]) as Set<MasterDataLanguage>;
  return x.timezone === y.timezone && x.lng === y.lng && x.lat === y.lat && [...languages].every((language) => x.name[language] === y.name[language]);
}

/**
 * 比较数据源和库里的城市，算出这次导入要新增、更新哪些。同一批文件导入两次，第二次什么都不用做。
 *
 * - 按数据源编号认「同一个城市」：名称、时区或坐标变了就更新；平台改过的不覆盖。
 * - 数据源只管它提供的那几种语言的名称、时区和中心坐标：平台另外补的语言、边界、启用状态，导入不碰。
 * - 手工建的城市和数据源里的某个城市「看起来是同一个」（同一个国家，并且有相同的名称或相距不到 5 公里）：
 *   不自动合并，也不重复创建，列出来交给人看。
 * - 导入要用的编码已被别的城市占用、数据源里某个城市的国家变了：同样只列出来。
 * - 以前导入过、按现在的规则不算城市的（区、市内的街区）：不更新、不停用、不删除，列进 `excludedExisting` 交给人处理。
 */
export function planCityImport(existing: readonly ExistingCity[], selection: CitySelection): CityImportPlan {
  const byRef = new Map<string, ExistingCity>();
  const byCode = new Map<string, ExistingCity>();
  for (const city of existing) {
    if (city.sourceRef !== null) byRef.set(city.sourceRef, city);
    byCode.set(city.code, city);
  }
  const manual = existing.filter((city) => city.sourceRef === null);
  const plan: CityImportPlan = { creates: [], updates: [], unchanged: [], keptManual: [], conflicts: [], excludedExisting: [] };
  for (const excluded of selection.excluded) {
    const known = byRef.get(excluded.sourceRef);
    if (known) plan.excludedExisting.push({ code: known.code, label: excluded.label, reason: excluded.reason });
  }
  for (const incoming of selection.cities) {
    const label = `${incoming.name.en ?? incoming.code}（${incoming.code}）`;
    const known = byRef.get(incoming.sourceRef);
    if (!known) {
      const occupant = byCode.get(incoming.code);
      if (occupant) {
        plan.conflicts.push({ label, reason: "这个编码已被库里另一个城市使用，没有覆盖" });
        continue;
      }
      const twin = manual.find((city) => {
        if (city.countryCode !== incoming.countryCode) return false;
        return shareName(city.name, incoming.name) || haversineMeters({ lat: city.lat, lng: city.lng }, { lat: incoming.lat, lng: incoming.lng }) <= SAME_CITY_DISTANCE_METERS;
      });
      if (twin) {
        plan.conflicts.push({ label, reason: `后台已经有一个看起来相同的城市 ${twin.code}（名称相同或相距不到 5 公里），没有合并也没有重复创建` });
        continue;
      }
      plan.creates.push(incoming);
      continue;
    }
    if (known.countryCode !== incoming.countryCode) {
      plan.conflicts.push({ label, reason: `数据源里这个城市的国家由 ${known.countryCode} 变成了 ${incoming.countryCode}，没有自动修改` });
      continue;
    }
    const before: CitySourceFields = { name: known.name, timezone: known.timezone, lng: known.lng, lat: known.lat };
    // 数据源给了的语言用数据源的，平台另外补的语言保留
    const after: CitySourceFields = { name: { ...known.name, ...incoming.name }, timezone: incoming.timezone, lng: incoming.lng, lat: incoming.lat };
    if (sameFields(before, after)) plan.unchanged.push(known.code);
    else if (known.sourceOverridden) plan.keptManual.push(known.code);
    else plan.updates.push({ id: known.id, code: known.code, before, after });
  }
  return plan;
}
