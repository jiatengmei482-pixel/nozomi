/**
 * 运营后台「取消政策」（M3-03，ADR 0029）：平台按品类 × 车型级别统一的取消阶梯。
 * - 看：每个能看主数据的角色（`master_data.read`）；
 * - 改：`cancellation_policy.manage`（运营）——改好之后提交整份政策，**不直接生效**，等另一位有 `cancellation_policy.review` 的同事（运营、财务）在「待审核」里批准；
 *   只对之后下的单生效，已经下了的单按下单时的那一版。
 * 和后端同一个校验（@nozomi/domain 的 cancellationPolicyIssues）：小时数从大到小、最后一档 0 小时、越接近用车扣得越多。
 */
import { type CancellationPolicyIssue, cancellationPolicyIssues, sameCancellationPolicy } from "@nozomi/domain";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { type CancellationPolicy, type CancellationPolicyRule, getCancellationPolicy, requestPolicyChange } from "../../api/order-money.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button } from "../../components/Button.tsx";
import { StateBlock } from "../../components/States.tsx";
import { TextField } from "../../components/TextField.tsx";
import { useToast } from "../../components/Toast.tsx";
import { basisPointsText, percentTextToBasisPoints } from "../../lib/adjust-form.ts";
import { APPROVALS_PAGE_PATH } from "../../lib/channel-display.ts";
import { failureText } from "../../lib/failure.ts";
import { formatLocalDateTime } from "../../lib/master-display.ts";
import { POLICY_CATEGORY_NAMES, levelName, tiersText } from "../../lib/order-money-display.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan } from "../../lib/use-master-access.ts";

const NO_ACCESS = <StateBlock tone="neutral" title="你没有权限查看这里" description="需要的话，请联系管理员开通。" />;

/** 编辑中的一档：两个输入框的原文。 */
interface TierDraft {
  hours: string;
  fee: string;
}
type Draft = Record<string, TierDraft[]>;

const keyOf = (rule: Pick<CancellationPolicyRule, "category" | "level">): string => `${rule.category}|${rule.level}`;

function toDraft(policy: CancellationPolicy): Draft {
  return Object.fromEntries(policy.rules.map((rule) => [keyOf(rule), rule.tiers.map((tier) => ({ hours: String(tier.min_hours_before), fee: basisPointsText(tier.fee_bp) }))]));
}

/** 草稿 → 接口的写法；有填得认不出来的，返回出问题的格子。 */
function fromDraft(policy: CancellationPolicy, draft: Draft): { rules: CancellationPolicyRule[]; bad: string[] } {
  const bad: string[] = [];
  const rules = policy.rules.map((rule) => ({
    category: rule.category,
    level: rule.level,
    tiers: (draft[keyOf(rule)] ?? []).map((tier, index) => {
      const hours = /^\d{1,3}$/.test(tier.hours.trim()) ? Number(tier.hours.trim()) : null;
      const fee = percentTextToBasisPoints(tier.fee);
      if (hours === null || fee === null || fee > 10_000) bad.push(`${keyOf(rule)}|${index}`);
      return { min_hours_before: hours ?? -1, fee_bp: fee ?? -1 };
    }),
  }));
  return { rules, bad };
}

const ISSUE_TEXT: Readonly<Record<CancellationPolicyIssue["reason"], string>> = {
  MISSING_RULE: "每个品类 × 车型级别都要有阶梯",
  DUPLICATE_RULE: "重复了",
  UNKNOWN_RULE: "没有这个品类或车型级别",
  TIER_COUNT: "每条 1 到 5 档",
  HOURS_INVALID: "小时数要是 0 到 720 的整数",
  HOURS_NOT_DESCENDING: "小时数要从上到下越来越小",
  LAST_TIER_NOT_ZERO: "最后一档要是 0 小时（到用车时间为止）",
  FEE_INVALID: "扣款比例要在 0% 到 100% 之间",
  FEE_DECREASING: "越接近用车扣得越多：这一档不能比上一档扣得少",
};

export function CancellationPolicyPage() {
  const { portal, account, token, handleAuthFailure } = usePortalSession();
  useDocumentTitle(`取消政策 · NOZOMI ${portal.name}`);
  const canRead = usePlatformCan("master_data.read");
  const canManage = usePlatformCan("cancellation_policy.manage");
  const toast = useToast();
  const { state, reload } = useLoad<{ policy: CancellationPolicy }>("cancellation-policy", canRead ? (t) => getCancellationPolicy(t, "platform") : null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [note, setNote] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="取消政策" trail={[{ label: "订单" }]}>
      <Page title="平台统一取消政策" width="content">
        {content}
      </Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);
  const policy = state.data?.policy ?? null;
  if (policy === null) return shell(state.status === "error" ? <StateBlock tone="danger" title="取消政策没取到" description="请检查网络后刷新。" /> : <p className="table__muted">加载中…</p>);

  const submit = async (): Promise<void> => {
    if (draft === null) return;
    const { rules, bad } = fromDraft(policy, draft);
    if (bad.length > 0) {
      setProblems(["有格子写得不对：小时数写整数（如 24），扣款比例写百分比（如 50）"]);
      return;
    }
    const issues = cancellationPolicyIssues(rules.map((rule) => ({ category: rule.category, level: rule.level, tiers: rule.tiers.map((tier) => ({ minHoursBefore: tier.min_hours_before, feeBp: tier.fee_bp })) })));
    if (issues.length > 0) {
      setProblems([...new Set(issues.map((issue) => `${issueRule(rules, issue.path)}${ISSUE_TEXT[issue.reason]}`))]);
      return;
    }
    const current = policy.rules.map((rule) => ({ category: rule.category, level: rule.level, tiers: rule.tiers.map((tier) => ({ minHoursBefore: tier.min_hours_before, feeBp: tier.fee_bp })) }));
    if (sameCancellationPolicy(current, rules.map((rule) => ({ category: rule.category, level: rule.level, tiers: rule.tiers.map((tier) => ({ minHoursBefore: tier.min_hours_before, feeBp: tier.fee_bp })) })))) {
      setProblems(["和现在的政策一样，不用提交"]);
      return;
    }
    setBusy(true);
    setProblems([]);
    try {
      await requestPolicyChange(token, rules, note.trim() === "" ? null : note.trim());
      toast("已提交，等另一位同事审核后生效");
      setDraft(null);
      setNote("");
      reload();
    } catch (err) {
      if (!handleAuthFailure(err)) setProblems([failureText(err, "提交")]);
    } finally {
      setBusy(false);
    }
  };

  const editTier = (key: string, index: number, change: Partial<TierDraft>): void => {
    if (draft === null) return;
    setDraft({ ...draft, [key]: (draft[key] ?? []).map((tier, at) => (at === index ? { ...tier, ...change } : tier)) });
  };

  return shell(
    <>
      <p className="page-intro">
        客人付款前不知道订单会给哪家供应商，所以取消政策由平台按品类和车型级别统一规定，所有供应商相同（第五轮决策 ④）。取消时按距用车还有多久落在哪一档，扣对外价的这个比例；供应商得结算价 × 同一比例。航班取消（有证明）、不可抗力、平台或供应商原因的取消一律免费。
      </p>
      <p className="table__muted">{policy.version === 0 ? "现在用的是需求里的默认政策（还没有人改过）。" : `现在是第 ${policy.version} 版，${formatLocalDateTime(policy.effective_at as string)} 起生效。`}只对之后下的单生效：已经下了的单按下单时的那一版。</p>
      {canManage && draft === null && (
        <div className="form__actions">
          <Button variant="primary" onClick={() => setDraft(toDraft(policy))}>
            修改政策
          </Button>
        </div>
      )}
      {draft !== null && <Alert kind="info">改好后提交，不会立即生效：要另一位同事在「待审核」里批准。</Alert>}
      {problems.length > 0 && (
        <Alert kind="danger">
          {problems.map((problem) => (
            <p key={problem}>{problem}</p>
          ))}
        </Alert>
      )}
      {(["airport_transfer", "point_to_point", "charter"] as const).map((category) => (
        <section className="card" key={category} aria-labelledby={`policy-${category}`}>
          <h2 className="card__title" id={`policy-${category}`}>
            {POLICY_CATEGORY_NAMES[category]}
          </h2>
          <ul className="plain-list">
            {policy.rules
              .filter((rule) => rule.category === category)
              .map((rule) => {
                const key = keyOf(rule);
                const tiers = draft?.[key];
                return (
                  <li key={key}>
                    <strong>{levelName(rule.level)}</strong>
                    {tiers === undefined ? (
                      <span>{`：${tiersText(rule.tiers)}`}</span>
                    ) : (
                      <fieldset className="policy-tiers">
                        <legend className="visually-hidden">{`${POLICY_CATEGORY_NAMES[category]} · ${levelName(rule.level)} 的阶梯`}</legend>
                        {tiers.map((tier, index) => (
                          <div className="policy-tier" key={index}>
                            <TextField label={`第 ${index + 1} 档：距用车不少于（小时）`} inputMode="numeric" value={tier.hours} onChange={(event) => editTier(key, index, { hours: event.target.value })} />
                            <TextField label={`第 ${index + 1} 档：扣对外价（%）`} inputMode="decimal" value={tier.fee} onChange={(event) => editTier(key, index, { fee: event.target.value })} />
                            {tiers.length > 1 && (
                              <Button variant="text" size="sm" onClick={() => setDraft({ ...draft, [key]: tiers.filter((_, at) => at !== index) })}>
                                {`删掉第 ${index + 1} 档`}
                              </Button>
                            )}
                          </div>
                        ))}
                        {tiers.length < 5 && (
                          <Button variant="text" size="sm" onClick={() => setDraft({ ...draft, [key]: [...tiers.slice(0, -1), { hours: "", fee: "" }, ...tiers.slice(-1)] })}>
                            加一档
                          </Button>
                        )}
                      </fieldset>
                    )}
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
      {draft !== null && (
        <section className="card">
          <TextField label="修改原因（给审核的同事看）" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
          <div className="form__actions">
            <Button variant="primary" loading={busy} onClick={() => void submit()}>
              提交审核
            </Button>
            <Button
              variant="text"
              onClick={() => {
                setDraft(null);
                setProblems([]);
              }}
            >
              放弃修改
            </Button>
          </div>
          <p className="field__hint">
            提交后到<Link className="link" to={APPROVALS_PAGE_PATH}>待审核</Link>看进度。
          </p>
        </section>
      )}
    </>,
  );
}

/** 出问题的是哪一条：「接送机 · 商务：」。 */
function issueRule(rules: readonly CancellationPolicyRule[], path: string): string {
  const match = /^\/rules\/(\d+)/.exec(path);
  const rule = match ? rules[Number(match[1])] : undefined;
  return rule === undefined ? "" : `${POLICY_CATEGORY_NAMES[rule.category]} · ${levelName(rule.level)}：`;
}
