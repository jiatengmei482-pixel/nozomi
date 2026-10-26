/**
 * 官网订单页的各个区块（M3-05，ADR 0032）。每个会改订单的操作都在页面内确认，结果写在区块里；出错时说明怎么办。
 * 危险或提交后不能改的操作（付款、取消、「我已落地」）先显示要发生什么，再点「确认」才提交。
 */
import { type ExtraChargeType, EXTRA_CHARGE_RULES, localDateTimeToInstant, normalizeFlightNo, normalizePhone } from "@nozomi/domain";
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
import { Skeleton } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { TextField } from "../../components/TextField.tsx";
import { formatInZone, moneyText } from "../../lib/dispatch-display.ts";
import { displayName } from "../../lib/master-display.ts";
import { CHANGE_FIELD_NAMES, extraTypeName, tiersText } from "../../lib/order-money-display.ts";
import { PaymentNotIntegratedError, type PaymentMount, usePaymentDriver } from "../../lib/payment-driver.ts";
import { GUEST_CANCEL_REASON_NAMES, GUEST_CHANGE_STATUS_BADGES, GUEST_EXTRA_STATUS_BADGES, TIMELINE_NAMES, landingAvailability } from "../../lib/site-display.ts";
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

const local = (order: Pick<SiteOrder, "timezone">, iso: string | null): string => formatInZone(iso, order.timezone);
const placeName = (names: SiteOrderNames): string => (names.place === null ? "机场" : `${displayName(names.place.name).text}（${names.place.code}）`);

// ---- 付款 ----

function PaymentPanel({ token, order, initial, onPaid }: { token: string; order: SiteOrder; initial: SitePayment | null; onPaid(): void }) {
  const driver = usePaymentDriver();
  const container = useRef<HTMLDivElement>(null);
  const mounted = useRef<PaymentMount | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed" | "unavailable">("loading");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);
  const due = local(order, order.payment_due_at);

  useEffect(() => {
    let alive = true;
    setState("loading");
    const load = async (): Promise<void> => {
      const payment = initial?.client_secret ? initial : (await getSiteOrderPayment(token)).payment;
      if (payment.client_secret === null) throw new Error("付款已经结束");
      if (!alive || container.current === null) return;
      const mount = await driver.mount(container.current, { publishableKey: payment.publishable_key, clientSecret: payment.client_secret });
      if (!alive) {
        mount.destroy();
        return;
      }
      mounted.current = mount;
      setState("ready");
    };
    load().catch((err: unknown) => {
      if (!alive) return;
      setState(err instanceof PaymentNotIntegratedError ? "unavailable" : "failed");
      setNotice(
        err instanceof PaymentNotIntegratedError
          ? { kind: "warning", text: `在线付款还在接入中，订单已为您保留到当地时间 ${due}，到时没有付款会自动取消。` }
          : { kind: "danger", text: err instanceof ApiError ? siteFailureText(err, "准备付款") : "付款组件没有加载出来，请检查网络后点「重新加载」。" },
      );
    });
    return () => {
      alive = false;
      mounted.current?.destroy();
      mounted.current = null;
    };
  }, [driver, token, initial, round, due]);

  const pay = async (): Promise<void> => {
    if (mounted.current === null || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await mounted.current.confirm();
      if (!result.ok) {
        setNotice({ kind: "danger", text: result.message });
        return;
      }
      setConfirming(false);
      setNotice({ kind: "info", text: "已提交付款，正在确认（通常几秒钟），订单状态会自动更新。" });
      onPaid();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <AlertSlot notice={notice} />
      <div ref={container} className="site-payment" />
      {state === "loading" && <Skeleton lines={["control", "control"]} label="正在加载付款组件" />}
      {state === "failed" && <Button onClick={() => setRound((value) => value + 1)}>重新加载</Button>}
      {state === "ready" &&
        (confirming ? (
          <div className="site-confirm" role="group" aria-label="确认付款">
            <p>确认支付 {moneyText(order.price.total)}？</p>
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
            <Button variant="primary" size="lg" block onClick={() => setConfirming(true)}>
              付款 {moneyText(order.price.total)}
            </Button>
          </div>
        ))}
    </>
  );
}

/** `configPayments`：undefined 还在读配置；null 没配置 Stripe（付款暂未开放）。 */
export function PaymentSection({ token, order, configPayments, initial, onPaid }: { token: string; order: SiteOrder; configPayments: { publishable_key: string } | null | undefined; initial: SitePayment | null; onPaid(): void }) {
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
        <>
          <p className="site-muted">请在当地时间 {due} 前付款，过时订单会自动取消。付款信息由 Stripe 处理，本站不保存卡号。</p>
          <PaymentPanel token={token} order={order} initial={initial} onPaid={onPaid} />
        </>
      )}
    </Section>
  );
}

// ---- 行程、时间线、司机 ----

export function TripSection({ order, names }: { order: SiteOrder; names: SiteOrderNames }) {
  const pickup = order.direction === "pickup";
  const airport = placeName(names);
  const address = (pickup ? order.dropoff : order.pickup)?.address ?? "—";
  const group = names.vehicle_group === null ? null : displayName(names.vehicle_group.name);
  return (
    <Section id="site-trip-title" title="行程">
      <dl className="site-facts">
        <Fact label={pickup ? "接机" : "送机"}>{pickup ? `${airport} → ${address}` : `${address} → ${airport}`}</Fact>
        <Fact label={pickup ? "航班计划到达" : "上车时间"}>
          {order.service_local.replace("T", " ")}（{names.city === null ? "" : displayName(names.city.name).text}当地时间）
        </Fact>
        {order.flight_no !== null && <Fact label="航班号">{order.flight_no}</Fact>}
        <Fact label="车型">{group === null ? "—" : <span lang={group.lang}>{group.text}</span>}</Fact>
        <Fact label="人数 / 行李">
          {order.passengers} 人 / {order.luggage} 件
        </Fact>
        <Fact label="乘车人">
          {order.passenger.name} · {order.passenger.phone} · <span className="site-break">{order.passenger.email}</span>
        </Fact>
        {order.notes !== null && <Fact label="备注">{order.notes}</Fact>}
        <Fact label="价格">{moneyText(order.price.total)}</Fact>
        <Fact label="免费等待">{order.free_wait_minutes === null ? "不限时" : `${order.free_wait_minutes} 分钟（${pickup ? "从航班落地起算" : "从约定的上车时间起算"}）`}</Fact>
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
      setError("请写一下为什么有异议");
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
              <textarea id={`site-dispute-${charge.id}`} className="input textarea" rows={3} maxLength={EXTRA_CHARGE_RULES.disputeReasonMax} aria-invalid={error !== null || undefined} value={reason} onChange={(event) => setReason(event.target.value)} />
              {error !== null && <p className="field__error">{error}</p>}
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

const CHANGEABLE = new Set<SiteOrder["status"]>(["pending_payment", "confirmed", "assigned", "departed", "arrived", "rescue_pending"]);

interface ChangeForm {
  name: string;
  phone: string;
  email: string;
  flightNo: string;
  address: string;
  notes: string;
  passengers: string;
  luggage: string;
  date: string;
  time: string;
}

function formOf(order: SiteOrder): ChangeForm {
  const pickup = order.direction === "pickup";
  return {
    name: order.passenger.name,
    phone: order.passenger.phone,
    email: order.passenger.email,
    flightNo: order.flight_no ?? "",
    address: (pickup ? order.dropoff : order.pickup)?.address ?? "",
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
  if (flightKey(form.flightNo) !== flightKey(before.flightNo)) body.flight_no = form.flightNo.trim() === "" ? null : form.flightNo.trim();
  if (form.address.trim() !== before.address) {
    if (order.direction === "pickup") body.dropoff_address = form.address.trim();
    else body.pickup_address = form.address.trim();
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

export function ChangeSection({ token, order, onChanged }: { token: string; order: SiteOrder; onChanged: Changed }) {
  const [form, setForm] = useState<ChangeForm | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = order.changes.filter((change) => change.status !== "cancelled");
  if (!CHANGEABLE.has(order.status) && shown.length === 0) return null;
  const pickup = order.direction === "pickup";
  const set = (changes: Partial<ChangeForm>): void => setForm((current) => (current === null ? current : { ...current, ...changes }));

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (form === null || busy) return;
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
      else if (err instanceof ApiError && err.code === "CHANGE_PAYMENT_DECLINED") setNotice({ kind: "danger", text: "改期后价格变高，补差价没有扣款成功，订单没有修改。可以换一个时间，或取消后重新预订。" });
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
            <p className="site-muted">乘车人、航班号随时可以改；地址、备注、人数行李和用车时间在免费取消期内可以改，改时间会按新时间重新计价（多退少补）。换车型请取消后重新预订。</p>
            <Button size="lg" onClick={() => setForm(formOf(order))}>
              修改订单
            </Button>
          </>
        ) : (
          <form className="site-form" noValidate onSubmit={(event) => void submit(event)}>
            <TextField label="乘车人姓名" size="lg" value={form.name} onChange={(event) => set({ name: event.target.value })} />
            <TextField label="手机号（带国家码）" size="lg" type="tel" value={form.phone} onChange={(event) => set({ phone: event.target.value })} />
            <TextField label="邮箱" size="lg" type="email" value={form.email} onChange={(event) => set({ email: event.target.value })} />
            <TextField label={pickup ? "航班号" : "航班号（选填）"} size="lg" value={form.flightNo} onChange={(event) => set({ flightNo: event.target.value })} />
            <TextField label={pickup ? "下车地址或酒店名" : "上车地址或酒店名"} size="lg" value={form.address} onChange={(event) => set({ address: event.target.value })} />
            <div className="site-form__row">
              <TextField label={pickup ? "航班到达日期（当地）" : "用车日期（当地）"} size="lg" type="date" value={form.date} onChange={(event) => set({ date: event.target.value })} />
              <TextField label={pickup ? "航班计划到达时间（当地）" : "上车时间（当地）"} size="lg" type="time" value={form.time} onChange={(event) => set({ time: event.target.value })} />
            </div>
            <div className="site-form__row">
              <TextField label="人数" size="lg" type="number" inputMode="numeric" min={1} value={form.passengers} onChange={(event) => set({ passengers: event.target.value })} />
              <TextField label="行李（件）" size="lg" type="number" inputMode="numeric" min={0} value={form.luggage} onChange={(event) => set({ luggage: event.target.value })} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="site-change-notes">
                备注
              </label>
              <textarea id="site-change-notes" className="input textarea" rows={3} maxLength={2000} value={form.notes} onChange={(event) => set({ notes: event.target.value })} />
            </div>
            <div className="site-actions site-actions--inline">
              <Button type="submit" variant="primary" size="lg" loading={busy} loadingText="正在提交">
                提交修改
              </Button>
              <Button size="lg" disabled={busy} onClick={() => setForm(null)}>
                不改了
              </Button>
            </div>
          </form>
        ))}
    </Section>
  );
}

// ---- 取消 ----

const CANCELLABLE = CHANGEABLE;

function feeLine(fee: SiteCancelFee): string {
  if (fee.stage === "unpaid") return "订单还没有付款，取消不收任何费用。";
  if (fee.fee === undefined || fee.refund === undefined) return "";
  return fee.fee_bp === 0 ? `按取消政策，现在取消免费，全额退还 ${moneyText(fee.refund)}，原路退回银行卡。` : `按取消政策，现在取消扣 ${moneyText(fee.fee)}，退还 ${moneyText(fee.refund)}，原路退回银行卡。`;
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
      {order.cancel_policy !== null && <p>取消政策：{tiersText(order.cancel_policy.tiers)}（按距用车时间计算，扣款按订单金额的比例）。</p>}
      {fee === null ? (
        <div className="site-actions site-actions--inline">
          <Button variant="danger" size="lg" loading={busy} loadingText="正在计算" onClick={() => void preview("GUEST_REQUEST")}>
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
