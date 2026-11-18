/**
 * 行程报价页第 2 步「报价结果」（M9T-09，ADR 0101 第十二节第 2 小节、第十三节第 1、2 小节）：
 * - 方案对比卡片：每个报出的方案一张（`one_car` 同一辆车跑完全程 / `daily_best` 每天选最划算的车），宽屏并排、窄屏上下排。
 *   卡片里有推荐标记、车型（一车到底）、合计；逐天列出每一段（接机 / 送机 / 点对点 / 包车 N 小时 / 不用车）、时间、金额、换车提示和挂在这天的费用；
 *   最后是按晚算的费用（司机住宿等）和提示（第二司机、换车、接近工时上限）。过期的写一句并给「重新报价」。
 * - 部分报不出：照常展示报得出的方案，逐条写「方案（第 N 天）：这个方案暂时报不出：原因」。
 * - 全部报不出（`manual_quote_suggested`）：不展示方案，给「转人工报价」按钮；点开是现有的人工报价表单（邮箱 / WhatsApp），
 *   提交时带上行程单编号、`plan_kind: null` 和每天的地名（M9T-08），`trip` 填第一天的行程（`trip-manual.ts`）。
 * - 下单出口（M9T-10，ADR 0101 第十三节第 3 小节；没过期的方案卡片底部）：
 *   - 单段方案（`tripBookableSegment`）：「预订这个方案」→ `POST …/order-quote`（包车带经停点的地名）→ 带着这张普通报价跳进 `/book/new` 第 3 步，
 *     接着填乘客信息、下单、付款（`lib/trip-book.ts`）。价格变了（409 `TRIP_PRICE_CHANGED`）、方案过期 / 不在了写一句并给「重新报价」，
 *     这一车型报不出 / 条件对不上时另给「转人工报价」；后端说不是单段时退回「提交预订，客服确认」；太频繁、断网同报价的说法。
 *   - 多段方案：「提交预订，客服确认」= 带 `trip_id` + 这个方案的 `plan_kind` 的人工报价（`PlanManualBooking`）。业主待定（#288 多段方案 A/B/C），按推荐 A。
 */
import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ApiError } from "../../../api/client.ts";
import { type SiteTrip, type SiteTripPlan, type SiteTripPlanKind, type SiteTripSegment, type SiteTripSegmentType, type SiteTripWarningCode, createSiteTripOrderQuote } from "../../../api/site.ts";
import { Alert } from "../../../components/Alert.tsx";
import { Button } from "../../../components/Button.tsx";
import { SITE_NEW_BOOKING_PATH } from "../../../lib/book-new.ts";
import { moneyText } from "../../../lib/dispatch-display.ts";
import { displayName } from "../../../lib/master-display.ts";
import { TRIP_BOOK_SEARCH, TRIP_BOOK_STATE, type TripBookable, tripBookHandoff, tripBookableSegment, tripOrderQuoteBody } from "../../../lib/trip-book.ts";
import { tripFailureOf } from "../../../lib/trip-form.ts";
import type { TripLabels } from "../../../lib/trip-labels-store.ts";
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
  /** 本标签页存的地名（页面读好传进来，只有页面碰暂存）；没有为 null，转人工时写坐标 */
  labels?: TripLabels | null;
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

/**
 * 业主待定（#288 多段方案 A/B/C），按推荐 A：多段方案（和不能直接在线下单的单段方案）给「提交预订，客服确认」，
 * 即带 `trip_id` + 这个方案 `plan_kind` 的人工报价（ADR 0101 第十三节第 3 小节）。业主选 B（多段只展示）时把它改成 false，
 * 或连同 `PlanManualBooking` 一起删掉；单段方案的「预订这个方案」不受影响。
 */
const MULTI_SEGMENT_MANUAL_BOOKING = true;

/**
 * 「提交预订，客服确认」（M9T-10，按推荐 A）：点开是现有的人工报价表单，`trip` 填第一天的行程，`tripLink` 带这个方案的 `plan_kind`。
 * 价格变了、这一车型报不出时的「转人工报价」也用它（`cta` 换文案）。业主待定（#288 多段方案 A/B/C），按推荐 A。
 */
function PlanManualBooking({ trip, plan, labels, supportWhatsapp, cta = "bookManual" }: { trip: SiteTrip; plan: SiteTripPlan; labels: TripLabels | null; supportWhatsapp: string | null; cta?: "bookManual" | "manual.cta" }) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  // 按钮点了就没了：焦点移到表单的第一个框
  useEffect(() => {
    if (open) formRef.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [open]);
  const draft = tripManualQuoteDraft(trip.itinerary, labels);
  if (draft === null) return <p className="site-muted">{tripCopy("manual.noTrip")}</p>;
  if (open) {
    return (
      <div ref={formRef} className="trip-plan__manual">
        <ManualQuoteBlock trip={draft} supportWhatsapp={supportWhatsapp} headingLevel="h4" tripLink={{ tripId: trip.trip_id, planKind: plan.kind, labels: tripLabelsFor(trip.itinerary, labels) }} />
      </div>
    );
  }
  return (
    <div className="trip-plan__book">
      <Button variant={cta === "bookManual" ? "primary" : "secondary"} size="lg" onClick={() => setOpen(true)}>
        {tripCopy(cta)}
      </Button>
      {cta === "bookManual" && <p className="site-muted">{tripCopy("bookManual.hint")}</p>}
    </div>
  );
}

/** 「预订这个方案」没成：要重新报价（价格变了、过期、方案不在了；`manual` 时另给转人工）、退回客服确认（后端说不是单段）、别的出错 */
type BookProblem = { kind: "requote"; text: string; manual: boolean } | { kind: "manual"; text: string } | { kind: "failed"; text: string };

function bookProblemOf(err: unknown): BookProblem {
  if (err instanceof ApiError) {
    if (err.code === "TRIP_PRICE_CHANGED") {
      // 这一车型这次报不出、条件已对不上（机场停用等）：重新报价也可能报不出，另给转人工
      const reason = err.details["reason"];
      const manual = reason === "NO_OFFER" || reason === "CONDITIONS_CHANGED";
      return { kind: "requote", text: tripCopy(manual ? "book.priceChangedManual" : "book.priceChanged"), manual };
    }
    if (err.code === "TRIP_PLAN_EXPIRED") return { kind: "requote", text: tripCopy("expired"), manual: false };
    if (err.code === "TRIP_PLAN_NOT_FOUND") return { kind: "requote", text: tripCopy("book.planGone"), manual: false };
    if (err.code === "TRIP_PLAN_NOT_SINGLE_SEGMENT") return { kind: "manual", text: tripCopy("book.notSingle") };
  }
  // 太频繁、断网、行程单过期等：同报价的说法
  return { kind: "failed", text: `${tripCopy("book.failed")}：${tripFailureOf(err, "book").text}` };
}

interface PlanActionProps {
  trip: SiteTrip;
  plan: SiteTripPlan;
  labels: TripLabels | null;
  supportWhatsapp: string | null;
  onQuote(): void;
  quoting: boolean;
}

/** 单段方案「预订这个方案」：转成普通报价后带进 `/book/new` 第 3 步（乘客信息），之后走现有下单、付款 */
function PlanBooking({ trip, plan, bookable, labels, supportWhatsapp, onQuote, quoting }: PlanActionProps & { bookable: TripBookable }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<BookProblem | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // 重新报价拿到了新结果（行程单对象换了）：上次的说明收起
  useEffect(() => setProblem(null), [trip]);

  const book = async (): Promise<void> => {
    if (busy || quoting) return;
    setBusy(true);
    setProblem(null);
    try {
      const order = await createSiteTripOrderQuote(trip.trip_id, plan.plan_id, tripOrderQuoteBody(trip, bookable, labels));
      if (!alive.current) return;
      const handoff = tripBookHandoff(trip, bookable, labels, order);
      if (handoff === null) {
        setBusy(false);
        setProblem({ kind: "manual", text: tripCopy("book.notSingle") });
        return;
      }
      // 带着报价进 /book/new（路由 state，不进任何存储）；浏览器后退回到这里的方案对比
      void navigate({ pathname: SITE_NEW_BOOKING_PATH, search: TRIP_BOOK_SEARCH }, { state: { [TRIP_BOOK_STATE]: handoff } });
    } catch (err) {
      if (!alive.current) return;
      setBusy(false);
      setProblem(bookProblemOf(err));
    }
  };

  return (
    <div className="trip-plan__actions">
      {problem?.kind !== "manual" && (
        <div className="trip-plan__book">
          <Button variant="primary" size="lg" loading={busy} loadingText={tripCopy("book.busy")} onClick={() => void book()}>
            {tripCopy("book")}
          </Button>
          <p className="site-muted">{tripCopy("book.hint")}</p>
        </div>
      )}
      <div role="alert">{problem !== null && <Alert kind={problem.kind === "failed" ? "danger" : "warning"}>{problem.text}</Alert>}</div>
      {problem?.kind === "requote" && (
        <div className="trip-plan__book">
          <Button size="lg" loading={quoting} loadingText={tripCopy("quoting")} onClick={onQuote}>
            {tripCopy("requote")}
          </Button>
        </div>
      )}
      {problem?.kind === "requote" && problem.manual && <PlanManualBooking trip={trip} plan={plan} labels={labels} supportWhatsapp={supportWhatsapp} cta="manual.cta" />}
      {problem?.kind === "manual" && MULTI_SEGMENT_MANUAL_BOOKING && <PlanManualBooking trip={trip} plan={plan} labels={labels} supportWhatsapp={supportWhatsapp} />}
    </div>
  );
}

/** 卡片底部的下单出口：过期的不给（先重新报价）；单段给「预订这个方案」，其余按业主决定（推荐 A：提交预订，客服确认） */
function PlanActions(props: PlanActionProps) {
  const { trip, plan } = props;
  if (plan.expired) return null;
  const bookable = tripBookableSegment(trip, plan);
  if (bookable !== null) return <PlanBooking {...props} bookable={bookable} />;
  return MULTI_SEGMENT_MANUAL_BOOKING ? <PlanManualBooking trip={trip} plan={plan} labels={props.labels} supportWhatsapp={props.supportWhatsapp} /> : null;
}

function PlanCard({ plan, ...actions }: Omit<PlanActionProps, "plan"> & { plan: SiteTripPlan }) {
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
      <PlanActions plan={plan} {...actions} />
    </li>
  );
}

function ManualQuoteSection({ trip, supportWhatsapp, labels }: { trip: SiteTrip; supportWhatsapp: string | null; labels: TripLabels | null }) {
  const [open, setOpen] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // 点了「转人工报价」按钮就没了，焦点移到这块的标题，读屏接着读表单
  useEffect(() => {
    if (open) titleRef.current?.focus();
  }, [open]);
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

export function TripQuoteResult({ trip, onQuote, quoting, supportWhatsapp = null, labels = null }: TripQuoteResultProps) {
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
      {trip.manual_quote_suggested && <ManualQuoteSection trip={trip} supportWhatsapp={supportWhatsapp} labels={labels} />}
      {trip.plans.length > 0 && (
        <ul className={trip.plans.length > 1 ? "trip-plans trip-plans--compare" : "trip-plans"} aria-label={trip.plans.length > 1 ? tripCopy("compare") : tripCopy("resultSection")}>
          {trip.plans.map((plan) => (
            <PlanCard key={plan.plan_id} plan={plan} trip={trip} labels={labels} supportWhatsapp={supportWhatsapp} onQuote={onQuote} quoting={quoting} />
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
