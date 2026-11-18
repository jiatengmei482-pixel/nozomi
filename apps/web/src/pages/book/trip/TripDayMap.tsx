/**
 * 行程报价页的「一天一张」路线图（M9T-09，ADR 0101 第十三节第 1 小节）：直接用新预订页包车的 `ItineraryMap`（后端代调谷歌静态图，
 * 标记按顺序编号 1 = 上车、中间依次、最后 = 下车）。这一天选了至少两个点才画；超过地图的标记上限（12）时不画（每天最多 12 个点，正常到不了）。
 * 图下面按同一编号列出地名，读屏和图出不来时都能看到全程。
 */
import { ITINERARY_MAP_RULES } from "@nozomi/domain";
import { tripCopy } from "../../../lib/trip-texts.ts";
import { ItineraryMap } from "../new/ItineraryMap.tsx";

export interface TripMapPoint {
  name: string;
  lat: number;
  lng: number;
}

export function TripDayMap({ dayNumber, points, headingLevel = "h3" }: { dayNumber: number; points: readonly TripMapPoint[]; headingLevel?: "h3" | "h4" }) {
  if (points.length < 2) return null;
  const Heading = headingLevel;
  const chain = points.map((point, index) => `${index + 1} ${point.name}`).join(" → ");
  return (
    <figure className="trip-map" aria-label={tripCopy("mapFigure", { n: dayNumber })}>
      <Heading className="trip-map__title">{tripCopy("day", { n: dayNumber })}</Heading>
      {points.length <= ITINERARY_MAP_RULES.maxPoints && <ItineraryMap points={points.map((point) => ({ lat: point.lat, lng: point.lng }))} alt={tripCopy("mapAlt", { n: dayNumber, chain })} />}
      <ol className="trip-map__list">
        {points.map((point, index) => (
          <li key={`${index}-${point.lat}-${point.lng}`} className="trip-map__item">
            <span className="trip-map__number" aria-hidden="true">
              {index + 1}
            </span>
            <span className="trip-map__name">{point.name}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}
