/**
 * 运营后台「救援」（M3-04，ADR 0031）：
 * - 救援队列（`order.read`）：没有结论的救援（待处理、救援单待接、候选都不接）、司机未到的提醒（到点 15 分钟未到、客人报告）、暂停中还有未来订单的供应商；
 *   已有结论的（已改派、已取消订单）另一页签。每一条点进订单详情处理。
 * - 订单详情里的「救援改派」（`RescueSection`）：全部救援记录（触发、违约金、救援单、改派结果、应扣款项、不可抗力）；
 *   `rescue.manage`（运营、客服）能发起（4 种情形之一，写说明）、看候选和差价、给一家发救援单、人工指定（提交后要另一位有 `rescue.review` 的同事批准）、认定不可抗力。
 * 客人付的钱不变；违约金和差价现在只记账，结算时扣（页面上写明）。
 */
import { type OrderStatus, RESCUE_TRIGGERS, type RescueTrigger } from "@nozomi/domain";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { ApiError } from "../../api/client.ts";
import type { PlatformOrder } from "../../api/order-money.ts";
import {
  type PlatformRescue,
  type RescueCandidates,
  type RescueQueue,
  getRescueCandidates,
  getRescueQueue,
  markForceMajeure,
  offerRescue,
  requestManualAssign,
  rescueSuspendedTenant,
  triggerRescue,
} from "../../api/rescues.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { SelectField } from "../../components/FormFields.tsx";
import { StateBlock } from "../../components/States.tsx";
import { ORDER_STATUS_BADGES, StatusBadge } from "../../components/StatusBadge.tsx";
import { TextField } from "../../components/TextField.tsx";
import { useToast } from "../../components/Toast.tsx";
import { formatInZone, moneyText } from "../../lib/dispatch-display.ts";
import { failureText } from "../../lib/failure.ts";
import { formatLocalDateTime } from "../../lib/master-display.ts";
import { amountToMinor, platformOrderPath } from "../../lib/order-money-display.ts";
import { DEDUCTION_STATUS_BADGES, OFFER_STATUS_BADGES, PLATFORM_TRIGGER_HINTS, RESCUE_STATUS_BADGES, deductionBasisText, deductionKindName, penaltyText, triggerName } from "../../lib/rescue-display.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan } from "../../lib/use-master-access.ts";

const NO_ACCESS = <StateBlock tone="neutral" title="你没有权限查看这里" description="需要的话，请联系管理员开通。" />;
/** 能发起救援的订单状态（和后端的触发规则同一份：服务开始之前、司机还没到上车点） */
const TRIGGERABLE: readonly OrderStatus[] = ["confirmed", "assigned", "departed"];
const BY_NAMES = { tenant_user: "供应商", system: "系统", platform_user: "运营" } as const;

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="details__item">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function offerSummary(rescue: PlatformRescue, zone: string): string {
  const pending = rescue.offers.find((offer) => offer.status === "pending");
  if (pending !== undefined) return `救援单待「${pending.tenant.name}」接，到 ${formatInZone(pending.expires_at, zone)}`;
  if (rescue.rescue_tenant !== null) return `改派给「${rescue.rescue_tenant.name}」${rescue.rescued_via === "manual" ? "（人工指定）" : ""}`;
  return rescue.offers.length === 0 ? "还没发救援单" : `发过 ${rescue.offers.length} 张，都没接`;
}

export function RescueQueuePage() {
  const { portal, account, token, handleAuthFailure } = usePortalSession();
  useDocumentTitle(`救援 · NOZOMI ${portal.name}`);
  const canRead = usePlatformCan("order.read");
  const canManage = usePlatformCan("rescue.manage");
  const toast = useToast();
  const [state, setState] = useState<"open" | "closed">("open");
  const { state: loaded, reload } = useLoad<RescueQueue>(`rescues|${state}`, canRead ? (t) => getRescueQueue(t, state) : null);
  const [batch, setBatch] = useState<{ id: string; name: string; orders: number } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="救援">
      <Page title="救援改派">{content}</Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);
  const queue = loaded.data;
  const runBatch = async (): Promise<void> => {
    if (batch === null) return;
    setBusy(true);
    try {
      const result = await rescueSuspendedTenant(token, batch.id, note.trim() === "" ? null : note.trim());
      toast(`已发起 ${result.triggered.length} 张${result.skipped.length > 0 ? `，${result.skipped.length} 张没发起（已在救援中或状态变了）` : ""}`);
      setBatch(null);
      setNote("");
      reload();
    } catch (err) {
      if (!handleAuthFailure(err)) toast(failureText(err, "批量发起"));
    } finally {
      setBusy(false);
    }
  };
  return shell(
    <>
      <p className="page__lead">只有 4 种情形启动救援改派：供应商声明无法履约、用车前 6 小时仍未派车（系统自动）、司机未到（到点 15 分钟、联系不上）、供应商被暂停。客人付的钱不变；违约金和救援差价记到原供应商的应扣款项，结算时扣。</p>
      <div className="filter-bar">
        <SelectField inline label="看哪些" value={state} options={[{ value: "open", label: "待处理" }, { value: "closed", label: "已有结论" }]} onChange={(value) => setState(value)} />
      </div>
      {loaded.status === "error" && <StateBlock tone="danger" title="救援队列没取到" description="请检查网络后刷新。" />}
      {queue !== undefined && queue !== null && (
        <>
          <section className="card" aria-labelledby="rescue-items-title">
            <h2 className="card__title" id="rescue-items-title">{state === "open" ? `待处理的救援（${queue.items.length}）` : `最近有结论的救援（${queue.items.length}）`}</h2>
            {queue.items.length === 0 ? (
              <p className="table__muted">{state === "open" ? "现在没有要处理的救援。" : "还没有。"}</p>
            ) : (
              <div className="table-wrap">
                <div className="table-scroll" tabIndex={0} role="region" aria-label="救援表">
                  <table className="table">
                    <caption className="visually-hidden">救援</caption>
                    <thead>
                      <tr>
                        <th scope="col">订单号</th>
                        <th scope="col">用车时间（当地）</th>
                        <th scope="col">情形</th>
                        <th scope="col">原供应商</th>
                        <th scope="col">违约金</th>
                        <th scope="col">状态</th>
                        <th scope="col">进展</th>
                      </tr>
                    </thead>
                    <tbody>
                      {queue.items.map((rescue) => (
                        <tr key={rescue.id}>
                          <th scope="row">
                            <Link className="link mono" to={platformOrderPath(rescue.order.id)}>
                              {rescue.order.order_no}
                            </Link>
                          </th>
                          <td>
                            <time dateTime={rescue.order.service_time}>{rescue.order.service_local.replace("T", " ")}</time>
                          </td>
                          <td>{triggerName(rescue.trigger)}</td>
                          <td>{rescue.original_tenant.name}</td>
                          <td>{`${rescue.penalty_bp / 100}%（${moneyText(rescue.penalty)}）${rescue.force_majeure ? " · 不可抗力已免除" : ""}`}</td>
                          <td>
                            <StatusBadge {...RESCUE_STATUS_BADGES[rescue.status]} />
                          </td>
                          <td>{offerSummary(rescue, rescue.order.timezone)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          {state === "open" && (
            <section className="card" aria-labelledby="rescue-alerts-title">
              <h2 className="card__title" id="rescue-alerts-title">{`司机未到的提醒（${queue.alerts.length}）`}</h2>
              <p className="field__hint">到点 15 分钟司机仍未「已到达」，或客人报告司机没到。先联系司机和供应商；联系不上就在订单详情里按「司机未到」发起救援，或取消订单、请客人自行打车凭票报销。</p>
              {queue.alerts.length > 0 && (
                <ul className="plain-list">
                  {queue.alerts.map((alert) => (
                    <li key={alert.order_id}>
                      <Link className="link mono" to={platformOrderPath(alert.order_id)}>
                        {alert.order_no}
                      </Link>
                      {` · ${alert.tenant.name} · `}
                      <StatusBadge {...ORDER_STATUS_BADGES[alert.status]} />
                      {alert.arrival_overdue_at !== null && ` · ${formatLocalDateTime(alert.arrival_overdue_at)} 发现到点 15 分钟未到`}
                      {alert.driver_missing_reported_at !== null && ` · ${formatLocalDateTime(alert.driver_missing_reported_at)} 客人报告司机没到`}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {state === "open" && queue.suspended_tenants.length > 0 && (
            <section className="card" aria-labelledby="rescue-suspended-title">
              <h2 className="card__title" id="rescue-suspended-title">暂停中、还有未来订单的供应商</h2>
              <p className="field__hint">暂停后已有订单照常履约；要改派给别的供应商时在这里批量发起（违约金按距用车时间 0 / 30% / 100%）。</p>
              <ul className="plain-list">
                {queue.suspended_tenants.map((entry) => (
                  <li key={entry.tenant.id}>
                    {`${entry.tenant.name}：${entry.future_orders} 张未来订单 `}
                    {canManage && (
                      <Button variant="secondary" size="sm" onClick={() => setBatch({ id: entry.tenant.id, name: entry.tenant.name, orders: entry.future_orders })}>
                        {`批量发起救援：${entry.tenant.name}`}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {batch !== null && (
        <Dialog
          open
          title={`批量发起救援：${batch.name}`}
          size="form"
          busy={busy}
          onClose={() => setBatch(null)}
          footer={
            <>
              <Button variant="text" onClick={() => setBatch(null)}>
                先不发
              </Button>
              <Button variant="danger" loading={busy} onClick={() => void runBatch()}>
                {`发起 ${batch.orders} 张`}
              </Button>
            </>
          }
        >
          <p>{`${batch.name}名下 ${batch.orders} 张还没开始的订单会进入救援改派，供应商不能再操作这些单。`}</p>
          <TextField label="说明（选填）" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
        </Dialog>
      )}
    </>,
  );
}

// ---- 订单详情里的救援 ----

type DialogKind = "trigger" | "candidates" | "manual" | "force" | null;

/** 发起救援被拒的说法：还没付款的单（页面停留期间状态没刷新时会碰到）说清要等付款完成，不说成订单不存在。 */
function triggerFailureText(err: unknown): string {
  if (err instanceof ApiError && err.code === "ORDER_STATE_INVALID" && err.details["reason"] === "NOT_CONFIRMED") return "这张订单还没付款：付款完成、订单确认后才能发起救援改派。请刷新页面看订单现在的状态。";
  return failureText(err, "发起救援");
}

function TriggerDialog({ order, onClose, onDone }: { order: PlatformOrder; onClose(): void; onDone(text: string): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const [trigger, setTrigger] = useState<RescueTrigger>("driver_no_show");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    if (note.trim() === "") {
      setProblem("请写明情况（会记进审计日志）");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const { rescue } = await triggerRescue(token, order.id, { trigger, note: note.trim() });
      onDone(`已进入救援改派，违约金 ${rescue.penalty_bp / 100}%：请看候选、发救援单`);
    } catch (err) {
      if (!handleAuthFailure(err)) setProblem(triggerFailureText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open title="发起救援改派" size="form" busy={busy} onClose={onClose} footer={<><Button variant="text" onClick={onClose}>先不发起</Button><Button variant="danger" loading={busy} onClick={() => void submit()}>发起</Button></>}>
      <SelectField label="情形" value={trigger} options={RESCUE_TRIGGERS.map((value) => ({ value, label: triggerName(value) }))} onChange={(value) => setTrigger(value)} />
      <p className="field__hint">{PLATFORM_TRIGGER_HINTS[trigger]}</p>
      <TextField label="情况说明" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
      <Alert kind="warning">发起后原供应商不能再操作这一单（司机链接立即作废），违约金按情形和距用车时间记账。</Alert>
      {problem !== null && <Alert kind="danger">{problem}</Alert>}
    </Dialog>
  );
}

function CandidatesDialog({ order, onClose, onDone }: { order: PlatformOrder; onClose(): void; onDone(text: string): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const { state } = useLoad<RescueCandidates>(`rescue-candidates|${order.id}`, (t) => getRescueCandidates(t, order.id));
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const send = async (tenantId: string, name: string): Promise<void> => {
    setBusy(tenantId);
    setProblem(null);
    try {
      await offerRescue(token, order.id, tenantId);
      onDone(`已给「${name}」发救援单：15 分钟（用车前 2 小时内 5 分钟）不接会自动顺延下一家`);
    } catch (err) {
      if (!handleAuthFailure(err)) setProblem(failureText(err, "发救援单"));
    } finally {
      setBusy(null);
    }
  };
  const found = state.data;
  return (
    <Dialog open title="救援候选" size="form" busy={busy !== null} onClose={onClose} footer={<Button variant="text" onClick={onClose}>关闭</Button>}>
      <p className="field__hint">按原报价条件（同一个渠道、这一单的车型组、现在的用车时间）重新比价，排除以前接过这一单的和已经发过的，按中标排序。差价是改派给它时原供应商要承担的（为负记 0）。</p>
      {state.status === "error" && <Alert kind="danger">候选没取到，请稍后再试。</Alert>}
      {found !== undefined && found !== null && (
        <>
          {found.candidates.length === 0 ? (
            <Alert kind="warning">现在没有能接这一单的候选。可以人工指定（双人复核），或取消订单全额退款（原因选「供应商原因」）。</Alert>
          ) : (
            <div className="table-wrap">
              <div className="table-scroll" tabIndex={0} role="region" aria-label="候选表">
                <table className="table">
                  <caption className="visually-hidden">候选</caption>
                  <thead>
                    <tr>
                      <th scope="col">名次</th>
                      <th scope="col">供应商</th>
                      <th scope="col">结算价</th>
                      <th scope="col">对外价</th>
                      <th scope="col">原供应商承担的差价</th>
                      <th scope="col">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {found.candidates.map((candidate) => (
                      <tr key={candidate.tenant.id}>
                        <td>{candidate.position}</td>
                        <th scope="row">{`${candidate.tenant.name}${candidate.urgent ? "（加急价）" : ""}`}</th>
                        <td>{moneyText(candidate.settlement)}</td>
                        <td>{moneyText(candidate.sell)}</td>
                        <td>{candidate.difference === null ? "换算不了" : moneyText(candidate.difference)}</td>
                        <td>
                          <Button variant="secondary" size="sm" loading={busy === candidate.tenant.id} onClick={() => void send(candidate.tenant.id, candidate.tenant.name)}>
                            {`发救援单给 ${candidate.tenant.name}`}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {found.excluded.length > 0 && (
            <>
              <h3 className="card__subtitle">没能当候选的</h3>
              <ul className="plain-list">
                {found.excluded.map((entry, index) => (
                  <li key={`${entry.tenant.id}-${entry.product_id ?? ""}-${index}`}>{`${entry.tenant.name}：${entry.message}`}</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {problem !== null && <Alert kind="danger">{problem}</Alert>}
    </Dialog>
  );
}

function ManualDialog({ order, onClose, onDone }: { order: PlatformOrder; onClose(): void; onDone(text: string): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const { state } = useLoad<RescueCandidates>(`rescue-candidates|${order.id}`, (t) => getRescueCandidates(t, order.id));
  const options = [...(state.data?.candidates ?? []).map((entry) => ({ tenant: entry.tenant, productId: entry.product_id })), ...(state.data?.excluded ?? []).flatMap((entry) => (entry.product_id === null ? [] : [{ tenant: entry.tenant, productId: entry.product_id }]))];
  const [choice, setChoice] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const picked = options.find((option) => `${option.tenant.id}|${option.productId}` === choice) ?? options[0];
  const submit = async (): Promise<void> => {
    const minor = amountToMinor(amount, order.settlement.total.currency);
    if (picked === undefined) {
      setProblem("没有可以指定的供应商商品");
      return;
    }
    if (minor === null) {
      setProblem("结算价写成大于 0 的数，如 22000");
      return;
    }
    if (note.trim() === "") {
      setProblem("请写明和供应商谈好的情况");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await requestManualAssign(token, order.id, { tenant_id: picked.tenant.id, product_id: picked.productId, settlement_amount: minor, note: note.trim() });
      onDone("已提交人工指定：要另一位同事在「待审核」里批准才会改派");
    } catch (err) {
      if (!handleAuthFailure(err)) setProblem(failureText(err, "人工指定"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open title="人工指定救援供应商" size="form" busy={busy} onClose={onClose} footer={<><Button variant="text" onClick={onClose}>先不指定</Button><Button variant="primary" loading={busy} onClick={() => void submit()}>提交审核</Button></>}>
      <p className="field__hint">候选都不接、或电话联系好的供应商报不出价时用。提交后要另一位有审核权限的同事批准才生效；批准后直接改派，不用它再接单。</p>
      <SelectField label="供应商和商品" value={picked === undefined ? "" : `${picked.tenant.id}|${picked.productId}`} options={options.map((option) => ({ value: `${option.tenant.id}|${option.productId}`, label: option.tenant.name }))} onChange={(value) => setChoice(value)} />
      <TextField label={`谈好的结算价（这家的结算币种，现在按 ${order.settlement.total.currency}）`} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
      <TextField label="说明" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} hint="如「电话联系，对方同意 22,000 接」" />
      {problem !== null && <Alert kind="danger">{problem}</Alert>}
    </Dialog>
  );
}

function ForceMajeureDialog({ order, onClose, onDone }: { order: PlatformOrder; onClose(): void; onDone(text: string): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    if (note.trim() === "") {
      setProblem("请写明是什么不可抗力（会给供应商看、记进审计日志）");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const result = await markForceMajeure(token, order.id, note.trim());
      onDone(`已认定不可抗力，免除了 ${result.waived} 条应扣款项`);
    } catch (err) {
      if (!handleAuthFailure(err)) setProblem(failureText(err, "认定不可抗力"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open title="认定不可抗力" size="form" busy={busy} onClose={onClose} footer={<><Button variant="text" onClick={onClose}>不认定</Button><Button variant="primary" loading={busy} onClick={() => void submit()}>认定</Button></>}>
      <p className="field__hint">大雪封路、机场关闭、政府管制等：原供应商这次救援的违约金和救援差价全部免除。客人全额退款请另外「代客人取消」，原因选「不可抗力」。</p>
      <TextField label="说明" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} hint="如「大雪，东关东自动车道封闭」" />
      {problem !== null && <Alert kind="danger">{problem}</Alert>}
    </Dialog>
  );
}

/** 订单详情里的「救援改派」：记录 + 能做的操作。 */
export function RescueSection({ order, rescues, onChanged }: { order: PlatformOrder; rescues: PlatformRescue[]; onChanged(): void }) {
  const canManage = usePlatformCan("rescue.manage");
  const toast = useToast();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const open = rescues.find((rescue) => rescue.status === "open" || rescue.status === "offering" || rescue.status === "exhausted") ?? null;
  const latest = rescues[rescues.length - 1] ?? null;
  const zone = order.timezone;
  if (rescues.length === 0 && !(canManage && TRIGGERABLE.includes(order.status))) return null;
  const done = (text: string): void => {
    setDialog(null);
    toast(text);
    onChanged();
  };
  return (
    <section className="card" aria-labelledby="rescue-section-title">
      <div className="card__title-row">
        <h2 className="card__title" id="rescue-section-title">
          救援改派
        </h2>
        {open !== null && <StatusBadge {...RESCUE_STATUS_BADGES[open.status]} />}
      </div>
      {rescues.map((rescue) => (
        <div key={rescue.id}>
          <dl className="details">
            <Detail label="情形">{`${triggerName(rescue.trigger)}（${BY_NAMES[rescue.triggered_by_type]}，${formatLocalDateTime(rescue.triggered_at)}）`}</Detail>
            {rescue.reason && <Detail label="原因 / 说明">{rescue.reason}</Detail>}
            <Detail label="原供应商">{`${rescue.original_tenant.name} · 原结算价 ${moneyText(rescue.original_settlement)}`}</Detail>
            <Detail label="违约金">{`${penaltyText(rescue.penalty_tier)} = ${moneyText(rescue.penalty)}`}</Detail>
            <Detail label="状态">
              <StatusBadge {...RESCUE_STATUS_BADGES[rescue.status]} />
              {` ${offerSummary(rescue, zone)}`}
            </Detail>
            {rescue.rescue_settlement !== null && <Detail label="救援结算价">{moneyText(rescue.rescue_settlement)}</Detail>}
            {rescue.force_majeure !== null && <Detail label="不可抗力">{`${formatLocalDateTime(rescue.force_majeure.at)} 认定：${rescue.force_majeure.note}`}</Detail>}
          </dl>
          {rescue.offers.length > 0 && (
            <ul className="plain-list" aria-label="救援单">
              {rescue.offers.map((offer) => (
                <li key={offer.id}>
                  <StatusBadge {...OFFER_STATUS_BADGES[offer.status]} />
                  {` ${offer.tenant.name} · 结算价 ${moneyText(offer.settlement)}${offer.sell === null ? "" : ` · 对外价 ${moneyText(offer.sell)}`}${offer.position === null ? "" : ` · 第 ${offer.position} 名`} · ${offer.offered_by_type === "system" ? "自动顺延" : "运营发出"} ${formatInZone(offer.offered_at, zone)}，期限 ${formatInZone(offer.expires_at, zone)}${offer.decline_reason ? ` · 拒绝原因：${offer.decline_reason}` : ""}`}
                </li>
              ))}
            </ul>
          )}
          {rescue.deductions.length > 0 && (
            <ul className="plain-list" aria-label="应扣款项">
              {rescue.deductions.map((deduction) => (
                <li key={deduction.id}>
                  {`${deductionKindName(deduction.kind)} ${moneyText(deduction.amount)} `}
                  <StatusBadge {...DEDUCTION_STATUS_BADGES[deduction.status]} />
                  <span className="table__muted">{` ${deductionBasisText(deduction.kind, deduction.basis, deduction.amount.currency)}`}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {rescues.length > 0 && <p className="field__hint">违约金和救援差价现在只记账，结算时从原供应商的账单里扣。客人付的钱不变。</p>}
      {canManage && (
        <div className="form__actions">
          {open === null && TRIGGERABLE.includes(order.status) && (
            <Button variant="danger" onClick={() => setDialog("trigger")}>
              发起救援改派
            </Button>
          )}
          {open !== null && open.status !== "offering" && (
            <Button variant="primary" onClick={() => setDialog("candidates")}>
              看候选并发救援单
            </Button>
          )}
          {open !== null && open.status !== "offering" && (
            <Button variant="secondary" onClick={() => setDialog("manual")}>
              人工指定（双人复核）
            </Button>
          )}
          {latest !== null && latest.force_majeure === null && (
            <Button variant="text" onClick={() => setDialog("force")}>
              认定不可抗力
            </Button>
          )}
        </div>
      )}
      {dialog === "trigger" && <TriggerDialog order={order} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "candidates" && <CandidatesDialog order={order} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "manual" && <ManualDialog order={order} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "force" && <ForceMajeureDialog order={order} onClose={() => setDialog(null)} onDone={done} />}
    </section>
  );
}
