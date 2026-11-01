/**
 * 运营订单详情「代供应商回传履约」（M4-18，ADR 0052）：供应商系统故障时用。没有 `order.proxy_fulfilment` 的人看不到。
 * 状态只能向前走一步，所以按当前状态只给一个按钮；确认框里写发生时间（城市当地时间）和原因。
 * 「已接到客人」之后客人和运营都不能再取消，「已完成」进供应商账单：这两步提交后要另一位同事在「待审核」里批准才生效。
 */
import { type FulfilmentEventType, FULFILMENT_EVENT_NAMES, type OrderStatus, PROXY_FULFILMENT_RULES, instantToLocal, localDateTimeToInstant, nextFulfilmentEvent, proxyEarliestHoursBeforeService, proxyEventNeedsReview } from "@nozomi/domain";
import { useState } from "react";
import { Link } from "react-router";
import { ApiError } from "../../api/client.ts";
import { type PlatformOrder, type PlatformOrderDetail, reportProxyFulfilment } from "../../api/order-money.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { Button } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { TextField } from "../../components/TextField.tsx";
import { useToast } from "../../components/Toast.tsx";
import { APPROVALS_PAGE_PATH } from "../../lib/channel-display.ts";
import { failureText } from "../../lib/failure.ts";
import { serverIssues } from "../../lib/product-failure.ts";
import { usePlatformCan } from "../../lib/use-master-access.ts";

/** 回传不了时写明为什么（待派车是最容易问的：不能跳过派车）。其余状态不显示这一块。 */
const WAITING_TEXT: Partial<Readonly<Record<OrderStatus, string>>> = {
  confirmed: "这一单还没派车。履约不能跳过派车，要等供应商派车后才能代传。",
};

/** 输入框里的数字：空的是 null，不是 0 以上的整数返回 undefined。 */
function wholeNumber(text: string): number | null | undefined {
  const value = text.trim();
  if (value === "") return null;
  return /^\d{1,6}$/.test(value) ? Number(value) : undefined;
}

function ProxyDialog({ order, type, onClose, onDone, onStale }: { order: PlatformOrder; type: FulfilmentEventType; onClose(): void; onDone(text: string): void; onStale(text: string): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const zone = order.timezone;
  const needsReview = proxyEventNeedsReview(type);
  const needsActual = type === "completed" && order.category === "charter";
  const [time, setTime] = useState(() => instantToLocal(new Date(), zone).dateTime);
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState("");
  const [km, setKm] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    const occurredAt = localDateTimeToInstant(time, zone);
    if (occurredAt === null) {
      setProblem("请填发生时间（当地时间）");
      return;
    }
    if (reason.trim() === "") {
      setProblem("请写明为什么要代传（会记进审计日志）");
      return;
    }
    const actualMinutes = wholeNumber(minutes);
    const actualKm = wholeNumber(km);
    if (needsActual && (actualMinutes === null || actualMinutes === undefined || actualKm === null || actualKm === undefined)) {
      setProblem("包车完成要填实际用了多少分钟、跑了多少公里（整数）");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const result = await reportProxyFulfilment(token, order.id, order.version, { type, occurred_at: occurredAt.toISOString(), reason: reason.trim(), ...(needsActual ? { actual: { minutes: actualMinutes as number, km: actualKm as number } } : {}) });
      onDone("approval" in result ? `已提交：要另一位同事在「待审核」里批准，「${FULFILMENT_EVENT_NAMES[type]}」才生效` : `已代传：${FULFILMENT_EVENT_NAMES[type]}`);
    } catch (err) {
      if (handleAuthFailure(err)) return;
      // 这一单刚被别人动过：关掉确认框看最新的状态，不在旧内容上重试
      if (err instanceof ApiError && err.status === 409) onStale(`${err.code === "ORDER_STATE_INVALID" ? "这一单的状态已经变了（可能供应商或司机刚回传）" : err.message}，请看最新状态后再决定。`);
      else if (err instanceof ApiError && err.code === "VALIDATION_FAILED") setProblem(serverIssues(err).map((issue) => issue.message).join("；") || failureText(err, "代传"));
      else setProblem(failureText(err, "代传"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      title={`代供应商回传：${FULFILMENT_EVENT_NAMES[type]}`}
      size="form"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="text" onClick={onClose}>
            不代传了
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            {needsReview ? "提交审核" : "确认代传"}
          </Button>
        </>
      }
    >
      <p>只在供应商系统故障、无法自己回传时使用。</p>
      <TextField label={`发生时间（当地，${zone}）`} type="datetime-local" value={time} onChange={(event) => setTime(event.target.value)} hint={`实际发生的时间，不能晚于现在，不能早于上一步，也不能早于用车前 ${proxyEarliestHoursBeforeService(type)} 小时；${PROXY_FULFILMENT_RULES.maxBackdateDays} 天以前的请走工单。`} />
      <TextField label="原因" value={reason} maxLength={PROXY_FULFILMENT_RULES.reasonMax} onChange={(event) => setReason(event.target.value)} hint="如「供应商调度系统故障，已电话和司机确认」。只有平台能看到，记进审计日志。" />
      {needsActual && (
        <>
          <TextField label="实际时长（分钟）" inputMode="numeric" value={minutes} onChange={(event) => setMinutes(event.target.value)} />
          <TextField label="实际里程（公里）" inputMode="numeric" value={km} onChange={(event) => setKm(event.target.value)} />
        </>
      )}
      <p className="field__hint">供应商看得到这一步是平台代传的，以及发生时间和系统记录时间；看不到原因和操作人。</p>
      {type === "arrived" && <Alert kind="warning">代传的「已到达」没有司机定位：这一单之后不能再提交客人未出现（no-show）。司机还能打开链接的话，请让司机自己点。</Alert>}
      {type === "picked_up" && <Alert kind="warning">接到客人之后，这一单不能再取消，也不能再提交客人未出现（no-show），而且不能撤销：提交后要另一位有权限的同事（财务或运营）批准才生效。</Alert>}
      {type === "completed" && <Alert kind="warning">已完成的单会进供应商账单，而且不能撤销：提交后要另一位有权限的同事（财务或运营）批准才生效。事后加收和投诉的时限从批准时算起。</Alert>}
      {problem !== null && <Alert kind="danger">{problem}</Alert>}
    </Dialog>
  );
}

export function ProxyFulfilmentSection({ detail, onChanged }: { detail: Pick<PlatformOrderDetail, "order" | "pending_proxy_review">; onChanged(): void }) {
  const canProxy = usePlatformCan("order.proxy_fulfilment");
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const { order } = detail;
  if (!canProxy) return null;
  const next = nextFulfilmentEvent(order.status);
  const waiting = WAITING_TEXT[order.status];
  if (next === null && waiting === undefined) return null;
  const pending = detail.pending_proxy_review;
  const finish = (text: string): void => {
    setOpen(false);
    toast(text);
    onChanged();
  };
  return (
    <section className="card" aria-labelledby="order-proxy-fulfilment">
      <h2 className="card__title" id="order-proxy-fulfilment">
        代供应商回传履约
      </h2>
      {pending !== null ? (
        <Alert kind="info">
          {`代传「${FULFILMENT_EVENT_NAMES[pending.event]}」在等另一位同事批准，批准后才生效。`}
          <Link className="link" to={APPROVALS_PAGE_PATH}>
            去待审核
          </Link>
        </Alert>
      ) : next === null ? (
        <p className="table__muted">{waiting}</p>
      ) : (
        <div className="action-row">
          <span className="table__muted">{`下一步：${FULFILMENT_EVENT_NAMES[next]}`}</span>
          <Button variant="secondary" onClick={() => setOpen(true)}>
            {`代传「${FULFILMENT_EVENT_NAMES[next]}」`}
          </Button>
        </div>
      )}
      {open && next !== null && <ProxyDialog order={order} type={next} onClose={() => setOpen(false)} onDone={finish} onStale={finish} />}
    </section>
  );
}
