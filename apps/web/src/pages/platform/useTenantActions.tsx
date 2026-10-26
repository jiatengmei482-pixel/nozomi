/**
 * 供应商的四个操作（docs/design/pages/platform-tenants.md 第 6、7 节）：申请暂停（原因必填，双人复核，ADR 0028）、恢复、邀请管理员、给管理员发密码重置。
 * 列表的「更多」菜单和详情页用的是同一套对话框。邀请和重置成功后，原对话框换成一次性链接的内容。
 * 令牌只放在这个钩子的内存状态里，对话框关闭时清掉；发令牌的请求不自动重试。
 */
import { type FormEvent, type ReactNode, useState } from "react";
import { ApiError } from "../../api/client.ts";
import { inviteTenantAdmin, issueTenantAdminReset, resumeTenant, suspendTenant } from "../../api/platform.ts";
import type { Tenant } from "../../api/types.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { Button } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { FieldErrors } from "../../components/FormFields.tsx";
import { type IssuedLink, OneTimeLinkDialog, UNSURE_TEXT } from "../../components/OneTimeLinkDialog.tsx";
import { useToast } from "../../components/Toast.tsx";
import { failureText } from "../../lib/failure.ts";
import { EMAIL_REFUSED_TEXT, REASON_MAX, emailProblem, emailRefused, isUnsure, nameProblem, reasonProblem } from "../../lib/platform-display.ts";

type Action = "suspend" | "resume" | "invite" | "reset";

export interface TenantActions {
  open(action: Action, tenant: Tenant, extra?: { reason?: string | null }): void;
  dialog: ReactNode;
}

const FORBIDDEN = "你没有权限做这个操作。需要的话，请联系管理员开通。";

export function useTenantActions(onChanged: (tenant: Tenant) => void, onRequested?: () => void): TenantActions {
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const [current, setCurrent] = useState<{ action: Action; tenant: Tenant; reason: string | null } | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [working, setWorking] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ title?: string; text: string } | null>(null);
  const [gone, setGone] = useState(false);
  /** 接口这一次应答里的令牌：只在这里，关闭时清掉 */
  const [issued, setIssued] = useState<IssuedLink | null>(null);

  const close = (): void => {
    setCurrent(null);
    setIssued(null);
  };
  const open = (action: Action, tenant: Tenant, extra: { reason?: string | null } = {}): void => {
    setCurrent({ action, tenant, reason: extra.reason ?? null });
    setEmail("");
    setName("");
    setReason("");
    setAttempted(false);
    setFieldError(null);
    setProblem(null);
    setGone(false);
    setIssued(null);
  };

  const failed = (err: unknown, verb: string): void => {
    if (handleAuthFailure(err)) return;
    if (isUnsure(err)) return setProblem(current?.action === "invite" || current?.action === "reset" ? { title: "不确定有没有成功。", text: UNSURE_TEXT } : { text: failureText(err, verb) });
    if (err instanceof ApiError && err.status === 403) return setProblem({ text: FORBIDDEN });
    setProblem({ text: failureText(err, verb) });
  };

  const submit = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault();
    if (current === null || working || gone) return;
    const { action, tenant } = current;
    setAttempted(true);
    setFieldError(null);
    setProblem(null);
    if (action === "suspend" && reasonProblem(reason) !== null) return document.getElementById("tenant-reason")?.focus();
    if ((action === "invite" || action === "reset") && emailProblem(email) !== null) return document.getElementById("tenant-admin-email")?.focus();
    if (action === "invite" && nameProblem(name, "姓名") !== null) return document.getElementById("tenant-admin-name")?.focus();
    setWorking(true);
    try {
      if (action === "suspend") {
        // 暂停走双人复核：提交以后等另一位同事在「待审核」里批准才生效，供应商现在的状态不变
        await suspendTenant(token, tenant.id, reason.trim());
        toast(`已提交暂停「${tenant.name}」的申请，等另一位同事审核后生效`);
        onRequested?.();
        close();
      } else if (action === "resume") {
        onChanged(await resumeTenant(token, tenant.id));
        toast(`已恢复「${tenant.name}」`);
        close();
      } else if (action === "invite") {
        const result = await inviteTenantAdmin(token, tenant.id, { email: email.trim(), name: name.trim() });
        setIssued({ portal: "tenant", kind: "invite", token: result.invite.token, expiresAt: result.invite.expires_at ?? null, name: result.user.name, email: result.user.email, whom: `${tenant.name} 的管理员` });
      } else {
        const result = await issueTenantAdminReset(token, tenant.id, email.trim());
        setIssued({ portal: "tenant", kind: "reset", token: result.reset.token, expiresAt: result.reset.expires_at ?? null, name: result.user.name, email: result.user.email, whom: `${tenant.name} 的管理员` });
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "EMAIL_TAKEN") {
        setFieldError("这个邮箱已经有账号了（在这家或别的供应商，并且已经设过密码）。如果他是这家供应商的管理员、只是忘了密码，请用「发密码重置链接」。");
        document.getElementById("tenant-admin-email")?.focus();
      } else if (emailRefused(err)) {
        setFieldError(EMAIL_REFUSED_TEXT);
        document.getElementById("tenant-admin-email")?.focus();
      } else if (err instanceof ApiError && err.code === "ACCOUNT_NOT_ACTIVE") {
        setFieldError("这个账号现在不是在用的状态。还没设过密码的，请用「邀请管理员」重新发邀请；已经被停用的，要先由他们的管理员启用。");
        document.getElementById("tenant-admin-email")?.focus();
      } else if (err instanceof ApiError && err.status === 404 && action === "reset") {
        setFieldError("这家供应商没有用这个邮箱的管理员。请核对邮箱；如果他不是管理员，请让他们的管理员处理。");
        document.getElementById("tenant-admin-email")?.focus();
      } else if (err instanceof ApiError && err.code === "DOCUMENTS_INVALID") {
        setProblem({ text: "这家供应商有必交资质已到期，不能人工恢复：请供应商上传新的证件，审核通过后会自动恢复。" });
      } else if (err instanceof ApiError && err.code === "TENANT_STATE_INVALID") {
        setGone(true);
        setProblem({ text: action === "suspend" ? "这家供应商现在的状态不能暂停（可能已经被人工暂停，或还没开始试运营）。请刷新页面看最新的状态。" : "这家供应商现在没有暂停，不用恢复。请刷新页面看最新的状态。" });
      } else if (err instanceof ApiError && err.status === 404) {
        setGone(true);
        setProblem({ text: action === "invite" ? "找不到这家供应商。" : "找不到这家供应商，它可能已被删除。" });
      } else failed(err, action === "suspend" ? "暂停" : action === "resume" ? "恢复" : action === "invite" ? "邀请" : "发出");
    } finally {
      setWorking(false);
    }
  };

  let dialog: ReactNode = null;
  if (current !== null && issued !== null) {
    dialog = (
      <OneTimeLinkDialog
        issued={issued}
        onClose={() => {
          toast(issued.kind === "invite" ? `已邀请「${issued.name}」` : `已给「${issued.name}」发出密码重置链接`);
          close();
        }}
      />
    );
  } else if (current !== null) {
    const { action, tenant } = current;
    const alert = <div role="alert">{problem !== null && <Alert kind="danger">{problem.title ? <><strong className="alert__title">{problem.title}</strong><span>{problem.text}</span></> : problem.text}</Alert>}</div>;
    const cancel = (
      <Button variant={gone ? "primary" : "text"} {...(action === "suspend" || action === "resume" ? { "data-autofocus": true } : {})} disabled={working} onClick={close}>
        {gone ? "知道了" : "取消"}
      </Button>
    );
    const emailErrors = [...(attempted && emailProblem(email) !== null ? [emailProblem(email) as string] : []), ...(fieldError !== null ? [fieldError] : [])];
    const emailField = (label: string, hint: string | null): ReactNode => (
      <div className="field">
        <label className="field__label" htmlFor="tenant-admin-email">
          {label}
          <span className="field__required" aria-hidden="true">
            {" *"}
          </span>
        </label>
        <input className="input" id="tenant-admin-email" type="email" autoComplete="off" data-autofocus aria-invalid={emailErrors.length > 0 || undefined} aria-describedby="tenant-admin-email-error tenant-admin-email-hint" readOnly={working} value={email} onChange={(event) => {
          setEmail(event.target.value);
          setFieldError(null);
        }} />
        <FieldErrors id="tenant-admin-email-error" errors={emailErrors} />
        {hint !== null && (
          <p className="field__hint" id="tenant-admin-email-hint">
            {hint}
          </p>
        )}
      </div>
    );
    if (action === "suspend") {
      const length = reason.trim().length;
      dialog = (
        <Dialog
          open
          size="form"
          title={`申请暂停「${tenant.name}」`}
          busy={working}
          dismissOnBackdrop={false}
          onClose={close}
          footer={
            <>
              {cancel}
              {!gone && (
                <Button variant="danger" loading={working} loadingText="提交中…" onClick={() => void submit()}>
                  提交申请
                </Button>
              )}
            </>
          }
        >
          <form className="form" noValidate onSubmit={(event) => void submit(event)}>
            {alert}
            <Alert kind="info">暂停要另一位同事审核：提交以后在「待审核」里批准了才生效。</Alert>
            <p>暂停以后——</p>
            <ul className="dialog__list">
              <li>
                它的<strong>商品不参与比价，不会再接到新订单</strong>；
              </li>
              <li>
                <strong>已经接下的订单不受影响</strong>，仍然要照常派车、履约；
              </li>
              <li>
                它的账号<strong>仍然可以登录</strong>供应商后台，页面上会看到「已暂停」；
              </li>
              <li>可以随时恢复（恢复不用审核）。</li>
            </ul>
            <div className="field">
              <label className="field__label" htmlFor="tenant-reason">
                暂停原因
                <span className="field__required" aria-hidden="true">
                  {" *"}
                </span>
              </label>
              <textarea className="input textarea" id="tenant-reason" rows={3} aria-invalid={(attempted && reasonProblem(reason) !== null) || undefined} aria-describedby="tenant-reason-error tenant-reason-hint" readOnly={working} value={reason} onChange={(event) => setReason(event.target.value)} />
              <span className={length > REASON_MAX ? "field__counter field__counter--over" : "field__counter"} aria-live={REASON_MAX - length <= 50 ? "polite" : "off"}>{`${length} / ${REASON_MAX}`}</span>
              <FieldErrors id="tenant-reason-error" errors={attempted && reasonProblem(reason) !== null ? [reasonProblem(reason) as string] : []} />
              <p className="field__hint" id="tenant-reason-hint">
                写给审核的同事和以后的自己看的：为什么暂停、谁要求的。会记入状态记录和审计日志，供应商只看到「人工暂停」，看不到这段文字。
              </p>
            </div>
          </form>
        </Dialog>
      );
    } else if (action === "resume") {
      dialog = (
        <Dialog
          open
          title={`恢复「${tenant.name}」？`}
          busy={working}
          onClose={close}
          footer={
            <>
              {cancel}
              {!gone && (
                <Button variant="primary" loading={working} loadingText="恢复中…" onClick={() => void submit()}>
                  恢复
                </Button>
              )}
            </>
          }
        >
          {alert}
          <p>恢复以后，它的商品重新参与比价、可以接新订单。</p>
          {current.reason !== null && current.reason !== "" && <p>{`当初暂停的原因：${current.reason}。请确认问题已经解决。`}</p>}
        </Dialog>
      );
    } else {
      const invite = action === "invite";
      dialog = (
        <Dialog
          open
          size="form"
          title={invite ? "邀请管理员" : "给管理员发密码重置链接"}
          busy={working}
          dismissOnBackdrop={false}
          onClose={close}
          footer={
            <>
              {cancel}
              {!gone && (
                <Button variant="primary" loading={working} loadingText={invite ? "邀请中…" : "发出中…"} onClick={() => void submit()}>
                  {invite ? "邀请" : "发出"}
                </Button>
              )}
            </>
          }
        >
          <form className="form" noValidate onSubmit={(event) => void submit(event)}>
            <input type="submit" hidden tabIndex={-1} />
            {alert}
            {invite ? (
              <p>{`给「${tenant.name}」开一个管理员账号。${tenant.status === "suspended" ? "这家供应商已暂停，仍然可以邀请。" : ""}`}</p>
            ) : (
              <p>
                只能发给「{tenant.name}」里<strong>在用的管理员</strong>。别的角色（调度、财务等）忘了密码，请让他们自己的管理员在供应商后台里处理。
              </p>
            )}
            {!gone && emailField(invite ? "邮箱" : "管理员的邮箱", invite ? "之前邀请过、但对方还没设密码的邮箱也可以填：会发出一条新的链接，旧的作废。" : null)}
            {!gone && invite && (
              <div className="field">
                <label className="field__label" htmlFor="tenant-admin-name">
                  姓名
                  <span className="field__required" aria-hidden="true">
                    {" *"}
                  </span>
                </label>
                <input className="input" id="tenant-admin-name" type="text" autoComplete="off" aria-invalid={(attempted && nameProblem(name, "姓名") !== null) || undefined} aria-describedby="tenant-admin-name-error" readOnly={working} value={name} onChange={(event) => setName(event.target.value)} />
                <FieldErrors id="tenant-admin-name-error" errors={attempted && nameProblem(name, "姓名") !== null ? [nameProblem(name, "姓名") as string] : []} />
              </div>
            )}
            {!invite && <p className="page-intro">发出链接不会改掉他现在的密码。请先确认提出要求的人就是他本人——例如打他留在合同上的电话。</p>}
            {invite && !gone && <Alert kind="info">系统不会发邮件。点「邀请」后会显示一条邀请链接，只显示一次。</Alert>}
          </form>
        </Dialog>
      );
    }
  }
  return { open, dialog };
}
