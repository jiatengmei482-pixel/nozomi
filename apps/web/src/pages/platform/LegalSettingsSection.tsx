/**
 * 运营后台「官网设置」里的「法律文案的待补项」（M9E-24，ADR 0107）：三份日文法律文案（特商法表記、キャンセルポリシー、プライバシーポリシー）
 * 稿子里【 】的 10 项，按 domain `LEGAL_FIELDS` 的顺序、标签和「用在哪里」显示。
 * - 顶部写还缺几项、缺哪几项；正式环境（`required_for_launch`）没填齐时用错误色说明官网不开放预订；测试站说明页面上显示「未設定」。
 * - 改（`site_settings.manage`，只有超级管理员）：10 项一起保存，空着的当没填；已经设置过的带版本号（If-Match），被别人改过时刷新再说。别人只读。
 * - 三个页面的预览链接（新标签页）。
 */
import { LEGAL_FIELDS, type LegalFieldIssueReason, type LegalFieldKey, type LegalFieldSpec, legalFieldIssues } from "@nozomi/domain";
import { type FormEvent, useState } from "react";
import { ApiError } from "../../api/client.ts";
import { type LegalFieldValues, type LegalSettings, getLegalSettings, updateLegalSettings } from "../../api/legal.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { Button } from "../../components/Button.tsx";
import { NewTabLink } from "../../components/NewTabLink.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { TextAreaField } from "../../components/TextAreaField.tsx";
import { TextField } from "../../components/TextField.tsx";
import { useToast } from "../../components/Toast.tsx";
import { failureText } from "../../lib/failure.ts";
import { LEGAL_PAGE_LINKS } from "../../lib/legal-display.ts";
import { useLoad } from "../../lib/use-load.ts";
import { Detail, LocalTime } from "./order-center-parts.tsx";

const HEADING_ID = "site-settings-legal";

/** 一项填得不对时的说法（前端先查一遍，后端 400 的 issues 也用这张表） */
export function legalIssueText(reason: string, spec: LegalFieldSpec | undefined): string {
  switch (reason as LegalFieldIssueReason) {
    case "TOO_LONG":
      return `太长了：最多 ${spec?.maxLength ?? ""} 个字，请删短一些`;
    case "EMAIL_INVALID":
      return "邮箱的格式不对，请填完整的邮箱，如 support@example.com";
    case "DATE_INVALID":
      return "日期不对，请用日期选择器选一天";
    default:
      return "这一项的内容不对，请检查后重试";
  }
}

const specOf = (key: string): LegalFieldSpec | undefined => LEGAL_FIELDS.find((field) => field.key === key);
const labelOf = (key: LegalFieldKey): string => specOf(key)?.label ?? key;

type Texts = Record<LegalFieldKey, string>;
type Errors = Partial<Record<LegalFieldKey, string>>;

function textsOf(fields: LegalFieldValues): Texts {
  return Object.fromEntries(LEGAL_FIELDS.map((field) => [field.key, fields[field.key] ?? ""])) as Texts;
}

/** 提交的 10 项：空着（只有空白）的是 null */
function valuesOf(texts: Texts): LegalFieldValues {
  return Object.fromEntries(LEGAL_FIELDS.map((field) => [field.key, texts[field.key].trim() === "" ? null : texts[field.key]])) as LegalFieldValues;
}

const CONFLICT_TEXT = "法律文案的待补项刚被别人改过，页面已刷新成最新的样子。请看过再改。";

/** `onConflict`：被别人改过（409）。提示放在外层：刷新后版本号变了，编辑器会按新内容重建。 */
function Editor({ settings, onSaved, onConflict }: { settings: LegalSettings; onSaved(next: LegalSettings): void; onConflict(): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const [texts, setTexts] = useState<Texts>(() => textsOf(settings.fields));
  const [errors, setErrors] = useState<Errors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    const values = valuesOf(texts);
    const local: Errors = {};
    for (const issue of legalFieldIssues(values)) local[issue.key as LegalFieldKey] = legalIssueText(issue.reason, specOf(issue.key));
    setErrors(local);
    setProblem(null);
    if (Object.keys(local).length > 0) return;
    setBusy(true);
    try {
      const saved = await updateLegalSettings(token, settings.version, values);
      onSaved(saved);
      toast(saved.complete ? "已保存，法律文案的待补项都填齐了" : `已保存，还缺 ${saved.missing.length} 项`);
    } catch (err) {
      if (handleAuthFailure(err)) return;
      if (err instanceof ApiError && err.code === "VERSION_CONFLICT") {
        onConflict();
      } else if (err instanceof ApiError && err.code === "VALIDATION_FAILED") {
        const issues = (Array.isArray(err.details["issues"]) ? err.details["issues"] : []) as { path?: unknown; reason?: unknown }[];
        const mapped: Errors = {};
        for (const issue of issues) {
          const key = typeof issue.path === "string" ? issue.path.replace(/^\/fields\//, "") : "";
          const spec = specOf(key);
          if (spec !== undefined) mapped[spec.key] = legalIssueText(typeof issue.reason === "string" ? issue.reason : "", spec);
        }
        setErrors(mapped);
        setProblem(Object.keys(mapped).length === 0 ? `${failureText(err, "保存")}填的内容还在。` : "有几项填得不对，请看各项下面的说明。填的内容还在。");
      } else setProblem(`${failureText(err, "保存")}填的内容还在。`);
    } finally {
      setBusy(false);
    }
  };
  const change = (key: LegalFieldKey, value: string): void => setTexts((current) => ({ ...current, [key]: value }));
  return (
    <form className="form" noValidate onSubmit={(event) => void save(event)}>
      <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
      {LEGAL_FIELDS.map((field) => {
        const common = { label: field.label, hint: `用在：${field.usedIn}`, maxLength: field.maxLength, value: texts[field.key], errors: errors[field.key] === undefined ? [] : [errors[field.key] as string] };
        if (field.format === "multiline") return <TextAreaField key={field.key} {...common} rows={3} onChange={(event) => change(field.key, event.target.value)} />;
        return <TextField key={field.key} {...common} lang={field.format === "text" ? "ja" : undefined} type={field.format === "email" ? "email" : field.format === "date" ? "date" : "text"} autoComplete="off" onChange={(event) => change(field.key, event.target.value)} />;
      })}
      <div className="form__actions">
        <Button type="submit" variant="primary" loading={busy} loadingText="保存中…">
          保存
        </Button>
      </div>
    </form>
  );
}

function Status({ settings }: { settings: LegalSettings }) {
  const missing = settings.missing.map(labelOf);
  return (
    <>
      <p>{missing.length === 0 ? `${LEGAL_FIELDS.length} 项都已填写。` : `还缺 ${missing.length} 项：${missing.join("、")}`}</p>
      {settings.required_for_launch ? (
        settings.complete ? (
          <p className="table__muted">正式环境：都已填齐，不影响官网开放预订。</p>
        ) : (
          <Alert kind="danger">正式环境：没填齐前官网不开放预订。请超级管理员把缺的几项填好。</Alert>
        )
      ) : (
        <p className="table__muted">测试站：没填的地方页面显示「未設定」，官网照常开放。</p>
      )}
    </>
  );
}

export function LegalSettingsSection({ canManage }: { canManage: boolean }) {
  const { state, reload, set } = useLoad<LegalSettings>("legal-settings", getLegalSettings);
  const [conflict, setConflict] = useState(false);
  const settings = state.data;
  return (
    <section className="card" aria-labelledby={HEADING_ID}>
      <h2 className="card__title" id={HEADING_ID}>
        法律文案的待补项
      </h2>
      <p className="table__muted">官网的三份日文法律文案（特定商取引法に基づく表記、キャンセルポリシー、プライバシーポリシー）里要填的几处。正文由业主定稿，这里只填空着的地方。</p>
      {settings === null ? (
        state.status === "error" ? (
          <StateBlock headingLevel="h3" title="法律文案的待补项没有加载出来" description="请检查网络后重试。" action={<Button variant="secondary" onClick={reload}>重试</Button>} />
        ) : (
          <Skeleton lines={["medium", "control", "control", "short"]} />
        )
      ) : (
        <div className="form">
          <Status settings={settings} />
          {canManage ? (
            <>
              <div role="alert">{conflict && <Alert kind="danger">{CONFLICT_TEXT}</Alert>}</div>
              <Editor
                key={`legal-${settings.version}`}
                settings={settings}
                onSaved={(next) => {
                  setConflict(false);
                  set(next);
                }}
                onConflict={() => {
                  setConflict(true);
                  reload();
                }}
              />
            </>
          ) : (
            <>
              <dl className="details">
                {LEGAL_FIELDS.map((field) => (
                  <Detail key={field.key} label={field.label}>
                    {settings.fields[field.key] === null ? "还没有填" : <span className="legal-multiline">{settings.fields[field.key]}</span>}
                  </Detail>
                ))}
              </dl>
              <p className="table__muted">只有超级管理员能改法律文案的待补项。</p>
            </>
          )}
          <dl className="details">
            <Detail label="看看页面">
              <span className="legal-links">
                {LEGAL_PAGE_LINKS.map((page) => (
                  <NewTabLink key={page.path} to={page.path}>
                    <span lang="ja">{page.title}</span>
                  </NewTabLink>
                ))}
              </span>
            </Detail>
            <Detail label="最后修改">
              {settings.version === 0 ? (
                "还没有设置过"
              ) : (
                <>
                  <LocalTime iso={settings.updated_at} />
                  {settings.updated_by === null ? "" : ` · ${settings.updated_by.name}`}
                </>
              )}
            </Detail>
          </dl>
        </div>
      )}
    </section>
  );
}
