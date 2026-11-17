/**
 * 包车行程（M9W-02 / M9W-03，ADR 0088）：上车 → 经停（停留）→ 下车，按顺序的列表。
 * 编号（M9P-20，ADR 0096）：上车 = 1、经停依次、下车 = 最后，和行程地图的标记一致；两行之间写这一段的行驶时长和公里（有路线时）。
 * 官网下单页（带各段行驶分钟）、官网订单页、运营 / 供应商订单详情、司机页共用；这里**不含任何价格**。
 * 没有经停点的订单不用它（页面照旧只写上车、下车地点）。
 * 指定到达时间（M9P-20 P3）：经停行写「须在 14:00 前到达」；运营 / 供应商订单详情没有逐段时长（订单接口还没有 itinerary.legs，ADR 0096 P1 遗留），不标预计晚到。
 * 预计时刻（M9P-20 验收）：官网下单页给 `times`，上车「09:00 出发」、经停「09:31 到达浅草寺」「10:31 出发」、下车「13:20 到达新宿」；
 * 预计晚于指定到达时间的那一站，到达时刻标红并加图标（不只靠颜色），下面是文字提示。
 */
import type { RowTimes } from "../lib/arrive-by-display.ts";
import { itineraryCopy } from "../lib/itinerary-texts.ts";
import { Icon } from "./Icon.tsx";
import { type OrderItinerary, type ScheduleRow, durationText, kmText, orderItineraryText, scheduleRows } from "../lib/charter-itinerary.ts";

/** 「行驶约 35 分钟 · 28.4 公里」；没有米数时只写时长 */
function driveText(row: ScheduleRow): string {
  const duration = durationText(row.driveMinutes ?? 0);
  return row.driveMeters === null ? itineraryCopy("drive", { duration }) : itineraryCopy("driveKm", { duration, km: kmText(row.driveMeters) });
}

/**
 * `late`：按行的 `key` 给的晚到提示（M9P-20 P3，官网下单页按当前顺序算；订单详情没有逐段时长，不给）。
 * `times`：按行的 `key` 给的预计时刻（M9P-20 验收，同上只有官网下单页给）。
 * 指定了到达时间的经停写「须在 14:00 前到达」（`row.deadline`）。
 */
export function TripStops({ rows, label = "行程", late = {}, times = {} }: { rows: readonly ScheduleRow[]; label?: string; late?: Readonly<Record<string, string>>; times?: Readonly<Record<string, RowTimes>> }) {
  return (
    <ol className="trip-stops" aria-label={label}>
      {rows.map((row) => {
        const time = times[row.key];
        return (
          <li key={row.key} className={`trip-stops__item trip-stops__item--${row.kind}`}>
            {row.driveMinutes !== null && <span className="trip-stops__drive">{driveText(row)}</span>}
            <span className="trip-stops__line">
              <span className="trip-stops__label">
                <span className="trip-stops__number">{row.number}</span> {row.kindName}
              </span>
              <span className="trip-stops__name">{row.name}</span>
            </span>
            {time !== undefined && time.arrive !== null && (
              <span className={time.late ? "trip-stops__eta trip-stops__eta--late" : "trip-stops__eta"} data-eta="arrive" {...(time.late ? { "data-late": "" } : {})}>
                {time.late && <Icon name="alert-triangle" />}
                {time.arrive}
              </span>
            )}
            {row.stayMinutes !== null && <span className="trip-stops__stay">停留 {durationText(row.stayMinutes)}</span>}
            {row.deadline !== null && <span className="trip-stops__deadline">{row.deadline}</span>}
            {time !== undefined && time.depart !== null && (
              <span className="trip-stops__eta" data-eta="depart">
                {time.depart}
              </span>
            )}
            {late[row.key] !== undefined && (
              <span className="trip-stops__late">
                <Icon name="alert-triangle" /> {late[row.key]}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** 订单上的经停点 → 行程的各行（上车、经停、下车的名称用订单上的地址） */
export function orderStopRows(order: { pickup: { address: string } | null; dropoff: { address: string } | null; waypoints?: readonly { name: string; stay_minutes: number; arrive_by?: unknown }[] | null | undefined }): ScheduleRow[] | null {
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
