/**
 * 行程报价页第 1 步的「一天」编辑块（M9T-09，ADR 0101 第十三节第 1 小节）：
 * - 第 1 天选日期，之后每天写「接着前一天」的日期（服务端要求逐日连续，不用车的那天勾「这天不用车」）；
 * - 不是第一天、最后一天时可以勾「这天不用车」（空闲日）：其余字段收起；
 * - 上车时间、上车地点、按顺序的中间地点（各带停留时长，可增删）、最后下车地点：地址框和 `/book/new` 同一个 `PlaceField`（输入即提示、地图选点、手机全屏选择页）；
 * - 不是最后一天时「当晚为司机安排住宿」；
 * - 手机、平板（≤ 1023px）这一天的路线图就在块里；电脑上在右侧栏（`inlineMap`）。
 * 出错写在各自的字段下面（文案在 `trip-texts.ts`）。
 * AI 一句话整理后（M9T-33）：格子上标「AI 填的，可改」/「请补填」（`TripAiCell`），多个候选列在地点框下面点选，没找到的地名放进搜索框并提示；客人改过的格子去掉标记（`ai.touch`）。
 */
import type { CityCandidate } from "@nozomi/domain";
import type { ReactNode } from "react";
import type { MapTiles } from "../../../api/areas.ts";
import { Button, IconButton } from "../../../components/Button.tsx";
import { SelectField } from "../../../components/FormFields.tsx";
import { Icon } from "../../../components/Icon.tsx";
import type { TripPoint } from "../../../lib/book-new.ts";
import { ADDRESS_ONLY_HINT } from "../../../lib/booking-draft.ts";
import { durationText } from "../../../lib/charter-itinerary.ts";
import { MAX_TRIP_STOPS, TRIP_STAY_OPTIONS, type TripDayDraft, type TripDayErrors, chosenPoints, newTripStop } from "../../../lib/trip-form.ts";
import type { TripAiMarks } from "../../../lib/trip-ai.ts";
import { tripCopy } from "../../../lib/trip-texts.ts";
import type { LatLngValue } from "../SiteMapPicker.tsx";
import { PickerTextField } from "../new/full-screen.tsx";
import { PlaceField } from "../new/PlaceField.tsx";
import { type TripAiCellState, TripAiCell } from "./TripAiMark.tsx";
import { TripDayMap } from "./TripDayMap.tsx";

const STAY_CHOICES = TRIP_STAY_OPTIONS.map((minutes) => ({ value: String(minutes), label: minutes === 0 ? tripCopy("stayNone") : durationText(minutes) }));

export interface TripDayEditorProps {
  day: TripDayDraft;
  /** 从 0 起 */
  index: number;
  count: number;
  /** 第 1 天的日期（只有第 1 天可改）；别的天是算出来的日期，第 1 天还没选时为 "" */
  date: string;
  onDate(date: string): void;
  dateError: string | undefined;
  errors: TripDayErrors | undefined;
  onChange(day: TripDayDraft): void;
  onRemove(): void;
  tiles: MapTiles | null;
  fallbackCenter: LatLngValue | null;
  cities: readonly CityCandidate[];
  /** 手机、平板：路线图画在这一天的块里 */
  inlineMap: boolean;
  /** AI 整理后的格子标记；客人改了哪一格就 touch 哪一格 */
  ai?: { marks: TripAiMarks; touch(cell: string): void } | undefined;
}

export function TripDayEditor({ day, index, count, date, onDate, dateError, errors, onChange, onRemove, tiles, fallbackCenter, cities, inlineMap, ai }: TripDayEditorProps) {
  const n = index + 1;
  const titleId = `trip-day-${day.key}-title`;
  const update = (changes: Partial<TripDayDraft>): void => onChange({ ...day, ...changes });
  const centerOf = (point: TripPoint | null): LatLngValue | null => (point !== null ? { lat: point.lat, lng: point.lng } : fallbackCenter);
  const near = day.start ?? day.end ?? day.stops.find((stop) => stop.point !== null)?.point ?? null;
  const canIdle = index > 0 && index < count - 1;
  const fullStops = day.stops.length >= MAX_TRIP_STOPS;
  const errorOf = (message: string | undefined): { error?: string } => (message !== undefined ? { error: message } : {});
  const stateOf = (cell: string): TripAiCellState | null => (ai === undefined ? null : ai.marks.missing.includes(cell) ? "missing" : ai.marks.filled.includes(cell) ? "filled" : null);
  const touch = (cell: string): void => ai?.touch(cell);
  /** 地点格子：标记、候选、没找到的地名（提示 + 预填进搜索框） */
  const placeCell = (cell: string, field: (extra: { info?: string; initialText?: string }) => ReactNode, pick: (point: TripPoint) => void) => {
    const notFound = ai?.marks.notFound[cell];
    const extra = notFound === undefined ? {} : { info: tripCopy("ai.notFound", { name: notFound }), initialText: notFound };
    const candidates = ai?.marks.candidates[cell];
    return (
      <TripAiCell state={stateOf(cell)} {...(candidates === undefined ? {} : { candidates })} onPick={(point) => { touch(cell); pick(point); }}>
        {field(extra)}
      </TripAiCell>
    );
  };

  return (
    <section className="site-section trip-day" aria-labelledby={titleId} data-trip-day={day.key}>
      <div className="trip-day__head">
        <h3 id={titleId} className="book-new__subtitle trip-day__title" tabIndex={-1}>
          {tripCopy("day", { n })}
        </h3>
        {count > 1 && <IconButton icon="x" label={tripCopy("removeDay", { n })} onClick={onRemove} />}
      </div>
      {index === 0 ? (
        <TripAiCell state={stateOf("date")}>
          <PickerTextField
            label={tripCopy("date")}
            type="date"
            value={date}
            errors={dateError !== undefined ? [dateError] : []}
            onValue={(value) => {
              touch("date");
              onDate(value);
            }}
          />
        </TripAiCell>
      ) : (
        date !== "" && <p className="site-muted trip-day__date">{tripCopy("dateAuto", { date })}</p>
      )}
      {(canIdle || day.idle) && (
        <div className="field">
          <label className="choice">
            <input type="checkbox" checked={day.idle} aria-invalid={errors?.idle !== undefined ? true : undefined} aria-describedby={`${titleId}-idle-hint`} onChange={(event) => update({ idle: event.target.checked })} />
            <span className="choice__text">{tripCopy("idle")}</span>
          </label>
          <p className="field__hint" id={`${titleId}-idle-hint`}>
            {tripCopy("idleHint")}
          </p>
          {errors?.idle !== undefined && (
            <p className="field__error">
              <Icon name="alert-triangle" className="field__error-icon" />
              <span>{errors.idle}</span>
            </p>
          )}
        </div>
      )}
      {!day.idle && (
        <>
          <TripAiCell state={stateOf(`${day.key}.time`)}>
            <PickerTextField
              label={tripCopy("time", { n })}
              type="time"
              value={day.time}
              errors={errors?.time !== undefined ? [errors.time] : []}
              hint={tripCopy("timeHint")}
              onValue={(time) => {
                touch(`${day.key}.time`);
                update({ time });
              }}
            />
          </TripAiCell>
          {placeCell(
            `${day.key}.start`,
            (extra) => (
              <PlaceField label={tripCopy("start", { n })} value={day.start} onChange={(start) => { touch(`${day.key}.start`); update({ start }); }} {...errorOf(errors?.start)} hint={ADDRESS_ONLY_HINT} tiles={tiles} mapCenter={centerOf(day.end ?? near)} cities={cities} {...extra} />
            ),
            (start) => update({ start }),
          )}
          {day.stops.length > 0 && (
            <ol className="trip-day__stops">
              {day.stops.map((stop, s) => {
                const m = s + 2;
                const problem = errors?.stops?.[stop.key];
                const replace = (changes: Partial<typeof stop>): void => update({ stops: day.stops.map((entry) => (entry.key === stop.key ? { ...entry, ...changes } : entry)) });
                return (
                  <li key={stop.key} className="trip-day__stop">
                    {placeCell(
                      `${stop.key}.point`,
                      (extra) => (
                        <PlaceField label={tripCopy("stop", { n, m })} value={stop.point} onChange={(point) => { touch(`${stop.key}.point`); replace({ point }); }} {...errorOf(problem?.point)} tiles={tiles} mapCenter={centerOf(near)} cities={cities} {...extra} />
                      ),
                      (point) => replace({ point }),
                    )}
                    <TripAiCell state={stateOf(`${stop.key}.stay`)}>
                      <SelectField
                        label={tripCopy("stay", { n, m })}
                        placeholder={tripCopy("stayPlaceholder")}
                        required
                        value={stop.stay}
                        options={STAY_CHOICES}
                        errors={problem?.stay !== undefined ? [problem.stay] : []}
                        onChange={(stay) => {
                          touch(`${stop.key}.stay`);
                          replace({ stay });
                        }}
                      />
                    </TripAiCell>
                    <Button variant="text" className="trip-day__remove-stop" onClick={() => update({ stops: day.stops.filter((entry) => entry.key !== stop.key) })}>
                      {tripCopy("removeStop", { n, m })}
                    </Button>
                  </li>
                );
              })}
            </ol>
          )}
          <div className="trip-day__add">
            <Button disabled={fullStops} onClick={() => update({ stops: [...day.stops, newTripStop()] })}>
              <Icon name="plus" />
              {tripCopy("addStop")}
            </Button>
            {fullStops && <p className="site-muted">{tripCopy("maxStops", { max: MAX_TRIP_STOPS })}</p>}
          </div>
          {placeCell(
            `${day.key}.end`,
            (extra) => (
              <PlaceField label={tripCopy("end", { n })} value={day.end} onChange={(end) => { touch(`${day.key}.end`); update({ end }); }} {...errorOf(errors?.end)} hint={ADDRESS_ONLY_HINT} tiles={tiles} mapCenter={centerOf(day.start ?? near)} cities={cities} {...extra} />
            ),
            (end) => update({ end }),
          )}
        </>
      )}
      {index < count - 1 && (
        <div className="field">
          <label className="choice">
            <input type="checkbox" checked={day.lodgingProvided} aria-describedby={`${titleId}-lodging-hint`} onChange={(event) => update({ lodgingProvided: event.target.checked })} />
            <span className="choice__text">{tripCopy("lodging")}</span>
          </label>
          <p className="field__hint" id={`${titleId}-lodging-hint`}>
            {tripCopy("lodgingHint")}
          </p>
        </div>
      )}
      {inlineMap && <TripDayMap dayNumber={n} points={chosenPoints(day)} headingLevel="h4" />}
    </section>
  );
}
