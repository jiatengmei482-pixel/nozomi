/**
 * 供应商后台「企业资质」（M4-01，ADR 0028）：入驻进度、企业信息、按清单逐项上传和换证、提交审核、合同、状态记录、提醒。
 * 改资料、上传、提交只归管理员（`company.manage`）；财务、只读能看。已清退的只能看。
 * 上传分两步：先把文件传上去（拿到文件编号），再提交资质（类型、到期日）。文件只认 PDF、JPEG、PNG，最大 10 MB；页面先查一遍，服务器按字节再查。
 */
import { type FormEvent, type ReactNode, useState } from "react";
import { ApiError } from "../../api/client.ts";
import {
  type CompanyOverview,
  type DocumentRequirement,
  type DocumentType,
  type ProfileInput,
  type TenantNotice,
  type TenantStatusEvent,
  downloadOwnFile,
  getOwnCompany,
  listOwnNotices,
  listOwnStatusEvents,
  putOwnProfile,
  submitForReview,
  submitOwnDocument,
  uploadOwnFile,
} from "../../api/onboarding.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { FieldErrors } from "../../components/FormFields.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { StatusBadge, TENANT_STATUS_BADGES } from "../../components/StatusBadge.tsx";
import { TextField } from "../../components/TextField.tsx";
import { useToast } from "../../components/Toast.tsx";
import { saveFile } from "../../lib/download.ts";
import { failureText } from "../../lib/failure.ts";
import { formatLocalDateTime } from "../../lib/master-display.ts";
import { ACCEPTED_FILE_TYPES, MAX_FILE_BYTES, REQUIREMENT_BADGES, fileSizeText, issueText, noticeText, progressHint, requirementExpiryText, standingNotice } from "../../lib/onboarding-display.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { useTenantCan } from "../../lib/use-master-access.ts";
import { StatusEventsTable } from "../platform/TenantOnboardingSections.tsx";

export const COMPANY_PATH = "/company";

const EMPTY_PROFILE: ProfileInput = { country_code: null, legal_name: null, registration_no: null, address: null, contact_name: null, contact_phone: null, contact_email: null };
const PROFILE_FIELDS: readonly { key: keyof ProfileInput; label: string; hint?: string; type?: string }[] = [
  { key: "country_code", label: "所在国家（两位代码）", hint: "如 JP、KR。决定要交哪些资质。" },
  { key: "legal_name", label: "法定名称", hint: "和营业执照、登记簿上的一致。" },
  { key: "registration_no", label: "登记号 / 统一社会信用代码" },
  { key: "address", label: "地址" },
  { key: "contact_name", label: "联系人" },
  { key: "contact_phone", label: "联系电话", hint: "带国家码，如 +81 3-1234-5678。", type: "tel" },
  { key: "contact_email", label: "联系邮箱", type: "email" },
];

// ───────────── 企业信息 ─────────────

function ProfileCard({ company, editable, onSaved }: { company: CompanyOverview; editable: boolean; onSaved(): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const [draft, setDraft] = useState<ProfileInput>(() => ({ ...EMPTY_PROFILE, ...(company.profile ?? {}) }));
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (working) return;
    setWorking(true);
    setProblem(null);
    try {
      const clean = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, typeof value === "string" && value.trim() !== "" ? value.trim() : null])) as ProfileInput;
      await putOwnProfile(token, { ...clean, country_code: clean.country_code?.toUpperCase() ?? null }, company.profile?.version ?? null);
      toast("企业信息已保存");
      onSaved();
    } catch (err) {
      if (handleAuthFailure(err)) return;
      if (err instanceof ApiError && err.code === "VERSION_CONFLICT") setProblem("企业信息刚被别人改过。请刷新页面看最新的内容，再改。");
      else if (err instanceof ApiError && err.code === "VALIDATION_FAILED") setProblem("有填写不对的地方：国家要两位字母代码，邮箱要是邮箱的格式。");
      else if (err instanceof ApiError && err.code === "TENANT_STATE_INVALID") setProblem("已经提交审核了，现在不能改企业信息。需要改的话请联系平台退回。");
      else setProblem(failureText(err, "保存"));
    } finally {
      setWorking(false);
    }
  };
  return (
    <section className="card" aria-labelledby="company-profile-title">
      <h2 className="card__title" id="company-profile-title">
        企业信息
      </h2>
      {editable ? (
        <form className="form" noValidate onSubmit={(event) => void save(event)}>
          <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
          {PROFILE_FIELDS.map((field) => (
            <TextField
              key={field.key}
              label={field.label}
              type={field.type ?? "text"}
              autoComplete="off"
              {...(field.hint ? { hint: field.hint } : {})}
              readOnly={working}
              value={draft[field.key] ?? ""}
              onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
            />
          ))}
          <div className="form-bar">
            <Button variant="primary" type="submit" loading={working} loadingText="保存中…">
              保存
            </Button>
          </div>
        </form>
      ) : (
        <>
          {company.tenant.status === "applying" ? null : <p className="page-intro">提交审核以后企业信息不能再改；需要改的话请联系平台。</p>}
          <dl className="details">
            {PROFILE_FIELDS.map((field) => (
              <div key={field.key}>
                <dt>{field.label}</dt>
                <dd>{company.profile?.[field.key] ?? "—"}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  );
}

// ───────────── 上传一份资质 ─────────────

function UploadDialog({ requirement, today, onClose, onDone }: { requirement: DocumentRequirement; today: string; onClose(): void; onDone(): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [expiresOn, setExpiresOn] = useState("");
  const [note, setNote] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const fileError = !attempted ? null : file === null ? "请选择文件" : file.size > MAX_FILE_BYTES ? "文件太大了：最大 10 MB" : file.size === 0 ? "文件是空的" : null;
  const expiryError = !attempted || requirement.expiry === "none" ? null : expiresOn === "" ? (requirement.expiry === "required" ? "请填证件上的到期日" : null) : expiresOn <= today ? "到期日已经到了或过了：请上传还在有效期内的证件" : null;
  const submit = async (): Promise<void> => {
    if (working) return;
    setAttempted(true);
    const invalidFile = file === null || file.size === 0 || file.size > MAX_FILE_BYTES;
    const invalidExpiry = requirement.expiry !== "none" && ((requirement.expiry === "required" && expiresOn === "") || (expiresOn !== "" && expiresOn <= today));
    if (invalidFile) return document.getElementById("document-file")?.focus();
    if (invalidExpiry) return document.getElementById("document-expires-on")?.focus();
    setWorking(true);
    setProblem(null);
    try {
      const uploaded = await uploadOwnFile(token, file as File);
      await submitOwnDocument(token, { type: requirement.type as DocumentType, file_id: uploaded.id, expires_on: requirement.expiry === "none" || expiresOn === "" ? null : expiresOn, note: note.trim() === "" ? null : note.trim() });
      toast(`已提交「${requirement.type_name}」，等平台审核`);
      onDone();
    } catch (err) {
      if (handleAuthFailure(err)) return;
      if (err instanceof ApiError && err.code === "UNSUPPORTED_MEDIA_TYPE") setProblem("只收 PDF、JPEG、PNG 文件。请换一个文件（照片请存成 JPEG 或 PNG）。");
      else if (err instanceof ApiError && err.code === "PAYLOAD_TOO_LARGE") setProblem("文件太大了：最大 10 MB。");
      else if (err instanceof ApiError && err.code === "TENANT_TERMINATED") setProblem("已清退，不能再提交。");
      else setProblem(failureText(err, "提交"));
    } finally {
      setWorking(false);
    }
  };
  return (
    <Dialog
      open
      size="form"
      title={`${requirement.approved_document_id === null ? "上传" : "换证"}：${requirement.type_name}`}
      busy={working}
      dismissOnBackdrop={false}
      onClose={onClose}
      footer={
        <>
          <Button variant="text" data-autofocus disabled={working} onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" loading={working} loadingText="上传中…" onClick={() => void submit()}>
            提交
          </Button>
        </>
      }
    >
      <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
      {requirement.approved_document_id !== null && <p>新的一份审核通过之前，原来的照常有效。</p>}
      <div className="field">
        <label className="field__label" htmlFor="document-file">
          文件
          <span className="field__required" aria-hidden="true">
            {" *"}
          </span>
        </label>
        <input className="input" id="document-file" type="file" accept={ACCEPTED_FILE_TYPES} aria-invalid={fileError !== null || undefined} aria-describedby="document-file-error document-file-hint" disabled={working} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        <FieldErrors id="document-file-error" errors={fileError === null ? [] : [fileError]} />
        <p className="field__hint" id="document-file-hint">
          {`PDF、JPEG、PNG，最大 10 MB。${file !== null ? `已选：${file.name}（${fileSizeText(file.size)}）` : ""}`}
        </p>
      </div>
      {requirement.expiry !== "none" && (
        <div className="field">
          <label className="field__label" htmlFor="document-expires-on">
            到期日
            {requirement.expiry === "required" && (
              <span className="field__required" aria-hidden="true">
                {" *"}
              </span>
            )}
          </label>
          <input className="input" id="document-expires-on" type="date" min={today} aria-invalid={expiryError !== null || undefined} aria-describedby="document-expires-on-error document-expires-on-hint" readOnly={working} value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} />
          <FieldErrors id="document-expires-on-error" errors={expiryError === null ? [] : [expiryError]} />
          <p className="field__hint" id="document-expires-on-hint">
            照证件上写。到期前 30 天、7 天会提醒你换证；到期当天起不算有效，必交资质到期会被暂停。
          </p>
        </div>
      )}
      <div className="field">
        <label className="field__label" htmlFor="document-note">
          说明（可选）
        </label>
        <textarea className="input textarea" id="document-note" rows={2} maxLength={500} readOnly={working} value={note} onChange={(event) => setNote(event.target.value)} />
      </div>
    </Dialog>
  );
}

// ───────────── 资质 ─────────────

function DocumentsCard({ company, canManage, onChanged }: { company: CompanyOverview; canManage: boolean; onChanged(): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const [uploading, setUploading] = useState<DocumentRequirement | null>(null);
  const byId = new Map(company.documents.map((document) => [document.id, document]));
  const download = async (fileId: string, name: string): Promise<void> => {
    try {
      saveFile(await downloadOwnFile(token, fileId), name);
    } catch (err) {
      if (!handleAuthFailure(err)) toast(failureText(err, "下载"));
    }
  };
  const other: DocumentRequirement = { type: "other", type_name: "其他补充材料", required: false, expiry: "optional", state: "missing", approved_document_id: null, latest_document_id: null, expires_on: null, days_left: null };
  return (
    <section className="card" aria-labelledby="company-documents-title">
      <div className="card__title-row">
        <h2 className="card__title" id="company-documents-title">
          资质
        </h2>
        {canManage && (
          <Button variant="secondary" onClick={() => setUploading(other)}>
            上传补充材料
          </Button>
        )}
      </div>
      <p className="page-intro">{company.profile?.country_code ? `按 ${company.profile.country_code} 的必交清单。` : "先在上面填所在国家，清单会按国家调整。"}营运许可和保险要填到期日；到期前 30 天、7 天各提醒一次。</p>
      <div className="table-wrap">
        <div className="table-scroll" tabIndex={0} role="region" aria-label="资质清单">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">证件</th>
                <th scope="col">状态</th>
                <th scope="col">到期日</th>
                <th scope="col">平台的意见</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {company.requirements.map((item) => {
                const latest = item.latest_document_id === null ? undefined : byId.get(item.latest_document_id);
                const current = item.approved_document_id === null ? undefined : byId.get(item.approved_document_id);
                const renewing = latest !== undefined && latest.status === "pending" && current !== undefined && current.id !== latest.id;
                return (
                  <tr key={item.type}>
                    <th scope="row">
                      {item.type_name}
                      {item.required ? <span className="field__required">{" *"}</span> : <span className="table__muted">（补充）</span>}
                    </th>
                    <td>
                      <StatusBadge {...REQUIREMENT_BADGES[item.state]} />
                      {renewing && <span className="table__muted">（新的一份审核中）</span>}
                    </td>
                    <td>{requirementExpiryText(item, latest)}</td>
                    <td>{latest?.review_reason ?? "—"}</td>
                    <td>
                      <span className="table__actions">
                        {latest !== undefined && (
                          <Button variant="text" size="sm" aria-label={`下载 ${item.type_name}`} onClick={() => void download(latest.file.id, latest.file.file_name)}>
                            下载
                          </Button>
                        )}
                        {canManage && (
                          <Button variant="text" size="sm" aria-label={`${item.state === "missing" ? "上传" : "重新上传"} ${item.type_name}`} onClick={() => setUploading(item)}>
                            {item.state === "missing" ? "上传" : item.state === "approved" || item.state === "expiring" || item.state === "expired" ? "换证" : "重新上传"}
                          </Button>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {uploading !== null && (
        <UploadDialog
          requirement={uploading}
          today={company.today}
          onClose={() => setUploading(null)}
          onDone={() => {
            setUploading(null);
            onChanged();
          }}
        />
      )}
    </section>
  );
}

// ───────────── 整页 ─────────────

export function CompanyPage() {
  const { portal, account, token, handleAuthFailure } = usePortalSession();
  useDocumentTitle(`企业资质 · NOZOMI ${portal.name}`);
  const toast = useToast();
  const canRead = useTenantCan("company.read");
  const canManage = useTenantCan("company.manage");
  const company = useLoad<CompanyOverview>("tenant-company", canRead ? getOwnCompany : null);
  const events = useLoad<{ items: TenantStatusEvent[] }>(`tenant-company-events:${company.state.data?.tenant.version ?? ""}`, canRead ? listOwnStatusEvents : null);
  const notices = useLoad<{ items: TenantNotice[] }>(`tenant-company-notices:${company.state.data?.tenant.version ?? ""}:${company.state.data?.documents.length ?? ""}`, canRead ? listOwnNotices : null);
  const [submitting, setSubmitting] = useState(false);
  const [submitProblem, setSubmitProblem] = useState<string | null>(null);

  const shell = (content: ReactNode, meta?: ReactNode): ReactNode => (
    <AppShell pageName="企业资质">
      <Page title="企业资质" width="form" {...(meta ? { meta } : {})}>
        {content}
      </Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(<StateBlock tone="neutral" title="你没有权限查看这里" description="企业资质由管理员维护。需要的话，请联系你们的管理员。" />);
  const data = company.state.data;
  if (data === null) {
    return shell(
      <section className="card">
        {company.state.status === "error" ? (
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
        )}
      </section>,
    );
  }
  const tenant = data.tenant;
  const typeNames = Object.fromEntries(data.requirements.map((item) => [item.type, item.type_name]));
  const standing = standingNotice(tenant);
  const writable = canManage && tenant.status !== "terminated";
  const submit = async (): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitProblem(null);
    try {
      await submitForReview(token);
      toast("已提交审核");
      company.reload();
    } catch (err) {
      if (handleAuthFailure(err)) return;
      if (err instanceof ApiError && err.code === "TENANT_CONDITIONS_UNMET") {
        const issues = Array.isArray(err.details["issues"]) ? (err.details["issues"] as { path: string; reason: string }[]) : [];
        setSubmitProblem(`还不能提交：${issues.map((issue) => issueText(issue, typeNames)).join("；")}。`);
      } else setSubmitProblem(failureText(err, "提交"));
    } finally {
      setSubmitting(false);
    }
  };
  return shell(
    <>
      {standing !== null && (
        <Alert kind={standing.kind}>
          <strong className="alert__title">{standing.title}</strong>
          <span>{standing.text}</span>
        </Alert>
      )}
      {!canManage && <Alert kind="info">企业信息和资质由管理员维护，你可以查看。</Alert>}
      <section className="card" aria-labelledby="company-progress-title">
        <h2 className="card__title" id="company-progress-title">
          入驻进度
        </h2>
        <p>{progressHint(data, "tenant")}</p>
        {data.next_step_issues.length > 0 && tenant.status === "applying" && (
          <>
            <p>提交审核前还缺：</p>
            <ul className="dialog__list">
              {data.next_step_issues.map((issue) => (
                <li key={`${issue.path}:${issue.reason}`}>{issueText(issue, typeNames)}</li>
              ))}
            </ul>
          </>
        )}
        {tenant.status === "reviewing" && <p className="page-intro">平台审核通过、合同生效后会和你们签约。签约以后可以建商品，开始试运营以后才能上架。</p>}
        <div role="alert">{submitProblem !== null && <Alert kind="danger">{submitProblem}</Alert>}</div>
        {writable && tenant.status === "applying" && (
          <div className="form-bar">
            <Button variant="primary" loading={submitting} loadingText="提交中…" onClick={() => void submit()}>
              提交审核
            </Button>
          </div>
        )}
      </section>
      {(notices.state.data?.items.length ?? 0) > 0 && (
        <section className="card" aria-labelledby="company-notices-title">
          <h2 className="card__title" id="company-notices-title">
            最近的提醒
          </h2>
          <ul className="notice-list">
            {notices.state.data?.items.slice(0, 5).map((notice) => (
              <li key={notice.id}>
                <span className="table__muted">{formatLocalDateTime(notice.created_at)}</span>
                <span>{noticeText(notice, typeNames)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <ProfileCard key={data.profile?.version ?? 0} company={data} editable={writable && tenant.status === "applying"} onSaved={company.reload} />
      <DocumentsCard company={data} canManage={writable} onChanged={company.reload} />
      <section className="card" aria-labelledby="company-contracts-title">
        <h2 className="card__title" id="company-contracts-title">
          合同
        </h2>
        {data.contracts.length === 0 ? (
          <p>还没有合同。资质审核通过后，平台会和你们签合同。</p>
        ) : (
          <dl className="details">
            {[...data.contracts].reverse().map((contract) => (
              <div key={contract.id}>
                <dt>{`第 ${contract.version} 版${data.effective_contract?.id === contract.id ? "（现在生效）" : ""}`}</dt>
                <dd>{`${contract.valid_from} 起；结算币种 ${contract.settle_currency}；月结，次月 ${contract.payment_day} 日付款；平台不收服务费和保证金`}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
      <section className="card" aria-labelledby="company-events-title">
        <h2 className="card__title" id="company-events-title">
          状态变更记录
        </h2>
        {events.state.data === null ? <Skeleton lines={["long", "long"]} /> : <StatusEventsTable events={events.state.data.items} audience="tenant" />}
      </section>
    </>,
    <StatusBadge {...TENANT_STATUS_BADGES[tenant.status]} />,
  );
}
