/**
 * 官网订单页的各个区块（M3-05，ADR 0032）。每个会改订单的操作都在页面内确认，结果写在区块里；出错时说明怎么办。
 * 危险或提交后不能改的操作（付款、取消、「我已落地」）先显示要发生什么，再点「确认」才提交。
 */
import { type ExtraChargeType, EXTRA_CHARGE_RULES, ORDER_FIELD_LIMITS, isFlightNo, isInternationalPhone, localDateTimeToInstant, normalizeFlightNo, normalizePhone } from "@nozomi/domain";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { ApiError } from "../../api/client.ts";
import {
  type SiteCancelFee,
  type SiteCancelReason,
  type SiteChangeRequest,
  type SiteOrder,
  type SiteOrderEnvelope,
  type SiteOrderNames,
  type SitePayment,
  type SiteTimelineEntry,
  cancelSiteOrder,
  changeSiteOrder,
  disputeSiteExtraCharge,
  getSiteCancelFee,
  getSiteOrderPayment,
  reportSiteLanded,
} from "../../api/site.ts";
import { AlertSlot, Alert, type Notice } from "../../components/Alert.tsx";
import { Button } from "../../components/Button.tsx";
import { Icon } from "../../components/Icon.tsx";
import { Skeleton } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { TextField } from "../../components/TextField.tsx";
import { moneyText } from "../../lib/dispatch-display.ts";
import { displayName } from "../../lib/master-display.ts";
import { CHANGE_FIELD_NAMES, extraTypeName } from "../../lib/order-money-display.ts";
import { type PaymentMount, usePaymentDriver } from "../../lib/payment-driver.ts";
import { forgetPaymentReturn, intentIdOf, rememberPaymentReturn } from "../../lib/payment-return.ts";
import {
  ADDRESS_LABELS,
  GUEST_CANCEL_REASON_NAMES,
  GUEST_CHANGE_STATUS_BADGES,
  GUEST_EXTRA_STATUS_BADGES,
  SITE_ORDER_PATH,
  TIMELINE_NAMES,
  addressEnds,
  freeWaitText,
  guestCancelPolicyText,
  guestInstantText,
  guestLocalText,
  landingAvailability,
  localDateTimeIn,
  packageText,
  serviceTimeLabels,
} from "../../lib/site-display.ts";
import { siteFailureText } from "./SiteLayout.tsx";

type Changed = (envelope: SiteOrderEnvelope) => void;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="site-section" aria-labelledby={id}>
      <h2 id={id} className="site-section__title">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="site-facts__item">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** 客人看的当地时间（F8）：「10月26日（周一）17:45」，不在今年的带年份。 */
const local = (order: Pick<SiteOrder, "timezone">, iso: string | null): string => guestInstantText(iso, order.timezone, new Date());
const placeName = (names: SiteOrderNames): string => (names.place === null ? "机场" : `${displayName(names.place.name).text}（${names.place.code}）`);

// ---- 付款 ----

/** 付款提交后多久刷新一次订单，等平台收到 Stripe 的通知把订单改成已确认。超过 `slowAfterMs` 还没确认就放慢，并告诉客人别重复付款。 */
export interface PaymentPolling {
  fastMs: number;
  slowMs: number;
  slowAfterMs: number;
}

export const PAYMENT_POLLING: PaymentPolling = { fastMs: 3_000, slowMs: 15_000, slowAfterMs: 120_000 };

type PanelState =
  | { kind: "loading" }
  | { kind: "ready" }
  /** 付款组件没加载出来：可以重新加载 */
  | { kind: "failed" }
  /** 这张单已经不能付款（过了付款期限、付款已取消）：等订单状态更新 */
  | { kind: "ended" }
  /** 付款已提交，等平台确认 */
  | { kind: "submitted"; outcome: "succeeded" | "processing" };

const NETWORK_TEXT = "没有连上 Stripe，这次付款可能没有提交。请检查网络后再点「付款」；同一张订单不会被扣两次。";

function submittedText(outcome: "succeeded" | "processing", slow: boolean): string {
  const head = outcome === "succeeded" ? "付款成功，等待确认。订单通常几秒钟内确认，页面会自动更新，请不要重复付款。" : "银行正在处理这笔付款，处理完订单会自动确认（通常几分钟内），页面会自动更新，请不要重复付款。";
  return slow ? `${head}确认比平时慢：您可以先关掉页面，稍后再打开这个链接查看；有疑问请联系客服。` : head;
}

function PaymentPanel({ token, order, initial, onRefresh, polling }: { token: string; order: SiteOrder; initial: SitePayment | null; onRefresh(): void; polling: PaymentPolling }) {
  const driver = usePaymentDriver();
  const container = useRef<HTMLDivElement>(null);
  const mounted = useRef<PaymentMount | null>(null);
  const intentId = useRef<string | null>(null);
  const [state, setState] = useState<PanelState>({ kind: "loading" });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);
  const [slow, setSlow] = useState(false);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  const due = local(order, order.payment_due_at);
  const submitted = state.kind === "submitted" ? state.outcome : null;

  const settle = (outcome: "succeeded" | "processing"): void => {
    mounted.current?.destroy();
    mounted.current = null;
    setConfirming(false);
    setNotice(null);
    setState({ kind: "submitted", outcome });
  };

  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    setNotice(null);
    const load = async (): Promise<void> => {
      const payment = initial?.client_secret ? initial : (await getSiteOrderPayment(token)).payment;
      if (!alive) return;
      if (payment.client_secret === null) {
        setState({ kind: "ended" });
        setNotice({ kind: "warning", text: "这张订单现在不能付款了（可能已超过付款期限），订单状态马上会更新。" });
        refresh.current();
        return;
      }
      if (container.current === null) return;
      intentId.current = intentIdOf(payment.client_secret);
      const mount = await driver.mount(container.current, { publishableKey: payment.publishable_key, clientSecret: payment.client_secret });
      if (!alive) {
        mount.destroy();
        return;
      }
      if (mount.state === "succeeded" || mount.state === "processing") {
        mount.destroy();
        setState({ kind: "submitted", outcome: mount.state });
        return;
      }
      if (mount.state === "canceled") {
        mount.destroy();
        setState({ kind: "ended" });
        setNotice({ kind: "warning", text: "这笔付款已经取消，订单状态马上会更新。" });
        refresh.current();
        return;
      }
      mounted.current = mount;
      setState({ kind: "ready" });
      if (mount.lastError !== null) setNotice({ kind: "danger", text: `上次付款没有成功：${mount.lastError}请换一张卡，或检查后再付。` });
    };
    load().catch((err: unknown) => {
      if (!alive) return;
      setState({ kind: "failed" });
      setNotice({ kind: "danger", text: err instanceof ApiError ? siteFailureText(err, "准备付款") : "付款组件没有加载出来，请检查网络后点「重新加载」。" });
    });
    return () => {
      alive = false;
      mounted.current?.destroy();
      mounted.current = null;
    };
  }, [driver, token, initial, round]);

  // 付款提交后：马上刷新一次，之后定时刷新，直到平台收到通知、订单不再是待付款（这个区块随之消失，定时器跟着停）
  useEffect(() => {
    if (submitted === null) return;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const tick = (): void => {
      refresh.current();
      const late = Date.now() - started >= polling.slowAfterMs;
      if (late) setSlow(true);
      timer = setTimeout(tick, late ? polling.slowMs : polling.fastMs);
    };
    tick();
    return () => clearTimeout(timer);
  }, [submitted, polling]);

  const askToPay = async (): Promise<void> => {
    if (mounted.current === null || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const checked = await mounted.current.validate();
      if (checked.ok) setConfirming(true);
      else setNotice({ kind: "danger", text: checked.message });
    } finally {
      setBusy(false);
    }
  };

  const pay = async (): Promise<void> => {
    if (mounted.current === null || busy) return;
    setBusy(true);
    setNotice(null);
    // 少数情况 Stripe 会整页跳去银行验证：令牌不进 return_url，先放进本标签页的 sessionStorage，回来时按付款编号取回（payment-return.ts）
    if (intentId.current !== null) rememberPaymentReturn(intentId.current, token);
    try {
      const outcome = await mounted.current.confirm(`${window.location.origin}${SITE_ORDER_PATH}`);
      forgetPaymentReturn();
      if (outcome.kind === "succeeded" || outcome.kind === "processing") {
        settle(outcome.kind);
        return;
      }
      setConfirming(false);
      setNotice({
        kind: "danger",
        text:
          outcome.kind === "declined"
            ? `付款没有成功：${outcome.message}请换一张卡，或检查后再付。`
            : outcome.kind === "network"
              ? NETWORK_TEXT
              : `付款没有完成${outcome.message === null ? "" : `：${outcome.message}`}。请稍后再试；一直不行请联系客服。`,
      });
    } finally {
      setBusy(false);
    }
  };

  // 提交后的提示和出错提示用同一个播报位置（一开始就在页面里），读屏能读出状态的变化
  const shown: Notice | null = state.kind === "submitted" ? { kind: state.outcome === "succeeded" ? "success" : "info", text: submittedText(state.outcome, slow) } : notice;
  return (
    <>
      {(state.kind === "loading" || state.kind === "ready" || state.kind === "failed") && (
        <p className="site-muted">请在当地时间 {due} 前付款，过时订单会自动取消。付款信息由 Stripe 处理，本站不保存卡号。</p>
      )}
      <AlertSlot notice={shown} />
      {state.kind !== "submitted" && <div ref={container} className="site-payment" aria-busy={state.kind === "loading"} />}
      {state.kind === "loading" && <Skeleton lines={["control", "control"]} label="正在加载付款组件" />}
      {state.kind === "failed" && <Button size="lg" onClick={() => setRound((value) => value + 1)}>重新加载</Button>}
      {state.kind === "ready" &&
        (confirming ? (
          <div className="site-confirm" role="group" aria-label="确认付款">
            <p>确认支付 {moneyText(order.price.total)}？</p>
            <p className="site-muted">如果银行要求验证，会弹出银行的验证窗口，请按提示完成。</p>
            <div className="site-actions site-actions--inline">
              <Button variant="primary" size="lg" loading={busy} loadingText="正在付款" onClick={() => void pay()}>
                确认支付
              </Button>
              <Button size="lg" disabled={busy} onClick={() => setConfirming(false)}>
                返回
              </Button>
            </div>
          </div>
        ) : (
          <div className="site-actions">
            <Button variant="primary" size="lg" block loading={busy} loadingText="正在检查" onClick={() => void askToPay()}>
              付款 {moneyText(order.price.total)}
            </Button>
          </div>
        ))}
    </>
  );
}

/** `configPayments`：undefined 还在读配置；null 没配置 Stripe（付款暂未开放）。 */
export function PaymentSection({
  token,
  order,
  configPayments,
  initial,
  onRefresh,
  polling = PAYMENT_POLLING,
}: {
  token: string;
  order: SiteOrder;
  configPayments: { publishable_key: string } | null | undefined;
  initial: SitePayment | null;
  onRefresh(): void;
  polling?: PaymentPolling;
}) {
  const due = local(order, order.payment_due_at);
  return (
    <Section id="site-payment-title" title="付款">
      {configPayments === undefined ? (
        <Skeleton lines={["control"]} label="正在读取付款方式" />
      ) : configPayments === null ? (
        <Alert kind="warning">
          付款暂未开放：订单已为您保留到当地时间 {due}，到时没有付款会自动取消。付款开放后可以回到这个页面付款。
        </Alert>
      ) : (
        <PaymentPanel token={token} order={order} initial={initial} onRefresh={onRefresh} polling={polling} />
      )}
    </Section>
  );
}

// ---- 行程、时间线、司机 ----

/** 行程那一行：接机 / 送机写机场和地址，点对点写两端，包车写套餐和上车点。 */
function routeFacts(order: SiteOrder, names: SiteOrderNames): { label: string; text: string }[] {
  const pickupAddress = order.pickup?.address ?? "—";
  const dropoffAddress = order.dropoff?.address ?? "—";
  if (order.category === "point_to_point") return [{ label: "点对点", text: `${pickupAddress} → ${dropoffAddress}` }];
  if (order.category === "charter") return [{ label: "包车", text: order.package_hours === null ? "—" : packageText(order.package_hours, null) }, { label: "上车地点", text: pickupAddress }];
  const airport = placeName(names);
  return order.direction === "pickup" ? [{ label: "接机", text: `${airport} → ${dropoffAddress}` }] : [{ label: "送机", text: `${pickupAddress} → ${airport}` }];
}

export function TripSection({ order, names }: { order: SiteOrder; names: SiteOrderNames }) {
  const group = names.vehicle_group === null ? null : displayName(names.vehicle_group.name);
  return (
    <Section id="site-trip-title" title="行程">
      <dl className="site-facts">
        {routeFacts(order, names).map((fact) => (
          <Fact key={fact.label} label={fact.label}>
            {fact.text}
          </Fact>
        ))}
        <Fact label={serviceTimeLabels(order.category, order.direction).fact}>
          {guestLocalText(order.service_local, order.timezone, new Date())}（{names.city === null ? "" : displayName(names.city.name).text}当地时间）
        </Fact>
        {order.flight_no !== null && <Fact label="航班号">{order.flight_no}</Fact>}
        <Fact label="车型">{group === null ? "—" : <span lang={group.lang}>{group.text}</span>}</Fact>
        <Fact label="人数 / 行李">
          {order.passengers} 人 / {order.luggage} 件
        </Fact>
        <Fact label="乘车人">{order.passenger.name}</Fact>
        <Fact label="乘车人手机号">{order.passenger.phone}</Fact>
        <Fact label="乘车人邮箱">
          <span className="site-break">{order.passenger.email}</span>
        </Fact>
        {order.notes !== null && <Fact label="备注">{order.notes}</Fact>}
        <Fact label="总价">
          <span className="site-price">{moneyText(order.price.total)}</span>
        </Fact>
        <Fact label="免费等待">{freeWaitText(order.free_wait_minutes, order.category, order.direction)}</Fact>
        {order.winning_tenant !== null && <Fact label="服务方">{order.winning_tenant.name}</Fact>}
      </dl>
    </Section>
  );
}

export function TimelineSection({ order, timeline }: { order: SiteOrder; timeline: SiteTimelineEntry[] }) {
  return (
    <Section id="site-timeline-title" title="订单进度">
      <ol className="site-timeline">
        {timeline.map((entry, index) => (
          <li key={`${entry.occurred_at}-${index}`} className="site-timeline__item">
            <span className="site-timeline__text">{entry.to_status === "cancelled" && entry.reason !== null ? (GUEST_CANCEL_REASON_NAMES[entry.reason] ?? TIMELINE_NAMES.cancelled) : TIMELINE_NAMES[entry.to_status]}</span>
            <time className="site-muted" dateTime={entry.occurred_at}>
              {local(order, entry.occurred_at)}
            </time>
          </li>
        ))}
      </ol>
    </Section>
  );
}

export function DriverSection({ order }: { order: SiteOrder }) {
  if (order.driver === null && order.vehicle === null) return null;
  return (
    <Section id="site-driver-title" title="司机和车辆">
      <dl className="site-facts">
        {order.driver !== null && (
          <>
            <Fact label="司机">{order.driver.name}</Fact>
            <Fact label="司机电话">{order.driver.phone ?? "用车前 24 小时显示"}</Fact>
          </>
        )}
        {order.vehicle !== null && (
          <Fact label="车辆">{[order.vehicle.plate, order.vehicle.model, order.vehicle.color].filter((part) => part !== null && part !== "").join(" · ")}</Fact>
        )}
      </dl>
    </Section>
  );
}

// ---- 我已落地 ----

export function LandingSection({ token, order, onChanged }: { token: string; order: SiteOrder; onChanged: Changed }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  if (order.landing === null) return null;
  const availability = landingAvailability(order, new Date());

  const report = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const envelope = await reportSiteLanded(token);
      setConfirming(false);
      setNotice({ kind: "success", text: "已确认落地，司机会按这个时间开始免费等待。" });
      onChanged(envelope);
    } catch (err) {
      setNotice({ kind: "danger", text: err instanceof ApiError && err.code === "LANDING_TOO_EARLY" ? "离航班计划到达还早，落地后再点「我已落地」。" : siteFailureText(err, "确认落地") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section id="site-landing-title" title="航班落地">
      <AlertSlot notice={notice} />
      <p>计划到达：当地时间 {local(order, order.landing.scheduled_at)}</p>
      {availability.kind === "reported" && (
        <p className="site-landing__done">
          您已确认落地：当地时间 {local(order, availability.at)}。
        </p>
      )}
      {availability.kind === "unpaid" && <p className="site-muted">付款后，航班落地时可以在这里点「我已落地」。</p>}
      {availability.kind === "too_early" && <p className="site-muted">航班落地后请点「我已落地」，司机按这个时间开始免费等待。当地时间 {local(order, availability.opensAt.toISOString())} 起可以点。</p>}
      {availability.kind === "open" &&
        (confirming ? (
          <div className="site-confirm" role="group" aria-label="确认已落地">
            <p>确认您的航班已经落地？时间按现在记录，提交后不能修改。</p>
            <div className="site-actions site-actions--inline">
              <Button variant="primary" size="lg" loading={busy} loadingText="正在提交" onClick={() => void report()}>
                确认已落地
              </Button>
              <Button size="lg" disabled={busy} onClick={() => setConfirming(false)}>
                还没有
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="site-muted">落地后点一下，司机会按这个时间开始免费等待，并知道您快出来了。</p>
            <div className="site-actions">
              <Button variant="primary" size="lg" block onClick={() => setConfirming(true)}>
                我已落地
              </Button>
            </div>
          </>
        ))}
    </Section>
  );
}

// ---- 事后加收 ----

const DISPUTE_REASON_MISSING = "请写一下为什么有异议，如「司机没有等那么久」";

function ExtraChargeItem({ token, order, charge, onChanged }: { token: string; order: SiteOrder; charge: SiteOrder["extra_charges"][number]; onChanged: Changed }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    if (reason.trim() === "") {
      setError(DISPUTE_REASON_MISSING);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const envelope = await disputeSiteExtraCharge(token, charge.id, reason.trim());
      setOpen(false);
      setNotice({ kind: "success", text: "异议已提交，这一项先不扣款，平台审核后会通知您。" });
      onChanged(envelope);
    } catch (err) {
      setNotice({ kind: "danger", text: siteFailureText(err, "提交异议") });
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="site-charge">
      <div className="site-charge__head">
        <span className="site-charge__name">{extraTypeName(charge.type as ExtraChargeType)}</span>
        <span className="site-charge__amount">{moneyText(charge.amount)}</span>
        <StatusBadge {...GUEST_EXTRA_STATUS_BADGES[charge.status]} />
      </div>
      {charge.description !== null && <p>{charge.description}</p>}
      {charge.dispute_open && <p className="site-muted">如果有异议，请在当地时间 {local(order, charge.dispute_until)} 前提出；没有异议到时会从下单时保存的银行卡扣款。</p>}
      <AlertSlot notice={notice} />
      {charge.dispute_open &&
        (open ? (
          <form className="site-form" noValidate onSubmit={(event) => void submit(event)}>
            <div className="field">
              <label className="field__label" htmlFor={`site-dispute-${charge.id}`}>
                异议的理由
              </label>
              <textarea
                id={`site-dispute-${charge.id}`}
                className="input textarea"
                rows={3}
                required
                maxLength={EXTRA_CHARGE_RULES.disputeReasonMax}
                aria-invalid={error !== null || undefined}
                aria-describedby={error !== null ? `site-dispute-${charge.id}-error site-dispute-${charge.id}-hint` : `site-dispute-${charge.id}-hint`}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  // 出错后实时重新校验（2.3）
                  if (error !== null) setError(event.target.value.trim() === "" ? DISPUTE_REASON_MISSING : null);
                }}
              />
              {error !== null && (
                <p className="field__error" id={`site-dispute-${charge.id}-error`}>
                  <Icon name="alert-triangle" className="field__error-icon" />
                  <span>{error}</span>
                </p>
              )}
              <p className="field__hint" id={`site-dispute-${charge.id}-hint`}>
                写清楚哪里不对，平台审核时会看。
              </p>
            </div>
            <div className="site-actions site-actions--inline">
              <Button type="submit" variant="primary" size="lg" loading={busy} loadingText="正在提交">
                提交异议
              </Button>
              <Button size="lg" disabled={busy} onClick={() => setOpen(false)}>
                取消
              </Button>
            </div>
          </form>
        ) : (
          <Button size="lg" onClick={() => setOpen(true)}>
            提异议
          </Button>
        ))}
    </li>
  );
}

export function ExtraChargesSection({ token, order, onChanged }: { token: string; order: SiteOrder; onChanged: Changed }) {
  if (order.extra_charges.length === 0) return null;
  return (
    <Section id="site-charges-title" title="服务后的费用">
      <p className="site-muted">服务结束后，司机报了下面的费用（附凭证）。提交后 48 小时内可以提异议；有异议的先不扣款，由平台审核。</p>
      <ul className="site-charges">
        {order.extra_charges.map((charge) => (
          <ExtraChargeItem key={charge.id} token={token} order={order} charge={charge} onChanged={onChanged} />
        ))}
      </ul>
    </Section>
  );
}

// ---- 改单 ----

/** 能改单的状态：和后端一致，付款确认之后才能改（待付款的单改不了，要改就取消后重新下单）。 */
const CHANGEABLE = new Set<SiteOrder["status"]>(["confirmed", "assigned", "departed", "arrived", "rescue_pending"]);

interface ChangeForm {
  name: string;
  phone: string;
  email: string;
  flightNo: string;
  pickupAddress: string;
  dropoffAddress: string;
  notes: string;
  passengers: string;
  luggage: string;
  date: string;
  time: string;
}

function formOf(order: SiteOrder): ChangeForm {
  return {
    name: order.passenger.name,
    phone: order.passenger.phone,
    email: order.passenger.email,
    flightNo: order.flight_no ?? "",
    pickupAddress: order.pickup?.address ?? "",
    dropoffAddress: order.dropoff?.address ?? "",
    notes: order.notes ?? "",
    passengers: String(order.passengers),
    luggage: String(order.luggage),
    date: order.service_local.slice(0, 10),
    time: order.service_local.slice(11, 16),
  };
}

/** 乘车人按后端改单的口径规范化后再比（姓名、邮箱去首尾空白，电话去空格括号连字符点），只多了空白不算改动。 */
const passengerKey = (passenger: { name: string; phone: string; email: string }): string => JSON.stringify([passenger.name.trim(), normalizePhone(passenger.phone), passenger.email.trim()]);
const flightKey = (flightNo: string): string => (flightNo.trim() === "" ? "" : normalizeFlightNo(flightNo));

/** 只给改了的字段（ADR 0029：只给要改的）。比较前按后端同样的规则规范化：后端认为没改的，这里也不提交。 */
export function changeRequestOf(order: SiteOrder, form: ChangeForm): SiteChangeRequest | { error: string } {
  const before = formOf(order);
  const body: SiteChangeRequest = {};
  if (passengerKey(form) !== passengerKey(before)) body.passenger = { name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim() };
  if (order.category === "airport_transfer" && flightKey(form.flightNo) !== flightKey(before.flightNo)) body.flight_no = form.flightNo.trim() === "" ? null : form.flightNo.trim();
  const ends = addressEnds(order.category, order.direction);
  if (ends.includes("pickup") && form.pickupAddress.trim() !== before.pickupAddress) {
    if (form.pickupAddress.trim() === "") return { error: "上车地址不能为空" };
    body.pickup_address = form.pickupAddress.trim();
  }
  if (ends.includes("dropoff") && form.dropoffAddress.trim() !== before.dropoffAddress) {
    if (form.dropoffAddress.trim() === "") return { error: "下车地址不能为空" };
    body.dropoff_address = form.dropoffAddress.trim();
  }
  if (form.notes.trim() !== before.notes) body.notes = form.notes.trim() === "" ? null : form.notes.trim();
  if (form.passengers !== before.passengers) {
    if (!/^\d+$/.test(form.passengers) || Number(form.passengers) < 1) return { error: "人数填 1 以上的整数" };
    body.passengers = Number(form.passengers);
  }
  if (form.luggage !== before.luggage) {
    if (!/^\d+$/.test(form.luggage)) return { error: "行李填 0 以上的整数" };
    body.luggage = Number(form.luggage);
  }
  if (form.date !== before.date || form.time !== before.time) {
    const at = localDateTimeToInstant(`${form.date}T${form.time}`, order.timezone);
    if (at === null) return { error: "用车日期和时间写得不对" };
    body.service_time = at.toISOString();
  }
  return body;
}

type ChangeField = "name" | "phone" | "email" | "flightNo" | "pickupAddress" | "dropoffAddress" | "date" | "time" | "passengers" | "luggage" | "notes";

/** 上车 / 下车两端的地址各对应表单里的哪一项。 */
const ADDRESS_FIELDS = { pickup: "pickupAddress", dropoff: "dropoffAddress" } as const;
export type ChangeErrors = Partial<Record<ChangeField, string>>;

/**
 * 修改订单的字段级校验（F12，同 2.3 的规则）：只查客人改过的字段——没改的照原样，不因为旧数据挡住别的修改。
 * 说法和下单页、询价页一致。
 */
export function validateChange(order: SiteOrder, form: ChangeForm, now: Date): ChangeErrors {
  const before = formOf(order);
  const arrival = order.category === "airport_transfer" && order.direction === "pickup";
  const changed = (field: keyof ChangeForm): boolean => form[field] !== before[field];
  const errors: ChangeErrors = {};
  if (changed("name") && form.name.trim() === "") errors.name = "请填写乘车人姓名";
  if (changed("phone") && !isInternationalPhone(form.phone.trim())) errors.phone = "请填写带国家码的手机号，如 +81 90-1234-5678、+86 138 0000 0000";
  if (changed("email") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = "请填写正确的邮箱，如 name@example.com";
  if (order.category === "airport_transfer" && changed("flightNo")) {
    if (arrival && form.flightNo.trim() === "") errors.flightNo = "接机要填航班号，司机按航班落地时间等候";
    else if (form.flightNo.trim() !== "" && !isFlightNo(form.flightNo)) errors.flightNo = "航班号的格式不对，如 NH211、MU523";
  }
  // 只查这一单有的地址（接送机是机场之外的那一端，点对点两端，包车上车点）
  for (const end of addressEnds(order.category, order.direction)) {
    const field = ADDRESS_FIELDS[end];
    if (changed(field) && form[field].trim() === "") errors[field] = end === "pickup" ? "请填写上车的地址或酒店名" : "请填写下车的地址或酒店名";
  }
  if (changed("passengers") && (!/^\d+$/.test(form.passengers.trim()) || Number(form.passengers) < 1)) errors.passengers = "人数填 1 以上的整数";
  if (changed("luggage") && !/^\d+$/.test(form.luggage.trim())) errors.luggage = "行李填 0 以上的整数";
  if (changed("date") || changed("time")) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) errors.date = "请选择日期";
    if (!/^\d{2}:\d{2}$/.test(form.time)) errors.time = "请选择时间";
    else if (errors.date === undefined) {
      if (localDateTimeToInstant(`${form.date}T${form.time}`, order.timezone) === null) errors.time = "这个时间在当地不存在（夏令时调整），请换一个时间";
      else if (`${form.date}T${form.time}` <= localDateTimeIn(order.timezone, now)) errors.time = "这个时间已经过了，请选一个以后的时间";
    }
  }
  return errors;
}

/** 后端校验不通过时，能对上字段的标在字段下。 */
const CHANGE_SERVER_PATHS: Readonly<Record<string, ChangeField>> = {
  "/passenger/name": "name",
  "/passenger/phone": "phone",
  "/passenger/email": "email",
  "/flight_no": "flightNo",
  "/pickup_address": "pickupAddress",
  "/dropoff_address": "dropoffAddress",
  "/service_time": "time",
  "/passengers": "passengers",
  "/luggage": "luggage",
  "/notes": "notes",
};

/** 后端改单校验的简短说法（「必填」「太长了」「格式不对」），客人看不懂是哪一项、该怎么写。 */
const TERSE_SERVER_MESSAGES: ReadonlySet<string> = new Set(["必填", "太长了", "格式不对"]);

/**
 * 后端的字段错误换成客人能看懂、写清正确写法的说法（2.3）：按字段和 reason 给；后端给的已经是完整说法（如电话、航班号的格式）时照用。
 */
export function guestChangeIssueText(field: ChangeField, issue: { reason?: string; message?: string }): string {
  const message = issue.message ?? "";
  if (message !== "" && !TERSE_SERVER_MESSAGES.has(message)) return message;
  const address = (place: string) => ({ REQUIRED: `请填写${place}的地址或酒店名`, TOO_LONG: `地址太长了，最多 ${ORDER_FIELD_LIMITS.addressMax} 个字，写酒店名或主要地址就可以` });
  const byReason: Partial<Record<ChangeField, Partial<Record<string, string>>>> = {
    name: { REQUIRED: "请填写乘车人姓名", TOO_LONG: `姓名太长了，最多 ${ORDER_FIELD_LIMITS.nameMax} 个字` },
    phone: { REQUIRED: "请填写带国家码的手机号，如 +81 90-1234-5678", INVALID_FORMAT: "请填写带国家码的手机号，如 +81 90-1234-5678、+86 138 0000 0000" },
    email: { REQUIRED: "请填写邮箱，如 name@example.com", INVALID_FORMAT: "请填写正确的邮箱，如 name@example.com", TOO_LONG: `邮箱太长了，最多 ${ORDER_FIELD_LIMITS.emailMax} 个字符` },
    flightNo: { REQUIRED: "接机要填航班号，司机按航班落地时间等候", INVALID_FORMAT: "航班号的格式不对，如 NH211、MU523" },
    pickupAddress: address("上车"),
    dropoffAddress: address("下车"),
    time: { REQUIRED: "请选择时间", INVALID_FORMAT: "用车日期和时间写得不对，请重新选择" },
    passengers: { REQUIRED: "请填写人数", INVALID_FORMAT: "人数填 1 以上的整数" },
    luggage: { INVALID_FORMAT: "行李填 0 以上的整数" },
    notes: { TOO_LONG: `备注太长了，最多 ${ORDER_FIELD_LIMITS.notesMax} 个字，请删短一些` },
  };
  const text = issue.reason === undefined ? undefined : byReason[field]?.[issue.reason];
  if (text !== undefined) return text;
  return `${CHANGE_FIELD_LABELS[field]}没有通过检查，请检查后再提交`;
}

const CHANGE_FIELD_LABELS: Readonly<Record<ChangeField, string>> = { name: "姓名", phone: "手机号", email: "邮箱", flightNo: "航班号", pickupAddress: "上车地址", dropoffAddress: "下车地址", date: "日期", time: "时间", passengers: "人数", luggage: "行李", notes: "备注" };

/** 客人改了表单里的哪些项，各自对应哪个字段的后端错误要清掉（改日期也清掉标在时间下的用车时间错误）。 */
const CLEARS: Readonly<Record<keyof ChangeForm, readonly ChangeField[]>> = {
  name: ["name"],
  phone: ["phone"],
  email: ["email"],
  flightNo: ["flightNo"],
  pickupAddress: ["pickupAddress"],
  dropoffAddress: ["dropoffAddress"],
  notes: ["notes"],
  passengers: ["passengers"],
  luggage: ["luggage"],
  date: ["date", "time"],
  time: ["time"],
};

const FORM_INCOMPLETE = "有几项没有填好，请看标红的地方。";

export function ChangeSection({ token, order, onChanged }: { token: string; order: SiteOrder; onChanged: Changed }) {
  const [form, setForm] = useState<ChangeForm | null>(null);
  const [errors, setErrors] = useState<ChangeErrors>({});
  // 后端标在字段下的错误：客人改了那一项才清掉，改别的项不动（前端校验管不到后端的判断，如邮箱域名不存在）
  const [serverErrors, setServerErrors] = useState<ChangeErrors>({});
  const [attempted, setAttempted] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = order.changes.filter((change) => change.status !== "cancelled");
  if (!CHANGEABLE.has(order.status) && shown.length === 0) return null;
  const transfer = order.category === "airport_transfer";
  const arrival = transfer && order.direction === "pickup";
  const labels = serviceTimeLabels(order.category, order.direction);
  const set = (changes: Partial<ChangeForm>): void => {
    if (form === null) return;
    const next = { ...form, ...changes };
    setForm(next);
    // 提交过一次以后，改一项就重新校验（2.3「出错后该字段实时重新校验」）
    if (attempted) setErrors(validateChange(order, next, new Date()));
    const cleared = (Object.keys(changes) as (keyof ChangeForm)[]).flatMap((key) => CLEARS[key]);
    setServerErrors((current) => Object.fromEntries(Object.entries(current).filter(([field]) => !cleared.includes(field as ChangeField))));
  };
  const openForm = (): void => {
    setForm(formOf(order));
    setErrors({});
    setServerErrors({});
    setAttempted(false);
    setNotice(null);
  };
  const fieldErrors = (field: ChangeField): string[] => {
    const message = errors[field] ?? serverErrors[field];
    return message === undefined ? [] : [message];
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (form === null || busy) return;
    const found = validateChange(order, form, new Date());
    setAttempted(true);
    setErrors(found);
    setServerErrors({});
    if (Object.keys(found).length > 0) {
      setNotice({ kind: "danger", text: FORM_INCOMPLETE });
      return;
    }
    const body = changeRequestOf(order, form);
    if ("error" in body) {
      setNotice({ kind: "danger", text: body.error });
      return;
    }
    if (Object.keys(body).length === 0) {
      setNotice({ kind: "info", text: "没有改动。" });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const result = await changeSiteOrder(token, order.version, body);
      const status = result.change?.status;
      setForm(null);
      setNotice({
        kind: status === "applied" ? "success" : "info",
        text: status === "applied" ? "已修改。" : status === "pending_confirmation" ? "改期已提交：离用车不到 24 小时，需要服务方在 30 分钟内确认，结果会显示在这里。" : "已提交修改，结果会显示在这里。",
      });
      onChanged(result);
    } catch (err) {
      if (err instanceof ApiError && err.code === "NO_CHANGE") setNotice({ kind: "info", text: "没有改动。" });
      else if (err instanceof ApiError && err.code === "VERSION_CONFLICT") setNotice({ kind: "warning", text: "订单刚刚有了变化，请刷新页面后再改一次。" });
      else if (err instanceof ApiError && err.code === "VALIDATION_FAILED") {
        const mapped: ChangeErrors = {};
        if (err.details["reason"] === "SERVICE_TIME_PASSED") {
          // 提交途中用车时间刚好过去（后端 422）
          mapped.time = "这个时间已经过了，请选一个以后的时间";
        } else {
          const issues = Array.isArray(err.details["issues"]) ? (err.details["issues"] as { path?: string; reason?: string; message?: string }[]) : [];
          for (const issue of issues) {
            const field = CHANGE_SERVER_PATHS[issue.path ?? ""];
            if (field !== undefined) mapped[field] = guestChangeIssueText(field, issue);
          }
        }
        setServerErrors(mapped);
        setNotice({ kind: "danger", text: Object.keys(mapped).length > 0 ? "有几项没有通过检查，请看标红的地方。" : "提交的内容不符合要求，请检查后重试。" });
      } else if (err instanceof ApiError && err.code === "CHANGE_PAYMENT_DECLINED") setNotice({ kind: "danger", text: "改期后价格变高，补差价没有扣款成功，订单没有修改。可以换一个时间，或取消后重新预订。" });
      else setNotice({ kind: "danger", text: siteFailureText(err, "修改订单") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section id="site-change-title" title="修改订单">
      <AlertSlot notice={notice} />
      {shown.length > 0 && (
        <ul className="site-changes">
          {shown.map((change) => (
            <li key={change.id} className="site-changes__item">
              <span>{change.fields.map((field) => CHANGE_FIELD_NAMES[field] ?? field).join("、")}</span>
              <StatusBadge {...GUEST_CHANGE_STATUS_BADGES[change.status]} />
              {change.price_difference !== null && change.price_difference.kind !== "none" && (
                <span className="site-muted">
                  {change.price_difference.kind === "increase" ? "补收" : "退还"} {moneyText(change.price_difference.amount)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {CHANGEABLE.has(order.status) &&
        (form === null ? (
          <>
            <p className="site-muted">{transfer ? "乘车人、航班号随时可以改" : "乘车人随时可以改"}；地址、备注、人数行李和用车时间在免费取消期内可以改，改时间会按新时间重新计价（多退少补）。换车型请取消后重新预订。</p>
            <Button size="lg" onClick={openForm}>
              修改订单
            </Button>
          </>
        ) : (
          <form className="site-form" noValidate onSubmit={(event) => void submit(event)}>
            <TextField label="乘车人姓名" size="lg" required autoComplete="name" maxLength={ORDER_FIELD_LIMITS.nameMax} value={form.name} errors={fieldErrors("name")} onChange={(event) => set({ name: event.target.value })} />
            <TextField label="手机号（带国家码）" size="lg" required type="tel" inputMode="tel" autoComplete="tel" hint="以 + 和国家码开头，如 +81 90-1234-5678" value={form.phone} errors={fieldErrors("phone")} onChange={(event) => set({ phone: event.target.value })} />
            <TextField label="邮箱" size="lg" required type="email" inputMode="email" autoCapitalize="none" spellCheck={false} autoComplete="email" value={form.email} errors={fieldErrors("email")} onChange={(event) => set({ email: event.target.value })} />
            {transfer && <TextField label={arrival ? "航班号" : "航班号（选填）"} size="lg" required={arrival} autoCapitalize="characters" hint="如 NH211" value={form.flightNo} errors={fieldErrors("flightNo")} onChange={(event) => set({ flightNo: event.target.value })} />}
            {addressEnds(order.category, order.direction).map((end) => {
              const field = ADDRESS_FIELDS[end];
              return (
                <TextField
                  key={end}
                  label={ADDRESS_LABELS[end]}
                  size="lg"
                  required
                  maxLength={ORDER_FIELD_LIMITS.addressMax}
                  value={form[field]}
                  errors={fieldErrors(field)}
                  onChange={(event) => set(field === "pickupAddress" ? { pickupAddress: event.target.value } : { dropoffAddress: event.target.value })}
                />
              );
            })}
            <div className="site-form__row">
              <TextField label={labels.date} size="lg" type="date" required value={form.date} errors={fieldErrors("date")} onChange={(event) => set({ date: event.target.value })} />
              <TextField label={labels.time} size="lg" type="time" required value={form.time} errors={fieldErrors("time")} onChange={(event) => set({ time: event.target.value })} />
            </div>
            <div className="site-form__row">
              <TextField label="人数" size="lg" type="number" inputMode="numeric" min={1} required value={form.passengers} errors={fieldErrors("passengers")} onChange={(event) => set({ passengers: event.target.value })} />
              <TextField label="行李（件）" size="lg" type="number" inputMode="numeric" min={0} value={form.luggage} errors={fieldErrors("luggage")} onChange={(event) => set({ luggage: event.target.value })} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="site-change-notes">
                备注（选填）
              </label>
              <textarea
                id="site-change-notes"
                className="input textarea"
                rows={3}
                maxLength={ORDER_FIELD_LIMITS.notesMax}
                aria-invalid={fieldErrors("notes").length > 0 || undefined}
                aria-describedby={fieldErrors("notes").length > 0 ? "site-change-notes-error site-change-notes-hint" : "site-change-notes-hint"}
                value={form.notes}
                onChange={(event) => set({ notes: event.target.value })}
              />
              {fieldErrors("notes").map((message) => (
                <p key={message} className="field__error" id="site-change-notes-error">
                  <Icon name="alert-triangle" className="field__error-icon" />
                  <span>{message}</span>
                </p>
              ))}
              <p className="field__hint" id="site-change-notes-hint">
                最多 {ORDER_FIELD_LIMITS.notesMax} 字
              </p>
            </div>
            <div className="site-actions site-actions--inline">
              <Button type="submit" variant="primary" size="lg" loading={busy} loadingText="正在提交">
                提交修改
              </Button>
              <Button
                size="lg"
                disabled={busy}
                onClick={() => {
                  setForm(null);
                  setErrors({});
                  setServerErrors({});
                  setNotice(null);
                }}
              >
                不改了
              </Button>
            </div>
          </form>
        ))}
    </Section>
  );
}

// ---- 取消 ----

/** 能取消的状态：待付款的也能取消（不收费）。 */
const CANCELLABLE = new Set<SiteOrder["status"]>(["pending_payment", ...CHANGEABLE]);

function feeLine(fee: SiteCancelFee): string {
  if (fee.stage === "unpaid") return "订单还没有付款，取消不收任何费用。";
  if (fee.fee === undefined || fee.refund === undefined) return "";
  if (fee.fee_bp === 0) return `按取消政策，现在取消免费，全额退还 ${moneyText(fee.refund)}，原路退回银行卡。`;
  // 扣全额时不写「退还 0 JPY」（F7）
  if (/^0(\.0+)?$/.test(fee.refund.amount)) return `按取消政策，现在取消不退款（取消费 ${moneyText(fee.fee)}）。`;
  return `按取消政策，现在取消扣 ${moneyText(fee.fee)}，退还 ${moneyText(fee.refund)}，原路退回银行卡。`;
}

const REFUND_STATUS_TEXT: Readonly<Record<string, string>> = { pending: "退款处理中（几天内到账）", succeeded: "已退款", failed: "退款遇到问题，平台财务会处理并联系您" };

export function CancelSection({ token, order, onChanged }: { token: string; order: SiteOrder; onChanged: Changed }) {
  const [fee, setFee] = useState<{ reason: SiteCancelReason; quote: SiteCancelFee } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  if (order.status === "cancelled") {
    const cancellation = order.cancellation;
    return (
      <Section id="site-cancel-title" title="取消">
        <AlertSlot notice={notice} />
        <dl className="site-facts">
          <Fact label="取消原因">{GUEST_CANCEL_REASON_NAMES[order.cancel_reason ?? ""] ?? "已取消"}</Fact>
          {cancellation !== null && cancellation.fee !== null && <Fact label="取消费">{moneyText(cancellation.fee)}</Fact>}
          {cancellation !== null && <Fact label="退款">{`${moneyText(cancellation.refund)}${cancellation.refund_status === null ? "" : `（${REFUND_STATUS_TEXT[cancellation.refund_status] ?? ""}）`}`}</Fact>}
        </dl>
      </Section>
    );
  }
  if (!CANCELLABLE.has(order.status)) return null;

  const preview = async (reason: SiteCancelReason): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const quote = await getSiteCancelFee(token, reason);
      if (!quote.cancellable) setNotice({ kind: "warning", text: "这张订单现在不能在网上取消了，请联系客服。" });
      else setFee({ reason, quote });
    } catch (err) {
      setNotice({ kind: "danger", text: siteFailureText(err, "计算退款") });
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (): Promise<void> => {
    if (fee === null || busy) return;
    setBusy(true);
    try {
      const envelope = await cancelSiteOrder(token, fee.reason);
      setFee(null);
      setNotice({ kind: "success", text: "订单已取消。" });
      onChanged(envelope);
    } catch (err) {
      setNotice({ kind: "danger", text: siteFailureText(err, "取消订单") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section id="site-cancel-title" title="取消订单">
      <AlertSlot notice={notice} />
      {order.cancel_policy !== null && <p>取消政策：{guestCancelPolicyText(order.cancel_policy.tiers)}（按订单总价计算）。</p>}
      {fee === null ? (
        <div className="site-actions site-actions--inline">
          <Button size="lg" loading={busy} loadingText="正在计算" onClick={() => void preview("GUEST_REQUEST")}>
            取消订单
          </Button>
          {order.free_cancel_available && (
            <Button size="lg" disabled={busy} onClick={() => void preview("CHANGE_NOT_CONFIRMED")}>
              改期没有被确认，免费取消
            </Button>
          )}
        </div>
      ) : (
        <div className="site-confirm" role="group" aria-label="确认取消订单">
          <p>{feeLine(fee.quote)}</p>
          <p>取消后不能恢复，要用车需要重新预订。</p>
          <div className="site-actions site-actions--inline">
            <Button variant="danger" size="lg" loading={busy} loadingText="正在取消" onClick={() => void cancel()}>
              确认取消订单
            </Button>
            <Button size="lg" disabled={busy} onClick={() => setFee(null)}>
              不取消了
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}

// ---- 需要帮助 ----

/**
 * 客服电话（5.10、F2 的结构）：登记了号码（配置 `support_phone`）才显示，没登记时整块不出现，
 * 也不放不能用的链接或按钮。号码原样显示，`tel:` 链接里只留 + 和数字。
 */
export function HelpSection({ order, phone }: { order: Pick<SiteOrder, "order_no">; phone: string | null }) {
  if (phone === null || phone.trim() === "") return null;
  return (
    <Section id="site-help-title" title="需要帮助">
      <p>对订单有疑问、找不到司机，或者要改网上改不了的内容，请打电话给客服。</p>
      <div className="site-actions site-actions--inline">
        <a className="button button--secondary button--lg" href={`tel:${phone.replace(/[^+\d]/g, "")}`}>
          打电话给客服 {phone}
        </a>
      </div>
      <p className="site-muted">联系时请提供订单号 {order.order_no}。</p>
    </Section>
  );
}
