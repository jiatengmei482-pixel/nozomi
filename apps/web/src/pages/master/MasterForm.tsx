/**
 * 四类主数据共用的新增 / 编辑页骨架（docs/design/pages/master-data.md 第 5、8 节）：
 * 取数与各种状态、标题行、只读角色、校验时机、只提交改过的字段、保存出错的处理、保存后去哪。
 * 各类自己的字段、校验和收发数据由 `FormModel` 给出。
 */
import { type ComponentType, type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { ApiError, NetworkError } from "../../api/client.ts";
import { type MasterKind, type MasterKinds, createMaster, getMaster, patchMaster } from "../../api/master.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert, type AlertKind } from "../../components/Alert.tsx";
import { AppShell, type Crumb, Page } from "../../components/AppShell.tsx";
import { Attributions, type DataSource } from "../../components/Attribution.tsx";
import { Button, LinkButton } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { useToast } from "../../components/Toast.tsx";
import { MASTER_STATUS_BADGES, displayName, formatLocalDateTime, shortName } from "../../lib/master-display.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLeaveGuard } from "../../lib/use-leave-guard.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan } from "../../lib/use-master-access.ts";
import { FORBIDDEN_TEXT, returnNavigationState, returnPath } from "./shared.tsx";
import { type StatusToggleOptions, useStatusToggle } from "./useStatusToggle.tsx";

type RecordOf<K extends MasterKind> = MasterKinds[K]["record"];

/** 字段名 → 出错文字。组合字段用「字段.部分」（name.ja、center.lat、combos.2）。 */
export type FieldErrors = Record<string, string[]>;

export interface FormContext<K extends MasterKind, X> {
  mode: "new" | "edit";
  record: RecordOf<K> | null;
  readOnly: boolean;
  busy: boolean;
  extra: X;
}

export interface FormApi<V> {
  values: V;
  set(patch: Partial<V>): void;
  /** 字段失去焦点：从此开始显示它的错误 */
  touch(field: string): void;
  /** 现在该显示的错误（没碰过、也没提交过的字段不显示） */
  errors(field: string): string[];
}

export interface FormModel<K extends MasterKind, V, X = undefined> {
  kind: K;
  moduleName: string;
  /** 「新增{对象}」「找不到这个{对象}」 */
  objectName(context: { search: URLSearchParams; record: RecordOf<K> | null }): string;
  listPath(context: { search: URLSearchParams; record: RecordOf<K> | null }): string;
  /** 面包屑里「主数据 / 模块」之后、当前页之前的几级 */
  trail?(context: FormContext<K, X>): Crumb[];
  /** 这一页要用到的其他数据（城市清单、上级地点）；没取到的部分为 null */
  useExtra(search: URLSearchParams, record: RecordOf<K> | null): X;
  /** 新增页打开时就不成立（上级不存在）：返回「找不到」的标题 */
  missing?(extra: X, search: URLSearchParams): string | null;
  empty(search: URLSearchParams, extra: X): V;
  fromRecord(record: RecordOf<K>): V;
  validate(values: V, context: FormContext<K, X>): FieldErrors;
  /** 字段名 → 界面上的叫法（出错汇总里用） */
  labels: Readonly<Record<string, string>>;
  /** 后端校验说明里的位置（/name/ja）对应哪个字段 */
  fieldOfPath(path: string): string | null;
  toCreate(values: V, context: FormContext<K, X>): MasterKinds[K]["create"];
  /** 只含改过的字段；什么都没改返回空对象 */
  toPatch(values: V, record: RecordOf<K>): MasterKinds[K]["patch"];
  /** 「保存并继续新增」后保留哪些内容 */
  continueWith(values: V, search: URLSearchParams, extra: X): V;
  Fields: ComponentType<{ form: FormApi<V>; context: FormContext<K, X> }>;
  /** 表单卡片下面的内容（数据来源、下级小表格） */
  Extra?: ComponentType<{ record: RecordOf<K>; readOnly: boolean }>;
  /** 页面顶部的说明（新增机场的提示） */
  intro?(context: FormContext<K, X>): string | null;
  toggle: Pick<StatusToggleOptions<K>, "objectName" | "objectPhrase" | "inUse" | "notReady">;
  /** 页面底部的数据来源署名 */
  footnotes?(context: FormContext<K, X>): readonly DataSource[];
  /** 保存后回到上级的编辑页时，滚到哪一块（航站楼 / 出口保存后回到上级的下级卡片） */
  returnAnchor?(context: FormContext<K, X>): string | null;
  /** 后端拒绝：城市或上级已停用。返回要显示在哪个字段下，或表单顶部的话 */
  notReady?(reason: string, context: FormContext<K, X>): { field?: string; text: string };
}

interface TopNotice {
  kind: AlertKind;
  title?: string;
  text: string;
  action?: ReactNode;
}

const LOCKED_NAMES: Readonly<Record<string, string>> = { code: "编码", country_code: "国家", type: "类型", parent_id: "上级", grade: "等级", seats: "座位数" };

function focusField(field: string): void {
  const base = field.split(".")[0] ?? field;
  const target = document.querySelector<HTMLElement>(`[data-field="${field}"] input, [data-field="${field}"] textarea, [data-field="${base}"] input, [data-field="${base}"] textarea, [data-field="${base}"] select`);
  target?.focus();
  target?.scrollIntoView?.({ block: "center" });
}

/** 字段的容器：出错汇总和「焦点到第一个出错的字段」靠 data-field 找到它。`wide` 占整行。 */
export function FieldSlot({ name, wide = false, children }: { name: string; wide?: boolean; children: ReactNode }) {
  return (
    <div data-field={name} className={wide ? "form-grid__wide" : undefined}>
      {children}
    </div>
  );
}

export function FormGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="form-group">
      <h2 className="form-group__title">{title}</h2>
      <div className="form-grid">{children}</div>
    </section>
  );
}

export function MasterFormPage<K extends MasterKind, V, X>({ model }: { model: FormModel<K, V, X> }) {
  const { kind } = model;
  const { id } = useParams();
  const mode = id === undefined ? "new" : "edit";
  const [search] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const { portal, token, account, handleAuthFailure } = usePortalSession();
  const canManage = usePlatformCan("master_data.manage");
  const loaded = useLoad<RecordOf<K>>(`${kind}:${id ?? "new"}`, id !== undefined ? (authToken) => getMaster(kind, authToken, id) : null);
  const record = mode === "edit" ? loaded.state.data : null;
  const extra = model.useExtra(search, record);

  const [values, setValues] = useState<V | null>(() => (mode === "new" ? model.empty(search, extra) : null));
  const [initial, setInitial] = useState<V | null>(values);
  const [adopted, setAdopted] = useState<string | null>(null);
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<TopNotice | null>(null);
  const [submitting, setSubmitting] = useState<"save" | "continue" | null>(null);
  const [conflict, setConflict] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  // 有没保存的修改时想离开：null = 没有；"" = 点了「取消」，回来的地方；其余是要去的站内地址
  const [leaving, setLeaving] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  // 已经确认过要丢掉修改：离开的这一下不再拦
  const [discarded, setDiscarded] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // 取到记录（第一次，或「载入最新内容」之后）就把它填进表单
  const recordKey = record ? `${record.id}:${record.version}` : null;
  useEffect(() => {
    if (record === null || recordKey === adopted || (adopted !== null && !conflict && values !== null)) return;
    const next = model.fromRecord(record);
    setValues(next);
    setInitial(next);
    setAdopted(recordKey);
    if (conflict) {
      setConflict(false);
      setServerErrors({});
      setNotice({ kind: "info", text: "已载入最新内容。" });
    }
  }, [record, recordKey, adopted, conflict, values, model]);

  // 「载入最新内容」没有成功：说明白，内容原样留着，可以再试
  const loadFailed = loaded.state.status === "error";
  const reloadStarted = useRef(false);
  useEffect(() => {
    if (!reloading) return;
    if (loaded.state.status === "loading") {
      reloadStarted.current = true;
      return;
    }
    if (!reloadStarted.current) return;
    reloadStarted.current = false;
    setReloading(false);
    if (loadFailed) {
      setNotice({
        kind: "warning",
        title: "最新内容没有载入成功。",
        text: "请检查网络后重试。你在这个页面上写的内容还在。",
        action: (
          <Button variant="secondary" size="sm" onClick={reloadLatest}>
            再试一次
          </Button>
        ),
      });
    }
  }, [reloading, loaded.state.status, loadFailed]);
  const reloadLatest = (): void => {
    setReloading(true);
    loaded.reload();
  };

  // 从下级的表单保存回来（地址带 #children 之类）：滚到那一块
  const anchor = location.hash.replace(/^#/, "");
  const hasRecord = record !== null;
  useEffect(() => {
    if (anchor !== "" && hasRecord && values !== null) document.getElementById(anchor)?.scrollIntoView?.({ block: "start" });
  }, [anchor, hasRecord, values === null]);

  // 后端给的字段级错误必须让人看得见：万一对应的字段没有把它画出来，就落到表单顶部
  useEffect(() => {
    const messages = Object.values(serverErrors).flat();
    if (messages.length === 0) return;
    const text = formRef.current?.textContent ?? "";
    if (messages.some((message) => !text.includes(message))) setNotice({ kind: "danger", text: "提交的内容不符合要求，请检查后重试。" });
  }, [serverErrors]);

  const readOnly = mode === "edit" && !canManage;
  const busy = submitting !== null;
  const context: FormContext<K, X> = { mode, record, readOnly, busy, extra };
  const naming = { search, record };
  const objectName = model.objectName(naming);
  const listPath = model.listPath(naming);
  const backTo = returnPath(location.state, listPath);
  /** 回到来的地方：带上列表离开时的翻页位置 */
  const goBack = (hash = ""): void => {
    const state = returnNavigationState(location.state);
    void navigate(`${backTo.split("#")[0]}${hash}`, state ? { state } : {});
  };
  const shown = record ? displayName(record.name) : null;
  const pageTitle = mode === "new" ? `新增${objectName}` : (shown?.text ?? objectName);
  useDocumentTitle(mode === "new" ? `${pageTitle} · NOZOMI ${portal.name}` : `${pageTitle} · ${model.moduleName} · NOZOMI ${portal.name}`);

  const dirtyNow = values === null ? false : mode === "edit" ? record !== null && Object.keys(model.toPatch(values, record) as object).length > 0 : JSON.stringify(values) !== JSON.stringify(initial);
  useLeaveGuard(dirtyNow && submitting === null && !discarded, setLeaving);

  const clientErrors = useMemo(() => (values === null ? {} : model.validate(values, { mode, record, readOnly, busy: false, extra })), [values, mode, record, readOnly, extra, model]);
  const toggle = useStatusToggle<K>({ kind, ...model.toggle, onChanged: (next) => loaded.set(next) });

  const trail: Crumb[] = [{ label: "主数据" }, { label: model.moduleName, to: listPath }, ...(model.trail?.(context) ?? [])];
  const shell = (content: ReactNode, header: { action?: ReactNode; meta?: ReactNode } = {}): ReactNode => (
    <AppShell pageName={pageTitle} trail={trail}>
      <Page title={pageTitle} {...(shown && mode === "edit" ? { titleLang: shown.lang } : {})} width="form" {...header}>
        {content}
      </Page>
    </AppShell>
  );
  const backButton = (
    <LinkButton variant="primary" to={listPath}>{`回到${model.moduleName}列表`}</LinkButton>
  );

  if (account.status === "ready" && mode === "new" && !canManage) return shell(<StateBlock tone="neutral" title="你没有权限查看这里" description="需要的话，请联系管理员开通。" />);
  const missingTitle = mode === "new" ? (model.missing?.(extra, search) ?? null) : null;
  if (missingTitle !== null) return shell(<StateBlock tone="neutral" title={missingTitle} description="它可能不存在，或链接有误。" action={backButton} />);
  if (mode === "edit" && loaded.state.status === "not-found") return shell(<StateBlock tone="neutral" title={`找不到这个${objectName}`} description="它可能不存在，或链接有误。" action={backButton} />);
  if (mode === "edit" && loaded.state.status === "forbidden") return shell(<StateBlock tone="neutral" title="你没有权限查看这里" description="需要的话，请联系管理员开通。" />);
  if (mode === "edit" && record === null && loaded.state.status === "error") {
    return shell(
      <section className="card">
        <StateBlock
          title="加载失败"
          description="请检查网络后重试。"
          action={
            <Button variant="secondary" onClick={loaded.reload}>
              重试
            </Button>
          }
        />
      </section>,
    );
  }
  if (values === null || (mode === "edit" && record === null)) {
    return shell(
      <section className="card">
        <Skeleton lines={["control", "control", "control", "control"]} />
      </section>,
    );
  }

  const errorsFor = (field: string): string[] => {
    const server = serverErrors[field] ?? [];
    const base = field.split(".")[0] ?? field;
    const visible = attempted || touched.has(field) || touched.has(base);
    return [...server, ...(visible ? (clientErrors[field] ?? []) : [])];
  };
  const form: FormApi<V> = {
    values,
    set: (patch) => {
      setValues({ ...values, ...patch });
      const changed = Object.keys(patch);
      if (Object.keys(serverErrors).some((field) => changed.includes(field.split(".")[0] ?? field))) {
        setServerErrors(Object.fromEntries(Object.entries(serverErrors).filter(([field]) => !changed.includes(field.split(".")[0] ?? field))));
      }
    },
    touch: (field) => {
      if (!touched.has(field)) setTouched(new Set([...touched, field]));
    },
    errors: errorsFor,
  };

  const returnAnchor = model.returnAnchor?.(context) ?? null;
  const returnHash = returnAnchor === null ? "" : `#${returnAnchor}`;
  const invalidFields = Object.keys(clientErrors).filter((field) => (clientErrors[field] ?? []).length > 0);
  const dirty = dirtyNow;

  const fail = (err: unknown): void => {
    if (handleAuthFailure(err)) return;
    const preserved = "你填写的内容还在。";
    if (err instanceof NetworkError) return setNotice({ kind: "danger", text: `网络连接失败，请检查网络后重试。${preserved}` });
    if (!(err instanceof ApiError)) return setNotice({ kind: "danger", text: `系统暂时无法保存，请稍后再试。${preserved}` });
    switch (err.code) {
      case "VALIDATION_FAILED": {
        const issues = Array.isArray(err.details["issues"]) ? (err.details["issues"] as { path?: unknown; message?: unknown }[]) : [];
        const mapped: FieldErrors = {};
        for (const issue of issues) {
          const field = typeof issue.path === "string" ? model.fieldOfPath(issue.path) : null;
          if (field === null) continue;
          const message = typeof issue.message === "string" && /[一-鿿]/.test(issue.message) ? issue.message : "这一项不符合要求，请检查后重试";
          mapped[field] = [...(mapped[field] ?? []), message];
        }
        const first = Object.keys(mapped)[0];
        if (first === undefined) return setNotice({ kind: "danger", text: "提交的内容不符合要求，请检查后重试。" });
        setServerErrors(mapped);
        return focusField(first);
      }
      case "BAD_REQUEST":
        return setNotice({ kind: "danger", text: "提交的内容不符合要求，请检查后重试。" });
      case "CODE_TAKEN": {
        setServerErrors({ code: ["这个编码已经被使用，请换一个"] });
        const input = formRef.current?.querySelector<HTMLInputElement>('[data-field="code"] input');
        input?.focus();
        return input?.select();
      }
      case "VERSION_CONFLICT":
        setConflict(true);
        return setNotice({
          kind: "warning",
          title: "这条记录刚被别人修改过，你的修改还没有保存。",
          text: "请先载入最新内容，再重新修改。载入后，你在这个页面上还没保存的修改会丢失。",
          action: (
            <Button variant="secondary" size="sm" onClick={reloadLatest}>
              载入最新内容
            </Button>
          ),
        });
      case "FIELD_LOCKED": {
        const fields = Array.isArray(err.details["fields"]) ? (err.details["fields"] as unknown[]) : [];
        const names = fields.map((field) => LOCKED_NAMES[String(field)]).filter((name): name is string => name !== undefined);
        return setNotice({ kind: "danger", text: `${names.length > 0 && names.length === fields.length ? names.join("、") : "有些内容"}创建后不能修改。请刷新页面后重试。` });
      }
      case "CONCURRENT_UPDATE":
        return setNotice({ kind: "warning", text: "同时有其他人在修改相关的数据，这次没有保存成功。请再点一次保存。" });
      case "MASTER_DATA_NOT_READY": {
        const outcome: { field?: string; text: string } = model.notReady?.(String(err.details["reason"] ?? ""), context) ?? { text: "相关的数据已停用，这次没有保存成功。" };
        if (outcome.field !== undefined) {
          setServerErrors({ [outcome.field]: [outcome.text] });
          return focusField(outcome.field);
        }
        return setNotice({ kind: "danger", text: outcome.text });
      }
      default:
        if (err.status === 403) {
          setBlocked("没有修改权限");
          return setNotice({ kind: "danger", text: FORBIDDEN_TEXT });
        }
        if (err.status === 404) {
          setBlocked("这条记录已经不存在");
          return setNotice({ kind: "danger", text: "找不到这条记录，它可能已经不存在。请回到列表重新查找。" });
        }
        return setNotice({ kind: "danger", text: `系统暂时无法保存，请稍后再试。${preserved}` });
    }
  };

  const submit = async (intent: "save" | "continue"): Promise<void> => {
    if (busy || conflict || blocked !== null) return;
    setAttempted(true);
    const first = invalidFields[0];
    if (first !== undefined) {
      focusField(first);
      return;
    }
    if (mode === "edit" && record) {
      const patch = model.toPatch(values, record);
      if (Object.keys(patch as object).length === 0) {
        goBack();
        return;
      }
      setNotice(null);
      setSubmitting(intent);
      try {
        const saved = await patchMaster(kind, token, record.id, record.version, patch);
        toast(`已保存「${shortName(displayName(saved.name).text)}」`);
        goBack(returnHash);
      } catch (err) {
        fail(err);
      } finally {
        setSubmitting(null);
      }
      return;
    }
    setNotice(null);
    setSubmitting(intent);
    try {
      const created = await createMaster(kind, token, model.toCreate(values, context));
      toast(`已新增${objectName}「${shortName(displayName(created.name).text)}」`);
      if (intent === "continue") {
        const next = model.continueWith(values, search, extra);
        setValues(next);
        setInitial(next);
        setAttempted(false);
        setTouched(new Set());
        setServerErrors({});
        formRef.current?.querySelector<HTMLElement>("input:not([readonly]), textarea")?.focus();
        document.getElementById("main")?.scrollTo?.({ top: 0 });
      } else {
        goBack(returnHash);
      }
    } catch (err) {
      fail(err);
    } finally {
      setSubmitting(null);
    }
  };

  const header =
    mode === "edit" && record
      ? {
          meta: (
            <>
              <span className="mono">{record.code}</span>
              <StatusBadge {...MASTER_STATUS_BADGES[record.status]} />
              <span>{`最近修改 ${formatLocalDateTime(record.updated_at)}`}</span>
            </>
          ),
          ...(canManage
            ? {
                action:
                  record.status === "active" ? (
                    <Button className="button--danger-text" onClick={() => toggle.requestDisable(record)}>
                      停用
                    </Button>
                  ) : (
                    <Button loading={toggle.enablingId === record.id} loadingText="启用中…" onClick={() => void toggle.enable(record)}>
                      启用
                    </Button>
                  ),
              }
            : {}),
        }
      : {};
  const intro = model.intro?.(context) ?? null;
  const saveNote = conflict ? "请先载入最新内容" : blocked;
  const { Fields, Extra } = model;

  return shell(
    <>
      {toggle.notice}
      {readOnly && <Alert kind="info">你可以查看主数据，但不能修改。需要修改的话，请联系管理员开通。</Alert>}
      {intro !== null && !readOnly && <Alert kind="info">{intro}</Alert>}
      <form
        ref={formRef}
        className="card form-card"
        noValidate
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          void submit("save");
        }}
      >
        <div role="alert">
          {attempted && invalidFields.length > 0 && (
            <Alert kind="danger">
              <strong className="alert__title">{`有 ${new Set(invalidFields.map((field) => field.split(".")[0])).size} 处需要修改`}</strong>
              <span className="error-summary__list">
                {[...new Set(invalidFields.map((field) => field.split(".")[0] ?? field))].map((field) => (
                  <button key={field} type="button" className="link error-summary__item" onClick={() => focusField(field)}>
                    {model.labels[field] ?? field}
                  </button>
                ))}
              </span>
            </Alert>
          )}
          {notice && (notice.kind === "danger" || notice.kind === "warning") && (
            <Alert kind={notice.kind}>
              {notice.title && <strong className="alert__title">{notice.title}</strong>}
              <span>{notice.text}</span>
              {notice.action && <span className="alert__actions">{notice.action}</span>}
            </Alert>
          )}
        </div>
        <div role="status">{notice && notice.kind === "info" && <Alert kind="info">{notice.text}</Alert>}</div>
        <Fields form={form} context={context} />
        {!readOnly && (
          <div className="form-bar">
            {mode === "new" && <span className="form-bar__note">保存后直接是启用状态，供应商马上可以选到。</span>}
            {saveNote !== null && <span className="form-bar__note">{saveNote}</span>}
            <Button variant="text" disabled={busy} onClick={() => (dirty ? setLeaving("") : goBack())}>
              取消
            </Button>
            {mode === "new" && (
              <Button disabled={submitting === "save" || blocked !== null} loading={submitting === "continue"} loadingText="保存中…" onClick={() => void submit("continue")}>
                保存并继续新增
              </Button>
            )}
            <Button type="submit" variant="primary" disabled={submitting === "continue" || conflict || blocked !== null} loading={submitting === "save"} loadingText="保存中…">
              保存
            </Button>
          </div>
        )}
      </form>
      {Extra && record && <Extra record={record} readOnly={readOnly} />}
      {readOnly && (
        <div>
          <LinkButton to={backTo}>回到列表</LinkButton>
        </div>
      )}
      <Attributions sources={model.footnotes?.(context) ?? []} />
      {toggle.dialog}
      <Dialog
        open={leaving !== null}
        title="有未保存的修改，确定离开吗？"
        onClose={() => setLeaving(null)}
        footer={
          <>
            <Button variant="secondary" data-autofocus onClick={() => setLeaving(null)}>
              继续编辑
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const to = leaving;
                setLeaving(null);
                setDiscarded(true);
                if (to === null || to === "") goBack();
                else void navigate(to);
              }}
            >
              离开
            </Button>
          </>
        }
      >
        <p>离开后，这个页面上还没保存的内容会丢失。</p>
      </Dialog>
    </>,
    header,
  );
}
