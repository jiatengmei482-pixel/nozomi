/**
 * 运营后台「赔付表」（M4-03；接口 M4-02，ADR 0034；页面说明 docs/design/pages/platform-tickets.md 第 5 节）：
 * - 看（`master_data.read`，每个角色）：7 种问题赔客人对外价的比例、供应商按结算价同比例承担、每笔最低额、报销上限、判定要复核的阈值；
 * - 改（`compensation_table.manage`，运营）：提交整张表，另一位有 `compensation_table.review` 的同事（运营、财务）在「待审核」里批准后存成新的一版；
 *   之后判定的按新表，已经判定的不变。司机未到固定 100%（全额退款）。
 * 百分比以基点整数进出接口；页面上写成「12.5%」，换算不用浮点。
 */
import { COMPENSATION_RULES, COMPENSATION_SCENARIOS, type CompensationScenario } from "@nozomi/domain";
import { type FormEvent, type ReactNode, useState } from "react";
import { Link } from "react-router";
import { ApiError } from "../../api/client.ts";
import { type CompensationTableView, getCompensationTable, requestCompensationTableChange } from "../../api/order-center.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button } from "../../components/Button.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { TextAreaField } from "../../components/TextAreaField.tsx";
import { TextField } from "../../components/TextField.tsx";
import { useToast } from "../../components/Toast.tsx";
import { basisPointsText, percentTextToBasisPoints } from "../../lib/adjust-form.ts";
import { APPROVALS_PAGE_PATH } from "../../lib/channel-display.ts";
import { failureText } from "../../lib/failure.ts";
import { percentLabel, scenarioName } from "../../lib/order-center-display.ts";
import { POLICY_PAGE_PATH } from "../../lib/order-money-display.ts";
import { moneyText } from "../../lib/product-display.ts";
import { serverIssues } from "../../lib/product-failure.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan } from "../../lib/use-master-access.ts";
import { LocalTime, NO_ACCESS } from "./order-center-parts.tsx";

/** 供应商承担的那一列：同比例 × 结算价；司机未到另加报销；车型降级另加差价。 */
function tenantShareText(row: CompensationTableView["scenarios"][number]): string {
  if (row.full_refund) return "结算价 × 100%（违约金）+ 客人的替代交通报销";
  if (row.downgrade_difference) return `两个车型组的结算价之差 + 结算价 × ${percentLabel(row.customer_bp)}`;
  return `结算价 × ${percentLabel(row.customer_bp)}`;
}

function customerText(row: CompensationTableView["scenarios"][number], table: CompensationTableView): string {
  if (row.full_refund) return `全额退款 + 凭票报销替代交通（上限对外价的 ${percentLabel(table.reimbursement_cap_bp)}）`;
  if (row.downgrade_difference) return `差价 + 对外价的 ${percentLabel(row.customer_bp)}`;
  return `对外价的 ${percentLabel(row.customer_bp)}`;
}

interface Draft {
  rates: Record<CompensationScenario, string>;
  minimum: string;
  cap: string;
  review: string;
  note: string;
}

function draftOf(table: CompensationTableView): Draft {
  return {
    rates: Object.fromEntries(table.scenarios.map((row) => [row.scenario, basisPointsText(row.customer_bp)])) as Record<CompensationScenario, string>,
    minimum: String(table.minimum_jpy),
    cap: basisPointsText(table.reimbursement_cap_bp),
    review: basisPointsText(table.review_at_or_above_sell_bp),
    note: "",
  };
}

/** 改赔付表：整张表一起提交，发起复核。 */
function EditForm({ table, onCancel, onDone }: { table: CompensationTableView; onCancel(): void; onDone(): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const [draft, setDraft] = useState<Draft>(() => draftOf(table));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const found: Record<string, string> = {};
    const rates = {} as Record<CompensationScenario, number>;
    for (const scenario of COMPENSATION_SCENARIOS) {
      if (scenario === "driver_no_show") {
        rates[scenario] = 10_000;
        continue;
      }
      const bp = percentTextToBasisPoints(draft.rates[scenario] ?? "");
      if (bp === null || bp > 10_000) found[scenario] = "填 0 到 100 之间的百分比，最多两位小数";
      else rates[scenario] = bp;
    }
    const minimum = /^\d+$/.test(draft.minimum.trim()) ? Number(draft.minimum.trim()) : null;
    if (minimum === null || minimum > COMPENSATION_RULES.maxMinimumJpy) found["minimum"] = `填 0 到 ${COMPENSATION_RULES.maxMinimumJpy.toLocaleString("en-US")} 之间的整数（日元）`;
    const cap = percentTextToBasisPoints(draft.cap);
    if (cap === null || cap > COMPENSATION_RULES.maxReimbursementCapBp) found["cap"] = `填 0 到 ${basisPointsText(COMPENSATION_RULES.maxReimbursementCapBp)} 之间的百分比`;
    const review = percentTextToBasisPoints(draft.review);
    if (review === null || review > 10_000) found["review"] = "填 0 到 100 之间的百分比（0 = 每一笔都复核）";
    setErrors(found);
    if (Object.keys(found).length > 0 || minimum === null || cap === null || review === null) {
      setProblem(`有 ${Object.keys(found).length} 处需要修改`);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await requestCompensationTableChange(token, { customer_bp: rates, minimum_jpy: minimum, reimbursement_cap_bp: cap, review_at_or_above_sell_bp: review, note: draft.note.trim() === "" ? null : draft.note.trim() });
      onDone();
    } catch (err) {
      if (handleAuthFailure(err)) return;
      if (err instanceof ApiError && err.code === "VALIDATION_FAILED") setProblem(`按规则不能这样改：${serverIssues(err).map((issue) => issue.message).join("；") || err.message}`);
      else setProblem(err instanceof ApiError && err.status < 500 ? err.message : `${failureText(err, "提交")}你填写的内容还在。`);
    } finally {
      setBusy(false);
    }
  };
  const field = (key: string): string[] => (errors[key] === undefined ? [] : [errors[key] as string]);
  return (
    <form className="card form" onSubmit={(event) => void submit(event)} noValidate aria-labelledby="compensation-edit">
      <h2 className="card__title" id="compensation-edit">
        修改赔付表
      </h2>
      <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
      <p>提交后要另一位有审核权限的同事（运营或财务）在「待审核」里批准，才存成新的一版；之后判定的工单按新表，已经判定的不变。</p>
      <div className="rate-grid">
        {COMPENSATION_SCENARIOS.map((scenario) =>
          scenario === "driver_no_show" ? (
            <TextField key={scenario} label={`${scenarioName(scenario)}（赔对外价的 %）`} value="100" readOnly hint="全额退款，固定 100%，不能改" />
          ) : (
            <TextField key={scenario} label={`${scenarioName(scenario)}（赔对外价的 %）`} inputMode="decimal" value={draft.rates[scenario] ?? ""} errors={field(scenario)} readOnly={busy} onChange={(event) => setDraft({ ...draft, rates: { ...draft.rates, [scenario]: event.target.value } })} />
          ),
        )}
        <TextField label="每笔至少等值（日元）" inputMode="numeric" value={draft.minimum} errors={field("minimum")} readOnly={busy} onChange={(event) => setDraft({ ...draft, minimum: event.target.value })} hint="客人付别的币种时按判定那一刻的汇率换算、向上取整；补足的部分平台承担" />
        <TextField label="替代交通报销上限（对外价的 %）" inputMode="decimal" value={draft.cap} errors={field("cap")} readOnly={busy} onChange={(event) => setDraft({ ...draft, cap: event.target.value })} hint="150 = 对外价的 1.5 倍" />
        <TextField label="判定要复核的阈值（赔客人达到对外价的 %）" inputMode="decimal" value={draft.review} errors={field("review")} readOnly={busy} onChange={(event) => setDraft({ ...draft, review: event.target.value })} hint="达到时判定要另一位同事批准；0 = 每一笔都复核" />
      </div>
      <TextAreaField label="为什么改（选填）" maxLength={500} value={draft.note} readOnly={busy} onChange={(event) => setDraft({ ...draft, note: event.target.value })} hint="审核的同事看得到" />
      <div className="form__actions">
        <Button variant="text" disabled={busy} onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" variant="primary" loading={busy} loadingText="提交中…">
          提交复核
        </Button>
      </div>
    </form>
  );
}

export function CompensationTablePage() {
  const { portal, account } = usePortalSession();
  useDocumentTitle(`赔付表 · NOZOMI ${portal.name}`);
  const canRead = usePlatformCan("master_data.read");
  const canManage = usePlatformCan("compensation_table.manage");
  const canApprovals = usePlatformCan("approval.read");
  const toast = useToast();
  const { state, reload } = useLoad<{ compensation_table: CompensationTableView }>("compensation-table", canRead ? getCompensationTable : null);
  const [editing, setEditing] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="赔付表">
      <Page title="客人赔付表" {...(canManage && !editing && state.data !== null ? { action: <Button variant="primary" onClick={() => setEditing(true)}>修改赔付表</Button> } : {})}>
        {content}
      </Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);
  const table = state.data?.compensation_table ?? null;
  if (table === null) {
    return shell(state.status === "error" ? <StateBlock title="加载失败" description="请检查网络后重试。" action={<Button variant="secondary" onClick={reload}>重试</Button>} /> : <Skeleton lines={["long", "long", "long", "medium"]} />);
  }
  return shell(
    <>
      <p className="page__lead">
        客人投诉、履约失败成立时，按这张表赔客人（按对外价），责任在供应商的按同一比例乘以结算价承担，加价部分平台承担。每笔至少等值的最低额由平台先付。取消政策另在
        <Link className="link" to={POLICY_PAGE_PATH}>
          取消政策
        </Link>
        里。
      </p>
      {submitted && (
        <Alert kind="success">
          <strong className="alert__title">已提交复核</strong>
          <span>另一位有审核权限的同事批准后才生效；在那之前判定仍按下面这一版算。</span>
          {canApprovals && <Link to={APPROVALS_PAGE_PATH}>去「待审核」</Link>}
        </Alert>
      )}
      {editing && (
        <EditForm
          table={table}
          onCancel={() => setEditing(false)}
          onDone={() => {
            setEditing(false);
            setSubmitted(true);
            toast("已提交复核");
          }}
        />
      )}
      <section className="card" aria-labelledby="compensation-current">
        <h2 className="card__title" id="compensation-current">
          {table.version === 0 ? "现在用的：默认表（需求原表，还没有人改过）" : `现在用的：第 ${table.version} 版`}
        </h2>
        {table.effective_at !== null && (
          <p className="table__muted">
            生效时间 <LocalTime iso={table.effective_at} />
          </p>
        )}
        <div className="table-wrap">
          <div className="table-scroll" tabIndex={0} role="region" aria-label="赔付表">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">问题</th>
                  <th scope="col">赔客人</th>
                  <th scope="col">供应商承担（结算币种）</th>
                </tr>
              </thead>
              <tbody>
                {table.scenarios.map((row) => (
                  <tr key={row.scenario}>
                    <th scope="row">{row.name}</th>
                    <td>{customerText(row, table)}</td>
                    <td>{tenantShareText(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <dl className="details">
          <div className="details__item">
            <dt>每笔至少等值</dt>
            <dd>{moneyText(table.minimum_jpy, "JPY")}</dd>
          </div>
          <div className="details__item">
            <dt>替代交通报销上限</dt>
            <dd>{`对外价的 ${percentLabel(table.reimbursement_cap_bp)}`}</dd>
          </div>
          <div className="details__item">
            <dt>判定要复核的阈值</dt>
            <dd>{table.review_at_or_above_sell_bp === 0 ? "每一笔都复核" : `赔客人的钱达到对外价的 ${percentLabel(table.review_at_or_above_sell_bp)}`}</dd>
          </div>
        </dl>
        {!canManage && <p className="table__muted">你可以查看，但没有修改赔付表的权限。</p>}
      </section>
    </>,
  );
}
