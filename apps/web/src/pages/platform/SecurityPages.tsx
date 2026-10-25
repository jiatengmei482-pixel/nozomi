/**
 * 运营后台的账号安全（ADR 0030，docs/design/pages/platform-security.md）：
 * - 个人页「账号安全」：两步验证的状态、换手机（重新绑定）、重新生成恢复码；
 * - 平台员工详情：改姓名、角色、IP 白名单，发起重置两步验证（另一位超级管理员审核）；
 * - 角色：列表、内置角色（只读模板）、自建角色的新建 / 发起修改 / 删除。
 * 密钥原文和恢复码只在各自那一次应答里出现：只放在组件的内存状态里，离开页面就没了。
 */
import { MENU_OPERATIONS, isPlatformRole } from "@nozomi/domain";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ApiError, fetchMe } from "../../api/client.ts";
import { listAllChannels } from "../../api/channels.ts";
import { type EnrollmentStart, type Role, type RoleInput, type StaffDetail, confirmEnrollment, createRole, deleteRole, getRole, getStaff, listRoles, regenerateRecoveryCodes, requestRoleChange, requestStaffMfaReset, startEnrollment, updateStaff } from "../../api/platform-security.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button, LinkButton } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { FieldErrors, RadioGroup, SelectField, StaticField } from "../../components/FormFields.tsx";
import { Icon } from "../../components/Icon.tsx";
import { CodeField, EnrollmentForm, RecoveryCodesBlock } from "../../components/MfaParts.tsx";
import { MultiCombobox } from "../../components/MultiCombobox.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { TextField } from "../../components/TextField.tsx";
import { useToast } from "../../components/Toast.tsx";
import { cityChoices } from "../../lib/channel-display.ts";
import { failureText } from "../../lib/failure.ts";
import { formatLocalDateTime } from "../../lib/master-display.ts";
import { codeProblem, mfaFailureText, recoveryCodeProblem } from "../../lib/mfa-display.ts";
import { ACCOUNT_STATUS_BADGES } from "../../lib/platform-display.ts";
import { APPROVALS_PAGE_PATH } from "../../lib/channel-display.ts";
import { ROLE_LIST_PATH, ROLE_NEW_PATH, STAFF_LIST_PATH, rolePath } from "../../lib/platform-paths.ts";
import { roleName } from "../../lib/portal.ts";
import { allowlistProblems, permissionMatrix, splitAllowlist, toggleGrant } from "../../lib/role-form.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan } from "../../lib/use-master-access.ts";
import { useAllCities } from "../master/shared.tsx";

const NO_ACCESS = <StateBlock tone="neutral" title="你没有权限查看这里" description="需要的话，请联系管理员开通。" />;
const SETTINGS = { label: "系统设置" };

// ───────────── 个人页：账号安全 ─────────────

type SecurityStep = { kind: "idle" } | { kind: "confirm-identity"; purpose: "rebind" | "codes" } | { kind: "rebind"; started: EnrollmentStart } | { kind: "codes"; codes: string[]; at: Date };

export function AccountSecurityPage() {
  const { portal, account, token, handleAuthFailure, reloadAccount } = usePortalSession();
  useDocumentTitle(`账号安全 · NOZOMI ${portal.name}`);
  const toast = useToast();
  const me = useLoad("account-security-me", (session) => fetchMe("platform", session));
  const [step, setStep] = useState<SecurityStep>({ kind: "idle" });
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState("");
  const [attempted, setAttempted] = useState(false);
  const email = account.status === "ready" ? account.account.email : "";

  const close = (): void => {
    setStep({ kind: "idle" });
    setProblem(null);
    setCode("");
    setRecovery("");
    setAttempted(false);
    setUseRecovery(false);
  };
  const fail = (err: unknown): void => {
    if (handleAuthFailure(err)) return;
    setProblem(mfaFailureText(err));
  };
  const identityProblem = !attempted ? null : useRecovery ? recoveryCodeProblem(recovery) : codeProblem(code);
  const confirmIdentity = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (step.kind !== "confirm-identity" || working) return;
    setAttempted(true);
    if ((useRecovery ? recoveryCodeProblem(recovery) : codeProblem(code)) !== null) return;
    const factor = useRecovery ? { recovery_code: recovery.trim() } : { code };
    setWorking(true);
    setProblem(null);
    try {
      if (step.purpose === "rebind") setStep({ kind: "rebind", started: await startEnrollment(token, factor) });
      else {
        const result = await regenerateRecoveryCodes(token, factor);
        setStep({ kind: "codes", codes: result.recovery_codes, at: new Date() });
        me.reload();
      }
      setCode("");
      setRecovery("");
      setAttempted(false);
    } catch (err) {
      fail(err);
    } finally {
      setWorking(false);
    }
  };
  const confirmRebind = async (newCode: string): Promise<void> => {
    setWorking(true);
    setProblem(null);
    try {
      const result = await confirmEnrollment(token, newCode);
      setStep({ kind: "codes", codes: result.recovery_codes, at: new Date() });
      toast("已换上新的验证器，其他设备上的登录都已退出");
      me.reload();
      reloadAccount();
    } catch (err) {
      fail(err);
    } finally {
      setWorking(false);
    }
  };

  const factor = me.state.data?.second_factor ?? null;
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="账号安全">
      <Page title="账号安全" width="form">
        {content}
      </Page>
    </AppShell>
  );
  if (factor === null) return shell(me.state.status === "error" ? <StateBlock title="加载失败" description="请检查网络后重试。" action={<Button variant="secondary" onClick={me.reload}>重试</Button>} /> : <Skeleton lines={["long", "long"]} />);

  const remaining = factor.recovery_codes_remaining ?? 0;
  let dialog: ReactNode = null;
  if (step.kind === "confirm-identity") {
    dialog = (
      <Dialog open size="form" title={step.purpose === "rebind" ? "换手机：先确认是你本人" : "重新生成恢复码：先确认是你本人"} busy={working} onClose={close} footer={<Button variant="text" onClick={close} disabled={working}>取消</Button>}>
        <form className="form" noValidate onSubmit={(event) => void confirmIdentity(event)}>
          <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
          <p>{step.purpose === "rebind" ? "输入现在验证器上的动态码（旧手机丢了的话用一个恢复码）。新的验证器绑好之前，旧的照常可用。" : "输入现在验证器上的动态码（或一个恢复码）。生成以后，旧的一组恢复码全部作废。"}</p>
          {useRecovery ? (
            <TextField label="恢复码" autoComplete="off" autoCapitalize="none" spellCheck={false} value={recovery} onChange={(event) => setRecovery(event.target.value)} errors={identityProblem ? [identityProblem] : []} />
          ) : (
            <CodeField value={code} onChange={setCode} errors={identityProblem ? [identityProblem] : []} disabled={working} />
          )}
          <p>
            <button type="button" className="link link--button" onClick={() => setUseRecovery(!useRecovery)}>
              {useRecovery ? "用验证器的动态码" : "用恢复码"}
            </button>
          </p>
          <div className="form__actions">
            <Button type="submit" variant="primary" loading={working} loadingText="正在确认…">
              确认
            </Button>
          </div>
        </form>
      </Dialog>
    );
  } else if (step.kind === "rebind") {
    dialog = (
      <Dialog open size="form" title="绑定新的验证器" busy={working} onClose={close} footer={<Button variant="text" onClick={close} disabled={working}>取消（继续用旧的）</Button>}>
        <EnrollmentForm started={step.started} working={working} problem={problem} onConfirm={(value) => void confirmRebind(value)} />
      </Dialog>
    );
  } else if (step.kind === "codes") {
    dialog = (
      <Dialog open size="form" title="新的恢复码" sealed onClose={close}>
        <RecoveryCodesBlock email={email} codes={step.codes} issuedAt={step.at} onDone={close} doneLabel="完成" />
      </Dialog>
    );
  }

  return shell(
    <>
      <section className="card" aria-labelledby="mfa-title">
        <h2 className="card__title" id="mfa-title">
          两步验证
        </h2>
        <p className="page-intro">运营后台必须开启两步验证：每次登录，除了密码还要输入手机验证器上的动态码。</p>
        <dl className="details">
          <div>
            <dt>状态</dt>
            <dd>
              <StatusBadge tone="success" label="已开启" />
            </dd>
          </div>
          <div>
            <dt>绑定时间</dt>
            <dd>{factor.enabled_at ? formatLocalDateTime(factor.enabled_at) : "—"}</dd>
          </div>
          <div>
            <dt>剩余恢复码</dt>
            <dd>{`${remaining} 个`}</dd>
          </div>
        </dl>
        {remaining <= 3 && (
          <Alert kind="warning">{remaining === 0 ? "恢复码已经用完了。手机丢了的话就只能请超级管理员重置，请现在重新生成一组。" : `恢复码只剩 ${remaining} 个了，建议重新生成一组。`}</Alert>
        )}
        <div className="card__actions">
          <Button variant="secondary" onClick={() => setStep({ kind: "confirm-identity", purpose: "rebind" })}>
            换手机（重新绑定验证器）
          </Button>
          <Button variant="secondary" onClick={() => setStep({ kind: "confirm-identity", purpose: "codes" })}>
            重新生成恢复码
          </Button>
        </div>
        <p className="field__hint">手机和恢复码都找不到了：请另一位超级管理员在「平台员工」里重置你的两步验证。不能自己关掉两步验证。</p>
      </section>
      {dialog}
    </>,
  );
}

// ───────────── 平台员工详情 ─────────────

function roleLabelOf(key: string, roles: readonly Role[] | null, fallback: string): string {
  return roleName("platform", key) ?? roles?.find((role) => role.key === key)?.name ?? fallback;
}

/** 新增员工、员工详情里可选的角色：内置角色 + 自建角色（看得到角色列表时）。 */
export function useRoleOptions(): { options: { value: string; label: string; hint?: string }[]; roles: Role[] | null } {
  const canReadRoles = usePlatformCan("role.read");
  const roles = useLoad("staff-role-options", canReadRoles ? listRoles : null);
  const items = roles.state.data?.items ?? null;
  const options = (items ?? []).map((role) => ({ value: role.key, label: role.builtin ? role.name : `${role.name}（自建）`, ...(role.description ? { hint: role.description } : {}) }));
  return { options, roles: items };
}

export function StaffDetailPage() {
  const { portal, account, token, handleAuthFailure } = usePortalSession();
  const { id = "" } = useParams();
  const toast = useToast();
  const canRead = usePlatformCan("staff.read");
  const canManage = usePlatformCan("staff.manage");
  const loaded = useLoad<StaffDetail>(`staff-detail:${id}`, canRead ? (session) => getStaff(session, id) : null);
  const { options: roleOptions, roles } = useRoleOptions();
  const [editing, setEditing] = useState<{ name: string; role: string; allowlist: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetNote, setResetNote] = useState("");
  const [resetProblem, setResetProblem] = useState<string | null>(null);
  const staff = loaded.state.data;
  useDocumentTitle(`${staff?.name ?? "平台员工"} · NOZOMI ${portal.name}`);
  const me = account.status === "ready" ? account.account.id : null;

  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName={staff?.name ?? "平台员工"} trail={[SETTINGS, { label: "平台员工", to: STAFF_LIST_PATH }]}>
      <Page title={staff?.name ?? "平台员工"} width="form">
        {content}
      </Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);
  if (staff === null) {
    if (loaded.state.status === "not-found") return shell(<StateBlock tone="neutral" title="找不到这个员工" description="他可能已经被删除，或者链接不完整。" action={<LinkButton variant="secondary" to={STAFF_LIST_PATH}>回到平台员工</LinkButton>} />);
    return shell(loaded.state.status === "error" ? <StateBlock title="加载失败" description="请检查网络后重试。" action={<Button variant="secondary" onClick={loaded.reload}>重试</Button>} /> : <Skeleton lines={["long", "long", "long"]} />);
  }
  const self = staff.id === me;
  const allowlistErrors = editing === null ? [] : allowlistProblems(editing.allowlist);

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (editing === null || saving || allowlistErrors.length > 0 || editing.name.trim() === "") return;
    setSaving(true);
    setProblem(null);
    try {
      const body = {
        ...(editing.name.trim() !== staff.name ? { name: editing.name.trim() } : {}),
        ...(editing.role !== staff.role ? { role: editing.role } : {}),
        ip_allowlist: splitAllowlist(editing.allowlist),
      };
      loaded.set(await updateStaff(token, staff.id, body));
      setEditing(null);
      toast("已保存");
    } catch (err) {
      if (handleAuthFailure(err)) return;
      if (err instanceof ApiError && err.code === "IP_ALLOWLIST_EXCLUDES_CURRENT") setProblem(`这样保存以后，你现在的网络地址（${String(err.details["current_ip"] ?? "")}）就不在名单里了，你会马上用不了运营后台。请先把它加进去。`);
      else if (err instanceof ApiError && err.code === "LAST_ADMIN_REQUIRED") setProblem("他是最后一个在用的超级管理员，不能改成别的角色。请先给另一个人开一个超级管理员账号。");
      else if (err instanceof ApiError && err.code === "OWN_ROLE_UNCHANGEABLE") setProblem("不能修改自己的角色，请另一位超级管理员处理。");
      else setProblem(failureText(err, "保存"));
    } finally {
      setSaving(false);
    }
  };
  const requestReset = async (): Promise<void> => {
    setSaving(true);
    setResetProblem(null);
    try {
      await requestStaffMfaReset(token, staff.id, resetNote.trim());
      setResetOpen(false);
      toast("已提交，等另一位超级管理员审核后生效");
    } catch (err) {
      if (handleAuthFailure(err)) return;
      setResetProblem(failureText(err, "提交"));
    } finally {
      setSaving(false);
    }
  };

  return shell(
    <>
      <section className="card" aria-labelledby="staff-basic">
        <h2 className="card__title" id="staff-basic">
          账号
        </h2>
        {editing === null ? (
          <>
            <dl className="details">
              <div>
                <dt>邮箱</dt>
                <dd>{staff.email}</dd>
              </div>
              <div>
                <dt>姓名</dt>
                <dd>{staff.name}</dd>
              </div>
              <div>
                <dt>角色</dt>
                <dd>
                  <span className="tag">{roleLabelOf(staff.role, roles, staff.role_name)}</span>
                </dd>
              </div>
              <div>
                <dt>状态</dt>
                <dd>
                  <StatusBadge {...ACCOUNT_STATUS_BADGES[staff.status]} />
                </dd>
              </div>
              <div>
                <dt>IP 白名单</dt>
                <dd>{staff.ip_allowlist.length > 0 ? staff.ip_allowlist.join("、") : staff.role_ip_allowlist.length > 0 ? `按角色的：${staff.role_ip_allowlist.join("、")}` : "不限制"}</dd>
              </div>
            </dl>
            {canManage && (
              <div className="card__actions">
                <Button variant="secondary" onClick={() => setEditing({ name: staff.name, role: staff.role, allowlist: staff.ip_allowlist.join("\n") })}>
                  修改
                </Button>
              </div>
            )}
          </>
        ) : (
          <form className="form" noValidate onSubmit={(event) => void save(event)}>
            <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
            <TextField label="姓名" value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} errors={editing.name.trim() === "" ? ["请填写姓名"] : []} />
            {self ? (
              <StaticField label="角色" hint="不能修改自己的角色，请另一位超级管理员处理。">
                {roleLabelOf(staff.role, roles, staff.role_name)}
              </StaticField>
            ) : (
              <SelectField label="角色" value={editing.role} options={roleOptions.length > 0 ? roleOptions : [{ value: staff.role, label: roleLabelOf(staff.role, roles, staff.role_name) }]} onChange={(value) => setEditing({ ...editing, role: value })} hint="改了立即生效，不用他重新登录。" />
            )}
            <div className="field">
              <label className="field__label" htmlFor="staff-allowlist">
                IP 白名单
              </label>
              <textarea className="input textarea" id="staff-allowlist" rows={4} spellCheck={false} aria-describedby="staff-allowlist-error staff-allowlist-hint" aria-invalid={allowlistErrors.length > 0 || undefined} value={editing.allowlist} onChange={(event) => setEditing({ ...editing, allowlist: event.target.value })} />
              <FieldErrors id="staff-allowlist-error" errors={allowlistErrors} />
              <p className="field__hint" id="staff-allowlist-hint">
                一行一个地址或地址段，如 203.0.113.0/24、2001:db8::/32。留空 = 按他的角色的名单；角色也没有名单就不限制。不在名单里的地址登录不了，已经登录的也会被挡住。
              </p>
            </div>
            <div className="form-bar">
              <Button variant="text" disabled={saving} onClick={() => setEditing(null)}>
                取消
              </Button>
              <Button variant="primary" type="submit" loading={saving} loadingText="保存中…">
                保存
              </Button>
            </div>
          </form>
        )}
      </section>
      <section className="card" aria-labelledby="staff-mfa">
        <h2 className="card__title" id="staff-mfa">
          两步验证
        </h2>
        <dl className="details">
          <div>
            <dt>状态</dt>
            <dd>{staff.mfa_enabled ? <StatusBadge tone="success" label="已绑定" /> : <StatusBadge tone="warning" label="还没绑定" />}</dd>
          </div>
          {staff.mfa_enabled && (
            <>
              <div>
                <dt>绑定时间</dt>
                <dd>{staff.mfa_enabled_at ? formatLocalDateTime(staff.mfa_enabled_at) : "—"}</dd>
              </div>
              <div>
                <dt>剩余恢复码</dt>
                <dd>{`${staff.recovery_codes_remaining ?? 0} 个`}</dd>
              </div>
            </>
          )}
        </dl>
        {!staff.mfa_enabled && <p className="page-intro">他下次登录时，输完密码会被引导绑定。</p>}
        {canManage && staff.mfa_enabled && !self && (
          <div className="card__actions">
            <Button variant="secondary" onClick={() => setResetOpen(true)}>
              重置两步验证…
            </Button>
          </div>
        )}
        {self && <p className="field__hint">你自己的两步验证在右上角账号菜单的「账号安全」里管理。</p>}
      </section>
      <Dialog
        open={resetOpen}
        title={`重置「${staff.name}」的两步验证？`}
        busy={saving}
        onClose={() => setResetOpen(false)}
        footer={
          <>
            <Button variant="text" data-autofocus disabled={saving} onClick={() => setResetOpen(false)}>
              取消
            </Button>
            <Button variant="danger" loading={saving} loadingText="提交中…" onClick={() => void requestReset()}>
              提交审核
            </Button>
          </>
        }
      >
        <div role="alert">{resetProblem !== null && <Alert kind="danger">{resetProblem}</Alert>}</div>
        <p>
          用于他换了手机又没有恢复码。要<strong>另一位超级管理员</strong>在「<Link className="link" to={APPROVALS_PAGE_PATH}>待审核</Link>」里批准后才生效；生效后他马上退出登录，下次用密码登录时重新绑定。请先当面或电话确认提出要求的就是他本人。
        </p>
        <TextField label="说明（选填）" value={resetNote} maxLength={500} onChange={(event) => setResetNote(event.target.value)} hint="写给审核的同事看，如「手机丢了，已电话确认」。" />
      </Dialog>
    </>,
  );
}

// ───────────── 角色 ─────────────

export function RoleListPage() {
  const { portal, account } = usePortalSession();
  useDocumentTitle(`角色 · NOZOMI ${portal.name}`);
  const canRead = usePlatformCan("role.read");
  const canManage = usePlatformCan("role.manage");
  const loaded = useLoad("platform-roles", canRead ? listRoles : null);
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="角色" trail={[SETTINGS]}>
      <Page
        title="角色"
        {...(canManage
          ? {
              action: (
                <LinkButton variant="primary" to={ROLE_NEW_PATH}>
                  <Icon name="plus" />
                  新建角色
                </LinkButton>
              ),
            }
          : {})}
      >
        {content}
      </Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);
  const items = loaded.state.data?.items ?? null;
  if (items === null) return shell(loaded.state.status === "error" ? <StateBlock title="加载失败" description="请检查网络后重试。" action={<Button variant="secondary" onClick={loaded.reload}>重试</Button>} /> : <Skeleton lines={["long", "long", "long"]} />);
  const row = (role: Role) => (
    <tr key={role.key}>
      <th scope="row">
        <Link className="link" to={rolePath(role.key)}>
          {role.name}
        </Link>
        {role.builtin && <span className="tag">内置</span>}
      </th>
      <td className="table__muted">{role.description ?? (role.builtin ? "需求文档定义的岗位，只读模板" : "—")}</td>
      <td>{role.data_scope.city_ids === null && role.data_scope.channel_ids === null ? "不限" : "有限定"}</td>
      <td>{role.ip_allowlist.length > 0 ? `${role.ip_allowlist.length} 条` : "不限"}</td>
      <td>{`${role.staff_count} 人`}</td>
    </tr>
  );
  return shell(
    <>
      <p className="page__lead">内置角色是只读模板：要调整就「复制为新角色」再改。自建角色的修改要另一位超级管理员审核后才生效；新建和删除（没人用时）直接生效。</p>
      <div className="table-wrap">
        <div className="table-scroll" tabIndex={0} role="region" aria-label="角色列表">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">角色</th>
                <th scope="col">说明</th>
                <th scope="col">数据范围</th>
                <th scope="col">IP 白名单</th>
                <th scope="col">员工</th>
              </tr>
            </thead>
            <tbody>{items.map(row)}</tbody>
          </table>
        </div>
      </div>
    </>,
  );
}

interface RoleDraft {
  name: string;
  description: string;
  grants: string[];
  allCities: boolean;
  cityIds: string[];
  allChannels: boolean;
  channelIds: string[];
  allowlist: string;
}

function draftOf(role: Role | null, copy = false): RoleDraft {
  if (role === null) return { name: "", description: "", grants: [], allCities: true, cityIds: [], allChannels: true, channelIds: [], allowlist: "" };
  return {
    name: copy ? `${role.name}（副本）` : role.name,
    description: role.description ?? "",
    grants: role.grants.filter((grant) => !["staff:edit", "roles:edit", "roles:review"].includes(grant)),
    allCities: role.data_scope.city_ids === null,
    cityIds: role.data_scope.city_ids ?? [],
    allChannels: role.data_scope.channel_ids === null,
    channelIds: role.data_scope.channel_ids ?? [],
    allowlist: role.ip_allowlist.join("\n"),
  };
}

function inputOf(draft: RoleDraft): RoleInput {
  return {
    name: draft.name.trim(),
    description: draft.description.trim() === "" ? null : draft.description.trim(),
    grants: draft.grants,
    data_scope: { city_ids: draft.allCities ? null : draft.cityIds, channel_ids: draft.allChannels ? null : draft.channelIds },
    ip_allowlist: splitAllowlist(draft.allowlist),
  };
}

function PermissionMatrix({ grants, readOnly, onToggle }: { grants: readonly string[]; readOnly: boolean; onToggle?(grant: string, on: boolean): void }) {
  const rows = permissionMatrix();
  return (
    <div className="table-wrap">
      <div className="table-scroll" tabIndex={0} role="region" aria-label="菜单 × 操作">
        <table className="table permission-matrix">
          <thead>
            <tr>
              <th scope="col">菜单</th>
              {MENU_OPERATIONS.map((operation) => (
                <th key={operation.key} scope="col">
                  {operation.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.name}</th>
                {MENU_OPERATIONS.map((operation) => {
                  const cell = row.cells[operation.key];
                  const checked = grants.includes(cell.grant);
                  if (!cell.exists) return <td key={operation.key} className="table__muted">—</td>;
                  if (readOnly || cell.superAdminOnly) {
                    return (
                      <td key={operation.key}>
                        {checked ? "✓" : cell.superAdminOnly ? <span className="table__muted">只归超级管理员</span> : <span className="visually-hidden">没有</span>}
                      </td>
                    );
                  }
                  return (
                    <td key={operation.key}>
                      <input type="checkbox" aria-label={`${row.name} · ${operation.name}`} checked={checked} onChange={(event) => onToggle?.(cell.grant, event.target.checked)} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function RoleEditorPage() {
  const { key = "" } = useParams();
  const isNew = key === "" || key === "new";
  const { portal, account, token, handleAuthFailure } = usePortalSession();
  const navigate = useNavigate();
  const toast = useToast();
  const canRead = usePlatformCan("role.read");
  const canManage = usePlatformCan("role.manage");
  const loaded = useLoad<Role | null>(`platform-role:${key}`, canRead ? (session) => (isNew ? Promise.resolve(null) : getRole(session, key)) : null);
  const [search] = useSearchParams();
  const copyFrom = search.get("from");
  const template = useLoad<Role | null>(`platform-role-template:${copyFrom ?? ""}`, canRead && isNew && copyFrom !== null ? (session) => getRole(session, copyFrom) : null);
  const role = loaded.state.data ?? null;
  const [draft, setDraft] = useState<RoleDraft | null>(null);
  const [note, setNote] = useState("");
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const cities = useAllCities();
  const canSeeChannels = usePlatformCan("channel.read");
  const channels = useLoad("role-editor-channels", canSeeChannels ? listAllChannels : null);
  const cityOptions = useMemo(() => cityChoices(cities.state.data ?? []), [cities.state.data]);
  const channelOptions = useMemo(() => (channels.state.data?.items ?? []).map((channel) => ({ value: channel.id, label: channel.name })), [channels.state.data]);
  const title = isNew ? "新建角色" : (role?.name ?? "角色");
  useDocumentTitle(`${title} · NOZOMI ${portal.name}`);

  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName={title} trail={[SETTINGS, { label: "角色", to: ROLE_LIST_PATH }]}>
      <Page title={title}>{content}</Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);
  if (!isNew && role === null) {
    if (loaded.state.status === "not-found") return shell(<StateBlock tone="neutral" title="找不到这个角色" description="它可能已经被删除。" action={<LinkButton variant="secondary" to={ROLE_LIST_PATH}>回到角色</LinkButton>} />);
    return shell(loaded.state.status === "error" ? <StateBlock title="加载失败" description="请检查网络后重试。" action={<Button variant="secondary" onClick={loaded.reload}>重试</Button>} /> : <Skeleton lines={["long", "long", "long"]} />);
  }
  if (isNew && !canManage && account.status === "ready") return shell(NO_ACCESS);
  if (isNew && copyFrom !== null && template.state.data === null && template.state.status === "loading") return shell(<Skeleton lines={["long", "long"]} />);

  const editable = canManage && (isNew || (role !== null && !role.builtin));
  const current = draft ?? draftOf(isNew ? (template.state.data ?? null) : role, isNew);
  const change = (changes: Partial<RoleDraft>): void => setDraft({ ...current, ...changes });
  const allowlistErrors = allowlistProblems(current.allowlist);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (working || current.name.trim() === "" || allowlistErrors.length > 0) return;
    setWorking(true);
    setProblem(null);
    try {
      if (isNew) {
        const created = await createRole(token, inputOf(current));
        toast(`已新建角色「${created.name}」`);
        void navigate(rolePath(created.key), { replace: true });
      } else if (role !== null) {
        await requestRoleChange(token, role.key, { ...inputOf(current), ...(note.trim() === "" ? {} : { request_note: note.trim() }) });
        toast("已提交，等另一位超级管理员审核后生效");
        setDraft(null);
        setNote("");
      }
    } catch (err) {
      if (handleAuthFailure(err)) return;
      if (err instanceof ApiError && err.code === "ROLE_NAME_TAKEN") setProblem("已经有同名的角色了，换个名字。");
      else if (err instanceof ApiError && err.code === "VALIDATION_FAILED" && JSON.stringify(err.details).includes("UNCHANGED")) setProblem("和现在的角色一样，没有要提交的改动。");
      else setProblem(failureText(err, "提交"));
    } finally {
      setWorking(false);
    }
  };
  const remove = async (): Promise<void> => {
    if (role === null) return;
    setWorking(true);
    setProblem(null);
    try {
      await deleteRole(token, role.key);
      toast(`已删除角色「${role.name}」`);
      void navigate(ROLE_LIST_PATH, { replace: true });
    } catch (err) {
      if (handleAuthFailure(err)) return;
      setDeleting(false);
      setProblem(err instanceof ApiError && err.code === "ROLE_IN_USE" ? `还有 ${String(err.details["staff_count"] ?? "")} 个账号在用这个角色，先在「平台员工」里把他们改成别的角色再删。` : failureText(err, "删除"));
    } finally {
      setWorking(false);
    }
  };

  const scopeSection = (
    <section className="card" aria-labelledby="role-scope">
      <h2 className="card__title" id="role-scope">
        数据范围
      </h2>
      <p className="page-intro">限定之后，这个角色只看得到选中的城市、渠道的数据：城市管订单；渠道管渠道和它下面的一切、订单、渠道类的待审核、按渠道试算。限定了渠道的人不能新建渠道。</p>
      <RadioGroup legend="城市" name="role-city-scope" readOnly={!editable} options={[{ value: "all", label: "不限" }, { value: "listed", label: "只看选中的城市" }]} value={current.allCities ? "all" : "listed"} onChange={(value: "all" | "listed") => change({ allCities: value === "all" })} />
      {!current.allCities &&
        (editable ? (
          <MultiCombobox label="城市" options={cityOptions} value={current.cityIds} placeholder="输入城市名称或编码查找" loading={cities.state.data === null && cities.state.status === "loading"} loadFailed={cities.state.data === null && cities.state.status === "error"} onChange={(value) => change({ cityIds: value })} />
        ) : (
          <StaticField label="选中的城市">{(role?.data_scope.cities ?? []).map((city) => city.name ?? city.id).join("、") || "一个都不看"}</StaticField>
        ))}
      <RadioGroup legend="渠道" name="role-channel-scope" readOnly={!editable} options={[{ value: "all", label: "不限" }, { value: "listed", label: "只看选中的渠道" }]} value={current.allChannels ? "all" : "listed"} onChange={(value: "all" | "listed") => change({ allChannels: value === "all" })} />
      {!current.allChannels &&
        (editable ? (
          <MultiCombobox label="渠道" options={channelOptions} value={current.channelIds} placeholder="输入渠道名称查找" loading={channels.state.data === null && channels.state.status === "loading"} loadFailed={channels.state.data === null && channels.state.status === "error"} onChange={(value) => change({ channelIds: value })} />
        ) : (
          <StaticField label="选中的渠道">{(role?.data_scope.channels ?? []).map((channel) => channel.name ?? channel.id).join("、") || "一个都不看"}</StaticField>
        ))}
    </section>
  );

  return shell(
    <form className="form" noValidate onSubmit={(event) => void submit(event)}>
      <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
      {role?.builtin && (
        <Alert kind="info">
          <strong className="alert__title">这是内置角色，只读。</strong>
          <span>要调整权限，复制它新建一个角色再改，然后把员工改成新角色。</span>
          {canManage && (
            <span className="alert__actions">
              <Link className="link" to={`${ROLE_NEW_PATH}?from=${encodeURIComponent(role.key)}`}>
                复制为新角色
              </Link>
            </span>
          )}
        </Alert>
      )}
      <section className="card" aria-labelledby="role-basic">
        <h2 className="card__title" id="role-basic">
          基本信息
        </h2>
        {editable ? (
          <>
            <TextField label="名字" maxLength={50} value={current.name} onChange={(event) => change({ name: event.target.value })} errors={draft !== null && current.name.trim() === "" ? ["请填写名字"] : []} />
            <TextField label="说明（选填）" maxLength={500} value={current.description} onChange={(event) => change({ description: event.target.value })} />
          </>
        ) : (
          <>
            <StaticField label="名字">{role?.name ?? ""}</StaticField>
            <StaticField label="说明">{role?.description ?? (role?.builtin ? "需求文档定义的岗位" : "—")}</StaticField>
          </>
        )}
        {role !== null && <StaticField label="用这个角色的员工">{`${role.staff_count} 人`}</StaticField>}
      </section>
      <section className="card" aria-labelledby="role-grants">
        <h2 className="card__title" id="role-grants">
          权限（菜单 × 操作）
        </h2>
        <p className="page-intro">勾编辑、审核会自动带上查看。平台账号的编辑、角色的编辑和审核只归超级管理员，自建角色勾不了。「导出」还没有对应的功能。</p>
        <PermissionMatrix grants={current.grants} readOnly={!editable} onToggle={(grant, on) => change({ grants: toggleGrant(current.grants, grant, on) })} />
      </section>
      {(!role?.builtin || isNew) && scopeSection}
      {(!role?.builtin || isNew) && (
        <section className="card" aria-labelledby="role-ip">
          <h2 className="card__title" id="role-ip">
            IP 白名单
          </h2>
          {editable ? (
            <div className="field">
              <label className="field__label" htmlFor="role-allowlist">
                允许的地址
              </label>
              <textarea className="input textarea" id="role-allowlist" rows={4} spellCheck={false} aria-describedby="role-allowlist-error role-allowlist-hint" aria-invalid={allowlistErrors.length > 0 || undefined} value={current.allowlist} onChange={(event) => change({ allowlist: event.target.value })} />
              <FieldErrors id="role-allowlist-error" errors={allowlistErrors} />
              <p className="field__hint" id="role-allowlist-hint">
                一行一个，如 203.0.113.0/24。留空 = 不限制。员工自己设了名单的，按员工自己的。
              </p>
            </div>
          ) : (
            <StaticField label="允许的地址">{(role?.ip_allowlist ?? []).join("、") || "不限制"}</StaticField>
          )}
        </section>
      )}
      {editable && !isNew && <TextField label="给审核同事的说明（选填）" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} hint="修改要另一位超级管理员审核后才生效。" />}
      {editable && (
        <div className="form-bar">
          {!isNew && role !== null && (
            <Button variant="secondary" className="button--danger-text" disabled={working} onClick={() => setDeleting(true)}>
              删除角色
            </Button>
          )}
          <Button variant="text" disabled={working} onClick={() => (draft !== null && !isNew ? setDraft(null) : void navigate(ROLE_LIST_PATH))}>
            {draft !== null && !isNew ? "撤销改动" : "取消"}
          </Button>
          <Button variant="primary" type="submit" loading={working} loadingText="提交中…" disabled={!isNew && draft === null}>
            {isNew ? "新建" : "提交修改（需审核）"}
          </Button>
        </div>
      )}
      <Dialog
        open={deleting}
        title={`删除角色「${role?.name ?? ""}」？`}
        busy={working}
        onClose={() => setDeleting(false)}
        footer={
          <>
            <Button variant="text" data-autofocus disabled={working} onClick={() => setDeleting(false)}>
              取消
            </Button>
            <Button variant="danger" loading={working} loadingText="删除中…" onClick={() => void remove()}>
              删除
            </Button>
          </>
        }
      >
        <p>只有没有任何账号（包括待激活、已停用的）在用它时才能删。删了不能恢复，操作会记在审计日志里。</p>
      </Dialog>
    </form>,
  );
}

/** 列表里的角色名：内置角色用固定的名字，自建角色用后端给的名字。 */
export function staffRoleLabel(role: string, roleNameFromServer: string): string {
  return isPlatformRole(role) ? (roleName("platform", role) ?? roleNameFromServer) : roleNameFromServer;
}
