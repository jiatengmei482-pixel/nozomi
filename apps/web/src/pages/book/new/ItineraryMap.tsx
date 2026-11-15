/**
 * 包车行程地图（M9P-20 P1，ADR 0096 第二节）：后端代调谷歌静态地图，标记按行程顺序编号（1 = 上车、经停依次、最后 = 下车），
 * 和旁边的行程列表同一个编号函数。主站 `/book/new` 和嵌入页 `/embed/book` 共用。
 * - 浏览器只连本站 `/site/v1/itinerary-map`；按框的实际宽高和像素比要图，亮色、暗色分别要；
 * - **没有后备底图**：图出不来（任何原因）就不显示地图，只留行程列表（列表本来就有全部信息）；不加载 Leaflet；
 * - 换顺序、换点时：顺序停止变化 `ITINERARY_MAP_SETTLE_MS` 后才要新图，等新图期间旧图上盖一层「路线更新中」，
 *   免得旧编号和新列表对不上；新图出不来时整张图收起（换下一组点时再试）；
 * - 图是 `<img>`，alt 写全程摘要（各点编号和名称、总时长和公里），读屏不靠图也能知道全程。
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type SitePoint, siteItineraryMapUrl } from "../../../api/site.ts";
import { routeMapSize } from "../../../lib/book-new.ts";
import { useColorScheme } from "../../../theme/use-color-scheme.ts";

/** 顺序停止变化多久以后才要新图（毫秒）：拖动、连按上移下移时不每一步都出一张图 */
export const ITINERARY_MAP_SETTLE = { ms: 800 };
/** 图一直没出来（既没加载完也没报错）多久以后放弃，只留列表 */
export const ITINERARY_MAP_TIMEOUT_MS = 15_000;

interface Props {
  /** 按行程顺序：上车、经停、下车 */
  points: readonly SitePoint[];
  /** 全程摘要（`itineraryMapAlt`） */
  alt: string;
}

type Size = ReturnType<typeof routeMapSize>;
interface Shown {
  url: string;
  alt: string;
}

const pointsKey = (points: readonly SitePoint[]): string => points.map((point) => `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`).join(";");

export function ItineraryMap({ points, alt }: Props) {
  const scheme = useColorScheme();
  const frameRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size | null>(null);
  const key = pointsKey(points);
  /** 现在要的那组点：第一次立即要，之后等顺序停下来 */
  const [settled, setSettled] = useState<{ key: string; points: readonly SitePoint[] }>({ key, points });
  /** 已经显示出来的图（和它的 alt） */
  const [shown, setShown] = useState<Shown | null>(null);
  const [failed, setFailed] = useState(false);
  const latest = useRef({ points, alt });
  latest.current = { points, alt };

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (frame === null) return;
    const measure = (): void => {
      const next = routeMapSize(frame.clientWidth, frame.clientHeight, window.devicePixelRatio || 1);
      setSize((previous) => (previous !== null && previous.width === next.width && previous.height === next.height && previous.scale === next.scale ? previous : next));
    };
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [failed]);

  // 换了一组点（停下来以后）：上一组出不来不代表这一组也出不来，再试一次
  useEffect(() => setFailed(false), [settled.key]);

  useEffect(() => {
    if (key === settled.key) return;
    const timer = setTimeout(() => setSettled({ key, points: latest.current.points }), ITINERARY_MAP_SETTLE.ms);
    return () => clearTimeout(timer);
  }, [key, settled.key]);

  const url = size === null ? null : siteItineraryMapUrl({ points: settled.points, theme: scheme, ...size });
  const pending = url !== null && shown?.url !== url;
  const updating = key !== settled.key || pending;

  useEffect(() => {
    if (!pending || failed) return;
    const timer = setTimeout(() => setFailed(true), ITINERARY_MAP_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [pending, failed, url]);

  if (failed) return null;
  // 显示的图就是现在这组点时，alt 用最新的摘要（报价回来后带上总时长和公里）
  const imageAlt = shown !== null && !updating ? alt : (shown?.alt ?? alt);
  return (
    <div className="itinerary-map">
      <div ref={frameRef} className={shown === null ? "itinerary-map__canvas route-map__canvas--loading" : updating ? "itinerary-map__canvas itinerary-map__canvas--updating" : "itinerary-map__canvas"} aria-hidden={shown === null ? true : undefined} aria-busy={updating ? true : undefined}>
        {shown !== null && <img className="route-map__image" src={shown.url} alt={imageAlt} width={size?.width} height={size?.height} decoding="async" draggable={false} />}
        {/* 新图先在看不见的地方加载，好了再换上；加载失败（任何原因）整张图收起，只留列表 */}
        {pending && url !== null && (
          <img
            key={url}
            className="itinerary-map__loader"
            src={url}
            alt=""
            aria-hidden="true"
            decoding="async"
            onLoad={() => {
              setShown({ url, alt: latest.current.alt });
            }}
            onError={() => setFailed(true)}
          />
        )}
        {shown !== null && updating && (
          <div className="itinerary-map__updating" role="status">
            路线更新中
          </div>
        )}
      </div>
    </div>
  );
}
