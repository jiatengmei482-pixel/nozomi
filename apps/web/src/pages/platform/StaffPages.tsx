/**
 * 运营后台「系统设置 / 平台员工」：列表、新增 / 重新邀请、停用 / 启用、发密码重置链接（docs/design/pages/platform-settings.md 第 2 节）。
 * 列表接口只能翻页：进来时全部取完，搜索和筛选在浏览器里做。新增和发密码重置成功后拿到的令牌只在对话框的内存状态里。
 */
import { PLATFORM_ROLES, type PlatformRole } from "@nozomi/domain";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { ApiError } from "../../api/client.ts";
import { createStaff, issueStaffReset, listAllStaff, setStaffEnabled } from "../../api/platform.ts";
import type { PlatformUser } from "../../api/types.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button, LinkButton } from "../../components/Button.tsx";
import { type Column, CursorPagination, DataTable, PAGE_SIZES, type TableState } from "../../components/DataTable.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { Dropdown } from "../../components/Dropdown.tsx";
import { FilterBar, SearchBox, useFilterParam } from "../../components/FilterBar.tsx";
import { FieldErrors, SelectField } from "../../components/FormFields.tsx";
import { Icon } from "../../components/Icon.tsx";
import { type IssuedLink, OneTimeLinkDialog, UNSURE_TEXT } from "../../components/OneTimeLinkDialog.tsx";
import { StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { useToast } from "../../components/Toast.tsx";
import { failureText } from "../../lib/failure.ts";
import { formatLocalDateTime, shortName } from "../../lib/master-display.ts";
import { ACCOUNT_STATUS_BADGES, EMAIL_REFUSED_TEXT, ROLE_DUTIES, emailProblem, emailRefused, isUnsure, nameProblem, roleAbilities, roleNotLiveYet } from "../../lib/platform-display.ts";
import { STAFF_LIST_PATH, STAFF_NEW_PATH, auditLogPath } from "../../lib/platform-paths.ts";
import { roleName } from "../../lib/portal.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLeaveGuard } from "../../lib/use-leave-guard.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan } from "../../lib/use-master-access.ts";

const DEFAULT_PAGE_SIZE = 50;
const NO_ACCESS = <StateBlock tone="neutral" title="你没有权限查看这里" description="需要的话，请联系管理员开通。" />;
const TRAIL = [{ label: "系统设置" }];
const ROLE_KEYS = PLATFORM_ROLES.map((role) => role.key) as readonly string[];
const roleLabel = (role: string): string => roleName("platform", role) ?? role;

/** 重新邀请时从列表带到新增页的内容（只有姓名、邮箱、角色，没有令牌）。 */
interface ReinviteState {
  reinvite: { email: string; name: string; role: PlatformRole };
}

function Filters() {
  const [role, setRole] = useFilterParam("role");
  const [status, setStatus] = useFilterParam("status");
  return (
    <>
      <SelectField inline label="角色" value={ROLE_KEYS.includes(role ?? "") ? (role as string) : "all"} options={[{ value: "all", label: "全部" }, ...PLATFORM_ROLES.map((entry) => ({ value: entry.key as string, label: entry.name as string }))]} onChange={(value) => setRole(value === "all" ? null : value)} />
      <SelectField
        inline
        label="状态"
        value={status === "invited" || status === "active" || status === "disabled" ? status : "all"}
        options={[
          { value: "all", label: "全部" },
          { value: "invited", label: "待激活" },
          { value: "active", label: "在用" },
          { value: "disabled", label: "已停用" },
        ]}
        onChange={(value) => setStatus(value === "all" ? null : value)}
      />
    </>
  );
}

type Pending = { action: "disable" | "enable" | "reset"; user: PlatformUser };

export function StaffListPage() {
  const { portal, account, token, handleAuthFailure } = usePortalSession();
  useDocumentTitle(`平台员工 · NOZOMI ${portal.name}`);
  const toast = useToast();
  const location = useLocation();
  const canRead = usePlatformCan("staff.read");
  const canManage = usePlatformCan("staff.manage");
  const canAudit = usePlatformCan("audit_log.read");
  const [params, setParams] = useSearchParams();
  const loaded = useLoad<{ items: PlatformUser[]; truncated: boolean }>("platform-staff", canRead ? listAllStaff : null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<{ title?: string; text: string; reinvite?: boolean } | null>(null);
  const [blocked, setBlocked] = useState(false);
  /** 这一次应答里的重置令牌：只在这里，关闭时清掉 */
  const [issued, setIssued] = useState<IssuedLink | null>(null);
  const invitedId = typeof (location.state as { invited?: unknown } | null)?.invited === "string" ? (location.state as { invited: string }).invited : null;
  const [highlight, setHighlight] = useState<string | null>(invitedId);
  useEffect(() => {
    if (highlight === null) return;
    const timer = setTimeout(() => setHighlight(null), 2000);
    return () => clearTimeout(timer);
  }, [highlight]);

  const me = account.status === "ready" ? account.account.id : null;
  const q = (params.get("q") ?? "").trim().slice(0, 100);
  const roleParam = params.get("role");
  const role = ROLE_KEYS.includes(roleParam ?? "") ? roleParam : null;
  const statusParam = params.get("status");
  const status = statusParam === "invited" || statusParam === "active" || statusParam === "disabled" ? statusParam : null;
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
    <AppShell pageName="平台员工" trail={TRAIL}>
      <Page title="平台员工" {...(action ? { action } : {})}>
        {content}
      </Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);

  const all = loaded.state.data?.items ?? [];
  const needle = q.toLowerCase();
  const matched = all.filter((user) => (role === null || user.role === role) && (status === null || user.status === status) && (needle === "" || user.name.toLowerCase().includes(needle) || user.email.toLowerCase().includes(needle)));
  const pages = Math.max(1, Math.ceil(matched.length / pageSize));
  const pageParam = Number(params.get("page"));
  const page = Number.isInteger(pageParam) && pageParam >= 1 && pageParam <= pages ? pageParam : 1;
  const rows = matched.slice((page - 1) * pageSize, page * pageSize);
  const filtered = q !== "" || role !== null || status !== null;

  const replace = (changed: PlatformUser): void => {
    if (loaded.state.data) loaded.set({ ...loaded.state.data, items: loaded.state.data.items.map((user) => (user.id === changed.id ? changed : user)) });
  };
  const start = (action: Pending["action"], user: PlatformUser): void => {
    setPending({ action, user });
    setProblem(null);
    setBlocked(false);
    setIssued(null);
  };
  const close = (): void => {
    const stale = blocked;
    setPending(null);
    setIssued(null);
    // 被拒说明页面上的状态过时了：关掉以后重新取
    if (stale) loaded.reload();
  };
  const confirm = async (): Promise<void> => {
    if (pending === null || working || blocked) return;
    const { action, user } = pending;
    setWorking(true);
    setProblem(null);
    try {
      if (action === "reset") {
        // 不自动重试：重试一次就多发一个令牌、让上一个作废
        const result = await issueStaffReset(token, user.id);
        setIssued({ portal: "platform", kind: "reset", token: result.reset.token, expiresAt: result.reset.expires_at ?? null, name: result.user.name, email: result.user.email, whom: `平台员工，${roleLabel(result.user.role)}` });
      } else {
        replace(await setStaffEnabled(token, user.id, action));
        toast(action === "disable" ? `已停用「${user.name}」` : `已启用「${user.name}」`);
        setPending(null);
      }
    } catch (err) {
      if (handleAuthFailure(err)) return;
      if (err instanceof ApiError && err.code === "LAST_ADMIN_REQUIRED") {
        setBlocked(true);
        setProblem({ title: "现在不能停用。", text: "他是最后一个在用的超级管理员。请先给另一个人开一个超级管理员账号，等对方设好密码以后再停用他。" });
      } else if (err instanceof ApiError && err.code === "ACCOUNT_NOT_ACTIVATED") {
        setBlocked(true);
        setProblem({ text: "这个账号还没有设过密码，不能直接启用。请重新邀请他。", reinvite: true });
      } else if (err instanceof ApiError && err.code === "ACCOUNT_NOT_ACTIVE") {
        setBlocked(true);
        setProblem({ text: "这个账号现在不是在用的状态。待激活的请用「重新邀请」，已停用的请先「启用」。" });
      } else if (err instanceof ApiError && err.status === 404) {
        setBlocked(true);
        setProblem({ text: "找不到这个账号，它可能已被删除。" });
      } else if (action === "reset" && isUnsure(err)) setProblem({ title: "不确定有没有成功。", text: UNSURE_TEXT });
      else if (err instanceof ApiError && err.status === 403) setProblem({ text: "你没有权限做这个操作。需要的话，请联系管理员开通。" });
      else setProblem({ text: failureText(err, action === "disable" ? "停用" : action === "enable" ? "启用" : "发出") });
    } finally {
      setWorking(false);
    }
  };

  const reinviteState = (user: PlatformUser): ReinviteState => ({ reinvite: { email: user.email, name: user.name, role: user.role } });
  const columns: Column<PlatformUser>[] = [
    {
      key: "name",
      header: "姓名",
      wrap: true,
      cell: (row) => (
        <span className={highlight === row.id ? "staff-name staff-name--new" : "staff-name"}>
          {row.name}
          {row.id === me && <span className="tag">你</span>}
        </span>
      ),
    },
    { key: "email", header: "邮箱", wrap: true, cell: (row) => <span className="staff-email">{row.email}</span> },
    { key: "role", header: "角色", cell: (row) => <span className="tag">{roleLabel(row.role)}</span> },
    { key: "status", header: "状态", cell: (row) => <StatusBadge {...ACCOUNT_STATUS_BADGES[row.status]} /> },
    { key: "created", header: "创建时间", cell: (row) => <span className="table__muted">{formatLocalDateTime(row.created_at)}</span> },
    {
      key: "actions",
      header: "操作",
      cell: (row) => {
        const self = row.id === me;
        const records = canAudit ? (
          <>
            <Link role="menuitem" className="menu-item" to={auditLogPath({ actor: row.id })} state={{ actorEmail: row.email }}>
              <span className="menu-item__text">看他的操作记录</span>
            </Link>
            <Link role="menuitem" className="menu-item" to={auditLogPath({ resource: "platform_user", rid: row.id })} state={{ resourceName: row.name }}>
              <span className="menu-item__text">看这个账号的变更记录</span>
            </Link>
          </>
        ) : null;
        if (!canManage && records === null) return null;
        return (
          <Dropdown buttonClassName="button button--text button--sm" buttonContent="更多" label={`${shortName(row.name)} 的更多操作`} align="end">
            {self && <p className="menu-note">这是你自己的账号。</p>}
            {canManage && !self && row.status === "invited" && (
              <Link role="menuitem" className="menu-item" to={STAFF_NEW_PATH} state={reinviteState(row)}>
                <span className="menu-item__text">重新邀请</span>
              </Link>
            )}
            {canManage && !self && row.status === "active" && (
              <button type="button" role="menuitem" className="menu-item" onClick={() => start("reset", row)}>
                <span className="menu-item__text">发密码重置链接</span>
              </button>
            )}
            {canManage && !self && row.status === "disabled" && (
              <button type="button" role="menuitem" className="menu-item" onClick={() => start("enable", row)}>
                <span className="menu-item__text">启用</span>
              </button>
            )}
            {canManage && !self && row.status !== "disabled" && (
              <>
                <hr className="menu-divider" />
                <button type="button" role="menuitem" className="menu-item menu-item--danger" onClick={() => start("disable", row)}>
                  <span className="menu-item__text">停用</span>
                </button>
              </>
            )}
            {records !== null && canManage && !self && <hr className="menu-divider" />}
            {records}
          </Dropdown>
        );
      },
    },
  ];

  const state = loaded.state;
  const tableState: TableState = !canRead ? "loading" : state.status === "ready" ? "ready" : state.status === "forbidden" ? "forbidden" : state.status === "loading" && state.data === null ? "loading" : state.data !== null ? "ready" : "error";
  const clearFilters = (): void => setParam({ q: null, role: null, status: null });
  const empty = (
    <StateBlock
      tone="neutral"
      title="没有符合条件的员工"
      description="换个条件试试，或清空筛选。"
      action={
        <Button variant="secondary" onClick={clearFilters}>
          清空筛选
        </Button>
      }
    />
  );
  const newButton = (
    <LinkButton variant="primary" to={STAFF_NEW_PATH}>
      <Icon name="plus" />
      新增员工
    </LinkButton>
  );

  let dialog: ReactNode = null;
  if (pending !== null && issued !== null) {
    dialog = (
      <OneTimeLinkDialog
        issued={issued}
        onClose={() => {
          toast(`已给「${issued.name}」发出密码重置链接`);
          close();
        }}
      />
    );
  } else if (pending !== null) {
    const { action, user } = pending;
    const title = action === "disable" ? `停用「${user.name}」？` : action === "enable" ? `启用「${user.name}」？` : `给「${user.name}」发密码重置链接？`;
    dialog = (
      <Dialog
        open
        title={title}
        busy={working}
        onClose={close}
        footer={
          <>
            <Button variant={blocked ? "primary" : "text"} data-autofocus disabled={working} onClick={close}>
              {blocked ? "知道了" : "取消"}
            </Button>
            {!blocked && (
              <Button variant={action === "disable" ? "danger" : "primary"} loading={working} loadingText={action === "disable" ? "停用中…" : action === "enable" ? "启用中…" : "发出中…"} onClick={() => void confirm()}>
                {action === "disable" ? "停用" : action === "enable" ? "启用" : "发出"}
              </Button>
            )}
          </>
        }
      >
        <div role="alert">
          {problem !== null && (
            <Alert kind="danger">
              {problem.title && <strong className="alert__title">{problem.title}</strong>}
              <span>{problem.text}</span>
              {problem.reinvite && (
                <span className="alert__actions">
                  <Link className="link" to={STAFF_NEW_PATH} state={reinviteState(user)}>
                    去重新邀请
                  </Link>
                </span>
              )}
            </Alert>
          )}
        </div>
        {action === "disable" && (
          <p>
            停用以后，他<strong>马上不能登录</strong>，已经登录着的也会立刻退出。{user.status === "invited" ? "他还没有设过密码，之前发给他的邀请链接会作废。之后可以重新邀请。" : "之后可以重新启用。"}
          </p>
        )}
        {action === "enable" && <p>{`启用以后，他可以用原来的密码登录，角色不变（${roleLabel(user.role)}）。`}</p>}
        {action === "reset" && (
          <>
            <p>
              会生成一条重置链接（24 小时有效，只显示一次），由你发给他本人。<strong>发出链接不会改掉他现在的密码</strong>，也不会让他退出登录；他用链接设了新密码以后，旧密码才失效。请先确认提出要求的就是他本人。
            </p>
            <p className="page-intro">最后一个超级管理员自己忘了密码，页面上处理不了，要请技术在服务器上重设。</p>
          </>
        )}
      </Dialog>
    );
  }

  return shell(
    <>
      <FilterBar search={<SearchBox label="按姓名或邮箱搜索" value={q} onSearch={(value) => setParam({ q: value })} />} paramNames={["role", "status"]} active={filtered} onClear={clearFilters}>
        <Filters />
      </FilterBar>
      <div role="alert">
        {state.status === "error" && state.data !== null && (
          <Alert kind="danger">
            <strong className="alert__title">加载失败</strong>
            <span>下面是上一次取到的内容，可能已经过时。请检查网络后重试。</span>
            <span className="alert__actions">
              <Button variant="text" size="sm" onClick={loaded.reload}>
                重试
              </Button>
            </span>
          </Alert>
        )}
      </div>
      <div className="card-table">
        <DataTable label="平台员工列表" columns={columns} rows={rows} rowKey={(row) => row.id} state={tableState} onRetry={loaded.reload} empty={empty} />
      </div>
      {state.data !== null && all.length === 1 && all[0]?.id === me && <p className="page-intro">现在只有你一个人。{canManage ? "点右上角的「新增员工」给同事开账号。" : ""}</p>}
      <CursorPagination
        total={state.data ? matched.length : null}
        pageSize={pageSize}
        onPageSizeChange={(size) => setParam({ size: size === DEFAULT_PAGE_SIZE ? null : String(size) })}
        hasPrevious={page > 1}
        hasNext={page < pages}
        onPrevious={() => setParam({ page: page - 1 === 1 ? null : String(page - 1) })}
        onNext={() => setParam({ page: String(page + 1) })}
      />
      {dialog}
    </>,
    canManage ? newButton : undefined,
  );
}

// ───────────── 新增 / 重新邀请 ─────────────

export function StaffNewPage() {
  const { portal, account, token, handleAuthFailure } = usePortalSession();
  const navigate = useNavigate();
  const toast = useToast();
  const location = useLocation();
  const canManage = usePlatformCan("staff.manage");
  const given = (location.state as Partial<ReinviteState> | null)?.reinvite;
  const reinvite = given && typeof given.email === "string" && typeof given.name === "string" && ROLE_KEYS.includes(given.role) ? given : null;
  const title = reinvite ? `重新邀请 ${reinvite.name}` : "新增员工";
  useDocumentTitle(`${reinvite ? "重新邀请" : "新增员工"} · NOZOMI ${portal.name}`);
  const [email, setEmail] = useState(reinvite?.email ?? "");
  const [name, setName] = useState(reinvite?.name ?? "");
  const [role, setRole] = useState<PlatformRole | null>(reinvite?.role ?? null);
  const [attempted, setAttempted] = useState(false);
  const [working, setWorking] = useState(false);
  const [taken, setTaken] = useState(false);
  const [refused, setRefused] = useState(false);
  const [problem, setProblem] = useState<{ title?: string; text: string } | null>(null);
  /** 建好的账号和这一次应答里的邀请令牌：只在这里，对话框关闭时清掉并回到列表 */
  const [created, setCreated] = useState<{ id: string; issued: IssuedLink } | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const dirty = created === null && (email !== (reinvite?.email ?? "") || name !== (reinvite?.name ?? "") || role !== (reinvite?.role ?? null));
  useLeaveGuard(dirty && !working, setLeaving);

  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName={reinvite ? "重新邀请" : "新增员工"} trail={[...TRAIL, { label: "平台员工", to: STAFF_LIST_PATH }]}>
      <Page title={title} width="form">
        {content}
      </Page>
    </AppShell>
  );
  if (account.status === "ready" && !canManage) return shell(NO_ACCESS);

  const locked = working || created !== null;
  const emailError = taken ? "这个邮箱已经有一个设过密码的平台员工账号了。他忘了密码的话，请在列表里给他「发密码重置链接」；账号被停用了的话，请在列表里「启用」。" : refused ? EMAIL_REFUSED_TEXT : attempted ? emailProblem(email) : null;
  const nameError = attempted ? nameProblem(name, "姓名") : null;
  const roleError = attempted && role === null ? "请选择角色" : null;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (locked) return;
    setAttempted(true);
    setProblem(null);
    setTaken(false);
    setRefused(false);
    if (emailProblem(email) !== null) return document.getElementById("staff-email")?.focus();
    if (nameProblem(name, "姓名") !== null) return document.getElementById("staff-name")?.focus();
    if (role === null) return document.querySelector<HTMLElement>('input[name="staff-role"]')?.focus();
    setWorking(true);
    try {
      // 不自动重试：重试一次就多发一个令牌、让上一个作废
      const result = await createStaff(token, { email: email.trim(), name: name.trim(), role });
      setCreated({ id: result.user.id, issued: { portal: "platform", kind: "invite", token: result.invite.token, expiresAt: result.invite.expires_at ?? null, name: result.user.name, email: result.user.email, whom: `平台员工，${roleLabel(result.user.role)}` } });
    } catch (err) {
      if (handleAuthFailure(err)) return;
      if (err instanceof ApiError && err.code === "EMAIL_TAKEN") {
        setTaken(true);
        document.getElementById("staff-email")?.focus();
      } else if (emailRefused(err)) {
        setRefused(true);
        document.getElementById("staff-email")?.focus();
      } else if (isUnsure(err)) setProblem({ title: "不确定有没有成功。", text: UNSURE_TEXT });
      else if (err instanceof ApiError && err.status === 403) setProblem({ text: "你没有权限新增员工。需要的话，请联系管理员开通。" });
      else setProblem({ text: failureText(err, "新增") });
    } finally {
      setWorking(false);
    }
  };

  return shell(
    <form className="form" noValidate onSubmit={(event) => void submit(event)}>
      <div role="alert">
        {problem !== null && (
          <Alert kind="danger">
            {problem.title && <strong className="alert__title">{problem.title}</strong>}
            <span>{problem.text}</span>
          </Alert>
        )}
      </div>
      <section className="card">
        {reinvite && <p className="page-intro">会发出一条新的邀请链接，之前那条作废。姓名和角色按这次填的更新。</p>}
        <div className="field">
          <label className="field__label" htmlFor="staff-email">
            邮箱
            <span className="field__required" aria-hidden="true">
              {" *"}
            </span>
          </label>
          <input
            className="input"
            id="staff-email"
            type="email"
            autoComplete="off"
            aria-invalid={emailError !== null || undefined}
            aria-describedby="staff-email-error staff-email-hint"
            readOnly={locked || reinvite !== null}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setTaken(false);
              setRefused(false);
            }}
          />
          <FieldErrors id="staff-email-error" errors={emailError !== null ? [emailError] : []} />
          <p className="field__hint" id="staff-email-hint">
            以后用它登录运营后台。平台员工和供应商的账号是两套，同一个邮箱可以两边各有一个。
          </p>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="staff-name">
            姓名
            <span className="field__required" aria-hidden="true">
              {" *"}
            </span>
          </label>
          <input className="input" id="staff-name" type="text" autoComplete="off" aria-invalid={nameError !== null || undefined} aria-describedby="staff-name-error" readOnly={locked} value={name} onChange={(event) => setName(event.target.value)} />
          <FieldErrors id="staff-name-error" errors={nameError !== null ? [nameError] : []} />
        </div>
        <fieldset className="field fieldset" aria-describedby="staff-role-error staff-role-hint" aria-invalid={roleError !== null || undefined}>
          <legend className="field__label">
            角色
            <span className="field__required" aria-hidden="true">
              {" *"}
            </span>
          </legend>
          <div className="choices choices--stacked">
            {PLATFORM_ROLES.map((entry) => {
              const abilities = roleAbilities(entry.key);
              return (
                <label key={entry.key} className="choice">
                  <input type="radio" name="staff-role" value={entry.key} checked={role === entry.key} disabled={locked} aria-describedby={`staff-role-${entry.key}`} onChange={() => setRole(entry.key)} />
                  <span className="choice__text">
                    {entry.name}
                    <span className="choice__hint" id={`staff-role-${entry.key}`}>
                      {ROLE_DUTIES[entry.key]}
                      {abilities.length > 0 && ` 现在能做的：${abilities.join("、")}。`}
                      {roleNotLiveYet(entry.key) && <span className="role-pending"> 他负责的模块还没有上线，现在登录后只能看主数据。</span>}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          <FieldErrors id="staff-role-error" errors={roleError !== null ? [roleError] : []} />
          {role === "super_admin" && (
            <Alert kind="warning">
              <strong className="alert__title">超级管理员可以管理所有平台员工、看到全部审计日志。</strong>
              <span>请只给确实需要的人。</span>
            </Alert>
          )}
          <p className="field__hint" id="staff-role-hint">
            角色决定他能看到哪些菜单、能做哪些操作。<strong>账号启用以后角色暂时不能改</strong>，选错了只能停用后重新建。不确定时先给「只读」。
          </p>
        </fieldset>
        <Alert kind="info">
          <strong className="alert__title">系统不会给对方发邮件。</strong>
          <span>{`点「${reinvite ? "重新邀请" : "新增"}」后会显示一条邀请链接，只显示一次。`}</span>
        </Alert>
      </section>
      <div className="form-bar">
        <Button
          variant="text"
          disabled={locked}
          onClick={() => {
            if (dirty) setLeaving(STAFF_LIST_PATH);
            else void navigate(STAFF_LIST_PATH);
          }}
        >
          取消
        </Button>
        <Button variant="primary" type="submit" loading={working} loadingText={reinvite ? "邀请中…" : "新增中…"} disabled={created !== null}>
          {reinvite ? "重新邀请" : "新增"}
        </Button>
      </div>
      {created !== null && (
        <OneTimeLinkDialog
          issued={created.issued}
          onClose={() => {
            const { id, issued } = created;
            // 先把令牌清掉，再回列表：带过去的只有账号的编号
            setCreated(null);
            toast(`已邀请「${issued.name}」`);
            void navigate(STAFF_LIST_PATH, { replace: true, state: { invited: id } });
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
                setEmail(reinvite?.email ?? "");
                setName(reinvite?.name ?? "");
                setRole(reinvite?.role ?? null);
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
