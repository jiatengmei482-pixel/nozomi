/**
 * 运营后台的工单详情（M4-03；接口 M4-02，ADR 0034；页面说明 docs/design/pages/platform-tickets.md）。
 * - 主栏：工单本身、和供应商的对话（供应商看得到）、内部备注（只有平台看得到）；
 * - 侧栏：处理（认领、转交、征求供应商意见、判定、关闭）、判定结果和申诉、赔付（客人那边的金额、另付）、供应商应扣款项。
 * 权限：看 `ticket.read`；处理 `ticket.manage`；登记另付已付 `payment.manage`；判定达到复核阈值时由另一位有 `ticket.review` 的同事在「待审核」里批准。
 * 每一步都写审计日志（`ticket`）。
 */
import { COMPENSATION_SCENARIOS, type CompensationScenario, TICKET_OUTCOMES, type TicketOutcome, outcomeNeedsCompensation } from "@nozomi/domain";
import { type ReactNode, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { ApiError } from "../../api/client.ts";
import {
  type CompensationInput,
  type CompensationQuote,
  type PlatformTicketDetail,
  type TicketDeduction,
  addTicketMessage,
  assignTicket,
  closeTicket,
  decideTicket,
  getPlatformTicket,
  markTicketPayout,
  quoteCompensation,
  requestTenantReply,
} from "../../api/order-center.ts";
import { type PlatformOrderDetail, getPlatformOrder } from "../../api/order-money.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { RadioGroup, SelectField } from "../../components/FormFields.tsx";
import { NoteDialog } from "../../components/NoteDialog.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { TextAreaField } from "../../components/TextAreaField.tsx";
import { TextField } from "../../components/TextField.tsx";
import { useToast } from "../../components/Toast.tsx";
import { localOffsetLabel } from "../../lib/audit-display.ts";
import { APPROVALS_PAGE_PATH } from "../../lib/channel-display.ts";
import { failureText } from "../../lib/failure.ts";
import { formatLocalDateTime } from "../../lib/master-display.ts";
import {
  LIABLE_PARTY_NAMES,
  OVERDUE_BADGE,
  PAYOUT_STATUS_NAMES,
  PLATFORM_TICKETS_PAGE,
  PRIORITY_BADGES,
  TICKET_SOURCE_NAMES,
  TICKET_STATUS_BADGES,
  authorText,
  colleagueName,
  dueText,
  isZero,
  moneyLabel,
  outcomeName,
  percentLabel,
  platformTicketPath,
  priorityName,
  scenarioName,
  ticketTypeName,
} from "../../lib/order-center-display.ts";
import { amountToMinor, platformOrderPath } from "../../lib/order-money-display.ts";
import { auditLogPath } from "../../lib/platform-paths.ts";
import { DEDUCTION_STATUS_BADGES, deductionBasisText, deductionKindName } from "../../lib/rescue-display.ts";
import { useColleagues } from "../../lib/use-colleagues.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan } from "../../lib/use-master-access.ts";
import { Detail, LocalTime, NO_ACCESS } from "./order-center-parts.tsx";

const TRAIL = [{ label: "工单", to: PLATFORM_TICKETS_PAGE }];
type DialogKind = "transfer" | "request-reply" | "decide" | "close" | "payout" | null;

/** 后端拒绝判定、关闭等时给用户看的话：业务规则用后端的中文说明，几种常见的另写清楚下一步。 */
function ticketFailure(err: ApiError): string | null {
  if (err.code === "TICKET_CHANGED") return "这张工单刚被别人改过。关掉对话框后页面会刷新，请看过最新的情况再操作。";
  if (err.code === "TENANT_REPLY_PENDING") return "还在等供应商回复（24 小时内）。期限到了没回复就视为认可，那时再判定。";
  if (err.code === "APPEAL_SAME_REVIEWER") return "你判定或复核过原来那张工单，不能判它的申诉。请交给另一位同事处理。";
  if (err.code === "FX_RATE_UNAVAILABLE") return "汇率中心最近 48 小时没有客人支付币种对日元的汇率，算不出「至少等值 ¥500」。请先到汇率页处理，再判定。";
  return null;
}

function Thread({ items, empty }: { items: { id: string; who: string; at: string; body: string; internal?: boolean }[]; empty: string }) {
  if (items.length === 0) return <p className="table__muted">{empty}</p>;
  return (
    <ol className="thread">
      {items.map((item) => (
        <li key={item.id} className={item.internal ? "thread__item thread__item--internal" : "thread__item"}>
          <span className="thread__meta">
            <span>{item.who}</span>
            <LocalTime iso={item.at} />
          </span>
          <p className="thread__body">{item.body}</p>
        </li>
      ))}
    </ol>
  );
}

/** 写一条：对话（发给供应商）或内部备注。 */
function Composer({ label, button, busyText, hint, onSend }: { label: string; button: string; busyText: string; hint: string; onSend(body: string): Promise<void> }) {
  const { handleAuthFailure } = usePortalSession();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async (): Promise<void> => {
    if (body.trim() === "") {
      setError(`请写${label}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSend(body.trim());
      setBody("");
    } catch (err) {
      if (!handleAuthFailure(err)) setError(err instanceof ApiError ? (ticketFailure(err) ?? failureText(err, "发送")) : `${failureText(err, "发送")}你写的内容还在。`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="form">
      <TextAreaField label={label} maxLength={4000} value={body} readOnly={busy} hint={hint} errors={error === null ? [] : [error]} onChange={(event) => setBody(event.target.value)} />
      <div className="action-row">
        <Button loading={busy} loadingText={busyText} onClick={() => void send()}>
          {button}
        </Button>
      </div>
    </div>
  );
}

function QuoteTable({ quote }: { quote: CompensationQuote }) {
  const c = quote.customer;
  const t = quote.tenant;
  const rows: [string, string][] = [
    ["赔付表", `第 ${quote.table_version} 版 · ${quote.scenario_name} · 对外价的 ${percentLabel(quote.customer_bp)}`],
    ["按比例", moneyLabel(c.ratio_amount)],
    ...(isZero(c.downgrade_difference) ? [] : ([["车型差价", moneyLabel(c.downgrade_difference)]] as [string, string][])),
    ["每笔最低", `${moneyLabel(c.minimum)}${c.topped_up ? "（按比例不够，补足到最低额，补的部分平台承担）" : ""}`],
    ["赔客人合计", moneyLabel(c.compensation)],
    ...(isZero(c.reimbursement) && isZero(c.reimbursement_cap) ? [] : ([["替代交通报销", `${moneyLabel(c.reimbursement)}（上限 ${moneyLabel(c.reimbursement_cap)}）`]] as [string, string][])),
    ["退回原卡", moneyLabel(c.refund)],
    ["财务另付", moneyLabel(c.manual_payout)],
    ["供应商承担", `${moneyLabel(t.total)}（结算价 × 同一比例 ${moneyLabel(t.ratio_amount)}${isZero(t.downgrade_difference) ? "" : ` + 差价 ${moneyLabel(t.downgrade_difference)}`}${isZero(t.reimbursement) ? "" : ` + 报销 ${moneyLabel(t.reimbursement)}`}）`],
  ];
  return (
    <dl className="details">
      {rows.map(([label, value]) => (
        <Detail key={label} label={label}>
          <span className="amount">{value}</span>
        </Detail>
      ))}
    </dl>
  );
}

/** 判定：选结论、写说明；成立时选情形和责任方，先试算再提交。赔给客人的钱达到复核阈值时提交后进「待审核」。 */
function DecideDialog({ detail, onClose, onDone }: { detail: PlatformTicketDetail; onClose(): void; onDone(next: PlatformTicketDetail): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const { ticket } = detail;
  const outcomes = TICKET_OUTCOMES[ticket.type] as readonly TicketOutcome[];
  const [outcome, setOutcome] = useState<TicketOutcome | null>(outcomes.length === 1 ? (outcomes[0] as TicketOutcome) : null);
  const [note, setNote] = useState("");
  const [scenario, setScenario] = useState<CompensationScenario | "">("");
  const [liable, setLiable] = useState<"tenant" | "platform" | null>(null);
  const [difference, setDifference] = useState("");
  const [reimbursement, setReimbursement] = useState("");
  const [major, setMajor] = useState(false);
  const [driverAbsent, setDriverAbsent] = useState(false);
  const [quote, setQuote] = useState<CompensationQuote | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<{ text: string; final: boolean } | null>(null);
  const [busy, setBusy] = useState<"quote" | "decide" | null>(null);
  const needsCompensation = outcome !== null && outcomeNeedsCompensation(ticket.type, outcome);
  const order = useLoad<PlatformOrderDetail>(`decide-order|${ticket.order.id}`, needsCompensation ? (t) => getPlatformOrder(t, ticket.order.id) : null);
  const orderDetail = order.state.data;
  const customerCurrency = orderDetail?.order.sell.currency ?? null;
  const tenantCurrency = orderDetail === null || orderDetail === undefined ? null : ticket.tenant.id === orderDetail.order.tenant.id ? orderDetail.order.settlement.total.currency : (orderDetail.rescues.find((rescue) => rescue.original_tenant.id === ticket.tenant.id)?.original_settlement.currency ?? orderDetail.order.settlement.total.currency);
  // 改了任何会影响金额的条件，之前的试算就作废
  useEffect(() => setQuote(null), [outcome, scenario, liable, difference, reimbursement]);

  const compensationInput = (): CompensationInput | null => {
    const found: Record<string, string> = {};
    if (scenario === "") found["scenario"] = "请选择是哪种问题";
    if (liable === null) found["liable"] = "请选择责任方";
    let differenceMinor: number | null = null;
    let reimbursementMinor: number | null = null;
    if (scenario === "vehicle_downgrade") {
      differenceMinor = tenantCurrency === null ? null : amountToMinor(difference, tenantCurrency);
      if (differenceMinor === null) found["difference"] = `请填两个车型组的结算价之差（${tenantCurrency ?? "结算币种"}，大于 0）`;
    }
    if (scenario === "driver_no_show" && reimbursement.trim() !== "") {
      reimbursementMinor = customerCurrency === null ? null : amountToMinor(reimbursement, customerCurrency);
      if (reimbursementMinor === null) found["reimbursement"] = `报销金额写成大于 0 的数（${customerCurrency ?? "客人支付币种"}），没有票据就不填`;
    }
    setErrors(found);
    if (Object.keys(found).length > 0 || scenario === "" || liable === null) return null;
    return { scenario, liable_party: liable, downgrade_settlement_difference: differenceMinor, reimbursement_amount: reimbursementMinor, major: liable === "tenant" && ticket.type === "complaint" && major };
  };
  const fail = (err: unknown, action: string): void => {
    if (handleAuthFailure(err)) return;
    const final = err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429 && err.code !== "VALIDATION_FAILED";
    setProblem({ text: (err instanceof ApiError ? ticketFailure(err) : null) ?? (final ? failureText(err, action) : `${failureText(err, action)}你填写的内容还在。`), final: final && err instanceof ApiError && err.code !== "COMPENSATION_NOT_APPLICABLE" && err.code !== "FX_RATE_UNAVAILABLE" });
  };
  const runQuote = async (): Promise<void> => {
    const input = compensationInput();
    if (input === null) return;
    setBusy("quote");
    setProblem(null);
    try {
      setQuote((await quoteCompensation(token, ticket.id, input)).quote);
    } catch (err) {
      fail(err, "试算");
    } finally {
      setBusy(null);
    }
  };
  const submit = async (): Promise<void> => {
    const found: Record<string, string> = {};
    if (outcome === null) found["outcome"] = "请选择结论";
    if (note.trim() === "") found["note"] = "请写判定说明：依据是什么";
    let compensation: CompensationInput | null = null;
    if (needsCompensation) {
      compensation = compensationInput();
      if (compensation === null) return;
      if (quote === null) found["quote"] = "成立的要先点「试算」，看过赔多少再提交";
    }
    setErrors((current) => ({ ...current, ...found }));
    if (Object.keys(found).length > 0 || outcome === null) return;
    setBusy("decide");
    setProblem(null);
    try {
      const next = await decideTicket(token, ticket.id, { outcome, note: note.trim(), compensation, driver_absent: ticket.type === "no_show_review" && outcome === "rejected" && driverAbsent });
      onDone(next);
    } catch (err) {
      fail(err, "判定");
    } finally {
      setBusy(null);
    }
  };
  return (
    <Dialog
      open
      title={`判定：${ticketTypeName(ticket.type)}`}
      size="form"
      busy={busy !== null}
      dismissOnBackdrop={false}
      onClose={onClose}
      footer={
        <>
          <Button variant="text" data-autofocus={problem?.final ? true : undefined} disabled={busy !== null} onClick={onClose}>
            {problem?.final ? "知道了" : "取消"}
          </Button>
          {!problem?.final && (
            <Button variant="primary" loading={busy === "decide"} loadingText="提交中…" onClick={() => void submit()}>
              {quote?.needs_review ? "提交复核" : "确认判定"}
            </Button>
          )}
        </>
      }
    >
      <div role="alert">{problem !== null && <Alert kind="danger">{problem.text}</Alert>}</div>
      {!problem?.final && (
        <>
          <RadioGroup legend="结论" name="ticket-outcome" required value={outcome} options={outcomes.map((value) => ({ value, label: outcomeName(ticket.type, value) }))} errors={errors["outcome"] ? [errors["outcome"]] : []} onChange={(value) => setOutcome(value)} />
          {ticket.type === "no_show_review" && outcome === "rejected" && (
            <label className="choice">
              <input type="checkbox" checked={driverAbsent} onChange={(event) => setDriverAbsent(event.target.checked)} />
              <span className="choice__text">证据显示司机根本没到场（按「司机未到」计履约失败）</span>
            </label>
          )}
          {needsCompensation && (
            <>
              {order.state.status === "error" && <Alert kind="danger">订单没有加载出来，算不了赔付。请检查网络后关掉对话框重试。</Alert>}
              <SelectField label="是哪种问题（统一赔付表）" required placeholder="请选择" value={scenario} options={COMPENSATION_SCENARIOS.map((value) => ({ value, label: scenarioName(value) }))} errors={errors["scenario"] ? [errors["scenario"]] : []} onChange={(value) => setScenario(value)} />
              <RadioGroup
                legend="责任方"
                name="ticket-liable"
                required
                value={liable}
                options={[
                  { value: "tenant", label: `${LIABLE_PARTY_NAMES.tenant}（${ticket.tenant.name}）`, hint: "按结算价同一比例承担，记成它的应扣款项，计入评分" },
                  { value: "platform", label: LIABLE_PARTY_NAMES.platform, hint: "客人照样按表赔，供应商不承担、不计评分" },
                ]}
                errors={errors["liable"] ? [errors["liable"]] : []}
                onChange={(value) => setLiable(value)}
              />
              {scenario === "vehicle_downgrade" && <TextField label={`两个车型组的结算价之差（${tenantCurrency ?? "结算币种"}）`} required inputMode="decimal" value={difference} errors={errors["difference"] ? [errors["difference"]] : []} onChange={(event) => setDifference(event.target.value)} hint="从被投诉供应商的价格表看；客人那边的差价按订单报价时的汇率和加价换算" />}
              {scenario === "driver_no_show" && <TextField label={`客人凭票申请报销的替代交通（${customerCurrency ?? "客人支付币种"}，选填）`} inputMode="decimal" value={reimbursement} errors={errors["reimbursement"] ? [errors["reimbursement"]] : []} onChange={(event) => setReimbursement(event.target.value)} hint="上限是对外价的 1.5 倍，超出的不给；退不回卡上，由财务另付" />}
              {ticket.type === "complaint" && liable === "tenant" && (
                <label className="choice">
                  <input type="checkbox" checked={major} onChange={(event) => setMajor(event.target.checked)} />
                  <span className="choice__text">重大投诉（影响供应商转正式）</span>
                </label>
              )}
              <div className="action-row">
                <Button loading={busy === "quote"} loadingText="试算中…" onClick={() => void runQuote()}>
                  试算
                </Button>
                {errors["quote"] && quote === null && <span className="field__error">{errors["quote"]}</span>}
              </div>
              {quote !== null && (
                <section aria-label="试算结果">
                  <QuoteTable quote={quote} />
                  {quote.order_will_be_cancelled && <Alert kind="warning">判定后这一单会按「供应商原因」取消：客人付的钱全额退回，供应商应得 0。</Alert>}
                  {quote.needs_review && <Alert kind="warning">赔给客人的钱达到了复核阈值：提交后要另一位有审核权限的同事在「待审核」里批准才执行。</Alert>}
                </section>
              )}
            </>
          )}
          <TextAreaField label="判定说明" required maxLength={1000} value={note} errors={errors["note"] ? [errors["note"]] : []} onChange={(event) => setNote(event.target.value)} hint="依据是什么（司机定位、照片、双方说法）。供应商看得到这段说明。" />
        </>
      )}
    </Dialog>
  );
}

/** 转交给同事（或指派给别人）。 */
function TransferDialog({ detail, onClose, onDone }: { detail: PlatformTicketDetail; onClose(): void; onDone(next: PlatformTicketDetail, name: string): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const { active } = useColleagues();
  const [target, setTarget] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const choices = active.filter((person) => person.id !== detail.ticket.assignee_id);
  const submit = async (): Promise<void> => {
    if (target === "") {
      setProblem("请选择交给谁");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      onDone(await assignTicket(token, detail.ticket.id, target), choices.find((person) => person.id === target)?.name ?? "同事");
    } catch (err) {
      if (!handleAuthFailure(err)) setProblem(err instanceof ApiError ? (ticketFailure(err) ?? failureText(err, "转交")) : failureText(err, "转交"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open title="交给同事处理" size="form" busy={busy} dismissOnBackdrop={false} onClose={onClose} footer={<><Button variant="text" disabled={busy} onClick={onClose}>取消</Button><Button variant="primary" loading={busy} loadingText="提交中…" onClick={() => void submit()}>交给他</Button></>}>
      <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
      <SelectField label="交给谁" required placeholder="请选择" value={target} options={choices.map((person) => ({ value: person.id, label: person.name }))} onChange={setTarget} hint="只列在用的平台员工；对方要有处理工单的权限。" />
    </Dialog>
  );
}

function DeductionList({ items }: { items: readonly TicketDeduction[] }) {
  return (
    <ul className="plain-list">
      {items.map((deduction) => (
        <li key={deduction.id}>
          <span className="badge-row">
            <span>{`${deductionKindName(deduction.kind)} ${moneyLabel(deduction.amount)}`}</span>
            <StatusBadge {...DEDUCTION_STATUS_BADGES[deduction.status]} />
          </span>
          <span className="table__muted">{`${deductionBasisText(deduction.kind, deduction.basis, deduction.amount.currency)}${deduction.waive_reason ? `；免除说明：${deduction.waive_reason}` : ""}`}</span>
        </li>
      ))}
    </ul>
  );
}

export function TicketDetailPage() {
  const { id = "" } = useParams();
  const { portal, account, token, handleAuthFailure } = usePortalSession();
  const canRead = usePlatformCan("ticket.read");
  const canManage = usePlatformCan("ticket.manage");
  const canPayout = usePlatformCan("payment.manage");
  const canApprovals = usePlatformCan("approval.read");
  const canAudit = usePlatformCan("audit_log.read");
  const toast = useToast();
  const { names, me } = useColleagues();
  const { state, reload, set } = useLoad<PlatformTicketDetail>(`ticket|${id}`, canRead ? (t) => getPlatformTicket(t, id) : null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [claiming, setClaiming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const detail = state.data;
  const title = detail === null || detail === undefined ? "工单" : `工单 ${detail.ticket.ticket_no}`;
  useDocumentTitle(`${title} · NOZOMI ${portal.name}`);
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName={title} trail={TRAIL}>
      <Page title={title}>{content}</Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);
  if (state.status === "not-found") return shell(<StateBlock tone="neutral" title="找不到这张工单" description="它可能不在你的数据范围里，或链接有误。" />);
  if (detail === null || detail === undefined) {
    return shell(state.status === "error" ? <StateBlock title="加载失败" description="请检查网络后重试。" action={<Button variant="secondary" onClick={reload}>重试</Button>} /> : <Skeleton lines={["medium", "long", "long", "short"]} />);
  }
  const { ticket, compensation } = detail;
  const active = ticket.status === "open" || ticket.status === "awaiting_tenant" || ticket.status === "in_progress";
  const priority = PRIORITY_BADGES[ticket.priority];
  const close = (next: PlatformTicketDetail, text: string): void => {
    set(next);
    setDialog(null);
    toast(text);
  };
  const claim = async (): Promise<void> => {
    setClaiming(true);
    setNotice(null);
    try {
      set(await assignTicket(token, ticket.id, null));
      toast("已认领，现在由你处理");
    } catch (err) {
      if (!handleAuthFailure(err)) setNotice(err instanceof ApiError ? (ticketFailure(err) ?? failureText(err, "认领")) : failureText(err, "认领"));
      reload();
    } finally {
      setClaiming(false);
    }
  };
  const messages = detail.messages.map((message) => ({ id: message.id, who: authorText(message, names, "platform"), at: message.created_at, body: message.body }));
  const notes = detail.notes.filter((note) => !note.to_guest).map((note) => ({ id: note.id, who: note.author.id === me ? "你" : note.author.name, at: note.created_at, body: note.body, internal: true }));
  const guestReplies = detail.notes.filter((note) => note.to_guest).map((note) => ({ id: note.id, who: `${note.author.id === me ? "你" : note.author.name}（客人看到的是「平台的回复」）`, at: note.created_at, body: note.body }));
  const guestTicket = ticket.source === "guest" || ticket.source === "channel";
  const canClose = ticket.status === "decided" || (active && ticket.type !== "no_show_review");

  return shell(
    <>
      <div role="alert">{notice !== null && <Alert kind="warning">{notice}</Alert>}</div>
      {ticket.status === "pending_review" && (
        <Alert kind="warning">
          <strong className="alert__title">判定待复核</strong>
          <span>赔给客人的钱达到了复核阈值，要另一位有审核权限的同事批准后才执行；驳回、撤回后回到「处理中」，可以重新判定。</span>
          {canApprovals && <Link to={APPROVALS_PAGE_PATH}>去「待审核」</Link>}
        </Alert>
      )}
      <div className="detail-layout">
        <div className="detail-layout__main">
          <section className="card" aria-labelledby="ticket-summary">
            <div className="card__title-row">
              <h2 className="card__title" id="ticket-summary">
                {ticket.subject}
              </h2>
              <span className="badge-row">
                <StatusBadge {...TICKET_STATUS_BADGES[ticket.status]} />
                {priority !== null && <StatusBadge {...priority} />}
                {ticket.overdue && <StatusBadge {...OVERDUE_BADGE} />}
              </span>
            </div>
            <p className="prewrap">{ticket.description}</p>
            <dl className="details">
              <Detail label="类型">{ticketTypeName(ticket.type)}</Detail>
              <Detail label="谁提出的">{TICKET_SOURCE_NAMES[ticket.source]}</Detail>
              <Detail label="优先级">{priorityName(ticket.priority)}</Detail>
              <Detail label="订单">
                <Link className="link mono" to={platformOrderPath(ticket.order.id)}>
                  {ticket.order.order_no}
                </Link>
              </Detail>
              <Detail label="供应商">{ticket.tenant.name}</Detail>
              <Detail label="创建时间">
                <LocalTime iso={ticket.created_at} />
              </Detail>
              <Detail label="首次响应期限">{ticket.first_responded_at === null ? dueText(ticket.first_response_due_at, new Date()) : `已响应（${formatLocalDateTime(ticket.first_responded_at)}）`}</Detail>
              <Detail label="结案期限">{active ? dueText(ticket.resolution_due_at, new Date()) : <LocalTime iso={ticket.resolution_due_at} />}</Detail>
              {ticket.tenant_reply_requested_at !== null && <Detail label="征求供应商意见">{ticket.tenant_replied_at !== null ? `已回复（${formatLocalDateTime(ticket.tenant_replied_at)}）` : `等回复，期限 ${dueText(ticket.tenant_reply_due_at, new Date())}`}</Detail>}
              {detail.parent !== null && (
                <Detail label="申诉的是">
                  <Link className="link mono" to={platformTicketPath(detail.parent.id)}>
                    {detail.parent.ticket_no}
                  </Link>
                  {`（${ticketTypeName(detail.parent.type)}，${outcomeName(detail.parent.type, detail.parent.outcome)}）`}
                </Detail>
              )}
            </dl>
            <p className="table__muted">{`时间按你的本地时区（${localOffsetLabel()}）显示。`}</p>
            {canAudit && (
              <Link className="link" to={auditLogPath({ resource: "ticket", rid: ticket.id })}>
                看这张工单的操作记录
              </Link>
            )}
          </section>

          <section className="card" aria-labelledby="ticket-messages">
            <h2 className="card__title" id="ticket-messages">
              和供应商的对话
            </h2>
            <p className="table__muted">这里的每一条供应商都看得到（看不到是哪位同事写的，只显示「平台」）。</p>
            <Thread items={messages} empty="还没有对话。" />
            {canManage && active && <Composer label="发给供应商的话" button="发给供应商" busyText="发送中…" hint="要供应商在 24 小时内答复的，用右边的「征求供应商意见」。" onSend={async (body) => close(await addTicketMessage(token, ticket.id, body, "tenant"), "已发给供应商")} />}
          </section>

          {guestTicket && (
            <section className="card" aria-labelledby="ticket-guest-replies">
              <h2 className="card__title" id="ticket-guest-replies">
                回复客人
              </h2>
              <p className="table__muted">{ticket.source === "guest" ? "客人在官网订单页的「投诉和反馈」里看得到这里的回复（不显示是哪位同事）；供应商看不到。" : "渠道查这张工单时看得到这里的回复（不显示是哪位同事）；供应商看不到。"}</p>
              <Thread items={guestReplies} empty="还没有回复客人。" />
              {canManage && ticket.status !== "closed" && <Composer label="给客人的回复" button="回复客人" busyText="发送中…" hint="写给客人看的话：核实进度、结论、补偿怎么给。不要写供应商的结算价。" onSend={async (body) => close(await addTicketMessage(token, ticket.id, body, "guest"), "已回复客人")} />}
            </section>
          )}

          <section className="card" aria-labelledby="ticket-notes">
            <h2 className="card__title" id="ticket-notes">
              内部备注
            </h2>
            <p className="table__muted">只有平台员工看得到，供应商看不到。</p>
            <Thread items={notes} empty="还没有备注。" />
            {canManage && ticket.status !== "closed" && <Composer label="内部备注" button="加备注" busyText="保存中…" hint="同事之间的讨论、电话记录。" onSend={async (body) => close(await addTicketMessage(token, ticket.id, body, "internal"), "已加备注")} />}
          </section>
        </div>

        <aside className="detail-layout__aside" aria-label="处理和判定">
          <section className="card" aria-labelledby="ticket-handling">
            <h2 className="card__title" id="ticket-handling">
              处理
            </h2>
            <dl className="details">
              <Detail label="处理人">{colleagueName(ticket.assignee_id, names, me)}</Detail>
            </dl>
            {!canManage && <p className="table__muted">你可以查看，但没有处理工单的权限。</p>}
            {canManage && ticket.status === "closed" && <p className="table__muted">已关闭，不能再处理。</p>}
            {canManage && ticket.status !== "closed" && (
              <div className="action-row">
                {active && ticket.assignee_id !== me && (
                  <Button variant={ticket.assignee_id === null ? "primary" : "secondary"} loading={claiming} loadingText="认领中…" onClick={() => void claim()}>
                    {ticket.assignee_id === null ? "认领" : "改由我处理"}
                  </Button>
                )}
                {active && <Button onClick={() => setDialog("transfer")}>交给同事</Button>}
                {(ticket.status === "open" || ticket.status === "in_progress") && <Button onClick={() => setDialog("request-reply")}>征求供应商意见</Button>}
                {active && (
                  <Button variant={ticket.assignee_id === me ? "primary" : "secondary"} onClick={() => setDialog("decide")}>
                    判定
                  </Button>
                )}
                {canClose && (
                  <Button variant="secondary" onClick={() => setDialog("close")}>
                    关闭工单
                  </Button>
                )}
              </div>
            )}
            {ticket.status === "awaiting_tenant" && <p className="table__muted">{`在等供应商回复，${dueText(ticket.tenant_reply_due_at, new Date())} 之前不能判定（到期没回复视为认可）。`}</p>}
          </section>

          {(ticket.outcome !== null || detail.appeal !== null) && (
            <section className="card" aria-labelledby="ticket-decision">
              <h2 className="card__title" id="ticket-decision">
                判定
              </h2>
              <dl className="details">
                <Detail label="结论">{outcomeName(ticket.type, ticket.outcome)}</Detail>
                {ticket.liable_party !== null && <Detail label="责任方">{LIABLE_PARTY_NAMES[ticket.liable_party]}</Detail>}
                <Detail label="判定人">{colleagueName(ticket.decided_by, names, me)}</Detail>
                <Detail label="判定时间">
                  <LocalTime iso={ticket.decided_at} />
                </Detail>
                {ticket.decision_note !== null && (
                  <Detail label="说明">
                    <span className="prewrap">{ticket.decision_note}</span>
                  </Detail>
                )}
                {ticket.appeal_until !== null && (
                  <Detail label="供应商可以申诉到">
                    <LocalTime iso={ticket.appeal_until} />
                  </Detail>
                )}
                {detail.appeal !== null && (
                  <Detail label="供应商的申诉">
                    <Link className="link mono" to={platformTicketPath(detail.appeal.id)}>
                      {detail.appeal.ticket_no}
                    </Link>
                    {`（${TICKET_STATUS_BADGES[detail.appeal.status].label}${detail.appeal.outcome === null ? "" : `，${outcomeName("tenant_appeal", detail.appeal.outcome)}`}）`}
                  </Detail>
                )}
                {ticket.close_note !== null && (
                  <Detail label="关闭说明">
                    <span className="prewrap">{ticket.close_note}</span>
                  </Detail>
                )}
              </dl>
            </section>
          )}

          {compensation !== null && (
            <section className="card" aria-labelledby="ticket-compensation">
              <h2 className="card__title" id="ticket-compensation">
                赔付
              </h2>
              <dl className="details">
                <Detail label="情形">{`${compensation.scenario_name}（第 ${compensation.table_version} 版赔付表，对外价的 ${percentLabel(compensation.customer_bp)}）`}</Detail>
                <Detail label="对外价">{moneyLabel(compensation.sell)}</Detail>
                <Detail label="赔客人合计">{`${moneyLabel(compensation.compensation)}${compensation.topped_up ? `（补足到最低额 ${moneyLabel(compensation.minimum)}）` : ""}`}</Detail>
                {!isZero(compensation.reimbursement_claimed) && <Detail label="替代交通报销">{`申请 ${moneyLabel(compensation.reimbursement_claimed)}，给 ${moneyLabel(compensation.reimbursement)}（上限 ${moneyLabel(compensation.reimbursement_cap)}）`}</Detail>}
                <Detail label="退回原卡">{moneyLabel(compensation.refund)}</Detail>
                <Detail label="财务另付">{`${moneyLabel(compensation.manual_payout)} · ${PAYOUT_STATUS_NAMES[compensation.payout_status]}${compensation.payout_reference ? `（凭证 ${compensation.payout_reference}）` : ""}`}</Detail>
                <Detail label="供应商承担">{moneyLabel(compensation.tenant_total)}</Detail>
                {compensation.order_cancelled && <Detail label="订单">已按「供应商原因」取消</Detail>}
              </dl>
              {detail.refund_ids.length > 0 && (
                <p className="table__muted">
                  {`排了 ${detail.refund_ids.length} 笔退款，状态在`}
                  <Link className="link" to={platformOrderPath(ticket.order.id)}>
                    订单详情
                  </Link>
                  里看。
                </p>
              )}
              {canPayout && compensation.payout_status === "pending" && (
                <div className="action-row">
                  <Button variant="secondary" onClick={() => setDialog("payout")}>
                    登记另付已付
                  </Button>
                </div>
              )}
            </section>
          )}

          {detail.deductions.length > 0 && (
            <section className="card" aria-labelledby="ticket-deductions">
              <h2 className="card__title" id="ticket-deductions">
                供应商应扣款项
              </h2>
              <DeductionList items={detail.deductions} />
              <p className="table__muted">在供应商的账单里扣；申诉成立时全部免除。</p>
            </section>
          )}
        </aside>
      </div>

      {dialog === "transfer" && <TransferDialog detail={detail} onClose={() => setDialog(null)} onDone={(next, name) => close(next, `已交给「${name}」`)} />}
      {dialog === "decide" && (
        <DecideDialog
          detail={detail}
          onClose={() => {
            setDialog(null);
            reload();
          }}
          onDone={(next) => close(next, next.ticket.status === "pending_review" ? "判定已提交复核：另一位同事批准后才执行" : "已判定")}
        />
      )}
      {dialog === "request-reply" && (
        <NoteDialog
          title="征求供应商意见"
          intro={<p>这段话会发给供应商。它要在 24 小时内回复并说明情况；期限内不能判定，到期没回复视为认可。</p>}
          label="问供应商什么"
          hint="如「客人说司机迟到 25 分钟，请提供司机到达的定位截图」"
          confirmText="发给供应商"
          busyText="发送中…"
          action="发送"
          describe={ticketFailure}
          onClose={() => setDialog(null)}
          onSubmit={async (body) => close(await requestTenantReply(token, ticket.id, body), "已征求供应商意见，等它 24 小时内回复")}
        />
      )}
      {dialog === "close" && (
        <NoteDialog
          title="关闭这张工单？"
          intro={<p>{ticket.status === "decided" ? "判定已经执行，关闭后不能再处理。供应商仍然可以在判定后 7 天内申诉。" : "还没有判定就关闭（重复的、客人撤回的）：订单和账都不会变。关闭后不能重新打开。"}</p>}
          label="关闭说明"
          missing="请写关闭说明：为什么关闭"
          confirmText="关闭工单"
          busyText="关闭中…"
          action="关闭"
          describe={ticketFailure}
          onClose={() => setDialog(null)}
          onSubmit={async (note) => close(await closeTicket(token, ticket.id, note), "已关闭工单")}
        />
      )}
      {dialog === "payout" && compensation !== null && (
        <NoteDialog
          title="登记另付已付"
          intro={<p>{`退不回卡上的 ${moneyLabel(compensation.manual_payout)}（报销等）已经由财务另外付给客人（银行转账等）。登记后不能修改。`}</p>}
          label="转账凭证号"
          singleLine
          maxLength={200}
          missing="请填银行转账的凭证号或流水号"
          confirmText="登记"
          busyText="登记中…"
          action="登记"
          describe={ticketFailure}
          onClose={() => setDialog(null)}
          onSubmit={async (reference) => close(await markTicketPayout(token, ticket.id, reference), "已登记另付")}
        />
      )}
    </>,
  );
}
