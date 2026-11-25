/**
 * 航站楼核对表（M12-06，业主 2026-11-25「每个机场预先填好固定地址、每个航站楼的集合地点说明」）。
 *
 * 表放在仓库里（apps/api/masterdata/airport-terminals-reviewed.json），人核对过、每一项写明来源（只用机场官网、政府资料和维基数据，不用谷歌数据）。
 * 由 `pnpm masterdata:import-airport-terminals-reviewed` 写进库里：
 * - 机场：填空着的地址、集合地点说明（单航站楼的机场，集合地点挂在机场上）。
 * - 航站楼：库里没有就新建（编码「机场三字码-后缀」，挂在机场下，城市跟机场，机场启用时是启用的）；
 *   已有的只填空着的地址、集合地点说明、名称的语言，不覆盖平台改过的。坐标、国际 / 国内属性只在新建时用。
 * - 以前导入填过、后来平台删掉的不补回去（地址、集合地点看 places.content_sources，名称看 places.name_sources，同 ADR 0024 的做法）。
 * - 航站楼的坐标和机场相距超过 5 公里：这个航站楼不动，列出来交给人看。
 * - 表里有一处不合格，整张表不用。
 *
 * 这里只有纯函数：读表（readReviewedAirportTerminals）、比较表和库里的现状算出计划（planReviewedAirportTerminals）。读写库在 apps/api 的 services/reviewed-airport-terminals.ts。
 */
import { haversineMeters } from "./geo.ts";
import { type LocalizedText, type FlightScope, FLIGHT_SCOPES, MEETING_POINT_LANGUAGES, type MeetingPoint, hasVisibleText, isCountryCode, isIataCode, isLatitude, isLongitude, meetingPointIssues, placeAddressIssue, roundCoordinate, sameMeetingPoint } from "./master-data.ts";
import { REVIEWED_AIRPORT_NAMES_SOURCE, hasJapaneseText, nonSimplifiedChars } from "./reviewed-airport-names.ts";

/** 记在 name_sources / content_sources 里的来源：和机场名称核对表同一个（都是仓库里人核对过的表） */
export const REVIEWED_AIRPORT_TERMINALS_SOURCE = REVIEWED_AIRPORT_NAMES_SOURCE;
/** 航站楼的坐标和所属机场的坐标最多相距多少米；超过的多半是坐标抄错了，不用 */
export const TERMINAL_MAX_DISTANCE_METERS = 5_000;
/** 航站楼名称的语言：三种都要有 */
export const TERMINAL_NAME_LANGUAGES = ["ja", "zh", "en"] as const;
export type TerminalNameLanguage = (typeof TERMINAL_NAME_LANGUAGES)[number];

const MAX_NAME_LENGTH = 200;
const MAX_SOURCE_LENGTH = 300;
const MAX_SOURCES = 10;
const TERMINAL_SUFFIX = /^[A-Z0-9]{1,6}$/;
/** 日本的地址要带邮编（〒123-4567 或 123-4567） */
const JP_POSTCODE = /(?:〒\s*)?\d{3}-\d{4}/u;

export interface SourcedText {
  text: string;
  source: string;
}

export interface SourcedMeetingPoint {
  text: MeetingPoint;
  source: string;
}

export interface ReviewedTerminal {
  /** 后缀，如 T1；编码是「机场三字码-后缀」 */
  suffix: string;
  code: string;
  names: Record<TerminalNameLanguage, string>;
  lat: number;
  lng: number;
  coordSource: string;
  flightScope: FlightScope | null;
  address: SourcedText | null;
  meetingPoint: SourcedMeetingPoint;
  /** 名称等的来源（集合地点没有单独写来源时也用它） */
  sources: string[];
}

export interface ReviewedAirportTerminals {
  code: string;
  country: string;
  address: SourcedText;
  /** 只有没有列航站楼的（单航站楼的）机场有：集合地点挂在机场上 */
  meetingPoint: SourcedMeetingPoint | null;
  terminals: ReviewedTerminal[];
}

/**
 * 核对表的问题（只给代码，文字由命令行入口写，见 apps/api/src/cli/masterdata-import-airport-terminals-reviewed.ts）：
 * NO_LIST 整张表没有 airports；CODE_FORMAT 三字码格式；DUPLICATE 三字码重复；COUNTRY_FORMAT 国家码格式；
 * ADDRESS_FORMAT 地址不是 {text, source} 或文字不合格；NO_POSTCODE 日本的地址没有邮编；NOT_JAPANESE 日本的地址、日文名里没有汉字或假名；
 * NO_SOURCE 没写来源（field 说明是哪一项）；MEETING_POINT_FORMAT 集合地点格式（language 说明哪种语言）；
 * MEETING_POINT_PLACEMENT 集合地点挂错了地方（列了航站楼的机场不能在机场上写，没列航站楼的机场必须在机场上写）；
 * SUFFIX_FORMAT 航站楼后缀格式；SUFFIX_DUPLICATE 同一个机场的后缀重复；NAME_FORMAT 名称缺了或不合格；NOT_SIMPLIFIED 简体名里有繁体或日文字形；
 * COORDINATE 坐标不对；FLIGHT_SCOPE 国际 / 国内属性写错。
 */
export type ReviewedTerminalProblem =
  | "NO_LIST"
  | "CODE_FORMAT"
  | "DUPLICATE"
  | "COUNTRY_FORMAT"
  | "ADDRESS_FORMAT"
  | "NO_POSTCODE"
  | "NOT_JAPANESE"
  | "NO_SOURCE"
  | "MEETING_POINT_FORMAT"
  | "MEETING_POINT_PLACEMENT"
  | "SUFFIX_FORMAT"
  | "SUFFIX_DUPLICATE"
  | "NAME_FORMAT"
  | "NOT_SIMPLIFIED"
  | "COORDINATE"
  | "FLIGHT_SCOPE";

export interface ReviewedTerminalIssue {
  /** 第几个机场（从 1 数），整张表的问题是 0 */
  index: number;
  code: string | null;
  /** 航站楼的后缀（是航站楼的问题时）；后缀本身不合格时是第几个航站楼，如「#2」 */
  terminal?: string;
  problem: ReviewedTerminalProblem;
  /** 哪一项（address、meetingPoint、names、coordSource、sources、lat、lng）、哪种语言、什么文字、哪些字 */
  field?: string;
  language?: string;
  text?: string;
  chars?: string;
}

type Raw = Record<string, unknown>;
const asObject = (value: unknown): Raw | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Raw) : null);
const isSourceText = (value: unknown): value is string => typeof value === "string" && hasVisibleText(value) && value === value.trim() && value.length <= MAX_SOURCE_LENGTH;

/** 读核对表（JSON 解析后的值）。有任何一处不合格就整张表不用，把问题全列出来。 */
export function readReviewedAirportTerminals(value: unknown): { entries: ReviewedAirportTerminals[]; issues: ReviewedTerminalIssue[] } {
  const issues: ReviewedTerminalIssue[] = [];
  const list = asObject(value)?.["airports"];
  if (!Array.isArray(list)) return { entries: [], issues: [{ index: 0, code: null, problem: "NO_LIST" }] };
  const entries: ReviewedAirportTerminals[] = [];
  const seen = new Set<string>();
  list.forEach((raw: unknown, i) => {
    const index = i + 1;
    const row = asObject(raw) ?? {};
    const code = typeof row["code"] === "string" ? row["code"] : null;
    const report = (problem: ReviewedTerminalProblem, extra: Omit<ReviewedTerminalIssue, "index" | "code" | "problem"> = {}): void => {
      issues.push({ index, code, problem, ...extra });
    };
    if (code === null || !isIataCode(code)) return report("CODE_FORMAT");
    if (seen.has(code)) return report("DUPLICATE");
    seen.add(code);
    const country = row["country"];
    if (typeof country !== "string" || !isCountryCode(country)) return report("COUNTRY_FORMAT");
    const before = issues.length;

    const address = readAddress(row["address"], country, (problem, extra) => report(problem, { field: "address", ...extra }), true);
    const terminalsRaw = row["terminals"] ?? [];
    const terminalList = Array.isArray(terminalsRaw) ? terminalsRaw : [];
    if (!Array.isArray(terminalsRaw)) report("SUFFIX_FORMAT", { field: "terminals" });
    let meetingPoint: SourcedMeetingPoint | null = null;
    if (row["meetingPoint"] !== undefined) {
      if (terminalList.length > 0) report("MEETING_POINT_PLACEMENT", { field: "meetingPoint" });
      else meetingPoint = readMeetingPoint(row["meetingPoint"], null, (problem, extra) => report(problem, { field: "meetingPoint", ...extra }));
    } else if (terminalList.length === 0) {
      report("MEETING_POINT_PLACEMENT", { field: "meetingPoint" });
    }

    const suffixes = new Set<string>();
    const terminals: ReviewedTerminal[] = [];
    terminalList.forEach((rawTerminal: unknown, t) => {
      const item = asObject(rawTerminal) ?? {};
      const suffix = typeof item["suffix"] === "string" && TERMINAL_SUFFIX.test(item["suffix"]) ? item["suffix"] : null;
      if (suffix === null) return report("SUFFIX_FORMAT", { terminal: `#${t + 1}` });
      if (suffixes.has(suffix)) return report("SUFFIX_DUPLICATE", { terminal: suffix });
      suffixes.add(suffix);
      const at = (problem: ReviewedTerminalProblem, extra: Omit<ReviewedTerminalIssue, "index" | "code" | "problem" | "terminal"> = {}): void => report(problem, { terminal: suffix, ...extra });
      const terminalBefore = issues.length;

      const sourcesRaw = item["sources"];
      const sources = Array.isArray(sourcesRaw) && sourcesRaw.length >= 1 && sourcesRaw.length <= MAX_SOURCES && sourcesRaw.every(isSourceText) ? (sourcesRaw as string[]) : null;
      if (sources === null) at("NO_SOURCE", { field: "sources" });

      const namesRaw = asObject(item["names"]) ?? {};
      const names: Partial<Record<TerminalNameLanguage, string>> = {};
      for (const key of Object.keys(namesRaw)) {
        if (!(TERMINAL_NAME_LANGUAGES as readonly string[]).includes(key)) at("NAME_FORMAT", { field: "names", language: key });
      }
      for (const language of TERMINAL_NAME_LANGUAGES) {
        const text = namesRaw[language];
        if (typeof text !== "string" || !hasVisibleText(text) || text !== text.trim() || text.length > MAX_NAME_LENGTH) {
          at("NAME_FORMAT", { field: "names", language });
          continue;
        }
        if (language === "zh") {
          const bad = nonSimplifiedChars(text);
          if (bad.length > 0) at("NOT_SIMPLIFIED", { field: "names", language, text, chars: bad.join("") });
        }
        if (language === "ja" && !hasJapaneseText(text)) at("NOT_JAPANESE", { field: "names", language, text });
        names[language] = text;
      }

      const lat = item["lat"];
      const lng = item["lng"];
      if (typeof lat !== "number" || !isLatitude(lat)) at("COORDINATE", { field: "lat" });
      if (typeof lng !== "number" || !isLongitude(lng)) at("COORDINATE", { field: "lng" });
      if (!isSourceText(item["coordSource"])) at("NO_SOURCE", { field: "coordSource" });

      const scope = item["flightScope"] ?? null;
      if (scope !== null && !(FLIGHT_SCOPES as readonly unknown[]).includes(scope)) at("FLIGHT_SCOPE", { field: "flightScope" });

      const terminalAddress = item["address"] === undefined ? null : readAddress(item["address"], country, (problem, extra) => at(problem, { field: "address", ...extra }), true);
      const terminalMeeting = readMeetingPoint(item["meetingPoint"], sources, (problem, extra) => at(problem, { field: "meetingPoint", ...extra }));

      if (issues.length > terminalBefore || sources === null || terminalMeeting === null) return;
      terminals.push({
        suffix,
        code: `${code}-${suffix}`,
        names: names as Record<TerminalNameLanguage, string>,
        lat: roundCoordinate(lat as number),
        lng: roundCoordinate(lng as number),
        coordSource: item["coordSource"] as string,
        flightScope: scope as FlightScope | null,
        address: terminalAddress,
        meetingPoint: terminalMeeting,
        sources,
      });
    });

    if (issues.length > before || address === null) return;
    entries.push({ code, country, address, meetingPoint, terminals });
  });
  return issues.length > 0 ? { entries: [], issues } : { entries, issues };
}

type Reporter = (problem: ReviewedTerminalProblem, extra?: Pick<ReviewedTerminalIssue, "language" | "text" | "chars">) => void;

/** 地址：{text, source}；日本的地址要有汉字或假名、要带邮编。`required` 为假时没有就是 null */
function readAddress(value: unknown, country: string, report: Reporter, required: boolean): SourcedText | null {
  if (value === undefined && !required) return null;
  const raw = asObject(value);
  const text = raw?.["text"];
  if (typeof text !== "string" || placeAddressIssue(text) !== null) {
    report("ADDRESS_FORMAT");
    return null;
  }
  let ok = true;
  if (country === "JP") {
    if (!hasJapaneseText(text)) {
      report("NOT_JAPANESE", { text });
      ok = false;
    }
    if (!JP_POSTCODE.test(text)) {
      report("NO_POSTCODE", { text });
      ok = false;
    }
  }
  const source = raw?.["source"];
  if (!isSourceText(source)) {
    report("NO_SOURCE");
    return null;
  }
  return ok ? { text, source } : null;
}

/**
 * 集合地点：{zh, ja?, en?, source}。中文必填；来源写在 source 里，航站楼的可以不写、用这个航站楼的 sources。
 * `fallbackSources` 为 null 时（机场上的）必须自己写 source。
 */
function readMeetingPoint(value: unknown, fallbackSources: string[] | null, report: Reporter): SourcedMeetingPoint | null {
  const raw = asObject(value);
  if (raw === null) {
    report("MEETING_POINT_FORMAT");
    return null;
  }
  const { source, ...text } = raw;
  const problems = meetingPointIssues(text, { requireZh: true });
  for (const problem of problems) report("MEETING_POINT_FORMAT", problem.language === null ? {} : { language: problem.language });
  const zh = text["zh"];
  if (typeof zh === "string") {
    const bad = nonSimplifiedChars(zh);
    if (bad.length > 0) report("NOT_SIMPLIFIED", { language: "zh", text: zh, chars: bad.join("") });
  }
  let ref: string | null = null;
  if (source !== undefined) {
    if (isSourceText(source)) ref = source;
  } else if (fallbackSources !== null) {
    ref = fallbackSources.join("；");
  }
  if (ref === null) {
    report("NO_SOURCE");
    return null;
  }
  if (problems.length > 0) return null;
  const clean: MeetingPoint = {};
  for (const language of MEETING_POINT_LANGUAGES) {
    const entry = text[language];
    if (typeof entry === "string") clean[language] = entry;
  }
  return { text: clean, source: ref };
}

// ---- 计划 ----

/** 名称、地址、集合地点各是哪次导入填的（同 places.name_sources / places.content_sources） */
export interface FillSource {
  source: string;
  ref: string;
}
export type TerminalNameSources = Partial<Record<TerminalNameLanguage | "ko", FillSource & { text: string }>>;
export interface PlaceContentSources {
  address?: FillSource & { value: string };
  meeting_point?: FillSource & { value: MeetingPoint };
}

/** 库里已有的一个机场或航站楼 */
export interface ExistingPlaceContent {
  id: string;
  code: string;
  countryCode: string;
  parentId: string | null;
  cityId: string | null;
  status: "active" | "disabled";
  lat: number;
  lng: number;
  name: LocalizedText;
  nameSources: TerminalNameSources;
  address: string | null;
  meetingPoint: MeetingPoint | null;
  contentSources: PlaceContentSources;
}

/** 新建一个航站楼 */
export interface TerminalCreate {
  airportId: string;
  airportCode: string;
  code: string;
  countryCode: string;
  cityId: string | null;
  /** 机场启用（且有城市）时新建的航站楼是启用的；否则先建成停用的，等机场启用后由平台启用 */
  status: "active" | "disabled";
  name: LocalizedText;
  nameSources: TerminalNameSources;
  lat: number;
  lng: number;
  flightScope: FlightScope | null;
  address: string | null;
  meetingPoint: MeetingPoint;
  contentSources: PlaceContentSources;
  /** 来源说明（写审计日志用） */
  refs: { names: string; coordinates: string; address: string | null; meetingPoint: string };
  distanceMeters: number;
}

/** 给库里已有的机场或航站楼填空着的项 */
export interface PlaceFill {
  id: string;
  code: string;
  kind: "airport" | "terminal";
  /** 填了哪几项：address、meeting_point、name.ja / name.zh / name.en */
  fields: string[];
  before: { name?: LocalizedText; address?: string | null; meeting_point?: MeetingPoint | null };
  /** 要写的列 */
  values: { name?: LocalizedText; name_sources?: TerminalNameSources; address?: string; meeting_point?: MeetingPoint; content_sources?: PlaceContentSources };
  refs: Record<string, string>;
}

export type ReviewedTerminalConflict =
  | { code: string; problem: "COUNTRY_MISMATCH"; country: string; actual: string }
  | { code: string; problem: "TOO_FAR"; distanceMeters: number }
  | { code: string; problem: "NOT_UNDER_AIRPORT" }
  | { code: string; problem: "CHANGED_DURING_IMPORT" };

export interface ReviewedTerminalPlan {
  creates: TerminalCreate[];
  fills: PlaceFill[];
  /** 表里有、库里也有，没有要填的 */
  unchanged: string[];
  /** 已经有值、和表里的不一样，没有覆盖 */
  keptFilled: { code: string; field: string; current: string; incoming: string }[];
  /** 以前导入填过、后来平台删掉了：不再补回去 */
  keptCleared: { code: string; field: string }[];
  /** 交给人看、这次没有动的 */
  conflicts: ReviewedTerminalConflict[];
  /** 表里有、库里还没有这个机场 */
  notInDatabase: string[];
}

const meetingText = (value: MeetingPoint): string => MEETING_POINT_LANGUAGES.filter((language) => value[language] !== undefined).map((language) => `${language}: ${value[language]}`).join(" / ");

/** 算一个已有地点要填什么：只填空着的；以前导入填过、现在空了的不补；不一样的列出来 */
function planFill(place: ExistingPlaceContent, kind: "airport" | "terminal", incoming: { address: SourcedText | null; meetingPoint: SourcedMeetingPoint | null; names: Partial<Record<TerminalNameLanguage, string>>; namesRef: string | null }, plan: ReviewedTerminalPlan): PlaceFill | null {
  const fill: PlaceFill = { id: place.id, code: place.code, kind, fields: [], before: {}, values: {}, refs: {} };
  const contentSources: PlaceContentSources = { ...place.contentSources };
  if (incoming.address !== null) {
    if (place.address !== null) {
      if (place.address !== incoming.address.text) plan.keptFilled.push({ code: place.code, field: "address", current: place.address, incoming: incoming.address.text });
    } else if (place.contentSources.address !== undefined) {
      plan.keptCleared.push({ code: place.code, field: "address" });
    } else {
      fill.fields.push("address");
      fill.before.address = null;
      fill.values.address = incoming.address.text;
      contentSources.address = { source: REVIEWED_AIRPORT_TERMINALS_SOURCE, ref: incoming.address.source, value: incoming.address.text };
      fill.refs["address"] = incoming.address.source;
    }
  }
  if (incoming.meetingPoint !== null) {
    if (place.meetingPoint !== null) {
      if (!sameMeetingPoint(place.meetingPoint, incoming.meetingPoint.text)) plan.keptFilled.push({ code: place.code, field: "meeting_point", current: meetingText(place.meetingPoint), incoming: meetingText(incoming.meetingPoint.text) });
    } else if (place.contentSources.meeting_point !== undefined) {
      plan.keptCleared.push({ code: place.code, field: "meeting_point" });
    } else {
      fill.fields.push("meeting_point");
      fill.before.meeting_point = null;
      fill.values.meeting_point = incoming.meetingPoint.text;
      contentSources.meeting_point = { source: REVIEWED_AIRPORT_TERMINALS_SOURCE, ref: incoming.meetingPoint.source, value: incoming.meetingPoint.text };
      fill.refs["meeting_point"] = incoming.meetingPoint.source;
    }
  }
  if (incoming.namesRef !== null) {
    const name: LocalizedText = { ...place.name };
    const nameSources: TerminalNameSources = { ...place.nameSources };
    let named = false;
    for (const language of TERMINAL_NAME_LANGUAGES) {
      const text = incoming.names[language];
      if (text === undefined) continue;
      const current = place.name[language];
      if (current !== undefined && hasVisibleText(current)) {
        if (current !== text) plan.keptFilled.push({ code: place.code, field: `name.${language}`, current, incoming: text });
        continue;
      }
      if (place.nameSources[language] !== undefined) {
        plan.keptCleared.push({ code: place.code, field: `name.${language}` });
        continue;
      }
      name[language] = text;
      nameSources[language] = { source: REVIEWED_AIRPORT_TERMINALS_SOURCE, ref: incoming.namesRef, text };
      fill.fields.push(`name.${language}`);
      named = true;
    }
    if (named) {
      fill.before.name = place.name;
      fill.values.name = name;
      fill.values.name_sources = nameSources;
      fill.refs["name"] = incoming.namesRef;
    }
  }
  if (fill.fields.length === 0) return null;
  if (fill.values.address !== undefined || fill.values.meeting_point !== undefined) fill.values.content_sources = contentSources;
  return fill;
}

/**
 * 比较核对表和库里的机场、航站楼，算出要新建哪些航站楼、给哪些机场 / 航站楼填哪些项。同一张表运行两次，第二次什么都不用做。
 * 只看 `countries` 里的机场。
 */
export function planReviewedAirportTerminals(
  airports: readonly ExistingPlaceContent[],
  terminals: readonly ExistingPlaceContent[],
  entries: readonly ReviewedAirportTerminals[],
  countries: readonly string[],
): ReviewedTerminalPlan {
  const scope = new Set(countries);
  const airportByCode = new Map(airports.map((airport) => [airport.code, airport]));
  const terminalByCode = new Map(terminals.map((terminal) => [terminal.code, terminal]));
  const plan: ReviewedTerminalPlan = { creates: [], fills: [], unchanged: [], keptFilled: [], keptCleared: [], conflicts: [], notInDatabase: [] };
  for (const entry of [...entries].sort((x, y) => (x.code < y.code ? -1 : x.code > y.code ? 1 : 0))) {
    if (!scope.has(entry.country)) continue;
    const airport = airportByCode.get(entry.code);
    if (airport === undefined) {
      plan.notInDatabase.push(entry.code);
      continue;
    }
    if (airport.countryCode !== entry.country) {
      plan.conflicts.push({ code: entry.code, problem: "COUNTRY_MISMATCH", country: entry.country, actual: airport.countryCode });
      continue;
    }
    const airportFill = planFill(airport, "airport", { address: entry.address, meetingPoint: entry.meetingPoint, names: {}, namesRef: null }, plan);
    if (airportFill === null) plan.unchanged.push(airport.code);
    else plan.fills.push(airportFill);

    for (const terminal of entry.terminals) {
      const distanceMeters = Math.round(haversineMeters({ lat: airport.lat, lng: airport.lng }, { lat: terminal.lat, lng: terminal.lng }));
      if (distanceMeters > TERMINAL_MAX_DISTANCE_METERS) {
        plan.conflicts.push({ code: terminal.code, problem: "TOO_FAR", distanceMeters });
        continue;
      }
      const namesRef = terminal.sources.join("；");
      const existing = terminalByCode.get(terminal.code);
      if (existing !== undefined) {
        if (existing.parentId !== airport.id) {
          plan.conflicts.push({ code: terminal.code, problem: "NOT_UNDER_AIRPORT" });
          continue;
        }
        const fill = planFill(existing, "terminal", { address: terminal.address, meetingPoint: terminal.meetingPoint, names: terminal.names, namesRef }, plan);
        if (fill === null) plan.unchanged.push(existing.code);
        else plan.fills.push(fill);
        continue;
      }
      const nameSources: TerminalNameSources = {};
      for (const language of TERMINAL_NAME_LANGUAGES) nameSources[language] = { source: REVIEWED_AIRPORT_TERMINALS_SOURCE, ref: namesRef, text: terminal.names[language] };
      const contentSources: PlaceContentSources = { meeting_point: { source: REVIEWED_AIRPORT_TERMINALS_SOURCE, ref: terminal.meetingPoint.source, value: terminal.meetingPoint.text } };
      if (terminal.address !== null) contentSources.address = { source: REVIEWED_AIRPORT_TERMINALS_SOURCE, ref: terminal.address.source, value: terminal.address.text };
      plan.creates.push({
        airportId: airport.id,
        airportCode: airport.code,
        code: terminal.code,
        countryCode: airport.countryCode,
        cityId: airport.cityId,
        status: airport.status === "active" && airport.cityId !== null ? "active" : "disabled",
        name: { ...terminal.names },
        nameSources,
        lat: terminal.lat,
        lng: terminal.lng,
        flightScope: terminal.flightScope,
        address: terminal.address?.text ?? null,
        meetingPoint: terminal.meetingPoint.text,
        contentSources,
        refs: { names: namesRef, coordinates: terminal.coordSource, address: terminal.address?.source ?? null, meetingPoint: terminal.meetingPoint.source },
        distanceMeters,
      });
    }
  }
  return plan;
}
