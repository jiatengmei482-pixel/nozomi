/**
 * 供应商后台「收款账户」（M5-02，ADR 0051；页面说明 docs/design/pages/finance.md 第 6 节）。
 * - 看（`company.read`：管理员、财务、只读）：只显示账号末 4 位；
 * - 提交、撤回（`company.manage`：只有管理员）：要重新输入当前密码；平台两位财务审核后生效，批准之前旧账户继续有效。
 * 账号和密码只在对话框的状态里，提交成功或关闭后就没了；不写进网址、本地存储。
 */
import { CURRENCIES, PAYOUT_ACCOUNT_ISSUE_MESSAGES, type PayoutAccountIssueReason, type PayoutAccountKind, accountNumberIssue, isValidSwiftBic, normalizeAccountNumber, normalizeSwiftBic } from "@nozomi/domain";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { type TenantPayoutAccount, listTenantPayoutAccounts, submitPayoutAccount, withdrawPayoutAccount } from "../../api/bank-files.ts";
import { ApiError } from "../../api/client.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button } from "../../components/Button.tsx";
import { type Column, DataTable } from "../../components/DataTable.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { RadioGroup, SelectField } from "../../components/FormFields.tsx";
import { StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { TextField } from "../../components/TextField.tsx";
import { useToast } from "../../components/Toast.tsx";
import { PAYOUT_ACCOUNT_STATUS_BADGES } from "../../lib/bank-file-display.ts";
import { TENANT_STATEMENTS_PAGE } from "../../lib/billing-display.ts";
import { failureText } from "../../lib/failure.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { useTenantCan } from "../../lib/use-master-access.ts";
import { LocalTime, NO_ACCESS, tableStateOf } from "../platform/order-center-parts.tsx";

const FIELDS = ["beneficiary_name", "beneficiary_address", "bank_name", "bank_address", "swift_bic", "account_number", "current_password"] as const;
type FieldName = (typeof FIELDS)[number];
type FieldErrors = Partial<Record<FieldName, string[]>>;

function SubmitDialog({ onClose, onDone }: { onClose(): void; onDone(): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const [currency, setCurrency] = useState("");
  const [kind, setKind] = useState<PayoutAccountKind>("account");
  const [values, setValues] = useState<Record<FieldName, string>>({ beneficiary_name: "", beneficiary_address: "", bank_name: "", bank_address: "", swift_bic: "", account_number: "", current_password: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [currencyError, setCurrencyError] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = (name: FieldName) => ({
    value: values[name],
    errors: errors[name] ?? [],
    onChange: (event: { target: { value: string } }) => setValues((current) => ({ ...current, [name]: event.target.value })),
  });
  const submit = async (): Promise<void> => {
    const next: FieldErrors = {};
    for (const name of FIELDS) if (values[name].trim() === "") next[name] = ["必填"];
    if (values.swift_bic.trim() !== "" && !isValidSwiftBic(normalizeSwiftBic(values.swift_bic))) next.swift_bic = [PAYOUT_ACCOUNT_ISSUE_MESSAGES.SWIFT_BIC_INVALID];
    const numberIssue = accountNumberIssue(kind, normalizeAccountNumber(values.account_number));
    if (numberIssue !== null && numberIssue !== "REQUIRED") next.account_number = [PAYOUT_ACCOUNT_ISSUE_MESSAGES[numberIssue]];
    setErrors(next);
    setCurrencyError(currency === "" ? ["请选币种"] : []);
    if (Object.keys(next).length > 0 || currency === "") return;
    setBusy(true);
    setProblem(null);
    try {
      await submitPayoutAccount(token, { currency, account_kind: kind, ...values });
      onDone();
    } catch (err) {
      if (handleAuthFailure(err)) return;
      if (err instanceof ApiError && err.code === "CURRENT_PASSWORD_INCORRECT") setErrors({ current_password: [err.message] });
      else if (err instanceof ApiError && err.code === "VALIDATION_FAILED") {
        const issues = (err.details["issues"] ?? []) as { path: string; reason?: PayoutAccountIssueReason; message: string }[];
        const mapped: FieldErrors = {};
        const elsewhere: string[] = [];
        for (const issue of issues) {
          const text = issue.reason === undefined ? issue.message : PAYOUT_ACCOUNT_ISSUE_MESSAGES[issue.reason];
          const name = issue.path.slice(1);
          if (name === "currency") setCurrencyError([text]);
          else if ((FIELDS as readonly string[]).includes(name)) mapped[name as FieldName] = [text];
          else elsewhere.push(text);
        }
        setErrors(mapped);
        if (elsewhere.length > 0 || issues.length === 0) setProblem(elsewhere.join("；") || err.message);
      } else setProblem(err instanceof ApiError && err.status < 500 ? err.message : failureText(err, "提交"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      title="提交收款账户"
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
            提交审核
          </Button>
        </>
      }
    >
      <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
      <p>平台审核通过后生效，批准之前现在的账户继续有效。名称和地址请按银行开户资料写英文（国际汇款只能传英文字母、数字和少数符号）。</p>
      <SelectField label="币种" required placeholder="请选择" value={currency} options={Object.keys(CURRENCIES).map((code) => ({ value: code, label: code }))} errors={currencyError} onChange={setCurrency} />
      <TextField label="收款人名称（英文）" required autoComplete="off" hint="和银行开户名一致" {...field("beneficiary_name")} />
      <TextField label="收款人地址（英文）" required autoComplete="off" {...field("beneficiary_address")} />
      <TextField label="银行名称（英文）" required autoComplete="off" {...field("bank_name")} />
      <TextField label="银行地址（英文）" required autoComplete="off" {...field("bank_address")} />
      <TextField label="SWIFT/BIC" required autoComplete="off" hint="8 或 11 位，向开户行查询" {...field("swift_bic")} />
      <RadioGroup<PayoutAccountKind>
        legend="账号类型"
        name="account-kind"
        options={[
          { value: "account", label: "银行账号" },
          { value: "iban", label: "IBAN" },
        ]}
        value={kind}
        onChange={setKind}
      />
      <TextField label={kind === "iban" ? "IBAN" : "银行账号"} required autoComplete="off" hint="保存后只显示末 4 位，请仔细核对" {...field("account_number")} />
      <TextField label="当前登录密码" required type="password" autoComplete="current-password" hint="改收款账户要再确认一次是你本人" {...field("current_password")} />
    </Dialog>
  );
}

function WithdrawDialog({ account, onClose, onDone }: { account: TenantPayoutAccount; onClose(): void; onDone(): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      await withdrawPayoutAccount(token, account.id);
      onDone();
    } catch (err) {
      if (!handleAuthFailure(err)) setProblem(err instanceof ApiError && err.status < 500 ? err.message : failureText(err, "撤回"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      title={`撤回 ${account.currency} 账户 ${account.account_masked}？`}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="text" data-autofocus disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" loading={busy} loadingText="撤回中…" onClick={() => void submit()}>
            撤回
          </Button>
        </>
      }
    >
      <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
      <p>撤回后平台不再审核它；要改就重新提交。</p>
    </Dialog>
  );
}

export function TenantPayoutAccountsPage() {
  const { portal, account, token } = usePortalSession();
  useDocumentTitle(`收款账户 · NOZOMI ${portal.name}`);
  const canRead = useTenantCan("company.read");
  const canManage = useTenantCan("company.manage");
  const toast = useToast();
  const { state, reload } = useLoad<{ items: TenantPayoutAccount[]; truncated?: boolean }>("tenant-payout-accounts", canRead ? (t) => listTenantPayoutAccounts(t) : null);
  const [submitting, setSubmitting] = useState(false);
  const [withdrawing, setWithdrawing] = useState<TenantPayoutAccount | null>(null);
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="收款账户" trail={[{ label: "账单", to: TENANT_STATEMENTS_PAGE }]}>
      <Page title="收款账户" action={canManage ? <Button variant="primary" onClick={() => setSubmitting(true)}>提交收款账户</Button> : undefined}>
        {content}
      </Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);
  const columns: Column<TenantPayoutAccount>[] = [
    { key: "currency", header: "币种", cell: (row) => row.currency },
    { key: "status", header: "状态", cell: (row) => <StatusBadge {...PAYOUT_ACCOUNT_STATUS_BADGES[row.status]} /> },
    { key: "payee", header: "收款人", wrap: true, cardLabel: true, cell: (row) => row.beneficiary_name },
    { key: "bank", header: "银行", wrap: true, cardLabel: true, cell: (row) => `${row.bank_name} · ${row.swift_bic}` },
    { key: "account", header: "账号", cardLabel: true, cell: (row) => <span className="mono">{row.account_masked}</span> },
    { key: "submitted", header: "提交时间", cardLabel: true, cell: (row) => <LocalTime iso={row.submitted_at} /> },
    { key: "note", header: "说明", wrap: true, cardLabel: true, cell: (row) => row.reject_reason ?? (row.status === "pending" ? "平台审核中" : "—") },
    ...(canManage
      ? [
          {
            key: "actions",
            header: "操作",
            cell: (row: TenantPayoutAccount) => (row.status === "pending" ? <Button variant="text" onClick={() => setWithdrawing(row)}>{`撤回 ${row.currency} 账户`}</Button> : "—"),
          } satisfies Column<TenantPayoutAccount>,
        ]
      : []),
  ];
  return shell(
    <>
      <p className="page__lead">
        平台按账单的币种把钱付到这种币种生效中的账户。没有生效账户的账单付不了款。<Link className="link" to={TENANT_STATEMENTS_PAGE}>回到账单</Link>
      </p>
      {state.data?.truncated === true && <Alert kind="warning">记录太多，这里只显示最新的 200 条。</Alert>}
      <div className="card-table">
        <DataTable label="收款账户" columns={columns} rows={state.data?.items ?? []} rowKey={(row) => row.id} state={tableStateOf(state.status, state.data !== null)} onRetry={reload} empty={<StateBlock tone="neutral" title="还没有收款账户" description={canManage ? "点右上角提交，平台审核通过后生效。" : "请让管理员提交。"} />} />
      </div>
      {submitting && (
        <SubmitDialog
          onClose={() => setSubmitting(false)}
          onDone={() => {
            setSubmitting(false);
            toast("已提交，平台审核通过后生效");
            reload();
          }}
        />
      )}
      {withdrawing !== null && (
        <WithdrawDialog
          account={withdrawing}
          onClose={() => setWithdrawing(null)}
          onDone={() => {
            setWithdrawing(null);
            toast("已撤回");
            reload();
          }}
        />
      )}
    </>,
  );
}
