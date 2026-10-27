/**
 * 渠道详情的各个分区（ADR 0023）：操作、基本配置、授权范围、定价参数、加价规则、复核记录、API 客户端与密钥、询价日志。
 * 改定价参数、加价规则、暂停：发起一条复核，提示「另一位同事批准后生效」，不直接改页面上的数。
 * API 密钥只在新建、轮换的那一次应答里有：放在对话框自己的状态里，关掉就没有了（不进地址、存储、日志、提示条）。
 */
import { SERVICE_CATEGORIES, type ServiceCategory } from "@nozomi/domain";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  type ApiClient,
  type Approval,
  type Channel,
  type ChannelDetail,
  type IssuedSecret,
  type MarkupRule,
  type MarkupRuleInput,
  type NamedRef,
  type PricingImpactRequest,
  activateChannel,
  createApiClient,
  listApiClients,
  listApprovals,
  listQuoteLogs,
  requestChannelPause,
  requestPricingChange,
  requestRuleCreate,
  requestRuleDelete,
  requestRuleUpdate,
  revokeApiClient,
  rotateApiClient,
} from "../../api/channels.ts";
import { ApiError } from "../../api/client.ts";
import type { SelectableCity } from "../../api/city-options.ts";
import { type VehicleGroup, listAllMaster } from "../../api/master.ts";
import { listAllTenants } from "../../api/platform.ts";
import type { Tenant } from "../../api/types.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { Button, LinkButton } from "../../components/Button.tsx";
import { Combobox, type ComboboxOption } from "../../components/Combobox.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { CopyButton, RadioGroup, SelectField } from "../../components/FormFields.tsx";
import { Icon } from "../../components/Icon.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { TextField } from "../../components/TextField.tsx";
import { useToast } from "../../components/Toast.tsx";
import { APPROVALS_PAGE_PATH, APPROVAL_KIND_NAMES, APPROVAL_STATUS_BADGES, CHANNEL_STATUS_BADGES, CHANNEL_TYPE_NAMES, MARKUP_LEVEL_NAMES, PLATFORM_FLOOR_TEXT, TENANT_SCOPE_NAMES, approvalSummaryText, categoriesText, channelPath, cityChoices, percentText, pricingLines, readPercent, belowFloorRuleLines, relatedPending, ruleDatesText, ruleScopeText } from "../../lib/channel-display.ts";
import { failureText } from "../../lib/failure.ts";
import { SERVICE_CATEGORY_NAMES, displayName, formatLocalDateTime } from "../../lib/master-display.ts";
import { CURRENCY_OPTIONS, amountText, moneyText, readAmount } from "../../lib/product-display.ts";
import { serverIssues } from "../../lib/product-failure.ts";
import { useLoad } from "../../lib/use-load.ts";
import { unlistedCityLabel, useCityOptions, useScopeCityIds } from "../../lib/use-city-options.ts";
import { usePlatformCan } from "../../lib/use-master-access.ts";
import { ImpactPreview } from "./PricingImpactPanel.tsx";

const SUBMITTED = "已提交审核：另一位有审核权限的同事批准后才生效。可以在「待审核」里看进度。";

/** 发起复核、操作失败时给人看的一句话。 */
function requestFailure(err: unknown, what: string): string {
  if (err instanceof ApiError) {
    if (err.code === "VALIDATION_FAILED") {
      const issues = serverIssues(err);
      return issues.length > 0 ? issues.map((issue) => issue.message).join("；") : "提交的内容不符合要求，请检查后重试。";
    }
    if (err.code === "MARKUP_RULE_CONFLICT") return "同一组维度上已经有一条规则：不带日期的只能有一条，带日期的日期范围不能重叠。请改那一条，或换个日期范围。";
    if (err.code === "RULES_BELOW_FLOOR") return `${err.message}。`;
    if (err.code === "VERSION_CONFLICT") return "这条记录刚被别人改过。请关掉对话框、刷新页面后再试。";
    if (err.code === "CHANNEL_STATUS_UNCHANGED") return err.message;
    if (err.status === 403) return "你没有权限做这个操作。需要的话，请联系管理员开通。";
  }
  return failureText(err, what);
}

/** 调高下限被拦时：说清楚是哪几条规则、怎么办（M1-17）。 */
export function BelowFloorAlert({ message, lines, then }: { message: string; lines: readonly string[]; then: string }) {
  return (
    <Alert kind="danger">
      <strong className="alert__title">{`${message}。`}</strong>
      {lines.length > 0 && (
        <ul className="alert__list">
          {lines.map((line, index) => (
            <li key={`${index}-${line}`}>{line}</li>
          ))}
        </ul>
      )}
      <span>{then}</span>
    </Alert>
  );
}

/**
 * 发起前提醒：同一渠道上已经有会和这次互相「过时」的待审核改动（M1-17）。对话框打开时取一次这个渠道待审核的改动；
 * 取不到就不提醒（不挡发起，批准时后端照样会核对版本）；角色没有「待审核」权限时不去取（M4-13）。
 */
function PendingNotice({ channelId, target }: { channelId: string; target: Parameters<typeof relatedPending>[0] }) {
  const canReadApprovals = usePlatformCan("approval.read");
  const loaded = useLoad(`channel-pending:${channelId}`, canReadApprovals ? (token) => listApprovals(token, { status: "pending", resource_id: channelId, limit: 100 }) : null);
  const related = relatedPending(target, loaded.state.data?.items ?? []);
  if (related.length === 0) return null;
  return (
    <Alert kind="warning">
      <strong className="alert__title">{`这个渠道已经有 ${related.length} 条待审核的定价改动：`}</strong>
      <ul className="alert__list">
        {related.map((approval) => (
          <li key={approval.id}>{`${approvalSummaryText(approval.summary)}（${approval.requested_by.name}，${formatLocalDateTime(approval.requested_at)} 发起）`}</li>
        ))}
      </ul>
      <span>它们和这次的改动谁先被批准，另外的就会过时，只能驳回后按现在的数重新发起。要改的是同一处的话，建议先到「待审核」撤回旧的，或等它处理完再发起。</span>
    </Alert>
  );
}

// ───────────── 加价规则的表单 ─────────────

interface RuleForm {
  level: MarkupRule["level"];
  tenantId: string;
  cityId: string;
  category: ServiceCategory | "";
  vehicleGroupId: string;
  markup: string;
  validFrom: string;
  validTo: string;
  note: string;
  requestNote: string;
}

const LEVEL_DIMS: Readonly<Record<MarkupRule["level"], { tenant: boolean; city: boolean; category: boolean; vehicleGroup: boolean }>> = {
  1: { tenant: true, city: true, category: true, vehicleGroup: true },
  2: { tenant: true, city: false, category: false, vehicleGroup: false },
  3: { tenant: false, city: true, category: true, vehicleGroup: true },
  4: { tenant: false, city: true, category: true, vehicleGroup: false },
  5: { tenant: false, city: false, category: false, vehicleGroup: false },
};

function ruleFormOf(rule: MarkupRule | null): RuleForm {
  if (rule === null) return { level: 4, tenantId: "", cityId: "", category: "", vehicleGroupId: "", markup: "", validFrom: "", validTo: "", note: "", requestNote: "" };
  return { level: rule.level, tenantId: rule.tenant?.id ?? "", cityId: rule.city?.id ?? "", category: rule.category ?? "", vehicleGroupId: rule.vehicle_group?.id ?? "", markup: percentText(rule.markup_bp).replace("%", ""), validFrom: rule.valid_from ?? "", validTo: rule.valid_to ?? "", note: rule.note ?? "", requestNote: "" };
}

function readRuleForm(form: RuleForm, floorBp: number): { errors: Partial<Record<keyof RuleForm, string>>; body: MarkupRuleInput | null } {
  const dims = LEVEL_DIMS[form.level];
  const errors: Partial<Record<keyof RuleForm, string>> = {};
  if (dims.tenant && form.tenantId === "") errors.tenantId = "请选择供应商";
  if (dims.city && form.cityId === "") errors.cityId = "请选择城市";
  if (dims.category && form.category === "") errors.category = "请选择品类";
  if (dims.vehicleGroup && form.vehicleGroupId === "") errors.vehicleGroupId = "请选择车型组";
  const markup = readPercent(form.markup);
  if (markup === null) errors.markup = "请填百分比，最多两位小数，例如 12.5";
  else if (markup < floorBp) errors.markup = `不能低于这个渠道的加价下限 ${percentText(floorBp)}`;
  const date = /^\d{4}-\d{2}-\d{2}$/;
  if (form.validFrom.trim() !== "" && !date.test(form.validFrom.trim())) errors.validFrom = "日期写成 2026-10-01";
  if (form.validTo.trim() !== "" && !date.test(form.validTo.trim())) errors.validTo = "日期写成 2026-10-07";
  if (!errors.validFrom && !errors.validTo && form.validFrom.trim() !== "" && form.validTo.trim() !== "" && form.validFrom.trim() > form.validTo.trim()) errors.validTo = "结束日期不能早于开始日期";
  if (form.level === 5 && form.validFrom.trim() === "" && form.validTo.trim() === "") errors.validFrom = "全渠道的规则要带日期范围（不带日期的全渠道比例就是默认加价比例）";
  if (Object.keys(errors).length > 0 || markup === null) return { errors, body: null };
  const blank = (value: string): string | null => (value.trim() === "" ? null : value.trim());
  return {
    errors,
    body: {
      tenant_id: dims.tenant ? form.tenantId : null,
      city_id: dims.city ? form.cityId : null,
      category: dims.category ? (form.category as ServiceCategory) : null,
      vehicle_group_id: dims.vehicleGroup ? form.vehicleGroupId : null,
      markup_bp: markup,
      valid_from: blank(form.validFrom),
      valid_to: blank(form.validTo),
      note: blank(form.note),
      request_note: blank(form.requestNote),
    },
  };
}

/**
 * 加价规则里能选的城市：可选城市（启用中、自己数据范围里的，M4-13）里渠道授权卖的（「全部城市」= 全部可选城市）；
 * 修改时原来那个城市即使不在里面也留着，标出原因（M1-17）：渠道没有授权、已停用、不在自己的数据范围里。
 */
function ruleCityOptions(cities: readonly SelectableCity[], scopeCities: readonly NamedRef[] | null, original: NamedRef | null, myScope: ReadonlySet<string> | null): ComboboxOption[] {
  const allowed = scopeCities === null ? null : new Set(scopeCities.map((city) => city.id));
  const options = cityChoices(cities.filter((city) => allowed === null || allowed.has(city.id)));
  if (original === null || options.some((option) => option.value === original.id)) return options;
  const selectable = cityChoices(cities.filter((city) => city.id === original.id))[0];
  return [...options, selectable ? { ...selectable, label: `${selectable.label}（渠道没有授权）` } : { value: original.id, label: unlistedCityLabel(original.id, original.name, myScope) }];
}

function RuleDialog({ channelId, floorBp, scopeCities, rule, onClose, onDone }: { channelId: string; floorBp: number; scopeCities: readonly NamedRef[] | null; rule: MarkupRule | null; onClose(): void; onDone(): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const canSeeTenants = usePlatformCan("tenant.read");
  const tenants = useLoad<{ items: Tenant[]; truncated: boolean }>("rule-tenants", canSeeTenants ? listAllTenants : null);
  const cities = useCityOptions();
  const myScope = useScopeCityIds();
  const groups = useLoad<VehicleGroup[]>("rule-vehicle-groups", (session) => listAllMaster("vehicle-groups", session, { status: "all", sort: "code" }));
  const [form, setForm] = useState<RuleForm>(() => ruleFormOf(rule));
  const [attempted, setAttempted] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reading = readRuleForm(form, Math.max(floorBp, 1_000));
  // 试算不看「给审核人的说明」：改说明不让算过的结果作废
  const ruleBody = reading.body === null ? null : { ...reading.body, request_note: null };
  const impactRequest: PricingImpactRequest | null = ruleBody === null ? null : rule === null ? { kind: "markup_rule.create", rule: ruleBody } : { kind: "markup_rule.update", rule_id: rule.id, rule: ruleBody };
  const errorOf = (key: keyof RuleForm): string[] => (attempted && reading.errors[key] ? [reading.errors[key] as string] : []);
  const dims = LEVEL_DIMS[form.level];
  const change = (changes: Partial<RuleForm>): void => setForm((current) => ({ ...current, ...changes }));
  const option = (value: string, label: string) => ({ value, label });
  const tenantOptions = [option("", "请选择"), ...(tenants.state.data?.items ?? []).map((tenant) => option(tenant.id, tenant.name))];
  const cityOptions = ruleCityOptions(cities.state.data ?? [], scopeCities, rule?.city ?? null, myScope);
  const groupOptions = [option("", "请选择"), ...(groups.state.data ?? []).filter((group) => group.status === "active" || group.id === form.vehicleGroupId).map((group) => option(group.id, `${displayName(group.name).text}（${group.code}）`))];
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setAttempted(true);
    setProblem(null);
    if (reading.body === null || busy) return;
    setBusy(true);
    try {
      if (rule === null) await requestRuleCreate(token, channelId, reading.body);
      else await requestRuleUpdate(token, channelId, rule, reading.body);
      toast(SUBMITTED);
      onDone();
    } catch (err) {
      if (handleAuthFailure(err)) return;
      setProblem(requestFailure(err, "提交"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open title={rule === null ? "新增加价规则" : "修改加价规则"} size="form" busy={busy} dismissOnBackdrop={false} onClose={onClose} footer={
      <>
        <Button variant="text" disabled={busy} onClick={onClose}>取消</Button>
        <Button variant="primary" type="submit" form="rule-form" loading={busy} loadingText="提交中…">提交审核</Button>
      </>
    }>
      <form id="rule-form" className="form" noValidate onSubmit={(event) => void submit(event)}>
        <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
        <PendingNotice channelId={channelId} target={{ kind: "rule", ruleId: rule?.id ?? null }} />
        <p className="page-intro">从具体到通用匹配，命中第一级就停。提交后要另一位同事批准才生效。</p>
        <RadioGroup legend="按什么设" name="rule-level" options={([1, 2, 3, 4, 5] as const).map((level) => ({ value: String(level), label: `第 ${level} 级：${MARKUP_LEVEL_NAMES[level]}` }))} value={String(form.level)} onChange={(value: string) => change({ level: Number(value) as MarkupRule["level"] })} />
        {dims.tenant && <SelectField label="供应商" value={form.tenantId} options={tenantOptions} onChange={(value) => change({ tenantId: value })} />}
        {dims.tenant && errorOf("tenantId").length > 0 && <p className="field__error">{errorOf("tenantId")[0]}</p>}
        {dims.city && (
          <Combobox
            label="城市"
            required
            options={cityOptions}
            value={form.cityId === "" ? null : form.cityId}
            placeholder="输入城市名称或编码查找"
            emptyText={scopeCities === null || cities.state.status === "forbidden" ? cities.emptyText : myScope === null ? "这个渠道授权的城市都已停用" : "这个渠道授权的城市都已停用，或不在你的数据范围里"}
            loading={cities.loading}
            loadFailed={cities.loadFailed}
            errors={errorOf("cityId")}
            hint={scopeCities === null ? (myScope === null ? "这个渠道可以卖全部城市，这里列出平台启用中的城市。" : "这个渠道可以卖全部城市，这里列出你的数据范围里启用中的城市。") : `只列这个渠道授权卖的 ${scopeCities.length} 个城市${myScope === null ? "" : "里你的数据范围内的"}。要加别的城市，先在「编辑基本信息和授权范围」里授权。`}
            onChange={(value) => change({ cityId: value ?? "" })}
          />
        )}
        {dims.category && <SelectField label="品类" value={form.category} options={[option("", "请选择"), ...SERVICE_CATEGORIES.map((value) => option(value, SERVICE_CATEGORY_NAMES[value]))]} onChange={(value) => change({ category: value as ServiceCategory | "" })} />}
        {dims.category && errorOf("category").length > 0 && <p className="field__error">{errorOf("category")[0]}</p>}
        {dims.vehicleGroup && <SelectField label="车型组" value={form.vehicleGroupId} options={groupOptions} onChange={(value) => change({ vehicleGroupId: value })} />}
        {dims.vehicleGroup && errorOf("vehicleGroupId").length > 0 && <p className="field__error">{errorOf("vehicleGroupId")[0]}</p>}
        <TextField label="加价比例（%）" inputMode="decimal" autoComplete="off" value={form.markup} errors={errorOf("markup")} hint={`不能低于这个渠道的加价下限 ${percentText(Math.max(floorBp, 1_000))}（平台下限 ${PLATFORM_FLOOR_TEXT}）。`} onChange={(event) => change({ markup: event.target.value })} />
        <div className="quote-form__time">
          <TextField label="用车日期从（选填）" inputMode="numeric" autoComplete="off" placeholder="年-月-日" value={form.validFrom} errors={errorOf("validFrom")} onChange={(event) => change({ validFrom: event.target.value })} />
          <TextField label="到（选填）" inputMode="numeric" autoComplete="off" placeholder="年-月-日" value={form.validTo} errors={errorOf("validTo")} onChange={(event) => change({ validTo: event.target.value })} />
        </div>
        <p className="field__hint">促销期用：按用车日期（城市当地），两端都含，写成 2026-12-01 这样。同一级里，在日期范围内的规则优先于不带日期的。</p>
        <TextField label="备注（选填）" autoComplete="off" value={form.note} onChange={(event) => change({ note: event.target.value })} />
        <TextField label="给审核人的说明（选填）" autoComplete="off" value={form.requestNote} onChange={(event) => change({ requestNote: event.target.value })} />
        <ImpactPreview channelId={channelId} request={impactRequest} />
      </form>
    </Dialog>
  );
}

// ───────────── 定价参数的表单 ─────────────

function PricingDialog({ detail, onClose, onDone }: { detail: ChannelDetail; onClose(): void; onDone(): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const { channel } = detail;
  const [markup, setMarkup] = useState(percentText(channel.pricing.default_markup_bp).replace("%", ""));
  const [floor, setFloor] = useState(percentText(channel.pricing.markup_floor_bp).replace("%", ""));
  const [band, setBand] = useState(percentText(channel.pricing.band_bp).replace("%", ""));
  const [margin, setMargin] = useState(channel.pricing.min_margin === 0 ? "" : amountText(channel.pricing.min_margin, channel.settle_currency));
  const [rounding, setRounding] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(channel.pricing.sell_rounding).map(([currency, unit]) => [currency, amountText(unit, currency)])));
  const [note, setNote] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [problem, setProblem] = useState<ReactNode>(null);
  const [busy, setBusy] = useState(false);
  const floorBp = readPercent(floor);
  const markupBp = readPercent(markup);
  const bandBp = readPercent(band);
  const marginRead = margin.trim() === "" ? ({ ok: true, minor: 0 } as const) : readAmount(margin, channel.settle_currency);
  const roundingRead = Object.entries(rounding).filter(([, text]) => text.trim() !== "").map(([currency, text]) => [currency, readAmount(text, currency)] as const);
  const errors = {
    floor: floorBp === null ? "请填百分比，例如 10" : floorBp < 1_000 ? `不能低于平台下限 ${PLATFORM_FLOOR_TEXT}` : null,
    markup: markupBp === null ? "请填百分比，例如 10" : floorBp !== null && markupBp < floorBp ? "不能低于加价下限" : null,
    band: bandBp === null || bandBp > 500 ? "要在 0% 到 5% 之间" : null,
    margin: marginRead.ok ? null : marginRead.message,
    rounding: roundingRead.some(([, read]) => !read.ok || read.minor < 1) ? "取整单位要填正数" : null,
  };
  const shown = (message: string | null): string[] => (attempted && message !== null ? [message] : []);
  const valid = !Object.values(errors).some((value) => value !== null) && floorBp !== null && markupBp !== null && bandBp !== null && marginRead.ok;
  const pricing =
    valid && floorBp !== null && markupBp !== null && bandBp !== null && marginRead.ok
      ? { default_markup_bp: markupBp, markup_floor_bp: floorBp, band_bp: bandBp, min_margin: marginRead.minor, sell_rounding: Object.fromEntries(roundingRead.flatMap(([currency, read]) => (read.ok ? [[currency, read.minor]] : []))) }
      : null;
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setAttempted(true);
    setProblem(null);
    if (pricing === null || busy) return;
    setBusy(true);
    try {
      await requestPricingChange(token, channel.id, { ...pricing, request_note: note.trim() === "" ? null : note.trim() });
      toast(SUBMITTED);
      onDone();
    } catch (err) {
      if (handleAuthFailure(err)) return;
      setProblem(
        err instanceof ApiError && err.code === "RULES_BELOW_FLOOR" ? (
          <BelowFloorAlert message={err.message} lines={belowFloorRuleLines(err.details, detail.markup_rules)} then="在「加价规则」里把这几条「修改」到新的下限以上（同样要同事批准），批准后再来调高下限；或者把下限改低一点。" />
        ) : (
          requestFailure(err, "提交")
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open title="申请修改定价参数" size="form" busy={busy} dismissOnBackdrop={false} onClose={onClose} footer={
      <>
        <Button variant="text" disabled={busy} onClick={onClose}>取消</Button>
        <Button variant="primary" type="submit" form="pricing-form" loading={busy} loadingText="提交中…">提交审核</Button>
      </>
    }>
      <form id="pricing-form" className="form" noValidate onSubmit={(event) => void submit(event)}>
        <div role="alert">{typeof problem === "string" ? <Alert kind="danger">{problem}</Alert> : problem}</div>
        <PendingNotice channelId={channel.id} target={{ kind: "pricing" }} />
        <p className="page-intro">改加价比例是敏感操作：提交后要另一位同事批准才生效。调高下限时，还在用的加价规则不能低于新的下限。</p>
        <TextField label="默认加价比例（%）" inputMode="decimal" autoComplete="off" value={markup} errors={shown(errors.markup)} onChange={(event) => setMarkup(event.target.value)} />
        <TextField label="加价下限（%）" inputMode="decimal" autoComplete="off" value={floor} errors={shown(errors.floor)} hint={`不能低于平台下限 ${PLATFORM_FLOOR_TEXT}。`} onChange={(event) => setFloor(event.target.value)} />
        <TextField label="价格带 δ（%）" inputMode="decimal" autoComplete="off" value={band} errors={shown(errors.band)} hint="0% 到 5%。" onChange={(event) => setBand(event.target.value)} />
        <TextField label={`最低毛利（${channel.settle_currency}，选填）`} inputMode="decimal" autoComplete="off" value={margin} errors={shown(errors.margin)} onChange={(event) => setMargin(event.target.value)} />
        <fieldset className="field fieldset">
          <legend className="field__label">对外价取整（选填）</legend>
          <p className="field__hint">客人用这个币种付款时，对外价向上取整到这个单位，例如日元填 100。不填就是不取整。</p>
          <div className="channel-rounding">
            {CURRENCY_OPTIONS.map((currency) => (
              <TextField key={currency.value} label={currency.label} inputMode="decimal" autoComplete="off" value={rounding[currency.value] ?? ""} onChange={(event) => setRounding({ ...rounding, [currency.value]: event.target.value })} />
            ))}
          </div>
          {shown(errors.rounding).map((message) => (
            <p key={message} className="field__error">
              {message}
            </p>
          ))}
        </fieldset>
        <TextField label="给审核人的说明（选填）" autoComplete="off" value={note} onChange={(event) => setNote(event.target.value)} />
        <ImpactPreview channelId={channel.id} request={pricing === null ? null : { kind: "channel.pricing", change: pricing }} />
      </form>
    </Dialog>
  );
}

// ───────────── 简单的确认 + 说明 ─────────────

function NoteDialog({ title, intro, confirmLabel, danger, onClose, onConfirm }: { title: string; intro: ReactNode; confirmLabel: string; danger?: boolean; onClose(): void; onConfirm(note: string | null): Promise<string | null> }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const confirm = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      const failure = await onConfirm(note.trim() === "" ? null : note.trim());
      if (failure !== null) setProblem(failure);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open title={title} busy={busy} onClose={onClose} footer={
      <>
        <Button variant="text" data-autofocus disabled={busy} onClick={onClose}>取消</Button>
        <Button variant={danger ? "secondary" : "primary"} className={danger ? "button--danger-text" : undefined} loading={busy} loadingText="处理中…" onClick={() => void confirm()}>{confirmLabel}</Button>
      </>
    }>
      <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
      <div>{intro}</div>
      <TextField label="说明（选填）" autoComplete="off" value={note} onChange={(event) => setNote(event.target.value)} />
    </Dialog>
  );
}

// ───────────── API 密钥 ─────────────

/** 密钥只显示这一次：只能用底部按钮关；还没复制就关要再确认一次。 */
function SecretDialog({ issued, onClose }: { issued: IssuedSecret; onClose(): void }) {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const copy = (): void => {
    void navigator.clipboard?.writeText(issued.client_secret).then(
      () => setCopied(true),
      () => undefined,
    );
  };
  return (
    <Dialog open sealed title="API 密钥（只显示这一次）" size="form" onClose={onClose} footer={
      confirming ? (
        <>
          <Button variant="text" onClick={() => setConfirming(false)}>回去复制</Button>
          <Button variant="secondary" className="button--danger-text" onClick={onClose}>不复制，关闭</Button>
        </>
      ) : (
        <Button variant="primary" onClick={() => (copied ? onClose() : setConfirming(true))}>我已保存好，关闭</Button>
      )
    }>
      <Alert kind="warning">
        <strong className="alert__title">密钥只在这里显示一次。</strong>
        <span>平台只存它的指纹，关掉以后谁都看不到原文；丢了只能轮换。请当场复制，交给渠道的技术人员保管，不要发在群聊里。</span>
      </Alert>
      {confirming && <Alert kind="danger">还没有复制密钥。关掉以后就看不到了，确定要关吗？</Alert>}
      <dl className="details">
        <div>
          <dt>client_id</dt>
          <dd className="tenant-id">
            <span className="product-code">{issued.api_client.client_id}</span>
            <CopyButton text={issued.api_client.client_id} label="复制 client_id" />
          </dd>
        </div>
        <div>
          <dt>client_secret</dt>
          <dd>
            <textarea className="input secret-box" readOnly rows={2} value={issued.client_secret} aria-label="client_secret" onFocus={(event) => event.target.select()} />
            <Button size="sm" onClick={copy}>
              <Icon name="copy" />
              {copied ? "已复制" : "复制密钥"}
            </Button>
          </dd>
        </div>
      </dl>
      <p className="field__hint">渠道用它们调用 POST /sales/v1/oauth/token 换访问令牌（2 小时有效）。</p>
    </Dialog>
  );
}

function ApiClientsCard({ channelId, canManage }: { channelId: string; canManage: boolean }) {
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const loaded = useLoad(`channel-api-clients:${channelId}`, (session) => listApiClients(session, channelId));
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedSecret | null>(null);
  const [rotating, setRotating] = useState<ApiClient | null>(null);
  const [immediate, setImmediate] = useState(false);
  const [revoking, setRevoking] = useState<ApiClient | null>(null);
  const create = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (name.trim() === "" || busy) return setProblem(name.trim() === "" ? "请填一个名字，例如「官网正式环境」" : null);
    setBusy(true);
    setProblem(null);
    try {
      // 不自动重试：重试一次就多发一个密钥
      const result = await createApiClient(token, channelId, name.trim());
      setCreating(false);
      setName("");
      setIssued(result);
      loaded.reload();
    } catch (err) {
      if (handleAuthFailure(err)) return;
      setProblem(requestFailure(err, "新建"));
    } finally {
      setBusy(false);
    }
  };
  const rotate = async (): Promise<void> => {
    if (rotating === null) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await rotateApiClient(token, channelId, rotating.id, immediate);
      setRotating(null);
      setIssued(result);
      loaded.reload();
    } catch (err) {
      if (handleAuthFailure(err)) return;
      setProblem(requestFailure(err, "轮换"));
    } finally {
      setBusy(false);
    }
  };
  const items = loaded.state.data?.items ?? [];
  return (
    <section className="card" aria-labelledby="channel-clients-title">
      <div className="card__title-row">
        <h2 className="card__title" id="channel-clients-title">
          API 客户端与密钥
        </h2>
        {canManage && (
          <Button onClick={() => { setCreating(true); setProblem(null); }}>
            <Icon name="plus" />
            新建 API 客户端
          </Button>
        )}
      </div>
      <p className="page-intro">渠道调用销售端接口（/sales/v1）的凭据。密钥只在新建、轮换时显示一次；这里只显示后 4 位。</p>
      {loaded.state.data === null ? (
        loaded.state.status === "error" ? <StateBlock title="加载失败" description="请检查网络后重试。" action={<Button variant="secondary" onClick={loaded.reload}>重试</Button>} /> : <Skeleton lines={["long", "long"]} />
      ) : items.length === 0 ? (
        <p className="table__muted">还没有 API 客户端。</p>
      ) : (
        <div className="table-wrap">
          <div className="table-scroll" tabIndex={0} role="region" aria-label="API 客户端">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">名称</th>
                  <th scope="col">client_id</th>
                  <th scope="col">密钥</th>
                  <th scope="col">状态</th>
                  <th scope="col">最近使用</th>
                  {canManage && <th scope="col">操作</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((client) => (
                  <tr key={client.id}>
                    <th scope="row">{client.name}</th>
                    <td>
                      <span className="product-code">{client.client_id}</span>
                    </td>
                    <td>
                      {`••••${client.secret_last4}（第 ${client.secret_generation} 代）`}
                      {client.previous_valid_until !== null && <span className="table__muted">{` 旧密钥到 ${formatLocalDateTime(client.previous_valid_until)} 前仍可用`}</span>}
                    </td>
                    <td>{client.status === "active" ? <StatusBadge tone="success" label="在用" /> : <StatusBadge tone="neutral" label="已吊销" />}</td>
                    <td className="table__muted">{client.last_used_at === null ? "没用过" : formatLocalDateTime(client.last_used_at)}</td>
                    {canManage && (
                      <td>
                        {client.status === "active" && (
                          <span className="table__actions">
                            <Button variant="text" size="sm" onClick={() => { setRotating(client); setImmediate(false); setProblem(null); }}>
                              轮换密钥
                            </Button>
                            <Button variant="text" size="sm" className="button--danger-text" onClick={() => { setRevoking(client); setProblem(null); }}>
                              吊销
                            </Button>
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {creating && (
        <Dialog open title="新建 API 客户端" busy={busy} dismissOnBackdrop={false} onClose={() => setCreating(false)} footer={
          <>
            <Button variant="text" disabled={busy} onClick={() => setCreating(false)}>取消</Button>
            <Button variant="primary" type="submit" form="client-form" loading={busy} loadingText="新建中…">新建并显示密钥</Button>
          </>
        }>
          <form id="client-form" noValidate onSubmit={(event) => void create(event)}>
            <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
            <TextField label="名称" autoComplete="off" value={name} hint="给人看的名字，例如「官网正式环境」。" onChange={(event) => setName(event.target.value)} />
          </form>
        </Dialog>
      )}
      {rotating !== null && (
        <Dialog open title={`轮换「${rotating.name}」的密钥`} busy={busy} onClose={() => setRotating(null)} footer={
          <>
            <Button variant="text" data-autofocus disabled={busy} onClick={() => setRotating(null)}>取消</Button>
            <Button variant="primary" loading={busy} loadingText="轮换中…" onClick={() => void rotate()}>轮换并显示新密钥</Button>
          </>
        }>
          <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
          <p>会发一个新密钥（只显示一次）。旧密钥默认还能用 24 小时，让渠道有时间换上。</p>
          <label className="choice">
            <input type="checkbox" checked={immediate} onChange={(event) => setImmediate(event.target.checked)} />
            <span className="choice__text">旧密钥立即作废（密钥泄露时选这个；用旧密钥换的令牌也会马上失效）</span>
          </label>
        </Dialog>
      )}
      {revoking !== null && (
        <NoteDialog
          title={`吊销「${revoking.name}」`}
          intro={<p>吊销后这个客户端和它换来的令牌立即失效，不能恢复；要用就新建一个。</p>}
          confirmLabel="吊销"
          danger
          onClose={() => setRevoking(null)}
          onConfirm={async () => {
            try {
              await revokeApiClient(token, channelId, revoking.id);
              setRevoking(null);
              toast(`已吊销「${revoking.name}」`);
              loaded.reload();
              return null;
            } catch (err) {
              if (handleAuthFailure(err)) return null;
              return requestFailure(err, "吊销");
            }
          }}
        />
      )}
      {issued !== null && <SecretDialog issued={issued} onClose={() => setIssued(null)} />}
    </section>
  );
}

// ───────────── 复核记录、询价日志 ─────────────

/** 这个渠道的复核记录。角色没有「待审核」权限时不去取（会被拒），说明为什么看不到（M4-13）。 */
function ChannelApprovals({ channelId, version }: { channelId: string; version: number }) {
  const accountReady = usePortalSession().account.status === "ready";
  const canReadApprovals = usePlatformCan("approval.read");
  const loaded = useLoad(`channel-approvals:${channelId}:${version}`, canReadApprovals ? (token) => listApprovals(token, { status: "all", resource_id: channelId, limit: 20 }) : null);
  const items: Approval[] = loaded.state.data?.items ?? [];
  const pending = items.filter((item) => item.status === "pending").length;
  return (
    <section className="card" aria-labelledby="channel-approvals-title">
      <div className="card__title-row">
        <h2 className="card__title" id="channel-approvals-title">
          {`复核记录${pending > 0 ? `（${pending} 条待审核）` : ""}`}
        </h2>
        {canReadApprovals && (
          <Link className="link" to={APPROVALS_PAGE_PATH}>
            去待审核
            <Icon name="chevron-right" />
          </Link>
        )}
      </div>
      {!accountReady ? (
        <Skeleton lines={["long"]} />
      ) : !canReadApprovals ? (
        <p className="table__muted">你的角色没有「看待审核的改动」这项权限，看不到这个渠道的复核记录。需要的话，请联系管理员调整角色。</p>
      ) : loaded.state.data === null ? (
        loaded.state.status === "error" ? <StateBlock title="加载失败" description="请检查网络后重试。" action={<Button variant="secondary" onClick={loaded.reload}>重试</Button>} /> : <Skeleton lines={["long"]} />
      ) : items.length === 0 ? (
        <p className="table__muted">还没有发起过复核。</p>
      ) : (
        <ul className="channel-approvals">
          {items.map((item) => (
            <li key={item.id}>
              <StatusBadge {...APPROVAL_STATUS_BADGES[item.status]} />
              <span>{`${APPROVAL_KIND_NAMES[item.kind]}：${approvalSummaryText(item.summary)}`}</span>
              <span className="table__muted">{`${item.requested_by.name} · ${formatLocalDateTime(item.requested_at)}${item.decided_by ? ` · 审核：${item.decided_by.name}` : ""}`}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function QuoteLogsCard({ channelId }: { channelId: string }) {
  const loaded = useLoad(`channel-quote-logs:${channelId}`, (token) => listQuoteLogs(token, channelId, 20));
  const items = loaded.state.data?.items ?? [];
  return (
    <section className="card" aria-labelledby="channel-logs-title">
      <h2 className="card__title" id="channel-logs-title">
        最近的询价
      </h2>
      {loaded.state.data === null ? (
        loaded.state.status === "error" ? <StateBlock title="加载失败" description="请检查网络后重试。" action={<Button variant="secondary" onClick={loaded.reload}>重试</Button>} /> : <Skeleton lines={["long"]} />
      ) : items.length === 0 ? (
        <p className="table__muted">这个渠道还没有通过销售端接口询过价。</p>
      ) : (
        <div className="table-wrap">
          <div className="table-scroll" tabIndex={0} role="region" aria-label="最近的询价列表">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">时间</th>
                  <th scope="col">品类</th>
                  <th scope="col" className="table__cell--end">候选商品</th>
                  <th scope="col" className="table__cell--end">报出</th>
                  <th scope="col" className="table__cell--end">没报出</th>
                  <th scope="col" className="table__cell--end">耗时</th>
                </tr>
              </thead>
              <tbody>
                {items.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatLocalDateTime(entry.created_at)}</td>
                    <td>{SERVICE_CATEGORY_NAMES[entry.category]}</td>
                    <td className="table__cell--end">{entry.candidate_count}</td>
                    <td className="table__cell--end">{entry.quote_count}</td>
                    <td className="table__cell--end">{entry.reject_count}</td>
                    <td className="table__cell--end">{`${entry.duration_ms} ms`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

// ───────────── 详情 ─────────────

export function ChannelDetailSections({ detail, onChanged, onReplace }: { detail: ChannelDetail; onChanged(): void; onReplace(detail: ChannelDetail): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const canManage = usePlatformCan("channel.manage");
  const { channel, markup_rules: rules } = detail;
  const [dialog, setDialog] = useState<{ kind: "pricing" } | { kind: "rule"; rule: MarkupRule | null } | { kind: "delete"; rule: MarkupRule } | { kind: "pause" } | { kind: "activate" } | null>(null);
  const [round, setRound] = useState(0);
  const done = (): void => {
    setDialog(null);
    setRound(round + 1);
    onChanged();
  };
  const sortedRules = useMemo(() => [...rules], [rules]);
  return (
    <>
      {!canManage && <Alert kind="info">你可以查看这个渠道，但不能修改。</Alert>}
      {channel.status === "paused" && <Alert kind="warning">这个渠道已暂停：它调用销售端接口一律被拒绝。重新启用后恢复。</Alert>}
      {channel.status === "testing" && <Alert kind="info">这个渠道在「测试」状态：可以发 API 密钥联调、可以询价。准备好正式卖了，点「启用」。</Alert>}
      {canManage && (
        <div className="channel-actions">
          <LinkButton to={`${channelPath(channel.id)}/edit`}>编辑基本信息和授权范围</LinkButton>
          {channel.status !== "active" && (
            <Button variant="primary" onClick={() => setDialog({ kind: "activate" })}>
              启用
            </Button>
          )}
          {channel.status !== "paused" && (
            <Button variant="secondary" className="button--danger-text" onClick={() => setDialog({ kind: "pause" })}>
              申请暂停
            </Button>
          )}
        </div>
      )}
      <section className="card" aria-labelledby="channel-info-title">
        <h2 className="card__title" id="channel-info-title">
          基本配置
        </h2>
        <ChannelBasics channel={channel} />
      </section>
      <section className="card" aria-labelledby="channel-scope-view-title">
        <h2 className="card__title" id="channel-scope-view-title">
          授权范围
        </h2>
        <ChannelScopeView channel={channel} />
      </section>
      <section className="card" aria-labelledby="channel-pricing-view-title">
        <div className="card__title-row">
          <h2 className="card__title" id="channel-pricing-view-title">
            定价参数
          </h2>
          {canManage && <Button onClick={() => setDialog({ kind: "pricing" })}>申请修改定价参数</Button>}
        </div>
        <dl className="details">
          {pricingLines(channel.pricing, channel.settle_currency).map((line) => (
            <div key={line.label}>
              <dt>{line.label}</dt>
              <dd>{line.value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="card" aria-labelledby="channel-rules-title">
        <div className="card__title-row">
          <h2 className="card__title" id="channel-rules-title">
            加价规则
          </h2>
          {canManage && (
            <Button onClick={() => setDialog({ kind: "rule", rule: null })}>
              <Icon name="plus" />
              新增加价规则
            </Button>
          )}
        </div>
        <p className="page-intro">{`从具体到通用匹配，命中第一级就停；都没命中用默认加价比例 ${percentText(channel.pricing.default_markup_bp)}。新增、修改、删除都要另一位同事批准才生效。`}</p>
        {sortedRules.length === 0 ? (
          <p className="table__muted">还没有加价规则：全部按默认加价比例。</p>
        ) : (
          <div className="table-wrap">
            <div className="table-scroll" tabIndex={0} role="region" aria-label="加价规则">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">级别</th>
                    <th scope="col">适用于</th>
                    <th scope="col" className="table__cell--end">加价比例</th>
                    <th scope="col">用车日期</th>
                    <th scope="col">备注</th>
                    {canManage && <th scope="col">操作</th>}
                  </tr>
                </thead>
                <tbody>
                  {sortedRules.map((rule) => (
                    <tr key={rule.id}>
                      <td>{`第 ${rule.level} 级`}</td>
                      <th scope="row" className="table__cell--wrap">
                        {ruleScopeText(rule)}
                      </th>
                      <td className="table__cell--end">{percentText(rule.markup_bp)}</td>
                      <td>{ruleDatesText(rule)}</td>
                      <td className="table__cell--wrap">{rule.note ?? "—"}</td>
                      {canManage && (
                        <td>
                          <span className="table__actions">
                            <Button variant="text" size="sm" aria-label={`修改 ${ruleScopeText(rule)} 的规则`} onClick={() => setDialog({ kind: "rule", rule })}>
                              修改
                            </Button>
                            <Button variant="text" size="sm" className="button--danger-text" aria-label={`删除 ${ruleScopeText(rule)} 的规则`} onClick={() => setDialog({ kind: "delete", rule })}>
                              删除
                            </Button>
                          </span>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
      <ChannelApprovals channelId={channel.id} version={channel.version * 1000 + round} />
      <ApiClientsCard channelId={channel.id} canManage={canManage} />
      <QuoteLogsCard channelId={channel.id} />
      {dialog?.kind === "pricing" && <PricingDialog detail={detail} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === "rule" && <RuleDialog channelId={channel.id} floorBp={channel.pricing.markup_floor_bp} scopeCities={channel.scope.cities} rule={dialog.rule} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === "delete" && (
        <NoteDialog
          title="申请删除加价规则"
          intro={
            <>
              <PendingNotice channelId={channel.id} target={{ kind: "rule", ruleId: dialog.rule.id }} />
              <p>{`「${ruleScopeText(dialog.rule)} = ${percentText(dialog.rule.markup_bp)}」。提交后要另一位同事批准才删除；删除后这些情况改按下一级的规则或默认加价比例。`}</p>
              <ImpactPreview channelId={channel.id} request={{ kind: "markup_rule.delete", rule_id: dialog.rule.id }} auto />
            </>
          }
          confirmLabel="提交审核"
          danger
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            try {
              await requestRuleDelete(token, channel.id, dialog.rule);
              toast(SUBMITTED);
              done();
              return null;
            } catch (err) {
              if (handleAuthFailure(err)) return null;
              return requestFailure(err, "提交");
            }
          }}
        />
      )}
      {dialog?.kind === "pause" && (
        <NoteDialog
          title={`申请暂停「${channel.name}」`}
          intro={<p>暂停后这个渠道调用销售端接口一律被拒绝。停用渠道是敏感操作：提交后要另一位同事批准才生效。</p>}
          confirmLabel="提交审核"
          danger
          onClose={() => setDialog(null)}
          onConfirm={async (note) => {
            try {
              await requestChannelPause(token, channel.id, note);
              toast(SUBMITTED);
              done();
              return null;
            } catch (err) {
              if (handleAuthFailure(err)) return null;
              return requestFailure(err, "提交");
            }
          }}
        />
      )}
      {dialog?.kind === "activate" && (
        <NoteDialog
          title={`启用「${channel.name}」`}
          intro={<p>启用后这个渠道就是正式在卖的状态。启用直接生效，不用审核。</p>}
          confirmLabel="启用"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            try {
              const updated = await activateChannel(token, channel.id);
              onReplace(updated);
              setDialog(null);
              toast(`「${channel.name}」已启用`);
              return null;
            } catch (err) {
              if (handleAuthFailure(err)) return null;
              return requestFailure(err, "启用");
            }
          }}
        />
      )}
    </>
  );
}

/** 基本配置（给详情页用）。 */
export function ChannelBasics({ channel }: { channel: Channel }) {
  const rows: { label: string; value: ReactNode }[] = [
    { label: "类型", value: CHANNEL_TYPE_NAMES[channel.type] },
    { label: "状态", value: CHANNEL_STATUS_BADGES[channel.status].label },
    { label: "结算币种", value: channel.settle_currency },
    { label: "公司", value: channel.company ?? "—" },
    { label: "联系人", value: [channel.contact_name, channel.contact_email, channel.contact_phone].filter(Boolean).join(" · ") || "—" },
    { label: "合同编号", value: channel.contract_ref ?? "—" },
    { label: "付款方式", value: `${channel.payment_mode === "prepaid" ? "预付款" : "信用额度"}${channel.credit_limit === null ? "" : `，额度 ${moneyText(channel.credit_limit, channel.settle_currency)}`}（只记录，下单上线后才生效）` },
    { label: "付款后展示中标供应商", value: channel.show_tenant_after_pay ? "展示" : "不展示" },
    {
      label: "渠道编号",
      value: (
        <span className="tenant-id">
          <span className="product-code">{channel.id}</span>
          <CopyButton text={channel.id} label="复制渠道编号" />
        </span>
      ),
    },
    { label: "最近修改", value: formatLocalDateTime(channel.updated_at) },
  ];
  return (
    <dl className="details">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ChannelScopeView({ channel }: { channel: Channel }) {
  const { scope } = channel;
  return (
    <dl className="details">
      <div>
        <dt>可卖的供应商</dt>
        <dd>{scope.tenant_scope === "all" ? TENANT_SCOPE_NAMES.all : `${TENANT_SCOPE_NAMES[scope.tenant_scope]}：${scope.tenants.map((tenant) => tenant.name ?? "（名称没有取到）").join("、")}`}</dd>
      </div>
      <div>
        <dt>可卖的城市</dt>
        <dd>{scope.cities === null ? "全部城市" : scope.cities.map((city) => city.name ?? "（名称没有取到）").join("、")}</dd>
      </div>
      <div>
        <dt>可卖的品类</dt>
        <dd>{categoriesText(scope.categories)}</dd>
      </div>
    </dl>
  );
}
