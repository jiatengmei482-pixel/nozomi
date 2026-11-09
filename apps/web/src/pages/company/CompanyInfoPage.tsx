/**
 * 供应商后台「设置 › 企业信息」（M4-34，ADR 0071）：对外显示名称和企业信息。
 * - 申请中：每一项都能直接改（和「企业资质」页同一个接口，ADR 0028）。
 * - 审核通过以后：注册地址、联系人、电话、邮箱直接改（平台会收到通知）；对外显示名称、法定名称、登记号要提交申请，
 *   平台审核通过后才生效，审核期间客人看到的仍是原来的；所在国家只有平台能改。
 * 改只归管理员（`company.manage`）；财务、只读能看。已清退的只能看。
 */
import { type FormEvent, type ReactNode, useState } from "react";
import { Link } from "react-router";
import { PROFILE_FIELD_NAMES, PROFILE_LIMITS, TENANT_DIRECT_PROFILE_KEYS } from "@nozomi/domain";
import { type CompanyOverview, type ProfileChangeField, type ProfileInput, type TenantProfileChange, getOwnCompany, listOwnProfileChanges, putOwnProfile, submitOwnProfileChange, withdrawOwnProfileChange } from "../../api/onboarding.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button } from "../../components/Button.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { TextField } from "../../components/TextField.tsx";
import { useToast } from "../../components/Toast.tsx";
import { failureText } from "../../lib/failure.ts";
import { formatLocalDateTime } from "../../lib/master-display.ts";
import { PROFILE_CHANGE_BADGES, PROFILE_DISPLAY_FIELDS, cleanProfile, emptyProfile, profileProblem } from "../../lib/profile-display.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { useTenantCan } from "../../lib/use-master-access.ts";
import { ChangeTable } from "../platform/TenantProfileSection.tsx";
import { COMPANY_PATH } from "./CompanyPage.tsx";

export const COMPANY_INFO_PATH = "/settings/company";

const DIRECT_KEYS: readonly string[] = TENANT_DIRECT_PROFILE_KEYS;
const CHANGE_FIELDS: readonly ProfileChangeField[] = ["name", "legal_name", "registration_no"];

// ───────────── 企业信息（直接改的部分）─────────────

function ProfileForm({ company, applying, onSaved }: { company: CompanyOverview; applying: boolean; onSaved(): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const [draft, setDraft] = useState<ProfileInput>(() => ({ ...emptyProfile(), ...(company.profile ?? {}) }));
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const fields = applying ? PROFILE_DISPLAY_FIELDS : PROFILE_DISPLAY_FIELDS.filter((field) => DIRECT_KEYS.includes(field.key));
  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (working) return;
    setWorking(true);
    setProblem(null);
    try {
      await putOwnProfile(token, cleanProfile(draft), company.profile?.version ?? null);
      toast("企业信息已保存");
      onSaved();
    } catch (err) {
      if (!handleAuthFailure(err)) setProblem(profileProblem(err) ?? failureText(err, "保存"));
    } finally {
      setWorking(false);
    }
  };
  return (
    <form className="form" noValidate onSubmit={(event) => void save(event)}>
      <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
      {fields.map((field) => (
        <TextField
          key={field.key}
          label={field.label}
          type={field.type ?? "text"}
          autoComplete="off"
          maxLength={PROFILE_LIMITS[field.key]}
          {...(field.hint ? { hint: field.hint } : {})}
          readOnly={working}
          value={draft[field.key] ?? ""}
          onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
        />
      ))}
      <div className="form-bar">
        <Button variant="primary" type="submit" loading={working} loadingText="保存中…">
          保存
        </Button>
      </div>
    </form>
  );
}

// ───────────── 申请修改名称、法定名称、登记号 ─────────────

function ChangeRequestCard({ company, changes, canManage, onChanged }: { company: CompanyOverview; changes: TenantProfileChange[]; canManage: boolean; onChanged(): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const current: Record<ProfileChangeField, string> = { name: company.tenant.name, legal_name: company.profile?.legal_name ?? "", registration_no: company.profile?.registration_no ?? "" };
  const [draft, setDraft] = useState<Record<ProfileChangeField, string>>(current);
  const [note, setNote] = useState("");
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const pending = changes.find((change) => change.status === "pending") ?? null;
  const history = changes.filter((change) => change.status !== "pending").slice(0, 5);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (working) return;
    const changed = CHANGE_FIELDS.filter((field) => draft[field].trim() !== current[field]);
    if (changed.length === 0) return setProblem("没有改动：请先改要改的那一项。");
    if (changed.some((field) => draft[field].trim() === "")) return setProblem("要改的项不能留空。");
    setWorking(true);
    setProblem(null);
    try {
      await submitOwnProfileChange(token, { ...Object.fromEntries(changed.map((field) => [field, draft[field].trim()])), note: note.trim() === "" ? null : note.trim() });
      toast("已提交，等平台审核");
      setNote("");
      onChanged();
    } catch (err) {
      if (!handleAuthFailure(err)) setProblem(profileProblem(err) ?? failureText(err, "提交"));
    } finally {
      setWorking(false);
    }
  };
  const withdraw = async (change: TenantProfileChange): Promise<void> => {
    if (working) return;
    setWorking(true);
    setProblem(null);
    try {
      await withdrawOwnProfileChange(token, change.id);
      toast("已撤回申请");
      onChanged();
    } catch (err) {
      if (!handleAuthFailure(err)) setProblem(profileProblem(err) ?? failureText(err, "撤回"));
    } finally {
      setWorking(false);
    }
  };
  return (
    <section className="card" aria-labelledby="company-change-title">
      <h2 className="card__title" id="company-change-title">
        申请修改名称、法定名称、登记号
      </h2>
      <p className="page-intro">这三项要平台核对营业执照或登记簿：提交后由平台审核，通过后才生效，审核期间客人和渠道看到的仍是原来的内容。</p>
      <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
      {pending !== null ? (
        <div className="profile-change">
          <p>
            <StatusBadge {...PROFILE_CHANGE_BADGES.pending} />
            {` ${formatLocalDateTime(pending.submitted_at)} 提交${pending.note === null ? "" : `，说明：${pending.note}`}`}
          </p>
          <ChangeTable change={pending} />
          {canManage && (
            <div className="form-bar">
              <Button variant="secondary" loading={working} loadingText="撤回中…" onClick={() => void withdraw(pending)}>
                撤回申请
              </Button>
            </div>
          )}
        </div>
      ) : canManage ? (
        <form className="form" noValidate onSubmit={(event) => void submit(event)}>
          {CHANGE_FIELDS.map((field) => (
            <TextField key={field} label={PROFILE_FIELD_NAMES[field]} autoComplete="off" maxLength={PROFILE_LIMITS[field]} readOnly={working} value={draft[field]} onChange={(event) => setDraft({ ...draft, [field]: event.target.value })} />
          ))}
          <div className="field">
            <label className="field__label" htmlFor="company-change-note">
              说明（可选）
            </label>
            <textarea className="input textarea" id="company-change-note" rows={2} maxLength={500} readOnly={working} value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
          <div className="form-bar">
            <Button variant="primary" type="submit" loading={working} loadingText="提交中…">
              提交申请
            </Button>
          </div>
        </form>
      ) : (
        <p>现在没有等审核的申请。</p>
      )}
      {history.length > 0 && (
        <>
          <h3 className="card__subtitle">以前的申请</h3>
          <ul className="plain-list">
            {history.map((change) => (
              <li key={change.id}>
                <StatusBadge {...PROFILE_CHANGE_BADGES[change.status]} />{" "}
                {`${change.fields.map((field) => `${PROFILE_FIELD_NAMES[field]}改成「${change.proposed[field] ?? ""}」`).join("，")}（${formatLocalDateTime(change.submitted_at)} 提交${change.reject_reason === null ? "" : `；平台的意见：${change.reject_reason}`}）`}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// ───────────── 整页 ─────────────

export function CompanyInfoPage() {
  const { portal, account } = usePortalSession();
  useDocumentTitle(`企业信息 · NOZOMI ${portal.name}`);
  const canRead = useTenantCan("company.read");
  const canManage = useTenantCan("company.manage");
  const company = useLoad<CompanyOverview>("tenant-company-info", canRead ? getOwnCompany : null);
  const changes = useLoad<{ items: TenantProfileChange[] }>("tenant-company-profile-changes", canRead ? listOwnProfileChanges : null);
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="企业信息" trail={[{ label: "设置" }]}>
      <Page title="企业信息" width="form">
        {content}
      </Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(<StateBlock tone="neutral" title="你没有权限查看这里" description="企业信息由管理员维护。需要的话，请联系你们的管理员。" />);
  const data = company.state.data;
  if (data === null) {
    return shell(
      <section className="card">
        {company.state.status === "error" ? (
          <StateBlock
            title="加载失败"
            description="请检查网络后重试。"
            action={
              <Button variant="secondary" onClick={company.reload}>
                重试
              </Button>
            }
          />
        ) : (
          <Skeleton lines={["medium", "long", "long"]} />
        )}
      </section>,
    );
  }
  const status = data.tenant.status;
  const writable = canManage && status !== "terminated";
  const applying = status === "applying";
  const reload = (): void => {
    company.reload();
    changes.reload();
  };
  return shell(
    <>
      {!canManage && <Alert kind="info">企业信息由管理员维护，你可以查看。</Alert>}
      {status === "terminated" && <Alert kind="info">已清退，只能查看。</Alert>}
      <section className="card" aria-labelledby="company-info-title">
        <h2 className="card__title" id="company-info-title">
          现在的企业信息
        </h2>
        <dl className="details">
          <div>
            <dt>{PROFILE_FIELD_NAMES.name}</dt>
            <dd>{data.tenant.name}</dd>
          </div>
          {PROFILE_DISPLAY_FIELDS.map((field) => (
            <div key={field.key}>
              <dt>{field.label}</dt>
              <dd>{data.profile?.[field.key] ?? "—"}</dd>
            </div>
          ))}
        </dl>
        <p className="page-intro">银行信息在「账单」的「收款账户」里维护。</p>
      </section>
      {writable && (
        <section className="card" aria-labelledby="company-edit-title">
          <h2 className="card__title" id="company-edit-title">
            {applying ? "修改企业信息" : "修改注册地址和联系方式"}
          </h2>
          <p className="page-intro">
            {applying ? (
              <>
                入驻申请中，每一项都可以直接改；也可以在
                <Link className="link" to={COMPANY_PATH}>
                  「企业资质」
                </Link>
                里改。所在国家决定要交哪些资质。
              </>
            ) : (
              "保存后直接生效，平台运营会收到通知。所在国家要改的话请联系平台。"
            )}
          </p>
          <ProfileForm key={data.profile?.version ?? 0} company={data} applying={applying} onSaved={reload} />
        </section>
      )}
      {changes.state.data !== null && (writable || changes.state.data.items.length > 0) && <ChangeRequestCard key={`${data.tenant.version}:${data.profile?.version ?? 0}:${changes.state.data.items.length}:${changes.state.data.items[0]?.status ?? ""}`} company={data} changes={changes.state.data.items} canManage={writable} onChanged={reload} />}
    </>,
  );
}
