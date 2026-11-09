/**
 * 「乘客 / 行李」合并栏（M8-03，ADR 0069「修正版 v2」；规范 site-booking-v2.md 3.2）：收起时是一个按钮「2 人 · 2 件」，
 * 点开（`aria-expanded`）后乘客、行李各一组 − / +。数字变化用 `<output>` 播报；到上下限时那一侧的按钮禁用。
 */
import { VEHICLE_LABEL_TEXTS } from "@nozomi/domain";
import { useId, useState } from "react";
import { Icon } from "../../../components/Icon.tsx";
import { TRAVELLER_LIMITS, travellersText } from "../../../lib/book-new.ts";

/** 一组 − 数字 +（乘客、行李；M8-04 起附加服务也用）。 */
export function Stepper({ label, unit, value, min, max, onChange }: { label: string; unit?: string; value: number; min: number; max: number; onChange(value: number): void }) {
  const id = useId();
  return (
    <div className="travellers__row" role="group" aria-labelledby={id}>
      <span className="travellers__label" id={id}>
        {label}
      </span>
      <div className="travellers__stepper">
        <button type="button" className="icon-button travellers__step" aria-label={`减少${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
          <Icon name="minus" />
        </button>
        <output className="travellers__value" aria-live="polite">
          {unit === undefined ? value : `${value} ${unit}`}
        </output>
        <button type="button" className="icon-button travellers__step" aria-label={`增加${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
          <Icon name="plus" />
        </button>
      </div>
    </div>
  );
}

export function TravellersField({ passengers, luggage, onChange }: { passengers: number; luggage: number; onChange(value: { passengers: number; luggage: number }): void }) {
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const panelId = useId();
  return (
    <div className="field travellers">
      <span className="field__label" id={labelId}>
        乘客 / 行李
      </span>
      <button type="button" className="input travellers__toggle" aria-labelledby={`${labelId} ${panelId}-value`} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
        <span id={`${panelId}-value`}>{travellersText(passengers, luggage)}</span>
        <Icon name="chevron-down" className={open ? "travellers__arrow travellers__arrow--open" : "travellers__arrow"} />
      </button>
      <div id={panelId} className="travellers__panel" hidden={!open}>
        <Stepper label="乘客" unit="人" value={passengers} min={TRAVELLER_LIMITS.passengers.min} max={TRAVELLER_LIMITS.passengers.max} onChange={(value) => onChange({ passengers: value, luggage })} />
        <Stepper label="行李" unit="件" value={luggage} min={TRAVELLER_LIMITS.luggage.min} max={TRAVELLER_LIMITS.luggage.max} onChange={(value) => onChange({ passengers, luggage: value })} />
        <p className="field__hint">{VEHICLE_LABEL_TEXTS.zh.luggageBasis}</p>
      </div>
    </div>
  );
}
