/**
 * 行程报价页第 2 步「报价结果」（M9T-09，ADR 0101 第十二节第 2 小节、第十三节第 1、2 小节）：
 * - 方案对比卡片：每个报出的方案一张（`one_car` 同一辆车跑完全程 / `daily_best` 每天选最划算的车），宽屏并排、窄屏上下排。
 *   卡片里有推荐标记、车型（一车到底）、合计；逐天列出每一段（接机 / 送机 / 点对点 / 包车 N 小时 / 不用车）、时间、金额、换车提示和挂在这天的费用；
 *   最后是按晚算的费用（司机住宿等）和提示（第二司机、换车、接近工时上限）。过期的写一句并给「重新报价」。
 * - 部分报不出：照常展示报得出的方案，逐条写「方案（第 N 天）：这个方案暂时报不出：原因」。
 * - 全部报不出（`manual_quote_suggested`）：不展示方案，给「转人工报价」按钮；点开是现有的人工报价表单（邮箱 / WhatsApp），
 *   提交时带上行程单编号、`plan_kind: null` 和每天的地名（M9T-08），`trip` 填第一天的行程（`trip-manual.ts`）。
 * - 下单按钮（单段方案走现有下单付款、多段方案按业主决定）是 M9T-10，不在本组件。
 */
import { useEffect, useId, useRef, useState } from "react";
import type { SiteTrip, SiteTripPlan, SiteTripPlanKind, SiteTripSegment, SiteTripSegmentType, SiteTripWarningCode } from "../../../api/site.ts";
import { Button } from "../../../components/Button.tsx";
import { moneyText } from "../../../lib/dispatch-display.ts";
import { displayName } from "../../../lib/master-display.ts";
import { loadTripLabels } from "../../../lib/trip-labels-store.ts";
import { tripLabelsFor, tripManualQuoteDraft } from "../../../lib/trip-manual.ts";
import { type TripTextKey, tripCopy, tripReasonKey } from "../../../lib/trip-texts.ts";
import { ManualQuoteBlock } from "../ManualQuote.tsx";

export interface TripQuoteResultProps {
  trip: SiteTrip;
  /** 重新报价（过期、还没报过价时） */
  onQuote(): void;
  quoting: boolean;
  /** 官网配置的客服 WhatsApp（转人工表单下面的按钮；没有为 null） */
  supportWhatsapp?: string | null;
}

const planName = (kind: SiteTripPlanKind): string => tripCopy(kind === "one_car" ? "plan.one_car" : "plan.daily_best");

/** `YYYY-MM-DDTHH:MM…` → `HH:MM`；没有为 null */
const clock = (local: string | null): string | null => (local !== null && local.length >= 16 ? local.slice(11, 16) : null);

/** `YYYY-MM-DD` → `M月D日` */
const dayDate = (date: string): string => {
  const [, month, day] = date.split("-");
  return month !== undefined && day !== undefined ? `${Number(month)}月${Number(day)}日` : date;
};

/** 段类型 → 文案键：新增段类型时这里编译不过，提醒补文案 */
const SEGMENT_KEYS: Readonly<Record<SiteTripSegmentType, TripTextKey>> = {
  airport_pickup: "segment.airport_pickup",
  airport_dropoff: "segment.airport_dropoff",
  p2p: "segment.p2p",
  charter: "segment.charter",
  idle_day: "segment.idle_day",
};

/** 提示码 → [某一天, 整个方案] 的文案键 */
const WARNING_KEYS: Readonly<Record<SiteTripWarningCode, readonly [TripTextKey, TripTextKey]>> = {
  SECOND_DRIVER: ["warning.SECOND_DRIVER", "warning.SECOND_DRIVERWhole"],
  SEGMENT_OTHER_VEHICLE: ["warning.SEGMENT_OTHER_VEHICLE", "warning.SEGMENT_OTHER_VEHICLEWhole"],
  WORK_HOURS_HARD_LIMIT: ["warning.WORK_HOURS_HARD_LIMIT", "warning.WORK_HOURS_HARD_LIMITWhole"],
};

function segmentName(segment: SiteTripSegment): string {
  if (segment.type === "charter" && segment.package_hours !== null) return tripCopy("segment.charterHours", { hours: segment.package_hours });
  return tripCopy(SEGMENT_KEYS[segment.type]);
}

function warningText(code: SiteTripWarningCode, dayIndex: number | null): string {
  const [day, whole] = WARNING_KEYS[code];
  return dayIndex === null ? tripCopy(whole) : tripCopy(day, { n: dayIndex + 1 });
}

function PlanCard({ plan }: { plan: SiteTripPlan }) {
  const titleId = useId();
  const name = planName(plan.kind);
  const group = plan.vehicle_group === null ? null : displayName(plan.vehicle_group.name);
  return (
    <li className={plan.recommended ? "trip-plan trip-plan--recommended" : "trip-plan"} data-plan-kind={plan.kind} aria-labelledby={titleId}>
      <div className="trip-plan__head">
        <h3 id={titleId} className="book-new__subtitle trip-plan__name">
          {name}
        </h3>
        {plan.recommended && <span className="trip-plan__badge">{tripCopy("recommended")}</span>}
      </div>
      {group !== null && (
        <p className="site-muted trip-plan__vehicle" lang={group.lang}>
          {tripCopy("vehicleGroup", { name: group.text })}
        </p>
      )}
      <p className="trip-plan__total">
        <span className="trip-plan__total-label">{tripCopy("total")}</span>
        <span className="trip-plan__amount">{moneyText(plan.total)}</span>
      </p>
      {plan.expired && <p className="trip-plan__expired">{tripCopy("expired")}</p>}
      <ol className="trip-plan__days" aria-label={tripCopy("dayListOf", { plan: name })}>
        {plan.days.map((day) => (
          <li key={day.day_index} className="trip-plan__day" data-day-index={day.day_index}>
            <h4 className="trip-plan__day-title">{tripCopy("dayHeading", { n: day.day_index + 1, date: dayDate(day.date) })}</h4>
            <ul className="trip-plan__lines">
              {day.segments.map((segment) => {
                const start = clock(segment.start_local);
                const end = clock(segment.end_local);
                return (
                  <li key={segment.segment_id} className="trip-plan__line" data-segment-type={segment.type}>
                    <span className="trip-plan__line-name">
                      {segmentName(segment)}
                      {start !== null && end !== null && <span className="site-muted trip-plan__line-time">{tripCopy("segmentTime", { start, end })}</span>}
                      {segment.other_vehicle && <span className="trip-plan__line-note">{tripCopy("otherVehicle")}</span>}
                    </span>
                    {segment.amount !== null && <span className="trip-plan__line-amount">{moneyText(segment.amount)}</span>}
                  </li>
                );
              })}
              {day.fees.map((fee, index) => {
                const label = displayName(fee.label);
                return (
                  <li key={`fee-${fee.type}-${index}`} className="trip-plan__line trip-plan__line--fee" data-fee-type={fee.type}>
                    <span className="trip-plan__line-name" lang={label.lang}>
                      {label.text}
                    </span>
                    <span className="trip-plan__line-amount">{moneyText(fee.amount)}</span>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>
      {plan.fees.length > 0 && (
        <div className="trip-plan__fees">
          <h4 className="trip-plan__day-title">{tripCopy("planFees")}</h4>
          <ul className="trip-plan__lines">
            {plan.fees.map((fee, index) => {
              const label = displayName(fee.label);
              return (
                <li key={`plan-fee-${fee.type}-${index}`} className="trip-plan__line trip-plan__line--fee" data-fee-type={fee.type}>
                  <span className="trip-plan__line-name" lang={label.lang}>
                    {label.text}
                  </span>
                  <span className="trip-plan__line-amount">{moneyText(fee.amount)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {plan.warnings.length > 0 && (
        <ul className="trip-plan__warnings">
          {plan.warnings.map((warning, index) => (
            <li key={`${warning.code}-${warning.day_index ?? "all"}-${index}`} data-warning={warning.code}>
              {warningText(warning.code, warning.day_index)}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function ManualQuoteSection({ trip, supportWhatsapp }: { trip: SiteTrip; supportWhatsapp: string | null }) {
  const [open, setOpen] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // 点了「转人工报价」按钮就没了，焦点移到这块的标题，读屏接着读表单
  useEffect(() => {
    if (open) titleRef.current?.focus();
  }, [open]);
  const labels = loadTripLabels(trip.trip_id);
  const draft = tripManualQuoteDraft(trip.itinerary, labels);
  return (
    <section className="trip-manual" aria-labelledby="trip-manual-title">
      <h3 id="trip-manual-title" ref={titleRef} tabIndex={-1} className="book-new__subtitle">
        {tripCopy("manual.title")}
      </h3>
      {/* 表单展开后它自己有说明，这句就不重复了 */}
      {!open && <p className="site-muted">{draft === null ? tripCopy("manual.noTrip") : tripCopy("manual.cardHint")}</p>}
      {draft !== null &&
        (open ? (
          <ManualQuoteBlock trip={draft} supportWhatsapp={supportWhatsapp} headingLevel="h4" tripLink={{ tripId: trip.trip_id, planKind: null, labels: tripLabelsFor(trip.itinerary, labels) }} />
        ) : (
          <div>
            <Button variant="primary" size="lg" onClick={() => setOpen(true)}>
              {tripCopy("manual.cta")}
            </Button>
          </div>
        ))}
    </section>
  );
}

export function TripQuoteResult({ trip, onQuote, quoting, supportWhatsapp = null }: TripQuoteResultProps) {
  const quoteButton = (label: string) => (
    <Button variant="primary" size="lg" loading={quoting} loadingText={tripCopy("quoting")} onClick={onQuote}>
      {label}
    </Button>
  );
  const notQuoted = trip.quoted_at === null && trip.plans.length === 0 && trip.unquoted.length === 0;
  const expired = trip.plans.some((plan) => plan.expired);

  return (
    <div className="trip-result" data-trip-result="plans">
      {notQuoted && (
        <div className="book-new__notice" role="status">
          <p>{tripCopy("notQuoted")}</p>
          {quoteButton(tripCopy("quote"))}
        </div>
      )}
      {trip.manual_quote_suggested && <ManualQuoteSection trip={trip} supportWhatsapp={supportWhatsapp} />}
      {trip.plans.length > 0 && (
        <ul className={trip.plans.length > 1 ? "trip-plans trip-plans--compare" : "trip-plans"} aria-label={trip.plans.length > 1 ? tripCopy("compare") : tripCopy("resultSection")}>
          {trip.plans.map((plan) => (
            <PlanCard key={plan.plan_id} plan={plan} />
          ))}
        </ul>
      )}
      {expired && quoteButton(tripCopy("requote"))}
      {trip.degraded && (
        <p className="site-muted" role="note">
          {tripCopy("degraded")}
        </p>
      )}
      {trip.unquoted.length > 0 && (
        <section className="trip-unquoted" aria-labelledby="trip-unquoted-title">
          <h3 id="trip-unquoted-title" className="book-new__subtitle">
            {tripCopy("unquotedTitle")}
          </h3>
          <ul className="trip-unquoted__list">
            {trip.unquoted.map((entry, index) => {
              const plan = planName(entry.plan_kind);
              const which = entry.day_index === null ? tripCopy("unquotedWhole", { plan }) : tripCopy("unquotedDay", { plan, n: entry.day_index + 1 });
              return (
                <li key={`${entry.plan_kind}-${entry.day_index ?? "all"}-${index}`} className="trip-unquoted__item" data-reason={entry.reason}>
                  <span className="trip-unquoted__plan">{which}</span>
                  <span>{tripCopy("unquoted", { reason: tripCopy(tripReasonKey(entry.reason)) })}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
