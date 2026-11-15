/**
 * 包车行程地图（M9P-20 P1，ADR 0096 第二节）：后端代调谷歌静态地图，标记按行程顺序编号（1 = 上车、经停依次、最后 = 下车），
 * 和旁边的行程列表同一个编号函数。主站 `/book/new` 和嵌入页 `/embed/book` 共用。
 * - 浏览器只连本站 `/site/v1/itinerary-map`；按框的宽高（按 `ITINERARY_MAP_SIZE_STEP` 分档，框宽一点点变化不换图）和像素比要图，亮色、暗色分别要；
 * - **没有后备底图**：图出不来就不显示地图，只留行程列表（列表本来就有全部信息）；不加载 Leaflet；
 * - 换顺序、换点、换主题、框的尺寸换了档：停止变化 `ITINERARY_MAP_SETTLE` 后才要新图（每一次新图都可能是一次谷歌调用），
 *   等新图期间旧图上盖一层「路线更新中」，免得旧编号和新列表对不上；
 * - 新图出不来：是「太频繁」（429）就过一会儿（应答给的秒数，最多 `ITINERARY_MAP_RETRY.maxSeconds`）再试，最多 `ITINERARY_MAP_RETRY.times` 次；
 *   其他原因整张图收起（换下一组点时再试）；
 * - 图是 `<img>`，alt 写全程摘要（各点编号和名称、总时长和公里），读屏不靠图也能知道全程。
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type SitePoint, siteItineraryMapUrl, siteMapRetryAfterSeconds } from "../../../api/site.ts";
import { routeMapSize } from "../../../lib/book-new.ts";
import { itineraryCopy } from "../../../lib/itinerary-texts.ts";
import { useColorScheme } from "../../../theme/use-color-scheme.ts";

/** 停止变化多久以后才要新图（毫秒）：拖动、连按上移下移、拖窗口大小时不每一步都出一张图 */
export const ITINERARY_MAP_SETTLE = { ms: 800 };
/** 图一直没出来（既没加载完也没报错）多久以后放弃，只留列表 */
export const ITINERARY_MAP_TIMEOUT_MS = 15_000;
/** 「太频繁」以后再试：最多几次、每次最多等多少秒；`scale` 只给测试把等待缩短 */
export const ITINERARY_MAP_RETRY = { times: 2, maxSeconds: 120, scale: 1_000 };
/** 图的宽高按这么多像素分档（向下取整，不小于接口下限）：框宽差几个像素用同一张图（同一个缓存键） */
export const ITINERARY_MAP_SIZE_STEP = 40;

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

/** 框的实际宽高 → 要图的宽高：按 `ITINERARY_MAP_SIZE_STEP` 向下分档，再收进接口范围（`routeMapSize`）。 */
export function itineraryMapSize(width: number, height: number, devicePixelRatio: number): Size {
  const bucket = (value: number): number => (Number.isFinite(value) ? Math.floor(value / ITINERARY_MAP_SIZE_STEP) * ITINERARY_MAP_SIZE_STEP : value);
  return routeMapSize(bucket(width), bucket(height), devicePixelRatio);
}

export function ItineraryMap({ points, alt }: Props) {
  const scheme = useColorScheme();
  const frameRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size | null>(null);
  /** 现在想要的那张图（点、主题、尺寸都算进去）；第一次立即要，之后等停下来 */
  const wanted = size === null ? null : siteItineraryMapUrl({ points, theme: scheme, ...size });
  const [settled, setSettled] = useState<string | null>(null);
  /** 已经显示出来的图（和它的 alt） */
  const [shown, setShown] = useState<Shown | null>(null);
  const [failed, setFailed] = useState(false);
  /** 「太频繁」以后的第几次再试；`waiting` 为 true 时正在等 */
  const [retry, setRetry] = useState({ attempt: 0, waiting: false });
  const latestAlt = useRef(alt);
  latestAlt.current = alt;
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (frame === null) return;
    const measure = (): void => {
      const next = itineraryMapSize(frame.clientWidth, frame.clientHeight, window.devicePixelRatio || 1);
      setSize((previous) => (previous !== null && previous.width === next.width && previous.height === next.height && previous.scale === next.scale ? previous : next));
    };
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [failed]);

  useEffect(() => {
    if (wanted === null || wanted === settled) return;
    if (settled === null) {
      setSettled(wanted);
      return;
    }
    const timer = setTimeout(() => setSettled(wanted), ITINERARY_MAP_SETTLE.ms);
    return () => clearTimeout(timer);
  }, [wanted, settled]);

  // 换了一组点（停下来以后）：上一组出不来不代表这一组也出不来，再试一次
  const settledPoints = settled === null ? null : new URL(settled, "http://localhost").searchParams.getAll("p").join(";");
  useEffect(() => {
    setFailed(false);
    setRetry({ attempt: 0, waiting: false });
  }, [settledPoints]);

  const url = settled;
  const pending = url !== null && shown?.url !== url;
  const updating = wanted !== settled || pending;

  useEffect(() => {
    if (!pending || failed || retry.waiting) return;
    const timer = setTimeout(() => setFailed(true), ITINERARY_MAP_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [pending, failed, url, retry]);

  const onError = (failedUrl: string): void => {
    if (retry.attempt >= ITINERARY_MAP_RETRY.times) {
      setFailed(true);
      return;
    }
    setRetry((current) => ({ ...current, waiting: true }));
    void siteMapRetryAfterSeconds(failedUrl).then((seconds) => {
      if (!alive.current) return;
      if (seconds === null) {
        setFailed(true);
        return;
      }
      setTimeout(
        () => {
          if (alive.current) setRetry((current) => ({ attempt: current.attempt + 1, waiting: false }));
        },
        Math.min(seconds, ITINERARY_MAP_RETRY.maxSeconds) * ITINERARY_MAP_RETRY.scale,
      );
    });
  };

  if (failed || (shown === null && retry.waiting)) return failed ? null : <div ref={frameRef} className="itinerary-map__canvas route-map__canvas--loading" aria-hidden="true" />;
  // 显示的图就是现在这组点时，alt 用最新的摘要（报价回来后带上总时长和公里）
  const imageAlt = shown !== null && !updating ? alt : (shown?.alt ?? alt);
  return (
    <div className="itinerary-map">
      <div ref={frameRef} className={shown === null ? "itinerary-map__canvas route-map__canvas--loading" : updating ? "itinerary-map__canvas itinerary-map__canvas--updating" : "itinerary-map__canvas"} aria-hidden={shown === null ? true : undefined} aria-busy={updating ? true : undefined}>
        {shown !== null && <img className="route-map__image" src={shown.url} alt={imageAlt} width={size?.width} height={size?.height} decoding="async" draggable={false} />}
        {/* 新图先在看不见的地方加载，好了再换上 */}
        {pending && url !== null && !retry.waiting && (
          <img
            key={`${url}#${retry.attempt}`}
            className="itinerary-map__loader"
            src={url}
            alt=""
            aria-hidden="true"
            decoding="async"
            onLoad={() => setShown({ url, alt: latestAlt.current })}
            onError={() => onError(url)}
          />
        )}
        {shown !== null && updating && (
          <div className="itinerary-map__updating" role="status">
            {itineraryCopy("updating")}
          </div>
        )}
      </div>
    </div>
  );
}
