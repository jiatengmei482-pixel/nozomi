/**
 * 包车行程的超限提醒（M9P-10，规格步骤 5）：显示在「行程时间表」下方，只提醒、不拦下单。
 * 用哪一个报价由页面决定（所选车型，没选时最便宜的），说法见 `lib/itinerary-warnings.ts`。
 */
import type { SiteQuote } from "../../../api/site.ts";
import type { SiteItineraryRoute } from "../../../lib/charter-itinerary.ts";
import { itineraryWarningLines } from "../../../lib/itinerary-warnings.ts";

export interface ItineraryWarningsProps {
  quote: SiteQuote | null;
  route: SiteItineraryRoute | null | undefined;
  /** 按顺序的地点名：上车、各经停、下车 */
  points: readonly string[];
}

export function ItineraryWarnings({ quote, route, points }: ItineraryWarningsProps) {
  const lines = itineraryWarningLines(quote, route, points);
  if (lines.length === 0) return null;
  return (
    <div className="book-new__notice" role="status" data-testid="itinerary-warnings">
      {lines.map((line) => (
        <div key={line.kind}>
          <p>{line.text}</p>
          {line.longest !== null && <p className="site-muted">{line.longest}</p>}
        </div>
      ))}
    </div>
  );
}
