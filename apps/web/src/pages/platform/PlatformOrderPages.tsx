/**
 * 运营后台「订单」（M3-03，ADR 0029；订单中心的筛选和异常、工单在 M4-03，页面说明 docs/design/pages/platform-orders.md）：
 * - 列表：跨供应商、跨渠道，按订单号 / 渠道订单号、状态、用车日期、下单日期、城市、品类、有没有异常、乘客找（`order.read`）；每一行带没处理完的异常数；
 * - 详情里「异常」「工单」两块：这一单的全部异常和工单，`ticket.manage` 能从这里新建工单；
 * - 详情：行程、乘客、对外价和结算价、这一单的取消阶梯、取消结果；全部收款和退款（失败的退款财务可以重试，`payment.manage`）；改单的改前改后；事后加收（审核：`order.manage`；扣款失败的重试：`payment.manage`）；
 * - 代客人取消（`order.manage`）：选原因、写说明、先看试算；多退给客人的（免收取消费、免费的原因）提交后要另一位同事批准；
 * - 代客人改单（`order.manage`）：航班号、乘客、备注、人数行李、用车时间（城市当地时间）。
 */
import { type OrderCancelReason, type OrderStatus, ORDER_STATUSES, ORDER_STATUS_NAMES, SERVICE_CATEGORIES, type ServiceCategory, localDateTimeToInstant } from "@nozomi/domain";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ApiError } from "../../api/client.ts";
import type { ListPage } from "../../api/dispatch.ts";
import {
  type CancelFee,
  type OrderChangeRequest,
  type PlatformExtraCharge,
  type PlatformOrder,
  type PlatformOrderDetail,
  type PlatformOrderQuery,
  type PlatformOrderRow,
  cancelPlatformOrder,
  changePlatformOrder,
  decideExtraCharge,
  getCancelFee,
  getPlatformOrder,
  listPlatformOrders,
  retryExtraCharge,
  retryRefund,
} from "../../api/order-money.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button, LinkButton } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { type Column, CursorPagination, DataTable } from "../../components/DataTable.tsx";
import { FilterBar, useFilterParam } from "../../components/FilterBar.tsx";
import { DateFilter, TextFilter } from "../../components/FilterFields.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { SelectField } from "../../components/FormFields.tsx";
import { StateBlock } from "../../components/States.tsx";
import { ORDER_STATUS_BADGES, StatusBadge } from "../../components/StatusBadge.tsx";
import { TextField } from "../../components/TextField.tsx";
import { useToast } from "../../components/Toast.tsx";
import { formatInZone, moneyText, routeText } from "../../lib/dispatch-display.ts";
import { failureText } from "../../lib/failure.ts";
import { formatLocalDateTime } from "../../lib/master-display.ts";
import {
  CHANGE_FIELD_NAMES,
  CHANGE_STATUS_BADGES,
  EXTRA_STATUS_BADGES,
  PLATFORM_CANCEL_REASONS,
  PLATFORM_ORDER_LIST_PATH,
  POLICY_CATEGORY_NAMES,
  REFUND_STATUS_BADGES,
  REVIEW_REASON_NAMES,
  amountToMinor,
  cancelReasonName,
  changeValueText,
  extraTypeName,
  levelName,
  platformOrderPath,
  tiersText,
} from "../../lib/order-money-display.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan } from "../../lib/use-master-access.ts";
import { localDayInstant } from "../../lib/audit-display.ts";
import { displayName } from "../../lib/master-display.ts";
import { EXCEPTION_QUEUE_PATH, EXCEPTION_STATUS_BADGES, OVERDUE_BADGE, TICKET_STATUS_BADGES, exceptionPath, exceptionTypeName, newPlatformTicketPath, outcomeName, platformTicketPath, ticketTypeName } from "../../lib/order-center-display.ts";
import { pageSizeOf, useCursorPages } from "../../lib/use-cursor-pages.ts";
import { useAllCities } from "../master/shared.tsx";
import { tableStateOf, uuidOrNull } from "./order-center-parts.tsx";
import { RescueSection } from "./RescuePages.tsx";

const NO_ACCESS = <StateBlock tone="neutral" title="你没有权限查看这里" description="需要的话，请联系管理员开通。" />;
const TRAIL = [{ label: "订单", to: PLATFORM_ORDER_LIST_PATH }];
/** 服务开始之前还能取消的状态（和后端同一份） */
const CANCELLABLE: readonly OrderStatus[] = ["pending_payment", "confirmed", "assigned", "departed", "arrived", "rescue_pending"];
const CHANGEABLE: readonly OrderStatus[] = ["confirmed", "assigned", "departed", "arrived"];

/** 订单中心的筛选条件（网址参数名 → 说明）；状态、订单号原来就有，其余是 M4-02 加的。 */
const ORDER_FILTERS = ["status", "service_from", "service_to", "created_from", "created_to", "city", "category", "exception", "passenger"] as const;

function OrderFilters({ cityOptions, citiesState }: { cityOptions: { value: string; label: string; detail?: string; keywords?: string }[]; citiesState: string }) {
  const [status, setStatus] = useFilterParam("status");
  const [city, setCity] = useFilterParam("city");
  const [category, setCategory] = useFilterParam("category");
  const [exception, setException] = useFilterParam("exception");
  return (
    <>
      <SelectField inline label="状态" value={(ORDER_STATUSES as readonly string[]).includes(status ?? "") ? (status as OrderStatus) : "all"} options={[{ value: "all", label: "全部" }, ...ORDER_STATUSES.map((value) => ({ value, label: ORDER_STATUS_NAMES[value] }))]} onChange={(value) => setStatus(value === "all" ? null : value)} />
      <SelectField inline label="异常" value={exception === "open" || exception === "none" ? exception : "all"} options={[{ value: "all", label: "全部" }, { value: "open", label: "有没处理完的异常" }, { value: "none", label: "没有异常" }]} onChange={(value) => setException(value === "all" ? null : value)} />
      <DateFilter name="service_from" label="用车日期从" />
      <DateFilter name="service_to" label="到" />
      <DateFilter name="created_from" label="下单日期从" />
      <DateFilter name="created_to" label="到" />
      <Combobox inline label="城市" clearLabel="全部" placeholder="全部" options={cityOptions} value={uuidOrNull(city)} onChange={setCity} loading={cityOptions.length === 0 && citiesState === "loading"} loadFailed={cityOptions.length === 0 && citiesState === "error"} />
      <SelectField inline label="品类" value={(SERVICE_CATEGORIES as readonly string[]).includes(category ?? "") ? (category as ServiceCategory) : "all"} options={[{ value: "all", label: "全部" }, ...SERVICE_CATEGORIES.map((value) => ({ value, label: POLICY_CATEGORY_NAMES[value] }))]} onChange={(value) => setCategory(value === "all" ? null : value)} />
      <TextFilter name="passenger" label="乘客" minLength={2} />
    </>
  );
}

export function PlatformOrderListPage() {
  const { portal, account } = usePortalSession();
  useDocumentTitle(`订单 · NOZOMI ${portal.name}`);
  const canRead = usePlatformCan("order.read");
  const [params, setParams] = useSearchParams();
  const cities = useAllCities();
  const cityOptions = useMemo(() => (cities.state.data ?? []).map((entry) => ({ value: entry.id, label: `${displayName(entry.name).text}${entry.status === "disabled" ? "（已停用）" : ""}`, detail: entry.code, keywords: Object.values(entry.name).join(" ") })), [cities.state.data]);
  const status = (ORDER_STATUSES as readonly string[]).includes(params.get("status") ?? "") ? (params.get("status") as OrderStatus) : null;
  const q = params.get("q") ?? "";
  const date = (name: string): string | null => {
    const value = params.get(name);
    return value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  };
  const serviceFrom = date("service_from");
  const serviceTo = date("service_to");
  const createdFrom = date("created_from") === null ? null : localDayInstant(date("created_from") as string, false);
  const createdTo = date("created_to") === null ? null : localDayInstant(date("created_to") as string, true);
  const city = uuidOrNull(params.get("city"));
  const categoryParam = params.get("category");
  const category = (SERVICE_CATEGORIES as readonly string[]).includes(categoryParam ?? "") ? (categoryParam as ServiceCategory) : null;
  const exceptionParam = params.get("exception");
  const exception = exceptionParam === "open" || exceptionParam === "none" ? exceptionParam : null;
  const passengerParam = (params.get("passenger") ?? "").trim();
  const passenger = passengerParam.length >= 2 ? passengerParam.slice(0, 100) : null;
  const pageSize = pageSizeOf(params.get("size"));
  const [search, setSearch] = useState(q);
  const query: PlatformOrderQuery = {
    limit: pageSize,
    ...(status === null ? {} : { status }),
    ...(q === "" ? {} : { q }),
    ...(serviceFrom === null ? {} : { service_from: serviceFrom }),
    ...(serviceTo === null ? {} : { service_to: serviceTo }),
    ...(createdFrom === null ? {} : { created_from: createdFrom }),
    ...(createdTo === null ? {} : { created_to: createdTo }),
    ...(city === null ? {} : { city_id: city }),
    ...(category === null ? {} : { category }),
    ...(exception === null ? {} : { exception }),
    ...(passenger === null ? {} : { passenger }),
  };
  const filterKey = JSON.stringify(["platform-orders", query]);
  const pages = useCursorPages(filterKey);
  const { state, reload } = useLoad<ListPage<PlatformOrderRow>>(`${filterKey}|${pages.cursor ?? ""}`, canRead ? (t) => listPlatformOrders(t, { ...query, ...(pages.cursor === null ? {} : { cursor: pages.cursor }) }) : null);
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="订单">
      <Page title="订单">{content}</Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);
  const columns: Column<PlatformOrderRow>[] = [
    { key: "no", header: "订单号", cell: (row) => <Link className="link mono" to={platformOrderPath(row.id)}>{row.order_no}</Link> },
    { key: "status", header: "状态", cell: (row) => <StatusBadge {...ORDER_STATUS_BADGES[row.status]} /> },
    {
      key: "exceptions",
      header: "异常",
      cardLabel: true,
      cell: (row) =>
        row.open_exceptions === 0 ? (
          <span className="table__muted">—</span>
        ) : (
          <Link className="link" to={`${EXCEPTION_QUEUE_PATH}?order=${encodeURIComponent(row.id)}`}>{`${row.open_exceptions} 条没处理完`}</Link>
        ),
    },
    { key: "time", header: "用车时间（当地）", cardLabel: true, cell: (row) => <time dateTime={row.service_time}>{row.service_local.replace("T", " ")}</time> },
    { key: "category", header: "品类", cell: (row) => <span className="tag">{POLICY_CATEGORY_NAMES[row.category]}</span> },
    { key: "passenger", header: "乘客", wrap: true, cardLabel: true, cell: (row) => row.passenger.name },
    { key: "tenant", header: "供应商", cell: (row) => row.tenant.name, wrap: true },
    { key: "channel", header: "渠道", cell: (row) => row.channel.name, wrap: true },
    { key: "sell", header: "对外价", cell: (row) => moneyText(row.sell), align: "end" },
    { key: "settlement", header: "结算价", cell: (row) => moneyText(row.settlement.total), align: "end" },
  ];
  const setParam = (changes: Record<string, string | null>): void => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  };
  const filtered = q !== "" || ORDER_FILTERS.some((name) => params.has(name));
  const clear = (): void => {
    setSearch("");
    setParam(Object.fromEntries(["q", ...ORDER_FILTERS].map((name) => [name, null])));
  };
  const data = state.data;
  return shell(
    <>
      <p className="page__lead">跨供应商、跨渠道的全部订单。用车日期按各城市当地的日期算；下单日期按你的本地时区算。要人处理的单在「异常队列」里。</p>
      <FilterBar
        search={
          <form
            className="order-search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              setParam({ q: search.trim() });
            }}
          >
            <TextField label="订单号或渠道订单号" value={search} onChange={(event) => setSearch(event.target.value)} />
            <Button type="submit">查找</Button>
          </form>
        }
        paramNames={ORDER_FILTERS}
        active={filtered}
        onClear={clear}
      >
        <OrderFilters cityOptions={cityOptions} citiesState={cities.state.status} />
      </FilterBar>
      <div className="card-table">
        <DataTable
          label="订单"
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(row) => row.id}
          state={tableStateOf(state.status, data !== null)}
          refreshing={state.status === "loading" && data !== null}
          onRetry={reload}
          empty={filtered ? <StateBlock tone="neutral" title="没有符合条件的订单" description="换个条件试试，或清空筛选。" action={<Button variant="secondary" onClick={clear}>清空筛选</Button>} /> : <StateBlock tone="neutral" title="还没有订单" description="渠道和官网下的单都会出现在这里。" />}
        />
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

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="details__item">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** 代客人取消：选原因、写说明；每次改原因先取一次试算。 */
function CancelDialog({ order, onClose, onDone }: { order: PlatformOrder; onClose(): void; onDone(text: string): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const [reason, setReason] = useState<OrderCancelReason>("GUEST_REQUEST");
  const [waive, setWaive] = useState(false);
  const [note, setNote] = useState("");
  const [fee, setFee] = useState<CancelFee | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    getCancelFee(token, order.id, reason, waive && reason === "GUEST_REQUEST").then(
      (result) => alive && setFee(result),
      (err: unknown) => alive && !handleAuthFailure(err) && setProblem(failureText(err, "试算")),
    );
    return () => {
      alive = false;
    };
  }, [token, order.id, reason, waive, handleAuthFailure]);
  const submit = async (): Promise<void> => {
    if (note.trim() === "") {
      setProblem("请写明原因（会记进审计日志）");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const result = await cancelPlatformOrder(token, order.id, { reason, waive_fee: waive && reason === "GUEST_REQUEST", note: note.trim() });
      onDone("approval" in result ? "多退给客人的取消要另一位同事批准：已提交到「待审核」" : "已取消，退款已经发出");
    } catch (err) {
      if (!handleAuthFailure(err)) setProblem(err instanceof ApiError && err.code === "FREE_CANCEL_NOT_APPLICABLE" ? err.message : failureText(err, "取消"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open title="代客人取消" size="form" busy={busy} onClose={onClose} footer={<><Button variant="text" onClick={onClose}>不取消了</Button><Button variant="danger" loading={busy} onClick={() => void submit()}>{fee?.needs_review ? "提交审核" : "确认取消"}</Button></>}>
      <SelectField label="取消原因" value={reason} options={PLATFORM_CANCEL_REASONS.map((value) => ({ value, label: cancelReasonName(value) }))} onChange={(value) => setReason(value)} />
      {reason === "GUEST_REQUEST" && (
        <label className="choice">
          <input type="checkbox" checked={waive} onChange={(event) => setWaive(event.target.checked)} />
          <span className="choice__text">免收取消费（要另一位同事批准）</span>
        </label>
      )}
      <TextField label="原因说明" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} hint="如「台风，机场关闭」「客人来电取消」" />
      {fee !== null && fee.cancellable && fee.stage === "paid" && (
        <dl className="details">
          <Detail label="离用车">{`${fee.hours_before_service} 小时`}</Detail>
          <Detail label="扣款比例">{`${(fee.fee_bp ?? 0) / 100}%（按取消政策 ${(fee.policy_fee_bp ?? 0) / 100}%）`}</Detail>
          <Detail label="退给客人">{fee.refund === undefined ? "—" : moneyText(fee.refund)}</Detail>
          <Detail label="供应商应得">{fee.tenant_share === undefined ? "—" : moneyText(fee.tenant_share)}</Detail>
        </dl>
      )}
      {fee !== null && fee.stage === "unpaid" && <p className="field__hint">这一单还没付款：取消后付款作废，不涉及退款。</p>}
      {fee?.needs_review && <Alert kind="warning">退给客人的比按取消政策算的多：提交后要另一位有权限的同事（财务或运营）在「待审核」里批准才会取消。</Alert>}
      {problem !== null && <Alert kind="danger">{problem}</Alert>}
    </Dialog>
  );
}

/** 代客人改单：只给改了的字段。用车时间按城市当地时间填。 */
function ChangeDialog({ order, onClose, onDone }: { order: PlatformOrder; onClose(): void; onDone(text: string): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const [flight, setFlight] = useState(order.flight_no ?? "");
  const [notes, setNotes] = useState(order.notes ?? "");
  const [passengers, setPassengers] = useState(String(order.passengers));
  const [luggage, setLuggage] = useState(String(order.luggage));
  const [time, setTime] = useState(order.service_local);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    const body: OrderChangeRequest = {};
    if (flight.trim() !== (order.flight_no ?? "")) body.flight_no = flight.trim() === "" ? null : flight.trim();
    if (notes.trim() !== (order.notes ?? "")) body.notes = notes.trim() === "" ? null : notes.trim();
    if (passengers !== String(order.passengers)) body.passengers = Number(passengers);
    if (luggage !== String(order.luggage)) body.luggage = Number(luggage);
    if (time !== order.service_local) {
      const instant = localDateTimeToInstant(time, order.timezone);
      if (instant === null) {
        setProblem("用车时间写成 YYYY-MM-DDTHH:mm（当地时间）");
        return;
      }
      body.service_time = instant.toISOString();
    }
    if (Object.keys(body).length === 0) {
      setProblem("没有要改的内容");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const { change } = await changePlatformOrder(token, order.id, order.version, body);
      onDone(change.status === "pending_confirmation" ? "改期已提交：要供应商 30 分钟内确认才生效" : "已改好，已通知供应商");
    } catch (err) {
      if (!handleAuthFailure(err)) setProblem(err instanceof ApiError && err.status !== 500 ? err.message : failureText(err, "改单"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open title="代客人改单" size="form" busy={busy} onClose={onClose} footer={<><Button variant="text" onClick={onClose}>不改了</Button><Button variant="primary" loading={busy} onClick={() => void submit()}>保存</Button></>}>
      <TextField label={`用车时间（当地，${order.timezone}）`} type="datetime-local" value={time} onChange={(event) => setTime(event.target.value)} hint="改时间会按新时间重新报价：贵了先从客人保存的卡上扣差价，便宜了退差价" />
      {order.category === "airport_transfer" && <TextField label="航班号" value={flight} onChange={(event) => setFlight(event.target.value)} />}
      <TextField label="人数" inputMode="numeric" value={passengers} onChange={(event) => setPassengers(event.target.value)} />
      <TextField label="行李" inputMode="numeric" value={luggage} onChange={(event) => setLuggage(event.target.value)} />
      <TextField label="备注" value={notes} maxLength={500} onChange={(event) => setNotes(event.target.value)} />
      <p className="field__hint">出了免费取消期只能改航班号和乘客信息；车型、品类、城市、上下车点的位置不能改（请取消后重新下单）。</p>
      {problem !== null && <Alert kind="danger">{problem}</Alert>}
    </Dialog>
  );
}

/** 审核一项加收：通过（可以填部分金额）或驳回。 */
function DecideDialog({ orderId, charge, onClose, onDone }: { orderId: string; charge: PlatformExtraCharge; onClose(): void; onDone(text: string): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const decide = async (decision: "approve" | "reject"): Promise<void> => {
    const approved = amount.trim() === "" ? null : amountToMinor(amount, charge.amount.currency);
    if (decision === "approve" && amount.trim() !== "" && approved === null) {
      setProblem("部分通过的金额写成大于 0 的数，如 3000");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const { extra_charge: result } = await decideExtraCharge(token, orderId, charge.id, { decision, approved_amount: decision === "approve" ? approved : null, note: note.trim() === "" ? null : note.trim() });
      onDone(decision === "reject" ? "已驳回，不向客人收" : result.status === "charged" ? "已通过，已从客人保存的卡上扣款" : `已通过：${EXTRA_STATUS_BADGES[result.status].label}`);
    } catch (err) {
      if (!handleAuthFailure(err)) setProblem(failureText(err, "审核"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      title={`审核加收：${extraTypeName(charge.type)}`}
      size="form"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="text" onClick={() => void decide("reject")} loading={busy}>
            驳回
          </Button>
          <Button variant="primary" onClick={() => void decide("approve")} loading={busy}>
            通过
          </Button>
        </>
      }
    >
      <dl className="details">
        <Detail label="供应商报的">{moneyText(charge.amount)}</Detail>
        <Detail label="客人要付">{moneyText(charge.customer_amount)}</Detail>
        <Detail label="转人工的原因">{charge.review_reasons.map((reason) => REVIEW_REASON_NAMES[reason] ?? reason).join("、") || "—"}</Detail>
        {charge.description && <Detail label="供应商的说明">{charge.description}</Detail>}
        {charge.dispute_reason && <Detail label="客人的异议">{charge.dispute_reason}</Detail>}
      </dl>
      <TextField label={`部分通过的金额（${charge.amount.currency}，不填就是全额）`} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
      <TextField label="说明" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
      {problem !== null && <Alert kind="danger">{problem}</Alert>}
    </Dialog>
  );
}

export function PlatformOrderDetailPage() {
  const { id = "" } = useParams();
  const { portal, account, token, handleAuthFailure } = usePortalSession();
  const canRead = usePlatformCan("order.read");
  const canManage = usePlatformCan("order.manage");
  const canPayment = usePlatformCan("payment.manage");
  const canTicket = usePlatformCan("ticket.manage");
  const canSeeTickets = usePlatformCan("ticket.read");
  const toast = useToast();
  const { state, reload } = useLoad<PlatformOrderDetail>(`platform-order|${id}`, canRead ? (t) => getPlatformOrder(t, id) : null);
  const [dialog, setDialog] = useState<"cancel" | "change" | { decide: PlatformExtraCharge } | null>(null);
  const detail = state.data;
  useDocumentTitle(`${detail?.order.order_no ?? "订单"} · NOZOMI ${portal.name}`);
  const shell = (content: ReactNode, title = "订单详情"): ReactNode => (
    <AppShell pageName={title} trail={TRAIL}>
      <Page title={title}>{content}</Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);
  if (state.status === "not-found") return shell(<StateBlock tone="neutral" title="订单不存在" description="可能是链接写错了。" />);
  if (detail === null || detail === undefined) return shell(state.status === "error" ? <StateBlock tone="danger" title="订单没取到" description="请检查网络后刷新。" /> : <p className="table__muted">加载中…</p>);
  const { order } = detail;
  const zone = order.timezone;
  const done = (text: string): void => {
    setDialog(null);
    toast(text);
    reload();
  };
  const act = async (run: () => Promise<unknown>, success: string, action: string): Promise<void> => {
    try {
      await run();
      toast(success);
      reload();
    } catch (err) {
      if (!handleAuthFailure(err)) toast(failureText(err, action));
    }
  };
  const cancelled = order.cancellation;

  return shell(
    <>
      <section className="card">
        <div className="card__title-row">
          <h2 className="card__title">行程</h2>
          <StatusBadge {...ORDER_STATUS_BADGES[order.status]} />
        </div>
        <dl className="details">
          <Detail label="订单号"><span className="mono">{order.order_no}</span></Detail>
          <Detail label={`用车时间（当地，${zone}）`}><time dateTime={order.service_time}>{order.service_local.replace("T", " ")}</time></Detail>
          <Detail label="行程">{routeText(order)}</Detail>
          {order.flight_no && <Detail label="航班号"><span className="mono">{order.flight_no}</span></Detail>}
          <Detail label="乘客">{`${order.passenger.name} · ${order.passenger.phone} · ${order.passengers} 人 ${order.luggage} 件行李`}</Detail>
          {order.notes && <Detail label="备注">{order.notes}</Detail>}
          <Detail label="供应商">{order.tenant.name}</Detail>
          <Detail label="渠道">{`${order.channel.name}${order.channel_order_no ? `（${order.channel_order_no}）` : ""}`}</Detail>
          <Detail label="对外价 / 结算价">{`${moneyText(order.sell)} / ${moneyText(order.settlement.total)}（加价 ${order.markup_bp / 100}%）`}</Detail>
          <Detail label="取消政策">{order.cancel_policy === null ? "按现在的平台政策" : `第 ${order.cancel_policy.version} 版 · ${levelName(order.cancel_policy.level)}：${tiersText(order.cancel_policy.tiers)}`}</Detail>
        </dl>
        {(canManage && (CANCELLABLE.includes(order.status) || CHANGEABLE.includes(order.status))) && (
          <div className="form__actions">
            {CHANGEABLE.includes(order.status) && (
              <Button variant="secondary" onClick={() => setDialog("change")}>
                代客人改单
              </Button>
            )}
            {CANCELLABLE.includes(order.status) && (
              <Button variant="danger" onClick={() => setDialog("cancel")}>
                代客人取消
              </Button>
            )}
          </div>
        )}
      </section>

      <RescueSection order={order} rescues={detail.rescues} onChanged={reload} />

      {cancelled !== null && (
        <section className="card">
          <h2 className="card__title">取消</h2>
          <dl className="details">
            <Detail label="原因">{cancelReasonName(cancelled.reason)}</Detail>
            {cancelled.note && <Detail label="说明">{cancelled.note}</Detail>}
            <Detail label="扣款比例">{cancelled.fee_bp === null ? "付款前取消，不涉及钱" : `${cancelled.fee_bp / 100}%`}</Detail>
            {cancelled.customer_fee && <Detail label="客人被扣">{moneyText(cancelled.customer_fee)}</Detail>}
            {cancelled.tenant_share && <Detail label="供应商应得">{moneyText(cancelled.tenant_share)}</Detail>}
          </dl>
        </section>
      )}

      <section className="card">
        <h2 className="card__title">收款与退款</h2>
        <ul className="plain-list">
          {detail.payments.map((payment) => (
            <li key={payment.id}>{`${payment.kind === "order" ? "下单付款" : payment.kind === "change" ? "改期补差价" : "事后加收"} · ${moneyText(payment.amount)} · ${payment.status}${payment.refunded.amount !== "0" && payment.refunded.amount !== "0.00" ? ` · 已退 ${moneyText(payment.refunded)}` : ""}${payment.last_error?.decline_code ? ` · 被拒：${payment.last_error.decline_code}` : ""}`}</li>
          ))}
        </ul>
        {detail.refunds.length > 0 && (
          <div className="table-wrap">
            <div className="table-scroll" tabIndex={0} role="region" aria-label="退款表">
              <table className="table">
                <caption className="visually-hidden">退款</caption>
                <thead>
                  <tr>
                    <th scope="col">退款</th>
                    <th scope="col">金额</th>
                    <th scope="col">状态</th>
                    <th scope="col">说明</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.refunds.map((refund) => (
                    <tr key={refund.id}>
                      <th scope="row">{`${refund.purpose === "cancellation" ? "取消" : refund.purpose === "compensation" ? "工单赔付" : "改单差价"}${refund.retry_of ? "（重试）" : ""}`}</th>
                      <td>{moneyText(refund.amount)}</td>
                      <td>
                        <StatusBadge {...REFUND_STATUS_BADGES[refund.status]} />
                      </td>
                      <td>
                        {refund.last_error?.code ?? ""}
                        {refund.superseded_at !== null && <span className="table__muted">已并入取消退款，不再重试</span>}
                        {refund.status === "failed" && refund.superseded_at === null && canPayment && !detail.refunds.some((entry) => entry.retry_of === refund.id) && (
                          <Button variant="text" size="sm" onClick={() => void act(() => retryRefund(token, order.id, refund.id), "已重新发起退款", "重试退款")}>
                            重试退款
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {detail.changes.length > 0 && (
        <section className="card">
          <h2 className="card__title">改单</h2>
          <ul className="plain-list">
            {detail.changes.map((change) => (
              <li key={change.id}>
                <StatusBadge {...CHANGE_STATUS_BADGES[change.status]} />
                {` ${formatLocalDateTime(change.requested_at)} `}
                {Object.keys(change.after)
                  .filter((field) => field !== "service_local")
                  .map((field) => `${CHANGE_FIELD_NAMES[field] ?? field}：${changeValueText(field, change.before[field], zone)} → ${changeValueText(field, change.after[field], zone)}`)
                  .join("；")}
                {change.sell_before !== null && change.sell_after !== null && `；对外价 ${moneyText(change.sell_before)} → ${moneyText(change.sell_after)}`}
                {change.dispatch_conflict && "（原来派的司机或车辆在新时段有别的单）"}
              </li>
            ))}
          </ul>
        </section>
      )}

      {detail.extra_charges.length > 0 && (
        <section className="card">
          <h2 className="card__title">事后加收</h2>
          <div className="table-wrap">
            <div className="table-scroll" tabIndex={0} role="region" aria-label="事后加收表">
              <table className="table">
                <caption className="visually-hidden">事后加收</caption>
                <thead>
                  <tr>
                    <th scope="col">类型</th>
                    <th scope="col">供应商报的 / 客人付</th>
                    <th scope="col">状态</th>
                    <th scope="col">异议期到</th>
                    <th scope="col">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.extra_charges.map((charge) => (
                    <tr key={charge.id}>
                      <th scope="row">{extraTypeName(charge.type)}</th>
                      <td>{`${moneyText(charge.approved_amount ?? charge.amount)} / ${moneyText(charge.customer_amount)}`}</td>
                      <td>
                        <StatusBadge {...EXTRA_STATUS_BADGES[charge.status]} />
                        {charge.review_reasons.length > 0 && <span className="table__muted">{` ${charge.review_reasons.map((reason) => REVIEW_REASON_NAMES[reason] ?? reason).join("、")}`}</span>}
                      </td>
                      <td>{formatInZone(charge.dispute_until, zone)}</td>
                      <td>
                        {canManage && (charge.status === "review" || charge.status === "disputed") && (
                          <Button variant="text" size="sm" onClick={() => setDialog({ decide: charge })}>
                            审核
                          </Button>
                        )}
                        {canPayment && charge.status === "charge_failed" && (
                          <Button variant="text" size="sm" onClick={() => void act(() => retryExtraCharge(token, order.id, charge.id), "已重新扣款", "重试扣款")}>
                            重试扣款
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="field__hint">提交后 48 小时是客人的异议期，期间不扣款；之后没有异议、不超过对外价 50%、有凭证的自动从客人保存的卡上扣，其余在这里审核。</p>
        </section>
      )}

      <section className="card" aria-labelledby="order-exceptions">
        <h2 className="card__title" id="order-exceptions">
          异常
        </h2>
        {detail.exceptions.length === 0 ? (
          <p className="table__muted">这一单没有异常。</p>
        ) : (
          <ul className="plain-list">
            {detail.exceptions.map((exception) => (
              <li key={exception.id}>
                <span className="badge-row">
                  <Link className="link" to={exceptionPath(exception.id)}>
                    {exceptionTypeName(exception.type)}
                  </Link>
                  <StatusBadge {...EXCEPTION_STATUS_BADGES[exception.status]} />
                  {exception.status !== "closed" && new Date(exception.due_at).getTime() < Date.now() && <StatusBadge {...OVERDUE_BADGE} />}
                </span>
                <span className="table__muted">{`发现 ${formatLocalDateTime(exception.opened_at)} · 时限 ${formatLocalDateTime(exception.due_at)}${exception.closed_at === null ? "" : ` · 关闭 ${formatLocalDateTime(exception.closed_at)}（${exception.close_kind === "cleared" ? "条件已解除" : "人工处理完"}）`}`}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="order-tickets">
        <div className="card__title-row">
          <h2 className="card__title" id="order-tickets">
            工单
          </h2>
          {canTicket && (
            <LinkButton variant="secondary" to={newPlatformTicketPath(order.id)}>
              新建工单
            </LinkButton>
          )}
        </div>
        {detail.tickets.length === 0 ? (
          <p className="table__muted">这一单没有工单。</p>
        ) : (
          <ul className="plain-list">
            {detail.tickets.map((ticket) => (
              <li key={ticket.id}>
                <span className="badge-row">
                  {canSeeTickets ? (
                    <Link className="link mono" to={platformTicketPath(ticket.id)}>
                      {ticket.ticket_no}
                    </Link>
                  ) : (
                    <span className="mono">{ticket.ticket_no}</span>
                  )}
                  <span className="tag">{ticketTypeName(ticket.type)}</span>
                  <StatusBadge {...TICKET_STATUS_BADGES[ticket.status]} />
                  {ticket.outcome !== null && <span>{outcomeName(ticket.type, ticket.outcome)}</span>}
                </span>
                <span className="table__muted">{`${ticket.subject} · ${formatLocalDateTime(ticket.created_at)}`}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="card__title">状态流水</h2>
        <ul className="plain-list">
          {detail.events.map((event, index) => (
            <li key={`${event.occurred_at}-${index}`}>
              <time dateTime={event.occurred_at}>{formatLocalDateTime(event.occurred_at)}</time>
              {` ${event.from_status === null ? "" : `${ORDER_STATUS_BADGES[event.from_status].label} → `}${ORDER_STATUS_BADGES[event.to_status].label}${event.reason ? `（${cancelReasonName(event.reason)}）` : ""}`}
            </li>
          ))}
        </ul>
      </section>

      {dialog === "cancel" && <CancelDialog order={order} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "change" && <ChangeDialog order={order} onClose={() => setDialog(null)} onDone={done} />}
      {typeof dialog === "object" && dialog !== null && <DecideDialog orderId={order.id} charge={dialog.decide} onClose={() => setDialog(null)} onDone={done} />}
    </>,
    `订单 ${order.order_no}`,
  );
}
