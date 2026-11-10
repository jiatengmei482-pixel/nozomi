/**
 * 「在地图上查看」（M8-18，tenant-areas.md 第 19.7 节）：把选中的几个区域画在一张地图上，看它们覆盖哪里、有没有重叠。只看不改。
 *
 * 用法（选区域的地方都可以接，例如商品的「服务区域」、价格规则里按区域定价的区域选择）：
 *
 *   <AreaMapButton areaIds={picked.map((area) => area.id)} />
 *   // 或者自己管开关：<AreaMapDialog open={open} areaIds={ids} onClose={() => setOpen(false)} />
 *
 * 供应商后台取 `/tenant/v1/area-map`（只有自己的区域）；运营后台取 `/platform/v1/area-map`，要给 `tenantId`（只看那个供应商的）。
 * 打开时才取数据；底图没有配置时只列区域和重叠，不画地图。
 */
import { useMemo, useState } from "react";
import { type AreaMapItem, type AreaMapResponse, fetchPlatformAreaMap, fetchPlatformMapConfig, fetchTenantAreaMap } from "../../api/area-map.ts";
import { type MapConfig, fetchMapConfig } from "../../api/areas.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Button } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { Icon } from "../../components/Icon.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { areaRing, colorSlot, computeOverlaps, overlapText } from "../../lib/area-overview.ts";
import { displayName } from "../../lib/master-display.ts";
import { useLoad } from "../../lib/use-load.ts";
import { AreaOverviewMap, type AreaOverviewMapProps, type OverviewArea } from "./AreaOverviewMap.tsx";

export interface AreaMapDialogProps {
  open: boolean;
  /** 要看的区域（顺序 = 列表和颜色的顺序） */
  areaIds: readonly string[];
  onClose(): void;
  title?: string;
  /** 运营后台必须给：这些区域属于哪个供应商 */
  tenantId?: string;
  /** 测试、换底图用 */
  surfaceFactory?: AreaOverviewMapProps["surfaceFactory"];
}

export function AreaMapDialog({ open, areaIds, onClose, title = "在地图上查看", tenantId, surfaceFactory }: AreaMapDialogProps) {
  const { portal } = usePortalSession();
  const platform = portal.key === "platform";
  const loaded = useLoad<AreaMapResponse<AreaMapItem>>(`area-map-dialog:${portal.key}:${tenantId ?? ""}:${open ? "open" : "closed"}`, !open ? null : platform ? (token) => fetchPlatformAreaMap(token, tenantId ? { tenant_id: tenantId } : {}) : (token) => fetchTenantAreaMap(token));
  const mapConfig = useLoad<MapConfig>(`map-config:${portal.key}`, open ? (platform ? fetchPlatformMapConfig : fetchMapConfig) : null);
  const [selected, setSelected] = useState<string | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);

  const all = loaded.state.data?.items ?? null;
  const chosen = useMemo(() => {
    const byId = new Map((all ?? []).map((item) => [item.id, item]));
    return areaIds.map((id) => byId.get(id)).filter((item): item is AreaMapItem => item !== undefined);
  }, [all, areaIds]);
  const overlaps = useMemo(() => computeOverlaps(chosen), [chosen]);
  const names = new Map(chosen.map((item) => [item.id, displayName(item.name).text]));
  const mapAreas: OverviewArea[] = chosen.map((item, index) => ({ id: item.id, name: names.get(item.id) ?? "", slot: colorSlot(index), active: item.status === "active", polygons: item.polygons.map((polygon) => ({ id: polygon.id, kind: polygon.kind, ring: areaRing(polygon.geometry) })) }));
  const missing = all === null ? 0 : areaIds.length - chosen.length;
  const tiles = mapConfig.state.data?.tiles ?? null;

  return (
    <Dialog
      open={open}
      title={title}
      size="form"
      onClose={onClose}
    >
      {all === null && loaded.state.status === "error" ? (
        <StateBlock
          title="加载失败"
          description="请检查网络后重试。"
          action={
            <Button variant="secondary" onClick={loaded.reload}>
              重试
            </Button>
          }
        />
      ) : all === null ? (
        <Skeleton lines={["long", "medium", "long"]} label="区域加载中" />
      ) : chosen.length === 0 ? (
        <StateBlock tone="neutral" title="没有可以显示的区域" description={areaIds.length === 0 ? "还没有选区域。" : "选的区域已经被删除了。"} />
      ) : (
        <div className="area-map-dialog">
          <ul className="area-overview__items area-map-dialog__list" aria-label="区域">
            {chosen.map((item, index) => {
              const others = overlaps.byArea.get(item.id) ?? [];
              return (
                <li key={item.id} className={item.id === selected ? "area-overview__item area-overview__item--selected" : "area-overview__item"}>
                  <button
                    type="button"
                    className="area-overview__pick"
                    aria-pressed={item.id === selected}
                    onClick={() => {
                      setSelected(item.id);
                      setFocusSignal((value) => value + 1);
                    }}
                  >
                    <span className={`area-dot area-color--${colorSlot(index)}`} aria-hidden="true" />
                    <span className="area-overview__name">{names.get(item.id)}</span>
                    {item.status === "disabled" && <span className="tag">已停用</span>}
                  </button>
                  {others.length > 0 && (
                    <p className="area-overview__overlap">
                      <Icon name="alert-triangle" />
                      <span>{overlapText(others.map((id) => names.get(id) ?? ""))}</span>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          {missing > 0 && <p className="field__hint">{`另有 ${missing} 个区域已经被删除，不显示。`}</p>}
          {overlaps.pairs.length > 0 && <p className="field__hint">重叠只是提醒：同一个位置落在几个区域里时，报价取最低。</p>}
          <div className="area-map-dialog__map">
            {mapConfig.state.data === null && mapConfig.state.status === "loading" ? (
              <p className="area-map-placeholder" role="status">
                正在加载地图…
              </p>
            ) : tiles === null ? (
              <p className="area-map-placeholder">{mapConfig.state.status === "ready" ? "这个环境没有配置地图底图。" : "地图没有加载出来。"}区域和重叠照常列在上面。</p>
            ) : (
              <AreaOverviewMap tiles={tiles} areas={mapAreas} selected={selected} onSelect={setSelected} overlaps={overlaps.pieces} showOverlaps focusSignal={focusSignal} marker={null} label="选中区域的地图" {...(surfaceFactory ? { surfaceFactory } : {})} />
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** 一个次要按钮「在地图上查看」+ 对话框。没有区域时不可点。 */
export function AreaMapButton({ areaIds, tenantId, label = "在地图上查看" }: { areaIds: readonly string[]; tenantId?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" disabled={areaIds.length === 0} onClick={() => setOpen(true)}>
        <Icon name="map" />
        {label}
      </Button>
      <AreaMapDialog open={open} areaIds={areaIds} onClose={() => setOpen(false)} {...(tenantId ? { tenantId } : {})} />
    </>
  );
}
