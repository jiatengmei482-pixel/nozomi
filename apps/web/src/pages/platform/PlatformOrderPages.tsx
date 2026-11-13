/**
 * 运营后台「订单」（M3-03，ADR 0029；订单中心的筛选和异常、工单在 M4-03，页面说明 docs/design/pages/platform-orders.md）：
 * - 列表：跨供应商、跨渠道，按订单号 / 渠道订单号、状态、用车日期、下单日期、城市、品类、有没有异常、乘客找（`order.read`）；每一行带没处理完的异常数；
 * - 详情里「异常」「工单」两块：这一单的全部异常和工单，`ticket.manage` 能从这里新建工单；
 * - 详情：行程、乘客、对外价和结算价、这一单的取消阶梯、取消结果；全部收款和退款（失败的退款财务可以重试，`payment.manage`）；改单的改前改后；事后加收（审核：`order.manage`；扣款失败的重试：`payment.manage`）；
 * - 代客人取消（`order.manage`）：选原因、写说明、先看试算；多退给客人的（免收取消费、免费的原因）提交后要另一位同事批准；
 * - 代客人改单（`order.manage`）：航班号、乘客、备注、人数行李、用车时间（城市当地时间）；
 * - 派车、履约时间点、落地（M4-19）；代供应商回传履约（M4-18，`order.proxy_fulfilment`）。
 */
import { ANONYMIZED_TEXT, VIEW_LINK_VERIFICATIONS, VIEW_LINK_VERIFICATION_NAMES, type ViewLinkVerification } from "@nozomi/domain";
import { entrySourceText } from "../../lib/embed-display.ts";
import { TextAreaField } from "../../components/TextAreaField.tsx";
import { APPROVALS_PAGE_PATH } from "../../lib/channel-display.ts";
import { RevealedTexts } from "./PassengerReveal.tsx";
import { type OrderCancelReason, type OrderStatus, ORDER_STATUSES, ORDER_STATUS_NAMES, SERVICE_CATEGORIES, type ServiceCategory, localDateTimeToInstant } from "@nozomi/domain";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ApiError } from "../../api/client.ts";
import type { ListPage } from "../../api/dispatch.ts";
import {
  type CancelFee,
  type OrderChangeRequest,
  type ChangeDecision,
  type PlatformExtraCharge,
  type PlatformOrderChange,
  decidePlatformChange,
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
  type PassengerEmailReview,
  type PassengerReveal,
  revealPlatformPassenger,
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
import { OrderAddonsItem } from "../../components/OrderAddons.tsx";
import { OrderVehicleDetails } from "../../components/VehicleLabelFacts.tsx";
import { OrderAreaPriceItems } from "../../components/OrderAreaPriceItems.tsx";
import { OrderStopsItem } from "../../components/TripStops.tsx";
import { listAllMaster } from "../../api/master.ts";
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
  ORDER_NO_EVENTS_TEXT,
  ORDER_NO_PAYMENTS_TEXT,
  REFUND_STATUS_BADGES,
  REVIEW_REASON_NAMES,
  amountToMinor,
  cancelReasonName,
  changeValueText,
  extraTypeName,
  levelName,
  orderCancelReasonText,
  orderEventNote,
  paymentStatusName,
  platformOrderPath,
  tiersText,
} from "../../lib/order-money-display.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { filterCityLabel, useFilterCityOptions } from "../../lib/use-city-options.ts";
import { platformOrderNotificationsPath } from "../../lib/notification-display.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan } from "../../lib/use-master-access.ts";
import { localDayInstant } from "../../lib/audit-display.ts";
import { EXCEPTION_QUEUE_PATH, EXCEPTION_STATUS_BADGES, OVERDUE_BADGE, TICKET_STATUS_BADGES, exceptionPath, exceptionTypeName, newPlatformTicketPath, outcomeName, platformTicketPath, ticketTypeName } from "../../lib/order-center-display.ts";
import { pageSizeOf, useCursorPages } from "../../lib/use-cursor-pages.ts";
import { tableStateOf, uuidOrNull } from "./order-center-parts.tsx";
import { NoShowEvidenceSection } from "./NoShowEvidence.tsx";
import { OrderFulfilmentSections } from "./OrderFulfilmentSections.tsx";
import { ProxyFulfilmentSection } from "./ProxyFulfilment.tsx";
import { RescueSection } from "./RescuePages.tsx";
import { ViewLinkSection } from "./ViewLinkResend.tsx";

const NO_ACCESS = <StateBlock tone="neutral" title="你没有权限查看这里" description="需要的话，请联系管理员开通。" />;
const TRAIL = [{ label: "订单", to: PLATFORM_ORDER_LIST_PATH }];
/** 服务开始之前还能取消的状态（和后端同一份） */
const CANCELLABLE: readonly OrderStatus[] = ["pending_payment", "confirmed", "assigned", "departed", "arrived", "rescue_pending"];
const CHANGEABLE: readonly OrderStatus[] = ["confirmed", "assigned", "departed", "arrived"];

/** 订单中心的筛选条件（网址参数名 → 说明）；状态、订单号原来就有，其余是 M4-02 加的。 */
const ORDER_FILTERS = ["status", "service_from", "service_to", "created_from", "created_to", "city", "category", "exception", "passenger"] as const;

function OrderFilters({ cityOptions, citiesState, citiesEmptyText }: { cityOptions: { value: string; label: string; detail?: string; keywords?: string }[]; citiesState: string; citiesEmptyText: string }) {
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
      <Combobox inline label="城市" clearLabel="全部" placeholder="全部" options={cityOptions} value={uuidOrNull(city)} onChange={setCity} loading={cityOptions.length === 0 && citiesState === "loading"} loadFailed={cityOptions.length === 0 && citiesState === "error"} emptyText={citiesEmptyText} />
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
  const cities = useFilterCityOptions(canRead);
  const cityOptions = useMemo(() => (cities.state.data ?? []).map((entry) => ({ value: entry.id, label: filterCityLabel(entry), detail: entry.code, keywords: Object.values(entry.name).join(" ") })), [cities.state.data]);
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
        <OrderFilters cityOptions={cityOptions} citiesState={cities.state.status} citiesEmptyText={cities.emptyText} />
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

/** 乘客：默认打码，点「查看」才取全文（每次记审计，ADR 0052）。只读员工一样。 */
function PassengerContact({ order }: { order: PlatformOrder }) {
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const [revealed, setRevealed] = useState<PassengerReveal | null>(null);
  const [busy, setBusy] = useState(false);
  const show = async (): Promise<void> => {
    setBusy(true);
    try {
      setRevealed(await revealPlatformPassenger(token, order.id));
    } catch (err) {
      if (!handleAuthFailure(err)) toast(failureText(err, "查看"));
    } finally {
      setBusy(false);
    }
  };
  const shown = revealed?.passenger ?? order.passenger;
  const shownRider = revealed === null ? order.rider : revealed.rider;
  const anonymized = order.passenger_anonymized_at !== null && order.passenger_anonymized_at !== undefined;
  if (anonymized) {
    return (
      <>
        {`${ANONYMIZED_TEXT} · ${order.passengers} 人 ${order.luggage} 件行李`}
        <span className="field__hint">订单结束超过保存期限，乘客姓名、电话、邮箱已按隐私规则清除，无法恢复。</span>
      </>
    );
  }
  return (
    <>
      {`${shown.name} · ${shown.phone}${revealed === null ? "" : ` · ${shown.email}`} · ${order.passengers} 人 ${order.luggage} 件行李`}
      {/* 乘车人和举牌姓名（M8-32）：和联系人一样默认打码，点「查看」后是原文 */}
      {shownRider?.name != null && <span className="field__hint">{`乘车人：${shownRider.name}${shownRider.phone === null ? "" : ` · ${shownRider.phone}`}（上面是联系人 / 预订人）`}</span>}
      {shownRider?.sign_name != null && <span className="field__hint">{`举牌姓名：${shownRider.sign_name}`}</span>}
      {revealed !== null && (
        <>
          {revealed.messaging !== null && <span className="field__hint">{`即时通讯：${revealed.messaging.app} ${revealed.messaging.handle}`}</span>}
          {revealed.notes !== null && <span className="field__hint prewrap">{`备注原文：${revealed.notes}`}</span>}
          <RevealedTexts texts={revealed.texts} />
        </>
      )}
      {revealed === null && (
        <>
          {" "}
          <Button variant="text" size="sm" loading={busy} onClick={() => void show()}>
            查看联系方式
          </Button>
          <span className="field__hint">查看会记进审计日志。</span>
        </>
      )}
    </>
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
    setFee(null);
    setProblem(null);
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
const DECIDE_NAMES: Readonly<Record<ChangeDecision, string>> = { confirm: "代供应商同意", reject: "代供应商拒绝", adjusting: "代供应商标记调整中" };

/** 运营代供应商处理修改申请（`order.change_decide`，ADR 0060）：必填原因，写审计。 */
function DecideChangeDialog({ orderId, change, decision, onClose, onDone }: { orderId: string; change: PlatformOrderChange; decision: ChangeDecision; onClose(): void; onDone(text: string): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    if (note.trim() === "") {
      setProblem("请写原因：联系过谁、为什么由平台处理");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await decidePlatformChange(token, orderId, change.id, decision, note.trim());
      onDone(`${DECIDE_NAMES[decision]}：已记录`);
    } catch (err) {
      if (!handleAuthFailure(err)) setProblem(err instanceof ApiError && err.status !== 500 ? err.message : failureText(err, DECIDE_NAMES[decision]));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      title={DECIDE_NAMES[decision]}
      size="form"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            返回
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            确认
          </Button>
        </>
      }
    >
      {problem !== null && <Alert kind="danger">{problem}</Alert>}
      <p>供应商联系不上或临近用车时才用。这次操作会写进审计，供应商看得到是平台代为处理的。</p>
      <TextField label="原因" required value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
    </Dialog>
  );
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 代改的结果说给运营听：改了邮箱的那一项要另一位同事批准（ADR 0065）。 */
function changeDoneText(change: { status: string } | null, emailReview: PassengerEmailReview | null): string {
  const base = change === null ? null : change.status === "applied" ? "已改好，已通知供应商和司机" : "修改已提交：要供应商同意才生效，确认前原预约有效";
  if (emailReview === null) return base ?? "没有要改的内容";
  const email = `乘客邮箱改成 ${emailReview.email_masked} 需要另一位同事在「待审核」里批准，批准前订单上的邮箱不变`;
  return base === null ? `已提交：${email}` : `${base}；${email}`;
}

function ChangeDialog({ order, emailPending, onClose, onDone }: { order: PlatformOrder; emailPending: PassengerEmailReview | null; onClose(): void; onDone(text: string): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const [email, setEmail] = useState("");
  const [verification, setVerification] = useState<ViewLinkVerification | "">("");
  const [reason, setReason] = useState("");
  const [flight, setFlight] = useState(order.flight_no ?? "");
  // 备注被打了码时不能当初始值：改一个字保存就会把打码后的内容存回去、原文丢失（ADR 0055）
  const notesMasked = order.notes_masked === true;
  const [notes, setNotes] = useState(notesMasked ? "" : (order.notes ?? ""));
  const [passengers, setPassengers] = useState(String(order.passengers));
  const [luggage, setLuggage] = useState(String(order.luggage));
  const [time, setTime] = useState(order.service_local);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    const body: OrderChangeRequest = {};
    if (flight.trim() !== (order.flight_no ?? "")) body.flight_no = flight.trim() === "" ? null : flight.trim();
    if (notesMasked ? notes.trim() !== "" : notes.trim() !== (order.notes ?? "")) body.notes = notes.trim() === "" ? null : notes.trim();
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
    const newEmail = email.trim();
    if (newEmail !== "") {
      if (!EMAIL_SHAPE.test(newEmail)) {
        setProblem("新邮箱的格式不对");
        return;
      }
      if (verification === "" || reason.trim() === "") {
        setProblem("改乘客邮箱要另一位同事批准：请选怎么核实的客人身份，并写明原因");
        return;
      }
      body.passenger = { email: newEmail };
      body.email_review = { verification, reason: reason.trim() };
    }
    if (Object.keys(body).length === 0) {
      setProblem("没有要改的内容");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const result = await changePlatformOrder(token, order.id, order.version, body);
      onDone(changeDoneText(result.change ?? null, result.email_review ?? null));
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
      <TextField label="备注" value={notes} maxLength={500} onChange={(event) => setNotes(event.target.value)} {...(notesMasked ? { hint: "现在的备注含联系方式，已打码。留空不改，填写则整条替换。" } : {})} />
      {emailPending !== null ? (
        <p className="field__hint">{`乘客邮箱已经有一次修改（改成 ${emailPending.email_masked}）在等另一位同事批准，处理完之前不能再改邮箱。`}</p>
      ) : (
        <TextField label="乘客的新邮箱" type="email" inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false} value={email} onChange={(event) => setEmail(event.target.value)} hint="留空不改。改邮箱需要另一位同事批准" />
      )}
      {emailPending === null && email.trim() !== "" && (
        <>
          <Alert kind="info">改乘客邮箱需要另一位同事批准：之后带订单链接的通知都会发到新邮箱，等于把订单交给这个邮箱的主人。批准前订单上的邮箱不变，通知照旧发到原来的邮箱；同一次提交的其他内容照常处理。</Alert>
          <SelectField label="怎么核实的客人身份" required placeholder="请选择" value={verification} options={VIEW_LINK_VERIFICATIONS.map((value) => ({ value, label: VIEW_LINK_VERIFICATION_NAMES[value] }))} onChange={(value) => setVerification(value as ViewLinkVerification)} />
          <TextAreaField label="原因" required maxLength={500} value={reason} hint="如「客人来电说邮箱写错一个字母，回拨下单电话确认是本人」。审核的同事据此决定，记进审计日志。" onChange={(event) => setReason(event.target.value)} />
        </>
      )}
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
  const canDecideChange = usePlatformCan("order.change_decide");
  const [decidingChange, setDecidingChange] = useState<{ change: PlatformOrderChange; decision: ChangeDecision } | null>(null);
  const canPayment = usePlatformCan("payment.manage");
  const canSeeNotifications = usePlatformCan("notification.read");
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
          <OrderStopsItem order={order} />
          {order.flight_no && <Detail label="航班号"><span className="mono">{order.flight_no}</span></Detail>}
          <OrderVehicleDetails group={detail.vehicle_group} />
          <OrderAreaPriceItems audience="platform" pricingRoute={detail.pricing_route} distance={detail.distance} areaSurcharge={detail.area_surcharge} pricingBasis={detail.pricing_basis} mileage={detail.mileage} itinerary={order.settlement.itinerary} />
          <OrderAddonsItem addons={order.addons} cacheKey="platform-addons-catalog" load={(token) => listAllMaster("addons", token, { status: "all" })} />
          <Detail label="乘客"><PassengerContact key={order.id} order={order} /></Detail>
          {detail.pending_email_review && (
            <Detail label="乘客邮箱（等审核）">
              <Alert kind="info">
                {`改成 ${detail.pending_email_review.email_masked} 在等另一位同事批准（${detail.pending_email_review.requested_by.name} 发起），批准前订单上的邮箱不变，通知照旧发到原来的邮箱。`}
                <Link className="link" to={APPROVALS_PAGE_PATH}>
                  去待审核
                </Link>
              </Alert>
            </Detail>
          )}
          {order.notes && <Detail label="备注">{order.notes}</Detail>}
          <Detail label="供应商">{order.tenant.name}</Detail>
          <Detail label="渠道">{`${order.channel.name}${order.channel_order_no ? `（${order.channel_order_no}）` : ""}`}</Detail>
          {detail.entry_source !== undefined && <Detail label="来源">{entrySourceText(detail.entry_source)}</Detail>}
          <Detail label="对外价 / 结算价"><span className="price">{`${moneyText(order.sell)} / ${moneyText(order.settlement.total)}（加价 ${order.markup_bp / 100}%）`}</span></Detail>
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

      <OrderFulfilmentSections detail={detail} />
      <NoShowEvidenceSection detail={detail} />

      <ProxyFulfilmentSection detail={detail} onChanged={reload} />

      <RescueSection order={order} rescues={detail.rescues} onChanged={reload} />

      <ViewLinkSection orderId={order.id} />

      {cancelled !== null && (
        <section className="card">
          <h2 className="card__title">取消</h2>
          <dl className="details">
            <Detail label="原因">{orderCancelReasonText(cancelled.reason, order.confirmed_at !== null)}</Detail>
            {cancelled.note && <Detail label="说明">{cancelled.note}</Detail>}
            <Detail label="扣款比例">{cancelled.fee_bp === null ? "付款前取消，不涉及钱" : `${cancelled.fee_bp / 100}%`}</Detail>
            {cancelled.customer_fee && <Detail label="客人被扣">{moneyText(cancelled.customer_fee)}</Detail>}
            {cancelled.tenant_share && <Detail label="供应商应得">{moneyText(cancelled.tenant_share)}</Detail>}
          </dl>
        </section>
      )}

      <section className="card">
        <h2 className="card__title">收款与退款</h2>
        {detail.payments.length === 0 && detail.refunds.length === 0 && <p className="table__muted">{ORDER_NO_PAYMENTS_TEXT}</p>}
        <ul className="plain-list">
          {detail.payments.map((payment) => (
            <li key={payment.id}>{`${payment.kind === "order" ? "下单付款" : payment.kind === "change" ? "改期补差价" : "事后加收"} · ${moneyText(payment.amount)} · ${paymentStatusName(payment.status)}${payment.refunded.amount !== "0" && payment.refunded.amount !== "0.00" ? ` · 已退 ${moneyText(payment.refunded)}` : ""}${payment.last_error?.decline_code ? ` · 被拒：${payment.last_error.decline_code}` : ""}`}</li>
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
                {change.decided_by_platform && "（平台代为处理）"}
                {change.decision_note !== null && `；说明：${change.decision_note}`}
                {canDecideChange && (change.status === "pending_confirmation" || change.status === "adjusting") && (
                  <div className="form__actions">
                    <Button size="sm" variant="secondary" onClick={() => setDecidingChange({ change, decision: "confirm" })}>
                      代同意
                    </Button>
                    {change.status === "pending_confirmation" && (
                      <Button size="sm" variant="secondary" onClick={() => setDecidingChange({ change, decision: "adjusting" })}>
                        代标调整中
                      </Button>
                    )}
                    <Button size="sm" variant="text" onClick={() => setDecidingChange({ change, decision: "reject" })}>
                      代拒绝
                    </Button>
                  </div>
                )}
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

      {canSeeNotifications && (
        <section className="card" aria-labelledby="order-notifications">
          <h2 className="card__title" id="order-notifications">
            通知
          </h2>
          <div className="action-row">
            <Link className="link" to={platformOrderNotificationsPath(order.id)}>
              看这一单发过哪些通知
            </Link>
          </div>
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
          {canTicket && order.confirmed_at !== null && (
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
        {detail.events.length === 0 && <p className="table__muted">{ORDER_NO_EVENTS_TEXT}</p>}
        <ul className="plain-list">
          {detail.events.map((event, index) => (
            <li key={`${event.occurred_at}-${index}`}>
              <time dateTime={event.occurred_at}>{formatLocalDateTime(event.occurred_at)}</time>
              {` ${event.from_status === null ? "" : `${ORDER_STATUS_BADGES[event.from_status].label} → `}${ORDER_STATUS_BADGES[event.to_status].label}${orderEventNote(event, order.confirmed_at !== null)}`}
              {event.source === "platform_proxy" && (
                <>
                  {" "}
                  <span className="tag">平台代传</span>
                  <span className="table__muted">{` 系统记录 ${event.recorded_at === null ? "—" : formatLocalDateTime(event.recorded_at)}${event.proxy?.reason ? `；原因：${event.proxy.reason}` : ""}`}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>

      {dialog === "cancel" && <CancelDialog order={order} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "change" && <ChangeDialog order={order} emailPending={detail.pending_email_review ?? null} onClose={() => setDialog(null)} onDone={done} />}
      {decidingChange !== null && <DecideChangeDialog orderId={order.id} change={decidingChange.change} decision={decidingChange.decision} onClose={() => setDecidingChange(null)} onDone={(text) => { setDecidingChange(null); done(text); }} />}
      {typeof dialog === "object" && dialog !== null && <DecideDialog orderId={order.id} charge={dialog.decide} onClose={() => setDialog(null)} onDone={done} />}
    </>,
    `订单 ${order.order_no}`,
  );
}
