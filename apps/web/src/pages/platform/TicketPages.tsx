/**
 * 运营后台「工单」的列表和新建（M4-03；接口 M4-02，ADR 0034；页面说明 docs/design/pages/platform-tickets.md）。详情在 TicketDetailPage.tsx。
 * - 列表（`ticket.read`）：默认看没有结论的（待处理、等供应商回复、处理中、判定待复核），按创建时间从新到旧；按工单号或订单号找；按类型、状态、处理人、是否超时筛。
 * - 新建（`ticket.manage`）：关联一张订单（从订单详情进来时已经带上；直接打开时按订单号找）；客服代客人、渠道、供应商登记时来源照实选。
 */
import { TICKET_PRIORITIES, TICKET_STATUSES, TICKET_TYPES, type TicketPriority, type TicketStatus, type TicketType } from "@nozomi/domain";
import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ApiError } from "../../api/client.ts";
import type { ListPage } from "../../api/dispatch.ts";
import { type PlatformTicket, type PlatformTicketCreate, createPlatformTicket, listPlatformTickets } from "../../api/order-center.ts";
import { type PlatformOrder, type PlatformOrderDetail, getPlatformOrder, listPlatformOrders } from "../../api/order-money.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button, LinkButton } from "../../components/Button.tsx";
import { type Column, CursorPagination, DataTable } from "../../components/DataTable.tsx";
import { FilterBar, SearchBox, useFilterParam } from "../../components/FilterBar.tsx";
import { RadioGroup, SelectField } from "../../components/FormFields.tsx";
import { Icon } from "../../components/Icon.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { TextAreaField } from "../../components/TextAreaField.tsx";
import { TextField } from "../../components/TextField.tsx";
import { useToast } from "../../components/Toast.tsx";
import { localOffsetLabel } from "../../lib/audit-display.ts";
import { failureText } from "../../lib/failure.ts";
import { OVERDUE_BADGE, PLATFORM_TICKETS_PAGE, PLATFORM_TICKET_NEW_PATH, PRIORITY_BADGES, TICKET_SOURCE_NAMES, TICKET_STATUS_BADGES, colleagueName, platformTicketPath, priorityName, ticketTypeName } from "../../lib/order-center-display.ts";
import { platformOrderPath } from "../../lib/order-money-display.ts";
import { useColleagues } from "../../lib/use-colleagues.ts";
import { pageSizeOf, useCursorPages } from "../../lib/use-cursor-pages.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan } from "../../lib/use-master-access.ts";
import { LocalTime, NO_ACCESS, tableStateOf, uuidOrNull } from "./order-center-parts.tsx";

const STATUS_FILTER_NAMES: Readonly<Record<"active" | "all" | TicketStatus, string>> = { active: "没有结论的", all: "全部", ...Object.fromEntries(TICKET_STATUSES.map((status) => [status, TICKET_STATUS_BADGES[status].label])) } as Record<"active" | "all" | TicketStatus, string>;

function statusFilterOf(value: string | null): "active" | "all" | TicketStatus {
  return value === "all" || (TICKET_STATUSES as readonly string[]).includes(value ?? "") ? (value as "all" | TicketStatus) : "active";
}

function Filters() {
  const [status, setStatus] = useFilterParam("status");
  const [type, setType] = useFilterParam("type");
  const [assignee, setAssignee] = useFilterParam("assignee");
  const [overdue, setOverdue] = useFilterParam("overdue");
  const { active } = useColleagues();
  return (
    <>
      <SelectField inline label="状态" value={statusFilterOf(status)} options={(["active", "all", ...TICKET_STATUSES] as const).map((value) => ({ value, label: STATUS_FILTER_NAMES[value] }))} onChange={(value) => setStatus(value === "active" ? null : value)} />
      <SelectField
        inline
        label="类型"
        value={(TICKET_TYPES as readonly string[]).includes(type ?? "") ? (type as TicketType) : "all"}
        options={[{ value: "all", label: "全部" }, ...TICKET_TYPES.map((value) => ({ value, label: ticketTypeName(value) }))]}
        onChange={(value) => setType(value === "all" ? null : value)}
      />
      <SelectField
        inline
        label="处理人"
        value={assignee === "me" || uuidOrNull(assignee) !== null ? (assignee as string) : "all"}
        options={[{ value: "all", label: "全部" }, { value: "me", label: "我" }, ...active.map((person) => ({ value: person.id, label: person.name }))]}
        onChange={(value) => setAssignee(value === "all" ? null : value)}
      />
      <SelectField inline label="时效" value={overdue === "true" ? "true" : "all"} options={[{ value: "all", label: "全部" }, { value: "true", label: "只看已超时" }]} onChange={(value) => setOverdue(value === "all" ? null : value)} />
    </>
  );
}

export function TicketListPage() {
  const { portal, account } = usePortalSession();
  useDocumentTitle(`工单 · NOZOMI ${portal.name}`);
  const canRead = usePlatformCan("ticket.read");
  const canManage = usePlatformCan("ticket.manage");
  const { names, me } = useColleagues();
  const [params, setParams] = useSearchParams();
  const q = (params.get("q") ?? "").trim().slice(0, 64);
  const status = statusFilterOf(params.get("status"));
  const typeParam = params.get("type");
  const type = (TICKET_TYPES as readonly string[]).includes(typeParam ?? "") ? (typeParam as TicketType) : null;
  const assigneeParam = params.get("assignee");
  const assignee = assigneeParam === "me" ? "me" : uuidOrNull(assigneeParam);
  const overdue = params.get("overdue") === "true";
  const pageSize = pageSizeOf(params.get("size"));
  const filterKey = JSON.stringify(["tickets", q, status, type, assignee, overdue, pageSize]);
  const pages = useCursorPages(filterKey);
  const { state, reload } = useLoad<ListPage<PlatformTicket>>(`${filterKey}|${pages.cursor ?? ""}`, canRead
    ? (token) => listPlatformTickets(token, { limit: pageSize, ...(status === "all" ? {} : { status }), ...(q === "" ? {} : { q }), ...(type === null ? {} : { type }), ...(assignee === null ? {} : { assignee }), ...(overdue ? { overdue: "true" } : {}), ...(pages.cursor === null ? {} : { cursor: pages.cursor }) })
    : null);
  const newButton = (
    <LinkButton variant="primary" to={PLATFORM_TICKET_NEW_PATH}>
      <Icon name="plus" />
      新建工单
    </LinkButton>
  );
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="工单">
      <Page title="工单" {...(canManage ? { action: newButton } : {})}>
        {content}
      </Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);
  const setParam = (changes: Record<string, string | null>): void => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  };
  const filterNames = ["q", "status", "type", "assignee", "overdue"];
  const filtered = filterNames.some((name) => params.has(name));
  const clear = (): void => setParam(Object.fromEntries(filterNames.map((name) => [name, null])));
  const columns: Column<PlatformTicket>[] = [
    {
      key: "no",
      header: "工单",
      wrap: true,
      cell: (row) => (
        <span className="table__names">
          <Link className="link mono" to={platformTicketPath(row.id)}>
            {row.ticket_no}
          </Link>
          <span className="table__muted" title={row.subject}>
            {row.subject}
          </span>
        </span>
      ),
    },
    { key: "type", header: "类型", cell: (row) => <span className="tag">{ticketTypeName(row.type)}</span> },
    {
      key: "status",
      header: "状态",
      cell: (row) => {
        const priority = PRIORITY_BADGES[row.priority];
        return (
          <span className="badge-row">
            <StatusBadge {...TICKET_STATUS_BADGES[row.status]} />
            {priority !== null && <StatusBadge {...priority} />}
            {row.overdue && <StatusBadge {...OVERDUE_BADGE} />}
          </span>
        );
      },
    },
    { key: "order", header: "订单号", cardLabel: true, cell: (row) => <Link className="link mono" to={platformOrderPath(row.order.id)}>{row.order.order_no}</Link> },
    { key: "tenant", header: "供应商", wrap: true, cardLabel: true, cell: (row) => row.tenant.name },
    { key: "assignee", header: "处理人", cardLabel: true, cell: (row) => colleagueName(row.assignee_id, names, me) },
    { key: "due", header: "结案期限", cardLabel: true, cell: (row) => <LocalTime iso={row.resolution_due_at} /> },
    { key: "created", header: "创建时间", cell: (row) => <span className="table__muted"><LocalTime iso={row.created_at} /></span> },
  ];
  const empty = filtered ? (
    <StateBlock tone="neutral" title="没有符合条件的工单" description="换个条件试试，或清空筛选。" action={<Button variant="secondary" onClick={clear}>清空筛选</Button>} />
  ) : (
    <StateBlock tone="success" title="现在没有待处理的工单" description="客人、渠道、供应商提的问题和系统生成的 no-show 审核都会出现在这里。客服也可以从订单详情代客人登记。" {...(canManage ? { action: newButton } : {})} />
  );
  const data = state.data;
  return shell(
    <>
      <p className="page__lead">{`所有需要人来判断的事都走工单。时效：首次响应 2 小时（用车当天的紧急工单 15 分钟），3 个工作日内结案。时间按你的本地时区（${localOffsetLabel()}）显示。`}</p>
      {account.status === "ready" && !canManage && <Alert kind="info">你可以查看工单，但不能处理。</Alert>}
      <FilterBar search={<SearchBox label="按工单号或订单号查找（完整的号）" value={q} onSearch={(value) => setParam({ q: value })} />} paramNames={["status", "type", "assignee", "overdue"]} active={filtered} onClear={clear}>
        <Filters />
      </FilterBar>
      <div className="card-table">
        <DataTable label="工单" columns={columns} rows={data?.items ?? []} rowKey={(row) => row.id} state={tableStateOf(state.status, data !== null)} refreshing={state.status === "loading" && data !== null} onRetry={reload} empty={empty} />
      </div>
      <CursorPagination
        total={data ? data.total : null}
        pageSize={pageSize}
        onPageSizeChange={(size) => setParam({ size: size === 20 ? null : String(size) })}
        hasPrevious={pages.hasPrevious}
        hasNext={state.status === "ready" && state.data.next_cursor !== null}
        busy={state.status === "loading"}
        onPrevious={pages.previous}
        onNext={() => {
          const next = data?.next_cursor;
          if (next) pages.next(next);
        }}
      />
    </>,
  );
}

// ───────────── 新建 ─────────────

const CREATE_TYPES = ["complaint", "fulfilment_failure", "order_change", "lost_and_found", "other"] as const;
const CREATE_TYPE_HINTS: Readonly<Record<(typeof CREATE_TYPES)[number], string>> = {
  complaint: "迟到、未举牌、车况、司机态度等；成立时按统一赔付表赔客人",
  fulfilment_failure: "司机没到、没送到目的地等；成立时按赔付表处理，计入履约失败",
  order_change: "超出自助范围的改单（改单本身在订单详情里做）",
  lost_and_found: "客人把东西落在车上",
  other: "不属于以上任何一类、但要有人跟进的事",
};
const SOURCES = ["platform", "guest", "channel", "tenant"] as const;
const LANGUAGES = [
  { value: "zh", label: "中文" },
  { value: "ja", label: "日语" },
  { value: "en", label: "英语" },
  { value: "ko", label: "韩语" },
] as const;

/** 还没付过款的单不能建工单（后端 409 `ORDER_STATE_INVALID`，`NOT_CONFIRMED`）：查找时、打开时就说清楚。 */
function unpaidTicketText(order: Pick<PlatformOrder, "status" | "confirmed_at">): string | null {
  if (order.confirmed_at !== null) return null;
  return order.status === "pending_payment" ? "这张订单还没付款，付款完成后才能建工单。" : "这张订单没有付过款就取消了，不能建工单。";
}

/** 按订单号找到订单（完整的号），找到了返回编号。 */
function OrderLookup({ onFound }: { onFound(id: string): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const q = text.trim().toUpperCase();
    if (q === "") {
      setProblem("请填订单号");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const page = await listPlatformOrders(token, { q, limit: 1 });
      const found = page.items[0];
      if (found === undefined) setProblem("没有找到这张订单。请核对订单号（平台订单号或渠道订单号，要完整）。");
      else if (unpaidTicketText(found) !== null) setProblem(unpaidTicketText(found));
      else onFound(found.id);
    } catch (err) {
      if (!handleAuthFailure(err)) setProblem(failureText(err, "查找订单"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card" onSubmit={(event) => void submit(event)} noValidate aria-labelledby="ticket-order-lookup">
      <h2 className="card__title" id="ticket-order-lookup">
        先找到订单
      </h2>
      <p>工单一定绑定一张订单。也可以从订单详情点「新建工单」，订单会自动带上。</p>
      <div className="order-search">
        <TextField label="订单号" autoComplete="off" spellCheck={false} value={text} errors={problem === null ? [] : [problem]} onChange={(event) => setText(event.target.value)} hint="平台订单号（NZ 开头）或渠道订单号" />
        <Button type="submit" loading={busy} loadingText="查找中…">
          查找
        </Button>
      </div>
    </form>
  );
}

interface NewTicketForm {
  type: (typeof CREATE_TYPES)[number] | null;
  tenantId: string;
  source: (typeof SOURCES)[number];
  priority: TicketPriority | "auto";
  subject: string;
  description: string;
  language: string;
}

export function TicketNewPage() {
  const { portal, account, token, handleAuthFailure } = usePortalSession();
  useDocumentTitle(`新建工单 · NOZOMI ${portal.name}`);
  const canManage = usePlatformCan("ticket.manage");
  const canReadOrders = usePlatformCan("order.read");
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const orderId = uuidOrNull(params.get("order"));
  const loaded = useLoad<PlatformOrderDetail>(`ticket-new-order|${orderId ?? ""}`, canManage && canReadOrders && orderId !== null ? (t) => getPlatformOrder(t, orderId) : null);
  const [form, setForm] = useState<NewTicketForm>({ type: null, tenantId: "", source: "platform", priority: "auto", subject: "", description: "", language: "" });
  const [errors, setErrors] = useState<Partial<Record<"type" | "subject" | "description", string>>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const typeRef = useRef<HTMLDivElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="新建工单" trail={[{ label: "工单", to: PLATFORM_TICKETS_PAGE }]}>
      <Page title="新建工单" width="form">
        {content}
      </Page>
    </AppShell>
  );
  if (account.status === "ready" && !canManage) return shell(NO_ACCESS);
  if (orderId === null) return shell(<OrderLookup onFound={(id) => setParams({ order: id }, { replace: true })} />);
  if (loaded.state.status === "not-found") return shell(<StateBlock tone="neutral" title="找不到这张订单" description="它可能不在你的数据范围里，或链接有误。" action={<LinkButton variant="secondary" to={PLATFORM_TICKET_NEW_PATH}>按订单号查找</LinkButton>} />);
  const detail = loaded.state.data;
  if (detail === null) {
    return shell(loaded.state.status === "error" ? <StateBlock title="订单没有加载出来" description="请检查网络后重试。" action={<Button variant="secondary" onClick={loaded.reload}>重试</Button>} /> : <Skeleton lines={["medium", "control", "control", "long"]} />);
  }
  const { order } = detail;
  const unpaid = unpaidTicketText(order);
  if (unpaid !== null) return shell(<StateBlock tone="neutral" title="这张订单还不能建工单" description={unpaid} action={<LinkButton variant="secondary" to={platformOrderPath(order.id)}>回到订单</LinkButton>} />);
  // 救援改派过的单：投诉的可能是原来的供应商
  const tenants = [order.tenant, ...detail.rescues.map((rescue) => rescue.original_tenant)].filter((tenant, index, all) => all.findIndex((other) => other.id === tenant.id) === index);
  const update = (patch: Partial<NewTicketForm>): void => setForm({ ...form, ...patch });
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const found: typeof errors = {};
    if (form.type === null) found.type = "请选择工单类型";
    if (form.subject.trim() === "") found.subject = "请写标题";
    if (form.description.trim() === "") found.description = "请写清楚发生了什么";
    setErrors(found);
    if (Object.keys(found).length > 0 || form.type === null) {
      if (found.type !== undefined) typeRef.current?.querySelector("input")?.focus();
      else (found.subject !== undefined ? subjectRef.current : descriptionRef.current)?.focus();
      return;
    }
    const body: PlatformTicketCreate = {
      type: form.type,
      order_id: order.id,
      tenant_id: form.tenantId === "" || form.tenantId === order.tenant.id ? null : form.tenantId,
      source: form.source,
      priority: form.priority === "auto" ? null : form.priority,
      subject: form.subject.trim(),
      description: form.description.trim(),
      language: form.language === "" ? null : form.language,
    };
    setBusy(true);
    setProblem(null);
    try {
      const created = await createPlatformTicket(token, body);
      toast(`已新建工单「${created.ticket.ticket_no}」`);
      void navigate(platformTicketPath(created.ticket.id));
    } catch (err) {
      if (!handleAuthFailure(err)) setProblem(err instanceof ApiError && err.status < 500 && err.code !== "VALIDATION_FAILED" ? err.message : `${failureText(err, "新建工单")}你填写的内容还在。`);
    } finally {
      setBusy(false);
    }
  };
  return shell(
    <form className="form" onSubmit={(event) => void submit(event)} noValidate>
      <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
      <section className="card" aria-labelledby="ticket-new-order">
        <h2 className="card__title" id="ticket-new-order">
          订单
        </h2>
        <p>
          <Link className="link mono" to={platformOrderPath(order.id)}>
            {order.order_no}
          </Link>
          {` · ${order.service_local.replace("T", " ")}（当地）· ${order.tenant.name} · ${order.channel.name}`}
        </p>
      </section>
      <div ref={typeRef}>
        <RadioGroup legend="类型" name="ticket-type" required value={form.type} options={CREATE_TYPES.map((value) => ({ value, label: ticketTypeName(value), hint: CREATE_TYPE_HINTS[value] }))} errors={errors.type === undefined ? [] : [errors.type]} onChange={(value) => update({ type: value })} />
      </div>
      {tenants.length > 1 && <SelectField label="被投诉的供应商" value={form.tenantId === "" ? order.tenant.id : form.tenantId} options={tenants.map((tenant) => ({ value: tenant.id, label: tenant.id === order.tenant.id ? `${tenant.name}（现在的供应商）` : `${tenant.name}（救援改派前的供应商）` }))} onChange={(value) => update({ tenantId: value })} hint="司机未到的投诉常常是对救援改派前的那一家。" />}
      <SelectField label="谁提出的" value={form.source} options={SOURCES.map((value) => ({ value, label: value === "platform" ? "客服自己发现的" : `${TICKET_SOURCE_NAMES[value]}（客服代登记）` }))} onChange={(value) => update({ source: value })} />
      <SelectField label="优先级" value={form.priority} options={[{ value: "auto", label: "按规则（用车当天为紧急）" }, ...TICKET_PRIORITIES.map((value) => ({ value, label: priorityName(value) }))]} onChange={(value) => update({ priority: value })} />
      <TextField ref={subjectRef} label="标题" required maxLength={200} value={form.subject} errors={errors.subject === undefined ? [] : [errors.subject]} onChange={(event) => update({ subject: event.target.value })} hint="一句话说清楚，如「司机迟到 25 分钟」" />
      <TextAreaField ref={descriptionRef} label="经过" required maxLength={4000} rows={5} value={form.description} errors={errors.description === undefined ? [] : [errors.description]} onChange={(event) => update({ description: event.target.value })} hint="客人怎么说的、什么时间、有什么证据。供应商能看到工单的描述。" />
      <SelectField label="客人用什么语言（选填）" value={form.language} options={[{ value: "", label: "不填" }, ...LANGUAGES]} onChange={(value) => update({ language: value })} />
      <div className="form__actions">
        <LinkButton variant="text" to={platformOrderPath(order.id)}>
          取消
        </LinkButton>
        <Button type="submit" variant="primary" loading={busy} loadingText="新建中…">
          新建工单
        </Button>
      </div>
      <p className="table__muted">投诉要在服务结束后 14 天内；客人、渠道每张单最多提 10 张工单。</p>
    </form>,
  );
}
