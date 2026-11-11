/**
 * 运营后台「系统设置 → 官网设置」（M8-21，ADR 0076；规范 docs/design/pages/platform-settings.md 第 9 节）。
 * 两项：客服 WhatsApp 号码（官网报不出价时的「通过 WhatsApp 联系我们」用它；清空就不显示按钮）；
 * 页面宽度（M8-28，ADR 0079）：官网所有页面的内容最宽多少，标准 / 较宽 / 最宽三档，手机、平板不受影响。
 * - 看（`site_settings.read`）：超级管理员、运营、客服；
 * - 改（`site_settings.manage`）：只归超级管理员（号码被换掉，客人就会把行程发给别人）。别人看到的是只读的号码和这句说明。
 * 已经设置过的带版本号保存（If-Match），被别人改过时刷新再说。
 */
import { whatsappDigits } from "@nozomi/domain";
import { type FormEvent, type ReactNode, useState } from "react";
import { ApiError } from "../../api/client.ts";
import { type SiteSettings, getSiteSettings, updateSiteSettings } from "../../api/manual-quotes.ts";
import { SITE_PAGE_WIDTHS, type SitePageWidth } from "../../api/site.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button } from "../../components/Button.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { TextField } from "../../components/TextField.tsx";
import { useToast } from "../../components/Toast.tsx";
import { WhatsappLink } from "../../components/WhatsappLink.tsx";
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
    <WhatsappLink digits={digits} text="您好">
      在 WhatsApp 里打开看看
    </WhatsappLink>
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

/** 页面宽度的三档（M8-28）：名称和一句说明。 */
export const PAGE_WIDTH_TEXT: Readonly<Record<SitePageWidth, { name: string; help: string }>> = {
  standard: { name: "标准", help: "内容最宽约 1200 像素，适合多数电脑屏幕（默认）" },
  wide: { name: "较宽", help: "内容最宽约 1440 像素，大屏幕上表单更宽" },
  full: { name: "最宽", help: "接近全屏，两侧留边，最宽约 1920 像素" },
};

function WidthEditor({ settings, onSaved, onReload }: { settings: SiteSettings; onSaved(next: SiteSettings): void; onReload(): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const [width, setWidth] = useState<SitePageWidth>(settings.page_width ?? "standard");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setProblem(null);
    setBusy(true);
    try {
      // 号码原样带回去（接口要求有这一项），只改宽度
      const saved = await updateSiteSettings(token, settings.version, settings.support_whatsapp, width);
      onSaved(saved);
      toast(`已保存，官网页面宽度改为「${PAGE_WIDTH_TEXT[saved.page_width ?? width].name}」，客人刷新页面后生效`);
    } catch (err) {
      if (handleAuthFailure(err)) return;
      if (err instanceof ApiError && err.code === "VERSION_CONFLICT") {
        setProblem("官网设置刚被别人改过，页面已刷新成最新的样子。请看过再改。");
        onReload();
      } else setProblem(`${failureText(err, "保存")}选的宽度还在，可以再点一次「保存」。`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="form" noValidate onSubmit={(event) => void save(event)}>
      <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
      <fieldset className="field fieldset">
        <legend className="field__label">页面宽度</legend>
        <div className="choices choices--stacked">
          {SITE_PAGE_WIDTHS.map((value) => (
            <label key={value} className="choice">
              <input type="radio" name="site-page-width" value={value} checked={width === value} aria-describedby={`site-page-width-${value}`} onChange={() => setWidth(value)} />
              <span className="choice__text">
                {PAGE_WIDTH_TEXT[value].name}
                <span className="choice__hint" id={`site-page-width-${value}`}>
                  {PAGE_WIDTH_TEXT[value].help}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
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
      <section className="card" aria-labelledby="site-settings-width">
        <h2 className="card__title" id="site-settings-width">
          页面宽度
        </h2>
        <p className="table__muted">官网所有页面（首页、预订、下单、订单页）的内容最宽多少。只影响电脑屏幕；手机和平板始终是单栏，不受这个设置影响。</p>
        <div className="form">
          {canManage ? (
            <WidthEditor key={`width-${settings.version}`} settings={settings} onSaved={set} onReload={reload} />
          ) : (
            <>
              <dl className="details">
                <Detail label="页面宽度">{`${PAGE_WIDTH_TEXT[settings.page_width ?? "standard"].name}（${PAGE_WIDTH_TEXT[settings.page_width ?? "standard"].help}）`}</Detail>
              </dl>
              <p className="table__muted">只有超级管理员能改页面宽度。</p>
            </>
          )}
        </div>
      </section>
    </>,
  );
}
