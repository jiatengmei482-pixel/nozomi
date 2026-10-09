/**
 * 月历与日期范围选择（docs/design/02-components.md 第 32 节）：一周从周一开始，只画这个月的日子。
 * 一套标记两种排法：≥ 768px 是七列的格子，更窄时按周分组、一天一行（样式是 products.css 里的 .calendar）。
 * 选一段日期：点一天再按住 Shift 点另一天、拖动、Shift + 方向键、起点终点各按一次空格；窄屏用「选一段日期」模式点两下。
 * 每一格显示什么由使用它的页面给（库存日历、以后别的按天看的页面）。
 */
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { monthOf, monthWeeks, moveDay, orderedRange, spokenDate, weekdayName } from "../lib/price-calendar.ts";

export interface DaySelection {
  /** 选中的一段（两头都算）；没有选是 null */
  range: { from: string; to: string } | null;
  /** 明细面板看的那一天；没有点过是 null */
  picked: string | null;
  focusDay: string;
  /** 窄屏的「选一段日期」模式 */
  picking: "off" | "start" | "end";
  select(from: string, to: string): void;
  clear(): void;
  pick(date: string | null): void;
  setFocusDay(date: string): void;
  togglePicking(): void;
  /** 月历内部用 */
  anchor: string | null;
  spaceStart: boolean;
  setAnchor(date: string | null): void;
  setEnd(date: string | null): void;
  setSpaceStart(value: boolean): void;
  setPicking(value: "off" | "start" | "end"): void;
}

export function useDaySelection(initialFocus: string): DaySelection {
  const [anchor, setAnchor] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [focusDay, setFocusDay] = useState(initialFocus);
  const [spaceStart, setSpaceStart] = useState(false);
  const [picking, setPicking] = useState<"off" | "start" | "end">("off");
  const clear = (): void => {
    setAnchor(null);
    setEnd(null);
    setSpaceStart(false);
    if (picking !== "off") setPicking("start");
  };
  return {
    range: anchor !== null && end !== null ? orderedRange(anchor, end) : null,
    picked,
    focusDay,
    picking,
    select: (from, to) => {
      setAnchor(from);
      setEnd(to);
      setSpaceStart(false);
    },
    clear,
    pick: setPicked,
    setFocusDay,
    togglePicking: () => {
      setPicking(picking === "off" ? "start" : "off");
      setAnchor(null);
      setEnd(null);
    },
    anchor,
    spaceStart,
    setAnchor,
    setEnd,
    setSpaceStart,
    setPicking,
  };
}

export interface MonthCell {
  /** 读屏读的那一句（不含日期） */
  spoken: string;
  /** 格子里日期下面的内容 */
  content: ReactNode;
  /** 额外的样式名 */
  className?: string;
}

export interface MonthGridProps {
  /** 元素 id 的前缀：每一格是 `{idPrefix}-{日期}` */
  idPrefix: string;
  label: string;
  month: string;
  today: string;
  selection: DaySelection;
  busy?: boolean;
  stale?: boolean;
  cell(date: string): MonthCell;
  /** 这一天能不能选、能不能点开（过去的日子、超出范围的日子不能）；不能的照样走得到、读得到 */
  locked?(date: string): string | null;
  /** 点了一天（或聚焦后按 Enter） */
  onOpen(date: string): void;
  /** PageUp / PageDown */
  onMonth(delta: -1 | 1): void;
}

export function MonthGrid({ idPrefix, label, month, today, selection, busy = false, stale = false, cell, locked = () => null, onOpen, onMonth }: MonthGridProps) {
  const dragFrom = useRef<string | null>(null);
  const dragged = useRef(false);
  const weeks = monthWeeks(month);
  const range = selection.range !== null && monthOf(selection.range.from) === month && monthOf(selection.range.to) === month ? selection.range : null;

  useEffect(() => {
    const stop = (): void => {
      dragFrom.current = null;
    };
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, []);

  const focusOn = (date: string): void => {
    selection.setFocusDay(date);
    document.getElementById(`${idPrefix}-${date}`)?.focus();
  };

  const onDayClick = (date: string, shift: boolean): void => {
    selection.setFocusDay(date);
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    if (locked(date) !== null) return;
    if (selection.picking === "start") {
      selection.setAnchor(date);
      selection.setEnd(date);
      return selection.setPicking("end");
    }
    if (selection.picking === "end") {
      selection.setEnd(date);
      return selection.setPicking("start");
    }
    if (shift && selection.anchor !== null) return selection.setEnd(date);
    selection.select(date, date);
    selection.pick(date);
    onOpen(date);
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const focusDay = selection.focusDay;
    if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      return onMonth(event.key === "PageUp" ? -1 : 1);
    }
    if (event.key === "Escape" && range !== null) {
      event.preventDefault();
      return selection.clear();
    }
    const open = locked(focusDay) === null;
    if (event.key === "Enter") {
      event.preventDefault();
      if (!open) return;
      selection.pick(focusDay);
      return onOpen(focusDay);
    }
    if (event.key === " ") {
      event.preventDefault();
      if (!open) return;
      if (selection.spaceStart && selection.anchor !== null) {
        selection.setEnd(focusDay);
        return selection.setSpaceStart(false);
      }
      selection.setAnchor(focusDay);
      selection.setEnd(focusDay);
      return selection.setSpaceStart(true);
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = moveDay(focusDay, event.key);
    if (next === null) return;
    if (event.shiftKey && open && locked(next) === null) {
      if (selection.anchor === null) selection.setAnchor(focusDay);
      selection.setEnd(next);
    }
    focusOn(next);
  };

  const weekTitle = (week: (string | null)[]): string => {
    const days = week.filter((date): date is string => date !== null);
    const first = days[0] as string;
    const last = days.at(-1) as string;
    return first === last ? `${Number(first.slice(5, 7))} 月 ${Number(first.slice(8))} 日` : `${Number(first.slice(5, 7))} 月 ${Number(first.slice(8))} 日 – ${Number(last.slice(8))} 日`;
  };

  const day = (date: string): ReactNode => {
    const view = cell(date);
    const reason = locked(date);
    const isToday = date === today;
    const inRange = range !== null && date >= range.from && date <= range.to;
    const mark = range === null ? null : range.from === date && range.to === date ? "起止" : range.from === date ? "起" : range.to === date ? "止" : null;
    const spoken = `${spokenDate(date)}，${isToday ? "今天，" : ""}${view.spoken}${reason !== null ? `，${reason}` : ""}${mark ? `，选中的${mark === "起止" ? "起止" : mark === "起" ? "起点" : "终点"}` : inRange ? "，已选" : ""}`;
    const classes = ["calendar__cell", inRange ? "calendar__cell--selected" : "", date < today ? "calendar__cell--past" : "", isToday ? "calendar__cell--today" : "", date === selection.picked ? "calendar__cell--shown" : "", reason !== null ? "calendar__cell--locked" : "", view.className ?? ""].filter((name) => name !== "").join(" ");
    return (
      <div
        key={date}
        role="gridcell"
        id={`${idPrefix}-${date}`}
        className={classes}
        tabIndex={date === selection.focusDay ? 0 : -1}
        aria-selected={inRange}
        aria-disabled={reason !== null || undefined}
        aria-current={isToday ? "date" : undefined}
        aria-label={spoken}
        data-date={date}
        onMouseDown={(event) => {
          dragged.current = false;
          dragFrom.current = event.shiftKey || selection.picking !== "off" || reason !== null ? null : date;
        }}
        onMouseEnter={(event) => {
          if (dragFrom.current === null || event.buttons !== 1 || dragFrom.current === date || reason !== null) return;
          dragged.current = true;
          selection.setAnchor(dragFrom.current);
          selection.setEnd(date);
        }}
        onClick={(event) => onDayClick(date, event.shiftKey)}
        onFocus={() => selection.setFocusDay(date)}
      >
        <span className="calendar__day" aria-hidden="true">
          <span className="calendar__num">{Number(date.slice(8))}</span>
          <span className="calendar__weekday">{weekdayName(date)}</span>
          {isToday && <span className="calendar__today">今天</span>}
          {mark && <span className="calendar__mark">{mark}</span>}
        </span>
        {view.content}
      </div>
    );
  };

  return (
    <div className={stale ? "calendar calendar--stale" : "calendar"} role="grid" aria-label={label} aria-busy={busy} onKeyDown={onKey}>
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
          {week.map((date, at) => (date === null ? <span key={`blank-${at}`} role="gridcell" className="calendar__blank" /> : day(date)))}
        </div>
      ))}
    </div>
  );
}

