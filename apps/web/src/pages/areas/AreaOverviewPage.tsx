/**
 * 区域地图（M8-18，docs/design/pages/tenant-areas.md 第 19 节；运营后台见 platform-products.md 第 8 节）：
 * 左边是区域列表（颜色圆点、形状、状态、重叠、最近修改人），右边一张大地图画出全部区域；上面按地点、坐标定位；下面导入 .geojson。
 *
 * - 供应商后台 `/areas/map`：只有自己的区域（租户编号来自令牌）；「添加区域」「编辑」进同一个编辑器（AreaEditorPage），
 *   画图、拖点、改名、校验、离开前提醒、草稿都在那里；停用 / 启用用列表页同一套确认（useAreaActions）。导入的文件交给编辑器的「粘贴坐标」识别。
 * - 运营后台 `/platform/areas/map`：全部供应商的区域，只读，按供应商、城市筛。
 * - 重叠只是提醒，不拦保存（同一个位置落在几个区域里时报价取最低）。怎么算见 @nozomi/domain 的 `findAreaOverlaps`、ADR 0074。
 * - M8-20（ADR 0075 第五部分）：运营区域虚线、很淡；报价区域实线。按用途筛；重叠只在报价区域之间算；报价区域超出运营区域的部分画警告色斜线。
 *   运营后台另有「未覆盖需求」图层（`demand.read`，默认关）：`?demands=1&lat=&lng=` 打开时图层开着、在那个位置放标记（从未覆盖需求列表过来）。
 */
import { AREA_BIZ_TYPE_NAMES } from "@nozomi/domain";
import { type ChangeEvent, type DragEvent, type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { type AreaMapItem, type AreaMapResponse, type PlatformAreaMapItem, fetchPlatformAreaMap, fetchPlatformMapConfig, fetchTenantAreaMap } from "../../api/area-map.ts";
import { type MapConfig, TENANT_BASE, fetchMapConfig, listAll } from "../../api/areas.ts";
import { type FilterableCity, listFilterCityOptions } from "../../api/city-options.ts";
import type { Place } from "../../api/master.ts";
import { listAllTenants } from "../../api/platform.ts";
import { UNCOVERED_DEMAND_REASONS, type UncoveredDemandPoints, type UncoveredDemandReason, fetchUncoveredDemandPoints } from "../../api/uncovered-demands.ts";
import type { Tenant } from "../../api/types.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button, LinkButton } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { Dropdown } from "../../components/Dropdown.tsx";
import { SelectField } from "../../components/FormFields.tsx";
import { Icon } from "../../components/Icon.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { useToast } from "../../components/Toast.tsx";
import { AREA_LIST_PATH, AREA_MAP_PATH, AREA_NEW_PATH, areaEditPath } from "../../lib/area-paths.ts";
import { type OverviewRoleFilter, areaRing, areasToGeoJson, checkImportText, colorSlot, computeOverlaps, editorText, exportFileName, filterAreas, overlapAreaText, overlapText, parseLatLngText, roleInGeoJson, shapeSummary } from "../../lib/area-overview.ts";
import { computeOutside, outsideText, roleName, roleOf } from "../../lib/area-roles.ts";
import { DEMAND_REASON_NAMES, demandMapPoints, shiftDate, tokyoToday } from "../../lib/uncovered-demand-display.ts";
import { saveFile } from "../../lib/download.ts";
import { UNCOVERED_DEMANDS_PAGE_PATH } from "../../lib/platform-paths.ts";
import { MASTER_STATUS_BADGES, displayName, formatLocalDateTime } from "../../lib/master-display.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan, useTenantCan } from "../../lib/use-master-access.ts";
import { AreaOverviewMap, type OverviewArea, type OverviewMarker } from "./AreaOverviewMap.tsx";
import { AreaMoreItems, useAreaActions } from "./useAreaActions.tsx";

type Item = AreaMapItem & Partial<Pick<PlatformAreaMapItem, "tenant" | "tenant_id">>;

/** 按名称、编码搜平台的地点（机场、车站、地标）：最多列这么多个。 */
const PLACE_RESULTS = 20;

const PLATFORM_PLACES_PATH = "/platform/v1/master/places";

/** 未覆盖需求图层看最近几天（东京日期，含今天）。 */
const DEMAND_DAY_OPTIONS = [7, 30, 90, 365].map((days) => ({ value: String(days), label: `最近 ${days} 天` }));

function nameOf(item: AreaMapItem): string {
  return displayName(item.name).text;
}

export function AreaOverviewPage() {
  const { portal, account } = usePortalSession();
  const platform = portal.key === "platform";
  const canTenantRead = useTenantCan("area.read");
  const canManage = useTenantCan("area.manage");
  const canPlatformRead = usePlatformCan("product.read");
  const canSeeTenants = usePlatformCan("tenant.read");
  const canSearchPlatformPlaces = usePlatformCan("master_data.read");
  const canSeeDemands = usePlatformCan("demand.read") && platform;
  const [params] = useSearchParams();
  const canRead = platform ? canPlatformRead : canTenantRead;
  const navigate = useNavigate();
  const toast = useToast();
  useDocumentTitle(`区域地图 · NOZOMI ${portal.name}`);

  const [tenantId, setTenantId] = useState<string | null>(null);
  const [cityId, setCityId] = useState<string | null>(null);
  const loaded = useLoad<AreaMapResponse<Item>>(
    `area-map:${portal.key}:${tenantId ?? ""}:${cityId ?? ""}`,
    !canRead ? null : platform ? (token) => fetchPlatformAreaMap(token, { ...(tenantId ? { tenant_id: tenantId } : {}), ...(cityId ? { city_id: cityId } : {}) }) : (token) => fetchTenantAreaMap(token),
  );
  const mapConfig = useLoad<MapConfig>(`map-config:${portal.key}`, canRead ? (platform ? fetchPlatformMapConfig : fetchMapConfig) : null);
  const tenants = useLoad<{ items: Tenant[]; truncated: boolean }>("area-map-tenants", platform && canSeeTenants ? listAllTenants : null);
  const cities = useLoad<{ items: FilterableCity[] }>("area-map-cities", platform && canPlatformRead ? listFilterCityOptions : null);

  const [q, setQ] = useState("");
  const [overlapOnly, setOverlapOnly] = useState(false);
  const [roleFilter, setRoleFilter] = useState<OverviewRoleFilter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  // 从未覆盖需求列表的「在区域地图上查看」过来：图层开着，在那一点放标记
  const linked = platform ? parseLatLngText(`${params.get("lat") ?? ""}, ${params.get("lng") ?? ""}`) : null;
  const [marker, setMarker] = useState<OverviewMarker | null>(linked ? { point: linked, label: "未覆盖需求" } : null);
  const [demandsOn, setDemandsOn] = useState(platform && params.get("demands") === "1");
  const [demandDays, setDemandDays] = useState(30);
  const [demandReason, setDemandReason] = useState<UncoveredDemandReason | "all">("all");
  const demandLoad = useLoad<UncoveredDemandPoints>(
    `area-map-demands:${tenantId ?? ""}:${cityId ?? ""}:${demandDays}:${demandReason}`,
    canSeeDemands && demandsOn
      ? (token) => {
          const to = tokyoToday();
          return fetchUncoveredDemandPoints(token, { from: shiftDate(to, -(demandDays - 1)), to, ...(tenantId ? { tenant_id: tenantId } : {}), ...(cityId ? { city_id: cityId } : {}), ...(demandReason !== "all" ? { reason: demandReason } : {}) });
        }
      : null,
  );
  const demandPoints = useMemo(() => (canSeeDemands && demandsOn && demandLoad.state.data ? demandMapPoints(demandLoad.state.data.items) : null), [canSeeDemands, demandsOn, demandLoad.state.data]);
  const listRef = useRef<HTMLUListElement>(null);

  const items = loaded.state.data?.items ?? null;
  const overlaps = useMemo(() => computeOverlaps(items ?? [], (item) => item.tenant_id ?? ""), [items]);
  const outside = useMemo(() => computeOutside((items ?? []).map((item) => ({ id: item.id, tenant: item.tenant_id ?? "", bizType: item.biz_type, role: roleOf(item), active: item.status === "active", polygons: item.polygons.map((polygon) => ({ kind: polygon.kind, ring: areaRing(polygon.geometry) })) })), (area) => area.tenant), [items]);
  const shown = useMemo(() => filterAreas(items ?? [], { q, overlapOnly, role: roleFilter }, overlaps), [items, q, overlapOnly, roleFilter, overlaps]);
  const slots = useMemo(() => new Map((items ?? []).map((item, index) => [item.id, colorSlot(index)])), [items]);
  const names = useMemo(() => new Map((items ?? []).map((item) => [item.id, nameOf(item)])), [items]);
  const mapAreas = useMemo<OverviewArea[]>(
    () => shown.map((item) => ({ id: item.id, name: nameOf(item), slot: slots.get(item.id) ?? 0, active: item.status === "active", role: roleOf(item), polygons: item.polygons.map((polygon) => ({ id: polygon.id, kind: polygon.kind, ring: areaRing(polygon.geometry) })) })),
    [shown, slots],
  );
  const shownIds = new Set(shown.map((item) => item.id));
  const shownPieces = useMemo(() => overlaps.pieces.filter((piece) => piece.areaIds.every((id) => shownIds.has(id))), [overlaps, shown]);
  const shownOutside = useMemo(() => outside.pieces.filter((piece) => piece.areaIds.some((id) => shownIds.has(id))), [outside, shown]);
  /** 超出运营区域的面积：接口算的（和这个供应商全部的运营区域比）优先，没有时用这一页算的 */
  const outsideOf = (item: Item): number => (item.outside_operating_m2 ?? outside.byArea.get(item.id) ?? 0);

  // 筛掉了选中的区域：取消选中
  useEffect(() => {
    if (selected !== null && !shown.some((item) => item.id === selected)) setSelected(null);
  }, [shown, selected]);

  const actions = useAreaActions({ onChanged: () => loaded.reload(), onDeleted: () => loaded.reload() });

  /** 从列表选：地图移过去。 */
  const pickFromList = (id: string): void => {
    setSelected(id);
    setFocusSignal((value) => value + 1);
  };
  /** 从地图选：列表滚到那一项并标出来（焦点不动，免得页面跳）。 */
  const pickFromMap = (id: string | null): void => {
    setSelected(id);
    if (id !== null) requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-area-id="${id}"]`)?.scrollIntoView?.({ block: "nearest" }));
  };

  const exportAreas = (only: Item[]): void => {
    const name = saveFile({ blob: new Blob([areasToGeoJson(only)], { type: "application/geo+json" }), filename: null }, exportFileName(new Date()));
    toast(`已导出 ${only.length} 个区域（${name}）`);
  };

  const trail = platform ? [{ label: "商品" }] : [{ label: "商品配置" }, { label: "区域", to: AREA_LIST_PATH }];
  const shell = (content: ReactNode, action?: ReactNode) => (
    <AppShell pageName="区域地图" trail={trail}>
      <Page title="区域地图" width="content" {...(action ? { action } : {})}>
        {content}
      </Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(<StateBlock tone="neutral" title="你没有权限查看这里" description="需要的话，请联系你们的管理员开通。" />);

  const tiles = mapConfig.state.data?.tiles ?? null;
  const headerAction = (
    <span className="area-overview__actions">
      <Button disabled={items === null || shown.length === 0} onClick={() => exportAreas(shown)}>
        导出 GeoJSON
      </Button>
      {!platform && <LinkButton to={AREA_LIST_PATH}>列表</LinkButton>}
      {canManage && (
        <LinkButton variant="primary" to={AREA_NEW_PATH} state={{ from: AREA_MAP_PATH }}>
          <Icon name="plus" />
          添加区域
        </LinkButton>
      )}
    </span>
  );

  const loading = items === null && loaded.state.status === "loading";
  const failed = items === null && loaded.state.status === "error";
  const total = items?.length ?? 0;

  return shell(
    <div className="area-overview">
      {actions.notice}
      {platform && (
        <div className="filter-bar area-overview__filters" role="group" aria-label="筛选">
          {canSeeTenants && (
            <Combobox
              inline
              label="供应商"
              clearLabel="全部"
              placeholder="全部"
              options={(tenants.state.data?.items ?? []).map((tenant) => ({ value: tenant.id, label: tenant.name }))}
              value={tenantId}
              onChange={setTenantId}
              loading={tenants.state.data === null && tenants.state.status === "loading"}
              loadFailed={tenants.state.data === null && tenants.state.status === "error"}
            />
          )}
          <Combobox
            inline
            label="城市"
            clearLabel="全部"
            placeholder="全部"
            options={(cities.state.data?.items ?? []).map((city) => ({ value: city.id, label: `${displayName(city.name).text}${city.status === "disabled" ? "（已停用）" : ""}`, detail: city.code, keywords: Object.values(city.name).join(" ") }))}
            value={cityId}
            onChange={setCityId}
            loading={cities.state.data === null && cities.state.status === "loading"}
            loadFailed={cities.state.data === null && cities.state.status === "error"}
          />
        </div>
      )}
      {platform && <Alert kind="info">这里只能查看。区域由供应商在自己的后台维护。</Alert>}
      {loaded.state.data?.truncated && <Alert kind="warning">区域太多，只显示了最近修改的 300 个。{platform ? "请按供应商或城市筛选。" : "请到列表里按城市查找。"}</Alert>}
      <PlaceSearch platform={platform} canSearchPlaces={!platform || canSearchPlatformPlaces} onLocate={setMarker} />
      {canSeeDemands && (
        <div className="filter-bar area-overview__demands" role="group" aria-label="未覆盖需求图层">
          <label className="choice">
            <input type="checkbox" checked={demandsOn} onChange={(event) => setDemandsOn(event.target.checked)} />
            <span className="choice__text">显示未覆盖需求</span>
          </label>
          {demandsOn && (
            <>
              <SelectField inline label="日期" value={String(demandDays)} options={DEMAND_DAY_OPTIONS} onChange={(value) => setDemandDays(Number(value))} />
              <SelectField<UncoveredDemandReason | "all"> inline label="原因" value={demandReason} options={[{ value: "all", label: "全部" }, ...UNCOVERED_DEMAND_REASONS.map((reason) => ({ value: reason, label: DEMAND_REASON_NAMES[reason] }))]} onChange={setDemandReason} />
              <span className="field__hint" role="status">
                {demandLoad.state.data === null
                  ? demandLoad.state.status === "error"
                    ? "未覆盖需求没有加载出来，请检查网络后再勾选一次。"
                    : "正在加载未覆盖需求…"
                  : demandLoad.state.data.items.length === 0
                    ? "这段时间没有未覆盖需求。"
                    : `${demandLoad.state.data.items.length} 条需求${demandLoad.state.data.truncated ? "（太多了，只画了最近的 2000 条，请缩短日期或按供应商、城市筛选）" : ""}。点地图上的点看详情。`}
              </span>
              <Link className="link" to={UNCOVERED_DEMANDS_PAGE_PATH}>
                去未覆盖需求列表
              </Link>
            </>
          )}
        </div>
      )}

      {failed ? (
        <section className="card">
          <StateBlock
            title="加载失败"
            description="请检查网络后重试。"
            action={
              <Button variant="secondary" onClick={loaded.reload}>
                重试
              </Button>
            }
          />
        </section>
      ) : (
        <div className="area-overview__layout">
          <section className="card area-overview__list" aria-labelledby="area-overview-list-title">
            <h2 className="card__title" id="area-overview-list-title">
              {loading ? "区域" : shown.length === total ? `共 ${total} 个区域` : `共 ${total} 个区域，显示 ${shown.length} 个`}
            </h2>
            <div className="area-overview__tools">
              <label className="visually-hidden" htmlFor="area-overview-q">
                按名称搜索
              </label>
              <input id="area-overview-q" className="input input--sm" type="search" placeholder="按名称搜索" maxLength={100} value={q} onChange={(event) => setQ(event.target.value)} />
              <SelectField<OverviewRoleFilter>
                inline
                label="用途"
                value={roleFilter}
                options={[
                  { value: "all", label: "全部" },
                  { value: "operating", label: "运营区域" },
                  { value: "pricing", label: "报价区域" },
                ]}
                onChange={setRoleFilter}
              />
              <label className="choice">
                <input type="checkbox" checked={overlapOnly} onChange={(event) => setOverlapOnly(event.target.checked)} />
                <span className="choice__text">{`只看有重叠的${items === null ? "" : `（${overlaps.byArea.size}）`}`}</span>
              </label>
            </div>
            {loading ? (
              <Skeleton lines={["medium", "long", "medium", "long"]} label="区域加载中" />
            ) : total === 0 ? (
              <StateBlock
                tone="neutral"
                title="还没有区域"
                description={platform ? "符合条件的供应商还没有建区域。" : "区域就是你提供服务的范围。添加一个区域，在地图上画出去的地方（营运区）和不去的地方（禁行区）。"}
                {...(canManage
                  ? {
                      action: (
                        <LinkButton variant="primary" to={AREA_NEW_PATH} state={{ from: AREA_MAP_PATH }}>
                          添加区域
                        </LinkButton>
                      ),
                    }
                  : {})}
              />
            ) : shown.length === 0 ? (
              <StateBlock tone="neutral" title="没有符合条件的区域" description={overlapOnly && q.trim() === "" && roleFilter === "all" ? "没有和别的区域重叠的区域。" : roleFilter !== "all" && q.trim() === "" && !overlapOnly ? `还没有${roleFilter === "operating" ? "运营区域" : "报价区域"}。` : "换个名称试试，或清空搜索。"} />
            ) : (
              <ul className="area-overview__items" aria-label="区域列表" ref={listRef}>
                {shown.map((item) => {
                  const others = overlaps.byArea.get(item.id) ?? [];
                  const editor = editorText(item.last_editor);
                  const isSelected = item.id === selected;
                  const pairs = overlaps.pairs.filter((pair) => pair.a === item.id || pair.b === item.id);
                  return (
                    <li key={item.id} data-area-id={item.id} className={isSelected ? "area-overview__item area-overview__item--selected" : "area-overview__item"}>
                      <button type="button" className="area-overview__pick" aria-pressed={isSelected} onClick={() => pickFromList(item.id)}>
                        <span className={`area-dot area-color--${slots.get(item.id) ?? 0}`} aria-hidden="true" />
                        <span className="area-overview__name">{nameOf(item)}</span>
                      </button>
                      <p className="area-overview__meta">
                        <StatusBadge {...MASTER_STATUS_BADGES[item.status]} />
                        <span>{shapeSummary(item)}</span>
                        <span className="tag" data-role={roleOf(item)}>{roleName(roleOf(item))}</span>
                        <span>{`${item.city ? displayName(item.city.name).text : "—"} · ${AREA_BIZ_TYPE_NAMES[item.biz_type]}`}</span>
                        {item.tenant !== undefined && <span>{item.tenant?.name ?? "（供应商已不存在）"}</span>}
                      </p>
                      {others.length > 0 && (
                        <p className="area-overview__overlap">
                          <Icon name="alert-triangle" />
                          <span>
                            {overlapText(others.map((id) => names.get(id) ?? ""))}
                            {isSelected && pairs.length === 1 && pairs[0] ? `，${overlapAreaText(pairs[0].areaM2)}` : ""}
                          </span>
                        </p>
                      )}
                      {outsideOf(item) > 0 && (
                        <p className="area-overview__overlap" data-outside-note={item.id}>
                          <Icon name="alert-triangle" />
                          <span>{`报价区域超出运营区域：${outsideText(outsideOf(item))}。`}</span>
                        </p>
                      )}
                      <p className="area-overview__edited">{`${editor === null ? "" : `${editor} · `}最近修改 ${formatLocalDateTime(item.last_editor?.at ?? item.updated_at)}`}</p>
                      {isSelected && !platform && (
                        <span className="area-overview__item-actions">
                          <LinkButton size="sm" to={areaEditPath(item.id)} state={{ from: AREA_MAP_PATH }} aria-label={canManage ? `编辑 ${nameOf(item)}` : `查看 ${nameOf(item)}`}>
                            {canManage ? "编辑" : "查看"}
                          </LinkButton>
                          <Button size="sm" variant="text" onClick={() => exportAreas([item])}>
                            导出这个区域
                          </Button>
                          {canManage && (
                            <Dropdown buttonClassName="button button--text button--sm" buttonContent="更多" label={`${nameOf(item)} 的更多操作`} align="end">
                              <AreaMoreItems area={item} actions={actions} />
                            </Dropdown>
                          )}
                        </span>
                      )}
                      {isSelected && platform && (
                        <span className="area-overview__item-actions">
                          <Button size="sm" variant="text" onClick={() => exportAreas([item])}>
                            导出这个区域
                          </Button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <div className="area-overview__map">
            {mapConfig.state.status === "loading" && mapConfig.state.data === null ? (
              <p className="area-map-placeholder" role="status">
                正在加载地图…
              </p>
            ) : tiles === null ? (
              <p className="area-map-placeholder">{mapConfig.state.status === "ready" ? "这个环境没有配置地图底图。" : "地图没有加载出来。"}区域的名称、形状和重叠照常列在左边。</p>
            ) : (
              <AreaOverviewMap tiles={tiles} areas={mapAreas} selected={selected} onSelect={pickFromMap} overlaps={shownPieces} showOverlaps focusSignal={focusSignal} marker={marker} outside={shownOutside} demands={demandPoints} />
            )}
          </div>
        </div>
      )}

      {canManage && <ImportDrop onImport={(text, name) => void navigate(AREA_NEW_PATH, { state: { from: AREA_MAP_PATH, importText: text, importName: name, importRole: roleInGeoJson(text) } })} />}
      {!platform && (
        <p className="field__hint">
          重叠只在报价区域之间算，只是提醒，不影响保存：同一个位置落在几个报价区域里时，报价取最低。区域的禁行区压在别的区域上不算重叠；运营区域之间、运营区域和报价区域之间也不算。报价区域超出运营区域的部分不会报价。详见 <Link className="link" to={AREA_LIST_PATH}>区域列表</Link>。
        </p>
      )}
      {actions.dialog}
    </div>,
    headerAction,
  );
}

/** 地图上方的定位：平台录入的机场、车站、地标，或一对坐标。没有地理编码服务，不能按地址搜（ADR 0074）。 */
function PlaceSearch({ platform, canSearchPlaces, onLocate }: { platform: boolean; canSearchPlaces: boolean; onLocate(marker: OverviewMarker | null): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const [text, setText] = useState("");
  const [results, setResults] = useState<Pick<Place, "id" | "code" | "name" | "location">[] | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const value = text.trim();
    if (value === "") {
      setResults(null);
      return onLocate(null);
    }
    const point = parseLatLngText(value);
    if (point !== null) {
      setResults(null);
      return onLocate({ point, label: `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}` });
    }
    if (!canSearchPlaces) {
      setResults([]);
      return;
    }
    setState("loading");
    try {
      const found = await listAll<Pick<Place, "id" | "code" | "name" | "location">>(platform ? PLATFORM_PLACES_PATH : `${TENANT_BASE}/master/places`, token, { q: value.slice(0, 100) });
      setResults(found.slice(0, PLACE_RESULTS));
      setState("idle");
    } catch (err) {
      if (handleAuthFailure(err)) return;
      setState("error");
      setResults(null);
    }
  };

  return (
    <form className="area-overview__search" role="search" aria-label="在地图上定位" onSubmit={(event) => void submit(event)}>
      <label className="visually-hidden" htmlFor="area-overview-place">
        搜索机场、车站、地标，或输入坐标
      </label>
      <input id="area-overview-place" className="input" type="search" placeholder="搜索机场、车站、地标，或输入坐标（纬度, 经度）" maxLength={100} value={text} onChange={(event: ChangeEvent<HTMLInputElement>) => setText(event.target.value)} />
      <Button type="submit" loading={state === "loading"} loadingText="查找中…">
        <Icon name="search" />
        定位
      </Button>
      <div className="area-overview__search-results" role="status">
        {state === "error" && <span className="field__error">没有查到。请检查网络后重试。</span>}
        {results !== null && results.length === 0 && <span className="field__hint">没有匹配的地点。可以输入坐标（纬度, 经度）来定位。暂时不能按地址搜索。</span>}
        {results !== null && results.length > 0 && (
          <ul className="area-overview__places" aria-label="匹配的地点">
            {results.map((place) => (
              <li key={place.id}>
                <button type="button" className="link" onClick={() => onLocate({ point: { lat: place.location.lat, lng: place.location.lng }, label: displayName(place.name).text })}>
                  {`${displayName(place.name).text}（${place.code}）`}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </form>
  );
}

/** 「拖放 .geojson 或点击导入」：读出文字后交给编辑器的「粘贴坐标」识别（同一套规则和出错说法），在新增区域页核对后保存。 */
function ImportDrop({ onImport }: { onImport(text: string, name: string): void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const take = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    let text: string | null = null;
    try {
      text = await file.text();
    } catch {
      text = null;
    }
    const checked = checkImportText(file.name, file.size, text);
    if (!checked.ok) return setError(checked.message);
    setError(null);
    onImport(checked.text, file.name);
  };

  return (
    <section className="area-overview__import" aria-label="导入">
      <button
        type="button"
        className={over ? "area-drop area-drop--over" : "area-drop"}
        onClick={() => input.current?.click()}
        onDragOver={(event: DragEvent) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event: DragEvent) => {
          event.preventDefault();
          setOver(false);
          void take(event.dataTransfer.files[0]);
        }}
      >
        <Icon name="file" />
        <span>拖放 .geojson 文件到这里，或点击导入</span>
        <span className="area-drop__hint">导入为一个新区域：在新增区域页核对图形、选城市、起名字后保存。文件只在浏览器里读，不上传。</span>
      </button>
      <input
        ref={input}
        className="visually-hidden"
        type="file"
        accept=".geojson,.json,application/geo+json,application/json"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          void take(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {error !== null && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

