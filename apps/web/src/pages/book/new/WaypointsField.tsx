/**
 * 包车「经停点（选填）」（M9W-02，ADR 0088 第 5 节；需求 13.5）：上车地点下面，可排序的已选列表（02-components.md 第 26 节）。
 * - 每一行：序号、地址框（和上车、下车地点同一个 PlaceField：输入即提示、地图选点、手机全屏选择页）、停留时长（30 分钟一档，必填）；
 *   行尾「上移」「下移」「删除」（只有图标的文字按钮，`aria-label` 带经停点名）；焦点在行里的按钮上时 Alt + ↑ / ↓ 也能移动；
 * - 移动后焦点跟着这一行走，`role="status"` 播报「{名称} 现在排第 i，共 N 个」；删除后焦点移到下一行的「删除」，没有了回到「添加经停点」；
 * - 最多 10 个：满了「添加经停点」禁用，旁边写「最多 10 个」。
 */
import type { CityCandidate } from "@nozomi/domain";
import { ADDRESS_ONLY_HINT } from "../../../lib/booking-draft.ts";
import { type KeyboardEvent, useRef, useState } from "react";
import type { MapTiles } from "../../../api/areas.ts";
import { Button, IconButton } from "../../../components/Button.tsx";
import { SelectField } from "../../../components/FormFields.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { MAX_WAYPOINTS, STAY_OPTIONS, type WaypointDraft, type WaypointErrors, durationText, moveWaypoint, newWaypoint } from "../../../lib/charter-itinerary.ts";
import type { LatLngValue } from "../SiteMapPicker.tsx";
import { PlaceField } from "./PlaceField.tsx";

const STAY_CHOICES = STAY_OPTIONS.map((minutes) => ({ value: String(minutes), label: durationText(minutes) }));

export interface WaypointsFieldProps {
  value: readonly WaypointDraft[];
  onChange(next: WaypointDraft[]): void;
  errors: WaypointErrors;
  tiles: MapTiles | null;
  mapCenter: LatLngValue | null;
  cities: readonly CityCandidate[];
}

export function WaypointsField({ value, onChange, errors, tiles, mapCenter, cities }: WaypointsFieldProps) {
  const [announce, setAnnounce] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const full = value.length >= MAX_WAYPOINTS;
  const nameOf = (entry: WaypointDraft, index: number): string => entry.point?.name ?? `第 ${index + 1} 个经停点`;

  const move = (index: number, delta: -1 | 1): void => {
    const target = index + delta;
    const moved = value[index];
    if (moved === undefined || target < 0 || target >= value.length) return;
    onChange(moveWaypoint(value, index, delta));
    setAnnounce(`${moved.point?.name ?? "这个经停点"} 现在排第 ${target + 1}，共 ${value.length} 个`);
    requestAnimationFrame(() => {
      const row = listRef.current?.querySelector<HTMLElement>(`[data-waypoint="${moved.key}"]`);
      const wanted = row?.querySelector<HTMLButtonElement>(delta === -1 ? '[data-move="up"]' : '[data-move="down"]');
      (wanted && !wanted.disabled ? wanted : row?.querySelector<HTMLButtonElement>(delta === -1 ? '[data-move="down"]' : '[data-move="up"]'))?.focus();
    });
  };

  const remove = (index: number): void => {
    const removed = value[index];
    if (removed === undefined) return;
    onChange(value.filter((entry) => entry.key !== removed.key));
    setAnnounce(`已删除${removed.point === null ? `第 ${index + 1} 个经停点` : `经停点「${removed.point.name}」`}`);
    requestAnimationFrame(() => {
      const rows = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-waypoint]") ?? [])];
      const row = rows[Math.min(index, rows.length - 1)];
      (row?.querySelector<HTMLElement>("[data-remove]") ?? addRef.current)?.focus();
    });
  };

  const add = (): void => {
    if (full) return;
    const created = newWaypoint();
    onChange([...value, created]);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-waypoint="${created.key}"] input, [data-waypoint="${created.key}"] button`)?.focus());
  };

  const update = (key: string, changes: Partial<WaypointDraft>): void => onChange(value.map((entry) => (entry.key === key ? { ...entry, ...changes } : entry)));

  return (
    <fieldset className="field fieldset picked book-waypoints">
      <legend className="field__label">经停点（选填）</legend>
      <p className="field__hint">按顺序填想去的景点和每处大概停留多久，最多 {MAX_WAYPOINTS} 个；价格按经停点所在区域和行程总时长计算。</p>
      {value.length > 0 && (
        <ol className="picked__list" ref={listRef}>
          {value.map((entry, index) => {
            const name = nameOf(entry, index);
            const rowErrors = errors[entry.key] ?? {};
            return (
              <li
                key={entry.key}
                className="picked__row"
                data-waypoint={entry.key}
                onKeyDown={(event: KeyboardEvent<HTMLLIElement>) => {
                  if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
                  if (!(event.target instanceof HTMLButtonElement)) return;
                  event.preventDefault();
                  move(index, event.key === "ArrowUp" ? -1 : 1);
                }}
              >
                <span className="picked__number" aria-hidden="true">
                  {index + 1}
                </span>
                <div className="picked__main book-waypoint__fields">
                  <PlaceField
                    label={`经停点 ${index + 1}`}
                    value={entry.point}
                    onChange={(point) => update(entry.key, { point })}
                    {...(rowErrors.point !== undefined ? { error: rowErrors.point } : {})}
                    hint={ADDRESS_ONLY_HINT}
                    tiles={tiles}
                    mapCenter={entry.point ?? mapCenter}
                    cities={cities}
                  />
                  <SelectField
                    label={`经停点 ${index + 1} 停留时长`}
                    required
                    placeholder="停留多久"
                    value={entry.stay}
                    options={STAY_CHOICES}
                    errors={rowErrors.stay !== undefined ? [rowErrors.stay] : []}
                    onChange={(stay) => update(entry.key, { stay })}
                  />
                </div>
                <span className="picked__actions">
                  <IconButton icon="arrow-up" label={`把 ${name} 上移`} data-move="up" disabled={index === 0} onClick={() => move(index, -1)} />
                  <IconButton icon="arrow-down" label={`把 ${name} 下移`} data-move="down" disabled={index === value.length - 1} onClick={() => move(index, 1)} />
                  <IconButton icon="x" label={`删除 ${name}`} data-remove="" onClick={() => remove(index)} />
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <div className="book-waypoints__add">
        <Button size="sm" ref={addRef} disabled={full} onClick={add}>
          <Icon name="plus" />
          添加经停点
        </Button>
        {full && <span className="field__hint">最多 {MAX_WAYPOINTS} 个</span>}
      </div>
      <p className="visually-hidden" role="status">
        {announce}
      </p>
    </fieldset>
  );
}
