/**
 * 运营订单详情「官网订单链接」（M4-30，ADR 0061）：客人在官网查订单收不到邮件（只留了手机号、邮箱填错）时，客服核实身份后重发。
 * - 看（`order.read`）：能不能发、下单邮箱（打码）、在等审核的那一条、最近的重发记录；
 * - 重发（`order.view_link_resend`）：发到下单邮箱直接排进通知中心；发到核实后的新邮箱要另一位同事在「待审核」里批准（`order.view_link_review`）。
 *   核实方式和原因必填。页面上只有打码后的地址；新邮箱只在输入框里出现一次。
 */
import { VIEW_LINK_VERIFICATIONS, VIEW_LINK_VERIFICATION_NAMES, type ViewLinkTarget, type ViewLinkVerification, instantToLocal } from "@nozomi/domain";
import { useState } from "react";
import { Link } from "react-router";
import { ApiError } from "../../api/client.ts";
import { type ViewLinkRequest, type ViewLinkStatus, getViewLinkStatus, resendViewLink } from "../../api/view-link.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { Button } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { RadioGroup, SelectField } from "../../components/FormFields.tsx";
import { TextAreaField } from "../../components/TextAreaField.tsx";
import { TextField } from "../../components/TextField.tsx";
import { useToast } from "../../components/Toast.tsx";
import { APPROVALS_PAGE_PATH } from "../../lib/channel-display.ts";
import { failureText } from "../../lib/failure.ts";
import { serverIssues } from "../../lib/product-failure.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan } from "../../lib/use-master-access.ts";

const UNAVAILABLE_TEXT: Readonly<Record<NonNullable<ViewLinkStatus["unavailable_reason"]>, string>> = {
  NOT_SITE_ORDER: "这不是官网的订单：客人的通知由下单的渠道发，平台不发订单链接。",
  PASSENGER_ANONYMIZED: "这张单的乘客信息已按隐私规则清除，链接也已作废，不能再发。",
  NO_EMAIL_ON_FILE: "这张单没有下单邮箱：核实客人身份后，可以发到核实后的新邮箱（要另一位同事审核）。",
};

const STATUS_TEXT: Readonly<Record<ViewLinkRequest["status"], string>> = { queued: "已排进通知中心", pending_review: "等审核", dismissed: "已驳回或撤回" };
const TARGET_TEXT: Readonly<Record<ViewLinkTarget, string>> = { original: "下单邮箱", new_email: "新邮箱" };

const tokyoText = (iso: string): string => `${instantToLocal(new Date(iso), "Asia/Tokyo").dateTime.replace("T", " ")}（东京）`;

const REASON_MAX = 500;

function ResendDialog({ orderId, status, onClose, onDone }: { orderId: string; status: ViewLinkStatus; onClose(): void; onDone(text: string): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const [target, setTarget] = useState<ViewLinkTarget>(status.available ? "original" : "new_email");
  const [email, setEmail] = useState("");
  const [verification, setVerification] = useState<ViewLinkVerification | "">("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<{ email?: string; verification?: string; reason?: string }>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const targets = [
    ...(status.available ? [{ value: "original" as const, label: `发到下单邮箱 ${status.email_masked ?? ""}`, hint: "直接发出，不用审核" }] : []),
    { value: "new_email" as const, label: "发到核实后的新邮箱", hint: "等于把订单交给这个邮箱的主人：要另一位同事在「待审核」里批准才发。订单上的邮箱不改，客人打开链接后可以自己改" },
  ];
  const submit = async (): Promise<void> => {
    const found: typeof errors = {};
    const given = email.trim();
    if (target === "new_email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(given)) found.email = "请填写核实过的新邮箱";
    if (verification === "") found.verification = "请选怎么核实的客人身份";
    if (reason.trim() === "") found.reason = "请写明为什么要重发、核实了什么（会记进审计日志）";
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await resendViewLink(token, orderId, { target, ...(target === "new_email" ? { email: given } : {}), verification: verification as ViewLinkVerification, reason: reason.trim() });
      onDone(result.approval === null ? `已排进通知中心，发到 ${result.request.email_masked}` : `已提交：要另一位同事在「待审核」里批准，才会发到 ${result.request.email_masked}`);
    } catch (err) {
      if (handleAuthFailure(err)) return;
      if (err instanceof ApiError && err.code === "VALIDATION_FAILED") setProblem(serverIssues(err).map((issue) => issue.message).join("；") || failureText(err, "重发订单链接"));
      else if (err instanceof ApiError && err.status === 429) setProblem("这张单这一小时已经重发了 5 次，请稍后再试。");
      else setProblem(err instanceof ApiError && err.status === 409 ? err.message : failureText(err, "重发订单链接"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      title="重发官网订单链接"
      size="form"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="text" onClick={onClose}>
            不发了
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            {target === "new_email" ? "提交审核" : "发送"}
          </Button>
        </>
      }
    >
      <p>先核实是客人本人（回拨下单电话、核对订单细节或付款信息），再发。链接在发信时新签发，客人以前收到的链接继续有效。</p>
      <RadioGroup<ViewLinkTarget> legend="发到哪里" name="view-link-target" options={targets} value={target} onChange={setTarget} />
      {target === "new_email" && (
        <TextField label="核实后的新邮箱" type="email" inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false} required value={email} errors={errors.email ? [errors.email] : []} onChange={(event) => setEmail(event.target.value)} />
      )}
      <SelectField label="怎么核实的" required placeholder="请选择" value={verification} options={VIEW_LINK_VERIFICATIONS.map((value) => ({ value, label: VIEW_LINK_VERIFICATION_NAMES[value] }))} errors={errors.verification ? [errors.verification] : []} onChange={(value) => setVerification(value as ViewLinkVerification)} />
      <TextAreaField label="原因" required maxLength={REASON_MAX} value={reason} errors={errors.reason ? [errors.reason] : []} hint="如「客人来电说邮箱写错一个字母，回拨下单电话确认是本人」。只有平台能看到，记进审计日志。" onChange={(event) => setReason(event.target.value)} />
      {problem !== null && <Alert kind="danger">{problem}</Alert>}
    </Dialog>
  );
}

/** 只有官网的单有意义；看不到订单的人这一块不显示。 */
export function ViewLinkSection({ orderId }: { orderId: string }) {
  const canRead = usePlatformCan("order.read");
  const canResend = usePlatformCan("order.view_link_resend");
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const { state, reload } = useLoad<ViewLinkStatus>(`view-link|${orderId}`, canRead ? (token) => getViewLinkStatus(token, orderId) : null);
  if (!canRead) return null;
  const status = state.data;
  if (status === null || status === undefined) return null;
  // 不是官网的单：不占地方
  if (status.unavailable_reason === "NOT_SITE_ORDER") return null;
  const finish = (text: string): void => {
    setOpen(false);
    toast(text);
    reload();
  };
  const pending = status.pending_review;
  const sendable = status.available || status.unavailable_reason === "NO_EMAIL_ON_FILE";
  return (
    <section className="card" aria-labelledby="order-view-link">
      <h2 className="card__title" id="order-view-link">
        官网订单链接
      </h2>
      <p className="table__muted">客人在官网「查订单」只能把链接发到下单邮箱。只留了手机号、邮箱填错的客人联系客服时，在这里核实后重发。</p>
      {status.unavailable_reason !== null && <Alert kind={status.unavailable_reason === "NO_EMAIL_ON_FILE" ? "info" : "warning"}>{UNAVAILABLE_TEXT[status.unavailable_reason]}</Alert>}
      {status.email_masked !== null && (
        <p>
          下单邮箱：<span className="mono">{status.email_masked}</span>
        </p>
      )}
      {pending !== null && (
        <Alert kind="info">
          {`发到新邮箱 ${pending.email_masked} 在等另一位同事批准，批准后才发。`}
          <Link className="link" to={APPROVALS_PAGE_PATH}>
            去待审核
          </Link>
        </Alert>
      )}
      {canResend && sendable && status.unavailable_reason !== "PASSENGER_ANONYMIZED" && (
        <div className="action-row">
          <Button variant="secondary" onClick={() => setOpen(true)}>
            重发订单链接
          </Button>
        </div>
      )}
      {status.requests.length > 0 && (
        <div className="table-wrap">
          <div className="table-scroll" tabIndex={0} role="region" aria-label="重发记录">
            <table className="table">
              <caption className="visually-hidden">重发记录</caption>
              <thead>
                <tr>
                  <th scope="col">时间</th>
                  <th scope="col">发到</th>
                  <th scope="col">核实方式</th>
                  <th scope="col">发起人</th>
                  <th scope="col">状态</th>
                </tr>
              </thead>
              <tbody>
                {status.requests.map((request) => (
                  <tr key={request.id}>
                    <td>
                      <time dateTime={request.created_at}>{tokyoText(request.created_at)}</time>
                    </td>
                    <td>{`${TARGET_TEXT[request.target]} `}<span className="mono">{request.email_masked}</span></td>
                    <td>{VIEW_LINK_VERIFICATION_NAMES[request.verification]}</td>
                    <td>{request.requested_by.name}</td>
                    <td>{STATUS_TEXT[request.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="field__hint">「已排进通知中心」之后发没发出去，看这张单的通知记录（邮件服务器已接收不代表客人已收到）。</p>
      {open && <ResendDialog orderId={orderId} status={status} onClose={() => setOpen(false)} onDone={finish} />}
    </section>
  );
}
