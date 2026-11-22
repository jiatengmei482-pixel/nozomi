/**
 * 共享库里一个区域的形状预览（M8-46，ADR 0083）：引用前先在地图上看形状。只看不改。
 *
 * 形状取 `GET /tenant/v1/shared-areas/{id}`（只有名称和图形，不带创建者和价格），底图取 `/tenant/v1/map/config`；
 * 画法同区域地图（tenant-areas.md 第 19.3 节，用同一个 `AreaOverviewMap`）。底图没有配置时只说块数，不画地图。
 */
import { Suspense, lazy } from "react";
import { type MapConfig, type SharedArea, type SharedAreaDetail, fetchMapConfig, getSharedArea } from "../../api/areas.ts";
import { Button } from "../../components/Button.tsx";
import { Skeleton } from "../../components/States.tsx";
import { areaRing } from "../../lib/area-overview.ts";
import { displayName } from "../../lib/master-display.ts";
import { useLoad } from "../../lib/use-load.ts";
import type { AreaOverviewMapProps, OverviewArea } from "./AreaOverviewMap.tsx";
/** 地图按需加载（同 AreaMapDialog）：Leaflet 单独成包，打开预览时才下载 */
const AreaOverviewMap = lazy(() => import("./AreaOverviewMap.tsx").then((module) => ({ default: module.AreaOverviewMap })));

export interface SharedAreaPreviewProps {
  area: SharedArea;
  /** 测试、换底图用 */
  surfaceFactory?: AreaOverviewMapProps["surfaceFactory"];
}

/** 块数一句话：「营运区 1 块」「营运区 2 块 · 禁行区 1 块」。 */
export function sharedAreaPieces(area: Pick<SharedArea, "operate_polygon_count" | "forbid_polygon_count">): string {
  return `营运区 ${area.operate_polygon_count} 块${area.forbid_polygon_count > 0 ? ` · 禁行区 ${area.forbid_polygon_count} 块` : ""}`;
}

/** 预览用的一个区域：颜色固定第 0 种（预览里只有它一个），用途不显示（共享库不共享用途），画成实线。 */
export function previewArea(detail: SharedAreaDetail): OverviewArea {
  return {
    id: detail.id,
    name: displayName(detail.name).text,
    slot: 0,
    active: true,
    polygons: detail.polygons.map((polygon, index) => ({ id: `${detail.id}-${index}`, kind: polygon.kind, ring: areaRing(polygon.geometry) })),
  };
}

export function SharedAreaPreview({ area, surfaceFactory }: SharedAreaPreviewProps) {
  const detail = useLoad<SharedAreaDetail>(`shared-area:${area.id}`, (token) => getSharedArea(token, area.id));
  const mapConfig = useLoad<MapConfig>("map-config:tenant", fetchMapConfig);
  const name = displayName(area.name).text;
  // 换了一个区域、新的还没取回来时，useLoad 留着上一个的形状：不能当成这一个画
  const shape = detail.state.data !== null && detail.state.data.id.toLowerCase() === area.id.toLowerCase() ? detail.state.data : null;
  const tiles = mapConfig.state.data?.tiles ?? null;

  if (detail.state.status === "not-found") {
    return <p className="shared-area__preview-note">这个区域已经不在共享库里了（可能被停用），请换一个。</p>;
  }
  if (shape === null && detail.state.status === "error") {
    return (
      <div className="shared-area__preview-note">
        <p>「{name}」的形状没有加载出来。请检查网络后重试。</p>
        <Button size="sm" onClick={detail.reload}>
          重试
        </Button>
      </div>
    );
  }
  if (shape === null || (mapConfig.state.data === null && mapConfig.state.status === "loading")) {
    return <Skeleton lines={["long", "long", "medium"]} label={`正在加载「${name}」的形状`} />;
  }
  if (tiles === null) {
    return (
      <p className="shared-area__preview-note">
        {mapConfig.state.status === "ready" ? "这个环境没有配置地图底图，看不到形状。" : "地图没有加载出来，看不到形状。"}
        {`「${name}」：${sharedAreaPieces(shape)}。`}
      </p>
    );
  }
  return (
    <div className="shared-area__map">
      <Suspense fallback={<Skeleton lines={["long", "long", "medium"]} label="正在加载地图" />}>
        <AreaOverviewMap
          key={shape.id}
          tiles={tiles}
          areas={[previewArea(shape)]}
          selected={shape.id}
          onSelect={() => undefined}
          overlaps={[]}
          showOverlaps={false}
          focusSignal={0}
          marker={null}
          label={`「${name}」的形状`}
          {...(surfaceFactory ? { surfaceFactory } : {})}
        />
      </Suspense>
    </div>
  );
}
