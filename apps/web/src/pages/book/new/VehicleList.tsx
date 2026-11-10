/**
 * 新预订页的「选择车型」列表（M8-03；规范 site-booking-v2.md 4）：按价格从低到高（接口已排好）、坐不下的接口不返回；
 * 默认电脑 4 个、手机 3 个，下面「显示全部 N 个车型 ▾」。每张卡：车型名、车型标识（M7）、一口价（含区域加价时价格下面说一句，不写金额，M8-19）、
 * 含公里数那一句（车型标识下面，M8-13）、「选择」；
 * 选中的那张展开车内俯视示意图。选中用 `aria-pressed`，不只靠颜色（按钮文字变「已选择」、卡片加粗描边）。
 */
import { vehicleLabel } from "@nozomi/domain";
import { useEffect, useRef, useState } from "react";
import type { SiteQuote } from "../../../api/site.ts";
import { Button } from "../../../components/Button.tsx";
import { VehicleLabelItems } from "../../../components/VehicleLabelFacts.tsx";
import { moneyText } from "../../../lib/dispatch-display.ts";
import { displayName } from "../../../lib/master-display.ts";
import { AREA_SURCHARGE_NOTE, packageText, siteDistanceNote } from "../../../lib/site-display.ts";
import { SitePrice } from "../SitePrice.tsx";
import { SeatMap } from "./SeatMap.tsx";

function VehicleCard({ quote, selected, onSelect }: { quote: SiteQuote; selected: boolean; onSelect(): void }) {
  const group = quote.vehicle_group;
  const name = displayName(group.name);
  const label = vehicleLabel(group);
  const kmNote = siteDistanceNote(quote.distance);
  return (
    <li className={selected ? "book-vehicle book-vehicle--selected" : "book-vehicle"}>
      <div className="book-vehicle__head">
        <h3 className="book-vehicle__name" lang={name.lang}>
          {name.text}
        </h3>
        <p className="book-vehicle__price">
          <SitePrice text={moneyText(quote.price.total)} />
        </p>
      </div>
      {quote.includes_area_surcharge === true && <p className="book-vehicle__note">{AREA_SURCHARGE_NOTE}</p>}
      <dl className="site-facts book-vehicle__facts">
        {quote.package !== null && (
          <div className="site-facts__item">
            <dt>包车套餐</dt>
            <dd>{packageText(quote.package.hours, quote.package.km)}</dd>
          </div>
        )}
        <VehicleLabelItems group={group} itemClassName="site-facts__item" luggageBasis />
        {kmNote !== null && (
          <div className="site-facts__item site-facts__item--wide">
            <dt>公里数</dt>
            <dd>{kmNote}</dd>
          </div>
        )}
      </dl>
      <Button variant={selected ? "secondary" : "primary"} size="lg" block aria-pressed={selected} data-vehicle-choose="" onClick={onSelect}>
        {selected ? "已选择" : "选择"}
        <span className="visually-hidden">{name.text}</span>
      </Button>
      {selected && label.maxPassengers !== null && <SeatMap passengers={label.maxPassengers} luggage={label.maxLuggage ?? 0} name={name.text} />}
    </li>
  );
}

export function VehicleList({ quotes, limit, selectedId, onSelect }: { quotes: readonly SiteQuote[]; limit: number; selectedId: string | null; onSelect(quote: SiteQuote): void }) {
  const [showAll, setShowAll] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const revealed = useRef(false);
  useEffect(() => {
    if (!showAll || !revealed.current) return;
    revealed.current = false;
    // 展开后焦点落到第一个新露出来的车型的「选择」上（「显示全部」按钮已经不在了）
    listRef.current?.querySelectorAll<HTMLButtonElement>("[data-vehicle-choose]")[limit]?.focus();
  }, [showAll, limit]);
  const visible = quotes.filter((quote, index) => showAll || index < limit || quote.vehicle_group.id === selectedId);
  return (
    <>
      <ul className="book-vehicles" ref={listRef}>
        {visible.map((quote) => (
          <VehicleCard key={quote.quote_id} quote={quote} selected={quote.vehicle_group.id === selectedId} onSelect={() => onSelect(quote)} />
        ))}
      </ul>
      {!showAll && quotes.length > visible.length && (
        <Button
          size="lg"
          block
          aria-expanded={false}
          onClick={() => {
            revealed.current = true;
            setShowAll(true);
          }}
        >
          显示全部 {quotes.length} 个车型 ▾
        </Button>
      )}
    </>
  );
}
