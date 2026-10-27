/**
 * 运营后台「渠道」（ADR 0023）：列表、新建、编辑基本信息和授权范围、详情。
 * 详情里：基本配置、授权范围、定价参数（改要复核）、加价规则表（新增 / 修改 / 删除要复核）、API 客户端与密钥、这个渠道的复核记录、询价日志。
 * 看：`channel.read`；改和发起复核：`channel.manage`（渠道经理、超级管理员）。没有预置任何渠道：第一个渠道（自营官网）也在这里建。
 */
import { SERVICE_CATEGORIES, type ServiceCategory } from "@nozomi/domain";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { type Channel, type ChannelCreate, type ChannelStatus, type ChannelType, type TenantScope, createChannel, getChannel, listAllChannels, updateChannel } from "../../api/channels.ts";
import { ApiError } from "../../api/client.ts";
import { listAllTenants } from "../../api/platform.ts";
import type { Tenant } from "../../api/types.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Attributions, placeSources } from "../../components/Attribution.tsx";
import { Button, LinkButton } from "../../components/Button.tsx";
import { type Column, DataTable, type TableState } from "../../components/DataTable.tsx";
import { FilterBar, SearchBox, useFilterParam } from "../../components/FilterBar.tsx";
import { CheckboxGroup, RadioGroup, SelectField } from "../../components/FormFields.tsx";
import { Icon } from "../../components/Icon.tsx";
import { MultiCombobox } from "../../components/MultiCombobox.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { TextField } from "../../components/TextField.tsx";
import { useToast } from "../../components/Toast.tsx";
import { CHANNELS_PAGE_PATH, CHANNEL_NEW_PATH, CHANNEL_STATUS_BADGES, CHANNEL_TYPE_HINTS, CHANNEL_TYPE_NAMES, PLATFORM_FLOOR_TEXT, TENANT_SCOPE_NAMES, categoriesText, channelPath, cityChoices, percentText, readPercent } from "../../lib/channel-display.ts";
import { failureText } from "../../lib/failure.ts";
import { SERVICE_CATEGORY_NAMES } from "../../lib/master-display.ts";
import { CURRENCY_OPTIONS, amountText, readAmount } from "../../lib/product-display.ts";
import { serverIssues } from "../../lib/product-failure.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan, usePlatformScopeDenies } from "../../lib/use-master-access.ts";
import { useAllCities } from "../master/shared.tsx";
import { ChannelDetailSections } from "./ChannelSections.tsx";

const NO_ACCESS = <StateBlock tone="neutral" title="你没有权限查看这里" description="需要的话，请联系管理员开通。" />;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ───────────── 列表 ─────────────

function ChannelStatusFilter() {
  const [status, setStatus] = useFilterParam("status");
  return (
    <SelectField
      inline
      label="状态"
      value={status === "testing" || status === "active" || status === "paused" ? status : "all"}
      options={[{ value: "all", label: "全部" }, ...(["testing", "active", "paused"] as const).map((value) => ({ value, label: CHANNEL_STATUS_BADGES[value].label }))]}
      onChange={(value) => setStatus(value === "all" ? null : value)}
    />
  );
}

const CREATE_SCOPE_DENIED = "你的角色限定了渠道范围，不能新建渠道：新渠道不在你的范围里，建了也看不到。需要新渠道时，请不限渠道范围的同事来建，或请管理员调整你的角色。";

export function ChannelListPage() {
  const { portal, account } = usePortalSession();
  useDocumentTitle(`渠道 · NOZOMI ${portal.name}`);
  const canRead = usePlatformCan("channel.read");
  const canManage = usePlatformCan("channel.manage");
  // 限定了渠道范围的人不能新建渠道（ADR 0030，接口 403 `DATA_SCOPE_DENIED`）：不放「新建渠道」，说明原因
  const scopeDeniesCreate = usePlatformScopeDenies("channel.create");
  const canCreate = canManage && !scopeDeniesCreate;
  const loaded = useLoad<{ items: Channel[]; truncated: boolean }>("platform-channels", canRead ? listAllChannels : null);
  const [params, setParams] = useSearchParams();
  const q = (params.get("q") ?? "").slice(0, 100);
  const statusParam = params.get("status");
  const status: ChannelStatus | "all" = statusParam === "testing" || statusParam === "active" || statusParam === "paused" ? statusParam : "all";
  const setParam = (changes: Record<string, string | null>): void => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  };
  const clear = (): void => setParam({ q: null, status: null });
  const shell = (content: ReactNode, action?: ReactNode): ReactNode => (
    <AppShell pageName="渠道">
      <Page title="渠道" {...(action ? { action } : {})}>
        {content}
      </Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);
  const newButton = (
    <LinkButton variant="primary" to={CHANNEL_NEW_PATH}>
      <Icon name="plus" />
      新建渠道
    </LinkButton>
  );
  const needle = q.trim().toLowerCase();
  const rows = (loaded.state.data?.items ?? []).filter((channel) => (status === "all" || channel.status === status) && (needle === "" || channel.name.toLowerCase().includes(needle) || (channel.company ?? "").toLowerCase().includes(needle)));
  const columns: Column<Channel>[] = [
    {
      key: "name",
      header: "渠道",
      wrap: true,
      cell: (row) => (
        <Link className="link" to={channelPath(row.id)}>
          {row.name}
        </Link>
      ),
    },
    { key: "type", header: "类型", cell: (row) => CHANNEL_TYPE_NAMES[row.type] },
    { key: "status", header: "状态", cell: (row) => <StatusBadge {...CHANNEL_STATUS_BADGES[row.status]} /> },
    { key: "currency", header: "结算币种", cell: (row) => row.settle_currency },
    { key: "markup", header: "默认加价", align: "end", cell: (row) => percentText(row.pricing.default_markup_bp) },
    { key: "floor", header: "加价下限", align: "end", cell: (row) => percentText(row.pricing.markup_floor_bp) },
    { key: "scope", header: "可卖", wrap: true, cell: (row) => `${TENANT_SCOPE_NAMES[row.scope.tenant_scope]}${row.scope.tenants.length > 0 ? `（${row.scope.tenants.length} 家）` : ""} · ${row.scope.cities === null ? "全部城市" : `${row.scope.cities.length} 个城市`} · ${categoriesText(row.scope.categories)}` },
  ];
  const state = loaded.state;
  const tableState: TableState = !canRead ? "loading" : state.status === "ready" ? "ready" : state.status === "forbidden" ? "forbidden" : state.data !== null ? "ready" : state.status === "loading" ? "loading" : "error";
  const filtered = needle !== "" || status !== "all";
  const empty = filtered ? (
    <StateBlock
      tone="neutral"
      title="没有符合条件的渠道"
      description="换个条件试试。"
      action={
        <Button variant="secondary" onClick={clear}>
          清空筛选
        </Button>
      }
    />
  ) : (
    <StateBlock tone="neutral" title="还没有渠道" description="渠道是卖平台用车服务的一方：自己的官网、API 分销商、OTA。新建一个，设置它能卖哪些供应商和城市、加价多少，再给它发 API 密钥。第一个通常是自营官网。" {...(canCreate ? { action: newButton } : {})} />
  );
  return shell(
    <>
      {account.status === "ready" && !canManage && <Alert kind="info">你可以查看渠道，但不能修改。</Alert>}
      {account.status === "ready" && canManage && scopeDeniesCreate && <Alert kind="info">{CREATE_SCOPE_DENIED}</Alert>}
      <FilterBar search={<SearchBox label="按名称或公司搜索" value={q} onSearch={(value) => setParam({ q: value })} />} paramNames={["status"]} active={filtered} onClear={clear}>
        <ChannelStatusFilter />
      </FilterBar>
      <div className="card-table">
        <DataTable label="渠道列表" columns={columns} rows={rows} rowKey={(row) => row.id} state={tableState} onRetry={loaded.reload} empty={empty} />
      </div>
    </>,
    canCreate ? newButton : undefined,
  );
}

// ───────────── 表单（新建、编辑共用） ─────────────

interface ChannelFormValue {
  name: string;
  type: ChannelType | null;
  settleCurrency: string;
  company: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  contractRef: string;
  notes: string;
  paymentMode: "prepaid" | "credit";
  creditLimit: string;
  showTenantAfterPay: boolean;
  tenantScope: TenantScope;
  tenantIds: string[];
  allCities: boolean;
  cityIds: string[];
  categories: ServiceCategory[];
  defaultMarkup: string;
  floor: string;
  band: string;
  minMargin: string;
}

function emptyForm(): ChannelFormValue {
  return { name: "", type: null, settleCurrency: "JPY", company: "", contactName: "", contactEmail: "", contactPhone: "", contractRef: "", notes: "", paymentMode: "prepaid", creditLimit: "", showTenantAfterPay: true, tenantScope: "all", tenantIds: [], allCities: true, cityIds: [], categories: [], defaultMarkup: "10", floor: "10", band: "3", minMargin: "" };
}

function formOf(channel: Channel): ChannelFormValue {
  return {
    ...emptyForm(),
    name: channel.name,
    type: channel.type,
    settleCurrency: channel.settle_currency,
    company: channel.company ?? "",
    contactName: channel.contact_name ?? "",
    contactEmail: channel.contact_email ?? "",
    contactPhone: channel.contact_phone ?? "",
    contractRef: channel.contract_ref ?? "",
    notes: channel.notes ?? "",
    paymentMode: channel.payment_mode,
    creditLimit: channel.credit_limit === null ? "" : amountText(channel.credit_limit, channel.settle_currency),
    showTenantAfterPay: channel.show_tenant_after_pay,
    tenantScope: channel.scope.tenant_scope,
    tenantIds: channel.scope.tenants.map((tenant) => tenant.id),
    allCities: channel.scope.cities === null,
    cityIds: (channel.scope.cities ?? []).map((city) => city.id),
    categories: channel.scope.categories,
  };
}

type FormErrors = Partial<Record<"name" | "type" | "creditLimit" | "tenantIds" | "cityIds" | "categories" | "defaultMarkup" | "floor" | "band" | "minMargin" | "contactEmail", string>>;

function readForm(form: ChannelFormValue, withPricing: boolean): { errors: FormErrors; body: ChannelCreate | null } {
  const errors: FormErrors = {};
  if (form.name.trim() === "") errors.name = "请填渠道名称";
  else if (form.name.trim().length > 100) errors.name = "最多 100 个字";
  if (form.type === null) errors.type = "请选择渠道类型";
  if (form.contactEmail.trim() !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail.trim())) errors.contactEmail = "不是合法的邮箱";
  const credit = form.creditLimit.trim() === "" ? null : readAmount(form.creditLimit, form.settleCurrency);
  if (credit !== null && !credit.ok) errors.creditLimit = credit.message;
  if (form.tenantScope !== "all" && form.tenantIds.length === 0) errors.tenantIds = form.tenantScope === "allow" ? "请至少选一家要卖的供应商" : "请至少选一家不卖的供应商";
  if (!form.allCities && form.cityIds.length === 0) errors.cityIds = "请至少选一个城市；全部城市都卖请选「全部城市」";
  if (form.categories.length === 0) errors.categories = "请至少选一个品类";
  const floor = readPercent(form.floor);
  const markup = readPercent(form.defaultMarkup);
  const band = readPercent(form.band);
  const margin = form.minMargin.trim() === "" ? { ok: true as const, minor: 0 } : readAmount(form.minMargin, form.settleCurrency);
  if (withPricing) {
    if (floor === null) errors.floor = "请填百分比，最多两位小数，例如 10";
    else if (floor < 1_000) errors.floor = `加价下限不能低于平台下限 ${PLATFORM_FLOOR_TEXT}`;
    if (markup === null) errors.defaultMarkup = "请填百分比，最多两位小数，例如 10";
    else if (floor !== null && markup < floor) errors.defaultMarkup = "默认加价比例不能低于加价下限";
    if (band === null || band > 500) errors.band = "价格带要在 0% 到 5% 之间";
    if (!margin.ok) errors.minMargin = margin.message;
  }
  if (Object.keys(errors).length > 0 || form.type === null) return { errors, body: null };
  const text = (value: string): string | null => (value.trim() === "" ? null : value.trim());
  return {
    errors,
    body: {
      name: form.name.trim(),
      type: form.type,
      settle_currency: form.settleCurrency,
      company: text(form.company),
      contact_name: text(form.contactName),
      contact_email: text(form.contactEmail),
      contact_phone: text(form.contactPhone),
      contract_ref: text(form.contractRef),
      notes: text(form.notes),
      payment_mode: form.paymentMode,
      credit_limit: credit !== null && credit.ok ? credit.minor : null,
      show_tenant_after_pay: form.showTenantAfterPay,
      scope: { tenant_scope: form.tenantScope, tenant_ids: form.tenantScope === "all" ? [] : form.tenantIds, city_ids: form.allCities ? null : form.cityIds, categories: form.categories },
      pricing: { default_markup_bp: markup ?? 0, markup_floor_bp: floor ?? 0, band_bp: band ?? 0, min_margin: margin.ok ? margin.minor : 0, sell_rounding: {} },
    },
  };
}

function ChannelForm({ initial, withPricing, submitLabel, onSubmit, cancelTo }: { initial: ChannelFormValue; withPricing: boolean; submitLabel: string; onSubmit(body: ChannelCreate): Promise<string | null>; cancelTo: string }) {
  const navigate = useNavigate();
  const canSeeTenants = usePlatformCan("tenant.read");
  const tenants = useLoad<{ items: Tenant[]; truncated: boolean }>("channel-form-tenants", canSeeTenants ? listAllTenants : null);
  const cities = useAllCities();
  const [form, setForm] = useState<ChannelFormValue>(initial);
  const [attempted, setAttempted] = useState(false);
  const [server, setServer] = useState<FormErrors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const reading = readForm(form, withPricing);
  const errors: FormErrors = { ...(attempted ? reading.errors : {}), ...server };
  const errorOf = (key: keyof FormErrors): string[] => (errors[key] ? [errors[key] as string] : []);
  const change = (changes: Partial<ChannelFormValue>): void => {
    setForm((current) => ({ ...current, ...changes }));
    setServer({});
  };
  const tenantOptions = useMemo(() => (tenants.state.data?.items ?? []).map((tenant) => ({ value: tenant.id, label: tenant.status === "suspended" ? `${tenant.name}（已暂停）` : tenant.name })), [tenants.state.data]);
  const cityOptions = useMemo(() => cityChoices((cities.state.data ?? []).filter((city) => city.status === "active" || form.cityIds.includes(city.id))), [cities.state.data, form.cityIds]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (working) return;
    setAttempted(true);
    setProblem(null);
    if (reading.body === null) return;
    setWorking(true);
    try {
      const failure = await onSubmit(reading.body);
      if (failure !== null) setProblem(failure);
    } catch (err) {
      if (err instanceof ApiError && err.code === "CHANNEL_NAME_TAKEN") setServer({ name: "已经有同名的渠道了，请换一个名字" });
      else if (err instanceof ApiError && err.code === "VALIDATION_FAILED") {
        const placed: FormErrors = {};
        for (const issue of serverIssues(err)) {
          const key: keyof FormErrors | null = issue.path.startsWith("/scope/tenant_ids") ? "tenantIds" : issue.path.startsWith("/scope/city_ids") ? "cityIds" : issue.path === "/name" ? "name" : issue.path.includes("markup_floor") ? "floor" : issue.path.includes("default_markup") ? "defaultMarkup" : issue.path.includes("band") ? "band" : issue.path.includes("min_margin") ? "minMargin" : null;
          if (key !== null && placed[key] === undefined) placed[key] = issue.message;
        }
        setServer(placed);
        if (Object.keys(placed).length === 0) setProblem("提交的内容不符合要求，请检查后重试。");
      } else if (err instanceof ApiError && err.code === "VERSION_CONFLICT") setProblem("这个渠道刚被别人改过。请刷新页面，按最新的内容再改一次。");
      else if (err instanceof ApiError && err.status === 403) setProblem("你没有权限修改渠道。需要的话，请联系管理员开通。");
      else setProblem(failureText(err, submitLabel));
    } finally {
      setWorking(false);
    }
  };

  const text = (id: string, label: string, key: "name" | "company" | "contactName" | "contactEmail" | "contactPhone" | "contractRef", hint?: string, errorKey?: keyof FormErrors) => (
    <TextField key={id} label={label} autoComplete="off" value={form[key]} errors={errorKey ? errorOf(errorKey) : []} {...(hint ? { hint } : {})} onChange={(event) => change({ [key]: event.target.value } as Partial<ChannelFormValue>)} />
  );

  return (
    <form className="form" noValidate onSubmit={(event) => void submit(event)}>
      <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
      <section className="card" aria-labelledby="channel-basic-title">
        <h2 className="card__title" id="channel-basic-title">
          基本信息
        </h2>
        {text("channel-name", "名称", "name", "例如「NOZOMI 官网」。只在运营后台显示。", "name")}
        <RadioGroup legend="类型" name="channel-type" required options={(["own", "api", "ota", "offline"] as const).map((value) => ({ value, label: CHANNEL_TYPE_NAMES[value], hint: CHANNEL_TYPE_HINTS[value] }))} value={form.type} errors={errorOf("type")} onChange={(value: ChannelType) => change({ type: value })} />
        <SelectField label="结算币种" value={form.settleCurrency} options={CURRENCY_OPTIONS} onChange={(value) => change({ settleCurrency: value })} />
        <p className="field__hint">渠道和平台对账用的币种。客人下单的币种不受限，每次询价都可以指定。</p>
        {text("channel-company", "公司（选填）", "company")}
        {text("channel-contact", "联系人（选填）", "contactName")}
        {text("channel-email", "联系邮箱（选填）", "contactEmail", undefined, "contactEmail")}
        {text("channel-phone", "联系电话（选填）", "contactPhone")}
        {text("channel-contract", "合同编号（选填）", "contractRef")}
        <RadioGroup legend="付款方式" name="channel-payment" options={[{ value: "prepaid", label: "预付款", hint: "下单时扣余额" }, { value: "credit", label: "信用额度", hint: "月结" }]} value={form.paymentMode} onChange={(value: "prepaid" | "credit") => change({ paymentMode: value })} hint="现在只记下来；下单功能上线后才按它扣款和拦单。" />
        <TextField label={`额度（${form.settleCurrency}，选填）`} inputMode="decimal" autoComplete="off" value={form.creditLimit} errors={errorOf("creditLimit")} onChange={(event) => change({ creditLimit: event.target.value })} />
        <CheckboxGroup legend="付款后展示中标供应商的名字" name="channel-show-tenant" options={[{ value: "yes", label: "展示（默认）" }]} value={form.showTenantAfterPay ? ["yes"] : []} onChange={(value) => change({ showTenantAfterPay: value.length > 0 })} hint="付款之前一律不展示。" />
      </section>
      <section className="card" aria-labelledby="channel-scope-title">
        <h2 className="card__title" id="channel-scope-title">
          授权范围
        </h2>
        <RadioGroup legend="可卖的供应商" name="channel-tenant-scope" options={(["all", "allow", "deny"] as const).map((value) => ({ value, label: TENANT_SCOPE_NAMES[value] }))} value={form.tenantScope} onChange={(value: TenantScope) => change({ tenantScope: value })} />
        {form.tenantScope !== "all" &&
          (tenants.state.data === null ? (
            tenants.state.status === "loading" && canSeeTenants ? <Skeleton lines={["control"]} /> : <Alert kind="warning">供应商名单没有加载出来，请刷新页面重试。</Alert>
          ) : (
            <CheckboxGroup legend={form.tenantScope === "allow" ? "只卖这些供应商" : "不卖这些供应商"} name="channel-tenants" options={tenantOptions} value={form.tenantIds} errors={errorOf("tenantIds")} onChange={(value) => change({ tenantIds: value })} />
          ))}
        <RadioGroup legend="可卖的城市" name="channel-city-scope" options={[{ value: "all", label: "全部城市" }, { value: "listed", label: "只卖选中的城市" }]} value={form.allCities ? "all" : "listed"} onChange={(value: "all" | "listed") => change({ allCities: value === "all" })} />
        {!form.allCities && (
          <MultiCombobox
            label="城市"
            required
            options={cityOptions}
            value={form.cityIds}
            placeholder="输入城市名称或编码查找"
            emptyText="平台还没有启用中的城市"
            allChosenText="启用中的城市都已经选上了"
            loading={cities.state.data === null && cities.state.status === "loading"}
            loadFailed={cities.state.data === null && cities.state.status === "error"}
            errors={errorOf("cityIds")}
            hint="按国家分组、按名称排。可以连着选几个；选错了点标签上的 × 去掉。"
            onChange={(value) => change({ cityIds: value })}
          />
        )}
        <CheckboxGroup legend="可卖的品类" name="channel-categories" required options={SERVICE_CATEGORIES.map((value) => ({ value, label: SERVICE_CATEGORY_NAMES[value] }))} value={form.categories} errors={errorOf("categories")} onChange={(value) => change({ categories: value })} />
      </section>
      {withPricing && (
        <section className="card" aria-labelledby="channel-pricing-title">
          <h2 className="card__title" id="channel-pricing-title">
            定价参数
          </h2>
          <p className="page-intro">{`对外价 = 结算价 ×（1 + 加价比例），加价比例不低于下限；平台下限是 ${PLATFORM_FLOOR_TEXT}。建好以后再改这几项，要另一位同事审核批准才生效。更细的按供应商、城市、车型组的比例在详情页的「加价规则」里加。`}</p>
          <TextField label="默认加价比例（%）" inputMode="decimal" autoComplete="off" value={form.defaultMarkup} errors={errorOf("defaultMarkup")} onChange={(event) => change({ defaultMarkup: event.target.value })} hint="没有命中任何加价规则时用它。" />
          <TextField label="加价下限（%）" inputMode="decimal" autoComplete="off" value={form.floor} errors={errorOf("floor")} onChange={(event) => change({ floor: event.target.value })} hint={`不能低于 ${PLATFORM_FLOOR_TEXT}；低于下限的加价规则系统不允许保存。`} />
          <TextField label="价格带 δ（%）" inputMode="decimal" autoComplete="off" value={form.band} errors={errorOf("band")} onChange={(event) => change({ band: event.target.value })} hint="0% 到 5%：和最低价相差这么多以内的，评分高的中标。" />
          <TextField label={`最低毛利（${form.settleCurrency}，选填）`} inputMode="decimal" autoComplete="off" value={form.minMargin} errors={errorOf("minMargin")} onChange={(event) => change({ minMargin: event.target.value })} hint="每单加价部分不足这个数时补到这个数。不填就是不设。" />
        </section>
      )}
      <div className="form-bar">
        <Button variant="text" disabled={working} onClick={() => void navigate(cancelTo)}>
          取消
        </Button>
        <Button variant="primary" type="submit" loading={working} loadingText={`${submitLabel}中…`}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

// ───────────── 新建 ─────────────

export function ChannelNewPage() {
  const { portal, account, token, handleAuthFailure } = usePortalSession();
  useDocumentTitle(`新建渠道 · NOZOMI ${portal.name}`);
  const canManage = usePlatformCan("channel.manage");
  const scopeDeniesCreate = usePlatformScopeDenies("channel.create");
  const navigate = useNavigate();
  const toast = useToast();
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="新建渠道" trail={[{ label: "渠道", to: CHANNELS_PAGE_PATH }]}>
      <Page title="新建渠道" width="form">
        {content}
      </Page>
    </AppShell>
  );
  if (account.status === "ready" && !canManage) return shell(NO_ACCESS);
  if (account.status === "ready" && scopeDeniesCreate) return shell(<StateBlock tone="neutral" title="不能新建渠道" description={CREATE_SCOPE_DENIED} action={<LinkButton variant="secondary" to={CHANNELS_PAGE_PATH}>回渠道列表</LinkButton>} />);
  return shell(
    <>
      <ChannelForm
        initial={emptyForm()}
        withPricing
        submitLabel="新建"
        cancelTo={CHANNELS_PAGE_PATH}
        onSubmit={async (body) => {
          try {
            const created = await createChannel(token, body);
            toast(`已新建渠道「${created.channel.name}」，状态是「测试」`);
            void navigate(channelPath(created.channel.id), { replace: true });
            return null;
          } catch (err) {
            if (handleAuthFailure(err)) return null;
            throw err;
          }
        }}
      />
      <Attributions sources={placeSources(false)} />
    </>,
  );
}

// ───────────── 编辑基本信息和授权范围 ─────────────

export function ChannelEditPage() {
  const { id = "" } = useParams();
  const { portal, account, token, handleAuthFailure } = usePortalSession();
  const canManage = usePlatformCan("channel.manage");
  const valid = UUID_PATTERN.test(id);
  const loaded = useLoad(`platform-channel-edit:${id}`, canManage && valid ? (session) => getChannel(session, id) : null);
  const navigate = useNavigate();
  const toast = useToast();
  const channel = loaded.state.data?.channel ?? null;
  useDocumentTitle(`编辑渠道 · NOZOMI ${portal.name}`);
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="编辑渠道" trail={[{ label: "渠道", to: CHANNELS_PAGE_PATH }, ...(channel ? [{ label: channel.name, to: channelPath(channel.id) }] : [])]}>
      <Page title="编辑基本信息和授权范围" width="form">
        {content}
      </Page>
    </AppShell>
  );
  if (account.status === "ready" && !canManage) return shell(NO_ACCESS);
  if (!valid || loaded.state.status === "not-found") return shell(<StateBlock tone="neutral" title="找不到这个渠道" description="链接可能有误。" action={<LinkButton variant="primary" to={CHANNELS_PAGE_PATH}>回到渠道列表</LinkButton>} />);
  if (channel === null) return shell(loaded.state.status === "error" ? <StateBlock title="加载失败" description="请检查网络后重试。" action={<Button variant="secondary" onClick={loaded.reload}>重试</Button>} /> : <Skeleton lines={["medium", "long", "long"]} />);
  return shell(
    <>
      <Alert kind="info">定价参数和状态不在这里改：在详情页「申请修改定价参数」「申请暂停」，另一位同事批准后生效。</Alert>
      <ChannelForm
        initial={formOf(channel)}
        withPricing={false}
        submitLabel="保存"
        cancelTo={channelPath(channel.id)}
        onSubmit={async (body) => {
          try {
            const { pricing: _pricing, ...profile } = body;
            await updateChannel(token, channel.id, channel.version, profile);
            toast("已保存");
            void navigate(channelPath(channel.id), { replace: true });
            return null;
          } catch (err) {
            if (handleAuthFailure(err)) return null;
            throw err;
          }
        }}
      />
      <Attributions sources={placeSources(false)} />
    </>,
  );
}

// ───────────── 详情 ─────────────

export function ChannelDetailPage() {
  const { id = "" } = useParams();
  const { portal, account } = usePortalSession();
  const canRead = usePlatformCan("channel.read");
  const valid = UUID_PATTERN.test(id);
  const loaded = useLoad(`platform-channel:${id}`, canRead && valid ? (token) => getChannel(token, id) : null);
  const detail = loaded.state.data;
  useDocumentTitle(detail ? `${detail.channel.name} · 渠道 · NOZOMI ${portal.name}` : `渠道 · NOZOMI ${portal.name}`);
  const shell = (content: ReactNode, title: ReactNode = "渠道", meta?: ReactNode): ReactNode => (
    <AppShell pageName={detail?.channel.name ?? "渠道"} trail={[{ label: "渠道", to: CHANNELS_PAGE_PATH }]}>
      <Page title={title} {...(meta ? { meta } : {})}>
        {content}
      </Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);
  if (!valid || loaded.state.status === "not-found") return shell(<section className="card"><StateBlock tone="neutral" title="找不到这个渠道" description="链接可能有误。" action={<LinkButton variant="primary" to={CHANNELS_PAGE_PATH}>回到渠道列表</LinkButton>} /></section>);
  if (!detail) return shell(<section className="card">{loaded.state.status === "error" || loaded.state.status === "forbidden" ? <StateBlock title="加载失败" description="请检查网络后重试。" action={<Button variant="secondary" onClick={loaded.reload}>重试</Button>} /> : <Skeleton lines={["medium", "long", "long", "short"]} />}</section>);
  const channel = detail.channel;
  return shell(
    <>
      <ChannelDetailSections detail={detail} onChanged={loaded.reload} onReplace={loaded.set} />
      <Attributions sources={placeSources(false)} />
    </>,
    channel.name,
    <StatusBadge {...CHANNEL_STATUS_BADGES[channel.status]} />,
  );
}
