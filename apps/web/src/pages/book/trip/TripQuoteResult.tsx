/**
 * 行程报价页第 2 步「报价结果」的骨架（M9T-09 第一部分，ADR 0101 第十三节第 1 小节）：
 * - 每个报出的方案一行：方案名（`one_car` 同一辆车跑完全程 / `daily_best` 每天选最划算的车）、推荐标记、合计、一车到底的车型；过期的写一句「请重新报价」；
 * - 报不出的方案逐条写「方案（第 N 天）：这个方案暂时报不出：原因」；
 * - 全部报不出（`manual_quote_suggested`）时只写「这个行程需要客服人工报价」（转人工的按钮在第二部分，接 M9T-08 的人工报价申请）；
 * - 行程太长降级（`degraded`）时说明一句；还没报过价（刷新时上次报价没成功）时给「查看报价」。
 * 第二部分会把整块换成方案对比卡片（每天的段、价格明细、跨段费用、下单 / 转人工按钮）：页面只依赖本组件的 props，换的时候不动页面。
 */
import type { SiteTrip, SiteTripPlanKind } from "../../../api/site.ts";
import { Button } from "../../../components/Button.tsx";
import { moneyText } from "../../../lib/dispatch-display.ts";
import { displayName } from "../../../lib/master-display.ts";
import { tripCopy, tripReasonKey } from "../../../lib/trip-texts.ts";

export interface TripQuoteResultProps {
  trip: SiteTrip;
  /** 重新报价（过期、还没报过价时） */
  onQuote(): void;
  quoting: boolean;
}

const planName = (kind: SiteTripPlanKind): string => tripCopy(kind === "one_car" ? "plan.one_car" : "plan.daily_best");

export function TripQuoteResult({ trip, onQuote, quoting }: TripQuoteResultProps) {
  const quoteButton = (label: string) => (
    <Button variant="primary" size="lg" loading={quoting} loadingText={tripCopy("quoting")} onClick={onQuote}>
      {label}
    </Button>
  );
  const notQuoted = trip.quoted_at === null && trip.plans.length === 0 && trip.unquoted.length === 0;
  const expired = trip.plans.some((plan) => plan.expired);

  return (
    <div className="trip-result" data-trip-result="skeleton">
      {notQuoted && (
        <div className="book-new__notice" role="status">
          <p>{tripCopy("notQuoted")}</p>
          {quoteButton(tripCopy("quote"))}
        </div>
      )}
      {trip.manual_quote_suggested && (
        <section className="trip-manual" aria-labelledby="trip-manual-title">
          <h3 id="trip-manual-title" className="book-new__subtitle">
            {tripCopy("manual.title")}
          </h3>
          <p className="site-muted">{tripCopy("manual.hint")}</p>
        </section>
      )}
      {trip.plans.length > 0 && (
        <ul className="trip-plans" aria-label={tripCopy("resultSection")}>
          {trip.plans.map((plan) => {
            const name = planName(plan.kind);
            const group = plan.vehicle_group === null ? null : displayName(plan.vehicle_group.name);
            const titleId = `trip-plan-${plan.plan_id}-title`;
            return (
              <li key={plan.plan_id} className={plan.recommended ? "trip-plan trip-plan--recommended" : "trip-plan"} data-plan-kind={plan.kind} aria-labelledby={titleId}>
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
              </li>
            );
          })}
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
