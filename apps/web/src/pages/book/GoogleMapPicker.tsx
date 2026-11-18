/**
 * 官网的地图选点：谷歌地图（M10-01 第 2 处，业主 2026-11-18 选 A；ADR 0044 补记）。
 *
 * 谷歌地图放在同源的小页面 `/maps/picker.html` 里（iframe），只有那一页的内容安全策略放行谷歌地图脚本，下单、付款页面的策略不变。
 * 两边用 postMessage 说话，只认同源、只认这个 iframe 发来的、带 `source: "nozomi-map"` 的消息：
 * - 小页面 → 这里：`ready`、`failed`、`pick { lat, lng }`；
 * - 这里 → 小页面：`point { lat, lng }`（坐标从外面变了）、`pick-center`（「选地图中间这个位置」）。
 * 地图在限定时间内没出来（中国大陆连不上谷歌、密钥被拒）就算用不了：调 `onUnavailable`，由外面收起地图、改提示用搜索或手写地址。
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/Button.tsx";
import { Icon } from "../../components/Icon.tsx";
import { roundLatLng } from "../../lib/lat-lng.ts";
import type { LatLngValue } from "../../lib/lat-lng.ts";

export const MAPS_PICKER_SRC = "/maps/picker.html";
/** 打开后多久还没出地图就算用不了（大陆网络下谷歌的脚本常常既不成功也不报错，只能靠超时） */
export const MAPS_PICKER_TIMEOUT_MS = 10_000;
const SOURCE = "nozomi-map";

export interface GoogleMapPickerProps {
  /** 浏览器密钥（运营后台「官网设置」） */
  apiKey: string;
  /** 还没有选点时地图看哪里（城市中心） */
  center: LatLngValue;
  point: LatLngValue | null;
  /** 「上车」「下车」：说明和按钮的文字 */
  word: string;
  onPick(point: LatLngValue): void;
  onUnavailable(): void;
}

export function mapsPickerUrl(apiKey: string, center: LatLngValue, point: LatLngValue | null): string {
  const query = new URLSearchParams({ key: apiKey, lat: String(center.lat), lng: String(center.lng) });
  if (point !== null) {
    query.set("plat", String(point.lat));
    query.set("plng", String(point.lng));
  }
  return `${MAPS_PICKER_SRC}?${query.toString()}`;
}

export function GoogleMapPicker({ apiKey, center, point, word, onPick, onUnavailable }: GoogleMapPickerProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const latest = useRef({ onPick, onUnavailable });
  latest.current = { onPick, onUnavailable };
  // 地址只在打开时算一次：之后坐标变了发消息，不重新加载地图
  const [src] = useState(() => mapsPickerUrl(apiKey, center, point));

  useEffect(() => {
    let settled = false;
    const give = (): void => {
      if (settled) return;
      settled = true;
      latest.current.onUnavailable();
    };
    const timer = window.setTimeout(give, MAPS_PICKER_TIMEOUT_MS);
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return;
      const data: unknown = event.data;
      if (typeof data !== "object" || data === null || (data as { source?: unknown }).source !== SOURCE) return;
      const message = data as { type?: unknown; lat?: unknown; lng?: unknown };
      if (message.type === "ready") {
        settled = true;
        window.clearTimeout(timer);
        setReady(true);
      } else if (message.type === "failed") {
        window.clearTimeout(timer);
        give();
      } else if (message.type === "pick" && typeof message.lat === "number" && typeof message.lng === "number" && Number.isFinite(message.lat) && Number.isFinite(message.lng)) {
        latest.current.onPick(roundLatLng({ lat: message.lat, lng: message.lng }));
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    };
  }, []);

  const send = (message: Record<string, unknown>): void => {
    frameRef.current?.contentWindow?.postMessage({ source: SOURCE, ...message }, window.location.origin);
  };

  // 坐标从外面变了（搜索选中、常用地点）：标记移过去
  const pointKey = point === null ? "" : `${point.lat},${point.lng}`;
  useEffect(() => {
    if (ready && point !== null) send({ type: "point", lat: point.lat, lng: point.lng });
  }, [ready, pointKey]);

  return (
    <div className="site-map">
      <div className="site-map__frame">
        <iframe ref={frameRef} className="site-map__canvas site-map__canvas--google" src={src} title={`地图：点一下选${word}位置，或拖动标记；也可以用方向键移动地图，再按地图下面的「选地图中间这个位置」`} referrerPolicy="strict-origin" />
        {!ready && <p className="site-map__loading">地图加载中…</p>}
      </div>
      <Button size="lg" disabled={!ready} onClick={() => send({ type: "pick-center" })}>
        <Icon name="target" />
        选地图中间这个位置
      </Button>
    </div>
  );
}
