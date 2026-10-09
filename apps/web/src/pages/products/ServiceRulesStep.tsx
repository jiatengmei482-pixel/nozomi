/**
 * ② 服务规则（docs/design/pages/tenant-products.md 第 5 节）：预订规则、加急预订、夜间加价、免费等待、取消规则（只读）、
 * 附加服务和司机语言、服务后加收的费用（只读）。时间都按城市当地时间；金额是结算价，子品牌的币种。
 * 表单怎么读、哪里写错了在 lib/service-rules-form.ts；范围和缺项问 @nozomi/domain。
 */
import { type FreeWaitItem, type NightChargeUnit, PRODUCT_CATEGORY_NAMES, PRODUCT_LIMITS, addonAllowsFirstFree, freeWaitItems, serviceRuleMissing } from "@nozomi/domain";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { Addon } from "../../api/master.ts";
import { type Product, type ProductServiceRules, getServiceRules, listTenantAddons, putServiceRules } from "../../api/products.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { Button, IconButton } from "../../components/Button.tsx";
import { FieldErrors } from "../../components/FormFields.tsx";
import { Icon } from "../../components/Icon.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { CHARGE_UNIT_NAMES, displayName, timeZoneLabel } from "../../lib/master-display.ts";
import { checkReasons, moneyText, readAmount } from "../../lib/product-display.ts";
import type { ServerIssue } from "../../lib/product-failure.ts";
import { DRIVER_LANGUAGE_OPTIONS, type RulesForm, type RulesFormContext, defaultNightUnit, formFromRules, readRulesForm, rulePathTarget } from "../../lib/service-rules-form.ts";
import { crossesMidnight, dateRangeReadback, leadTimeReadback, tidyDate, tidyTime, urgentSegments, windowReadback } from "../../lib/time-input.ts";
import { useLoad } from "../../lib/use-load.ts";
import { type StepController, StepShell } from "./StepShell.tsx";
import type { ProductFrame, StepProblem } from "./frame.ts";

const NIGHT_UNITS: readonly { value: NightChargeUnit; label: string; hint: string }[] = [
  { value: "per_order", label: "按次", hint: "用车时间在夜间时段里，就加收一次这个金额。接送机一般用这种。" },
  { value: "per_hour", label: "按小时", hint: "按用车时间和夜间时段重叠的小时数加收。包车一般用这种。" },
];
const UNIT_SUFFIX: Readonly<Record<Addon["charge_unit"], string>> = { per_order: "", per_item: " / 个", per_person: " / 人", per_duration: " / 小时" };

function Warning({ children }: { children: ReactNode }) {
  return (
    <p className="field__hint field__hint--warning">
      <Icon name="alert-triangle" />
      <span>{children}</span>
    </p>
  );
}

const Star = () => (
  <span className="field__required" aria-hidden="true">
    {" *"}
  </span>
);

export function ServiceRulesStep({ frame, product }: { frame: ProductFrame; product: Product }) {
  const { readOnly } = frame;
  const { token } = usePortalSession();
  const loaded = useLoad<ProductServiceRules>(`service-rules:${product.id}`, (authToken) => getServiceRules(authToken, product.id));
  const catalog = useLoad<Addon[]>("tenant-addons", listTenantAddons);
  const data = loaded.state.data;
  const category = product.category;
  const station = product.poi?.type === "station";
  const items = freeWaitItems(category);

  const context: RulesFormContext = useMemo(
    () => ({
      category,
      pickupPlace: product.poi ? { type: product.poi.type, flightScope: product.poi.flight_scope } : null,
      currency: data?.currency ?? product.brand?.currency ?? null,
      minimums: data?.free_wait_minimums ?? { pickup: null, dropoff: null, general: null },
      addonNames: Object.fromEntries((catalog.state.data ?? []).map((addon) => [addon.id, displayName(addon.name).text])),
    }),
    [category, product.poi, product.brand?.currency, data, catalog.state.data],
  );
  const [form, setForm] = useState<RulesForm | null>(null);
  const [baseline, setBaseline] = useState("");
  const [adopted, setAdopted] = useState<ProductServiceRules | null>(null);
  const [server, setServer] = useState<Record<string, string[]>>({});
  const syncVersion = frame.syncVersion;
  useEffect(() => {
    if (data === null || data === adopted) return;
    const next = formFromRules(data.rules, context);
    setForm(next);
    setBaseline(JSON.stringify(readRulesForm(next, context).body));
    setAdopted(data);
    setServer({});
    syncVersion(data.version);
  }, [data]);

  const reading = useMemo(() => (form ? readRulesForm(form, context) : null), [form, context]);
  const currency = context.currency ?? "";

  if (form === null || reading === null || data === null) {
    return (
      <div className="step">
        <h2 className="step__title">② 服务规则</h2>
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
            <Skeleton lines={["medium", "control", "control", "long"]} />
          )}
        </section>
      </div>
    );
  }

  const set = (changes: Partial<RulesForm>): void => {
    setForm({ ...form, ...changes });
    setServer({});
  };
  const gaps = checkReasons({ key: "service_rules", required: true, passed: false, issues: serviceRuleMissing(reading.rules, context).map((issue) => ({ ...issue, message: "" })) }, { category, brandName: "", cityName: "", placeName: null, station });
  const neverSavedWait = items.some((item) => data.rules.free_wait[item] === null);

  const controller: StepController & { pending: boolean } = {
    dirty: JSON.stringify(reading.body) !== baseline,
    // 免费等待是页面替用户填好的建议值：没动过不算「有修改」，但点保存要真的存下来
    pending: neverSavedWait,
    missing: { count: gaps.length, anchor: gaps[0]?.anchor ?? null },
    validate: () => reading.problems,
    submit: async () => {
      const saved = await putServiceRules(token, product.id, frame.version, reading.body);
      loaded.set(saved);
      frame.saved(saved.version);
      return product.id;
    },
    placeServerIssues: (issues: ServerIssue[]): StepProblem[] => {
      const errors: Record<string, string[]> = {};
      const found: StepProblem[] = [];
      for (const issue of issues) {
        let target = rulePathTarget(issue.path);
        let text = issue.message;
        if (issue.reason === "ADDON_DISABLED" || issue.reason === "ADDON_NOT_APPLICABLE" || issue.reason === "UNKNOWN_ADDON") {
          const addon = reading.body.addons[Number(/\/addons\/(\d+)/.exec(issue.path)?.[1] ?? -1)];
          text = `「${addon ? (context.addonNames[addon.addon_id] ?? "") : ""}」平台已停用或不再适用，请取消勾选。`;
          target = addon ? `addon-${addon.addon_id}` : "addons";
        } else if (issue.reason === "BELOW_PLATFORM_MINIMUM") text = `不能少于平台规定的 ${String(issue.detail["min"] ?? "")} 分钟`;
        errors[target] = [...(errors[target] ?? []), text];
        found.push({ text, target });
      }
      setServer(errors);
      if (found.some((problem) => problem.target.startsWith("addon"))) catalog.reload();
      return found;
    },
    reload: loaded.reload,
  };

  const leadText = form.leadTime.trim();
  const lead = /^\d+$/.test(leadText) && Number(leadText) <= PRODUCT_LIMITS.maxLeadTimeHours ? Number(leadText) : null;
  const serviceReadback = form.allDay ? "全天 24 小时" : windowReadback(tidyTime(form.serviceStart) ?? "", tidyTime(form.serviceEnd) ?? "");
  const nightReadback = windowReadback(tidyTime(form.nightStart) ?? "", tidyTime(form.nightEnd) ?? "");
  const saleReadback = form.saleMode === "range" ? dateRangeReadback(tidyDate(form.saleFrom), tidyDate(form.saleTo)) : null;
  const segments = lead !== null && lead > 0 ? urgentSegments(lead, reading.rules.urgent.tiers) : [];
  const applicable = (catalog.state.data ?? []).filter((addon) => (addon.status === "active" && addon.categories.includes(category)) || form.addons[addon.id]?.enabled === true).sort((x, y) => x.code.localeCompare(y.code));
  const waitNames: Readonly<Record<FreeWaitItem, string>> = { pickup: station ? "接站" : "接机", dropoff: station ? "送站" : "送机", general: "上车点" };
  const waitHelp = (item: FreeWaitItem): string => {
    const minimum = context.minimums[item];
    const least = minimum === null ? "" : `平台规定最少 ${minimum} 分钟`;
    if (category === "charter") return `${least === "" ? "" : `${least}。`}包车从约定的开始时间起就计入套餐时长${minimum === 0 ? "；填 0 = 不免等。" : "。"}`;
    const from = item === "pickup" ? (station ? "从列车计划到达时间起算。" : "从航班实际落地起算。") : "从约定的上车时间起算。";
    return `${least === "" ? "" : `${least}，`}${from}`;
  };

  return (
    <StepShell
      frame={frame}
      slug="service-rules"
      title="② 服务规则"
      next={{ slug: "prices", label: "保存并下一步" }}
      controller={controller}
      intro={
        <Alert kind="info">
          <span>
            这一页的时间都按<strong>{`${product.city ? displayName(product.city.name).text : ""}当地时间`}</strong>
            {product.city ? `（${timeZoneLabel(product.city.timezone)}）` : ""}填写和计算。金额都是结算价，币种 <strong>{currency}</strong>。
          </span>
        </Alert>
      }
    >
      {({ busy, attempted, hint }) => {
        const locked = busy || readOnly;
        const errors = (...targets: string[]): string[] => [...(attempted ? reading.problems.filter((problem) => targets.includes(problem.target)).map((problem) => problem.text.replace(/^[^：]*：/, "")) : []), ...targets.flatMap((target) => server[target] ?? [])];
        const bad = (target: string): true | undefined => (errors(target).length > 0 ? true : undefined);
        const missingHint = (anchor: string): ReactNode => (hint === anchor && gaps.some((gap) => gap.anchor === anchor) ? <Warning>上架前要填这一项。</Warning> : null);
        const text = (id: string, value: string, onChange: (value: string) => void, extra: { label: string; placeholder?: string; tidy?: (value: string) => string | null; mode?: "numeric" | "decimal"; mono?: boolean; readOnly?: boolean } ) => (
          <input
            className={extra.mono === false ? "input" : "input input--mono"}
            id={id}
            type="text"
            inputMode={extra.mode ?? "numeric"}
            autoComplete="off"
            aria-label={extra.label}
            aria-invalid={bad(id)}
            placeholder={extra.placeholder}
            readOnly={locked || extra.readOnly === true}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onBlur={() => {
              const tidy = extra.tidy?.(value) ?? null;
              if (tidy !== null && tidy !== value) onChange(tidy);
            }}
          />
        );
        const money = (id: string, value: string, onChange: (value: string) => void, label: string, suffix: string) => (
          <span className="affix">
            {text(id, value, onChange, { label, mode: "decimal" })}
            <span className="affix__text">{suffix}</span>
          </span>
        );
        const windowFields = (ids: [string, string], start: string, end: string, onStart: (value: string) => void, onEnd: (value: string) => void, name: string, examples: [string, string], fixed: boolean) => (
          <div className="range">
            <label className="range__cell">
              <span className="range__label">从</span>
              {text(ids[0], fixed ? "00:00" : start, onStart, { label: `${name}从`, placeholder: examples[0], tidy: tidyTime, readOnly: fixed })}
            </label>
            <label className="range__cell">
              <span className="range__label">到</span>
              <span className="affix">
                {!fixed && crossesMidnight(tidyTime(start) ?? "", tidyTime(end) ?? "") && <span className="affix__text">次日</span>}
                {text(ids[1], fixed ? "24:00" : end, onEnd, { label: `${name}到`, placeholder: examples[1], tidy: tidyTime, readOnly: fixed })}
              </span>
            </label>
          </div>
        );
        return (
          <>
            <section className="card" aria-labelledby="rules-booking-title">
              <h3 className="card__title" id="rules-booking-title">
                预订规则
              </h3>
              <div className="form">
                <fieldset className="field fieldset" id="sale-period">
                  <legend className="field__label">下单有效期</legend>
                  <div className="choices">
                    {(["any", "range"] as const).map((mode) => (
                      <label key={mode} className="choice">
                        <input type="radio" name="sale-mode" checked={form.saleMode === mode} disabled={locked} onChange={() => set({ saleMode: mode })} />
                        <span className="choice__text">{mode === "any" ? "不限" : "指定日期"}</span>
                      </label>
                    ))}
                  </div>
                  {form.saleMode === "range" && (
                    <div className="range">
                      <label className="range__cell">
                        <span className="range__label">从</span>
                        {text("sale-from", form.saleFrom, (saleFrom) => set({ saleFrom }), { label: "下单有效期从", placeholder: "2026-01-01", tidy: tidyDate })}
                      </label>
                      <label className="range__cell">
                        <span className="range__label">到</span>
                        {text("sale-to", form.saleTo, (saleTo) => set({ saleTo }), { label: "下单有效期到", placeholder: "2026-12-31", tidy: tidyDate })}
                      </label>
                    </div>
                  )}
                  <FieldErrors id="sale-period-error" errors={errors("sale-from", "sale-to")} />
                  <p className="field__hint" aria-live="polite">
                    {saleReadback ?? (form.saleMode === "range" ? "两格都留空 = 不限。" : "")}
                  </p>
                  <p className="field__hint">在这段日期里下的单才接（看的是客人下单那一天，不是用车那一天，两端都含）。不限 = 一直可以下单。</p>
                </fieldset>

                <fieldset className="field fieldset" id="service-time">
                  <legend className="field__label">
                    服务时间
                    <Star />
                  </legend>
                  {windowFields(["service-time-start", "service-time-end"], form.serviceStart, form.serviceEnd, (serviceStart) => set({ serviceStart }), (serviceEnd) => set({ serviceEnd }), "服务时间", ["08:00", "22:00"], form.allDay)}
                  <label className="choice">
                    <input type="checkbox" checked={form.allDay} disabled={locked} onChange={(event) => set({ allDay: event.target.checked })} />
                    <span className="choice__text">全天 24 小时</span>
                  </label>
                  <FieldErrors id="service-time-error" errors={errors("service-time-start", "service-time-end")} />
                  <p className="field__hint readback" aria-live="polite">
                    {serviceReadback ?? ""}
                  </p>
                  {missingHint("service-time")}
                  <p className="field__hint">每天几点到几点可以用车。用车时间在这个时段里才报价，两端都算在内。结束比开始早就是到第二天。</p>
                </fieldset>

                <div className="field" id="lead-time">
                  <label className="field__label" htmlFor="lead-time-input">
                    提前预订时长
                    <Star />
                  </label>
                  <span className="affix affix--short">
                    {text("lead-time-input", form.leadTime, (leadTime) => set({ leadTime }), { label: "提前预订时长（小时）" })}
                    <span className="affix__text">小时</span>
                  </span>
                  <FieldErrors id="lead-time-error" errors={errors("lead-time-input")} />
                  {lead !== null && leadTimeReadback(lead) !== null && <p className="field__hint readback">{leadTimeReadback(lead)}</p>}
                  {missingHint("lead-time")}
                  <p className="field__hint">至少提前多久下单。例如填 24：用车前 24 小时以内就不能订了（开了加急预订的除外）。0 = 随时可以订。</p>
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="note">
                    备注（选填）
                  </label>
                  <textarea className="input textarea" id="note" rows={3} readOnly={locked} aria-invalid={bad("note")} value={form.note} onChange={(event) => set({ note: event.target.value })} />
                  <FieldErrors id="note-error" errors={errors("note")} />
                  <p className="field__hint">预订规则的补充说明，给自己人看的备忘。</p>
                </div>
              </div>
            </section>

            <section className="card" id="urgent" aria-labelledby="rules-urgent-title">
              <h3 className="card__title" id="rules-urgent-title">
                加急预订
              </h3>
              <div className="form">
                <label className="choice">
                  <input type="checkbox" id="urgent-toggle" checked={form.urgent} disabled={locked} aria-expanded={form.urgent} aria-controls="urgent-body" onChange={(event) => set({ urgent: event.target.checked, tiers: event.target.checked && form.tiers.length === 0 ? [{ hours: "", amount: "" }] : form.tiers })} />
                  <span className="choice__text">允许加急预订</span>
                </label>
                <p className="field__hint">开启后，客人在提前预订时长以内也能下单，按下面的阶梯加收加急费。不开启：不足提前预订时长的一律不报价。</p>
                {lead === 0 && <p className="field__hint field__hint--info">提前预订时长是 0，客人随时可以订，用不到加急预订。</p>}
                {!form.urgent && data.rules.urgent.enabled && <p className="field__hint field__hint--info">保存后，这里填的内容会清除。</p>}
                {missingHint("urgent")}
                {form.urgent && (
                  <div className="form" id="urgent-body">
                    <div className="field">
                      <label className="field__label" htmlFor="urgent-quota">
                        每日加急库存
                      </label>
                      <span className="affix affix--short">
                        {text("urgent-quota", form.quota, (quota) => set({ quota }), { label: "每日加急库存", placeholder: "不限" })}
                        <span className="affix__text">单 / 天</span>
                      </span>
                      <FieldErrors id="urgent-quota-error" errors={errors("urgent-quota")} />
                      <p className="field__hint">留空 = 不限。加急单最容易来不及派车，建议填一个你们一天接得住的数。</p>
                    </div>
                    <fieldset className="field fieldset">
                      <legend className="field__label">
                        加急阶梯
                        <Star />
                      </legend>
                      {form.tiers.map((tier, index) => {
                        const change = (changes: Partial<RulesForm["tiers"][number]>): void => set({ tiers: form.tiers.map((row, at) => (at === index ? { ...row, ...changes } : row)) });
                        return (
                          <div key={index} className="prow prow--pair">
                            <label className="prow__cell">
                              <span className="prow__label">提前不足（小时）</span>
                              {text(`tier-${index}-hours`, tier.hours, (hours) => change({ hours }), { label: `第 ${index + 1} 档：提前不足多少小时` })}
                            </label>
                            <label className="prow__cell">
                              <span className="prow__label">{`加收（${currency}）`}</span>
                              {text(`tier-${index}-amount`, tier.amount, (amount) => change({ amount }), { label: `第 ${index + 1} 档：加收的金额`, mode: "decimal" })}
                            </label>
                            {!readOnly && <IconButton icon="x" label={`删除第 ${index + 1} 档`} disabled={busy} onClick={() => set({ tiers: form.tiers.filter((_, at) => at !== index) })} />}
                            <FieldErrors id={`tier-${index}-error`} errors={errors(`tier-${index}-hours`, `tier-${index}-amount`)} />
                          </div>
                        );
                      })}
                      {!readOnly && (
                        <div>
                          <Button size="sm" disabled={busy || form.tiers.length >= PRODUCT_LIMITS.maxUrgentTiers} onClick={() => set({ tiers: [...form.tiers, { hours: "", amount: "" }] })}>
                            <Icon name="plus" />
                            添加一档
                          </Button>
                        </div>
                      )}
                      <div className="readback" aria-live="polite">
                        {lead === null ? (
                          <p className="field__hint">先填上面的提前预订时长，这里会算出每一段怎么收。</p>
                        ) : (
                          lead > 0 && (
                            <>
                              <p className="field__hint">{`提前预订时长是 ${lead} 小时。`}</p>
                              <ul className="readback__list">
                                {segments.map((segment) => {
                                  const range = segment.from === 0 ? `提前不足 ${segment.to} 小时下单` : `提前 ${segment.from} 到 ${segment.to} 小时下单`;
                                  return segment.tier ? (
                                    <li key={segment.to}>{`${range}：加收 ${moneyText(segment.tier.surchargeMinor, context.currency)}`}</li>
                                  ) : (
                                    <li key={segment.to} className="readback__gap">
                                      <Icon name="alert-triangle" />
                                      <span>
                                        {`${range}：`}
                                        <strong>不接</strong>
                                        {`（不在任何一档里）。要接这一段，请加一档「提前不足 ${lead} 小时」`}
                                      </span>
                                    </li>
                                  );
                                })}
                              </ul>
                            </>
                          )
                        )}
                      </div>
                    </fieldset>
                  </div>
                )}
              </div>
            </section>

            <section className="card" id="night" aria-labelledby="rules-night-title">
              <h3 className="card__title" id="rules-night-title">
                夜间加价
              </h3>
              <div className="form">
                <label className="choice">
                  <input type="checkbox" id="night-toggle" checked={form.night} disabled={locked} aria-expanded={form.night} aria-controls="night-body" onChange={(event) => set({ night: event.target.checked, nightUnit: form.nightUnit ?? defaultNightUnit(category) })} />
                  <span className="choice__text">收夜间加价</span>
                </label>
                <p className="field__hint">用车时间落在夜间时段里时，在结算价上另加一笔。不勾 = 不收。</p>
                {!form.night && data.rules.night.enabled && <p className="field__hint field__hint--info">保存后，这里填的内容会清除。</p>}
                {missingHint("night")}
                {form.night && (
                  <div className="form" id="night-body">
                    <fieldset className="field fieldset">
                      <legend className="field__label">
                        夜间时段
                        <Star />
                      </legend>
                      {windowFields(["night-start", "night-end"], form.nightStart, form.nightEnd, (nightStart) => set({ nightStart }), (nightEnd) => set({ nightEnd }), "夜间时段", ["22:00", "06:00"], false)}
                      <FieldErrors id="night-window-error" errors={errors("night-start", "night-end")} />
                      <p className="field__hint readback" aria-live="polite">
                        {nightReadback ?? ""}
                      </p>
                    </fieldset>
                    <fieldset className="field fieldset">
                      <legend className="field__label">
                        计费方式
                        <Star />
                      </legend>
                      <div className="choices choices--stacked">
                        {NIGHT_UNITS.map((unit) => (
                          <label key={unit.value} className="choice">
                            <input type="radio" name="night-unit" checked={form.nightUnit === unit.value} disabled={locked} onChange={() => set({ nightUnit: unit.value })} />
                            <span className="choice__text">
                              {unit.label}
                              <span className="choice__hint">{unit.hint}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <div className="field">
                      <label className="field__label" htmlFor="night-amount">
                        金额
                        <Star />
                      </label>
                      {money("night-amount", form.nightAmount, (nightAmount) => set({ nightAmount }), "夜间加价的金额", form.nightUnit === "per_hour" ? `${currency} / 小时` : currency)}
                      <FieldErrors id="night-amount-error" errors={errors("night-amount")} />
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section className="card" id="free-wait" aria-labelledby="rules-wait-title">
              <h3 className="card__title" id="rules-wait-title">
                免费等待
              </h3>
              <div className="form">
                <p className="field__hint">司机到了以后免费等客人多久。平台规定了最少要等多久，你可以设得更长，不能更短。</p>
                {neverSavedWait && !readOnly && <p className="field__hint field__hint--info">下面是按平台规定的最少时间替你填好的，确认后点保存才会存下来。</p>}
                {items.map((item) => {
                  const field = form.wait[item];
                  const change = (changes: Partial<RulesForm["wait"][FreeWaitItem]>): void => set({ wait: { ...form.wait, [item]: { ...field, ...changes } } });
                  const minimum = context.minimums[item];
                  return (
                    <fieldset key={item} className="field fieldset">
                      <legend className="field__label">
                        {waitNames[item]}
                        <Star />
                      </legend>
                      <div className="choices choices--stacked">
                        <label className="choice choice--inline">
                          <input type="radio" name={`wait-${item}`} checked={field.mode === "limited"} disabled={locked} aria-label={`${waitNames[item]}：等若干分钟`} onChange={() => change({ mode: "limited" })} />
                          <span className="choice__text choice__text--row">
                            等
                            <span className="affix affix--tiny">{text(`wait-${item}-minutes`, field.minutes, (minutes) => change({ minutes, mode: "limited" }), { label: `${waitNames[item]}免费等待的分钟数` })}</span>
                            分钟
                          </span>
                        </label>
                        <label className="choice">
                          <input type="radio" name={`wait-${item}`} checked={field.mode === "unlimited"} disabled={locked} onChange={() => change({ mode: "unlimited" })} />
                          <span className="choice__text">
                            不限时
                            <span className="choice__hint">一直等到客人出现，不收等待费。</span>
                          </span>
                        </label>
                      </div>
                      <FieldErrors id={`wait-${item}-error`} errors={errors(`wait-${item}-minutes`)} />
                      <p className="field__hint">
                        {waitHelp(item)}
                        {item === "pickup" && !station && category === "airport_transfer" && minimum !== null && minimum < 90 && <strong>国际航班平台规定最少 90 分钟：你设的不到 90 时，国际航班按 90 分钟算。</strong>}
                      </p>
                    </fieldset>
                  );
                })}
                {missingHint("free-wait")}
              </div>
            </section>

            <section className="card" aria-labelledby="rules-cancel-title">
              <div className="card__title-row">
                <h3 className="card__title" id="rules-cancel-title">
                  取消规则
                </h3>
                <span className="tag">平台统一 · 不能修改</span>
              </div>
              <p>客人付款前不知道订单会给哪家供应商，所以取消规则由平台按品类和车型级别统一规定，所有供应商相同，这里不用设置。</p>
            </section>

            <section className="card" id="addons" aria-labelledby="rules-addons-title">
              <h3 className="card__title" id="rules-addons-title">
                附加服务
              </h3>
              <div className="form">
                <p className="field__hint">客人下单时可以加选的服务，从平台的目录里选你能提供的。单价是结算价；填 0 = 免费提供。</p>
                {catalog.state.data === null ? (
                  catalog.state.status === "loading" ? (
                    <p className="field__hint">正在加载附加服务…</p>
                  ) : (
                    <p className="field__hint">
                      附加服务没有加载出来。
                      <Button variant="text" size="sm" onClick={catalog.reload}>
                        重试
                      </Button>
                    </p>
                  )
                ) : applicable.length === 0 ? (
                  <p className="field__hint">{`平台还没有适用于${PRODUCT_CATEGORY_NAMES[category]}的附加服务。`}</p>
                ) : (
                  <ul className="addon-list">
                    {applicable.map((addon) => {
                      const field = form.addons[addon.id] ?? { enabled: false, price: "", firstFree: false };
                      const change = (changes: Partial<typeof field>): void => set({ addons: { ...form.addons, [addon.id]: { ...field, ...changes } } });
                      const name = displayName(addon.name).text;
                      const stale = addon.status !== "active" ? "平台已停用" : !addon.categories.includes(category) ? "不再适用" : null;
                      const price = readAmount(field.price, context.currency);
                      const free = price.ok && price.minor === 0;
                      const description = displayName(addon.description).text;
                      return (
                        <li key={addon.id} className="addon" id={`addon-${addon.id}`}>
                          <label className="choice addon__name">
                            <input type="checkbox" checked={field.enabled} disabled={locked} onChange={(event) => change({ enabled: event.target.checked })} />
                            <span className="choice__text">
                              {name}
                              {description !== "" && Object.keys(addon.description).length > 0 && <span className="choice__hint">{description}</span>}
                            </span>
                          </label>
                          <span className="tag">{CHARGE_UNIT_NAMES[addon.charge_unit]}</span>
                          {stale !== null && <StatusBadge tone="neutral" label={stale} />}
                          {field.enabled && (
                            <span className="addon__price">
                              <span className="prow__label">单价</span>
                              {money(`addon-${addon.id}-price`, field.price, (value) => change({ price: value }), `${name}的单价`, `${currency}${UNIT_SUFFIX[addon.charge_unit]}`)}
                              {free && <span className="tag">免费提供</span>}
                            </span>
                          )}
                          {field.enabled && addonAllowsFirstFree(addon.charge_unit) && (
                            <label className="choice addon__extra">
                              <input type="checkbox" checked={field.firstFree && !free} disabled={locked || free} onChange={(event) => change({ firstFree: event.target.checked })} />
                              <span className="choice__text">
                                第一个免费
                                <span className="choice__hint">客人加选的第一个不收钱，从第二个起按单价收。</span>
                              </span>
                            </label>
                          )}
                          <span className="addon__notes">
                            <FieldErrors id={`addon-${addon.id}-error`} errors={errors(`addon-${addon.id}-price`, `addon-${addon.id}`)} />
                            {stale !== null && field.enabled && <Warning>上架前请取消勾选。</Warning>}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <FieldErrors id="addons-error" errors={server["addons"] ?? []} />
                {category === "charter" && <p className="field__hint">包车的超时费、超公里费在「价格规则」里设置。</p>}

                <fieldset className="field fieldset addon-languages">
                  <legend className="field__label">司机语言</legend>
                  <p className="field__hint">客人可以指定司机会说的语言。把你们能提供的语言加上并填单价；填 0 = 这种语言免费提供。一行都不加 = 不提供指定语言。</p>
                  {form.languages.map((row, index) => {
                    const change = (changes: Partial<RulesForm["languages"][number]>): void => set({ languages: form.languages.map((entry, at) => (at === index ? { ...entry, ...changes } : entry)) });
                    return (
                      <div key={index} className="prow prow--pair">
                        <label className="prow__cell">
                          <span className="prow__label">语言</span>
                          <select className="input select" id={`language-${index}-select`} aria-label={`第 ${index + 1} 行：语言`} aria-invalid={bad(`language-${index}-select`)} disabled={locked} value={row.language} onChange={(event) => change({ language: event.target.value })}>
                            <option value="">请选择</option>
                            {DRIVER_LANGUAGE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="prow__cell">
                          <span className="prow__label">{`单价（${currency}）`}</span>
                          {text(`language-${index}-price`, row.price, (value) => change({ price: value }), { label: `第 ${index + 1} 行：单价`, mode: "decimal" })}
                        </label>
                        {!readOnly && <IconButton icon="x" label={`删除第 ${index + 1} 行语言`} disabled={busy} onClick={() => set({ languages: form.languages.filter((_, at) => at !== index) })} />}
                        <FieldErrors id={`language-${index}-error`} errors={errors(`language-${index}-select`, `language-${index}-price`)} />
                      </div>
                    );
                  })}
                  {!readOnly && (
                    <div>
                      <Button size="sm" disabled={busy || form.languages.length >= DRIVER_LANGUAGE_OPTIONS.length} onClick={() => set({ languages: [...form.languages, { language: "", price: "" }] })}>
                        <Icon name="plus" />
                        添加语言
                      </Button>
                      {form.languages.length >= DRIVER_LANGUAGE_OPTIONS.length && <span className="field__hint"> 都加上了</span>}
                    </div>
                  )}
                </fieldset>
              </div>
            </section>

            <section className="card" aria-labelledby="rules-after-title">
              <div className="card__title-row">
                <h3 className="card__title" id="rules-after-title">
                  服务后加收的费用
                </h3>
                <span className="tag">平台统一 · 不能修改</span>
              </div>
              <p>
                超时、超公里等服务后才知道的费用，由你们在服务结束后 24 小时内在订单里提交，平台从客人下单时保存的支付方式里线上补款；客人有 48 小时可以提出异议。<strong>平台的订单不收现金。</strong>
              </p>
            </section>
          </>
        );
      }}
    </StepShell>
  );
}
