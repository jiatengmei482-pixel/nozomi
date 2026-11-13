/**
 * 包车按行程计价的对外价明细（M9W-02，ADR 0088 第 4 节）：套餐、上 / 下车加价、经停加价（逐区域）、调价、其他费用……各项之和等于总价。
 * 只在有经停点（按行程计价）时显示；明细对不上总价时 `breakdownLines` 给 null，这里什么都不画（只显示总价）。
 */
import { type BreakdownLine, ITINERARY_NOTE } from "../../../lib/charter-itinerary.ts";

export function PriceBreakdown({ lines, total, note = true }: { lines: readonly BreakdownLine[] | null; total?: string; note?: boolean }) {
  return (
    <div className="price-breakdown">
      {lines !== null && (
        <dl className="price-breakdown__list" aria-label="价格明细">
          {lines.map((line) => (
            <div key={line.key} className="price-breakdown__row">
              <dt>{line.label}</dt>
              <dd className="price-breakdown__amount">{line.amount}</dd>
            </div>
          ))}
          {total !== undefined && (
            <div className="price-breakdown__row price-breakdown__row--total">
              <dt>合计</dt>
              <dd className="price-breakdown__amount">{total}</dd>
            </div>
          )}
        </dl>
      )}
      {note && <p className="price-breakdown__note">{ITINERARY_NOTE}</p>}
    </div>
  );
}
