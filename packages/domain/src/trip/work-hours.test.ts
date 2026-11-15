/** 工时与第二司机（ADR 0100 第四节第 3 条；第七节第 5 条的工时情形）。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { TRIP_RULE_DEFAULTS } from "./rules.ts";
import { type DayWorkInput, evaluateWorkHours } from "./work-hours.ts";

const rules = TRIP_RULE_DEFAULTS.workHours;
const DAY = 1440;
const day = (dayIndex: number, start: string, end: string, extra: Partial<DayWorkInput> = {}): DayWorkInput => {
  const m = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  return { dayIndex, startMinute: dayIndex * DAY + m(start), endMinute: dayIndex * DAY + m(end) + (m(end) < m(start) ? DAY : 0), driveMinutes: 240, meters: 200_000, startInBase: true, endInBase: true, sameVehicleAsPrevious: true, ...extra };
};
const run = (days: DayWorkInput[], secondDriverEnabled = true, checkRest = true) => evaluateWorkHours(days, rules, { secondDriverEnabled, checkRest });

test("拘束 = 首段开始到末段结束 + 两端出入库（①里各 60 分钟）", () => {
  const [r] = run([day(0, "09:00", "18:00")]);
  assert.equal(r?.bindMinutes, 540 + 120);
  assert.equal(r?.status, "ok");
  assert.equal(r?.restBeforeMinutes, null);
});

test("外地过夜：出入库 15 分钟", () => {
  const [r] = run([day(0, "09:00", "18:00", { endInBase: false })]);
  assert.equal(r?.bindMinutes, 540 + 60 + 15);
});

test("13 h 只经出入库触发：T = 12 h（引擎不拒）+ 出入库 2 h = 14 h → 第二司机", () => {
  const [r] = run([day(0, "07:00", "19:00")]);
  assert.equal(r?.bindMinutes, 840);
  assert.deepEqual(r?.reasons, ["BIND_OVER"]);
  assert.equal(r?.status, "second_driver");
});

test("13 h 经一天多段触发：接机 07:00 + 包车到 19:30（段间空档也算拘束）", () => {
  const [r] = run([day(0, "07:00", "19:30", { startInBase: false })]);
  assert.equal(r?.bindMinutes, 750 + 15 + 60);
  assert.equal(r?.status, "second_driver");
});

test("超 15 h → 第二司机也不行（WORK_HOURS_HARD_LIMIT）", () => {
  const [r] = run([day(0, "06:00", "20:30")]);
  assert.equal(r?.bindMinutes, 990);
  assert.equal(r?.status, "unquoted");
  assert.equal(r?.unquoted, "WORK_HOURS_HARD_LIMIT");
});

test("驾驶 > 9 h、公里 > 600 → 第二司机；关了第二司机 → WORK_HOURS_EXCEEDED", () => {
  const [a] = run([day(0, "08:00", "18:00", { driveMinutes: 541, meters: 600_001 })]);
  assert.deepEqual(a?.reasons, ["DRIVE_OVER", "KM_OVER"]);
  assert.equal(a?.status, "second_driver");
  const [b] = run([day(0, "08:00", "18:00", { driveMinutes: 541 })], false);
  assert.equal(b?.status, "unquoted");
  assert.equal(b?.unquoted, "WORK_HOURS_EXCEEDED");
  const [c] = run([day(0, "08:00", "18:00", { driveMinutes: 540, meters: 600_000 })]);
  assert.equal(c?.status, "ok");
});

test("两天之间休息 < 11 h → 次日加第二司机；< 9 h → 次日报不出", () => {
  // 第 0 天 10:00–20:00 → 拘束 09:00–21:00（12 h）；第 1 天 08:00 开始 → 拘束从 07:00，休息 10 h
  const short = run([day(0, "10:00", "20:00"), day(1, "08:00", "12:00")]);
  assert.equal(short[0]?.status, "ok");
  assert.equal(short[1]?.restBeforeMinutes, 600);
  assert.deepEqual(short[1]?.reasons, ["REST_SHORT"]);
  assert.equal(short[1]?.status, "second_driver");
  const hard = run([day(0, "10:00", "20:00"), day(1, "06:30", "12:00")]);
  assert.equal(hard[1]?.restBeforeMinutes, 510);
  assert.equal(hard[1]?.unquoted, "WORK_HOURS_HARD_LIMIT");
});

test("每天各自最优（checkRest: false）或换了车：不看两天之间的休息", () => {
  const days = [day(0, "10:00", "20:00"), day(1, "06:30", "12:00")];
  assert.equal(run(days, true, false)[1]?.status, "ok");
  assert.equal(run([days[0] as DayWorkInput, { ...(days[1] as DayWorkInput), sameVehicleAsPrevious: false }])[1]?.restBeforeMinutes, null);
});

test("末段结束早于首段开始 → RangeError", () => {
  assert.throws(() => run([{ ...day(0, "09:00", "10:00"), endMinute: 0 }]), RangeError);
});
