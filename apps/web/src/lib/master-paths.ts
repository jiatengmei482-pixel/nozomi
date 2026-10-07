/** 运营后台主数据各页面的地址（docs/design/pages/platform-home.md 第 2 节）。 */
import type { MasterKind } from "../api/master.ts";

export const MASTER_ROOT = "/platform/master";
export const PENDING_AIRPORTS_PATH = `${MASTER_ROOT}/places/pending`;

export function masterListPath(kind: MasterKind): string {
  return `${MASTER_ROOT}/${kind}`;
}
export function masterNewPath(kind: MasterKind): string {
  return `${MASTER_ROOT}/${kind}/new`;
}
export function masterEditPath(kind: MasterKind, id: string): string {
  return `${MASTER_ROOT}/${kind}/${id}`;
}
/** 处理导入的机场，可以从指定的一个机场开始。 */
export function pendingAirportsPath(startId?: string): string {
  return startId === undefined ? PENDING_AIRPORTS_PATH : `${PENDING_AIRPORTS_PATH}?start=${startId}`;
}
export const PLACE_TABS = ["airport", "station", "poi"] as const;
export type PlaceTab = (typeof PLACE_TABS)[number];
export function placeListPath(tab: PlaceTab, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ ...(tab === "airport" ? {} : { type: tab }), ...extra });
  const text = params.toString();
  return text === "" ? masterListPath("places") : `${masterListPath("places")}?${text}`;
}
