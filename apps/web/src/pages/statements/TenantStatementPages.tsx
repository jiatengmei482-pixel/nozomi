/**
 * 供应商后台「账单」（M4-03；接口 M5-01，ADR 0040；页面说明 docs/design/pages/finance.md 第 4 节）：
 * - 列表、详情（`statement.read`：管理员、财务、只读）：每月一张（一种币种一张），小计、明细、经过；
 * - 确认、提异议（`statement.confirm`：管理员、财务）：出账（或平台答复异议）后 7 天内；不确认也不提异议的，到期视为确认。
 * 规则 4：金额都是你们的结算币种（结算价、应得、应扣款项），没有对外价和加价比例；平台员工是谁、付款复核的说明不给供应商。
 */
import { STATEMENT_STATUSES, type StatementStatus } from "@nozomi/domain";
import { type ReactNode, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ApiError } from "../../api/client.ts";
import { type TenantStatement, type TenantStatementDetail, confirmStatement, disputeStatement, getTenantStatement, listTenantStatements } from "../../api/billing.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button } from "../../components/Button.tsx";
import { type Column, DataTable } from "../../components/DataTable.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { SelectField } from "../../components/FormFields.tsx";
import { NoteDialog } from "../../components/NoteDialog.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { useToast } from "../../components/Toast.tsx";
import { EVENT_NAMES, STATEMENT_STATUS_BADGES, TENANT_STATEMENTS_PAGE, lineKindName, periodText, tenantStatementActions, tenantStatementPath } from "../../lib/billing-display.ts";
import { orderPath } from "../../lib/dispatch-display.ts";
import { failureText } from "../../lib/failure.ts";
import { formatLocalDateTime } from "../../lib/master-display.ts";
import { moneyLabel } from "../../lib/order-center-display.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { useTenantCan } from "../../lib/use-master-access.ts";
import { StatementLineTable } from "../platform/FinancePages.tsx";
import { Detail, LocalTime, NO_ACCESS, tableStateOf } from "../platform/order-center-parts.tsx";

const ACTOR_TEXT: Readonly<Record<"tenant_user" | "platform_user" | "system", string>> = { tenant_user: "你们", platform_user: "平台", system: "系统" };

function statementFailure(err: ApiError): string | null {
  if (err.code === "STATEMENT_CONFIRM_PERIOD_OVER") return "确认期已经过了，账单已视为确认，不能再提异议。有问题请联系平台的财务。";
  if (err.code === "STATEMENT_STATE_INVALID") return "账单的状态刚变了（平台可能刚答复或作废了它）。关掉对话框后页面会刷新。";
  return null;
}

export function TenantStatementListPage() {
  const { portal, account } = usePortalSession();
  useDocumentTitle(`账单 · NOZOMI ${portal.name}`);
  const canRead = useTenantCan("statement.read");
  const [params, setParams] = useSearchParams();
  const statusParam = params.get("status");
  const status = (STATEMENT_STATUSES as readonly string[]).includes(statusParam ?? "") ? (statusParam as StatementStatus) : null;
  const { state, reload } = useLoad<{ items: TenantStatement[] }>(`tenant-statements|${status ?? ""}`, canRead ? (t) => listTenantStatements(t, status === null ? {} : { status }) : null);
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="账单">
      <Page title="账单">{content}</Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);
  const columns: Column<TenantStatement>[] = [
    { key: "no", header: "账单号", cell: (row) => <Link className="link mono" to={tenantStatementPath(row.id)}>{row.statement_no}</Link> },
    { key: "period", header: "周期", cell: (row) => periodText(row.period) },
    { key: "status", header: "状态", cell: (row) => <StatusBadge {...STATEMENT_STATUS_BADGES[row.status]} /> },
    { key: "total", header: "合计（平台应付你们）", align: "end", cardLabel: true, cell: (row) => <span className="amount">{moneyLabel(row.total)}</span> },
    { key: "confirm", header: "确认期截止", cardLabel: true, cell: (row) => (row.status === "issued" ? <LocalTime iso={row.confirm_due_at} /> : "—") },
    { key: "pay", header: "付款日", cardLabel: true, cell: (row) => row.payout_on ?? row.pay_due_on },
  ];
  return shell(
    <>
      <p className="page__lead">每月 1 日起平台给你们出上个月的账（按订单的服务日期，城市当地日期）：已完成订单的结算价、客人未出现、有偿取消的应得、事后加收，减去违约金、救援差价、客人赔付等应扣款项。出账后 7 天内请核对并确认，有问题提异议；到期不处理视为确认。次月 20 日付款。</p>
      <div className="filter-bar" role="search">
        <SelectField inline label="状态" value={status ?? "all"} options={[{ value: "all", label: "全部" }, ...STATEMENT_STATUSES.map((value) => ({ value, label: STATEMENT_STATUS_BADGES[value].label }))]} onChange={(value) => setParams(value === "all" ? {} : { status: value }, { replace: true })} />
      </div>
      <div className="card-table">
        <DataTable
          label="账单"
          columns={columns}
          rows={state.data?.items ?? []}
          rowKey={(row) => row.id}
          state={tableStateOf(state.status, state.data !== null)}
          onRetry={reload}
          empty={<StateBlock tone="neutral" title={status === null ? "还没有账单" : "没有符合条件的账单"} description="有结案的订单（已完成、客人未出现、有偿取消）后，下个月 1 日起会出现这一期的账单。" />}
        />
      </div>
    </>,
  );
}

/** 确认账单：确认后等平台付款复核，不能再提异议。 */
function ConfirmDialog({ statement, onClose, onDone }: { statement: TenantStatementDetail; onClose(): void; onDone(next: TenantStatementDetail): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ text: string; final: boolean } | null>(null);
  const submit = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      onDone((await confirmStatement(token, statement.id)).statement);
    } catch (err) {
      if (handleAuthFailure(err)) return;
      const final = err instanceof ApiError && err.status < 500 && err.status !== 429;
      setProblem({ text: (err instanceof ApiError ? statementFailure(err) : null) ?? failureText(err, "确认"), final });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      title="确认这张账单？"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="text" disabled={busy} onClick={onClose}>
            {problem?.final ? "知道了" : "取消"}
          </Button>
          {!problem?.final && (
            <Button variant="primary" loading={busy} loadingText="确认中…" onClick={() => void submit()}>
              确认账单
            </Button>
          )}
        </>
      }
    >
      <div role="alert">{problem !== null && <Alert kind="danger">{problem.text}</Alert>}</div>
      <p>{`${periodText(statement.period)}：合计 ${moneyLabel(statement.total)}，${statement.line_count} 条明细。`}</p>
      <p>确认后平台的财务做付款复核，按付款日付款；确认后不能再提异议。</p>
    </Dialog>
  );
}

export function TenantStatementDetailPage() {
  const { id = "" } = useParams();
  const { portal, account, token } = usePortalSession();
  const canRead = useTenantCan("statement.read");
  const canConfirm = useTenantCan("statement.confirm");
  const canOrders = useTenantCan("order.read");
  const toast = useToast();
  const { state, reload, set } = useLoad<{ statement: TenantStatementDetail }>(`tenant-statement|${id}`, canRead ? (t) => getTenantStatement(t, id) : null);
  const [dialog, setDialog] = useState<"confirm" | "dispute" | null>(null);
  const statement = state.data?.statement ?? null;
  const title = statement === null ? "账单" : `账单 ${statement.statement_no}`;
  useDocumentTitle(`${title} · NOZOMI ${portal.name}`);
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName={title} trail={[{ label: "账单", to: TENANT_STATEMENTS_PAGE }]}>
      <Page title={title}>{content}</Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);
  if (state.status === "not-found") return shell(<StateBlock tone="neutral" title="找不到这张账单" description="可能是链接写错了。" />);
  if (statement === null) {
    return shell(state.status === "error" ? <StateBlock title="加载失败" description="请检查网络后重试。" action={<Button variant="secondary" onClick={reload}>重试</Button>} /> : <Skeleton lines={["medium", "long", "long"]} />);
  }
  const actions = tenantStatementActions(statement.status);
  const lines = statement.status === "void" ? statement.lines : statement.lines.filter((line) => !line.voided);
  return shell(
    <>
      {statement.status === "issued" && (
        <Alert kind="info">
          <strong className="alert__title">请核对并确认</strong>
          <span>{`${formatLocalDateTime(statement.confirm_due_at)} 之前确认或提异议；到期不处理视为确认。`}</span>
        </Alert>
      )}
      {statement.status === "disputed" && (
        <Alert kind="warning">
          <strong className="alert__title">你们提了异议，等平台答复</strong>
          <span className="prewrap">{statement.dispute_reason ?? ""}</span>
        </Alert>
      )}
      {statement.status === "void" && <Alert kind="info">{`这张账单已作废：${statement.void_reason ?? ""}。平台按现在的数据重出了这一期的账单，请看账单列表。`}</Alert>}
      <section className="card" aria-labelledby="tenant-statement-summary">
        <div className="card__title-row">
          <h2 className="card__title" id="tenant-statement-summary">
            {periodText(statement.period)}
          </h2>
          <StatusBadge {...STATEMENT_STATUS_BADGES[statement.status]} />
        </div>
        <dl className="details">
          <Detail label="合计（平台应付你们）">
            <strong className="amount">{moneyLabel(statement.total)}</strong>
          </Detail>
          <Detail label="币种">{statement.currency}</Detail>
          <Detail label="出账时间">
            <LocalTime iso={statement.issued_at} />
          </Detail>
          <Detail label="确认">{statement.confirmed_at === null ? "—" : <>{statement.confirmed_by_type === "system" ? "确认期满，视为确认 · " : "你们确认 · "}<LocalTime iso={statement.confirmed_at} /></>}</Detail>
          <Detail label="应付日">{statement.pay_due_on}</Detail>
          <Detail label="付款日">{statement.payout_on ?? "—"}</Detail>
        </dl>
        {canConfirm && (actions.confirm || actions.dispute) && (
          <div className="action-row">
            {actions.confirm && (
              <Button variant="primary" onClick={() => setDialog("confirm")}>
                确认账单
              </Button>
            )}
            {actions.dispute && <Button onClick={() => setDialog("dispute")}>提异议</Button>}
          </div>
        )}
        {!canConfirm && (actions.confirm || actions.dispute) && <p className="table__muted">你可以查看，但没有确认账单的权限（管理员、财务可以）。</p>}
      </section>

      <section className="card" aria-labelledby="tenant-statement-subtotals">
        <h2 className="card__title" id="tenant-statement-subtotals">
          小计
        </h2>
        <dl className="details">
          {statement.summary.map((entry) => (
            <Detail key={entry.kind} label={`${lineKindName(entry.kind)}（${entry.count} 条）`}>
              <span className="amount">{moneyLabel(entry.amount)}</span>
            </Detail>
          ))}
        </dl>
      </section>

      <section className="card" aria-labelledby="tenant-statement-lines">
        <h2 className="card__title" id="tenant-statement-lines">
          明细
        </h2>
        <p className="table__muted">正数是平台付给你们的，负数是从应付里扣的。服务日期是城市当地日期；「往期调整」是上一期出账时还没结案、这一期补上的。</p>
        <StatementLineTable lines={lines} {...(canOrders ? { orderHref: orderPath } : {})} />
      </section>

      <section className="card" aria-labelledby="tenant-statement-events">
        <h2 className="card__title" id="tenant-statement-events">
          经过
        </h2>
        <ol className="thread">
          {statement.events.map((event, index) => (
            <li key={`${event.at}-${index}`} className="thread__item">
              <span className="thread__meta">
                <span>{`${EVENT_NAMES[event.action]} · ${ACTOR_TEXT[event.actor_type]}`}</span>
                <LocalTime iso={event.at} />
              </span>
              {event.note !== null && <p className="thread__body">{event.note}</p>}
            </li>
          ))}
        </ol>
      </section>

      {dialog === "confirm" && (
        <ConfirmDialog
          statement={statement}
          onClose={() => {
            setDialog(null);
            reload();
          }}
          onDone={(next) => {
            set({ statement: next });
            setDialog(null);
            toast("已确认账单");
          }}
        />
      )}
      {dialog === "dispute" && (
        <NoteDialog
          title="对这张账单提异议"
          intro={<p>平台的财务会核对并答复；答复后账单回到「待确认」，再给 7 天确认。有异议的账单不会到期自动确认。</p>}
          label="哪里不对"
          missing="请写清楚哪一条不对、应该是多少"
          hint="如「订单 NZ… 的停车费 JPY 1,500 没有算进来」"
          maxLength={500}
          confirmText="提交异议"
          busyText="提交中…"
          action="提交"
          describe={statementFailure}
          onClose={() => {
            setDialog(null);
            reload();
          }}
          onSubmit={async (reason) => {
            set({ statement: (await disputeStatement(token, statement.id, reason)).statement });
            setDialog(null);
            toast("已提交异议，等平台答复");
          }}
        />
      )}
    </>,
  );
}
