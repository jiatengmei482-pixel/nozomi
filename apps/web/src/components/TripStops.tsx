/**
 * 包车行程（M9W-02 / M9W-03，ADR 0088）：上车 → 经停 1…N（停留）→ 下车，按顺序的列表。
 * 官网下单页（带各段行驶分钟）、官网订单页、运营 / 供应商订单详情、司机页共用；这里**不含任何价格**。
 * 没有经停点的订单不用它（页面照旧只写上车、下车地点）。
 */
import { type OrderItinerary, type ScheduleRow, durationText, orderItineraryText, scheduleRows } from "../lib/charter-itinerary.ts";

export function TripStops({ rows, label = "行程" }: { rows: readonly ScheduleRow[]; label?: string }) {
  return (
    <ol className="trip-stops" aria-label={label}>
      {rows.map((row) => (
        <li key={row.key} className={`trip-stops__item trip-stops__item--${row.kind}`}>
          {row.driveMinutes !== null && <span className="trip-stops__drive">行驶约 {durationText(row.driveMinutes)}</span>}
          <span className="trip-stops__line">
            <span className="trip-stops__label">{row.label}</span>
            <span className="trip-stops__name">{row.name}</span>
          </span>
          {row.stayMinutes !== null && <span className="trip-stops__stay">停留 {durationText(row.stayMinutes)}</span>}
        </li>
      ))}
    </ol>
  );
}

/** 订单上的经停点 → 行程的各行（上车、经停、下车的名称用订单上的地址） */
export function orderStopRows(order: { pickup: { address: string } | null; dropoff: { address: string } | null; waypoints?: readonly { name: string; stay_minutes: number }[] | null | undefined }): ScheduleRow[] | null {
  if (order.waypoints === null || order.waypoints === undefined || order.waypoints.length === 0) return null;
  return scheduleRows(order.pickup?.address ?? "—", order.dropoff === null ? null : order.dropoff.address, order.waypoints);
}

/** 运营、供应商订单详情「行程」卡片里的「经停点」一项（`details` 列表的一行）；没有经停点时不出 */
export function OrderStopsItem({ order }: { order: Parameters<typeof orderStopRows>[0] & { itinerary?: OrderItinerary | null } }) {
  const rows = orderStopRows(order);
  if (rows === null) return null;
  const summary = orderItineraryText(order.itinerary);
  return (
    <div className="details__item">
      <dt>经停点</dt>
      <dd>
        <TripStops rows={rows} label="包车行程" />
        {summary !== null && <p className="trip-stops__summary">{summary}</p>}
      </dd>
    </div>
  );
}
