/**
 * 运营后台「官网设置」里的「法律页面」一块（M9E-24，ADR 0107）：特定商取引法に基づく表記・キャンセルポリシー・プライバシーポリシー
 * 三页里业主定稿留空的几项。没填的在页面上显示「未設定」；正式站上线前要填齐（/health 的 legal_pages 为 complete）。
 * 权限同官网设置：`site_settings.read` 能看，`site_settings.manage`（只归超级管理员）能改；整份保存，带版本号。
 */
import { type FormEvent, useState } from "react";
import { ApiError } from "../../api/client.ts";
import { type LegalPageSettings, type LegalPageSettingsInput, getLegalPageSettings, saveLegalPageSettings } from "../../api/legal-pages.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { Button } from "../../components/Button.tsx";
import { NewTabLink } from "../../components/NewTabLink.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { TextField } from "../../components/TextField.tsx";
import { useToast } from "../../components/Toast.tsx";
import { failureText } from "../../lib/failure.ts";
import { LEGAL_LINKS } from "../../lib/legal-pages.ts";
import { useLoad } from "../../lib/use-load.ts";
import { Detail, LocalTime } from "./order-center-parts.tsx";

type FieldKey = keyof LegalPageSettingsInput;

/** 每一项：标签、在哪一页用、长度上限（和后端一致） */
const FIELDS: readonly { key: FieldKey; label: string; hint: string; max: number; type?: "email" | "date" }[] = [
  { key: "seller", label: "販売事業者名", hint: "特定商取引法表記的「販売事業者」和プライバシーポリシー开头的「当社」，例如 RELAX CAR SERVICE CO. LIMITED（営業名：Relax Airport Taxi）", max: 200 },
  { key: "japan_contact", label: "日本国内の連絡先", hint: "日本国内的住址和电话；或写「請求があった場合は遅滞なく開示します」", max: 300 },
  { key: "email", label: "メールアドレス", hint: "特定商取引法表記和プライバシーポリシー「開示・訂正・削除」共用", max: 254, type: "email" },
  { key: "mail_provider", label: "メール配信事業者", hint: "发预约确认邮件的服务商名称", max: 100 },
  { key: "mail_provider_country", label: "メール配信事業者の所在国", hint: "例如 米国", max: 40 },
  { key: "map_provider", label: "地図表示事業者", hint: "页面上显示地图的服务商名称", max: 100 },
  { key: "map_provider_country", label: "地図表示事業者の所在国", hint: "例如 米国", max: 40 },
  { key: "server_provider", label: "サーバー事業者", hint: "放系统和数据的服务器商名称", max: 100 },
  { key: "server_provider_country", label: "サーバー事業者の所在国", hint: "例如 日本", max: 40 },
  { key: "published_on", label: "プライバシーポリシーの制定日", hint: "公开那一天", max: 10, type: "date" },
];

function inputOf(settings: LegalPageSettings): LegalPageSettingsInput {
  return {
    seller: settings.seller,
    japan_contact: settings.japan_contact,
    email: settings.email,
    mail_provider: settings.mail_provider.name,
    mail_provider_country: settings.mail_provider.country,
    map_provider: settings.map_provider.name,
    map_provider_country: settings.map_provider.country,
    server_provider: settings.server_provider.name,
    server_provider_country: settings.server_provider.country,
    published_on: settings.published_on,
  };
}

/** 还有几项没填 */
export function legalMissingCount(input: LegalPageSettingsInput): number {
  return Object.values(input).filter((value) => value === null).length;
}

function MissingNote({ input }: { input: LegalPageSettingsInput }) {
  const missing = legalMissingCount(input);
  return missing === 0 ? (
    <Alert kind="success">都填好了。</Alert>
  ) : (
    <Alert kind="warning">{`还有 ${missing} 项没填，页面上这几处显示「未設定」。正式站上线前要填齐。`}</Alert>
  );
}

function Editor({ settings, onSaved, onReload }: { settings: LegalPageSettings; onSaved(next: LegalPageSettings): void; onReload(): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const [values, setValues] = useState<Record<FieldKey, string>>(() => {
    const input = inputOf(settings);
    return Object.fromEntries(FIELDS.map((field) => [field.key, input[field.key] ?? ""])) as Record<FieldKey, string>;
  });
  const [problem, setProblem] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [busy, setBusy] = useState(false);
  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    const input = Object.fromEntries(FIELDS.map((field) => [field.key, values[field.key].trim() === "" ? null : values[field.key].trim()])) as LegalPageSettingsInput;
    const found: Partial<Record<FieldKey, string>> = {};
    for (const field of FIELDS) {
      const value = input[field.key];
      if (value !== null && [...value].length > field.max) found[field.key] = `最多 ${field.max} 个字`;
    }
    if (input.email !== null && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email)) found.email = "请填写邮箱地址，例如 support@example.com";
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setProblem(null);
    setBusy(true);
    try {
      const saved = await saveLegalPageSettings(token, settings.version, input);
      onSaved(saved);
      toast(saved.complete ? "已保存，法律页面都填好了" : "已保存");
    } catch (err) {
      if (handleAuthFailure(err)) return;
      if (err instanceof ApiError && err.code === "VERSION_CONFLICT") {
        setProblem("刚被别人改过，页面已刷新成最新的样子。请看过再改。");
        onReload();
      } else setProblem(`${failureText(err, "保存")}填的内容还在。`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="form" noValidate onSubmit={(event) => void save(event)}>
      <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
      {FIELDS.map((field) => (
        <TextField
          key={field.key}
          label={field.label}
          type={field.type ?? "text"}
          autoComplete="off"
          maxLength={field.max * 2}
          value={values[field.key]}
          errors={errors[field.key] === undefined ? [] : [errors[field.key] as string]}
          hint={field.hint}
          onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
        />
      ))}
      <div className="form__actions">
        <Button type="submit" variant="primary" loading={busy} loadingText="保存中…">
          保存法律页面
        </Button>
      </div>
    </form>
  );
}

export function LegalPageSettingsCard({ canManage }: { canManage: boolean }) {
  const { state, reload, set } = useLoad<LegalPageSettings>("legal-page-settings", getLegalPageSettings);
  const settings = state.data;
  return (
    <section className="card" aria-labelledby="site-settings-legal">
      <h2 className="card__title" id="site-settings-legal">
        法律页面
      </h2>
      <p className="table__muted">
        特定商取引法に基づく表記・キャンセルポリシー・プライバシーポリシー三页（日文）的正文按业主定稿，这里只填定稿里留空的几项。取消费表按「取消政策」自动生成，不用在这里填。
      </p>
      <p className="legal-links">
        {LEGAL_LINKS.map((link) => (
          <NewTabLink key={link.key} to={link.to}>
            {link.label}
          </NewTabLink>
        ))}
      </p>
      {settings === null ? (
        state.status === "loading" ? (
          <Skeleton lines={["long", "control", "control"]} />
        ) : (
          <StateBlock title="法律页面设置没有加载出来" description="请检查网络后重试。" action={<Button variant="secondary" onClick={reload}>重试</Button>} />
        )
      ) : (
        <div className="form">
          <MissingNote input={inputOf(settings)} />
          {canManage ? (
            <Editor key={settings.version} settings={settings} onSaved={set} onReload={reload} />
          ) : (
            <>
              <dl className="details">
                {FIELDS.map((field) => (
                  <Detail key={field.key} label={field.label}>
                    {inputOf(settings)[field.key] ?? "未設定"}
                  </Detail>
                ))}
              </dl>
              <p className="table__muted">只有超级管理员能改这几项。</p>
            </>
          )}
          <dl className="details">
            <Detail label="最后修改">
              {settings.version === 0 ? (
                "这几项还没有填过"
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
