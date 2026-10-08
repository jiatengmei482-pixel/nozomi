/**
 * 机场主数据的公开数据源：OurAirports（验收标准「机场坐标从公开数据源导入并注明来源」）。
 *
 * - 来源：OurAirports，https://ourairports.com/data/
 * - 许可：公有领域（Public Domain）。数据页原文：「All data is released to the Public Domain, and comes with
 *   no guarantee of accuracy or fitness for use.」——可以自由使用，但对方不保证准确，所以导入的机场要由平台复核后才启用。
 * - 下载地址：https://davidmegginson.github.io/ourairports-data/airports.csv（每天更新，约 13MB）
 *
 * 这里是纯函数：从文件内容里挑出要导入的机场，再和库里已有的机场比较，算出这次导入要做什么。
 * 读文件、下载、写数据库都在 apps/api 里。
 */
import { CsvError, parseCsv } from "./csv.ts";
import { hasVisibleText, isCountryCode, isIataCode, isLatitude, isLongitude, roundCoordinate } from "./master-data.ts";

export const OURAIRPORTS = {
  /** 写进 places.source 的标识 */
  source: "ourairports",
  name: "OurAirports",
  homepage: "https://ourairports.com/data/",
  downloadUrl: "https://davidmegginson.github.io/ourairports-data/airports.csv",
  license: "公有领域（Public Domain），不保证准确",
} as const;

/** 导入范围：有定期航班的大型、中型机场。小型机场、直升机场、水上机场、已关闭的机场都不导入。 */
export const IMPORTED_AIRPORT_TYPES: readonly string[] = ["large_airport", "medium_airport"];

const REQUIRED_COLUMNS = ["id", "type", "name", "latitude_deg", "longitude_deg", "iso_country", "scheduled_service", "iata_code"] as const;
const MAX_NAME_LENGTH = 200;
/** 坐标只认普通的十进制写法（可以带正负号、小数、指数）。十六进制、二进制、八进制这些 Number() 也会接受的写法不算。 */
const DECIMAL_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function parseCoordinate(text: string): number {
  return DECIMAL_NUMBER.test(text) ? Number(text) : Number.NaN;
}

export interface SourceAirport {
  /** OurAirports 的内部编号：即使机场代码变了它也不变，用它识别「同一个机场」 */
  sourceRef: string;
  iata: string;
  countryCode: string;
  name: string;
  lng: number;
  lat: number;
  /** 数据源的 municipality 列：这个机场所属 / 服务的城市名（给它建议城市时用）；文件里没有这一列或没填时为 null */
  municipality: string | null;
}

export interface SkippedAirportRow {
  /** 文件里的第几条记录（表头是第 1 条） */
  row: number;
  label: string;
  reason: string;
}

export interface AirportSelection {
  /** 文件里的机场总数（不含表头） */
  totalRows: number;
  airports: SourceAirport[];
  /** 在导入范围内、但数据不合格而跳过的记录 */
  skipped: SkippedAirportRow[];
  /** 属于所选国家、但不在导入范围内的记录的编号（已关闭、没有定期航班等），用来提示「以前导入过的机场现在不在范围内了」 */
  outOfScopeRefs: string[];
}

/**
 * 从 airports.csv 的内容里挑出要导入的机场。
 * @param countries 只导入这些国家（ISO 3166-1 alpha-2）；null 表示全部国家
 */
export function selectAirports(csvText: string, countries: readonly string[] | null): AirportSelection {
  const rows = parseCsv(csvText);
  const header = rows[0];
  if (!header) throw new CsvError("文件是空的");
  const missing = REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) throw new CsvError(`文件不是 OurAirports 的 airports.csv：缺少列 ${missing.join("、")}`);
  const column = Object.fromEntries(REQUIRED_COLUMNS.map((name) => [name, header.indexOf(name)])) as Record<
    (typeof REQUIRED_COLUMNS)[number],
    number
  >;
  // municipality 不是必有的列：老版本的文件、手工裁剪过的文件没有它也能导入，只是没有城市名可用
  const municipalityColumn = header.indexOf("municipality");
  const wanted = countries === null ? null : new Set(countries);

  const selection: AirportSelection = { totalRows: rows.length - 1, airports: [], skipped: [], outOfScopeRefs: [] };
  const seenIata = new Set<string>();
  const seenRef = new Set<string>();
  for (const [index, row] of rows.entries()) {
    if (index === 0) continue;
    // NUL 不会出现在正常的文本文件里：出现了说明文件已损坏或根本不是文本，整份都不可信
    if (row.some((cell) => cell.includes("\u0000"))) {
      const label = (row[column.iata_code] ?? "").replaceAll("\u0000", "") || (row[column.id] ?? "").replaceAll("\u0000", "");
      throw new CsvError(`文件的第 ${index + 1} 条记录${label ? `（${label}）` : ""}里有 NUL 字符，文件可能已损坏或不是文本文件。请重新下载后再试`);
    }
    const get = (name: (typeof REQUIRED_COLUMNS)[number]): string => (row[column[name]] ?? "").trim();
    const countryCode = get("iso_country");
    if (wanted !== null && !wanted.has(countryCode)) continue;
    const sourceRef = get("id");
    if (!IMPORTED_AIRPORT_TYPES.includes(get("type")) || get("scheduled_service") !== "yes") {
      if (/^\d{1,12}$/.test(sourceRef)) selection.outOfScopeRefs.push(sourceRef);
      continue;
    }
    const iata = get("iata_code");
    const name = get("name");
    const skip = (reason: string): void => {
      selection.skipped.push({ row: index + 1, label: iata || name || sourceRef, reason });
    };
    const lat = parseCoordinate(get("latitude_deg"));
    const lng = parseCoordinate(get("longitude_deg"));
    if (!/^\d{1,12}$/.test(sourceRef)) skip("数据源编号不是数字");
    else if (seenRef.has(sourceRef)) skip("数据源编号在文件里重复出现");
    else if (iata === "") skip("没有 IATA 三字码");
    else if (!isIataCode(iata)) skip(`IATA 三字码 ${iata} 格式不对`);
    else if (!isCountryCode(countryCode)) skip(`国家码 ${countryCode || "（空）"} 不是合法的 ISO 3166-1 代码`);
    else if (!hasVisibleText(name) || name.length > MAX_NAME_LENGTH) skip("名称为空或超过 200 个字符");
    else if (!isLatitude(lat) || !isLongitude(lng)) skip("坐标缺失或超出范围（要求十进制数字）");
    else if (roundCoordinate(lat) === 0 && roundCoordinate(lng) === 0) skip("坐标是 (0, 0)，多半是没有填");
    else if (seenIata.has(iata)) skip(`IATA 三字码 ${iata} 在文件里重复出现，只取第一条`);
    else {
      seenIata.add(iata);
      seenRef.add(sourceRef);
      const municipality = municipalityColumn === -1 ? "" : (row[municipalityColumn] ?? "").trim();
      selection.airports.push({
        sourceRef,
        iata,
        countryCode,
        name,
        lng: roundCoordinate(lng),
        lat: roundCoordinate(lat),
        municipality: hasVisibleText(municipality) && municipality.length <= MAX_NAME_LENGTH ? municipality : null,
      });
    }
  }
  return selection;
}

/** 库里已有的一个机场（手工录入的和以前导入的都算）。 */
export interface ExistingAirport {
  id: string;
  code: string;
  countryCode: string;
  nameEn: string | null;
  lng: number;
  lat: number;
  /** 以前从这个数据源导入时记下的编号；手工录入的为 null */
  sourceRef: string | null;
  /** 平台在后台改过它的英文名或坐标：导入不再覆盖 */
  sourceOverridden: boolean;
}

export interface AirportUpdate {
  id: string;
  code: string;
  before: { nameEn: string | null; lng: number; lat: number };
  after: { nameEn: string; lng: number; lat: number };
}

export interface AirportImportPlan {
  creates: SourceAirport[];
  updates: AirportUpdate[];
  /** 和数据源一致、不需要改的机场的编号 */
  unchanged: string[];
  /** 平台改过、数据源里的值与之不同、这次没有覆盖的机场 */
  keptManual: string[];
  /** 需要人工处理、这次没有动的情况 */
  conflicts: { iata: string; reason: string }[];
  /** 以前导入过、现在数据源里已不在导入范围内（关闭、不再有定期航班）的机场；不自动停用 */
  outOfScope: string[];
}

/**
 * 比较数据源和库里的机场，算出这次导入要新增、更新哪些。同一份文件导入两次，第二次什么都不用做。
 *
 * - 按数据源编号认「同一个机场」：名称或坐标变了就更新；平台改过的不覆盖。
 * - 数据源只管英文名和坐标：所属城市、其他语言的名称、启用状态、航站楼都是平台维护的，导入不碰。
 * - 三字码已被手工录入的机场占用、或数据源里某个机场的三字码 / 国家变了：不自动处理，列出来交给人看。
 */
export function planAirportImport(existing: readonly ExistingAirport[], selection: AirportSelection): AirportImportPlan {
  const byRef = new Map<string, ExistingAirport>();
  const byCode = new Map<string, ExistingAirport>();
  for (const airport of existing) {
    if (airport.sourceRef !== null) byRef.set(airport.sourceRef, airport);
    byCode.set(airport.code, airport);
  }
  const plan: AirportImportPlan = { creates: [], updates: [], unchanged: [], keptManual: [], conflicts: [], outOfScope: [] };
  for (const incoming of selection.airports) {
    const known = byRef.get(incoming.sourceRef);
    if (!known) {
      const occupant = byCode.get(incoming.iata);
      if (!occupant) plan.creates.push(incoming);
      else {
        plan.conflicts.push({
          iata: incoming.iata,
          reason: occupant.sourceRef === null ? "后台已经手工录入了这个三字码的机场，没有覆盖" : "这个三字码已被另一条导入的机场使用",
        });
      }
      continue;
    }
    if (known.code !== incoming.iata) {
      plan.conflicts.push({ iata: incoming.iata, reason: `数据源里这个机场的三字码由 ${known.code} 变成了 ${incoming.iata}，编码不能自动修改` });
      continue;
    }
    if (known.countryCode !== incoming.countryCode) {
      plan.conflicts.push({ iata: incoming.iata, reason: `数据源里这个机场的国家由 ${known.countryCode} 变成了 ${incoming.countryCode}，没有自动修改` });
      continue;
    }
    const same = known.nameEn === incoming.name && known.lng === incoming.lng && known.lat === incoming.lat;
    if (same) plan.unchanged.push(known.code);
    else if (known.sourceOverridden) plan.keptManual.push(known.code);
    else {
      plan.updates.push({
        id: known.id,
        code: known.code,
        before: { nameEn: known.nameEn, lng: known.lng, lat: known.lat },
        after: { nameEn: incoming.name, lng: incoming.lng, lat: incoming.lat },
      });
    }
  }
  for (const ref of selection.outOfScopeRefs) {
    const known = byRef.get(ref);
    if (known) plan.outOfScope.push(known.code);
  }
  return plan;
}
