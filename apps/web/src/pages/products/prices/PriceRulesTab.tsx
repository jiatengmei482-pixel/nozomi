/**
 * 「价格规则」页签（docs/design/pages/tenant-prices.md 第 3、4 节）：覆盖表 + 可编辑的价格表。
 * 表里每一行是一条价格；每个还没有价格的组合也占一行，空着等填。改完一批，一次保存（全部成功或一条都不保存）。
 * 行怎么读、缺不缺价、日期重不重叠都在 lib/price-form.ts（规则来自 @nozomi/domain）。
 */
import { PRICE_DIRECTIONS, PRICE_LIMITS, PRICING_MODEL_NAMES, type PriceDirection, type PriceRule, type PricingModel, VEHICLE_GRADES, addDays, applyAdjustRules, basePrice } from "@nozomi/domain";
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
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
} from "../../../lib/price-form.ts";
import { comboText, moneyText, readAmount } from "../../../lib/product-display.ts";
import type { ServerIssue } from "../../../lib/product-failure.ts";
import { tidyDate } from "../../../lib/time-input.ts";
import { type StepController, StepShell } from "../StepShell.tsx";
import { type StepProblem, focusAnchor } from "../frame.ts";
import { useDownload } from "../inventory/useDownload.tsx";
import { importPath } from "../../../lib/product-paths.ts";
import type { PricesShared } from "./PricesStep.tsx";

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
const FIELD_UNITS: Readonly<Partial<Record<PriceField, string>>> = { startKm: "公里", startMin: "分钟", pkgKm: "公里" };
const FIELD_PER: Readonly<Partial<Record<PriceField, string>>> = { perKm: " / 公里", perMin: " / 分钟", overHour: " / 小时", overKm: " / 公里" };
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
  const { token } = usePortalSession();
  const category = product.category;
  const station = isStationPlace(product.poi?.type);
  const context: PriceContext = useMemo(() => ({ category, currency: prices.currency, today: prices.today, station }), [category, prices.currency, prices.today, station]);
  const areaIds = useMemo(() => product.areas.map((area) => area.area_id), [product.areas]);
  const groups = useMemo(() => [...product.vehicle_groups].sort((x, y) => VEHICLE_GRADES.indexOf(x.grade) - VEHICLE_GRADES.indexOf(y.grade) || x.seats - y.seats || x.code.localeCompare(y.code)), [product.vehicle_groups]);
  const groupIds = useMemo(() => groups.map((group) => group.vehicle_group_id), [groups]);
  const models = prices.available_models;
  const defaultModel: PricingModel = models[0] ?? (category === "charter" ? "charter_package" : "fixed");

  const fresh = (data: PriceRules, extraPackages: readonly number[] = []): PriceRow[] => withBlankRows(data.items.map((item) => rowFromRule(item, data.currency)), context, areaIds, groupIds, defaultModel, extraPackages);
  const download = useDownload();
  const [rows, setRows] = useState<PriceRow[]>(() => fresh(prices));
  const adopted = useRef(prices);
  // 重新取到了价格（别人先改了之后「载入最新内容」）：换成最新的，没保存的修改重新套上去
  useEffect(() => {
    if (adopted.current === prices) return;
    adopted.current = prices;
    setRows((current) => {
      const base = prices.items.map((item) => rowFromRule(item, prices.currency));
      const byId = new Map(base.map((row) => [row.id, row]));
      const extra: PriceRow[] = [];
      for (const old of current) {
        const change = rowChange(old, readRow(old, context));
        if (change === "none" || change === "blank") continue;
        const latest = old.id === null ? undefined : byId.get(old.id);
        if (latest) Object.assign(latest, { direction: old.direction, model: old.model, values: old.values, from: old.from, to: old.to, enabled: old.enabled, deleted: old.deleted });
        else if (change !== "deleted") extra.push({ ...old, id: null, origin: null, key: old.id === null ? old.key : `re-${old.key}` });
      }
      return withBlankRows([...base, ...extra], context, areaIds, groupIds, defaultModel);
    });
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
  const sent = useRef<{ payload: string; key: string; batch: PriceRuleBatch } | null>(null);

  const readings = useMemo(() => new Map(rows.map((row) => [row.key, readRow(row, context)])), [rows, context]);
  const overlaps = useMemo(() => rowOverlaps(rows, context), [rows, context]);
  const coverage = useMemo(() => tableCoverage(rows, context, areaIds, groupIds), [rows, context, areaIds, groupIds]);
  const changes = rows.filter((row) => !["none", "blank"].includes(rowChange(row, readings.get(row.key) ?? readRow(row, context))));
  const hasMileage = rows.some((row) => row.model === "mileage_time" && !row.deleted);
  const valueFields: readonly PriceField[] = category === "charter" ? MODEL_FIELDS.charter_package : hasMileage ? MODEL_FIELDS.mileage_time : MODEL_FIELDS.fixed;

  const areaName = (id: string): string => displayName(product.areas.find((area) => area.area_id === id)?.name).text;
  const groupName = (id: string): string => displayName(product.vehicle_groups.find((group) => group.vehicle_group_id === id)?.name).text;
  const variantName = (row: Pick<PriceRow, "direction" | "packageHours">): string => (row.direction !== null ? directionName(row.direction, station) : row.packageHours !== null ? `${row.packageHours} 小时` : "");
  const rowLabel = (row: PriceRow): string => [areaName(row.areaId), groupName(row.vehicleGroupId), variantName(row)].filter((part) => part !== "").join(" · ");

  const order = (row: PriceRow): string => {
    const area = String(areaIds.indexOf(row.areaId) < 0 ? 9999 : areaIds.indexOf(row.areaId)).padStart(4, "0");
    const group = String(groupIds.indexOf(row.vehicleGroupId) < 0 ? 9999 : groupIds.indexOf(row.vehicleGroupId)).padStart(4, "0");
    const variant = row.direction !== null ? String(["both", "pickup", "dropoff"].indexOf(row.direction)) : String(row.packageHours ?? 0).padStart(3, "0");
    return `${area}|${group}|${variant}|${row.from}|${row.key}`;
  };
  const sorted = useMemo(() => [...rows].sort((x, y) => order(x).localeCompare(order(y))), [rows, areaIds, groupIds]);
  const stateOf = (row: PriceRow): { state: RowState; text: string } => {
    const base = rowState(row, readings.get(row.key) ?? readRow(row, context), overlaps.has(row.key) || conflictKeys.has(row.key), context, rows);
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
  const validate = (): StepProblem[] => {
    const found: StepProblem[] = [];
    for (const row of sorted) {
      if (row.deleted) continue;
      for (const problem of readings.get(row.key)?.problems ?? []) found.push({ text: `${rowLabel(row)}：${problem.text}`, target: cellId(row.key, problem.field) });
    }
    for (const group of overlapGroups()) found.push({ text: `生效日期重叠——${group.text}`, target: group.target });
    if (found.length === 0 && changes.length > PRICE_LIMITS.maxBatchChanges) found.push({ text: `一次最多保存 ${PRICE_LIMITS.maxBatchChanges} 条。请先取消一部分修改，或分两次保存。`, target: "price-table" });
    if (found.length === 0 && product.status === "published" && changes.length > 0 && coverage.priced === 0 && !rows.some((row) => !row.deleted && readings.get(row.key)?.rule?.status === "enabled" && (readings.get(row.key)?.rule?.validTo ?? "9999") >= context.today)) {
      found.push({ text: "这个商品已上架，至少要留 1 条启用、没过期的价格。要把价格全部停掉，请先下架。", target: "price-table" });
    }
    return found;
  };
  const submit = async (): Promise<string> => {
    setRejection(null);
    const batch = buildBatch(rows, context);
    const payload = JSON.stringify(batch);
    // 同样的内容重试用同一个幂等键；内容变了就换一个
    if (sent.current?.payload !== payload) sent.current = { payload, key: crypto.randomUUID(), batch };
    const saved = await savePriceRules(token, product.id, frame.version, batch, sent.current.key);
    sent.current = null;
    adopted.current = saved;
    setRows(fresh(saved));
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
      const row = match ? batchRow(match[1] ?? "", Number(match[2]), issue.detail) : undefined;
      if (!row) return [];
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
    if (err.code === "PUBLISH_CHECK_FAILED") {
      setRejection({ title: "没有保存。", text: "这个商品已上架，至少要留 1 条启用、没过期的价格。要把价格全部停掉，请先下架。", items: [] });
      return true;
    }
    if (err.code !== "PRICE_RULE_CONFLICT") return false;
    const conflicts = Array.isArray(err.details["conflicts"]) ? (err.details["conflicts"] as { id?: string; ref?: string; valid_from?: string; valid_to?: string | null; with?: { id?: string; ref?: string; valid_from?: string; valid_to?: string | null }[] }[]) : [];
    const find = (entry: { id?: string; ref?: string }): PriceRow | undefined => rows.find((row) => (entry.id !== undefined && row.id === entry.id) || (entry.ref !== undefined && row.key === entry.ref));
    const span = (entry: { valid_from?: string; valid_to?: string | null }): string => (entry.valid_to ? `${entry.valid_from} 至 ${entry.valid_to}` : `${entry.valid_from} 起一直有效`);
    const keys = new Set<string>();
    const items: StepProblem[] = [];
    let unknown = conflicts.length === 0;
    for (const conflict of conflicts) {
      const row = find(conflict);
      if (!row) {
        unknown = true;
        continue;
      }
      keys.add(row.key);
      for (const other of conflict.with ?? []) {
        const otherRow = find(other);
        if (otherRow) keys.add(otherRow.key);
        else unknown = true;
        items.push({ text: `${rowLabel(row)}：${span(conflict)} ↔ ${span(other)}${otherRow ? "" : "（别人刚加的）"}`, target: cellId(row.key, "from") });
      }
    }
    setConflictKeys(keys);
    setRejection({ title: "没有保存。", text: `有 ${Math.max(1, conflicts.length)} 条价格的生效日期和已有的价格重叠，所以这一批都没有保存。改好以后再点保存。${unknown ? "请点「重新读取价格」后再检查。" : ""}`, items, reload: unknown });
    return true;
  };
  useEffect(() => {
    if (rejection) document.getElementById("price-rejection")?.focus();
  }, [rejection]);

  const controller: StepController = {
    dirty: changes.length > 0,
    missing: { count: 0, anchor: null },
    validate,
    submit,
    placeServerIssues,
    handleRejection,
    reload: shared.reloadPrices,
    keepsEditsOnReload: true,
    successText: () => {
      const batch = buildBatch(rows, context);
      return batch.create.length + batch.update.length === 0 ? `已删除 ${batch.delete.length} 条价格` : `已保存 ${batch.create.length + batch.update.length + batch.delete.length} 条价格`;
    },
    summary:
      changes.length > 0 ? (
        <span className={changes.length >= 400 ? "price-summary price-summary--warning" : "price-summary"}>{changes.length >= 400 ? `未保存的修改已经有 ${changes.length} 条，一次最多保存 ${PRICE_LIMITS.maxBatchChanges} 条，请先保存。` : `有 ${changes.length} 条未保存的修改`}</span>
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
  const meaning = (): ReactNode => {
    if (!focusedRow) return "点表格里的任何一行，这里会用一句话说明这一行的价格。";
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
    const overlapWith = (overlaps.get(focusedRow.key) ?? []).map((key) => rows.find((row) => row.key === key)).filter((row): row is PriceRow => row !== undefined);
    return (
      <>
        {reading.rule ? `${label}——${pricingSentence(reading.rule.pricing, reading.rule.packageHours, context.currency)}${validitySentence(reading.rule)}` : `${label}——`}
        {reading.problems.map((problem) => (
          <strong key={`${problem.field}${problem.text}`} className="price-meaning__problem">{` ${problem.text}。`}</strong>
        ))}
        {reading.notes.map((note) => (
          <span key={note}>{` ${note}`}</span>
        ))}
        {roundedNote(reading.rule)}
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

  const noPackages = category === "charter" && coverage.packages.length === 0;
  const header = (field: PriceField): string => {
    const name = field === "base" ? (hasMileage ? "基础价 / 起步价" : "基础价") : fieldName(field, category === "charter" ? "charter_package" : "mileage_time");
    return FIELD_UNITS[field] ? `${name}（${FIELD_UNITS[field]}）` : `${name}（${context.currency}${FIELD_PER[field] ?? ""}）`;
  };

  return (
    <StepShell frame={frame} slug="prices" title="③ 价格规则" hideTitle next={{ slug: "inventory", label: "保存并下一步" }} controller={controller}>
      {({ busy }) => {
        const locked = busy || readOnly;
        const groupsOverlap = overlapGroups();
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
                    <h3 className="coverage__title" id="coverage-title">
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
                    </h3>
                    <Button size="sm" variant="text" aria-expanded={coverageOpen} aria-controls="coverage-table" onClick={() => setCoverageOpen(!coverageOpen)}>
                      {coverageOpen ? "收起覆盖表" : "展开覆盖表"}
                    </Button>
                  </div>
                  <p className="field__hint">{coverage.priced === 0 ? "在下面的表格里填。每一行是一个组合，填上价格、点保存就行。" : coverage.missing > 0 ? "没有价格的组合，客人询价时报不出价。" : ""}</p>
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
                          {changes.length > 0 && <span className="menu-item__note">不含你没保存的修改</span>}
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
                </div>

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
                        {visible.map((row, index) => {
                          const reading = readings.get(row.key) ?? readRow(row, context);
                          const state = stateOf(row);
                          const look = STATE_LOOK[state.state];
                          const label = rowLabel(row);
                          const bad = (field: RowField): true | undefined => (reading.problems.some((problem) => problem.field === field) || ((field === "from" || field === "to") && state.state === "overlap") ? true : undefined);
                          const group = product.vehicle_groups.find((entry) => entry.vehicle_group_id === row.vehicleGroupId);
                          const area = product.areas.find((entry) => entry.area_id === row.areaId);
                          const firstOfArea = index === 0 || visible[index - 1]?.areaId !== row.areaId;
                          const rowLocked = locked || row.deleted;
                          const flag = ["error", "overlap"].includes(state.state) ? " price-table__row--error" : ["new", "changed"].includes(state.state) ? " price-table__row--unsaved" : "";
                          const cell = (field: PriceField): ReactNode => {
                            if (!MODEL_FIELDS[row.model].includes(field)) return <span className="table__muted">—</span>;
                            const money = !FIELD_UNITS[field];
                            return (
                              <input
                                className="input input--sm input--mono price-table__input"
                                id={cellId(row.key, field)}
                                data-col={field}
                                type="text"
                                inputMode={money ? "decimal" : "numeric"}
                                autoComplete="off"
                                aria-label={`${label} 的${fieldName(field, row.model)}`}
                                aria-invalid={bad(field)}
                                readOnly={rowLocked}
                                placeholder={field === "min" ? "不设" : undefined}
                                value={row.values[field]}
                                onChange={(event) => update(row.key, {}, { [field]: event.target.value })}
                                onFocus={(event) => {
                                  // 再聚焦时变回纯数字并全选，方便直接重填。先把输入框里的字换好再全选、然后才记到页面状态里：
                                  // 这样重新渲染时输入框的内容和状态一样，选中的范围不会丢（丢了的话，新敲的数会接在旧数后面）
                                  const input = event.currentTarget;
                                  const plain = money ? row.values[field].replace(/,/g, "") : row.values[field];
                                  if (plain !== input.value) input.value = plain;
                                  input.select();
                                  if (plain !== row.values[field]) update(row.key, {}, { [field]: plain });
                                }}
                                onBlur={() => {
                                  if (!money) return;
                                  const amount = readAmount(row.values[field].replace(/,/g, ""), context.currency);
                                  if (amount.ok && row.values[field].trim() !== "") update(row.key, {}, { [field]: moneyText(amount.minor, context.currency).slice(context.currency.length).trim() });
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
                              aria-label={`${label} 的生效日期${field === "from" ? "从" : "到"}`}
                              aria-invalid={bad(field)}
                              placeholder={field === "to" ? "一直有效" : "2026-01-31"}
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
                            <tr key={row.key} id={`price-row-${row.key}`} className={`price-table__row${flag}${firstOfArea ? " price-table__row--first" : ""}${row.deleted ? " price-table__row--deleted" : ""}`} onFocus={() => setFocused(row.key)}>
                              <th scope="row">
                                <span className={firstOfArea ? undefined : "visually-hidden"}>{displayName(area?.name).text}</span>
                                {firstOfArea && area?.status === "disabled" && <StatusBadge tone="neutral" label="已停用" />}
                              </th>
                              <td>
                                {displayName(group?.name).text}
                                {group && <span className="product-code">{comboText(group.passengers, group.luggage)}</span>}
                              </td>
                              {category === "airport_transfer" && (
                                <td>
                                  <select className="input input--sm select" id={cellId(row.key, "direction")} aria-label={`${label} 的方向`} disabled={rowLocked} value={row.direction ?? "both"} onChange={(event) => update(row.key, { direction: event.target.value as PriceDirection })}>
                                    {(["both", "pickup", "dropoff"] as const).filter((direction) => (PRICE_DIRECTIONS as readonly string[]).includes(direction)).map((direction) => (
                                      <option key={direction} value={direction}>
                                        {directionName(direction, station)}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                              )}
                              {category === "charter" && <td>{`${row.packageHours ?? ""} 小时`}</td>}
                              {models.length > 1 && (
                                <td>
                                  <select className="input input--sm select" aria-label={`${label} 的计价方式`} disabled={rowLocked} value={row.model} onChange={(event) => update(row.key, { model: event.target.value as PricingModel })}>
                                    {models.map((model) => (
                                      <option key={model} value={model}>
                                        {model === "fixed" ? "一口价" : PRICING_MODEL_NAMES[model]}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                              )}
                              {valueFields.map((field) => (
                                <td key={field} className="price-table__number">
                                  {cell(field)}
                                </td>
                              ))}
                              <td>{date("from")}</td>
                              <td>{date("to")}</td>
                              <td>{readOnly ? (reading.blank ? "—" : row.enabled ? "启用" : "已停用") : <input type="checkbox" aria-label={`启用这条价格：${label}`} checked={row.enabled} disabled={rowLocked} onChange={(event) => update(row.key, { enabled: event.target.checked })} />}</td>
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
                                  <Dropdown buttonClassName="icon-button" buttonContent={<Icon name="more" />} label={`${label} 的更多操作`} align="end">
                                    <button
                                      type="button"
                                      role="menuitem"
                                      className="menu-item"
                                      disabled={busy || reading.blank}
                                      onClick={() => {
                                        const next = reading.rule?.validTo ? addDays(reading.rule.validTo, 1) : "";
                                        const added: PriceRow = { ...blankRow({ areaId: row.areaId, vehicleGroupId: row.vehicleGroupId, direction: row.direction, packageHours: row.packageHours }, row.model, context.today, row.values), from: next, enabled: row.enabled };
                                        setRows((current) => [...current, added]);
                                        requestAnimationFrame(() => focusAnchor(cellId(added.key, "from")));
                                      }}
                                    >
                                      <span className="menu-item__text">再加一段日期</span>
                                    </button>
                                    {row.id === null ? (
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
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
                <p className="price-meaning" aria-live="polite">
                  <strong>这一行的意思：</strong>
                  {meaning()}
                </p>
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
