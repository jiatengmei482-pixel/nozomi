/**
 * 供应商订单详情里的取消、改单、事后加收（M3-03，ADR 0029）。规则 4：这里只有结算价一侧的金额（你报的、你应得的），没有客人付的。
 * - 取消规则：这一单适用的阶梯（下单时的平台政策，只读）；取消了的写出扣款比例和你应得的；
 * - 改单：客人改了什么（改前改后）；客人的修改申请：同意、标记调整中、拒绝（必填原因）（`order.dispatch`，ADR 0060）；
 * - 事后加收（`order.extra_charge`：管理员、调度、财务）：服务结束 24 小时内提交，高速费、停车费要附票据照片；48 小时异议期内可以撤回。
 */
import { useState } from "react";
import type { TenantOrder } from "../../api/dispatch.ts";
import { type ChangeDecision, type ExtraCharge, type OrderChange, decideChange, submitExtraCharge, uploadReceipt, withdrawExtraCharge } from "../../api/order-money.ts";
import { ApiError } from "../../api/client.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { Button } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { SelectField } from "../../components/FormFields.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { TextField } from "../../components/TextField.tsx";
import { useToast } from "../../components/Toast.tsx";
import { formatInZone, moneyText } from "../../lib/dispatch-display.ts";
import { failureText } from "../../lib/failure.ts";
import { CHANGE_FIELD_NAMES, CHANGE_STATUS_BADGES, EXTRA_STATUS_BADGES, REVIEW_REASON_NAMES, amountToMinor, cancelReasonName, changeValueText, extraTypeName, extraTypesFor, levelName, tiersText } from "../../lib/order-money-display.ts";
import type { ExtraChargeType } from "@nozomi/domain";

export function CancellationSection({ order }: { order: TenantOrder }) {
  return (
    <section className="card">
      <h2 className="card__title">取消规则</h2>
      <dl className="details">
        <div className="details__item">
          <dt>这一单的取消阶梯</dt>
          <dd>{order.cancel_policy === null ? "按平台现在的取消政策" : `${levelName(order.cancel_policy.level)}：${tiersText(order.cancel_policy.tiers)}`}</dd>
        </div>
        {order.cancellation !== null && (
          <>
            <div className="details__item">
              <dt>取消原因</dt>
              <dd>{cancelReasonName(order.cancel_reason)}</dd>
            </div>
            <div className="details__item">
              <dt>你应得</dt>
              <dd>{`${moneyText(order.cancellation.tenant_share)}（结算价 × ${order.cancellation.fee_bp / 100}%）`}</dd>
            </div>
          </>
        )}
      </dl>
      <p className="field__hint">取消政策由平台按品类和车型级别统一规定；客人取消时按上面的阶梯扣款，你得结算价 × 同一比例。航班取消（有证明）、不可抗力、平台或供应商原因的取消不扣款。</p>
    </section>
  );
}

/** 拒绝要写原因：只留在后台，不给客人看（ADR 0060）。 */
function RejectChangeDialog({ busy, problem, onClose, onSubmit }: { busy: boolean; problem: string | null; onClose(): void; onSubmit(note: string): void }) {
  const [note, setNote] = useState("");
  const [missing, setMissing] = useState(false);
  return (
    <Dialog
      open
      title="拒绝这次修改"
      size="form"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            返回
          </Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={() => {
              if (note.trim() === "") setMissing(true);
              else onSubmit(note.trim());
            }}
          >
            确认拒绝
          </Button>
        </>
      }
    >
      {problem !== null && <Alert kind="danger">{problem}</Alert>}
      <p>拒绝后原预约不变，客人补过的差价退回，客人会收到结果邮件，可能免费取消。</p>
      <TextField label="拒绝原因" required value={note} maxLength={500} hint="只留在后台和操作记录里，不会给客人看。" errors={missing ? ["请写拒绝原因"] : []} onChange={(event) => setNote(event.target.value)} />
    </Dialog>
  );
}

const OPEN_CHANGE: readonly OrderChange["status"][] = ["pending_confirmation", "adjusting"];

export function ChangesSection({ order, changes, canDecide, driverEmailState, onChanged }: { order: TenantOrder; changes: readonly OrderChange[]; canDecide: boolean; driverEmailState: string | null; onChanged(): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<OrderChange | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  if (changes.length === 0) return null;
  const DONE: Readonly<Record<ChangeDecision, string>> = { confirm: "已同意，订单已更新", reject: "已拒绝：原预约不变，已告诉客人", adjusting: "已标记调整中" };
  const NAMES: Readonly<Record<ChangeDecision, string>> = { confirm: "同意", reject: "拒绝", adjusting: "标记调整中" };
  const decide = async (change: OrderChange, decision: ChangeDecision, note: string | null): Promise<void> => {
    setBusy(change.id);
    setProblem(null);
    try {
      await decideChange(token, order.id, change.id, decision, note);
      toast(DONE[decision]);
      setRejecting(null);
    } catch (err) {
      if (handleAuthFailure(err)) return;
      if (err instanceof ApiError && err.code === "CHANGE_NOT_SERVICEABLE") toast("新的那一天已经订满了：可以加库存后再同意，或者拒绝。修改申请还留着。");
      else if (decision === "reject") setProblem(failureText(err, NAMES[decision]));
      else toast(failureText(err, NAMES[decision]));
    } finally {
      setBusy(null);
      onChanged();
    }
  };
  const hasDriver = order.dispatch.driver !== null;
  const driverWarning = driverEmailState === "no_email" ? "这位司机没有邮箱，系统通知不到，请电话联系。" : driverEmailState === "manual" ? "你们设置了手动发送，系统不会给司机发邮件，请自己通知司机。" : "系统已发邮件告诉司机，确认前按原任务执行。";
  return (
    <section className="card" id="order-changes">
      <h2 className="card__title">修改记录</h2>
      <ul className="plain-list">
        {changes.map((change) => {
          const fields = Object.keys(change.after).filter((field) => field !== "service_local");
          const open = OPEN_CHANGE.includes(change.status);
          return (
            <li key={change.id}>
              <StatusBadge {...CHANGE_STATUS_BADGES[change.status]} />
              {` ${fields.map((field) => `${CHANGE_FIELD_NAMES[field] ?? field}：${changeValueText(field, change.before[field], order.timezone)} → ${changeValueText(field, change.after[field], order.timezone)}`).join("；")}`}
              {change.reschedule && `；结算价 ${moneyText(change.settlement_before)} → ${moneyText(change.settlement_after)}`}
              {change.decision_note !== null && `；说明：${change.decision_note}`}
              {change.decided_by_platform && "（平台代为处理）"}
              {change.dispatch_conflict && <Alert kind="warning">原来派的司机或车辆在新的时段有别的单，请改派。</Alert>}
              {open && hasDriver && <Alert kind="warning">{`需调整司机：${driverWarning}`}</Alert>}
              {open && (
                <div className="form__actions">
                  <span className="field__hint">{`请在 ${formatInZone(change.confirm_due_at, order.timezone)} 之前处理。确认前原预约仍然有效；超时按没确认处理，客人可能免费取消。`}</span>
                  {canDecide && (
                    <>
                      <Button variant="primary" size="sm" loading={busy === change.id} onClick={() => void decide(change, "confirm", null)}>
                        同意
                      </Button>
                      {change.status === "pending_confirmation" && (
                        <Button variant="secondary" size="sm" loading={busy === change.id} onClick={() => void decide(change, "adjusting", null)}>
                          调整中
                        </Button>
                      )}
                      <Button
                        variant="text"
                        size="sm"
                        loading={busy === change.id}
                        onClick={() => {
                          setProblem(null);
                          setRejecting(change);
                        }}
                      >
                        拒绝
                      </Button>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {rejecting !== null && <RejectChangeDialog busy={busy === rejecting.id} problem={problem} onClose={() => setRejecting(null)} onSubmit={(note) => void decide(rejecting, "reject", note)} />}
    </section>
  );
}

function SubmitDialog({ order, onClose, onDone }: { order: TenantOrder; onClose(): void; onDone(): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const types = extraTypesFor(order.category);
  const [type, setType] = useState<ExtraChargeType>(types[0] as ExtraChargeType);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const currency = order.settlement.total.currency;
  const upload = async (list: FileList | null): Promise<void> => {
    if (list === null || list.length === 0) return;
    setUploading(true);
    setProblem(null);
    try {
      for (const file of [...list]) {
        const { file: saved } = await uploadReceipt(token, order.id, file);
        setFiles((current) => [...current, { id: saved.id, name: file.name }]);
      }
    } catch (err) {
      if (!handleAuthFailure(err)) setProblem(failureText(err, "上传票据"));
    } finally {
      setUploading(false);
    }
  };
  const submit = async (): Promise<void> => {
    const minor = amountToMinor(amount, currency);
    if (minor === null) {
      setProblem(`金额写成大于 0 的数（${currency}），如 2000`);
      return;
    }
    if ((type === "toll" || type === "parking") && files.length === 0) {
      setProblem("高速费、停车费要附票据照片");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await submitExtraCharge(token, order.id, { type, amount: minor, description: description.trim() === "" ? null : description.trim(), file_ids: files.map((file) => file.id) });
      onDone();
    } catch (err) {
      if (!handleAuthFailure(err)) setProblem(failureText(err, "提交"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      title="提交事后加收"
      size="form"
      busy={busy || uploading}
      onClose={onClose}
      footer={
        <>
          <Button variant="text" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            提交
          </Button>
        </>
      }
    >
      <SelectField label="类型" value={type} options={types.map((value) => ({ value, label: extraTypeName(value) }))} onChange={(value) => setType(value)} />
      <TextField label={`金额（结算价，${currency}）`} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} hint="不能超过这一单的结算价；超过客人付的 50% 会转平台审核" />
      <TextField label="说明" value={description} maxLength={200} onChange={(event) => setDescription(event.target.value)} hint="如「等了 40 分钟」「多去了一个地方」" />
      <div className="field">
        <label className="field__label" htmlFor="receipt-input">
          票据照片
        </label>
        <input id="receipt-input" type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple disabled={uploading} onChange={(event) => void upload(event.target.files)} />
        <p className="field__hint">{files.length === 0 ? "高速费、停车费必须附；其他类型没有凭证会转平台审核。" : `已上传：${files.map((file) => file.name).join("、")}`}</p>
      </div>
      {problem !== null && <Alert kind="danger">{problem}</Alert>}
    </Dialog>
  );
}

export function ExtraChargesSection({ order, charges, canSubmit, onChanged }: { order: TenantOrder; charges: readonly ExtraCharge[]; canSubmit: boolean; onChanged(): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const completed = order.status === "completed";
  if (!completed && charges.length === 0) return null;
  const withdraw = async (charge: ExtraCharge): Promise<void> => {
    try {
      await withdrawExtraCharge(token, order.id, charge.id);
      toast("已撤回");
    } catch (err) {
      if (!handleAuthFailure(err)) toast(failureText(err, "撤回"));
    }
    onChanged();
  };
  return (
    <section className="card">
      <div className="card__title-row">
        <h2 className="card__title">事后加收</h2>
        {completed && canSubmit && (
          <Button variant="secondary" onClick={() => setOpen(true)}>
            提交加收
          </Button>
        )}
      </div>
      {charges.length === 0 ? (
        <p className="table__muted">没有加收。服务结束 24 小时内可以提交超时、等待、加停靠点等费用（平台订单不收现金）。</p>
      ) : (
        <ul className="plain-list">
          {charges.map((charge) => (
            <li key={charge.id}>
              <StatusBadge {...EXTRA_STATUS_BADGES[charge.status]} />
              {` ${extraTypeName(charge.type)} ${moneyText(charge.approved_amount ?? charge.amount)}`}
              {charge.approved_amount !== null && charge.approved_amount.amount !== charge.amount.amount && `（你报的 ${moneyText(charge.amount)}，平台通过了这么多）`}
              {charge.description && ` · ${charge.description}`}
              {charge.status === "in_window" && ` · 客人可以在 ${formatInZone(charge.dispute_until, order.timezone)} 之前提异议，之后自动扣款`}
              {charge.review_reasons.length > 0 && charge.status !== "charged" && ` · ${charge.review_reasons.map((reason) => REVIEW_REASON_NAMES[reason] ?? reason).join("、")}`}
              {charge.dispute_reason && ` · 客人的异议：${charge.dispute_reason}`}
              {charge.status === "in_window" && canSubmit && (
                <Button variant="text" size="sm" onClick={() => void withdraw(charge)}>
                  撤回
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {open && (
        <SubmitDialog
          order={order}
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            toast("已提交：客人有 48 小时异议期，之后自动扣款");
            onChanged();
          }}
        />
      )}
    </section>
  );
}
