/**
 * 官网询价页的一个地点（M3-10）：「从常用地点里选」（选填）+ 地址文字 + 坐标。
 * 常用地点是城市里的机场、车站、地标（平台的主数据，`GET /site/v1/cities/{id}/places`），不调用任何外部地图或地址搜索服务；
 * 选一个就把名称和坐标填好，客人也可以照旧自己写地址、粘贴坐标。之后手改地址或坐标，「选中的地点」随之清掉。
 */
import { ORDER_FIELD_LIMITS } from "@nozomi/domain";
import { Combobox, type ComboboxOption } from "../../components/Combobox.tsx";
import { type CoordinateValue, CoordinateInput } from "../../components/FormFields.tsx";
import { TextField } from "../../components/TextField.tsx";
import type { SitePlace } from "../../api/site.ts";
import { displayName } from "../../lib/master-display.ts";
import { placeQueryMatches } from "../../lib/place-search.ts";
import { SITE_PLACE_TYPE_NAMES } from "../../lib/site-display.ts";

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

/**
 * 选中一个常用地点后地址栏里写什么：名称，地标有地址时带上地址。
 * 不超过下单允许的地址长度（`ORDER_FIELD_LIMITS.addressMax`，按字符数，和后端同口径）：放不下时截短地址、末尾加「…」，名称总是留着。
 */
export function placeAddress(place: SitePlace): string {
  const max = ORDER_FIELD_LIMITS.addressMax;
  const name = [...displayName(place.name).text.trim()];
  if (name.length >= max) return name.slice(0, max).join("");
  const address = [...(place.address ?? "").trim()];
  if (address.length === 0) return name.join("");
  // 名称 +「（」+ 地址 +「）」
  const room = max - name.length - 2;
  if (room < 2) return name.join("");
  const shown = address.length <= room ? address.join("") : `${address.slice(0, room - 1).join("")}…`;
  return `${name.join("")}（${shown}）`;
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

export function AddressFields({
  end,
  label,
  value,
  errors,
  places,
  onChange,
}: {
  /** 上车点还是下车点：决定几处说法 */
  end: "pickup" | "dropoff";
  label: string;
  value: PointDraft;
  errors: PointErrors;
  places: PlacesState;
  onChange(value: PointDraft): void;
}) {
  const word = end === "pickup" ? "上车" : "下车";
  const items = places.kind === "ready" ? places.items : [];
  // 城市里一个常用地点都没有时不显示这一栏（没什么可选的）
  const showPicker = places.kind !== "ready" || items.length > 0;
  return (
    <>
      {showPicker && (
        <Combobox
          label={`从常用地点选${word}地点（选填）`}
          options={placeOptions(items)}
          value={value.placeId}
          loading={places.kind === "loading"}
          loadFailed={places.kind === "failed"}
          hint={places.kind === "failed" ? "常用地点没有读出来，可以直接在下面写地址和坐标。" : "输入名称查找机场、车站、酒店等，选了会自动填好地址和坐标；不在列表里的直接在下面写。"}
          noMatchText={() => "没有找到，请直接在下面写地址和坐标。"}
          match={placeQueryMatches}
          onChange={(placeId) => {
            const place = items.find((entry) => entry.id === placeId);
            if (place === undefined) {
              onChange({ ...value, placeId: null });
              return;
            }
            onChange({ address: placeAddress(place), coordinates: { lat: String(place.location.lat), lng: String(place.location.lng) }, placeId: place.id });
          }}
        />
      )}
      <TextField label={label} size="lg" required autoComplete="street-address" value={value.address} errors={errors.address ? [errors.address] : []} onChange={(event) => onChange({ ...value, address: event.target.value, placeId: null })} />
      <CoordinateInput
        legend={`${word}地点的坐标`}
        value={value.coordinates}
        errors={{ lat: errors.lat ?? null, lng: errors.lng ?? null }}
        hint="在手机地图里长按这个地点就能看到坐标，可以整段粘贴「纬度, 经度」。用来确认地点在服务范围内。"
        onChange={(coordinates) => onChange({ ...value, coordinates, placeId: null })}
      />
    </>
  );
}
