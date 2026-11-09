/**
 * 运营后台供应商详情的「企业信息」（M4-34，ADR 0071）：对外显示名称和企业信息、「编辑企业信息」（`tenant.edit`），
 * 以及供应商提交的资料修改申请（改名称、法定名称、登记号）：发起复核、驳回（`tenant.review`），批准在「待审核」里由另一位同事做。
 * 银行信息不在这里（收款账户）。
 */
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { PROFILE_FIELD_NAMES, PROFILE_LIMITS } from "@nozomi/domain";
import { ApiError } from "../../api/client.ts";
import { type CompanyOverview, type PlatformTenantProfileChange, type ProfileInput, getTenantCompany, listTenantProfileChanges, putTenantProfile, rejectProfileChange, renameTenant, requestProfileChangeReview } from "../../api/onboarding.ts";
import type { Tenant } from "../../api/types.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { Button } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { FieldErrors } from "../../components/FormFields.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { TextField } from "../../components/TextField.tsx";
import { useToast } from "../../components/Toast.tsx";
import { APPROVALS_PAGE_PATH } from "../../lib/channel-display.ts";
import { failureText } from "../../lib/failure.ts";
import { formatLocalDateTime } from "../../lib/master-display.ts";
import { PROFILE_CHANGE_BADGES, PROFILE_DISPLAY_FIELDS, cleanProfile, emptyProfile, profileProblem } from "../../lib/profile-display.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan } from "../../lib/use-master-access.ts";

// ───────────── 编辑对话框 ─────────────

function EditDialog({ tenant, company, onClose, onSaved }: { tenant: Tenant; company: CompanyOverview; onClose(): void; onSaved(tenant: Tenant | null): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const [name, setName] = useState(tenant.name);
  const [draft, setDraft] = useState<ProfileInput>(() => ({ ...emptyProfile(), ...(company.profile ?? {}) }));
  const [attempted, setAttempted] = useState(false);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const nameError = attempted && name.trim() === "" ? "请填对外显示名称" : attempted && [...name.trim()].length > PROFILE_LIMITS.name ? `最多 ${PROFILE_LIMITS.name} 个字` : null;
  const countryError = attempted && (draft.country_code ?? "").trim() !== "" && !/^[A-Za-z]{2}$/.test((draft.country_code ?? "").trim()) ? "两位字母的国家代码，如 JP" : null;
  const save = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault();
    if (working) return;
    setAttempted(true);
    if (name.trim() === "" || [...name.trim()].length > PROFILE_LIMITS.name) return document.querySelector<HTMLInputElement>("[name=tenant-edit-name]")?.focus();
    if ((draft.country_code ?? "").trim() !== "" && !/^[A-Za-z]{2}$/.test((draft.country_code ?? "").trim())) return document.querySelector<HTMLInputElement>("[name=tenant-edit-country_code]")?.focus();
    setWorking(true);
    setProblem(null);
    let renamed: Tenant | null = null;
    try {
      if (name.trim() !== tenant.name) renamed = await renameTenant(token, tenant.id, name.trim(), tenant.version);
      const clean = cleanProfile(draft);
      const before = company.profile === null ? null : cleanProfile(company.profile);
      if (before === null || JSON.stringify(clean) !== JSON.stringify(before)) await putTenantProfile(token, tenant.id, clean, company.profile?.version ?? null);
      toast("企业信息已保存");
      onSaved(renamed);
    } catch (err) {
      if (handleAuthFailure(err)) return;
      const prefix = renamed !== null ? "名称已经改好了，但企业信息没有保存：" : "";
      if (err instanceof ApiError && err.code === "VERSION_CONFLICT") setProblem(`${prefix}刚被别人改过。请关闭对话框，刷新页面看最新的内容，再改。`);
      else setProblem(`${prefix}${profileProblem(err) ?? failureText(err, "保存")}`);
      if (renamed !== null) onSaved(renamed);
    } finally {
      setWorking(false);
    }
  };
  return (
    <Dialog
      open
      size="form"
      title="编辑企业信息"
      busy={working}
      dismissOnBackdrop={false}
      onClose={onClose}
      footer={
        <>
          <Button variant="text" data-autofocus disabled={working} onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" loading={working} loadingText="保存中…" onClick={() => void save()}>
            保存
          </Button>
        </>
      }
    >
      <form className="form" noValidate onSubmit={(event) => void save(event)}>
        <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
        <p>保存后直接生效，记进审计日志。对外显示名称是客人和渠道看到的名字；银行信息在「收款账户」里改。</p>
        <TextField name="tenant-edit-name" label={PROFILE_FIELD_NAMES.name} autoComplete="off" required maxLength={PROFILE_LIMITS.name * 2} readOnly={working} value={name} errors={nameError === null ? [] : [nameError]} onChange={(event) => setName(event.target.value)} />
        {PROFILE_DISPLAY_FIELDS.map((field) => (
          <TextField
            key={field.key}
            name={`tenant-edit-${field.key}`}
            label={field.label}
            type={field.type ?? "text"}
            autoComplete="off"
            maxLength={PROFILE_LIMITS[field.key]}
            {...(field.hint ? { hint: field.hint } : {})}
            readOnly={working}
            value={draft[field.key] ?? ""}
            errors={field.key === "country_code" && countryError !== null ? [countryError] : []}
            onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
          />
        ))}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

// ───────────── 驳回申请 ─────────────

function RejectDialog({ tenantId, change, onClose, onDone }: { tenantId: string; change: PlatformTenantProfileChange; onClose(): void; onDone(): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const error = attempted && reason.trim() === "" ? "请写驳回的原因（供应商看得到）" : null;
  const submit = async (): Promise<void> => {
    if (working) return;
    setAttempted(true);
    if (reason.trim() === "") return document.getElementById("profile-change-reason")?.focus();
    setWorking(true);
    setProblem(null);
    try {
      await rejectProfileChange(token, tenantId, change.id, reason.trim());
      toast("已驳回修改申请");
      onDone();
    } catch (err) {
      if (!handleAuthFailure(err)) setProblem(profileProblem(err) ?? failureText(err, "驳回"));
    } finally {
      setWorking(false);
    }
  };
  return (
    <Dialog
      open
      size="form"
      title="驳回修改申请"
      busy={working}
      dismissOnBackdrop={false}
      onClose={onClose}
      footer={
        <>
          <Button variant="text" data-autofocus disabled={working} onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" className="button--danger" loading={working} loadingText="驳回中…" onClick={() => void submit()}>
            驳回
          </Button>
        </>
      }
    >
      <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
      <p>驳回后原来的内容不变，供应商会收到邮件，可以改好后重新提交。</p>
      <div className="field">
        <label className="field__label" htmlFor="profile-change-reason">
          原因
          <span className="field__required" aria-hidden="true">
            {" *"}
          </span>
        </label>
        <textarea className="input textarea" id="profile-change-reason" rows={3} maxLength={500} aria-invalid={error !== null || undefined} aria-describedby="profile-change-reason-error" readOnly={working} value={reason} onChange={(event) => setReason(event.target.value)} />
        <FieldErrors id="profile-change-reason-error" errors={error === null ? [] : [error]} />
      </div>
    </Dialog>
  );
}

// ───────────── 修改申请 ─────────────

export function ChangeTable({ change }: { change: { fields: readonly string[]; previous: Record<string, string | null | undefined>; proposed: Record<string, string | null | undefined> } }) {
  return (
    <div className="table-wrap">
      <div className="table-scroll" tabIndex={0} role="region" aria-label="申请修改的内容">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">项目</th>
              <th scope="col">现在</th>
              <th scope="col">改成</th>
            </tr>
          </thead>
          <tbody>
            {change.fields.map((field) => (
              <tr key={field}>
                <th scope="row">{PROFILE_FIELD_NAMES[field as keyof typeof PROFILE_FIELD_NAMES] ?? field}</th>
                <td>{change.previous[field] ?? "—"}</td>
                <td>{change.proposed[field] ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ChangesCard({ tenantId, changes, onChanged }: { tenantId: string; changes: PlatformTenantProfileChange[]; onChanged(): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const canReview = usePlatformCan("tenant.review");
  const [rejecting, setRejecting] = useState<PlatformTenantProfileChange | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const pending = changes.filter((change) => change.status === "pending");
  const recent = changes.filter((change) => change.status !== "pending").slice(0, 5);
  if (changes.length === 0) return null;
  const request = async (change: PlatformTenantProfileChange): Promise<void> => {
    if (working !== null) return;
    setWorking(change.id);
    setProblem(null);
    try {
      await requestProfileChangeReview(token, tenantId, change.id, null);
      toast("已发起复核，等另一位同事审核后生效");
      onChanged();
    } catch (err) {
      if (!handleAuthFailure(err)) setProblem(profileProblem(err) ?? failureText(err, "发起复核"));
    } finally {
      setWorking(null);
    }
  };
  return (
    <section className="card" aria-labelledby="tenant-profile-changes-title">
      <h2 className="card__title" id="tenant-profile-changes-title">
        资料修改申请
      </h2>
      <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
      {pending.length === 0 && <p>现在没有等处理的申请。</p>}
      {pending.map((change) => (
        <div key={change.id} className="profile-change">
          <p>
            <StatusBadge {...PROFILE_CHANGE_BADGES[change.status]} />{" "}
            {`${change.submitted_by.name ?? "供应商"}（${change.submitted_by.email ?? "—"}）在 ${formatLocalDateTime(change.submitted_at)} 提交。审核期间客人仍看到原来的内容。`}
          </p>
          {change.note !== null && <p>{`说明：${change.note}`}</p>}
          <ChangeTable change={change} />
          {change.pending_approval_id !== null ? (
            <p>
              已发起复核，等另一位同事在
              <Link className="link" to={APPROVALS_PAGE_PATH}>
                「待审核」
              </Link>
              里批准后生效。
            </p>
          ) : (
            canReview && (
              <div className="form-bar">
                <Button variant="primary" loading={working === change.id} loadingText="发起中…" onClick={() => void request(change)}>
                  核对无误，发起复核
                </Button>
                <Button variant="secondary" className="button--danger-text" disabled={working !== null} onClick={() => setRejecting(change)}>
                  驳回
                </Button>
              </div>
            )
          )}
        </div>
      ))}
      {recent.length > 0 && (
        <>
          <h3 className="card__subtitle">最近处理过的</h3>
          <ul className="plain-list">
            {recent.map((change) => (
              <li key={change.id}>
                <StatusBadge {...PROFILE_CHANGE_BADGES[change.status]} />{" "}
                {`${change.fields.map((field) => PROFILE_FIELD_NAMES[field]).join("、")}：${change.fields.map((field) => change.proposed[field] ?? "—").join("、")}（${formatLocalDateTime(change.submitted_at)} 提交${change.reject_reason === null ? "" : `；驳回原因：${change.reject_reason}`}）`}
              </li>
            ))}
          </ul>
        </>
      )}
      {rejecting !== null && (
        <RejectDialog
          tenantId={tenantId}
          change={rejecting}
          onClose={() => setRejecting(null)}
          onDone={() => {
            setRejecting(null);
            onChanged();
          }}
        />
      )}
    </section>
  );
}

// ───────────── 整块 ─────────────

export function TenantProfileSection({ tenant, onTenantChanged }: { tenant: Tenant; onTenantChanged(tenant: Tenant): void }) {
  const canEdit = usePlatformCan("tenant.edit");
  const key = `${tenant.id}:${tenant.version}`;
  const company = useLoad<CompanyOverview>(`platform-tenant-profile:${key}`, (token) => getTenantCompany(token, tenant.id));
  const changes = useLoad<{ items: PlatformTenantProfileChange[] }>(`platform-tenant-profile-changes:${key}`, (token) => listTenantProfileChanges(token, tenant.id));
  const [editing, setEditing] = useState(false);
  const data = company.state.data;
  return (
    <>
      <section className="card" aria-labelledby="tenant-profile-title">
        <div className="card__title-row">
          <h2 className="card__title" id="tenant-profile-title">
            企业信息
          </h2>
          {canEdit && data !== null && <Button onClick={() => setEditing(true)}>编辑企业信息</Button>}
        </div>
        {data === null ? (
          company.state.status === "error" ? (
            <StateBlock
              title="加载失败"
              description="请检查网络后重试。"
              action={
                <Button variant="secondary" onClick={company.reload}>
                  重试
                </Button>
              }
            />
          ) : (
            <Skeleton lines={["medium", "long", "long"]} />
          )
        ) : (
          <dl className="details">
            <div>
              <dt>{PROFILE_FIELD_NAMES.name}</dt>
              <dd>{tenant.name}</dd>
            </div>
            {PROFILE_DISPLAY_FIELDS.map((field) => (
              <div key={field.key}>
                <dt>{field.label}</dt>
                <dd>{data.profile?.[field.key] ?? "—"}</dd>
              </div>
            ))}
          </dl>
        )}
        {data !== null && data.profile === null && <p className="page-intro">供应商还没有填企业信息。</p>}
      </section>
      {changes.state.data !== null && <ChangesCard tenantId={tenant.id} changes={changes.state.data.items} onChanged={changes.reload} />}
      {editing && data !== null && (
        <EditDialog
          tenant={tenant}
          company={data}
          onClose={() => setEditing(false)}
          onSaved={(renamed) => {
            setEditing(false);
            if (renamed !== null) onTenantChanged(renamed);
            else company.reload();
          }}
        />
      )}
    </>
  );
}
