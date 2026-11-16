/**
 * 价格页第四张表「机场套餐价」（M9P-22，ADR 0098 第三节第 3、8 小节）：放在 M9P-07 的三张表（套餐价、行程加价、上下车加价）之后，只给迁移过三层区域的包车商品。
 * - 行 = 场景 × 机场（商品页「机场套餐」的绑定）× 车型组，列 = 套餐时长；格子填单独价（价格方式 `charter_airport_package`）。
 * - 空格灰字显示继承价（「继承：普通 33,000 + 上车加价 14,000」，算法见 lib/charter-airport-prices.ts）；单独价高于继承价的格标黄。
 * - 格子可以展开填含公里、超公里、超时单价（不填 = 同普通套餐）。
 * - 状态由页签（PriceRulesTab）持有：和价格表、两张加价表共用一个保存（同一批、同一事务），走现有的价格规则批量接口。
 * 金额都是结算价（规则 4）。文案只有中文，全部走 charter-airport-copy.ts 的 key 表。
 */
import { type PriceRule, type PriceRuleStatus } from "@nozomi/domain";
import { type ReactNode, useMemo, useState } from "react";
import type { CharterAirportBinding } from "../../../api/charter-airports.ts";
import type { PriceRuleBatch, PriceRules } from "../../../api/prices.ts";
import { Button } from "../../../components/Button.tsx";
import { Icon } from "../../../components/Icon.tsx";
import {
  AIRPORT_UNIT_FIELDS,
  type AirportCell,
  type AirportEndLocation,
  type AirportField,
  airportAmountText,
  airportCellNote,
  airportCellWarn,
  airportCellsOf,
  airportChange,
  airportChangeCount,
  airportFieldName,
  airportHoursColumns,
  airportOverlaps,
  blankAirportCell,
  blankAirportKey,
  buildAirportBatch,
  inheritPlaceholder,
  inheritText,
  inheritedAirportPrice,
  readAirportCell,
} from "../../../lib/charter-airport-prices.ts";
import { charterAirportText as t } from "../../../lib/charter-airport-copy.ts";
import { displayName } from "../../../lib/master-display.ts";
import { comboText, plainAmountDisplay, tidyAmountDisplay } from "../../../lib/product-display.ts";
import type { SurchargeGroup } from "./AreaSurchargeBlock.tsx";

export const airportCellId = (key: string, field: AirportField): string => `airport-${key}-${field}`;
export const AIRPORT_TABLE_ID = "airport-prices-title";

export interface AirportCellsState {
  cells: AirportCell[];
  setCells(update: (cells: AirportCell[]) => AirportCell[]): void;
  /** 同一格别的日期段条数（原样不动） */
  others: Map<string, number>;
  changeCount: number;
  batch(): PriceRuleBatch;
  adopt(data: PriceRules, keepEdits: boolean): void;
}

export function useAirportCells(prices: PriceRules): AirportCellsState {
  const currency = prices.currency;
  const [cells, setCellsState] = useState<AirportCell[]>(() => airportCellsOf(prices.items, currency, prices.today).cells);
  const others = useMemo(() => airportCellsOf(prices.items, currency, prices.today).others, [prices]);
  const changeCount = useMemo(() => airportChangeCount(cells, currency), [cells, currency]);
  return {
    cells,
    setCells: (update) => setCellsState(update),
    others,
    changeCount,
    batch: () => buildAirportBatch(cells, currency),
    adopt: (data, keepEdits) => {
      const base = airportCellsOf(data.items, data.currency, data.today).cells;
      if (!keepEdits) {
        setCellsState(base);
        return;
      }
      // 我改过的格留我的，没动过的换成最新的
      const merged = [...base];
      for (const old of cells) {
        const change = airportChange(old, readAirportCell(old, data.currency));
        if (change === "none" || change === "blank") continue;
        const at = merged.findIndex((cell) => (old.id !== null && cell.id === old.id) || (old.id === null && cell.key === old.key));
        if (at >= 0) merged[at] = { ...old, origin: (merged[at] as AirportCell).origin };
        else if (change !== "deleted") merged.push({ ...old, id: null, origin: null, key: blankAirportKey(old.scenario, old.areaId, old.vehicleGroupId, old.packageHours) });
      }
      setCellsState(merged);
    },
  };
}

/** 继承价要用的东西：普通套餐价（含没保存的修改）、两张加价表现在的规则、每个机场那一端落在哪 */
export interface AirportInheritInputs {
  normalPrice(vehicleGroupId: string, packageHours: number): number | null;
  surchargeRules: readonly PriceRule[];
  /** 机场区域编号 → 机场那一端落在哪；没取到（机场坐标、区域图形）为 undefined */
  locations: ReadonlyMap<string, AirportEndLocation>;
  dropoffItinerary: boolean;
}

/** 表里一行的名字（报错、读屏用）：「机场套餐价 · 机场开始 · 成田机场 · 舒适五座 · 5 小时」 */
export function airportCellLabel(cell: Pick<AirportCell, "scenario" | "areaId" | "vehicleGroupId" | "packageHours">, bindings: readonly CharterAirportBinding[], groupName: (id: string) => string): string {
  return t("tenant.charterAirport.prices.rowLabel", { title: t("tenant.charterAirport.prices.title"), scenario: scenarioText(cell.scenario), airport: airportName(bindings, cell.scenario, cell.areaId), group: groupName(cell.vehicleGroupId), hours: cell.packageHours });
}

const scenarioText = (scenario: AirportCell["scenario"]): string => t(scenario === "airport_start" ? "tenant.charterAirport.scenario.airportStart" : "tenant.charterAirport.scenario.airportEnd");

function airportName(bindings: readonly CharterAirportBinding[], scenario: AirportCell["scenario"], areaId: string): string {
  const binding = bindings.find((entry) => entry.scenario === scenario && entry.area_id === areaId);
  if (binding === undefined) return "—";
  return binding.short_name_zh ?? displayName(binding.place_name).text;
}

export function AirportPricesTable(props: {
  state: AirportCellsState;
  bindings: readonly CharterAirportBinding[] | null;
  bindingsFailed: boolean;
  reloadBindings(): void;
  items: PriceRules["items"];
  /** 页面上的套餐时长（含刚加、还没保存的套餐） */
  extraHours: readonly number[];
  groups: readonly SurchargeGroup[];
  currency: string;
  today: string;
  readOnly: boolean;
  busy: boolean;
  onPlatform: boolean;
  inherit: AirportInheritInputs;
  conflictKeys: ReadonlySet<string>;
}) {
  const { state, bindings, groups, currency, today, readOnly, busy, inherit } = props;
  const locked = busy || readOnly;
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const hours = airportHoursColumns(props.items, props.extraHours);
  const overlaps = useMemo(() => airportOverlaps(state.cells, props.items, currency), [state.cells, props.items, currency]);
  const groupName = (id: string): string => groups.find((group) => group.id === id)?.name ?? "—";

  const cellAt = (scenario: AirportCell["scenario"], areaId: string, vehicleGroupId: string, packageHours: number): AirportCell =>
    state.cells.find((cell) => cell.scenario === scenario && cell.areaId === areaId && cell.vehicleGroupId === vehicleGroupId && cell.packageHours === packageHours) ?? blankAirportCell(scenario, areaId, vehicleGroupId, packageHours, today);
  const update = (cell: AirportCell, change: Partial<AirportCell>): void => {
    state.setCells((current) => (current.some((entry) => entry.key === cell.key) ? current.map((entry) => (entry.key === cell.key ? { ...entry, ...change } : entry)) : [...current, { ...cell, ...change }]));
  };

  const heading = (
    <h3 className="surcharge__title" id={AIRPORT_TABLE_ID} tabIndex={-1}>
      {t("tenant.charterAirport.prices.title")}
    </h3>
  );
  let body: ReactNode;
  if (bindings === null) {
    body = props.bindingsFailed ? (
      <p className="surcharge-pick__error">
        {t("tenant.charterAirport.prices.loadFailed")}
        <Button size="sm" variant="text" onClick={props.reloadBindings}>
          {t("tenant.charterAirport.retry")}
        </Button>
      </p>
    ) : (
      <p className="field__hint">…</p>
    );
  } else if (bindings.length === 0) {
    body = <p className="field__hint">{readOnly || props.onPlatform ? t("tenant.charterAirport.platformEmpty") : t("tenant.charterAirport.prices.noBindings")}</p>;
  } else if (hours.length === 0) {
    body = <p className="field__hint">{t("tenant.charterAirport.prices.noPackages")}</p>;
  } else {
    const amountInput = (cell: AirportCell, field: AirportField, label: string, placeholder: string, bad: boolean, describedBy?: string): ReactNode => (
      <input
        className="input input--sm input--mono price-table__input"
        id={airportCellId(cell.key, field)}
        type="text"
        inputMode={field === "km" ? "numeric" : "decimal"}
        autoComplete="off"
        aria-label={label}
        placeholder={placeholder}
        aria-invalid={bad || undefined}
        {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
        disabled={locked}
        value={cell[field]}
        onChange={(event) => update(cell, { [field]: event.target.value })}
        onFocus={(event) => {
          if (field === "km") return;
          const input = event.currentTarget;
          const plain = plainAmountDisplay(cell[field], currency);
          if (plain !== input.value) input.value = plain;
          input.select();
          if (plain !== cell[field]) update(cell, { [field]: plain });
        }}
        onBlur={() => {
          if (field === "km") return;
          const tidy = tidyAmountDisplay(cell[field], currency);
          if (tidy !== cell[field]) update(cell, { [field]: tidy });
        }}
      />
    );
    const renderCell = (cell: AirportCell): ReactNode => {
      const reading = readAirportCell(cell, currency);
      const inherited = inheritedAirportPrice({
        normalMinor: inherit.normalPrice(cell.vehicleGroupId, cell.packageHours),
        scenario: cell.scenario,
        location: inherit.locations.get(cell.areaId) ?? null,
        rules: inherit.surchargeRules,
        vehicleGroupId: cell.vehicleGroupId,
        packageHours: cell.packageHours,
        date: today,
        dropoffItinerary: inherit.dropoffItinerary,
      });
      const warn = airportCellWarn(reading.priceMinor, inherited);
      const overlapping = overlaps.has(cell.key) || props.conflictKeys.has(cell.key);
      const note = airportCellNote(cell, reading, overlapping, today);
      const blank = reading.blank;
      const label = airportCellLabel(cell, bindings, groupName);
      const hintId = `${airportCellId(cell.key, "price")}-hint`;
      const otherCount = state.others.get(blankAirportKey(cell.scenario, cell.areaId, cell.vehicleGroupId, cell.packageHours)) ?? 0;
      const expanded = open.has(cell.key) || reading.problems.some((problem) => problem.field !== "price");
      const bad = (field: AirportField): boolean => reading.problems.some((problem) => problem.field === field) || (field === "price" && overlapping);
      const unitText = AIRPORT_UNIT_FIELDS.filter((field) => cell[field].trim() !== "").map((field) => `${airportFieldName(field)} ${cell[field]}`).join(" · ");
      return (
        <td key={cell.packageHours} className={`price-table__number airport-prices__cell${warn ? " airport-prices__cell--warn" : ""}`} data-warn={warn || undefined} data-inherit={blank || undefined}>
          {readOnly ? (
            <span className={blank ? "table__muted" : "surcharge-detail__text"}>{blank ? inheritPlaceholder(inherited, currency) || "—" : cell.price}</span>
          ) : (
            amountInput(cell, "price", t("tenant.charterAirport.prices.cellLabel", { scenario: scenarioText(cell.scenario), airport: airportName(bindings, cell.scenario, cell.areaId), group: groupName(cell.vehicleGroupId), hours: cell.packageHours }), inheritPlaceholder(inherited, currency), bad("price"), hintId)
          )}
          <span id={hintId}>
            {blank && <span className="airport-prices__inherit">{inheritText(inherited, currency)}</span>}
            {warn && inherited.ok && (
              <span className="airport-prices__warn">
                <Icon name="alert-triangle" />
                {t("tenant.charterAirport.prices.higher", { amount: airportAmountText(inherited.totalMinor, currency) })}
              </span>
            )}
            {note !== null && <span className={reading.problems.length > 0 || overlapping ? "field__error" : "table__muted"}>{note}</span>}
            {otherCount > 0 && <span className="table__muted">{t("tenant.charterAirport.prices.otherSegments", { count: otherCount })}</span>}
          </span>
          {readOnly
            ? unitText !== "" && <span className="table__muted">{unitText}</span>
            : (
              <>
                <Button size="sm" variant="text" aria-expanded={expanded} aria-label={t("tenant.charterAirport.prices.unitsOpen", { label })} onClick={() => setOpen((current) => (current.has(cell.key) ? new Set([...current].filter((key) => key !== cell.key)) : new Set([...current, cell.key])))}>
                  {t("tenant.charterAirport.prices.units")}
                </Button>
                {expanded && (
                  <span className="airport-prices__units">
                    {AIRPORT_UNIT_FIELDS.map((field) => (
                      <span key={field}>{amountInput(cell, field, t("tenant.charterAirport.prices.unitLabel", { scenario: scenarioText(cell.scenario), airport: airportName(bindings, cell.scenario, cell.areaId), group: groupName(cell.vehicleGroupId), hours: cell.packageHours, field: airportFieldName(field) }), `${airportFieldName(field)} · ${t("tenant.charterAirport.prices.unitsHint")}`, bad(field))}</span>
                    ))}
                  </span>
                )}
              </>
            )}
          {!readOnly && cell.id !== null && !blank && (
            <label className="table__muted">
              <input type="checkbox" checked={cell.enabled} disabled={locked} onChange={(event) => update(cell, { enabled: event.target.checked })} aria-label={`${label}：${statusText("enabled")}`} />
              {statusText("enabled")}
            </label>
          )}
        </td>
      );
    };
    const ordered = [...bindings].sort((x, y) => (x.scenario === y.scenario ? 0 : x.scenario === "airport_start" ? -1 : 1));
    body = (
      <div className="price-table__scroll" role="region" aria-label={`${t("tenant.charterAirport.prices.title")}（${currency}）`} tabIndex={0}>
        <table className="price-table" data-airport-prices="">
          <caption className="visually-hidden">{`${t("tenant.charterAirport.prices.title")}（${currency}）`}</caption>
          <thead>
            <tr>
              <th scope="col">{t("tenant.charterAirport.prices.groupHeader")}</th>
              {hours.map((value) => (
                <th key={value} scope="col" className="price-table__number">
                  {t("tenant.charterAirport.prices.hoursHeader", { hours: value, currency })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ordered.map((binding) => [
              <tr key={`${binding.scenario}-${binding.area_id}-head`} className="price-table__group" id={`airport-group-${binding.scenario}-${binding.area_id}`}>
                <th colSpan={hours.length + 1} scope="colgroup">
                  <span className="surcharge-table__name">{t("tenant.charterAirport.prices.groupRow", { scenario: scenarioText(binding.scenario), airport: airportName(bindings, binding.scenario, binding.area_id), area: displayName(binding.area_name).text })}</span>
                  {!binding.effective && (
                    <span className="surcharge-sum__missing">
                      <Icon name="alert-circle" />
                      {t("tenant.charterAirport.prices.ineffective")}
                    </span>
                  )}
                </th>
              </tr>,
              ...groups.map((group) => (
                <tr key={`${binding.scenario}-${binding.area_id}-${group.id}`} className="price-table__row">
                  <th scope="row">
                    {group.name}
                    <span className="product-code">{comboText(group.passengers, group.luggage)}</span>
                  </th>
                  {hours.map((value) => renderCell(cellAt(binding.scenario, binding.area_id, group.id, value)))}
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <section className="card surcharge" aria-labelledby={AIRPORT_TABLE_ID} data-layer="charter_airport_package">
      {heading}
      <p className="surcharge__lead">{t("tenant.charterAirport.prices.lead")}</p>
      {!readOnly && !props.onPlatform && <p className="field__hint">{t("tenant.charterAirport.prices.import")}</p>}
      {body}
    </section>
  );
}

const statusText = (status: PriceRuleStatus): string => t(status === "enabled" ? "tenant.charterAirport.prices.enabled" : "tenant.charterAirport.prices.disabled");
