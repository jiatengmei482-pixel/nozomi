/**
 * 运营后台「财务结算」（M4-03；接口 M5-01，ADR 0040；页面说明 docs/design/pages/finance.md）：
 * - 账单（`statement.read`）：列表（按状态、周期筛）、详情（小计、明细、经过）；
 *   `statement.manage`（财务）：手工出账、答复异议、作废并重出、发起付款复核（另一位有 `statement.review` 的同事在「待审核」里批准）；
 * - 付款批次（`statement.read`）：列表、详情（按币种的合计、里面的账单）；`statement.manage` 锁定批次（之后批准的进下个月同一天）。
 * 限定了数据范围的员工不能用财务结算（账单跨城市、跨渠道，切不开）：接口 403，页面写「没有权限」。
 * 金额是供应商的结算币种，有正有负；不同币种不相加，批次的合计按币种分开写。
 */
import { type PayoutBatchStatus, STATEMENT_STATUSES, type StatementStatus, billingToday, isBillingPeriod, periodOfDate, shiftPeriod } from "@nozomi/domain";
import { type ReactNode, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ApiError } from "../../api/client.ts";
import type { ListPage } from "../../api/dispatch.ts";
import {
  type GenerateResult,
  type PayoutBatch,
  type PayoutBatchDetail,
  type PlatformStatement,
  type PlatformStatementDetail,
  closePayoutBatch,
  generateStatements,
  getPayoutBatch,
  getPlatformStatement,
  listPayoutBatches,
  listPlatformStatements,
  replyToDispute,
  requestPayoutApproval,
  voidStatement,
} from "../../api/billing.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button } from "../../components/Button.tsx";
import { type Column, CursorPagination, DataTable } from "../../components/DataTable.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { FilterBar, useFilterParam } from "../../components/FilterBar.tsx";
import { SelectField } from "../../components/FormFields.tsx";
import { NoteDialog } from "../../components/NoteDialog.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { TextField } from "../../components/TextField.tsx";
import { useToast } from "../../components/Toast.tsx";
import { localOffsetLabel } from "../../lib/audit-display.ts";
import { ACTOR_NAMES, BATCH_STATUS_BADGES, EVENT_NAMES, PAYOUT_BATCHES_PAGE, STATEMENTS_PAGE, STATEMENT_STATUS_BADGES, lineDetailText, lineKindName, payoutBatchPath, periodText, statementActions, statementPath } from "../../lib/billing-display.ts";
import { APPROVALS_PAGE_PATH } from "../../lib/channel-display.ts";
import { failureText } from "../../lib/failure.ts";
import { colleagueName, moneyLabel } from "../../lib/order-center-display.ts";
import { platformOrderPath } from "../../lib/order-money-display.ts";
import { auditLogPath } from "../../lib/platform-paths.ts";
import { useColleagues } from "../../lib/use-colleagues.ts";
import { pageSizeOf, useCursorPages } from "../../lib/use-cursor-pages.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan } from "../../lib/use-master-access.ts";
import { Detail, LocalTime, NO_ACCESS, tableStateOf } from "./order-center-parts.tsx";

const SCOPE_DENIED = <StateBlock tone="neutral" title="你没有权限查看这里" description="财务结算只给不限数据范围的账号用（一张账单包含供应商在各城市、各渠道的订单）。需要的话，请联系管理员。" />;

/** 最近 12 期（按东京的今天，上个月起往前）。 */
function recentPeriods(now: Date): string[] {
  const current = periodOfDate(billingToday(now));
  return Array.from({ length: 12 }, (_, index) => shiftPeriod(current, -1 - index));
}

function statementFailure(err: ApiError): string | null {
  if (err.code === "STATEMENT_REVIEW_PENDING") return "这张账单有一条待审核的付款复核，不能作废。请先在「待审核」里驳回或撤回。";
  if (err.code === "STATEMENT_STATE_INVALID") return "账单的状态刚变了（可能供应商刚确认或提了异议）。关掉对话框后页面会刷新。";
  if (err.code === "DATA_SCOPE_DENIED") return "限定了数据范围的账号不能做财务结算的操作。";
  return null;
}

// ───────────── 账单列表 ─────────────

function StatementFilters({ periods }: { periods: readonly string[] }) {
  const [status, setStatus] = useFilterParam("status");
  const [period, setPeriod] = useFilterParam("period");
  return (
    <>
      <SelectField
        inline
        label="状态"
        value={(STATEMENT_STATUSES as readonly string[]).includes(status ?? "") ? (status as StatementStatus) : "all"}
        options={[{ value: "all", label: "全部" }, ...STATEMENT_STATUSES.map((value) => ({ value, label: STATEMENT_STATUS_BADGES[value].label }))]}
        onChange={(value) => setStatus(value === "all" ? null : value)}
      />
      <SelectField inline label="周期" value={period !== null && isBillingPeriod(period) ? period : "all"} options={[{ value: "all", label: "全部" }, ...(period !== null && isBillingPeriod(period) && !periods.includes(period) ? [period] : []).concat(periods).map((value) => ({ value, label: periodText(value) }))]} onChange={(value) => setPeriod(value === "all" ? null : value)} />
    </>
  );
}

/** 手工出账：不填周期就是上个月；某一家出错只回滚它自己，结果里列出来。 */
function GenerateDialog({ onClose }: { onClose(changed: boolean): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const [period, setPeriod] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    const value = period.trim();
    if (value !== "" && !isBillingPeriod(value)) {
      setError("周期写成 YYYY-MM，如 2026-09；不填就是上个月");
      return;
    }
    setBusy(true);
    setError(null);
    setProblem(null);
    try {
      setResult(await generateStatements(token, value === "" ? null : value));
    } catch (err) {
      if (!handleAuthFailure(err)) setProblem(err instanceof ApiError && err.status < 500 ? (statementFailure(err) ?? err.message) : failureText(err, "出账"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      title="手工出账"
      size="form"
      busy={busy}
      dismissOnBackdrop={false}
      onClose={() => onClose(result !== null)}
      footer={
        result === null ? (
          <>
            <Button variant="text" disabled={busy} onClick={() => onClose(false)}>
              取消
            </Button>
            <Button variant="primary" loading={busy} loadingText="出账中…" onClick={() => void submit()}>
              出账
            </Button>
          </>
        ) : (
          <Button variant="primary" data-autofocus onClick={() => onClose(true)}>
            知道了
          </Button>
        )
      }
    >
      <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
      {result === null ? (
        <>
          <p>每月 1 日起系统每小时自动出上个月的账；这里可以马上出。已经出过的不会重复，期间结案的进下一期（往期调整）。出账后账单直接发给供应商，等它 7 天内确认。</p>
          <TextField label="周期（选填）" placeholder="2026-09" autoComplete="off" value={period} readOnly={busy} errors={error === null ? [] : [error]} onChange={(event) => setPeriod(event.target.value)} hint="不填就是上个月（按东京日期）；只能出已经结束的月份" />
        </>
      ) : (
        <div role="status">
          <p>{`${periodText(result.period)}：新出了 ${result.created.length} 张账单。`}</p>
          {result.created.length === 0 && result.failed.length === 0 && <p className="table__muted">没有新的应付：这一期该出的都出过了，或者没有结案的订单。</p>}
          {result.failed.length > 0 && (
            <Alert kind="warning">
              <strong className="alert__title">{`${result.failed.length} 家供应商没有出成`}</strong>
              <ul className="alert__list">
                {result.failed.map((entry) => (
                  <li key={entry.tenant.id}>{`${entry.tenant.name}：${entry.message}`}</li>
                ))}
              </ul>
              <span>别的供应商照常出了。处理好原因后再点一次「手工出账」会重试这几家。</span>
            </Alert>
          )}
        </div>
      )}
    </Dialog>
  );
}

export function StatementListPage() {
  const { portal, account } = usePortalSession();
  useDocumentTitle(`账单 · NOZOMI ${portal.name}`);
  const canRead = usePlatformCan("statement.read");
  const canManage = usePlatformCan("statement.manage");
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const statusParam = params.get("status");
  const status = (STATEMENT_STATUSES as readonly string[]).includes(statusParam ?? "") ? (statusParam as StatementStatus) : null;
  const periodParam = params.get("period");
  const period = periodParam !== null && isBillingPeriod(periodParam) ? periodParam : null;
  const pageSize = pageSizeOf(params.get("size"));
  const filterKey = JSON.stringify(["statements", status, period, pageSize]);
  const pages = useCursorPages(filterKey);
  const [generating, setGenerating] = useState(false);
  const { state, reload } = useLoad<ListPage<PlatformStatement>>(`${filterKey}|${pages.cursor ?? ""}`, canRead ? (t) => listPlatformStatements(t, { limit: pageSize, ...(status === null ? {} : { status }), ...(period === null ? {} : { period }), ...(pages.cursor === null ? {} : { cursor: pages.cursor }) }) : null);
  const action = canManage ? (
    <Button variant="primary" onClick={() => setGenerating(true)}>
      手工出账
    </Button>
  ) : undefined;
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="账单" trail={[{ label: "财务结算" }]}>
      <Page title="账单" {...(action ? { action } : {})}>
        {content}
      </Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);
  if (state.status === "forbidden") return shell(SCOPE_DENIED);
  const setParam = (changes: Record<string, string | null>): void => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  };
  const filtered = status !== null || period !== null;
  const clear = (): void => setParam({ status: null, period: null });
  const columns: Column<PlatformStatement>[] = [
    { key: "no", header: "账单号", cell: (row) => <Link className="link mono" to={statementPath(row.id)}>{row.statement_no}</Link> },
    { key: "tenant", header: "供应商", wrap: true, cell: (row) => row.tenant.name },
    { key: "period", header: "周期", cardLabel: true, cell: (row) => periodText(row.period) },
    { key: "status", header: "状态", cell: (row) => <StatusBadge {...STATEMENT_STATUS_BADGES[row.status]} /> },
    { key: "total", header: "合计（应付供应商）", align: "end", cardLabel: true, cell: (row) => <span className="amount">{moneyLabel(row.total)}</span> },
    { key: "lines", header: "明细", align: "end", cell: (row) => `${row.line_count} 条` },
    { key: "due", header: "应付日", cardLabel: true, cell: (row) => row.payout_on ?? row.pay_due_on },
  ];
  const empty = filtered ? (
    <StateBlock tone="neutral" title="没有符合条件的账单" description="换个条件试试，或清空筛选。" action={<Button variant="secondary" onClick={clear}>清空筛选</Button>} />
  ) : (
    <StateBlock tone="neutral" title="还没有账单" description="每月 1 日起系统自动给有结案订单的供应商出上个月的账（已完成、no-show 审核通过、有偿取消、事后加收、应扣款项）。" {...(action ? { action } : {})} />
  );
  const data = state.data;
  return shell(
    <>
      <p className="page__lead">供应商应付账单：月结，按订单的服务日期（城市当地）切月；供应商 7 天内确认（可提异议），财务发起付款复核、另一位批准后进次月 20 日的付款批次。金额是供应商的结算币种。</p>
      <p>
        <Link className="link" to={PAYOUT_BATCHES_PAGE}>
          看付款批次
        </Link>
      </p>
      <FilterBar search={null} paramNames={["status", "period"]} active={filtered} onClear={clear}>
        <StatementFilters periods={recentPeriods(new Date())} />
      </FilterBar>
      <div className="card-table">
        <DataTable label="账单" columns={columns} rows={data?.items ?? []} rowKey={(row) => row.id} state={tableStateOf(state.status, data !== null)} refreshing={state.status === "loading" && data !== null} onRetry={reload} empty={empty} />
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
      {generating && (
        <GenerateDialog
          onClose={(changed) => {
            setGenerating(false);
            if (changed) {
              toast("出账完成");
              reload();
            }
          }}
        />
      )}
    </>,
  );
}

// ───────────── 账单详情 ─────────────

type StatementDialog = "reply" | "void" | "payout" | null;

export function StatementDetailPage() {
  const { id = "" } = useParams();
  const { portal, account, token } = usePortalSession();
  const canRead = usePlatformCan("statement.read");
  const canManage = usePlatformCan("statement.manage");
  const canApprovals = usePlatformCan("approval.read");
  const canAudit = usePlatformCan("audit_log.read");
  const toast = useToast();
  const { names, me } = useColleagues();
  const { state, reload, set } = useLoad<{ statement: PlatformStatementDetail }>(`statement|${id}`, canRead ? (t) => getPlatformStatement(t, id) : null);
  const [dialog, setDialog] = useState<StatementDialog>(null);
  const [reissued, setReissued] = useState<PlatformStatement[] | null>(null);
  const statement = state.data?.statement ?? null;
  const title = statement === null ? "账单" : `账单 ${statement.statement_no}`;
  useDocumentTitle(`${title} · NOZOMI ${portal.name}`);
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName={title} trail={[{ label: "财务结算" }, { label: "账单", to: STATEMENTS_PAGE }]}>
      <Page title={title}>{content}</Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);
  if (state.status === "forbidden") return shell(SCOPE_DENIED);
  if (state.status === "not-found") return shell(<StateBlock tone="neutral" title="找不到这张账单" description="链接可能有误。" />);
  if (statement === null) {
    return shell(state.status === "error" ? <StateBlock title="加载失败" description="请检查网络后重试。" action={<Button variant="secondary" onClick={reload}>重试</Button>} /> : <Skeleton lines={["medium", "long", "long", "long"]} />);
  }
  const actions = statementActions(statement.status);
  const pending = statement.pending_approval_id !== null;
  const lines = statement.status === "void" ? statement.lines : statement.lines.filter((line) => !line.voided);
  const done = (next: PlatformStatementDetail, text: string): void => {
    set({ statement: next });
    setDialog(null);
    toast(text);
  };
  return shell(
    <>
      {reissued !== null && (
        <Alert kind="success">
          <strong className="alert__title">已作废并重出</strong>
          <span>{reissued.length === 0 ? "按现在的数据这一期没有应付，没有重出账单。" : "按现在的数据重出了："}</span>
          {reissued.map((entry) => (
            <Link key={entry.id} className="mono" to={statementPath(entry.id)}>
              {`${entry.statement_no}（${moneyLabel(entry.total)}）`}
            </Link>
          ))}
        </Alert>
      )}
      {pending && (
        <Alert kind="info">
          <strong className="alert__title">付款复核待审核</strong>
          <span>另一位有审核权限的同事批准后，这张账单进付款批次。</span>
          {canApprovals && <Link to={APPROVALS_PAGE_PATH}>去「待审核」</Link>}
        </Alert>
      )}
      {statement.status === "disputed" && (
        <Alert kind="warning">
          <strong className="alert__title">供应商提了异议</strong>
          <span className="prewrap">{statement.dispute_reason ?? ""}</span>
          <span>账目有误的，先在源头改（审核加收、更正订单），再作废并重出；没有问题的，答复供应商，账单回到「待确认」，重新给 7 天确认。</span>
        </Alert>
      )}
      <section className="card" aria-labelledby="statement-summary">
        <div className="card__title-row">
          <h2 className="card__title" id="statement-summary">
            {`${statement.tenant.name} · ${periodText(statement.period)}`}
          </h2>
          <StatusBadge {...STATEMENT_STATUS_BADGES[statement.status]} />
        </div>
        <dl className="details">
          <Detail label="合计（应付供应商）">
            <strong className="amount">{moneyLabel(statement.total)}</strong>
          </Detail>
          <Detail label="币种">{statement.currency}</Detail>
          <Detail label="明细">{`${statement.line_count} 条`}</Detail>
          <Detail label="出账时间">
            <LocalTime iso={statement.issued_at} />
          </Detail>
          <Detail label="确认期截止">
            <LocalTime iso={statement.confirm_due_at} />
          </Detail>
          <Detail label="确认">{statement.confirmed_at === null ? "—" : <>{statement.confirmed_by_type === "system" ? "确认期满，视为确认 · " : "供应商确认 · "}<LocalTime iso={statement.confirmed_at} /></>}</Detail>
          <Detail label="应付日">{statement.pay_due_on}</Detail>
          <Detail label="付款日">{statement.payout_on ?? "—"}</Detail>
          {statement.payout_batch_id !== null && (
            <Detail label="付款批次">
              <Link className="link" to={payoutBatchPath(statement.payout_batch_id)}>
                {statement.payout_on ?? "看批次"}
              </Link>
            </Detail>
          )}
          {statement.void_reason !== null && (
            <Detail label="作废原因">
              <span className="prewrap">{`${statement.void_reason}（${colleagueName(statement.voided_by, names, me)}）`}</span>
            </Detail>
          )}
        </dl>
        {canManage && (actions.reply || actions.void || actions.requestReview) && (
          <div className="action-row">
            {actions.requestReview && !pending && (
              <Button variant="primary" onClick={() => setDialog("payout")}>
                发起付款复核
              </Button>
            )}
            {actions.reply && (
              <Button variant="primary" onClick={() => setDialog("reply")}>
                答复异议
              </Button>
            )}
            {actions.void && (
              <Button variant="secondary" className="button--danger-text" onClick={() => setDialog("void")}>
                作废并重出
              </Button>
            )}
          </div>
        )}
        {!canManage && <p className="table__muted">你可以查看，但没有处理账单的权限。</p>}
        {canAudit && (
          <Link className="link" to={auditLogPath({ resource: "statement", rid: statement.id })}>
            看这张账单的操作记录
          </Link>
        )}
      </section>

      <section className="card" aria-labelledby="statement-subtotals">
        <h2 className="card__title" id="statement-subtotals">
          小计
        </h2>
        <div className="table-wrap">
          <div className="table-scroll" tabIndex={0} role="region" aria-label="小计">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">种类</th>
                  <th scope="col" className="table__cell--end">
                    条数
                  </th>
                  <th scope="col" className="table__cell--end">
                    金额
                  </th>
                </tr>
              </thead>
              <tbody>
                {statement.summary.map((entry) => (
                  <tr key={entry.kind}>
                    <th scope="row">{lineKindName(entry.kind)}</th>
                    <td className="table__cell--end">{entry.count}</td>
                    <td className="table__cell--end amount">{moneyLabel(entry.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="card" aria-labelledby="statement-lines">
        <h2 className="card__title" id="statement-lines">
          明细
        </h2>
        <p className="table__muted">正数是平台付给供应商的，负数是从应付里扣的（违约金、救援差价、客人赔付、报销、上期结转）。服务日期是城市当地日期。</p>
        <StatementLineTable lines={lines} linkOrder />
      </section>

      <section className="card" aria-labelledby="statement-events">
        <h2 className="card__title" id="statement-events">
          经过
        </h2>
        <ol className="thread">
          {statement.events.map((event, index) => (
            <li key={`${event.at}-${index}`} className="thread__item">
              <span className="thread__meta">
                <span>{`${EVENT_NAMES[event.action]} · ${event.actor_type === "platform_user" ? colleagueName(event.actor_id, names, me) : ACTOR_NAMES[event.actor_type]}`}</span>
                <LocalTime iso={event.at} />
              </span>
              {event.note !== null && <p className="thread__body">{event.note}</p>}
            </li>
          ))}
        </ol>
        <p className="table__muted">{`时间按你的本地时区（${localOffsetLabel()}）显示。供应商看得到异议、答复、作废原因，看不到付款复核的说明。`}</p>
      </section>

      {dialog === "reply" && (
        <NoteDialog
          title="答复供应商的异议"
          intro={<p>答复后账单回到「待确认」，重新给供应商 7 天确认。供应商看得到这段答复。</p>}
          label="答复"
          maxLength={500}
          confirmText="答复"
          busyText="提交中…"
          action="答复"
          describe={statementFailure}
          onClose={() => {
            setDialog(null);
            reload();
          }}
          onSubmit={async (note) => done((await replyToDispute(token, statement.id, note)).statement, "已答复，等供应商确认")}
        />
      )}
      {dialog === "void" && (
        <NoteDialog
          title="作废这张账单并重出？"
          intro={<p>账单和明细一起作废，按现在的数据马上重出这一期这家供应商的账单（新的账单号）。供应商看得到作废原因。作废不能撤销。</p>}
          label="作废原因"
          maxLength={500}
          danger
          confirmText="作废并重出"
          busyText="作废中…"
          action="作废"
          describe={statementFailure}
          onClose={() => {
            setDialog(null);
            reload();
          }}
          onSubmit={async (reason) => {
            const result = await voidStatement(token, statement.id, reason);
            setReissued(result.reissued);
            done(result.statement, "已作废并重出");
          }}
        />
      )}
      {dialog === "payout" && (
        <NoteDialog
          title="发起付款复核"
          intro={
            <>
              <p>{`付款给「${statement.tenant.name}」：${periodText(statement.period)} 合计 ${moneyLabel(statement.total)}，应付日 ${statement.pay_due_on}。`}</p>
              <p>要另一位有审核权限的同事在「待审核」里批准：合计为正进付款批次，为 0 记为无需付款，为负转入下一期。</p>
            </>
          }
          label="给审核人的说明（选填）"
          required={false}
          maxLength={500}
          confirmText="提交复核"
          busyText="提交中…"
          action="提交"
          describe={statementFailure}
          onClose={() => {
            setDialog(null);
            reload();
          }}
          onSubmit={async (note) => {
            await requestPayoutApproval(token, statement.id, note === "" ? null : note);
            setDialog(null);
            toast("已提交付款复核，等另一位同事批准");
            reload();
          }}
        />
      )}
    </>,
  );
}

/** 账单明细表：运营后台的订单号可以点进订单详情。 */
export function StatementLineTable({ lines, linkOrder, orderHref }: { lines: PlatformStatementDetail["lines"]; linkOrder?: boolean; orderHref?: (id: string) => string }) {
  if (lines.length === 0) return <p className="table__muted">没有明细。</p>;
  const href = orderHref ?? platformOrderPath;
  return (
    <div className="table-wrap">
      <div className="table-scroll" tabIndex={0} role="region" aria-label="账单明细">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">种类</th>
              <th scope="col">订单号</th>
              <th scope="col">服务日期</th>
              <th scope="col" className="table__cell--end">
                金额
              </th>
              <th scope="col">怎么来的</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id}>
                <th scope="row">
                  <span className="badge-row">
                    {lineKindName(line.kind)}
                    {line.prior_period && <span className="tag">往期调整</span>}
                    {line.voided && <span className="tag">已作废</span>}
                  </span>
                </th>
                <td>
                  {line.order_id !== null && line.order_no !== null ? (
                    linkOrder || orderHref ? (
                      <Link className="link mono" to={href(line.order_id)}>
                        {line.order_no}
                      </Link>
                    ) : (
                      <span className="mono">{line.order_no}</span>
                    )
                  ) : (
                    "—"
                  )}
                </td>
                <td>{line.service_date ?? "—"}</td>
                <td className="table__cell--end amount">{moneyLabel(line.amount)}</td>
                <td className="table__cell--wrap">{lineDetailText(line)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ───────────── 付款批次 ─────────────

function totalsText(batch: PayoutBatch): ReactNode {
  if (batch.totals.length === 0) return "—";
  return (
    <span className="table__names">
      {batch.totals.map((entry) => (
        <span key={entry.currency} className="amount">{`${moneyLabel(entry.total)}（${entry.count} 张）`}</span>
      ))}
    </span>
  );
}

export function PayoutBatchListPage() {
  const { portal, account } = usePortalSession();
  useDocumentTitle(`付款批次 · NOZOMI ${portal.name}`);
  const canRead = usePlatformCan("statement.read");
  const [params, setParams] = useSearchParams();
  const statusParam = params.get("status");
  const status = statusParam === "open" || statusParam === "closed" || statusParam === "paid" ? (statusParam as PayoutBatchStatus) : null;
  const { state, reload } = useLoad<{ items: PayoutBatch[] }>(`batches|${status ?? ""}`, canRead ? (t) => listPayoutBatches(t, status ?? undefined) : null);
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="付款批次" trail={[{ label: "财务结算" }]}>
      <Page title="付款批次">{content}</Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);
  if (state.status === "forbidden") return shell(SCOPE_DENIED);
  const columns: Column<PayoutBatch>[] = [
    { key: "date", header: "付款日", cell: (row) => <Link className="link" to={payoutBatchPath(row.id)}>{row.pay_date}</Link> },
    { key: "status", header: "状态", cell: (row) => <StatusBadge {...BATCH_STATUS_BADGES[row.status]} /> },
    { key: "count", header: "账单", align: "end", cardLabel: true, cell: (row) => `${row.statement_count} 张` },
    { key: "totals", header: "合计（按币种）", align: "end", cardLabel: true, cell: totalsText },
    { key: "closed", header: "锁定时间", cardLabel: true, cell: (row) => <LocalTime iso={row.closed_at} /> },
  ];
  return shell(
    <>
      <p className="page__lead">一个付款日一个批次（默认次月 20 日）。付款复核批准后账单自动进它的应付日的批次；批次锁定后，之后批准的进下个月同一天。银行转账文件和流水号回填在下一期（M5-02）。</p>
      <div className="filter-bar" role="search">
        <SelectField inline label="状态" value={status ?? "all"} options={[{ value: "all", label: "全部" }, ...(["open", "closed", "paid"] as const).map((value) => ({ value, label: BATCH_STATUS_BADGES[value].label }))]} onChange={(value) => setParams(value === "all" ? {} : { status: value }, { replace: true })} />
      </div>
      <div className="card-table">
        <DataTable
          label="付款批次"
          columns={columns}
          rows={state.data?.items ?? []}
          rowKey={(row) => row.id}
          state={tableStateOf(state.status, state.data !== null)}
          onRetry={reload}
          empty={<StateBlock tone="neutral" title={status === null ? "还没有付款批次" : "没有符合条件的付款批次"} description="账单的付款复核批准后，会按付款日进批次。" />}
        />
      </div>
    </>,
  );
}

export function PayoutBatchDetailPage() {
  const { id = "" } = useParams();
  const { portal, account } = usePortalSession();
  const canRead = usePlatformCan("statement.read");
  const canManage = usePlatformCan("statement.manage");
  const toast = useToast();
  const { names, me } = useColleagues();
  const { state, reload, set } = useLoad<{ batch: PayoutBatchDetail }>(`batch|${id}`, canRead ? (t) => getPayoutBatch(t, id) : null);
  const [closing, setClosing] = useState(false);
  const batch = state.data?.batch ?? null;
  const title = batch === null ? "付款批次" : `付款批次 ${batch.pay_date}`;
  useDocumentTitle(`${title} · NOZOMI ${portal.name}`);
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName={title} trail={[{ label: "财务结算" }, { label: "付款批次", to: PAYOUT_BATCHES_PAGE }]}>
      <Page title={title}>{content}</Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);
  if (state.status === "forbidden") return shell(SCOPE_DENIED);
  if (state.status === "not-found") return shell(<StateBlock tone="neutral" title="找不到这个付款批次" description="链接可能有误。" />);
  if (batch === null) {
    return shell(state.status === "error" ? <StateBlock title="加载失败" description="请检查网络后重试。" action={<Button variant="secondary" onClick={reload}>重试</Button>} /> : <Skeleton lines={["medium", "long", "long"]} />);
  }
  const columns: Column<PlatformStatement>[] = [
    { key: "no", header: "账单号", cell: (row) => <Link className="link mono" to={statementPath(row.id)}>{row.statement_no}</Link> },
    { key: "tenant", header: "供应商", wrap: true, cell: (row) => row.tenant.name },
    { key: "period", header: "周期", cardLabel: true, cell: (row) => periodText(row.period) },
    { key: "status", header: "状态", cell: (row) => <StatusBadge {...STATEMENT_STATUS_BADGES[row.status]} /> },
    { key: "total", header: "合计", align: "end", cardLabel: true, cell: (row) => <span className="amount">{moneyLabel(row.total)}</span> },
  ];
  return shell(
    <>
      <section className="card" aria-labelledby="batch-summary">
        <div className="card__title-row">
          <h2 className="card__title" id="batch-summary">
            {`${batch.pay_date} 付款`}
          </h2>
          <StatusBadge {...BATCH_STATUS_BADGES[batch.status]} />
        </div>
        <dl className="details">
          <Detail label="账单">{`${batch.statement_count} 张`}</Detail>
          <Detail label="合计（按币种，不相加）">{totalsText(batch)}</Detail>
          <Detail label="锁定">{batch.closed_at === null ? "—" : <>{`${colleagueName(batch.closed_by, names, me)} · `}<LocalTime iso={batch.closed_at} /></>}</Detail>
        </dl>
        {canManage && batch.status === "open" && (
          <div className="action-row">
            <Button variant="primary" onClick={() => setClosing(true)}>
              锁定批次
            </Button>
          </div>
        )}
      </section>
      <div className="card-table">
        <DataTable label="批次里的账单" columns={columns} rows={batch.statements} rowKey={(row) => row.id} state="ready" onRetry={reload} empty={<StateBlock tone="neutral" title="批次里还没有账单" description="付款复核批准后的账单会进来。" />} />
      </div>
      {closing && (
        <CloseBatchDialog
          batch={batch}
          onClose={() => setClosing(false)}
          onDone={(next) => {
            set({ batch: next });
            setClosing(false);
            toast("已锁定付款批次");
          }}
        />
      )}
    </>,
  );
}

/** 锁定付款批次的确认（不可撤销）：被拒绝时对话框不关，写明原因。 */
function CloseBatchDialog({ batch, onClose, onDone }: { batch: PayoutBatchDetail; onClose(): void; onDone(next: PayoutBatchDetail): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ text: string; final: boolean } | null>(null);
  const submit = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      onDone((await closePayoutBatch(token, batch.id)).batch);
    } catch (err) {
      if (handleAuthFailure(err)) return;
      const final = err instanceof ApiError && err.status < 500 && err.status !== 429;
      setProblem({ text: final ? failureText(err, "锁定") : `${failureText(err, "锁定")}`, final });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      title={`锁定 ${batch.pay_date} 的付款批次？`}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="text" data-autofocus disabled={busy} onClick={onClose}>
            {problem?.final ? "知道了" : "取消"}
          </Button>
          {!problem?.final && (
            <Button variant="primary" loading={busy} loadingText="锁定中…" onClick={() => void submit()}>
              锁定
            </Button>
          )}
        </>
      }
    >
      <div role="alert">{problem !== null && <Alert kind="danger">{problem.text}</Alert>}</div>
      <p>锁定后这一天不再收新的账单：之后批准的付款进下个月同一天。锁定后等银行转账。锁定不能撤销。</p>
    </Dialog>
  );
}
