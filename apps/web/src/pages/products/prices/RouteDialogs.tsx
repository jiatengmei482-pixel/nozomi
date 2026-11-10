/**
 * 点对点「线路价」的选线路和两个对话框（docs/design/pages/tenant-prices.md 17.3，ADR 0073 第二部分，M8-12）：
 * - 服务线路：上车区域 → 下车区域两个区域下拉（只列这个商品的服务区域里能挂价格的），「确认添加」；
 * - 新增线路价：车型组、计价方式、价格、返程价格（选填，同时建反方向）、含公里数、生效日期、启用；
 * - 复制线路：默认复制成反方向（建返程）。
 * 对话框只把行放进价格表（「新的，未保存」），和页面上别的修改一起批量保存（同一事务）。金额都是结算价（规则 4）。
 */
import { PRICE_LIMITS, PRICING_MODEL_NAMES, type PricingModel } from "@nozomi/domain";
import type { ReactNode } from "react";
import { Button } from "../../../components/Button.tsx";
import { Dialog } from "../../../components/Dialog.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { MODEL_FIELDS, type PriceContext, type PriceField, type PriceRow, fieldName } from "../../../lib/price-form.ts";
import { tidyAmountDisplay } from "../../../lib/product-display.ts";
import {
  type CopyDraft,
  type Route,
  type RouteDraft,
  INCLUDED_KM_HELP,
  KM_PRICE_HELP,
  RETURN_HELP,
  copyDraftIssues,
  copyGroupOptions,
  copyPlanText,
  planCopy,
  planRoute,
  reverseOf,
  routeDraftIssues,
  routePlanText,
} from "../../../lib/route-prices.ts";
import { CheckGroup } from "./AreaSurchargeBlock.tsx";

export interface RouteArea {
  id: string;
  name: string;
}

/** 上车区域、下车区域两个下拉（服务线路、复制到哪条线路共用）。下车区域里和上车区域相同的那一项不可选。 */
export function RouteSelects({ idPrefix, areas, value, disabled, invalid, describedBy, onChange }: { idPrefix: string; areas: readonly RouteArea[]; value: Route; disabled: boolean; invalid: boolean; describedBy?: string | undefined; onChange(next: Route): void }) {
  return (
    <div className="route-pick__selects">
      <label className="route-pick__item" htmlFor={`${idPrefix}-from`}>
        <span>上车区域</span>
        <select className="input input--sm select" id={`${idPrefix}-from`} value={value.from} disabled={disabled} aria-invalid={invalid && value.from === "" ? true : undefined} aria-describedby={describedBy} onChange={(event) => onChange({ from: event.target.value, to: value.to === event.target.value ? "" : value.to })}>
          <option value="">选择区域</option>
          {areas.map((area) => (
            <option key={area.id} value={area.id}>
              {area.name}
            </option>
          ))}
        </select>
      </label>
      <span className="route-pick__arrow" aria-hidden="true">
        <span className="route-pick__arrow-wide">→</span>
        <Icon name="arrow-down" className="route-pick__arrow-narrow" />
      </span>
      <label className="route-pick__item" htmlFor={`${idPrefix}-to`}>
        <span>下车区域</span>
        <select className="input input--sm select" id={`${idPrefix}-to`} value={value.to} disabled={disabled} aria-invalid={invalid && value.to === "" ? true : undefined} aria-describedby={describedBy} onChange={(event) => onChange({ ...value, to: event.target.value })}>
          <option value="">选择区域</option>
          {areas.map((area) => (
            <option key={area.id} value={area.id} disabled={area.id === value.from} aria-disabled={area.id === value.from || undefined}>
              {area.id === value.from ? `${area.name}（同一个区域用区域价）` : area.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function AmountField({ id, label, required, value, currency, unit, error, hint, onChange, autoFocus }: { id: string; label: ReactNode; required: boolean; value: string; currency: string | null; unit: string; error: string | undefined; hint: string | null; onChange(next: string): void; autoFocus?: boolean }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
        {required && (
          <span className="field__required" aria-hidden="true">
            {" *"}
          </span>
        )}
      </label>
      <div className="surcharge-dialog__amount">
        <input
          className="input input--mono"
          id={id}
          inputMode={currency === null ? "numeric" : "decimal"}
          autoComplete="off"
          {...(autoFocus ? { "data-autofocus": true } : {})}
          aria-invalid={error !== undefined || undefined}
          aria-describedby={hint !== null ? `${id}-hint` : undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => {
            if (currency === null) return;
            const tidy = tidyAmountDisplay(value, currency);
            if (tidy !== value) onChange(tidy);
          }}
        />
        <span className="surcharge-dialog__currency" aria-hidden="true">
          {unit}
        </span>
      </div>
      {error !== undefined && <p className="field__error">{error}</p>}
      {hint !== null && (
        <p className="field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

const MILEAGE_UNITS: Readonly<Partial<Record<PriceField, string>>> = { startKm: "公里", startMin: "分钟", perKm: " / 公里", perMin: " / 分钟" };

export function AddRouteDialog(props: {
  draft: RouteDraft | null;
  setDraft(next: RouteDraft | null): void;
  rows: readonly PriceRow[];
  context: PriceContext;
  models: readonly PricingModel[];
  groups: readonly { id: string; name: string }[];
  /** 这条线路上已经有线路价的车型组（后面小字「已有线路价」） */
  priced: ReadonlySet<string>;
  areaName(id: string): string;
  /** 页面上已经有几条没保存的修改（「一次最多保存 500 条」一起算） */
  pending: number;
  onSubmit(draft: RouteDraft): void;
}) {
  const { draft, setDraft, context, groups } = props;
  const currency = context.currency;
  const issues = draft && draft.attempted ? routeDraftIssues(draft, context) : {};
  const plan = draft ? planRoute(props.rows, draft, context) : null;
  const total = plan ? plan.outbound.length + plan.inbound.length : 0;
  const overLimit = total + props.pending > PRICE_LIMITS.maxBatchChanges;
  const name = draft ? `${props.areaName(draft.route.from)} → ${props.areaName(draft.route.to)}` : "";
  const back = draft ? `${props.areaName(draft.route.to)} → ${props.areaName(draft.route.from)}` : "";
  const set = (field: PriceField, value: string): void => {
    if (draft) setDraft({ ...draft, values: { ...draft.values, [field]: value } });
  };
  const submit = (): void => {
    if (!draft) return;
    if (Object.keys(routeDraftIssues(draft, context)).length > 0) return setDraft({ ...draft, attempted: true });
    props.onSubmit(draft);
  };
  return (
    <Dialog
      open={draft !== null}
      size="form"
      title={`新增线路价：${name}`}
      dismissOnBackdrop={false}
      onClose={() => setDraft(null)}
      footer={
        <>
          <Button variant="secondary" onClick={() => setDraft(null)}>
            取消
          </Button>
          <Button variant="primary" disabled={overLimit} onClick={submit}>
            添加到表里
          </Button>
        </>
      }
    >
      {draft && (
        <div className="form surcharge-dialog route-dialog">
          <CheckGroup
            legend="车型组"
            all={groups.map((group) => group.id)}
            chosen={draft.groups}
            nameOf={(id) => `${groups.find((group) => group.id === id)?.name ?? ""}${props.priced.has(id) ? "（已有线路价）" : ""}`}
            error={issues.groups}
            onChange={(next) => setDraft({ ...draft, groups: next })}
          />
          {props.models.length > 1 && (
            <fieldset className="field surcharge-dialog__checks">
              <legend className="field__label">计价方式</legend>
              {props.models.map((model) => (
                <label key={model} className="choice">
                  <input type="radio" name="route-model" checked={draft.model === model} onChange={() => setDraft({ ...draft, model })} />
                  <span className="choice__text">{model === "fixed" ? "一口价" : PRICING_MODEL_NAMES[model]}</span>
                </label>
              ))}
            </fieldset>
          )}
          {draft.model === "fixed" ? (
            <>
              <AmountField id="route-price" label="价格" required value={draft.values.base} currency={currency} unit={currency} error={issues.base} hint={`${props.areaName(draft.route.from)}上车、${props.areaName(draft.route.to)}下车，每单收多少`} onChange={(value) => set("base", value)} autoFocus />
              <AmountField id="route-return" label={`返程价格（${back}）`} required={false} value={draft.returnPrice} currency={currency} unit={currency} error={issues.returnPrice} hint={`选填。${RETURN_HELP}`} onChange={(value) => setDraft({ ...draft, returnPrice: value })} />
              <AmountField id="route-incl-km" label="含公里数" required={false} value={draft.values.inclKm} currency={null} unit="公里" error={issues.inclKm} hint={`选填，和「超出每公里」一起填。${INCLUDED_KM_HELP}`} onChange={(value) => set("inclKm", value)} />
              <AmountField id="route-km-price" label="超出每公里" required={false} value={draft.values.kmPrice} currency={currency} unit={`${currency} / 公里`} error={issues.kmPrice} hint={KM_PRICE_HELP} onChange={(value) => set("kmPrice", value)} />
            </>
          ) : (
            <>
              {MODEL_FIELDS[draft.model].map((field, index) => (
                <AmountField
                  key={field}
                  id={`route-${field}`}
                  label={fieldName(field, draft.model)}
                  required={field !== "min"}
                  value={draft.values[field]}
                  currency={MILEAGE_UNITS[field] === "公里" || MILEAGE_UNITS[field] === "分钟" ? null : currency}
                  unit={MILEAGE_UNITS[field] === "公里" || MILEAGE_UNITS[field] === "分钟" ? (MILEAGE_UNITS[field] as string) : `${currency}${MILEAGE_UNITS[field] ?? ""}`}
                  error={issues[field]}
                  hint={field === "perKm" ? "不足 1 公里按比例" : field === "min" ? "选填" : null}
                  onChange={(value) => set(field, value)}
                  autoFocus={index === 0}
                />
              ))}
              <p className="field__hint">里程 + 时长的线路价没有返程价格和含公里数。要反方向，添加后在这条线路上点「建返程」（复制成反方向）。</p>
            </>
          )}
          <fieldset className="field surcharge-dialog__dates">
            <legend className="field__label">生效日期</legend>
            <span className="surcharge-dialog__date">
              <label htmlFor="route-from">从</label>
              <input className="input input--mono" id="route-from" inputMode="numeric" autoComplete="off" placeholder="年-月-日" aria-invalid={issues.from !== undefined || undefined} value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} />
            </span>
            <span className="surcharge-dialog__date">
              <label htmlFor="route-to">到</label>
              <input className="input input--mono" id="route-to" inputMode="numeric" autoComplete="off" placeholder="一直有效" aria-invalid={issues.to !== undefined || undefined} value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} />
            </span>
            {issues.from !== undefined && <p className="field__error">{issues.from}</p>}
            {issues.to !== undefined && <p className="field__error">{issues.to}</p>}
          </fieldset>
          <label className="choice">
            <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />
            <span className="choice__text">启用</span>
          </label>
          {plan !== null && (plan.overlapOut > 0 || plan.overlapBack > 0) && (
            <p className="field__hint surcharge-dialog__warn">
              {[plan.overlapOut > 0 ? `去程里有 ${plan.overlapOut} 条` : "", plan.overlapBack > 0 ? `返程里有 ${plan.overlapBack} 条` : ""].filter((part) => part !== "").join("，")}
              会和已有的线路价日期重叠。仍然可以添加，到表里再改日期。
            </p>
          )}
          <p role="status" className="surcharge-dialog__result">
            {plan ? routePlanText(plan) : ""}
          </p>
          {overLimit && <p className="field__error">{`这次会加 ${total} 条，加上还没保存的 ${props.pending} 条超过了一次最多保存的 ${PRICE_LIMITS.maxBatchChanges} 条。请先保存，或少勾几个车型组。`}</p>}
        </div>
      )}
    </Dialog>
  );
}

export function CopyRouteDialog(props: {
  draft: CopyDraft | null;
  setDraft(next: CopyDraft | null): void;
  rows: readonly PriceRow[];
  context: PriceContext;
  areas: readonly RouteArea[];
  groupName(id: string): string;
  areaName(id: string): string;
  pending: number;
  onSubmit(draft: CopyDraft): void;
}) {
  const { draft, setDraft, context } = props;
  const currency = context.currency;
  const issues = draft ? copyDraftIssues(draft, currency) : {};
  // 线路选好了、填了调整的数才说错在哪（没选完时「复制」本来就是灰的）
  const shown: typeof issues = draft
    ? {
        ...((draft.attempted || (draft.target.from !== "" && draft.target.to !== "")) && issues.target !== undefined ? { target: issues.target } : {}),
        ...(issues.groups !== undefined ? { groups: issues.groups } : {}),
        ...((draft.attempted || draft.amount.trim() !== "") && issues.amount !== undefined ? { amount: issues.amount } : {}),
      }
    : {};
  const plan = draft ? planCopy(props.rows, draft, context) : null;
  const options = draft ? (draft.onlyRow !== null ? draft.groups : copyGroupOptions(props.rows, draft.source, context)) : [];
  const overLimit = plan !== null && plan.added.length + plan.replaced.length + props.pending > PRICE_LIMITS.maxBatchChanges;
  const submit = (): void => {
    if (!draft) return;
    if (Object.keys(issues).length > 0) return setDraft({ ...draft, attempted: true });
    props.onSubmit(draft);
  };
  return (
    <Dialog
      open={draft !== null}
      size="form"
      title={draft ? `复制线路：${props.areaName(draft.source.from)} → ${props.areaName(draft.source.to)}` : "复制线路"}
      dismissOnBackdrop={false}
      onClose={() => setDraft(null)}
      footer={
        <>
          <Button variant="secondary" onClick={() => setDraft(null)}>
            取消
          </Button>
          <Button variant="primary" disabled={(plan?.added.length ?? 0) === 0 || overLimit} onClick={submit}>
            复制
          </Button>
        </>
      }
    >
      {draft && (
        <div className="form surcharge-dialog route-dialog">
          <fieldset className="field surcharge-dialog__checks">
            <legend className="field__label">复制到</legend>
            <RouteSelects idPrefix="route-copy" areas={props.areas} value={draft.target} disabled={false} invalid={shown.target !== undefined} describedBy={shown.target !== undefined ? "route-copy-error" : undefined} onChange={(target) => setDraft({ ...draft, target })} />
            <span>
              <Button size="sm" variant="text" onClick={() => setDraft({ ...draft, target: reverseOf(draft.source) })}>
                换成反方向
              </Button>
            </span>
            {shown.target !== undefined && (
              <p className="field__error" id="route-copy-error">
                {shown.target}
              </p>
            )}
          </fieldset>
          <CheckGroup legend="复制哪些车型组" all={options} chosen={draft.groups} nameOf={props.groupName} error={shown.groups} onChange={(next) => setDraft({ ...draft, groups: next })} />
          <fieldset className="field surcharge-dialog__checks">
            <legend className="field__label">价格</legend>
            {(
              [
                ["none", "原样复制"],
                ["up", "复制时上调"],
                ["down", "复制时下调"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="choice">
                <input type="radio" name="route-copy-adjust" checked={draft.adjust === value} onChange={() => setDraft({ ...draft, adjust: value })} />
                <span className="choice__text">{label}</span>
              </label>
            ))}
            {draft.adjust !== "none" && (
              <div className="route-dialog__adjust">
                <label className="choice">
                  <input type="radio" name="route-copy-by" checked={draft.by === "percent"} onChange={() => setDraft({ ...draft, by: "percent" })} />
                  <span className="choice__text">按比例</span>
                </label>
                <label className="choice">
                  <input type="radio" name="route-copy-by" checked={draft.by === "amount"} onChange={() => setDraft({ ...draft, by: "amount" })} />
                  <span className="choice__text">按金额</span>
                </label>
                <span className="surcharge-dialog__amount">
                  <input className="input input--mono" aria-label={draft.by === "percent" ? "调整的百分比" : `调整的金额（${currency}）`} inputMode="decimal" autoComplete="off" aria-invalid={shown.amount !== undefined || undefined} value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} />
                  <span className="surcharge-dialog__currency" aria-hidden="true">
                    {draft.by === "percent" ? "%" : currency}
                  </span>
                </span>
                {shown.amount !== undefined && <p className="field__error">{shown.amount}</p>}
              </div>
            )}
            <p className="field__hint">只调价格（起步价）；含公里数、超出每公里和其他的数原样复制。生效日期、启用也原样。</p>
          </fieldset>
          <fieldset className="field surcharge-dialog__checks">
            <legend className="field__label">目标线路已经有价格时</legend>
            <label className="choice">
              <input type="radio" name="route-copy-existing" checked={draft.existing === "skip"} onChange={() => setDraft({ ...draft, existing: "skip" })} />
              <span className="choice__text">跳过</span>
            </label>
            <label className="choice">
              <input type="radio" name="route-copy-existing" checked={draft.existing === "replace"} onChange={() => setDraft({ ...draft, existing: "replace" })} />
              <span className="choice__text">换成复制过去的</span>
            </label>
          </fieldset>
          <p role="status" className="surcharge-dialog__result">
            {plan ? copyPlanText(plan) : ""}
            {plan !== null && plan.added.length === 0 && issues.target === undefined && "没有可以填的线路价。"}
          </p>
          {overLimit && <p className="field__error">{`加上还没保存的 ${props.pending} 条超过了一次最多保存的 ${PRICE_LIMITS.maxBatchChanges} 条。请先保存。`}</p>}
        </div>
      )}
    </Dialog>
  );
}
