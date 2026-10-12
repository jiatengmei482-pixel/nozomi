/**
 * ④ 库存（docs/design/pages/tenant-inventory.md 第 2–7 节）：库存模式、库存日历、改某一天、批量设置、导出。
 * 这一步没有「保存」：切换模式、改一天、批量设置各自确认、各自立即生效。每个动作都带商品的版本号。
 * 一天是什么状态用接口给的；能不能改、选中了哪些天、有没有被订单挡住问 @nozomi/domain。
 */
import { INVENTORY_LIMITS, INVENTORY_MODE_NAMES, type InventoryMode, addDays } from "@nozomi/domain";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { ApiError } from "../../../api/client.ts";
import { type Inventory, type InventoryDayBody, batchSetInventory, exportInventory, getInventory, setInventoryMode } from "../../../api/inventory.ts";
import type { Product } from "../../../api/products.ts";
import { usePortalSession } from "../../../auth/PortalSession.tsx";
import { Alert } from "../../../components/Alert.tsx";
import { Button, IconButton, LinkButton } from "../../../components/Button.tsx";
import { Dialog } from "../../../components/Dialog.tsx";
import { Dropdown } from "../../../components/Dropdown.tsx";
import { FieldErrors } from "../../../components/FormFields.tsx";
import { Icon, type IconName } from "../../../components/Icon.tsx";
import { MonthGrid, useDaySelection } from "../../../components/MonthGrid.tsx";
import { Skeleton, StateBlock } from "../../../components/States.tsx";
import { useToast } from "../../../components/Toast.tsx";
import { WEEKDAY_NAMES } from "../../../lib/adjust-form.ts";
import {
  type BatchForm,
  type BlockedDay,
  TOTAL_PROBLEM,
  type TotalChoice,
  batchDatesText,
  batchEffectText,
  batchIssueText,
  batchOverwriteText,
  blockedDayText,
  blockedDays,
  blockedFromDetails,
  choiceOf,
  inventoryCellView,
  lastSettableDate,
  occupancyText,
  occupiedText,
  readBatchForm,
  readTotal,
  unsetDates,
} from "../../../lib/inventory-form.ts";
import { displayName } from "../../../lib/master-display.ts";
import { addMonths, daysInRange, isMonth, monthDates, monthOf, monthTitle, sameDayIn, weekdayName } from "../../../lib/price-calendar.ts";
import { PRODUCT_FORBIDDEN_TEXT, saveFailureText, serverIssues } from "../../../lib/product-failure.ts";
import { importPath, productPath } from "../../../lib/product-paths.ts";
import { tidyDate } from "../../../lib/time-input.ts";
import { useLoad } from "../../../lib/use-load.ts";
import { focusAnchor } from "../frame.ts";
import type { ProductFrame } from "../frame.ts";
import { useDownload } from "./useDownload.tsx";

/** 只用来给第一次请求定月份（网址里没有月份时）；页面上的「今天」一律用接口给的。 */
const requestMonth = (): string => new Date().toISOString().slice(0, 7);
const isNarrow = (): boolean => typeof window.matchMedia === "function" && window.matchMedia("(max-width: 767px)").matches;
const CELL_ICONS: Readonly<Record<string, IconName | null>> = { unlimited: null, open: null, sold_out: "check-circle", closed: "minus", unset: "alert-triangle", beyond: null };
const count = (value: number): string => value.toLocaleString("en-US");

type Failure = { kind: "conflict" } | { kind: "blocked"; days: BlockedDay[] } | { kind: "issues"; issues: { path: string; reason: string }[] } | { kind: "text"; text: string };

export function InventoryStep({ frame, product }: { frame: ProductFrame; product: Product }) {
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const readOnly = frame.readOnly;
  const published = product.status === "published";
  const cityName = product.city ? displayName(product.city.name).text : "";
  const heading = useRef<HTMLHeadingElement>(null);
  const [tick, setTick] = useState(0);
  const wanted = params.get("month");
  const [fallbackMonth, setFallbackMonth] = useState(requestMonth);
  const month = wanted !== null && isMonth(wanted) ? wanted : fallbackMonth;
  const dates = useMemo(() => monthDates(month), [month]);
  const loaded = useLoad<Inventory>(`inventory:${product.id}:${month}:${tick}`, (session) => getInventory(session, product.id, { from: dates[0] as string, to: dates.at(-1) as string }));
  const data = loaded.state.data;
  const today = data?.today ?? null;
  const mode = data?.mode ?? null;
  const stale = loaded.state.status === "loading" && data !== null;
  const byDate = useMemo(() => new Map((data?.days ?? []).map((day) => [day.date, day])), [data]);
  const selection = useDaySelection(`${month}-01`);
  const download = useDownload();
  const [notice, setNotice] = useState<{ kind: "warning" | "danger"; text: string } | null>(null);
  const [modeDialog, setModeDialog] = useState<InventoryMode | null>(null);
  const [batch, setBatch] = useState<BatchForm | null>(null);
  const [exporting, setExporting] = useState(false);
  const [sheet, setSheet] = useState(false);

  // 换页时外壳会把焦点交给正文（<main>）；这里晚一帧再把焦点放到这一步的标题上，读屏读到的是标题
  useEffect(() => {
    const frameId = requestAnimationFrame(() => heading.current?.focus());
    return () => cancelAnimationFrame(frameId);
  }, []);
  // 月份：没写在网址里时看本月（城市当地的）；超出能看的范围换成本月
  const firstMonth = today === null ? null : addMonths(monthOf(today), -12);
  const lastMonth = today === null ? null : monthOf(lastSettableDate(today));
  useEffect(() => {
    if (today === null || firstMonth === null || lastMonth === null) return;
    if (wanted === null && monthOf(today) !== fallbackMonth) setFallbackMonth(monthOf(today));
    if (wanted !== null && (!isMonth(wanted) || wanted < firstMonth || wanted > lastMonth)) {
      const next = new URLSearchParams(params);
      next.delete("month");
      setParams(next, { replace: true });
      setFallbackMonth(monthOf(today));
    }
  }, [today, wanted, firstMonth, lastMonth, fallbackMonth, params, setParams]);
  const syncVersion = frame.syncVersion;
  const reportMode = frame.setInventoryMode;
  const loadedVersion = data?.version ?? null;
  useEffect(() => {
    if (loadedVersion !== null) syncVersion(loadedVersion);
    if (mode !== null) reportMode(mode);
  }, [loadedVersion, mode, syncVersion, reportMode]);
  // 导入完回来：翻到文件里最早的那一天所在的月份（地址里带着）
  const focusDate = (location.state as { inventoryDate?: unknown } | null)?.inventoryDate;
  useEffect(() => {
    if (typeof focusDate === "string" && today !== null && monthOf(focusDate) === month) selection.setFocusDay(focusDate);
    // 只在进来时看一次
  }, [focusDate, today]);

  const goMonth = (next: string, keepFocus = false): void => {
    if (firstMonth === null || lastMonth === null || next < firstMonth || next > lastMonth) return;
    const search = new URLSearchParams(params);
    if (today !== null && next === monthOf(today)) search.delete("month");
    else search.set("month", next);
    setParams(search, { replace: true });
    if (today !== null) setFallbackMonth(monthOf(today));
    selection.clear();
    selection.pick(null);
    const target = sameDayIn(next, selection.focusDay);
    selection.setFocusDay(target);
    if (keepFocus) requestAnimationFrame(() => document.getElementById(`inventory-day-${target}`)?.focus());
  };

  /** 一次修改成功：记下新的版本号，重新取这个月。 */
  const changed = (version: number, nextMode?: InventoryMode): void => {
    frame.saved(version);
    if (nextMode) frame.setInventoryMode(nextMode);
    setTick((current) => current + 1);
  };
  /** 修改被拒：把接口的应答分成页面要分别处理的几种。 */
  const failureOf = (err: unknown, action: string): Failure | null => {
    if (handleAuthFailure(err)) return null;
    if (!(err instanceof ApiError)) return { kind: "text", text: saveFailureText(err, action, true) };
    if (err.code === "VERSION_CONFLICT") {
      frame.refresh();
      setTick((current) => current + 1);
      setNotice({ kind: "warning", text: "这个商品刚被别人修改过，已经载入最新的库存。请核对后再点一次。" });
      return { kind: "conflict" };
    }
    if (err.code === "INVENTORY_BELOW_OCCUPIED") return { kind: "blocked", days: blockedFromDetails(err.details) };
    if (err.code === "VALIDATION_FAILED") return { kind: "issues", issues: serverIssues(err).map((issue) => ({ path: issue.path, reason: issue.reason })) };
    if (err.code === "CONCURRENT_UPDATE") return { kind: "text", text: `同时有其他人在修改，这次没有${action}成功。请再点一次。` };
    if (err.code === "PUBLISH_CHECK_FAILED") return { kind: "text", text: "这个商品已上架，改成这样就不满足上架的条件了。" };
    if (err.status === 403) return { kind: "text", text: PRODUCT_FORBIDDEN_TEXT };
    if (err.status === 404) return { kind: "text", text: "找不到这个商品，它可能已被别人删除。" };
    return { kind: "text", text: saveFailureText(err, action, true) };
  };

  const openBatch = (from: string, to: string): void => setBatch({ from, to, everyDay: true, weekdays: [], choice: null, value: "" });

  const intro = (
    <p className="price-info">{`库存按${cityName}当地的用车日期算。一天一个数，不分时段，也不分车型组。`}</p>
  );
  const title = (
    <h2 className="step__title" ref={heading} tabIndex={-1}>
      ④ 库存
    </h2>
  );
  const bar = (
    <div className="form-bar step__bar">
      <span className="form-bar__note step__summary">{published ? "已上架，改完大约 1 分钟生效" : ""}</span>
      <LinkButton variant="primary" to={productPath(product.id, "content")}>
        下一步
      </LinkButton>
    </div>
  );

  if (data === null || today === null || mode === null) {
    return (
      <div className="step">
        {title}
        {intro}
        <section className="card">
          {loaded.state.status === "error" ? (
            <StateBlock
              title="加载失败"
              description="请检查网络后重试。"
              action={
                <Button variant="secondary" onClick={loaded.reload}>
                  重试
                </Button>
              }
            />
          ) : (
            <Skeleton lines={["medium", "long", "control", "control", "control"]} />
          )}
        </section>
        {bar}
      </div>
    );
  }

  const last = lastSettableDate(today);
  const locked = (date: string): string | null => (date < today ? "已经过去，只能看" : date > last ? "超出可以设库存的范围" : null);
  const range = selection.range !== null && monthOf(selection.range.from) === month ? selection.range : null;
  const shownDate = selection.picked !== null && monthOf(selection.picked) === month ? selection.picked : monthOf(today) === month ? today : (dates[0] as string);
  const shownDay = byDate.get(shownDate) ?? null;
  const unset = mode === "limited" && !stale ? unsetDates(data.days, today) : [];
  const noneAhead = mode === "limited" && data.ahead.sellable_days === 0;
  const preset = mode === "unlimited" && data.ahead.last_set_date !== null;

  const cell = (date: string) => {
    const day = byDate.get(date) ?? null;
    if (day === null && date <= last) return { spoken: loaded.state.status === "error" ? "没有加载出来" : "加载中", content: <span className="calendar__price" aria-hidden="true"><span className="calendar__skeleton" /></span> };
    const view = inventoryCellView(date > last ? null : day);
    const icon = CELL_ICONS[view.kind] ?? null;
    const past = date < today;
    return {
      spoken: view.spoken,
      className: `stock-cell stock-cell--${view.kind}${past ? " stock-cell--past" : ""}`,
      content: (
        <>
          <span className="calendar__price stock-cell__main" aria-hidden="true">
            {icon && <Icon name={icon} />}
            {view.main}
          </span>
          <span className="calendar__rules stock-cell__sub" aria-hidden="true">
            {view.sub}
          </span>
        </>
      ),
    };
  };

  const saveDay = async (date: string, total: number | null): Promise<Failure | null> => {
    try {
      const result = await batchSetInventory(token, product.id, frame.version, { from: date, to: date, weekdays: [], total });
      changed(result.version);
      setNotice(null);
      toast(`已保存 ${date.slice(5)} 的库存`);
      return null;
    } catch (err) {
      return failureOf(err, "保存") ?? { kind: "text", text: "" };
    }
  };

  const panel = (headingId: string): ReactNode => <DayPanel key={`${shownDate}:${shownDay?.total ?? "x"}:${shownDay?.status ?? ""}`} headingId={headingId} date={shownDate} day={shownDay} mode={mode} today={today} last={last} readOnly={readOnly} onSave={saveDay} />;

  return (
    <div className="step">
      {title}
      {intro}
      <div role="alert" className="step__alerts">
        {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
        {download.notice}
      </div>
      <section className="card stock-mode" aria-labelledby="stock-mode-title">
        <h3 className="visually-hidden" id="stock-mode-title">
          库存模式
        </h3>
        <div className="stock-mode__text">
          <p className="stock-mode__now">
            现在是：<strong>{INVENTORY_MODE_NAMES[mode]}</strong>
          </p>
          <p className="stock-mode__effect">
            {mode === "unlimited" ? (
              `每天接多少单都可以，不用设库存。${preset ? "下面日历里设的数现在不起作用，改成限量后才生效。" : ""}`
            ) : (
              <>
                每天最多接你设的单数。<strong>没有设库存的日子卖不出去。</strong>
              </>
            )}
            {published && " 已上架，改完大约 1 分钟生效。"}
          </p>
        </div>
        {!readOnly && (
          <Button className="stock-mode__button" onClick={() => setModeDialog(mode === "unlimited" ? "limited" : "unlimited")}>
            {mode === "unlimited" ? "改成限量" : "改成不限量"}
          </Button>
        )}
      </section>
      {noneAhead ? (
        <div role="alert">
          <Alert kind="warning">
            <strong className="alert__title">从今天起没有一天有库存，这个商品现在卖不出去。</strong>
            <span>限量时，没有设库存的日子不接单。请给要卖的日子设上库存，或改成不限量。</span>
            {!readOnly && (
              <span className="alert__actions">
                <Button size="sm" onClick={() => openBatch(today, "")}>
                  批量设置
                </Button>
              </span>
            )}
          </Alert>
        </div>
      ) : unset.length > 0 ? (
        <div role="status">
          <Alert kind="warning">
            <strong className="alert__title">{`这个月有 ${unset.length} 天没设库存，这些天卖不出去。`}</strong>
            {unset.length <= 5 && <span>{unset.map((date) => `${date} ${weekdayName(date)}`).join("、")}</span>}
            {!readOnly && (
              <span className="alert__actions">
                <Button size="sm" onClick={() => openBatch(unset[0] as string, unset.at(-1) as string)}>
                  给这些天设库存
                </Button>
              </span>
            )}
          </Alert>
        </div>
      ) : null}
      <section className="card stock-calendar" aria-labelledby="stock-calendar-title">
        <div className="stock-calendar__head">
          <h3 className="card__title" id="stock-calendar-title">
            库存日历
          </h3>
          <div className="stock-calendar__tools">
            {!readOnly && <Button onClick={() => openBatch(today, "")}>批量设置</Button>}
            <Dropdown buttonClassName="button button--secondary button--md" buttonContent={download.busy ? "正在准备文件…" : <>导入 / 导出<Icon name="chevron-down" /></>} align="end">
              <button type="button" role="menuitem" className="menu-item" disabled={download.busy} onClick={() => setExporting(true)}>
                <span className="menu-item__text">导出库存…</span>
              </button>
              {!readOnly && (
                <>
                  <hr className="menu-divider" />
                  <Link role="menuitem" className="menu-item" to={importPath(product.id, "inventory")}>
                    <span className="menu-item__text">导入库存…</span>
                  </Link>
                </>
              )}
            </Dropdown>
          </div>
        </div>
        <div className="calendar-month">
          <IconButton icon="chevron-left" label="上个月" tooltipAlign="start" disabled={firstMonth === null || month <= firstMonth} onClick={() => goMonth(addMonths(month, -1))} />
          <h4 className="calendar-month__title" aria-live="polite">
            {monthTitle(month)}
          </h4>
          <IconButton icon="chevron-right" label="下个月" disabled={lastMonth === null || month >= lastMonth} onClick={() => goMonth(addMonths(month, 1))} />
          {month !== monthOf(today) && (
            <Button variant="text" size="sm" onClick={() => goMonth(monthOf(today))}>
              回到本月
            </Button>
          )}
          <Button size="sm" className="calendar-month__pick" aria-pressed={selection.picking !== "off"} onClick={selection.togglePicking}>
            选一段日期
          </Button>
          {!readOnly && <span className="calendar-month__tip">点一天直接改；拖动或用键盘选一段日期批量设置</span>}
        </div>
        {selection.picking !== "off" && <p className="calendar-month__picking">{selection.picking === "start" ? "点开始的那一天" : "再点结束的那一天"}</p>}
        <div className="calendar-bar" role="status">
          {range !== null && range.from !== range.to && (
            <>
              <span className="calendar-bar__text">
                已选 <strong>{`${range.from} 至 ${range.to}`}</strong>，共 {daysInRange(range.from, range.to)} 天
              </span>
              {!readOnly && (
                <Button variant="primary" size="sm" onClick={() => openBatch(range.from, range.to)}>
                  批量设置
                </Button>
              )}
              <Button variant="text" size="sm" onClick={selection.clear}>
                取消选择
              </Button>
            </>
          )}
        </div>
        <div className="calendar-layout">
          <MonthGrid
            idPrefix="inventory-day"
            label={`${monthTitle(month)}每一天的库存`}
            month={month}
            today={today}
            selection={selection}
            busy={loaded.state.status === "loading"}
            stale={stale}
            cell={cell}
            locked={locked}
            onOpen={() => {
              if (isNarrow()) setSheet(true);
              else requestAnimationFrame(() => focusAnchor("stock-day-form"));
            }}
            onMonth={(delta) => goMonth(addMonths(month, delta), true)}
          />
          <section className="card calendar-detail stock-day" aria-labelledby="stock-day-title">
            {panel("stock-day-title")}
          </section>
        </div>
        <p className="calendar-note">{`日期是${cityName}当地的用车日期。没设 = 限量时这一天卖不出去；停售 = 你把这一天设成了 0。`}</p>
      </section>
      {bar}
      <Dialog open={sheet} title={`${shownDate} 的库存`} onClose={() => setSheet(false)} footer={<Button onClick={() => setSheet(false)}>关闭</Button>}>
        <div className="calendar-detail stock-day">{sheet && panel("stock-sheet-title")}</div>
      </Dialog>
      <ModeDialog
        target={modeDialog}
        productId={product.id}
        today={today}
        published={published}
        onClose={() => setModeDialog(null)}
        onSetFirst={() => {
          setModeDialog(null);
          openBatch(today, "");
        }}
        onSubmit={async (target) => {
          try {
            const result = await setInventoryMode(token, product.id, frame.version, target);
            changed(result.version, result.mode);
            setNotice(null);
            toast(target === "limited" ? "已改成限量" : "已改成不限量");
            setModeDialog(null);
            return null;
          } catch (err) {
            const failure = failureOf(err, "保存");
            if (failure?.kind === "conflict") setModeDialog(null);
            return failure === null || failure.kind === "conflict" ? null : failure.kind === "text" ? failure.text : "系统暂时无法保存，请稍后再试。";
          }
        }}
      />
      {batch !== null && (
        <BatchDialog
          initial={batch}
          productId={product.id}
          today={today}
          mode={mode}
          onClose={() => setBatch(null)}
          onJump={(date) => {
            setBatch(null);
            goMonth(monthOf(date));
            selection.select(date, date);
            selection.pick(date);
            selection.setFocusDay(date);
          }}
          onSubmit={async (input) => {
            try {
              const result = await batchSetInventory(token, product.id, frame.version, input);
              changed(result.version);
              setNotice(null);
              toast(result.changed_days === 0 ? "这些天本来就是这样，没有变化" : `已设置 ${count(result.changed_days)} 天的库存`);
              setBatch(null);
              if (monthOf(input.from) !== month) goMonth(monthOf(input.from));
              selection.select(input.from, monthOf(input.to) === monthOf(input.from) ? input.to : (monthDates(monthOf(input.from)).at(-1) as string));
              setTimeout(selection.clear, 2000);
              return null;
            } catch (err) {
              return failureOf(err, "保存");
            }
          }}
        />
      )}
      <ExportDialog
        open={exporting}
        today={today}
        busy={download.busy}
        onClose={() => setExporting(false)}
        onExport={async (from, to) => {
          setExporting(false);
          await download.run((session) => exportInventory(session, product.id, { from, to }), `inventory-${from}-${to}.xlsx`);
        }}
      />
    </div>
  );
}

// ───────────── 改某一天 ─────────────

function TotalChoices({ idPrefix, choice, value, onChange, disabled, blockedCount, mode, legend }: { idPrefix: string; choice: TotalChoice | null; value: string; onChange(choice: TotalChoice | null, value: string): void; disabled: boolean; blockedCount: number; mode: InventoryMode; legend: string }) {
  const blocked = blockedCount > 0;
  return (
    <div className="choices choices--stacked stock-choices" role="radiogroup" aria-label={legend} id={`${idPrefix}-choice`}>
      <label className="choice">
        <input type="radio" name={`${idPrefix}-choice`} checked={choice === "total"} disabled={disabled} onChange={() => onChange("total", value)} />
        <span className="choice__text stock-choices__total">
          可售
          <input
            className="input input--sm input--mono stock-choices__input"
            id={`${idPrefix}-total`}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            aria-label="可售单数"
            readOnly={disabled}
            value={value}
            onFocus={() => choice !== "total" && onChange("total", value)}
            onChange={(event) => (event.target.value.trim() === "0" ? onChange("closed", "") : onChange("total", event.target.value))}
          />
          单
        </span>
      </label>
      <label className="choice">
        <input type="radio" name={`${idPrefix}-choice`} checked={choice === "closed"} disabled={disabled || blocked} aria-disabled={blocked || undefined} onChange={() => onChange("closed", value)} />
        <span className="choice__text">
          停售
          <span className="choice__hint">这一天不接单。日历上写「停售」。</span>
        </span>
      </label>
      <label className="choice">
        <input type="radio" name={`${idPrefix}-choice`} checked={choice === "clear"} disabled={disabled || blocked} aria-disabled={blocked || undefined} onChange={() => onChange("clear", value)} />
        <span className="choice__text">
          清除
          <span className="choice__hint">{`改回「没设」。${mode === "limited" ? "这一天同样卖不出去，日历上会一直标着提醒你。" : "不限量时没有影响。"}`}</span>
        </span>
      </label>
      {blocked && <p className="field__hint field__hint--warning">{`这一天已经有 ${count(blockedCount)} 单，不能停售，也不能清除。最少可以改成 ${count(blockedCount)}（改成 ${count(blockedCount)} 就是不再接新单）。`}</p>}
    </div>
  );
}

function DayPanel({ headingId, date, day, mode, today, last, readOnly, onSave }: { headingId: string; date: string; day: InventoryDayBody | null; mode: InventoryMode; today: string; last: string; readOnly: boolean; onSave(date: string, total: number | null): Promise<Failure | null> }) {
  const start = choiceOf(day);
  const [choice, setChoice] = useState<TotalChoice | null>(start.choice);
  const [value, setValue] = useState(start.value);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const view = inventoryCellView(date > last ? null : day);
  const icon = CELL_ICONS[view.kind] ?? null;
  const occupied = day ? day.sold + day.held : 0;
  const past = date < today;
  const beyond = date > last;

  const save = async (): Promise<void> => {
    if (saving || day === null) return;
    const reading = readTotal(choice, value);
    if (!reading.ok) return setProblem(reading.text);
    if (occupied > 0 && (reading.total === null || reading.total < occupied)) return setProblem(occupiedText(day));
    if (reading.total === day.total) return setProblem(null);
    setSaving(true);
    setProblem(null);
    const failure = await onSave(date, reading.total);
    setSaving(false);
    if (failure === null || failure.kind === "conflict") return;
    if (failure.kind === "blocked") return setProblem(failure.days[0] ? `这一天已经有 ${count(failure.days[0].occupied)} 单，可售单数不能少于 ${count(failure.days[0].occupied)}。` : occupiedText(day));
    if (failure.kind === "issues") return setProblem(failure.issues[0] ? batchIssueText(failure.issues[0].path, failure.issues[0].reason, today) : TOTAL_PROBLEM);
    setProblem(failure.text);
  };

  return (
    <>
      <h4 className="calendar-detail__title" id={headingId}>
        <time dateTime={date}>{date}</time> {weekdayName(date)}
      </h4>
      {day === null && !beyond ? (
        <p className="calendar-detail__loading">加载中…</p>
      ) : (
        <>
          <p className={`stock-day__status stock-cell--${view.kind}`}>
            {icon && <Icon name={icon} />}
            {view.kind === "open" ? `还剩 ${count(day?.remaining ?? 0)} 单` : view.kind === "unset" ? "没设，卖不出去" : view.kind === "beyond" ? "超出可以设库存的范围" : view.main}
          </p>
          {day !== null && !beyond && (
            <p className="calendar-detail__combo">{day.total === null ? (mode === "unlimited" ? "现在是不限量，这一天没有预先设数。" : "限量时，没有设库存的日子不接单。") : `${occupancyText({ total: day.total, sold: day.sold, held: day.held }, " 单")}${day.sold === 0 && day.held === 0 ? " · 已售 0 单 · 待付款 0 单" : ""}${mode === "unlimited" ? "。现在是不限量，这个数不起作用" : ""}`}</p>
          )}
          {past ? (
            <p className="calendar-detail__combo">过去的日子只能看。</p>
          ) : beyond ? (
            <p className="calendar-detail__combo">{`最远只能设到 ${last}（今天之后 ${INVENTORY_LIMITS.maxDaysAhead} 天）。`}</p>
          ) : readOnly || day === null ? null : (
            <form
              className="stock-day__form"
              id="stock-day-form"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.stopPropagation();
                document.getElementById(`inventory-day-${date}`)?.focus();
              }}
            >
              <p className="stock-day__legend">这一天改成：</p>
              <TotalChoices
                idPrefix="stock-day"
                legend="这一天改成"
                choice={choice}
                value={value}
                disabled={saving}
                blockedCount={occupied}
                mode={mode}
                onChange={(nextChoice, nextValue) => {
                  setChoice(nextChoice);
                  setValue(nextValue);
                  setProblem(null);
                }}
              />
              <div role="alert">
                <FieldErrors id="stock-day-error" errors={problem === null || problem === "" ? [] : [problem]} />
              </div>
              <Button variant="primary" size="sm" type="submit" loading={saving} loadingText="保存中…">
                保存
              </Button>
            </form>
          )}
        </>
      )}
    </>
  );
}

// ───────────── 切换模式 ─────────────

function ModeDialog({ target, productId, today, published, onClose, onSetFirst, onSubmit }: { target: InventoryMode | null; productId: string; today: string; published: boolean; onClose(): void; onSetFirst(): void; onSubmit(target: InventoryMode): Promise<string | null> }) {
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // 改成限量前先数一数今后一年设了几天（一次请求）；没取到就不写那一行
  const year = useLoad<Inventory>(`inventory-year:${productId}:${today}:${target}`, target === "limited" ? (token) => getInventory(token, productId, { from: today, to: addDays(today, INVENTORY_LIMITS.maxRangeDays - 1) }) : null);
  useEffect(() => {
    setProblem(null);
    setSaving(false);
  }, [target]);
  const days = target === "limited" && year.state.status === "ready" ? year.state.data.days : null;
  const set = days?.filter((day) => day.total !== null) ?? [];
  const sellable = set.filter((day) => (day.total ?? 0) - day.held - day.sold > 0).length;
  const lastSet = set.at(-1)?.date ?? null;
  const submit = async (): Promise<void> => {
    if (target === null || saving) return;
    setSaving(true);
    setProblem(null);
    const failure = await onSubmit(target);
    setSaving(false);
    setProblem(failure);
  };
  return (
    <Dialog
      open={target !== null}
      title={target === "unlimited" ? "改成不限量？" : "改成限量？"}
      busy={saving}
      onClose={onClose}
      footer={
        <>
          <Button variant="text" data-autofocus disabled={saving} onClick={onClose}>
            取消
          </Button>
          {target === "limited" && days !== null && set.length === 0 && (
            <Button variant="secondary" disabled={saving} onClick={onSetFirst}>
              先去设库存
            </Button>
          )}
          <Button variant="primary" loading={saving} loadingText="保存中…" onClick={() => void submit()}>
            {target === "unlimited" ? "改成不限量" : "改成限量"}
          </Button>
        </>
      }
    >
      <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
      {target === "unlimited" ? (
        <p>
          改成不限量后，<strong>每天不再限制接单的数量</strong>，下多少单都会接。你设好的每日库存会留着，但不起作用；以后改回限量时还在。
        </p>
      ) : (
        <>
          <p>
            改成限量后，<strong>每天最多接你设的单数；没有设库存的日子卖不出去</strong>。
          </p>
          <p className="stock-mode__fact" aria-live="polite">
            {days === null ? null : set.length === 0 ? (
              <span className="adjust-warning">
                <Icon name="alert-triangle" />
                <span>
                  <strong>你还没有给任何一天设库存。</strong>现在改成限量，这个商品每一天都卖不出去，直到你设上。建议先点「先去设库存」，设好再改。
                </span>
              </span>
            ) : (
              `今后一年里，你已经给 ${count(set.length)} 天设了库存（其中 ${count(sellable)} 天有库存可卖），最晚设到 ${lastSet ?? ""}。其余的日子卖不出去。`
            )}
          </p>
        </>
      )}
      {published && <p>这个商品已上架，改完大约 1 分钟生效。</p>}
    </Dialog>
  );
}

// ───────────── 批量设置 ─────────────

function BatchDialog({ initial, productId, today, mode, onClose, onJump, onSubmit }: { initial: BatchForm; productId: string; today: string; mode: InventoryMode; onClose(): void; onJump(date: string): void; onSubmit(batch: { from: string; to: string; weekdays: number[]; total: number | null }): Promise<Failure | null> }) {
  const [form, setForm] = useState<BatchForm>(initial);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [asking, setAsking] = useState(false);
  const [serverBlocked, setServerBlocked] = useState<BlockedDay[] | null>(null);
  const [serverProblems, setServerProblems] = useState<{ text: string; target: string }[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const reading = readBatchForm(form, today);
  const from = tidyDate(form.from);
  const to = tidyDate(form.to);
  const rangeOk = from !== null && to !== null && to >= from && daysInRange(from, to) <= INVENTORY_LIMITS.maxRangeDays;
  // 这段日期现在的库存：读回的话里「其中几天已经有数」、有没有被订单挡住
  const current = useLoad<Inventory>(`inventory-range:${productId}:${from}:${to}`, rangeOk ? (token) => getInventory(token, productId, { from: from as string, to: to as string }) : null);
  const currentDays = useMemo(() => (current.state.status === "ready" && rangeOk ? new Map(current.state.data.days.map((day) => [day.date, day])) : null), [current.state, rangeOk]);
  const change = (changes: Partial<BatchForm>): void => {
    setForm({ ...form, ...changes });
    setAsking(false);
    setServerBlocked(null);
    setServerProblems([]);
    setProblem(null);
  };
  const total = readTotal(form.choice, form.value);
  const blocked = serverBlocked ?? (total.ok && currentDays !== null ? blockedDays(reading.dates, currentDays, total.total) : []);
  const problems = [...(attempted ? reading.problems : []), ...serverProblems];
  const errors = (...targets: string[]): string[] => problems.filter((entry) => targets.includes(entry.target)).map((entry) => entry.text);
  const needsAsk = reading.batch !== null && (reading.dates.length >= 30 || reading.batch.total === null || reading.batch.total === 0);

  const submit = async (confirmed: boolean): Promise<void> => {
    if (saving) return;
    setAttempted(true);
    setProblem(null);
    const first = reading.problems[0];
    if (first || reading.batch === null) {
      if (first) requestAnimationFrame(() => focusAnchor(first.target));
      return;
    }
    if (blocked.length > 0) return;
    if (needsAsk && !confirmed) return setAsking(true);
    setSaving(true);
    const failure = await onSubmit(reading.batch);
    setSaving(false);
    setAsking(false);
    if (failure === null || failure.kind === "conflict") return;
    if (failure.kind === "blocked") {
      setServerBlocked(failure.days);
      requestAnimationFrame(() => focusAnchor("batch-blocked"));
      return;
    }
    if (failure.kind === "issues") {
      const targets: Readonly<Record<string, string>> = { "/from": "batch-from", "/to": "batch-to", "/weekdays": "batch-weekdays", "/total": "batch-total" };
      const placed = failure.issues.map((issue) => ({ text: batchIssueText(issue.path, issue.reason, today, reading.batch?.weekdays ?? []), target: targets[issue.path.replace(/\/\d+$/, "")] ?? "batch-from" }));
      return placed.length > 0 ? setServerProblems(placed) : setProblem("提交的内容不符合要求，请检查后重试。");
    }
    setProblem(failure.text);
  };

  const dateInput = (id: string, key: "from" | "to", label: string) => (
    <label className="range__cell">
      <span className="range__label">{key === "from" ? "从" : "到"}</span>
      <input
        className="input input--mono"
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        aria-label={label}
        aria-invalid={errors(id).length > 0 || undefined}
        placeholder="2026-10-08"
        readOnly={saving}
        {...(key === (initial.to === "" && initial.from !== "" ? "to" : "from") ? { "data-autofocus": true } : {})}
        value={form[key]}
        onChange={(event) => change({ [key]: event.target.value })}
        onBlur={() => {
          const tidy = tidyDate(form[key]);
          if (tidy !== null && tidy !== form[key]) change({ [key]: tidy });
        }}
      />
    </label>
  );
  const biggest = blocked.reduce((max, day) => Math.max(max, day.occupied), 0);
  const setting = total.ok && total.total !== null && total.total > 0;

  return (
    <Dialog
      open
      size="form"
      title="批量设置库存"
      busy={saving}
      dismissOnBackdrop={false}
      onClose={onClose}
      footer={
        asking ? (
          <span className="stock-batch__ask" role="status">
            <span>{`要改 ${count(reading.dates.length)} 天，确定吗？`}</span>
            <Button variant="primary" loading={saving} loadingText="保存中…" data-ask onClick={() => void submit(true)}>
              确定
            </Button>
            <Button variant="secondary" disabled={saving} onClick={() => setAsking(false)}>
              再看看
            </Button>
          </span>
        ) : (
          <>
            <Button variant="secondary" disabled={saving} onClick={onClose}>
              取消
            </Button>
            <Button variant="primary" loading={saving} loadingText="保存中…" disabled={blocked.length > 0} onClick={() => void submit(false)}>
              保存
            </Button>
          </>
        )
      }
    >
      <form
        className="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit(asking);
        }}
      >
        {/* 按钮在对话框的底栏里（表单外面）：留一个看不见的提交按钮，在输入框里按 Enter 才等于点保存 */}
        <input type="submit" hidden tabIndex={-1} />
        <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
        <fieldset className="field fieldset">
          <legend className="field__label">
            日期
            <span className="field__required" aria-hidden="true">
              {" *"}
            </span>
          </legend>
          <div className="range">
            {dateInput("batch-from", "from", "日期从")}
            {dateInput("batch-to", "to", "日期到")}
          </div>
          <FieldErrors id="batch-date-error" errors={errors("batch-from", "batch-to")} />
          <p className="field__hint">用车日期，两头都算。</p>
        </fieldset>
        <fieldset className="field fieldset">
          <legend className="field__label">
            哪几天
            <span className="field__required" aria-hidden="true">
              {" *"}
            </span>
          </legend>
          <div className="choices" role="radiogroup" aria-label="哪几天">
            <label className="choice">
              <input type="radio" name="batch-days" checked={form.everyDay} disabled={saving} onChange={() => change({ everyDay: true })} />
              <span className="choice__text">每天</span>
            </label>
            <label className="choice">
              <input type="radio" name="batch-days" checked={!form.everyDay} disabled={saving} onChange={() => change({ everyDay: false })} />
              <span className="choice__text">只设每周的某几天</span>
            </label>
          </div>
          {!form.everyDay && (
            <div className="weekdays" id="batch-weekdays" role="group" aria-label="每周的哪几天">
              {WEEKDAY_NAMES.map((name, index) => {
                const day = index + 1;
                const on = form.weekdays.includes(day);
                return (
                  <button key={day} type="button" className={on ? "weekdays__day weekdays__day--on" : "weekdays__day"} aria-pressed={on} disabled={saving} onClick={() => change({ weekdays: on ? form.weekdays.filter((entry) => entry !== day) : [...form.weekdays, day].sort((x, y) => x - y) })}>
                    {name}
                  </button>
                );
              })}
              <Button variant="text" size="sm" disabled={saving} onClick={() => change({ weekdays: [1, 2, 3, 4, 5] })}>
                工作日
              </Button>
              <Button variant="text" size="sm" disabled={saving} onClick={() => change({ weekdays: [6, 7] })}>
                周末
              </Button>
            </div>
          )}
          <FieldErrors id="batch-weekdays-error" errors={errors("batch-weekdays")} />
        </fieldset>
        <fieldset className="field fieldset">
          <legend className="field__label">
            设成
            <span className="field__required" aria-hidden="true">
              {" *"}
            </span>
          </legend>
          <TotalChoices idPrefix="batch" legend="设成" choice={form.choice} value={form.value} disabled={saving} blockedCount={0} mode={mode} onChange={(choice, value) => change({ choice, value })} />
          <FieldErrors id="batch-total-error" errors={errors("batch-total", "batch-choice")} />
          <p className="stock-batch__explain">
            <strong>停售</strong>和<strong>清除</strong>，现在的效果一样：这些天都不接单。区别是——<strong>停售</strong>是你定下来的「这几天不卖」，日历上写「停售」，不再提醒；<strong>清除</strong>是「还没定」，日历上写「没设」，限量时会一直用警告色提醒你。不确定就用停售。
          </p>
        </fieldset>
        {blocked.length > 0 ? (
          <div role="alert" id="batch-blocked" tabIndex={-1}>
            <Alert kind="danger">
              <strong className="alert__title">{serverBlocked !== null ? "没有保存，一天都没有改。" : "这样保存不了。"}</strong>
              <span>{`这 ${count(blocked.length)} 天已经有订单占着库存，${setting ? "可售单数不能少于已占用的单数：" : "不能停售，也不能清除："}`}</span>
              <span className="error-summary__list">
                {blocked.slice(0, 10).map((day) => (
                  <button key={day.date} type="button" className="link error-summary__item" onClick={() => onJump(day.date)}>
                    {blockedDayText(day)}
                  </button>
                ))}
                {blocked.length > 10 && <span>{`还有 ${count(blocked.length - 10)} 天`}</span>}
              </span>
              <span>
                {setting ? (
                  <>
                    把数量改成不少于 <strong>{count(biggest)}</strong>，或改日期避开这几天。
                  </>
                ) : (
                  "请改日期避开这几天。"
                )}
              </span>
            </Alert>
          </div>
        ) : (
          <p className="stock-batch__readback" aria-live="polite">
            {reading.batch !== null && (
              <>
                <strong>{batchDatesText(reading.batch, reading.dates.length)}</strong>：{batchEffectText(reading.batch.total)}
                {currentDays !== null && <span className="stock-batch__overwrite">{batchOverwriteText(reading.dates, currentDays, reading.batch.total, mode)}</span>}
              </>
            )}
          </p>
        )}
      </form>
    </Dialog>
  );
}

// ───────────── 导出库存 ─────────────

function ExportDialog({ open, today, busy, onClose, onExport }: { open: boolean; today: string; busy: boolean; onClose(): void; onExport(from: string, to: string): Promise<void> }) {
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 89));
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setFrom(today);
    setTo(addDays(today, 89));
    setProblem(null);
  }, [open, today]);
  const submit = (): void => {
    const start = tidyDate(from);
    const end = tidyDate(to);
    if (start === null) return setProblem("请填开始日期");
    if (end === null) return setProblem("请填结束日期");
    if (end < start) return setProblem("结束日期不能早于开始日期");
    if (daysInRange(start, end) > INVENTORY_LIMITS.maxRangeDays) return setProblem(`一次最多导出 ${INVENTORY_LIMITS.maxRangeDays} 天`);
    void onExport(start, end);
  };
  const input = (id: string, label: string, value: string, set: (value: string) => void, focus: boolean) => (
    <label className="range__cell">
      <span className="range__label">{label === "导出日期从" ? "从" : "到"}</span>
      <input className="input input--mono" id={id} type="text" inputMode="numeric" autoComplete="off" aria-label={label} aria-invalid={problem !== null || undefined} {...(focus ? { "data-autofocus": true } : {})} value={value} onChange={(event) => set(event.target.value)} onBlur={() => set(tidyDate(value) ?? value)} />
    </label>
  );
  return (
    <Dialog
      open={open}
      size="form"
      title="导出库存"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" disabled={busy} onClick={submit}>
            导出
          </Button>
        </>
      }
    >
      <form
        className="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <fieldset className="field fieldset">
          <legend className="field__label">日期</legend>
          <div className="range">
            {input("export-from", "导出日期从", from, setFrom, true)}
            {input("export-to", "导出日期到", to, setTo, false)}
          </div>
          <div role="alert">
            <FieldErrors id="export-error" errors={problem === null ? [] : [problem]} />
          </div>
          <p className="field__hint">每天一行。没设的日子那一格是空的——填上数再导入就是设置，所以它也是导入用的模版。</p>
        </fieldset>
      </form>
    </Dialog>
  );
}
