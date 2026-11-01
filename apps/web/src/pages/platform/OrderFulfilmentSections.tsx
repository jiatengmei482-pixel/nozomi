/**
 * 运营订单详情的派车、履约、落地三块（M4-19，验收报告 M3-06 缺陷 2；需求「订单详情一页看全」）。只读，数据来自订单详情接口。
 * 时间都按城市当地时间。接口里是空的地方写明是什么情况，不留空白。
 */
import { NO_SHOW_ITEM_NAMES, type OrderStatus } from "@nozomi/domain";
import type { ReactNode } from "react";
import type { PlatformOrderDetail } from "../../api/order-money.ts";
import { formatInZone, landingSourceName } from "../../lib/dispatch-display.ts";

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="details__item">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const NOT_YET = "还没有记录";

export function OrderFulfilmentSections({ detail }: { detail: Pick<PlatformOrderDetail, "order" | "records" | "events"> }) {
  const { order, records, events } = detail;
  const zone = order.timezone;
  const at = (iso: string | null, missing = NOT_YET): string => (iso === null ? missing : formatInZone(iso, zone));
  const { dispatch, fulfilment, landing } = order;
  const assigned = dispatch.assigned_at !== null;
  const unpaid = order.confirmed_at === null;
  const notDispatched = unpaid ? "还没付款，不派车" : "还没派车";
  /** 这个履约节点是不是平台代传的（ADR 0052）：代传的时间是运营填的，要分得清。 */
  const proxied = (status: OrderStatus): ReactNode => (events.some((event) => event.to_status === status && event.source === "platform_proxy") ? <> <span className="tag">平台代传</span></> : null);
  return (
    <>
      <section className="card" aria-labelledby="order-dispatch">
        <h2 className="card__title" id="order-dispatch">{`派车（当地时间，${zone}）`}</h2>
        <dl className="details">
          <Item label="派车截止">{at(dispatch.due_at, "没有（还没付款）")}{dispatch.overdue && "（已超时）"}</Item>
          <Item label="派车时间">{at(dispatch.assigned_at, notDispatched)}</Item>
          <Item label="司机">{dispatch.driver === null ? (assigned ? "查不到司机资料" : notDispatched) : `${dispatch.driver.name} · ${dispatch.driver.phone}`}</Item>
          <Item label="车辆">{dispatch.vehicle === null ? (assigned ? "查不到车辆资料" : notDispatched) : `${dispatch.vehicle.plate} · ${dispatch.vehicle.model}`}</Item>
          <Item label="司机链接">{records.driver_link === null ? "没有有效的链接" : `${records.driver_link.status === "active" ? "有效" : "已过期"}，到 ${formatInZone(records.driver_link.expires_at, zone)}；${records.driver_link.last_used_at === null ? "司机还没打开过" : `司机最近打开 ${formatInZone(records.driver_link.last_used_at, zone)}`}`}</Item>
        </dl>
        {records.assignments.length > 1 && (
          <>
            <h3 className="card__subtitle">派车和改派记录</h3>
            <ul className="plain-list">
              {records.assignments.map((entry) => (
                <li key={entry.id}>{`${formatInZone(entry.assigned_at, zone)} ${entry.is_change ? "改派" : "派车"}${entry.conflict_confirmed ? "（调度确认过时段冲突）" : ""}`}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card" aria-labelledby="order-fulfilment">
        <h2 className="card__title" id="order-fulfilment">{`履约（当地时间，${zone}）`}</h2>
        <dl className="details">
          <Item label="司机出发">{at(fulfilment.departed_at)}{proxied("departed")}</Item>
          <Item label="到达上车点">
            {at(fulfilment.arrived_at)}
            {fulfilment.arrived_at !== null && (fulfilment.arrival_distance_m === null ? "（没有定位）" : `（距上车点 ${fulfilment.arrival_distance_m} 米${fulfilment.arrival_within_range ? "" : "，超过 300 米"}）`)}
            {proxied("arrived")}
          </Item>
          <Item label="接到客人">{at(fulfilment.picked_up_at)}{proxied("in_service")}</Item>
          <Item label="完成">
            {at(fulfilment.completed_at)}
            {fulfilment.actual_minutes !== null && `（实际 ${fulfilment.actual_minutes} 分钟、${fulfilment.actual_km ?? "—"} 公里）`}
            {proxied("completed")}
          </Item>
          {fulfilment.leave_requested_at !== null && <Item label="司机申请离开">{at(fulfilment.leave_requested_at)}</Item>}
        </dl>
        {records.no_show_claim !== null && (
          <>
            <h3 className="card__subtitle">{`客人未出现：${formatInZone(records.no_show_claim.submitted_at, zone)} 提交`}</h3>
            <ul className="plain-list">
              {records.no_show_claim.checklist.map((entry) => (
                <li key={entry.item}>{`${entry.ok ? "✓" : "✗"} ${NO_SHOW_ITEM_NAMES[entry.item]}`}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card" aria-labelledby="order-landing">
        <h2 className="card__title" id="order-landing">{`落地（当地时间，${zone}）`}</h2>
        {landing === null ? (
          <p className="table__muted">这一单不是接机，不记落地时间。</p>
        ) : (
          <>
            <dl className="details">
              <Item label="航班号">{order.flight_no === null ? "没有填" : <span className="mono">{order.flight_no}</span>}</Item>
              <Item label="计划到达">{at(landing.scheduled_at)}</Item>
              <Item label="实际落地（按规则取定）">{`${at(landing.landed_at)}（来源：${landingSourceName(landing.source)}）`}</Item>
              <Item label="客人确认">{at(landing.guest_reported_at, "客人没有确认")}</Item>
              <Item label="司机填写">{landing.driver_reported_at === null ? "司机没有填写" : `${at(landing.driver_reported_at)}${landing.driver_photo_file_id === null ? "" : "（附到达屏照片）"}`}</Item>
              <Item label="延误">{landing.delay_minutes === 0 ? "没有延误" : `${landing.delay_minutes} 分钟${landing.within_delay_allowance ? "（6 小时内，顺延接机、不加收）" : "（超过 6 小时）"}`}</Item>
            </dl>
            {landing.source === "scheduled" && <p className="field__hint">客人和司机都还没有报落地时间，现在按计划到达时间算。</p>}
            {landing.disagreement && <p className="field__hint field__hint--warning">客人和司机报的时间不一致，取较晚的那个。</p>}
          </>
        )}
      </section>
    </>
  );
}
