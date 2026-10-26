/**
 * 供应商后台的救援改派（M3-04，ADR 0031）：
 * - 订单详情的「声明无法履约」（`order.dispatch`）：原因必填，先写明按现在声明会落在哪一档违约金（用车前 ≥ 24 小时 0；2–24 小时 30%；< 2 小时 100%），
 *   另外承担救援差价；声明后这一单进入救援改派，自己不能再操作。订单详情里另有这一单和救援的关系（原供应商：触发、违约金、应扣款项；救援供应商：这是接来的救援单）。
 * - 「救援单」页（`order.dispatch`）：平台发来的救援单（接单前只有行程和自己的结算价，没有乘客信息），期限内接或拒；
 * - 「违约金与扣款」页（`order.read`）：自己的应扣款项（违约金、救援差价），现在只记账、结算时扣；不可抗力免除的写明说明。
 * 页面上没有对外价、加价比例、别的供应商是谁（规则 4：接口里本来就没有）。
 */
import { type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router";
import type { TenantOrder } from "../../api/dispatch.ts";
import { type TenantDeduction, type TenantOrderRescue, type TenantRescueOffer, acceptRescueOffer, declareUnable, declineRescueOffer, listDeductions, listRescueOffers } from "../../api/rescues.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { TextField } from "../../components/TextField.tsx";
import { useToast } from "../../components/Toast.tsx";
import { CATEGORY_NAMES, directionName, formatInZone, moneyText, orderPath, routeText } from "../../lib/dispatch-display.ts";
import { failureText } from "../../lib/failure.ts";
import { formatLocalDateTime } from "../../lib/master-display.ts";
import { DEDUCTIONS_PATH, DEDUCTION_STATUS_BADGES, OFFER_STATUS_BADGES, declarePenaltyPreview, deductionBasisText, deductionKindName, offerRemainingText, penaltyText, triggerName } from "../../lib/rescue-display.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { useTenantCan } from "../../lib/use-master-access.ts";

const NO_ACCESS = <StateBlock tone="neutral" title="你没有权限查看这里" description="需要的话，请联系你们的管理员开通。" />;

/** 能声明无法履约的状态（和后端同一份：服务开始之前、司机还没到上车点）。 */
export const DECLARABLE: readonly TenantOrder["status"][] = ["confirmed", "assigned", "departed"];

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="details__item">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** 每 15 秒刷新一次「现在」：救援单的倒计时、声明时的违约金档位。 */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function DeclareUnableDialog({ order, onClose, onDone }: { order: TenantOrder; onClose(): void; onDone(text: string): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const now = useNow();
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const preview = declarePenaltyPreview(order.service_time, now, order.settlement.total);
  const submit = async (): Promise<void> => {
    if (reason.trim() === "") {
      setProblem("请写明为什么接不了（平台会据此安排救援）");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const { rescue } = await declareUnable(token, order.id, reason.trim());
      onDone(`已声明无法履约：平台正在安排救援，违约金 ${(rescue.penalty_bp ?? 0) / 100}%`);
    } catch (err) {
      if (!handleAuthFailure(err)) setProblem(failureText(err, "声明"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open title="声明无法履约" size="form" busy={busy} onClose={onClose} footer={<><Button variant="text" onClick={onClose}>再想想</Button><Button variant="danger" loading={busy} onClick={() => void submit()}>确认声明</Button></>}>
      <p>{`声明后这一单交给平台找别的供应商救援，你们不能再派车、回传，原来的司机链接立即作废。`}</p>
      {preview !== null && (
        <dl className="details">
          <Detail label="按现在声明的违约金">{`${penaltyText(preview.tier)} = ${preview.amount}`}</Detail>
          <Detail label="另外承担">救援差价：救援供应商的结算价比这一单的结算价高出的部分（低了记 0）</Detail>
        </dl>
      )}
      <p className="field__hint">违约金阶梯（按声明时离用车多久）：用车前 24 小时以上 0；2–24 小时 30%；不到 2 小时 100%。不可抗力经平台认定可以免除。现在只记账，结算时从账单里扣。</p>
      <TextField label="原因" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} hint="如「车辆故障，当天没有备用车」" />
      {problem !== null && <Alert kind="danger">{problem}</Alert>}
    </Dialog>
  );
}

function DeductionList({ deductions }: { deductions: TenantDeduction[] }) {
  return (
    <ul className="plain-list" aria-label="应扣款项">
      {deductions.map((deduction) => (
        <li key={deduction.id}>
          {`${deductionKindName(deduction.kind)} ${moneyText(deduction.amount)} `}
          <StatusBadge {...DEDUCTION_STATUS_BADGES[deduction.status]} />
          <span className="table__muted">{` ${deductionBasisText(deduction.kind, deduction.basis, deduction.amount.currency)}${deduction.waive_reason ? `；免除说明：${deduction.waive_reason}` : ""}`}</span>
        </li>
      ))}
    </ul>
  );
}

/** 订单详情里这一单和救援的关系。 */
export function TenantRescueSection({ rescue }: { rescue: TenantOrderRescue | null }) {
  if (rescue === null) return null;
  if (rescue.role === "rescuer") {
    return (
      <section className="card">
        <h2 className="card__title">救援单</h2>
        <p>{`这一单是你们接的救援单（${rescue.rescued_at === null ? "" : `${formatLocalDateTime(rescue.rescued_at)} 接单`}），按普通订单履约，结算价是救援单上的价。`}</p>
      </section>
    );
  }
  return (
    <section className="card">
      <h2 className="card__title">救援改派</h2>
      <dl className="details">
        <Detail label="情形">{triggerName(rescue.trigger)}</Detail>
        {rescue.triggered_at !== null && <Detail label="时间">{formatLocalDateTime(rescue.triggered_at)}</Detail>}
        {rescue.reason && <Detail label="原因">{rescue.reason}</Detail>}
        <Detail label="违约金">{penaltyText(rescue.penalty_tier)}</Detail>
        <Detail label="进展">{rescue.status === "rescued" ? "已改派给别的供应商" : rescue.status === "cancelled" ? "订单已取消" : "平台正在安排救援"}</Detail>
        {rescue.force_majeure && <Detail label="不可抗力">平台已认定，应扣款项全部免除</Detail>}
      </dl>
      {rescue.deductions.length > 0 && <DeductionList deductions={rescue.deductions} />}
      <p className="field__hint">
        {"应扣款项现在只记账，结算时从你们的账单里扣。"}
        <Link className="link" to={DEDUCTIONS_PATH}>
          看全部违约金与扣款
        </Link>
      </p>
    </section>
  );
}

function OfferCard({ offer, now, canDecide, onChanged }: { offer: TenantRescueOffer; now: Date; canDecide: boolean; onChanged(text: string): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const zone = offer.trip.timezone;
  const run = async (action: () => Promise<unknown>, text: string, what: string): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      await action();
      setDeclining(false);
      onChanged(text);
    } catch (err) {
      if (!handleAuthFailure(err)) setProblem(failureText(err, what));
    } finally {
      setBusy(false);
    }
  };
  const headingId = `offer-${offer.id}`;
  return (
    <section className="card" aria-labelledby={headingId}>
      <div className="card__title-row">
        <h2 className="card__title" id={headingId}>{`${offer.trip.service_local.replace("T", " ")} · ${CATEGORY_NAMES[offer.trip.category]} · ${directionName(offer.trip)}`}</h2>
        <StatusBadge {...OFFER_STATUS_BADGES[offer.status]} />
      </div>
      <dl className="details">
        <Detail label="行程">{routeText(offer.trip)}</Detail>
        <Detail label="人数行李">{`${offer.trip.passengers} 人 ${offer.trip.luggage} 件行李`}</Detail>
        <Detail label="结算价">{moneyText(offer.settlement.total)}</Detail>
        <Detail label="接单期限">{offer.status === "pending" ? `${formatInZone(offer.expires_at, zone)}（${offerRemainingText(offer.expires_at, now)}）` : formatInZone(offer.expires_at, zone)}</Detail>
        {offer.decline_reason && <Detail label="拒绝原因">{offer.decline_reason}</Detail>}
      </dl>
      {offer.status === "accepted" && offer.order_id !== null && (
        <Link className="link" to={orderPath(offer.order_id)}>
          去订单派车
        </Link>
      )}
      {offer.status === "pending" && canDecide && (
        <div className="form__actions">
          <Button variant="primary" loading={busy} onClick={() => void run(() => acceptRescueOffer(token, offer.id), "已接单：去订单里派车", "接单")}>
            接单
          </Button>
          <Button variant="text" onClick={() => setDeclining(true)}>
            拒绝
          </Button>
        </div>
      )}
      {problem !== null && <Alert kind="danger">{problem}</Alert>}
      {declining && (
        <Dialog open title="拒绝救援单" size="form" busy={busy} onClose={() => setDeclining(false)} footer={<><Button variant="text" onClick={() => setDeclining(false)}>不拒绝</Button><Button variant="danger" loading={busy} onClick={() => void run(() => declineRescueOffer(token, offer.id, reason.trim() === "" ? null : reason.trim()), "已拒绝", "拒绝")}>拒绝</Button></>}>
          <p>拒绝不计入你们的履约失败，平台会顺延给下一家。</p>
          <TextField label="原因（选填）" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
        </Dialog>
      )}
    </section>
  );
}

export function RescueOffersPage() {
  const { portal, account } = usePortalSession();
  useDocumentTitle(`救援单 · NOZOMI ${portal.name}`);
  const canDispatch = useTenantCan("order.dispatch");
  const toast = useToast();
  const now = useNow();
  const { state, reload } = useLoad<{ items: TenantRescueOffer[] }>("rescue-offers", canDispatch ? (t) => listRescueOffers(t, false) : null);
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="救援单">
      <Page title="救援单">{content}</Page>
    </AppShell>
  );
  if (account.status === "ready" && !canDispatch) return shell(NO_ACCESS);
  const items = state.data?.items ?? [];
  const pending = items.filter((offer) => offer.status === "pending");
  const others = items.filter((offer) => offer.status !== "pending");
  return shell(
    <>
      <p className="page__lead">别的供应商接不了的单，平台按报价排序发给你们。救援单是唯一要主动接的订单：15 分钟内（用车前 2 小时内 5 分钟）不接就顺延给下一家。接单前看不到乘客信息，接了在订单里看。</p>
      {state.status === "error" && <StateBlock tone="danger" title="救援单没取到" description="请检查网络后刷新。" />}
      {state.status === "ready" && items.length === 0 && <StateBlock tone="neutral" title="还没有救援单" description="平台发来时这里会出现（订阅了 Webhook 的也会收到 rescue.offered）。" />}
      {pending.map((offer) => (
        <OfferCard
          key={offer.id}
          offer={offer}
          now={now}
          canDecide={canDispatch}
          onChanged={(text) => {
            toast(text);
            reload();
          }}
        />
      ))}
      {others.length > 0 && (
        <section className="card">
          <h2 className="card__title">以前的救援单</h2>
          <ul className="plain-list">
            {others.map((offer) => (
              <li key={offer.id}>
                <StatusBadge {...OFFER_STATUS_BADGES[offer.status]} />
                {` ${offer.trip.service_local.replace("T", " ")} · ${routeText(offer.trip)} · ${moneyText(offer.settlement.total)} `}
                {offer.order_id !== null && (
                  <Link className="link" to={orderPath(offer.order_id)}>
                    看订单
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>,
  );
}

export function DeductionsPage() {
  const { portal, account } = usePortalSession();
  useDocumentTitle(`违约金与扣款 · NOZOMI ${portal.name}`);
  const canRead = useTenantCan("order.read");
  const { state } = useLoad<{ items: TenantDeduction[] }>("deductions", canRead ? (t) => listDeductions(t) : null);
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="违约金与扣款">
      <Page title="违约金与扣款">{content}</Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);
  const items = state.data?.items ?? [];
  return shell(
    <>
      <p className="page__lead">你们没有履约、由平台救援改派的订单要承担违约金和救援差价。现在只记账，结算时从当期或下一期账单里扣。不可抗力经平台认定的已免除。</p>
      {state.status === "error" && <StateBlock tone="danger" title="没取到" description="请检查网络后刷新。" />}
      {state.status === "ready" && items.length === 0 && <StateBlock tone="neutral" title="没有应扣款项" description="没有被救援改派过的订单。" />}
      {items.length > 0 && (
        <div className="table-wrap">
          <div className="table-scroll" tabIndex={0} role="region" aria-label="应扣款项表">
            <table className="table">
              <caption className="visually-hidden">应扣款项</caption>
              <thead>
                <tr>
                  <th scope="col">订单号</th>
                  <th scope="col">款项</th>
                  <th scope="col">金额</th>
                  <th scope="col">状态</th>
                  <th scope="col">怎么算的</th>
                  <th scope="col">记账时间</th>
                </tr>
              </thead>
              <tbody>
                {items.map((deduction) => (
                  <tr key={deduction.id}>
                    <th scope="row">
                      <Link className="link mono" to={orderPath(deduction.order_id)}>
                        {deduction.order_no}
                      </Link>
                    </th>
                    <td>{deductionKindName(deduction.kind)}</td>
                    <td>{moneyText(deduction.amount)}</td>
                    <td>
                      <StatusBadge {...DEDUCTION_STATUS_BADGES[deduction.status]} />
                    </td>
                    <td>{`${deductionBasisText(deduction.kind, deduction.basis, deduction.amount.currency)}${deduction.waive_reason ? `；免除说明：${deduction.waive_reason}` : ""}`}</td>
                    <td>{formatLocalDateTime(deduction.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>,
  );
}
