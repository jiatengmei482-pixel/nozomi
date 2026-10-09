/**
 * 「价格日历」页签（docs/design/pages/tenant-prices.md 第 6 节）：选一个组合，看这个月每一天的结算价；只看不改。
 * 在月历上选一段日期可以直接去新建调价规则。每一天的数来自接口（后端按 @nozomi/domain 的 tripPrice 算），页面不重算。
 * 一套标记两种排法：≥ 768px 是七列的格子，更窄时每天一行（样式在 products.css）。
 */
import { PRICING_MODEL_NAMES, type TripDirection, priceDirectionNames } from "@nozomi/domain";
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { type CalendarDay, type PriceCalendar, getPriceCalendar } from "../../../api/prices.ts";
import { Alert } from "../../../components/Alert.tsx";
import { Button, IconButton, LinkButton } from "../../../components/Button.tsx";
import { Dialog } from "../../../components/Dialog.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { StateBlock } from "../../../components/States.tsx";
import { stepText } from "../../../lib/adjust-form.ts";
import { displayName, shortName } from "../../../lib/master-display.ts";
import { TREND_NAMES, addMonths, cellView, clampMonth, daysInRange, exactTextMoney, isWholeText, monthDates, monthOf, monthRange, monthTitle, monthWeeks, moveDay, orderedRange, sameDayIn, segmentAt, spokenDate, weekdayName } from "../../../lib/price-calendar.ts";
import { moneyText } from "../../../lib/product-display.ts";
import { pricePath } from "../../../lib/product-paths.ts";
import { tidyTime } from "../../../lib/time-input.ts";
import { useLoad } from "../../../lib/use-load.ts";
import type { PricesShared } from "./PricesStep.tsx";

/** 从日历去新建调价规则时带过去的内容（表单预先填好；保存或取消后回到日历）。 */
export interface CalendarHandoff {
  from: string;
  to: string;
  areaId: string;
  vehicleGroupId: string;
  direction: TripDirection | null;
  packageHours: number | null;
  /** 回日历的地址（原来的组合和月份） */
  back: string;
}

const isNarrow = (): boolean => typeof window.matchMedia === "function" && window.matchMedia("(max-width: 767px)").matches;

export function CalendarTab({ shared }: { shared: PricesShared }) {
  const { frame, product, prices, adjusts } = shared;
  const readOnly = frame.readOnly;
  const currency = prices.currency;
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const directionNames = priceDirectionNames(product.poi?.type ?? null);
  const airport = product.category === "airport_transfer";
  const charter = product.category === "charter";
  const areaIds = product.areas.map((area) => area.area_id);
  const groupIds = product.vehicle_groups.map((group) => group.vehicle_group_id);
  const packages = useMemo(() => [...new Set(prices.items.flatMap((item) => (item.package_hours === null ? [] : [item.package_hours])))].sort((x, y) => x - y), [prices.items]);

  // ───── 现在看的组合和月份（都写在网址里）─────
  const firstPriced = prices.items.find((item) => item.status === "enabled" && areaIds.includes(item.area_id) && groupIds.includes(item.vehicle_group_id)) ?? prices.items.find((item) => areaIds.includes(item.area_id) && groupIds.includes(item.vehicle_group_id));
  const wantedArea = params.get("area");
  const wantedGroup = params.get("vg");
  const unknown = (wantedArea !== null && !areaIds.includes(wantedArea)) || (wantedGroup !== null && !groupIds.includes(wantedGroup));
  const areaId = wantedArea !== null && !unknown ? wantedArea : (firstPriced?.area_id ?? areaIds[0] ?? "");
  const groupId = wantedGroup !== null && !unknown ? wantedGroup : (firstPriced?.vehicle_group_id ?? groupIds[0] ?? "");
  const direction: TripDirection | null = airport ? (params.get("dir") === "dropoff" ? "dropoff" : "pickup") : null;
  const wantedPackage = Number(params.get("pkg"));
  const packageHours = charter ? (packages.includes(wantedPackage) ? wantedPackage : (packages[0] ?? null)) : null;
  const time = tidyTime(params.get("time") ?? "") ?? "10:00";
  const month = clampMonth(params.get("month"), prices.today);
  const range = monthRange(prices.today);
  const [timeText, setTimeText] = useState(time);
  const [replaced, setReplaced] = useState(false);

  const change = (changes: Record<string, string | null>): void => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true, state: location.state });
  };
  // 网址里的组合已经不在这个商品里：换成默认的，并说明
  useEffect(() => {
    if (!unknown) return;
    setReplaced(true);
    const next = new URLSearchParams(params);
    next.delete("area");
    next.delete("vg");
    setParams(next, { replace: true });
  }, [unknown, params, setParams]);

  const areaName = (id: string): string => displayName(product.areas.find((area) => area.area_id === id)?.name).text;
  const groupName = (id: string): string => displayName(product.vehicle_groups.find((group) => group.vehicle_group_id === id)?.name).text;
  const variant = direction !== null ? directionNames[direction] : packageHours !== null ? `${packageHours} 小时` : null;
  const comboName = [areaName(areaId), groupName(groupId), variant].filter((part) => part !== null).join(" · ");
  const hasPrices = prices.items.length > 0;
  const canLoad = hasPrices && areaId !== "" && groupId !== "" && (!charter || packageHours !== null);
  const dates = useMemo(() => monthDates(month), [month]);
  const weeks = useMemo(() => monthWeeks(month), [month]);
  const loaded = useLoad<PriceCalendar>(
    `calendar:${product.id}:${areaId}:${groupId}:${direction}:${packageHours}:${month}:${frame.version}:${prices.rounding_unit}`,
    canLoad ? (token) => getPriceCalendar(token, product.id, { area_id: areaId, vehicle_group_id: groupId, ...(direction !== null ? { direction } : {}), ...(packageHours !== null ? { package_hours: packageHours } : {}), from: dates[0] as string, to: dates.at(-1) as string }) : null,
  );
  const data = loaded.state.data;
  // 换了月份或组合、新的还没到时，手上的还是上一份：只用日期对得上的
  const byDate = useMemo(() => new Map((data?.days ?? []).map((day) => [day.date, day])), [data]);
  const stale = loaded.state.status === "loading" && data !== null;
  const today = prices.today;

  // ───── 焦点、选中的一段、看哪一天的明细 ─────
  const returned = (location.state as { selected?: { from?: unknown; to?: unknown } } | null)?.selected;
  const initial = typeof returned?.from === "string" && typeof returned.to === "string" && monthOf(returned.from) === month ? { from: returned.from, to: monthOf(returned.to) === month ? returned.to : (dates.at(-1) as string) } : null;
  const [anchor, setAnchor] = useState<string | null>(initial?.from ?? null);
  const [end, setEnd] = useState<string | null>(initial?.to ?? null);
  const [picked, setPicked] = useState<string | null>(initial?.from ?? null);
  const [focusDay, setFocusDay] = useState<string>(initial?.from ?? (monthOf(today) === month ? today : (dates[0] as string)));
  const [spaceStart, setSpaceStart] = useState(false);
  const [picking, setPicking] = useState<"off" | "start" | "end">("off");
  const [sheet, setSheet] = useState(false);
  const dragFrom = useRef<string | null>(null);
  const dragged = useRef(false);
  const grid = useRef<HTMLDivElement>(null);
  const selection = anchor !== null && end !== null && monthOf(anchor) === month && monthOf(end) === month ? orderedRange(anchor, end) : null;
  const shownDate = picked !== null && monthOf(picked) === month ? picked : monthOf(today) === month ? today : (dates[0] as string);
  const shownDay = byDate.get(shownDate) ?? null;
  const slotted = (adjusts?.items ?? []).some((rule) => rule.time_slot !== null);

  useEffect(() => {
    const stop = (): void => {
      dragFrom.current = null;
    };
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, []);

  const clearSelection = (): void => {
    setAnchor(null);
    setEnd(null);
    setSpaceStart(false);
    if (picking !== "off") setPicking("start");
  };
  const goMonth = (next: string, keepFocus = false): void => {
    if (next < range.first || next > range.last) return;
    change({ month: next === monthOf(today) ? null : next });
    setAnchor(null);
    setEnd(null);
    setPicked(null);
    setSpaceStart(false);
    const target = sameDayIn(next, focusDay);
    setFocusDay(target);
    if (keepFocus) requestAnimationFrame(() => document.getElementById(`calendar-day-${target}`)?.focus());
  };
  const focusOn = (date: string): void => {
    setFocusDay(date);
    document.getElementById(`calendar-day-${date}`)?.focus();
  };

  const onDayClick = (date: string, shift: boolean): void => {
    setFocusDay(date);
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    if (picking === "start") {
      setAnchor(date);
      setEnd(date);
      return setPicking("end");
    }
    if (picking === "end") {
      setEnd(date);
      return setPicking("start");
    }
    if (shift && anchor !== null) return setEnd(date);
    setAnchor(date);
    setEnd(date);
    setPicked(date);
    setSpaceStart(false);
    if (isNarrow()) setSheet(true);
  };

  const onGridKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      return goMonth(addMonths(month, event.key === "PageUp" ? -1 : 1), true);
    }
    if (event.key === "Escape" && selection !== null) {
      event.preventDefault();
      return clearSelection();
    }
    if (event.key === "Enter") {
      event.preventDefault();
      setPicked(focusDay);
      if (isNarrow()) setSheet(true);
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      if (spaceStart && anchor !== null) {
        setEnd(focusDay);
        return setSpaceStart(false);
      }
      setAnchor(focusDay);
      setEnd(focusDay);
      return setSpaceStart(true);
    }
    const next = moveDay(focusDay, event.key);
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (next === null) return;
    if (event.shiftKey) {
      if (anchor === null) setAnchor(focusDay);
      setEnd(next);
    }
    focusOn(next);
  };

  const tabPath = pricePath(product.id, "calendar");
  const handoff: CalendarHandoff | null = selection === null ? null : { ...selection, areaId, vehicleGroupId: groupId, direction, packageHours, back: `${tabPath}${location.search}` };

  if (!hasPrices) {
    return (
      <section className="card">
        <StateBlock tone="neutral" title="还没有价格，日历上没有东西可看" description="先到「价格规则」页签把价格填上，这里就会显示每一天的结算价。" action={<LinkButton variant="primary" to={pricePath(product.id)}>{readOnly ? "去看价格" : "去填价格"}</LinkButton>} />
      </section>
    );
  }

  const select = (id: string, label: string, value: string, options: { value: string; label: string }[], onChange: (value: string) => void): ReactNode => (
    <label className="calendar-filters__item" htmlFor={id}>
      <span className="calendar-filters__label">{label}</span>
      <select className="input input--sm select" id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );

  const priceRuleOf = (day: CalendarDay) => prices.items.find((item) => item.id === day.price_rule?.id) ?? null;
  const mileage = (data?.days ?? []).some((day) => day.price_rule?.pricing_model === "mileage_time");
  const allEmpty = data !== null && !stale && data.days.length > 0 && data.days.every((day) => day.segments.every((segment) => segment.final === null && segment.no_price_reason !== "NOT_POSITIVE" && segment.no_price_reason !== "OVER_LIMIT"));
  const rulesLink = (hash = ""): string => `${pricePath(product.id)}${hash}`;

  const detail = (day: CalendarDay | null, headingId: string): ReactNode => {
    if (day === null) return <p className="calendar-detail__loading">{loaded.state.status === "error" ? "没有加载出来。" : "加载中…"}</p>;
    const segment = segmentAt(day, time);
    const unpriceable = segment?.no_price_reason === "NOT_POSITIVE" || segment?.no_price_reason === "OVER_LIMIT";
    const rule = priceRuleOf(day);
    const spans = prices.items.filter((item) => item.area_id === areaId && item.vehicle_group_id === groupId && item.package_hours === packageHours && (direction === null || item.direction === "both" || item.direction === direction)).map((item) => (item.valid_to === null ? `${item.valid_from} 起` : `${item.valid_from} 至 ${item.valid_to}`));
    return (
      <>
        <h4 className="calendar-detail__title" id={headingId}>
          <time dateTime={day.date}>{day.date}</time> {weekdayName(day.date)}
          {day.holiday && ` · ${displayName(day.holiday.name).text}`}
        </h4>
        {segment === null || segment.final === null ? (
          <>
            <p className="calendar-detail__final calendar-detail__final--none">{unpriceable ? "这一天算不出价" : "这一天没有价格"}</p>
            <p className="calendar-detail__combo">{`${time} 用车 · ${comboName}`}</p>
            {segment?.no_price_reason === "OVER_LIMIT" ? (
              <p>调价之后的结算价超过了上限，客人询价时报不出价。请检查价格或调价规则是不是多打了几个零。</p>
            ) : segment?.no_price_reason === "NOT_POSITIVE" ? (
              <p>调价规则把这一天的价调到了不大于 0，客人询价时报不出价。请把下调改小。</p>
            ) : segment?.no_price_reason === "RULE_DISABLED" ? (
              <p>这一天的价格现在是停用的。</p>
            ) : segment?.no_price_reason === "NOT_IN_EFFECT" ? (
              <p>{`这个组合的价格在这一天不生效${spans.length > 0 ? `：现有的价格是 ${spans.slice(0, 3).join("、")}${spans.length > 3 ? " 等" : ""}` : ""}。`}</p>
            ) : (
              <p>这个组合还没有价格，客人询价时报不出价。</p>
            )}
            <p className="calendar-detail__actions">
              {unpriceable ? (
                segment?.adjusts[0] && (
                  <Link className="link" to={pricePath(product.id, "adjust", `/${segment.adjusts[0].rule_id}`)}>
                    {readOnly ? "看这条规则" : "改这条规则"}
                  </Link>
                )
              ) : (
                <Link className="link" to={rulesLink(day.price_rule ? `#price-row-${day.price_rule.id}` : "")}>
                  {readOnly ? "去看价格" : segment?.no_price_reason === "RULE_DISABLED" ? "去启用" : segment?.no_price_reason === "NOT_IN_EFFECT" ? "去改生效日期" : "去填价格"}
                </Link>
              )}
            </p>
          </>
        ) : (
          <>
            <p className="calendar-detail__final">
              <span className="calendar-detail__final-label">结算价</span> {moneyText(segment.final, currency)}
              {day.price_rule?.pricing_model === "mileage_time" && " 起"}
            </p>
            <p className="calendar-detail__combo">{`${time} 用车 · ${comboName}`}</p>
            <dl className="calendar-detail__steps">
              <div className="calendar-detail__row">
                <dt>基础价</dt>
                <dd>{segment.base === null ? "—" : exactTextMoney(segment.base, currency)}</dd>
              </div>
              {day.price_rule && (
                <div className="calendar-detail__row calendar-detail__row--sub">
                  <dt>{`${PRICING_MODEL_NAMES[day.price_rule.pricing_model]} · ${day.price_rule.valid_to === null ? `${day.price_rule.valid_from} 起一直有效` : `${day.price_rule.valid_from} 至 ${day.price_rule.valid_to}`}`}</dt>
                  <dd>
                    {rule !== null && (
                      <Link className="link" to={rulesLink(`#price-row-${rule.id}`)}>
                        {readOnly ? "看这条价格" : "改这条价格"}
                      </Link>
                    )}
                  </dd>
                </div>
              )}
              {segment.adjusts.map((adjust, index) => (
                <div key={adjust.rule_id} className="calendar-detail__rule">
                  <div className="calendar-detail__row">
                    <dt>{`${index + 1}　${adjust.name}`}</dt>
                    <dd>
                      <Link className="link" to={pricePath(product.id, "adjust", `/${adjust.rule_id}`)} aria-label={`${readOnly ? "看这条规则" : "改这条规则"}：${adjust.name}`}>
                        {readOnly ? "看这条规则" : "改这条规则"}
                      </Link>
                    </dd>
                  </div>
                  {adjust.steps.map((step, at) => (
                    <div key={at} className="calendar-detail__row calendar-detail__row--sub">
                      <dt>{stepText(step, currency)}</dt>
                      <dd>
                        <span className="calendar-detail__delta">{exactTextMoney(step.delta, currency, true).replace(`${currency} `, "")}</span>
                        {exactTextMoney(step.after, currency)}
                        {!isWholeText(step.after) && <span className="adjust-trial__note">（还没取整）</span>}
                      </dd>
                    </div>
                  ))}
                </div>
              ))}
              <div className="calendar-detail__row calendar-detail__row--total">
                <dt>{prices.rounding_unit > 1 ? `取整到 ${moneyText(prices.rounding_unit, currency)}` : "四舍五入"}</dt>
                <dd>{moneyText(segment.final, currency)}</dd>
              </div>
            </dl>
          </>
        )}
        {day.segments.length > 1 && (
          <>
            <h5 className="calendar-detail__subtitle">这一天不同时段的价</h5>
            <ul className="calendar-detail__segments">
              {day.segments.map((entry) => (
                <li key={entry.from}>
                  {entry === segment && <span className="calendar-detail__now">现在看的</span>}
                  <span className="calendar-detail__span">{`${entry.from}–${entry.to}`}</span>
                  <span className="calendar-detail__amount">{entry.final === null ? "没有价格" : moneyText(entry.final, currency)}</span>
                  {entry.adjusts.length > 0 && <span className="calendar-detail__hit">{`命中${entry.adjusts.map((adjust) => `「${adjust.name}」`).join("")}`}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </>
    );
  };

  const cell = (date: string): ReactNode => {
    const day = byDate.get(date) ?? null;
    const view = day ? cellView(day, time) : null;
    const isToday = date === today;
    const inRange = selection !== null && date >= selection.from && date <= selection.to;
    const mark = selection === null ? null : selection.from === date && selection.to === date ? "起止" : selection.from === date ? "起" : selection.to === date ? "止" : null;
    const holiday = day?.holiday ? displayName(day.holiday.name).text : null;
    const from = day?.price_rule?.pricing_model === "mileage_time" ? " 起" : "";
    const spoken =
      view === null
        ? `${spokenDate(date)}，${loaded.state.status === "error" ? "没有加载出来" : "加载中"}`
        : `${spokenDate(date)}，${holiday ? `${holiday}，` : ""}${isToday ? "今天，" : ""}${
            view.kind === "price" ? `结算价 ${moneyText(view.final ?? 0, currency)}${from}${view.trend ? `，${TREND_NAMES[view.trend]}` : ""}${view.rules.length > 0 ? `，命中${view.rules[0]}${view.rules.length > 1 ? `等 ${view.rules.length} 条规则` : ""}` : ""}${view.split ? "，分时段" : ""}` : view.kind === "bad" ? "算不出价" : `没有价格${view.disabled ? "，已停用" : ""}`
          }${mark ? `，选中的${mark === "起止" ? "起止" : mark === "起" ? "起点" : "终点"}` : inRange ? "，已选" : ""}`;
    const classes = ["calendar__cell", inRange ? "calendar__cell--selected" : "", view && view.kind !== "price" ? "calendar__cell--none" : "", date < today ? "calendar__cell--past" : "", isToday ? "calendar__cell--today" : "", date === shownDate ? "calendar__cell--shown" : ""].filter((name) => name !== "").join(" ");
    return (
      <div
        key={date}
        role="gridcell"
        id={`calendar-day-${date}`}
        className={classes}
        tabIndex={date === focusDay ? 0 : -1}
        aria-selected={inRange}
        aria-current={isToday ? "date" : undefined}
        aria-label={spoken}
        data-date={date}
        onMouseDown={(event) => {
          dragged.current = false;
          dragFrom.current = event.shiftKey || picking !== "off" ? null : date;
        }}
        onMouseEnter={(event) => {
          if (dragFrom.current === null || event.buttons !== 1 || dragFrom.current === date) return;
          dragged.current = true;
          setAnchor(dragFrom.current);
          setEnd(date);
        }}
        onClick={(event) => onDayClick(date, event.shiftKey)}
        onFocus={() => setFocusDay(date)}
      >
        <span className="calendar__day" aria-hidden="true">
          <span className="calendar__num">{Number(date.slice(8))}</span>
          <span className="calendar__weekday">{weekdayName(date)}</span>
          {isToday && <span className="calendar__today">今天</span>}
          {mark && <span className="calendar__mark">{mark}</span>}
          {holiday && <span className="calendar__holiday">{holiday}</span>}
        </span>
        <span className="calendar__price" aria-hidden="true">
          {view === null ? (
            <span className="calendar__skeleton" />
          ) : view.kind === "price" ? (
            <>
              <span className="calendar__currency">{`${currency} `}</span>
              {moneyText(view.final ?? 0, currency).slice(currency.length).trim()}
              {from}
            </>
          ) : (
            <span className={view.kind === "bad" ? "calendar__flag calendar__flag--bad" : "calendar__flag"}>
              <Icon name={view.kind === "bad" ? "alert-circle" : "alert-triangle"} />
              {view.kind === "bad" ? "算不出价" : "没有价格"}
            </span>
          )}
        </span>
        <span className="calendar__rules" aria-hidden="true">
          {view?.disabled && "已停用"}
          {view && view.rules.length > 0 && (
            <>
              {view.kind === "price" && view.trend && <Icon name={view.trend === "up" ? "arrow-up" : view.trend === "down" ? "arrow-down" : "minus"} />}
              <span className="calendar__rule-name">{view.rules[0]}</span>
              {view.rules.length > 1 && <span className="calendar__more">{`+${view.rules.length - 1}`}</span>}
            </>
          )}
          {view?.split && <span className="tag calendar__split">分时段</span>}
        </span>
      </div>
    );
  };

  const weekTitle = (week: (string | null)[]): string => {
    const days = week.filter((date): date is string => date !== null);
    const first = days[0] as string;
    const last = days.at(-1) as string;
    return first === last ? `${Number(first.slice(5, 7))} 月 ${Number(first.slice(8))} 日` : `${Number(first.slice(5, 7))} 月 ${Number(first.slice(8))} 日 – ${Number(last.slice(8))} 日`;
  };

  return (
    <div className="calendar-tab">
      <div role="status" className="step__alerts">
        {replaced && <Alert kind="info">{`原来看的那个组合已经不在这个商品里了，现在显示的是「${comboName}」。`}</Alert>}
      </div>
      <div className="calendar-filters" role="group" aria-label="看哪个组合">
        {select("calendar-area", "区域", areaId, product.areas.map((area) => ({ value: area.area_id, label: shortName(displayName(area.name).text) })), (value) => change({ area: value, vg: groupId }))}
        {select("calendar-group", "车型组", groupId, product.vehicle_groups.map((group) => ({ value: group.vehicle_group_id, label: shortName(displayName(group.name).text) })), (value) => change({ vg: value, area: areaId }))}
        {airport && select("calendar-direction", "方向", direction ?? "pickup", [{ value: "pickup", label: directionNames.pickup }, { value: "dropoff", label: directionNames.dropoff }], (value) => change({ dir: value === "pickup" ? null : value }))}
        {charter && packages.length > 0 && select("calendar-package", "套餐", String(packageHours), packages.map((hours) => ({ value: String(hours), label: `${hours} 小时` })), (value) => change({ pkg: value }))}
        {slotted && (
          <label className="calendar-filters__item" htmlFor="calendar-time">
            <span className="calendar-filters__label">用车时间</span>
            <input
              className="input input--sm input--mono calendar-filters__time"
              id="calendar-time"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              aria-describedby="calendar-time-hint"
              value={timeText}
              onChange={(event) => setTimeText(event.target.value)}
              onBlur={() => {
                const tidy = tidyTime(timeText) ?? time;
                setTimeText(tidy);
                if (tidy !== time) change({ time: tidy === "10:00" ? null : tidy });
              }}
              onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
            />
          </label>
        )}
      </div>
      {slotted && (
        <p className="field__hint" id="calendar-time-hint">
          有的调价规则只在某个时段生效。这里填几点，日历就显示几点用车的价。
        </p>
      )}
      <div className="calendar-month">
        <IconButton icon="chevron-left" label="上个月" tooltipAlign="start" disabled={month <= range.first} onClick={() => goMonth(addMonths(month, -1))} />
        <h3 className="calendar-month__title" aria-live="polite">
          {monthTitle(month)}
        </h3>
        <IconButton icon="chevron-right" label="下个月" disabled={month >= range.last} onClick={() => goMonth(addMonths(month, 1))} />
        {month !== monthOf(today) && (
          <Button variant="text" size="sm" onClick={() => goMonth(monthOf(today))}>
            回到本月
          </Button>
        )}
        <Button
          size="sm"
          className="calendar-month__pick"
          aria-pressed={picking !== "off"}
          onClick={() => {
            setPicking(picking === "off" ? "start" : "off");
            setAnchor(null);
            setEnd(null);
          }}
        >
          选一段日期
        </Button>
        {!readOnly && <span className="calendar-month__tip">拖动或用键盘选一段日期，可以直接新建调价规则</span>}
      </div>
      {picking !== "off" && <p className="calendar-month__picking">{picking === "start" ? "点开始的那一天" : "再点结束的那一天"}</p>}
      {allEmpty && (
        <Alert kind="warning">
          <strong className="alert__title">{`「${comboName}」这个月没有价格。`}</strong>
          <span className="alert__actions">
            <Link className="link" to={rulesLink()}>
              {readOnly ? "去看价格" : "去填价格"}
            </Link>
          </span>
        </Alert>
      )}
      <div className="calendar-bar" role="status">
        {selection !== null && (
          <>
            <span className="calendar-bar__text">
              已选 <strong>{selection.from === selection.to ? selection.from : `${selection.from} 至 ${selection.to}`}</strong>，共 {daysInRange(selection.from, selection.to)} 天
            </span>
            {!readOnly && handoff !== null && (
              <LinkButton variant="primary" size="sm" to={pricePath(product.id, "adjust", "/new")} state={{ calendar: handoff }}>
                新建调价规则
              </LinkButton>
            )}
            <Button variant="text" size="sm" onClick={clearSelection}>
              取消选择
            </Button>
          </>
        )}
      </div>
      {loaded.state.status === "error" && data === null ? (
        <section className="card">
          <StateBlock
            title="加载失败"
            description="请检查网络后重试。"
            action={
              <Button variant="secondary" onClick={loaded.reload}>
                重试
              </Button>
            }
          />
        </section>
      ) : (
        <div className="calendar-layout">
          <div className={stale ? "calendar calendar--stale" : "calendar"} role="grid" aria-label={`${monthTitle(month)}每一天的结算价`} aria-busy={loaded.state.status === "loading"} ref={grid} onKeyDown={onGridKey}>
            <div role="row" className="calendar__head">
              {["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map((name) => (
                <span key={name} role="columnheader" className="calendar__head-cell">
                  {name}
                </span>
              ))}
            </div>
            {weeks.map((week, index) => (
              <div key={index} role="row" className="calendar__week">
                <span className="calendar__week-title" aria-hidden="true">
                  {weekTitle(week)}
                </span>
                {week.map((date, at) => (date === null ? <span key={`blank-${at}`} role="gridcell" className="calendar__blank" /> : cell(date)))}
              </div>
            ))}
          </div>
          <section className="card calendar-detail" aria-labelledby="calendar-detail-title" aria-live="polite">
            {detail(shownDay, "calendar-detail-title")}
          </section>
        </div>
      )}
      {mileage && <p className="calendar-note">这个组合按里程和时长计价，日历上是不超出起步里程和起步时长时的价（起步价或最低消费）调完以后的数。按客人实际路线报价要等路线预估功能上线。</p>}
      <p className="calendar-note">{`日历上是按价格规则和调价规则算出来的结算价，不含加急费、夜间加价和附加服务。日期是${product.city ? displayName(product.city.name).text : ""}当地的用车日期。`}</p>
      <Dialog open={sheet} title={`${shownDate} 的价`} onClose={() => setSheet(false)} footer={<Button onClick={() => setSheet(false)}>关闭</Button>}>
        <div className="calendar-detail calendar-detail--sheet">{sheet && detail(shownDay, "calendar-sheet-title")}</div>
      </Dialog>
    </div>
  );
}
