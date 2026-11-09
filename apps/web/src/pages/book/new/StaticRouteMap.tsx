/**
 * 右侧栏的路线小地图（M8-10）：后端代调谷歌静态地图（灰色底图、品牌色路线和起终点），浏览器只连本站 `/site/v1/route-map`。
 * - 按地图框实际的宽高（取整、收进接口范围）和屏幕像素比（1 或 2）要图；亮色、暗色分别要，切换主题时换图；
 * - 加载中是和地图一样大的骨架（尺寸不跳）；图是纯展示，alt 就是「路线图：A → B，约 X 分钟 · Y 公里」；图底部谷歌自带的标志和版权不裁、不盖；
 * - 图没出来时再问一次原因：平台还没开通（NOT_ENABLED）→ 现有底图画路线（RouteMap.tsx）；其他任何失败 → 不显示地图，只留下面那行「约 X 分钟 · Y 公里」，不报错。
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MapTiles } from "../../../api/areas.ts";
import { type SitePoint, siteRouteMapNotEnabled, siteRouteMapUrl } from "../../../api/site.ts";
import { routeMapSize } from "../../../lib/book-new.ts";
import { type ColorScheme, useColorScheme } from "../../../theme/use-color-scheme.ts";
import { RouteMap } from "./RouteMap.tsx";

/** 图一直没出来（既没加载完也没报错）多久以后放弃，只留文字。 */
export const ROUTE_MAP_TIMEOUT_MS = 15_000;

interface Props {
  from: SitePoint;
  to: SitePoint;
  /** 后端给的路线折线（解码后）；只有后备的底图用 */
  points: readonly SitePoint[];
  /** 现有底图（后备）；null 时没开通谷歌静态地图就不显示地图 */
  tiles: MapTiles | null;
  label: string;
}

export function RoutePicture(props: Props) {
  const scheme = useColorScheme();
  const key = `${props.from.lat},${props.from.lng};${props.to.lat},${props.to.lng};${scheme}`;
  return <StaticRouteMap key={key} {...props} scheme={scheme} />;
}

type Phase = "loading" | "ready" | "fallback" | "none";
type Size = ReturnType<typeof routeMapSize>;

function StaticRouteMap({ from, to, points, tiles, label, scheme }: Props & { scheme: ColorScheme }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const alive = useRef(true);

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
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const url = size === null ? null : siteRouteMapUrl({ from, to, theme: scheme, ...size });

  useEffect(() => {
    if (phase !== "loading" || url === null) return;
    const timer = setTimeout(() => setPhase("none"), ROUTE_MAP_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [phase, url]);

  const failed = (failedUrl: string): void => {
    void siteRouteMapNotEnabled(failedUrl).then((notEnabled) => {
      if (alive.current) setPhase(notEnabled && tiles !== null && points.length >= 2 ? "fallback" : "none");
    });
  };

  if (phase === "none") return null;
  if (phase === "fallback" && tiles !== null) return <RouteMap tiles={tiles} points={points} label={label} />;
  const loading = phase !== "ready";
  return (
    <div className="route-map">
      <div ref={frameRef} className={loading ? "route-map__canvas route-map__canvas--loading" : "route-map__canvas"} aria-hidden={loading ? true : undefined}>
        {url !== null && (
          <img
            className="route-map__image"
            src={url}
            alt={label}
            width={size?.width}
            height={size?.height}
            decoding="async"
            draggable={false}
            onLoad={() => setPhase("ready")}
            onError={() => failed(url)}
          />
        )}
      </div>
    </div>
  );
}
