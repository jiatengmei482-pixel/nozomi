/**
 * 运营后台「系统设置 → 官网设置」（M8-21，ADR 0076；规范 docs/design/pages/platform-settings.md 第 9 节）。
 * 现在只有一项：客服 WhatsApp 号码。官网报不出价时的「通过 WhatsApp 联系我们」用它；清空就不显示按钮。
 * - 看（`site_settings.read`）：超级管理员、运营、客服；
 * - 改（`site_settings.manage`）：只归超级管理员（号码被换掉，客人就会把行程发给别人）。别人看到的是只读的号码和这句说明。
 * 已经设置过的带版本号保存（If-Match），被别人改过时刷新再说。
 */
import { whatsappDigits } from "@nozomi/domain";
import { type FormEvent, type ReactNode, useState } from "react";
import { ApiError } from "../../api/client.ts";
import { type SiteSettings, getSiteSettings, updateSiteSettings } from "../../api/manual-quotes.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button } from "../../components/Button.tsx";
import { Icon } from "../../components/Icon.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { TextField } from "../../components/TextField.tsx";
import { useToast } from "../../components/Toast.tsx";
import { failureText } from "../../lib/failure.ts";
import { SUPPORT_WHATSAPP_HINT, SUPPORT_WHATSAPP_INVALID, supportWhatsappText } from "../../lib/manual-quote-display.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan } from "../../lib/use-master-access.ts";
import { Detail, LocalTime, NO_ACCESS } from "./order-center-parts.tsx";

const TRAIL = [{ label: "系统设置" }];

/** 号码去 wa.me 看一眼：确认是客服的号、WhatsApp 打得开。 */
function TryLink({ digits }: { digits: string }) {
  return (
    <a className="link" href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer">
      在 WhatsApp 里打开看看
      <Icon name="external" />
      <span className="visually-hidden">（在新标签页打开）</span>
    </a>
  );
}

function Editor({ settings, onSaved, onReload }: { settings: SiteSettings; onSaved(next: SiteSettings): void; onReload(): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const [text, setText] = useState(settings.support_whatsapp === null ? "" : supportWhatsappText(settings.support_whatsapp));
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    const value = text.trim();
    const digits = value === "" ? null : whatsappDigits(value, { requirePlus: false });
    if (value !== "" && digits === null) {
      setError(SUPPORT_WHATSAPP_INVALID);
      return;
    }
    setError(null);
    setProblem(null);
    setBusy(true);
    try {
      const saved = await updateSiteSettings(token, settings.version, value === "" ? null : value);
      onSaved(saved);
      toast(saved.support_whatsapp === null ? "已清空，官网不再显示 WhatsApp 按钮" : "已保存，官网的 WhatsApp 按钮用这个号码");
    } catch (err) {
      if (handleAuthFailure(err)) return;
      if (err instanceof ApiError && err.code === "VERSION_CONFLICT") {
        setProblem("号码刚被别人改过，页面已刷新成最新的样子。请看过再改。");
        onReload();
      } else if (err instanceof ApiError && err.code === "VALIDATION_FAILED") setError(SUPPORT_WHATSAPP_INVALID);
      else setProblem(`${failureText(err, "保存")}填的内容还在。`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="form" noValidate onSubmit={(event) => void save(event)}>
      <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
      <TextField label="客服 WhatsApp 号码" type="tel" inputMode="tel" autoComplete="off" maxLength={60} value={text} errors={error === null ? [] : [error]} hint={SUPPORT_WHATSAPP_HINT} onChange={(event) => setText(event.target.value)} />
      <div className="form__actions">
        <Button type="submit" variant="primary" loading={busy} loadingText="保存中…">
          保存
        </Button>
      </div>
    </form>
  );
}

export function SiteSettingsPage() {
  const { portal, account } = usePortalSession();
  useDocumentTitle(`官网设置 · NOZOMI ${portal.name}`);
  const canRead = usePlatformCan("site_settings.read");
  const canManage = usePlatformCan("site_settings.manage");
  const { state, reload, set } = useLoad<SiteSettings>("site-settings", canRead ? getSiteSettings : null);
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="官网设置" trail={TRAIL}>
      <Page title="官网设置" width="form">
        {content}
      </Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);
  const settings = state.data;
  if (settings === null) {
    return shell(state.status === "error" ? <StateBlock title="官网设置没有加载出来" description="请检查网络后重试。" action={<Button variant="secondary" onClick={reload}>重试</Button>} /> : <Skeleton lines={["long", "control", "short"]} />);
  }
  const digits = settings.support_whatsapp;
  return shell(
    <>
      <p className="page__lead">官网一家供应商都报不出价时，客人除了留下联系方式，还可以点「通过 WhatsApp 联系我们」，直接把行程发给这个号码。</p>
      <section className="card" aria-labelledby="site-settings-whatsapp">
        <h2 className="card__title" id="site-settings-whatsapp">
          客服 WhatsApp
        </h2>
        <div className="form">
          {canManage ? (
            <Editor key={settings.version} settings={settings} onSaved={set} onReload={reload} />
          ) : (
            <>
              <dl className="details">
                <Detail label="客服 WhatsApp 号码">{digits === null ? "还没有设置（官网不显示 WhatsApp 按钮）" : supportWhatsappText(digits)}</Detail>
              </dl>
              <p className="table__muted">只有超级管理员能改这个号码：号码填错或被换掉，客人就会把行程发给别人。</p>
            </>
          )}
          <dl className="details">
            {digits !== null && <Detail label="试一下"><TryLink digits={digits} /></Detail>}
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
      </section>
    </>,
  );
}
