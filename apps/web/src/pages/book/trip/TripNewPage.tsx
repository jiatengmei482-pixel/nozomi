/**
 * 多日行程报价页 `/book/trip`（M9T-09 第一部分，ADR 0101 第十三节）。验收通过前不在官网任何地方放入口，只能直接打开地址。
 *
 * 两步，每一步有自己的网址：
 * 1. 填写行程（`/book/trip`）：乘客 / 行李，按天的编辑块（`TripDayEditor`：第 1 天的日期、上车时间、上车地点、按顺序的中间地点和停留、最后下车地点、
 *    不用车的日子、司机住宿），可增删天（最多 14 天）、增删地点（每天最多 12 个点）。点「查看报价」先在页面上检查，问题写在各自的字段下面；
 *    没问题就建行程单（`POST /site/v1/trips`），地名按行程单编号暂存在本标签页（`trip-labels-store.ts`，行程单里只有坐标），再报价（`POST …/quote`）。
 * 2. 报价结果（`?trip=<编号>&step=2`）：报价时显示骨架；刷新或从别处打开这个网址时读行程单（`GET /site/v1/trips/{id}`，最近一次报价的结果），不重新报价。
 *    结果是方案对比卡片和转人工报价（`TripQuoteResult`，第二部分）。
 *    太复杂（422 `TRIP_TOO_COMPLEX`）写「需要客服人工报价」；太频繁（429）写等多久；行程单过期（404）只能回去重新填。
 *    报价没拿到应答（断网、超时、网关 502/503/504）时服务端可能已经报完：先读一次行程单，已报过价就直接显示，不再报价（报价限流每分钟 5 次、每天 50 次）；
 *    还没报过才给「重试」。第 2 步的变化（报价中 → 结果 / 出错）由常驻的播报区告诉读屏。
 * 布局同 `/book`：电脑（≥ 1024px）两栏，右侧栏是每天一张带编号的路线图；手机、平板（≤ 1023px）单栏，路线图在每天的块里，
 * 每一步的按钮在底部按钮条（`StepActionBar`，ADR 0100）。测试环境的验收会话（QA 验收通道）照常生效：官网接口自动带验收 Cookie，建的是验收行程单、只报 QA 测试供应商。
 * 页面上没有供应商、结算价、加价比例。文案都在 `lib/trip-texts.ts`。
 * 第 1 步表单上方是「一句话描述您的行程」（`TripAiInput`，M9T-33，ADR 0104）：AI 整理的结果整份替换表单，顶部写摘要（请补填 / 请确认 / 没有用上 / 不在报价范围），
 * 之后照常点「查看报价」，页面检查照旧；AI 不可用时整块不显示。
 */
import type { CityCandidate } from "@nozomi/domain";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { ApiError, NetworkError } from "../../../api/client.ts";
import { type SiteCity, type SiteTrip, createSiteTrip, getSiteTrip, listSiteCities, quoteSiteTrip } from "../../../api/site.ts";
import { AlertSlot, type Notice } from "../../../components/Alert.tsx";
import { Button } from "../../../components/Button.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { Skeleton, StateBlock } from "../../../components/States.tsx";
import { defaultMapCity } from "../../../lib/book-new.ts";
import { defaultServiceDate } from "../../../lib/site-display.ts";
import {
  MAX_TRIP_DAYS,
  type TripFailure,
  type TripFormDraft,
  type TripStep,
  addTripDay,
  chosenPoints,
  hasTripErrors,
  initialTripDraft,
  removeTripDay,
  tripDayDate,
  tripDraftOf,
  tripFailureOf,
  tripIdOf,
  tripParamMalformed,
  tripItineraryOf,
  tripLabelsOf,
  tripPlaceName,
  tripSearch,
  tripStepOf,
  validateTripDraft,
} from "../../../lib/trip-form.ts";
import { type TripAiMarks, type TripAiSummary, tripDraftBlank } from "../../../lib/trip-ai.ts";
import { loadTripLabels, saveTripLabels } from "../../../lib/trip-labels-store.ts";
import { tripFormManualQuoteDraft } from "../../../lib/trip-manual.ts";
import { tripCopy } from "../../../lib/trip-texts.ts";
import { useDocumentTitle } from "../../../lib/use-document-title.ts";
import { ManualQuoteBlock } from "../ManualQuote.tsx";
import { SiteLayout, siteFailureText, useSiteConfig } from "../SiteLayout.tsx";
import { StepActionBar, useCompactScreen, useViewportFitCover } from "../new/StepActionBar.tsx";
import { TravellersField } from "../new/TravellersField.tsx";
import { type TripAiFilled, TripAiInput } from "./TripAiInput.tsx";
import { TripAiSummaryBlock } from "./TripAiSummaryBlock.tsx";
import { TripAiCell } from "./TripAiMark.tsx";
import { TripDayEditor } from "./TripDayEditor.tsx";
import { type TripMapPoint, TripDayMap } from "./TripDayMap.tsx";
import { TripQuoteResult } from "./TripQuoteResult.tsx";

type Load<T> = { kind: "loading" } | { kind: "failed"; message: string } | { kind: "ready"; items: T };

/** 第 2 步的行程单：正在报价 / 正在读、读到了（可能正在重新报价）、出错 */
type TripView =
  | { kind: "idle" }
  | { kind: "loading"; tripId: string; action: "quote" | "read" }
  | { kind: "ready"; tripId: string; trip: SiteTrip; quoting: boolean }
  | { kind: "failed"; tripId: string; action: "quote" | "read"; failure: TripFailure; trip?: SiteTrip };

/** 报价没拿到应答：服务端可能已经报完了（断网、超时、网关超时） */
const mayHaveQuoted = (err: unknown): boolean => err instanceof NetworkError || (err instanceof ApiError && (err.status === 502 || err.status === 503 || err.status === 504));
const wasQuoted = (trip: SiteTrip): boolean => trip.status === "quoted" || trip.quoted_at !== null || trip.plans.length > 0 || trip.unquoted.length > 0;

/** 第 2 步状态变化时给读屏的一句话（报价中由骨架自己播报） */
function resultAnnouncement(view: TripView): string {
  if (view.kind === "failed") return view.failure.manual ? tripCopy("manual.title") : `${tripCopy(view.action === "quote" ? "failure.quote" : "failure.read")}：${view.failure.text}`;
  if (view.kind !== "ready" || view.quoting) return "";
  const { trip } = view;
  if (trip.plans.length > 0) return tripCopy("announce.plans", { n: trip.plans.length });
  if (trip.manual_quote_suggested) return tripCopy("manual.title");
  // 还没报过价：结果区自己的提示（role="status"）会播报，这里不重复
  if (!wasQuoted(trip)) return "";
  return tripCopy("announce.none");
}

const STEPS: readonly { step: TripStep; name: string }[] = [
  { step: 1, name: tripCopy("step1") },
  { step: 2, name: tripCopy("step2") },
];

/** 行程单里每天的点 → 地图上的点（名称取存的地名，没有时写坐标） */
function itineraryMapDays(trip: SiteTrip): { dayNumber: number; points: TripMapPoint[] }[] {
  const labels = loadTripLabels(trip.trip_id);
  return trip.itinerary.days.map((day, d) => ({
    dayNumber: d + 1,
    points: day.items.flatMap((item, i) => ("placeId" in item.place ? [] : [{ name: tripPlaceName(trip.itinerary, labels, d, i), lat: item.place.lat, lng: item.place.lng }])),
  }));
}

export function TripNewPage() {
  useDocumentTitle(tripCopy("documentTitle"));
  const location = useLocation();
  const navigate = useNavigate();
  // 手机和平板（≤ 1023px）单栏、底部按钮条；电脑两栏
  const compact = useCompactScreen();
  const wide = !compact;
  useViewportFitCover(compact);
  const { state: config, reload: reloadConfig } = useSiteConfig();
  const [cities, setCities] = useState<Load<SiteCity[]>>({ kind: "loading" });
  const [round, setRound] = useState(0);
  const [draft, setDraft] = useState<TripFormDraft>(initialTripDraft);
  /** 最新的表单（AI 整理结果回来时判断表单是不是还空着） */
  const draftRef = useRef(draft);
  draftRef.current = draft;
  /** 客人动过表单（日期由页面自动填的不算）：之后不再自动改日期，回到第 1 步时也不用读回来的行程单覆盖 */
  const touched = useRef(false);
  /** 点过「查看报价」：之后每改一处都重新检查，问题随改随消失 */
  const [checked, setChecked] = useState(false);
  // 网址里的行程单编号格式不对时，第 1 步顶部说明一句（不再静默回到空表单）
  const [notice, setNotice] = useState<Notice | null>(() => (tripParamMalformed(location.search) ? { kind: "info", text: tripCopy("failure.notFound") } : null));
  const [creating, setCreating] = useState(false);
  /** AI 整理后表单顶部的摘要（再用 AI 整理一次时换掉） */
  const [aiSummary, setAiSummary] = useState<{ headline: string; summary: TripAiSummary; round: number } | null>(null);
  const aiSummaryRef = useRef<HTMLDivElement>(null);
  /** AI 整理后表单格子上的标记（AI 填的 / 请补填 / 候选 / 没找到）；客人改了哪一格就去掉哪一格的 */
  const [aiMarks, setAiMarks] = useState<TripAiMarks | null>(null);
  const touchAi = useCallback((cell: string): void => {
    setAiMarks((current) => {
      if (current === null) return current;
      const without = <T,>(record: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(record).filter(([key]) => key !== cell));
      return { filled: current.filled.filter((entry) => entry !== cell), missing: current.missing.filter((entry) => entry !== cell), candidates: without(current.candidates), notFound: without(current.notFound), vague: current.vague.filter((entry) => entry !== cell) };
    });
  }, []);
  /** 摘要里「不在报价范围」下面的转人工报价块展开了 */
  const [aiManual, setAiManual] = useState(false);
  const [view, setView] = useState<TripView>({ kind: "idle" });
  const viewRef = useRef(view);
  viewRef.current = view;
  const alive = useRef(true);
  const formHeading = useRef<HTMLHeadingElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const addDayButton = useRef<HTMLButtonElement>(null);
  /** 刚用当前表单建好的行程单：报价时右侧栏先画表单里每天的路线（表单再改就作废） */
  const draftTrip = useRef<string | null>(null);
  const step = tripStepOf(location.search);
  const urlTrip = tripIdOf(location.search);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const open = config.kind === "ready" && config.config.open;
  useEffect(() => {
    if (!open) return;
    let current = true;
    setCities({ kind: "loading" });
    listSiteCities().then(
      ({ items }) => current && setCities({ kind: "ready", items }),
      (err: unknown) => current && setCities({ kind: "failed", message: siteFailureText(err, tripCopy("action.cities")) }),
    );
    return () => {
      current = false;
    };
  }, [open, round]);

  const cityList = useMemo(() => (cities.kind === "ready" ? cities.items : []), [cities]);
  const mapCity = defaultMapCity(cityList, "charter");

  // 默认日期：可订包车的城市当地的明天（客人动过表单以后不再改）
  useEffect(() => {
    if (mapCity === null || touched.current) return;
    const date = defaultServiceDate(mapCity.timezone, new Date());
    setDraft((current) => (current.date === "" ? { ...current, date } : current));
  }, [mapCity]);

  const goStep = useCallback(
    (next: TripStep, tripId: string | null, replace = false): void => {
      void navigate({ pathname: location.pathname, search: tripSearch(tripId, next) }, { replace });
    },
    [location.pathname, navigate],
  );

  // 换步后焦点移到这一步的标题（第一次打开不移）
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    const target = (step === 1 ? formHeading : resultHeading).current;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ block: "start" });
  }, [step]);

  const runQuote = useCallback((tripId: string, known?: SiteTrip): void => {
    const show = (next: TripView): void => {
      if (alive.current) setView((current) => (current.kind !== "idle" && current.tripId === tripId ? next : current));
    };
    const fail = (err: unknown, trip: SiteTrip | undefined): void => show({ kind: "failed", tripId, action: "quote", failure: tripFailureOf(err, "quote"), ...(trip !== undefined ? { trip } : {}) });
    quoteSiteTrip(tripId).then(
      (trip) => show({ kind: "ready", tripId, trip, quoting: false }),
      (err: unknown) => {
        if (!mayHaveQuoted(err)) {
          fail(err, known);
          return;
        }
        // 没拿到应答：服务端可能已经报完。先读一次，报过了就直接显示，不再占报价次数；还没报过才给「重试」
        getSiteTrip(tripId).then(
          (trip) => (wasQuoted(trip) ? show({ kind: "ready", tripId, trip, quoting: false }) : fail(err, trip)),
          () => fail(err, known),
        );
      },
    );
  }, []);

  const readTrip = useCallback((tripId: string): void => {
    const loading: TripView = { kind: "loading", tripId, action: "read" };
    // 先记到 ref 上：开发模式（StrictMode）下副作用连跑两次时不读两遍
    viewRef.current = loading;
    setView(loading);
    getSiteTrip(tripId).then(
      (trip) => {
        if (alive.current) setView((current) => (current.kind !== "idle" && current.tripId === tripId ? { kind: "ready", tripId, trip, quoting: false } : current));
      },
      (err: unknown) => {
        if (alive.current) setView((current) => (current.kind !== "idle" && current.tripId === tripId ? { kind: "failed", tripId, action: "read", failure: tripFailureOf(err, "read") } : current));
      },
    );
  }, []);

  // 第 2 步：网址里的行程单还没在页面上（刷新、前进后退、别处打开）时读一次；刚建好、正在报价的不读
  useEffect(() => {
    if (step !== 2) return;
    if (urlTrip === null) {
      goStep(1, null, true);
      return;
    }
    const current = viewRef.current;
    if (current.kind !== "idle" && current.tripId === urlTrip) return;
    readTrip(urlTrip);
  }, [step, urlTrip, goStep, readTrip]);

  const quoteAgain = (tripId: string): void => {
    const current = viewRef.current;
    const known = current.kind !== "idle" && current.kind !== "loading" && current.tripId === tripId ? current.trip : undefined;
    setView(current.kind === "ready" && current.tripId === tripId ? { ...current, quoting: true } : { kind: "loading", tripId, action: "quote" });
    runQuote(tripId, known);
  };

  const errors = checked ? validateTripDraft(draft) : null;

  const change = (next: TripFormDraft): void => {
    touched.current = true;
    draftTrip.current = null;
    setDraft(next);
  };

  /** AI 整理好了：表单整份替换（之前的检查结果作废，点「查看报价」时再检查），焦点移到摘要 */
  const fillFromAi = (fill: TripAiFilled): void => {
    touched.current = true;
    draftTrip.current = null;
    setDraft(fill.draft);
    setChecked(false);
    setNotice(null);
    setAiSummary({ headline: fill.headline, summary: fill.summary, round: (aiSummary?.round ?? 0) + 1 });
    setAiMarks(fill.marks);
  };

  // 摘要框画出来以后再移焦点（不用 requestAnimationFrame：那时摘要框可能还没渲染出来）
  const aiRound = aiSummary?.round ?? 0;
  useEffect(() => {
    if (aiRound === 0) return;
    aiSummaryRef.current?.focus({ preventScroll: true });
    aiSummaryRef.current?.scrollIntoView?.({ block: "start" });
  }, [aiRound]);

  const focusFirstProblem = (): void => {
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.trip-new [aria-invalid="true"]')?.focus());
  };

  const submit = async (): Promise<void> => {
    if (creating) return;
    const found = validateTripDraft(draft);
    setChecked(true);
    if (hasTripErrors(found)) {
      setNotice({ kind: "danger", text: found.general ?? tripCopy("error.summary") });
      focusFirstProblem();
      return;
    }
    setNotice(null);
    setCreating(true);
    let tripId: string;
    try {
      tripId = (await createSiteTrip(tripItineraryOf(draft))).trip_id;
    } catch (err) {
      if (!alive.current) return;
      setCreating(false);
      setNotice({ kind: "danger", text: tripFailureOf(err, "create").text });
      return;
    }
    if (!alive.current) return;
    setCreating(false);
    saveTripLabels(tripId, tripLabelsOf(draft));
    draftTrip.current = tripId;
    // 先记下「这个行程单正在报价」再换网址：第 2 步的读取看到它就不再 GET
    setView({ kind: "loading", tripId, action: "quote" });
    goStep(2, tripId);
    runQuote(tripId);
  };

  /** 回到第 1 步：表单还是空的（刷新到第 2 步）时用读回来的行程单填上（重新报价失败时用失败前读到的那份） */
  const backToForm = (): void => {
    const current = viewRef.current;
    const known = current.kind === "ready" || current.kind === "failed" ? current : null;
    if (!touched.current && known?.trip !== undefined) {
      setDraft(tripDraftOf(known.trip.itinerary, loadTripLabels(known.tripId)));
      touched.current = true;
    }
    goStep(1, null);
  };

  const addDay = (): void => {
    const next = addTripDay(draft);
    if (next === draft) return;
    change(next);
    const added = next.days[next.days.length - 1];
    if (added !== undefined) requestAnimationFrame(() => document.getElementById(`trip-day-${added.key}-title`)?.focus());
  };

  const removeDay = (key: string, n: number): void => {
    change(removeTripDay(draft, key));
    setNotice({ kind: "info", text: tripCopy("dayRemoved", { n }) });
    requestAnimationFrame(() => addDayButton.current?.focus());
  };

  let body;
  if (config.kind === "loading" || (open && cities.kind === "loading")) {
    body = <Skeleton lines={["long", "control", "control", "control", "control"]} label={tripCopy("loadingPage")} />;
  } else if (config.kind === "failed") {
    body = <StateBlock title={tripCopy("pageFailed")} description={config.message} action={<Button size="lg" onClick={reloadConfig}>{tripCopy("retry")}</Button>} />;
  } else if (!config.config.open) {
    body = <StateBlock tone="neutral" title={tripCopy("notOpenTitle")} description={tripCopy("notOpenText")} />;
  } else if (cities.kind === "failed") {
    body = <StateBlock title={tripCopy("citiesFailed")} description={cities.message} action={<Button size="lg" onClick={() => setRound((value) => value + 1)}>{tripCopy("retry")}</Button>} />;
  } else if (cityList.length === 0) {
    body = <StateBlock tone="neutral" title={tripCopy("noCitiesTitle")} description={tripCopy("noCitiesText")} />;
  } else {
    const tiles = config.config.map_tiles;
    const centers: CityCandidate[] = cityList.map((city) => ({ id: city.id, center: city.center }));
    const fallbackCenter = mapCity?.center ?? null;
    const fullDays = draft.days.length >= MAX_TRIP_DAYS;

    const stepper = (
      <ol className="book-steps trip-steps" aria-label={tripCopy("stepsLabel")}>
        {STEPS.map(({ step: number, name }) => {
          const label = (
            <>
              <span className="book-steps__number" aria-hidden="true">
                {number < step ? <Icon name="check" /> : number}
              </span>
              <span className="book-steps__name">{name}</span>
            </>
          );
          return (
            <li key={number} className={number === step ? "book-steps__item book-steps__item--current" : number < step ? "book-steps__item book-steps__item--done" : "book-steps__item"} aria-current={number === step ? "step" : undefined}>
              {number < step ? (
                <button type="button" className="book-steps__link" aria-label={tripCopy("stepDone", { n: number, name })} onClick={backToForm}>
                  {label}
                </button>
              ) : (
                <span className="book-steps__link" aria-label={tripCopy(number === step ? "stepCurrent" : "stepTodo", { n: number, name })}>
                  {label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    );

    const formStep = (
      <>
        <TripAiInput isBlank={() => tripDraftBlank(draftRef.current)} onFill={fillFromAi} />
        <section aria-labelledby="trip-form-title" className="site-section trip-new__party">
          <h2 id="trip-form-title" ref={formHeading} tabIndex={-1} className="site-section__title">
            {tripCopy("tripSection")}
          </h2>
          {aiSummary !== null && (
            <TripAiSummaryBlock
              ref={aiSummaryRef}
              headline={aiSummary.headline}
              summary={aiSummary.summary}
              manual={
                <>
                  <Button aria-expanded={aiManual} onClick={() => setAiManual((open) => !open)}>
                    {tripCopy("manual.cta")}
                  </Button>
                  {/* 常驻挂载、用 hidden 收起：收起再展开时客人填的联系方式还在（卸掉正在用的输入在组件测试里还会卡死，见 #348） */}
                  <div hidden={!aiManual}>
                    <ManualQuoteBlock trip={tripFormManualQuoteDraft(draft)} supportWhatsapp={config.config.support_whatsapp} headingLevel="h4" />
                  </div>
                </>
              }
            />
          )}
          <AlertSlot notice={notice} />
          <TripAiCell state={aiMarks === null ? null : aiMarks.missing.includes("passengers") || aiMarks.missing.includes("luggage") ? "missing" : aiMarks.filled.includes("passengers") ? "filled" : null}>
            <TravellersField
              passengers={draft.passengers}
              luggage={draft.luggage}
              onChange={(value) => {
                touchAi("passengers");
                touchAi("luggage");
                change({ ...draft, ...value });
              }}
            />
          </TripAiCell>
        </section>
        {draft.days.map((day, index) => (
          <TripDayEditor
            key={day.key}
            day={day}
            index={index}
            count={draft.days.length}
            date={index === 0 ? draft.date : tripDayDate(draft, index)}
            onDate={(date) => change({ ...draft, date })}
            dateError={errors?.date}
            errors={errors?.days[day.key]}
            onChange={(next) => change({ ...draft, days: draft.days.map((entry) => (entry.key === day.key ? next : entry)) })}
            onRemove={() => removeDay(day.key, index + 1)}
            tiles={tiles}
            fallbackCenter={fallbackCenter}
            cities={centers}
            inlineMap={!wide}
            ai={aiMarks === null ? undefined : { marks: aiMarks, touch: touchAi }}
          />
        ))}
        <div className="trip-new__add-day">
          <Button ref={addDayButton} disabled={fullDays} onClick={addDay}>
            <Icon name="plus" />
            {tripCopy("addDay")}
          </Button>
          {fullDays && <p className="site-muted">{tripCopy("maxDays", { max: MAX_TRIP_DAYS })}</p>}
        </div>
        <StepActionBar
          compact={compact}
          primary={
            <Button variant="primary" size="lg" block={!wide} loading={creating} loadingText={tripCopy("creating")} onClick={() => void submit()}>
              {tripCopy("quote")}
            </Button>
          }
        />
      </>
    );

    const resultTrip = (view.kind === "ready" || view.kind === "failed") && view.tripId === urlTrip ? (view.trip ?? null) : null;
    const draftMapDays = draft.days.map((day, index) => ({ dayNumber: index + 1, points: chosenPoints(day) }));
    const mapDays: { dayNumber: number; points: TripMapPoint[] }[] =
      step === 1 ? draftMapDays : resultTrip !== null ? itineraryMapDays(resultTrip) : urlTrip !== null && urlTrip === draftTrip.current ? draftMapDays : [];
    const shownMaps = mapDays.filter((day) => day.points.length >= 2);

    let result;
    if (view.kind === "idle" || view.tripId !== urlTrip || view.kind === "loading") {
      result = <Skeleton lines={["long", "medium", "control", "control"]} label={view.kind === "loading" && view.action === "read" ? tripCopy("loadingPage") : tripCopy("quoting")} />;
    } else if (view.kind === "failed") {
      const { failure } = view;
      const retry = view.action === "quote" ? () => quoteAgain(view.tripId) : () => readTrip(view.tripId);
      result = failure.manual ? (
        <StateBlock headingLevel="h3" tone="neutral" title={tripCopy("manual.title")} description={`${failure.text}${tripCopy("manual.hint")}`} />
      ) : (
        <StateBlock
          headingLevel="h3"
          title={tripCopy(view.action === "quote" ? "failure.quote" : "failure.read")}
          description={failure.text}
          action={failure.gone ? <Button size="lg" onClick={() => goStep(1, null)}>{tripCopy("editTrip")}</Button> : <Button size="lg" onClick={retry}>{tripCopy("retry")}</Button>}
        />
      );
    } else {
      result = <TripQuoteResult trip={view.trip} quoting={view.quoting} onQuote={() => quoteAgain(view.tripId)} supportWhatsapp={config.config.support_whatsapp} labels={loadTripLabels(view.tripId)} onEditTrip={() => goStep(1, null)} />;
    }

    const resultStep = (
      <section aria-labelledby="trip-result-title" className="site-section trip-new__result">
        <h2 id="trip-result-title" ref={resultHeading} tabIndex={-1} className="site-section__title">
          {tripCopy("resultSection")}
        </h2>
        {/* 播报区常驻（不随结果区的骨架屏卸掉）：报价中 → 结果 / 出错时读屏读得到 */}
        <p className="visually-hidden" role="status" aria-live="polite">
          {view.kind !== "idle" && view.tripId === urlTrip ? resultAnnouncement(view) : ""}
        </p>
        {result}
        {!wide && shownMaps.length > 0 && (
          <section className="trip-new__day-maps" aria-labelledby="trip-day-maps-title">
            <h3 id="trip-day-maps-title" className="book-new__subtitle">
              {tripCopy("dayList")}
            </h3>
            {shownMaps.map((day) => (
              <TripDayMap key={day.dayNumber} dayNumber={day.dayNumber} points={day.points} headingLevel="h4" />
            ))}
          </section>
        )}
        <StepActionBar
          compact={compact}
          back={
            <Button size="lg" onClick={backToForm}>
              {tripCopy("back")}
            </Button>
          }
        />
      </section>
    );

    body = (
      <div className="book-new trip-new">
        <div className="book-new__main">
          {stepper}
          {step === 1 ? formStep : resultStep}
        </div>
        {wide && (
          <aside className="book-new__aside" aria-labelledby="trip-map-title">
            <section className="site-section trip-new__maps">
              <h2 id="trip-map-title" className="site-section__title">
                {tripCopy("mapAside")}
              </h2>
              {shownMaps.length === 0 ? <p className="site-muted">{tripCopy("mapEmpty")}</p> : shownMaps.map((day) => <TripDayMap key={day.dayNumber} dayNumber={day.dayNumber} points={day.points} />)}
            </section>
          </aside>
        )}
      </div>
    );
  }

  return (
    <SiteLayout>
      <h1 className="site__title">{tripCopy("title")}</h1>
      <p className="site-muted">{tripCopy("intro")}</p>
      {body}
    </SiteLayout>
  );
}
