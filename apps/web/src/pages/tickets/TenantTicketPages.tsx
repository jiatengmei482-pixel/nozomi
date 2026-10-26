/**
 * 供应商后台「工单」（M4-03；接口 M4-02，ADR 0034；页面说明 docs/design/pages/platform-tickets.md 第 6 节）：
 * - 列表（`ticket.read`：管理员、调度、财务、只读）：和自己有关的工单（客人投诉、no-show 审核、履约失败、自己发起的失物和申诉）；
 * - 详情：工单、和平台的对话、判定、记下的应扣款项；`ticket.manage`（管理员、调度、财务）能回复、对不利的判定申诉（判定后 7 天内，一次）；
 * - 发起（`ticket.manage`）：从订单详情进来，就这一单登记失物招领或其他。
 * 规则 4：这里只显示接口给的——没有对外价、加价比例、客人那边的赔付金额、内部备注、平台员工是谁；页面不从别处拼。
 */
import { TICKET_STATUSES, type TicketStatus } from "@nozomi/domain";
import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ApiError } from "../../api/client.ts";
import type { ListPage } from "../../api/dispatch.ts";
import { type TenantTicket, type TenantTicketDetail, createTenantTicket, getTenantTicket, listTenantTickets, replyTenantTicket } from "../../api/order-center.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button, LinkButton } from "../../components/Button.tsx";
import { type Column, CursorPagination, DataTable } from "../../components/DataTable.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { RadioGroup, SelectField } from "../../components/FormFields.tsx";
import { Icon } from "../../components/Icon.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { TextAreaField } from "../../components/TextAreaField.tsx";
import { TextField } from "../../components/TextField.tsx";
import { useToast } from "../../components/Toast.tsx";
import { orderPath } from "../../lib/dispatch-display.ts";
import { failureText } from "../../lib/failure.ts";
import { formatLocalDateTime } from "../../lib/master-display.ts";
import { LIABLE_PARTY_NAMES, PRIORITY_BADGES, TENANT_TICKETS_PAGE, TICKET_SOURCE_NAMES, TICKET_STATUS_BADGES, authorText, moneyLabel, outcomeName, tenantTicketPath, ticketTypeName } from "../../lib/order-center-display.ts";
import { DEDUCTION_STATUS_BADGES, DEDUCTIONS_PATH, deductionBasisText, deductionKindName } from "../../lib/rescue-display.ts";
import { pageSizeOf, useCursorPages } from "../../lib/use-cursor-pages.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { useTenantCan } from "../../lib/use-master-access.ts";
import { Detail, LocalTime, NO_ACCESS, tableStateOf, uuidOrNull } from "../platform/order-center-parts.tsx";

const NO_NAMES: ReadonlyMap<string, string> = new Map();

function statusFilterOf(value: string | null): "active" | "all" | TicketStatus {
  return value === "all" || (TICKET_STATUSES as readonly string[]).includes(value ?? "") ? (value as "all" | TicketStatus) : "active";
}

/** 判定后还能申诉：对你们不利的判定才有期限（`appeal_until`），7 天内、还没申诉过。 */
function appealOpen(detail: TenantTicketDetail, now: Date): boolean {
  return detail.ticket.appeal_until !== null && detail.appeal === null && new Date(detail.ticket.appeal_until).getTime() >= now.getTime();
}

export function TenantTicketListPage() {
  const { portal, account } = usePortalSession();
  useDocumentTitle(`工单 · NOZOMI ${portal.name}`);
  const canRead = useTenantCan("ticket.read");
  const [params, setParams] = useSearchParams();
  const status = statusFilterOf(params.get("status"));
  const orderId = uuidOrNull(params.get("order"));
  const pageSize = pageSizeOf(params.get("size"));
  const filterKey = JSON.stringify(["tenant-tickets", status, orderId, pageSize]);
  const pages = useCursorPages(filterKey);
  const { state, reload } = useLoad<ListPage<TenantTicket>>(`${filterKey}|${pages.cursor ?? ""}`, canRead ? (t) => listTenantTickets(t, { limit: pageSize, ...(status === "all" ? {} : { status }), ...(orderId === null ? {} : { order_id: orderId }), ...(pages.cursor === null ? {} : { cursor: pages.cursor }) }) : null);
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="工单">
      <Page title="工单">{content}</Page>
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
  const filtered = params.has("status") || orderId !== null;
  const clear = (): void => setParam({ status: null, order: null });
  const columns: Column<TenantTicket>[] = [
    {
      key: "no",
      header: "工单",
      wrap: true,
      cell: (row) => (
        <span className="table__names">
          <Link className="link mono" to={tenantTicketPath(row.id)}>
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
        const waiting = row.status === "awaiting_tenant" && row.tenant_replied_at === null;
        return (
          <span className="badge-row">
            <StatusBadge {...(waiting ? { tone: "warning" as const, label: "等你们回复" } : TICKET_STATUS_BADGES[row.status])} />
            {priority !== null && <StatusBadge {...priority} />}
          </span>
        );
      },
    },
    { key: "order", header: "订单号", cardLabel: true, cell: (row) => <Link className="link mono" to={orderPath(row.order.id)}>{row.order.order_no}</Link> },
    { key: "due", header: "回复期限", cardLabel: true, cell: (row) => (row.status === "awaiting_tenant" ? <LocalTime iso={row.tenant_reply_due_at} /> : "—") },
    { key: "created", header: "创建时间", cell: (row) => <span className="table__muted"><LocalTime iso={row.created_at} /></span> },
  ];
  const empty = filtered ? (
    <StateBlock tone="neutral" title="没有符合条件的工单" description="换个条件试试，或清空筛选。" action={<Button variant="secondary" onClick={clear}>清空筛选</Button>} />
  ) : (
    <StateBlock tone="neutral" title="还没有工单" description="客人投诉、no-show 审核、履约问题会以工单的形式出现在这里；平台征求你们意见时要在 24 小时内回复。失物招领可以在订单详情里发起。" />
  );
  const data = state.data;
  return shell(
    <>
      <p className="page__lead">平台征求你们意见的工单要在 24 小时内回复并说明情况，超时视为认可。对你们不利的判定，判定后 7 天内可以申诉一次，由另一位平台员工复核。</p>
      <div className="filter-bar" role="search">
        <SelectField inline label="状态" value={status} options={(["active", "all", ...TICKET_STATUSES] as const).map((value) => ({ value, label: value === "active" ? "没有结论的" : value === "all" ? "全部" : TICKET_STATUS_BADGES[value].label }))} onChange={(value) => setParam({ status: value === "active" ? null : value })} />
        {orderId !== null && (
          <span className="filter-chip">
            <span className="filter-chip__text">只看一张订单的</span>
            <button type="button" className="filter-chip__remove" aria-label="去掉条件「只看一张订单的」" onClick={() => setParam({ order: null })}>
              <Icon name="x" />
            </button>
          </span>
        )}
        {filtered && (
          <Button variant="text" size="sm" onClick={clear}>
            清空筛选
          </Button>
        )}
      </div>
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

/** 申诉：写清楚为什么不同意；建一张「供应商申诉」工单，由另一位平台员工复核。 */
function AppealDialog({ detail, onClose, onDone }: { detail: TenantTicketDetail; onClose(): void; onDone(created: TenantTicketDetail): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ text: string; final: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const submit = async (): Promise<void> => {
    if (reason.trim() === "") {
      setError("请写为什么不同意这个判定，附上能说明情况的事实");
      field.current?.focus();
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      onDone(await createTenantTicket(token, { type: "tenant_appeal", order_id: null, parent_ticket_id: detail.ticket.id, subject: `对工单 ${detail.ticket.ticket_no} 的判定申诉`, description: reason.trim() }));
    } catch (err) {
      if (handleAuthFailure(err)) return;
      const final = err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429 && err.code !== "VALIDATION_FAILED";
      setProblem({ text: final ? failureText(err, "申诉") : `${failureText(err, "申诉")}你写的内容还在。`, final });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      title="对这个判定申诉"
      size="form"
      busy={busy}
      dismissOnBackdrop={false}
      onClose={onClose}
      footer={
        <>
          <Button variant="text" data-autofocus={problem?.final ? true : undefined} disabled={busy} onClick={onClose}>
            {problem?.final ? "知道了" : "取消"}
          </Button>
          {!problem?.final && (
            <Button variant="primary" loading={busy} loadingText="提交中…" onClick={() => void submit()}>
              提交申诉
            </Button>
          )}
        </>
      }
    >
      <div role="alert">{problem !== null && <Alert kind="danger">{problem.text}</Alert>}</div>
      {!problem?.final && (
        <>
          <p>{`每张判定只能申诉一次（判定后 7 天内，到 ${formatLocalDateTime(detail.ticket.appeal_until ?? "")}）。由另一位平台员工复核；申诉成立的，这张工单记下的应扣款项全部免除、评分里的记录撤销。`}</p>
          <TextAreaField ref={field} label="为什么不同意" required maxLength={4000} rows={5} value={reason} readOnly={busy} errors={error === null ? [] : [error]} onChange={(event) => setReason(event.target.value)} hint="如「司机 10:02 已到达，见到达屏照片和定位；客人 10:40 才出现」" />
        </>
      )}
    </Dialog>
  );
}

export function TenantTicketDetailPage() {
  const { id = "" } = useParams();
  const { portal, account, token, handleAuthFailure } = usePortalSession();
  const canRead = useTenantCan("ticket.read");
  const canManage = useTenantCan("ticket.manage");
  const canOrders = useTenantCan("order.read");
  const toast = useToast();
  const navigate = useNavigate();
  const { state, reload, set } = useLoad<TenantTicketDetail>(`tenant-ticket|${id}`, canRead ? (t) => getTenantTicket(t, id) : null);
  const [reply, setReply] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [appealing, setAppealing] = useState(false);
  const detail = state.data;
  const title = detail === null || detail === undefined ? "工单" : `工单 ${detail.ticket.ticket_no}`;
  useDocumentTitle(`${title} · NOZOMI ${portal.name}`);
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName={title} trail={[{ label: "工单", to: TENANT_TICKETS_PAGE }]}>
      <Page title={title}>{content}</Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);
  if (state.status === "not-found") return shell(<StateBlock tone="neutral" title="找不到这张工单" description="可能是链接写错了，或这张工单和你们无关。" />);
  if (detail === null || detail === undefined) {
    return shell(state.status === "error" ? <StateBlock title="加载失败" description="请检查网络后重试。" action={<Button variant="secondary" onClick={reload}>重试</Button>} /> : <Skeleton lines={["medium", "long", "long"]} />);
  }
  const { ticket } = detail;
  const active = ticket.status === "open" || ticket.status === "awaiting_tenant" || ticket.status === "in_progress";
  const waiting = ticket.status === "awaiting_tenant" && ticket.tenant_replied_at === null;
  const send = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (reply.trim() === "") {
      setReplyError("请写回复的内容");
      return;
    }
    setSending(true);
    setReplyError(null);
    try {
      set(await replyTenantTicket(token, ticket.id, reply.trim()));
      setReply("");
      toast("已回复平台");
    } catch (err) {
      if (!handleAuthFailure(err)) setReplyError(err instanceof ApiError && err.status < 500 && err.code !== "VALIDATION_FAILED" ? err.message : `${failureText(err, "回复")}你写的内容还在。`);
    } finally {
      setSending(false);
    }
  };
  return shell(
    <>
      {waiting && (
        <Alert kind="warning">
          <strong className="alert__title">平台在等你们回复</strong>
          <span>{`请在 ${formatLocalDateTime(ticket.tenant_reply_due_at ?? "")} 之前回复并说明情况；超时视为认可。`}</span>
        </Alert>
      )}
      {appealOpen(detail, new Date()) && (
        <Alert kind="info">
          <strong className="alert__title">这个判定对你们不利，可以申诉一次</strong>
          <span>{`判定后 7 天内（到 ${formatLocalDateTime(ticket.appeal_until ?? "")}）。`}</span>
        </Alert>
      )}
      <div className="detail-layout">
        <div className="detail-layout__main">
          <section className="card" aria-labelledby="tenant-ticket-summary">
            <div className="card__title-row">
              <h2 className="card__title" id="tenant-ticket-summary">
                {ticket.subject}
              </h2>
              <StatusBadge {...(waiting ? { tone: "warning" as const, label: "等你们回复" } : TICKET_STATUS_BADGES[ticket.status])} />
            </div>
            <p className="prewrap">{ticket.description}</p>
            <dl className="details">
              <Detail label="类型">{ticketTypeName(ticket.type)}</Detail>
              <Detail label="谁提出的">{TICKET_SOURCE_NAMES[ticket.source]}</Detail>
              <Detail label="订单">{canOrders ? <Link className="link mono" to={orderPath(ticket.order.id)}>{ticket.order.order_no}</Link> : <span className="mono">{ticket.order.order_no}</span>}</Detail>
              <Detail label="创建时间">
                <LocalTime iso={ticket.created_at} />
              </Detail>
              {ticket.parent_ticket_id !== null && (
                <Detail label="申诉的是">
                  <Link className="link" to={tenantTicketPath(ticket.parent_ticket_id)}>
                    原来的工单
                  </Link>
                </Detail>
              )}
            </dl>
          </section>
          <section className="card" aria-labelledby="tenant-ticket-messages">
            <h2 className="card__title" id="tenant-ticket-messages">
              和平台的对话
            </h2>
            {detail.messages.length === 0 ? (
              <p className="table__muted">还没有对话。</p>
            ) : (
              <ol className="thread">
                {detail.messages.map((message) => (
                  <li key={message.id} className="thread__item">
                    <span className="thread__meta">
                      <span>{authorText(message, NO_NAMES, "tenant")}</span>
                      <LocalTime iso={message.created_at} />
                    </span>
                    <p className="thread__body">{message.body}</p>
                  </li>
                ))}
              </ol>
            )}
            {canManage && active && (
              <form className="form" onSubmit={(event) => void send(event)} noValidate>
                <TextAreaField label="回复平台" maxLength={4000} rows={4} value={reply} readOnly={sending} errors={replyError === null ? [] : [replyError]} onChange={(event) => setReply(event.target.value)} hint="说明当时的情况；司机的到达屏、举牌、联系记录照片在订单详情的「证据」里，平台看得到。" />
                <div className="action-row">
                  <Button type="submit" variant="primary" loading={sending} loadingText="发送中…">
                    回复
                  </Button>
                </div>
              </form>
            )}
            {!canManage && active && <p className="table__muted">你可以查看，但没有回复工单的权限。</p>}
          </section>
        </div>
        <aside className="detail-layout__aside" aria-label="判定">
          <section className="card" aria-labelledby="tenant-ticket-decision">
            <h2 className="card__title" id="tenant-ticket-decision">
              判定
            </h2>
            {ticket.outcome === null ? (
              <p className="table__muted">还没有判定。</p>
            ) : (
              <dl className="details">
                <Detail label="结论">{outcomeName(ticket.type, ticket.outcome)}</Detail>
                {ticket.liable_party !== null && <Detail label="责任方">{ticket.liable_party === "tenant" ? "你们" : LIABLE_PARTY_NAMES.platform}</Detail>}
                <Detail label="判定时间">
                  <LocalTime iso={ticket.decided_at} />
                </Detail>
                {ticket.decision_note !== null && (
                  <Detail label="说明">
                    <span className="prewrap">{ticket.decision_note}</span>
                  </Detail>
                )}
                {ticket.appeal_until !== null && (
                  <Detail label="可以申诉到">
                    <LocalTime iso={ticket.appeal_until} />
                  </Detail>
                )}
              </dl>
            )}
            {detail.appeal !== null && (
              <p>
                {"已申诉："}
                <Link className="link mono" to={tenantTicketPath(detail.appeal.id)}>
                  {detail.appeal.ticket_no}
                </Link>
                {`（${TICKET_STATUS_BADGES[detail.appeal.status].label}${detail.appeal.outcome === null ? "" : `，${outcomeName("tenant_appeal", detail.appeal.outcome)}`}）`}
              </p>
            )}
            {canManage && appealOpen(detail, new Date()) && (
              <div className="action-row">
                <Button onClick={() => setAppealing(true)}>申诉</Button>
              </div>
            )}
          </section>
          {detail.deductions.length > 0 && (
            <section className="card" aria-labelledby="tenant-ticket-deductions">
              <h2 className="card__title" id="tenant-ticket-deductions">
                你们承担的款项
              </h2>
              <ul className="plain-list">
                {detail.deductions.map((deduction) => (
                  <li key={deduction.id}>
                    <span className="badge-row">
                      <span>{`${deductionKindName(deduction.kind)} ${moneyLabel(deduction.amount)}`}</span>
                      <StatusBadge {...DEDUCTION_STATUS_BADGES[deduction.status]} />
                    </span>
                    <span className="table__muted">{`${deductionBasisText(deduction.kind, deduction.basis, deduction.amount.currency)}${deduction.waive_reason ? `；免除说明：${deduction.waive_reason}` : ""}`}</span>
                  </li>
                ))}
              </ul>
              <p className="table__muted">
                在账单里扣。全部款项见
                <Link className="link" to={DEDUCTIONS_PATH}>
                  违约金与扣款
                </Link>
                。
              </p>
            </section>
          )}
        </aside>
      </div>
      {appealing && (
        <AppealDialog
          detail={detail}
          onClose={() => {
            setAppealing(false);
            reload();
          }}
          onDone={(created) => {
            setAppealing(false);
            toast(`已提交申诉「${created.ticket.ticket_no}」`);
            void navigate(tenantTicketPath(created.ticket.id));
          }}
        />
      )}
    </>,
  );
}

const TENANT_CREATE_TYPES = ["lost_and_found", "other"] as const;

/** 就一张订单发起工单：失物招领、其他（申诉在要申诉的那张工单里点）。 */
export function TenantTicketNewPage() {
  const { portal, account, token, handleAuthFailure } = usePortalSession();
  useDocumentTitle(`发起工单 · NOZOMI ${portal.name}`);
  const canManage = useTenantCan("ticket.manage");
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const orderId = uuidOrNull(params.get("order"));
  const [type, setType] = useState<(typeof TENANT_CREATE_TYPES)[number] | null>(null);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="发起工单" trail={[{ label: "工单", to: TENANT_TICKETS_PAGE }]}>
      <Page title="发起工单" width="form">
        {content}
      </Page>
    </AppShell>
  );
  if (account.status === "ready" && !canManage) return shell(NO_ACCESS);
  if (orderId === null) return shell(<StateBlock tone="neutral" title="请从订单详情发起" description="工单要绑定一张订单：在订单详情里点「就这一单发起工单」。要对平台的判定申诉，在那张工单里点「申诉」。" action={<LinkButton variant="secondary" to="/orders">去订单</LinkButton>} />);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (type === null) found["type"] = "请选择类型";
    if (subject.trim() === "") found["subject"] = "请写标题";
    if (description.trim() === "") found["description"] = "请写清楚是什么事";
    setErrors(found);
    if (Object.keys(found).length > 0 || type === null) return;
    setBusy(true);
    setProblem(null);
    try {
      const created = await createTenantTicket(token, { type, order_id: orderId, parent_ticket_id: null, subject: subject.trim(), description: description.trim() });
      toast(`已发起工单「${created.ticket.ticket_no}」`);
      void navigate(tenantTicketPath(created.ticket.id));
    } catch (err) {
      if (!handleAuthFailure(err)) setProblem(err instanceof ApiError && err.status === 404 ? "找不到这张订单，或它不是你们的。" : err instanceof ApiError && err.status < 500 && err.code !== "VALIDATION_FAILED" ? err.message : `${failureText(err, "发起工单")}你填写的内容还在。`);
    } finally {
      setBusy(false);
    }
  };
  return shell(
    <form className="form" onSubmit={(event) => void submit(event)} noValidate>
      <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
      <p>
        {"订单："}
        <Link className="link" to={orderPath(orderId)}>
          回到订单详情
        </Link>
      </p>
      <RadioGroup
        legend="类型"
        name="tenant-ticket-type"
        required
        value={type}
        options={[
          { value: "lost_and_found", label: ticketTypeName("lost_and_found"), hint: "客人把东西落在车上：写清楚是什么、现在在哪、怎么归还" },
          { value: "other", label: ticketTypeName("other"), hint: "需要平台跟进的其他事" },
        ]}
        errors={errors["type"] ? [errors["type"]] : []}
        onChange={(value) => setType(value)}
      />
      <TextField label="标题" required maxLength={200} value={subject} errors={errors["subject"] ? [errors["subject"]] : []} onChange={(event) => setSubject(event.target.value)} />
      <TextAreaField label="说明" required maxLength={4000} rows={5} value={description} errors={errors["description"] ? [errors["description"]] : []} onChange={(event) => setDescription(event.target.value)} />
      <div className="form__actions">
        <LinkButton variant="text" to={orderPath(orderId)}>
          取消
        </LinkButton>
        <Button type="submit" variant="primary" loading={busy} loadingText="提交中…">
          发起工单
        </Button>
      </div>
    </form>,
  );
}
