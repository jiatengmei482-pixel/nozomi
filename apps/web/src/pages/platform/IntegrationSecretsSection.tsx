/**
 * 系统状态页里的「第三方密钥」（ADR 0041）：谷歌地图、Stripe 各一张卡片，写出现在生效的是哪一份（后台设置 / 服务器配置文件 / 未配置）和打码后的末 4 位；
 * 超级管理员（接口的 `can_manage`）可以填写 / 更换、清空、测试一下，其他人只能看。
 *
 * 填进来的密钥原文只在两处：对话框里的输入框（不受控，React 不把值写进 value 属性）和 PUT 的请求体。
 * 不进 state、不进 localStorage、不进地址、不打日志；提交成功后输入框随对话框一起清掉，页面上只显示后端给的打码值。
 */
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { ApiError, NetworkError } from "../../api/client.ts";
import { type IntegrationSecretItem, type IntegrationSecretKey, type IntegrationSecrets, type IntegrationTestResult, type SecretFieldName, clearIntegrationSecret, listIntegrationSecrets, saveIntegrationSecret, testIntegrationSecret } from "../../api/platform.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { Button } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { PasswordField } from "../../components/TextField.tsx";
import { useToast } from "../../components/Toast.tsx";
import { localSecond } from "../../lib/audit-display.ts";
import { failureText } from "../../lib/failure.ts";
import { formatLocalDateTime } from "../../lib/master-display.ts";
import { type FieldErrors, SECRET_FIELD_HINTS, secretFormErrors, serverFieldErrors } from "../../lib/secret-form.ts";
import { useLoad } from "../../lib/use-load.ts";

const ENCRYPTION_MISSING_TEXT = "服务器还没有配置数据加密密钥，现在不能在后台填写密钥。请联系技术人员在服务器上配置好以后再来填写。";
const NO_PERMISSION_TEXT = "只有超级管理员可以填写、更换、清空和测试密钥。需要的话，请联系超级管理员。";

/** 每一项「测试一下」要说清楚的事 */
const TEST_NOTES: Readonly<Record<IntegrationSecretKey, string>> = {
  google_maps: "「测试一下」会真的调用一次谷歌地图（查一条东京站到新宿站的路线），每次产生极少量费用，通常在谷歌每月的免费额度内。",
  stripe: "「测试一下」只查一次账户余额，不收钱、不产生费用，也不改任何数据。",
};

/** 清空以后会怎样 */
function clearConsequence(item: IntegrationSecretItem): string {
  if (item.env_configured) return "服务器配置文件里也有这一项，清空后马上改用那里的值。";
  return item.key === "stripe" ? "服务器配置文件里没有这一项，清空后 Stripe 支付就是「未配置」，客人将不能在线付款，直到重新填写。" : "服务器配置文件里没有这一项，清空后谷歌地图就是「未配置」，用到它的功能会停下来，直到重新填写。";
}

/** 现在用的是哪一份：「后台设置（••••1234）」「服务器配置文件（••••5678）」「未配置」 */
function effectiveText(item: IntegrationSecretItem): string {
  if (item.source === "none") return item.source_label;
  const shown = item.masked === null ? item.source_label : `${item.source_label}（${item.masked}）`;
  return item.mode === null ? shown : `${shown} · ${item.mode === "test" ? "测试密钥" : "正式密钥"}`;
}

const PROBLEM_TEXT: Readonly<Record<"UNREADABLE" | "NOT_ALLOWED_IN_ENV", string>> = {
  UNREADABLE: "后台填写的那一份读不出来（服务器的数据加密密钥可能换过），现在没有用它。请重新填写一次。",
  NOT_ALLOWED_IN_ENV: "后台填写的那一份不能在这个环境用（例如测试密钥到了正式环境），现在没有用它。请换成这个环境能用的密钥。",
};

function adminText(admin: NonNullable<IntegrationSecretItem["admin"]>): string {
  if (!admin.configured) return "没有填写";
  const who = admin.updated_by?.name ?? "—";
  const at = admin.updated_at === null ? "—" : formatLocalDateTime(admin.updated_at);
  return `已填写（${who}，${at}）`;
}

type TestOutcome = { kind: "result"; result: IntegrationTestResult } | { kind: "failed"; text: string };

function testFailureText(err: unknown): string {
  if (err instanceof ApiError && err.code === "INTEGRATION_NOT_CONFIGURED") return "这一项现在没有配置，先填写密钥再测试。";
  if (err instanceof ApiError && err.status === 403) return NO_PERMISSION_TEXT;
  if (err instanceof NetworkError) return "没有等到测试结果（网络不通或对方太慢）。请检查网络后再点一次「测试一下」。";
  return failureText(err, "测试");
}

// ───────────── 填写 / 更换 ─────────────

interface FillProblem {
  title: string;
  text: string;
}

function FillDialog({ item, onClose, onSaved, onEncryptionMissing }: { item: IntegrationSecretItem; onClose(): void; onSaved(action: "set" | "replace", item: IntegrationSecretItem): void; onEncryptionMissing(): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const formId = useId();
  const inputs = useRef<Partial<Record<SecretFieldName, HTMLInputElement | null>>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [problem, setProblem] = useState<FillProblem | null>(null);
  const [busy, setBusy] = useState(false);
  const fields = item.fields.map((field) => field.name);
  const replacing = item.admin?.configured === true;
  const verb = replacing ? "更换" : "填写";

  const focusFirst = (found: FieldErrors): void => {
    const first = fields.find((field) => found[field] !== undefined);
    if (first !== undefined) inputs.current[first]?.focus();
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setProblem(null);
    // 值只在这个函数里读一次，直接放进请求体
    const values: Partial<Record<SecretFieldName, string>> = {};
    for (const field of fields) values[field] = (inputs.current[field]?.value ?? "").trim();
    const found = secretFormErrors(item.key, values, fields);
    setErrors(found);
    if (Object.keys(found).length > 0) return focusFirst(found);
    setBusy(true);
    try {
      const saved = await saveIntegrationSecret(token, item.key, values);
      for (const field of fields) {
        const input = inputs.current[field];
        if (input) input.value = "";
      }
      onSaved(saved.action, saved.item);
    } catch (err) {
      if (handleAuthFailure(err)) return;
      const byField = serverFieldErrors(err, fields);
      if (byField !== null) {
        setErrors(byField);
        setProblem({ title: "有几项需要修改", text: "请按每一项下面的说明改好后再保存。" });
        focusFirst(byField);
      } else if (err instanceof ApiError && err.code === "INTEGRATION_ENCRYPTION_NOT_CONFIGURED") {
        setProblem({ title: "现在不能在后台填写", text: ENCRYPTION_MISSING_TEXT });
        onEncryptionMissing();
      } else if (err instanceof ApiError && err.status === 403) {
        setProblem({ title: "没有保存", text: NO_PERMISSION_TEXT });
      } else {
        setProblem({ title: "没有保存", text: failureText(err, "保存") });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      size="form"
      title={`${verb}「${item.label}」的密钥`}
      busy={busy}
      dismissOnBackdrop={false}
      onClose={onClose}
      footer={
        <>
          <Button variant="text" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={busy} loadingText="保存中…">
            保存
          </Button>
        </>
      }
    >
      <form id={formId} className="secret-form" noValidate onSubmit={(event) => void submit(event)}>
        <div role="alert">
          {problem !== null && (
            <Alert kind="danger">
              <strong className="alert__title">{problem.title}</strong>
              <span>{problem.text}</span>
            </Alert>
          )}
        </div>
        <p>
          {item.key === "stripe" ? "Stripe 的三项要一起填。从 Stripe 控制台复制后粘贴到下面。" : "从谷歌云控制台复制密钥后粘贴到下面。"}
          {replacing ? "保存后马上改用新的，原来在后台填写的那一份不再使用。" : "保存后马上生效，不用重启。"}
        </p>
        {fields.map((field, index) => (
          <PasswordField
            key={field}
            ref={(node) => {
              inputs.current[field] = node;
            }}
            noun="密钥"
            label={item.fields[index]?.label ?? field}
            hint={SECRET_FIELD_HINTS[field]}
            errors={errors[field] ?? []}
            readOnly={busy}
            required
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            data-autofocus={index === 0 ? true : undefined}
            onInput={() => {
              if (errors[field] !== undefined) setErrors((current) => ({ ...current, [field]: undefined }));
            }}
          />
        ))}
        <p className="page-intro">密钥会加密保存。保存后页面上只显示末 4 位，任何地方都看不到完整的密钥。</p>
      </form>
    </Dialog>
  );
}

// ───────────── 清空 ─────────────

function ClearDialog({ item, onClose, onCleared }: { item: IntegrationSecretItem; onClose(): void; onCleared(item: IntegrationSecretItem | null): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ text: string; final: boolean } | null>(null);
  const descriptionId = useId();
  const confirm = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const cleared = await clearIntegrationSecret(token, item.key);
      onCleared(cleared.item);
    } catch (err) {
      if (handleAuthFailure(err)) return;
      if (err instanceof ApiError && err.code === "INTEGRATION_SECRET_NOT_SET") setProblem({ text: "后台已经没有填写这一项了（可能刚被别人清空），不用再清空。关掉后页面会显示最新的情况。", final: true });
      else if (err instanceof ApiError && err.status === 403) setProblem({ text: NO_PERMISSION_TEXT, final: true });
      else setProblem({ text: failureText(err, "清空"), final: false });
    } finally {
      setBusy(false);
    }
  };
  const done = problem?.final === true;
  return (
    <Dialog
      open
      title={`清空「${item.label}」在后台填写的密钥？`}
      busy={busy}
      describedBy={descriptionId}
      onClose={done ? () => onCleared(null) : onClose}
      footer={
        <>
          <Button variant={done ? "primary" : "text"} data-autofocus disabled={busy} onClick={done ? () => onCleared(null) : onClose}>
            {done ? "知道了" : "取消"}
          </Button>
          {!done && (
            <Button variant="danger" loading={busy} loadingText="清空中…" onClick={() => void confirm()}>
              清空
            </Button>
          )}
        </>
      }
    >
      <div role="alert">
        {problem !== null && (
          <Alert kind="danger">
            <strong className="alert__title">没有清空</strong>
            <span>{problem.text}</span>
          </Alert>
        )}
      </div>
      <div id={descriptionId}>
        <p>
          <strong>清空后改用服务器配置文件里的值（如果有）。</strong>
          {clearConsequence(item)}
        </p>
        <p className="page-intro">以后随时可以重新填写。</p>
      </div>
    </Dialog>
  );
}

// ───────────── 一项 ─────────────

const fillButtonId = (key: IntegrationSecretKey): string => `integration-secret-fill-${key}`;

function SecretCard({ item, canManage, encryptionReady, encryptionNoteId, onFill, onClear }: { item: IntegrationSecretItem; canManage: boolean; encryptionReady: boolean; encryptionNoteId: string; onFill(): void; onClear(): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const [testing, setTesting] = useState(false);
  const [outcome, setOutcome] = useState<TestOutcome | null>(null);
  // 填写、更换、清空以后，上一次的测试结果说的已经不是现在这一份：收起来
  const version = `${item.source}|${item.masked ?? ""}|${item.admin?.updated_at ?? ""}`;
  const [seen, setSeen] = useState(version);
  if (seen !== version) {
    setSeen(version);
    setOutcome(null);
  }
  const titleId = useId();
  const runTest = async (): Promise<void> => {
    if (testing) return;
    setTesting(true);
    setOutcome(null);
    try {
      setOutcome({ kind: "result", result: await testIntegrationSecret(token, item.key) });
    } catch (err) {
      if (handleAuthFailure(err)) return;
      setOutcome({ kind: "failed", text: testFailureText(err) });
    } finally {
      setTesting(false);
    }
  };
  const configured = item.state === "configured";
  const problem = item.admin?.problem ?? null;
  const adminConfigured = item.admin?.configured === true;
  return (
    <section className="card secret-card" aria-labelledby={titleId}>
      <div className="card__header">
        <h3 className="card__title" id={titleId}>
          {item.label}
        </h3>
        <StatusBadge tone={configured ? "success" : "warning"} label={configured ? "已配置" : "未配置"} />
      </div>
      <dl className="details secret-card__details">
        <div className="details__item">
          <dt>现在用的</dt>
          <dd>{effectiveText(item)}</dd>
        </div>
        {item.admin !== null && (
          <div className="details__item">
            <dt>后台填写的</dt>
            <dd>{adminText(item.admin)}</dd>
          </div>
        )}
        <div className="details__item">
          <dt>服务器配置文件里</dt>
          <dd>{item.env_configured ? "有" : "没有"}</dd>
        </div>
      </dl>
      {problem !== null && (
        <Alert kind="warning">
          <span>{PROBLEM_TEXT[problem]}</span>
        </Alert>
      )}
      {canManage && (
        <div className="secret-card__manage">
          <div className="card__actions">
            <Button id={fillButtonId(item.key)} variant={configured ? "secondary" : "primary"} disabled={!encryptionReady} aria-describedby={encryptionReady ? undefined : encryptionNoteId} onClick={onFill}>
              {adminConfigured ? "更换" : "填写"}
            </Button>
            {configured && (
              <Button loading={testing} loadingText="测试中…" onClick={() => void runTest()}>
                测试一下
              </Button>
            )}
            {adminConfigured && (
              <Button className="button--danger-text" onClick={onClear}>
                清空
              </Button>
            )}
          </div>
          {configured && <p className="field__hint">{TEST_NOTES[item.key]}</p>}
          <div role="status" className="secret-card__result">
            {outcome?.kind === "result" && (
              <div className="secret-test">
                <StatusBadge tone={outcome.result.ok ? "success" : "danger"} label={outcome.result.ok ? "可用" : "不可用"} />
                <span>{outcome.result.ok ? `测的是${outcome.result.source_label}里的那一份。` : outcome.result.message}</span>
                <span className="secret-test__time">{`测试时间 ${localSecond(outcome.result.tested_at)}`}</span>
              </div>
            )}
            {outcome?.kind === "failed" && (
              <Alert kind="danger">
                <strong className="alert__title">没有测试成功</strong>
                <span>{outcome.text}</span>
              </Alert>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// ───────────── 整块 ─────────────

type Open = { kind: "fill"; key: IntegrationSecretKey } | { kind: "clear"; key: IntegrationSecretKey } | null;

/** `onChanged`：填写、清空以后，让页面上方的系统状态表也重新取一次。 */
export function IntegrationSecretsSection({ onChanged }: { onChanged(): void }) {
  const loaded = useLoad<IntegrationSecrets>("integration-secrets", listIntegrationSecrets);
  const toast = useToast();
  const [open, setOpen] = useState<Open>(null);
  /** 清空以后「清空」按钮跟着没有了：对话框关掉、页面更新以后，焦点放到这一项的「填写」上 */
  const [focusFill, setFocusFill] = useState<IntegrationSecretKey | null>(null);
  useEffect(() => {
    if (focusFill === null) return;
    document.getElementById(fillButtonId(focusFill))?.focus();
    setFocusFill(null);
  }, [focusFill]);
  const encryptionNoteId = useId();
  const data = loaded.state.data;

  const replaceItem = (next: IntegrationSecretItem): void => {
    if (data === null) return;
    loaded.set({ ...data, items: data.items.map((item) => (item.key === next.key ? next : item)) });
  };

  let body;
  if (data === null) {
    body =
      loaded.state.status === "loading" ? (
        <Skeleton lines={["medium", "long", "control", "medium", "long", "control"]} label="第三方密钥加载中" />
      ) : loaded.state.status === "forbidden" ? (
        <StateBlock headingLevel="h3" tone="neutral" title="你没有权限查看第三方密钥" description="需要的话，请联系超级管理员。" />
      ) : (
        <StateBlock headingLevel="h3" title="第三方密钥加载失败" description="请检查网络后重试。" action={<Button onClick={loaded.reload}>重试</Button>} />
      );
  } else if (data.items.length === 0) {
    body = <StateBlock headingLevel="h3" tone="neutral" title="没有可以在后台填写的密钥" />;
  } else {
    body = (
      <>
        {data.can_manage && !data.encryption_configured && (
          <div id={encryptionNoteId}>
            <Alert kind="warning">
              <strong className="alert__title">现在不能在后台填写</strong>
              <span>{ENCRYPTION_MISSING_TEXT}</span>
            </Alert>
          </div>
        )}
        {!data.can_manage && <p className="page-intro">{NO_PERMISSION_TEXT}</p>}
        {data.items.map((item) => (
          <SecretCard key={item.key} item={item} canManage={data.can_manage} encryptionReady={data.encryption_configured} encryptionNoteId={encryptionNoteId} onFill={() => setOpen({ kind: "fill", key: item.key })} onClear={() => setOpen({ kind: "clear", key: item.key })} />
        ))}
      </>
    );
  }

  const target = open === null || data === null ? null : (data.items.find((item) => item.key === open.key) ?? null);
  return (
    <section className="secret-section" aria-labelledby="integration-secrets-title">
      <h2 className="secret-section__title" id="integration-secrets-title">
        第三方密钥
      </h2>
      <p className="page-intro">
        {data !== null && (
          <>
            <strong>{`哪一份生效：${data.precedence_note}`}</strong>{" "}
          </>
        )}
        谷歌地图和 Stripe 支付的密钥可以在这里直接填写，保存后马上生效，不用重启。页面上只显示末 4 位。
      </p>
      {body}
      {target !== null && open?.kind === "fill" && (
        <FillDialog
          item={target}
          onClose={() => setOpen(null)}
          onEncryptionMissing={() => data !== null && loaded.set({ ...data, encryption_configured: false })}
          onSaved={(action, saved) => {
            setOpen(null);
            replaceItem(saved);
            toast(`已${action === "replace" ? "更换" : "填写"}「${saved.label}」的密钥`);
            onChanged();
          }}
        />
      )}
      {target !== null && open?.kind === "clear" && (
        <ClearDialog
          item={target}
          onClose={() => setOpen(null)}
          onCleared={(cleared) => {
            setOpen(null);
            if (cleared === null) {
              loaded.reload();
              return;
            }
            replaceItem(cleared);
            toast(`已清空「${cleared.label}」在后台填写的密钥`);
            onChanged();
            setFocusFill(cleared.key);
          }}
        />
      )}
    </section>
  );
}
