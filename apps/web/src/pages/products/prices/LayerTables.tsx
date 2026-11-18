/**
 * 包车三层区域的价格页（M9P-07，ADR 0093 第一、五、七节；规格第四节）：只给迁移过的商品（`charter_layout = three_layer`）用，
 * 没迁移过的商品照旧显示「基础定价」+「区域加价」（AreaSurchargeBlock）。
 * - 「行程加价」（②，一格金额）、「上下车加价」（③，上车、下车两格）两张表：按「区域 × 车型组」填，空格 = 不报价，表头汇总「N 格没填」；
 * - 「上下车加价」的区域下拉里商品的基础价区域（服务区域）灰掉；已有的「基础价区域上的上下车加价」行标红、可以删、不算未保存，批量保存不提交它们；
 * - 「旧的按区域套餐价」折叠、只读；价格页顶部「迁移差异 N 条」（M9P-05 的只读接口）。
 * 状态由页签（PriceRulesTab）持有：和价格表共用一个保存（改完一批，一次批量保存，同一事务）。金额都是结算价（规则 4：没有对外价、加价比例）。
 */
import { type LocalizedText, areaUsableByCategory } from "@nozomi/domain";
import { type ReactNode, useMemo, useState } from "react";
import type { AreaSummary as TenantArea } from "../../../api/areas.ts";
import { type CharterMigrationDiff, type CharterPackageTerms, type PriceRuleBatch, type PriceRuleBody, type PriceRules, ruleAreaId } from "../../../api/prices.ts";
import type { Product } from "../../../api/products.ts";
import { Alert } from "../../../components/Alert.tsx";
import { Button } from "../../../components/Button.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { NewTabLink } from "../../../components/NewTabLink.tsx";
import { AREA_NEW_PATH } from "../../../lib/area-paths.ts";
import { pricingCapable } from "../../../lib/area-roles.ts";
import {
  LAYER_FIELDS,
  LAYER_FIELD_NAMES,
  LAYER_TEXT,
  type LayerAmountField,
  type LayerField,
  type LayerModel,
  type LayerRow,
  blankLayerRow,
  buildLayerBatch,
  layerChange,
  layerChangeCount,
  layerOverlaps,
  layerRowsOf,
  layerState,
  migrationDiffText,
  missingCells,
  readLayerRow,
} from "../../../lib/charter-layers.ts";
import { displayName } from "../../../lib/master-display.ts";
import { comboText, moneyText, plainAmountDisplay, tidyAmountDisplay } from "../../../lib/product-display.ts";
import { tidyDate } from "../../../lib/time-input.ts";
import type { SurchargeGroup } from "./AreaSurchargeBlock.tsx";

export const layerCellId = (key: string, field: LayerField): string => `layer-${key}-${field}`;

export interface LayerState {
  model: LayerModel;
  rows: LayerRow[];
  setRows(update: (rows: LayerRow[]) => LayerRow[]): void;
  /** 这次新加、还没保存过的区域（按添加的先后） */
  added: string[];
  setAdded(next: string[]): void;
  /** 已保存的区域，按服务器给的顺序 */
  savedOrder: string[];
  /** 挡住的区域（商品的基础价区域上的③）：只提交删除 */
  blocked: ReadonlySet<string>;
  changeCount: number;
  batch(): PriceRuleBatch;
  /** 保存成功、或重新读取以后：换成最新的（`keepEdits` 时没保存的修改重新套上去） */
  adopt(data: PriceRules, keepEdits: boolean): void;
}

const savedAreas = (data: PriceRules, model: LayerModel): string[] => [...new Set(data.items.filter((item) => item.pricing_model === model).map(ruleAreaId))];

export function useLayerRows(prices: PriceRules, model: LayerModel, blockedIds: readonly string[]): LayerState {
  const currency = prices.currency;
  const [rows, setRowsState] = useState<LayerRow[]>(() => layerRowsOf(prices, model));
  const [added, setAdded] = useState<string[]>([]);
  const [savedOrder, setSavedOrder] = useState<string[]>(() => savedAreas(prices, model));
  const blockedKey = blockedIds.join(",");
  const blocked = useMemo<ReadonlySet<string>>(() => new Set(blockedIds), [blockedKey]);
  const changeCount = useMemo(() => layerChangeCount(rows, currency, blocked), [rows, currency, blocked]);
  return {
    model,
    rows,
    setRows: (update) => setRowsState(update),
    added,
    setAdded,
    savedOrder,
    blocked,
    changeCount,
    batch: () => buildLayerBatch(rows, currency, blocked),
    adopt: (data, keepEdits) => {
      const base = layerRowsOf(data, model);
      setSavedOrder(savedAreas(data, model));
      if (!keepEdits) {
        setRowsState(base);
        setAdded([]);
        return;
      }
      // 我改过的行留我的（同一条别人也改了时也留我的），没动过的换成最新的
      const byId = new Map(base.map((row, index) => [row.id, index]));
      const merged = [...base];
      const extra: LayerRow[] = [];
      for (const old of rows) {
        const change = layerChange(old, readLayerRow(old, data.currency));
        if (change === "none" || change === "blank") continue;
        const at = old.id === null ? undefined : byId.get(old.id);
        if (at !== undefined) merged[at] = { ...old, origin: (merged[at] as LayerRow).origin };
        else if (change !== "deleted") extra.push({ ...old, id: null, origin: null });
      }
      setRowsState([...merged, ...extra]);
    },
  };
}

type AreaLoad = { status: "loading" | "error" | "ready" | "forbidden" | "not-found"; data: TenantArea[] | null; reload(): void } | null;

/** 一张加价表（②行程加价 / ③上下车加价）。 */
export function LayerTable(props: {
  state: LayerState;
  title: string;
  headingId: string;
  lead: ReactNode;
  product: Product;
  groups: readonly SurchargeGroup[];
  currency: string;
  today: string;
  readOnly: boolean;
  busy: boolean;
  onPlatform: boolean;
  canManageAreas: boolean;
  areas: AreaLoad;
  conflictKeys: ReadonlySet<string>;
  /** 保存被拒时这张表的区域重叠（两个区域名和面积） */
  overlapNotes: readonly string[];
  /** 被拒的重叠里出现的区域：在区域那一行标出来 */
  overlapAreaIds: ReadonlySet<string>;
  announce(text: string): void;
}) {
  const { state, title, product, groups, currency, today, readOnly, busy, onPlatform, areas } = props;
  const { rows, added, savedOrder, blocked, model } = state;
  const updown = model === "charter_area_surcharge";
  const locked = busy || readOnly;
  const fields: readonly LayerAmountField[] = LAYER_FIELDS[model];
  const productAreaIds = product.areas.map((area) => area.area_id);
  const areaList = areas?.data ?? [];
  const areaById = useMemo(() => new Map(areaList.map((area) => [area.id, area])), [areaList]);
  const groupIds = groups.map((group) => group.id);
  const [picked, setPicked] = useState("");
  const [pickError, setPickError] = useState<string | null>(null);
  const idPrefix = updown ? "updown" : "itinerary";

  const nameOf = (id: string): string => {
    const area = areaById.get(id);
    if (area) return displayName(area.name).text;
    const own = product.areas.find((entry) => entry.area_id === id);
    if (own) return displayName(own.name).text;
    return areas?.status === "ready" ? "（已删除的区域）" : "（区域）";
  };
  const groupName = (id: string): string => groups.find((group) => group.id === id)?.name ?? "已移除的车型组";
  const packageText = (hours: number | null): string => (hours === null ? LAYER_TEXT.allPackages : `${hours} 小时`);
  const rowLabel = (row: LayerRow): string => `${title} · ${nameOf(row.areaId)} · ${groupName(row.vehicleGroupId)}${row.packageHours === null ? "" : ` · ${row.packageHours} 小时`}`;

  const listed = [...savedOrder, ...added.filter((id) => !savedOrder.includes(id))];
  const overlaps = useMemo(() => layerOverlaps(rows, currency, blocked), [rows, currency, blocked]);
  const missing = missingCells(rows, listed, groupIds, currency, today, blocked);

  // ── 选区域：本供应商启用中、能挂价格、包车能用的；已添加的列出但不能选；上下车加价的基础价区域灰掉（ADR 0093 第七节第 3 条） ──
  const usable = pricingCapable(areaList.filter((area) => area.status === "active" && areaUsableByCategory("charter", area.biz_type)));
  const optionNote = (id: string): string | null => (updown && productAreaIds.includes(id) ? LAYER_TEXT.baseAreaOption : listed.includes(id) ? "已添加" : null);
  const selectable = usable.filter((area) => optionNote(area.id) === null);
  const canPick = !readOnly && !onPlatform && areas !== null;
  const addArea = (): void => {
    if (picked === "") {
      setPickError("请先选一个区域");
      document.getElementById(`${idPrefix}-area`)?.focus();
      return;
    }
    setPickError(null);
    state.setAdded([...added, picked]);
    props.announce(`已添加「${nameOf(picked)}」，在下面按车型组填${title}，还没有保存`);
    const first = groupIds[0];
    const area = picked;
    setPicked("");
    if (first !== undefined) requestAnimationFrame(() => document.getElementById(layerCellId(blankLayerRow(model, area, first, today).key, fields[0] ?? "amount"))?.focus());
  };
  const dropArea = (areaId: string): void => {
    state.setRows((current) => current.filter((row) => !(row.areaId === areaId && row.id === null)));
    state.setAdded(added.filter((id) => id !== areaId));
    props.announce(`已去掉「${nameOf(areaId)}」`);
  };

  const update = (row: LayerRow, change: Partial<LayerRow>): void => {
    state.setRows((current) => (current.some((entry) => entry.key === row.key) ? current.map((entry) => (entry.key === row.key ? { ...entry, ...change } : entry)) : [...current, { ...row, ...change }]));
  };
  /** 一个区域的行：每个车型组至少一行（没填的空着等填）；已有的按套餐分的行原样列出；挡住的区域不补空行 */
  const areaRows = (areaId: string): LayerRow[] => {
    const own = rows.filter((row) => row.areaId === areaId);
    const result: LayerRow[] = [];
    for (const groupId of groupIds) {
      const mine = own.filter((row) => row.vehicleGroupId === groupId).sort((x, y) => (x.packageHours ?? 0) - (y.packageHours ?? 0) || x.from.localeCompare(y.from));
      result.push(...(mine.length > 0 ? mine : blocked.has(areaId) ? [] : [blankLayerRow(model, areaId, groupId, today)]));
    }
    result.push(...own.filter((row) => !groupIds.includes(row.vehicleGroupId)));
    return result;
  };

  const amountCell = (row: LayerRow, field: LayerAmountField, rowLocked: boolean, bad: boolean): ReactNode => {
    const empty = row[field].trim() === "";
    if (readOnly || rowLocked) return <span className={empty ? "table__muted" : "surcharge-detail__text"}>{empty ? LAYER_TEXT.emptyCell : row[field]}</span>;
    return (
      <input
        className="input input--sm input--mono price-table__input"
        id={layerCellId(row.key, field)}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label={`${rowLabel(row)} 的${LAYER_FIELD_NAMES[field]}`}
        placeholder={LAYER_TEXT.emptyCell}
        aria-invalid={bad || undefined}
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
  };
  const dateCell = (row: LayerRow, field: "from" | "to", rowLocked: boolean, bad: boolean): ReactNode => {
    if (readOnly || rowLocked) return <span className="surcharge-detail__text">{row[field] === "" ? (field === "to" ? "一直有效" : "—") : row[field]}</span>;
    return (
      <input
        className="input input--sm input--mono price-table__date"
        id={layerCellId(row.key, field)}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        aria-label={`${rowLabel(row)} 的生效日期${field === "from" ? "从" : "到"}`}
        aria-invalid={bad || undefined}
        placeholder={field === "to" ? "一直有效" : "年-月-日"}
        value={row[field]}
        onChange={(event) => update(row, { [field]: event.target.value })}
        onBlur={() => {
          const tidy = tidyDate(row[field]);
          if (tidy !== null && tidy !== row[field]) update(row, { [field]: tidy });
        }}
      />
    );
  };

  const TONES: Readonly<Record<string, string>> = { error: "danger", overlap: "danger", deleted: "muted", new: "info", changed: "info", blank: "warning", disabled: "muted", expired: "muted", upcoming: "info", active: "success" };
  const renderRow = (row: LayerRow): ReactNode => {
    const reading = readLayerRow(row, currency);
    const onBase = blocked.has(row.areaId);
    const overlapping = !onBase && (overlaps.has(row.key) || props.conflictKeys.has(row.key));
    const look = layerState(row, reading, overlapping, today);
    const rowLocked = locked || row.deleted || onBase;
    const bad = (field: LayerField): boolean => !onBase && (reading.problems.some((problem) => problem.field === field) || ((field === "from" || field === "to") && overlapping));
    const red = (onBase && !row.deleted) || look.state === "error" || look.state === "overlap";
    const flag = red ? " price-table__row--error" : look.state === "new" || look.state === "changed" ? " price-table__row--unsaved" : "";
    const group = groups.find((entry) => entry.id === row.vehicleGroupId);
    const label = rowLabel(row);
    return (
      <tr key={row.key} id={`layer-row-${row.key}`} className={`price-table__row${flag}${row.deleted ? " price-table__row--deleted" : ""}`} data-base-area={onBase || undefined}>
        <th scope="row">
          {groupName(row.vehicleGroupId)}
          {group && <span className="product-code">{comboText(group.passengers, group.luggage)}</span>}
        </th>
        <td>{packageText(row.packageHours)}</td>
        {fields.map((field) => (
          <td key={field} className="price-table__number">
            {amountCell(row, field, rowLocked, bad(field))}
          </td>
        ))}
        <td>{dateCell(row, "from", rowLocked, bad("from"))}</td>
        <td>{dateCell(row, "to", rowLocked, bad("to"))}</td>
        <td>{readOnly || onBase ? (reading.blank ? "—" : row.enabled ? "启用" : "已停用") : <input type="checkbox" aria-label={`启用这一条：${label}`} checked={row.enabled} disabled={rowLocked} onChange={(event) => update(row, { enabled: event.target.checked })} />}</td>
        <td>
          <span className={`price-state price-state--${onBase && !row.deleted ? "danger" : (TONES[look.state] ?? "muted")}`}>
            <Icon name={onBase && !row.deleted ? "alert-circle" : look.state === "active" ? "check" : look.state === "blank" ? "alert-triangle" : look.state === "error" || look.state === "overlap" ? "alert-circle" : look.state === "upcoming" ? "clock" : look.state === "new" || look.state === "changed" ? "circle" : "minus"} />
            {onBase && !row.deleted ? LAYER_TEXT.baseAreaRow : look.text}
          </span>
        </td>
        {!readOnly && (
          <td>
            {row.id !== null ? (
              <Button size="sm" variant="text" className={onBase && !row.deleted ? "button--danger-text" : undefined} disabled={busy} aria-label={`${row.deleted ? "撤销删除" : onBase ? LAYER_TEXT.deleteRow : "删除"}：${label}`} onClick={() => update(row, { deleted: !row.deleted })}>
                {row.deleted ? "撤销删除" : onBase ? LAYER_TEXT.deleteRow : "删除"}
              </Button>
            ) : !reading.blank ? (
              <Button size="sm" variant="text" disabled={busy} aria-label={`清空这一行：${label}`} onClick={() => state.setRows((current) => current.filter((entry) => entry.key !== row.key))}>
                清空
              </Button>
            ) : null}
          </td>
        )}
      </tr>
    );
  };

  const columns = 6 + fields.length + (readOnly ? 0 : 1);
  return (
    <section className="card surcharge" aria-labelledby={props.headingId} data-layer={model}>
      <h3 className="surcharge__title" id={props.headingId} tabIndex={-1}>
        {title}
        {missing > 0 && (
          <span className="surcharge__missing">
            <Icon name="alert-triangle" />
            {`${missing} 格没填`}
          </span>
        )}
      </h3>
      <p className="surcharge__lead">{props.lead}</p>
      {props.overlapNotes.length > 0 && (
        <Alert kind="danger">
          <strong className="alert__title">没有保存：区域重叠。</strong>
          <span className="error-summary__list">
            {props.overlapNotes.map((note) => (
              <span key={note}>{note}</span>
            ))}
          </span>
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
                <label className="visually-hidden" htmlFor={`${idPrefix}-area`}>
                  {`选择要设${title}的区域`}
                </label>
                <select
                  id={`${idPrefix}-area`}
                  className="input input--sm select surcharge-pick__select"
                  value={picked}
                  disabled={busy || areas?.data === null || selectable.length === 0}
                  aria-invalid={pickError !== null || undefined}
                  aria-describedby={pickError !== null ? `${idPrefix}-area-error` : undefined}
                  onChange={(event) => {
                    setPicked(event.target.value);
                    setPickError(null);
                  }}
                >
                  <option value="">{areas?.data === null ? "加载中…" : "选择区域"}</option>
                  {usable.map((area) => {
                    const note = optionNote(area.id);
                    return (
                      <option key={area.id} value={area.id} disabled={note !== null} aria-disabled={note !== null || undefined}>
                        {`${displayName(area.name).text}${note !== null ? `（${note}）` : ""}`}
                      </option>
                    );
                  })}
                </select>
                <Button size="sm" className="surcharge-pick__add" disabled={busy || areas?.data === null || selectable.length === 0} onClick={addArea}>
                  确认添加
                </Button>
              </div>
              {pickError !== null && (
                <p className="field__error" id={`${idPrefix}-area-error`}>
                  {pickError}
                </p>
              )}
              {areas?.data !== null && selectable.length === 0 && <p className="field__hint">没有其他区域可选。先到区域页面画出要加价的区域，再回来添加。</p>}
              {props.canManageAreas && (
                <div className="surcharge-pick__links">
                  <NewTabLink to={`${AREA_NEW_PATH}?biz=charter&role=pricing`} className="link surcharge-pick__new">
                    新增自定义区域
                  </NewTabLink>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {listed.length === 0 ? (
        <p className="field__hint">{`还没有${title}的区域。${readOnly || onPlatform ? "" : "在上面选一个区域添加。"}`}</p>
      ) : (
        <div className="price-table__scroll" role="region" aria-label={`${title}（${currency}）`} tabIndex={0}>
          <table className="price-table">
            <caption className="visually-hidden">{`${title}（${currency}，结算价）：每个区域 × 车型组一行，${LAYER_TEXT.emptyCell}`}</caption>
            <thead>
              <tr>
                <th scope="col">车型组</th>
                <th scope="col">套餐</th>
                {fields.map((field) => (
                  <th key={field} scope="col" className="price-table__number">{`${LAYER_FIELD_NAMES[field]}（${currency}）`}</th>
                ))}
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
              {listed.map((areaId) => {
                const onBase = blocked.has(areaId);
                const areaMissing = onBase ? 0 : groupIds.filter((groupId) => missingCells(rows, [areaId], [groupId], currency, today, blocked) > 0).length;
                const fresh = !savedOrder.includes(areaId);
                return [
                  <tr key={`${areaId}-head`} className="price-table__group" id={`layer-area-${model}-${areaId}`}>
                    <th colSpan={columns} scope="colgroup">
                      <span className="surcharge-table__name">{nameOf(areaId)}</span>
                      {areaById.get(areaId)?.city_id !== undefined && areaById.get(areaId)?.city_id !== product.city_id && <span className="surcharge-table__city">{`· ${displayName(areaById.get(areaId)?.city.name as LocalizedText).text}`}</span>}
                      {onBase && <span className="price-table__group-note">{LAYER_TEXT.baseAreaRow}</span>}
                      {areaMissing > 0 && (
                        <span className="surcharge-sum__missing">
                          <Icon name="alert-triangle" />
                          {`${areaMissing} 格没填`}
                        </span>
                      )}
                      {props.overlapAreaIds.has(areaId) && (
                        <span className="surcharge-sum__missing">
                          <Icon name="alert-circle" />
                          和别的区域重叠，见上面
                        </span>
                      )}
                      {fresh && !readOnly && (
                        <Button size="sm" variant="text" disabled={busy} aria-label={`去掉「${nameOf(areaId)}」`} onClick={() => dropArea(areaId)}>
                          去掉
                        </Button>
                      )}
                    </th>
                  </tr>,
                  ...areaRows(areaId).map(renderRow),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** 页面上的「迁移差异」用的套餐条款写法：套餐价 · 含公里 · 超时 · 超公里（结算价）。 */
function termsText(terms: CharterPackageTerms, currency: string): string {
  return `${moneyText(terms.package_price, currency)} · ${terms.package_km} 公里 · 超时 ${moneyText(terms.overtime_per_hour, currency)} / 小时 · 超公里 ${moneyText(terms.over_km_per_km, currency)} / 公里${terms.status === "disabled" ? " · 已停用" : ""}${terms.valid_to === null ? "" : ` · 到 ${terms.valid_to}`}`;
}

/** 价格页顶部「迁移差异 N 条」（ADR 0093 第六节第 1 小节）：点开看逐条明细。没有差异时不显示。 */
export function MigrationDiffBanner({ diff, currency, areaName, groupName }: { diff: CharterMigrationDiff | null; currency: string; areaName(id: string): string; groupName(id: string): string }) {
  const [open, setOpen] = useState(false);
  const items = diff?.charter_layout === "three_layer" ? diff.items : [];
  if (items.length === 0) return null;
  return (
    <section className="card coverage" aria-labelledby="migration-diff-title" data-migration-diff>
      <div className="card__title-row">
        <h3 className="coverage__title" id="migration-diff-title">
          <span className="coverage__missing">
            <Icon name="alert-triangle" />
            {migrationDiffText(items.length)}
          </span>
        </h3>
        <Button size="sm" variant="text" aria-expanded={open} aria-controls="migration-diff-table" onClick={() => setOpen(!open)}>
          {open ? "收起明细" : "看明细"}
        </Button>
      </div>
      <p className="field__hint">迁移时整商品套餐价取自一个服务区域；下面这些服务区域原来的套餐价和它不一样。现在报价都用整商品套餐价，要改请在下面「套餐价」里改。</p>
      {open && (
        <div className="price-table__scroll" id="migration-diff-table" role="region" aria-label="迁移差异明细" tabIndex={0}>
          <table className="price-table">
            <caption className="visually-hidden">{`迁移差异（${currency}，结算价）：区域、车型组、套餐、旧值、整商品值`}</caption>
            <thead>
              <tr>
                <th scope="col">区域</th>
                <th scope="col">车型组</th>
                <th scope="col">套餐</th>
                <th scope="col">旧值</th>
                <th scope="col">整商品值</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${item.old_price_rule_id}-${item.valid_from}`} className="price-table__row">
                  <th scope="row">{areaName(ruleAreaId(item))}</th>
                  <td>{groupName(item.vehicle_group_id)}</td>
                  <td>{item.package_hours === null ? LAYER_TEXT.allPackages : `${item.package_hours} 小时`}</td>
                  <td>{`${termsText(item.old, currency)}（${item.valid_from} 起）`}</td>
                  <td>{item.product === null ? "没有整商品套餐价" : termsText(item.product, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** 「旧的按区域套餐价（只读，迁移前的数据）」：折叠，只能看，不能改、删、加（后端 `CHARTER_LEGACY_READ_ONLY`）。 */
export function LegacyPackages({ items, currency, areaName, groupName }: { items: readonly PriceRuleBody[]; currency: string; areaName(id: string): string; groupName(id: string): string }) {
  if (items.length === 0) return null;
  const money = (minor: number | null): string => (minor === null ? "—" : moneyText(minor, currency));
  return (
    <details className="surcharge-deleted" data-legacy-packages>
      <summary>{`${LAYER_TEXT.legacyTitle}（${items.length} 条）`}</summary>
      <p className="field__hint">迁移到三层区域以后，报价只用上面按车型组 × 套餐填的整商品套餐价；这些是迁移前按服务区域填的，留着对照，不能修改。</p>
      <div className="price-table__scroll" role="region" aria-label={LAYER_TEXT.legacyTitle} tabIndex={0}>
        <table className="price-table">
          <caption className="visually-hidden">{`${LAYER_TEXT.legacyTitle}（${currency}）`}</caption>
          <thead>
            <tr>
              <th scope="col">区域</th>
              <th scope="col">车型组</th>
              <th scope="col">套餐</th>
              <th scope="col" className="price-table__number">套餐公里</th>
              <th scope="col" className="price-table__number">{`套餐价（${currency}）`}</th>
              <th scope="col" className="price-table__number">{`超时每小时（${currency}）`}</th>
              <th scope="col" className="price-table__number">{`超公里每公里（${currency}）`}</th>
              <th scope="col">生效日期</th>
              <th scope="col">启用</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="price-table__row">
                <th scope="row">{areaName(ruleAreaId(item))}</th>
                <td>{groupName(item.vehicle_group_id)}</td>
                <td>{item.package_hours === null ? "" : `${item.package_hours} 小时`}</td>
                <td className="price-table__number">{item.package_km ?? "—"}</td>
                <td className="price-table__number">{money(item.package_price)}</td>
                <td className="price-table__number">{money(item.overtime_per_hour)}</td>
                <td className="price-table__number">{money(item.over_km_per_km)}</td>
                <td>{item.valid_to === null ? `${item.valid_from} 起` : `${item.valid_from} 至 ${item.valid_to}`}</td>
                <td>{item.status === "enabled" ? "启用" : "已停用"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
