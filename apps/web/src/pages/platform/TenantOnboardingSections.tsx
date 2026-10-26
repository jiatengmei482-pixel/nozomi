/**
 * 运营后台供应商详情里的入驻部分（M4-01，ADR 0028）：入驻进度和状态动作、资质（逐项审核、下载）、合同版本（发起新版本）、
 * 履约评分（各项和趋势）、状态变更记录。
 * 暂停、清退、合同新版本走双人复核：提交以后在「待审核」里由另一位同事批准才生效。
 */
import { type ReactNode, useState } from "react";
import { CURRENCIES, type CurrencyCode } from "@nozomi/domain";
import { Link } from "react-router";
import { ApiError } from "../../api/client.ts";
import {
  type CompanyOverview,
  type DocumentDecision,
  type DocumentRequirement,
  type TenantDocument,
  type TenantPerformance,
  type TenantStatusEvent,
  downloadTenantFile,
  getTenantCompany,
  getTenantPerformance,
  listTenantStatusEvents,
  requestContract,
  requestTerminateTenant,
  reviewDocument,
  signTenant,
  startTenantTrial,
  uploadContractFile,
} from "../../api/onboarding.ts";
import type { Tenant } from "../../api/types.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { Button } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { FieldErrors, SelectField } from "../../components/FormFields.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { useToast } from "../../components/Toast.tsx";
import { saveFile } from "../../lib/download.ts";
import { failureText } from "../../lib/failure.ts";
import { formatLocalDateTime } from "../../lib/master-display.ts";
import {
  ACCEPTED_FILE_TYPES,
  ACTOR_NAMES,
  DOCUMENT_STATUS_BADGES,
  MAX_FILE_BYTES,
  REQUIREMENT_BADGES,
  TENANT_STATUS_HINTS,
  TRIGGER_NAMES,
  fileSizeText,
  issueText,
  statusEventText,
} from "../../lib/onboarding-display.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan } from "../../lib/use-master-access.ts";
import { APPROVALS_PAGE_PATH } from "../../lib/channel-display.ts";
import { PerformanceView } from "../company/PerformanceView.tsx";

const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

function loading(): ReactNode {
  return <Skeleton lines={["medium", "long", "long"]} />;
}

function failed(reload: () => void): ReactNode {
  return (
    <StateBlock
      title="加载失败"
      description="请检查网络后重试。"
      action={
        <Button variant="secondary" onClick={reload}>
          重试
        </Button>
      }
    />
  );
}

/** 说明文字框（驳回原因、测试单说明、清退原因……）。 */
function ReasonField({ id, label, value, onChange, error, hint, required = true }: { id: string; label: string; value: string; onChange(value: string): void; error: string | null; hint: string; required?: boolean }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
        {required && (
          <span className="field__required" aria-hidden="true">
            {" *"}
          </span>
        )}
      </label>
      <textarea className="input textarea" id={id} rows={3} maxLength={500} aria-invalid={error !== null || undefined} aria-describedby={`${id}-error ${id}-hint`} value={value} onChange={(event) => onChange(event.target.value)} />
      <FieldErrors id={`${id}-error`} errors={error === null ? [] : [error]} />
      <p className="field__hint" id={`${id}-hint`}>
        {hint}
      </p>
    </div>
  );
}

function problemText(err: unknown, verb: string, typeNames: Readonly<Record<string, string>>): string {
  if (err instanceof ApiError) {
    if (err.code === "TENANT_CONDITIONS_UNMET") {
      const issues = Array.isArray(err.details["issues"]) ? (err.details["issues"] as { path: string; reason: string }[]) : [];
      return `条件还不满足：${issues.map((issue) => issueText(issue, typeNames)).join("；")}。`;
    }
    if (err.code === "TENANT_HAS_OPEN_ORDERS") return `还有 ${String(err.details["open_orders"] ?? "")} 张没履约完的订单，全部完成或取消以后才能清退。`;
    if (err.code === "TENANT_STATE_INVALID") return "供应商现在的状态不能做这一步。请刷新页面看最新的状态。";
    if (err.code === "DOCUMENT_SUPERSEDED") return "供应商之后又交了一份同类型的资质，请审核最新的那份。";
    if (err.code === "DOCUMENT_NOT_PENDING") return "这份资质已经审核过了。请刷新页面。";
    if (err.code === "VALIDATION_FAILED") {
      const issues = Array.isArray(err.details["issues"]) ? (err.details["issues"] as { message?: string }[]) : [];
      return issues.map((issue) => issue.message ?? "").filter(Boolean).join("；") || "填写的内容不对。";
    }
    if (err.status === 403) return "你没有权限做这个操作。";
  }
  return failureText(err, verb);
}

// ───────────── 入驻进度 ─────────────

type StatusDialog = "sign" | "trial" | "terminate" | null;

function ProgressCard({ company, onTenantChanged }: { company: CompanyOverview; onTenantChanged(tenant: Tenant): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const canChange = usePlatformCan("tenant.change_status");
  const tenant = company.tenant;
  const typeNames = Object.fromEntries(company.requirements.map((item) => [item.type, item.type_name]));
  const [open, setOpen] = useState<StatusDialog>(null);
  const [note, setNote] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const start = (dialog: StatusDialog): void => {
    setOpen(dialog);
    setNote("");
    setAttempted(false);
    setProblem(null);
  };
  const needsNote = open === "trial" || open === "terminate";
  const submit = async (): Promise<void> => {
    if (working || open === null) return;
    setAttempted(true);
    if (needsNote && note.trim() === "") return document.getElementById("tenant-status-note")?.focus();
    setWorking(true);
    setProblem(null);
    try {
      if (open === "sign") {
        onTenantChanged(await signTenant(token, tenant.id, note.trim() === "" ? null : note.trim()));
        toast(`「${tenant.name}」已签约`);
      } else if (open === "trial") {
        onTenantChanged(await startTenantTrial(token, tenant.id, note.trim()));
        toast(`「${tenant.name}」已开始试运营`);
      } else {
        await requestTerminateTenant(token, tenant.id, note.trim());
        toast(`已提交清退「${tenant.name}」的申请，等另一位同事审核后生效`);
      }
      setOpen(null);
    } catch (err) {
      if (handleAuthFailure(err)) return;
      setProblem(problemText(err, open === "sign" ? "签约" : open === "trial" ? "开始试运营" : "提交", typeNames));
    } finally {
      setWorking(false);
    }
  };
  const issues = company.next_step_issues;
  const titles: Record<Exclude<StatusDialog, null>, string> = { sign: `和「${tenant.name}」签约`, trial: `「${tenant.name}」开始试运营`, terminate: `申请清退「${tenant.name}」` };
  return (
    <section className="card" aria-labelledby="tenant-progress-title">
      <div className="card__title-row">
        <h2 className="card__title" id="tenant-progress-title">
          入驻进度
        </h2>
        {canChange && (
          <span className="tenant-admin-actions">
            {tenant.status === "reviewing" && (
              <Button variant="primary" onClick={() => start("sign")}>
                签约
              </Button>
            )}
            {tenant.status === "signed" && (
              <Button variant="primary" onClick={() => start("trial")}>
                开始试运营
              </Button>
            )}
            {tenant.status !== "terminated" && (
              <Button variant="secondary" className="button--danger-text" onClick={() => start("terminate")}>
                申请清退
              </Button>
            )}
          </span>
        )}
      </div>
      <p>{TENANT_STATUS_HINTS[tenant.status]}</p>
      <dl className="details">
        {(
          [
            ["签约", tenant.signed_at],
            ["开始试运营", tenant.trial_started_at],
            ["转为正式", tenant.activated_at],
            ["暂停", tenant.suspended_at],
            ["清退", tenant.terminated_at],
          ] as const
        )
          .filter(([, at]) => at !== null)
          .map(([label, at]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{formatLocalDateTime(at as string)}</dd>
            </div>
          ))}
      </dl>
      {issues.length > 0 && (
        <div className="tenant-next-step">
          <p>{tenant.status === "applying" ? "供应商提交审核前还缺：" : "签约前还缺："}</p>
          <ul className="dialog__list">
            {issues.map((issue) => (
              <li key={`${issue.path}:${issue.reason}`}>{issueText(issue, typeNames)}</li>
            ))}
          </ul>
        </div>
      )}
      {open !== null && (
        <Dialog
          open
          size="form"
          title={titles[open]}
          busy={working}
          dismissOnBackdrop={false}
          onClose={() => setOpen(null)}
          footer={
            <>
              <Button variant="text" data-autofocus disabled={working} onClick={() => setOpen(null)}>
                取消
              </Button>
              <Button variant={open === "terminate" ? "danger" : "primary"} loading={working} loadingText="提交中…" onClick={() => void submit()}>
                {open === "sign" ? "签约" : open === "trial" ? "开始试运营" : "提交申请"}
              </Button>
            </>
          }
        >
          <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
          {open === "sign" && <p>签约要求必交资质全部审核通过、有一份已生效的合同。签约以后供应商可以建区域和商品，还不能上架。</p>}
          {open === "trial" && <p>开始试运营要求至少 1 个商品通过上架校验，并且已经完成了一次测试单。试运营可以上架、参与比价，每天最多接 10 单。</p>}
          {open === "terminate" && (
            <>
              <Alert kind="info">清退要另一位同事审核：提交以后在「待审核」里批准了才生效。</Alert>
              <p>清退以后供应商只能查看历史，不能再修改任何东西，商品不再参与比价。要求已有订单全部履约完毕。清退不能撤销。</p>
            </>
          )}
          <ReasonField
            id="tenant-status-note"
            label={open === "sign" ? "说明" : open === "trial" ? "测试单的情况" : "清退原因"}
            required={needsNote}
            value={note}
            onChange={setNote}
            error={attempted && needsNote && note.trim() === "" ? "必填" : null}
            hint={open === "trial" ? "写清楚测试单的订单号、是谁跑的、结果怎样。会记入状态记录（供应商看不到这段文字）。" : "会记入状态记录和审计日志，供应商看不到这段文字。"}
          />
        </Dialog>
      )}
    </section>
  );
}

// ───────────── 资质 ─────────────

function DocumentsCard({ company, onReviewed }: { company: CompanyOverview; onReviewed(tenant: Tenant): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const canReview = usePlatformCan("tenant.review");
  const typeNames = Object.fromEntries(company.requirements.map((item) => [item.type, item.type_name]));
  const byId = new Map(company.documents.map((document) => [document.id, document]));
  const [deciding, setDeciding] = useState<{ document: TenantDocument; decision: DocumentDecision; expiry: DocumentRequirement["expiry"] } | null>(null);
  const [reason, setReason] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const download = async (document: TenantDocument): Promise<void> => {
    try {
      saveFile(await downloadTenantFile(token, company.tenant.id, document.file.id), document.file.file_name);
    } catch (err) {
      if (!handleAuthFailure(err)) toast(failureText(err, "下载"));
    }
  };
  const decide = (document: TenantDocument, decision: DocumentDecision, expiry: DocumentRequirement["expiry"]): void => {
    setDeciding({ document, decision, expiry });
    setReason("");
    setExpiresOn(document.expires_on ?? "");
    setAttempted(false);
    setProblem(null);
  };
  const submit = async (): Promise<void> => {
    if (deciding === null || working) return;
    setAttempted(true);
    if (deciding.decision !== "approve" && reason.trim() === "") return document.getElementById("document-reason")?.focus();
    setWorking(true);
    setProblem(null);
    try {
      const body = deciding.decision === "approve" ? (deciding.expiry === "none" ? {} : { expires_on: expiresOn === "" ? null : expiresOn }) : { reason: reason.trim() };
      const result = await reviewDocument(token, company.tenant.id, deciding.document.id, deciding.decision, body);
      toast(`${deciding.document.type_name}：${deciding.decision === "approve" ? "已通过" : deciding.decision === "reject" ? "已驳回" : "已要求补充"}`);
      setDeciding(null);
      onReviewed(result.tenant);
    } catch (err) {
      if (handleAuthFailure(err)) return;
      setProblem(problemText(err, "提交", typeNames));
    } finally {
      setWorking(false);
    }
  };
  const history = [...company.documents].reverse();
  return (
    <section className="card" aria-labelledby="tenant-documents-title">
      <h2 className="card__title" id="tenant-documents-title">
        资质
      </h2>
      <p className="page-intro">{`按${company.profile?.country_code ? `国家（${company.profile.country_code}）` : "通用"}的必交清单。营运许可、保险到期前 30 天、7 天各提醒供应商一次，到期当天自动暂停。`}</p>
      <div className="table-wrap">
        <div className="table-scroll" tabIndex={0} role="region" aria-label="资质清单">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">证件</th>
                <th scope="col">状态</th>
                <th scope="col">到期日</th>
                <th scope="col">最近一次提交</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {company.requirements.map((item) => {
                const latest = item.latest_document_id === null ? undefined : byId.get(item.latest_document_id);
                const reviewable = latest !== undefined && latest.status === "pending";
                return (
                  <tr key={item.type}>
                    <th scope="row">
                      {item.type_name}
                      {!item.required && <span className="table__muted">（补充材料）</span>}
                    </th>
                    <td>
                      <StatusBadge {...REQUIREMENT_BADGES[item.state]} />
                      {latest !== undefined && latest.status === "pending" && item.state !== "pending" && <span className="table__muted">（新的一份审核中）</span>}
                    </td>
                    <td>{item.expires_on === null ? (item.expiry === "none" ? "无到期日" : "—") : `${item.expires_on}${item.days_left !== null && item.days_left > 0 ? `（还有 ${item.days_left} 天）` : ""}`}</td>
                    <td>
                      {latest === undefined ? (
                        "—"
                      ) : (
                        <span className="tenant-document-latest">
                          <span>{`${formatLocalDateTime(latest.submitted_at)} · ${latest.file.file_name}（${fileSizeText(latest.file.byte_size)}）`}</span>
                          {latest.review_reason && <span className="table__muted">{`原因：${latest.review_reason}`}</span>}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="table__actions">
                        {canReview && latest !== undefined && (
                          <Button variant="text" size="sm" aria-label={`下载 ${item.type_name}`} onClick={() => void download(latest)}>
                            下载
                          </Button>
                        )}
                        {canReview && reviewable && latest !== undefined && (
                          <>
                            <Button variant="text" size="sm" aria-label={`通过 ${item.type_name}`} onClick={() => decide(latest, "approve", item.expiry)}>
                              通过
                            </Button>
                            <Button variant="text" size="sm" aria-label={`要求补充 ${item.type_name}`} onClick={() => decide(latest, "request-supplement", item.expiry)}>
                              要求补充
                            </Button>
                            <Button variant="text" size="sm" className="button--danger-text" aria-label={`驳回 ${item.type_name}`} onClick={() => decide(latest, "reject", item.expiry)}>
                              驳回
                            </Button>
                          </>
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
      {history.length > 0 && (
        <details className="tenant-document-history">
          <summary>{`全部提交记录（${history.length} 份）`}</summary>
          <ul className="dialog__list">
            {history.map((document) => (
              <li key={document.id}>
                {`${formatLocalDateTime(document.submitted_at)} · ${document.type_name} · `}
                <StatusBadge {...DOCUMENT_STATUS_BADGES[document.status]} />
                {document.reviewed_by ? ` · 审核：${document.reviewed_by.name}` : ""}
                {document.review_reason ? ` · ${document.review_reason}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
      {deciding !== null && (
        <Dialog
          open
          size="form"
          title={`${deciding.decision === "approve" ? "通过" : deciding.decision === "reject" ? "驳回" : "要求补充"}：${deciding.document.type_name}`}
          busy={working}
          dismissOnBackdrop={false}
          onClose={() => setDeciding(null)}
          footer={
            <>
              <Button variant="text" data-autofocus disabled={working} onClick={() => setDeciding(null)}>
                取消
              </Button>
              <Button variant={deciding.decision === "reject" ? "danger" : "primary"} loading={working} loadingText="提交中…" onClick={() => void submit()}>
                {deciding.decision === "approve" ? "通过" : deciding.decision === "reject" ? "驳回" : "要求补充"}
              </Button>
            </>
          }
        >
          <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
          <p>{`文件：${deciding.document.file.file_name}。请先下载核对证件上的内容。`}</p>
          {deciding.decision === "approve" ? (
            deciding.expiry !== "none" && (
              <div className="field">
                <label className="field__label" htmlFor="document-expires-on">
                  到期日
                </label>
                <input className="input" id="document-expires-on" type="date" value={expiresOn} aria-describedby="document-expires-on-hint" onChange={(event) => setExpiresOn(event.target.value)} />
                <p className="field__hint" id="document-expires-on-hint">
                  供应商填的是 {deciding.document.expires_on ?? "（没填）"}；和证件上的不一样时照证件改正。到期当天起不算有效。
                </p>
              </div>
            )
          ) : (
            <ReasonField
              id="document-reason"
              label={deciding.decision === "reject" ? "驳回原因" : "要补充什么"}
              value={reason}
              onChange={setReason}
              error={attempted && reason.trim() === "" ? "必填：供应商会看到这段文字" : null}
              hint="供应商会在提醒里看到这段文字。审核中被驳回或要求补充一项必交资质，供应商会退回「申请中」，改好再提交。"
            />
          )}
        </Dialog>
      )}
    </section>
  );
}

// ───────────── 合同 ─────────────

function ContractsCard({ company, onChanged }: { company: CompanyOverview; onChanged(): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const canReview = usePlatformCan("tenant.review");
  const [open, setOpen] = useState(false);
  const [validFrom, setValidFrom] = useState(company.today);
  const [currency, setCurrency] = useState<CurrencyCode>("JPY");
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const start = (): void => {
    const latest = company.contracts.at(-1);
    setValidFrom(latest !== undefined && latest.valid_from >= company.today ? "" : company.today);
    setCurrency((CURRENCY_CODES as readonly string[]).includes(latest?.settle_currency ?? "") ? (latest?.settle_currency as CurrencyCode) : "JPY");
    setFile(null);
    setNote("");
    setProblem(null);
    setFileError(null);
    setOpen(true);
  };
  const submit = async (): Promise<void> => {
    if (working) return;
    if (file !== null && file.size > MAX_FILE_BYTES) return setFileError("文件太大了：最大 10 MB");
    setWorking(true);
    setProblem(null);
    try {
      const uploaded = file === null ? null : await uploadContractFile(token, company.tenant.id, file);
      await requestContract(token, company.tenant.id, { valid_from: validFrom, settle_currency: currency, file_id: uploaded?.id ?? null, note: note.trim() === "" ? null : note.trim() });
      toast("已提交合同新版本，等另一位同事审核后写入");
      setOpen(false);
      onChanged();
    } catch (err) {
      if (handleAuthFailure(err)) return;
      if (err instanceof ApiError && (err.code === "UNSUPPORTED_MEDIA_TYPE" || err.code === "PAYLOAD_TOO_LARGE")) setFileError(err.code === "PAYLOAD_TOO_LARGE" ? "文件太大了：最大 10 MB" : "只收 PDF、JPEG、PNG 文件");
      else setProblem(problemText(err, "提交", {}));
    } finally {
      setWorking(false);
    }
  };
  const download = async (fileId: string): Promise<void> => {
    try {
      saveFile(await downloadTenantFile(token, company.tenant.id, fileId), "合同");
    } catch (err) {
      if (!handleAuthFailure(err)) toast(failureText(err, "下载"));
    }
  };
  return (
    <section className="card" aria-labelledby="tenant-contracts-title">
      <div className="card__title-row">
        <h2 className="card__title" id="tenant-contracts-title">
          合同
        </h2>
        {canReview && company.tenant.status !== "terminated" && <Button onClick={start}>发起新版本</Button>}
      </div>
      <p className="page-intro">月结、次月 20 日付款；平台不收服务费和保证金。改结算条款（新版本）要另一位同事审核。</p>
      {company.contracts.length === 0 ? (
        <p>还没有合同。</p>
      ) : (
        <div className="table-wrap">
          <div className="table-scroll" tabIndex={0} role="region" aria-label="合同版本">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">版本</th>
                  <th scope="col">生效日期</th>
                  <th scope="col">结算币种</th>
                  <th scope="col">说明</th>
                  <th scope="col">扫描件</th>
                </tr>
              </thead>
              <tbody>
                {[...company.contracts].reverse().map((contract) => (
                  <tr key={contract.id}>
                    <th scope="row">
                      {`第 ${contract.version} 版`}
                      {company.effective_contract?.id === contract.id && <StatusBadge tone="success" label="现在生效" />}
                    </th>
                    <td>{contract.valid_from}</td>
                    <td>{contract.settle_currency}</td>
                    <td>{contract.note ?? "—"}</td>
                    <td>
                      {contract.file_id === null ? (
                        "—"
                      ) : canReview ? (
                        <Button variant="text" size="sm" aria-label={`下载第 ${contract.version} 版合同`} onClick={() => void download(contract.file_id as string)}>
                          下载
                        </Button>
                      ) : (
                        "有"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {open && (
        <Dialog
          open
          size="form"
          title="发起合同新版本"
          busy={working}
          dismissOnBackdrop={false}
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button variant="text" data-autofocus disabled={working} onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button variant="primary" loading={working} loadingText="提交中…" onClick={() => void submit()}>
                提交审核
              </Button>
            </>
          }
        >
          <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
          <Alert kind="info">修改结算条款要另一位同事审核：提交以后在「待审核」里批准了才写入。</Alert>
          <div className="field">
            <label className="field__label" htmlFor="contract-valid-from">
              生效日期
            </label>
            <input className="input" id="contract-valid-from" type="date" min={company.today} value={validFrom} aria-describedby="contract-valid-from-hint" onChange={(event) => setValidFrom(event.target.value)} />
            <p className="field__hint" id="contract-valid-from-hint">
              不早于今天（{company.today}），并且晚于已有的最后一个版本。
            </p>
          </div>
          <SelectField<CurrencyCode> label="结算币种" value={currency} options={CURRENCY_CODES.map((value) => ({ value, label: value }))} onChange={setCurrency} />
          <div className="field">
            <label className="field__label" htmlFor="contract-file">
              合同扫描件（可选）
            </label>
            <input className="input" id="contract-file" type="file" accept={ACCEPTED_FILE_TYPES} aria-describedby="contract-file-error contract-file-hint" onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setFileError(null);
            }} />
            <FieldErrors id="contract-file-error" errors={fileError === null ? [] : [fileError]} />
            <p className="field__hint" id="contract-file-hint">
              PDF、JPEG、PNG，最大 10 MB。
            </p>
          </div>
          <ReasonField id="contract-note" label="说明" required={false} value={note} onChange={setNote} error={null} hint="例如合同编号、改了什么。" />
        </Dialog>
      )}
    </section>
  );
}

// ───────────── 状态变更记录 ─────────────

export function StatusEventsTable({ events, audience }: { events: TenantStatusEvent[]; audience: "tenant" | "platform" }) {
  if (events.length === 0) return <p>还没有状态变化。</p>;
  return (
    <div className="table-wrap">
      <div className="table-scroll" tabIndex={0} role="region" aria-label="状态变更记录列表">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">时间</th>
              <th scope="col">动作</th>
              <th scope="col">变化</th>
              <th scope="col">操作</th>
              {audience === "platform" && <th scope="col">说明</th>}
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <th scope="row">{formatLocalDateTime(event.occurred_at)}</th>
                <td>{TRIGGER_NAMES[event.trigger]}</td>
                <td>{statusEventText(event)}</td>
                <td>{audience === "platform" && event.actor.email ? `${ACTOR_NAMES[event.actor.type]}（${event.actor.email}）` : ACTOR_NAMES[event.actor.type]}</td>
                {audience === "platform" && (
                  <td>
                    {event.note ?? "—"}
                    {event.approval_id && (
                      <>
                        {" · "}
                        <Link className="link" to={`${APPROVALS_PAGE_PATH}?status=approved`}>
                          复核记录
                        </Link>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ───────────── 合在一起 ─────────────

export function TenantOnboardingSections({ tenant, onTenantChanged }: { tenant: Tenant; onTenantChanged(tenant: Tenant): void }) {
  const key = `${tenant.id}:${tenant.version}`;
  const company = useLoad<CompanyOverview>(`platform-tenant-company:${key}`, (token) => getTenantCompany(token, tenant.id));
  const events = useLoad<{ items: TenantStatusEvent[] }>(`platform-tenant-events:${key}`, (token) => listTenantStatusEvents(token, tenant.id));
  const performance = useLoad<TenantPerformance>(`platform-tenant-performance:${tenant.id}`, (token) => getTenantPerformance(token, tenant.id));
  const changed = (next: Tenant): void => {
    onTenantChanged(next);
    company.reload();
    events.reload();
  };
  const data = company.state.data;
  return (
    <>
      {data === null ? (
        <section className="card" aria-label="入驻资料加载中">
          {company.state.status === "error" ? failed(company.reload) : loading()}
        </section>
      ) : (
        <>
          <ProgressCard company={data} onTenantChanged={changed} />
          <DocumentsCard company={data} onReviewed={changed} />
          <ContractsCard company={data} onChanged={company.reload} />
        </>
      )}
      <section className="card" aria-labelledby="tenant-performance-title">
        <h2 className="card__title" id="tenant-performance-title">
          履约评分
        </h2>
        {performance.state.data === null ? (performance.state.status === "error" ? failed(performance.reload) : loading()) : <PerformanceView performance={performance.state.data} audience="platform" />}
      </section>
      <section className="card" aria-labelledby="tenant-events-title">
        <h2 className="card__title" id="tenant-events-title">
          状态变更记录
        </h2>
        {events.state.data === null ? (events.state.status === "error" ? failed(events.reload) : loading()) : <StatusEventsTable events={events.state.data.items} audience="platform" />}
      </section>
    </>
  );
}
