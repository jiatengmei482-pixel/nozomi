/**
 * 官网订单页的「投诉和反馈」（M4-03，ADR 0034；pages/site-booking.md 5.10）：客人凭订单链接提工单（投诉服务、修改订单、失物招领、其他），
 * 看到这一单已经提过的、处理状态、结论和赔付、平台给客人的回复。令牌和订单页一样只放在 Authorization 头里。
 * 服务结束超过 14 天的投诉，接口返回 `COMPLAINT_WINDOW_CLOSED`，这里写「已超过投诉时限」。
 */
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../../api/client.ts";
import { SITE_TICKET_TYPES, type SiteOrder, type SiteTicket, type SiteTicketType, createSiteTicket, listSiteTickets } from "../../api/site.ts";
import { AlertSlot, type Notice } from "../../components/Alert.tsx";
import { Button } from "../../components/Button.tsx";
import { RadioGroup } from "../../components/FormFields.tsx";
import { Icon } from "../../components/Icon.tsx";
import { Skeleton } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { TextField } from "../../components/TextField.tsx";
import { moneyText } from "../../lib/dispatch-display.ts";
import { GUEST_TICKET_TYPE_HINTS, GUEST_TICKET_TYPE_NAMES, guestInstantText, guestTicketBadge, guestTicketOutcome } from "../../lib/site-display.ts";
import { siteFailureText } from "./SiteLayout.tsx";

const SUBJECT_MAX = 200;
const DESCRIPTION_MAX = 4000;
const isZero = (amount: string): boolean => /^0+(\.0+)?$/.test(amount);

/** 提交后告诉客人多久会有答复（工单的时效：首次响应 2 小时，用车当天 15 分钟；一般 3 个工作日内处理完）。 */
export const FEEDBACK_SUBMITTED_TEXT = "已提交。平台一般 2 小时内答复（用车当天的 15 分钟内），3 个工作日内处理完；答复会显示在这里，请稍后回到这个页面查看。";

function errorText(err: unknown): string {
  if (err instanceof ApiError && err.code === "COMPLAINT_WINDOW_CLOSED") return "已超过投诉时限：服务结束后 14 天内可以投诉。如果还有问题，请联系客服。";
  if (err instanceof ApiError && err.code === "TICKET_LIMIT_REACHED") return "这一单已经提了很多次，请直接联系客服。";
  return siteFailureText(err, "提交");
}

function TicketItem({ ticket, timeZone }: { ticket: SiteTicket; timeZone: string }) {
  const outcome = guestTicketOutcome(ticket.type, ticket.outcome);
  const c = ticket.compensation;
  return (
    <li className="site-charge">
      <div className="site-charge__head">
        <span className="site-charge__name">{`${GUEST_TICKET_TYPE_NAMES[ticket.type] ?? "反馈"}：${ticket.subject}`}</span>
        <StatusBadge {...guestTicketBadge(ticket.status)} />
      </div>
      <p className="site-muted">{`编号 ${ticket.ticket_no} · 提交于 ${guestInstantText(ticket.created_at, timeZone, new Date())}`}</p>
      {outcome !== null && <p>{outcome}</p>}
      {c !== null && (
        <p>
          {`补偿 ${moneyText(c.compensation)}`}
          {!isZero(c.refund.amount) && `，其中 ${moneyText(c.refund)} 原路退回您的银行卡`}
          {!isZero(c.other_payout.amount) && `，${moneyText(c.other_payout)} 由平台另行支付${c.payout_status === "paid" ? "（已支付）" : "（处理中）"}`}
          。
        </p>
      )}
      {ticket.replies.length > 0 && (
        <ol className="site-replies" aria-label={`平台对「${ticket.subject}」的回复`}>
          {ticket.replies.map((reply, index) => (
            <li key={`${reply.created_at}-${index}`} className="site-reply">
              <span className="site-muted">{`平台的回复 · ${guestInstantText(reply.created_at, timeZone, new Date())}`}</span>
              <p className="site-reply__body">{reply.body}</p>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

export function FeedbackSection({ token, order }: { token: string; order: Pick<SiteOrder, "id" | "timezone" | "status" | "confirmed_at"> }) {
  const [tickets, setTickets] = useState<SiteTicket[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<SiteTicketType | null>(null);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<{ type?: string; subject?: string; description?: string }>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);

  const load = useCallback(() => {
    setLoadFailed(false);
    listSiteTickets(token).then(
      (result) => setTickets(result.items),
      () => setLoadFailed(true),
    );
  }, [token]);
  // 没付过款的单（待付款、没付款就取消）不能建工单，也就没有可看的：不去取（M4-10）
  const confirmed = order.confirmed_at !== null;
  useEffect(() => {
    if (confirmed) load();
  }, [confirmed, load]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    const found: typeof errors = {};
    if (type === null) found.type = "请选择是哪类问题";
    if (subject.trim() === "") found.subject = "请用一句话写是什么问题";
    if (description.trim() === "") found.description = "请写清楚经过，方便平台核实";
    setErrors(found);
    if (Object.keys(found).length > 0 || type === null) return;
    setBusy(true);
    setNotice(null);
    try {
      const { ticket } = await createSiteTicket(token, { type, subject: subject.trim(), description: description.trim(), language: "zh" });
      setOpen(false);
      setType(null);
      setSubject("");
      setDescription("");
      setNotice({ kind: "success", text: `${FEEDBACK_SUBMITTED_TEXT}（编号 ${ticket.ticket_no}）` });
      setTickets((current) => [...(current ?? []), ticket]);
      opener.current?.focus();
    } catch (err) {
      setNotice({ kind: "danger", text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  // 和运营后台的「新建工单」一致：订单确认过（付过款）才有投诉和反馈；没付款就取消的单后端也拒绝建（409 NOT_CONFIRMED）
  if (!confirmed) return null;
  return (
    <section className="site-section" aria-labelledby="site-feedback-title">
      <h2 id="site-feedback-title" className="site-section__title">
        投诉和反馈
      </h2>
      <p className="site-muted">对这次用车不满意、东西落在车上，或者有别的问题，可以在这里告诉平台。平台核实后会在这里答复；投诉成立的按统一的赔付标准补偿。</p>
      {tickets === null && !loadFailed && <Skeleton lines={["medium"]} label="正在读取已提交的反馈" />}
      {loadFailed && (
        <p className="site-muted">
          已提交的反馈没有读出来。
          <Button variant="text" onClick={load}>
            重试
          </Button>
        </p>
      )}
      {tickets !== null && tickets.length > 0 && (
        <ul className="site-charges" aria-label="已提交的反馈">
          {tickets.map((ticket) => (
            <TicketItem key={ticket.id} ticket={ticket} timeZone={order.timezone} />
          ))}
        </ul>
      )}
      <AlertSlot notice={notice} />
      {open ? (
        <form className="site-form" noValidate onSubmit={(event) => void submit(event)}>
          <RadioGroup legend="是哪类问题" name="site-feedback-type" required value={type} options={SITE_TICKET_TYPES.map((value) => ({ value, label: GUEST_TICKET_TYPE_NAMES[value] ?? value, hint: GUEST_TICKET_TYPE_HINTS[value] ?? "" }))} errors={errors.type ? [errors.type] : []} onChange={(value) => setType(value)} />
          <TextField label="一句话说明" size="lg" required maxLength={SUBJECT_MAX} value={subject} errors={errors.subject ? [errors.subject] : []} onChange={(event) => setSubject(event.target.value)} hint="如「司机迟到了 30 分钟」" />
          <div className="field">
            <label className="field__label" htmlFor="site-feedback-description">
              经过
            </label>
            <textarea
              id="site-feedback-description"
              className="input textarea"
              rows={4}
              required
              maxLength={DESCRIPTION_MAX}
              aria-invalid={errors.description !== undefined || undefined}
              aria-describedby={errors.description !== undefined ? "site-feedback-description-error site-feedback-description-hint" : "site-feedback-description-hint"}
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                if (errors.description !== undefined && event.target.value.trim() !== "") setErrors(({ description: _cleared, ...rest }) => rest);
              }}
            />
            {errors.description !== undefined && (
              <p className="field__error" id="site-feedback-description-error">
                <Icon name="alert-triangle" className="field__error-icon" />
                <span>{errors.description}</span>
              </p>
            )}
            <p className="field__hint" id="site-feedback-description-hint">
              什么时间、在哪里、发生了什么。平台会联系司机和服务方核实。
            </p>
          </div>
          <div className="site-actions site-actions--inline">
            <Button type="submit" variant="primary" size="lg" loading={busy} loadingText="正在提交">
              提交
            </Button>
            <Button size="lg" disabled={busy} onClick={() => setOpen(false)}>
              取消
            </Button>
          </div>
        </form>
      ) : (
        <div className="site-actions site-actions--inline">
          <Button
            ref={opener}
            size="lg"
            onClick={() => {
              setOpen(true);
              setNotice(null);
            }}
          >
            提交投诉或反馈
          </Button>
        </div>
      )}
    </section>
  );
}
