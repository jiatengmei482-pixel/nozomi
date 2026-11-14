/**
 * 运营后台「嵌入组件」（M9E-02，ADR 0090）：给合作网站生成嵌入码、管理域名白名单、复制要放的代码。
 * - 看（`embed.read`）：超级管理员、运营、渠道经理、只读；新建、修改、停用（`embed.manage`）：超级管理员、运营、渠道经理。
 * - 嵌入码是公开标识，写在合作网站页面里，不是密钥；改不了，要换就停用后新建。
 * - 外观（M9E-10、M9E-14）：自动（默认）/ 卡片 / 横条；组件从 /embed/v1/config 取，不写进要放的代码；合作网站在 init 里写了 layout 的以它为准。
 * - 白名单一行一个网站地址（`https://域名`，可带端口，不带路径）；改了在服务端立即生效，合作网站页面上最迟 60 秒。
 * - 合作网站如果设了内容安全策略，要在 `script-src`、`connect-src` 放行主站域名（代码下面写明）。
 * - 允许整页嵌入（M9E-16，ADR 0095 Q13）：默认关；打开后合作网站可以把整个预订流程（/embed/book）嵌在自己的页面里，只限白名单里的网站。
 *   和其他字段一起保存（同一个 If-Match 版本号、同一条审计）。
 */
import { type FormEvent, type ReactNode, useState } from "react";
import { ApiError } from "../../api/client.ts";
import { type EmbedKey, type EmbedKeyWrite, type EmbedLang, type EmbedLayout, type EmbedService, createEmbedKey, listEmbedKeys, updateEmbedKey } from "../../api/embed.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { CheckboxGroup, CopyButton, RadioGroup } from "../../components/FormFields.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { TextAreaField } from "../../components/TextAreaField.tsx";
import { TextField } from "../../components/TextField.tsx";
import { useToast } from "../../components/Toast.tsx";
import { failureText } from "../../lib/failure.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan } from "../../lib/use-master-access.ts";
import { Detail, LocalTime, NO_ACCESS } from "./order-center-parts.tsx";

export const EMBED_KEYS_PAGE = "/platform/embed-keys";

export const EMBED_LANG_NAMES: Readonly<Record<EmbedLang, string>> = { zh: "中文", ja: "日文", en: "英文" };
export const EMBED_SERVICE_NAMES: Readonly<Record<EmbedService, string>> = { transfer: "区间", charter: "包车" };
export const EMBED_LAYOUT_NAMES: Readonly<Record<EmbedLayout, string>> = { auto: "自动", card: "卡片", bar: "横条" };
const LAYOUT_OPTIONS = (["auto", "card", "bar"] as const).map((value) => ({ value, label: EMBED_LAYOUT_NAMES[value] }));
export const HOST_PAGE_NAMES: Readonly<Record<"off" | "on", string>> = { off: "不允许（客人跳到主站预订）", on: "允许（预订流程嵌在合作网站页面里）" };
const HOST_PAGE_OPTIONS = (["off", "on"] as const).map((value) => ({ value, label: HOST_PAGE_NAMES[value] }));
const HOST_PAGE_HINT = "打开后，白名单里的网站可以用 NozomiBooking.mountBooking 把整个预订流程嵌在自己的页面里（ADR 0095）；关掉后下一次打开就嵌不进去。";
const LANG_OPTIONS = (["ja", "zh", "en"] as const).map((value) => ({ value, label: EMBED_LANG_NAMES[value] }));
const SERVICE_OPTIONS = (["transfer", "charter"] as const).map((value) => ({ value, label: EMBED_SERVICE_NAMES[value] }));
const ORIGINS_HINT = "一行一个合作网站的地址，以 https 开头、只写到域名（可带端口），不带路径；不支持 *。最多 20 个。";
const CSP_NOTE = "合作网站如果设了内容安全策略（CSP），要在 script-src 和 connect-src 里放行主站域名，否则组件加载不出来。";

interface Draft {
  name: string;
  origins: string;
  lang: EmbedLang;
  services: EmbedService[];
  layout: EmbedLayout;
  allowHostPage: boolean;
  note: string;
}

const draftOf = (key: EmbedKey | null): Draft =>
  key === null
    ? { name: "", origins: "", lang: "ja", services: ["transfer", "charter"], layout: "auto", allowHostPage: false, note: "" }
    : { name: key.name, origins: key.allowed_origins.join("\n"), lang: key.default_lang, services: [...key.default_services], layout: key.layout, allowHostPage: key.allow_host_page, note: key.note ?? "" };

const bodyOf = (draft: Draft): EmbedKeyWrite => ({
  name: draft.name.trim(),
  allowed_origins: draft.origins.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== ""),
  default_lang: draft.lang,
  // 按「区间、包车」的固定顺序
  default_services: SERVICE_OPTIONS.map((option) => option.value).filter((value) => draft.services.includes(value)),
  layout: draft.layout,
  allow_host_page: draft.allowHostPage,
  note: draft.note.trim() === "" ? null : draft.note.trim(),
});

type FieldErrors = Partial<Record<"name" | "origins" | "services" | "note", string>>;

/** 服务端的校验问题 → 各栏的说法 */
function errorsOf(err: unknown): FieldErrors | null {
  if (!(err instanceof ApiError) || err.code !== "VALIDATION_FAILED") return null;
  const issues = ((err.details as { issues?: { path: string; reason?: string }[] }).issues ?? []) as { path: string; reason?: string }[];
  const found: FieldErrors = {};
  for (const issue of issues) {
    if (issue.path === "/name") found.name = "请填名称，最多 60 个字";
    else if (issue.path.startsWith("/allowed_origins")) {
      const index = Number(issue.path.split("/")[2]);
      found.origins = Number.isInteger(index) ? `第 ${index + 1} 行${issue.reason === "DUPLICATE" ? "和前面的重复了" : "写法不对：要以 https 开头、只写到域名，可带端口，不带路径"}` : "请填 1–20 个网站地址";
    } else if (issue.path === "/default_services") found.services = "至少选一个";
    else if (issue.path === "/note") found.note = "备注最多 500 个字";
  }
  return found;
}

function KeyForm({ initial, submitLabel, onSubmit, onCancel }: { initial: EmbedKey | null; submitLabel: string; onSubmit(body: EmbedKeyWrite): Promise<void>; onCancel(): void }) {
  const { handleAuthFailure } = usePortalSession();
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    const body = bodyOf(draft);
    const found: FieldErrors = {};
    if (body.name === "") found.name = "请填名称";
    if (body.allowed_origins.length === 0) found.origins = "至少填一个网站地址";
    if (body.default_services.length === 0) found.services = "至少选一个";
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setProblem(null);
    setBusy(true);
    try {
      await onSubmit(body);
    } catch (err) {
      if (handleAuthFailure(err)) return;
      const fields = errorsOf(err);
      if (fields !== null) setErrors(fields);
      else if (err instanceof ApiError && err.code === "VERSION_CONFLICT") setProblem("这个嵌入码刚被别人改过。请刷新页面看过再改。");
      else setProblem(`${failureText(err, "保存")}填的内容还在。`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="form" noValidate onSubmit={(event) => void save(event)}>
      <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
      <TextField label="名称" required maxLength={60} value={draft.name} errors={errors.name === undefined ? [] : [errors.name]} hint="给自己看的，如「MoveGlobal 官网」" onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
      <TextAreaField label="允许的网站" required rows={3} value={draft.origins} errors={errors.origins === undefined ? [] : [errors.origins]} hint={ORIGINS_HINT} onChange={(event) => setDraft({ ...draft, origins: event.target.value })} />
      <RadioGroup legend="默认语言" name={`embed-lang-${initial?.id ?? "new"}`} options={LANG_OPTIONS} value={draft.lang} onChange={(lang) => setDraft({ ...draft, lang })} />
      <CheckboxGroup legend="默认标签" name={`embed-services-${initial?.id ?? "new"}`} options={SERVICE_OPTIONS} value={draft.services} errors={errors.services === undefined ? [] : [errors.services]} hint="合作网站放代码时可以另外指定" onChange={(services) => setDraft({ ...draft, services })} />
      <RadioGroup legend="外观" name={`embed-layout-${initial?.id ?? "new"}`} options={LAYOUT_OPTIONS} value={draft.layout} hint="自动：组件所在区域宽 900 px 以上显示横条，窄了（侧栏、手机）显示卡片。保存后合作网站的页面最迟约 1 分钟生效；合作网站代码里写了 layout 的以代码为准" onChange={(layout) => setDraft({ ...draft, layout })} />
      <RadioGroup legend="整页嵌入" name={`embed-host-page-${initial?.id ?? "new"}`} options={HOST_PAGE_OPTIONS} value={draft.allowHostPage ? "on" : "off"} hint={HOST_PAGE_HINT} onChange={(value) => setDraft({ ...draft, allowHostPage: value === "on" })} />
      <TextAreaField label="备注（选填）" rows={2} maxLength={500} value={draft.note} errors={errors.note === undefined ? [] : [errors.note]} onChange={(event) => setDraft({ ...draft, note: event.target.value })} />
      <div className="form__actions">
        <Button type="submit" variant="primary" loading={busy} loadingText="保存中…">
          {submitLabel}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          取消
        </Button>
      </div>
    </form>
  );
}

function KeyCard({ embedKey, canManage, onChanged }: { embedKey: EmbedKey; canManage: boolean; onChanged(): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const titleId = `embed-key-${embedKey.id}`;
  const active = embedKey.status === "active";
  const toggle = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      const { snippet: _snippet, ...rest } = embedKey;
      await updateEmbedKey(token, embedKey.id, embedKey.version, { name: rest.name, allowed_origins: rest.allowed_origins, default_lang: rest.default_lang, default_services: rest.default_services, layout: rest.layout, allow_host_page: rest.allow_host_page, note: rest.note, status: active ? "disabled" : "active" });
      setConfirming(false);
      toast(active ? `已停用「${embedKey.name}」，合作网站上的组件最迟 60 秒后显示「暂时无法使用」` : `已启用「${embedKey.name}」`);
      onChanged();
    } catch (err) {
      if (handleAuthFailure(err)) return;
      setProblem(err instanceof ApiError && err.code === "VERSION_CONFLICT" ? "这个嵌入码刚被别人改过，页面已刷新。" : failureText(err, active ? "停用" : "启用"));
      if (err instanceof ApiError && err.code === "VERSION_CONFLICT") onChanged();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card" aria-labelledby={titleId}>
      {confirming && (
        <Dialog
          open
          title={`停用「${embedKey.name}」？`}
          busy={busy}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button variant="text" disabled={busy} onClick={() => setConfirming(false)}>
                取消
              </Button>
              <Button variant="danger" loading={busy} loadingText="停用中…" onClick={() => void toggle()}>
                停用
              </Button>
            </>
          }
        >
          <p>停用后，{embedKey.allowed_origins.join("、")} 上的预订组件最迟 60 秒后显示「暂时无法使用」，客人不能再从那里查询价格。之后可以再启用。</p>
        </Dialog>
      )}
      <h2 className="card__title" id={titleId}>
        {embedKey.name} <StatusBadge tone={active ? "success" : "neutral"} label={active ? "启用中" : "已停用"} />
      </h2>
      <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
      {editing ? (
        <KeyForm
          initial={embedKey}
          submitLabel="保存"
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            await updateEmbedKey(token, embedKey.id, embedKey.version, { ...body, status: embedKey.status });
            setEditing(false);
            toast("已保存，合作网站上最迟 60 秒后生效");
            onChanged();
          }}
        />
      ) : (
        <>
          <dl className="details">
            <Detail label="嵌入码">
              <code>{embedKey.key}</code>
            </Detail>
            <Detail label="允许的网站">{embedKey.allowed_origins.join("、")}</Detail>
            <Detail label="默认语言">{EMBED_LANG_NAMES[embedKey.default_lang]}</Detail>
            <Detail label="默认标签">{embedKey.default_services.map((service) => EMBED_SERVICE_NAMES[service]).join("、")}</Detail>
            <Detail label="外观">{EMBED_LAYOUT_NAMES[embedKey.layout]}</Detail>
            <Detail label="整页嵌入">{HOST_PAGE_NAMES[embedKey.allow_host_page ? "on" : "off"]}</Detail>
            {embedKey.note !== null && <Detail label="备注">{embedKey.note}</Detail>}
            <Detail label="最后修改">
              <LocalTime iso={embedKey.updated_at} />
            </Detail>
          </dl>
          <h3 className="card__subtitle">合作网站要放的代码</h3>
          <pre className="code-block" aria-label={`${embedKey.name}的嵌入代码`}>
            {embedKey.snippet}
          </pre>
          <p className="table__muted">
            <CopyButton text={embedKey.snippet} label={`复制${embedKey.name}的嵌入代码`} /> 复制后交给合作网站。{CSP_NOTE}
          </p>
          {canManage && (
            <div className="form__actions">
              <Button variant="secondary" onClick={() => setEditing(true)}>
                修改
              </Button>
              <Button variant="secondary" loading={busy && !active} loadingText="启用中…" onClick={() => (active ? setConfirming(true) : void toggle())}>
                {active ? "停用" : "启用"}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function EmbedKeysPage() {
  const { portal, account, token } = usePortalSession();
  useDocumentTitle(`嵌入组件 · NOZOMI ${portal.name}`);
  const canRead = usePlatformCan("embed.read");
  const canManage = usePlatformCan("embed.manage");
  const toast = useToast();
  const { state, reload } = useLoad<{ items: EmbedKey[] }>("embed-keys", canRead ? listEmbedKeys : null);
  const [creating, setCreating] = useState(false);
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="嵌入组件">
      <Page title="嵌入组件" width="form" action={canManage && !creating ? <Button variant="primary" onClick={() => setCreating(true)}>新建嵌入码</Button> : undefined}>
        {content}
      </Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);
  const items = state.data?.items ?? null;
  if (items === null) {
    return shell(state.status === "error" ? <StateBlock title="嵌入码没有加载出来" description="请检查网络后重试。" action={<Button variant="secondary" onClick={reload}>重试</Button>} /> : <Skeleton lines={["long", "control", "short"]} />);
  }
  return shell(
    <>
      <p className="page__lead">合作网站放一段代码，就能在他们的页面上显示「区间 / 包车」预订表单；客人点「查询价格」后跳到主站完成预订和付款。只有下面「允许的网站」里的网站能用。</p>
      {creating && (
        <section className="card" aria-labelledby="embed-key-new">
          <h2 className="card__title" id="embed-key-new">
            新建嵌入码
          </h2>
          <KeyForm
            initial={null}
            submitLabel="生成嵌入码"
            onCancel={() => setCreating(false)}
            onSubmit={async (body) => {
              const created = await createEmbedKey(token, body);
              setCreating(false);
              toast(`已生成「${created.name}」的嵌入码，复制下面的代码交给合作网站`);
              reload();
            }}
          />
        </section>
      )}
      {items.length === 0 && !creating ? (
        <StateBlock title="还没有嵌入码" description={canManage ? "点「新建嵌入码」，填合作网站的地址后生成。" : "还没有人建过嵌入码。"} />
      ) : (
        items.map((item) => <KeyCard key={`${item.id}-${item.version}`} embedKey={item} canManage={canManage} onChanged={reload} />)
      )}
    </>,
  );
}
