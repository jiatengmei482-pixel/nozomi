/**
 * 运营后台「财务结算」的银行转账文件和收款账户（M5-02，ADR 0051；页面说明 docs/design/pages/finance.md 第 6 节）：
 * - 付款批次详情里的「银行转账文件」区：按币种列出能进文件的、有问题的（明确列出，不静默跳过）、已在文件里的；发起生成走双人复核；
 * - 转账文件详情：每一笔（账号只有末 4 位）、下载（CSV / Excel）、回填银行流水号、作废；
 * - 收款账户队列：供应商提交的账户，核对后发起复核或驳回（批准在「待审核」，另一位同事）。
 * 页面上永远没有完整账号。限定了数据范围的员工和账单页一样，不发请求，写「没有权限」。
 */
import { BANK_TRANSFER_RULES, type BankFileFormat, CHARGE_BEARERS, type ChargeBearer, PAYOUT_ACCOUNT_STATUSES, type PayoutAccountStatus, isBankReference } from "@nozomi/domain";
import { type ReactNode, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import {
  type BankFile,
  type BankFileDetail,
  type BankFileItem,
  type BankFilePreview,
  type BankFilePreviewGroup,
  type PlatformPayoutAccount,
  type PreviewEligible,
  type PreviewExcluded,
  downloadBankFile,
  getBankFile,
  getBankFilePreview,
  listBankFiles,
  listPlatformPayoutAccounts,
  recordBankFilePayments,
  rejectPayoutAccount,
  requestBankFile,
  requestPayoutAccountReview,
  voidBankFile,
} from "../../api/bank-files.ts";
import { ApiError } from "../../api/client.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button } from "../../components/Button.tsx";
import { type Column, DataTable } from "../../components/DataTable.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { CheckboxGroup, SelectField } from "../../components/FormFields.tsx";
import { NoteDialog } from "../../components/NoteDialog.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { TextAreaField } from "../../components/TextAreaField.tsx";
import { TextField } from "../../components/TextField.tsx";
import { useToast } from "../../components/Toast.tsx";
import { BANK_FILE_STATUS_BADGES, CHARGE_BEARER_NAMES, PAYOUT_ACCOUNT_STATUS_BADGES, bankFilePath } from "../../lib/bank-file-display.ts";
import { PAYOUT_BATCHES_PAGE, payoutBatchPath, statementPath } from "../../lib/billing-display.ts";
import { APPROVALS_PAGE_PATH } from "../../lib/channel-display.ts";
import { saveFile } from "../../lib/download.ts";
import { failureText } from "../../lib/failure.ts";
import { moneyLabel } from "../../lib/order-center-display.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan, usePlatformScopeBlocks } from "../../lib/use-master-access.ts";
import { Detail, LocalTime, NO_ACCESS, tableStateOf } from "./order-center-parts.tsx";

const SCOPE_DENIED = <StateBlock tone="neutral" title="你没有权限查看这里" description="财务结算只给不限数据范围的账号用（转账文件和收款账户跨城市、跨渠道，切不开）。" />;

function apiText(err: unknown, action: string): string {
  return err instanceof ApiError && err.status < 500 ? err.message : failureText(err, action);
}

// ───────────── 付款批次详情里的「银行转账文件」区 ─────────────

const eligibleColumns: Column<PreviewEligible>[] = [
  { key: "no", header: "账单号", cell: (row) => <Link className="link mono" to={statementPath(row.statement_id)}>{row.statement_no}</Link> },
  { key: "tenant", header: "供应商", wrap: true, cell: (row) => row.tenant.name },
  { key: "payee", header: "收款人", wrap: true, cardLabel: true, cell: (row) => row.beneficiary_name },
  { key: "bank", header: "银行 / SWIFT", wrap: true, cardLabel: true, cell: (row) => `${row.bank_name} · ${row.swift_bic}` },
  { key: "account", header: "账号", cardLabel: true, cell: (row) => (row.recently_changed ? <>{row.account_masked} <StatusBadge tone="warning" label="账户最近变更" /></> : row.account_masked) },
  { key: "amount", header: "金额", align: "end", cardLabel: true, cell: (row) => <span className="amount">{moneyLabel(row.amount)}</span> },
];

const excludedColumns: Column<PreviewExcluded>[] = [
  { key: "no", header: "账单号", cell: (row) => <Link className="link mono" to={statementPath(row.statement_id)}>{row.statement_no}</Link> },
  { key: "tenant", header: "供应商", wrap: true, cell: (row) => row.tenant.name },
  { key: "amount", header: "金额", align: "end", cardLabel: true, cell: (row) => <span className="amount">{moneyLabel(row.amount)}</span> },
  { key: "reason", header: "进不了文件的原因", wrap: true, cardLabel: true, cell: (row) => row.message },
];

const fileColumns: Column<BankFile>[] = [
  { key: "no", header: "文件号", cell: (row) => <Link className="link mono" to={bankFilePath(row.id)}>{row.file_no}</Link> },
  { key: "currency", header: "币种", cell: (row) => row.currency },
  { key: "status", header: "状态", cell: (row) => <StatusBadge {...BANK_FILE_STATUS_BADGES[row.status]} /> },
  { key: "count", header: "笔数", align: "end", cardLabel: true, cell: (row) => `${row.item_count} 笔` },
  { key: "total", header: "合计", align: "end", cardLabel: true, cell: (row) => <span className="amount">{moneyLabel(row.total)}</span> },
];

function GroupCard({ group, canGenerate, onGenerate }: { group: BankFilePreviewGroup; canGenerate: boolean; onGenerate(group: BankFilePreviewGroup): void }) {
  return (
    <section className="card" aria-label={`${group.currency} 的转账文件`}>
      <div className="card__title-row">
        <h3 className="card__title">{group.currency}</h3>
      </div>
      {group.pending_approval_id !== null && (
        <Alert kind="info">
          有一条待审核的生成复核，另一位同事批准后文件才生成。<Link className="link" to={APPROVALS_PAGE_PATH}>去「待审核」</Link>
        </Alert>
      )}
      {group.excluded.length > 0 && (
        <>
          <Alert kind="warning">{`有 ${group.excluded.length} 张账单进不了文件。补好账户后可以再生成一个文件，只包含剩下的。`}</Alert>
          <div className="card-table">
            <DataTable label={`${group.currency} 进不了文件的账单`} columns={excludedColumns} rows={group.excluded} rowKey={(row) => row.statement_id} state="ready" onRetry={() => undefined} empty={null} />
          </div>
        </>
      )}
      {group.eligible.length > 0 ? (
        <div className="card-table">
          <DataTable label={`${group.currency} 能进文件的账单`} columns={eligibleColumns} rows={group.eligible} rowKey={(row) => row.statement_id} state="ready" onRetry={() => undefined} empty={null} />
        </div>
      ) : (
        <p>{group.in_files.length > 0 && group.excluded.length === 0 ? "这种币种的账单都已经在文件里了。" : "现在没有能进文件的账单。"}</p>
      )}
      {canGenerate && group.eligible.length > 0 && group.pending_approval_id === null && (
        <div className="action-row">
          <Button variant="primary" onClick={() => onGenerate(group)}>
            {`生成 ${group.currency} 转账文件`}
          </Button>
        </div>
      )}
    </section>
  );
}

function GenerateFileDialog({ batchId, group, onClose, onDone }: { batchId: string; group: BankFilePreviewGroup; onClose(): void; onDone(): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const [bearer, setBearer] = useState<ChargeBearer>(BANK_TRANSFER_RULES.defaultChargeBearer);
  const [acknowledged, setAcknowledged] = useState<readonly string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [ackError, setAckError] = useState<string[]>([]);
  // 账号解没解得开，发起时才知道（预览不解密）：后端把进不了文件的账单列回来，和预览的合在一起给人确认
  const [lateExcluded, setLateExcluded] = useState<readonly { statement_no: string; tenant_name: string; message: string }[]>([]);
  const [nothingLeft, setNothingLeft] = useState(false);
  const previewExcluded = group.excluded.map((entry) => ({ statement_no: entry.statement_no, tenant_name: entry.tenant.name, message: entry.message }));
  const excluded = [...previewExcluded, ...lateExcluded.filter((entry) => !previewExcluded.some((known) => known.statement_no === entry.statement_no))];
  const hasExclusions = excluded.length > 0;
  const submit = async (): Promise<void> => {
    if (hasExclusions && acknowledged.length === 0) {
      setAckError(["请确认后再继续"]);
      return;
    }
    setBusy(true);
    setProblem(null);
    setAckError([]);
    try {
      await requestBankFile(token, batchId, { currency: group.currency, charge_bearer: bearer, allow_exclusions: hasExclusions, note: note.trim() === "" ? null : note.trim() });
      onDone();
    } catch (err) {
      if (handleAuthFailure(err)) return;
      setProblem(apiText(err, "发起"));
      if (err instanceof ApiError && (err.code === "BANK_FILE_EXCLUSIONS" || err.code === "BANK_FILE_EMPTY")) {
        setLateExcluded((err.details["excluded"] ?? []) as { statement_no: string; tenant_name: string; message: string }[]);
        setAcknowledged([]);
        setNothingLeft(err.code === "BANK_FILE_EMPTY");
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      title={`生成 ${group.currency} 转账文件`}
      size="form"
      busy={busy}
      dismissOnBackdrop={false}
      onClose={onClose}
      footer={
        <>
          <Button variant="text" disabled={busy} onClick={onClose}>
            取消
          </Button>
          {!nothingLeft && (
            <Button variant="primary" loading={busy} loadingText="提交中…" onClick={() => void submit()}>
              提交复核
            </Button>
          )}
        </>
      }
    >
      <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
      <p>{`${group.eligible.length} 笔，合计 ${moneyLabel(group.total)}。提交后要另一位同事在「待审核」批准，文件才生成。`}</p>
      <SelectField<ChargeBearer> label="手续费（Charges）" value={bearer} options={CHARGE_BEARERS.map((value) => ({ value, label: CHARGE_BEARER_NAMES[value] }))} onChange={setBearer} />
      {lateExcluded.length > 0 && (
        <ul>
          {lateExcluded.map((entry) => (
            <li key={entry.statement_no}>{`${entry.statement_no} ${entry.tenant_name}：${entry.message}`}</li>
          ))}
        </ul>
      )}
      {hasExclusions && !nothingLeft && (
        <CheckboxGroup
          legend={`排除 ${excluded.length} 张账单`}
          name="allow-exclusions"
          options={[{ value: "yes", label: `确认这次不付 ${excluded.map((entry) => entry.statement_no).join("、")}` }]}
          value={acknowledged}
          onChange={setAcknowledged}
          errors={ackError}
        />
      )}
      <TextAreaField label="说明（选填）" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
    </Dialog>
  );
}

export function BankFileSection({ batchId, batchStatus, canManage }: { batchId: string; batchStatus: string; canManage: boolean }) {
  const toast = useToast();
  const preview = useLoad<{ preview: BankFilePreview }>(`bank-file-preview|${batchId}|${batchStatus}`, (t) => getBankFilePreview(t, batchId));
  const files = useLoad<{ items: BankFile[]; truncated?: boolean }>(`bank-files|${batchId}|${batchStatus}`, (t) => listBankFiles(t, { payout_batch_id: batchId }));
  const [generating, setGenerating] = useState<BankFilePreviewGroup | null>(null);
  return (
    <section aria-labelledby="bank-file-section">
      <h2 className="card__title" id="bank-file-section">
        银行转账文件
      </h2>
      {batchStatus === "open" && <p>先锁定批次，再生成转账文件。一种币种一个文件，走双人复核。</p>}
      {preview.state.status === "error" && <StateBlock title="加载失败" description="请检查网络后重试。" action={<Button variant="secondary" onClick={preview.reload}>重试</Button>} />}
      {batchStatus !== "open" && (preview.state.data?.preview.groups ?? []).map((group) => <GroupCard key={group.currency} group={group} canGenerate={canManage && batchStatus === "closed"} onGenerate={setGenerating} />)}
      {files.state.data?.truncated === true && <Alert kind="warning">文件太多，这里只显示最新的 200 个。</Alert>}
      {(files.state.data?.items.length ?? 0) > 0 && (
        <div className="card-table">
          <DataTable label="这个批次的转账文件" columns={fileColumns} rows={files.state.data?.items ?? []} rowKey={(row) => row.id} state="ready" onRetry={files.reload} empty={null} />
        </div>
      )}
      {generating !== null && (
        <GenerateFileDialog
          batchId={batchId}
          group={generating}
          onClose={() => setGenerating(null)}
          onDone={() => {
            setGenerating(null);
            toast("已提交复核，另一位同事批准后文件才生成");
            preview.reload();
          }}
        />
      )}
    </section>
  );
}

// ───────────── 转账文件详情 ─────────────

/** 回填流水号：选要回填的笔（默认全部没回填的），写一个流水号；有的银行一个文件一个流水号，每笔不同就分几次回填。 */
function PaymentsDialog({ file, onClose, onDone }: { file: BankFileDetail; onClose(): void; onDone(next: BankFileDetail): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const unpaid = file.items.filter((item) => item.paid_at === null && !item.voided);
  const limit = BANK_TRANSFER_RULES.maxPaymentsPerRequest;
  const [selected, setSelected] = useState<readonly string[]>(unpaid.slice(0, limit).map((item) => item.id));
  const [reference, setReference] = useState("");
  const [errors, setErrors] = useState<{ reference: string[]; selected: string[] }>({ reference: [], selected: [] });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async (): Promise<void> => {
    const value = reference.trim();
    const next = { reference: isBankReference(value) ? [] : ["流水号是 1–64 位英文字母、数字和 / _ . : -，要以字母或数字开头"], selected: selected.length === 0 ? ["至少选一笔"] : selected.length > limit ? [`一次最多回填 ${limit} 笔`] : [] };
    setErrors(next);
    if (next.reference.length > 0 || next.selected.length > 0) return;
    setBusy(true);
    setProblem(null);
    try {
      onDone((await recordBankFilePayments(token, file.id, selected.map((item_id) => ({ item_id, bank_reference: value })))).file);
    } catch (err) {
      if (!handleAuthFailure(err)) setProblem(apiText(err, "回填"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      title="回填银行流水号"
      size="form"
      busy={busy}
      dismissOnBackdrop={false}
      onClose={onClose}
      footer={
        <>
          <Button variant="text" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" loading={busy} loadingText="提交中…" onClick={() => void submit()}>
            记为已付款
          </Button>
        </>
      }
    >
      <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
      <p>确认银行已经转出再回填。回填后账单记为已付款，供应商看得到流水号，不能改。</p>
      {unpaid.length > limit && <Alert kind="info">{`还有 ${unpaid.length} 笔没回填，一次最多 ${limit} 笔：已选好前 ${limit} 笔，提交后再回填剩下的。`}</Alert>}
      <TextField label="银行流水号" required value={reference} maxLength={BANK_TRANSFER_RULES.bankReferenceMaxLength} autoComplete="off" errors={errors.reference} onChange={(event) => setReference(event.target.value)} />
      <CheckboxGroup
        legend="这个流水号对应哪几笔"
        name="payment-items"
        options={unpaid.map((item) => ({ value: item.id, label: `${item.seq}. ${item.tenant.name} · ${moneyLabel(item.amount)}` }))}
        value={selected}
        onChange={setSelected}
        errors={errors.selected}
      />
    </Dialog>
  );
}

export function BankFileDetailPage() {
  const { id = "" } = useParams();
  const { portal, account, token, handleAuthFailure } = usePortalSession();
  const canRead = usePlatformCan("statement.read");
  const scopeBlocked = usePlatformScopeBlocks("statement.read");
  const canManage = usePlatformCan("statement.manage");
  const toast = useToast();
  const { state, reload, set } = useLoad<{ file: BankFileDetail }>(`bank-file|${id}`, canRead ? (t) => getBankFile(t, id) : null);
  const [dialog, setDialog] = useState<"payments" | "void" | null>(null);
  const [downloading, setDownloading] = useState<BankFileFormat | null>(null);
  const [confirmChanged, setConfirmChanged] = useState<BankFileFormat | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const file = state.data?.file ?? null;
  const title = file === null ? "转账文件" : `转账文件 ${file.file_no}`;
  useDocumentTitle(`${title} · NOZOMI ${portal.name}`);
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName={title} trail={[{ label: "财务结算" }, { label: "付款批次", to: PAYOUT_BATCHES_PAGE }, ...(file === null ? [] : [{ label: file.pay_date, to: payoutBatchPath(file.payout_batch_id) }])]}>
      <Page title={title}>{content}</Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(scopeBlocked ? SCOPE_DENIED : NO_ACCESS);
  if (state.status === "forbidden") return shell(SCOPE_DENIED);
  if (state.status === "not-found") return shell(<StateBlock tone="neutral" title="找不到这个转账文件" description="链接可能有误。" />);
  if (file === null) {
    return shell(state.status === "error" ? <StateBlock title="加载失败" description="请检查网络后重试。" action={<Button variant="secondary" onClick={reload}>重试</Button>} /> : <Skeleton lines={["medium", "long", "long", "medium"]} />);
  }
  const hasChangedAccount = file.items.some((item) => item.account_changed && item.paid_at === null && !item.voided);
  const download = async (format: BankFileFormat, acknowledged = false): Promise<void> => {
    if (hasChangedAccount && !acknowledged) {
      setConfirmChanged(format);
      return;
    }
    setConfirmChanged(null);
    setDownloading(format);
    setProblem(null);
    try {
      const name = saveFile(await downloadBankFile(token, file.id, format, acknowledged), `${file.file_no}.${format}`);
      toast(`已下载 ${name}`);
      reload();
    } catch (err) {
      if (handleAuthFailure(err)) return;
      if (err instanceof ApiError && err.code === "BANK_FILE_ACCOUNT_CHANGED") setConfirmChanged(format);
      else setProblem(apiText(err, "下载"));
    } finally {
      setDownloading(null);
    }
  };
  const canDownload = canManage && (file.status === "generated" || file.status === "downloaded");
  const canRecord = canManage && file.status === "downloaded";
  const columns: Column<BankFileItem>[] = [
    { key: "seq", header: "序号", cell: (row) => row.seq },
    { key: "no", header: "账单号", cell: (row) => <Link className="link mono" to={statementPath(row.statement_id)}>{row.statement_no}</Link> },
    { key: "tenant", header: "供应商", wrap: true, cell: (row) => row.tenant.name },
    { key: "payee", header: "收款人", wrap: true, cardLabel: true, cell: (row) => row.beneficiary_name },
    { key: "bank", header: "银行 / SWIFT", wrap: true, cardLabel: true, cell: (row) => `${row.bank_name} · ${row.swift_bic}` },
    { key: "account", header: "账号", cardLabel: true, cell: (row) => (row.account_changed && row.paid_at === null && !row.voided ? <>{row.account_masked} <StatusBadge tone="warning" label="账户已变更" /></> : row.account_masked) },
    { key: "amount", header: "金额", align: "end", cardLabel: true, cell: (row) => <span className="amount">{moneyLabel(row.amount)}</span> },
    { key: "ref", header: "银行流水号", cardLabel: true, cell: (row) => (row.voided ? <StatusBadge tone="neutral" label="已作废" /> : row.bank_reference ?? "—") },
  ];
  return shell(
    <>
      <section className="card" aria-labelledby="bank-file-summary">
        <div className="card__title-row">
          <h2 className="card__title" id="bank-file-summary">
            {`${file.pay_date} 付款 · ${file.currency}`}
          </h2>
          <StatusBadge {...BANK_FILE_STATUS_BADGES[file.status]} />
        </div>
        <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
        {file.items.some((item) => item.voided) && file.status === "paid" && <Alert kind="warning">{`合计和笔数是生成时的。其中 ${file.items.filter((item) => item.voided).length} 笔已作废、没有付款，实际付款看下面每一笔的流水号。`}</Alert>}
        {file.status === "generated" && <Alert kind="info">交给银行用原始下载的 CSV，不要用 Excel 打开后另存（账号开头的 0 会丢）；要查看请下载 Excel 文件。</Alert>}
        <dl className="details">
          <Detail label="合计">
            <strong className="amount">{moneyLabel(file.total)}</strong>
          </Detail>
          <Detail label="笔数">{`${file.item_count} 笔`}</Detail>
          <Detail label="手续费">{file.charge_bearer}</Detail>
          <Detail label="模板">{file.template}</Detail>
          <Detail label="生成时间">
            <LocalTime iso={file.created_at} />
          </Detail>
          <Detail label="下载">{file.first_downloaded_at === null ? "还没下载" : `${file.download_count} 次`}</Detail>
          {file.csv_sha256 !== null && <Detail label="CSV 指纹（SHA-256）"><span className="mono">{file.csv_sha256}</span></Detail>}
          {file.xlsx_sha256 !== null && <Detail label="Excel 指纹（SHA-256）"><span className="mono">{file.xlsx_sha256}</span></Detail>}
          {file.void_reason !== null && <Detail label="作废原因">{file.void_reason}</Detail>}
        </dl>
        {(canDownload || canRecord) && (
          <div className="action-row">
            {canDownload && (
              <>
                <Button variant="primary" loading={downloading === "csv"} loadingText="下载中…" disabled={downloading !== null} onClick={() => void download("csv")}>
                  下载 CSV
                </Button>
                <Button loading={downloading === "xlsx"} loadingText="下载中…" disabled={downloading !== null} onClick={() => void download("xlsx")}>
                  下载 Excel
                </Button>
              </>
            )}
            {canRecord && <Button onClick={() => setDialog("payments")}>回填流水号</Button>}
            {canDownload && (
              <Button variant="secondary" className="button--danger-text" onClick={() => setDialog("void")}>
                作废
              </Button>
            )}
          </div>
        )}
      </section>
      {file.excluded.length > 0 && (
        <section className="card" aria-labelledby="bank-file-excluded">
          <h2 className="card__title" id="bank-file-excluded">
            生成时排除的账单
          </h2>
          <ul>
            {file.excluded.map((entry) => (
              <li key={entry.statement_id}>
                <Link className="link mono" to={statementPath(entry.statement_id)}>
                  {entry.statement_no}
                </Link>
                {` ${entry.tenant_name}：${entry.message}`}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="card-table">
        <DataTable label="每一笔" columns={columns} rows={file.items} rowKey={(row) => row.id} state="ready" onRetry={reload} empty={null} />
      </div>
      {confirmChanged !== null && (
        <Dialog
          open
          title="收款账户换过，还要下载吗？"
          onClose={() => setConfirmChanged(null)}
          footer={
            <>
              <Button variant="text" data-autofocus onClick={() => setConfirmChanged(null)}>
                取消
              </Button>
              <Button variant="primary" onClick={() => void download(confirmChanged, true)}>
                确认下载
              </Button>
            </>
          }
        >
          <p>文件生成后，供应商换过收款账户，文件里还是批准时的旧账号。请先向供应商确认旧账号仍然可用；不确定就作废这个文件、重新生成。这次下载会记入审计。</p>
        </Dialog>
      )}
      {dialog === "payments" && (
        <PaymentsDialog
          file={file}
          onClose={() => setDialog(null)}
          onDone={(next) => {
            set({ file: next });
            setDialog(null);
            toast("已回填流水号");
          }}
        />
      )}
      {dialog === "void" && (
        <NoteDialog
          title="作废这个转账文件？"
          intro="未付款的账单释放，可以进新文件；已回填的不退回。文件如果已经交给银行，请先到银行撤销，否则重新生成会重复付款。"
          label="作废原因"
          required
          missing="请写作废原因"
          maxLength={500}
          confirmText="作废"
          busyText="作废中…"
          danger
          action="作废"
          onClose={() => setDialog(null)}
          onSubmit={async (reason) => {
            set({ file: (await voidBankFile(token, file.id, reason)).file });
            setDialog(null);
            toast("已作废");
          }}
        />
      )}
    </>,
  );
}

// ───────────── 收款账户队列 ─────────────

export function PayoutAccountQueuePage() {
  const { portal, account, token } = usePortalSession();
  useDocumentTitle(`收款账户 · NOZOMI ${portal.name}`);
  const canRead = usePlatformCan("statement.read");
  const scopeBlocked = usePlatformScopeBlocks("statement.read");
  const canManage = usePlatformCan("statement.manage");
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const statusParam = params.get("status");
  const status: PayoutAccountStatus | null = statusParam === "all" ? null : (PAYOUT_ACCOUNT_STATUSES as readonly string[]).includes(statusParam ?? "") ? (statusParam as PayoutAccountStatus) : "pending";
  const { state, reload } = useLoad<{ items: PlatformPayoutAccount[]; truncated?: boolean }>(`payout-accounts|${status ?? "all"}`, canRead ? (t) => listPlatformPayoutAccounts(t, status === null ? {} : { status }) : null);
  const [dialog, setDialog] = useState<{ kind: "review" | "reject"; account: PlatformPayoutAccount } | null>(null);
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="收款账户" trail={[{ label: "财务结算" }]}>
      <Page title="收款账户">{content}</Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(scopeBlocked ? SCOPE_DENIED : NO_ACCESS);
  const columns: Column<PlatformPayoutAccount>[] = [
    { key: "tenant", header: "供应商", wrap: true, cell: (row) => row.tenant.name },
    { key: "currency", header: "币种", cell: (row) => row.currency },
    { key: "status", header: "状态", cell: (row) => <StatusBadge {...PAYOUT_ACCOUNT_STATUS_BADGES[row.status]} /> },
    { key: "payee", header: "收款人", wrap: true, cardLabel: true, cell: (row) => <>{row.beneficiary_name}<br />{row.beneficiary_address}</> },
    { key: "bank", header: "银行", wrap: true, cardLabel: true, cell: (row) => <>{row.bank_name}<br />{row.bank_address}</> },
    { key: "swift", header: "SWIFT/BIC", cardLabel: true, cell: (row) => <span className="mono">{row.swift_bic}</span> },
    { key: "account", header: "账号", cardLabel: true, cell: (row) => <span className="mono">{row.account_masked}</span> },
    { key: "submitted", header: "提交时间", cardLabel: true, cell: (row) => <LocalTime iso={row.submitted_at} /> },
    ...(canManage
      ? [
          {
            key: "actions",
            header: "操作",
            cell: (row: PlatformPayoutAccount) =>
              row.status !== "pending" ? "—" : row.pending_approval_id !== null ? (
                <Link className="link" to={APPROVALS_PAGE_PATH}>等复核</Link>
              ) : (
                <div className="action-row">
                  <Button onClick={() => setDialog({ kind: "review", account: row })}>{`发起复核：${row.tenant.name} ${row.currency}`}</Button>
                  <Button variant="secondary" className="button--danger-text" onClick={() => setDialog({ kind: "reject", account: row })}>{`驳回：${row.tenant.name} ${row.currency}`}</Button>
                </div>
              ),
          } satisfies Column<PlatformPayoutAccount>,
        ]
      : []),
  ];
  return shell(
    <>
      <p className="page__lead">供应商的管理员提交账户。请按它的结算账户证明核对户名、银行、SWIFT 和账号末 4 位，再发起复核；另一位同事批准后生效。这里永远看不到完整账号。</p>
      <div className="filter-bar" role="search">
        <SelectField
          inline
          label="状态"
          value={status ?? "all"}
          options={[{ value: "all", label: "全部" }, ...PAYOUT_ACCOUNT_STATUSES.map((value) => ({ value, label: PAYOUT_ACCOUNT_STATUS_BADGES[value].label }))]}
          onChange={(value) => setParams(value === "pending" ? {} : { status: value })}
        />
      </div>
      {state.data?.truncated === true && <Alert kind="warning">记录太多，这里只显示最新的 200 条，可以按状态筛选。</Alert>}
      <div className="card-table">
        <DataTable label="收款账户" columns={columns} rows={state.data?.items ?? []} rowKey={(row) => row.id} state={tableStateOf(state.status, state.data !== null)} onRetry={reload} empty={<StateBlock tone="neutral" title="没有符合的账户" description="供应商在自己的后台「账单 → 收款账户」提交后会出现在这里。" />} />
      </div>
      {dialog?.kind === "review" && (
        <NoteDialog
          title={`发起复核：${dialog.account.tenant.name} 的 ${dialog.account.currency} 账户`}
          intro={`${dialog.account.beneficiary_name} · ${dialog.account.bank_name} · ${dialog.account.swift_bic} · ${dialog.account.account_masked}。另一位同事批准后生效。`}
          label="说明（选填）"
          required={false}
          maxLength={500}
          confirmText="提交复核"
          busyText="提交中…"
          action="发起复核"
          onClose={() => setDialog(null)}
          onSubmit={async (note) => {
            await requestPayoutAccountReview(token, dialog.account.id, note === "" ? null : note);
            setDialog(null);
            toast("已提交复核");
            reload();
          }}
        />
      )}
      {dialog?.kind === "reject" && (
        <NoteDialog
          title={`驳回 ${dialog.account.tenant.name} 的 ${dialog.account.currency} 账户？`}
          intro="供应商看得到原因，可以重新提交。"
          label="驳回原因"
          required
          missing="请写驳回原因"
          maxLength={500}
          confirmText="驳回"
          busyText="驳回中…"
          danger
          action="驳回"
          onClose={() => setDialog(null)}
          onSubmit={async (reason) => {
            await rejectPayoutAccount(token, dialog.account.id, reason);
            setDialog(null);
            toast("已驳回");
            reload();
          }}
        />
      )}
    </>,
  );
}
