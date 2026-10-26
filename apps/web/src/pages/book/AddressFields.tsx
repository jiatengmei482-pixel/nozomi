/**
 * 官网询价页的一个地点（M3-10 常用地点；M3-12 加上地址搜索和地图选点，ADR 0044；规范 site-booking.md 3.6）。从上到下：
 * 1. 搜索（选填）：关键字 → 后端代调谷歌给的候选，选一个就填好名称、地址和坐标。配置里没有地址搜索时不显示；用不了时说明并退回下面几种；
 * 2. 从常用地点选（选填）：城市的机场、车站、地标（平台主数据，不依赖谷歌）；
 * 3. 地址或酒店名、坐标：客人可以自己写、粘贴；
 * 4. 在地图上选（选填，有底图才有）：点地图、拖标记、或用键盘移动地图后选中间的位置 → 坐标填好，再查这个位置的地址填进地址栏。
 * 报价只看坐标；地址文字给司机看。之后手改地址或坐标，「选中的常用地点」随之清掉。
 */
import { ORDER_FIELD_LIMITS, normalizePlaceQuery, placeQueryIssue } from "@nozomi/domain";
import { type KeyboardEvent, useId, useRef, useState } from "react";
import { ApiError } from "../../api/client.ts";
import type { MapTiles } from "../../api/areas.ts";
import { type SitePlace, type SitePlaceCandidate, reverseSitePlace, searchSitePlaces } from "../../api/site.ts";
import { Button } from "../../components/Button.tsx";
import { Combobox, type ComboboxOption } from "../../components/Combobox.tsx";
import { type CoordinateValue, CoordinateInput } from "../../components/FormFields.tsx";
import { Icon } from "../../components/Icon.tsx";
import { TextField } from "../../components/TextField.tsx";
import { displayName } from "../../lib/master-display.ts";
import { placeQueryMatches } from "../../lib/place-search.ts";
import { SITE_PLACE_TYPE_NAMES } from "../../lib/site-display.ts";
import { type LatLngValue, SiteMapPicker } from "./SiteMapPicker.tsx";

export interface PointDraft {
  address: string;
  coordinates: CoordinateValue;
  /** 从常用地点里选的那一个；手改了地址或坐标就清掉 */
  placeId: string | null;
}

export const emptyPoint = (): PointDraft => ({ address: "", coordinates: { lat: "", lng: "" }, placeId: null });

export type PlacesState = { kind: "loading" } | { kind: "failed" } | { kind: "ready"; items: SitePlace[] };

export interface PointErrors {
  address?: string;
  lat?: string;
  lng?: string;
}

/** 地址搜索、地图选点要的东西：城市（编号、名称、中心）、配置里有没有地址搜索、底图。没选城市时为 null（只有常用地点和手填）。 */
export interface AddressLookup {
  cityId: string;
  cityName: string;
  center: LatLngValue;
  search: boolean;
  tiles: MapTiles | null;
}

/**
 * 地址栏里写什么：名称，有地址时带上地址「名称（地址）」。
 * 不超过下单允许的地址长度（`ORDER_FIELD_LIMITS.addressMax`，按字符数，和后端同口径）：放不下时截短地址、末尾加「…」，名称总是留着。
 */
export function addressText(nameText: string, detail: string | null): string {
  const max = ORDER_FIELD_LIMITS.addressMax;
  const name = [...nameText.trim()];
  if (name.length >= max) return name.slice(0, max).join("");
  const address = [...(detail ?? "").trim()];
  if (address.length === 0 || address.join("") === name.join("")) return name.join("");
  // 名称 +「（」+ 地址 +「）」
  const room = max - name.length - 2;
  if (room < 2) return name.join("");
  const shown = address.length <= room ? address.join("") : `${address.slice(0, room - 1).join("")}…`;
  return `${name.join("")}（${shown}）`;
}

/** 选中一个常用地点后地址栏里写什么。 */
export function placeAddress(place: SitePlace): string {
  return addressText(displayName(place.name).text, place.address);
}

export function placeOptions(places: readonly SitePlace[]): ComboboxOption[] {
  return places.map((place) => ({
    value: place.id,
    label: displayName(place.name).text,
    detail: place.type === "airport" ? place.code : SITE_PLACE_TYPE_NAMES[place.type],
    keywords: [...Object.values(place.name), place.code, place.address ?? ""].join(" "),
    group: SITE_PLACE_TYPE_NAMES[place.type],
  }));
}

/** 坐标栏里的文字 → 坐标；不完整或不合法为 null。 */
function pointOfDraft(coordinates: CoordinateValue): LatLngValue | null {
  const lat = Number(coordinates.lat.trim());
  const lng = Number(coordinates.lng.trim());
  if (coordinates.lat.trim() === "" || coordinates.lng.trim() === "" || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

const coordinatesOf = (point: LatLngValue): CoordinateValue => ({ lat: String(point.lat), lng: String(point.lng) });

/** 限速（429）时等多久的说法；不是限速为 null。 */
function waitText(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 429) return null;
  const seconds = err.retryAfterSeconds;
  if (seconds === null || seconds <= 0) return "一会儿";
  return seconds >= 120 ? `${Math.ceil(seconds / 60)} 分钟` : `${Math.ceil(seconds)} 秒`;
}

type SearchState =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "results"; items: SitePlaceCandidate[] }
  | { kind: "empty" }
  | { kind: "unavailable"; text: string }
  | { kind: "picked"; name: string };

const FALLBACK = "可以从常用地点选，或在地图上点选、直接填写地址和坐标。";

/** 地址搜索：按「搜索」或回车才查（每次都可能花钱），结果是一列按钮。 */
function AddressSearch({ word, lookup, onPick }: { word: string; lookup: AddressLookup; onPick(candidate: SitePlaceCandidate): void }) {
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<SearchState>({ kind: "idle" });
  const round = useRef(0);

  const run = async (): Promise<void> => {
    const normalized = normalizePlaceQuery(query);
    const issue = placeQueryIssue(normalized);
    if (issue !== null) {
      setError(issue === "TOO_SHORT" ? "请至少输入 2 个字，如酒店名、地址或地标" : "关键字太长了，最多 100 个字");
      return;
    }
    setError(null);
    const mine = ++round.current;
    setState({ kind: "searching" });
    try {
      const found = await searchSitePlaces(lookup.cityId, normalized);
      if (mine !== round.current) return;
      if (!found.available) setState({ kind: "unavailable", text: `地址搜索暂时用不了。${FALLBACK}` });
      else setState(found.items.length === 0 ? { kind: "empty" } : { kind: "results", items: found.items });
    } catch (err) {
      if (mine !== round.current) return;
      const wait = waitText(err);
      setState({ kind: "unavailable", text: wait !== null ? `搜索太频繁了，请 ${wait}后再搜。现在也${FALLBACK}` : `地址搜索暂时用不了。${FALLBACK}` });
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    // 回车是「搜索」，不提交整张询价表单
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void run();
  };

  let status = "";
  if (state.kind === "searching") status = "正在搜索…";
  else if (state.kind === "results") status = `找到 ${state.items.length} 个地点，选一个就会填好地址和坐标。`;
  else if (state.kind === "empty") status = `${lookup.cityName}附近没有找到。请换个说法（如酒店的英文名、地址），或者${FALLBACK}`;
  else if (state.kind === "unavailable") status = state.text;
  else if (state.kind === "picked") status = `已填入「${state.name}」的地址和坐标，可以在地址后面补充楼层、房间号。`;

  return (
    <div className="site-address-search">
      <div className="site-address-search__row">
        <TextField
          className="site-address-search__field"
          label={`搜索${word}地点（选填）`}
          size="lg"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          value={query}
          errors={error !== null ? [error] : []}
          hint={`输入酒店名、地址或地标，按「搜索」在${lookup.cityName}附近查找`}
          onChange={(event) => {
            setQuery(event.target.value);
            if (error !== null) setError(null);
          }}
          onKeyDown={onKeyDown}
        />
        <Button size="lg" className="site-address-search__button" loading={state.kind === "searching"} loadingText="正在搜索" onClick={() => void run()}>
          <Icon name="search" />
          搜索
        </Button>
      </div>
      <p className={state.kind === "unavailable" ? "site-address__status site-address__status--warning" : "site-address__status"} role="status">
        {state.kind === "unavailable" && <Icon name="alert-triangle" />}
        {status}
      </p>
      {state.kind === "results" && (
        <ul className="site-address-search__results" aria-label={`搜索到的${word}地点`}>
          {state.items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="site-address-search__result"
                onClick={() => {
                  onPick(item);
                  setState({ kind: "picked", name: item.name });
                }}
              >
                <span className="site-address-search__name">{item.name}</span>
                {item.address !== "" && <span className="site-address-search__address">{item.address}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type ReverseState = { kind: "idle" } | { kind: "looking" } | { kind: "done"; text: string; warning: boolean };

export function AddressFields({
  end,
  label,
  value,
  errors,
  places,
  lookup = null,
  onChange,
}: {
  /** 上车点还是下车点：决定几处说法 */
  end: "pickup" | "dropoff";
  label: string;
  value: PointDraft;
  errors: PointErrors;
  places: PlacesState;
  /** 地址搜索、地图选点；没选城市时为 null */
  lookup?: AddressLookup | null;
  onChange(value: PointDraft): void;
}) {
  const word = end === "pickup" ? "上车" : "下车";
  const items = places.kind === "ready" ? places.items : [];
  // 城市里一个常用地点都没有时不显示这一栏（没什么可选的）
  const showPicker = places.kind !== "ready" || items.length > 0;
  const [mapOpen, setMapOpen] = useState(false);
  const [reverse, setReverse] = useState<ReverseState>({ kind: "idle" });
  const mapId = useId();
  // 反查是异步的：回来时用最新的值，并且只在坐标还是那一个时才填地址
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  const round = useRef(0);
  const forget = (): void => {
    round.current += 1;
    setReverse({ kind: "idle" });
  };

  const pickOnMap = async (point: LatLngValue): Promise<void> => {
    if (lookup === null) return;
    const coordinates = coordinatesOf(point);
    const picked = { ...latest.current.value, coordinates, placeId: null };
    latest.current.value = picked;
    latest.current.onChange(picked);
    const mine = ++round.current;
    setReverse({ kind: "looking" });
    const still = (): boolean => mine === round.current && latest.current.value.coordinates.lat === coordinates.lat && latest.current.value.coordinates.lng === coordinates.lng;
    const noAddress = "坐标已填好，暂时查不到这个位置的地址，请在上面写上地址或酒店名。";
    try {
      const found = await reverseSitePlace(lookup.cityId, point);
      if (!still()) return;
      if (!found.available) setReverse({ kind: "done", warning: true, text: noAddress });
      else if (found.address === null) setReverse({ kind: "done", warning: true, text: "坐标已填好，这个位置没有查到地址，请在上面写上地址或酒店名。" });
      else {
        latest.current.onChange({ ...latest.current.value, address: addressText(found.address, null), placeId: null });
        setReverse({ kind: "done", warning: false, text: "已填入这个位置的地址和坐标，可以在地址后面补充酒店名、楼层。" });
      }
    } catch (err) {
      if (!still()) return;
      const outOfCity = err instanceof ApiError && JSON.stringify(err.details).includes("OUT_OF_CITY");
      const wait = waitText(err);
      setReverse({
        kind: "done",
        warning: true,
        text: outOfCity ? `这个位置离${lookup.cityName}太远了，请在城市附近选点。` : wait !== null ? `坐标已填好。查地址太频繁了，请 ${wait}后再选点，或在上面写上地址。` : noAddress,
      });
    }
  };

  const current = pointOfDraft(value.coordinates);
  return (
    <div className="site-address">
      {lookup !== null && lookup.search && (
        <AddressSearch
          word={word}
          lookup={lookup}
          onPick={(candidate) => {
            forget();
            onChange({ address: addressText(candidate.name, candidate.address), coordinates: coordinatesOf(candidate.location), placeId: null });
          }}
        />
      )}
      {showPicker && (
        <Combobox
          label={`从常用地点选${word}地点（选填）`}
          options={placeOptions(items)}
          value={value.placeId}
          loading={places.kind === "loading"}
          loadFailed={places.kind === "failed"}
          hint={places.kind === "failed" ? "常用地点没有读出来，可以直接在下面写地址和坐标。" : "机场、车站和常用地标，选了会自动填好地址和坐标；不在列表里的直接在下面写。"}
          noMatchText={() => "没有找到，请直接在下面写地址和坐标。"}
          match={placeQueryMatches}
          onChange={(placeId) => {
            const place = items.find((entry) => entry.id === placeId);
            if (place === undefined) {
              onChange({ ...value, placeId: null });
              return;
            }
            forget();
            onChange({ address: placeAddress(place), coordinates: { lat: String(place.location.lat), lng: String(place.location.lng) }, placeId: place.id });
          }}
        />
      )}
      <TextField label={label} size="lg" required autoComplete="street-address" value={value.address} errors={errors.address ? [errors.address] : []} onChange={(event) => onChange({ ...value, address: event.target.value, placeId: null })} />
      <CoordinateInput
        legend={`${word}地点的坐标`}
        value={value.coordinates}
        errors={{ lat: errors.lat ?? null, lng: errors.lng ?? null }}
        hint={
          lookup !== null && (lookup.search || lookup.tiles !== null)
            ? "搜索、选常用地点或在地图上选点都会自动填好；也可以在手机地图里长按这个地点，整段粘贴「纬度, 经度」。用来确认地点在服务范围内。"
            : "在手机地图里长按这个地点就能看到坐标，可以整段粘贴「纬度, 经度」。用来确认地点在服务范围内。"
        }
        onChange={(coordinates) => {
          forget();
          onChange({ ...value, coordinates, placeId: null });
        }}
      />
      {lookup !== null && lookup.tiles !== null && (
        <>
          <Button className="site-address__map-toggle" size="lg" aria-expanded={mapOpen} aria-controls={mapId} onClick={() => setMapOpen((open) => !open)}>
            <Icon name="map" />
            {mapOpen ? "收起地图" : `在地图上选${word}地点`}
          </Button>
          <div id={mapId} hidden={!mapOpen}>
            {mapOpen && <SiteMapPicker tiles={lookup.tiles} center={lookup.center} point={current} word={word} onPick={(point) => void pickOnMap(point)} />}
          </div>
        </>
      )}
      {reverse.kind !== "idle" && (
        <p className={reverse.kind === "done" && reverse.warning ? "site-address__status site-address__status--warning" : "site-address__status"} role="status">
          {reverse.kind === "done" && reverse.warning && <Icon name="alert-triangle" />}
          {reverse.kind === "looking" ? "正在查找这个位置的地址…" : reverse.text}
        </p>
      )}
    </div>
  );
}
