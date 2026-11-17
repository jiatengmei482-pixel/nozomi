/**
 * 跨段规则配置（ADR 0101 第四节表、第五节；默认值见第九节 Q2 / Q3，监工 2026-11-15 确认按默认值做）。
 * 存在租户表 `trip_rule_configs.config`；金额是商品结算币种的最小单位，比例是基点，时长是分钟。
 * 没存的键 = 默认值；默认金额按日元写，商品结算币种不是日元时默认的住宿 / 停驻**不生效**（只用供应商填的值，Q3）。
 */
import type { CurrencyCode } from "../money.ts";

export interface TripRuleConfig {
  lodging?: { enabled?: boolean; perNightMinor?: number; byArea?: readonly { areaId: string; perNightMinor: number }[]; offsetSurcharges?: boolean };
  idleDay?: { enabled?: boolean; perDayMinor?: number; orShortestPackage?: boolean };
  workHours?: Partial<WorkHoursRules>;
  secondDriver?: { enabled?: boolean; mode?: SecondDriverMode; fixedMinor?: number };
  bundleAddons?: { enabled?: boolean };
  returnTrip?: { enabled?: boolean; ratioBp?: number; fixedByCity?: readonly { cityId: string; minor: number }[]; maxOneWayKm?: number };
}

export interface WorkHoursRules {
  maxBindMinutes: number;
  hardMaxBindMinutes: number;
  minRestMinutes: number;
  absoluteMinRestMinutes: number;
  maxDriveMinutes: number;
  maxDailyKm: number;
  garageMinutes: number;
  awayGarageMinutes: number;
}

export const SECOND_DRIVER_MODES = ["shortest_package", "fixed"] as const;
export type SecondDriverMode = (typeof SECOND_DRIVER_MODES)[number];

/** 生效的规则：每个键都有值；金额为 null = 没有可用的金额（非日元商品没填时），这一项不收 */
export interface EffectiveTripRules {
  lodging: { enabled: boolean; perNightMinor: number | null; byArea: readonly { areaId: string; perNightMinor: number }[]; offsetSurcharges: boolean };
  idleDay: { enabled: boolean; perDayMinor: number | null; orShortestPackage: boolean };
  workHours: WorkHoursRules;
  secondDriver: { enabled: boolean; mode: SecondDriverMode; fixedMinor: number | null };
  bundleAddons: { enabled: boolean };
  returnTrip: { enabled: boolean; ratioBp: number; fixedByCity: readonly { cityId: string; minor: number }[]; maxOneWayKm: number };
}

/** 默认值（ADR 0101 第九节 Q2）。金额是日元结算价 */
export const TRIP_RULE_DEFAULTS = {
  currency: "JPY" as CurrencyCode,
  lodging: { enabled: true, perNightMinor: 15_000, offsetSurcharges: true },
  idleDay: { enabled: true, perDayMinor: 10_000, orShortestPackage: true },
  workHours: { maxBindMinutes: 780, hardMaxBindMinutes: 900, minRestMinutes: 660, absoluteMinRestMinutes: 540, maxDriveMinutes: 540, maxDailyKm: 600, garageMinutes: 60, awayGarageMinutes: 15 } satisfies WorkHoursRules,
  secondDriver: { enabled: true, mode: "shortest_package" as SecondDriverMode },
  bundleAddons: { enabled: true },
  returnTrip: { enabled: true, ratioBp: 5_000, maxOneWayKm: 600 },
} as const;

export const TRIP_RULE_LIMITS = { maxMinor: 1_000_000_000, maxBp: 10_000, maxMinutes: 2_880, maxKm: 5_000, maxListItems: 50 } as const;

/** 存的配置 + 默认值 = 生效值。`settlementCurrency` 不是默认币种时，默认金额不生效（Q3） */
export function effectiveTripRules(saved: TripRuleConfig | null | undefined, settlementCurrency: CurrencyCode): EffectiveTripRules {
  const c = saved ?? {};
  const defaultMoney = settlementCurrency === TRIP_RULE_DEFAULTS.currency;
  const d = TRIP_RULE_DEFAULTS;
  return {
    lodging: {
      enabled: c.lodging?.enabled ?? d.lodging.enabled,
      perNightMinor: c.lodging?.perNightMinor ?? (defaultMoney ? d.lodging.perNightMinor : null),
      byArea: c.lodging?.byArea ?? [],
      offsetSurcharges: c.lodging?.offsetSurcharges ?? d.lodging.offsetSurcharges,
    },
    idleDay: {
      enabled: c.idleDay?.enabled ?? d.idleDay.enabled,
      perDayMinor: c.idleDay?.perDayMinor ?? (defaultMoney ? d.idleDay.perDayMinor : null),
      orShortestPackage: c.idleDay?.orShortestPackage ?? d.idleDay.orShortestPackage,
    },
    workHours: { ...d.workHours, ...(c.workHours ?? {}) },
    secondDriver: { enabled: c.secondDriver?.enabled ?? d.secondDriver.enabled, mode: c.secondDriver?.mode ?? d.secondDriver.mode, fixedMinor: c.secondDriver?.fixedMinor ?? null },
    bundleAddons: { enabled: c.bundleAddons?.enabled ?? d.bundleAddons.enabled },
    returnTrip: { enabled: c.returnTrip?.enabled ?? d.returnTrip.enabled, ratioBp: c.returnTrip?.ratioBp ?? d.returnTrip.ratioBp, fixedByCity: c.returnTrip?.fixedByCity ?? [], maxOneWayKm: c.returnTrip?.maxOneWayKm ?? d.returnTrip.maxOneWayKm },
  };
}

export type TripRuleIssueReason = "INVALID" | "OUT_OF_RANGE" | "UNKNOWN_KEY" | "DUPLICATE" | "AREA_NOT_FOUND" | "CITY_NOT_FOUND" | "ORDER";

export interface TripRuleIssue {
  path: string;
  reason: TripRuleIssueReason;
}

const KNOWN: Readonly<Record<keyof TripRuleConfig, readonly string[]>> = {
  lodging: ["enabled", "perNightMinor", "byArea", "offsetSurcharges"],
  idleDay: ["enabled", "perDayMinor", "orShortestPackage"],
  workHours: Object.keys(TRIP_RULE_DEFAULTS.workHours),
  secondDriver: ["enabled", "mode", "fixedMinor"],
  bundleAddons: ["enabled"],
  returnTrip: ["enabled", "ratioBp", "fixedByCity", "maxOneWayKm"],
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const intIn = (value: unknown, max: number): boolean => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max;

/**
 * 规则配置的校验（PUT 整体替换前，ADR 0101 第五节）：
 * - 只认已知的键；开关是布尔；金额 0–10 亿；比例 0–10000 基点；分钟 0–2880；公里 0–5000；
 * - `maxBindMinutes ≤ hardMaxBindMinutes`、`absoluteMinRestMinutes ≤ minRestMinutes`（合并默认值后比较）；
 * - `byArea` 最多 50 条、区域必须是**本商品**的区域（`productAreaIds`）、不重复；`fixedByCity` 最多 50 条、城市是平台启用城市、不重复。
 */
export function tripRuleIssues(config: unknown, context: { productAreaIds: ReadonlySet<string>; cityIds: ReadonlySet<string> }): TripRuleIssue[] {
  if (!isPlainObject(config)) return [{ path: "", reason: "INVALID" }];
  const issues: TripRuleIssue[] = [];
  for (const [key, value] of Object.entries(config)) {
    // 只认自己的键：`toString`、`constructor`、`__proto__` 这类原型链上的名字也是未知键（不能当成已知、更不能抛错）
    const known = Object.hasOwn(KNOWN, key) ? KNOWN[key as keyof TripRuleConfig] : undefined;
    if (known === undefined) {
      issues.push({ path: `/${key}`, reason: "UNKNOWN_KEY" });
      continue;
    }
    if (!isPlainObject(value)) {
      issues.push({ path: `/${key}`, reason: "INVALID" });
      continue;
    }
    for (const field of Object.keys(value)) if (!known.includes(field)) issues.push({ path: `/${key}/${field}`, reason: "UNKNOWN_KEY" });
    for (const [field, fieldValue] of Object.entries(value)) {
      const path = `/${key}/${field}`;
      if (!known.includes(field)) continue;
      if (field === "enabled" || field === "offsetSurcharges" || field === "orShortestPackage") {
        if (typeof fieldValue !== "boolean") issues.push({ path, reason: "INVALID" });
      } else if (field.endsWith("Minor")) {
        if (!intIn(fieldValue, TRIP_RULE_LIMITS.maxMinor)) issues.push({ path, reason: "OUT_OF_RANGE" });
      } else if (field === "ratioBp") {
        if (!intIn(fieldValue, TRIP_RULE_LIMITS.maxBp)) issues.push({ path, reason: "OUT_OF_RANGE" });
      } else if (field.endsWith("Minutes")) {
        if (!intIn(fieldValue, TRIP_RULE_LIMITS.maxMinutes)) issues.push({ path, reason: "OUT_OF_RANGE" });
      } else if (field.endsWith("Km")) {
        if (!intIn(fieldValue, TRIP_RULE_LIMITS.maxKm)) issues.push({ path, reason: "OUT_OF_RANGE" });
      } else if (field === "mode") {
        if (!(SECOND_DRIVER_MODES as readonly unknown[]).includes(fieldValue)) issues.push({ path, reason: "INVALID" });
      } else if (field === "byArea" || field === "fixedByCity") {
        const idKey = field === "byArea" ? "areaId" : "cityId";
        const amountKey = field === "byArea" ? "perNightMinor" : "minor";
        const allowed = field === "byArea" ? context.productAreaIds : context.cityIds;
        if (!Array.isArray(fieldValue) || fieldValue.length > TRIP_RULE_LIMITS.maxListItems) {
          issues.push({ path, reason: Array.isArray(fieldValue) ? "OUT_OF_RANGE" : "INVALID" });
          continue;
        }
        const seen = new Set<string>();
        for (const [index, item] of fieldValue.entries()) {
          const itemPath = `${path}/${index}`;
          if (!isPlainObject(item) || typeof item[idKey] !== "string" || Object.keys(item).some((k) => k !== idKey && k !== amountKey)) {
            issues.push({ path: itemPath, reason: "INVALID" });
            continue;
          }
          const id = item[idKey] as string;
          if (seen.has(id)) issues.push({ path: `${itemPath}/${idKey}`, reason: "DUPLICATE" });
          seen.add(id);
          if (!allowed.has(id)) issues.push({ path: `${itemPath}/${idKey}`, reason: field === "byArea" ? "AREA_NOT_FOUND" : "CITY_NOT_FOUND" });
          if (!intIn(item[amountKey], TRIP_RULE_LIMITS.maxMinor)) issues.push({ path: `${itemPath}/${amountKey}`, reason: "OUT_OF_RANGE" });
        }
      }
    }
  }
  const hours = isPlainObject(config.workHours) ? (config.workHours as Partial<WorkHoursRules>) : {};
  const merged = { ...TRIP_RULE_DEFAULTS.workHours, ...hours };
  const valid = (n: unknown): n is number => intIn(n, TRIP_RULE_LIMITS.maxMinutes);
  if (valid(merged.maxBindMinutes) && valid(merged.hardMaxBindMinutes) && merged.maxBindMinutes > merged.hardMaxBindMinutes) issues.push({ path: "/workHours/maxBindMinutes", reason: "ORDER" });
  if (valid(merged.absoluteMinRestMinutes) && valid(merged.minRestMinutes) && merged.absoluteMinRestMinutes > merged.minRestMinutes) issues.push({ path: "/workHours/absoluteMinRestMinutes", reason: "ORDER" });
  return issues;
}
