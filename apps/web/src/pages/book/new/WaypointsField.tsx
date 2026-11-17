/**
 * 包车「经停点（选填）」（M9W-02，ADR 0088 第 5 节；需求 13.5）：上车地点下面，可排序的已选列表（02-components.md 第 26 节）。
 * - 每一行：序号、地址框（和上车、下车地点同一个 PlaceField：输入即提示、地图选点、手机全屏选择页）、停留时长（30 分钟一档，必填）；
 *   行尾「上移」「下移」「删除」（只有图标的文字按钮，`aria-label` 带经停点名）；焦点在行里的按钮上时 Alt + ↑ / ↓ 也能移动；
 * - 移动后焦点跟着这一行走，`role="status"` 播报「{名称} 现在排第 i，共 N 个」；删除后焦点移到下一行的「删除」，没有了回到「添加经停点」；
 * - 最多 25 个（M9P-10，`CHARTER_ITINERARY_LIMITS`）：满了「添加经停点」禁用，旁边写「最多 25 个经停点，更多请联系客服定制」。
 * - 指针拖动（M9P-20 P2，ADR 0096 第三节第 7 小节）：每行一个拖动把手（`aria-hidden`，不进 Tab 顺序，键盘用户用上移下移）；鼠标按下就拖，
 *   触屏长按 `DRAG_HOLD_MS` 才开始（不和页面滚动抢）；拖动中目标位置画插入线；松手后和上移下移一样播报新位置。不做位移动画。
 * - 指定到达时间（M9P-20 P3，ADR 0096 第三节第 6、7 小节）：每行「指定到达时间（选填）」，只填时刻，不晚于出发时刻的按次日并在行内写「次日 01:00」；
 *   填了的行锁定：拖动把手换成锁形图标，不参与建议顺序，上移 / 下移照常可用；行内按钮的 `aria-describedby` 指向
 *   「河口湖，须在 14:00 前到达，已锁定，不参与建议顺序，只能用上移 / 下移调整」；按当前顺序预计晚到时在这一行提示（只提示、不拦截）。
 */
import type { CityCandidate } from "@nozomi/domain";
import { ADDRESS_ONLY_HINT } from "../../../lib/booking-draft.ts";
import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";
import type { MapTiles } from "../../../api/areas.ts";
import { Button, IconButton } from "../../../components/Button.tsx";
import { SelectField } from "../../../components/FormFields.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { TextField } from "../../../components/TextField.tsx";
import { draftArriveBy, lockedDescription, nextDayHint } from "../../../lib/arrive-by-display.ts";
import { itineraryCopy } from "../../../lib/itinerary-texts.ts";
import { MAX_WAYPOINTS, STAY_OPTIONS, type WaypointDraft, type WaypointErrors, durationText, moveWaypoint, moveWaypointTo, newWaypoint } from "../../../lib/charter-itinerary.ts";
import { waypointLimitText } from "../../../lib/itinerary-warnings.ts";
import type { LatLngValue } from "../SiteMapPicker.tsx";
import { PlaceField } from "./PlaceField.tsx";

const STAY_CHOICES = STAY_OPTIONS.map((minutes) => ({ value: String(minutes), label: durationText(minutes) }));

/** 触屏长按多久才开始拖（毫秒） */
export const DRAG_HOLD_MS = 300;

export interface WaypointsFieldProps {
  value: readonly WaypointDraft[];
  onChange(next: WaypointDraft[]): void;
  errors: WaypointErrors;
  tiles: MapTiles | null;
  mapCenter: LatLngValue | null;
  cities: readonly CityCandidate[];
  /** 出发时刻 HH:MM（推断指定到达时间是当天还是次日）；没填为空 */
  startTime?: string;
  /** 按行的 `key` 给的晚到提示（「预计 14:20 到，晚于指定的 14:00，请把上车时间提前至少 20 分钟」） */
  late?: Readonly<Record<string, string>>;
}

export function WaypointsField({ value, onChange, errors, tiles, mapCenter, cities, startTime = "", late = {} }: WaypointsFieldProps) {
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

  // 地点框选中谷歌候选后要异步取坐标，回来时可能已经过了好几次渲染（比如客人先选了停留时长）：按最新的列表改这一行，不能用渲染那一刻的旧列表（M9W-08）
  const latest = useRef(value);
  latest.current = value;
  const update = (key: string, changes: Partial<WaypointDraft>): void => onChange(latest.current.map((entry) => (entry.key === key ? { ...entry, ...changes } : entry)));

  // 指针拖动：拖的是第几行、现在要放到第几行
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const targetIndex = (clientY: number): number => {
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-waypoint]") ?? [])];
    const found = rows.findIndex((row) => {
      const box = row.getBoundingClientRect();
      return clientY < box.top + box.height / 2;
    });
    return found < 0 ? rows.length - 1 : found;
  };
  const startDrag = (index: number, event: PointerEvent<HTMLSpanElement>): void => {
    const begin = (): void => setDrag({ from: index, to: index });
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    if (event.pointerType === "touch") holdTimer.current = setTimeout(begin, DRAG_HOLD_MS);
    else {
      event.preventDefault();
      begin();
    }
  };
  const moveDrag = (event: PointerEvent<HTMLSpanElement>): void => {
    if (drag === null) return;
    const to = targetIndex(event.clientY);
    if (to !== drag.to) setDrag({ ...drag, to });
  };
  const endDrag = (): void => {
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    if (drag === null) return;
    setDrag(null);
    const moved = value[drag.from];
    if (moved === undefined || drag.from === drag.to) return;
    onChange(moveWaypointTo(value, drag.from, drag.to));
    setAnnounce(`${moved.point?.name ?? "这个经停点"} 现在排第 ${drag.to + 1}，共 ${value.length} 个`);
  };

  return (
    <fieldset className="field fieldset picked book-waypoints">
      <legend className="field__label">经停点（选填）</legend>
      <p className="field__hint">按顺序填想去的景点和每处大概停留多久，最多 {MAX_WAYPOINTS} 个；价格按经停点所在区域和行程总时长计算。{itineraryCopy("arriveByFieldHint")}</p>
      {value.length > 0 && (
        <ol className="picked__list" ref={listRef}>
          {value.map((entry, index) => {
            const name = nameOf(entry, index);
            const rowErrors = errors[entry.key] ?? {};
            const arriveBy = draftArriveBy(entry.arriveBy, startTime);
            const lockedId = `${entry.key}-locked`;
            const describedBy = arriveBy === null ? undefined : lockedId;
            const nextDay = nextDayHint(entry.arriveBy, startTime);
            return (
              <li
                key={entry.key}
                className={drag !== null && drag.from !== drag.to && drag.to === index ? `picked__row picked__row--drop-${drag.to < drag.from ? "before" : "after"}` : drag?.from === index ? "picked__row picked__row--dragging" : "picked__row"}
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
                  <TextField
                    label={itineraryCopy("arriveByLabel", { number: index + 1 })}
                    type="time"
                    className="book-waypoint__arrive"
                    value={entry.arriveBy ?? ""}
                    errors={rowErrors.arriveBy !== undefined ? [rowErrors.arriveBy] : []}
                    {...(nextDay !== null ? { hint: nextDay } : {})}
                    onChange={(event) => update(entry.key, { arriveBy: event.target.value })}
                  />
                  {late[entry.key] !== undefined && (
                    <p className="book-waypoint__late" data-late="">
                      <Icon name="alert-triangle" /> {late[entry.key]}
                    </p>
                  )}
                </div>
                <span className="picked__actions">
                  {arriveBy === null ? (
                    <span className="picked__handle" aria-hidden="true" data-drag-handle="" onPointerDown={(event) => startDrag(index, event)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
                      <Icon name="menu" />
                    </span>
                  ) : (
                    <span className="picked__lock" aria-hidden="true" data-locked="" title={itineraryCopy("arriveByLockedIcon")}>
                      <Icon name="lock" />
                    </span>
                  )}
                  <IconButton icon="arrow-up" label={`把 ${name} 上移`} data-move="up" aria-describedby={describedBy} disabled={index === 0} onClick={() => move(index, -1)} />
                  <IconButton icon="arrow-down" label={`把 ${name} 下移`} data-move="down" aria-describedby={describedBy} disabled={index === value.length - 1} onClick={() => move(index, 1)} />
                  <IconButton icon="x" label={`删除 ${name}`} data-remove="" aria-describedby={describedBy} onClick={() => remove(index)} />
                </span>
                {arriveBy !== null && (
                  <span className="visually-hidden" id={lockedId}>
                    {lockedDescription(name, arriveBy)}
                  </span>
                )}
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
        {full && <span className="field__hint">{waypointLimitText()}</span>}
      </div>
      <p className="visually-hidden" role="status">
        {announce}
      </p>
    </fieldset>
  );
}
