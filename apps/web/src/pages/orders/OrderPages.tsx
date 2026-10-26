/**
 * 供应商后台「订单」（M3-02，ADR 0027）：订单列表（超时未派车标红、能筛「未派车」「超时未派车」）和订单详情（派车 / 改派、司机链接、履约时间点、落地时间、
 * 照片和联系记录、no-show 的 5 项证据、状态流水）。看：`order.read`；派车、司机链接、回传：`order.dispatch`（管理员、调度）。
 * M3-03（ADR 0029）：详情里另有这一单的取消阶梯和取消结果、客人的改单（24 小时内的改期要确认）、事后加收（提交、撤回、上传票据；`order.extra_charge`）。
 * 页面上没有对外价和加价比例（规则 4：接口里本来就没有），只有结算价。用车有关的时间按服务城市的当地时间显示（设计规范 04 第 4 节）。
 */
import { CancellationSection, ChangesSection, ExtraChargesSection } from "./OrderMoneySections.tsx";
import { NO_SHOW_ITEM_NAMES, ORDER_STATUSES, type OrderStatus } from "@nozomi/domain";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ApiError } from "../../api/client.ts";
import {
  type Assignable,
  type AssignmentConflict,
  type IssuedDriverLink,
  type ListPage,
  type OrderFile,
  type TenantOrder,
  type TenantOrderDetail,
  assignOrder,
  getAssignable,
  getOrder,
  getOrderFile,
  listOrders,
  reissueDriverLink,
  revokeDriverLink,
} from "../../api/dispatch.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button } from "../../components/Button.tsx";
import { type Column, DataTable } from "../../components/DataTable.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { CopyButton, SelectField } from "../../components/FormFields.tsx";
import { StateBlock } from "../../components/States.tsx";
import { ORDER_STATUS_BADGES, StatusBadge } from "../../components/StatusBadge.tsx";
import { useToast } from "../../components/Toast.tsx";
import { CATEGORY_NAMES, ORDER_LIST_PATH, directionName, driverLinkUrl, formatInZone, landingSourceName, moneyText, orderPath, routeText, serviceLocalText } from "../../lib/dispatch-display.ts";
import { failureText } from "../../lib/failure.ts";
import { formatLocalDateTime } from "../../lib/master-display.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { useTenantCan } from "../../lib/use-master-access.ts";
import { DECLARABLE, DeclareUnableDialog, TenantRescueSection } from "../rescues/TenantRescuePages.tsx";

const TRAIL = [{ label: "订单", to: ORDER_LIST_PATH }];
const NO_ACCESS = <StateBlock tone="neutral" title="你没有权限查看这里" description="需要的话，请联系你们的管理员开通。" />;

function tableState(status: string): "ready" | "forbidden" | "error" | "loading" {
  return status === "ready" ? "ready" : status === "forbidden" ? "forbidden" : status === "error" ? "error" : "loading";
}

function DispatchCell({ order }: { order: TenantOrder }) {
  const { dispatch } = order;
  if (dispatch.driver !== null && dispatch.vehicle !== null) {
    return (
      <span className="table__names">
        <span>{dispatch.driver.name}</span>
        <span className="table__other-names mono">{dispatch.vehicle.plate}</span>
      </span>
    );
  }
  if (order.status !== "confirmed") return <span className="table__muted">—</span>;
  return (
    <span className="table__names">
      {dispatch.overdue ? <StatusBadge tone="danger" label="超时未派车" /> : <StatusBadge tone="warning" label="未派车" />}
      <span className="table__other-names">{`截止 ${formatInZone(dispatch.due_at, order.timezone)}`}</span>
    </span>
  );
}

export function OrderListPage() {
  const { portal, account } = usePortalSession();
  useDocumentTitle(`订单 · NOZOMI ${portal.name}`);
  const canRead = useTenantCan("order.read");
  const [params, setParams] = useSearchParams();
  const statusParam = params.get("status");
  const status = (ORDER_STATUSES as readonly string[]).includes(statusParam ?? "") ? (statusParam as OrderStatus) : null;
  const dispatchParam = params.get("dispatch");
  const dispatch = dispatchParam === "unassigned" || dispatchParam === "overdue" ? dispatchParam : null;
  const key = `orders|${status ?? ""}|${dispatch ?? ""}`;
  const { state, reload } = useLoad<ListPage<TenantOrder>>(key, canRead ? (t) => listOrders(t, { limit: 100, ...(status ? { status } : {}), ...(dispatch ? { dispatch } : {}) }) : null);
  const overdue = useLoad<ListPage<TenantOrder>>("orders|overdue-count", canRead ? (t) => listOrders(t, { limit: 1, dispatch: "overdue" }) : null);

  if (account.status === "ready" && !canRead) {
    return (
      <AppShell pageName="订单" trail={[]}>
        <Page title="订单">{NO_ACCESS}</Page>
      </AppShell>
    );
  }

  const set = (name: string, value: string | null): void => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(name);
    else next.set(name, value);
    setParams(next, { replace: true });
  };
  const rows = [...(state.data?.items ?? [])].sort((a, b) => Number(b.dispatch.overdue) - Number(a.dispatch.overdue));
  const columns: Column<TenantOrder>[] = [
    {
      key: "no",
      header: "订单号",
      cell: (row) => (
        <Link className="link mono" to={orderPath(row.id)}>
          {row.order_no}
        </Link>
      ),
    },
    { key: "time", header: "用车时间（当地）", cell: (row) => <time dateTime={row.service_time}>{serviceLocalText(row)}</time> },
    { key: "route", header: "行程", wrap: true, cell: (row) => <span className="table__names"><span>{`${directionName(row)}${row.flight_no ? ` · ${row.flight_no}` : ""}`}</span><span className="table__other-names">{routeText(row)}</span></span> },
    { key: "passenger", header: "乘客", cell: (row) => `${row.passenger.name}（${row.passengers} 人）` },
    { key: "dispatch", header: "派车", cell: (row) => <DispatchCell order={row} /> },
    { key: "status", header: "状态", cell: (row) => <StatusBadge {...ORDER_STATUS_BADGES[row.status]} /> },
    { key: "settlement", header: "结算价", align: "end", cell: (row) => moneyText(row.settlement.total) },
  ];
  const overdueCount = overdue.state.data?.total ?? 0;

  return (
    <AppShell pageName="订单" trail={[]}>
      <Page title="订单">
        {overdueCount > 0 && dispatch !== "overdue" && (
          <Alert kind="danger">
            <span>{`有 ${overdueCount} 张单过了派车截止时间还没派车。`}</span>{" "}
            <button type="button" className="link" onClick={() => set("dispatch", "overdue")}>
              只看这些
            </button>
          </Alert>
        )}
        <p className="page-intro">付款后的订单都在这里，按用车时间排列；过了派车截止时间（用车前 24 小时，付款时已不足 24 小时的是付款后 2 小时）还没派车的排在最前面、标红。</p>
        <div className="filter-bar">
          <SelectField inline label="派车" value={dispatch ?? "all"} options={[{ value: "all", label: "全部" }, { value: "unassigned", label: "未派车" }, { value: "overdue", label: "超时未派车" }]} onChange={(value) => set("dispatch", value === "all" ? null : value)} />
          <SelectField inline label="状态" value={status ?? "all"} options={[{ value: "all", label: "全部" }, ...ORDER_STATUSES.filter((value) => value !== "pending_payment").map((value) => ({ value, label: ORDER_STATUS_BADGES[value].label }))]} onChange={(value) => set("status", value === "all" ? null : value)} />
        </div>
        <DataTable label="订单" columns={columns} rows={rows} rowKey={(row) => row.id} state={tableState(state.status)} onRetry={reload} empty={<StateBlock tone="neutral" title="没有符合条件的订单" description="客人付款后，订单会自动出现在这里。" />} />
      </Page>
    </AppShell>
  );
}

// ---- 详情 ----

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="details__item">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** 一张照片：带令牌取回图片，显示缩略图；「系统时间」就是系统收到照片的时间。 */
function EvidencePhoto({ orderId, file, timeZone }: { orderId: string; file: OrderFile; timeZone: string }) {
  const { token } = usePortalSession();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    getOrderFile(token, orderId, file.id).then(
      (blob) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      },
      () => setFailed(true),
    );
    return () => {
      revoked = true;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [token, orderId, file.id]);
  const kind = file.kind === "arrival_screen" ? "到达屏" : file.kind === "signboard" ? "举牌照片" : "联系截图";
  return (
    <figure className="evidence-photo">
      {url !== null ? <img src={url} alt={`${kind}，系统时间 ${formatInZone(file.uploaded_at, timeZone)}`} /> : <span className="table__muted">{failed ? "照片读不出来" : "加载中…"}</span>}
      <figcaption>
        {kind} · 系统时间 <time dateTime={file.uploaded_at}>{formatInZone(file.uploaded_at, timeZone)}</time>
      </figcaption>
    </figure>
  );
}

function DriverLinkDialog({ link, onClose }: { link: IssuedDriverLink; onClose(): void }) {
  const url = driverLinkUrl(window.location.origin, link.path);
  return (
    <Dialog
      open
      sealed
      title="司机链接"
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          我已发给司机
        </Button>
      }
    >
      <p>把这个链接发给司机（LINE、短信都可以）。司机不需要账号，在手机上打开就能看这一单、回传出发 / 到达 / 接到 / 完成。</p>
      <Alert kind="warning">链接只在这里显示这一次；关掉后看不到了，需要时重新生成（旧的会作废）。</Alert>
      <div className="field">
        <label className="field__label" htmlFor="driver-link">
          链接
        </label>
        <div className="field__control field__control--copy">
          <input className="input mono" id="driver-link" readOnly value={url} onFocus={(event) => event.target.select()} />
          <CopyButton text={url} label="复制链接" />
        </div>
        <p className="field__hint">{`有效期到 ${formatLocalDateTime(link.expires_at)}（用车结束后 24 小时）`}</p>
      </div>
    </Dialog>
  );
}

function conflictText(conflicts: readonly AssignmentConflict[]): string {
  return conflicts.map((conflict) => `${conflict.resource === "driver" ? "司机" : "车辆"}在 ${conflict.order_no} 那一单`).join("；");
}

function AssignDialog({ order, onClose, onAssigned }: { order: TenantOrder; onClose(): void; onAssigned(result: { order: TenantOrder; link: IssuedDriverLink | null }): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const { state } = useLoad<Assignable>(`assignable|${order.id}|${order.version}`, (t) => getAssignable(t, order.id));
  const [driverId, setDriverId] = useState(order.dispatch.driver?.id ?? "");
  const [vehicleId, setVehicleId] = useState(order.dispatch.vehicle?.id ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<AssignmentConflict[] | null>(null);
  const [working, setWorking] = useState(false);
  const data = state.data;
  const driver = data?.drivers.find((entry) => entry.driver.id === driverId) ?? null;
  const vehicle = data?.vehicles.find((entry) => entry.vehicle.id === vehicleId) ?? null;
  const warnings = [...(driver?.conflicts ?? []), ...(vehicle?.conflicts ?? [])];

  const submit = async (confirmConflicts: boolean): Promise<void> => {
    if (driverId === "" || vehicleId === "") {
      setProblem("请选择司机和车辆");
      return;
    }
    setWorking(true);
    setProblem(null);
    try {
      const result = await assignOrder(token, order.id, order.version, { driver_id: driverId, vehicle_id: vehicleId, confirm_conflicts: confirmConflicts });
      onAssigned({ order: result.order, link: result.driver_link });
    } catch (err) {
      if (handleAuthFailure(err)) return;
      if (err instanceof ApiError && err.code === "ASSIGNMENT_CONFLICT") setConfirming((err.details["conflicts"] as AssignmentConflict[] | undefined) ?? []);
      else if (err instanceof ApiError && err.code === "ASSIGNMENT_MISMATCH") setProblem(((err.details["issues"] as { message: string }[] | undefined) ?? []).map((issue) => issue.message).join("；"));
      else if (err instanceof ApiError && err.code === "VERSION_CONFLICT") setProblem("这张单刚被别人派过或改过，请关掉后刷新再派。");
      else if (err instanceof ApiError && err.code === "ORDER_STATE_INVALID") setProblem("这张单现在的状态不能派车或改派（司机已到达上车点之后不能改派）。");
      else setProblem(failureText(err, "派车"));
    } finally {
      setWorking(false);
    }
  };

  const optionLabel = (name: string, entry: { assignable: boolean; issues: { message: string }[]; conflicts: AssignmentConflict[] }): string =>
    `${name}${entry.assignable ? "" : `（不能派：${entry.issues.map((issue) => issue.message).join("、")}）`}${entry.conflicts.length > 0 ? "（同一时段有别的单）" : ""}`;

  return (
    <Dialog
      open
      title={order.dispatch.driver === null ? "派车" : "改派"}
      subtitle={order.order_no}
      size="form"
      busy={working}
      dismissOnBackdrop={false}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={working}>
            取消
          </Button>
          {confirming === null ? (
            <Button variant="primary" loading={working} loadingText="派车中…" onClick={() => void submit(false)} disabled={state.status !== "ready"}>
              确定派车
            </Button>
          ) : (
            <Button variant="primary" loading={working} loadingText="派车中…" onClick={() => void submit(true)}>
              仍然派车
            </Button>
          )}
        </>
      }
    >
      {state.status === "loading" && <p className="table__muted">正在取可派的司机和车辆…</p>}
      {state.status === "error" && <Alert kind="danger">可派的司机和车辆没取到，请关掉后重试。</Alert>}
      {problem !== null && <Alert kind="danger">{problem}</Alert>}
      {confirming !== null && <Alert kind="warning">{`同一时段已有别的单：${conflictText(confirming)}。确认没问题就点「仍然派车」。`}</Alert>}
      {data !== null && data !== undefined && (
        <div className="form">
          {data.drivers.length === 0 && <Alert kind="info">还没有在职的司机，请先到「车队 → 司机」登记。</Alert>}
          {data.vehicles.length === 0 && <Alert kind="info">还没有可用的车辆，请先到「车队 → 车辆」登记。</Alert>}
          <SelectField label="司机" value={driverId} options={[{ value: "", label: "请选择" }, ...data.drivers.map((entry) => ({ value: entry.driver.id, label: optionLabel(`${entry.driver.name}（${entry.driver.languages.join("/")}）`, entry) }))]} onChange={(value) => { setDriverId(value); setConfirming(null); }} />
          <SelectField label="车辆" value={vehicleId} options={[{ value: "", label: "请选择" }, ...data.vehicles.map((entry) => ({ value: entry.vehicle.id, label: optionLabel(`${entry.vehicle.plate} · ${entry.vehicle.model}`, entry) }))]} onChange={(value) => { setVehicleId(value); setConfirming(null); }} />
          {warnings.length > 0 && confirming === null && <p className="field__hint field__hint--warning">{`提示：${conflictText(warnings)}，时间有重叠。`}</p>}
          <p className="field__hint">只能派同级或更高级的车型组（升级不加价）；派车后旧的司机链接作废，会给新司机生成一个。</p>
        </div>
      )}
    </Dialog>
  );
}

export function OrderDetailPage() {
  const { id = "" } = useParams();
  const { portal, account, token, handleAuthFailure } = usePortalSession();
  const canRead = useTenantCan("order.read");
  const canDispatch = useTenantCan("order.dispatch");
  const canExtraCharge = useTenantCan("order.extra_charge");
  const toast = useToast();
  const { state, reload } = useLoad<TenantOrderDetail>(`order|${id}`, canRead ? (t) => getOrder(t, id) : null);
  const [assigning, setAssigning] = useState(false);
  const [declaring, setDeclaring] = useState(false);
  const [link, setLink] = useState<IssuedDriverLink | null>(null);
  const detail = state.data;
  useDocumentTitle(`${detail?.order.order_no ?? "订单"} · NOZOMI ${portal.name}`);
  const timeZone = detail?.order.timezone ?? "UTC";
  const checklist = useMemo(() => detail?.records.no_show_claim?.checklist ?? [], [detail]);

  const shell = (content: ReactNode, title = "订单详情"): ReactNode => (
    <AppShell pageName={title} trail={TRAIL}>
      <Page title={title}>{content}</Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);
  if (state.status === "not-found") return shell(<StateBlock tone="neutral" title="订单不存在" description="可能是链接写错了，或这张单不属于你们。" />);
  if (state.status === "error" && detail === null) return shell(<StateBlock tone="danger" title="订单没取到" description="请检查网络后刷新。" />);
  if (detail === null || detail === undefined) return shell(<p className="table__muted">加载中…</p>);
  const { order, records, events } = detail;
  const at = (iso: string | null): ReactNode => (iso === null ? "—" : <time dateTime={iso}>{formatInZone(iso, timeZone)}</time>);
  const linkActions = order.dispatch.driver !== null && canDispatch;

  const reissue = async (): Promise<void> => {
    try {
      setLink((await reissueDriverLink(token, order.id)).driver_link);
      reload();
    } catch (err) {
      if (!handleAuthFailure(err)) toast(failureText(err, "生成链接"));
    }
  };
  const revoke = async (): Promise<void> => {
    try {
      await revokeDriverLink(token, order.id);
      toast("已吊销司机链接");
      reload();
    } catch (err) {
      if (!handleAuthFailure(err)) toast(failureText(err, "吊销"));
    }
  };
  const assignable = canDispatch && ["confirmed", "assigned", "departed"].includes(order.status);

  return shell(
    <>
      {order.status === "rescue_pending" && <Alert kind="danger">这一单已进入救援改派：平台正在安排别的供应商，你们不能再派车或回传。</Alert>}
      {order.status === "rescued" && <Alert kind="info">这一单已转给救援供应商，只能查看。违约金和差价见下面的「救援改派」。</Alert>}
      {order.dispatch.overdue && <Alert kind="danger">{`已过派车截止时间（${formatInZone(order.dispatch.due_at, timeZone)}）还没派车。用车前 6 小时（${formatInZone(order.dispatch.escalation_at, timeZone)}）仍未派车会进入救援改派。`}</Alert>}
      <section className="card">
        <div className="card__title-row">
          <h2 className="card__title">行程</h2>
          <StatusBadge {...ORDER_STATUS_BADGES[order.status]} />
        </div>
        <dl className="details">
          <Detail label="订单号"><span className="mono">{order.order_no}</span></Detail>
          <Detail label={`用车时间（当地，${order.timezone}）`}><time dateTime={order.service_time}>{serviceLocalText(order)}</time></Detail>
          <Detail label="品类">{`${CATEGORY_NAMES[order.category]} · ${directionName(order)}${order.package_hours ? ` · ${order.package_hours} 小时` : ""}`}</Detail>
          <Detail label="行程">{routeText(order)}</Detail>
          {order.flight_no && <Detail label="航班号"><span className="mono">{order.flight_no}</span></Detail>}
          <Detail label="乘客">{`${order.passenger.name} · ${order.passenger.phone} · ${order.passengers} 人 ${order.luggage} 件行李`}</Detail>
          {order.messaging && <Detail label="即时通讯">{`${order.messaging.app}：${order.messaging.handle}`}</Detail>}
          {order.notes && <Detail label="备注">{order.notes}</Detail>}
          <Detail label="免费等待">{order.free_wait_minutes === null ? "不限" : `${order.free_wait_minutes} 分钟`}</Detail>
          <Detail label="结算价">{moneyText(order.settlement.total)}</Detail>
        </dl>
        {canDispatch && DECLARABLE.includes(order.status) && (
          <div className="form__actions">
            <Button variant="text" onClick={() => setDeclaring(true)}>
              声明无法履约
            </Button>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card__title-row">
          <h2 className="card__title">派车</h2>
          {assignable && (
            <Button variant={order.dispatch.driver === null ? "primary" : "secondary"} onClick={() => setAssigning(true)}>
              {order.dispatch.driver === null ? "派车" : "改派"}
            </Button>
          )}
        </div>
        <dl className="details">
          <Detail label="派车截止">{at(order.dispatch.due_at)}</Detail>
          <Detail label="司机">{order.dispatch.driver === null ? "未派" : `${order.dispatch.driver.name} · ${order.dispatch.driver.phone}`}</Detail>
          <Detail label="车辆">{order.dispatch.vehicle === null ? "未派" : `${order.dispatch.vehicle.plate} · ${order.dispatch.vehicle.model}${order.dispatch.vehicle.is_new ? "（新车）" : ""}`}</Detail>
          <Detail label="司机链接">
            {records.driver_link === null ? (
              "没有有效的链接"
            ) : (
              <span>{`${records.driver_link.status === "active" ? "有效" : "已过期"}，到 ${formatLocalDateTime(records.driver_link.expires_at)}${records.driver_link.last_used_at ? `；司机最近打开 ${formatLocalDateTime(records.driver_link.last_used_at)}` : "；司机还没打开过"}`}</span>
            )}
          </Detail>
        </dl>
        {linkActions && (
          <div className="form__actions">
            <Button variant="secondary" size="sm" onClick={() => void reissue()}>
              重新生成司机链接
            </Button>
            {records.driver_link !== null && (
              <Button variant="text" size="sm" onClick={() => void revoke()}>
                吊销链接
              </Button>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="card__title">{`履约（当地时间）`}</h2>
        <dl className="details">
          <Detail label="司机出发">{at(order.fulfilment.departed_at)}</Detail>
          <Detail label="到达上车点">
            {at(order.fulfilment.arrived_at)}
            {order.fulfilment.arrival_distance_m !== null && `（距上车点 ${order.fulfilment.arrival_distance_m} 米${order.fulfilment.arrival_within_range ? "" : "，超过 300 米"}）`}
          </Detail>
          <Detail label="接到客人">{at(order.fulfilment.picked_up_at)}</Detail>
          <Detail label="完成">{at(order.fulfilment.completed_at)}{order.fulfilment.actual_minutes !== null && `（实际 ${order.fulfilment.actual_minutes} 分钟、${order.fulfilment.actual_km ?? "—"} 公里）`}</Detail>
          {order.fulfilment.leave_requested_at && <Detail label="申请离开">{at(order.fulfilment.leave_requested_at)}</Detail>}
        </dl>
      </section>

      {order.landing !== null && (
        <section className="card">
          <h2 className="card__title">落地时间（当地时间）</h2>
          <dl className="details">
            <Detail label="实际落地">{at(order.landing.landed_at)}{`（${landingSourceName(order.landing.source)}）`}</Detail>
            <Detail label="计划到达">{at(order.landing.scheduled_at)}</Detail>
            <Detail label="客人确认">{at(order.landing.guest_reported_at)}</Detail>
            <Detail label="司机填写">{at(order.landing.driver_reported_at)}</Detail>
            <Detail label="延误">{order.landing.delay_minutes === 0 ? "没有延误" : `${order.landing.delay_minutes} 分钟${order.landing.within_delay_allowance ? "（6 小时内，顺延接机、不加收）" : "（超过 6 小时）"}`}</Detail>
          </dl>
          <p className="field__hint">取证规则：客人点「我已落地」优先；没有则取司机填写的（必须拍到达屏）；都没有取计划到达时间。两边都有、不一致时取较晚者。提交后不能改。</p>
        </section>
      )}

      {(records.files.length > 0 || records.contacts.length > 0 || records.no_show_claim !== null) && (
        <section className="card">
          <h2 className="card__title">证据</h2>
          {records.files.length > 0 && (
            <div className="evidence-grid">
              {records.files.map((file) => (
                <EvidencePhoto key={file.id} orderId={order.id} file={file} timeZone={timeZone} />
              ))}
            </div>
          )}
          {records.contacts.length > 0 && (
            <ul className="plain-list">
              {records.contacts.map((contact) => (
                <li key={contact.id}>{`${formatInZone(contact.occurred_at, timeZone)} ${contact.method === "phone" ? "打电话" : "即时通讯"}${contact.note ? `：${contact.note}` : ""}`}</li>
              ))}
            </ul>
          )}
          {records.no_show_claim !== null && (
            <>
              <h3 className="card__subtitle">{`客人未出现：${formatInZone(records.no_show_claim.submitted_at, timeZone)} 提交，等平台审核`}</h3>
              <ul className="plain-list">
                {checklist.map((entry) => (
                  <li key={entry.item}>{`${entry.ok ? "✓" : "✗"} ${NO_SHOW_ITEM_NAMES[entry.item]}`}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <TenantRescueSection rescue={detail.rescue} />
      <ChangesSection order={order} changes={detail.changes} canDecide={canDispatch} onChanged={reload} />
      <ExtraChargesSection order={order} charges={detail.extra_charges} canSubmit={canExtraCharge} onChanged={reload} />
      <CancellationSection order={order} />

      <section className="card">
        <h2 className="card__title">状态流水</h2>
        <ul className="plain-list">
          {events.map((event, index) => (
            <li key={`${event.occurred_at}-${index}`}>
              <time dateTime={event.occurred_at}>{formatLocalDateTime(event.occurred_at)}</time>
              {` ${event.from_status === null ? "" : `${ORDER_STATUS_BADGES[event.from_status].label} → `}${ORDER_STATUS_BADGES[event.to_status].label}`}
            </li>
          ))}
        </ul>
        <p className="field__hint">这一栏的时间按你的本地时区显示。</p>
      </section>

      {assigning && (
        <AssignDialog
          order={order}
          onClose={() => setAssigning(false)}
          onAssigned={(result) => {
            setAssigning(false);
            toast(order.dispatch.driver === null ? "已派车" : "已改派");
            if (result.link !== null) setLink(result.link);
            reload();
          }}
        />
      )}
      {link !== null && <DriverLinkDialog link={link} onClose={() => setLink(null)} />}
      {declaring && (
        <DeclareUnableDialog
          order={order}
          onClose={() => setDeclaring(false)}
          onDone={(text) => {
            setDeclaring(false);
            toast(text);
            reload();
          }}
        />
      )}
    </>,
    `订单 ${order.order_no}`,
  );
}
