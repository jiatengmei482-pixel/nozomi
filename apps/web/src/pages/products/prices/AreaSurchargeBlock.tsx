/**
 * 包车「区域加价」块（docs/design/pages/tenant-prices.md 17.2，ADR 0073 第三部分，M8-12a）。
 * 在「价格规则」页签里、基础定价下面；和价格表共用一个保存（改完一批，一次批量保存，同一事务）。
 * 状态放在 `useSurcharges` 里由页签持有（保存、被拒、重新读取都要用到）；这里只管显示和操作。
 * 金额都是结算价、商品币种；这里不出现对外价和加价比例（规则 4）。
 */
import { type LocalizedText, PRICE_LIMITS, areaUsableByCategory, charterPriceWithSurcharges } from "@nozomi/domain";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { type AreaMapItem, type AreaMapResponse, fetchTenantAreaMap } from "../../../api/area-map.ts";
import type { AreaSummary as TenantArea } from "../../../api/areas.ts";
import type { PriceRuleBatch, PriceRules } from "../../../api/prices.ts";
import type { Product } from "../../../api/products.ts";
import { Alert } from "../../../components/Alert.tsx";
import { Button } from "../../../components/Button.tsx";
import { Dialog } from "../../../components/Dialog.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { NewTabLink } from "../../../components/NewTabLink.tsx";
import { StatusBadge } from "../../../components/StatusBadge.tsx";
import { hiddenOperatingText, outsideText, pricingCapable, roleOf } from "../../../lib/area-roles.ts";
import { AREA_NEW_PATH } from "../../../lib/area-paths.ts";
import {
  type FillRequest,
  type SurchargeField,
  type SurchargeRow,
  applyFill,
  areaSummary,
  blankSurchargeRow,
  buildSurchargeBatch,
  commonAmount,
  isSurchargeItem,
  liveSurcharges,
  mergeSurchargeRow,
  planFill,
  rangeText,
  readSurchargeAmount,
  readSurchargeRow,
  surchargeChange,
  surchargeChangeCount,
  surchargeOverlaps,
  surchargeRowFromRule,
  surchargeSentence,
  surchargeState,
  surchargeValidity,
} from "../../../lib/area-surcharge.ts";
import { displayName } from "../../../lib/master-display.ts";
import { comboText, moneyText, plainAmountDisplay, tidyAmountDisplay } from "../../../lib/product-display.ts";
import { tidyDate } from "../../../lib/time-input.ts";
import { useLoad } from "../../../lib/use-load.ts";
import { AreaMapButton } from "../../areas/AreaMapDialog.tsx";
import { focusAnchor } from "../frame.ts";

export const surchargeCellId = (key: string, field: SurchargeField): string => `surcharge-${key}-${field}`;
const NO_ONLINE_QUOTE = "这个地址暂时没有在线报价，请联系客服";
/** 「新增自定义区域」默认是报价区域（ADR 0075）：只画它、不在运营区域里的地方不报价（M8-12a 验收缺陷 6） */
const NEW_AREA_ROLE_HINT = "新增的区域默认是「报价区域」：还要落在你的某个运营区域里才会报价。那里还没有运营区域时，在区域页面把用途选成「运营 + 报价」。";

export interface SurchargeState {
  rows: SurchargeRow[];
  setRows(update: (rows: SurchargeRow[]) => SurchargeRow[]): void;
  /** 标了「将删除」（= 停用）的加价区域 */
  removing: ReadonlySet<string>;
  setRemoving(next: ReadonlySet<string>): void;
  /** 从「已删除的加价区域」里标了「将恢复」的 */
  restoring: ReadonlySet<string>;
  setRestoring(next: ReadonlySet<string>): void;
  /** 这次新加、还没保存过的加价区域（按添加的先后） */
  added: string[];
  setAdded(next: string[]): void;
  expanded: ReadonlySet<string>;
  setExpanded(next: ReadonlySet<string>): void;
  /** 已保存的加价区域，按服务器给的顺序 */
  savedOrder: string[];
  /** 载入最新内容时，同一格我和别人都改了的行（留的是我的，请人核对） */
  review: ReadonlySet<string>;
  changeCount: number;
  batch(): PriceRuleBatch;
  /** 保存成功、或重新读取以后：换成最新的（`keepEdits` 时没保存的修改重新套上去） */
  adopt(data: PriceRules, keepEdits: boolean): void;
}

const savedAreaOrder = (data: PriceRules): string[] => [...new Set(data.items.filter(isSurchargeItem).map((item) => item.area_id))];

export function useSurcharges(prices: PriceRules): SurchargeState {
  const currency = prices.currency;
  const fromData = (data: PriceRules): SurchargeRow[] => data.items.filter(isSurchargeItem).map((item) => surchargeRowFromRule(item, data.currency));
  const [rows, setRowsState] = useState<SurchargeRow[]>(() => fromData(prices));
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());
  const [restoring, setRestoring] = useState<ReadonlySet<string>>(new Set());
  const [added, setAdded] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [savedOrder, setSavedOrder] = useState<string[]>(() => savedAreaOrder(prices));
  const [review, setReview] = useState<ReadonlySet<string>>(new Set());
  const changeCount = useMemo(() => surchargeChangeCount(rows, currency, removing), [rows, currency, removing]);
  return {
    rows,
    setRows: (update) => setRowsState(update),
    removing,
    setRemoving,
    restoring,
    setRestoring,
    added,
    setAdded,
    expanded,
    setExpanded,
    savedOrder,
    review,
    changeCount,
    batch: () => buildSurchargeBatch(rows, currency, removing),
    adopt: (data, keepEdits) => {
      const base = fromData(data);
      setSavedOrder(savedAreaOrder(data));
      if (!keepEdits) {
        setRowsState(base);
        setReview(new Set());
        setRemoving(new Set());
        setRestoring(new Set());
        setAdded([]);
        return;
      }
      // 按格子合：我改过的格子留我的，没动过的换成最新的；同一格别人也改了的标出来请人核对
      const byId = new Map(base.map((row, index) => [row.id, index]));
      const merged = [...base];
      const extra: SurchargeRow[] = [];
      const conflicts = new Set<string>();
      for (const old of rows) {
        const change = surchargeChange(old, readSurchargeRow(old, data.currency));
        if (change === "none" || change === "blank") continue;
        const at = old.id === null ? undefined : byId.get(old.id);
        if (at !== undefined) {
          const result = mergeSurchargeRow(old, merged[at] as SurchargeRow, data.currency);
          merged[at] = result.row;
          if (result.conflict) conflicts.add(result.row.key);
        } else if (change !== "deleted") extra.push({ ...old, id: null, origin: null });
      }
      setRowsState([...merged, ...extra]);
      setReview(conflicts);
    },
  };
}

export interface SurchargeGroup {
  id: string;
  name: string;
  passengers: number;
  luggage: number;
}

interface DialogDraft {
  mode: "add" | "edit";
  areaId: string;
  pickup: string;
  dropoff: string;
  /** 途经加价（可以空着：新填的组合不设途经加价，已经填了的不改） */
  waypoint: string;
  /** 编辑时范围里各组合不同：留空 = 不改这一项 */
  pickupVaries: boolean;
  dropoffVaries: boolean;
  from: string;
  to: string;
  groups: string[];
  packages: number[];
  existing: "overwrite" | "skip";
  attempted: boolean;
}

export function AreaSurchargeBlock(props: {
  state: SurchargeState;
  product: Product;
  groups: readonly SurchargeGroup[];
  packages: readonly number[];
  currency: string;
  today: string;
  readOnly: boolean;
  busy: boolean;
  onPlatform: boolean;
  canManageAreas: boolean;
  /** 供应商的区域：null = 没有权限看区域（只按价格里的编号显示） */
  areas: { status: "loading" | "error" | "ready" | "forbidden" | "not-found"; data: TenantArea[] | null; reload(): void } | null;
  tenantId?: string;
  /** 价格表那边已经有几条没保存的修改（「一次最多保存 500 条」一起算） */
  otherChanges: number;
  conflictKeys: ReadonlySet<string>;
  announce(text: string): void;
  /** 「这一行的意思」例子里的套餐价：商品第一个服务区域、这个车型组和套餐今天生效的基础定价；没有为 null */
  packagePrice(vehicleGroupId: string, packageHours: number): number | null;
  focusRow(key: string): void;
}) {
  const { state, product, groups, packages, currency, today, readOnly, busy, onPlatform, areas } = props;
  const { rows, removing, restoring, added, expanded, savedOrder } = state;
  const locked = busy || readOnly;
  const productAreaIds = product.areas.map((area) => area.area_id);
  const areaList = areas?.data ?? [];
  const areaById = useMemo(() => new Map(areaList.map((area) => [area.id, area])), [areaList]);
  const productCityId = product.city_id;
  const [filterGroup, setFilterGroup] = useState("all");
  const [filterPackage, setFilterPackage] = useState("all");
  const [picked, setPicked] = useState("");
  const [pickError, setPickError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DialogDraft | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  // 区域在新标签页里画好、回到这一页时重新取区域，新画的就出现在下拉里
  const reloadAreas = areas?.reload;
  useEffect(() => {
    if (!reloadAreas || readOnly) return;
    const onVisible = (): void => {
      if (document.visibilityState === "visible") reloadAreas();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reloadAreas, readOnly]);

  const nameOf = (id: string): string => {
    const area = areaById.get(id);
    if (area) return displayName(area.name).text;
    const own = product.areas.find((entry) => entry.area_id === id);
    if (own) return displayName(own.name).text;
    return areas?.status === "ready" ? "（已删除的区域）" : "（区域）";
  };
  const cityNote = (id: string): string | null => {
    const area = areaById.get(id);
    return area && area.city_id !== productCityId ? displayName(area.city.name as LocalizedText).text : null;
  };
  const groupName = (id: string): string => groups.find((group) => group.id === id)?.name ?? "已移除的车型组";
  const rowLabel = (row: SurchargeRow): string => `区域加价 · ${nameOf(row.areaId)} · ${groupName(row.vehicleGroupId)} · ${row.packageHours} 小时`;

  // ── 哪些区域在列表里 ──
  const originAll = (areaId: string): SurchargeRow[] => rows.filter((row) => row.areaId === areaId && row.origin !== null);
  const isDeletedArea = (areaId: string): boolean => {
    const saved = originAll(areaId);
    return saved.length > 0 && saved.every((row) => row.origin?.status === "disabled") && !restoring.has(areaId);
  };
  const listed = [...savedOrder.filter((id) => !isDeletedArea(id)), ...added.filter((id) => !savedOrder.includes(id))];
  const deletedAreas = savedOrder.filter(isDeletedArea);

  const overlaps = useMemo(() => surchargeOverlaps(rows, currency, removing), [rows, currency, removing]);
  // 列表里有纯「报价区域」时，取区域地图看它有没有部分不在任何运营区域里（那部分不报价；M8-12a 验收缺陷 6）
  const pricingOnly = listed.filter((id) => areaById.get(id)?.status === "active" && roleOf(areaById.get(id) as TenantArea) === "pricing");
  const outsideMap = useLoad<AreaMapResponse<AreaMapItem>>(`surcharge-outside:${pricingOnly.join(",")}`, onPlatform || pricingOnly.length === 0 ? null : (token) => fetchTenantAreaMap(token));
  const outsideOf = (areaId: string): number => outsideMap.state.data?.items.find((item) => item.id === areaId)?.outside_operating_m2 ?? 0;
  const groupIds = groups.map((group) => group.id);
  // 只设了区域加价、基础定价里没有的套餐（接口或导入能建出来）：也进「套餐」筛选和汇总，不算「没填」（M8-12a 验收缺陷 4）
  const extraPackages = [...new Set(rows.filter((row) => !row.deleted && !packages.includes(row.packageHours) && row.packageHours > 0).map((row) => row.packageHours))].sort((x, y) => x - y);
  const allPackages = [...packages, ...extraPackages].sort((x, y) => x - y);
  const viewGroups = filterGroup === "all" ? groupIds : groupIds.filter((id) => id === filterGroup);
  const viewPackages = filterPackage === "all" ? allPackages : allPackages.filter((hours) => String(hours) === filterPackage);
  const missingTotal = listed.filter((id) => !removing.has(id)).reduce((sum, id) => sum + areaSummary(rows, id, groupIds, packages, currency, today).missing, 0);

  const hasProblem = (areaId: string): boolean =>
    rows.some((row) => row.areaId === areaId && !row.deleted && !removing.has(areaId) && (state.review.has(row.key) || readSurchargeRow(row, currency).problems.length > 0 || overlaps.has(row.key) || props.conflictKeys.has(row.key)));
  const isOpen = (areaId: string): boolean => expanded.has(areaId) || hasProblem(areaId);
  const toggle = (areaId: string, open?: boolean): void => {
    const next = new Set(expanded);
    if (open ?? !next.has(areaId)) next.add(areaId);
    else next.delete(areaId);
    state.setExpanded(next);
  };

  // ── 选择区域的选项（本供应商启用中、能挂价格、包车能用的；商品自己的区域、已添加的列出来但不能选） ──
  const usable = pricingCapable(areaList.filter((area) => area.status === "active" && areaUsableByCategory("charter", area.biz_type)));
  const operatingHidden = areaList.filter((area) => area.status === "active" && areaUsableByCategory("charter", area.biz_type) && roleOf(area) === "operating").length;
  const optionNote = (id: string): string | null => (productAreaIds.includes(id) ? "商品的服务区域，不加价" : listed.includes(id) ? "已添加" : deletedAreas.includes(id) ? "已删除，选了会恢复原来的加价" : null);
  const selectable = usable.filter((area) => optionNote(area.id) === null || deletedAreas.includes(area.id));
  const cities = [...new Map(usable.map((area) => [area.city_id, displayName(area.city.name as LocalizedText).text])).entries()].sort((x, y) => (x[0] === productCityId ? -1 : y[0] === productCityId ? 1 : x[1].localeCompare(y[1], "zh")));
  const optionOf = (area: TenantArea): ReactNode => {
    const note = optionNote(area.id);
    const disabled = note !== null && !deletedAreas.includes(area.id);
    return (
      <option key={area.id} value={area.id} disabled={disabled} aria-disabled={disabled || undefined}>
        {`${displayName(area.name).text}${note ? `（${note}）` : ""}`}
      </option>
    );
  };

  const restoreArea = (areaId: string): void => {
    state.setRestoring(new Set([...restoring, areaId]));
    state.setRows((current) => current.map((row) => (row.areaId === areaId && row.origin !== null ? { ...row, enabled: true } : row)));
    toggle(areaId, true);
    props.announce(`「${nameOf(areaId)}」将恢复，还没有保存`);
  };
  const undoRestore = (areaId: string): void => {
    state.setRestoring(new Set([...restoring].filter((id) => id !== areaId)));
    state.setRows((current) => current.map((row) => (row.areaId === areaId && row.origin !== null ? { ...row, enabled: row.origin.status === "enabled" } : row)));
  };

  const openDialog = (mode: "add" | "edit", areaId: string): void => {
    const pickup = mode === "edit" ? commonAmount(rows, areaId, "pickup", currency, today) : "";
    const dropoff = mode === "edit" ? commonAmount(rows, areaId, "dropoff", currency, today) : "";
    const waypoint = mode === "edit" ? commonAmount(rows, areaId, "waypoint", currency, today) : "";
    const hasAny = liveSurcharges(rows.filter((row) => row.areaId === areaId), currency).length > 0;
    setDraft({ mode, areaId, pickup, dropoff, waypoint, pickupVaries: mode === "edit" && hasAny && pickup === "", dropoffVaries: mode === "edit" && hasAny && dropoff === "", from: today, to: "", groups: [...groupIds], packages: [...packages], existing: "overwrite", attempted: false });
  };

  const confirmAdd = (): void => {
    if (picked === "") {
      setPickError("请先选一个区域");
      selectRef.current?.focus();
      return;
    }
    setPickError(null);
    if (deletedAreas.includes(picked)) {
      restoreArea(picked);
      setPicked("");
      const first = rows.find((row) => row.areaId === picked);
      if (first) props.focusRow(first.key);
      return;
    }
    openDialog("add", picked);
  };

  // ── 对话框 ──
  const draftIssues = (current: DialogDraft): Partial<Record<"pickup" | "dropoff" | "waypoint" | "from" | "to" | "groups" | "packages", string>> => {
    const issues: Partial<Record<"pickup" | "dropoff" | "waypoint" | "from" | "to" | "groups" | "packages", string>> = {};
    if (current.waypoint.trim() !== "") {
      const read = readSurchargeAmount(current.waypoint, "waypoint", currency);
      if ("problem" in read) issues.waypoint = read.problem;
    }
    for (const field of ["pickup", "dropoff"] as const) {
      const varies = field === "pickup" ? current.pickupVaries : current.dropoffVaries;
      if (varies && current[field].trim() === "") continue;
      const read = readSurchargeAmount(current[field], field, currency);
      if ("problem" in read) issues[field] = read.problem;
    }
    const from = tidyDate(current.from);
    if (current.from.trim() === "") issues.from = "请填开始日期";
    else if (from === null) issues.from = "这不是一个日期，请按 2026-10-08 的格式填写";
    const to = current.to.trim() === "" ? null : tidyDate(current.to);
    if (current.to.trim() !== "" && to === null) issues.to = "这不是一个日期，请按 2026-10-08 的格式填写";
    else if (from !== null && to !== null && to < from) issues.to = "结束日期不能早于开始日期";
    if (current.groups.length === 0) issues.groups = "至少选一个车型组";
    if (current.packages.length === 0) issues.packages = "至少选一个套餐";
    return issues;
  };
  const plan = draft ? planFill(rows, { areaId: draft.areaId, groupIds: draft.groups, packages: draft.packages, existing: draft.mode === "add" ? "skip" : draft.existing }, today) : null;
  const expandCount = plan ? plan.fill + plan.overwrite : 0;
  const pendingOther = props.otherChanges + state.changeCount;
  const overLimit = expandCount + pendingOther > PRICE_LIMITS.maxBatchChanges;
  const nothingToChange = draft !== null && draft.mode === "edit" && draft.pickup.trim() === "" && draft.dropoff.trim() === "" && draft.waypoint.trim() === "" && (plan?.fill ?? 0) === 0;
  const submitDraft = (): void => {
    if (!draft) return;
    const issues = draftIssues(draft);
    if (Object.keys(issues).length > 0) {
      setDraft({ ...draft, attempted: true });
      return;
    }
    const request: FillRequest = { areaId: draft.areaId, groupIds: draft.groups, packages: draft.packages, pickup: draft.pickup, dropoff: draft.dropoff, waypoint: draft.waypoint, from: tidyDate(draft.from) ?? draft.from, to: draft.to.trim() === "" ? "" : (tidyDate(draft.to) ?? draft.to), existing: draft.mode === "add" ? "skip" : draft.existing };
    const result = applyFill(rows, request, currency);
    state.setRows(() => result.rows);
    if (draft.mode === "add" && !listed.includes(draft.areaId)) state.setAdded([...added, draft.areaId]);
    toggle(draft.areaId, true);
    setPicked("");
    setDraft(null);
    props.announce(draft.mode === "add" ? `已添加「${nameOf(draft.areaId)}」，填了 ${result.count} 个组合，还没有保存` : `已给「${nameOf(draft.areaId)}」填了 ${result.count} 个组合，还没有保存`);
    if (result.first !== null) props.focusRow(result.first);
  };

  const removeArea = (areaId: string): void => {
    if (!savedOrder.includes(areaId)) {
      state.setRows((current) => current.filter((row) => row.areaId !== areaId));
      state.setAdded(added.filter((id) => id !== areaId));
      props.announce(`已去掉「${nameOf(areaId)}」`);
      return;
    }
    setConfirmRemove(areaId);
  };

  // ── 行 ──
  const update = (row: SurchargeRow, change: Partial<SurchargeRow>): void => {
    state.setRows((current) => (current.some((entry) => entry.key === row.key) ? current.map((entry) => (entry.key === row.key ? { ...entry, ...change } : entry)) : [...current, { ...row, ...change }]));
  };
  /** 一个区域的明细：每个「车型组 × 套餐」至少一行（没填的空着等填），已经不在商品里的车型组、套餐的放在最后 */
  const detailRows = (areaId: string): SurchargeRow[] => {
    const own = rows.filter((row) => row.areaId === areaId);
    const result: SurchargeRow[] = [];
    for (const groupId of viewGroups) {
      for (const hours of viewPackages) {
        const combo = own.filter((row) => row.vehicleGroupId === groupId && row.packageHours === hours).sort((x, y) => x.from.localeCompare(y.from));
        // 基础定价里没有的套餐只列已经有的行，不补空行（不提醒去填）
        result.push(...(combo.length > 0 ? combo : packages.includes(hours) ? [blankSurchargeRow(areaId, groupId, hours, today)] : []));
      }
    }
    if (filterGroup === "all" && filterPackage === "all") result.push(...own.filter((row) => !groupIds.includes(row.vehicleGroupId) || !allPackages.includes(row.packageHours)));
    return result;
  };

  const summaryCell = (areaId: string, field: "pickup" | "dropoff" | "waypoint"): ReactNode => {
    const summary = areaSummary(rows, areaId, viewGroups, viewPackages, currency, today, extraPackages);
    const range = summary[field];
    return (
      <span className="surcharge-sum">
        <span className="surcharge-sum__value">{field === "waypoint" && range === null && summary.waypointUnset > 0 ? "没设" : rangeText(range, currency)}</span>
        {range !== null && range.min !== range.max && <span className="surcharge-sum__note">各组合不同</span>}
        {field === "waypoint" && range !== null && summary.waypointUnset > 0 && <span className="surcharge-sum__note">{`${summary.waypointUnset} 个组合没设`}</span>}
      </span>
    );
  };
  const areaNotes = (areaId: string): ReactNode => {
    const summary = areaSummary(rows, areaId, viewGroups, viewPackages, currency, today, extraPackages);
    const unsaved = removing.has(areaId) || restoring.has(areaId) || rows.some((row) => row.areaId === areaId && !["none", "blank"].includes(surchargeChange(row, readSurchargeRow(row, currency))));
    return (
      <>
        {summary.missing > 0 && !removing.has(areaId) && (
          <span className="surcharge-sum__missing">
            <Icon name="alert-triangle" />
            {`${summary.missing} 个组合没填`}
          </span>
        )}
        {unsaved && !removing.has(areaId) && !restoring.has(areaId) && <span className="surcharge-sum__note">未保存</span>}
      </>
    );
  };

  const focusedRow = rows.find((row) => row.key === focusedKey) ?? null;
  const meaning = (): string => {
    if (!focusedRow) return "点开一个区域、点明细里的任何一行，这里会用一句话说明这一行的区域加价。";
    const name = nameOf(focusedRow.areaId);
    const label = `${name} · ${groupName(focusedRow.vehicleGroupId)} · ${focusedRow.packageHours} 小时`;
    const reading = readSurchargeRow(focusedRow, currency);
    if (reading.blank) return `${label}——还没填区域加价。上车点或下车点只在${name}、坐${groupName(focusedRow.vehicleGroupId)}、订 ${focusedRow.packageHours} 小时的单不报价。`;
    if (!reading.rule || reading.rule.pricing.model !== "charter_area_surcharge") return `${label}——${reading.problems.map((problem) => problem.text).join("；")}。`;
    const firstArea = product.areas[0];
    const way = reading.rule.pricing.waypointSurchargeMinor ?? null;
    // 例子代入这个车型组和套餐今天生效的套餐价，合计用 domain 的函数算（tenant-prices.md 17.2.3）；没有套餐价时不写例子
    const packageMinor = firstArea ? props.packagePrice(focusedRow.vehicleGroupId, focusedRow.packageHours) : null;
    const dropoff = reading.rule.pricing.dropoffSurchargeMinor;
    const example =
      firstArea === undefined
        ? ""
        : packageMinor === null
          ? "这个车型组和套餐还没有套餐价。"
          : `例：${displayName(firstArea.name).text}上车、${name}下车 = 套餐价 ${moneyText(packageMinor, currency)} + 0 + ${moneyText(dropoff, currency)} = ${moneyText(charterPriceWithSurcharges({ packageMinor, pickupMinor: 0, dropoffMinor: dropoff }), currency)}（调价规则前）。`;
    const wayExample =
      firstArea && way !== null && packageMinor !== null ? `${displayName(firstArea.name).text}出发、途经${name}再回来 = 套餐价 ${moneyText(packageMinor, currency)} + ${moneyText(way, currency)} = ${moneyText(charterPriceWithSurcharges({ packageMinor, pickupMinor: 0, dropoffMinor: 0, waypointMinor: way }), currency)}。` : "";
    return `${label}——${surchargeSentence(name, reading.rule.pricing.pickupSurchargeMinor, dropoff, currency, way)}${example}${wayExample}${surchargeValidity(reading.rule)}调价规则（节假日、旺季等）会按合计再调。`;
  };

  const productAreaNames = product.areas.map((area) => displayName(area.name).text);
  const productAreaText = productAreaNames.length > 3 ? `${productAreaNames[0]}等 ${productAreaNames.length} 个` : productAreaNames.join("、");
  const canPick = !readOnly && !onPlatform && areas !== null;

  if (packages.length === 0) {
    return (
      <section className="card surcharge" aria-labelledby="surcharge-title">
        <h3 className="surcharge__title" id="surcharge-title" tabIndex={-1}>
          区域加价
        </h3>
        <p className="surcharge__lead">先在上面「基础定价」里加一个套餐，再设区域加价。（区域加价按「车型组 × 套餐」填）</p>
      </section>
    );
  }

  const amountInput = (row: SurchargeRow, field: "pickup" | "dropoff" | "waypoint", label: string, bad: boolean, rowLocked: boolean): ReactNode =>
    readOnly ? (
      <span className="surcharge-detail__text">{row[field] === "" ? (field === "waypoint" ? "没设" : "—") : row[field]}</span>
    ) : (
      <input
        className="input input--sm input--mono price-table__input"
        id={surchargeCellId(row.key, field)}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label={`${label} 的${field === "pickup" ? "上车加价" : field === "dropoff" ? "下车加价" : "途经加价"}`}
        placeholder={field === "waypoint" ? "没设" : undefined}
        aria-invalid={bad || undefined}
        readOnly={rowLocked}
        value={row[field]}
        onChange={(event) => update(row, { [field]: event.target.value })}
        onFocus={(event) => {
          const input = event.currentTarget;
          const plain = plainAmountDisplay(row[field], currency);
          if (plain !== input.value) input.value = plain;
          input.select();
          if (plain !== row[field]) update(row, { [field]: plain });
        }}
        onBlur={() => {
          const tidy = tidyAmountDisplay(row[field], currency);
          if (tidy !== row[field]) update(row, { [field]: tidy });
        }}
      />
    );
  const dateInput = (row: SurchargeRow, field: "from" | "to", label: string, bad: boolean, rowLocked: boolean): ReactNode =>
    readOnly ? (
      <span className="surcharge-detail__text">{row[field] === "" ? (field === "to" ? "一直有效" : "—") : row[field]}</span>
    ) : (
      <input
        className="input input--sm input--mono price-table__date"
        id={surchargeCellId(row.key, field)}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        aria-label={`${label} 的生效日期${field === "from" ? "从" : "到"}`}
        aria-invalid={bad || undefined}
        placeholder={field === "to" ? "一直有效" : "年-月-日"}
        readOnly={rowLocked}
        value={row[field]}
        onChange={(event) => update(row, { [field]: event.target.value })}
        onBlur={() => {
          const tidy = tidyDate(row[field]);
          if (tidy !== null && tidy !== row[field]) update(row, { [field]: tidy });
        }}
      />
    );

  const detail = (areaId: string): ReactNode => {
    const list = detailRows(areaId);
    const areaLocked = locked || removing.has(areaId);
    return (
      <div className="price-table__scroll surcharge-detail" role="region" aria-label={`「${nameOf(areaId)}」的各车型组和套餐`} tabIndex={0}>
        <table className="price-table">
          <caption className="visually-hidden">{`「${nameOf(areaId)}」的区域加价，每个车型组和套餐一行，没填的空着等填`}</caption>
          <thead>
            <tr>
              <th scope="col">车型组</th>
              <th scope="col">套餐</th>
              <th scope="col" className="price-table__number">{`上车加价（${currency}）`}</th>
              <th scope="col" className="price-table__number">{`下车加价（${currency}）`}</th>
              <th scope="col" className="price-table__number">{`途经加价（${currency}）`}</th>
              <th scope="col">生效日期 从</th>
              <th scope="col">到</th>
              <th scope="col">启用</th>
              <th scope="col">状态</th>
              {!readOnly && (
                <th scope="col">
                  <span className="visually-hidden">操作</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {list.map((row) => {
              const reading = readSurchargeRow(row, currency);
              const overlapping = overlaps.has(row.key) || props.conflictKeys.has(row.key);
              const base = surchargeState(row, reading, overlapping, today);
              const look = state.review.has(row.key) && (base.state === "changed" || base.state === "new") ? { state: "overlap" as const, text: "别人也改过这一条，请核对" } : base;
              const group = groups.find((entry) => entry.id === row.vehicleGroupId);
              const label = rowLabel(row);
              const bad = (field: SurchargeField): boolean => reading.problems.some((problem) => problem.field === field) || ((field === "from" || field === "to") && overlapping);
              const rowLocked = areaLocked || row.deleted;
              const tone = { error: "danger", overlap: "danger", deleted: "muted", new: "info", changed: "info", blank: "warning", disabled: "muted", expired: "muted", upcoming: "info", active: "success" }[look.state];
              const flag = look.state === "error" || look.state === "overlap" ? " price-table__row--error" : look.state === "new" || look.state === "changed" ? " price-table__row--unsaved" : "";
              return (
                <tr key={row.key} id={`surcharge-row-${row.key}`} className={`price-table__row${flag}${row.deleted ? " price-table__row--deleted" : ""}`} onFocus={() => setFocusedKey(row.key)}>
                  <th scope="row">
                    {groupName(row.vehicleGroupId)}
                    {group && <span className="product-code">{comboText(group.passengers, group.luggage)}</span>}
                  </th>
                  <td>{`${row.packageHours} 小时`}</td>
                  <td className="price-table__number">{amountInput(row, "pickup", label, bad("pickup"), rowLocked)}</td>
                  <td className="price-table__number">{amountInput(row, "dropoff", label, bad("dropoff"), rowLocked)}</td>
                  <td className="price-table__number">{amountInput(row, "waypoint", label, bad("waypoint"), rowLocked)}</td>
                  <td>{dateInput(row, "from", label, bad("from"), rowLocked)}</td>
                  <td>{dateInput(row, "to", label, bad("to"), rowLocked)}</td>
                  <td>{readOnly ? (reading.blank ? "—" : row.enabled ? "启用" : "已停用") : <input type="checkbox" aria-label={`启用这条区域加价：${label}`} checked={row.enabled} disabled={rowLocked} onChange={(event) => update(row, { enabled: event.target.checked })} />}</td>
                  <td>
                    <span className={`price-state price-state--${tone}`}>
                      <Icon name={look.state === "active" ? "check" : look.state === "blank" ? "alert-triangle" : look.state === "error" || look.state === "overlap" ? "alert-circle" : look.state === "upcoming" ? "clock" : look.state === "new" || look.state === "changed" ? "circle" : "minus"} />
                      {look.text}
                    </span>
                  </td>
                  {!readOnly && (
                    <td>
                      {row.id !== null ? (
                        <Button size="sm" variant="text" disabled={areaLocked} aria-label={`${row.deleted ? "撤销删除" : "删除"}这一条：${label}`} onClick={() => update(row, { deleted: !row.deleted })}>
                          {row.deleted ? "撤销删除" : "删除"}
                        </Button>
                      ) : !reading.blank ? (
                        <Button size="sm" variant="text" disabled={areaLocked} aria-label={`清空这一行：${label}`} onClick={() => state.setRows((current) => current.filter((entry) => entry.key !== row.key))}>
                          清空
                        </Button>
                      ) : null}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const removeTarget = confirmRemove;
  const removeCount = removeTarget === null ? 0 : rows.filter((row) => row.areaId === removeTarget && row.origin?.status === "enabled").length;
  const issues = draft?.attempted ? draftIssues(draft) : {};
  const draftName = draft ? nameOf(draft.areaId) : "";

  return (
    <section className="card surcharge" aria-labelledby="surcharge-title">
      <h3 className="surcharge__title" id="surcharge-title" tabIndex={-1}>
        区域加价
        {missingTotal > 0 && (
          <span className="surcharge__missing">
            <Icon name="alert-triangle" />
            {`${missingTotal} 个组合没填`}
          </span>
        )}
      </h3>
      <p className="surcharge__lead">
        上车点、下车点或客人填的途经景点不在商品的服务区域里时，按所在区域加钱：包车价 = 套餐价 + 上车加价 + 途经加价 + 下车加价。
        <br />
        途经加价同一区域一单只加一次，上车或下车已经在这个区域的不再加；途经加价空着 = 途经景点落在这个区域时不报价（不加钱请填 0）。
        <br />
        {`上车点或下车点哪个区域都不在的单不报价，客人会看到「${NO_ONLINE_QUOTE}」。`}
      </p>

      {state.review.size > 0 && (
        <Alert kind="warning">
          <strong className="alert__title">{`有 ${state.review.size} 条区域加价别人也改过同一项。`}</strong>
          <span>已经载入最新内容：你没动过的格子换成了别人改的；你和别人都改了的格子现在是你的修改（行上标着「别人也改过这一条，请核对」）。请核对后再保存。</span>
        </Alert>
      )}
      {canPick && (
        <div className="surcharge-pick">
          {areas?.status === "error" && areas.data === null ? (
            <p className="surcharge-pick__error">
              区域没有加载出来。
              <Button size="sm" variant="text" onClick={areas.reload}>
                重试
              </Button>
            </p>
          ) : (
            <>
              <div className="surcharge-pick__row">
                <label className="visually-hidden" htmlFor="surcharge-area">
                  选择要加价的区域
                </label>
                <select
                  ref={selectRef}
                  id="surcharge-area"
                  className="input input--sm select surcharge-pick__select"
                  value={picked}
                  disabled={busy || areas?.data === null || selectable.length === 0}
                  aria-invalid={pickError !== null || undefined}
                  aria-describedby={pickError !== null ? "surcharge-area-error" : undefined}
                  onChange={(event) => {
                    setPicked(event.target.value);
                    setPickError(null);
                  }}
                >
                  <option value="">{areas?.data === null ? "加载中…" : "选择区域"}</option>
                  {cities.length <= 1
                    ? usable.map(optionOf)
                    : cities.map(([cityId, cityName]) => (
                        <optgroup key={cityId} label={cityName}>
                          {usable.filter((area) => area.city_id === cityId).map(optionOf)}
                        </optgroup>
                      ))}
                </select>
                <Button size="sm" className="surcharge-pick__add" disabled={busy || areas?.data === null || selectable.length === 0} onClick={confirmAdd}>
                  确认添加
                </Button>
              </div>
              {pickError !== null && (
                <p className="field__error" id="surcharge-area-error">
                  {pickError}
                </p>
              )}
              {areas?.data !== null && selectable.length === 0 && <p className="field__hint">没有其他区域可选。先到区域页面画出要加价的区域（如富士山、千叶），再回来添加。</p>}
              {hiddenOperatingText(operatingHidden) !== null && <p className="field__hint">{hiddenOperatingText(operatingHidden)}</p>}
              <div className="surcharge-pick__links">
                {props.canManageAreas && (
                  <NewTabLink to={`${AREA_NEW_PATH}?biz=charter&role=pricing`} className="link surcharge-pick__new">
                    新增自定义区域
                  </NewTabLink>
                )}
                <AreaMapButton areaIds={[...productAreaIds, ...listed.filter((id) => areaById.has(id))]} />
              </div>
              {props.canManageAreas && <p className="field__hint">{NEW_AREA_ROLE_HINT}</p>}
            </>
          )}
        </div>
      )}
      {!canPick && (onPlatform || readOnly) && listed.length > 0 && <AreaMapButton areaIds={[...productAreaIds, ...listed.filter((id) => areaById.has(id))]} {...(props.tenantId ? { tenantId: props.tenantId } : {})} />}

      <div className="surcharge-view">
        <label className="price-filters__item">
          <span>车型组</span>
          <select className="input input--sm select" value={filterGroup} onChange={(event) => setFilterGroup(event.target.value)}>
            <option value="all">全部</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
        <label className="price-filters__item">
          <span>套餐</span>
          <select className="input input--sm select" value={filterPackage} onChange={(event) => setFilterPackage(event.target.value)}>
            <option value="all">全部</option>
            {allPackages.map((hours) => (
              <option key={hours} value={String(hours)}>{packages.includes(hours) ? `${hours} 小时` : `${hours} 小时（基础定价里没有这个套餐）`}</option>
            ))}
          </select>
        </label>
        {listed.length > 0 && (
          <Button size="sm" variant="text" className="surcharge-view__all" onClick={() => state.setExpanded(listed.every((id) => expanded.has(id)) ? new Set() : new Set(listed))}>
            {listed.every((id) => expanded.has(id)) ? "全部收起" : "全部展开"}
          </Button>
        )}
      </div>

      <table className="surcharge-table">
        <caption className="visually-hidden">{`区域加价（${currency}，结算价）：商品的服务区域不加价，每个加价区域一行`}</caption>
        <thead>
          <tr>
            <th scope="col">区域（上车点、下车点或途经景点所在）</th>
            <th scope="col" className="price-table__number">{`上车加价（${currency}）`}</th>
            <th scope="col" className="price-table__number">{`下车加价（${currency}）`}</th>
            <th scope="col" className="price-table__number">{`途经加价（${currency}）`}</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          {product.areas.map((area) => (
            <tr key={area.area_id} className="surcharge-table__own">
              <th scope="row" data-label="区域">
                <span className="surcharge-table__name">{displayName(area.name).text}</span>
              </th>
              <td className="price-table__number" data-label="上车加价">
                0
              </td>
              <td className="price-table__number" data-label="下车加价">
                0
              </td>
              <td className="price-table__number" data-label="途经加价">
                0
              </td>
              <td className="surcharge-table__own-note">商品的服务区域，不加价</td>
            </tr>
          ))}
          {listed.map((areaId) => {
            const name = nameOf(areaId);
            const open = isOpen(areaId);
            const marked = removing.has(areaId) ? "remove" : restoring.has(areaId) ? "restore" : null;
            const area = areaById.get(areaId);
            const unsaved = marked !== null || rows.some((row) => row.areaId === areaId && !["none", "blank"].includes(surchargeChange(row, readSurchargeRow(row, currency))));
            return [
              <tr key={areaId} id={`surcharge-area-${areaId}`} className={`surcharge-table__area${unsaved ? " surcharge-table__area--unsaved" : ""}${marked === "remove" ? " surcharge-table__area--removing" : ""}`}>
                <th scope="row" data-label="区域">
                  <span className="surcharge-table__head">
                    <button type="button" className="surcharge-table__toggle" aria-expanded={open} aria-controls={`surcharge-detail-${areaId}`} aria-label={`${open ? "收起" : "展开"}「${name}」的各车型组和套餐`} onClick={() => toggle(areaId)}>
                      <Icon name={open ? "chevron-down" : "chevron-right"} />
                    </button>
                    <span className="surcharge-table__name">{name}</span>
                    {cityNote(areaId) !== null && <span className="surcharge-table__city">{`· ${cityNote(areaId)}`}</span>}
                  </span>
                  {area?.status === "disabled" && (
                    <span className="surcharge-table__disabled">
                      <StatusBadge tone="neutral" label="区域已停用" />
                      <span className="surcharge-sum__note">区域停用后这里的区域加价不再用到</span>
                    </span>
                  )}
                  {area?.status === "active" && roleOf(area) === "pricing" && outsideOf(areaId) > 0 && (
                    <span className="surcharge-sum__missing">
                      <Icon name="alert-triangle" />
                      {`${outsideText(outsideOf(areaId))}：在区域页面补画运营区域，或把它的用途改成「运营 + 报价」`}
                    </span>
                  )}
                  {marked === "remove" && <span className="price-state price-state--muted">将删除</span>}
                  {marked === "restore" && <span className="price-state price-state--info">将恢复</span>}
                  {areaNotes(areaId)}
                </th>
                <td className="price-table__number" data-label="上车加价">
                  {summaryCell(areaId, "pickup")}
                </td>
                <td className="price-table__number" data-label="下车加价">
                  {summaryCell(areaId, "dropoff")}
                </td>
                <td className="price-table__number" data-label="途经加价">
                  {summaryCell(areaId, "waypoint")}
                </td>
                <td className="surcharge-table__actions">
                  {readOnly ? null : marked === "remove" ? (
                    <Button size="sm" variant="text" disabled={busy} aria-label={`撤销删除「${name}」`} onClick={() => state.setRemoving(new Set([...removing].filter((id) => id !== areaId)))}>
                      撤销
                    </Button>
                  ) : (
                    <>
                      {marked === "restore" && (
                        <Button size="sm" variant="text" disabled={busy} aria-label={`撤销恢复「${name}」`} onClick={() => undoRestore(areaId)}>
                          撤销
                        </Button>
                      )}
                      <Button size="sm" variant="text" disabled={busy} aria-label={`编辑「${name}」的区域加价`} onClick={() => openDialog("edit", areaId)}>
                        编辑
                      </Button>
                      <Button size="sm" variant="text" className="button--danger-text" disabled={busy} aria-label={`删除加价区域「${name}」`} onClick={() => removeArea(areaId)}>
                        删除
                      </Button>
                    </>
                  )}
                </td>
              </tr>,
              open ? (
                <tr key={`${areaId}-detail`} id={`surcharge-detail-${areaId}`} className="surcharge-table__detail">
                  <td colSpan={5}>{detail(areaId)}</td>
                </tr>
              ) : null,
            ];
          })}
        </tbody>
      </table>

      {listed.length === 0 && (
        <Alert kind="info">
          <strong className="alert__title">包车现在要看下车地点。</strong>
          <span>{`上车点、下车点都要在商品的服务区域（${productAreaText}）或加价区域里，否则不报价。这个商品还没有加价区域，所以下车地点在服务区域以外的包车单现在都不报价。${readOnly || onPlatform ? "" : "要接这样的单，在上面选一个区域添加区域加价。"}`}</span>
        </Alert>
      )}

      {listed.length > 0 && (
        <p className="price-meaning" aria-live="polite">
          <strong>这一行的意思：</strong>
          {meaning()}
        </p>
      )}

      {deletedAreas.length > 0 && (
        <details className="surcharge-deleted">
          <summary>{`已删除的加价区域（${deletedAreas.length}）`}</summary>
          <ul className="surcharge-deleted__list">
            {deletedAreas.map((areaId) => {
              const before = rows.filter((row) => row.areaId === areaId && row.origin !== null);
              const pickups = before.map((row) => row.origin?.pickup_surcharge ?? 0);
              const dropoffs = before.map((row) => row.origin?.dropoff_surcharge ?? 0);
              const ways = before.flatMap((row) => (row.origin?.waypoint_surcharge === null || row.origin?.waypoint_surcharge === undefined ? [] : [row.origin.waypoint_surcharge]));
              const span = (values: number[]): string => rangeText(values.length === 0 ? null : { min: Math.min(...values), max: Math.max(...values) }, currency);
              return (
                <li key={areaId} className="surcharge-deleted__item">
                  <span className="surcharge-table__name">{nameOf(areaId)}</span>
                  {areaById.get(areaId)?.status === "disabled" && (
                    <span className="surcharge-table__disabled">
                      <StatusBadge tone="neutral" label="区域已停用" />
                      <span className="surcharge-sum__note">恢复以后也用不到，要先到区域页面启用这个区域</span>
                    </span>
                  )}
                  <span className="surcharge-sum__note">{`删除前：上车加价 ${span(pickups)} · 下车加价 ${span(dropoffs)} · 途经加价 ${ways.length === 0 ? "没设" : span(ways)}（${currency}）`}</span>
                  {!readOnly && (
                    <Button size="sm" variant="text" disabled={busy} aria-label={`恢复加价区域「${nameOf(areaId)}」`} onClick={() => restoreArea(areaId)}>
                      恢复
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      )}

      <Dialog
        open={draft !== null}
        size="form"
        title={draft?.mode === "edit" ? `改「${draftName}」的区域加价` : `给「${draftName}」设区域加价`}
        dismissOnBackdrop={false}
        onClose={() => setDraft(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDraft(null)}>
              取消
            </Button>
            <Button variant="primary" disabled={overLimit || nothingToChange} onClick={submitDraft}>
              {draft?.mode === "edit" ? "填进去" : "添加"}
            </Button>
          </>
        }
      >
        {draft && (
          <div className="form surcharge-dialog">
            <p className="field__hint">一次给下面勾选的车型组和套餐填同一个区域加价。之后可以展开这个区域，一行一行改。</p>
            {(["pickup", "dropoff"] as const).map((field) => {
              const varies = field === "pickup" ? draft.pickupVaries : draft.dropoffVaries;
              const end = field === "pickup" ? "上车点" : "下车点";
              return (
                <div key={field} className="field">
                  <label className="field__label" htmlFor={`surcharge-dialog-${field}`}>
                    {field === "pickup" ? "上车加价" : "下车加价"}
                    {!varies && (
                      <span className="field__required" aria-hidden="true">
                        {" *"}
                      </span>
                    )}
                  </label>
                  <div className="surcharge-dialog__amount">
                    <input
                      className="input input--mono"
                      id={`surcharge-dialog-${field}`}
                      inputMode="decimal"
                      autoComplete="off"
                      {...(field === "pickup" ? { "data-autofocus": true } : {})}
                      placeholder={varies ? "各组合不同" : undefined}
                      aria-invalid={issues[field] !== undefined || undefined}
                      aria-describedby={`surcharge-dialog-${field}-hint`}
                      value={draft[field]}
                      onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
                      onBlur={() => setDraft((current) => (current ? { ...current, [field]: tidyAmountDisplay(current[field], currency) } : current))}
                    />
                    <span className="surcharge-dialog__currency" aria-hidden="true">{currency}</span>
                  </div>
                  {issues[field] !== undefined && <p className="field__error">{issues[field]}</p>}
                  <p className="field__hint" id={`surcharge-dialog-${field}-hint`}>
                    {varies ? "留空 = 不改这一项" : `${end}在${draftName}时加多少，不加钱填 0`}
                  </p>
                </div>
              );
            })}
            <div className="field">
              <label className="field__label" htmlFor="surcharge-dialog-waypoint">
                途经加价
              </label>
              <div className="surcharge-dialog__amount">
                <input
                  className="input input--mono"
                  id="surcharge-dialog-waypoint"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="没设"
                  aria-invalid={issues.waypoint !== undefined || undefined}
                  aria-describedby="surcharge-dialog-waypoint-hint"
                  value={draft.waypoint}
                  onChange={(event) => setDraft({ ...draft, waypoint: event.target.value })}
                  onBlur={() => setDraft((current) => (current ? { ...current, waypoint: current.waypoint.trim() === "" ? "" : tidyAmountDisplay(current.waypoint, currency) } : current))}
                />
                <span className="surcharge-dialog__currency" aria-hidden="true">{currency}</span>
              </div>
              {issues.waypoint !== undefined && <p className="field__error">{issues.waypoint}</p>}
              <p className="field__hint" id="surcharge-dialog-waypoint-hint">
                {draft.mode === "edit" ? `客人的途经景点在${draftName}时加多少（同一区域一单只加一次）。留空 = 已经填了的组合不改这一项、新填的组合不设` : `客人的途经景点在${draftName}时加多少（同一区域一单只加一次）。选填：留空 = 途经景点落在这里时不报价，不加钱填 0`}
              </p>
            </div>
            <fieldset className="field surcharge-dialog__dates">
              <legend className="field__label">生效日期</legend>
              <span className="surcharge-dialog__date">
                <label htmlFor="surcharge-dialog-from">从</label>
                <input className="input input--mono" id="surcharge-dialog-from" inputMode="numeric" autoComplete="off" placeholder="年-月-日" aria-invalid={issues.from !== undefined || undefined} value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} />
              </span>
              <span className="surcharge-dialog__date">
                <label htmlFor="surcharge-dialog-to">到</label>
                <input className="input input--mono" id="surcharge-dialog-to" inputMode="numeric" autoComplete="off" placeholder="一直有效" aria-invalid={issues.to !== undefined || undefined} value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} />
              </span>
              {issues.from !== undefined && <p className="field__error">{issues.from}</p>}
              {issues.to !== undefined && <p className="field__error">{issues.to}</p>}
              {draft.mode === "edit" && <p className="field__hint">生效日期只用于这次新填的空组合；已经填了的组合保留原来的日期。</p>}
            </fieldset>
            <CheckGroup
              legend="用在哪些车型组"
              all={groupIds}
              chosen={draft.groups}
              nameOf={groupName}
              error={issues.groups}
              onChange={(next) => setDraft({ ...draft, groups: next })}
            />
            <CheckGroup
              legend="用在哪些套餐"
              all={packages.map(String)}
              chosen={draft.packages.map(String)}
              nameOf={(hours) => `${hours} 小时`}
              error={issues.packages}
              onChange={(next) => setDraft({ ...draft, packages: next.map(Number) })}
            />
            {draft.mode === "edit" && planFill(rows, { areaId: draft.areaId, groupIds: draft.groups, packages: draft.packages, existing: "overwrite" }, today).overwrite > 0 && (
              <fieldset className="field surcharge-dialog__checks">
                <legend className="field__label">已经填了的组合</legend>
                <label className="choice">
                  <input type="radio" name="surcharge-existing" checked={draft.existing === "overwrite"} onChange={() => setDraft({ ...draft, existing: "overwrite" })} />
                  <span className="choice__text">改成这次填的</span>
                </label>
                <label className="choice">
                  <input type="radio" name="surcharge-existing" checked={draft.existing === "skip"} onChange={() => setDraft({ ...draft, existing: "skip" })} />
                  <span className="choice__text">跳过，只填空着的</span>
                </label>
                {draft.existing === "overwrite" && (plan?.multiSegment ?? 0) > 0 && <p className="field__hint surcharge-dialog__warn">{`有 ${plan?.multiSegment} 个组合有不止一段日期，只改每个组合最后一段，其余的请展开后逐条改。`}</p>}
              </fieldset>
            )}
            <p role="status" className="surcharge-dialog__result">
              {draft.mode === "edit" ? `会填 ${plan?.fill ?? 0} 个空着的组合，改 ${plan?.overwrite ?? 0} 个已经填了的。` : `会填 ${plan?.fill ?? 0} 个组合。`}
            </p>
            {overLimit && <p className="field__error">{`这次会展开成 ${expandCount} 条，加上还没保存的 ${pendingOther} 条超过了一次最多保存的 ${PRICE_LIMITS.maxBatchChanges} 条。请先保存，或少勾几个车型组和套餐。`}</p>}
          </div>
        )}
      </Dialog>

      <Dialog
        open={removeTarget !== null}
        title={`删除加价区域「${removeTarget === null ? "" : nameOf(removeTarget)}」？`}
        onClose={() => setConfirmRemove(null)}
        footer={
          <>
            <Button variant="secondary" data-autofocus onClick={() => setConfirmRemove(null)}>
              取消
            </Button>
            <Button
              className="button--danger-text"
              onClick={() => {
                if (removeTarget === null) return;
                state.setRemoving(new Set([...removing, removeTarget]));
                setConfirmRemove(null);
                props.announce(`「${nameOf(removeTarget)}」将删除，点保存后生效`);
              }}
            >
              删除
            </Button>
          </>
        }
      >
        <p>{`这个区域的 ${removeCount} 条区域加价会停用，记录保留，以后可以在「已删除的加价区域」里恢复。保存以后，上车点或下车点只在「${removeTarget === null ? "" : nameOf(removeTarget)}」里的包车单不再报价，客人会看到「${NO_ONLINE_QUOTE}」。`}</p>
      </Dialog>
    </section>
  );
}

/** 复选框组：「全部」是三态复选框（`02-components.md` 第 8 节）。 */
export function CheckGroup({ legend, all, chosen, nameOf, error, onChange }: { legend: string; all: readonly string[]; chosen: readonly string[]; nameOf(id: string): string; error: string | undefined; onChange(next: string[]): void }) {
  const allRef = useRef<HTMLInputElement>(null);
  const every = all.every((id) => chosen.includes(id));
  const some = !every && chosen.length > 0;
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = some;
  }, [some]);
  return (
    <fieldset className="field surcharge-dialog__checks">
      <legend className="field__label">{legend}</legend>
      <label className="choice">
        <input ref={allRef} type="checkbox" checked={every} aria-checked={some ? "mixed" : every} onChange={() => onChange(every ? [] : [...all])} />
        <span className="choice__text">{`全部（${all.length} 个）`}</span>
      </label>
      {all.map((id) => (
        <label key={id} className="choice">
          <input type="checkbox" checked={chosen.includes(id)} onChange={(event) => onChange(event.target.checked ? all.filter((entry) => entry === id || chosen.includes(entry)) : chosen.filter((entry) => entry !== id))} />
          <span className="choice__text">{nameOf(id)}</span>
        </label>
      ))}
      {error !== undefined && <p className="field__error">{error}</p>}
    </fieldset>
  );
}
