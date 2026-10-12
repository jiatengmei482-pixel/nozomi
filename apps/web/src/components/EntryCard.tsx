/**
 * 入口卡片（docs/design/02-components.md 第 18 节）：首页上「进入某个模块 + 看一眼数量」。
 * 标题是链接，可点区域铺满整张卡片；提醒行是另一个链接，盖在上面单独可点。
 */
import { useId } from "react";
import { Link } from "react-router";
import { formatCount } from "../lib/master-display.ts";
import { Icon } from "./Icon.tsx";

export interface EntryCount {
  value: number;
  label: string;
}

export interface EntryReminder {
  text: string;
  to: string;
}

export type EntryCounts = { status: "loading" } | { status: "failed" } | { status: "ready"; counts: readonly EntryCount[] };

export interface EntryCardProps {
  title: string;
  /** 没有对应页面的模块不给地址：标题是普通文字，不可点 */
  to?: string;
  counts: EntryCounts;
  reminders?: readonly EntryReminder[];
}

export function EntryCard({ title, to, counts, reminders = [] }: EntryCardProps) {
  const countsId = useId();
  return (
    <div className={to !== undefined ? "entry-card entry-card--link" : "entry-card"}>
      <div className="entry-card__title-row">
        {to !== undefined ? (
          <>
            <Link className="entry-card__title" to={to} aria-describedby={countsId}>
              {title}
            </Link>
            <Icon name="chevron-right" className="entry-card__arrow" />
          </>
        ) : (
          <span className="entry-card__title">{title}</span>
        )}
      </div>
      <div id={countsId} className="entry-card__counts-row">
        {counts.status === "loading" && <span className="entry-card__skeleton" aria-hidden="true" />}
        {counts.status === "failed" && (
          <span className="entry-card__missing">
            <span aria-hidden="true">—</span>
            <span className="visually-hidden">数量没有加载出来</span>
          </span>
        )}
        {counts.status === "ready" && (
          <dl className="entry-card__counts">
            {counts.counts.map((count) => (
              <div key={count.label} className="entry-card__count">
                <dt>{count.label}</dt>
                <dd>{formatCount(count.value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {reminders.map((reminder) => (
        <Link key={reminder.text} className="entry-card__reminder" to={reminder.to}>
          <Icon name="alert-triangle" className="entry-card__reminder-icon" />
          <span className="entry-card__reminder-text">{reminder.text}</span>
          <Icon name="chevron-right" className="entry-card__reminder-icon" />
        </Link>
      ))}
    </div>
  );
}
