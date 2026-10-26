/**
 * 运营后台「异常队列」（M4-03；接口 M4-02，ADR 0034；页面说明 docs/design/pages/platform-orders.md 第 3 节）：
 * - 列表（`order.read`）：默认看没关的、按时限从早到晚；按类型、状态、处理人、是否超时筛；每一行点进详情；
 * - 详情：发现时的情况、处理方式、处理人；`exception.manage`（运营、客服、财务）能认领、指派、转交（只有现在的处理人能转交）、写处理说明关闭。
 *   已被别人认领时再认领，后端 409 `EXCEPTION_ALREADY_CLAIMED`：提示条写明谁在处理、请他转交，页面刷新成最新的样子。
 * 处理本身用订单上已有的操作（催供应商、救援、重推、重试退款、审核加收、判 no-show 工单）；这里记谁在处理、什么结论。每一步都写审计日志（`order_exception`）。
 */
import { EXCEPTION_TYPES, type ExceptionType } from "@nozomi/domain";
import { type ReactNode, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ApiError } from "../../api/client.ts";
import type { ListPage } from "../../api/dispatch.ts";
import { type OrderException, claimException, closeException, getException, listExceptions } from "../../api/order-center.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button } from "../../components/Button.tsx";
import { type Column, CursorPagination, DataTable } from "../../components/DataTable.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { FilterBar, useFilterParam } from "../../components/FilterBar.tsx";
import { SelectField } from "../../components/FormFields.tsx";
import { NoteDialog } from "../../components/NoteDialog.tsx";
import { Icon } from "../../components/Icon.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { useToast } from "../../components/Toast.tsx";
import { localOffsetLabel } from "../../lib/audit-display.ts";
import { failureText } from "../../lib/failure.ts";
import { CLOSE_KIND_NAMES, EXCEPTION_QUEUE_PATH, EXCEPTION_STATUS_BADGES, OVERDUE_BADGE, assigneeText, colleagueName, exceptionDetailLines, exceptionPath, exceptionTypeName } from "../../lib/order-center-display.ts";
import { platformOrderPath } from "../../lib/order-money-display.ts";
import { auditLogPath } from "../../lib/platform-paths.ts";
import { useColleagues } from "../../lib/use-colleagues.ts";
import { pageSizeOf, useCursorPages } from "../../lib/use-cursor-pages.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan } from "../../lib/use-master-access.ts";
import { Detail, LocalTime, NO_ACCESS, tableStateOf, uuidOrNull } from "./order-center-parts.tsx";

const TRAIL = [{ label: "异常队列", to: EXCEPTION_QUEUE_PATH }];
const STATUS_FILTERS = { active: "待处理和处理中", open: "待处理", claimed: "处理中", closed: "已关闭" } as const;
type StatusFilter = keyof typeof STATUS_FILTERS;

function statusFilterOf(value: string | null): StatusFilter {
  return value !== null && value in STATUS_FILTERS ? (value as StatusFilter) : "active";
}

function Filters() {
  const [status, setStatus] = useFilterParam("status");
  const [type, setType] = useFilterParam("type");
  const [assignee, setAssignee] = useFilterParam("assignee");
  const [overdue, setOverdue] = useFilterParam("overdue");
  const { active } = useColleagues();
  return (
    <>
      <SelectField inline label="状态" value={statusFilterOf(status)} options={(Object.keys(STATUS_FILTERS) as StatusFilter[]).map((value) => ({ value, label: STATUS_FILTERS[value] }))} onChange={(value) => setStatus(value === "active" ? null : value)} />
      <SelectField
        inline
        label="类型"
        value={(EXCEPTION_TYPES as readonly string[]).includes(type ?? "") ? (type as ExceptionType) : "all"}
        options={[{ value: "all", label: "全部" }, ...EXCEPTION_TYPES.map((value) => ({ value, label: exceptionTypeName(value) }))]}
        onChange={(value) => setType(value === "all" ? null : value)}
      />
      <SelectField
        inline
        label="处理人"
        value={assignee === "me" || uuidOrNull(assignee) !== null ? (assignee as string) : "all"}
        options={[{ value: "all", label: "全部" }, { value: "me", label: "我" }, ...active.map((person) => ({ value: person.id, label: person.name }))]}
        onChange={(value) => setAssignee(value === "all" ? null : value)}
      />
      <SelectField inline label="时限" value={overdue === "true" ? "true" : "all"} options={[{ value: "all", label: "全部" }, { value: "true", label: "只看已超时" }]} onChange={(value) => setOverdue(value === "all" ? null : value)} />
    </>
  );
}

export function ExceptionQueuePage() {
  const { portal, account } = usePortalSession();
  useDocumentTitle(`异常队列 · NOZOMI ${portal.name}`);
  const canRead = usePlatformCan("order.read");
  const { me } = useColleagues();
  const [params, setParams] = useSearchParams();
  const status = statusFilterOf(params.get("status"));
  const typeParam = params.get("type");
  const type = (EXCEPTION_TYPES as readonly string[]).includes(typeParam ?? "") ? (typeParam as ExceptionType) : null;
  const assigneeParam = params.get("assignee");
  const assignee = assigneeParam === "me" ? "me" : uuidOrNull(assigneeParam);
  const overdue = params.get("overdue") === "true";
  // 从订单列表的「异常」一格进来：只看这一单的
  const orderId = uuidOrNull(params.get("order"));
  const pageSize = pageSizeOf(params.get("size"));
  const filterKey = JSON.stringify(["exceptions", status, type, assignee, overdue, orderId, pageSize]);
  const pages = useCursorPages(filterKey);
  const { state, reload } = useLoad<ListPage<OrderException>>(`${filterKey}|${pages.cursor ?? ""}`, canRead ? (token) => listExceptions(token, { status, limit: pageSize, ...(type === null ? {} : { type }), ...(assignee === null ? {} : { assignee }), ...(overdue ? { overdue: "true" } : {}), ...(orderId === null ? {} : { order_id: orderId }), ...(pages.cursor === null ? {} : { cursor: pages.cursor }) }) : null);
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="异常队列">
      <Page title="异常队列">{content}</Page>
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
  const filterNames = ["status", "type", "assignee", "overdue"];
  const filtered = filterNames.some((name) => params.has(name)) || orderId !== null;
  const clear = (): void => setParam(Object.fromEntries([...filterNames, "order"].map((name) => [name, null])));
  const data = state.data;
  const columns: Column<OrderException>[] = [
    {
      key: "type",
      header: "异常",
      cell: (row) => (
        <Link className="link" to={exceptionPath(row.id)}>
          {exceptionTypeName(row.type)}
        </Link>
      ),
    },
    {
      key: "status",
      header: "状态",
      cell: (row) => (
        <span className="badge-row">
          <StatusBadge {...EXCEPTION_STATUS_BADGES[row.status]} />
          {row.overdue && <StatusBadge {...OVERDUE_BADGE} />}
        </span>
      ),
    },
    { key: "order", header: "订单号", cell: (row) => <Link className="link mono" to={platformOrderPath(row.order.id)}>{row.order.order_no}</Link> },
    { key: "tenant", header: "供应商", wrap: true, cell: (row) => row.tenant.name },
    { key: "due", header: "处理时限", cardLabel: true, cell: (row) => <LocalTime iso={row.due_at} /> },
    { key: "assignee", header: "处理人", cardLabel: true, cell: (row) => assigneeText(row.assignee, me) },
    { key: "opened", header: "发现时间", cardLabel: true, cell: (row) => <span className="table__muted"><LocalTime iso={row.opened_at} /></span> },
  ];
  const empty = filtered ? (
    <StateBlock tone="neutral" title="没有符合条件的异常" description="换个条件试试，或清空筛选。" action={<Button variant="secondary" onClick={clear}>清空筛选</Button>} />
  ) : (
    <StateBlock tone="success" title="现在没有要处理的异常" description="系统每分钟检查一次订单：超时未派车、司机未出发或未到达、推送失败、待审核、支付异常等会自动出现在这里，条件解除后自动关闭。" />
  );
  return shell(
    <>
      <p className="page__lead">{`运营每天从这里开始：系统自动发现要人处理的订单，按处理时限从早到晚排。处理本身在订单详情里做（催供应商、救援、重推、重试退款、审核加收）；这里记谁在处理、写什么结论。时间按你的本地时区（${localOffsetLabel()}）显示。`}</p>
      <FilterBar search={null} paramNames={filterNames} active={filtered} onClear={clear}>
        <Filters />
      </FilterBar>
      {orderId !== null && (
        <p className="filter-chips">
          <span className="filter-chip">
            <span className="filter-chip__text">{`订单：${data?.items[0]?.order.order_no ?? "指定的订单"}`}</span>
            <button type="button" className="filter-chip__remove" aria-label="去掉条件「只看这一单」" onClick={() => setParam({ order: null })}>
              <Icon name="x" />
            </button>
          </span>
        </p>
      )}
      <div className="card-table">
        <DataTable label="异常队列" columns={columns} rows={data?.items ?? []} rowKey={(row) => row.id} state={tableStateOf(state.status, data !== null)} refreshing={state.status === "loading" && data !== null} onRetry={reload} empty={empty} />
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

/** 指派 / 转交：从在用的同事里选一位。 */
function AssignDialog({ exception, transfer, onClose, onDone }: { exception: OrderException; transfer: boolean; onClose(): void; onDone(updated: OrderException, text: string): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const { active, me } = useColleagues();
  const [target, setTarget] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const choices = active.filter((person) => person.id !== exception.assignee?.id && !(transfer && person.id === me));
  const submit = async (): Promise<void> => {
    if (target === "") {
      setProblem("请选择交给谁");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const { exception: updated } = await claimException(token, exception.id, target);
      onDone(updated, `已交给「${choices.find((person) => person.id === target)?.name ?? "同事"}」`);
    } catch (err) {
      if (!handleAuthFailure(err)) setProblem(err instanceof ApiError && err.code === "EXCEPTION_ALREADY_CLAIMED" ? "这条异常已经有别人在处理了，只有他能转交。关掉对话框后页面会刷新。" : failureText(err, "转交"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      title={transfer ? "转交给同事" : "指派给同事"}
      size="form"
      busy={busy}
      dismissOnBackdrop={false}
      onClose={onClose}
      footer={
        <>
          <Button variant="text" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" loading={busy} loadingText="提交中…" onClick={() => void submit()}>
            {transfer ? "转交" : "指派"}
          </Button>
        </>
      }
    >
      <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
      <p>{transfer ? "转交以后由他处理，你不再是处理人。" : "指派以后这条异常算「处理中」，由他处理。"}</p>
      <SelectField label="交给谁" required placeholder="请选择" value={target} options={choices.map((person) => ({ value: person.id, label: person.name }))} onChange={setTarget} hint="只列在用的平台员工；对方要有处理异常的权限才能关闭它。" />
    </Dialog>
  );
}

export function ExceptionDetailPage() {
  const { id = "" } = useParams();
  const { portal, account, token, handleAuthFailure } = usePortalSession();
  const canRead = usePlatformCan("order.read");
  const canManage = usePlatformCan("exception.manage");
  const canAudit = usePlatformCan("audit_log.read");
  const toast = useToast();
  const { names, me } = useColleagues();
  const { state, reload, set } = useLoad<{ exception: OrderException }>(`exception|${id}`, canRead ? (t) => getException(t, id) : null);
  const [dialog, setDialog] = useState<"close" | "assign" | "transfer" | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const exception = state.data?.exception ?? null;
  const title = exception === null ? "异常" : exceptionTypeName(exception.type);
  useDocumentTitle(`${title} · 异常队列 · NOZOMI ${portal.name}`);
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName={title} trail={TRAIL}>
      <Page title={title}>{content}</Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);
  if (state.status === "not-found") return shell(<StateBlock tone="neutral" title="找不到这条异常" description="它可能不在你的数据范围里，或链接有误。" />);
  if (exception === null) {
    return shell(
      state.status === "error" ? (
        <StateBlock title="加载失败" description="请检查网络后重试。" action={<Button variant="secondary" onClick={reload}>重试</Button>} />
      ) : (
        <Skeleton lines={["medium", "long", "long", "short"]} />
      ),
    );
  }
  const closed = exception.status === "closed";
  const mine = exception.assignee?.id === me;
  const claimedByOther = exception.status === "claimed" && !mine;
  const claim = async (): Promise<void> => {
    setClaiming(true);
    setNotice(null);
    try {
      const { exception: updated } = await claimException(token, exception.id, null);
      set({ exception: updated });
      toast("已认领，现在由你处理");
    } catch (err) {
      if (handleAuthFailure(err)) return;
      if (err instanceof ApiError && err.code === "EXCEPTION_ALREADY_CLAIMED") {
        const other = typeof err.details["assignee_id"] === "string" ? colleagueName(err.details["assignee_id"], names, me) : "别的同事";
        setNotice(`这条异常刚被「${other}」认领了。要转交请让他在这里点「转交给同事」；页面已刷新成最新的样子。`);
        reload();
      } else if (err instanceof ApiError && err.code === "EXCEPTION_CLOSED") {
        setNotice("这条异常已经关闭了（可能是条件解除，系统自动关的）。页面已刷新。");
        reload();
      } else setNotice(failureText(err, "认领"));
    } finally {
      setClaiming(false);
    }
  };
  const lines = exceptionDetailLines(exception);
  return shell(
    <>
      <div role="alert">{notice !== null && <Alert kind="warning">{notice}</Alert>}</div>
      <div className="detail-layout">
        <div className="detail-layout__main">
          <section className="card" aria-labelledby="exception-summary">
            <div className="card__title-row">
              <h2 className="card__title" id="exception-summary">
                情况
              </h2>
              <span className="badge-row">
                <StatusBadge {...EXCEPTION_STATUS_BADGES[exception.status]} />
                {exception.overdue && <StatusBadge {...OVERDUE_BADGE} />}
              </span>
            </div>
            <dl className="details">
              <Detail label="订单">
                <Link className="link mono" to={platformOrderPath(exception.order.id)}>
                  {exception.order.order_no}
                </Link>
              </Detail>
              <Detail label="供应商">{exception.tenant.name}</Detail>
              <Detail label="发现时间">
                <LocalTime iso={exception.opened_at} />
              </Detail>
              <Detail label="处理时限">
                <LocalTime iso={exception.due_at} />
              </Detail>
              {lines.map((line) => (
                <Detail key={line.label} label={line.label}>
                  {line.value}
                </Detail>
              ))}
            </dl>
            <h3 className="card__subtitle">处理方式</h3>
            <p>{exception.handling}</p>
            <p className="table__muted">{`时间按你的本地时区（${localOffsetLabel()}）显示。`}</p>
            <div className="action-row">
              <Link className="link" to={platformOrderPath(exception.order.id)}>
                去订单详情处理
              </Link>
              {canAudit && (
                <Link className="link" to={auditLogPath({ resource: "order_exception", rid: exception.id })}>
                  看这条异常的操作记录
                </Link>
              )}
            </div>
          </section>
        </div>
        <aside className="detail-layout__aside" aria-label="处理">
          <section className="card" aria-labelledby="exception-handling">
            <h2 className="card__title" id="exception-handling">
              处理
            </h2>
            <dl className="details">
              <Detail label="处理人">{assigneeText(exception.assignee, me)}</Detail>
              {exception.claimed_at !== null && (
                <Detail label="认领时间">
                  <LocalTime iso={exception.claimed_at} />
                </Detail>
              )}
              {closed && <Detail label="关闭方式">{exception.close_kind === null ? "—" : CLOSE_KIND_NAMES[exception.close_kind]}</Detail>}
              {closed && (
                <Detail label="关闭时间">
                  <LocalTime iso={exception.closed_at} />
                </Detail>
              )}
              {exception.closed_by !== null && <Detail label="关闭人">{colleagueName(exception.closed_by, names, me)}</Detail>}
              {exception.resolution !== null && (
                <Detail label="处理说明">
                  <span className="prewrap">{exception.resolution}</span>
                </Detail>
              )}
            </dl>
            {closed && <p className="table__muted">已关闭，不能再认领或修改。</p>}
            {!closed && !canManage && <p className="table__muted">你可以查看，但没有处理异常的权限。</p>}
            {!closed && canManage && (
              <>
                {claimedByOther && <p className="table__muted">{`「${assigneeText(exception.assignee, me)}」正在处理。要转交请让他操作；处理完了谁都可以写说明关闭。`}</p>}
                <div className="action-row">
                  {exception.status === "open" && (
                    <Button variant="primary" loading={claiming} loadingText="认领中…" onClick={() => void claim()}>
                      认领
                    </Button>
                  )}
                  {exception.status === "open" && <Button onClick={() => setDialog("assign")}>指派给同事</Button>}
                  {mine && <Button onClick={() => setDialog("transfer")}>转交给同事</Button>}
                  <Button variant={mine ? "primary" : "secondary"} onClick={() => setDialog("close")}>
                    写说明并关闭
                  </Button>
                </div>
              </>
            )}
          </section>
        </aside>
      </div>
      {dialog === "close" && (
        <NoteDialog
          title="关闭这条异常？"
          intro={<p>关闭表示已经处理完了。处理说明会记进审计日志，订单详情里也看得到。关闭后不能重新打开；同样的问题再发生时系统会另外生成一条。</p>}
          label="处理说明"
          missing="请写处理说明：做了什么、结果怎样"
          hint="如「已电话催供应商，14:20 派车」「退款已在 Stripe 后台核实成功」"
          confirmText="关闭"
          busyText="关闭中…"
          action="关闭"
          describe={(err) => (err.code === "EXCEPTION_CLOSED" ? "这条异常已经关闭了（可能是条件解除，系统自动关的）。" : null)}
          onClose={() => {
            setDialog(null);
            reload();
          }}
          onSubmit={async (note) => {
            const { exception: updated } = await closeException(token, exception.id, note);
            set({ exception: updated });
            setDialog(null);
            toast("已关闭这条异常");
          }}
        />
      )}
      {(dialog === "assign" || dialog === "transfer") && (
        <AssignDialog
          exception={exception}
          transfer={dialog === "transfer"}
          onClose={() => {
            setDialog(null);
            reload();
          }}
          onDone={(updated, text) => {
            set({ exception: updated });
            setDialog(null);
            toast(text);
          }}
        />
      )}
    </>,
  );
}
