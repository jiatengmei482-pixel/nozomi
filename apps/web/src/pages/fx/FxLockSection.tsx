/**
 * 汇率页的「人工锁定」（M2-06，ADR 0025）：生效中的锁定（哪个币种、锁定值、到期时间、谁发起谁批准）、待审核的锁定 / 解锁申请、锁定记录；
 * 有 `fx.manage` 的（主数据运营、超级管理员）可以发起锁定、改锁定值、发起解锁——都是双人复核，在「待审核」里由另一位同事批准后才生效。
 * 锁定值是十进制字符串：表单在字符串上解析和比较（@nozomi/domain），不经过浮点数。
 */
import { useState } from "react";
import { Link } from "react-router";
import type { CurrencyCode } from "@nozomi/domain";
import type { Approval } from "../../api/channels.ts";
import { type FxLock, type FxOverview, fetchFxOverview, requestFxLock, requestFxUnlock } from "../../api/fx.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert, type Notice } from "../../components/Alert.tsx";
import { Button } from "../../components/Button.tsx";
import { type Column, DataTable } from "../../components/DataTable.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { SelectField } from "../../components/FormFields.tsx";
import { StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { TextField } from "../../components/TextField.tsx";
import { APPROVALS_PAGE_PATH, APPROVAL_KIND_NAMES, approvalSummaryText } from "../../lib/channel-display.ts";
import { FX_LOCKABLE_CURRENCIES, LOCK_DURATION_HOURS, LOCK_HOURS_MESSAGE, checkLockDraft, lockExpiresAt, lockHoursOf, lockServerErrors } from "../../lib/fx-lock-form.ts";
import { CURRENCY_NAMES, FX_LOCK_BADGES, changeText, rateText } from "../../lib/fx-display.ts";
import { failureText } from "../../lib/failure.ts";
import { formatLocalDateTime } from "../../lib/master-display.ts";
import { useLoad } from "../../lib/use-load.ts";

const SUBMITTED: Notice = { kind: "success", text: "已提交，等另一位有审核权限的同事在「待审核」里批准后生效" };

/** 生效中的锁定、待审核的申请；有权限的人能发起锁定和解锁。 */
export function FxLockCard({ data, canManage, onSubmitted }: { data: FxOverview; canManage: boolean; onSubmitted(notice: Notice): void }) {
  const [locking, setLocking] = useState<{ currency: CurrencyCode } | null>(null);
  const [unlocking, setUnlocking] = useState<FxLock | null>(null);
  const columns: Column<FxLock>[] = [
    { key: "currency", header: "币种", cell: (row) => `${row.currency} ${CURRENCY_NAMES[row.currency]}` },
    { key: "rate", header: "锁定值（1 USD =）", cell: (row) => <span className="fx-mono" title={row.rate}>{rateText(row.rate)}</span> },
    { key: "central", header: "批准时的中央汇率", cell: (row) => <span className="fx-mono">{`${rateText(row.central_rate)}（${changeText(row.deviation_bp)}）`}</span> },
    { key: "expires", header: "到期时间", cell: (row) => formatLocalDateTime(row.expires_at) },
    { key: "people", header: "发起 / 批准", wrap: true, cell: (row) => `${row.requested_by.name} / ${row.approved_by.name}（${formatLocalDateTime(row.locked_at)} 生效）` },
    { key: "reason", header: "原因", wrap: true, cell: (row) => row.reason ?? "—" },
    ...(canManage
      ? [
          {
            key: "actions",
            header: "操作",
            cell: (row: FxLock) => (
              <span className="fx-lock__row-actions">
                <Button size="sm" onClick={() => setLocking({ currency: row.currency })}>
                  改锁定值
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setUnlocking(row)}>
                  解锁
                </Button>
              </span>
            ),
          },
        ]
      : []),
  ];
  return (
    <section className={`card${data.locks.length > 0 ? " fx-lock--active" : ""}`} aria-labelledby="fx-lock-title">
      <div className="card__header">
        <h2 className="card__title" id="fx-lock-title">
          人工锁定
        </h2>
        {canManage && (
          <Button variant="secondary" onClick={() => setLocking({ currency: "JPY" })}>
            发起锁定
          </Button>
        )}
      </div>
      <p className="fx-hint">
        极端行情时可以临时锁定某个币种相对美元的汇率，锁定期间报价用锁定值（报价快照里记明），交叉汇率照常由两边算出。一人发起、另一位有审核权限的同事批准后才生效，解锁也一样；最长 {data.lock_rules.max_hours} 小时，到期自动恢复用数据源的汇率。
      </p>
      {data.locks.length === 0 ? (
        <p className="fx-lock__empty">现在没有锁定的汇率。</p>
      ) : (
        <DataTable label="生效中的锁定" columns={columns} rows={data.locks} rowKey={(row) => row.id} state="ready" onRetry={() => undefined} empty={null} />
      )}
      {data.pending_locks.length > 0 && <PendingLocks items={data.pending_locks} />}
      {locking !== null && (
        <LockDialog
          data={data}
          initialCurrency={locking.currency}
          onClose={() => setLocking(null)}
          onDone={() => {
            setLocking(null);
            onSubmitted(SUBMITTED);
          }}
        />
      )}
      {unlocking !== null && (
        <UnlockDialog
          lock={unlocking}
          onClose={() => setUnlocking(null)}
          onDone={() => {
            setUnlocking(null);
            onSubmitted(SUBMITTED);
          }}
        />
      )}
    </section>
  );
}

function PendingLocks({ items }: { items: readonly Approval[] }) {
  return (
    <div className="fx-lock__pending">
      <h3 className="fx-lock__subtitle">待审核</h3>
      <ul className="fx-lock__pending-list">
        {items.map((approval) => (
          <li key={approval.id} className="fx-lock__pending-item">
            <span className="fx-lock__pending-head">
              <StatusBadge tone="warning" label="待审核" />
              <strong>{APPROVAL_KIND_NAMES[approval.kind]}</strong>
            </span>
            <span>{approvalSummaryText(approval.summary)}</span>
            <span className="table__muted">{`${approval.requested_by.name} 发起 · ${formatLocalDateTime(approval.requested_at)}${approval.request_note ? ` · ${approval.request_note}` : ""}`}</span>
            {approval.can.approve ? (
              <Link className="link" to={APPROVALS_PAGE_PATH}>
                去待审核处理
              </Link>
            ) : approval.can.withdraw ? (
              <span className="table__muted">这是你发起的，要等另一位有审核权限的同事处理（可以在「待审核」里撤回）。</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 发起锁定（或给已锁定的币种改锁定值 / 到期时间）。 */
function LockDialog({ data, initialCurrency, onClose, onDone }: { data: FxOverview; initialCurrency: CurrencyCode; onClose(): void; onDone(): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const [currency, setCurrency] = useState<CurrencyCode>(initialCurrency);
  const [rate, setRate] = useState("");
  const [hoursText, setHoursText] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [server, setServer] = useState<{ rate: string[]; reason: string[]; form: string[] } | null>(null);
  // 偏离要和「1 USD = ?」的中央汇率比：看板换了基准时另取一份以美元为基准的
  const usd = useLoad<FxOverview>("fx-lock-usd", data.base === "USD" ? null : (current) => fetchFxOverview(current, "USD"));
  const usdData = data.base === "USD" ? data : usd.state.data;
  const central = usdData?.rates.find((item) => item.currency === currency)?.central_rate ?? null;
  const current = data.locks.find((lock) => lock.currency === currency) ?? null;
  const check = checkLockDraft({ rate, reason }, central, touched);
  const rateErrors = [...check.errors.rate, ...(server?.rate ?? [])];
  const reasonErrors = [...check.errors.reason, ...(server?.reason ?? [])];
  const hours = lockHoursOf(hoursText);
  const hoursErrors = attempted && hours === null ? [LOCK_HOURS_MESSAGE] : [];

  const submit = async (): Promise<void> => {
    setTouched(true);
    setAttempted(true);
    setServer(null);
    const final = checkLockDraft({ rate, reason }, central, true);
    if (final.rate === null || final.errors.rate.length > 0 || final.errors.reason.length > 0 || hours === null) return;
    setBusy(true);
    try {
      await requestFxLock(token, { currency, rate: final.rate, expires_at: lockExpiresAt(new Date(), hours), reason: reason.trim() === "" ? null : reason.trim() });
      onDone();
    } catch (err) {
      if (handleAuthFailure(err)) return;
      setServer(lockServerErrors(err) ?? { rate: [], reason: [], form: [failureText(err, "提交")] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      size="form"
      title={current === null ? "发起锁定汇率" : `改 ${current.currency} 的锁定`}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="text" data-autofocus disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" loading={busy} loadingText="提交中…" onClick={() => void submit()}>
            提交审核
          </Button>
        </>
      }
    >
      <div role="alert">{server !== null && server.form.length > 0 && <Alert kind="danger">{server.form.join("；")}</Alert>}</div>
      <p>提交后不会立即生效：要另一位有审核权限的同事在「待审核」里批准。</p>
      <SelectField
        label="币种"
        value={currency}
        options={FX_LOCKABLE_CURRENCIES.map((code) => ({ value: code, label: `${code} ${CURRENCY_NAMES[code]}` }))}
        onChange={(value) => {
          setCurrency(value);
          setServer(null);
        }}
      />
      <p className="fx-hint">
        {central === null ? "正在取中央汇率…" : `现在的中央汇率：1 USD = ${central} ${currency}`}
        {current !== null ? `；现在锁定在 ${current.rate}，到 ${formatLocalDateTime(current.expires_at)}，批准后新的取代它` : ""}
      </p>
      <TextField
        label={`锁定值（1 USD = ? ${currency}）`}
        inputMode="decimal"
        autoComplete="off"
        value={rate}
        errors={rateErrors}
        hint={check.deviation === null ? "十进制数，如 151.2" : `和中央汇率相差 ${changeText(check.deviation.changeBp)}`}
        onChange={(event) => {
          setRate(event.target.value);
          setServer(null);
        }}
        onBlur={() => setTouched(true)}
      />
      <SelectField
        label="锁定多久"
        placeholder="请选择"
        value={hoursText}
        options={LOCK_DURATION_HOURS.map((value) => ({ value: String(value), label: `${value} 小时` }))}
        errors={hoursErrors}
        onChange={setHoursText}
      />
      <p className="fx-hint">{hours === null ? `最长 ${data.lock_rules.max_hours} 小时。选好后这里显示到期时间。` : `到 ${formatLocalDateTime(lockExpiresAt(new Date(), hours))} 自动失效（从提交时算起；批准得晚，剩下的时间就短）。`}</p>
      <TextField
        label={check.deviation?.needsReason ? "原因（必填）" : "原因"}
        autoComplete="off"
        maxLength={500}
        value={reason}
        errors={reasonErrors}
        hint={`和中央汇率相差超过 ${data.lock_rules.reason_above_bp / 100}% 时必填；超过 ${data.lock_rules.max_deviation_bp / 100}% 不允许`}
        onChange={(event) => {
          setReason(event.target.value);
          setServer(null);
        }}
      />
    </Dialog>
  );
}

function UnlockDialog({ lock, onClose, onDone }: { lock: FxLock; onClose(): void; onDone(): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      await requestFxUnlock(token, lock.id, reason.trim() === "" ? null : reason.trim());
      onDone();
    } catch (err) {
      if (handleAuthFailure(err)) return;
      setProblem(lockServerErrors(err)?.form[0] ?? failureText(err, "提交"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      title={`解除 ${lock.currency} 的锁定？`}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="text" data-autofocus disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" loading={busy} loadingText="提交中…" onClick={() => void submit()}>
            提交审核
          </Button>
        </>
      }
    >
      <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
      <p>{`现在锁定在 1 USD = ${lock.rate} ${lock.currency}，原定到 ${formatLocalDateTime(lock.expires_at)}。另一位同事批准后恢复用数据源的汇率。`}</p>
      <TextField label="原因（选填）" autoComplete="off" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
    </Dialog>
  );
}

/** 锁定记录（含已结束的）。 */
export function FxLockHistory({ items, state, onRetry }: { items: readonly FxLock[]; state: "ready" | "loading" | "error" | "forbidden"; onRetry(): void }) {
  const columns: Column<FxLock>[] = [
    { key: "currency", header: "币种", cell: (row) => row.currency },
    { key: "rate", header: "锁定值（1 USD =）", cell: (row) => <span className="fx-mono">{rateText(row.rate)}</span> },
    { key: "period", header: "生效 — 到期", wrap: true, cell: (row) => `${formatLocalDateTime(row.locked_at)} — ${formatLocalDateTime(row.expires_at)}` },
    { key: "status", header: "状态", cell: (row) => <StatusBadge {...FX_LOCK_BADGES[row.status]} /> },
    {
      key: "people",
      header: "经手",
      wrap: true,
      cell: (row) => `${row.requested_by.name} 发起，${row.approved_by.name} 批准${row.ended_by !== null ? `；${row.ended_by.name} 批准${row.status === "replaced" ? "取代" : "解锁"}` : ""}${row.ended_at !== null ? `（${formatLocalDateTime(row.ended_at)}）` : ""}`,
    },
  ];
  return <DataTable label="锁定记录表" columns={columns} rows={items} rowKey={(row) => row.id} state={state} onRetry={onRetry} empty={<StateBlock tone="neutral" title="还没有锁定过汇率" />} />;
}
