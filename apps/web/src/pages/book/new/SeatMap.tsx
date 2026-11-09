/**
 * 车内俯视示意图（M8-03，ADR 0069「车内俯视示意图」；规范 site-booking-v2.md 4.3）：按车型的最多乘客 N、最多行李 M（M7 车型标识）自动画，不用照片。
 * 车身轮廓、司机位（写「司机」）、乘客座位（主色，编号 1–N）、行李位（警告色、带提手，编号 1–M）。颜色只用令牌（样式在 book-new.css）。
 * 不只靠颜色：座位和行李形状不同，图下有文字说明和图例；整张图对读屏是一句话（role="img"），说明文字读屏照常能读到。
 */
import { VEHICLE_LABEL_TEXTS } from "@nozomi/domain";
import { seatPlan } from "../../../lib/book-new.ts";

/** 图下第一行的文字（不含图例的色块）。 */
export function seatMapCaption(passengers: number, luggage: number): { seats: string; bags: string; note: string } {
  return { seats: `乘客座位 ${passengers} 个`, bags: `行李 ${luggage} 件（${VEHICLE_LABEL_TEXTS.zh.luggageBasis}）`, note: "人数少时空座位也可以放行李" };
}

function Swatch({ kind }: { kind: "seat" | "bag" }) {
  return (
    <svg className="seat-map__swatch" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
      <rect className={kind === "seat" ? "seat-map__seat" : "seat-map__bag"} x="1" y="1" width="10" height="10" rx="2" />
    </svg>
  );
}

export function SeatMap({ passengers, luggage, name }: { passengers: number; luggage: number; name: string }) {
  const plan = seatPlan(passengers, luggage);
  const caption = seatMapCaption(passengers, luggage);
  const { body, driver } = plan;
  return (
    <figure className="seat-map">
      <svg className="seat-map__image" viewBox={`0 0 ${plan.width} ${plan.height}`} width={plan.width} height={plan.height} role="img" aria-label={`${name}的车内示意图：${caption.seats}，${caption.bags}`}>
        <rect className="seat-map__body" x={body.x} y={body.y} width={body.width} height={body.height} rx="24" />
        <line className="seat-map__glass" x1={body.x + 8} y1={plan.glassY} x2={body.x + body.width - 8} y2={plan.glassY} />
        <rect className="seat-map__driver" x={driver.x} y={driver.y} width={driver.width} height={driver.height} rx="6" />
        <text className="seat-map__driver-label" x={driver.x + driver.width / 2} y={driver.y + driver.height / 2} textAnchor="middle" dominantBaseline="central">
          司机
        </text>
        {plan.seats.map((seat) => (
          <g key={`seat-${seat.number}`}>
            <rect className="seat-map__seat" x={seat.x} y={seat.y} width={seat.width} height={seat.height} rx="6" />
            <text className="seat-map__seat-number" x={seat.x + seat.width / 2} y={seat.y + seat.height / 2} textAnchor="middle" dominantBaseline="central">
              {seat.number}
            </text>
          </g>
        ))}
        {plan.trunkY !== null && <line className="seat-map__trunk" x1={body.x + 8} y1={plan.trunkY} x2={body.x + body.width - 8} y2={plan.trunkY} />}
        {plan.bags.map((bag) => (
          <g key={`bag-${bag.number}`}>
            <path className="seat-map__bag-handle" d={`M${bag.x + bag.width / 2 - 6} ${bag.y + 2}v-4h12v4`} />
            <rect className="seat-map__bag" x={bag.x} y={bag.y + 2} width={bag.width} height={bag.height - 2} rx="4" />
            <text className="seat-map__bag-number" x={bag.x + bag.width / 2} y={bag.y + 1 + bag.height / 2} textAnchor="middle" dominantBaseline="central">
              {bag.number}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="seat-map__caption">
        <span className="seat-map__legend">
          <span className="seat-map__key">
            <Swatch kind="seat" />
            {caption.seats}
          </span>
          {" · "}
          <span className="seat-map__key">
            <Swatch kind="bag" />
            {caption.bags}
          </span>
          {" · "}
          {caption.note}
        </span>
        <span className="seat-map__note">示意图</span>
      </figcaption>
    </figure>
  );
}
