/**
 * 运营后台「供应商」：列表、新建、详情（docs/design/pages/platform-tenants.md 第 3–5 节）。
 * 列表接口只能翻页，所以进来时把全部供应商取完，筛选、搜索、排序、分页都在浏览器里做。
 * 新建成功后接口返回第一个管理员的邀请令牌：令牌只在新建页的内存状态里，对话框关闭以后才换到详情页（不进地址和路由状态）。
 */
import { type FormEvent, type ReactNode, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ApiError } from "../../api/client.ts";
import { type AuditLog, createTenant, getTenant, listAllTenants, listAuditLogs } from "../../api/platform.ts";
import type { Tenant, TenantStatus } from "../../api/types.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button, LinkButton } from "../../components/Button.tsx";
import { type Column, CursorPagination, DataTable, PAGE_SIZES, type TableState } from "../../components/DataTable.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { Dropdown } from "../../components/Dropdown.tsx";
import { FilterBar, SearchBox, useFilterParam } from "../../components/FilterBar.tsx";
import { CopyButton, FieldErrors, SelectField } from "../../components/FormFields.tsx";
import { Icon } from "../../components/Icon.tsx";
import { type IssuedLink, OneTimeLinkDialog } from "../../components/OneTimeLinkDialog.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { StatusBadge, TENANT_STATUS_BADGES } from "../../components/StatusBadge.tsx";
import { useToast } from "../../components/Toast.tsx";
import { failureText } from "../../lib/failure.ts";
import { formatLocalDateTime, shortName } from "../../lib/master-display.ts";
import { EMAIL_REFUSED_TEXT, emailProblem, emailRefused, isUnsure, nameProblem } from "../../lib/platform-display.ts";
import { TENANT_LIST_PATH, TENANT_NEW_PATH, auditLogPath, tenantPath } from "../../lib/platform-paths.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLeaveGuard } from "../../lib/use-leave-guard.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan } from "../../lib/use-master-access.ts";
import { useTenantActions } from "./useTenantActions.tsx";

const DEFAULT_PAGE_SIZE = 50;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_ACCESS = <StateBlock tone="neutral" title="你没有权限查看这里" description="需要的话，请联系管理员开通。" />;

function StatusFilter() {
  const [status, setStatus] = useFilterParam("status");
  return (
    <SelectField
      inline
      label="状态"
      value={status === "active" || status === "suspended" ? status : "all"}
      options={[
        { value: "all", label: "全部" },
        { value: "active", label: "正常" },
        { value: "suspended", label: "已暂停" },
      ]}
      onChange={(value) => setStatus(value === "all" ? null : value)}
    />
  );
}

// ───────────── 列表 ─────────────

export function TenantListPage() {
  const { portal, account } = usePortalSession();
  useDocumentTitle(`供应商 · NOZOMI ${portal.name}`);
  const canRead = usePlatformCan("tenant.read");
  const canCreate = usePlatformCan("tenant.create");
  const canChangeStatus = usePlatformCan("tenant.change_status");
  const [params, setParams] = useSearchParams();
  const loaded = useLoad<{ items: Tenant[]; truncated: boolean }>("platform-tenants", canRead ? listAllTenants : null);
  const actions = useTenantActions((changed) => {
    if (loaded.state.data) loaded.set({ ...loaded.state.data, items: loaded.state.data.items.map((tenant) => (tenant.id === changed.id ? changed : tenant)) });
  });

  const q = (params.get("q") ?? "").trim().slice(0, 100);
  const statusParam = params.get("status");
  const status: TenantStatus | null = statusParam === "active" || statusParam === "suspended" ? statusParam : null;
  const sizeParam = Number(params.get("size"));
  const pageSize = (PAGE_SIZES as readonly number[]).includes(sizeParam) ? sizeParam : DEFAULT_PAGE_SIZE;
  const setParam = (changes: Record<string, string | null>): void => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    if (!("page" in changes)) next.delete("page");
    setParams(next, { replace: true });
  };

  const shell = (content: ReactNode, action?: ReactNode): ReactNode => (
    <AppShell pageName="供应商">
      <Page title="供应商" {...(action ? { action } : {})}>
        {content}
      </Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);

  const all = loaded.state.data?.items ?? [];
  const needle = q.toLowerCase();
  // 最近修改的在前
  const matched = all.filter((tenant) => (status === null || tenant.status === status) && (needle === "" || tenant.name.toLowerCase().includes(needle))).sort((x, y) => y.updated_at.localeCompare(x.updated_at));
  const pages = Math.max(1, Math.ceil(matched.length / pageSize));
  const pageParam = Number(params.get("page"));
  const page = Number.isInteger(pageParam) && pageParam >= 1 && pageParam <= pages ? pageParam : 1;
  const rows = matched.slice((page - 1) * pageSize, page * pageSize);
  const filtered = q !== "" || status !== null;
  const newButton = (
    <LinkButton variant="primary" to={TENANT_NEW_PATH}>
      <Icon name="plus" />
      新建供应商
    </LinkButton>
  );

  const columns: Column<Tenant>[] = [
    {
      key: "name",
      header: "供应商",
      wrap: true,
      cell: (row) => (
        <Link className="link tenant-name" to={tenantPath(row.id)} title={row.name}>
          {row.name}
        </Link>
      ),
    },
    { key: "status", header: "状态", cell: (row) => <StatusBadge {...TENANT_STATUS_BADGES[row.status]} /> },
    { key: "created", header: "创建时间", cell: (row) => <span className="table__muted">{formatLocalDateTime(row.created_at)}</span> },
    { key: "updated", header: "最近修改", cell: (row) => <span className="table__muted">{formatLocalDateTime(row.updated_at)}</span> },
    {
      key: "actions",
      header: "操作",
      cell: (row) => {
        const name = shortName(row.name);
        return (
          <span className="table__actions">
            <LinkButton variant="text" size="sm" to={tenantPath(row.id)} aria-label={`查看 ${name}`}>
              查看
            </LinkButton>
            {(canCreate || canChangeStatus) && (
              <Dropdown buttonClassName="button button--text button--sm" buttonContent="更多" label={`${name} 的更多操作`} align="end">
                {canCreate && (
                  <button type="button" role="menuitem" className="menu-item" onClick={() => actions.open("invite", row)}>
                    <span className="menu-item__text">邀请管理员</span>
                  </button>
                )}
                {canChangeStatus &&
                  (row.status === "active" ? (
                    <button type="button" role="menuitem" className="menu-item menu-item--danger" onClick={() => actions.open("suspend", row)}>
                      <span className="menu-item__text">暂停</span>
                    </button>
                  ) : (
                    <button type="button" role="menuitem" className="menu-item" onClick={() => actions.open("resume", row)}>
                      <span className="menu-item__text">恢复</span>
                    </button>
                  ))}
              </Dropdown>
            )}
          </span>
        );
      },
    },
  ];

  const state = loaded.state;
  const tableState: TableState = !canRead ? "loading" : state.status === "ready" ? "ready" : state.status === "forbidden" ? "forbidden" : state.status === "loading" && state.data === null ? "loading" : state.data !== null ? "ready" : "error";
  const clearFilters = (): void => setParam({ q: null, status: null });
  const empty = filtered ? (
    <StateBlock
      tone="neutral"
      title="没有符合条件的供应商"
      description="换个条件试试，或清空筛选。"
      action={
        <Button variant="secondary" onClick={clearFilters}>
          清空筛选
        </Button>
      }
    />
  ) : (
    <StateBlock tone="neutral" title="还没有供应商" description="供应商就是在平台上接单的车队。新建一家，同时给它的管理员开一个账号；对方用你发过去的链接设置密码后，就可以登录供应商后台配置区域、商品和价格。" {...(canCreate ? { action: newButton } : {})} />
  );

  return shell(
    <>
      {account.status === "ready" && !canCreate && !canChangeStatus && <Alert kind="info">你可以查看供应商，但不能修改。</Alert>}
      {loaded.state.data?.truncated && <Alert kind="warning">供应商太多，只载入了最早建的 2,000 家。请联系技术处理。</Alert>}
      <FilterBar search={<SearchBox label="按名称搜索" value={q} onSearch={(value) => setParam({ q: value })} />} paramNames={["status"]} active={filtered} onClear={clearFilters}>
        <StatusFilter />
      </FilterBar>
      <div className="card-table">
        <DataTable label="供应商列表" columns={columns} rows={rows} rowKey={(row) => row.id} state={tableState} onRetry={loaded.reload} empty={empty} />
      </div>
      <CursorPagination
        total={state.data ? matched.length : null}
        pageSize={pageSize}
        onPageSizeChange={(size) => setParam({ size: size === DEFAULT_PAGE_SIZE ? null : String(size) })}
        hasPrevious={page > 1}
        hasNext={page < pages}
        onPrevious={() => setParam({ page: page - 1 === 1 ? null : String(page - 1) })}
        onNext={() => setParam({ page: String(page + 1) })}
      />
      {actions.dialog}
    </>,
    canCreate ? newButton : undefined,
  );
}

// ───────────── 新建 ─────────────

export function TenantNewPage() {
  const { portal, account, token, handleAuthFailure } = usePortalSession();
  useDocumentTitle(`新建供应商 · NOZOMI ${portal.name}`);
  const navigate = useNavigate();
  const toast = useToast();
  const canCreate = usePlatformCan("tenant.create");
  // 只用来提示「已经有一家同名的」；没取到不影响新建
  const existing = useLoad<{ items: Tenant[]; truncated: boolean }>("platform-tenants", canCreate ? listAllTenants : null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [working, setWorking] = useState(false);
  const [taken, setTaken] = useState(false);
  const [refused, setRefused] = useState(false);
  const [problem, setProblem] = useState<{ title?: string; text: string } | null>(null);
  /** 建成的那一家和这一次应答里的邀请令牌：只在这里，对话框关闭时清掉并换到详情页 */
  const [created, setCreated] = useState<{ tenant: Tenant; issued: IssuedLink } | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const dirty = (name !== "" || email !== "" || adminName !== "") && created === null;
  useLeaveGuard(dirty && !working, setLeaving);

  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="新建供应商" trail={[{ label: "供应商", to: TENANT_LIST_PATH }]}>
      <Page title="新建供应商" width="form">
        {content}
      </Page>
    </AppShell>
  );
  if (account.status === "ready" && !canCreate) return shell(NO_ACCESS);

  const sameName = name.trim() !== "" && (existing.state.data?.items ?? []).some((tenant) => tenant.name.trim().toLowerCase() === name.trim().toLowerCase());
  const errors = {
    name: attempted ? nameProblem(name, "名称") : null,
    email: taken ? "这个邮箱已经是某家供应商的账号了，一个邮箱只能属于一家供应商。请换一个邮箱；如果他就是那家供应商的人，请到那家供应商的详情页处理。" : refused ? EMAIL_REFUSED_TEXT : attempted ? emailProblem(email) : null,
    adminName: attempted ? nameProblem(adminName, "姓名") : null,
  };
  const locked = working || created !== null;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (locked) return;
    setAttempted(true);
    setProblem(null);
    setTaken(false);
    setRefused(false);
    if (nameProblem(name, "名称") !== null) return document.getElementById("tenant-name")?.focus();
    if (emailProblem(email) !== null) return document.getElementById("tenant-email")?.focus();
    if (nameProblem(adminName, "姓名") !== null) return document.getElementById("tenant-admin")?.focus();
    setWorking(true);
    try {
      // 这个请求不自动重试：重试一次就多发一个令牌，还可能建出两家同名的供应商
      const result = await createTenant(token, { name: name.trim(), admin: { email: email.trim(), name: adminName.trim() } });
      setCreated({ tenant: result.tenant, issued: { portal: "tenant", kind: "invite", token: result.invite.token, expiresAt: result.invite.expires_at ?? null, name: result.admin_user.name, email: result.admin_user.email, whom: `${result.tenant.name} 的管理员` } });
    } catch (err) {
      if (handleAuthFailure(err)) return;
      if (err instanceof ApiError && err.code === "EMAIL_TAKEN") {
        setTaken(true);
        document.getElementById("tenant-email")?.focus();
      } else if (emailRefused(err)) {
        setRefused(true);
        document.getElementById("tenant-email")?.focus();
      } else if (isUnsure(err)) setProblem({ title: "不确定有没有建成。", text: `请先回到供应商列表看一眼有没有「${name.trim()}」：有的话不要再建一次，到它的详情页点「邀请管理员」重新拿链接；没有再回来重试。` });
      else if (err instanceof ApiError && err.status === 403) setProblem({ text: "你没有权限新建供应商。需要的话，请联系管理员开通。" });
      else setProblem({ text: failureText(err, "新建") });
    } finally {
      setWorking(false);
    }
  };

  const field = (id: string, label: string, value: string, set: (value: string) => void, error: string | null, hint: string | null, type = "text", extra: ReactNode = null): ReactNode => (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
        <span className="field__required" aria-hidden="true">
          {" *"}
        </span>
      </label>
      <input className="input" id={id} type={type} autoComplete="off" aria-invalid={error !== null || undefined} aria-describedby={`${id}-error ${id}-hint`} readOnly={locked} value={value} onChange={(event) => set(event.target.value)} />
      <FieldErrors id={`${id}-error`} errors={error !== null ? [error] : []} />
      {extra}
      {hint !== null && (
        <p className="field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );

  return shell(
    <form className="form" noValidate onSubmit={(event) => void submit(event)}>
      <div role="alert">
        {problem !== null && (
          <Alert kind="danger">
            {problem.title && <strong className="alert__title">{problem.title}</strong>}
            <span>{problem.text}</span>
            {problem.title && (
              <span className="alert__actions">
                <Link className="link" to={TENANT_LIST_PATH}>
                  去供应商列表看一眼
                </Link>
              </span>
            )}
          </Alert>
        )}
      </div>
      <section className="card" aria-labelledby="tenant-card-title">
        <h2 className="card__title" id="tenant-card-title">
          供应商
        </h2>
        {field(
          "tenant-name",
          "名称",
          name,
          setName,
          errors.name,
          "车队或公司的名字。它的员工登录供应商后台时会看到这个名字。",
          "text",
          sameName ? (
            <p className="field__hint field__hint--warning" role="status">
              <Icon name="alert-triangle" />
              {`已经有一家叫「${name.trim()}」的供应商了。确定要再建一家同名的吗？`}
            </p>
          ) : null,
        )}
      </section>
      <section className="card" aria-labelledby="admin-card-title">
        <h2 className="card__title" id="admin-card-title">
          第一个管理员
        </h2>
        <p className="page-intro">这家供应商的第一个账号，角色是管理员：他可以给自己的同事开账号。新建成功后你会得到一条邀请链接，由你发给他。</p>
        {field(
          "tenant-email",
          "邮箱",
          email,
          (value) => {
            setEmail(value);
            setTaken(false);
            setRefused(false);
          },
          errors.email,
          "对方用这个邮箱登录。请填他本人在用的邮箱。",
          "email",
        )}
        {field("tenant-admin", "姓名", adminName, setAdminName, errors.adminName, null)}
        <Alert kind="info">
          <strong className="alert__title">系统不会给对方发邮件。</strong>
          <span>点「新建」后，这里会显示一条邀请链接，只显示一次，请当场复制并发给对方。</span>
        </Alert>
      </section>
      <div className="form-bar">
        <Button
          variant="text"
          disabled={locked}
          onClick={() => {
            if (dirty) setLeaving(TENANT_LIST_PATH);
            else void navigate(TENANT_LIST_PATH);
          }}
        >
          取消
        </Button>
        <Button variant="primary" type="submit" loading={working} loadingText="新建中…" disabled={created !== null}>
          新建
        </Button>
      </div>
      {created !== null && (
        <OneTimeLinkDialog
          issued={created.issued}
          onClose={() => {
            const tenant = created.tenant;
            // 先把令牌清掉，再换到详情页：令牌不进地址，也不进路由状态
            setCreated(null);
            toast(`已新建供应商「${tenant.name}」`);
            void navigate(tenantPath(tenant.id), { replace: true });
          }}
        />
      )}
      <Dialog
        open={leaving !== null}
        title="填的内容还没有提交"
        onClose={() => setLeaving(null)}
        footer={
          <>
            <Button variant="text" data-autofocus onClick={() => setLeaving(null)}>
              继续填写
            </Button>
            <Button
              variant="secondary"
              className="button--danger-text"
              onClick={() => {
                const to = leaving;
                setLeaving(null);
                setName("");
                setEmail("");
                setAdminName("");
                if (to !== null) requestAnimationFrame(() => void navigate(to));
              }}
            >
              不保存，离开
            </Button>
          </>
        }
      >
        <p>离开后，这里填的内容不会保留。</p>
      </Dialog>
    </form>,
  );
}

// ───────────── 详情 ─────────────

/** 这家供应商最近一次暂停的记录（原因、谁、什么时候）；只有能看审计日志的角色取得到。 */
function reasonOf(log: AuditLog | undefined): { reason: string; by: string | null; at: string } | null {
  if (!log) return null;
  const reason = log.after?.["reason"];
  return { reason: typeof reason === "string" && reason.trim() !== "" ? reason : "", by: log.actor.email, at: log.occurred_at };
}

export function TenantDetailPage() {
  const { id = "" } = useParams();
  const { portal, account } = usePortalSession();
  const canRead = usePlatformCan("tenant.read");
  const canCreate = usePlatformCan("tenant.create");
  const canChangeStatus = usePlatformCan("tenant.change_status");
  const canAudit = usePlatformCan("audit_log.read");
  const valid = UUID_PATTERN.test(id);
  const loaded = useLoad<Tenant>(`platform-tenant:${id}`, canRead && valid ? (token) => getTenant(token, id) : null);
  const tenant = loaded.state.data;
  useDocumentTitle(tenant ? `${tenant.name} · 供应商 · NOZOMI ${portal.name}` : `供应商 · NOZOMI ${portal.name}`);
  const suspended = tenant?.status === "suspended";
  const suspension = useLoad<AuditLog[]>(`platform-tenant-suspension:${id}:${tenant?.updated_at ?? ""}`, canAudit && suspended ? (token) => listAuditLogs(token, { resource: "tenant", resource_id: id, action: "suspend", limit: 1 }).then((page) => page.items) : null);
  const reason = suspension.state.status === "ready" ? reasonOf(suspension.state.data[0]) : null;
  const actions = useTenantActions((changed) => loaded.set(changed));

  const shell = (content: ReactNode, title: ReactNode = "供应商", extra: { action?: ReactNode; meta?: ReactNode } = {}): ReactNode => (
    <AppShell pageName={tenant?.name ?? "供应商"} trail={[{ label: "供应商", to: TENANT_LIST_PATH }]}>
      <Page title={title} width="form" {...extra}>
        {content}
      </Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);
  if (!valid || loaded.state.status === "not-found") {
    return shell(
      <section className="card">
        <StateBlock tone="neutral" title="找不到这家供应商" description="链接可能有误。" action={<LinkButton variant="primary" to={TENANT_LIST_PATH}>回到供应商列表</LinkButton>} />
      </section>,
    );
  }
  if (tenant === null) {
    return shell(
      <section className="card">
        {loaded.state.status === "error" || loaded.state.status === "forbidden" ? (
          <StateBlock
            title="加载失败"
            description="请检查网络后重试。"
            action={
              <Button variant="secondary" onClick={loaded.reload}>
                重试
              </Button>
            }
          />
        ) : (
          <Skeleton lines={["medium", "long", "long", "short"]} />
        )}
      </section>,
    );
  }

  const statusButton = !canChangeStatus ? undefined : suspended ? (
    <Button variant="primary" onClick={() => actions.open("resume", tenant, { reason: reason?.reason ?? null })}>
      恢复
    </Button>
  ) : (
    <Button variant="secondary" className="button--danger-text" onClick={() => actions.open("suspend", tenant)}>
      暂停
    </Button>
  );

  return shell(
    <>
      {!canCreate && !canChangeStatus && <Alert kind="info">你可以查看供应商，但不能修改。</Alert>}
      {suspended && (
        <div role="status">
          <Alert kind="warning">
            <strong className="alert__title">这家供应商已暂停。</strong>
            <span>暂停期间：它的商品不参与比价、不接新订单；已经接下的订单要照常履约；它的账号仍然可以登录供应商后台。</span>
            <span className="tenant-reason">
              {!canAudit ? (
                "暂停原因记在审计日志里，需要的话请问超级管理员。"
              ) : suspension.state.status === "loading" ? (
                "原因加载中…"
              ) : reason !== null ? (
                `原因：${reason.reason === "" ? "没有填原因" : reason.reason}（${reason.by ?? "—"}，${formatLocalDateTime(reason.at)}）`
              ) : suspension.state.status === "ready" ? (
                "原因：没有找到暂停的记录。"
              ) : (
                <>
                  原因没有加载出来。
                  <Button variant="text" size="sm" onClick={suspension.reload}>
                    重试
                  </Button>
                </>
              )}
            </span>
          </Alert>
        </div>
      )}
      <section className="card" aria-labelledby="tenant-info-title">
        <h2 className="card__title" id="tenant-info-title">
          基本信息
        </h2>
        <dl className="details">
          <div>
            <dt>名称</dt>
            <dd>{tenant.name}</dd>
          </div>
          <div>
            <dt>状态</dt>
            <dd>{TENANT_STATUS_BADGES[tenant.status].label}</dd>
          </div>
          <div>
            <dt>供应商编号</dt>
            <dd className="tenant-id">
              <span className="product-code">{tenant.id}</span>
              <CopyButton text={tenant.id} label="复制供应商编号" />
            </dd>
          </div>
          <div>
            <dt>创建时间</dt>
            <dd>{formatLocalDateTime(tenant.created_at)}</dd>
          </div>
          <div>
            <dt>最近修改</dt>
            <dd>{formatLocalDateTime(tenant.updated_at)}</dd>
          </div>
        
        </dl>
      </section>
      <section className="card" aria-labelledby="tenant-admins-title">
        <div className="card__title-row">
          <h2 className="card__title" id="tenant-admins-title">
            管理员账号
          </h2>
          {canCreate && (
            <span className="tenant-admin-actions">
              <Button onClick={() => actions.open("invite", tenant)}>邀请管理员</Button>
              <Button onClick={() => actions.open("reset", tenant)}>发密码重置链接</Button>
            </span>
          )}
        </div>
        {canCreate && <p>这里可以给这家供应商再开一个管理员账号，或者在管理员忘了密码、他们自己又没有别的管理员能帮忙时，给他发一条密码重置链接。</p>}
        <p>供应商自己的其他账号（调度、财务等）由他们的管理员在供应商后台里管理。</p>
        {canCreate && <p className="page-intro">之前的邀请链接没有交到对方手里、或已经过期：点「邀请管理员」，填同一个邮箱，会发出一条新的链接，旧的作废。</p>}
      </section>
      {canAudit && (
        <p>
          <Link className="link" to={auditLogPath({ tenant: tenant.id })}>
            看这家供应商的操作记录
            <Icon name="chevron-right" />
          </Link>
        </p>
      )}
      {actions.dialog}
    </>,
    tenant.name,
    { ...(statusButton ? { action: statusButton } : {}), meta: <StatusBadge {...TENANT_STATUS_BADGES[tenant.status]} /> },
  );
}
