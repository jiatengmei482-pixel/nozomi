/**
 * 预订草稿 → 新预订页的状态（M9E-01，ADR 0090 第二节第 5 小节）：嵌入组件建草稿后跳 `/book/new?draft=<编号>`，
 * 页面读到草稿就预填用车类型、上 / 下车点、经停点和停留、日期时间、人数行李、包车时长。
 * 地点按「链接给的坐标」处理（类型为空，区间由按两个坐标报价自动判断接送机还是点对点，ADR 0081）。
 */
import type { BookingDraft } from "../api/site.ts";
import type { BookTab, TripPoint } from "./book-new.ts";
import { STAY_OPTIONS, type WaypointDraft, newWaypoint } from "./charter-itinerary.ts";

export interface DraftTrip {
  tab: BookTab;
  from: TripPoint;
  to: TripPoint;
  date: string;
  time: string;
  passengers: number;
  luggage: number;
  /** 包车时长（下拉的值；没给为空字符串） */
  packageHours: string;
  waypoints: WaypointDraft[];
}

const point = (value: BookingDraft["pickup"]): TripPoint => ({ name: value.name, lat: value.lat, lng: value.lng, kind: null });

export function draftTrip(draft: BookingDraft): DraftTrip {
  const [date = "", time = ""] = draft.service_local.split("T");
  const charter = draft.tab === "charter";
  return {
    tab: draft.tab,
    from: point(draft.pickup),
    to: point(draft.dropoff),
    date,
    time,
    passengers: draft.passengers,
    luggage: draft.luggage,
    packageHours: charter && draft.waypoints.length === 0 && draft.package_hours !== null ? String(draft.package_hours) : "",
    // 停留不在页面的选项里（服务端已按同一套规则校验过，正常不会发生）时留空，客人重选
    waypoints: charter ? draft.waypoints.map((stop) => ({ ...newWaypoint(), point: point(stop), stay: STAY_OPTIONS.includes(stop.stay_minutes) ? String(stop.stay_minutes) : "" })) : [],
  };
}

/** 读完草稿能不能直接去第 2 步报价：区间两端齐了就行；包车还要有经停点（按行程）或包车时长 */
export function draftReadyToQuote(trip: DraftTrip): boolean {
  if (trip.date === "" || trip.time === "") return false;
  return trip.tab === "transfer" || trip.waypoints.length > 0 || trip.packageHours !== "";
}

export const DRAFT_EXPIRED_TEXT = "链接已过期，请重新填写。";
export const DRAFT_FAILED_TEXT = "没能读取预订信息，请重新填写，或稍后刷新页面。";
