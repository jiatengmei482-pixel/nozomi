import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ASSIGNMENT_ISSUES,
  ASSIGNMENT_ISSUE_MESSAGES,
  type AssignmentFacts,
  DISPATCH_RULES,
  type DriverInput,
  type VehicleInput,
  assignmentIssues,
  departureReminderAt,
  dispatchDeadline,
  dispatchEscalationAt,
  dispatchOverdue,
  driverAssignmentIssues,
  driverIssues,
  driverLinkExpiry,
  expiryState,
  normalizePlate,
  orderBusyWindow,
  serviceEnd,
  vehicleAssignmentIssues,
  vehicleGroupServes,
  vehicleIsNew,
  vehicleIssues,
  windowsOverlap,
} from "./dispatch.ts";

const at = (iso: string): Date => new Date(iso);

test("派车截止时间：付款时距用车 ≥ 24 小时的，用车前 24 小时", () => {
  assert.deepEqual(dispatchDeadline(at("2026-10-07T01:00:00Z"), at("2026-10-20T01:00:00Z")), at("2026-10-19T01:00:00Z"));
  assert.deepEqual(dispatchDeadline(at("2026-10-19T01:00:00Z"), at("2026-10-20T01:00:00Z")), at("2026-10-19T01:00:00Z"), "正好 24 小时：还是用车前 24 小时");
});

test("派车截止时间：付款时距用车不足 24 小时的，付款后 2 小时内；不晚于用车时间", () => {
  assert.deepEqual(dispatchDeadline(at("2026-10-19T02:00:00Z"), at("2026-10-20T01:00:00Z")), at("2026-10-19T04:00:00Z"));
  assert.deepEqual(dispatchDeadline(at("2026-10-20T00:00:00Z"), at("2026-10-20T01:00:00Z")), at("2026-10-20T01:00:00Z"), "用车前 1 小时付款：截止时间就是用车时间");
});

test("超时未派车：到截止时间那一刻起就算", () => {
  const deadline = at("2026-10-19T01:00:00Z");
  assert.equal(dispatchOverdue(deadline, at("2026-10-19T00:59:59Z")), false);
  assert.equal(dispatchOverdue(deadline, deadline), true);
  assert.equal(dispatchOverdue(deadline, at("2026-10-19T02:00:00Z")), true);
});

test("升级告警在用车前 6 小时；出发提醒在用车前 1 小时", () => {
  assert.deepEqual(dispatchEscalationAt(at("2026-10-20T10:00:00Z")), at("2026-10-20T04:00:00Z"));
  assert.deepEqual(departureReminderAt(at("2026-10-20T10:00:00Z")), at("2026-10-20T09:00:00Z"));
});

test("司机链接：用车结束后 24 小时失效；包车按套餐时长算结束时间", () => {
  assert.deepEqual(driverLinkExpiry(at("2026-10-20T01:00:00Z"), null), at("2026-10-21T01:00:00Z"));
  assert.deepEqual(driverLinkExpiry(at("2026-10-20T01:00:00Z"), 10), at("2026-10-21T11:00:00Z"));
  assert.deepEqual(serviceEnd(at("2026-10-20T01:00:00Z"), 5), at("2026-10-20T06:00:00Z"));
});

test("同一时段：前后各留 1 小时；接送机按 2 小时、包车按套餐时长；首尾相接不算冲突", () => {
  const transfer = orderBusyWindow(at("2026-10-20T01:00:00Z"), null);
  assert.deepEqual(transfer, { start: at("2026-10-20T00:00:00Z"), end: at("2026-10-20T04:00:00Z") });
  const charter = orderBusyWindow(at("2026-10-20T01:00:00Z"), 10);
  assert.deepEqual(charter.end, at("2026-10-20T12:00:00Z"));
  assert.equal(windowsOverlap(transfer, orderBusyWindow(at("2026-10-20T04:30:00Z"), null)), true);
  assert.equal(windowsOverlap(transfer, orderBusyWindow(at("2026-10-20T05:00:00Z"), null)), false, "前一单的结束正好是后一单的开始");
  assert.equal(windowsOverlap(orderBusyWindow(at("2026-10-20T05:00:00Z"), null), transfer), false);
  assert.equal(windowsOverlap(charter, orderBusyWindow(at("2026-10-20T11:00:00Z"), null)), true);
});

test("新车：里程小于 5 万公里", () => {
  assert.equal(vehicleIsNew(0), true);
  assert.equal(vehicleIsNew(49_999), true);
  assert.equal(vehicleIsNew(DISPATCH_RULES.newVehicleMileageKm), false);
});

test("证件到期：当天仍有效，过了才算过期；30 天内算快到期", () => {
  assert.equal(expiryState("2026-10-07", "2026-10-07"), "expiring");
  assert.equal(expiryState("2026-10-06", "2026-10-07"), "expired");
  assert.equal(expiryState("2026-11-06", "2026-10-07"), "expiring");
  assert.equal(expiryState("2026-11-07", "2026-10-07"), "valid");
  assert.equal(expiryState("2027-03-01", "2027-02-27"), "expiring", "跨月、平年二月");
});

const driver = (extra: Partial<DriverInput> = {}): DriverInput => ({ name: "佐藤一郎", phone: "+81 90-1234-5678", languages: ["ja", "en"], licenseExpiresOn: "2028-01-01", drivingYears: 12, gold: true, status: "active", ...extra });

test("司机资料：姓名、国际格式的电话、至少一种主数据里的语言、驾龄范围", () => {
  assert.deepEqual(driverIssues(driver()), []);
  assert.deepEqual(driverIssues(driver({ drivingYears: null })), []);
  assert.deepEqual(driverIssues(driver({ name: " ", phone: "", languages: [] })), [
    { path: "/name", reason: "REQUIRED" },
    { path: "/phone", reason: "REQUIRED" },
    { path: "/languages", reason: "REQUIRED" },
  ]);
  assert.deepEqual(driverIssues(driver({ phone: "090-1234-5678" })), [{ path: "/phone", reason: "INVALID_PHONE" }], "不带国家码，国外的客人打不通");
  assert.deepEqual(driverIssues(driver({ languages: ["ja", "fr", "ja"] })), [{ path: "/languages/1", reason: "UNKNOWN_LANGUAGE" }, { path: "/languages/2", reason: "DUPLICATE" }]);
  assert.deepEqual(driverIssues(driver({ name: "名".repeat(101), drivingYears: -1 })), [{ path: "/name", reason: "TOO_LONG" }, { path: "/driving_years", reason: "OUT_OF_RANGE" }]);
  assert.deepEqual(driverIssues(driver({ drivingYears: 1.5 })), [{ path: "/driving_years", reason: "OUT_OF_RANGE" }]);
});

const vehicle = (extra: Partial<VehicleInput> = {}): VehicleInput => ({
  plate: "品川 300 あ 12-34",
  vehicleGroupId: "vg",
  model: "丰田埃尔法",
  color: "黑",
  seats: 7,
  mileageKm: 30_000,
  plateType: "business",
  insuranceExpiresOn: "2027-01-01",
  inspectionExpiresOn: "2027-01-01",
  status: "available",
  ...extra,
});

test("车辆资料：车牌、车型、座位和里程范围；非营业牌照的车不能设为可用", () => {
  assert.deepEqual(vehicleIssues(vehicle()), []);
  assert.deepEqual(vehicleIssues(vehicle({ plateType: "private", status: "maintenance" })), [], "非营业牌照可以登记，只是不能启用");
  assert.deepEqual(vehicleIssues(vehicle({ plateType: "private" })), [{ path: "/status", reason: "PLATE_NOT_BUSINESS" }]);
  assert.deepEqual(vehicleIssues(vehicle({ plate: "", model: "", seats: 1, mileageKm: -5 })), [
    { path: "/plate", reason: "REQUIRED" },
    { path: "/model", reason: "REQUIRED" },
    { path: "/seats", reason: "OUT_OF_RANGE" },
    { path: "/mileage_km", reason: "OUT_OF_RANGE" },
  ]);
  assert.deepEqual(vehicleIssues(vehicle({ plate: "x".repeat(21), color: "c".repeat(31), seats: 61 })), [
    { path: "/plate", reason: "TOO_LONG" },
    { path: "/color", reason: "TOO_LONG" },
    { path: "/seats", reason: "OUT_OF_RANGE" },
  ]);
  assert.equal(normalizePlate("  品川  300 あ\t12-34 "), "品川 300 あ 12-34");
});

const biz7 = { id: "biz7", grade: "business" as const, seats: 7 };
const eco4 = { id: "eco4", grade: "economy" as const, seats: 4 };
const lux7 = { id: "lux7", grade: "luxury" as const, seats: 7 };
const biz5 = { id: "biz5", grade: "business" as const, seats: 5 };

test("车型组：同组或升级（等级不低且座位不少）可以，降级一律拦截", () => {
  assert.equal(vehicleGroupServes(biz7, biz7), true);
  assert.equal(vehicleGroupServes(biz7, lux7), true, "升级不加价");
  assert.equal(vehicleGroupServes(eco4, biz7), true);
  assert.equal(vehicleGroupServes(biz7, eco4), false, "降级");
  assert.equal(vehicleGroupServes(biz7, biz5), false, "同级但座位少");
  assert.equal(vehicleGroupServes(lux7, biz7), false);
});

const facts = (extra: Partial<AssignmentFacts> = {}): AssignmentFacts => ({
  serviceDate: "2026-10-20",
  orderedGroup: biz7,
  driverLanguage: null,
  driver: { status: "active", languages: ["ja"], licenseExpiresOn: "2026-10-20" },
  vehicle: { status: "available", plateType: "business", seats: 7, insuranceExpiresOn: "2026-10-20", inspectionExpiresOn: "2026-10-20", group: biz7 },
  ...extra,
});

test("派车校验：全部符合时没有问题；证件到期日就是用车日当天仍可派", () => {
  assert.deepEqual(assignmentIssues(facts()), []);
});

test("派车校验：司机停用、驾照过期、不会客人要求的语言", () => {
  assert.deepEqual(assignmentIssues(facts({ driver: { status: "disabled", languages: ["ja"], licenseExpiresOn: "2026-10-19" }, driverLanguage: "zh" })), [
    "DRIVER_DISABLED",
    "DRIVER_LICENSE_EXPIRED",
    "DRIVER_LANGUAGE_MISSING",
  ]);
  assert.deepEqual(assignmentIssues(facts({ driverLanguage: "ja" })), []);
});

test("派车校验：车辆维修 / 停用、非营业牌照、保险或车检过期、降级、座位少", () => {
  const base = facts().vehicle;
  assert.deepEqual(assignmentIssues(facts({ vehicle: { ...base, status: "maintenance" } })), ["VEHICLE_NOT_AVAILABLE"]);
  assert.deepEqual(assignmentIssues(facts({ vehicle: { ...base, plateType: "private" } })), ["VEHICLE_NOT_BUSINESS_PLATE"]);
  assert.deepEqual(assignmentIssues(facts({ vehicle: { ...base, insuranceExpiresOn: "2026-10-19", inspectionExpiresOn: "2026-01-01" } })), ["VEHICLE_INSURANCE_EXPIRED", "VEHICLE_INSPECTION_EXPIRED"]);
  assert.deepEqual(assignmentIssues(facts({ vehicle: { ...base, group: eco4, seats: 4 } })), ["VEHICLE_GROUP_DOWNGRADE", "VEHICLE_SEATS_TOO_FEW"]);
  assert.deepEqual(assignmentIssues(facts({ vehicle: { ...base, group: lux7 } })), [], "升级可以");
  for (const issue of ASSIGNMENT_ISSUES) assert.ok(ASSIGNMENT_ISSUE_MESSAGES[issue].length > 0);
});

test("派车校验分两边：司机的条件只看司机，车辆的条件只看车辆（可派资源列表各自标原因）", () => {
  const bad = facts({ driver: { status: "disabled", languages: ["ja"], licenseExpiresOn: "2026-10-20" }, vehicle: { ...facts().vehicle, status: "maintenance" } });
  assert.deepEqual(driverAssignmentIssues(bad), ["DRIVER_DISABLED"]);
  assert.deepEqual(vehicleAssignmentIssues(bad), ["VEHICLE_NOT_AVAILABLE"]);
  assert.deepEqual(assignmentIssues(bad), ["DRIVER_DISABLED", "VEHICLE_NOT_AVAILABLE"]);
});
