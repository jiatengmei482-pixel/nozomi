/**
 * 线路式包车与统一订单格式共用的上限（需求 03、ADR 0087 第二节第 1 小节）。
 *
 * 地点名称的长度三处不同：接口和库里的地点名称 1–240 字（同地址联想候选）；预订条件链接（`/book?d=`）里的地点名称 ≤ 30 字（链接长度预算，
 * 超出截断加「…」）；模型线路自己的标题每种语言 ≤ 60 字。停留时长 30 分钟一档、30–480 分钟；地点 2–10 个（途经点 0–8 个）。
 */
export const ROUTE_CHARTER_LIMITS = {
  minStops: 2,
  maxStops: 10,
  maxVias: 8,
  stayStepMinutes: 30,
  minStayMinutes: 30,
  maxStayMinutes: 480,
  placeNameMax: 240,
  linkPlaceNameMax: 30,
  templateNameMax: 60,
} as const;

export type StayMinutesIssue = "REQUIRED" | "OUT_OF_RANGE" | "NOT_A_STEP";

/** 途经点的停留时长对不对：必填、整数、30 的倍数、30–480 分钟。null = 没问题。 */
export function stayMinutesIssue(value: unknown): StayMinutesIssue | null {
  if (value === null || value === undefined) return "REQUIRED";
  if (typeof value !== "number" || !Number.isInteger(value)) return "NOT_A_STEP";
  if (value < ROUTE_CHARTER_LIMITS.minStayMinutes || value > ROUTE_CHARTER_LIMITS.maxStayMinutes) return "OUT_OF_RANGE";
  if (value % ROUTE_CHARTER_LIMITS.stayStepMinutes !== 0) return "NOT_A_STEP";
  return null;
}
