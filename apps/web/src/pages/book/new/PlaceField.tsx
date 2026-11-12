/**
 * 新预订页的一个地址框（M8-03，ADR 0069「B1 + B11 → A」；规范 site-booking-v2.md 3.3）：输入即提示。
 * - 至少 2 个字（`placeQueryIssue`）才查，停顿 300 毫秒再查；一次「输入 → 选中」用同一个会话令牌（谷歌按会话计费），选中后换新的；
 * - 后端给的平台地点（机场、车站，带坐标）在前，谷歌的候选在后（选中后取坐标和类型）；谷歌用不了时只有平台地点，状态行说明；
 * - 无障碍和组合框（`components/Combobox.tsx`）同一套：`role="combobox"`、↑↓ 移动高亮、Enter 选中、Esc 收起，`aria-activedescendant`；
 *   正在查、没找到、用不了这些话放在输入框下面的状态行（`role="status"`），不放进候选列表；
 * - 后备：有底图时「在地图上选点」（现有的地图选点组件），选中后查这个位置的地址当名称。
 * - 手机（< 480px，M8-37）：候选紧贴输入框下面，不用组合框通用的「从屏幕底部升起」的面板——手机键盘弹出时页面不变矮，贴底的面板整个在键盘后面，
 *   客人只看到「找到 N 个地点」却看不到列表。打开时键盘上面放不下就把输入框滚到可见区域上方，列表高度按键盘上面剩下的空间（`visualViewport`）算。
 * 浏览器只连 `/site/v1`，不连谷歌（ADR 0044）。
 */
import { type CityCandidate, normalizePlaceQuery, placeQueryIssue, serviceCityOf } from "@nozomi/domain";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { ApiError } from "../../../api/client.ts";
import type { MapTiles } from "../../../api/areas.ts";
import { type SitePlaceSuggestion, autocompleteSitePlaces, getSitePlaceDetails, reverseSitePlace } from "../../../api/site.ts";
import { Button } from "../../../components/Button.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { type TripPoint, pointName } from "../../../lib/book-new.ts";
import { addressText } from "../AddressFields.tsx";
import { type LatLngValue, SiteMapPicker } from "../SiteMapPicker.tsx";

/** 停顿多久再查（毫秒）：每输入一个字都查会白花钱。 */
export const AUTOCOMPLETE_DEBOUNCE_MS = 300;

/** 手机宽度：正好是 data.css 里组合框面板 `min-width: 480px` 的反面（book-new.css 用同一句），候选紧贴输入框，见文件头 M8-37。 */
const PHONE_QUERY = "not all and (min-width: 480px)";
/** 手指操作（手机、平板）：点候选时输入框可能先失焦、没有新的焦点 */
const COARSE_QUERY = "(pointer: coarse)";

function mediaMatches(query: string): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}
/** 候选列表离可见区域底边（手机键盘上沿）留的空隙；列表最大高度按 40px 一档取整，最少 120（约两个候选）、最多 320（和电脑一样） */
const PANEL_GAP_PX = 8;
const PANEL_MIN_PX = 120;
const PANEL_MAX_PX = 320;
const PANEL_STEP_PX = 40;
/** 键盘上面至少要放得下这么高的列表，不够就把输入框滚到上面 */
const PANEL_WANTED_PX = 240;

/** 可见区域（键盘上面那一块）在页面视口里的上下沿；没有 `visualViewport` 时就是整个视口。 */
function visibleArea(): { top: number; bottom: number } {
  const view = window.visualViewport;
  return view ? { top: view.offsetTop, bottom: view.offsetTop + view.height } : { top: 0, bottom: window.innerHeight };
}

/**
 * 手机上候选列表打开时：键盘上面放不下就把输入框滚到可见区域的上沿（让开 `scroll-margin-top`，即吸顶的摘要条），
 * 再按键盘上面剩下的高度给列表定最大高度（按 40px 一档，写在 `data-room` 上，book-new.css 按档给 max-height——组件里不写内联样式）；
 * 键盘收起、页面滚动、横竖屏切换时跟着重算（每帧最多一次）。
 * 按可见区域而不是页面视口对齐：iOS 键盘弹出时页面滚不动的话，可见区域会往下平移（`visualViewport.offsetTop > 0`）。
 * 不是手机宽度时什么都不做（电脑上不变）；打开期间变成不是手机宽度（横过来）就去掉最大高度，用回 data.css 的。
 */
function usePhonePanelFit(open: boolean, input: HTMLInputElement | null, list: HTMLUListElement | null): number | null {
  const [maxHeight, setMaxHeight] = useState<number | null>(null);
  useEffect(() => {
    if (!open || input === null || list === null) return;
    if (!mediaMatches(PHONE_QUERY)) return;
    const room = (): number => visibleArea().bottom - input.getBoundingClientRect().bottom - PANEL_GAP_PX;
    if (room() < Math.min(list.scrollHeight, PANEL_WANTED_PX)) {
      const margin = Number.parseFloat(getComputedStyle(input).scrollMarginTop) || 0;
      window.scrollBy(0, input.getBoundingClientRect().top - visibleArea().top - margin);
    }
    let frame = 0;
    const fit = (): void => {
      frame = 0;
      const fits = Math.floor(room() / PANEL_STEP_PX) * PANEL_STEP_PX;
      setMaxHeight(mediaMatches(PHONE_QUERY) ? Math.min(Math.max(fits, PANEL_MIN_PX), PANEL_MAX_PX) : null);
    };
    const schedule = (): void => {
      if (frame === 0) frame = window.requestAnimationFrame(fit);
    };
    fit();
    const view = window.visualViewport;
    view?.addEventListener("resize", schedule);
    view?.addEventListener("scroll", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      view?.removeEventListener("resize", schedule);
      view?.removeEventListener("scroll", schedule);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      setMaxHeight(null);
    };
  }, [open, input, list]);
  return maxHeight;
}

export function newSessionToken(): string {
  return crypto.randomUUID();
}

/** 候选的第二行：平台的机场、车站写种类；谷歌的写地址。 */
function suggestionDetail(item: SitePlaceSuggestion): string {
  if (item.source === "platform") return item.kind === "airport" ? "机场" : "车站";
  return item.address;
}

type Status = { kind: "idle" } | { kind: "short" } | { kind: "loading" } | { kind: "results" } | { kind: "empty" } | { kind: "notice"; text: string; warning: boolean };

const FALLBACK_MAP = "也可以在地图上选点。";

export interface PlaceFieldProps {
  label: string;
  value: TripPoint | null;
  onChange(value: TripPoint | null): void;
  error?: string;
  /** 输入框下面的帮助文字（如包车下车地点「包车结束时在哪里下车…」） */
  hint?: string;
  /** 输入框下面的信息提示（不是出错，如旧链接没有下车地点时请客人补选） */
  info?: string;
  /** 地图选点的底图；null 时没有「在地图上选点」 */
  tiles: MapTiles | null;
  /** 地图从哪里打开（另一端或第一个城市的中心） */
  mapCenter: LatLngValue | null;
  /** 地图选点后查地址用：按选的位置找最近的可订城市 */
  cities: readonly CityCandidate[];
}

export function PlaceField({ label, value, onChange, error, hint, info, tiles, mapCenter, cities }: PlaceFieldProps) {
  const id = useId();
  const listId = `${id}-list`;
  const statusId = `${id}-status`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const infoId = `${id}-info`;
  const mapId = `${id}-map`;
  const [text, setText] = useState(value?.name ?? "");
  const [items, setItems] = useState<SitePlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [mapOpen, setMapOpen] = useState(false);
  const session = useRef(newSessionToken());
  const round = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 输入框 + 候选列表：在这里面算「还在地址框里」；同一块里的地图、地图按钮不算（M8-37 审查） */
  const comboRef = useRef<HTMLDivElement>(null);
  const [inputEl, setInputEl] = useState<HTMLInputElement | null>(null);
  const [listEl, setListEl] = useState<HTMLUListElement | null>(null);
  const panelMax = usePhonePanelFit(open && items.length > 0, inputEl, listEl);

  // 值从外面变了（链接预填、地图选点、清空）：输入框跟着显示它的名称
  const shown = value?.name ?? null;
  useEffect(() => {
    if (shown !== null) setText(shown);
  }, [shown]);
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event): void => {
      if (event.target instanceof Node && !comboRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const lookup = (query: string): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    const normalized = normalizePlaceQuery(query);
    const mine = ++round.current;
    if (placeQueryIssue(normalized) !== null) {
      setItems([]);
      setOpen(false);
      setStatus(normalized === "" ? { kind: "idle" } : { kind: "short" });
      return;
    }
    timer.current = setTimeout(() => {
      setStatus({ kind: "loading" });
      autocompleteSitePlaces(normalized, session.current).then(
        (found) => {
          if (mine !== round.current) return;
          setItems(found.items);
          setActive(found.items.length > 0 ? 0 : -1);
          setOpen(found.items.length > 0);
          if (!found.available) setStatus({ kind: "notice", warning: true, text: found.items.length > 0 ? `地址提示暂时用不了，下面只有平台的机场和车站。${tiles !== null ? FALLBACK_MAP : ""}` : `地址提示暂时用不了。${tiles !== null ? "请在地图上选点，或" : "请"}输入机场、车站的名称。` });
          else setStatus(found.items.length > 0 ? { kind: "results" } : { kind: "empty" });
        },
        (err: unknown) => {
          if (mine !== round.current) return;
          setItems([]);
          setOpen(false);
          const busy = err instanceof ApiError && err.status === 429;
          setStatus({ kind: "notice", warning: true, text: `${busy ? "输入太快了，请稍等几秒再输入。" : "地址提示暂时用不了。"}${tiles !== null ? FALLBACK_MAP : ""}` });
        },
      );
    }, AUTOCOMPLETE_DEBOUNCE_MS);
  };

  const choose = async (item: SitePlaceSuggestion): Promise<void> => {
    if (timer.current !== null) clearTimeout(timer.current);
    const mine = ++round.current;
    setOpen(false);
    setActive(-1);
    const name = addressText(item.name, item.source === "google" ? item.address : null);
    setText(name);
    if (item.location !== null) {
      session.current = newSessionToken();
      setStatus({ kind: "idle" });
      onChange({ name, lat: item.location.lat, lng: item.location.lng, kind: item.kind, suggestionName: item.name });
      return;
    }
    setStatus({ kind: "loading" });
    try {
      const found = await getSitePlaceDetails(item.id, session.current);
      if (mine !== round.current) return;
      session.current = newSessionToken();
      if (found.place === null) {
        setStatus({ kind: "notice", warning: true, text: `没有取到这个地点的位置，请换一个候选。${tiles !== null ? FALLBACK_MAP : ""}` });
        return;
      }
      setStatus({ kind: "idle" });
      onChange({ name, lat: found.place.location.lat, lng: found.place.location.lng, kind: found.place.kind, suggestionName: item.name });
    } catch {
      if (mine !== round.current) return;
      session.current = newSessionToken();
      setStatus({ kind: "notice", warning: true, text: `没有取到这个地点的位置，请稍后再选一次。${tiles !== null ? FALLBACK_MAP : ""}` });
    }
  };

  const pickOnMap = async (point: LatLngValue): Promise<void> => {
    const mine = ++round.current;
    setOpen(false);
    const fallback = pointName(point.lat, point.lng);
    setText(fallback);
    onChange({ name: fallback, lat: point.lat, lng: point.lng, kind: null });
    const city = serviceCityOf(point, cities);
    if (city === null) {
      setStatus({ kind: "notice", warning: false, text: "已选好地图上的位置。" });
      return;
    }
    setStatus({ kind: "loading" });
    try {
      const found = await reverseSitePlace(city.id, point);
      if (mine !== round.current) return;
      if (found.address === null) {
        setStatus({ kind: "notice", warning: false, text: "已选好地图上的位置。" });
        return;
      }
      const name = addressText(found.address, null);
      setText(name);
      onChange({ name, lat: point.lat, lng: point.lng, kind: null });
      setStatus({ kind: "notice", warning: false, text: "已填入这个位置的地址。" });
    } catch {
      if (mine !== round.current) return;
      setStatus({ kind: "notice", warning: false, text: "已选好地图上的位置。" });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (items.length === 0) return;
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(0);
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => (current < 0 ? (step === 1 ? 0 : items.length - 1) : (current + step + items.length) % items.length));
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      const item = active >= 0 ? items[active] : undefined;
      if (item !== undefined) void choose(item);
      else setOpen(false);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  };

  let statusText = "";
  if (status.kind === "short") statusText = "请至少输入 2 个字，如酒店名、地址或机场";
  else if (status.kind === "loading") statusText = "正在查找…";
  else if (status.kind === "results") statusText = `找到 ${items.length} 个地点，用 ↑↓ 选择、回车确认。`;
  else if (status.kind === "empty") statusText = `没有找到。请换个说法（如酒店的英文名、地址）。${tiles !== null ? FALLBACK_MAP : ""}`;
  else if (status.kind === "notice") statusText = status.text;
  const warning = status.kind === "notice" && status.warning;
  const describedBy = [error !== undefined ? errorId : null, info !== undefined ? infoId : null, hint !== undefined ? hintId : null, statusText !== "" ? statusId : null].filter(Boolean).join(" ");

  return (
    <div className="place-field">
      <div className="field">
        <label className="field__label" htmlFor={id}>
          {label}
        </label>
        <div className="field__control combobox" ref={comboRef}>
          <input
            ref={setInputEl}
            id={id}
            className="input input--lg"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && active >= 0 && items[active] !== undefined ? `${id}-option-${active}` : undefined}
            aria-invalid={error !== undefined || undefined}
            aria-describedby={describedBy || undefined}
            aria-required="true"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              if (value !== null) onChange(null);
              lookup(event.target.value);
            }}
            onFocus={(event) => event.target.select()}
            onKeyDown={onKeyDown}
            onBlur={(event) => {
              const next = event.relatedTarget;
              if (next instanceof Node && comboRef.current?.contains(next)) return;
              // 手指操作时点候选，浏览器可能先让输入框失焦、却没有新的焦点（relatedTarget 为空）：这时不收，免得点不中；
              // 点别处由上面的 pointerdown 收起（M8-37）。鼠标和键盘照旧：失焦就收起（Tab 走开、切换窗口）。
              if (next === null && mediaMatches(COARSE_QUERY)) return;
              setOpen(false);
            }}
          />
          <ul ref={setListEl} id={listId} role="listbox" aria-label={`${label}的候选`} className="combobox__panel place-field__panel" hidden={!open || items.length === 0} data-room={panelMax ?? undefined} onPointerDown={(event) => event.preventDefault()}>
            {items.map((item, index) => (
              <li key={`${item.source}-${item.id}`} role="presentation">
                <div id={`${id}-option-${index}`} role="option" aria-selected={index === active} className={index === active ? "combobox__option combobox__option--active place-field__option" : "combobox__option place-field__option"} onPointerMove={() => setActive(index)} onClick={() => void choose(item)}>
                  <span className="combobox__option-label">{item.name}</span>
                  {suggestionDetail(item) !== "" && <span className="place-field__detail">{suggestionDetail(item)}</span>}
                </div>
              </li>
            ))}
          </ul>
        </div>
        {error !== undefined && (
          <ul className="field__errors" id={errorId}>
            <li className="field__error">
              <Icon name="alert-triangle" className="field__error-icon" />
              <span>{error}</span>
            </li>
          </ul>
        )}
        {info !== undefined && (
          <p id={infoId} className="site-address__status place-field__info">
            <Icon name="info" />
            {info}
          </p>
        )}
        {hint !== undefined && (
          <p className="field__hint" id={hintId}>
            {hint}
          </p>
        )}
        <p id={statusId} className={warning ? "site-address__status site-address__status--warning" : "site-address__status"} role="status">
          {warning && <Icon name="alert-triangle" />}
          {statusText}
        </p>
      </div>
      {tiles !== null && mapCenter !== null && (
        <div className="site-address__map" role="group" aria-label={`${label}的地图`}>
          <Button className="site-address__map-toggle" aria-expanded={mapOpen} aria-controls={mapId} onClick={() => setMapOpen((current) => !current)}>
            <Icon name="map" />
            {mapOpen ? "收起地图" : "在地图上选点"}
          </Button>
          <div id={mapId} hidden={!mapOpen}>
            {mapOpen && <SiteMapPicker tiles={tiles} center={mapCenter} point={value === null ? null : { lat: value.lat, lng: value.lng }} word={label} onPick={(point) => void pickOnMap(point)} />}
          </div>
        </div>
      )}
    </div>
  );
}
