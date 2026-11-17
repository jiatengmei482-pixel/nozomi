/**
 * 价格页第四张表「机场套餐价」的模型（M9P-22，ADR 0098 第三节第 3、4、8 小节）：只给迁移过三层区域的包车商品用。
 * - 行 = 场景 × 机场（绑定）× 车型组，列 = 套餐时长；一格 = 价格方式 `charter_airport_package` 的一条（`area_id` = 机场区域，`direction` = pickup / dropoff）。
 * - 有这一格 = 单独价；空格 = 继承：普通套餐价（整商品套餐价）+ 这一端的机场加价——场景那一端的③上 / 下车加价（在①里是 0），
 *   机场结束另加下车点行程加价（ADR 0093 C，第三节第 4 小节第 2 步）。继承价由 `inheritedAirportPrice` 算，和报价引擎同一套选加价的函数（`areaSurchargeFor`）。
 * - 单独价高于同一格的继承价 → 标黄（`airportCellWarn`，Q4）。
 * - 一格同一时间只编辑一条（今天生效的，没有就以后最早生效的，再没有就最后一条）；同一格别的日期段原样不动，页面写「另有 N 段」。
 * - 新行的 ref：后端最多 100 个字符，区域、车型组各 36 个字符，前缀要短（M9P-07 #281 的教训）。
 * 金额是结算价、最小货币单位整数。不依赖浏览器。
 */
import { type AirportScenarioKind, type PriceRule, PRICE_LIMITS, addDays, areaSurchargeFor, findPriceRuleOverlaps, locateInAreas, priceRuleCoversDate, priceRuleIsActive, scenarioEnd } from "@nozomi/domain";
import type { Area } from "../api/areas.ts";
import type { PriceRuleBatch, PriceRuleBody, PriceRuleInput } from "../api/prices.ts";
import { readNamedAmount } from "./area-surcharge.ts";
import { charterAirportText } from "./charter-airport-copy.ts";
import { moneyText } from "./product-display.ts";

export const AIRPORT_MODEL = "charter_airport_package";
export type AirportUnitField = "km" | "overKm" | "overtime";
export type AirportField = "price" | AirportUnitField;
export const AIRPORT_UNIT_FIELDS: readonly AirportUnitField[] = ["km", "overKm", "overtime"];

export const airportFieldName = (field: AirportField): string => charterAirportText(`tenant.charterAirport.prices.field.${field}`);

/** 一格（场景 × 机场区域 × 车型组 × 套餐时长）正在编辑的那一条 */
export interface AirportCell {
  /** 已保存的是价格的编号；没保存的是 `blankAirportKey` */
  key: string;
  id: string | null;
  scenario: AirportScenarioKind;
  areaId: string;
  vehicleGroupId: string;
  packageHours: number;
  price: string;
  km: string;
  overKm: string;
  overtime: string;
  from: string;
  to: string | null;
  enabled: boolean;
  /** 清空了已保存的格：保存时删掉这一条（改回继承） */
  deleted: boolean;
  origin: PriceRuleBody | null;
}

export interface AirportProblem {
  field: AirportField;
  text: string;
}

export interface AirportReading {
  blank: boolean;
  rule: PriceRule | null;
  input: PriceRuleInput | null;
  /** 读出来的单独价（最小货币单位）；空格或写错了为 null */
  priceMinor: number | null;
  problems: AirportProblem[];
}

const shown = (minor: number | null | undefined, currency: string): string => (minor === null || minor === undefined ? "" : moneyText(minor, currency).slice(currency.length).trim());

/** 金额写成表里的样子（千分位、不带币种）：「47,000」 */
export const airportAmountText = (minor: number, currency: string): string => shown(minor, currency);

export const scenarioOfDirection = (direction: string | null): AirportScenarioKind => (direction === "dropoff" ? "airport_end" : "airport_start");

/** 新格的记号（提交时当 ref 用）：`na-s|e-<区域>-<车型组>-<时长>`，最长 3 + 2 + 37 + 37 + 3 = 82 个字符 */
export function blankAirportKey(scenario: AirportScenarioKind, areaId: string, vehicleGroupId: string, packageHours: number): string {
  return `na-${scenario === "airport_start" ? "s" : "e"}-${areaId}-${vehicleGroupId}-${packageHours}`;
}

export function blankAirportCell(scenario: AirportScenarioKind, areaId: string, vehicleGroupId: string, packageHours: number, today: string): AirportCell {
  return { key: blankAirportKey(scenario, areaId, vehicleGroupId, packageHours), id: null, scenario, areaId, vehicleGroupId, packageHours, price: "", km: "", overKm: "", overtime: "", from: today, to: null, enabled: true, deleted: false, origin: null };
}

export function airportCellFromRule(rule: PriceRuleBody, currency: string): AirportCell {
  return {
    key: rule.id,
    id: rule.id,
    scenario: scenarioOfDirection(rule.direction),
    areaId: rule.area_id,
    vehicleGroupId: rule.vehicle_group_id,
    packageHours: rule.package_hours ?? 0,
    price: shown(rule.package_price, currency),
    km: rule.package_km === null ? "" : String(rule.package_km),
    overKm: shown(rule.over_km_per_km, currency),
    overtime: shown(rule.overtime_per_hour, currency),
    from: rule.valid_from,
    to: rule.valid_to,
    enabled: rule.status === "enabled",
    deleted: false,
    origin: rule,
  };
}

const sameCell = (a: Pick<AirportCell, "scenario" | "areaId" | "vehicleGroupId" | "packageHours">, b: Pick<AirportCell, "scenario" | "areaId" | "vehicleGroupId" | "packageHours">): boolean =>
  a.scenario === b.scenario && a.areaId === b.areaId && a.vehicleGroupId === b.vehicleGroupId && a.packageHours === b.packageHours;

export interface AirportCells {
  /** 每格正在编辑的那一条（已保存的） */
  cells: AirportCell[];
  /** 同一格别的日期段的条数（原样不动），键是 `blankAirportKey` */
  others: Map<string, number>;
}

/**
 * 已保存的机场套餐价 → 每格编辑哪一条：今天生效的（启用的优先），没有就以后最早生效的，再没有就开始日期最晚的。
 */
export function airportCellsOf(items: readonly PriceRuleBody[], currency: string, today: string): AirportCells {
  const groups = new Map<string, PriceRuleBody[]>();
  for (const item of items) {
    if (item.pricing_model !== AIRPORT_MODEL || item.package_hours === null) continue;
    const key = blankAirportKey(scenarioOfDirection(item.direction), item.area_id, item.vehicle_group_id, item.package_hours);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const cells: AirportCell[] = [];
  const others = new Map<string, number>();
  for (const [key, list] of groups) {
    const covers = (rule: PriceRuleBody): boolean => priceRuleCoversDate({ validFrom: rule.valid_from, validTo: rule.valid_to }, today);
    const pick =
      list.find((rule) => covers(rule) && rule.status === "enabled") ??
      list.find(covers) ??
      [...list].filter((rule) => rule.valid_from > today).sort((x, y) => x.valid_from.localeCompare(y.valid_from))[0] ??
      [...list].sort((x, y) => y.valid_from.localeCompare(x.valid_from))[0];
    if (pick === undefined) continue;
    cells.push(airportCellFromRule(pick, currency));
    if (list.length > 1) others.set(key, list.length - 1);
  }
  return { cells, others };
}

export function isBlankAirport(cell: AirportCell): boolean {
  return cell.price.trim() === "" && AIRPORT_UNIT_FIELDS.every((field) => cell[field].trim() === "");
}

/** 读一格：单独价必填（填了任何单价也要填单独价）；三项单价可以不填（= 同普通套餐）。全空 = 继承。 */
export function readAirportCell(cell: AirportCell, currency: string): AirportReading {
  if (cell.deleted || isBlankAirport(cell)) return { blank: true, rule: null, input: null, priceMinor: null, problems: [] };
  const problems: AirportProblem[] = [];
  let priceMinor: number | null = null;
  if (cell.price.trim() === "") problems.push({ field: "price", text: charterAirportText("tenant.charterAirport.prices.priceRequired") });
  else {
    const read = readNamedAmount(cell.price, airportFieldName("price"), currency);
    if ("problem" in read) problems.push({ field: "price", text: read.problem });
    else priceMinor = read.minor;
  }
  let km: number | null = null;
  const kmText = cell.km.trim().replace(/,/g, "");
  if (kmText !== "") {
    const value = /^\d+$/.test(kmText) ? Number(kmText) : Number.NaN;
    if (!Number.isInteger(value) || value < 1 || value > PRICE_LIMITS.maxPackageKm) problems.push({ field: "km", text: charterAirportText("tenant.charterAirport.prices.kmInvalid", { max: PRICE_LIMITS.maxPackageKm }) });
    else km = value;
  }
  const money = (field: "overKm" | "overtime"): number | null => {
    if (cell[field].trim() === "") return null;
    const read = readNamedAmount(cell[field], airportFieldName(field), currency);
    if ("problem" in read) {
      problems.push({ field, text: read.problem });
      return null;
    }
    return read.minor;
  };
  const overKm = money("overKm");
  const overtime = money("overtime");
  if (problems.length > 0 || priceMinor === null) return { blank: false, rule: null, input: null, priceMinor: null, problems };
  const direction = scenarioEnd(cell.scenario);
  const status = cell.enabled ? "enabled" : "disabled";
  const rule: PriceRule = {
    areaId: cell.areaId,
    vehicleGroupId: cell.vehicleGroupId,
    direction,
    packageHours: cell.packageHours,
    pricing: { model: AIRPORT_MODEL, packagePriceMinor: priceMinor, ...(km === null ? {} : { packageKm: km }), ...(overKm === null ? {} : { overKmPerKmMinor: overKm }), ...(overtime === null ? {} : { overtimePerHourMinor: overtime }) },
    validFrom: cell.from,
    validTo: cell.to,
    status,
  };
  const input: PriceRuleInput = {
    area_id: cell.areaId,
    vehicle_group_id: cell.vehicleGroupId,
    direction,
    package_hours: cell.packageHours,
    pricing_model: AIRPORT_MODEL,
    base_price: null,
    start_price: null,
    start_meters: null,
    start_minutes: null,
    per_km: null,
    per_minute: null,
    min_price: null,
    package_km: km,
    package_price: priceMinor,
    overtime_per_hour: overtime,
    over_km_per_km: overKm,
    valid_from: cell.from,
    valid_to: cell.to,
    status,
  };
  return { blank: false, rule, input, priceMinor, problems };
}

const COMPARED = ["package_price", "package_km", "over_km_per_km", "overtime_per_hour", "valid_from", "valid_to", "status"] as const;

export type AirportChange = "none" | "blank" | "new" | "changed" | "deleted";

export function airportChange(cell: AirportCell, reading: AirportReading): AirportChange {
  if (cell.id !== null && (cell.deleted || reading.blank)) return "deleted";
  if (reading.blank) return "blank";
  if (cell.origin === null) return "new";
  const origin = cell.origin;
  return reading.input !== null && COMPARED.every((key) => (reading.input?.[key] ?? null) === (origin[key] ?? null)) ? "none" : "changed";
}

/** 第四张表 → 批量保存的请求体（和价格表、两张加价表一起提交，同一事务） */
export function buildAirportBatch(cells: readonly AirportCell[], currency: string): PriceRuleBatch {
  const batch: PriceRuleBatch = { create: [], update: [], delete: [] };
  for (const cell of cells) {
    const reading = readAirportCell(cell, currency);
    const change = airportChange(cell, reading);
    if (change === "deleted" && cell.id !== null) batch.delete.push(cell.id);
    else if (change === "new" && reading.input) batch.create.push({ ...reading.input, ref: cell.key });
    else if (change === "changed" && reading.input && cell.id !== null) batch.update.push({ ...reading.input, id: cell.id });
  }
  return batch;
}

export function airportChangeCount(cells: readonly AirportCell[], currency: string): number {
  const batch = buildAirportBatch(cells, currency);
  return batch.create.length + batch.update.length + batch.delete.length;
}

/**
 * 编辑中的格和同一格别的日期段（没在页面上编辑、原样留着的）有没有日期重叠：返回重叠的格的 key。
 * 新格从今天起一直有效，同一格以后才生效的段会和它重叠（后端也会拒），这里先指出来。
 */
export function airportOverlaps(cells: readonly AirportCell[], items: readonly PriceRuleBody[], currency: string): Set<string> {
  const editing = new Set(cells.map((cell) => cell.id).filter((id): id is string => id !== null));
  const rest = items.filter((item) => item.pricing_model === AIRPORT_MODEL && !editing.has(item.id));
  const result = new Set<string>();
  for (const cell of cells) {
    const rule = readAirportCell(cell, currency).rule;
    if (rule === null) continue;
    const same = rest.filter((item) => item.package_hours === cell.packageHours && item.area_id === cell.areaId && item.vehicle_group_id === cell.vehicleGroupId && scenarioOfDirection(item.direction) === cell.scenario);
    const rules = [rule, ...same.map((item) => ({ ...rule, validFrom: item.valid_from, validTo: item.valid_to }))];
    if (findPriceRuleOverlaps(rules).some(([a]) => a === 0)) result.add(cell.key);
  }
  return result;
}

// ── 继承价 ──

/** 一个区域的图形（报价判断用）：从区域地图接口的区域换过来 */
export interface AreaShapes {
  areaId: string;
  active: boolean;
  shapes: { id: string; kind: "operate" | "forbid"; ring: [number, number][] }[];
}

export function areaShapesOf(area: Pick<Area, "id" | "status" | "polygons">): AreaShapes {
  return { areaId: area.id, active: area.status === "active", shapes: area.polygons.map((polygon) => ({ id: polygon.id, kind: polygon.kind, ring: (polygon.geometry.coordinates[0] ?? []).map(([lng, lat]) => [lng, lat] as [number, number]) })) };
}

/** 机场那一端落在哪：在不在商品的①基础价区域里、在哪些③上下车加价区域里、在哪些②行程区域里 */
export interface AirportEndLocation {
  inProductArea: boolean;
  updownAreaIds: string[];
  itineraryAreaIds: string[];
}

export function airportEndLocation(point: { lat: number; lng: number }, areas: { product: readonly AreaShapes[]; updown: readonly AreaShapes[]; itinerary: readonly AreaShapes[] }): AirportEndLocation {
  return {
    inProductArea: locateInAreas(areas.product, point).operating.length > 0,
    updownAreaIds: locateInAreas(areas.updown, point).operating,
    itineraryAreaIds: locateInAreas(areas.itinerary, point).operating,
  };
}

export type InheritedPrice =
  | { ok: true; totalMinor: number; normalMinor: number; end: "pickup" | "dropoff"; endMinor: number }
  | { ok: false; reason: "noNormal" | "noLocation" | "noSurcharge" };

/**
 * 一格的继承价（ADR 0098 第三节第 3、4 小节；和报价引擎 `quoteProduct` 里继承那一支同一个算法，不填经停点时）：
 * 普通套餐价 + 场景那一端的③加价（那一端在①里 = 0；几个③重叠取最高，同一区域先用套餐对得上的那条、没有用「所有套餐」那条）
 * 机场结束不加下车点行程加价（业主 2026-11-17：套餐价已含去机场的路程，ADR 0098 第十四节）。
 * `rules` 是两张加价表现在的内容（含没保存的修改）。普通套餐价没有 → 继承时报不出；那一端不在①里又没有能用的③加价 → 也报不出。
 */
export function inheritedAirportPrice(query: {
  normalMinor: number | null;
  scenario: AirportScenarioKind;
  location: AirportEndLocation | null;
  rules: readonly PriceRule[];
  vehicleGroupId: string;
  packageHours: number;
  date: string;
}): InheritedPrice {
  if (query.normalMinor === null) return { ok: false, reason: "noNormal" };
  if (query.location === null) return { ok: false, reason: "noLocation" };
  const end = scenarioEnd(query.scenario);
  const { location } = query;
  if (location.inProductArea) return { ok: true, totalMinor: query.normalMinor, normalMinor: query.normalMinor, end, endMinor: 0 };
  const base = { vehicleGroupId: query.vehicleGroupId, packageHours: query.packageHours, date: query.date, prefer: "highest" as const, threeLayer: true };
  const chosen = location.updownAreaIds.length === 0 ? null : areaSurchargeFor(query.rules, { ...base, areaIds: location.updownAreaIds, end });
  if (chosen === null || chosen.amountMinor === null) return { ok: false, reason: "noSurcharge" };
  return { ok: true, totalMinor: query.normalMinor + chosen.amountMinor, normalMinor: query.normalMinor, end, endMinor: chosen.amountMinor };
}

/** 单独价高于继承价 → 标黄（Q4）。继承价算不出时不标。 */
export function airportCellWarn(priceMinor: number | null, inherited: InheritedPrice): boolean {
  return priceMinor !== null && inherited.ok && priceMinor > inherited.totalMinor;
}

/** 空格的灰字：「继承：普通 33,000 + 上车加价 14,000」；算不出时写原因 */
export function inheritText(inherited: InheritedPrice, currency: string): string {
  if (!inherited.ok) return charterAirportText("tenant.charterAirport.prices.inheritUnknown", { reason: charterAirportText(`tenant.charterAirport.prices.reason.${inherited.reason}`) });
  const amount = (minor: number): string => shown(minor, currency);
  const parts = [charterAirportText("tenant.charterAirport.prices.part.normal", { amount: amount(inherited.normalMinor) })];
  if (inherited.endMinor > 0) parts.push(charterAirportText(inherited.end === "pickup" ? "tenant.charterAirport.prices.part.pickup" : "tenant.charterAirport.prices.part.dropoff", { amount: amount(inherited.endMinor) }));
  return charterAirportText("tenant.charterAirport.prices.inherit", { parts: parts.join(" + ") });
}

/** 输入框里的灰字（placeholder）：「继承 47,000」；算不出时为空 */
export function inheritPlaceholder(inherited: InheritedPrice, currency: string): string {
  return inherited.ok ? charterAirportText("tenant.charterAirport.prices.inheritTotal", { amount: shown(inherited.totalMinor, currency) }) : "";
}

/** 表的列：整商品套餐价有的时长 ∪ 已有机场套餐价的时长，从小到大 */
export function airportHoursColumns(items: readonly Pick<PriceRuleBody, "pricing_model" | "area_id" | "package_hours">[], extra: readonly number[] = []): number[] {
  const hours = new Set<number>(extra);
  for (const item of items) {
    if (item.package_hours === null) continue;
    if ((item.pricing_model === "charter_package" && (item.area_id as string | null) === null) || item.pricing_model === AIRPORT_MODEL) hours.add(item.package_hours);
  }
  return [...hours].sort((x, y) => x - y);
}

/** 这一格现在怎么样（右下角的小字）：写错了、重叠、未保存、将删除、已停用、以后生效 */
export function airportCellNote(cell: AirportCell, reading: AirportReading, overlapping: boolean, today: string): string | null {
  const change = airportChange(cell, reading);
  if (reading.problems.length > 0) return reading.problems[0]?.text ?? null;
  if (overlapping) return charterAirportText("tenant.charterAirport.prices.overlap");
  if (change === "deleted") return charterAirportText("tenant.charterAirport.prices.deleted");
  if (change === "new" || change === "changed") return charterAirportText("tenant.charterAirport.prices.unsaved");
  const rule = reading.rule;
  if (rule === null) return null;
  if (rule.status === "disabled") return charterAirportText("tenant.charterAirport.prices.disabled");
  if (rule.validFrom > today) return charterAirportText("tenant.charterAirport.prices.upcoming", { date: rule.validFrom });
  if (!priceRuleIsActive(rule, today)) return charterAirportText("tenant.charterAirport.prices.expired");
  if (rule.validTo !== null && rule.validTo <= addDays(today, 30)) return charterAirportText("tenant.charterAirport.prices.expiring", { date: rule.validTo });
  return null;
}
