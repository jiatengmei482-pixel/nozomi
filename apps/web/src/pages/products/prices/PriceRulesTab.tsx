/**
 * 「价格规则」页签（docs/design/pages/tenant-prices.md 第 3、4 节）：覆盖表 + 可编辑的价格表。
 * 表里每一行是一条价格；每个还没有价格的组合也占一行，空着等填。改完一批，一次保存（全部成功或一条都不保存）。
 * 行怎么读、缺不缺价、日期重不重叠都在 lib/price-form.ts（规则来自 @nozomi/domain）。
 */
import { CHARTER_SUPPLIER_PRICE_NOTE, PRICE_DIRECTIONS, PRICE_LIMITS, PRICING_MODEL_NAMES, type PriceDirection, type PriceRule, type PricingModel, VEHICLE_GRADES, addDays, applyAdjustRules, basePrice, selectPriceRule } from "@nozomi/domain";
import { Fragment, type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { ApiError } from "../../../api/client.ts";
import { exportPrices } from "../../../api/inventory.ts";
import { type PriceRuleBatch, type PriceRules, savePriceRules } from "../../../api/prices.ts";
import { usePortalSession } from "../../../auth/PortalSession.tsx";
import { Alert } from "../../../components/Alert.tsx";
import { Button } from "../../../components/Button.tsx";
import { Dialog } from "../../../components/Dialog.tsx";
import { Dropdown } from "../../../components/Dropdown.tsx";
import { Icon, type IconName } from "../../../components/Icon.tsx";
import { StatusBadge } from "../../../components/StatusBadge.tsx";
import { displayName } from "../../../lib/master-display.ts";
import {
  MODEL_FIELDS,
  type PriceContext,
  type PriceField,
  type PriceRow,
  type RowField,
  type RowState,
  blankRow,
  buildBatch,
  directionName,
  fieldName,
  isBlank,
  lowestText,
  pricingSentence,
  readRow,
  rowChange,
  rowFromRule,
  rowOverlaps,
  rowState,
  tableCoverage,
  validitySentence,
  withBlankRows,
  isStationPlace,
  isExtraSegment,
  nextSegment,
  mergePriceRow,
  rowFields,
  KM_FIELDS,
} from "../../../lib/price-form.ts";
import { type CopyDraft, type Route, type RouteDraft, NO_ROUTE_DISTANCE_NOTE, ROUTE_LEAD, ROUTE_LEAD_2, applyCopy, copyDraftFor, emptyRouteDraft, isRouteRow, planCopy, planRoute, pricedGroups, reverseOf, routeHasPrices, routeIssue, routeKey, routeOf, routeOrder, routesIn } from "../../../lib/route-prices.ts";
import { distancePriceAllowed, hasIncludedKm } from "@nozomi/domain";
import { pricingCapable, roleOf } from "../../../lib/area-roles.ts";
import { AREA_NEW_PATH } from "../../../lib/area-paths.ts";
import { NewTabLink } from "../../../components/NewTabLink.tsx";
import { AreaMapButton } from "../../areas/AreaMapDialog.tsx";
import { AddRouteDialog, CopyRouteDialog, RouteSelects } from "./RouteDialogs.tsx";
import { comboText, moneyText, plainAmountDisplay, tidyAmountDisplay } from "../../../lib/product-display.ts";
import type { ServerIssue } from "../../../lib/product-failure.ts";
import { tidyDate } from "../../../lib/time-input.ts";
import { type StepController, StepShell } from "../StepShell.tsx";
import { type StepProblem, focusAnchor } from "../frame.ts";
import { useDownload } from "../inventory/useDownload.tsx";
import { importPath } from "../../../lib/product-paths.ts";
import type { PricesShared } from "./PricesStep.tsx";
import { AreaSurchargeBlock, surchargeCellId, useSurcharges } from "./AreaSurchargeBlock.tsx";
import { DistancePriceBlock } from "./DistancePriceBlock.tsx";
import { readSurchargeRow, surchargeOverlaps } from "../../../lib/area-surcharge.ts";
import { basePriceItems } from "../../../lib/price-form.ts";
import { useLoad } from "../../../lib/use-load.ts";
import { useTenantCan } from "../../../lib/use-master-access.ts";
import type { AreaSummary as TenantArea } from "../../../api/areas.ts";

const STATE_LOOK: Readonly<Record<RowState, { icon: IconName; tone: string }>> = {
  error: { icon: "alert-circle", tone: "danger" },
  overlap: { icon: "alert-circle", tone: "danger" },
  deleted: { icon: "minus", tone: "muted" },
  new: { icon: "circle", tone: "info" },
  changed: { icon: "circle", tone: "info" },
  blank: { icon: "alert-triangle", tone: "warning" },
  disabled: { icon: "minus", tone: "muted" },
  expired: { icon: "minus", tone: "muted" },
  upcoming: { icon: "clock", tone: "info" },
  expiring: { icon: "alert-triangle", tone: "warning" },
  active: { icon: "check", tone: "success" },
};
const FIELD_UNITS: Readonly<Partial<Record<PriceField, string>>> = { startKm: "公里", startMin: "分钟", pkgKm: "公里", inclKm: "公里" };
const FIELD_PER: Readonly<Partial<Record<PriceField, string>>> = { perKm: " / 公里", perMin: " / 分钟", overHour: " / 小时", overKm: " / 公里", kmPrice: " / 公里" };
const cellId = (key: string, field: RowField | "direction"): string => `price-${key}-${field}`;

interface Rejection {
  title: string;
  text: string;
  items: StepProblem[];
  reload?: boolean;
}

export function PriceRulesTab({ shared }: { shared: PricesShared }) {
  const { frame, product, prices } = shared;
  const { readOnly } = frame;
  /** 运营后台只读查看：说明文字不对供应商说「你」，不教怎么填（M1-13） */
  const onPlatform = frame.source.portal === "platform";
  const { token } = usePortalSession();
  const category = product.category;
  const station = isStationPlace(product.poi?.type);
  const context: PriceContext = useMemo(() => ({ category, currency: prices.currency, today: prices.today, station }), [category, prices.currency, prices.today, station]);
  const areaIds = useMemo(() => product.areas.map((area) => area.area_id), [product.areas]);
  const groups = useMemo(() => [...product.vehicle_groups].sort((x, y) => VEHICLE_GRADES.indexOf(x.grade) - VEHICLE_GRADES.indexOf(y.grade) || x.seats - y.seats || x.code.localeCompare(y.code)), [product.vehicle_groups]);
  const groupIds = useMemo(() => groups.map((group) => group.vehicle_group_id), [groups]);
  const models = prices.available_models;
  const defaultModel: PricingModel = models[0] ?? (category === "charter" ? "charter_package" : "fixed");

  /** 每个组合内按方向 / 套餐、开始日期排好。只在打开、保存成功、重新读取时排一次：编辑中（改日期、加一段、保存被拒）行的位置不变 */
  const arrange = (list: PriceRow[]): PriceRow[] => {
    const rank = (row: PriceRow): string => {
      const variant = row.direction !== null ? String(["both", "pickup", "dropoff"].indexOf(row.direction)) : String(row.packageHours ?? 0).padStart(3, "0");
      return `${variant}|${row.from}|${row.key}`;
    };
    return [...list].sort((x, y) => rank(x).localeCompare(rank(y)));
  };
  const fresh = (data: PriceRules, extraPackages: readonly number[] = []): PriceRow[] => arrange(withBlankRows(basePriceItems(data.items).map((item) => rowFromRule(item, data.currency)), context, areaIds, groupIds, defaultModel, extraPackages));
  const download = useDownload();
  // 包车「区域加价」（M8-12a）：和价格表共用一个保存
  const surcharges = useSurcharges(prices);
  const charter = category === "charter";
  const p2p = category === "point_to_point";
  const canReadAreas = useTenantCan("area.read");
  const canManageAreas = useTenantCan("area.manage");
  const tenantAreas = useLoad<TenantArea[]>(`surcharge-areas:${frame.source.portal}:${product.id}`, (charter || p2p) && (onPlatform || canReadAreas) ? frame.source.areas : null);
  const [rows, setRows] = useState<PriceRow[]>(() => fresh(prices));
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  /** 载入最新内容时，同一格我和别人都改了的行（留的是我的，请人核对） */
  const [review, setReview] = useState<ReadonlySet<string>>(new Set());
  const adopted = useRef(prices);
  // 重新取到了价格（别人先改了之后「载入最新内容」）：换成最新的，没保存的修改重新套上去
  useEffect(() => {
    if (adopted.current === prices) return;
    adopted.current = prices;
    // 按格子合（同区域加价）：我改过的格子留我的，没动过的换成最新的；同一格别人也改了的标出来请人核对
    const base = basePriceItems(prices.items).map((item) => rowFromRule(item, prices.currency));
    const byId = new Map(base.map((row, index) => [row.id, index]));
    const merged = [...base];
    const extra: PriceRow[] = [];
    const conflicts = new Set<string>();
    for (const old of rowsRef.current) {
      const change = rowChange(old, readRow(old, context));
      if (change === "none" || change === "blank") continue;
      const at = old.id === null ? undefined : byId.get(old.id);
      if (at !== undefined) {
        const result = mergePriceRow(old, merged[at] as PriceRow, prices.currency);
        merged[at] = result.row;
        if (result.conflict) conflicts.add(result.row.key);
      } else if (change !== "deleted") extra.push({ ...old, id: null, origin: null, key: old.id === null ? old.key : `re-${old.key}` });
    }
    setRows(arrange(withBlankRows([...merged, ...extra], context, areaIds, groupIds, defaultModel)));
    setReview(conflicts);
    surcharges.adopt(prices, true);
    setRejection(null);
    setConflictKeys(new Set());
  }, [prices]);

  const [filterArea, setFilterArea] = useState("all");
  const [filterGroup, setFilterGroup] = useState("all");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [showExpired, setShowExpired] = useState(false);
  const [coverageOpen, setCoverageOpen] = useState(product.areas.length <= 12);
  const [view, setView] = useState<string>(category === "airport_transfer" ? "pickup" : "");
  const [focused, setFocused] = useState<string | null>(null);
  const [rejection, setRejection] = useState<Rejection | null>(null);
  const [conflictKeys, setConflictKeys] = useState<ReadonlySet<string>>(new Set());
  const [addingPackage, setAddingPackage] = useState<{ hours: string; km: string; attempted: boolean } | null>(null);
  const [removingPackage, setRemovingPackage] = useState<number | null>(null);
  const [announce, setAnnounce] = useState("");
  // 点对点线路价（M8-12）
  const [routePick, setRoutePick] = useState<Route>({ from: "", to: "" });
  const [routePickError, setRoutePickError] = useState<string | null>(null);
  const [routeDraft, setRouteDraft] = useState<RouteDraft | null>(null);
  const [copyDraft, setCopyDraft] = useState<CopyDraft | null>(null);
  const [routeGroup, setRouteGroup] = useState("all");
  const [routeExpired, setRouteExpired] = useState(false);
  const sent = useRef<{ payload: string; key: string; batch: PriceRuleBatch } | null>(null);

  const readings = useMemo(() => new Map(rows.map((row) => [row.key, readRow(row, context)])), [rows, context]);
  const overlaps = useMemo(() => rowOverlaps(rows, context), [rows, context]);
  const coverage = useMemo(() => tableCoverage(rows, context, areaIds, groupIds), [rows, context, areaIds, groupIds]);
  /**
   * 「这一行的意思」例子里的套餐价（tenant-prices.md 17.2.3）：例子里上车的那个服务区域（不给时商品第一个服务区域）、这个车型组和套餐、今天生效的基础定价（含没保存的修改）；没有为 null。
   */
  const charterPackagePrice = (vehicleGroupId: string, packageHours: number, areaId?: string): number | null => {
    const firstArea = areaId ?? areaIds[0];
    if (firstArea === undefined) return null;
    const live = rows.flatMap((row) => {
      const rule = row.deleted ? null : (readings.get(row.key)?.rule ?? null);
      return rule ? [rule] : [];
    });
    const rule = selectPriceRule(live, { areaId: firstArea, vehicleGroupId, direction: null, packageHours, date: context.today });
    return rule !== null && rule.pricing.model === "charter_package" ? rule.pricing.packagePriceMinor : null;
  };
  const changes = rows.filter((row) => !["none", "blank"].includes(rowChange(row, readings.get(row.key) ?? readRow(row, context))));
  const changeTotal = changes.length + surcharges.changeCount;
  const hasMileage = rows.some((row) => row.model === "mileage_time" && !row.deleted);
  // 点对点的一口价多「含公里数」「超出每公里」两列（17.4）；接送机、包车没有
  const valueFields: readonly PriceField[] = category === "charter" ? MODEL_FIELDS.charter_package : [...(hasMileage ? MODEL_FIELDS.mileage_time : MODEL_FIELDS.fixed), ...(p2p && models.includes("fixed") ? KM_FIELDS : [])];

  const areaName = (id: string): string => (areaIds.includes(id) ? displayName(product.areas.find((area) => area.area_id === id)?.name).text : "已移除的区域");
  const groupName = (id: string): string => (groupIds.includes(id) ? displayName(product.vehicle_groups.find((group) => group.vehicle_group_id === id)?.name).text : "已移除的车型组");
  /** 给已经不在这个商品里的区域 / 车型组设的价格：现在不算数（不参与报价、不算「有可用的价格」），只能看和删 */
  const isOrphan = (row: PriceRow): boolean => !areaIds.includes(row.areaId) || (row.toAreaId !== null && !areaIds.includes(row.toAreaId)) || !groupIds.includes(row.vehicleGroupId);
  const routeName = (route: Route): string => `${areaName(route.from)} → ${areaName(route.to)}`;
  const variantName = (row: Pick<PriceRow, "direction" | "packageHours">): string => (row.direction !== null ? directionName(row.direction, station) : row.packageHours !== null ? `${row.packageHours} 小时` : "");
  const rowLabel = (row: PriceRow): string => [row.toAreaId !== null ? routeName(routeOf(row)) : areaName(row.areaId), groupName(row.vehicleGroupId), variantName(row)].filter((part) => part !== "").join(" · ");
  const segmentsOf = (row: PriceRow): PriceRow[] => {
    const label = rowLabel(row);
    return (isRouteRow(row) ? routeRows : sorted).filter((other) => rowLabel(other) === label);
  };
  /**
   * 同一组合有多段日期时，这一行各个输入框（价格、日期、启用、方向、计价方式）的名字都加上「第几段，共几段」，读屏分得清是哪一段（M1-17）。
   * 输入框的名字里不带日期：日期就是正在改的内容，名字跟着打字变来变去反而难听懂。
   */
  const segmentOrdinal = (row: PriceRow): string => {
    const segments = segmentsOf(row);
    return segments.length < 2 ? "" : `（第 ${segments.indexOf(row) + 1} 段，共 ${segments.length} 段）`;
  };
  /** 「更多操作」的名字另外带上日期（日期可能相同或没填，所以一定带序号） */
  const segmentSuffix = (row: PriceRow): string => {
    const segments = segmentsOf(row);
    if (segments.length < 2) return "";
    const dates = row.from.trim() === "" ? "未填开始日期" : `${row.from} 起${row.to.trim() === "" ? "" : `，到 ${row.to}`}`;
    return `（第 ${segments.indexOf(row) + 1} 段，共 ${segments.length} 段，${dates}）`;
  };

  /** 表格按区域、车型组（包车再按套餐）分在一起；同一组里保持 rows 的先后（见 arrange），不按正在改的日期重排 */
  const order = (row: PriceRow): string => {
    const area = String(areaIds.indexOf(row.areaId) < 0 ? 9999 : areaIds.indexOf(row.areaId)).padStart(4, "0");
    const group = String(groupIds.indexOf(row.vehicleGroupId) < 0 ? 9999 : groupIds.indexOf(row.vehicleGroupId)).padStart(4, "0");
    return `${area}|${group}|${String(row.packageHours ?? 0).padStart(3, "0")}`;
  };
  /** 区域价的表只放区域价；线路价另成一块（17.3） */
  const sorted = useMemo(() => rows.filter((row) => !isRouteRow(row)).sort((x, y) => order(x).localeCompare(order(y))), [rows, areaIds, groupIds]);
  /** 线路价：按线路分组（商品区域的先后），已经不在这个商品里的线路放最后；组内按车型组，同一车型组保持 rows 的先后 */
  const routeRows = useMemo(() => {
    const byRoute = routeOrder(areaIds);
    const rank = (row: PriceRow): string => `${isOrphan(row) ? 1 : 0}|${byRoute(routeOf(row))}|${String(groupIds.indexOf(row.vehicleGroupId) < 0 ? 9999 : groupIds.indexOf(row.vehicleGroupId)).padStart(4, "0")}`;
    return rows.filter(isRouteRow).sort((x, y) => rank(x).localeCompare(rank(y)));
  }, [rows, areaIds, groupIds]);
  const stateOf = (row: PriceRow): { state: RowState; text: string } => {
    const base = rowState(row, readings.get(row.key) ?? readRow(row, context), overlaps.has(row.key) || conflictKeys.has(row.key), context, rows);
    if (review.has(row.key) && (base.state === "changed" || base.state === "new")) return { state: "overlap", text: "别人也改过这一条，请核对" };
    return base.state === "overlap" && overlaps.has(row.key) ? { state: "overlap", text: `和 ${overlaps.get(row.key)?.length ?? 1} 条价格的日期重叠` } : base;
  };
  const hiddenExpired = sorted.filter((row) => stateOf(row).state === "expired").length;
  const visible = sorted.filter((row) => {
    const { state } = stateOf(row);
    if (["error", "overlap", "deleted", "new", "changed"].includes(state)) return true;
    if (filterArea !== "all" && row.areaId !== filterArea) return false;
    if (filterGroup !== "all" && row.vehicleGroupId !== filterGroup) return false;
    if (onlyMissing && state !== "blank") return false;
    if (!showExpired && state === "expired") return false;
    return true;
  });

  const update = (key: string, changesTo: Partial<PriceRow>, values?: Partial<Record<PriceField, string>>): void => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...changesTo, values: values ? { ...row.values, ...values } : row.values } : row)));
    setConflictKeys((current) => (current.has(key) ? new Set([...current].filter((entry) => entry !== key)) : current));
  };

  // ── 保存 ──
  const overlapGroups = (): { text: string; target: string }[] => {
    const seen = new Set<string>();
    const result: { text: string; target: string }[] = [];
    for (const [key, others] of overlaps) {
      for (const other of others) {
        const pair = [key, other].sort().join("|");
        if (seen.has(pair)) continue;
        seen.add(pair);
        const [a, b] = [rows.find((row) => row.key === key), rows.find((row) => row.key === other)];
        const [ra, rb] = [readings.get(key)?.rule, readings.get(other)?.rule];
        if (!a || !b || !ra || !rb) continue;
        const later = ra.validFrom >= rb.validFrom ? a : b;
        const span = (rule: typeof ra): string => (rule.validTo === null ? `${rule.validFrom} 起一直有效` : `${rule.validFrom} 至 ${rule.validTo}`);
        result.push({ text: `${rowLabel(a)}：${span(ra)} ↔ ${span(rb)}`, target: cellId(later.key, "from") });
      }
    }
    return result;
  };
  const surchargeAreaName = (id: string): string => {
    const area = tenantAreas.state.data?.find((entry) => entry.id === id);
    return area ? displayName(area.name).text : tenantAreas.state.status === "ready" ? "（已删除的区域）" : "（区域）";
  };
  const surchargeLabel = (row: { areaId: string; vehicleGroupId: string; packageHours: number }): string => `区域加价 · ${surchargeAreaName(row.areaId)} · ${groupName(row.vehicleGroupId)} · ${row.packageHours} 小时`;
  const surchargeProblems = (): StepProblem[] => {
    const found: StepProblem[] = [];
    for (const row of surcharges.rows) {
      if (row.deleted || surcharges.removing.has(row.areaId)) continue;
      for (const problem of readSurchargeRow(row, context.currency).problems) found.push({ text: `${surchargeLabel(row)}：${problem.text}`, target: surchargeCellId(row.key, problem.field) });
    }
    const seen = new Set<string>();
    for (const [key, others] of surchargeOverlaps(surcharges.rows, context.currency, surcharges.removing)) {
      for (const other of others) {
        const pair = [key, other].sort().join("|");
        if (seen.has(pair)) continue;
        seen.add(pair);
        const row = surcharges.rows.find((entry) => entry.key === key);
        if (row) found.push({ text: `生效日期重叠——${surchargeLabel(row)}`, target: surchargeCellId(key, "from") });
      }
    }
    return found;
  };
  const validate = (): StepProblem[] => {
    const found: StepProblem[] = [];
    for (const row of [...sorted, ...routeRows]) {
      if (row.deleted) continue;
      for (const problem of readings.get(row.key)?.problems ?? []) found.push({ text: `${rowLabel(row)}：${problem.text}`, target: cellId(row.key, problem.field) });
    }
    for (const group of overlapGroups()) found.push({ text: `生效日期重叠——${group.text}`, target: group.target });
    found.push(...surchargeProblems());
    if (found.length === 0 && changeTotal > PRICE_LIMITS.maxBatchChanges) found.push({ text: `一次最多保存 ${PRICE_LIMITS.maxBatchChanges} 条。请先取消一部分修改，或分两次保存。`, target: "price-table" });
    if (found.length === 0 && product.status === "published" && changes.length > 0 && coverage.priced === 0 && !rows.some((row) => !row.deleted && !isRouteRow(row) && readings.get(row.key)?.rule?.status === "enabled" && (readings.get(row.key)?.rule?.validTo ?? "9999") >= context.today)) {
      found.push({ text: "这个商品已上架，至少要留 1 条启用、没过期的价格。要把价格全部停掉，请先下架。", target: "price-table" });
    }
    return found;
  };
  const submit = async (): Promise<string> => {
    setRejection(null);
    const own = buildBatch(rows, context);
    const extra = surcharges.batch();
    const batch: PriceRuleBatch = { create: [...own.create, ...extra.create], update: [...own.update, ...extra.update], delete: [...own.delete, ...extra.delete] };
    const payload = JSON.stringify(batch);
    // 同样的内容重试用同一个幂等键；内容变了就换一个
    if (sent.current?.payload !== payload) sent.current = { payload, key: crypto.randomUUID(), batch };
    const saved = await savePriceRules(token, product.id, frame.version, batch, sent.current.key);
    sent.current = null;
    adopted.current = saved;
    setRows(fresh(saved));
    surcharges.adopt(saved, false);
    // 读屏状态区里上一句（如「……将删除，点保存后生效」）保存以后已经不对了，清掉（M8-12a 验收缺陷 7）
    setAnnounce("");
    setReview(new Set());
    setConflictKeys(new Set());
    shared.setPrices(saved);
    frame.saved(saved.version);
    return product.id;
  };
  /** 出错的是哪一行：先看接口在 detail 里指明的 ref（新增的）或 id（修改、删除的），没有再按提交时的顺序对回去。 */
  const batchRow = (kind: string, index: number, detail: Record<string, unknown> = {}): PriceRow | undefined => {
    const named = typeof detail["ref"] === "string" ? detail["ref"] : typeof detail["id"] === "string" ? detail["id"] : null;
    const direct = named === null ? undefined : rows.find((row) => row.key === named || row.id === named);
    if (direct) return direct;
    const batch = sent.current?.batch;
    if (!batch) return undefined;
    const key = kind === "create" ? batch.create[index]?.ref : kind === "update" ? batch.update[index]?.id : batch.delete[index];
    return rows.find((row) => row.key === key || row.id === key);
  };
  /** 被拒的是不是一条区域加价：按 ref / id 找，找不到再按提交时的顺序对回去 */
  const batchSurcharge = (kind: string, index: number, detail: Record<string, unknown> = {}) => {
    const named = typeof detail["ref"] === "string" ? detail["ref"] : typeof detail["id"] === "string" ? detail["id"] : null;
    const direct = named === null ? undefined : surcharges.rows.find((row) => row.key === named || row.id === named);
    if (direct) return direct;
    const batch = sent.current?.batch;
    if (!batch) return undefined;
    const key = kind === "create" ? batch.create[index]?.ref : kind === "update" ? batch.update[index]?.id : batch.delete[index];
    return surcharges.rows.find((row) => row.key === key || row.id === key);
  };
  const SURCHARGE_REASONS: Readonly<Record<string, (name: string) => string>> = {
    AREA_NOT_USABLE: (name) => `「${name}」的业务类型不是包车或通用，不能做包车的加价区域。请换一个区域，或到区域页面改它的业务类型。`,
    AREA_DISABLED: (name) => `「${name}」已经停用，不能新加区域加价。请先到区域页面启用它，或换一个区域。`,
    AREA_ROLE_NOT_PRICING: (name) => `「${name}」是运营区域，不能做加价区域：运营区域只决定能不能接单，不带价格。请换一个报价区域（或到区域页面把它改成「运营 + 报价」）。`,
  };
  const placeServerIssues = (issues: ServerIssue[]): StepProblem[] => {
    const special = issues.find((issue) => issue.reason === "UNKNOWN_PRICE_RULE" || issue.reason === "TOO_MANY");
    if (special) {
      const count = issues.filter((issue) => issue.reason === "UNKNOWN_PRICE_RULE").length;
      setRejection(special.reason === "TOO_MANY" ? { title: "没有保存。", text: `一个商品最多 ${PRICE_LIMITS.maxPriceRulesPerProduct} 条价格。请先删掉用不到的（例如已过期的）。`, items: [] } : { title: "没有保存。", text: `有 ${count} 条价格已经被别人删除了。请点「重新读取价格」后再保存。`, items: [], reload: true });
      return [{ text: "", target: "" }].slice(1);
    }
    const FIELD_BY_PATH: Readonly<Record<string, RowField>> = { base_price: "base", start_price: "base", start_meters: "startKm", start_minutes: "startMin", per_km: "perKm", per_minute: "perMin", min_price: "min", package_km: "pkgKm", package_price: "pkgPrice", overtime_per_hour: "overHour", over_km_per_km: "overKm", valid_from: "from", valid_to: "to" };
    return issues.flatMap((issue) => {
      const match = /^\/(create|update|delete)\/(\d+)(?:\/([a-z_]+))?/.exec(issue.path);
      const surcharge = match ? batchSurcharge(match[1] ?? "", Number(match[2]), issue.detail) : undefined;
      if (surcharge) {
        const name = surchargeAreaName(surcharge.areaId);
        const text = SURCHARGE_REASONS[issue.reason]?.(name) ?? issue.message;
        const field = match?.[3] === "dropoff_surcharge" ? "dropoff" : match?.[3] === "valid_from" ? "from" : match?.[3] === "valid_to" ? "to" : "pickup";
        surcharges.setExpanded(new Set([...surcharges.expanded, surcharge.areaId]));
        return [{ text: `${surchargeLabel(surcharge)}：${text}`, target: surchargeCellId(surcharge.key, field) }];
      }
      const row = match ? batchRow(match[1] ?? "", Number(match[2]), issue.detail) : undefined;
      if (!row) return [];
      // 线路价、含公里数、区域用途（M8-12，17.7）：说清是哪个区域、哪一格
      const path = match?.[3] ?? "";
      if (isRouteRow(row) || path === "included_km" || (path === "over_km_per_km" && row.model === "fixed") || issue.reason === "AREA_ROLE_NOT_PRICING") {
        const named = path === "to_area_id" && row.toAreaId !== null ? areaName(row.toAreaId) : areaName(row.areaId);
        const special = routeIssue(issue.reason, path, named, context.currency);
        if (special) return [{ text: `${rowLabel(row)}：${special.text}`, target: cellId(row.key, special.field) }];
      }
      const text = issue.reason === "AREA_NOT_IN_PRODUCT" ? `「${areaName(row.areaId)}」已经不在这个商品里，这条价格保存不了。` : issue.reason === "VEHICLE_GROUP_NOT_IN_PRODUCT" ? `「${groupName(row.vehicleGroupId)}」已经不在这个商品里，这条价格保存不了。` : issue.message;
      return [{ text: `${rowLabel(row)}：${text}`, target: cellId(row.key, FIELD_BY_PATH[match?.[3] ?? ""] ?? "from") }];
    });
  };
  const handleRejection = (err: unknown): boolean => {
    if (!(err instanceof ApiError)) return false;
    if (err.code === "VALIDATION_FAILED" && Array.isArray(err.details["issues"]) && (err.details["issues"] as { reason?: string }[]).some((issue) => issue.reason === "UNKNOWN_PRICE_RULE" || issue.reason === "TOO_MANY")) {
      placeServerIssues((err.details["issues"] as { reason?: string; path?: string }[]).map((issue) => ({ path: issue.path ?? "", reason: issue.reason ?? "", message: "", detail: {} })));
      return true;
    }
    const sentBatch = sent.current?.batch;
    const usesArea = (entry: { pricing_model: string; to_area_id?: string | null }): boolean => entry.pricing_model === "charter_area_surcharge" || (entry.to_area_id ?? null) !== null;
    if (err.status === 404 && /区域/.test(err.message) && sentBatch && [...sentBatch.create, ...sentBatch.update].some(usesArea)) {
      const known = (id: string | null | undefined): boolean => id === null || id === undefined || (tenantAreas.state.data ?? []).some((area) => area.id === id);
      const count = [...sentBatch.create, ...sentBatch.update].filter((entry) => usesArea(entry) && (!known(entry.area_id) || !known(entry.to_area_id))).length;
      setRejection({ title: "没有保存。", text: `有 ${Math.max(1, count)} 条价格用到的区域已经不在了（可能刚被删除）。请点「重新读取价格」后再保存。`, items: [], reload: true });
      tenantAreas.reload();
      return true;
    }
    if (err.code === "PUBLISH_CHECK_FAILED") {
      setRejection({ title: "没有保存。", text: "这个商品已上架，至少要留 1 条启用、没过期的价格。要把价格全部停掉，请先下架。", items: [] });
      return true;
    }
    if (err.code !== "PRICE_RULE_CONFLICT") return false;
    const conflicts = Array.isArray(err.details["conflicts"]) ? (err.details["conflicts"] as { id?: string; ref?: string; valid_from?: string; valid_to?: string | null; with?: { id?: string; ref?: string; valid_from?: string; valid_to?: string | null }[] }[]) : [];
    const findBase = (entry: { id?: string; ref?: string }): PriceRow | undefined => rows.find((row) => (entry.id !== undefined && row.id === entry.id) || (entry.ref !== undefined && row.key === entry.ref));
    const findSurcharge = (entry: { id?: string; ref?: string }) => surcharges.rows.find((row) => (entry.id !== undefined && row.id === entry.id) || (entry.ref !== undefined && row.key === entry.ref));
    const find = (entry: { id?: string; ref?: string }): { key: string; label: string; target: string; areaId?: string } | undefined => {
      const base = findBase(entry);
      if (base) return { key: base.key, label: rowLabel(base), target: cellId(base.key, "from") };
      const surcharge = findSurcharge(entry);
      return surcharge ? { key: surcharge.key, label: surchargeLabel(surcharge), target: surchargeCellId(surcharge.key, "from"), areaId: surcharge.areaId } : undefined;
    };
    const span = (entry: { valid_from?: string; valid_to?: string | null }): string => (entry.valid_to ? `${entry.valid_from} 至 ${entry.valid_to}` : `${entry.valid_from} 起一直有效`);
    const keys = new Set<string>();
    const openAreas = new Set<string>();
    const items: StepProblem[] = [];
    let unknown = conflicts.length === 0;
    for (const conflict of conflicts) {
      const row = find(conflict);
      if (!row) {
        unknown = true;
        continue;
      }
      keys.add(row.key);
      if (row.areaId !== undefined) openAreas.add(row.areaId);
      for (const other of conflict.with ?? []) {
        const otherRow = find(other);
        if (otherRow) keys.add(otherRow.key);
        else unknown = true;
        items.push({ text: `${row.label}：${span(conflict)} ↔ ${span(other)}${otherRow ? "" : "（别人刚加的）"}`, target: row.target });
      }
    }
    if (openAreas.size > 0) surcharges.setExpanded(new Set([...surcharges.expanded, ...openAreas]));
    setConflictKeys(keys);
    setRejection({ title: "没有保存。", text: `有 ${Math.max(1, conflicts.length)} 条价格的生效日期和已有的价格重叠，所以这一批都没有保存。改好以后再点保存。${unknown ? "请点「重新读取价格」后再检查。" : ""}`, items, reload: unknown });
    return true;
  };
  useEffect(() => {
    if (rejection) document.getElementById("price-rejection")?.focus();
  }, [rejection]);

  const controller: StepController = {
    dirty: changeTotal > 0,
    missing: { count: 0, anchor: null },
    validate,
    submit,
    placeServerIssues,
    handleRejection,
    reload: shared.reloadPrices,
    keepsEditsOnReload: true,
    successText: () => {
      const own = buildBatch(rows, context);
      const extra = surcharges.batch();
      const [created, updated, deleted] = [own.create.length + extra.create.length, own.update.length + extra.update.length, own.delete.length + extra.delete.length];
      return created + updated === 0 ? `已删除 ${deleted} 条价格` : `已保存 ${created + updated + deleted} 条价格`;
    },
    summary:
      changeTotal > 0 ? (
        <span className={changeTotal >= 400 ? "price-summary price-summary--warning" : "price-summary"}>{changeTotal >= 400 ? `未保存的修改已经有 ${changeTotal} 条，一次最多保存 ${PRICE_LIMITS.maxBatchChanges} 条，请先保存。` : `有 ${changeTotal} 条未保存的修改`}</span>
      ) : (
        `${coverage.total} 个组合里 ${coverage.priced} 个有价格`
      ),
  };

  // ── 包车的套餐 ──
  const packageIssue = (draft: { hours: string; km: string }): { hours: string | null; km: string | null } => {
    const hours = /^\d+$/.test(draft.hours.trim()) ? Number(draft.hours.trim()) : null;
    const km = /^\d+$/.test(draft.km.trim()) ? Number(draft.km.trim()) : null;
    return {
      hours: hours === null || hours < 1 || hours > PRICE_LIMITS.maxPackageHours ? `请填 1 到 ${PRICE_LIMITS.maxPackageHours} 之间的整数` : coverage.packages.includes(hours) ? `已经有 ${hours} 小时的套餐了` : null,
      km: km === null || km < 1 || km > PRICE_LIMITS.maxPackageKm ? `请填 1 到 ${PRICE_LIMITS.maxPackageKm} 之间的整数` : null,
    };
  };
  const addPackage = (): void => {
    if (!addingPackage) return;
    const issue = packageIssue(addingPackage);
    if (issue.hours !== null || issue.km !== null) return setAddingPackage({ ...addingPackage, attempted: true });
    const hours = Number(addingPackage.hours.trim());
    const added = areaIds.flatMap((areaId) => groupIds.map((vehicleGroupId) => blankRow({ areaId, vehicleGroupId, direction: null, packageHours: hours }, "charter_package", context.today, { pkgKm: addingPackage.km.trim() })));
    setRows((current) => [...current, ...added]);
    setView(String(hours));
    setAddingPackage(null);
    const first = added[0];
    if (first) requestAnimationFrame(() => focusAnchor(cellId(first.key, "pkgPrice")));
  };
  const removePackage = (hours: number): void => {
    setRows((current) => current.filter((row) => !(row.packageHours === hours && row.id === null)).map((row) => (row.packageHours === hours ? { ...row, deleted: true } : row)));
    setRemovingPackage(null);
  };

  const onTableKey = (event: KeyboardEvent<HTMLTableElement>): void => {
    const target = event.target as HTMLElement;
    const column = target.getAttribute("data-col");
    if (event.key !== "Enter" || column === null || target.tagName !== "INPUT") return;
    event.preventDefault();
    const cells = [...event.currentTarget.querySelectorAll<HTMLElement>(`input[data-col="${column}"]`)];
    cells[cells.indexOf(target) + (event.shiftKey ? -1 : 1)]?.focus();
  };

  const focusedRow = rows.find((row) => row.key === focused) ?? null;
  const meaning = (route: boolean): ReactNode => {
    if (!focusedRow || isRouteRow(focusedRow) !== route) return route ? "点线路价表里的任何一行，这里会用一句话说明这一行的价格。" : "点表格里的任何一行，这里会用一句话说明这一行的价格。";
    const reading = readings.get(focusedRow.key);
    const label = rowLabel(focusedRow);
    /** 基础价不是取整单位的整数倍时，报价会和填的数不一样（里程 + 时长的不说：它的结果本来就不固定）。数用和报价同一个函数算。 */
    const roundedNote = (rule: PriceRule | null): ReactNode => {
      if (rule === null || rule.pricing.model === "mileage_time" || prices.rounding_unit <= 1) return null;
      const quoted = applyAdjustRules(basePrice(rule.pricing, {}, rule.packageHours), [], prices.rounding_unit);
      if (quoted.finalMinor === null || quoted.finalMinor === quoted.baseMinor) return null;
      return (
        <span className="price-meaning__rounded">
          <Icon name="alert-triangle" />
          {`取整单位是 ${moneyText(prices.rounding_unit, context.currency)}，报价时会取整成 ${moneyText(quoted.finalMinor, context.currency)}。`}
        </span>
      );
    };
    if (!reading || reading.blank) return `${label}——还没有价格。客人询价这个组合时报不出价。`;
    const openEnded = focusedRow.id === null && focusedRow.from.trim() === "" ? nextSegment(rows, focusedRow, context).openEnded : null;
    const openRule = openEnded === null ? null : (readings.get(openEnded.key)?.rule ?? null);
    if (openRule !== null) return `${label}——新加的一段，请填从哪天开始。上一段「${openRule.validFrom} 起一直有效」没有结束日期：填好开始日期后，这里会出现按钮，一键把上一段的结束日期改成前一天。`;
    const overlapWith = (overlaps.get(focusedRow.key) ?? []).map((key) => rows.find((row) => row.key === key)).filter((row): row is PriceRow => row !== undefined);
    return (
      <>
        {reading.rule ? `${label}——${route ? `只管在${areaName(focusedRow.areaId)}上车、在${areaName(focusedRow.toAreaId ?? "")}下车的单，反方向不算。` : ""}${pricingSentence(reading.rule.pricing, reading.rule.packageHours, context.currency)}${route ? "这条线路有了线路价，就不再用区域价，即使区域价更低。" : ""}${validitySentence(reading.rule)}` : `${label}——`}
        {reading.problems.map((problem) => (
          <strong key={`${problem.field}${problem.text}`} className="price-meaning__problem">{` ${problem.text}。`}</strong>
        ))}
        {reading.notes.map((note) => (
          <span key={note}>{` ${note}`}</span>
        ))}
        {roundedNote(reading.rule)}
        {reading.rule !== null && hasIncludedKm(reading.rule.pricing) && (
          <span className="price-meaning__rounded">
            <Icon name="alert-triangle" />
            {NO_ROUTE_DISTANCE_NOTE}
          </span>
        )}
        {route && reading.rule !== null && !routeHasPrices(rows, reverseOf(routeOf(focusedRow)), context) && (
          <span>
            {` 反方向（${routeName(reverseOf(routeOf(focusedRow)))}）还没有线路价，用的是区域价。`}
            {!readOnly && !isOrphan(focusedRow) && (
              <Button size="sm" variant="text" onClick={() => setCopyDraft(copyDraftFor(rows, routeOf(focusedRow), context, null, undefined, groupIds))}>
                建返程
              </Button>
            )}
          </span>
        )}
        {overlapWith.map((other) => {
          const [mine, theirs] = [reading.rule, readings.get(other.key)?.rule];
          if (!mine || !theirs) return null;
          const canTrim = !readOnly && theirs.validFrom < mine.validFrom;
          const until = addDays(mine.validFrom, -1);
          return (
            <span key={other.key} className="price-meaning__overlap">
              <strong>{" 和这个组合的另一条价格日期重叠："}</strong>
              {`「${theirs.validTo === null ? `${theirs.validFrom} 起一直有效` : `${theirs.validFrom} 至 ${theirs.validTo}`}，${lowestText(theirs.pricing, context.currency, true)}」。`}
              {canTrim && (
                <Button
                  size="sm"
                  onClick={() => {
                    update(other.key, { to: until });
                    setAnnounce(`已把「${theirs.validFrom} 起」那一条的结束日期改成 ${until}`);
                  }}
                >{`把那一条的结束日期改成 ${until}`}</Button>
              )}
              <Button size="sm" variant="text" onClick={() => focusAnchor(cellId(other.key, "from"))}>
                到那一行
              </Button>
            </span>
          );
        })}
      </>
    );
  };

  const viewOptions: { value: string; label: string }[] =
    category === "airport_transfer" ? (["pickup", "dropoff"] as const).map((direction) => ({ value: direction, label: directionName(direction, station) })) : category === "charter" ? coverage.packages.map((hours) => ({ value: String(hours), label: `${hours} 小时` })) : [];
  const currentView = viewOptions.some((option) => option.value === view) ? view : (viewOptions[0]?.value ?? "");
  const comboOf = (areaId: string, vehicleGroupId: string): (typeof coverage.combos)[number] | undefined =>
    coverage.combos.find((combo) => combo.areaId === areaId && combo.vehicleGroupId === vehicleGroupId && (category === "airport_transfer" ? combo.direction === currentView : category === "charter" ? String(combo.packageHours) === currentView : true));
  const missingIn = (value: string): number => coverage.combos.filter((combo) => combo.state === "missing" && (category === "airport_transfer" ? combo.direction === value : String(combo.packageHours) === value)).length;
  const jumpTo = (areaId: string, vehicleGroupId: string): void => {
    setFilterArea(areaId);
    setFilterGroup(vehicleGroupId);
    setOnlyMissing(false);
    requestAnimationFrame(() => {
      const row = sorted.find((entry) => entry.areaId === areaId && entry.vehicleGroupId === vehicleGroupId && !entry.deleted && (category !== "charter" || String(entry.packageHours) === currentView));
      if (row) focusAnchor(`price-row-${row.key}`);
    });
  };

  // ── 点对点线路价（17.3）──
  const tenantAreaById = new Map((tenantAreas.state.data ?? []).map((area) => [area.id, area]));
  /** 两个区域下拉的选项：这个商品的服务区域里能挂价格的（ADR 0075；区域的用途取不到时按「运营 + 报价」算） */
  const routeAreas = pricingCapable(product.areas.map((area) => ({ id: area.area_id, name: displayName(area.name).text, role: tenantAreaById.get(area.area_id) ? roleOf(tenantAreaById.get(area.area_id) as TenantArea) : undefined })));
  const routeStates = new Map(routeRows.map((row) => [row.key, stateOf(row).state]));
  const routeExpiredCount = routeRows.filter((row) => routeStates.get(row.key) === "expired").length;
  const visibleRoutes = routeRows.filter((row) => {
    const state = routeStates.get(row.key) ?? "active";
    if (["error", "overlap", "deleted", "new", "changed"].includes(state)) return true;
    if (routeGroup !== "all" && row.vehicleGroupId !== routeGroup) return false;
    return routeExpired || state !== "expired";
  });
  const pendingChanges = changeTotal;
  const confirmRoute = (): void => {
    if (routePick.from === "" || routePick.to === "") {
      setRoutePickError("请选上车区域和下车区域");
      document.getElementById(routePick.from === "" ? "route-pick-from" : "route-pick-to")?.focus();
      return;
    }
    setRoutePickError(null);
    const priced = pricedGroups(rows, routePick, context);
    setRouteDraft(emptyRouteDraft(routePick, groupIds.filter((id) => !priced.has(id)), models.includes("fixed") ? "fixed" : defaultModel, context.today));
  };
  const addRoute = (draft: RouteDraft): void => {
    const plan = planRoute(rows, draft, context);
    setRows((current) => [...current, ...plan.outbound, ...plan.inbound]);
    setRouteDraft(null);
    setRoutePick({ from: "", to: "" });
    setRouteGroup("all");
    setAnnounce(`已添加 ${plan.outbound.length} 条线路价${plan.inbound.length > 0 ? `和 ${plan.inbound.length} 条返程` : ""}，还没有保存`);
    const first = plan.outbound[0];
    if (first) requestAnimationFrame(() => focusAnchor(cellId(first.key, "base")));
  };
  const copyRoute = (draft: CopyDraft): void => {
    const plan = planCopy(rows, draft, context);
    setRows((current) => applyCopy(current, plan));
    setCopyDraft(null);
    setRouteGroup("all");
    setAnnounce(`已填 ${plan.added.length} 条线路价（${routeName(draft.target)}），还没有保存`);
    const first = plan.added[0];
    if (first) requestAnimationFrame(() => focusAnchor(cellId(first.key, "base")));
  };

  const noPackages = category === "charter" && coverage.packages.length === 0;
  const CoverageHeading = charter ? "h4" : "h3";
  const surchargeAreaCount = new Set(surcharges.rows.filter((row) => !surcharges.removing.has(row.areaId) && (row.origin === null ? !row.deleted : row.enabled || surcharges.restoring.has(row.areaId))).map((row) => row.areaId)).size;
  const header = (field: PriceField): string => {
    if (field === "kmPrice") return `${hasMileage ? "超出含公里数后每公里" : "超出每公里"}（${context.currency} / 公里）`;
    const name = field === "base" ? (hasMileage ? "基础价 / 起步价" : "基础价") : fieldName(field, category === "charter" ? "charter_package" : "mileage_time");
    return FIELD_UNITS[field] ? `${name}（${FIELD_UNITS[field]}）` : `${name}（${context.currency}${FIELD_PER[field] ?? ""}）`;
  };

  return (
    <StepShell frame={frame} slug="prices" title="③ 价格规则" hideTitle next={{ slug: "inventory", label: "保存并下一步" }} controller={controller}>
      {({ busy }) => {
        const locked = busy || readOnly;
        const groupsOverlap = overlapGroups();
        /** 线路价表里一条线路的组标题：「A → B」、返程有没有、复制（17.3.1） */
        const routeHeader = (route: Route, orphan: boolean): ReactNode => {
          const back = reverseOf(route);
          const hasBack = routeHasPrices(rows, back, context);
          const name = routeName(route);
          return (
            <tr className="price-table__group route-group" id={`route-${routeKey(route)}`}>
              <th colSpan={30} scope="colgroup">
                <span className="route-group__head">
                  <span className="route-group__name">{name}</span>
                  <span className="route-group__meta">
                    <span>返程：</span>
                    {hasBack ? (
                      <Button size="sm" variant="text" title="两个方向是两组独立的价格" aria-label={`返程：有，到「${routeName(back)}」那一组`} onClick={() => {
                          const first = routeRows.find((entry) => entry.areaId === back.from && entry.toAreaId === back.to);
                          if (first) focusAnchor(`price-row-${first.key}`);
                        }}>
                        有
                      </Button>
                    ) : (
                      <span>没有</span>
                    )}
                    {!readOnly && !orphan && !hasBack && (
                      <Button size="sm" variant="text" disabled={busy} aria-label={`给「${name}」建返程`} onClick={() => setCopyDraft(copyDraftFor(rows, route, context, null, undefined, groupIds))}>
                        建返程
                      </Button>
                    )}
                    {!readOnly && !orphan && (
                      <Button size="sm" variant="text" disabled={busy || !routeHasPrices(rows, route, context)} aria-label={`复制线路「${name}」`} onClick={() => setCopyDraft(copyDraftFor(rows, route, context, null, undefined, groupIds))}>
                        复制
                      </Button>
                    )}
                  </span>
                </span>
              </th>
            </tr>
          );
        };
        /** 价格表的一行（区域价的表、线路价的表共用）。`route`：线路价的表没有「区域」列，车型组是行标题 */
        const renderRow = (row: PriceRow, index: number, list: readonly PriceRow[], route: boolean): ReactNode => {
          const reading = readings.get(row.key) ?? readRow(row, context);
          const state = stateOf(row);
          const look = STATE_LOOK[state.state];
          const label = rowLabel(row);
          const ordinal = segmentOrdinal(row);
          const bad = (field: RowField): true | undefined => (reading.problems.some((problem) => problem.field === field) || ((field === "from" || field === "to") && state.state === "overlap") ? true : undefined);
          const group = product.vehicle_groups.find((entry) => entry.vehicle_group_id === row.vehicleGroupId);
          const area = product.areas.find((entry) => entry.area_id === row.areaId);
          const orphan = isOrphan(row);
          const previous = list[index - 1];
          const firstOrphan = orphan && (index === 0 || !isOrphan(previous as PriceRow));
          const firstOfArea = index === 0 || previous?.areaId !== row.areaId || (route && previous.toAreaId !== row.toAreaId) || firstOrphan;
          const rowLocked = locked || row.deleted || orphan;
          /** 只读查看、已删除待保存、已不在商品里的行：方向和计价方式显示成文字，不用灰掉的下拉（禁用态的字对比度不够，规范 02-components 第 2 节） */
          const choicesAsText = readOnly || row.deleted || orphan;
          const flag = ["error", "overlap"].includes(state.state) ? " price-table__row--error" : ["new", "changed"].includes(state.state) ? " price-table__row--unsaved" : "";
          const cell = (field: PriceField): ReactNode => {
            if (!rowFields(row.model, category).includes(field)) return <span className="table__muted">—</span>;
            const money = !FIELD_UNITS[field];
            return (
              <input
                className="input input--sm input--mono price-table__input"
                id={cellId(row.key, field)}
                data-col={field}
                type="text"
                inputMode={money ? "decimal" : "numeric"}
                autoComplete="off"
                aria-label={`${label}${ordinal} 的${fieldName(field, row.model)}`}
                aria-invalid={bad(field)}
                readOnly={rowLocked}
                placeholder={field === "min" ? "不设" : undefined}
                value={row.values[field]}
                onChange={(event) => update(row.key, {}, { [field]: event.target.value })}
                onFocus={(event) => {
                  // 再聚焦时变回纯数字并全选，方便直接重填。先把输入框里的字换好再全选、然后才记到页面状态里：
                  // 这样重新渲染时输入框的内容和状态一样，选中的范围不会丢（丢了的话，新敲的数会接在旧数后面）
                  const input = event.currentTarget;
                  const plain = money ? plainAmountDisplay(row.values[field], context.currency) : row.values[field];
                  if (plain !== input.value) input.value = plain;
                  input.select();
                  if (plain !== row.values[field]) update(row.key, {}, { [field]: plain });
                }}
                onBlur={() => {
                  if (!money) return;
                  // 失去焦点：整理成带千分位、不带币种符号的写法（粘贴进来的「¥18,500」「18500円」也一样）
                  if (!money) return;
                  const tidy = tidyAmountDisplay(row.values[field], context.currency);
                  if (tidy !== row.values[field]) update(row.key, {}, { [field]: tidy });
                }}
              />
            );
          };
          const date = (field: "from" | "to"): ReactNode => (
            <input
              className="input input--sm input--mono price-table__date"
              id={cellId(row.key, field)}
              data-col={field}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              aria-label={`${label}${ordinal} 的生效日期${field === "from" ? "从" : "到"}`}
              aria-invalid={bad(field)}
              placeholder={field === "to" ? "一直有效" : "年-月-日"}
              readOnly={rowLocked}
              value={row[field]}
              onChange={(event) => update(row.key, { [field]: event.target.value })}
              onBlur={() => {
                const tidy = tidyDate(row[field]);
                if (tidy !== null && tidy !== row[field]) update(row.key, { [field]: tidy });
              }}
            />
          );
          return (
            <Fragment key={row.key}>
            {firstOrphan && (
              <tr className="price-table__group">
                <th colSpan={30} scope="colgroup">
                  <Icon name="alert-triangle" />
                  {route ? `已经不在这个商品里的线路或车型组的线路价（${list.filter(isOrphan).length} 条）` : `已经不在这个商品里的区域或车型组的价格（${list.filter(isOrphan).length} 条）`}
                  <span className="price-table__group-note">{route ? "这些线路价现在不算数；把区域 / 车型组选回来会重新生效。用不到的可以删掉。" : "这些价格现在不算数；把区域 / 车型组选回来会重新生效。用不到的可以删掉。"}</span>
                </th>
              </tr>
            )}
            {route && firstOfArea && routeHeader(routeOf(row), orphan)}
            <tr id={`price-row-${row.key}`} className={`price-table__row${flag}${firstOfArea ? " price-table__row--first" : ""}${row.deleted ? " price-table__row--deleted" : ""}`} onFocus={() => setFocused(row.key)}>
              {route ? (
                <th scope="row">
                  <span className="visually-hidden">{`${routeName(routeOf(row))} · `}</span>
                  {groupName(row.vehicleGroupId)}
                  {group && <span className="product-code">{comboText(group.passengers, group.luggage)}</span>}
                </th>
              ) : (
                <>
                  <th scope="row">
                    <span className={firstOfArea ? undefined : "visually-hidden"}>{areaName(row.areaId)}</span>
                    {firstOfArea && area?.status === "disabled" && <StatusBadge tone="neutral" label="已停用" />}
                  </th>
                  <td>
                    {groupName(row.vehicleGroupId)}
                    {group && <span className="product-code">{comboText(group.passengers, group.luggage)}</span>}
                  </td>
                </>
              )}
              {category === "airport_transfer" && (
                <td>
                  {choicesAsText ? (
                    <span id={cellId(row.key, "direction")}>{directionName(row.direction ?? "both", station)}</span>
                  ) : (
                    <select className="input input--sm select" id={cellId(row.key, "direction")} aria-label={`${label}${ordinal} 的方向`} disabled={rowLocked} value={row.direction ?? "both"} onChange={(event) => update(row.key, { direction: event.target.value as PriceDirection })}>
                      {(["both", "pickup", "dropoff"] as const).filter((direction) => (PRICE_DIRECTIONS as readonly string[]).includes(direction)).map((direction) => (
                        <option key={direction} value={direction}>
                          {directionName(direction, station)}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
              )}
              {category === "charter" && <td>{`${row.packageHours ?? ""} 小时`}</td>}
              {models.length > 1 && (
                <td>
                  {choicesAsText ? (
                    <span>{row.model === "fixed" ? "一口价" : PRICING_MODEL_NAMES[row.model]}</span>
                  ) : (
                    <select className="input input--sm select" aria-label={`${label}${ordinal} 的计价方式`} disabled={rowLocked} value={row.model} onChange={(event) => update(row.key, { model: event.target.value as PricingModel })}>
                      {models.map((model) => (
                        <option key={model} value={model}>
                          {model === "fixed" ? "一口价" : PRICING_MODEL_NAMES[model]}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
              )}
              {valueFields.map((field) => (
                <td key={field} className="price-table__number">
                  {cell(field)}
                </td>
              ))}
              <td>{date("from")}</td>
              <td>{date("to")}</td>
              <td>{readOnly ? (reading.blank ? "—" : row.enabled ? "启用" : "已停用") : <input type="checkbox" aria-label={`启用这条价格：${label}${ordinal}`} checked={row.enabled} disabled={rowLocked} onChange={(event) => update(row.key, { enabled: event.target.checked })} />}</td>
              <td>
                <span className={`price-state price-state--${look.tone}`}>
                  <Icon name={look.icon} />
                  {state.text}
                </span>
                {row.deleted && !readOnly && (
                  <Button size="sm" variant="text" disabled={busy} onClick={() => update(row.key, { deleted: false })}>
                    撤销
                  </Button>
                )}
              </td>
              {!readOnly && (
                <td>
                  <Dropdown buttonClassName="icon-button" buttonContent={<Icon name="more" />} label={`${label}${segmentSuffix(row)} 的更多操作`} align="end">
                    <button
                      type="button"
                      role="menuitem"
                      className="menu-item"
                      disabled={busy || reading.blank || orphan}
                      onClick={() => {
                        const segment = nextSegment(rows, row, context);
                        const added: PriceRow = { ...blankRow({ areaId: row.areaId, toAreaId: row.toAreaId, vehicleGroupId: row.vehicleGroupId, direction: row.direction, packageHours: row.packageHours }, row.model, context.today, row.values), from: segment.from, enabled: row.enabled };
                        setRows((current) => {
                          const at = current.findIndex((entry) => entry.key === segment.after);
                          return at < 0 ? [...current, added] : [...current.slice(0, at + 1), added, ...current.slice(at + 1)];
                        });
                        setAnnounce(segment.from === "" ? "已在下面加了一行。上一段没有结束日期，请填这一段从哪天开始。" : `已在下面加了一行，从 ${segment.from} 开始`);
                        requestAnimationFrame(() => focusAnchor(cellId(added.key, "from")));
                      }}
                    >
                      <span className="menu-item__text">再加一段日期</span>
                    </button>
                    {route && !orphan && (
                      <button type="button" role="menuitem" className="menu-item" disabled={busy || reading.rule === null} onClick={() => setCopyDraft(copyDraftFor(rows, routeOf(row), context, row.key))}>
                        <span className="menu-item__text">复制这条线路…</span>
                      </button>
                    )}
                    {row.id === null && (route || isExtraSegment(rows, row)) ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="menu-item menu-item--danger"
                        disabled={busy}
                        onClick={() => {
                          const index = list.findIndex((entry) => entry.key === row.key);
                          const neighbour = list[index - 1] ?? list[index + 1];
                          setRows((current) => withBlankRows(current.filter((entry) => entry.key !== row.key), context, areaIds, groupIds, defaultModel, coverage.packages));
                          setAnnounce(`已删除这一行：${label}`);
                          if (neighbour) requestAnimationFrame(() => focusAnchor(cellId(neighbour.key, "from")));
                        }}
                      >
                        <span className="menu-item__text">删除这一行</span>
                      </button>
                    ) : row.id === null ? (
                      <button type="button" role="menuitem" className="menu-item menu-item--danger" disabled={busy || reading.blank} onClick={() => setRows((current) => withBlankRows(current.filter((entry) => entry.key !== row.key), context, areaIds, groupIds, defaultModel, coverage.packages))}>
                        <span className="menu-item__text">清空这一行</span>
                      </button>
                    ) : (
                      <button type="button" role="menuitem" className="menu-item menu-item--danger" disabled={busy} onClick={() => update(row.key, { deleted: !row.deleted })}>
                        <span className="menu-item__text">{row.deleted ? "撤销删除" : "删除"}</span>
                      </button>
                    )}
                  </Dropdown>
                </td>
              )}
            </tr>
            </Fragment>
          );
        };
        return (
          <>
            <div role="status" className="visually-hidden">
              {announce}
            </div>
            <div role="alert" className="step__alerts">
              {download.notice}
              {rejection && (
                <div id="price-rejection" tabIndex={-1}>
                  <Alert kind="danger">
                    <strong className="alert__title">{rejection.title}</strong>
                    <span>{rejection.text}</span>
                    {rejection.items.length > 0 && (
                      <span className="error-summary__list">
                        {rejection.items.map((item, index) => (
                          <button key={index} type="button" className="link error-summary__item" onClick={() => focusAnchor(item.target)}>
                            {item.text}
                          </button>
                        ))}
                      </span>
                    )}
                    {rejection.reload && (
                      <span className="alert__actions">
                        <Button size="sm" onClick={shared.reloadPrices}>
                          重新读取价格
                        </Button>
                      </span>
                    )}
                  </Alert>
                </div>
              )}
              {review.size > 0 && (
                <Alert kind="warning">
                  <strong className="alert__title">{`有 ${review.size} 条价格别人也改过同一项。`}</strong>
                  <span>已经载入最新内容：你没动过的格子换成了别人改的；你和别人都改了的格子现在是你的修改（行上标着「别人也改过这一条，请核对」）。请核对后再保存。</span>
                </Alert>
              )}
              {groupsOverlap.length > 0 && (
                <Alert kind="danger">
                  <strong className="alert__title">{`有 ${overlaps.size} 条价格的生效日期重叠，保存前要改。`}</strong>
                  <span className="error-summary__list">
                    {groupsOverlap.slice(0, 5).map((group) => (
                      <button key={group.text} type="button" className="link error-summary__item" onClick={() => focusAnchor(group.target)}>
                        {group.text}
                      </button>
                    ))}
                    {groupsOverlap.length > 5 && <span>{`还有 ${groupsOverlap.length - 5} 组`}</span>}
                  </span>
                </Alert>
              )}
            </div>
            {hasMileage && (
              <Alert kind="info">
                <strong className="alert__title">按里程和时长计价的价格现在可以先设好。</strong>
                <span>按客人实际路线的里程和时长报价，要等路线预估功能上线；在那之前，价格日历上显示的是不超出起步里程和起步时长时的价。</span>
              </Alert>
            )}
            {category === "charter" && <Alert kind="info">{CHARTER_SUPPLIER_PRICE_NOTE}</Alert>}
            {charter && (
              <nav className="price-sections" aria-label="本页的分块">
                <a className="link" href="#base-pricing-title" onClick={(event) => {
                  event.preventDefault();
                  focusAnchor("base-pricing-title");
                }}>
                  基础定价
                </a>
                <span aria-hidden="true">·</span>
                <a className="link" href="#surcharge-title" onClick={(event) => {
                  event.preventDefault();
                  focusAnchor("surcharge-title");
                }}>
                  {`区域加价（${surchargeAreaCount} 个区域）`}
                </a>
              </nav>
            )}
            {charter && (
              <h3 className="price-section-title" id="base-pricing-title" tabIndex={-1}>
                基础定价
              </h3>
            )}
            {category === "charter" && (
              <div className="price-packages">
                <span className="price-packages__label">套餐：</span>
                {coverage.packages.map((hours) => (
                  <span key={hours} className="tag price-packages__tag">
                    {`${hours} 小时`}
                    {!readOnly && (
                      <button type="button" className="price-packages__remove" aria-label={`删除 ${hours} 小时套餐`} disabled={busy} onClick={() => (rows.some((row) => row.packageHours === hours && row.id !== null && !row.deleted) ? setRemovingPackage(hours) : removePackage(hours))}>
                        <Icon name="x" />
                      </button>
                    )}
                  </span>
                ))}
                {!readOnly && !noPackages && (
                  <Button size="sm" disabled={busy} onClick={() => setAddingPackage({ hours: "", km: "", attempted: false })}>
                    <Icon name="plus" />
                    新增套餐
                  </Button>
                )}
              </div>
            )}
            {noPackages ? (
              <section className="card">
                <div className="state-block">
                  <h3 className="state-block__title">先加一个套餐</h3>
                  <p className="state-block__description">包车卖的是套餐，例如「10 小时 / 300 公里」。加了套餐，下面会列出每个区域和车型组，等你填套餐价。</p>
                  {!readOnly && (
                    <Button variant="primary" onClick={() => setAddingPackage({ hours: "", km: "", attempted: false })}>
                      新增套餐
                    </Button>
                  )}
                </div>
              </section>
            ) : (
              <>
                <section className="card coverage" aria-labelledby="coverage-title">
                  <div className="card__title-row">
                    <CoverageHeading className="coverage__title" id="coverage-title">
                      {coverage.priced === 0 ? (
                        "还没有设价格"
                      ) : coverage.missing === 0 ? (
                        <span className="coverage__ok">
                          <Icon name="check" />
                          {`${coverage.total} 个组合都有价格`}
                        </span>
                      ) : (
                        <>
                          {`${coverage.total} 个组合里 ${coverage.priced} 个有价格，`}
                          <span className="coverage__missing">
                            <Icon name="alert-triangle" />
                            {`${coverage.missing} 个没有价格`}
                          </span>
                        </>
                      )}
                    </CoverageHeading>
                    <Button size="sm" variant="text" aria-expanded={coverageOpen} aria-controls="coverage-table" onClick={() => setCoverageOpen(!coverageOpen)}>
                      {coverageOpen ? "收起覆盖表" : "展开覆盖表"}
                    </Button>
                  </div>
                  <p className="field__hint">{coverage.priced === 0 ? (onPlatform ? "供应商还没有给任何组合设价格。" : "在下面的表格里填。每一行是一个组合，填上价格、点保存就行。") : coverage.missing > 0 ? "没有价格的组合，客人询价时报不出价。" : ""}</p>
                  {coverageOpen && (
                    <div id="coverage-table">
                      {viewOptions.length > 0 && (
                        <fieldset className="draw-bar__kind coverage__view">
                          <legend className="visually-hidden">看哪个</legend>
                          <span aria-hidden="true">看：</span>
                          {viewOptions.map((option) => (
                            <label key={option.value} className="choice">
                              <input type="radio" name="coverage-view" checked={currentView === option.value} onChange={() => setView(option.value)} />
                              <span className="choice__text">{`${option.label}${missingIn(option.value) > 0 ? `（缺 ${missingIn(option.value)}）` : ""}`}</span>
                            </label>
                          ))}
                        </fieldset>
                      )}
                      <div className="coverage__scroll" tabIndex={0} role="region" aria-label="覆盖表">
                        <table className="coverage__table">
                          <caption className="visually-hidden">{`各区域、各车型组的价格（${context.currency}）`}</caption>
                          <thead>
                            <tr>
                              <td />
                              {groups.map((group) => (
                                <th key={group.vehicle_group_id} scope="col">
                                  {displayName(group.name).text}
                                  <span className="product-code">{group.code}</span>
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {product.areas.map((area) => (
                              <tr key={area.area_id}>
                                <th scope="row">{displayName(area.name).text}</th>
                                {groups.map((group) => {
                                  const combo = comboOf(area.area_id, group.vehicle_group_id);
                                  const rule = combo?.row ? readings.get(combo.row.key)?.rule : undefined;
                                  const unsaved = combo?.row ? rowChange(combo.row, readings.get(combo.row.key) ?? readRow(combo.row, context)) !== "none" : false;
                                  const price = rule ? lowestText(rule.pricing, context.currency) : null;
                                  const label = `${displayName(area.name).text}，${displayName(group.name).text}${viewOptions.length > 0 ? `，${viewOptions.find((option) => option.value === currentView)?.label ?? ""}` : ""}：${rule ? lowestText(rule.pricing, context.currency, true) : "没有价格"}。到价格表里看这一行`;
                                  return (
                                    <td key={group.vehicle_group_id}>
                                      <button type="button" className={price === null ? "coverage__cell coverage__cell--missing" : "coverage__cell"} aria-label={label} onClick={() => jumpTo(area.area_id, group.vehicle_group_id)}>
                                        {price === null ? (
                                          <>
                                            <Icon name="alert-triangle" />
                                            没有价格
                                          </>
                                        ) : (
                                          <span className="coverage__price">{price}</span>
                                        )}
                                        {combo?.viaBoth && <span className="coverage__note">通用价</span>}
                                        {combo?.state === "upcoming" && <span className="coverage__note coverage__note--info">{`${combo.from} 起`}</span>}
                                        {unsaved && <span className="coverage__note">未保存</span>}
                                      </button>
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </section>

                <div className="price-filters">
                  <label className="price-filters__item">
                    <span>区域</span>
                    <select className="input input--sm select" value={filterArea} onChange={(event) => setFilterArea(event.target.value)}>
                      <option value="all">全部</option>
                      {product.areas.map((area) => (
                        <option key={area.area_id} value={area.area_id}>
                          {displayName(area.name).text}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="price-filters__item">
                    <span>车型组</span>
                    <select className="input input--sm select" value={filterGroup} onChange={(event) => setFilterGroup(event.target.value)}>
                      <option value="all">全部</option>
                      {groups.map((group) => (
                        <option key={group.vehicle_group_id} value={group.vehicle_group_id}>
                          {displayName(group.name).text}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="choice">
                    <input type="checkbox" checked={onlyMissing} onChange={(event) => setOnlyMissing(event.target.checked)} />
                    <span className="choice__text">只看没有价格的</span>
                  </label>
                  <label className="choice">
                    <input type="checkbox" checked={showExpired} onChange={(event) => setShowExpired(event.target.checked)} />
                    <span className="choice__text">{`显示已过期的${hiddenExpired > 0 ? `（${hiddenExpired} 条）` : ""}`}</span>
                  </label>
                  {frame.source.canExportPrices && (
                    <span className="price-filters__transfer">
                      <Dropdown
                        buttonClassName="button button--secondary button--sm"
                        buttonContent={
                          download.busy ? (
                            "正在准备文件…"
                          ) : (
                            <>
                              导入 / 导出
                              <Icon name="chevron-down" />
                            </>
                          )
                        }
                        align="end"
                      >
                        <button type="button" role="menuitem" className="menu-item" disabled={download.busy} onClick={() => void download.run((session) => exportPrices(session, product.id, "none"), "price-template.xlsx")}>
                          <span className="menu-item__text">下载空白模版</span>
                        </button>
                        <button type="button" role="menuitem" className="menu-item" disabled={download.busy || prices.items.length === 0} onClick={() => void download.run((session) => exportPrices(session, product.id, "all"), "prices.xlsx")}>
                          <span className="menu-item__text">
                            {prices.items.length === 0 ? "导出现有的价格（还没有价格）" : `导出现有的价格（${prices.items.length} 条）`}
                            {changeTotal > 0 && <span className="menu-item__note">不含你没保存的修改</span>}
                          </span>
                        </button>
                        {!readOnly && (
                          <>
                            <hr className="menu-divider" />
                            <Link role="menuitem" className="menu-item" to={importPath(product.id, "prices")}>
                              <span className="menu-item__text">导入价格…</span>
                            </Link>
                          </>
                        )}
                      </Dropdown>
                    </span>
                  )}
                </div>

                {p2p && models.includes("fixed") && <p className="field__hint">「含公里数」「超出每公里」选填，只有一口价能填，两格要一起填。报价时按客人这一单的路线距离算，超出的部分不足 1 公里按 1 公里，加进一口价（和「里程 + 时长」的按比例不同）。</p>}
                <div className="price-table__scroll" id="price-table" tabIndex={-1}>
                  {visible.length === 0 ? (
                    <div className="state-block">
                      <h3 className="state-block__title">没有符合条件的价格</h3>
                      <p className="state-block__description">换个条件试试。</p>
                      <Button
                        onClick={() => {
                          setFilterArea("all");
                          setFilterGroup("all");
                          setOnlyMissing(false);
                        }}
                      >
                        清空筛选
                      </Button>
                    </div>
                  ) : (
                    <table className="price-table" onKeyDown={onTableKey}>
                      <caption className="visually-hidden">价格表：每一行是一条价格，没有价格的组合空着等填</caption>
                      <thead>
                        <tr>
                          <th scope="col">区域</th>
                          <th scope="col">车型组</th>
                          {category === "airport_transfer" && <th scope="col">方向</th>}
                          {category === "charter" && <th scope="col">套餐</th>}
                          {models.length > 1 && <th scope="col">计价方式</th>}
                          {valueFields.map((field) => (
                            <th key={field} scope="col" className="price-table__number">
                              {header(field)}
                            </th>
                          ))}
                          <th scope="col">生效日期 从</th>
                          <th scope="col">到</th>
                          <th scope="col">启用</th>
                          <th scope="col">现在怎么样</th>
                          {!readOnly && (
                            <th scope="col">
                              <span className="visually-hidden">操作</span>
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((row, index) => renderRow(row, index, visible, false))}
                      </tbody>
                    </table>
                  )}
                </div>
                <p className="price-meaning" aria-live="polite">
                  <strong>这一行的意思：</strong>
                  {meaning(false)}
                </p>
              </>
            )}
            {p2p && (
              <section className="card surcharge route-prices" aria-labelledby="route-title">
                <h3 className="surcharge__title" id="route-title" tabIndex={-1}>
                  线路价
                </h3>
                <p className="surcharge__lead">
                  {ROUTE_LEAD}
                  <br />
                  {ROUTE_LEAD_2}
                </p>
                {!readOnly &&
                  (routeAreas.length < 2 ? (
                    <p className="field__hint">
                      这个商品只有一个服务区域，没有跨区域的线路。要设线路价，先在第 ① 步多选一个服务区域。{" "}
                      <Link className="link" to={frame.source.paths.step(product.id, "basic", "areas")}>
                        去第 ① 步选
                      </Link>
                    </p>
                  ) : (
                    <div className="surcharge-pick route-pick">
                      <div className="route-pick__row">
                        <span className="route-pick__label">服务线路</span>
                        <RouteSelects
                          idPrefix="route-pick"
                          areas={routeAreas}
                          value={routePick}
                          disabled={busy}
                          invalid={routePickError !== null}
                          describedBy={routePickError !== null ? "route-pick-error" : undefined}
                          onChange={(next) => {
                            setRoutePick(next);
                            setRoutePickError(null);
                          }}
                        />
                        <Button size="sm" className="route-pick__add" disabled={busy} onClick={confirmRoute}>
                          确认添加
                        </Button>
                      </div>
                      {routePickError !== null && (
                        <p className="field__error" id="route-pick-error">
                          {routePickError}
                        </p>
                      )}
                      <div className="surcharge-pick__links">
                        {canManageAreas && !onPlatform && (
                          <NewTabLink to={`${AREA_NEW_PATH}?biz=point_to_point&role=pricing`} className="link surcharge-pick__new">
                            新增自定义区域
                          </NewTabLink>
                        )}
                        {(onPlatform || canReadAreas) && <AreaMapButton areaIds={areaIds} {...(frame.source.tenantId !== null ? { tenantId: frame.source.tenantId } : {})} />}
                      </div>
                      {canManageAreas && !onPlatform && <p className="field__hint">新区域要先在第 ① 步加进这个商品。</p>}
                    </div>
                  ))}
                {routeRows.length === 0 ? (
                  <p className="surcharge__lead">{onPlatform || readOnly ? "还没有线路价，每条线路都用上面的区域价。" : "还没有线路价，每条线路都用上面的区域价。某条线路要单独定价（例如市区到机场，去和回不一样的价），在上面选上车区域和下车区域，点「确认添加」。"}</p>
                ) : (
                  <>
                    <div className="price-filters">
                      <label className="price-filters__item">
                        <span>车型组</span>
                        <select className="input input--sm select" aria-label="线路价的车型组" value={routeGroup} onChange={(event) => setRouteGroup(event.target.value)}>
                          <option value="all">全部</option>
                          {groups.map((group) => (
                            <option key={group.vehicle_group_id} value={group.vehicle_group_id}>
                              {displayName(group.name).text}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="choice">
                        <input type="checkbox" checked={routeExpired} onChange={(event) => setRouteExpired(event.target.checked)} />
                        <span className="choice__text">{`显示已过期的线路价${routeExpiredCount > 0 ? `（${routeExpiredCount} 条）` : ""}`}</span>
                      </label>
                    </div>
                    <div className="price-table__scroll" id="route-table" tabIndex={-1}>
                      {visibleRoutes.length === 0 ? (
                        <div className="state-block">
                          <h4 className="state-block__title">没有符合条件的线路价</h4>
                          <Button
                            onClick={() => {
                              setRouteGroup("all");
                              setRouteExpired(true);
                            }}
                          >
                            清空筛选
                          </Button>
                        </div>
                      ) : (
                        <table className="price-table" onKeyDown={onTableKey}>
                          <caption className="visually-hidden">线路价：按线路分组，每一行是一条线路价（只管这一个方向）</caption>
                          <thead>
                            <tr>
                              <th scope="col">车型组</th>
                              {models.length > 1 && <th scope="col">计价方式</th>}
                              {valueFields.map((field) => (
                                <th key={field} scope="col" className="price-table__number">
                                  {field === "base" && !hasMileage ? `价格（${context.currency}）` : header(field)}
                                </th>
                              ))}
                              <th scope="col">生效日期 从</th>
                              <th scope="col">到</th>
                              <th scope="col">启用</th>
                              <th scope="col">现在怎么样</th>
                              {!readOnly && (
                                <th scope="col">
                                  <span className="visually-hidden">操作</span>
                                </th>
                              )}
                            </tr>
                          </thead>
                          <tbody>{visibleRoutes.map((row, index) => renderRow(row, index, visibleRoutes, true))}</tbody>
                        </table>
                      )}
                    </div>
                    <p className="price-meaning" aria-live="polite">
                      <strong>这一行的意思：</strong>
                      {meaning(true)}
                    </p>
                  </>
                )}
              </section>
            )}
            {charter && (
              <AreaSurchargeBlock
                state={surcharges}
                product={product}
                groups={groups.map((group) => ({ id: group.vehicle_group_id, name: displayName(group.name).text, passengers: group.passengers, luggage: group.luggage }))}
                packages={coverage.packages}
                currency={context.currency}
                today={context.today}
                readOnly={readOnly}
                busy={busy}
                onPlatform={onPlatform}
                canManageAreas={canManageAreas && !onPlatform}
                areas={onPlatform || canReadAreas ? { status: tenantAreas.state.status, data: tenantAreas.state.data, reload: tenantAreas.reload } : null}
                {...(frame.source.tenantId !== null ? { tenantId: frame.source.tenantId } : {})}
                otherChanges={changes.length}
                conflictKeys={conflictKeys}
                announce={setAnnounce}
                packagePrice={charterPackagePrice}
                focusRow={(key) => requestAnimationFrame(() => focusAnchor(surchargeCellId(key, "pickup")))}
              />
            )}
            {distancePriceAllowed(category) && !onPlatform && <DistancePriceBlock frame={frame} currency={context.currency} today={context.today} />}
            {p2p && (
              <>
                <AddRouteDialog
                  draft={routeDraft}
                  setDraft={setRouteDraft}
                  rows={rows}
                  context={context}
                  models={models}
                  groups={groups.map((group) => ({ id: group.vehicle_group_id, name: displayName(group.name).text }))}
                  priced={routeDraft ? pricedGroups(rows, routeDraft.route, context) : new Set()}
                  areaName={areaName}
                  pending={pendingChanges}
                  onSubmit={addRoute}
                />
                <CopyRouteDialog draft={copyDraft} setDraft={setCopyDraft} rows={rows} context={context} areas={routeAreas} groupName={groupName} groupOrder={groupIds} areaName={areaName} pending={pendingChanges} onSubmit={copyRoute} />
              </>
            )}
            <Dialog
              open={addingPackage !== null}
              size="form"
              title="新增套餐"
              onClose={() => setAddingPackage(null)}
              footer={
                <>
                  <Button variant="secondary" onClick={() => setAddingPackage(null)}>
                    取消
                  </Button>
                  <Button variant="primary" onClick={addPackage}>
                    新增
                  </Button>
                </>
              }
            >
              {addingPackage && (
                <div className="form">
                  {(["hours", "km"] as const).map((field) => {
                    const issue = addingPackage.attempted ? packageIssue(addingPackage)[field] : null;
                    return (
                      <div key={field} className="field">
                        <label className="field__label" htmlFor={`package-${field}`}>
                          {field === "hours" ? "套餐时长（小时）" : "套餐公里（公里）"}
                          <span className="field__required" aria-hidden="true">
                            {" *"}
                          </span>
                        </label>
                        <input className="input" id={`package-${field}`} inputMode="numeric" autoComplete="off" {...(field === "hours" ? { "data-autofocus": true } : {})} aria-invalid={issue !== null || undefined} value={addingPackage[field]} onChange={(event) => setAddingPackage({ ...addingPackage, [field]: event.target.value })} />
                        {issue !== null && <p className="field__error">{issue}</p>}
                        {field === "km" && <p className="field__hint">先给这个套餐的每一行都填上这个公里数，之后可以在表格里一行一行改。</p>}
                      </div>
                    );
                  })}
                </div>
              )}
            </Dialog>
            <Dialog
              open={removingPackage !== null}
              title={`删除 ${removingPackage ?? ""} 小时套餐？`}
              onClose={() => setRemovingPackage(null)}
              footer={
                <>
                  <Button variant="secondary" data-autofocus onClick={() => setRemovingPackage(null)}>
                    取消
                  </Button>
                  <Button className="button--danger-text" onClick={() => removingPackage !== null && removePackage(removingPackage)}>
                    标成将删除
                  </Button>
                </>
              }
            >
              <p>{`这个套餐下的 ${rows.filter((row) => row.packageHours === removingPackage && row.id !== null).length} 条价格会标成「将删除」，点保存后才真的删除。`}</p>
            </Dialog>
          </>
        );
      }}
    </StepShell>
  );
}
