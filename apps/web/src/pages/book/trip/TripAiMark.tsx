/**
 * AI 一句话整理后，表单格子上的标记（M9T-33 第二部分，ADR 0104 第二节第 1 小节第 3 条）：
 * - AI 填的格子右上角一个小标签「AI 填的」；
 * - 缺的格子黄底，标签「请补填」；
 * - 地点有多个候选时，格子下面列最多 5 个（名称 + 地址），客人点一个才算选好。
 * 客人改过这一格（或选了候选）后由页面去掉标记。没找到的地名用 `PlaceField` 的提示和预填，不在这里。
 */
import type { ReactNode } from "react";
import { Button } from "../../../components/Button.tsx";
import type { TripPoint } from "../../../lib/book-new.ts";
import type { TripAiCandidate } from "../../../lib/trip-ai.ts";
import { tripCopy } from "../../../lib/trip-texts.ts";

export type TripAiCellState = "filled" | "missing";

export function TripAiCell({ state, candidates, onPick, children }: { state: TripAiCellState | null; candidates?: readonly TripAiCandidate[]; onPick?(point: TripPoint): void; children: ReactNode }) {
  // 外面这一层总是在（没标记时 display: contents，不影响排版）：标记去掉时输入框不重新挂载，客人正在输入的不丢
  const marked = state !== null || (candidates !== undefined && candidates.length > 0);
  return (
    <div className={marked ? `trip-ai-cell trip-ai-cell--marked${state === null ? "" : ` trip-ai-cell--${state}`}` : "trip-ai-cell"}>
      {state !== null && <span className="trip-ai-cell__badge">{tripCopy(state === "filled" ? "ai.filled" : "ai.missing")}</span>}
      {children}
      {candidates !== undefined && candidates.length > 0 && onPick !== undefined && (
        <div className="trip-ai-cell__candidates" role="group" aria-label={tripCopy("ai.pickOne")}>
          <p className="trip-ai-cell__pick">{tripCopy("ai.pickOne")}</p>
          <ul>
            {candidates.map((candidate) => (
              <li key={`${candidate.point.lat},${candidate.point.lng},${candidate.point.name}`}>
                <Button variant="text" className="trip-ai-cell__candidate" onClick={() => onPick(candidate.point)}>
                  {candidate.point.name}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
