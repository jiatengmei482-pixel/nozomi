/**
 * 平台主数据的规则（M1-01）：城市、地点（机场 / 车站 / 地标及其下的航站楼 / 出口）、车型组、附加服务。
 *
 * 来源：docs/requirements/01-tenant-and-quote-engine.md「统一主数据（平台级）」和「数据模型」，
 * docs/requirements/02-platform-operations.md「主数据与内容运营」。需求没写清、在这里定下的地方见 ADR 0012。
 *
 * 这里全是纯函数：只判断「这个值合不合规则」，不读数据库。检查函数返回问题说明（中文），没有问题返回 null 或空数组。
 */
import { type GeoJsonMultiPolygon, type GeoJsonPolygon, validatePolygon } from "./geo.ts";

/** 多语言字段支持的语言（ISO 639-1）。来源：需求文档「多语言：日、中、英、韩，可扩展」。 */
export const MASTER_DATA_LANGUAGES = ["ja", "zh", "en", "ko"] as const;
export type MasterDataLanguage = (typeof MASTER_DATA_LANGUAGES)[number];
/** 多语言文本：至少有一种语言。 */
export type LocalizedText = Partial<Record<MasterDataLanguage, string>>;

export const MASTER_DATA_STATUSES = ["active", "disabled"] as const;
export type MasterDataStatus = (typeof MASTER_DATA_STATUSES)[number];

/** 品类：接送机、点对点、包车。 */
export const SERVICE_CATEGORIES = ["airport_transfer", "point_to_point", "charter"] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

/** 地点类型。航站楼挂在机场下、出口挂在车站下（需求文档「数据模型」的 place.parent_id）。 */
export const PLACE_TYPES = ["airport", "station", "poi", "terminal", "exit"] as const;
export type PlaceType = (typeof PLACE_TYPES)[number];

/** 车站类型：新干线 / 铁路 / 地铁。 */
export const STATION_CATEGORIES = ["shinkansen", "rail", "metro"] as const;
/** 地标类型：酒店 / 景点 / 港口 / 商场。 */
export const POI_CATEGORIES = ["hotel", "attraction", "port", "mall"] as const;
export const PLACE_CATEGORIES = [...STATION_CATEGORIES, ...POI_CATEGORIES] as const;
export type PlaceCategory = (typeof PLACE_CATEGORIES)[number];

/** 车站类型、地标类型的中文名（给人看的说明里用，不夹接口里的英文取值）。 */
export const PLACE_CATEGORY_NAMES: Readonly<Record<PlaceCategory, string>> = {
  shinkansen: "新干线",
  rail: "铁路",
  metro: "地铁",
  hotel: "酒店",
  attraction: "景点",
  port: "港口",
  mall: "商场",
};

/** 机场 / 航站楼的国际、国内属性（国际线和国内线的默认免等时长不同）。 */
export const FLIGHT_SCOPES = ["international", "domestic", "mixed"] as const;
export type FlightScope = (typeof FLIGHT_SCOPES)[number];

/** 车型等级：经济 / 舒适 / 商务 / 豪华，从低到高。 */
export const VEHICLE_GRADES = ["economy", "comfort", "business", "luxury"] as const;
export type VehicleGrade = (typeof VEHICLE_GRADES)[number];

export const VEHICLE_GRADE_NAMES: Readonly<Record<VehicleGrade, string>> = {
  economy: "经济",
  comfort: "舒适",
  business: "商务",
  luxury: "豪华",
};

/** 动力：燃油 / 电动。 */
export const VEHICLE_POWERS = ["fuel", "ev"] as const;
export type VehiclePower = (typeof VEHICLE_POWERS)[number];

/** 附加服务的计费方式：按次 / 按个 / 按人 / 按时长。 */
export const ADDON_CHARGE_UNITS = ["per_order", "per_item", "per_person", "per_duration"] as const;
export type AddonChargeUnit = (typeof ADDON_CHARGE_UNITS)[number];

export const MAX_VEHICLE_SEATS = 60;
export const MAX_VEHICLE_COMBOS = 20;
export const MAX_LUGGAGE = 99;
/**
 * 给还没有城市的机场建议城市时，只考虑这么远（公里）以内的启用中的城市（名称和数据源对上的那一个可以更远，见 city-suggestion.ts）。
 * 大机场离它服务的城市中心一般在 60 公里以内（成田 → 东京约 58 公里、仁川 → 首尔约 48 公里）；80 公里留了余量，
 * 又不至于把隔着一个县的城市也建议出来。
 */
export const CITY_SUGGESTION_MAX_KM = 80;
/** 建议城市时最多列出几个候选 */
export const CITY_SUGGESTION_LIMIT = 3;

/** 城市边界最多多少个顶点：够画一个都市圈，又不会让一条审计记录大到离谱。 */
export const MAX_BOUNDARY_POINTS = 5_000;

/**
 * ISO 3166-1 alpha-2 的 249 个正式代码，外加 XK（科索沃：不在 ISO 正式清单里，但机场数据源和各国际机构都在用）。
 */
export const COUNTRY_CODES: readonly string[] = (
  (
    "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
    "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
    "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
    "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT " +
    "MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
    "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ " +
    "UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW XK"
  ).split(" ")
).sort();

const COUNTRY_CODE_SET: ReadonlySet<string> = new Set(COUNTRY_CODES);

export function isCountryCode(code: string): boolean {
  return COUNTRY_CODE_SET.has(code);
}

const TIME_ZONE_SHAPE = /^[A-Z][A-Za-z]+(\/[A-Z][A-Za-z0-9_+-]*){1,2}$/;

/**
 * 是否是 IANA 时区名（`Asia/Tokyo` 这种「大洲/城市」的写法）。
 * 缩写（JST）、固定偏移（+09:00、Etc/GMT-9）、UTC、大小写不对的写法一律不接受：
 * 城市的时区要能正确处理夏令时，而且同一个时区在库里只能有一种写法。
 *
 * 运行环境认不认识一个时区名是不分大小写的；这里能判断出大小写不对的就拒绝，
 * 判断不出的（时区的别名）由接口层再和数据库的时区名单逐字核对一次。
 */
export function isIanaTimeZone(value: string): boolean {
  if (!TIME_ZONE_SHAPE.test(value) || value.startsWith("Etc/")) return false;
  try {
    const resolved = new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone;
    return resolved === value || resolved.toLowerCase() !== value.toLowerCase();
  } catch {
    return false;
  }
}

/** 坐标统一保留小数点后 6 位（约 0.1 米）。取整得到的「负零」归一成 0，否则它会被当成和 0 不同的值。 */
export function roundCoordinate(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000 + 0;
}

/**
 * 一段文字里有没有看得见的内容。只有空白、零宽空格、方向控制符这类不可见字符的，等于没填。
 */
export function hasVisibleText(text: string): boolean {
  return /[^\p{Z}\p{C}]/u.test(text);
}

export function isLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

export function isLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

/** 城市边界：GeoJSON 的 Polygon 或 MultiPolygon，环闭合、坐标在范围内，顶点总数有上限。 */
export function boundaryIssues(geometry: GeoJsonPolygon | GeoJsonMultiPolygon): string[] {
  const issues = validatePolygon(geometry);
  if (issues.length > 0) return issues;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const points = polygons.reduce((sum, rings) => sum + rings.reduce((n, ring) => n + ring.length, 0), 0);
  return points > MAX_BOUNDARY_POINTS ? [`边界顶点太多（${points} 个），最多 ${MAX_BOUNDARY_POINTS} 个`] : [];
}

const CITY_CODE = /^CTY-([A-Z]{2})-[A-Z0-9]{2,8}$/;

/** 城市编码：`CTY-` + 国家码 + 序号（如 CTY-JP-TYO），其中的国家码必须就是城市所属的国家。 */
export function cityCodeIssue(code: string, countryCode: string): string | null {
  const match = CITY_CODE.exec(code);
  if (!match) return "格式应为 CTY-国家码-序号，序号是 2 到 8 位大写字母或数字，例如 CTY-JP-TYO";
  return match[1] === countryCode ? null : `编码里的国家码 ${match[1]} 和所属国家 ${countryCode} 不一致`;
}

const IATA_CODE = /^[A-Z]{3}$/;
const STATION_CODE = /^STN-([A-Z]{2})-[A-Z0-9]{1,10}$/;
const POI_CODE = /^POI-[A-Z0-9]{1,12}$/;
const CHILD_SUFFIX = /^[A-Z0-9]{1,6}$/;

export function isIataCode(code: string): boolean {
  return IATA_CODE.test(code);
}

/**
 * 地点编码：
 * - 机场：IATA 三字码（HND）
 * - 车站：`STN-` + 国家码 + 序号（STN-JP-TOKYO）
 * - 地标：`POI-` + 序号（POI-000123）
 * - 航站楼 / 出口：上级的编码 + `-` + 1 到 6 位大写字母或数字（HND-T3、STN-JP-TOKYO-E1）
 */
export function placeCodeIssue(
  type: PlaceType,
  code: string,
  context: { countryCode: string; parentCode: string | null },
): string | null {
  switch (type) {
    case "airport":
      return isIataCode(code) ? null : "机场编码必须是 IATA 三字码（3 个大写字母），例如 HND";
    case "station": {
      const match = STATION_CODE.exec(code);
      if (!match) return "格式应为 STN-国家码-序号，序号是 1 到 10 位大写字母或数字，例如 STN-JP-TOKYO";
      return match[1] === context.countryCode ? null : `编码里的国家码 ${match[1]} 和所属国家 ${context.countryCode} 不一致`;
    }
    case "poi":
      return POI_CODE.test(code) ? null : "格式应为 POI-序号，序号是 1 到 12 位大写字母或数字，例如 POI-000123";
    case "terminal":
    case "exit": {
      const parent = context.parentCode ?? "";
      const ok = parent !== "" && code.startsWith(`${parent}-`) && CHILD_SUFFIX.test(code.slice(parent.length + 1));
      return ok ? null : `格式应为上级编码加后缀，后缀是 1 到 6 位大写字母或数字，例如 ${parent || "HND"}-${type === "terminal" ? "T1" : "E1"}`;
    }
  }
}

/** 航站楼只能挂在机场下，出口只能挂在车站下；其余类型没有上级。 */
export function requiredParentType(type: PlaceType): PlaceType | null {
  if (type === "terminal") return "airport";
  if (type === "exit") return "station";
  return null;
}

export interface PlaceAttributes {
  category: PlaceCategory | null;
  flightScope: FlightScope | null;
  address: string | null;
}

/**
 * 各类地点各自有哪些属性：车站必须有车站类型，地标必须有地标类型，只有地标有地址，只有机场和航站楼有国际 / 国内属性。
 * 返回 [字段名, 问题说明] 的列表。
 */
export function placeAttributeIssues(type: PlaceType, attributes: PlaceAttributes): [keyof PlaceAttributes, string][] {
  const issues: [keyof PlaceAttributes, string][] = [];
  const allowed: readonly string[] = type === "station" ? STATION_CATEGORIES : type === "poi" ? POI_CATEGORIES : [];
  if (allowed.length === 0) {
    if (attributes.category !== null) issues.push(["category", "只有车站和地标有类型"]);
  } else if (attributes.category === null) {
    issues.push(["category", "必填"]);
  } else if (!allowed.includes(attributes.category)) {
    const names = allowed.map((category) => PLACE_CATEGORY_NAMES[category as PlaceCategory]).join("、");
    issues.push(["category", `${type === "station" ? "车站" : "地标"}的类型只能是：${names}`]);
  }
  if (attributes.flightScope !== null && type !== "airport" && type !== "terminal") {
    issues.push(["flightScope", "只有机场和航站楼有国际 / 国内属性"]);
  }
  if (attributes.address !== null && type !== "poi") issues.push(["address", "只有地标有地址"]);
  return issues;
}

export type PlaceEnableBlocker = "CITY_MISSING" | "CITY_DISABLED" | "PARENT_DISABLED";

export const PLACE_ENABLE_BLOCKER_MESSAGES: Readonly<Record<PlaceEnableBlocker, string>> = {
  CITY_MISSING: "还没有指定所属城市，不能启用",
  CITY_DISABLED: "所属城市已停用，请先启用城市",
  PARENT_DISABLED: "上级地点已停用，请先启用上级地点",
};

/**
 * 地点能不能处于启用状态：必须已归属到一个启用中的城市；航站楼 / 出口的上级也必须是启用的。
 * 导入的机场一开始没有城市，所以是停用的，由平台指定城市后再启用。
 */
export function placeEnableBlocker(state: {
  cityStatus: MasterDataStatus | null;
  parentStatus: MasterDataStatus | null;
}): PlaceEnableBlocker | null {
  if (state.cityStatus === null) return "CITY_MISSING";
  if (state.cityStatus === "disabled") return "CITY_DISABLED";
  if (state.parentStatus === "disabled") return "PARENT_DISABLED";
  return null;
}

const VEHICLE_GROUP_CODE = /^VG-([A-Z0-9]{2,8})-([1-9]\d?)$/;

/**
 * 编码里各等级的缩写。需求文档只给了商务 = BIZ 这一个例子，其余三个是这里定的（ADR 0012）。
 * 这四个缩写是保留的：编码的等级段以某个缩写开头时，等级必须就是它（VG-ECO-4 不能配豪华）。
 */
export const VEHICLE_GRADE_ABBREVIATIONS: Readonly<Record<VehicleGrade, string>> = {
  economy: "ECO",
  comfort: "CMF",
  business: "BIZ",
  luxury: "LUX",
};

/**
 * 车型组编码：`VG-` + 等级 + 座位数（如 VG-BIZ-7），末尾的数字必须就是座位数。
 * 传了等级时再核对等级段：以别的等级的缩写开头的编码不接受。
 */
export function vehicleGroupCodeIssue(code: string, seats: number, grade?: VehicleGrade): string | null {
  const match = VEHICLE_GROUP_CODE.exec(code);
  if (!match) return "格式应为 VG-等级-座位数，等级是 2 到 8 位大写字母或数字，例如 VG-BIZ-7";
  if (Number(match[2]) !== seats) return `编码末尾的座位数 ${match[2]} 和座位数 ${seats} 不一致`;
  if (grade !== undefined) {
    const segment = match[1] as string;
    const implied = VEHICLE_GRADES.find((candidate) => segment.startsWith(VEHICLE_GRADE_ABBREVIATIONS[candidate]));
    if (implied !== undefined && implied !== grade) {
      return `编码里的 ${VEHICLE_GRADE_ABBREVIATIONS[implied]} 是「${VEHICLE_GRADE_NAMES[implied]}」的缩写，和所选的等级「${VEHICLE_GRADE_NAMES[grade]}」不一致（${VEHICLE_GRADE_NAMES[grade]}的缩写是 ${VEHICLE_GRADE_ABBREVIATIONS[grade]}）`;
    }
  }
  return null;
}

export interface VehicleCombo {
  passengers: number;
  luggage: number;
}

/** 「人数 / 行李数」组合：至少一个，人数不超过座位数，同一个组合不重复。 */
export function vehicleComboIssues(seats: number, combos: readonly VehicleCombo[]): string[] {
  const issues: string[] = [];
  if (combos.length === 0) issues.push("至少要有一个「人数 / 行李数」组合");
  if (combos.length > MAX_VEHICLE_COMBOS) issues.push(`组合最多 ${MAX_VEHICLE_COMBOS} 个`);
  const seen = new Set<string>();
  for (const [index, combo] of combos.entries()) {
    const label = `第 ${index + 1} 个组合`;
    if (!Number.isInteger(combo.passengers) || combo.passengers < 1) issues.push(`${label}：人数必须是不小于 1 的整数`);
    else if (combo.passengers > seats) issues.push(`${label}：人数 ${combo.passengers} 超过了座位数 ${seats}`);
    if (!Number.isInteger(combo.luggage) || combo.luggage < 0 || combo.luggage > MAX_LUGGAGE) {
      issues.push(`${label}：行李数必须是 0 到 ${MAX_LUGGAGE} 的整数`);
    }
    const key = `${combo.passengers}/${combo.luggage}`;
    if (seen.has(key)) issues.push(`${label}：和前面的组合重复`);
    seen.add(key);
  }
  return issues;
}

const ADDON_CODE = /^ADD-[A-Z][A-Z0-9_]{1,39}$/;

/** 附加服务编码：`ADD-` + 代码（如 ADD-CHILD_SEAT）。 */
export function addonCodeIssue(code: string): string | null {
  return ADDON_CODE.test(code) ? null : "格式应为 ADD-代码，代码以大写字母开头，由大写字母、数字、下划线组成，例如 ADD-CHILD_SEAT";
}
