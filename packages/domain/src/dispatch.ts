/**
 * 派车：司机、车辆、派车校验、派车截止时间、司机链接的有效期（M3-02，ADR 0027）。纯函数，不碰数据库和网络。
 *
 * 需求：《用车报价服务平台》「8. 订单与履约」（订单指派：校验车型组、座位、司机语言；同一时段已有订单时提示冲突；改派只能同级或更高级，系统拦截降级）、
 * 「履约规则（已确认）」（派车截止时间：用车前 24 小时；下单时距用车不足 24 小时的，支付后 2 小时内派车；用车前 6 小时仍未派车升级告警；用车前 1 小时仍未「已出发」时提醒）、
 * 「9. 司机管理」（字段；驾照到期前 30 天提醒，到期后不能被派单）、「10. 车辆管理」（字段；非营业牌照车辆不能被派单；里程小于 5 万公里自动标记为新车；
 * 保险、车检到期前 30 天提醒，到期后不能被派单）、「14. 补充功能」（司机 H5：链接用车后 24 小时失效）。
 */
import { isInternationalPhone, normalizePhone } from "./orders.ts";
import { DRIVER_LANGUAGES } from "./products.ts";
import type { VehicleGrade } from "./master-data.ts";

export const DISPATCH_RULES = {
  /** 用车前多少小时必须派车 */
  deadlineHoursBeforeService: 24,
  /** 下单（付款）时距用车已不足 24 小时的：付款后多少小时内派车 */
  shortNoticeHoursAfterPayment: 2,
  /** 用车前多少小时仍未派车升级告警（并由 M3-04 自动进入救援改派） */
  escalationHoursBeforeService: 6,
  /** 用车前多少分钟仍未「已出发」提醒租户 */
  departureReminderMinutesBeforeService: 60,
  /** 司机链接在用车结束后多少小时失效 */
  driverLinkHoursAfterService: 24,
  /** 判断「同一时段已有订单」时，一单在用车时间前后各占用多少分钟（路上和交接的余量） */
  conflictBufferMinutes: 60,
  /** 没有套餐时长的单（接送机、点对点）按多少分钟算服务时长 */
  defaultTripMinutes: 120,
  /** 里程小于多少公里的车自动算「新车」 */
  newVehicleMileageKm: 50_000,
  /** 驾照、保险、车检到期前多少天开始提醒 */
  expiryReminderDays: 30,
} as const;

const HOUR = 3_600_000;
const MINUTE = 60_000;

/**
 * 派车截止时间：用车前 24 小时；付款时距用车已不足 24 小时的，付款后 2 小时（但不晚于用车时间）。
 */
export function dispatchDeadline(confirmedAt: Date, serviceAt: Date): Date {
  const regular = serviceAt.getTime() - DISPATCH_RULES.deadlineHoursBeforeService * HOUR;
  if (confirmedAt.getTime() <= regular) return new Date(regular);
  return new Date(Math.min(confirmedAt.getTime() + DISPATCH_RULES.shortNoticeHoursAfterPayment * HOUR, serviceAt.getTime()));
}

/** 截止时间到了（含那一刻）还没派车就算超时。 */
export function dispatchOverdue(deadline: Date, now: Date): boolean {
  return now.getTime() >= deadline.getTime();
}

/** 用车前 6 小时仍未派车：升级告警的时间点（M3-04 在这个时间点自动进入救援改派）。 */
export function dispatchEscalationAt(serviceAt: Date): Date {
  return new Date(serviceAt.getTime() - DISPATCH_RULES.escalationHoursBeforeService * HOUR);
}

/** 用车前 1 小时仍未出发：提醒的时间点。 */
export function departureReminderAt(serviceAt: Date): Date {
  return new Date(serviceAt.getTime() - DISPATCH_RULES.departureReminderMinutesBeforeService * MINUTE);
}

/** 预计服务结束：包车按套餐时长，其他品类按用车时间（接送机、点对点没有约定时长）。 */
export function serviceEnd(serviceAt: Date, packageHours: number | null): Date {
  return new Date(serviceAt.getTime() + (packageHours ?? 0) * HOUR);
}

/** 司机链接的失效时间：用车结束后 24 小时（需求「链接用车后 24 小时失效」）。 */
export function driverLinkExpiry(serviceAt: Date, packageHours: number | null): Date {
  return new Date(serviceEnd(serviceAt, packageHours).getTime() + DISPATCH_RULES.driverLinkHoursAfterService * HOUR);
}

export interface TimeWindow {
  start: Date;
  end: Date;
}

/** 一单占用司机和车辆的时段：用车前后各留 1 小时余量；没有套餐时长的按 2 小时服务算。 */
export function orderBusyWindow(serviceAt: Date, packageHours: number | null): TimeWindow {
  const minutes = packageHours === null ? DISPATCH_RULES.defaultTripMinutes : packageHours * 60;
  return {
    start: new Date(serviceAt.getTime() - DISPATCH_RULES.conflictBufferMinutes * MINUTE),
    end: new Date(serviceAt.getTime() + (minutes + DISPATCH_RULES.conflictBufferMinutes) * MINUTE),
  };
}

/** 两个时段有没有重叠（首尾相接不算）。 */
export function windowsOverlap(a: TimeWindow, b: TimeWindow): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

// ---- 司机、车辆 ----

export const DRIVER_STATUSES = ["active", "disabled"] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];
export const DRIVER_STATUS_NAMES: Readonly<Record<DriverStatus, string>> = { active: "在职", disabled: "停用" };

export const VEHICLE_STATUSES = ["available", "maintenance", "disabled"] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];
export const VEHICLE_STATUS_NAMES: Readonly<Record<VehicleStatus, string>> = { available: "可用", maintenance: "维修", disabled: "停用" };

/** 营业牌照类型：business 营业（日本的绿牌）；private 非营业（白牌，不能收费载客，不能启用、不能被派单）。 */
export const PLATE_TYPES = ["business", "private"] as const;
export type PlateType = (typeof PLATE_TYPES)[number];
export const PLATE_TYPE_NAMES: Readonly<Record<PlateType, string>> = { business: "营业牌照（绿牌）", private: "非营业牌照" };

export const FLEET_LIMITS = {
  nameMax: 100,
  plateMax: 20,
  modelMax: 100,
  colorMax: 30,
  seatsMin: 2,
  seatsMax: 60,
  mileageMax: 3_000_000,
  drivingYearsMax: 70,
} as const;

/** 里程小于 5 万公里的车是新车（需求「10. 车辆管理」，用于新车附加服务的校验）。 */
export function vehicleIsNew(mileageKm: number): boolean {
  return mileageKm < DISPATCH_RULES.newVehicleMileageKm;
}

export type ExpiryState = "valid" | "expiring" | "expired";

/**
 * 证件（驾照、保险、车检）到期状态：到期日当天还有效，过了到期日算已过期；到期前 30 天内算「快到期」（提醒）。
 * 日期都是 YYYY-MM-DD（当地日期），按字符串比较即可。
 */
export function expiryState(expiresOn: string, today: string): ExpiryState {
  if (expiresOn < today) return "expired";
  return expiresOn <= addDays(today, DISPATCH_RULES.expiryReminderDays) ? "expiring" : "valid";
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export interface DriverInput {
  name: string;
  phone: string;
  languages: readonly string[];
  licenseExpiresOn: string;
  drivingYears: number | null;
  gold: boolean;
  status: DriverStatus;
}

export interface VehicleInput {
  plate: string;
  vehicleGroupId: string;
  model: string;
  color: string;
  seats: number;
  mileageKm: number;
  plateType: PlateType;
  insuranceExpiresOn: string;
  inspectionExpiresOn: string;
  status: VehicleStatus;
}

export type FleetIssueReason = "REQUIRED" | "TOO_LONG" | "INVALID_PHONE" | "UNKNOWN_LANGUAGE" | "DUPLICATE" | "OUT_OF_RANGE" | "PLATE_NOT_BUSINESS";

export interface FleetIssue {
  path: string;
  reason: FleetIssueReason;
}

const blank = (value: string): boolean => value.trim() === "";
const tooLong = (value: string, max: number): boolean => [...value.trim()].length > max;

/** 司机资料的校验：姓名、国际格式的电话（客人来自不同国家）、至少一种会说的语言（主数据语言代码）、驾龄范围。 */
export function driverIssues(input: DriverInput): FleetIssue[] {
  const issues: FleetIssue[] = [];
  if (blank(input.name)) issues.push({ path: "/name", reason: "REQUIRED" });
  else if (tooLong(input.name, FLEET_LIMITS.nameMax)) issues.push({ path: "/name", reason: "TOO_LONG" });
  if (blank(input.phone)) issues.push({ path: "/phone", reason: "REQUIRED" });
  else if (!isInternationalPhone(input.phone)) issues.push({ path: "/phone", reason: "INVALID_PHONE" });
  if (input.languages.length === 0) issues.push({ path: "/languages", reason: "REQUIRED" });
  input.languages.forEach((language, index) => {
    if (!DRIVER_LANGUAGES.includes(language)) issues.push({ path: `/languages/${index}`, reason: "UNKNOWN_LANGUAGE" });
    else if (input.languages.indexOf(language) !== index) issues.push({ path: `/languages/${index}`, reason: "DUPLICATE" });
  });
  if (input.drivingYears !== null && (!Number.isInteger(input.drivingYears) || input.drivingYears < 0 || input.drivingYears > FLEET_LIMITS.drivingYearsMax)) issues.push({ path: "/driving_years", reason: "OUT_OF_RANGE" });
  return issues;
}

/** 车辆资料的校验：车牌、座位、里程范围；非营业牌照的车不能设为「可用」（需求「非营业牌照车辆不能启用」）。 */
export function vehicleIssues(input: VehicleInput): FleetIssue[] {
  const issues: FleetIssue[] = [];
  if (blank(input.plate)) issues.push({ path: "/plate", reason: "REQUIRED" });
  else if (tooLong(input.plate, FLEET_LIMITS.plateMax)) issues.push({ path: "/plate", reason: "TOO_LONG" });
  if (blank(input.model)) issues.push({ path: "/model", reason: "REQUIRED" });
  else if (tooLong(input.model, FLEET_LIMITS.modelMax)) issues.push({ path: "/model", reason: "TOO_LONG" });
  if (tooLong(input.color, FLEET_LIMITS.colorMax)) issues.push({ path: "/color", reason: "TOO_LONG" });
  if (!Number.isInteger(input.seats) || input.seats < FLEET_LIMITS.seatsMin || input.seats > FLEET_LIMITS.seatsMax) issues.push({ path: "/seats", reason: "OUT_OF_RANGE" });
  if (!Number.isInteger(input.mileageKm) || input.mileageKm < 0 || input.mileageKm > FLEET_LIMITS.mileageMax) issues.push({ path: "/mileage_km", reason: "OUT_OF_RANGE" });
  if (input.status === "available" && input.plateType !== "business") issues.push({ path: "/status", reason: "PLATE_NOT_BUSINESS" });
  return issues;
}

/** 司机电话的统一写法（去掉空格、连字符、括号）。 */
export function normalizeDriverPhone(phone: string): string {
  return normalizePhone(phone.trim());
}

/** 车牌的统一写法：去掉首尾空白、连续空白合并成一个（同一辆车不会因为空格不同被登记两次）。 */
export function normalizePlate(plate: string): string {
  return plate.trim().replace(/\s+/g, " ");
}

// ---- 派车校验 ----

const GRADE_RANK: Readonly<Record<VehicleGrade, number>> = { economy: 0, comfort: 1, business: 2, luxury: 3 };

export interface VehicleGroupShape {
  id: string;
  grade: VehicleGrade;
  seats: number;
}

/**
 * 车辆所属的车型组能不能服务这一单：同一个车型组，或者等级不低、座位不少的车型组（升级不加价）；降级一律拦截（需求「改派和换车」）。
 */
export function vehicleGroupServes(ordered: VehicleGroupShape, vehicle: VehicleGroupShape): boolean {
  if (ordered.id === vehicle.id) return true;
  return GRADE_RANK[vehicle.grade] >= GRADE_RANK[ordered.grade] && vehicle.seats >= ordered.seats;
}

export interface AssignmentFacts {
  /** 用车的当地日期（YYYY-MM-DD）：证件到期按它判断 */
  serviceDate: string;
  orderedGroup: VehicleGroupShape;
  /** 客人选了司机语言（附加服务）时的语言代码 */
  driverLanguage: string | null;
  driver: { status: DriverStatus; languages: readonly string[]; licenseExpiresOn: string };
  vehicle: { status: VehicleStatus; plateType: PlateType; seats: number; insuranceExpiresOn: string; inspectionExpiresOn: string; group: VehicleGroupShape };
}

export const ASSIGNMENT_ISSUES = [
  "DRIVER_DISABLED",
  "DRIVER_LICENSE_EXPIRED",
  "DRIVER_LANGUAGE_MISSING",
  "VEHICLE_NOT_AVAILABLE",
  "VEHICLE_NOT_BUSINESS_PLATE",
  "VEHICLE_INSURANCE_EXPIRED",
  "VEHICLE_INSPECTION_EXPIRED",
  "VEHICLE_GROUP_DOWNGRADE",
  "VEHICLE_SEATS_TOO_FEW",
] as const;
export type AssignmentIssue = (typeof ASSIGNMENT_ISSUES)[number];

export const ASSIGNMENT_ISSUE_MESSAGES: Readonly<Record<AssignmentIssue, string>> = {
  DRIVER_DISABLED: "司机已停用",
  DRIVER_LICENSE_EXPIRED: "司机的驾照在用车日前已过期",
  DRIVER_LANGUAGE_MISSING: "客人要求的司机语言，这位司机不会",
  VEHICLE_NOT_AVAILABLE: "车辆不是「可用」状态（维修或停用）",
  VEHICLE_NOT_BUSINESS_PLATE: "非营业牌照的车辆不能派单",
  VEHICLE_INSURANCE_EXPIRED: "车辆保险在用车日前已过期",
  VEHICLE_INSPECTION_EXPIRED: "车辆车检在用车日前已过期",
  VEHICLE_GROUP_DOWNGRADE: "车辆的车型组比订单的低（只能同级或升级）",
  VEHICLE_SEATS_TOO_FEW: "车辆座位比订单车型组的少",
};

/** 司机这一边的硬性条件：在职、驾照在用车日有效、会说客人要求的语言。 */
export function driverAssignmentIssues(facts: Pick<AssignmentFacts, "serviceDate" | "driverLanguage" | "driver">): AssignmentIssue[] {
  const issues: AssignmentIssue[] = [];
  const { driver, serviceDate } = facts;
  if (driver.status !== "active") issues.push("DRIVER_DISABLED");
  if (driver.licenseExpiresOn < serviceDate) issues.push("DRIVER_LICENSE_EXPIRED");
  if (facts.driverLanguage !== null && !driver.languages.includes(facts.driverLanguage)) issues.push("DRIVER_LANGUAGE_MISSING");
  return issues;
}

/** 车辆这一边的硬性条件：可用、营业牌照、保险和车检在用车日有效、车型组同级或升级、座位不少。 */
export function vehicleAssignmentIssues(facts: Pick<AssignmentFacts, "serviceDate" | "orderedGroup" | "vehicle">): AssignmentIssue[] {
  const issues: AssignmentIssue[] = [];
  const { vehicle, serviceDate } = facts;
  if (vehicle.status !== "available") issues.push("VEHICLE_NOT_AVAILABLE");
  if (vehicle.plateType !== "business") issues.push("VEHICLE_NOT_BUSINESS_PLATE");
  if (vehicle.insuranceExpiresOn < serviceDate) issues.push("VEHICLE_INSURANCE_EXPIRED");
  if (vehicle.inspectionExpiresOn < serviceDate) issues.push("VEHICLE_INSPECTION_EXPIRED");
  if (!vehicleGroupServes(facts.orderedGroup, vehicle.group)) issues.push("VEHICLE_GROUP_DOWNGRADE");
  if (vehicle.seats < facts.orderedGroup.seats) issues.push("VEHICLE_SEATS_TOO_FEW");
  return issues;
}

/**
 * 这一组司机和车辆能不能派给这一单（空数组 = 可以）。都是硬性条件，不满足就不能派（`ASSIGNMENT_MISMATCH`）；
 * 「同一时段已有订单」不在这里——那是提示，由调用方另外查（需求「提示冲突」）。
 */
export function assignmentIssues(facts: AssignmentFacts): AssignmentIssue[] {
  return [...driverAssignmentIssues(facts), ...vehicleAssignmentIssues(facts)];
}
