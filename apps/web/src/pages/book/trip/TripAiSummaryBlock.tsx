/**
 * AI 整理后表单顶部的摘要框（M9T-33，ADR 0104 第二节第 1 小节第 3 条）：
 * 「已按你的描述填好 N 天行程……」+ 请补填 / 请确认 / 没有用上的信息 / 不在报价范围，每类一个小标题和列表，空的不显示。
 * 整理完焦点移到这里（`tabIndex=-1`），读屏从摘要开始读。文案由 `lib/trip-ai.ts` 按代码从 `trip-texts.ts` 拼好。
 */
import { type ReactNode, type Ref, useId } from "react";
import type { TripAiSummary } from "../../../lib/trip-ai.ts";
import { tripCopy } from "../../../lib/trip-texts.ts";

export function TripAiSummaryBlock({ headline, summary, manual, ref }: { headline: string; summary: TripAiSummary; /** 有「不在报价范围」时放在那一句下面的转人工入口 */ manual?: ReactNode; ref?: Ref<HTMLDivElement> }) {
  const id = useId();
  const groups: { key: string; title: string; items: string[] }[] = [
    { key: "missing", title: tripCopy("ai.summaryMissing"), items: summary.missing },
    { key: "confirm", title: tripCopy("ai.summaryConfirm"), items: summary.confirm },
    { key: "unused", title: tripCopy("ai.summaryUnused"), items: summary.unused },
    { key: "scope", title: tripCopy("ai.summaryOutOfScope"), items: summary.outOfScope === null ? [] : [summary.outOfScope] },
  ];
  return (
    <div ref={ref} tabIndex={-1} className="trip-ai-summary" role="region" aria-labelledby={`${id}-headline`}>
      <p id={`${id}-headline`} className="trip-ai-summary__headline">{headline}</p>
      {groups
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <div key={group.key} className={`trip-ai-summary__group trip-ai-summary__group--${group.key}`}>
            <h3 className="trip-ai-summary__title">{group.title}</h3>
            <ul className="trip-ai-summary__list">
              {group.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            {group.key === "scope" && manual}
          </div>
        ))}
    </div>
  );
}
