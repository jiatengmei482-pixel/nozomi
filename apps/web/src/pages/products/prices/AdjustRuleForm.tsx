/**
 * 新建 / 编辑一条调价规则（docs/design/pages/tenant-prices.md 5.3–5.6、5.8）。
 * 五张卡片：名称 → 什么时候 → 对哪些 → 怎么调 → 这条规则的意思（读回来的话和试算）。
 * 表单怎么读、读回来的话在 lib/adjust-form.ts；每一步怎么算、取整、调完是不是不大于 0、是不是调得很多，都问 @nozomi/domain。
 */
import { type ExactAmount, PRICE_LIMITS, type PriceRule, addDays, adjustRuleCoversPrice, adjustRuleIsUnusual, adjustRuleNonPositivePrices, applyAdjustRules, applyAdjustSteps, basePrice, compareExact, exactFromMinor, weekdayOf } from "@nozomi/domain";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ApiError } from "../../../api/client.ts";
import { type AdjustRuleBody, type AdjustRuleInput, type Holidays, createAdjustRule, getHolidays, updateAdjustRule } from "../../../api/prices.ts";
import { usePortalSession } from "../../../auth/PortalSession.tsx";
import { Alert } from "../../../components/Alert.tsx";
import { Button, IconButton, LinkButton } from "../../../components/Button.tsx";
import { Dialog } from "../../../components/Dialog.tsx";
import { FieldErrors } from "../../../components/FormFields.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { Skeleton, StateBlock } from "../../../components/States.tsx";
import { StatusBadge } from "../../../components/StatusBadge.tsx";
import { useToast } from "../../../components/Toast.tsx";
import {
  type AdjustForm,
  type AdjustProblem,
  type CycleType,
  type StepForm,
  WEEKDAY_NAMES,
  cycleText,
  emptyAdjustForm,
  exactMoneyText,
  formFromAdjustRule,
  isWholeMinor,
  reachWarning,
  readAdjustForm,
  slotReadback,
  slotText,
  stepText,
  travelText,
  tripDirectionsText,
} from "../../../lib/adjust-form.ts";
import { countryName, displayName, shortName } from "../../../lib/master-display.ts";
import { type PriceContext, activePriceRules, directionName, isStationPlace } from "../../../lib/price-form.ts";
import { moneyText, readAmount, tidyAmountDisplay } from "../../../lib/product-display.ts";
import { PRODUCT_FORBIDDEN_TEXT, saveFailureText, serverIssues } from "../../../lib/product-failure.ts";
import { pricePath } from "../../../lib/product-paths.ts";
import { tidyDate, tidyTime } from "../../../lib/time-input.ts";
import { useLeaveGuard } from "../../../lib/use-leave-guard.ts";
import { useLoad } from "../../../lib/use-load.ts";
import { focusAnchor } from "../frame.ts";
import { TOO_LARGE_TEXT, nonPositiveCount, resultTooLarge } from "./AdjustRulesTab.tsx";
import type { CalendarHandoff } from "./CalendarTab.tsx";
import type { PricesShared } from "./PricesStep.tsx";

const CYCLES: readonly { value: CycleType; label: string; hint: string }[] = [
  { value: "daily", label: "每天", hint: "出行日期里的每一天。" },
  { value: "weekly", label: "每周的某几天", hint: "出行日期里的每个周几。" },
  { value: "dates", label: "指定日期", hint: "一天一天挑，不连续也行。" },
  { value: "holidays", label: "节假日", hint: "平台登记的节假日，出行日期里遇到就算。" },
];

/** 后端 400 里的路径 → 页面上的元素。 */
function serverTarget(path: string): string {
  const step = /^\/steps\/(\d+)/.exec(path);
  if (step) return `adjust-step-${step[1]}-value`;
  if (path.startsWith("/name")) return "adjust-name";
  if (path.startsWith("/travel_from")) return "adjust-from";
  if (path.startsWith("/travel_to")) return "adjust-to";
  if (path.startsWith("/cycle/weekdays")) return "adjust-weekdays";
  if (path.startsWith("/cycle/dates")) return "adjust-date-add";
  if (path.startsWith("/cycle/countries")) return "adjust-countries";
  if (path.startsWith("/time_slot/start")) return "adjust-slot-start";
  if (path.startsWith("/time_slot")) return "adjust-slot-end";
  if (path.startsWith("/area_ids")) return "adjust-areas";
  if (path.startsWith("/vehicle_group_ids")) return "adjust-groups";
  if (path.startsWith("/package_hours")) return "adjust-packages";
  return "";
}

interface Trial {
  key: string;
  label: string;
  base: ExactAmount;
}

export function AdjustRuleForm({ shared, ruleId }: { shared: PricesShared; ruleId: string | null }) {
  const { frame, product, prices, adjusts } = shared;
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const readOnly = frame.readOnly;
  const currency = prices.currency;
  const station = isStationPlace(product.poi?.type);
  const published = product.status === "published";
  const listPath = pricePath(product.id, "adjust");
  const context: PriceContext = { category: product.category, currency, today: prices.today, station };
  const copyId = typeof (location.state as { copyRule?: unknown } | null)?.copyRule === "string" ? (location.state as { copyRule: string }).copyRule : null;
  const source = adjusts?.items.find((rule) => rule.id === (ruleId ?? copyId)) ?? null;
  // 从价格日历选了一段日期过来的：预先填好日期和适用范围，保存或取消后回日历
  const passed = (location.state as { calendar?: CalendarHandoff } | null)?.calendar;
  const handoff = ruleId === null && passed && typeof passed.from === "string" && typeof passed.to === "string" && typeof passed.back === "string" ? passed : null;
  const returnPath = handoff?.back ?? listPath;
  const [handoffNote, setHandoffNote] = useState(handoff !== null);

  const [form, setForm] = useState<AdjustForm | null>(null);
  const [initial, setInitial] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [serverProblems, setServerProblems] = useState<AdjustProblem[]>([]);
  const [notice, setNotice] = useState<{ kind: "danger" | "warning"; title?: string; text: string } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [gone, setGone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [unusual, setUnusual] = useState<{ label: string; from: string; to: string; change: string } | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [dateText, setDateText] = useState("");
  const [dateNote, setDateNote] = useState("");
  const [trialKey, setTrialKey] = useState("");
  const [customBase, setCustomBase] = useState("");
  const [shown, setShown] = useState<AdjustForm | null>(null);
  const sent = useRef<{ payload: string; key: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  // 取到规则列表后填一次表单（新建：空表单或照抄的那一条）
  const ready = adjusts !== null;
  useEffect(() => {
    if (!ready || form !== null) return;
    let start: AdjustForm;
    if (ruleId !== null) {
      if (source === null) return;
      start = formFromAdjustRule(source, currency);
    } else if (source !== null) start = { ...formFromAdjustRule(source, currency), name: `${source.name}（复制）`.slice(0, PRICE_LIMITS.maxAdjustNameLength), enabled: false };
    else if (handoff !== null) {
      start = { ...emptyAdjustForm(prices.today), from: handoff.from, to: handoff.to, areaMode: "some", areaIds: [handoff.areaId], groupMode: "some", groupIds: [handoff.vehicleGroupId], direction: handoff.direction ?? "both", packageMode: handoff.packageHours === null ? "all" : "some", packages: handoff.packageHours === null ? [] : [handoff.packageHours] };
    } else start = emptyAdjustForm(prices.today);
    setForm(start);
    setShown(start);
    setInitial(ruleId === null && handoff === null ? JSON.stringify(emptyAdjustForm(prices.today)) : JSON.stringify(start));
    requestAnimationFrame(() => heading.current?.focus());
  }, [ready, form, ruleId, source, currency, prices.today, handoff]);

  // 「这条规则的意思」在输入停下 500ms 后更新
  useEffect(() => {
    if (form === null) return;
    const timer = setTimeout(() => setShown(form), 500);
    return () => clearTimeout(timer);
  }, [form]);

  const holidayFrom = (form && form.cycle !== "dates" ? tidyDate(form.from) : null) ?? prices.today;
  const holidayStart = holidayFrom < prices.today ? prices.today : holidayFrom;
  const holidayTo = (form && form.to.trim() !== "" ? tidyDate(form.to) : null) ?? addDays(holidayStart, 365);
  const holidays = useLoad<Holidays>(`holidays:${holidayStart}:${holidayTo}`, form?.cycle === "holidays" || form === null ? (session) => getHolidays(session, { from: holidayStart, to: holidayTo >= holidayStart ? holidayTo : holidayStart }) : null);

  const dirty = form !== null && JSON.stringify(form) !== initial;
  useLeaveGuard(dirty && !saving && !readOnly, setLeaving);

  const active = useMemo(() => activePriceRules(prices.items, context), [prices.items, prices.today, currency]);
  const areaIds = product.areas.map((area) => area.area_id);
  const groupIds = product.vehicle_groups.map((group) => group.vehicle_group_id);
  const packages = useMemo(() => [...new Set(prices.items.flatMap((item) => (item.package_hours === null ? [] : [item.package_hours])))].sort((x, y) => x - y), [prices.items]);

  const back = (
    <Link className="link adjust-form__back" to={returnPath}>
      {handoff !== null ? "‹ 回到价格日历" : "‹ 回到调价规则"}
    </Link>
  );

  if (readOnly && ruleId === null) {
    return (
      <section className="card">
        <StateBlock tone="neutral" title="你没有权限查看这里" description="新建调价规则需要修改商品的权限。需要的话，请联系你们的管理员开通。" action={<LinkButton to={listPath}>回到调价规则</LinkButton>} />
      </section>
    );
  }
  if (!ready) {
    return (
      <section className="card">
        <Skeleton lines={["long", "control", "control", "control"]} />
      </section>
    );
  }
  if (ruleId !== null && source === null && form === null) {
    return (
      <section className="card">
        <StateBlock title="找不到这条调价规则" description="它可能已被别人删除。" action={<LinkButton to={listPath}>回到调价规则</LinkButton>} />
      </section>
    );
  }
  if (form === null || shown === null) return null;

  const areaName = (id: string): string => {
    const area = product.areas.find((entry) => entry.area_id === id);
    return area ? displayName(area.name).text : "一个旧的区域";
  };
  const groupName = (id: string): string => {
    const group = product.vehicle_groups.find((entry) => entry.vehicle_group_id === id);
    return group ? displayName(group.name).text : "一个旧的车型组";
  };
  const staleAreas = form.areaIds.filter((id) => !areaIds.includes(id));
  const staleGroups = form.groupIds.filter((id) => !groupIds.includes(id));
  /** 提交的是去掉了「已不在这个商品里」的那一份 */
  const effective = (value: AdjustForm): AdjustForm => ({ ...value, areaIds: value.areaIds.filter((id) => areaIds.includes(id)), groupIds: value.groupIds.filter((id) => groupIds.includes(id)) });
  const reading = readAdjustForm(effective(form), context);
  const problems = attempted ? reading.problems : [];
  const allProblems = [...problems, ...serverProblems];
  const errors = (...targets: string[]): string[] => allProblems.filter((problem) => targets.includes(problem.target)).map((problem) => problem.text.replace(/^[^：]*：/, ""));
  const bad = (...targets: string[]): true | undefined => (errors(...targets).length > 0 ? true : undefined);
  const change = (changes: Partial<AdjustForm>): void => {
    setForm({ ...form, ...changes });
    setServerProblems([]);
  };
  const locked = saving || readOnly;

  // ───── 试算 ─────
  const scope = { areaIds: form.areaMode === "some" ? form.areaIds : [], vehicleGroupIds: form.groupMode === "some" ? form.groupIds : [], directions: product.category === "airport_transfer" && form.direction !== "both" ? [form.direction] : [], packageHours: product.category === "charter" && form.packageMode === "some" ? form.packages : [] };
  const covered = active.filter((entry) => adjustRuleCoversPrice(scope, entry.rule));
  const priceLabel = (rule: PriceRule): string => {
    const extra = rule.direction !== null ? directionName(rule.direction, station) : rule.packageHours !== null ? `${rule.packageHours} 小时` : null;
    return [shortName(areaName(rule.areaId)), shortName(groupName(rule.vehicleGroupId)), extra].filter((part) => part !== null).join(" · ");
  };
  const trials: Trial[] = covered.slice(0, 20).map((entry) => ({ key: entry.body.id, label: priceLabel(entry.rule), base: basePrice(entry.rule.pricing, {}, entry.rule.packageHours) }));
  const chosen = trialKey === "custom" ? null : (trials.find((trial) => trial.key === trialKey) ?? trials[0] ?? null);
  const custom = readAmount(customBase, currency);
  const customAmount = chosen === null && customBase.trim() !== "" && custom.ok && custom.minor > 0 ? exactFromMinor(custom.minor) : null;
  const trialBase = chosen?.base ?? customAmount;

  const shownReading = readAdjustForm(effective(shown), context);
  const stepsReady = shownReading.steps.length === shown.steps.length && shown.steps.length > 0;
  const result = trialBase !== null && stepsReady ? applyAdjustRules(trialBase, [{ steps: shownReading.steps }], prices.rounding_unit) : null;
  const warning = shownReading.rule && shownReading.rule.status === "enabled" ? reachWarning(shownReading.rule, active.map((entry) => entry.rule)) : null;

  // ───── 节假日 ─────
  const holidayData = holidays.state.data;
  const knownCountries = holidayData?.countries.map((entry) => entry.country_code) ?? [];
  const homeCountry = product.city?.country_code ?? null;
  const countryOptions = [...new Set([...knownCountries, ...form.countries])];
  const matchedHolidays = (holidayData?.items ?? []).filter((item) => form.countries.includes(item.country_code) && item.date >= holidayStart && item.date <= holidayTo).sort((x, y) => x.date.localeCompare(y.date));
  const countryLabel = (code: string): string => countryName(code) ?? code;
  const weekdayName = (date: string): string => WEEKDAY_NAMES[weekdayOf(date) - 1] ?? "";

  const chooseCycle = (cycle: CycleType): void => {
    if (cycle === "holidays" && form.countries.length === 0 && homeCountry !== null && knownCountries.includes(homeCountry)) return change({ cycle, countries: [homeCountry] });
    change({ cycle });
  };

  const addDate = (): void => {
    const date = tidyDate(dateText);
    if (dateText.trim() === "") return;
    if (date === null) return setDateNote("这不是一个日期，请按 2026-10-08 的格式填写");
    if (form.dates.includes(date)) return setDateNote(`${date} 已经在里面了`);
    if (form.dates.length >= PRICE_LIMITS.maxAdjustDates) return setDateNote(`最多 ${PRICE_LIMITS.maxAdjustDates} 个日期`);
    change({ dates: [...form.dates, date].sort() });
    setDateText("");
    setDateNote("");
  };

  const changeStep = (index: number, changes: Partial<StepForm>): void => change({ steps: form.steps.map((step, at) => (at === index ? { ...step, ...changes } : step)) });
  const moveStep = (index: number, delta: -1 | 1): void => {
    const steps = [...form.steps];
    const to = index + delta;
    if (to < 0 || to >= steps.length) return;
    steps.splice(to, 0, ...steps.splice(index, 1));
    change({ steps });
    requestAnimationFrame(() => focusAnchor(`adjust-step-${to}-value`));
  };

  // ───── 保存 ─────
  const send = async (input: AdjustRuleInput): Promise<void> => {
    setSaving(true);
    setNotice(null);
    try {
      let saved: { version: number; adjust_rule: AdjustRuleBody };
      if (ruleId === null) {
        const payload = JSON.stringify(input);
        if (sent.current?.payload !== payload) sent.current = { payload, key: crypto.randomUUID() };
        saved = await createAdjustRule(token, product.id, frame.version, input, sent.current.key);
      } else saved = await updateAdjustRule(token, product.id, ruleId, frame.version, input);
      if (adjusts !== null) shared.setAdjusts({ ...adjusts, version: saved.version, items: ruleId === null ? [...adjusts.items, saved.adjust_rule] : adjusts.items.map((rule) => (rule.id === ruleId ? saved.adjust_rule : rule)) });
      frame.saved(saved.version);
      toast(ruleId === null ? `已新建调价规则「${input.name}」` : `已保存「${input.name}」`);
      setUnusual(null);
      void navigate(returnPath, { state: handoff !== null ? { selected: { from: handoff.from, to: handoff.to } } : { savedRule: saved.adjust_rule.id } });
    } catch (err) {
      setUnusual(null);
      if (handleAuthFailure(err)) return;
      const count = nonPositiveCount(err);
      if (count !== null) setNotice({ kind: "danger", title: "不能保存。", text: `按适用范围内的${count > 0 ? ` ${count} 条` : ""}价格算，调完不大于 0。请把下调改小、缩小适用范围，或先不勾「启用」。` });
      else if (resultTooLarge(err)) setNotice({ kind: "danger", title: "不能保存。", text: TOO_LARGE_TEXT });
      else if (!(err instanceof ApiError)) setNotice({ kind: "danger", text: saveFailureText(err, "保存", true) });
      else if (err.code === "VALIDATION_FAILED") {
        const placed = serverIssues(err).flatMap((issue) => {
          const target = serverTarget(issue.path);
          return target === "" ? [] : [{ target, text: issue.reason === "AREA_NOT_IN_PRODUCT" ? "区域：有的区域已经不在这个商品里，请重新选" : issue.reason === "VEHICLE_GROUP_NOT_IN_PRODUCT" ? "车型组：有的车型组已经不在这个商品里，请重新选" : issue.message }];
        });
        if (placed.length > 0) {
          setServerProblems(placed);
          const first = placed[0];
          if (first) requestAnimationFrame(() => focusAnchor(first.target));
        } else setNotice({ kind: "danger", text: "提交的内容不符合要求，请检查后重试。" });
      } else if (err.code === "VERSION_CONFLICT") setConflict(true);
      else if (err.code === "CONCURRENT_UPDATE") setNotice({ kind: "warning", text: "同时有其他人在修改相关的数据，这次没有保存成功。请再点一次保存。" });
      else if (err.code === "PUBLISH_CHECK_FAILED") setNotice({ kind: "danger", title: "没有保存。", text: "这个商品已上架，改成这样就不满足上架的条件了。" });
      else if (err.status === 403) setNotice({ kind: "danger", text: PRODUCT_FORBIDDEN_TEXT });
      else if (err.status === 404) setGone(true);
      else setNotice({ kind: "danger", text: saveFailureText(err, "保存", true) });
    } finally {
      setSaving(false);
    }
  };

  const save = (): void => {
    if (saving || conflict || gone) return;
    setAttempted(true);
    setNotice(null);
    setServerProblems([]);
    const first = reading.problems[0];
    if (first || reading.input === null || reading.rule === null) {
      if (first) requestAnimationFrame(() => focusAnchor(first.target));
      return;
    }
    const rule = reading.rule;
    const activeRules = active.map((entry) => entry.rule);
    if (rule.status === "enabled") {
      const nonPositive = adjustRuleNonPositivePrices(rule, activeRules);
      const worst = nonPositive[0] === undefined ? undefined : active[nonPositive[0]];
      if (worst) {
        return setNotice({
          kind: "danger",
          title: "不能保存。",
          text: `按「${priceLabel(worst.rule)}」的价格 ${exactMoneyText(basePrice(worst.rule.pricing, {}, worst.rule.packageHours), currency)} 算，调完不大于 0${nonPositive.length > 1 ? `；另有 ${nonPositive.length - 1} 条价格也是这样` : ""}。请把下调改小、缩小适用范围，或先不勾「启用」。`,
        });
      }
    }
    const candidates: { label: string; base: ExactAmount }[] = [...active.filter((entry) => adjustRuleCoversPrice(rule, entry.rule)).map((entry) => ({ label: `「${priceLabel(entry.rule)}」的价格`, base: basePrice(entry.rule.pricing, {}, entry.rule.packageHours) })), ...(customAmount !== null ? [{ label: "试算里填的那个数", base: customAmount }] : [])];
    const odd = candidates.find((candidate) => adjustRuleIsUnusual(rule, [candidate.base]));
    if (odd) {
      const after = applyAdjustSteps(odd.base, rule.steps).result;
      const up = compareExact(after, odd.base) > 0;
      const diff = applyAdjustRules(odd.base, [{ steps: rule.steps }], 1);
      const delta = diff.adjustMinor;
      return setUnusual({ label: odd.label, from: exactMoneyText(odd.base, currency), to: exactMoneyText(after, currency), change: delta === null ? "" : `${up ? "上调" : "下调"}了约 ${moneyText(Math.abs(delta), currency)}` });
    }
    void send(reading.input);
  };

  const cancel = (): void => {
    if (dirty) setLeaving(returnPath);
    else void navigate(returnPath, handoff !== null ? { state: { selected: { from: handoff.from, to: handoff.to } } } : {});
  };

  // ───── 读回来的话 ─────
  const gap = (what: string): ReactNode => <span className="adjust-meaning__gap">{`（还没有填${what}）`}</span>;
  const sentence = (): ReactNode => {
    const value = effective(shown);
    const fromDate = value.from.trim() === "" ? null : tidyDate(value.from);
    const toDate = value.to.trim() === "" ? null : tidyDate(value.to);
    const when: ReactNode[] = [];
    if (value.cycle === "dates") when.push(value.dates.length > 0 ? cycleText({ type: "dates", dates: value.dates }) : gap("日期"));
    else {
      when.push(travelText(fromDate, toDate), "，");
      if (value.cycle === "weekly") when.push(value.weekdays.length > 0 ? cycleText({ type: "weekly", weekdays: value.weekdays }) : gap("周几"));
      else if (value.cycle === "holidays") when.push(value.countries.length > 0 ? cycleText({ type: "holidays", countries: value.countries }) : gap("哪国的节假日"));
      else when.push("每天");
    }
    const start = tidyTime(value.slotStart);
    const end = value.slotEnd.trim() === "24:00" ? "24:00" : tidyTime(value.slotEnd);
    const slot = value.slotMode === "all" ? "全天" : start !== null && end !== null ? slotText({ start, end }) : gap("时段");
    const whom: ReactNode[] = [value.areaMode === "all" ? "全部区域" : value.areaIds.length > 0 ? value.areaIds.map(areaName).join("、") : gap("区域"), "、", value.groupMode === "all" ? "全部车型组" : value.groupIds.length > 0 ? value.groupIds.map(groupName).join("、") : gap("车型组")];
    if (product.category === "airport_transfer") whom.push("、", tripDirectionsText(value.direction === "both" ? [] : [value.direction], station));
    if (product.category === "charter") whom.push("、", value.packageMode === "all" ? "全部套餐" : value.packages.length > 0 ? value.packages.map((hours) => `${hours} 小时`).join("、") : gap("套餐"));
    return (
      <>
        {when.map((part, index) => (
          <span key={`w${index}`}>{part}</span>
        ))}
        、{slot}；
        {whom.map((part, index) => (
          <span key={`s${index}`}>{part}</span>
        ))}
        ：在基础价上
        {stepsReady
          ? shownReading.steps.map((step, index) => (
              <span key={index}>
                {index > 0 && "，再"}
                <strong>{stepText(step, currency)}</strong>
              </span>
            ))
          : gap("怎么调")}
        。
      </>
    );
  };

  const slotStart = tidyTime(form.slotStart);
  const slotEnd = form.slotEnd.trim() === "24:00" ? "24:00" : tidyTime(form.slotEnd);
  const cycleForReadback = form.cycle === "weekly" ? { type: "weekly" as const, weekdays: form.weekdays } : form.cycle === "dates" ? { type: "dates" as const, dates: form.dates } : form.cycle === "holidays" ? { type: "holidays" as const, countries: form.countries } : { type: "daily" as const };
  const slotLine = form.slotMode === "slot" && slotStart !== null && slotEnd !== null ? slotReadback(cycleForReadback, { start: slotStart, end: slotEnd }) : null;
  const cityName = product.city ? displayName(product.city.name).text : "";

  const input = (id: string, value: string, onChange: (value: string) => void, extra: { label: string; placeholder?: string; tidy?: (value: string) => string | null; mode?: "numeric" | "decimal" | "text"; mono?: boolean; describedBy?: string; maxLength?: number }) => (
    <input
      className={extra.mono === false ? "input" : "input input--mono"}
      id={id}
      type="text"
      inputMode={extra.mode ?? "numeric"}
      autoComplete="off"
      aria-label={extra.label}
      aria-invalid={bad(id)}
      aria-describedby={extra.describedBy}
      placeholder={extra.placeholder}
      maxLength={extra.maxLength}
      readOnly={saving}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={() => {
        const tidy = extra.tidy?.(value) ?? null;
        if (tidy !== null && tidy !== value) onChange(tidy);
      }}
    />
  );
  const modeRadios = <T extends string>(name: string, legend: string, value: T, options: readonly { value: T; label: string; hint?: string }[], onChange: (value: T) => void, stacked = false) => (
    <div className={stacked ? "choices choices--stacked" : "choices"} role="radiogroup" aria-label={legend}>
      {options.map((option) => (
        <label key={option.value} className="choice">
          <input type="radio" name={name} value={option.value} checked={option.value === value} disabled={saving || (option.value === "holidays" && holidayData !== null && countryOptions.length === 0)} onChange={() => onChange(option.value)} />
          <span className="choice__text">
            {option.label}
            {option.hint && <span className="choice__hint">{option.value === "holidays" && holidayData !== null && countryOptions.length === 0 ? "平台还没有登记节假日，暂时不能选。可以先用「指定日期」。" : option.hint}</span>}
          </span>
        </label>
      ))}
    </div>
  );
  const checks = (id: string, legend: string, options: readonly { value: string; label: string; stale?: boolean; badge?: string }[], value: readonly string[], onChange: (value: string[]) => void) => (
    <div className="choices adjust-form__checks" id={id} role="group" aria-label={legend}>
      {options.map((option) => (
        <label key={option.value} className="choice">
          <input type="checkbox" checked={value.includes(option.value)} disabled={saving} onChange={(event) => onChange(event.target.checked ? [...value, option.value] : value.filter((entry) => entry !== option.value))} />
          <span className="choice__text">
            {option.label}
            {option.badge && <StatusBadge tone="neutral" label={option.badge} />}
          </span>
        </label>
      ))}
    </div>
  );
  const warn = (text: string): ReactNode => (
    <p className="adjust-warning">
      <Icon name="alert-triangle" />
      {text}
    </p>
  );

  const title = ruleId === null ? "新建调价规则" : (source?.name ?? form.name);

  // ───── 最后一张卡片：两种角色都有 ─────
  const meaning = (
    <section className="card" aria-labelledby="adjust-meaning-title">
      <h4 className="card__title" id="adjust-meaning-title">
        这条规则的意思
      </h4>
      <div aria-live="polite" className="adjust-meaning">
        <p className="adjust-meaning__sentence">{sentence()}</p>
        <div className="adjust-trial__pick">
          <label className="field__label" htmlFor="adjust-trial-price">
            用哪个价来算
          </label>
          <select className="input select" id="adjust-trial-price" value={chosen?.key ?? "custom"} onChange={(event) => setTrialKey(event.target.value)}>
            {trials.map((trial) => {
              const entry = covered.find((candidate) => candidate.body.id === trial.key);
              return (
                <option key={trial.key} value={trial.key}>
                  {`${trial.label}　${exactMoneyText(trial.base, currency)}${entry?.rule.pricing.model === "mileage_time" ? "（不超出起步时）" : ""}`}
                </option>
              );
            })}
            <option value="custom">自己填一个数</option>
          </select>
          {chosen === null && (
            <span className="affix">
              <input className="input input--mono" id="adjust-trial-base" type="text" inputMode="decimal" autoComplete="off" aria-label="用来试算的基础价" aria-invalid={customBase.trim() !== "" && customAmount === null ? true : undefined} value={customBase} onChange={(event) => setCustomBase(event.target.value)} />
              <span className="affix__text">{currency}</span>
            </span>
          )}
        </div>
        {trialBase === null ? (
          <p className="adjust-trial__empty">填一个基础价，这里会一步一步算给你看。</p>
        ) : result === null ? (
          <p className="adjust-trial__empty">把「怎么调」的每一步填好，这里会一步一步算给你看。</p>
        ) : (
          <>
            <div className="adjust-trial__scroll" tabIndex={0} role="region" aria-label="试算">
              <table className="table adjust-trial">
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="visually-hidden">步骤</span>
                    </th>
                    <th scope="col" className="adjust-trial__amount">
                      变化
                    </th>
                    <th scope="col" className="adjust-trial__amount">
                      算完是
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">基础价</th>
                    <td />
                    <td className="adjust-trial__amount">{exactMoneyText(result.base, currency)}</td>
                  </tr>
                  {result.adjusts[0]?.steps.map((step, index) => (
                    <tr key={index}>
                      <th scope="row">{`第 ${index + 1} 步　${stepText(step.step, currency)}`}</th>
                      <td className="adjust-trial__amount">{exactMoneyText(step.delta, currency, true).replace(`${currency} `, "")}</td>
                      <td className="adjust-trial__amount">
                        {exactMoneyText(step.after, currency)}
                        {!isWholeMinor(step.after) && <span className="adjust-trial__note">（还没取整）</span>}
                      </td>
                    </tr>
                  ))}
                  <tr className={result.finalMinor === null ? "adjust-trial__final adjust-trial__final--bad" : "adjust-trial__final"}>
                    <th scope="row">{prices.rounding_unit > 1 ? `四舍五入、取整到 ${moneyText(prices.rounding_unit, currency)}` : "四舍五入"}</th>
                    <td />
                    <td className="adjust-trial__amount">
                      {result.finalMinor === null ? (
                        <>
                          <Icon name="alert-circle" />
                          不大于 0
                        </>
                      ) : (
                        moneyText(result.finalMinor, currency)
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            {result.finalMinor === null ? (
              <p className="adjust-trial__bad">按这个价算下来不大于 0，这样的规则保存不了。请把下调改小。</p>
            ) : (
              <p className="adjust-trial__summary">
                {`这条规则单独生效时：${exactMoneyText(result.base, currency)} → ${moneyText(result.finalMinor, currency)}，${result.adjustMinor === 0 ? "和基础价一样" : `比基础价${(result.adjustMinor ?? 0) > 0 ? "高" : "低"} ${moneyText(Math.abs(result.adjustMinor ?? 0), currency)}`}。`}
                <br />
                同一天还命中别的调价规则的话，会接着往下算，最后才取整。
              </p>
            )}
          </>
        )}
        {warning !== null && warn(warning)}
      </div>
    </section>
  );

  if (readOnly) {
    const value = effective(form);
    return (
      <div className="adjust-form">
        <div className="adjust-form__head">
          {back}
          <h3 className="adjust-form__title" ref={heading} tabIndex={-1}>
            {title}
          </h3>
        </div>
        <section className="card">
          <dl className="details">
            <dt>名称</dt>
            <dd>{form.name}</dd>
            <dt>启用</dt>
            <dd>{form.enabled ? "已启用" : "已停用"}</dd>
            <dt>出行日期</dt>
            <dd>{reading.rule ? (reading.rule.cycle.type === "dates" ? cycleText(reading.rule.cycle) : travelText(reading.rule.travelFrom, reading.rule.travelTo)) : "—"}</dd>
            <dt>周期</dt>
            <dd>{reading.rule ? cycleText(reading.rule.cycle) : "—"}</dd>
            <dt>时段</dt>
            <dd>{reading.rule ? slotText(reading.rule.timeSlot) : "—"}</dd>
            <dt>区域</dt>
            <dd>{value.areaMode === "all" ? "全部区域" : value.areaIds.map(areaName).join("、")}</dd>
            <dt>车型组</dt>
            <dd>{value.groupMode === "all" ? "全部车型组" : value.groupIds.map(groupName).join("、")}</dd>
            {product.category === "airport_transfer" && (
              <>
                <dt>方向</dt>
                <dd>{tripDirectionsText(value.direction === "both" ? [] : [value.direction], station)}</dd>
              </>
            )}
            {product.category === "charter" && (
              <>
                <dt>套餐</dt>
                <dd>{value.packageMode === "all" ? "全部套餐" : value.packages.map((hours) => `${hours} 小时`).join("、")}</dd>
              </>
            )}
            <dt>怎么调</dt>
            <dd>
              {reading.steps.map((step, index) => (
                <span key={index} className="adjust-table__line">{`第 ${index + 1} 步：${stepText(step, currency)}`}</span>
              ))}
            </dd>
          </dl>
        </section>
        {meaning}
        <div>
          <LinkButton to={listPath}>回到调价规则</LinkButton>
        </div>
      </div>
    );
  }

  return (
    <form
      className="adjust-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className="adjust-form__head">
        {back}
        <h3 className="adjust-form__title" ref={heading} tabIndex={-1}>
          {title}
        </h3>
      </div>
      <div role="alert" className="step__alerts">
        {allProblems.length > 0 && (
          <Alert kind="danger">
            <strong className="alert__title">{`有 ${allProblems.length} 处需要修改`}</strong>
            <span className="error-summary__list">
              {allProblems.map((problem, index) => (
                <button key={index} type="button" className="link error-summary__item" onClick={() => focusAnchor(problem.target)}>
                  {problem.text}
                </button>
              ))}
            </span>
          </Alert>
        )}
        {gone && (
          <Alert kind="danger">
            <span>找不到这条调价规则，它可能已被别人删除。</span>
            <span className="alert__actions">
              <Link className="link" to={listPath}>
                回到调价规则
              </Link>
            </span>
          </Alert>
        )}
        {conflict && (
          <Alert kind="warning">
            <strong className="alert__title">这个商品刚被别人修改过，你的修改还没有保存。</strong>
            <span>点下面的按钮载入最新的内容，你在这里填的会留着。</span>
            <span className="alert__actions">
              <Button
                size="sm"
                onClick={() => {
                  frame.refresh();
                  shared.reloadPrices();
                  shared.reloadAdjusts();
                  setConflict(false);
                  heading.current?.focus();
                }}
              >
                载入最新内容，保留我的修改
              </Button>
            </span>
          </Alert>
        )}
        {notice && (
          <Alert kind={notice.kind}>
            {notice.title && <strong className="alert__title">{notice.title}</strong>}
            <span>{notice.text}</span>
          </Alert>
        )}
      </div>

      {handoff !== null && handoffNote && (
        <div className="adjust-form__handoff" role="status">
          <Alert kind="info">
            <span>{`已按你在日历上选的填好了日期和适用范围（${[areaName(handoff.areaId), groupName(handoff.vehicleGroupId), handoff.direction !== null ? tripDirectionsText([handoff.direction], station).replace(/^只/, "") : handoff.packageHours !== null ? `${handoff.packageHours} 小时` : null].filter((part) => part !== null).join(" · ")}）。想对全部区域或车型组都调，把下面的「对哪些」改成「全部」。`}</span>
            <span className="alert__actions">
              <Button variant="text" size="sm" onClick={() => setHandoffNote(false)}>
                知道了
              </Button>
            </span>
          </Alert>
        </div>
      )}

      <section className="card" aria-labelledby="adjust-name-title">
        <h4 className="card__title" id="adjust-name-title">
          名称
        </h4>
        <div className="form">
          <div className="field">
            <label className="field__label" htmlFor="adjust-name">
              名称
              <span className="field__required" aria-hidden="true">
                {" *"}
              </span>
            </label>
            {input("adjust-name", form.name, (name) => change({ name }), { label: "名称", mode: "text", mono: false, maxLength: PRICE_LIMITS.maxAdjustNameLength, describedBy: "adjust-name-hint" })}
            <FieldErrors id="adjust-name-error" errors={errors("adjust-name")} />
            <p className="field__hint" id="adjust-name-hint">
              给自己人看的名字，会显示在价格日历上。例如「国庆旺季」「周末夜间」。
            </p>
          </div>
          <div className="field">
            <label className="choice">
              <input type="checkbox" id="adjust-enabled" checked={form.enabled} disabled={saving} onChange={(event) => change({ enabled: event.target.checked })} />
              <span className="choice__text">
                {ruleId === null ? "保存后启用" : "启用这条规则"}
                <span className="choice__hint">不勾 = 先存着，不参与报价。</span>
              </span>
            </label>
          </div>
        </div>
      </section>

      <section className="card" aria-labelledby="adjust-when-title">
        <h4 className="card__title" id="adjust-when-title">
          什么时候
        </h4>
        <p className="step__intro">{`下面三项同时满足的用车时间，才会被这条规则调价。都按${cityName}当地时间。`}</p>
        <div className="form">
          {form.cycle !== "dates" && (
            <fieldset className="field fieldset">
              <legend className="field__label">出行日期</legend>
              <div className="range">
                <label className="range__cell">
                  <span className="range__label">从</span>
                  {input("adjust-from", form.from, (from) => change({ from }), { label: "出行日期从", placeholder: "不限", tidy: tidyDate })}
                </label>
                <label className="range__cell">
                  <span className="range__label">到</span>
                  {input("adjust-to", form.to, (to) => change({ to }), { label: "出行日期到", placeholder: "一直有效", tidy: tidyDate })}
                </label>
              </div>
              <FieldErrors id="adjust-travel-error" errors={errors("adjust-from", "adjust-to")} />
              <p className="field__hint">看的是用车日期，两头都算在内。「从」留空 = 不限开始；「到」留空 = 一直有效。</p>
            </fieldset>
          )}
          <fieldset className="field fieldset">
            <legend className="field__label">
              周期
              <span className="field__required" aria-hidden="true">
                {" *"}
              </span>
            </legend>
            {modeRadios("adjust-cycle", "周期", form.cycle, CYCLES, chooseCycle, true)}
            {form.cycle === "weekly" && (
              <div className="adjust-form__sub">
                <div className="weekdays" id="adjust-weekdays" role="group" aria-label="每周的哪几天">
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
                <FieldErrors id="adjust-weekdays-error" errors={errors("adjust-weekdays")} />
              </div>
            )}
            {form.cycle === "dates" && (
              <div className="adjust-form__sub">
                <div className="adjust-form__date-add">
                  <input
                    className="input input--mono"
                    id="adjust-date-add"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    aria-label="要添加的日期"
                    aria-invalid={bad("adjust-date-add")}
                    aria-describedby="adjust-date-note"
                    placeholder="2027-01-01"
                    readOnly={saving}
                    value={dateText}
                    onChange={(event) => {
                      setDateText(event.target.value);
                      setDateNote("");
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      addDate();
                    }}
                  />
                  <Button disabled={saving || form.dates.length >= PRICE_LIMITS.maxAdjustDates} onClick={addDate}>
                    添加
                  </Button>
                </div>
                <p className="field__hint" id="adjust-date-note" role="status">
                  {dateNote}
                </p>
                <FieldErrors id="adjust-dates-error" errors={errors("adjust-date-add")} />
                {form.dates.length > 0 && (
                  <ul className="adjust-form__dates" aria-label="已选的日期">
                    {form.dates.map((date) => (
                      <li key={date} className="tag price-packages__tag">
                        {`${date} ${weekdayName(date)}`}
                        <button type="button" className="price-packages__remove" aria-label={`去掉 ${date}`} disabled={saving} onClick={() => change({ dates: form.dates.filter((entry) => entry !== date) })}>
                          <Icon name="x" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {form.cycle === "holidays" && (
              <div className="adjust-form__sub">
                {holidayData === null ? (
                  holidays.state.status === "error" ? (
                    <p className="adjust-warning">
                      <Icon name="alert-triangle" />
                      节假日没有取到，请检查网络。
                      <Button variant="text" size="sm" onClick={holidays.reload}>
                        重试
                      </Button>
                    </p>
                  ) : (
                    <Skeleton lines={["medium"]} />
                  )
                ) : (
                  <>
                    {homeCountry !== null && !knownCountries.includes(homeCountry) && warn(`平台还没有登记${countryLabel(homeCountry)}的节假日，暂时不能按${countryLabel(homeCountry)}的节假日调价。可以先用「指定日期」，或联系平台运营。`)}
                    {checks(
                      "adjust-countries",
                      "哪些国家的节假日",
                      countryOptions.map((code) => ({ value: code, label: `${countryLabel(code)}的节假日`, ...(knownCountries.includes(code) ? {} : { badge: "没有数据" }) })),
                      form.countries,
                      (countries) => change({ countries: countries.slice(0, PRICE_LIMITS.maxAdjustCountries) }),
                    )}
                    <FieldErrors id="adjust-countries-error" errors={errors("adjust-countries")} />
                    {form.countries.filter((code) => !knownCountries.includes(code)).map((code) => (
                      <p key={code} className="adjust-warning">
                        <Icon name="alert-triangle" />
                        {`${countryLabel(code)}现在没有登记节假日，这一部分不会生效。`}
                      </p>
                    ))}
                    {form.countries.length > 0 &&
                      (matchedHolidays.length === 0 ? (
                        warn("出行日期里没有平台登记的假日，这条规则不会生效。")
                      ) : (
                        <p className="adjust-form__preview">
                          {`${form.to.trim() === "" ? "今后 12 个月里" : "出行日期里"}有 ${matchedHolidays.length} 个假日：${matchedHolidays
                            .slice(0, 10)
                            .map((item) => `${item.date} ${weekdayName(item.date)} ${displayName(item.name).text}`)
                            .join(" · ")}${matchedHolidays.length > 10 ? ` 等 ${matchedHolidays.length} 个` : ""}`}
                        </p>
                      ))}
                    <p className="field__hint">节假日以平台登记的为准；平台之后补登或改动，这条规则会跟着变。</p>
                  </>
                )}
              </div>
            )}
          </fieldset>
          <fieldset className="field fieldset">
            <legend className="field__label">
              时段
              <span className="field__required" aria-hidden="true">
                {" *"}
              </span>
            </legend>
            {modeRadios("adjust-slot", "时段", form.slotMode, [{ value: "all", label: "全天" }, { value: "slot", label: "指定时段" }] as const, (slotMode) => change({ slotMode }))}
            {form.slotMode === "slot" && (
              <div className="adjust-form__sub">
                <div className="range">
                  <label className="range__cell">
                    <span className="range__label">从</span>
                    {input("adjust-slot-start", form.slotStart, (slotStart) => change({ slotStart }), { label: "时段从", placeholder: "22:00", tidy: tidyTime })}
                  </label>
                  <label className="range__cell">
                    <span className="range__label">到</span>
                    {input("adjust-slot-end", form.slotEnd, (slotEnd) => change({ slotEnd }), { label: "时段到", placeholder: "06:00", tidy: (value) => (value.trim() === "24:00" ? "24:00" : tidyTime(value)) })}
                  </label>
                </div>
                <FieldErrors id="adjust-slot-error" errors={errors("adjust-slot-start", "adjust-slot-end")} />
                <p className="readback" aria-live="polite">
                  {slotLine}
                </p>
                <p className="field__hint">从开始的时间起算，到结束的时间之前为止：填 22:00 到 06:00，06:00 整用车的不算在内。（第 ② 步的服务时间是两头都算。）跨午夜的算在开始的那一天头上。</p>
              </div>
            )}
          </fieldset>
        </div>
      </section>

      <section className="card" aria-labelledby="adjust-whom-title">
        <h4 className="card__title" id="adjust-whom-title">
          对哪些
        </h4>
        <p className="step__intro">不选就是全部。以后这个商品新加的区域、车型组也算在「全部」里。</p>
        <div className="form">
          <fieldset className="field fieldset">
            <legend className="field__label">区域</legend>
            {modeRadios("adjust-area-mode", "区域", form.areaMode, [{ value: "all", label: "全部区域" }, { value: "some", label: "指定区域" }] as const, (areaMode) => change({ areaMode }))}
            {form.areaMode === "some" && (
              <div className="adjust-form__sub">
                {checks("adjust-areas", "指定区域", [...product.areas.map((area) => ({ value: area.area_id, label: displayName(area.name).text })), ...staleAreas.map((id) => ({ value: id, label: areaName(id), badge: "已不在这个商品里" }))], form.areaIds, (ids) => change({ areaIds: ids }))}
                <FieldErrors id="adjust-areas-error" errors={errors("adjust-areas")} />
                {staleAreas.length > 0 && warn(`有 ${staleAreas.length} 个已经不在这个商品里，保存时会一起去掉。`)}
              </div>
            )}
          </fieldset>
          <fieldset className="field fieldset">
            <legend className="field__label">车型组</legend>
            {modeRadios("adjust-group-mode", "车型组", form.groupMode, [{ value: "all", label: "全部车型组" }, { value: "some", label: "指定车型组" }] as const, (groupMode) => change({ groupMode }))}
            {form.groupMode === "some" && (
              <div className="adjust-form__sub">
                {checks("adjust-groups", "指定车型组", [...product.vehicle_groups.map((group) => ({ value: group.vehicle_group_id, label: displayName(group.name).text })), ...staleGroups.map((id) => ({ value: id, label: groupName(id), badge: "已不在这个商品里" }))], form.groupIds, (ids) => change({ groupIds: ids }))}
                <FieldErrors id="adjust-groups-error" errors={errors("adjust-groups")} />
                {staleGroups.length > 0 && warn(`有 ${staleGroups.length} 个已经不在这个商品里，保存时会一起去掉。`)}
              </div>
            )}
          </fieldset>
          {product.category === "airport_transfer" && (
            <fieldset className="field fieldset">
              <legend className="field__label">方向</legend>
              {modeRadios("adjust-direction", "方向", form.direction, [{ value: "both", label: station ? "接站和送站" : "接机和送机" }, { value: "pickup", label: station ? "只接站" : "只接机" }, { value: "dropoff", label: station ? "只送站" : "只送机" }] as const, (direction) => change({ direction }))}
              <p className="field__hint">看的是客人这一单是接还是送，和价格规则里用的是「接送通用」还是单独的那一条无关。</p>
            </fieldset>
          )}
          {product.category === "charter" && (
            <fieldset className="field fieldset">
              <legend className="field__label">套餐</legend>
              {modeRadios("adjust-package-mode", "套餐", form.packageMode, [{ value: "all", label: "全部套餐" }, { value: "some", label: "指定套餐" }] as const, (packageMode) => change({ packageMode }))}
              {form.packageMode === "some" && (
                <div className="adjust-form__sub">
                  {checks("adjust-packages", "指定套餐", [...new Set([...packages, ...form.packages])].sort((x, y) => x - y).map((hours) => ({ value: String(hours), label: `${hours} 小时` })), form.packages.map(String), (values) => change({ packages: values.map(Number) }))}
                  <FieldErrors id="adjust-packages-error" errors={errors("adjust-packages")} />
                </div>
              )}
            </fieldset>
          )}
        </div>
      </section>

      <section className="card" aria-labelledby="adjust-steps-title">
        <h4 className="card__title" id="adjust-steps-title">
          怎么调
          <span className="field__required" aria-hidden="true">
            {" *"}
          </span>
        </h4>
        <ol className="adjust-steps">
          {form.steps.map((step, index) => (
            <li key={index} className="adjust-steps__step">
              <span className="adjust-steps__label">{`第 ${index + 1} 步`}</span>
              <select className="input select" aria-label={`第 ${index + 1} 步的方向`} value={step.up ? "up" : "down"} disabled={saving} onChange={(event) => changeStep(index, { up: event.target.value === "up" })}>
                <option value="up">上调</option>
                <option value="down">下调</option>
              </select>
              <select className="input select" aria-label={`第 ${index + 1} 步的方式`} value={step.type} disabled={saving} onChange={(event) => changeStep(index, { type: event.target.value === "amount" ? "amount" : "percent", value: "" })}>
                <option value="percent">按比例</option>
                <option value="amount">按金额</option>
              </select>
              <span className="affix">
                {input(`adjust-step-${index}-value`, step.value, (value) => changeStep(index, { value }), { label: `第 ${index + 1} 步的数值`, mode: "decimal", describedBy: `adjust-step-${index}-error`, ...(step.type === "amount" ? { tidy: (raw: string) => tidyAmountDisplay(raw, currency) } : {}) })}
                <span className="affix__text">{step.type === "percent" ? "%" : currency}</span>
              </span>
              <span className="adjust-steps__tools">
                <IconButton icon="arrow-up" label={`第 ${index + 1} 步上移`} disabled={saving || index === 0} onClick={() => moveStep(index, -1)} />
                <IconButton icon="arrow-down" label={`第 ${index + 1} 步下移`} disabled={saving || index === form.steps.length - 1} onClick={() => moveStep(index, 1)} />
                <IconButton icon="x" label={form.steps.length === 1 ? "至少保留一步" : `删除第 ${index + 1} 步`} disabled={saving || form.steps.length === 1} onClick={() => change({ steps: form.steps.filter((_, at) => at !== index) })} />
              </span>
              <span className="adjust-steps__errors">
                <FieldErrors id={`adjust-step-${index}-error`} errors={errors(`adjust-step-${index}-value`)} />
              </span>
            </li>
          ))}
        </ol>
        <div className="adjust-steps__add">
          <Button id="adjust-step-add" disabled={saving || form.steps.length >= PRICE_LIMITS.maxAdjustSteps} onClick={() => change({ steps: [...form.steps, { up: true, type: "percent", value: "" }] })}>
            <Icon name="plus" />
            加一步
          </Button>
          {form.steps.length >= PRICE_LIMITS.maxAdjustSteps && <span className="field__hint">{`最多 ${PRICE_LIMITS.maxAdjustSteps} 步`}</span>}
        </div>
        <p className="field__hint">几步从上到下依次算：后一步在前一步算完的结果上接着算。</p>
      </section>

      {meaning}

      <div className="form-bar step__bar">
        <span className="form-bar__note step__summary">{[dirty ? "有未保存的修改" : "", published ? "已上架，保存后约 1 分钟生效" : "", conflict ? "请先载入最新内容" : "", gone ? "这条规则已经不存在" : ""].filter((part) => part !== "").join(" · ")}</span>
        <Button variant="text" disabled={saving} onClick={cancel}>
          取消
        </Button>
        <Button variant="primary" type="submit" disabled={conflict || gone || locked} loading={saving && unusual === null} loadingText="保存中…">
          保存
        </Button>
      </div>

      <Dialog
        open={unusual !== null}
        title="这条规则调得很多，确认保存？"
        busy={saving}
        onClose={() => setUnusual(null)}
        footer={
          <>
            <Button variant="text" data-autofocus disabled={saving} onClick={() => setUnusual(null)}>
              回去检查
            </Button>
            <Button variant="primary" loading={saving} loadingText="保存中…" onClick={() => reading.input && void send(reading.input)}>
              确认保存
            </Button>
          </>
        }
      >
        {unusual && (
          <p>
            {`按${unusual.label}算，${unusual.from} 会变成 `}
            <strong>{unusual.to}</strong>
            {unusual.change === "" ? "" : `（${unusual.change}）`}。如果是多敲了一个 0，请回去改。
          </p>
        )}
      </Dialog>
      <Dialog
        open={leaving !== null}
        title="这条调价规则有未保存的修改"
        onClose={() => setLeaving(null)}
        footer={
          <>
            <Button variant="text" data-autofocus onClick={() => setLeaving(null)}>
              继续编辑
            </Button>
            <Button
              variant="secondary"
              className="button--danger-text"
              onClick={() => {
                const to = leaving;
                setLeaving(null);
                setInitial(JSON.stringify(form));
                if (to !== null) requestAnimationFrame(() => void navigate(to));
              }}
            >
              不保存，离开
            </Button>
          </>
        }
      >
        <p>离开后，这里填的内容不会保留。</p>
      </Dialog>
    </form>
  );
}
